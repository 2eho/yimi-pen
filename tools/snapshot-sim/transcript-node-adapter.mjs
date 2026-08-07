import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { SnapshotDeviceSimulator, SnapshotSimError } from "./simulator.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(moduleDirectory, "../..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function assertUnique(items, field, label) {
  const values = items.map((item) => item[field]);
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} ${field} values must be unique`);
  }
}

async function loadTranscript(repoRoot, transcriptPath) {
  const schemaPath = path.join(repoRoot, "hardware/evt0/snapshot-v1/operation-transcript.schema.json");
  const [schema, transcript] = await Promise.all([readJson(schemaPath), readJson(transcriptPath)]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(transcript)) {
    throw new Error(`Snapshot operation transcript schema failed: ${ajv.errorsText(validate.errors)}`);
  }
  assertUnique(transcript.snapshots, "key", "snapshot");
  assertUnique(transcript.snapshots, "snapshotId", "snapshot");
  assertUnique(transcript.devices, "id", "device");
  assertUnique(transcript.scenarios, "id", "scenario");

  const snapshotKeys = new Set(transcript.snapshots.map((snapshot) => snapshot.key));
  const deviceIds = new Set(transcript.devices.map((device) => device.id));
  for (const scenario of transcript.scenarios) {
    if (!deviceIds.has(scenario.device)) throw new Error(`${scenario.id} names unknown device ${scenario.device}`);
    if (scenario.operation.snapshot && !snapshotKeys.has(scenario.operation.snapshot)) {
      throw new Error(`${scenario.id} names unknown snapshot ${scenario.operation.snapshot}`);
    }
  }
  return transcript;
}

async function prepareSnapshots(repoRoot, fixtureRoot, snapshots) {
  const prepared = new Map();
  for (const snapshot of snapshots) {
    const source = path.resolve(repoRoot, snapshot.sourceDirectory);
    if (!isInside(repoRoot, source)) throw new Error(`Snapshot source escaped repository: ${source}`);
    const target = path.join(fixtureRoot, snapshot.key);
    await cp(source, target, { recursive: true });

    const actionsPath = path.join(target, "actions.json");
    const actions = await readJson(actionsPath);
    if (!Array.isArray(actions.actions) || actions.actions.length === 0) {
      throw new Error(`${snapshot.key} source has no action to mutate`);
    }
    actions.actions[0].cooldownMs = snapshot.firstActionCooldownMs;
    await writeFile(actionsPath, `${JSON.stringify(actions, null, 2)}\n`, "utf8");

    const manifestPath = path.join(target, "manifest.json");
    const manifest = await readJson(manifestPath);
    if (manifest.releaseState !== snapshot.releaseState) {
      throw new Error(
        `${snapshot.key} releaseState drift: transcript=${snapshot.releaseState} source=${manifest.releaseState}`,
      );
    }
    const actionsBytes = await readFile(actionsPath);
    const actionsFile = manifest.files.find((file) => file.path === "actions.json");
    if (!actionsFile) throw new Error(`${snapshot.key} manifest does not list actions.json`);
    actionsFile.size = actionsBytes.length;
    actionsFile.sha256 = sha256(actionsBytes);
    manifest.actions.size = actionsBytes.length;
    manifest.actions.sha256 = sha256(actionsBytes);
    manifest.snapshotId = snapshot.snapshotId;
    manifest.contentRevision = snapshot.contentRevision;
    const payloadBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
    let requiredBytes = payloadBytes;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      manifest.install.requiredBytes = requiredBytes;
      const manifestBytes = Buffer.byteLength(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const next = payloadBytes + manifestBytes;
      if (next === requiredBytes) break;
      requiredBytes = next;
    }
    manifest.install.requiredBytes = requiredBytes;
    if (manifest.install.requiredBytes !== snapshot.requiredBytes) {
      throw new Error(
        `${snapshot.key} requiredBytes drift: transcript=${snapshot.requiredBytes} generated=${manifest.install.requiredBytes}`,
      );
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    prepared.set(snapshot.key, { directory: target, spec: snapshot });
  }
  return prepared;
}

function simulatorCapabilities(device) {
  return {
    boardTarget: "UNFROZEN",
    firmwareVersion: "UNFROZEN",
    snapshotSchemaVersions: [1],
    activationModes: ["staged-atomic"],
    storageFreeBytes: device.storageFreeBytes,
    capabilities: ["oid-map:logical-only", "snapshot:staged-atomic", "audio:board-negotiated"],
  };
}

function faultForSimulator(fault) {
  if (!fault) return {};
  switch (fault.type) {
    case "corrupt-file":
      return { corruptFilePath: fault.filePath };
    case "power-loss-during-staging":
      return { afterFileCount: fault.afterFileCount };
    case "power-loss-before-head-commit":
      return { beforeHeadCommit: true };
    default:
      throw new Error(`Unknown transcript fault ${fault.type}`);
  }
}

function normalizeOutcome(state, error) {
  return {
    active: state?.activeSlot ?? null,
    lastGood: state?.lastGoodSlot ?? null,
    generation: state?.generation ?? 0,
    snapshot: state?.snapshotId ?? null,
    error,
  };
}

async function executeScenario(scenario, device, snapshots) {
  let state = null;
  let errorCode = null;
  try {
    switch (scenario.operation.op) {
      case "provision":
        state = await device.provision(snapshots.get(scenario.operation.snapshot).directory);
        break;
      case "install":
        state = await device.install(
          snapshots.get(scenario.operation.snapshot).directory,
          faultForSimulator(scenario.operation.fault),
        );
        break;
      case "corrupt-active-and-boot":
        await device.corruptActiveFile(scenario.operation.filePath);
        state = await device.boot({ repair: true });
        break;
      default:
        throw new Error(`Unknown transcript operation ${scenario.operation.op}`);
    }
  } catch (error) {
    if (!(error instanceof SnapshotSimError)) throw error;
    errorCode = error.code;
    switch (scenario.operation.recoverAfterError ?? "none") {
      case "status":
        state = await device.status();
        break;
      case "boot-repair":
        state = await device.boot({ repair: true });
        break;
      case "none":
        break;
      default:
        throw new Error(`Unknown recovery mode ${scenario.operation.recoverAfterError}`);
    }
  }
  return normalizeOutcome(state, errorCode);
}

export async function runNodeTranscript({
  repoRoot = defaultRepoRoot,
  transcriptPath = path.join(repoRoot, "hardware/evt0/snapshot-v1/operation-transcript.json"),
  buildRoot = path.join(repoRoot, "build/snapshot-sim"),
} = {}) {
  const resolvedRepo = path.resolve(repoRoot);
  const resolvedBuild = path.resolve(buildRoot);
  if (!isInside(path.join(resolvedRepo, "build"), resolvedBuild)) {
    throw new Error(`Snapshot transcript build path escaped build/: ${resolvedBuild}`);
  }
  await rm(resolvedBuild, { recursive: true, force: true });
  const fixtureRoot = path.join(resolvedBuild, "fixtures");
  await mkdir(fixtureRoot, { recursive: true });

  const transcript = await loadTranscript(resolvedRepo, transcriptPath);
  const snapshots = await prepareSnapshots(resolvedRepo, fixtureRoot, transcript.snapshots);
  const devices = new Map(
    transcript.devices.map((device) => [
      device.id,
      new SnapshotDeviceSimulator(
        path.join(resolvedBuild, "devices", device.id),
        simulatorCapabilities(device),
        { workspaceRoot: resolvedRepo, allowDesignFixtures: device.allowDesignFixtures },
      ),
    ]),
  );

  const results = [];
  for (const scenario of transcript.scenarios) {
    const device = devices.get(scenario.device);
    results.push({ id: scenario.id, ...(await executeScenario(scenario, device, snapshots)) });
  }
  return {
    schemaVersion: 1,
    profile: "node-file-ab-adapter",
    transcriptProfile: transcript.profile,
    results,
    eventLogs: Object.fromEntries([...devices].map(([id, device]) => [id, device.events])),
  };
}

async function main() {
  const repoRoot = defaultRepoRoot;
  const transcriptPath = path.resolve(process.argv[2] ?? path.join(repoRoot, "hardware/evt0/snapshot-v1/operation-transcript.json"));
  const outputPath = path.resolve(process.argv[3] ?? path.join(repoRoot, "build/snapshot-sim/node-transcript-result.json"));
  const result = await runNodeTranscript({ repoRoot, transcriptPath, buildRoot: path.dirname(outputPath) });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(outputPath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
