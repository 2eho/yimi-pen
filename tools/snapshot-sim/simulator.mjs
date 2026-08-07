import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";

export class SnapshotSimError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SnapshotSimError";
    this.code = code;
    this.details = details;
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeSnapshotPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/).includes("..") &&
    !value.includes("\\")
  );
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function durableWrite(file, data, { leaveTempOnly = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx");
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (leaveTempOnly) return { temp, committed: false };
  await rename(temp, file);
  return { temp, committed: true };
}

function validateManifestShape(manifest) {
  if (manifest?.schemaVersion !== 1) {
    throw new SnapshotSimError("SNAPSHOT_SCHEMA_UNSUPPORTED", "Snapshot schemaVersion must be 1");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new SnapshotSimError("MANIFEST_INVALID", "Snapshot files must be a non-empty array");
  }
  if (manifest.install?.activationMode !== "staged-atomic" || manifest.install?.lastGoodRequired !== true) {
    throw new SnapshotSimError("MANIFEST_INVALID", "Snapshot must require staged-atomic activation and last-good");
  }
  const paths = new Set();
  for (const file of manifest.files) {
    if (!safeSnapshotPath(file.path)) {
      throw new SnapshotSimError("MANIFEST_PATH_INVALID", `Unsafe snapshot path: ${file.path}`);
    }
    if (paths.has(file.path)) {
      throw new SnapshotSimError("MANIFEST_INVALID", `Duplicate snapshot path: ${file.path}`);
    }
    paths.add(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 1 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new SnapshotSimError("MANIFEST_INVALID", `Invalid size/hash for ${file.path}`);
    }
  }
  for (const reference of [manifest.oidIndex, manifest.actions]) {
    if (!reference || !paths.has(reference.path)) {
      throw new SnapshotSimError("MANIFEST_INVALID", "Index/action references must point to listed files");
    }
  }
}

function validateCapabilities(manifest, capabilities, allowDesignFixtures) {
  if (!capabilities.snapshotSchemaVersions?.includes(manifest.schemaVersion)) {
    throw new SnapshotSimError("SNAPSHOT_SCHEMA_UNSUPPORTED", "Device does not advertise snapshot schema v1");
  }
  if (!capabilities.activationModes?.includes(manifest.install.activationMode)) {
    throw new SnapshotSimError("CAPABILITY_MISMATCH", "Device does not support staged-atomic activation");
  }
  if (manifest.install.requiredBytes > capabilities.storageFreeBytes) {
    throw new SnapshotSimError("INSUFFICIENT_SPACE", "Snapshot exceeds advertised staging capacity", {
      requiredBytes: manifest.install.requiredBytes,
      storageFreeBytes: capabilities.storageFreeBytes,
    });
  }
  const required = manifest.target?.capabilities ?? [];
  const missing = required.filter((item) => !capabilities.capabilities?.includes(item));
  if (missing.length > 0) {
    throw new SnapshotSimError("CAPABILITY_MISMATCH", "Device capability set is incomplete", { missing });
  }
  if (manifest.releaseState === "design-fixture" && !allowDesignFixtures) {
    throw new SnapshotSimError("DESIGN_FIXTURE_NOT_RELEASE", "Design fixtures are excluded from release-mode installation");
  }
  if (manifest.releaseState === "release-candidate") {
    if (manifest.target?.boardTarget === "UNFROZEN" || manifest.target?.boardTarget !== capabilities.boardTarget) {
      throw new SnapshotSimError("TARGET_MISMATCH", "Release snapshot boardTarget does not match the device");
    }
    if (manifest.target?.physicalMapStatus !== "assigned") {
      throw new SnapshotSimError("PHYSICAL_MAP_UNASSIGNED", "Release snapshot requires assigned physical codes");
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(manifest.snapshotId)) {
      throw new SnapshotSimError("MANIFEST_HASH_MISMATCH", "Release snapshotId must be a SHA-256 identifier");
    }
  }
}

export class SnapshotDeviceSimulator {
  constructor(stateDirectory, capabilities, options = {}) {
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    this.allowedStateRoot = path.join(this.workspaceRoot, "build");
    this.stateDirectory = path.resolve(stateDirectory);
    if (!isPathInside(this.allowedStateRoot, this.stateDirectory)) {
      throw new SnapshotSimError(
        "STATE_PATH_OUTSIDE_BUILD",
        `Simulator state must resolve inside ${this.allowedStateRoot}`,
      );
    }
    this.capabilities = structuredClone(capabilities);
    this.allowDesignFixtures = options.allowDesignFixtures ?? true;
    this.events = [];
  }

  get slotsDirectory() {
    return path.join(this.stateDirectory, "slots");
  }

  get headsDirectory() {
    return path.join(this.stateDirectory, "heads");
  }

  slotDirectory(slot) {
    if (!new Set(["A", "B"]).has(slot)) throw new SnapshotSimError("SLOT_INVALID", `Unknown slot ${slot}`);
    return path.join(this.slotsDirectory, slot);
  }

  record(event, details = {}) {
    this.events.push({ sequence: this.events.length + 1, event, details });
  }

  async reset() {
    if (!isPathInside(this.allowedStateRoot, this.stateDirectory)) {
      throw new SnapshotSimError("STATE_PATH_OUTSIDE_BUILD", "Refusing recursive reset outside build/");
    }
    await rm(this.stateDirectory, { recursive: true, force: true });
    await mkdir(this.slotsDirectory, { recursive: true });
    await mkdir(this.headsDirectory, { recursive: true });
    this.events = [];
    this.record("reset");
  }

  async provision(snapshotDirectory) {
    await this.reset();
    const staged = await this.stageIntoSlot("A", snapshotDirectory, {});
    await this.appendHead({
      activeSlot: "A",
      lastGoodSlot: "A",
      activeSnapshotId: staged.manifest.snapshotId,
      reason: "factory-provision",
    });
    this.record("provisioned", { snapshotId: staged.manifest.snapshotId, slot: "A" });
    return this.status();
  }

  async install(snapshotDirectory, fault = {}) {
    const before = await this.boot({ repair: true });
    const inactiveSlot = before.activeSlot === "A" ? "B" : "A";
    this.record("install-begin", { inactiveSlot, source: path.resolve(snapshotDirectory), fault });
    const staged = await this.stageIntoSlot(inactiveSlot, snapshotDirectory, fault);
    if (fault.beforeHeadCommit) {
      await this.appendHead(
        {
          activeSlot: inactiveSlot,
          lastGoodSlot: before.activeSlot,
          activeSnapshotId: staged.manifest.snapshotId,
          reason: "install",
        },
        { leaveTempOnly: true },
      );
      this.record("simulated-power-loss", { phase: "before-head-commit" });
      throw new SnapshotSimError("SIMULATED_POWER_LOSS", "Power loss before atomic head commit");
    }
    await this.appendHead({
      activeSlot: inactiveSlot,
      lastGoodSlot: before.activeSlot,
      activeSnapshotId: staged.manifest.snapshotId,
      reason: "install",
    });
    this.record("install-committed", { snapshotId: staged.manifest.snapshotId, slot: inactiveSlot });
    return this.status();
  }

  async stageIntoSlot(slot, snapshotDirectory, fault) {
    const source = path.resolve(snapshotDirectory);
    const manifest = await readJson(path.join(source, "manifest.json"));
    validateManifestShape(manifest);
    validateCapabilities(manifest, this.capabilities, this.allowDesignFixtures);

    const target = this.slotDirectory(slot);
    if (!isPathInside(this.stateDirectory, target)) {
      throw new SnapshotSimError("SLOT_PATH_INVALID", "Slot path escaped simulator state");
    }
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });

    let copied = 0;
    for (const file of manifest.files) {
      const sourceFile = path.join(source, file.path);
      const targetFile = path.join(target, file.path);
      await mkdir(path.dirname(targetFile), { recursive: true });
      await copyFile(sourceFile, targetFile);
      copied += 1;
      this.record("file-staged", { slot, path: file.path });
      if (fault.afterFileCount === copied) {
        this.record("simulated-power-loss", { phase: "staging", copied });
        throw new SnapshotSimError("SIMULATED_POWER_LOSS", `Power loss after ${copied} staged file(s)`);
      }
    }

    await copyFile(path.join(source, "manifest.json"), path.join(target, "manifest.json"));
    if (fault.corruptFilePath) {
      const corruptTarget = path.join(target, fault.corruptFilePath);
      const original = await readFile(corruptTarget);
      if (original.length === 0) throw new SnapshotSimError("FAULT_INJECTION_INVALID", "Cannot corrupt an empty file");
      const corrupted = Buffer.from(original);
      corrupted[0] ^= 0x01;
      await writeFile(corruptTarget, corrupted);
      this.record("file-corrupted", { slot, path: fault.corruptFilePath });
    }

    const verification = await this.verifySlot(slot, { requireComplete: false });
    const manifestBytes = await readFile(path.join(target, "manifest.json"));
    await durableWrite(
      path.join(target, ".complete.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        snapshotId: manifest.snapshotId,
        manifestSha256: sha256(manifestBytes),
      })}\n`,
    );
    await this.verifySlot(slot, { requireComplete: true });
    this.record("slot-verified", { slot, snapshotId: manifest.snapshotId });
    return verification;
  }

  async verifySlot(slot, { requireComplete = true } = {}) {
    const directory = this.slotDirectory(slot);
    const manifestPath = path.join(directory, "manifest.json");
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    validateManifestShape(manifest);
    validateCapabilities(manifest, this.capabilities, this.allowDesignFixtures);

    for (const file of manifest.files) {
      const absolute = path.join(directory, file.path);
      const buffer = await readFile(absolute);
      if (buffer.length !== file.size) {
        throw new SnapshotSimError("FILE_SIZE_MISMATCH", `File size mismatch: ${file.path}`);
      }
      if (sha256(buffer) !== file.sha256) {
        throw new SnapshotSimError("FILE_HASH_MISMATCH", `File hash mismatch: ${file.path}`);
      }
    }

    const index = await readJson(path.join(directory, manifest.oidIndex.path));
    const actions = await readJson(path.join(directory, manifest.actions.path));
    if (index.entries?.length !== manifest.oidIndex.entryCount) {
      throw new SnapshotSimError("INDEX_COUNT_MISMATCH", "OID index count differs from manifest");
    }
    if (actions.actions?.length !== manifest.actions.actionCount) {
      throw new SnapshotSimError("ACTION_COUNT_MISMATCH", "Action count differs from manifest");
    }
    if (manifest.releaseState === "release-candidate") {
      if (index.physicalMapStatus !== "assigned" || index.entries.some((entry) => entry.physicalCode === null)) {
        throw new SnapshotSimError("PHYSICAL_MAP_UNASSIGNED", "Release index contains unassigned physical codes");
      }
      const expected = canonicalSha256(
        Object.fromEntries(Object.entries(manifest).filter(([key]) => !new Set(["createdAt", "snapshotId"]).has(key))),
      ).sha256;
      if (manifest.snapshotId !== `sha256:${expected}`) {
        throw new SnapshotSimError("MANIFEST_HASH_MISMATCH", "Release snapshotId failed canonical hash verification");
      }
    }

    if (requireComplete) {
      const complete = await readJson(path.join(directory, ".complete.json"));
      if (complete.snapshotId !== manifest.snapshotId || complete.manifestSha256 !== sha256(manifestBytes)) {
        throw new SnapshotSimError("COMPLETE_MARKER_INVALID", "Slot completion marker does not match manifest");
      }
    }
    return { slot, manifest, index, actions };
  }

  async readHeads() {
    await mkdir(this.headsDirectory, { recursive: true });
    const entries = await readdir(this.headsDirectory, { withFileTypes: true });
    const heads = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d{8}\.json$/.test(entry.name)) continue;
      try {
        const record = await readJson(path.join(this.headsDirectory, entry.name));
        const { checksum, ...payload } = record;
        if (canonicalSha256(payload).sha256 !== checksum) continue;
        heads.push(record);
      } catch {
        // Incomplete/corrupt heads are ignored just like interrupted flash records.
      }
    }
    return heads.sort((left, right) => right.generation - left.generation);
  }

  async appendHead(payload, { leaveTempOnly = false } = {}) {
    const heads = await this.readHeads();
    const generation = (heads[0]?.generation ?? 0) + 1;
    const recordPayload = {
      schemaVersion: 1,
      generation,
      activeSlot: payload.activeSlot,
      lastGoodSlot: payload.lastGoodSlot,
      activeSnapshotId: payload.activeSnapshotId,
      reason: payload.reason,
    };
    const record = { ...recordPayload, checksum: canonicalSha256(recordPayload).sha256 };
    const destination = path.join(this.headsDirectory, `${String(generation).padStart(8, "0")}.json`);
    const writeResult = await durableWrite(destination, `${JSON.stringify(record)}\n`, { leaveTempOnly });
    this.record(leaveTempOnly ? "head-temp-written" : "head-committed", {
      generation,
      destination: path.basename(destination),
      temp: path.basename(writeResult.temp),
    });
    return record;
  }

  async boot({ repair = true } = {}) {
    const heads = await this.readHeads();
    if (heads.length === 0) throw new SnapshotSimError("NO_BOOTABLE_SNAPSHOT", "No committed head records");
    const newest = heads[0];
    try {
      const active = await this.verifySlot(newest.activeSlot, { requireComplete: true });
      if (active.manifest.snapshotId !== newest.activeSnapshotId) {
        throw new SnapshotSimError("HEAD_SNAPSHOT_MISMATCH", "Head snapshotId differs from active slot");
      }
      this.record("boot-active", { generation: newest.generation, slot: newest.activeSlot });
      return {
        generation: newest.generation,
        activeSlot: newest.activeSlot,
        lastGoodSlot: newest.lastGoodSlot,
        snapshotId: active.manifest.snapshotId,
        rolledBack: false,
      };
    } catch (activeError) {
      const fallbacks = [newest.lastGoodSlot, ...heads.slice(1).map((head) => head.activeSlot)];
      for (const slot of [...new Set(fallbacks)]) {
        try {
          const fallback = await this.verifySlot(slot, { requireComplete: true });
          if (repair) {
            await this.appendHead({
              activeSlot: slot,
              lastGoodSlot: slot,
              activeSnapshotId: fallback.manifest.snapshotId,
              reason: "boot-rollback",
            });
          }
          this.record("boot-rollback", {
            fromSlot: newest.activeSlot,
            toSlot: slot,
            cause: activeError.code ?? activeError.message,
          });
          const repairedHeads = await this.readHeads();
          return {
            generation: repair ? repairedHeads[0].generation : newest.generation,
            activeSlot: slot,
            lastGoodSlot: slot,
            snapshotId: fallback.manifest.snapshotId,
            rolledBack: true,
            rollbackCause: activeError.code ?? activeError.message,
          };
        } catch {
          // Try the next committed historical slot.
        }
      }
      throw new SnapshotSimError("NO_BOOTABLE_SNAPSHOT", "Active and last-good snapshots both failed verification", {
        activeError: activeError.code ?? activeError.message,
      });
    }
  }

  async status() {
    const state = await this.boot({ repair: false });
    const heads = await this.readHeads();
    return { ...state, committedHeadCount: heads.length, eventCount: this.events.length };
  }

  async corruptActiveFile(relativePath) {
    const state = await this.boot({ repair: false });
    if (!safeSnapshotPath(relativePath)) {
      throw new SnapshotSimError("MANIFEST_PATH_INVALID", `Unsafe corruption path: ${relativePath}`);
    }
    const target = path.join(this.slotDirectory(state.activeSlot), relativePath);
    await stat(target);
    const original = await readFile(target);
    if (original.length === 0) throw new SnapshotSimError("FAULT_INJECTION_INVALID", "Cannot corrupt an empty file");
    const corrupted = Buffer.from(original);
    corrupted[0] ^= 0x01;
    await writeFile(target, corrupted);
    this.record("active-file-corrupted", { slot: state.activeSlot, path: relativePath });
  }
}
