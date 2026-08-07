import { AudioPlayer } from "@yimi-pen/audio";
import { computePresentationTranscriptSha256 } from "../../../../contracts/confirmation-trust-v1.mjs";
import { isStrictRfc3339 } from "../../../../contracts/rfc3339.mjs";

export class PrelistenPresentationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PrelistenPresentationError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new PrelistenPresentationError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function assertTimestamp(value, label) {
  assert(isStrictRfc3339(value), "PRELISTEN_CLOCK_INVALID", `${label} must be strict RFC3339`, { value });
  return value;
}

function flattenedClips(preview) {
  return preview.bindings.flatMap((binding) => binding.clips);
}

export function createAudioPlayerPrelistenPort({
  backend,
  clock = { now: () => new Date().toISOString() },
  defaultTimeoutMs = 60_000,
  stopWaitTimeoutMs = 2_500,
}) {
  assert(backend && typeof backend.play === "function" && typeof backend.stop === "function",
    "PRELISTEN_BACKEND_INVALID", "audio backend port is incomplete");
  assert(typeof backend.takeNaturalEndReceipt === "function",
    "PRELISTEN_BACKEND_UNQUALIFIED", "audio backend must expose natural-end receipts");
  assert(Number.isInteger(stopWaitTimeoutMs) && stopWaitTimeoutMs > 0,
    "PRELISTEN_STOP_TIMEOUT_INVALID", "stop wait timeout must be a positive integer");
  let player = new AudioPlayer(backend);
  let activeToken = null;
  let stopActive = null;
  let stoppingBarrier = null;
  let stoppingFailure = null;

  function beginPlayerStop(playbackPlayer) {
    if (stoppingBarrier) return stoppingBarrier;
    const barrier = Promise.resolve()
      .then(() => playbackPlayer.stop())
      .catch((error) => {
        stoppingFailure = error;
      })
      .finally(() => {
        if (stoppingBarrier !== barrier) return;
        if (player === playbackPlayer) player = new AudioPlayer(backend);
        stoppingBarrier = null;
      });
    stoppingBarrier = barrier;
    return barrier;
  }

  async function stop() {
    if (stopActive) {
      stopActive();
    } else if (!stoppingBarrier) {
      void beginPlayerStop(player);
    }
    const barrier = stoppingBarrier;
    if (!barrier) return;
    let timer = null;
    try {
      await Promise.race([
        barrier,
        new Promise((resolve) => { timer = setTimeout(resolve, stopWaitTimeoutMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (stoppingFailure) {
      throw new PrelistenPresentationError(
        "PRELISTEN_BACKEND_CLEANUP_FAILED",
        "audio backend cleanup failed",
        {
          causeCode: stoppingFailure?.code ?? stoppingFailure?.name ?? "UNKNOWN",
          cleanupComplete: stoppingFailure?.details?.cleanupComplete ?? false,
        },
      );
    }
  }

  async function playToNaturalEnd({ sessionId, clip, resolvedUri, signal, timeoutMs }) {
    assert(stoppingFailure === null, "PRELISTEN_BACKEND_CLEANUP_FAILED",
      "audio backend cleanup previously failed", {
        causeCode: stoppingFailure?.code ?? stoppingFailure?.name ?? "UNKNOWN",
        cleanupComplete: stoppingFailure?.details?.cleanupComplete ?? false,
      });
    assert(stoppingBarrier === null, "PRELISTEN_BACKEND_STOPPING",
      "audio backend cleanup is still in progress");
    assert(activeToken === null, "PRELISTEN_PLAYBACK_BUSY", "another prelisten clip is already active");
    assert(typeof sessionId === "string" && sessionId.length > 0,
      "PRELISTEN_SESSION_INVALID", "sessionId is required");
    const token = Symbol(`${sessionId}:${clip.clipId}`);
    activeToken = token;
    const watchdogMs = timeoutMs ?? Math.max(defaultTimeoutMs, (clip.durationMs ?? 0) + 30_000);
    const startedAt = assertTimestamp(clock.now(), "playback startedAt");
    const playbackPlayer = player;

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      let offEnd = () => {};
      let offError = () => {};
      const abort = () => {
        void finishError(new PrelistenPresentationError("PRELISTEN_PLAYBACK_ABORTED", "prelisten playback was aborted"), true);
      };

      function cleanup() {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        offEnd();
        offError();
        if (activeToken === token) {
          activeToken = null;
          stopActive = null;
        }
      }

      function finishSuccess(receipt) {
        if (settled || activeToken !== token) return;
        settled = true;
        cleanup();
        resolve(Object.freeze({
          ...clone(receipt),
          sessionId,
          clipId: clip.clipId,
          expectedSha256: clip.sha256,
          expectedBytes: clip.bytes,
          requestedAt: startedAt,
        }));
      }

      function finishError(error, stopPlayer = false) {
        if (settled || activeToken !== token) return;
        settled = true;
        cleanup();
        if (stopPlayer) void beginPlayerStop(playbackPlayer);
        reject(error);
      }

      offEnd = playbackPlayer.on("end", (endedClip) => {
        if (activeToken !== token) return;
        if (endedClip.id !== clip.clipId) {
          void finishError(new PrelistenPresentationError(
            "PRELISTEN_CLIP_MISMATCH",
            "audio player ended a different clip",
            { expected: clip.clipId, actual: endedClip.id },
          ), true);
          return;
        }
        let receipt;
        try {
          receipt = backend.takeNaturalEndReceipt({ uri: resolvedUri });
        } catch (error) {
          void finishError(new PrelistenPresentationError(
            "PRELISTEN_NATURAL_END_MISSING",
            "audio backend rejected its natural-end receipt",
            { message: error instanceof Error ? error.message : String(error) },
          ), true);
          return;
        }
        if (!receipt || receipt.completion !== "natural-end" || receipt.exitCode !== 0) {
          void finishError(new PrelistenPresentationError(
            "PRELISTEN_NATURAL_END_MISSING",
            "player end event lacks a matching natural-end receipt",
          ), true);
          return;
        }
        finishSuccess(receipt);
      });
      offError = playbackPlayer.on("error", ({ message }) => {
        void finishError(new PrelistenPresentationError(
          "PRELISTEN_BACKEND_FAILED",
          "audio backend reported a playback failure",
          { message },
        ), true);
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      stopActive = () => finishError(new PrelistenPresentationError(
        "PRELISTEN_PLAYBACK_STOPPED",
        "prelisten playback was explicitly stopped",
      ), true);
      timer = setTimeout(() => {
        void finishError(new PrelistenPresentationError(
          "PRELISTEN_PLAYBACK_TIMEOUT",
          "prelisten playback did not reach a natural end before its watchdog",
          { watchdogMs },
        ), true);
      }, watchdogMs);
      Promise.resolve(playbackPlayer.play({
        clip: {
          id: clip.clipId,
          uri: resolvedUri,
          durationMs: clip.durationMs,
          language: clip.language,
          transcript: clip.transcript,
          mediaType: clip.mediaType,
        },
        resolvedUri,
      })).catch((error) => {
        void finishError(new PrelistenPresentationError(
          "PRELISTEN_BACKEND_FAILED",
          "audio player rejected the playback request",
          { message: error instanceof Error ? error.message : String(error) },
        ), true);
      });
    });
  }

  return Object.freeze({
    evidenceClass: backend.evidenceClass ?? "unqualified",
    playToNaturalEnd,
    stop,
  });
}

export function createPrelistenPresentationSession({
  sessionId,
  challenge,
  preview,
  clipResolver,
  playbackPort,
  clock = { now: () => new Date().toISOString() },
}) {
  assert(typeof sessionId === "string" && sessionId.length > 0,
    "PRELISTEN_SESSION_INVALID", "sessionId is required");
  assert(challenge?.previewId === preview?.previewId && challenge?.sourceSha256 === preview?.sourceSha256,
    "PRELISTEN_CHALLENGE_MISMATCH", "challenge and preview identities differ");
  assert(challenge?.presentationPolicyVersion === preview?.presentationPolicyVersion,
    "PRELISTEN_CHALLENGE_MISMATCH", "challenge and preview policy versions differ");
  assert(typeof clipResolver === "function", "PRELISTEN_RESOLVER_REQUIRED", "clip resolver port is required");
  assert(playbackPort && typeof playbackPort.playToNaturalEnd === "function",
    "PRELISTEN_BACKEND_INVALID", "prelisten playback port is required");
  const requiredClips = flattenedClips(preview);
  let state = "CREATED";
  let nextClipIndex = 0;
  let cancelResolveActive = null;
  const events = [];
  const playbackReceipts = [];
  const failedAttempts = [];

  function appendEvent(event) {
    const occurredAt = assertTimestamp(event.occurredAt, "presentation event occurredAt");
    const previous = events.at(-1)?.occurredAt;
    assert(!previous || Date.parse(previous) <= Date.parse(occurredAt),
      "PRELISTEN_CLOCK_REVERSED", "presentation clock moved backwards");
    events.push(Object.freeze({ sequence: events.length, ...event, occurredAt }));
  }

  function open() {
    assert(state === "CREATED", "PRELISTEN_STATE_INVALID", "preview session has already been opened");
    appendEvent({
      kind: "PREVIEW_OPENED",
      clipId: null,
      clipSha256: null,
      confirmationId: null,
      occurredAt: clock.now(),
    });
    state = "OPEN";
    return snapshot();
  }

  async function playNext({ signal, timeoutMs } = {}) {
    assert(state === "OPEN", "PRELISTEN_STATE_INVALID", "preview must be open and awaiting a clip");
    assert(nextClipIndex < requiredClips.length, "PRELISTEN_ALL_CLIPS_COMPLETE", "all required clips already completed");
    const clip = requiredClips[nextClipIndex];
    state = "RESOLVING";
    let cancelResolve;
    const cancelledDuringResolve = new Promise((_, reject) => {
      cancelResolve = () => reject(new PrelistenPresentationError(
        "PRELISTEN_SESSION_CANCELLED",
        "prelisten session was cancelled while resolving the audio asset",
      ));
    });
    cancelResolveActive = cancelResolve;
    try {
      const resolved = await Promise.race([
        Promise.resolve().then(() => clipResolver(clip)),
        cancelledDuringResolve,
      ]);
      if (cancelResolveActive === cancelResolve) cancelResolveActive = null;
      assert(state === "RESOLVING", "PRELISTEN_SESSION_CANCELLED",
        "prelisten session was cancelled while resolving the audio asset");
      assert(resolved?.clipId === clip.clipId && resolved?.sha256 === clip.sha256 && resolved?.bytes === clip.bytes,
        "PRELISTEN_ASSET_MISMATCH", "resolved audio identity differs from the preview clip", { clipId: clip.clipId });
      state = "PLAYING";
      const receipt = await playbackPort.playToNaturalEnd({
        sessionId,
        clip,
        resolvedUri: resolved.absolutePath,
        signal,
        timeoutMs,
      });
      assert(receipt?.clipId === clip.clipId && receipt?.expectedSha256 === clip.sha256
        && receipt?.expectedBytes === clip.bytes && receipt?.completion === "natural-end",
      "PRELISTEN_RECEIPT_MISMATCH", "natural-end receipt differs from the requested clip");
      appendEvent({
        kind: "CLIP_PLAYBACK_COMPLETED",
        clipId: clip.clipId,
        clipSha256: clip.sha256,
        confirmationId: null,
        occurredAt: receipt.completedAt,
      });
      playbackReceipts.push(clone(receipt));
      nextClipIndex += 1;
      state = nextClipIndex === requiredClips.length ? "READY_TO_CONFIRM" : "OPEN";
      return clone(receipt);
    } catch (error) {
      if (cancelResolveActive === cancelResolve) cancelResolveActive = null;
      const reportedError = state === "CANCELLED" && error?.code === "PRELISTEN_PLAYBACK_STOPPED"
        ? new PrelistenPresentationError(
          "PRELISTEN_SESSION_CANCELLED",
          "prelisten session was cancelled during audio playback",
        )
        : error;
      failedAttempts.push({
        clipId: clip.clipId,
        code: reportedError?.code ?? reportedError?.name ?? "UNKNOWN",
        at: assertTimestamp(clock.now(), "failed attempt timestamp"),
      });
      if (state !== "CANCELLED") state = "OPEN";
      throw reportedError;
    }
  }

  async function playAll(options = {}) {
    while (nextClipIndex < requiredClips.length) await playNext(options);
    return snapshot();
  }

  function confirm({ confirmationId, guardianRole = challenge.guardianAuthority.role }) {
    assert(state === "READY_TO_CONFIRM", "PRELISTEN_CONFIRMATION_TOO_EARLY",
      "explicit confirmation is available only after every required clip reaches natural end", {
        completed: nextClipIndex,
        required: requiredClips.length,
      });
    assert(typeof confirmationId === "string" && /^CONF-[A-Z0-9][A-Z0-9-]{2,63}$/u.test(confirmationId),
      "PRELISTEN_CONFIRMATION_INVALID", "confirmationId is malformed");
    assert(guardianRole === challenge.guardianAuthority.role,
      "PRELISTEN_CONFIRMATION_INVALID", "guardian role differs from the challenge authority");
    const confirmedAt = assertTimestamp(clock.now(), "confirmation timestamp");
    const confirmation = {
      schemaVersion: 1,
      profile: "family-alpha-confirmation-v1",
      fixtureOnly: challenge.fixtureOnly,
      confirmationId,
      previewId: preview.previewId,
      sourceSha256: preview.sourceSha256,
      decision: "confirmed",
      scope: "all-bindings",
      guardianRole,
      policyVersion: preview.presentationPolicyVersion,
      confirmedAt,
    };
    appendEvent({
      kind: "CONFIRM_ACTION",
      clipId: null,
      clipSha256: null,
      confirmationId,
      occurredAt: confirmedAt,
    });
    const transcript = {
      schemaVersion: 1,
      profile: "family-confirmation-presentation-v1",
      transcriptSha256: "pending",
      buildPlanId: challenge.buildPlanId,
      buildSubjectSha256: challenge.buildSubjectSha256,
      previewId: challenge.previewId,
      sourceSha256: challenge.sourceSha256,
      presentationPolicyVersion: challenge.presentationPolicyVersion,
      challengeId: challenge.challengeId,
      openedAt: events[0].occurredAt,
      completedAt: confirmedAt,
      events: clone(events),
    };
    transcript.transcriptSha256 = computePresentationTranscriptSha256(transcript);
    state = "CONFIRMED";
    return Object.freeze({ confirmation: Object.freeze(confirmation), transcript: Object.freeze(transcript) });
  }

  async function cancel() {
    assert(state !== "CONFIRMED", "PRELISTEN_STATE_INVALID", "a confirmed presentation is immutable");
    const wasPlaying = state === "PLAYING";
    const cancelResolve = cancelResolveActive;
    cancelResolveActive = null;
    state = "CANCELLED";
    cancelResolve?.();
    if (wasPlaying) await playbackPort.stop();
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({
      sessionId,
      state,
      requiredClipCount: requiredClips.length,
      completedClipCount: nextClipIndex,
      events: clone(events),
      playbackReceipts: clone(playbackReceipts),
      failedAttempts: clone(failedAttempts),
    });
  }

  return Object.freeze({ open, playNext, playAll, confirm, cancel, snapshot });
}
