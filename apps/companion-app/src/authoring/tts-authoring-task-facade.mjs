import { openAuthoringProductSession } from "./authoring-product-session.mjs";
import {
  SYSTEM_TTS_CLIP_SOURCE_KIND,
  SYSTEM_TTS_SOURCE_KIND,
  createSystemTtsRequest,
} from "./tts-source-contract.mjs";

const SELECTION_KEYS = Object.freeze(["assetId", "transcript", "language", "mediaType"]);

export class SystemTtsAuthoringTaskError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SystemTtsAuthoringTaskError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new SystemTtsAuthoringTaskError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function exactSelectionKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const allowed = new Set(SELECTION_KEYS);
  return actual.every((key) => allowed.has(key))
    && actual.includes("assetId")
    && actual.includes("transcript")
    && actual.includes("language");
}

function assertSession(session) {
  assert(session
    && typeof session.snapshot === "function"
    && typeof session.selectSource === "function"
    && typeof session.acquire === "function"
    && typeof session.submitMetadata === "function"
    && typeof session.commit === "function"
    && typeof session.review === "function"
    && typeof session.retry === "function"
    && typeof session.cancel === "function"
    && Array.isArray(session.availableSources),
  "TTS_TASK_SESSION_INVALID", "system TTS task requires one authoring product session");
  const source = session.availableSources.find((candidate) => candidate.sourceKind === SYSTEM_TTS_SOURCE_KIND);
  assert(source?.clipSourceKind === SYSTEM_TTS_CLIP_SOURCE_KIND,
    "TTS_TASK_SOURCE_UNAVAILABLE", "authoring product session has no system TTS source port");
}

/**
 * TTS-specific product facade. It deliberately withholds submitMetadata() so
 * the durable transcript is always derived from the frozen synthesis request.
 */
export function createSystemTtsAuthoringTaskFacade(session) {
  assertSession(session);
  let frozenRequest = null;

  function selectSynthesis(input) {
    assert(exactSelectionKeys(input),
      "TTS_TASK_SELECTION_INVALID", "system TTS selection accepts only asset, transcript, language, and media type");
    assert(frozenRequest === null,
      "TTS_TASK_SELECTION_FROZEN", "system TTS selection is already frozen for this task");
    const request = createSystemTtsRequest({
      transcript: input.transcript,
      language: input.language,
      mediaType: input.mediaType ?? "voice",
    });
    session.selectSource({
      sourceKind: SYSTEM_TTS_SOURCE_KIND,
      assetId: input.assetId,
      request,
    });
    frozenRequest = request;
    return session.snapshot();
  }

  async function synthesizeAndPrepare() {
    assert(frozenRequest !== null,
      "TTS_TASK_SELECTION_REQUIRED", "select one system TTS request before synthesis");
    assert(session.snapshot().phase === "READY_TO_ACQUIRE",
      "TTS_TASK_TRANSITION_INVALID", "system TTS task is outside its synthesis phase");
    await session.acquire();
    if (session.snapshot().phase === "AWAITING_METADATA") {
      session.submitMetadata({
        sourceKind: SYSTEM_TTS_CLIP_SOURCE_KIND,
        transcript: frozenRequest.transcript,
        mediaType: frozenRequest.mediaType,
        language: frozenRequest.language,
      });
    }
    return session.snapshot();
  }

  return Object.freeze({
    profile: "authoring-system-tts-task-v1",
    snapshot: () => session.snapshot(),
    selectSynthesis,
    synthesizeAndPrepare,
    commit: () => session.commit(),
    review: () => session.review(),
    retry: () => session.retry(),
    cancel: () => session.cancel(),
  });
}

export async function openSystemTtsAuthoringTask(options) {
  const session = await openAuthoringProductSession(options);
  return createSystemTtsAuthoringTaskFacade(session);
}
