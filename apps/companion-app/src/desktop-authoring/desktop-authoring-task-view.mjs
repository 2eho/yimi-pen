import {
  assertAuthoringTaskRecoveryDecision,
  assertAuthoringTaskRecoveryRecord,
} from "../authoring/authoring-task-recovery-contract.mjs";
import { AUTHORING_PRODUCT_SESSION_PHASES } from "../authoring/authoring-product-session-core.mjs";

const PROFILE = "desktop-authoring-task-view-v1";
const ATTENTION_KINDS = Object.freeze([
  "ACTION_REQUIRED",
  "CONFLICT",
  "ADAPTER_MISMATCH",
  "TERMINAL",
  "JOURNAL_CORRUPTION",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function safeSource(source) {
  return {
    sourceKind: source.sourceKind,
    requiredCapability: source.requiredCapability ?? null,
    clipSourceKind: source.clipSourceKind,
  };
}

function safeSelection(selection) {
  if (selection === null) return null;
  return {
    sourceKind: selection.sourceKind,
    assetId: selection.assetId,
    requiredCapability: selection.requiredCapability ?? null,
    clipSourceKind: selection.clipSourceKind,
  };
}

function safeTarget(target) {
  if (target === null) return null;
  return {
    familyLibraryId: target.familyLibraryId,
    baseRevisionId: target.baseRevisionId,
    bindingId: target.bindingId,
    clipId: target.clipId,
  };
}

function safeMetadata(metadata) {
  if (metadata === null) return null;
  return {
    sourceKind: metadata.sourceKind,
    transcript: metadata.transcript,
    mediaType: metadata.mediaType,
    language: metadata.language,
  };
}

function safeCommittedRevision(revision) {
  if (revision === null) return null;
  return {
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    familyLibraryId: revision.familyLibraryId,
    revisionNumber: revision.revisionNumber,
    contentRevision: revision.contentRevision,
  };
}

function safePermission(permission) {
  if (permission === null) return null;
  const guidance = ["DENIED", "UNAVAILABLE"].includes(permission.status)
    ? {
      kind: "SETTINGS",
      actionId: "CHECK_OS_PERMISSION_SETTINGS",
      canTriggerNativePrompt: false,
    }
    : null;
  return {
    capability: permission.capability,
    status: permission.status,
    guidance,
  };
}

function safeAsset(asset) {
  if (asset === null) return null;
  return {
    assetId: asset.assetId,
    sha256: asset.sha256,
    bytes: asset.bytes,
    durationMs: asset.durationMs,
    codec: asset.codec,
  };
}

function safeFailure(failure) {
  if (failure === null) return null;
  return {
    stage: failure.stage,
    code: failure.code,
    category: failure.category,
    retryable: failure.retryable,
    resumePhase: failure.resumePhase,
    importedAssetPublished: failure.importedAssetPublished,
  };
}

function safeDecision(decision) {
  if (decision === null) return null;
  assertAuthoringTaskRecoveryDecision(decision);
  const releaseGate = decision.releaseGate === null
    ? null
    : {
      status: decision.releaseGate.status,
      code: decision.releaseGate.code,
      coreMutation: decision.releaseGate.coreMutation,
      requiredBindings: decision.releaseGate.requiredBindings.map((entry) => entry.name),
      providedBindings: decision.releaseGate.providedBindings.map((entry) => entry.name),
    };
  return {
    kind: decision.kind,
    reasonCode: decision.reasonCode,
    resumePhase: decision.resumePhase,
    requiresUserAction: decision.requiresUserAction,
    releaseGate,
  };
}

function attentionFor(decision) {
  if (decision === null) return null;
  const abandonActionRequired = decision.kind === "ABANDON" && decision.requiresUserAction;
  const kind = abandonActionRequired
    ? "ACTION_REQUIRED"
    : decision.kind === "BLOCKED_ADAPTER_MISMATCH"
    ? "ADAPTER_MISMATCH"
    : decision.kind === "CONFLICT"
      ? "CONFLICT"
      : decision.kind === "TERMINAL" || decision.kind === "ABANDON"
        ? "TERMINAL"
        : null;
  if (kind === null) return null;
  return {
    kind,
    reasonCode: decision.reasonCode,
    requiresUserAction: decision.requiresUserAction,
    coreMutation: "NONE",
    actionId: abandonActionRequired ? "ABANDON_TASK" : null,
    releaseGate: decision.releaseGate === null
      ? null
      : {
        status: decision.releaseGate.status,
        code: decision.releaseGate.code,
        coreMutation: decision.releaseGate.coreMutation,
      },
  };
}

function commandAvailability(state, attention, decision) {
  const phase = state?.phase ?? null;
  const hasAttention = attention !== null;
  const canAbandonAction = attention?.kind === "ACTION_REQUIRED"
    && attention.actionId === "ABANDON_TASK";
  const replayFrozenCommit = decision?.kind === "REPLAY_FROZEN_COMMIT";
  const active = state?.active;
  const canCancel = !hasAttention
    && phase !== null
    && !["COMPLETED", "CANCELLED", "COMMITTING"].includes(phase);
  return {
    canSelectSource: !hasAttention && ["AWAITING_SOURCE", "READY_TO_ACQUIRE"].includes(phase),
    canAcquire: !hasAttention && phase === "READY_TO_ACQUIRE",
    canSubmitMetadata: !hasAttention && ["AWAITING_METADATA", "READY_TO_COMMIT"].includes(phase),
    canCommit: !hasAttention && phase === "READY_TO_COMMIT",
    canReview: !hasAttention && phase === "READY_TO_REVIEW",
    canRetry: !hasAttention && ["FAILED", "REJECTED"].includes(phase),
    canCancel,
    canAbandon: canAbandonAction || (!hasAttention
      && !replayFrozenCommit
      && phase !== "COMPLETED"
      && phase !== "CANCELLED"
      && phase !== "COMMITTING"),
    activeEffect: active === null
      ? null
      : {
        stage: active.stage,
        abortable: active.stage !== "COMMIT",
      },
  };
}

function emptyView({ taskId = null, attention }) {
  return deepFreeze({
    schemaVersion: 1,
    profile: PROFILE,
    taskId,
    recordId: null,
    journalRevision: null,
    stateId: null,
    sessionRevision: null,
    lifecycle: null,
    phase: "ATTENTION",
    target: null,
    selection: null,
    permission: null,
    importedAsset: null,
    metadata: null,
    committedRevision: null,
    review: null,
    failure: null,
    recoveryDecision: null,
    attention,
    facts: {
      importedAssetPublished: false,
      contentRevisionSaved: false,
      reviewReceiptPresent: false,
      buildAuthorized: false,
      offlineReady: false,
      deviceInstall: {
        status: "UNRESOLVED",
        hardwareImpact: "NONE",
      },
    },
    availableSources: [],
    commands: {
      canSelectSource: false,
      canAcquire: false,
      canSubmitMetadata: false,
      canCommit: false,
      canReview: false,
      canRetry: false,
      canCancel: false,
      canAbandon: false,
      activeEffect: null,
    },
  });
}

/**
 * Project one persisted recovery record into the only renderer-facing object.
 * The projection is deliberately a whitelist: source requests, content paths,
 * device names, staging paths, repository objects, and adapter errors never
 * cross this boundary.
 */
export function projectDesktopAuthoringTaskView({
  record = null,
  decision = record?.decision ?? null,
  availableSources = [],
  corruption = null,
  taskId = record?.taskId ?? null,
} = {}) {
  if (corruption !== null) {
    return emptyView({
      taskId,
      attention: {
        kind: "JOURNAL_CORRUPTION",
        reasonCode: "JOURNAL_CORRUPT",
        requiresUserAction: true,
        coreMutation: "NONE",
        releaseGate: null,
      },
    });
  }
  if (record === null) {
    return emptyView({
      taskId,
      attention: {
        kind: "JOURNAL_CORRUPTION",
        reasonCode: "JOURNAL_RECORD_MISSING",
        requiresUserAction: true,
        coreMutation: "NONE",
        releaseGate: null,
      },
    });
  }

  assertAuthoringTaskRecoveryRecord(record);
  const state = record.sessionSnapshot;
  if (!AUTHORING_PRODUCT_SESSION_PHASES.includes(state.phase)) {
    throw new TypeError("desktop authoring view received an unknown session phase");
  }
  const safeDecisionValue = safeDecision(decision);
  const attention = attentionFor(decision);
  const commands = commandAvailability(state, attention, decision);
  const review = state.reviewReceipt === null
    ? null
    : {
      present: true,
      fixtureOnly: state.reviewReceipt.fixtureOnly,
      completedAt: state.reviewReceipt.completedAt,
    };
  return deepFreeze({
    schemaVersion: 1,
    profile: PROFILE,
    taskId: record.taskId,
    recordId: record.recordId,
    journalRevision: record.journalRevision,
    stateId: state.stateId,
    sessionRevision: state.sessionRevision,
    lifecycle: record.lifecycle,
    phase: state.phase,
    target: safeTarget(state.target),
    selection: safeSelection(state.selection),
    permission: safePermission(state.permission),
    importedAsset: safeAsset(state.importedAsset),
    metadata: safeMetadata(state.clipMetadata),
    committedRevision: safeCommittedRevision(state.committedRevision),
    review,
    failure: safeFailure(state.failure),
    recoveryDecision: safeDecisionValue,
    attention,
    facts: {
      importedAssetPublished: state.facts.importedAssetPublished,
      contentRevisionSaved: state.facts.durableRevisionPresent,
      reviewReceiptPresent: state.facts.reviewReceiptPresent,
      buildAuthorized: state.facts.buildAuthorized,
      offlineReady: state.facts.offlineReady,
      deviceInstall: {
        status: "UNRESOLVED",
        hardwareImpact: "NONE",
      },
    },
    availableSources: availableSources.map(safeSource),
    commands,
  });
}

export const createDesktopAuthoringTaskView = projectDesktopAuthoringTaskView;
export const DesktopAuthoringTaskView = Object.freeze({
  profile: PROFILE,
  project: projectDesktopAuthoringTaskView,
});

export function assertDesktopAuthoringTaskView(view) {
  if (!view || view.profile !== PROFILE || view.schemaVersion !== 1) {
    throw new TypeError("desktop authoring task view is not v1");
  }
  const exactKeys = (value, keys) => value !== null
    && value !== undefined
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
  const assertFrozen = (value) => {
    if (!value || typeof value !== "object") return;
    if (!Object.isFrozen(value)) throw new TypeError("desktop authoring task view must be deeply immutable");
    for (const child of Object.values(value)) assertFrozen(child);
  };
  if (!Object.isFrozen(view)) {
    throw new TypeError("desktop authoring task view must be deeply immutable");
  }
  assertFrozen(view);
  if (!exactKeys(view, [
    "schemaVersion", "profile", "taskId", "recordId", "journalRevision", "stateId", "sessionRevision",
    "lifecycle", "phase", "target", "selection", "permission", "importedAsset", "metadata",
    "committedRevision", "review", "failure", "recoveryDecision", "attention", "facts",
    "availableSources", "commands",
  ]) || !exactKeys(view.facts, [
    "importedAssetPublished", "contentRevisionSaved", "reviewReceiptPresent", "buildAuthorized",
    "offlineReady", "deviceInstall",
  ]) || !exactKeys(view.facts.deviceInstall, ["status", "hardwareImpact"])
    || !exactKeys(view.commands, [
      "canSelectSource", "canAcquire", "canSubmitMetadata", "canCommit", "canReview", "canRetry",
      "canCancel", "canAbandon", "activeEffect",
    ])) {
    throw new TypeError("desktop authoring task view shape is not whitelisted");
  }
  if (view.target !== null && !exactKeys(view.target, ["familyLibraryId", "baseRevisionId", "bindingId", "clipId"])) {
    throw new TypeError("desktop authoring task view target is not whitelisted");
  }
  if (view.selection !== null && !exactKeys(view.selection, ["sourceKind", "assetId", "requiredCapability", "clipSourceKind"])) {
    throw new TypeError("desktop authoring task view selection is not whitelisted");
  }
  if (view.permission !== null && (!exactKeys(view.permission, ["capability", "status", "guidance"])
    || (view.permission.guidance !== null
      && !exactKeys(view.permission.guidance, ["kind", "actionId", "canTriggerNativePrompt"])))) {
    throw new TypeError("desktop authoring task view permission is not whitelisted");
  }
  if (view.importedAsset !== null && !exactKeys(view.importedAsset, ["assetId", "sha256", "bytes", "durationMs", "codec"])) {
    throw new TypeError("desktop authoring task view asset is not whitelisted");
  }
  if (view.metadata !== null && !exactKeys(view.metadata, ["sourceKind", "transcript", "mediaType", "language"])) {
    throw new TypeError("desktop authoring task view metadata is not whitelisted");
  }
  if (view.committedRevision !== null && !exactKeys(view.committedRevision, [
    "revisionId", "parentRevisionId", "familyLibraryId", "revisionNumber", "contentRevision",
  ])) {
    throw new TypeError("desktop authoring task view committed revision is not whitelisted");
  }
  if (view.review !== null && !exactKeys(view.review, ["present", "fixtureOnly", "completedAt"])) {
    throw new TypeError("desktop authoring task view review is not whitelisted");
  }
  if (view.failure !== null && !exactKeys(view.failure, [
    "stage", "code", "category", "retryable", "resumePhase", "importedAssetPublished",
  ])) {
    throw new TypeError("desktop authoring task view failure is not whitelisted");
  }
  if (view.recoveryDecision !== null && !exactKeys(view.recoveryDecision, [
    "kind", "reasonCode", "resumePhase", "requiresUserAction", "releaseGate",
  ])) {
    throw new TypeError("desktop authoring task view recovery decision is not whitelisted");
  }
  const assertPublicReleaseGate = (gate, label) => {
    if (gate === null) return;
    if (!exactKeys(gate, ["status", "code", "coreMutation"])) {
      throw new TypeError(`desktop authoring task view ${label} release gate is not whitelisted`);
    }
  };
  if (view.recoveryDecision !== null) {
    const gate = view.recoveryDecision.releaseGate;
    if (gate !== null) {
      if (!exactKeys(gate, ["status", "code", "coreMutation", "requiredBindings", "providedBindings"])
        || !Array.isArray(gate.requiredBindings) || !Array.isArray(gate.providedBindings)
        || gate.requiredBindings.some((name) => typeof name !== "string")
        || gate.providedBindings.some((name) => typeof name !== "string")) {
        throw new TypeError("desktop authoring task view recovery release gate is not whitelisted");
      }
    }
  }
  if (view.attention !== null) assertPublicReleaseGate(view.attention.releaseGate, "attention");
  if (view.attention !== null && !exactKeys(view.attention, [
    "kind", "reasonCode", "requiresUserAction", "coreMutation", "actionId", "releaseGate",
  ])) {
    throw new TypeError("desktop authoring task view attention is not whitelisted");
  }
  if (!Array.isArray(view.availableSources) || view.availableSources.some((source) =>
    !exactKeys(source, ["sourceKind", "requiredCapability", "clipSourceKind"]))) {
    throw new TypeError("desktop authoring task view sources are not whitelisted");
  }
  if (view.commands.activeEffect !== null && !exactKeys(view.commands.activeEffect, ["stage", "abortable"])) {
    throw new TypeError("desktop authoring task view active effect is not whitelisted");
  }
  const encoded = JSON.stringify(view);
  if (encoded.includes("sourceRequest") || encoded.includes("contentPath")
    || encoded.includes("deviceName") || encoded.includes("stagingPath")
    || encoded.includes("absolutePath")) {
    throw new TypeError("desktop authoring task view contains adapter-private data");
  }
  if (view.attention !== null && !ATTENTION_KINDS.includes(view.attention.kind)) {
    throw new TypeError("desktop authoring task view attention is malformed");
  }
  return view;
}
