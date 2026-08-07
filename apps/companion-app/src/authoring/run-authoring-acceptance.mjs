import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFamilyRevisionId } from "../../../../contracts/family-revision-v1.mjs";
import { buildPreview } from "../../../../tools/family-alpha-compiler/compiler.mjs";
import { verifyBuildPlanAssets } from "../../../../tools/family-build-adapter/adapter.mjs";
import { MemoryFamilyRepository } from "../../../../tools/family-repository/memory-adapter.mjs";
import {
  composeFixtureBuildPlan,
  projectAndValidateBuildPlan,
} from "../host-orchestrator.mjs";
import {
  importCanonicalWav,
  resolveVerifiedPreviewClip,
} from "../prelisten/local-audio-assets.mjs";
import {
  createAudioPlayerPrelistenPort,
  createPrelistenPresentationSession,
} from "../prelisten/presentation-session.mjs";
import {
  FamilyAuthoringError,
  commitImportedClipReplacement,
  extendFixtureTargetWithImportedAsset,
} from "./family-authoring-use-case.mjs";
import { materializeBuildPlanWorkspace } from "./local-authoring-workspace.mjs";

const APP_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-authoring-validation");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-authoring-validation.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".companion-authoring-validation-root");
const MARKER_TEXT = "yimi-companion-authoring-validation-root-v1\n";
const FAMILY_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1/golden");
const ALPHA_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const FIXTURE_BASE_CREATED_AT = "2026-08-04T00:00:00Z";
const AUTHORING_CREATED_AT = "2026-08-04T00:01:00Z";
const AUTHORING_COMMITTED_AT = "2026-08-04T00:01:01Z";
const PRESENTATION_OPENED_AT = "2026-08-04T00:02:00Z";

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
  if (!buildInfo.isDirectory() || buildInfo.isSymbolicLink()) {
    throw new Error("build/ must be a regular directory");
  }
  const [realRepository, realBuild] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(realRepository, realBuild)) throw new Error("build/ resolved outside repository");
  try {
    return await open(LOCK_PATH, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("companion authoring acceptance is already running or left a stale lock");
    }
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) {
      throw new Error("authoring validation root must be an owned directory");
    }
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("authoring validation root resolved outside build/");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) {
      throw new Error("authoring validation root lacks its ownership marker");
    }
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { encoding: "utf8", flag: "wx" });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function codeOf(error) {
  return error?.code ?? error?.name ?? "UNKNOWN";
}

/**
 * A deliberately small canonical WAV probe for this fixture-only vertical
 * slice. It reads the actual imported bytes, checks the precise PCM profile,
 * and derives duration exclusively from the data chunk / byte rate.
 */
async function probeCanonicalWav(filePath) {
  const bytes = Buffer.from(await readFile(filePath));
  if (bytes.length < 44
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("fixture WAV has no RIFF/WAVE header");
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error("fixture WAV RIFF length differs from file length");
  }
  let offset = 12;
  let format = null;
  let dataLength = null;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > bytes.length) throw new Error("fixture WAV chunk exceeds file length");
    if (chunkId === "fmt ") {
      if (format !== null || chunkLength !== 16) throw new Error("fixture WAV fmt chunk is not canonical PCM");
      format = {
        audioFormat: bytes.readUInt16LE(dataStart),
        channels: bytes.readUInt16LE(dataStart + 2),
        sampleRate: bytes.readUInt32LE(dataStart + 4),
        byteRate: bytes.readUInt32LE(dataStart + 8),
        blockAlign: bytes.readUInt16LE(dataStart + 12),
        bitsPerSample: bytes.readUInt16LE(dataStart + 14),
      };
    } else if (chunkId === "data") {
      if (dataLength !== null) throw new Error("fixture WAV has more than one data chunk");
      dataLength = chunkLength;
    } else {
      throw new Error(`fixture WAV has unsupported canonical chunk ${JSON.stringify(chunkId)}`);
    }
    offset = dataEnd + (chunkLength % 2);
  }
  if (offset !== bytes.length || !format || dataLength === null) {
    throw new Error("fixture WAV chunks are incomplete");
  }
  const expectedByteRate = 16_000 * 1 * 2;
  if (format.audioFormat !== 1
    || format.channels !== 1
    || format.sampleRate !== 16_000
    || format.byteRate !== expectedByteRate
    || format.blockAlign !== 2
    || format.bitsPerSample !== 16
    || dataLength === 0
    || dataLength % format.blockAlign !== 0) {
    throw new Error("fixture WAV is outside WAV_PCM16_16K_MONO");
  }
  const numerator = dataLength * 1_000;
  if (numerator % format.byteRate !== 0) throw new Error("fixture WAV duration is not integral milliseconds");
  return Object.freeze({
    codecProfile: "WAV_PCM16_16K_MONO",
    durationMs: numerator / format.byteRate,
  });
}

async function expectAuthoringFailure(action, expectedCode) {
  try {
    await action();
    return { code: null, stableClass: false };
  } catch (error) {
    return {
      code: codeOf(error),
      stableClass: error instanceof FamilyAuthoringError,
    };
  }
}

function authoringCommand({ repository, expectedHeadRevisionId, operationId, importedAsset, contentRevision }) {
  return {
    repository,
    operationId,
    expectedHeadRevisionId,
    createdAt: AUTHORING_CREATED_AT,
    committedAt: AUTHORING_COMMITTED_AT,
    contentRevision,
    bindingId: "binding-013",
    clipId: "clip-013-1",
    importedAsset,
    clipMetadata: {
      sourceKind: "family-recording",
      transcript: "宝贝，这是新录好的问候。",
      mediaType: "voice",
      language: "zh-CN",
    },
    sourceProducer: {
      name: "yimi-companion-authoring",
      version: "1.0.0",
    },
  };
}

function bindingById(revision, bindingId) {
  return revision.bindings.find((binding) => binding.bindingId === bindingId) ?? null;
}

function clipById(revision, clipId) {
  return revision.bindings.flatMap((binding) => binding.clips).find((clip) => clip.clipId === clipId) ?? null;
}

function unchangedBindingRevisions(baseRevision, revision) {
  const baseById = new Map(baseRevision.bindings.map((binding) => [binding.bindingId, binding]));
  const changed = revision.bindings.filter((binding) => {
    const before = baseById.get(binding.bindingId);
    return before && before.bindingRevision !== binding.bindingRevision;
  });
  return changed;
}

function pathInside(root, relativePath, label) {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (!inside(root, candidate)) throw new Error(`${label} escaped its containment root`);
  return candidate;
}

class ImmediateNaturalEndBackend {
  constructor({ startedAt, completedAtBaseMs }) {
    this.startedAt = startedAt;
    this.completedAtBaseMs = completedAtBaseMs;
    this.current = null;
    this.receipt = null;
    this.generation = 0;
    this.evidenceClass = "deterministic-immediate-fixture";
  }

  async play(uri, hooks) {
    await this.stop();
    const current = { generation: ++this.generation, uri, hooks, stopped: false };
    this.current = current;
    queueMicrotask(() => {
      if (this.current !== current || current.stopped) return;
      this.current = null;
      this.receipt = Object.freeze({
        playbackId: `authoring-fixture:${current.generation}`,
        backend: "deterministic-immediate-fixture",
        evidenceClass: this.evidenceClass,
        generation: current.generation,
        uri,
        processId: null,
        executableSha256: null,
        startedAt: this.startedAt,
        completedAt: new Date(this.completedAtBaseMs + current.generation * 1_000).toISOString(),
        elapsedMs: 1,
        completion: "natural-end",
        exitCode: 0,
        signal: null,
      });
      hooks.onEnd();
    });
  }

  takeNaturalEndReceipt({ uri }) {
    if (!this.receipt || this.receipt.uri !== uri) return null;
    const receipt = this.receipt;
    this.receipt = null;
    return receipt;
  }

  async pause() {}

  async resume() {}

  async stop() {
    if (this.current) this.current.stopped = true;
    this.current = null;
  }
}

async function runAcceptance() {
  await prepareRunRoot();
  const [baseRevision, baseTarget] = await Promise.all([
    readJson(path.join(FAMILY_ROOT, "family-revision.json")),
    readJson(path.join(FAMILY_ROOT, "build-plan.json")),
  ]);
  const originalSourcePath = path.join(ALPHA_ROOT, "assets", "clip-013-1.wav");
  const originalSourceBytes = Buffer.from(await readFile(originalSourcePath));
  const originalProbe = await probeCanonicalWav(originalSourcePath);

  const importedAsset = await importCanonicalWav({
    sourcePath: originalSourcePath,
    assetId: "asset-authoring-013-v2",
    vaultRoot: path.join(RUN_ROOT, "asset-vault"),
    probeCanonicalWav,
  });
  const importedReplay = await importCanonicalWav({
    sourcePath: originalSourcePath,
    assetId: "asset-authoring-013-v2",
    vaultRoot: path.join(RUN_ROOT, "asset-vault"),
    probeCanonicalWav,
  });
  const importedBytes = Buffer.from(await readFile(importedAsset.absolutePath));

  const repository = new MemoryFamilyRepository({
    repositoryId: "FAMILY-REPO-AUTHORING-ACCEPTANCE-001",
  });
  const seed = await repository.commit({
    operationId: "OP-AUTHORING-SEED-R1",
    revision: clone(baseRevision),
    expectedHeadRevisionId: null,
    at: FIXTURE_BASE_CREATED_AT,
  });
  const seededState = await repository.stateSha256();
  const validCommand = authoringCommand({
    repository,
    expectedHeadRevisionId: baseRevision.revisionId,
    operationId: "OP-AUTHORING-IMPORT-013-V2",
    importedAsset,
    contentRevision: "family-alpha-golden@0.1.1",
  });

  const negativeResults = {};
  for (const [name, expectedCode, input] of [
    [
      "missingBinding",
      "AUTHORING_BINDING_NOT_FOUND",
      { ...validCommand, operationId: "OP-AUTHORING-MISSING-BINDING", bindingId: "binding-missing" },
    ],
    [
      "missingClip",
      "AUTHORING_CLIP_NOT_FOUND",
      { ...validCommand, operationId: "OP-AUTHORING-MISSING-CLIP", clipId: "clip-missing" },
    ],
    [
      "malformedReceipt",
      "AUTHORING_ASSET_RECEIPT_INVALID",
      {
        ...validCommand,
        operationId: "OP-AUTHORING-MALFORMED-RECEIPT",
        importedAsset: { ...importedAsset, bytes: 0 },
      },
    ],
  ]) {
    const before = await repository.stateSha256();
    const result = await expectAuthoringFailure(() => commitImportedClipReplacement(input), expectedCode);
    negativeResults[name] = {
      ...result,
      expectedCode,
      zeroStateChange: before === await repository.stateSha256(),
    };
  }

  const committed = await commitImportedClipReplacement(validCommand);
  const stateAfterCommit = await repository.stateSha256();
  const replayed = await commitImportedClipReplacement({
    ...validCommand,
    importedAsset: clone(validCommand.importedAsset),
    clipMetadata: clone(validCommand.clipMetadata),
    sourceProducer: clone(validCommand.sourceProducer),
  });
  const stateAfterReplay = await repository.stateSha256();
  const staleBefore = await repository.stateSha256();
  const stale = await expectAuthoringFailure(() => commitImportedClipReplacement({
    ...validCommand,
    operationId: "OP-AUTHORING-STALE-013-V2",
    contentRevision: "family-alpha-golden@0.1.2",
  }), "STALE_HEAD");
  const staleZeroStateChange = staleBefore === await repository.stateSha256();

  const authoredBinding = bindingById(committed.revision, "binding-013");
  const baseBinding = bindingById(baseRevision, "binding-013");
  const authoredClip = clipById(committed.revision, "clip-013-1");
  const changedBindings = unchangedBindingRevisions(baseRevision, committed.revision);
  const revisionJson = JSON.stringify(committed.revision);

  const authoredTarget = extendFixtureTargetWithImportedAsset({
    baseTarget,
    importedAsset,
    buildPlanId: "PLAN-FAMILY-AUTHORING-013-V2",
    requestedAt: "2026-08-04T00:01:02Z",
    assetCatalogRevisionRef: "asset-catalog:family-alpha-authoring-013-v2",
  });
  const buildPlan = await composeFixtureBuildPlan({
    familyRevision: committed.revision,
    pinnedFixtureTarget: authoredTarget,
  });
  const projected = await projectAndValidateBuildPlan({ familyRevision: committed.revision, buildPlan });
  const projectedReplay = await projectAndValidateBuildPlan({
    familyRevision: clone(committed.revision),
    buildPlan: clone(buildPlan),
  });
  const planImportedAsset = buildPlan.assetCatalog.assets.find((asset) => asset.assetId === importedAsset.assetId) ?? null;

  const sourcePathByAssetId = new Map();
  for (const asset of buildPlan.assetCatalog.assets) {
    if (asset.assetId === importedAsset.assetId) {
      sourcePathByAssetId.set(asset.assetId, importedAsset.absolutePath);
    } else {
      const baseAsset = baseTarget.assetCatalog.assets.find((candidate) => candidate.assetId === asset.assetId);
      if (!baseAsset) throw new Error(`${asset.assetId} is not part of the golden source catalog`);
      sourcePathByAssetId.set(asset.assetId, pathInside(ALPHA_ROOT, baseAsset.path, asset.assetId));
    }
  }
  const verifiedBuildAssets = await verifyBuildPlanAssets({
    buildPlan,
    assetReader: async ({ assetId }) => readFile(sourcePathByAssetId.get(assetId)),
  });
  const workspace = await materializeBuildPlanWorkspace({
    workspaceRoot: path.join(RUN_ROOT, "build-workspace"),
    buildPlan,
    projectedDraft: projected.draft,
    sourcePathByAssetId,
  });
  const { preview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath: workspace.draftPath });
  const previewClips = preview.bindings.flatMap((binding) => binding.clips);
  const resolvedPreviewClips = await Promise.all(previewClips.map((clip) => resolveVerifiedPreviewClip({
    clip,
    assetRoot: workspace.workspace,
  })));
  const previewImportedClip = previewClips.find((clip) => clip.clipId === "clip-013-1") ?? null;

  const backend = new ImmediateNaturalEndBackend({
    startedAt: PRESENTATION_OPENED_AT,
    completedAtBaseMs: Date.parse(PRESENTATION_OPENED_AT),
  });
  const playbackPort = createAudioPlayerPrelistenPort({
    backend,
    clock: { now: () => PRESENTATION_OPENED_AT },
    defaultTimeoutMs: 500,
  });
  const challenge = {
    challengeId: "CHALLENGE-AUTHORING-013-V2",
    fixtureOnly: true,
    previewId: preview.previewId,
    sourceSha256: preview.sourceSha256,
    presentationPolicyVersion: preview.presentationPolicyVersion,
    buildPlanId: buildPlan.buildPlanId,
    buildSubjectSha256: buildPlan.buildSubjectSha256,
    guardianAuthority: { role: "guardian" },
    issuedAt: PRESENTATION_OPENED_AT,
  };
  const presentation = createPrelistenPresentationSession({
    sessionId: "authoring-acceptance-013-v2",
    challenge,
    preview,
    clipResolver: (clip) => resolveVerifiedPreviewClip({ clip, assetRoot: workspace.workspace }),
    playbackPort,
    clock: { now: () => PRESENTATION_OPENED_AT },
  });
  presentation.open();
  await presentation.playAll({ timeoutMs: 500 });
  const presentationSnapshot = presentation.snapshot();

  const negativeGate = Object.values(negativeResults).every((result) => (
    result.code === result.expectedCode && result.stableClass && result.zeroStateChange
  ));
  const gates = {
    seededGoldenRevision: seed.status === "committed"
      && seed.headRevisionId === baseRevision.revisionId,
    realContentAddressedImportIdentity: importedAsset.bytes === originalSourceBytes.length
      && importedAsset.sha256 === sha256(originalSourceBytes)
      && importedAsset.durationMs === originalProbe.durationMs
      && importedAsset.codec === originalProbe.codecProfile
      && importedAsset.contentPath === `assets/sha256/${importedAsset.sha256}.wav`
      && importedBytes.equals(originalSourceBytes),
    importReplayDedupeIsStable: JSON.stringify(importedReplay) === JSON.stringify(importedAsset),
    authoringRevisionHasNoPathOrCodecLeakage: !revisionJson.includes(importedAsset.absolutePath)
      && !revisionJson.includes(importedAsset.contentPath)
      && !revisionJson.includes('"path"')
      && !revisionJson.includes('"absolutePath"')
      && !revisionJson.includes('"contentPath"')
      && !revisionJson.includes('"codec"')
      && !revisionJson.includes('"durationMs"'),
    revisionIdentityAndParentAreExact: committed.revision.revisionId === computeFamilyRevisionId(committed.revision)
      && committed.revision.parentRevisionId === baseRevision.revisionId
      && committed.revision.revisionNumber === "2"
      && committed.revision.createdAt === AUTHORING_CREATED_AT,
    exactlyOneBindingRevisionIncremented: changedBindings.length === 1
      && changedBindings[0]?.bindingId === "binding-013"
      && authoredBinding?.bindingRevision === baseBinding?.bindingRevision + 1
      && authoredClip?.assetId === importedAsset.assetId
      && authoredClip?.assetSha256 === importedAsset.sha256
      && authoredClip?.assetBytes === importedAsset.bytes,
    casCommitIsAuditable: committed.commit.status === "committed"
      && committed.commit.replayed === false
      && committed.commit.headRevisionId === committed.revision.revisionId
      && stateAfterCommit !== seededState,
    exactReplayHasZeroStateChange: replayed.commit.status === "replayed"
      && replayed.commit.replayed === true
      && JSON.stringify(replayed.revision) === JSON.stringify(committed.revision)
      && JSON.stringify(replayed.assetCatalogEntry) === JSON.stringify(committed.assetCatalogEntry)
      && stateAfterReplay === stateAfterCommit,
    staleDifferentOperationHitsCasWithZeroStateChange: stale.code === "STALE_HEAD"
      && staleZeroStateChange,
    authoringNegativesAreStableAndPreMutation: negativeGate,
    buildPlanCatalogCarriesAppContentPath: planImportedAsset?.path === importedAsset.contentPath
      && planImportedAsset?.codec === importedAsset.codec
      && planImportedAsset?.bytes === importedAsset.bytes
      && planImportedAsset?.sha256 === importedAsset.sha256
      && !JSON.stringify(buildPlan).includes(importedAsset.absolutePath),
    buildPlanAndProjectionIdentitiesValidate: buildPlan.familyRevisionId === committed.revision.revisionId
      && buildPlan.expectedProjection.sourceSha256 === projected.projectionSha256
      && projected.projectionSha256 === projectedReplay.projectionSha256
      && JSON.stringify(projected.draft) === JSON.stringify(projectedReplay.draft),
    allBuildPlanAssetsAreByteVerified: verifiedBuildAssets.length === buildPlan.assetCatalog.assets.length
      && workspace.copied.length === buildPlan.assetCatalog.assets.length
      && workspace.copied.every((asset) => buildPlan.assetCatalog.assets.some((catalog) => (
        catalog.assetId === asset.assetId && catalog.bytes === asset.bytes && catalog.sha256 === asset.sha256
      ))),
    previewReadsMaterializedBytesAndHashes: preview.summary.clipCount === previewClips.length
      && resolvedPreviewClips.length === previewClips.length
      && resolvedPreviewClips.every((clip) => previewClips.some((previewClip) => (
        previewClip.clipId === clip.clipId && previewClip.bytes === clip.bytes && previewClip.sha256 === clip.sha256
      )))
      && previewImportedClip?.assetPath === importedAsset.contentPath
      && previewImportedClip?.bytes === importedAsset.bytes
      && previewImportedClip?.sha256 === importedAsset.sha256,
    fullPrelistenPresentationReachesReadyToConfirm: presentationSnapshot.state === "READY_TO_CONFIRM"
      && presentationSnapshot.completedClipCount === preview.summary.clipCount
      && presentationSnapshot.requiredClipCount === preview.summary.clipCount
      && presentationSnapshot.playbackReceipts.length === preview.summary.clipCount
      && presentationSnapshot.failedAttempts.length === 0,
  };
  const failures = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const report = {
    schemaVersion: 1,
    profile: "companion-authoring-acceptance-v1",
    fixtureOnly: true,
    scope: {
      realGoldenWavBytesRead: true,
      deterministicCanonicalWavProbe: true,
      memoryRepositoryCas: true,
      buildPlanAndProjection: true,
      materializedPreviewAssets: true,
      immediateNaturalEndPlaybackPort: true,
      hostAudioEndpointUsed: false,
      operatorAudibilityWitnessIncluded: false,
      targetDeviceAudioIncluded: false,
    },
    source: {
      baseRevisionId: baseRevision.revisionId,
      importedAsset: {
        assetId: importedAsset.assetId,
        contentPath: importedAsset.contentPath,
        bytes: importedAsset.bytes,
        sha256: importedAsset.sha256,
        durationMs: importedAsset.durationMs,
        codec: importedAsset.codec,
      },
      authoredRevisionId: committed.revision.revisionId,
      buildPlanId: buildPlan.buildPlanId,
      buildSubjectSha256: buildPlan.buildSubjectSha256,
      projectionSha256: projected.projectionSha256,
      previewId: preview.previewId,
      previewSourceSha256: preview.sourceSha256,
    },
    repository: {
      seedStatus: seed.status,
      commitStatus: committed.commit.status,
      replayStatus: replayed.commit.status,
      staleCode: stale.code,
      staleZeroStateChange,
    },
    negatives: negativeResults,
    presentation: {
      state: presentationSnapshot.state,
      requiredClipCount: presentationSnapshot.requiredClipCount,
      completedClipCount: presentationSnapshot.completedClipCount,
      playbackReceiptCount: presentationSnapshot.playbackReceipts.length,
    },
    gates,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes, { flag: "wx" });
  console.log(`Companion authoring acceptance: ${Object.keys(gates).length - failures.length}/${Object.keys(gates).length}`);
  console.log(`Companion authoring report SHA-256: ${sha256(reportBytes)}`);
  if (failures.length) throw new Error(`companion authoring gates failed: ${failures.join(", ")}`);
}

const lock = await acquireLock();
try {
  await runAcceptance();
} finally {
  try { await lock.close(); } catch { /* result above remains authoritative */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* result above remains authoritative */ }
}
