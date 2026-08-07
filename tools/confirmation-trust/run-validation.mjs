import { createHash, createPrivateKey, sign } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";
import {
  confirmationSigningInput,
  computePresentationTranscriptSha256,
  computeProofId,
  computeTrustPolicyId,
  jwkThumbprintKid,
} from "../../contracts/confirmation-trust-v1.mjs";
import {
  computeBuildAuthorizationId,
  computeBuildSubjectSha256,
  createBuildAuthorizationFromVerification,
} from "../../contracts/family-build-plan-v1.mjs";
import { parseJsonRejectingDuplicateKeys } from "../../contracts/strict-json-v1.mjs";
import { createConfirmationTrustProvider } from "./provider.mjs";
import { AtomicJsonChallengeStore, MemoryChallengeStore } from "./replay-store.mjs";
import { loadConfirmationTrustSchemaValidator } from "./schema-validator.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "confirmation-trust-validation");
const LOCK_PATH = path.join(BUILD_ROOT, ".confirmation-trust-validation.lock");
const MARKER = path.join(RUN_ROOT, ".confirmation-trust-validation-root");
const MARKER_TEXT = "yimi-confirmation-trust-validation-root-v1\n";
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/confirmation-trust-v1");
const FAMILY_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1");
const ALPHA_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const GOLDEN_ROOT = path.join(CONTRACT_ROOT, "golden");
const FIXTURE_SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const FIXTURE_PUBLIC_X = Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex").toString("base64url");
const FIXED_NONCE = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
let runtimeContractValidator = null;

function clone(value) { return structuredClone(value); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function encode(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function inside(parent, child) { const relative = path.relative(parent, child); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); }

async function exists(target) {
  try { return await lstat(target); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  try { return await open(LOCK_PATH, "wx"); } catch (error) {
    if (error?.code === "EEXIST") throw new Error("confirmation trust validation is already running or left a stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("confirmation validation root must be an owned regular directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("confirmation validation root resolved outside build/");
    if (await readFile(MARKER, "utf8") !== MARKER_TEXT) throw new Error("confirmation validation root lacks exact ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER, MARKER_TEXT, { encoding: "utf8", flag: "wx" });
}

async function treeDigest(root) {
  const records = [];
  async function walk(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`validation tree contains symlink ${relative}`);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) records.push({ path: relative, bytes: (await readFile(absolute)).length, sha256: sha256(await readFile(absolute)) });
    }
  }
  await walk(root);
  return sha256(Buffer.from(JSON.stringify(records), "utf8"));
}

function mutableClock(initial) {
  let value = initial;
  return { now: () => value, set: (next) => { value = next; } };
}

function fixturePrivateKey() {
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return createPrivateKey({ key: Buffer.concat([pkcs8Prefix, FIXTURE_SEED]), format: "der", type: "pkcs8" });
}

function signProofClaims(claims) {
  return sign(null, confirmationSigningInput(claims), fixturePrivateKey()).toString("base64url");
}

function finalizeProof(claims) {
  const proof = {
    schemaVersion: 1,
    profile: "family-confirmation-proof-v1",
    proofId: "proof:sha256:pending",
    claims: clone(claims),
    signature: signProofClaims(claims),
  };
  proof.proofId = computeProofId(proof);
  return proof;
}

function buildPolicy({ keyState = "active", authorityState = "active", fixtureOnly = true } = {}) {
  const publicJwk = { kty: "OKP", crv: "Ed25519", x: FIXTURE_PUBLIC_X };
  const policy = {
    schemaVersion: 1,
    profile: "confirmation-trust-policy-v1",
    policyId: "policy:sha256:pending",
    fixtureOnly,
    providerId: "confirmation-trust-provider",
    signatureProfile: "Ed25519+JCS-prefix-v1",
    algorithm: "Ed25519",
    purpose: "snapshot-build",
    audience: "yimi-family-alpha-compiler",
    maxChallengeLifetimeSeconds: 900,
    maxProofLifetimeSeconds: 300,
    clockSkewSeconds: 30,
    keyring: [{
      kid: jwkThumbprintKid(publicJwk),
      algorithm: "Ed25519",
      publicJwk,
      state: keyState,
      notBefore: "2026-01-01T00:00:00Z",
      signUntil: "2027-01-01T00:00:00Z",
      verifyUntil: "2028-01-01T00:00:00Z",
    }],
    authorities: [{
      authorityRevisionId: `authority-revision:sha256:${"1".repeat(64)}`,
      guardianSubjectRef: `guardian:sha256:${"2".repeat(64)}`,
      familyLibraryId: "family-alpha-golden",
      role: "parent",
      state: authorityState,
      validFrom: "2026-01-01T00:00:00Z",
      authorizeUntil: "2027-01-01T00:00:00Z",
      verifyUntil: "2028-01-01T00:00:00Z",
    }],
  };
  policy.policyId = computeTrustPolicyId(policy);
  return policy;
}

function buildPresentation({ challenge, preview, confirmation }) {
  const clips = preview.bindings.flatMap((binding) => binding.clips);
  const events = [{
    sequence: 0,
    kind: "PREVIEW_OPENED",
    clipId: null,
    clipSha256: null,
    confirmationId: null,
    occurredAt: "2026-08-03T00:04:20Z",
  }];
  clips.forEach((clip, index) => events.push({
    sequence: index + 1,
    kind: "CLIP_PLAYBACK_COMPLETED",
    clipId: clip.clipId,
    clipSha256: clip.sha256,
    confirmationId: null,
    occurredAt: `2026-08-03T00:04:${String(22 + index * 2).padStart(2, "0")}Z`,
  }));
  events.push({
    sequence: events.length,
    kind: "CONFIRM_ACTION",
    clipId: null,
    clipSha256: null,
    confirmationId: confirmation.confirmationId,
    occurredAt: confirmation.confirmedAt,
  });
  const transcript = {
    schemaVersion: 1,
    profile: "family-confirmation-presentation-v1",
    transcriptSha256: "pending",
    buildPlanId: challenge.buildPlanId,
    buildSubjectSha256: challenge.buildSubjectSha256,
    previewId: challenge.previewId,
    sourceSha256: challenge.sourceSha256,
    presentationPolicyVersion: challenge.presentationPolicyVersion,
    challengeId: challenge.challengeId,
    openedAt: events[0].occurredAt,
    completedAt: events.at(-1).occurredAt,
    events,
  };
  transcript.transcriptSha256 = computePresentationTranscriptSha256(transcript);
  return transcript;
}

function buildClaims({ policy, challenge, transcript, confirmation, overrides = {} }) {
  return {
    type: "YIMI_CONFIRMATION_TRUST_V1",
    signatureProfile: "Ed25519+JCS-prefix-v1",
    algorithm: "Ed25519",
    issuerId: policy.providerId,
    kid: policy.keyring[0].kid,
    trustPolicyId: policy.policyId,
    fixtureOnly: challenge.fixtureOnly,
    purpose: policy.purpose,
    audience: policy.audience,
    familyLibraryId: challenge.familyLibraryId,
    familyRevisionId: challenge.familyRevisionId,
    buildPlanId: challenge.buildPlanId,
    buildSubjectSha256: challenge.buildSubjectSha256,
    previewId: challenge.previewId,
    sourceSha256: challenge.sourceSha256,
    presentationPolicyVersion: challenge.presentationPolicyVersion,
    presentationTranscriptSha256: transcript.transcriptSha256,
    confirmationId: confirmation.confirmationId,
    confirmationSemanticSha256: canonicalSha256(confirmation).sha256,
    decision: confirmation.decision,
    scope: confirmation.scope,
    guardianAuthority: clone(challenge.guardianAuthority),
    challengeId: challenge.challengeId,
    challengeNonce: challenge.challengeNonce,
    issuedAt: "2026-08-03T00:05:01Z",
    confirmedAt: confirmation.confirmedAt,
    expiresAt: "2026-08-03T00:10:01Z",
    ...overrides,
  };
}

async function loadBase() {
  const [buildPlan, preview, confirmation] = await Promise.all([
    readFile(path.join(FAMILY_ROOT, "golden/build-plan.json"), "utf8").then(JSON.parse),
    readFile(path.join(ALPHA_ROOT, "expected-preview.json"), "utf8").then(JSON.parse),
    readFile(path.join(ALPHA_ROOT, "confirmation.json"), "utf8").then(JSON.parse),
  ]);
  return { buildPlan, preview, confirmation };
}

async function fixtureContext(options = {}) {
  const base = await loadBase();
  const policy = buildPolicy(options);
  const store = options.store ?? new MemoryChallengeStore();
  const clock = options.clock ?? mutableClock("2026-08-03T00:04:10Z");
  const provider = createConfirmationTrustProvider({
    policy,
    challengeStore: store,
    clock,
    nonceSource: () => FIXED_NONCE,
    authorityResolver: async () => clone(policy.authorities[0]),
    contractValidator: options.contractValidator ?? runtimeContractValidator,
  });
  const challenge = await provider.issueChallenge({
    buildPlan: base.buildPlan,
    preview: base.preview,
    familyLibraryId: "family-alpha-golden",
    authoritySessionRef: "fixture-session",
    operationId: "op:fixture-issue-001",
  });
  const transcript = buildPresentation({ challenge, preview: base.preview, confirmation: base.confirmation });
  const claims = buildClaims({ policy, challenge, transcript, confirmation: base.confirmation });
  const proof = finalizeProof(claims);
  clock.set("2026-08-03T00:05:02Z");
  return { ...base, policy, store, clock, provider, challenge, transcript, proof };
}

async function loadValidators() {
  const contract = await loadConfirmationTrustSchemaValidator(REPO_ROOT);
  const names = [
    "trust-policy", "challenge", "presentation-transcript", "proof", "verification-result",
    "replay-ledger", "evidence-lock", "build-plan", "build-authorization", "preview", "confirmation",
  ];
  return { contract, ...Object.fromEntries(names.map((name) => [name, contract.validator(name)])) };
}

function requireSchema(validator, value, label) {
  if (!validator(value)) {
    const errors = validator.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`${label} schema failed: ${errors}`);
  }
}

async function compareOrWriteGolden(name, value, write) {
  const bytes = encode(value);
  const destination = path.join(GOLDEN_ROOT, `${name}.json`);
  if (write) {
    await mkdir(GOLDEN_ROOT, { recursive: true });
    await writeFile(destination, bytes);
    return true;
  }
  return bytes.equals(await readFile(destination));
}

async function runNegative(id, expectedCode, mutate, contextOptions = {}) {
  const context = await fixtureContext(contextOptions);
  const beforeLedger = JSON.stringify(await context.store.snapshot());
  const beforeTree = await treeDigest(RUN_ROOT);
  let actualCode = null;
  let succeeded = false;
  try {
    const input = {
      proof: clone(context.proof),
      buildPlan: clone(context.buildPlan),
      preview: clone(context.preview),
      presentationTranscript: clone(context.transcript),
      confirmation: clone(context.confirmation),
      operationId: `op:${id.toLowerCase()}`,
    };
    await mutate(input, context);
    await context.provider.verifyAndConsume(input);
    succeeded = true;
  } catch (error) {
    actualCode = error?.code ?? error?.name ?? "UNKNOWN";
  }
  const afterLedger = JSON.stringify(await context.store.snapshot());
  const afterTree = await treeDigest(RUN_ROOT);
  const zeroSideEffect = beforeLedger === afterLedger && beforeTree === afterTree;
  return { id, passed: !succeeded && actualCode === expectedCode && zeroSideEffect, expectedCode, actualCode, zeroSideEffect };
}

async function run() {
  await prepareRunRoot();
  const write = process.argv.includes("--write");
  const validators = await loadValidators();
  runtimeContractValidator = validators.contract;
  const evidenceLockBytes = await readFile(path.join(CONTRACT_ROOT, "evidence-lock.json"));
  const evidenceLock = JSON.parse(evidenceLockBytes.toString("utf8"));
  requireSchema(validators["evidence-lock"], evidenceLock, "confirmation evidence lock");
  const expectedEvidenceSources = [
    "rfc7517", "rfc7519", "rfc7638", "rfc8032", "rfc8037", "rfc8410",
    "rfc8725", "rfc8785", "rfc9278", "rfc9449", "node-v24.18.1-crypto",
  ];
  const evidenceSourceIds = evidenceLock.sources.map((source) => source.sourceId);
  const evidenceLockValid = JSON.stringify(evidenceSourceIds) === JSON.stringify(expectedEvidenceSources)
    && new Set(evidenceSourceIds).size === evidenceSourceIds.length;
  const context = await fixtureContext();
  requireSchema(validators["build-plan"], context.buildPlan, "BuildPlan");
  requireSchema(validators["trust-policy"], context.policy, "trust policy");
  requireSchema(validators.challenge, context.challenge, "challenge");
  requireSchema(validators["presentation-transcript"], context.transcript, "presentation transcript");
  requireSchema(validators.proof, context.proof, "proof");
  const result = await context.provider.verifyAndConsume({
    proof: context.proof,
    buildPlan: context.buildPlan,
    preview: context.preview,
    presentationTranscript: context.transcript,
    confirmation: context.confirmation,
    operationId: "op:fixture-consume-001",
  });
  requireSchema(validators["verification-result"], result, "verification result");
  const authorization = createBuildAuthorizationFromVerification({ verificationResult: result, proof: context.proof });
  requireSchema(validators["build-authorization"], authorization, "BuildAuthorization");

  const goldenValues = {
    "trust-policy": context.policy,
    challenge: context.challenge,
    "presentation-transcript": context.transcript,
    proof: context.proof,
    "verification-result": result,
    "build-authorization": authorization,
  };
  const goldenChecks = Object.fromEntries(await Promise.all(Object.entries(goldenValues).map(async ([name, value]) => [name, await compareOrWriteGolden(name, value, write)])));

  const retry = await context.provider.verifyAndConsume({
    proof: clone(context.proof), buildPlan: clone(context.buildPlan), preview: clone(context.preview),
    presentationTranscript: clone(context.transcript), confirmation: clone(context.confirmation), operationId: "op:fixture-retry-001",
  });
  const idempotentRetry = retry.verificationId === result.verificationId;

  const atomicPath = path.join(RUN_ROOT, "atomic-replay-ledger.json");
  const atomicContext = await fixtureContext({ store: new AtomicJsonChallengeStore(atomicPath) });
  const atomicResult = await atomicContext.provider.verifyAndConsume({
    proof: atomicContext.proof, buildPlan: atomicContext.buildPlan, preview: atomicContext.preview,
    presentationTranscript: atomicContext.transcript, confirmation: atomicContext.confirmation, operationId: "op:atomic-consume-001",
  });
  const reopenedStore = new AtomicJsonChallengeStore(atomicPath);
  const reopenedClock = mutableClock("2026-08-03T00:05:03Z");
  const reopenedProvider = createConfirmationTrustProvider({
    policy: atomicContext.policy, challengeStore: reopenedStore, clock: reopenedClock,
    nonceSource: () => FIXED_NONCE, authorityResolver: async () => clone(atomicContext.policy.authorities[0]),
    contractValidator: runtimeContractValidator,
  });
  const recoveredResult = await reopenedProvider.verifyAndConsume({
    proof: atomicContext.proof, buildPlan: atomicContext.buildPlan, preview: atomicContext.preview,
    presentationTranscript: atomicContext.transcript, confirmation: atomicContext.confirmation, operationId: "op:atomic-retry-001",
  });
  const atomicRecovery = atomicResult.verificationId === recoveredResult.verificationId;
  requireSchema(validators["replay-ledger"], await reopenedStore.snapshot(), "atomic replay ledger");

  const negatives = [];
  negatives.push(await runNegative("NEG-01-signature", "CONFIRMATION_SIGNATURE_INVALID", async (input) => {
    const signature = Buffer.from(input.proof.signature, "base64url");
    signature[0] ^= 0x01;
    input.proof.signature = signature.toString("base64url");
    input.proof.proofId = computeProofId(input.proof);
  }));
  negatives.push(await runNegative("NEG-02-proof-id", "CONFIRMATION_PROOF_TAMPERED", async (input) => { input.proof.proofId = `proof:sha256:${"0".repeat(64)}`; }));
  negatives.push(await runNegative("NEG-03-build-subject", "CONFIRMATION_BUILD_SUBJECT_MISMATCH", async (input) => {
    input.buildPlan.targetProfile.boardTarget = "DIFFERENT";
    input.buildPlan.buildSubjectSha256 = computeBuildSubjectSha256(input.buildPlan);
  }));
  negatives.push(await runNegative("NEG-04-preview", "CONFIRMATION_PREVIEW_MISMATCH", async (input) => { input.preview.previewId = `sha256:${"0".repeat(64)}`; }));
  negatives.push(await runNegative("NEG-05-presentation-missing", "CONFIRMATION_PRESENTATION_INCOMPLETE", async (input) => {
    input.presentationTranscript.events.splice(2, 1);
    input.presentationTranscript.events.forEach((event, index) => { event.sequence = index; });
    input.presentationTranscript.transcriptSha256 = computePresentationTranscriptSha256(input.presentationTranscript);
    input.proof.claims.presentationTranscriptSha256 = input.presentationTranscript.transcriptSha256;
    input.proof = finalizeProof(input.proof.claims);
  }));
  negatives.push(await runNegative("NEG-06-expired", "CONFIRMATION_EXPIRED", async (_input, ctx) => { ctx.clock.set(ctx.proof.claims.expiresAt); }));
  negatives.push(await runNegative("NEG-07-unknown-kid", "CONFIRMATION_KEY_UNKNOWN", async (input) => {
    input.proof.claims.kid = `urn:ietf:params:oauth:jwk-thumbprint:sha-256:${"A".repeat(43)}`;
    input.proof = finalizeProof(input.proof.claims);
  }));
  negatives.push(await runNegative("NEG-08-audience", "CONFIRMATION_MALFORMED", async (input) => {
    input.proof.claims.audience = "different-audience";
    input.proof = finalizeProof(input.proof.claims);
  }));
  negatives.push(await runNegative("NEG-09-nonce", "CONFIRMATION_REPLAY_CONFLICT", async (input) => {
    input.proof.claims.challengeNonce = Buffer.alloc(16, 9).toString("base64url");
    input.proof = finalizeProof(input.proof.claims);
  }));
  negatives.push(await runNegative("NEG-10-fixture-boundary", "CONFIRMATION_PROFILE_UNSUPPORTED", async (input) => {
    input.proof.claims.fixtureOnly = false;
    input.proof = finalizeProof(input.proof.claims);
  }));
  negatives.push(await runNegative("NEG-11-confirmation-hash", "CONFIRMATION_PROOF_TAMPERED", async (input) => {
    input.proof.claims.confirmationSemanticSha256 = "0".repeat(64);
    input.proof = finalizeProof(input.proof.claims);
  }));
  negatives.push(await runNegative("NEG-12-future-issued", "CONFIRMATION_TIME_INVALID", async (input) => {
    input.proof.claims.issuedAt = "2026-08-03T00:06:00Z";
    input.proof.claims.expiresAt = "2026-08-03T00:10:00Z";
    input.proof = finalizeProof(input.proof.claims);
  }));
  negatives.push(await runNegative("NEG-13-clip-hash", "CONFIRMATION_PRESENTATION_INCOMPLETE", async (input) => {
    const event = input.presentationTranscript.events.find((candidate) => candidate.kind === "CLIP_PLAYBACK_COMPLETED");
    event.clipSha256 = "0".repeat(64);
    input.presentationTranscript.transcriptSha256 = computePresentationTranscriptSha256(input.presentationTranscript);
    input.proof.claims.presentationTranscriptSha256 = input.presentationTranscript.transcriptSha256;
    input.proof = finalizeProof(input.proof.claims);
  }));

  let duplicateRejected = false;
  try { parseJsonRejectingDuplicateKeys('{"claims":{},"claims":{}}', "proof fixture"); } catch (error) { duplicateRejected = error?.code === "ERR_STRICT_JSON_DUPLICATE_KEY"; }
  negatives.push({ id: "NEG-14-duplicate-key", passed: duplicateRejected, expectedCode: "ERR_STRICT_JSON_DUPLICATE_KEY", actualCode: duplicateRejected ? "ERR_STRICT_JSON_DUPLICATE_KEY" : null, zeroSideEffect: true });

  const replayContext = await fixtureContext();
  const winner = await replayContext.provider.verifyAndConsume({
    proof: replayContext.proof, buildPlan: replayContext.buildPlan, preview: replayContext.preview,
    presentationTranscript: replayContext.transcript, confirmation: replayContext.confirmation, operationId: "op:replay-winner-001",
  });
  const alternateClaims = buildClaims({
    policy: replayContext.policy, challenge: replayContext.challenge, transcript: replayContext.transcript,
    confirmation: replayContext.confirmation, overrides: { issuedAt: "2026-08-03T00:05:02Z", expiresAt: "2026-08-03T00:10:02Z" },
  });
  const alternateProof = finalizeProof(alternateClaims);
  const beforeReplayConflict = JSON.stringify(await replayContext.store.snapshot());
  let replayConflict = false;
  try {
    await replayContext.provider.verifyAndConsume({
      proof: alternateProof, buildPlan: replayContext.buildPlan, preview: replayContext.preview,
      presentationTranscript: replayContext.transcript, confirmation: replayContext.confirmation, operationId: "op:replay-loser-001",
    });
  } catch (error) { replayConflict = error?.code === "CONFIRMATION_REPLAY_CONFLICT"; }
  const replayConflictZeroSideEffect = beforeReplayConflict === JSON.stringify(await replayContext.store.snapshot());
  negatives.push({ id: "NEG-15-replay-conflict", passed: replayConflict && replayConflictZeroSideEffect, expectedCode: "CONFIRMATION_REPLAY_CONFLICT", actualCode: replayConflict ? "CONFIRMATION_REPLAY_CONFLICT" : null, zeroSideEffect: replayConflictZeroSideEffect });
  negatives.push(await runNegative("NEG-16-revoked-key", "CONFIRMATION_KEY_REVOKED", async () => {}, { keyState: "revoked" }));
  negatives.push(await runNegative("NEG-17-unknown-authority", "CONFIRMATION_AUTHORITY_DENIED", async (input) => {
    input.proof.claims.guardianAuthority.authorityRevisionId = `authority-revision:sha256:${"3".repeat(64)}`;
    input.proof = finalizeProof(input.proof.claims);
  }));

  const retiredContext = await fixtureContext({ keyState: "retired" });
  const retiredResult = await retiredContext.provider.verifyAndConsume({
    proof: retiredContext.proof, buildPlan: retiredContext.buildPlan, preview: retiredContext.preview,
    presentationTranscript: retiredContext.transcript, confirmation: retiredContext.confirmation, operationId: "op:retired-key-verify-001",
  });
  const retiredKeyVerifiesOldProof = retiredResult.verified === true;

  const concurrentContext = await fixtureContext();
  const concurrentAlternate = finalizeProof(buildClaims({
    policy: concurrentContext.policy,
    challenge: concurrentContext.challenge,
    transcript: concurrentContext.transcript,
    confirmation: concurrentContext.confirmation,
    overrides: { issuedAt: "2026-08-03T00:05:02Z", expiresAt: "2026-08-03T00:10:02Z" },
  }));
  const concurrentResults = await Promise.allSettled([
    concurrentContext.provider.verifyAndConsume({
      proof: concurrentContext.proof, buildPlan: concurrentContext.buildPlan, preview: concurrentContext.preview,
      presentationTranscript: concurrentContext.transcript, confirmation: concurrentContext.confirmation, operationId: "op:concurrent-a-001",
    }),
    concurrentContext.provider.verifyAndConsume({
      proof: concurrentAlternate, buildPlan: concurrentContext.buildPlan, preview: concurrentContext.preview,
      presentationTranscript: concurrentContext.transcript, confirmation: concurrentContext.confirmation, operationId: "op:concurrent-b-001",
    }),
  ]);
  const concurrentSingleWinner = concurrentResults.filter((entry) => entry.status === "fulfilled").length === 1
    && concurrentResults.filter((entry) => entry.status === "rejected" && entry.reason?.code === "CONFIRMATION_REPLAY_CONFLICT").length === 1
    && (await concurrentContext.store.snapshot()).challenges[0].state === "CONSUMED";

  const negativePassed = negatives.filter((scenario) => scenario.passed).length;
  const zeroSideEffect = negatives.filter((scenario) => scenario.zeroSideEffect).length;
  const gates = {
    buildPlanIdentityValid: computeBuildSubjectSha256(context.buildPlan) === context.buildPlan.buildSubjectSha256,
    buildPlanConfirmationFree: !("confirmation" in context.buildPlan),
    trustPolicySchemaValid: true,
    evidenceLockValid,
    challengeSchemaValid: true,
    presentationSchemaValid: true,
    proofSchemaValid: true,
    proofSignatureVerified: result.verified,
    fixtureProofNotProductionEligible: result.productionEligible === false,
    verificationSchemaValid: true,
    authorizationSchemaValid: true,
    authorizationIdentityValid: computeBuildAuthorizationId(authorization) === authorization.authorizationId,
    fixtureAuthorizationHasNoProductReleaseClaim: authorization.productReleaseDecisionId === null,
    goldenByteExact: Object.values(goldenChecks).every(Boolean),
    idempotentRetry,
    atomicRecovery,
    retiredKeyVerifiesOldProof,
    concurrentSingleWinner,
    replayConflict,
    replayConflictZeroSideEffect,
    negativesPassed: negativePassed === negatives.length,
    negativeFailuresZeroSideEffect: zeroSideEffect === negatives.length,
  };
  const report = {
    schemaVersion: 1,
    profile: "confirmation-trust-validation-v1",
    signingProfile: {
      algorithm: "Ed25519",
      canonicalization: "RFC8785",
      domain: "org.yimi.pen/family-confirmation-proof/v1\\0",
      kid: context.policy.keyring[0].kid,
      fixtureKeySource: "RFC8032-TEST-1",
      evidenceLockSha256: sha256(evidenceLockBytes),
      productionPrivateKeyPersisted: false,
    },
    contract: {
      buildPlanId: context.buildPlan.buildPlanId,
      buildSubjectSha256: context.buildPlan.buildSubjectSha256,
      challengeId: context.challenge.challengeId,
      proofId: context.proof.proofId,
      verificationId: result.verificationId,
      authorizationId: authorization.authorizationId,
    },
    gates,
    goldenChecks,
    negativeSummary: { total: negatives.length, passed: negativePassed, zeroSideEffect },
    negativeScenarios: negatives,
    evidenceBoundary: {
      fixtureOnly: true,
      productReleaseGateClosed: true,
      productionAuthorityConnected: false,
      productionKeyConnected: false,
      productionReceiptCreated: false,
    },
  };
  const reportBytes = encode(report);
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes, { flag: "wx" });
  console.log(`Confirmation trust golden: ${Object.values(goldenChecks).every(Boolean) ? "BYTE-EXACT" : "DRIFT"}`);
  console.log(`Confirmation trust negatives: ${negativePassed}/${negatives.length}; zero-side-effect ${zeroSideEffect}/${negatives.length}`);
  console.log(`Confirmation trust report SHA-256: ${sha256(reportBytes)}`);
  if (!Object.values(gates).every(Boolean)) process.exitCode = 1;
}

const lock = await acquireLock();
try { await run(); } finally {
  try { await lock.close(); } catch { /* preserve validation result */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* preserve validation result */ }
}
