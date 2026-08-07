import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalSha256 } from "./snapshot-jcs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(ROOT, "build", "hardware-test-fixture-validation.json");
const PACKAGE_ROOT = "hardware/evt0/test-fixture-v1";

const PACKAGE_DOCUMENTS = {
  profileSchema: `${PACKAGE_ROOT}/profile.schema.json`,
  profile: `${PACKAGE_ROOT}/profile.json`,
  adapterSchema: `${PACKAGE_ROOT}/adapter.schema.json`,
  adapterTemplate: `${PACKAGE_ROOT}/adapter.template.json`,
  instanceSchema: `${PACKAGE_ROOT}/instance.schema.json`,
  instanceTemplate: `${PACKAGE_ROOT}/instance.template.json`,
  selftestSchema: `${PACKAGE_ROOT}/selftest.schema.json`,
  selftestTemplate: `${PACKAGE_ROOT}/selftest.template.json`,
};

const OWNER_PATHS = {
  topology: "hardware/evt0/hardware-system-v1/topology.json",
  targetBinding: "hardware/evt0/hardware-system-v1/target-binding.json",
  methodCatalog: "hardware/evt0/lab-v1/method-catalog.json",
  registrationPlan: "hardware/evt0/lab-v1/registration-capture-plan.json",
  instrumentRegistrySchema: "hardware/evt0/lab-v1/instrument-registry.schema.json",
  labRegistryTemplate: "hardware/evt0/lab-v1/instrument-registry.template.json",
  labSessionTemplate: "hardware/evt0/lab-v1/session.template.json",
  testResultSchema: "hardware/evt0/test-result-v1/schema.json",
  evidenceCaptureProfile: "hardware/evt0/evidence-capture-v1/profile.json",
  releaseGateCatalog: "hardware/evt0/release-gates-v1/catalog.json",
  softwareReport: "build/companion-tts-source-adapter-validation/report.json",
  softwareFormalReport: "build/companion-authoring-task-recovery-validation/report.json",
  softwareAnchor: "docs/codex/tasks/system-product-rd/active-task.md",
  softwareSync: "docs/research/hardware-software-sync-2026-08-04.md",
};

export const EXPECTED_CAPABILITY_IDS = [
  "CAP-FIXTURE-EVIDENCE-ANCHOR",
  "CAP-OPTICAL-PRESENTATION-DATUM",
  "CAP-OID-EVENT-TIMING-OBSERVATION",
  "CAP-POWER-SAFE-INJECTION",
  "CAP-CONTENT-STORAGE-OFFLINE",
  "CAP-USB-DATA-TRANSPORT",
  "CAP-AUDIO-ACOUSTIC-OBSERVATION",
  "CAP-CONTROL-STATUS-DIAGNOSTIC-HIL",
];

export const EXPECTED_IMPLEMENTATION_PATHS = [
  `${PACKAGE_ROOT}/profile.schema.json`,
  `${PACKAGE_ROOT}/adapter.schema.json`,
  `${PACKAGE_ROOT}/instance.schema.json`,
  `${PACKAGE_ROOT}/selftest.schema.json`,
  `${PACKAGE_ROOT}/README.md`,
  "scripts/validate-hardware-test-fixture.mjs",
  "scripts/test-hardware-test-fixture.mjs",
];

const EXPECTED_INTERFACE_IDS = [
  "IF-OID-OPTICAL",
  "IF-OID-EVENT",
  "IF-STORAGE",
  "IF-AUDIO-SIGNAL",
  "IF-USB-DATA",
  "IF-USB-POWER",
  "IF-BATTERY-POWER",
  "IF-BOARD-POWER",
  "IF-AUDIO-POWER",
  "IF-CONTROL",
  "IF-STATUS",
  "IF-DIAGNOSTIC",
  "IF-WIRELESS",
  "IF-HEAD-MECHANICAL",
  "IF-BOARD-MECHANICAL",
  "IF-AUDIO-ACOUSTIC",
  "IF-USB-MECHANICAL",
  "IF-USER-IO-MECHANICAL",
];

const EXPECTED_CAPABILITIES = [
  {
    id: "CAP-FIXTURE-EVIDENCE-ANCHOR",
    role: "CROSS_CUTTING",
    status: "RECOMMENDED",
    interfaceRefs: ["IF-DIAGNOSTIC"],
    methodRefs: ["LAB-SETUP-001"],
    instrumentSlotRefs: ["PSU-01", "DMM-01", "MECH-01", "MACRO-01", "USBPWR-01", "SPL-01"],
    assetKindRefs: ["BENCH_SUPPLY", "MULTIMETER", "CALIPER", "SCALE", "MACRO_CAMERA", "USB_C_POWER_METER", "SOUND_LEVEL_METER"],
    releaseGateRefs: ["RG-HOST-EVT0-INTAKE-CONTRACT-PASSED"],
    coverage: { interfaceRole: "CROSS_CUTTING", methodState: "READY_NOW", instrumentState: "COVERED" },
  },
  {
    id: "CAP-OPTICAL-PRESENTATION-DATUM",
    role: "OPERATIONAL",
    status: "RECOMMENDED",
    interfaceRefs: ["IF-OID-OPTICAL", "IF-HEAD-MECHANICAL"],
    methodRefs: ["MECH-INTAKE-001", "OID-OPTICS-INTAKE-001"],
    instrumentSlotRefs: ["MECH-01", "MACRO-01"],
    assetKindRefs: ["CALIPER", "SCALE", "MACRO_CAMERA"],
    releaseGateRefs: ["RG-OID-CODE-TOOL-FROZEN", "RG-OID-PHYSICAL-MAP-ASSIGNED", "RG-OID-TWO-HEAD-TWO-PRINT-MATRIX-PASSED", "RG-BOARD-TARGET-FROZEN", "RG-TARGET-FORM-RELIABILITY-PASSED"],
    coverage: { interfaceRole: "OPERATIONAL", methodState: "READY_NOW", instrumentState: "COVERED" },
  },
  {
    id: "CAP-OID-EVENT-TIMING-OBSERVATION",
    role: "OPERATIONAL",
    status: "RECOMMENDED",
    interfaceRefs: ["IF-OID-EVENT"],
    methodRefs: ["PWR-BOARD-BOOT-001", "OID-FUNCTION-001"],
    instrumentSlotRefs: ["PSU-01", "DMM-01", "USBPWR-01", "MACRO-01"],
    assetKindRefs: ["BENCH_SUPPLY", "MULTIMETER", "MACRO_CAMERA", "USB_C_POWER_METER"],
    releaseGateRefs: ["RG-BOARD-TARGET-FROZEN", "RG-OID-TWO-HEAD-TWO-PRINT-MATRIX-PASSED", "RG-POINT-READ-LATENCY-PASSED"],
    coverage: { interfaceRole: "OPERATIONAL", methodState: "READY_NOW", instrumentState: "COVERED" },
  },
  {
    id: "CAP-POWER-SAFE-INJECTION",
    role: "OPERATIONAL",
    status: "RECOMMENDED",
    interfaceRefs: ["IF-USB-POWER", "IF-BATTERY-POWER", "IF-BOARD-POWER", "IF-AUDIO-POWER"],
    methodRefs: ["USB-POWER-INTAKE-001", "PWR-BOARD-BOOT-001", "TARGET-BATTERY-001"],
    instrumentSlotRefs: ["PSU-01", "DMM-01", "USBPWR-01"],
    assetKindRefs: ["BENCH_SUPPLY", "MULTIMETER", "USB_C_POWER_METER"],
    releaseGateRefs: ["RG-BOARD-SUPPLY-VERIFIED", "RG-TARGET-STORAGE-DURABILITY-PASSED", "RG-TARGET-AUDIO-PROFILE-VERIFIED", "RG-TARGET-FORM-RELIABILITY-PASSED"],
    coverage: { interfaceRole: "OPERATIONAL", methodState: "READY_NOW", instrumentState: "COVERED" },
  },
  {
    id: "CAP-CONTENT-STORAGE-OFFLINE",
    role: "OPERATIONAL",
    status: "PARTIAL_COVERAGE",
    interfaceRefs: ["IF-STORAGE", "IF-WIRELESS"],
    methodRefs: ["OID-FUNCTION-001"],
    instrumentSlotRefs: ["DMM-01", "MACRO-01"],
    assetKindRefs: ["MULTIMETER", "MACRO_CAMERA"],
    releaseGateRefs: ["RG-TARGET-STORAGE-DURABILITY-PASSED", "RG-OFFLINE-POINT-READ-PASSED"],
    coverage: { interfaceRole: "OPERATIONAL", methodState: "PARTIAL_COVERAGE", instrumentState: "COVERED" },
  },
  {
    id: "CAP-USB-DATA-TRANSPORT",
    role: "OPERATIONAL",
    status: "PENDING_METHOD_COVERAGE",
    interfaceRefs: ["IF-USB-DATA", "IF-USB-MECHANICAL"],
    methodRefs: [],
    instrumentSlotRefs: [],
    assetKindRefs: [],
    releaseGateRefs: ["RG-DEVICELINK-PHYSICAL-TRANSPORT-PASSED", "RG-BOARD-TARGET-FROZEN", "RG-TARGET-FORM-RELIABILITY-PASSED"],
    coverage: { interfaceRole: "OPERATIONAL", methodState: "PENDING_METHOD_COVERAGE", instrumentState: "NONE_EXISTING_SLOT" },
  },
  {
    id: "CAP-AUDIO-ACOUSTIC-OBSERVATION",
    role: "OPERATIONAL",
    status: "RECOMMENDED",
    interfaceRefs: ["IF-AUDIO-SIGNAL", "IF-AUDIO-ACOUSTIC"],
    methodRefs: ["AUD-REFERENCE-001", "TARGET-ACOUSTIC-001"],
    instrumentSlotRefs: ["SPL-01", "USBPWR-01"],
    assetKindRefs: ["SOUND_LEVEL_METER", "USB_C_POWER_METER"],
    releaseGateRefs: ["RG-POINT-READ-LATENCY-PASSED", "RG-TARGET-AUDIO-PROFILE-VERIFIED", "RG-TARGET-FORM-RELIABILITY-PASSED"],
    coverage: { interfaceRole: "OPERATIONAL", methodState: "READY_NOW", instrumentState: "COVERED" },
  },
  {
    id: "CAP-CONTROL-STATUS-DIAGNOSTIC-HIL",
    role: "OPERATIONAL",
    status: "PARTIAL_COVERAGE",
    interfaceRefs: ["IF-CONTROL", "IF-STATUS", "IF-DIAGNOSTIC", "IF-BOARD-MECHANICAL", "IF-USER-IO-MECHANICAL"],
    methodRefs: ["LAB-SETUP-001", "PWR-BOARD-BOOT-001", "OID-FUNCTION-001"],
    instrumentSlotRefs: ["PSU-01", "DMM-01", "MACRO-01", "USBPWR-01"],
    assetKindRefs: ["BENCH_SUPPLY", "MULTIMETER", "MACRO_CAMERA", "USB_C_POWER_METER"],
    releaseGateRefs: ["RG-C-RUST-DIFFERENTIAL-PASSED", "RG-PLATFORM-ABI-HIL-PASSED", "RG-TARGET-TOOLCHAIN-SEALED", "RG-TWO-BOARD-PORT-HIL-PASSED", "RG-TARGET-FORM-RELIABILITY-PASSED"],
    coverage: { interfaceRole: "OPERATIONAL", methodState: "PARTIAL_COVERAGE", instrumentState: "COVERED" },
  },
];

const EXPECTED_GAPS = [
  {
    id: "GAP-IF-USB-DATA-METHOD",
    interfaceRefs: ["IF-USB-DATA"],
    state: "PENDING_METHOD_COVERAGE",
    methodRefs: [],
    instrumentSlotRefs: [],
    reason: "IF-USB-DATA has no dedicated method or lab instrument slot in the existing owner catalog.",
    nextOwner: "hardware/evt0/lab-v1/method-catalog.json",
  },
  {
    id: "GAP-IF-STORAGE-POWER-LOSS-METHOD",
    interfaceRefs: ["IF-STORAGE"],
    state: "PARTIAL_COVERAGE",
    methodRefs: ["OID-FUNCTION-001"],
    instrumentSlotRefs: ["DMM-01", "MACRO-01"],
    reason: "Offline functional observation exists, but storage power-loss durability has no dedicated existing method.",
    nextOwner: "hardware/evt0/lab-v1/method-catalog.json",
  },
  {
    id: "GAP-IF-CONTROL-STATUS-METHOD",
    interfaceRefs: ["IF-CONTROL", "IF-STATUS"],
    state: "PARTIAL_COVERAGE",
    methodRefs: ["LAB-SETUP-001", "PWR-BOARD-BOOT-001", "OID-FUNCTION-001"],
    instrumentSlotRefs: ["PSU-01", "DMM-01", "MACRO-01", "USBPWR-01"],
    reason: "Setup, boot and basic function are available, but control/status has no dedicated existing method.",
    nextOwner: "hardware/evt0/lab-v1/method-catalog.json",
  },
];

const PACKAGE_SCHEMA_KEYS = [
  ["profile", "profileSchema"],
  ["adapterTemplate", "adapterSchema"],
  ["instanceTemplate", "instanceSchema"],
  ["selftestTemplate", "selftestSchema"],
];

function absolute(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactSet(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length &&
    actual.every((item) => expected.includes(item)) && expected.every((item) => actual.includes(item));
}

function exactOrdered(actual, expected) {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function errorText(ajv, validator) {
  return validator?.errors ? ajv.errorsText(validator.errors, { separator: " | " }) : null;
}

function check(checks, name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail });
}

async function readBytes(relativePath) {
  const filePath = absolute(relativePath);
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`not a plain file: ${relativePath}`);
  const bytes = await readFile(filePath);
  return { path: relativePath, bytes, text: bytes.toString("utf8"), sha256: sha256(bytes), bytesLength: bytes.length };
}

async function readJson(relativePath) {
  const file = await readBytes(relativePath);
  return { ...file, document: JSON.parse(file.text) };
}

function makeAjv() {
  return new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    allowUnionTypes: true,
  });
}

function schemaObjectClosureIssues(schema, cursor = "$", issues = []) {
  if (!schema || typeof schema !== "object") return issues;
  if (schema.type === "object" && schema.additionalProperties !== false) issues.push(cursor);
  for (const [key, value] of Object.entries(schema.properties ?? {})) schemaObjectClosureIssues(value, `${cursor}.properties.${key}`, issues);
  for (const [key, value] of Object.entries(schema.$defs ?? {})) schemaObjectClosureIssues(value, `${cursor}.$defs.${key}`, issues);
  for (const key of ["items", "if", "then", "else", "not"]) schemaObjectClosureIssues(schema[key], `${cursor}.${key}`, issues);
  for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    for (const [index, value] of (schema[key] ?? []).entries()) schemaObjectClosureIssues(value, `${cursor}.${key}[${index}]`, issues);
  }
  return issues;
}

export async function loadFixtureContext() {
  const packageFiles = {};
  for (const [key, relativePath] of Object.entries(PACKAGE_DOCUMENTS)) packageFiles[key] = await readJson(relativePath);

  const ownerFiles = {};
  for (const [key, relativePath] of Object.entries(OWNER_PATHS)) {
    if (key === "softwareAnchor" || key === "softwareSync") ownerFiles[key] = await readBytes(relativePath);
    else ownerFiles[key] = await readJson(relativePath);
  }

  const implementationFiles = {};
  for (const relativePath of EXPECTED_IMPLEMENTATION_PATHS) implementationFiles[relativePath] = await readBytes(relativePath);

  const ajv = makeAjv();
  const validators = {};
  const schemaCompile = {};
  for (const [documentKey, schemaKey] of PACKAGE_SCHEMA_KEYS) {
    try {
      validators[documentKey] = ajv.compile(packageFiles[schemaKey].document);
      schemaCompile[documentKey] = { passed: true, detail: null };
    } catch (error) {
      schemaCompile[documentKey] = { passed: false, detail: error?.message ?? String(error) };
    }
  }
  return { packageFiles, ownerFiles, implementationFiles, ajv, validators, schemaCompile };
}

function ownerSpec(pathValue, identity) {
  return { path: pathValue, identity };
}

function actualOwnerIdentity(context, key) {
  const document = context.ownerFiles[key].document;
  switch (key) {
    case "methodCatalog": return document.catalogId;
    case "registrationPlan": return document.planId;
    case "instrumentRegistrySchema": return document.$id;
    case "labRegistryTemplate": return "EVT0-LAB-REGISTRY-TEMPLATE";
    case "labSessionTemplate": return "EVT0-LAB-SESSION-TEMPLATE-V1";
    case "testResultSchema": return document.$id;
    case "evidenceCaptureProfile": return document.profileId;
    case "releaseGateCatalog": return document.catalogId;
    case "targetBinding": return document.profile;
    default: return null;
  }
}

function expectedOwnerRefs() {
  return {
    targetBindingRef: ownerSpec(OWNER_PATHS.targetBinding, "hardware-system-target-binding-v1"),
    methodCatalog: ownerSpec(OWNER_PATHS.methodCatalog, "EVT0-LAB-METHODS-V1"),
    registrationPlan: ownerSpec(OWNER_PATHS.registrationPlan, "EVT0-LAB-REGISTRATION-CAPTURE-V1"),
    instrumentRegistrySchema: ownerSpec(OWNER_PATHS.instrumentRegistrySchema, "https://yimi.local/schemas/evt0-lab-instrument-registry-v1.json"),
    labSessionTemplate: ownerSpec(OWNER_PATHS.labSessionTemplate, "EVT0-LAB-SESSION-TEMPLATE-V1"),
    testResultSchema: ownerSpec(OWNER_PATHS.testResultSchema, "https://yimi.local/schemas/test-result-v1.json"),
    evidenceCaptureProfile: ownerSpec(OWNER_PATHS.evidenceCaptureProfile, "HW-EVIDENCE-CAPTURE-ADAPTER-V1"),
    releaseGateCatalog: ownerSpec(OWNER_PATHS.releaseGateCatalog, "rgc:sha256:0fcab5f025687078ebe3f834721164602c6c756d37ef02f5b3943ddd782e5d7b"),
  };
}

function refMatches(ref, expected, actualFile, actualIdentity) {
  return ref?.path === expected.path && ref?.sha256 === actualFile.sha256 && ref?.identity === actualIdentity && actualIdentity === expected.identity;
}

function refWithRevisionMatches(ref, expectedPath, actualFile, expectedIdentity, expectedRevision) {
  return ref?.path === expectedPath && ref?.sha256 === actualFile.sha256 && ref?.identity === expectedIdentity && ref?.revision === expectedRevision;
}

function profileRefMatches(ref, expected) {
  return ref?.path === expected.path && ref?.sha256 === expected.sha256 && ref?.profileId === expected.profileId && ref?.revision === expected.revision;
}

function allValuesNull(value) {
  return value && Object.values(value).every((item) => item === null);
}

function allFalse(value) {
  return value && Object.values(value).every((item) => item === false);
}

function noForbiddenTopLevelFields(document) {
  const forbidden = [
    "interfaceBindings",
    "methods",
    "requiredInstruments",
    "instruments",
    "assets",
    "methodResults",
    "rawArtifacts",
    "samples",
    "gates",
    "evidenceReceipts",
    "releaseDecision",
  ];
  return forbidden.filter((field) => Object.prototype.hasOwnProperty.call(document, field));
}

function targetDependentPending(adapter) {
  const target = adapter.targetDependent;
  return target?.state === "PENDING" && target.voltageV === null && target.currentA === null &&
    Array.isArray(target.pinMappings) && target.pinMappings.length === 0 &&
    Array.isArray(target.connectorMappings) && target.connectorMappings.length === 0 &&
    Array.isArray(target.pogoMappings) && target.pogoMappings.length === 0 &&
    target.mechanical?.lengthMm === null && target.mechanical?.widthMm === null &&
    target.mechanical?.heightMm === null && target.mechanical?.workingDistanceMm === null &&
    target.mechanical?.angleDeg === null && Array.isArray(target.mechanical?.mountingDatums) &&
    target.mechanical.mountingDatums.length === 0;
}

function topologyHashInput(topology) {
  const { topologyId: _topologyId, ...hashInput } = topology;
  return hashInput;
}

function expectedOwnerFile(context, key) {
  return context.ownerFiles[key];
}

export function evaluateFixtureDocuments(context, documents = null, options = {}) {
  const docs = documents ?? Object.fromEntries(Object.entries(context.packageFiles).map(([key, value]) => [key, value.document]));
  const checks = [];
  const { ajv, validators } = context;
  const profile = docs.profile;
  const adapter = docs.adapterTemplate;
  const instance = docs.instanceTemplate;
  const selftest = docs.selftestTemplate;
  const topology = context.ownerFiles.topology.document;
  const targetBinding = context.ownerFiles.targetBinding.document;
  const methodCatalog = context.ownerFiles.methodCatalog.document;
  const registrationPlan = context.ownerFiles.registrationPlan.document;
  const instrumentRegistrySchema = context.ownerFiles.instrumentRegistrySchema.document;
  const releaseCatalog = context.ownerFiles.releaseGateCatalog.document;

  for (const [documentKey, schemaKey] of PACKAGE_SCHEMA_KEYS) {
    const compile = context.schemaCompile[documentKey];
    check(checks, `${documentKey} schema compiles`, compile?.passed === true, compile?.detail ?? null);
    if (compile?.passed) {
      const valid = validators[documentKey](docs[documentKey]);
      check(checks, `${documentKey} schema validates`, valid, errorText(ajv, validators[documentKey]));
    }
  }

  if (options.checkFormatting !== false) {
    for (const [key, file] of Object.entries(context.packageFiles)) {
      const canonical = `${JSON.stringify(file.document, null, 2)}\n`;
      check(checks, `${key} deterministic JSON formatting`, file.text === canonical, { expectedBytes: Buffer.byteLength(canonical), actualBytes: file.bytesLength });
    }
  }

  for (const [key, schemaKey] of [["profileSchema", "profileSchema"], ["adapterSchema", "adapterSchema"], ["instanceSchema", "instanceSchema"], ["selftestSchema", "selftestSchema"]]) {
    const closureIssues = schemaObjectClosureIssues(context.packageFiles[schemaKey].document);
    check(checks, `${key} is closed at every object node`, closureIssues.length === 0, closureIssues);
  }

  const topologyFileHash = context.ownerFiles.topology.sha256;
  const topologyHash = canonicalSha256(topologyHashInput(topology)).sha256;
  const topologyIdCorrect = topology.topologyId === `hwt:sha256:${topologyHash}`;
  check(checks, "topology identity uses exact path/hash/id", profile?.topologyRef?.path === OWNER_PATHS.topology && profile?.topologyRef?.sha256 === topologyHash && profile?.topologyRef?.topologyId === topology.topologyId && topologyIdCorrect, {
    profileTopologyRef: profile?.topologyRef,
    canonicalHash: topologyHash,
    fileSha256: topologyFileHash,
    topologyIdCorrect,
  });
  check(checks, "target-binding topology identity matches topology owner", targetBinding.topologyRef?.path === OWNER_PATHS.topology && targetBinding.topologyRef?.sha256 === topologyHash, targetBinding.topologyRef);
  check(checks, "profile target-binding identity is exact", refMatches(profile?.targetBindingRef, expectedOwnerRefs().targetBindingRef, expectedOwnerFile(context, "targetBinding"), actualOwnerIdentity(context, "targetBinding")), profile?.targetBindingRef);

  const ownerRefs = expectedOwnerRefs();
  for (const field of ["methodCatalog", "registrationPlan", "instrumentRegistrySchema", "labSessionTemplate", "testResultSchema", "evidenceCaptureProfile", "releaseGateCatalog"]) {
    const ownerFileKey = field === "instrumentRegistrySchema" ? "instrumentRegistrySchema" : field;
    const file = expectedOwnerFile(context, ownerFileKey);
    const actualIdentity = actualOwnerIdentity(context, ownerFileKey);
    check(checks, `profile owner ref ${field} exact path/hash/identity`, refMatches(profile?.ownerRefs?.[field], ownerRefs[field], file, actualIdentity), profile?.ownerRefs?.[field]);
  }

  check(checks, "exact eight capability IDs", exactOrdered(profile?.capabilities?.map((capability) => capability.id) ?? [], EXPECTED_CAPABILITY_IDS), profile?.capabilities?.map((capability) => capability.id));
  const capabilityById = new Map((profile?.capabilities ?? []).map((capability) => [capability.id, capability]));
  for (const expected of EXPECTED_CAPABILITIES) {
    const actual = capabilityById.get(expected.id);
    check(checks, `${expected.id} exact role/status/ref mapping`, Boolean(actual) &&
      actual.role === expected.role && actual.status === expected.status &&
      exactOrdered(actual.interfaceRefs, expected.interfaceRefs) &&
      exactOrdered(actual.methodRefs, expected.methodRefs) &&
      exactOrdered(actual.instrumentSlotRefs, expected.instrumentSlotRefs) &&
      exactOrdered(actual.assetKindRefs, expected.assetKindRefs) &&
      exactOrdered(actual.releaseGateRefs, expected.releaseGateRefs) &&
      deepEqual(actual.coverage, { ...expected.coverage, notes: actual.coverage?.notes }), {
      expected,
      actual,
    });
    if (actual) {
      check(checks, `${expected.id} coverage role follows capability role`, actual.coverage?.interfaceRole === actual.role, actual.coverage);
    }
  }

  const topologyInterfaceIds = topology.interfaces.map((item) => item.interfaceId);
  const topologyInterfaceSet = new Set(topologyInterfaceIds);
  check(checks, "topology has exact 18 stable interface IDs", exactOrdered(topologyInterfaceIds, EXPECTED_INTERFACE_IDS), topologyInterfaceIds);
  const operationalCapabilities = (profile?.capabilities ?? []).filter((capability) => capability.role === "OPERATIONAL");
  const operationalRefs = operationalCapabilities.flatMap((capability) => capability.interfaceRefs ?? []);
  const operationalDuplicates = operationalRefs.filter((id, index) => operationalRefs.indexOf(id) !== index);
  const operationalUnknown = operationalRefs.filter((id) => !topologyInterfaceSet.has(id));
  const operationalMissing = topologyInterfaceIds.filter((id) => !operationalRefs.includes(id));
  check(checks, "seven operational families cover exactly 18 interfaces", operationalCapabilities.length === 7 && operationalRefs.length === 18 && operationalDuplicates.length === 0 && operationalUnknown.length === 0 && operationalMissing.length === 0 && exactSet(operationalRefs, topologyInterfaceIds), { operationalDuplicates, operationalUnknown, operationalMissing, operationalRefs });
  const crossCutting = (profile?.capabilities ?? []).filter((capability) => capability.role === "CROSS_CUTTING");
  check(checks, "evidence anchor is the only cross-cutting capability", crossCutting.length === 1 && exactOrdered(crossCutting[0]?.interfaceRefs ?? [], ["IF-DIAGNOSTIC"]), crossCutting.map((item) => item.id));

  const methodIds = new Set((methodCatalog.methods ?? []).map((method) => method.id));
  const slotIds = new Set((registrationPlan.slots ?? []).map((slot) => slot.id));
  const planAssetKinds = sortedUnique((registrationPlan.slots ?? []).flatMap((slot) => (slot.assets ?? []).map((asset) => asset.assetKind)));
  const schemaAssetKinds = instrumentRegistrySchema.$defs?.asset?.properties?.assetKind?.enum ?? [];
  const gateIds = new Set((releaseCatalog.gates ?? []).map((gate) => gate.gateId));
  check(checks, "authoritative owner method catalog is non-empty", methodIds.size === 9, [...methodIds]);
  check(checks, "authoritative owner lab registry is six slots/seven asset kinds", slotIds.size === 6 && planAssetKinds.length === 7 && exactSet(planAssetKinds, schemaAssetKinds), { slots: [...slotIds], assetKinds: planAssetKinds });
  check(checks, "authoritative ReleaseGate catalog is 34 gates", gateIds.size === 34, gateIds.size);

  for (const capability of profile?.capabilities ?? []) {
    const unknownMethods = (capability.methodRefs ?? []).filter((id) => !methodIds.has(id));
    const unknownSlots = (capability.instrumentSlotRefs ?? []).filter((id) => !slotIds.has(id));
    const unknownAssets = (capability.assetKindRefs ?? []).filter((id) => !planAssetKinds.includes(id) || !schemaAssetKinds.includes(id));
    const unknownGates = (capability.releaseGateRefs ?? []).filter((id) => !gateIds.has(id));
    check(checks, `${capability.id} refs exist in method/slot/asset/gate owners`, unknownMethods.length === 0 && unknownSlots.length === 0 && unknownAssets.length === 0 && unknownGates.length === 0, { unknownMethods, unknownSlots, unknownAssets, unknownGates });
    const requiredSlots = sortedUnique((capability.methodRefs ?? []).flatMap((methodId) => methodCatalog.methods.find((method) => method.id === methodId)?.requiredInstruments ?? []));
    const inheritedByAnchor = capability.methodRefs.includes("LAB-SETUP-001") && capability.id !== "CAP-FIXTURE-EVIDENCE-ANCHOR";
    const missingRequiredSlots = requiredSlots.filter((slot) => !capability.instrumentSlotRefs.includes(slot));
    const inheritedSlotsValid = inheritedByAnchor && missingRequiredSlots.every((slot) => slotIds.has(slot) && EXPECTED_CAPABILITIES[0].instrumentSlotRefs.includes(slot));
    check(checks, `${capability.id} method-required instrument slots are declared or explicitly inherited by evidence anchor`, missingRequiredSlots.length === 0 || inheritedSlotsValid, { requiredSlots, declared: capability.instrumentSlotRefs, missingRequiredSlots, inheritedByAnchor });
    const derivedAssets = sortedUnique((capability.instrumentSlotRefs ?? []).flatMap((slotId) => registrationPlan.slots.find((slot) => slot.id === slotId)?.assets?.map((asset) => asset.assetKind) ?? []));
    check(checks, `${capability.id} asset-kind refs match selected lab slots`, exactOrdered(sortedUnique(capability.assetKindRefs ?? []), derivedAssets), { derivedAssets, declared: capability.assetKindRefs });
  }

  const gapIds = profile?.coverageGaps?.map((gap) => gap.id) ?? [];
  check(checks, "coverage gaps are explicit and exact", exactOrdered(gapIds, EXPECTED_GAPS.map((gap) => gap.id)), gapIds);
  const gapById = new Map((profile?.coverageGaps ?? []).map((gap) => [gap.id, gap]));
  for (const expected of EXPECTED_GAPS) {
    const actual = gapById.get(expected.id);
    check(checks, `${expected.id} preserves explicit coverage gap`, Boolean(actual) &&
      exactOrdered(actual.interfaceRefs, expected.interfaceRefs) && actual.state === expected.state &&
      exactOrdered(actual.methodRefs, expected.methodRefs) && exactOrdered(actual.instrumentSlotRefs, expected.instrumentSlotRefs) &&
      actual.reason === expected.reason && actual.nextOwner === expected.nextOwner, { expected, actual });
    if (actual) {
      const gapMethods = actual.methodRefs.filter((id) => !methodIds.has(id));
      const gapSlots = actual.instrumentSlotRefs.filter((id) => !slotIds.has(id));
      const gapInterfaces = actual.interfaceRefs.filter((id) => !topologyInterfaceSet.has(id));
      check(checks, `${expected.id} references existing interface/method/slot owners`, gapMethods.length === 0 && gapSlots.length === 0 && gapInterfaces.length === 0, { gapMethods, gapSlots, gapInterfaces });
    }
  }

  check(checks, "profile effects are all NONE and synthetic evidence is separated", deepEqual(profile?.policies, {
    effects: { targetBinding: "NONE", adapter: "NONE", physicalFixture: "NONE", releaseGate: "NONE", promotion: "NONE" },
    syntheticEvidence: "NEVER_REPRESENTED_AS_PHYSICAL",
    targetDependentFields: "PENDING_OR_NULL_ONLY_BEFORE_TARGET_LOCK",
    ownership: "REFER_EXISTING_OWNERS_DO_NOT_DUPLICATE_FIELDS",
  }), profile?.policies);

  const exactProfileRef = { path: `${PACKAGE_ROOT}/profile.json`, sha256: context.packageFiles.profile.sha256, profileId: profile.profileId, revision: profile.revision };
  const exactTopologyRef = { path: OWNER_PATHS.topology, sha256: topologyHash, topologyId: topology.topologyId };
  const exactTargetBindingRef = { path: OWNER_PATHS.targetBinding, sha256: context.ownerFiles.targetBinding.sha256, identity: "hardware-system-target-binding-v1" };
  check(checks, "target binding remains UNRESOLVED with all 18 interfaces pending", targetBinding.targetIdentity?.state === "UNRESOLVED" && targetBinding.interfaceBindings?.length === 18 && targetBinding.interfaceBindings.every((item) => item.state === "TARGET_EVIDENCE_PENDING") && exactSet(targetBinding.interfaceBindings.map((item) => item.interfaceId), topologyInterfaceIds), { targetState: targetBinding.targetIdentity?.state, bindingCount: targetBinding.interfaceBindings?.length });
  check(checks, "adapter template references exact profile/topology/target-binding identities", profileRefMatches(adapter?.profileRef, exactProfileRef) && deepEqual(adapter?.profileRef, exactProfileRef) && deepEqual(adapter?.topologyRef, exactTopologyRef) && deepEqual(adapter?.targetBindingRef, exactTargetBindingRef), { profileRef: adapter?.profileRef, topologyRef: adapter?.topologyRef, targetBindingRef: adapter?.targetBindingRef });
  check(checks, "adapter template stays unresolved and full five-tuple is null", adapter?.status === "PENDING_TARGET_EVIDENCE" && adapter?.targetIdentity?.state === "UNRESOLVED" && adapter?.targetIdentity?.evidenceState === "TARGET_EVIDENCE_PENDING" && allValuesNull(adapter?.targetIdentity?.fullFiveTuple) && Array.isArray(adapter?.targetIdentity?.evidenceRefs) && adapter.targetIdentity.evidenceRefs.length === 0, adapter?.targetIdentity);
  check(checks, "adapter template has no pre-target voltage/current/pin/connector/pogo/mechanical values", targetDependentPending(adapter), adapter?.targetDependent);
  check(checks, "adapter template cannot claim physical readiness or promotion", allFalse(adapter?.claims) && deepEqual(adapter?.effects, { targetBinding: "NONE", physicalEvidence: "NONE", releaseGate: "NONE", promotion: "NONE" }), { claims: adapter?.claims, effects: adapter?.effects });
  check(checks, "adapter capability refs are exact and complete", exactOrdered(adapter?.capabilityRefs ?? [], EXPECTED_CAPABILITY_IDS), adapter?.capabilityRefs);

  const exactAdapterRef = { path: `${PACKAGE_ROOT}/adapter.template.json`, sha256: context.packageFiles.adapterTemplate.sha256, adapterId: adapter.adapterId, revision: adapter.revision };
  const exactLabTemplateRef = { path: OWNER_PATHS.labRegistryTemplate, sha256: context.ownerFiles.labRegistryTemplate.sha256, registryId: "EVT0-LAB-REGISTRY-TEMPLATE", status: "TEMPLATE" };
  check(checks, "instance template keeps profile, adapter and lab registry as separate refs", deepEqual(instance?.profileRef, exactProfileRef) && deepEqual(instance?.adapterRef, exactAdapterRef) && deepEqual(instance?.labRegistryRef, exactLabTemplateRef), { profileRef: instance?.profileRef, adapterRef: instance?.adapterRef, labRegistryRef: instance?.labRegistryRef });
  check(checks, "instance template makes no physical fixture/serial/calibration/qualification claim", instance?.status === "TEMPLATE" && instance?.physicalIdentity?.registrationState === "NOT_REGISTERED" && instance.physicalIdentity.serial === null && instance.physicalIdentity.localAssetTag === null && instance.physicalIdentity.identityArtifactRefs.length === 0 && instance.physicalIdentity.physicalEvidenceState === "PENDING" && instance.calibration?.state === "PENDING" && instance.calibration.certificateArtifactRefs.length === 0 && instance.calibration.referenceArtifactRefs.length === 0 && instance.calibration.result === "PENDING" && instance.qualification?.state === "NOT_CLAIMED" && instance.qualification.physicalReady === false && allFalse(instance.claims), { physicalIdentity: instance?.physicalIdentity, calibration: instance?.calibration, qualification: instance?.qualification, claims: instance?.claims });
  check(checks, "instance effects are all NONE", deepEqual(instance?.effects, { targetBinding: "NONE", adapter: "NONE", physicalEvidence: "NONE", releaseGate: "NONE", promotion: "NONE" }), instance?.effects);

  check(checks, "selftest references exact profile/adapter/instance identities", deepEqual(selftest?.profileRef, exactProfileRef) && deepEqual(selftest?.adapterRef, exactAdapterRef) && deepEqual(selftest?.instanceRef, { path: `${PACKAGE_ROOT}/instance.template.json`, sha256: context.packageFiles.instanceTemplate.sha256, instanceId: instance.instanceId, revision: instance.revision }), { profileRef: selftest?.profileRef, adapterRef: selftest?.adapterRef, instanceRef: selftest?.instanceRef });
  const selftestOwnerKeys = ["methodCatalog", "instrumentRegistrySchema", "labSessionTemplate", "testResultSchema", "evidenceCaptureProfile", "releaseGateCatalog"];
  for (const field of selftestOwnerKeys) {
    const expected = profile?.ownerRefs?.[field];
    check(checks, `selftest owner ref ${field} reuses owner path/hash without duplication`, deepEqual(selftest?.ownerRefs?.[field], expected), { expected, actual: selftest?.ownerRefs?.[field] });
  }
  const expectedSelftestCheckIds = ["CHECK-PROFILE-IDENTITY", "CHECK-ADAPTER-UNRESOLVED", "CHECK-INSTANCE-NOT-PHYSICAL", "CHECK-LAB-OWNER-REFERENCES", "CHECK-SESSION-TESTRESULT-EVIDENCE-SEAM", "CHECK-NO-RELEASEGATE-PROMOTION"];
  check(checks, "selftest is fixture-only and synthetic evidence is not physical", selftest?.status === "TEMPLATE" && selftest.fixtureOnly === true && selftest.evidenceState === "SYNTHETIC_FIXTURE_ONLY" && selftest.evidence?.physicalEvidence === false && selftest.evidence.syntheticFixtureOnly === true && selftest.evidence.rawArtifactRefs.length === 0 && exactOrdered(selftest.checks.map((item) => item.id), expectedSelftestCheckIds) && selftest.checks.every((item) => item.evidenceKind === "SYNTHETIC_FIXTURE_ONLY" && item.promotes === false), { evidence: selftest?.evidence, checks: selftest?.checks });
  check(checks, "selftest cannot close ReleaseGates or promote target/board state", deepEqual(selftest?.promotionBoundary, { targetBindingEffect: "NONE", releaseGateEffect: "NONE", boardStateEffect: "NONE", physicalReadinessEffect: "NONE", canCloseReleaseGate: false, canPromoteBoardState: false }) && allFalse(selftest?.claims), { promotionBoundary: selftest?.promotionBoundary, claims: selftest?.claims });

  for (const [key, document] of [["adapter template", adapter], ["instance template", instance], ["selftest template", selftest]]) {
    const forbidden = noForbiddenTopLevelFields(document);
    check(checks, `${key} does not duplicate existing owner payload fields`, forbidden.length === 0, forbidden);
  }

  const implementation = profile?.implementation ?? [];
  check(checks, "implementation identity path set is exact", exactOrdered(implementation.map((item) => item.path), EXPECTED_IMPLEMENTATION_PATHS), implementation.map((item) => item.path));
  for (const item of implementation) {
    const actual = context.implementationFiles[item.path];
    check(checks, `implementation identity ${item.path} matches bytes/hash/revision`, Boolean(actual) && item.revision === "1.0.0" && item.bytes === actual.bytesLength && item.sha256 === actual.sha256, { declared: item, actual: actual ? { bytes: actual.bytesLength, sha256: actual.sha256 } : null });
  }

  const softwareReport = context.ownerFiles.softwareReport.document;
  const softwareFormalReport = context.ownerFiles.softwareFormalReport.document;
  const softwareBoundaries = softwareReport.boundaries ?? {};
  const softwareReadOnly = softwareBoundaries.hardwareImpact === "NONE" && softwareBoundaries.boardTarget === "UNRESOLVED" && softwareBoundaries.sessionCoreModified === false && softwareBoundaries.familyWorkspaceModified === false && softwareBoundaries.productionProviderQualified === false && softwareBoundaries.offlineReady === false;
  check(checks, "software read-only input is current and has accurate hardwareImpact", softwareReport.checksPassed === 41 && softwareReport.checks?.length === 41 && softwareReadOnly, { report: context.ownerFiles.softwareReport.path, checksPassed: softwareReport.checksPassed, boundaries: softwareBoundaries });
  const softwareAnchorText = context.ownerFiles.softwareAnchor.text;
  const softwareAnchorCurrent = softwareAnchorText.includes("- Status:") && softwareAnchorText.includes("Current step:") && softwareAnchorText.includes("Next exact step:") && softwareAnchorText.includes("BOARD_TARGET=UNRESOLVED") && softwareAnchorText.includes("softwareImpact") === false;
  const formalReportCurrent = softwareFormalReport.checksPassed === softwareFormalReport.checks?.length && softwareFormalReport.checksPassed > 0;
  check(checks, "software owner anchor and formal reports are current without hardware changes", softwareAnchorCurrent && formalReportCurrent && softwareReadOnly, {
    anchor: { path: context.ownerFiles.softwareAnchor.path, sha256: context.ownerFiles.softwareAnchor.sha256 },
    formalReport: { path: context.ownerFiles.softwareFormalReport.path, sha256: context.ownerFiles.softwareFormalReport.sha256, checksPassed: softwareFormalReport.checksPassed },
    hardwareImpactReport: { path: context.ownerFiles.softwareReport.path, sha256: context.ownerFiles.softwareReport.sha256, hardwareImpact: softwareBoundaries.hardwareImpact },
  });
  const syncText = context.ownerFiles.softwareSync.text;
  check(checks, "hardware/software sync records software hardwareImpact=NONE", syncText.includes("hardwareImpact=NONE") && syncText.includes("BOARD_TARGET=UNRESOLVED"), null);

  const passed = checks.every((item) => item.passed);
  return {
    checks,
    passed,
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length,
    },
  };
}

export async function runValidation({ writeReport = true } = {}) {
  const context = await loadFixtureContext();
  const result = evaluateFixtureDocuments(context);
  const report = {
    schemaVersion: 1,
    reportKind: "hardware-test-fixture-validation-v1",
    profile: {
      profileId: context.packageFiles.profile.document.profileId,
      revision: context.packageFiles.profile.document.revision,
      path: context.packageFiles.profile.path,
      bytes: context.packageFiles.profile.bytesLength,
      sha256: context.packageFiles.profile.sha256,
    },
    topology: {
      path: context.ownerFiles.topology.path,
      bytes: context.ownerFiles.topology.bytesLength,
      sha256: context.ownerFiles.topology.sha256,
      canonicalSha256: canonicalSha256(topologyHashInput(context.ownerFiles.topology.document)).sha256,
      topologyId: context.ownerFiles.topology.document.topologyId,
      interfaceCount: context.ownerFiles.topology.document.interfaces?.length ?? 0,
    },
    implementation: context.packageFiles.profile.document.implementation,
    softwareInput: {
      path: context.ownerFiles.softwareReport.path,
      sha256: context.ownerFiles.softwareReport.sha256,
      checks: context.ownerFiles.softwareReport.document.checks?.length ?? 0,
      hardwareImpact: context.ownerFiles.softwareReport.document.boundaries?.hardwareImpact ?? null,
      boardTarget: context.ownerFiles.softwareReport.document.boundaries?.boardTarget ?? null,
      formalReportPath: context.ownerFiles.softwareFormalReport.path,
      formalReportSha256: context.ownerFiles.softwareFormalReport.sha256,
      formalReportChecks: context.ownerFiles.softwareFormalReport.document.checks?.length ?? 0,
      anchorPath: context.ownerFiles.softwareAnchor.path,
      anchorSha256: context.ownerFiles.softwareAnchor.sha256,
    },
    coverage: {
      capabilityCount: context.packageFiles.profile.document.capabilities?.length ?? 0,
      operationalInterfaceCount: context.packageFiles.profile.document.capabilities?.filter((item) => item.role === "OPERATIONAL").flatMap((item) => item.interfaceRefs ?? []).length ?? 0,
      stableInterfaceCount: context.ownerFiles.topology.document.interfaces?.length ?? 0,
      gapCount: context.packageFiles.profile.document.coverageGaps?.length ?? 0,
    },
    checks: result.checks,
    summary: result.summary,
    passed: result.passed,
  };
  if (writeReport) {
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return { ...result, report };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const thisPath = path.resolve(fileURLToPath(import.meta.url));
if (invokedPath === thisPath) {
  try {
    const result = await runValidation();
    console.log(`Hardware test fixture validation: ${result.passed ? "PASS" : "FAIL"} (${result.summary.passed}/${result.summary.total})`);
    console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
    if (!result.passed) {
      for (const item of result.checks.filter((entry) => !entry.passed)) console.error(`- ${item.name}: ${JSON.stringify(item.detail)}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}
