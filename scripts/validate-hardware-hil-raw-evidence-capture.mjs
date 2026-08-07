import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { evaluateFixtureDocuments, loadFixtureContext } from "./validate-hardware-test-fixture.mjs";
import { evaluateFixtureMethodContract, loadFixtureMethodContractContext } from "./validate-hardware-fixture-method-contract.mjs";
import { evaluateMethodGapManifest, loadMethodGapContext } from "./validate-hardware-method-gap-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = "hardware/evt0/hil-raw-evidence-capture-v1";
const REPORT_PATH = path.join(ROOT, "build", "hardware-hil-raw-evidence-capture-validation.json");

export const PATHS = {
  schema: `${PACKAGE_ROOT}/schema.json`,
  captureSchema: `${PACKAGE_ROOT}/capture-index.schema.json`,
  manifest: `${PACKAGE_ROOT}/manifest.json`,
  template: `${PACKAGE_ROOT}/capture-index.template.json`,
  readme: `${PACKAGE_ROOT}/README.md`,
  methodContractManifest: "hardware/evt0/fixture-method-contract-v1/manifest.json",
  methodContractRun: "hardware/evt0/fixture-method-contract-v1/run.template.json",
  methodGapManifest: "hardware/evt0/method-gap-evidence-v1/manifest.json",
  methodGapSchema: "hardware/evt0/method-gap-evidence-v1/schema.json",
  evidenceProfile: "hardware/evt0/evidence-capture-v1/profile.json",
  evidenceProfileSchema: "hardware/evt0/evidence-capture-v1/profile.schema.json",
  evidenceRequestSchema: "hardware/evt0/evidence-capture-v1/capture-request.schema.json",
  evidenceIndexSchema: "hardware/evt0/evidence-capture-v1/capture-index.schema.json",
  testResultSchema: "hardware/evt0/test-result-v1/schema.json",
  targetBinding: "hardware/evt0/hardware-system-v1/target-binding.json",
  softwareParent: "docs/codex/tasks/system-product-rd/active-task.md",
  softwareChild: "docs/codex/tasks/desktop-authoring-ui-adapter/active-task.md",
  acceptedDesktopReport: "build/companion-desktop-authoring-task-validation/report.json",
  explicitHardwareImpactReport: "build/companion-tts-source-adapter-validation/report.json",
  packageJson: "package.json",
};

const EXPECTED_METHODS = [
  {
    methodId: "PROPOSED-USB-DATA-OBSERVATION-001",
    gapId: "GAP-IF-USB-DATA-METHOD",
    sourceIds: [
      "SRC-METHOD-GAP-USB-COMPLIANCE-PAGE",
      "SRC-METHOD-GAP-USB-COMPLIANCE-PDF",
      "SRC-METHOD-GAP-USB-BASE-PAGE",
    ],
    rawArtifactKinds: ["enumeration_trace", "transfer_trace", "disconnect_reconnect_trace", "raw_capture_manifest", "session_binding_ref"],
  },
  {
    methodId: "PROPOSED-CONTROL-STATUS-HIL-001",
    gapId: "GAP-CONTROL-STATUS-METHOD",
    sourceIds: ["SRC-METHOD-GAP-HIL-NI-VERISTAND", "SRC-METHOD-GAP-HIL-OPENHTF"],
    rawArtifactKinds: ["stimulus_trace", "observation_trace", "diagnostic_log", "measurement_manifest", "attachment_manifest"],
  },
];
const EXPECTED_METHOD_IDS = EXPECTED_METHODS.map((item) => item.methodId);
const EXPECTED_GAP_IDS = EXPECTED_METHODS.map((item) => item.gapId);
const EXPECTED_EVIDENCE_LANES = ["VENDOR_CONTACT", "BENCHMARK_SELLER", "LAB_REGISTRY", "VENDOR_RESPONSE"];
const EXPECTED_ARTIFACT_ROLES = [
  "USB_ENUMERATION_TRACE",
  "USB_TRANSFER_TRACE",
  "USB_DISCONNECT_RECONNECT_TRACE",
  "USB_RAW_CAPTURE_MANIFEST",
  "USB_SESSION_BINDING_REF",
  "HIL_STIMULUS_TRACE",
  "HIL_OBSERVATION_TRACE",
  "HIL_DIAGNOSTIC_LOG",
  "HIL_MEASUREMENT_MANIFEST",
  "HIL_ATTACHMENT_MANIFEST",
];
const EXPECTED_IMPLEMENTATION_PATHS = [
  PATHS.schema,
  PATHS.captureSchema,
  PATHS.template,
  PATHS.readme,
  "scripts/validate-hardware-hil-raw-evidence-capture.mjs",
  "scripts/test-hardware-hil-raw-evidence-capture.mjs",
];
const EXPECTED_OWNER_REFS = {
  methodContractManifestPath: PATHS.methodContractManifest,
  methodContractRunTemplatePath: PATHS.methodContractRun,
  methodGapManifestPath: PATHS.methodGapManifest,
  evidenceCaptureProfilePath: PATHS.evidenceProfile,
  testResultSchemaPath: PATHS.testResultSchema,
  fixtureAdapterTemplatePath: "hardware/evt0/test-fixture-v1/adapter.template.json",
  targetBindingPath: PATHS.targetBinding,
  releaseGateCatalogPath: "hardware/evt0/release-gates-v1/catalog.json",
  testResultRawArtifactsField: "rawArtifacts",
};
const EXPECTED_EFFECTS = {
  targetBinding: "NONE",
  methodCatalog: "NONE",
  physicalEvidence: "NONE",
  testResult: "NONE_REFERENCE_OWNER_UNCHANGED",
  evidenceCaptureProfile: "NONE_PROFILE_UNCHANGED",
  releaseGate: "NONE",
  software: "NONE",
  qualification: "NONE",
  promotion: "NONE",
};
const ARTIFACT_REQUIRED_FIELDS = [
  "artifactId", "role", "relativePath", "byteLength", "sha256", "mediaType", "format", "capturedAt", "sourceUrl",
  "source", "captureTool", "references", "clockMetadata", "custody", "originalDerived",
];

function absolute(relativePath) {
  return path.join(ROOT, relativePath.replaceAll("/", path.sep));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function canonicalObjectEqual(left, right) {
  return JSON.stringify(left, null, 2) === JSON.stringify(right, null, 2);
}

function exactArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((item, index) => item === expected[index]) && new Set(actual).size === expected.length;
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && expected.every((item) => actual.includes(item));
}

function check(checks, name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function schemaObjectNodesAreClosed(schema, location = "#") {
  if (!schema || typeof schema !== "object") return [];
  const problems = [];
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
  return { path: relativePath, bytes, text: bytes.toString("utf8"), bytesLength: bytes.length, sha256: sha256(bytes) };
}

async function readJson(relativePath) {
  const artifact = await readArtifact(relativePath);
  return { ...artifact, document: JSON.parse(artifact.text) };
}

function pathValue(document, dottedPath) {
  return String(dottedPath).split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), document);
}

function validDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function makeAjv() {
  return new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": { type: "string", validate: validDateTime } } });
}

function softwareBoundary(context) {
  const parent = context.softwareParentFile.text;
  const child = context.softwareChildFile.text;
  const desktop = context.acceptedDesktopReportFile.document;
  const impact = context.explicitHardwareImpactReportFile.document.boundaries ?? {};
  const desktopChecks = Number(desktop.checks);
  return {
    parent: parent.includes("hardwareImpact=NONE") && parent.includes("BOARD_TARGET=UNRESOLVED"),
    child: child.includes("hardwareImpact=NONE") && child.includes("BOARD_TARGET=UNRESOLVED"),
    desktopReport: Number.isInteger(desktopChecks) && desktopChecks > 0 && Number(desktop.passed) === desktopChecks && Number(desktop.failed ?? 0) === 0 && desktop.hardwareImpact === "NONE" && desktop.boardTarget === "UNRESOLVED",
    explicitImpact: impact.hardwareImpact === "NONE" && impact.boardTarget === "UNRESOLVED" && impact.sessionCoreModified === false && impact.familyWorkspaceModified === false && impact.productionProviderQualified === false && impact.offlineReady === false,
  };
}

export async function loadHilRawEvidenceCaptureContext() {
  const files = await Promise.all([
    readJson(PATHS.schema),
    readJson(PATHS.captureSchema),
    readJson(PATHS.manifest),
    readJson(PATHS.template),
    readArtifact(PATHS.readme),
    readJson(PATHS.methodContractManifest),
    readJson(PATHS.methodContractRun),
    readJson(PATHS.methodGapManifest),
    readJson(PATHS.evidenceProfile),
    readJson(PATHS.evidenceProfileSchema),
    readJson(PATHS.evidenceRequestSchema),
    readJson(PATHS.evidenceIndexSchema),
    readJson(PATHS.testResultSchema),
    readJson(PATHS.targetBinding),
    readArtifact(PATHS.softwareParent),
    readArtifact(PATHS.softwareChild),
    readJson(PATHS.acceptedDesktopReport),
    readJson(PATHS.explicitHardwareImpactReport),
    readJson(PATHS.packageJson),
  ]);
  const [schemaFile, captureSchemaFile, manifestFile, templateFile, readmeFile, methodContractManifestFile, methodContractRunFile,
    methodGapManifestFile, evidenceProfileFile, evidenceProfileSchemaFile, evidenceRequestSchemaFile, evidenceIndexSchemaFile,
    testResultSchemaFile, targetBindingFile, softwareParentFile, softwareChildFile, acceptedDesktopReportFile, explicitHardwareImpactReportFile, packageFile] = files;
  const ajv = makeAjv();
  const validators = {
    manifest: ajv.compile(schemaFile.document),
    capture: ajv.compile(captureSchemaFile.document),
    evidenceProfile: ajv.compile(evidenceProfileSchemaFile.document),
    evidenceRequest: ajv.compile(evidenceRequestSchemaFile.document),
    evidenceIndex: ajv.compile(evidenceIndexSchemaFile.document),
    testResult: ajv.compile(testResultSchemaFile.document),
  };
  const fixtureMethodContractContext = await loadFixtureMethodContractContext();
  const fixtureContext = await loadFixtureContext();
  const methodGapContext = await loadMethodGapContext();
  return {
    schemaFile, captureSchemaFile, manifestFile, templateFile, readmeFile, methodContractManifestFile, methodContractRunFile,
    methodGapManifestFile, evidenceProfileFile, evidenceProfileSchemaFile, evidenceRequestSchemaFile, evidenceIndexSchemaFile,
    testResultSchemaFile, targetBindingFile, softwareParentFile, softwareChildFile, acceptedDesktopReportFile, explicitHardwareImpactReportFile, packageFile,
    fixtureMethodContractContext, fixtureContext, methodGapContext, validators,
  };
}

async function rawSnapshotInventory(context) {
  const sourceRecords = context.methodGapManifestFile.document.officialSources ?? [];
  const withRaw = sourceRecords.filter((source) => typeof source.localRawPath === "string");
  const problems = [];
  for (const source of withRaw) {
    try {
      const actual = await readArtifact(source.localRawPath);
      if (actual.bytesLength !== source.bytes || actual.sha256 !== source.sha256) problems.push({ sourceId: source.sourceId, expected: { bytes: source.bytes, sha256: source.sha256 }, actual: { bytes: actual.bytesLength, sha256: actual.sha256 } });
    } catch (error) {
      problems.push({ sourceId: source.sourceId, error: error.message });
    }
  }
  const inaccessible = sourceRecords.filter((source) => !source.localRawPath).map((source) => ({ sourceId: source.sourceId, httpStatus: source.httpStatus, publisher: source.publisher }));
  return { sourceCount: sourceRecords.length, rawCount: withRaw.length, problems, inaccessible };
}

function expectedMethodRef(methodId) {
  return EXPECTED_METHODS.find((item) => item.methodId === methodId);
}

function templateIsPending(template) {
  const nullPaths = [
    "captureIndexId", "contractRef.sha256", "fixtureAdapterRef.bindingId", "fixtureProfileRef.sha256", "fixtureInstanceRef.id",
    "runBindingRef.methodId", "labSessionRef.sessionId", "labSessionRef.sha256", "testResultRef.resultId", "testResultRef.sha256",
    "evidenceCaptureRef.laneId", "evidenceCaptureRef.captureIndexId", "releaseGateRef.receiptId", "softwareRef.contractId",
    "softwareRef.scenarioId", "firmwareRef.artifactRole", "firmwareRef.implementationLane", "firmwareRef.version", "firmwareRef.evidenceRef",
    "captureTool.identity", "captureTool.version", "captureTool.configSha256", "chainOfCustody.operatorId", "chainOfCustody.source",
    "resultProjection.testResultId", "resultProjection.verdict",
  ];
  const nullValues = nullPaths.every((item) => pathValue(template, item) === null);
  return nullValues && template.status === "TEMPLATE_ONLY" && template.methodId === null && template.targetState === "UNRESOLVED" && template.artifacts.length === 0 && template.chainOfCustody.events.length === 0 && template.resultProjection.physicalEvidenceState === "NONE" && template.resultProjection.qualificationState === "NONE" && !Object.hasOwn(template, "rawArtifacts");
}

export async function evaluateHilRawEvidenceCapture(context, manifest = context.manifestFile.document, template = context.templateFile.document) {
  const checks = [];
  const { validators } = context;
  check(checks, "manifest schema validates", validators.manifest(manifest), validators.manifest.errors);
  check(checks, "capture-index schema validates", validators.capture(template), validators.capture.errors);
  const canonicalFiles = [context.schemaFile, context.captureSchemaFile, context.manifestFile, context.templateFile];
  check(checks, "package JSON uses canonical pretty JSON plus newline", canonicalFiles.every((file) => canonicalJson(file.document) === file.text), canonicalFiles.map((file) => ({ path: file.path, canonical: canonicalJson(file.document) === file.text })));
  check(checks, "manifest schema object nodes are closed", schemaObjectNodesAreClosed(context.schemaFile.document).length === 0, schemaObjectNodesAreClosed(context.schemaFile.document));
  check(checks, "capture schema object nodes are closed", schemaObjectNodesAreClosed(context.captureSchemaFile.document).length === 0, schemaObjectNodesAreClosed(context.captureSchemaFile.document));
  check(checks, "package identity/status/target boundary", manifest.packageId === "HW-HIL-RAW-EVIDENCE-CAPTURE-LANE-V1" && manifest.revision === "1.0.0" && manifest.status === "PROPOSED_PENDING_OWNER_EXTENSION" && manifest.boardTargetState === "UNRESOLVED", manifest);
  check(checks, "exact single proposed lane and pending adoption", manifest.lane?.laneId === "HIL_RAW_TEST" && manifest.lane.status === "PROPOSED_ONLY" && manifest.lane.acceptedInEvidenceCaptureProfile === false && manifest.lane.captureRouteState === "PENDING_OWNER_EXTENSION" && manifest.lane.adoptionId === null, manifest.lane);
  check(checks, "exact two proposed method references", exactArray((manifest.methodRefs ?? []).map((item) => item.methodId), EXPECTED_METHOD_IDS) && manifest.methodRefs.every((item) => item.status === "PROPOSED_ONLY" && item.acceptedInMethodCatalog === false), manifest.methodRefs);
  check(checks, "exact method gap mapping and raw artifact kinds", manifest.methodRefs.every((item) => {
    const expected = expectedMethodRef(item.methodId);
    return expected && item.gapId === expected.gapId && exactArray(item.sourceIds, expected.sourceIds) && exactArray(item.rawArtifactKinds, expected.rawArtifactKinds);
  }), manifest.methodRefs);
  check(checks, "owner references remain single-source and exact", canonicalObjectEqual(manifest.ownerRefs, EXPECTED_OWNER_REFS), manifest.ownerRefs);
  check(checks, "proposed effects are all non-promoting", canonicalObjectEqual(manifest.effects, EXPECTED_EFFECTS), manifest.effects);

  const contract = context.methodContractManifestFile.document;
  const contractById = new Map((contract.contracts ?? []).map((item) => [item.methodId, item]));
  check(checks, "source contract identity and proposed-only state", contract.packageId === "HW-FIXTURE-METHOD-CONTRACT-USB-CONTROL-HIL-V1" && contract.revision === "1.0.0" && exactArray((contract.contracts ?? []).map((item) => item.methodId), EXPECTED_METHOD_IDS) && EXPECTED_METHODS.every((expected) => {
    const actual = contractById.get(expected.methodId);
    return actual && actual.gapId === expected.gapId && actual.status === "PROPOSED_ONLY" && actual.acceptedInMethodCatalog === false;
  }), { packageId: contract.packageId, revision: contract.revision, contracts: contract.contracts });
  check(checks, "source method refs match accepted contract raw kinds", manifest.methodRefs.every((item) => canonicalObjectEqual(item.rawArtifactKinds, contractById.get(item.methodId)?.rawArtifactKinds)), manifest.methodRefs);
  check(checks, "capture-index template identity and pending state", template.packageId === manifest.packageId && template.packageRevision === manifest.revision && template.laneId === "HIL_RAW_TEST" && template.laneState === "PENDING_OWNER_EXTENSION" && exactArray(template.allowedMethodIds, EXPECTED_METHOD_IDS) && template.methodId === null && template.targetState === "UNRESOLVED", template);
  check(checks, "capture-index template has no fabricated evidence or result", templateIsPending(template), template);
  check(checks, "capture-index template keeps TestResult rawArtifacts as owner", template.testResultRef?.ownerPath === PATHS.testResultSchema && template.testResultRef?.rawArtifactsField === "rawArtifacts" && !Object.hasOwn(template, "rawArtifacts"), template.testResultRef);
  check(checks, "capture-index template keeps fixture adapter as owner", template.fixtureAdapterRef?.path === "hardware/evt0/test-fixture-v1/adapter.template.json" && template.fixtureAdapterRef?.id === "EVT0-TARGET-ADAPTER-TEMPLATE" && template.fixtureAdapterRef?.bindingId === null, template.fixtureAdapterRef);
  check(checks, "capture-index template keeps HIL lane pending in existing profile", template.evidenceCaptureRef?.ownerPath === PATHS.evidenceProfile && template.evidenceCaptureRef?.captureRouteState === "PENDING_OWNER_EXTENSION" && template.evidenceCaptureRef?.laneId === null && template.evidenceCaptureRef?.captureIndexId === null, template.evidenceCaptureRef);

  const profile = context.evidenceProfileFile.document;
  const profileLanes = (profile.lanes ?? []).map((lane) => lane.id);
  check(checks, "existing evidence-capture profile has exactly four non-HIL lanes", profile.profileId === "HW-EVIDENCE-CAPTURE-ADAPTER-V1" && exactArray(profileLanes, EXPECTED_EVIDENCE_LANES) && !profileLanes.includes("HIL_RAW_TEST"), profileLanes);
  check(checks, "existing evidence-capture owner effects remain non-promoting", canonicalObjectEqual(profile.effects, {
    targetBindingEffect: "NONE",
    adapterEffect: "EVIDENCE_CAPTURE_ONLY",
    bomRevisionEffect: "NONE",
    releaseGateEffect: "NONE",
    purchaseAuthorizationEffect: "NONE",
    recordStateEffect: "NONE_OWNER_RECORD_UNCHANGED",
    sourceArtifactEffect: "NONE_READ_ONLY",
  }), profile.effects);
  check(checks, "TestResult schema exposes rawArtifacts owner", typeof validators.testResult === "function" && Object.hasOwn(context.testResultSchemaFile.document.properties ?? {}, "rawArtifacts"), context.testResultSchemaFile.document.properties?.rawArtifacts);
  check(checks, "capture-index artifact metadata schema is complete and closed", exactArray(context.captureSchemaFile.document.$defs.artifact.required, ARTIFACT_REQUIRED_FIELDS) && EXPECTED_ARTIFACT_ROLES.every((role) => context.captureSchemaFile.document.$defs.artifact.properties.role.enum.includes(role)) && schemaObjectNodesAreClosed(context.captureSchemaFile.document.$defs.artifact).length === 0, context.captureSchemaFile.document.$defs.artifact);

  const rawSnapshots = await rawSnapshotInventory(context);
  check(checks, "official method-gap raw snapshots remain exact", rawSnapshots.problems.length === 0 && rawSnapshots.rawCount >= 9, rawSnapshots);
  check(checks, "inaccessible official source records remain explicit", rawSnapshots.inaccessible.every((item) => item.httpStatus === 403), rawSnapshots.inaccessible);
  const unavailableSources = context.methodGapManifestFile.document.unavailableOfficialSources ?? [];
  check(checks, "JEDEC inaccessible source record remains HTTP 403 provenance", unavailableSources.length === 1 && unavailableSources[0].sourceId === "SRC-METHOD-GAP-UNAVAILABLE-JEDEC-POWER-LOSS" && unavailableSources[0].httpStatus === 403 && unavailableSources[0].accessState === "INACCESSIBLE" && unavailableSources[0].localRawPath === null, unavailableSources);

  let contractChecks = [];
  let fixtureChecks = [];
  let methodGapChecks = [];
  try {
    const contractResult = await evaluateFixtureMethodContract(context.fixtureMethodContractContext);
    const fixtureResult = evaluateFixtureDocuments(context.fixtureContext);
    contractChecks = Array.isArray(contractResult) ? contractResult : contractResult.checks;
    fixtureChecks = Array.isArray(fixtureResult) ? fixtureResult : fixtureResult.checks;
    methodGapChecks = evaluateMethodGapManifest(context.methodGapContext);
  } catch (error) {
    contractChecks = [{ name: "fixture method contract semantic evaluation", passed: false, detail: error.message }];
    fixtureChecks = [{ name: "fixture semantic evaluation", passed: false, detail: error.message }];
    methodGapChecks = [{ name: "method-gap semantic evaluation", passed: false, detail: error.message }];
  }
  check(checks, "current fixture/method-gap semantic owners validate", contractChecks.every((item) => item.passed) && fixtureChecks.every((item) => item.passed) && methodGapChecks.every((item) => item.passed), {
    fixtureMethodContract: { passed: contractChecks.filter((item) => item.passed).length, total: contractChecks.length },
    fixture: { passed: fixtureChecks.filter((item) => item.passed).length, total: fixtureChecks.length },
    methodGap: { passed: methodGapChecks.filter((item) => item.passed).length, total: methodGapChecks.length },
  });
  check(checks, "target binding remains unresolved", context.targetBindingFile?.document?.targetIdentity?.state === "UNRESOLVED", context.targetBindingFile?.document?.targetIdentity);
  check(checks, "software read-only boundary uses live semantics", Object.values(softwareBoundary(context)).every(Boolean), softwareBoundary(context));
  check(checks, "README explains pending lane and TestResult ownership", context.readmeFile.text.includes("PENDING_OWNER_EXTENSION") && context.readmeFile.text.includes("TestResult.rawArtifacts") && context.readmeFile.text.includes("PROPOSED_ONLY"), null);

  const scripts = context.packageFile.document.scripts ?? {};
  const validateCommand = "node scripts/validate-hardware-hil-raw-evidence-capture.mjs";
  const testCommand = "node scripts/test-hardware-hil-raw-evidence-capture.mjs";
  const rdSequence = "npm run validate:hardware-fixture-method-contract && npm run test:hardware-fixture-method-contract && npm run validate:hardware-hil-raw-evidence-capture && npm run test:hardware-hil-raw-evidence-capture &&";
  const countOccurrences = (text, needle) => String(text ?? "").split(needle).length - 1;
  check(checks, "npm wiring invokes exact HIL validator and selftest", scripts["validate:hardware-hil-raw-evidence-capture"] === validateCommand && scripts["test:hardware-hil-raw-evidence-capture"] === testCommand, { validate: scripts["validate:hardware-hil-raw-evidence-capture"], test: scripts["test:hardware-hil-raw-evidence-capture"] });
  check(checks, "validate:hardware-rd places HIL pair immediately after fixture-contract pair exactly once", countOccurrences(scripts["validate:hardware-rd"], "npm run validate:hardware-hil-raw-evidence-capture") === 1 && countOccurrences(scripts["validate:hardware-rd"], "npm run test:hardware-hil-raw-evidence-capture") === 1 && scripts["validate:hardware-rd"].includes(rdSequence), scripts["validate:hardware-rd"]);

  const implementationProblems = [];
  const implementation = manifest.implementation ?? [];
  for (const expectedPath of EXPECTED_IMPLEMENTATION_PATHS) {
    const declared = implementation.find((item) => item.path === expectedPath);
    try {
      const actual = await readArtifact(expectedPath);
      if (!declared || declared.revision !== "1.0.0" || declared.bytes !== actual.bytesLength || declared.sha256 !== actual.sha256) implementationProblems.push({ expectedPath, declared, actual: { bytes: actual.bytesLength, sha256: actual.sha256 } });
    } catch (error) {
      implementationProblems.push({ expectedPath, error: error.message });
    }
  }
  check(checks, "implementation identities match package-owned bytes and revision", implementation.length === EXPECTED_IMPLEMENTATION_PATHS.length && implementationProblems.length === 0 && !implementation.some((item) => item.path === PATHS.packageJson), implementationProblems);
  check(checks, "all effects and result projections remain NONE", canonicalObjectEqual(template.effects, EXPECTED_EFFECTS) && template.resultProjection.verdict === null && template.resultProjection.physicalEvidenceState === "NONE" && template.resultProjection.qualificationState === "NONE", { effects: template.effects, resultProjection: template.resultProjection });
  check(checks, "package does not duplicate raw source bytes or owner records", !JSON.stringify(manifest).includes("/raw/") && !JSON.stringify(template).includes("/raw/") && !Object.hasOwn(template, "rawArtifacts"), null);
  check(checks, "storage power-loss remains outside this package", !manifest.methodRefs.some((item) => item.methodId.includes("STORAGE")) && !JSON.stringify(template).includes("STORAGE-POWER-LOSS"), null);
  check(checks, "no target, physical, qualification or ReleaseGate promotion claim", !JSON.stringify({ manifest, template }).match(/TARGET_VOLTAGE|TARGET_CURRENT|POGO_LAYOUT|MECHANICAL_DIMENSIONS|CALIBRATION_ID|QUALIFICATION_ID|PHYSICAL_READINESS|ACCEPTANCE_THRESHOLDS|\"receiptId\"\s*:\s*\"|\"verdict\"\s*:\s*\"/), null);

  return checks;
}

export async function runValidation() {
  const context = await loadHilRawEvidenceCaptureContext();
  const checks = await evaluateHilRawEvidenceCapture(context);
  const report = {
    schemaVersion: 1,
    reportKind: "hardware-hil-raw-evidence-capture-validation-v1",
    package: {
      path: PATHS.manifest,
      packageId: context.manifestFile.document.packageId,
      revision: context.manifestFile.document.revision,
      bytes: context.manifestFile.bytesLength,
      sha256: context.manifestFile.sha256,
    },
    lane: {
      laneId: context.manifestFile.document.lane?.laneId,
      acceptedInEvidenceCaptureProfile: context.manifestFile.document.lane?.acceptedInEvidenceCaptureProfile,
      captureRouteState: context.manifestFile.document.lane?.captureRouteState,
    },
    methods: context.manifestFile.document.methodRefs?.map((item) => ({ methodId: item.methodId, gapId: item.gapId, status: item.status })) ?? [],
    software: {
      parentAnchor: { path: PATHS.softwareParent, sha256: context.softwareParentFile.sha256 },
      childAnchor: { path: PATHS.softwareChild, sha256: context.softwareChildFile.sha256 },
      acceptedDesktopReport: { path: PATHS.acceptedDesktopReport, sha256: context.acceptedDesktopReportFile.sha256, checks: context.acceptedDesktopReportFile.document.checks, passed: context.acceptedDesktopReportFile.document.passed, hardwareImpact: context.acceptedDesktopReportFile.document.hardwareImpact, boardTarget: context.acceptedDesktopReportFile.document.boardTarget },
      explicitHardwareImpactReport: { path: PATHS.explicitHardwareImpactReport, sha256: context.explicitHardwareImpactReportFile.sha256, boundaries: context.explicitHardwareImpactReportFile.document.boundaries ?? {} },
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
    console.log(`Hardware HIL raw-evidence capture validation: ${report.passed ? "PASS" : "FAIL"} (${report.summary.passed}/${report.summary.total})`);
    console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`Hardware HIL raw-evidence capture validation: ERROR ${error.stack ?? error.message}`);
    process.exitCode = 1;
  }
}
