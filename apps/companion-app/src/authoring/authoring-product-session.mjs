import {
  AuthoringProductSessionError,
  assertAuthoringProductSessionState,
  createAuthoringProductPermissionReceipt,
  createAuthoringProductSessionState,
  extractCommittedRevisionFromReceipt,
  transitionAuthoringProductSession,
} from "./authoring-product-session-core.mjs";
import { assertFamilyRevisionSemantics } from "../../../../contracts/family-revision-v1.mjs";

const SOURCE_KIND = /^[A-Z][A-Z0-9_]{1,47}$/u;
const CAPABILITY = /^[A-Z][A-Z0-9_]{1,47}$/u;
const ERROR_CODE = /^[A-Za-z0-9][A-Za-z0-9._:@_-]{1,127}$/u;
const PRODUCT_SOURCE_PRODUCER = Object.freeze({
  name: "yimi-companion-authoring",
  version: "1.0.0",
});

function fail(code, message, details) {
  throw new AuthoringProductSessionError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function assertPorts({
  authoringPort,
  sourcePorts,
  permissionPort,
  commitCommandPort,
  reviewPort,
  allowEmptySources = false,
}) {
  assert(authoringPort && typeof authoringPort.loadHead === "function"
    && typeof authoringPort.commitReplacement === "function",
  "AUTHORING_SESSION_PORT_INVALID", "authoring session requires head and replacement commit ports");
  assert(Array.isArray(sourcePorts) && (sourcePorts.length > 0 || allowEmptySources),
    "AUTHORING_SESSION_PORT_INVALID", "authoring session requires at least one source port");
  const sourceKinds = new Set();
  let permissionRequired = false;
  for (const port of sourcePorts) {
    assert(port && SOURCE_KIND.test(port.sourceKind ?? "")
      && (port.requiredCapability === null || CAPABILITY.test(port.requiredCapability ?? ""))
      && ["family-recording", "system-tts"].includes(port.clipSourceKind)
      && typeof port.acquire === "function"
      && !sourceKinds.has(port.sourceKind),
    "AUTHORING_SESSION_PORT_INVALID", "source port descriptor is malformed or duplicated");
    sourceKinds.add(port.sourceKind);
    permissionRequired ||= port.requiredCapability !== null;
  }
  assert(!permissionRequired || (permissionPort && typeof permissionPort.resolve === "function"),
    "AUTHORING_SESSION_PORT_INVALID", "capability-bearing sources require one permission resolver port");
  assert(commitCommandPort && typeof commitCommandPort.create === "function",
    "AUTHORING_SESSION_PORT_INVALID", "authoring session requires a commit command factory port");
  assert(reviewPort && typeof reviewPort.run === "function",
    "AUTHORING_SESSION_PORT_INVALID", "authoring session requires a verified review port");
}

function publicPermissionReceipt(result, { sessionId, attemptId, capability }) {
  assert(result
    && result.capability === capability
    && ["GRANTED", "DENIED", "UNAVAILABLE"].includes(result.status),
  "AUTHORING_SESSION_PERMISSION_RECEIPT_INVALID", "permission resolver returned a malformed receipt");
  return createAuthoringProductPermissionReceipt({
    sessionId,
    attemptId,
    capability,
    status: result.status,
  });
}

function publicCommitCommand(result) {
  assert(result && typeof result === "object" && !Array.isArray(result),
    "AUTHORING_SESSION_COMMIT_COMMAND_INVALID", "commit command factory returned a malformed value");
  return Object.freeze({
    ...clone(result),
    sourceProducer: clone(PRODUCT_SOURCE_PRODUCER),
  });
}

function privateErrorCode(error) {
  const candidate = error?.code ?? error?.name ?? "AUTHORING_SESSION_OPERATION_FAILED";
  return ERROR_CODE.test(candidate) ? candidate : "AUTHORING_SESSION_OPERATION_FAILED";
}

function failureCategory(code, stage) {
  if (code === "STALE_HEAD" || code === "AUTHORING_SESSION_REVISION_STALE") return "CONFLICT";
  if (/REJECTED|DECLINED/u.test(code) && stage === "REVIEW") return "REJECTED";
  if (/DENIED/u.test(code)) return "DENIED";
  if (/UNAVAILABLE|NOT_CONFIGURED/u.test(code)) return "UNAVAILABLE";
  if (/ABORT|CANCEL/u.test(code)) return "CANCELLED";
  if (/INVALID|MALFORMED|MISMATCH|DRIFT|CONFLICT/u.test(code)) return "INTEGRITY";
  return "TRANSIENT";
}

function resumePhase(stage) {
  if (stage === "PERMISSION" || stage === "SOURCE") return "READY_TO_ACQUIRE";
  if (stage === "COMMIT_PREPARE" || stage === "COMMIT") return "READY_TO_COMMIT";
  if (stage === "REVIEW") return "READY_TO_REVIEW";
  fail("AUTHORING_SESSION_FAILURE_INVALID", "failure stage has no retry route", { stage });
}

function publicFailure(error, stage) {
  const category = failureCategory(privateErrorCode(error), stage);
  return Object.freeze({
    stage,
    code: `AUTHORING_SESSION_${stage}_${category}`,
    category,
    retryable: !["CONFLICT", "CANCELLED"].includes(category),
    resumePhase: resumePhase(stage),
    importedAssetPublished: error?.details?.importedAssetPublished === true,
  });
}

/**
 * Open one in-memory product task against the current immutable Family head.
 * UI, OS permissions, source details, clocks/IDs, review, and persistence stay
 * behind injected ports. The returned API intentionally has no direct confirm
 * action: explicit confirmation remains inside the verified review port.
 */
export async function openAuthoringProductSession({
  sessionId,
  bindingId,
  clipId,
  authoringPort,
  sourcePorts,
  permissionPort = null,
  commitCommandPort,
  reviewPort,
  initialState = null,
  sourceRequest = null,
  committedRevision: restoredCommittedRevision = null,
  eventSequence = 0,
  attemptSequence = 0,
  recoveryTransition = null,
  recoveryId = null,
  onCheckpoint = null,
}) {
  assertPorts({
    authoringPort,
    sourcePorts,
    permissionPort,
    commitCommandPort,
    reviewPort,
    allowEmptySources: initialState !== null && initialState.importedAsset !== null,
  });
  assert(onCheckpoint === null || typeof onCheckpoint === "function",
    "AUTHORING_SESSION_PORT_INVALID", "session checkpoint hook must be a function or null");
  assert(Number.isSafeInteger(eventSequence) && eventSequence >= 0
    && Number.isSafeInteger(attemptSequence) && attemptSequence >= 0,
  "AUTHORING_SESSION_RECOVERY_INPUT_INVALID", "session sequence cursors must be non-negative safe integers");
  assert(recoveryTransition === null || [
    "SOURCE_RESTART", "COMMIT_PREPARATION_RESET", "COMMIT_RETRY_READY", "REVIEW_RETRY_READY",
    "RETRY_FAILURE",
  ].includes(recoveryTransition),
  "AUTHORING_SESSION_RECOVERY_INPUT_INVALID", "unknown recovery transition");
  assert(recoveryTransition === null || recoveryTransition === "RETRY_FAILURE" || typeof recoveryId === "string",
    "AUTHORING_SESSION_RECOVERY_INPUT_INVALID", "recovery transition requires a recovery identity");
  const baseRevision = await authoringPort.loadHead();
  assert(baseRevision !== null, "AUTHORING_SESSION_HEAD_MISSING",
    "authoring product session requires an initialized FamilyWorkspace head");

  let state;
  if (initialState === null) {
    state = createAuthoringProductSessionState({ sessionId, baseRevision, bindingId, clipId });
  } else {
    assertAuthoringProductSessionState(initialState);
    assert(initialState.sessionId === sessionId
      && initialState.target.bindingId === bindingId
      && initialState.target.clipId === clipId,
    "AUTHORING_SESSION_RECOVERY_INPUT_INVALID", "restored state crossed the requested session target");
    state = clone(initialState);
  }
  if (restoredCommittedRevision !== null) {
    try {
      assertFamilyRevisionSemantics(restoredCommittedRevision);
    } catch (error) {
      fail("AUTHORING_SESSION_RECOVERY_INPUT_INVALID", "restored committed revision is malformed", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (state.facts.durableRevisionPresent === true) {
    assert(restoredCommittedRevision !== null
      && restoredCommittedRevision.revisionId === state.committedRevision?.revisionId,
    "AUTHORING_SESSION_RECOVERY_INPUT_INVALID", "durable session state requires its full committed revision");
  } else {
    assert(restoredCommittedRevision === null,
      "AUTHORING_SESSION_RECOVERY_INPUT_INVALID", "pre-commit session state cannot carry a committed revision");
  }
  const sources = new Map(sourcePorts.map((port) => [port.sourceKind, port]));
  let selectedSourcePort = state.selection ? sources.get(state.selection.sourceKind) ?? null : null;
  let selectedRequest = sourceRequest === null ? null : clone(sourceRequest);
  let committedRevision = restoredCommittedRevision === null ? null : clone(restoredCommittedRevision);
  let activeEffect = null;
  let nextEventSequence = eventSequence;
  let nextAttemptSequence = attemptSequence;

  function nextEventId() {
    nextEventSequence += 1;
    return `event-${nextEventSequence}`;
  }

  function nextAttemptId(stage) {
    nextAttemptSequence += 1;
    return `${stage.toLowerCase()}-${nextAttemptSequence}`;
  }

  async function checkpoint(reason) {
    if (onCheckpoint === null) return;
    await onCheckpoint(Object.freeze({
      reason,
      snapshot: state,
      sourceRequest: selectedRequest === null ? null : clone(selectedRequest),
      committedRevision: committedRevision === null ? null : clone(committedRevision),
      eventSequence: nextEventSequence,
      attemptSequence: nextAttemptSequence,
    }));
  }

  function dispatch(type, payload = {}) {
    state = transitionAuthoringProductSession(state, {
      eventId: nextEventId(),
      expectedRevision: state.sessionRevision,
      type,
      ...payload,
    });
    return state;
  }

  function startEffect(stage, attemptId, abortable) {
    assert(activeEffect === null, "AUTHORING_SESSION_EFFECT_ACTIVE",
      "another authoring session effect is still active");
    let resolveSettled;
    const settled = new Promise((resolve) => { resolveSettled = resolve; });
    activeEffect = {
      stage,
      attemptId,
      controller: abortable ? new AbortController() : null,
      cancelRequested: false,
      importedAssetPublished: false,
      settled,
      resolveSettled,
    };
    return activeEffect;
  }

  function effectIsCurrent(stage, attemptId) {
    return activeEffect?.stage === stage
      && activeEffect.attemptId === attemptId
      && state.active?.stage === stage
      && state.active.attemptId === attemptId;
  }

  function clearEffect(stage, attemptId) {
    if (activeEffect?.stage === stage && activeEffect.attemptId === attemptId) {
      const effect = activeEffect;
      activeEffect = null;
      effect.resolveSettled(Object.freeze({ importedAssetPublished: effect.importedAssetPublished }));
    }
  }

  async function recordEffectFailure(error, stage, attemptId) {
    if (!effectIsCurrent(stage, attemptId)) return state;
    if (activeEffect) {
      activeEffect.importedAssetPublished ||= error?.details?.importedAssetPublished === true;
      if (activeEffect.cancelRequested) return state;
    }
    const failure = { ...publicFailure(error, stage) };
    if (activeEffect?.importedAssetPublished === true) failure.importedAssetPublished = true;
    dispatch("OPERATION_FAILED", {
      attemptId,
      failure,
    });
    await checkpoint("OPERATION_FAILED");
    return state;
  }

  function selectSource({ sourceKind, assetId, request }) {
    assert(activeEffect === null, "AUTHORING_SESSION_EFFECT_ACTIVE",
      "source selection waits for the current effect barrier");
    const port = sources.get(sourceKind);
    assert(port, "AUTHORING_SESSION_SOURCE_UNAVAILABLE", "selected source kind has no configured adapter", {
      sourceKind,
    });
    let requestSnapshot;
    try {
      requestSnapshot = clone(request);
    } catch {
      fail("AUTHORING_SESSION_SOURCE_REQUEST_INVALID", "source request must be an adapter-private cloneable value");
    }
    dispatch("SOURCE_SELECTED", {
      selection: {
        sourceKind: port.sourceKind,
        assetId,
        requiredCapability: port.requiredCapability,
        clipSourceKind: port.clipSourceKind,
      },
    });
    selectedSourcePort = port;
    selectedRequest = requestSnapshot;
    return state;
  }

  async function resolvePermissionIfNeeded() {
    const capability = state.selection.requiredCapability;
    if (capability === null || state.permission?.status === "GRANTED") return true;
    const attemptId = nextAttemptId("PERMISSION");
    dispatch("PERMISSION_STARTED", { attemptId });
    await checkpoint("PERMISSION_STARTED");
    const effect = startEffect("PERMISSION", attemptId, true);
    try {
      const result = await permissionPort.resolve(Object.freeze({
        sessionId: state.sessionId,
        attemptId,
        sourceKind: state.selection.sourceKind,
        capability,
        signal: effect.controller.signal,
      }));
      if (!effectIsCurrent("PERMISSION", attemptId)) return false;
      dispatch("PERMISSION_RESOLVED", {
        attemptId,
        receipt: publicPermissionReceipt(result, {
          sessionId: state.sessionId,
          attemptId,
          capability,
        }),
      });
      await checkpoint("PERMISSION_RESOLVED");
      return state.phase === "READY_TO_ACQUIRE";
    } catch (error) {
      await recordEffectFailure(error, "PERMISSION", attemptId);
      return false;
    } finally {
      clearEffect("PERMISSION", attemptId);
    }
  }

  async function acquire() {
    assert(activeEffect === null, "AUTHORING_SESSION_EFFECT_ACTIVE",
      "source acquisition waits for the current effect barrier");
    assert(state.phase === "READY_TO_ACQUIRE" && selectedSourcePort,
      "AUTHORING_SESSION_TRANSITION_INVALID", "select one available source before acquisition");
    if (!(await resolvePermissionIfNeeded())) return state;
    const attemptId = nextAttemptId("SOURCE");
    dispatch("SOURCE_ACQUISITION_STARTED", { attemptId });
    await checkpoint("SOURCE_ACQUISITION_STARTED");
    const effect = startEffect("SOURCE", attemptId, true);
    try {
      const result = await selectedSourcePort.acquire(Object.freeze({
        sessionId: state.sessionId,
        attemptId,
        assetId: state.selection.assetId,
        request: clone(selectedRequest),
        signal: effect.controller.signal,
      }));
      if (!effectIsCurrent("SOURCE", attemptId)) return state;
      effect.importedAssetPublished = result?.importedAsset !== undefined;
      dispatch("SOURCE_ACQUIRED", { attemptId, importedAsset: result?.importedAsset });
      await checkpoint("SOURCE_ACQUIRED");
      return state;
    } catch (error) {
      await recordEffectFailure(error, "SOURCE", attemptId);
      return state;
    } finally {
      clearEffect("SOURCE", attemptId);
    }
  }

  function submitMetadata(clipMetadata) {
    assert(activeEffect === null, "AUTHORING_SESSION_EFFECT_ACTIVE",
      "metadata editing waits for the current effect barrier");
    dispatch("METADATA_SUBMITTED", { clipMetadata: clone(clipMetadata) });
    return state;
  }

  async function commit() {
    assert(activeEffect === null, "AUTHORING_SESSION_EFFECT_ACTIVE",
      "commit waits for the current effect barrier");
    assert(state.phase === "READY_TO_COMMIT",
      "AUTHORING_SESSION_TRANSITION_INVALID", "metadata must be ready before commit");
    let command = state.commitCommand === null ? null : clone(state.commitCommand);
    if (command === null) {
      const preparationAttemptId = nextAttemptId("COMMIT_PREPARE");
      dispatch("COMMIT_PREPARATION_STARTED", { attemptId: preparationAttemptId });
      await checkpoint("COMMIT_PREPARATION_STARTED");
      const preparationEffect = startEffect("COMMIT_PREPARE", preparationAttemptId, true);
      try {
        const candidate = await commitCommandPort.create(Object.freeze({
          sessionId: state.sessionId,
          target: clone(state.target),
          importedAsset: clone(state.importedAsset),
          clipMetadata: clone(state.clipMetadata),
          signal: preparationEffect.controller.signal,
        }));
        command = publicCommitCommand(candidate);
        if (!effectIsCurrent("COMMIT_PREPARE", preparationAttemptId)) return state;
        dispatch("COMMIT_PREPARED", { attemptId: preparationAttemptId, command: clone(command) });
        await checkpoint("COMMIT_PREPARED");
      } catch (error) {
        await recordEffectFailure(error, "COMMIT_PREPARE", preparationAttemptId);
        return state;
      } finally {
        clearEffect("COMMIT_PREPARE", preparationAttemptId);
      }
      if (preparationEffect.cancelRequested) return state;
      command = clone(state.commitCommand);
    }
    const attemptId = nextAttemptId("COMMIT");
    dispatch("COMMIT_STARTED", { attemptId, command: clone(command) });
    await checkpoint("COMMIT_STARTED");
    startEffect("COMMIT", attemptId, false);
    try {
      const receipt = await authoringPort.commitReplacement(clone(command));
      if (!effectIsCurrent("COMMIT", attemptId)) return state;
      const revision = extractCommittedRevisionFromReceipt(receipt, command);
      dispatch("COMMIT_SUCCEEDED", { attemptId, receipt: clone(receipt) });
      committedRevision = revision;
      await checkpoint("COMMIT_SUCCEEDED");
      return state;
    } catch (error) {
      await recordEffectFailure(error, "COMMIT", attemptId);
      return state;
    } finally {
      clearEffect("COMMIT", attemptId);
    }
  }

  async function review() {
    assert(activeEffect === null, "AUTHORING_SESSION_EFFECT_ACTIVE",
      "review waits for the current effect barrier");
    assert(state.phase === "READY_TO_REVIEW" && committedRevision !== null,
      "AUTHORING_SESSION_TRANSITION_INVALID", "one confirmed durable revision is required before review");
    const attemptId = nextAttemptId("REVIEW");
    dispatch("REVIEW_STARTED", { attemptId });
    await checkpoint("REVIEW_STARTED");
    const effect = startEffect("REVIEW", attemptId, true);
    try {
      const receipt = await reviewPort.run(Object.freeze({
        sessionId: state.sessionId,
        reviewAttemptId: attemptId,
        revision: clone(committedRevision),
        importedAsset: clone(state.importedAsset),
        bindingId: state.target.bindingId,
        clipId: state.target.clipId,
        signal: effect.controller.signal,
      }));
      if (!effectIsCurrent("REVIEW", attemptId)) return state;
      dispatch("REVIEW_SUCCEEDED", { attemptId, receipt: clone(receipt) });
      await checkpoint("REVIEW_SUCCEEDED");
      return state;
    } catch (error) {
      await recordEffectFailure(error, "REVIEW", attemptId);
      return state;
    } finally {
      clearEffect("REVIEW", attemptId);
    }
  }

  function retry() {
    assert(activeEffect === null, "AUTHORING_SESSION_EFFECT_ACTIVE",
      "retry waits for the current effect barrier");
    dispatch("RETRY_REQUESTED");
    return state;
  }

  if (recoveryTransition !== null) {
    const eventByTransition = {
      SOURCE_RESTART: "RECOVERY_SOURCE_RESTARTED",
      COMMIT_PREPARATION_RESET: "RECOVERY_COMMIT_PREPARATION_RESET",
      COMMIT_RETRY_READY: "RECOVERY_COMMIT_RETRY_READY",
      REVIEW_RETRY_READY: "RECOVERY_REVIEW_RETRY_READY",
    };
    if (recoveryTransition === "RETRY_FAILURE") dispatch("RETRY_REQUESTED");
    else dispatch(eventByTransition[recoveryTransition], { recoveryId });
  }

  async function cancel() {
    if (state.phase === "COMPLETED" || state.phase === "CANCELLED") return state;
    assert(state.phase !== "COMMITTING" && activeEffect?.stage !== "COMMIT",
      "AUTHORING_SESSION_COMMIT_BARRIER", "commit result must settle before the session closes");
    let importedAssetPublished = false;
    if (activeEffect) {
      const effect = activeEffect;
      effect.cancelRequested = true;
      effect.controller?.abort();
      const settlement = await effect.settled;
      importedAssetPublished = settlement.importedAssetPublished;
    }
    dispatch("SESSION_CANCELLED", { importedAssetPublished });
    await checkpoint("SESSION_CANCELLED");
    return state;
  }

  return Object.freeze({
    profile: "authoring-product-session-controller-v1",
    availableSources: Object.freeze(sourcePorts.map((port) => Object.freeze({
      sourceKind: port.sourceKind,
      requiredCapability: port.requiredCapability,
      clipSourceKind: port.clipSourceKind,
    }))),
    snapshot: () => state,
    selectSource,
    acquire,
    submitMetadata,
    commit,
    review,
    retry,
    cancel,
  });
}
