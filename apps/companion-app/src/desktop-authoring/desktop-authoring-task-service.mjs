import { randomUUID } from "node:crypto";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import {
  AUTHORING_PRODUCT_SESSION_PHASES,
  createAuthoringProductSessionState,
} from "../authoring/authoring-product-session-core.mjs";
import {
  authoringTaskRecoveryCASExpectation,
  classifyAuthoringTaskRecovery,
  createAuthoringTaskRecoveryRecordFromSession,
  openAuthoringTaskRecovery,
  saveAuthoringTaskRecoverySnapshot,
} from "../authoring/authoring-task-recovery.mjs";
import { normalizeAuthoringTaskRecoveryAdapterBindings as normalizeRecoveryAdapterBindings } from "../authoring/authoring-task-recovery-contract.mjs";
import { openAuthoringProductSession } from "../authoring/authoring-product-session.mjs";
import { projectDesktopAuthoringTaskView } from "./desktop-authoring-task-view.mjs";

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@_-]{1,127}$/u;
const SOURCE_KIND = /^[A-Z][A-Z0-9_]{1,47}$/u;
const ASSET_ID = /^asset-[a-z0-9][a-z0-9._-]{2,95}$/u;
const ASYNC_COMMANDS = new Set(["acquire", "commit", "review", "cancel"]);

function clone(value) {
  return structuredClone(value);
}

function fail(code, message, details = {}) {
  const error = new DesktopAuthoringTaskServiceError(code, message, details);
  throw error;
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function sameIdentity(left, right) {
  return left?.recordId === right?.recordId
    && left?.journalRevision === right?.journalRevision
    && left?.expectedStateId === right?.expectedStateId;
}

function taskIdFrom(input, label = "taskId") {
  assert(typeof input === "string" && TOKEN.test(input),
    "DESKTOP_AUTHORING_TASK_ID_INVALID", `${label} is malformed`);
  return input;
}

function generatedId(kind) {
  return `${kind}-${randomUUID()}`;
}

function argumentPair(taskOrInput, payload, field = null) {
  if (typeof taskOrInput === "string") {
    return { taskId: taskIdFrom(taskOrInput), payload: payload ?? {} };
  }
  assert(taskOrInput && typeof taskOrInput === "object" && !Array.isArray(taskOrInput),
    "DESKTOP_AUTHORING_TASK_INPUT_INVALID", "task input must include taskId");
  const taskId = taskIdFrom(taskOrInput.taskId);
  if (field !== null && payload === undefined && Object.prototype.hasOwnProperty.call(taskOrInput, field)) {
    return { taskId, payload: taskOrInput[field] };
  }
  return { taskId, payload: taskOrInput };
}

function normalizeExpected(expected) {
  if (expected === undefined || expected === null) return null;
  if (expected.recordId && expected.stateId !== undefined && expected.journalRevision !== undefined) {
    return {
      recordId: expected.recordId,
      stateId: expected.stateId,
      journalRevision: expected.journalRevision,
    };
  }
  return authoringTaskRecoveryCASExpectation(expected);
}

function safeErrorDetails(error) {
  const code = typeof error?.code === "string" ? error.code : error?.name ?? "UNKNOWN";
  return { code };
}

function commandPayloadFingerprint(command, payload) {
  return canonicalSha256({
    command,
    payload: payload ?? null,
  }).sha256;
}

function promiseRejected(error) {
  return Promise.reject(error);
}

export class DesktopAuthoringTaskServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DesktopAuthoringTaskServiceError";
    this.code = code;
    this.details = clone(details);
  }
}

/**
 * Framework-neutral durable task composition. Renderer code receives only the
 * projected view returned by these Promise-based commands.
 */
export class DesktopAuthoringTaskService {
  constructor({
    journal,
    authoringPort,
    sourcePorts,
    permissionPort = null,
    commitCommandPort,
    reviewPort,
    adapterBindings,
    idFactory = generatedId,
  } = {}) {
    assert(journal && typeof journal.load === "function"
      && typeof journal.createOrSaveCAS === "function"
      && typeof journal.abandonCAS === "function",
    "DESKTOP_AUTHORING_TASK_JOURNAL_INVALID", "desktop task service requires the local journal port");
    assert(authoringPort && typeof authoringPort.loadHead === "function"
      && typeof authoringPort.commitReplacement === "function",
    "DESKTOP_AUTHORING_TASK_PORT_INVALID", "desktop task service requires the authoring port");
    assert(Array.isArray(sourcePorts), "DESKTOP_AUTHORING_TASK_PORT_INVALID", "sourcePorts must be an array");
    assert(commitCommandPort && typeof commitCommandPort.create === "function",
      "DESKTOP_AUTHORING_TASK_PORT_INVALID", "commitCommandPort is required");
    assert(reviewPort && typeof reviewPort.run === "function",
      "DESKTOP_AUTHORING_TASK_PORT_INVALID", "reviewPort is required");
    assert(permissionPort === null || typeof permissionPort.resolve === "function",
      "DESKTOP_AUTHORING_TASK_PORT_INVALID", "permissionPort is malformed");
    assert(adapterBindings !== undefined,
      "DESKTOP_AUTHORING_TASK_ADAPTER_BINDINGS_REQUIRED",
      "desktop task service requires explicit composition adapter bindings");
    assert(typeof idFactory === "function", "DESKTOP_AUTHORING_TASK_INPUT_INVALID", "idFactory is malformed");

    this.profile = "desktop-authoring-task-service-v1";
    this.journal = journal;
    this.authoringPort = authoringPort;
    this.sourcePorts = Object.freeze(sourcePorts.map((port) => Object.freeze({ ...port })));
    this.permissionPort = permissionPort;
    this.commitCommandPort = commitCommandPort;
    this.reviewPort = reviewPort;
    this.adapterBindings = normalizeRecoveryAdapterBindings(adapterBindings);
    this.idFactory = idFactory;
    this.handles = new Map();
    this.inFlight = new Map();
  }

  _availableSources() {
    return this.sourcePorts.map((port) => ({
      sourceKind: port.sourceKind,
      requiredCapability: port.requiredCapability ?? null,
      clipSourceKind: port.clipSourceKind,
    }));
  }

  _ports() {
    return {
      journal: this.journal,
      authoringPort: this.authoringPort,
      sourcePorts: this.sourcePorts,
      permissionPort: this.permissionPort,
      commitCommandPort: this.commitCommandPort,
      reviewPort: this.reviewPort,
    };
  }

  async _load(taskId) {
    try {
      return await this.journal.load(taskId);
    } catch (error) {
      throw new DesktopAuthoringTaskServiceError(
        error?.code ?? "DESKTOP_AUTHORING_TASK_LOAD_FAILED",
        "desktop authoring task journal load failed",
        safeErrorDetails(error),
      );
    }
  }

  _viewFromRecord(record, decision = record?.decision ?? null) {
    return projectDesktopAuthoringTaskView({
      record,
      decision,
      availableSources: this._availableSources(),
    });
  }

  async _runtimeDecision(record, { currentHead = undefined, allowFreshOverride = true } = {}) {
    const head = currentHead === undefined
      ? await this.authoringPort.loadHead()
      : currentHead;
    const decision = classifyAuthoringTaskRecovery({
      record,
      availableAdapterBindings: this.adapterBindings,
      currentHeadRevisionId: head?.revisionId ?? null,
      sourcePorts: this.sourcePorts,
    });
    const fresh = this.handles.get(record.taskId)?.fresh === true;
    if (allowFreshOverride && fresh
      && record.sessionSnapshot.phase === "AWAITING_SOURCE"
      && decision.kind === "ABANDON"
      && decision.reasonCode === "SOURCE_SELECTION_MISSING") {
      return null;
    }
    return decision;
  }

  async _runtimeView(record, { currentHead = undefined, allowFreshOverride = true } = {}) {
    return this._viewFromRecord(record, await this._runtimeDecision(record, {
      currentHead,
      allowFreshOverride,
    }));
  }

  _assertCompositionBindings(candidate) {
    if (candidate === undefined) return;
    let matches = false;
    try {
      matches = commandPayloadFingerprint("adapter-bindings", candidate)
        === commandPayloadFingerprint("adapter-bindings", this.adapterBindings);
    } catch {
      matches = false;
    }
    assert(matches,
      "DESKTOP_AUTHORING_TASK_ADAPTER_BINDINGS_MISMATCH",
      "task adapter bindings must match the service composition binding");
  }

  _attentionError(view) {
    const error = new DesktopAuthoringTaskServiceError(
      "DESKTOP_AUTHORING_TASK_ATTENTION",
      "desktop authoring task requires attention before this command can run",
      { attention: view.attention?.kind ?? "UNKNOWN" },
    );
    error.view = view;
    return error;
  }

  _assertSnapshotMatchesRecord(snapshot, record) {
    assert(record?.expectedStateId === snapshot?.stateId
      && record.sessionSnapshot?.sessionRevision === snapshot?.sessionRevision,
    "DESKTOP_AUTHORING_TASK_PERSISTENCE_DRIFT",
    "controller state differs from the persisted recovery record", {
      recordId: record?.recordId ?? null,
      journalRevision: record?.journalRevision ?? null,
    });
  }

  async _verifyReload(taskId, snapshot, expectedRecord = null) {
    const loaded = await this._load(taskId);
    if (loaded.status === "CORRUPT") {
      fail("AUTHORING_TASK_JOURNAL_CORRUPT", "journal became corrupt during a desktop command", {
        taskId,
      });
    }
    if (loaded.status !== "LOADED") {
      fail("AUTHORING_TASK_JOURNAL_MISSING", "journal disappeared during a desktop command", { taskId });
    }
    this._assertSnapshotMatchesRecord(snapshot, loaded.record);
    if (expectedRecord !== null) {
      assert(sameIdentity(expectedRecord, loaded.record),
        "DESKTOP_AUTHORING_TASK_PERSISTENCE_DRIFT",
        "journal reload returned a different canonical record", { taskId });
    }
    return loaded.record;
  }

  async _directHandle(record, fresh = false) {
    let currentRecord = record;
    const controller = await openAuthoringProductSession({
      ...this._ports(),
      sessionId: record.sessionId,
      bindingId: record.sessionSnapshot.target.bindingId,
      clipId: record.sessionSnapshot.target.clipId,
      initialState: record.sessionSnapshot,
      sourceRequest: record.recoveryContext.sourceRequest,
      committedRevision: record.recoveryContext.committedRevision,
      eventSequence: record.recoveryContext.eventSequence,
      attemptSequence: record.recoveryContext.attemptSequence,
      onCheckpoint: async (input) => {
        currentRecord = await saveAuthoringTaskRecoverySnapshot({
          journal: this.journal,
          previousRecord: currentRecord,
          snapshot: input.snapshot,
          sourceRequest: input.sourceRequest,
          committedRevision: input.committedRevision,
          eventSequence: input.eventSequence,
          attemptSequence: input.attemptSequence,
        });
      },
    });
    return Object.freeze({
      controller,
      decision: currentRecord.decision,
      fresh,
      getRecord: () => currentRecord,
    });
  }

  async _openRecovery(taskId) {
    const loaded = await this._load(taskId);
    if (loaded.status === "CORRUPT") {
      return Object.freeze({
        record: null,
        decision: null,
        controller: null,
        corruption: loaded.corruption,
        getRecord: () => null,
      });
    }
    if (loaded.status === "MISSING") {
      fail("AUTHORING_TASK_JOURNAL_MISSING", "desktop authoring task journal is absent", { taskId });
    }
    const opened = await openAuthoringTaskRecovery({
      ...this._ports(),
      taskId,
      adapterBindings: this.adapterBindings,
    });
    if (opened.controller !== null) this.handles.set(taskId, opened);
    return opened;
  }

  async _commandHandle(taskId, entry) {
    let cached = this.handles.get(taskId);
    if (cached?.controller) {
      const loaded = await this._load(taskId);
      if (loaded.status === "CORRUPT") {
        throw this._attentionError(projectDesktopAuthoringTaskView({
          record: null,
          taskId,
          corruption: loaded.corruption,
          availableSources: this._availableSources(),
        }));
      }
      if (loaded.status === "MISSING") {
        fail("AUTHORING_TASK_JOURNAL_MISSING", "desktop authoring task journal is absent", { taskId });
      }
      if (!sameIdentity(cached.getRecord(), loaded.record)) {
        this.handles.delete(taskId);
        const reopened = await this._openRecovery(taskId);
        if (!reopened.controller) {
          const view = reopened.corruption !== undefined
            ? projectDesktopAuthoringTaskView({
              record: null,
              taskId,
              corruption: reopened.corruption,
              availableSources: this._availableSources(),
            })
            : this._viewFromRecord(reopened.record, reopened.decision);
          throw this._attentionError(view);
        }
        cached = reopened;
      }
      const decision = await this._runtimeDecision(cached.getRecord());
      if (["BLOCKED_ADAPTER_MISMATCH", "CONFLICT", "TERMINAL"].includes(decision?.kind)
        || (decision?.kind === "ABANDON" && decision.requiresUserAction)) {
        throw this._attentionError(this._viewFromRecord(cached.getRecord(), decision));
      }
      entry.handle = cached;
      return cached;
    }
    const opened = await this._openRecovery(taskId);
    if (!opened.controller) {
      const view = opened.corruption !== undefined
        ? projectDesktopAuthoringTaskView({
          record: null,
          taskId,
          corruption: opened.corruption,
          availableSources: this._availableSources(),
        })
        : this._viewFromRecord(opened.record, opened.decision);
      throw this._attentionError(view);
    }
    entry.handle = opened;
    return opened;
  }

  async _persistSync(handle, { sourceRequest = undefined, lifecycle = undefined } = {}) {
    const previousRecord = handle.getRecord();
    const snapshot = handle.controller.snapshot();
    try {
      const saved = await saveAuthoringTaskRecoverySnapshot({
        journal: this.journal,
        previousRecord,
        snapshot,
        sourceRequest,
        lifecycle,
      });
      return { record: await this._verifyReload(previousRecord.taskId, snapshot, saved) };
    } catch (error) {
      if (error?.code !== "AUTHORING_TASK_JOURNAL_CAS_CONFLICT") throw error;
      this.handles.delete(previousRecord.taskId);
      return { conflictView: await this._liveConflictView(previousRecord.taskId) };
    }
  }

  async _liveConflictView(taskId) {
    const loaded = await this._load(taskId);
    if (loaded.status === "CORRUPT") {
      return projectDesktopAuthoringTaskView({
        record: null,
        taskId,
        corruption: loaded.corruption,
        availableSources: this._availableSources(),
      });
    }
    if (loaded.status === "MISSING") {
      fail("AUTHORING_TASK_JOURNAL_MISSING", "desktop authoring task journal is absent", { taskId });
    }
    return this._viewFromRecord(loaded.record, {
      kind: "CONFLICT",
      reasonCode: "LIVE_JOURNAL_CAS_CONFLICT",
      resumePhase: null,
      requiresUserAction: true,
      releaseGate: null,
    });
  }

  async _reopenAndView(taskId) {
    this.handles.delete(taskId);
    const opened = await this._openRecovery(taskId);
    if (opened.corruption !== undefined) {
      return projectDesktopAuthoringTaskView({
        record: null,
        taskId,
        corruption: opened.corruption,
        availableSources: this._availableSources(),
      });
    }
    if (!opened.controller) return this._viewFromRecord(opened.record, opened.decision);
    return this._viewFromRecord(opened.getRecord(), opened.getRecord().decision);
  }

  async _view(taskId) {
    const loaded = await this._load(taskId);
    if (loaded.status === "CORRUPT") {
      return projectDesktopAuthoringTaskView({
        record: null,
        taskId,
        corruption: loaded.corruption,
        availableSources: this._availableSources(),
      });
    }
    if (loaded.status === "MISSING") {
      fail("AUTHORING_TASK_JOURNAL_MISSING", "desktop authoring task journal is absent", { taskId });
    }
    return this._runtimeView(loaded.record);
  }

  _enqueue(taskId, command, payload, operation) {
    let fingerprint;
    try {
      fingerprint = commandPayloadFingerprint(command, payload);
    } catch {
      return promiseRejected(new DesktopAuthoringTaskServiceError(
        "DESKTOP_AUTHORING_TASK_INPUT_INVALID",
        "desktop authoring command payload is not canonical JSON",
      ));
    }
    const identity = `${command}:${fingerprint}`;
    const existing = this.inFlight.get(taskId);
    if (existing) {
      if (existing.identity === identity) return existing.promise;
      return promiseRejected(new DesktopAuthoringTaskServiceError(
        "DESKTOP_AUTHORING_TASK_BUSY",
        "another desktop authoring command is in flight",
        { taskId, activeCommand: existing.command, requestedCommand: command },
      ));
    }
    const entry = {
      command,
      fingerprint,
      identity,
      handle: null,
      promise: null,
      cancelPromise: null,
      cancelIdentity: null,
    };
    const promise = (async () => {
      try {
        return await operation(entry);
      } catch (error) {
        if (this.handles.get(taskId) === entry.handle) this.handles.delete(taskId);
        throw error;
      } finally {
        if (this.inFlight.get(taskId) === entry) this.inFlight.delete(taskId);
      }
    })();
    entry.promise = promise;
    this.inFlight.set(taskId, entry);
    return promise;
  }

  createTask(input = {}) {
    try {
      assert(input && typeof input === "object" && !Array.isArray(input),
        "DESKTOP_AUTHORING_TASK_INPUT_INVALID", "createTask input is required");
      const taskId = taskIdFrom(input.taskId ?? this.idFactory("task"));
      return this._enqueue(taskId, "create", input, async () => {
      this._assertCompositionBindings(input.adapterBindings);
      const existing = await this._load(taskId);
      if (existing.status === "CORRUPT") {
        return projectDesktopAuthoringTaskView({
          record: null,
          taskId,
          corruption: existing.corruption,
          availableSources: this._availableSources(),
        });
      }
      if (existing.status === "LOADED") {
        const live = this.handles.get(taskId);
        if (live) {
          if (!sameIdentity(live.getRecord(), existing.record)) {
            this.handles.delete(taskId);
            const reopened = await this._openRecovery(taskId);
            if (reopened.corruption !== undefined) {
              return projectDesktopAuthoringTaskView({
                record: null,
                taskId,
                corruption: reopened.corruption,
                availableSources: this._availableSources(),
              });
            }
            if (!reopened.controller) return this._viewFromRecord(reopened.record, reopened.decision);
            return this._runtimeView(reopened.getRecord());
          }
          return this._runtimeView(existing.record);
        }
        const opened = await this._openRecovery(taskId);
        if (opened.corruption !== undefined) {
          return projectDesktopAuthoringTaskView({
            record: null,
            taskId,
            corruption: opened.corruption,
            availableSources: this._availableSources(),
          });
        }
        return !opened.controller
          ? this._viewFromRecord(opened.record, opened.decision)
          : this._viewFromRecord(opened.getRecord(), opened.getRecord().decision);
      }

      const target = input.target ?? input;
      const bindingId = target.bindingId;
      const clipId = target.clipId;
      const sessionId = taskIdFrom(input.sessionId ?? this.idFactory("session"), "sessionId");
      const baseRevision = await this.authoringPort.loadHead();
      assert(baseRevision !== null, "AUTHORING_SESSION_HEAD_MISSING", "authoring workspace head is missing");
      const sessionSnapshot = createAuthoringProductSessionState({
        sessionId,
        baseRevision,
        bindingId,
        clipId,
      });
      const adapterBindings = this.adapterBindings;
      const record = createAuthoringTaskRecoveryRecordFromSession({
        taskId,
        sessionSnapshot,
        adapterBindings,
        sourceRequest: null,
        committedRevision: null,
        eventSequence: 0,
        attemptSequence: 0,
      });
      await this.journal.createOrSaveCAS({ record, expected: null });
      const persisted = await this._verifyReload(taskId, sessionSnapshot, record);
      // Keep the fresh controller alive for the first source selection. A
      // restart before selection is intentionally classified as abandon-only
      // by the recovery contract.
      const handle = await this._directHandle(persisted, true);
      this.handles.set(taskId, handle);
      return this._viewFromRecord(persisted, null);
      });
    } catch (error) {
      return promiseRejected(error);
    }
  }

  create(input = {}) {
    return this.createTask(input);
  }

  resumeTask(taskOrInput) {
    try {
      const { taskId } = argumentPair(taskOrInput);
      return this._enqueue(taskId, "resume", {}, async () => {
      this.handles.delete(taskId);
      const opened = await this._openRecovery(taskId);
      if (opened.corruption !== undefined) {
        return projectDesktopAuthoringTaskView({
          record: null,
          taskId,
          corruption: opened.corruption,
          availableSources: this._availableSources(),
        });
      }
      if (!opened.controller) return this._viewFromRecord(opened.record, opened.decision);
      return this._viewFromRecord(opened.getRecord(), opened.getRecord().decision);
      });
    } catch (error) {
      return promiseRejected(error);
    }
  }

  resume(taskOrInput) {
    return this.resumeTask(taskOrInput);
  }

  getView(taskOrInput) {
    try {
      const { taskId } = argumentPair(taskOrInput);
      return this._view(taskId);
    } catch (error) {
      return promiseRejected(error);
    }
  }

  listTasks() {
    // Journal order is transport order only. Product retention and sorting are
    // intentionally UNKNOWN until a task-catalog contract is owned elsewhere.
    return (async () => {
      const listed = await this.journal.list();
      const currentHead = await this.authoringPort.loadHead();
      const views = await Promise.all(listed.records.map((record) => this._runtimeView(record, { currentHead })));
      const corruptionViews = listed.corruptions.map((corruption) => projectDesktopAuthoringTaskView({
        record: null,
        taskId: corruption.taskId,
        corruption,
        availableSources: this._availableSources(),
      }));
      return Object.freeze([...views, ...corruptionViews]);
    })();
  }

  selectSource(taskOrInput, payload = undefined) {
    try {
      const parsed = argumentPair(taskOrInput, payload);
      const input = parsed.payload ?? {};
      return this._enqueue(parsed.taskId, "selectSource", input, async (entry) => {
      const handle = await this._commandHandle(parsed.taskId, entry);
      assert(SOURCE_KIND.test(input.sourceKind ?? ""),
        "DESKTOP_AUTHORING_SOURCE_INPUT_INVALID", "sourceKind is unsupported");
      assert(ASSET_ID.test(input.assetId ?? ""),
        "DESKTOP_AUTHORING_SOURCE_INPUT_INVALID", "assetId is malformed");
      const request = input.request ?? input.sourceRequest;
      assert(request !== undefined && request !== null,
        "DESKTOP_AUTHORING_SOURCE_REQUEST_INVALID", "source selection requires an exact adapter-private request");
      let requestClone;
      try {
        requestClone = clone(request);
      } catch {
        fail("DESKTOP_AUTHORING_SOURCE_REQUEST_INVALID", "source request is not cloneable");
      }
      handle.controller.selectSource({
        sourceKind: input.sourceKind,
        assetId: input.assetId,
        request: requestClone,
      });
      const persisted = await this._persistSync(handle, { sourceRequest: requestClone });
      if (persisted.conflictView) return persisted.conflictView;
      return this._reopenAndView(parsed.taskId);
      });
    } catch (error) {
      return promiseRejected(error);
    }
  }

  submitMetadata(taskOrInput, metadata = undefined) {
    try {
      const parsed = typeof taskOrInput === "string"
        ? { taskId: taskIdFrom(taskOrInput), payload: metadata }
        : argumentPair(taskOrInput);
      return this._enqueue(parsed.taskId, "submitMetadata", parsed.payload ?? null, async (entry) => {
      const handle = await this._commandHandle(parsed.taskId, entry);
      const clipMetadata = parsed.payload?.clipMetadata ?? parsed.payload;
      assert(clipMetadata && typeof clipMetadata === "object" && !Array.isArray(clipMetadata),
        "DESKTOP_AUTHORING_METADATA_INPUT_INVALID", "clipMetadata is required");
      handle.controller.submitMetadata(clone(clipMetadata));
      const persisted = await this._persistSync(handle);
      if (persisted.conflictView) return persisted.conflictView;
      return this._reopenAndView(parsed.taskId);
      });
    } catch (error) {
      return promiseRejected(error);
    }
  }

  retry(taskOrInput, payload = undefined) {
    try {
      const parsed = argumentPair(taskOrInput, payload);
      const { taskId } = parsed;
      return this._enqueue(taskId, "retry", parsed.payload, async (entry) => {
      const handle = await this._commandHandle(taskId, entry);
      const phase = handle.getRecord().sessionSnapshot.phase;
      if (["FAILED", "REJECTED"].includes(phase)) {
        handle.controller.retry();
        const persisted = await this._persistSync(handle);
        if (persisted.conflictView) return persisted.conflictView;
        return this._reopenAndView(taskId);
      }
      if (AUTHORING_PRODUCT_SESSION_PHASES.includes(phase)
        && ["READY_TO_ACQUIRE", "READY_TO_COMMIT", "READY_TO_REVIEW"].includes(phase)) {
        return this._view(taskId);
      }
      fail("DESKTOP_AUTHORING_RETRY_BLOCKED", "retry is not available in the current task state", { phase });
      });
    } catch (error) {
      return promiseRejected(error);
    }
  }

  _runAsync(taskId, command, method, payload = undefined) {
    return this._enqueue(taskId, command, payload, async (entry) => {
      const handle = await this._commandHandle(taskId, entry);
      const result = await handle.controller[method]();
      const snapshot = result ?? handle.controller.snapshot();
      let persisted = await this._verifyReload(taskId, snapshot);
      if (method === "acquire" && persisted.sessionSnapshot.phase === "AWAITING_METADATA") {
        const sourcePort = this.sourcePorts.find((port) =>
          port.sourceKind === persisted.sessionSnapshot.selection?.sourceKind);
        if (typeof sourcePort?.autoMetadataFromRequest === "function") {
          let autoMetadata;
          try {
            autoMetadata = sourcePort.autoMetadataFromRequest(
              clone(handle.getRecord().recoveryContext.sourceRequest),
            );
          } catch {
            fail("DESKTOP_AUTHORING_AUTO_METADATA_INVALID", "source auto-metadata hook failed");
          }
          assert(autoMetadata && typeof autoMetadata === "object" && !Array.isArray(autoMetadata),
            "DESKTOP_AUTHORING_AUTO_METADATA_INVALID", "source auto-metadata hook returned malformed metadata");
          handle.controller.submitMetadata(clone(autoMetadata));
          const saved = await this._persistSync(handle);
          if (saved.conflictView) return saved.conflictView;
          persisted = saved.record;
        }
      }
      this.handles.delete(taskId);
      return this._viewFromRecord(persisted, persisted.decision);
    });
  }

  acquire(taskOrInput, payload = undefined) {
    try {
      const parsed = argumentPair(taskOrInput, payload);
      return this._runAsync(parsed.taskId, "acquire", "acquire", parsed.payload);
    } catch (error) {
      return promiseRejected(error);
    }
  }

  acquireSource(taskOrInput) {
    return this.acquire(taskOrInput);
  }

  commit(taskOrInput, payload = undefined) {
    try {
      const parsed = argumentPair(taskOrInput, payload);
      return this._runAsync(parsed.taskId, "commit", "commit", parsed.payload);
    } catch (error) {
      return promiseRejected(error);
    }
  }

  review(taskOrInput, payload = undefined) {
    try {
      const parsed = argumentPair(taskOrInput, payload);
      return this._runAsync(parsed.taskId, "review", "review", parsed.payload);
    } catch (error) {
      return promiseRejected(error);
    }
  }

  cancel(taskOrInput, payload = undefined) {
    let parsed;
    try {
      parsed = argumentPair(taskOrInput, payload);
    } catch (error) {
      return promiseRejected(error);
    }
    const { taskId } = parsed;
    const active = this.inFlight.get(taskId);
    if (active && active.command !== "cancel") {
      const state = active.handle?.controller?.snapshot?.() ?? null;
      const abortable = state?.active !== null
        && state?.active !== undefined
        && state.active.stage !== "COMMIT";
      if (!ASYNC_COMMANDS.has(active.command) || !abortable) {
        return promiseRejected(new DesktopAuthoringTaskServiceError(
          state?.phase === "COMMITTING" ? "AUTHORING_SESSION_COMMIT_BARRIER" : "DESKTOP_AUTHORING_TASK_BUSY",
          state?.phase === "COMMITTING"
            ? "commit result must settle before the session closes"
          : "another desktop authoring command is in flight",
        ));
      }
      let cancelIdentity;
      try {
        cancelIdentity = `cancel:${commandPayloadFingerprint("cancel", parsed.payload)}`;
      } catch {
        return promiseRejected(new DesktopAuthoringTaskServiceError(
          "DESKTOP_AUTHORING_TASK_INPUT_INVALID",
          "desktop authoring command payload is not canonical JSON",
        ));
      }
      if (active.cancelPromise) {
        if (active.cancelIdentity === cancelIdentity) return active.cancelPromise;
        return promiseRejected(new DesktopAuthoringTaskServiceError(
          "DESKTOP_AUTHORING_TASK_BUSY",
          "another desktop authoring command is in flight",
          { taskId, activeCommand: active.command, requestedCommand: "cancel" },
        ));
      }
      active.cancelIdentity = cancelIdentity;
      active.cancelPromise = (async () => {
        await active.handle.controller.cancel();
        try { await active.promise; } catch { /* the settled view remains authoritative */ }
        return this._view(taskId);
      })();
      return active.cancelPromise;
    }
    return this._runAsync(taskId, "cancel", "cancel", parsed.payload);
  }

  abandon(taskOrInput, options = undefined) {
    try {
      const parsed = typeof taskOrInput === "string"
        ? { taskId: taskIdFrom(taskOrInput), payload: options ?? {} }
        : argumentPair(taskOrInput, options);
      const input = parsed.payload ?? {};
      return this._enqueue(parsed.taskId, "abandon", input, async () => {
      const loaded = await this._load(parsed.taskId);
      if (loaded.status === "CORRUPT") {
        return projectDesktopAuthoringTaskView({
          record: null,
          taskId: parsed.taskId,
          corruption: loaded.corruption,
          availableSources: this._availableSources(),
        });
      }
      if (loaded.status === "MISSING") {
        fail("AUTHORING_TASK_JOURNAL_MISSING", "desktop authoring task journal is absent", {
          taskId: parsed.taskId,
        });
      }
      const classifiedHead = await this.authoringPort.loadHead();
      const decision = await this._runtimeDecision(loaded.record, {
        currentHead: classifiedHead,
        allowFreshOverride: false,
      });
      const classifiedView = this._viewFromRecord(loaded.record, decision);
      if (["BLOCKED_ADAPTER_MISMATCH", "CONFLICT", "TERMINAL"].includes(decision.kind)
        || (decision.kind === "ABANDON" && decision.requiresUserAction === false)) {
        return classifiedView;
      }
      if (loaded.record.lifecycle !== "ACTIVE"
        || decision.kind === "REPLAY_FROZEN_COMMIT") {
        const error = new DesktopAuthoringTaskServiceError(
          decision.kind === "REPLAY_FROZEN_COMMIT"
            ? "AUTHORING_SESSION_COMMIT_BARRIER"
            : "DESKTOP_AUTHORING_TASK_ABANDON_BLOCKED",
          decision.kind === "REPLAY_FROZEN_COMMIT"
            ? "commit result must settle before the task can be abandoned"
            : "task abandon is not available in the current recovery state",
          { phase: loaded.record.sessionSnapshot.phase },
        );
        error.view = classifiedView;
        throw error;
      }
      const cached = this.handles.get(parsed.taskId);
      const active = cached?.controller?.snapshot?.()?.active;
      if (active !== null && active !== undefined) {
        fail("DESKTOP_AUTHORING_TASK_BUSY", "an active effect must settle before abandon");
      }
      const expected = normalizeExpected(input.expected)
        ?? (cached ? authoringTaskRecoveryCASExpectation(cached.getRecord()) : authoringTaskRecoveryCASExpectation(loaded.record));
      const finalHead = await this.authoringPort.loadHead();
      if ((finalHead?.revisionId ?? null) !== (classifiedHead?.revisionId ?? null)) {
        return this._viewFromRecord(loaded.record, {
          kind: "CONFLICT",
          reasonCode: "BASE_HEAD_CHANGED",
          resumePhase: null,
          requiresUserAction: true,
          releaseGate: null,
        });
      }
      let tombstone;
      try {
        tombstone = await this.journal.abandonCAS({
          taskId: parsed.taskId,
          expected,
          reason: input.reason ?? "USER_ABANDONED",
        });
      } catch (error) {
        if (error?.code !== "AUTHORING_TASK_JOURNAL_CAS_CONFLICT") throw error;
        this.handles.delete(parsed.taskId);
        error.view = await this._liveConflictView(parsed.taskId);
        throw error;
      }
      const reloaded = await this._load(parsed.taskId);
      assert(reloaded.status === "LOADED" && sameIdentity(tombstone, reloaded.record),
        "DESKTOP_AUTHORING_TASK_PERSISTENCE_DRIFT",
        "abandon CAS returned a record different from the disk reload", { taskId: parsed.taskId });
      const persisted = reloaded.record;
      this.handles.delete(parsed.taskId);
      return this._viewFromRecord(persisted, persisted.decision);
      });
    } catch (error) {
      return promiseRejected(error);
    }
  }

  abandonTask(taskOrInput, options = undefined) {
    return this.abandon(taskOrInput, options);
  }

  command(taskOrInput, commandName = undefined, payload = undefined) {
    try {
      if (typeof taskOrInput === "string") {
        const taskId = taskIdFrom(taskOrInput);
        return this._dispatch(taskId, commandName, payload);
      }
      assert(taskOrInput && typeof taskOrInput === "object", "DESKTOP_AUTHORING_TASK_INPUT_INVALID", "command input is malformed");
      return this._dispatch(taskIdFrom(taskOrInput.taskId), taskOrInput.command ?? commandName, taskOrInput.payload ?? payload);
    } catch (error) {
      return promiseRejected(error);
    }
  }

  _dispatch(taskId, commandName, payload) {
    switch (commandName) {
      case "selectSource": return this.selectSource(taskId, payload);
      case "acquire":
      case "acquireSource": return this.acquire(taskId, payload);
      case "submitMetadata": return this.submitMetadata(taskId, payload);
      case "commit": return this.commit(taskId, payload);
      case "review": return this.review(taskId, payload);
      case "retry": return this.retry(taskId, payload);
      case "cancel": return this.cancel(taskId, payload);
      case "abandon": return this.abandon(taskId, payload);
      default: return Promise.reject(new DesktopAuthoringTaskServiceError(
        "DESKTOP_AUTHORING_COMMAND_UNKNOWN",
        "unknown desktop authoring command",
        { command: commandName },
      ));
    }
  }
}

export function createDesktopAuthoringTaskService(options) {
  return new DesktopAuthoringTaskService(options);
}
