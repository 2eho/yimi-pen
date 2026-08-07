import { createBuildAuthorizationFromVerification } from "../../../../contracts/family-build-plan-v1.mjs";
import { createPrelistenPresentationSession } from "./presentation-session.mjs";

export class VerifiedPrelistenUseCaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "VerifiedPrelistenUseCaseError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new VerifiedPrelistenUseCaseError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function assertPorts({
  provider,
  clipResolver,
  playbackPort,
  explicitConfirmationPort,
  confirmationIdFactory,
  proofFactory,
  contractValidator,
}) {
  assert(provider && typeof provider.issueChallenge === "function"
    && typeof provider.verifyAndConsume === "function",
  "VERIFIED_PRELISTEN_PROVIDER_PORT_INVALID",
  "verified prelisten requires challenge issuance and verification ports");
  assert(typeof clipResolver === "function",
    "VERIFIED_PRELISTEN_ASSET_PORT_INVALID", "verified prelisten requires a clip resolver port");
  assert(playbackPort && typeof playbackPort.playToNaturalEnd === "function",
    "VERIFIED_PRELISTEN_PLAYBACK_PORT_INVALID", "verified prelisten requires a natural-end playback port");
  assert(typeof explicitConfirmationPort === "function",
    "VERIFIED_PRELISTEN_CONFIRMATION_PORT_INVALID", "verified prelisten requires an explicit confirmation port");
  assert(typeof confirmationIdFactory === "function",
    "VERIFIED_PRELISTEN_CONFIRMATION_ID_PORT_INVALID", "verified prelisten requires a confirmation ID port");
  assert(typeof proofFactory === "function",
    "VERIFIED_PRELISTEN_PROOF_PORT_INVALID", "verified prelisten requires a confirmation proof port");
  assert(contractValidator && typeof contractValidator.validate === "function",
    "VERIFIED_PRELISTEN_CONTRACT_PORT_INVALID", "verified prelisten requires a contract validator port");
}

/**
 * Application use-case shared by host shells that need the same trust boundary:
 * every preview clip reaches a qualified natural end, then an explicit action
 * produces one confirmation, one consumed proof, and one BuildAuthorization.
 *
 * Asset resolution, playback, UI/CLI confirmation, authority, proof signing,
 * clock, and persistence stay injected ports. This module owns orchestration
 * order only; it does not duplicate presentation or trust semantics.
 */
export async function executeVerifiedPrelisten({
  provider,
  buildPlan,
  preview,
  familyLibraryId,
  authoritySessionRef,
  issueOperationId,
  consumeOperationId,
  sessionId,
  clipResolver,
  playbackPort,
  explicitConfirmationPort,
  confirmationIdFactory,
  proofFactory,
  contractValidator,
  productReleaseDecision = null,
  presentationClock = { now: () => new Date().toISOString() },
  playOptions = {},
}) {
  assertPorts({
    provider,
    clipResolver,
    playbackPort,
    explicitConfirmationPort,
    confirmationIdFactory,
    proofFactory,
    contractValidator,
  });
  assert(typeof sessionId === "string" && sessionId.length > 0,
    "VERIFIED_PRELISTEN_SESSION_INVALID", "verified prelisten sessionId is required");

  const challenge = await provider.issueChallenge({
    buildPlan,
    preview,
    familyLibraryId,
    authoritySessionRef,
    operationId: issueOperationId,
  });
  contractValidator.validate("challenge", challenge);

  const session = createPrelistenPresentationSession({
    sessionId,
    challenge,
    preview,
    clipResolver,
    playbackPort,
    clock: presentationClock,
  });
  session.open();
  await session.playAll(playOptions);
  const readyEvidence = session.snapshot();
  assert(readyEvidence.state === "READY_TO_CONFIRM"
    && readyEvidence.completedClipCount === readyEvidence.requiredClipCount,
  "VERIFIED_PRELISTEN_PRESENTATION_INCOMPLETE",
  "explicit confirmation requires every preview clip to reach natural end");

  const explicitAction = await explicitConfirmationPort(Object.freeze({
    challenge: clone(challenge),
    preview: clone(preview),
    presentation: clone(readyEvidence),
  }));
  assert(explicitAction && typeof explicitAction === "object" && !Array.isArray(explicitAction),
    "VERIFIED_PRELISTEN_CONFIRMATION_ACTION_INVALID",
    "explicit confirmation port must return action evidence");

  const confirmationId = await confirmationIdFactory(Object.freeze({
    challenge: clone(challenge),
    preview: clone(preview),
    presentation: clone(readyEvidence),
    explicitAction: clone(explicitAction),
  }));
  const confirmed = session.confirm({ confirmationId });
  contractValidator.validate("presentation-transcript", confirmed.transcript);
  contractValidator.validate("confirmation", confirmed.confirmation);

  const proof = await proofFactory(Object.freeze({
    challenge: clone(challenge),
    preview: clone(preview),
    presentationTranscript: clone(confirmed.transcript),
    confirmation: clone(confirmed.confirmation),
    explicitAction: clone(explicitAction),
  }));
  contractValidator.validate("proof", proof);
  const verificationResult = await provider.verifyAndConsume({
    proof,
    buildPlan,
    preview,
    presentationTranscript: confirmed.transcript,
    confirmation: confirmed.confirmation,
    operationId: consumeOperationId,
  });
  contractValidator.validate("verification-result", verificationResult);
  const buildAuthorization = createBuildAuthorizationFromVerification({
    verificationResult,
    proof,
    productReleaseDecision,
  });
  contractValidator.validate("build-authorization", buildAuthorization);

  return Object.freeze({
    challenge,
    explicitAction: clone(explicitAction),
    confirmed,
    proof,
    verificationResult,
    buildAuthorization,
    sessionEvidence: session.snapshot(),
  });
}
