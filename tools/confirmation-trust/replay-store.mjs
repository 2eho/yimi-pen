import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ConfirmationTrustError } from "../../contracts/confirmation-trust-v1.mjs";
import { readJsonRejectingDuplicateKeys } from "../../contracts/strict-json-v1.mjs";

const LEDGER_PROFILE = "confirmation-trust-replay-ledger-v1";

function clone(value) {
  return structuredClone(value);
}

function fail(message, details = {}) {
  throw new ConfirmationTrustError("CONFIRMATION_REPLAY_CONFLICT", message, details);
}

function assertOperationId(operationId) {
  if (typeof operationId !== "string" || !/^op:[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u.test(operationId)) {
    throw new ConfirmationTrustError("CONFIRMATION_MALFORMED", "operationId is invalid");
  }
}

export function emptyReplayLedger() {
  return {
    schemaVersion: 1,
    profile: LEDGER_PROFILE,
    revision: 0,
    challenges: [],
  };
}

function challengeRecord(challenge, operationId) {
  return {
    challenge: clone(challenge),
    state: "ISSUED",
    issuedOperationId: operationId,
    consumedAt: null,
    consumedProofId: null,
    consumedBuildSubjectSha256: null,
    verificationResult: null,
    operationJournal: [],
  };
}

function applyIssue(ledger, { challenge, operationId }) {
  assertOperationId(operationId);
  const current = ledger.challenges.find((record) => record.challenge.challengeId === challenge.challengeId);
  if (current) {
    const sameChallenge = JSON.stringify(current.challenge) === JSON.stringify(challenge);
    if (sameChallenge && current.issuedOperationId === operationId) return { ledger, challenge: clone(current.challenge), changed: false };
    fail("challenge identity was already issued with different input", { challengeId: challenge.challengeId });
  }
  const next = clone(ledger);
  next.revision += 1;
  next.challenges.push(challengeRecord(challenge, operationId));
  next.challenges.sort((left, right) => left.challenge.challengeId.localeCompare(right.challenge.challengeId, "en"));
  return { ledger: next, challenge: clone(challenge), changed: true };
}

function sameConsumption(record, proofId, buildSubjectSha256) {
  return record.consumedProofId === proofId && record.consumedBuildSubjectSha256 === buildSubjectSha256;
}

function applyConsume(ledger, {
  challengeId,
  operationId,
  proofId,
  buildSubjectSha256,
  consumedAt,
  verificationResult,
}) {
  assertOperationId(operationId);
  const recordIndex = ledger.challenges.findIndex((record) => record.challenge.challengeId === challengeId);
  if (recordIndex < 0) fail("challenge is unknown", { challengeId });
  const current = ledger.challenges[recordIndex];
  const priorOperation = current.operationJournal.find((entry) => entry.operationId === operationId);
  if (priorOperation) {
    if (priorOperation.proofId === proofId && priorOperation.buildSubjectSha256 === buildSubjectSha256) {
      return { ledger, result: clone(current.verificationResult), changed: false, idempotent: true };
    }
    fail("operationId was already used for different proof input", { challengeId, operationId });
  }
  if (current.state === "CONSUMED") {
    if (sameConsumption(current, proofId, buildSubjectSha256)) {
      return { ledger, result: clone(current.verificationResult), changed: false, idempotent: true };
    }
    fail("challenge was already consumed by different proof input", { challengeId });
  }
  if (current.state !== "ISSUED") fail("challenge is not consumable", { challengeId, state: current.state });
  if (current.challenge.buildSubjectSha256 !== buildSubjectSha256) {
    fail("challenge cannot be consumed for a different BuildPlan subject", { challengeId });
  }
  if (verificationResult?.proofId !== proofId
    || verificationResult?.challengeId !== challengeId
    || verificationResult?.binding?.buildSubjectSha256 !== buildSubjectSha256) {
    fail("verification result is not bound to the consume request", { challengeId });
  }

  const next = clone(ledger);
  const record = next.challenges[recordIndex];
  record.state = "CONSUMED";
  record.consumedAt = consumedAt;
  record.consumedProofId = proofId;
  record.consumedBuildSubjectSha256 = buildSubjectSha256;
  record.verificationResult = clone(verificationResult);
  record.operationJournal.push({
    operationId,
    proofId,
    buildSubjectSha256,
    verificationId: verificationResult.verificationId,
    completedAt: consumedAt,
  });
  next.revision += 1;
  return { ledger: next, result: clone(verificationResult), changed: true, idempotent: false };
}

class SerializedStore {
  #tail = Promise.resolve();

  serialized(action) {
    const current = this.#tail.then(action, action);
    this.#tail = current.then(() => undefined, () => undefined);
    return current;
  }
}

export class MemoryChallengeStore extends SerializedStore {
  #ledger;

  constructor(initialLedger = emptyReplayLedger()) {
    super();
    this.#ledger = clone(initialLedger);
  }

  async issue(input) {
    return this.serialized(() => {
      const outcome = applyIssue(this.#ledger, input);
      if (outcome.changed) this.#ledger = outcome.ledger;
      return outcome.challenge;
    });
  }

  async get(challengeId) {
    return this.serialized(() => {
      const record = this.#ledger.challenges.find((entry) => entry.challenge.challengeId === challengeId);
      return record ? clone(record) : null;
    });
  }

  async consume(input) {
    return this.serialized(() => {
      const outcome = applyConsume(this.#ledger, input);
      if (outcome.changed) this.#ledger = outcome.ledger;
      return outcome.result;
    });
  }

  async snapshot() {
    return this.serialized(() => clone(this.#ledger));
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class AtomicJsonChallengeStore {
  constructor(filePath, { lockTimeoutMs = 5000 } = {}) {
    if (typeof filePath !== "string" || filePath.length === 0) throw new TypeError("replay ledger path is required");
    this.filePath = path.resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
    this.lockTimeoutMs = lockTimeoutMs;
  }

  async #readLedger() {
    try {
      return await readJsonRejectingDuplicateKeys(this.filePath, "confirmation replay ledger");
    } catch (error) {
      if (error?.code === "ENOENT") return emptyReplayLedger();
      throw error;
    }
  }

  async #withLock(action) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    let handle;
    while (!handle) {
      try {
        handle = await open(this.lockPath, "wx");
        await handle.writeFile(`${process.pid}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        if (error?.code !== "EEXIST" || Date.now() >= deadline) {
          if (error?.code === "EEXIST") {
            throw new ConfirmationTrustError("CONFIRMATION_STORE_BUSY", "replay ledger is locked by another transaction");
          }
          throw error;
        }
        await sleep(10);
      }
    }
    try {
      return await action();
    } finally {
      try { await handle.close(); } catch { /* preserve transaction outcome */ }
      try { await rm(this.lockPath, { force: true }); } catch { /* preserve transaction outcome */ }
    }
  }

  async #writeLedger(ledger) {
    const temporary = `${this.filePath}.next-${process.pid}-${randomUUID()}`;
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.filePath);
    } catch (error) {
      try { await rm(temporary, { force: true }); } catch { /* preserve rename error */ }
      throw error;
    }
  }

  async issue(input) {
    return this.#withLock(async () => {
      const ledger = await this.#readLedger();
      const outcome = applyIssue(ledger, input);
      if (outcome.changed) await this.#writeLedger(outcome.ledger);
      return outcome.challenge;
    });
  }

  async get(challengeId) {
    const ledger = await this.#readLedger();
    const record = ledger.challenges.find((entry) => entry.challenge.challengeId === challengeId);
    return record ? clone(record) : null;
  }

  async consume(input) {
    return this.#withLock(async () => {
      const ledger = await this.#readLedger();
      const outcome = applyConsume(ledger, input);
      if (outcome.changed) await this.#writeLedger(outcome.ledger);
      return outcome.result;
    });
  }

  async snapshot() {
    return clone(await this.#readLedger());
  }
}
