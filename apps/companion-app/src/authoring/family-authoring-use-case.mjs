import {
  assertFamilyRevisionSemantics,
  assertFamilyRevisionTransition,
  computeFamilyRevisionId,
} from "../../../../contracts/family-revision-v1.mjs";
import { isStrictRfc3339 } from "../../../../contracts/rfc3339.mjs";
import {
  isAuthoringClipMetadata,
  isAuthoringImportedAsset,
  isAuthoringSourceProducer,
} from "./authoring-contract.mjs";

const SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const CONTENT_REVISION = /^[a-z0-9][a-z0-9._@-]{2,95}$/u;

export class FamilyAuthoringError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FamilyAuthoringError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new FamilyAuthoringError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function assertRepositoryPort(repository) {
  assert(repository && typeof repository.loadRevision === "function" && typeof repository.commit === "function",
    "AUTHORING_REPOSITORY_PORT_INVALID",
    "authoring requires loadRevision and commit repository ports");
}

function assertImportedAsset(importedAsset) {
  assert(isAuthoringImportedAsset(importedAsset),
  "AUTHORING_ASSET_RECEIPT_INVALID",
  "imported asset receipt is malformed");
}

function assertClipMetadata(clipMetadata) {
  assert(isAuthoringClipMetadata(clipMetadata),
  "AUTHORING_CLIP_METADATA_INVALID",
  "authored clip metadata is malformed");
}

function assertSourceProducer(sourceProducer) {
  assert(isAuthoringSourceProducer(sourceProducer),
  "AUTHORING_SOURCE_PRODUCER_INVALID",
  "source producer identity is malformed");
}

function incrementDecimal(value, code, label, maximum) {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    fail(code, `${label} is malformed`);
  }
  assert(parsed < maximum, code, `${label} is exhausted`);
  return String(parsed + 1n);
}

function sameCatalogEntry(left, right) {
  return left.assetId === right.assetId
    && left.path === right.path
    && left.bytes === right.bytes
    && left.sha256 === right.sha256
    && left.codec === right.codec;
}

/**
 * Commit one immutable authoring command against an explicit base revision.
 * Loading by base ID (rather than by current head) keeps retries byte-stable:
 * the repository can replay the exact command after a successful first call,
 * while a different operation against a stale base still fails its CAS gate.
 */
export async function commitImportedClipReplacement({
  repository,
  operationId,
  expectedHeadRevisionId,
  createdAt,
  committedAt,
  contentRevision,
  bindingId,
  clipId,
  importedAsset,
  clipMetadata,
  sourceProducer = { name: "yimi-companion-authoring", version: "1.0.0" },
}) {
  assertRepositoryPort(repository);
  assert(SHA256_ID.test(expectedHeadRevisionId ?? ""),
    "AUTHORING_BASE_REVISION_INVALID", "expected base revision ID is malformed");
  assert(isStrictRfc3339(createdAt) && isStrictRfc3339(committedAt),
    "AUTHORING_TIMESTAMP_INVALID", "authoring timestamps must use strict RFC3339");
  assert(CONTENT_REVISION.test(contentRevision ?? ""),
    "AUTHORING_CONTENT_REVISION_INVALID", "contentRevision is malformed");
  assertImportedAsset(importedAsset);
  assertClipMetadata(clipMetadata);
  assertSourceProducer(sourceProducer);

  const baseRevision = await repository.loadRevision(expectedHeadRevisionId);
  assert(baseRevision !== null, "AUTHORING_BASE_REVISION_NOT_FOUND",
    "expected base revision is absent from the repository", { expectedHeadRevisionId });
  const bindingIndex = baseRevision.bindings.findIndex((binding) => binding.bindingId === bindingId);
  assert(bindingIndex >= 0, "AUTHORING_BINDING_NOT_FOUND",
    "authored binding is absent from the base revision", { bindingId });
  const clipIndex = baseRevision.bindings[bindingIndex].clips.findIndex((clip) => clip.clipId === clipId);
  assert(clipIndex >= 0, "AUTHORING_CLIP_NOT_FOUND",
    "authored clip is absent from the selected binding", { bindingId, clipId });

  const revision = clone(baseRevision);
  revision.revisionId = `sha256:${"0".repeat(64)}`;
  revision.contentRevision = contentRevision;
  revision.revisionNumber = incrementDecimal(
    baseRevision.revisionNumber,
    "AUTHORING_REVISION_RANGE_EXHAUSTED",
    "revisionNumber",
    18_446_744_073_709_551_615n,
  );
  revision.parentRevisionId = baseRevision.revisionId;
  revision.createdAt = createdAt;
  revision.sourceProducer = clone(sourceProducer);
  const binding = revision.bindings[bindingIndex];
  assert(binding.bindingRevision < 4_294_967_295,
    "AUTHORING_BINDING_RANGE_EXHAUSTED", "bindingRevision is exhausted", { bindingId });
  binding.bindingRevision += 1;
  binding.clips[clipIndex] = {
    clipId,
    assetId: importedAsset.assetId,
    assetSha256: importedAsset.sha256,
    assetBytes: importedAsset.bytes,
    sourceKind: clipMetadata.sourceKind,
    transcript: clipMetadata.transcript,
    mediaType: clipMetadata.mediaType,
    language: clipMetadata.language,
  };
  revision.revisionId = computeFamilyRevisionId(revision);

  try {
    assertFamilyRevisionSemantics(revision);
    assertFamilyRevisionTransition(baseRevision, revision);
  } catch (error) {
    fail("AUTHORING_REVISION_INVALID", "authored FamilyRevision violates the stable contract", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const commit = await repository.commit({
    operationId,
    revision,
    expectedHeadRevisionId,
    at: committedAt,
  });
  const assetCatalogEntry = Object.freeze({
    assetId: importedAsset.assetId,
    path: importedAsset.contentPath,
    bytes: importedAsset.bytes,
    sha256: importedAsset.sha256,
    codec: importedAsset.codec,
  });
  return Object.freeze({ revision: clone(revision), commit: clone(commit), assetCatalogEntry });
}

/**
 * The local path belongs to the app-side BuildPlan adapter, never to
 * FamilyRevision. This helper changes only fixture target identity/catalog;
 * the shared build adapter remains the single owner of projection semantics.
 */
export function extendFixtureTargetWithImportedAsset({
  baseTarget,
  importedAsset,
  buildPlanId,
  requestedAt,
  assetCatalogRevisionRef,
}) {
  assertImportedAsset(importedAsset);
  assert(baseTarget?.assetCatalog && Array.isArray(baseTarget.assetCatalog.assets),
    "AUTHORING_FIXTURE_TARGET_INVALID", "base fixture target lacks an asset catalog");
  assert(typeof buildPlanId === "string" && buildPlanId.length > 0
    && isStrictRfc3339(requestedAt)
    && typeof assetCatalogRevisionRef === "string" && assetCatalogRevisionRef.length > 0,
  "AUTHORING_FIXTURE_TARGET_INVALID", "authored fixture target identity is malformed");

  const target = clone(baseTarget);
  target.buildPlanId = buildPlanId;
  target.requestedAt = requestedAt;
  target.assetCatalog.revisionRef = assetCatalogRevisionRef;
  const nextEntry = {
    assetId: importedAsset.assetId,
    path: importedAsset.contentPath,
    bytes: importedAsset.bytes,
    sha256: importedAsset.sha256,
    codec: importedAsset.codec,
  };
  const currentIndex = target.assetCatalog.assets.findIndex((asset) => asset.assetId === nextEntry.assetId);
  if (currentIndex >= 0) {
    assert(sameCatalogEntry(target.assetCatalog.assets[currentIndex], nextEntry),
      "AUTHORING_ASSET_CATALOG_CONFLICT",
      "fixture asset catalog already contains a different identity for the imported asset",
      { assetId: nextEntry.assetId });
    target.assetCatalog.assets[currentIndex] = nextEntry;
  } else {
    target.assetCatalog.assets.push(nextEntry);
  }
  target.assetCatalog.assets.sort((left, right) => (
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
  ));
  return Object.freeze(target);
}
