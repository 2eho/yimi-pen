import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;
export const PROFILE = "product-transaction-v1";
export const DOMAIN_SEPARATOR = "yimi.product-transaction.intent.v1";

export const OUTCOMES = Object.freeze(["PASS", "NOT_SUPPORTED", "ERROR", "UNKNOWN"]);
export const RESTART_CLASSIFICATIONS = Object.freeze([
  "OLD_UNCHANGED",
  "PREPARED_ONLY",
  "COMMITTED_WITHOUT_AUDIT",
  "COMMITTED_WITHOUT_RECEIPT",
  "COMMITTED_RECEIPTED",
  "CONFLICT",
  "CORRUPT_QUARANTINED",
  "UNKNOWN_REQUIRES_REVIEW",
]);
export const BARRIERS = Object.freeze([
  "prepare",
  "write",
  "data-sync",
  "directory-sync",
  "publish",
  "audit-link",
  "audit-sync",
  "receipt-prepare",
  "receipt-publish",
  "recovery",
]);
export const FACT_KEYS = Object.freeze([
  "saveRecord",
  "authorityOwnership",
  "syncDownload",
  "deviceInstall",
  "offlineReady",
  "removalReset",
  "recoverySupport",
]);

const OUTCOME_SET = new Set(OUTCOMES);
const RESTART_SET = new Set(RESTART_CLASSIFICATIONS);
const BARRIER_SET = new Set(BARRIERS);
const FACT_SET = new Set(FACT_KEYS);
const SECRET_KEY = /(?:secret|token|cookie|password|passwd|credential|private|seed|recovery|authorization|header|account|username|hostname|host|handle|sourceRequest|rawRequest)/i;
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const SAFE_OPERATION = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/;

export class ContractError extends Error {
  constructor(message, code = "CONTRACT_INVALID") {
    super(message);
    this.name = "ContractError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new ContractError(message, code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object`);
  return value;
}

function sortedKeys(value) {
  return Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
}

function canonicalValue(value, path = "$", key = "") {
  if (key && SECRET_KEY.test(key)) fail(`${path} uses a secret-like field`, "PUBLIC_SECRET_FIELD");
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string") {
      if (value.includes("\u0000")) fail(`${path} contains NUL`, "PUBLIC_VALUE_INVALID");
      if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|file:\/\/)/i.test(value)) fail(`${path} contains an absolute/local path`, "PUBLIC_PATH");
      if (/^(?:https?:\/\/|data:)/i.test(value)) fail(`${path} contains a source request`, "PUBLIC_SOURCE_REQUEST");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} must be finite`, "PUBLIC_VALUE_INVALID");
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalValue(item, `${path}[${index}]`));
  if (isPlainObject(value)) {
    const result = {};
    for (const childKey of sortedKeys(value)) result[childKey] = canonicalValue(value[childKey], `${path}.${childKey}`, childKey);
    return result;
  }
  fail(`${path} has an unsupported value type`, "PUBLIC_VALUE_INVALID");
}

export function canonicalize(value) {
  return canonicalValue(value);
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array ? value : Buffer.from(String(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Id(value) {
  return `sha256:${sha256Hex(value)}`;
}

export function isSha256Id(value) {
  return typeof value === "string" && SHA256.test(value);
}

function assertClosed(value, allowed, label) {
  const actual = sortedKeys(assertPlainObject(value, label));
  const expected = [...allowed].sort((left, right) => left.localeCompare(right, "en"));
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    fail(`${label} has unknown or missing fields`, "UNKNOWN_FIELD");
  }
}

function assertOptionalClosed(value, allowed, label) {
  const actual = sortedKeys(assertPlainObject(value, label));
  const expected = [...allowed].sort((left, right) => left.localeCompare(right, "en"));
  if (actual.some((entry) => !expected.includes(entry))) fail(`${label} has unknown fields`, "UNKNOWN_FIELD");
}

function assertString(value, label, pattern = null) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  if (pattern && !pattern.test(value)) fail(`${label} has an invalid public value`);
}

function assertRevision(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) fail(`${label} must be a non-negative safe integer`);
}

function assertOutcome(value, label) {
  if (!OUTCOME_SET.has(value)) fail(`${label} must be one of PASS, NOT_SUPPORTED, ERROR, UNKNOWN`);
}

function assertDigest(value, label) {
  if (!isSha256Id(value)) fail(`${label} must be a sha256 identity`);
}

function assertSafePublicRef(value, label) {
  assertString(value, label, SAFE_ID);
  if (SECRET_KEY.test(label)) fail(`${label} is not a public reference`, "PUBLIC_SECRET_FIELD");
}

function intentIdentity(intent) {
  return {
    domain: DOMAIN_SEPARATOR,
    aggregateIdentity: intent.aggregateId,
    expectedRevision: intent.baseRevision,
    operationId: intent.operationId,
    inputFingerprint: intent.inputFingerprint,
  };
}

export function computeTransactionId({ aggregateId, baseRevision, operationId, inputFingerprint }) {
  assertSafePublicRef(aggregateId, "aggregateId");
  assertRevision(baseRevision, "baseRevision");
  assertString(operationId, "operationId", SAFE_OPERATION);
  assertDigest(inputFingerprint, "inputFingerprint");
  return `tx:sha256:${sha256Hex(stableStringify({
    domain: DOMAIN_SEPARATOR,
    aggregateIdentity: aggregateId,
    expectedRevision: baseRevision,
    operationId,
    inputFingerprint,
  }))}`;
}

export function fingerprintBytes(bytes) {
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) fail("payload must be bytes");
  return sha256Id(bytes);
}

export function createTransactionIntent(input) {
  const value = assertPlainObject(input, "TransactionIntent");
  const allowed = ["schemaVersion", "aggregateId", "baseRevision", "nextRevision", "operationId", "operationKind", "inputFingerprint", "actorRef", "subjectRef", "deviceRef", "expectedAuditCursor", "authorityRevisionRef", "transactionId"];
  assertOptionalClosed(value, allowed, "TransactionIntent");
  if (value.schemaVersion !== SCHEMA_VERSION) fail("TransactionIntent schemaVersion mismatch");
  assertSafePublicRef(value.aggregateId, "aggregateId");
  assertRevision(value.baseRevision, "baseRevision");
  assertRevision(value.nextRevision, "nextRevision");
  if (value.nextRevision <= value.baseRevision) fail("nextRevision must be greater than baseRevision");
  assertString(value.operationId, "operationId", SAFE_OPERATION);
  assertString(value.operationKind, "operationKind", SAFE_OPERATION);
  assertDigest(value.inputFingerprint, "inputFingerprint");
  for (const key of ["actorRef", "subjectRef", "deviceRef", "authorityRevisionRef"]) if (value[key] !== undefined) assertSafePublicRef(value[key], key);
  if (value.expectedAuditCursor !== undefined) assertRevision(value.expectedAuditCursor, "expectedAuditCursor");
  const transactionId = computeTransactionId(value);
  if (value.transactionId !== undefined && value.transactionId !== transactionId) fail("transactionId does not match canonical intent", "ID_MISMATCH");
  return Object.freeze(canonicalize({ ...value, transactionId }));
}

export function validateTransactionIntent(value) {
  return createTransactionIntent(value);
}

const REPLAY_OUTCOMES = new Set(["PREPARED", "COMMITTED", "ALREADY_COMMITTED", "CONFLICT", "RECOVERED", "QUARANTINED"]);

export function createReplayEnvelope(input) {
  const value = assertPlainObject(input, "ReplayEnvelope");
  assertClosed(value, ["schemaVersion", "operationId", "transactionId", "inputFingerprint", "baseRevision", "outcome", "resultDigest", "committedRevision", "auditEventId", "receiptRef", "recoveryDisposition"], "ReplayEnvelope");
  if (value.schemaVersion !== SCHEMA_VERSION) fail("ReplayEnvelope schemaVersion mismatch");
  assertString(value.operationId, "operationId", SAFE_OPERATION);
  assertString(value.transactionId, "transactionId", /^tx:sha256:[a-f0-9]{64}$/);
  assertDigest(value.inputFingerprint, "inputFingerprint");
  assertRevision(value.baseRevision, "baseRevision");
  if (!REPLAY_OUTCOMES.has(value.outcome)) fail("ReplayEnvelope outcome is invalid");
  if (value.resultDigest !== null) assertDigest(value.resultDigest, "resultDigest");
  if (value.committedRevision !== null) assertRevision(value.committedRevision, "committedRevision");
  if (value.auditEventId !== null) assertSafePublicRef(value.auditEventId, "auditEventId");
  if (value.receiptRef !== null) assertSafePublicRef(value.receiptRef, "receiptRef");
  if (value.recoveryDisposition !== null && !RESTART_SET.has(value.recoveryDisposition)) fail("ReplayEnvelope recoveryDisposition is invalid");
  return Object.freeze(canonicalize(value));
}

export function capability(outcome, detail = null) {
  assertOutcome(outcome, "capability outcome");
  if (detail !== null) assertString(detail, "capability detail", /^[A-Za-z0-9._:/ -]{1,160}$/);
  return Object.freeze({ outcome, detail });
}

function assertCapability(value, label) {
  assertClosed(value, ["outcome", "detail"], label);
  assertOutcome(value.outcome, `${label}.outcome`);
  if (value.detail !== null) assertString(value.detail, `${label}.detail`, /^[A-Za-z0-9._:/ -]{1,160}$/);
}

export function createObservationSet(input) {
  const value = assertPlainObject(input, "ObservationSet");
  assertClosed(value, ["schemaVersion", "write", "dataSync", "directorySync", "publish", "auditLink", "auditSync", "receiptPrepare", "receiptPublish", "recovery", "lockOwnership", "factSeparation"], "ObservationSet");
  if (value.schemaVersion !== SCHEMA_VERSION) fail("ObservationSet schemaVersion mismatch");
  assertClosed(value.write, ["outcome", "byteLength", "sha256"], "ObservationSet.write");
  assertOutcome(value.write.outcome, "ObservationSet.write.outcome");
  if (!Number.isInteger(value.write.byteLength) || value.write.byteLength < 0) fail("ObservationSet.write.byteLength is invalid");
  assertDigest(value.write.sha256, "ObservationSet.write.sha256");
  for (const key of ["dataSync", "directorySync", "publish", "auditLink", "auditSync", "receiptPrepare", "receiptPublish", "lockOwnership"]) assertCapability(value[key], `ObservationSet.${key}`);
  assertClosed(value.recovery, ["outcome", "classification", "residueRefs", "repeatedState"], "ObservationSet.recovery");
  assertOutcome(value.recovery.outcome, "ObservationSet.recovery.outcome");
  if (!RESTART_SET.has(value.recovery.classification)) fail("ObservationSet.recovery.classification is invalid");
  if (!Array.isArray(value.recovery.residueRefs) || value.recovery.residueRefs.some((entry) => typeof entry !== "string" || !SAFE_ID.test(entry))) fail("ObservationSet.recovery.residueRefs is invalid");
  if (typeof value.recovery.repeatedState !== "boolean") fail("ObservationSet.recovery.repeatedState is invalid");
  assertClosed(value.factSeparation, FACT_KEYS, "ObservationSet.factSeparation");
  for (const key of FACT_KEYS) assertOutcome(value.factSeparation[key], `ObservationSet.factSeparation.${key}`);
  return Object.freeze(canonicalize(value));
}

export function createAuditLink(input) {
  const value = assertPlainObject(input, "AuditLink");
  assertClosed(value, ["schemaVersion", "eventId", "transactionId", "operationId", "aggregateId", "priorCursor", "sequence", "payloadDigest", "outcome", "recoveryDisposition"], "AuditLink");
  if (value.schemaVersion !== SCHEMA_VERSION) fail("AuditLink schemaVersion mismatch");
  assertSafePublicRef(value.eventId, "eventId");
  assertString(value.transactionId, "transactionId", /^tx:sha256:[a-f0-9]{64}$/);
  assertString(value.operationId, "operationId", SAFE_OPERATION);
  assertSafePublicRef(value.aggregateId, "aggregateId");
  assertRevision(value.priorCursor, "priorCursor");
  assertRevision(value.sequence, "sequence");
  assertDigest(value.payloadDigest, "payloadDigest");
  assertString(value.outcome, "outcome", /^[A-Z_]{3,40}$/);
  if (value.recoveryDisposition !== null && !RESTART_SET.has(value.recoveryDisposition)) fail("AuditLink recoveryDisposition is invalid");
  return Object.freeze(canonicalize(value));
}

export function createReceiptIdentity(input) {
  const value = assertPlainObject(input, "ReceiptIdentity");
  assertClosed(value, ["schemaVersion", "receiptId", "transactionId", "operationId", "committedRevision", "resultDigest", "auditCursor", "capabilitySummary", "evidenceRefs"], "ReceiptIdentity");
  if (value.schemaVersion !== SCHEMA_VERSION) fail("ReceiptIdentity schemaVersion mismatch");
  assertSafePublicRef(value.receiptId, "receiptId");
  assertString(value.transactionId, "transactionId", /^tx:sha256:[a-f0-9]{64}$/);
  assertString(value.operationId, "operationId", SAFE_OPERATION);
  assertRevision(value.committedRevision, "committedRevision");
  assertDigest(value.resultDigest, "resultDigest");
  assertRevision(value.auditCursor, "auditCursor");
  assertPlainObject(value.capabilitySummary, "ReceiptIdentity.capabilitySummary");
  for (const key of Object.keys(value.capabilitySummary)) {
    if (!BARRIER_SET.has(key)) fail("ReceiptIdentity capabilitySummary has an unknown barrier", "UNKNOWN_FIELD");
    assertOutcome(value.capabilitySummary[key], `ReceiptIdentity.capabilitySummary.${key}`);
  }
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.some((entry) => typeof entry !== "string" || !SAFE_ID.test(entry))) fail("ReceiptIdentity.evidenceRefs is invalid");
  return Object.freeze(canonicalize(value));
}

export function assertPromotion(outcome, label = "barrier") {
  assertOutcome(outcome, `${label}.outcome`);
  if (outcome !== "PASS") fail(`${label} did not pass`, "PROMOTION_BLOCKED");
  return true;
}

export function assertPublicRecord(value, label = "public record") {
  try {
    const canonical = canonicalize(value);
    if (JSON.stringify(canonical) !== JSON.stringify(value)) fail(`${label} is not canonical`, "NON_CANONICAL");
    return canonical;
  } catch (error) {
    if (error instanceof ContractError) throw error;
    fail(`${label} is invalid`);
  }
}

export function publicError(error) {
  if (error instanceof ContractError) return { code: error.code, message: error.message };
  return { code: "RUNTIME_ERROR", message: "fixture operation failed" };
}
