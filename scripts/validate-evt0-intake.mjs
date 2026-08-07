import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const intakeRoot = path.join(root, "hardware/evt0/intake-v1");
const errors = [];
const warnings = [];
const checks = [];

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
  if (!passed) errors.push(`${name}: ${detail}`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

const intakeSchema = await readJson(path.join(intakeRoot, "schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)),
});
const validateIntakeSchema = ajv.compile(intakeSchema);
const evidence = await readJson(path.join(root, "hardware/evt0/evidence-sources.json"));
const evidenceIds = new Set(evidence.sources.map((source) => source.id));
const purchasePlan = await readFile(path.join(root, "hardware/evt0/purchase-plan.csv"), "utf8");
const productSlice = await readFile(path.join(root, "docs/product-slice-evt0.md"), "utf8");
const productTask = await readFile(path.join(root, "docs/codex/tasks/system-product-rd/active-task.md"), "utf8");

const criticalFields = {
  "benchmark-product": [
    "brand", "productModel", "sku", "packageBarcode", "productionBatch", "firmwareVersion",
    "includedCodeMedia", "storageCapacity", "length", "mainDiameter", "weight", "buttonLayout",
    "statusFeedback", "chargingPort",
  ],
  "board-oid-kit": [
    "vendor", "boardMpn", "pcbRev", "headMpn", "headRev", "firmwareVersion", "mcu", "storage",
    "audioPath", "powerPath", "usbData", "eventInterface", "timestampObservability", "codeTool",
    "printProfile", "buildCli", "flashCli", "supplyEvidence", "boardDimensions", "headMechanical",
    "firmwareOwnership", "rustExecutionRoute", "rustTargetTriple", "rustToolchain", "halOrOs",
    "cAbiContract", "ffiConcurrencyContract", "nativeRustPeripheralReach", "unsafeBoundaryPolicy",
    "providerOwnership", "abiLayoutProbe", "oidQueueEvidence", "audioTimestampClass",
    "storageDurabilityContract", "transportStreamContract",
  ],
};

const criticalTests = {
  "benchmark-product": [
    "BENCH-IDENTITY", "BENCH-OFFLINE", "BENCH-LATENCY", "BENCH-FEEDBACK",
    "BENCH-CONTROLS", "BENCH-ACOUSTIC", "BENCH-ENDURANCE",
  ],
  "board-oid-kit": [
    "KIT-IDENTITY", "KIT-POWER", "KIT-24CODE", "KIT-NEGATIVE", "KIT-OFFLINE",
    "KIT-TOOLCHAIN", "KIT-C-REFERENCE", "KIT-RUST-BOOT", "KIT-RUST-PERIPHERALS",
    "KIT-ABI-LAYOUT", "KIT-PROVIDER-OWNERSHIP", "KIT-QUEUE-OVERFLOW", "KIT-AUDIO-TIMESTAMP",
    "KIT-STORAGE-POWERLOSS", "KIT-TRANSPORT-STREAM",
    "KIT-DEVICELINK-TRANSACTION",
    "KIT-C-RUST-DIFF", "KIT-RUST-REPRO", "KIT-LATENCY", "KIT-SUPPLY",
  ],
};

function hasResolvedTestEvidence(test) {
  if (test.status === "PASS") {
    return test.result !== null && Array.isArray(test.artifactRefs) && test.artifactRefs.length > 0;
  }
  return test.status === "NOT_APPLICABLE" && test.result !== null;
}

const sampleTupleMap = {
  BOARD_MPN: "boardMpn",
  PCB_REV: "pcbRev",
  HEAD_MPN: "headMpn",
  HEAD_REV: "headRev",
  FW_VERSION: "firmwareVersion",
};

function hasCompleteMatchingSamples(document) {
  if (document.intakeKind !== "board-oid-kit") return false;
  const samples = document.identity?.samples ?? [];
  if (samples.length !== document.identity.sampleCountExpected || samples.length < 2) return false;
  const serials = samples.map((sample) => sample.serialNumber);
  if (serials.some((serial) => typeof serial !== "string" || serial.length === 0)) return false;
  if (new Set(serials).size !== serials.length) return false;
  return samples.every((sample) => {
    if (!sample.boardIdentityTuple || !Array.isArray(sample.artifacts) || sample.artifacts.length === 0) return false;
    const artifactIds = sample.artifacts.map((artifact) => artifact.id);
    if (new Set(artifactIds).size !== artifactIds.length || sample.artifactRefs.length === 0) return false;
    if (!sample.artifactRefs.every((ref) => artifactIds.includes(ref))) return false;
    return Object.entries(sampleTupleMap).every(([tupleKey, observationKey]) => {
      const expected = document.observations?.[observationKey]?.value;
      return typeof sample.boardIdentityTuple[tupleKey] === "string" &&
        sample.boardIdentityTuple[tupleKey].length > 0 && sample.boardIdentityTuple[tupleKey] === expected;
    });
  });
}

function isAcceptedBoardEvidence(document) {
  const fields = criticalFields["board-oid-kit"];
  return document.identity?.purchasePlanItemId === "MB1" &&
    document.intakeKind === "board-oid-kit" &&
    document.disposition?.status === "ACCEPTED_BOARD_TARGET" &&
    hasCompleteMatchingSamples(document) &&
    fields.every((name) => document.observations[name]?.state !== "PENDING") &&
    document.tests.every(hasResolvedTestEvidence) &&
    document.blockers.length === 0;
}

function validateDocument(document, relativePath, isTemplate) {
  const prefix = `${relativePath}`;
  const schemaValid = validateIntakeSchema(document);
  check(
    `${prefix} JSON Schema`,
    schemaValid,
    schemaValid ? "valid" : ajv.errorsText(validateIntakeSchema.errors),
  );
  check(`${prefix} contract version`, document.schemaVersion === 1, `schemaVersion=${document.schemaVersion}`);
  check(`${prefix} kind`, Object.hasOwn(criticalFields, document.intakeKind), `intakeKind=${document.intakeKind}`);
  check(`${prefix} purchase-plan item`, purchasePlan.includes(`\n${document.identity.purchasePlanItemId},`) || purchasePlan.startsWith(`${document.identity.purchasePlanItemId},`), document.identity.purchasePlanItemId);
  check(`${prefix} candidate ID`, typeof document.identity.candidateId === "string" && document.identity.candidateId.length > 0, String(document.identity.candidateId));
  check(`${prefix} sample count`, Number.isInteger(document.identity.sampleCountExpected) && document.identity.sampleCountExpected >= 1, `expected=${document.identity.sampleCountExpected}`);
  check(`${prefix} sample records`, Array.isArray(document.identity.samples), `samples=${document.identity.samples?.length ?? "missing"}`);
  for (const sample of document.identity.samples ?? []) {
    const artifactIds = (sample.artifacts ?? []).map((artifact) => artifact.id);
    check(`${prefix} sample ${sample.sampleId} artifact IDs`, new Set(artifactIds).size === artifactIds.length, "artifact IDs must be unique per sample");
    check(`${prefix} sample ${sample.sampleId} artifact refs`, (sample.artifactRefs ?? []).every((ref) => artifactIds.includes(ref)), "artifactRefs must name sample artifacts");
  }

  if (isTemplate) {
    check(`${prefix} template timestamp`, document.recordedAt === null, "template recordedAt must be null");
    check(`${prefix} template samples`, document.identity.samples.length === 0, "template must not claim received samples");
    check(`${prefix} template disposition`, document.disposition.status === "PENDING", `status=${document.disposition.status}`);
  } else {
    check(`${prefix} record timestamp`, typeof document.recordedAt === "string" && !Number.isNaN(Date.parse(document.recordedAt)), `recordedAt=${document.recordedAt}`);
  }

  const fields = criticalFields[document.intakeKind] ?? [];
  for (const fieldName of fields) {
    const field = document.observations?.[fieldName];
    check(`${prefix} observation ${fieldName}`, Boolean(field), "required evidence field is missing");
  }
  for (const [fieldName, field] of Object.entries(document.observations ?? {})) {
    check(`${prefix} state ${fieldName}`, ["PENDING", "VENDOR_DOCUMENT", "OBSERVED", "MEASURED"].includes(field.state), `state=${field.state}`);
    if (isTemplate) {
      check(`${prefix} pending ${fieldName}`, field.state === "PENDING" && field.value === null, "template fields must be PENDING + null");
    } else if (field.state !== "PENDING") {
      check(
        `${prefix} evidence ${fieldName}`,
        field.value !== null && [...(field.evidenceRefs ?? []), ...(field.artifactRefs ?? [])].length > 0,
        "non-pending evidence needs a value and source/artifact",
      );
    }
    for (const sourceId of field.evidenceRefs ?? []) {
      check(`${prefix} source ${fieldName}/${sourceId}`, evidenceIds.has(sourceId), "unknown evidence source ID");
    }
  }

  const testIds = document.tests.map((test) => test.id);
  check(`${prefix} unique tests`, new Set(testIds).size === testIds.length, "test IDs must be unique");
  check(
    `${prefix} required tests`,
    criticalTests[document.intakeKind].every((id) => testIds.includes(id)),
    `required=${criticalTests[document.intakeKind].join("|")}`,
  );
  if (isTemplate) {
    check(`${prefix} pending tests`, document.tests.every((test) => test.status === "PENDING" && test.result === null), "template tests must be PENDING + null");
  }

  check(`${prefix} blockers type`, Array.isArray(document.blockers), "blockers must be an array");
  if (document.disposition.status === "PENDING") {
    check(`${prefix} pending blockers`, document.blockers.length > 0, "pending intake requires explicit blockers");
  }
  for (const requirement of document.requirements ?? []) {
    const owner = requirement.startsWith("PS-") ? productSlice : productTask;
    check(`${prefix} requirement ${requirement}`, owner.includes(requirement), "requirement ID missing from owner document");
  }

  const sensitiveNames = Object.keys(document.observations ?? {}).filter((name) => /password|secret|token|credential/i.test(name));
  check(`${prefix} secret exclusion`, sensitiveNames.length === 0, `sensitive fields=${sensitiveNames.join("|") || "none"}`);

  if (document.disposition.status === "ACCEPTED_BOARD_TARGET") {
    check(`${prefix} accepted kind`, document.intakeKind === "board-oid-kit", "only a board/OID kit can become BOARD_TARGET");
    check(`${prefix} accepted sample evidence`, hasCompleteMatchingSamples(document), "two samples need unique serials, matching per-sample tuples and hashed artifacts");
    check(`${prefix} accepted observations`, fields.every((name) => document.observations[name]?.state !== "PENDING"), "critical evidence remains pending");
    check(`${prefix} accepted tests`, document.tests.every((test) => ["PASS", "NOT_APPLICABLE"].includes(test.status)), "all tests must be resolved");
    check(`${prefix} accepted test evidence`, document.tests.every(hasResolvedTestEvidence), "PASS needs a result and raw artifact; NOT_APPLICABLE needs a recorded reason");
    check(`${prefix} accepted blockers`, document.blockers.length === 0, "accepted intake must have zero blockers");
  }
}

const templateFiles = ["benchmark-product.template.json", "board-oid-kit.template.json"];
const templateDocuments = new Map();
for (const file of templateFiles) {
  const document = await readJson(path.join(intakeRoot, file));
  templateDocuments.set(file, document);
  validateDocument(document, file, true);
}
const sampleRecordTemplate = await readJson(path.join(intakeRoot, "sample-record.template.json"));
check("sample template ID", typeof sampleRecordTemplate.sampleId === "string" && sampleRecordTemplate.sampleId.length > 0, String(sampleRecordTemplate.sampleId));
check("sample template serial/lot", sampleRecordTemplate.serialNumber === null && sampleRecordTemplate.lot === null, "template identity must be null");
check("sample template tuple", Object.keys(sampleTupleMap).every((key) => sampleRecordTemplate.boardIdentityTuple?.[key] === null), "template tuple must be complete and null");
check("sample template artifacts", Array.isArray(sampleRecordTemplate.artifacts) && sampleRecordTemplate.artifacts.length === 0, "template artifacts must be empty");
check("sample template refs", Array.isArray(sampleRecordTemplate.artifactRefs) && sampleRecordTemplate.artifactRefs.length === 0, "template artifactRefs must be empty");
check(
  "physical evidence gate rejects pending MB1 template",
  !isAcceptedBoardEvidence(templateDocuments.get("board-oid-kit.template.json")),
  "a pending MB1 template must not satisfy BOARD_TARGET",
);

const syntheticAccepted = structuredClone(templateDocuments.get("board-oid-kit.template.json"));
syntheticAccepted.recordedAt = "2026-08-04T00:00:00Z";
for (const [name, field] of Object.entries(syntheticAccepted.observations)) {
  field.state = "VENDOR_DOCUMENT";
  field.value = `SYNTHETIC-${name}`;
  field.evidenceRefs = ["SRC-OID-001"];
}
for (const test of syntheticAccepted.tests) {
  test.status = "PASS";
  test.result = { synthetic: true };
  test.artifactRefs = [`SYNTHETIC-${test.id}`];
}
syntheticAccepted.identity.samples = ["A", "B"].map((suffix) => ({
  sampleId: `SAMPLE-${suffix}`,
  serialNumber: `SERIAL-${suffix}`,
  lot: "LOT-1",
  boardIdentityTuple: Object.fromEntries(Object.entries(sampleTupleMap).map(([tupleKey, observationKey]) => [tupleKey, syntheticAccepted.observations[observationKey].value])),
  artifacts: [{
    id: `PHOTO-${suffix}`,
    path: `build/intake/synthetic-${suffix}.png`,
    bytes: 1,
    sha256: "0".repeat(64),
    mediaType: "image/png",
  }],
  artifactRefs: [`PHOTO-${suffix}`],
}));
syntheticAccepted.disposition = { status: "ACCEPTED_BOARD_TARGET", reason: "synthetic gate vector" };
syntheticAccepted.blockers = [];
check("positive physical gate accepts complete synthetic samples", isAcceptedBoardEvidence(syntheticAccepted), "complete matching synthetic samples must pass");

const mixedRevision = structuredClone(syntheticAccepted);
mixedRevision.identity.samples[1].boardIdentityTuple.PCB_REV = "SYNTHETIC-MISMATCH";
check("negative physical gate rejects mixed revisions", !isAcceptedBoardEvidence(mixedRevision), "sample tuples must match global identity");

const duplicateSerial = structuredClone(syntheticAccepted);
duplicateSerial.identity.samples[1].serialNumber = duplicateSerial.identity.samples[0].serialNumber;
check("negative physical gate rejects duplicate serials", !isAcceptedBoardEvidence(duplicateSerial), "sample serials must be unique");

const missingSampleArtifact = structuredClone(syntheticAccepted);
missingSampleArtifact.identity.samples[1].artifactRefs = [];
check("negative physical gate rejects missing sample artifacts", !isAcceptedBoardEvidence(missingSampleArtifact), "each sample needs referenced hashed artifacts");

const recordsDirectory = path.join(intakeRoot, "records");
let recordFiles = [];
try {
  if ((await stat(recordsDirectory)).isDirectory()) {
    recordFiles = (await readdir(recordsDirectory)).filter((file) => file.endsWith(".json")).sort();
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const recordDocuments = [];
for (const file of recordFiles) {
  const document = await readJson(path.join(recordsDirectory, file));
  recordDocuments.push({ file, document });
  validateDocument(document, `records/${file}`, false);
}
if (recordFiles.length === 0) warnings.push("No physical sample intake records exist yet; templates are ready for REF/MB1 arrivals");

const acceptedMb1Records = recordDocuments.filter(({ document }) => isAcceptedBoardEvidence(document));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  templatesValid: errors.length === 0,
  physicalRecordCount: recordFiles.length,
  physicalEvidenceComplete: acceptedMb1Records.length > 0 && errors.length === 0,
  acceptedBoardTargetRecords: acceptedMb1Records.map(({ file }) => file),
  checkSummary: {
    total: checks.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length,
  },
  warnings,
  errors,
  checks,
};

await mkdir(path.join(root, "build"), { recursive: true });
await writeFile(path.join(root, "build/evt0-intake-validation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`EVT-0 intake templates valid: ${report.templatesValid}`);
console.log(`Checks: ${report.checkSummary.passed}/${report.checkSummary.total} passed`);
console.log(`Physical sample records: ${report.physicalRecordCount}`);
if (warnings.length) console.log(`Warnings: ${warnings.join(" | ")}`);
console.log(`Report: ${path.join(root, "build/evt0-intake-validation.json")}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
