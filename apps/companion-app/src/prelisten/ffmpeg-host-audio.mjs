import { spawn } from "node:child_process";
import { COPYFILE_EXCL } from "node:constants";
import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { sha256File } from "./local-audio-assets.mjs";

export class HostAudioError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "HostAudioError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new HostAudioError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function utcNow() {
  return new Date().toISOString();
}

function appendBounded(current, chunk, maxBytes) {
  const next = `${current}${chunk.toString("utf8")}`;
  return next.length <= maxBytes ? next : next.slice(next.length - maxBytes);
}

const CLOSE_LATCH = Symbol("yimi.host-audio.close-latch");

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function ensureChildCloseLatch(child) {
  if (child[CLOSE_LATCH]) return child[CLOSE_LATCH];
  let resolveClosed;
  const latch = {
    closed: false,
    disposed: false,
    code: null,
    signal: null,
    promise: new Promise((resolve) => { resolveClosed = resolve; }),
  };
  const onClose = (code, closeSignal) => {
    latch.closed = true;
    latch.code = code;
    latch.signal = closeSignal;
    resolveClosed({ code, signal: closeSignal });
  };
  latch.dispose = () => {
    if (latch.closed || latch.disposed) return;
    latch.disposed = true;
    child.removeListener("close", onClose);
    if (child[CLOSE_LATCH] === latch) delete child[CLOSE_LATCH];
  };
  Object.defineProperty(child, CLOSE_LATCH, { value: latch, configurable: true });
  child.once("close", onClose);
  return latch;
}

function waitForChildClose(latch, timeoutMs) {
  if (latch.closed) {
    return Promise.resolve({ closed: true, code: latch.code, signal: latch.signal });
  }
  return new Promise((resolve) => {
    let timer = null;
    const finish = (result) => {
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    void latch.promise.then(({ code, signal }) => finish({ closed: true, code, signal }));
    timer = setTimeout(() => finish({ closed: false, code: null, signal: null }), timeoutMs);
  });
}

export async function terminateChildAndWait(child, {
  label = "host-audio-process",
  graceTimeoutMs = 2_000,
  forceTimeoutMs = 2_000,
} = {}) {
  const closeLatch = ensureChildCloseLatch(child);
  if (closeLatch.closed) {
    return Object.freeze({ code: closeLatch.code, signal: closeLatch.signal, forced: false });
  }
  if (!childHasExited(child)) {
    try { child.kill(); } catch (error) {
      throw new HostAudioError("HOST_AUDIO_PROCESS_CLEANUP_FAILED", "host audio process termination request failed", {
        label,
        pid: child.pid ?? null,
        cause: error instanceof Error ? error.message : String(error),
        cleanupComplete: false,
      });
    }
  }
  let closed = await waitForChildClose(closeLatch, graceTimeoutMs);
  if (closed.closed) return Object.freeze({ code: closed.code, signal: closed.signal, forced: false });
  let forceRequested = false;
  if (!childHasExited(child)) {
    try { child.kill("SIGKILL"); } catch (error) {
      throw new HostAudioError("HOST_AUDIO_PROCESS_CLEANUP_FAILED", "host audio process force-termination request failed", {
        label,
        pid: child.pid ?? null,
        cause: error instanceof Error ? error.message : String(error),
        cleanupComplete: false,
      });
    }
    forceRequested = true;
  }
  closed = await waitForChildClose(closeLatch, forceTimeoutMs);
  if (closed.closed) return Object.freeze({ code: closed.code, signal: closed.signal, forced: forceRequested });
  closeLatch.dispose();
  throw new HostAudioError("HOST_AUDIO_PROCESS_CLEANUP_TIMEOUT", "host audio process remained open after termination", {
    label,
    pid: child.pid ?? null,
    cleanupComplete: false,
    graceTimeoutMs,
    forceTimeoutMs,
  });
}

export async function runHostAudioProcess({
  executable,
  args,
  timeoutMs,
  signal,
  maxOutputBytes = 128 * 1024,
  spawnProcess = spawn,
  terminateProcess = terminateChildAndWait,
}) {
  if (signal?.aborted) {
    throw new HostAudioError("HOST_AUDIO_PROCESS_ABORTED", "host audio process was aborted before start", {
      executable: path.basename(executable),
      cleanupComplete: true,
    });
  }
  let child;
  try {
    child = spawnProcess(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new HostAudioError("HOST_AUDIO_PROCESS_START_FAILED", "host audio process did not start", {
      executable: path.basename(executable),
      cause: error instanceof Error ? error.message : String(error),
      cleanupComplete: true,
    });
  }
  let stdout = "";
  let stderr = "";
  const closeLatch = ensureChildCloseLatch(child);
  const onStdout = (chunk) => { stdout = appendBounded(stdout, chunk, maxOutputBytes); };
  const onStderr = (chunk) => { stderr = appendBounded(stderr, chunk, maxOutputBytes); };
  child.stdout?.on("data", onStdout);
  child.stderr?.on("data", onStderr);
  let onError;
  const startFailure = new Promise((_, reject) => {
    onError = (error) => reject(new HostAudioError(
      "HOST_AUDIO_PROCESS_START_FAILED",
      "host audio process did not start",
      {
        executable: path.basename(executable),
        cause: error.message,
        cleanupComplete: true,
      },
    ));
    child.once("error", onError);
  });
  const lifecycle = Promise.race([closeLatch.promise, startFailure]);
  let timer = null;
  let abort = null;
  const watchdog = timeoutMs > 0
    ? new Promise((_, reject) => {
      timer = setTimeout(() => reject(new HostAudioError(
        "HOST_AUDIO_PROCESS_TIMEOUT",
        "host audio process exceeded its watchdog",
        { executable: path.basename(executable), timeoutMs },
      )), timeoutMs);
    })
    : new Promise(() => {});
  const aborted = signal
    ? new Promise((_, reject) => {
      abort = () => reject(new HostAudioError(
        "HOST_AUDIO_PROCESS_ABORTED",
        "host audio process was aborted",
        { executable: path.basename(executable) },
      ));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })
    : new Promise(() => {});
  try {
    const result = await Promise.race([lifecycle, watchdog, aborted]);
    return { ...result, stdout, stderr };
  } catch (error) {
    if (error?.code === "HOST_AUDIO_PROCESS_START_FAILED") {
      const closed = await waitForChildClose(closeLatch, 2_000);
      if (!closed.closed) {
        closeLatch.dispose();
        throw new HostAudioError("HOST_AUDIO_PROCESS_CLEANUP_TIMEOUT", "failed host audio process did not close its stdio", {
          executable: path.basename(executable),
          pid: child.pid ?? null,
          cleanupComplete: false,
        });
      }
      throw new HostAudioError(error.code, error.message, {
        ...error.details,
        pid: child.pid ?? null,
        cleanupComplete: true,
        exitCode: closed.code,
        closeSignal: closed.signal,
      });
    }
    if (error?.code !== "HOST_AUDIO_PROCESS_TIMEOUT" && error?.code !== "HOST_AUDIO_PROCESS_ABORTED") throw error;
    let cleanup;
    try {
      cleanup = await terminateProcess(child, { label: path.basename(executable) });
    } catch (cleanupError) {
      throw cleanupError;
    }
    throw new HostAudioError(error.code, error.message, {
      ...error.details,
      pid: child.pid ?? null,
      cleanupComplete: true,
      exitCode: cleanup.code,
      closeSignal: cleanup.signal,
      forced: cleanup.forced,
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
    child.removeListener("error", onError);
    child.stdout?.removeListener("data", onStdout);
    child.stderr?.removeListener("data", onStderr);
  }
}

const TOOL_ENV = Object.freeze({
  ffmpeg: "YIMI_FFMPEG_PATH",
  ffprobe: "YIMI_FFPROBE_PATH",
  ffplay: "YIMI_FFPLAY_PATH",
});

export async function resolvePinnedFfmpegTool({ repoRoot, toolName, env = process.env }) {
  assert(Object.hasOwn(TOOL_ENV, toolName), "HOST_AUDIO_TOOL_UNKNOWN", "unknown FFmpeg suite tool", { toolName });
  const lockPath = path.join(repoRoot, "hardware", "tools", "phase-a-toolchain.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const suite = lock.tools?.find((entry) => entry.name === "ffmpeg");
  const executable = suite?.executables?.[toolName];
  assert(suite && executable, "HOST_AUDIO_TOOL_UNPINNED", `${toolName} is absent from the pinned FFmpeg suite lock`);
  const explicit = env[TOOL_ENV[toolName]];
  const installedRoot = env.YIMI_FFMPEG_ROOT || suite.installed_path;
  const candidate = path.resolve(explicit || path.join(installedRoot, ...executable.relative_path.split("/")));
  let info;
  try {
    info = await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") fail("HOST_AUDIO_TOOL_MISSING", `${toolName} executable is missing`, { toolName });
    throw error;
  }
  assert(info.isFile() && !info.isSymbolicLink(), "HOST_AUDIO_TOOL_INVALID", `${toolName} must be a regular executable`);
  const identity = await sha256File(candidate, { maxBytes: 256 * 1024 * 1024 });
  assert(identity.sha256 === executable.sha256, "HOST_AUDIO_TOOL_HASH_MISMATCH", `${toolName} executable differs from its lock`, {
    toolName,
    expected: executable.sha256,
    actual: identity.sha256,
  });
  const versionResult = await runHostAudioProcess({ executable: candidate, args: ["-version"], timeoutMs: 10_000 });
  assert(versionResult.code === 0, "HOST_AUDIO_TOOL_VERSION_FAILED", `${toolName} version probe failed`, {
    exitCode: versionResult.code,
  });
  const versionLine = `${versionResult.stdout}\n${versionResult.stderr}`.split(/\r?\n/u).find(Boolean) ?? "";
  assert(versionLine.includes(suite.version), "HOST_AUDIO_TOOL_VERSION_MISMATCH", `${toolName} version differs from its lock`, {
    expected: suite.version,
    actual: versionLine,
  });
  return Object.freeze({
    name: toolName,
    path: candidate,
    sha256: identity.sha256,
    version: suite.version,
    versionLine,
    suiteArchiveSha256: suite.sha256,
  });
}

export async function probeCanonicalWav({ ffprobe, filePath }) {
  const result = await runHostAudioProcess({
    executable: ffprobe.path,
    args: [
      "-v", "error",
      "-show_streams",
      "-show_format",
      "-of", "json",
      filePath,
    ],
    timeoutMs: 15_000,
  });
  assert(result.code === 0, "AUDIO_PROBE_FAILED", "ffprobe rejected the audio asset", {
    exitCode: result.code,
    stderr: result.stderr.trim().slice(-2048),
  });
  let document;
  try {
    document = JSON.parse(result.stdout);
  } catch {
    fail("AUDIO_PROBE_INVALID", "ffprobe returned malformed JSON");
  }
  const streams = document.streams ?? [];
  const stream = streams[0];
  const durationSeconds = Number(stream?.duration ?? document.format?.duration);
  const canonical = streams.length === 1
    && stream?.codec_type === "audio"
    && stream?.codec_name === "pcm_s16le"
    && Number(stream?.sample_rate) === 16_000
    && Number(stream?.channels) === 1
    && Number(stream?.bits_per_sample) === 16
    && String(document.format?.format_name ?? "").split(",").includes("wav")
    && Number.isFinite(durationSeconds)
    && durationSeconds > 0;
  assert(canonical, "AUDIO_CODEC_PROFILE_MISMATCH", "audio asset is not WAV PCM16 16 kHz mono", {
    codec: stream?.codec_name ?? null,
    sampleRate: stream?.sample_rate ?? null,
    channels: stream?.channels ?? null,
    bitsPerSample: stream?.bits_per_sample ?? null,
    format: document.format?.format_name ?? null,
  });
  return Object.freeze({
    codecProfile: "WAV_PCM16_16K_MONO",
    durationMs: Math.max(1, Math.round(durationSeconds * 1000)),
    sampleRate: 16_000,
    channels: 1,
    bitsPerSample: 16,
  });
}

export async function decodeAudioToNull({ ffmpeg, filePath }) {
  const startedAt = utcNow();
  const startedMono = performance.now();
  const result = await runHostAudioProcess({
    executable: ffmpeg.path,
    args: [
      "-nostdin", "-hide_banner", "-v", "error", "-xerror",
      "-i", filePath,
      "-map", "0:a:0",
      "-f", "null", "-",
    ],
    timeoutMs: 30_000,
  });
  assert(result.code === 0, "AUDIO_DECODE_FAILED", "FFmpeg did not decode the complete audio stream", {
    exitCode: result.code,
    stderr: result.stderr.trim().slice(-2048),
  });
  return Object.freeze({
    decoder: "ffmpeg-null-output",
    startedAt,
    completedAt: utcNow(),
    elapsedMs: Math.round((performance.now() - startedMono) * 1000) / 1000,
    exitCode: result.code,
    audioEndpointUsed: false,
  });
}

export class FfplayAudioBackend {
  constructor({
    ffplay,
    volume = 20,
    clock = { now: utcNow },
    spawnProcess = spawn,
    terminateProcess = terminateChildAndWait,
  }) {
    assert(ffplay?.path && ffplay?.sha256, "HOST_AUDIO_TOOL_UNPINNED", "pinned ffplay tool evidence is required");
    assert(Number.isInteger(volume) && volume >= 0 && volume <= 100,
      "HOST_AUDIO_VOLUME_INVALID", "ffplay volume must be an integer from 0 through 100");
    this.ffplay = ffplay;
    this.volume = volume;
    this.clock = clock;
    this.spawnProcess = spawnProcess;
    this.terminateProcess = terminateProcess;
    this.generation = 0;
    this.current = null;
    this.lastNaturalEndReceipt = null;
    this.cleanupFailure = null;
    this.stopBarrier = null;
    this.evidenceClass = "host-audio-endpoint-natural-exit";
  }

  async play(uri, hooks) {
    if (this.cleanupFailure) throw this.cleanupFailure;
    if (this.stopBarrier) await this.stopBarrier;
    await this.stop();
    const generation = ++this.generation;
    const startedAt = this.clock.now();
    const startedMono = performance.now();
    let child;
    try {
      child = this.spawnProcess(this.ffplay.path, [
        "-nodisp",
        "-autoexit",
        "-loglevel", "error",
        "-volume", String(this.volume),
        "-i", uri,
      ], {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      throw new HostAudioError("HOST_AUDIO_PROCESS_START_FAILED", "ffplay did not start", {
        cause: error instanceof Error ? error.message : String(error),
        cleanupComplete: true,
      });
    }
    const closeLatch = ensureChildCloseLatch(child);
    const playback = {
      playbackId: `playback:${randomUUID()}`,
      generation,
      uri,
      child,
      hooks,
      startedAt,
      startedMono,
      stderr: "",
      spawned: false,
      stopped: false,
      runtimeErrorReported: false,
    };
    this.current = playback;
    let resolveStarted;
    let rejectStarted;
    const started = new Promise((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    const onChildError = (error) => {
      if (!playback.spawned) {
        if (this.current === playback) this.current = null;
        rejectStarted(new HostAudioError("HOST_AUDIO_PROCESS_START_FAILED", "ffplay did not start", {
          cause: error.message,
        }));
        return;
      }
      if (this.current !== playback || playback.stopped) return;
      if (playback.runtimeErrorReported) return;
      playback.runtimeErrorReported = true;
      hooks.onError(`ffplay process error: ${error.message}`);
    };
    child.on("error", onChildError);
    const onPlaybackStderr = (chunk) => {
      playback.stderr = appendBounded(playback.stderr, chunk, 64 * 1024);
    };
    child.stderr.on("data", onPlaybackStderr);
    child.once("close", (code, closeSignal) => {
      child.removeListener("error", onChildError);
      child.stderr.removeListener("data", onPlaybackStderr);
      if (!playback.spawned) {
        if (this.current === playback) this.current = null;
        rejectStarted(new HostAudioError("HOST_AUDIO_PROCESS_START_FAILED", "ffplay closed before reporting spawn", {
          exitCode: code,
          closeSignal,
          cleanupComplete: true,
        }));
        return;
      }
      if (this.current !== playback || playback.stopped) return;
      this.current = null;
      if (playback.runtimeErrorReported) return;
      if (code === 0) {
        this.lastNaturalEndReceipt = Object.freeze({
          playbackId: playback.playbackId,
          backend: "ffplay",
          evidenceClass: this.evidenceClass,
          generation,
          uri,
          processId: child.pid,
          executableSha256: this.ffplay.sha256,
          startedAt,
          completedAt: this.clock.now(),
          elapsedMs: Math.round((performance.now() - startedMono) * 1000) / 1000,
          completion: "natural-end",
          exitCode: code,
          signal: closeSignal,
        });
        hooks.onEnd();
      } else {
        hooks.onError(`ffplay exited with ${code ?? "no-code"}: ${playback.stderr.trim().slice(-1024)}`);
      }
    });
    child.once("spawn", () => {
      playback.spawned = true;
      resolveStarted();
    });
    try {
      await started;
    } catch (error) {
      const closed = await waitForChildClose(closeLatch, 2_000);
      if (!closed.closed) {
        closeLatch.dispose();
        this.cleanupFailure = new HostAudioError(
          "HOST_AUDIO_PROCESS_CLEANUP_TIMEOUT",
          "failed ffplay process did not close its stdio",
          { pid: child.pid ?? null, cleanupComplete: false },
        );
        throw this.cleanupFailure;
      }
      throw new HostAudioError(error?.code ?? "HOST_AUDIO_PROCESS_START_FAILED", error?.message ?? "ffplay did not start", {
        ...(error?.details ?? {}),
        pid: child.pid ?? null,
        cleanupComplete: true,
        exitCode: closed.code,
        closeSignal: closed.signal,
      });
    }
  }

  takeNaturalEndReceipt({ uri }) {
    const receipt = this.lastNaturalEndReceipt;
    if (!receipt || receipt.uri !== uri) return null;
    this.lastNaturalEndReceipt = null;
    return receipt;
  }

  async pause() {
    fail("HOST_AUDIO_PAUSE_UNSUPPORTED", "host prelisten does not pause inside a confirmation challenge");
  }

  async resume() {
    fail("HOST_AUDIO_PAUSE_UNSUPPORTED", "host prelisten does not resume inside a confirmation challenge");
  }

  async stop() {
    if (this.cleanupFailure) throw this.cleanupFailure;
    if (this.stopBarrier) return this.stopBarrier;
    const playback = this.current;
    if (!playback) return;
    playback.stopped = true;
    this.current = null;
    this.lastNaturalEndReceipt = null;
    const barrier = (async () => {
      try {
        await this.terminateProcess(playback.child, {
          label: `ffplay:${playback.playbackId}`,
          graceTimeoutMs: 2_000,
          forceTimeoutMs: 2_000,
        });
      } catch (error) {
        this.cleanupFailure = error instanceof HostAudioError
          ? error
          : new HostAudioError("HOST_AUDIO_PROCESS_CLEANUP_FAILED", "ffplay cleanup failed", {
            cause: error instanceof Error ? error.message : String(error),
            cleanupComplete: false,
          });
        throw this.cleanupFailure;
      }
    })();
    this.stopBarrier = barrier;
    try {
      await barrier;
    } finally {
      if (this.stopBarrier === barrier) this.stopBarrier = null;
    }
  }
}

export async function recordCanonicalWavFromDshow({
  ffmpeg,
  ffprobe,
  deviceName,
  durationSeconds,
  outputPath,
  signal,
  processRunner = runHostAudioProcess,
  probeWav = probeCanonicalWav,
  publishFile = (source, target) => copyFile(source, target, COPYFILE_EXCL),
  removeFile = rm,
}) {
  assert(typeof deviceName === "string" && deviceName.trim().length > 0,
    "AUDIO_RECORD_DEVICE_REQUIRED", "DirectShow audio device name is required");
  assert(Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= 600,
    "AUDIO_RECORD_DURATION_INVALID", "recording duration must be in (0, 600] seconds");
  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await lstat(outputPath);
    fail("AUDIO_RECORD_OUTPUT_EXISTS", "recording output already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const stagingPath = `${outputPath}.partial-${randomUUID()}.wav`;
  let published = false;
  try {
    const result = await processRunner({
      executable: ffmpeg.path,
      args: [
        "-nostdin", "-hide_banner", "-v", "error", "-xerror",
        "-f", "dshow",
        "-i", `audio=${deviceName}`,
        "-t", String(durationSeconds),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav",
        "-n", stagingPath,
      ],
      timeoutMs: Math.ceil(durationSeconds * 1000) + 30_000,
      signal,
    });
    if (result.code !== 0) {
      fail("AUDIO_RECORD_FAILED", "FFmpeg DirectShow recording failed", {
        exitCode: result.code,
        stderr: result.stderr.trim().slice(-4096),
      });
    }
    const probe = await probeWav({ ffprobe, filePath: stagingPath });
    await publishFile(stagingPath, outputPath);
    published = true;
    try {
      await removeFile(stagingPath, { force: true });
    } catch (initialCleanupError) {
      try {
        await removeFile(stagingPath, { force: true });
      } catch (cleanupError) {
        throw new HostAudioError("AUDIO_RECORD_CLEANUP_FAILED", "published microphone capture staging cleanup failed", {
          outputPath,
          stagingPath,
          outputPublished: true,
          initialCause: initialCleanupError instanceof Error ? initialCleanupError.message : String(initialCleanupError),
          cause: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          cleanupComplete: false,
        });
      }
    }
    return Object.freeze({
      sourceClass: "windows-directshow-microphone",
      outputPath,
      durationMs: probe.durationMs,
      codecProfile: probe.codecProfile,
    });
  } catch (error) {
    if (published) throw error;
    try {
      await removeFile(stagingPath, { force: true });
    } catch (cleanupError) {
      throw new HostAudioError("AUDIO_RECORD_CLEANUP_FAILED", "partial microphone capture cleanup failed", {
        outputPath,
        stagingPath,
        originalCode: error?.code ?? error?.name ?? "UNKNOWN",
        cause: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        cleanupComplete: false,
      });
    }
    throw error;
  }
}
