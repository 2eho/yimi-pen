export const PRODUCTION_CONFIRMATION_TRUST_GATE_ID = "RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED";

export async function verifyGateSpecificReceipt({
  receipt,
  artifactReader,
  productionConfirmationTrustVerifier = null,
}) {
  if (receipt.gateId !== PRODUCTION_CONFIRMATION_TRUST_GATE_ID) {
    return { profile: "generic-artifact-verification-v1", verified: true };
  }
  if (typeof productionConfirmationTrustVerifier !== "function") {
    throw new Error(`${PRODUCTION_CONFIRMATION_TRUST_GATE_ID} requires a configured gate-specific production verifier`);
  }
  const qualification = receipt.artifacts.find((artifact) => artifact.role === "provider-qualification");
  if (!qualification) throw new Error(`${PRODUCTION_CONFIRMATION_TRUST_GATE_ID} lacks provider-qualification evidence`);
  const artifactBytes = Buffer.from(await artifactReader(qualification.path));
  const result = await productionConfirmationTrustVerifier({ receipt: structuredClone(receipt), artifactBytes });
  if (
    result?.profile !== "production-confirmation-provider-qualification-v1"
    || result?.verified !== true
    || result?.fixtureOnly !== false
    || result?.releaseSubjectRevisionSha256 !== receipt.releaseSubject.subjectRevisionSha256
  ) {
    throw new Error(`${PRODUCTION_CONFIRMATION_TRUST_GATE_ID} gate-specific verification failed`);
  }
  return structuredClone(result);
}
