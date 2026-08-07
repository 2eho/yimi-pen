import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import { MemoryFamilyRepository } from "../../../../tools/family-repository/memory-adapter.mjs";
import { commitImportedClipReplacement } from "./family-authoring-use-case.mjs";
import {
  createAuthoringProductReviewReceipt,
  createAuthoringProductSessionState,
  transitionAuthoringProductSession,
} from "./authoring-product-session-core.mjs";
import {
  assertAuthoringTaskRecoveryRecord,
  authoringTaskRecoveryCanonicalBytes,
  computeAuthoringTaskRecoveryId,
  createAuthoringTaskRecoveryRecord,
  encodeAuthoringTaskRecoveryRecord,
  updateAuthoringTaskRecoveryRecord,
} from "./authoring-task-recovery-contract.mjs";
import {
  classifyAuthoringTaskRecovery,
  createAuthoringTaskRecoveryRecordFromSession,
  openAuthoringTaskRecovery,
  saveAuthoringTaskRecoverySnapshot,
} from "./authoring-task-recovery.mjs";
import { createLocalAuthoringTaskJournal } from "./local-authoring-task-journal.mjs";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_ROOT, "../../../..");
const RUN_ROOT = path.join(REPO_ROOT, "build", "companion-authoring-task-recovery-validation");
const BASE_REVISION_PATH = path.join(
  REPO_ROOT,
  "hardware/evt0/family-repository-v1/golden/family-revision.json",
);
const RUNNER_PATH = fileURLToPath(import.meta.url);
const BASE_TIME = "2026-08-04T16:00:00.000Z";
const COMMIT_TIME = "2026-08-04T16:00:01.000Z";

function clone(value) {
  return structuredClone(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function taskPath(root, taskId) {
  return path.join(root, `task-${sha256(Buffer.from(taskId, "utf8"))}.json`);
}

function step(state, type, payload, eventId) {
  return transitionAuthoringProductSession(state, {
    eventId,
    expectedRevision: state.sessionRevision,
    type,
    ...payload,
  });
}

function metadata(transcript = "恢复验收固定内容。") {
  return {
    sourceKind: "family-recording",
    transcript,
    mediaType: "voice",
    language: "zh-CN",
  };
}

function importedAsset(baseRevision, assetId) {
  const clip = baseRevision.bindings[0].clips[0];
  return {
    assetId,
    contentPath: `assets/sha256/${clip.assetSha256}.wav`,
    bytes: clip.assetBytes,
    sha256: clip.assetSha256,
    durationMs: 1_000,
    codec: "WAV_PCM16_16K_MONO",
  };
}

function bindings({ sourceKind = "FILE", hardware = null } = {}) {
  return {
    source: {
      id: `source-${sourceKind.toLowerCase()}`,
      version: "1.0.0",
      profile: "authoring-source-adapter-v1",
    },
    permission: sourceKind === "CAPTURE"
      ? { id: "permission-fixture", version: "1.0.0", profile: "authoring-permission-adapter-v1" }
      : null,
    authoring: {
      id: "family-workspace-fixture",
      version: "1.0.0",
      profile: "family-workspace-authoring-port-v1",
    },
    commitCommand: {
      id: "commit-command-fixture",
      version: "1.0.0",
      profile: "authoring-commit-command-port-v1",
    },
    review: {
      id: "review-fixture",
      version: "1.0.0",
      profile: "authoring-review-port-v1",
    },
    hardware,
  };
}

function commandFor(state, suffix) {
  return {
    operationId: `OP-AUTHORING-RECOVERY-${suffix.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "-")}`,
    expectedHeadRevisionId: state.target.baseRevisionId,
    createdAt: BASE_TIME,
    committedAt: COMMIT_TIME,
    contentRevision: `family-alpha-recovery@0.0.${suffix.length + 1}`,
    bindingId: state.target.bindingId,
    clipId: state.target.clipId,
    importedAsset: clone(state.importedAsset),
    clipMetadata: clone(state.clipMetadata),
    sourceProducer: { name: "yimi-companion-authoring", version: "1.0.0" },
  };
}

function sourcePortsFor(sourceKind) {
  if (sourceKind === null) return [];
  return [{
    sourceKind,
    requiredCapability: sourceKind === "CAPTURE" ? "MICROPHONE" : null,
    clipSourceKind: "family-recording",
    async acquire({ assetId }) {
      return { importedAsset: { ...importedAsset(JSON.parse(await readFile(BASE_REVISION_PATH, "utf8")), assetId) } };
    },
  }];
}

function permissionPort() {
  return {
    async resolve({ capability }) {
      return { capability, status: "GRANTED" };
    },
  };
}

function commandPort() {
  return {
    create({ target, importedAsset: asset, clipMetadata }) {
      return {
        operationId: "OP-AUTHORING-RECOVERY-PREPARED",
        expectedHeadRevisionId: target.baseRevisionId,
        createdAt: BASE_TIME,
        committedAt: COMMIT_TIME,
        contentRevision: "family-alpha-recovery@0.0.99",
        bindingId: target.bindingId,
        clipId: target.clipId,
        importedAsset: clone(asset),
        clipMetadata: clone(clipMetadata),
        sourceProducer: { name: "private-fixture", version: "private-fixture" },
      };
    },
  };
}

function reviewPort() {
  const state = { calls: [] };
  return {
    state,
    async run(input) {
      state.calls.push({ reviewAttemptId: input.reviewAttemptId, revisionId: input.revision.revisionId });
      const subject = canonicalSha256({
        revisionId: input.revision.revisionId,
        reviewAttemptId: input.reviewAttemptId,
      }).sha256;
      return createAuthoringProductReviewReceipt({
        reviewAttemptId: input.reviewAttemptId,
        sessionId: input.sessionId,
        familyRevisionId: input.revision.revisionId,
        bindingId: input.bindingId,
        clipId: input.clipId,
        assetId: input.importedAsset.assetId,
        assetSha256: input.importedAsset.sha256,
        buildPlanId: "PLAN-AUTHORING-RECOVERY-001",
        buildSubjectSha256: subject,
        previewId: `sha256:${canonicalSha256({ subject, kind: "preview" }).sha256}`,
        presentationTranscriptSha256: canonicalSha256({ subject, kind: "transcript" }).sha256,
        confirmationId: "CONF-AUTHORING-RECOVERY-001",
        authorizationId: `authorization:sha256:${canonicalSha256({ subject, kind: "authorization" }).sha256}`,
        fixtureOnly: true,
        completedAt: "2026-08-04T16:30:00.000Z",
      });
    },
  };
}

function baseState(baseRevision, sessionId, sourceKind = "FILE", assetId = "asset-recovery-state-001") {
  const binding = baseRevision.bindings[0];
  let state = createAuthoringProductSessionState({
    sessionId,
    baseRevision,
    bindingId: binding.bindingId,
    clipId: binding.clips[0].clipId,
  });
  state = step(state, "SOURCE_SELECTED", {
    selection: {
      sourceKind,
      assetId,
      requiredCapability: sourceKind === "CAPTURE" ? "MICROPHONE" : null,
      clipSourceKind: "family-recording",
    },
  }, `${sessionId}-selected`);
  return state;
}

function durableState(baseRevision, sessionId, suffix = "001", sourceKind = "FILE") {
  const asset = importedAsset(baseRevision, `asset-recovery-${suffix}`);
  let state = baseState(baseRevision, sessionId, sourceKind, asset.assetId);
  state = step(state, "SOURCE_ACQUISITION_STARTED", { attemptId: `${sessionId}-source` }, `${sessionId}-source-start`);
  state = step(state, "SOURCE_ACQUIRED", {
    attemptId: `${sessionId}-source`,
    importedAsset: asset,
  }, `${sessionId}-source-done`);
  state = step(state, "METADATA_SUBMITTED", {
    clipMetadata: metadata(`固定恢复内容-${suffix}。`),
  }, `${sessionId}-metadata`);
  return state;
}

async function seedRepository(baseRevision, repositoryId) {
  const repository = new MemoryFamilyRepository({ repositoryId });
  await repository.commit({
    operationId: `OP-SEED-${repositoryId}`,
    revision: clone(baseRevision),
    expectedHeadRevisionId: null,
    at: baseRevision.createdAt,
  });
  return repository;
}

async function committedFixture(baseRevision, repositoryId, suffix) {
  const repository = await seedRepository(baseRevision, repositoryId);
  let state = durableState(baseRevision, `session-${suffix}`, suffix);
  state = step(state, "COMMIT_PREPARATION_STARTED", {
    attemptId: `session-${suffix}-prepare`,
  }, `session-${suffix}-prepare-start`);
  const command = commandFor(state, suffix);
  state = step(state, "COMMIT_PREPARED", {
    attemptId: `session-${suffix}-prepare`,
    command,
  }, `session-${suffix}-prepared`);
  const committing = step(state, "COMMIT_STARTED", {
    attemptId: `session-${suffix}-commit`,
    command,
  }, `session-${suffix}-commit-start`);
  const receipt = await commitImportedClipReplacement({ repository, ...command });
  const readyToReview = step(committing, "COMMIT_SUCCEEDED", {
    attemptId: `session-${suffix}-commit`,
    receipt,
  }, `session-${suffix}-commit-success`);
  return { repository, state, committing, readyToReview, command, receipt };
}

async function saveNew(journal, record) {
  return journal.createOrSaveCAS({ record, expected: null });
}

async function writeJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runChild(config) {
  const configPath = path.join(RUN_ROOT, `child-${config.taskId}.json`);
  const resultPath = path.join(RUN_ROOT, `child-${config.taskId}.result.json`);
  await writeJson(configPath, { ...config, resultPath });
  const child = spawn(process.execPath, [RUNNER_PATH, "--child", configPath], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0) {
    throw new Error(`child ${config.taskId} failed: ${JSON.stringify(result)} ${Buffer.concat(stderr).toString("utf8")}`);
  }
  return JSON.parse(await readFile(resultPath, "utf8"));
}

function childPorts(config, repository) {
  const review = reviewPort();
  return {
    authoringPort: {
      async loadHead() { return repository.loadHead(); },
      async commitReplacement(command) {
        return commitImportedClipReplacement({ repository, ...command });
      },
    },
    sourcePorts: sourcePortsFor(config.sourceKind ?? null),
    permissionPort: config.sourceKind === "CAPTURE" ? permissionPort() : null,
    commitCommandPort: commandPort(),
    reviewPort: review,
  };
}

async function childMain(configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const journal = createLocalAuthoringTaskJournal({ root: config.journalRoot });
  const repository = new MemoryFamilyRepository({
    repositoryId: config.repositoryId,
    state: config.repositoryState,
  });
  const ports = childPorts(config, repository);
  const recovered = await openAuthoringTaskRecovery({
    journal,
    taskId: config.taskId,
    adapterBindings: config.adapterBindings,
    ...ports,
  });
  const result = {
    decision: recovered.decision,
    controller: recovered.controller === null ? null : {
      phase: recovered.controller.snapshot().phase,
      state: recovered.controller.snapshot(),
    },
    record: recovered.getRecord(),
  };
  if (config.action === "COMMIT_REPLAY") {
    const frozenCommand = clone(recovered.controller.snapshot().commitCommand);
    await recovered.controller.commit();
    await recovered.save();
    result.replayedCommand = frozenCommand;
    result.commitReceipt = recovered.controller.snapshot().commitReceipt;
    result.repositoryState = await repository.exportStateForTest();
    result.record = recovered.getRecord();
    result.controller = {
      phase: recovered.controller.snapshot().phase,
      state: recovered.controller.snapshot(),
    };
  } else if (config.action === "REVIEW_RETRY") {
    await recovered.controller.review();
    await recovered.save({ lifecycle: "COMPLETED" });
    result.reviewCalls = ports.reviewPort.state.calls;
    result.record = recovered.getRecord();
    result.controller = {
      phase: recovered.controller.snapshot().phase,
      state: recovered.controller.snapshot(),
    };
  }
  await writeJson(config.resultPath, result);
}

async function main() {
  await rm(RUN_ROOT, { recursive: true, force: true });
  await mkdir(RUN_ROOT, { recursive: true });
  const baseRevision = JSON.parse(await readFile(BASE_REVISION_PATH, "utf8"));
  const checks = [];
  const check = (name, passed, detail) => {
    if (!passed) throw new Error(`${name}: ${detail}`);
    checks.push({ name, passed: true, detail });
  };

  const commonJournalRoot = path.join(RUN_ROOT, "journal-core");
  const commonJournal = createLocalAuthoringTaskJournal({ root: commonJournalRoot });
  const initialState = createAuthoringProductSessionState({
    sessionId: "session-journal-core-001",
    baseRevision,
    bindingId: baseRevision.bindings[0].bindingId,
    clipId: baseRevision.bindings[0].clips[0].clipId,
  });
  const initialRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-journal-core-001",
    sessionSnapshot: initialState,
    adapterBindings: bindings(),
  });
  const encoded = authoringTaskRecoveryCanonicalBytes(initialRecord);
  check("record bytes are canonical and content-addressed",
    Buffer.compare(encoded, encodeAuthoringTaskRecoveryRecord(initialRecord)) === 0
      && initialRecord.recordId === computeAuthoringTaskRecoveryId(initialRecord),
  initialRecord.recordId);
  await saveNew(commonJournal, initialRecord);
  const malformed = clone(initialRecord);
  malformed.decision.kind = "NOT_A_DECISION";
  malformed.recordId = computeAuthoringTaskRecoveryId(malformed);
  let malformedCode = null;
  try { assertAuthoringTaskRecoveryRecord(malformed); } catch (error) { malformedCode = error.code; }
  check("strict record validation rejects recomputed malformed decisions",
    malformedCode === "AUTHORING_TASK_RECOVERY_DECISION_INVALID", malformedCode ?? "no error");
  const duplicate = await commonJournal.createOrSaveCAS({ record: initialRecord, expected: null });
  check("duplicate initial restart is idempotent", duplicate.recordId === initialRecord.recordId,
    `journalRevision=${duplicate.journalRevision}`);

  const selectedState = baseState(baseRevision, "session-journal-selected-001");
  const selectedRecord = updateAuthoringTaskRecoveryRecord(initialRecord, {
    sessionSnapshot: selectedState,
    recoveryContext: {
      sourceRequest: { sourcePath: "fixture.wav" },
      committedRevision: null,
      eventSequence: selectedState.sessionRevision,
      attemptSequence: selectedState.sessionRevision,
      activeEffect: null,
    },
  });
  const savedSelected = await commonJournal.createOrSaveCAS({
    record: selectedRecord,
    expected: commonJournal.casExpectation(initialRecord),
  });
  const savedBytes = await readFile(taskPath(commonJournalRoot, selectedRecord.taskId));
  const rootEntries = await readdir(commonJournalRoot);
  check("atomic local record replace leaves canonical bytes and no temp record",
    savedSelected.recordId === selectedRecord.recordId
      && Buffer.compare(savedBytes, encodeAuthoringTaskRecoveryRecord(selectedRecord)) === 0
      && rootEntries.every((entry) => !entry.includes(".next-")),
  savedSelected.recordId);
  let staleCode = null;
  try {
    await commonJournal.createOrSaveCAS({
      record: updateAuthoringTaskRecoveryRecord(initialRecord, {
        sessionSnapshot: selectedState,
        recoveryContext: selectedRecord.recoveryContext,
      }),
      expected: commonJournal.casExpectation(initialRecord),
    });
  } catch (error) { staleCode = error.code; }
  check("stale journal writer is rejected by CAS", staleCode === "AUTHORING_TASK_JOURNAL_CAS_CONFLICT", staleCode ?? "no error");

  const corruptTask = "task-journal-corrupt-001";
  const corruptRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: corruptTask,
    sessionSnapshot: initialState,
    adapterBindings: bindings(),
  });
  await saveNew(commonJournal, corruptRecord);
  const corruptBytes = Buffer.from("{\"broken\":true}\n", "utf8");
  await writeFile(taskPath(commonJournalRoot, corruptTask), corruptBytes);
  const corruptLoad = await commonJournal.load(corruptTask);
  const quarantineEntries = await readdir(path.join(commonJournalRoot, "quarantine"));
  const corruptionListing = await commonJournal.list();
  check("corruption is quarantined, preserved, and surfaced as evidence",
    corruptLoad.status === "CORRUPT"
      && quarantineEntries.some((entry) => entry.includes(sha256(corruptBytes)))
      && corruptionListing.corruptions.some((receipt) => receipt.taskId === corruptTask),
  corruptLoad.corruption.receiptId);

  const sourceRepository = await seedRepository(baseRevision, "FAMILY-REPO-RECOVERY-SOURCE-001");
  const sourceRoot = path.join(RUN_ROOT, "journal-source");
  const sourceJournal = createLocalAuthoringTaskJournal({ root: sourceRoot });
  let permissionState = baseState(baseRevision, "session-permission-restart-001", "CAPTURE", "asset-recovery-permission-001");
  permissionState = step(permissionState, "PERMISSION_STARTED", {
    attemptId: "session-permission-restart-001-permission",
  }, "session-permission-restart-001-permission-start");
  const permissionRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-permission-restart-001",
    sessionSnapshot: permissionState,
    adapterBindings: bindings({ sourceKind: "CAPTURE" }),
    sourceRequest: { device: "fixture-microphone", durationSeconds: 1 },
    eventSequence: permissionState.sessionRevision,
    attemptSequence: 2,
  });
  await saveNew(sourceJournal, permissionRecord);
  const permissionRestart = await runChild({
    taskId: permissionRecord.taskId,
    journalRoot: sourceRoot,
    repositoryId: "FAMILY-REPO-RECOVERY-SOURCE-001",
    repositoryState: await sourceRepository.exportStateForTest(),
    adapterBindings: bindings({ sourceKind: "CAPTURE" }),
    sourceKind: "CAPTURE",
    action: "OPEN",
  });
  check("pre-durable permission interruption restarts source", permissionRestart.decision.kind === "RESTART_SOURCE"
    && permissionRestart.controller.phase === "READY_TO_ACQUIRE"
    && permissionRestart.record.sessionSnapshot.permission === null,
  permissionRestart.decision.reasonCode);

  let acquisitionState = baseState(baseRevision, "session-acquisition-restart-001", "FILE", "asset-recovery-acquisition-001");
  acquisitionState = step(acquisitionState, "SOURCE_ACQUISITION_STARTED", {
    attemptId: "session-acquisition-restart-001-source",
  }, "session-acquisition-restart-001-source-start");
  const acquisitionRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-acquisition-restart-001",
    sessionSnapshot: acquisitionState,
    adapterBindings: bindings(),
    sourceRequest: { sourcePath: "fixture.wav" },
    eventSequence: acquisitionState.sessionRevision,
    attemptSequence: 2,
  });
  await saveNew(sourceJournal, acquisitionRecord);
  const acquisitionRestart = await runChild({
    taskId: acquisitionRecord.taskId,
    journalRoot: sourceRoot,
    repositoryId: "FAMILY-REPO-RECOVERY-SOURCE-001",
    repositoryState: await sourceRepository.exportStateForTest(),
    adapterBindings: bindings(),
    sourceKind: "FILE",
    action: "OPEN",
  });
  check("pre-durable acquisition interruption restarts source", acquisitionRestart.decision.kind === "RESTART_SOURCE"
    && acquisitionRestart.controller.phase === "READY_TO_ACQUIRE", acquisitionRestart.decision.reasonCode);

  const abandonRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-source-abandon-001",
    sessionSnapshot: permissionState,
    adapterBindings: bindings({ sourceKind: "CAPTURE" }),
    sourceRequest: null,
    eventSequence: permissionState.sessionRevision,
    attemptSequence: 2,
  });
  await saveNew(sourceJournal, abandonRecord);
  const abandonRestart = await runChild({
    taskId: abandonRecord.taskId,
    journalRoot: sourceRoot,
    repositoryId: "FAMILY-REPO-RECOVERY-SOURCE-001",
    repositoryState: await sourceRepository.exportStateForTest(),
    adapterBindings: bindings({ sourceKind: "CAPTURE" }),
    sourceKind: "CAPTURE",
    action: "OPEN",
  });
  check("pre-durable restart without source request is abandon-only",
    abandonRestart.decision.kind === "ABANDON" && abandonRestart.controller === null,
  abandonRestart.decision.reasonCode);

  const durableRepository = await seedRepository(baseRevision, "FAMILY-REPO-RECOVERY-DURABLE-001");
  const durableRoot = path.join(RUN_ROOT, "journal-durable");
  const durableJournal = createLocalAuthoringTaskJournal({ root: durableRoot });
  const durable = durableState(baseRevision, "session-durable-asset-001", "durable");
  const durableRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-durable-asset-001",
    sessionSnapshot: durable,
    adapterBindings: bindings(),
  });
  await saveNew(durableJournal, durableRecord);
  const durableRestart = await runChild({
    taskId: durableRecord.taskId,
    journalRoot: durableRoot,
    repositoryId: "FAMILY-REPO-RECOVERY-DURABLE-001",
    repositoryState: await durableRepository.exportStateForTest(),
    adapterBindings: bindings(),
    sourceKind: null,
    action: "OPEN",
  });
  check("durable imported asset resumes without source adapter", durableRestart.decision.kind === "CONTINUE"
    && durableRestart.controller.phase === "READY_TO_COMMIT"
    && durableRestart.controller.state.facts.importedAssetPublished
    && durableRestart.controller.state.importedAsset !== null,
  durableRestart.decision.reasonCode);

  const preparingRepository = await seedRepository(baseRevision, "FAMILY-REPO-RECOVERY-PREPARING-001");
  const preparingRoot = path.join(RUN_ROOT, "journal-preparing");
  const preparingJournal = createLocalAuthoringTaskJournal({ root: preparingRoot });
  let preparingState = durableState(baseRevision, "session-preparing-001", "preparing");
  preparingState = step(preparingState, "COMMIT_PREPARATION_STARTED", {
    attemptId: "session-preparing-001-prepare",
  }, "session-preparing-001-prepare-start");
  const preparingRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-preparing-001",
    sessionSnapshot: preparingState,
    adapterBindings: bindings(),
  });
  await saveNew(preparingJournal, preparingRecord);
  const preparingRestart = await runChild({
    taskId: preparingRecord.taskId,
    journalRoot: preparingRoot,
    repositoryId: "FAMILY-REPO-RECOVERY-PREPARING-001",
    repositoryState: await preparingRepository.exportStateForTest(),
    adapterBindings: bindings(),
    sourceKind: null,
    action: "OPEN",
  });
  check("PREPARING_COMMIT is a deterministic safe retry boundary",
    preparingRestart.decision.reasonCode === "PREPARING_COMMIT_SAFE_RETRY"
      && preparingRestart.controller.phase === "READY_TO_COMMIT"
      && preparingRestart.controller.state.commitCommand === null,
  preparingRestart.decision.kind);

  const committingFixture = await committedFixture(baseRevision, "FAMILY-REPO-RECOVERY-COMMIT-001", "commit-replay");
  const committingRoot = path.join(RUN_ROOT, "journal-commit");
  const committingJournal = createLocalAuthoringTaskJournal({ root: committingRoot });
  const committingRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-committing-checkpoint-001",
    sessionSnapshot: committingFixture.committing,
    adapterBindings: bindings(),
  });
  await saveNew(committingJournal, committingRecord);
  const loadedCommitting = await committingJournal.load(committingRecord.taskId);
  check("COMMITTING checkpoint carries frozen command before effect replay",
    loadedCommitting.record.sessionSnapshot.phase === "COMMITTING"
      && loadedCommitting.record.sessionSnapshot.active.stage === "COMMIT"
      && loadedCommitting.record.sessionSnapshot.commitCommand.operationId === committingFixture.command.operationId,
  loadedCommitting.record.sessionSnapshot.commitCommand.operationId);

  const responseRoot = path.join(RUN_ROOT, "journal-response-loss");
  const responseJournal = createLocalAuthoringTaskJournal({ root: responseRoot });
  const responseFixture = await committedFixture(baseRevision, "FAMILY-REPO-RECOVERY-RESPONSE-001", "response-loss");
  const failedState = step(responseFixture.committing, "OPERATION_FAILED", {
    attemptId: "session-response-loss-commit",
    failure: {
      stage: "COMMIT",
      code: "AUTHORING_SESSION_COMMIT_TRANSIENT",
      category: "TRANSIENT",
      retryable: true,
      resumePhase: "READY_TO_COMMIT",
      importedAssetPublished: false,
    },
  }, "session-response-loss-failure");
  const failedRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-response-loss-001",
    sessionSnapshot: failedState,
    adapterBindings: bindings(),
  });
  await saveNew(responseJournal, failedRecord);
  const responseBefore = await responseFixture.repository.exportStateForTest();
  const responseRestart = await runChild({
    taskId: failedRecord.taskId,
    journalRoot: responseRoot,
    repositoryId: "FAMILY-REPO-RECOVERY-RESPONSE-001",
    repositoryState: responseBefore,
    adapterBindings: bindings(),
    sourceKind: null,
    action: "COMMIT_REPLAY",
  });
  check("response loss replays the frozen command through the truth barrier",
    responseRestart.decision.kind === "REPLAY_FROZEN_COMMIT"
      && responseRestart.replayedCommand.operationId === failedRecord.sessionSnapshot.commitCommand.operationId
      && responseRestart.controller.phase === "READY_TO_REVIEW"
      && responseRestart.commitReceipt.replayed === true,
  responseRestart.decision.reasonCode);
  const responseAfter = responseRestart.repositoryState;
  check("response-loss replay creates no duplicate revision",
    responseAfter.revisions.length === responseBefore.revisions.length
      && responseAfter.outbox.length === responseBefore.outbox.length
      && responseAfter.headRevisionId === responseBefore.headRevisionId,
  `revisions=${responseAfter.revisions.length} outbox=${responseAfter.outbox.length}`);
  check("commit is non-abortable while COMMITTING is durable",
    failedRecord.sessionSnapshot.phase === "FAILED"
      && failedRecord.sessionSnapshot.commitCommand !== null
      && failedRecord.sessionSnapshot.failure.stage === "COMMIT",
  "non-abortable external effect remains replayable");

  const reviewRoot = path.join(RUN_ROOT, "journal-review");
  const reviewJournal = createLocalAuthoringTaskJournal({ root: reviewRoot });
  const reviewFixture = await committedFixture(baseRevision, "FAMILY-REPO-RECOVERY-REVIEW-001", "review-retry");
  const reviewingState = step(reviewFixture.readyToReview, "REVIEW_STARTED", {
    attemptId: "session-review-retry-review-1",
  }, "session-review-retry-review-start");
  const reviewingRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-reviewing-001",
    sessionSnapshot: reviewingState,
    adapterBindings: bindings(),
    committedRevision: reviewFixture.receipt.revision,
    attemptSequence: 3,
  });
  await saveNew(reviewJournal, reviewingRecord);
  const reviewRestart = await runChild({
    taskId: reviewingRecord.taskId,
    journalRoot: reviewRoot,
    repositoryId: "FAMILY-REPO-RECOVERY-REVIEW-001",
    repositoryState: await reviewFixture.repository.exportStateForTest(),
    adapterBindings: bindings(),
    sourceKind: null,
    action: "REVIEW_RETRY",
  });
  check("REVIEWING interruption starts a fresh review attempt",
    reviewRestart.decision.kind === "FRESH_REVIEW_RETRY"
      && reviewRestart.reviewCalls.length === 1
      && reviewRestart.reviewCalls[0].reviewAttemptId !== reviewingRecord.sessionSnapshot.active.attemptId,
  reviewRestart.reviewCalls[0].reviewAttemptId);
  check("fresh review hydrates the full committed revision",
    reviewRestart.reviewCalls[0].revisionId === reviewFixture.receipt.revision.revisionId
      && reviewRestart.controller.state.facts.durableRevisionPresent
      && reviewRestart.controller.phase === "COMPLETED",
  reviewRestart.controller.state.committedRevision.revisionId);

  const conflictRepository = await committedFixture(baseRevision, "FAMILY-REPO-RECOVERY-CONFLICT-001", "conflict-advance");
  const conflictRoot = path.join(RUN_ROOT, "journal-conflict");
  const conflictJournal = createLocalAuthoringTaskJournal({ root: conflictRoot });
  let conflictState = durableState(baseRevision, "session-conflict-001", "conflict");
  conflictState = step(conflictState, "METADATA_SUBMITTED", {
    clipMetadata: metadata("基线已变化，不静默合并。"),
  }, "session-conflict-001-metadata-refresh");
  const conflictRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-conflict-001",
    sessionSnapshot: conflictState,
    adapterBindings: bindings(),
  });
  await saveNew(conflictJournal, conflictRecord);
  const conflictRestart = await runChild({
    taskId: conflictRecord.taskId,
    journalRoot: conflictRoot,
    repositoryId: "FAMILY-REPO-RECOVERY-CONFLICT-001",
    repositoryState: await conflictRepository.repository.exportStateForTest(),
    adapterBindings: bindings(),
    sourceKind: null,
    action: "OPEN",
  });
  check("changed Family head is an explicit recovery conflict",
    conflictRestart.decision.kind === "CONFLICT"
      && conflictRestart.decision.reasonCode === "BASE_HEAD_CHANGED",
  conflictRestart.decision.reasonCode);
  check("conflict recovery has no controller and no silent rebase",
    conflictRestart.controller === null && conflictRestart.record.sessionSnapshot.target.baseRevisionId
      === conflictRecord.sessionSnapshot.target.baseRevisionId,
  conflictRestart.record.sessionSnapshot.target.baseRevisionId);

  const hardwareRecord = createAuthoringTaskRecoveryRecordFromSession({
    taskId: "task-hardware-binding-001",
    sessionSnapshot: durableState(baseRevision, "session-hardware-binding-001", "hardware"),
    adapterBindings: bindings({
      hardware: { id: "future-hardware-port", version: "1.0.0", profile: "hardware-facing-adapter-v1" },
    }),
  });
  const mismatchedBindings = bindings({
    hardware: { id: "other-hardware-port", version: "2.0.0", profile: "hardware-facing-adapter-v1" },
  });
  const mismatchDecision = classifyAuthoringTaskRecovery({
    record: hardwareRecord,
    availableAdapterBindings: mismatchedBindings,
    currentHeadRevisionId: baseRevision.revisionId,
    sourcePorts: [],
  });
  check("adapter id/version mismatch blocks recovery", mismatchDecision.kind === "BLOCKED_ADAPTER_MISMATCH",
    mismatchDecision.reasonCode);
  check("future hardware binding emits a ReleaseGate without core mutation",
    mismatchDecision.releaseGate.status === "BLOCKED"
      && mismatchDecision.releaseGate.coreMutation === "NONE"
      && mismatchDecision.releaseGate.requiredBindings.some((entry) => entry.name === "hardware"),
  JSON.stringify(mismatchDecision.releaseGate));
  check("recovery core remains target-neutral", !/"hardware"\s*:/u.test(JSON.stringify(hardwareRecord.sessionSnapshot))
    && !JSON.stringify(hardwareRecord.sessionSnapshot).includes("BOARD_TARGET"),
  "session snapshot contains no hardware target fields");

  const report = {
    schemaVersion: 1,
    profile: "companion-authoring-task-recovery-acceptance-v1",
    generatedAt: "2026-08-04T17:00:00.000Z",
    checksPassed: checks.length,
    checks,
    boundaries: {
      localRecord: "atomic replace and attempted file sync; no parent-directory fsync or power-loss guarantee",
      lock: "best-effort local lock file; no claim of a crash-proof cross-process lease",
      hardware: "target-neutral core; future hardware binding is ReleaseGate-blocked",
    },
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes, { flag: "wx" });
  console.log(`Authoring task recovery acceptance: ${checks.length}/${checks.length}`);
  console.log(`Authoring task recovery report SHA-256: ${sha256(reportBytes)}`);
}

try {
  if (process.argv[2] === "--child") await childMain(process.argv[3]);
  else await main();
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
}
