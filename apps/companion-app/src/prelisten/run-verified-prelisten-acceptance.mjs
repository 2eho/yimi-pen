import { createHash } from "node:crypto";
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
import { fileURLToPath } from "node:url";
import { buildPreview } from "../../../../tools/family-alpha-compiler/compiler.mjs";
import { createConfirmationTrustProvider } from "../../../../tools/confirmation-trust/provider.mjs";
import { MemoryChallengeStore } from "../../../../tools/confirmation-trust/replay-store.mjs";
import { loadConfirmationTrustSchemaValidator } from "../../../../tools/confirmation-trust/schema-validator.mjs";
import { createFixtureProof } from "../fixture-confirmation.mjs";
import { resolveVerifiedPreviewClip } from "./local-audio-assets.mjs";
import { executeVerifiedPrelisten } from "./verified-prelisten-use-case.mjs";

const APP_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "companion-verified-prelisten-validation");
const LOCK_PATH = path.join(BUILD_ROOT, ".companion-verified-prelisten-validation.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".companion-verified-prelisten-validation-root");
const MARKER_TEXT = "yimi-companion-verified-prelisten-validation-root-v1\n";
const ALPHA_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const FAMILY_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1/golden");
const TRUST_ROOT = path.join(REPO_ROOT, "hardware/evt0/confirmation-trust-v1/golden");
const OPENED_AT = "2026-08-04T03:00:01Z";
const CONFIRMED_AT = "2026-08-04T03:00:30Z";
const PROOF_ISSUED_AT = "2026-08-04T03:00:31Z";
const PROOF_EXPIRES_AT = "2026-08-04T03:02:31Z";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
    if (error?.code === "EEXIST") throw new Error("verified prelisten acceptance has an active or stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("verified prelisten root must be an owned directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("verified prelisten root escaped build/");
    if (await readFile(MARKER_PATH, "utf8") !== MARKER_TEXT) throw new Error("verified prelisten root lacks its ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { flag: "wx" });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function mutableClock(initial) {
  let value = initial;
  return { now: () => value, set: (next) => { value = next; } };
}

function presentationClock() {
  const values = [OPENED_AT, CONFIRMED_AT];
  return { now: () => values.shift() ?? CONFIRMED_AT };
}

function deterministicPlaybackPort(preview) {
  const clipOrder = preview.bindings.flatMap((binding) => binding.clips.map((clip) => clip.clipId));
  let index = 0;
  return Object.freeze({
    evidenceClass: "verified-prelisten-orchestration-fixture",
    async playToNaturalEnd({ sessionId, clip, resolvedUri }) {
      if (clip.clipId !== clipOrder[index]) throw new Error("verified prelisten changed clip order");
      index += 1;
      return Object.freeze({
        playbackId: `verified-prelisten:${index}`,
        backend: "verified-prelisten-orchestration-fixture",
        evidenceClass: "verified-prelisten-orchestration-fixture",
        generation: index,
        uri: resolvedUri,
        processId: null,
        executableSha256: null,
        startedAt: new Date(Date.parse(OPENED_AT) + index * 1_000 - 100).toISOString(),
        completedAt: new Date(Date.parse(OPENED_AT) + index * 1_000).toISOString(),
        elapsedMs: 100,
        completion: "natural-end",
        exitCode: 0,
        signal: null,
        sessionId,
        clipId: clip.clipId,
        expectedSha256: clip.sha256,
        expectedBytes: clip.bytes,
        requestedAt: OPENED_AT,
      });
    },
    async stop() {},
  });
}

function createProvider({ policy, contracts, store, providerClock, nonceHex }) {
  return createConfirmationTrustProvider({
    policy,
    challengeStore: store,
    clock: providerClock,
    nonceSource: () => Buffer.from(nonceHex, "hex"),
    authorityResolver: async () => structuredClone(policy.authorities[0]),
    contractValidator: contracts,
  });
}

async function run() {
  await prepareRunRoot();
  const [buildPlan, policy, contracts] = await Promise.all([
    readJson(path.join(FAMILY_ROOT, "build-plan.json")),
    readJson(path.join(TRUST_ROOT, "trust-policy.json")),
    loadConfirmationTrustSchemaValidator(REPO_ROOT),
  ]);
  const { preview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath: path.join(ALPHA_ROOT, "draft.json") });
  const store = new MemoryChallengeStore();
  const providerClock = mutableClock("2026-08-04T03:00:00Z");
  const provider = createProvider({
    policy,
    contracts,
    store,
    providerClock,
    nonceHex: "000102030405060708090a0b0c0d0e0f",
  });
  const order = [];
  const result = await executeVerifiedPrelisten({
    provider,
    buildPlan,
    preview,
    familyLibraryId: policy.authorities[0].familyLibraryId,
    authoritySessionRef: "verified-prelisten-acceptance-session",
    issueOperationId: "op:verified-prelisten-issue-001",
    consumeOperationId: "op:verified-prelisten-consume-001",
    sessionId: "verified-prelisten-acceptance-001",
    clipResolver: (clip) => resolveVerifiedPreviewClip({ clip, assetRoot: ALPHA_ROOT }),
    playbackPort: deterministicPlaybackPort(preview),
    explicitConfirmationPort: async ({ presentation }) => {
      order.push(`action:${presentation.state}:${presentation.completedClipCount}`);
      return { class: "deterministic-explicit-action", operatorPostPlaybackAttestationIncluded: false };
    },
    confirmationIdFactory: ({ presentation }) => {
      order.push(`confirmation-id:${presentation.state}`);
      return "CONF-VERIFIED-PRELISTEN-001";
    },
    proofFactory: ({ challenge, presentationTranscript, confirmation }) => {
      order.push(`proof:${presentationTranscript.events.at(-1)?.kind}`);
      providerClock.set(PROOF_ISSUED_AT);
      return createFixtureProof({
        policy,
        challenge,
        presentationTranscript,
        confirmation,
        issuedAt: PROOF_ISSUED_AT,
        expiresAt: PROOF_EXPIRES_AT,
      });
    },
    contractValidator: contracts,
    presentationClock: presentationClock(),
  });
  const ledger = await store.snapshot();

  const rejectedStore = new MemoryChallengeStore();
  const rejectedClock = mutableClock("2026-08-04T03:10:00Z");
  const rejectedProvider = createProvider({
    policy,
    contracts,
    store: rejectedStore,
    providerClock: rejectedClock,
    nonceHex: "101112131415161718191a1b1c1d1e1f",
  });
  let rejectedCode = null;
  try {
    await executeVerifiedPrelisten({
      provider: rejectedProvider,
      buildPlan,
      preview,
      familyLibraryId: policy.authorities[0].familyLibraryId,
      authoritySessionRef: "verified-prelisten-rejected-session",
      issueOperationId: "op:verified-prelisten-issue-rejected",
      consumeOperationId: "op:verified-prelisten-consume-rejected",
      sessionId: "verified-prelisten-rejected-001",
      clipResolver: (clip) => resolveVerifiedPreviewClip({ clip, assetRoot: ALPHA_ROOT }),
      playbackPort: deterministicPlaybackPort(preview),
      explicitConfirmationPort: async () => {
        const error = new Error("fixture guardian rejected the preview");
        error.code = "FIXTURE_CONFIRMATION_REJECTED";
        throw error;
      },
      confirmationIdFactory: () => "CONF-REJECTED-MUST-NOT-BE-USED",
      proofFactory: () => { throw new Error("proof factory must remain unused"); },
      contractValidator: contracts,
      presentationClock: presentationClock(),
    });
  } catch (error) {
    rejectedCode = error?.code ?? error?.name ?? "UNKNOWN";
  }
  const rejectedLedger = await rejectedStore.snapshot();

  const clips = preview.bindings.flatMap((binding) => binding.clips);
  const events = result.confirmed.transcript.events;
  const gates = {
    allRealFixtureAssetsResolvedAndPlayed: result.sessionEvidence.playbackReceipts.length === clips.length
      && result.sessionEvidence.playbackReceipts.every((receipt, index) => (
        receipt.clipId === clips[index].clipId
        && receipt.expectedSha256 === clips[index].sha256
        && receipt.completion === "natural-end"
      )),
    explicitActionOccursOnlyAfterReadyToConfirm: JSON.stringify(order.slice(0, 2))
      === JSON.stringify([`action:READY_TO_CONFIRM:${clips.length}`, "confirmation-id:READY_TO_CONFIRM"]),
    confirmationProofAndAuthorizationAreOneBoundChain: order.at(-1) === "proof:CONFIRM_ACTION"
      && events.at(-2)?.kind === "CLIP_PLAYBACK_COMPLETED"
      && events.at(-1)?.kind === "CONFIRM_ACTION"
      && result.verificationResult.verified === true
      && result.buildAuthorization.presentationTranscriptSha256 === result.confirmed.transcript.transcriptSha256
      && result.buildAuthorization.familyRevisionId === buildPlan.familyRevisionId,
    challengeConsumedExactlyOnce: ledger.revision === 2
      && ledger.challenges.length === 1
      && ledger.challenges[0]?.state === "CONSUMED"
      && ledger.challenges[0]?.operationJournal.length === 1,
    rejectedExplicitActionProducesNoConfirmationOrConsumption: rejectedCode === "FIXTURE_CONFIRMATION_REJECTED"
      && rejectedLedger.revision === 1
      && rejectedLedger.challenges.length === 1
      && rejectedLedger.challenges[0]?.state === "ISSUED"
      && rejectedLedger.challenges[0]?.operationJournal.length === 0,
  };
  const failures = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  const report = {
    schemaVersion: 1,
    profile: "companion-verified-prelisten-acceptance-v1",
    fixtureOnly: true,
    scope: {
      orchestrationOrder: true,
      actualFixtureAssetBytesResolved: true,
      deterministicNaturalEndPort: true,
      actualHostAudioEndpointUsed: false,
      authenticatedGuardianIncluded: false,
      targetDeviceAudioIncluded: false,
    },
    previewId: preview.previewId,
    challengeId: result.challenge.challengeId,
    transcriptSha256: result.confirmed.transcript.transcriptSha256,
    verificationId: result.verificationResult.verificationId,
    authorizationId: result.buildAuthorization.authorizationId,
    requiredClipCount: clips.length,
    playbackReceiptCount: result.sessionEvidence.playbackReceipts.length,
    rejectedCode,
    gates,
  };
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), bytes, { flag: "wx" });
  console.log(`Verified prelisten use-case acceptance: ${Object.keys(gates).length - failures.length}/${Object.keys(gates).length}`);
  console.log(`Verified prelisten use-case report SHA-256: ${sha256(bytes)}`);
  if (failures.length) throw new Error(`verified prelisten use-case gates failed: ${failures.join(", ")}`);
}

const lock = await acquireLock();
try {
  await run();
} finally {
  try { await lock.close(); } catch { /* result above remains authoritative */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* result above remains authoritative */ }
}
