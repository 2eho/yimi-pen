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
import { verifyBuildPlanAssets } from "../../../../tools/family-build-adapter/adapter.mjs";
import { MemoryFamilyRepository } from "../../../../tools/family-repository/memory-adapter.mjs";
import { createConfirmationTrustProvider } from "../../../../tools/confirmation-trust/provider.mjs";
import { MemoryChallengeStore } from "../../../../tools/confirmation-trust/replay-store.mjs";
import { loadConfirmationTrustSchemaValidator } from "../../../../tools/confirmation-trust/schema-validator.mjs";
import { createFixtureProof } from "../fixture-confirmation.mjs";
import {
  authorizedCompileDesignSnapshot,
  composeFixtureBuildPlan,
  projectAndValidateBuildPlan,
} from "../host-orchestrator.mjs";
import {
  decodeAudioToNull,
  FfplayAudioBackend,
  probeCanonicalWav,
  resolvePinnedFfmpegTool,
} from "../prelisten/ffmpeg-host-audio.mjs";
import {
  importCanonicalWav,
  resolveVerifiedPreviewClip,
  sha256File,
} from "../prelisten/local-audio-assets.mjs";
import { createAudioPlayerPrelistenPort } from "../prelisten/presentation-session.mjs";
import { executeVerifiedPrelisten } from "../prelisten/verified-prelisten-use-case.mjs";
import { captureCanonicalAudioAsset } from "./capture-source-use-case.mjs";
import { createDirectShowCapturePort } from "./directshow-capture-port.mjs";
import {
  commitImportedClipReplacement,
  extendFixtureTargetWithImportedAsset,
} from "./family-authoring-use-case.mjs";
import { materializeBuildPlanWorkspace } from "./local-authoring-workspace.mjs";

const APP_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-real-authored-flow");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-real-authored-flow.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".companion-real-authored-flow-root");
const MARKER_TEXT = "yimi-companion-real-authored-flow-root-v1\n";
const ALPHA_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const FAMILY_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1/golden");
const TRUST_ROOT = path.join(REPO_ROOT, "hardware/evt0/confirmation-trust-v1/golden");
const PINNED_SUITE_SHA256 = "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec";

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
    if (error?.code === "EEXIST") throw new Error("real authored flow has an active or stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("real authored flow root must be an owned directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("real authored flow root escaped build/");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) throw new Error("real authored flow root lacks its ownership marker");
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
    sourcePath: null,
    transcript: "宝贝，妈妈在这里。",
    language: "zh-CN",
    mediaType: "voice",
    bindingId: "binding-013",
    clipId: "clip-013-1",
    runnerConfirm: false,
    volume: 20,
    recordDevice: null,
    recordSeconds: 3,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") options.sourcePath = path.resolve(process.cwd(), argv[++index]);
    else if (argument === "--transcript") options.transcript = argv[++index];
    else if (argument === "--language") options.language = argv[++index];
    else if (argument === "--media-type") options.mediaType = argv[++index];
    else if (argument === "--binding") options.bindingId = argv[++index];
    else if (argument === "--clip") options.clipId = argv[++index];
    else if (argument === "--runner-confirm") options.runnerConfirm = true;
    else if (argument === "--volume") options.volume = Number(argv[++index]);
    else if (argument === "--record-device") options.recordDevice = argv[++index];
    else if (argument === "--record-seconds") options.recordSeconds = Number(argv[++index]);
    else if (argument === "--help") {
      console.log("Usage: npm run verify:companion-real-authored -- [--source FILE.wav | --record-device NAME [--record-seconds N]] [--transcript TEXT] [--language zh-CN] [--media-type voice] [--binding binding-013] [--clip clip-013-1] [--runner-confirm] [--volume 0..100]");
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (typeof options.transcript !== "string" || options.transcript.length < 1 || options.transcript.length > 1_000) {
    throw new Error("--transcript must contain 1 through 1000 characters");
  }
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(options.language ?? "")) throw new Error("--language is malformed");
  if (!["voice", "narration", "sfx", "song"].includes(options.mediaType)) throw new Error("--media-type is unsupported");
  if (!/^binding-[a-z0-9][a-z0-9._-]{2,63}$/u.test(options.bindingId ?? "")) throw new Error("--binding is malformed");
  if (!/^clip-[a-z0-9][a-z0-9._-]{2,63}$/u.test(options.clipId ?? "")) throw new Error("--clip is malformed");
  if (!Number.isInteger(options.volume) || options.volume < 0 || options.volume > 100) {
    throw new Error("--volume must be an integer from 0 through 100");
  }
  if (options.sourcePath && options.recordDevice) throw new Error("--source and --record-device are mutually exclusive");
  if (!Number.isFinite(options.recordSeconds) || options.recordSeconds <= 0 || options.recordSeconds > 600) {
    throw new Error("--record-seconds must be in (0, 600]");
  }
  return options;
}

function mutableClock(initial) {
  let value = initial;
  return { now: () => value, set: (next) => { value = next; } };
}

function confirmationIdNow() {
  return `CONF-AUTHORED-${utcNow().replace(/[-:.]/gu, "")}`;
}

async function requireExplicitConfirmation({ runnerConfirm, previewId }) {
  if (runnerConfirm) return { class: "runner-fixture-action", operatorPostPlaybackAttestationIncluded: false };
  const phrase = `CONFIRM-${previewId.slice(-8).toUpperCase()}`;
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question(`创作内容已全部自然播放结束。确认内容后输入 ${phrase}: `);
    if (answer.trim() !== phrase) throw new Error("explicit confirmation phrase did not match");
  } finally {
    prompt.close();
  }
  return { class: "interactive-post-playback-action", operatorPostPlaybackAttestationIncluded: true };
}

function selectBaseClip(baseRevision, bindingId, clipId) {
  const binding = baseRevision.bindings.find((candidate) => candidate.bindingId === bindingId);
  if (!binding) throw new Error(`${bindingId} is absent from the base FamilyRevision`);
  const clip = binding.clips.find((candidate) => candidate.clipId === clipId);
  if (!clip) throw new Error(`${clipId} is absent from ${bindingId}`);
  return { binding, clip };
}

function containedGoldenPath(portablePath, label) {
  const candidate = path.resolve(ALPHA_ROOT, ...portablePath.split("/"));
  if (!inside(ALPHA_ROOT, candidate)) throw new Error(`${label} escaped the golden asset root`);
  return candidate;
}

function compactPlaybackReceipts(sessionEvidence) {
  return sessionEvidence.playbackReceipts.map((receipt) => ({
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
}

async function importAuthoredSource({ sourcePath, ffprobe }) {
  const sourceIdentity = await sha256File(sourcePath);
  const contentTag = sourceIdentity.sha256.slice(0, 12);
  const importedAsset = await importCanonicalWav({
    sourcePath,
    assetId: `asset-family-authored-${contentTag}`,
    vaultRoot: path.join(RUN_ROOT, "asset-vault"),
    probeCanonicalWav: (filePath) => probeCanonicalWav({ ffprobe, filePath }),
  });
  if (importedAsset.sha256 !== sourceIdentity.sha256 || importedAsset.bytes !== sourceIdentity.bytes) {
    throw new Error("authoring source changed between selection and canonical import");
  }
  return Object.freeze({ importedAsset, contentTag: importedAsset.sha256.slice(0, 12) });
}

async function run(options) {
  await prepareRunRoot();
  if (String(process.env.SDL_AUDIODRIVER ?? "").toLowerCase() === "dummy") {
    throw new Error("SDL_AUDIODRIVER=dummy is outside the real host-audio evidence profile");
  }
  const [ffmpeg, ffprobe, ffplay, baseRevision, baseTarget, policy, contracts] = await Promise.all([
    resolvePinnedFfmpegTool({ repoRoot: REPO_ROOT, toolName: "ffmpeg" }),
    resolvePinnedFfmpegTool({ repoRoot: REPO_ROOT, toolName: "ffprobe" }),
    resolvePinnedFfmpegTool({ repoRoot: REPO_ROOT, toolName: "ffplay" }),
    readJson(path.join(FAMILY_ROOT, "family-revision.json")),
    readJson(path.join(FAMILY_ROOT, "build-plan.json")),
    readJson(path.join(TRUST_ROOT, "trust-policy.json")),
    loadConfirmationTrustSchemaValidator(REPO_ROOT),
  ]);
  let importedAsset;
  let contentTag;
  let captureReceipt = null;
  let sourceClass;
  if (options.recordDevice) {
    const capturePort = createDirectShowCapturePort({
      ffmpeg,
      ffprobe,
      captureRoot: path.join(RUN_ROOT, "capture-source"),
    });
    const captured = await captureCanonicalAudioAsset({
      capturePort,
      captureRequest: {
        deviceName: options.recordDevice,
        durationSeconds: options.recordSeconds,
      },
      importPort: ({ sourcePath }) => importAuthoredSource({ sourcePath, ffprobe }).then((result) => result.importedAsset),
    });
    importedAsset = captured.importedAsset;
    contentTag = importedAsset.sha256.slice(0, 12);
    captureReceipt = captured.captureReceipt;
    sourceClass = captureReceipt.sourceClass;
  } else {
    const sourcePath = options.sourcePath ?? path.join(ALPHA_ROOT, "assets", "clip-013-1.wav");
    ({ importedAsset, contentTag } = await importAuthoredSource({ sourcePath, ffprobe }));
    sourceClass = options.sourcePath ? "operator-selected-local-file" : "golden-fixture-file";
  }
  const sourceSelection = selectBaseClip(baseRevision, options.bindingId, options.clipId);
  const runToken = randomBytes(6).toString("hex");
  const repository = new MemoryFamilyRepository({ repositoryId: `FAMILY-REPO-REAL-AUTHORED-${runToken.toUpperCase()}` });
  const seededAt = utcNow();
  const seed = await repository.commit({
    operationId: `OP-REAL-AUTHORED-SEED-${runToken.toUpperCase()}`,
    revision: structuredClone(baseRevision),
    expectedHeadRevisionId: null,
    at: seededAt,
  });
  const authoredAt = utcNow();
  const committed = await commitImportedClipReplacement({
    repository,
    operationId: `OP-REAL-AUTHORED-COMMIT-${runToken.toUpperCase()}`,
    expectedHeadRevisionId: baseRevision.revisionId,
    createdAt: authoredAt,
    committedAt: utcNow(),
    contentRevision: `family-alpha-authored@${contentTag}`,
    bindingId: options.bindingId,
    clipId: options.clipId,
    importedAsset,
    clipMetadata: {
      sourceKind: "family-recording",
      transcript: options.transcript,
      mediaType: options.mediaType,
      language: options.language,
    },
    sourceProducer: { name: "yimi-companion-real-authoring", version: "1.0.0" },
  });
  const authoredClip = committed.revision.bindings
    .flatMap((binding) => binding.clips)
    .find((clip) => clip.clipId === options.clipId);

  const authoredTarget = extendFixtureTargetWithImportedAsset({
    baseTarget,
    importedAsset,
    buildPlanId: `PLAN-FAMILY-AUTHORED-${committed.revision.revisionId.slice(-12).toUpperCase()}`,
    requestedAt: utcNow(),
    assetCatalogRevisionRef: `asset-catalog:family-authored-${contentTag}`,
  });
  const buildPlan = await composeFixtureBuildPlan({
    familyRevision: committed.revision,
    pinnedFixtureTarget: authoredTarget,
  });
  const projected = await projectAndValidateBuildPlan({ familyRevision: committed.revision, buildPlan });

  const sourcePathByAssetId = new Map();
  for (const asset of buildPlan.assetCatalog.assets) {
    if (asset.assetId === importedAsset.assetId) {
      sourcePathByAssetId.set(asset.assetId, importedAsset.absolutePath);
      continue;
    }
    const baseAsset = baseTarget.assetCatalog.assets.find((candidate) => candidate.assetId === asset.assetId);
    if (!baseAsset) throw new Error(`${asset.assetId} has no pinned golden source`);
    sourcePathByAssetId.set(asset.assetId, containedGoldenPath(baseAsset.path, asset.assetId));
  }
  const verifiedBuildAssets = await verifyBuildPlanAssets({
    buildPlan,
    assetReader: ({ assetId }) => readFile(sourcePathByAssetId.get(assetId)),
  });
  const workspace = await materializeBuildPlanWorkspace({
    workspaceRoot: path.join(RUN_ROOT, "build-workspace"),
    buildPlan,
    projectedDraft: projected.draft,
    sourcePathByAssetId,
  });
  const { preview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath: workspace.draftPath });
  const clips = preview.bindings.flatMap((binding) => binding.clips);
  const previewAuthoredClip = clips.find((clip) => clip.clipId === options.clipId);
  const decodeReceipts = [];
  for (const clip of clips) {
    const resolved = await resolveVerifiedPreviewClip({ clip, assetRoot: workspace.workspace });
    const decoded = await decodeAudioToNull({ ffmpeg, filePath: resolved.absolutePath });
    decodeReceipts.push({ clipId: clip.clipId, sha256: clip.sha256, ...decoded });
  }

  const providerClock = mutableClock(utcNow());
  const provider = createConfirmationTrustProvider({
    policy,
    challengeStore: new MemoryChallengeStore(),
    clock: providerClock,
    nonceSource: () => randomBytes(16),
    authorityResolver: async () => structuredClone(policy.authorities[0]),
    contractValidator: contracts,
  });
  const backend = new FfplayAudioBackend({ ffplay, volume: options.volume });
  const playbackPort = createAudioPlayerPrelistenPort({ backend, defaultTimeoutMs: 60_000 });
  console.log(`Playing ${clips.length} authored preview clips through pinned ffplay...`);
  const verifiedPrelisten = await executeVerifiedPrelisten({
    provider,
    buildPlan,
    preview,
    familyLibraryId: committed.revision.familyLibraryId,
    authoritySessionRef: `real-authored-fixture-session:${runToken}`,
    issueOperationId: `op:real-authored-issue:${runToken}`,
    consumeOperationId: `op:real-authored-consume:${runToken}`,
    sessionId: `real-authored-prelisten:${runToken}`,
    clipResolver: (clip) => resolveVerifiedPreviewClip({ clip, assetRoot: workspace.workspace }),
    playbackPort,
    explicitConfirmationPort: () => requireExplicitConfirmation({
      runnerConfirm: options.runnerConfirm,
      previewId: preview.previewId,
    }),
    confirmationIdFactory: confirmationIdNow,
    proofFactory: ({ challenge, presentationTranscript, confirmation }) => {
      const issuedAt = utcNow();
      const expiresAt = new Date(Date.parse(issuedAt) + 120_000).toISOString();
      const proof = createFixtureProof({
        policy,
        challenge,
        presentationTranscript,
        confirmation,
        issuedAt,
        expiresAt,
      });
      providerClock.set(issuedAt);
      return proof;
    },
    contractValidator: contracts,
  });
  const {
    challenge,
    explicitAction,
    confirmed,
    proof,
    verificationResult,
    buildAuthorization,
    sessionEvidence,
  } = verifiedPrelisten;
  const playbackReceipts = compactPlaybackReceipts(sessionEvidence);

  const confirmationPath = path.join(RUN_ROOT, "confirmation.json");
  await writeFile(confirmationPath, `${JSON.stringify(confirmed.confirmation, null, 2)}\n`, { flag: "wx" });
  const snapshotDirectory = path.join(RUN_ROOT, "snapshot");
  const compileReport = await authorizedCompileDesignSnapshot({
    repoRoot: REPO_ROOT,
    familyRevision: committed.revision,
    buildPlan,
    projectedDraft: projected.draft,
    preview,
    confirmation: confirmed.confirmation,
    presentationTranscript: confirmed.transcript,
    proof,
    verificationResult,
    buildAuthorization,
    draftPath: workspace.draftPath,
    confirmationPath,
    now: verificationResult.consumedAt,
    outputDirectory: snapshotDirectory,
  });
  const [manifest, actions, compiledAuthoredBytes] = await Promise.all([
    readJson(path.join(snapshotDirectory, "manifest.json")),
    readJson(path.join(snapshotDirectory, "actions.json")),
    readFile(path.join(snapshotDirectory, "audio", `${options.clipId}.wav`)),
  ]);
  const compiledAuthoredClip = actions.clips.find((clip) => clip.clipId === options.clipId);
  const gates = {
    pinnedFfmpegSuiteVerified: [ffmpeg, ffprobe, ffplay].every((tool) => tool.suiteArchiveSha256 === PINNED_SUITE_SHA256),
    importedAssetCommittedToOneAuthoredRevision: seed.status === "committed"
      && committed.commit.status === "committed"
      && committed.revision.parentRevisionId === baseRevision.revisionId
      && authoredClip?.assetId === importedAsset.assetId
      && authoredClip?.assetSha256 === importedAsset.sha256
      && authoredClip?.assetBytes === importedAsset.bytes
      && sourceSelection.binding.bindingId === options.bindingId
      && sourceSelection.clip.clipId === options.clipId,
    authoredBuildPlanProjectionAndAssetsVerified: buildPlan.familyRevisionId === committed.revision.revisionId
      && buildPlan.expectedProjection.sourceSha256 === projected.projectionSha256
      && verifiedBuildAssets.length === buildPlan.assetCatalog.assets.length
      && workspace.copied.length === buildPlan.assetCatalog.assets.length,
    authoredPreviewReadsMaterializedIdentity: preview.sourceSha256 === projected.projectionSha256
      && previewAuthoredClip?.assetPath === importedAsset.contentPath
      && previewAuthoredClip?.bytes === importedAsset.bytes
      && previewAuthoredClip?.sha256 === importedAsset.sha256,
    everyAuthoredPreviewAssetFullyDecoded: decodeReceipts.length === clips.length
      && decodeReceipts.every((receipt) => receipt.exitCode === 0 && receipt.audioEndpointUsed === false),
    everyAuthoredPreviewClipReachedFfplayNaturalExit: playbackReceipts.length === clips.length
      && playbackReceipts.every((receipt, index) => receipt.exitCode === 0
        && receipt.completion === "natural-end"
        && receipt.expectedSha256 === clips[index].sha256
        && receipt.executableSha256 === ffplay.sha256),
    explicitConfirmationWasSeparatePostPlaybackAction: confirmed.transcript.events.at(-2)?.kind === "CLIP_PLAYBACK_COMPLETED"
      && confirmed.transcript.events.at(-1)?.kind === "CONFIRM_ACTION",
    verifiedAuthorizationBindsAuthoredRevisionAndPlan: verificationResult.verified === true
      && verificationResult.productionEligible === false
      && buildAuthorization.familyRevisionId === committed.revision.revisionId
      && buildAuthorization.buildPlanId === buildPlan.buildPlanId
      && buildAuthorization.presentationTranscriptSha256 === confirmed.transcript.transcriptSha256,
    authorizedCompilerProducedBoundDesignSnapshot: compileReport.snapshotId.startsWith("design:")
      && manifest.snapshotId === compileReport.snapshotId
      && manifest.contentRevision === committed.revision.contentRevision
      && compileReport.sourceSha256 === preview.sourceSha256
      && compileReport.confirmationId === confirmed.confirmation.confirmationId,
    compiledSnapshotCarriesExactAuthoredAudio: compiledAuthoredClip?.sha256 === importedAsset.sha256
      && compiledAuthoredClip?.size === importedAsset.bytes
      && compiledAuthoredBytes.length === importedAsset.bytes
      && sha256(compiledAuthoredBytes) === importedAsset.sha256,
  };
  const failures = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const report = {
    schemaVersion: 1,
    profile: "companion-real-authored-flow-host-evidence-v1",
    fixtureOnly: true,
    capturedAt: utcNow(),
    evidenceScope: {
      sourceClass,
      canonicalLocalImportIncluded: true,
      immutableRevisionCasIncluded: true,
      actualMicrophoneRecordingIncluded: captureReceipt !== null,
      temporaryCaptureSourceDiscarded: captureReceipt?.temporarySourceDiscarded ?? null,
      completeDecodeIncluded: true,
      actualPlaybackCallbackIncluded: true,
      hostAudioEndpointRequested: true,
      operatorPostPlaybackAttestationIncluded: explicitAction.operatorPostPlaybackAttestationIncluded,
      authenticatedGuardianIncluded: false,
      acousticLoopbackOrMicrophoneWitnessIncluded: false,
      productionAuthorityIncluded: false,
      targetDeviceAudioIncluded: false,
      targetDeviceInstallIncluded: false,
    },
    explicitActionClass: explicitAction.class,
    capture: captureReceipt,
    tools: [ffmpeg, ffprobe, ffplay].map((tool) => ({
      name: tool.name,
      version: tool.version,
      sha256: tool.sha256,
      suiteArchiveSha256: tool.suiteArchiveSha256,
    })),
    authoring: {
      baseRevisionId: baseRevision.revisionId,
      authoredRevisionId: committed.revision.revisionId,
      bindingId: options.bindingId,
      clipId: options.clipId,
      assetId: importedAsset.assetId,
      assetSha256: importedAsset.sha256,
      assetBytes: importedAsset.bytes,
      assetCodec: importedAsset.codec,
      transcript: options.transcript,
      language: options.language,
      mediaType: options.mediaType,
    },
    buildPlanId: buildPlan.buildPlanId,
    buildSubjectSha256: buildPlan.buildSubjectSha256,
    projectionSha256: projected.projectionSha256,
    previewId: preview.previewId,
    challengeId: challenge.challengeId,
    transcriptSha256: confirmed.transcript.transcriptSha256,
    proofId: proof.proofId,
    verificationId: verificationResult.verificationId,
    authorizationId: buildAuthorization.authorizationId,
    snapshotId: compileReport.snapshotId,
    decodeReceipts,
    playbackReceipts,
    gates,
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await Promise.all([
    writeFile(path.join(RUN_ROOT, "family-revision.json"), `${JSON.stringify(committed.revision, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "build-plan.json"), `${JSON.stringify(buildPlan, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "preview.json"), `${JSON.stringify(preview, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "presentation-transcript.json"), `${JSON.stringify(confirmed.transcript, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "verification-result.json"), `${JSON.stringify(verificationResult, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "build-authorization.json"), `${JSON.stringify(buildAuthorization, null, 2)}\n`, { flag: "wx" }),
    writeFile(path.join(RUN_ROOT, "report.json"), reportBytes, { flag: "wx" }),
  ]);
  console.log(`Real authored host flow: ${Object.keys(gates).length - failures.length}/${Object.keys(gates).length}`);
  console.log(`Authored FamilyRevision: ${committed.revision.revisionId}`);
  console.log(`Authored design Snapshot: ${compileReport.snapshotId}`);
  console.log(`Real authored report SHA-256: ${sha256(reportBytes)}`);
  if (failures.length) throw new Error(`real authored flow gates failed: ${failures.join(", ")}`);
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
