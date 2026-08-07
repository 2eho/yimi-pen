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
  rmdir,
} from "node:fs/promises";
import path from "node:path";
import { canonicalize } from "../../../../scripts/snapshot-jcs.mjs";
import { sha256File } from "../prelisten/local-audio-assets.mjs";
import {
  AssetVaultMaintenanceError,
  assertAssetVaultMaintenanceJournal,
  assertAssetVaultInventory,
  assertAssetVaultRecoveryReceipt,
  computeAssetEntryVersionToken,
  computeAssetVaultMaintenanceJournalId,
  computeAssetVaultInventoryId,
  computeAssetVaultRecoveryId,
  failAssetVaultMaintenance,
  validateAssetVaultLimits,
} from "./asset-vault-maintenance-contract.mjs";

const CONTENT_FILE = /^([a-f0-9]{64})\.wav$/u;
const OPERATION_ID = /^ASSET-GC-[A-Z0-9][A-Z0-9._-]{2,95}$/u;
const OPERATION_DIRECTORY = /^op-[a-f0-9]{64}$/u;
const JOURNAL_NAME = "journal.json";
const JOURNAL_NEXT_NAME = "journal.next.json";
const QUARANTINE_NAME = "quarantine";

function assert(condition, code, message, details) {
  if (!condition) failAssetVaultMaintenance(code, message, details);
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

function modifiedAt(info) {
  return new Date(info.mtimeMs).toISOString();
}

function maintenanceName(operationId) {
  return `op-${createHash("sha256").update(operationId, "utf8").digest("hex")}`;
}

function sameCanonical(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function journalIdentitySubject(journal) {
  const {
    journalId: _journalId,
    phase: _phase,
    committedPurgeCount: _committedPurgeCount,
    ...subject
  } = journal;
  return subject;
}

function recoveryEntry(candidate) {
  return {
    relativePath: candidate.relativePath,
    sha256: candidate.sha256,
    bytes: candidate.bytes,
  };
}

function createRecoveryReceipt({
  status,
  journal = null,
  deleted = [],
  restored = [],
  postRecoveryInventoryId = null,
}) {
  const receipt = {
    schemaVersion: 1,
    profile: "asset-vault-maintenance-recovery-v1",
    recoveryId: `asset-vault-recovery:sha256:${"0".repeat(64)}`,
    status,
    journalId: journal?.journalId ?? null,
    operationId: journal?.operationId ?? null,
    planId: journal?.planId ?? null,
    referenceStateSha256: journal?.referenceStateSha256 ?? null,
    inventoryId: journal?.inventoryId ?? null,
    phase: journal?.phase ?? null,
    deleted: deleted.map(recoveryEntry),
    restored: restored.map(recoveryEntry),
    reclaimedBytes: deleted.reduce((total, candidate) => total + candidate.bytes, 0),
    postRecoveryInventoryId,
    requiresFreshPlan: journal !== null,
    cleanupComplete: true,
  };
  receipt.recoveryId = computeAssetVaultRecoveryId(receipt);
  assertAssetVaultRecoveryReceipt(receipt);
  return Object.freeze(receipt);
}

function journalWithProgress(journal, phase, committedPurgeCount) {
  const next = {
    ...journal,
    journalId: `asset-vault-journal:sha256:${"0".repeat(64)}`,
    phase,
    committedPurgeCount,
  };
  next.journalId = computeAssetVaultMaintenanceJournalId(next);
  assertAssetVaultMaintenanceJournal(next);
  return Object.freeze(next);
}

async function publishJournal(operationRoot, journal) {
  assertAssetVaultMaintenanceJournal(journal);
  const nextPath = path.join(operationRoot, JOURNAL_NEXT_NAME);
  const journalPath = path.join(operationRoot, JOURNAL_NAME);
  const bytes = Buffer.from(`${canonicalize(journal)}\n`, "utf8");
  let handle;
  try {
    handle = await open(nextPath, "w", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  await rename(nextPath, journalPath);
}

async function readCanonicalJournal(journalPath, maxJournalBytes) {
  const info = await optionalLstat(journalPath);
  if (!info) return null;
  assert(info.isFile() && !info.isSymbolicLink()
    && Number.isSafeInteger(info.size) && info.size > 0 && info.size <= maxJournalBytes,
  "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "asset-vault recovery journal file is malformed", {
    name: path.basename(journalPath),
    bytes: Number(info.size),
  });
  const bytes = await readFile(journalPath);
  let journal;
  try {
    journal = JSON.parse(bytes.toString("utf8"));
  } catch {
    failAssetVaultMaintenance("ASSET_VAULT_RECOVERY_JOURNAL_INVALID",
      "asset-vault recovery journal is not valid JSON", { name: path.basename(journalPath) });
  }
  assert(Buffer.compare(bytes, Buffer.from(`${canonicalize(journal)}\n`, "utf8")) === 0,
    "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "asset-vault recovery journal bytes are not canonical", {
      name: path.basename(journalPath),
    });
  assertAssetVaultMaintenanceJournal(journal);
  return journal;
}

async function removeOperationMetadata({ maintenanceRoot, operationRoot, quarantineRoot }) {
  await rm(path.join(operationRoot, JOURNAL_NEXT_NAME), { force: true });
  if (await optionalLstat(quarantineRoot)) await rmdir(quarantineRoot);
  await rm(path.join(operationRoot, JOURNAL_NAME), { force: true });
  if (await optionalLstat(operationRoot)) await rmdir(operationRoot);
  if (await optionalLstat(maintenanceRoot)) await rmdir(maintenanceRoot);
}

function createEntry({ relativePath, entryClass, declaredSha256, actualSha256, bytes, modified }) {
  const entry = {
    relativePath,
    entryClass,
    declaredSha256,
    actualSha256,
    bytes,
    modifiedAt: modified,
    versionToken: `asset-entry:sha256:${"0".repeat(64)}`,
  };
  entry.versionToken = computeAssetEntryVersionToken(entry);
  return entry;
}

async function hashAsset(filePath, maxBytes, relativePath) {
  try {
    return await sha256File(filePath, { maxBytes });
  } catch (error) {
    if (error?.code === "AUDIO_ASSET_TOO_LARGE") {
      failAssetVaultMaintenance("ASSET_VAULT_INVENTORY_LIMIT",
        "asset-vault entry exceeds its byte policy", { relativePath, maxBytes });
    }
    if (error?.code === "AUDIO_ASSET_CHANGED") {
      failAssetVaultMaintenance("ASSET_VAULT_INVENTORY_STALE",
        "asset-vault entry changed while its identity was read", { relativePath });
    }
    if (["AUDIO_ASSET_MISSING", "AUDIO_ASSET_NOT_REGULAR", "AUDIO_ASSET_PATH_ESCAPE"].includes(error?.code)) {
      failAssetVaultMaintenance("ASSET_VAULT_ENTRY_UNSAFE",
        "asset-vault entry is missing or outside its owned root", { relativePath });
    }
    throw new AssetVaultMaintenanceError(
      "ASSET_VAULT_INVENTORY_FAILED",
      "asset-vault entry identity could not be read",
      { relativePath, causeCode: error?.code ?? error?.name ?? "UNKNOWN" },
    );
  }
}

/** Local filesystem adapter for importCanonicalWav's assets/sha256 layout. */
export function createLocalContentAddressedAudioVault({
  vaultRoot,
  renameFile = rename,
  removePath = rm,
}) {
  assert(path.isAbsolute(vaultRoot ?? ""),
    "ASSET_VAULT_ROOT_INVALID", "asset-vault root must be an absolute App-owned path");
  assert(typeof renameFile === "function" && typeof removePath === "function",
    "ASSET_VAULT_ADAPTER_INVALID", "asset-vault filesystem dependencies are malformed");
  const root = path.resolve(vaultRoot);

  async function resolveRoots({ allowMissing }) {
    const rootInfo = await optionalLstat(root);
    if (!rootInfo) {
      if (allowMissing) return null;
      failAssetVaultMaintenance("ASSET_VAULT_ROOT_MISSING", "asset-vault root is missing");
    }
    assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(),
      "ASSET_VAULT_ROOT_INVALID", "asset-vault root must be a regular directory");
    const realRoot = await realpath(root);
    const assets = path.join(realRoot, "assets");
    const assetsInfo = await optionalLstat(assets);
    if (!assetsInfo) return { realRoot, contentRoot: null };
    assert(assetsInfo.isDirectory() && !assetsInfo.isSymbolicLink(),
      "ASSET_VAULT_ROOT_INVALID", "asset-vault assets root must be a regular directory");
    const content = path.join(assets, "sha256");
    const contentInfo = await optionalLstat(content);
    if (!contentInfo) return { realRoot, contentRoot: null };
    assert(contentInfo.isDirectory() && !contentInfo.isSymbolicLink(),
      "ASSET_VAULT_ROOT_INVALID", "asset-vault content root must be a regular directory");
    const contentRoot = await realpath(content);
    assert(inside(realRoot, contentRoot),
      "ASSET_VAULT_ROOT_INVALID", "asset-vault content root resolved outside its App-owned root");
    return { realRoot, contentRoot };
  }

  async function pendingMaintenanceEntries(realRoot) {
    const maintenanceRoot = path.join(realRoot, ".maintenance");
    const info = await optionalLstat(maintenanceRoot);
    if (!info) return { maintenanceRoot, entries: [] };
    assert(info.isDirectory() && !info.isSymbolicLink(),
      "ASSET_VAULT_ROOT_INVALID", "asset-vault maintenance root must be a regular directory");
    const resolved = await realpath(maintenanceRoot);
    assert(inside(realRoot, resolved),
      "ASSET_VAULT_ROOT_INVALID", "asset-vault maintenance root escaped its owned vault");
    const entries = await readdir(resolved, { withFileTypes: true });
    return { maintenanceRoot: resolved, entries };
  }

  async function assertNoPendingMaintenance(realRoot) {
    const { entries } = await pendingMaintenanceEntries(realRoot);
    assert(entries.length === 0,
      "ASSET_VAULT_RECOVERY_REQUIRED", "asset-vault contains an interrupted maintenance operation", {
        pendingEntries: entries.map((entry) => entry.name).sort(ordinalCompare),
      });
  }

  function journalByteLimit(limits) {
    const computed = 8_192 + (limits.maxEntries * 768);
    return Number.isSafeInteger(computed) ? computed : Number.MAX_SAFE_INTEGER;
  }

  async function readRecoveryJournal({ operationRoot, operationName, limits, quarantineEntries }) {
    const maxJournalBytes = journalByteLimit(limits);
    const journalPath = path.join(operationRoot, JOURNAL_NAME);
    const nextPath = path.join(operationRoot, JOURNAL_NEXT_NAME);
    const journalInfo = await optionalLstat(journalPath);
    const nextInfo = await optionalLstat(nextPath);
    async function attempt(target) {
      try {
        return { journal: await readCanonicalJournal(target, maxJournalBytes), error: null };
      } catch (error) {
        return { journal: null, error };
      }
    }
    const [current, next] = await Promise.all([
      journalInfo ? attempt(journalPath) : { journal: null, error: null },
      nextInfo ? attempt(nextPath) : { journal: null, error: null },
    ]);
    const valid = [current.journal, next.journal].filter(Boolean);
    if (valid.length === 0) {
      if (!journalInfo && quarantineEntries.length === 0) return null;
      if (!journalInfo && nextInfo && quarantineEntries.length === 0) return null;
      throw current.error ?? next.error ?? new AssetVaultMaintenanceError(
        "ASSET_VAULT_RECOVERY_JOURNAL_INVALID",
        "asset-vault interrupted operation has no valid journal",
      );
    }
    for (const journal of valid) {
      assert(maintenanceName(journal.operationId) === operationName,
        "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "journal operation ID differs from its owned directory");
      assert(sameCanonical(journal.limits, limits),
        "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "journal resource policy differs from workspace policy");
    }
    if (valid.length === 2) {
      assert(sameCanonical(journalIdentitySubject(valid[0]), journalIdentitySubject(valid[1])),
        "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "journal checkpoint changed immutable operation identity");
    }
    return valid.sort((left, right) => {
      const leftPhase = left.phase === "PURGING" ? 1 : 0;
      const rightPhase = right.phase === "PURGING" ? 1 : 0;
      return rightPhase - leftPhase || right.committedPurgeCount - left.committedPurgeCount;
    })[0];
  }

  async function verifyRecoveryFile(filePath, ownedRoot, candidate, limits) {
    const info = await optionalLstat(filePath);
    if (!info) return false;
    assert(info.isFile() && !info.isSymbolicLink(),
      "ASSET_VAULT_RECOVERY_INTEGRITY_BLOCKED", "recovery candidate is not a regular file", {
        relativePath: candidate.relativePath,
      });
    const resolved = await realpath(filePath);
    assert(inside(ownedRoot, resolved),
      "ASSET_VAULT_RECOVERY_INTEGRITY_BLOCKED", "recovery candidate escaped its owned directory", {
        relativePath: candidate.relativePath,
      });
    let identity;
    try {
      identity = await sha256File(resolved, { maxBytes: limits.maxAssetBytes });
    } catch (error) {
      throw new AssetVaultMaintenanceError(
        "ASSET_VAULT_RECOVERY_INTEGRITY_BLOCKED",
        "recovery candidate identity could not be verified",
        { relativePath: candidate.relativePath, causeCode: error?.code ?? error?.name ?? "UNKNOWN" },
      );
    }
    assert(identity.sha256 === candidate.sha256
      && identity.bytes === candidate.bytes
      && modifiedAt(info) === candidate.modifiedAt,
    "ASSET_VAULT_RECOVERY_INTEGRITY_BLOCKED", "recovery candidate differs from its journal identity", {
      relativePath: candidate.relativePath,
    });
    return true;
  }

  async function recoverInterruptedMaintenanceCore({ limits: inputLimits }) {
    const limits = validateAssetVaultLimits(inputLimits);
    const roots = await resolveRoots({ allowMissing: true });
    if (!roots) return createRecoveryReceipt({ status: "NO_PENDING_OPERATION" });
    const pending = await pendingMaintenanceEntries(roots.realRoot);
    if (pending.entries.length === 0) {
      if (await optionalLstat(pending.maintenanceRoot)) {
        try {
          await rmdir(pending.maintenanceRoot);
          return createRecoveryReceipt({ status: "EMPTY_OPERATION_CLEANED" });
        } catch (error) {
          throw new AssetVaultMaintenanceError(
            "ASSET_VAULT_RECOVERY_FAILED",
            "empty asset-vault maintenance root could not be cleaned",
            { causeCode: error?.code ?? error?.name ?? "UNKNOWN" },
          );
        }
      }
      return createRecoveryReceipt({ status: "NO_PENDING_OPERATION" });
    }
    assert(pending.entries.length === 1
      && pending.entries[0].isDirectory() && !pending.entries[0].isSymbolicLink()
      && OPERATION_DIRECTORY.test(pending.entries[0].name),
    "ASSET_VAULT_RECOVERY_STATE_INVALID", "asset-vault maintenance root has an ambiguous operation set", {
      entries: pending.entries.map((entry) => entry.name).sort(ordinalCompare),
    });
    const operationName = pending.entries[0].name;
    const operationRoot = await realpath(path.join(pending.maintenanceRoot, operationName));
    assert(inside(pending.maintenanceRoot, operationRoot),
      "ASSET_VAULT_RECOVERY_STATE_INVALID", "asset-vault operation directory escaped its maintenance root");
    const operationEntries = await readdir(operationRoot, { withFileTypes: true });
    const allowedNames = new Set([JOURNAL_NAME, JOURNAL_NEXT_NAME, QUARANTINE_NAME]);
    assert(operationEntries.every((entry) => allowedNames.has(entry.name)),
      "ASSET_VAULT_RECOVERY_STATE_INVALID", "asset-vault operation directory contains unknown entries", {
        entries: operationEntries.map((entry) => entry.name).sort(ordinalCompare),
      });
    const quarantineRoot = path.join(operationRoot, QUARANTINE_NAME);
    const quarantineInfo = await optionalLstat(quarantineRoot);
    if (quarantineInfo) {
      assert(quarantineInfo.isDirectory() && !quarantineInfo.isSymbolicLink(),
        "ASSET_VAULT_RECOVERY_STATE_INVALID", "asset-vault quarantine root is malformed");
      const realQuarantine = await realpath(quarantineRoot);
      assert(inside(operationRoot, realQuarantine),
        "ASSET_VAULT_RECOVERY_STATE_INVALID", "asset-vault quarantine root escaped its operation directory");
    }
    const quarantineEntries = quarantineInfo ? await readdir(quarantineRoot, { withFileTypes: true }) : [];
    const journal = await readRecoveryJournal({
      operationRoot,
      operationName,
      limits,
      quarantineEntries,
    });
    if (!journal) {
      assert(quarantineEntries.length === 0,
        "ASSET_VAULT_RECOVERY_JOURNAL_INVALID", "unjournaled recovery scratch contains asset bytes");
      try {
        await removeOperationMetadata({
          maintenanceRoot: pending.maintenanceRoot,
          operationRoot,
          quarantineRoot,
        });
      } catch (error) {
        throw new AssetVaultMaintenanceError(
          "ASSET_VAULT_RECOVERY_FAILED",
          "asset-vault pre-journal scratch could not be cleaned",
          { causeCode: error?.code ?? error?.name ?? "UNKNOWN" },
        );
      }
      return createRecoveryReceipt({ status: "EMPTY_OPERATION_CLEANED" });
    }
    assert(roots.contentRoot,
      "ASSET_VAULT_RECOVERY_STATE_INVALID", "journaled operation exists without a canonical content root");
    const candidateNames = new Set(journal.candidates.map((candidate) => path.basename(candidate.relativePath)));
    assert(quarantineEntries.every((entry) => entry.isFile()
      && !entry.isSymbolicLink() && candidateNames.has(entry.name)),
    "ASSET_VAULT_RECOVERY_STATE_INVALID", "quarantine contains an unknown or unsafe entry", {
      entries: quarantineEntries.map((entry) => entry.name).sort(ordinalCompare),
    });

    const states = [];
    for (const candidate of journal.candidates) {
      const name = path.basename(candidate.relativePath);
      const sourcePath = path.join(roots.contentRoot, name);
      const quarantinePath = path.join(quarantineRoot, name);
      assert(path.dirname(sourcePath) === roots.contentRoot && path.dirname(quarantinePath) === quarantineRoot,
        "ASSET_VAULT_RECOVERY_STATE_INVALID", "recovery candidate escaped its owned directory");
      const sourceExists = await verifyRecoveryFile(sourcePath, roots.contentRoot, candidate, limits);
      const quarantineExists = await verifyRecoveryFile(quarantinePath, quarantineRoot, candidate, limits);
      assert(!(sourceExists && quarantineExists),
        "ASSET_VAULT_RECOVERY_STATE_INVALID", "recovery candidate exists in source and quarantine", {
          relativePath: candidate.relativePath,
        });
      states.push({ candidate, sourcePath, quarantinePath, sourceExists, quarantineExists });
    }

    const deleted = [];
    let remainingSeen = false;
    for (const state of states) {
      const missing = !state.sourceExists && !state.quarantineExists;
      if (missing) {
        assert(journal.phase === "PURGING" && !remainingSeen,
          "ASSET_VAULT_RECOVERY_STATE_INVALID", "recovery deletion state is outside a continuous purge prefix", {
            relativePath: state.candidate.relativePath,
          });
        deleted.push(state.candidate);
      } else {
        remainingSeen = true;
      }
    }
    if (journal.phase === "PURGING") {
      assert(deleted.length === journal.committedPurgeCount
        || deleted.length === journal.committedPurgeCount + 1,
      "ASSET_VAULT_RECOVERY_STATE_INVALID", "physical purge prefix differs from its journal checkpoint", {
        journalPrefix: journal.committedPurgeCount,
        physicalPrefix: deleted.length,
      });
    } else {
      assert(deleted.length === 0,
        "ASSET_VAULT_RECOVERY_STATE_INVALID", "pre-purge recovery observed committed deletion");
    }

    const restored = [];
    try {
      for (const state of [...states].reverse()) {
        if (!state.quarantineExists) continue;
        await renameFile(state.quarantinePath, state.sourcePath);
        restored.push(state.candidate);
      }
      await removeOperationMetadata({
        maintenanceRoot: pending.maintenanceRoot,
        operationRoot,
        quarantineRoot,
      });
    } catch (error) {
      if (error instanceof AssetVaultMaintenanceError) throw error;
      throw new AssetVaultMaintenanceError(
        "ASSET_VAULT_RECOVERY_FAILED",
        "asset-vault interrupted operation could not be normalized",
        { causeCode: error?.code ?? error?.name ?? "UNKNOWN", restored: restored.length },
      );
    }
    const postRecoveryInventory = await inventory({ limits });
    return createRecoveryReceipt({
      status: journal.phase === "PURGING" ? "PARTIAL_PURGE_RECOVERED" : "ROLLED_BACK_BEFORE_PURGE",
      journal,
      deleted,
      restored: restored.reverse(),
      postRecoveryInventoryId: postRecoveryInventory.inventoryId,
    });
  }

  async function recoverInterruptedMaintenance(input) {
    try {
      return await recoverInterruptedMaintenanceCore(input);
    } catch (error) {
      if (error instanceof AssetVaultMaintenanceError) throw error;
      throw new AssetVaultMaintenanceError(
        "ASSET_VAULT_RECOVERY_FAILED",
        "asset-vault startup recovery encountered an I/O failure",
        { causeCode: error?.code ?? error?.name ?? "UNKNOWN" },
      );
    }
  }

  async function inventory({ limits: inputLimits }) {
    const limits = validateAssetVaultLimits(inputLimits);
    const roots = await resolveRoots({ allowMissing: true });
    if (roots) await assertNoPendingMaintenance(roots.realRoot);
    if (!roots || !roots.contentRoot) {
      const empty = {
        schemaVersion: 1,
        profile: "asset-vault-inventory-v1",
        inventoryId: `vault-inventory:sha256:${"0".repeat(64)}`,
        rootState: roots ? "READY" : "MISSING",
        entries: [],
        totalBytes: 0,
      };
      empty.inventoryId = computeAssetVaultInventoryId(empty);
      assertAssetVaultInventory(empty, limits);
      return Object.freeze(empty);
    }

    const dirEntries = await readdir(roots.contentRoot, { withFileTypes: true });
    assert(dirEntries.length <= limits.maxEntries,
      "ASSET_VAULT_INVENTORY_LIMIT", "asset-vault entry count exceeds its resource policy", {
        entries: dirEntries.length,
        maxEntries: limits.maxEntries,
      });
    dirEntries.sort((left, right) => ordinalCompare(left.name, right.name));
    const entries = [];
    let totalBytes = 0;
    for (const dirEntry of dirEntries) {
      const candidate = path.join(roots.contentRoot, dirEntry.name);
      const info = await lstat(candidate);
      const relativePath = `assets/sha256/${dirEntry.name}`;
      const match = CONTENT_FILE.exec(dirEntry.name);
      assert(Number.isSafeInteger(info.size) && info.size >= 0 && info.size <= limits.maxAssetBytes,
        "ASSET_VAULT_INVENTORY_LIMIT", "asset-vault entry exceeds its byte policy", {
          relativePath,
          bytes: info.size,
          maxAssetBytes: limits.maxAssetBytes,
        });
      let entry;
      if (dirEntry.isSymbolicLink() || !info.isFile() || info.isSymbolicLink()) {
        entry = createEntry({
          relativePath,
          entryClass: "UNSAFE_ENTRY",
          declaredSha256: match?.[1] ?? null,
          actualSha256: null,
          bytes: Number(info.size),
          modified: modifiedAt(info),
        });
      } else if (!match) {
        entry = createEntry({
          relativePath,
          entryClass: "UNMANAGED_ENTRY",
          declaredSha256: null,
          actualSha256: null,
          bytes: Number(info.size),
          modified: modifiedAt(info),
        });
      } else {
        const resolved = await realpath(candidate);
        assert(inside(roots.contentRoot, resolved),
          "ASSET_VAULT_ENTRY_UNSAFE", "content-addressed asset resolved outside its owned root", { relativePath });
        const identity = await hashAsset(resolved, limits.maxAssetBytes, relativePath);
        entry = createEntry({
          relativePath,
          entryClass: identity.sha256 === match[1] ? "VALID_CONTENT" : "TAMPERED_CONTENT",
          declaredSha256: match[1],
          actualSha256: identity.sha256,
          bytes: identity.bytes,
          modified: modifiedAt(info),
        });
      }
      totalBytes += entry.bytes;
      assert(Number.isSafeInteger(totalBytes) && totalBytes <= limits.maxTotalBytes,
        "ASSET_VAULT_INVENTORY_LIMIT", "asset-vault bytes exceed its resource policy", {
          totalBytes,
          maxTotalBytes: limits.maxTotalBytes,
        });
      entries.push(entry);
    }
    const receipt = {
      schemaVersion: 1,
      profile: "asset-vault-inventory-v1",
      inventoryId: `vault-inventory:sha256:${"0".repeat(64)}`,
      rootState: "READY",
      entries,
      totalBytes,
    };
    receipt.inventoryId = computeAssetVaultInventoryId(receipt);
    assertAssetVaultInventory(receipt, limits);
    return Object.freeze(receipt);
  }

  async function rollbackQuarantine({ moved, quarantineRoot, operationRoot, maintenanceRoot, primaryCode }) {
    let cleanupComplete = true;
    for (const item of [...moved].reverse()) {
      try {
        const quarantined = await optionalLstat(item.quarantinePath);
        if (!quarantined) {
          cleanupComplete = false;
          continue;
        }
        if (await optionalLstat(item.sourcePath)) {
          cleanupComplete = false;
          continue;
        }
        await renameFile(item.quarantinePath, item.sourcePath);
      } catch {
        cleanupComplete = false;
      }
    }
    try {
      await removeOperationMetadata({ maintenanceRoot, operationRoot, quarantineRoot });
    } catch {
      cleanupComplete = false;
    }
    throw new AssetVaultMaintenanceError(
      "ASSET_VAULT_DELETE_FAILED",
      "asset-vault conditional delete transaction failed",
      { primaryCode, moved: moved.length, cleanupComplete },
    );
  }

  async function failPartialPurge({
    moved,
    purged,
    quarantineRoot,
    operationRoot,
    maintenanceRoot,
    primaryCode,
  }) {
    let cleanupComplete = true;
    const purgedPaths = new Set(purged.map((item) => item.quarantinePath));
    const restored = [];
    for (const item of [...moved].reverse()) {
      if (purgedPaths.has(item.quarantinePath)) continue;
      try {
        const quarantined = await optionalLstat(item.quarantinePath);
        const source = await optionalLstat(item.sourcePath);
        if (!quarantined || source) {
          cleanupComplete = false;
          continue;
        }
        await renameFile(item.quarantinePath, item.sourcePath);
        restored.push(item);
      } catch {
        cleanupComplete = false;
      }
    }
    try {
      await removeOperationMetadata({ maintenanceRoot, operationRoot, quarantineRoot });
    } catch {
      cleanupComplete = false;
    }
    const deleted = purged.map(({ candidate }) => ({
      relativePath: candidate.relativePath,
      sha256: candidate.sha256,
      bytes: candidate.bytes,
    }));
    throw new AssetVaultMaintenanceError(
      "ASSET_VAULT_DELETE_PARTIAL",
      "asset-vault physical purge stopped after a committed eligible prefix",
      {
        primaryCode,
        deleted,
        reclaimedBytes: deleted.reduce((total, entry) => total + entry.bytes, 0),
        restored: restored.length,
        cleanupComplete,
      },
    );
  }

  async function deleteBatchIfUnchanged({
    operationId,
    planId,
    referenceStateSha256,
    inventoryId,
    candidates,
    limits: inputLimits,
  }) {
    const limits = validateAssetVaultLimits(inputLimits);
    assert(OPERATION_ID.test(operationId ?? ""),
      "ASSET_VAULT_OPERATION_INVALID", "asset-vault cleanup operation ID is malformed");
    assert(Array.isArray(candidates) && candidates.length > 0,
      "ASSET_VAULT_DELETE_REQUEST_INVALID", "conditional delete requires at least one candidate");
    const current = await inventory({ limits });
    assert(current.inventoryId === inventoryId,
      "ASSET_VAULT_INVENTORY_STALE", "asset-vault bytes changed before conditional delete", {
        expectedInventoryId: inventoryId,
        currentInventoryId: current.inventoryId,
      });
    const byPath = new Map(current.entries.map((entry) => [entry.relativePath, entry]));
    const seen = new Set();
    for (const candidate of candidates) {
      assert(candidate && typeof candidate.relativePath === "string" && !seen.has(candidate.relativePath),
        "ASSET_VAULT_DELETE_REQUEST_INVALID", "conditional delete candidates are malformed or duplicated");
      seen.add(candidate.relativePath);
      const entry = byPath.get(candidate.relativePath);
      assert(entry?.entryClass === "VALID_CONTENT"
        && entry.declaredSha256 === candidate.sha256
        && entry.bytes === candidate.bytes
        && entry.modifiedAt === candidate.modifiedAt
        && entry.versionToken === candidate.versionToken,
      "ASSET_VAULT_INVENTORY_STALE", "conditional delete candidate changed after planning", {
        relativePath: candidate.relativePath,
      });
    }

    let journal = {
      schemaVersion: 1,
      profile: "asset-vault-maintenance-journal-v1",
      journalId: `asset-vault-journal:sha256:${"0".repeat(64)}`,
      operationId,
      planId,
      referenceStateSha256,
      inventoryId,
      limits: { ...limits },
      phase: "QUARANTINING",
      committedPurgeCount: 0,
      candidates: candidates.map(({ relativePath, sha256, bytes, modifiedAt, versionToken }) => ({
        relativePath,
        sha256,
        bytes,
        modifiedAt,
        versionToken,
      })),
    };
    journal.journalId = computeAssetVaultMaintenanceJournalId(journal);
    assertAssetVaultMaintenanceJournal(journal);
    journal = Object.freeze(journal);

    const roots = await resolveRoots({ allowMissing: false });
    assert(roots.contentRoot, "ASSET_VAULT_ROOT_MISSING", "asset-vault content root is missing");
    const maintenanceRoot = path.join(roots.realRoot, ".maintenance");
    const maintenanceInfo = await optionalLstat(maintenanceRoot);
    if (maintenanceInfo) {
      assert(maintenanceInfo.isDirectory() && !maintenanceInfo.isSymbolicLink(),
        "ASSET_VAULT_ROOT_INVALID", "asset-vault maintenance root must be a regular directory");
      const pending = await readdir(maintenanceRoot);
      assert(pending.length === 0,
        "ASSET_VAULT_RECOVERY_REQUIRED", "asset-vault maintenance root contains an unfinished operation");
    } else {
      await mkdir(maintenanceRoot);
    }
    const operationRoot = path.join(maintenanceRoot, maintenanceName(operationId));
    assert(!(await optionalLstat(operationRoot)),
      "ASSET_VAULT_OPERATION_CONFLICT", "asset-vault cleanup operation already has a quarantine directory");
    await mkdir(operationRoot);
    const quarantineRoot = path.join(operationRoot, QUARANTINE_NAME);
    await mkdir(quarantineRoot);
    try {
      await publishJournal(operationRoot, journal);
    } catch (error) {
      let cleanupComplete = true;
      try {
        await removeOperationMetadata({ maintenanceRoot, operationRoot, quarantineRoot });
      } catch {
        cleanupComplete = false;
      }
      throw new AssetVaultMaintenanceError(
        "ASSET_VAULT_DELETE_FAILED",
        "asset-vault maintenance journal could not be published before mutation",
        { primaryCode: error?.code ?? error?.name ?? "UNKNOWN", moved: 0, cleanupComplete },
      );
    }

    const moved = [];
    try {
      for (const candidate of candidates) {
        const name = path.basename(candidate.relativePath);
        const sourcePath = path.join(roots.contentRoot, name);
        const quarantinePath = path.join(quarantineRoot, name);
        assert(path.dirname(sourcePath) === roots.contentRoot && path.dirname(quarantinePath) === quarantineRoot,
          "ASSET_VAULT_ENTRY_UNSAFE", "conditional delete candidate escaped its owned directory");
        await renameFile(sourcePath, quarantinePath);
        moved.push({ sourcePath, quarantinePath, candidate });
        const identity = await hashAsset(quarantinePath, limits.maxAssetBytes, candidate.relativePath);
        assert(identity.sha256 === candidate.sha256 && identity.bytes === candidate.bytes,
          "ASSET_VAULT_INVENTORY_STALE", "quarantined asset bytes differ from their planned identity", {
            relativePath: candidate.relativePath,
          });
      }
    } catch (error) {
      await rollbackQuarantine({
        moved,
        quarantineRoot,
        operationRoot,
        maintenanceRoot,
        primaryCode: error?.code ?? error?.name ?? "UNKNOWN",
      });
    }

    try {
      journal = journalWithProgress(journal, "PURGING", 0);
      await publishJournal(operationRoot, journal);
    } catch (error) {
      await rollbackQuarantine({
        moved,
        quarantineRoot,
        operationRoot,
        maintenanceRoot,
        primaryCode: error?.code ?? error?.name ?? "UNKNOWN",
      });
    }

    const purged = [];
    try {
      for (const item of moved) {
        try {
          await removePath(item.quarantinePath, { force: false });
        } catch (error) {
          if (await optionalLstat(item.quarantinePath)) throw error;
        }
        purged.push(item);
        journal = journalWithProgress(journal, "PURGING", purged.length);
        await publishJournal(operationRoot, journal);
      }
      await removeOperationMetadata({ maintenanceRoot, operationRoot, quarantineRoot });
    } catch (error) {
      await failPartialPurge({
        moved,
        purged,
        quarantineRoot,
        operationRoot,
        maintenanceRoot,
        primaryCode: error?.code ?? error?.name ?? "UNKNOWN",
      });
    }

    return Object.freeze({
      operationId,
      planId,
      referenceStateSha256,
      inventoryId,
      deleted: candidates.map(({ relativePath, sha256, bytes }) => ({ relativePath, sha256, bytes })),
      reclaimedBytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
      cleanupComplete: true,
    });
  }

  return Object.freeze({ inventory, deleteBatchIfUnchanged, recoverInterruptedMaintenance });
}
