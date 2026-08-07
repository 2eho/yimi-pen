import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { collectReferencedFamilyAssets } from "../../../../contracts/family-export-v1.mjs";
import { AtomicJsonFamilyRepository } from "../../../../tools/family-repository/atomic-json-adapter.mjs";
import {
  applyAssetVaultMaintenance,
  planAssetVaultMaintenance,
} from "../asset-vault/asset-vault-maintenance-use-case.mjs";
import { validateAssetVaultLimits } from "../asset-vault/asset-vault-maintenance-contract.mjs";
import { createFamilyAssetReferenceCoordinator } from "../asset-vault/family-asset-reference-coordinator.mjs";
import { createLocalContentAddressedAudioVault } from "../asset-vault/local-content-addressed-audio-vault.mjs";
import { captureCanonicalAudioAsset } from "../authoring/capture-source-use-case.mjs";
import { commitImportedClipReplacement } from "../authoring/family-authoring-use-case.mjs";
import {
  exportCompleteFamily,
  inspectCompleteFamilyExport,
} from "../local-family-export.mjs";
import {
  importCanonicalWav,
  resolveVerifiedPreviewClip,
} from "../prelisten/local-audio-assets.mjs";

const PROFILE = "family-workspace-v1";
const MARKER_NAME = "family-workspace.json";
const OPEN_WORKSPACES = new Map();
const WORKSPACE_CAPABILITIES = new WeakMap();

export class FamilyWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FamilyWorkspaceError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new FamilyWorkspaceError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function overlaps(left, right) {
  return left === right || inside(left, right) || inside(right, left);
}

async function optionalLstat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertRegularDirectory(target, code, label) {
  const info = await optionalLstat(target);
  assert(info?.isDirectory() && !info.isSymbolicLink(), code, `${label} must be a regular directory`);
  return realpath(target);
}

function assertDirectChild(root, target, code, label) {
  assert(path.dirname(target) === root && target !== root, code, `${label} must be a direct child of its allowed root`);
}

function markerBytes(repositoryId) {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    profile: PROFILE,
    repositoryId,
  }, null, 2)}\n`, "utf8");
}

async function ensureChildDirectory(root, name) {
  const candidate = path.join(root, name);
  try {
    await mkdir(candidate);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const realCandidate = await assertRegularDirectory(
    candidate,
    "FAMILY_WORKSPACE_LAYOUT_INVALID",
    `workspace ${name}`,
  );
  assert(inside(root, realCandidate), "FAMILY_WORKSPACE_LAYOUT_INVALID", `workspace ${name} escaped its owned root`);
  return realCandidate;
}

async function prepareWorkspaceLayout({
  allowedRoot,
  workspaceDirectory,
  repositoryId,
  requireAbsent,
}) {
  assert(path.isAbsolute(allowedRoot ?? "") && path.isAbsolute(workspaceDirectory ?? ""),
    "FAMILY_WORKSPACE_ROOT_INVALID", "workspace roots must be absolute paths");
  const allowed = path.resolve(allowedRoot);
  const workspace = path.resolve(workspaceDirectory);
  const realAllowed = await assertRegularDirectory(
    allowed,
    "FAMILY_WORKSPACE_ROOT_INVALID",
    "allowed workspace root",
  );
  assertDirectChild(allowed, workspace, "FAMILY_WORKSPACE_ROOT_INVALID", "workspace directory");

  const before = await optionalLstat(workspace);
  assert(!(requireAbsent && before), "FAMILY_WORKSPACE_OUTPUT_EXISTS", "workspace output already exists");
  const createdWorkspace = before === null;
  if (!before) {
    await mkdir(workspace);
  }
  const realWorkspace = await assertRegularDirectory(
    workspace,
    "FAMILY_WORKSPACE_ROOT_INVALID",
    "workspace directory",
  );
  assert(inside(realAllowed, realWorkspace),
    "FAMILY_WORKSPACE_ROOT_INVALID", "workspace directory resolved outside its allowed root");

  // Constructing the adapter validates repositoryId before the workspace marker
  // becomes durable. The instance is discarded; the real adapter is created
  // only after all owned paths have been verified.
  new AtomicJsonFamilyRepository({
    repositoryId,
    repositoryRoot: path.join(realWorkspace, "repository"),
    allowedRoot: realWorkspace,
  });

  const markerPath = path.join(realWorkspace, MARKER_NAME);
  const expectedMarker = markerBytes(repositoryId);
  const markerInfo = await optionalLstat(markerPath);
  assert(createdWorkspace || markerInfo,
    "FAMILY_WORKSPACE_MARKER_MISSING",
    "an existing directory must already carry a FamilyWorkspace marker");
  if (!markerInfo) {
    try {
      await writeFile(markerPath, expectedMarker, { flag: "wx" });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const publishedMarker = await optionalLstat(markerPath);
  assert(publishedMarker?.isFile() && !publishedMarker.isSymbolicLink(),
    "FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker must be a regular file");
  const [realMarker, actualMarker] = await Promise.all([realpath(markerPath), readFile(markerPath)]);
  assert(inside(realWorkspace, realMarker) && actualMarker.equals(expectedMarker),
    "FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker differs from the requested identity");

  const repositoryRoot = await ensureChildDirectory(realWorkspace, "repository");
  const vaultRoot = await ensureChildDirectory(realWorkspace, "asset-vault");
  const captureRoot = await ensureChildDirectory(realWorkspace, "capture-staging");
  return Object.freeze({
    allowedRoot: realAllowed,
    workspaceRoot: realWorkspace,
    repositoryRoot,
    vaultRoot,
    captureRoot,
  });
}

async function removeOwnedWorkspaceDirectory({
  allowedRoot,
  workspaceDirectory,
  repositoryId,
  requireMarker,
}) {
  const allowed = path.resolve(allowedRoot);
  const workspace = path.resolve(workspaceDirectory);
  const realAllowed = await assertRegularDirectory(
    allowed,
    "FAMILY_WORKSPACE_CLEANUP_UNSAFE",
    "allowed workspace cleanup root",
  );
  assertDirectChild(allowed, workspace, "FAMILY_WORKSPACE_CLEANUP_UNSAFE", "workspace cleanup target");
  const info = await optionalLstat(workspace);
  if (!info) return;
  assert(info.isDirectory() && !info.isSymbolicLink(),
    "FAMILY_WORKSPACE_CLEANUP_UNSAFE", "workspace cleanup target must be a regular directory");
  const realWorkspace = await realpath(workspace);
  assert(inside(realAllowed, realWorkspace),
    "FAMILY_WORKSPACE_CLEANUP_UNSAFE", "workspace cleanup target escaped its allowed root");
  const markerPath = path.join(realWorkspace, MARKER_NAME);
  const markerInfo = await optionalLstat(markerPath);
  if (markerInfo) {
    assert(markerInfo.isFile() && !markerInfo.isSymbolicLink(),
      "FAMILY_WORKSPACE_CLEANUP_UNSAFE", "workspace cleanup marker is unsafe");
    const [realMarker, actualMarker] = await Promise.all([realpath(markerPath), readFile(markerPath)]);
    assert(inside(realWorkspace, realMarker) && actualMarker.equals(markerBytes(repositoryId)),
      "FAMILY_WORKSPACE_CLEANUP_UNSAFE", "workspace cleanup marker differs from the owned identity");
  } else {
    assert(!requireMarker,
      "FAMILY_WORKSPACE_CLEANUP_UNSAFE", "published workspace cleanup requires its owned marker");
  }
  await rm(realWorkspace, { recursive: true, force: true });
  assert(!(await optionalLstat(workspace)),
    "FAMILY_WORKSPACE_CLEANUP_FAILED", "owned workspace directory remains after cleanup");
}

function assertProbePort(probeCanonicalWav) {
  assert(typeof probeCanonicalWav === "function",
    "FAMILY_WORKSPACE_AUDIO_PORT_INVALID", "canonical WAV probe port is required");
}

function assertImportLimit(maxImportBytes) {
  assert(Number.isSafeInteger(maxImportBytes) && maxImportBytes > 0,
    "FAMILY_WORKSPACE_LIMIT_INVALID", "maxImportBytes must be a positive safe integer");
}

function assertCapturePort(capturePort) {
  assert(capturePort && typeof capturePort.capture === "function" && typeof capturePort.discard === "function",
    "FAMILY_WORKSPACE_CAPTURE_PORT_INVALID", "capture port factory returned a malformed port");
}

function canonicalContentPath(sha256) {
  return `assets/sha256/${sha256}.wav`;
}

function processPathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function buildFamilyWorkspace({
  allowedRoot,
  workspaceDirectory,
  repositoryId,
  probeCanonicalWav,
  maxImportBytes,
  maintenanceLimits: inputMaintenanceLimits,
  capturePortFactory,
  requireAbsent,
}) {
  assertProbePort(probeCanonicalWav);
  assertImportLimit(maxImportBytes);
  const maintenanceLimits = validateAssetVaultLimits(inputMaintenanceLimits);
  assert(capturePortFactory === null || typeof capturePortFactory === "function",
    "FAMILY_WORKSPACE_CAPTURE_PORT_INVALID", "capturePortFactory must be a function or null");
  const layout = await prepareWorkspaceLayout({
    allowedRoot,
    workspaceDirectory,
    repositoryId,
    requireAbsent,
  });
  const lifecycleState = {
    closed: false,
    activeOperations: 0,
    workspaceDirectory: layout.workspaceRoot,
  };
  const vault = createLocalContentAddressedAudioVault({ vaultRoot: layout.vaultRoot });
  const assetVaultRecovery = await vault.recoverInterruptedMaintenance({ limits: maintenanceLimits });
  const repository = new AtomicJsonFamilyRepository({
    repositoryId,
    repositoryRoot: layout.repositoryRoot,
    allowedRoot: layout.workspaceRoot,
  });
  const initialization = Object.freeze(await repository.initialize());
  const coordinator = createFamilyAssetReferenceCoordinator({ repository });
  const capturePort = capturePortFactory
    ? await capturePortFactory(Object.freeze({ captureRoot: layout.captureRoot }))
    : null;
  if (capturePort !== null) assertCapturePort(capturePort);

  async function importFile({ sourcePath, assetId }) {
    return coordinator.withReferenceMutation(() => importCanonicalWav({
      sourcePath,
      assetId,
      vaultRoot: layout.vaultRoot,
      probeCanonicalWav,
      maxBytes: maxImportBytes,
    }));
  }

  async function verifyCanonicalAsset({ assetId, sha256, bytes, contentPath, durationMs, codec }) {
    assert(contentPath === canonicalContentPath(sha256),
      "FAMILY_WORKSPACE_ASSET_OUTSIDE_VAULT", "asset receipt does not use this workspace's canonical path", {
        assetId,
        contentPath,
      });
    const verified = await resolveVerifiedPreviewClip({
      clip: {
        clipId: assetId,
        sha256,
        bytes,
        assetPath: contentPath,
        durationMs,
        codec,
      },
      assetRoot: layout.vaultRoot,
      maxBytes: maxImportBytes,
    });
    const probe = await probeCanonicalWav(verified.absolutePath);
    assert(probe?.codecProfile === "WAV_PCM16_16K_MONO"
      && Number.isInteger(probe.durationMs) && probe.durationMs > 0,
    "FAMILY_WORKSPACE_ASSET_PROFILE_INVALID", "workspace asset is outside the canonical WAV profile", { assetId });
    assert(codec === "WAV_PCM16_16K_MONO" && durationMs === probe.durationMs,
      "FAMILY_WORKSPACE_ASSET_RECEIPT_STALE", "asset receipt differs from the stored canonical WAV", { assetId });
    return Object.freeze({
      assetId,
      contentPath,
      absolutePath: verified.absolutePath,
      bytes,
      sha256,
      durationMs: probe.durationMs,
      codec: probe.codecProfile,
    });
  }

  async function verifyRevisionAssets(revision) {
    const references = collectReferencedFamilyAssets({ state: { revisions: [revision] } });
    const byDigest = new Map();
    for (const reference of references) byDigest.set(reference.sha256, reference);
    for (const reference of byDigest.values()) {
      const verified = await resolveVerifiedPreviewClip({
        clip: {
          clipId: reference.assetId,
          sha256: reference.sha256,
          bytes: reference.bytes,
          assetPath: canonicalContentPath(reference.sha256),
          durationMs: null,
          codec: "WAV_PCM16_16K_MONO",
        },
        assetRoot: layout.vaultRoot,
        maxBytes: maxImportBytes,
      });
      const probe = await probeCanonicalWav(verified.absolutePath);
      assert(probe?.codecProfile === "WAV_PCM16_16K_MONO"
        && Number.isInteger(probe.durationMs) && probe.durationMs > 0,
      "FAMILY_WORKSPACE_ASSET_PROFILE_INVALID", "FamilyRevision references a noncanonical workspace asset", {
        assetId: reference.assetId,
        sha256: reference.sha256,
      });
    }
    return references;
  }

  async function commitInitialRevision({ operationId, revision, at }) {
    return coordinator.withReferenceMutation(async (port) => {
      await verifyRevisionAssets(revision);
      return port.commit({ operationId, revision, expectedHeadRevisionId: null, at });
    });
  }

  async function commitReplacement(input) {
    return coordinator.withReferenceMutation(async (port) => {
      const importedAsset = await verifyCanonicalAsset(input?.importedAsset ?? {});
      return commitImportedClipReplacement({ ...input, importedAsset, repository: port });
    });
  }

  async function captureAndImport({ captureRequest, assetId, signal }) {
    assert(capturePort !== null,
      "FAMILY_WORKSPACE_CAPTURE_NOT_CONFIGURED", "this workspace has no capture source adapter");
    return captureCanonicalAudioAsset({
      capturePort,
      captureRequest,
      signal,
      importPort: ({ sourcePath }) => importFile({ sourcePath, assetId }),
    });
  }

  async function readAssetBytes({ assetId, sha256, bytes }) {
    const verified = await resolveVerifiedPreviewClip({
      clip: {
        clipId: assetId,
        sha256,
        bytes,
        assetPath: canonicalContentPath(sha256),
      },
      assetRoot: layout.vaultRoot,
      maxBytes: maxImportBytes,
    });
    return readFile(verified.absolutePath);
  }

  async function exportComplete(input) {
    assert(Number.isSafeInteger(input?.limits?.maxBackupBytes) && input.limits.maxBackupBytes > 0,
      "FAMILY_WORKSPACE_LIMIT_INVALID", "complete export requires an explicit backup byte limit");
    return coordinator.withStableReferenceSnapshot({
      createdAt: input.createdAt,
      maxBackupBytes: input.limits.maxBackupBytes,
    }, () => exportCompleteFamily({
      ...input,
      repository,
      assetReader: readAssetBytes,
    }));
  }

  function trackedOperation(operation) {
    return async (...args) => {
      if (lifecycleState.closed) {
        fail("FAMILY_WORKSPACE_CLOSED", "workspace capability is closed");
      }
      lifecycleState.activeOperations += 1;
      try {
        return await operation(...args);
      } finally {
        lifecycleState.activeOperations -= 1;
      }
    };
  }

  const publicWorkspace = Object.freeze({
    descriptor: Object.freeze({
      schemaVersion: 1,
      profile: PROFILE,
      repositoryId,
      captureConfigured: capturePort !== null,
      initialization,
      maintenanceLimits,
      assetVaultRecovery,
    }),
    read: Object.freeze({
      open: trackedOperation(() => repository.open()),
      loadHead: trackedOperation(() => repository.loadHead()),
      loadRevision: trackedOperation((revisionId) => repository.loadRevision(revisionId)),
      readOutbox: trackedOperation(() => repository.readOutbox()),
    }),
    authoring: Object.freeze({
      importFile: trackedOperation(importFile),
      captureAndImport: trackedOperation(captureAndImport),
      commitInitialRevision: trackedOperation(commitInitialRevision),
      commitImportedClipReplacement: trackedOperation(commitReplacement),
    }),
    maintenance: Object.freeze({
      plan: trackedOperation((input) => {
        assert(input?.limits === undefined
          || JSON.stringify(validateAssetVaultLimits(input.limits)) === JSON.stringify(maintenanceLimits),
        "FAMILY_WORKSPACE_LIMIT_INVALID", "maintenance request differs from the workspace resource policy");
        return planAssetVaultMaintenance({
          ...input,
          limits: maintenanceLimits,
          referencePort: coordinator,
          vaultPort: vault,
        });
      }),
      apply: trackedOperation((input) => {
        assert(JSON.stringify(input?.expectedPlan?.limits) === JSON.stringify(maintenanceLimits),
          "FAMILY_WORKSPACE_LIMIT_INVALID", "maintenance plan differs from the workspace resource policy");
        return applyAssetVaultMaintenance({
          ...input,
          referencePort: coordinator,
          vaultPort: vault,
        });
      }),
    }),
    transfer: Object.freeze({ exportComplete: trackedOperation(exportComplete) }),
  });

  return {
    publicWorkspace,
    lifecycleState,
    internals: Object.freeze({
      layout,
      repository,
      coordinator,
      vault,
      importFile,
      verifyRevisionAssets,
      restorePortable: (input) => coordinator.withReferenceMutation((port) => port.restorePortable(input)),
    }),
  };
}

/**
 * Open or create the one App-owned composition root for a Family library.
 * Mutable repository/vault/coordinator adapters stay private; callers receive
 * only use-case capabilities which all close over the same coordinator.
 */
export async function createFamilyWorkspace({
  allowedRoot,
  workspaceDirectory,
  repositoryId,
  probeCanonicalWav,
  maxImportBytes = 64 * 1024 * 1024,
  maintenanceLimits,
  capturePortFactory = null,
}) {
  assert(path.isAbsolute(workspaceDirectory ?? "") && path.isAbsolute(allowedRoot ?? ""),
    "FAMILY_WORKSPACE_ROOT_INVALID", "workspace roots must be absolute paths");
  const key = processPathKey(workspaceDirectory);
  const validatedMaintenanceLimits = validateAssetVaultLimits(maintenanceLimits);
  const configuration = {
    allowedRoot: processPathKey(allowedRoot),
    repositoryId,
    probeCanonicalWav,
    maxImportBytes,
    maintenanceLimits: JSON.stringify(validatedMaintenanceLimits),
    capturePortFactory,
  };
  const existing = OPEN_WORKSPACES.get(key);
  if (existing) {
    assert(existing.configuration.allowedRoot === configuration.allowedRoot
      && existing.configuration.repositoryId === configuration.repositoryId
      && existing.configuration.probeCanonicalWav === configuration.probeCanonicalWav
      && existing.configuration.maxImportBytes === configuration.maxImportBytes
      && existing.configuration.maintenanceLimits === configuration.maintenanceLimits
      && existing.configuration.capturePortFactory === configuration.capturePortFactory,
    "FAMILY_WORKSPACE_ALREADY_OPEN", "workspace is already open with a different composition");
    return existing.promise;
  }
  const entry = {
    configuration,
    promise: null,
    registration: null,
  };
  const promise = buildFamilyWorkspace({
    allowedRoot,
    workspaceDirectory,
    repositoryId,
    probeCanonicalWav,
    maxImportBytes,
    maintenanceLimits: validatedMaintenanceLimits,
    capturePortFactory,
    requireAbsent: false,
  }).then((built) => {
    const registration = {
      key,
      configuration,
      promise,
      capability: built.publicWorkspace,
      lifecycleState: built.lifecycleState,
      workspaceDirectory: built.lifecycleState.workspaceDirectory,
      closed: false,
    };
    entry.registration = registration;
    WORKSPACE_CAPABILITIES.set(built.publicWorkspace, registration);
    return built.publicWorkspace;
  });
  entry.promise = promise;
  OPEN_WORKSPACES.set(key, entry);
  try {
    return await promise;
  } catch (error) {
    if (OPEN_WORKSPACES.get(key)?.promise === promise) OPEN_WORKSPACES.delete(key);
    throw error;
  }
}

/**
 * Release one exact App-owned FamilyWorkspace capability after all of its
 * tracked operations are idle. The registry entry is removed only when it
 * still points at this capability, so a later reopen cannot be split from a
 * live coordinator. Paths are verification inputs only and never returned.
 */
export async function closeFamilyWorkspace({ workspace, workspaceDirectory }) {
  const registration = WORKSPACE_CAPABILITIES.get(workspace);
  assert(registration, "FAMILY_WORKSPACE_NOT_REGISTERED", "workspace capability is not registered");
  assert(path.isAbsolute(workspaceDirectory ?? "")
    && processPathKey(workspaceDirectory) === registration.key,
  "FAMILY_WORKSPACE_CLOSE_MISMATCH", "workspace capability and path do not match");
  if (registration.closed) {
    return Object.freeze({
      profile: PROFILE,
      status: "CLOSED",
      idempotent: true,
    });
  }
  const current = OPEN_WORKSPACES.get(registration.key);
  assert(current?.registration === registration && current.promise === registration.promise,
    "FAMILY_WORKSPACE_CLOSE_MISMATCH", "workspace capability is no longer the registered coordinator");
  if (registration.lifecycleState.activeOperations > 0) {
    fail("FAMILY_WORKSPACE_BUSY", "workspace has active operations", {
      activeOperations: registration.lifecycleState.activeOperations,
    });
  }
  registration.lifecycleState.closed = true;
  registration.closed = true;
  if (OPEN_WORKSPACES.get(registration.key) === current) OPEN_WORKSPACES.delete(registration.key);
  return Object.freeze({
    profile: PROFILE,
    status: "CLOSED",
    idempotent: false,
  });
}

/**
 * Import a stable Family Export v1 into a new canonical FamilyWorkspace.
 * The source export keeps its assets/<sha>.bin contract. Bytes are verified by
 * the existing inspector, reprobed, and republished into the workspace's
 * assets/sha256/<sha>.wav layout before portable repository restore commits.
 */
export async function restoreFamilyWorkspaceFromCompleteExport({
  repoRoot,
  exportDirectory,
  allowedRoot,
  workspaceDirectory,
  operationId,
  replicaInstanceId,
  restoredAt,
  limits,
  probeCanonicalWav,
  maxImportBytes = limits?.maxAssetBytes,
  maintenanceLimits,
  capturePortFactory = null,
}) {
  assertProbePort(probeCanonicalWav);
  assertImportLimit(maxImportBytes);
  const validatedMaintenanceLimits = validateAssetVaultLimits(maintenanceLimits);
  assert(path.isAbsolute(allowedRoot ?? "") && path.isAbsolute(workspaceDirectory ?? "")
    && path.isAbsolute(exportDirectory ?? ""),
  "FAMILY_WORKSPACE_ROOT_INVALID", "restore roots must be absolute paths");
  const allowed = path.resolve(allowedRoot ?? "");
  const destination = path.resolve(workspaceDirectory ?? "");
  const realAllowed = await assertRegularDirectory(
    allowed,
    "FAMILY_WORKSPACE_ROOT_INVALID",
    "allowed workspace root",
  );
  assertDirectChild(allowed, destination, "FAMILY_WORKSPACE_ROOT_INVALID", "workspace directory");
  assert(!(await optionalLstat(destination)),
    "FAMILY_WORKSPACE_OUTPUT_EXISTS", "workspace output already exists");
  const realExport = await assertRegularDirectory(
    path.resolve(exportDirectory ?? ""),
    "FAMILY_WORKSPACE_RESTORE_SOURCE_INVALID",
    "Family Export source",
  );
  const futureDestination = path.join(realAllowed, path.basename(destination));
  assert(!overlaps(realExport, futureDestination) && realAllowed !== realExport && !inside(realExport, realAllowed),
    "FAMILY_WORKSPACE_ROOT_OVERLAP", "workspace restore destination must not overlap its source export");

  const inspected = await inspectCompleteFamilyExport({ repoRoot, exportDirectory: realExport, limits });
  const staging = path.join(
    allowed,
    `.${path.basename(destination)}.family-workspace-${process.pid}-${randomUUID()}`,
  );
  assertDirectChild(allowed, staging, "FAMILY_WORKSPACE_ROOT_INVALID", "workspace staging directory");
  let created = false;
  let published = false;
  let primaryError = null;
  try {
    created = true;
    const built = await buildFamilyWorkspace({
      allowedRoot: allowed,
      workspaceDirectory: staging,
      repositoryId: inspected.manifest.repositoryId,
      probeCanonicalWav,
      maxImportBytes,
      maintenanceLimits: validatedMaintenanceLimits,
      capturePortFactory: null,
      requireAbsent: true,
    });

    const uniqueAssets = new Map();
    for (const asset of inspected.manifest.assets) uniqueAssets.set(asset.sha256, asset);
    for (const asset of uniqueAssets.values()) {
      const receipt = await built.internals.importFile({
        sourcePath: path.join(realExport, ...asset.path.split("/")),
        assetId: `restore-${asset.sha256.slice(0, 32)}`,
      });
      assert(receipt.sha256 === asset.sha256 && receipt.bytes === asset.bytes,
        "FAMILY_WORKSPACE_RESTORE_ASSET_MISMATCH", "restored canonical asset differs from Family Export", {
          assetId: asset.assetId,
          sha256: asset.sha256,
        });
    }

    const restoreReceipt = await built.internals.restorePortable({
      operationId,
      replicaInstanceId,
      backupBytes: inspected.backupBytes,
      expectedHeadRevisionId: null,
      at: restoredAt,
    });
    const state = await built.publicWorkspace.read.open();
    assert(state.headRevisionId === inspected.manifest.headRevisionId,
      "FAMILY_WORKSPACE_RESTORE_MISMATCH", "restored workspace head differs from Family Export");

    assert(!(await optionalLstat(destination)),
      "FAMILY_WORKSPACE_OUTPUT_EXISTS", "workspace output appeared during restore");
    await rename(staging, destination);
    published = true;
    created = false;

    try {
      const workspace = await createFamilyWorkspace({
        allowedRoot: allowed,
        workspaceDirectory: destination,
        repositoryId: inspected.manifest.repositoryId,
        probeCanonicalWav,
        maxImportBytes,
        maintenanceLimits: validatedMaintenanceLimits,
        capturePortFactory,
      });
      const reopened = await workspace.read.open();
      assert(reopened.headRevisionId === inspected.manifest.headRevisionId,
        "FAMILY_WORKSPACE_RESTORE_MISMATCH", "published workspace head differs after reopen");
      return Object.freeze({
        workspace,
        manifest: structuredClone(inspected.manifest),
        restoreReceipt: structuredClone(restoreReceipt),
        repositoryState: structuredClone(reopened),
        assetDigestCount: uniqueAssets.size,
      });
    } catch (error) {
      OPEN_WORKSPACES.delete(processPathKey(destination));
      try {
        await removeOwnedWorkspaceDirectory({
          allowedRoot: allowed,
          workspaceDirectory: destination,
          repositoryId: inspected.manifest.repositoryId,
          requireMarker: true,
        });
        published = false;
      } catch (cleanupError) {
        throw new FamilyWorkspaceError(
          "FAMILY_WORKSPACE_PUBLISH_CONFIGURATION_FAILED",
          "published workspace configuration failed and owned cleanup was incomplete",
          {
            causeCode: error?.code ?? error?.name ?? "UNKNOWN",
            cleanupCode: cleanupError?.code ?? cleanupError?.name ?? "UNKNOWN",
            cleanupComplete: false,
          },
        );
      }
      throw error;
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (created && !published) {
      try {
        await removeOwnedWorkspaceDirectory({
          allowedRoot: allowed,
          workspaceDirectory: staging,
          repositoryId: inspected.manifest.repositoryId,
          requireMarker: false,
        });
      } catch (cleanupError) {
        throw new FamilyWorkspaceError(
          "FAMILY_WORKSPACE_RESTORE_CLEANUP_FAILED",
          "workspace restore staging cleanup was incomplete",
          {
            causeCode: primaryError?.code ?? primaryError?.name ?? null,
            cleanupCode: cleanupError?.code ?? cleanupError?.name ?? "UNKNOWN",
            cleanupComplete: false,
          },
        );
      }
    }
  }
}
