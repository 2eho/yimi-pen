import { parseJsonRejectingDuplicateKeys } from "../../../../contracts/strict-json-v1.mjs";
import { isStrictRfc3339 } from "../../../../contracts/rfc3339.mjs";
import { assertRepositoryBackup } from "../../../../tools/family-repository/repository-core.mjs";
import {
  AssetVaultMaintenanceError,
  failAssetVaultMaintenance,
} from "./asset-vault-maintenance-contract.mjs";

function assert(condition, code, message, details) {
  if (!condition) failAssetVaultMaintenance(code, message, details);
}

function createExclusiveQueue() {
  let tail = Promise.resolve();
  return async function runExclusive(action) {
    let release;
    const previous = tail;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  };
}

function parseBackup(bytes) {
  try {
    return parseJsonRejectingDuplicateKeys(bytes.toString("utf8"), "asset-vault reference snapshot");
  } catch (error) {
    throw new AssetVaultMaintenanceError(
      "ASSET_VAULT_REFERENCE_SNAPSHOT_INVALID",
      "FamilyRepository returned a malformed reference snapshot",
      { causeCode: error?.code ?? error?.name ?? "UNKNOWN" },
    );
  }
}

/**
 * App-local serialization seam shared by FamilyRevision mutations and vault GC.
 * The composition root must route every reference mutation through the returned
 * withReferenceMutation function for withStableSnapshot to be authoritative.
 */
export function createFamilyAssetReferenceCoordinator({ repository }) {
  assert(repository && typeof repository.createBackup === "function",
    "ASSET_VAULT_REFERENCE_PORT_INVALID", "FamilyRepository backup port is required");
  const runExclusive = createExclusiveQueue();

  async function snapshot({ createdAt, maxBackupBytes }) {
    assert(isStrictRfc3339(createdAt),
      "ASSET_VAULT_TIME_INVALID", "reference snapshot timestamp must be strict RFC3339");
    assert(Number.isSafeInteger(maxBackupBytes) && maxBackupBytes > 0,
      "ASSET_VAULT_LIMITS_INVALID", "maxBackupBytes must be a positive safe integer");
    const backupBytes = Buffer.from(await repository.createBackup({ createdAt }));
    assert(backupBytes.length <= maxBackupBytes,
      "ASSET_VAULT_REFERENCE_LIMIT", "FamilyRepository backup exceeds the active resource policy", {
        bytes: backupBytes.length,
        maxBackupBytes,
      });
    const backup = parseBackup(backupBytes);
    try {
      await assertRepositoryBackup(backup, "ASSET_VAULT_REFERENCE_SNAPSHOT_INVALID");
    } catch (error) {
      throw new AssetVaultMaintenanceError(
        "ASSET_VAULT_REFERENCE_SNAPSHOT_INVALID",
        "FamilyRepository reference snapshot failed its canonical contract",
        { causeCode: error?.code ?? error?.name ?? "UNKNOWN" },
      );
    }
    return Object.freeze({
      referenceStateSha256: backup.sourceStateSha256,
      backupId: backup.backupId,
      backup: structuredClone(backup),
    });
  }

  return Object.freeze({
    captureReferenceSnapshot(input) {
      return runExclusive(() => snapshot(input));
    },
    withStableReferenceSnapshot(input, action) {
      assert(typeof action === "function",
        "ASSET_VAULT_REFERENCE_PORT_INVALID", "stable reference snapshot callback is required");
      return runExclusive(async () => action(await snapshot(input)));
    },
    withReferenceMutation(action) {
      assert(typeof action === "function",
        "ASSET_VAULT_REFERENCE_PORT_INVALID", "reference mutation callback is required");
      return runExclusive(() => action(repository));
    },
  });
}

