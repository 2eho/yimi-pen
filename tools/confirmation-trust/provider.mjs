import { randomBytes } from "node:crypto";
import {
  ConfirmationTrustError,
  assertChallengeSemantics,
  assertTrustPolicySemantics,
  computeChallengeId,
  createVerificationResult,
  verifyConfirmationProof,
} from "../../contracts/confirmation-trust-v1.mjs";
import { assertBuildPlanIdentity } from "../../contracts/family-build-plan-v1.mjs";
import { isStrictRfc3339 } from "../../contracts/rfc3339.mjs";
import { verifyEd25519JcsPrefix } from "./ed25519-verifier.mjs";

function fail(code, message, details = {}) {
  throw new ConfirmationTrustError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function formatUtc(milliseconds) {
  return new Date(milliseconds).toISOString().replace(/\.000Z$/u, "Z");
}

function trustedNow(clock) {
  const value = clock.now();
  assert(isStrictRfc3339(value), "CONFIRMATION_PROVIDER_MISCONFIGURED", "trusted clock returned a non-RFC3339 timestamp");
  return value;
}

function resolveAuthorityFromPolicy(policy, resolved, familyLibraryId, now) {
  const authority = policy.authorities.find((candidate) => candidate.authorityRevisionId === resolved?.authorityRevisionId);
  assert(authority, "CONFIRMATION_AUTHORITY_DENIED", "authority resolver returned an untrusted revision");
  for (const field of ["guardianSubjectRef", "role"]) {
    assert(resolved[field] === authority[field], "CONFIRMATION_AUTHORITY_DENIED", `authority resolver ${field} differs from trust policy`, { field });
  }
  assert(authority.familyLibraryId === familyLibraryId, "CONFIRMATION_AUTHORITY_DENIED", "authority is outside the requested family library");
  assert(authority.state === "active", "CONFIRMATION_AUTHORITY_STALE", "authority is not active for challenge issuance");
  const nowMs = Date.parse(now);
  assert(nowMs >= Date.parse(authority.validFrom) && nowMs < Date.parse(authority.authorizeUntil), "CONFIRMATION_AUTHORITY_STALE", "authority is outside its issuance window");
  return authority;
}

export function createConfirmationTrustProvider({
  policy,
  challengeStore,
  authorityResolver,
  clock,
  nonceSource = () => randomBytes(16),
  signatureVerifier = verifyEd25519JcsPrefix,
  contractValidator,
}) {
  assert(contractValidator && typeof contractValidator.validate === "function", "CONFIRMATION_PROVIDER_MISCONFIGURED", "confirmation contract validator port is required");
  contractValidator.validate("trust-policy", policy);
  assertTrustPolicySemantics(policy);
  assert(challengeStore && typeof challengeStore.issue === "function" && typeof challengeStore.get === "function" && typeof challengeStore.consume === "function", "CONFIRMATION_PROVIDER_MISCONFIGURED", "challenge store port is incomplete");
  assert(typeof authorityResolver === "function", "CONFIRMATION_PROVIDER_MISCONFIGURED", "authority resolver port is required");
  assert(clock && typeof clock.now === "function", "CONFIRMATION_PROVIDER_MISCONFIGURED", "trusted clock port is required");
  assert(typeof nonceSource === "function", "CONFIRMATION_PROVIDER_MISCONFIGURED", "nonce source port is required");

  return Object.freeze({
    async issueChallenge({ buildPlan, preview, familyLibraryId, authoritySessionRef, operationId }) {
      contractValidator.validate("build-plan", buildPlan);
      contractValidator.validate("preview", preview);
      assertBuildPlanIdentity(buildPlan);
      assert(typeof familyLibraryId === "string" && familyLibraryId.length > 0, "CONFIRMATION_MALFORMED", "familyLibraryId is required");
      assert(preview?.sourceSha256 === buildPlan.expectedProjection.sourceSha256, "CONFIRMATION_SOURCE_MISMATCH", "preview source differs from BuildPlan projection");
      assert(preview?.presentationPolicyVersion === "family-alpha-v1", "CONFIRMATION_POLICY_MISMATCH", "preview presentation policy is unsupported");
      const fixtureOnly = buildPlan.outputMode === "design-fixture";
      assert(preview?.fixtureOnly === fixtureOnly, "CONFIRMATION_PROFILE_UNSUPPORTED", "preview fixture boundary differs from BuildPlan mode");
      const issuedAt = trustedNow(clock);
      const resolvedAuthority = await authorityResolver({
        authoritySessionRef,
        familyLibraryId,
        familyRevisionId: buildPlan.familyRevisionId,
        at: issuedAt,
      });
      const authority = resolveAuthorityFromPolicy(policy, resolvedAuthority, familyLibraryId, issuedAt);
      const nonce = Buffer.from(await nonceSource());
      assert(nonce.length === 16, "CONFIRMATION_PROVIDER_MISCONFIGURED", "nonce source must return exactly 128 bits");
      const challenge = {
        schemaVersion: 1,
        profile: "confirmation-trust-challenge-v1",
        challengeId: "challenge:sha256:pending",
        challengeNonce: nonce.toString("base64url"),
        fixtureOnly,
        buildPlanId: buildPlan.buildPlanId,
        buildSubjectSha256: buildPlan.buildSubjectSha256,
        familyLibraryId,
        familyRevisionId: buildPlan.familyRevisionId,
        previewId: preview.previewId,
        sourceSha256: preview.sourceSha256,
        presentationPolicyVersion: preview.presentationPolicyVersion,
        guardianAuthority: {
          authorityRevisionId: authority.authorityRevisionId,
          guardianSubjectRef: authority.guardianSubjectRef,
          role: authority.role,
        },
        issuedAt,
        expiresAt: formatUtc(Date.parse(issuedAt) + policy.maxChallengeLifetimeSeconds * 1000),
      };
      challenge.challengeId = computeChallengeId(challenge);
      assertChallengeSemantics(challenge, policy);
      contractValidator.validate("challenge", challenge);
      return challengeStore.issue({ challenge, operationId });
    },

    async verifyAndConsume({
      proof,
      buildPlan,
      preview,
      presentationTranscript,
      confirmation,
      operationId,
    }) {
      contractValidator.validate("proof", proof);
      contractValidator.validate("build-plan", buildPlan);
      contractValidator.validate("preview", preview);
      contractValidator.validate("presentation-transcript", presentationTranscript);
      contractValidator.validate("confirmation", confirmation);
      const record = await challengeStore.get(proof?.claims?.challengeId);
      assert(record, "CONFIRMATION_REPLAY_CONFLICT", "proof challenge is not present in the replay store");
      contractValidator.validate("challenge", record.challenge);
      const now = trustedNow(clock);
      const verified = await verifyConfirmationProof({
        proof,
        policy,
        challenge: record.challenge,
        presentationTranscript,
        confirmation,
        buildPlan,
        preview,
        now,
        signatureVerifier,
      });
      const result = createVerificationResult({
        proof,
        operationId,
        consumedAt: now,
        productionEligible: verified.productionEligible,
      });
      contractValidator.validate("verification-result", result);
      return challengeStore.consume({
        challengeId: record.challenge.challengeId,
        operationId,
        proofId: proof.proofId,
        buildSubjectSha256: buildPlan.buildSubjectSha256,
        consumedAt: now,
        verificationResult: result,
      });
    },
  });
}
