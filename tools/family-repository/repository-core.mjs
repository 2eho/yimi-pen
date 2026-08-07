import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertFamilyRevisionSemantics,
  assertFamilyRevisionTransition,
} from "../../contracts/family-revision-v1.mjs";
import { isStrictRfc3339 } from "../../contracts/rfc3339.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1");
const U64_MAX = 18_446_744_073_709_551_615n;
const OPERATION_ID = /^OP-[A-Z0-9][A-Z0-9._-]{2,127}$/u;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REPOSITORY_ID = /^FAMILY-REPO-[A-Z0-9][A-Z0-9._-]{2,127}$/u;
const REPLICA_INSTANCE_ID = /^REPLICA-[A-Z0-9][A-Z0-9._-]{2,127}$/u;

export class FamilyRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FamilyRepositoryError";
    this.code = code;
  }
}

export function assertRepositoryId(repositoryId) {
  if (!REPOSITORY_ID.test(repositoryId)) fail("INVALID_REPOSITORY_ID", "repositoryId is invalid");
  return repositoryId;
}

function fail(code, message) {
  throw new FamilyRepositoryError(code, message);
}

function canonicalU64(value) {
  try {
    return typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) <= U64_MAX;
  } catch {
    return false;
  }
}

function incrementU64(value, label) {
  if (!canonicalU64(value) || BigInt(value) === U64_MAX) fail("RANGE_EXHAUSTED", `${label} exhausted u64`);
  return String(BigInt(value) + 1n);
}

function clone(value) {
  return structuredClone(value);
}

function schemaErrors(validator) {
  return (validator.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

let validatorPromise;
async function validators() {
  if (validatorPromise) return validatorPromise;
  validatorPromise = (async () => {
    const [revisionSchema, stateSchema, backupSchema] = await Promise.all([
      readFile(path.join(CONTRACT_ROOT, "family-revision.schema.json"), "utf8").then(JSON.parse),
      readFile(path.join(CONTRACT_ROOT, "repository-state.schema.json"), "utf8").then(JSON.parse),
      readFile(path.join(CONTRACT_ROOT, "repository-backup.schema.json"), "utf8").then(JSON.parse),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
    ajv.addFormat("date-time", { type: "string", validate: isStrictRfc3339 });
    ajv.addSchema(revisionSchema);
    ajv.addSchema(stateSchema);
    return {
      revision: ajv.getSchema(revisionSchema.$id),
      state: ajv.getSchema(stateSchema.$id),
      backup: ajv.compile(backupSchema),
    };
  })();
  return validatorPromise;
}

function eventId(event) {
  const { eventId: _eventId, ...identity } = event;
  return `event:sha256:${canonicalSha256(identity).sha256}`;
}

function backupId(backup) {
  const { backupId: _backupId, ...identity } = backup;
  return `backup:sha256:${canonicalSha256(identity).sha256}`;
}

function stateDigest(state) {
  return canonicalSha256(state).sha256;
}

function stateIntegrityDigest(state) {
  const { stateIntegritySha256: _stateIntegritySha256, ...identity } = state;
  return canonicalSha256(identity).sha256;
}

function sealRepositoryState(state) {
  state.stateIntegritySha256 = stateIntegrityDigest(state);
  return state;
}

function assertUnique(values, label, code = "CORRUPT") {
  if (new Set(values).size !== values.length) fail(code, `${label} must be unique`);
}

async function assertRevision(revision, code = "INVALID_REVISION") {
  const checks = await validators();
  if (!checks.revision(revision)) fail(code, `FamilyRevision schema failed: ${schemaErrors(checks.revision)}`);
  try {
    assertFamilyRevisionSemantics(revision);
  } catch (error) {
    fail(code, error.message);
  }
}

function genesisEpoch(repositoryId) {
  return `epoch:sha256:${canonicalSha256({ kind: "GENESIS", repositoryId }).sha256}`;
}

function recoveryEpoch({ repositoryId, previousEpoch, backupId: sourceBackupId, expectedCorruptFileSha256, operationId, at }) {
  return `epoch:sha256:${canonicalSha256({
    kind: "RECOVERY",
    repositoryId,
    previousEpoch,
    backupId: sourceBackupId,
    expectedCorruptFileSha256,
    operationId,
    at,
  }).sha256}`;
}

function portableRestoreEpoch({
  repositoryId,
  sourceEpoch,
  destinationGenesisEpoch,
  backupId: sourceBackupId,
  replicaInstanceId,
  operationId,
  at,
}) {
  return `epoch:sha256:${canonicalSha256({
    kind: "PORTABLE_RESTORE",
    repositoryId,
    sourceEpoch,
    destinationGenesisEpoch,
    backupId: sourceBackupId,
    replicaInstanceId,
    operationId,
    at,
  }).sha256}`;
}

export function emptyRepositoryState(repositoryId) {
  assertRepositoryId(repositoryId);
  return sealRepositoryState({
    schemaVersion: 1,
    profile: "family-repository-state-v1",
    repositoryId,
    familyLibraryId: null,
    outboxEpoch: genesisEpoch(repositoryId),
    stateIntegritySha256: "0".repeat(64),
    stateGeneration: "0",
    headRevisionId: null,
    headRevisionNumber: "0",
    nextOutboxSequence: "1",
    revisions: [],
    outbox: [],
    operations: [],
  });
}

export async function assertRepositoryState(state, code = "CORRUPT") {
  const checks = await validators();
  if (!checks.state(state)) fail(code, `repository state schema failed: ${schemaErrors(checks.state)}`);
  if (state.stateIntegritySha256 !== stateIntegrityDigest(state)) {
    fail(code, "repository state integrity identity mismatch");
  }
  for (const value of [state.stateGeneration, state.headRevisionNumber, state.nextOutboxSequence]) {
    if (!canonicalU64(value)) fail(code, "repository counter exceeds u64");
  }
  if (BigInt(state.nextOutboxSequence) === 0n) fail(code, "nextOutboxSequence must be non-zero");
  assertUnique(state.revisions.map((revision) => revision.revisionId), "revisionId", code);
  assertUnique(state.operations.map((operation) => operation.operationId), "operationId", code);
  assertUnique(state.outbox.map((event) => event.eventId), "eventId", code);
  for (const revision of state.revisions) await assertRevision(revision, code);
  const revisionById = new Map();
  let rootRevisionCount = 0;
  for (let index = 0; index < state.revisions.length; index += 1) {
    const revision = state.revisions[index];
    const parent = revision.parentRevisionId === null ? null : revisionById.get(revision.parentRevisionId);
    if (revision.parentRevisionId === null) rootRevisionCount += 1;
    if ((revision.parentRevisionId === null && revision.revisionNumber !== "1")
      || (revision.parentRevisionId !== null && !parent)
      || (parent && BigInt(revision.revisionNumber) !== BigInt(parent.revisionNumber) + 1n)) {
      fail(code, "repository revision graph is not parent-closed and topologically ordered");
    }
    if (index > 0 && revision.familyLibraryId !== state.revisions[0].familyLibraryId) {
      fail(code, "repository revision chain crosses family libraries");
    }
    try {
      assertFamilyRevisionTransition(parent ?? null, revision);
    } catch (error) {
      fail(code, error.message);
    }
    revisionById.set(revision.revisionId, revision);
  }
  if (state.revisions.length > 0 && rootRevisionCount !== 1) {
    fail(code, "repository revision graph must have exactly one root");
  }
  const expectedHead = state.headRevisionId === null ? null : revisionById.get(state.headRevisionId);
  if ((state.headRevisionId !== null && !expectedHead)
    || state.headRevisionNumber !== (expectedHead?.revisionNumber ?? "0")) {
    fail(code, "repository head differs from revision graph");
  }
  if (state.revisions.length > 0 && state.familyLibraryId !== state.revisions[0].familyLibraryId) {
    fail(code, "repository family scope differs from revision chain");
  }
  if (state.outbox.length !== state.operations.length || BigInt(state.stateGeneration) !== BigInt(state.outbox.length)) {
    fail(code, "state generation, operations and outbox must advance atomically");
  }
  if (BigInt(state.nextOutboxSequence) !== BigInt(state.outbox.length) + 1n) {
    fail(code, "nextOutboxSequence is not contiguous");
  }
  if (state.revisions.length > 0 && state.outbox.length === 0) {
    fail(code, "non-empty revision graph requires an auditable head event");
  }
  for (let index = 0; index < state.outbox.length; index += 1) {
    const event = state.outbox[index];
    if (event.sequence !== String(index + 1)
      || event.epoch !== state.outboxEpoch
      || event.eventId !== eventId(event)) {
      fail(code, "outbox sequence or event identity mismatch");
    }
    if (index > 0 && Date.parse(event.at) < Date.parse(state.outbox[index - 1].at)) {
      fail(code, "outbox timestamps must be nondecreasing within an epoch");
    }
    const expectedPreviousHead = index === 0 ? null : state.outbox[index - 1].headRevisionId;
    if (event.previousHeadRevisionId !== expectedPreviousHead
      || (event.previousHeadRevisionId !== null && !revisionById.has(event.previousHeadRevisionId))
      || (event.headRevisionId !== null && !revisionById.has(event.headRevisionId))) {
      fail(code, "outbox head transition is not connected to the revision graph");
    }
    if (event.kind === "REVISION_COMMITTED") {
      const committed = event.headRevisionId === null ? null : revisionById.get(event.headRevisionId);
      if (!committed || committed.parentRevisionId !== event.previousHeadRevisionId) {
        fail(code, "revision commit event does not describe a parent-to-child transition");
      }
    }
    if (event.kind === "RECOVERY_COMPLETED" && index !== 0) {
      fail(code, "recovery event must start a new outbox epoch");
    }
    const operation = state.operations[index];
    const expectedEventKind = {
      COMMIT: "REVISION_COMMITTED",
      RESTORE: "RESTORE_COMPLETED",
      RECOVER: "RECOVERY_COMPLETED",
    }[operation.kind];
    if (operation.operationId !== event.operationId
      || operation.outcomeEventSequence !== event.sequence
      || operation.outcomeEventEpoch !== event.epoch
      || operation.outcomeHeadRevisionId !== event.headRevisionId
      || expectedEventKind !== event.kind) {
      fail(code, "operation journal and outbox are not aligned");
    }
    const backupEvidencePaired = (event.backupId === null) === (event.backupSourceStateSha256 === null);
    if (!backupEvidencePaired) fail(code, "outbox backup evidence must be paired");
    const hasBackupEvidence = event.backupId !== null;
    if ((event.kind === "REVISION_COMMITTED" && (hasBackupEvidence || event.corruptFileSha256 !== null))
      || (event.kind === "RESTORE_COMPLETED" && (!hasBackupEvidence || event.corruptFileSha256 !== null))
      || (event.kind === "RECOVERY_COMPLETED" && (!hasBackupEvidence || event.corruptFileSha256 === null))) {
      fail(code, "outbox event evidence differs from event kind");
    }
  }
  if (state.outbox.length > 0 && state.outbox.at(-1).headRevisionId !== state.headRevisionId) {
    fail(code, "repository head differs from the latest outbox event");
  }
  return state;
}

export async function assertRepositoryBackup(backup, code = "BACKUP_INVALID") {
  const checks = await validators();
  if (!checks.backup(backup)) fail(code, `repository backup schema failed: ${schemaErrors(checks.backup)}`);
  await assertRepositoryState(backup.state, code);
  const latestRevisionAt = backup.state.revisions.reduce((latest, revision) => (
    latest === null || Date.parse(revision.createdAt) > Date.parse(latest) ? revision.createdAt : latest
  ), null);
  assertTimestampNotBefore(backup.createdAt, latestEventAt(backup.state), code, "backup timestamp precedes its state event timeline");
  assertTimestampNotBefore(backup.createdAt, latestRevisionAt, code, "backup timestamp precedes a contained revision");
  if (backup.sourceStateSha256 !== stateDigest(backup.state) || backup.backupId !== backupId(backup)) {
    fail(code, "repository backup identity mismatch");
  }
  return backup;
}

function assertCommand({ operationId, at }) {
  if (!OPERATION_ID.test(operationId)) fail("INVALID_COMMAND", "operationId is invalid");
  if (!isStrictRfc3339(at)) fail("INVALID_COMMAND", "operation timestamp is invalid");
}

function assertExpectedHead(value) {
  if (value !== null && !SHA256_ID.test(value)) fail("INVALID_COMMAND", "expectedHeadRevisionId is invalid");
}

function latestEventAt(state) {
  return state.outbox.at(-1)?.at ?? null;
}

function assertTimestampNotBefore(value, lowerBound, code, message) {
  if (lowerBound !== null && Date.parse(value) < Date.parse(lowerBound)) fail(code, message);
}

function operationFingerprint(value) {
  return canonicalSha256(value).sha256;
}

function cursor(epoch, sequence) {
  return { epoch, sequence };
}

function replayOrConflict(state, operationId, fingerprint) {
  const previous = state.operations.find((operation) => operation.operationId === operationId);
  if (!previous) return null;
  if (previous.fingerprint !== fingerprint) fail("OPERATION_CONFLICT", "operationId was reused with different input");
  return {
    status: "replayed",
    replayed: true,
    headRevisionId: state.headRevisionId,
    operationOutcomeHeadRevisionId: previous.outcomeHeadRevisionId,
    superseded: previous.outcomeHeadRevisionId !== state.headRevisionId,
    eventEpoch: previous.outcomeEventEpoch,
    eventSequence: previous.outcomeEventSequence,
    eventCursor: cursor(previous.outcomeEventEpoch, previous.outcomeEventSequence),
  };
}

function appendTransaction({
  state,
  kind,
  operationKind,
  operationId,
  at,
  previousHeadRevisionId,
  headRevisionId,
  fingerprint,
  backupId: sourceBackupId = null,
  backupSourceStateSha256 = null,
  corruptFileSha256 = null,
}) {
  const sequence = state.nextOutboxSequence;
  const event = {
    sequence,
    epoch: state.outboxEpoch,
    eventId: "event:sha256:" + "0".repeat(64),
    kind,
    operationId,
    at,
    previousHeadRevisionId,
    headRevisionId,
    backupId: sourceBackupId,
    backupSourceStateSha256,
    corruptFileSha256,
  };
  event.eventId = eventId(event);
  state.outbox.push(event);
  state.operations.push({
    operationId,
    kind: operationKind,
    fingerprint,
    outcomeHeadRevisionId: headRevisionId,
    outcomeEventEpoch: state.outboxEpoch,
    outcomeEventSequence: sequence,
  });
  state.nextOutboxSequence = incrementU64(sequence, "outbox sequence");
  state.stateGeneration = incrementU64(state.stateGeneration, "state generation");
  return sequence;
}

export async function planCommit(stateInput, command) {
  const state = clone(stateInput);
  await assertRepositoryState(state);
  assertCommand(command);
  assertExpectedHead(command.expectedHeadRevisionId);
  await assertRevision(command.revision);
  const fingerprint = operationFingerprint({
    kind: "COMMIT",
    operationId: command.operationId,
    at: command.at,
    expectedHeadRevisionId: command.expectedHeadRevisionId,
    revisionId: command.revision.revisionId,
  });
  const replay = replayOrConflict(state, command.operationId, fingerprint);
  if (replay) return { state: stateInput, result: replay, changed: false };
  if (state.headRevisionId !== command.expectedHeadRevisionId) fail("STALE_HEAD", "expected head differs from repository head");
  if (state.headRevisionId === null && state.revisions.length > 0) {
    fail("INVALID_REVISION", "repository has archived revisions but no active head; restore a head before commit");
  }
  assertTimestampNotBefore(command.at, command.revision.createdAt, "INVALID_COMMAND", "commit timestamp precedes FamilyRevision createdAt");
  assertTimestampNotBefore(command.at, latestEventAt(state), "INVALID_COMMAND", "commit timestamp precedes the current outbox timeline");
  if (state.familyLibraryId !== null && command.revision.familyLibraryId !== state.familyLibraryId) {
    fail("INVALID_REVISION", "FamilyRevision belongs to a different family library");
  }
  const expectedNumber = incrementU64(state.headRevisionNumber, "revision number");
  if (command.revision.parentRevisionId !== state.headRevisionId || command.revision.revisionNumber !== expectedNumber) {
    fail("INVALID_REVISION", "FamilyRevision parent or revisionNumber is not the next head");
  }
  try {
    const currentHead = state.headRevisionId === null
      ? null
      : state.revisions.find((revision) => revision.revisionId === state.headRevisionId);
    assertFamilyRevisionTransition(currentHead ?? null, command.revision);
  } catch (error) {
    fail("INVALID_REVISION", error.message);
  }
  if (state.revisions.some((revision) => revision.revisionId === command.revision.revisionId)) {
    fail("INVALID_REVISION", "FamilyRevision already exists under a different operation");
  }
  const previousHeadRevisionId = state.headRevisionId;
  if (state.familyLibraryId === null) state.familyLibraryId = command.revision.familyLibraryId;
  state.revisions.push(clone(command.revision));
  state.headRevisionId = command.revision.revisionId;
  state.headRevisionNumber = command.revision.revisionNumber;
  const sequence = appendTransaction({
    state,
    kind: "REVISION_COMMITTED",
    operationKind: "COMMIT",
    operationId: command.operationId,
    at: command.at,
    previousHeadRevisionId,
    headRevisionId: state.headRevisionId,
    fingerprint,
  });
  sealRepositoryState(state);
  await assertRepositoryState(state);
  return {
    state,
    changed: true,
    result: {
      status: "committed",
      replayed: false,
      headRevisionId: state.headRevisionId,
      eventEpoch: state.outboxEpoch,
      eventSequence: sequence,
      eventCursor: cursor(state.outboxEpoch, sequence),
    },
  };
}

export async function createRepositoryBackup(stateInput, { createdAt }) {
  const state = clone(stateInput);
  await assertRepositoryState(state);
  if (!isStrictRfc3339(createdAt)) fail("INVALID_COMMAND", "backup timestamp is invalid");
  assertTimestampNotBefore(createdAt, latestEventAt(state), "INVALID_COMMAND", "backup timestamp precedes the current outbox timeline");
  const backup = {
    schemaVersion: 1,
    profile: "family-repository-backup-v1",
    backupId: "backup:sha256:" + "0".repeat(64),
    createdAt,
    sourceStateSha256: stateDigest(state),
    state,
  };
  backup.backupId = backupId(backup);
  await assertRepositoryBackup(backup);
  return backup;
}

export async function planRestore(stateInput, command) {
  const state = clone(stateInput);
  await assertRepositoryState(state);
  assertCommand(command);
  assertExpectedHead(command.expectedHeadRevisionId);
  await assertRepositoryBackup(command.backup);
  if (command.backup.state.repositoryId !== state.repositoryId) {
    fail("BACKUP_SCOPE_MISMATCH", "backup belongs to a different repository");
  }
  if (state.familyLibraryId !== null
    && command.backup.state.familyLibraryId !== null
    && command.backup.state.familyLibraryId !== state.familyLibraryId) {
    fail("BACKUP_SCOPE_MISMATCH", "backup belongs to a different family library");
  }
  const currentRootId = state.revisions.find((revision) => revision.parentRevisionId === null)?.revisionId ?? null;
  const backupRootId = command.backup.state.revisions.find((revision) => revision.parentRevisionId === null)?.revisionId ?? null;
  if (currentRootId !== null && backupRootId !== null && currentRootId !== backupRootId) {
    fail("BACKUP_SCOPE_MISMATCH", "backup belongs to a divergent repository root");
  }
  const fingerprint = operationFingerprint({
    kind: "RESTORE",
    operationId: command.operationId,
    at: command.at,
    expectedHeadRevisionId: command.expectedHeadRevisionId,
    backupId: command.backup.backupId,
  });
  const replay = replayOrConflict(state, command.operationId, fingerprint);
  if (replay) return { state: stateInput, result: replay, changed: false };
  if (state.headRevisionId !== command.expectedHeadRevisionId) fail("STALE_HEAD", "expected head differs from repository head");
  assertTimestampNotBefore(command.at, command.backup.createdAt, "INVALID_COMMAND", "restore timestamp precedes backup creation");
  assertTimestampNotBefore(command.at, latestEventAt(state), "INVALID_COMMAND", "restore timestamp precedes the current outbox timeline");
  const previousHeadRevisionId = state.headRevisionId;
  const knownRevisionIds = new Set(state.revisions.map((revision) => revision.revisionId));
  for (const revision of command.backup.state.revisions) {
    if (!knownRevisionIds.has(revision.revisionId)) {
      state.revisions.push(clone(revision));
      knownRevisionIds.add(revision.revisionId);
    }
  }
  state.familyLibraryId = state.familyLibraryId ?? command.backup.state.familyLibraryId;
  state.headRevisionId = command.backup.state.headRevisionId;
  state.headRevisionNumber = command.backup.state.headRevisionNumber;
  const sequence = appendTransaction({
    state,
    kind: "RESTORE_COMPLETED",
    operationKind: "RESTORE",
    operationId: command.operationId,
    at: command.at,
    previousHeadRevisionId,
    headRevisionId: state.headRevisionId,
    fingerprint,
    backupId: command.backup.backupId,
    backupSourceStateSha256: command.backup.sourceStateSha256,
  });
  sealRepositoryState(state);
  await assertRepositoryState(state);
  return {
    state,
    changed: true,
    result: {
      status: "restored",
      replayed: false,
      headRevisionId: state.headRevisionId,
      eventEpoch: state.outboxEpoch,
      eventSequence: sequence,
      eventCursor: cursor(state.outboxEpoch, sequence),
    },
  };
}

export async function planPortableRestore(stateInput, command) {
  const current = clone(stateInput);
  await assertRepositoryState(current);
  assertCommand(command);
  assertExpectedHead(command.expectedHeadRevisionId);
  if (!REPLICA_INSTANCE_ID.test(command.replicaInstanceId)) {
    fail("INVALID_COMMAND", "portable restore replicaInstanceId is invalid");
  }
  await assertRepositoryBackup(command.backup);
  if (command.backup.state.repositoryId !== current.repositoryId) {
    fail("BACKUP_SCOPE_MISMATCH", "backup belongs to a different repository");
  }
  const fingerprint = operationFingerprint({
    kind: "PORTABLE_RESTORE",
    operationId: command.operationId,
    at: command.at,
    expectedHeadRevisionId: command.expectedHeadRevisionId,
    backupId: command.backup.backupId,
    replicaInstanceId: command.replicaInstanceId,
  });
  const replay = replayOrConflict(current, command.operationId, fingerprint);
  if (replay) return { state: stateInput, result: replay, changed: false };
  if (current.headRevisionId !== command.expectedHeadRevisionId) {
    fail("STALE_HEAD", "expected head differs from repository head");
  }
  const destinationIsEmpty = current.familyLibraryId === null
    && current.headRevisionId === null
    && current.headRevisionNumber === "0"
    && current.stateGeneration === "0"
    && current.nextOutboxSequence === "1"
    && current.revisions.length === 0
    && current.outbox.length === 0
    && current.operations.length === 0;
  if (!destinationIsEmpty || command.expectedHeadRevisionId !== null) {
    fail("PORTABLE_RESTORE_REQUIRES_EMPTY", "portable restore requires a newly initialized empty repository");
  }
  assertTimestampNotBefore(command.at, command.backup.createdAt, "INVALID_COMMAND", "portable restore timestamp precedes backup creation");

  const state = clone(command.backup.state);
  state.outboxEpoch = portableRestoreEpoch({
    repositoryId: state.repositoryId,
    sourceEpoch: command.backup.state.outboxEpoch,
    destinationGenesisEpoch: current.outboxEpoch,
    backupId: command.backup.backupId,
    replicaInstanceId: command.replicaInstanceId,
    operationId: command.operationId,
    at: command.at,
  });
  state.stateGeneration = "0";
  state.nextOutboxSequence = "1";
  state.outbox = [];
  state.operations = [];
  const sequence = appendTransaction({
    state,
    kind: "RESTORE_COMPLETED",
    operationKind: "RESTORE",
    operationId: command.operationId,
    at: command.at,
    previousHeadRevisionId: null,
    headRevisionId: state.headRevisionId,
    fingerprint,
    backupId: command.backup.backupId,
    backupSourceStateSha256: command.backup.sourceStateSha256,
  });
  sealRepositoryState(state);
  await assertRepositoryState(state);
  return {
    state,
    changed: true,
    result: {
      status: "portable-restored",
      replayed: false,
      headRevisionId: state.headRevisionId,
      eventEpoch: state.outboxEpoch,
      eventSequence: sequence,
      eventCursor: cursor(state.outboxEpoch, sequence),
    },
  };
}

function recoveryOperationFingerprint(command) {
  return operationFingerprint({
    kind: "RECOVER",
    operationId: command.operationId,
    at: command.at,
    expectedCorruptFileSha256: command.expectedCorruptFileSha256,
    backupId: command.backup.backupId,
  });
}

export async function replayRecoveryIfRecorded(stateInput, command) {
  await assertRepositoryState(stateInput);
  assertCommand(command);
  if (!SHA256.test(command.expectedCorruptFileSha256)) fail("INVALID_COMMAND", "expected corrupt file hash is invalid");
  await assertRepositoryBackup(command.backup);
  assertRepositoryId(command.repositoryId);
  if (stateInput.repositoryId !== command.repositoryId || command.backup.state.repositoryId !== command.repositoryId) {
    fail("BACKUP_SCOPE_MISMATCH", "backup or live state belongs to a different repository");
  }
  return replayOrConflict(stateInput, command.operationId, recoveryOperationFingerprint(command));
}

export async function planRecovery(command) {
  assertCommand(command);
  if (!SHA256.test(command.expectedCorruptFileSha256)) fail("INVALID_COMMAND", "expected corrupt file hash is invalid");
  await assertRepositoryBackup(command.backup);
  assertRepositoryId(command.repositoryId);
  if (command.backup.state.repositoryId !== command.repositoryId) {
    fail("BACKUP_SCOPE_MISMATCH", "backup belongs to a different repository");
  }
  assertTimestampNotBefore(command.at, command.backup.createdAt, "INVALID_COMMAND", "recovery timestamp precedes backup creation");
  const state = clone(command.backup.state);
  const fingerprint = recoveryOperationFingerprint(command);
  state.outboxEpoch = recoveryEpoch({
    repositoryId: command.repositoryId,
    previousEpoch: command.backup.state.outboxEpoch,
    backupId: command.backup.backupId,
    expectedCorruptFileSha256: command.expectedCorruptFileSha256,
    operationId: command.operationId,
    at: command.at,
  });
  state.stateGeneration = "0";
  state.nextOutboxSequence = "1";
  state.outbox = [];
  state.operations = [];
  const sequence = appendTransaction({
    state,
    kind: "RECOVERY_COMPLETED",
    operationKind: "RECOVER",
    operationId: command.operationId,
    at: command.at,
    previousHeadRevisionId: null,
    headRevisionId: state.headRevisionId,
    fingerprint,
    backupId: command.backup.backupId,
    backupSourceStateSha256: command.backup.sourceStateSha256,
    corruptFileSha256: command.expectedCorruptFileSha256,
  });
  sealRepositoryState(state);
  await assertRepositoryState(state);
  return {
    state,
    changed: true,
    result: {
      status: "recovered",
      replayed: false,
      headRevisionId: state.headRevisionId,
      eventEpoch: state.outboxEpoch,
      eventSequence: sequence,
      eventCursor: cursor(state.outboxEpoch, sequence),
    },
  };
}

export function repositoryStateSha256(state) {
  return stateDigest(state);
}

export function encodeRepositoryJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function decodeRepositoryJson(bytes, { code = "CORRUPT", label = "repository JSON" } = {}) {
  const source = Buffer.from(bytes);
  let value;
  try {
    value = JSON.parse(source.toString("utf8"));
  } catch (error) {
    fail(code, `${label} parse failed: ${error.message}`);
  }
  return value;
}

export function decodeCanonicalRepositoryJson(bytes, { code = "CORRUPT", label = "repository JSON" } = {}) {
  const source = Buffer.from(bytes);
  const value = decodeRepositoryJson(source, { code, label });
  if (!source.equals(encodeRepositoryJson(value))) fail(code, `${label} is not canonical owned JSON`);
  return value;
}
