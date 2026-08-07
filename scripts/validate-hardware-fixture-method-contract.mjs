import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalize } from "./snapshot-jcs.mjs";
import { evaluateFixtureDocuments, loadFixtureContext } from "./validate-hardware-test-fixture.mjs";
import { evaluateMethodGapManifest, loadMethodGapContext } from "./validate-hardware-method-gap-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = "hardware/evt0/fixture-method-contract-v1";
const REPORT_PATH = path.join(ROOT, "build", "hardware-fixture-method-contract-validation.json");

const PATHS = {
  contractSchema: `${PACKAGE_ROOT}/contract.schema.json`,
  manifest: `${PACKAGE_ROOT}/manifest.json`,
  adapterSchema: `${PACKAGE_ROOT}/adapter.schema.json`,
  adapter: `${PACKAGE_ROOT}/adapter.template.json`,
  runSchema: `${PACKAGE_ROOT}/run.schema.json`,
  run: `${PACKAGE_ROOT}/run.template.json`,
  readme: `${PACKAGE_ROOT}/README.md`,
  methodGapManifest: "hardware/evt0/method-gap-evidence-v1/manifest.json",
  evidenceCaptureProfile: "hardware/evt0/evidence-capture-v1/profile.json",
  softwareParent: "docs/codex/tasks/system-product-rd/active-task.md",
  softwareChild: "docs/codex/tasks/desktop-authoring-ui-adapter/active-task.md",
  acceptedDesktopReport: "build/companion-desktop-authoring-task-validation/report.json",
  explicitHardwareImpactReport: "build/companion-tts-source-adapter-validation/report.json",
};

const EXPECTED_METHOD_IDS = [
  "PROPOSED-USB-DATA-OBSERVATION-001",
  "PROPOSED-CONTROL-STATUS-HIL-001",
];
const EXPECTED_GAP_IDS = ["GAP-IF-USB-DATA-METHOD", "GAP-CONTROL-STATUS-METHOD"];
const EXPECTED_SOURCE_IDS = [
  "SRC-METHOD-GAP-USB-COMPLIANCE-PAGE",
  "SRC-METHOD-GAP-USB-COMPLIANCE-PDF",
  "SRC-METHOD-GAP-USB-BASE-PAGE",
  "SRC-METHOD-GAP-HIL-NI-VERISTAND",
  "SRC-METHOD-GAP-HIL-OPENHTF",
];
const EXPECTED_IMPLEMENTATION_PATHS = [
  PATHS.contractSchema,
  PATHS.adapterSchema,
  PATHS.adapter,
  PATHS.runSchema,
  PATHS.run,
  PATHS.readme,
  "scripts/validate-hardware-fixture-method-contract.mjs",
  "scripts/test-hardware-fixture-method-contract.mjs",
];
const EVIDENCE_CAPTURE_LANES = ["VENDOR_CONTACT", "BENCHMARK_SELLER", "LAB_REGISTRY", "VENDOR_RESPONSE"];
const FIELD_OWNERS = ["METHOD_ADAPTER", "RUN_BINDING", "EXISTING_FIXTURE_ADAPTER", "OWNER_REFERENCE"];

const USB_PHASES = [
  {
    id: "PHASE-01",
    skeletonStepId: "STEP-01",
    action: "Bind the run to the exact profile, adapter, instance, host/device role, and official USB revision only after target evidence exists.",
    targetDependentFields: ["USB_ROLE", "USB_REVISION", "USB_MODE", "DEVICE_IDENTITY", "CABLE_OR_FIXTURE_ID"],
  },
  {
    id: "PHASE-02",
    skeletonStepId: "STEP-02",
    action: "Run enumeration and representative read/write transaction scenarios selected by the accepted target software contract; preserve event order and timestamps.",
    targetDependentFields: ["CLASS", "VID_PID", "ENDPOINTS", "TRANSFER_TYPES", "PAYLOAD_SET"],
  },
  {
    id: "PHASE-03",
    skeletonStepId: "STEP-03",
    action: "Repeat disconnect, reconnect, and interrupted-transfer observations; preserve raw traces and recovery outcomes without assigning a target pass threshold.",
    targetDependentFields: ["CONNECTOR", "PIN_MAPPING", "FRAMING", "RECOVERY_POLICY", "TIMING_THRESHOLDS"],
  },
  {
    id: "PHASE-04",
    skeletonStepId: "STEP-04",
    action: "Hash the raw capture, bind it to the existing session/TestResult/evidence owners, and leave ReleaseGate disposition to those owners.",
    targetDependentFields: ["SESSION_ID", "TEST_RESULT_ID", "RAW_EVIDENCE_INDEX", "RELEASE_GATE_RECEIPT"],
  },
];
const HIL_PHASES = [
  {
    id: "PHASE-01",
    skeletonStepId: "STEP-01",
    action: "Bind the run to a firmware build identity, logical control/status channel names, diagnostic route, fixture instance, and existing lab session owner.",
    targetDependentFields: ["FIRMWARE_VERSION", "CONTROL_CHANNELS", "STATUS_CHANNELS", "DEBUG_TRANSPORT", "FIXTURE_INSTANCE"],
  },
  {
    id: "PHASE-02",
    skeletonStepId: "STEP-02",
    action: "Declare a stimulus sequence and observation predicates in logical terms; keep physical levels, debounce, timing, and state-code mapping unresolved.",
    targetDependentFields: ["STIMULUS_LEVELS", "TIMING", "DEBOUNCE", "STATE_CODES", "PIN_MAPPING"],
  },
  {
    id: "PHASE-03",
    skeletonStepId: "STEP-03",
    action: "Execute the HIL sequence, capture stimulus/observation ordering, diagnostic logs, build/flash witness, and fault-injection outcome as raw artifacts.",
    targetDependentFields: ["TRACE_CLOCK", "FAULT_MODEL", "FLASH_ROUTE", "LOG_ROUTE", "EXPECTED_SEQUENCE"],
  },
  {
    id: "PHASE-04",
    skeletonStepId: "STEP-04",
    action: "Attach measurements and raw traces to the existing TestResult/evidence owners; leave qualification and ReleaseGate decisions outside the proposed method.",
    targetDependentFields: ["MEASUREMENT_SET", "ACCEPTANCE_PREDICATES", "RAW_EVIDENCE_INDEX", "RELEASE_GATE_RECEIPT"],
  },
];

const FIELD_OWNERSHIP = {
  "PROPOSED-USB-DATA-OBSERVATION-001": {
    METHOD_ADAPTER: ["USB_ROLE", "USB_REVISION", "USB_MODE", "DEVICE_IDENTITY", "CLASS", "VID_PID", "ENDPOINTS", "TRANSFER_TYPES", "FRAMING", "RECOVERY_POLICY", "TIMING_THRESHOLDS"],
    RUN_BINDING: ["CABLE_OR_FIXTURE_ID", "PAYLOAD_SET"],
    EXISTING_FIXTURE_ADAPTER: ["CONNECTOR", "PIN_MAPPING"],
    OWNER_REFERENCE: ["SESSION_ID", "TEST_RESULT_ID", "RAW_EVIDENCE_INDEX", "RELEASE_GATE_RECEIPT"],
  },
  "PROPOSED-CONTROL-STATUS-HIL-001": {
    METHOD_ADAPTER: ["CONTROL_CHANNELS", "STATUS_CHANNELS", "DEBUG_TRANSPORT", "TIMING", "DEBOUNCE", "STATE_CODES", "STIMULUS_LEVELS", "TRACE_CLOCK", "FLASH_ROUTE", "LOG_ROUTE"],
    RUN_BINDING: ["FIXTURE_INSTANCE", "FAULT_MODEL", "EXPECTED_SEQUENCE", "MEASUREMENT_SET", "ACCEPTANCE_PREDICATES"],
    EXISTING_FIXTURE_ADAPTER: ["FIRMWARE_VERSION", "PIN_MAPPING"],
    OWNER_REFERENCE: ["RAW_EVIDENCE_INDEX", "RELEASE_GATE_RECEIPT"],
  },
};

const RUN_BINDING_PATHS = {
  "PROPOSED-USB-DATA-OBSERVATION-001": {},
  "PROPOSED-CONTROL-STATUS-HIL-001": { FIXTURE_INSTANCE: "fixtureInstance.id" },
};

const OWNER_REFERENCE_PATHS = {
  SESSION_ID: "labSession.sessionId",
  TEST_RESULT_ID: "testResult.resultId",
  RAW_EVIDENCE_INDEX: "evidenceCapture.captureIndexId",
  RELEASE_GATE_RECEIPT: "releaseGate.receiptId",
};

const EXISTING_FIXTURE_PATHS = {
  "PROPOSED-USB-DATA-OBSERVATION-001": {
    CONNECTOR: "targetDependent.connectorMappings",
    PIN_MAPPING: "targetDependent.pinMappings",
  },
  "PROPOSED-CONTROL-STATUS-HIL-001": {
    FIRMWARE_VERSION: "targetIdentity.fullFiveTuple.FW_VERSION",
    PIN_MAPPING: "targetDependent.pinMappings",
  },
};

const RUN_INPUT_FIELDS = {
  "PROPOSED-USB-DATA-OBSERVATION-001": ["CABLE_OR_FIXTURE_ID", "PAYLOAD_SET"],
  "PROPOSED-CONTROL-STATUS-HIL-001": ["FAULT_MODEL", "EXPECTED_SEQUENCE", "MEASUREMENT_SET", "ACCEPTANCE_PREDICATES"],
};

const DIRECT_RUN_BINDING_FIELDS = {
  "PROPOSED-USB-DATA-OBSERVATION-001": [],
  "PROPOSED-CONTROL-STATUS-HIL-001": ["FIXTURE_INSTANCE"],
};

const METHOD_ADAPTER_FORBIDDEN = new Set([
  "targetTuple", "TARGET_VOLTAGE", "TARGET_CURRENT", "POGO_LAYOUT", "MECHANICAL_DIMENSIONS", "CALIBRATION_ID", "QUALIFICATION_ID", "SERIAL", "PHYSICAL_READINESS", "ACCEPTANCE_THRESHOLDS",
  "INSTRUMENT_SLOT_ID", "INSTRUMENT_CALIBRATION_ID", "SESSION_ID", "TEST_RESULT_ID", "RAW_EVIDENCE_INDEX", "RELEASE_GATE_RECEIPT",
  "SOFTWARE_TRANSACTION_SCENARIO", "DEVICELINK_SCENARIO", "FIRMWARE_ARTIFACT_ROLE", "IMPLEMENTATION_LANE", "CABLE_OR_FIXTURE_ID", "PAYLOAD_SET", "FIXTURE_INSTANCE", "FAULT_MODEL", "EXPECTED_SEQUENCE", "MEASUREMENT_SET", "ACCEPTANCE_PREDICATES", "FIRMWARE_VERSION", "CONNECTOR",
  "PIN_MAPPING",
]);

function absolute(relativePath) {
  return path.join(ROOT, relativePath.replaceAll("/", path.sep));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function deepEqual(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function exactOrdered(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function exactUnique(actual, expected) {
  return exactOrdered(actual, expected) && new Set(actual).size === expected.length;
}

function pathValue(document, dottedPath) {
  return String(dottedPath).split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), document);
}

function pathExists(document, dottedPath) {
  const parts = String(dottedPath).split(".");
  let value = document;
  for (const key of parts) {
    if (value === null || value === undefined || !Object.hasOwn(value, key)) return false;
    value = value[key];
  }
  return true;
}

function check(checks, name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function schemaObjectNodesAreClosed(schema, location = "#") {
  const problems = [];
  if (!schema || typeof schema !== "object") return problems;
  if (schema.type === "object" && schema.additionalProperties !== false) problems.push(location);
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === "object") problems.push(...schemaObjectNodesAreClosed(value, `${location}/${key}`));
  }
  return problems;
}

async function readArtifact(relativePath) {
  const filePath = absolute(relativePath);
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`not a regular file: ${relativePath}`);
  const bytes = await readFile(filePath);
  return { path: relativePath, text: bytes.toString("utf8"), bytes, bytesLength: bytes.length, sha256: sha256(bytes) };
}

async function readJson(relativePath) {
  const artifact = await readArtifact(relativePath);
  return { ...artifact, document: JSON.parse(artifact.text) };
}

function expectedOwnerProjection(methodId) {
  return {
    methodCatalog: {
      path: "hardware/evt0/lab-v1/method-catalog.json",
      methodId,
      acceptedInMethodCatalog: false,
      effect: "NONE",
    },
    labSession: { path: "hardware/evt0/lab-v1", refFields: ["sessionId"], effect: "NONE" },
    testResult: { path: "hardware/evt0/test-result-v1/schema.json", refFields: ["resultId", "rawArtifacts"], effect: "NONE" },
    evidenceCapture: {
      path: "hardware/evt0/evidence-capture-v1/profile.json",
      captureRouteState: "PENDING_OWNER_EXTENSION",
      laneId: null,
      captureIndexId: null,
      effect: "NONE",
    },
    releaseGate: { path: "hardware/evt0/release-gates-v1/catalog.json", disposition: "NONE", effect: "NONE" },
  };
}

function expectedContract(methodId) {
  if (methodId === EXPECTED_METHOD_IDS[0]) return {
    methodId,
    gapId: EXPECTED_GAP_IDS[0],
    interfaceRefs: ["IF-USB-DATA", "IF-USB-MECHANICAL"],
    supportingInterfaceRefs: [],
    sourceIds: EXPECTED_SOURCE_IDS.slice(0, 3),
    phases: USB_PHASES,
    rawArtifactKinds: ["enumeration_trace", "transfer_trace", "disconnect_reconnect_trace", "raw_capture_manifest", "session_binding_ref"],
  };
  return {
    methodId,
    gapId: EXPECTED_GAP_IDS[1],
    interfaceRefs: ["IF-CONTROL", "IF-STATUS"],
    supportingInterfaceRefs: ["IF-DIAGNOSTIC"],
    sourceIds: EXPECTED_SOURCE_IDS.slice(3),
    phases: HIL_PHASES,
    rawArtifactKinds: ["stimulus_trace", "observation_trace", "diagnostic_log", "measurement_manifest", "attachment_manifest"],
  };
}

function liveSoftwareSemantics(context) {
  const parentText = context.softwareParentFile.text;
  const childText = context.softwareChildFile.text;
  const accepted = context.acceptedDesktopAuthoringReportFile.document;
  const impact = context.explicitHardwareImpactReportFile.document.boundaries ?? {};
  const acceptedChecks = Number(accepted.checks);
  const acceptedPassed = Number(accepted.passed);
  return {
    parent: parentText.includes("Current step:") && parentText.includes("Next exact step:") && parentText.includes("BOARD_TARGET=UNRESOLVED") && parentText.includes("hardwareImpact=NONE"),
    child: childText.includes("Hardware input:") && childText.includes("hardwareImpact=NONE") && childText.includes("BOARD_TARGET=UNRESOLVED"),
    acceptedDesktopReport: Number.isInteger(acceptedChecks) && acceptedChecks > 0 && acceptedPassed === acceptedChecks && Number(accepted.failed ?? 0) === 0 && accepted.hardwareImpact === "NONE" && accepted.boardTarget === "UNRESOLVED",
    impact: impact.hardwareImpact === "NONE" && impact.boardTarget === "UNRESOLVED" && impact.sessionCoreModified === false && impact.familyWorkspaceModified === false && impact.productionProviderQualified === false && impact.offlineReady === false,
  };
}

export async function loadFixtureMethodContractContext() {
  const [contractSchemaFile, manifestFile, adapterSchemaFile, adapterFile, runSchemaFile, runFile, readmeFile,
    methodGapManifestFile, evidenceCaptureProfileFile, softwareParentFile, softwareChildFile,
    acceptedDesktopAuthoringReportFile, explicitHardwareImpactReportFile] = await Promise.all([
    readJson(PATHS.contractSchema),
    readJson(PATHS.manifest),
    readJson(PATHS.adapterSchema),
    readJson(PATHS.adapter),
    readJson(PATHS.runSchema),
    readJson(PATHS.run),
    readArtifact(PATHS.readme),
    readJson(PATHS.methodGapManifest),
    readJson(PATHS.evidenceCaptureProfile),
    readArtifact(PATHS.softwareParent),
    readArtifact(PATHS.softwareChild),
    readJson(PATHS.acceptedDesktopReport),
    readJson(PATHS.explicitHardwareImpactReport),
  ]);
  const methodGapContext = await loadMethodGapContext();
  const fixtureContext = await loadFixtureContext();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validators = {
    contract: ajv.compile(contractSchemaFile.document),
    adapter: ajv.compile(adapterSchemaFile.document),
    run: ajv.compile(runSchemaFile.document),
  };
  return {
    contractSchemaFile, manifestFile, adapterSchemaFile, adapterFile, runSchemaFile, runFile, readmeFile,
    methodGapManifestFile, evidenceCaptureProfileFile, methodGapContext, fixtureContext,
    softwareParentFile, softwareChildFile, acceptedDesktopAuthoringReportFile, explicitHardwareImpactReportFile,
    validators,
  };
}

function validateFieldOwnership(contract, adapterMethod, run, fixtureAdapterDocument) {
  const expected = FIELD_OWNERSHIP[contract.methodId];
  const actual = contract.fieldOwnership;
  if (!actual || !expected || !FIELD_OWNERS.every((key) => Object.hasOwn(actual, key))) return { ok: false, reason: "missing-owner-category", actual, expected };
  const phaseFields = contract.phases.flatMap((phase) => phase.targetDependentFields ?? []);
  const phaseUnique = [...new Set(phaseFields)];
  const ownerEntries = FIELD_OWNERS.flatMap((owner) => actual[owner] ?? []);
  const ownerUnique = new Set(ownerEntries);
  const methodFieldIds = (adapterMethod?.fields ?? []).map((field) => field.id);
  const expectedMethod = expected.METHOD_ADAPTER;
  const methodInputs = (run?.methodInputs ?? []).find((item) => item.methodId === contract.methodId);
  const methodInputIds = (methodInputs?.fields ?? []).map((field) => field.id);
  const expectedInputs = RUN_INPUT_FIELDS[contract.methodId] ?? [];
  const inputFieldValidity = (methodInputs?.fields ?? []).every((field) => field.state === "PENDING_EVIDENCE" && field.value === null && Array.isArray(field.evidenceRefs) && field.evidenceRefs.length === 0);
  const directFields = DIRECT_RUN_BINDING_FIELDS[contract.methodId] ?? [];
  const derivedInputFields = (expected.RUN_BINDING ?? []).filter((fieldId) => !directFields.includes(fieldId));
  const directPathValidity = directFields.every((fieldId) => Object.hasOwn(contract.runBindingPaths ?? {}, fieldId) && pathExists(run, contract.runBindingPaths[fieldId]) && pathValue(run, contract.runBindingPaths[fieldId]) === null);
  const runBindingPathValidity = deepEqual(contract.runBindingPaths ?? {}, RUN_BINDING_PATHS[contract.methodId] ?? {});
  const ownerReferencePathValidity = deepEqual(contract.ownerReferencePaths ?? {}, OWNER_REFERENCE_PATHS)
    && (expected.OWNER_REFERENCE ?? []).every((fieldId) => Object.hasOwn(contract.ownerReferencePaths ?? {}, fieldId) && pathExists(run, contract.ownerReferencePaths[fieldId]) && pathValue(run, contract.ownerReferencePaths[fieldId]) === null)
    && ["SESSION_ID", "TEST_RESULT_ID", "RAW_EVIDENCE_INDEX", "RELEASE_GATE_RECEIPT"].every((fieldId) => pathExists(run, OWNER_REFERENCE_PATHS[fieldId]));
  const existingFixturePathValidity = deepEqual(contract.existingFixturePaths ?? {}, EXISTING_FIXTURE_PATHS[contract.methodId] ?? {})
    && Object.entries(contract.existingFixturePaths ?? {}).every(([, dottedPath]) => pathExists(fixtureAdapterDocument, dottedPath));
  const ok = deepEqual(actual, expected)
    && ownerEntries.length === ownerUnique.size
    && phaseUnique.length === ownerUnique.size
    && phaseUnique.every((fieldId) => ownerUnique.has(fieldId))
    && ownerUnique.size === phaseUnique.length
    && exactUnique(methodFieldIds, expectedMethod)
    && exactUnique(methodInputIds, expectedInputs)
    && exactUnique(derivedInputFields, expectedInputs)
    && inputFieldValidity
    && runBindingPathValidity
    && directPathValidity
    && ownerReferencePathValidity
    && existingFixturePathValidity;
  return {
    ok,
    phaseFields,
    phaseUnique,
    ownerEntries,
    methodFieldIds,
    methodInputIds,
    expectedInputs,
    expected,
    actual,
    runBindingPaths: contract.runBindingPaths,
    ownerReferencePaths: contract.ownerReferencePaths,
    existingFixturePaths: contract.existingFixturePaths,
    inputFieldValidity,
    runBindingPathValidity,
    directPathValidity,
    ownerReferencePathValidity,
    existingFixturePathValidity,
  };
}

export async function evaluateFixtureMethodContract(context, manifest = context.manifestFile.document, adapter = context.adapterFile.document, run = context.runFile.document) {
  const checks = [];
  const { validators } = context;
  check(checks, "contract schema validates", validators.contract(manifest), validators.contract.errors);
  check(checks, "adapter schema validates", validators.adapter(adapter), validators.adapter.errors);
  check(checks, "run schema validates", validators.run(run), validators.run.errors);
  const canonicalFiles = [
    context.contractSchemaFile, context.manifestFile, context.adapterSchemaFile, context.adapterFile, context.runSchemaFile, context.runFile,
  ];
  check(checks, "every package JSON file uses canonical pretty JSON plus newline", canonicalFiles.every((file) => canonicalJson(file.document) === file.text), canonicalFiles.map((file) => ({ path: file.path, canonical: canonicalJson(file.document) === file.text })));
  check(checks, "all contract schema object nodes are closed", schemaObjectNodesAreClosed(context.contractSchemaFile.document).length === 0, schemaObjectNodesAreClosed(context.contractSchemaFile.document));
  check(checks, "all adapter schema object nodes are closed", schemaObjectNodesAreClosed(context.adapterSchemaFile.document).length === 0, schemaObjectNodesAreClosed(context.adapterSchemaFile.document));
  check(checks, "all run schema object nodes are closed", schemaObjectNodesAreClosed(context.runSchemaFile.document).length === 0, schemaObjectNodesAreClosed(context.runSchemaFile.document));

  check(checks, "package identity and unresolved boundary", manifest.packageId === "HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1" && manifest.revision === "1.0.0" && manifest.status === "PROPOSED_CONTRACT_COMPLETE" && manifest.boardTargetState === "UNRESOLVED", manifest);
  check(checks, "all package effects are NONE", deepEqual(manifest.effects, { methodCatalog: "NONE", instrumentRegistry: "NONE", targetBinding: "NONE", physicalEvidence: "NONE", releaseGate: "NONE", promotion: "NONE", software: "NONE" }) && deepEqual(adapter.effects, { targetBinding: "NONE", physicalEvidence: "NONE", qualification: "NONE", releaseGate: "NONE", promotion: "NONE", software: "NONE" }) && deepEqual(run.effects, { targetBinding: "NONE", physicalEvidence: "NONE", qualification: "NONE", releaseGate: "NONE", promotion: "NONE", software: "NONE" }), { manifest: manifest.effects, adapter: adapter.effects, run: run.effects });
  check(checks, "dependency policy is semantic and non-churning", deepEqual(manifest.dependencyPolicy, {
    methodGapRule: "AUDIT_PROVENANCE_PLUS_LIVE_SEMANTIC_VALIDATION",
    fixtureRule: "CURRENT_SEMANTIC_VALIDATION_ONLY",
    softwareRule: "LIVE_BOUNDARY_SEMANTICS_ONLY_NO_HASH_OR_TASK_NAME",
    canonicalArtifactRule: "NO_CHURN_FOR_HARDWARE_IMPACT_NONE",
  }), manifest.dependencyPolicy);

  const contracts = manifest.contracts ?? [];
  const contractIds = contracts.map((item) => item.methodId);
  check(checks, "exact two proposed method IDs", exactUnique(contractIds, EXPECTED_METHOD_IDS), contractIds);
  const contractProblems = [];
  const ownershipProblems = [];
  for (const methodId of EXPECTED_METHOD_IDS) {
    const actual = contracts.find((item) => item.methodId === methodId);
    const expected = expectedContract(methodId);
    if (!actual) { contractProblems.push({ methodId, reason: "missing" }); continue; }
    const adapterMethod = (adapter.methods ?? []).find((item) => item.methodId === methodId);
    if (actual.gapId !== expected.gapId || actual.status !== "PROPOSED_ONLY" || actual.acceptedInMethodCatalog !== false || !exactUnique(actual.interfaceRefs, expected.interfaceRefs) || !exactUnique(actual.supportingInterfaceRefs, expected.supportingInterfaceRefs) || !exactUnique(actual.sourceIds, expected.sourceIds) || !exactUnique(actual.rawArtifactKinds, expected.rawArtifactKinds) || !deepEqual(actual.ownerProjection, expectedOwnerProjection(methodId)) || actual.failureSemantics?.onMissingTargetEvidence !== "PENDING_EVIDENCE" || actual.failureSemantics?.verdictState !== "NOT_SET") contractProblems.push({ methodId, reason: "identity/status/refs/effects", actual });
    const actualPhases = (actual.phases ?? []).map((phase) => ({ id: phase.id, skeletonStepId: phase.skeletonStepId, action: phase.action, targetDependentFields: phase.targetDependentFields }));
    if (!deepEqual(actualPhases, expected.phases) || actual.phases?.some((phase) => phase.physicalThresholdState !== "PENDING")) contractProblems.push({ methodId, reason: "phase skeleton drift", actualPhases, expected: expected.phases });
    const ownershipResult = validateFieldOwnership(actual, adapterMethod, run, context.fixtureContext.packageFiles.adapterTemplate.document);
    if (!ownershipResult.ok) ownershipProblems.push({ methodId, ...ownershipResult });
    if (JSON.stringify(actual).includes("hardware/evt0/method-gap-evidence-v1/raw/") || JSON.stringify(actual).includes("sha256")) contractProblems.push({ methodId, reason: "raw evidence duplicated" });
  }
  check(checks, "contracts preserve exact gap/interface/source/phase/output coverage", contractProblems.length === 0, contractProblems);
  check(checks, "every source-derived phase field has exactly one owner and method adapter is scoped", ownershipProblems.length === 0, ownershipProblems);
  const methodInputIds = (run.methodInputs ?? []).map((item) => item.methodId);
  const methodInputProblems = [];
  if (!exactUnique(methodInputIds, EXPECTED_METHOD_IDS)) methodInputProblems.push({ reason: "method-input-method-ids", actual: methodInputIds, expected: EXPECTED_METHOD_IDS });
  for (const methodId of EXPECTED_METHOD_IDS) {
    const item = (run.methodInputs ?? []).find((candidate) => candidate.methodId === methodId);
    const expectedFields = RUN_INPUT_FIELDS[methodId] ?? [];
    const actualFields = (item?.fields ?? []).map((field) => field.id);
    if (!exactUnique(actualFields, expectedFields) || (item?.fields ?? []).some((field) => field.state !== "PENDING_EVIDENCE" || field.value !== null || !Array.isArray(field.evidenceRefs) || field.evidenceRefs.length !== 0)) {
      methodInputProblems.push({ methodId, actualFields, expectedFields, fields: item?.fields ?? [] });
    }
  }
  check(checks, "run-input slots are method-scoped, unique, pending/null/empty and exact", methodInputProblems.length === 0, methodInputProblems);
  check(checks, "source claims route only by method-gap sourceId", exactUnique(manifest.sourceRefs?.sourceIds, EXPECTED_SOURCE_IDS) && manifest.sourceRefs?.methodGapManifestPath === PATHS.methodGapManifest && manifest.sourceRefs?.methodGapPackageId === "HW-FIXTURE-METHOD-GAP-EVIDENCE-AUDIT-V1" && manifest.sourceRefs?.methodGapRevision === "1.1.0", manifest.sourceRefs);

  const methodGapChecks = evaluateMethodGapManifest(context.methodGapContext);
  const fixtureEvaluation = evaluateFixtureDocuments(context.fixtureContext);
  check(checks, "method-gap dependency is live-semantic green", methodGapChecks.every((item) => item.passed), { total: methodGapChecks.length, failed: methodGapChecks.filter((item) => !item.passed) });
  check(checks, "accepted fixture dependency is live-semantic green", fixtureEvaluation.passed && fixtureEvaluation.summary.failed === 0, fixtureEvaluation.summary);
  const catalogMethodIds = new Set((context.methodGapContext.methodCatalogFile.document.methods ?? []).map((item) => item.id));
  check(checks, "both proposed IDs remain outside the accepted method catalog", EXPECTED_METHOD_IDS.every((id) => !catalogMethodIds.has(id)), [...catalogMethodIds]);
  check(checks, "storage power-loss proposal is not included", !JSON.stringify(manifest.contracts).includes("GAP-IF-STORAGE-POWER-LOSS-METHOD") && !JSON.stringify(manifest.contracts).includes("PROPOSED-STORAGE-POWER-LOSS-DURABILITY-001"), manifest.contracts);
  check(checks, "owner projection paths remain authoritative and minimal", contracts.every((item) => deepEqual(item.ownerProjection, expectedOwnerProjection(item.methodId))), contracts.map((item) => item.ownerProjection));

  const adapterMethodIds = (adapter.methods ?? []).map((item) => item.methodId);
  check(checks, "method adapter is scoped to exactly two methods", exactUnique(adapterMethodIds, EXPECTED_METHOD_IDS) && exactUnique(adapter.contractMethodIds, EXPECTED_METHOD_IDS), adapterMethodIds);
  const adapterFieldProblems = [];
  for (const methodId of EXPECTED_METHOD_IDS) {
    const method = (adapter.methods ?? []).find((item) => item.methodId === methodId);
    const expected = FIELD_OWNERSHIP[methodId]?.METHOD_ADAPTER ?? [];
    const fields = method?.fields ?? [];
    const ids = fields.map((field) => field.id);
    if (!exactUnique(ids, expected) || fields.some((field) => field.state !== "PENDING_EVIDENCE" || field.value !== null || !Array.isArray(field.evidenceRefs) || field.evidenceRefs.length !== 0)) adapterFieldProblems.push({ methodId, ids, expected, fields });
  }
  check(checks, "method adapter fields are pending/null/empty and exactly method-owned", adapterFieldProblems.length === 0, adapterFieldProblems);
  const adapterJson = JSON.stringify(adapter);
  const forbiddenMethodFieldsPresent = [...METHOD_ADAPTER_FORBIDDEN].filter((fieldId) => adapterJson.includes(`"${fieldId}"`));
  check(checks, "fixture-owned, run-owned and forbidden target fields are absent from method adapter", forbiddenMethodFieldsPresent.length === 0, forbiddenMethodFieldsPresent);
  check(checks, "method adapter has no fixture target tuple or generic target facts", !Object.hasOwn(adapter, "targetTuple") && !Object.keys(adapter).some((key) => METHOD_ADAPTER_FORBIDDEN.has(key)), Object.keys(adapter));

  check(checks, "run template has explicit read-only fixtureAdapter reference", run.fixtureAdapter?.path === "hardware/evt0/test-fixture-v1/adapter.template.json" && run.fixtureAdapter?.id === "EVT0-TARGET-ADAPTER-TEMPLATE" && run.fixtureAdapter?.revision === "1.0.0" && run.fixtureAdapter?.bindingId === null, run.fixtureAdapter);
  check(checks, "run template has no real target or physical binding", run.status === "TEMPLATE_ONLY" && run.methodId === null && run.targetState === "UNRESOLVED" && run.targetAdapter?.id === null && run.targetAdapter?.sha256 === null && run.fixtureProfile?.id === null && run.fixtureInstance?.id === null && run.labSession?.sessionId === null && run.testResult?.resultId === null && run.verdict === null && run.physicalReadiness === null, run);
  check(checks, "TestResult remains raw-artifact owner", run.rawArtifactOwner?.ownerPath === "hardware/evt0/test-result-v1/schema.json" && run.rawArtifactOwner?.field === "rawArtifacts" && run.rawArtifactOwner?.effect === "NONE" && run.rawArtifacts?.length === 0, { rawArtifactOwner: run.rawArtifactOwner, rawArtifacts: run.rawArtifacts });
  check(checks, "HIL evidence-capture lane remains pending owner extension", run.evidenceCapture?.ownerPath === PATHS.evidenceCaptureProfile && run.evidenceCapture?.captureRouteState === "PENDING_OWNER_EXTENSION" && run.evidenceCapture?.laneId === null && run.evidenceCapture?.captureIndexId === null && run.evidenceCapture?.sha256 === null, run.evidenceCapture);
  check(checks, "current evidence-capture profile has no HIL lane", context.evidenceCaptureProfileFile.document.profileId === "HW-EVIDENCE-CAPTURE-ADAPTER-V1" && exactUnique((context.evidenceCaptureProfileFile.document.lanes ?? []).map((lane) => lane.id), EVIDENCE_CAPTURE_LANES), (context.evidenceCaptureProfileFile.document.lanes ?? []).map((lane) => lane.id));
  check(checks, "future software and firmware identities remain absent from run", run.software?.contractId === null && run.software?.transactionScenarioId === null && run.firmware?.artifactRole === null && run.firmware?.implementationLane === null && run.firmware?.version === null && run.firmware?.evidenceRef === null, { software: run.software, firmware: run.firmware });

  const softwareSemantics = liveSoftwareSemantics(context);
  check(checks, "software read-only boundary uses accepted desktop report semantics", softwareSemantics.parent && softwareSemantics.child && softwareSemantics.acceptedDesktopReport && softwareSemantics.impact, softwareSemantics);
  check(checks, "BOARD_TARGET remains unresolved in live target binding", context.methodGapContext.targetBindingFile.document.targetIdentity?.state === "UNRESOLVED", context.methodGapContext.targetBindingFile.document.targetIdentity);
  check(checks, "README records the corrected seam and pending HIL capture lane", context.readmeFile.text.includes("method-specific adapter") && context.readmeFile.text.includes("PENDING_OWNER_EXTENSION") && /TestResult\/raw\s+artifact owner/.test(context.readmeFile.text), null);

  const implementationProblems = [];
  const implementation = manifest.implementation ?? [];
  for (const expectedPath of EXPECTED_IMPLEMENTATION_PATHS) {
    const declared = implementation.find((item) => item.path === expectedPath);
    let actual = null;
    try { actual = await readArtifact(expectedPath); } catch (error) { actual = { error: error.message }; }
    if (!declared || !actual || declared.revision !== "1.0.0" || declared.bytes !== actual.bytesLength || declared.sha256 !== actual.sha256) implementationProblems.push({ expectedPath, declared, actual: actual && actual.sha256 ? { bytes: actual.bytesLength, sha256: actual.sha256 } : actual });
  }
  check(checks, "implementation identities match current bytes and revision", implementation.length === EXPECTED_IMPLEMENTATION_PATHS.length && implementationProblems.length === 0, implementationProblems);
  check(checks, "no promotion, physical readiness, verdict, or ReleaseGate receipt claim exists", !JSON.stringify({ manifest, adapter, run }).match(/"(?:verdict|physicalReadiness|receiptId|physicalQualification|releaseGateClosed|boardStatePromoted|targetPromoted)"\s*:\s*(?:true|"(?:PASS|FAIL|READY|QUALIFIED|CLOSED|FROZEN|RESOLVED)")/i), { manifest: manifest.effects, adapter: adapter.effects, run: run.effects });
  check(checks, "all method adapter values remain null with empty evidence refs", (adapter.methods ?? []).every((method) => (method.fields ?? []).every((field) => field.value === null && field.evidenceRefs?.length === 0)), adapter.methods);
  check(checks, "contract package does not duplicate raw evidence or stable owner content", !JSON.stringify({ ...manifest, implementation: [] }).includes("raw/") && !JSON.stringify({ ...manifest, implementation: [] }).match(/\"(?:bytes|sha256)\"\s*:/), null);
  check(checks, "storage remains pending outside the frozen contract package", context.methodGapContext.manifestFile.document.gaps?.find((gap) => gap.gapId === "GAP-IF-STORAGE-POWER-LOSS-METHOD")?.decision === "KEEP_PENDING_MORE_PRIMARY_EVIDENCE", context.methodGapContext.manifestFile.document.gaps);
  return checks;
}

export async function runValidation() {
  const context = await loadFixtureMethodContractContext();
  const checks = await evaluateFixtureMethodContract(context);
  const acceptedReport = context.acceptedDesktopAuthoringReportFile.document;
  const report = {
    schemaVersion: 1,
    reportKind: "hardware-fixture-method-contract-validation-v1",
    package: { path: PATHS.manifest, packageId: context.manifestFile.document.packageId, revision: context.manifestFile.document.revision, bytes: context.manifestFile.bytesLength, sha256: context.manifestFile.sha256 },
    contracts: context.manifestFile.document.contracts?.map((item) => ({ methodId: item.methodId, gapId: item.gapId, status: item.status })) ?? [],
    methodAdapterFieldCounts: Object.fromEntries((context.adapterFile.document.methods ?? []).map((method) => [method.methodId, method.fields?.length ?? 0])),
    software: {
      parentAnchor: { path: context.softwareParentFile.path, sha256: context.softwareParentFile.sha256 },
      childAnchor: { path: context.softwareChildFile.path, sha256: context.softwareChildFile.sha256 },
      acceptedDesktopAuthoringReport: { path: context.acceptedDesktopAuthoringReportFile.path, sha256: context.acceptedDesktopAuthoringReportFile.sha256, checks: acceptedReport.checks, passed: acceptedReport.passed, hardwareImpact: acceptedReport.hardwareImpact, boardTarget: acceptedReport.boardTarget },
      explicitHardwareImpactReport: { path: context.explicitHardwareImpactReportFile.path, sha256: context.explicitHardwareImpactReportFile.sha256, boundaries: context.explicitHardwareImpactReportFile.document.boundaries ?? {} },
    },
    checks,
    summary: { total: checks.length, passed: checks.filter((item) => item.passed).length, failed: checks.filter((item) => !item.passed).length },
    passed: checks.every((item) => item.passed),
  };
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runValidation();
    console.log(`Hardware fixture method contract validation: ${report.passed ? "PASS" : "FAIL"} (${report.summary.passed}/${report.summary.total})`);
    console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`Hardware fixture method contract validation: ERROR ${error.stack ?? error.message}`);
    process.exitCode = 1;
  }
}
