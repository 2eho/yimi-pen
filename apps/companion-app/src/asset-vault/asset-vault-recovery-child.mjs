import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AtomicJsonFamilyRepository } from "../../../../tools/family-repository/atomic-json-adapter.mjs";
import { applyAssetVaultMaintenance } from "./asset-vault-maintenance-use-case.mjs";
import { createFamilyAssetReferenceCoordinator } from "./family-asset-reference-coordinator.mjs";
import { createLocalContentAddressedAudioVault } from "./local-content-addressed-audio-vault.mjs";
import { createFamilyWorkspace } from "../family-workspace/family-workspace.mjs";

const [mode, configPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(path.resolve(configPath), "utf8"));

function terminate(code) {
  process.exit(code);
}

async function runCrashApply() {
  const repository = new AtomicJsonFamilyRepository({
    repositoryId: config.repositoryId,
    repositoryRoot: path.join(config.workspaceDirectory, "repository"),
    allowedRoot: config.workspaceDirectory,
  });
  await repository.initialize();
  const coordinator = createFamilyAssetReferenceCoordinator({ repository });
  let moves = 0;
  let purges = 0;
  const vault = createLocalContentAddressedAudioVault({
    vaultRoot: path.join(config.workspaceDirectory, "asset-vault"),
    async renameFile(from, to) {
      const isAssetMove = path.basename(path.dirname(to)) === "quarantine" && to.endsWith(".wav");
      if (!isAssetMove) return rename(from, to);
      moves += 1;
      if (config.crashPoint === "BEFORE_FIRST_MOVE" && moves === 1) terminate(71);
      await rename(from, to);
      if (config.crashPoint === "AFTER_FIRST_MOVE" && moves === 1) terminate(72);
    },
    async removePath(target, options) {
      purges += 1;
      if (config.crashPoint === "BEFORE_FIRST_PURGE" && purges === 1) terminate(73);
      if (config.crashPoint === "AFTER_PREFIX_CHECKPOINT" && purges === 2) terminate(75);
      await rm(target, options);
      if (config.crashPoint === "AFTER_FIRST_PURGE_BEFORE_CHECKPOINT" && purges === 1) terminate(74);
      if (config.crashPoint === "AFTER_FINAL_PURGE_BEFORE_CHECKPOINT" && purges === 2) terminate(76);
    },
  });
  const expectedPlan = JSON.parse(await readFile(config.planPath, "utf8"));
  await applyAssetVaultMaintenance({
    referencePort: coordinator,
    vaultPort: vault,
    expectedPlan,
    operationId: config.operationId,
    appliedAt: config.appliedAt,
  });
  throw new Error(`crash point ${config.crashPoint} was not reached`);
}

async function runWorkspaceRestart() {
  try {
    const workspace = await createFamilyWorkspace({
      allowedRoot: config.allowedRoot,
      workspaceDirectory: config.workspaceDirectory,
      repositoryId: config.repositoryId,
      probeCanonicalWav: async () => ({ codecProfile: "WAV_PCM16_16K_MONO", durationMs: 1_000 }),
      maxImportBytes: config.limits.maxAssetBytes,
      maintenanceLimits: config.limits,
    });
    const freshPlan = await workspace.maintenance.plan({
      observedAt: config.observedAt,
      retentionMs: config.retentionMs,
      limits: config.limits,
    });
    await writeFile(config.resultPath, `${JSON.stringify({
      ok: true,
      recovery: workspace.descriptor.assetVaultRecovery,
      freshPlan: {
        planId: freshPlan.planId,
        inventoryId: freshPlan.inventoryId,
        summary: freshPlan.summary,
      },
    })}\n`, "utf8");
  } catch (error) {
    await writeFile(config.resultPath, `${JSON.stringify({
      ok: false,
      code: error?.code ?? error?.name ?? "UNKNOWN",
      details: error?.details ?? {},
    })}\n`, "utf8");
    process.exitCode = 2;
  }
}

if (mode === "crash-apply") await runCrashApply();
else if (mode === "workspace-restart") await runWorkspaceRestart();
else throw new Error(`unknown recovery child mode: ${mode}`);
