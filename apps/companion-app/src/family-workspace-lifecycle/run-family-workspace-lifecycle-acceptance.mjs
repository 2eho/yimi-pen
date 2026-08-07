import { createHash } from "node:crypto";
import {
  execFile,
} from "node:child_process";
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  closeFamilyWorkspace,
  createFamilyWorkspace,
} from "../family-workspace/family-workspace.mjs";
import {
  createFamilyWorkspaceLifecycleFilesystemAdapter,
  markerBytes,
} from "./family-workspace-lifecycle-filesystem-adapter.mjs";
import {
  assertWorkspaceDirectoryName,
  createLifecycleDescriptor,
  encodeLifecycleDescriptor,
} from "./family-workspace-lifecycle-contract.mjs";
import { createFamilyWorkspaceLifecycle } from "./family-workspace-lifecycle-service.mjs";

const execFileAsync = promisify(execFile);
const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_ROOT, "../../../..");
const RUN_ROOT = path.join(REPO_ROOT, "build", "companion-family-workspace-lifecycle-validation");
const WORKSPACE_ROOT = path.join(RUN_ROOT, "workspaces");
const SOURCE_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden/assets");
const FIXTURE_WAV = path.join(SOURCE_ROOT, "clip-013-1.wav");
const CHILD_RUNNER = path.join(MODULE_ROOT, "run-family-workspace-lifecycle-child-list.mjs");
const PRIMARY_ID = "FAMILY-REPO-LIFECYCLE-PRIMARY-001";
const RETRY_ID = "FAMILY-REPO-LIFECYCLE-RETRY-001";
const BETA_ID = "FAMILY-REPO-LIFECYCLE-BETA-001";
const SHARED_REPLICA_ID = "FAMILY-REPO-LIFECYCLE-SHARED-001";
const CLOSER_ID = "FAMILY-REPO-LIFECYCLE-CLOSER-001";
const OBSERVED_AT = "2026-08-05T12:00:00.000Z";
const LIMITS = Object.freeze({
  maxBackupBytes: 4 * 1024 * 1024,
  maxEntries: 128,
  maxAssetBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(file) {
  return sha256(await readFile(file));
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectCode(action, code) {
  try {
    await action();
  } catch (error) {
    if (error?.code === code) return error;
    throw new Error(`expected ${code}, received ${error?.code ?? error?.name ?? "UNKNOWN"}`);
  }
  throw new Error(`expected ${code}, received success`);
}

async function probeCanonicalWav(filePath) {
  const bytes = Buffer.from(await readFile(filePath));
  if (bytes.length < 44
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WAVE"
    || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error("fixture WAV header is not canonical");
  }
  let offset = 12;
  let format = null;
  let dataLength = null;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd > bytes.length) throw new Error("fixture WAV chunk exceeds file length");
    if (chunkId === "fmt ") {
      if (format !== null || chunkLength !== 16) throw new Error("fixture WAV fmt chunk is not canonical");
      format = {
        audioFormat: bytes.readUInt16LE(dataStart),
        channels: bytes.readUInt16LE(dataStart + 2),
        sampleRate: bytes.readUInt32LE(dataStart + 4),
        byteRate: bytes.readUInt32LE(dataStart + 8),
        blockAlign: bytes.readUInt16LE(dataStart + 12),
        bitsPerSample: bytes.readUInt16LE(dataStart + 14),
      };
    } else if (chunkId === "data") {
      if (dataLength !== null) throw new Error("fixture WAV has duplicate data chunks");
      dataLength = chunkLength;
    } else {
      throw new Error(`fixture WAV has unsupported chunk ${JSON.stringify(chunkId)}`);
    }
    offset = dataEnd + (chunkLength % 2);
  }
  if (offset !== bytes.length || !format || dataLength === null
    || format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16_000
    || format.byteRate !== 32_000 || format.blockAlign !== 2 || format.bitsPerSample !== 16
    || dataLength <= 0 || dataLength % 2 !== 0 || (dataLength * 1_000) % format.byteRate !== 0) {
    throw new Error("fixture WAV is outside WAV_PCM16_16K_MONO");
  }
  return Object.freeze({
    codecProfile: "WAV_PCM16_16K_MONO",
    durationMs: (dataLength * 1_000) / format.byteRate,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function createProbeWitness() {
  let barrier = null;
  return Object.freeze({
    async probe(filePath) {
      const result = await probeCanonicalWav(filePath);
      const active = barrier;
      if (active) {
        barrier = null;
        active.entered.resolve();
        await active.release.promise;
      }
      return result;
    },
    blockNextProbe() {
      const entered = deferred();
      const release = deferred();
      barrier = { entered, release };
      return Object.freeze({ entered: entered.promise, release: release.resolve });
    },
  });
}

function workspacePath(name) {
  return path.join(WORKSPACE_ROOT, name);
}

async function createMarkerWorkspace(name, repositoryId) {
  const root = workspacePath(name);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "family-workspace.json"), markerBytes(repositoryId), { flag: "wx" });
  return root;
}

function safeError(error) {
  return `${error?.code ?? error?.name ?? "ERROR"}:${error?.message ?? ""}`;
}

const checks = [];
async function check(name, action) {
  try {
    const detail = await action();
    checks.push({ name, passed: true, detail: detail === undefined ? "ok" : String(detail) });
  } catch (error) {
    checks.push({ name, passed: false, detail: safeError(error) });
  }
}

await rm(RUN_ROOT, { recursive: true, force: true });
await mkdir(WORKSPACE_ROOT, { recursive: true });
const probeWitness = createProbeWitness();
const lifecycle = createFamilyWorkspaceLifecycle({
  allowedRoot: WORKSPACE_ROOT,
  workspaceOptions: {
    probeCanonicalWav: probeWitness.probe,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
    capturePortFactory: null,
  },
  clock: () => OBSERVED_AT,
});

let primaryResult;
let primaryImport;
let reopenedResult;
let beforeHead;

await check("empty root is a read-only deterministic list", async () => {
  const listed = await lifecycle.list();
  assert(Array.isArray(listed) && listed.length === 0, "root was not empty");
  return "0 entries";
});

await check("create publishes sidecar after FamilyWorkspace initialization", async () => {
  primaryResult = await lifecycle.create({
    workspaceDirectoryName: "primary",
    repositoryId: PRIMARY_ID,
    operationId: "OP-LIFECYCLE-CREATE-PRIMARY",
  });
  assert(primaryResult.summary.state === "ACTIVE", "create did not publish ACTIVE");
  assert(primaryResult.summary.workspaceId === PRIMARY_ID, "create identity differs");
  assert(Object.keys(primaryResult.summary).length === 10, "descriptor key set drifted");
  assert(!JSON.stringify(primaryResult).includes(RUN_ROOT), "public result leaked an absolute path");
  return primaryResult.summary.descriptorId;
});

await check("valid marker and sidecar are included in sorted list", async () => {
  const listed = await lifecycle.list();
  assert(listed.length === 1 && listed[0].workspaceId === PRIMARY_ID, "valid workspace missing");
  return listed.map((item) => item.workspaceDirectoryName).join(",");
});

await check("unmarked, nested, staging and symlink roots are excluded", async () => {
  await mkdir(workspacePath("unmarked"), { recursive: true });
  await createMarkerWorkspace("nested-parent", "FAMILY-REPO-NESTED-001");
  await mkdir(path.join(workspacePath("nested-parent"), "child"), { recursive: true });
  await mkdir(workspacePath(".staging-root"), { recursive: true });
  const outside = path.join(RUN_ROOT, "outside");
  await mkdir(outside, { recursive: true });
  let symlinkCreated = false;
  try {
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, workspacePath("symlink-root"), "junction");
    symlinkCreated = true;
  } catch {
    // Windows policy may disallow junction creation; the adapter still rejects
    // the same path class through lstat/realpath checks.
  }
  const listed = await lifecycle.list();
  assert(listed.length === 1 && listed[0].workspaceId === PRIMARY_ID, "unmanaged roots were adopted");
  return symlinkCreated ? "symlink=excluded" : "symlink=environment-unavailable; path gate covered";
});

await check("same-process open is idempotent and preserves capability identity", async () => {
  const opened = await lifecycle.open({ workspaceDirectoryName: "primary", operationId: "OP-LIFECYCLE-OPEN-PRIMARY" });
  assert(opened.workspace === primaryResult.workspace, "same-process open created a duplicate capability");
  return "same capability";
});

await check("composition drift remains rejected by existing FamilyWorkspace registry", async () => {
  const differentProbe = async () => ({ codecProfile: "WAV_PCM16_16K_MONO", durationMs: 1 });
  await expectCode(() => createFamilyWorkspace({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: workspacePath("primary"),
    repositoryId: PRIMARY_ID,
    probeCanonicalWav: differentProbe,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
    capturePortFactory: null,
  }), "FAMILY_WORKSPACE_ALREADY_OPEN");
  return "registry drift preserved";
});

await check("close is busy while an import operation is active", async () => {
  beforeHead = await primaryResult.workspace.read.open();
  const gate = probeWitness.blockNextProbe();
  const importPromise = primaryResult.workspace.authoring.importFile({
    sourcePath: FIXTURE_WAV,
    assetId: "asset-lifecycle-primary",
  });
  await gate.entered;
  await expectCode(() => lifecycle.close({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-CLOSE-BUSY",
  }), "FAMILY_WORKSPACE_BUSY");
  gate.release();
  primaryImport = await importPromise;
  assert(primaryImport.bytes > 0 && primaryImport.sha256.length === 64, "import did not complete");
  return "busy close preserved the live coordinator";
});

await check("legacy OPEN_WORKSPACES close/reopen regression: idle close releases exactly one capability", async () => {
  const receipt = await lifecycle.close({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-CLOSE-PRIMARY",
  });
  assert(receipt.status === "CLOSED", "close did not close");
  await expectCode(() => primaryResult.workspace.read.open(), "FAMILY_WORKSPACE_CLOSED");
  const again = await lifecycle.close({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-CLOSE-PRIMARY-IDEMPOTENT",
  });
  assert(again.idempotent === true, "same close was not idempotent");
  return "old capability rejected";
});

await check("reopen returns a distinct capability with the same repository head", async () => {
  reopenedResult = await lifecycle.reopen({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-REOPEN-PRIMARY",
  });
  const afterHead = await reopenedResult.workspace.read.open();
  assert(reopenedResult.workspace !== primaryResult.workspace, "reopen reused the closed capability");
  assert(JSON.stringify(afterHead) === JSON.stringify(beforeHead), "repository head changed on reopen");
  return afterHead.headRevisionId ?? "null-head";
});

await check("stale caller descriptor identity rejects before archive closes the handle", async () => {
  await expectCode(() => lifecycle.archive({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-ARCHIVE-STALE",
    expectedDescriptorId: `family-workspace-lifecycle:sha256:${"f".repeat(64)}`,
  }), "FAMILY_WORKSPACE_DESCRIPTOR_STALE");
  const stillOpen = await reopenedResult.workspace.read.open();
  assert(stillOpen.headRevisionId === beforeHead.headRevisionId, "stale archive changed the live workspace");
  return "stale identity guarded close";
});

await check("archive is metadata-only for marker, repository and asset bytes", async () => {
  const root = workspacePath("primary");
  const markerHashBefore = await sha256File(path.join(root, "family-workspace.json"));
  const repositoryHashBefore = await sha256File(path.join(root, "repository", "state.json"));
  const assetHashBefore = await sha256File(path.join(root, "asset-vault", primaryImport.contentPath));
  const archived = await lifecycle.archive({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-ARCHIVE-PRIMARY",
    expectedDescriptorId: reopenedResult.summary.descriptorId,
  });
  assert(archived.summary.state === "ARCHIVED", "archive did not transition state");
  assert(await sha256File(path.join(root, "family-workspace.json")) === markerHashBefore, "marker changed");
  assert(await sha256File(path.join(root, "repository", "state.json")) === repositoryHashBefore, "repository changed");
  assert(await sha256File(path.join(root, "asset-vault", primaryImport.contentPath)) === assetHashBefore, "asset changed");
  await expectCode(() => reopenedResult.workspace.read.open(), "FAMILY_WORKSPACE_CLOSED");
  const replay = await lifecycle.archive({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-ARCHIVE-PRIMARY",
    expectedDescriptorId: `family-workspace-lifecycle:sha256:${"0".repeat(64)}`,
  });
  assert(replay.summary.descriptorId === archived.summary.descriptorId, "archive replay did not return persisted success");
  return "raw content hashes unchanged";
});

await check("archived open is rejected before content mutation", async () => {
  await expectCode(() => lifecycle.open({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-OPEN-ARCHIVED",
  }), "FAMILY_WORKSPACE_ARCHIVED");
  const listed = await lifecycle.list();
  assert(listed.find((item) => item.workspaceId === PRIMARY_ID)?.state === "ARCHIVED", "archive state not discoverable");
  return "archived is closed";
});

await check("unarchive is reversible and idempotent", async () => {
  const first = await lifecycle.unarchive({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-UNARCHIVE-PRIMARY",
    expectedDescriptorId: (await lifecycle.list()).find((item) => item.workspaceId === PRIMARY_ID).descriptorId,
  });
  const second = await lifecycle.unarchive({
    workspaceDirectoryName: "primary",
    operationId: "OP-LIFECYCLE-UNARCHIVE-PRIMARY-IDEMPOTENT",
    expectedDescriptorId: first.summary.descriptorId,
  });
  assert(first.summary.state === "ACTIVE" && second.summary.state === "ACTIVE", "unarchive state mismatch");
  return "ACTIVE/ACTIVE";
});

await check("same repositoryId replicas keep path-owned handles isolated", async () => {
  const replicaA = await lifecycle.create({
    workspaceDirectoryName: "replica-a",
    repositoryId: SHARED_REPLICA_ID,
    operationId: "OP-LIFECYCLE-CREATE-REPLICA-A",
  });
  const replicaB = await lifecycle.create({
    workspaceDirectoryName: "replica-b",
    repositoryId: SHARED_REPLICA_ID,
    operationId: "OP-LIFECYCLE-CREATE-REPLICA-B",
  });
  assert(replicaA.summary.workspaceId === replicaB.summary.workspaceId, "replica identities did not match");
  assert(replicaA.workspace !== replicaB.workspace, "replica capabilities were merged");
  await lifecycle.close({ workspaceDirectoryName: "replica-a", operationId: "OP-LIFECYCLE-CLOSE-REPLICA-A" });
  await replicaB.workspace.read.open();
  const archivedA = await lifecycle.archive({
    workspaceDirectoryName: "replica-a",
    operationId: "OP-LIFECYCLE-ARCHIVE-REPLICA-A",
    expectedDescriptorId: replicaA.summary.descriptorId,
  });
  assert(archivedA.summary.state === "ARCHIVED", "replica A did not archive");
  assert((await lifecycle.list()).find((item) => item.workspaceDirectoryName === "replica-b")?.state === "ACTIVE",
    "replica B state changed with replica A");
  await replicaB.workspace.read.open();
  await lifecycle.close({ workspaceDirectoryName: "replica-b", operationId: "OP-LIFECYCLE-CLOSE-REPLICA-B" });
  return "same workspaceId, independent path ownership";
});

await check("lifecycle uses the injected workspace closer port", async () => {
  const calls = [];
  const closerLifecycle = createFamilyWorkspaceLifecycle({
    allowedRoot: WORKSPACE_ROOT,
    workspaceOptions: {
      probeCanonicalWav: probeWitness.probe,
      maxImportBytes: LIMITS.maxAssetBytes,
      maintenanceLimits: LIMITS,
      capturePortFactory: null,
    },
    workspaceCloser: async (input) => {
      calls.push(input.workspace);
      return closeFamilyWorkspace(input);
    },
    clock: () => OBSERVED_AT,
  });
  await closerLifecycle.create({
    workspaceDirectoryName: "closer-port",
    repositoryId: CLOSER_ID,
    operationId: "OP-LIFECYCLE-CREATE-CLOSER",
  });
  await closerLifecycle.close({
    workspaceDirectoryName: "closer-port",
    operationId: "OP-LIFECYCLE-CLOSE-CLOSER",
  });
  assert(calls.length === 1, "injected closer was not called exactly once");
  return "explicit closer invoked";
});

await check("path traversal is rejected without a filesystem write", async () => {
  await expectCode(() => lifecycle.open({ workspaceDirectoryName: "../escape" }), "FAMILY_WORKSPACE_PATH_INVALID");
  const adapter = createFamilyWorkspaceLifecycleFilesystemAdapter();
  await expectCode(() => adapter.read({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: "primary/../primary" }), "FAMILY_WORKSPACE_PATH_INVALID");
  return "traversal rejected";
});

await check("invalid clock output has a stable lifecycle error", async () => {
  const badClockLifecycle = createFamilyWorkspaceLifecycle({
    allowedRoot: WORKSPACE_ROOT,
    workspaceOptions: {
      probeCanonicalWav: probeWitness.probe,
      maxImportBytes: LIMITS.maxAssetBytes,
      maintenanceLimits: LIMITS,
      capturePortFactory: null,
    },
    clock: () => "not-rfc3339",
  });
  await expectCode(() => badClockLifecycle.create({
    workspaceDirectoryName: "bad-clock",
    repositoryId: "FAMILY-REPO-LIFECYCLE-BAD-CLOCK-001",
    operationId: "OP-LIFECYCLE-BAD-CLOCK",
  }), "FAMILY_WORKSPACE_CLOCK_INVALID");
  assert((await badClockLifecycle.list()).every((item) => item.workspaceDirectoryName !== "bad-clock"),
    "invalid clock published a descriptor");
  return "clock contract validated before descriptor creation";
});

await check("root, Unicode and Windows direct-child contracts are deterministic", async () => {
  const adapter = createFamilyWorkspaceLifecycleFilesystemAdapter();
  await expectCode(() => adapter.list({ allowedRoot: "." }), "FAMILY_WORKSPACE_ROOT_INVALID");
  await expectCode(() => lifecycle.open({ workspaceDirectoryName: "CON.txt" }), "FAMILY_WORKSPACE_PATH_INVALID");
  await expectCode(() => lifecycle.open({ workspaceDirectoryName: "family. " }), "FAMILY_WORKSPACE_PATH_INVALID");
  await expectCode(() => lifecycle.open({ workspaceDirectoryName: "\ud800" }), "FAMILY_WORKSPACE_DESCRIPTOR_INVALID");
  assertWorkspaceDirectoryName("家庭-学习");
  assertWorkspaceDirectoryName("my.family-workspace-project");
  return "relative root, valid dotted name, reserved names, trailing dot/space and lone surrogate covered";
});

await check("sidecar create retry leaves a failed directory unmanaged", async () => {
  let faultStage = "after-temp-write-before-sync";
  const faultAdapter = createFamilyWorkspaceLifecycleFilesystemAdapter({
    faultInjector: async (stage) => {
      if (stage === faultStage) throw new Error("fixture fault");
    },
  });
  const faultLifecycle = createFamilyWorkspaceLifecycle({
    allowedRoot: WORKSPACE_ROOT,
    filesystem: faultAdapter,
    workspaceOptions: {
      probeCanonicalWav: probeWitness.probe,
      maxImportBytes: LIMITS.maxAssetBytes,
      maintenanceLimits: LIMITS,
      capturePortFactory: null,
    },
    clock: () => OBSERVED_AT,
  });
  await expectCode(() => faultLifecycle.create({
    workspaceDirectoryName: "retry",
    repositoryId: RETRY_ID,
    operationId: "OP-LIFECYCLE-CREATE-RETRY-FAULT",
  }), "FAMILY_WORKSPACE_DESCRIPTOR_WRITE_FAILED");
  assert((await faultLifecycle.list()).every((item) => item.workspaceId !== RETRY_ID), "failed sidecar was adopted");
  faultStage = null;
  const retry = await faultLifecycle.create({
    workspaceDirectoryName: "retry",
    repositoryId: RETRY_ID,
    operationId: "OP-LIFECYCLE-CREATE-RETRY",
  });
  assert(retry.summary.state === "ACTIVE", "retry did not publish sidecar");
  return "failed publication was retryable";
});

await check("stale descriptor CAS rejects without changing bytes", async () => {
  const adapter = createFamilyWorkspaceLifecycleFilesystemAdapter();
  const before = await adapter.read({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: "retry" });
  const beforeBytes = await readFile(path.join(workspacePath("retry"), "family-workspace-lifecycle.json"));
  const next = createLifecycleDescriptor({
    ...before.descriptor,
    state: "ARCHIVED",
    updatedAt: OBSERVED_AT,
    lastOperationId: "OP-LIFECYCLE-STALE-NEXT",
  });
  await expectCode(() => adapter.writeCas({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectoryName: "retry",
    expectedDescriptorId: "0".repeat(64),
    descriptor: next,
  }), "FAMILY_WORKSPACE_DESCRIPTOR_STALE");
  const afterBytes = await readFile(path.join(workspacePath("retry"), "family-workspace-lifecycle.json"));
  assert(beforeBytes.equals(afterBytes), "stale CAS changed descriptor bytes");
  return "CAS compare was byte-stable";
});

await check("short exclusive CAS lock prevents a lost update", async () => {
  const name = "lock-case";
  const repositoryId = "FAMILY-REPO-LIFECYCLE-LOCK-001";
  await createMarkerWorkspace(name, repositoryId);
  const baseDescriptor = createLifecycleDescriptor({
    workspaceId: repositoryId,
    workspaceDirectoryName: name,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    lastOperationId: "OP-LOCK-BASE",
    markerSha256: sha256(markerBytes(repositoryId)),
  });
  const baseAdapter = createFamilyWorkspaceLifecycleFilesystemAdapter();
  await baseAdapter.create({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: name, descriptor: baseDescriptor });
  const entered = deferred();
  const release = deferred();
  const winnerAdapter = createFamilyWorkspaceLifecycleFilesystemAdapter({
    faultInjector: async (stage) => {
      if (stage === "after-lock-acquired") {
        entered.resolve();
        await release.promise;
      }
    },
  });
  const loserAdapter = createFamilyWorkspaceLifecycleFilesystemAdapter();
  const winnerDescriptor = createLifecycleDescriptor({
    ...baseDescriptor,
    state: "ARCHIVED",
    updatedAt: OBSERVED_AT,
    lastOperationId: "OP-LOCK-WINNER",
  });
  const winnerPromise = winnerAdapter.writeCas({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectoryName: name,
    expectedDescriptorId: baseDescriptor.descriptorId,
    descriptor: winnerDescriptor,
  });
  await entered.promise;
  await expectCode(() => loserAdapter.writeCas({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectoryName: name,
    expectedDescriptorId: baseDescriptor.descriptorId,
    descriptor: createLifecycleDescriptor({
      ...baseDescriptor,
      state: "ACTIVE",
      updatedAt: OBSERVED_AT,
      lastOperationId: "OP-LOCK-LOSER",
    }),
  }), "FAMILY_WORKSPACE_LOCKED");
  release.resolve();
  await winnerPromise;
  await expectCode(() => loserAdapter.writeCas({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectoryName: name,
    expectedDescriptorId: baseDescriptor.descriptorId,
    descriptor: baseDescriptor,
  }), "FAMILY_WORKSPACE_DESCRIPTOR_STALE");
  const persisted = await loserAdapter.read({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: name });
  assert(persisted.descriptor.state === "ARCHIVED", "winner update was lost");
  return "lock/old-expected stale";
});

await check("duplicate and noncanonical descriptor bytes are ignored", async () => {
  await createMarkerWorkspace("duplicate", "FAMILY-REPO-DUPLICATE-001");
  const duplicate = `{"schemaVersion":1,"profile":"family-workspace-lifecycle-v1","workspaceId":"FAMILY-REPO-DUPLICATE-001","workspaceDirectoryName":"duplicate","state":"ACTIVE","createdAt":"${OBSERVED_AT}","updatedAt":"${OBSERVED_AT}","lastOperationId":"OP-DUP","markerSha256":"${sha256(markerBytes("FAMILY-REPO-DUPLICATE-001"))}","descriptorId":"x","descriptorId":"y"}`;
  await writeFile(path.join(workspacePath("duplicate"), "family-workspace-lifecycle.json"), duplicate);
  const adapter = createFamilyWorkspaceLifecycleFilesystemAdapter();
  assert((await lifecycle.list()).every((item) => item.workspaceId !== "FAMILY-REPO-DUPLICATE-001"), "duplicate descriptor was listed");
  await expectCode(() => adapter.read({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: "duplicate" }), "FAMILY_WORKSPACE_DESCRIPTOR_INVALID");
  await createMarkerWorkspace("noncanonical", "FAMILY-REPO-NONCANONICAL-001");
  const valid = createLifecycleDescriptor({
    workspaceId: "FAMILY-REPO-NONCANONICAL-001",
    workspaceDirectoryName: "noncanonical",
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    lastOperationId: "OP-NONCANONICAL",
    markerSha256: sha256(markerBytes("FAMILY-REPO-NONCANONICAL-001")),
  });
  const noncanonical = JSON.stringify(valid, null, 2);
  await writeFile(path.join(workspacePath("noncanonical"), "family-workspace-lifecycle.json"), noncanonical);
  await expectCode(() => adapter.read({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: "noncanonical" }), "FAMILY_WORKSPACE_DESCRIPTOR_NONCANONICAL");
  return "invalid descriptor forms were excluded";
});

await check("marker identity and descriptor identity are bound", async () => {
  await createMarkerWorkspace("identity-mismatch", "FAMILY-REPO-IDENTITY-MARKER-001");
  const descriptor = createLifecycleDescriptor({
    workspaceId: "FAMILY-REPO-OTHER-001",
    workspaceDirectoryName: "identity-mismatch",
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    lastOperationId: "OP-IDENTITY",
    markerSha256: sha256(markerBytes("FAMILY-REPO-IDENTITY-MARKER-001")),
  });
  await writeFile(path.join(workspacePath("identity-mismatch"), "family-workspace-lifecycle.json"), encodeLifecycleDescriptor(descriptor));
  const adapter = createFamilyWorkspaceLifecycleFilesystemAdapter();
  await expectCode(() => adapter.read({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: "identity-mismatch" }), "FAMILY_WORKSPACE_DESCRIPTOR_IDENTITY_MISMATCH");
  return "marker identity is authoritative";
});

await check("fault injection covers temp, sync, rename and reload boundaries", async () => {
  const stages = [
    "before-temp-create",
    "after-temp-create",
    "after-temp-write-before-sync",
    "after-temp-sync-before-close",
    "after-temp-close-before-rename",
    "after-rename-before-reload",
  ];
  for (let index = 0; index < stages.length; index += 1) {
    const name = `fault-${index}`;
    const repositoryId = `FAMILY-REPO-FAULT-${index}`;
    await createMarkerWorkspace(name, repositoryId);
    const descriptor = createLifecycleDescriptor({
      workspaceId: repositoryId,
      workspaceDirectoryName: name,
      createdAt: OBSERVED_AT,
      updatedAt: OBSERVED_AT,
      lastOperationId: `OP-FAULT-${index}`,
      markerSha256: sha256(markerBytes(repositoryId)),
    });
    const adapter = createFamilyWorkspaceLifecycleFilesystemAdapter({
      faultInjector: async (stage) => {
        if (stage === stages[index]) throw new Error("fault");
      },
    });
    if (stages[index] === "after-rename-before-reload") {
      const persisted = await adapter.create({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: name, descriptor });
      assert(persisted.descriptorId === descriptor.descriptorId, "post-rename committed truth was lost");
      assert(await exists(path.join(workspacePath(name), "family-workspace-lifecycle.json")), "committed sidecar was deleted");
    } else {
      await expectCode(() => adapter.create({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: name, descriptor }), "FAMILY_WORKSPACE_DESCRIPTOR_WRITE_FAILED");
      assert(!(await exists(path.join(workspacePath(name), "family-workspace-lifecycle.json"))), "failed sidecar publication was adopted");
    }
    await rm(workspacePath(name), { recursive: true, force: true });
  }
  return `${stages.length} deterministic fault stages`;
});

await check("pre-rename CAS faults preserve the authoritative descriptor", async () => {
  const name = "cas-pre-rename";
  const repositoryId = "FAMILY-REPO-LIFECYCLE-CAS-FAULT-001";
  await createMarkerWorkspace(name, repositoryId);
  const base = createLifecycleDescriptor({
    workspaceId: repositoryId,
    workspaceDirectoryName: name,
    createdAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    lastOperationId: "OP-CAS-FAULT-BASE",
    markerSha256: sha256(markerBytes(repositoryId)),
  });
  const baseAdapter = createFamilyWorkspaceLifecycleFilesystemAdapter();
  await baseAdapter.create({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: name, descriptor: base });
  const faultAdapter = createFamilyWorkspaceLifecycleFilesystemAdapter({
    faultInjector: async (stage) => {
      if (stage === "after-temp-close-before-rename") throw new Error("pre-rename fault");
    },
  });
  const next = createLifecycleDescriptor({
    ...base,
    state: "ARCHIVED",
    updatedAt: OBSERVED_AT,
    lastOperationId: "OP-CAS-FAULT-NEXT",
  });
  await expectCode(() => faultAdapter.writeCas({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectoryName: name,
    expectedDescriptorId: base.descriptorId,
    descriptor: next,
  }), "FAMILY_WORKSPACE_DESCRIPTOR_WRITE_FAILED");
  const persisted = await baseAdapter.read({ allowedRoot: WORKSPACE_ROOT, workspaceDirectoryName: name });
  assert(persisted.descriptor.descriptorId === base.descriptorId && persisted.descriptor.state === "ACTIVE",
    "pre-rename fault changed authoritative descriptor");
  return "prior descriptor preserved";
});

await check("two-workspace lifecycle commands are isolated", async () => {
  const beta = await lifecycle.create({
    workspaceDirectoryName: "beta",
    repositoryId: BETA_ID,
    operationId: "OP-LIFECYCLE-CREATE-BETA",
  });
  const primaryState = (await lifecycle.list()).find((item) => item.workspaceId === PRIMARY_ID);
  assert(beta.summary.state === "ACTIVE" && primaryState?.state === "ACTIVE", "workspace states crossed");
  await lifecycle.close({ workspaceDirectoryName: "beta", operationId: "OP-LIFECYCLE-CLOSE-BETA" });
  return "primary/beta isolated";
});

await check("child process proves discovery/state without exposing paths", async () => {
  const { stdout } = await execFileAsync(process.execPath, [CHILD_RUNNER, WORKSPACE_ROOT, "primary"], { encoding: "utf8" });
  const childEvidence = JSON.parse(stdout);
  assert(childEvidence.workspaceId === PRIMARY_ID, "child did not discover primary");
  assert(childEvidence.state === "ACTIVE", "child did not see ACTIVE primary");
  assert(childEvidence.distinctCapability === true && childEvidence.sameHead === true,
    "child reopen did not produce a distinct capability with the same head");
  assert(!stdout.includes(RUN_ROOT), "child output exposed an absolute path");
  return `child list=${childEvidence.listCount}; restart head=${childEvidence.headRevisionId ?? "null"}`;
});

await check("public lifecycle summaries contain no coordinator, temp or raw marker bytes", async () => {
  const results = JSON.stringify(await lifecycle.list());
  assert(!results.includes(RUN_ROOT) && !results.includes("repositoryRoot") && !results.includes("temp"), "summary leaked private fields");
  assert(!results.includes(markerBytes(PRIMARY_ID).toString("utf8")), "summary leaked marker bytes");
  return "sanitized summaries";
});

const report = {
  schemaVersion: 1,
  profile: "family-workspace-lifecycle-acceptance-v1",
  checksPassed: checks.filter((checkResult) => checkResult.passed).length,
  checksFailed: checks.filter((checkResult) => !checkResult.passed).length,
  checks,
  boundaries: {
    storage: "single-process-app-owned-directories",
    lifecycleDescriptor: "family-workspace-lifecycle.json",
    archive: "metadata-only-reversible",
    shortLock: "NON_WAITING_SAME_DIRECTORY_WX",
    crossProcessLease: "OUT_OF_SCOPE",
    deviceInstall: "OUT_OF_SCOPE",
    offlineReady: false,
    BOARD_TARGET: "UNRESOLVED",
    hardwareImpact: "NONE",
  },
};
await writeFile(path.join(RUN_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const reportHash = await sha256File(path.join(RUN_ROOT, "report.json"));
if (report.checksFailed > 0) {
  throw new Error(`family workspace lifecycle acceptance failed: ${report.checksFailed}`);
}
process.stdout.write(`family-workspace-lifecycle: ${report.checksPassed}/${checks.length}; reportSha256=${reportHash}\n`);
