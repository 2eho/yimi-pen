import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeBuildAuthorizationId,
  createBuildAuthorizationFromVerification,
} from "../../../contracts/family-build-plan-v1.mjs";
import { computeFamilyExportId } from "../../../contracts/family-export-v1.mjs";
import { computeFamilyRevisionId } from "../../../contracts/family-revision-v1.mjs";
import { AtomicJsonFamilyRepository } from "../../../tools/family-repository/atomic-json-adapter.mjs";
import { FamilyRepositoryError } from "../../../tools/family-repository/repository-core.mjs";
import { buildPreview } from "../../../tools/family-alpha-compiler/compiler.mjs";
import { verifyBuildPlanAssets } from "../../../tools/family-build-adapter/adapter.mjs";
import { createConfirmationTrustProvider } from "../../../tools/confirmation-trust/provider.mjs";
import { MemoryChallengeStore } from "../../../tools/confirmation-trust/replay-store.mjs";
import { loadConfirmationTrustSchemaValidator } from "../../../tools/confirmation-trust/schema-validator.mjs";
import {
  authorizedCompileDesignSnapshot,
  composeFixtureBuildPlan,
  projectAndValidateBuildPlan,
} from "./host-orchestrator.mjs";
import {
  createCompletePresentation,
  createFixtureProof,
  omitOneRequiredClip,
} from "./fixture-confirmation.mjs";
import {
  exportCompleteFamily,
  FamilyExportError,
  inspectCompleteFamilyExport,
  restoreCompleteFamily,
} from "./local-family-export.mjs";

const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-host-validation");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-host-validation.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".companion-host-validation-root");
const MARKER_TEXT = "yimi-companion-host-validation-root-v1\n";
const FAMILY_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1/golden");
const ALPHA_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const TRUST_ROOT = path.join(REPO_ROOT, "hardware/evt0/confirmation-trust-v1/golden");
const FIXED_NONCE = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
const FIXTURE_EXPORT_LIMITS = Object.freeze({
  maxManifestBytes: 256 * 1024,
  maxBackupBytes: 2 * 1024 * 1024,
  maxAssetBytes: 1024 * 1024,
  maxTotalAssetBytes: 32 * 1024 * 1024,
  maxAssetEntries: 100,
});

function clone(value) {
  return structuredClone(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  const buildInfo = await lstat(BUILD_ROOT);
  if (!buildInfo.isDirectory() || buildInfo.isSymbolicLink()) throw new Error("build/ must be a regular directory");
  const [realRepository, realBuild] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(realRepository, realBuild)) throw new Error("build/ resolved outside repository");
  try {
    return await open(LOCK_PATH, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("companion host acceptance is already running or left a stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("companion validation root must be an owned directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("companion validation root resolved outside build/");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) throw new Error("companion validation root lacks its ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { encoding: "utf8", flag: "wx" });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function alphaAssetReader(asset) {
  const candidate = path.resolve(ALPHA_ROOT, asset.path);
  if (!inside(ALPHA_ROOT, candidate)) throw new Error(`${asset.assetId} escaped the Alpha fixture root`);
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${asset.assetId} must be a regular fixture file`);
  const [realAlpha, realCandidate] = await Promise.all([realpath(ALPHA_ROOT), realpath(candidate)]);
  if (!inside(realAlpha, realCandidate)) throw new Error(`${asset.assetId} resolved outside the Alpha fixture root`);
  return readFile(realCandidate);
}

function fixtureAssetReaderById(buildPlan) {
  const assets = new Map(buildPlan.assetCatalog.assets.map((asset) => [asset.assetId, asset]));
  return async ({ assetId }) => {
    const asset = assets.get(assetId);
    if (!asset) throw new Error(`${assetId} is absent from the pinned fixture asset catalog`);
    return alphaAssetReader(asset);
  };
}

async function materializeRestoredBuildWorkspace({ buildPlan, projectedDraft, assetPathById, workspace }) {
  await mkdir(workspace);
  for (const asset of buildPlan.assetCatalog.assets) {
    const source = assetPathById[asset.assetId];
    if (!source) throw new Error(`${asset.assetId} is absent from the restored asset vault`);
    const target = path.resolve(workspace, asset.path);
    if (!inside(workspace, target)) throw new Error(`${asset.assetId} escaped the restored preview workspace`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(source), { flag: "wx" });
  }
  const draftPath = path.join(workspace, "draft.json");
  await writeFile(draftPath, `${JSON.stringify(projectedDraft, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return draftPath;
}

function mutableClock(initial) {
  let value = initial;
  return { now: () => value, set: (next) => { value = next; } };
}

async function expectRepositoryError(action, code) {
  try {
    await action();
    return false;
  } catch (error) {
    return error instanceof FamilyRepositoryError && error.code === code;
  }
}

async function runRepositoryAcceptance({ familyRevision, secondRevision }) {
  const allowedRoot = path.join(RUN_ROOT, "family-store");
  const repositoryRoot = path.join(allowedRoot, "primary");
  await mkdir(repositoryRoot, { recursive: true });
  const repository = new AtomicJsonFamilyRepository({
    repositoryId: "FAMILY-REPO-COMPANION-HOST-001",
    repositoryRoot,
    allowedRoot,
  });
  const initialized = await repository.initialize();
  const empty = await repository.open();
  const command = {
    operationId: "OP-COMPANION-COMMIT-R1",
    revision: clone(familyRevision),
    expectedHeadRevisionId: null,
    at: "2026-08-03T00:01:00Z",
  };
  const committed = await repository.commit(command);
  const outbox = await repository.readOutbox();
  const reopened = await repository.reopen();
  const reopenedState = await reopened.open();
  const loadedRevision = await reopened.loadHead();
  const beforeReplay = await reopened.stateSha256();
  const replayed = await reopened.commit(clone(command));
  const replayZeroSideEffect = beforeReplay === await reopened.stateSha256();
  const beforeCas = await reopened.stateSha256();
  const staleCasRejected = await expectRepositoryError(() => reopened.commit({
    operationId: "OP-COMPANION-STALE-R2",
    revision: clone(secondRevision),
    expectedHeadRevisionId: null,
    at: "2026-08-03T00:11:00Z",
  }), "STALE_HEAD");
  const casZeroSideEffect = beforeCas === await reopened.stateSha256();

  return {
    repository: reopened,
    loadedRevision,
    evidence: {
      initialized: initialized.status === "initialized",
      emptyWasDistinct: empty.status === "empty" && empty.headRevisionId === null,
      committed: committed.status === "committed" && committed.headRevisionId === familyRevision.revisionId,
      reopened: reopenedState.status === "ready" && reopenedState.headRevisionId === familyRevision.revisionId,
      epochStableAcrossCommitAndReopen: outbox.epoch === committed.eventEpoch
        && reopenedState.outboxEpoch === committed.eventEpoch,
      cursorMatchesEpoch: committed.eventCursor?.epoch === outbox.epoch
        && committed.eventCursor?.sequence === "1",
      replayed: replayed.status === "replayed" && replayed.replayed === true,
      replayCursorStable: replayed.eventCursor?.epoch === committed.eventCursor?.epoch
        && replayed.eventCursor?.sequence === committed.eventCursor?.sequence,
      replayZeroSideEffect,
      staleCasRejected,
      casZeroSideEffect,
      outboxEventCount: outbox.events.length,
      outboxEpoch: outbox.epoch,
    },
  };
}

async function expectAuthorizationFailure({
  id,
  expectedCode,
  baseInput,
  mutateInput,
  now = "2026-08-03T00:05:03Z",
}) {
  const input = clone(baseInput);
  mutateInput(input);
  const sideEffectRoot = path.join(RUN_ROOT, "negative-output", id);
  const outputDirectory = path.join(sideEffectRoot, "nested", "snapshot");
  let actualCode = null;
  try {
    await authorizedCompileDesignSnapshot({
      ...input,
      now,
      outputDirectory,
    });
  } catch (error) {
    actualCode = error?.code ?? error?.name ?? "UNKNOWN";
  }
  const outputParentAbsent = !(await exists(sideEffectRoot));
  return {
    id,
    passed: actualCode === expectedCode && outputParentAbsent,
    expectedCode,
    actualCode,
    outputParentAbsent,
  };
}

async function expectFamilyRestoreFailure({
  id,
  exportDirectory,
  allowedRoot,
  expectedCode,
  operationId,
  replicaInstanceId,
  restoredAt,
}) {
  await mkdir(allowedRoot);
  const destinationDirectory = path.join(allowedRoot, "must-stay-absent");
  let actualCode = null;
  try {
    await restoreCompleteFamily({
      repoRoot: REPO_ROOT,
      exportDirectory,
      allowedDestinationRoot: allowedRoot,
      destinationDirectory,
      operationId,
      replicaInstanceId,
      restoredAt,
      limits: FIXTURE_EXPORT_LIMITS,
    });
  } catch (error) {
    actualCode = error instanceof FamilyExportError ? error.code : error?.code ?? error?.name ?? "UNKNOWN";
  }
  const outputAbsent = !(await exists(destinationDirectory));
  const stagingAbsent = (await readdir(allowedRoot)).length === 0;
  return {
    id,
    passed: actualCode === expectedCode && outputAbsent && stagingAbsent,
    expectedCode,
    actualCode,
    outputAbsent,
    stagingAbsent,
  };
}

async function runAcceptance() {
  await prepareRunRoot();
  const [familyRevision, secondRevision, pinnedFixtureTarget, confirmation, policy] = await Promise.all([
    readJson(path.join(FAMILY_ROOT, "family-revision.json")),
    readJson(path.join(FAMILY_ROOT, "family-revision-2.json")),
    readJson(path.join(FAMILY_ROOT, "build-plan.json")),
    readJson(path.join(ALPHA_ROOT, "confirmation.json")),
    readJson(path.join(TRUST_ROOT, "trust-policy.json")),
  ]);

  const repository = await runRepositoryAcceptance({ familyRevision, secondRevision });
  const buildPlan = await composeFixtureBuildPlan({
    familyRevision: repository.loadedRevision,
    pinnedFixtureTarget,
  });
  const projectedFirst = await projectAndValidateBuildPlan({
    familyRevision: repository.loadedRevision,
    buildPlan,
  });
  const projectedSecond = await projectAndValidateBuildPlan({
    familyRevision: clone(repository.loadedRevision),
    buildPlan: clone(buildPlan),
  });
  const verifiedAssets = await verifyBuildPlanAssets({ buildPlan, assetReader: alphaAssetReader });

  const workspace = path.join(RUN_ROOT, "workspace");
  await mkdir(workspace);
  await cp(path.join(ALPHA_ROOT, "assets"), path.join(workspace, "assets"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const draftPath = path.join(workspace, "draft.json");
  const confirmationPath = path.join(workspace, "confirmation.json");
  await writeFile(draftPath, `${JSON.stringify(projectedFirst.draft, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await writeFile(confirmationPath, `${JSON.stringify(confirmation, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const { preview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath });

  const exportAllowedRoot = path.join(RUN_ROOT, "family-exports");
  const exportDirectory = path.join(exportAllowedRoot, "family-alpha");
  await mkdir(exportAllowedRoot);
  const familyExport = await exportCompleteFamily({
    repoRoot: REPO_ROOT,
    repository: repository.repository,
    assetReader: fixtureAssetReaderById(buildPlan),
    allowedOutputRoot: exportAllowedRoot,
    outputDirectory: exportDirectory,
    createdAt: "2026-08-03T00:15:00Z",
    limits: FIXTURE_EXPORT_LIMITS,
  });
  const inspectedExport = await inspectCompleteFamilyExport({
    repoRoot: REPO_ROOT,
    exportDirectory,
    limits: FIXTURE_EXPORT_LIMITS,
  });

  const restoreAllowedRoot = path.join(RUN_ROOT, "family-restores");
  const restoreDirectory = path.join(restoreAllowedRoot, "clean-family");
  await mkdir(restoreAllowedRoot);
  const restored = await restoreCompleteFamily({
    repoRoot: REPO_ROOT,
    exportDirectory,
    allowedDestinationRoot: restoreAllowedRoot,
    destinationDirectory: restoreDirectory,
    operationId: "OP-COMPANION-RESTORE-001",
    replicaInstanceId: "REPLICA-COMPANION-CLEAN-001",
    restoredAt: "2026-08-03T00:20:00Z",
    limits: FIXTURE_EXPORT_LIMITS,
  });
  const restoredRevision = await restored.repository.loadHead();
  const restoredBuildPlan = await composeFixtureBuildPlan({
    familyRevision: restoredRevision,
    pinnedFixtureTarget,
  });
  const restoredProjection = await projectAndValidateBuildPlan({
    familyRevision: restoredRevision,
    buildPlan: restoredBuildPlan,
  });
  const restoredDraftPath = await materializeRestoredBuildWorkspace({
    buildPlan: restoredBuildPlan,
    projectedDraft: restoredProjection.draft,
    assetPathById: restored.assetPathById,
    workspace: path.join(RUN_ROOT, "restored-preview-workspace"),
  });
  const { preview: restoredPreview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath: restoredDraftPath });
  const restoredAssetChecks = await Promise.all(buildPlan.assetCatalog.assets.map(async (asset) => {
    const restoredBytes = await readFile(restored.assetPathById[asset.assetId]);
    return restoredBytes.length === asset.bytes && sha256(restoredBytes) === asset.sha256;
  }));

  const tamperedExportDirectory = path.join(exportAllowedRoot, "family-alpha-tampered");
  await cp(exportDirectory, tamperedExportDirectory, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const tamperedAsset = familyExport.assets[0];
  const tamperedAssetPath = path.resolve(tamperedExportDirectory, ...tamperedAsset.path.split("/"));
  if (!inside(tamperedExportDirectory, tamperedAssetPath)) throw new Error("tampered fixture asset escaped its export root");
  const tamperedBytes = Buffer.from(await readFile(tamperedAssetPath));
  tamperedBytes[0] ^= 0xff;
  await writeFile(tamperedAssetPath, tamperedBytes);
  const exportNegativeScenarios = [];
  exportNegativeScenarios.push(await expectFamilyRestoreFailure({
    id: "EXPORT-NEG-01-tampered-asset-bytes",
    exportDirectory: tamperedExportDirectory,
    allowedRoot: path.join(RUN_ROOT, "negative-restore-bytes"),
    expectedCode: "EXPORT_ASSET_BYTES_MISMATCH",
    operationId: "OP-COMPANION-RESTORE-TAMPERED-001",
    replicaInstanceId: "REPLICA-COMPANION-TAMPERED-001",
    restoredAt: "2026-08-03T00:21:00Z",
  }));

  const pathTamperedExportDirectory = path.join(exportAllowedRoot, "family-alpha-path-tampered");
  await cp(exportDirectory, pathTamperedExportDirectory, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const pathTamperedManifestPath = path.join(pathTamperedExportDirectory, "manifest.json");
  const pathTamperedManifest = await readJson(pathTamperedManifestPath);
  const originalPath = pathTamperedManifest.assets[0].path;
  const wrongPathDigest = pathTamperedManifest.assets[0].sha256 === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64);
  const wrongPath = `assets/${wrongPathDigest}.bin`;
  await rename(
    path.resolve(pathTamperedExportDirectory, ...originalPath.split("/")),
    path.resolve(pathTamperedExportDirectory, ...wrongPath.split("/")),
  );
  pathTamperedManifest.assets[0].path = wrongPath;
  pathTamperedManifest.exportId = computeFamilyExportId(pathTamperedManifest);
  await writeFile(pathTamperedManifestPath, `${JSON.stringify(pathTamperedManifest, null, 2)}\n`, "utf8");
  exportNegativeScenarios.push(await expectFamilyRestoreFailure({
    id: "EXPORT-NEG-02-path-must-match-content-hash",
    exportDirectory: pathTamperedExportDirectory,
    allowedRoot: path.join(RUN_ROOT, "negative-restore-path"),
    expectedCode: "EXPORT_IDENTITY_INVALID",
    operationId: "OP-COMPANION-RESTORE-PATH-001",
    replicaInstanceId: "REPLICA-COMPANION-PATH-001",
    restoredAt: "2026-08-03T00:22:00Z",
  }));

  const extraFileExportDirectory = path.join(exportAllowedRoot, "family-alpha-extra-file");
  await cp(exportDirectory, extraFileExportDirectory, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await writeFile(path.join(extraFileExportDirectory, "undeclared-private-data.bin"), Buffer.from([1, 2, 3]), { flag: "wx" });
  exportNegativeScenarios.push(await expectFamilyRestoreFailure({
    id: "EXPORT-NEG-03-exact-file-closure",
    exportDirectory: extraFileExportDirectory,
    allowedRoot: path.join(RUN_ROOT, "negative-restore-extra"),
    expectedCode: "EXPORT_FILE_CLOSURE_MISMATCH",
    operationId: "OP-COMPANION-RESTORE-EXTRA-001",
    replicaInstanceId: "REPLICA-COMPANION-EXTRA-001",
    restoredAt: "2026-08-03T00:23:00Z",
  }));

  let overlapRestoreCode = null;
  const overlapDestination = path.join(exportDirectory, "must-stay-absent");
  try {
    await restoreCompleteFamily({
      repoRoot: REPO_ROOT,
      exportDirectory,
      allowedDestinationRoot: exportDirectory,
      destinationDirectory: overlapDestination,
      operationId: "OP-COMPANION-RESTORE-OVERLAP-001",
      replicaInstanceId: "REPLICA-COMPANION-OVERLAP-001",
      restoredAt: "2026-08-03T00:24:00Z",
      limits: FIXTURE_EXPORT_LIMITS,
    });
  } catch (error) {
    overlapRestoreCode = error instanceof FamilyExportError ? error.code : error?.code ?? error?.name ?? "UNKNOWN";
  }
  const overlapZeroSideEffect = !(await exists(overlapDestination));
  exportNegativeScenarios.push({
    id: "EXPORT-NEG-04-source-destination-overlap",
    passed: overlapRestoreCode === "EXPORT_ROOT_OVERLAP" && overlapZeroSideEffect,
    expectedCode: "EXPORT_ROOT_OVERLAP",
    actualCode: overlapRestoreCode,
    outputAbsent: overlapZeroSideEffect,
    stagingAbsent: overlapZeroSideEffect,
  });
  const sourceExportAfterNegatives = await inspectCompleteFamilyExport({
    repoRoot: REPO_ROOT,
    exportDirectory,
    limits: FIXTURE_EXPORT_LIMITS,
  });
  const sourceOutbox = await repository.repository.readOutbox();
  const restoredOutbox = await restored.repository.readOutbox();

  const versionedAssetDescriptor = buildPlan.assetCatalog.assets.find(
    (asset) => asset.assetId === familyRevision.bindings[0].clips[0].assetId,
  );
  const versionedAssetBytes = Buffer.from(await alphaAssetReader(versionedAssetDescriptor));
  versionedAssetBytes[versionedAssetBytes.length - 1] ^= 0x5a;
  const versionedAssetSha256 = sha256(versionedAssetBytes);
  const versionedRevision = clone(secondRevision);
  versionedRevision.bindings[0].clips[0].assetSha256 = versionedAssetSha256;
  versionedRevision.bindings[0].clips[0].assetBytes = versionedAssetBytes.length;
  versionedRevision.revisionId = computeFamilyRevisionId(versionedRevision);
  const versionedStoreAllowedRoot = path.join(RUN_ROOT, "versioned-history-store");
  const versionedRepositoryRoot = path.join(versionedStoreAllowedRoot, "primary");
  await mkdir(versionedRepositoryRoot, { recursive: true });
  const versionedRepository = new AtomicJsonFamilyRepository({
    repositoryId: "FAMILY-REPO-COMPANION-VERSIONED-001",
    repositoryRoot: versionedRepositoryRoot,
    allowedRoot: versionedStoreAllowedRoot,
  });
  await versionedRepository.initialize();
  await versionedRepository.commit({
    operationId: "OP-VERSIONED-HISTORY-R1",
    revision: clone(familyRevision),
    expectedHeadRevisionId: null,
    at: "2026-08-03T00:01:00Z",
  });
  await versionedRepository.commit({
    operationId: "OP-VERSIONED-HISTORY-R2",
    revision: versionedRevision,
    expectedHeadRevisionId: familyRevision.revisionId,
    at: "2026-08-03T00:12:00Z",
  });
  const fixtureAssetsByIdentity = new Map(buildPlan.assetCatalog.assets.map((asset) => [
    `${asset.assetId}@${asset.sha256}`,
    asset,
  ]));
  const versionedExportDirectory = path.join(exportAllowedRoot, "family-versioned-history");
  const versionedExport = await exportCompleteFamily({
    repoRoot: REPO_ROOT,
    repository: versionedRepository,
    assetReader: async (reference) => {
      if (reference.assetId === versionedAssetDescriptor.assetId && reference.sha256 === versionedAssetSha256) {
        return versionedAssetBytes;
      }
      const fixtureAsset = fixtureAssetsByIdentity.get(`${reference.assetId}@${reference.sha256}`);
      if (!fixtureAsset) throw new Error(`${reference.assetId}@${reference.sha256} is absent from versioned fixtures`);
      return alphaAssetReader(fixtureAsset);
    },
    allowedOutputRoot: exportAllowedRoot,
    outputDirectory: versionedExportDirectory,
    createdAt: "2026-08-03T00:25:00Z",
    limits: FIXTURE_EXPORT_LIMITS,
  });
  const versionedRestoreAllowedRoot = path.join(RUN_ROOT, "versioned-history-restore");
  const versionedRestoreDirectory = path.join(versionedRestoreAllowedRoot, "clean-family");
  await mkdir(versionedRestoreAllowedRoot);
  const versionedRestored = await restoreCompleteFamily({
    repoRoot: REPO_ROOT,
    exportDirectory: versionedExportDirectory,
    allowedDestinationRoot: versionedRestoreAllowedRoot,
    destinationDirectory: versionedRestoreDirectory,
    operationId: "OP-VERSIONED-HISTORY-RESTORE-001",
    replicaInstanceId: "REPLICA-COMPANION-VERSIONED-001",
    restoredAt: "2026-08-03T00:26:00Z",
    limits: FIXTURE_EXPORT_LIMITS,
  });
  const versionedRestoredRevision = await versionedRestored.repository.loadHead();
  const restoredVersionedBytes = await readFile(versionedRestored.assetPathById[versionedAssetDescriptor.assetId]);
  const repeatedAssetVersions = versionedExport.assets.filter(
    (asset) => asset.assetId === versionedAssetDescriptor.assetId,
  );
  const existingOutputManifestBefore = await readFile(path.join(exportDirectory, "manifest.json"));
  let existingOutputCode = null;
  try {
    await exportCompleteFamily({
      repoRoot: REPO_ROOT,
      repository: repository.repository,
      assetReader: fixtureAssetReaderById(buildPlan),
      allowedOutputRoot: exportAllowedRoot,
      outputDirectory: exportDirectory,
      createdAt: "2026-08-03T00:27:00Z",
      limits: FIXTURE_EXPORT_LIMITS,
    });
  } catch (error) {
    existingOutputCode = error instanceof FamilyExportError ? error.code : error?.code ?? error?.name ?? "UNKNOWN";
  }
  const existingOutputManifestAfter = await readFile(path.join(exportDirectory, "manifest.json"));
  const existingOutputResidue = (await readdir(exportAllowedRoot)).filter(
    (entry) => entry.startsWith(`${path.basename(exportDirectory)}.tmp-`),
  );
  exportNegativeScenarios.push({
    id: "EXPORT-NEG-05-existing-output-preserved",
    passed: existingOutputCode === "EXPORT_OUTPUT_EXISTS"
      && existingOutputManifestBefore.equals(existingOutputManifestAfter)
      && existingOutputResidue.length === 0,
    expectedCode: "EXPORT_OUTPUT_EXISTS",
    actualCode: existingOutputCode,
    outputAbsent: false,
    existingOutputPreserved: existingOutputManifestBefore.equals(existingOutputManifestAfter),
    stagingAbsent: existingOutputResidue.length === 0,
  });
  let resourceLimitCode = null;
  try {
    await inspectCompleteFamilyExport({
      repoRoot: REPO_ROOT,
      exportDirectory,
      limits: { ...FIXTURE_EXPORT_LIMITS, maxManifestBytes: 1 },
    });
  } catch (error) {
    resourceLimitCode = error instanceof FamilyExportError ? error.code : error?.code ?? error?.name ?? "UNKNOWN";
  }
  exportNegativeScenarios.push({
    id: "EXPORT-NEG-06-resource-policy-before-read",
    passed: resourceLimitCode === "EXPORT_RESOURCE_LIMIT_EXCEEDED",
    expectedCode: "EXPORT_RESOURCE_LIMIT_EXCEEDED",
    actualCode: resourceLimitCode,
    outputAbsent: true,
    stagingAbsent: true,
  });

  const contracts = await loadConfirmationTrustSchemaValidator(REPO_ROOT);
  const store = new MemoryChallengeStore();
  const clock = mutableClock("2026-08-03T00:04:10Z");
  const provider = createConfirmationTrustProvider({
    policy,
    challengeStore: store,
    clock,
    nonceSource: () => FIXED_NONCE,
    authorityResolver: async () => clone(policy.authorities[0]),
    contractValidator: contracts,
  });
  const challenge = await provider.issueChallenge({
    buildPlan,
    preview,
    familyLibraryId: repository.loadedRevision.familyLibraryId,
    authoritySessionRef: "fixture-session",
    operationId: "op:companion-issue-001",
  });
  const presentationTranscript = createCompletePresentation({ challenge, preview, confirmation });
  const incompleteTranscript = omitOneRequiredClip(presentationTranscript);
  const incompleteProof = createFixtureProof({
    policy,
    challenge,
    presentationTranscript: incompleteTranscript,
    confirmation,
  });
  const ledgerBeforeIncomplete = JSON.stringify(await store.snapshot());
  let incompleteConfirmationCode = null;
  clock.set("2026-08-03T00:05:02Z");
  try {
    await provider.verifyAndConsume({
      proof: incompleteProof,
      buildPlan,
      preview,
      presentationTranscript: incompleteTranscript,
      confirmation,
      operationId: "op:companion-incomplete-001",
    });
  } catch (error) {
    incompleteConfirmationCode = error?.code ?? error?.name ?? "UNKNOWN";
  }
  const incompleteZeroSideEffect = ledgerBeforeIncomplete === JSON.stringify(await store.snapshot());
  const incompleteCompilerOutputAbsent = !(await exists(path.join(RUN_ROOT, "snapshot")));

  const proof = createFixtureProof({ policy, challenge, presentationTranscript, confirmation });
  const verificationResult = await provider.verifyAndConsume({
    proof,
    buildPlan,
    preview,
    presentationTranscript,
    confirmation,
    operationId: "op:companion-consume-001",
  });
  const buildAuthorization = createBuildAuthorizationFromVerification({ verificationResult, proof });

  const baseCompileInput = {
    repoRoot: REPO_ROOT,
    familyRevision: repository.loadedRevision,
    buildPlan,
    projectedDraft: projectedFirst.draft,
    preview,
    confirmation,
    presentationTranscript,
    proof,
    verificationResult,
    buildAuthorization,
    draftPath,
    confirmationPath,
  };
  const negativeScenarios = [];
  negativeScenarios.push(await expectAuthorizationFailure({
    id: "NEG-01-bad-authorization-id",
    expectedCode: "AUTHORIZATION_IDENTITY_INVALID",
    baseInput: baseCompileInput,
    mutateInput: (input) => { input.buildAuthorization.authorizationId = `authorization:sha256:${"0".repeat(64)}`; },
  }));
  negativeScenarios.push(await expectAuthorizationFailure({
    id: "NEG-02-expired-authorization",
    expectedCode: "AUTHORIZATION_EXPIRED",
    baseInput: baseCompileInput,
    mutateInput: (input) => {
      input.buildAuthorization.authorizationExpiresAt = "2026-08-03T00:05:03Z";
      input.buildAuthorization.authorizationId = computeBuildAuthorizationId(input.buildAuthorization);
    },
  }));
  negativeScenarios.push(await expectAuthorizationFailure({
    id: "NEG-03-wrong-build-plan",
    expectedCode: "AUTHORIZATION_BINDING_MISMATCH",
    baseInput: baseCompileInput,
    mutateInput: (input) => {
      input.buildAuthorization.buildPlanId = "PLAN-DIFFERENT-FIXTURE-001";
      input.buildAuthorization.authorizationId = computeBuildAuthorizationId(input.buildAuthorization);
    },
  }));
  negativeScenarios.push(await expectAuthorizationFailure({
    id: "NEG-04-wrong-family-revision",
    expectedCode: "AUTHORIZATION_BINDING_MISMATCH",
    baseInput: baseCompileInput,
    mutateInput: (input) => {
      input.buildAuthorization.familyRevisionId = `sha256:${"0".repeat(64)}`;
      input.buildAuthorization.authorizationId = computeBuildAuthorizationId(input.buildAuthorization);
    },
  }));
  negativeScenarios.push(await expectAuthorizationFailure({
    id: "NEG-05-missing-authorization",
    expectedCode: "AUTHORIZATION_REQUIRED",
    baseInput: baseCompileInput,
    mutateInput: (input) => { delete input.buildAuthorization; },
  }));
  negativeScenarios.push(await expectAuthorizationFailure({
    id: "NEG-06-wrong-preview",
    expectedCode: "AUTHORIZATION_BINDING_MISMATCH",
    baseInput: baseCompileInput,
    mutateInput: (input) => { input.preview.previewId = `sha256:${"0".repeat(64)}`; },
  }));

  const outputDirectory = path.join(RUN_ROOT, "snapshot");
  const compileReport = await authorizedCompileDesignSnapshot({
    ...baseCompileInput,
    now: "2026-08-03T00:05:03Z",
    outputDirectory,
  });
  const manifest = await readJson(path.join(outputDirectory, "manifest.json"));
  const requiredClipIds = preview.bindings.flatMap((binding) => binding.clips.map((clip) => clip.clipId));
  const playedClipIds = presentationTranscript.events
    .filter((event) => event.kind === "CLIP_PLAYBACK_COMPLETED")
    .map((event) => event.clipId);
  const expectedExportAssetIds = buildPlan.assetCatalog.assets.map((asset) => asset.assetId).sort();
  const actualExportAssetIds = familyExport.assets.map((asset) => asset.assetId).sort();

  const gates = {
    repositoryInitialized: repository.evidence.initialized,
    repositoryCommitReopen: repository.evidence.committed && repository.evidence.reopened,
    repositoryEpochCursor: repository.evidence.epochStableAcrossCommitAndReopen
      && repository.evidence.cursorMatchesEpoch,
    repositoryReplay: repository.evidence.replayed
      && repository.evidence.replayCursorStable
      && repository.evidence.replayZeroSideEffect,
    repositoryCas: repository.evidence.staleCasRejected && repository.evidence.casZeroSideEffect,
    buildPlanMatchesPinnedGolden: JSON.stringify(buildPlan) === JSON.stringify(pinnedFixtureTarget),
    buildPlanProjectionDeterministic: JSON.stringify(projectedFirst) === JSON.stringify(projectedSecond),
    buildPlanAssetsVerified: verifiedAssets.length === buildPlan.assetCatalog.assets.length,
    previewBoundToBuildPlan: preview.sourceSha256 === buildPlan.expectedProjection.sourceSha256,
    completeFamilyExportIdentityValid: familyExport.exportId === computeFamilyExportId(familyExport)
      && inspectedExport.manifest.exportId === familyExport.exportId,
    completeFamilyExportClosesRepositoryAndAssets: inspectedExport.backup.state.headRevisionId
      === repository.loadedRevision.revisionId
      && JSON.stringify(actualExportAssetIds) === JSON.stringify(expectedExportAssetIds)
      && inspectedExport.assetBlobCount === new Set(familyExport.assets.map((asset) => asset.path)).size,
    cleanRestoreHeadEquivalent: restored.repositoryState.headRevisionId === repository.loadedRevision.revisionId
      && JSON.stringify(restoredRevision) === JSON.stringify(repository.loadedRevision),
    cleanRestoreAssetsEquivalent: restoredAssetChecks.length === buildPlan.assetCatalog.assets.length
      && restoredAssetChecks.every(Boolean),
    cleanRestorePreviewEquivalent: JSON.stringify(restoredBuildPlan) === JSON.stringify(buildPlan)
      && JSON.stringify(restoredProjection) === JSON.stringify(projectedFirst)
      && JSON.stringify(restoredPreview) === JSON.stringify(preview),
    portableRestoreCursorIsolated: sourceOutbox.epoch !== restoredOutbox.epoch
      && restoredOutbox.events.length === 1
      && restoredOutbox.events[0]?.sequence === "1"
      && restoredOutbox.events[0]?.kind === "RESTORE_COMPLETED",
    exportNegativesRejectedZeroSideEffect: exportNegativeScenarios.every((scenario) => scenario.passed),
    sourceExportPreservedAfterNegatives: sourceExportAfterNegatives.manifest.exportId === familyExport.exportId,
    historicalAssetIdVersionsPortable: repeatedAssetVersions.length === 2
      && new Set(repeatedAssetVersions.map((asset) => asset.sha256)).size === 2
      && JSON.stringify(versionedRestoredRevision) === JSON.stringify(versionedRevision)
      && sha256(restoredVersionedBytes) === versionedAssetSha256
      && Boolean(versionedRestored.assetPathByIdentity[`${versionedAssetDescriptor.assetId}@${versionedAssetDescriptor.sha256}`])
      && Boolean(versionedRestored.assetPathByIdentity[`${versionedAssetDescriptor.assetId}@${versionedAssetSha256}`]),
    allRequiredClipsPlayedExactlyOnce: JSON.stringify(playedClipIds) === JSON.stringify(requiredClipIds),
    earlyConfirmationRejected: incompleteConfirmationCode === "CONFIRMATION_PRESENTATION_INCOMPLETE"
      && incompleteZeroSideEffect
      && incompleteCompilerOutputAbsent,
    fixtureProofVerified: verificationResult.verified === true && verificationResult.productionEligible === false,
    buildAuthorizationIssued: buildAuthorization.authorizationId === computeBuildAuthorizationId(buildAuthorization),
    rejectedAuthorizationHasZeroOutputSideEffect: negativeScenarios.every((scenario) => scenario.passed),
    compilerDispatchedAfterAuthorization: compileReport.confirmationId === buildAuthorization.confirmationId,
    designSnapshotProduced: compileReport.snapshotId.startsWith("design:")
      && manifest.snapshotId === compileReport.snapshotId,
    deviceLinkProductInstallNotEntered: manifest.releaseState === "design-fixture",
  };
  const failures = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const report = {
    schemaVersion: 1,
    profile: "companion-host-acceptance-v1",
    fixtureOnly: true,
    scope: {
      familyOwnerCount: 1,
      repositoryAdapter: "AtomicJsonFamilyRepository",
      sqliteIncluded: false,
      cloudAccountsIncluded: false,
      productionKeyIncluded: false,
      realUsbIncluded: false,
      deviceLinkProductInstallAttempted: false,
      completeFamilyExportIncluded: true,
      actualPlaybackCallbackIncluded: false,
    },
    repository: repository.evidence,
    build: {
      familyRevisionId: repository.loadedRevision.revisionId,
      buildPlanId: buildPlan.buildPlanId,
      buildSubjectSha256: buildPlan.buildSubjectSha256,
      projectionSourceSha256: projectedFirst.projectionSha256,
      previewId: preview.previewId,
      bindingCount: preview.summary.bindingCount,
      clipCount: preview.summary.clipCount,
      verifiedAssetCount: verifiedAssets.length,
    },
    familyExport: {
      exportId: familyExport.exportId,
      outputDirectory: "build/companion-host-validation/family-exports/family-alpha",
      repositoryBackupId: familyExport.repositoryBackup.backupId,
      repositoryBackupSha256: familyExport.repositoryBackup.sha256,
      assetReferenceCount: familyExport.assets.length,
      uniqueAssetBlobCount: inspectedExport.assetBlobCount,
      restoredHeadRevisionId: restored.repositoryState.headRevisionId,
      restoredPreviewId: restoredPreview.previewId,
      sourceOutboxEpoch: sourceOutbox.epoch,
      restoredOutboxEpoch: restoredOutbox.epoch,
      negativeSummary: {
        total: exportNegativeScenarios.length,
        passed: exportNegativeScenarios.filter((scenario) => scenario.passed).length,
      },
      negativeScenarios: exportNegativeScenarios,
      historicalAssetVersionScenario: {
        exportId: versionedExport.exportId,
        repeatedAssetId: versionedAssetDescriptor.assetId,
        exportedIdentityCount: repeatedAssetVersions.length,
        exportedBlobCount: new Set(versionedExport.assets.map((asset) => asset.path)).size,
        restoredHeadRevisionId: versionedRestoredRevision.revisionId,
        restoredHeadAssetSha256: sha256(restoredVersionedBytes),
      },
    },
    confirmation: {
      challengeId: challenge.challengeId,
      presentationTranscriptSha256: presentationTranscript.transcriptSha256,
      requiredClipCount: requiredClipIds.length,
      playedClipCount: playedClipIds.length,
      incompleteConfirmationCode,
      incompleteZeroSideEffect,
      incompleteCompilerOutputAbsent,
      proofId: proof.proofId,
      verificationId: verificationResult.verificationId,
      authorizationId: buildAuthorization.authorizationId,
      authorizationExpiresAt: buildAuthorization.authorizationExpiresAt,
    },
    compile: {
      snapshotId: compileReport.snapshotId,
      releaseState: compileReport.releaseState,
      outputDirectory: "build/companion-host-validation/snapshot",
      requiredBytes: compileReport.requiredBytes,
      manifestSha256: compileReport.manifestSha256,
    },
    negativeSummary: {
      total: negativeScenarios.length,
      passed: negativeScenarios.filter((scenario) => scenario.passed).length,
      outputParentAbsent: negativeScenarios.filter((scenario) => scenario.outputParentAbsent).length,
    },
    negativeScenarios,
    gates,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes, { flag: "wx" });
  console.log(`Companion host repository: ${repository.evidence.committed && repository.evidence.reopened ? "PASS" : "FAIL"}`);
  console.log(`Companion host complete family export: ${familyExport.exportId}`);
  console.log(`Companion host clean restore preview: ${restoredPreview.previewId}`);
  console.log(`Companion host export negatives: ${report.familyExport.negativeSummary.passed}/${report.familyExport.negativeSummary.total}`);
  console.log(`Companion host authorization negatives: ${report.negativeSummary.passed}/${report.negativeSummary.total}`);
  console.log(`Companion host Snapshot: ${compileReport.snapshotId}`);
  console.log(`Companion host report SHA-256: ${sha256(reportBytes)}`);
  if (failures.length) throw new Error(`companion host acceptance gates failed: ${failures.join(", ")}`);
}

const lock = await acquireLock();
try {
  await runAcceptance();
} finally {
  try { await lock.close(); } catch { /* result above remains authoritative */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* result above remains authoritative */ }
}
