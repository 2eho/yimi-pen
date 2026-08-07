import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import { isStrictRfc3339 } from "../../../../contracts/rfc3339.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const INVENTORY_ID = /^vault-inventory:sha256:[a-f0-9]{64}$/u;
const PLAN_ID = /^asset-vault-plan:sha256:[a-f0-9]{64}$/u;
const RESULT_ID = /^asset-vault-result:sha256:[a-f0-9]{64}$/u;
const ENTRY_TOKEN = /^asset-entry:sha256:[a-f0-9]{64}$/u;
const JOURNAL_ID = /^asset-vault-journal:sha256:[a-f0-9]{64}$/u;
const RECOVERY_ID = /^asset-vault-recovery:sha256:[a-f0-9]{64}$/u;
const OPERATION_ID = /^ASSET-GC-[A-Z0-9][A-Z0-9._-]{2,95}$/u;

export const ASSET_VAULT_JOURNAL_PHASES = Object.freeze([
  "QUARANTINING",
  "PURGING",
]);

export const ASSET_VAULT_RECOVERY_STATUSES = Object.freeze([
  "NO_PENDING_OPERATION",
  "EMPTY_OPERATION_CLEANED",
  "ROLLED_BACK_BEFORE_PURGE",
  "PARTIAL_PURGE_RECOVERED",
]);

export const ASSET_ENTRY_CLASSES = Object.freeze([
  "VALID_CONTENT",
  "TAMPERED_CONTENT",
  "UNMANAGED_ENTRY",
  "UNSAFE_ENTRY",
]);

export const ASSET_DISPOSITIONS = Object.freeze([
  "PROTECT_REFERENCED",
  "RETAIN_YOUNG",
  "DELETE_ELIGIBLE",
  "BLOCK_INTEGRITY",
  "BLOCK_CLOCK_SKEW",
]);

export class AssetVaultMaintenanceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AssetVaultMaintenanceError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

export function failAssetVaultMaintenance(code, message, details) {
  throw new AssetVaultMaintenanceError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) failAssetVaultMaintenance(code, message, details);
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function withoutIdentity(value, key) {
  const { [key]: _identity, ...subject } = value;
  return subject;
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

export function computeAssetEntryVersionToken(entry) {
  return `asset-entry:sha256:${canonicalSha256(withoutIdentity(entry, "versionToken")).sha256}`;
}

export function computeAssetVaultInventoryId(inventory) {
  return `vault-inventory:sha256:${canonicalSha256(withoutIdentity(inventory, "inventoryId")).sha256}`;
}

export function computeAssetVaultPlanId(plan) {
  return `asset-vault-plan:sha256:${canonicalSha256(withoutIdentity(plan, "planId")).sha256}`;
}

export function computeAssetVaultResultId(result) {
  return `asset-vault-result:sha256:${canonicalSha256(withoutIdentity(result, "resultId")).sha256}`;
}

export function computeAssetVaultMaintenanceJournalId(journal) {
  return `asset-vault-journal:sha256:${canonicalSha256(withoutIdentity(journal, "journalId")).sha256}`;
}

export function computeAssetVaultRecoveryId(receipt) {
  return `asset-vault-recovery:sha256:${canonicalSha256(withoutIdentity(receipt, "recoveryId")).sha256}`;
}

export function validateAssetVaultLimits(input) {
  assert(input && typeof input === "object" && !Array.isArray(input),
    "ASSET_VAULT_LIMITS_INVALID", "an explicit asset-vault resource policy is required");
  const limits = {};
  for (const key of ["maxBackupBytes", "maxEntries", "maxAssetBytes", "maxTotalBytes"]) {
    const value = input[key];
    assert(Number.isSafeInteger(value) && value > 0,
      "ASSET_VAULT_LIMITS_INVALID", `${key} must be a positive safe integer`, { key, value });
    limits[key] = value;
  }
  return Object.freeze(limits);
}

export function assertAssetVaultInventory(inventory, inputLimits) {
  const limits = validateAssetVaultLimits(inputLimits);
  assert(inventory && typeof inventory === "object" && !Array.isArray(inventory),
    "ASSET_VAULT_INVENTORY_INVALID", "asset-vault inventory receipt is required");
  assert(inventory.schemaVersion === 1 && inventory.profile === "asset-vault-inventory-v1"
    && INVENTORY_ID.test(inventory.inventoryId ?? "")
    && ["MISSING", "READY"].includes(inventory.rootState)
    && Array.isArray(inventory.entries)
    && Number.isSafeInteger(inventory.totalBytes) && inventory.totalBytes >= 0,
  "ASSET_VAULT_INVENTORY_INVALID", "asset-vault inventory header is malformed");
  assert(inventory.entries.length <= limits.maxEntries && inventory.totalBytes <= limits.maxTotalBytes,
    "ASSET_VAULT_INVENTORY_LIMIT", "asset-vault inventory exceeds its resource policy");

  let previous = null;
  let totalBytes = 0;
  for (const entry of inventory.entries) {
    assert(entry && typeof entry === "object" && !Array.isArray(entry)
      && typeof entry.relativePath === "string"
      && /^assets\/sha256\/[A-Za-z0-9._-]+$/u.test(entry.relativePath)
      && ASSET_ENTRY_CLASSES.includes(entry.entryClass)
      && (entry.declaredSha256 === null || SHA256.test(entry.declaredSha256))
      && (entry.actualSha256 === null || SHA256.test(entry.actualSha256))
      && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= limits.maxAssetBytes
      && isStrictRfc3339(entry.modifiedAt)
      && ENTRY_TOKEN.test(entry.versionToken ?? ""),
    "ASSET_VAULT_INVENTORY_INVALID", "asset-vault inventory entry is malformed", {
      relativePath: entry?.relativePath ?? null,
    });
    assert(previous === null || ordinalCompare(previous, entry.relativePath) < 0,
      "ASSET_VAULT_INVENTORY_INVALID", "asset-vault inventory entries must be strictly sorted");
    assert(entry.versionToken === computeAssetEntryVersionToken(entry),
      "ASSET_VAULT_INVENTORY_INVALID", "asset-vault entry version token mismatch", {
        relativePath: entry.relativePath,
      });
    if (entry.entryClass === "VALID_CONTENT") {
      assert(entry.declaredSha256 !== null && entry.actualSha256 === entry.declaredSha256 && entry.bytes > 0,
        "ASSET_VAULT_INVENTORY_INVALID", "valid content entry identity is inconsistent");
    }
    if (entry.entryClass === "TAMPERED_CONTENT") {
      assert(entry.declaredSha256 !== null && entry.actualSha256 !== null
        && entry.actualSha256 !== entry.declaredSha256 && entry.bytes > 0,
      "ASSET_VAULT_INVENTORY_INVALID", "tampered content entry identity is inconsistent");
    }
    previous = entry.relativePath;
    totalBytes += entry.bytes;
    assert(Number.isSafeInteger(totalBytes) && totalBytes <= limits.maxTotalBytes,
      "ASSET_VAULT_INVENTORY_LIMIT", "asset-vault inventory byte total exceeds its resource policy");
  }
  assert(totalBytes === inventory.totalBytes,
    "ASSET_VAULT_INVENTORY_INVALID", "asset-vault inventory byte total mismatch");
  assert(inventory.inventoryId === computeAssetVaultInventoryId(inventory),
    "ASSET_VAULT_INVENTORY_INVALID", "asset-vault inventory identity mismatch");
  return inventory;
}

export function assertAssetVaultPlan(plan) {
  assert(plan && typeof plan === "object" && !Array.isArray(plan)
    && plan.schemaVersion === 1
    && plan.profile === "asset-vault-maintenance-plan-v1"
    && PLAN_ID.test(plan.planId ?? "")
    && SHA256.test(plan.referenceStateSha256 ?? "")
    && INVENTORY_ID.test(plan.inventoryId ?? "")
    && isStrictRfc3339(plan.observedAt)
    && Number.isSafeInteger(plan.retentionMs) && plan.retentionMs > 0
    && Array.isArray(plan.references)
    && Array.isArray(plan.decisions)
    && Array.isArray(plan.blockers)
    && plan.summary && typeof plan.summary === "object",
  "ASSET_VAULT_PLAN_INVALID", "asset-vault maintenance plan is malformed");
  validateAssetVaultLimits(plan.limits);
  assert(plan.planId === computeAssetVaultPlanId(plan),
    "ASSET_VAULT_PLAN_INVALID", "asset-vault maintenance plan identity mismatch");
  return plan;
}

export function assertAssetVaultResult(result) {
  assert(result && typeof result === "object" && !Array.isArray(result)
    && result.schemaVersion === 1
    && result.profile === "asset-vault-maintenance-result-v1"
    && RESULT_ID.test(result.resultId ?? "")
    && PLAN_ID.test(result.planId ?? "")
    && SHA256.test(result.referenceStateSha256 ?? "")
    && typeof result.operationId === "string"
    && isStrictRfc3339(result.appliedAt)
    && Array.isArray(result.deleted)
    && Number.isSafeInteger(result.reclaimedBytes) && result.reclaimedBytes >= 0
    && result.cleanupComplete === true,
  "ASSET_VAULT_RESULT_INVALID", "asset-vault maintenance result is malformed");
  assert(result.resultId === computeAssetVaultResultId(result),
    "ASSET_VAULT_RESULT_INVALID", "asset-vault maintenance result identity mismatch");
  return result;
}

function assertJournalCandidate(candidate, limits, previousPath) {
  assert(hasExactKeys(candidate, ["relativePath", "sha256", "bytes", "modifiedAt", "versionToken"])
    && SHA256.test(candidate.sha256 ?? "")
    && candidate.relativePath === `assets/sha256/${candidate.sha256}.wav`
    && Number.isSafeInteger(candidate.bytes) && candidate.bytes > 0 && candidate.bytes <= limits.maxAssetBytes
    && isStrictRfc3339(candidate.modifiedAt)
    && ENTRY_TOKEN.test(candidate.versionToken ?? "")
    && (previousPath === null || ordinalCompare(previousPath, candidate.relativePath) < 0),
  "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "asset-vault maintenance journal candidate is malformed", {
    relativePath: candidate?.relativePath ?? null,
  });
  const entry = {
    relativePath: candidate.relativePath,
    entryClass: "VALID_CONTENT",
    declaredSha256: candidate.sha256,
    actualSha256: candidate.sha256,
    bytes: candidate.bytes,
    modifiedAt: candidate.modifiedAt,
    versionToken: candidate.versionToken,
  };
  assert(candidate.versionToken === computeAssetEntryVersionToken(entry),
    "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "asset-vault journal candidate version token mismatch", {
      relativePath: candidate.relativePath,
    });
}

export function assertAssetVaultMaintenanceJournal(journal) {
  const topLevelKeys = [
    "schemaVersion", "profile", "journalId", "operationId", "planId", "referenceStateSha256",
    "inventoryId", "limits", "phase", "committedPurgeCount", "candidates",
  ];
  assert(hasExactKeys(journal, topLevelKeys)
    && journal.schemaVersion === 1
    && journal.profile === "asset-vault-maintenance-journal-v1"
    && JOURNAL_ID.test(journal.journalId ?? "")
    && OPERATION_ID.test(journal.operationId ?? "")
    && PLAN_ID.test(journal.planId ?? "")
    && SHA256.test(journal.referenceStateSha256 ?? "")
    && INVENTORY_ID.test(journal.inventoryId ?? "")
    && ASSET_VAULT_JOURNAL_PHASES.includes(journal.phase)
    && Number.isSafeInteger(journal.committedPurgeCount)
    && Array.isArray(journal.candidates) && journal.candidates.length > 0,
  "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "asset-vault maintenance journal header is malformed");
  assert(hasExactKeys(journal.limits, ["maxBackupBytes", "maxEntries", "maxAssetBytes", "maxTotalBytes"]),
    "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "asset-vault maintenance journal limits are malformed");
  const limits = validateAssetVaultLimits(journal.limits);
  assert(journal.candidates.length <= limits.maxEntries
    && journal.committedPurgeCount >= 0
    && journal.committedPurgeCount <= journal.candidates.length
    && (journal.phase === "PURGING" || journal.committedPurgeCount === 0),
  "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "asset-vault maintenance journal progress is malformed");
  let totalBytes = 0;
  let previousPath = null;
  for (const candidate of journal.candidates) {
    assertJournalCandidate(candidate, limits, previousPath);
    previousPath = candidate.relativePath;
    totalBytes += candidate.bytes;
    assert(Number.isSafeInteger(totalBytes) && totalBytes <= limits.maxTotalBytes,
      "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "asset-vault journal candidate bytes exceed policy");
  }
  assert(journal.journalId === computeAssetVaultMaintenanceJournalId(journal),
    "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "asset-vault maintenance journal identity mismatch");
  return journal;
}

function assertRecoveryEntry(entry) {
  assert(hasExactKeys(entry, ["relativePath", "sha256", "bytes"])
    && SHA256.test(entry.sha256 ?? "")
    && entry.relativePath === `assets/sha256/${entry.sha256}.wav`
    && Number.isSafeInteger(entry.bytes) && entry.bytes > 0,
  "ASSET_VAULT_RECOVERY_RECEIPT_INVALID", "asset-vault recovery entry is malformed");
}

export function assertAssetVaultRecoveryReceipt(receipt) {
  const keys = [
    "schemaVersion", "profile", "recoveryId", "status", "journalId", "operationId", "planId",
    "referenceStateSha256", "inventoryId", "phase", "deleted", "restored", "reclaimedBytes",
    "postRecoveryInventoryId", "requiresFreshPlan", "cleanupComplete",
  ];
  assert(hasExactKeys(receipt, keys)
    && receipt.schemaVersion === 1
    && receipt.profile === "asset-vault-maintenance-recovery-v1"
    && RECOVERY_ID.test(receipt.recoveryId ?? "")
    && ASSET_VAULT_RECOVERY_STATUSES.includes(receipt.status)
    && Array.isArray(receipt.deleted)
    && Array.isArray(receipt.restored)
    && Number.isSafeInteger(receipt.reclaimedBytes) && receipt.reclaimedBytes >= 0
    && typeof receipt.requiresFreshPlan === "boolean"
    && receipt.cleanupComplete === true,
  "ASSET_VAULT_RECOVERY_RECEIPT_INVALID", "asset-vault recovery receipt header is malformed");
  for (const entry of [...receipt.deleted, ...receipt.restored]) assertRecoveryEntry(entry);
  const reclaimed = receipt.deleted.reduce((total, entry) => total + entry.bytes, 0);
  assert(Number.isSafeInteger(reclaimed) && reclaimed === receipt.reclaimedBytes,
    "ASSET_VAULT_RECOVERY_RECEIPT_INVALID", "asset-vault recovery reclaimed bytes mismatch");
  const clean = ["NO_PENDING_OPERATION", "EMPTY_OPERATION_CLEANED"].includes(receipt.status);
  assert(clean
    ? receipt.journalId === null && receipt.operationId === null && receipt.planId === null
      && receipt.referenceStateSha256 === null && receipt.inventoryId === null && receipt.phase === null
      && receipt.deleted.length === 0 && receipt.restored.length === 0
      && receipt.postRecoveryInventoryId === null && receipt.requiresFreshPlan === false
    : JOURNAL_ID.test(receipt.journalId ?? "") && OPERATION_ID.test(receipt.operationId ?? "")
      && PLAN_ID.test(receipt.planId ?? "") && SHA256.test(receipt.referenceStateSha256 ?? "")
      && INVENTORY_ID.test(receipt.inventoryId ?? "") && ASSET_VAULT_JOURNAL_PHASES.includes(receipt.phase)
      && INVENTORY_ID.test(receipt.postRecoveryInventoryId ?? "") && receipt.requiresFreshPlan === true,
  "ASSET_VAULT_RECOVERY_RECEIPT_INVALID", "asset-vault recovery receipt state is inconsistent");
  assert(receipt.recoveryId === computeAssetVaultRecoveryId(receipt),
    "ASSET_VAULT_RECOVERY_RECEIPT_INVALID", "asset-vault recovery receipt identity mismatch");
  return receipt;
}
