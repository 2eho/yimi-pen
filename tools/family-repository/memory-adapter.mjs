import {
  FamilyRepositoryError,
  assertRepositoryBackup,
  assertRepositoryState,
  createRepositoryBackup,
  decodeRepositoryJson,
  emptyRepositoryState,
  encodeRepositoryJson,
  planCommit,
  planPortableRestore,
  planRestore,
  repositoryStateSha256,
} from "./repository-core.mjs";

function clone(value) {
  return structuredClone(value);
}

export class MemoryFamilyRepository {
  constructor({ repositoryId, state = null }) {
    this.repositoryId = repositoryId;
    this.state = clone(state ?? emptyRepositoryState(repositoryId));
  }

  async assertState() {
    await assertRepositoryState(this.state);
    if (this.state.repositoryId !== this.repositoryId) {
      throw new FamilyRepositoryError("CORRUPT", "memory state belongs to a different repositoryId");
    }
  }

  async open() {
    await this.assertState();
    return {
      status: this.state.headRevisionId === null ? "empty" : "ready",
      repositoryId: this.state.repositoryId,
      familyLibraryId: this.state.familyLibraryId,
      headRevisionId: this.state.headRevisionId,
      headRevisionNumber: this.state.headRevisionNumber,
      stateGeneration: this.state.stateGeneration,
      outboxEpoch: this.state.outboxEpoch,
      nextOutboxSequence: this.state.nextOutboxSequence,
    };
  }

  async loadHead() {
    await this.assertState();
    return this.state.revisions.length ? clone(this.state.revisions.at(-1)) : null;
  }

  async loadRevision(revisionId) {
    await this.assertState();
    const revision = this.state.revisions.find((candidate) => candidate.revisionId === revisionId);
    return revision ? clone(revision) : null;
  }

  async commit(command) {
    await this.assertState();
    const plan = await planCommit(this.state, command);
    if (plan.changed) this.state = plan.state;
    return clone(plan.result);
  }

  async createBackup({ createdAt }) {
    await this.assertState();
    const backup = await createRepositoryBackup(this.state, { createdAt });
    return encodeRepositoryJson(backup);
  }

  async restore({ backupBytes, ...command }) {
    await this.assertState();
    const backup = decodeRepositoryJson(backupBytes, { code: "BACKUP_INVALID", label: "repository backup" });
    await assertRepositoryBackup(backup);
    const plan = await planRestore(this.state, { ...command, backup });
    if (plan.changed) this.state = plan.state;
    return clone(plan.result);
  }

  async restorePortable({ backupBytes, ...command }) {
    await this.assertState();
    const backup = decodeRepositoryJson(backupBytes, { code: "BACKUP_INVALID", label: "repository backup" });
    await assertRepositoryBackup(backup);
    const plan = await planPortableRestore(this.state, { ...command, backup });
    if (plan.changed) this.state = plan.state;
    return clone(plan.result);
  }

  async readOutbox() {
    await this.assertState();
    return {
      repositoryId: this.state.repositoryId,
      epoch: this.state.outboxEpoch,
      nextSequence: this.state.nextOutboxSequence,
      events: clone(this.state.outbox),
    };
  }

  async stateSha256() {
    await this.assertState();
    return repositoryStateSha256(this.state);
  }

  async exportStateForTest() {
    await this.assertState();
    return clone(this.state);
  }

  async reopen() {
    return new MemoryFamilyRepository({ repositoryId: this.repositoryId, state: this.state });
  }
}
