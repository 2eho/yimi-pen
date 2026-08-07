import { collectReferencedFamilyAssets } from "../../../../contracts/family-export-v1.mjs";
import { isStrictRfc3339 } from "../../../../contracts/rfc3339.mjs";
import {
  ASSET_DISPOSITIONS,
  assertAssetVaultInventory,
  assertAssetVaultPlan,
  assertAssetVaultResult,
  computeAssetVaultPlanId,
  computeAssetVaultResultId,
  failAssetVaultMaintenance,
  validateAssetVaultLimits,
} from "./asset-vault-maintenance-contract.mjs";

const OPERATION_ID = /^ASSET-GC-[A-Z0-9][A-Z0-9._-]{2,95}$/u;

function assert(condition, code, message, details) {
  if (!condition) failAssetVaultMaintenance(code, message, details);
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertPorts(referencePort, vaultPort) {
  assert(referencePort
    && typeof referencePort.captureReferenceSnapshot === "function"
    && typeof referencePort.withStableReferenceSnapshot === "function",
  "ASSET_VAULT_REFERENCE_PORT_INVALID", "asset-vault maintenance requires reference snapshot ports");
  assert(vaultPort
    && typeof vaultPort.inventory === "function"
    && typeof vaultPort.deleteBatchIfUnchanged === "function",
  "ASSET_VAULT_PORT_INVALID", "asset-vault maintenance requires inventory and conditional delete ports");
}

function buildReferenceMarks(backup, limits) {
  let referenced;
  try {
    referenced = collectReferencedFamilyAssets(backup);
  } catch (error) {
    failAssetVaultMaintenance(
      "ASSET_VAULT_REFERENCE_SNAPSHOT_INVALID",
      "FamilyRepository reference snapshot contains conflicting asset identities",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  assert(referenced.length <= limits.maxEntries,
    "ASSET_VAULT_REFERENCE_LIMIT", "historical asset references exceed the active resource policy", {
      references: referenced.length,
      maxEntries: limits.maxEntries,
    });
  const byDigest = new Map();
  for (const reference of referenced) {
    const current = byDigest.get(reference.sha256) ?? {
      sha256: reference.sha256,
      bytes: reference.bytes,
      assetIds: [],
    };
    if (!current.assetIds.includes(reference.assetId)) current.assetIds.push(reference.assetId);
    byDigest.set(reference.sha256, current);
  }
  return [...byDigest.values()]
    .map((mark) => ({ ...mark, assetIds: mark.assetIds.sort(ordinalCompare) }))
    .sort((left, right) => ordinalCompare(left.sha256, right.sha256));
}

function planFromEvidence({ snapshot, inventory, observedAt, retentionMs, limits }) {
  const observedMs = Date.parse(observedAt);
  const references = buildReferenceMarks(snapshot.backup, limits);
  const referencesByDigest = new Map(references.map((reference) => [reference.sha256, reference]));
  const validByDigest = new Map();
  const decisions = [];
  const blockers = [];

  for (const entry of inventory.entries) {
    let disposition;
    let reason;
    let referencedBy = [];
    if (entry.entryClass !== "VALID_CONTENT") {
      disposition = "BLOCK_INTEGRITY";
      reason = entry.entryClass;
      blockers.push({
        code: `ASSET_VAULT_${entry.entryClass}`,
        relativePath: entry.relativePath,
        sha256: entry.declaredSha256,
      });
    } else {
      validByDigest.set(entry.declaredSha256, entry);
      const reference = referencesByDigest.get(entry.declaredSha256);
      if (reference) {
        disposition = "PROTECT_REFERENCED";
        reason = "ALL_HISTORY_REFERENCE";
        referencedBy = [...reference.assetIds];
        if (reference.bytes !== entry.bytes) {
          disposition = "BLOCK_INTEGRITY";
          reason = "REFERENCE_BYTES_MISMATCH";
          blockers.push({
            code: "ASSET_VAULT_REFERENCE_BYTES_MISMATCH",
            relativePath: entry.relativePath,
            sha256: entry.declaredSha256,
          });
        }
      } else {
        const ageMs = observedMs - Date.parse(entry.modifiedAt);
        if (ageMs < 0) {
          disposition = "BLOCK_CLOCK_SKEW";
          reason = "MODIFIED_AFTER_OBSERVATION";
          blockers.push({
            code: "ASSET_VAULT_CLOCK_SKEW",
            relativePath: entry.relativePath,
            sha256: entry.declaredSha256,
          });
        } else if (ageMs < retentionMs) {
          disposition = "RETAIN_YOUNG";
          reason = "RETENTION_WINDOW_ACTIVE";
        } else {
          disposition = "DELETE_ELIGIBLE";
          reason = "UNREFERENCED_RETENTION_EXPIRED";
        }
      }
    }
    assert(ASSET_DISPOSITIONS.includes(disposition),
      "ASSET_VAULT_PLAN_INVALID", "asset-vault disposition is outside the application contract");
    decisions.push({
      relativePath: entry.relativePath,
      sha256: entry.declaredSha256,
      bytes: entry.bytes,
      modifiedAt: entry.modifiedAt,
      versionToken: entry.versionToken,
      disposition,
      reason,
      referencedBy,
    });
  }

  for (const reference of references) {
    if (!validByDigest.has(reference.sha256)) {
      blockers.push({
        code: "ASSET_VAULT_REFERENCED_ASSET_MISSING",
        relativePath: `assets/sha256/${reference.sha256}.wav`,
        sha256: reference.sha256,
      });
    }
  }
  blockers.sort((left, right) => (
    ordinalCompare(left.code, right.code)
      || ordinalCompare(left.relativePath ?? "", right.relativePath ?? "")
      || ordinalCompare(left.sha256 ?? "", right.sha256 ?? "")
  ));

  const count = (disposition) => decisions.filter((entry) => entry.disposition === disposition).length;
  const plan = {
    schemaVersion: 1,
    profile: "asset-vault-maintenance-plan-v1",
    planId: `asset-vault-plan:sha256:${"0".repeat(64)}`,
    observedAt,
    retentionMs,
    limits: { ...limits },
    referenceStateSha256: snapshot.referenceStateSha256,
    inventoryId: inventory.inventoryId,
    rootState: inventory.rootState,
    references,
    decisions,
    blockers,
    summary: {
      referenceDigests: references.length,
      inventoryEntries: inventory.entries.length,
      inventoryBytes: inventory.totalBytes,
      protected: count("PROTECT_REFERENCED"),
      retained: count("RETAIN_YOUNG"),
      eligible: count("DELETE_ELIGIBLE"),
      blocked: count("BLOCK_INTEGRITY") + count("BLOCK_CLOCK_SKEW"),
      blockerCount: blockers.length,
    },
  };
  plan.planId = computeAssetVaultPlanId(plan);
  assertAssetVaultPlan(plan);
  return deepFreeze(plan);
}

function validatePlanningInput({ referencePort, vaultPort, observedAt, retentionMs, limits: inputLimits }) {
  assertPorts(referencePort, vaultPort);
  assert(isStrictRfc3339(observedAt),
    "ASSET_VAULT_TIME_INVALID", "asset-vault observation timestamp must be strict RFC3339");
  assert(Number.isSafeInteger(retentionMs) && retentionMs > 0,
    "ASSET_VAULT_RETENTION_INVALID", "asset-vault retention must be a positive integer in milliseconds");
  return validateAssetVaultLimits(inputLimits);
}

export async function planAssetVaultMaintenance({
  referencePort,
  vaultPort,
  observedAt,
  retentionMs,
  limits: inputLimits,
}) {
  const limits = validatePlanningInput({ referencePort, vaultPort, observedAt, retentionMs, limits: inputLimits });
  const snapshot = await referencePort.captureReferenceSnapshot({
    createdAt: observedAt,
    maxBackupBytes: limits.maxBackupBytes,
  });
  assert(snapshot?.backup && snapshot.referenceStateSha256 === snapshot.backup.sourceStateSha256,
    "ASSET_VAULT_REFERENCE_SNAPSHOT_INVALID", "reference snapshot receipt is malformed");
  const inventory = await vaultPort.inventory({ limits });
  assertAssetVaultInventory(inventory, limits);
  return planFromEvidence({ snapshot, inventory, observedAt, retentionMs, limits });
}

function expectedDeleted(plan) {
  return plan.decisions
    .filter((entry) => entry.disposition === "DELETE_ELIGIBLE")
    .map(({ relativePath, sha256, bytes, modifiedAt, versionToken }) => ({
      relativePath,
      sha256,
      bytes,
      modifiedAt,
      versionToken,
    }));
}

function assertDeleteReceipt(receipt, { operationId, planId, referenceStateSha256, inventoryId, candidates }) {
  assert(receipt && typeof receipt === "object"
    && receipt.operationId === operationId
    && receipt.planId === planId
    && receipt.referenceStateSha256 === referenceStateSha256
    && receipt.inventoryId === inventoryId
    && receipt.cleanupComplete === true
    && Array.isArray(receipt.deleted)
    && Number.isSafeInteger(receipt.reclaimedBytes) && receipt.reclaimedBytes >= 0,
  "ASSET_VAULT_DELETE_RECEIPT_INVALID", "asset-vault delete port returned a malformed receipt");
  const expected = candidates.map(({ relativePath, sha256, bytes }) => ({ relativePath, sha256, bytes }));
  const actual = receipt.deleted.map(({ relativePath, sha256, bytes }) => ({ relativePath, sha256, bytes }));
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    "ASSET_VAULT_DELETE_RECEIPT_INVALID", "asset-vault delete receipt differs from its eligible plan");
  assert(receipt.reclaimedBytes === expected.reduce((total, entry) => total + entry.bytes, 0),
    "ASSET_VAULT_DELETE_RECEIPT_INVALID", "asset-vault reclaimed byte count is inconsistent");
}

export async function applyAssetVaultMaintenance({
  referencePort,
  vaultPort,
  expectedPlan,
  operationId,
  appliedAt,
}) {
  assertPorts(referencePort, vaultPort);
  assertAssetVaultPlan(expectedPlan);
  assert(OPERATION_ID.test(operationId ?? ""),
    "ASSET_VAULT_OPERATION_INVALID", "asset-vault cleanup operation ID is malformed");
  assert(isStrictRfc3339(appliedAt) && Date.parse(appliedAt) >= Date.parse(expectedPlan.observedAt),
    "ASSET_VAULT_TIME_INVALID", "asset-vault apply timestamp must be strict and not precede its plan");
  assert(expectedPlan.blockers.length === 0,
    "ASSET_VAULT_PLAN_BLOCKED", "asset-vault cleanup plan contains integrity blockers", {
      planId: expectedPlan.planId,
      blockerCount: expectedPlan.blockers.length,
    });

  return referencePort.withStableReferenceSnapshot({
    createdAt: appliedAt,
    maxBackupBytes: expectedPlan.limits.maxBackupBytes,
  }, async (snapshot) => {
    const inventory = await vaultPort.inventory({ limits: expectedPlan.limits });
    assertAssetVaultInventory(inventory, expectedPlan.limits);
    const currentPlan = planFromEvidence({
      snapshot,
      inventory,
      observedAt: expectedPlan.observedAt,
      retentionMs: expectedPlan.retentionMs,
      limits: expectedPlan.limits,
    });
    assert(currentPlan.planId === expectedPlan.planId,
      "ASSET_VAULT_PLAN_STALE", "asset-vault references or bytes changed after dry-run", {
        expectedPlanId: expectedPlan.planId,
        currentPlanId: currentPlan.planId,
      });
    const candidates = expectedDeleted(currentPlan);
    let deleteReceipt = {
      operationId,
      planId: currentPlan.planId,
      referenceStateSha256: currentPlan.referenceStateSha256,
      inventoryId: currentPlan.inventoryId,
      deleted: [],
      reclaimedBytes: 0,
      cleanupComplete: true,
    };
    if (candidates.length > 0) {
      deleteReceipt = await vaultPort.deleteBatchIfUnchanged({
        operationId,
        planId: currentPlan.planId,
        referenceStateSha256: currentPlan.referenceStateSha256,
        inventoryId: currentPlan.inventoryId,
        candidates,
        limits: currentPlan.limits,
      });
    }
    assertDeleteReceipt(deleteReceipt, {
      operationId,
      planId: currentPlan.planId,
      referenceStateSha256: currentPlan.referenceStateSha256,
      inventoryId: currentPlan.inventoryId,
      candidates,
    });
    const result = {
      schemaVersion: 1,
      profile: "asset-vault-maintenance-result-v1",
      resultId: `asset-vault-result:sha256:${"0".repeat(64)}`,
      operationId,
      planId: currentPlan.planId,
      referenceStateSha256: currentPlan.referenceStateSha256,
      appliedAt,
      deleted: deleteReceipt.deleted.map(({ relativePath, sha256, bytes }) => ({
        relativePath,
        sha256,
        bytes,
      })),
      reclaimedBytes: deleteReceipt.reclaimedBytes,
      cleanupComplete: true,
    };
    result.resultId = computeAssetVaultResultId(result);
    assertAssetVaultResult(result);
    return deepFreeze(result);
  });
}
