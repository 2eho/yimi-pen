import { isAuthoringImportedAsset } from "./authoring-contract.mjs";

export class FamilyWorkspaceAuthoringAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FamilyWorkspaceAuthoringAdapterError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new FamilyWorkspaceAuthoringAdapterError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function assertWorkspace(workspace) {
  assert(workspace?.read && typeof workspace.read.loadHead === "function"
    && workspace.authoring
    && typeof workspace.authoring.importFile === "function"
    && typeof workspace.authoring.captureAndImport === "function"
    && typeof workspace.authoring.commitImportedClipReplacement === "function",
  "AUTHORING_WORKSPACE_CAPABILITY_INVALID",
  "authoring adapter requires only the public FamilyWorkspace capabilities");
}

function publicImportedAsset(receipt) {
  assert(isAuthoringImportedAsset(receipt)
    && Number.isSafeInteger(receipt.durationMs) && receipt.durationMs > 0
    && receipt.codec === "WAV_PCM16_16K_MONO",
  "AUTHORING_SOURCE_ASSET_RECEIPT_INVALID", "workspace returned a malformed canonical audio receipt");
  return Object.freeze({
    assetId: receipt.assetId,
    contentPath: receipt.contentPath,
    bytes: receipt.bytes,
    sha256: receipt.sha256,
    durationMs: receipt.durationMs,
    codec: receipt.codec,
  });
}

function aborted(stage, importedAssetPublished) {
  return new FamilyWorkspaceAuthoringAdapterError(
    "AUTHORING_SOURCE_ABORTED",
    "source acquisition was cancelled",
    { stage, importedAssetPublished },
  );
}

/**
 * Narrow FamilyWorkspace to the two operations owned by the product session.
 * Repository, vault, coordinator, roots, and generic commit remain private.
 */
export function createFamilyWorkspaceAuthoringPort(workspace) {
  assertWorkspace(workspace);
  return Object.freeze({
    profile: "family-workspace-authoring-port-v1",
    loadHead: () => workspace.read.loadHead(),
    commitReplacement: (command) => workspace.authoring.commitImportedClipReplacement(command),
  });
}

export function createFamilyWorkspaceFileSourcePort(workspace) {
  assertWorkspace(workspace);
  return Object.freeze({
    sourceKind: "FILE",
    requiredCapability: null,
    clipSourceKind: "family-recording",
    async acquire({ assetId, request, signal }) {
      assert(request && typeof request.sourcePath === "string" && request.sourcePath.length > 0,
        "AUTHORING_FILE_REQUEST_INVALID", "file source request requires its adapter-private sourcePath");
      if (signal?.aborted) throw aborted("before-import", false);
      const imported = await workspace.authoring.importFile({
        sourcePath: request.sourcePath,
        assetId,
      });
      if (signal?.aborted) throw aborted("after-import", true);
      return Object.freeze({ importedAsset: publicImportedAsset(imported) });
    },
  });
}

export function createFamilyWorkspaceCaptureSourcePort(workspace) {
  assertWorkspace(workspace);
  return Object.freeze({
    sourceKind: "CAPTURE",
    requiredCapability: "MICROPHONE",
    clipSourceKind: "family-recording",
    async acquire({ assetId, request, signal }) {
      assert(request && typeof request === "object" && !Array.isArray(request),
        "AUTHORING_CAPTURE_REQUEST_INVALID", "capture source request is required");
      if (signal?.aborted) throw aborted("before-capture", false);
      const captured = await workspace.authoring.captureAndImport({
        assetId,
        captureRequest: request,
        signal,
      });
      if (signal?.aborted) throw aborted("after-capture-import", true);
      return Object.freeze({ importedAsset: publicImportedAsset(captured.importedAsset) });
    },
  });
}

export function createFamilyWorkspaceAuthoringAdapter(workspace) {
  assertWorkspace(workspace);
  const sourcePorts = [createFamilyWorkspaceFileSourcePort(workspace)];
  if (workspace.descriptor?.captureConfigured === true) {
    sourcePorts.push(createFamilyWorkspaceCaptureSourcePort(workspace));
  }
  return Object.freeze({
    authoringPort: createFamilyWorkspaceAuthoringPort(workspace),
    sourcePorts: Object.freeze(sourcePorts),
  });
}
