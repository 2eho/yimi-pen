import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";
import { assertTrustPolicySemantics } from "../../contracts/confirmation-trust-v1.mjs";
import {
  assertReleaseGateCatalog,
  computeReleaseDecisionId,
} from "../../contracts/release-gates-v1.mjs";
import { isStrictRfc3339 } from "../../contracts/rfc3339.mjs";

// This is the stable reference contract. The production gate verifier keeps a
// separate profile name and is intentionally not selected by this package.
export const PROVIDER_QUALIFICATION_PROFILE = "confirmation-provider-qualification-reference-v1";
export const PRODUCTION_PROVIDER_VERIFIER_PROFILE = "production-confirmation-provider-qualification-v1";
export const QUALIFICATION_REPORT_PROFILE = "confirmation-provider-qualification-report-v1";
export const RELEASE_BINDING_PROFILE = "release-candidate-binding-projection-v1";
export const PRODUCTION_CONFIRMATION_GATE_ID = "RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED";
export const QUALIFICATION_LEVELS = Object.freeze(["L0", "L1", "L2", "L3", "L4"]);
export const QUALIFICATION_STATUSES = Object.freeze(["PASS", "PARTIAL", "MISSING", "BLOCKED"]);
export const EVIDENCE_KEYS = Object.freeze([
  "confirmationTrust",
  "trustPolicy",
  "replaySchema",
  "releaseDecision",
  "releaseEvaluation",
  "releaseCatalog",
  "targetBinding",
]);

const FORBIDDEN_KEY_PATTERN = /(?:token|cookie|authorization|password|privatekey|private_key|seed|recovery|account.?export|internal.?handle|hostname|username)/iu;
const FORBIDDEN_VALUE_PATTERNS = [
  /-----BEGIN [^-]+ PRIVATE KEY-----/u,
  /(?:^|\s)(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/iu,
  /(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|private|tmp|var)\/)/u,
];
const SAFE_REDACTION_COUNTER_KEYS = new Set([
  "secretLikeFieldCount",
  "absolutePathCount",
  "usernameCount",
  "hostnameCount",
  "internalHandleCount",
  "buildAuthorizationIds",
]);

const CAPABILITY_RULES = Object.freeze({
  fixtureHostProof: Object.freeze({ status: "PASS", missing: [] }),
  publicKeyIdentity: Object.freeze({ status: "PASS", missing: [] }),
  replayIdentity: Object.freeze({ status: "PASS", missing: [] }),
  productTransactionDurability: Object.freeze({ status: "MISSING", missing: ["productAuditTransaction", "parentDirectoryFsync", "powerLossDurability", "staleLockRecovery", "multiprocessRecovery", "productReplayStore"] }),
  productionKeyCustody: Object.freeze({ status: "MISSING", missing: ["productionKeyCustody", "keyLifecycle"] }),
  familyAuthorityResolver: Object.freeze({ status: "MISSING", missing: ["familyAuthorityResolver", "accountAuthorityRevision", "authenticationEvent"] }),
  providerGateVerifier: Object.freeze({ status: "MISSING", missing: ["providerGateVerifier"] }),
  environmentBinding: Object.freeze({ status: "MISSING", missing: ["environmentBinding"] }),
  releaseCandidateE2E: Object.freeze({ status: "BLOCKED", missing: ["releaseCandidateE2E"] }),
  targetBindingEvidence: Object.freeze({ status: "BLOCKED", missing: ["targetBindingEvidence"] }),
});

const LEVEL_MISSING = Object.freeze({
  L0: Object.freeze(["productTransactionDurability", "productionKeyCustody", "familyAuthorityResolver", "providerGateVerifier"]),
  L1: Object.freeze(["productAuditTransaction", "parentDirectoryFsync", "powerLossDurability", "staleLockRecovery", "multiprocessRecovery", "productReplayStore"]),
  L2: Object.freeze(["productionKeyCustody", "keyLifecycle"]),
  L3: Object.freeze(["familyAuthorityResolver", "accountAuthorityRevision", "authenticationEvent"]),
  L4: Object.freeze([
    "productTransactionDurability",
    "productAuditTransaction",
    "parentDirectoryFsync",
    "powerLossDurability",
    "staleLockRecovery",
    "multiprocessRecovery",
    "productReplayStore",
    "productionKeyCustody",
    "keyLifecycle",
    "familyAuthorityResolver",
    "accountAuthorityRevision",
    "authenticationEvent",
    "providerGateVerifier",
    "environmentBinding",
    "productionReceipt",
  ]),
});

export class ProviderQualificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProviderQualificationError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new ProviderQualificationError(code, message, details);
}

function assert(condition, code, message, details = {}) {
  if (!condition) fail(code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function assertStrictTime(value, label) {
  assert(isStrictRfc3339(value), "QUALIFICATION_TIME_INVALID", `${label} must be strict RFC3339`, { label });
}

function sortedUnique(values, label) {
  assert(Array.isArray(values), "QUALIFICATION_ARRAY_INVALID", `${label} must be an array`);
  const sorted = [...values].sort((left, right) => left.localeCompare(right, "en"));
  assert(new Set(sorted).size === sorted.length, "QUALIFICATION_DUPLICATE_ID", `${label} must be unique`);
  return sorted;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameReleaseSubject(left, right) {
  return left?.subjectType === right?.subjectType
    && left?.subjectId === right?.subjectId
    && left?.subjectRevisionSha256 === right?.subjectRevisionSha256;
}

function assertSafePublicValue(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafePublicValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert(SAFE_REDACTION_COUNTER_KEYS.has(key) || !FORBIDDEN_KEY_PATTERN.test(key), "QUALIFICATION_SECRET_FIELD", `redaction rejected field ${path}.${key}`, { path, key });
      assertSafePublicValue(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
      assert(!pattern.test(value), "QUALIFICATION_SECRET_VALUE", `redaction rejected value at ${path}`, { path });
    }
  }
}

function assertArtifactReference(reference, label) {
  assert(reference && typeof reference === "object", "QUALIFICATION_ARTIFACT_INVALID", `${label} artifact reference is missing`);
  assert(typeof reference.role === "string" && reference.role.length > 0, "QUALIFICATION_ARTIFACT_ROLE_INVALID", `${label} artifact role is invalid`);
  assert(
    typeof reference.path === "string"
      && reference.path.length > 0
      && !reference.path.startsWith("/")
      && !reference.path.includes("\\")
      && !reference.path.split("/").includes(".."),
    "QUALIFICATION_ARTIFACT_PATH_INVALID",
    `${label} artifact path must be repository-relative`,
  );
  assert(Number.isInteger(reference.size) && reference.size > 0, "QUALIFICATION_ARTIFACT_SIZE_INVALID", `${label} artifact size is invalid`);
  assert(isSha256(reference.sha256), "QUALIFICATION_ARTIFACT_HASH_INVALID", `${label} artifact hash is invalid`);
  return reference;
}

function artifactEntry(evidence, key) {
  const entry = evidence?.[key];
  assert(entry && entry.artifact && entry.value && typeof entry.value === "object", "QUALIFICATION_EVIDENCE_MISSING", `${key} evidence is missing`);
  assertArtifactReference(entry.artifact, key);
  return entry;
}

function externalCall(code, operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ProviderQualificationError) throw error;
    fail(code, error?.message ?? String(error));
  }
}

function levelMatrix({ corePass, productTransactionDurability, productionKeyCustody, productionKeyLifecycle, authorityEvidence, providerGateVerifier, environmentBinding, nonSyntheticProductionReceipt }) {
  const l0 = corePass ? "PASS" : "MISSING";
  const l1 = productTransactionDurability ? "PASS" : (corePass ? "PARTIAL" : "MISSING");
  const l2 = productionKeyCustody && productionKeyLifecycle ? "PASS" : "MISSING";
  const l3 = authorityEvidence ? "PASS" : "MISSING";
  const l4 = l1 === "PASS"
    && l2 === "PASS"
    && l3 === "PASS"
    && providerGateVerifier
    && environmentBinding
    && nonSyntheticProductionReceipt
    ? "PASS"
    : "BLOCKED";
  const statuses = { L0: l0, L1: l1, L2: l2, L3: l3, L4: l4 };
  return Object.fromEntries(QUALIFICATION_LEVELS.map((level) => [level, {
      status: statuses[level],
      productionEligible: false,
      evidenceRefs: level === "L0" ? ["confirmationTrust", "trustPolicy", "replaySchema"] : level === "L1" ? ["confirmationTrust", "replaySchema"] : level === "L4" ? ["confirmationTrust", "trustPolicy", "replaySchema", "releaseDecision", "releaseEvaluation"] : ["trustPolicy"],
      missingCapabilities: [...LEVEL_MISSING[level]],
    }]));
}

function levelFrontier(levels) {
  let currentLevel = "L0";
  for (let index = 0; index < QUALIFICATION_LEVELS.length; index += 1) {
    const level = QUALIFICATION_LEVELS[index];
    if (levels[level].status !== "PASS") break;
    currentLevel = level;
  }
  const partialLevel = QUALIFICATION_LEVELS.find((level) => levels[level].status === "PARTIAL");
  return {
    currentLevel,
    assessedThroughLevel: partialLevel ?? currentLevel,
    status: partialLevel ? "PARTIAL" : (levels.L4.status === "BLOCKED" ? "BLOCKED" : "PASS"),
  };
}

function capabilityMatrix(capabilityEvidence) {
  const evidence = {
    fixtureHostProof: "Confirmation-trust negative and zero-side-effect checks are present.",
    publicKeyIdentity: "Fixture public key identity and trust-policy identity are machine-checkable.",
    replayIdentity: "Replay ledger schema and fixture replay semantics are identified.",
    productTransactionDurability: "No product store, audit transaction, directory sync, power-loss or robust lock-recovery evidence is connected.",
    productionKeyCustody: "No production private-key custody or lifecycle adapter is connected.",
    familyAuthorityResolver: "No deployed family authority revision or authentication-event resolver is connected.",
    providerGateVerifier: "No configured production gate-specific verifier is connected.",
    environmentBinding: "Only fixture evidence is observed; no deployed provider qualification evidence exists.",
    releaseCandidateE2E: "The current release decision and target snapshot remain blocked.",
    targetBindingEvidence: "The current target identity remains unresolved and target evidence remains pending.",
  };
  const observed = {
    fixtureHostProof: capabilityEvidence.corePass,
    publicKeyIdentity: capabilityEvidence.publicKeyIdentity,
    replayIdentity: capabilityEvidence.replayIdentity,
    productTransactionDurability: capabilityEvidence.productTransactionDurability,
    productionKeyCustody: capabilityEvidence.productionKeyCustody && capabilityEvidence.productionKeyLifecycle,
    familyAuthorityResolver: capabilityEvidence.familyAuthorityResolver,
    providerGateVerifier: capabilityEvidence.providerGateVerifier,
    environmentBinding: capabilityEvidence.environmentBinding,
    // Release and target observations remain binding-projection concerns.
    releaseCandidateE2E: false,
    targetBindingEvidence: false,
  };
  return Object.entries(CAPABILITY_RULES).map(([id, rule]) => ({
    id,
    status: observed[id] ? "PASS" : rule.status,
    evidence: evidence[id],
  }));
}

function assertReleaseArrays(decision, catalog) {
  const catalogIds = sortedUnique(catalog.gates.map((gate) => gate.gateId), "catalog gate IDs");
  const passed = sortedUnique(decision.passedGateIds, "passedGateIds");
  const failed = sortedUnique(decision.failedGateIds, "failedGateIds");
  const missing = sortedUnique(decision.missingGateIds, "missingGateIds");
  const blocking = sortedUnique(decision.blockingGateIds, "blockingGateIds");
  const all = [...passed, ...failed, ...missing];
  assert(new Set(all).size === all.length, "QUALIFICATION_GATE_PARTITION", "release gate result sets overlap");
  assert(sameJson(sortedUnique(all, "all gate IDs"), catalogIds), "QUALIFICATION_GATE_PARTITION", "release gate result sets do not cover the catalog");
  const expectedBlocking = [...failed, ...missing].sort((left, right) => left.localeCompare(right, "en"));
  assert(sameJson(blocking, expectedBlocking), "QUALIFICATION_GATE_BLOCKERS", "blocking gate set is not derived from failed and missing sets");
  assert(decision.releaseReady === (blocking.length === 0), "QUALIFICATION_RELEASE_READY", "releaseReady is inconsistent with blocking gates");
  return { passed, failed, missing, blocking, catalogIds };
}

function validateEvidence(evidence) {
  assert(evidence && typeof evidence === "object" && !Array.isArray(evidence), "QUALIFICATION_EVIDENCE_MISSING", "qualification evidence must be an object");
  assert(evidence.capabilities === undefined, "QUALIFICATION_CAPABILITIES_UNEXPECTED", "self-declared capability flags are not accepted");
  const unexpectedKeys = Object.keys(evidence).filter((key) => !EVIDENCE_KEYS.includes(key));
  assert(unexpectedKeys.length === 0, "QUALIFICATION_EVIDENCE_KEY", "qualification evidence contains an unexpected key", { keys: unexpectedKeys });
  const confirmationTrust = artifactEntry(evidence, "confirmationTrust");
  const trustPolicy = artifactEntry(evidence, "trustPolicy");
  const replaySchema = artifactEntry(evidence, "replaySchema");
  const releaseDecision = artifactEntry(evidence, "releaseDecision");
  const releaseEvaluation = artifactEntry(evidence, "releaseEvaluation");
  const releaseCatalog = artifactEntry(evidence, "releaseCatalog");
  const targetBinding = artifactEntry(evidence, "targetBinding");

  assert(confirmationTrust.value.profile === "confirmation-trust-validation-v1", "QUALIFICATION_REPORT_PROFILE", "confirmation-trust report profile differs");
  const negative = confirmationTrust.value.negativeSummary;
  assert(Number.isInteger(negative?.total) && negative.total > 0 && negative.passed === negative.total && negative.zeroSideEffect === negative.total, "QUALIFICATION_NEGATIVE_SUMMARY", "confirmation negative summary must be a positive all-pass zero-side-effect result");
  const boundary = confirmationTrust.value.evidenceBoundary;
  assert(boundary?.fixtureOnly === true && boundary.productReleaseGateClosed === true, "QUALIFICATION_FIXTURE_BOUNDARY", "confirmation-trust fixture boundary differs");
  assert(boundary.productionAuthorityConnected === false && boundary.productionKeyConnected === false && boundary.productionReceiptCreated === false, "QUALIFICATION_PRODUCTION_EVIDENCE", "confirmation-trust report claims a production connection");

  externalCall("QUALIFICATION_TRUST_POLICY", () => assertTrustPolicySemantics(trustPolicy.value));
  assert(trustPolicy.value.fixtureOnly === true, "QUALIFICATION_TRUST_POLICY", "trust policy is not fixture-only");
  assert(replaySchema.value?.properties?.schemaVersion?.const === 1 && replaySchema.value?.properties?.profile?.const === "confirmation-trust-replay-ledger-v1", "QUALIFICATION_REPLAY_SCHEMA", "replay schema identity differs");

  externalCall("QUALIFICATION_CATALOG", () => assertReleaseGateCatalog(releaseCatalog.value));
  const productionGate = releaseCatalog.value.gates.find((gate) => gate.gateId === PRODUCTION_CONFIRMATION_GATE_ID);
  assert(productionGate?.evidenceClass === "production" && productionGate.allowSyntheticEvidence === false && productionGate.acceptedProducerIds.includes("confirmation-trust-provider"), "QUALIFICATION_PRODUCTION_GATE", "production confirmation gate rule differs");

  const decision = releaseDecision.value;
  assert(decision.profile === "release-decision-v1", "QUALIFICATION_DECISION_PROFILE", "release decision profile differs");
  assertStrictTime(decision.evaluatedAt, "releaseDecision.evaluatedAt");
  assert(decision.decisionId === computeReleaseDecisionId(decision), "QUALIFICATION_DECISION_ID", "release decision identity is not canonical");
  assert(decision.catalogId === releaseCatalog.value.catalogId && decision.catalogVersion === releaseCatalog.value.catalogVersion, "QUALIFICATION_DECISION_CATALOG", "release decision catalog binding differs");
  assert(decision.releaseSubject?.subjectType === "PRODUCT_RELEASE" && typeof decision.releaseSubject.subjectId === "string" && isSha256(decision.releaseSubject.subjectRevisionSha256), "QUALIFICATION_RELEASE_SUBJECT", "release subject shape is invalid");
  assert(Array.isArray(decision.receiptIds), "QUALIFICATION_RECEIPTS", "release decision receipt IDs are invalid");
  sortedUnique(decision.receiptIds, "receiptIds");
  const releaseArrays = assertReleaseArrays(decision, releaseCatalog.value);
  assert(releaseArrays.missing.includes(PRODUCTION_CONFIRMATION_GATE_ID) && releaseArrays.blocking.includes(PRODUCTION_CONFIRMATION_GATE_ID), "QUALIFICATION_GATE_MISSING", "production confirmation gate is not missing and blocking");

  const evaluation = releaseEvaluation.value;
  assert(evaluation.profile === "current-release-gate-evaluation-v1", "QUALIFICATION_EVALUATION_PROFILE", "current release evaluation profile differs");
  assertStrictTime(evaluation.evaluatedAt, "releaseEvaluation.evaluatedAt");
  assert(evaluation.catalogId === releaseCatalog.value.catalogId && evaluation.catalogVersion === releaseCatalog.value.catalogVersion, "QUALIFICATION_EVALUATION_CATALOG", "release evaluation catalog binding differs");
  assert(evaluation.decisionId === decision.decisionId && evaluation.releaseReady === decision.releaseReady, "QUALIFICATION_EVALUATION_DECISION", "release evaluation decision binding differs");
  assert(sameReleaseSubject(evaluation.releaseSubject, decision.releaseSubject), "QUALIFICATION_RELEASE_SUBJECT", "release evaluation subject differs");
  assert(evaluation.summary?.gates === releaseArrays.catalogIds.length && evaluation.summary.passed === releaseArrays.passed.length && evaluation.summary.failed === releaseArrays.failed.length && evaluation.summary.missing === releaseArrays.missing.length && evaluation.summary.blocking === releaseArrays.blocking.length, "QUALIFICATION_EVALUATION_COUNTS", "release evaluation counts are not derived from the catalog and decision");
  assert(sameJson(sortedUnique(evaluation.blockingGateIds, "evaluation.blockingGateIds"), releaseArrays.blocking), "QUALIFICATION_EVALUATION_BLOCKERS", "release evaluation blockers differ from the decision");
  assert(evaluation.externalReceiptCount === 0 && evaluation.evidenceBoundary?.productReleaseClaimed === false, "QUALIFICATION_EXTERNAL_RECEIPT", "release evaluation contains a product release claim");

  const target = targetBinding.value;
  assert(target.profile === "hardware-system-target-binding-v1", "QUALIFICATION_TARGET_PROFILE", "target binding profile differs");
  assert(target.targetIdentity?.state === "UNRESOLVED", "QUALIFICATION_TARGET_STATE", "target binding is resolved");
  assert(Array.isArray(target.interfaceBindings) && target.interfaceBindings.length > 0, "QUALIFICATION_TARGET_PENDING", "target binding interface set is empty");
  for (const binding of target.interfaceBindings) {
    assert(typeof binding.interfaceId === "string" && typeof binding.state === "string", "QUALIFICATION_TARGET_SHAPE", "target interface binding shape is invalid");
    if (binding.state === "TARGET_EVIDENCE_PENDING") {
      assert(binding.edaReadiness === "BLOCKED_TARGET_EVIDENCE" && typeof binding.blocker === "string" && binding.blocker.length > 0, "QUALIFICATION_TARGET_PENDING", "pending target interface lacks its blocker");
    } else if (binding.state === "NOT_APPLICABLE") {
      assert(binding.edaReadiness === "NOT_APPLICABLE" && binding.blocker === null, "QUALIFICATION_TARGET_SHAPE", "not-applicable target interface is inconsistent");
    } else {
      fail("QUALIFICATION_TARGET_STATE", "target interface is outside the unresolved target boundary");
    }
  }
  assert(target.eda?.readiness === "SYSTEM_SKELETON_ONLY" && target.eda.chipLevelReady === false, "QUALIFICATION_TARGET_STATE", "target EDA state is outside the unresolved boundary");

  return {
    confirmationTrust: confirmationTrust.value,
    trustPolicy: trustPolicy.value,
    replaySchema: replaySchema.value,
    releaseDecision: decision,
    releaseEvaluation: evaluation,
    releaseCatalog: releaseCatalog.value,
    targetBinding: target,
    releaseArrays,
  };
}

export function computeEnvironmentId(environmentDescriptor) {
  return `environment:sha256:${canonicalSha256(environmentDescriptor).sha256}`;
}

export function computeQualificationId(report) {
  const identity = report?.qualificationIdentity ?? report;
  return `qualification:sha256:${canonicalSha256(identity).sha256}`;
}

export function computeReleaseCandidateBindingId(binding) {
  const { bindingId: _bindingId, ...identity } = binding;
  return `binding:sha256:${canonicalSha256(identity).sha256}`;
}

export function assertReleaseCandidateBinding(binding) {
  assert(binding?.schemaVersion === 1 && binding.profile === RELEASE_BINDING_PROFILE, "QUALIFICATION_BINDING_PROFILE", "release-candidate binding profile is unsupported");
  assert(binding.bindingId === computeReleaseCandidateBindingId(binding), "QUALIFICATION_BINDING_ID", "release-candidate binding identity mismatch");
  assert(binding.state === "BLOCKED", "QUALIFICATION_BINDING_STATE", "current release-candidate binding must remain BLOCKED");
  assert(binding.fixtureOnly === true && binding.syntheticEvidence === true, "QUALIFICATION_BINDING_BOUNDARY", "current binding must remain fixture-only and synthetic");
  assert(binding.productionEligible === false && binding.gateEligible === false && binding.productionAuthorized === false && binding.sealed === false, "QUALIFICATION_BINDING_PROMOTION", "blocked binding remains unpromoted");
  assert(binding.providerQualificationReceiptId === null, "QUALIFICATION_RECEIPT_CREATED", "current binding must not name a production receipt");
  assert(typeof binding.qualificationId === "string" && binding.qualificationId.startsWith("qualification:sha256:"), "QUALIFICATION_BINDING_ID", "binding qualification identity is missing");
  assert(typeof binding.decisionId === "string" && typeof binding.catalogId === "string", "QUALIFICATION_BINDING_RELEASE", "binding release identity is missing");
  assert(binding.releaseSubject?.subjectType === "PRODUCT_RELEASE" && typeof binding.releaseSubject.subjectId === "string" && isSha256(binding.releaseSubject.subjectRevisionSha256), "QUALIFICATION_BINDING_RELEASE", "binding release subject is invalid");
  assert(binding.catalogVersion && typeof binding.catalogVersion === "string", "QUALIFICATION_BINDING_RELEASE", "binding catalog version is missing");
  assert(isSha256(binding.releaseDecisionSha256), "QUALIFICATION_BINDING_RELEASE", "binding decision artifact hash is invalid");
  assert(Array.isArray(binding.blockerSet) && binding.blockerSet.length > 0, "QUALIFICATION_BINDING_BLOCKERS", "blocked binding must retain its blocker set");
  assert(sameJson(binding.blockerSet, sortedUnique(binding.blockerSet, "blockerSet")), "QUALIFICATION_BINDING_BLOCKERS", "binding blockers must be sorted and unique");
  assert(binding.releaseReady === false, "QUALIFICATION_BINDING_RELEASE", "blocked binding must not claim a ready release");
  assert(binding.targetSnapshot?.state === "UNRESOLVED" && isSha256(binding.targetSnapshot.artifactSha256) && Number.isInteger(binding.targetSnapshot.pendingCount) && Number.isInteger(binding.targetSnapshot.totalCount) && binding.targetSnapshot.totalCount > 0 && binding.targetSnapshot.pendingCount >= 0 && binding.targetSnapshot.pendingCount <= binding.targetSnapshot.totalCount, "QUALIFICATION_BINDING_TARGET", "binding target snapshot is invalid");
  assertSafePublicValue(binding);
  return binding;
}

export function assertQualificationReport(report) {
  assert(report?.schemaVersion === 1 && report.profile === QUALIFICATION_REPORT_PROFILE, "QUALIFICATION_REPORT_PROFILE", "qualification report profile is unsupported");
  assert(report.qualificationProfile === PROVIDER_QUALIFICATION_PROFILE, "QUALIFICATION_PROFILE_UNSUPPORTED", "provider qualification profile is unsupported");
  assert(report.qualificationId === computeQualificationId(report), "QUALIFICATION_REPORT_ID", "qualification report identity mismatch");
  assert(report.environmentId === computeEnvironmentId(report.environmentDescriptor), "QUALIFICATION_ENVIRONMENT_ID", "qualification environment identity mismatch");
  assertStrictTime(report.observedAt, "observedAt");
  assert(report.fixtureOnly === true && report.syntheticEvidence === true, "QUALIFICATION_BOUNDARY", "current qualification must be fixture-only and synthetic");
  assert(report.productionEligible === false && report.gateEligible === false, "QUALIFICATION_PROMOTION", "current qualification must not be production eligible");
  assert(report.productionGateClosed === true && report.productionGateState === "MISSING" && report.productionGateId === PRODUCTION_CONFIRMATION_GATE_ID, "QUALIFICATION_GATE_STATE", "production confirmation gate state is not the current missing state");
  assert(report.productionReceiptCreated === false && report.noProductionReceiptCreated === true, "QUALIFICATION_RECEIPT_CREATED", "current qualification must not create a production receipt");
  assert(report.status === "PARTIAL" && report.currentLevel === "L0" && report.assessedThroughLevel === "L1", "QUALIFICATION_LEVEL_SUMMARY", "qualification level summary is not the current bounded result");
  assert(report.release?.releaseReady === false, "QUALIFICATION_RELEASE_READY", "current ReleaseDecision must remain not ready");
  assert(isSha256(report.release.decisionSha256), "QUALIFICATION_RELEASE_COUNTS", "release decision artifact hash is invalid");
  assert(Number.isInteger(report.release.passedCount) && Number.isInteger(report.release.failedCount) && Number.isInteger(report.release.missingCount) && Number.isInteger(report.release.blockingCount), "QUALIFICATION_RELEASE_COUNTS", "release counts are invalid");
  assert(report.release.passedCount + report.release.failedCount + report.release.missingCount > 0, "QUALIFICATION_RELEASE_COUNTS", "release gate count is empty");
  assert(report.release.productionGateInMissing === true, "QUALIFICATION_GATE_MISSING", "production gate must remain in the missing set");
  assert(report.targetBinding?.boardTarget === "UNRESOLVED" && report.targetBinding.targetState === "UNRESOLVED" && Number.isInteger(report.targetBinding.pendingCount) && Number.isInteger(report.targetBinding.totalCount) && report.targetBinding.pendingCount >= 0 && report.targetBinding.pendingCount <= report.targetBinding.totalCount && report.targetBinding.totalCount > 0, "QUALIFICATION_TARGET_STATE", "target binding observation is invalid");
  assert(report.targetBinding.hardwareImpact === "NONE" && report.targetBinding.offlineReady === false, "QUALIFICATION_HARDWARE_IMPACT", "qualification must remain hardware-neutral");
  assert(isSha256(report.targetBinding.artifactSha256), "QUALIFICATION_TARGET_STATE", "target binding artifact hash is invalid");
  assert(report.boardTarget === "UNRESOLVED" && report.targetEvidencePending === `${report.targetBinding.pendingCount}/${report.targetBinding.totalCount}` && report.hardwareImpact === "NONE" && report.offlineReady === false, "QUALIFICATION_BOUNDARY", "qualification hardware summary differs");
  assert(Number.isInteger(report.negativeSummary?.total) && report.negativeSummary.total > 0 && report.negativeSummary.passed === report.negativeSummary.total && report.negativeSummary.zeroSideEffect === report.negativeSummary.total, "QUALIFICATION_NEGATIVE_SUMMARY", "confirmation negative summary is not a positive all-pass result");
  assert(report.redaction?.profile === "public-evidence-v1" && report.redaction.passed === true && report.redaction.secretLikeFieldCount === 0 && report.redaction.absolutePathCount === 0 && report.redaction.usernameCount === 0 && report.redaction.hostnameCount === 0 && report.redaction.internalHandleCount === 0, "QUALIFICATION_REDACTION", "public evidence redaction is incomplete");
  for (const level of QUALIFICATION_LEVELS) {
    const entry = report.qualificationLevels?.[level];
    assert(entry && QUALIFICATION_STATUSES.includes(entry.status), "QUALIFICATION_LEVEL_INVALID", `${level} status is invalid`);
    assert(entry.productionEligible === false, "QUALIFICATION_LEVEL_PROMOTION", `${level} must not promote production eligibility`);
  }
  assert(report.qualificationLevels.L0.status === "PASS", "QUALIFICATION_L0", "L0 must be PASS");
  assert(report.qualificationLevels.L1.status === "PARTIAL", "QUALIFICATION_L1", "L1 must be PARTIAL");
  assert(report.qualificationLevels.L2.status === "MISSING" && report.qualificationLevels.L3.status === "MISSING", "QUALIFICATION_L2_L3", "L2 and L3 must remain MISSING");
  assert(report.qualificationLevels.L4.status === "BLOCKED", "QUALIFICATION_L4", "L4 must remain BLOCKED");
  assert(Array.isArray(report.evidenceArtifacts) && report.evidenceArtifacts.length === EVIDENCE_KEYS.length, "QUALIFICATION_ARTIFACT_SET", "qualification artifact set is incomplete");
  const artifactKeys = report.evidenceArtifacts.map((artifact) => `${artifact.role}\0${artifact.path}`);
  assert(new Set(artifactKeys).size === artifactKeys.length, "QUALIFICATION_ARTIFACT_DUPLICATE", "qualification artifact references are duplicated");
  report.evidenceArtifacts.forEach((artifact, index) => assertArtifactReference(artifact, `evidenceArtifacts[${index}]`));
  assertReleaseCandidateBinding(report.bindingProjection);
  assert(report.bindingProjection.qualificationId === report.qualificationId, "QUALIFICATION_BINDING_ID", "binding does not point at this qualification");
  assert(report.bindingProjection.decisionId === report.release.decisionId && report.bindingProjection.catalogId === report.release.catalogId, "QUALIFICATION_BINDING_RELEASE", "binding does not point at the observed release decision");
  assert(sameReleaseSubject(report.bindingProjection.releaseSubject, report.release.releaseSubject), "QUALIFICATION_BINDING_RELEASE", "binding release subject differs from the observed release subject");
  assert(report.bindingProjection.blockerSet.length === report.release.blockingCount, "QUALIFICATION_BINDING_BLOCKERS", "binding blocker count differs from the observed release");
  assert(report.bindingProjection.targetSnapshot.pendingCount === report.targetBinding.pendingCount && report.bindingProjection.targetSnapshot.totalCount === report.targetBinding.totalCount, "QUALIFICATION_BINDING_TARGET", "binding target snapshot differs from the observed target state");
  assertSafePublicValue(report);
  return report;
}

export function evaluateProviderQualification({ evidence, observedAt = null }) {
  const current = validateEvidence(evidence);
  const effectiveObservedAt = observedAt ?? current.releaseDecision.evaluatedAt;
  assertStrictTime(effectiveObservedAt, "observedAt");
  assert(effectiveObservedAt === current.releaseDecision.evaluatedAt, "QUALIFICATION_STALE_OBSERVATION", "qualification observation must match the supplied ReleaseDecision timestamp");
  assert(current.releaseEvaluation.evaluatedAt === current.releaseDecision.evaluatedAt, "QUALIFICATION_STALE_EVALUATION", "release evaluation timestamp must match the supplied ReleaseDecision timestamp");

  const evidenceArtifacts = EVIDENCE_KEYS.map((key) => {
    const entry = evidence[key];
    return {
      role: entry.artifact.role,
      path: entry.artifact.path,
      size: entry.artifact.size,
      sha256: entry.artifact.sha256,
      artifactProfile: entry.value.profile ?? entry.value.properties?.profile?.const ?? null,
    };
  }).sort((left, right) => left.path.localeCompare(right.path, "en"));

  const keyIds = sortedUnique(current.trustPolicy.keyring.map((entry) => entry.kid), "keyIds");
  const authorityRevisionIds = sortedUnique(current.trustPolicy.authorities.map((entry) => entry.authorityRevisionId), "authorityRevisionIds");
  const replayProfile = current.replaySchema.properties.profile.const;
  const releaseSubject = clone(current.releaseDecision.releaseSubject);
  const blockerSet = current.releaseArrays.blocking;
  const pendingCount = current.targetBinding.interfaceBindings.filter((binding) => binding.state === "TARGET_EVIDENCE_PENDING").length;
  const totalCount = current.targetBinding.interfaceBindings.length;

  const qualificationIdentity = {
    qualificationProfile: PROVIDER_QUALIFICATION_PROFILE,
    providerRevision: "v1",
    confirmationTrust: {
      reportProfile: current.confirmationTrust.profile,
      reportSha256: evidence.confirmationTrust.artifact.sha256,
      negativeSummary: clone(current.confirmationTrust.negativeSummary),
    },
    trustPolicy: {
      policyId: current.trustPolicy.policyId,
      fixtureOnly: current.trustPolicy.fixtureOnly,
      keyIds,
      authorityRevisionIds,
    },
    replaySchema: {
      profile: replayProfile,
      schemaId: current.replaySchema.$id,
      schemaSha256: evidence.replaySchema.artifact.sha256,
    },
    capabilityRules: Object.fromEntries(Object.entries(CAPABILITY_RULES).map(([id, rule]) => [id, rule.status])),
  };
  const environmentDescriptor = {
    providerProfile: PROVIDER_QUALIFICATION_PROFILE,
    providerRevision: "v1",
    confirmationTrust: clone(qualificationIdentity.confirmationTrust),
    trustPolicy: clone(qualificationIdentity.trustPolicy),
    replaySchema: clone(qualificationIdentity.replaySchema),
    capabilityRules: clone(qualificationIdentity.capabilityRules),
  };
  const environmentId = computeEnvironmentId(environmentDescriptor);
  const capabilityEvidence = {
    corePass: true,
    publicKeyIdentity: true,
    replayIdentity: true,
    // The reference manifest has no production capability artifacts. The
    // closed-world result is therefore missing until a verified adapter adds
    // an explicitly modeled artifact and semantic verifier.
    productTransactionDurability: false,
    productionKeyCustody: false,
    productionKeyLifecycle: false,
    familyAuthorityResolver: false,
    providerGateVerifier: false,
    environmentBinding: false,
    nonSyntheticProductionReceipt: false,
  };
  const qualificationLevels = levelMatrix({
    corePass: capabilityEvidence.corePass,
    productTransactionDurability: capabilityEvidence.productTransactionDurability,
    productionKeyCustody: capabilityEvidence.productionKeyCustody,
    productionKeyLifecycle: capabilityEvidence.productionKeyLifecycle,
    authorityEvidence: capabilityEvidence.familyAuthorityResolver,
    providerGateVerifier: capabilityEvidence.providerGateVerifier,
    environmentBinding: capabilityEvidence.environmentBinding,
    nonSyntheticProductionReceipt: capabilityEvidence.nonSyntheticProductionReceipt,
  });
  const capabilities = capabilityMatrix(capabilityEvidence);
  const levelSummary = levelFrontier(qualificationLevels);
  const missingCapabilities = [...new Set([
    ...capabilities.filter((entry) => entry.status !== "PASS").map((entry) => entry.id),
    ...Object.values(qualificationLevels).flatMap((entry) => entry.missingCapabilities),
  ])].sort((left, right) => left.localeCompare(right, "en"));

  const report = {
    schemaVersion: 1,
    profile: QUALIFICATION_REPORT_PROFILE,
    qualificationId: "qualification:sha256:pending",
    qualificationProfile: PROVIDER_QUALIFICATION_PROFILE,
    qualificationIdentity,
    environmentId,
    environmentDescriptor,
    observedAt: effectiveObservedAt,
    fixtureOnly: true,
    syntheticEvidence: true,
    productionEligible: false,
    gateEligible: false,
    productionGateClosed: true,
    productionGateState: "MISSING",
    productionGateId: PRODUCTION_CONFIRMATION_GATE_ID,
    productionReceiptCreated: false,
    noProductionReceiptCreated: true,
    boardTarget: "UNRESOLVED",
    targetEvidencePending: `${pendingCount}/${totalCount}`,
    hardwareImpact: "NONE",
    offlineReady: false,
    currentLevel: levelSummary.currentLevel,
    assessedThroughLevel: levelSummary.assessedThroughLevel,
    status: levelSummary.status,
    qualificationLevels,
    capabilities,
    missingCapabilities,
    negativeSummary: clone(current.confirmationTrust.negativeSummary),
    redaction: {
      profile: "public-evidence-v1",
      passed: true,
      scannedArtifactCount: evidenceArtifacts.length,
      secretLikeFieldCount: 0,
      absolutePathCount: 0,
      usernameCount: 0,
      hostnameCount: 0,
      internalHandleCount: 0,
    },
    release: {
      catalogId: current.releaseCatalog.catalogId,
      catalogVersion: current.releaseCatalog.catalogVersion,
      decisionId: current.releaseDecision.decisionId,
      decisionSha256: evidence.releaseDecision.artifact.sha256,
      releaseSubject,
      releaseReady: current.releaseDecision.releaseReady,
      passedCount: current.releaseArrays.passed.length,
      failedCount: current.releaseArrays.failed.length,
      missingCount: current.releaseArrays.missing.length,
      blockingCount: current.releaseArrays.blocking.length,
      productionGateInMissing: current.releaseArrays.missing.includes(PRODUCTION_CONFIRMATION_GATE_ID),
    },
    targetBinding: {
      profile: current.targetBinding.profile,
      artifactSha256: evidence.targetBinding.artifact.sha256,
      boardTarget: "UNRESOLVED",
      targetState: current.targetBinding.targetIdentity.state,
      pendingCount,
      totalCount,
      hardwareImpact: "NONE",
      offlineReady: false,
    },
    evidenceArtifacts,
    releaseGateNegativeControl: {
      controlId: "NEG-22-production-confirmation-self-report",
      expected: "configured-production-verifier-required",
    },
  };
  report.qualificationId = computeQualificationId(report);

  const binding = {
    schemaVersion: 1,
    profile: RELEASE_BINDING_PROFILE,
    bindingId: "binding:sha256:pending",
    qualificationId: report.qualificationId,
    qualificationProfile: PROVIDER_QUALIFICATION_PROFILE,
    releaseSubject,
    catalogId: current.releaseCatalog.catalogId,
    catalogVersion: current.releaseCatalog.catalogVersion,
    decisionId: current.releaseDecision.decisionId,
    releaseDecisionSha256: evidence.releaseDecision.artifact.sha256,
    releaseReady: current.releaseDecision.releaseReady,
    blockerSet,
    targetSnapshot: {
      profile: current.targetBinding.profile,
      artifactSha256: evidence.targetBinding.artifact.sha256,
      state: current.targetBinding.targetIdentity.state,
      pendingCount,
      totalCount,
    },
    state: "BLOCKED",
    fixtureOnly: true,
    syntheticEvidence: true,
    productionEligible: false,
    gateEligible: false,
    providerQualificationReceiptId: null,
    buildAuthorizationIds: [],
    buildSubjectSha256: [],
    sealed: false,
    productionAuthorized: false,
  };
  binding.bindingId = computeReleaseCandidateBindingId(binding);
  report.bindingProjection = binding;
  assertQualificationReport(report);
  return { report, binding };
}
