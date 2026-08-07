import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";
import { AtomicJsonFamilyRepository } from "./atomic-json-adapter.mjs";
import { computeFamilyRevisionId } from "../../contracts/family-revision-v1.mjs";
import { MemoryFamilyRepository } from "./memory-adapter.mjs";
import { assertRepositoryBackup, assertRepositoryState, encodeRepositoryJson } from "./repository-core.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "family-repository-validation");
const RUNNER_LOCK = path.join(BUILD_ROOT, ".family-repository-validation.lock");
const MARKER = path.join(RUN_ROOT, ".family-repository-validation-root");
const MARKER_TEXT = "yimi-family-repository-validation-root-v1\n";
const REPORT_PATH = path.join(RUN_ROOT, "report.json");
const REPOSITORY_ID = "FAMILY-REPO-GOLDEN-001";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function clone(value) {
  return structuredClone(value);
}

function resealState(state) {
  const { stateIntegritySha256: _stateIntegritySha256, ...identity } = state;
  state.stateIntegritySha256 = canonicalSha256(identity).sha256;
  return state;
}

function resealBackup(backup) {
  const { backupId: _backupId, ...identity } = backup;
  backup.backupId = `backup:sha256:${canonicalSha256(identity).sha256}`;
  return backup;
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

async function acquireRunnerLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  const buildInfo = await lstat(BUILD_ROOT);
  if (!buildInfo.isDirectory() || buildInfo.isSymbolicLink()) throw new Error("build/ must be a regular directory");
  const [realRepository, realBuild] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(realRepository, realBuild)) throw new Error("build/ resolved outside repository");
  try {
    return await open(RUNNER_LOCK, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("family repository validation is already running or left a stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await optionalLstat(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("validation root must be an owned regular directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("validation root resolved outside build/");
    let markerText = null;
    try { markerText = await readFile(MARKER, "utf8"); } catch { /* exact ownership check below */ }
    if (markerText !== MARKER_TEXT) throw new Error("validation root lacks exact ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER, MARKER_TEXT, { encoding: "utf8", flag: "wx" });
}

async function loadContract() {
  const [schema, transcript] = await Promise.all([
    readFile(path.join(CONTRACT_ROOT, "repository-conformance.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(CONTRACT_ROOT, "repository-conformance.json"), "utf8").then(JSON.parse),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validate = ajv.compile(schema);
  if (!validate(transcript)) {
    const errors = (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`repository conformance transcript schema failed: ${errors}`);
  }
  const revisions = {};
  for (const [key, relative] of Object.entries(transcript.revisions)) {
    const candidate = path.resolve(CONTRACT_ROOT, relative);
    if (!inside(CONTRACT_ROOT, candidate)) throw new Error(`revision fixture escaped contract root: ${relative}`);
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`revision fixture must be a regular file: ${relative}`);
    const [realContract, realCandidate] = await Promise.all([realpath(CONTRACT_ROOT), realpath(candidate)]);
    if (!inside(realContract, realCandidate)) throw new Error(`revision fixture resolved outside contract root: ${relative}`);
    revisions[key] = JSON.parse(await readFile(realCandidate, "utf8"));
  }
  return { transcript, revisions };
}

function revisionKeyFor(revisions, revisionId) {
  if (revisionId === null) return null;
  return Object.entries(revisions).find(([, revision]) => revision.revisionId === revisionId)?.[0] ?? revisionId;
}

function revisionIdFor(revisions, key) {
  if (key === null) return null;
  const revision = revisions[key];
  if (!revision) throw new Error(`unknown symbolic revision ${key}`);
  return revision.revisionId;
}

function pickExpected(actual, expected) {
  return Object.fromEntries(Object.keys(expected).map((key) => [key, actual[key]]));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function runTranscript({ name, createRepository, transcript, revisions }) {
  let repository = await createRepository();
  const backups = new Map();
  const results = [];
  for (const step of transcript.steps) {
    const beforeStateSha256 = await repository.stateSha256();
    const actual = {};
    let operationResult = null;
    try {
      switch (step.op) {
        case "open": {
          const result = await repository.open();
          actual.status = result.status;
          break;
        }
        case "commit": {
          const result = await repository.commit({
            operationId: step.args.operationId,
            revision: clone(revisions[step.args.revision]),
            expectedHeadRevisionId: revisionIdFor(revisions, step.args.expectedHeadRevision),
            at: step.args.at,
          });
          operationResult = result;
          actual.status = result.status;
          if (result.operationOutcomeHeadRevisionId !== undefined) {
            actual.operationOutcomeHeadRevision = revisionKeyFor(revisions, result.operationOutcomeHeadRevisionId);
          }
          if (result.superseded !== undefined) actual.superseded = result.superseded;
          break;
        }
        case "backup": {
          const bytes = await repository.createBackup({ createdAt: step.args.createdAt });
          backups.set(step.args.backup, Buffer.from(bytes));
          actual.status = "backed-up";
          break;
        }
        case "restore": {
          const backupBytes = backups.get(step.args.backup);
          if (!backupBytes) throw new Error(`unknown symbolic backup ${step.args.backup}`);
          const result = await repository.restore({
            operationId: step.args.operationId,
            backupBytes,
            expectedHeadRevisionId: revisionIdFor(revisions, step.args.expectedHeadRevision),
            at: step.args.at,
          });
          operationResult = result;
          actual.status = result.status;
          if (result.operationOutcomeHeadRevisionId !== undefined) {
            actual.operationOutcomeHeadRevision = revisionKeyFor(revisions, result.operationOutcomeHeadRevisionId);
          }
          if (result.superseded !== undefined) actual.superseded = result.superseded;
          break;
        }
        case "load-revision": {
          const revision = await repository.loadRevision(revisionIdFor(revisions, step.args.revision));
          actual.found = revision !== null;
          break;
        }
        case "read-outbox": {
          actual.outboxCount = (await repository.readOutbox()).events.length;
          break;
        }
        case "reopen": {
          repository = await repository.reopen();
          actual.status = (await repository.open()).status;
          break;
        }
        default:
          throw new Error(`unsupported transcript operation ${step.op}`);
      }
    } catch (error) {
      actual.error = error?.code ?? error?.name ?? "ERROR";
    }
    const afterStateSha256 = await repository.stateSha256();
    const openResult = await repository.open();
    actual.headRevision = revisionKeyFor(revisions, openResult.headRevisionId);
    actual.zeroSideEffect = beforeStateSha256 === afterStateSha256;
    const expectsCursor = ["committed", "restored", "replayed"].includes(actual.status);
    const eventCursorValid = !expectsCursor || Boolean(
      operationResult?.eventCursor
      && operationResult.eventCursor.epoch === operationResult.eventEpoch
      && operationResult.eventCursor.sequence === operationResult.eventSequence,
    );
    const expected = clone(step.expected);
    const observed = pickExpected(actual, expected);
    const passed = sameJson(observed, expected);
    results.push({
      id: step.id,
      op: step.op,
      passed,
      expected,
      observed,
      beforeStateSha256,
      afterStateSha256,
      eventCursor: operationResult?.eventCursor ?? null,
      eventCursorValid,
    });
  }
  return {
    name,
    repository,
    backups,
    results,
    passed: results.filter((result) => result.passed).length,
    total: results.length,
  };
}

async function makeAtomicRoot(name, { initialize = true, repositoryId = REPOSITORY_ID } = {}) {
  const repositoryRoot = path.join(RUN_ROOT, name);
  await mkdir(repositoryRoot, { recursive: false });
  const repository = new AtomicJsonFamilyRepository({ repositoryId, repositoryRoot, allowedRoot: RUN_ROOT });
  if (initialize) await repository.initialize();
  return {
    repositoryRoot,
    repository,
  };
}

async function rawStateSha256(repositoryRoot) {
  return sha256(await readFile(path.join(repositoryRoot, "state.json")));
}

async function residue(repositoryRoot) {
  const entries = await readdir(repositoryRoot);
  return entries.filter((entry) => entry === "repository.lock"
    || entry.startsWith("state.json.tmp-")
    || entry.startsWith("repository.format.tmp-"));
}

async function expectRepositoryError(operation, expectedCodes) {
  let actual = null;
  try {
    await operation();
  } catch (error) {
    actual = error?.code ?? error?.name ?? "ERROR";
  }
  const allowed = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
  return { actual, passed: allowed.includes(actual) };
}

async function commitChain(repository, revisions, keys) {
  let expectedHeadRevisionId = null;
  for (const [index, key] of keys.entries()) {
    await repository.commit({
      operationId: `OP-SETUP-${key.toUpperCase()}`,
      revision: clone(revisions[key]),
      expectedHeadRevisionId,
      at: `2026-08-03T01:${String(index).padStart(2, "0")}:00Z`,
    });
    expectedHeadRevisionId = revisions[key].revisionId;
  }
}

async function runAtomicBoundaryScenarios({ revisions, transcriptRun }) {
  const scenarios = [];

  async function record(id, checks, evidence = {}) {
    const passed = Object.values(checks).every(Boolean);
    scenarios.push({ id, passed, checks, ...evidence });
  }

  const missing = await makeAtomicRoot("boundary-explicit-initialization", { initialize: false });
  const uninitialized = await expectRepositoryError(() => missing.repository.open(), "UNINITIALIZED");
  const initialized = await missing.repository.initialize();
  const missingOpen = await missing.repository.open();
  await record("JSON-01-uninitialized-and-empty-are-distinct", {
    uninitializedRejected: uninitialized.passed,
    initialized: initialized.status === "initialized",
    emptyAfterInitialization: missingOpen.status === "empty" && missingOpen.headRevisionId === null,
    stateFileCreated: Boolean(await optionalLstat(path.join(missing.repositoryRoot, "state.json"))),
    formatMarkerCreated: Boolean(await optionalLstat(path.join(missing.repositoryRoot, "repository.format"))),
  });

  await commitChain(missing.repository, revisions, ["r1"]);
  await rm(path.join(missing.repositoryRoot, "state.json"));
  const deletedState = await expectRepositoryError(() => missing.repository.open(), "CORRUPT");
  const reinitializeDeleted = await expectRepositoryError(() => missing.repository.initialize(), "CORRUPT");
  await record("JSON-02-deleted-history-is-not-an-empty-repository", {
    openDetectedLoss: deletedState.passed,
    reinitializeDetectedLoss: reinitializeDeleted.passed,
    formatMarkerPreserved: Boolean(await optionalLstat(path.join(missing.repositoryRoot, "repository.format"))),
  });

  const recovery = await makeAtomicRoot("boundary-recovery");
  await commitChain(recovery.repository, revisions, ["r1", "r2"]);
  const backupBytes = transcriptRun.backups.get("b1");
  const corruptBytes = Buffer.from("{broken repository state\n", "utf8");
  await writeFile(path.join(recovery.repositoryRoot, "state.json"), corruptBytes);
  const corruptOpen = await expectRepositoryError(() => recovery.repository.open(), "CORRUPT");
  const corruptSha256 = sha256(corruptBytes);
  const recovered = await recovery.repository.recoverFromBackup({
    backupBytes,
    expectedCorruptFileSha256: corruptSha256,
    operationId: "OP-RECOVER-B1",
    at: "2026-08-03T02:00:00Z",
  });
  const recoveredOpen = await recovery.repository.open();
  const recoveredOutbox = await recovery.repository.readOutbox();
  const recoveredState = await recovery.repository.exportStateForTest();
  const backupState = JSON.parse(backupBytes.toString("utf8")).state;
  const replayBefore = await rawStateSha256(recovery.repositoryRoot);
  const recoveryReplay = await recovery.repository.recoverFromBackup({
    backupBytes,
    expectedCorruptFileSha256: corruptSha256,
    operationId: "OP-RECOVER-B1",
    at: "2026-08-03T02:00:00Z",
  });
  const replayAfter = await rawStateSha256(recovery.repositoryRoot);
  await record("JSON-03-corrupt-detected-and-backup-recovered", {
    corruptDetected: corruptOpen.passed,
    recovered: recovered.status === "recovered",
    headRestored: recoveredOpen.headRevisionId === revisions.r2.revisionId,
    cursorEpochAdvanced: recoveredState.outboxEpoch !== backupState.outboxEpoch,
    recoveryStartsNewCursor: recoveredOutbox.events.length === 1
      && recoveredOutbox.epoch === recoveredState.outboxEpoch
      && recoveredOutbox.events[0]?.sequence === "1"
      && recoveredOutbox.events[0]?.epoch === recoveredState.outboxEpoch,
    recoveryEvidenceRecorded: recoveredOutbox.events[0]?.kind === "RECOVERY_COMPLETED"
      && recoveredOutbox.events[0]?.backupId === JSON.parse(backupBytes.toString("utf8")).backupId
      && recoveredOutbox.events[0]?.corruptFileSha256 === corruptSha256,
    lostResponseRetryReplayed: recoveryReplay.status === "replayed"
      && recoveryReplay.eventCursor?.epoch === recoveredState.outboxEpoch
      && recoveryReplay.eventCursor?.sequence === "1",
    replayZeroSideEffect: replayBefore === replayAfter,
    noResidue: (await residue(recovery.repositoryRoot)).length === 0,
  }, { corruptFileSha256: corruptSha256 });

  const changedCorruptBytes = Buffer.from("{changed corrupt state\n", "utf8");
  await writeFile(path.join(recovery.repositoryRoot, "state.json"), changedCorruptBytes);
  const staleBefore = await rawStateSha256(recovery.repositoryRoot);
  const staleRecovery = await expectRepositoryError(() => recovery.repository.recoverFromBackup({
    backupBytes,
    expectedCorruptFileSha256: "0".repeat(64),
    operationId: "OP-RECOVER-STALE",
    at: "2026-08-03T02:01:00Z",
  }), "STALE_CORRUPT_FILE");
  const staleAfter = await rawStateSha256(recovery.repositoryRoot);
  await record("JSON-04-stale-corrupt-cas-zero-side-effect", {
    rejected: staleRecovery.passed,
    bytesUnchanged: staleBefore === staleAfter,
    noResidue: (await residue(recovery.repositoryRoot)).length === 0,
  });

  const tamper = await makeAtomicRoot("boundary-backup-tamper");
  await commitChain(tamper.repository, revisions, ["r1", "r2"]);
  const tamperedBackup = JSON.parse(backupBytes.toString("utf8"));
  tamperedBackup.createdAt = "2026-08-03T02:02:00Z";
  const tamperBefore = await rawStateSha256(tamper.repositoryRoot);
  const tamperResult = await expectRepositoryError(() => tamper.repository.restore({
    operationId: "OP-RESTORE-TAMPER",
    backupBytes: encodeRepositoryJson(tamperedBackup),
    expectedHeadRevisionId: revisions.r2.revisionId,
    at: "2026-08-03T02:03:00Z",
  }), "BACKUP_INVALID");
  const tamperAfter = await rawStateSha256(tamper.repositoryRoot);
  await record("JSON-05-backup-tamper-zero-side-effect", {
    rejected: tamperResult.passed,
    stateUnchanged: tamperBefore === tamperAfter,
    noResidue: (await residue(tamper.repositoryRoot)).length === 0,
  });

  const validRecoveryBefore = await rawStateSha256(tamper.repositoryRoot);
  const validRecovery = await expectRepositoryError(() => tamper.repository.recoverFromBackup({
    backupBytes,
    expectedCorruptFileSha256: validRecoveryBefore,
    operationId: "OP-RECOVER-VALID-STATE",
    at: "2026-08-03T02:03:30Z",
  }), "RECOVERY_NOT_REQUIRED");
  const validRecoveryAfter = await rawStateSha256(tamper.repositoryRoot);
  await record("JSON-06-valid-state-recovery-is-rejected", {
    rejected: validRecovery.passed,
    stateUnchanged: validRecoveryBefore === validRecoveryAfter,
    headPreserved: (await tamper.repository.open()).headRevisionId === revisions.r2.revisionId,
    noResidue: (await residue(tamper.repositoryRoot)).length === 0,
  });

  const fault = await makeAtomicRoot("boundary-fault-injection");
  await commitChain(fault.repository, revisions, ["r1"]);
  const faultBefore = await rawStateSha256(fault.repositoryRoot);
  const faultRepository = new AtomicJsonFamilyRepository({
    repositoryId: REPOSITORY_ID,
    repositoryRoot: fault.repositoryRoot,
    allowedRoot: RUN_ROOT,
    faultInjector: async (point) => {
      if (point === "after-temp-sync-before-rename") throw new Error("INJECTED_BEFORE_RENAME");
    },
  });
  const faultResult = await expectRepositoryError(() => faultRepository.commit({
    operationId: "OP-FAULT-R2",
    revision: clone(revisions.r2),
    expectedHeadRevisionId: revisions.r1.revisionId,
    at: "2026-08-03T02:04:00Z",
  }), "Error");
  const faultAfter = await rawStateSha256(fault.repositoryRoot);
  const faultOpen = await fault.repository.open();
  await record("JSON-07-pre-rename-fault-preserves-old-state", {
    faultObserved: faultResult.passed,
    bytesUnchanged: faultBefore === faultAfter,
    oldHeadReadable: faultOpen.headRevisionId === revisions.r1.revisionId,
    noResidue: (await residue(fault.repositoryRoot)).length === 0,
  });

  const concurrent = await makeAtomicRoot("boundary-concurrency");
  await commitChain(concurrent.repository, revisions, ["r1", "r2"]);
  const left = new AtomicJsonFamilyRepository({ repositoryId: REPOSITORY_ID, repositoryRoot: concurrent.repositoryRoot, allowedRoot: RUN_ROOT });
  const right = new AtomicJsonFamilyRepository({ repositoryId: REPOSITORY_ID, repositoryRoot: concurrent.repositoryRoot, allowedRoot: RUN_ROOT });
  const commands = [
    left.commit({
      operationId: "OP-CONCURRENT-R3",
      revision: clone(revisions.r3),
      expectedHeadRevisionId: revisions.r2.revisionId,
      at: "2026-08-03T02:05:00Z",
    }),
    right.commit({
      operationId: "OP-CONCURRENT-R3-ALT",
      revision: clone(revisions.r3alt),
      expectedHeadRevisionId: revisions.r2.revisionId,
      at: "2026-08-03T02:05:01Z",
    }),
  ];
  const settled = await Promise.allSettled(commands);
  const successes = settled.filter((result) => result.status === "fulfilled");
  const errors = settled.filter((result) => result.status === "rejected").map((result) => result.reason?.code);
  const concurrentOpen = await concurrent.repository.open();
  await record("JSON-08-concurrent-cas-has-single-winner", {
    oneWinner: successes.length === 1,
    expectedLoser: errors.length === 1 && ["BUSY", "STALE_HEAD"].includes(errors[0]),
    validWinningHead: [revisions.r3.revisionId, revisions.r3alt.revisionId].includes(concurrentOpen.headRevisionId),
    noResidue: (await residue(concurrent.repositoryRoot)).length === 0,
  }, { normalizedLoser: errors.length === 1 && ["BUSY", "STALE_HEAD"].includes(errors[0]) ? "BUSY_OR_STALE_HEAD" : errors[0] ?? null });

  const zero = await makeAtomicRoot("boundary-zero-byte");
  await writeFile(path.join(zero.repositoryRoot, "state.json"), Buffer.alloc(0));
  const zeroBefore = await rawStateSha256(zero.repositoryRoot);
  const zeroResult = await expectRepositoryError(() => zero.repository.open(), "CORRUPT");
  const zeroAfter = await rawStateSha256(zero.repositoryRoot);
  await record("JSON-09-zero-byte-is-corrupt", {
    rejected: zeroResult.passed,
    bytesUnchanged: zeroBefore === zeroAfter,
  });

  const noncanonical = await makeAtomicRoot("boundary-noncanonical");
  await commitChain(noncanonical.repository, revisions, ["r1"]);
  const semanticState = await noncanonical.repository.exportStateForTest();
  await writeFile(path.join(noncanonical.repositoryRoot, "state.json"), Buffer.from(JSON.stringify(semanticState), "utf8"));
  const noncanonicalBefore = await rawStateSha256(noncanonical.repositoryRoot);
  const noncanonicalResult = await expectRepositoryError(() => noncanonical.repository.open(), "CORRUPT");
  const rollbackAttempt = await expectRepositoryError(() => noncanonical.repository.recoverFromBackup({
    backupBytes,
    expectedCorruptFileSha256: noncanonicalBefore,
    operationId: "OP-RECOVER-FORMAT-DRIFT",
    at: "2026-08-03T02:06:00Z",
  }), "STATE_FORMAT_DRIFT");
  const afterRollbackAttempt = await rawStateSha256(noncanonical.repositoryRoot);
  const normalized = await noncanonical.repository.normalizeStateFormat({
    expectedNoncanonicalFileSha256: noncanonicalBefore,
  });
  const normalizedOpen = await noncanonical.repository.open();
  const normalizedState = await noncanonical.repository.exportStateForTest();
  const canonicalBytes = await readFile(path.join(noncanonical.repositoryRoot, "state.json"));
  await record("JSON-10-format-drift-normalizes-without-backup-rollback", {
    normalOpenRejectedDrift: noncanonicalResult.passed,
    backupRecoveryRejected: rollbackAttempt.passed,
    recoveryZeroSideEffect: noncanonicalBefore === afterRollbackAttempt,
    normalized: normalized.status === "normalized",
    headPreserved: normalizedOpen.headRevisionId === revisions.r1.revisionId,
    journalPreserved: normalizedState.outbox.length === 1 && normalizedState.operations.length === 1,
    canonicalOwnedBytes: canonicalBytes.equals(encodeRepositoryJson(normalizedState)),
    noResidue: (await residue(noncanonical.repositoryRoot)).length === 0,
  });

  const foreign = await makeAtomicRoot("boundary-foreign-repository", {
    repositoryId: "FAMILY-REPO-FOREIGN-001",
  });
  await commitChain(foreign.repository, revisions, ["r1"]);
  const foreignBackup = await foreign.repository.createBackup({ createdAt: "2026-08-03T02:07:00Z" });
  const scopeTarget = await makeAtomicRoot("boundary-backup-scope-target");
  await commitChain(scopeTarget.repository, revisions, ["r1"]);
  const scopeBefore = await rawStateSha256(scopeTarget.repositoryRoot);
  const scopeResult = await expectRepositoryError(() => scopeTarget.repository.restore({
    operationId: "OP-RESTORE-FOREIGN-REPOSITORY",
    backupBytes: foreignBackup,
    expectedHeadRevisionId: revisions.r1.revisionId,
    at: "2026-08-03T02:08:00Z",
  }), "BACKUP_SCOPE_MISMATCH");
  const scopeAfter = await rawStateSha256(scopeTarget.repositoryRoot);
  await record("JSON-11-foreign-repository-backup-is-rejected", {
    rejected: scopeResult.passed,
    stateUnchanged: scopeBefore === scopeAfter,
    headPreserved: (await scopeTarget.repository.open()).headRevisionId === revisions.r1.revisionId,
    noResidue: (await residue(scopeTarget.repositoryRoot)).length === 0,
  });

  const semanticBackup = await makeAtomicRoot("boundary-semantic-backup-wire");
  await commitChain(semanticBackup.repository, revisions, ["r1", "r2", "r3"]);
  const minifiedBackup = Buffer.from(JSON.stringify(JSON.parse(backupBytes.toString("utf8"))), "utf8");
  const semanticRestore = await semanticBackup.repository.restore({
    operationId: "OP-RESTORE-MINIFIED-BACKUP",
    backupBytes: minifiedBackup,
    expectedHeadRevisionId: revisions.r3.revisionId,
    at: "2026-08-03T02:09:00Z",
  });
  const semanticOutbox = await semanticBackup.repository.readOutbox();
  await record("JSON-12-backup-wire-identity-is-format-independent", {
    restored: semanticRestore.status === "restored",
    headRestored: (await semanticBackup.repository.open()).headRevisionId === revisions.r2.revisionId,
    backupIdentityRecorded: semanticOutbox.events.at(-1)?.backupId === JSON.parse(backupBytes.toString("utf8")).backupId,
    noResidue: (await residue(semanticBackup.repositoryRoot)).length === 0,
  });

  const portable = await makeAtomicRoot("boundary-portable-restore");
  const sourceBackup = JSON.parse(backupBytes.toString("utf8"));
  const portableResult = await portable.repository.restorePortable({
    operationId: "OP-PORTABLE-RESTORE-B1",
    replicaInstanceId: "REPLICA-GOLDEN-RESTORE-001",
    backupBytes,
    expectedHeadRevisionId: null,
    at: "2026-08-03T02:10:00Z",
  });
  const portableOpen = await portable.repository.open();
  const portableOutbox = await portable.repository.readOutbox();
  const portableBeforeReplay = await rawStateSha256(portable.repositoryRoot);
  const portableReplay = await portable.repository.restorePortable({
    operationId: "OP-PORTABLE-RESTORE-B1",
    replicaInstanceId: "REPLICA-GOLDEN-RESTORE-001",
    backupBytes,
    expectedHeadRevisionId: null,
    at: "2026-08-03T02:10:00Z",
  });
  const portableAfterReplay = await rawStateSha256(portable.repositoryRoot);
  const secondPortable = await expectRepositoryError(() => portable.repository.restorePortable({
    operationId: "OP-PORTABLE-RESTORE-SECOND",
    replicaInstanceId: "REPLICA-GOLDEN-RESTORE-002",
    backupBytes,
    expectedHeadRevisionId: portableOpen.headRevisionId,
    at: "2026-08-03T02:11:00Z",
  }), "PORTABLE_RESTORE_REQUIRES_EMPTY");
  await record("JSON-13-portable-restore-starts-a-distinct-replica-epoch", {
    restored: portableResult.status === "portable-restored",
    headRestored: portableOpen.headRevisionId === revisions.r2.revisionId,
    sourceCursorNotReused: portableOutbox.epoch !== sourceBackup.state.outboxEpoch,
    newCursorStartsAtOne: portableOutbox.events.length === 1
      && portableOutbox.events[0]?.sequence === "1"
      && portableOutbox.events[0]?.epoch === portableOutbox.epoch,
    restoreEvidenceRecorded: portableOutbox.events[0]?.kind === "RESTORE_COMPLETED"
      && portableOutbox.events[0]?.backupId === sourceBackup.backupId,
    lostResponseRetryReplayed: portableReplay.status === "replayed"
      && portableReplay.eventCursor?.epoch === portableOutbox.epoch
      && portableReplay.eventCursor?.sequence === "1",
    replayZeroSideEffect: portableBeforeReplay === portableAfterReplay,
    nonEmptyDestinationRejected: secondPortable.passed,
    noResidue: (await residue(portable.repositoryRoot)).length === 0,
  });

  return scenarios;
}

async function runCoreBoundaryScenarios(revisions) {
  const scenarios = [];

  async function invalidRevisionScenario(id, mutate) {
    const repository = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
    const revision = clone(revisions.r1);
    mutate(revision);
    revision.revisionId = computeFamilyRevisionId(revision);
    const before = await repository.stateSha256();
    const result = await expectRepositoryError(() => repository.commit({
      operationId: `OP-${id}`,
      revision,
      expectedHeadRevisionId: null,
      at: "2026-08-03T03:00:00Z",
    }), "INVALID_REVISION");
    const after = await repository.stateSha256();
    scenarios.push({
      id,
      passed: result.passed && before === after,
      checks: { rejected: result.passed, zeroSideEffect: before === after },
      actualError: result.actual,
    });
  }

  await invalidRevisionScenario("CORE-01-UNSORTED", (revision) => {
    [revision.bindings[0], revision.bindings[1]] = [revision.bindings[1], revision.bindings[0]];
  });
  await invalidRevisionScenario("CORE-02-DUPLICATE-OID", (revision) => {
    revision.bindings[1].logicalOid = revision.bindings[0].logicalOid;
  });

  const crossLibrary = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
  await commitChain(crossLibrary, revisions, ["r1"]);
  const foreignRevision = clone(revisions.r2);
  foreignRevision.familyLibraryId = "another-family-library";
  foreignRevision.revisionId = computeFamilyRevisionId(foreignRevision);
  const crossBefore = await crossLibrary.stateSha256();
  const crossResult = await expectRepositoryError(() => crossLibrary.commit({
    operationId: "OP-CROSS-LIBRARY-R2",
    revision: foreignRevision,
    expectedHeadRevisionId: revisions.r1.revisionId,
    at: "2026-08-03T03:01:00Z",
  }), "INVALID_REVISION");
  const crossAfter = await crossLibrary.stateSha256();
  scenarios.push({
    id: "CORE-03-cross-library-chain-rejected",
    passed: crossResult.passed && crossBefore === crossAfter,
    checks: { rejected: crossResult.passed, zeroSideEffect: crossBefore === crossAfter },
    actualError: crossResult.actual,
  });

  const journal = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
  await commitChain(journal, revisions, ["r1"]);
  const outcomeMismatch = await journal.exportStateForTest();
  outcomeMismatch.operations[0].outcomeHeadRevisionId = null;
  const outcomeResult = await expectRepositoryError(() => assertRepositoryState(outcomeMismatch), "CORRUPT");
  scenarios.push({
    id: "CORE-04-journal-outcome-must-match-event",
    passed: outcomeResult.passed,
    checks: { rejected: outcomeResult.passed },
    actualError: outcomeResult.actual,
  });

  const kindMismatch = await journal.exportStateForTest();
  kindMismatch.operations[0].kind = "RESTORE";
  const kindResult = await expectRepositoryError(() => assertRepositoryState(kindMismatch), "CORRUPT");
  scenarios.push({
    id: "CORE-05-journal-kind-must-match-event",
    passed: kindResult.passed,
    checks: { rejected: kindResult.passed },
    actualError: kindResult.actual,
  });

  const scopedTarget = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
  await commitChain(scopedTarget, revisions, ["r1"]);
  const scopedSource = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
  const otherFamilyRevision = clone(revisions.r1);
  otherFamilyRevision.familyLibraryId = "another-family-library";
  otherFamilyRevision.revisionId = computeFamilyRevisionId(otherFamilyRevision);
  await scopedSource.commit({
    operationId: "OP-SETUP-OTHER-FAMILY",
    revision: otherFamilyRevision,
    expectedHeadRevisionId: null,
    at: "2026-08-03T03:02:00Z",
  });
  const otherFamilyBackup = await scopedSource.createBackup({ createdAt: "2026-08-03T03:03:00Z" });
  const scopedBefore = await scopedTarget.stateSha256();
  const scopedResult = await expectRepositoryError(() => scopedTarget.restore({
    operationId: "OP-RESTORE-OTHER-FAMILY",
    backupBytes: otherFamilyBackup,
    expectedHeadRevisionId: revisions.r1.revisionId,
    at: "2026-08-03T03:04:00Z",
  }), "BACKUP_SCOPE_MISMATCH");
  const scopedAfter = await scopedTarget.stateSha256();
  scenarios.push({
    id: "CORE-06-cross-family-backup-is-rejected",
    passed: scopedResult.passed && scopedBefore === scopedAfter,
    checks: { rejected: scopedResult.passed, zeroSideEffect: scopedBefore === scopedAfter },
    actualError: scopedResult.actual,
  });

  const invalidDates = [
    "2026-02-29T00:00:00Z",
    "2026-02-31T00:00:00Z",
    "2026-03-01T24:00:00Z",
  ];
  const invalidDateResults = [];
  for (const [index, at] of invalidDates.entries()) {
    const repository = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
    const before = await repository.stateSha256();
    const result = await expectRepositoryError(() => repository.commit({
      operationId: `OP-INVALID-DATE-${index + 1}`,
      revision: clone(revisions.r1),
      expectedHeadRevisionId: null,
      at,
    }), "INVALID_COMMAND");
    invalidDateResults.push(result.passed && before === await repository.stateSha256());
  }
  scenarios.push({
    id: "CORE-07-invalid-calendar-timestamps-are-rejected",
    passed: invalidDateResults.every(Boolean),
    checks: { allRejectedWithZeroSideEffect: invalidDateResults.every(Boolean) },
  });

  const stateFromAnotherRepository = await scopedTarget.exportStateForTest();
  const mismatchedMemory = new MemoryFamilyRepository({
    repositoryId: "FAMILY-REPO-FOREIGN-002",
    state: stateFromAnotherRepository,
  });
  const memoryScope = await expectRepositoryError(() => mismatchedMemory.open(), "CORRUPT");
  scenarios.push({
    id: "CORE-08-memory-adapter-enforces-repository-scope",
    passed: memoryScope.passed,
    checks: { rejected: memoryScope.passed },
    actualError: memoryScope.actual,
  });

  const fingerprintTamper = await journal.exportStateForTest();
  fingerprintTamper.operations[0].fingerprint = "f".repeat(64);
  const fingerprintResult = await expectRepositoryError(() => assertRepositoryState(fingerprintTamper), "CORRUPT");
  scenarios.push({
    id: "CORE-09-live-state-integrity-covers-operation-fingerprint",
    passed: fingerprintResult.passed,
    checks: { rejected: fingerprintResult.passed },
    actualError: fingerprintResult.actual,
  });

  const bindingTransition = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
  await commitChain(bindingTransition, revisions, ["r1"]);
  const rolledBackBinding = clone(revisions.r2);
  rolledBackBinding.bindings[0].bindingRevision = 1;
  rolledBackBinding.revisionId = computeFamilyRevisionId(rolledBackBinding);
  const bindingBefore = await bindingTransition.stateSha256();
  const bindingResult = await expectRepositoryError(() => bindingTransition.commit({
    operationId: "OP-BINDING-REVISION-ROLLBACK",
    revision: rolledBackBinding,
    expectedHeadRevisionId: revisions.r1.revisionId,
    at: "2026-08-03T03:05:00Z",
  }), "INVALID_REVISION");
  const bindingAfter = await bindingTransition.stateSha256();
  scenarios.push({
    id: "CORE-10-binding-revision-follows-content-transition",
    passed: bindingResult.passed && bindingBefore === bindingAfter,
    checks: { rejected: bindingResult.passed, zeroSideEffect: bindingBefore === bindingAfter },
    actualError: bindingResult.actual,
  });

  const chronology = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
  await commitChain(chronology, revisions, ["r1"]);
  const timeRewind = clone(revisions.r2);
  timeRewind.createdAt = "2025-08-03T00:10:00Z";
  timeRewind.revisionId = computeFamilyRevisionId(timeRewind);
  const rewindBefore = await chronology.stateSha256();
  const rewindResult = await expectRepositoryError(() => chronology.commit({
    operationId: "OP-REVISION-TIME-REWIND",
    revision: timeRewind,
    expectedHeadRevisionId: revisions.r1.revisionId,
    at: "2026-08-03T03:06:00Z",
  }), "INVALID_REVISION");
  const earlyCommitResult = await expectRepositoryError(() => chronology.commit({
    operationId: "OP-COMMIT-BEFORE-REVISION",
    revision: clone(revisions.r2),
    expectedHeadRevisionId: revisions.r1.revisionId,
    at: "2026-08-03T00:09:00Z",
  }), "INVALID_COMMAND");
  const rewindAfter = await chronology.stateSha256();
  scenarios.push({
    id: "CORE-11-revision-and-command-timeline-is-monotonic",
    passed: rewindResult.passed && earlyCommitResult.passed && rewindBefore === rewindAfter,
    checks: {
      parentTimeRewindRejected: rewindResult.passed,
      earlyCommitRejected: earlyCommitResult.passed,
      zeroSideEffect: rewindBefore === rewindAfter,
    },
  });

  const impossibleAggregate = await journal.exportStateForTest();
  impossibleAggregate.outbox = [];
  impossibleAggregate.operations = [];
  impossibleAggregate.stateGeneration = "0";
  impossibleAggregate.nextOutboxSequence = "1";
  resealState(impossibleAggregate);
  const impossibleResult = await expectRepositoryError(() => assertRepositoryState(impossibleAggregate), "CORRUPT");
  scenarios.push({
    id: "CORE-12-revision-graph-requires-head-journal",
    passed: impossibleResult.passed,
    checks: { rejectedAfterValidReseal: impossibleResult.passed },
    actualError: impossibleResult.actual,
  });

  const chronologicalBackup = JSON.parse((await journal.createBackup({ createdAt: "2026-08-03T03:07:00Z" })).toString("utf8"));
  chronologicalBackup.createdAt = "2000-01-01T00:00:00Z";
  resealBackup(chronologicalBackup);
  const chronologicalBackupResult = await expectRepositoryError(
    () => assertRepositoryBackup(chronologicalBackup),
    "BACKUP_INVALID",
  );
  scenarios.push({
    id: "CORE-13-imported-backup-cannot-backdate-contained-state",
    passed: chronologicalBackupResult.passed,
    checks: { rejectedAfterIdentityRecomputed: chronologicalBackupResult.passed },
    actualError: chronologicalBackupResult.actual,
  });

  const portableSource = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
  await commitChain(portableSource, revisions, ["r1", "r2"]);
  const portableBackupBytes = await portableSource.createBackup({ createdAt: "2026-08-03T03:08:00Z" });
  const portableSourceEpoch = (await portableSource.readOutbox()).epoch;
  const portableTarget = new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID });
  const portableMemoryResult = await portableTarget.restorePortable({
    operationId: "OP-PORTABLE-MEMORY-B1",
    replicaInstanceId: "REPLICA-MEMORY-RESTORE-001",
    backupBytes: portableBackupBytes,
    expectedHeadRevisionId: null,
    at: "2026-08-03T03:09:00Z",
  });
  const portableTargetOutbox = await portableTarget.readOutbox();
  scenarios.push({
    id: "CORE-14-memory-portable-restore-shares-epoch-isolation-semantics",
    passed: portableMemoryResult.status === "portable-restored"
      && portableMemoryResult.headRevisionId === revisions.r2.revisionId
      && portableTargetOutbox.epoch !== portableSourceEpoch
      && portableTargetOutbox.events.length === 1,
    checks: {
      restored: portableMemoryResult.status === "portable-restored",
      headRestored: portableMemoryResult.headRevisionId === revisions.r2.revisionId,
      sourceCursorNotReused: portableTargetOutbox.epoch !== portableSourceEpoch,
      singleRestoreEvent: portableTargetOutbox.events.length === 1,
    },
  });

  return scenarios;
}

async function run() {
  await prepareRunRoot();
  const { transcript, revisions } = await loadContract();
  revisions.r3alt = JSON.parse(await readFile(path.join(CONTRACT_ROOT, "golden/family-revision-3-alt.json"), "utf8"));

  const memoryRun = await runTranscript({
    name: "memory",
    createRepository: async () => new MemoryFamilyRepository({ repositoryId: REPOSITORY_ID }),
    transcript,
    revisions,
  });
  const atomic = await makeAtomicRoot("adapter-atomic-json");
  const atomicRun = await runTranscript({
    name: "atomic-json",
    createRepository: async () => atomic.repository,
    transcript,
    revisions,
  });

  const comparable = (runResult) => runResult.results.map(({ id, op, expected, observed, beforeStateSha256, afterStateSha256, eventCursor, eventCursorValid }) => ({
    id,
    op,
    expected,
    observed,
    beforeStateSha256,
    afterStateSha256,
    eventCursor,
    eventCursorValid,
  }));
  const adaptersMatch = sameJson(comparable(memoryRun), comparable(atomicRun));
  const backupBytesMatch = Buffer.from(memoryRun.backups.get("b1")).equals(Buffer.from(atomicRun.backups.get("b1")));
  const boundaryScenarios = await runAtomicBoundaryScenarios({ revisions, transcriptRun: atomicRun });
  const boundaryPassed = boundaryScenarios.filter((scenario) => scenario.passed).length;
  const coreBoundaryScenarios = await runCoreBoundaryScenarios(revisions);
  const coreBoundaryPassed = coreBoundaryScenarios.filter((scenario) => scenario.passed).length;
  const transcriptZeroSideEffects = transcript.steps.filter((step) => step.expected.zeroSideEffect === true);
  const memoryZero = memoryRun.results.filter((result) => result.expected.zeroSideEffect === true && result.observed.zeroSideEffect === true).length;
  const atomicZero = atomicRun.results.filter((result) => result.expected.zeroSideEffect === true && result.observed.zeroSideEffect === true).length;
  const atomicReopen = await atomicRun.repository.open();
  const transcriptCursorsValid = memoryRun.results.every((result) => result.eventCursorValid)
    && atomicRun.results.every((result) => result.eventCursorValid);
  const appendOnlyRevisionRetained = [memoryRun, atomicRun].every((runResult) => (
    runResult.results.find((result) => result.id === "FR-13")?.observed.found === true
  ));

  const gates = {
    transcriptSchemaValid: true,
    memoryTranscriptPassed: memoryRun.passed === memoryRun.total,
    atomicJsonTranscriptPassed: atomicRun.passed === atomicRun.total,
    adaptersMatch,
    backupBytesMatch,
    transcriptZeroSideEffect: memoryZero === transcriptZeroSideEffects.length && atomicZero === transcriptZeroSideEffects.length,
    eventCursorReturnedForMutationsAndReplays: transcriptCursorsValid,
    restoreMovesHeadAndRetainsImmutableRevisions: appendOnlyRevisionRetained,
    atomicJsonBoundariesPassed: boundaryPassed === boundaryScenarios.length,
    coreSemanticBoundariesPassed: coreBoundaryPassed === coreBoundaryScenarios.length,
    atomicJsonAdapterReinstantiationPassed: atomicReopen.headRevisionId === revisions.r2.revisionId,
  };
  const report = {
    schemaVersion: 1,
    profile: "family-repository-validation-v1",
    contract: {
      transcriptProfile: transcript.profile,
      transcriptSteps: transcript.steps.length,
      revisionFixtures: Object.fromEntries(Object.entries(revisions).map(([key, revision]) => [key, revision.revisionId])),
      backupSha256: sha256(atomicRun.backups.get("b1")),
    },
    gates,
    adapters: [memoryRun, atomicRun].map((runResult) => ({
      name: runResult.name,
      passed: runResult.passed,
      total: runResult.total,
      zeroSideEffect: runResult.results.filter((result) => result.expected.zeroSideEffect === true && result.observed.zeroSideEffect === true).length,
      expectedZeroSideEffect: transcriptZeroSideEffects.length,
      results: runResult.results,
    })),
    atomicJsonBoundarySummary: {
      total: boundaryScenarios.length,
      passed: boundaryPassed,
      scenarios: boundaryScenarios,
    },
    coreBoundarySummary: {
      total: coreBoundaryScenarios.length,
      passed: coreBoundaryPassed,
      scenarios: coreBoundaryScenarios,
    },
    evidenceBoundary: {
      hostAtomicReplaceFaultWindowTested: true,
      adapterReinstantiationTested: true,
      processRestartTested: false,
      hostCrashDurabilityProven: false,
      parentDirectoryFsyncProven: false,
      staleLockCrashRecoveryTested: false,
      physicalDurabilityProven: false,
      targetStorageAdapterTested: false,
      sqliteAdapterPending: true,
    },
    integration: {
      familyRevisionBuildRequestSplit: "CLOSED",
      familyRepositoryPortAndTwoAdapters: "CLOSED",
      trustedApplicationIntegration: "PENDING",
      releaseDecisionOwner: "build/release-gate-current/release-decision.json",
    },
  };
  const reportBytes = encode(report);
  await writeFile(REPORT_PATH, reportBytes, { flag: "wx" });
  const allPassed = Object.values(gates).every(Boolean);
  console.log(`FamilyRepository memory transcript: ${memoryRun.passed}/${memoryRun.total}`);
  console.log(`FamilyRepository atomic JSON transcript: ${atomicRun.passed}/${atomicRun.total}`);
  console.log(`Adapter-neutral results: ${adaptersMatch ? "MATCH" : "DRIFT"}; backup bytes: ${backupBytesMatch ? "MATCH" : "DRIFT"}`);
  console.log(`Atomic JSON boundaries: ${boundaryPassed}/${boundaryScenarios.length}`);
  console.log(`Repository core boundaries: ${coreBoundaryPassed}/${coreBoundaryScenarios.length}`);
  console.log(`Transcript zero-side-effect: memory ${memoryZero}/${transcriptZeroSideEffects.length}; atomic JSON ${atomicZero}/${transcriptZeroSideEffects.length}`);
  console.log(`Report SHA-256: ${sha256(reportBytes)}`);
  console.log(`Report: ${REPORT_PATH}`);
  if (!allPassed) process.exitCode = 1;
}

const runnerLock = await acquireRunnerLock();
try {
  await run();
} finally {
  try { await runnerLock.close(); } catch { /* preserve validation result */ }
  try { await rm(RUNNER_LOCK, { force: true }); } catch { /* preserve validation result */ }
}
