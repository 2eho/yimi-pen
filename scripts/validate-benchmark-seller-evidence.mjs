import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const contractRoot = path.join(root, "hardware", "evt0", "benchmark-seller-evidence-v1");
const recordsDirectory = process.env.BENCHMARK_SELLER_EVIDENCE_RECORDS_DIR
  ? path.resolve(root, process.env.BENCHMARK_SELLER_EVIDENCE_RECORDS_DIR)
  : path.join(contractRoot, "records");
const reportPath = process.env.BENCHMARK_SELLER_EVIDENCE_REPORT_PATH
  ? path.resolve(root, process.env.BENCHMARK_SELLER_EVIDENCE_REPORT_PATH)
  : path.join(root, "build", "benchmark-seller-evidence-validation.json");

const checks = [];
const errors = [];
const warnings = [];

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
  if (!passed) errors.push(`${name}: ${detail}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function validDateTime(value) {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function notFuture(value) {
  return validDateTime(value) && Date.parse(value) <= Date.now() + 5 * 60 * 1000;
}

function sameStrings(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function normalizedRepositoryPath(declaredPath) {
  if (typeof declaredPath !== "string" || declaredPath.length === 0 || declaredPath.includes("\\")) return null;
  const absolute = path.resolve(root, declaredPath);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.replaceAll("\\", "/");
}

function expectedWorkspacePrefix(document) {
  return `build/benchmark-seller-evidence/${document.recordId}/`;
}

function artifactMap(document) {
  return new Map(document.rawArtifacts.map((artifact) => [artifact.id, artifact]));
}

function refsKnown(document, refs) {
  const known = artifactMap(document);
  return refs.every((ref) => known.has(ref));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function profileFor(document, profileById) {
  return profileById.get(document.profileId);
}

function completeForHumanReview(document, profileById) {
  const profile = profileFor(document, profileById);
  if (!profile) return false;
  const results = new Map(document.requirementResults.map((result) => [result.id, result]));
  const artifacts = artifactMap(document);
  const identity = document.observedIdentity;
  const requiredIdentityStrings = [
    identity.listingUrl,
    identity.sellerOrderSku,
    identity.skuRelation,
    identity.sellerName,
    identity.fulfilmentParty,
    identity.stockStatement,
    identity.productGeneration,
    identity.packageBarcode,
    identity.productionLotOrDate,
    identity.deviceModel,
    identity.serialPrefix,
    identity.serialSuffix,
    identity.bootVersionDisplay,
    identity.bundleCapacityLabel,
  ];
  const allRequirementRefs = profile.requirements.flatMap((requirement) => results.get(requirement.id)?.artifactRefs ?? []);
  const preparedMs = Date.parse(document.preparedAt);
  const sentMs = Date.parse(document.request.sentAt);
  const receivedMs = Date.parse(document.response.receivedAt);
  const reviewedMs = Date.parse(document.review.reviewedAt);
  return document.request.state === "SENT" &&
    notFuture(document.preparedAt) &&
    notFuture(document.request.sentAt) &&
    nonEmptyString(document.request.channel) &&
    nonEmptyString(document.request.sellerEndpoint) &&
    nonEmptyString(document.request.transportReference) &&
    document.request.artifactRefs.length > 0 &&
    document.request.artifactRefs.some((ref) => artifacts.get(ref)?.kind === "REQUEST_EXPORT") &&
    document.response.state === "RECEIVED" &&
    notFuture(document.response.receivedAt) &&
    nonEmptyString(document.response.senderIdentity) &&
    document.response.artifactRefs.length > 0 &&
    document.response.artifactRefs.some((ref) => ["SELLER_CHAT_EXPORT", "SELLER_CONFIRMATION_EXPORT"].includes(artifacts.get(ref)?.kind)) &&
    profile.requirements.every((requirement) => results.get(requirement.id)?.status === "PASS") &&
    profile.requirements.every((requirement) => (results.get(requirement.id)?.artifactRefs.length ?? 0) >= requirement.minArtifactRefs) &&
    allRequirementRefs.every((ref) => document.response.artifactRefs.includes(ref)) &&
    requiredIdentityStrings.every(nonEmptyString) &&
    identity.includedReadableMedia.length > 0 &&
    identity.productGeneration === profile.requestedIdentity.productGeneration &&
    identity.bundleCapacityLabel === profile.requestedIdentity.bundleCapacityLabel &&
    identity.skuRelation.includes(profile.requestedIdentity.sourceOrderSku) &&
    notFuture(document.review.reviewedAt) &&
    nonEmptyString(document.review.reviewer) &&
    preparedMs <= sentMs && sentMs <= receivedMs && receivedMs <= reviewedMs &&
    document.decision.blockers.length === 0;
}

for (const [label, target] of [["records", recordsDirectory], ["report", reportPath]]) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} override must stay inside repository root: ${target}`);
  }
}

const [schema, template, catalog, evidenceLedger] = await Promise.all([
  readJson(path.join(contractRoot, "schema.json")),
  readJson(path.join(contractRoot, "record.template.json")),
  readJson(path.join(contractRoot, "gate-catalog.json")),
  readJson(path.join(root, "hardware", "evt0", "evidence-sources.json")),
]);

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);
const sourceById = new Map(evidenceLedger.sources.map((source) => [source.id, source]));
const profileById = new Map(catalog.profiles.map((profile) => [profile.profileId, profile]));

check("catalog identity", catalog.schemaVersion === 1 && catalog.catalogId === "BENCHMARK-SELLER-EVIDENCE-GATES-V1", "unexpected catalog identity");
check("catalog effects", catalog.targetBindingEffect === "NONE_BENCHMARK_ONLY" && catalog.adapterEffect === "NONE" && catalog.releaseGateEffect === "NONE" && catalog.purchaseAuthorizationEffect === "NONE_HUMAN_DECISION_REQUIRED" && catalog.intakeEffect === "NONE_UNTIL_RECEIVED_UNIT", "catalog must not create target, adapter, release, payment or intake facts");
check("catalog profile IDs unique", unique(catalog.profiles.map((profile) => profile.profileId)), "duplicate profileId");

for (const profile of catalog.profiles) {
  const prefix = `profile ${profile.profileId}`;
  check(`${prefix} purchase item`, /^REF[0-9]+$/u.test(profile.purchasePlanItemId), "profile must bind a benchmark purchase-plan item");
  check(`${prefix} source set`, sameStrings(profile.sourceRefs, profile.sourceBaselines.map((baseline) => baseline.id)), "sourceRefs must equal source baseline IDs");
  check(`${prefix} requirement IDs unique`, unique(profile.requirements.map((requirement) => requirement.id)), "duplicate requirement ID");
  check(`${prefix} requirements populated`, profile.requirements.length >= 9 && profile.requirements.every((requirement) => requirement.minArtifactRefs >= 1 && requirement.acceptedArtifactKinds.length > 0 && requirement.acceptedProvenance.length > 0), "requirements must define evidence roles");
  if (profile.profileId === "REF2-BABYBUS-G4-446637-SAME-ITEM-V1") {
    const requiredRef2GateIds = [
      "SELLER_LISTING_AND_FULFILLMENT",
      "PACKAGE_SIX_SIDES",
      "PACKAGE_BARCODE_AND_LOT",
      "PEN_NAMEPLATE_AND_SERIAL",
      "BOOT_MODEL_AND_FIRMWARE",
      "INCLUDED_READABLE_MEDIA",
      "NO_SUBSTITUTION_CONFIRMATION",
      "SAME_ITEM_CONTINUOUS_BINDING",
      "REF2_G4_VISIBLE",
      "REF2_446637_MAPPING",
      "REF2_32GB_BUNDLE_BINDING",
    ];
    check(`${prefix} exact gate set`, sameStrings(profile.requirements.map((requirement) => requirement.id), requiredRef2GateIds), "REF2 profile must retain all 11 reviewed gates");
    check(`${prefix} requested identity literals`, profile.requestedIdentity.productGeneration === "G4" && profile.requestedIdentity.sourceOrderSku === "446637" && profile.requestedIdentity.bundleCapacityLabel === "32GB", "REF2 requested identity drifted");
    check(`${prefix} retail field classification`, profile.retailListingBarcodeField?.value === "110329" && profile.retailListingBarcodeField?.classification === "RETAIL_LISTING_FIELD_ONLY", "retail field 110329 must stay page-only");
  }
  for (const baseline of profile.sourceBaselines) {
    const source = sourceById.get(baseline.id);
    check(`${prefix} baseline ${baseline.id}`, Boolean(source) && source.grade === baseline.grade && source.bytes === baseline.bytes && source.sha256 === baseline.sha256, "source baseline ID/grade/bytes/SHA-256 drifted");
  }
  const physicalBarcode = profile.requirements.find((requirement) => requirement.id === "PACKAGE_BARCODE_AND_LOT");
  check(`${prefix} retail barcode isolated`, profile.retailListingBarcodeField?.physicalPackageBarcodeEffect === "NONE" && !physicalBarcode?.acceptedArtifactKinds.includes("ORDER_PAGE_CAPTURE"), "retail listing barcode must not close the physical package-barcode gate");
  const sameItem = profile.requirements.find((requirement) => requirement.id === "SAME_ITEM_CONTINUOUS_BINDING");
  check(`${prefix} continuous binding`, sameItem?.acceptedArtifactKinds.length === 1 && sameItem.acceptedArtifactKinds[0] === "SELLER_ORIGINAL_VIDEO" && sameItem.acceptedProvenance.length === 1 && sameItem.acceptedProvenance[0] === "SELLER_ORIGINAL", "same-item binding must require an original continuous video");
  const generation = profile.requirements.find((requirement) => requirement.id === "REF2_G4_VISIBLE");
  check(`${prefix} generation physical evidence`, !generation?.acceptedArtifactKinds.includes("SELLER_CONFIRMATION_EXPORT") && sameStrings(generation?.acceptedProvenance ?? [], ["SELLER_ORIGINAL"]), "seller text alone must not prove the physical G4 generation");
}

const templateValid = validateSchema(template);
check("template schema", templateValid, templateValid ? "schema valid" : ajv.errorsText(validateSchema.errors));
check("template no profile fact", template.profileId === null && template.purchasePlanItemId === null && template.candidateId === null && template.sourceRefs.length === 0, "template must not bind a candidate");
check("template no seller fact", template.preparedAt === null && template.rawArtifacts.length === 0 && template.requirementResults.length === 0 && template.request.state === "PREPARED_NOT_SENT" && template.response.state === "PENDING", "template must not claim preparation, sending or response evidence");
check("template blocked", template.decision.status === "EVIDENCE_REQUIRED" && template.decision.blockers.length > 0 && !completeForHumanReview(template, profileById), "template must remain blocked");

const forgedTemplate = structuredClone(template);
forgedTemplate.decision = { status: "EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW", reason: "status-only vector", blockers: [] };
check("negative status-only promotion", !completeForHumanReview(forgedTemplate, profileById), "decision text alone must not close seller evidence");

let recordFiles = [];
try {
  if ((await stat(recordsDirectory)).isDirectory()) {
    recordFiles = (await readdir(recordsDirectory)).filter((file) => file.endsWith(".json")).sort();
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const seenRecordIds = new Map();
const seenArtifactPaths = new Map();
const seenArtifactHashes = new Map();
const completeRecords = [];
const rejectedRecords = [];

async function verifyBoundFile(document, declaredPath, declaredBytes, declaredSha256, label, rawOnly) {
  const normalized = normalizedRepositoryPath(declaredPath);
  const expectedPrefix = `${expectedWorkspacePrefix(document)}${rawOnly ? "raw/" : ""}`;
  check(`${label} normalized path`, normalized === declaredPath, `path must be normalized and repository-bound: ${declaredPath}`);
  check(`${label} record-bound path`, normalized?.startsWith(expectedPrefix) ?? false, `path must stay under ${expectedPrefix}`);
  if (!normalized || !normalized.startsWith(expectedPrefix)) return false;
  const absolute = path.resolve(root, normalized);
  try {
    const expectedRoot = path.resolve(root, expectedPrefix);
    const [resolvedFile, resolvedRoot] = await Promise.all([realpath(absolute), realpath(expectedRoot)]);
    const relative = path.relative(resolvedRoot, resolvedFile);
    check(`${label} real path`, relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative), "resolved file must stay inside the record workspace");
    const bytes = await readFile(resolvedFile);
    check(`${label} bytes`, bytes.length === declaredBytes, `declared ${declaredBytes}; actual ${bytes.length}`);
    check(`${label} sha256`, sha256(bytes) === declaredSha256, `declared ${declaredSha256}; actual ${sha256(bytes)}`);
    return bytes.length === declaredBytes && sha256(bytes) === declaredSha256;
  } catch (error) {
    check(`${label} readable`, false, error.message);
    return false;
  }
}

for (const file of recordFiles) {
  const relativePath = `records/${file}`;
  let document;
  try {
    document = await readJson(path.join(recordsDirectory, file));
  } catch (error) {
    check(`${relativePath} JSON`, false, error.message);
    continue;
  }

  const schemaValid = validateSchema(document);
  check(`${relativePath} schema`, schemaValid, schemaValid ? "schema valid" : ajv.errorsText(validateSchema.errors));
  if (!schemaValid) continue;

  check(`${relativePath} filename`, file === `${document.recordId}.json`, "record filename must equal recordId");
  check(`${relativePath} non-template`, document.recordId !== template.recordId, "template ID is reserved");
  check(`${relativePath} record ID prefix`, document.recordId.startsWith(`${document.purchasePlanItemId}-SELLER-EVIDENCE-`), "recordId must start with purchasePlanItemId-SELLER-EVIDENCE-");
  check(`${relativePath} record ID unique`, !seenRecordIds.has(document.recordId), `duplicate recordId also used by ${seenRecordIds.get(document.recordId) ?? "none"}`);
  seenRecordIds.set(document.recordId, relativePath);

  const profile = profileFor(document, profileById);
  check(`${relativePath} profile`, Boolean(profile), `unknown profile ${document.profileId}`);
  if (!profile) continue;
  check(`${relativePath} candidate binding`, document.purchasePlanItemId === profile.purchasePlanItemId && document.candidateId === profile.candidateId, "record candidate does not match profile");
  check(`${relativePath} requested identity`, sameJson(document.requestedIdentity, profile.requestedIdentity), "requested identity must be copied exactly from the profile");
  check(`${relativePath} source refs`, sameStrings(document.sourceRefs, profile.sourceRefs), "record sourceRefs must equal profile sourceRefs");
  check(`${relativePath} preparedAt`, notFuture(document.preparedAt), "preparedAt must be a real non-future timestamp");
  check(`${relativePath} effect boundary`, document.targetBindingEffect === catalog.targetBindingEffect && document.adapterEffect === catalog.adapterEffect && document.releaseGateEffect === catalog.releaseGateEffect && document.purchaseAuthorizationEffect === catalog.purchaseAuthorizationEffect && document.intakeEffect === catalog.intakeEffect && document.purchasePlanEffect === "NONE_RECORD_ONLY", "record effects must remain evidence-only");

  const resultIds = document.requirementResults.map((result) => result.id);
  const expectedResultIds = profile.requirements.map((requirement) => requirement.id);
  check(`${relativePath} result IDs`, unique(resultIds) && sameStrings(resultIds, expectedResultIds), "requirement result set must exactly match the profile");

  const artifactIds = document.rawArtifacts.map((artifact) => artifact.id);
  check(`${relativePath} artifact IDs unique`, unique(artifactIds), "duplicate artifact ID");
  check(`${relativePath} artifact paths unique`, unique(document.rawArtifacts.map((artifact) => artifact.path)), "duplicate artifact path inside record");

  await verifyBoundFile(document, document.requestTemplate.path, document.requestTemplate.bytes, document.requestTemplate.sha256, `${relativePath} request template`, false);
  for (const artifact of document.rawArtifacts) {
    check(`${relativePath} artifact ${artifact.id} capturedAt`, notFuture(artifact.capturedAt), "capturedAt must be a real non-future timestamp");
    await verifyBoundFile(document, artifact.path, artifact.bytes, artifact.sha256, `${relativePath} artifact ${artifact.id}`, true);
    const priorPath = seenArtifactPaths.get(artifact.path);
    check(`${relativePath} artifact ${artifact.id} cross-record path`, !priorPath || priorPath.recordId === document.recordId, `raw path already used by ${priorPath?.recordId ?? "none"}`);
    if (!priorPath) seenArtifactPaths.set(artifact.path, { recordId: document.recordId, artifactId: artifact.id });
    const priorHash = seenArtifactHashes.get(artifact.sha256);
    check(`${relativePath} artifact ${artifact.id} cross-record hash`, !priorHash || priorHash.recordId === document.recordId, `raw SHA-256 already used by ${priorHash?.recordId ?? "none"}`);
    if (!priorHash) seenArtifactHashes.set(artifact.sha256, { recordId: document.recordId, artifactId: artifact.id });
  }

  check(`${relativePath} request refs`, refsKnown(document, document.request.artifactRefs), "request artifactRefs must belong to this record");
  check(`${relativePath} response refs`, refsKnown(document, document.response.artifactRefs), "response artifactRefs must belong to this record");

  if (document.request.state === "PREPARED_NOT_SENT") {
    check(`${relativePath} unsent semantics`, document.request.sentAt === null && document.request.channel === null && document.request.sellerEndpoint === null && document.request.transportReference === null && document.request.artifactRefs.length === 0, "PREPARED_NOT_SENT must not claim submission evidence");
  } else {
    const requestArtifacts = artifactMap(document);
    check(`${relativePath} sent semantics`, notFuture(document.request.sentAt) && Date.parse(document.request.sentAt) >= Date.parse(document.preparedAt) && nonEmptyString(document.request.channel) && nonEmptyString(document.request.sellerEndpoint) && nonEmptyString(document.request.transportReference) && document.request.artifactRefs.length > 0 && document.request.artifactRefs.some((ref) => requestArtifacts.get(ref)?.kind === "REQUEST_EXPORT"), "SENT requires ordered time, endpoint, transport reference and request export");
  }

  if (document.response.state === "PENDING") {
    check(`${relativePath} pending response semantics`, document.response.receivedAt === null && document.response.senderIdentity === null && document.response.artifactRefs.length === 0, "PENDING response must not claim response evidence");
  } else {
    const responseArtifacts = artifactMap(document);
    check(`${relativePath} received response semantics`, document.request.state === "SENT" && notFuture(document.response.receivedAt) && Date.parse(document.response.receivedAt) >= Date.parse(document.request.sentAt) && nonEmptyString(document.response.senderIdentity) && document.response.artifactRefs.length > 0 && document.response.artifactRefs.some((ref) => ["SELLER_CHAT_EXPORT", "SELLER_CONFIRMATION_EXPORT"].includes(responseArtifacts.get(ref)?.kind)), "RECEIVED requires ordered time, a sent request, sender identity and written response export");
  }

  const requirementById = new Map(profile.requirements.map((requirement) => [requirement.id, requirement]));
  for (const result of document.requirementResults) {
    const label = `${relativePath} result ${result.id}`;
    const requirement = requirementById.get(result.id);
    check(`${label} refs`, refsKnown(document, result.artifactRefs), "result artifactRefs must belong to this record");
    if (result.status === "PENDING") {
      check(`${label} pending`, result.artifactRefs.length === 0, "PENDING result must not claim supporting artifacts");
      continue;
    }
    check(`${label} observed value`, nonEmptyString(result.observedValue), `${result.status} requires an observed value`);
    check(`${label} evidence count`, result.artifactRefs.length >= requirement.minArtifactRefs, `${result.status} requires at least ${requirement.minArtifactRefs} artifact(s)`);
    if (result.status === "PASS") {
      const artifacts = artifactMap(document);
      const qualifying = result.artifactRefs.some((ref) => {
        const artifact = artifacts.get(ref);
        return artifact && requirement.acceptedArtifactKinds.includes(artifact.kind) && requirement.acceptedProvenance.includes(artifact.provenance);
      });
      check(`${label} allowed evidence`, qualifying, "PASS lacks an artifact kind/provenance allowed by the catalog");
    }
  }

  const isComplete = completeForHumanReview(document, profileById);
  if (document.decision.status === "EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW") {
    check(`${relativePath} complete decision gate`, isComplete, "complete status requires every seller-evidence and identity gate");
    if (isComplete) completeRecords.push(document.recordId);
  } else if (document.decision.status === "REJECTED") {
    check(`${relativePath} rejected decision`, document.requirementResults.some((result) => result.status === "FAIL") && document.decision.blockers.length > 0 && !isComplete, "REJECTED requires at least one evidenced FAIL and blockers");
    rejectedRecords.push(document.recordId);
  } else {
    check(`${relativePath} evidence-required decision`, document.decision.blockers.length > 0 && !isComplete && document.review.reviewedAt === null && document.review.reviewer === null, "EVIDENCE_REQUIRED must remain blocked and unreviewed");
  }
}

if (recordFiles.length === 0) warnings.push("No seller evidence records exist yet; REF2 remains SELLER_PHOTO_REQUIRED");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  valid: errors.length === 0,
  catalogId: catalog.catalogId,
  profileCount: catalog.profiles.length,
  templateCount: 1,
  recordCount: recordFiles.length,
  completeForHumanReviewRecords: completeRecords,
  rejectedRecords,
  paymentAuthorizationCount: 0,
  targetBindingEffectCount: 0,
  adapterEffectCount: 0,
  releaseGateEffectCount: 0,
  intakeEffectCount: 0,
  checkSummary: {
    total: checks.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length,
  },
  warnings,
  errors,
  checks,
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Benchmark Seller Evidence v1 valid: ${report.valid}`);
console.log(`Checks: ${report.checkSummary.passed}/${report.checkSummary.total} passed`);
console.log(`Profiles/records/complete: ${report.profileCount}/${report.recordCount}/${report.completeForHumanReviewRecords.length}`);
console.log("Payment authorization / BOARD_TARGET / adapter / ReleaseGate / intake effects: 0 / 0 / 0 / 0 / 0");
if (warnings.length > 0) console.log(`Warnings: ${warnings.join(" | ")}`);
console.log(`Report: ${reportPath}`);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
