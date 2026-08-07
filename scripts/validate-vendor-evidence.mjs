import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const evidenceRoot = path.join(root, "hardware", "evt0", "vendor-evidence-v1");
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

function exactSet(values, expected) {
  return values.length === expected.length && new Set(values).size === expected.length &&
    expected.every((value) => values.includes(value));
}

const schema = await readJson(path.join(evidenceRoot, "schema.json"));
const template = await readJson(path.join(evidenceRoot, "candidate.template.json"));
const sourceLedger = await readJson(path.join(root, "hardware", "evt0", "evidence-sources.json"));
const sourceIds = new Set(sourceLedger.sources.map((source) => source.id));
const expectedAnswerIds = Array.from({ length: 8 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`);
const expectedAttachmentIds = Array.from({ length: 10 }, (_, index) => `A${String(index + 1).padStart(2, "0")}`);
const tupleKeys = ["BOARD_MPN", "PCB_REV", "HEAD_MPN", "HEAD_REV", "FW_VERSION"];

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)),
});
const validateSchema = ajv.compile(schema);

function artifactMap(document) {
  return new Map(document.rawArtifacts.map((artifact) => [artifact.id, artifact]));
}

function referencedArtifactsExist(document, refs, prefix) {
  const known = artifactMap(document);
  for (const ref of refs) check(`${prefix} artifact ${ref}`, known.has(ref), "artifactRef must name rawArtifacts.id");
  return refs.every((ref) => known.has(ref));
}

function isReadyToBuy(document) {
  const tupleReady = tupleKeys.every((key) => {
    const field = document.identityTuple[key];
    return field.state === "PROVIDED" && typeof field.value === "string" && field.value.length > 0 && field.artifactRefs.length > 0;
  });
  const answersReady = exactSet(document.answers.map((answer) => answer.id), expectedAnswerIds) &&
    document.answers.every((answer) => answer.state === "ANSWERED" && typeof answer.answer === "string" && answer.answer.length > 0 && answer.artifactRefs.length > 0);
  const attachmentsReady = exactSet(document.attachments.map((attachment) => attachment.id), expectedAttachmentIds) &&
    document.attachments.every((attachment) => attachment.state === "RECEIVED" && attachment.artifactRefs.length > 0);
  const sampleOffersReady = document.sampleOffers.length === 2 && document.sampleOffers.every((sample) =>
    tupleKeys.every((key) => typeof sample[key] === "string" && sample[key] === document.identityTuple[key].value) && sample.artifactRefs.length > 0);
  return document.decision.status === "READY_TO_BUY" && document.decision.blockers.length === 0 &&
    typeof document.vendorName === "string" && document.vendorName.length > 0 &&
    typeof document.receivedAt === "string" && !Number.isNaN(Date.parse(document.receivedAt)) &&
    typeof document.channel === "string" && document.channel.length > 0 && document.rawArtifacts.length > 0 &&
    tupleReady && answersReady && attachmentsReady && sampleOffersReady &&
    document.targetBindingEffect === "NONE_VENDOR_CLAIM_ONLY";
}

function validateDocument(document, relativePath, isTemplate) {
  const schemaValid = validateSchema(document);
  check(`${relativePath} JSON Schema`, schemaValid, schemaValid ? "valid" : ajv.errorsText(validateSchema.errors));
  check(`${relativePath} answer IDs`, exactSet(document.answers.map((answer) => answer.id), expectedAnswerIds), "must contain M01-M08 exactly once");
  check(`${relativePath} attachment IDs`, exactSet(document.attachments.map((attachment) => attachment.id), expectedAttachmentIds), "must contain A01-A10 exactly once");
  check(`${relativePath} sample IDs`, new Set(document.sampleOffers.map((sample) => sample.sampleId)).size === 2, "two unique sample IDs required");
  check(`${relativePath} target effect`, document.targetBindingEffect === "NONE_VENDOR_CLAIM_ONLY", document.targetBindingEffect);
  check(`${relativePath} artifact IDs`, new Set(document.rawArtifacts.map((artifact) => artifact.id)).size === document.rawArtifacts.length, "raw artifact IDs must be unique");
  for (const sourceRef of document.sourceRefs) check(`${relativePath} source ${sourceRef}`, sourceIds.has(sourceRef), "unknown evidence source ID");
  for (const [key, field] of Object.entries(document.identityTuple)) {
    if (field.state !== "PENDING") referencedArtifactsExist(document, field.artifactRefs, `${relativePath} identity ${key}`);
  }
  for (const answer of document.answers) {
    if (answer.state !== "PENDING") referencedArtifactsExist(document, answer.artifactRefs, `${relativePath} answer ${answer.id}`);
  }
  for (const attachment of document.attachments) {
    if (attachment.state !== "PENDING") referencedArtifactsExist(document, attachment.artifactRefs, `${relativePath} attachment ${attachment.id}`);
  }
  for (const sample of document.sampleOffers) {
    if (sample.artifactRefs.length > 0) referencedArtifactsExist(document, sample.artifactRefs, `${relativePath} sample ${sample.sampleId}`);
  }

  if (isTemplate) {
    check(`${relativePath} timestamp`, document.receivedAt === null, "template receivedAt must be null");
    check(`${relativePath} artifacts`, document.rawArtifacts.length === 0, "template must not claim raw artifacts");
    check(`${relativePath} identity pending`, tupleKeys.every((key) => document.identityTuple[key].state === "PENDING" && document.identityTuple[key].value === null), "template tuple must be PENDING + null");
    check(`${relativePath} answers pending`, document.answers.every((answer) => answer.state === "PENDING" && answer.answer === null), "template answers must be PENDING + null");
    check(`${relativePath} attachments pending`, document.attachments.every((attachment) => attachment.state === "PENDING"), "template attachments must be PENDING");
    check(`${relativePath} sample offers pending`, document.sampleOffers.every((sample) => tupleKeys.every((key) => sample[key] === null)), "template samples must have null tuple values");
    check(`${relativePath} decision`, document.decision.status === "EVIDENCE_REQUIRED" && document.decision.blockers.length > 0, "template must remain blocked");
    check(`${relativePath} not ready`, !isReadyToBuy(document), "template must not pass the payment gate");
  } else if (document.decision.status === "READY_TO_BUY") {
    check(`${relativePath} payment gate`, isReadyToBuy(document), "READY_TO_BUY requires complete answers, attachments and two matching sample offers");
  }
}

validateDocument(template, "candidate.template.json", true);

const forged = structuredClone(template);
forged.decision = { status: "READY_TO_BUY", reason: "forged", blockers: [] };
check("negative gate rejects status-only promotion", !isReadyToBuy(forged), "status alone must not pass");

const syntheticComplete = structuredClone(template);
syntheticComplete.vendorName = "SYNTHETIC_VENDOR";
syntheticComplete.receivedAt = "2026-08-04T00:00:00Z";
syntheticComplete.channel = "synthetic-test";
syntheticComplete.rawArtifacts = [{
  id: "ART-001",
  path: "build/vendor-evidence/SYNTHETIC/raw/evidence.pdf",
  bytes: 1,
  sha256: "0".repeat(64),
  mediaType: "application/pdf",
}];
for (const [index, key] of tupleKeys.entries()) {
  syntheticComplete.identityTuple[key] = {
    state: "PROVIDED",
    value: `SYNTHETIC-${index + 1}`,
    artifactRefs: ["ART-001"],
    notes: null,
  };
}
for (const answer of syntheticComplete.answers) {
  answer.state = "ANSWERED";
  answer.answer = "SYNTHETIC_ANSWER";
  answer.artifactRefs = ["ART-001"];
}
for (const attachment of syntheticComplete.attachments) {
  attachment.state = "RECEIVED";
  attachment.artifactRefs = ["ART-001"];
}
for (const sample of syntheticComplete.sampleOffers) {
  for (const key of tupleKeys) sample[key] = syntheticComplete.identityTuple[key].value;
  sample.artifactRefs = ["ART-001"];
}
syntheticComplete.decision = { status: "READY_TO_BUY", reason: "synthetic gate vector", blockers: [] };
check("positive gate accepts complete synthetic response", isReadyToBuy(syntheticComplete), "complete synthetic vector must pass the payment gate");

const mismatchedSamples = structuredClone(syntheticComplete);
mismatchedSamples.sampleOffers[1].PCB_REV = "SYNTHETIC-MISMATCH";
check("negative gate rejects mixed revisions", !isReadyToBuy(mismatchedSamples), "two sample offers must carry the same tuple");

const missingAttachment = structuredClone(syntheticComplete);
missingAttachment.attachments[9].state = "PENDING";
missingAttachment.attachments[9].artifactRefs = [];
check("negative gate rejects missing attachment", !isReadyToBuy(missingAttachment), "A01-A10 must all be received");

const recordsDirectory = path.join(evidenceRoot, "records");
let recordFiles = [];
try {
  if ((await stat(recordsDirectory)).isDirectory()) {
    recordFiles = (await readdir(recordsDirectory)).filter((file) => file.endsWith(".json")).sort();
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const readyToBuyCandidates = [];
for (const file of recordFiles) {
  const document = await readJson(path.join(recordsDirectory, file));
  validateDocument(document, `records/${file}`, false);
  if (isReadyToBuy(document)) readyToBuyCandidates.push(document.candidateId);
}
if (recordFiles.length === 0) warnings.push("No supplier response records exist yet; READY_TO_BUY candidates remain zero");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  valid: errors.length === 0,
  templateCount: 1,
  responseRecordCount: recordFiles.length,
  readyToBuyCandidates,
  acceptedBoardTargetCandidates: [],
  checkSummary: {
    total: checks.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length
  },
  warnings,
  errors,
  checks
};

await mkdir(path.join(root, "build"), { recursive: true });
await writeFile(path.join(root, "build", "vendor-evidence-validation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Vendor Evidence v1 valid: ${report.valid}`);
console.log(`Checks: ${report.checkSummary.passed}/${report.checkSummary.total} passed`);
console.log(`Response records: ${report.responseRecordCount}; READY_TO_BUY: ${report.readyToBuyCandidates.length}; accepted BOARD_TARGET: 0`);
if (warnings.length) console.log(`Warnings: ${warnings.join(" | ")}`);
console.log(`Report: ${path.join(root, "build", "vendor-evidence-validation.json")}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
