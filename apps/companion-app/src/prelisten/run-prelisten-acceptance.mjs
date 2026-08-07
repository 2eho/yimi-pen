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
import { resolveVerifiedPreviewClip } from "./local-audio-assets.mjs";
import {
  createAudioPlayerPrelistenPort,
  createPrelistenPresentationSession,
  PrelistenPresentationError,
} from "./presentation-session.mjs";

const APP_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-prelisten-validation");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-prelisten-validation.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".companion-prelisten-validation-root");
const MARKER_TEXT = "yimi-companion-prelisten-validation-root-v1\n";
const ALPHA_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const TRUST_ROOT = path.join(REPO_ROOT, "hardware/evt0/confirmation-trust-v1/golden");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(target) {
  try { return await lstat(target); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  try {
    return await open(LOCK_PATH, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("companion prelisten acceptance has an active or stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("prelisten validation root must be an owned directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("prelisten validation root escaped build/");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) throw new Error("prelisten validation root lacks its ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { flag: "wx" });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function codeOf(error) {
  return error?.code ?? error?.name ?? "UNKNOWN";
}

class ScriptedNaturalEndBackend {
  constructor(script, { stopNeverResolves = false, stopDelayMs = 0 } = {}) {
    this.script = [...script];
    this.stopNeverResolves = stopNeverResolves;
    this.stopDelayMs = stopDelayMs;
    this.current = null;
    this.receipt = null;
    this.generation = 0;
    this.stopCount = 0;
    this.evidenceClass = "scripted-fixture";
  }

  async play(uri, hooks) {
    await this.stop();
    const step = this.script.shift();
    if (!step) throw new Error("script exhausted");
    const current = {
      generation: ++this.generation,
      uri,
      hooks,
      stopped: false,
      timer: null,
    };
    this.current = current;
    const invoke = () => {
      if (this.current !== current || current.stopped) return;
      if (step.type === "error") {
        this.current = null;
        hooks.onError(step.message ?? "scripted backend failure");
        return;
      }
      if (step.type === "end-no-receipt") {
        this.current = null;
        hooks.onEnd();
        return;
      }
      if (step.type === "end" || step.type === "duplicate") {
        this.current = null;
        this.receipt = Object.freeze({
          playbackId: `scripted:${current.generation}`,
          backend: "scripted",
          evidenceClass: this.evidenceClass,
          generation: current.generation,
          uri,
          processId: null,
          executableSha256: null,
          startedAt: step.startedAt ?? step.completedAt,
          completedAt: step.completedAt,
          elapsedMs: step.elapsedMs ?? 1,
          completion: "natural-end",
          exitCode: 0,
          signal: null,
        });
        hooks.onEnd();
        if (step.type === "duplicate") queueMicrotask(() => hooks.onEnd());
      }
    };
    if (step.type !== "never") current.timer = setTimeout(invoke, step.delayMs ?? 0);
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
    const current = this.current;
    if (!current) return;
    this.stopCount += 1;
    current.stopped = true;
    this.current = null;
    // Deliberately leave a late timer alive; the generation/current guard must suppress it.
    if (this.stopNeverResolves) await new Promise(() => {});
    if (this.stopDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.stopDelayMs));
  }
}

function sessionClock(openedAt, confirmedAt) {
  const values = [openedAt, confirmedAt];
  return { now: () => values.length > 1 ? values.shift() : values[0] };
}

function resolverFor(root, absolutePathBySha256 = null) {
  return (clip) => resolveVerifiedPreviewClip({ clip, assetRoot: root, absolutePathBySha256 });
}

function createDeferredResolver(resolved) {
  let release;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const pending = new Promise((resolve) => { release = () => resolve(resolved); });
  return {
    resolver: () => {
      markStarted();
      return pending;
    },
    started,
    release,
  };
}

function createSession({ challenge, preview, backend, clock, resolver = resolverFor(ALPHA_ROOT) }) {
  const playbackPort = createAudioPlayerPrelistenPort({
    backend,
    clock: { now: () => challenge.issuedAt },
    defaultTimeoutMs: 500,
  });
  const session = createPrelistenPresentationSession({
    sessionId: `acceptance:${Math.random().toString(16).slice(2)}`,
    challenge,
    preview,
    clipResolver: resolver,
    playbackPort,
    clock,
  });
  return { session, playbackPort };
}

async function run() {
  await prepareRunRoot();
  const [challenge, goldenTranscript, goldenConfirmation] = await Promise.all([
    readJson(path.join(TRUST_ROOT, "challenge.json")),
    readJson(path.join(TRUST_ROOT, "presentation-transcript.json")),
    readJson(path.join(ALPHA_ROOT, "confirmation.json")),
  ]);
  const { preview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath: path.join(ALPHA_ROOT, "draft.json") });
  const playbackEvents = goldenTranscript.events.filter((event) => event.kind === "CLIP_PLAYBACK_COMPLETED");
  const successBackend = new ScriptedNaturalEndBackend(playbackEvents.map((event) => ({
    type: "end",
    completedAt: event.occurredAt,
  })));
  const success = createSession({
    challenge,
    preview,
    backend: successBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  success.session.open();
  const eventsBeforeEarlyConfirm = success.session.snapshot().events.length;
  let earlyCode = null;
  try {
    success.session.confirm({ confirmationId: goldenConfirmation.confirmationId });
  } catch (error) {
    earlyCode = codeOf(error);
  }
  const earlyZeroEvent = success.session.snapshot().events.length === eventsBeforeEarlyConfirm;
  await success.session.playAll();
  const readySnapshot = success.session.snapshot();
  const completedWithoutAutoConfirm = readySnapshot.state === "READY_TO_CONFIRM"
    && readySnapshot.events.at(-1)?.kind === "CLIP_PLAYBACK_COMPLETED";
  const completed = success.session.confirm({ confirmationId: goldenConfirmation.confirmationId });

  const retryBackend = new ScriptedNaturalEndBackend([
    { type: "error" },
    { type: "end", completedAt: playbackEvents[0].occurredAt },
  ]);
  const retry = createSession({
    challenge,
    preview,
    backend: retryBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  retry.session.open();
  let backendFailureCode = null;
  try { await retry.session.playNext(); } catch (error) { backendFailureCode = codeOf(error); }
  const failureSnapshot = retry.session.snapshot();
  const backendFailureNoCompletion = backendFailureCode === "PRELISTEN_BACKEND_FAILED"
    && failureSnapshot.completedClipCount === 0
    && failureSnapshot.events.filter((event) => event.kind === "CLIP_PLAYBACK_COMPLETED").length === 0;
  await retry.session.playNext();
  const retrySameClip = retry.session.snapshot().events.at(-1)?.clipId === playbackEvents[0].clipId;

  const timeoutBackend = new ScriptedNaturalEndBackend([{ type: "never" }]);
  const timeout = createSession({
    challenge,
    preview,
    backend: timeoutBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  timeout.session.open();
  let timeoutCode = null;
  try { await timeout.session.playNext({ timeoutMs: 20 }); } catch (error) { timeoutCode = codeOf(error); }
  const timeoutNoCompletion = timeoutCode === "PRELISTEN_PLAYBACK_TIMEOUT"
    && timeout.session.snapshot().completedClipCount === 0
    && timeoutBackend.stopCount >= 1;

  const hangingStopBackend = new ScriptedNaturalEndBackend(
    [{ type: "never" }],
    { stopNeverResolves: true },
  );
  const hangingStop = createSession({
    challenge,
    preview,
    backend: hangingStopBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  hangingStop.session.open();
  const hangingStopOutcome = await Promise.race([
    hangingStop.session.playNext({ timeoutMs: 20 }).then(
      () => "unexpected-success",
      (error) => codeOf(error),
    ),
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 80)),
  ]);
  const hangingRetryOutcome = await Promise.race([
    hangingStop.session.playNext({ timeoutMs: 20 }).then(
      () => "unexpected-success",
      (error) => codeOf(error),
    ),
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 80)),
  ]);
  const hangingStopDoesNotBlockRejection = hangingStopOutcome === "PRELISTEN_PLAYBACK_TIMEOUT"
    && hangingRetryOutcome === "PRELISTEN_BACKEND_STOPPING"
    && hangingStop.session.snapshot().completedClipCount === 0
    && hangingStopBackend.stopCount >= 1;

  const delayedStopBackend = new ScriptedNaturalEndBackend([
    { type: "never" },
    { type: "end", completedAt: playbackEvents[0].occurredAt },
  ], { stopDelayMs: 100 });
  const delayedStop = createSession({
    challenge,
    preview,
    backend: delayedStopBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  delayedStop.session.open();
  let delayedTimeoutCode = null;
  try { await delayedStop.session.playNext({ timeoutMs: 20 }); } catch (error) { delayedTimeoutCode = codeOf(error); }
  let cleanupBarrierCode = null;
  try { await delayedStop.session.playNext({ timeoutMs: 200 }); } catch (error) { cleanupBarrierCode = codeOf(error); }
  await new Promise((resolve) => setTimeout(resolve, 120));
  await delayedStop.session.playNext({ timeoutMs: 200 });
  const retryAfterCleanupUsesFreshPlayer = delayedTimeoutCode === "PRELISTEN_PLAYBACK_TIMEOUT"
    && cleanupBarrierCode === "PRELISTEN_BACKEND_STOPPING"
    && delayedStop.session.snapshot().completedClipCount === 1;

  const abortBackend = new ScriptedNaturalEndBackend([{ type: "never" }]);
  const aborted = createSession({
    challenge,
    preview,
    backend: abortBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  aborted.session.open();
  const abortController = new AbortController();
  const abortedAttempt = aborted.session.playNext({ signal: abortController.signal, timeoutMs: 200 });
  setTimeout(() => abortController.abort(), 5);
  let abortCode = null;
  try { await abortedAttempt; } catch (error) { abortCode = codeOf(error); }
  const abortNoCompletion = abortCode === "PRELISTEN_PLAYBACK_ABORTED"
    && aborted.session.snapshot().completedClipCount === 0;

  const cancelBackend = new ScriptedNaturalEndBackend([{ type: "never" }]);
  const cancelled = createSession({
    challenge,
    preview,
    backend: cancelBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  cancelled.session.open();
  const cancelledAttempt = cancelled.session.playNext({ timeoutMs: 200 })
    .then(() => null, (error) => codeOf(error));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await cancelled.session.cancel();
  const cancelCode = await cancelledAttempt;
  const cancelNoCompletion = cancelCode === "PRELISTEN_SESSION_CANCELLED"
    && cancelled.session.snapshot().state === "CANCELLED"
    && cancelled.session.snapshot().completedClipCount === 0;

  const missingReceiptBackend = new ScriptedNaturalEndBackend([{ type: "end-no-receipt" }]);
  const missingReceipt = createSession({
    challenge,
    preview,
    backend: missingReceiptBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  missingReceipt.session.open();
  let missingReceiptCode = null;
  try { await missingReceipt.session.playNext(); } catch (error) { missingReceiptCode = codeOf(error); }

  const duplicateBackend = new ScriptedNaturalEndBackend([{
    type: "duplicate",
    completedAt: playbackEvents[0].occurredAt,
  }]);
  const duplicate = createSession({
    challenge,
    preview,
    backend: duplicateBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  duplicate.session.open();
  await duplicate.session.playNext();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const duplicateSingleCompletion = duplicate.session.snapshot().events
    .filter((event) => event.kind === "CLIP_PLAYBACK_COMPLETED").length === 1;

  const staleBackend = new ScriptedNaturalEndBackend([
    { type: "end", completedAt: playbackEvents[0].occurredAt, delayMs: 60 },
    { type: "end", completedAt: playbackEvents[0].occurredAt, delayMs: 0 },
  ]);
  const stale = createSession({
    challenge,
    preview,
    backend: staleBackend,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  stale.session.open();
  try { await stale.session.playNext({ timeoutMs: 10 }); } catch { /* expected timeout */ }
  await stale.session.playNext({ timeoutMs: 200 });
  await new Promise((resolve) => setTimeout(resolve, 70));
  const staleSuppressed = stale.session.snapshot().events
    .filter((event) => event.kind === "CLIP_PLAYBACK_COMPLETED").length === 1;

  const firstClip = preview.bindings[0].clips[0];
  const firstResolved = await resolverFor(ALPHA_ROOT)(firstClip);

  const cancelResolveControl = createDeferredResolver(firstResolved);
  const cancelResolveBackend = new ScriptedNaturalEndBackend([{
    type: "end",
    completedAt: playbackEvents[0].occurredAt,
  }]);
  const cancelResolve = createSession({
    challenge,
    preview,
    backend: cancelResolveBackend,
    resolver: cancelResolveControl.resolver,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  cancelResolve.session.open();
  const cancelledResolveAttempt = cancelResolve.session.playNext().then(
    () => null,
    (error) => codeOf(error),
  );
  await cancelResolveControl.started;
  await cancelResolve.session.cancel();
  const cancelledResolveCode = await Promise.race([
    cancelledResolveAttempt,
    new Promise((resolve) => setTimeout(() => resolve("still-pending"), 80)),
  ]);
  cancelResolveControl.release();
  const cancelDuringResolveStaysCancelled = cancelledResolveCode === "PRELISTEN_SESSION_CANCELLED"
    && cancelResolve.session.snapshot().state === "CANCELLED"
    && cancelResolve.session.snapshot().completedClipCount === 0
    && cancelResolveBackend.script.length === 1;

  const concurrentControl = createDeferredResolver(firstResolved);
  const concurrentBackend = new ScriptedNaturalEndBackend([{
    type: "end",
    completedAt: playbackEvents[0].occurredAt,
  }]);
  const concurrent = createSession({
    challenge,
    preview,
    backend: concurrentBackend,
    resolver: concurrentControl.resolver,
    clock: sessionClock(goldenTranscript.openedAt, goldenConfirmation.confirmedAt),
  });
  concurrent.session.open();
  const firstConcurrentAttempt = concurrent.session.playNext();
  await concurrentControl.started;
  let concurrentCode = null;
  try { await concurrent.session.playNext(); } catch (error) { concurrentCode = codeOf(error); }
  concurrentControl.release();
  await firstConcurrentAttempt;
  const concurrentPlayRejectedWithoutDuplicate = concurrentCode === "PRELISTEN_STATE_INVALID"
    && concurrent.session.snapshot().completedClipCount === 1
    && concurrent.session.snapshot().events.filter((event) => event.kind === "CLIP_PLAYBACK_COMPLETED").length === 1;

  const tamperRoot = path.join(RUN_ROOT, "tampered-assets");
  const tamperTarget = path.join(tamperRoot, ...firstClip.assetPath.split("/"));
  await mkdir(path.dirname(tamperTarget), { recursive: true });
  await copyFile(path.join(ALPHA_ROOT, ...firstClip.assetPath.split("/")), tamperTarget);
  const tamperedBytes = Buffer.from(await readFile(tamperTarget));
  tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
  await writeFile(tamperTarget, tamperedBytes);
  let tamperCode = null;
  try { await resolveVerifiedPreviewClip({ clip: firstClip, assetRoot: tamperRoot }); } catch (error) { tamperCode = codeOf(error); }
  let escapeCode = null;
  try {
    await resolveVerifiedPreviewClip({ clip: { ...firstClip, assetPath: "../outside.wav" }, assetRoot: ALPHA_ROOT });
  } catch (error) { escapeCode = codeOf(error); }

  const gates = {
    realFixtureAssetBytesVerified: success.session.snapshot().playbackReceipts.length === playbackEvents.length,
    goldenPresentationTranscriptExact: JSON.stringify(completed.transcript) === JSON.stringify(goldenTranscript),
    goldenConfirmationExact: JSON.stringify(completed.confirmation) === JSON.stringify(goldenConfirmation),
    earlyConfirmationRejectedZeroEvent: earlyCode === "PRELISTEN_CONFIRMATION_TOO_EARLY" && earlyZeroEvent,
    playbackCompletionDoesNotAutoConfirm: completedWithoutAutoConfirm,
    backendFailureProducesNoCompletion: backendFailureNoCompletion,
    failedClipCanRetrySameIdentity: retrySameClip,
    timeoutProducesNoCompletionAndStopsBackend: timeoutNoCompletion,
    hangingBackendStopDoesNotBlockTimeoutRejection: hangingStopDoesNotBlockRejection,
    retryWaitsForCleanupThenUsesFreshPlayer: retryAfterCleanupUsesFreshPlayer,
    abortProducesNoCompletion: abortNoCompletion,
    explicitStopCancelsPendingPlayback: cancelNoCompletion,
    endWithoutNaturalReceiptRejected: missingReceiptCode === "PRELISTEN_NATURAL_END_MISSING",
    duplicateEndProducesOneCompletion: duplicateSingleCompletion,
    stoppedGenerationLateEndSuppressed: staleSuppressed,
    cancelDuringAssetResolveCannotReviveSession: cancelDuringResolveStaysCancelled,
    concurrentPlayNextRejectedWithoutDuplicate: concurrentPlayRejectedWithoutDuplicate,
    assetHashTamperRejectedBeforePlayback: tamperCode === "AUDIO_ASSET_HASH_MISMATCH",
    assetPathEscapeRejected: escapeCode === "AUDIO_ASSET_PATH_INVALID",
  };
  const failures = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const report = {
    schemaVersion: 1,
    profile: "companion-prelisten-acceptance-v1",
    fixtureOnly: true,
    scope: {
      actualAssetBytesRead: true,
      scriptedNaturalEndCallbacks: true,
      actualPlaybackCallbackIncluded: false,
      hostAudioEndpointUsed: false,
      operatorAudibilityWitnessIncluded: false,
      targetDeviceAudioIncluded: false,
    },
    previewId: preview.previewId,
    challengeId: challenge.challengeId,
    transcriptSha256: completed.transcript.transcriptSha256,
    requiredClipCount: playbackEvents.length,
    playbackReceiptCount: success.session.snapshot().playbackReceipts.length,
    negatives: {
      earlyCode,
      backendFailureCode,
      timeoutCode,
      abortCode,
      cancelCode,
      missingReceiptCode,
      cancelledResolveCode,
      concurrentCode,
      tamperCode,
      escapeCode,
    },
    gates,
  };
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), bytes, { flag: "wx" });
  console.log(`Companion prelisten acceptance: ${Object.keys(gates).length - failures.length}/${Object.keys(gates).length}`);
  console.log(`Companion prelisten report SHA-256: ${sha256(bytes)}`);
  if (failures.length) throw new Error(`companion prelisten gates failed: ${failures.join(", ")}`);
}

const lock = await acquireLock();
try {
  await run();
} finally {
  try { await lock.close(); } catch { /* result above remains authoritative */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* result above remains authoritative */ }
}
