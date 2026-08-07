import {
  BARRIERS,
  ContractError,
  OUTCOMES,
  RESTART_CLASSIFICATIONS,
  capability,
  createAuditLink,
  createObservationSet,
  createReceiptIdentity,
  sha256Id,
  stableStringify,
  validateTransactionIntent,
} from "./transaction-contract.mjs";

const OUTCOME_SET = new Set(OUTCOMES);
const BARRIER_SET = new Set(BARRIERS);
const FAULTS = new Set(["PASS", "NOT_SUPPORTED", "ERROR", "UNKNOWN", "PARTIAL", "AMBIGUOUS", "TORN", "CORRUPT"]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function bytesToBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new ContractError("fixture payload must be bytes");
}

function faultValue(faults, barrier) {
  const value = faults?.[barrier] ?? "PASS";
  if (!FAULTS.has(value)) throw new ContractError(`unknown fixture fault ${barrier}:${value}`);
  return value;
}

function capabilityForFault(fault, detail) {
  if (fault === "PARTIAL" || fault === "TORN" || fault === "CORRUPT") return capability("ERROR", detail ?? fault.toLowerCase());
  if (!OUTCOME_SET.has(fault)) return capability("ERROR", "fixture fault");
  return capability(fault, detail ?? null);
}

function emptyState() {
  return {
    head: { revision: 0, digest: sha256Id(Buffer.alloc(0)), transactionId: null },
    staging: null,
    published: null,
    auditRaw: [],
    receiptsRaw: [],
    operations: [],
    quarantined: [],
    dataSynced: false,
    directorySynced: false,
    auditSynced: false,
  };
}

export class FixtureTransactionEvidenceAdapter {
  constructor({ faults = {}, lockOwnership = "NOT_SUPPORTED" } = {}) {
    this.faults = Object.freeze({ ...faults });
    this.lockOwnership = lockOwnership;
    this.state = emptyState();
  }

  setFaults(faults = {}) {
    this.faults = Object.freeze({ ...faults });
  }

  reset() {
    this.state = emptyState();
  }

  snapshot() {
    return clone(this.state);
  }

  getCurrentRevision() {
    return this.state.head.revision;
  }

  lookupOperation(operationId) {
    const entry = this.state.operations.find((candidate) => candidate.operationId === operationId);
    return entry ? clone(entry) : null;
  }

  inspectTransaction(intentInput) {
    const intent = validateTransactionIntent(intentInput);
    const operation = this.lookupOperation(intent.operationId);
    if (operation) {
      if (operation.inputFingerprint !== intent.inputFingerprint) return { kind: "CONFLICT", operation };
      return { kind: "REPLAY", operation };
    }
    if (intent.baseRevision !== this.state.head.revision) return { kind: "CONFLICT", operation: null };
    return { kind: "NEW", operation: null };
  }

  stageWrite(intentInput, bytesInput) {
    const intent = validateTransactionIntent(intentInput);
    const bytes = bytesToBuffer(bytesInput);
    const fault = faultValue(this.faults, "write");
    if (fault === "PASS") {
      this.state.staging = { transactionId: intent.transactionId, operationId: intent.operationId, bytes: bytes.toString("base64"), digest: sha256Id(bytes), length: bytes.length };
      return { outcome: "PASS", byteLength: bytes.length, sha256: sha256Id(bytes), detail: null };
    }
    if (fault === "PARTIAL") {
      const partial = bytes.subarray(0, Math.max(0, Math.floor(bytes.length / 2)));
      this.state.staging = { transactionId: intent.transactionId, operationId: intent.operationId, bytes: partial.toString("base64"), digest: sha256Id(partial), length: partial.length };
      return { outcome: "ERROR", byteLength: partial.length, sha256: sha256Id(partial), detail: "partial-write" };
    }
    const outcome = fault === "UNKNOWN" ? "UNKNOWN" : fault === "NOT_SUPPORTED" ? "NOT_SUPPORTED" : "ERROR";
    return { outcome, byteLength: 0, sha256: sha256Id(Buffer.alloc(0)), detail: `write-${fault.toLowerCase()}` };
  }

  syncData() {
    const fault = faultValue(this.faults, "data-sync");
    const result = capabilityForFault(fault, fault === "PASS" ? null : `data-sync-${fault.toLowerCase()}`);
    if (result.outcome === "PASS") this.state.dataSynced = true;
    return result;
  }

  syncDirectory() {
    const fault = faultValue(this.faults, "directory-sync");
    const result = capabilityForFault(fault, fault === "PASS" ? null : `directory-sync-${fault.toLowerCase()}`);
    if (result.outcome === "PASS") this.state.directorySynced = true;
    return result;
  }

  publish(intentInput) {
    const intent = validateTransactionIntent(intentInput);
    const fault = faultValue(this.faults, "publish");
    if (!this.state.staging || this.state.staging.transactionId !== intent.transactionId) return { outcome: "ERROR", detail: "staging-missing" };
    if (fault === "PASS" || fault === "AMBIGUOUS") {
      this.state.published = clone(this.state.staging);
      this.state.head = { revision: intent.nextRevision, digest: this.state.staging.digest, transactionId: intent.transactionId };
      this.state.staging = null;
      this.state.dataSynced = false;
      this.state.directorySynced = false;
      return capabilityForFault(fault === "AMBIGUOUS" ? "UNKNOWN" : "PASS", fault === "AMBIGUOUS" ? "publish-ambiguous" : null);
    }
    return capabilityForFault(fault, `publish-${fault.toLowerCase()}`);
  }

  appendAuditLink(linkInput) {
    const link = createAuditLink(linkInput);
    const fault = faultValue(this.faults, "audit-link");
    if (fault === "PASS") {
      this.state.auditRaw.push(clone(link));
      return capability("PASS");
    }
    if (fault === "TORN") {
      this.state.auditRaw.push({ ...clone(link), sequence: null });
      return capability("ERROR", "torn-audit-link");
    }
    return capabilityForFault(fault, `audit-link-${fault.toLowerCase()}`);
  }

  syncAudit() {
    const fault = faultValue(this.faults, "audit-sync");
    const result = capabilityForFault(fault, fault === "PASS" ? null : `audit-sync-${fault.toLowerCase()}`);
    if (result.outcome === "PASS") this.state.auditSynced = true;
    return result;
  }

  publishReceipt(receiptInput) {
    const receipt = createReceiptIdentity(receiptInput);
    const fault = faultValue(this.faults, "receipt-publish");
    if (fault === "PASS" || fault === "AMBIGUOUS") {
      this.state.receiptsRaw.push(clone(receipt));
      return capabilityForFault(fault === "AMBIGUOUS" ? "UNKNOWN" : "PASS", fault === "AMBIGUOUS" ? "receipt-ambiguous" : null);
    }
    if (fault === "TORN" || fault === "CORRUPT") {
      this.state.receiptsRaw.push({ ...clone(receipt), receiptId: null });
      return capability("ERROR", "corrupt-receipt");
    }
    return capabilityForFault(fault, `receipt-publish-${fault.toLowerCase()}`);
  }

  lockObservation() {
    if (!OUTCOME_SET.has(this.lockOwnership)) throw new ContractError("invalid lock ownership observation");
    if (this.lockOwnership === "PASS") return capability("PASS", "fixture-model-only");
    return capability(this.lockOwnership, this.lockOwnership === "NOT_SUPPORTED" ? "lock-lease-outside-v1" : "lock-state-unqualified");
  }

  findValidAudit(intent) {
    return this.state.auditRaw.find((entry) => {
      try {
        return entry.transactionId === intent.transactionId && entry.operationId === intent.operationId && entry.sequence !== null && entry.sequence !== undefined && entry.payloadDigest === this.state.published?.digest;
      } catch {
        return false;
      }
    }) ?? null;
  }

  findValidReceipt(intent) {
    return this.state.receiptsRaw.find((entry) => entry?.transactionId === intent.transactionId && typeof entry.receiptId === "string" && entry.receiptId.startsWith("receipt:sha256:")) ?? null;
  }

  quarantineCorruptResidue() {
    const corruptAudit = this.state.auditRaw.filter((entry) => !entry || entry.sequence === null || typeof entry.receiptId === "string");
    const corruptReceipts = this.state.receiptsRaw.filter((entry) => !entry || typeof entry.receiptId !== "string" || !entry.receiptId.startsWith("receipt:sha256:"));
    if (corruptAudit.length === 0 && corruptReceipts.length === 0) return false;
    this.state.quarantined.push(...corruptAudit.map((entry) => ({ kind: "audit-link", digest: sha256Id(stableStringify(entry)) })));
    this.state.quarantined.push(...corruptReceipts.map((entry) => ({ kind: "receipt", digest: sha256Id(stableStringify(entry)) })));
    this.state.auditRaw = this.state.auditRaw.filter((entry) => !corruptAudit.includes(entry));
    this.state.receiptsRaw = this.state.receiptsRaw.filter((entry) => !corruptReceipts.includes(entry));
    return true;
  }

  classifyRecovery(intentInput) {
    const intent = validateTransactionIntent(intentInput);
    const corrupt = this.state.auditRaw.some((entry) => entry?.transactionId === intent.transactionId && (entry.sequence === null || entry.sequence === undefined)) || this.state.receiptsRaw.some((entry) => entry?.transactionId === intent.transactionId && (typeof entry.receiptId !== "string" || !entry.receiptId.startsWith("receipt:sha256:")));
    if (corrupt) return { classification: "CORRUPT_QUARANTINED", residueRefs: ["corrupt-audit-or-receipt"] };
    if (this.state.head.transactionId !== intent.transactionId && !this.state.staging && !this.state.published) return { classification: "OLD_UNCHANGED", residueRefs: [] };
    if (this.state.staging?.transactionId === intent.transactionId) return { classification: "PREPARED_ONLY", residueRefs: ["staging"] };
    if (this.state.head.transactionId === intent.transactionId && !this.findValidAudit(intent)) return { classification: "COMMITTED_WITHOUT_AUDIT", residueRefs: ["published"] };
    if (this.state.head.transactionId === intent.transactionId && this.findValidAudit(intent) && !this.findValidReceipt(intent)) return { classification: "COMMITTED_WITHOUT_RECEIPT", residueRefs: ["audit-link"] };
    if (this.state.head.transactionId === intent.transactionId && this.findValidAudit(intent) && this.findValidReceipt(intent)) return { classification: "COMMITTED_RECEIPTED", residueRefs: [] };
    return { classification: "UNKNOWN_REQUIRES_REVIEW", residueRefs: ["unclassified"] };
  }

  recover(intentInput, receiptInput = null) {
    const intent = validateTransactionIntent(intentInput);
    const before = this.classifyRecovery(intent);
    if (before.classification === "CORRUPT_QUARANTINED") {
      this.quarantineCorruptResidue();
      return { ...this.classifyRecovery(intent), repaired: true };
    }
    if (before.classification === "COMMITTED_WITHOUT_RECEIPT" && receiptInput) {
      const receipt = createReceiptIdentity(receiptInput);
      this.state.receiptsRaw.push(clone(receipt));
      return { ...this.classifyRecovery(intent), repaired: true };
    }
    return { ...before, repaired: false };
  }

  recordOperation(result) {
    const existing = this.lookupOperation(result.intent.operationId);
    if (existing) return existing;
    const entry = {
      operationId: result.intent.operationId,
      transactionId: result.intent.transactionId,
      inputFingerprint: result.intent.inputFingerprint,
      replayEnvelope: clone(result.replayEnvelope),
      auditLink: clone(result.auditLink),
      receipt: clone(result.receipt),
    };
    this.state.operations.push(entry);
    return clone(entry);
  }

  publicSnapshot() {
    const snapshot = {
      schemaVersion: 1,
      profile: "fixture-transaction-evidence-adapter-v1",
      head: clone(this.state.head),
      staging: this.state.staging ? { transactionId: this.state.staging.transactionId, digest: this.state.staging.digest, length: this.state.staging.length } : null,
      auditLinkCount: this.state.auditRaw.length,
      receiptCount: this.state.receiptsRaw.length,
      quarantinedCount: this.state.quarantined.length,
      lockOwnership: this.lockObservation(),
      capabilities: Object.fromEntries(BARRIERS.map((barrier) => {
        const fault = faultValue(this.faults, barrier);
        return [barrier, fault === "PASS" ? "PASS" : fault === "UNKNOWN" ? "UNKNOWN" : fault === "NOT_SUPPORTED" ? "NOT_SUPPORTED" : "ERROR"];
      })),
    };
    return Object.freeze(clone(snapshot));
  }
}

export function createFixtureTransactionEvidenceAdapter(options = {}) {
  return new FixtureTransactionEvidenceAdapter(options);
}
