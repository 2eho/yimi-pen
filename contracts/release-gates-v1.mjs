import { canonicalSha256 } from "../scripts/snapshot-jcs.mjs";
import { isStrictRfc3339 } from "./rfc3339.mjs";

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert(!seen.has(value), `${label} must be unique: ${value}`);
    seen.add(value);
  }
}

function assertOrdinallySorted(values, label) {
  assert(values.every((value, index) => index === 0 || values[index - 1] < value), `${label} must be strictly ordinally sorted`);
}

function identityWithout(value, key) {
  const { [key]: _ignored, ...identity } = value;
  return identity;
}

export function computeReleaseGateCatalogId(catalog) {
  return `rgc:sha256:${canonicalSha256(identityWithout(catalog, "catalogId")).sha256}`;
}

export function computeEvidenceReceiptId(receipt) {
  return `receipt:sha256:${canonicalSha256(identityWithout(receipt, "receiptId")).sha256}`;
}

export function computeReleaseDecisionId(decision) {
  const { decisionId: _decisionId, evaluatedAt: _evaluatedAt, ...identity } = decision;
  return `decision:sha256:${canonicalSha256(identity).sha256}`;
}

export function assertReleaseGateCatalog(catalog) {
  assert(catalog.catalogId === computeReleaseGateCatalogId(catalog), "release gate catalog identity mismatch");
  const semanticPaths = Object.keys(catalog.semanticFiles);
  assertUnique(semanticPaths, "catalog semantic path");
  assertOrdinallySorted(semanticPaths, "catalog semantic paths");
  for (const [semanticPath, digest] of Object.entries(catalog.semanticFiles)) {
    assert(typeof semanticPath === "string" && semanticPath.length > 0, "catalog semantic path must be non-empty");
    assert(/^[a-f0-9]{64}$/u.test(digest), `catalog semantic hash is invalid: ${semanticPath}`);
  }
  const gateIds = catalog.gates.map((gate) => gate.gateId);
  assertUnique(gateIds, "gateId");
  assertOrdinallySorted(gateIds, "catalog gates");
  const aliases = catalog.gates.flatMap((gate) => gate.legacyAliases);
  assertUnique(aliases, "legacy alias");
  const gateSet = new Set(gateIds);
  for (const gate of catalog.gates) {
    assert(!gate.legacyAliases.some((alias) => gateSet.has(alias)), `${gate.gateId} legacy alias collides with a gate ID`);
    assertUnique(gate.acceptedProducerIds, `${gate.gateId} accepted producer`);
    assertUnique(gate.evidenceSubjectTypes, `${gate.gateId} evidence subject type`);
    assertUnique(gate.requiredArtifactRoles, `${gate.gateId} artifact role`);
    assertUnique(gate.reportScopes, `${gate.gateId} report scope`);
    assert(gate.minDistinctEvidenceSubjects <= gate.minReceipts, `${gate.gateId} distinct subject count exceeds receipt count`);
    if (gate.evidenceClass !== "host") {
      assert(gate.allowSyntheticEvidence === false, `${gate.gateId} physical/production gate permits synthetic evidence`);
    }
  }
  return catalog;
}

export function gateByIdOrAlias(catalog, value) {
  const canonical = catalog.gates.find((gate) => gate.gateId === value);
  if (canonical) return canonical;
  return catalog.gates.find((gate) => gate.legacyAliases.includes(value)) ?? null;
}

export function gateIdsForReportScope(catalog, scope) {
  assertReleaseGateCatalog(catalog);
  return catalog.gates.filter((gate) => gate.reportScopes.includes(scope)).map((gate) => gate.gateId);
}

function sameReleaseSubject(left, right) {
  return left.subjectType === right.subjectType
    && left.subjectId === right.subjectId
    && left.subjectRevisionSha256 === right.subjectRevisionSha256;
}

export function assertEvidenceReceipt(receipt, catalog) {
  assertReleaseGateCatalog(catalog);
  assert(receipt.catalogId === catalog.catalogId && receipt.catalogVersion === catalog.catalogVersion, "receipt catalog binding mismatch");
  const gate = catalog.gates.find((candidate) => candidate.gateId === receipt.gateId);
  assert(gate, `receipt names unknown or legacy gate ID: ${receipt.gateId}`);
  assert(gate.evidenceClass === receipt.evidenceClass, `${receipt.gateId} evidence class mismatch`);
  assert(gate.acceptedProducerIds.includes(receipt.producer.producerId), `${receipt.gateId} producer is not accepted`);
  assert(gate.evidenceSubjectTypes.includes(receipt.evidenceSubject.subjectType), `${receipt.gateId} evidence subject type is not accepted`);
  assert(gate.allowSyntheticEvidence || !receipt.syntheticEvidence, `${receipt.gateId} rejects synthetic evidence`);
  assert(isStrictRfc3339(receipt.executedAt), "receipt executedAt is not strict RFC3339");
  assertUnique(receipt.artifacts.map((artifact) => `${artifact.role}\0${artifact.path}`), "receipt artifact role/path");
  const roles = new Set(receipt.artifacts.map((artifact) => artifact.role));
  for (const role of gate.requiredArtifactRoles) assert(roles.has(role), `${receipt.gateId} receipt lacks artifact role ${role}`);
  assert(receipt.receiptId === computeEvidenceReceiptId(receipt), "evidence receipt identity mismatch");
  return receipt;
}

export function createEvidenceReceipt({ catalog, ...fields }) {
  const receipt = {
    schemaVersion: 1,
    profile: "evidence-receipt-v1",
    receiptId: "receipt:sha256:pending",
    catalogId: catalog.catalogId,
    catalogVersion: catalog.catalogVersion,
    ...fields,
  };
  receipt.receiptId = computeEvidenceReceiptId(receipt);
  return assertEvidenceReceipt(receipt, catalog);
}

export function evaluateRelease({ catalog, releaseSubject, receipts, evaluatedAt }) {
  assertReleaseGateCatalog(catalog);
  assert(isStrictRfc3339(evaluatedAt), "decision evaluatedAt is not strict RFC3339");
  assertUnique(receipts.map((receipt) => receipt.receiptId), "receiptId");
  for (const receipt of receipts) {
    assertEvidenceReceipt(receipt, catalog);
    assert(sameReleaseSubject(receipt.releaseSubject, releaseSubject), `${receipt.receiptId} release subject mismatch`);
  }

  const passedGateIds = [];
  const failedGateIds = [];
  const missingGateIds = [];
  for (const gate of catalog.gates) {
    const matching = receipts.filter((receipt) => receipt.gateId === gate.gateId);
    const results = new Set(matching.map((receipt) => receipt.result));
    assert(results.size <= 1, `${gate.gateId} has conflicting PASS and FAIL receipts`);
    if (results.has("FAIL")) {
      failedGateIds.push(gate.gateId);
      continue;
    }
    const subjects = new Set(matching.map((receipt) => `${receipt.evidenceSubject.subjectType}\0${receipt.evidenceSubject.subjectId}`));
    if (matching.length >= gate.minReceipts && subjects.size >= gate.minDistinctEvidenceSubjects) {
      passedGateIds.push(gate.gateId);
    } else {
      missingGateIds.push(gate.gateId);
    }
  }
  const blockingGateIds = [...failedGateIds, ...missingGateIds].sort((left, right) => left.localeCompare(right, "en"));
  const receiptIds = receipts.map((receipt) => receipt.receiptId).sort((left, right) => left.localeCompare(right, "en"));
  const decision = {
    schemaVersion: 1,
    profile: "release-decision-v1",
    decisionId: "decision:sha256:pending",
    catalogId: catalog.catalogId,
    catalogVersion: catalog.catalogVersion,
    evaluatedAt,
    releaseSubject: structuredClone(releaseSubject),
    receiptIds,
    receiptSetSha256: canonicalSha256(receiptIds).sha256,
    passedGateIds,
    failedGateIds,
    missingGateIds,
    blockingGateIds,
    releaseReady: blockingGateIds.length === 0,
  };
  decision.decisionId = computeReleaseDecisionId(decision);
  return decision;
}

export function assertReleaseDecision({ decision, catalog, receipts }) {
  const expected = evaluateRelease({
    catalog,
    releaseSubject: decision.releaseSubject,
    receipts,
    evaluatedAt: decision.evaluatedAt,
  });
  assert(sameJson(decision, expected), "release decision differs from catalog and receipt set");
  return decision;
}
