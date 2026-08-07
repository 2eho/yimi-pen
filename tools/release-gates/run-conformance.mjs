import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertEvidenceReceipt,
  assertReleaseDecision,
  assertReleaseGateCatalog,
  computeEvidenceReceiptId,
  computeReleaseGateCatalogId,
  createEvidenceReceipt,
  evaluateRelease,
  gateByIdOrAlias,
} from "../../contracts/release-gates-v1.mjs";
import { verifyCatalogSemanticFiles } from "./catalog-semantics.mjs";
import { assertHostValidationRun, computeHostValidationRunId } from "./host-run-provenance.mjs";
import { receiptFromHostReport, verifyReceiptArtifacts } from "./report-adapter.mjs";
import { verifyGateSpecificReceipt } from "./gate-specific-verifiers.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/release-gates-v1");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "release-gate-conformance");
const LOCK_PATH = path.join(BUILD_ROOT, ".release-gate-conformance.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".release-gate-conformance-root");
const MARKER_TEXT = "yimi-release-gate-conformance-root-v1\n";
const FIXED_AT = "2026-08-03T00:00:00Z";
const RELEASE_SUBJECT = {
  subjectType: "PRODUCT_RELEASE",
  subjectId: "YIMI-GEN1-EVT0-CONFORMANCE",
  subjectRevisionSha256: "a".repeat(64),
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function clone(value) {
  return structuredClone(value);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function optionalLstat(target) {
  try { return await lstat(target); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  const info = await lstat(BUILD_ROOT);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("build/ must be a regular directory");
  const [repo, build] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(repo, build)) throw new Error("build/ resolved outside repository");
  try { return await open(LOCK_PATH, "wx"); } catch (error) {
    if (error?.code === "EEXIST") throw new Error("release gate conformance is already running or left a stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await optionalLstat(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("release gate validation root must be an owned directory");
    const [build, run] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(build, run)) throw new Error("release gate validation root escaped build/");
    let marker = null;
    try { marker = await readFile(MARKER_PATH, "utf8"); } catch { /* ownership check below */ }
    if (marker !== MARKER_TEXT) throw new Error("release gate validation root lacks its exact marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER_PATH, MARKER_TEXT, { flag: "wx" });
}

async function treeDigest(root) {
  const records = [];
  async function walk(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`validation tree contains symlink ${relative}`);
      if (entry.isDirectory()) await walk(absolute, relative);
      else records.push({ path: relative, sha256: sha256(await readFile(absolute)) });
    }
  }
  await walk(root);
  return sha256(Buffer.from(JSON.stringify(records), "utf8"));
}

function schemaErrors(validate) {
  return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

function requireSchema(validate, value, label) {
  if (!validate(value)) throw new Error(`${label} schema failed: ${schemaErrors(validate)}`);
}

async function loadContract() {
  const [adapterBytes, legacyBytes] = await Promise.all([
    readFile(path.join(CONTRACT_ROOT, "host-report-adapters.json")),
    readFile(path.join(CONTRACT_ROOT, "legacy-blocker-inventory.json")),
  ]);
  const files = await Promise.all([
    "catalog.schema.json", "evidence-receipt.schema.json", "release-decision.schema.json",
    "host-report-adapters.schema.json", "host-validation-run.schema.json", "catalog.json", "host-report-adapters.json",
    "legacy-blocker-inventory.json",
  ].map((name) => readFile(path.join(CONTRACT_ROOT, name), "utf8").then(JSON.parse)));
  const [catalogSchema, receiptSchema, decisionSchema, adaptersSchema, hostRunSchema, catalog, adapters, legacy] = files;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addSchema(receiptSchema);
  const validators = {
    catalog: ajv.compile(catalogSchema),
    receipt: ajv.getSchema(receiptSchema.$id),
    decision: ajv.compile(decisionSchema),
    adapters: ajv.compile(adaptersSchema),
    hostRun: ajv.compile(hostRunSchema),
  };
  requireSchema(validators.catalog, catalog, "release catalog");
  requireSchema(validators.adapters, adapters, "host report adapters");
  assertReleaseGateCatalog(catalog);
  if (catalog.hostAdapterRegistrySha256 !== sha256(adapterBytes)
    || catalog.legacyInventorySha256 !== sha256(legacyBytes)) {
    throw new Error("release catalog does not bind its adapter registry and legacy inventory bytes");
  }
  await verifyCatalogSemanticFiles({
    catalog,
    reader: (relative) => readFile(path.join(REPO_ROOT, ...relative.split("/"))),
  });
  return { catalog, adapters, legacy, validators };
}

function fixtureCatalog(productionCatalog) {
  const templates = productionCatalog.gates.filter((gate) => gate.evidenceClass === "host").slice(0, 2);
  const gates = templates.map((gate, index) => ({
    ...clone(gate),
    gateId: `RG-FIXTURE-${index + 1}`,
    acceptedProducerIds: ["release-gate-fixture-runner"],
    legacyAliases: [],
    reportScopes: [],
  }));
  gates.push({
    ...clone(gates[0]),
    gateId: "RG-FIXTURE-MULTI",
    minReceipts: 2,
    minDistinctEvidenceSubjects: 2,
  });
  gates.sort((a, b) => a.gateId.localeCompare(b.gateId, "en"));
  const catalog = {
    schemaVersion: 1,
    profile: "release-gate-catalog-v1",
    catalogId: `rgc:sha256:${"0".repeat(64)}`,
    catalogVersion: "1.0.0",
    releaseProfile: "yimi-gen1-evt0-release",
    hostAdapterRegistrySha256: productionCatalog.hostAdapterRegistrySha256,
    legacyInventorySha256: productionCatalog.legacyInventorySha256,
    semanticFiles: clone(productionCatalog.semanticFiles),
    gates,
  };
  catalog.catalogId = computeReleaseGateCatalogId(catalog);
  return assertReleaseGateCatalog(catalog);
}

function fixtureReceipt(catalog, gate, index, result = "PASS") {
  const token = `${gate.gateId}:${index}:${result}`;
  const artifactHash = sha256(Buffer.from(token, "utf8"));
  const subjectType = gate.evidenceSubjectTypes[0];
  return createEvidenceReceipt({
    catalog,
    gateId: gate.gateId,
    releaseSubject: RELEASE_SUBJECT,
    evidenceSubject: {
      subjectType,
      subjectId: `FIXTURE-SUBJECT-${index}`,
      subjectRevisionSha256: artifactHash,
    },
    producer: { producerId: "release-gate-fixture-runner", producerVersion: "1" },
    executedAt: FIXED_AT,
    result,
    evidenceClass: "host",
    syntheticEvidence: true,
    artifacts: gate.requiredArtifactRoles.map((role) => ({
      role,
      path: `fixtures/${gate.gateId.toLowerCase()}/${index}-${role}.json`,
      size: 1,
      sha256: artifactHash,
    })),
    claimRefs: ["release-gate-conformance"],
    diagnostic: result === "PASS" ? null : { reasonCode: "FIXTURE_FAILURE" },
  });
}

function makeCompleteFixtureReceipts(catalog) {
  return catalog.gates.flatMap((gate) => Array.from(
    { length: gate.minReceipts },
    (_, index) => fixtureReceipt(catalog, gate, index + 1),
  ));
}

function inMemoryPhysicalReceipt(catalog) {
  const gate = catalog.gates.find((candidate) => candidate.evidenceClass === "physical" && candidate.minReceipts === 1);
  const bytes = Buffer.from("release-gate-in-memory-physical-fixture-v1\n", "utf8");
  const digest = sha256(bytes);
  const receipt = createEvidenceReceipt({
    catalog,
    gateId: gate.gateId,
    releaseSubject: RELEASE_SUBJECT,
    evidenceSubject: { subjectType: gate.evidenceSubjectTypes[0], subjectId: "CONFORMANCE-PHYSICAL-SUBJECT", subjectRevisionSha256: digest },
    producer: { producerId: gate.acceptedProducerIds[0], producerVersion: "1" },
    executedAt: FIXED_AT,
    result: "PASS",
    evidenceClass: gate.evidenceClass,
    syntheticEvidence: false,
    artifacts: gate.requiredArtifactRoles.map((role) => ({ role, path: `hardware/evt0/conformance/${role}.bin`, size: bytes.length, sha256: digest })),
    claimRefs: ["in-memory-conformance-only"],
    diagnostic: null,
  });
  return { receipt, bytes };
}

function sealedHostRunFixture(catalog, adapters) {
  const sourceSet = {
    profile: "release-source-set-v1",
    fileCount: 1,
    totalBytes: 1,
    sourceSetSha256: "d".repeat(64),
  };
  const reportArtifacts = new Map();
  const reports = [...adapters.adapters]
    .sort((left, right) => left.gateId.localeCompare(right.gateId, "en"))
    .map((adapter, index) => {
      const digest = sha256(Buffer.from(`${adapter.gateId}:${index}`, "utf8"));
      reportArtifacts.set(adapter.reportPath, { size: 1, sha256: digest });
      return {
        gateId: adapter.gateId,
        reportPath: adapter.reportPath,
        refreshedDuringRun: true,
        prior: null,
        current: { size: 1, sha256: digest, mtimeNs: "1", ctimeNs: "1" },
      };
    });
  const run = {
    schemaVersion: 1,
    profile: "release-host-validation-run-v1",
    hostRunId: `host-run:sha256:${"0".repeat(64)}`,
    catalogId: catalog.catalogId,
    hostAdapterRegistrySha256: catalog.hostAdapterRegistrySha256,
    startedAt: FIXED_AT,
    completedAt: "2026-08-03T00:00:01Z",
    sourceSet,
    reports,
  };
  run.hostRunId = computeHostValidationRunId(run);
  return { run, sourceSet, reportArtifacts };
}

async function runNegatives({ catalog, adapters, fixture, complete, physicalFixture, hostRunFixture, validators }) {
  const scenarios = [];
  async function expectFailure(id, pattern, operation) {
    const before = await treeDigest(RUN_ROOT);
    let message = "";
    let succeeded = false;
    try { await operation(); succeeded = true; } catch (error) { message = String(error?.message ?? error); }
    const after = await treeDigest(RUN_ROOT);
    const zeroSideEffect = before === after;
    scenarios.push({ id, passed: !succeeded && pattern.test(message) && zeroSideEffect, zeroSideEffect, expectedError: pattern.source, actualError: message });
  }

  await expectFailure("NEG-01-catalog-identity", /catalog identity mismatch/u, () => {
    const value = clone(catalog); value.catalogVersion = "1.0.1"; assertReleaseGateCatalog(value);
  });
  await expectFailure("NEG-02-catalog-order", /strictly ordinally sorted/u, () => {
    const value = clone(catalog); [value.gates[0], value.gates[1]] = [value.gates[1], value.gates[0]]; value.catalogId = computeReleaseGateCatalogId(value); assertReleaseGateCatalog(value);
  });
  await expectFailure("NEG-03-receipt-identity", /receipt identity mismatch/u, () => {
    const value = clone(complete[0]); value.executedAt = "2026-08-03T00:00:01Z"; assertEvidenceReceipt(value, fixture);
  });
  await expectFailure("NEG-04-legacy-gate-output", /unknown or legacy/u, () => {
    const value = clone(complete[0]); value.gateId = "BOARD_TARGET_UNFROZEN"; value.receiptId = computeEvidenceReceiptId(value); assertEvidenceReceipt(value, fixture);
  });
  await expectFailure("NEG-05-release-subject", /release subject mismatch/u, () => {
    const value = clone(complete[0]); value.releaseSubject.subjectRevisionSha256 = "b".repeat(64); value.receiptId = computeEvidenceReceiptId(value);
    evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: [value], evaluatedAt: FIXED_AT });
  });
  await expectFailure("NEG-06-duplicate-receipt", /receiptId must be unique/u, () => {
    evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: [complete[0], complete[0]], evaluatedAt: FIXED_AT });
  });
  await expectFailure("NEG-07-conflicting-results", /conflicting PASS and FAIL/u, () => {
    const gate = fixture.gates[0];
    evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: [fixtureReceipt(fixture, gate, 1), fixtureReceipt(fixture, gate, 2, "FAIL")], evaluatedAt: FIXED_AT });
  });
  await expectFailure("NEG-08-physical-synthetic", /rejects synthetic evidence/u, () => {
    const gate = catalog.gates.find((candidate) => candidate.evidenceClass === "physical");
    const value = {
      ...clone(complete[0]),
      catalogId: catalog.catalogId,
      catalogVersion: catalog.catalogVersion,
      gateId: gate.gateId,
      evidenceSubject: { subjectType: gate.evidenceSubjectTypes[0], subjectId: "FIXTURE-PHYSICAL", subjectRevisionSha256: "c".repeat(64) },
      producer: { producerId: gate.acceptedProducerIds[0], producerVersion: "1" },
      evidenceClass: gate.evidenceClass,
      artifacts: gate.requiredArtifactRoles.map((role) => ({ role, path: `fixtures/${role}.json`, size: 1, sha256: "c".repeat(64) })),
    };
    value.receiptId = computeEvidenceReceiptId(value); assertEvidenceReceipt(value, catalog);
  });
  await expectFailure("NEG-09-missing-artifact-role", /lacks artifact role/u, () => {
    const gate = fixture.gates[0]; const value = fixtureReceipt(fixture, gate, 1); value.artifacts = []; value.receiptId = computeEvidenceReceiptId(value); assertEvidenceReceipt(value, fixture);
  });
  await expectFailure("NEG-10-invalid-timestamp", /strict RFC3339/u, () => {
    const gate = fixture.gates[0]; const value = fixtureReceipt(fixture, gate, 1); value.executedAt = "2026-02-30T00:00:00Z"; value.receiptId = computeEvidenceReceiptId(value); assertEvidenceReceipt(value, fixture);
  });
  await expectFailure("NEG-11-unaccepted-producer", /producer is not accepted/u, () => {
    const gate = fixture.gates[0]; const value = fixtureReceipt(fixture, gate, 1); value.producer.producerId = "different-producer"; value.receiptId = computeEvidenceReceiptId(value); assertEvidenceReceipt(value, fixture);
  });
  await expectFailure("NEG-12-decision-tamper", /decision differs/u, () => {
    const decision = evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: complete, evaluatedAt: FIXED_AT }); decision.releaseReady = false;
    assertReleaseDecision({ decision, catalog: fixture, receipts: complete });
  });
  await expectFailure("NEG-13-receipt-schema-hash", /schema failed/u, () => {
    const value = clone(complete[0]); delete value.artifacts[0].sha256; requireSchema(validators.receipt, value, "negative receipt");
  });
  await expectFailure("NEG-14-stale-catalog-binding", /catalog binding mismatch/u, () => {
    const value = clone(complete[0]); value.catalogVersion = "9.9.9"; value.receiptId = computeEvidenceReceiptId(value); assertEvidenceReceipt(value, fixture);
  });
  await expectFailure("NEG-15-insufficient-distinct-subjects", /release decision differs/u, () => {
    const gate = fixture.gates.find((candidate) => candidate.gateId === "RG-FIXTURE-MULTI");
    const one = fixtureReceipt(fixture, gate, 1); const two = fixtureReceipt(fixture, gate, 2); two.evidenceSubject = clone(one.evidenceSubject); two.receiptId = computeEvidenceReceiptId(two);
    const decision = evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: [one, two], evaluatedAt: FIXED_AT });
    decision.missingGateIds = decision.missingGateIds.filter((id) => id !== gate.gateId); decision.passedGateIds.push(gate.gateId); decision.blockingGateIds = decision.blockingGateIds.filter((id) => id !== gate.gateId); decision.releaseReady = false;
    assertReleaseDecision({ decision, catalog: fixture, receipts: [one, two] });
  });
  await expectFailure("NEG-16-physical-artifact-path", /not persisted under hardware\/evt0/u, async () => {
    const receipt = clone(physicalFixture.receipt); receipt.artifacts[0].path = "build/fake.bin";
    await verifyReceiptArtifacts({ receipt, requireHardwarePrefix: true, artifactReader: async () => physicalFixture.bytes });
  });
  await expectFailure("NEG-17-physical-artifact-bytes", /bytes differ from receipt/u, async () => {
    await verifyReceiptArtifacts({ receipt: physicalFixture.receipt, requireHardwarePrefix: true, artifactReader: async () => Buffer.from("changed") });
  });
  await expectFailure("NEG-18-nested-report-catalog", /different ReleaseGateCatalog/u, () => {
    const adapter = adapters.adapters.find((candidate) => candidate.gateId === "RG-HOST-FAMILY-ALPHA-COMPILER-PASSED");
    const report = {
      profile: adapter.expectedProfile,
      gates: { releaseGateCatalogId: `rgc:sha256:${"f".repeat(64)}` },
      golden: { deterministic: true },
      negativeSummary: { passed: 1, total: 1, zeroSideEffect: 1 },
    };
    receiptFromHostReport({ catalog, adapter, reportBytes: encode(report), releaseSubject: RELEASE_SUBJECT, executedAt: FIXED_AT });
  });
  await expectFailure("NEG-19-host-run-stale-source", /source set is stale/u, () => {
    const current = { ...hostRunFixture.sourceSet, sourceSetSha256: "e".repeat(64) };
    assertHostValidationRun({ run: hostRunFixture.run, catalog, adapters, sourceSet: current, reportArtifacts: hostRunFixture.reportArtifacts });
  });
  await expectFailure("NEG-20-host-run-report-drift", /report drifted after seal/u, () => {
    const artifacts = new Map(hostRunFixture.reportArtifacts);
    const first = hostRunFixture.run.reports[0];
    artifacts.set(first.reportPath, { size: 1, sha256: "e".repeat(64) });
    assertHostValidationRun({ run: hostRunFixture.run, catalog, adapters, sourceSet: hostRunFixture.sourceSet, reportArtifacts: artifacts });
  });
  await expectFailure("NEG-21-catalog-semantic-drift", /semantic file drift/u, async () => {
    await verifyCatalogSemanticFiles({ catalog, reader: async () => Buffer.from("changed", "utf8") });
  });
  await expectFailure("NEG-22-production-confirmation-self-report", /requires a configured gate-specific production verifier/u, async () => {
    const gate = catalog.gates.find((candidate) => candidate.gateId === "RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED");
    const bytes = Buffer.from("self-reported-production-confirmation", "utf8");
    const receipt = createEvidenceReceipt({
      catalog,
      gateId: gate.gateId,
      releaseSubject: RELEASE_SUBJECT,
      evidenceSubject: { subjectType: gate.evidenceSubjectTypes[0], subjectId: "SELF-REPORTED", subjectRevisionSha256: sha256(bytes) },
      producer: { producerId: gate.acceptedProducerIds[0], producerVersion: "1" },
      executedAt: FIXED_AT,
      result: "PASS",
      evidenceClass: gate.evidenceClass,
      syntheticEvidence: false,
      artifacts: gate.requiredArtifactRoles.map((role) => ({ role, path: `hardware/evt0/conformance/${role}.json`, size: bytes.length, sha256: sha256(bytes) })),
      claimRefs: ["self-report-must-not-close-gate"],
      diagnostic: null,
    });
    await verifyGateSpecificReceipt({ receipt, artifactReader: async () => bytes });
  });
  return scenarios;
}

async function run() {
  await prepareRunRoot();
  const { catalog, adapters, legacy, validators } = await loadContract();
  const fixture = fixtureCatalog(catalog);
  requireSchema(validators.catalog, fixture, "fixture catalog");
  const complete = makeCompleteFixtureReceipts(fixture);
  for (const receipt of complete) requireSchema(validators.receipt, receipt, "fixture receipt");
  const ready = evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: complete, evaluatedAt: FIXED_AT });
  requireSchema(validators.decision, ready, "ready fixture decision");
  assertReleaseDecision({ decision: ready, catalog: fixture, receipts: complete });
  const reversed = evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: [...complete].reverse(), evaluatedAt: FIXED_AT });
  const reevaluated = evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: complete, evaluatedAt: "2026-08-03T00:00:02Z" });
  const missing = evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: complete.slice(1), evaluatedAt: FIXED_AT });
  const failedReceipt = fixtureReceipt(fixture, fixture.gates[0], 99, "FAIL");
  const failed = evaluateRelease({ catalog: fixture, releaseSubject: RELEASE_SUBJECT, receipts: [failedReceipt], evaluatedAt: FIXED_AT });

  const aliasMap = new Map(catalog.gates.flatMap((gate) => gate.legacyAliases.map((alias) => [alias, gate.gateId])));
  const activeLegacyMapped = legacy.activeLegacyIds.every((id) => aliasMap.has(id) && gateByIdOrAlias(catalog, id)?.gateId === aliasMap.get(id));
  const mechanismExcluded = legacy.mechanismIds.every((entry) => !aliasMap.has(entry.id));
  const closedIntegrationExcluded = legacy.closedIntegrationIds.every((id) => !aliasMap.has(id));
  const adapterGates = adapters.adapters.map((adapter) => adapter.gateId);
  const adapterRegistryUnique = new Set(adapterGates).size === adapterGates.length;
  const adaptersMatchCatalog = adapters.adapters.every((adapter) => {
    const gate = catalog.gates.find((candidate) => candidate.gateId === adapter.gateId);
    return gate?.evidenceClass === "host" && gate.acceptedProducerIds.includes(adapter.producerId);
  });
  const hostGateIds = catalog.gates.filter((gate) => gate.evidenceClass === "host").map((gate) => gate.gateId);
  const hostAdapterCoverage = JSON.stringify([...adapterGates].sort()) === JSON.stringify([...hostGateIds].sort());
  const physicalFixture = inMemoryPhysicalReceipt(catalog);
  await verifyReceiptArtifacts({ receipt: physicalFixture.receipt, requireHardwarePrefix: true, artifactReader: async () => physicalFixture.bytes });
  const hostRunFixture = sealedHostRunFixture(catalog, adapters);
  requireSchema(validators.hostRun, hostRunFixture.run, "fixture host validation run");
  assertHostValidationRun({ run: hostRunFixture.run, catalog, adapters, sourceSet: hostRunFixture.sourceSet, reportArtifacts: hostRunFixture.reportArtifacts });
  const negatives = await runNegatives({ catalog, adapters, fixture, complete, physicalFixture, hostRunFixture, validators });
  const negativePassed = negatives.filter((scenario) => scenario.passed).length;
  const zeroSideEffect = negatives.filter((scenario) => scenario.zeroSideEffect).length;
  const gates = {
    productionCatalogSchemaValid: true,
    productionCatalogIdentityValid: true,
    activeLegacyIdsMapped: activeLegacyMapped,
    mechanismIdsExcluded: mechanismExcluded,
    closedIntegrationIdsExcluded: closedIntegrationExcluded,
    adapterRegistryUnique,
    adaptersMatchCatalog,
    hostAdapterCoverage,
    catalogSemanticFilesVerified: true,
    sealedHostValidationRunVerified: true,
    inMemoryPhysicalArtifactBytesVerified: true,
    completeFixtureReleaseReady: ready.releaseReady,
    receiptOrderIndependent: ready.decisionId === reversed.decisionId,
    decisionEvaluationTimeIndependent: ready.decisionId === reevaluated.decisionId,
    missingReceiptBlocks: !missing.releaseReady && missing.missingGateIds.length > 0,
    failedReceiptBlocks: !failed.releaseReady && failed.failedGateIds.length === 1,
    negativesPassed: negativePassed === negatives.length,
    negativeFailuresZeroSideEffect: zeroSideEffect === negatives.length,
  };
  const report = {
    schemaVersion: 1,
    profile: "release-gate-conformance-v1",
    catalog: { catalogId: catalog.catalogId, catalogVersion: catalog.catalogVersion, gateCount: catalog.gates.length, legacyAliasCount: aliasMap.size, hostAdapterCount: adapters.adapters.length },
    fixture: { gateCount: fixture.gates.length, receiptCount: complete.length, decisionId: ready.decisionId },
    gates,
    negativeSummary: { total: negatives.length, passed: negativePassed, zeroSideEffect },
    negativeScenarios: negatives,
    evidenceBoundary: {
      conformanceFixtureOnly: true,
      productionPhysicalReceiptsCreated: false,
      inMemoryPhysicalReceiptPersisted: false,
      physicalClaimsProven: false,
      catalogSelfReferenceExcluded: true,
      receiptMigrationMechanismExcluded: true,
    },
  };
  const bytes = encode(report);
  await writeFile(path.join(RUN_ROOT, "report.json"), bytes, { flag: "wx" });
  console.log(`ReleaseGateCatalog: gates=${catalog.gates.length} aliases=${aliasMap.size} host-adapters=${adapters.adapters.length}`);
  console.log(`ReleaseGate conformance: ready=${ready.releaseReady}; order-independent=${gates.receiptOrderIndependent}`);
  console.log(`ReleaseGate negatives: ${negativePassed}/${negatives.length}; zero-side-effect ${zeroSideEffect}/${negatives.length}`);
  console.log(`ReleaseGate report SHA-256: ${sha256(bytes)}`);
  if (!Object.values(gates).every(Boolean)) process.exitCode = 1;
}

const lock = await acquireLock();
try { await run(); } finally {
  try { await lock.close(); } catch { /* preserve validation result */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* preserve validation result */ }
}
