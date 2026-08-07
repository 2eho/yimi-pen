import { canonicalSha256, canonicalize } from "../../../../scripts/snapshot-jcs.mjs";
import { assertFamilyRevisionSemantics } from "../../../../contracts/family-revision-v1.mjs";
import { isStrictRfc3339 } from "../../../../contracts/rfc3339.mjs";
import {
  AUTHORING_CLIP_SOURCE_KINDS,
  AUTHORING_MEDIA_TYPES,
  isAuthoringClipMetadata,
  isAuthoringImportedAsset,
  isAuthoringSourceProducer,
} from "./authoring-contract.mjs";
import {
  assertAuthoringProductCommitCommand,
  assertAuthoringProductReviewReceipt,
  assertAuthoringProductSessionState,
  AUTHORING_PRODUCT_SESSION_PHASES,
} from "./authoring-product-session-core.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const ASSET_ID = /^asset-[a-z0-9][a-z0-9._-]{2,95}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@_-]{1,127}$/u;
const SOURCE_KIND = /^[A-Z][A-Z0-9_]{1,47}$/u;
const CAPABILITY = /^[A-Z][A-Z0-9_]{1,47}$/u;
const REVIEW_RECEIPT_ID = /^authoring-review:sha256:[a-f0-9]{64}$/u;
const PERMISSION_RECEIPT_ID = /^authoring-permission:sha256:[a-f0-9]{64}$/u;
const RECOVERY_ID = /^authoring-task-recovery:sha256:[a-f0-9]{64}$/u;
const CORRUPTION_RECEIPT_ID = /^authoring-task-journal-corruption:sha256:[a-f0-9]{64}$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;

const SESSION_STATE_KEYS = Object.freeze([
  "schemaVersion", "profile", "stateId", "sessionId", "sessionRevision", "phase", "target",
  "selection", "permission", "importedAsset", "clipMetadata", "commitCommand", "committedRevision",
  "commitReceipt", "reviewReceipt", "active", "failure", "facts", "lastEventId", "lastEventSha256",
]);

export const AUTHORING_TASK_RECOVERY_LIFECYCLES = Object.freeze([
  "ACTIVE",
  "ABANDONED",
  "COMPLETED",
]);

export const AUTHORING_TASK_RECOVERY_DECISIONS = Object.freeze([
  "CONTINUE",
  "RESTART_SOURCE",
  "REPLAY_FROZEN_COMMIT",
  "FRESH_REVIEW_RETRY",
  "TERMINAL",
  "CONFLICT",
  "BLOCKED_ADAPTER_MISMATCH",
  "ABANDON",
]);

export const AUTHORING_TASK_RECOVERY_ADAPTER_PROFILES = Object.freeze([
  "authoring-source-adapter-v1",
  "authoring-permission-adapter-v1",
  "family-workspace-authoring-port-v1",
  "authoring-commit-command-port-v1",
  "authoring-review-port-v1",
  "hardware-facing-adapter-v1",
]);

export class AuthoringTaskRecoveryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthoringTaskRecoveryError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new AuthoringTaskRecoveryError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function withoutIdentity(value, key) {
  const { [key]: _identity, ...subject } = value;
  return subject;
}

function isPlainJson(value, depth = 0) {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isPlainJson(item, depth + 1));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, child]) => typeof key === "string" && isPlainJson(child, depth + 1));
}

function sortedCanonical(value) {
  return canonicalSha256(value).sha256;
}

export function computeAuthoringTaskRecoveryId(record) {
  return `authoring-task-recovery:sha256:${sortedCanonical(withoutIdentity(record, "recordId"))}`;
}

export function encodeAuthoringTaskRecoveryRecord(record) {
  assertAuthoringTaskRecoveryRecord(record);
  return Buffer.from(`${canonicalize(record)}\n`, "utf8");
}

export function computeAuthoringTaskJournalCorruptionReceiptId(receipt) {
  return `authoring-task-journal-corruption:sha256:${sortedCanonical(withoutIdentity(receipt, "receiptId"))}`;
}

function assertBinding(binding, label) {
  if (binding === null) return;
  assert(exactKeys(binding, ["id", "version", "profile"])
    && typeof binding.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,95}$/u.test(binding.id)
    && VERSION.test(binding.version ?? "")
    && AUTHORING_TASK_RECOVERY_ADAPTER_PROFILES.includes(binding.profile),
  "AUTHORING_TASK_RECOVERY_ADAPTER_UNSUPPORTED", `${label} binding is missing or unsupported`, { label });
}

export function normalizeAuthoringTaskRecoveryAdapterBindings(input) {
  const keys = ["source", "permission", "authoring", "commitCommand", "review", "hardware"];
  assert(exactKeys(input, keys), "AUTHORING_TASK_RECOVERY_ADAPTER_INVALID",
    "adapter binding set must use the v1 fields only");
  for (const key of keys) assertBinding(input[key], key);
  return deepFreeze(clone(input));
}

function assertImportedAsset(asset, label = "importedAsset") {
  assert(exactKeys(asset, ["assetId", "contentPath", "bytes", "sha256", "durationMs", "codec"])
    && isAuthoringImportedAsset(asset)
    && Number.isSafeInteger(asset.durationMs) && asset.durationMs > 0
    && asset.codec === "WAV_PCM16_16K_MONO",
  "AUTHORING_TASK_RECOVERY_ASSET_INVALID", `${label} is malformed`);
}

function assertSelection(selection) {
  assert(exactKeys(selection, ["sourceKind", "assetId", "requiredCapability", "clipSourceKind"])
    && SOURCE_KIND.test(selection.sourceKind ?? "")
    && ASSET_ID.test(selection.assetId ?? "")
    && (selection.requiredCapability === null || CAPABILITY.test(selection.requiredCapability ?? ""))
    && AUTHORING_CLIP_SOURCE_KINDS.includes(selection.clipSourceKind),
  "AUTHORING_TASK_RECOVERY_SELECTION_INVALID", "session source selection is malformed");
}

function assertPermission(receipt, state) {
  assert(exactKeys(receipt, [
    "schemaVersion", "profile", "receiptId", "sessionId", "attemptId", "capability", "status",
  ])
    && receipt.schemaVersion === 1
    && receipt.profile === "authoring-product-permission-receipt-v1"
    && PERMISSION_RECEIPT_ID.test(receipt.receiptId ?? "")
    && receipt.receiptId === `authoring-permission:sha256:${sortedCanonical(withoutIdentity(receipt, "receiptId"))}`
    && receipt.sessionId === state.sessionId
    && TOKEN.test(receipt.attemptId ?? "")
    && CAPABILITY.test(receipt.capability ?? "")
    && ["GRANTED", "DENIED", "UNAVAILABLE"].includes(receipt.status),
  "AUTHORING_TASK_RECOVERY_PERMISSION_INVALID", "session permission receipt is malformed");
}

function assertMetadata(metadata) {
  assert(exactKeys(metadata, ["sourceKind", "transcript", "mediaType", "language"])
    && isAuthoringClipMetadata(metadata)
    && AUTHORING_CLIP_SOURCE_KINDS.includes(metadata.sourceKind)
    && AUTHORING_MEDIA_TYPES.includes(metadata.mediaType),
  "AUTHORING_TASK_RECOVERY_METADATA_INVALID", "session clip metadata is malformed");
}

function assertFailure(failure) {
  assert(exactKeys(failure, ["stage", "code", "category", "retryable", "resumePhase", "importedAssetPublished"])
    && ["PERMISSION", "SOURCE", "COMMIT_PREPARE", "COMMIT", "REVIEW"].includes(failure.stage)
    && TOKEN.test(failure.code ?? "")
    && ["DENIED", "UNAVAILABLE", "CANCELLED", "CONFLICT", "REJECTED", "INTEGRITY", "TRANSIENT"].includes(failure.category)
    && typeof failure.retryable === "boolean"
    && AUTHORING_PRODUCT_SESSION_PHASES.includes(failure.resumePhase)
    && typeof failure.importedAssetPublished === "boolean",
  "AUTHORING_TASK_RECOVERY_FAILURE_INVALID", "session failure receipt is malformed");
}

function assertCommittedSummary(summary) {
  assert(exactKeys(summary, [
    "revisionId", "parentRevisionId", "familyLibraryId", "revisionNumber", "contentRevision",
  ])
    && SHA256_ID.test(summary.revisionId ?? "")
    && (summary.parentRevisionId === null || SHA256_ID.test(summary.parentRevisionId ?? ""))
    && TOKEN.test(summary.familyLibraryId ?? "")
    && /^\d+$/u.test(summary.revisionNumber ?? "")
    && /^[a-z0-9][a-z0-9._@-]{2,95}$/u.test(summary.contentRevision ?? ""),
  "AUTHORING_TASK_RECOVERY_COMMITTED_SUMMARY_INVALID", "committed revision summary is malformed");
}

function assertCommitReceiptSummary(receipt, summary) {
  assert(exactKeys(receipt, ["status", "replayed", "outcomeHeadRevisionId"])
    && ["committed", "replayed"].includes(receipt.status)
    && typeof receipt.replayed === "boolean"
    && SHA256_ID.test(receipt.outcomeHeadRevisionId ?? "")
    && receipt.outcomeHeadRevisionId === summary.revisionId,
  "AUTHORING_TASK_RECOVERY_COMMIT_RECEIPT_INVALID", "commit outcome receipt is malformed");
}

function assertSessionSnapshot(state) {
  assertAuthoringProductSessionState(state);
  assert(exactKeys(state, SESSION_STATE_KEYS)
    && state.schemaVersion === 1
    && state.profile === "authoring-product-session-v1"
    && TOKEN.test(state.sessionId ?? "")
    && Number.isSafeInteger(state.sessionRevision) && state.sessionRevision >= 0
    && AUTHORING_PRODUCT_SESSION_PHASES.includes(state.phase)
    && exactKeys(state.target, ["familyLibraryId", "baseRevisionId", "bindingId", "clipId"])
    && TOKEN.test(state.target?.familyLibraryId ?? "")
    && SHA256_ID.test(state.target.baseRevisionId ?? "")
    && TOKEN.test(state.target.bindingId ?? "")
    && TOKEN.test(state.target.clipId ?? "")
    && exactKeys(state.facts, [
      "importedAssetPublished", "durableRevisionPresent", "reviewReceiptPresent", "buildAuthorized", "offlineReady",
    ])
    && Object.values(state.facts).every((value) => typeof value === "boolean")
    && (state.lastEventId === null || TOKEN.test(state.lastEventId ?? ""))
    && (state.lastEventSha256 === null || SHA256.test(state.lastEventSha256 ?? "")),
  "AUTHORING_TASK_RECOVERY_SESSION_INVALID", "canonical session snapshot is malformed");

  if (state.selection !== null) assertSelection(state.selection);
  if (state.permission !== null) assertPermission(state.permission, state);
  if (state.importedAsset !== null) assertImportedAsset(state.importedAsset);
  if (state.clipMetadata !== null) assertMetadata(state.clipMetadata);
  if (state.commitCommand !== null) {
    assert(state.importedAsset !== null && state.clipMetadata !== null,
      "AUTHORING_TASK_RECOVERY_COMMAND_INVALID", "frozen command lacks its durable inputs");
    try {
      assertAuthoringProductCommitCommand(state.commitCommand, state);
    } catch (error) {
      fail("AUTHORING_TASK_RECOVERY_COMMAND_INVALID", "frozen commit command is malformed", {
        cause: error?.message ?? String(error),
      });
    }
  }
  if (state.committedRevision !== null) assertCommittedSummary(state.committedRevision);
  if (state.commitReceipt !== null) {
    assert(state.committedRevision !== null, "AUTHORING_TASK_RECOVERY_COMMIT_RECEIPT_INVALID",
      "commit receipt requires a committed revision summary");
    assertCommitReceiptSummary(state.commitReceipt, state.committedRevision);
  }
  if (state.reviewReceipt !== null) {
    assert(state.committedRevision !== null && state.importedAsset !== null,
      "AUTHORING_TASK_RECOVERY_REVIEW_RECEIPT_INVALID", "review receipt lacks its durable identities");
    try {
      assertAuthoringProductReviewReceipt(state.reviewReceipt, {
        reviewAttemptId: state.reviewReceipt.reviewAttemptId,
        sessionId: state.sessionId,
        familyRevisionId: state.committedRevision.revisionId,
        bindingId: state.target.bindingId,
        clipId: state.target.clipId,
        assetId: state.importedAsset.assetId,
        assetSha256: state.importedAsset.sha256,
      });
    } catch (error) {
      fail("AUTHORING_TASK_RECOVERY_REVIEW_RECEIPT_INVALID", "review receipt is malformed", {
        cause: error?.message ?? String(error),
      });
    }
  }
  if (state.active !== null) {
    assert(exactKeys(state.active, ["stage", "attemptId"])
      && ["PERMISSION", "SOURCE", "COMMIT_PREPARE", "COMMIT", "REVIEW"].includes(state.active.stage)
      && TOKEN.test(state.active.attemptId ?? ""),
    "AUTHORING_TASK_RECOVERY_ACTIVE_INVALID", "active session attempt is malformed");
  }
  if (state.failure !== null) assertFailure(state.failure);
  if (state.permission !== null) {
    assert(state.selection !== null
      && state.permission.capability === state.selection.requiredCapability,
    "AUTHORING_TASK_RECOVERY_PERMISSION_INVALID", "permission receipt is not bound to the selected source");
  }
  if (state.importedAsset !== null) {
    assert(state.selection !== null,
      "AUTHORING_TASK_RECOVERY_SESSION_INVALID", "durable asset requires a source selection");
  }
  if (state.clipMetadata !== null) {
    assert(state.selection !== null
      && state.clipMetadata.sourceKind === state.selection.clipSourceKind,
    "AUTHORING_TASK_RECOVERY_METADATA_INVALID", "metadata is not bound to the selected source kind");
  }
  if (state.commitCommand !== null) {
    assert(state.importedAsset !== null && state.clipMetadata !== null,
      "AUTHORING_TASK_RECOVERY_COMMAND_INVALID", "frozen command lacks its durable inputs");
  }
  if (state.committedRevision !== null) {
    assert(state.commitCommand !== null
      && state.committedRevision.parentRevisionId === state.target.baseRevisionId
      && state.committedRevision.familyLibraryId === state.target.familyLibraryId,
    "AUTHORING_TASK_RECOVERY_COMMITTED_SUMMARY_INVALID",
    "committed revision summary crossed the session target");
  }
  if (state.reviewReceipt !== null) {
    assert(state.committedRevision !== null && state.commitCommand !== null,
      "AUTHORING_TASK_RECOVERY_REVIEW_RECEIPT_INVALID", "review receipt requires a frozen committed command");
  }
  if (state.active !== null) {
    const expectedStage = {
      AWAITING_PERMISSION: "PERMISSION",
      ACQUIRING_SOURCE: "SOURCE",
      PREPARING_COMMIT: "COMMIT_PREPARE",
      COMMITTING: "COMMIT",
      REVIEWING: "REVIEW",
    }[state.phase];
    assert(expectedStage === state.active.stage,
      "AUTHORING_TASK_RECOVERY_ACTIVE_INVALID", "active attempt does not match the session phase");
  }
  if (["AWAITING_PERMISSION", "ACQUIRING_SOURCE", "PREPARING_COMMIT", "COMMITTING", "REVIEWING"]
    .includes(state.phase)) {
    assert(state.active !== null,
      "AUTHORING_TASK_RECOVERY_ACTIVE_INVALID", "an active session phase requires an active attempt");
  }
  assert(state.importedAsset === null || state.facts.importedAssetPublished === true,
    "AUTHORING_TASK_RECOVERY_SESSION_INVALID", "canonical asset lacks its durable publication fact");
  assert(state.committedRevision === null || state.facts.durableRevisionPresent === true,
    "AUTHORING_TASK_RECOVERY_SESSION_INVALID", "committed summary lacks its durable revision fact");
  assert(state.reviewReceipt === null || state.facts.reviewReceiptPresent === true,
    "AUTHORING_TASK_RECOVERY_SESSION_INVALID", "review receipt lacks its durable review fact");
}

function assertRecoveryContext(context, state) {
  assert(exactKeys(context, [
    "sourceRequest", "committedRevision", "eventSequence", "attemptSequence", "activeEffect",
  ])
    && isPlainJson(context.sourceRequest)
    && Number.isSafeInteger(context.eventSequence) && context.eventSequence >= state.sessionRevision
    && Number.isSafeInteger(context.attemptSequence) && context.attemptSequence >= 0,
  "AUTHORING_TASK_RECOVERY_CONTEXT_INVALID", "recovery context is malformed");
  if (context.committedRevision !== null) {
    try {
      assertFamilyRevisionSemantics(context.committedRevision);
    } catch (error) {
      fail("AUTHORING_TASK_RECOVERY_REVISION_INVALID", "recovery context committed revision is malformed", {
        cause: error?.message ?? String(error),
      });
    }
    assert(state.committedRevision?.revisionId === context.committedRevision.revisionId,
      "AUTHORING_TASK_RECOVERY_REVISION_INVALID", "recovery context revision differs from session summary");
  }
  assert((state.facts.durableRevisionPresent === true) === (context.committedRevision !== null),
    "AUTHORING_TASK_RECOVERY_CONTEXT_INVALID", "recovery context durable revision presence disagrees with state");
  if (context.activeEffect !== null) {
    assert(exactKeys(context.activeEffect, [
      "stage", "attemptId", "abortable", "importedAssetPublished", "cancelRequested",
    ])
      && ["PERMISSION", "SOURCE", "COMMIT_PREPARE", "COMMIT", "REVIEW"].includes(context.activeEffect.stage)
      && TOKEN.test(context.activeEffect.attemptId ?? "")
      && typeof context.activeEffect.abortable === "boolean"
      && typeof context.activeEffect.importedAssetPublished === "boolean"
      && typeof context.activeEffect.cancelRequested === "boolean"
      && state.active?.stage === context.activeEffect.stage
      && state.active?.attemptId === context.activeEffect.attemptId,
    "AUTHORING_TASK_RECOVERY_CONTEXT_INVALID", "active effect context disagrees with session state");
  } else {
    assert(state.active === null, "AUTHORING_TASK_RECOVERY_CONTEXT_INVALID",
      "active session state requires an active effect recovery fact");
  }
}

function makeDecision(kind, reasonCode, resumePhase, requiresUserAction, releaseGate = null) {
  const decision = { kind, reasonCode, resumePhase, requiresUserAction, releaseGate };
  assertAuthoringTaskRecoveryDecision(decision);
  return decision;
}

export function assertAuthoringTaskRecoveryDecision(decision) {
  function assertBindingEvidence(entries, label) {
    assert(Array.isArray(entries) && entries.length <= 32
      && entries.every((entry) => exactKeys(entry, ["name", "binding"])
        && TOKEN.test(entry.name ?? "")
        && isPlainJson(entry.binding)),
    "AUTHORING_TASK_RECOVERY_DECISION_INVALID", `${label} binding evidence is malformed`);
  }

  assert(exactKeys(decision, ["kind", "reasonCode", "resumePhase", "requiresUserAction", "releaseGate"])
    && AUTHORING_TASK_RECOVERY_DECISIONS.includes(decision.kind)
    && TOKEN.test(decision.reasonCode ?? "")
    && (decision.resumePhase === null || AUTHORING_PRODUCT_SESSION_PHASES.includes(decision.resumePhase))
    && typeof decision.requiresUserAction === "boolean"
    && (decision.releaseGate === null || exactKeys(decision.releaseGate, [
      "status", "code", "requiredBindings", "providedBindings", "coreMutation",
    ])
      && decision.releaseGate.status === "BLOCKED"
      && TOKEN.test(decision.releaseGate.code ?? "")
      && Array.isArray(decision.releaseGate.requiredBindings)
      && Array.isArray(decision.releaseGate.providedBindings)
      && decision.releaseGate.coreMutation === "NONE"),
  "AUTHORING_TASK_RECOVERY_DECISION_INVALID", "recovery decision is malformed");
  if (decision.releaseGate !== null) {
    assertBindingEvidence(decision.releaseGate.requiredBindings, "required");
    assertBindingEvidence(decision.releaseGate.providedBindings, "provided");
  }
  if (decision.kind === "BLOCKED_ADAPTER_MISMATCH") {
    assert(decision.releaseGate !== null, "AUTHORING_TASK_RECOVERY_DECISION_INVALID",
      "blocked adapter decision requires ReleaseGate evidence");
  } else {
    assert(decision.releaseGate === null, "AUTHORING_TASK_RECOVERY_DECISION_INVALID",
      "non-blocked recovery decision cannot carry ReleaseGate evidence");
  }
  return decision;
}

export function classifyAuthoringTaskRecoverySnapshot({ sessionSnapshot, recoveryContext, lifecycle = "ACTIVE" }) {
  assertSessionSnapshot(sessionSnapshot);
  assertRecoveryContext(recoveryContext, sessionSnapshot);
  assert(AUTHORING_TASK_RECOVERY_LIFECYCLES.includes(lifecycle),
    "AUTHORING_TASK_RECOVERY_LIFECYCLE_INVALID", "unknown recovery lifecycle");
  if (lifecycle === "ABANDONED") return makeDecision("ABANDON", "TASK_ABANDONED", null, false);
  if (lifecycle === "COMPLETED" || sessionSnapshot.phase === "COMPLETED" || sessionSnapshot.phase === "CANCELLED") {
    return makeDecision("TERMINAL", "SESSION_TERMINAL", null, false);
  }

  const hasSource = sessionSnapshot.selection !== null && recoveryContext.sourceRequest !== null;
  switch (sessionSnapshot.phase) {
    case "AWAITING_SOURCE":
      return hasSource
        ? makeDecision("RESTART_SOURCE", "SOURCE_NOT_DURABLE", "READY_TO_ACQUIRE", true)
        : makeDecision("ABANDON", "SOURCE_SELECTION_MISSING", null, true);
    case "READY_TO_ACQUIRE":
    case "AWAITING_PERMISSION":
    case "ACQUIRING_SOURCE":
      return hasSource
        ? makeDecision("RESTART_SOURCE", "PRE_DURABLE_ACQUISITION_INTERRUPTED", "READY_TO_ACQUIRE", true)
        : makeDecision("ABANDON", "SOURCE_RECOVERY_INPUT_MISSING", null, true);
    case "AWAITING_METADATA":
      return makeDecision("CONTINUE", "IMPORTED_ASSET_DURABLE", "AWAITING_METADATA", false);
    case "READY_TO_COMMIT":
      return sessionSnapshot.commitCommand === null
        ? makeDecision("CONTINUE", "COMMIT_INPUTS_DURABLE", "READY_TO_COMMIT", false)
        : makeDecision("REPLAY_FROZEN_COMMIT", "FROZEN_COMMAND_PRESENT", "READY_TO_COMMIT", false);
    case "PREPARING_COMMIT":
      return makeDecision("CONTINUE", "PREPARING_COMMIT_SAFE_RETRY", "READY_TO_COMMIT", false);
    case "COMMITTING":
      return makeDecision("REPLAY_FROZEN_COMMIT", "COMMIT_TRUTH_BARRIER_REPLAY", "READY_TO_COMMIT", false);
    case "READY_TO_REVIEW":
      return makeDecision("CONTINUE", "COMMITTED_REVISION_DURABLE", "READY_TO_REVIEW", false);
    case "REVIEWING":
      return makeDecision("FRESH_REVIEW_RETRY", "REVIEW_ATTEMPT_INTERRUPTED", "READY_TO_REVIEW", false);
    case "CONFLICT":
      return makeDecision("CONFLICT", "EXPLICIT_CAS_CONFLICT", null, true);
    case "REJECTED":
      return makeDecision("FRESH_REVIEW_RETRY", "REVIEW_REJECTED", "READY_TO_REVIEW", true);
    case "FAILED": {
      const failure = sessionSnapshot.failure;
      if (!failure) return makeDecision("ABANDON", "FAILURE_FACT_MISSING", null, true);
      if (failure.category === "CONFLICT") return makeDecision("CONFLICT", "RECORDED_CAS_CONFLICT", null, true);
      if (failure.stage === "REVIEW") return makeDecision("FRESH_REVIEW_RETRY", "REVIEW_FAILURE_RETRY", "READY_TO_REVIEW", true);
      if (failure.stage === "COMMIT" && sessionSnapshot.commitCommand !== null) {
        return makeDecision("REPLAY_FROZEN_COMMIT", "COMMIT_FAILURE_REPLAY", "READY_TO_COMMIT", true);
      }
      if (failure.stage === "COMMIT_PREPARE") {
        return makeDecision("CONTINUE", "COMMIT_PREPARATION_FAILURE_RETRY", "READY_TO_COMMIT", true);
      }
      return hasSource
        ? makeDecision("RESTART_SOURCE", "SOURCE_FAILURE_RETRY", "READY_TO_ACQUIRE", true)
        : makeDecision("ABANDON", "SOURCE_FAILURE_INPUT_MISSING", null, true);
    }
    default:
      return makeDecision("ABANDON", "UNCLASSIFIED_SESSION_PHASE", null, true);
  }
}

function defaultRecoveryContext(state, input) {
  const activeEffect = state.active === null ? null : {
    stage: state.active.stage,
    attemptId: state.active.attemptId,
    abortable: state.active.stage !== "COMMIT",
    importedAssetPublished: state.facts.importedAssetPublished,
    cancelRequested: false,
  };
  return {
    sourceRequest: input.sourceRequest ?? null,
    committedRevision: input.committedRevision ?? null,
    eventSequence: input.eventSequence ?? state.sessionRevision,
    attemptSequence: input.attemptSequence ?? state.sessionRevision,
    activeEffect: input.activeEffect ?? activeEffect,
  };
}

export function createAuthoringTaskRecoveryRecord(input) {
  assert(input && typeof input === "object" && !Array.isArray(input),
    "AUTHORING_TASK_RECOVERY_INPUT_INVALID", "recovery record input is required");
  const sessionSnapshot = clone(input.sessionSnapshot);
  assertSessionSnapshot(sessionSnapshot);
  const lifecycle = input.lifecycle
    ?? (sessionSnapshot.phase === "COMPLETED" ? "COMPLETED" : "ACTIVE");
  assert(AUTHORING_TASK_RECOVERY_LIFECYCLES.includes(lifecycle),
    "AUTHORING_TASK_RECOVERY_LIFECYCLE_INVALID", "unknown recovery lifecycle");
  const recoveryContext = clone(input.recoveryContext ?? defaultRecoveryContext(sessionSnapshot, input));
  const adapterBindings = normalizeAuthoringTaskRecoveryAdapterBindings(input.adapterBindings);
  assert(TOKEN.test(input.taskId ?? "") && TOKEN.test(sessionSnapshot.sessionId ?? ""),
    "AUTHORING_TASK_RECOVERY_IDENTITY_INVALID", "taskId and sessionId are malformed");
  assert(Number.isSafeInteger(input.journalRevision ?? 0) && (input.journalRevision ?? 0) >= 0,
    "AUTHORING_TASK_RECOVERY_REVISION_INVALID", "journalRevision must be a non-negative safe integer");
  assertRecoveryContext(recoveryContext, sessionSnapshot);
  const decision = clone(input.decision
    ?? classifyAuthoringTaskRecoverySnapshot({ sessionSnapshot, recoveryContext, lifecycle }));
  assertAuthoringTaskRecoveryDecision(decision);
  const record = {
    schemaVersion: 1,
    profile: "authoring-task-recovery-v1",
    recordId: "authoring-task-recovery:sha256:" + "0".repeat(64),
    taskId: input.taskId,
    sessionId: sessionSnapshot.sessionId,
    journalRevision: input.journalRevision ?? 0,
    lifecycle,
    expectedStateId: sessionSnapshot.stateId,
    sessionSnapshot,
    recoveryContext,
    adapterBindings,
    decision,
  };
  record.recordId = computeAuthoringTaskRecoveryId(record);
  return assertAuthoringTaskRecoveryRecord(record);
}

export function updateAuthoringTaskRecoveryRecord(record, patch = {}) {
  assertAuthoringTaskRecoveryRecord(record);
  assert(patch && typeof patch === "object" && !Array.isArray(patch),
    "AUTHORING_TASK_RECOVERY_INPUT_INVALID", "recovery record patch is malformed");
  const allowed = ["lifecycle", "sessionSnapshot", "recoveryContext", "adapterBindings", "decision"];
  assert(Object.keys(patch).every((key) => allowed.includes(key)),
    "AUTHORING_TASK_RECOVERY_INPUT_INVALID", "recovery record patch contains an unknown key");
  const sessionSnapshot = clone(patch.sessionSnapshot ?? record.sessionSnapshot);
  const recoveryContext = clone(patch.recoveryContext ?? record.recoveryContext);
  const lifecycle = patch.lifecycle ?? record.lifecycle;
  const adapterBindings = normalizeAuthoringTaskRecoveryAdapterBindings(patch.adapterBindings ?? record.adapterBindings);
  const decision = clone(patch.decision
    ?? classifyAuthoringTaskRecoverySnapshot({ sessionSnapshot, recoveryContext, lifecycle }));
  return createAuthoringTaskRecoveryRecord({
    taskId: record.taskId,
    journalRevision: record.journalRevision + 1,
    lifecycle,
    sessionSnapshot,
    recoveryContext,
    adapterBindings,
    decision,
  });
}

export function assertAuthoringTaskRecoveryRecord(record) {
  assert(exactKeys(record, [
    "schemaVersion", "profile", "recordId", "taskId", "sessionId", "journalRevision", "lifecycle",
    "expectedStateId", "sessionSnapshot", "recoveryContext", "adapterBindings", "decision",
  ])
    && record.schemaVersion === 1
    && record.profile === "authoring-task-recovery-v1"
    && RECOVERY_ID.test(record.recordId ?? "")
    && TOKEN.test(record.taskId ?? "")
    && TOKEN.test(record.sessionId ?? "")
    && Number.isSafeInteger(record.journalRevision) && record.journalRevision >= 0
    && AUTHORING_TASK_RECOVERY_LIFECYCLES.includes(record.lifecycle)
    && record.expectedStateId === record.sessionSnapshot?.stateId,
  "AUTHORING_TASK_RECOVERY_RECORD_INVALID", "recovery record header is malformed");
  assertSessionSnapshot(record.sessionSnapshot);
  assertRecoveryContext(record.recoveryContext, record.sessionSnapshot);
  normalizeAuthoringTaskRecoveryAdapterBindings(record.adapterBindings);
  assertAuthoringTaskRecoveryDecision(record.decision);
  if (record.lifecycle === "COMPLETED") {
    assert(record.sessionSnapshot.phase === "COMPLETED",
      "AUTHORING_TASK_RECOVERY_LIFECYCLE_INVALID", "completed recovery records require a completed session");
  }
  assert(record.recordId === computeAuthoringTaskRecoveryId(record),
    "AUTHORING_TASK_RECOVERY_RECORD_INVALID", "recovery record identity mismatch");
  return deepFreeze(clone(record));
}

export function createAuthoringTaskJournalCorruptionReceipt(input) {
  assert(input && typeof input === "object" && !Array.isArray(input),
    "AUTHORING_TASK_JOURNAL_CORRUPTION_INVALID", "corruption receipt input is required");
  assert((input.taskId === null || TOKEN.test(input.taskId ?? ""))
    && SHA256.test(input.sourceSha256 ?? "")
    && typeof input.code === "string" && TOKEN.test(input.code)
    && typeof input.originalFile === "string" && input.originalFile.length > 0
    && typeof input.quarantineFile === "string" && input.quarantineFile.length > 0,
  "AUTHORING_TASK_JOURNAL_CORRUPTION_INVALID", "corruption receipt fields are malformed");
  const receipt = {
    schemaVersion: 1,
    profile: "authoring-task-journal-corruption-receipt-v1",
    receiptId: "authoring-task-journal-corruption:sha256:" + "0".repeat(64),
    taskId: input.taskId ?? null,
    sourceSha256: input.sourceSha256,
    code: input.code,
    originalFile: input.originalFile,
    quarantineFile: input.quarantineFile,
    preserved: true,
  };
  receipt.receiptId = computeAuthoringTaskJournalCorruptionReceiptId(receipt);
  return assertAuthoringTaskJournalCorruptionReceipt(receipt);
}

export function assertAuthoringTaskJournalCorruptionReceipt(receipt) {
  assert(exactKeys(receipt, [
    "schemaVersion", "profile", "receiptId", "taskId", "sourceSha256", "code", "originalFile",
    "quarantineFile", "preserved",
  ])
    && receipt.schemaVersion === 1
    && receipt.profile === "authoring-task-journal-corruption-receipt-v1"
    && CORRUPTION_RECEIPT_ID.test(receipt.receiptId ?? "")
    && (receipt.taskId === null || TOKEN.test(receipt.taskId ?? ""))
    && SHA256.test(receipt.sourceSha256 ?? "")
    && TOKEN.test(receipt.code ?? "")
    && typeof receipt.originalFile === "string" && typeof receipt.quarantineFile === "string"
    && receipt.preserved === true
    && receipt.receiptId === computeAuthoringTaskJournalCorruptionReceiptId(receipt),
  "AUTHORING_TASK_JOURNAL_CORRUPTION_INVALID", "corruption receipt is malformed");
  return deepFreeze(clone(receipt));
}

export function authoringTaskRecoveryCanonicalBytes(record) {
  return encodeAuthoringTaskRecoveryRecord(record);
}
