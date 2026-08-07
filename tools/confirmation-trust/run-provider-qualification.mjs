import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStrictJson } from "../../contracts/strict-json-v1.mjs";
import { computeReleaseDecisionId } from "../../contracts/release-gates-v1.mjs";
import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";
import {
  EVIDENCE_KEYS,
  PRODUCTION_CONFIRMATION_GATE_ID,
  PROVIDER_QUALIFICATION_PROFILE,
  QUALIFICATION_REPORT_PROFILE,
  assertQualificationReport,
  assertReleaseCandidateBinding,
  computeQualificationId,
  computeReleaseCandidateBindingId,
  evaluateProviderQualification,
} from "./provider-qualification.mjs";
import {
  cloneEvidence,
  collectProviderQualificationEvidence,
  createProviderQualificationEvidenceAdapter,
} from "./provider-qualification-evidence-adapter.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const REPORT_ROOT = path.join(REPO_ROOT, "build/confirmation-provider-qualification");
const TEST_ROOT = path.join(REPO_ROOT, "build/luna-production-authority-level-repair");
const REPORT_PATH = path.join(REPORT_ROOT, "report.json");
const BINDING_PATH = path.join(REPORT_ROOT, "release-candidate-binding.json");
const TEST_REPORT_PATH = path.join(TEST_ROOT, "test-report.json");

// Repository ownership and composition belong to this runner, not the pure core.
export const CURRENT_EVIDENCE_MANIFEST = Object.freeze({
  confirmationTrust: Object.freeze({ role: "confirmation-trust-report", path: "build/confirmation-trust-validation/report.json" }),
  trustPolicy: Object.freeze({ role: "trust-policy-public-identity", path: "hardware/evt0/confirmation-trust-v1/golden/trust-policy.json" }),
  replaySchema: Object.freeze({ role: "replay-ledger-schema", path: "hardware/evt0/confirmation-trust-v1/replay-ledger.schema.json" }),
  releaseDecision: Object.freeze({ role: "release-decision", path: "build/release-gate-current/release-decision.json" }),
  releaseEvaluation: Object.freeze({ role: "release-evaluation-report", path: "build/release-gate-current/report.json" }),
  releaseCatalog: Object.freeze({ role: "release-gate-catalog", path: "hardware/evt0/release-gates-v1/catalog.json" }),
  targetBinding: Object.freeze({ role: "target-binding-snapshot", path: "hardware/evt0/hardware-system-v1/target-binding.json" }),
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function clone(value) {
  return structuredClone(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRelative(relativePath) {
  assert(
    typeof relativePath === "string"
      && relativePath.length > 0
      && !path.isAbsolute(relativePath)
      && !relativePath.includes("\\")
      && !relativePath.split("/").includes(".."),
    `unsafe repository-relative path: ${relativePath}`,
  );
  return relativePath;
}

async function readRepositoryArtifact(relativePath) {
  return readFile(path.join(REPO_ROOT, safeRelative(relativePath)));
}

async function writeOwnedJson(filePath, value) {
  const resolvedRoot = path.resolve(REPORT_ROOT);
  const resolvedFile = path.resolve(filePath);
  assert(resolvedFile.startsWith(`${resolvedRoot}${path.sep}`), "qualification output escaped its owned evidence directory");
  await mkdir(path.dirname(resolvedFile), { recursive: true });
  const bytes = encode(value);
  const temporary = `${resolvedFile}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, resolvedFile);
  return bytes;
}

async function writeOwnedTestJson(value) {
  const resolvedRoot = path.resolve(TEST_ROOT);
  const resolvedFile = path.resolve(TEST_REPORT_PATH);
  assert(resolvedFile.startsWith(`${resolvedRoot}${path.sep}`), "qualification test output escaped its owned review directory");
  await mkdir(resolvedRoot, { recursive: true });
  const bytes = encode(value);
  const temporary = `${resolvedFile}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, resolvedFile);
  return bytes;
}

async function existingBytes(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function makeCounter() {
  const checks = [];
  return {
    check(id, condition, details = null) {
      if (!condition) throw new Error(`check failed: ${id}`);
      checks.push({ id, passed: true, details });
    },
    async rejects(id, operation, expectedCodes = []) {
      try {
        await operation();
      } catch (error) {
        if (expectedCodes.length > 0 && !expectedCodes.includes(error?.code)) {
          throw new Error(`negative ${id} returned unexpected code ${error?.code ?? "unknown"}`);
        }
        checks.push({ id, passed: true, errorCode: error?.code ?? "ERROR" });
        return;
      }
      throw new Error(`negative ${id} unexpectedly succeeded`);
    },
    get list() { return checks; },
    get count() { return checks.length; },
  };
}

async function collectWithReader(reader) {
  return collectProviderQualificationEvidence({ manifest: CURRENT_EVIDENCE_MANIFEST, readArtifact: reader });
}

async function withChangedArtifact(pathToChange, replacement, operation) {
  const replacementReader = async (relativePath) => relativePath === pathToChange ? Buffer.from(replacement, "utf8") : readRepositoryArtifact(relativePath);
  return operation(replacementReader);
}

function refreshSyntheticEntry(evidence, key) {
  const entry = evidence[key];
  const bytes = encode(entry.value);
  entry.artifact.size = bytes.length;
  entry.artifact.sha256 = sha256(bytes);
}

function refreshSyntheticDecision(evidence) {
  evidence.releaseDecision.value.decisionId = computeReleaseDecisionId(evidence.releaseDecision.value);
  refreshSyntheticEntry(evidence, "releaseDecision");
  evidence.releaseEvaluation.value.decisionId = evidence.releaseDecision.value.decisionId;
  refreshSyntheticEntry(evidence, "releaseEvaluation");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

async function main() {
  const counter = makeCounter();
  const adapter = createProviderQualificationEvidenceAdapter({ manifest: CURRENT_EVIDENCE_MANIFEST, readArtifact: readRepositoryArtifact });
  const evidence = await adapter.collect();
  const observedAt = evidence.releaseDecision.value.evaluatedAt;
  const first = evaluateProviderQualification({ evidence, observedAt });
  const second = evaluateProviderQualification({ evidence: cloneEvidence(evidence), observedAt });
  const beforeReport = await existingBytes(REPORT_PATH);

  counter.check("baseline-report-contract", first.report.profile === QUALIFICATION_REPORT_PROFILE);
  counter.check("baseline-reference-provider-profile", first.report.qualificationProfile === PROVIDER_QUALIFICATION_PROFILE);
  counter.check("baseline-fixture-only", first.report.fixtureOnly === true);
  counter.check("baseline-synthetic", first.report.syntheticEvidence === true);
  counter.check("baseline-production-ineligible", first.report.productionEligible === false);
  counter.check("baseline-gate-ineligible", first.report.gateEligible === false);
  counter.check("baseline-production-gate-closed", first.report.productionGateClosed === true);
  counter.check("baseline-production-gate-missing", first.report.productionGateState === "MISSING" && first.report.productionGateId === PRODUCTION_CONFIRMATION_GATE_ID);
  counter.check("baseline-no-production-receipt", first.report.productionReceiptCreated === false && first.report.noProductionReceiptCreated === true);
  counter.check("baseline-l0-pass", first.report.qualificationLevels.L0.status === "PASS");
  counter.check("baseline-l1-partial", first.report.qualificationLevels.L1.status === "PARTIAL");
  counter.check("baseline-current-level-l0", first.report.currentLevel === "L0" && first.report.assessedThroughLevel === "L1");
  counter.check("baseline-overall-partial", first.report.status === "PARTIAL");
  counter.check("baseline-l2-missing", first.report.qualificationLevels.L2.status === "MISSING");
  counter.check("baseline-l3-missing", first.report.qualificationLevels.L3.status === "MISSING");
  counter.check("baseline-l4-blocked", first.report.qualificationLevels.L4.status === "BLOCKED");
  counter.check("self-declared-flags-do-not-promote", first.report.qualificationLevels.L1.status === "PARTIAL" && first.report.qualificationLevels.L2.status === "MISSING" && first.report.qualificationLevels.L3.status === "MISSING" && first.report.qualificationLevels.L4.status === "BLOCKED" && first.report.productionEligible === false && first.report.gateEligible === false);
  counter.check("baseline-negative-summary", first.report.negativeSummary.total > 0 && first.report.negativeSummary.passed === first.report.negativeSummary.total && first.report.negativeSummary.zeroSideEffect === first.report.negativeSummary.total);
  counter.check("baseline-release-not-ready", first.report.release.releaseReady === false);
  counter.check("baseline-release-counts", first.report.release.passedCount === 15 && first.report.release.failedCount === 0 && first.report.release.missingCount === 19 && first.report.release.blockingCount === 19);
  counter.check("baseline-production-gate-in-blockers", first.report.release.productionGateInMissing === true && first.binding.blockerSet.includes(PRODUCTION_CONFIRMATION_GATE_ID));
  counter.check("baseline-target-unresolved", first.report.targetBinding.boardTarget === "UNRESOLVED" && first.report.targetBinding.targetState === "UNRESOLVED");
  counter.check("baseline-target-pending", first.report.targetBinding.pendingCount === 18 && first.report.targetBinding.totalCount === 18 && first.report.targetEvidencePending === "18/18");
  counter.check("baseline-hardware-neutral", first.report.targetBinding.hardwareImpact === "NONE" && first.report.targetBinding.offlineReady === false && first.report.hardwareImpact === "NONE");
  counter.check("baseline-binding-blocked", first.binding.state === "BLOCKED" && first.binding.sealed === false);
  counter.check("baseline-binding-not-authorized", first.binding.productionAuthorized === false && first.binding.providerQualificationReceiptId === null);
  counter.check("baseline-report-identity", first.report.qualificationId.startsWith("qualification:sha256:") && first.report.qualificationId === second.report.qualificationId);
  counter.check("baseline-binding-identity", first.binding.bindingId.startsWith("binding:sha256:") && first.binding.bindingId === second.binding.bindingId);
  counter.check("deterministic-report-bytes", JSON.stringify(first.report) === JSON.stringify(second.report));
  counter.check("deterministic-binding-bytes", JSON.stringify(first.binding) === JSON.stringify(second.binding));
  counter.check("deterministic-environment-id", first.report.environmentId === second.report.environmentId);
  counter.check("dynamic-artifact-refs", first.report.evidenceArtifacts.length === EVIDENCE_KEYS.length && first.report.evidenceArtifacts.every((artifact) => /^[a-f0-9]{64}$/u.test(artifact.sha256)));
  counter.check("public-redaction-passed", first.report.redaction.passed === true && first.report.redaction.secretLikeFieldCount === 0 && first.report.redaction.absolutePathCount === 0);
  counter.check("missing-capabilities-visible", first.report.missingCapabilities.includes("productTransactionDurability") && first.report.missingCapabilities.includes("productionKeyCustody") && first.report.missingCapabilities.includes("familyAuthorityResolver") && first.report.missingCapabilities.includes("providerGateVerifier"));
  counter.check("l1-durability-gaps-visible", first.report.qualificationLevels.L1.missingCapabilities.includes("parentDirectoryFsync") && first.report.qualificationLevels.L1.missingCapabilities.includes("powerLossDurability") && first.report.qualificationLevels.L1.missingCapabilities.includes("multiprocessRecovery"));
  counter.check("release-subject-bound", first.binding.releaseSubject.subjectType === "PRODUCT_RELEASE" && first.binding.releaseSubject.subjectRevisionSha256.length === 64);
  counter.check("decision-bound", first.binding.decisionId === first.report.release.decisionId && first.binding.catalogId === first.report.release.catalogId);
  counter.check("negative-control-recorded", first.report.releaseGateNegativeControl.controlId === "NEG-22-production-confirmation-self-report");
  counter.check("pure-core-no-snapshot-coupling", (() => {
    const source = requirePureSource();
    return !source.includes("build/") && !source.includes("hardware/evt0/") && !source.includes("2026-08-04T23:43:08.147Z") && !source.match(/\b[a-f0-9]{64}\b/u);
  })());
  counter.check("key-custody-lifecycle-conjunction", (() => {
    const source = requirePureSource();
    return /const l2 = productionKeyCustody\s*&&\s*productionKeyLifecycle/u.test(source)
      && /productionKeyCustody:\s*capabilityEvidence\.productionKeyCustody\s*&&\s*capabilityEvidence\.productionKeyLifecycle/u.test(source)
      && /l2 === "PASS"/u.test(source);
  })());
  const softwareProjection = JSON.stringify({ qualificationLevels: first.report.qualificationLevels, capabilities: first.report.capabilities, missingCapabilities: first.report.missingCapabilities, environmentId: first.report.environmentId });
  counter.check("software-projection-hardware-neutral", !softwareProjection.match(/\b(?:OID|USB|firmware|storage|audio)\b/u));
  counter.check("no-absolute-paths", !JSON.stringify(first.report).match(/(?:[A-Za-z]:\\|\\\\|\/(?:Users|home|private|tmp|var)\/)/u));

  const freshDecision = cloneEvidence(evidence);
  freshDecision.releaseDecision.value.evaluatedAt = "2030-01-01T00:00:00.000Z";
  freshDecision.releaseEvaluation.value.evaluatedAt = "2030-01-01T00:00:00.000Z";
  freshDecision.releaseDecision.value.receiptIds[0] = "receipt:sha256:" + "b".repeat(64);
  freshDecision.releaseDecision.value.receiptSetSha256 = canonicalSha256(freshDecision.releaseDecision.value.receiptIds).sha256;
  refreshSyntheticDecision(freshDecision);
  const freshResult = evaluateProviderQualification({ evidence: freshDecision, observedAt: "2030-01-01T00:00:00.000Z" });
  counter.check("dynamic-release-timestamp-accepted", freshResult.report.release.decisionId !== first.report.release.decisionId && freshResult.report.qualificationId === first.report.qualificationId && freshResult.report.environmentId === first.report.environmentId && freshResult.binding.bindingId !== first.binding.bindingId && freshResult.report.productionEligible === false);

  const gateDelta = cloneEvidence(evidence);
  const movableGate = gateDelta.releaseDecision.value.missingGateIds.find((gateId) => gateId !== PRODUCTION_CONFIRMATION_GATE_ID);
  gateDelta.releaseDecision.value.missingGateIds = gateDelta.releaseDecision.value.missingGateIds.filter((gateId) => gateId !== movableGate);
  gateDelta.releaseDecision.value.passedGateIds = sorted([...gateDelta.releaseDecision.value.passedGateIds, movableGate]);
  gateDelta.releaseDecision.value.blockingGateIds = sorted([...gateDelta.releaseDecision.value.failedGateIds, ...gateDelta.releaseDecision.value.missingGateIds]);
  gateDelta.releaseEvaluation.value.summary = {
    gates: gateDelta.releaseCatalog.value.gates.length,
    passed: gateDelta.releaseDecision.value.passedGateIds.length,
    failed: gateDelta.releaseDecision.value.failedGateIds.length,
    missing: gateDelta.releaseDecision.value.missingGateIds.length,
    blocking: gateDelta.releaseDecision.value.blockingGateIds.length,
  };
  gateDelta.releaseEvaluation.value.blockingGateIds = clone(gateDelta.releaseDecision.value.blockingGateIds);
  refreshSyntheticDecision(gateDelta);
  const gateDeltaResult = evaluateProviderQualification({ evidence: gateDelta, observedAt });
  counter.check("dynamic-nonproduction-gate-count-accepted", gateDeltaResult.report.release.passedCount === 16 && gateDeltaResult.report.release.missingCount === 18 && gateDeltaResult.report.release.blockingCount === 18 && gateDeltaResult.report.qualificationId === first.report.qualificationId && gateDeltaResult.report.environmentId === first.report.environmentId && gateDeltaResult.binding.bindingId !== first.binding.bindingId);

  const targetDelta = cloneEvidence(evidence);
  targetDelta.targetBinding.value.interfaceBindings[0].state = "NOT_APPLICABLE";
  targetDelta.targetBinding.value.interfaceBindings[0].edaReadiness = "NOT_APPLICABLE";
  targetDelta.targetBinding.value.interfaceBindings[0].blocker = null;
  refreshSyntheticEntry(targetDelta, "targetBinding");
  const targetDeltaResult = evaluateProviderQualification({ evidence: targetDelta, observedAt });
  counter.check("dynamic-target-pending-count-accepted", targetDeltaResult.report.targetBinding.pendingCount === 17 && targetDeltaResult.report.targetBinding.totalCount === 18 && targetDeltaResult.report.qualificationId === first.report.qualificationId && targetDeltaResult.report.environmentId === first.report.environmentId && targetDeltaResult.binding.bindingId !== first.binding.bindingId && targetDeltaResult.report.productionEligible === false);

  await counter.rejects("tampered-confirmation-bytes", () => withChangedArtifact(CURRENT_EVIDENCE_MANIFEST.confirmationTrust.path, "tampered", (reader) => collectWithReader(reader)), ["QUALIFICATION_ARTIFACT_JSON"]);
  await counter.rejects("truncated-confirmation-bytes", () => withChangedArtifact(CURRENT_EVIDENCE_MANIFEST.confirmationTrust.path, "{", (reader) => collectWithReader(reader)), ["QUALIFICATION_ARTIFACT_JSON"]);
  await counter.rejects("duplicate-key-confirmation-bytes", () => withChangedArtifact(CURRENT_EVIDENCE_MANIFEST.confirmationTrust.path, '{"a":1,"a":2}', (reader) => collectWithReader(reader)), ["ERR_STRICT_JSON_DUPLICATE_KEY", "QUALIFICATION_ARTIFACT_JSON"]);
  await counter.rejects("duplicate-key-json-parser", () => parseStrictJson('{"a":1,"a":2}', "duplicate-key-fixture"), ["ERR_STRICT_JSON_DUPLICATE_KEY"]);
  await counter.rejects("wrong-report-profile", () => { const altered = cloneEvidence(evidence); altered.confirmationTrust.value.profile = "wrong-profile"; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_REPORT_PROFILE"]);
  await counter.rejects("self-declared-capability-flags", () => {
    const altered = cloneEvidence(evidence);
    altered.capabilities = {
      productTransactionDurability: true,
      productionKeyCustody: true,
      productionKeyLifecycle: true,
      familyAuthorityResolver: true,
      providerGateVerifier: true,
      environmentBinding: true,
      nonSyntheticProductionReceipt: true,
    };
    return evaluateProviderQualification({ evidence: altered, observedAt });
  }, ["QUALIFICATION_CAPABILITIES_UNEXPECTED"]);
  await counter.rejects("wrong-negative-total", () => { const altered = cloneEvidence(evidence); altered.confirmationTrust.value.negativeSummary.total = 0; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_NEGATIVE_SUMMARY"]);
  await counter.rejects("wrong-negative-zero-side-effect", () => { const altered = cloneEvidence(evidence); altered.confirmationTrust.value.negativeSummary.zeroSideEffect = altered.confirmationTrust.value.negativeSummary.total - 1; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_NEGATIVE_SUMMARY"]);
  await counter.rejects("forged-report-production-eligible", () => { const altered = clone(first.report); altered.productionEligible = true; return assertQualificationReport(altered); }, ["QUALIFICATION_PROMOTION"]);
  await counter.rejects("forged-report-gate-eligible", () => { const altered = clone(first.report); altered.gateEligible = true; return assertQualificationReport(altered); }, ["QUALIFICATION_PROMOTION"]);
  await counter.rejects("forged-report-fixture-boundary", () => { const altered = clone(first.report); altered.fixtureOnly = false; return assertQualificationReport(altered); }, ["QUALIFICATION_BOUNDARY"]);
  await counter.rejects("forged-release-ready", () => { const altered = cloneEvidence(evidence); altered.releaseDecision.value.releaseReady = true; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_DECISION_ID", "QUALIFICATION_RELEASE_READY"]);
  await counter.rejects("stale-release-decision-time", () => { const altered = cloneEvidence(evidence); altered.releaseDecision.value.evaluatedAt = "2030-01-01T00:00:00.000Z"; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_STALE_OBSERVATION", "QUALIFICATION_STALE_EVALUATION", "QUALIFICATION_DECISION_ID"]);
  await counter.rejects("stale-release-subject", () => { const altered = cloneEvidence(evidence); altered.releaseDecision.value.releaseSubject.subjectId = "OTHER-RELEASE"; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_DECISION_ID"]);
  await counter.rejects("stale-evaluation-subject", () => { const altered = cloneEvidence(evidence); altered.releaseEvaluation.value.releaseSubject.subjectId = "OTHER-RELEASE"; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_RELEASE_SUBJECT"]);
  await counter.rejects("resolved-target-binding", () => { const altered = cloneEvidence(evidence); altered.targetBinding.value.targetIdentity.state = "FROZEN"; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_TARGET_STATE"]);
  await counter.rejects("partial-target-binding", () => { const altered = cloneEvidence(evidence); altered.targetBinding.value.interfaceBindings = []; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_TARGET_PENDING"]);
  await counter.rejects("missing-production-gate", () => { const altered = cloneEvidence(evidence); altered.releaseDecision.value.missingGateIds = altered.releaseDecision.value.missingGateIds.filter((id) => id !== PRODUCTION_CONFIRMATION_GATE_ID); return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_DECISION_ID", "QUALIFICATION_GATE_MISSING"]);
  await counter.rejects("external-receipt-present", () => { const altered = cloneEvidence(evidence); altered.releaseEvaluation.value.externalReceiptCount = 1; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_EXTERNAL_RECEIPT"]);
  await counter.rejects("production-trust-policy", () => { const altered = cloneEvidence(evidence); altered.trustPolicy.value.fixtureOnly = false; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_TRUST_POLICY", "CONFIRMATION_POLICY_INVALID"]);
  await counter.rejects("duplicate-report-artifact", () => { const altered = clone(first.report); altered.evidenceArtifacts.push(clone(altered.evidenceArtifacts[0])); return assertQualificationReport(altered); }, ["QUALIFICATION_REPORT_ID", "QUALIFICATION_ARTIFACT_SET"]);
  await counter.rejects("absolute-report-artifact-path", () => { const altered = clone(first.report); altered.evidenceArtifacts[0].path = ["C:", "secrets", "report.json"].join("\\"); return assertQualificationReport(altered); }, ["QUALIFICATION_ARTIFACT_PATH_INVALID"]);
  await counter.rejects("secret-token-field", () => { const altered = clone(first.report); altered.secretToken = "redacted-test-value"; return assertQualificationReport(altered); }, ["QUALIFICATION_SECRET_FIELD"]);
  await counter.rejects("hostname-field", () => { const altered = clone(first.report); altered.hostname = "host-fixture"; return assertQualificationReport(altered); }, ["QUALIFICATION_SECRET_FIELD"]);
  await counter.rejects("sealed-binding", () => { const altered = clone(first.binding); altered.state = "SEALED"; return assertReleaseCandidateBinding(altered); }, ["QUALIFICATION_BINDING_ID", "QUALIFICATION_BINDING_STATE"]);
  await counter.rejects("binding-receipt-promotion", () => { const altered = clone(first.binding); altered.providerQualificationReceiptId = "receipt:sha256:" + "a".repeat(64); return assertReleaseCandidateBinding(altered); }, ["QUALIFICATION_BINDING_ID", "QUALIFICATION_RECEIPT_CREATED"]);
  await counter.rejects("binding-production-promotion", () => { const altered = clone(first.binding); altered.productionEligible = true; return assertReleaseCandidateBinding(altered); }, ["QUALIFICATION_BINDING_ID", "QUALIFICATION_BINDING_PROMOTION"]);
  await counter.rejects("missing-artifact-evidence", () => { const altered = cloneEvidence(evidence); delete altered.releaseCatalog; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_EVIDENCE_MISSING"]);
  await counter.rejects("mismatched-catalog-bytes", () => withChangedArtifact(CURRENT_EVIDENCE_MANIFEST.releaseCatalog.path, "tampered-catalog", (reader) => collectWithReader(reader)), ["QUALIFICATION_ARTIFACT_JSON"]);
  await counter.rejects("bad-observation-time", () => evaluateProviderQualification({ evidence, observedAt: "not-a-time" }), ["QUALIFICATION_TIME_INVALID"]);
  await counter.rejects("l1-promotion", () => { const altered = clone(first.report); altered.qualificationLevels.L1.productionEligible = true; return assertQualificationReport(altered); }, ["QUALIFICATION_LEVEL_PROMOTION"]);
  await counter.rejects("binding-empty-blocker-set", () => { const altered = clone(first.binding); altered.blockerSet = []; return assertReleaseCandidateBinding(altered); }, ["QUALIFICATION_BINDING_ID", "QUALIFICATION_BINDING_BLOCKERS"]);
  await counter.rejects("binding-target-overflow", () => { const altered = clone(first.binding); altered.targetSnapshot.pendingCount = altered.targetSnapshot.totalCount + 1; return assertReleaseCandidateBinding(altered); }, ["QUALIFICATION_BINDING_ID", "QUALIFICATION_BINDING_TARGET"]);
  await counter.rejects("wrong-evaluation-count", () => { const altered = cloneEvidence(evidence); altered.releaseEvaluation.value.summary.missing += 1; return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_EVALUATION_COUNTS"]);
  await counter.rejects("wrong-catalog-binding", () => { const altered = cloneEvidence(evidence); altered.releaseEvaluation.value.catalogId = "rgc:sha256:" + "a".repeat(64); return evaluateProviderQualification({ evidence: altered, observedAt }); }, ["QUALIFICATION_EVALUATION_CATALOG"]);

  const afterNegatives = await existingBytes(REPORT_PATH);
  counter.check("negative-failure-output-unchanged", (beforeReport === null && afterNegatives === null) || (beforeReport !== null && afterNegatives !== null && Buffer.compare(beforeReport, afterNegatives) === 0));

  const releaseEvidenceEntries = await readdir(path.join(REPO_ROOT, "hardware/evt0/release-evidence"), { withFileTypes: true });
  counter.check("no-provider-receipt-file", !releaseEvidenceEntries.some((entry) => entry.isFile() && entry.name.endsWith(".receipt.json")));
  counter.check("no-production-receipt-in-report", !JSON.stringify(first.report).includes("provider-qualification.receipt"));
  counter.check("no-hardware-artifact-output", !JSON.stringify(first.binding).match(/hardware\/evt0\/(?:device|firmware|board|oid)/iu));

  assertQualificationReport(first.report);
  assertReleaseCandidateBinding(first.binding);
  const reportBytes = await writeOwnedJson(REPORT_PATH, first.report);
  const bindingBytes = await writeOwnedJson(BINDING_PATH, first.binding);
  const testReport = {
    schemaVersion: 1,
    profile: "provider-qualification-test-report-v1",
    observedAt,
    qualificationId: first.report.qualificationId,
    bindingId: first.binding.bindingId,
    checks: { total: counter.count, passed: counter.count, failed: 0 },
    negativeChecks: counter.list.filter((entry) => entry.id.includes("-") && !entry.id.startsWith("baseline-")).length,
    dynamicChecks: ["release-timestamp", "non-production-gate-count", "target-pending-count"],
    deterministic: true,
    productionEligible: false,
    gateEligible: false,
    productionReceiptCreated: false,
    reportSha256: sha256(reportBytes),
    bindingSha256: sha256(bindingBytes),
  };
  const testBytes = await writeOwnedTestJson(testReport);
  assert(testBytes.length > 0, "qualification test report must be non-empty");
  const statReport = await stat(REPORT_PATH);
  const statBinding = await stat(BINDING_PATH);
  assert(statReport.isFile() && statBinding.isFile(), "qualification outputs must be regular files");
  console.log(`Provider qualification: checks=${counter.count}/${counter.count}; level=L0 PASS, L1 PARTIAL, L2/L3 MISSING, L4 BLOCKED`);
  console.log(`Qualification report: ${first.report.qualificationId}`);
  console.log(`Release binding: ${first.binding.bindingId} state=${first.binding.state}`);
}

function requirePureSource() {
  return readFileSync(path.join(TOOL_ROOT, "provider-qualification.mjs"), "utf8");
}

try {
  await main();
} catch (error) {
  console.error(`${error?.code ?? "QUALIFICATION_RUN_FAILED"}: ${error?.message ?? String(error)}`);
  process.exitCode = 1;
}
