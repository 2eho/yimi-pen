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
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import { createAuthoringProductReviewReceipt } from "./authoring-product-session-core.mjs";
import { openAuthoringProductSession } from "./authoring-product-session.mjs";
import { createFamilyWorkspaceAuthoringAdapter } from "./family-workspace-authoring-adapter.mjs";
import { createFamilyWorkspaceSystemTtsSourcePort } from "./family-workspace-tts-source-adapter.mjs";
import {
  assertSystemTtsSourceReceipt,
  assertSystemTtsProviderCleanupReceipt,
  createSystemTtsProviderDescriptor,
  createSystemTtsRequest,
  createSystemTtsResourcePolicy,
  SYSTEM_TTS_V1_APPROVED_FIXTURE_DESCRIPTOR,
} from "./tts-source-contract.mjs";
import {
  createSystemTtsAuthoringTaskFacade,
  openSystemTtsAuthoringTask,
} from "./tts-authoring-task-facade.mjs";
import { createFamilyWorkspace } from "../family-workspace/family-workspace.mjs";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_ROOT, "../../../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-tts-source-adapter-validation");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-tts-source-adapter-validation.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".tts-source-adapter-validation-root");
const MARKER_TEXT = "yimi-tts-source-adapter-validation-root-v1\n";
const WORKSPACE_ROOT = path.join(RUN_ROOT, "workspaces");
const WORKSPACE_DIRECTORY = path.join(WORKSPACE_ROOT, "primary");
const STAGING_ROOT = path.join(RUN_ROOT, "tts-staging");
const BASE_REVISION_PATH = path.join(
  REPO_ROOT,
  "hardware/evt0/family-repository-v1/golden/family-revision.json",
);
const ASSET_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden/assets");
const FIXTURE_AUDIO_PATH = path.join(ASSET_ROOT, "clip-018-1.wav");
const LIMITS = Object.freeze({
  maxBackupBytes: 4 * 1024 * 1024,
  maxEntries: 128,
  maxAssetBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
});
const RESOURCE_POLICY = createSystemTtsResourcePolicy({
  maxTranscriptChars: 1_000,
  maxOutputBytes: LIMITS.maxAssetBytes,
  timeoutMs: 30_000,
  maxConcurrentJobs: 1,
});
const NARROW_TEXT_POLICY = createSystemTtsResourcePolicy({
  maxTranscriptChars: 4,
  maxOutputBytes: LIMITS.maxAssetBytes,
  timeoutMs: 30_000,
  maxConcurrentJobs: 1,
});
const SHORT_TIMEOUT_POLICY = createSystemTtsResourcePolicy({
  maxTranscriptChars: 1_000,
  maxOutputBytes: LIMITS.maxAssetBytes,
  timeoutMs: 100,
  maxConcurrentJobs: 1,
});
const FIXTURE_DESCRIPTOR = SYSTEM_TTS_V1_APPROVED_FIXTURE_DESCRIPTOR;
const FIXTURE_DESCRIPTOR_INPUT = Object.freeze({
  providerId: FIXTURE_DESCRIPTOR.providerId,
  providerVersion: FIXTURE_DESCRIPTOR.providerVersion,
  providerClass: FIXTURE_DESCRIPTOR.providerClass,
  qualification: FIXTURE_DESCRIPTOR.qualification,
  requiredCapability: FIXTURE_DESCRIPTOR.requiredCapability,
  networkClassification: FIXTURE_DESCRIPTOR.networkClassification,
  privacyMode: FIXTURE_DESCRIPTOR.privacyMode,
  privacyPolicyId: FIXTURE_DESCRIPTOR.privacyPolicyId,
  rightsPolicyId: FIXTURE_DESCRIPTOR.rightsPolicyId,
  voiceIdentityId: FIXTURE_DESCRIPTOR.voiceIdentityId,
  qualificationEvidenceSha256: FIXTURE_DESCRIPTOR.qualificationEvidenceSha256,
  lifecycleControl: FIXTURE_DESCRIPTOR.lifecycleControl,
  canonicalizerId: FIXTURE_DESCRIPTOR.canonicalizerId,
  canonicalizerVersion: FIXTURE_DESCRIPTOR.canonicalizerVersion,
  outputCodec: FIXTURE_DESCRIPTOR.outputCodec,
});
const LOCAL_DESCRIPTOR = createSystemTtsProviderDescriptor({
  ...FIXTURE_DESCRIPTOR_INPUT,
  providerId: "windows-system-speech-candidate",
  providerVersion: "host-candidate-1",
  providerClass: "LOCAL_SYSTEM",
  qualification: "QUALIFIED",
  networkClassification: "LOCAL_ENGINE_CANDIDATE",
  privacyPolicyId: "windows-local-processing-candidate-v1",
  rightsPolicyId: "windows-voice-rights-candidate-v1",
  voiceIdentityId: `windows-voice:sha256:${canonicalSha256({ voice: "candidate" }).sha256}`,
  qualificationEvidenceSha256: canonicalSha256({ evidence: "candidate-only" }).sha256,
});
const PROTECTED_PATHS = Object.freeze([
  "apps/companion-app/src/authoring/authoring-contract.mjs",
  "apps/companion-app/src/authoring/authoring-product-session-core.mjs",
  "apps/companion-app/src/authoring/authoring-product-session.mjs",
  "apps/companion-app/src/authoring/family-workspace-authoring-adapter.mjs",
  "apps/companion-app/src/family-workspace/family-workspace.mjs",
  "apps/companion-app/src/prelisten/local-audio-assets.mjs",
  "apps/companion-app/src/prelisten/ffmpeg-host-audio.mjs",
  "contracts/family-revision-v1.mjs",
  "docs/codex/active-task.md",
  "hardware/evt0/hardware-system-v1/topology.json",
  "hardware/evt0/hardware-system-v1/target-binding.json",
]);
const SUBJECT_PATHS = Object.freeze([
  "apps/companion-app/src/authoring/tts-source-contract.mjs",
  "apps/companion-app/src/authoring/family-workspace-tts-source-adapter.mjs",
  "apps/companion-app/src/authoring/tts-authoring-task-facade.mjs",
  "apps/companion-app/src/authoring/run-tts-source-adapter-acceptance.mjs",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
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

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return Object.freeze({ promise, resolve });
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  try {
    return await open(LOCK_PATH, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("TTS source adapter acceptance has an active or stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("TTS validation root is unsafe");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("TTS validation root escaped build");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) throw new Error("TTS validation root lacks its marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { flag: "wx" });
  await mkdir(WORKSPACE_ROOT);
  await mkdir(STAGING_ROOT);
}

async function pathHashes(paths) {
  const result = {};
  for (const relative of paths) {
    result[relative] = sha256(await readFile(path.join(REPO_ROOT, ...relative.split("/"))));
  }
  return Object.freeze(result);
}

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function probeCanonicalWav(filePath) {
  const bytes = Buffer.from(await readFile(filePath));
  const mismatch = () => { throw codedError("AUDIO_CODEC_PROFILE_MISMATCH", "fixture audio is outside canonical WAV"); };
  if (bytes.length < 46
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WAVE"
    || bytes.readUInt32LE(4) + 8 !== bytes.length) mismatch();
  let offset = 12;
  let format = null;
  let dataLength = null;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > bytes.length) mismatch();
    if (chunkId === "fmt " && format === null && chunkLength === 16) {
      format = {
        audioFormat: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      };
    } else if (chunkId === "data" && dataLength === null) {
      dataLength = chunkLength;
    } else {
      mismatch();
    }
    offset = end + (chunkLength % 2);
  }
  if (offset !== bytes.length || !format || dataLength === null
    || format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16_000
    || format.byteRate !== 32_000 || format.blockAlign !== 2 || format.bitsPerSample !== 16
    || dataLength <= 0 || dataLength % 2 !== 0 || (dataLength * 1_000) % format.byteRate !== 0) mismatch();
  return Object.freeze({
    codecProfile: "WAV_PCM16_16K_MONO",
    durationMs: (dataLength * 1_000) / format.byteRate,
  });
}

function createAuditWitness({
  block = false,
  fail = false,
  failFirst = false,
  failAfterPersistFirst = false,
  hangFirst = false,
  lateFirstMs = 0,
  ack = "valid",
} = {}) {
  const entered = deferred();
  const release = deferred();
  const state = { calls: 0, cancelCalls: 0, cancelReasons: [], receipts: [] };
  return Object.freeze({
    state,
    entered,
    release,
    port: Object.freeze({
      startAppend(receipt) {
        state.calls += 1;
        const ordinal = state.calls;
        const auditRunId = `AUDIT_RUN_${ordinal}`;
        let cancelRequested = false;
        const completion = (async () => {
          if (hangFirst && ordinal === 1) {
            entered.resolve();
            await release.promise;
          } else if (lateFirstMs > 0 && ordinal === 1) {
            entered.resolve();
            await new Promise((resolve) => setTimeout(resolve, lateFirstMs));
          } else if (block) {
            entered.resolve();
            await release.promise;
          }
          if (cancelRequested && !(lateFirstMs > 0 && ordinal === 1)) {
            throw codedError("TTS_AUDIT_ABORTED", "fixture audit append was cancelled");
          }
          if (fail || (failFirst && ordinal === 1)) {
            throw codedError("SECRET_AUDIT_BACKEND_TOKEN", "SECRET_AUDIT_PATH");
          }
          assertSystemTtsSourceReceipt(receipt);
          state.receipts.push(structuredClone(receipt));
          if (failAfterPersistFirst && ordinal === 1) {
            throw codedError("SECRET_AUDIT_ACK_CHANNEL", "persisted before acknowledgement failed");
          }
          if (ack === "undefined") return undefined;
          if (ack === "wrong-id") {
            return Object.freeze({
              receiptId: `authoring-tts:sha256:${"0".repeat(64)}`,
              persisted: true,
            });
          }
          if (ack === "false") return Object.freeze({ receiptId: receipt.receiptId, persisted: false });
          return Object.freeze({ receiptId: receipt.receiptId, persisted: true });
        })();
        return Object.freeze({
          auditRunId,
          completion,
          async cancelAndWait({ reason }) {
            state.cancelCalls += 1;
            state.cancelReasons.push(reason);
            cancelRequested = reason !== "REQUEST_ABORTED";
            if (!(lateFirstMs > 0 && ordinal === 1)) release.resolve();
            if (lateFirstMs > 0 && ordinal === 1) {
              return Object.freeze({
                auditRunId,
                receiptId: receipt.receiptId,
                settled: true,
                persisted: false,
              });
            }
            try { await completion; } catch { /* cancellation is a terminal fixture outcome */ }
            return Object.freeze({
              auditRunId,
              receiptId: receipt.receiptId,
              settled: true,
              persisted: state.receipts.some((item) => item.receiptId === receipt.receiptId),
            });
          },
        });
      },
    }),
  });
}

function createProviderWitness({
  bytes,
  descriptor = FIXTURE_DESCRIPTOR,
  behavior = "normal",
  block = false,
  descriptorMutation = null,
  rootSwap = null,
} = {}) {
  const entered = deferred();
  const release = deferred();
  const state = {
    calls: 0,
    discards: 0,
    aborted: 0,
    cancelCalls: 0,
    sentinels: [],
    receiptReads: 0,
    startKeys: [],
  };
  const port = {
    descriptor,
    start(input) {
      const { request, signal } = input;
      state.calls += 1;
      state.startKeys.push(Object.keys(input).sort());
      const ordinal = state.calls;
      const providerRunId = `SECRET_PROVIDER_JOB_${ordinal}`;
      let cancelRequested = false;
      if (descriptorMutation !== null) port.descriptor = descriptorMutation;
      const completion = (async () => {
        if (behavior === "secret-error") {
          throw codedError("SECRET_VENDOR_TOKEN_ABC123", "SECRET_ENDPOINT fixture-provider");
        }
        if (behavior === "late-completion") {
          entered.resolve();
          await new Promise((resolve) => setTimeout(resolve, 260));
        } else if (block) {
          entered.resolve();
          await release.promise;
        }
        if (behavior !== "late-completion" && (signal.aborted || cancelRequested)) {
          state.aborted += 1;
          throw codedError("TTS_PROVIDER_ABORTED", "fixture provider observed cancellation");
        }
        if (rootSwap !== null) {
          await rename(rootSwap.stagingRoot, rootSwap.backupRoot);
          await mkdir(rootSwap.externalRoot, { recursive: true });
          await symlink(rootSwap.externalRoot, rootSwap.stagingRoot, "junction");
          const sentinelPath = path.join(rootSwap.externalRoot, rootSwap.plannedName);
          await writeFile(sentinelPath, Buffer.from("EXTERNAL_SENTINEL", "utf8"), { flag: "wx" });
          state.sentinels.push(sentinelPath);
        }
        const audioBytes = Buffer.from(bytes);
        const receipt = {
          providerRunId,
          requestSha256: canonicalSha256(request).sha256,
          audioSha256: sha256(audioBytes),
          audioBytes,
          codecProfile: "WAV_PCM16_16K_MONO",
        };
        if (behavior === "path-mismatch") {
          const sentinelPath = path.join(RUN_ROOT, "provider-private-sentinel.wav");
          await writeFile(sentinelPath, Buffer.from("SIBLING_SENTINEL", "utf8"), { flag: "wx" });
          state.sentinels.push(sentinelPath);
          return Object.freeze({ ...receipt, cleanupPath: sentinelPath });
        }
        if (behavior === "accessor-receipt") {
          const accessorReceipt = {};
          for (const [key, value] of Object.entries(receipt)) {
            Object.defineProperty(accessorReceipt, key, {
              enumerable: true,
              get() {
                state.receiptReads += 1;
                return key === "audioBytes" ? Buffer.from(value) : value;
              },
            });
          }
          return accessorReceipt;
        }
        return Object.freeze(receipt);
      })();
      return Object.freeze({
        providerRunId,
        completion,
        async cancelAndWait() {
          state.cancelCalls += 1;
          cancelRequested = true;
          if (behavior === "late-completion") {
            return Object.freeze({ providerRunId, settled: true, cleanupComplete: true });
          }
          release.resolve();
          try { await completion; } catch { /* abort is the expected terminal result */ }
          if (behavior === "invalid-cancel-ack") {
            return Object.freeze({ providerRunId, settled: false, cleanupComplete: true });
          }
          return Object.freeze({ providerRunId, settled: true, cleanupComplete: true });
        },
      });
    },
    async discard(receipt) {
      state.discards += 1;
      assertSystemTtsProviderCleanupReceipt(receipt);
      if (behavior === "discard-hang") await new Promise(() => {});
      if (behavior === "discard-fail") {
        throw codedError("SECRET_PROVIDER_CLEANUP_TOKEN", "fixture provider cleanup failed");
      }
      return Object.freeze({ cleanupComplete: true });
    },
  };
  return Object.freeze({ state, port, entered, release });
}

function createCommitCommandPort() {
  const state = { count: 0, commands: [] };
  return Object.freeze({
    state,
    port: Object.freeze({
      create({ target, importedAsset, clipMetadata }) {
        state.count += 1;
        const ordinal = state.count;
        const createdAt = new Date(Date.parse("2026-08-04T16:00:00.000Z") + ordinal * 2_000).toISOString();
        const command = Object.freeze({
          operationId: `OP-AUTHORING-TTS-${String(ordinal).padStart(3, "0")}`,
          expectedHeadRevisionId: target.baseRevisionId,
          createdAt,
          committedAt: new Date(Date.parse(createdAt) + 1_000).toISOString(),
          contentRevision: `family-alpha-tts@1.0.${ordinal}`,
          bindingId: target.bindingId,
          clipId: target.clipId,
          importedAsset: structuredClone(importedAsset),
          clipMetadata: structuredClone(clipMetadata),
          sourceProducer: { name: "SECRET_DYNAMIC_TTS_PRODUCER", version: "SECRET_TOKEN" },
        });
        state.commands.push(structuredClone(command));
        return command;
      },
    }),
  });
}

function createReviewPort() {
  let ordinal = 0;
  return Object.freeze({
    async run(input) {
      ordinal += 1;
      const subject = canonicalSha256({
        familyRevisionId: input.revision.revisionId,
        reviewAttemptId: input.reviewAttemptId,
        ordinal,
      }).sha256;
      return createAuthoringProductReviewReceipt({
        reviewAttemptId: input.reviewAttemptId,
        sessionId: input.sessionId,
        familyRevisionId: input.revision.revisionId,
        bindingId: input.bindingId,
        clipId: input.clipId,
        assetId: input.importedAsset.assetId,
        assetSha256: input.importedAsset.sha256,
        buildPlanId: `PLAN-AUTHORING-TTS-${String(ordinal).padStart(3, "0")}`,
        buildSubjectSha256: subject,
        previewId: `sha256:${canonicalSha256({ subject, kind: "preview" }).sha256}`,
        presentationTranscriptSha256: canonicalSha256({ subject, kind: "natural-end" }).sha256,
        confirmationId: `CONF-AUTHORING-TTS-${String(ordinal).padStart(3, "0")}`,
        authorizationId: `authorization:sha256:${canonicalSha256({ subject, kind: "authorization" }).sha256}`,
        fixtureOnly: true,
        completedAt: new Date(Date.parse("2026-08-04T16:30:00.000Z") + ordinal * 1_000).toISOString(),
      });
    },
  });
}

async function initializeWorkspace() {
  const baseRevision = JSON.parse(await readFile(BASE_REVISION_PATH, "utf8"));
  const workspace = await createFamilyWorkspace({
    allowedRoot: WORKSPACE_ROOT,
    workspaceDirectory: WORKSPACE_DIRECTORY,
    repositoryId: "FAMILY-REPO-TTS-SOURCE-ADAPTER-001",
    probeCanonicalWav,
    maxImportBytes: LIMITS.maxAssetBytes,
    maintenanceLimits: LIMITS,
  });
  for (const binding of baseRevision.bindings) {
    for (const clip of binding.clips) {
      const imported = await workspace.authoring.importFile({
        sourcePath: path.join(ASSET_ROOT, `${clip.clipId}.wav`),
        assetId: clip.assetId,
      });
      if (imported.sha256 !== clip.assetSha256 || imported.bytes !== clip.assetBytes) {
        throw new Error(`base asset identity mismatch for ${clip.clipId}`);
      }
    }
  }
  await workspace.authoring.commitInitialRevision({
    operationId: "OP-TTS-BASE-001",
    revision: baseRevision,
    at: "2026-08-04T15:45:00.000Z",
  });
  return Object.freeze({ workspace, baseRevision });
}

function sourcePort({
  workspace,
  provider,
  audit,
  suffix,
  policy = RESOURCE_POLICY,
  allowFixtureProvider = true,
  writeOutputFile = writeFile,
}) {
  let ordinal = 0;
  return createFamilyWorkspaceSystemTtsSourcePort({
    workspace,
    providerPort: provider.port,
    stagingRoot: path.join(STAGING_ROOT, suffix),
    resourcePolicy: policy,
    maxImportBytes: LIMITS.maxAssetBytes,
    auditPort: audit.port,
    allowFixtureProvider,
    writeOutputFile,
    clock: Object.freeze({ now: () => "2026-08-04T16:20:00.000Z" }),
    idFactory: () => {
      ordinal += 1;
      return `tts-${suffix}-${String(ordinal).padStart(3, "0")}`;
    },
  });
}

function plannedStagingOutput(suffix, ordinal = 1) {
  return path.join(
    STAGING_ROOT,
    suffix,
    `tts-${suffix}-${String(ordinal).padStart(3, "0")}.wav`,
  );
}

async function openTask({ workspace, ttsPort, sessionId, binding, commands, reviewPort }) {
  const family = createFamilyWorkspaceAuthoringAdapter(workspace);
  return openSystemTtsAuthoringTask({
    sessionId,
    bindingId: binding.bindingId,
    clipId: binding.clips[0].clipId,
    authoringPort: family.authoringPort,
    sourcePorts: Object.freeze([...family.sourcePorts, ttsPort]),
    commitCommandPort: commands.port,
    reviewPort,
  });
}

async function run() {
  const stableBefore = await pathHashes(PROTECTED_PATHS);
  const subjectBefore = await pathHashes(SUBJECT_PATHS);
  await prepareRunRoot();
  const checks = [];
  const check = (name, passed, detail) => {
    if (!passed) throw new Error(`${name}: ${detail}`);
    checks.push(Object.freeze({ name, passed: true, detail }));
  };
  const fixtureBytes = Buffer.from(await readFile(FIXTURE_AUDIO_PATH));
  const sameLengthReplacementBytes = Buffer.from(
    await readFile(path.join(ASSET_ROOT, "clip-018-2.wav")),
  );
  const { workspace, baseRevision } = await initializeWorkspace();
  const commands = createCommitCommandPort();
  const reviewPort = createReviewPort();
  const binding = baseRevision.bindings.find((candidate) => candidate.bindingId === "binding-014")
    ?? baseRevision.bindings[0];

  check("provider descriptor is content-addressed and fixture-scoped",
    FIXTURE_DESCRIPTOR.providerDescriptorId === `tts-provider:sha256:${canonicalSha256((({ providerDescriptorId: _id, ...rest }) => rest)(FIXTURE_DESCRIPTOR)).sha256}`
      && FIXTURE_DESCRIPTOR.qualification === "FIXTURE"
      && FIXTURE_DESCRIPTOR.requiredCapability === null
      && FIXTURE_DESCRIPTOR.qualificationEvidenceSha256 === canonicalSha256({
        profile: "system-tts-fixture-qualification-v1",
        sourceAsset: "hardware/evt0/family-alpha-v1/golden/assets/clip-018-1.wav",
        sourceAssetSha256: sha256(fixtureBytes),
      }).sha256,
  FIXTURE_DESCRIPTOR.providerDescriptorId);

  const happyProvider = createProviderWitness({ bytes: fixtureBytes });
  const happyAudit = createAuditWitness();
  const happyPort = sourcePort({
    workspace,
    provider: happyProvider,
    audit: happyAudit,
    suffix: "happy",
  });
  check("third source descriptor uses the existing product-session registry",
    JSON.stringify(Object.keys(happyPort).sort()) === JSON.stringify([
      "acquire", "clipSourceKind", "requiredCapability", "sourceKind",
    ])
      && happyPort.sourceKind === "SYSTEM_TTS"
      && happyPort.clipSourceKind === "system-tts"
      && happyPort.requiredCapability === null,
  `${happyPort.sourceKind}->${happyPort.clipSourceKind}`);

  const happyTask = await openTask({
    workspace,
    ttsPort: happyPort,
    sessionId: "authoring-system-tts-happy-001",
    binding,
    commands,
    reviewPort,
  });
  check("TTS facade withholds generic metadata mutation",
    Object.keys(happyTask).sort().join(",")
      === "cancel,commit,profile,retry,review,selectSynthesis,snapshot,synthesizeAndPrepare",
  happyTask.profile);
  happyTask.selectSynthesis({
    assetId: "asset-system-tts-happy-001",
    transcript: "这是香蕉，黄黄的，香香的。",
    language: "zh-CN",
  });
  check("adapter-private request stays outside public session state",
    !JSON.stringify(happyTask.snapshot()).includes("这是香蕉")
      && happyTask.snapshot().selection.sourceKind === "SYSTEM_TTS",
  happyTask.snapshot().stateId);
  await happyTask.synthesizeAndPrepare();
  check("synthesis automatically binds immutable revision metadata",
    happyTask.snapshot().phase === "READY_TO_COMMIT"
      && happyTask.snapshot().clipMetadata.sourceKind === "system-tts"
      && happyTask.snapshot().clipMetadata.transcript === "这是香蕉，黄黄的，香香的。"
      && happyTask.snapshot().clipMetadata.language === "zh-CN"
      && happyTask.snapshot().clipMetadata.mediaType === "voice",
  happyTask.snapshot().stateId);
  check("qualified source converges on canonical FamilyWorkspace import",
    happyTask.snapshot().importedAsset.codec === "WAV_PCM16_16K_MONO"
      && happyTask.snapshot().importedAsset.contentPath
        === `assets/sha256/${happyTask.snapshot().importedAsset.sha256}.wav`
      && happyProvider.state.discards === 1,
  happyTask.snapshot().importedAsset.sha256);
  check("provider receives policy and request but no App staging path capability",
    JSON.stringify(happyProvider.state.startKeys[0])
      === JSON.stringify(["maxOutputBytes", "request", "signal", "timeoutMs"]),
  happyProvider.state.startKeys[0].join(","));
  check("sanitized audit receipt joins request provider and asset identities",
    happyAudit.state.receipts.length === 1
      && happyAudit.state.receipts[0].assetId === happyTask.snapshot().importedAsset.assetId
      && happyAudit.state.receipts[0].importedAsset.sha256 === happyTask.snapshot().importedAsset.sha256
      && happyAudit.state.receipts[0].providerDescriptor.providerDescriptorId
        === FIXTURE_DESCRIPTOR.providerDescriptorId
      && happyAudit.state.receipts[0].transcriptSha256
        === sha256(Buffer.from("这是香蕉，黄黄的，香香的。", "utf8")),
  happyAudit.state.receipts[0].receiptId);
  const tamperedAuditReceipt = structuredClone(happyAudit.state.receipts[0]);
  tamperedAuditReceipt.providerDescriptor.providerId = "tampered-provider-identity";
  tamperedAuditReceipt.receiptId = `authoring-tts:sha256:${canonicalSha256((({ receiptId: _id, ...rest }) => rest)(tamperedAuditReceipt)).sha256}`;
  await expectCode(
    () => Promise.resolve(assertSystemTtsSourceReceipt(tamperedAuditReceipt)),
    "TTS_SOURCE_RECEIPT_INVALID",
  );
  check("source receipt revalidates the complete nested provider descriptor",
    true, "outer receipt rehash does not hide provider descriptor drift");
  await happyTask.commit();
  const committed = await workspace.read.loadRevision(happyTask.snapshot().committedRevision.revisionId);
  const committedClip = committed.bindings
    .find((candidate) => candidate.bindingId === binding.bindingId)
    .clips.find((candidate) => candidate.clipId === binding.clips[0].clipId);
  check("durable FamilyRevision exactly joins synthesized asset and frozen transcript",
    committedClip.sourceKind === "system-tts"
      && committedClip.transcript === "这是香蕉，黄黄的，香香的。"
      && committedClip.assetId === happyAudit.state.receipts[0].assetId
      && committedClip.assetSha256 === happyAudit.state.receipts[0].importedAsset.sha256,
  committed.revisionId);
  await happyTask.review();
  check("fixture review never escalates device or production authority",
    happyTask.snapshot().phase === "COMPLETED"
      && happyTask.snapshot().facts.reviewReceiptPresent
      && !happyTask.snapshot().facts.buildAuthorized
      && !happyTask.snapshot().facts.offlineReady,
  happyTask.snapshot().reviewReceipt.reviewReceiptId);

  const publishedSurface = JSON.stringify({
    state: happyTask.snapshot(),
    revision: committed,
    audits: happyAudit.state.receipts,
  });
  check("provider jobs paths diagnostics and dynamic producer stay private",
    !publishedSurface.includes(RUN_ROOT)
      && !publishedSurface.includes("SECRET_PROVIDER_JOB")
      && !publishedSurface.includes("SECRET_DYNAMIC_TTS_PRODUCER")
      && !publishedSurface.includes("SECRET_ENDPOINT"),
  "public state contains only stable family and audit identities");

  const invalidProvider = createProviderWitness({ bytes: fixtureBytes });
  const invalidAudit = createAuditWitness();
  const invalidPort = sourcePort({
    workspace,
    provider: invalidProvider,
    audit: invalidAudit,
    suffix: "invalid-request",
    policy: NARROW_TEXT_POLICY,
  });
  await expectCode(() => invalidPort.acquire({
    sessionId: "tts-invalid-request-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-invalid-001",
    request: { ...createSystemTtsRequest({ transcript: "你好。", language: "zh-CN" }), token: "SECRET_TOKEN" },
  }), "TTS_REQUEST_INVALID");
  await expectCode(() => invalidPort.acquire({
    sessionId: "tts-limit-request-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-limit-001",
    request: createSystemTtsRequest({ transcript: "甲".repeat(1_000), language: "zh-CN" }),
  }), "TTS_RESOURCE_LIMIT_EXCEEDED");
  check("invalid and resource-rejected requests have zero provider side effects",
    invalidProvider.state.calls === 0 && invalidAudit.state.calls === 0,
  "provider=0 audit=0");

  await expectCode(() => Promise.resolve(createSystemTtsProviderDescriptor({
    ...FIXTURE_DESCRIPTOR_INPUT,
    providerId: "fixture-unqualified",
    qualification: "UNQUALIFIED",
    rightsPolicyId: "fixture-unqualified-policy-v1",
  })), "TTS_PROVIDER_DESCRIPTOR_INVALID");
  await expectCode(() => Promise.resolve(createSystemTtsProviderDescriptor({
    ...FIXTURE_DESCRIPTOR_INPUT,
    providerId: "fixture-privacy-drift",
    privacyMode: "REMOTE_TEXT_PROCESSING",
    rightsPolicyId: "fixture-privacy-drift-policy-v1",
  })), "TTS_PROVIDER_DESCRIPTOR_INVALID");
  await expectCode(() => Promise.resolve(sourcePort({
    workspace,
    provider: createProviderWitness({ bytes: fixtureBytes }),
    audit: createAuditWitness(),
    suffix: "fixture-authority",
    allowFixtureProvider: false,
  })), "TTS_PROVIDER_UNAVAILABLE");
  const arbitraryFixtureProvider = createProviderWitness({
    bytes: fixtureBytes,
    descriptor: createSystemTtsProviderDescriptor({
      ...FIXTURE_DESCRIPTOR_INPUT,
      providerId: "SECRET_PROVIDER_TOKEN_ABC123",
    }),
  });
  const arbitraryFixtureAudit = createAuditWitness();
  await expectCode(() => Promise.resolve(sourcePort({
    workspace,
    provider: arbitraryFixtureProvider,
    audit: arbitraryFixtureAudit,
    suffix: "arbitrary-fixture-identity",
  })), "TTS_PROVIDER_UNAVAILABLE");
  await expectCode(() => Promise.resolve(createSystemTtsProviderDescriptor({
    ...FIXTURE_DESCRIPTOR_INPUT,
    providerId: "remote-service-rejected-v1",
    providerClass: "REMOTE_SERVICE",
    qualification: "QUALIFIED",
    networkClassification: "CLOUD_REQUIRED",
    privacyMode: "REMOTE_TEXT_PROCESSING",
  })), "TTS_PROVIDER_DESCRIPTOR_INVALID");
  await expectCode(() => Promise.resolve(sourcePort({
    workspace,
    provider: createProviderWitness({ bytes: fixtureBytes, descriptor: LOCAL_DESCRIPTOR }),
    audit: createAuditWitness(),
    suffix: "self-declared-local",
  })), "TTS_PROVIDER_UNAVAILABLE");
  await expectCode(() => Promise.resolve(sourcePort({
    workspace,
    provider: {
      port: Object.freeze({
        descriptor: FIXTURE_DESCRIPTOR,
        async synthesize() { return null; },
        async discard() { return Object.freeze({ cleanupComplete: true }); },
      }),
    },
    audit: createAuditWitness(),
    suffix: "legacy-synthesize-only",
  })), "TTS_PROVIDER_PORT_INVALID");
  await expectCode(() => Promise.resolve(sourcePort({
    workspace,
    provider: createProviderWitness({ bytes: fixtureBytes }),
    audit: {
      port: Object.freeze({
        async append() { return Object.freeze({ persisted: true }); },
      }),
    },
    suffix: "legacy-audit-append-only",
  })), "TTS_AUDIT_PORT_INVALID");
  await expectCode(() => Promise.resolve(sourcePort({
    workspace,
    provider: createProviderWitness({ bytes: fixtureBytes }),
    audit: createAuditWitness(),
    suffix: "parallel-policy-rejected",
    policy: createSystemTtsResourcePolicy({
      maxTranscriptChars: 1_000,
      maxOutputBytes: LIMITS.maxAssetBytes,
      timeoutMs: 30_000,
      maxConcurrentJobs: 2,
    }),
  })), "TTS_RESOURCE_POLICY_INVALID");
  check("provider privacy fixture authority cloud and legacy lifecycle fail at composition",
    arbitraryFixtureProvider.state.calls === 0 && arbitraryFixtureAudit.state.calls === 0,
  "only the pinned supervised fixture identity is registered");

  const oversizeProvider = createProviderWitness({ bytes: Buffer.alloc(RESOURCE_POLICY.maxOutputBytes + 1) });
  const oversizeAudit = createAuditWitness();
  const oversizePort = sourcePort({
    workspace,
    provider: oversizeProvider,
    audit: oversizeAudit,
    suffix: "oversize",
  });
  await expectCode(() => oversizePort.acquire({
    sessionId: "tts-oversize-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-oversize-001",
    request: createSystemTtsRequest({ transcript: "资源上限。", language: "zh-CN" }),
  }), "TTS_OUTPUT_INVALID");
  check("oversized staging output is discarded before import and audit",
    oversizeProvider.state.discards === 1
      && oversizeAudit.state.calls === 0
      && !(await exists(plannedStagingOutput("oversize"))),
  "staging cleanup complete");

  const malformedProvider = createProviderWitness({ bytes: Buffer.alloc(128, 0x55) });
  const malformedAudit = createAuditWitness();
  const malformedPort = sourcePort({
    workspace,
    provider: malformedProvider,
    audit: malformedAudit,
    suffix: "malformed",
  });
  await expectCode(() => malformedPort.acquire({
    sessionId: "tts-malformed-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-malformed-001",
    request: createSystemTtsRequest({ transcript: "格式校验。", language: "zh-CN" }),
  }), "TTS_OUTPUT_MISMATCH");
  check("fixture byte drift is rejected before App staging and leaves no audit",
    malformedProvider.state.discards === 1 && malformedAudit.state.calls === 0,
  "approved fixture audio SHA mismatch");

  let sameInodeOverwriteObserved = false;
  const importOverwriteProvider = createProviderWitness({ bytes: fixtureBytes });
  const importOverwriteAudit = createAuditWitness();
  const importOverwritePort = sourcePort({
    workspace,
    provider: importOverwriteProvider,
    audit: importOverwriteAudit,
    suffix: "import-same-inode-overwrite",
    writeOutputFile: async (filePath, bytes, options) => {
      await writeFile(filePath, bytes, options);
      const before = await lstat(filePath, { bigint: true });
      await writeFile(filePath, sameLengthReplacementBytes, { flag: "r+" });
      const after = await lstat(filePath, { bigint: true });
      sameInodeOverwriteObserved = String(before.dev) === String(after.dev)
        && String(before.ino) === String(after.ino)
        && before.size === after.size;
    },
  });
  const importOverwriteError = await expectCode(() => importOverwritePort.acquire({
    sessionId: "tts-import-same-inode-overwrite-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-import-same-inode-overwrite-001",
    request: createSystemTtsRequest({ transcript: "导入后字节身份校验。", language: "zh-CN" }),
  }), "TTS_OUTPUT_MISMATCH");
  check("post-import digest binding blocks same-inode byte replacement before audit",
    sameInodeOverwriteObserved
      && importOverwriteError.details.stage === "import-identity"
      && importOverwriteError.details.importedAssetPublished
      && importOverwriteProvider.state.discards === 1
      && importOverwriteAudit.state.calls === 0
      && !(await exists(plannedStagingOutput("import-same-inode-overwrite"))),
  "published asset truth retained; provider identity was not misattributed");

  const pathProvider = createProviderWitness({ bytes: fixtureBytes, behavior: "path-mismatch" });
  const pathAudit = createAuditWitness();
  const pathPort = sourcePort({
    workspace,
    provider: pathProvider,
    audit: pathAudit,
    suffix: "path-mismatch",
  });
  await expectCode(() => pathPort.acquire({
    sessionId: "tts-path-mismatch-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-path-mismatch-001",
    request: createSystemTtsRequest({ transcript: "路径校验。", language: "zh-CN" }),
  }), "TTS_PROVIDER_RECEIPT_INVALID");
  check("invalid provider receipt never drives discard outside the planned path",
    pathAudit.state.calls === 0
      && pathProvider.state.discards === 0
      && !(await exists(plannedStagingOutput("path-mismatch")))
      && Boolean(await exists(pathProvider.state.sentinels[0])),
  "planned output removed; sibling sentinel preserved");
  await rm(pathProvider.state.sentinels[0], { force: true });

  const rootSwapSuffix = "root-swap";
  const rootSwapStaging = path.join(STAGING_ROOT, rootSwapSuffix);
  const rootSwapBackup = path.join(STAGING_ROOT, `${rootSwapSuffix}-original`);
  const rootSwapExternal = path.join(RUN_ROOT, "root-swap-external");
  const rootSwapProvider = createProviderWitness({
    bytes: fixtureBytes,
    rootSwap: Object.freeze({
      stagingRoot: rootSwapStaging,
      backupRoot: rootSwapBackup,
      externalRoot: rootSwapExternal,
      plannedName: `tts-${rootSwapSuffix}-001.wav`,
    }),
  });
  const rootSwapAudit = createAuditWitness();
  const rootSwapPort = sourcePort({
    workspace,
    provider: rootSwapProvider,
    audit: rootSwapAudit,
    suffix: rootSwapSuffix,
  });
  let rootSwapError;
  let externalSentinelPreserved = false;
  try {
    rootSwapError = await expectCode(() => rootSwapPort.acquire({
      sessionId: "tts-root-swap-001",
      attemptId: "source-1",
      assetId: "asset-system-tts-root-swap-001",
      request: createSystemTtsRequest({ transcript: "根目录身份校验。", language: "zh-CN" }),
    }), "TTS_STAGING_ROOT_INVALID");
    externalSentinelPreserved = Boolean(await exists(rootSwapProvider.state.sentinels[0]));
    await expectCode(() => rootSwapPort.acquire({
      sessionId: "tts-root-swap-retry-001",
      attemptId: "source-1",
      assetId: "asset-system-tts-root-swap-retry-001",
      request: createSystemTtsRequest({ transcript: "根目录隔离。", language: "zh-CN" }),
    }), "TTS_PROVIDER_UNAVAILABLE");
  } finally {
    try { await unlink(rootSwapStaging); } catch { /* only the test junction may be absent */ }
    if (await exists(rootSwapBackup)) await rename(rootSwapBackup, rootSwapStaging);
    await rm(rootSwapExternal, { recursive: true, force: true });
  }
  check("staging root identity swap never drives deletion through a junction",
    rootSwapError.details.cleanupComplete === false
      && externalSentinelPreserved
      && rootSwapProvider.state.calls === 1
      && rootSwapProvider.state.discards === 1
      && rootSwapAudit.state.calls === 0,
  "external sentinel preserved; provider composition quarantined");

  const mutatingProvider = createProviderWitness({
    bytes: fixtureBytes,
    descriptorMutation: LOCAL_DESCRIPTOR,
  });
  const mutatingAudit = createAuditWitness();
  const mutatingPort = sourcePort({
    workspace,
    provider: mutatingProvider,
    audit: mutatingAudit,
    suffix: "descriptor-snapshot",
  });
  const mutatingResult = await mutatingPort.acquire({
    sessionId: "tts-descriptor-snapshot-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-descriptor-snapshot-001",
    request: createSystemTtsRequest({ transcript: "描述符快照。", language: "zh-CN" }),
  });
  check("provider descriptor is snapshotted once at composition",
    mutatingProvider.port.descriptor.providerDescriptorId === LOCAL_DESCRIPTOR.providerDescriptorId
      && mutatingPort.requiredCapability === FIXTURE_DESCRIPTOR.requiredCapability
      && mutatingAudit.state.receipts[0].providerDescriptor.providerDescriptorId
        === FIXTURE_DESCRIPTOR.providerDescriptorId
      && mutatingAudit.state.receipts[0].providerDescriptor.providerClass === "FIXTURE_LOCAL"
      && mutatingResult.importedAsset.assetId === "asset-system-tts-descriptor-snapshot-001",
  mutatingAudit.state.receipts[0].providerDescriptor.providerDescriptorId);

  const accessorProvider = createProviderWitness({ bytes: fixtureBytes, behavior: "accessor-receipt" });
  const accessorAudit = createAuditWitness();
  const accessorPort = sourcePort({
    workspace,
    provider: accessorProvider,
    audit: accessorAudit,
    suffix: "receipt-snapshot",
  });
  const accessorResult = await accessorPort.acquire({
    sessionId: "tts-receipt-snapshot-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-receipt-snapshot-001",
    request: createSystemTtsRequest({ transcript: "运行回执快照。", language: "zh-CN" }),
  });
  check("provider completion receipt accessors are read once into a private snapshot",
    accessorProvider.state.receiptReads === 5
      && accessorProvider.state.discards === 1
      && accessorAudit.state.receipts.length === 1
      && accessorResult.importedAsset.assetId === "asset-system-tts-receipt-snapshot-001",
  `${accessorProvider.state.receiptReads} accessor reads`);

  const secretProvider = createProviderWitness({ bytes: fixtureBytes, behavior: "secret-error" });
  const secretAudit = createAuditWitness();
  const secretPort = sourcePort({
    workspace,
    provider: secretProvider,
    audit: secretAudit,
    suffix: "secret-error",
  });
  const familyForFailures = createFamilyWorkspaceAuthoringAdapter(workspace);
  const secretSession = await openAuthoringProductSession({
    sessionId: "authoring-system-tts-secret-error-001",
    bindingId: binding.bindingId,
    clipId: binding.clips[0].clipId,
    authoringPort: familyForFailures.authoringPort,
    sourcePorts: [secretPort],
    commitCommandPort: commands.port,
    reviewPort,
  });
  const secretTask = createSystemTtsAuthoringTaskFacade(secretSession);
  secretTask.selectSynthesis({
    assetId: "asset-system-tts-secret-error-001",
    transcript: "供应商失败。",
    language: "zh-CN",
  });
  await secretTask.synthesizeAndPrepare();
  check("provider diagnostics normalize to a fixed public failure",
    secretTask.snapshot().failure.code === "AUTHORING_SESSION_SOURCE_TRANSIENT"
      && !JSON.stringify(secretTask.snapshot()).includes("SECRET_VENDOR_TOKEN")
      && !JSON.stringify(secretTask.snapshot()).includes("SECRET_ENDPOINT"),
  secretTask.snapshot().failure.code);

  const auditFailureProvider = createProviderWitness({ bytes: fixtureBytes });
  const auditFailureAudit = createAuditWitness({ failFirst: true });
  const auditFailurePort = sourcePort({
    workspace,
    provider: auditFailureProvider,
    audit: auditFailureAudit,
    suffix: "audit-failure",
  });
  const auditFailureTask = await openTask({
    workspace,
    ttsPort: auditFailurePort,
    sessionId: "authoring-system-tts-audit-failure-001",
    binding,
    commands,
    reviewPort,
  });
  auditFailureTask.selectSynthesis({
    assetId: "asset-system-tts-audit-failure-001",
    transcript: "审计写入失败。",
    language: "zh-CN",
  });
  await auditFailureTask.synthesizeAndPrepare();
  const auditFailureRecovery = await auditFailurePort.acquire({
    sessionId: "tts-audit-failure-recovery-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-audit-failure-recovery-001",
    request: createSystemTtsRequest({ transcript: "审计明确未持久化后恢复。", language: "zh-CN" }),
  });
  check("audit rejection settles as not-persisted before the channel is reused",
    auditFailureTask.snapshot().phase === "FAILED"
      && auditFailureTask.snapshot().failure.category === "TRANSIENT"
      && auditFailureTask.snapshot().failure.importedAssetPublished
      && auditFailureTask.snapshot().clipMetadata === null
      && auditFailureAudit.state.cancelCalls === 1
      && auditFailureAudit.state.cancelReasons[0] === "APPEND_FAILED"
      && auditFailureAudit.state.receipts.length === 1
      && auditFailureProvider.state.calls === 2
      && auditFailureRecovery.importedAsset.assetId
        === "asset-system-tts-audit-failure-recovery-001",
  auditFailureTask.snapshot().failure.code);

  const afterPersistFailureProvider = createProviderWitness({ bytes: fixtureBytes });
  const afterPersistFailureAudit = createAuditWitness({ failAfterPersistFirst: true });
  const afterPersistFailurePort = sourcePort({
    workspace,
    provider: afterPersistFailureProvider,
    audit: afterPersistFailureAudit,
    suffix: "audit-reject-after-persist",
  });
  const afterPersistFirst = await afterPersistFailurePort.acquire({
    sessionId: "tts-audit-reject-after-persist-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-audit-reject-after-persist-001",
    request: createSystemTtsRequest({ transcript: "审计先持久化后确认失败。", language: "zh-CN" }),
  });
  const afterPersistSecond = await afterPersistFailurePort.acquire({
    sessionId: "tts-audit-reject-after-persist-recovery-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-audit-reject-after-persist-recovery-001",
    request: createSystemTtsRequest({ transcript: "持久化证明后的后续任务。", language: "zh-CN" }),
  });
  check("audit rejection after persistence is accepted only through its exact settlement proof",
    afterPersistFailureAudit.state.cancelCalls === 1
      && afterPersistFailureAudit.state.cancelReasons[0] === "APPEND_FAILED"
      && afterPersistFailureAudit.state.receipts.length === 2
      && afterPersistFailureProvider.state.calls === 2
      && afterPersistFirst.importedAsset.assetId
        === "asset-system-tts-audit-reject-after-persist-001"
      && afterPersistSecond.importedAsset.assetId
        === "asset-system-tts-audit-reject-after-persist-recovery-001",
  `${afterPersistFailureAudit.state.receipts.length} exact receipts persisted`);

  const invalidAuditAckResults = [];
  for (const ack of ["undefined", "wrong-id", "false"]) {
    const provider = createProviderWitness({ bytes: fixtureBytes });
    const audit = createAuditWitness({ ack });
    const port = sourcePort({
      workspace,
      provider,
      audit,
      suffix: `audit-ack-${ack}`,
    });
    const error = await expectCode(() => port.acquire({
      sessionId: `tts-audit-ack-${ack}-001`,
      attemptId: "source-1",
      assetId: `asset-system-tts-audit-ack-${ack}-001`,
      request: createSystemTtsRequest({ transcript: `审计确认 ${ack}。`, language: "zh-CN" }),
    }), "TTS_AUDIT_SETTLEMENT_FAILED");
    invalidAuditAckResults.push(error.details.importedAssetPublished
      && provider.state.discards === 1
      && audit.state.calls === 1);
  }
  check("audit barrier requires exact receipt identity and persisted acknowledgement",
    invalidAuditAckResults.every(Boolean),
  "undefined wrong-id and false acknowledgements rejected");

  const hangingAuditProvider = createProviderWitness({ bytes: fixtureBytes });
  const hangingAudit = createAuditWitness({ hangFirst: true });
  const hangingAuditPort = sourcePort({
    workspace,
    provider: hangingAuditProvider,
    audit: hangingAudit,
    suffix: "audit-timeout",
    policy: SHORT_TIMEOUT_POLICY,
  });
  const hangingAttempt = expectCode(() => hangingAuditPort.acquire({
    sessionId: "tts-audit-timeout-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-audit-timeout-001",
    request: createSystemTtsRequest({ transcript: "审计超时。", language: "zh-CN" }),
  }), "TTS_AUDIT_WRITE_FAILED");
  await hangingAudit.entered.promise;
  const hangingError = await hangingAttempt;
  const afterHangingAudit = await hangingAuditPort.acquire({
    sessionId: "tts-audit-timeout-recovery-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-audit-timeout-recovery-001",
    request: createSystemTtsRequest({ transcript: "审计槽位恢复。", language: "zh-CN" }),
  });
  check("audit timeout is bounded and releases the source concurrency slot",
    hangingError.details.importedAssetPublished
      && hangingAuditProvider.state.calls === 2
      && hangingAudit.state.calls === 2
      && afterHangingAudit.importedAsset.assetId === "asset-system-tts-audit-timeout-recovery-001",
  "first append remains unacknowledged; second source job completes");

  const latePersistAuditProvider = createProviderWitness({ bytes: fixtureBytes });
  const latePersistAudit = createAuditWitness({ lateFirstMs: 260 });
  const latePersistAuditPort = sourcePort({
    workspace,
    provider: latePersistAuditProvider,
    audit: latePersistAudit,
    suffix: "audit-late-persist",
    policy: SHORT_TIMEOUT_POLICY,
  });
  const lateAuditAttempt = expectCode(() => latePersistAuditPort.acquire({
    sessionId: "tts-audit-late-persist-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-audit-late-persist-001",
    request: createSystemTtsRequest({ transcript: "审计迟到持久化。", language: "zh-CN" }),
  }), "TTS_AUDIT_SETTLEMENT_FAILED");
  await latePersistAudit.entered.promise;
  const lateAuditError = await lateAuditAttempt;
  await new Promise((resolve) => setTimeout(resolve, 320));
  await expectCode(() => latePersistAuditPort.acquire({
    sessionId: "tts-audit-late-persist-retry-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-audit-late-persist-retry-001",
    request: createSystemTtsRequest({ transcript: "审计隔离后的任务。", language: "zh-CN" }),
  }), "TTS_AUDIT_UNAVAILABLE");
  check("late audit persistence leaves the exact receipt but quarantines new source jobs",
    lateAuditError.details.importedAssetPublished
      && latePersistAudit.state.cancelCalls === 1
      && latePersistAudit.state.receipts.length === 1
      && latePersistAuditProvider.state.calls === 1,
  "unknown settlement never reopens the audit channel automatically");

  const preAbortProvider = createProviderWitness({ bytes: fixtureBytes });
  const preAbortAudit = createAuditWitness();
  const preAbortPort = sourcePort({
    workspace,
    provider: preAbortProvider,
    audit: preAbortAudit,
    suffix: "pre-abort",
  });
  const preAbort = new AbortController();
  preAbort.abort();
  await expectCode(() => preAbortPort.acquire({
    sessionId: "tts-pre-abort-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-pre-abort-001",
    request: createSystemTtsRequest({ transcript: "开始前取消。", language: "zh-CN" }),
    signal: preAbort.signal,
  }), "TTS_REQUEST_ABORTED");
  check("pre-start cancellation has zero provider import and audit effects",
    preAbortProvider.state.calls === 0 && preAbortAudit.state.calls === 0,
  "provider=0 audit=0");

  const timeoutProvider = createProviderWitness({ bytes: fixtureBytes, block: true });
  const timeoutAudit = createAuditWitness();
  const timeoutPort = sourcePort({
    workspace,
    provider: timeoutProvider,
    audit: timeoutAudit,
    suffix: "timeout",
    policy: SHORT_TIMEOUT_POLICY,
  });
  const timeoutResult = expectCode(() => timeoutPort.acquire({
    sessionId: "tts-timeout-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-timeout-001",
    request: createSystemTtsRequest({ transcript: "超时收口。", language: "zh-CN" }),
  }), "TTS_PROVIDER_TIMEOUT");
  await timeoutProvider.entered.promise;
  await timeoutResult;
  check("provider watchdog waits for abort settlement and leaves no late artifact",
    timeoutProvider.state.aborted === 1
      && timeoutProvider.state.cancelCalls === 1
      && timeoutAudit.state.calls === 0
      && !(await exists(plannedStagingOutput("timeout"))),
  "timeout settled after provider observed abort");

  const lateCompletionProvider = createProviderWitness({ bytes: fixtureBytes, behavior: "late-completion" });
  const lateCompletionAudit = createAuditWitness();
  const lateCompletionPort = sourcePort({
    workspace,
    provider: lateCompletionProvider,
    audit: lateCompletionAudit,
    suffix: "late-completion",
    policy: SHORT_TIMEOUT_POLICY,
  });
  const lateCompletionAttempt = expectCode(() => lateCompletionPort.acquire({
    sessionId: "tts-late-completion-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-late-completion-001",
    request: createSystemTtsRequest({ transcript: "迟到结果隔离。", language: "zh-CN" }),
  }), "TTS_PROVIDER_SETTLEMENT_FAILED");
  await lateCompletionProvider.entered.promise;
  const lateCompletionError = await lateCompletionAttempt;
  await new Promise((resolve) => setTimeout(resolve, 320));
  await expectCode(() => lateCompletionPort.acquire({
    sessionId: "tts-late-completion-retry-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-late-completion-retry-001",
    request: createSystemTtsRequest({ transcript: "迟到结果后的任务。", language: "zh-CN" }),
  }), "TTS_PROVIDER_UNAVAILABLE");
  check("late provider completion has no App staging write capability",
    lateCompletionError.details.cleanupComplete === false
      && lateCompletionProvider.state.calls === 1
      && lateCompletionProvider.state.cancelCalls === 1
      && lateCompletionAudit.state.calls === 0
      && !(await exists(plannedStagingOutput("late-completion"))),
  "late audio bytes settled only inside the quarantined provider promise");

  const brokenSettlementProvider = createProviderWitness({
    bytes: fixtureBytes,
    block: true,
    behavior: "invalid-cancel-ack",
  });
  const brokenSettlementAudit = createAuditWitness();
  const brokenSettlementPort = sourcePort({
    workspace,
    provider: brokenSettlementProvider,
    audit: brokenSettlementAudit,
    suffix: "broken-settlement",
    policy: SHORT_TIMEOUT_POLICY,
  });
  const brokenSettlementAttempt = expectCode(() => brokenSettlementPort.acquire({
    sessionId: "tts-broken-settlement-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-broken-settlement-001",
    request: createSystemTtsRequest({ transcript: "结算证明。", language: "zh-CN" }),
  }), "TTS_PROVIDER_SETTLEMENT_FAILED");
  await brokenSettlementProvider.entered.promise;
  const brokenSettlementError = await brokenSettlementAttempt;
  await expectCode(() => brokenSettlementPort.acquire({
    sessionId: "tts-broken-settlement-retry-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-broken-settlement-retry-001",
    request: createSystemTtsRequest({ transcript: "隔离后的任务。", language: "zh-CN" }),
  }), "TTS_PROVIDER_UNAVAILABLE");
  check("invalid settlement proof quarantines the provider composition",
    brokenSettlementError.details.cleanupComplete === false
      && brokenSettlementProvider.state.cancelCalls === 1
      && brokenSettlementProvider.state.calls === 1
      && brokenSettlementAudit.state.calls === 0,
  "subsequent source job rejected before provider start");

  const cleanupProvider = createProviderWitness({ bytes: fixtureBytes, behavior: "discard-fail" });
  const cleanupAudit = createAuditWitness();
  const cleanupPort = sourcePort({
    workspace,
    provider: cleanupProvider,
    audit: cleanupAudit,
    suffix: "cleanup-failure",
  });
  const cleanupError = await expectCode(() => cleanupPort.acquire({
    sessionId: "tts-cleanup-failure-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-cleanup-failure-001",
    request: createSystemTtsRequest({ transcript: "清理证明失败。", language: "zh-CN" }),
  }), "TTS_STAGING_CLEANUP_FAILED");
  await expectCode(() => cleanupPort.acquire({
    sessionId: "tts-cleanup-failure-retry-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-cleanup-failure-retry-001",
    request: createSystemTtsRequest({ transcript: "清理失败后的任务。", language: "zh-CN" }),
  }), "TTS_PROVIDER_UNAVAILABLE");
  check("provider cleanup-proof failure blocks audit while removing owned output",
    cleanupError.details.importedAssetPublished === true
      && cleanupError.details.cleanupComplete === false
      && cleanupProvider.state.calls === 1
      && cleanupAudit.state.calls === 0
      && !(await exists(plannedStagingOutput("cleanup-failure"))),
  "asset truth retained; staging bytes removed");

  const hangingDiscardProvider = createProviderWitness({ bytes: fixtureBytes, behavior: "discard-hang" });
  const hangingDiscardAudit = createAuditWitness();
  const hangingDiscardPort = sourcePort({
    workspace,
    provider: hangingDiscardProvider,
    audit: hangingDiscardAudit,
    suffix: "discard-timeout",
    policy: SHORT_TIMEOUT_POLICY,
  });
  const hangingDiscardError = await expectCode(() => hangingDiscardPort.acquire({
    sessionId: "tts-discard-timeout-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-discard-timeout-001",
    request: createSystemTtsRequest({ transcript: "清理超时。", language: "zh-CN" }),
  }), "TTS_STAGING_CLEANUP_FAILED");
  await expectCode(() => hangingDiscardPort.acquire({
    sessionId: "tts-discard-timeout-retry-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-discard-timeout-retry-001",
    request: createSystemTtsRequest({ transcript: "清理隔离。", language: "zh-CN" }),
  }), "TTS_PROVIDER_UNAVAILABLE");
  check("provider discard timeout is bounded and quarantines the provider",
    hangingDiscardError.details.importedAssetPublished
      && hangingDiscardError.details.cleanupComplete === false
      && hangingDiscardProvider.state.calls === 1
      && hangingDiscardProvider.state.discards === 1
      && hangingDiscardAudit.state.calls === 0
      && !(await exists(plannedStagingOutput("discard-timeout"))),
  "planned output removed independently after discard timeout");

  const partialWriteProvider = createProviderWitness({ bytes: fixtureBytes });
  const partialWriteAudit = createAuditWitness();
  const partialWritePort = sourcePort({
    workspace,
    provider: partialWriteProvider,
    audit: partialWriteAudit,
    suffix: "partial-write",
    writeOutputFile: async (target, payload, options) => {
      await writeFile(target, payload, options);
      throw codedError("EIO", "injected post-write failure");
    },
  });
  const partialWriteError = await expectCode(() => partialWritePort.acquire({
    sessionId: "tts-partial-write-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-partial-write-001",
    request: createSystemTtsRequest({ transcript: "部分写入回收。", language: "zh-CN" }),
  }), "TTS_STAGING_WRITE_FAILED");
  check("post-create staging write failure retains a file witness for cleanup",
    partialWriteError.details.cleanupComplete === true
      && partialWriteProvider.state.discards === 1
      && partialWriteAudit.state.calls === 0
      && !(await exists(plannedStagingOutput("partial-write"))),
  "partial App-owned file removed by identity after injected write failure");

  const midProvider = createProviderWitness({ bytes: fixtureBytes, block: true });
  const midAudit = createAuditWitness();
  const midPort = sourcePort({ workspace, provider: midProvider, audit: midAudit, suffix: "mid-cancel" });
  const midTask = await openTask({
    workspace,
    ttsPort: midPort,
    sessionId: "authoring-system-tts-mid-cancel-001",
    binding,
    commands,
    reviewPort,
  });
  midTask.selectSynthesis({
    assetId: "asset-system-tts-mid-cancel-001",
    transcript: "合成中取消。",
    language: "zh-CN",
  });
  const midSynthesis = midTask.synthesizeAndPrepare();
  await midProvider.entered.promise;
  const midCancel = midTask.cancel();
  await Promise.all([midSynthesis, midCancel]);
  check("provider-stage cancel waits for settlement and is terminal",
    midProvider.state.aborted === 1
      && midProvider.state.cancelCalls === 1
      && midTask.snapshot().phase === "CANCELLED"
      && midTask.snapshot().importedAsset === null
      && midAudit.state.calls === 0,
  midTask.snapshot().stateId);

  const lateProvider = createProviderWitness({ bytes: fixtureBytes });
  const lateAudit = createAuditWitness({ block: true });
  const latePort = sourcePort({ workspace, provider: lateProvider, audit: lateAudit, suffix: "late-cancel" });
  const lateTask = await openTask({
    workspace,
    ttsPort: latePort,
    sessionId: "authoring-system-tts-late-cancel-001",
    binding,
    commands,
    reviewPort,
  });
  lateTask.selectSynthesis({
    assetId: "asset-system-tts-late-cancel-001",
    transcript: "导入后取消。",
    language: "zh-CN",
  });
  const lateSynthesis = lateTask.synthesizeAndPrepare();
  await lateAudit.entered.promise;
  const lateCancel = lateTask.cancel();
  await Promise.all([lateSynthesis, lateCancel]);
  check("post-import cancel settles cleanup and audit without revision mutation",
    lateTask.snapshot().phase === "CANCELLED"
      && lateTask.snapshot().facts.importedAssetPublished
      && lateTask.snapshot().importedAsset === null
      && lateAudit.state.receipts.length === 1
      && lateAudit.state.cancelCalls === 1
      && lateAudit.state.cancelReasons[0] === "REQUEST_ABORTED"
      && lateProvider.state.discards === 1,
  lateAudit.state.receipts[0].receiptId);

  const busyProvider = createProviderWitness({ bytes: fixtureBytes, block: true });
  const busyAudit = createAuditWitness();
  const busyPort = sourcePort({ workspace, provider: busyProvider, audit: busyAudit, suffix: "busy" });
  const firstBusy = busyPort.acquire({
    sessionId: "tts-busy-first-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-busy-first-001",
    request: createSystemTtsRequest({ transcript: "第一个任务。", language: "zh-CN" }),
  });
  await busyProvider.entered.promise;
  await expectCode(() => busyPort.acquire({
    sessionId: "tts-busy-second-001",
    attemptId: "source-1",
    assetId: "asset-system-tts-busy-second-001",
    request: createSystemTtsRequest({ transcript: "第二个任务。", language: "zh-CN" }),
  }), "TTS_RESOURCE_BUSY");
  busyProvider.release.resolve();
  const busyResult = await firstBusy;
  check("single-flight resource policy rejects overlap and permits settlement",
    busyProvider.state.calls === 1
      && busyAudit.state.receipts.length === 1
      && busyResult.importedAsset.assetId === "asset-system-tts-busy-first-001",
  busyResult.importedAsset.sha256);

  const finalHead = await workspace.read.loadHead();
  check("failed cancelled and direct-source scenarios did not mutate Family head",
    finalHead.revisionId === committed.revisionId,
  finalHead.revisionId);
  const stagingEntries = await readdir(STAGING_ROOT, { recursive: true });
  const remainingWavs = stagingEntries.filter((entry) => String(entry).endsWith(".wav"));
  check("all provider staging artifacts are settled", remainingWavs.length === 0,
    `${remainingWavs.length} wav artifacts remain`);

  const stableAfter = await pathHashes(PROTECTED_PATHS);
  check("stable software core and hardware inputs are byte-identical",
    JSON.stringify(stableAfter) === JSON.stringify(stableBefore),
  `${PROTECTED_PATHS.length} protected files unchanged`);
  const subjectAfter = await pathHashes(SUBJECT_PATHS);
  check("acceptance report binds the exact TTS contract adapter facade and runner bytes",
    JSON.stringify(subjectAfter) === JSON.stringify(subjectBefore),
  `${SUBJECT_PATHS.length} subject files hashed`);

  const report = {
    schemaVersion: 1,
    profile: "companion-system-tts-source-adapter-acceptance-v1",
    generatedAt: "2026-08-04T17:00:00.000Z",
    checksPassed: checks.length,
    checks,
    providerDescriptorId: FIXTURE_DESCRIPTOR.providerDescriptorId,
    resourcePolicy: RESOURCE_POLICY,
    protectedFileSha256: stableAfter,
    subjectFileSha256: subjectAfter,
    officialEvidence: [
      "Microsoft.System.Speech:installed-voices-wave-output-async-cancel",
      "Microsoft.Azure.Speech:documented-endpoint-region-format-quota-data-policy",
      "Android.TextToSpeech:engine-and-voice-identity-async-file-output",
      "Apple.AVSpeechSynthesizer:voice-identity-buffer-output-stop",
      "OHF.Piper:local-engine-model-card-per-voice-license-gate",
    ],
    boundaries: {
      productSource: "SYSTEM_TTS->system-tts",
      canonicalAudio: "WAV_PCM16_16K_MONO",
      providerAuthority: "FIXTURE_ONLY",
      productionProviderQualified: false,
      sessionCoreModified: false,
      familyWorkspaceModified: false,
      boardTarget: "UNRESOLVED",
      hardwareImpact: "NONE",
      buildAuthorized: false,
      offlineReady: false,
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), bytes, { flag: "wx" });
  console.log(`System TTS source adapter acceptance: ${checks.length}/${checks.length}`);
  console.log(`System TTS source adapter report SHA-256: ${sha256(bytes)}`);
}

const lock = await acquireLock();
try {
  await run();
} finally {
  try { await lock.close(); } catch { /* report remains authoritative */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* lock cleanup is best effort */ }
}
