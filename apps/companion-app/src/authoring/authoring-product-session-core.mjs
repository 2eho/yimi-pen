import { assertFamilyRevisionSemantics } from "../../../../contracts/family-revision-v1.mjs";
import { isStrictRfc3339 } from "../../../../contracts/rfc3339.mjs";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import {
  AUTHORING_CLIP_SOURCE_KINDS,
  isAuthoringClipMetadata,
  isAuthoringImportedAsset,
  isAuthoringSourceProducer,
} from "./authoring-contract.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const ASSET_ID = /^asset-[a-z0-9][a-z0-9._-]{2,95}$/u;
const CONTENT_REVISION = /^[a-z0-9][a-z0-9._@-]{2,95}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@_-]{1,127}$/u;
const SOURCE_KIND = /^[A-Z][A-Z0-9_]{1,47}$/u;
const CAPABILITY = /^[A-Z][A-Z0-9_]{1,47}$/u;
const REVIEW_RECEIPT_ID = /^authoring-review:sha256:[a-f0-9]{64}$/u;
const PERMISSION_RECEIPT_ID = /^authoring-permission:sha256:[a-f0-9]{64}$/u;
const RECOVERY_ID = /^authoring-task-recovery:sha256:[a-f0-9]{64}$/u;

export const AUTHORING_PRODUCT_SESSION_PHASES = Object.freeze([
  "AWAITING_SOURCE",
  "READY_TO_ACQUIRE",
  "AWAITING_PERMISSION",
  "ACQUIRING_SOURCE",
  "AWAITING_METADATA",
  "READY_TO_COMMIT",
  "PREPARING_COMMIT",
  "COMMITTING",
  "READY_TO_REVIEW",
  "REVIEWING",
  "COMPLETED",
  "FAILED",
  "REJECTED",
  "CONFLICT",
  "CANCELLED",
]);

export const AUTHORING_PRODUCT_CAPABILITY_STATUSES = Object.freeze([
  "GRANTED",
  "DENIED",
  "UNAVAILABLE",
]);

export const AUTHORING_PRODUCT_FAILURE_CATEGORIES = Object.freeze([
  "DENIED",
  "UNAVAILABLE",
  "CANCELLED",
  "CONFLICT",
  "REJECTED",
  "INTEGRITY",
  "TRANSIENT",
]);

export class AuthoringProductSessionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthoringProductSessionError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new AuthoringProductSessionError(code, message, details);
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
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...keys].sort());
}

function same(left, right) {
  return canonicalSha256(left).sha256 === canonicalSha256(right).sha256;
}

function withoutIdentity(value, key) {
  const { [key]: _identity, ...subject } = value;
  return subject;
}

function computeStateId(state) {
  return `authoring-session-state:sha256:${canonicalSha256(withoutIdentity(state, "stateId")).sha256}`;
}

export function computeAuthoringProductReviewReceiptId(receipt) {
  return `authoring-review:sha256:${canonicalSha256(withoutIdentity(receipt, "reviewReceiptId")).sha256}`;
}

export function computeAuthoringProductPermissionReceiptId(receipt) {
  return `authoring-permission:sha256:${canonicalSha256(withoutIdentity(receipt, "receiptId")).sha256}`;
}

export function createAuthoringProductPermissionReceipt(input) {
  const receipt = {
    schemaVersion: 1,
    profile: "authoring-product-permission-receipt-v1",
    receiptId: "authoring-permission:sha256:pending",
    ...clone(input),
  };
  receipt.receiptId = computeAuthoringProductPermissionReceiptId(receipt);
  assert(PERMISSION_RECEIPT_ID.test(receipt.receiptId)
    && TOKEN.test(receipt.sessionId ?? "")
    && TOKEN.test(receipt.attemptId ?? "")
    && CAPABILITY.test(receipt.capability ?? "")
    && AUTHORING_PRODUCT_CAPABILITY_STATUSES.includes(receipt.status),
  "AUTHORING_SESSION_PERMISSION_RECEIPT_INVALID", "public capability receipt is malformed");
  return deepFreeze(receipt);
}

export function createAuthoringProductReviewReceipt(input) {
  const receipt = {
    schemaVersion: 1,
    profile: "authoring-product-review-receipt-v1",
    reviewReceiptId: "authoring-review:sha256:pending",
    ...clone(input),
  };
  receipt.reviewReceiptId = computeAuthoringProductReviewReceiptId(receipt);
  assertAuthoringProductReviewReceipt(receipt, {
    reviewAttemptId: receipt.reviewAttemptId,
    sessionId: receipt.sessionId,
    familyRevisionId: receipt.familyRevisionId,
    bindingId: receipt.bindingId,
    clipId: receipt.clipId,
    assetId: receipt.assetId,
    assetSha256: receipt.assetSha256,
  });
  return deepFreeze(receipt);
}

function sealState(input) {
  const state = clone(input);
  state.stateId = "authoring-session-state:sha256:pending";
  state.stateId = computeStateId(state);
  return deepFreeze(state);
}

function assertStateIdentity(state) {
  assert(state && state.schemaVersion === 1 && state.profile === "authoring-product-session-v1"
    && AUTHORING_PRODUCT_SESSION_PHASES.includes(state.phase)
    && Number.isSafeInteger(state.sessionRevision) && state.sessionRevision >= 0
    && state.stateId === computeStateId(state),
  "AUTHORING_SESSION_STATE_INVALID", "authoring product session state is malformed or changed");
}

export function assertAuthoringProductSessionState(state) {
  assertStateIdentity(state);
  return state;
}

function assertPublicImportedAsset(importedAsset) {
  assert(exactKeys(importedAsset, [
    "assetId", "contentPath", "bytes", "sha256", "durationMs", "codec",
  ])
    && isAuthoringImportedAsset(importedAsset)
    && Number.isSafeInteger(importedAsset.durationMs) && importedAsset.durationMs > 0
    && importedAsset.codec === "WAV_PCM16_16K_MONO",
  "AUTHORING_SESSION_ASSET_RECEIPT_INVALID",
  "source port returned a malformed public canonical asset receipt");
}

function assertSelection(selection) {
  assert(exactKeys(selection, ["sourceKind", "assetId", "requiredCapability", "clipSourceKind"])
    && SOURCE_KIND.test(selection.sourceKind ?? "")
    && ASSET_ID.test(selection.assetId ?? "")
    && (selection.requiredCapability === null || CAPABILITY.test(selection.requiredCapability ?? ""))
    && AUTHORING_CLIP_SOURCE_KINDS.includes(selection.clipSourceKind),
  "AUTHORING_SESSION_SOURCE_SELECTION_INVALID", "source selection descriptor is malformed");
}

function assertPermissionReceipt(receipt, state, event) {
  assert(exactKeys(receipt, [
    "schemaVersion", "profile", "receiptId", "sessionId", "attemptId", "capability", "status",
  ])
    && receipt.schemaVersion === 1
    && receipt.profile === "authoring-product-permission-receipt-v1"
    && PERMISSION_RECEIPT_ID.test(receipt.receiptId ?? "")
    && receipt.receiptId === computeAuthoringProductPermissionReceiptId(receipt)
    && receipt.sessionId === state.sessionId
    && receipt.attemptId === event.attemptId
    && receipt.capability === state.selection.requiredCapability
    && AUTHORING_PRODUCT_CAPABILITY_STATUSES.includes(receipt.status),
  "AUTHORING_SESSION_PERMISSION_RECEIPT_INVALID", "capability resolver returned a malformed receipt");
}

function assertFailure(failure) {
  assert(exactKeys(failure, [
    "stage", "code", "category", "retryable", "resumePhase", "importedAssetPublished",
  ])
    && ["PERMISSION", "SOURCE", "COMMIT_PREPARE", "COMMIT", "REVIEW"].includes(failure.stage)
    && TOKEN.test(failure.code ?? "")
    && AUTHORING_PRODUCT_FAILURE_CATEGORIES.includes(failure.category)
    && typeof failure.retryable === "boolean"
    && AUTHORING_PRODUCT_SESSION_PHASES.includes(failure.resumePhase)
    && typeof failure.importedAssetPublished === "boolean",
  "AUTHORING_SESSION_FAILURE_INVALID", "session failure receipt is malformed");
}

function assertCommitCommand(command, state) {
  assert(exactKeys(command, [
    "operationId", "expectedHeadRevisionId", "createdAt", "committedAt", "contentRevision",
    "bindingId", "clipId", "importedAsset", "clipMetadata", "sourceProducer",
  ])
    && TOKEN.test(command.operationId ?? "")
    && command.expectedHeadRevisionId === state.target.baseRevisionId
    && isStrictRfc3339(command.createdAt)
    && isStrictRfc3339(command.committedAt)
    && CONTENT_REVISION.test(command.contentRevision ?? "")
    && command.bindingId === state.target.bindingId
    && command.clipId === state.target.clipId
    && exactKeys(command.sourceProducer, ["name", "version"])
    && isAuthoringSourceProducer(command.sourceProducer),
  "AUTHORING_SESSION_COMMIT_COMMAND_INVALID", "commit command header is malformed or crossed session identity");
  assertPublicImportedAsset(command.importedAsset);
  assert(isAuthoringClipMetadata(command.clipMetadata)
    && same(command.importedAsset, state.importedAsset)
    && same(command.clipMetadata, state.clipMetadata),
  "AUTHORING_SESSION_COMMIT_COMMAND_INVALID", "commit command changed the selected asset or metadata");
}

export function assertAuthoringProductCommitCommand(command, state) {
  assertStateIdentity(state);
  assertCommitCommand(command, state);
  return command;
}

function committedClip(revision, bindingId, clipId) {
  return revision.bindings
    ?.find((binding) => binding.bindingId === bindingId)
    ?.clips?.find((clip) => clip.clipId === clipId) ?? null;
}

function assertCommitReceipt(receipt, command) {
  assert(receipt && typeof receipt === "object" && !Array.isArray(receipt)
    && receipt.revision && receipt.commit && receipt.assetCatalogEntry,
  "AUTHORING_SESSION_COMMIT_RECEIPT_INVALID", "authoring port returned a malformed commit receipt");
  try {
    assertFamilyRevisionSemantics(receipt.revision);
  } catch (error) {
    fail("AUTHORING_SESSION_COMMIT_RECEIPT_INVALID", "committed revision violates FamilyRevision v1", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const revision = receipt.revision;
  const clip = committedClip(revision, command.bindingId, command.clipId);
  assert(revision.parentRevisionId === command.expectedHeadRevisionId
    && revision.contentRevision === command.contentRevision
    && revision.createdAt === command.createdAt
    && same(revision.sourceProducer, command.sourceProducer)
    && clip
    && clip.assetId === command.importedAsset.assetId
    && clip.assetSha256 === command.importedAsset.sha256
    && clip.assetBytes === command.importedAsset.bytes
    && clip.sourceKind === command.clipMetadata.sourceKind
    && clip.transcript === command.clipMetadata.transcript
    && clip.mediaType === command.clipMetadata.mediaType
    && clip.language === command.clipMetadata.language,
  "AUTHORING_SESSION_COMMIT_RECEIPT_INVALID", "committed revision differs from the frozen command");
  const catalog = receipt.assetCatalogEntry;
  assert(catalog.assetId === command.importedAsset.assetId
    && catalog.path === command.importedAsset.contentPath
    && catalog.bytes === command.importedAsset.bytes
    && catalog.sha256 === command.importedAsset.sha256
    && catalog.codec === command.importedAsset.codec,
  "AUTHORING_SESSION_COMMIT_RECEIPT_INVALID", "commit asset catalog receipt changed imported identity");
  const commit = receipt.commit;
  const outcomeHead = commit.operationOutcomeHeadRevisionId ?? commit.headRevisionId;
  assert(["committed", "replayed"].includes(commit.status)
    && typeof commit.replayed === "boolean"
    && SHA256_ID.test(commit.headRevisionId ?? "")
    && outcomeHead === revision.revisionId,
  "AUTHORING_SESSION_COMMIT_RECEIPT_INVALID", "repository commit outcome is malformed or unrelated");
  return Object.freeze({
    revision: clone(revision),
    summary: Object.freeze({
      revisionId: revision.revisionId,
      parentRevisionId: revision.parentRevisionId,
      familyLibraryId: revision.familyLibraryId,
      revisionNumber: revision.revisionNumber,
      contentRevision: revision.contentRevision,
    }),
    commit: Object.freeze({
      status: commit.status,
      replayed: commit.replayed,
      outcomeHeadRevisionId: outcomeHead,
    }),
  });
}

export function assertAuthoringProductReviewReceipt(receipt, expected) {
  assert(exactKeys(receipt, [
    "schemaVersion", "profile", "reviewReceiptId", "reviewAttemptId", "sessionId",
    "familyRevisionId", "bindingId", "clipId", "assetId", "assetSha256", "buildPlanId",
    "buildSubjectSha256", "previewId", "presentationTranscriptSha256", "confirmationId",
    "authorizationId", "fixtureOnly", "completedAt",
  ])
    && receipt.schemaVersion === 1
    && receipt.profile === "authoring-product-review-receipt-v1"
    && REVIEW_RECEIPT_ID.test(receipt.reviewReceiptId ?? "")
    && TOKEN.test(receipt.reviewAttemptId ?? "")
    && TOKEN.test(receipt.sessionId ?? "")
    && SHA256_ID.test(receipt.familyRevisionId ?? "")
    && TOKEN.test(receipt.bindingId ?? "")
    && TOKEN.test(receipt.clipId ?? "")
    && ASSET_ID.test(receipt.assetId ?? "")
    && SHA256.test(receipt.assetSha256 ?? "")
    && TOKEN.test(receipt.buildPlanId ?? "")
    && SHA256.test(receipt.buildSubjectSha256 ?? "")
    && SHA256_ID.test(receipt.previewId ?? "")
    && SHA256.test(receipt.presentationTranscriptSha256 ?? "")
    && TOKEN.test(receipt.confirmationId ?? "")
    && /^authorization:sha256:[a-f0-9]{64}$/u.test(receipt.authorizationId ?? "")
    && typeof receipt.fixtureOnly === "boolean"
    && isStrictRfc3339(receipt.completedAt)
    && receipt.reviewReceiptId === computeAuthoringProductReviewReceiptId(receipt),
  "AUTHORING_SESSION_REVIEW_RECEIPT_INVALID", "review port returned a malformed bound authorization receipt");
  assert(receipt.reviewAttemptId === expected.reviewAttemptId
    && receipt.sessionId === expected.sessionId
    && receipt.familyRevisionId === expected.familyRevisionId
    && receipt.bindingId === expected.bindingId
    && receipt.clipId === expected.clipId
    && receipt.assetId === expected.assetId
    && receipt.assetSha256 === expected.assetSha256,
  "AUTHORING_SESSION_REVIEW_RECEIPT_INVALID", "review receipt crossed session, revision, or asset identity");
  return receipt;
}

function assertAttempt(event, state, stage) {
  assert(state.active?.stage === stage && state.active.attemptId === event.attemptId,
    "AUTHORING_SESSION_ATTEMPT_STALE", "async completion belongs to an inactive attempt", {
      stage,
      attemptId: event.attemptId,
    });
}

function requirePhase(state, allowed, event) {
  assert(allowed.includes(state.phase), "AUTHORING_SESSION_TRANSITION_INVALID",
    `${event} is not valid from ${state.phase}`, { phase: state.phase, event });
}

export function createAuthoringProductSessionState({ sessionId, baseRevision, bindingId, clipId }) {
  assert(TOKEN.test(sessionId ?? "") && TOKEN.test(bindingId ?? "") && TOKEN.test(clipId ?? ""),
    "AUTHORING_SESSION_IDENTITY_INVALID", "session, binding, and clip identities are required");
  try {
    assertFamilyRevisionSemantics(baseRevision);
  } catch (error) {
    fail("AUTHORING_SESSION_BASE_REVISION_INVALID", "session requires one valid FamilyRevision head", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const binding = baseRevision.bindings.find((candidate) => candidate.bindingId === bindingId);
  const clip = binding?.clips.find((candidate) => candidate.clipId === clipId) ?? null;
  assert(binding && clip, "AUTHORING_SESSION_TARGET_NOT_FOUND", "selected binding and clip are absent from the head");
  return sealState({
    schemaVersion: 1,
    profile: "authoring-product-session-v1",
    stateId: "authoring-session-state:sha256:pending",
    sessionId,
    sessionRevision: 0,
    phase: "AWAITING_SOURCE",
    target: {
      familyLibraryId: baseRevision.familyLibraryId,
      baseRevisionId: baseRevision.revisionId,
      bindingId,
      clipId,
    },
    selection: null,
    permission: null,
    importedAsset: null,
    clipMetadata: null,
    commitCommand: null,
    committedRevision: null,
    commitReceipt: null,
    reviewReceipt: null,
    active: null,
    failure: null,
    facts: {
      importedAssetPublished: false,
      durableRevisionPresent: false,
      reviewReceiptPresent: false,
      buildAuthorized: false,
      offlineReady: false,
    },
    lastEventId: null,
    lastEventSha256: null,
  });
}

export function transitionAuthoringProductSession(stateInput, eventInput) {
  assertStateIdentity(stateInput);
  const state = clone(stateInput);
  const event = clone(eventInput);
  assert(event && TOKEN.test(event.eventId ?? "")
    && Number.isSafeInteger(event.expectedRevision) && event.expectedRevision >= 0
    && typeof event.type === "string",
  "AUTHORING_SESSION_EVENT_INVALID", "session event header is malformed");
  const eventSha256 = canonicalSha256(event).sha256;
  if (event.eventId === state.lastEventId) {
    assert(eventSha256 === state.lastEventSha256,
      "AUTHORING_SESSION_EVENT_ID_REUSED", "eventId was reused with different input");
    return stateInput;
  }
  assert(event.expectedRevision === state.sessionRevision,
    "AUTHORING_SESSION_REVISION_STALE", "event expected a different session revision", {
      expected: event.expectedRevision,
      actual: state.sessionRevision,
    });

  switch (event.type) {
    case "SOURCE_SELECTED": {
      requirePhase(state, ["AWAITING_SOURCE", "READY_TO_ACQUIRE"], event.type);
      assert(state.importedAsset === null && state.commitCommand === null,
        "AUTHORING_SESSION_TRANSITION_INVALID", "source identity is already durable in this session");
      assertSelection(event.selection);
      state.selection = clone(event.selection);
      state.permission = null;
      state.failure = null;
      state.phase = "READY_TO_ACQUIRE";
      break;
    }
    case "PERMISSION_STARTED": {
      requirePhase(state, ["READY_TO_ACQUIRE"], event.type);
      assert(state.selection?.requiredCapability !== null && TOKEN.test(event.attemptId ?? ""),
        "AUTHORING_SESSION_TRANSITION_INVALID", "selected source has no resolvable capability");
      state.active = { stage: "PERMISSION", attemptId: event.attemptId };
      state.phase = "AWAITING_PERMISSION";
      break;
    }
    case "PERMISSION_RESOLVED": {
      requirePhase(state, ["AWAITING_PERMISSION"], event.type);
      assertAttempt(event, state, "PERMISSION");
      assertPermissionReceipt(event.receipt, state, event);
      state.permission = clone(event.receipt);
      state.active = null;
      if (event.receipt.status === "GRANTED") {
        state.phase = "READY_TO_ACQUIRE";
      } else {
        state.failure = {
          stage: "PERMISSION",
          code: `AUTHORING_SOURCE_CAPABILITY_${event.receipt.status}`,
          category: event.receipt.status,
          retryable: true,
          resumePhase: "READY_TO_ACQUIRE",
          importedAssetPublished: false,
        };
        state.phase = "FAILED";
      }
      break;
    }
    case "SOURCE_ACQUISITION_STARTED": {
      requirePhase(state, ["READY_TO_ACQUIRE"], event.type);
      assert(TOKEN.test(event.attemptId ?? "") && state.selection,
        "AUTHORING_SESSION_TRANSITION_INVALID", "source attempt identity is malformed");
      assert(state.selection.requiredCapability === null
        || (state.permission?.status === "GRANTED"
          && state.permission.capability === state.selection.requiredCapability),
      "AUTHORING_SESSION_PERMISSION_REQUIRED", "source acquisition lacks its granted capability receipt");
      state.active = { stage: "SOURCE", attemptId: event.attemptId };
      state.phase = "ACQUIRING_SOURCE";
      break;
    }
    case "SOURCE_ACQUIRED": {
      requirePhase(state, ["ACQUIRING_SOURCE"], event.type);
      assertAttempt(event, state, "SOURCE");
      assertPublicImportedAsset(event.importedAsset);
      assert(event.importedAsset.assetId === state.selection.assetId,
        "AUTHORING_SESSION_ASSET_RECEIPT_INVALID", "source receipt changed the requested assetId");
      state.importedAsset = clone(event.importedAsset);
      state.active = null;
      state.failure = null;
      state.facts.importedAssetPublished = true;
      state.phase = "AWAITING_METADATA";
      break;
    }
    case "METADATA_SUBMITTED": {
      requirePhase(state, ["AWAITING_METADATA", "READY_TO_COMMIT"], event.type);
      assert(state.commitCommand === null && exactKeys(event.clipMetadata, [
        "sourceKind", "transcript", "mediaType", "language",
      ]) && isAuthoringClipMetadata(event.clipMetadata)
        && event.clipMetadata.sourceKind === state.selection.clipSourceKind,
      "AUTHORING_SESSION_METADATA_INVALID", "metadata is malformed or differs from the selected source kind");
      state.clipMetadata = clone(event.clipMetadata);
      state.failure = null;
      state.phase = "READY_TO_COMMIT";
      break;
    }
    case "COMMIT_PREPARATION_STARTED": {
      requirePhase(state, ["READY_TO_COMMIT"], event.type);
      assert(state.commitCommand === null, "AUTHORING_SESSION_TRANSITION_INVALID",
        "a frozen command already exists for exact replay");
      assert(TOKEN.test(event.attemptId ?? ""),
        "AUTHORING_SESSION_TRANSITION_INVALID", "commit preparation attempt identity is malformed");
      state.active = { stage: "COMMIT_PREPARE", attemptId: event.attemptId };
      state.phase = "PREPARING_COMMIT";
      break;
    }
    case "COMMIT_PREPARED": {
      requirePhase(state, ["PREPARING_COMMIT"], event.type);
      assertAttempt(event, state, "COMMIT_PREPARE");
      assertCommitCommand(event.command, state);
      state.commitCommand = clone(event.command);
      state.active = null;
      state.failure = null;
      state.phase = "READY_TO_COMMIT";
      break;
    }
    case "COMMIT_STARTED": {
      requirePhase(state, ["READY_TO_COMMIT"], event.type);
      assert(TOKEN.test(event.attemptId ?? ""),
        "AUTHORING_SESSION_TRANSITION_INVALID", "commit attempt identity is malformed");
      assertCommitCommand(event.command, state);
      if (state.commitCommand !== null) {
        assert(same(state.commitCommand, event.command),
          "AUTHORING_SESSION_REPLAY_DRIFT", "commit retry changed the frozen command");
      } else {
        state.commitCommand = clone(event.command);
      }
      state.active = { stage: "COMMIT", attemptId: event.attemptId };
      state.phase = "COMMITTING";
      break;
    }
    case "COMMIT_SUCCEEDED": {
      requirePhase(state, ["COMMITTING"], event.type);
      assertAttempt(event, state, "COMMIT");
      const committed = assertCommitReceipt(event.receipt, state.commitCommand);
      state.committedRevision = clone(committed.summary);
      state.commitReceipt = clone(committed.commit);
      state.active = null;
      state.failure = null;
      state.facts.durableRevisionPresent = true;
      state.phase = "READY_TO_REVIEW";
      break;
    }
    case "REVIEW_STARTED": {
      requirePhase(state, ["READY_TO_REVIEW"], event.type);
      assert(TOKEN.test(event.attemptId ?? ""),
        "AUTHORING_SESSION_TRANSITION_INVALID", "review attempt identity is malformed");
      state.active = { stage: "REVIEW", attemptId: event.attemptId };
      state.phase = "REVIEWING";
      break;
    }
    case "REVIEW_SUCCEEDED": {
      requirePhase(state, ["REVIEWING"], event.type);
      assertAttempt(event, state, "REVIEW");
      assertAuthoringProductReviewReceipt(event.receipt, {
        reviewAttemptId: event.attemptId,
        sessionId: state.sessionId,
        familyRevisionId: state.committedRevision.revisionId,
        bindingId: state.target.bindingId,
        clipId: state.target.clipId,
        assetId: state.importedAsset.assetId,
        assetSha256: state.importedAsset.sha256,
      });
      state.reviewReceipt = clone(event.receipt);
      state.active = null;
      state.failure = null;
      state.facts.reviewReceiptPresent = true;
      state.facts.buildAuthorized = event.receipt.fixtureOnly === false;
      state.phase = "COMPLETED";
      break;
    }
    case "RECOVERY_SOURCE_RESTARTED": {
      requirePhase(state, ["AWAITING_PERMISSION", "ACQUIRING_SOURCE"], event.type);
      assert(RECOVERY_ID.test(event.recoveryId ?? "")
        && state.active?.attemptId && state.active.stage
        && state.importedAsset === null,
      "AUTHORING_SESSION_RECOVERY_EVENT_INVALID", "source recovery event is not bound to the interrupted attempt");
      if (state.phase === "AWAITING_PERMISSION") state.permission = null;
      state.active = null;
      state.failure = null;
      state.phase = "READY_TO_ACQUIRE";
      break;
    }
    case "RECOVERY_COMMIT_PREPARATION_RESET": {
      requirePhase(state, ["PREPARING_COMMIT"], event.type);
      assert(RECOVERY_ID.test(event.recoveryId ?? "")
        && state.active?.stage === "COMMIT_PREPARE"
        && state.commitCommand === null
        && state.importedAsset !== null && state.clipMetadata !== null,
      "AUTHORING_SESSION_RECOVERY_EVENT_INVALID", "commit preparation recovery event is malformed");
      state.active = null;
      state.failure = null;
      state.phase = "READY_TO_COMMIT";
      break;
    }
    case "RECOVERY_COMMIT_RETRY_READY": {
      requirePhase(state, ["COMMITTING"], event.type);
      assert(RECOVERY_ID.test(event.recoveryId ?? "")
        && state.active?.stage === "COMMIT"
        && state.commitCommand !== null
        && state.importedAsset !== null && state.clipMetadata !== null,
      "AUTHORING_SESSION_RECOVERY_EVENT_INVALID", "commit recovery event is malformed");
      assertCommitCommand(state.commitCommand, state);
      state.active = null;
      state.failure = null;
      state.phase = "READY_TO_COMMIT";
      break;
    }
    case "RECOVERY_REVIEW_RETRY_READY": {
      requirePhase(state, ["REVIEWING"], event.type);
      assert(RECOVERY_ID.test(event.recoveryId ?? "")
        && state.active?.stage === "REVIEW"
        && state.facts.durableRevisionPresent === true
        && state.committedRevision !== null,
      "AUTHORING_SESSION_RECOVERY_EVENT_INVALID", "review recovery event is malformed");
      state.active = null;
      state.failure = null;
      state.phase = "READY_TO_REVIEW";
      break;
    }
    case "OPERATION_FAILED": {
      requirePhase(state, [
        "AWAITING_PERMISSION", "ACQUIRING_SOURCE", "PREPARING_COMMIT", "COMMITTING", "REVIEWING",
      ], event.type);
      assertFailure(event.failure);
      assertAttempt(event, state, event.failure.stage);
      state.active = null;
      state.failure = clone(event.failure);
      if (event.failure.importedAssetPublished) state.facts.importedAssetPublished = true;
      if (event.failure.category === "CONFLICT") state.phase = "CONFLICT";
      else if (event.failure.category === "REJECTED") state.phase = "REJECTED";
      else if (event.failure.category === "CANCELLED") state.phase = "CANCELLED";
      else state.phase = "FAILED";
      break;
    }
    case "RETRY_REQUESTED": {
      requirePhase(state, ["FAILED", "REJECTED"], event.type);
      assert(state.failure?.retryable === true,
        "AUTHORING_SESSION_RETRY_BLOCKED", "the recorded failure requires a fresh session");
      const resumePhase = state.failure.resumePhase;
      if (state.failure.stage === "PERMISSION") state.permission = null;
      state.failure = null;
      state.active = null;
      state.phase = resumePhase;
      break;
    }
    case "SESSION_CANCELLED": {
      requirePhase(state, [
        "AWAITING_SOURCE", "READY_TO_ACQUIRE", "AWAITING_PERMISSION", "ACQUIRING_SOURCE",
        "AWAITING_METADATA", "READY_TO_COMMIT", "PREPARING_COMMIT", "READY_TO_REVIEW", "REVIEWING",
        "FAILED", "REJECTED",
        "CONFLICT",
      ], event.type);
      assert(event.importedAssetPublished === undefined || typeof event.importedAssetPublished === "boolean",
        "AUTHORING_SESSION_EVENT_INVALID", "cancel settlement flag is malformed");
      if (event.importedAssetPublished === true) state.facts.importedAssetPublished = true;
      state.active = null;
      state.failure = null;
      state.phase = "CANCELLED";
      break;
    }
    default:
      fail("AUTHORING_SESSION_EVENT_INVALID", "unknown session event type", { type: event.type });
  }

  state.sessionRevision += 1;
  state.lastEventId = event.eventId;
  state.lastEventSha256 = eventSha256;
  return sealState(state);
}

export function extractCommittedRevisionFromReceipt(receipt, command) {
  return clone(assertCommitReceipt(receipt, command).revision);
}
