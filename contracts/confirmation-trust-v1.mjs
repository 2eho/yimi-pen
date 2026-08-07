import { createHash } from "node:crypto";
import { canonicalSha256, canonicalize } from "../scripts/snapshot-jcs.mjs";
import { isStrictRfc3339 } from "./rfc3339.mjs";
import { assertBuildPlanIdentity } from "./family-build-plan-v1.mjs";

export const CONFIRMATION_SIGNING_DOMAIN = Buffer.from(
  "org.yimi.pen/family-confirmation-proof/v1\0",
  "ascii",
);
export const CONFIRMATION_SIGNATURE_PROFILE = "Ed25519+JCS-prefix-v1";
export const CONFIRMATION_ALGORITHM = "Ed25519";
export const CONFIRMATION_PROOF_TYPE = "YIMI_CONFIRMATION_TRUST_V1";
export const CONFIRMATION_PURPOSE = "snapshot-build";
export const CONFIRMATION_AUDIENCE = "yimi-family-alpha-compiler";

export class ConfirmationTrustError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ConfirmationTrustError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new ConfirmationTrustError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function identityWithout(value, key) {
  const { [key]: _ignored, ...identity } = value;
  return identity;
}

function sha256Base64url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function parseTime(value, label, code = "CONFIRMATION_TIME_INVALID") {
  assert(isStrictRfc3339(value), code, `${label} must be strict RFC3339`, { label, value });
  return Date.parse(value);
}

function assertUnique(values, label, code = "CONFIRMATION_POLICY_INVALID") {
  const seen = new Set();
  for (const value of values) {
    assert(!seen.has(value), code, `${label} must be unique`, { label, value });
    seen.add(value);
  }
}

export function decodeBase64url(value, label, expectedBytes = null) {
  assert(
    typeof value === "string" && /^[A-Za-z0-9_-]+$/u.test(value),
    "CONFIRMATION_MALFORMED",
    `${label} must be unpadded base64url`,
    { label },
  );
  const bytes = Buffer.from(value, "base64url");
  assert(bytes.toString("base64url") === value, "CONFIRMATION_MALFORMED", `${label} is not canonical base64url`, { label });
  if (expectedBytes !== null) {
    assert(bytes.length === expectedBytes, "CONFIRMATION_MALFORMED", `${label} has an invalid byte length`, {
      label,
      expectedBytes,
      actualBytes: bytes.length,
    });
  }
  return bytes;
}

export function jwkThumbprintKid(publicJwk) {
  assert(
    publicJwk?.kty === "OKP" && publicJwk?.crv === "Ed25519" && typeof publicJwk?.x === "string",
    "CONFIRMATION_POLICY_INVALID",
    "trusted public key must be an Ed25519 public JWK",
  );
  decodeBase64url(publicJwk.x, "publicJwk.x", 32);
  const thumbprintInput = canonicalize({ crv: "Ed25519", kty: "OKP", x: publicJwk.x });
  return `urn:ietf:params:oauth:jwk-thumbprint:sha-256:${sha256Base64url(Buffer.from(thumbprintInput, "utf8"))}`;
}

export function computeTrustPolicyId(policy) {
  return `policy:sha256:${canonicalSha256(identityWithout(policy, "policyId")).sha256}`;
}

export function computeChallengeId(challenge) {
  return `challenge:sha256:${canonicalSha256(identityWithout(challenge, "challengeId")).sha256}`;
}

export function computePresentationTranscriptSha256(transcript) {
  return canonicalSha256(identityWithout(transcript, "transcriptSha256")).sha256;
}

export function computeProofId(proof) {
  return `proof:sha256:${canonicalSha256(identityWithout(proof, "proofId")).sha256}`;
}

export function computeVerificationId(result) {
  return `verification:sha256:${canonicalSha256(identityWithout(result, "verificationId")).sha256}`;
}

export function confirmationSigningInput(claims) {
  return Buffer.concat([
    CONFIRMATION_SIGNING_DOMAIN,
    Buffer.from(canonicalize(claims), "utf8"),
  ]);
}

export function assertTrustPolicySemantics(policy) {
  assert(policy?.schemaVersion === 1 && policy?.profile === "confirmation-trust-policy-v1", "CONFIRMATION_PROFILE_UNSUPPORTED", "trust policy profile is unsupported");
  assert(policy?.policyId === computeTrustPolicyId(policy), "CONFIRMATION_POLICY_INVALID", "trust policy identity mismatch");
  assert(policy.signatureProfile === CONFIRMATION_SIGNATURE_PROFILE, "CONFIRMATION_PROFILE_UNSUPPORTED", "trust policy signature profile is unsupported");
  assert(policy.algorithm === CONFIRMATION_ALGORITHM, "CONFIRMATION_PROFILE_UNSUPPORTED", "trust policy algorithm is unsupported");
  assert(policy.purpose === CONFIRMATION_PURPOSE, "CONFIRMATION_PROFILE_UNSUPPORTED", "trust policy purpose is unsupported");
  assert(policy.audience === CONFIRMATION_AUDIENCE, "CONFIRMATION_PROFILE_UNSUPPORTED", "trust policy audience is unsupported");
  assert(Number.isInteger(policy.maxChallengeLifetimeSeconds) && policy.maxChallengeLifetimeSeconds > 0, "CONFIRMATION_POLICY_INVALID", "challenge lifetime must be positive");
  assert(Number.isInteger(policy.maxProofLifetimeSeconds) && policy.maxProofLifetimeSeconds > 0, "CONFIRMATION_POLICY_INVALID", "proof lifetime must be positive");
  assert(Number.isInteger(policy.clockSkewSeconds) && policy.clockSkewSeconds >= 0, "CONFIRMATION_POLICY_INVALID", "clock skew must be non-negative");

  assert(Array.isArray(policy.keyring) && policy.keyring.length > 0, "CONFIRMATION_POLICY_INVALID", "trust policy keyring is empty");
  assertUnique(policy.keyring.map((entry) => entry.kid), "keyring kid");
  for (const key of policy.keyring) {
    assert(key.algorithm === CONFIRMATION_ALGORITHM, "CONFIRMATION_POLICY_INVALID", "key algorithm is unsupported", { kid: key.kid });
    assert(key.kid === jwkThumbprintKid(key.publicJwk), "CONFIRMATION_POLICY_INVALID", "key kid differs from its RFC 7638 thumbprint", { kid: key.kid });
    const notBefore = parseTime(key.notBefore, "key.notBefore", "CONFIRMATION_POLICY_INVALID");
    const signUntil = parseTime(key.signUntil, "key.signUntil", "CONFIRMATION_POLICY_INVALID");
    const verifyUntil = parseTime(key.verifyUntil, "key.verifyUntil", "CONFIRMATION_POLICY_INVALID");
    assert(notBefore < signUntil && signUntil <= verifyUntil, "CONFIRMATION_POLICY_INVALID", "key validity window is invalid", { kid: key.kid });
  }

  assert(Array.isArray(policy.authorities) && policy.authorities.length > 0, "CONFIRMATION_POLICY_INVALID", "trust policy authority set is empty");
  assertUnique(policy.authorities.map((entry) => entry.authorityRevisionId), "authorityRevisionId");
  for (const authority of policy.authorities) {
    const validFrom = parseTime(authority.validFrom, "authority.validFrom", "CONFIRMATION_POLICY_INVALID");
    const authorizeUntil = parseTime(authority.authorizeUntil, "authority.authorizeUntil", "CONFIRMATION_POLICY_INVALID");
    const verifyUntil = parseTime(authority.verifyUntil, "authority.verifyUntil", "CONFIRMATION_POLICY_INVALID");
    assert(validFrom < authorizeUntil && authorizeUntil <= verifyUntil, "CONFIRMATION_POLICY_INVALID", "authority validity window is invalid", {
      authorityRevisionId: authority.authorityRevisionId,
    });
  }
  return policy;
}

export function assertChallengeSemantics(challenge, policy) {
  assert(challenge?.schemaVersion === 1 && challenge?.profile === "confirmation-trust-challenge-v1", "CONFIRMATION_PROFILE_UNSUPPORTED", "challenge profile is unsupported");
  assert(challenge?.challengeId === computeChallengeId(challenge), "CONFIRMATION_PROOF_TAMPERED", "challenge identity mismatch");
  decodeBase64url(challenge.challengeNonce, "challengeNonce", 16);
  const issuedAt = parseTime(challenge.issuedAt, "challenge.issuedAt");
  const expiresAt = parseTime(challenge.expiresAt, "challenge.expiresAt");
  assert(issuedAt < expiresAt, "CONFIRMATION_TIME_INVALID", "challenge expiry must follow issuance");
  assert(
    expiresAt - issuedAt <= policy.maxChallengeLifetimeSeconds * 1000,
    "CONFIRMATION_TIME_INVALID",
    "challenge lifetime exceeds trust policy",
  );
  return challenge;
}

export function assertPresentationTranscript({ transcript, challenge, preview }) {
  assert(transcript?.schemaVersion === 1 && transcript?.profile === "family-confirmation-presentation-v1", "CONFIRMATION_PROFILE_UNSUPPORTED", "presentation transcript profile is unsupported");
  assert(
    transcript?.transcriptSha256 === computePresentationTranscriptSha256(transcript),
    "CONFIRMATION_PROOF_TAMPERED",
    "presentation transcript identity mismatch",
  );
  const bindings = [
    [transcript.buildPlanId, challenge.buildPlanId, "buildPlanId"],
    [transcript.buildSubjectSha256, challenge.buildSubjectSha256, "buildSubjectSha256"],
    [transcript.previewId, challenge.previewId, "previewId"],
    [transcript.sourceSha256, challenge.sourceSha256, "sourceSha256"],
    [transcript.presentationPolicyVersion, challenge.presentationPolicyVersion, "presentationPolicyVersion"],
    [transcript.challengeId, challenge.challengeId, "challengeId"],
  ];
  for (const [actual, expected, label] of bindings) {
    assert(actual === expected, "CONFIRMATION_PRESENTATION_MISMATCH", `presentation ${label} differs from challenge`, { label });
  }
  assert(preview.previewId === challenge.previewId, "CONFIRMATION_PREVIEW_MISMATCH", "preview differs from challenge");
  assert(preview.sourceSha256 === challenge.sourceSha256, "CONFIRMATION_SOURCE_MISMATCH", "preview source differs from challenge");
  assert(preview.presentationPolicyVersion === challenge.presentationPolicyVersion, "CONFIRMATION_POLICY_MISMATCH", "preview policy differs from challenge");

  assert(Array.isArray(transcript.events) && transcript.events.length >= 3, "CONFIRMATION_PRESENTATION_INCOMPLETE", "presentation event list is incomplete");
  const expectedClips = preview.bindings.flatMap((binding) => binding.clips.map((clip) => ({ clipId: clip.clipId, clipSha256: clip.sha256 })));
  const playbackEvents = transcript.events.filter((event) => event.kind === "CLIP_PLAYBACK_COMPLETED");
  assert(playbackEvents.length === expectedClips.length, "CONFIRMATION_PRESENTATION_INCOMPLETE", "presentation did not complete every preview clip", {
    expected: expectedClips.length,
    actual: playbackEvents.length,
  });
  for (let index = 0; index < expectedClips.length; index += 1) {
    assert(
      playbackEvents[index].clipId === expectedClips[index].clipId
        && playbackEvents[index].clipSha256 === expectedClips[index].clipSha256,
      "CONFIRMATION_PRESENTATION_INCOMPLETE",
      "presentation clip order or identity differs from preview",
      { index },
    );
  }
  assert(transcript.events[0].kind === "PREVIEW_OPENED", "CONFIRMATION_PRESENTATION_INCOMPLETE", "presentation must start by opening the preview");
  assert(transcript.events.at(-1).kind === "CONFIRM_ACTION", "CONFIRMATION_PRESENTATION_INCOMPLETE", "presentation must end with explicit confirmation");
  assert(
    transcript.events.every((event, index) => event.sequence === index),
    "CONFIRMATION_PRESENTATION_INCOMPLETE",
    "presentation sequence must be contiguous and zero based",
  );
  const eventTimes = transcript.events.map((event) => parseTime(event.occurredAt, "presentation event occurredAt"));
  assert(eventTimes.every((time, index) => index === 0 || eventTimes[index - 1] <= time), "CONFIRMATION_TIME_INVALID", "presentation timestamps are not monotonic");
  assert(transcript.openedAt === transcript.events[0].occurredAt, "CONFIRMATION_TIME_INVALID", "openedAt differs from first presentation event");
  assert(transcript.completedAt === transcript.events.at(-1).occurredAt, "CONFIRMATION_TIME_INVALID", "completedAt differs from confirmation event");
  const challengeIssuedAt = parseTime(challenge.issuedAt, "challenge.issuedAt");
  const challengeExpiresAt = parseTime(challenge.expiresAt, "challenge.expiresAt");
  assert(eventTimes[0] >= challengeIssuedAt && eventTimes.at(-1) < challengeExpiresAt, "CONFIRMATION_TIME_INVALID", "presentation falls outside challenge lifetime");
  return transcript;
}

function assertConfirmation({ confirmation, challenge, transcript }) {
  assert(confirmation.previewId === challenge.previewId, "CONFIRMATION_PREVIEW_MISMATCH", "confirmation preview differs from challenge");
  assert(confirmation.sourceSha256 === challenge.sourceSha256, "CONFIRMATION_SOURCE_MISMATCH", "confirmation source differs from challenge");
  assert(confirmation.policyVersion === challenge.presentationPolicyVersion, "CONFIRMATION_POLICY_MISMATCH", "confirmation policy differs from challenge");
  assert(confirmation.guardianRole === challenge.guardianAuthority.role, "CONFIRMATION_AUTHORITY_DENIED", "confirmation role differs from trusted challenge authority");
  assert(confirmation.fixtureOnly === challenge.fixtureOnly, "CONFIRMATION_PROFILE_UNSUPPORTED", "confirmation fixture boundary differs from challenge");
  assert(confirmation.confirmedAt === transcript.completedAt, "CONFIRMATION_TIME_INVALID", "confirmation time differs from presentation completion");
  return canonicalSha256(confirmation).sha256;
}

function selectTrustedKey(policy, claims, nowMs) {
  const key = policy.keyring.find((entry) => entry.kid === claims.kid);
  assert(key, "CONFIRMATION_KEY_UNKNOWN", "proof names an unknown trusted key", { kid: claims.kid });
  assert(key.state !== "revoked", "CONFIRMATION_KEY_REVOKED", "proof key is revoked", { kid: claims.kid });
  const issuedAt = parseTime(claims.issuedAt, "proof issuedAt");
  const notBefore = parseTime(key.notBefore, "key.notBefore", "CONFIRMATION_POLICY_INVALID");
  const signUntil = parseTime(key.signUntil, "key.signUntil", "CONFIRMATION_POLICY_INVALID");
  const verifyUntil = parseTime(key.verifyUntil, "key.verifyUntil", "CONFIRMATION_POLICY_INVALID");
  assert(issuedAt >= notBefore && issuedAt < signUntil, "CONFIRMATION_TIME_INVALID", "proof was issued outside the key signing window", { kid: key.kid });
  assert(nowMs < verifyUntil, "CONFIRMATION_KEY_EXPIRED", "trusted key verification window has ended", { kid: key.kid });
  return key;
}

function selectTrustedAuthority(policy, claims, challenge, nowMs) {
  const expected = challenge.guardianAuthority;
  const authority = policy.authorities.find((entry) => entry.authorityRevisionId === claims.guardianAuthority.authorityRevisionId);
  assert(authority, "CONFIRMATION_AUTHORITY_DENIED", "proof authority revision is not trusted");
  assert(authority.state !== "revoked", "CONFIRMATION_AUTHORITY_REVOKED", "proof authority revision is revoked");
  for (const field of ["authorityRevisionId", "guardianSubjectRef", "familyLibraryId", "role"]) {
    const claimValue = field === "familyLibraryId" ? claims.familyLibraryId : claims.guardianAuthority[field];
    const challengeValue = field === "familyLibraryId" ? challenge.familyLibraryId : expected[field];
    assert(claimValue === authority[field] && claimValue === challengeValue, "CONFIRMATION_AUTHORITY_DENIED", `trusted authority ${field} binding differs`, { field });
  }
  const confirmedAt = parseTime(claims.confirmedAt, "proof confirmedAt");
  const validFrom = parseTime(authority.validFrom, "authority.validFrom", "CONFIRMATION_POLICY_INVALID");
  const authorizeUntil = parseTime(authority.authorizeUntil, "authority.authorizeUntil", "CONFIRMATION_POLICY_INVALID");
  const verifyUntil = parseTime(authority.verifyUntil, "authority.verifyUntil", "CONFIRMATION_POLICY_INVALID");
  assert(confirmedAt >= validFrom && confirmedAt < authorizeUntil, "CONFIRMATION_AUTHORITY_STALE", "confirmation occurred outside the authority grant window");
  assert(nowMs < verifyUntil, "CONFIRMATION_AUTHORITY_STALE", "authority verification window has ended");
  return authority;
}

export async function verifyConfirmationProof({
  proof,
  policy,
  challenge,
  presentationTranscript,
  confirmation,
  buildPlan,
  preview,
  now,
  signatureVerifier,
}) {
  assertTrustPolicySemantics(policy);
  assertBuildPlanIdentity(buildPlan);
  assertChallengeSemantics(challenge, policy);
  assertPresentationTranscript({ transcript: presentationTranscript, challenge, preview });
  assert(typeof signatureVerifier === "function", "CONFIRMATION_PROVIDER_MISCONFIGURED", "signature verifier port is required");
  assert(proof?.proofId === computeProofId(proof), "CONFIRMATION_PROOF_TAMPERED", "proof identity mismatch");
  assert(proof?.schemaVersion === 1 && proof?.profile === "family-confirmation-proof-v1", "CONFIRMATION_PROFILE_UNSUPPORTED", "proof envelope profile is unsupported");
  const claims = proof.claims;
  assert(claims?.type === CONFIRMATION_PROOF_TYPE, "CONFIRMATION_PROFILE_UNSUPPORTED", "proof type is unsupported");
  assert(claims.signatureProfile === CONFIRMATION_SIGNATURE_PROFILE, "CONFIRMATION_PROFILE_UNSUPPORTED", "proof signature profile is unsupported");
  assert(claims.algorithm === CONFIRMATION_ALGORITHM, "CONFIRMATION_PROFILE_UNSUPPORTED", "proof algorithm is unsupported");
  assert(claims.issuerId === policy.providerId, "CONFIRMATION_ISSUER_UNTRUSTED", "proof issuer differs from trust policy");
  assert(claims.trustPolicyId === policy.policyId, "CONFIRMATION_POLICY_MISMATCH", "proof trust policy binding differs");
  assert(claims.purpose === CONFIRMATION_PURPOSE && claims.purpose === policy.purpose, "CONFIRMATION_PROFILE_UNSUPPORTED", "proof purpose is unsupported");
  assert(claims.audience === CONFIRMATION_AUDIENCE && claims.audience === policy.audience, "CONFIRMATION_PROFILE_UNSUPPORTED", "proof audience is unsupported");

  const buildBindings = [
    [claims.buildPlanId, buildPlan.buildPlanId, "buildPlanId", "CONFIRMATION_BUILD_SUBJECT_MISMATCH"],
    [claims.buildSubjectSha256, buildPlan.buildSubjectSha256, "buildSubjectSha256", "CONFIRMATION_BUILD_SUBJECT_MISMATCH"],
    [claims.familyRevisionId, buildPlan.familyRevisionId, "familyRevisionId", "CONFIRMATION_FAMILY_REVISION_MISMATCH"],
    [claims.buildPlanId, challenge.buildPlanId, "challenge buildPlanId", "CONFIRMATION_BUILD_SUBJECT_MISMATCH"],
    [claims.buildSubjectSha256, challenge.buildSubjectSha256, "challenge buildSubjectSha256", "CONFIRMATION_BUILD_SUBJECT_MISMATCH"],
    [claims.previewId, challenge.previewId, "previewId", "CONFIRMATION_PREVIEW_MISMATCH"],
    [claims.sourceSha256, challenge.sourceSha256, "sourceSha256", "CONFIRMATION_SOURCE_MISMATCH"],
    [claims.presentationPolicyVersion, challenge.presentationPolicyVersion, "presentationPolicyVersion", "CONFIRMATION_POLICY_MISMATCH"],
    [claims.challengeId, challenge.challengeId, "challengeId", "CONFIRMATION_REPLAY_CONFLICT"],
    [claims.challengeNonce, challenge.challengeNonce, "challengeNonce", "CONFIRMATION_REPLAY_CONFLICT"],
  ];
  for (const [actual, expected, label, code] of buildBindings) {
    assert(actual === expected, code, `proof ${label} binding differs`, { label });
  }
  assert(claims.familyLibraryId === challenge.familyLibraryId, "CONFIRMATION_AUTHORITY_DENIED", "proof family library differs from challenge");
  assert(claims.fixtureOnly === challenge.fixtureOnly, "CONFIRMATION_PROFILE_UNSUPPORTED", "proof fixture boundary differs from challenge");
  assert((buildPlan.outputMode === "design-fixture") === claims.fixtureOnly, "CONFIRMATION_PROFILE_UNSUPPORTED", "proof fixture boundary differs from BuildPlan mode");
  assert(claims.presentationTranscriptSha256 === presentationTranscript.transcriptSha256, "CONFIRMATION_PRESENTATION_MISMATCH", "proof presentation transcript binding differs");

  const confirmationSemanticSha256 = assertConfirmation({ confirmation, challenge, transcript: presentationTranscript });
  assert(claims.confirmationId === confirmation.confirmationId, "CONFIRMATION_PROOF_TAMPERED", "proof confirmation ID differs");
  assert(claims.confirmationSemanticSha256 === confirmationSemanticSha256, "CONFIRMATION_PROOF_TAMPERED", "proof confirmation semantic hash differs");
  assert(claims.decision === confirmation.decision && claims.scope === confirmation.scope, "CONFIRMATION_PROOF_TAMPERED", "proof confirmation decision or scope differs");

  const nowMs = parseTime(now, "trusted now");
  const issuedAt = parseTime(claims.issuedAt, "proof issuedAt");
  const confirmedAt = parseTime(claims.confirmedAt, "proof confirmedAt");
  const expiresAt = parseTime(claims.expiresAt, "proof expiresAt");
  const challengeIssuedAt = parseTime(challenge.issuedAt, "challenge.issuedAt");
  const challengeExpiresAt = parseTime(challenge.expiresAt, "challenge.expiresAt");
  assert(claims.confirmedAt === confirmation.confirmedAt, "CONFIRMATION_TIME_INVALID", "proof confirmation time differs from confirmation statement");
  assert(challengeIssuedAt <= confirmedAt && confirmedAt <= issuedAt, "CONFIRMATION_TIME_INVALID", "proof time order is invalid");
  assert(issuedAt < expiresAt && expiresAt <= challengeExpiresAt, "CONFIRMATION_TIME_INVALID", "proof expiry falls outside challenge lifetime");
  assert(expiresAt - issuedAt <= policy.maxProofLifetimeSeconds * 1000, "CONFIRMATION_TIME_INVALID", "proof lifetime exceeds trust policy");
  assert(issuedAt <= nowMs + policy.clockSkewSeconds * 1000, "CONFIRMATION_TIME_INVALID", "proof issuance is too far in the future");
  assert(nowMs < expiresAt, "CONFIRMATION_EXPIRED", "proof is expired");

  const key = selectTrustedKey(policy, claims, nowMs);
  const authority = selectTrustedAuthority(policy, claims, challenge, nowMs);
  const signature = decodeBase64url(proof.signature, "proof.signature", 64);
  const signingInput = confirmationSigningInput(claims);
  const signatureValid = await signatureVerifier({
    algorithm: CONFIRMATION_ALGORITHM,
    signatureProfile: CONFIRMATION_SIGNATURE_PROFILE,
    signingInput,
    signature,
    publicJwk: structuredClone(key.publicJwk),
    kid: key.kid,
  });
  assert(signatureValid === true, "CONFIRMATION_SIGNATURE_INVALID", "proof signature verification failed");
  return {
    productionEligible: policy.fixtureOnly === false && claims.fixtureOnly === false,
    key: structuredClone(key),
    authority: structuredClone(authority),
    confirmationSemanticSha256,
  };
}

export function createVerificationResult({ proof, operationId, consumedAt, productionEligible }) {
  const claims = proof.claims;
  const result = {
    schemaVersion: 1,
    profile: "confirmation-trust-verification-result-v1",
    verificationId: "verification:sha256:pending",
    operationId,
    verified: true,
    productionEligible,
    proofId: proof.proofId,
    trustPolicyId: claims.trustPolicyId,
    issuerId: claims.issuerId,
    kid: claims.kid,
    challengeId: claims.challengeId,
    consumedAt,
    binding: {
      familyLibraryId: claims.familyLibraryId,
      familyRevisionId: claims.familyRevisionId,
      buildPlanId: claims.buildPlanId,
      buildSubjectSha256: claims.buildSubjectSha256,
      confirmationId: claims.confirmationId,
      confirmationSemanticSha256: claims.confirmationSemanticSha256,
      previewId: claims.previewId,
      sourceSha256: claims.sourceSha256,
      presentationTranscriptSha256: claims.presentationTranscriptSha256,
      guardianSubjectRef: claims.guardianAuthority.guardianSubjectRef,
      authorityRevisionId: claims.guardianAuthority.authorityRevisionId,
      guardianRole: claims.guardianAuthority.role,
    },
  };
  result.verificationId = computeVerificationId(result);
  return result;
}
