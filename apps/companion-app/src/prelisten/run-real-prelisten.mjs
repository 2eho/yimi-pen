import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { buildPreview } from "../../../../tools/family-alpha-compiler/compiler.mjs";
import { createConfirmationTrustProvider } from "../../../../tools/confirmation-trust/provider.mjs";
import { MemoryChallengeStore } from "../../../../tools/confirmation-trust/replay-store.mjs";
import { loadConfirmationTrustSchemaValidator } from "../../../../tools/confirmation-trust/schema-validator.mjs";
import { createFixtureProof } from "../fixture-confirmation.mjs";
import {
  decodeAudioToNull,
  FfplayAudioBackend,
  probeCanonicalWav,
  recordCanonicalWavFromDshow,
  resolvePinnedFfmpegTool,
} from "./ffmpeg-host-audio.mjs";
import { importCanonicalWav, resolveVerifiedPreviewClip } from "./local-audio-assets.mjs";
import { createAudioPlayerPrelistenPort } from "./presentation-session.mjs";
import { executeVerifiedPrelisten } from "./verified-prelisten-use-case.mjs";

const APP_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-real-prelisten");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-real-prelisten.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".companion-real-prelisten-root");
const MARKER_TEXT = "yimi-companion-real-prelisten-root-v1\n";
const ALPHA_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const FAMILY_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1/golden");
const TRUST_ROOT = path.join(REPO_ROOT, "hardware/evt0/confirmation-trust-v1/golden");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function utcNow() {
  return new Date().toISOString();
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(target) {
  try { return await lstat(target); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  try {
    return await open(LOCK_PATH, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("real prelisten probe has an active or stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("real prelisten root must be an owned directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("real prelisten root escaped build/");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) throw new Error("real prelisten root lacks its ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { flag: "wx" });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function parseArguments(argv) {
  const options = {
    runnerConfirm: false,
    volume: 20,
    recordDevice: null,
    recordSeconds: 3,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--runner-confirm") options.runnerConfirm = true;
    else if (argument === "--volume") options.volume = Number(argv[++index]);
    else if (argument === "--record-device") options.recordDevice = argv[++index];
    else if (argument === "--record-seconds") options.recordSeconds = Number(argv[++index]);
    else if (argument === "--help") {
      console.log("Usage: npm run verify:companion-real-prelisten -- [--runner-confirm] [--volume 0..100] [--record-device NAME] [--record-seconds N]");
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.volume) || options.volume < 0 || options.volume > 100) throw new Error("--volume must be an integer from 0 through 100");
  if (!Number.isFinite(options.recordSeconds) || options.recordSeconds <= 0 || options.recordSeconds > 600) throw new Error("--record-seconds must be in (0, 600]");
  return options;
}

function mutableClock(initial) {
  let value = initial;
  return { now: () => value, set: (next) => { value = next; } };
}

function confirmationIdNow() {
  return `CONF-HOST-PRELISTEN-${utcNow().replace(/[-:.]/gu, "").replace("Z", "Z")}`;
}

async function requireExplicitConfirmation({ runnerConfirm, previewId }) {
  if (runnerConfirm) return { class: "runner-fixture-action", operatorPostPlaybackAttestationIncluded: false };
  const phrase = `CONFIRM-${previewId.slice(-8).toUpperCase()}`;
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question(`全部音频已自然播放结束。确认内容后输入 ${phrase}: `);
    if (answer.trim() !== phrase) throw new Error("explicit confirmation phrase did not match");
  } finally {
    prompt.close();
  }
  return { class: "interactive-post-playback-action", operatorPostPlaybackAttestationIncluded: true };
}

async function run(options) {
  await prepareRunRoot();
  if (String(process.env.SDL_AUDIODRIVER ?? "").toLowerCase() === "dummy") {
    throw new Error("SDL_AUDIODRIVER=dummy is outside the real host-audio evidence profile");
  }
  const [ffmpeg, ffprobe, ffplay, buildPlan, policy, contracts] = await Promise.all([
    resolvePinnedFfmpegTool({ repoRoot: REPO_ROOT, toolName: "ffmpeg" }),
    resolvePinnedFfmpegTool({ repoRoot: REPO_ROOT, toolName: "ffprobe" }),
    resolvePinnedFfmpegTool({ repoRoot: REPO_ROOT, toolName: "ffplay" }),
    readJson(path.join(FAMILY_ROOT, "build-plan.json")),
    readJson(path.join(TRUST_ROOT, "trust-policy.json")),
    loadConfirmationTrustSchemaValidator(REPO_ROOT),
  ]);
  const { preview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath: path.join(ALPHA_ROOT, "draft.json") });
  const clips = preview.bindings.flatMap((binding) => binding.clips);
  const assetIdByPath = new Map(buildPlan.assetCatalog.assets.map((asset) => [asset.path, asset.assetId]));
  const vaultRoot = path.join(RUN_ROOT, "asset-vault");
  const imports = [];
  const decodeReceipts = [];
  const absolutePathBySha256 = new Map();
  for (const clip of clips) {
    const source = path.join(ALPHA_ROOT, ...clip.assetPath.split("/"));
    const imported = await importCanonicalWav({
      sourcePath: source,
      assetId: assetIdByPath.get(clip.assetPath) ?? `asset-${clip.clipId}`,
      vaultRoot,
      probeCanonicalWav: (filePath) => probeCanonicalWav({ ffprobe, filePath }),
    });
    if (imported.bytes !== clip.bytes || imported.sha256 !== clip.sha256 || imported.durationMs !== clip.durationMs) {
      throw new Error(`${clip.clipId} import identity differs from its preview`);
    }
    absolutePathBySha256.set(imported.sha256, imported.absolutePath);
    const decoded = await decodeAudioToNull({ ffmpeg, filePath: imported.absolutePath });
    imports.push({
      clipId: clip.clipId,
      assetId: imported.assetId,
      contentPath: imported.contentPath,
      bytes: imported.bytes,
      sha256: imported.sha256,
      durationMs: imported.durationMs,
      codec: imported.codec,
    });
    decodeReceipts.push({ clipId: clip.clipId, sha256: clip.sha256, ...decoded });
  }

  let recording = null;
  if (options.recordDevice) {
    const recordingPath = path.join(RUN_ROOT, "recording", "capture.wav");
    const captured = await recordCanonicalWavFromDshow({
      ffmpeg,
      ffprobe,
      deviceName: options.recordDevice,
      durationSeconds: options.recordSeconds,
      outputPath: recordingPath,
    });
    const imported = await importCanonicalWav({
      sourcePath: captured.outputPath,
      assetId: "asset-local-microphone-capture",
      vaultRoot,
      probeCanonicalWav: (filePath) => probeCanonicalWav({ ffprobe, filePath }),
    });
    recording = {
      sourceClass: captured.sourceClass,
      durationMs: imported.durationMs,
      bytes: imported.bytes,
      sha256: imported.sha256,
      codec: imported.codec,
      boundIntoCurrentPreview: false,
    };
  }

  const initialNow = utcNow();
  const providerClock = mutableClock(initialNow);
  const challengeStore = new MemoryChallengeStore();
  const provider = createConfirmationTrustProvider({
    policy,
    challengeStore,
    clock: providerClock,
    nonceSource: () => randomBytes(16),
    authorityResolver: async () => structuredClone(policy.authorities[0]),
    contractValidator: contracts,
  });
  const backend = new FfplayAudioBackend({ ffplay, volume: options.volume });
  const playbackPort = createAudioPlayerPrelistenPort({ backend, defaultTimeoutMs: 60_000 });
  console.log(`Playing ${clips.length} low-volume fixture clips through pinned ffplay...`);
  const {
    challenge,
    explicitAction,
    confirmed,
    proof,
    verificationResult,
    buildAuthorization,
    sessionEvidence,
  } = await executeVerifiedPrelisten({
    provider,
    buildPlan,
    preview,
    familyLibraryId: policy.authorities[0].familyLibraryId,
    authoritySessionRef: "host-real-prelisten-fixture-session",
    issueOperationId: `op:host-prelisten-issue:${Date.now()}`,
    consumeOperationId: `op:host-prelisten-consume:${Date.now()}`,
    sessionId: `host-prelisten:${Date.now()}`,
    clipResolver: (clip) => resolveVerifiedPreviewClip({
      clip,
      assetRoot: vaultRoot,
      absolutePathBySha256,
    }),
    playbackPort,
    explicitConfirmationPort: () => requireExplicitConfirmation({
      runnerConfirm: options.runnerConfirm,
      previewId: preview.previewId,
    }),
    confirmationIdFactory: confirmationIdNow,
    proofFactory: ({ challenge: issuedChallenge, presentationTranscript, confirmation }) => {
      const issuedAt = utcNow();
      const expiresAt = new Date(Date.parse(issuedAt) + 120_000).toISOString();
      const created = createFixtureProof({
        policy,
        challenge: issuedChallenge,
        presentationTranscript,
        confirmation,
        issuedAt,
        expiresAt,
      });
      providerClock.set(issuedAt);
      return created;
    },
    contractValidator: contracts,
  });
  const playbackReceipts = sessionEvidence.playbackReceipts.map((receipt) => ({
    clipId: receipt.clipId,
    expectedSha256: receipt.expectedSha256,
    expectedBytes: receipt.expectedBytes,
    playbackId: receipt.playbackId,
    backend: receipt.backend,
    evidenceClass: receipt.evidenceClass,
    executableSha256: receipt.executableSha256,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    elapsedMs: receipt.elapsedMs,
    completion: receipt.completion,
    exitCode: receipt.exitCode,
    signal: receipt.signal,
  }));
  const gates = {
    pinnedFfmpegSuiteVerified: [ffmpeg, ffprobe, ffplay].every((tool) => tool.suiteArchiveSha256
      === "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"),
    everyPreviewAssetImportedByteExact: imports.length === clips.length
      && imports.every((asset, index) => asset.sha256 === clips[index].sha256 && asset.bytes === clips[index].bytes),
    everyImportedAssetFullyDecoded: decodeReceipts.length === clips.length
      && decodeReceipts.every((receipt) => receipt.exitCode === 0 && receipt.audioEndpointUsed === false),
    everyClipReachedFfplayNaturalExit: playbackReceipts.length === clips.length
      && playbackReceipts.every((receipt, index) => receipt.exitCode === 0
        && receipt.completion === "natural-end"
        && receipt.expectedSha256 === clips[index].sha256
        && receipt.executableSha256 === ffplay.sha256),
    confirmationWasSeparatePostPlaybackAction: confirmed.transcript.events.at(-1)?.kind === "CONFIRM_ACTION"
      && confirmed.transcript.events.at(-2)?.kind === "CLIP_PLAYBACK_COMPLETED",
    presentationVerifiedAndChallengeConsumed: verificationResult.verified === true,
    buildAuthorizationDerivedFromVerifiedPresentation: buildAuthorization.presentationTranscriptSha256
      === confirmed.transcript.transcriptSha256,
  };
  const failures = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const report = {
    schemaVersion: 1,
    profile: "companion-real-prelisten-host-evidence-v1",
    fixtureOnly: true,
    capturedAt: utcNow(),
    evidenceScope: {
      canonicalLocalImportIncluded: true,
      completeDecodeIncluded: true,
      actualPlaybackCallbackIncluded: true,
      hostAudioEndpointRequested: true,
      operatorPostPlaybackAttestationIncluded: explicitAction.operatorPostPlaybackAttestationIncluded,
      authenticatedGuardianIncluded: false,
      acousticLoopbackOrMicrophoneWitnessIncluded: false,
      targetDeviceAudioIncluded: false,
      actualMicrophoneRecordingIncluded: recording !== null,
      recordingBoundIntoCurrentPreview: recording?.boundIntoCurrentPreview ?? false,
    },
    explicitActionClass: explicitAction.class,
    tools: [ffmpeg, ffprobe, ffplay].map((tool) => ({
      name: tool.name,
      version: tool.version,
      sha256: tool.sha256,
      suiteArchiveSha256: tool.suiteArchiveSha256,
    })),
    previewId: preview.previewId,
    challengeId: challenge.challengeId,
    transcriptSha256: confirmed.transcript.transcriptSha256,
    proofId: proof.proofId,
    verificationId: verificationResult.verificationId,
    authorizationId: buildAuthorization.authorizationId,
    imports,
    decodeReceipts,
    playbackReceipts,
    recording,
    gates,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await Promise.all([
    writeFile(path.join(RUN_ROOT, "presentation-transcript.json"), `${JSON.stringify(confirmed.transcript, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "confirmation.json"), `${JSON.stringify(confirmed.confirmation, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "report.json"), reportBytes, { flag: "wx" }),
  ]);
  console.log(`Real prelisten host callbacks: ${playbackReceipts.length}/${clips.length}`);
  console.log(`Real prelisten transcript: ${confirmed.transcript.transcriptSha256}`);
  console.log(`Real prelisten report SHA-256: ${sha256(reportBytes)}`);
  if (failures.length) throw new Error(`real prelisten gates failed: ${failures.join(", ")}`);
}

const options = parseArguments(process.argv.slice(2));
const lock = await acquireLock();
let preserveLock = false;
try {
  await run(options);
} catch (error) {
  preserveLock = error?.details?.cleanupComplete === false;
  throw error;
} finally {
  try { await lock.close(); } catch { /* result above remains authoritative */ }
  if (!preserveLock) {
    try { await rm(LOCK_PATH, { force: true }); } catch { /* result above remains authoritative */ }
  }
}
