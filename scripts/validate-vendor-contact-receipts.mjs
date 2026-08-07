import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const contractRoot = path.join(root, "hardware", "evt0", "vendor-contact-receipts-v1");
const outboundRoot = path.join(root, "build", "vendor-outbound-v1");
const manifestPath = path.join(outboundRoot, "bundle-manifest.json");
const recordDirectory = process.env.VENDOR_CONTACT_RECEIPT_RECORDS_DIR
  ? path.resolve(root, process.env.VENDOR_CONTACT_RECEIPT_RECORDS_DIR)
  : path.join(contractRoot, "records");
const reportPath = process.env.VENDOR_CONTACT_RECEIPT_REPORT_PATH
  ? path.resolve(root, process.env.VENDOR_CONTACT_RECEIPT_REPORT_PATH)
  : path.join(root, "build", "vendor-contact-receipts-validation.json");
const errors = [];
const warnings = [];
const checks = [];

for (const [label, target] of [["records", recordDirectory], ["report", reportPath]]) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} override must stay inside repository root: ${target}`);
  }
}

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
  if (!passed) errors.push(`${name}: ${detail}`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function recomputeBundleId(manifest) {
  const reproducibleCore = {
    schemaVersion: manifest.schemaVersion,
    bundleId: manifest.bundleId,
    bundleStatus: manifest.bundleStatus,
    deliveryMode: manifest.deliveryMode,
    sourceFiles: manifest.sourceFiles,
    messageRecords: manifest.messages,
    referenceRecords: manifest.includedReferenceFiles,
  };
  return `sha256:${sha256(Buffer.from(canonicalJson(reproducibleCore), "utf8"))}`;
}

function validOutboundManifest(manifest) {
  return manifest?.schemaVersion === 1 &&
    manifest.documentKind === "mb1-outbound-build" &&
    manifest.bundleStatus === "PREPARED_NOT_SENT" &&
    manifest.deliveryMode === "MANUAL_OFFICIAL_ENTRY_ONLY" &&
    Array.isArray(manifest.sourceFiles) &&
    Array.isArray(manifest.messages) && manifest.messages.length > 0 &&
    Array.isArray(manifest.includedReferenceFiles) &&
    manifest.replyPolicy?.targetBindingEffect === "NONE_VENDOR_CLAIM_ONLY" &&
    manifest.replyPolicy?.paymentAuthorization === "NOT_GRANTED_BY_THIS_BUNDLE" &&
    recomputeBundleId(manifest) === manifest.reproducibleId;
}

function validDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function artifactMap(document) {
  return new Map(document.rawArtifacts.map((artifact) => [artifact.id, artifact]));
}

function refsExist(document, refs) {
  const known = artifactMap(document);
  return refs.length > 0 && refs.every((ref) => known.has(ref));
}

function manifestMessage(manifest, messageId) {
  return manifest.messages.find((message) => message.messageId === messageId);
}

function messageEmailArtifact(message) {
  return message?.artifacts.find((artifact) => artifact.path.endsWith(".email.txt"));
}

function messageRecipientArtifact(message) {
  return message?.artifacts.find((artifact) => artifact.path.endsWith(".recipient-entry.json"));
}

function sameStrings(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function normalizedRepositoryPath(declaredPath) {
  if (typeof declaredPath !== "string" || declaredPath.length === 0) return null;
  const absolute = path.resolve(root, declaredPath);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.replaceAll("\\", "/");
}

function insideReceiptRaw(document, declaredPath) {
  const normalized = normalizedRepositoryPath(declaredPath);
  return normalized?.startsWith(`build/vendor-contact-receipts/${document.receiptId}/raw/`) ?? false;
}

function submissionArtifactKindMatches(document) {
  const artifacts = artifactMap(document);
  const mediaTypes = document.submission.submissionArtifactRefs
    .map((ref) => artifacts.get(ref)?.mediaType)
    .filter(Boolean);
  if (document.submission.channel === "EMAIL") return mediaTypes.includes("message/rfc822");
  if (["WEB_FORM", "FAE_ROUTING", "OTHER_OFFICIAL_CHANNEL"].includes(document.submission.channel)) {
    return mediaTypes.some((mediaType) => ["text/html", "application/pdf", "image/png", "image/jpeg", "application/json"].includes(mediaType));
  }
  return false;
}

function recipientMatches(document, recipientDocument) {
  const entry = recipientDocument?.recipientEntry;
  if (!entry || recipientDocument.messageId !== document.messageId || recipientDocument.candidateId !== document.candidateId) return false;
  if (entry.officialEntryUrl !== document.contactEndpoint.officialEntryUrl) return false;
  if (document.contactEndpoint.recipientKind === "EMAIL") {
    return Array.isArray(entry.listedAddresses) && entry.listedAddresses.includes(document.contactEndpoint.recipientValue);
  }
  return document.contactEndpoint.recipientValue === entry.officialEntryUrl;
}

function sourceBacksEndpoint(document) {
  return document.sourceRefs.some((sourceRef) => {
    const source = sourceById.get(sourceRef);
    return source?.url === document.contactEndpoint.officialEntryUrl && String(source.grade).startsWith("O");
  });
}

function structurallySubmitted(document, manifest, recipientDocument) {
  const message = manifestMessage(manifest, document.messageId);
  const emailArtifact = messageEmailArtifact(message);
  const recipientArtifact = messageRecipientArtifact(message);
  const normalizedManifestPath = normalizedRepositoryPath(document.outboundBundle.manifestPath);
  const normalizedMessagePath = normalizedRepositoryPath(document.outboundBundle.messageArtifactPath);
  const normalizedRecipientPath = normalizedRepositoryPath(document.outboundBundle.recipientArtifactPath);
  const verifiedAtMs = Date.parse(document.contactEndpoint.verifiedAt);
  const sentAtMs = Date.parse(document.submission.sentAt);
  const nowWithClockSkewMs = Date.now() + 5 * 60 * 1000;
  return validOutboundManifest(manifest) &&
    document.submission.state === "SUBMITTED" &&
    validDateTime(document.submission.sentAt) &&
    typeof document.submission.channel === "string" &&
    document.submission.channel === document.contactEndpoint.recipientKind &&
    typeof document.submission.transportReference === "string" &&
    document.submission.transportReference.trim().length > 0 &&
    typeof document.contactEndpoint.officialEntryUrl === "string" &&
    document.contactEndpoint.officialEntryUrl.startsWith("https://") &&
    validDateTime(document.contactEndpoint.verifiedAt) &&
    verifiedAtMs <= sentAtMs && sentAtMs - verifiedAtMs <= 24 * 60 * 60 * 1000 &&
    sentAtMs <= nowWithClockSkewMs && verifiedAtMs <= nowWithClockSkewMs &&
    typeof document.contactEndpoint.recipientValue === "string" &&
    document.contactEndpoint.recipientValue.length > 0 &&
    document.sourceRefs.length > 0 &&
    document.rawArtifacts.length > 0 &&
    refsExist(document, document.contactEndpoint.verificationArtifactRefs) &&
    refsExist(document, document.submission.submissionArtifactRefs) &&
    submissionArtifactKindMatches(document) &&
    document.rawArtifacts.every((artifact) => insideReceiptRaw(document, artifact.path)) &&
    message && emailArtifact && recipientArtifact && message.candidateId === document.candidateId &&
    sameStrings(document.sourceRefs, message.sourceRefs) &&
    sourceBacksEndpoint(document) &&
    recipientMatches(document, recipientDocument) &&
    document.outboundBundle.bundleId === manifest.bundleId &&
    document.outboundBundle.reproducibleId === manifest.reproducibleId &&
    normalizedManifestPath === `build/vendor-contact-receipts/${document.receiptId}/outbound/bundle-manifest.json` &&
    normalizedMessagePath === `build/vendor-contact-receipts/${document.receiptId}/outbound/${emailArtifact.path}` &&
    document.outboundBundle.messageArtifactBytes === emailArtifact.bytes &&
    document.outboundBundle.messageArtifactSha256 === emailArtifact.sha256 &&
    normalizedRecipientPath === `build/vendor-contact-receipts/${document.receiptId}/outbound/${recipientArtifact.path}` &&
    document.outboundBundle.recipientArtifactBytes === recipientArtifact.bytes &&
    document.outboundBundle.recipientArtifactSha256 === recipientArtifact.sha256 &&
    document.targetBindingEffect === "NONE_CONTACT_ONLY" &&
    document.paymentEffect === "NONE_AWAIT_VENDOR_RESPONSE" &&
    document.decision.status === "AWAITING_RESPONSE" &&
    document.decision.blockers.length === 1 &&
    document.decision.blockers[0] === "SUPPLIER_RESPONSE_PENDING";
}

async function verifyFileEvidence(label, declaredPath, declaredBytes, declaredSha256, allowedPath) {
  const normalized = normalizedRepositoryPath(declaredPath);
  const pathContained = normalized !== null;
  check(`${label} contained path`, pathContained, String(declaredPath));
  if (!pathContained) return false;
  const receiptBound = allowedPath(normalized);
  check(`${label} receipt-bound path`, receiptBound, normalized);
  if (!receiptBound) return false;
  const absolute = path.join(root, ...normalized.split("/"));
  try {
    const bytes = await readFile(absolute);
    const observedSha256 = sha256(bytes);
    const bytesMatch = bytes.length === declaredBytes;
    const sha256Match = observedSha256 === declaredSha256;
    check(`${label} bytes`, bytesMatch, `${bytes.length} observed vs ${declaredBytes} declared`);
    check(`${label} sha256`, sha256Match, `${observedSha256} observed vs ${declaredSha256} declared`);
    return bytesMatch && sha256Match;
  } catch (error) {
    check(`${label} exists`, false, `${declaredPath}: ${error.message}`);
    return false;
  }
}

const schema = await readJson(path.join(contractRoot, "schema.json"));
const template = await readJson(path.join(contractRoot, "receipt.template.json"));
const sourceLedger = await readJson(path.join(root, "hardware", "evt0", "evidence-sources.json"));
const sourceIds = new Set(sourceLedger.sources.map((source) => source.id));
const sourceById = new Map(sourceLedger.sources.map((source) => [source.id, source]));
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const manifestSha256 = sha256(manifestBytes);

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const validateSchema = ajv.compile(schema);

function schemaPass(document, label) {
  const valid = validateSchema(document);
  check(`${label} JSON Schema`, valid, valid ? "valid" : ajv.errorsText(validateSchema.errors));
  return valid;
}

schemaPass(template, "receipt.template.json");
check("template state", template.submission.state === "PENDING" && template.decision.status === "PENDING_SEND", "template remains pending");
check("template facts empty", template.rawArtifacts.length === 0 && template.sourceRefs.length === 0 && template.submission.sentAt === null, "template carries no send evidence");
check("template not submitted", !structurallySubmitted(template, manifest, null), "blank template cannot prove submission");

const firstMessage = manifest.messages[0];
const firstEmail = messageEmailArtifact(firstMessage);
const firstRecipientArtifact = messageRecipientArtifact(firstMessage);
const firstRecipientDocument = await readJson(path.join(outboundRoot, firstRecipientArtifact.path));
const synthetic = structuredClone(template);
const syntheticSentAt = new Date(Date.now() - 60 * 1000);
const syntheticVerifiedAt = new Date(syntheticSentAt.getTime() - 60 * 1000);
synthetic.receiptId = "SYNTHETIC-CONTACT-RECEIPT";
synthetic.messageId = firstMessage.messageId;
synthetic.candidateId = firstMessage.candidateId;
synthetic.sourceRefs = [firstMessage.sourceRefs[0]];
synthetic.outboundBundle = {
  bundleId: manifest.bundleId,
  reproducibleId: manifest.reproducibleId,
  manifestPath: "build/vendor-contact-receipts/SYNTHETIC-CONTACT-RECEIPT/outbound/bundle-manifest.json",
  manifestBytes: manifestBytes.length,
  manifestSha256,
  messageArtifactPath: `build/vendor-contact-receipts/SYNTHETIC-CONTACT-RECEIPT/outbound/${firstEmail.path}`,
  messageArtifactBytes: firstEmail.bytes,
  messageArtifactSha256: firstEmail.sha256,
  recipientArtifactPath: `build/vendor-contact-receipts/SYNTHETIC-CONTACT-RECEIPT/outbound/${firstRecipientArtifact.path}`,
  recipientArtifactBytes: firstRecipientArtifact.bytes,
  recipientArtifactSha256: firstRecipientArtifact.sha256,
};
synthetic.rawArtifacts = [
  { id: "CONTACT-PAGE", path: "build/vendor-contact-receipts/SYNTHETIC-CONTACT-RECEIPT/raw/contact.html", bytes: 1, sha256: "1".repeat(64), mediaType: "text/html" },
  { id: "SEND-RECEIPT", path: "build/vendor-contact-receipts/SYNTHETIC-CONTACT-RECEIPT/raw/sent.eml", bytes: 1, sha256: "2".repeat(64), mediaType: "message/rfc822" },
];
synthetic.contactEndpoint = {
  officialEntryUrl: firstRecipientDocument.recipientEntry.officialEntryUrl,
  verifiedAt: syntheticVerifiedAt.toISOString(),
  recipientKind: "EMAIL",
  recipientValue: firstRecipientDocument.recipientEntry.listedAddresses[0],
  verificationArtifactRefs: ["CONTACT-PAGE"],
};
synthetic.submission = {
  state: "SUBMITTED",
  sentAt: syntheticSentAt.toISOString(),
  channel: "EMAIL",
  transportReference: "SYNTHETIC-ONLY",
  submissionArtifactRefs: ["SEND-RECEIPT"],
};
synthetic.decision = {
  status: "AWAITING_RESPONSE",
  reason: "Synthetic structural vector only.",
  blockers: ["SUPPLIER_RESPONSE_PENDING"],
};
check("positive structural vector", structurallySubmitted(synthetic, manifest, firstRecipientDocument), "complete in-memory vector passes structural gate");

const statusOnly = structuredClone(template);
statusOnly.submission.state = "SUBMITTED";
statusOnly.decision.status = "AWAITING_RESPONSE";
check("negative status-only promotion", !structurallySubmitted(statusOnly, manifest, firstRecipientDocument), "status change alone is rejected");

const missingEndpointEvidence = structuredClone(synthetic);
missingEndpointEvidence.contactEndpoint.verificationArtifactRefs = [];
check("negative missing endpoint evidence", !structurallySubmitted(missingEndpointEvidence, manifest, firstRecipientDocument), "official endpoint evidence is required");

const missingSubmissionEvidence = structuredClone(synthetic);
missingSubmissionEvidence.submission.submissionArtifactRefs = [];
check("negative missing submission evidence", !structurallySubmitted(missingSubmissionEvidence, manifest, firstRecipientDocument), "send receipt evidence is required");

const mismatchedCandidate = structuredClone(synthetic);
mismatchedCandidate.candidateId = "SYNTHETIC-MISMATCH";
check("negative message candidate mismatch", !structurallySubmitted(mismatchedCandidate, manifest, firstRecipientDocument), "message and candidate must match manifest");

const wrongEffect = structuredClone(synthetic);
wrongEffect.targetBindingEffect = "SYNTHETIC-WRONG";
check("negative target effect", !structurallySubmitted(wrongEffect, manifest, firstRecipientDocument), "contact receipt has no target-binding effect");

const wrongEndpoint = structuredClone(synthetic);
wrongEndpoint.contactEndpoint.officialEntryUrl = "https://example.invalid/contact";
check("negative endpoint not bound to recipient entry", !structurallySubmitted(wrongEndpoint, manifest, firstRecipientDocument), "official endpoint must match archived recipient entry and source ledger");

const unlistedRecipient = structuredClone(synthetic);
unlistedRecipient.contactEndpoint.recipientValue = "unlisted@example.invalid";
check("negative unlisted email recipient", !structurallySubmitted(unlistedRecipient, manifest, firstRecipientDocument), "email recipient must be listed by the archived official entry");

const crossReceiptPath = structuredClone(synthetic);
crossReceiptPath.rawArtifacts[0].path = "build/vendor-contact-receipts/SYNTHETIC-CONTACT-RECEIPT/raw/../../OTHER/raw/contact.html";
check("negative cross-receipt raw path", !structurallySubmitted(crossReceiptPath, manifest, firstRecipientDocument), "raw evidence must resolve inside its receipt raw directory");

const emptyTransportReference = structuredClone(synthetic);
emptyTransportReference.submission.transportReference = "";
check("negative empty transport reference", !structurallySubmitted(emptyTransportReference, manifest, firstRecipientDocument), "submitted evidence needs a transport reference");

const futureSubmission = structuredClone(synthetic);
futureSubmission.contactEndpoint.verifiedAt = "2099-01-01T00:00:00Z";
futureSubmission.submission.sentAt = "2099-01-01T00:01:00Z";
check("negative future submission", !structurallySubmitted(futureSubmission, manifest, firstRecipientDocument), "verification and submission timestamps cannot be in the future");

const forgedManifest = structuredClone(manifest);
forgedManifest.messages[0].subject = "SYNTHETIC-MANIFEST-TAMPER";
check("negative forged manifest core", !structurallySubmitted(synthetic, forgedManifest, firstRecipientDocument), "manifest reproducibleId must match its canonical core");

let recordFiles = [];
try {
  if ((await stat(recordDirectory)).isDirectory()) {
    recordFiles = (await readdir(recordDirectory)).filter((file) => file.endsWith(".json")).sort();
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const submittedReceipts = [];
const seenReceiptIds = new Set();
for (const file of recordFiles) {
  const relative = `hardware/evt0/vendor-contact-receipts-v1/records/${file}`;
  const document = await readJson(path.join(recordDirectory, file));
  const documentSchemaValid = schemaPass(document, relative);
  if (!documentSchemaValid) continue;
  check(`${relative} filename binding`, path.basename(file, ".json") === document.receiptId, "record filename must equal receiptId.json");
  check(`${relative} unique receiptId`, !seenReceiptIds.has(document.receiptId), "receiptId must be unique across records");
  seenReceiptIds.add(document.receiptId);
  for (const sourceRef of document.sourceRefs) {
    check(`${relative} source ${sourceRef}`, sourceIds.has(sourceRef), "unknown evidence source ID");
  }
  check(`${relative} artifact IDs`, new Set(document.rawArtifacts.map((artifact) => artifact.id)).size === document.rawArtifacts.length, "artifact IDs must be unique");
  check(`${relative} endpoint refs`, refsExist(document, document.contactEndpoint.verificationArtifactRefs), "endpoint refs must resolve");
  check(`${relative} submission refs`, refsExist(document, document.submission.submissionArtifactRefs), "submission refs must resolve");
  const receiptArchivePrefix = `build/vendor-contact-receipts/${document.receiptId}/outbound/`;
  const receiptRawPrefix = `build/vendor-contact-receipts/${document.receiptId}/raw/`;
  const manifestFileValid = await verifyFileEvidence(
    `${relative} outbound manifest`,
    document.outboundBundle.manifestPath,
    document.outboundBundle.manifestBytes,
    document.outboundBundle.manifestSha256,
    (candidatePath) => candidatePath === `${receiptArchivePrefix}bundle-manifest.json`,
  );
  let recordManifest = null;
  let recordRecipient = null;
  if (manifestFileValid) {
    try {
      recordManifest = await readJson(path.resolve(root, document.outboundBundle.manifestPath));
    } catch (error) {
      check(`${relative} outbound manifest JSON`, false, error.message);
    }
  }
  let recordEvidenceValid = manifestFileValid;
  if (recordManifest) {
    const messageFileValid = await verifyFileEvidence(
      `${relative} outbound message`,
      document.outboundBundle.messageArtifactPath,
      document.outboundBundle.messageArtifactBytes,
      document.outboundBundle.messageArtifactSha256,
      (candidatePath) => candidatePath.startsWith(`${receiptArchivePrefix}messages/`),
    );
    const recipientFileValid = await verifyFileEvidence(
      `${relative} outbound recipient entry`,
      document.outboundBundle.recipientArtifactPath,
      document.outboundBundle.recipientArtifactBytes,
      document.outboundBundle.recipientArtifactSha256,
      (candidatePath) => candidatePath.startsWith(`${receiptArchivePrefix}messages/`),
    );
    if (recipientFileValid) {
      try {
        recordRecipient = await readJson(path.resolve(root, document.outboundBundle.recipientArtifactPath));
      } catch (error) {
        check(`${relative} outbound recipient entry JSON`, false, error.message);
      }
    }
    check(`${relative} structural submission`, structurallySubmitted(document, recordManifest, recordRecipient), "record must bind archived message/recipient entry, official source and actual submission metadata");
    recordEvidenceValid = recordEvidenceValid && messageFileValid && recipientFileValid;
  }
  for (const artifact of document.rawArtifacts) {
    const artifactValid = await verifyFileEvidence(
      `${relative} artifact ${artifact.id}`,
      artifact.path,
      artifact.bytes,
      artifact.sha256,
      (candidatePath) => candidatePath.startsWith(receiptRawPrefix),
    );
    recordEvidenceValid = recordEvidenceValid && artifactValid;
  }
  if (recordManifest && recordRecipient && recordEvidenceValid && structurallySubmitted(document, recordManifest, recordRecipient)) submittedReceipts.push(document.receiptId);
}

if (recordFiles.length === 0) warnings.push("No actual vendor contact send receipts exist; all outbound messages remain locally prepared only");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  valid: errors.length === 0,
  outboundBundleId: manifest.reproducibleId,
  receiptRecordCount: recordFiles.length,
  submittedReceiptCount: submittedReceipts.length,
  submittedReceipts,
  targetBindingEffect: "NONE_CONTACT_ONLY",
  paymentEffect: "NONE_AWAIT_VENDOR_RESPONSE",
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
console.log(`Vendor Contact Receipt v1 valid: ${report.valid}`);
console.log(`Checks: ${report.checkSummary.passed}/${report.checkSummary.total} passed`);
console.log(`Actual receipts: ${report.receiptRecordCount}; submitted: ${report.submittedReceiptCount}; target/payment effect: NONE`);
console.log(`Report: ${reportPath}`);
if (warnings.length) console.log(`Warnings: ${warnings.join(" | ")}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
