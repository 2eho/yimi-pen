import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  FamilyRepositoryError,
  assertRepositoryId,
  assertRepositoryBackup,
  assertRepositoryState,
  createRepositoryBackup,
  decodeCanonicalRepositoryJson,
  decodeRepositoryJson,
  emptyRepositoryState,
  encodeRepositoryJson,
  planCommit,
  planPortableRestore,
  planRecovery,
  planRestore,
  replayRecoveryIfRecorded,
  repositoryStateSha256,
} from "./repository-core.mjs";

function clone(value) {
  return structuredClone(value);
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

export class AtomicJsonFamilyRepository {
  constructor({ repositoryId, repositoryRoot, allowedRoot, faultInjector = null }) {
    this.repositoryId = assertRepositoryId(repositoryId);
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.allowedRoot = path.resolve(allowedRoot);
    this.statePath = path.join(this.repositoryRoot, "state.json");
    this.formatPath = path.join(this.repositoryRoot, "repository.format");
    this.lockPath = path.join(this.repositoryRoot, "repository.lock");
    this.faultInjector = faultInjector;
  }

  async ensureRoot() {
    const [allowedInfo, repositoryInfo] = await Promise.all([
      lstat(this.allowedRoot),
      lstat(this.repositoryRoot),
    ]);
    if (!allowedInfo.isDirectory() || allowedInfo.isSymbolicLink()) {
      throw new FamilyRepositoryError("UNSAFE_ROOT", "allowedRoot must be a regular directory");
    }
    if (!repositoryInfo.isDirectory() || repositoryInfo.isSymbolicLink()) {
      throw new FamilyRepositoryError("UNSAFE_ROOT", "repositoryRoot must be a regular directory");
    }
    const [realAllowed, realRepository] = await Promise.all([realpath(this.allowedRoot), realpath(this.repositoryRoot)]);
    if (!inside(realAllowed, realRepository)) {
      throw new FamilyRepositoryError("UNSAFE_ROOT", "repositoryRoot resolved outside allowedRoot");
    }
  }

  async assertFormatMarker() {
    const info = await optionalLstat(this.formatPath);
    if (!info || !info.isFile() || info.isSymbolicLink()) {
      throw new FamilyRepositoryError("CORRUPT", "repository format marker is missing or unsafe");
    }
    const [realRoot, realFormat] = await Promise.all([realpath(this.repositoryRoot), realpath(this.formatPath)]);
    if (!inside(realRoot, realFormat)) throw new FamilyRepositoryError("CORRUPT", "repository format marker escaped repositoryRoot");
    const bytes = await readFile(realFormat);
    const expected = encodeRepositoryJson({
      schemaVersion: 1,
      profile: "family-repository-format-v1",
      repositoryId: this.repositoryId,
    });
    if (!bytes.equals(expected)) {
      throw new FamilyRepositoryError("CORRUPT", "repository format marker differs from v1");
    }
  }

  async readStateFile() {
    const info = await optionalLstat(this.statePath);
    if (!info) throw new FamilyRepositoryError("CORRUPT", "initialized repository state.json is missing");
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new FamilyRepositoryError("CORRUPT", "state.json must be a regular file");
    }
    const [realRoot, realState] = await Promise.all([realpath(this.repositoryRoot), realpath(this.statePath)]);
    if (!inside(realRoot, realState)) throw new FamilyRepositoryError("CORRUPT", "state.json resolved outside repositoryRoot");
    const state = decodeCanonicalRepositoryJson(await readFile(realState), { code: "CORRUPT", label: "repository state" });
    await assertRepositoryState(state);
    if (state.repositoryId !== this.repositoryId) {
      throw new FamilyRepositoryError("CORRUPT", "state belongs to a different repositoryId");
    }
    return state;
  }

  async readState() {
    await this.ensureRoot();
    const [formatInfo, stateInfo] = await Promise.all([
      optionalLstat(this.formatPath),
      optionalLstat(this.statePath),
    ]);
    if (!formatInfo && !stateInfo) {
      throw new FamilyRepositoryError("UNINITIALIZED", "repository requires explicit initialization");
    }
    await this.assertFormatMarker();
    return this.readStateFile();
  }

  async withLock(operation) {
    await this.ensureRoot();
    let lock;
    try {
      lock = await open(this.lockPath, "wx");
    } catch (error) {
      if (error?.code === "EEXIST") throw new FamilyRepositoryError("BUSY", "repository is locked by another writer");
      throw error;
    }
    try {
      return await operation();
    } finally {
      try { await lock.close(); } catch { /* preserve transaction result */ }
      try { await rm(this.lockPath, { force: true }); } catch { /* preserve transaction result */ }
    }
  }

  async atomicWriteState(state) {
    await assertRepositoryState(state);
    const bytes = encodeRepositoryJson(state);
    const temporary = `${this.statePath}.tmp-${process.pid}-${randomUUID()}`;
    let handle;
    let renamed = false;
    try {
      handle = await open(temporary, "wx");
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      if (this.faultInjector) await this.faultInjector("after-temp-sync-before-rename", { temporary, statePath: this.statePath });
      await rename(temporary, this.statePath);
      renamed = true;
    } finally {
      if (handle) {
        try { await handle.close(); } catch { /* cleanup only */ }
      }
      if (!renamed) {
        try { await rm(temporary, { force: true }); } catch { /* original result owns status */ }
      }
    }
  }

  async writeFormatMarker() {
    const temporary = `${this.formatPath}.tmp-${process.pid}-${randomUUID()}`;
    let handle;
    let renamed = false;
    try {
      handle = await open(temporary, "wx");
      await handle.writeFile(encodeRepositoryJson({
        schemaVersion: 1,
        profile: "family-repository-format-v1",
        repositoryId: this.repositoryId,
      }));
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, this.formatPath);
      renamed = true;
    } finally {
      if (handle) {
        try { await handle.close(); } catch { /* cleanup only */ }
      }
      if (!renamed) {
        try { await rm(temporary, { force: true }); } catch { /* original result owns status */ }
      }
    }
  }

  async initialize() {
    return this.withLock(async () => {
      const [formatInfo, stateInfo] = await Promise.all([
        optionalLstat(this.formatPath),
        optionalLstat(this.statePath),
      ]);
      if (formatInfo) {
        await this.assertFormatMarker();
        if (!stateInfo) throw new FamilyRepositoryError("CORRUPT", "initialized repository state.json is missing");
        const state = await this.readStateFile();
        return {
          status: "existing",
          repositoryId: state.repositoryId,
          familyLibraryId: state.familyLibraryId,
          headRevisionId: state.headRevisionId,
          headRevisionNumber: state.headRevisionNumber,
          stateGeneration: state.stateGeneration,
          outboxEpoch: state.outboxEpoch,
          nextOutboxSequence: state.nextOutboxSequence,
        };
      }
      if (stateInfo) {
        const state = await this.readStateFile();
        if (state.repositoryId !== this.repositoryId
          || repositoryStateSha256(state) !== repositoryStateSha256(emptyRepositoryState(this.repositoryId))) {
          throw new FamilyRepositoryError("CORRUPT", "non-empty state exists without repository format marker");
        }
      } else {
        await this.atomicWriteState(emptyRepositoryState(this.repositoryId));
      }
      await this.writeFormatMarker();
      return {
        status: "initialized",
        repositoryId: this.repositoryId,
        familyLibraryId: null,
        headRevisionId: null,
        headRevisionNumber: "0",
        stateGeneration: "0",
        outboxEpoch: emptyRepositoryState(this.repositoryId).outboxEpoch,
        nextOutboxSequence: "1",
      };
    });
  }

  async open() {
    const state = await this.readState();
    return {
      status: state.headRevisionId === null ? "empty" : "ready",
      repositoryId: state.repositoryId,
      familyLibraryId: state.familyLibraryId,
      headRevisionId: state.headRevisionId,
      headRevisionNumber: state.headRevisionNumber,
      stateGeneration: state.stateGeneration,
      outboxEpoch: state.outboxEpoch,
      nextOutboxSequence: state.nextOutboxSequence,
    };
  }

  async loadHead() {
    const state = await this.readState();
    return state.revisions.length ? clone(state.revisions.at(-1)) : null;
  }

  async loadRevision(revisionId) {
    const state = await this.readState();
    const revision = state.revisions.find((candidate) => candidate.revisionId === revisionId);
    return revision ? clone(revision) : null;
  }

  async commit(command) {
    return this.withLock(async () => {
      const state = await this.readState();
      const plan = await planCommit(state, command);
      if (plan.changed) await this.atomicWriteState(plan.state);
      return clone(plan.result);
    });
  }

  async createBackup({ createdAt }) {
    return this.withLock(async () => {
      const backup = await createRepositoryBackup(await this.readState(), { createdAt });
      return encodeRepositoryJson(backup);
    });
  }

  async restore({ backupBytes, ...command }) {
    return this.withLock(async () => {
      const backup = decodeRepositoryJson(backupBytes, { code: "BACKUP_INVALID", label: "repository backup" });
      await assertRepositoryBackup(backup);
      const plan = await planRestore(await this.readState(), { ...command, backup });
      if (plan.changed) await this.atomicWriteState(plan.state);
      return clone(plan.result);
    });
  }

  async restorePortable({ backupBytes, ...command }) {
    return this.withLock(async () => {
      const backup = decodeRepositoryJson(backupBytes, { code: "BACKUP_INVALID", label: "repository backup" });
      await assertRepositoryBackup(backup);
      const plan = await planPortableRestore(await this.readState(), { ...command, backup });
      if (plan.changed) await this.atomicWriteState(plan.state);
      return clone(plan.result);
    });
  }

  async recoverFromBackup({ backupBytes, expectedCorruptFileSha256, operationId, at }) {
    return this.withLock(async () => {
      await this.assertFormatMarker();
      const stateInfo = await optionalLstat(this.statePath);
      if (!stateInfo || !stateInfo.isFile() || stateInfo.isSymbolicLink()) {
        throw new FamilyRepositoryError("CORRUPT", "recovery requires an existing regular corrupt state file");
      }
      const corruptBytes = await readFile(this.statePath);
      const backup = decodeRepositoryJson(backupBytes, { code: "BACKUP_INVALID", label: "repository backup" });
      await assertRepositoryBackup(backup);
      let currentStateIsSemanticallyValid = false;
      let currentStateIsCanonical = false;
      let currentState = null;
      try {
        currentState = decodeRepositoryJson(corruptBytes, { code: "CORRUPT", label: "repository state" });
        await assertRepositoryState(currentState);
        currentStateIsSemanticallyValid = currentState.repositoryId === this.repositoryId;
        currentStateIsCanonical = corruptBytes.equals(encodeRepositoryJson(currentState));
      } catch (error) {
        if (error?.code !== "CORRUPT") throw error;
      }
      if (currentStateIsSemanticallyValid) {
        const replay = await replayRecoveryIfRecorded(currentState, {
          repositoryId: this.repositoryId,
          backup,
          expectedCorruptFileSha256,
          operationId,
          at,
        });
        if (replay) return clone(replay);
      }
      if (currentStateIsSemanticallyValid && currentStateIsCanonical) {
        throw new FamilyRepositoryError("RECOVERY_NOT_REQUIRED", "recovery is restricted to corrupt repository state");
      }
      if (currentStateIsSemanticallyValid) {
        throw new FamilyRepositoryError("STATE_FORMAT_DRIFT", "semantic state is valid and requires format normalization, not backup recovery");
      }
      const actualCorruptFileSha256 = createHash("sha256").update(corruptBytes).digest("hex");
      if (actualCorruptFileSha256 !== expectedCorruptFileSha256) {
        throw new FamilyRepositoryError("STALE_CORRUPT_FILE", "corrupt state bytes changed before recovery");
      }
      const plan = await planRecovery({
        repositoryId: this.repositoryId,
        backup,
        expectedCorruptFileSha256,
        operationId,
        at,
      });
      if (plan.changed) {
        const currentBytes = await readFile(this.statePath);
        const currentSha256 = createHash("sha256").update(currentBytes).digest("hex");
        if (currentSha256 !== expectedCorruptFileSha256) {
          throw new FamilyRepositoryError("STALE_CORRUPT_FILE", "corrupt state bytes changed before recovery commit");
        }
        await this.atomicWriteState(plan.state);
      }
      return clone(plan.result);
    });
  }

  async normalizeStateFormat({ expectedNoncanonicalFileSha256 }) {
    return this.withLock(async () => {
      await this.assertFormatMarker();
      const stateInfo = await optionalLstat(this.statePath);
      if (!stateInfo || !stateInfo.isFile() || stateInfo.isSymbolicLink()) {
        throw new FamilyRepositoryError("CORRUPT", "format normalization requires an existing regular state file");
      }
      const source = await readFile(this.statePath);
      const actualSha256 = createHash("sha256").update(source).digest("hex");
      if (actualSha256 !== expectedNoncanonicalFileSha256) {
        throw new FamilyRepositoryError("STALE_CORRUPT_FILE", "state bytes changed before format normalization");
      }
      const state = decodeRepositoryJson(source, { code: "CORRUPT", label: "repository state" });
      await assertRepositoryState(state);
      if (state.repositoryId !== this.repositoryId) {
        throw new FamilyRepositoryError("CORRUPT", "state belongs to a different repositoryId");
      }
      if (source.equals(encodeRepositoryJson(state))) {
        throw new FamilyRepositoryError("NORMALIZATION_NOT_REQUIRED", "repository state already uses canonical owned JSON");
      }
      const current = await readFile(this.statePath);
      if (createHash("sha256").update(current).digest("hex") !== expectedNoncanonicalFileSha256) {
        throw new FamilyRepositoryError("STALE_CORRUPT_FILE", "state bytes changed before format normalization commit");
      }
      await this.atomicWriteState(state);
      return {
        status: "normalized",
        headRevisionId: state.headRevisionId,
        stateGeneration: state.stateGeneration,
      };
    });
  }

  async readOutbox() {
    const state = await this.readState();
    return {
      repositoryId: state.repositoryId,
      epoch: state.outboxEpoch,
      nextSequence: state.nextOutboxSequence,
      events: clone(state.outbox),
    };
  }

  async stateSha256() {
    return repositoryStateSha256(await this.readState());
  }

  async exportStateForTest() {
    return clone(await this.readState());
  }

  async reopen() {
    return new AtomicJsonFamilyRepository({
      repositoryId: this.repositoryId,
      repositoryRoot: this.repositoryRoot,
      allowedRoot: this.allowedRoot,
      faultInjector: this.faultInjector,
    });
  }
}
