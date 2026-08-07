import { EventEmitter } from "node:events";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FfplayAudioBackend,
  HostAudioError,
  recordCanonicalWavFromDshow,
  runHostAudioProcess,
  terminateChildAndWait,
} from "./ffmpeg-host-audio.mjs";

const APP_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-host-audio-validation");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-host-audio-validation.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".companion-host-audio-validation-root");
const MARKER_TEXT = "yimi-companion-host-audio-validation-root-v1\n";

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
    if (error?.code === "EEXIST") throw new Error("host audio acceptance has an active or stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("host audio validation root must be an owned directory");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) throw new Error("host audio validation root lacks its ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { flag: "wx" });
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function captureError(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

class FakeChild extends EventEmitter {
  constructor({ closeOnSignal = null, closeDelayMs = 0 } = {}) {
    super();
    this.pid = 4242;
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.closeOnSignal = closeOnSignal;
    this.closeDelayMs = closeDelayMs;
    this.killSignals = [];
  }

  kill(signal = "SIGTERM") {
    this.killSignals.push(signal);
    if (this.closeOnSignal === signal) {
      this.exitCode = 0;
      this.signalCode = signal;
      if (this.closeDelayMs > 0) setTimeout(() => this.emit("close", 0, signal), this.closeDelayMs);
      else queueMicrotask(() => this.emit("close", 0, signal));
    }
    return true;
  }
}

async function partialFilesFor(outputPath) {
  const prefix = `${path.basename(outputPath)}.partial-`;
  return (await readdir(path.dirname(outputPath))).filter((name) => name.startsWith(prefix));
}

async function run() {
  await prepareRunRoot();

  const preAbortedController = new AbortController();
  preAbortedController.abort();
  let preAbortedSpawnCount = 0;
  const preAbortedError = await captureError(() => runHostAudioProcess({
    executable: "PREABORT_FIXTURE",
    args: [],
    timeoutMs: 1_000,
    signal: preAbortedController.signal,
    spawnProcess: () => {
      preAbortedSpawnCount += 1;
      return new FakeChild();
    },
  }));
  const preAbortRejectsBeforeSpawn = preAbortedError?.code === "HOST_AUDIO_PROCESS_ABORTED"
    && preAbortedError.details?.cleanupComplete === true
    && preAbortedSpawnCount === 0;

  const naturalChild = new FakeChild();
  const naturalResult = await runHostAudioProcess({
    executable: "NATURAL_FIXTURE",
    args: [],
    timeoutMs: 1_000,
    spawnProcess: () => {
      queueMicrotask(() => {
        naturalChild.exitCode = 0;
        naturalChild.emit("close", 0, null);
      });
      return naturalChild;
    },
  });
  const naturalCloseCleansLifecycleListeners = naturalResult.code === 0
    && naturalChild.listenerCount("close") === 0
    && naturalChild.listenerCount("error") === 0
    && naturalChild.stdout.listenerCount("data") === 0
    && naturalChild.stderr.listenerCount("data") === 0;

  const timeoutError = await captureError(() => runHostAudioProcess({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 40,
  }));
  const timeoutWaitedForClose = timeoutError?.code === "HOST_AUDIO_PROCESS_TIMEOUT"
    && timeoutError.details?.cleanupComplete === true
    && !processAlive(timeoutError.details?.pid);

  const abortController = new AbortController();
  const abortRun = runHostAudioProcess({
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 5_000,
    signal: abortController.signal,
  });
  setTimeout(() => abortController.abort(), 40);
  const abortError = await captureError(() => abortRun);
  const abortWaitedForClose = abortError?.code === "HOST_AUDIO_PROCESS_ABORTED"
    && abortError.details?.cleanupComplete === true
    && !processAlive(abortError.details?.pid);

  const escalationChild = new FakeChild({ closeOnSignal: "SIGKILL" });
  const escalation = await terminateChildAndWait(escalationChild, {
    graceTimeoutMs: 10,
    forceTimeoutMs: 40,
  });
  const forceEscalationClosedAndCleanedListeners = escalation.forced === true
    && escalationChild.killSignals.join(",") === "SIGTERM,SIGKILL"
    && escalationChild.listenerCount("close") === 0;

  const exitedWaitingForCloseChild = new FakeChild({ closeOnSignal: "SIGTERM", closeDelayMs: 30 });
  const exitedWaitingForCloseResult = await terminateChildAndWait(exitedWaitingForCloseChild, {
    graceTimeoutMs: 5,
    forceTimeoutMs: 100,
  });
  const exitBeforeCloseIsNotMisreportedAsForced = exitedWaitingForCloseResult.forced === false
    && exitedWaitingForCloseChild.killSignals.join(",") === "SIGTERM"
    && exitedWaitingForCloseChild.listenerCount("close") === 0;

  const stuckChild = new FakeChild();
  const stuckError = await captureError(() => terminateChildAndWait(stuckChild, {
    graceTimeoutMs: 10,
    forceTimeoutMs: 10,
  }));
  const stuckProcessFailsClosedAndDisposesCloseLatch = stuckError?.code === "HOST_AUDIO_PROCESS_CLEANUP_TIMEOUT"
    && stuckError.details?.cleanupComplete === false
    && stuckChild.listenerCount("close") === 0;

  const ffplayChild = new FakeChild({ closeOnSignal: "SIGTERM", closeDelayMs: 20 });
  const backend = new FfplayAudioBackend({
    ffplay: { path: "PINNED_FFPLAY", sha256: "f".repeat(64) },
    spawnProcess: () => {
      queueMicrotask(() => ffplayChild.emit("spawn"));
      return ffplayChild;
    },
  });
  let callbackCount = 0;
  await backend.play("fixture.wav", {
    onEnd: () => { callbackCount += 1; },
    onError: () => { callbackCount += 1; },
  });
  const stopStartedAt = performance.now();
  await Promise.all([backend.stop(), backend.stop()]);
  const ffplayStopElapsedMs = performance.now() - stopStartedAt;
  const ffplayStopWaitedForCloseWithoutCallback = ffplayStopElapsedMs >= 15
    && ffplayStopElapsedMs < 250
    && ffplayChild.killSignals.length === 1
    && ffplayChild.listenerCount("close") === 0
    && callbackCount === 0;

  let cleanupFailureSpawnCount = 0;
  const cleanupFailureChild = new FakeChild();
  const cleanupFailureBackend = new FfplayAudioBackend({
    ffplay: { path: "PINNED_FFPLAY", sha256: "e".repeat(64) },
    spawnProcess: () => {
      cleanupFailureSpawnCount += 1;
      queueMicrotask(() => cleanupFailureChild.emit("spawn"));
      return cleanupFailureChild;
    },
    terminateProcess: async () => {
      throw new HostAudioError("HOST_AUDIO_PROCESS_CLEANUP_TIMEOUT", "fixture cleanup timeout", {
        cleanupComplete: false,
      });
    },
  });
  await cleanupFailureBackend.play("cleanup-failure.wav", { onEnd: () => {}, onError: () => {} });
  const cleanupFailure = await captureError(() => cleanupFailureBackend.stop());
  const blockedReplay = await captureError(() => cleanupFailureBackend.play(
    "must-not-start.wav",
    { onEnd: () => {}, onError: () => {} },
  ));
  const cleanupFailureBlocksFuturePlayback = cleanupFailure?.code === "HOST_AUDIO_PROCESS_CLEANUP_TIMEOUT"
    && blockedReplay?.code === "HOST_AUDIO_PROCESS_CLEANUP_TIMEOUT"
    && cleanupFailureSpawnCount === 1;

  const startFailureChild = new FakeChild();
  const startFailureBackend = new FfplayAudioBackend({
    ffplay: { path: "PINNED_FFPLAY", sha256: "d".repeat(64) },
    spawnProcess: () => {
      queueMicrotask(() => {
        startFailureChild.emit("error", new Error("fixture spawn failure"));
        startFailureChild.exitCode = 1;
        startFailureChild.emit("close", 1, null);
      });
      return startFailureChild;
    },
  });
  const startFailureError = await captureError(() => startFailureBackend.play(
    "start-failure.wav",
    { onEnd: () => {}, onError: () => {} },
  ));
  const ffplayStartFailureWaitsForClose = startFailureError?.code === "HOST_AUDIO_PROCESS_START_FAILED"
    && startFailureError.details?.cleanupComplete === true
    && startFailureChild.listenerCount("close") === 0
    && startFailureChild.listenerCount("error") === 0
    && startFailureChild.stderr.listenerCount("data") === 0;

  const runtimeErrorChild = new FakeChild({ closeOnSignal: "SIGTERM", closeDelayMs: 30 });
  const runtimeRetryChild = new FakeChild({ closeOnSignal: "SIGTERM" });
  let runtimeErrorCallbacks = 0;
  let runtimeSpawnCount = 0;
  const runtimeErrorBackend = new FfplayAudioBackend({
    ffplay: { path: "PINNED_FFPLAY", sha256: "c".repeat(64) },
    spawnProcess: () => {
      runtimeSpawnCount += 1;
      const child = runtimeSpawnCount === 1 ? runtimeErrorChild : runtimeRetryChild;
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
  });
  await runtimeErrorBackend.play("runtime-error.wav", {
    onEnd: () => { runtimeErrorCallbacks += 100; },
    onError: () => { runtimeErrorCallbacks += 1; },
  });
  runtimeErrorChild.emit("error", new Error("fixture runtime failure"));
  runtimeErrorChild.emit("error", new Error("duplicate fixture runtime failure"));
  const retryAfterRuntimeError = runtimeErrorBackend.play(
    "runtime-retry.wav",
    { onEnd: () => { runtimeErrorCallbacks += 100; }, onError: () => { runtimeErrorCallbacks += 10; } },
  );
  await new Promise((resolve) => setTimeout(resolve, 8));
  const runtimeRetryWaitedForClose = runtimeSpawnCount === 1
    && runtimeErrorChild.killSignals.length === 1
    && runtimeErrorCallbacks === 1;
  await retryAfterRuntimeError;
  await runtimeErrorBackend.stop();
  const ffplayRuntimeErrorStopsBeforeRetry = runtimeRetryWaitedForClose
    && runtimeSpawnCount === 2
    && runtimeRetryChild.killSignals.length === 1
    && runtimeErrorCallbacks === 1
    && runtimeErrorChild.listenerCount("close") === 0
    && runtimeErrorChild.listenerCount("error") === 0
    && runtimeErrorChild.stderr.listenerCount("data") === 0;

  const outputPath = path.join(RUN_ROOT, "capture.wav");
  let failedStagingPath = null;
  let failedCaptureArgs = null;
  const partialError = await captureError(() => recordCanonicalWavFromDshow({
    ffmpeg: { path: "FFMPEG_FIXTURE" },
    ffprobe: { path: "FFPROBE_FIXTURE" },
    deviceName: "DEVICE_FIXTURE",
    durationSeconds: 1,
    outputPath,
    processRunner: async ({ args }) => {
      failedCaptureArgs = args;
      failedStagingPath = args.at(-1);
      await writeFile(failedStagingPath, "partial", "utf8");
      throw new HostAudioError("HOST_AUDIO_PROCESS_TIMEOUT", "fixture timeout");
    },
  }));
  const failedCaptureRemovesOnlyOwnedPartial = partialError?.code === "HOST_AUDIO_PROCESS_TIMEOUT"
    && !(await exists(outputPath))
    && !(await exists(failedStagingPath))
    && (await partialFilesFor(outputPath)).length === 0
    && failedStagingPath.endsWith(".wav")
    && failedCaptureArgs[failedCaptureArgs.lastIndexOf("-f") + 1] === "wav";

  const probeError = await captureError(() => recordCanonicalWavFromDshow({
    ffmpeg: { path: "FFMPEG_FIXTURE" },
    ffprobe: { path: "FFPROBE_FIXTURE" },
    deviceName: "DEVICE_FIXTURE",
    durationSeconds: 1,
    outputPath,
    processRunner: async ({ args }) => {
      await writeFile(args.at(-1), "complete-but-invalid", "utf8");
      return { code: 0, signal: null, stdout: "", stderr: "" };
    },
    probeWav: async () => { throw new HostAudioError("AUDIO_PROBE_FAILED", "fixture probe failure"); },
  }));
  const failedProbeRemovesPartial = probeError?.code === "AUDIO_PROBE_FAILED"
    && !(await exists(outputPath))
    && (await partialFilesFor(outputPath)).length === 0;

  const publishRaceError = await captureError(() => recordCanonicalWavFromDshow({
    ffmpeg: { path: "FFMPEG_FIXTURE" },
    ffprobe: { path: "FFPROBE_FIXTURE" },
    deviceName: "DEVICE_FIXTURE",
    durationSeconds: 1,
    outputPath,
    processRunner: async ({ args }) => {
      await writeFile(args.at(-1), "candidate", "utf8");
      return { code: 0, signal: null, stdout: "", stderr: "" };
    },
    probeWav: async () => ({ durationMs: 1_000, codecProfile: "WAV_PCM16_16K_MONO" }),
    publishFile: async (_source, target) => {
      await writeFile(target, "concurrent-owner", { encoding: "utf8", flag: "wx" });
      const error = new Error("fixture exclusive publish collision");
      error.code = "EEXIST";
      throw error;
    },
  }));
  const publishCollisionPreservesExistingOutput = publishRaceError?.code === "EEXIST"
    && await readFile(outputPath, "utf8") === "concurrent-owner"
    && (await partialFilesFor(outputPath)).length === 0;
  await rm(outputPath, { force: true });

  let transientCleanupAttempts = 0;
  const recorded = await recordCanonicalWavFromDshow({
    ffmpeg: { path: "FFMPEG_FIXTURE" },
    ffprobe: { path: "FFPROBE_FIXTURE" },
    deviceName: "DEVICE_FIXTURE",
    durationSeconds: 1,
    outputPath,
    processRunner: async ({ args }) => {
      await writeFile(args.at(-1), "canonical-fixture", "utf8");
      return { code: 0, signal: null, stdout: "", stderr: "" };
    },
    probeWav: async () => ({ durationMs: 1_000, codecProfile: "WAV_PCM16_16K_MONO" }),
    removeFile: async (...args) => {
      transientCleanupAttempts += 1;
      if (transientCleanupAttempts === 1) throw new Error("fixture transient cleanup failure");
      return rm(...args);
    },
  });
  const successfulCapturePublishesAfterProbe = recorded.outputPath === outputPath
    && await readFile(outputPath, "utf8") === "canonical-fixture"
    && (await partialFilesFor(outputPath)).length === 0
    && transientCleanupAttempts === 2;

  const cleanupFailureOutputPath = path.join(RUN_ROOT, "capture-cleanup-failure.wav");
  const publishedCleanupError = await captureError(() => recordCanonicalWavFromDshow({
    ffmpeg: { path: "FFMPEG_FIXTURE" },
    ffprobe: { path: "FFPROBE_FIXTURE" },
    deviceName: "DEVICE_FIXTURE",
    durationSeconds: 1,
    outputPath: cleanupFailureOutputPath,
    processRunner: async ({ args }) => {
      await writeFile(args.at(-1), "published-cleanup-fixture", "utf8");
      return { code: 0, signal: null, stdout: "", stderr: "" };
    },
    probeWav: async () => ({ durationMs: 1_000, codecProfile: "WAV_PCM16_16K_MONO" }),
    removeFile: async () => { throw new Error("fixture persistent cleanup failure"); },
  }));
  const publishedCaptureCleanupFailureIsExplicit = publishedCleanupError?.code === "AUDIO_RECORD_CLEANUP_FAILED"
    && publishedCleanupError.details?.outputPublished === true
    && publishedCleanupError.details?.cleanupComplete === false
    && await readFile(cleanupFailureOutputPath, "utf8") === "published-cleanup-fixture"
    && (await partialFilesFor(cleanupFailureOutputPath)).length === 1;
  for (const partialName of await partialFilesFor(cleanupFailureOutputPath)) {
    await rm(path.join(RUN_ROOT, partialName), { force: true });
  }
  await rm(cleanupFailureOutputPath, { force: true });

  const gates = {
    preAbortRejectsBeforeSpawn,
    naturalCloseCleansLifecycleListeners,
    timeoutWaitsForChildCloseBeforeRejecting: timeoutWaitedForClose,
    abortWaitsForChildCloseBeforeRejecting: abortWaitedForClose,
    forceEscalationClosesAndCleansListeners: forceEscalationClosedAndCleanedListeners,
    exitBeforeCloseIsNotMisreportedAsForced,
    stuckProcessFailsClosedAndDisposesCloseLatch,
    ffplayStopWaitsForCloseWithoutPlaybackCallback: ffplayStopWaitedForCloseWithoutCallback,
    cleanupFailureBlocksFuturePlayback,
    ffplayStartFailureWaitsForClose,
    ffplayRuntimeErrorStopsBeforeRetry,
    failedCaptureRemovesOnlyOwnedPartial,
    failedProbeRemovesPartial,
    publishCollisionPreservesExistingOutput,
    successfulCapturePublishesAfterProbe,
    publishedCaptureCleanupFailureIsExplicit,
  };
  const failures = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const report = {
    schemaVersion: 1,
    profile: "companion-host-audio-process-acceptance-v1",
    fixtureOnly: true,
    actualHostAudioEndpointUsed: false,
    gates,
  };
  await writeFile(path.join(RUN_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(`Companion host-audio process acceptance: ${Object.keys(gates).length - failures.length}/${Object.keys(gates).length}`);
  if (failures.length) throw new Error(`host-audio process gates failed: ${failures.join(", ")}`);
}

const lock = await acquireLock();
try {
  await run();
} finally {
  try { await lock.close(); } catch { /* result above remains authoritative */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* result above remains authoritative */ }
}
