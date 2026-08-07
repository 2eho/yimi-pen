import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFamilyWorkspace } from "../family-workspace/family-workspace.mjs";
import { createLocalContentAddressedAudioVault } from "./local-content-addressed-audio-vault.mjs";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_ROOT, "../../../..");
const CHILD_PATH = path.join(MODULE_ROOT, "asset-vault-recovery-child.mjs");
const RUN_ROOT = path.join(REPO_ROOT, "build", "companion-asset-vault-recovery-validation");
const SCENARIOS_ROOT = path.join(RUN_ROOT, "scenarios");
const SOURCE_ROOT = path.join(RUN_ROOT, "sources");
const BASE_WAV_PATH = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden/assets/clip-013-1.wav");
const OBSERVED_AT = "2026-08-04T14:00:00.000Z";
const APPLIED_AT = "2026-08-04T14:00:01.000Z";
const REAPPLY_AT = "2026-08-04T14:00:02.000Z";
const OLD_MTIME = "2026-08-01T00:00:00.000Z";
const RETENTION_MS = 60 * 60 * 1_000;
const LIMITS = Object.freeze({
  maxBackupBytes: 4 * 1024 * 1024,
  maxEntries: 128,
  maxAssetBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});

const POSITIVE_SCENARIOS = Object.freeze([
  { label: "before-first-move", crashPoint: "BEFORE_FIRST_MOVE", exitCode: 71,
    status: "ROLLED_BACK_BEFORE_PURGE", phase: "QUARANTINING", deleted: 0, restored: 0, eligible: 2 },
  { label: "after-first-move", crashPoint: "AFTER_FIRST_MOVE", exitCode: 72,
    status: "ROLLED_BACK_BEFORE_PURGE", phase: "QUARANTINING", deleted: 0, restored: 1, eligible: 2 },
  { label: "before-first-purge", crashPoint: "BEFORE_FIRST_PURGE", exitCode: 73,
    status: "PARTIAL_PURGE_RECOVERED", phase: "PURGING", deleted: 0, restored: 2, eligible: 2 },
  { label: "after-first-purge-before-checkpoint", crashPoint: "AFTER_FIRST_PURGE_BEFORE_CHECKPOINT", exitCode: 74,
    status: "PARTIAL_PURGE_RECOVERED", phase: "PURGING", deleted: 1, restored: 1, eligible: 1 },
  { label: "after-prefix-checkpoint", crashPoint: "AFTER_PREFIX_CHECKPOINT", exitCode: 75,
    status: "PARTIAL_PURGE_RECOVERED", phase: "PURGING", deleted: 1, restored: 1, eligible: 1 },
  { label: "after-final-purge-before-checkpoint", crashPoint: "AFTER_FINAL_PURGE_BEFORE_CHECKPOINT", exitCode: 76,
    status: "PARTIAL_PURGE_RECOVERED", phase: "PURGING", deleted: 2, restored: 0, eligible: 0 },
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function changedWav(source, offset, xorValue) {
  const bytes = Buffer.from(source);
  bytes[bytes.length - offset] ^= xorValue;
  return bytes;
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

async function probeCanonicalWav(filePath) {
  const bytes = Buffer.from(await readFile(filePath));
  if (bytes.length < 44
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WAVE"
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error("fixture WAV header is not canonical");
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

async function runChild(mode, configPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD_PATH, mode, configPath], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

async function operationLayout(workspaceDirectory) {
  const maintenanceRoot = path.join(workspaceDirectory, "asset-vault", ".maintenance");
  const names = (await readdir(maintenanceRoot)).sort();
  if (names.length !== 1) throw new Error(`expected one operation, found ${names.join(",")}`);
  const operationRoot = path.join(maintenanceRoot, names[0]);
  return {
    maintenanceRoot,
    operationRoot,
    journalPath: path.join(operationRoot, "journal.json"),
    quarantineRoot: path.join(operationRoot, "quarantine"),
  };
}

async function writeConfig(target, config) {
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function main() {
  await rm(RUN_ROOT, { recursive: true, force: true });
  await mkdir(SCENARIOS_ROOT, { recursive: true });
  await mkdir(SOURCE_ROOT, { recursive: true });
  const baseWav = Buffer.from(await readFile(BASE_WAV_PATH));
  const sourcePaths = [
    path.join(SOURCE_ROOT, "orphan-a.wav"),
    path.join(SOURCE_ROOT, "orphan-b.wav"),
  ];
  await writeFile(sourcePaths[0], changedWav(baseWav, 7, 0x11));
  await writeFile(sourcePaths[1], changedWav(baseWav, 9, 0x22));

  const checks = [];
  const check = (name, passed, detail) => {
    if (!passed) throw new Error(`${name}: ${detail}`);
    checks.push({ name, passed: true, detail });
  };

  async function setupScenario(label, crashPoint) {
    const scenarioRoot = path.join(SCENARIOS_ROOT, label);
    const allowedRoot = path.join(scenarioRoot, "allowed");
    const workspaceDirectory = path.join(allowedRoot, "workspace");
    await mkdir(allowedRoot, { recursive: true });
    const repositoryId = `FAMILY-REPO-RECOVERY-${label.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "-")}`;
    const workspace = await createFamilyWorkspace({
      allowedRoot,
      workspaceDirectory,
      repositoryId,
      probeCanonicalWav,
      maxImportBytes: LIMITS.maxAssetBytes,
      maintenanceLimits: LIMITS,
    });
    const imported = [];
    for (let index = 0; index < sourcePaths.length; index += 1) {
      const receipt = await workspace.authoring.importFile({
        sourcePath: sourcePaths[index],
        assetId: `asset-recovery-${label}-${index + 1}`,
      });
      await utimes(receipt.absolutePath, new Date(OLD_MTIME), new Date(OLD_MTIME));
      imported.push(receipt);
    }
    const plan = await workspace.maintenance.plan({
      observedAt: OBSERVED_AT,
      retentionMs: RETENTION_MS,
      limits: LIMITS,
    });
    const planPath = path.join(scenarioRoot, "plan.json");
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    const configPath = path.join(scenarioRoot, "child-config.json");
    const resultPath = path.join(scenarioRoot, "restart-result.json");
    const operationId = `ASSET-GC-RECOVERY-${label.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "-")}`;
    const config = {
      allowedRoot,
      workspaceDirectory,
      repositoryId,
      planPath,
      resultPath,
      operationId,
      crashPoint,
      appliedAt: APPLIED_AT,
      observedAt: OBSERVED_AT,
      retentionMs: RETENTION_MS,
      limits: LIMITS,
    };
    await writeConfig(configPath, config);
    return { scenarioRoot, workspace, workspaceDirectory, imported, plan, config, configPath, resultPath };
  }

  const scenarioRecoveryIds = {};
  for (const expected of POSITIVE_SCENARIOS) {
    const fixture = await setupScenario(expected.label, expected.crashPoint);
    check(`${expected.label}: initial workspace is normalized`,
      fixture.workspace.descriptor.assetVaultRecovery.status === "NO_PENDING_OPERATION"
        && fixture.plan.summary.eligible === 2,
      `eligible=${fixture.plan.summary.eligible}`);
    if (expected.label === POSITIVE_SCENARIOS[0].label) {
      await expectCode(() => fixture.workspace.maintenance.plan({
        observedAt: OBSERVED_AT,
        retentionMs: RETENTION_MS,
        limits: { ...LIMITS, maxEntries: LIMITS.maxEntries + 1 },
      }), "FAMILY_WORKSPACE_LIMIT_INVALID");
      check("workspace owns one explicit maintenance policy", true, "mismatched request rejected");
    }
    const crashed = await runChild("crash-apply", fixture.configPath);
    check(`${expected.label}: child exits at awaited filesystem checkpoint`,
      crashed.code === expected.exitCode && crashed.signal === null,
      `code=${crashed.code} signal=${crashed.signal ?? "none"} stderr=${crashed.stderr.trim() || "none"}`);
    const directVault = createLocalContentAddressedAudioVault({
      vaultRoot: path.join(fixture.workspaceDirectory, "asset-vault"),
    });
    await expectCode(() => directVault.inventory({ limits: LIMITS }), "ASSET_VAULT_RECOVERY_REQUIRED");
    check(`${expected.label}: ordinary inventory is gated until recovery`, true, "ASSET_VAULT_RECOVERY_REQUIRED");

    const restarted = await runChild("workspace-restart", fixture.configPath);
    const restartResult = JSON.parse(await readFile(fixture.resultPath, "utf8"));
    check(`${expected.label}: fresh process opens through workspace startup recovery`,
      restarted.code === 0 && restartResult.ok === true,
      `code=${restarted.code} error=${restartResult.code ?? "none"} stderr=${restarted.stderr.trim() || "none"}`);
    const recovery = restartResult.recovery;
    scenarioRecoveryIds[expected.label] = recovery.recoveryId;
    check(`${expected.label}: recovery receipt matches physical prefix and restored suffix`,
      recovery.status === expected.status
        && recovery.phase === expected.phase
        && recovery.deleted.length === expected.deleted
        && recovery.restored.length === expected.restored
        && recovery.requiresFreshPlan === true
        && recovery.cleanupComplete === true,
      `status=${recovery.status} deleted=${recovery.deleted.length} restored=${recovery.restored.length}`);
    check(`${expected.label}: post-recovery inventory is bound to a fresh plan`,
      recovery.postRecoveryInventoryId === restartResult.freshPlan.inventoryId
        && restartResult.freshPlan.summary.eligible === expected.eligible,
      `eligible=${restartResult.freshPlan.summary.eligible}`);
    check(`${expected.label}: owned maintenance directory is removed`,
      !(await exists(path.join(fixture.workspaceDirectory, "asset-vault", ".maintenance"))),
      recovery.recoveryId);

    const secondResultPath = path.join(fixture.scenarioRoot, "second-restart-result.json");
    const secondConfigPath = path.join(fixture.scenarioRoot, "second-restart-config.json");
    await writeConfig(secondConfigPath, { ...fixture.config, resultPath: secondResultPath });
    const secondRestart = await runChild("workspace-restart", secondConfigPath);
    const secondResult = JSON.parse(await readFile(secondResultPath, "utf8"));
    check(`${expected.label}: a second fresh startup is idempotent`,
      secondRestart.code === 0 && secondResult.ok === true
        && secondResult.recovery.status === "NO_PENDING_OPERATION",
      secondResult.recovery?.status ?? secondResult.code ?? "unknown");

    const freshPlan = await fixture.workspace.maintenance.plan({
      observedAt: OBSERVED_AT,
      retentionMs: RETENTION_MS,
      limits: LIMITS,
    });
    if (freshPlan.summary.eligible > 0) {
      await fixture.workspace.maintenance.apply({
        expectedPlan: freshPlan,
        operationId: `${fixture.config.operationId}-FRESH`,
        appliedAt: REAPPLY_AT,
      });
    }
    const finalPlan = await fixture.workspace.maintenance.plan({
      observedAt: OBSERVED_AT,
      retentionMs: RETENTION_MS,
      limits: LIMITS,
    });
    check(`${expected.label}: fresh plan and apply converge to an empty orphan set`,
      finalPlan.summary.eligible === 0
        && finalPlan.summary.inventoryEntries === 0
        && !(await exists(path.join(fixture.workspaceDirectory, "asset-vault", ".maintenance"))),
      `eligible=${finalPlan.summary.eligible} inventory=${finalPlan.summary.inventoryEntries}`);
  }

  async function negativeCase({ label, crashPoint, mutate, expectedCode }) {
    const fixture = await setupScenario(`negative-${label}`, crashPoint);
    const expectedExit = POSITIVE_SCENARIOS.find((scenario) => scenario.crashPoint === crashPoint)?.exitCode;
    const crashed = await runChild("crash-apply", fixture.configPath);
    check(`${label}: negative fixture reaches a real crash checkpoint`,
      crashed.code === expectedExit, `code=${crashed.code}`);
    const layout = await operationLayout(fixture.workspaceDirectory);
    await mutate({ fixture, layout });
    const restarted = await runChild("workspace-restart", fixture.configPath);
    const result = JSON.parse(await readFile(fixture.resultPath, "utf8"));
    check(`${label}: startup preserves ambiguous recovery state`,
      restarted.code === 2 && result.ok === false && result.code === expectedCode,
      `code=${result.code ?? "none"} exit=${restarted.code}`);
    check(`${label}: failed recovery leaves the operation evidence`,
      await exists(layout.maintenanceRoot), layout.operationRoot);
  }

  await negativeCase({
    label: "noncanonical-journal",
    crashPoint: "AFTER_FIRST_MOVE",
    expectedCode: "ASSET_VAULT_RECOVERY_JOURNAL_INVALID",
    mutate: async ({ layout }) => appendFile(layout.journalPath, " ", "utf8"),
  });
  await negativeCase({
    label: "tampered-quarantine-bytes",
    crashPoint: "AFTER_FIRST_MOVE",
    expectedCode: "ASSET_VAULT_RECOVERY_INTEGRITY_BLOCKED",
    mutate: async ({ layout }) => {
      const name = (await readdir(layout.quarantineRoot))[0];
      const target = path.join(layout.quarantineRoot, name);
      const bytes = Buffer.from(await readFile(target));
      bytes[bytes.length - 5] ^= 0x40;
      await writeFile(target, bytes);
    },
  });
  await negativeCase({
    label: "noncontiguous-purge-prefix",
    crashPoint: "BEFORE_FIRST_PURGE",
    expectedCode: "ASSET_VAULT_RECOVERY_STATE_INVALID",
    mutate: async ({ layout }) => {
      const journal = JSON.parse(await readFile(layout.journalPath, "utf8"));
      const second = path.basename(journal.candidates[1].relativePath);
      await rm(path.join(layout.quarantineRoot, second));
    },
  });
  await negativeCase({
    label: "unknown-operation-entry",
    crashPoint: "BEFORE_FIRST_MOVE",
    expectedCode: "ASSET_VAULT_RECOVERY_STATE_INVALID",
    mutate: async ({ layout }) => writeFile(path.join(layout.operationRoot, "unknown.bin"), "unexpected", "utf8"),
  });
  await negativeCase({
    label: "source-quarantine-double-presence",
    crashPoint: "AFTER_FIRST_MOVE",
    expectedCode: "ASSET_VAULT_RECOVERY_STATE_INVALID",
    mutate: async ({ fixture, layout }) => {
      const name = (await readdir(layout.quarantineRoot))[0];
      await copyFile(
        path.join(layout.quarantineRoot, name),
        path.join(fixture.workspaceDirectory, "asset-vault", "assets", "sha256", name),
      );
    },
  });

  const report = {
    schemaVersion: 1,
    profile: "companion-asset-vault-recovery-validation-v1",
    valid: true,
    fixtureOnly: true,
    generatedAt: "2026-08-04T14:00:03.000Z",
    hardwareImpact: "NONE",
    boundaries: [
      "single-process App-owned workspace",
      "controlled child-process termination after awaited filesystem operations",
      "parent-directory fsync, cross-process writers, root replacement and physical power loss remain separate gates",
    ],
    summary: { checks: checks.length, passed: checks.length, failed: 0, scenarios: POSITIVE_SCENARIOS.length, negatives: 5 },
    scenarioRecoveryIds,
    checks,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes);
  console.log(`Asset-vault recovery acceptance: ${checks.length}/${checks.length}`);
  console.log(`Asset-vault recovery report SHA-256: ${sha256(reportBytes)}`);
  console.log(`Report: ${path.join(RUN_ROOT, "report.json")}`);
}

await main();
