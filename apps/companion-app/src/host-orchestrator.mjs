import { canonicalSha256 } from "../../../scripts/snapshot-jcs.mjs";
import {
  computePresentationTranscriptSha256,
  computeProofId,
} from "../../../contracts/confirmation-trust-v1.mjs";
import {
  assertBuildAuthorizationIdentity,
  assertBuildPlanIdentity,
  createBuildAuthorizationFromVerification,
} from "../../../contracts/family-build-plan-v1.mjs";
import {
  finalizeBuildPlanProjection,
  projectCompileDraftFromPlan,
} from "../../../tools/family-build-adapter/adapter.mjs";
import { compileSnapshot } from "../../../tools/family-alpha-compiler/compiler.mjs";
import { loadConfirmationTrustSchemaValidator } from "../../../tools/confirmation-trust/schema-validator.mjs";

function clone(value) {
  return structuredClone(value);
}

function fail(code, message) {
  const error = new Error(message);
  error.name = "AuthorizedCompileError";
  error.code = code;
  throw error;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Compose a confirmation-free design BuildPlan from a target-neutral revision
 * and a previously reviewed fixture target. Projection and identity are
 * finalized by the shared adapter, so the app owns no duplicate projector.
 */
export async function composeFixtureBuildPlan({ familyRevision, pinnedFixtureTarget }) {
  if (pinnedFixtureTarget.outputMode !== "design-fixture") {
    fail("BUILD_PLAN_PROFILE_UNSUPPORTED", "the companion host slice accepts the design fixture target only");
  }

  const physicalByOid = new Map(
    pinnedFixtureTarget.physicalMap.entries.map((entry) => [entry.logicalOid, entry.physicalCode]),
  );
  const assetById = new Map(
    pinnedFixtureTarget.assetCatalog.assets.map((asset) => [asset.assetId, asset]),
  );
  const provisionalBuildPlan = {
    schemaVersion: 1,
    profile: "family-build-plan-v1",
    buildPlanId: pinnedFixtureTarget.buildPlanId,
    buildSubjectSha256: "0".repeat(64),
    requestedAt: pinnedFixtureTarget.requestedAt,
    familyRevisionId: familyRevision.revisionId,
    outputMode: "design-fixture",
    expectedCompilerProfile: pinnedFixtureTarget.expectedCompilerProfile,
    targetProfile: clone(pinnedFixtureTarget.targetProfile),
    physicalMap: {
      revisionRef: pinnedFixtureTarget.physicalMap.revisionRef,
      status: pinnedFixtureTarget.physicalMap.status,
      entries: familyRevision.bindings.map((binding) => {
        if (!physicalByOid.has(binding.logicalOid)) {
          fail("BUILD_PLAN_TARGET_MISMATCH", `${binding.logicalOid} is absent from the pinned physical map`);
        }
        return { logicalOid: binding.logicalOid, physicalCode: physicalByOid.get(binding.logicalOid) };
      }),
    },
    codecProfile: clone(pinnedFixtureTarget.codecProfile),
    assetCatalog: {
      revisionRef: pinnedFixtureTarget.assetCatalog.revisionRef,
      assets: familyRevision.bindings
        .flatMap((binding) => binding.clips)
        .map((clip) => {
          const pinned = assetById.get(clip.assetId);
          if (!pinned) fail("BUILD_PLAN_ASSET_MISSING", `${clip.assetId} is absent from the pinned asset catalog`);
          return {
            assetId: clip.assetId,
            path: pinned.path,
            bytes: clip.assetBytes,
            sha256: clip.assetSha256,
            codec: pinned.codec,
          };
        })
        .sort((left, right) => (left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0)),
    },
    expectedProjection: { sourceSha256: "0".repeat(64) },
  };

  const finalized = await finalizeBuildPlanProjection({ familyRevision, provisionalBuildPlan });
  return finalized.buildPlan;
}

function requireEqual(actual, expected, code, label) {
  if (actual !== expected) fail(code, `${label} differs from the authorized build`);
}

export async function assertAuthorizedCompileInput({
  repoRoot,
  familyRevision,
  buildPlan,
  projectedDraft,
  preview,
  confirmation,
  presentationTranscript,
  proof,
  verificationResult,
  buildAuthorization,
  now,
}) {
  if (buildAuthorization === null || buildAuthorization === undefined) {
    fail("AUTHORIZATION_REQUIRED", "authorized compile requires BuildAuthorization");
  }
  const contracts = await loadConfirmationTrustSchemaValidator(repoRoot);
  for (const [name, value] of [
    ["build-plan", buildPlan],
    ["preview", preview],
    ["confirmation", confirmation],
    ["presentation-transcript", presentationTranscript],
    ["proof", proof],
    ["verification-result", verificationResult],
    ["build-authorization", buildAuthorization],
  ]) contracts.validate(name, value);

  try {
    assertBuildPlanIdentity(buildPlan);
    assertBuildAuthorizationIdentity(buildAuthorization);
  } catch (error) {
    fail("AUTHORIZATION_IDENTITY_INVALID", error.message);
  }

  if (buildPlan.outputMode !== "design-fixture" || buildAuthorization.fixtureOnly !== true) {
    fail("AUTHORIZATION_PROFILE_UNSUPPORTED", "the companion host slice is sealed to fixture design builds");
  }
  if (buildAuthorization.productReleaseDecisionId !== null
    || buildAuthorization.productReleaseSubjectRevisionSha256 !== null
    || verificationResult.productionEligible !== false) {
    fail("AUTHORIZATION_PROFILE_UNSUPPORTED", "fixture authorization must carry no product release claim");
  }

  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) fail("AUTHORIZATION_TIME_INVALID", "authorized compile requires a valid trusted timestamp");
  if (nowMs < Date.parse(buildAuthorization.authorizedAt)) {
    fail("AUTHORIZATION_NOT_YET_VALID", "BuildAuthorization is newer than the compile timestamp");
  }
  if (nowMs >= Date.parse(buildAuthorization.authorizationExpiresAt)) {
    fail("AUTHORIZATION_EXPIRED", "BuildAuthorization expired before compile dispatch");
  }

  const confirmationSha256 = canonicalSha256(confirmation).sha256;
  const transcriptSha256 = computePresentationTranscriptSha256(presentationTranscript);
  const proofId = computeProofId(proof);
  const projectedSourceSha256 = canonicalSha256(projectedDraft).sha256;
  const bindings = verificationResult.binding;

  for (const [actual, expected, label] of [
    [buildPlan.familyRevisionId, familyRevision.revisionId, "BuildPlan FamilyRevision"],
    [buildAuthorization.familyRevisionId, familyRevision.revisionId, "authorization FamilyRevision"],
    [buildAuthorization.buildPlanId, buildPlan.buildPlanId, "authorization BuildPlan"],
    [buildAuthorization.buildSubjectSha256, buildPlan.buildSubjectSha256, "authorization build subject"],
    [buildAuthorization.confirmationId, confirmation.confirmationId, "authorization confirmation"],
    [buildAuthorization.confirmationSemanticSha256, confirmationSha256, "authorization confirmation digest"],
    [buildAuthorization.confirmationProofId, proof.proofId, "authorization proof"],
    [proof.proofId, proofId, "proof identity"],
    [buildAuthorization.presentationTranscriptSha256, presentationTranscript.transcriptSha256, "authorization transcript"],
    [presentationTranscript.transcriptSha256, transcriptSha256, "transcript identity"],
    [buildAuthorization.providerVerificationId, verificationResult.verificationId, "authorization provider verification"],
    [buildAuthorization.trustPolicyId, verificationResult.trustPolicyId, "authorization trust policy"],
    [verificationResult.proofId, proof.proofId, "verification proof"],
    [verificationResult.consumedAt, buildAuthorization.authorizedAt, "verification consumption time"],
    [bindings.familyRevisionId, familyRevision.revisionId, "verification FamilyRevision"],
    [bindings.buildPlanId, buildPlan.buildPlanId, "verification BuildPlan"],
    [bindings.buildSubjectSha256, buildPlan.buildSubjectSha256, "verification build subject"],
    [bindings.confirmationId, confirmation.confirmationId, "verification confirmation"],
    [bindings.confirmationSemanticSha256, confirmationSha256, "verification confirmation digest"],
    [bindings.previewId, preview.previewId, "verification preview"],
    [bindings.sourceSha256, preview.sourceSha256, "verification preview source"],
    [bindings.presentationTranscriptSha256, presentationTranscript.transcriptSha256, "verification transcript"],
    [preview.sourceSha256, buildPlan.expectedProjection.sourceSha256, "preview BuildPlan projection"],
    [projectedSourceSha256, buildPlan.expectedProjection.sourceSha256, "projected draft BuildPlan projection"],
    [confirmation.previewId, preview.previewId, "confirmation preview"],
    [confirmation.sourceSha256, preview.sourceSha256, "confirmation source"],
  ]) requireEqual(actual, expected, "AUTHORIZATION_BINDING_MISMATCH", label);

  if (verificationResult.verified !== true || confirmation.decision !== "confirmed"
    || confirmation.scope !== "all-bindings") {
    fail("AUTHORIZATION_BINDING_MISMATCH", "confirmation verification is incomplete");
  }

  const expectedAuthorization = createBuildAuthorizationFromVerification({ verificationResult, proof });
  if (!sameJson(expectedAuthorization, buildAuthorization)) {
    fail("AUTHORIZATION_DERIVATION_MISMATCH", "BuildAuthorization differs from the provider verification projection");
  }
  return buildAuthorization;
}

/**
 * This is the only call site in the app that dispatches the stable compiler.
 * All authorization work happens first, so rejected authorization never asks
 * the compiler to prepare an output parent or acquire an output lock.
 */
export async function authorizedCompileDesignSnapshot({
  repoRoot,
  draftPath,
  confirmationPath,
  outputDirectory,
  ...authorizationInput
}) {
  await assertAuthorizedCompileInput({ repoRoot, ...authorizationInput });
  return compileSnapshot({ repoRoot, draftPath, confirmationPath, outputDirectory });
}

export async function projectAndValidateBuildPlan({ familyRevision, buildPlan }) {
  assertBuildPlanIdentity(buildPlan);
  return projectCompileDraftFromPlan({ familyRevision, buildPlan });
}
