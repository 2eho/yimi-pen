import { canonicalSha256 } from "../scripts/snapshot-jcs.mjs";

export function computeBuildSubjectSha256(buildPlan) {
  const { buildSubjectSha256: _identity, ...subject } = buildPlan;
  return canonicalSha256(subject).sha256;
}

export function assertBuildPlanIdentity(buildPlan) {
  if (buildPlan.buildSubjectSha256 !== computeBuildSubjectSha256(buildPlan)) {
    throw new Error("BuildPlan semantic identity mismatch");
  }
  return buildPlan;
}

export function computeBuildAuthorizationId(authorization) {
  const { authorizationId: _identity, ...subject } = authorization;
  return `authorization:sha256:${canonicalSha256(subject).sha256}`;
}

export function assertBuildAuthorizationIdentity(authorization) {
  if (authorization.authorizationId !== computeBuildAuthorizationId(authorization)) {
    throw new Error("BuildAuthorization semantic identity mismatch");
  }
  return authorization;
}

export function createBuildAuthorizationFromVerification({
  verificationResult,
  proof,
  productReleaseDecision = null,
}) {
  if (verificationResult?.verified !== true || verificationResult.proofId !== proof?.proofId) {
    throw new Error("BuildAuthorization requires a matching verified confirmation proof");
  }
  const productionEligible = verificationResult.productionEligible === true;
  if (productionEligible && productReleaseDecision?.releaseReady !== true) {
    throw new Error("production BuildAuthorization requires a ready product ReleaseDecision");
  }
  const binding = verificationResult.binding;
  const authorization = {
    schemaVersion: 1,
    profile: "family-build-authorization-v1",
    fixtureOnly: !productionEligible,
    authorizationId: "authorization:sha256:pending",
    buildPlanId: binding.buildPlanId,
    buildSubjectSha256: binding.buildSubjectSha256,
    familyRevisionId: binding.familyRevisionId,
    confirmationId: binding.confirmationId,
    confirmationSemanticSha256: binding.confirmationSemanticSha256,
    confirmationProofId: verificationResult.proofId,
    presentationTranscriptSha256: binding.presentationTranscriptSha256,
    providerVerificationId: verificationResult.verificationId,
    trustPolicyId: verificationResult.trustPolicyId,
    productReleaseDecisionId: productionEligible ? productReleaseDecision.decisionId : null,
    productReleaseSubjectRevisionSha256: productionEligible
      ? productReleaseDecision.releaseSubject.subjectRevisionSha256
      : null,
    authorizedAt: verificationResult.consumedAt,
    authorizationExpiresAt: proof.claims.expiresAt,
  };
  authorization.authorizationId = computeBuildAuthorizationId(authorization);
  return authorization;
}
