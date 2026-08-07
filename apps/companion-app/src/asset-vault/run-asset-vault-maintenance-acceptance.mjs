import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryFamilyRepository } from "../../../../tools/family-repository/memory-adapter.mjs";
import { commitImportedClipReplacement } from "../authoring/family-authoring-use-case.mjs";
import {
  applyAssetVaultMaintenance,
  planAssetVaultMaintenance,
} from "./asset-vault-maintenance-use-case.mjs";
import { createFamilyAssetReferenceCoordinator } from "./family-asset-reference-coordinator.mjs";
import { createLocalContentAddressedAudioVault } from "./local-content-addressed-audio-vault.mjs";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_ROOT, "../../../..");
const RUN_ROOT = path.join(REPO_ROOT, "build", "companion-asset-vault-maintenance-validation");
const BASE_REVISION_PATH = path.join(
  REPO_ROOT,
  "hardware/evt0/family-repository-v1/golden/family-revision.json",
);
const ALPHA_ASSET_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden/assets");

const OBSERVED_AT = "2026-08-04T00:00:00.000Z";
const APPLIED_AT = "2026-08-04T00:00:01.000Z";
const OLD_MTIME = "2026-08-03T00:00:00.000Z";
const YOUNG_MTIME = "2026-08-03T23:30:00.000Z";
const RETENTION_MS = 60 * 60 * 1_000;
const LIMITS = Object.freeze({
  maxBackupBytes: 4 * 1024 * 1024,
  maxEntries: 100,
  maxAssetBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function expectCode(action, expectedCode) {
  try {
    await action();
  } catch (error) {
    if (error?.code === expectedCode) return error;
    throw new Error(`expected ${expectedCode}, received ${error?.code ?? error?.name ?? "UNKNOWN"}`);
  }
  throw new Error(`expected ${expectedCode}, received success`);
}

function changedWav(source, offset, xorValue) {
  const bytes = Buffer.from(source);
  bytes[bytes.length - offset] ^= xorValue;
  return bytes;
}

async function writeContent(vaultRoot, bytes, timestamp) {
  const digest = sha256(bytes);
  const contentRoot = path.join(vaultRoot, "assets", "sha256");
  await mkdir(contentRoot, { recursive: true });
  const absolutePath = path.join(contentRoot, `${digest}.wav`);
  await writeFile(absolutePath, bytes, { flag: "wx" });
  const at = new Date(timestamp);
  await utimes(absolutePath, at, at);
  return Object.freeze({
    assetId: `asset-fixture-${digest.slice(0, 16)}`,
    contentPath: `assets/sha256/${digest}.wav`,
    absolutePath,
    bytes: bytes.length,
    sha256: digest,
    durationMs: 120,
    codec: "WAV_PCM16_16K_MONO",
  });
}

async function seedHistoricalFamily({ fixtureRoot }) {
  const vaultRoot = path.join(fixtureRoot, "asset-vault");
  const baseRevision = JSON.parse(await readFile(BASE_REVISION_PATH, "utf8"));
  const clipEntries = baseRevision.bindings.flatMap((binding) => binding.clips);
  for (const clip of clipEntries) {
    const bytes = Buffer.from(await readFile(path.join(ALPHA_ASSET_ROOT, `${clip.clipId}.wav`)));
    if (bytes.length !== clip.assetBytes || sha256(bytes) !== clip.assetSha256) {
      throw new Error(`${clip.clipId} golden bytes differ from FamilyRevision identity`);
    }
    await writeContent(vaultRoot, bytes, OLD_MTIME);
  }

  const source = Buffer.from(await readFile(path.join(ALPHA_ASSET_ROOT, "clip-013-1.wav")));
  const historicalReplacement = Object.freeze({
    ...await writeContent(vaultRoot, changedWav(source, 1, 0x01), OLD_MTIME),
    assetId: "asset-history-013-v2",
  });
  const oldOrphan = await writeContent(vaultRoot, changedWav(source, 2, 0x02), OLD_MTIME);
  const youngOrphan = await writeContent(vaultRoot, changedWav(source, 3, 0x04), YOUNG_MTIME);

  const repository = new MemoryFamilyRepository({
    repositoryId: "FAMILY-REPO-ASSET-VAULT-ACCEPTANCE-001",
  });
  const coordinator = createFamilyAssetReferenceCoordinator({ repository });
  await coordinator.withReferenceMutation((port) => port.commit({
    operationId: "OP-ASSET-VAULT-SEED-R1",
    revision: clone(baseRevision),
    expectedHeadRevisionId: null,
    at: baseRevision.createdAt,
  }));
  const authored = await coordinator.withReferenceMutation((port) => commitImportedClipReplacement({
    repository: port,
    operationId: "OP-ASSET-VAULT-HISTORY-R2",
    expectedHeadRevisionId: baseRevision.revisionId,
    createdAt: "2026-08-03T00:01:00.000Z",
    committedAt: "2026-08-03T00:01:01.000Z",
    contentRevision: "family-alpha-golden@0.1.1",
    bindingId: "binding-013",
    clipId: "clip-013-1",
    importedAsset: historicalReplacement,
    clipMetadata: {
      sourceKind: "family-recording",
      transcript: "历史版本的新录音。",
      mediaType: "voice",
      language: "zh-CN",
    },
    sourceProducer: { name: "asset-vault-acceptance", version: "1.0.0" },
  }));
  return {
    vaultRoot,
    repository,
    coordinator,
    baseRevision,
    headRevision: authored.revision,
    historicalReplacement,
    oldOrphan,
    youngOrphan,
    source,
  };
}

async function emptyFixture(name) {
  const fixtureRoot = path.join(RUN_ROOT, name);
  const vaultRoot = path.join(fixtureRoot, "asset-vault");
  const repository = new MemoryFamilyRepository({
    repositoryId: `FAMILY-REPO-${name.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, "-")}-001`,
  });
  return {
    fixtureRoot,
    vaultRoot,
    repository,
    coordinator: createFamilyAssetReferenceCoordinator({ repository }),
  };
}

async function runAcceptance() {
  await rm(RUN_ROOT, { recursive: true, force: true });
  await mkdir(RUN_ROOT, { recursive: true });
  const checks = [];
  const check = (name, passed, detail) => {
    if (!passed) throw new Error(`${name}: ${detail}`);
    checks.push({ name, passed: true, detail });
  };

  const primary = await seedHistoricalFamily({ fixtureRoot: path.join(RUN_ROOT, "primary") });
  const primaryVault = createLocalContentAddressedAudioVault({ vaultRoot: primary.vaultRoot });
  const plan = await planAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  check("all-history reference closure", plan.summary.referenceDigests === 11 && plan.summary.protected === 11,
    `references=${plan.summary.referenceDigests} protected=${plan.summary.protected}`);
  const originalDigest = primary.baseRevision.bindings[0].clips[0].assetSha256;
  check("superseded revision asset protected", plan.decisions.some((entry) => (
    entry.sha256 === originalDigest && entry.disposition === "PROTECT_REFERENCED"
  )), originalDigest);
  check("dry-run separates old and young orphans", plan.summary.eligible === 1 && plan.summary.retained === 1
    && plan.blockers.length === 0, `eligible=${plan.summary.eligible} retained=${plan.summary.retained}`);
  check("dry-run has zero file mutation", await exists(primary.oldOrphan.absolutePath)
    && await exists(primary.youngOrphan.absolutePath), "both orphan files remain after planning");

  const result = await applyAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    expectedPlan: plan,
    operationId: "ASSET-GC-PRIMARY-001",
    appliedAt: APPLIED_AT,
  });
  check("apply deletes exact eligible set", result.deleted.length === 1
    && result.deleted[0].sha256 === primary.oldOrphan.sha256
    && result.reclaimedBytes === primary.oldOrphan.bytes, result.resultId);
  check("retention protects young orphan", await exists(primary.youngOrphan.absolutePath), primary.youngOrphan.sha256);
  check("all historical references remain", await Promise.all(plan.decisions
    .filter((entry) => entry.disposition === "PROTECT_REFERENCED")
    .map((entry) => exists(path.join(primary.vaultRoot, ...entry.relativePath.split("/")))))
    .then((values) => values.every(Boolean)), "11/11 protected files remain");

  const replayPlan = await planAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  const replayResult = await applyAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    expectedPlan: replayPlan,
    operationId: "ASSET-GC-PRIMARY-REPLAY-001",
    appliedAt: "2026-08-04T00:00:02.000Z",
  });
  check("repeated maintenance cycle is idempotent", replayPlan.summary.eligible === 0
    && replayResult.deleted.length === 0 && replayResult.reclaimedBytes === 0,
  `eligible=${replayPlan.summary.eligible}`);

  const raceAsset = Object.freeze({
    ...await writeContent(primary.vaultRoot, changedWav(primary.source, 4, 0x08), OLD_MTIME),
    assetId: "asset-race-reference-v3",
  });
  const racePlan = await planAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  const raceCommit = await primary.coordinator.withReferenceMutation((port) => commitImportedClipReplacement({
    repository: port,
    operationId: "OP-ASSET-VAULT-RACE-R3",
    expectedHeadRevisionId: primary.headRevision.revisionId,
    createdAt: "2026-08-03T00:02:00.000Z",
    committedAt: "2026-08-03T00:02:01.000Z",
    contentRevision: "family-alpha-golden@0.1.2",
    bindingId: "binding-014",
    clipId: "clip-014-1",
    importedAsset: raceAsset,
    clipMetadata: {
      sourceKind: "family-recording",
      transcript: "并发新增引用。",
      mediaType: "voice",
      language: "zh-CN",
    },
    sourceProducer: { name: "asset-vault-acceptance", version: "1.0.0" },
  }));
  await expectCode(() => applyAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    expectedPlan: racePlan,
    operationId: "ASSET-GC-RACE-001",
    appliedAt: "2026-08-04T00:00:03.000Z",
  }), "ASSET_VAULT_PLAN_STALE");
  check("new historical reference invalidates dry-run", await exists(raceAsset.absolutePath)
    && raceCommit.revision.revisionId !== primary.headRevision.revisionId, raceAsset.sha256);

  const staleAsset = await writeContent(primary.vaultRoot, changedWav(primary.source, 5, 0x10), OLD_MTIME);
  const stalePlan = await planAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  const changedBytes = changedWav(primary.source, 6, 0x20);
  await writeFile(staleAsset.absolutePath, changedBytes);
  await utimes(staleAsset.absolutePath, new Date(OLD_MTIME), new Date(OLD_MTIME));
  await expectCode(() => applyAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    expectedPlan: stalePlan,
    operationId: "ASSET-GC-STALE-BYTES-001",
    appliedAt: "2026-08-04T00:00:04.000Z",
  }), "ASSET_VAULT_PLAN_STALE");
  check("changed candidate is preserved", await exists(staleAsset.absolutePath), staleAsset.sha256);

  const blockedPlan = await planAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  await expectCode(() => applyAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    expectedPlan: blockedPlan,
    operationId: "ASSET-GC-BLOCKED-001",
    appliedAt: "2026-08-04T00:00:05.000Z",
  }), "ASSET_VAULT_PLAN_BLOCKED");
  check("tamper blocks all apply mutations", blockedPlan.blockers.some((entry) => (
    entry.code === "ASSET_VAULT_TAMPERED_CONTENT"
  )) && await exists(primary.youngOrphan.absolutePath), `blockers=${blockedPlan.blockers.length}`);

  const missingPath = path.join(primary.vaultRoot, "assets", "sha256", `${originalDigest}.wav`);
  const heldPath = `${missingPath}.held`;
  await rename(missingPath, heldPath);
  const missingPlan = await planAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  await rename(heldPath, missingPath);
  check("missing historical reference is a blocker", missingPlan.blockers.some((entry) => (
    entry.code === "ASSET_VAULT_REFERENCED_ASSET_MISSING" && entry.sha256 === originalDigest
  )), originalDigest);
  await expectCode(() => planAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: { ...LIMITS, maxEntries: 1 },
  }), "ASSET_VAULT_INVENTORY_LIMIT");
  check("resource limit fails before mutation", await exists(primary.youngOrphan.absolutePath), "young orphan remains");

  const lease = await emptyFixture("lease");
  const leaseSource = Buffer.from(await readFile(path.join(ALPHA_ASSET_ROOT, "clip-013-1.wav")));
  const leaseOrphan = await writeContent(lease.vaultRoot, changedWav(leaseSource, 7, 0x40), OLD_MTIME);
  const leaseVault = createLocalContentAddressedAudioVault({ vaultRoot: lease.vaultRoot });
  const leasePlan = await planAssetVaultMaintenance({
    referencePort: lease.coordinator,
    vaultPort: leaseVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  let enteredDelete;
  let releaseDelete;
  const deleteEntered = new Promise((resolve) => { enteredDelete = resolve; });
  const deleteRelease = new Promise((resolve) => { releaseDelete = resolve; });
  const blockingVault = Object.freeze({
    inventory: (input) => leaseVault.inventory(input),
    async deleteBatchIfUnchanged(input) {
      enteredDelete();
      await deleteRelease;
      return leaseVault.deleteBatchIfUnchanged(input);
    },
  });
  const leaseApply = applyAssetVaultMaintenance({
    referencePort: lease.coordinator,
    vaultPort: blockingVault,
    expectedPlan: leasePlan,
    operationId: "ASSET-GC-LEASE-001",
    appliedAt: "2026-08-04T00:00:06.000Z",
  });
  await deleteEntered;
  let mutationEntered = false;
  const waitingMutation = lease.coordinator.withReferenceMutation(async () => { mutationEntered = true; });
  await new Promise((resolve) => setImmediate(resolve));
  check("stable snapshot lease blocks reference mutation", mutationEntered === false, "mutation remains queued");
  releaseDelete();
  await leaseApply;
  await waitingMutation;
  check("reference mutation resumes after cleanup", mutationEntered && !(await exists(leaseOrphan.absolutePath)),
    "queued mutation resumed after delete receipt");

  const rollback = await emptyFixture("rollback");
  const rollbackA = await writeContent(rollback.vaultRoot, changedWav(leaseSource, 8, 0x01), OLD_MTIME);
  const rollbackB = await writeContent(rollback.vaultRoot, changedWav(leaseSource, 9, 0x02), OLD_MTIME);
  const rollbackBaseVault = createLocalContentAddressedAudioVault({ vaultRoot: rollback.vaultRoot });
  const rollbackPlan = await planAssetVaultMaintenance({
    referencePort: rollback.coordinator,
    vaultPort: rollbackBaseVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  let renameCalls = 0;
  const rollbackVault = createLocalContentAddressedAudioVault({
    vaultRoot: rollback.vaultRoot,
    async renameFile(from, to) {
      renameCalls += 1;
      if (renameCalls === 2) {
        const error = new Error("injected second quarantine rename failure");
        error.code = "INJECTED_RENAME_FAILURE";
        throw error;
      }
      return rename(from, to);
    },
  });
  const rollbackError = await expectCode(() => applyAssetVaultMaintenance({
    referencePort: rollback.coordinator,
    vaultPort: rollbackVault,
    expectedPlan: rollbackPlan,
    operationId: "ASSET-GC-ROLLBACK-001",
    appliedAt: "2026-08-04T00:00:07.000Z",
  }), "ASSET_VAULT_DELETE_FAILED");
  check("delete failure rolls quarantine back", rollbackError.details.cleanupComplete === true
    && await exists(rollbackA.absolutePath) && await exists(rollbackB.absolutePath)
    && !(await exists(path.join(rollback.vaultRoot, ".maintenance"))),
  `renameCalls=${renameCalls}`);

  const partial = await emptyFixture("partial-purge");
  const partialA = await writeContent(partial.vaultRoot, changedWav(leaseSource, 10, 0x04), OLD_MTIME);
  const partialB = await writeContent(partial.vaultRoot, changedWav(leaseSource, 11, 0x08), OLD_MTIME);
  const partialBaseVault = createLocalContentAddressedAudioVault({ vaultRoot: partial.vaultRoot });
  const partialPlan = await planAssetVaultMaintenance({
    referencePort: partial.coordinator,
    vaultPort: partialBaseVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  let purgeCalls = 0;
  const partialVault = createLocalContentAddressedAudioVault({
    vaultRoot: partial.vaultRoot,
    async removePath(target, options) {
      purgeCalls += 1;
      if (purgeCalls === 2) {
        const error = new Error("injected second physical purge failure");
        error.code = "INJECTED_PURGE_FAILURE";
        throw error;
      }
      return rm(target, options);
    },
  });
  const partialError = await expectCode(() => applyAssetVaultMaintenance({
    referencePort: partial.coordinator,
    vaultPort: partialVault,
    expectedPlan: partialPlan,
    operationId: "ASSET-GC-PARTIAL-PURGE-001",
    appliedAt: "2026-08-04T00:00:07.500Z",
  }), "ASSET_VAULT_DELETE_PARTIAL");
  const deletedRelativePath = partialError.details.deleted[0]?.relativePath;
  const deletedAbsolutePath = path.join(partial.vaultRoot, ...deletedRelativePath.split("/"));
  const remaining = [partialA, partialB].find((entry) => entry.absolutePath !== deletedAbsolutePath);
  const partialRetryPlan = await planAssetVaultMaintenance({
    referencePort: partial.coordinator,
    vaultPort: partialBaseVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  const partialRetryResult = await applyAssetVaultMaintenance({
    referencePort: partial.coordinator,
    vaultPort: partialBaseVault,
    expectedPlan: partialRetryPlan,
    operationId: "ASSET-GC-PARTIAL-PURGE-RETRY-001",
    appliedAt: "2026-08-04T00:00:07.750Z",
  });
  check("partial purge is explicit and remaining orphan is replannable",
    purgeCalls === 2
      && partialError.details.cleanupComplete === true
      && partialError.details.deleted.length === 1
      && partialError.details.restored === 1
      && !(await exists(deletedAbsolutePath))
      && remaining && !(await exists(remaining.absolutePath))
      && partialRetryPlan.summary.eligible === 1
      && partialRetryResult.deleted.length === 1
      && !(await exists(path.join(partial.vaultRoot, ".maintenance"))),
    `deleted=${partialError.details.deleted.length} restored=${partialError.details.restored}`);

  const unsafe = await emptyFixture("unsafe");
  const unsafeRoot = path.join(unsafe.vaultRoot, "assets", "sha256");
  await mkdir(unsafeRoot, { recursive: true });
  const unsafeName = `${"a".repeat(64)}.wav`;
  const unsafePath = path.join(unsafeRoot, unsafeName);
  await mkdir(unsafePath);
  await utimes(unsafePath, new Date(OLD_MTIME), new Date(OLD_MTIME));
  const unmanagedPath = path.join(unsafeRoot, "notes.txt");
  await writeFile(unmanagedPath, "operator note", "utf8");
  await utimes(unmanagedPath, new Date(OLD_MTIME), new Date(OLD_MTIME));
  const unsafeVault = createLocalContentAddressedAudioVault({ vaultRoot: unsafe.vaultRoot });
  const unsafePlan = await planAssetVaultMaintenance({
    referencePort: unsafe.coordinator,
    vaultPort: unsafeVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  check("unsafe and unmanaged entries are reported", unsafePlan.blockers.some((entry) => (
    entry.code === "ASSET_VAULT_UNSAFE_ENTRY"
  )) && unsafePlan.blockers.some((entry) => entry.code === "ASSET_VAULT_UNMANAGED_ENTRY"),
  `blockers=${unsafePlan.blockers.length}`);
  await expectCode(() => applyAssetVaultMaintenance({
    referencePort: unsafe.coordinator,
    vaultPort: unsafeVault,
    expectedPlan: unsafePlan,
    operationId: "ASSET-GC-UNSAFE-001",
    appliedAt: "2026-08-04T00:00:08.000Z",
  }), "ASSET_VAULT_PLAN_BLOCKED");
  check("blocked unsafe plan is read-only", await exists(unsafePath) && await exists(unmanagedPath), "entries remain");

  const absent = await emptyFixture("absent");
  const absentVault = createLocalContentAddressedAudioVault({ vaultRoot: absent.vaultRoot });
  const absentPlan = await planAssetVaultMaintenance({
    referencePort: absent.coordinator,
    vaultPort: absentVault,
    observedAt: OBSERVED_AT,
    retentionMs: RETENTION_MS,
    limits: LIMITS,
  });
  const absentResult = await applyAssetVaultMaintenance({
    referencePort: absent.coordinator,
    vaultPort: absentVault,
    expectedPlan: absentPlan,
    operationId: "ASSET-GC-ABSENT-001",
    appliedAt: "2026-08-04T00:00:09.000Z",
  });
  check("absent empty vault stays absent", absentPlan.rootState === "MISSING"
    && absentResult.deleted.length === 0 && !(await exists(absent.vaultRoot)), absentResult.resultId);

  const invalidPlan = clone(plan);
  invalidPlan.retentionMs += 1;
  await expectCode(() => applyAssetVaultMaintenance({
    referencePort: primary.coordinator,
    vaultPort: primaryVault,
    expectedPlan: invalidPlan,
    operationId: "ASSET-GC-INVALID-PLAN-001",
    appliedAt: "2026-08-04T00:00:10.000Z",
  }), "ASSET_VAULT_PLAN_INVALID");
  check("plan identity rejects caller mutation", await exists(primary.youngOrphan.absolutePath), "vault unchanged");

  const report = {
    schemaVersion: 1,
    profile: "companion-asset-vault-maintenance-validation-v1",
    valid: true,
    fixtureOnly: true,
    checkSummary: { total: checks.length, passed: checks.length, failed: 0 },
    checks,
    evidence: {
      primaryPlanId: plan.planId,
      primaryResultId: result.resultId,
      referenceDigests: plan.summary.referenceDigests,
      protectedEntries: plan.summary.protected,
      eligibleEntries: plan.summary.eligible,
      retainedEntries: plan.summary.retained,
      reclaimedBytes: result.reclaimedBytes,
      stableReferenceLeaseIncluded: true,
      localFilesystemQuarantineRollbackIncluded: true,
      partialPhysicalPurgeRecoveryIncluded: true,
    },
    boundaries: {
      hostContentAddressedVaultIncluded: true,
      allHistoricalFamilyRevisionsIncluded: true,
      deviceStorageGcIncluded: false,
      crossProcessWriterLeaseIncluded: false,
      crashAfterPartialPhysicalPurgeIncluded: false,
    },
  };
  const reportPath = path.join(RUN_ROOT, "report.json");
  await writeFile(reportPath, encode(report));
  const reportSha256 = sha256(await readFile(reportPath));
  console.log(`Asset-vault maintenance acceptance: ${checks.length}/${checks.length}`);
  console.log(`Asset-vault maintenance report SHA-256: ${reportSha256}`);
  console.log(`Report: ${reportPath}`);
}

await runAcceptance();
