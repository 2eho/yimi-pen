import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  HostAudioError,
  recordCanonicalWavFromDshow,
} from "../prelisten/ffmpeg-host-audio.mjs";

const CAPTURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,95}$/u;

export class DirectShowCapturePortError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DirectShowCapturePortError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new DirectShowCapturePortError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function missing(filePath) {
  try {
    await lstat(filePath);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

/** Windows/FFmpeg adapter for the App-local CapturePort. */
export function createDirectShowCapturePort({
  ffmpeg,
  ffprobe,
  captureRoot,
  recordWav = recordCanonicalWavFromDshow,
  removeFile = rm,
  idFactory = () => `capture-${randomUUID()}`,
}) {
  assert(ffmpeg?.path, "CAPTURE_TOOL_INVALID", "DirectShow capture requires an FFmpeg executable");
  assert(ffprobe?.path, "CAPTURE_TOOL_INVALID", "DirectShow capture requires an ffprobe executable");
  assert(path.isAbsolute(captureRoot ?? ""),
    "CAPTURE_ROOT_INVALID", "capture root must be an absolute App-owned path");
  assert(typeof recordWav === "function" && typeof removeFile === "function" && typeof idFactory === "function",
    "CAPTURE_ADAPTER_INVALID", "DirectShow capture adapter dependencies are malformed");

  const active = new Map();
  const released = new WeakSet();

  async function resolveOwnedRoot() {
    await mkdir(captureRoot, { recursive: true });
    const info = await lstat(captureRoot);
    assert(info.isDirectory() && !info.isSymbolicLink(),
      "CAPTURE_ROOT_INVALID", "capture root must be a regular directory");
    return realpath(captureRoot);
  }

  async function capture({ deviceName, durationSeconds, signal } = {}) {
    if (signal?.aborted) {
      throw new HostAudioError("HOST_AUDIO_PROCESS_ABORTED", "host audio capture was cancelled before start", {
        cleanupComplete: true,
      });
    }
    assert(typeof deviceName === "string" && deviceName.trim().length > 0,
      "CAPTURE_DEVICE_REQUIRED", "DirectShow capture requires an explicit audio device name");
    assert(Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= 600,
      "CAPTURE_DURATION_INVALID", "capture duration must be in (0, 600] seconds");
    const ownedRoot = await resolveOwnedRoot();
    const captureId = idFactory();
    assert(typeof captureId === "string" && CAPTURE_ID.test(captureId),
      "CAPTURE_ID_INVALID", "capture ID is malformed");
    assert(!active.has(captureId), "CAPTURE_ID_CONFLICT", "capture ID is already active", { captureId });
    const outputPath = path.join(ownedRoot, `${captureId}.wav`);
    assert(inside(ownedRoot, outputPath), "CAPTURE_PATH_ESCAPE", "capture output escaped its App-owned root");

    const recorded = await recordWav({
      ffmpeg,
      ffprobe,
      deviceName,
      durationSeconds,
      outputPath,
      signal,
    });
    try {
      assert(path.resolve(recorded?.outputPath ?? "") === outputPath,
        "CAPTURE_RECEIPT_INVALID", "DirectShow recorder returned an unexpected output path");
      assert(recorded?.sourceClass === "windows-directshow-microphone"
        && recorded?.codecProfile === "WAV_PCM16_16K_MONO"
        && Number.isInteger(recorded?.durationMs)
        && recorded.durationMs > 0,
      "CAPTURE_RECEIPT_INVALID", "DirectShow recorder returned a malformed canonical receipt");
      const outputInfo = await lstat(outputPath);
      assert(outputInfo.isFile() && !outputInfo.isSymbolicLink(),
        "CAPTURE_SOURCE_INVALID", "captured source must be a regular file");
    } catch (validationError) {
      try {
        await removeFile(outputPath, { force: true });
        assert(await missing(outputPath),
          "CAPTURE_SOURCE_CLEANUP_INCOMPLETE", "invalid captured source remains after cleanup");
      } catch (cleanupError) {
        throw new DirectShowCapturePortError(
          "CAPTURE_SOURCE_CLEANUP_FAILED",
          "invalid DirectShow capture cleanup failed",
          {
            captureId,
            originalCode: validationError?.code ?? validationError?.name ?? "UNKNOWN",
            cause: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            cleanupComplete: false,
          },
        );
      }
      throw new DirectShowCapturePortError(
        validationError?.code ?? "CAPTURE_RECEIPT_INVALID",
        validationError instanceof Error ? validationError.message : "DirectShow capture validation failed",
        {
          ...(validationError?.details ?? {}),
          cleanupComplete: true,
        },
      );
    }

    const receipt = Object.freeze({
      captureId,
      sourceClass: recorded.sourceClass,
      adapter: "ffmpeg-directshow",
      sourcePath: outputPath,
      durationMs: recorded.durationMs,
      codecProfile: recorded.codecProfile,
      executableSha256: ffmpeg.sha256 ?? null,
    });
    active.set(captureId, receipt);
    return receipt;
  }

  async function discard(receipt) {
    if (released.has(receipt)) {
      return Object.freeze({ captureId: receipt.captureId, cleanupComplete: true, replayed: true });
    }
    const owned = active.get(receipt?.captureId);
    assert(owned === receipt,
      "CAPTURE_RECEIPT_UNKNOWN", "capture receipt is not active in this adapter");
    try {
      await removeFile(owned.sourcePath, { force: true });
      assert(await missing(owned.sourcePath),
        "CAPTURE_SOURCE_CLEANUP_INCOMPLETE", "temporary capture source remains after cleanup");
    } catch (error) {
      throw new DirectShowCapturePortError(
        "CAPTURE_SOURCE_CLEANUP_FAILED",
        "DirectShow temporary capture source cleanup failed",
        {
          captureId: owned.captureId,
          cause: error instanceof Error ? error.message : String(error),
          cleanupComplete: false,
        },
      );
    }
    active.delete(owned.captureId);
    released.add(receipt);
    return Object.freeze({ captureId: owned.captureId, cleanupComplete: true, replayed: false });
  }

  return Object.freeze({ capture, discard });
}
