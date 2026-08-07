import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";
import {
  actionIdFor,
  assertFamilyRevisionSemantics,
  computeFamilyRevisionId,
} from "../../contracts/family-revision-v1.mjs";
import {
  assertBuildPlanIdentity,
  computeBuildSubjectSha256,
} from "../../contracts/family-build-plan-v1.mjs";
import { isStrictRfc3339 } from "../../contracts/rfc3339.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const U64_MAX = 18_446_744_073_709_551_615n;

function formatErrors(errors) {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

let validatorsPromise;

async function validators() {
  if (validatorsPromise) return validatorsPromise;
  validatorsPromise = (async () => {
  const [revisionSchema, requestSchema, planSchema] = await Promise.all([
    readFile(path.join(REPO_ROOT, "hardware/evt0/family-repository-v1/family-revision.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(REPO_ROOT, "hardware/evt0/family-repository-v1/build-request.schema.json"), "utf8").then(JSON.parse),
    readFile(path.join(REPO_ROOT, "hardware/evt0/family-repository-v1/build-plan.schema.json"), "utf8").then(JSON.parse),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addFormat("date-time", { type: "string", validate: isStrictRfc3339 });
  ajv.addSchema(requestSchema);
  return {
    revision: ajv.compile(revisionSchema),
    request: ajv.getSchema(requestSchema.$id),
    plan: ajv.compile(planSchema),
  };
  })();
  return validatorsPromise;
}

function validate(name, validator, value) {
  if (!validator(value)) throw new Error(`${name} schema failed: ${formatErrors(validator.errors)}`);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function assertUnique(values, label) {
  const duplicates = duplicateValues(values);
  if (duplicates.length) throw new Error(`${label} must be unique: ${duplicates.join(", ")}`);
}

function assertOrdinallySorted(values, label) {
  if (values.some((value, index) => index > 0 && values[index - 1] >= value)) {
    throw new Error(`${label} must be strictly ordinally sorted`);
  }
}

function canonicalU64(value) {
  try {
    return typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) <= U64_MAX;
  } catch {
    return false;
  }
}

export { computeFamilyRevisionId } from "../../contracts/family-revision-v1.mjs";

function commonSemanticChecks(familyRevision, buildInput) {
  assertFamilyRevisionSemantics(familyRevision);
  if (buildInput.familyRevisionId !== familyRevision.revisionId) throw new Error("family build input names a different FamilyRevision");
  if (Date.parse(buildInput.requestedAt) < Date.parse(familyRevision.createdAt)) {
    throw new Error("family build input timestamp precedes FamilyRevision");
  }

  const bindings = familyRevision.bindings;

  const physicalEntries = buildInput.physicalMap.entries;
  assertUnique(physicalEntries.map((entry) => entry.logicalOid), "physical map logicalOid");
  assertOrdinallySorted(physicalEntries.map((entry) => entry.logicalOid), "physical map entries");
  const bindingOids = bindings.map((binding) => binding.logicalOid);
  if (JSON.stringify(physicalEntries.map((entry) => entry.logicalOid)) !== JSON.stringify(bindingOids)) {
    throw new Error("physical map must exactly cover FamilyRevision logical OIDs");
  }
  const assignedCodes = physicalEntries.filter((entry) => entry.physicalCode !== null).map((entry) => entry.physicalCode);
  if (assignedCodes.some((value) => !canonicalU64(value))) throw new Error("physicalCode must fit u64");
  assertUnique(assignedCodes, "physicalCode");

  const assets = buildInput.assetCatalog.assets;
  assertUnique(assets.map((asset) => asset.assetId), "asset catalog assetId");
  assertUnique(assets.map((asset) => asset.path), "asset catalog path");
  assertOrdinallySorted(assets.map((asset) => asset.assetId), "asset catalog entries");
  const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const referencedAssetIds = [...new Set(bindings.flatMap((binding) => binding.clips.map((clip) => clip.assetId)))].sort();
  if (JSON.stringify(assets.map((asset) => asset.assetId)) !== JSON.stringify(referencedAssetIds)) {
    throw new Error("asset catalog must exactly cover FamilyRevision assets");
  }
  for (const binding of bindings) {
    for (const clip of binding.clips) {
      const asset = assetById.get(clip.assetId);
      if (!asset || asset.sha256 !== clip.assetSha256 || asset.bytes !== clip.assetBytes) {
        throw new Error(`${clip.clipId} asset identity differs from FamilyRevision`);
      }
      if (!buildInput.codecProfile.acceptedSourceCodecs.includes(asset.codec)) {
        throw new Error(`${clip.clipId} source codec is outside the family build codec profile`);
      }
      if (asset.codec !== buildInput.codecProfile.snapshotCodec) {
        throw new Error("Family build adapter v1 requires source and snapshot codec equality");
      }
    }
  }
}

function legacySemanticChecks(familyRevision, buildRequest) {
  commonSemanticChecks(familyRevision, buildRequest);
  if (buildRequest.confirmation.projectionSourceSha256 !== buildRequest.expectedProjection.sourceSha256) {
    throw new Error("confirmation projection source differs from expected projection");
  }
}

function projectDraft(familyRevision, buildInput, fixtureOnly) {
  const physicalByOid = new Map(buildInput.physicalMap.entries.map((entry) => [entry.logicalOid, entry.physicalCode]));
  const assetById = new Map(buildInput.assetCatalog.assets.map((asset) => [asset.assetId, asset]));
  return {
    schemaVersion: 1,
    profile: buildInput.expectedCompilerProfile,
    fixtureOnly,
    familyLibraryId: familyRevision.familyLibraryId,
    contentRevision: familyRevision.contentRevision,
    createdAt: familyRevision.createdAt,
    releaseState: buildInput.outputMode,
    sourceProducer: familyRevision.sourceProducer,
    target: {
      boardTarget: buildInput.targetProfile.boardTarget,
      firmwareMin: buildInput.targetProfile.firmwareMin,
      physicalMapStatus: buildInput.physicalMap.status,
      capabilities: buildInput.targetProfile.capabilities,
    },
    bindings: familyRevision.bindings.map((binding) => ({
      bindingId: binding.bindingId,
      logicalOid: binding.logicalOid,
      physicalCode: physicalByOid.get(binding.logicalOid),
      actionId: actionIdFor(binding.bindingId),
      label: binding.label,
      kind: binding.kind,
      playPolicy: binding.playPolicy,
      cooldownMs: binding.cooldownMs,
      revision: binding.bindingRevision,
      clips: binding.clips.map((clip) => {
        const asset = assetById.get(clip.assetId);
        return {
          clipId: clip.clipId,
          assetPath: asset.path,
          sourceKind: clip.sourceKind,
          transcript: clip.transcript,
          mediaType: clip.mediaType,
          language: clip.language,
          codec: asset.codec,
        };
      }),
    })),
  };
}

export async function projectCompileDraft({ familyRevision, buildRequest }) {
  const checks = await validators();
  validate("FamilyRevision", checks.revision, familyRevision);
  validate("BuildRequest", checks.request, buildRequest);
  if (buildRequest.outputMode === "release-candidate") {
    throw new Error("BuildRequest v1 release path is sealed; use BuildPlan plus verified BuildAuthorization");
  }
  legacySemanticChecks(familyRevision, buildRequest);
  const draft = projectDraft(familyRevision, buildRequest, buildRequest.fixtureOnly);

  const projectionSha256 = canonicalSha256(draft).sha256;
  if (projectionSha256 !== buildRequest.expectedProjection.sourceSha256) {
    throw new Error("CompileDraftProjection semantic hash differs from BuildRequest expectation");
  }
  return { draft, projectionSha256 };
}

export async function projectCompileDraftFromPlan({ familyRevision, buildPlan }) {
  const checks = await validators();
  validate("FamilyRevision", checks.revision, familyRevision);
  validate("BuildPlan", checks.plan, buildPlan);
  assertBuildPlanIdentity(buildPlan);
  commonSemanticChecks(familyRevision, buildPlan);
  const draft = projectDraft(familyRevision, buildPlan, buildPlan.outputMode === "design-fixture");
  const projectionSha256 = canonicalSha256(draft).sha256;
  if (projectionSha256 !== buildPlan.expectedProjection.sourceSha256) {
    throw new Error("CompileDraftProjection semantic hash differs from BuildPlan expectation");
  }
  return { draft, projectionSha256 };
}

/**
 * Finalize a newly composed BuildPlan without duplicating CompileDraftProjection
 * semantics in an application composition root. Identity placeholders are
 * always replaced with values derived by this adapter.
 */
export async function finalizeBuildPlanProjection({ familyRevision, provisionalBuildPlan }) {
  const checks = await validators();
  validate("FamilyRevision", checks.revision, familyRevision);
  validate("provisional BuildPlan", checks.plan, provisionalBuildPlan);
  const buildPlan = structuredClone(provisionalBuildPlan);
  commonSemanticChecks(familyRevision, buildPlan);
  const draft = projectDraft(familyRevision, buildPlan, buildPlan.outputMode === "design-fixture");
  const projectionSha256 = canonicalSha256(draft).sha256;
  buildPlan.expectedProjection.sourceSha256 = projectionSha256;
  buildPlan.buildSubjectSha256 = computeBuildSubjectSha256(buildPlan);
  validate("finalized BuildPlan", checks.plan, buildPlan);
  assertBuildPlanIdentity(buildPlan);
  return { buildPlan, draft, projectionSha256 };
}

export async function verifyBuildAssets({ buildRequest, assetReader }) {
  if (typeof assetReader !== "function") throw new TypeError("assetReader port is required");
  const verified = [];
  for (const asset of buildRequest.assetCatalog.assets) {
    const bytes = Buffer.from(await assetReader({ ...asset }));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== asset.bytes || digest !== asset.sha256) {
      throw new Error(`${asset.assetId} resolved bytes differ from BuildRequest catalog`);
    }
    verified.push({ assetId: asset.assetId, bytes: bytes.length, sha256: digest });
  }
  return verified;
}

export async function verifyBuildPlanAssets({ buildPlan, assetReader }) {
  return verifyBuildAssets({ buildRequest: buildPlan, assetReader });
}
