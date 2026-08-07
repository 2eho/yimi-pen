import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import { commitImportedClipReplacement } from "../authoring/family-authoring-use-case.mjs";
import { createLocalAuthoringTaskJournal } from "../authoring/local-authoring-task-journal.mjs";
import { createAuthoringProductReviewReceipt } from "../authoring/authoring-product-session-core.mjs";
import { createSystemTtsRequest } from "../authoring/tts-source-contract.mjs";
import { createDesktopAuthoringTaskService } from "./desktop-authoring-task-service.mjs";
import { assertDesktopAuthoringTaskView } from "./desktop-authoring-task-view.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BASE_REVISION_PATH = path.join(
  REPO_ROOT,
  "hardware/evt0/family-repository-v1/golden/family-revision.json",
);
const REPORT_ROOT = path.join(REPO_ROOT, "build/companion-desktop-authoring-task-validation");
const REPORT_PATH = path.join(REPORT_ROOT, "report.json");

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function eventually(predicate, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function makeBindings(suffix = "001") {
  return {
    source: { id: `desktop-source-${suffix}`, version: "1.0.0", profile: "authoring-source-adapter-v1" },
    permission: { id: `desktop-permission-${suffix}`, version: "1.0.0", profile: "authoring-permission-adapter-v1" },
    authoring: { id: `desktop-authoring-${suffix}`, version: "1.0.0", profile: "family-workspace-authoring-port-v1" },
    commitCommand: { id: `desktop-command-${suffix}`, version: "1.0.0", profile: "authoring-commit-command-port-v1" },
    review: { id: `desktop-review-${suffix}`, version: "1.0.0", profile: "authoring-review-port-v1" },
    hardware: null,
  };
}

function makeRepository(baseRevision) {
  let head = clone(baseRevision);
  const operations = new Map();
  return {
    async loadRevision(revisionId) {
      if (revisionId === head.revisionId) return clone(head);
      if (revisionId === baseRevision.revisionId) return clone(baseRevision);
      return null;
    },
    async commit({ operationId, revision, expectedHeadRevisionId }) {
      const prior = operations.get(operationId);
      if (prior) return clone(prior);
      if (expectedHeadRevisionId !== head.revisionId) {
        const error = new Error("fixture head changed");
        error.code = "STALE_HEAD";
        throw error;
      }
      const outcome = {
        status: "committed",
        replayed: false,
        headRevisionId: revision.revisionId,
        operationOutcomeHeadRevisionId: revision.revisionId,
      };
      head = clone(revision);
      operations.set(operationId, outcome);
      return clone(outcome);
    },
    loadHead() {
      return clone(head);
    },
  };
}

function makeFixturePorts({ baseRevision, sourceState, commitState, permissionState, reviewState }) {
  const repository = makeRepository(baseRevision);
  let commandOrdinal = 0;
  const sourcePort = {
    sourceKind: "FILE",
    requiredCapability: null,
    clipSourceKind: "family-recording",
    async acquire({ assetId, request, signal }) {
      sourceState.calls += 1;
      sourceState.lastRequest = clone(request);
      if (request?.mode === "failOnce" && sourceState.failOnce) {
        sourceState.failOnce = false;
        const error = new Error("fixture source failure");
        error.code = "FIXTURE_SOURCE_TRANSIENT";
        throw error;
      }
      if (request?.mode === "deferred") {
        sourceState.active = true;
        await new Promise((resolve) => {
          sourceState.release = resolve;
          signal?.addEventListener("abort", () => {
            sourceState.aborted = true;
            resolve();
          }, { once: true });
        });
        sourceState.active = false;
        if (signal?.aborted) {
          const error = new Error("fixture source aborted");
          error.code = "FIXTURE_SOURCE_ABORTED";
          throw error;
        }
      }
      const digest = canonicalSha256({ assetId, request }).sha256;
      return {
        importedAsset: {
          assetId,
          contentPath: `assets/sha256/${digest}.wav`,
          bytes: 128,
          sha256: digest,
          durationMs: 1000,
          codec: "WAV_PCM16_16K_MONO",
        },
      };
    },
  };

  const capturePort = {
    sourceKind: "CAPTURE",
    requiredCapability: "MICROPHONE",
    clipSourceKind: "family-recording",
    async acquire({ assetId, request }) {
      const digest = canonicalSha256({ assetId, request, sourceKind: "CAPTURE" }).sha256;
      return {
        importedAsset: {
          assetId,
          contentPath: `assets/sha256/${digest}.wav`,
          bytes: 128,
          sha256: digest,
          durationMs: 1000,
          codec: "WAV_PCM16_16K_MONO",
        },
      };
    },
  };

  const ttsPort = {
    sourceKind: "SYSTEM_TTS",
    requiredCapability: null,
    clipSourceKind: "system-tts",
    autoMetadataFromRequest(request) {
      return {
        sourceKind: "system-tts",
        transcript: request.transcript,
        mediaType: request.mediaType,
        language: request.language,
      };
    },
    async acquire({ assetId, request }) {
      const digest = canonicalSha256({ assetId, request, sourceKind: "SYSTEM_TTS" }).sha256;
      return {
        importedAsset: {
          assetId,
          contentPath: `assets/sha256/${digest}.wav`,
          bytes: 128,
          sha256: digest,
          durationMs: 1000,
          codec: "WAV_PCM16_16K_MONO",
        },
      };
    },
  };

  const permissionPort = {
    async resolve({ capability }) {
      const status = permissionState.statuses.shift() ?? "GRANTED";
      permissionState.calls += 1;
      return { capability, status, rawOsError: "SECRET-OS-PERMISSION-DIAGNOSTIC" };
    },
  };

  const authoringPort = {
    loadHead: async () => repository.loadHead(),
    async commitReplacement(command) {
      if (commitState.waitForCommit !== null) {
        commitState.entered.resolve();
        await commitState.waitForCommit.promise;
        commitState.waitForCommit = null;
      }
      return commitImportedClipReplacement({
        repository,
        ...command,
      });
    },
  };

  const commitCommandPort = {
    create({ target, importedAsset, clipMetadata }) {
      commandOrdinal += 1;
      const createdAt = new Date(Date.parse("2026-08-04T14:00:00.000Z") + commandOrdinal * 1_000).toISOString();
      return {
        operationId: `OP-DESKTOP-AUTHORING-${String(commandOrdinal).padStart(3, "0")}`,
        expectedHeadRevisionId: target.baseRevisionId,
        createdAt,
        committedAt: new Date(Date.parse(createdAt) + 500).toISOString(),
        contentRevision: `family-alpha-desktop@0.0.${commandOrdinal}`,
        bindingId: target.bindingId,
        clipId: target.clipId,
        importedAsset: clone(importedAsset),
        clipMetadata: clone(clipMetadata),
        sourceProducer: { name: "desktop-authoring-fixture", version: "1.0.0" },
      };
    },
  };

  const reviewPort = {
    async run(input) {
      reviewState.calls += 1;
      if (reviewState.blockFirst && reviewState.calls === 1) {
        reviewState.entered.resolve();
        await reviewState.wait.promise;
        reviewState.blockFirst = false;
      }
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
        buildPlanId: "PLAN-DESKTOP-AUTHORING-001",
        buildSubjectSha256: subject,
        previewId: `sha256:${canonicalSha256({ subject, kind: "preview" }).sha256}`,
        presentationTranscriptSha256: canonicalSha256({ subject, kind: "transcript" }).sha256,
        confirmationId: "CONF-DESKTOP-AUTHORING-001",
        authorizationId: `authorization:sha256:${canonicalSha256({ subject, kind: "authorization" }).sha256}`,
        fixtureOnly: true,
        completedAt: "2026-08-04T14:30:00.000Z",
      });
    },
  };

  return Object.freeze({
    repository,
    sourcePort: Object.freeze(sourcePort),
    capturePort: Object.freeze(capturePort),
    ttsPort: Object.freeze(ttsPort),
    permissionPort: Object.freeze(permissionPort),
    authoringPort: Object.freeze(authoringPort),
    commitCommandPort: Object.freeze(commitCommandPort),
    reviewPort: Object.freeze(reviewPort),
  });
}

function makeService({ journalRoot, ports, adapterBindings, authoringPort = ports.authoringPort }) {
  return createDesktopAuthoringTaskService({
    journal: createLocalAuthoringTaskJournal({ root: journalRoot }),
    authoringPort,
    sourcePorts: [ports.sourcePort, ports.capturePort, ports.ttsPort],
    permissionPort: ports.permissionPort,
    commitCommandPort: ports.commitCommandPort,
    reviewPort: ports.reviewPort,
    adapterBindings,
  });
}

function metadata(transcript) {
  return {
    sourceKind: "family-recording",
    transcript,
    mediaType: "voice",
    language: "zh-CN",
  };
}

async function run() {
  const baseRevision = JSON.parse(await readFile(BASE_REVISION_PATH, "utf8"));
  const root = await mkdtemp(path.join(os.tmpdir(), "yimi-desktop-authoring-"));
  const journalRoot = path.join(root, "journal");
  const sourceState = {
    calls: 0,
    lastRequest: null,
    failOnce: false,
    active: false,
    release: null,
    aborted: false,
  };
  const commitState = { waitForCommit: null, entered: deferred() };
  const permissionState = { calls: 0, statuses: [] };
  const reviewState = { calls: 0, blockFirst: false, entered: deferred(), wait: deferred() };
  const ports = makeFixturePorts({ baseRevision, sourceState, commitState, permissionState, reviewState });
  const bindings = makeBindings();
  const service = makeService({ journalRoot, ports, adapterBindings: bindings });
  const checks = [];
  const check = (name, passed, detail) => {
    if (!passed) throw new Error(`${name}: ${detail}`);
    checks.push({ name, passed: true, detail });
  };
  const target = baseRevision.bindings[0];
  const clip = target.clips[0];
  const task = (suffix) => `task-desktop-${suffix}`;
  const session = (suffix) => `session-desktop-${suffix}`;
  const disk = async (taskId) => (await service.journal.load(taskId)).record;
  const checkIdentity = async (view) => {
    const record = await disk(view.taskId);
    check(`disk identity ${view.taskId}`, record.recordId === view.recordId
      && record.journalRevision === view.journalRevision
      && record.expectedStateId === view.stateId
      && record.sessionSnapshot.sessionRevision === view.sessionRevision,
    `${view.recordId}/${view.journalRevision}/${view.stateId}`);
    return record;
  };
  const checkPrivateBoundary = (view) => {
    const encoded = JSON.stringify(view);
    assertDesktopAuthoringTaskView(view);
    check(`private boundary ${view.taskId}`, !encoded.includes("sourceRequest")
      && !encoded.includes("sourcePath")
      && !encoded.includes("contentPath")
      && !encoded.includes("deviceName")
    && !encoded.includes("SECRET"), "renderer projection is whitelisted");
  };

  let missingAdapterBindingsCode = null;
  try {
    createDesktopAuthoringTaskService({
      journal: service.journal,
      authoringPort: ports.authoringPort,
      sourcePorts: [ports.sourcePort, ports.capturePort, ports.ttsPort],
      permissionPort: ports.permissionPort,
      commitCommandPort: ports.commitCommandPort,
      reviewPort: ports.reviewPort,
    });
  } catch (error) {
    missingAdapterBindingsCode = error.code;
  }
  check("service construction requires explicit adapter bindings",
    missingAdapterBindingsCode === "DESKTOP_AUTHORING_TASK_ADAPTER_BINDINGS_REQUIRED",
    missingAdapterBindingsCode ?? "no error");

  try {
    let view = await service.createTask({
      taskId: task("fresh"),
      sessionId: session("fresh"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    check("fresh task is durable before first view", view.phase === "AWAITING_SOURCE" && view.journalRevision === 0,
      `${view.phase}/${view.journalRevision}`);
    await checkIdentity(view);

    const restartBeforeSource = task("restart-before-source");
    await service.createTask({
      taskId: restartBeforeSource,
      sessionId: session("restart-before-source"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    const restartedBeforeSource = makeService({ journalRoot, ports, adapterBindings: bindings });
    view = await restartedBeforeSource.resumeTask(restartBeforeSource);
    check("restart before first source is explicit action-required state",
      view.lifecycle === "ACTIVE"
      && view.phase === "AWAITING_SOURCE"
      && view.attention?.kind === "ACTION_REQUIRED"
      && view.attention.reasonCode === "SOURCE_SELECTION_MISSING"
      && view.attention.actionId === "ABANDON_TASK"
      && view.commands.canAbandon === true
      && view.commands.canSelectSource === false,
    JSON.stringify(view.attention));
    view = await restartedBeforeSource.abandon(restartBeforeSource, {
      expected: {
        recordId: view.recordId,
        stateId: view.stateId,
        journalRevision: view.journalRevision,
      },
      reason: "USER_ABANDONED",
    });
    check("active action-required task exposes CAS abandon and then becomes terminal",
      view.lifecycle === "ABANDONED"
      && view.attention?.kind === "TERMINAL"
      && view.commands.canAbandon === false
      && view.attention.coreMutation === "NONE",
    JSON.stringify(view.attention));
    await checkIdentity(view);
    const terminalRevision = view.journalRevision;
    const terminalAgain = await restartedBeforeSource.abandon(restartBeforeSource);
    check("already abandoned record remains terminal and read-only",
      terminalAgain.lifecycle === "ABANDONED"
      && terminalAgain.attention?.kind === "TERMINAL"
      && terminalAgain.journalRevision === terminalRevision,
    `${terminalAgain.lifecycle}/${terminalAgain.journalRevision}`);

    const malformedEntries = [
      ["createTask", () => service.createTask(null)],
      ["resumeTask", () => service.resumeTask(null)],
      ["getView", () => service.getView(null)],
      ["selectSource", () => service.selectSource(null)],
      ["submitMetadata", () => service.submitMetadata(null)],
      ["retry", () => service.retry(null)],
      ["acquire", () => service.acquire(null)],
      ["commit", () => service.commit(null)],
      ["review", () => service.review(null)],
      ["cancel", () => service.cancel(null)],
      ["abandon", () => service.abandon(null)],
      ["command", () => service.command(null)],
    ];
    for (const [name, invoke] of malformedEntries) {
      let malformedPromise = null;
      let threwSynchronously = false;
      try {
        malformedPromise = invoke();
      } catch {
        threwSynchronously = true;
      }
      check(`${name} malformed input returns Promise`, !threwSynchronously
        && malformedPromise !== null && typeof malformedPromise?.then === "function", "synchronous throw");
      try { await malformedPromise; } catch { /* expected rejected Promise */ }
    }

    let perTaskBindingCode = null;
    try {
      await service.createTask({
        taskId: task("per-task-binding-mismatch"),
        sessionId: session("per-task-binding-mismatch"),
        bindingId: target.bindingId,
        clipId: clip.clipId,
        adapterBindings: makeBindings("per-task"),
      });
    } catch (error) {
      perTaskBindingCode = error.code;
    }
    check("per-task adapter binding override cannot hide composition mismatch",
      perTaskBindingCode === "DESKTOP_AUTHORING_TASK_ADAPTER_BINDINGS_MISMATCH",
    perTaskBindingCode ?? "no error");

    const sourceRequest = { sourcePath: "TARGET/fixture.wav", mode: "normal", deviceName: "SECRET-MIC" };
    view = await service.selectSource(task("fresh"), {
      sourceKind: "FILE",
      assetId: "asset-desktop-fresh-001",
      request: sourceRequest,
    });
    check("source selection synchronously persists", view.phase === "READY_TO_ACQUIRE" && view.selection.assetId === "asset-desktop-fresh-001",
      `${view.phase}/${view.selection.assetId}`);
    const selectedRecord = await checkIdentity(view);
    check("exact private source request is durable",
      canonicalSha256(selectedRecord.recoveryContext.sourceRequest).sha256 === canonicalSha256(sourceRequest).sha256,
      "journal retained the exact adapter request");
    checkPrivateBoundary(view);

    const restarted = makeService({ journalRoot, ports, adapterBindings: bindings });
    view = await restarted.resumeTask(task("fresh"));
    check("source selection restores after restart", view.phase === "READY_TO_ACQUIRE"
      && view.selection.assetId === "asset-desktop-fresh-001" && view.attention === null,
    `${view.phase}/${view.attention?.kind ?? "none"}`);
    await checkIdentity(view);
    view = await restarted.acquire(task("fresh"));
    check("async source settlement remains durable", view.phase === "AWAITING_METADATA" && view.facts.importedAssetPublished,
      `${view.phase}/${view.facts.importedAssetPublished}`);
    await checkIdentity(view);
    view = await restarted.submitMetadata(task("fresh"), metadata("fresh metadata"));
    check("metadata response restores READY_TO_COMMIT", view.phase === "READY_TO_COMMIT" && view.metadata.transcript === "fresh metadata",
      `${view.phase}/${view.metadata.transcript}`);
    check("renderer metadata uses the trusted whitelist",
      JSON.stringify(Object.keys(view.metadata).sort()) === JSON.stringify(["language", "mediaType", "sourceKind", "transcript"]),
    JSON.stringify(Object.keys(view.metadata)));
    await checkIdentity(view);

    view = await restarted.commit(task("fresh"));
    check("content revision saved is distinct from authorization facts", view.phase === "READY_TO_REVIEW"
      && view.facts.contentRevisionSaved === true
      && view.facts.buildAuthorized === false
      && view.facts.offlineReady === false,
    JSON.stringify(view.facts));
    check("renderer committed revision uses the trusted whitelist",
      JSON.stringify(Object.keys(view.committedRevision).sort()) === JSON.stringify([
        "contentRevision", "familyLibraryId", "parentRevisionId", "revisionId", "revisionNumber",
      ]),
    JSON.stringify(Object.keys(view.committedRevision ?? {})));
    view = await restarted.review(task("fresh"));
    check("terminal facts stay distinct and hardware remains unresolved", view.phase === "COMPLETED"
      && view.facts.reviewReceiptPresent
      && view.facts.buildAuthorized === false
      && view.facts.offlineReady === false
      && view.facts.deviceInstall.status === "UNRESOLVED"
      && view.facts.deviceInstall.hardwareImpact === "NONE",
    JSON.stringify(view.facts));
    checkPrivateBoundary(view);

    sourceState.failOnce = true;
    view = await service.createTask({
      taskId: task("retry"), sessionId: session("retry"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    await service.selectSource(task("retry"), {
      sourceKind: "FILE", assetId: "asset-desktop-retry-001", request: { sourcePath: "TARGET/retry.wav", mode: "failOnce" },
    });
    view = await service.acquire(task("retry"));
    check("source failure is persisted", view.phase === "FAILED" && view.failure.retryable === true, view.phase);
    const failedRevision = view.journalRevision;
    view = await service.retry(task("retry"));
    check("retry mutation is persisted", view.phase === "READY_TO_ACQUIRE" && view.journalRevision > failedRevision,
      `${view.phase}/${view.journalRevision}/${failedRevision}`);
    await checkIdentity(view);

    await service.createTask({
      taskId: task("payload-flight"),
      sessionId: session("payload-flight"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    const payloadA = {
      sourceKind: "FILE",
      assetId: "asset-desktop-payload-001",
      request: { sourcePath: "TARGET/payload.wav", mode: "normal" },
    };
    const payloadSameCanonicalOrder = {
      request: { mode: "normal", sourcePath: "TARGET/payload.wav" },
      assetId: "asset-desktop-payload-001",
      sourceKind: "FILE",
    };
    const firstPayloadPromise = service.selectSource(task("payload-flight"), payloadA);
    const samePayloadPromise = service.selectSource(task("payload-flight"), payloadSameCanonicalOrder);
    const differentPayloadPromise = service.selectSource(task("payload-flight"), {
      ...payloadA,
      assetId: "asset-desktop-payload-002",
    });
    check("canonical same-command same-payload calls share exact Promise",
      firstPayloadPromise === samePayloadPromise,
    "canonical payload identity was not reused");
    let differentPayloadCode = null;
    let differentPayloadPrivateLeak = false;
    try {
      await differentPayloadPromise;
    } catch (error) {
      differentPayloadCode = error.code;
      differentPayloadPrivateLeak = JSON.stringify(error).includes("TARGET/payload.wav");
    }
    check("same-command different-payload call is BUSY without payload leakage",
      differentPayloadCode === "DESKTOP_AUTHORING_TASK_BUSY" && differentPayloadPrivateLeak === false,
    `${differentPayloadCode ?? "no error"}/${differentPayloadPrivateLeak}`);
    view = await firstPayloadPromise;
    check("payload-fingerprinted source mutation still persists", view.phase === "READY_TO_ACQUIRE",
      view.phase);
    await checkIdentity(view);

    view = await service.createTask({
      taskId: task("single-flight"), sessionId: session("single-flight"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    await service.selectSource(task("single-flight"), {
      sourceKind: "FILE", assetId: "asset-desktop-single-001", request: { sourcePath: "TARGET/deferred.wav", mode: "deferred" },
    });
    const acquirePromise = service.acquire(task("single-flight"));
    const duplicatePromise = service.acquire(task("single-flight"));
    check("duplicate command replays the same Promise", acquirePromise === duplicatePromise, "same in-flight identity");
    await eventually(() => sourceState.active, "deferred source effect");
    view = await service.getView(task("single-flight"));
    check("async start checkpoint is durable", view.phase === "ACQUIRING_SOURCE", view.phase);
    await checkIdentity(view);
    let overlapCode = null;
    try { await service.submitMetadata(task("single-flight"), metadata("overlap")); } catch (error) { overlapCode = error.code; }
    check("overlap command is blocked", overlapCode === "DESKTOP_AUTHORING_TASK_BUSY", overlapCode ?? "no error");
    sourceState.release();
    view = await acquirePromise;
    check("async settlement returns canonical view", view.phase === "AWAITING_METADATA", view.phase);
    await checkIdentity(view);

    permissionState.statuses.push("DENIED");
    view = await service.createTask({
      taskId: task("permission-denied"), sessionId: session("permission-denied"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    await service.selectSource(task("permission-denied"), {
      sourceKind: "CAPTURE", assetId: "asset-desktop-permission-denied", request: { device: "SECRET-MIC", seconds: 1 },
    });
    view = await service.acquire(task("permission-denied"));
    check("permission DENIED projects deterministic settings guidance",
      view.phase === "FAILED"
      && view.permission?.status === "DENIED"
      && view.permission.guidance?.kind === "SETTINGS"
      && view.permission.guidance.actionId === "CHECK_OS_PERMISSION_SETTINGS"
      && view.permission.guidance.canTriggerNativePrompt === false
      && view.commands.canRetry === true
      && !JSON.stringify(view).includes("SECRET-OS-PERMISSION-DIAGNOSTIC"),
    JSON.stringify(view.permission));

    permissionState.statuses.push("UNAVAILABLE");
    view = await service.createTask({
      taskId: task("permission-unavailable"), sessionId: session("permission-unavailable"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    await service.selectSource(task("permission-unavailable"), {
      sourceKind: "CAPTURE", assetId: "asset-desktop-permission-unavailable", request: { device: "SECRET-MIC", seconds: 1 },
    });
    view = await service.acquire(task("permission-unavailable"));
    check("permission UNAVAILABLE projects the same public settings boundary",
      view.phase === "FAILED"
      && view.permission?.status === "UNAVAILABLE"
      && view.permission.guidance?.actionId === "CHECK_OS_PERMISSION_SETTINGS"
      && view.permission.guidance.canTriggerNativePrompt === false
      && !JSON.stringify(view).includes("SECRET-OS-PERMISSION-DIAGNOSTIC"),
    JSON.stringify(view.permission));

    const ttsRequest = createSystemTtsRequest({
      transcript: "系统语音自动元数据持久化。",
      language: "zh-CN",
    });
    view = await service.createTask({
      taskId: task("tts-auto-metadata"), sessionId: session("tts-auto-metadata"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    view = await service.selectSource(task("tts-auto-metadata"), {
      sourceKind: "SYSTEM_TTS", assetId: "asset-desktop-tts-001", request: ttsRequest,
    });
    check("TTS selection is durable before synthesis", view.phase === "READY_TO_ACQUIRE"
      && view.selection.clipSourceKind === "system-tts", `${view.phase}/${view.selection.clipSourceKind}`);
    view = await service.acquire(task("tts-auto-metadata"));
    const ttsRecord = await checkIdentity(view);
    check("TTS auto-metadata is durably submitted by the desktop service",
      view.phase === "READY_TO_COMMIT"
      && view.metadata?.sourceKind === "system-tts"
      && view.metadata?.transcript === ttsRequest.transcript
      && canonicalSha256(ttsRecord.recoveryContext.sourceRequest).sha256 === canonicalSha256(ttsRequest).sha256,
    `${view.phase}/${view.metadata?.transcript}`);

    view = await service.createTask({
      taskId: task("committing"), sessionId: session("committing"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    await service.selectSource(task("committing"), {
      sourceKind: "FILE", assetId: "asset-desktop-committing-001", request: { sourcePath: "TARGET/commit.wav" },
    });
    await service.acquire(task("committing"));
    await service.submitMetadata(task("committing"), metadata("commit barrier"));
    commitState.entered = deferred();
    commitState.waitForCommit = deferred();
    const commitPromise = service.commit(task("committing"));
    await commitState.entered.promise;
    view = await service.getView(task("committing"));
    const committingRecord = await disk(task("committing"));
    check("COMMITTING is non-cancellable with frozen command", view.phase === "COMMITTING"
      && view.commands.canCancel === false
      && view.commands.canAbandon === false
      && committingRecord.sessionSnapshot.commitCommand !== null,
    `${view.phase}/${view.commands.canCancel}`);
    let barrierCode = null;
    try { await service.cancel(task("committing")); } catch (error) { barrierCode = error.code; }
    check("COMMITTING cancel is blocked by truth barrier", barrierCode === "AUTHORING_SESSION_COMMIT_BARRIER", barrierCode ?? "no error");
    const committingBeforeRestartAbandon = await disk(task("committing"));
    const committingRestart = makeService({ journalRoot, ports, adapterBindings: bindings });
    const restartedCommittingView = await committingRestart.getView(task("committing"));
    check("restarted COMMITTING view does not advertise abandon", restartedCommittingView.phase === "COMMITTING"
      && restartedCommittingView.recoveryDecision?.kind === "REPLAY_FROZEN_COMMIT"
      && restartedCommittingView.commands.canAbandon === false,
    `${restartedCommittingView.phase}/${restartedCommittingView.commands.canAbandon}`);
    let restartAbandonCode = null;
    let restartAbandonView = null;
    try {
      await committingRestart.abandon(task("committing"));
    } catch (error) {
      restartAbandonCode = error.code;
      restartAbandonView = error.view ?? null;
    }
    const committingAfterRestartAbandon = await disk(task("committing"));
    check("restarted COMMITTING task cannot be tombstoned by abandon",
      restartAbandonCode === "AUTHORING_SESSION_COMMIT_BARRIER"
      && restartAbandonView?.phase === "COMMITTING"
      && restartAbandonView.lifecycle === "ACTIVE"
      && committingAfterRestartAbandon.recordId === committingBeforeRestartAbandon.recordId
      && committingAfterRestartAbandon.journalRevision === committingBeforeRestartAbandon.journalRevision,
    `${restartAbandonCode ?? "no error"}/${restartAbandonView?.phase ?? "no view"}`);
    commitState.waitForCommit.resolve();
    view = await commitPromise;
    check("commit settles to persisted READY_TO_REVIEW", view.phase === "READY_TO_REVIEW" && view.facts.contentRevisionSaved, view.phase);
    await checkIdentity(view);

    view = await service.createTask({
      taskId: task("review-retry"), sessionId: session("review-retry"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    await service.selectSource(task("review-retry"), {
      sourceKind: "FILE", assetId: "asset-desktop-review-retry-001", request: { sourcePath: "TARGET/review-retry.wav" },
    });
    await service.acquire(task("review-retry"));
    await service.submitMetadata(task("review-retry"), metadata("review interruption"));
    view = await service.commit(task("review-retry"));
    const committedRevisionBeforeReviewRetry = view.committedRevision.revisionId;
    reviewState.calls = 0;
    reviewState.blockFirst = true;
    reviewState.entered = deferred();
    reviewState.wait = deferred();
    const interruptedReview = service.review(task("review-retry"));
    await reviewState.entered.promise;
    const interruptedRecord = await disk(task("review-retry"));
    check("review interruption leaves REVIEWING with durable revision", interruptedRecord.sessionSnapshot.phase === "REVIEWING"
      && interruptedRecord.sessionSnapshot.committedRevision.revisionId === committedRevisionBeforeReviewRetry,
    `${interruptedRecord.sessionSnapshot.phase}/${interruptedRecord.sessionSnapshot.committedRevision?.revisionId}`);
    const reviewRestart = makeService({ journalRoot, ports, adapterBindings: bindings });
    view = await reviewRestart.resumeTask(task("review-retry"));
    check("review restart projects a fresh retry over the same durable revision",
      view.phase === "READY_TO_REVIEW"
      && view.committedRevision.revisionId === committedRevisionBeforeReviewRetry
      && view.facts.contentRevisionSaved === true,
    `${view.phase}/${view.committedRevision?.revisionId}`);
    reviewState.wait.resolve();
    let interruptedReviewCode = null;
    try { await interruptedReview; } catch (error) { interruptedReviewCode = error.code; }
    check("interrupted review writer cannot overwrite fresh retry state",
      ["AUTHORING_TASK_JOURNAL_CAS_CONFLICT", "DESKTOP_AUTHORING_TASK_PERSISTENCE_DRIFT"].includes(interruptedReviewCode),
    interruptedReviewCode ?? "no error");
    view = await reviewRestart.review(task("review-retry"));
    check("fresh review retry completes from the same durable revision",
      view.phase === "COMPLETED"
      && view.committedRevision.revisionId === committedRevisionBeforeReviewRetry,
    `${view.phase}/${view.committedRevision?.revisionId}`);

    view = await service.createTask({
      taskId: task("stale"), sessionId: session("stale"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    await service.selectSource(task("stale"), {
      sourceKind: "FILE", assetId: "asset-desktop-stale-001", request: { sourcePath: "TARGET/stale.wav" },
    });
    const newer = makeService({ journalRoot, ports, adapterBindings: bindings });
    await newer.resumeTask(task("stale"));
    await newer.acquire(task("stale"));
    await newer.submitMetadata(task("stale"), metadata("newer writer"));
    let staleCode = null;
    let staleConflictView = null;
    try { await service.abandon(task("stale")); } catch (error) {
      staleCode = error.code;
      staleConflictView = error.view ?? null;
    }
    check("CAS stale abandon cannot overwrite newer record", staleCode === "AUTHORING_TASK_JOURNAL_CAS_CONFLICT", staleCode ?? "no error");
    const staleAfter = await disk(task("stale"));
    check("stale abandon leaves newer record intact", staleAfter.sessionSnapshot.phase === "READY_TO_COMMIT", staleAfter.sessionSnapshot.phase);
    check("stale abandon exposes the newer-writer conflict view",
      staleConflictView?.attention?.kind === "CONFLICT"
      && staleConflictView.attention.reasonCode === "LIVE_JOURNAL_CAS_CONFLICT"
      && staleConflictView.attention.coreMutation === "NONE"
      && staleConflictView.selection.assetId === "asset-desktop-stale-001",
    JSON.stringify(staleConflictView?.attention));

    await service.createTask({
      taskId: task("cached-command"),
      sessionId: session("cached-command"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    await service.selectSource(task("cached-command"), {
      sourceKind: "FILE",
      assetId: "asset-desktop-cached-command-old",
      request: { sourcePath: "TARGET/cached-command-old.wav" },
    });
    const cachedCommandWriter = makeService({ journalRoot, ports, adapterBindings: bindings });
    await cachedCommandWriter.resumeTask(task("cached-command"));
    await cachedCommandWriter.selectSource(task("cached-command"), {
      sourceKind: "FILE",
      assetId: "asset-desktop-cached-command-new",
      request: { sourcePath: "TARGET/cached-command-new.wav" },
    });
    view = await service.acquire(task("cached-command"));
    check("cached command handle resumes the canonical same-head writer", view.selection?.assetId === "asset-desktop-cached-command-new"
      && sourceState.lastRequest?.sourcePath === "TARGET/cached-command-new.wav",
    `${view.selection?.assetId}/${sourceState.lastRequest?.sourcePath}`);
    const cachedCommandAfter = await checkIdentity(view);
    check("cached command does not replay stale source request", cachedCommandAfter.recoveryContext.sourceRequest.sourcePath === "TARGET/cached-command-new.wav",
      cachedCommandAfter.recoveryContext.sourceRequest.sourcePath);

    await service.createTask({
      taskId: task("cached-create"),
      sessionId: session("cached-create"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    await service.selectSource(task("cached-create"), {
      sourceKind: "FILE",
      assetId: "asset-desktop-cached-create-old",
      request: { sourcePath: "TARGET/cached-create-old.wav" },
    });
    const cachedCreateWriter = makeService({ journalRoot, ports, adapterBindings: bindings });
    await cachedCreateWriter.resumeTask(task("cached-create"));
    await cachedCreateWriter.selectSource(task("cached-create"), {
      sourceKind: "FILE",
      assetId: "asset-desktop-cached-create-new",
      request: { sourcePath: "TARGET/cached-create-new.wav" },
    });
    view = await service.createTask({
      taskId: task("cached-create"),
      sessionId: session("cached-create-replay"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    check("existing live create reopens a canonical newer record", view.selection?.assetId === "asset-desktop-cached-create-new"
      && view.attention === null, `${view.selection?.assetId}/${view.attention?.kind ?? "none"}`);
    const cachedCreateAfter = await checkIdentity(view);
    check("existing live create preserves the newer source request", cachedCreateAfter.recoveryContext.sourceRequest.sourcePath === "TARGET/cached-create-new.wav",
      cachedCreateAfter.recoveryContext.sourceRequest.sourcePath);

    const syncConflictWriter = makeService({ journalRoot, ports, adapterBindings: bindings });
    const syncRaceState = { enabled: false, triggered: false };
    const syncRaceAuthoringPort = {
      ...ports.authoringPort,
      async loadHead() {
        const head = await ports.authoringPort.loadHead();
        if (syncRaceState.enabled && !syncRaceState.triggered) {
          syncRaceState.triggered = true;
          await syncConflictWriter.selectSource(task("sync-conflict"), {
            sourceKind: "FILE",
            assetId: "asset-desktop-sync-conflict-new",
            request: { sourcePath: "TARGET/sync-new.wav" },
          });
        }
        return head;
      },
    };
    const syncConflictService = makeService({
      journalRoot,
      ports,
      authoringPort: syncRaceAuthoringPort,
      adapterBindings: bindings,
    });
    await syncConflictService.createTask({
      taskId: task("sync-conflict"),
      sessionId: session("sync-conflict"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    await syncConflictService.selectSource(task("sync-conflict"), {
      sourceKind: "FILE",
      assetId: "asset-desktop-sync-conflict-old",
      request: { sourcePath: "TARGET/sync-old.wav" },
    });
    await syncConflictWriter.resumeTask(task("sync-conflict"));
    syncRaceState.enabled = true;
    view = await syncConflictService.selectSource(task("sync-conflict"), {
      sourceKind: "FILE",
      assetId: "asset-desktop-sync-conflict-late",
      request: { sourcePath: "TARGET/sync-late.wav" },
    });
    check("live synchronous CAS conflict returns read-only canonical view",
      view.attention?.kind === "CONFLICT"
      && view.attention.reasonCode === "LIVE_JOURNAL_CAS_CONFLICT"
      && view.attention.coreMutation === "NONE"
      && view.selection.assetId === "asset-desktop-sync-conflict-new",
    JSON.stringify(view.attention));
    const syncConflictAfter = await checkIdentity(view);
    check("live CAS conflict keeps newer disk writer and rejects stale mutation",
      syncConflictAfter.sessionSnapshot.selection.assetId === "asset-desktop-sync-conflict-new"
      && syncConflictAfter.recoveryContext.sourceRequest.sourcePath === "TARGET/sync-new.wav"
      && syncConflictAfter.recoveryContext.sourceRequest.sourcePath !== "TARGET/sync-late.wav",
    syncConflictAfter.recoveryContext.sourceRequest.sourcePath);

    const conflictA = await service.createTask({
      taskId: task("conflict-a"), sessionId: session("conflict-a"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    await service.selectSource(task("conflict-a"), {
      sourceKind: "FILE", assetId: "asset-desktop-conflict-a", request: { sourcePath: "TARGET/conflict-a.wav" },
    });
    await service.acquire(task("conflict-a"));
    await service.submitMetadata(task("conflict-a"), metadata("conflict-a"));
    await service.createTask({
      taskId: task("conflict-b"), sessionId: session("conflict-b"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    await service.selectSource(task("conflict-b"), {
      sourceKind: "FILE", assetId: "asset-desktop-conflict-b", request: { sourcePath: "TARGET/conflict-b.wav" },
    });
    await service.acquire(task("conflict-b"));
    await service.submitMetadata(task("conflict-b"), metadata("conflict-b"));
    await service.commit(task("conflict-b"));
    const conflictCreateBefore = await disk(task("conflict-a"));
    view = await service.createTask({
      taskId: task("conflict-a"),
      sessionId: session("conflict-a-replay"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    check("existing live create reclassifies changed-head conflict", view.attention?.kind === "CONFLICT"
      && view.attention.reasonCode === "BASE_HEAD_CHANGED"
      && view.attention.coreMutation === "NONE",
    JSON.stringify(view.attention));
    const conflictCreateAfter = await disk(task("conflict-a"));
    check("existing live create leaves changed-head disk identity intact", conflictCreateAfter.recordId === conflictCreateBefore.recordId
      && conflictCreateAfter.journalRevision === conflictCreateBefore.journalRevision,
    `${conflictCreateAfter.recordId}/${conflictCreateAfter.journalRevision}`);
    const conflictReader = makeService({ journalRoot, ports, adapterBindings: bindings });
    view = await conflictReader.resumeTask(task("conflict-a"));
    check("head conflict projects read-only attention", view.attention?.kind === "CONFLICT" && view.attention.coreMutation === "NONE",
      JSON.stringify(view.attention));
    const conflictRecord = await disk(task("conflict-a"));
    check("conflict attention preserves core identity", conflictRecord.sessionSnapshot.phase === "READY_TO_COMMIT", conflictRecord.sessionSnapshot.phase);

    const mismatchBindings = makeBindings("mismatch");
    const mismatchReader = makeService({ journalRoot, ports, adapterBindings: mismatchBindings });
    view = await mismatchReader.resumeTask(task("stale"));
    check("adapter mismatch projects read-only attention", view.attention?.kind === "ADAPTER_MISMATCH"
      && view.attention.coreMutation === "NONE", JSON.stringify(view.attention));
    const mismatchBefore = await disk(task("stale"));
    view = await mismatchReader.getView(task("stale"));
    check("getView reclassifies adapter mismatch after restart without mutation",
      view.attention?.kind === "ADAPTER_MISMATCH" && view.attention.coreMutation === "NONE",
    JSON.stringify(view.attention));
    const mismatchList = await mismatchReader.listTasks();
    const mismatchListed = mismatchList.find((candidate) => candidate.taskId === task("stale"));
    check("listTasks reclassifies adapter mismatch without mutation",
      mismatchListed?.attention?.kind === "ADAPTER_MISMATCH" && mismatchListed.attention.coreMutation === "NONE",
    JSON.stringify(mismatchListed?.attention));
    view = await mismatchReader.abandon(task("stale"));
    check("abandon under adapter mismatch is read-only",
      view.attention?.kind === "ADAPTER_MISMATCH" && view.attention.coreMutation === "NONE",
    JSON.stringify(view.attention));
    const mismatchAfter = await disk(task("stale"));
    check("adapter mismatch abandon preserves disk identity",
      mismatchAfter.recordId === mismatchBefore.recordId
      && mismatchAfter.journalRevision === mismatchBefore.journalRevision,
    `${mismatchAfter.recordId}/${mismatchAfter.journalRevision}`);

    const conflictBefore = await disk(task("conflict-a"));
    view = await conflictReader.getView(task("conflict-a"));
    check("getView reclassifies changed-head conflict without mutation",
      view.attention?.kind === "CONFLICT" && view.attention.reasonCode === "BASE_HEAD_CHANGED"
        && view.attention.coreMutation === "NONE",
    JSON.stringify(view.attention));
    const conflictList = await conflictReader.listTasks();
    const conflictListed = conflictList.find((candidate) => candidate.taskId === task("conflict-a"));
    check("listTasks reclassifies changed-head conflict without mutation",
      conflictListed?.attention?.kind === "CONFLICT" && conflictListed.attention.reasonCode === "BASE_HEAD_CHANGED",
    JSON.stringify(conflictListed?.attention));
    view = await conflictReader.abandon(task("conflict-a"));
    check("abandon under changed-head conflict is read-only",
      view.attention?.kind === "CONFLICT" && view.attention.reasonCode === "BASE_HEAD_CHANGED"
        && view.attention.coreMutation === "NONE",
    JSON.stringify(view.attention));
    const conflictAfter = await disk(task("conflict-a"));
    check("changed-head conflict abandon preserves disk identity",
      conflictAfter.recordId === conflictBefore.recordId
      && conflictAfter.journalRevision === conflictBefore.journalRevision,
    `${conflictAfter.recordId}/${conflictAfter.journalRevision}`);

    view = await service.createTask({
      taskId: task("abandon"), sessionId: session("abandon"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    view = await service.abandon(task("abandon"), { reason: "USER_ABANDONED" });
    check("abandon is a terminal read-only projection", view.attention?.kind === "TERMINAL"
      && view.lifecycle === "ABANDONED" && view.attention.coreMutation === "NONE", JSON.stringify(view.attention));

    const raceOriginalHead = await ports.authoringPort.loadHead();
    await service.createTask({
      taskId: task("abandon-head-race"),
      sessionId: session("abandon-head-race"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    await service.createTask({
      taskId: task("abandon-head-race-writer"),
      sessionId: session("abandon-head-race-writer"),
      bindingId: target.bindingId,
      clipId: clip.clipId,
    });
    await service.selectSource(task("abandon-head-race-writer"), {
      sourceKind: "FILE",
      assetId: "asset-desktop-abandon-head-race-writer",
      request: { sourcePath: "TARGET/abandon-head-race-writer.wav" },
    });
    await service.acquire(task("abandon-head-race-writer"));
    await service.submitMetadata(task("abandon-head-race-writer"), metadata("abandon head race writer"));
    await service.commit(task("abandon-head-race-writer"));
    const raceState = { enabled: false, reads: 0 };
    const raceAuthoringPort = {
      ...ports.authoringPort,
      async loadHead() {
        const actual = await ports.authoringPort.loadHead();
        if (!raceState.enabled) return actual;
        raceState.reads += 1;
        return raceState.reads === 1 ? clone(raceOriginalHead) : actual;
      },
    };
    const raceService = makeService({
      journalRoot,
      ports,
      authoringPort: raceAuthoringPort,
      adapterBindings: bindings,
    });
    const raceBefore = await disk(task("abandon-head-race"));
    raceState.enabled = true;
    view = await raceService.abandon(task("abandon-head-race"));
    check("abandon final head recheck projects read-only conflict", view.attention?.kind === "CONFLICT"
      && view.attention.reasonCode === "BASE_HEAD_CHANGED"
      && view.attention.coreMutation === "NONE"
      && raceState.reads === 2,
    `${view.attention?.reasonCode ?? "none"}/${raceState.reads}`);
    const raceAfter = await disk(task("abandon-head-race"));
    check("abandon head race performs no journal write", raceAfter.recordId === raceBefore.recordId
      && raceAfter.journalRevision === raceBefore.journalRevision
      && raceAfter.lifecycle === "ACTIVE",
    `${raceAfter.recordId}/${raceAfter.journalRevision}/${raceAfter.lifecycle}`);

    view = await service.createTask({
      taskId: task("corrupt"), sessionId: session("corrupt"), bindingId: target.bindingId, clipId: clip.clipId,
    });
    const corruptFile = path.join(journalRoot, `task-${sha256(Buffer.from(task("corrupt"), "utf8"))}.json`);
    await writeFile(corruptFile, Buffer.from("{not-canonical-json}\n", "utf8"));
    const corruptReader = makeService({ journalRoot, ports, adapterBindings: bindings });
    view = await corruptReader.getView(task("corrupt"));
    check("journal corruption projects read-only attention", view.attention?.kind === "JOURNAL_CORRUPTION"
      && view.attention.coreMutation === "NONE" && view.recordId === null, JSON.stringify(view.attention));

    const taskViews = await service.listTasks();
    check("task-list retention and sorting remain explicitly unknown",
      Array.isArray(taskViews) && taskViews.every((candidate) => candidate.profile === "desktop-authoring-task-view-v1"),
    "task list must remain a projection without product ordering claims");

    const report = {
      profile: "desktop-authoring-task-acceptance-v1",
      checks: checks.length,
      passed: checks.length,
      failed: 0,
      hardwareImpact: "NONE",
      boardTarget: "UNRESOLVED",
      taskListPolicy: { retention: "UNKNOWN", sorting: "UNKNOWN" },
      reportPath: REPORT_PATH,
      checksDetail: checks,
    };
    await mkdir(REPORT_ROOT, { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`DESKTOP_AUTHORING_TASK_ACCEPTANCE ${checks.length}/${checks.length}`);
    return report;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  console.error(`DESKTOP_AUTHORING_TASK_ACCEPTANCE FAILED: ${error?.stack ?? error}`);
  process.exitCode = 1;
}
