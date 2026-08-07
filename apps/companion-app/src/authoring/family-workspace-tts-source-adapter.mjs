import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import { createFamilyWorkspaceFileSourcePort } from "./family-workspace-authoring-adapter.mjs";
import {
  SYSTEM_TTS_CANONICAL_CODEC,
  SYSTEM_TTS_CLIP_SOURCE_KIND,
  SYSTEM_TTS_SOURCE_KIND,
  SYSTEM_TTS_V1_APPROVED_FIXTURE_AUDIO_SHA256,
  SYSTEM_TTS_V1_APPROVED_FIXTURE_DESCRIPTOR,
  assertSystemTtsAuditAppendReceipt,
  assertSystemTtsAuditCancelReceipt,
  assertSystemTtsAuditOperation,
  assertSystemTtsProviderCancelReceipt,
  assertSystemTtsProviderOperation,
  assertSystemTtsProviderPort,
  assertSystemTtsProviderRunReceipt,
  assertSystemTtsRequest,
  assertSystemTtsResourcePolicy,
  createSystemTtsProviderCleanupReceipt,
  createSystemTtsSourceReceipt,
} from "./tts-source-contract.mjs";

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,95}$/u;

export class FamilyWorkspaceTtsSourceAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FamilyWorkspaceTtsSourceAdapterError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new FamilyWorkspaceTtsSourceAdapterError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function publicImportedAsset(receipt) {
  assert(receipt
    && typeof receipt.assetId === "string"
    && typeof receipt.contentPath === "string"
    && Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0
    && /^[a-f0-9]{64}$/u.test(receipt.sha256 ?? "")
    && Number.isSafeInteger(receipt.durationMs) && receipt.durationMs > 0
    && receipt.codec === SYSTEM_TTS_CANONICAL_CODEC,
  "TTS_IMPORT_RECEIPT_INVALID", "FamilyWorkspace returned a malformed canonical TTS asset receipt");
  return Object.freeze({
    assetId: receipt.assetId,
    contentPath: receipt.contentPath,
    bytes: receipt.bytes,
    sha256: receipt.sha256,
    durationMs: receipt.durationMs,
    codec: receipt.codec,
  });
}

function frozenProviderRunReceipt(receipt, expected) {
  let snapshot;
  try {
    snapshot = structuredClone(receipt);
  } catch {
    fail("TTS_PROVIDER_RECEIPT_INVALID", "system TTS provider receipt could not be snapshotted");
  }
  const { maxOutputBytes, ...identity } = expected;
  assertSystemTtsProviderRunReceipt(snapshot, identity);
  const resourceLimitExceeded = snapshot.audioBytes.byteLength > maxOutputBytes;
  const audioBytes = Buffer.from(snapshot.audioBytes);
  const privateReceipt = {
    providerRunId: snapshot.providerRunId,
    requestSha256: snapshot.requestSha256,
    audioSha256: snapshot.audioSha256,
    audioBytes,
    codecProfile: snapshot.codecProfile,
  };
  assertSystemTtsProviderRunReceipt(privateReceipt, identity);
  return Object.freeze({
    ...privateReceipt,
    cleanupReceipt: createSystemTtsProviderCleanupReceipt(privateReceipt),
    resourceLimitExceeded,
  });
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function optionalLstat(target, lstatFile = lstat, options = undefined) {
  try {
    return await lstatFile(target, options);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function adapterError(code, message, {
  stage,
  importedAssetPublished = false,
  cleanupComplete = true,
} = {}) {
  return new FamilyWorkspaceTtsSourceAdapterError(code, message, {
    stage,
    importedAssetPublished,
    cleanupComplete,
  });
}

function normalizeProviderError(error, { requestAborted = false, providerTimedOut = false } = {}) {
  const code = String(error?.code ?? error?.name ?? "");
  if (providerTimedOut || /TIMEOUT/u.test(code)) {
    return adapterError("TTS_PROVIDER_TIMEOUT", "system TTS provider exceeded its watchdog", { stage: "provider" });
  }
  if (requestAborted || /ABORT|CANCEL/u.test(code)) {
    return adapterError("TTS_REQUEST_ABORTED", "system TTS request was cancelled", { stage: "provider" });
  }
  if (/RIGHTS.*DENIED/u.test(code)) {
    return adapterError("TTS_RIGHTS_DENIED", "system TTS rights policy rejected the operation", { stage: "provider" });
  }
  if (/RIGHTS.*UNAVAILABLE/u.test(code)) {
    return adapterError("TTS_RIGHTS_UNAVAILABLE", "system TTS rights evidence is unavailable", { stage: "provider" });
  }
  if (/UNAVAILABLE|NOT_CONFIGURED|MISSING/u.test(code)) {
    return adapterError("TTS_PROVIDER_UNAVAILABLE", "system TTS provider is unavailable", { stage: "provider" });
  }
  if (/INVALID|MALFORMED|MISMATCH|DRIFT/u.test(code)) {
    return adapterError("TTS_PROVIDER_RECEIPT_INVALID", "system TTS provider violated its adapter contract", {
      stage: "provider",
    });
  }
  return adapterError("TTS_PROVIDER_FAILED", "system TTS provider failed", { stage: "provider" });
}

function normalizeImportError(error) {
  const code = String(error?.code ?? error?.name ?? "");
  if (/LIMIT|TOO_LARGE|MAX_BYTES/u.test(code)) {
    return adapterError("TTS_OUTPUT_INVALID", "system TTS output exceeds its import policy", { stage: "import" });
  }
  if (/INVALID|MALFORMED|MISMATCH|CODEC|PROFILE|PROBE/u.test(code)) {
    return adapterError("TTS_OUTPUT_MISMATCH", "system TTS output is outside the canonical audio profile", {
      stage: "import",
    });
  }
  return adapterError("TTS_IMPORT_FAILED", "canonical system TTS import failed", { stage: "import" });
}

function requestCancelled(importedAssetPublished, stage) {
  return adapterError("TTS_REQUEST_ABORTED", "system TTS request was cancelled", {
    stage,
    importedAssetPublished,
  });
}

function settlementFailed() {
  return adapterError("TTS_PROVIDER_SETTLEMENT_FAILED", "system TTS provider did not settle its supervised operation", {
    stage: "provider-settlement",
    cleanupComplete: false,
  });
}

function auditSettlementFailed() {
  return adapterError("TTS_AUDIT_SETTLEMENT_FAILED", "system TTS audit append did not settle", {
    stage: "audit-settlement",
    importedAssetPublished: true,
  });
}

function createProviderWatchdog(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let requestAborted = parentSignal?.aborted === true;
  let providerTimedOut = false;
  let resolveInterruption;
  const interruption = new Promise((resolve) => { resolveInterruption = resolve; });
  const onAbort = () => {
    if (requestAborted || providerTimedOut) return;
    requestAborted = true;
    controller.abort();
    resolveInterruption(Object.freeze({ kind: "request-aborted" }));
  };
  if (requestAborted) {
    controller.abort();
    resolveInterruption(Object.freeze({ kind: "request-aborted" }));
  } else {
    parentSignal?.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    if (requestAborted || providerTimedOut) return;
    providerTimedOut = true;
    controller.abort();
    resolveInterruption(Object.freeze({ kind: "provider-timeout" }));
  }, timeoutMs);
  return Object.freeze({
    signal: controller.signal,
    interruption,
    status: () => Object.freeze({ requestAborted, providerTimedOut }),
    close() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  });
}

function createAuditWaitScope(parentSignal, timeoutMs) {
  let requestAborted = parentSignal?.aborted === true;
  let auditTimedOut = false;
  let resolveInterruption;
  const interruption = new Promise((resolve) => { resolveInterruption = resolve; });
  const onAbort = () => {
    if (requestAborted || auditTimedOut) return;
    requestAborted = true;
    resolveInterruption(Object.freeze({ kind: "request-aborted" }));
  };
  if (requestAborted) resolveInterruption(Object.freeze({ kind: "request-aborted" }));
  else parentSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    if (requestAborted || auditTimedOut) return;
    auditTimedOut = true;
    resolveInterruption(Object.freeze({ kind: "audit-timeout" }));
  }, timeoutMs);
  return Object.freeze({
    interruption,
    status: () => Object.freeze({ requestAborted, auditTimedOut }),
    close() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  });
}

async function withDeadline(settledPromise, timeoutMs) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(Object.freeze({ kind: "deadline" })), timeoutMs);
  });
  try {
    return await Promise.race([settledPromise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Add fixture-qualified system TTS as one product-session source without
 * exposing provider, staging, vault, or audit internals to the session state.
 * Real host/cloud providers enter through a later qualification-registry
 * composition rather than trusting a self-declared evidence hash here.
 */
export function createFamilyWorkspaceSystemTtsSourcePort({
  workspace,
  providerPort,
  stagingRoot,
  resourcePolicy,
  maxImportBytes,
  auditPort,
  allowFixtureProvider = false,
  clock = Object.freeze({ now: () => new Date().toISOString() }),
  idFactory = () => `tts-job-${randomUUID()}`,
  mkdirDirectory = mkdir,
  lstatFile = lstat,
  realpathFile = realpath,
  removeFile = rm,
  writeOutputFile = writeFile,
} = {}) {
  const fileSourcePort = createFamilyWorkspaceFileSourcePort(workspace);

  const providerStart = providerPort?.start;
  const providerDiscard = providerPort?.discard;
  let providerDescriptor;
  try {
    providerDescriptor = Object.freeze(structuredClone(providerPort?.descriptor));
  } catch {
    fail("TTS_PROVIDER_DESCRIPTOR_INVALID", "system TTS provider descriptor could not be snapshotted");
  }
  const provider = Object.freeze({
    descriptor: providerDescriptor,
    start: typeof providerStart === "function" ? providerStart.bind(providerPort) : providerStart,
    discard: typeof providerDiscard === "function" ? providerDiscard.bind(providerPort) : providerDiscard,
  });
  assertSystemTtsProviderPort(provider, { allowFixture: true });
  assert(allowFixtureProvider === true
    && providerDescriptor.providerClass === "FIXTURE_LOCAL"
    && providerDescriptor.qualification === "FIXTURE"
    && providerDescriptor.providerDescriptorId
      === SYSTEM_TTS_V1_APPROVED_FIXTURE_DESCRIPTOR.providerDescriptorId,
  "TTS_PROVIDER_UNAVAILABLE", "this v1 composition accepts only the pinned deterministic fixture provider");

  let policy;
  try {
    policy = Object.freeze(structuredClone(resourcePolicy));
  } catch {
    fail("TTS_RESOURCE_POLICY_INVALID", "system TTS resource policy could not be snapshotted");
  }
  assertSystemTtsResourcePolicy(policy, { maxImportBytes });
  assert(policy.maxConcurrentJobs === 1,
    "TTS_RESOURCE_POLICY_INVALID", "this v1 composition is intentionally single-flight");
  assert(path.isAbsolute(stagingRoot ?? ""),
    "TTS_STAGING_ROOT_INVALID", "system TTS staging root must be an absolute App-owned path");

  const auditStartAppend = auditPort?.startAppend;
  assert(typeof auditStartAppend === "function",
    "TTS_AUDIT_PORT_INVALID", "system TTS source requires a supervised append-only audit port");
  const startAuditAppend = auditStartAppend.bind(auditPort);
  assert(typeof clock?.now === "function" && typeof idFactory === "function",
    "TTS_ADAPTER_INVALID", "system TTS adapter dependencies are malformed");
  const clockNow = clock.now.bind(clock);

  let activeJobs = 0;
  let providerPoisoned = false;
  let auditPoisoned = false;

  async function resolveOwnedRoot() {
    await mkdirDirectory(stagingRoot, { recursive: true });
    const info = await lstatFile(stagingRoot, { bigint: true });
    assert(info.isDirectory() && !info.isSymbolicLink(),
      "TTS_STAGING_ROOT_INVALID", "system TTS staging root must be a regular directory");
    const realPath = await realpathFile(stagingRoot);
    return Object.freeze({
      realPath,
      dev: String(info.dev),
      ino: String(info.ino),
    });
  }

  async function assertOwnedRootIdentity(rootWitness) {
    const info = await optionalLstat(stagingRoot, lstatFile, { bigint: true });
    assert(info?.isDirectory() && !info.isSymbolicLink()
      && String(info.dev) === rootWitness.dev
      && String(info.ino) === rootWitness.ino
      && await realpathFile(stagingRoot) === rootWitness.realPath,
    "TTS_STAGING_ROOT_INVALID", "system TTS staging root identity changed during the source job", {
      stage: "staging-root",
      cleanupComplete: false,
    });
  }

  async function assertCanonicalOutput({ rootWitness, outputPath, outputWitness }) {
    await assertOwnedRootIdentity(rootWitness);
    const info = await optionalLstat(outputPath, lstatFile, { bigint: true });
    assert(info?.isFile() && !info.isSymbolicLink(),
      "TTS_OUTPUT_INVALID", "system TTS provider output must be a regular file");
    assert(String(info.dev) === outputWitness.dev && String(info.ino) === outputWitness.ino,
      "TTS_OUTPUT_MISMATCH", "system TTS staging output identity changed before import");
    const realOutput = await realpathFile(outputPath);
    assert(inside(rootWitness.realPath, realOutput) && path.dirname(realOutput) === rootWitness.realPath,
      "TTS_OUTPUT_MISMATCH", "system TTS provider output escaped its App-owned staging root");
    assert(info.size >= 46n && info.size <= BigInt(policy.maxOutputBytes),
      "TTS_OUTPUT_INVALID", "system TTS provider output exceeds its byte policy");
  }

  async function writePlannedOutput({ rootWitness, outputPath, audioBytes }) {
    try {
      await assertOwnedRootIdentity(rootWitness);
    } catch {
      return Object.freeze({
        outputWitness: null,
        error: adapterError("TTS_STAGING_ROOT_INVALID", "system TTS staging root changed before write", {
          stage: "staging-write",
          cleanupComplete: false,
        }),
      });
    }
    let writeFailed = false;
    try {
      await writeOutputFile(outputPath, audioBytes, { flag: "wx" });
    } catch {
      writeFailed = true;
    }
    try {
      await assertOwnedRootIdentity(rootWitness);
      const info = await optionalLstat(outputPath, lstatFile, { bigint: true });
      if (info === null) {
        return Object.freeze({
          outputWitness: null,
          error: writeFailed
            ? adapterError("TTS_STAGING_WRITE_FAILED", "App-owned system TTS staging write failed", {
              stage: "staging-write",
            })
            : adapterError("TTS_OUTPUT_INVALID", "App-owned TTS staging output is missing", {
              stage: "staging-write",
            }),
        });
      }
      assert(info.isFile() && !info.isSymbolicLink(),
        "TTS_OUTPUT_INVALID", "App-owned TTS staging output is not a regular file", {
          stage: "staging-write",
          cleanupComplete: false,
        });
      const outputWitness = Object.freeze({ dev: String(info.dev), ino: String(info.ino) });
      return Object.freeze({
        outputWitness,
        error: writeFailed
          ? adapterError("TTS_STAGING_WRITE_FAILED", "App-owned system TTS staging write failed", {
            stage: "staging-write",
          })
          : null,
      });
    } catch (error) {
      return Object.freeze({
        outputWitness: null,
        error: error instanceof FamilyWorkspaceTtsSourceAdapterError
          ? error
          : adapterError("TTS_STAGING_WRITE_FAILED", "App-owned system TTS staging write failed", {
            stage: "staging-write",
            cleanupComplete: false,
          }),
      });
    }
  }

  async function removePlannedOutput({ rootWitness, outputPath, outputWitness }) {
    if (outputWitness === null) return;
    try {
      await assertOwnedRootIdentity(rootWitness);
      const info = await optionalLstat(outputPath, lstatFile, { bigint: true });
      assert(info?.isFile() && !info.isSymbolicLink()
        && String(info.dev) === outputWitness.dev
        && String(info.ino) === outputWitness.ino,
      "TTS_STAGING_CLEANUP_FAILED", "system TTS staging output identity changed before cleanup");
      await removeFile(outputPath, { force: true });
      await assertOwnedRootIdentity(rootWitness);
      assert(await optionalLstat(outputPath, lstatFile, { bigint: true }) === null,
        "TTS_STAGING_CLEANUP_FAILED", "system TTS staging output remains after cleanup");
    } catch {
      throw adapterError("TTS_STAGING_CLEANUP_FAILED", "system TTS staging cleanup failed", {
        stage: "cleanup",
        cleanupComplete: false,
      });
    }
  }

  async function settleInterruptedOperation({ operation, completionOutcome, reason }) {
    const cancelOutcome = Promise.resolve()
      .then(() => operation.cancelAndWait(Object.freeze({ reason })))
      .then(
        (value) => Object.freeze({ kind: "cancelled", value }),
        () => Object.freeze({ kind: "cancel-failed" }),
      );
    const settlement = Promise.all([cancelOutcome, completionOutcome])
      .then(([cancel, completion]) => Object.freeze({ kind: "settled", cancel, completion }));
    const outcome = await withDeadline(settlement, policy.timeoutMs);
    if (outcome.kind === "deadline" || outcome.cancel.kind !== "cancelled") {
      providerPoisoned = true;
      return Object.freeze({ receipt: null, error: settlementFailed() });
    }
    try {
      const cancelReceipt = structuredClone(outcome.cancel.value);
      assertSystemTtsProviderCancelReceipt(cancelReceipt, {
        providerRunId: operation.providerRunId,
      });
    } catch {
      providerPoisoned = true;
      return Object.freeze({ receipt: null, error: settlementFailed() });
    }

    let receipt = null;
    if (outcome.completion.kind === "completed") {
      try {
        receipt = frozenProviderRunReceipt(outcome.completion.value, {
          requestSha256: operation.requestSha256,
          providerRunId: operation.providerRunId,
          maxOutputBytes: policy.maxOutputBytes,
        });
      } catch {
        receipt = null;
      }
    }
    return Object.freeze({ receipt, error: null });
  }

  async function runProvider({ request, requestSha256, signal }) {
    const watchdog = createProviderWatchdog(signal, policy.timeoutMs);
    let operation;
    let completionOutcome;
    let candidate;
    let candidateCompletion = null;
    try {
      candidate = provider.start(Object.freeze({
        request: Object.freeze(structuredClone(request)),
        signal: watchdog.signal,
        timeoutMs: policy.timeoutMs,
        maxOutputBytes: policy.maxOutputBytes,
      }));
    } catch (error) {
      watchdog.close();
      return Object.freeze({ receipt: null, error: normalizeProviderError(error, watchdog.status()) });
    }
    try {
      const operationKeys = candidate && typeof candidate === "object"
        ? Object.keys(candidate).sort().join(",")
        : "";
      assert(operationKeys === "cancelAndWait,completion,providerRunId",
        "TTS_PROVIDER_OPERATION_INVALID", "system TTS provider operation has an unexpected surface");
      candidateCompletion = candidate.completion;
      const providerRunId = candidate.providerRunId;
      const cancelAndWait = candidate.cancelAndWait;
      const operationSnapshot = Object.freeze({
        providerRunId,
        completion: candidateCompletion,
        cancelAndWait: typeof cancelAndWait === "function"
          ? (...args) => cancelAndWait.call(candidate, ...args)
          : cancelAndWait,
      });
      assertSystemTtsProviderOperation(operationSnapshot);
      operation = Object.freeze({
        providerRunId: operationSnapshot.providerRunId,
        requestSha256,
        completion: operationSnapshot.completion,
        cancelAndWait: operationSnapshot.cancelAndWait,
      });
      completionOutcome = Promise.resolve(operation.completion).then(
        (value) => Object.freeze({ kind: "completed", value }),
        (error) => Object.freeze({ kind: "failed", error }),
      );
    } catch {
      Promise.resolve(candidateCompletion).catch(() => {});
      watchdog.close();
      providerPoisoned = true;
      return Object.freeze({ receipt: null, error: settlementFailed() });
    }

    const first = await Promise.race([completionOutcome, watchdog.interruption]);
    const status = watchdog.status();
    if (first.kind === "request-aborted" || first.kind === "provider-timeout"
      || status.requestAborted || status.providerTimedOut) {
      watchdog.close();
      const interrupted = await settleInterruptedOperation({
        operation,
        completionOutcome,
        reason: status.providerTimedOut ? "TIMEOUT" : "REQUEST_ABORTED",
      });
      if (interrupted.error !== null) return interrupted;
      return Object.freeze({
        receipt: interrupted.receipt,
        error: status.providerTimedOut
          ? adapterError("TTS_PROVIDER_TIMEOUT", "system TTS provider exceeded its watchdog", { stage: "provider" })
          : requestCancelled(false, "provider"),
      });
    }

    watchdog.close();
    if (first.kind === "failed") {
      return Object.freeze({ receipt: null, error: normalizeProviderError(first.error) });
    }
    try {
      return Object.freeze({
        receipt: frozenProviderRunReceipt(first.value, {
          requestSha256,
          providerRunId: operation.providerRunId,
          maxOutputBytes: policy.maxOutputBytes,
        }),
        error: null,
      });
    } catch (error) {
      return Object.freeze({
        receipt: null,
        error: error instanceof FamilyWorkspaceTtsSourceAdapterError
          ? error
          : normalizeProviderError(error),
      });
    }
  }

  async function appendAuditReceipt(receipt, signal) {
    let candidate;
    let candidateCompletion = null;
    try {
      candidate = startAuditAppend(receipt);
    } catch {
      throw adapterError("TTS_AUDIT_WRITE_FAILED", "system TTS audit append did not start", {
        stage: "audit",
        importedAssetPublished: true,
      });
    }
    let operation;
    try {
      const operationKeys = candidate && typeof candidate === "object"
        ? Object.keys(candidate).sort().join(",")
        : "";
      assert(operationKeys === "auditRunId,cancelAndWait,completion",
        "TTS_AUDIT_OPERATION_INVALID", "system TTS audit operation has an unexpected surface");
      candidateCompletion = candidate.completion;
      const auditRunId = candidate.auditRunId;
      const cancelAndWait = candidate.cancelAndWait;
      const snapshot = Object.freeze({
        auditRunId,
        completion: candidateCompletion,
        cancelAndWait: typeof cancelAndWait === "function"
          ? (...args) => cancelAndWait.call(candidate, ...args)
          : cancelAndWait,
      });
      assertSystemTtsAuditOperation(snapshot);
      operation = snapshot;
    } catch {
      Promise.resolve(candidateCompletion).catch(() => {});
      auditPoisoned = true;
      throw auditSettlementFailed();
    }

    const completionOutcome = Promise.resolve(operation.completion).then(
      (value) => Object.freeze({ kind: "appended", value }),
      () => Object.freeze({ kind: "append-failed" }),
    );
    const waitScope = createAuditWaitScope(signal, policy.timeoutMs);
    const first = await Promise.race([completionOutcome, waitScope.interruption]);
    const waitStatus = waitScope.status();
    if (first.kind === "appended" || first.kind === "append-failed") waitScope.close();
    if (first.kind === "appended") {
      try {
        const appendReceipt = structuredClone(first.value);
        assertSystemTtsAuditAppendReceipt(appendReceipt, { receiptId: receipt.receiptId });
        return;
      } catch {
        auditPoisoned = true;
        throw auditSettlementFailed();
      }
    }
    waitScope.close();

    const cancelOutcome = Promise.resolve()
      .then(() => operation.cancelAndWait(Object.freeze({
        reason: first.kind === "append-failed"
          ? "APPEND_FAILED"
          : waitStatus.requestAborted ? "REQUEST_ABORTED" : "TIMEOUT",
      })))
      .then(
        (value) => Object.freeze({ kind: "cancelled", value }),
        () => Object.freeze({ kind: "cancel-failed" }),
      );
    const settlement = Promise.all([cancelOutcome, completionOutcome])
      .then(([cancel, completion]) => Object.freeze({ kind: "settled", cancel, completion }));
    const settled = await withDeadline(settlement, policy.timeoutMs);
    if (settled.kind === "deadline" || settled.cancel.kind !== "cancelled") {
      auditPoisoned = true;
      throw auditSettlementFailed();
    }

    let cancelReceipt;
    try {
      cancelReceipt = structuredClone(settled.cancel.value);
      assertSystemTtsAuditCancelReceipt(cancelReceipt, {
        auditRunId: operation.auditRunId,
        receiptId: receipt.receiptId,
      });
    } catch {
      auditPoisoned = true;
      throw auditSettlementFailed();
    }
    if (cancelReceipt.persisted) {
      if (settled.completion.kind === "appended") {
        try {
          const appendReceipt = structuredClone(settled.completion.value);
          assertSystemTtsAuditAppendReceipt(appendReceipt, { receiptId: receipt.receiptId });
        } catch {
          auditPoisoned = true;
          throw auditSettlementFailed();
        }
      }
      return;
    }
    if (settled.completion.kind === "appended") {
      auditPoisoned = true;
      throw auditSettlementFailed();
    }
    throw adapterError("TTS_AUDIT_WRITE_FAILED", "system TTS audit append was cancelled before persistence", {
      stage: "audit",
      importedAssetPublished: true,
    });
  }

  async function discardProviderReceipt(receipt) {
    const discardOutcome = Promise.resolve()
      .then(() => provider.discard(receipt))
      .then(
        (value) => Object.freeze({ kind: "discarded", value }),
        () => Object.freeze({ kind: "discard-failed" }),
      );
    const outcome = await withDeadline(discardOutcome, policy.timeoutMs);
    let cleanupReceipt = null;
    try {
      cleanupReceipt = structuredClone(outcome.value);
    } catch {
      cleanupReceipt = null;
    }
    if (outcome.kind !== "discarded"
      || !cleanupReceipt
      || Object.keys(cleanupReceipt).sort().join(",") !== "cleanupComplete"
      || cleanupReceipt.cleanupComplete !== true) {
      providerPoisoned = true;
      throw adapterError("TTS_STAGING_CLEANUP_FAILED", "system TTS provider cleanup did not settle", {
        stage: "cleanup",
        cleanupComplete: false,
      });
    }
  }

  async function acquire({ sessionId, attemptId, assetId, request, signal } = {}) {
    assertSystemTtsRequest(request, policy);
    if (signal?.aborted) throw requestCancelled(false, "before-provider");
    assert(!providerPoisoned,
      "TTS_PROVIDER_UNAVAILABLE", "system TTS provider is quarantined after a settlement breach");
    assert(!auditPoisoned,
      "TTS_AUDIT_UNAVAILABLE", "system TTS audit port is quarantined after a settlement breach");
    assert(activeJobs < policy.maxConcurrentJobs,
      "TTS_RESOURCE_BUSY", "system TTS concurrency policy is busy");
    activeJobs += 1;

    let outputPath = null;
    let rootWitness = null;
    let outputWitness = null;
    let providerReceipt = null;
    let importedAsset = null;
    let importedAssetIdentityVerified = false;
    let primaryError = null;
    try {
      rootWitness = await resolveOwnedRoot();
      const jobId = idFactory();
      assert(typeof jobId === "string" && JOB_ID.test(jobId),
        "TTS_JOB_ID_INVALID", "system TTS job ID is malformed");
      outputPath = path.join(rootWitness.realPath, `${jobId}.wav`);
      assert(inside(rootWitness.realPath, outputPath) && path.dirname(outputPath) === rootWitness.realPath,
        "TTS_OUTPUT_MISMATCH", "system TTS staging path escaped its owned root");
      assert(await optionalLstat(outputPath, lstatFile) === null,
        "TTS_JOB_ID_CONFLICT", "system TTS staging output already exists");

      const requestSha256 = canonicalSha256(request).sha256;
      const providerResult = await runProvider({ request, requestSha256, signal });
      providerReceipt = providerResult.receipt;
      primaryError = providerResult.error;
      if (primaryError === null) {
        try {
          if (providerReceipt.resourceLimitExceeded) {
            primaryError = adapterError("TTS_OUTPUT_INVALID", "system TTS provider output exceeds its byte policy", {
              stage: "provider-output",
            });
          } else if (providerReceipt.audioSha256 !== SYSTEM_TTS_V1_APPROVED_FIXTURE_AUDIO_SHA256) {
            primaryError = adapterError("TTS_OUTPUT_MISMATCH", "system TTS fixture output changed from its approved bytes", {
              stage: "provider-output",
            });
          } else if (signal?.aborted) {
            primaryError = requestCancelled(false, "after-provider");
          } else {
            const writeOutcome = await writePlannedOutput({
              rootWitness,
              outputPath,
              audioBytes: providerReceipt.audioBytes,
            });
            outputWitness = writeOutcome.outputWitness;
            primaryError = writeOutcome.error;
            if (primaryError === null) {
              await assertCanonicalOutput({ rootWitness, outputPath, outputWitness });
            }
          }
        } catch (error) {
          primaryError = error instanceof FamilyWorkspaceTtsSourceAdapterError
            ? error
            : adapterError("TTS_STAGING_WRITE_FAILED", "App-owned system TTS staging write failed", {
              stage: "staging-write",
              cleanupComplete: false,
            });
        }
      }

      if (primaryError === null) {
        try {
          const result = await fileSourcePort.acquire({
            assetId,
            request: Object.freeze({ sourcePath: outputPath }),
            signal: undefined,
          });
          importedAsset = publicImportedAsset(result.importedAsset);
          if (importedAsset.assetId !== assetId
            || importedAsset.sha256 !== providerReceipt.audioSha256
            || importedAsset.bytes !== providerReceipt.audioBytes.byteLength) {
            primaryError = adapterError(
              "TTS_OUTPUT_MISMATCH",
              "FamilyWorkspace imported bytes that differ from the verified provider output",
              { stage: "import-identity", importedAssetPublished: true },
            );
          } else {
            importedAssetIdentityVerified = true;
            if (signal?.aborted) primaryError = requestCancelled(true, "after-import");
          }
        } catch (error) {
          primaryError = normalizeImportError(error);
        }
      }

      let cleanupFailed = false;
      try {
        if (providerReceipt !== null) {
          await discardProviderReceipt(providerReceipt.cleanupReceipt);
        }
      } catch {
        cleanupFailed = true;
      }
      try {
        await removePlannedOutput({ rootWitness, outputPath, outputWitness });
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) {
        providerPoisoned = true;
        primaryError = adapterError("TTS_STAGING_CLEANUP_FAILED", "system TTS staging cleanup failed", {
          stage: "cleanup",
          importedAssetPublished: importedAsset !== null,
          cleanupComplete: false,
        });
      }
      if (primaryError?.details?.cleanupComplete === false) providerPoisoned = true;

      if (importedAssetIdentityVerified
        && primaryError?.code !== "TTS_STAGING_CLEANUP_FAILED") {
        try {
          const receipt = createSystemTtsSourceReceipt({
            sessionId,
            attemptId,
            assetId,
            request,
            providerDescriptor,
            importedAsset,
            completedAt: clockNow(),
          });
          await appendAuditReceipt(receipt, signal);
        } catch (error) {
          primaryError = error instanceof FamilyWorkspaceTtsSourceAdapterError
            ? error
            : adapterError("TTS_AUDIT_WRITE_FAILED", "system TTS audit receipt append failed", {
              stage: "audit",
              importedAssetPublished: true,
            });
        }
        if (primaryError === null && signal?.aborted) {
          primaryError = requestCancelled(true, "after-audit");
        }
      }

      if (primaryError !== null) {
        if (importedAsset !== null && primaryError.details?.importedAssetPublished !== true) {
          primaryError = new FamilyWorkspaceTtsSourceAdapterError(
            primaryError.code,
            primaryError.message,
            { ...primaryError.details, importedAssetPublished: true },
          );
        }
        throw primaryError;
      }
      return Object.freeze({ importedAsset });
    } finally {
      activeJobs -= 1;
    }
  }

  return Object.freeze({
    sourceKind: SYSTEM_TTS_SOURCE_KIND,
    requiredCapability: providerDescriptor.requiredCapability,
    clipSourceKind: SYSTEM_TTS_CLIP_SOURCE_KIND,
    acquire,
  });
}
