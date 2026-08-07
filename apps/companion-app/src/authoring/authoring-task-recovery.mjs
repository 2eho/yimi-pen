import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import {
  AUTHORING_TASK_RECOVERY_DECISIONS,
  assertAuthoringTaskRecoveryDecision,
  assertAuthoringTaskRecoveryRecord,
  classifyAuthoringTaskRecoverySnapshot,
  createAuthoringTaskRecoveryRecord,
  normalizeAuthoringTaskRecoveryAdapterBindings,
  updateAuthoringTaskRecoveryRecord,
} from "./authoring-task-recovery-contract.mjs";
import { openAuthoringProductSession } from "./authoring-product-session.mjs";

const EMPTY_BINDINGS = Object.freeze({
  source: null,
  permission: null,
  authoring: null,
  commitCommand: null,
  review: null,
  hardware: null,
});

function clone(value) {
  return structuredClone(value);
}

function fail(code, message, details) {
  const error = new Error(message);
  error.name = "AuthoringTaskRecoveryCompositionError";
  error.code = code;
  error.details = structuredClone(details ?? {});
  throw error;
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function same(left, right) {
  return canonicalSha256(left).sha256 === canonicalSha256(right).sha256;
}

function emptyReleaseGate(requiredBindings, providedBindings, code = "ADAPTER_BINDING_MISMATCH") {
  return {
    status: "BLOCKED",
    code,
    requiredBindings: clone(requiredBindings),
    providedBindings: clone(providedBindings),
    coreMutation: "NONE",
  };
}

function blockedDecision(baseDecision, requiredBindings, providedBindings, reasonCode = "ADAPTER_BINDING_MISMATCH") {
  const decision = {
    kind: "BLOCKED_ADAPTER_MISMATCH",
    reasonCode,
    resumePhase: baseDecision.resumePhase,
    requiresUserAction: true,
    releaseGate: emptyReleaseGate(requiredBindings, providedBindings),
  };
  assertAuthoringTaskRecoveryDecision(decision);
  return decision;
}

export function emptyAuthoringTaskRecoveryAdapterBindings() {
  return clone(EMPTY_BINDINGS);
}

function requiredBindingEntries(record) {
  const state = record.sessionSnapshot;
  if (state.phase === "COMPLETED" || state.phase === "CANCELLED" || record.lifecycle !== "ACTIVE") return [];
  const required = [];
  const add = (name, binding, requiredWhen = true) => {
    if (requiredWhen) required.push({ name, binding: binding === null ? null : clone(binding) });
  };
  const preDurableSource = state.selection !== null && state.importedAsset === null
    && ["READY_TO_ACQUIRE", "AWAITING_PERMISSION", "ACQUIRING_SOURCE"].includes(state.phase);
  add("source", record.adapterBindings.source, preDurableSource);
  add("permission", record.adapterBindings.permission, preDurableSource
    && state.selection.requiredCapability !== null);
  add("authoring", record.adapterBindings.authoring,
    ["PREPARING_COMMIT", "READY_TO_COMMIT", "COMMITTING", "READY_TO_REVIEW", "REVIEWING"]
      .includes(state.phase)
      || (["FAILED", "REJECTED", "CONFLICT"].includes(state.phase)
        && ["COMMIT_PREPARE", "COMMIT", "REVIEW"].includes(state.failure?.stage)));
  add("commitCommand", record.adapterBindings.commitCommand,
    ["PREPARING_COMMIT", "READY_TO_COMMIT", "COMMITTING"].includes(state.phase)
      || (["FAILED", "CONFLICT"].includes(state.phase)
        && ["COMMIT_PREPARE", "COMMIT"].includes(state.failure?.stage)));
  add("review", record.adapterBindings.review,
    ["READY_TO_REVIEW", "REVIEWING", "REJECTED"].includes(state.phase)
      || (state.phase === "FAILED" && state.failure?.stage === "REVIEW"));
  add("hardware", record.adapterBindings.hardware, record.adapterBindings.hardware !== null);
  return required;
}

function adapterMismatch(record, availableBindings, sourcePorts) {
  const requiredBindings = requiredBindingEntries(record);
  const providedBindings = [];
  const mismatches = [];
  const state = record.sessionSnapshot;
  const preDurableSource = state.selection !== null && state.importedAsset === null
    && ["READY_TO_ACQUIRE", "AWAITING_PERMISSION", "ACQUIRING_SOURCE"].includes(state.phase);
  for (const entry of requiredBindings) {
    const provided = availableBindings[entry.name] ?? null;
    providedBindings.push({ name: entry.name, binding: clone(provided) });
    if (entry.binding === null || provided === null || !same(entry.binding, provided)) {
      mismatches.push(entry.name);
    }
  }
  const selectedSourceKind = record.sessionSnapshot.selection?.sourceKind;
  if (preDurableSource && selectedSourceKind !== undefined
    && !sourcePorts.some((port) => port?.sourceKind === selectedSourceKind)) {
    mismatches.push("sourcePort");
    requiredBindings.push({ name: "sourcePort", binding: { sourceKind: selectedSourceKind } });
    providedBindings.push({
      name: "sourcePort",
      binding: sourcePorts.map((port) => port?.sourceKind).filter(Boolean).sort(),
    });
  }
  return mismatches.length === 0 ? null : { requiredBindings, providedBindings };
}

function currentHeadId(head) {
  return head?.revisionId ?? null;
}

function isPreCommitHeadSensitive(state) {
  return ["AWAITING_SOURCE", "READY_TO_ACQUIRE", "AWAITING_PERMISSION", "ACQUIRING_SOURCE",
    "AWAITING_METADATA", "PREPARING_COMMIT"].includes(state.phase)
    || (state.phase === "READY_TO_COMMIT" && state.commitCommand === null);
}

export function classifyAuthoringTaskRecovery({
  record,
  availableAdapterBindings = EMPTY_BINDINGS,
  currentHeadRevisionId = null,
  sourcePorts = [],
}) {
  assertAuthoringTaskRecoveryRecord(record);
  const available = normalizeAuthoringTaskRecoveryAdapterBindings(availableAdapterBindings);
  const baseDecision = classifyAuthoringTaskRecoverySnapshot({
    sessionSnapshot: record.sessionSnapshot,
    recoveryContext: record.recoveryContext,
    lifecycle: record.lifecycle,
  });
  if (AUTHORING_TASK_RECOVERY_DECISIONS.includes(baseDecision.kind)
    && baseDecision.kind === "TERMINAL") return baseDecision;
  const mismatch = adapterMismatch(record, available, sourcePorts);
  if (mismatch !== null) return blockedDecision(baseDecision, mismatch.requiredBindings, mismatch.providedBindings);
  if (currentHeadRevisionId !== null
    && record.sessionSnapshot.target.baseRevisionId !== currentHeadRevisionId
    && isPreCommitHeadSensitive(record.sessionSnapshot)) {
    const conflict = {
      kind: "CONFLICT",
      reasonCode: "BASE_HEAD_CHANGED",
      resumePhase: null,
      requiresUserAction: true,
      releaseGate: null,
    };
    assertAuthoringTaskRecoveryDecision(conflict);
    return conflict;
  }
  return baseDecision;
}

function activeEffectFromSnapshot(snapshot, previous = null) {
  if (snapshot.active === null) return null;
  return {
    stage: snapshot.active.stage,
    attemptId: snapshot.active.attemptId,
    abortable: snapshot.active.stage !== "COMMIT",
    importedAssetPublished: previous?.importedAssetPublished === true
      || snapshot.facts.importedAssetPublished === true,
    cancelRequested: previous?.cancelRequested === true,
  };
}

function contextFromCheckpoint(previous, input, snapshot) {
  const sourceRequest = input.sourceRequest === undefined
    ? previous.recoveryContext.sourceRequest
    : input.sourceRequest;
  const committedRevision = input.committedRevision === undefined
    ? previous.recoveryContext.committedRevision
    : input.committedRevision;
  return {
    sourceRequest: sourceRequest === null ? null : clone(sourceRequest),
    committedRevision: committedRevision === null ? null : clone(committedRevision),
    eventSequence: input.eventSequence ?? Math.max(previous.recoveryContext.eventSequence, snapshot.sessionRevision),
    attemptSequence: input.attemptSequence ?? Math.max(previous.recoveryContext.attemptSequence, snapshot.sessionRevision),
    activeEffect: activeEffectFromSnapshot(snapshot, previous.recoveryContext.activeEffect),
  };
}

export function createAuthoringTaskRecoveryRecordFromSession({
  taskId,
  sessionSnapshot,
  adapterBindings,
  sourceRequest = null,
  committedRevision = null,
  eventSequence = sessionSnapshot.sessionRevision,
  attemptSequence = sessionSnapshot.sessionRevision,
  lifecycle = undefined,
}) {
  return createAuthoringTaskRecoveryRecord({
    taskId,
    sessionSnapshot,
    adapterBindings,
    sourceRequest,
    committedRevision,
    eventSequence,
    attemptSequence,
    ...(lifecycle === undefined ? {} : { lifecycle }),
  });
}

export async function saveAuthoringTaskRecoverySnapshot({
  journal,
  previousRecord,
  snapshot,
  sourceRequest = undefined,
  committedRevision = undefined,
  eventSequence = undefined,
  attemptSequence = undefined,
  lifecycle = undefined,
}) {
  assert(previousRecord && journal && typeof journal.createOrSaveCAS === "function",
    "AUTHORING_TASK_RECOVERY_SAVE_INVALID", "recovery save requires a previous record and journal adapter");
  const nextLifecycle = lifecycle
    ?? (snapshot.phase === "COMPLETED" ? "COMPLETED" : snapshot.phase === "CANCELLED" ? "ABANDONED" : previousRecord.lifecycle);
  const next = updateAuthoringTaskRecoveryRecord(previousRecord, {
    lifecycle: nextLifecycle,
    sessionSnapshot: snapshot,
    recoveryContext: contextFromCheckpoint(previousRecord, {
      sourceRequest,
      committedRevision,
      eventSequence,
      attemptSequence,
    }, snapshot),
  });
  return journal.createOrSaveCAS({
    record: next,
    expected: typeof journal.casExpectation === "function"
      ? journal.casExpectation(previousRecord)
      : {
        journalRevision: previousRecord.journalRevision,
        recordId: previousRecord.recordId,
        stateId: previousRecord.expectedStateId,
      },
  });
}

function transitionFor(record, decision) {
  const phase = record.sessionSnapshot.phase;
  if (["FAILED", "REJECTED"].includes(phase)) return "RETRY_FAILURE";
  if (phase === "AWAITING_PERMISSION" || phase === "ACQUIRING_SOURCE") return "SOURCE_RESTART";
  if (phase === "PREPARING_COMMIT") return "COMMIT_PREPARATION_RESET";
  if (phase === "COMMITTING") return "COMMIT_RETRY_READY";
  if (phase === "REVIEWING") return "REVIEW_RETRY_READY";
  if (decision.kind === "RESTART_SOURCE" && phase === "READY_TO_ACQUIRE") return null;
  if (decision.kind === "REPLAY_FROZEN_COMMIT" && phase === "READY_TO_COMMIT") return null;
  if (decision.kind === "FRESH_REVIEW_RETRY" && phase === "READY_TO_REVIEW") return null;
  return null;
}

function currentControllerRecordState(controller) {
  return controller.snapshot();
}

/**
 * Open a recovered controller only after the journal record, adapter versions,
 * and the current Family head have been checked. State-reset transitions are
 * content-addressed by the recordId and persisted before the next external effect.
 */
export async function openAuthoringTaskRecovery({
  journal,
  taskId,
  adapterBindings = EMPTY_BINDINGS,
  authoringPort,
  sourcePorts,
  permissionPort = null,
  commitCommandPort,
  reviewPort,
}) {
  const loaded = await journal.load(taskId);
  if (loaded.status === "CORRUPT") {
    fail("AUTHORING_TASK_JOURNAL_CORRUPT", "recovery is blocked by quarantined journal evidence", {
      corruption: loaded.corruption,
    });
  }
  if (loaded.status === "MISSING") fail("AUTHORING_TASK_JOURNAL_MISSING", "recovery task journal is absent", { taskId });
  let currentRecord = loaded.record;
  const available = normalizeAuthoringTaskRecoveryAdapterBindings(adapterBindings);
  const sourceList = Array.isArray(sourcePorts) ? sourcePorts : [];
  const baseDecision = classifyAuthoringTaskRecovery({
    record: currentRecord,
    availableAdapterBindings: available,
    sourcePorts: sourceList,
  });
  if (["BLOCKED_ADAPTER_MISMATCH", "CONFLICT", "TERMINAL", "ABANDON"].includes(baseDecision.kind)) {
    return Object.freeze({
      record: currentRecord,
      decision: baseDecision,
      controller: null,
      save: async () => currentRecord,
      getRecord: () => currentRecord,
    });
  }
  const head = await authoringPort.loadHead();
  const decision = classifyAuthoringTaskRecovery({
    record: currentRecord,
    availableAdapterBindings: available,
    currentHeadRevisionId: currentHeadId(head),
    sourcePorts: sourceList,
  });
  if (["BLOCKED_ADAPTER_MISMATCH", "CONFLICT", "TERMINAL", "ABANDON"].includes(decision.kind)) {
    return Object.freeze({
      record: currentRecord,
      decision,
      controller: null,
      save: async () => currentRecord,
      getRecord: () => currentRecord,
    });
  }

  const transition = transitionFor(currentRecord, decision);
  const checkpoint = async (input) => {
    currentRecord = await saveAuthoringTaskRecoverySnapshot({
      journal,
      previousRecord: currentRecord,
      snapshot: input.snapshot,
      sourceRequest: input.sourceRequest,
      committedRevision: input.committedRevision,
      eventSequence: input.eventSequence,
      attemptSequence: input.attemptSequence,
    });
  };
  const controller = await openAuthoringProductSession({
    sessionId: currentRecord.sessionId,
    bindingId: currentRecord.sessionSnapshot.target.bindingId,
    clipId: currentRecord.sessionSnapshot.target.clipId,
    authoringPort,
    sourcePorts: sourceList,
    permissionPort,
    commitCommandPort,
    reviewPort,
    initialState: currentRecord.sessionSnapshot,
    sourceRequest: currentRecord.recoveryContext.sourceRequest,
    committedRevision: currentRecord.recoveryContext.committedRevision,
    eventSequence: currentRecord.recoveryContext.eventSequence,
    attemptSequence: currentRecord.recoveryContext.attemptSequence,
    recoveryTransition: transition,
    recoveryId: transition === "RETRY_FAILURE" ? null : currentRecord.recordId,
    onCheckpoint: checkpoint,
  });

  if (transition !== null) {
    currentRecord = await saveAuthoringTaskRecoverySnapshot({
      journal,
      previousRecord: currentRecord,
      snapshot: currentControllerRecordState(controller),
    });
  }

  const save = async ({ lifecycle = undefined } = {}) => {
    currentRecord = await saveAuthoringTaskRecoverySnapshot({
      journal,
      previousRecord: currentRecord,
      snapshot: currentControllerRecordState(controller),
      lifecycle,
    });
    return currentRecord;
  };
  return Object.freeze({
    record: currentRecord,
    decision,
    controller,
    save,
    getRecord: () => currentRecord,
  });
}

export function authoringTaskRecoveryCASExpectation(record) {
  assertAuthoringTaskRecoveryRecord(record);
  return {
    journalRevision: record.journalRevision,
    recordId: record.recordId,
    stateId: record.expectedStateId,
  };
}
