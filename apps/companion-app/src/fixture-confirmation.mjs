import { createPrivateKey, sign } from "node:crypto";
import { canonicalSha256 } from "../../../scripts/snapshot-jcs.mjs";
import {
  confirmationSigningInput,
  computePresentationTranscriptSha256,
  computeProofId,
} from "../../../contracts/confirmation-trust-v1.mjs";

const FIXTURE_SEED = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex",
);

function clone(value) {
  return structuredClone(value);
}

function fixturePrivateKey() {
  const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, FIXTURE_SEED]),
    format: "der",
    type: "pkcs8",
  });
}

export function createCompletePresentation({ challenge, preview, confirmation }) {
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

export function createFixtureProof({
  policy,
  challenge,
  presentationTranscript,
  confirmation,
  issuedAt = "2026-08-03T00:05:01Z",
  expiresAt = "2026-08-03T00:10:01Z",
}) {
  const claims = {
    type: "YIMI_CONFIRMATION_TRUST_V1",
    signatureProfile: policy.signatureProfile,
    algorithm: policy.algorithm,
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
    presentationTranscriptSha256: presentationTranscript.transcriptSha256,
    confirmationId: confirmation.confirmationId,
    confirmationSemanticSha256: canonicalSha256(confirmation).sha256,
    decision: confirmation.decision,
    scope: confirmation.scope,
    guardianAuthority: clone(challenge.guardianAuthority),
    challengeId: challenge.challengeId,
    challengeNonce: challenge.challengeNonce,
    issuedAt,
    confirmedAt: confirmation.confirmedAt,
    expiresAt,
  };
  const proof = {
    schemaVersion: 1,
    profile: "family-confirmation-proof-v1",
    proofId: "proof:sha256:pending",
    claims,
    signature: sign(null, confirmationSigningInput(claims), fixturePrivateKey()).toString("base64url"),
  };
  proof.proofId = computeProofId(proof);
  return proof;
}

export function omitOneRequiredClip(transcript) {
  const incomplete = clone(transcript);
  const index = incomplete.events.findIndex((event) => event.kind === "CLIP_PLAYBACK_COMPLETED");
  incomplete.events.splice(index, 1);
  incomplete.events.forEach((event, sequence) => { event.sequence = sequence; });
  incomplete.transcriptSha256 = computePresentationTranscriptSha256(incomplete);
  return incomplete;
}
