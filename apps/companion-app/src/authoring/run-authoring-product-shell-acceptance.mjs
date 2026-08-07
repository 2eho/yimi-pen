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
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import {
  createAuthoringProductReviewReceipt,
  createAuthoringProductSessionState,
  transitionAuthoringProductSession,
} from "./authoring-product-session-core.mjs";
import { openAuthoringProductSession } from "./authoring-product-session.mjs";
import { createFamilyWorkspaceAuthoringAdapter } from "./family-workspace-authoring-adapter.mjs";
import { createFamilyWorkspace } from "../family-workspace/family-workspace.mjs";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_ROOT, "../../../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-authoring-product-shell-validation");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-authoring-product-shell-validation.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".authoring-product-shell-validation-root");
const MARKER_TEXT = "yimi-authoring-product-shell-validation-root-v1\n";
const WORKSPACE_ROOT = path.join(RUN_ROOT, "workspaces");
const WORKSPACE_DIRECTORY = path.join(WORKSPACE_ROOT, "primary");
const BASE_REVISION_PATH = path.join(
  REPO_ROOT,
  "hardware/evt0/family-repository-v1/golden/family-revision.json",
);
const ASSET_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden/assets");
const LIMITS = Object.freeze({
  maxBackupBytes: 4 * 1024 * 1024,
  maxEntries: 128,
  maxAssetBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});

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
  try {
    return await open(LOCK_PATH, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("authoring product shell acceptance has an active or stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("authoring product shell root is unsafe");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("authoring product shell root escaped build");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) throw new Error("authoring product shell root lacks its marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { flag: "wx" });
  await mkdir(WORKSPACE_ROOT);
}

async function expectCode(action, expectedCode) {
  try {
    await action();
  } catch (error) {
    if (error?.code === expectedCode) return error;
    throw new Error(`expected ${expectedCode}, received ${error?.code ?? error?.name ?? "UNKNOWN"}`);
  }
  throw new Error(`expected ${expectedCode}, received success`);
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function probeCanonicalWav(filePath) {
  const bytes = Buffer.from(await readFile(filePath));
  if (bytes.length < 44
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WAVE"
    || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error("fixture WAV header is outside the canonical profile");
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
      if (format !== null || chunkLength !== 16) throw new Error("fixture WAV fmt chunk is outside the canonical profile");
      format = {
        audioFormat: bytes.readUInt16LE(dataStart),
        channels: bytes.readUInt16LE(dataStart + 2),
        sampleRate: bytes.readUInt32LE(dataStart + 4),
        byteRate: bytes.readUInt32LE(dataStart + 8),
        blockAlign: bytes.readUInt16LE(dataStart + 12),
        bitsPerSample: bytes.readUInt16LE(dataStart + 14),
      };
    } else if (chunkId === "data") {
      if (dataLength !== null) throw new Error("fixture WAV has duplicate data chunks");
      dataLength = chunkLength;
    } else {
      throw new Error(`fixture WAV has unsupported chunk ${JSON.stringify(chunkId)}`);
    }
    offset = dataEnd + (chunkLength % 2);
  }
  if (offset !== bytes.length || !format || dataLength === null
    || format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16_000
    || format.byteRate !== 32_000 || format.blockAlign !== 2 || format.bitsPerSample !== 16
    || dataLength <= 0 || dataLength % 2 !== 0 || (dataLength * 1_000) % format.byteRate !== 0) {
    throw new Error("fixture WAV is outside WAV_PCM16_16K_MONO");
  }
  return Object.freeze({
    codecProfile: "WAV_PCM16_16K_MONO",
    durationMs: (dataLength * 1_000) / format.byteRate,
  });
}

function createCaptureWitness(sourceBytes) {
  const state = { captures: 0, discards: 0, abortedSignals: 0 };
  return Object.freeze({
    state,
    async factory({ captureRoot }) {
      let active = null;
      return Object.freeze({
        async capture(request) {
          state.captures += 1;
          if (request.signal?.aborted) state.abortedSignals += 1;
          const captureId = `capture-product-shell-${state.captures}`;
          const sourcePath = path.join(captureRoot, `${captureId}.wav`);
          await writeFile(sourcePath, sourceBytes, { flag: "wx" });
          const probe = await probeCanonicalWav(sourcePath);
          active = Object.freeze({
            captureId,
            sourceClass: "fixture-capture-source",
            adapter: "authoring-product-shell-acceptance",
            sourcePath,
            durationMs: probe.durationMs,
            codecProfile: probe.codecProfile,
            executableSha256: null,
          });
          return active;
        },
        async discard(receipt) {
          if (receipt !== active) throw new Error("capture receipt identity changed");
          state.discards += 1;
          await rm(receipt.sourcePath, { force: true });
          active = null;
          return Object.freeze({ captureId: receipt.captureId, cleanupComplete: true });
        },
      });
    },
  });
}

function createPermissionWitness() {
  const state = { calls: [], statuses: [] };
  return Object.freeze({
    state,
    queue(...statuses) { state.statuses.push(...statuses); },
    port: Object.freeze({
      async resolve({ attemptId, sourceKind, capability, signal }) {
        const status = state.statuses.shift() ?? "GRANTED";
        state.calls.push({ attemptId, sourceKind, capability, status, abortedAtCall: signal.aborted });
        return {
          receiptId: `SECRET_PERMISSION_TOKEN_${state.calls.length}`,
          capability,
          status,
          osPayload: "SECRET-OS-PERMISSION-PAYLOAD",
        };
      },
    }),
  });
}

function createCommitCommandPort() {
  const state = { count: 0, commands: [] };
  return Object.freeze({
    state,
    port: Object.freeze({
      create({ target, importedAsset, clipMetadata }) {
        state.count += 1;
        const ordinal = state.count;
        const createdAt = new Date(Date.parse("2026-08-04T14:00:00.000Z") + ordinal * 2_000).toISOString();
        const committedAt = new Date(Date.parse(createdAt) + 1_000).toISOString();
        const command = Object.freeze({
          operationId: `OP-AUTHORING-PRODUCT-${String(ordinal).padStart(3, "0")}`,
          expectedHeadRevisionId: target.baseRevisionId,
          createdAt,
          committedAt,
          contentRevision: `family-alpha-product@0.0.${ordinal}`,
          bindingId: target.bindingId,
          clipId: target.clipId,
          importedAsset: structuredClone(importedAsset),
          clipMetadata: structuredClone(clipMetadata),
          sourceProducer: { name: "SECRET_SOURCE_PRODUCER_TOKEN", version: "SECRET_TOKEN" },
        });
        state.commands.push(structuredClone(command));
        return command;
      },
    }),
  });
}

function reviewReceipt(input, { wrongAsset = false, ordinal = 1 } = {}) {
  const assetId = wrongAsset ? "asset-wrong-review-binding" : input.importedAsset.assetId;
  const subject = canonicalSha256({
    revisionId: input.revision.revisionId,
    reviewAttemptId: input.reviewAttemptId,
    ordinal,
  }).sha256;
  return createAuthoringProductReviewReceipt({
    reviewAttemptId: input.reviewAttemptId,
    sessionId: input.sessionId,
    familyRevisionId: input.revision.revisionId,
    bindingId: input.bindingId,
    clipId: input.clipId,
    assetId,
    assetSha256: input.importedAsset.sha256,
    buildPlanId: `PLAN-AUTHORING-PRODUCT-${String(ordinal).padStart(3, "0")}`,
    buildSubjectSha256: subject,
    previewId: `sha256:${canonicalSha256({ subject, kind: "preview" }).sha256}`,
    presentationTranscriptSha256: canonicalSha256({ subject, kind: "natural-end-transcript" }).sha256,
    confirmationId: `CONF-AUTHORING-PRODUCT-${String(ordinal).padStart(3, "0")}`,
    authorizationId: `authorization:sha256:${canonicalSha256({ subject, kind: "authorization" }).sha256}`,
    fixtureOnly: true,
    completedAt: new Date(Date.parse("2026-08-04T14:30:00.000Z") + ordinal * 1_000).toISOString(),
  });
}

function createReviewWitness({ rejectFirst = false, wrongFirst = false } = {}) {
  const state = { calls: [] };
  return Object.freeze({
    state,
    port: Object.freeze({
      async run(input) {
        state.calls.push({
          reviewAttemptId: input.reviewAttemptId,
          familyRevisionId: input.revision.revisionId,
          signalInitiallyAborted: input.signal.aborted,
        });
        const ordinal = state.calls.length;
        if (rejectFirst && ordinal === 1) {
          const error = new Error("fixture guardian declined the completed presentation");
          error.code = "FIXTURE_CONFIRMATION_REJECTED";
          throw error;
        }
        return reviewReceipt(input, { wrongAsset: wrongFirst && ordinal === 1, ordinal });
      },
    }),
  });
}

function metadata(transcript) {
  return Object.freeze({
    sourceKind: "family-recording",
    transcript,
    mediaType: "voice",
    language: "zh-CN",
  });
}

async function openSession({
  sessionId,
  binding,
  authoringPort,
  sourcePorts,
  permissionPort,
  commandPort,
  reviewPort,
}) {
  return openAuthoringProductSession({
    sessionId,
    bindingId: binding.bindingId,
    clipId: binding.clips[0].clipId,
    authoringPort,
    sourcePorts,
    permissionPort,
    commitCommandPort: commandPort,
    reviewPort,
  });
}

async function run() {
  await prepareRunRoot();
  const checks = [];
  const check = (name, passed, detail) => {
    if (!passed) throw new Error(`${name}: ${detail}`);
    checks.push({ name, passed: true, detail });
  };

  const baseRevision = JSON.parse(await readFile(BASE_REVISION_PATH, "utf8"));
  const captureBytes = Buffer.from(await readFile(path.join(ASSET_ROOT, "clip-018-1.wav")));
  const captureWitness = createCaptureWitness(captureBytes);
  const workspace = await createFamilyWorkspace({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: WORKSPACE_DIRECTORY,
    repositoryId: "FAMILY-REPO-AUTHORING-PRODUCT-SHELL-001",
    probeCanonicalWav,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
    capturePortFactory: captureWitness.factory,
  });
  for (const binding of baseRevision.bindings) {
    for (const clip of binding.clips) {
      await workspace.authoring.importFile({
        sourcePath: path.join(ASSET_ROOT, `${clip.clipId}.wav`),
        assetId: clip.assetId,
      });
    }
  }
  await workspace.authoring.commitInitialRevision({
    operationId: "OP-AUTHORING-PRODUCT-SEED-001",
    revision: baseRevision,
    at: baseRevision.createdAt,
  });
  const adapter = createFamilyWorkspaceAuthoringAdapter(workspace);
  const permission = createPermissionWitness();
  const commands = createCommitCommandPort();
  check("FamilyWorkspace adapter surface is narrow",
    Object.keys(adapter.authoringPort).sort().join(",") === "commitReplacement,loadHead,profile"
      && adapter.sourcePorts.length === 2,
  "head/commit plus FILE/CAPTURE capabilities only");

  const fileReview = createReviewWitness();
  const fileSession = await openSession({
    sessionId: "authoring-file-happy-001",
    binding: baseRevision.bindings[0],
    authoringPort: adapter.authoringPort,
    sourcePorts: adapter.sourcePorts,
    permissionPort: permission.port,
    commandPort: commands.port,
    reviewPort: fileReview.port,
  });
  check("product API has no confirmation bypass", !("confirm" in fileSession),
    "explicit confirmation remains inside reviewPort");
  const permissionCallsBeforeFile = permission.state.calls.length;
  fileSession.selectSource({
    sourceKind: "FILE",
    assetId: "asset-product-file-001",
    request: { sourcePath: path.join(ASSET_ROOT, "clip-013-1.wav") },
  });
  await fileSession.acquire();
  check("FILE source skips OS permission",
    permission.state.calls.length === permissionCallsBeforeFile
      && fileSession.snapshot().phase === "AWAITING_METADATA",
  "canonical immutable asset is ready");
  fileSession.submitMetadata(metadata("家长文件录音已回听。"));
  await fileSession.commit();
  check("file task commits one durable FamilyRevision",
    fileSession.snapshot().phase === "READY_TO_REVIEW"
      && fileSession.snapshot().facts.durableRevisionPresent
      && !fileSession.snapshot().facts.buildAuthorized,
  fileSession.snapshot().committedRevision.revisionId);
  await fileSession.review();
  check("fixture review receipt completes orchestration without production authority",
    fileSession.snapshot().phase === "COMPLETED"
      && fileSession.snapshot().facts.reviewReceiptPresent
      && !fileSession.snapshot().facts.buildAuthorized
      && !fileSession.snapshot().facts.offlineReady
      && fileReview.state.calls.length === 1,
  "fixture receipt is visible; qualified authorization and target delivery remain separate");
  const fileSnapshotText = JSON.stringify(fileSession.snapshot());
  check("file picker path stays adapter-private",
    !fileSnapshotText.includes("sourcePath")
      && !fileSnapshotText.includes("absolutePath")
      && !fileSnapshotText.includes("SECRET_SOURCE_PRODUCER_TOKEN")
      && !fileSnapshotText.includes(ASSET_ROOT),
  "session contains portable contentPath and the controller-owned public producer identity only");

  permission.queue("DENIED", "GRANTED");
  const captureReview = createReviewWitness();
  const captureSession = await openSession({
    sessionId: "authoring-capture-permission-001",
    binding: baseRevision.bindings[1],
    authoringPort: adapter.authoringPort,
    sourcePorts: adapter.sourcePorts,
    permissionPort: permission.port,
    commandPort: commands.port,
    reviewPort: captureReview.port,
  });
  captureSession.selectSource({
    sourceKind: "CAPTURE",
    assetId: "asset-product-capture-001",
    request: { deviceName: "SECRET-MIC-42", durationSeconds: 1 },
  });
  const capturesBeforeDenial = captureWitness.state.captures;
  await captureSession.acquire();
  check("permission denial has zero source and revision side effects",
    captureSession.snapshot().phase === "FAILED"
      && captureSession.snapshot().failure.category === "DENIED"
      && captureWitness.state.captures === capturesBeforeDenial
      && !captureSession.snapshot().facts.importedAssetPublished
      && !captureSession.snapshot().facts.durableRevisionPresent,
  "capability gate precedes capture");
  check("raw permission and device data stay private",
    !JSON.stringify(captureSession.snapshot()).includes("SECRET-")
      && !JSON.stringify(captureSession.snapshot()).includes("SECRET_PERMISSION_TOKEN")
      && !JSON.stringify(captureSession.snapshot()).includes("deviceName")
      && !JSON.stringify(captureSession.snapshot()).includes("osPayload"),
  "controller derives a content-addressed public receipt and drops adapter-private identity/payload");

  const secretErrorPermissionPort = Object.freeze({
    async resolve() {
      const error = new Error("adapter-private diagnostic");
      error.code = "SECRET_TOKEN_ABC123";
      throw error;
    },
  });
  const secretErrorSession = await openSession({
    sessionId: "authoring-permission-error-redaction-001",
    binding: baseRevision.bindings[2],
    authoringPort: adapter.authoringPort,
    sourcePorts: adapter.sourcePorts,
    permissionPort: secretErrorPermissionPort,
    commandPort: commands.port,
    reviewPort: createReviewWitness().port,
  });
  secretErrorSession.selectSource({
    sourceKind: "CAPTURE",
    assetId: "asset-product-permission-redaction-001",
    request: { deviceName: "SECRET-ERROR-MIC", durationSeconds: 1 },
  });
  await secretErrorSession.acquire();
  check("adapter error code is reduced to a fixed public failure code",
    secretErrorSession.snapshot().phase === "FAILED"
      && secretErrorSession.snapshot().failure.category === "TRANSIENT"
      && secretErrorSession.snapshot().failure.code === "AUTHORING_SESSION_PERMISSION_TRANSIENT"
      && !JSON.stringify(secretErrorSession.snapshot()).includes("SECRET_TOKEN_ABC123")
      && !JSON.stringify(secretErrorSession.snapshot()).includes("SECRET-ERROR-MIC"),
  "adapter-private diagnostics do not enter the session snapshot");
  captureSession.retry();
  await captureSession.acquire();
  check("permission retry reaches canonical capture import",
    captureSession.snapshot().phase === "AWAITING_METADATA"
      && captureWitness.state.captures === capturesBeforeDenial + 1
      && captureWitness.state.discards === capturesBeforeDenial + 1,
  "temporary capture source was discarded");
  captureSession.submitMetadata(metadata("家长现场录音。"));
  await captureSession.commit();
  const reviewCallsBeforeCancel = captureReview.state.calls.length;
  captureSession.cancel();
  check("cancel after commit preserves truthful durable state",
    captureSession.snapshot().phase === "CANCELLED"
      && captureSession.snapshot().facts.durableRevisionPresent
      && !captureSession.snapshot().facts.buildAuthorized
      && captureReview.state.calls.length === reviewCallsBeforeCancel,
  "FamilyRevision remains; review/delivery stay empty");

  const preparationBarrier = { entered: deferred(), release: deferred() };
  const preparationState = { creates: 0, commitCalls: 0, abortObserved: false };
  const delayedCommandPort = Object.freeze({
    async create(input) {
      preparationState.creates += 1;
      input.signal.addEventListener("abort", () => { preparationState.abortObserved = true; }, { once: true });
      preparationBarrier.entered.resolve();
      await preparationBarrier.release.promise;
      return commands.port.create(input);
    },
  });
  const preparationAuthoringPort = Object.freeze({
    loadHead: adapter.authoringPort.loadHead,
    async commitReplacement(command) {
      preparationState.commitCalls += 1;
      return adapter.authoringPort.commitReplacement(command);
    },
  });
  const preparationSession = await openSession({
    sessionId: "authoring-command-prepare-001",
    binding: baseRevision.bindings[2],
    authoringPort: preparationAuthoringPort,
    sourcePorts: adapter.sourcePorts,
    permissionPort: permission.port,
    commandPort: delayedCommandPort,
    reviewPort: createReviewWitness().port,
  });
  preparationSession.selectSource({
    sourceKind: "FILE",
    assetId: "asset-product-command-prepare-001",
    request: { sourcePath: path.join(ASSET_ROOT, "clip-015-1.wav") },
  });
  await preparationSession.acquire();
  preparationSession.submitMetadata(metadata("提交命令准备屏障。"));
  const preparationHead = await workspace.read.loadHead();
  const preparationOutbox = await workspace.read.readOutbox();
  const firstPreparationCommit = preparationSession.commit();
  await preparationBarrier.entered.promise;
  await expectCode(() => preparationSession.commit(), "AUTHORING_SESSION_EFFECT_ACTIVE");
  check("concurrent commit shares one preparation effect",
    preparationState.creates === 1
      && preparationSession.snapshot().phase === "PREPARING_COMMIT",
  "operation ID factory ran once");
  const preparationCancel = preparationSession.cancel();
  preparationBarrier.release.resolve();
  await Promise.all([firstPreparationCommit, preparationCancel]);
  const preparationOutboxAfter = await workspace.read.readOutbox();
  check("cancel waits for command preparation and skips repository commit",
    preparationState.abortObserved
      && preparationState.creates === 1
      && preparationState.commitCalls === 0
      && preparationSession.snapshot().phase === "CANCELLED"
      && preparationSession.snapshot().commitCommand !== null
      && (await workspace.read.loadHead()).revisionId === preparationHead.revisionId
      && preparationOutboxAfter.events.length === preparationOutbox.events.length,
  "prepared command is visible; durable revision remains absent");

  const responseLossCalls = [];
  let loseFirstResponse = true;
  const responseLossAuthoringPort = Object.freeze({
    loadHead: adapter.authoringPort.loadHead,
    async commitReplacement(command) {
      responseLossCalls.push(JSON.stringify(command));
      const receipt = await adapter.authoringPort.commitReplacement(command);
      if (loseFirstResponse) {
        loseFirstResponse = false;
        const error = new Error("fixture response lost after durable commit");
        error.code = "NETWORK_RESPONSE_LOST";
        throw error;
      }
      return receipt;
    },
  });
  const rejectingReview = createReviewWitness({ rejectFirst: true });
  const replaySession = await openSession({
    sessionId: "authoring-response-loss-001",
    binding: baseRevision.bindings[2],
    authoringPort: responseLossAuthoringPort,
    sourcePorts: adapter.sourcePorts,
    permissionPort: permission.port,
    commandPort: commands.port,
    reviewPort: rejectingReview.port,
  });
  replaySession.selectSource({
    sourceKind: "FILE",
    assetId: "asset-product-replay-001",
    request: { sourcePath: path.join(ASSET_ROOT, "clip-015-1.wav") },
  });
  await replaySession.acquire();
  replaySession.submitMetadata(metadata("网络回包丢失后精确重放。"));
  await replaySession.commit();
  check("lost commit response records uncertainty without fake rollback",
    replaySession.snapshot().phase === "FAILED"
      && replaySession.snapshot().failure.stage === "COMMIT"
      && replaySession.snapshot().commitCommand !== null
      && !replaySession.snapshot().facts.durableRevisionPresent,
  "same frozen command is available for reconciliation");
  replaySession.retry();
  await replaySession.commit();
  check("commit retry is byte-exact repository replay",
    responseLossCalls.length === 2
      && responseLossCalls[0] === responseLossCalls[1]
      && replaySession.snapshot().commitReceipt.replayed === true
      && replaySession.snapshot().facts.durableRevisionPresent,
  "one operationId and one immutable command");
  await replaySession.review();
  check("explicit review rejection keeps revision and no authorization",
    replaySession.snapshot().phase === "REJECTED"
      && replaySession.snapshot().facts.durableRevisionPresent
      && !replaySession.snapshot().facts.buildAuthorized,
  "review is retryable with a fresh attempt");
  replaySession.retry();
  await replaySession.review();
  check("review retry uses fresh attempt identity",
    replaySession.snapshot().phase === "COMPLETED"
      && rejectingReview.state.calls.length === 2
      && rejectingReview.state.calls[0].reviewAttemptId !== rejectingReview.state.calls[1].reviewAttemptId,
  "fresh review receipt authorized the same durable revision");

  const staleSession = await openSession({
    sessionId: "authoring-stale-head-001",
    binding: baseRevision.bindings[3],
    authoringPort: adapter.authoringPort,
    sourcePorts: adapter.sourcePorts,
    permissionPort: permission.port,
    commandPort: commands.port,
    reviewPort: createReviewWitness().port,
  });
  const barrier = { entered: deferred(), release: deferred() };
  const delayedAuthoringPort = Object.freeze({
    loadHead: adapter.authoringPort.loadHead,
    async commitReplacement(command) {
      barrier.entered.resolve();
      await barrier.release.promise;
      return adapter.authoringPort.commitReplacement(command);
    },
  });
  const advancingSession = await openSession({
    sessionId: "authoring-advancing-head-001",
    binding: baseRevision.bindings[4],
    authoringPort: delayedAuthoringPort,
    sourcePorts: adapter.sourcePorts,
    permissionPort: permission.port,
    commandPort: commands.port,
    reviewPort: createReviewWitness().port,
  });
  for (const [session, sourceKind, assetId, clipName, text] of [
    [staleSession, "FILE", "asset-product-stale-001", "clip-016-1.wav", "旧基线任务。"],
    [advancingSession, "FILE", "asset-product-advance-001", "clip-017-1.wav", "推进当前基线。"],
  ]) {
    session.selectSource({ sourceKind, assetId, request: { sourcePath: path.join(ASSET_ROOT, clipName) } });
    await session.acquire();
    session.submitMetadata(metadata(text));
  }
  const advancingCommit = advancingSession.commit();
  await barrier.entered.promise;
  await expectCode(() => advancingSession.cancel(), "AUTHORING_SESSION_COMMIT_BARRIER");
  check("commit is a non-abortable truth barrier",
    advancingSession.snapshot().phase === "COMMITTING",
  "close waits for repository outcome");
  barrier.release.resolve();
  await advancingCommit;
  check("settled commit can then be cancelled honestly",
    advancingSession.snapshot().phase === "READY_TO_REVIEW"
      && advancingSession.snapshot().facts.durableRevisionPresent,
  "durable outcome is known");
  advancingSession.cancel();
  const outboxBeforeStale = await workspace.read.readOutbox();
  const headBeforeStale = await workspace.read.loadHead();
  await staleSession.commit();
  const outboxAfterStale = await workspace.read.readOutbox();
  check("stale Family head becomes a fresh-session conflict",
    staleSession.snapshot().phase === "CONFLICT"
      && staleSession.snapshot().failure.category === "CONFLICT"
      && (await workspace.read.loadHead()).revisionId === headBeforeStale.revisionId
      && outboxAfterStale.events.length === outboxBeforeStale.events.length,
  "stale commit made zero repository changes");
  await expectCode(() => staleSession.retry(), "AUTHORING_SESSION_TRANSITION_INVALID");
  check("stale command is not rebased in place", staleSession.snapshot().phase === "CONFLICT",
    "new base requires a new product session");

  const wrongReview = createReviewWitness({ wrongFirst: true });
  const wrongReviewSession = await openSession({
    sessionId: "authoring-review-binding-001",
    binding: baseRevision.bindings[5],
    authoringPort: adapter.authoringPort,
    sourcePorts: adapter.sourcePorts,
    permissionPort: permission.port,
    commandPort: commands.port,
    reviewPort: wrongReview.port,
  });
  wrongReviewSession.selectSource({
    sourceKind: "FILE",
    assetId: "asset-product-review-binding-001",
    request: { sourcePath: path.join(ASSET_ROOT, "clip-018-1.wav") },
  });
  await wrongReviewSession.acquire();
  wrongReviewSession.submitMetadata(metadata("回听回执身份绑定。"));
  await wrongReviewSession.commit();
  await wrongReviewSession.review();
  check("cross-asset review receipt fails closed",
    wrongReviewSession.snapshot().phase === "FAILED"
      && wrongReviewSession.snapshot().failure.category === "INTEGRITY"
      && wrongReviewSession.snapshot().reviewReceipt === null
      && wrongReviewSession.snapshot().facts.durableRevisionPresent,
  "authorization identity did not enter session state");
  wrongReviewSession.retry();
  await wrongReviewSession.review();
  check("fresh correctly bound review receipt succeeds",
    wrongReviewSession.snapshot().phase === "COMPLETED"
      && wrongReviewSession.snapshot().facts.reviewReceiptPresent
      && !wrongReviewSession.snapshot().facts.buildAuthorized
      && wrongReview.state.calls.length === 2,
  "revision/asset/binding/clip all match; fixture authority stays visibly unqualified");

  const currentHead = await workspace.read.loadHead();
  const fakeAsset = Object.freeze({
    assetId: "asset-product-fake-source-001",
    contentPath: `assets/sha256/${baseRevision.bindings[0].clips[0].assetSha256}.wav`,
    bytes: baseRevision.bindings[0].clips[0].assetBytes,
    sha256: baseRevision.bindings[0].clips[0].assetSha256,
    durationMs: 120,
    codec: "WAV_PCM16_16K_MONO",
  });
  let malformedCalls = 0;
  const malformedSource = Object.freeze({
    sourceKind: "FIXTURE_SOURCE",
    requiredCapability: null,
    clipSourceKind: "family-recording",
    async acquire() {
      malformedCalls += 1;
      return {
        importedAsset: malformedCalls === 1
          ? { ...fakeAsset, absolutePath: "C:\\secret\\fixture.wav" }
          : fakeAsset,
      };
    },
  });
  const malformedSession = await openAuthoringProductSession({
    sessionId: "authoring-malformed-source-001",
    bindingId: currentHead.bindings[0].bindingId,
    clipId: currentHead.bindings[0].clips[0].clipId,
    authoringPort: adapter.authoringPort,
    sourcePorts: [malformedSource],
    commitCommandPort: commands.port,
    reviewPort: createReviewWitness().port,
  });
  await expectCode(() => malformedSession.selectSource({
    sourceKind: "UNKNOWN_SOURCE",
    assetId: "asset-product-unknown-source",
    request: {},
  }), "AUTHORING_SESSION_SOURCE_UNAVAILABLE");
  check("unknown source leaves state unchanged", malformedSession.snapshot().phase === "AWAITING_SOURCE",
    "source registry is the extension seam");
  malformedSession.selectSource({
    sourceKind: "FIXTURE_SOURCE",
    assetId: fakeAsset.assetId,
    request: { opaqueFixture: true },
  });
  await malformedSession.acquire();
  check("malformed source receipt is retryable and sanitized",
    malformedSession.snapshot().phase === "FAILED"
      && malformedSession.snapshot().failure.category === "INTEGRITY"
      && malformedSession.snapshot().importedAsset === null
      && !JSON.stringify(malformedSession.snapshot()).includes("absolutePath"),
  "port-private path never entered state");
  malformedSession.retry();
  await malformedSession.acquire();
  check("source retry reuses the same registered adapter",
    malformedSession.snapshot().phase === "AWAITING_METADATA" && malformedCalls === 2,
  "valid public receipt entered the metadata stage");
  await malformedSession.cancel();

  const adapterAbortSource = Object.freeze({
    sourceKind: "ABORTED_SOURCE",
    requiredCapability: null,
    clipSourceKind: "family-recording",
    async acquire() {
      const error = new Error("source picker closed before a candidate was selected");
      error.code = "CAPTURE_REQUEST_ABORTED";
      throw error;
    },
  });
  const adapterAbortSession = await openAuthoringProductSession({
    sessionId: "authoring-adapter-abort-001",
    bindingId: currentHead.bindings[1].bindingId,
    clipId: currentHead.bindings[1].clips[0].clipId,
    authoringPort: adapter.authoringPort,
    sourcePorts: [adapterAbortSource],
    commitCommandPort: commands.port,
    reviewPort: createReviewWitness().port,
  });
  adapterAbortSession.selectSource({
    sourceKind: "ABORTED_SOURCE",
    assetId: "asset-product-adapter-abort-001",
    request: {},
  });
  await adapterAbortSession.acquire();
  const adapterAbortStateId = adapterAbortSession.snapshot().stateId;
  await adapterAbortSession.cancel();
  check("adapter-originated source cancellation is terminal and idempotent",
    adapterAbortSession.snapshot().phase === "CANCELLED"
      && adapterAbortSession.snapshot().failure?.category === "CANCELLED"
      && adapterAbortSession.snapshot().failure?.retryable === false
      && adapterAbortSession.snapshot().stateId === adapterAbortStateId,
  "source cancel does not masquerade as a retryable failure");

  const late = { entered: deferred(), release: deferred(), aborted: false, calls: 0 };
  const delayedSource = Object.freeze({
    sourceKind: "DELAYED_SOURCE",
    requiredCapability: null,
    clipSourceKind: "family-recording",
    async acquire({ signal }) {
      late.calls += 1;
      late.entered.resolve();
      signal.addEventListener("abort", () => { late.aborted = true; }, { once: true });
      await late.release.promise;
      return { importedAsset: { ...fakeAsset, assetId: "asset-product-delayed-001" } };
    },
  });
  const delayedSession = await openAuthoringProductSession({
    sessionId: "authoring-cancel-stale-callback-001",
    bindingId: currentHead.bindings[1].bindingId,
    clipId: currentHead.bindings[1].clips[0].clipId,
    authoringPort: adapter.authoringPort,
    sourcePorts: [delayedSource],
    commitCommandPort: commands.port,
    reviewPort: createReviewWitness().port,
  });
  delayedSession.selectSource({
    sourceKind: "DELAYED_SOURCE",
    assetId: "asset-product-delayed-001",
    request: { fixture: true },
  });
  const delayedAcquire = delayedSession.acquire();
  await late.entered.promise;
  await expectCode(() => delayedSession.acquire(), "AUTHORING_SESSION_EFFECT_ACTIVE");
  const delayedCancel = delayedSession.cancel();
  late.release.resolve();
  await Promise.all([delayedAcquire, delayedCancel]);
  const cancelledStateId = delayedSession.snapshot().stateId;
  check("cancel aborts source and waits for final settlement",
    late.aborted
      && late.calls === 1
      && delayedSession.snapshot().phase === "CANCELLED"
      && delayedSession.snapshot().stateId === cancelledStateId
      && delayedSession.snapshot().importedAsset !== null
      && delayedSession.snapshot().facts.importedAssetPublished,
  "cancel waits for the source settlement barrier; state is final afterwards");

  const pureInitial = createAuthoringProductSessionState({
    sessionId: "authoring-pure-core-001",
    baseRevision: await workspace.read.loadHead(),
    bindingId: currentHead.bindings[2].bindingId,
    clipId: currentHead.bindings[2].clips[0].clipId,
  });
  const sourceEvent = {
    eventId: "pure-event-1",
    expectedRevision: 0,
    type: "SOURCE_SELECTED",
    selection: {
      sourceKind: "FILE",
      assetId: "asset-product-pure-core-001",
      requiredCapability: null,
      clipSourceKind: "family-recording",
    },
  };
  const pureSelected = transitionAuthoringProductSession(pureInitial, sourceEvent);
  const pureDuplicate = transitionAuthoringProductSession(pureSelected, sourceEvent);
  check("pure transition duplicate is idempotent",
    pureDuplicate === pureSelected && pureSelected.sessionRevision === 1,
  pureSelected.stateId);
  await expectCode(() => transitionAuthoringProductSession(pureSelected, {
    ...sourceEvent,
    selection: { ...sourceEvent.selection, assetId: "asset-product-pure-core-002" },
  }), "AUTHORING_SESSION_EVENT_ID_REUSED");
  await expectCode(() => transitionAuthoringProductSession(pureSelected, {
    ...sourceEvent,
    eventId: "pure-event-2",
    expectedRevision: 0,
  }), "AUTHORING_SESSION_REVISION_STALE");
  check("event reuse and stale revision both fail closed", pureSelected.sessionRevision === 1,
    "state identity stayed byte-stable");
  const permissionInitial = createAuthoringProductSessionState({
    sessionId: "authoring-pure-permission-001",
    baseRevision: await workspace.read.loadHead(),
    bindingId: currentHead.bindings[3].bindingId,
    clipId: currentHead.bindings[3].clips[0].clipId,
  });
  const permissionSelected = transitionAuthoringProductSession(permissionInitial, {
    eventId: "permission-event-1",
    expectedRevision: 0,
    type: "SOURCE_SELECTED",
    selection: {
      sourceKind: "CAPTURE",
      assetId: "asset-product-permission-core-001",
      requiredCapability: "MICROPHONE",
      clipSourceKind: "family-recording",
    },
  });
  await expectCode(() => transitionAuthoringProductSession(permissionSelected, {
    eventId: "permission-event-2",
    expectedRevision: 1,
    type: "SOURCE_ACQUISITION_STARTED",
    attemptId: "source-attempt-1",
  }), "AUTHORING_SESSION_PERMISSION_REQUIRED");
  check("pure core blocks permission bypass", permissionSelected.phase === "READY_TO_ACQUIRE",
    "no source effect was admitted");

  const finalHead = await workspace.read.loadHead();
  const finalOutbox = await workspace.read.readOutbox();
  check("all durable changes remain repository-backed",
    finalHead.revisionId === wrongReviewSession.snapshot().committedRevision.revisionId
      && finalOutbox.events.length >= 6,
  "product shell never owns repository internals");
  check("hardware target remains outside this package",
    [fileSession, replaySession, wrongReviewSession].every((session) => !session.snapshot().facts.offlineReady),
  "BOARD_TARGET and device delivery are separate evidence gates");

  const report = {
    schemaVersion: 1,
    profile: "companion-authoring-product-shell-acceptance-v1",
    generatedAt: "2026-08-04T15:00:00.000Z",
    checksPassed: checks.length,
    checks,
    officialWorkflowEvidence: [
      "Yoto:record-save-listen-back-rename-playlist-link",
      "tiptoi:select-download-install-disconnect-start",
      "LeapReader:content-trigger-usb-download-install",
      "Tonies:save-assign-upload-sync",
    ],
    boundaries: {
      productSession: "framework-neutral-state-machine-and-use-case-ports",
      storage: "FamilyWorkspace-public-capabilities-only",
      confirmation: "verified-review-port-only-no-direct-confirm-api",
      deviceDelivery: "OUT_OF_SCOPE_EVIDENCE_PENDING",
      boardTarget: "UNRESOLVED",
      hardwareImpact: "NONE",
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), bytes, { flag: "wx" });
  console.log(`Authoring product shell acceptance: ${checks.length}/${checks.length}`);
  console.log(`Authoring product shell report SHA-256: ${sha256(bytes)}`);
}

const lock = await acquireLock();
try {
  await run();
} finally {
  try { await lock.close(); } catch { /* acceptance result remains authoritative */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* lock cleanup is best effort */ }
}
