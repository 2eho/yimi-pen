import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalSha256 } from "./snapshot-jcs.mjs";
import { EXPECTED_CAPABILITY_IDS, evaluateFixtureDocuments, loadFixtureContext } from "./validate-hardware-test-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = "hardware/evt0/method-gap-evidence-v1";
const REPORT_PATH = path.join(ROOT, "build", "hardware-method-gap-evidence-validation.json");
const SCHEMA_PATH = `${PACKAGE_ROOT}/schema.json`;
const MANIFEST_PATH = `${PACKAGE_ROOT}/manifest.json`;
const README_PATH = `${PACKAGE_ROOT}/README.md`;

const OWNER_PATHS = {
  methodCatalog: "hardware/evt0/lab-v1/method-catalog.json",
  registrationPlan: "hardware/evt0/lab-v1/registration-capture-plan.json",
  topology: "hardware/evt0/hardware-system-v1/topology.json",
  targetBinding: "hardware/evt0/hardware-system-v1/target-binding.json",
  softwareAnchor: "docs/codex/tasks/system-product-rd/active-task.md",
  softwareDesktopAnchor: "docs/codex/tasks/desktop-authoring-ui-adapter/active-task.md",
  newestSoftwareReport: "build/companion-authoring-task-recovery-validation/report.json",
  explicitHardwareImpactReport: "build/companion-tts-source-adapter-validation/report.json",
};

const EXPECTED_GAP_IDS = [
  "GAP-IF-USB-DATA-METHOD",
  "GAP-IF-STORAGE-POWER-LOSS-METHOD",
  "GAP-CONTROL-STATUS-METHOD",
];

const EXPECTED_FIXTURE_GAP_IDS = [
  "GAP-IF-USB-DATA-METHOD",
  "GAP-IF-STORAGE-POWER-LOSS-METHOD",
  "GAP-IF-CONTROL-STATUS-METHOD",
];

const EXPECTED_INTERFACES = [
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

const EXPECTED_IMPLEMENTATION_PATHS = [
  SCHEMA_PATH,
  README_PATH,
  "scripts/validate-hardware-method-gap-evidence.mjs",
  "scripts/test-hardware-method-gap-evidence.mjs",
];

const EXPECTED_AUDIT_SNAPSHOT_FILES = [
  ["hardware/evt0/test-fixture-v1/profile.schema.json", "accepted-fixture-v1", 9810, "876f00b7285e4be087df59e0cfee073fe50c82844f328f3acba4a3644a021b69"],
  ["hardware/evt0/test-fixture-v1/profile.json", "accepted-fixture-v1", 14807, "8760bf98a5dedc2ad0d295b5ebfe1ae2d815db8cf5d88172bc120fda58f886bb"],
  ["hardware/evt0/test-fixture-v1/adapter.schema.json", "accepted-fixture-v1", 8802, "743d96e8698eb4070ca0ec85784c613f10097e8f76ad02a0435c35e4771e6375"],
  ["hardware/evt0/test-fixture-v1/adapter.template.json", "accepted-fixture-v1", 2359, "e657b60d5373f14262ed506d7bca02d3f6f32eddf3fe3d2d22aba72dfb553e52"],
  ["hardware/evt0/test-fixture-v1/instance.schema.json", "accepted-fixture-v1", 7212, "8320e4f94450119241e6824936451f6730d40f54c007ed63b8d3a881e3114b46"],
  ["hardware/evt0/test-fixture-v1/instance.template.json", "accepted-fixture-v1", 1892, "0f37398f78e6f524ffb80785a6748aacb30e862310df48d33e06f672d5d62f3c"],
  ["hardware/evt0/test-fixture-v1/selftest.schema.json", "accepted-fixture-v1", 7560, "9087c67a4dcc8db30360a59be7cca99e03e39b7ca73bd4d20256ca27fad0e1f1"],
  ["hardware/evt0/test-fixture-v1/selftest.template.json", "accepted-fixture-v1", 4219, "853174fbc97301361fa40b5a8b2f57378832f860d2ce24bf1d7ed9e2fe720aea"],
  ["hardware/evt0/test-fixture-v1/README.md", "accepted-fixture-v1", 4789, "ed131559769deffa3aa1c89825791d3196c1037dd631d3045c0aa2b8805cdefc"],
];

const EXPECTED_AUDIT_OWNER_SNAPSHOT_FILES = [
  ["hardware/evt0/lab-v1/method-catalog.json", "stable-lab-method-owner", 8717, "dbd51a9ff845070b6432015f6a68d6577121871c938afb0705290c21a9343aba"],
  ["hardware/evt0/lab-v1/registration-capture-plan.json", "stable-lab-registration-owner", 3645, "6358840bf2bfb8280e6a7df593b9c2c83617c6e9593ce659cff3211f7bbb05de"],
  ["hardware/evt0/hardware-system-v1/topology.json", "stable-topology-owner", 15420, "96431fecb220882b16745082d803e9349675802d234eb5ddf75fa197dd5f63d5"],
  ["hardware/evt0/hardware-system-v1/target-binding.json", "stable-target-binding-owner", 10437, "ccb6efefadc6b438646c69160bc882229465b3639c130aa044a08330de35e202"],
  ["hardware/evt0/test-result-v1/schema.json", "stable-test-result-owner", 14442, "1b05c0d36be60133976785ae97b2666307852c9bc7129f1e66b49a77b793d6c4"],
  ["hardware/evt0/release-gates-v1/catalog.json", "stable-release-gate-owner", 31010, "a57777a0e9cb6487de00c91c8c45317eeb700ebcc279b84fcce9d9b9e5d31561"],
  ["hardware/evt0/evidence-capture-v1/profile.json", "stable-evidence-capture-owner", 2699, "b3fc802d6b94e830f7db6b1776120fb76bce5dcfc511b37acfc757c37d66a0f1"],
];

const EXPECTED_PROTECTED_FILES = [...EXPECTED_AUDIT_SNAPSHOT_FILES, ...EXPECTED_AUDIT_OWNER_SNAPSHOT_FILES];

const EXPECTED_METHOD_IDS = [
  "LAB-SETUP-001",
  "MECH-INTAKE-001",
  "OID-OPTICS-INTAKE-001",
  "USB-POWER-INTAKE-001",
  "AUD-REFERENCE-001",
  "PWR-BOARD-BOOT-001",
  "OID-FUNCTION-001",
  "TARGET-ACOUSTIC-001",
  "TARGET-BATTERY-001",
];

const EXPECTED_SLOT_IDS = ["PSU-01", "DMM-01", "MECH-01", "MACRO-01", "USBPWR-01", "SPL-01"];
const EXPECTED_ASSET_KINDS = ["BENCH_SUPPLY", "MULTIMETER", "CALIPER", "SCALE", "MACRO_CAMERA", "USB_C_POWER_METER", "SOUND_LEVEL_METER"];
const EXPECTED_RELEASE_GATE_IDS = [
  "RG-BOARD-SUPPLY-VERIFIED",
  "RG-BOARD-TARGET-FROZEN",
  "RG-C-RUST-DIFFERENTIAL-PASSED",
  "RG-DEVICELINK-PHYSICAL-TRANSPORT-PASSED",
  "RG-HOST-ARCHITECTURE-CONFORMANCE-PASSED",
  "RG-HOST-CONFIRMATION-TRUST-CONTRACT-PASSED",
  "RG-HOST-DEVICELINK-TRANSACTION-PASSED",
  "RG-HOST-EVT0-INTAKE-CONTRACT-PASSED",
  "RG-HOST-EXECUTION-MODEL-PASSED",
  "RG-HOST-FAMILY-ALPHA-COMPILER-PASSED",
  "RG-HOST-FAMILY-BUILD-PASSED",
  "RG-HOST-FAMILY-REPOSITORY-PASSED",
  "RG-HOST-FIRMWARE-CONTRACTS-PASSED",
  "RG-HOST-GOLDEN24-PROJECTION-PASSED",
  "RG-HOST-PRODUCT-BASELINE-PASSED",
  "RG-HOST-RELEASE-GATE-CONFORMANCE-PASSED",
  "RG-HOST-RUST-FIRMWARE-PASSED",
  "RG-HOST-SNAPSHOT-TRANSACTION-PASSED",
  "RG-HOST-WEIGHTED-RANDOM-CONTRACT-PASSED",
  "RG-MANIFEST-PARSER-HIL-PASSED",
  "RG-OFFLINE-POINT-READ-PASSED",
  "RG-OID-CODE-TOOL-FROZEN",
  "RG-OID-PHYSICAL-MAP-ASSIGNED",
  "RG-OID-TWO-HEAD-TWO-PRINT-MATRIX-PASSED",
  "RG-PLATFORM-ABI-HIL-PASSED",
  "RG-POINT-READ-LATENCY-PASSED",
  "RG-PRODUCTION-CONFIRMATION-TRUST-VERIFIED",
  "RG-SNAPSHOT-WEIGHTED-RANDOM-VERIFIED",
  "RG-TARGET-AUDIO-PROFILE-VERIFIED",
  "RG-TARGET-EXECUTION-MODEL-HIL-PASSED",
  "RG-TARGET-FORM-RELIABILITY-PASSED",
  "RG-TARGET-STORAGE-DURABILITY-PASSED",
  "RG-TARGET-TOOLCHAIN-SEALED",
  "RG-TWO-BOARD-PORT-HIL-PASSED",
];
const EXPECTED_CAPTURE_LANE_IDS = ["VENDOR_CONTACT", "BENCHMARK_SELLER", "LAB_REGISTRY", "VENDOR_RESPONSE"];
const EXPECTED_TEST_RESULT_REQUIRED = ["schemaVersion", "recordType", "resultId", "fixtureOnly", "evidenceState", "recordedAt", "verdict", "testDefinition", "specimen", "method", "rawArtifacts", "samples", "queueEvidence", "summary", "acceptance"];

const EXPECTED_SOURCE_METADATA = {
  "SRC-METHOD-GAP-USB-COMPLIANCE-PAGE": {
    publisher: "USB-IF",
    host: "www.usb.org",
    gapRefs: ["GAP-IF-USB-DATA-METHOD"],
    rawPath: `${PACKAGE_ROOT}/raw/usb-if-usb20-electrical-compliance-landing.html`,
    versionOrDate: "Version 1.08; page date 2026-04-21",
    contentType: "text/html; charset=UTF-8",
    bytes: 41422,
    sha256: "5adb045d7a628acad82e22681ba2689464df6b6276a7115e65502b920f7f252c",
  },
  "SRC-METHOD-GAP-USB-COMPLIANCE-PDF": {
    publisher: "USB-IF",
    host: "www.usb.org",
    gapRefs: ["GAP-IF-USB-DATA-METHOD"],
    rawPath: `${PACKAGE_ROOT}/raw/usb-if-usb20-electrical-compliance.pdf`,
    versionOrDate: "Version 1.08; USB-IF page date 2026-04-21",
    contentType: "application/pdf",
    bytes: 836863,
    sha256: "04c8f4bd54fd8669b538cf648d9b41eb3417771ac0544877272bc207ce543508",
  },
  "SRC-METHOD-GAP-USB-BASE-PAGE": {
    publisher: "USB-IF",
    host: "www.usb.org",
    gapRefs: ["GAP-IF-USB-DATA-METHOD"],
    rawPath: `${PACKAGE_ROOT}/raw/usb-if-usb20-specification-landing.html`,
    versionOrDate: "USB-IF page date 2025-06-03; original specification released 2000-04-27",
    contentType: "text/html; charset=UTF-8",
    bytes: 44664,
    sha256: "6124bdcafece22b95679065937a70c415486793827a8291367f10488156338ea",
  },
  "SRC-METHOD-GAP-STORAGE-MICRON-PLP": {
    publisher: "Micron Technology",
    host: "www.micron.com",
    gapRefs: ["GAP-IF-STORAGE-POWER-LOSS-METHOD"],
    rawPath: `${PACKAGE_ROOT}/raw/micron-ssd-power-loss-protection.pdf`,
    versionOrDate: null,
    contentType: "application/pdf",
    bytes: 379488,
    sha256: "dcc0f5234e738505f53919d92d70fb621eab5ba21b1e2c9671e5f4686577926b",
  },
  "SRC-METHOD-GAP-STORAGE-KIOXIA-DATA-LOSS": {
    publisher: "KIOXIA",
    host: "americas.kioxia.com",
    gapRefs: ["GAP-IF-STORAGE-POWER-LOSS-METHOD"],
    rawPath: `${PACKAGE_ROOT}/raw/kioxia-nvme-data-loss-mitigation.pdf`,
    versionOrDate: null,
    contentType: "application/pdf",
    bytes: 712488,
    sha256: "999908bb12ab65385fa47c2f39b6a4c026e4d54b2b637df894d4225dc3c39e33",
  },
  "SRC-METHOD-GAP-STORAGE-NVME-SPECIFICATIONS": {
    publisher: "NVM Express",
    host: "www.nvmexpress.org",
    gapRefs: ["GAP-IF-STORAGE-POWER-LOSS-METHOD"],
    rawPath: `${PACKAGE_ROOT}/raw/nvme-specifications-landing.html`,
    versionOrDate: "Latest NVMe specification set release stated as 2025-08-05",
    contentType: "text/html; charset=UTF-8",
    bytes: 88200,
    sha256: "f7af2d174ef871b0659a113b4d4c60575cb63f42c084b6001f9f78262e5eda3a",
  },
  "SRC-METHOD-GAP-STORAGE-SD-SPECS": {
    publisher: "SD Association",
    host: "www.sdcard.org",
    gapRefs: ["GAP-IF-STORAGE-POWER-LOSS-METHOD"],
    rawPath: `${PACKAGE_ROOT}/raw/sd-association-simplified-specifications.html`,
    versionOrDate: null,
    contentType: "text/html; charset=UTF-8",
    bytes: 77520,
    sha256: "4f0a206b5530d1ae011f36a159f920a07cac0ddf59bfe5213cb500a46ef636ec",
  },
  "SRC-METHOD-GAP-HIL-NI-VERISTAND": {
    publisher: "NI",
    host: "www.ni.com",
    gapRefs: ["GAP-CONTROL-STATUS-METHOD"],
    rawPath: `${PACKAGE_ROOT}/raw/ni-veristand-hil.html`,
    versionOrDate: null,
    contentType: "text/html; charset=utf-8",
    bytes: 562394,
    sha256: "5f8dc71c582b08f3a519dd11424def92e26823ee261618a614a791327f7c1354",
  },
  "SRC-METHOD-GAP-HIL-OPENHTF": {
    publisher: "OpenHTF project",
    host: "raw.githubusercontent.com",
    gapRefs: ["GAP-CONTROL-STATUS-METHOD"],
    rawPath: `${PACKAGE_ROOT}/raw/openhtf-readme.md`,
    versionOrDate: null,
    contentType: "text/plain; charset=utf-8",
    bytes: 6330,
    sha256: "323d8743680b870e568abc60009a28c0bf899179f0dbe93fecb5cc9344c23c82",
  },
};

const EXPECTED_UNAVAILABLE_SOURCE = {
  sourceId: "SRC-METHOD-GAP-UNAVAILABLE-JEDEC-POWER-LOSS",
  gapRefs: ["GAP-IF-STORAGE-POWER-LOSS-METHOD"],
  publisher: "JEDEC",
  url: "https://www.jedec.org/standards-documents",
  httpStatus: 403,
  accessState: "INACCESSIBLE",
};

const EXPECTED_DEPENDENCY_POLICY = {
  auditSnapshotState: "AUDIT_SNAPSHOT_AT_CAPTURE",
  liveFixtureRule: "CURRENT_SEMANTIC_VALIDATION_ONLY",
  liveSoftwareRule: "LIVE_BOUNDARY_SEMANTICS_ONLY_NO_HASH_OR_TASK_NAME",
  canonicalArtifactRule: "NO_CHURN_FOR_HARDWARE_IMPACT_NONE",
};

const EXPECTED_AUDIT_SOFTWARE_PROVENANCE = {
  anchorPath: OWNER_PATHS.softwareAnchor,
  anchorSha256: "bfe6fb9c02065246ee6d4485f34d6f6f29c9a0f2f5da50d7386e3168b759d763",
  anchorStateAtCapture: "SW-AUTHORING-TASK-RECOVERY-01_COMPLETE",
  acceptedFormalReportPath: OWNER_PATHS.newestSoftwareReport,
  acceptedFormalReportSha256: "7c9535fc585c2593f0215c6ec37dfc54c706896361db4dc68e5393d2fbc76059",
  acceptedFormalReportChecks: 22,
  acceptedFormalReportRole: "AUDIT_TIME_ACCEPTED_REPORT_NOT_NEWEST_REQUIRED",
  explicitHardwareImpactReportPath: OWNER_PATHS.explicitHardwareImpactReport,
  explicitHardwareImpactReportSha256: "3421b0de9614162cb20c02d5320c162beaa84b7547f5ee62ff5ba6b83d0cdd5b",
  provenanceState: "AUDIT_SNAPSHOT_AT_CAPTURE",
  liveSemanticRule: "LIVE_BOUNDARY_SEMANTICS_ONLY_NO_HASH_OR_TASK_NAME",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactOrdered(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

function exactSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && expected.every((item) => actual.includes(item));
}

function canonicalJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function absolute(relativePath) {
  return path.join(ROOT, relativePath.replaceAll("/", path.sep));
}

async function readArtifact(relativePath) {
  const filePath = absolute(relativePath);
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`not a plain file: ${relativePath}`);
  const bytes = await readFile(filePath);
  return { path: relativePath, bytes, bytesLength: bytes.length, sha256: sha256(bytes), text: bytes.toString("utf8") };
}

async function readJson(relativePath) {
  const artifact = await readArtifact(relativePath);
  return { ...artifact, document: JSON.parse(artifact.text) };
}

function topologyHashInput(topology) {
  const { topologyId: _topologyId, ...hashInput } = topology;
  return hashInput;
}

function check(checks, name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail: passed ? null : detail });
}

function schemaObjectNodesAreClosed(schema) {
  const failures = [];
  const visit = (node, location) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object" && node.additionalProperties !== false) failures.push(location);
    for (const [key, value] of Object.entries(node)) visit(value, `${location}.${key}`);
  };
  visit(schema, "$root");
  return failures;
}

function hostMatches(urlText, expectedHost) {
  try {
    const parsed = new URL(urlText);
    return parsed.protocol === "https:" && parsed.hostname === expectedHost;
  } catch {
    return false;
  }
}

function hasConcreteTargetValue(value) {
  if (typeof value !== "string") return false;
  return /(?:\b\d+(?:\.\d+)?\s*(?:V|A|mV|mA|mm|cm|ms|us|ns|Hz|dBA)\b|\bGPIO\d+\b|\bVID\s*[:=]|\bPID\s*[:=]|\bBOARD_MPN\s*[:=]|\bPCB_REV\s*[:=]|\bHEAD_MPN\s*[:=]|\bHEAD_REV\s*[:=]|\bFW_VERSION\s*[:=])/i.test(value);
}

function scanForConcreteTargetValues(value, location = "$") {
  const findings = [];
  if (hasConcreteTargetValue(value)) findings.push(location);
  if (Array.isArray(value)) value.forEach((item, index) => findings.push(...scanForConcreteTargetValues(item, `${location}[${index}]`)));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => findings.push(...scanForConcreteTargetValues(item, `${location}.${key}`)));
  return findings;
}

function expectedGapShape(gapId) {
  if (gapId === "GAP-IF-USB-DATA-METHOD") return {
    interfaces: ["IF-USB-DATA", "IF-USB-MECHANICAL"],
    supporting: [],
    methods: [],
    slots: [],
    proposed: "PROPOSED-USB-DATA-OBSERVATION-001",
    instrumentState: "MISSING",
    skeletonState: "JUSTIFIED_DRAFT",
    decision: "FREEZE_TARGET_NEUTRAL_SKELETON",
    confidence: "HIGH",
    rawOutputs: ["enumeration_trace", "transfer_trace", "disconnect_reconnect_trace", "raw_capture_manifest", "session_binding_ref"],
    evidence: ["SRC-METHOD-GAP-USB-COMPLIANCE-PAGE", "SRC-METHOD-GAP-USB-COMPLIANCE-PDF", "SRC-METHOD-GAP-USB-BASE-PAGE"],
  };
  if (gapId === "GAP-IF-STORAGE-POWER-LOSS-METHOD") return {
    interfaces: ["IF-STORAGE"],
    supporting: [],
    methods: ["OID-FUNCTION-001"],
    slots: ["DMM-01", "MACRO-01"],
    proposed: "PROPOSED-STORAGE-POWER-LOSS-DURABILITY-001",
    instrumentState: "PENDING_OWNER_DECISION",
    skeletonState: "PENDING_DRAFT_NOT_FREEZABLE",
    decision: "KEEP_PENDING_MORE_PRIMARY_EVIDENCE",
    confidence: "MEDIUM",
    rawOutputs: ["pre_interrupt_manifest", "power_interrupt_trace", "post_recovery_manifest", "corruption_or_recovery_log", "hash_comparison"],
    evidence: ["SRC-METHOD-GAP-STORAGE-MICRON-PLP", "SRC-METHOD-GAP-STORAGE-KIOXIA-DATA-LOSS", "SRC-METHOD-GAP-STORAGE-NVME-SPECIFICATIONS", "SRC-METHOD-GAP-STORAGE-SD-SPECS", "SRC-METHOD-GAP-UNAVAILABLE-JEDEC-POWER-LOSS"],
  };
  return {
    interfaces: ["IF-CONTROL", "IF-STATUS"],
    supporting: ["IF-DIAGNOSTIC"],
    methods: ["LAB-SETUP-001", "PWR-BOARD-BOOT-001", "OID-FUNCTION-001"],
    slots: ["PSU-01", "DMM-01", "MACRO-01", "USBPWR-01"],
    proposed: "PROPOSED-CONTROL-STATUS-HIL-001",
    instrumentState: "PENDING_OWNER_DECISION",
    skeletonState: "JUSTIFIED_DRAFT",
    decision: "FREEZE_TARGET_NEUTRAL_SKELETON",
    confidence: "HIGH",
    rawOutputs: ["stimulus_trace", "observation_trace", "diagnostic_log", "measurement_manifest", "attachment_manifest"],
    evidence: ["SRC-METHOD-GAP-HIL-NI-VERISTAND", "SRC-METHOD-GAP-HIL-OPENHTF"],
  };
}

export async function loadMethodGapContext() {
  const schemaFile = await readJson(SCHEMA_PATH);
  const manifestFile = await readJson(MANIFEST_PATH);
  const methodCatalogFile = await readJson(OWNER_PATHS.methodCatalog);
  const registrationPlanFile = await readJson(OWNER_PATHS.registrationPlan);
  const topologyFile = await readJson(OWNER_PATHS.topology);
  const targetBindingFile = await readJson(OWNER_PATHS.targetBinding);
  const softwareAnchorFile = await readArtifact(OWNER_PATHS.softwareAnchor);
  const softwareDesktopAnchorFile = await readArtifact(OWNER_PATHS.softwareDesktopAnchor);
  const newestSoftwareReportFile = await readJson(OWNER_PATHS.newestSoftwareReport);
  const explicitHardwareImpactReportFile = await readJson(OWNER_PATHS.explicitHardwareImpactReport);
  const fixtureContext = await loadFixtureContext();
  const fixtureEvaluation = evaluateFixtureDocuments(fixtureContext);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateSchema = ajv.compile(schemaFile.document);
  const rawFiles = new Map();
  for (const source of manifestFile.document.officialSources ?? []) {
    try { rawFiles.set(source.localRawPath, await readArtifact(source.localRawPath)); } catch { /* evaluation reports missing raw files */ }
  }
  const rawDirectoryEntries = [];
  try {
    const entries = await readdir(absolute(`${PACKAGE_ROOT}/raw`), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${PACKAGE_ROOT}/raw/${entry.name}`;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        rawDirectoryEntries.push({ path: relativePath, kind: entry.isDirectory() ? "directory" : "non-file" });
        continue;
      }
      const artifact = await readArtifact(relativePath);
      rawDirectoryEntries.push({ path: relativePath, kind: "file", bytes: artifact.bytesLength, sha256: artifact.sha256 });
    }
  } catch (error) {
    rawDirectoryEntries.push({ path: `${PACKAGE_ROOT}/raw`, kind: "missing", error: error.message });
  }
  rawDirectoryEntries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaFile,
    manifestFile,
    methodCatalogFile,
    registrationPlanFile,
    topologyFile,
    targetBindingFile,
    softwareAnchorFile,
    softwareDesktopAnchorFile,
    newestSoftwareReportFile,
    explicitHardwareImpactReportFile,
    fixtureContext,
    fixtureEvaluation,
    validateSchema,
    rawFiles,
    rawDirectoryEntries,
  };
}

export function evaluateMethodGapManifest(context, manifest = context.manifestFile.document) {
  const checks = [];
  const schemaValid = context.validateSchema(manifest);
  check(checks, "method-gap manifest schema validates", schemaValid, context.validateSchema.errors);
  check(checks, "schema uses closed object nodes", schemaObjectNodesAreClosed(context.schemaFile.document).length === 0, schemaObjectNodesAreClosed(context.schemaFile.document));
  check(checks, "manifest is deterministic JSON", canonicalJson(manifest) === context.manifestFile.text, { expected: canonicalJson(manifest), actual: context.manifestFile.text });
  check(checks, "manifest has exact package identity and unresolved board state", manifest.packageId === "HW-FIXTURE-METHOD-GAP-EVIDENCE-AUDIT-V1" && manifest.revision === "1.1.0" && manifest.boardTargetState === "UNRESOLVED" && manifest.status === "AUDIT_COMPLETE", manifest);

  const protectedByPath = new Map((manifest.protectedFiles ?? []).map((item) => [item.path, item]));
  check(checks, "protected file list has exact expected paths", exactSet([...protectedByPath.keys()], EXPECTED_PROTECTED_FILES.map(([file]) => file)), [...protectedByPath.keys()]);
  const auditSnapshotProblems = [];
  for (const [file, owner, bytes, expectedSha] of EXPECTED_PROTECTED_FILES) {
    const declared = protectedByPath.get(file);
    if (!declared || declared.owner !== owner || declared.bytes !== bytes || declared.sha256 !== expectedSha || declared.state !== "AUDIT_SNAPSHOT_AT_CAPTURE") auditSnapshotProblems.push({ file, declared, expected: { owner, bytes, sha256: expectedSha, state: "AUDIT_SNAPSHOT_AT_CAPTURE" } });
  }
  const currentOwnerSemanticProblems = [];
  const methodCatalog = context.methodCatalogFile.document;
  const registrationPlan = context.registrationPlanFile.document;
  const topologyOwner = context.topologyFile.document;
  const targetBindingOwner = context.targetBindingFile.document;
  const testResultSchema = context.fixtureContext.ownerFiles.testResultSchema.document;
  const releaseGateCatalog = context.fixtureContext.ownerFiles.releaseGateCatalog.document;
  const evidenceCaptureProfile = context.fixtureContext.ownerFiles.evidenceCaptureProfile.document;
  const currentMethodIds = methodCatalog.methods?.map((method) => method.id) ?? [];
  const currentSlotIds = registrationPlan.slots?.map((slot) => slot.id) ?? [];
  const currentAssetKinds = [...new Set((registrationPlan.slots ?? []).flatMap((slot) => (slot.assets ?? []).map((asset) => asset.assetKind)))];
  const currentGateIds = releaseGateCatalog.gates?.map((gate) => gate.gateId) ?? [];
  const currentLaneIds = evidenceCaptureProfile.lanes?.map((lane) => lane.id) ?? [];
  if (methodCatalog.schemaVersion !== 1 || methodCatalog.catalogId !== "EVT0-LAB-METHODS-V1" || !exactOrdered(currentMethodIds, EXPECTED_METHOD_IDS) || new Set(currentMethodIds).size !== currentMethodIds.length) currentOwnerSemanticProblems.push({ owner: "methodCatalog", schemaVersion: methodCatalog.schemaVersion, catalogId: methodCatalog.catalogId, ids: currentMethodIds });
  if (registrationPlan.schemaVersion !== 1 || registrationPlan.planId !== "EVT0-LAB-REGISTRATION-CAPTURE-V1" || registrationPlan.qualificationEffect !== "NONE_PREPARATION_ONLY" || !exactOrdered(currentSlotIds, EXPECTED_SLOT_IDS) || !exactSet(currentAssetKinds, EXPECTED_ASSET_KINDS)) currentOwnerSemanticProblems.push({ owner: "registrationPlan", schemaVersion: registrationPlan.schemaVersion, planId: registrationPlan.planId, qualificationEffect: registrationPlan.qualificationEffect, slots: currentSlotIds, assetKinds: currentAssetKinds });
  const topologyOwnerInterfaces = topologyOwner.interfaces?.map((item) => item.interfaceId) ?? [];
  const topologyOwnerCanonicalSha = canonicalSha256(topologyHashInput(topologyOwner)).sha256;
  if (topologyOwner.schemaVersion !== 1 || topologyOwner.profile !== "hardware-system-topology-v1" || topologyOwner.topologyId !== `hwt:sha256:${topologyOwnerCanonicalSha}` || !exactOrdered(topologyOwnerInterfaces, EXPECTED_INTERFACES)) currentOwnerSemanticProblems.push({ owner: "topology", schemaVersion: topologyOwner.schemaVersion, profile: topologyOwner.profile, topologyId: topologyOwner.topologyId, canonicalSha: topologyOwnerCanonicalSha, interfaces: topologyOwnerInterfaces });
  const targetBindingInterfaces = targetBindingOwner.interfaceBindings?.map((item) => item.interfaceId) ?? [];
  if (targetBindingOwner.schemaVersion !== 1 || targetBindingOwner.profile !== "hardware-system-target-binding-v1" || targetBindingOwner.targetIdentity?.state !== "UNRESOLVED" || !exactSet(targetBindingInterfaces, EXPECTED_INTERFACES) || targetBindingOwner.interfaceBindings?.some((item) => item.state !== "TARGET_EVIDENCE_PENDING")) currentOwnerSemanticProblems.push({ owner: "targetBinding", schemaVersion: targetBindingOwner.schemaVersion, profile: targetBindingOwner.profile, targetState: targetBindingOwner.targetIdentity?.state, interfaces: targetBindingInterfaces });
  if (testResultSchema.$id !== "https://yimi.local/schemas/test-result-v1.json" || testResultSchema.type !== "object" || testResultSchema.additionalProperties !== false || !exactSet(testResultSchema.required ?? [], EXPECTED_TEST_RESULT_REQUIRED)) currentOwnerSemanticProblems.push({ owner: "testResult", id: testResultSchema.$id, type: testResultSchema.type, closed: testResultSchema.additionalProperties === false, required: testResultSchema.required });
  if (releaseGateCatalog.schemaVersion !== 1 || releaseGateCatalog.profile !== "release-gate-catalog-v1" || typeof releaseGateCatalog.catalogVersion !== "string" || !exactOrdered(currentGateIds, EXPECTED_RELEASE_GATE_IDS) || new Set(currentGateIds).size !== currentGateIds.length) currentOwnerSemanticProblems.push({ owner: "releaseGates", schemaVersion: releaseGateCatalog.schemaVersion, profile: releaseGateCatalog.profile, catalogVersion: releaseGateCatalog.catalogVersion, gateIds: currentGateIds });
  if (evidenceCaptureProfile.schemaVersion !== 1 || evidenceCaptureProfile.profileId !== "HW-EVIDENCE-CAPTURE-ADAPTER-V1" || !exactOrdered(currentLaneIds, EXPECTED_CAPTURE_LANE_IDS) || evidenceCaptureProfile.effects?.targetBindingEffect !== "NONE") currentOwnerSemanticProblems.push({ owner: "evidenceCapture", schemaVersion: evidenceCaptureProfile.schemaVersion, profileId: evidenceCaptureProfile.profileId, lanes: currentLaneIds, effects: evidenceCaptureProfile.effects });
  const liveFixtureProfile = context.fixtureContext.packageFiles.profile.document;
  const liveFixtureGaps = liveFixtureProfile.coverageGaps?.map((gap) => gap.id) ?? [];
  const liveFixtureInterfaces = (liveFixtureProfile.capabilities ?? []).filter((capability) => capability.role === "OPERATIONAL").flatMap((capability) => capability.interfaceRefs ?? []);
  const fixtureSemanticProblems = [];
  if (!context.fixtureEvaluation.passed || context.fixtureEvaluation.summary.failed !== 0) fixtureSemanticProblems.push({ reason: "fixture validator has failed checks", summary: context.fixtureEvaluation.summary });
  if (liveFixtureProfile.profileId !== "HW-REUSABLE-TEST-FIXTURE-ARCHITECTURE-V1" || liveFixtureProfile.revision !== "1.0.0") fixtureSemanticProblems.push({ reason: "fixture profile identity/revision", profileId: liveFixtureProfile.profileId, revision: liveFixtureProfile.revision });
  if (!exactOrdered(liveFixtureProfile.capabilities?.map((capability) => capability.id) ?? [], EXPECTED_CAPABILITY_IDS)) fixtureSemanticProblems.push({ reason: "capability IDs", actual: liveFixtureProfile.capabilities?.map((capability) => capability.id) });
  if (!exactSet(liveFixtureInterfaces, EXPECTED_INTERFACES) || liveFixtureInterfaces.length !== EXPECTED_INTERFACES.length) fixtureSemanticProblems.push({ reason: "operational interface coverage", actual: liveFixtureInterfaces });
  if (!exactOrdered(liveFixtureGaps, EXPECTED_FIXTURE_GAP_IDS)) fixtureSemanticProblems.push({ reason: "coverage gaps", expected: EXPECTED_FIXTURE_GAP_IDS, actual: liveFixtureGaps });
  const fixtureTargetState = liveFixtureProfile.targetBindingState ?? liveFixtureProfile.boardTargetState ?? context.fixtureContext.ownerFiles.targetBinding.document.targetIdentity?.state;
  if (fixtureTargetState !== "UNRESOLVED") fixtureSemanticProblems.push({ reason: "fixture target boundary", targetState: fixtureTargetState });
  check(checks, "audit snapshots remain immutable while live owners and fixture pass semantic conformance", auditSnapshotProblems.length === 0 && currentOwnerSemanticProblems.length === 0 && fixtureSemanticProblems.length === 0 && deepEqual(manifest.dependencyPolicy, EXPECTED_DEPENDENCY_POLICY), { auditSnapshotProblems, currentOwnerSemanticProblems, fixtureSemanticProblems, dependencyPolicy: manifest.dependencyPolicy, liveFixtureSummary: context.fixtureEvaluation.summary });

  const topology = context.topologyFile.document;
  const topologyCanonicalSha = canonicalSha256(topologyHashInput(topology)).sha256;
  const topologyInterfaces = topology.interfaces?.map((item) => item.interfaceId) ?? [];
  check(checks, "topology identity uses canonical hash with topologyId omitted", topology.topologyId === `hwt:sha256:${topologyCanonicalSha}` && topologyCanonicalSha === "98a87a1de9ee8dfa52ec68ebd00afbbf23fa3c18e0c2a75e34ba09da4a9c4e5f", { topologyId: topology.topologyId, topologyCanonicalSha });
  check(checks, "topology has exact 18 stable interfaces", exactOrdered(topologyInterfaces, EXPECTED_INTERFACES), topologyInterfaces);
  const targetBinding = context.targetBindingFile.document;
  check(checks, "target binding remains UNRESOLVED with 18 pending interfaces", targetBinding.targetIdentity?.state === "UNRESOLVED" && targetBinding.interfaceBindings?.length === 18 && targetBinding.interfaceBindings.every((item) => item.state === "TARGET_EVIDENCE_PENDING") && exactSet(targetBinding.interfaceBindings.map((item) => item.interfaceId), EXPECTED_INTERFACES), { state: targetBinding.targetIdentity?.state, bindings: targetBinding.interfaceBindings });

  const methodIds = new Set((context.methodCatalogFile.document.methods ?? []).map((method) => method.id));
  const slotIds = new Set((context.registrationPlanFile.document.slots ?? []).map((slot) => slot.id));
  const assetKinds = new Set((context.registrationPlanFile.document.slots ?? []).flatMap((slot) => (slot.assets ?? []).map((asset) => asset.assetKind)));
  const expectedMethodRefs = new Map(EXPECTED_GAP_IDS.map((gapId) => [gapId, expectedGapShape(gapId).methods]));
  const expectedSlotRefs = new Map(EXPECTED_GAP_IDS.map((gapId) => [gapId, expectedGapShape(gapId).slots]));
  const gaps = manifest.gaps ?? [];
  const gapIds = gaps.map((gap) => gap.gapId);
  check(checks, "manifest has exact three gap IDs", exactOrdered(gapIds, EXPECTED_GAP_IDS), gapIds);
  const gapById = new Map(gaps.map((gap) => [gap.gapId, gap]));
  const gapProblems = [];
  for (const gapId of EXPECTED_GAP_IDS) {
    const gap = gapById.get(gapId);
    const expected = expectedGapShape(gapId);
    if (!gap) { gapProblems.push({ gapId, reason: "missing" }); continue; }
    if (!exactOrdered(gap.interfaceRefs, expected.interfaces) || !exactOrdered(gap.supportingInterfaceRefs, expected.supporting) || !exactOrdered(gap.existingMethodRefs, expected.methods) || !exactOrdered(gap.existingInstrumentSlotRefs, expected.slots) || gap.proposedMethodId !== expected.proposed || gap.methodStatus !== "PROPOSED_ONLY" || gap.acceptedInMethodCatalog !== false || gap.instrumentCoverage?.dedicatedSlotState !== expected.instrumentState || !exactOrdered(gap.targetNeutralSkeleton?.rawOutputs, expected.rawOutputs) || gap.targetNeutralSkeleton?.state !== expected.skeletonState || gap.targetNeutralSkeleton?.targetDependentFields !== "PENDING" || gap.targetNeutralSkeleton?.physicalThresholds !== "PENDING" || gap.physicalAcceptanceThresholdState !== "PENDING" || !exactOrdered(gap.evidenceRefs, expected.evidence) || gap.decision !== expected.decision || gap.confidence !== expected.confidence) gapProblems.push({ gapId, reason: "shape/status mismatch", gap });
    const unknownMethods = (gap.existingMethodRefs ?? []).filter((id) => !methodIds.has(id));
    const unknownSlots = (gap.existingInstrumentSlotRefs ?? []).filter((id) => !slotIds.has(id));
    const unknownInterfaces = [...(gap.interfaceRefs ?? []), ...(gap.supportingInterfaceRefs ?? [])].filter((id) => !topologyInterfaces.includes(id));
    if (unknownMethods.length || unknownSlots.length || unknownInterfaces.length) gapProblems.push({ gapId, unknownMethods, unknownSlots, unknownInterfaces });
    if (!exactOrdered(gap.existingMethodRefs, expectedMethodRefs.get(gapId)) || !exactOrdered(gap.existingInstrumentSlotRefs, expectedSlotRefs.get(gapId))) gapProblems.push({ gapId, reason: "existing owner refs drift" });
    if (gap.instrumentCoverage?.existingSlotRefs?.some((id) => !slotIds.has(id)) || gap.instrumentCoverage?.existingSlotRefs?.some((id) => !expected.slots.includes(id))) gapProblems.push({ gapId, reason: "instrument coverage owner refs drift" });
    const stepIds = gap.targetNeutralSkeleton?.steps?.map((step) => step.id) ?? [];
    if (!exactOrdered(stepIds, ["STEP-01", "STEP-02", "STEP-03", "STEP-04"]) || gap.targetNeutralSkeleton?.steps?.some((step) => step.physicalThresholdState !== "PENDING" || !Array.isArray(step.targetDependentFields) || step.targetDependentFields.length === 0)) gapProblems.push({ gapId, reason: "skeleton step boundary drift" });
    if (!gap.targetSpecificParameters?.every((item) => /^[A-Z0-9_]+$/.test(item))) gapProblems.push({ gapId, reason: "target parameter names are not placeholders" });
    if (scanForConcreteTargetValues(gap).length) gapProblems.push({ gapId, reason: "concrete target-dependent value", findings: scanForConcreteTargetValues(gap) });
  }
  check(checks, "all method, instrument-slot, interface, and gap refs resolve to existing owners", gapProblems.length === 0, gapProblems);
  check(checks, "no proposed method ID is accepted in the stable method catalog", gaps.every((gap) => !methodIds.has(gap.proposedMethodId) && gap.methodStatus === "PROPOSED_ONLY" && gap.acceptedInMethodCatalog === false), { proposed: gaps.map((gap) => gap.proposedMethodId), catalog: [...methodIds] });
  check(checks, "no proposed instrument registry or asset kind is promoted", gaps.every((gap) => gap.instrumentCoverage?.registryEffect === "NONE" && gap.instrumentCoverage?.existingSlotRefs?.every((id) => slotIds.has(id))) && assetKinds.size === 7, { assetKinds: [...assetKinds], slots: [...slotIds] });

  const sourceIds = (manifest.officialSources ?? []).map((source) => source.sourceId);
  check(checks, "official source records are exact and unique", sourceIds.length === Object.keys(EXPECTED_SOURCE_METADATA).length && new Set(sourceIds).size === sourceIds.length && Object.keys(EXPECTED_SOURCE_METADATA).every((id) => sourceIds.includes(id)), sourceIds);
  const sourceProblems = [];
  for (const [sourceId, expected] of Object.entries(EXPECTED_SOURCE_METADATA)) {
    const source = (manifest.officialSources ?? []).find((item) => item.sourceId === sourceId);
    const raw = source ? context.rawFiles.get(source.localRawPath) : null;
    if (!source || source.publisher !== expected.publisher || !hostMatches(source.url, expected.host) || !exactOrdered(source.gapRefs, expected.gapRefs) || source.localRawPath !== expected.rawPath || source.sourceVersionOrDate !== expected.versionOrDate || source.contentType !== expected.contentType || source.bytes !== expected.bytes || source.sha256 !== expected.sha256 || source.httpStatus !== 200 || !raw || raw.bytesLength !== expected.bytes || raw.sha256 !== expected.sha256) sourceProblems.push({ sourceId, source, expected, raw: raw ? { bytes: raw.bytesLength, sha256: raw.sha256 } : null });
    if (source && (source.licenseBoundary === "" || source.claimBoundary === "" || scanForConcreteTargetValues(source.claimBoundary).length)) sourceProblems.push({ sourceId, reason: "source claim/license boundary invalid" });
  }
  const rawExpected = Object.values(EXPECTED_SOURCE_METADATA).map((item) => ({ path: item.rawPath, bytes: item.bytes, sha256: item.sha256 })).sort((left, right) => left.path.localeCompare(right.path));
  const rawActual = [...context.rawDirectoryEntries].sort((left, right) => left.path.localeCompare(right.path));
  if (rawActual.length !== rawExpected.length || rawActual.some((entry, index) => entry.kind !== "file" || entry.path !== rawExpected[index]?.path || entry.bytes !== rawExpected[index]?.bytes || entry.sha256 !== rawExpected[index]?.sha256)) sourceProblems.push({ reason: "raw directory inventory drift", expected: rawExpected, actual: rawActual });
  check(checks, "official sources use allowed publishers/domains and reproducible raw snapshots", sourceProblems.length === 0, sourceProblems);
  const unavailable = manifest.unavailableOfficialSources ?? [];
  check(checks, "inaccessible primary source is explicitly recorded without fabricated content", unavailable.length === 1 && deepEqual({ sourceId: unavailable[0]?.sourceId, gapRefs: unavailable[0]?.gapRefs, publisher: unavailable[0]?.publisher, url: unavailable[0]?.url, httpStatus: unavailable[0]?.httpStatus, accessState: unavailable[0]?.accessState }, EXPECTED_UNAVAILABLE_SOURCE) && unavailable[0]?.localRawPath === null, unavailable);
  const evidenceRefProblems = [];
  const allEvidenceIds = new Set([...sourceIds, ...unavailable.map((source) => source.sourceId)]);
  for (const gap of gaps) for (const sourceId of gap.evidenceRefs ?? []) if (!allEvidenceIds.has(sourceId)) evidenceRefProblems.push({ gapId: gap.gapId, sourceId });
  check(checks, "every gap evidence reference resolves to a captured or explicitly unavailable source", evidenceRefProblems.length === 0, evidenceRefProblems);
  check(checks, "no unofficial domain or search-snippet evidence is represented", (manifest.officialSources ?? []).every((source) => !/[?&](q|query)=/i.test(source.url) && !/google\.|bing\.|duckduckgo\./i.test(new URL(source.url).hostname)), manifest.officialSources?.map((source) => source.url));

  check(checks, "effects are all NONE and no physical/promotion claim exists", deepEqual(manifest.effects, { methodCatalog: "NONE", instrumentRegistry: "NONE", targetBinding: "NONE", physicalEvidence: "NONE", releaseGate: "NONE", promotion: "NONE", software: "NONE" }) && !JSON.stringify(manifest).match(/physicalQualification|releaseGateClosed|boardStatePromoted|targetPromoted/i), manifest.effects);
  check(checks, "all target-specific parameters and physical thresholds remain PENDING", gaps.every((gap) => gap.physicalAcceptanceThresholdState === "PENDING" && gap.targetNeutralSkeleton?.targetDependentFields === "PENDING" && gap.targetNeutralSkeleton?.physicalThresholds === "PENDING"), gaps.map((gap) => ({ gapId: gap.gapId, parameters: gap.targetSpecificParameters, threshold: gap.physicalAcceptanceThresholdState })));

  const decisions = manifest.decisions ?? [];
  const decisionProblems = [];
  for (const gapId of EXPECTED_GAP_IDS) {
    const decision = decisions.find((item) => item.gapId === gapId);
    const gap = gapById.get(gapId);
    if (!decision || !gap || decision.classification !== gap.decision || decision.nextOwner !== OWNER_PATHS.methodCatalog || typeof decision.rationale !== "string" || decision.rationale.length < 20 || !Number.isInteger(decision.scoreForLaterMethodPackage)) decisionProblems.push({ gapId, decision });
  }
  check(checks, "three evidence-based classifications and later-package scores are present", decisions.length === 3 && decisionProblems.length === 0, decisionProblems);

  const software = manifest.softwareReadOnly ?? {};
  const actualNewestReport = context.newestSoftwareReportFile;
  const actualImpactReport = context.explicitHardwareImpactReportFile;
  const impactBoundaries = actualImpactReport.document.boundaries ?? {};
  const currentParentSemantic = context.softwareAnchorFile.text.includes("Current step:") && context.softwareAnchorFile.text.includes("Next exact step:") && context.softwareAnchorFile.text.includes("BOARD_TARGET=UNRESOLVED") && context.softwareAnchorFile.text.includes("hardwareImpact=NONE");
  const currentDesktopSemantic = context.softwareDesktopAnchorFile.text.includes("SW-DESKTOP-AUTHORING-UI-ADAPTER-01") && context.softwareDesktopAnchorFile.text.includes("Hardware input:") && context.softwareDesktopAnchorFile.text.includes("hardwareImpact=NONE") && context.softwareDesktopAnchorFile.text.includes("BOARD_TARGET=UNRESOLVED");
  const acceptedFormalCurrent = actualNewestReport.document.checksPassed === actualNewestReport.document.checks?.length && actualNewestReport.document.checksPassed > 0;
  const softwareProvenance = deepEqual({
    anchorPath: software.anchorPath,
    anchorSha256: software.anchorSha256,
    anchorStateAtCapture: software.anchorStateAtCapture,
    acceptedFormalReportPath: software.acceptedFormalReportPath,
    acceptedFormalReportSha256: software.acceptedFormalReportSha256,
    acceptedFormalReportChecks: software.acceptedFormalReportChecks,
    acceptedFormalReportRole: software.acceptedFormalReportRole,
    explicitHardwareImpactReportPath: software.explicitHardwareImpactReportPath,
    explicitHardwareImpactReportSha256: software.explicitHardwareImpactReportSha256,
    provenanceState: software.provenanceState,
    liveSemanticRule: software.liveSemanticRule,
  }, EXPECTED_AUDIT_SOFTWARE_PROVENANCE);
  check(checks, "software audit provenance is immutable and live anchors/reports pass semantic checks", softwareProvenance && currentParentSemantic && currentDesktopSemantic && acceptedFormalCurrent && context.softwareAnchorFile.path === OWNER_PATHS.softwareAnchor && context.softwareDesktopAnchorFile.path === OWNER_PATHS.softwareDesktopAnchor, { softwareProvenance, currentParentSemantic, currentDesktopSemantic, acceptedFormalCurrent, currentAnchor: { path: context.softwareAnchorFile.path, sha256: context.softwareAnchorFile.sha256 }, desktopAnchor: { path: context.softwareDesktopAnchorFile.path, sha256: context.softwareDesktopAnchorFile.sha256 }, acceptedFormalReport: { path: actualNewestReport.path, sha256: actualNewestReport.sha256, checksPassed: actualNewestReport.document.checksPassed } });
  check(checks, "software hardwareImpact remains NONE with BOARD_TARGET unresolved", software.explicitHardwareImpactReportPath === OWNER_PATHS.explicitHardwareImpactReport && software.hardwareImpact === "NONE" && software.boardTarget === "UNRESOLVED" && software.sessionCoreModified === false && software.familyWorkspaceModified === false && software.productionProviderQualified === false && software.offlineReady === false && impactBoundaries.hardwareImpact === "NONE" && impactBoundaries.boardTarget === "UNRESOLVED" && impactBoundaries.sessionCoreModified === false && impactBoundaries.familyWorkspaceModified === false && impactBoundaries.productionProviderQualified === false && impactBoundaries.offlineReady === false, { manifest: software, actual: impactBoundaries });
  check(checks, "package effects do not modify software", manifest.effects?.software === "NONE" && software.sessionCoreModified === false && software.familyWorkspaceModified === false, manifest.effects);

  const implementationProblems = [];
  for (const relativePath of EXPECTED_IMPLEMENTATION_PATHS) {
    const declared = (manifest.implementation ?? []).find((item) => item.path === relativePath);
    let actual = null;
    try { actual = readArtifactSyncForEvaluation(relativePath); } catch { /* reported below */ }
    if (!declared || !actual || declared.revision !== "1.1.0" || declared.bytes !== actual.bytesLength || declared.sha256 !== actual.sha256) implementationProblems.push({ relativePath, declared, actual: actual ? { bytes: actual.bytesLength, sha256: actual.sha256 } : null });
  }
  check(checks, "implementation identities match current bytes, SHA-256, and revision", (manifest.implementation ?? []).length === EXPECTED_IMPLEMENTATION_PATHS.length && implementationProblems.length === 0, implementationProblems);
  check(checks, "method-gap package does not claim stable-owner writes", !JSON.stringify(manifest).match(/method-catalog\.json\s*[:=]\s*(?:write|modified|changed)|target-binding.*(?:FROZEN|\bRESOLVED\b)|(?:physicalQualification|releaseGateClosed|boardStatePromoted|targetPromoted)\s*[:=]\s*(?:true|\"(?:READY|QUALIFIED)\")/i), manifest.effects);

  return checks;
}

function readArtifactSyncForEvaluation(relativePath) {
  const filePath = absolute(relativePath);
  const bytes = readFileSync(filePath);
  return { path: relativePath, bytesLength: bytes.length, sha256: sha256(bytes) };
}

export async function runValidation() {
  const context = await loadMethodGapContext();
  const checks = evaluateMethodGapManifest(context);
  const report = {
    schemaVersion: 1,
    reportKind: "hardware-method-gap-evidence-validation-v1",
    package: { path: MANIFEST_PATH, sha256: context.manifestFile.sha256, bytes: context.manifestFile.bytesLength, packageId: context.manifestFile.document.packageId, revision: context.manifestFile.document.revision },
    sources: { official: context.manifestFile.document.officialSources?.length ?? 0, unavailable: context.manifestFile.document.unavailableOfficialSources?.length ?? 0, rawCaptured: context.rawFiles.size },
    gaps: { count: context.manifestFile.document.gaps?.length ?? 0, classifications: Object.fromEntries((context.manifestFile.document.decisions ?? []).map((decision) => [decision.gapId, decision.classification])) },
    topology: { canonicalSha256: canonicalSha256(topologyHashInput(context.topologyFile.document)).sha256, rawSha256: context.topologyFile.sha256, interfaceCount: context.topologyFile.document.interfaces?.length ?? 0, boardTarget: context.targetBindingFile.document.targetIdentity?.state ?? null },
    rawDirectory: { fileCount: context.rawDirectoryEntries.filter((entry) => entry.kind === "file").length, entries: context.rawDirectoryEntries },
    liveDependencies: {
      fixture: {
        profilePath: context.fixtureContext.packageFiles.profile.path,
        profileSha256: context.fixtureContext.packageFiles.profile.sha256,
        validatorSummary: context.fixtureEvaluation.summary,
        capabilityIds: context.fixtureContext.packageFiles.profile.document.capabilities?.map((capability) => capability.id) ?? [],
        operationalInterfaceCount: (context.fixtureContext.packageFiles.profile.document.capabilities ?? []).filter((capability) => capability.role === "OPERATIONAL").flatMap((capability) => capability.interfaceRefs ?? []).length,
        coverageGaps: context.fixtureContext.packageFiles.profile.document.coverageGaps?.map((gap) => gap.id) ?? [],
      },
      software: {
        parentAnchor: { path: context.softwareAnchorFile.path, sha256: context.softwareAnchorFile.sha256 },
        desktopAnchor: { path: context.softwareDesktopAnchorFile.path, sha256: context.softwareDesktopAnchorFile.sha256 },
        acceptedFormalReport: { path: context.newestSoftwareReportFile.path, sha256: context.newestSoftwareReportFile.sha256, checksPassed: context.newestSoftwareReportFile.document.checksPassed },
        explicitHardwareImpactReport: { path: context.explicitHardwareImpactReportFile.path, sha256: context.explicitHardwareImpactReportFile.sha256, boundaries: context.explicitHardwareImpactReportFile.document.boundaries ?? {} },
      },
    },
    softwareReadOnly: context.manifestFile.document.softwareReadOnly,
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
    console.log(`Hardware method-gap evidence validation: ${report.passed ? "PASS" : "FAIL"} (${report.summary.passed}/${report.summary.total})`);
    console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`Hardware method-gap evidence validation: ERROR ${error.message}`);
    process.exitCode = 1;
  }
}
