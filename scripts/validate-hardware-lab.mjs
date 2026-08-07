import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const labRoot = path.join(root, "hardware", "evt0", "lab-v1");
const reportPath = path.join(root, "build", "hardware-lab-validation.json");
const errors = [];
const warnings = [];
const checks = [];

function check(condition, message, detail = null) {
  checks.push({ message, status: condition ? "PASS" : "FAIL", detail });
  if (!condition) errors.push(detail ? `${message}: ${detail}` : message);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    errors.push(`${path.relative(root, file)}: ${error.message}`);
    return null;
  }
}

function unique(values, label) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  check(duplicates.length === 0, `${label} contains duplicate IDs`, [...new Set(duplicates)].join(", "));
}

function exactSet(values, expected) {
  return values.length === expected.length && new Set(values).size === expected.length &&
    expected.every((value) => values.includes(value));
}

const schema = await readJson(path.join(labRoot, "instrument-registry.schema.json"));
const catalog = await readJson(path.join(labRoot, "method-catalog.json"));
const registryTemplate = await readJson(path.join(labRoot, "instrument-registry.template.json"));
const session = await readJson(path.join(labRoot, "session.template.json"));
const capturePlan = await readJson(path.join(labRoot, "registration-capture-plan.json"));

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)),
});
const validateRegistrySchema = ajv.compile(schema);

const slotContract = Object.fromEntries((capturePlan?.slots ?? []).map((slot) => [slot.id, {
  purchasePlanItemId: slot.purchasePlanItemId,
  kinds: slot.assets.map((asset) => asset.assetKind),
}]));
const expectedInstrumentIds = Object.keys(slotContract);
const stableInstrumentIds = ["PSU-01", "DMM-01", "MECH-01", "MACRO-01", "USBPWR-01", "SPL-01"];
const stableAssetKinds = [
  "BENCH_SUPPLY", "MULTIMETER", "CALIPER", "SCALE", "MACRO_CAMERA", "USB_C_POWER_METER", "SOUND_LEVEL_METER",
];

function normalizedRepositoryPath(declaredPath) {
  if (typeof declaredPath !== "string" || declaredPath.length === 0) return null;
  const absolute = path.resolve(root, declaredPath);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.replaceAll("\\", "/");
}

function schemaErrors(document) {
  const valid = validateRegistrySchema(document);
  if (valid) return [];
  return (validateRegistrySchema.errors ?? []).map((error) =>
    `${error.instancePath || "/"} ${error.message}`
  );
}

function recordBindingIssues(recordFile, document, seenIds) {
  const issues = [];
  if (document.registryId === registryTemplate.registryId) issues.push("reserved template registryId");
  if (path.basename(recordFile, ".json") !== document.registryId) issues.push("filename must equal registryId.json");
  if (seenIds.has(document.registryId)) issues.push("registryId must be unique");
  return issues;
}

async function evaluateRegistry(document, { verifyArtifacts }) {
  const issues = [...schemaErrors(document)];
  if (issues.length > 0) return issues;

  const slots = document.instruments;
  const slotIds = slots.map((slot) => slot.id);
  if (!exactSet(slotIds, expectedInstrumentIds)) {
    issues.push("registry must contain exactly PSU-01/DMM-01/MECH-01/MACRO-01/USBPWR-01/SPL-01");
  }

  const allAssetIds = [];
  const allSerials = [];
  for (const slot of slots) {
    const contract = slotContract[slot.id];
    if (!contract) continue;
    if (slot.purchasePlanItemId !== contract.purchasePlanItemId) {
      issues.push(`${slot.id}: purchase plan mapping must be ${contract.purchasePlanItemId}`);
    }

    const assetKinds = slot.assets.map((asset) => asset.assetKind);
    for (const assetKind of assetKinds) {
      if (!contract.kinds.includes(assetKind)) issues.push(`${slot.id}: asset kind ${assetKind} belongs to another slot`);
    }
    if (slot.disposition === "QUALIFIED") {
      for (const requiredKind of contract.kinds) {
        if (!assetKinds.includes(requiredKind)) issues.push(`${slot.id}: missing required asset kind ${requiredKind}`);
      }
      if (!slot.assets.every((asset) => asset.disposition === "QUALIFIED")) {
        issues.push(`${slot.id}: a qualified slot may contain only qualified assets`);
      }
      if (slot.blockers.length !== 0) issues.push(`${slot.id}: qualified slot must have no blockers`);
    } else if (slot.blockers.length === 0) {
      issues.push(`${slot.id}: non-qualified slot must state blockers`);
    }

    for (const asset of slot.assets) {
      allAssetIds.push(asset.assetId);
      if (asset.serial) allSerials.push(asset.serial);
      const artifacts = new Map(asset.artifacts.map((artifact) => [artifact.id, artifact]));
      if (artifacts.size !== asset.artifacts.length) issues.push(`${asset.assetId}: artifact IDs must be unique`);
      const evidenceRefs = [
        ...asset.identityArtifactRefs,
        ...asset.calibration.artifactRefs,
        ...asset.calibration.referenceArtifactRefs,
      ];
      for (const ref of evidenceRefs) {
        if (!artifacts.has(ref)) issues.push(`${asset.assetId}: artifact ref ${ref} is missing`);
      }

      if (asset.disposition === "QUALIFIED") {
        for (const field of ["manufacturer", "model", "serial"]) {
          if (typeof asset[field] !== "string" || asset[field].trim() === "") {
            issues.push(`${asset.assetId}: ${field} is required for qualification`);
          }
        }
        if (asset.identityArtifactRefs.length === 0) {
          issues.push(`${asset.assetId}: label/nameplate identity evidence is required`);
        }
        if (!asset.serialSource) issues.push(`${asset.assetId}: serialSource is required for qualification`);
        if (asset.calibration.kind === "PENDING" || asset.calibration.status !== "PASS" ||
            !asset.calibration.performedAt || !asset.calibration.procedure ||
            asset.calibration.artifactRefs.length === 0) {
          issues.push(`${asset.assetId}: passing calibration certificate or traceable self-check evidence is required`);
        }
        if (asset.calibration.kind === "TRACEABLE_SELF_CHECK" &&
            asset.calibration.referenceArtifactRefs.length === 0) {
          issues.push(`${asset.assetId}: traceable self-check requires reference-standard evidence`);
        }
        if (asset.identityArtifactRefs.some((ref) => asset.calibration.artifactRefs.includes(ref))) {
          issues.push(`${asset.assetId}: identity and calibration result evidence must be separate artifacts`);
        }
        if (asset.calibration.artifactRefs.some((ref) => asset.calibration.referenceArtifactRefs.includes(ref))) {
          issues.push(`${asset.assetId}: self-check result and reference-standard evidence must be separate artifacts`);
        }
        if (asset.calibration.performedAt && Date.parse(asset.calibration.performedAt) > Date.now()) {
          issues.push(`${asset.assetId}: calibration performedAt may not be in the future`);
        }
        if (asset.calibration.validUntil && Date.parse(asset.calibration.validUntil) <= Date.now()) {
          issues.push(`${asset.assetId}: calibration evidence is expired`);
        }
        if (asset.blockers.length !== 0) issues.push(`${asset.assetId}: qualified asset must have no blockers`);
      } else if (asset.blockers.length === 0) {
        issues.push(`${asset.assetId}: non-qualified asset must state blockers`);
      }

      if (verifyArtifacts) {
        for (const artifact of asset.artifacts) {
          const expectedRegistryPrefix = `build/hardware-lab/instruments/${document.registryId}/raw/`;
          const normalizedPath = normalizedRepositoryPath(artifact.path);
          if (!normalizedPath?.startsWith(expectedRegistryPrefix)) {
            issues.push(`${asset.assetId}: artifact ${artifact.id} must stay under ${expectedRegistryPrefix}`);
            continue;
          }
          const absolutePath = path.join(root, ...normalizedPath.split("/"));
          try {
            const fileStat = await stat(absolutePath);
            const bytes = await readFile(absolutePath);
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            if (!fileStat.isFile() || fileStat.size !== artifact.bytes || sha256 !== artifact.sha256) {
              issues.push(`${asset.assetId}: artifact ${artifact.id} bytes/SHA-256 mismatch`);
            }
          } catch {
            issues.push(`${asset.assetId}: artifact ${artifact.id} file is missing`);
          }
        }
      }
    }
  }

  if (new Set(allAssetIds).size !== allAssetIds.length) issues.push("assetId values must be unique");
  if (new Set(allSerials).size !== allSerials.length) issues.push("instrument serial values must be unique");

  const allQualified = slots.every((slot) => slot.disposition === "QUALIFIED");
  if (document.status === "QUALIFIED") {
    if (!allQualified || !document.recordedAt || !document.operator || document.blockers.length !== 0) {
      issues.push("QUALIFIED registry requires all six slots, recordedAt, operator, and no blockers");
    }
    if (document.recordedAt && Date.parse(document.recordedAt) > Date.now()) {
      issues.push("registry recordedAt may not be in the future");
    }
  } else if (document.status !== "TEMPLATE" && document.blockers.length === 0) {
    issues.push("non-qualified registry must state blockers");
  }
  if (allQualified && document.status !== "QUALIFIED") {
    issues.push("all-qualified slots require registry status QUALIFIED");
  }
  return issues;
}

check(catalog?.schemaVersion === 1, "method catalog schemaVersion must be 1");
check(catalog?.catalogId === "EVT0-LAB-METHODS-V1", "method catalog ID must remain EVT0-LAB-METHODS-V1");
check(Array.isArray(catalog?.methods) && catalog.methods.length >= 1, "method catalog must contain methods");
check(capturePlan?.schemaVersion === 1, "registration capture plan schemaVersion must be 1");
check(capturePlan?.planId === "EVT0-LAB-REGISTRATION-CAPTURE-V1",
  "registration capture plan ID must remain EVT0-LAB-REGISTRATION-CAPTURE-V1");
check(capturePlan?.qualificationEffect === "NONE_PREPARATION_ONLY",
  "registration preparation must have no qualification effect");
check(capturePlan?.serialPolicy === "MANUFACTURER_SERIAL_OR_PHOTOGRAPHED_LOCAL_ASSET_TAG",
  "registration capture plan must preserve the traceability ID policy");
check(expectedInstrumentIds.length === 6,
  "registration capture plan must define exactly six stable instrument slots");
check(exactSet(expectedInstrumentIds, stableInstrumentIds),
  "registration capture plan must preserve PSU/DMM/MECH/MACRO/USBPWR/SPL slots");
check(exactSet(Object.values(slotContract).flatMap((slot) => slot.kinds), stableAssetKinds),
  "registration capture plan must define exactly seven required physical assets");
for (const slot of capturePlan?.slots ?? []) {
  check(typeof slot.role === "string" && slot.role.length > 0,
    `${slot.id}: registration capture role is required`);
  check(/^LAB[1-6]$/u.test(slot.purchasePlanItemId),
    `${slot.id}: registration capture purchase-plan mapping is invalid`);
  for (const asset of slot.assets ?? []) {
    check(Array.isArray(asset.identityEvidence) && asset.identityEvidence.length > 0,
      `${slot.id}/${asset.assetKind}: identity evidence instructions are required`);
    check(Array.isArray(asset.qualificationEvidence) && asset.qualificationEvidence.length > 0,
      `${slot.id}/${asset.assetKind}: qualification evidence instructions are required`);
  }
}
check(registryTemplate?.schemaVersion === 1, "instrument registry template schemaVersion must be 1");
check(registryTemplate?.status === "TEMPLATE", "instrument registry template status must remain TEMPLATE");
check(Array.isArray(registryTemplate?.instruments) && registryTemplate.instruments.length === 6,
  "instrument registry must contain LAB1-LAB6 placeholders");
check(session?.schemaVersion === 1, "session template schemaVersion must be 1");
check(session?.status === "TEMPLATE" && session?.disposition === "PENDING",
  "session template must remain non-evidence PENDING");

const templateIssues = await evaluateRegistry(registryTemplate, { verifyArtifacts: false });
check(templateIssues.length === 0, "instrument registry template must satisfy schema and semantic guards",
  templateIssues.join("; "));
check(registryTemplate?.instruments?.every((slot) => slot.disposition === "PENDING" && slot.assets.length === 0),
  "instrument registry template must not claim inventoried assets");

const instrumentIds = (registryTemplate?.instruments ?? []).map((instrument) => instrument.id);
unique(instrumentIds, "instrument registry");
for (const instrument of registryTemplate?.instruments ?? []) {
  check(/^[A-Z0-9][A-Z0-9-]+$/.test(instrument.id ?? ""), `instrument ID invalid: ${instrument.id}`);
  check(typeof instrument.role === "string" && instrument.role.length > 0, `${instrument.id}: role is required`);
  check(Array.isArray(instrument.assets), `${instrument.id}: assets must be an array`);
}

const methodIds = (catalog?.methods ?? []).map((method) => method.id);
unique(methodIds, "method catalog");
const readinessValues = new Set(["READY_NOW", "WAIT_BOARD_LOCK", "RELEASE_GATE"]);
for (const method of catalog?.methods ?? []) {
  check(/^[A-Z0-9][A-Z0-9-]+$/.test(method.id ?? ""), `method ID invalid: ${method.id}`);
  check(typeof method.title === "string" && method.title.length > 0, `${method.id}: title is required`);
  check(readinessValues.has(method.readiness), `${method.id}: invalid readiness ${method.readiness}`);
  check(typeof method.subject === "string" && method.subject.length > 0, `${method.id}: subject is required`);
  check(Array.isArray(method.requiredInstruments) && method.requiredInstruments.length > 0,
    `${method.id}: requiredInstruments is required`);
  for (const instrumentId of method.requiredInstruments ?? []) {
    check(instrumentIds.includes(instrumentId), `${method.id}: unknown instrument ${instrumentId}`);
  }
  check(Array.isArray(method.procedure) && method.procedure.length > 0, `${method.id}: procedure is required`);
  check(Array.isArray(method.recordFields) && method.recordFields.length > 0, `${method.id}: recordFields is required`);
  check(typeof method.acceptance === "string" && method.acceptance.length > 0, `${method.id}: acceptance is required`);
  check(Array.isArray(method.sourceRefs) && method.sourceRefs.length > 0, `${method.id}: sourceRefs are required`);
}

const recordsDirectory = path.join(labRoot, "records");
const recordFiles = (await readdir(recordsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => path.join(recordsDirectory, entry.name));
let qualifiedRegistries = 0;
const seenRegistryIds = new Set();
for (const recordFile of recordFiles) {
  const record = await readJson(recordFile);
  if (!record) continue;
  const recordIssues = await evaluateRegistry(record, { verifyArtifacts: true });
  check(recordIssues.length === 0, `${path.relative(root, recordFile)} must satisfy instrument evidence gates`,
    recordIssues.join("; "));
  check(record.status !== "TEMPLATE", `${path.relative(root, recordFile)} must not be a template`);
  const bindingIssues = recordBindingIssues(recordFile, record, seenRegistryIds);
  check(bindingIssues.length === 0,
    `${path.relative(root, recordFile)} must bind filename and unique registryId`, bindingIssues.join("; "));
  seenRegistryIds.add(record.registryId);
  if (record.status === "QUALIFIED") qualifiedRegistries += 1;
}

const syntheticRegistryId = "EVT0-LAB-REGISTRY-VALIDATION-VECTOR";
const vectorRoot = path.join(root, "build", "hardware-lab", "instruments", syntheticRegistryId, "raw");
await mkdir(vectorRoot, { recursive: true });
const synthetic = structuredClone(registryTemplate);
synthetic.registryId = syntheticRegistryId;
synthetic.status = "QUALIFIED";
synthetic.recordedAt = "2026-08-03T00:00:00.000Z";
synthetic.operator = "VALIDATOR";
synthetic.blockers = [];

for (const slot of synthetic.instruments) {
  slot.assets = [];
  for (const assetKind of slotContract[slot.id].kinds) {
    const assetId = `${slot.id}-${assetKind.replaceAll("_", "-")}`;
    const fixtureArtifacts = [
      { id: `${assetId}-IDENTITY`, suffix: "identity", content: Buffer.from(`${assetId} identity\n`, "utf8") },
      { id: `${assetId}-SELF-CHECK`, suffix: "self-check", content: Buffer.from(`${assetId} self-check\n`, "utf8") },
      { id: `${assetId}-REFERENCE`, suffix: "reference", content: Buffer.from(`${assetId} reference\n`, "utf8") },
    ].map((artifact) => ({
      ...artifact,
      path: `build/hardware-lab/instruments/${syntheticRegistryId}/raw/${assetId}-${artifact.suffix}.txt`,
    }));
    for (const artifact of fixtureArtifacts) await writeFile(path.join(root, artifact.path), artifact.content);
    slot.assets.push({
      assetId,
      assetKind,
      manufacturer: "SYNTHETIC-MANUFACTURER",
      model: `SYNTHETIC-${assetKind}`,
      serial: `SYNTHETIC-SERIAL-${assetKind}`,
      serialSource: "MANUFACTURER_SERIAL",
      firmwareVersion: null,
      identityArtifactRefs: [`${assetId}-IDENTITY`],
      calibration: {
        kind: "TRACEABLE_SELF_CHECK",
        status: "PASS",
        performedAt: "2026-08-03T00:00:00.000Z",
        validUntil: null,
        procedure: "Synthetic validator vector; not physical evidence.",
        artifactRefs: [`${assetId}-SELF-CHECK`],
        referenceArtifactRefs: [`${assetId}-REFERENCE`],
      },
      artifacts: fixtureArtifacts.map((artifact) => ({
        id: artifact.id,
        path: artifact.path,
        bytes: artifact.content.length,
        sha256: createHash("sha256").update(artifact.content).digest("hex"),
        mediaType: "text/plain",
      })),
      disposition: "QUALIFIED",
      blockers: [],
    });
  }
  slot.disposition = "QUALIFIED";
  slot.blockers = [];
}

const syntheticIssues = await evaluateRegistry(synthetic, { verifyArtifacts: true });
check(syntheticIssues.length === 0, "complete synthetic six-slot registry must be accepted",
  syntheticIssues.join("; "));

const pnpOnly = structuredClone(synthetic);
pnpOnly.instruments[0].assets[0].calibration = {
  kind: "PENDING",
  status: "PENDING",
  performedAt: null,
  validUntil: null,
  procedure: null,
  artifactRefs: [],
  referenceArtifactRefs: [],
};
check((await evaluateRegistry(pnpOnly, { verifyArtifacts: false })).length > 0,
  "PnP/model/serial alone must not qualify an instrument");

const missingMechAsset = structuredClone(synthetic);
missingMechAsset.instruments.find((slot) => slot.id === "MECH-01").assets =
  missingMechAsset.instruments.find((slot) => slot.id === "MECH-01").assets.filter((asset) => asset.assetKind !== "SCALE");
check((await evaluateRegistry(missingMechAsset, { verifyArtifacts: false })).length > 0,
  "MECH-01 must include both caliper and scale assets");

const missingArtifact = structuredClone(synthetic);
missingArtifact.instruments[0].assets[0].artifacts[0].path =
  `build/hardware-lab/instruments/${syntheticRegistryId}/raw/DOES-NOT-EXIST.txt`;
check((await evaluateRegistry(missingArtifact, { verifyArtifacts: true })).length > 0,
  "missing raw identity/calibration artifact must be rejected");

const duplicateSerial = structuredClone(synthetic);
duplicateSerial.instruments[1].assets[0].serial = duplicateSerial.instruments[0].assets[0].serial;
check((await evaluateRegistry(duplicateSerial, { verifyArtifacts: false })).length > 0,
  "duplicate instrument serial must be rejected");

const expiredCalibration = structuredClone(synthetic);
expiredCalibration.instruments[0].assets[0].calibration.validUntil = "2026-08-03T00:00:00.000Z";
check((await evaluateRegistry(expiredCalibration, { verifyArtifacts: false })).length > 0,
  "expired calibration evidence must be rejected");

const wrongSlotKind = structuredClone(synthetic);
wrongSlotKind.instruments[0].assets[0].assetKind = "MULTIMETER";
check((await evaluateRegistry(wrongSlotKind, { verifyArtifacts: false })).length > 0,
  "asset kind assigned to the wrong stable slot must be rejected");

const missingReferenceEvidence = structuredClone(synthetic);
missingReferenceEvidence.instruments[0].assets[0].calibration.referenceArtifactRefs = [];
check((await evaluateRegistry(missingReferenceEvidence, { verifyArtifacts: false })).length > 0,
  "traceable self-check without reference-standard evidence must be rejected");

const crossRegistryPath = structuredClone(synthetic);
crossRegistryPath.instruments[0].assets[0].artifacts[0].path =
  `build/hardware-lab/instruments/${syntheticRegistryId}/raw/..\\..\\OTHER-REGISTRY\\raw\\cross.txt`;
check((await evaluateRegistry(crossRegistryPath, { verifyArtifacts: true })).length > 0,
  "cross-registry artifact traversal must be rejected");

check(recordBindingIssues(path.join(recordsDirectory, "WRONG-NAME.json"), synthetic, new Set()).length > 0,
  "registry filename mismatch must be rejected");
check(recordBindingIssues(path.join(recordsDirectory, `${synthetic.registryId}.json`), synthetic,
  new Set([synthetic.registryId])).length > 0,
  "duplicate registryId must be rejected");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASS" : "FAIL",
  counts: {
    methods: catalog?.methods?.length ?? 0,
    instrumentSlots: registryTemplate?.instruments?.length ?? 0,
    registryRecords: recordFiles.length,
    qualifiedRegistries,
    checks: checks.length,
    errors: errors.length,
    warnings: warnings.length,
  },
  evidenceState: {
    qualificationEffect: "NONE_UNTIL_ALL_REQUIRED_QUALIFIED",
    pnpDiscoveryIsEvidence: false,
    requiredAssetKinds: slotContract,
  },
  errors,
  warnings,
  checks,
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Hardware lab validation: ${report.status}`);
console.log(`Methods: ${report.counts.methods}; slots: ${report.counts.instrumentSlots}; records: ${recordFiles.length}; qualified: ${qualifiedRegistries}; checks: ${report.counts.checks}`);
console.log(`Report: ${path.relative(root, reportPath)}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
}
