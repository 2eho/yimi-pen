import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  AuthoringTaskRecoveryError,
  assertAuthoringTaskRecoveryRecord,
  assertAuthoringTaskJournalCorruptionReceipt,
  createAuthoringTaskJournalCorruptionReceipt,
  encodeAuthoringTaskRecoveryRecord,
  updateAuthoringTaskRecoveryRecord,
} from "./authoring-task-recovery-contract.mjs";
import { canonicalize } from "../../../../scripts/snapshot-jcs.mjs";

const TASK_FILE = /^task-[a-f0-9]{64}\.json$/u;
const RECEIPT_FILE = /^[a-f0-9]{64}\.receipt\.json$/u;

function clone(value) {
  return structuredClone(value);
}

function fail(code, message, details) {
  throw new AuthoringTaskRecoveryError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function optionalLstat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function casExpectation(record) {
  return record === null ? null : {
    journalRevision: record.journalRevision,
    recordId: record.recordId,
    stateId: record.expectedStateId,
  };
}

function assertExpectation(expected) {
  assert(expected === null || (
    expected && typeof expected === "object" && !Array.isArray(expected)
      && Object.keys(expected).sort().join(",") === "journalRevision,recordId,stateId"
      && Number.isSafeInteger(expected.journalRevision) && expected.journalRevision >= 0
      && typeof expected.recordId === "string" && expected.recordId.length > 0
      && typeof expected.stateId === "string" && expected.stateId.length > 0
  ), "AUTHORING_TASK_JOURNAL_CAS_INPUT_INVALID", "journal CAS expectation is malformed");
}

async function ensureRoot(root) {
  await mkdir(root, { recursive: true });
  const info = await lstat(root);
  assert(info.isDirectory() && !info.isSymbolicLink(),
    "AUTHORING_TASK_JOURNAL_ROOT_INVALID", "journal root must be a regular directory");
  const resolved = await realpath(root);
  assert(inside(path.dirname(resolved), resolved) || resolved === path.dirname(resolved) || path.isAbsolute(resolved),
    "AUTHORING_TASK_JOURNAL_ROOT_INVALID", "journal root could not be resolved");
  return resolved;
}

async function writeAtomic(target, bytes) {
  const temporary = `${target}.next-${process.pid}-${randomUUID()}`;
  let handle = null;
  let renamed = false;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
    renamed = true;
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* preserve the original error */ }
    }
    if (!renamed) {
      try { await rm(temporary, { force: true }); } catch { /* cleanup only */ }
    }
  }
}

async function writeCorruptionReceipt(root, receipt) {
  const target = path.join(root, `${receipt.receiptId.slice(-64)}.receipt.json`);
  const bytes = Buffer.from(`${canonicalize(receipt)}\n`, "utf8");
  await writeAtomic(target, bytes);
  return receipt;
}

async function quarantineFile({ root, target, taskId, sourceBytes, code }) {
  const sourceSha256 = sha256(sourceBytes);
  const quarantineRoot = path.join(root, "quarantine");
  await mkdir(quarantineRoot, { recursive: true });
  const quarantineName = `${path.basename(target)}.${sourceSha256}.corrupt`;
  const quarantinePath = path.join(quarantineRoot, quarantineName);
  const existing = await optionalLstat(quarantinePath);
  if (!existing) {
    await rename(target, quarantinePath);
  } else {
    await rm(target, { force: true });
  }
  const receipt = createAuthoringTaskJournalCorruptionReceipt({
    taskId,
    sourceSha256,
    code,
    originalFile: path.basename(target),
    quarantineFile: path.relative(root, quarantinePath).replaceAll(path.sep, "/"),
  });
  await writeCorruptionReceipt(root, receipt);
  return receipt;
}

async function readRecordFile(root, target, {
  quarantine = true,
  maxRecordBytes = 8 * 1024 * 1024,
  taskId: requestedTaskId = null,
} = {}) {
  let sourceBytes = null;
  let taskId = requestedTaskId;
  try {
    const info = await optionalLstat(target);
    if (!info) return { status: "MISSING", record: null, corruption: null };
    assert(info.isFile() && !info.isSymbolicLink() && info.size > 0,
      "AUTHORING_TASK_JOURNAL_CORRUPT", "journal file is not a non-empty regular file");
    sourceBytes = await readFile(target);
    assert(sourceBytes.length <= maxRecordBytes,
      "AUTHORING_TASK_JOURNAL_CORRUPT", "journal file exceeds the local record limit");
    let value;
    try {
      value = JSON.parse(sourceBytes.toString("utf8"));
    } catch (error) {
      fail("AUTHORING_TASK_JOURNAL_CORRUPT", "journal file is not valid JSON", { cause: error.message });
    }
    if (typeof value?.taskId === "string") taskId = value.taskId;
    const canonical = encodeAuthoringTaskRecoveryRecord(value);
    assert(Buffer.compare(sourceBytes, canonical) === 0,
      "AUTHORING_TASK_JOURNAL_CORRUPT", "journal bytes are not canonical v1 bytes");
    const record = assertAuthoringTaskRecoveryRecord(value);
    return { status: "LOADED", record, corruption: null };
  } catch (error) {
    if (!quarantine) throw error;
    if (sourceBytes === null) {
      try { sourceBytes = await readFile(target); } catch { sourceBytes = Buffer.from("UNREADABLE_JOURNAL\n", "utf8"); }
    }
    let corruption;
    try {
      corruption = await quarantineFile({
        root,
        target,
        taskId,
        sourceBytes,
        code: error?.code ?? "AUTHORING_TASK_JOURNAL_CORRUPT",
      });
    } catch (quarantineError) {
      throw new AuthoringTaskRecoveryError("AUTHORING_TASK_JOURNAL_QUARANTINE_FAILED",
        "corrupt journal evidence could not be quarantined", {
          causeCode: quarantineError?.code ?? quarantineError?.name ?? "UNKNOWN",
          originalCode: error?.code ?? "AUTHORING_TASK_JOURNAL_CORRUPT",
        });
    }
    return { status: "CORRUPT", record: null, corruption };
  }
}

async function readCorruptionReceipts(root, taskId = null) {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && RECEIPT_FILE.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const receipts = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    try {
      const bytes = await readFile(target);
      const value = JSON.parse(bytes.toString("utf8"));
      assert(Buffer.compare(bytes, Buffer.from(`${canonicalize(value)}\n`, "utf8")) === 0,
        "AUTHORING_TASK_JOURNAL_CORRUPT", "corruption receipt is not canonical");
      const receipt = assertAuthoringTaskJournalCorruptionReceipt(value);
      if (taskId === null || receipt.taskId === taskId) receipts.push(receipt);
    } catch {
      // A receipt is evidence, not the source record. Ignore malformed evidence here;
      // the quarantined source bytes remain the authoritative preserved artifact.
    }
  }
  return receipts;
}

export function createLocalAuthoringTaskJournal({ root, maxRecordBytes = 8 * 1024 * 1024 }) {
  assert(path.isAbsolute(root ?? ""), "AUTHORING_TASK_JOURNAL_ROOT_INVALID",
    "journal root must be an absolute App-local path");
  assert(Number.isSafeInteger(maxRecordBytes) && maxRecordBytes > 0,
    "AUTHORING_TASK_JOURNAL_LIMIT_INVALID", "maxRecordBytes must be positive");
  const journalRoot = path.resolve(root);
  const lockPath = path.join(journalRoot, ".authoring-task-journal.lock");

  function taskPath(taskId) {
    const digest = sha256(Buffer.from(taskId, "utf8"));
    const target = path.join(journalRoot, `task-${digest}.json`);
    assert(inside(journalRoot, target), "AUTHORING_TASK_JOURNAL_PATH_INVALID", "task journal path escaped its root");
    return target;
  }

  async function withLock(operation) {
    await ensureRoot(journalRoot);
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new AuthoringTaskRecoveryError("AUTHORING_TASK_JOURNAL_BUSY",
          "authoring task journal is locked by another writer");
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      try { await handle.close(); } catch { /* preserve transaction result */ }
      try { await rm(lockPath, { force: true }); } catch { /* cleanup only */ }
    }
  }

  async function load(taskId) {
    assert(typeof taskId === "string" && taskId.length > 0,
      "AUTHORING_TASK_JOURNAL_ID_INVALID", "taskId is required");
    await ensureRoot(journalRoot);
    const result = await readRecordFile(journalRoot, taskPath(taskId), { maxRecordBytes, taskId });
    if (result.status !== "MISSING") return result;
    const receipts = await readCorruptionReceipts(journalRoot, taskId);
    return receipts.length > 0
      ? { status: "CORRUPT", record: null, corruption: receipts.at(-1) }
      : result;
  }

  async function list() {
    await ensureRoot(journalRoot);
    const entries = (await readdir(journalRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && TASK_FILE.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    const records = [];
    const corruptions = await readCorruptionReceipts(journalRoot);
    const seenCorruptionIds = new Set(corruptions.map((receipt) => receipt.receiptId));
    for (const entry of entries) {
      const result = await readRecordFile(journalRoot, path.join(journalRoot, entry.name), { maxRecordBytes });
      if (result.status === "LOADED") records.push(result.record);
      else if (result.status === "CORRUPT" && !seenCorruptionIds.has(result.corruption.receiptId)) {
        corruptions.push(result.corruption);
        seenCorruptionIds.add(result.corruption.receiptId);
      }
    }
    return Object.freeze({ records: Object.freeze(records), corruptions: Object.freeze(corruptions) });
  }

  async function createOrSaveCAS({ record, expected = null }) {
    const candidate = assertAuthoringTaskRecoveryRecord(record);
    assertExpectation(expected);
    return withLock(async () => {
      const target = taskPath(candidate.taskId);
      const current = await readRecordFile(journalRoot, target, { maxRecordBytes });
      if (current.status === "CORRUPT") {
        fail("AUTHORING_TASK_JOURNAL_CORRUPT", "journal write is blocked by quarantined corrupt evidence", {
          corruption: current.corruption,
        });
      }
      if (expected === null) {
        if (current.status === "LOADED") {
          if (current.record.recordId === candidate.recordId) return current.record;
          fail("AUTHORING_TASK_JOURNAL_CAS_CONFLICT",
            "journal already exists; create observed a different record", { taskId: candidate.taskId });
        }
        assert(current.status === "MISSING", "AUTHORING_TASK_JOURNAL_CAS_CONFLICT",
          "journal already exists; create requires an empty slot", { taskId: candidate.taskId });
        assert(candidate.journalRevision === 0, "AUTHORING_TASK_JOURNAL_CAS_INPUT_INVALID",
          "a new journal record must start at revision zero");
      } else {
        assert(current.status === "LOADED"
          && current.record.taskId === candidate.taskId
          && current.record.journalRevision === expected.journalRevision
          && current.record.recordId === expected.recordId
          && current.record.expectedStateId === expected.stateId,
        "AUTHORING_TASK_JOURNAL_CAS_CONFLICT", "journal writer observed a stale record", {
          taskId: candidate.taskId,
          expected,
          actual: current.status === "LOADED" ? casExpectation(current.record) : null,
        });
        assert(candidate.journalRevision === expected.journalRevision + 1,
          "AUTHORING_TASK_JOURNAL_CAS_INPUT_INVALID", "journal revision must advance by one");
      }
      const bytes = encodeAuthoringTaskRecoveryRecord(candidate);
      assert(bytes.length <= maxRecordBytes, "AUTHORING_TASK_JOURNAL_LIMIT_EXCEEDED",
        "encoded journal record exceeds the local record limit");
      await writeAtomic(target, bytes);
      return candidate;
    });
  }

  async function abandonCAS({ taskId, expected, reason = "USER_ABANDONED" }) {
    assertExpectation(expected);
    assert(typeof reason === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(reason),
      "AUTHORING_TASK_JOURNAL_ABANDON_INVALID", "abandon reason is malformed");
    return withLock(async () => {
      const target = taskPath(taskId);
      const current = await readRecordFile(journalRoot, target, { maxRecordBytes });
      if (current.status === "CORRUPT") {
        fail("AUTHORING_TASK_JOURNAL_CORRUPT", "corrupt journal cannot be tombstoned", {
          corruption: current.corruption,
        });
      }
      assert(current.status === "LOADED", "AUTHORING_TASK_JOURNAL_MISSING", "journal task is absent", { taskId });
      const actual = current.record;
      assert(expected !== null
        && actual.journalRevision === expected.journalRevision
        && actual.recordId === expected.recordId
        && actual.expectedStateId === expected.stateId,
      "AUTHORING_TASK_JOURNAL_CAS_CONFLICT", "abandon observed a stale journal record", { taskId });
      const tombstone = updateAuthoringTaskRecoveryRecord(actual, {
        lifecycle: "ABANDONED",
        decision: {
          kind: "ABANDON",
          reasonCode: reason,
          resumePhase: null,
          requiresUserAction: false,
          releaseGate: null,
        },
      });
      await writeAtomic(target, encodeAuthoringTaskRecoveryRecord(tombstone));
      return tombstone;
    });
  }

  return Object.freeze({
    profile: "local-authoring-task-journal-v1",
    root: journalRoot,
    list,
    load,
    createOrSaveCAS,
    abandonCAS,
    casExpectation,
    maxRecordBytes,
  });
}

export { casExpectation as authoringTaskJournalCASExpectation };
