import { createHash } from "node:crypto";
import {
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
import {
  createFamilyWorkspace,
  restoreFamilyWorkspaceFromCompleteExport,
} from "./family-workspace.mjs";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_ROOT, "../../../..");
const RUN_ROOT = path.join(REPO_ROOT, "build", "companion-family-workspace-validation");
const WORKSPACE_ROOT = path.join(RUN_ROOT, "workspaces");
const TRANSFER_ROOT = path.join(RUN_ROOT, "transfers");
const SOURCE_ROOT = path.join(RUN_ROOT, "sources");
const BASE_REVISION_PATH = path.join(
  REPO_ROOT,
  "hardware/evt0/family-repository-v1/golden/family-revision.json",
);
const ALPHA_ASSET_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden/assets");
const REPOSITORY_ID = "FAMILY-REPO-WORKSPACE-ACCEPTANCE-001";
const OBSERVED_AT = "2026-08-04T12:00:00.000Z";
const OLD_MTIME = "2026-08-01T00:00:00.000Z";
const YOUNG_MTIME = "2026-08-04T11:30:00.000Z";
const LIMITS = Object.freeze({
  maxBackupBytes: 4 * 1024 * 1024,
  maxEntries: 128,
  maxAssetBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});
const EXPORT_LIMITS = Object.freeze({
  maxManifestBytes: 512 * 1024,
  maxBackupBytes: LIMITS.maxBackupBytes,
  maxAssetBytes: LIMITS.maxAssetBytes,
  maxTotalAssetBytes: LIMITS.maxTotalBytes,
  maxAssetEntries: LIMITS.maxEntries,
});

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

function createCaptureWitness(sourceBytes) {
  const state = { factories: 0, captures: 0, discards: 0, roots: [] };
  return {
    state,
    async factory({ captureRoot }) {
      state.factories += 1;
      state.roots.push(captureRoot);
      let activeReceipt = null;
      return Object.freeze({
        async capture() {
          state.captures += 1;
          const captureId = `capture-workspace-${state.factories}-${state.captures}`;
          const sourcePath = path.join(captureRoot, `${captureId}.wav`);
          await writeFile(sourcePath, sourceBytes, { flag: "wx" });
          const probe = await probeCanonicalWav(sourcePath);
          activeReceipt = Object.freeze({
            captureId,
            sourceClass: "fixture-capture-source",
            adapter: "family-workspace-acceptance",
            sourcePath,
            durationMs: probe.durationMs,
            codecProfile: probe.codecProfile,
            executableSha256: null,
          });
          return activeReceipt;
        },
        async discard(receipt) {
          if (receipt !== activeReceipt) throw new Error("capture receipt identity changed");
          state.discards += 1;
          await rm(receipt.sourcePath, { force: true });
          activeReceipt = null;
          return Object.freeze({ captureId: receipt.captureId, cleanupComplete: true });
        },
      });
    },
  };
}

function authoringCommand({ head, importedAsset, operationId, suffix, binding, clip, transcript }) {
  return {
    operationId,
    expectedHeadRevisionId: head.revisionId,
    createdAt: `2026-08-03T00:0${suffix}:00.000Z`,
    committedAt: `2026-08-03T00:0${suffix}:01.000Z`,
    contentRevision: `family-alpha-golden@0.1.${suffix}`,
    bindingId: binding.bindingId,
    clipId: clip.clipId,
    importedAsset,
    clipMetadata: {
      sourceKind: "family-recording",
      transcript,
      mediaType: "voice",
      language: "zh-CN",
    },
    sourceProducer: { name: "family-workspace-acceptance", version: "1.0.0" },
  };
}

async function runAcceptance() {
  await rm(RUN_ROOT, { recursive: true, force: true });
  await Promise.all([
    mkdir(WORKSPACE_ROOT, { recursive: true }),
    mkdir(TRANSFER_ROOT, { recursive: true }),
    mkdir(SOURCE_ROOT, { recursive: true }),
  ]);
  const checks = [];
  const check = (name, passed, detail) => {
    if (!passed) throw new Error(`${name}: ${detail}`);
    checks.push({ name, passed: true, detail });
  };

  const baseRevision = JSON.parse(await readFile(BASE_REVISION_PATH, "utf8"));
  const sample = Buffer.from(await readFile(path.join(ALPHA_ASSET_ROOT, "clip-013-1.wav")));
  const replacementBytes = changedWav(sample, 1, 0x01);
  const capturedBytes = changedWav(sample, 2, 0x02);
  const oldOrphanBytes = changedWav(sample, 3, 0x04);
  const queuedBytes = changedWav(sample, 4, 0x08);
  const [replacementSource, oldOrphanSource, queuedSource] = [
    path.join(SOURCE_ROOT, "replacement.wav"),
    path.join(SOURCE_ROOT, "old-orphan.wav"),
    path.join(SOURCE_ROOT, "queued.wav"),
  ];
  await Promise.all([
    writeFile(replacementSource, replacementBytes),
    writeFile(oldOrphanSource, oldOrphanBytes),
    writeFile(queuedSource, queuedBytes),
  ]);

  const probeWitness = createProbeWitness();
  const captureWitness = createCaptureWitness(capturedBytes);
  const primaryDirectory = path.join(WORKSPACE_ROOT, "primary");
  const workspace = await createFamilyWorkspace({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: primaryDirectory,
    repositoryId: REPOSITORY_ID,
    probeCanonicalWav: probeWitness.probe,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
    capturePortFactory: captureWitness.factory,
  });
  const forbiddenKeys = new Set([
    "repository", "coordinator", "vault", "capturePort", "repositoryRoot", "vaultRoot",
    "referencePort", "vaultPort", "withReferenceMutation", "commit",
  ]);
  const publicKeys = [workspace, workspace.read, workspace.authoring, workspace.maintenance, workspace.transfer]
    .flatMap((value) => Reflect.ownKeys(value).map(String));
  check("capability-only public surface", publicKeys.every((key) => !forbiddenKeys.has(key)),
    `keys=${[...new Set(publicKeys)].sort().join(",")}`);
  check("single production composition", captureWitness.state.factories === 1
    && workspace.descriptor.initialization.status === "initialized",
  "one capture port was created behind the capability surface");
  check("workspace owns capture staging", captureWitness.state.roots[0] === path.join(primaryDirectory, "capture-staging"),
    path.basename(captureWitness.state.roots[0]));

  const importBarrier = probeWitness.blockNextProbe();
  const queuedImportPromise = workspace.authoring.importFile({
    sourcePath: queuedSource,
    assetId: "asset-workspace-queued-r3",
  });
  await importBarrier.entered;
  let planSettled = false;
  const queuedPlanPromise = workspace.maintenance.plan({
    observedAt: "2099-01-01T00:00:00.000Z",
    retentionMs: 1,
    limits: LIMITS,
  }).finally(() => { planSettled = true; });
  await Promise.resolve();
  check("source import holds the maintenance queue", planSettled === false,
    "maintenance snapshot waited for the import probe");
  importBarrier.release();
  const [queuedAsset, queuedPlan] = await Promise.all([queuedImportPromise, queuedPlanPromise]);
  await utimes(queuedAsset.absolutePath, new Date(YOUNG_MTIME), new Date(YOUNG_MTIME));
  check("maintenance observes the completed queued import",
    queuedPlan.summary.inventoryEntries === 1 && queuedPlan.summary.eligible === 1,
  queuedAsset.sha256);

  const baseReceipts = new Map();
  for (const binding of baseRevision.bindings) {
    for (const clip of binding.clips) {
      const receipt = await workspace.authoring.importFile({
        sourcePath: path.join(ALPHA_ASSET_ROOT, `${clip.clipId}.wav`),
        assetId: clip.assetId,
      });
      check(`base asset ${clip.clipId} identity`, receipt.sha256 === clip.assetSha256
        && receipt.bytes === clip.assetBytes, clip.assetId);
      baseReceipts.set(clip.assetId, receipt);
    }
  }
  const replayedImport = await workspace.authoring.importFile({
    sourcePath: path.join(ALPHA_ASSET_ROOT, `${baseRevision.bindings[0].clips[0].clipId}.wav`),
    assetId: baseRevision.bindings[0].clips[0].assetId,
  });
  check("content import is idempotent", replayedImport.absolutePath === baseReceipts.get(replayedImport.assetId).absolutePath,
    replayedImport.contentPath);

  await workspace.authoring.commitInitialRevision({
    operationId: "OP-FAMILY-WORKSPACE-SEED-R1",
    revision: baseRevision,
    at: baseRevision.createdAt,
  });
  let head = await workspace.read.loadHead();
  check("initial revision committed through workspace", head.revisionId === baseRevision.revisionId,
    head.revisionId);
  const outboxBeforeForgery = await workspace.read.readOutbox();
  await expectCode(() => workspace.authoring.commitImportedClipReplacement({
    ...authoringCommand({
      head,
      importedAsset: {},
      operationId: "OP-FAMILY-WORKSPACE-FORGED",
      suffix: 1,
      binding: baseRevision.bindings[0],
      clip: baseRevision.bindings[0].clips[0],
      transcript: "伪造回执。",
    }),
    importedAsset: {
      assetId: "asset-forged-missing",
      contentPath: `assets/sha256/${"f".repeat(64)}.wav`,
      absolutePath: path.join(SOURCE_ROOT, "replacement.wav"),
      bytes: replacementBytes.length,
      sha256: "f".repeat(64),
      durationMs: 120,
      codec: "WAV_PCM16_16K_MONO",
    },
  }), "AUDIO_ASSET_MISSING");
  const outboxAfterForgery = await workspace.read.readOutbox();
  check("forged receipt rejected before repository mutation",
    outboxAfterForgery.events.length === outboxBeforeForgery.events.length
      && (await workspace.read.loadHead()).revisionId === head.revisionId,
  "head and outbox stayed unchanged");

  const captured = await workspace.authoring.captureAndImport({
    assetId: "asset-workspace-captured",
    captureRequest: { fixture: true },
  });
  check("capture converges on canonical import", captured.importedAsset.contentPath
    === `assets/sha256/${captured.importedAsset.sha256}.wav`
    && captured.captureReceipt.temporarySourceDiscarded === true
    && captureWitness.state.captures === 1 && captureWitness.state.discards === 1,
  captured.importedAsset.sha256);
  check("capture temporary source removed", !(await exists(path.join(
    primaryDirectory,
    "capture-staging",
    captured.captureReceipt.captureId + ".wav",
  ))), captured.captureReceipt.captureId);
  await utimes(captured.importedAsset.absolutePath, new Date(YOUNG_MTIME), new Date(YOUNG_MTIME));

  const replacement = await workspace.authoring.importFile({
    sourcePath: replacementSource,
    assetId: "asset-workspace-replacement-r2",
  });
  const firstBinding = baseRevision.bindings[0];
  const committed = await workspace.authoring.commitImportedClipReplacement(authoringCommand({
    head,
    importedAsset: replacement,
    operationId: "OP-FAMILY-WORKSPACE-R2",
    suffix: 1,
    binding: firstBinding,
    clip: firstBinding.clips[0],
    transcript: "工作区文件导入录音。",
  }));
  head = committed.revision;
  check("authoring mutation uses canonical workspace asset",
    head.bindings[0].clips[0].assetSha256 === replacement.sha256,
  replacement.contentPath);

  const oldOrphan = await workspace.authoring.importFile({
    sourcePath: oldOrphanSource,
    assetId: "asset-workspace-old-orphan",
  });
  await utimes(oldOrphan.absolutePath, new Date(OLD_MTIME), new Date(OLD_MTIME));
  const plan = await workspace.maintenance.plan({
    observedAt: OBSERVED_AT,
    retentionMs: 60 * 60 * 1_000,
    limits: LIMITS,
  });
  check("maintenance sees shared repository and vault",
    plan.summary.eligible === 1 && plan.summary.retained === 2 && plan.blockers.length === 0,
  `eligible=${plan.summary.eligible} retained=${plan.summary.retained}`);

  const applyPromise = workspace.maintenance.apply({
    expectedPlan: plan,
    operationId: "ASSET-GC-FAMILY-WORKSPACE-001",
    appliedAt: "2026-08-04T12:00:01.000Z",
  });
  const secondBinding = baseRevision.bindings[1];
  const queuedImport = workspace.authoring.importFile({
    sourcePath: oldOrphanSource,
    assetId: "asset-workspace-reimported-after-gc",
  });
  const queuedMutation = workspace.authoring.commitImportedClipReplacement(authoringCommand({
    head,
    importedAsset: queuedAsset,
    operationId: "OP-FAMILY-WORKSPACE-R3",
    suffix: 2,
    binding: secondBinding,
    clip: secondBinding.clips[0],
    transcript: "稳定引用租约后提交。",
  }));
  const [maintenanceResult, reimported, queuedCommit] = await Promise.all([
    applyPromise,
    queuedImport,
    queuedMutation,
  ]);
  await utimes(reimported.absolutePath, new Date(YOUNG_MTIME), new Date(YOUNG_MTIME));
  head = queuedCommit.revision;
  check("lease releases maintenance then source and reference mutations",
    maintenanceResult.deleted.length === 1
      && maintenanceResult.deleted[0].sha256 === oldOrphan.sha256
      && reimported.sha256 === oldOrphan.sha256
      && (await exists(reimported.absolutePath))
      && (await exists(queuedAsset.absolutePath)),
  "apply deleted first; queued import republished afterwards");

  const stalePlan = await workspace.maintenance.plan({
    observedAt: OBSERVED_AT,
    retentionMs: 60 * 60 * 1_000,
    limits: LIMITS,
  });
  const capturedBinding = baseRevision.bindings[2];
  const captureCommit = await workspace.authoring.commitImportedClipReplacement(authoringCommand({
    head,
    importedAsset: captured.importedAsset,
    operationId: "OP-FAMILY-WORKSPACE-R4",
    suffix: 3,
    binding: capturedBinding,
    clip: capturedBinding.clips[0],
    transcript: "捕获来源提交。",
  }));
  head = captureCommit.revision;
  await expectCode(() => workspace.maintenance.apply({
    expectedPlan: stalePlan,
    operationId: "ASSET-GC-FAMILY-WORKSPACE-STALE",
    appliedAt: "2026-08-04T12:00:02.000Z",
  }), "ASSET_VAULT_PLAN_STALE");
  check("reference mutation invalidates an older dry-run", await exists(captured.importedAsset.absolutePath),
    captured.importedAsset.sha256);

  const exportDirectory = path.join(TRANSFER_ROOT, "family-export");
  const manifest = await workspace.transfer.exportComplete({
    repoRoot: REPO_ROOT,
    allowedOutputRoot: TRANSFER_ROOT,
    outputDirectory: exportDirectory,
    createdAt: "2026-08-04T12:01:00.000Z",
    limits: EXPORT_LIMITS,
  });
  check("complete export runs through workspace transfer", manifest.headRevisionId === head.revisionId,
    manifest.exportId);

  const sourceOutbox = await workspace.read.readOutbox();
  const reopened = await createFamilyWorkspace({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: primaryDirectory,
    repositoryId: REPOSITORY_ID,
    probeCanonicalWav: probeWitness.probe,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
    capturePortFactory: captureWitness.factory,
  });
  check("same-process reopen reuses the composition root", reopened === workspace
    && captureWitness.state.factories === 1
    && (await reopened.read.loadHead()).revisionId === head.revisionId,
  "one workspace owns the in-process coordinator");
  await expectCode(() => createFamilyWorkspace({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: primaryDirectory,
    repositoryId: REPOSITORY_ID,
    probeCanonicalWav: probeWitness.probe,
    maxImportBytes: LIMITS.maxAssetBytes + 1,
    maintenanceLimits: LIMITS,
    capturePortFactory: captureWitness.factory,
  }), "FAMILY_WORKSPACE_ALREADY_OPEN");
  check("different same-process composition is rejected",
    captureWitness.state.factories === 1,
  "the existing coordinator remained authoritative");

  const unmarked = path.join(WORKSPACE_ROOT, "unmarked-existing");
  await mkdir(unmarked);
  await expectCode(() => createFamilyWorkspace({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: unmarked,
    repositoryId: "FAMILY-REPO-UNMARKED-ACCEPTANCE-001",
    probeCanonicalWav,
    maintenanceLimits: LIMITS,
  }), "FAMILY_WORKSPACE_MARKER_MISSING");
  check("existing unmarked directory is not adopted", !(await exists(path.join(unmarked, "family-workspace.json"))),
    "marker remained absent");

  const restored = await restoreFamilyWorkspaceFromCompleteExport({
    repoRoot: REPO_ROOT,
    exportDirectory,
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: path.join(WORKSPACE_ROOT, "restored"),
    operationId: "OP-FAMILY-WORKSPACE-PORTABLE-RESTORE",
    replicaInstanceId: "REPLICA-FAMILY-WORKSPACE-ACCEPTANCE-001",
    restoredAt: "2026-08-04T12:02:00.000Z",
    limits: EXPORT_LIMITS,
    probeCanonicalWav,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
  });
  const restoredOutbox = await restored.workspace.read.readOutbox();
  const restoredPlan = await restored.workspace.maintenance.plan({
    observedAt: "2026-08-04T12:03:00.000Z",
    retentionMs: 1,
    limits: LIMITS,
  });
  check("portable export adopts canonical workspace layout",
    restored.repositoryState.headRevisionId === head.revisionId
      && restored.assetDigestCount > 0
      && restoredPlan.blockers.length === 0
      && restoredPlan.summary.eligible === 0,
  `digests=${restored.assetDigestCount}`);
  check("portable restore creates a distinct replica epoch",
    restoredOutbox.epoch !== sourceOutbox.epoch && restoredOutbox.events.length === 1,
  "source and restored epochs differ");
  check("restored public surface stays capability-only",
    !("repository" in restored.workspace) && !("coordinator" in restored.workspace)
      && !("vault" in restored.workspace),
  restored.workspace.descriptor.profile);

  const stagingFailureDirectory = path.join(WORKSPACE_ROOT, "restore-staging-failure");
  const failingProbe = async () => {
    const error = new Error("fixture restore probe failure");
    error.code = "FAMILY_WORKSPACE_PROBE_FIXTURE";
    throw error;
  };
  await expectCode(() => restoreFamilyWorkspaceFromCompleteExport({
    repoRoot: REPO_ROOT,
    exportDirectory,
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: stagingFailureDirectory,
    operationId: "OP-FAMILY-WORKSPACE-STAGING-FAILURE",
    replicaInstanceId: "REPLICA-FAMILY-WORKSPACE-STAGING-FAILURE",
    restoredAt: "2026-08-04T12:04:00.000Z",
    limits: EXPORT_LIMITS,
    probeCanonicalWav: failingProbe,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
  }), "FAMILY_WORKSPACE_PROBE_FIXTURE");
  const stagingPrefix = `.${path.basename(stagingFailureDirectory)}.family-workspace-`;
  check("restore failure removes owned staging",
    !(await exists(stagingFailureDirectory))
      && !(await readdir(WORKSPACE_ROOT)).some((name) => name.startsWith(stagingPrefix)),
  "destination and staging are absent");

  const publishFailureDirectory = path.join(WORKSPACE_ROOT, "restore-publish-failure");
  const failingCaptureFactory = async () => {
    const error = new Error("fixture capture factory failure");
    error.code = "FAMILY_WORKSPACE_CAPTURE_FACTORY_FIXTURE";
    throw error;
  };
  await expectCode(() => restoreFamilyWorkspaceFromCompleteExport({
    repoRoot: REPO_ROOT,
    exportDirectory,
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: publishFailureDirectory,
    operationId: "OP-FAMILY-WORKSPACE-PUBLISH-FAILURE",
    replicaInstanceId: "REPLICA-FAMILY-WORKSPACE-PUBLISH-FAILURE",
    restoredAt: "2026-08-04T12:05:00.000Z",
    limits: EXPORT_LIMITS,
    probeCanonicalWav,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
    capturePortFactory: failingCaptureFactory,
  }), "FAMILY_WORKSPACE_CAPTURE_FACTORY_FIXTURE");
  check("post-publish configuration failure is output-atomic",
    !(await exists(publishFailureDirectory)), "owned published destination was cleaned");

  const retriedRestore = await restoreFamilyWorkspaceFromCompleteExport({
    repoRoot: REPO_ROOT,
    exportDirectory,
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: publishFailureDirectory,
    operationId: "OP-FAMILY-WORKSPACE-PUBLISH-RETRY",
    replicaInstanceId: "REPLICA-FAMILY-WORKSPACE-PUBLISH-RETRY",
    restoredAt: "2026-08-04T12:06:00.000Z",
    limits: EXPORT_LIMITS,
    probeCanonicalWav,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
  });
  check("cleaned publish failure is retryable",
    retriedRestore.repositoryState.headRevisionId === head.revisionId,
  retriedRestore.repositoryState.headRevisionId);

  const checksPassed = checks.length;
  const report = {
    schemaVersion: 1,
    profile: "family-workspace-acceptance-v1",
    checksPassed,
    checks,
    boundaries: {
      storage: "single-process-app-owned-directories",
      portableSource: "family-export-v1-assets-bin",
      workspaceVault: "canonical-wav-assets-sha256",
      hardwareImpact: "NONE",
    },
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  const reportSha256 = sha256(reportBytes);
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes);
  console.log(`family workspace acceptance: ${checksPassed}/${checksPassed}`);
  console.log(`report sha256: ${reportSha256}`);
}

await runAcceptance();
