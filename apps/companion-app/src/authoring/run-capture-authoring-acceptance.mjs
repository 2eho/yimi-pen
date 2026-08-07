import { createHash } from "node:crypto";
import {
  copyFile,
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
import { buildPreview } from "../../../../tools/family-alpha-compiler/compiler.mjs";
import { verifyBuildPlanAssets } from "../../../../tools/family-build-adapter/adapter.mjs";
import { MemoryFamilyRepository } from "../../../../tools/family-repository/memory-adapter.mjs";
import { createConfirmationTrustProvider } from "../../../../tools/confirmation-trust/provider.mjs";
import { MemoryChallengeStore } from "../../../../tools/confirmation-trust/replay-store.mjs";
import { loadConfirmationTrustSchemaValidator } from "../../../../tools/confirmation-trust/schema-validator.mjs";
import { createFixtureProof } from "../fixture-confirmation.mjs";
import {
  authorizedCompileDesignSnapshot,
  composeFixtureBuildPlan,
  projectAndValidateBuildPlan,
} from "../host-orchestrator.mjs";
import { HostAudioError } from "../prelisten/ffmpeg-host-audio.mjs";
import { importCanonicalWav, resolveVerifiedPreviewClip } from "../prelisten/local-audio-assets.mjs";
import { createAudioPlayerPrelistenPort } from "../prelisten/presentation-session.mjs";
import { executeVerifiedPrelisten } from "../prelisten/verified-prelisten-use-case.mjs";
import { captureCanonicalAudioAsset } from "./capture-source-use-case.mjs";
import { createDirectShowCapturePort } from "./directshow-capture-port.mjs";
import {
  commitImportedClipReplacement,
  extendFixtureTargetWithImportedAsset,
} from "./family-authoring-use-case.mjs";
import { materializeBuildPlanWorkspace } from "./local-authoring-workspace.mjs";

const APP_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-capture-authoring-validation");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-capture-authoring-validation.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".companion-capture-authoring-validation-root");
const MARKER_TEXT = "yimi-companion-capture-authoring-validation-root-v1\n";
const FAMILY_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1/golden");
const ALPHA_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const TRUST_ROOT = path.join(REPO_ROOT, "hardware/evt0/confirmation-trust-v1/golden");
const FIXTURE_SOURCE = path.join(ALPHA_ROOT, "assets", "clip-013-1.wav");
const FIXTURE_DURATION_MS = 120;
const CAPTURED_AT = "2026-08-04T01:00:00Z";
const COMMITTED_AT = "2026-08-04T01:00:01Z";
const PRESENTED_AT = "2026-08-04T01:01:00Z";
const PROOF_ISSUED_AT = "2026-08-04T01:02:00Z";

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

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  try {
    return await open(LOCK_PATH, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("capture authoring acceptance has an active or stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("capture authoring root must be an owned directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("capture authoring root escaped build/");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) throw new Error("capture authoring root lacks its ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { encoding: "utf8", flag: "wx" });
}

function codeOf(error) {
  return error?.code ?? error?.name ?? "UNKNOWN";
}

async function captureError(action) {
  try {
    await action();
    return null;
  } catch (error) {
    return error;
  }
}

function mutableClock(initial) {
  let value = initial;
  return { now: () => value, set: (next) => { value = next; } };
}

function fixtureProbe() {
  return Object.freeze({ codecProfile: "WAV_PCM16_16K_MONO", durationMs: FIXTURE_DURATION_MS });
}

function pathInside(root, relativePath, label) {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (!inside(root, candidate)) throw new Error(`${label} escaped its golden root`);
  return candidate;
}

function createFixtureDirectShowPort({ name, recordWav, removeFile }) {
  return createDirectShowCapturePort({
    ffmpeg: { path: "FFMPEG_CAPTURE_FIXTURE", sha256: "f".repeat(64) },
    ffprobe: { path: "FFPROBE_CAPTURE_FIXTURE", sha256: "e".repeat(64) },
    captureRoot: path.join(RUN_ROOT, `capture-${name}`),
    recordWav,
    ...(removeFile ? { removeFile } : {}),
    idFactory: () => `capture-${name}-001`,
  });
}

function successfulFixtureRecorder({ sourcePath = FIXTURE_SOURCE } = {}) {
  return async ({ outputPath }) => {
    await copyFile(sourcePath, outputPath);
    return Object.freeze({
      sourceClass: "windows-directshow-microphone",
      outputPath,
      durationMs: FIXTURE_DURATION_MS,
      codecProfile: "WAV_PCM16_16K_MONO",
    });
  };
}

class ImmediateNaturalEndBackend {
  constructor() {
    this.current = null;
    this.receipt = null;
    this.generation = 0;
    this.evidenceClass = "deterministic-capture-fixture";
  }

  async play(uri, hooks) {
    await this.stop();
    const generation = ++this.generation;
    const current = { generation, uri, hooks, stopped: false };
    this.current = current;
    queueMicrotask(() => {
      if (this.current !== current || current.stopped) return;
      this.current = null;
      this.receipt = Object.freeze({
        playbackId: `capture-authoring-playback-${generation}`,
        backend: "deterministic-capture-fixture",
        evidenceClass: this.evidenceClass,
        generation,
        uri,
        processId: null,
        executableSha256: null,
        startedAt: PRESENTED_AT,
        completedAt: PRESENTED_AT,
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

async function importCapturedFixture({ sourcePath, vaultName, assetId = "asset-capture-013-v1" }) {
  return importCanonicalWav({
    sourcePath,
    assetId,
    vaultRoot: path.join(RUN_ROOT, vaultName),
    probeCanonicalWav: fixtureProbe,
  });
}

async function runSuccessChain({ baseRevision, baseTarget, policy, contracts }) {
  const sourceBytes = Buffer.from(await readFile(FIXTURE_SOURCE));
  const capturePort = createFixtureDirectShowPort({
    name: "success",
    recordWav: successfulFixtureRecorder(),
  });
  const captured = await captureCanonicalAudioAsset({
    capturePort,
    captureRequest: { deviceName: "DEVICE_FIXTURE", durationSeconds: 1 },
    importPort: ({ sourcePath }) => importCapturedFixture({ sourcePath, vaultName: "success-vault" }),
  });
  const temporarySourcePath = path.join(RUN_ROOT, "capture-success", "capture-success-001.wav");

  const repository = new MemoryFamilyRepository({ repositoryId: "FAMILY-REPO-CAPTURE-ACCEPTANCE-001" });
  const seed = await repository.commit({
    operationId: "OP-CAPTURE-SEED-001",
    revision: structuredClone(baseRevision),
    expectedHeadRevisionId: null,
    at: CAPTURED_AT,
  });
  const committed = await commitImportedClipReplacement({
    repository,
    operationId: "OP-CAPTURE-COMMIT-001",
    expectedHeadRevisionId: baseRevision.revisionId,
    createdAt: CAPTURED_AT,
    committedAt: COMMITTED_AT,
    contentRevision: "family-alpha-capture@0.1.0",
    bindingId: "binding-013",
    clipId: "clip-013-1",
    importedAsset: captured.importedAsset,
    clipMetadata: {
      sourceKind: "family-recording",
      transcript: "宝贝，这是录音适配器的问候。",
      mediaType: "voice",
      language: "zh-CN",
    },
    sourceProducer: { name: "yimi-companion-directshow", version: "1.0.0" },
  });
  const authoredTarget = extendFixtureTargetWithImportedAsset({
    baseTarget,
    importedAsset: captured.importedAsset,
    buildPlanId: "PLAN-FAMILY-CAPTURE-001",
    requestedAt: "2026-08-04T01:00:02Z",
    assetCatalogRevisionRef: "asset-catalog:family-capture-001",
  });
  const buildPlan = await composeFixtureBuildPlan({
    familyRevision: committed.revision,
    pinnedFixtureTarget: authoredTarget,
  });
  const projected = await projectAndValidateBuildPlan({ familyRevision: committed.revision, buildPlan });
  const sourcePathByAssetId = new Map();
  for (const asset of buildPlan.assetCatalog.assets) {
    if (asset.assetId === captured.importedAsset.assetId) {
      sourcePathByAssetId.set(asset.assetId, captured.importedAsset.absolutePath);
    } else {
      const baseAsset = baseTarget.assetCatalog.assets.find((candidate) => candidate.assetId === asset.assetId);
      if (!baseAsset) throw new Error(`${asset.assetId} has no golden source`);
      sourcePathByAssetId.set(asset.assetId, pathInside(ALPHA_ROOT, baseAsset.path, asset.assetId));
    }
  }
  const verifiedAssets = await verifyBuildPlanAssets({
    buildPlan,
    assetReader: ({ assetId }) => readFile(sourcePathByAssetId.get(assetId)),
  });
  const workspace = await materializeBuildPlanWorkspace({
    workspaceRoot: path.join(RUN_ROOT, "success-workspace"),
    buildPlan,
    projectedDraft: projected.draft,
    sourcePathByAssetId,
  });
  const { preview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath: workspace.draftPath });
  const clips = preview.bindings.flatMap((binding) => binding.clips);

  const providerClock = mutableClock(PRESENTED_AT);
  const provider = createConfirmationTrustProvider({
    policy,
    challengeStore: new MemoryChallengeStore(),
    clock: providerClock,
    nonceSource: () => Buffer.alloc(16, 7),
    authorityResolver: async () => structuredClone(policy.authorities[0]),
    contractValidator: contracts,
  });
  const playbackPort = createAudioPlayerPrelistenPort({
    backend: new ImmediateNaturalEndBackend(),
    clock: { now: () => PRESENTED_AT },
    defaultTimeoutMs: 500,
  });
  const verified = await executeVerifiedPrelisten({
    provider,
    buildPlan,
    preview,
    familyLibraryId: committed.revision.familyLibraryId,
    authoritySessionRef: "capture-authoring-fixture-session",
    issueOperationId: "op:capture-authoring-issue:001",
    consumeOperationId: "op:capture-authoring-consume:001",
    sessionId: "capture-authoring-prelisten-001",
    clipResolver: (clip) => resolveVerifiedPreviewClip({ clip, assetRoot: workspace.workspace }),
    playbackPort,
    explicitConfirmationPort: async () => ({
      class: "deterministic-capture-fixture-action",
      operatorPostPlaybackAttestationIncluded: false,
    }),
    confirmationIdFactory: async () => "CONF-CAPTURE-AUTHORING-001",
    proofFactory: ({ challenge, presentationTranscript, confirmation }) => {
      const proof = createFixtureProof({
        policy,
        challenge,
        presentationTranscript,
        confirmation,
        issuedAt: PROOF_ISSUED_AT,
        expiresAt: "2026-08-04T01:04:00Z",
      });
      providerClock.set(PROOF_ISSUED_AT);
      return proof;
    },
    contractValidator: contracts,
    presentationClock: { now: () => PRESENTED_AT },
    playOptions: { timeoutMs: 500 },
  });
  const confirmationPath = path.join(RUN_ROOT, "success-confirmation.json");
  await writeFile(confirmationPath, `${JSON.stringify(verified.confirmed.confirmation, null, 2)}\n`, { flag: "wx" });
  const snapshotDirectory = path.join(RUN_ROOT, "success-snapshot");
  const compileReport = await authorizedCompileDesignSnapshot({
    repoRoot: REPO_ROOT,
    familyRevision: committed.revision,
    buildPlan,
    projectedDraft: projected.draft,
    preview,
    confirmation: verified.confirmed.confirmation,
    presentationTranscript: verified.confirmed.transcript,
    proof: verified.proof,
    verificationResult: verified.verificationResult,
    buildAuthorization: verified.buildAuthorization,
    draftPath: workspace.draftPath,
    confirmationPath,
    now: verified.verificationResult.consumedAt,
    outputDirectory: snapshotDirectory,
  });
  const [manifest, actions, compiledBytes] = await Promise.all([
    readJson(path.join(snapshotDirectory, "manifest.json")),
    readJson(path.join(snapshotDirectory, "actions.json")),
    readFile(path.join(snapshotDirectory, "audio", "clip-013-1.wav")),
  ]);
  const authoredClip = committed.revision.bindings
    .flatMap((binding) => binding.clips)
    .find((clip) => clip.clipId === "clip-013-1");
  const compiledClip = actions.clips.find((clip) => clip.clipId === "clip-013-1");
  const durableJson = JSON.stringify({ revision: committed.revision, buildPlan, preview, manifest, actions });
  return {
    captureReceipt: captured.captureReceipt,
    importedAsset: captured.importedAsset,
    authoredRevisionId: committed.revision.revisionId,
    buildPlanId: buildPlan.buildPlanId,
    previewId: preview.previewId,
    authorizationId: verified.buildAuthorization.authorizationId,
    snapshotId: compileReport.snapshotId,
    gates: {
      successfulCaptureDiscardsTemporarySource: !(await exists(temporarySourcePath))
        && captured.captureReceipt.temporarySourceDiscarded === true,
      canonicalImportMatchesCapturedBytes: captured.importedAsset.bytes === sourceBytes.length
        && captured.importedAsset.sha256 === sha256(sourceBytes)
        && Buffer.from(await readFile(captured.importedAsset.absolutePath)).equals(sourceBytes),
      capturedAssetFeedsStableRevisionCommand: seed.status === "committed"
        && committed.commit.status === "committed"
        && authoredClip?.assetId === captured.importedAsset.assetId
        && authoredClip?.assetSha256 === captured.importedAsset.sha256
        && authoredClip?.assetBytes === captured.importedAsset.bytes,
      capturedRevisionUsesSameBuildAndPrelistenChain: verifiedAssets.length === buildPlan.assetCatalog.assets.length
        && workspace.copied.length === buildPlan.assetCatalog.assets.length
        && verified.sessionEvidence.state === "CONFIRMED"
        && verified.sessionEvidence.playbackReceipts.length === clips.length
        && verified.verificationResult.verified === true
        && verified.buildAuthorization.familyRevisionId === committed.revision.revisionId,
      authorizedCompilerCarriesCapturedBytes: manifest.snapshotId === compileReport.snapshotId
        && compiledClip?.sha256 === captured.importedAsset.sha256
        && compiledClip?.size === captured.importedAsset.bytes
        && compiledBytes.equals(sourceBytes),
      durableArtifactsExcludeCaptureDeviceAndTemporaryPath: !durableJson.includes("DEVICE_FIXTURE")
        && !durableJson.includes("windows-directshow-microphone")
        && !durableJson.includes(temporarySourcePath)
        && !durableJson.includes("capture-success-001.wav"),
    },
  };
}

async function runNegativeScenarios({ baseRevision }) {
  let preCancelledCaptureCalls = 0;
  let preCancelledImportCalls = 0;
  const preCancelledController = new AbortController();
  preCancelledController.abort();
  const preCancelled = await captureError(() => captureCanonicalAudioAsset({
    capturePort: {
      capture: async () => { preCancelledCaptureCalls += 1; },
      discard: async () => ({ cleanupComplete: true }),
    },
    captureRequest: { deviceName: "DEVICE_FIXTURE", durationSeconds: 1 },
    importPort: async () => { preCancelledImportCalls += 1; },
    signal: preCancelledController.signal,
  }));

  let runningCancelledImportCalls = 0;
  const runningController = new AbortController();
  const runningPort = createFixtureDirectShowPort({
    name: "running-cancel",
    recordWav: ({ signal }) => new Promise((resolve, reject) => {
      const onAbort = () => reject(new HostAudioError(
        "HOST_AUDIO_PROCESS_ABORTED",
        "fixture active capture cancelled",
        { cleanupComplete: true },
      ));
      signal.addEventListener("abort", onAbort, { once: true });
      void resolve;
    }),
  });
  const runningPromise = captureError(() => captureCanonicalAudioAsset({
    capturePort: runningPort,
    captureRequest: { deviceName: "DEVICE_FIXTURE", durationSeconds: 1 },
    importPort: async () => { runningCancelledImportCalls += 1; },
    signal: runningController.signal,
  }));
  setTimeout(() => runningController.abort(), 10);
  const runningCancelled = await runningPromise;

  let timeoutImportCalls = 0;
  const timeoutPort = createFixtureDirectShowPort({
    name: "timeout",
    recordWav: async () => {
      throw new HostAudioError("HOST_AUDIO_PROCESS_TIMEOUT", "fixture capture timeout", { cleanupComplete: true });
    },
  });
  const timedOut = await captureError(() => captureCanonicalAudioAsset({
    capturePort: timeoutPort,
    captureRequest: { deviceName: "DEVICE_FIXTURE", durationSeconds: 1 },
    importPort: async () => { timeoutImportCalls += 1; },
  }));

  let malformedImportCalls = 0;
  const malformedPort = createFixtureDirectShowPort({
    name: "malformed-receipt",
    recordWav: async ({ outputPath }) => {
      await copyFile(FIXTURE_SOURCE, outputPath);
      return {
        sourceClass: "windows-directshow-microphone",
        outputPath,
        durationMs: FIXTURE_DURATION_MS,
        codecProfile: "MALFORMED_FIXTURE_CODEC",
      };
    },
  });
  const malformedReceipt = await captureError(() => captureCanonicalAudioAsset({
    capturePort: malformedPort,
    captureRequest: { deviceName: "DEVICE_FIXTURE", durationSeconds: 1 },
    importPort: async () => { malformedImportCalls += 1; },
  }));
  const malformedSource = path.join(RUN_ROOT, "capture-malformed-receipt", "capture-malformed-receipt-001.wav");

  const importFailurePort = createFixtureDirectShowPort({
    name: "import-failure",
    recordWav: successfulFixtureRecorder(),
  });
  const importFailure = await captureError(() => captureCanonicalAudioAsset({
    capturePort: importFailurePort,
    captureRequest: { deviceName: "DEVICE_FIXTURE", durationSeconds: 1 },
    importPort: async () => {
      const error = new Error("fixture import failure");
      error.code = "CAPTURE_IMPORT_FIXTURE_FAILED";
      throw error;
    },
  }));
  const failedImportSource = path.join(RUN_ROOT, "capture-import-failure", "capture-import-failure-001.wav");

  let cleanupCommitCalls = 0;
  const cleanupFailurePort = createFixtureDirectShowPort({
    name: "cleanup-failure",
    recordWav: successfulFixtureRecorder(),
    removeFile: async () => { throw new Error("fixture persistent cleanup failure"); },
  });
  const cleanupFailure = await captureError(async () => {
    const result = await captureCanonicalAudioAsset({
      capturePort: cleanupFailurePort,
      captureRequest: { deviceName: "DEVICE_FIXTURE", durationSeconds: 1 },
      importPort: ({ sourcePath }) => importCapturedFixture({
        sourcePath,
        vaultName: "cleanup-failure-vault",
        assetId: "asset-capture-cleanup-failure",
      }),
    });
    cleanupCommitCalls += 1;
    await commitImportedClipReplacement({ repository: null, importedAsset: result.importedAsset });
  });
  const cleanupFailureSource = path.join(RUN_ROOT, "capture-cleanup-failure", "capture-cleanup-failure-001.wav");
  const cleanupFailureSourceRemained = Boolean(await exists(cleanupFailureSource));
  await rm(cleanupFailureSource, { force: true });

  const repository = new MemoryFamilyRepository({ repositoryId: "FAMILY-REPO-CAPTURE-NEGATIVE-001" });
  await repository.commit({
    operationId: "OP-CAPTURE-NEGATIVE-SEED-001",
    revision: structuredClone(baseRevision),
    expectedHeadRevisionId: null,
    at: CAPTURED_AT,
  });
  const repositoryState = await repository.stateSha256();

  return {
    evidence: {
      preCancelledCode: codeOf(preCancelled),
      runningCancelledCode: codeOf(runningCancelled),
      runningCancelledAdapterCode: runningCancelled?.details?.adapterCode ?? null,
      timeoutCode: codeOf(timedOut),
      timeoutAdapterCode: timedOut?.details?.adapterCode ?? null,
      malformedReceiptCode: codeOf(malformedReceipt),
      malformedReceiptAdapterCode: malformedReceipt?.details?.adapterCode ?? null,
      importFailureCode: codeOf(importFailure),
      cleanupFailureCode: codeOf(cleanupFailure),
      cleanupFailureOriginalCode: cleanupFailure?.details?.originalCode ?? null,
    },
    gates: {
      preCancelledRequestHasZeroCaptureAndImport: preCancelled?.code === "CAPTURE_REQUEST_ABORTED"
        && preCancelled.details?.cleanupComplete === true
        && preCancelledCaptureCalls === 0
        && preCancelledImportCalls === 0,
      runningCancellationNeverImports: runningCancelled?.code === "CAPTURE_REQUEST_ABORTED"
        && runningCancelled.details?.adapterCode === "HOST_AUDIO_PROCESS_ABORTED"
        && runningCancelled.details?.cleanupComplete === true
        && runningCancelledImportCalls === 0,
      captureTimeoutNeverImports: timedOut?.code === "CAPTURE_REQUEST_TIMEOUT"
        && timedOut.details?.adapterCode === "HOST_AUDIO_PROCESS_TIMEOUT"
        && timedOut.details?.cleanupComplete === true
        && timeoutImportCalls === 0,
      malformedRecorderReceiptIsCleanedBeforeImport: malformedReceipt?.code === "CAPTURE_REQUEST_FAILED"
        && malformedReceipt.details?.adapterCode === "CAPTURE_RECEIPT_INVALID"
        && malformedImportCalls === 0
        && !(await exists(malformedSource)),
      failedImportDiscardsCapturedSource: importFailure?.code === "CAPTURE_IMPORT_FIXTURE_FAILED"
        && !(await exists(failedImportSource)),
      cleanupFailureStopsBeforeRevisionCommit: cleanupFailure?.code === "CAPTURE_SOURCE_CLEANUP_FAILED"
        && cleanupFailure.details?.importedAssetPublished === true
        && cleanupFailure.details?.cleanupComplete === false
        && cleanupFailureSourceRemained
        && cleanupCommitCalls === 0
        && repositoryState === await repository.stateSha256(),
    },
  };
}

async function runAcceptance() {
  await prepareRunRoot();
  const [baseRevision, baseTarget, policy, contracts] = await Promise.all([
    readJson(path.join(FAMILY_ROOT, "family-revision.json")),
    readJson(path.join(FAMILY_ROOT, "build-plan.json")),
    readJson(path.join(TRUST_ROOT, "trust-policy.json")),
    loadConfirmationTrustSchemaValidator(REPO_ROOT),
  ]);
  const success = await runSuccessChain({ baseRevision, baseTarget, policy, contracts });
  const negatives = await runNegativeScenarios({ baseRevision });
  const gates = { ...success.gates, ...negatives.gates };
  const failures = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const report = {
    schemaVersion: 1,
    profile: "companion-capture-authoring-acceptance-v1",
    fixtureOnly: true,
    evidenceScope: {
      DirectShowPortShapeIncluded: true,
      canonicalImportIncluded: true,
      immutableFamilyRevisionIncluded: true,
      completePreviewPrelistenIncluded: true,
      fixtureAuthorizationAndDesignSnapshotIncluded: true,
      actualMicrophoneIncluded: false,
      hostAudioEndpointIncluded: false,
      productionAuthorityIncluded: false,
      targetDeviceInstallIncluded: false,
    },
    capture: success.captureReceipt,
    importedAsset: {
      assetId: success.importedAsset.assetId,
      contentPath: success.importedAsset.contentPath,
      bytes: success.importedAsset.bytes,
      sha256: success.importedAsset.sha256,
      durationMs: success.importedAsset.durationMs,
      codec: success.importedAsset.codec,
    },
    authoredRevisionId: success.authoredRevisionId,
    buildPlanId: success.buildPlanId,
    previewId: success.previewId,
    authorizationId: success.authorizationId,
    snapshotId: success.snapshotId,
    negatives: negatives.evidence,
    gates,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes, { flag: "wx" });
  console.log(`Capture authoring acceptance: ${Object.keys(gates).length - failures.length}/${Object.keys(gates).length}`);
  console.log(`Capture authoring report SHA-256: ${sha256(reportBytes)}`);
  if (failures.length) throw new Error(`capture authoring gates failed: ${failures.join(", ")}`);
}

const lock = await acquireLock();
try {
  await runAcceptance();
} finally {
  try { await lock.close(); } catch { /* result above remains authoritative */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* result above remains authoritative */ }
}
