import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const outboundRelative = "hardware/evt0/vendor-evidence-v1/outbound-v1";
const outboundRoot = path.join(root, ...outboundRelative.split("/"));
const outputRoot = path.join(root, "build", "vendor-outbound-v1");
const expectedAnswerIds = Array.from({ length: 8 }, (_, index) => `M${String(index + 1).padStart(2, "0")}`);
const expectedAttachmentIds = Array.from({ length: 10 }, (_, index) => `A${String(index + 1).padStart(2, "0")}`);
const expectedCrosscheckAnswerIds = Array.from({ length: 5 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`);
const expectedCrosscheckAttachmentIds = Array.from({ length: 5 }, (_, index) => `X${String(index + 1).padStart(2, "0")}`);
const expectedPcbaCandidates = ["REF-CHUNMIAO-LOCAL", "REF-ZTRON-LOCAL"];
const expectedCrosscheckCandidate = "SONIX-OID-COMPONENT";

function fail(message) {
  throw new Error(message);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isRepoRelative(value) {
  return typeof value === "string" &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith("/") &&
    !value.includes("../") &&
    !value.startsWith("..");
}

function resolveRepoPath(relativePath, label) {
  if (!isRepoRelative(relativePath)) fail(`${label} must be a safe repository-relative path: ${relativePath}`);
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`${label} escapes repository root: ${relativePath}`);
  return absolutePath;
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

function stableJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

function exactSet(values, expected) {
  return values.length === expected.length && new Set(values).size === expected.length &&
    expected.every((value) => values.includes(value));
}

function unique(values) {
  return new Set(values).size === values.length;
}

async function readJson(relativePath, label) {
  const bytes = await readFile(resolveRepoPath(relativePath, label));
  try {
    return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function renderEmail(message) {
  const listedAddresses = message.recipientEntry.listedAddresses.length > 0
    ? message.recipientEntry.listedAddresses.join(", ")
    : "(none; use official entry)";
  const answerLines = message.requiredAnswers.map((item) => `${item.id} ${item.request}`);
  return [
    "X-MB1-Outbound-Status: PREPARED_NOT_SENT",
    "X-MB1-Delivery-Mode: MANUAL_OFFICIAL_ENTRY_ONLY",
    "To: MANUAL_SELECTION_REQUIRED",
    `Official-Entry: ${message.recipientEntry.officialEntryUrl}`,
    `Listed-Addresses-To-Reverify: ${listedAddresses}`,
    `Subject: ${message.subject}`,
    "",
    "发送前动作：采购人员须通过 Official-Entry 手动复核当前收件方式；本文件不自动投递。",
    "",
    message.body,
    "",
    "书面问题：",
    ...answerLines,
    "",
    "回件附件请求清单见同名 .attachment-request-checklist.md。",
    "",
  ].join("\n");
}

function renderChecklist(message) {
  const rows = message.attachmentRequests.map((item) => `| ${item.id} | ${item.request} | PENDING_FROM_RECIPIENT |`).join("\n");
  return [
    `# ${message.messageId} 回件附件请求清单`,
    "",
    "- 外发状态：`PREPARED_NOT_SENT`",
    "- 本清单列的是请对方回传的原始文件，不代表任何文件已经收到。",
    "- 收件后先保存原始字节，再在既有 Vendor Evidence v1 中引用对应 artifact。",
    "",
    "| ID | 请求文件/内容 | 当前状态 |",
    "|---|---|---|",
    rows,
    "",
    `归档根：\`${message.replyIntake.rawArchiveRoot}\``,
    `回件记录模板：\`${message.replyIntake.responseRecordTemplate}\``,
    `目标绑定影响：\`${message.replyIntake.targetBindingEffect}\``,
    `付款边界：\`${message.replyIntake.paymentGate}\``,
    "",
  ].join("\n");
}

function renderRecipientEntry(message) {
  return stableJson({
    candidateId: message.candidateId,
    candidateRole: message.candidateRole,
    deliveryMode: "MANUAL_OFFICIAL_ENTRY_ONLY",
    messageId: message.messageId,
    messageStatus: "PREPARED_NOT_SENT",
    recipientEntry: message.recipientEntry,
  });
}

function renderRunbook({ bundleId, reproducibleId, messages }) {
  return [
    "MB1 outbound bundle v1",
    `Bundle ID: ${bundleId}`,
    "Status: PREPARED_NOT_SENT",
    "Delivery mode: MANUAL_OFFICIAL_ENTRY_ONLY",
    `Reproducible ID: ${reproducibleId}`,
    "",
    "1. Use a recipient-entry JSON file to re-check the official contact route manually.",
    "2. Copy the matching email text; attach only the reference files appropriate for that recipient.",
    "3. The attachment checklist asks the recipient for material. It is not a receipt.",
    "4. After a real reply, archive raw files under the candidate-specific vendor-evidence root.",
    "5. Create a separate candidate response from vendor-evidence-v1/candidate.template.json.",
    "6. Do not change BOARD_TARGET, authorize payment, or claim a supplier reply from this bundle.",
    "",
    "Prepared messages:",
    ...messages.map((message) => `- ${message.messageId}: ${message.candidateId} (${message.candidateRole})`),
    "",
  ].join("\n");
}

function addSchemaErrors(errors, validate, document, label) {
  if (validate(document)) return;
  const detail = (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
  errors.push(`${label} JSON Schema: ${detail || "invalid"}`);
}

function validateDocuments({ manifest, messages, sourceLedger, validate }) {
  const errors = [];
  addSchemaErrors(errors, validate, manifest, "manifest.template.json");
  for (const message of messages) addSchemaErrors(errors, validate, message.document, message.relativePath);

  const sourceIds = new Set(Array.isArray(sourceLedger?.sources) ? sourceLedger.sources.map((source) => source.id) : []);
  if (sourceIds.size === 0) errors.push("evidence-sources.json must expose at least one source ID");

  if (manifest.bundleStatus !== "PREPARED_NOT_SENT") errors.push("manifest bundleStatus must remain PREPARED_NOT_SENT");
  if (manifest.deliveryMode !== "MANUAL_OFFICIAL_ENTRY_ONLY") errors.push("manifest deliveryMode must remain MANUAL_OFFICIAL_ENTRY_ONLY");
  if (!unique(manifest.sourceDocuments.map((item) => item.id))) errors.push("sourceDocuments IDs must be unique");
  if (!unique(manifest.sourceDocuments.map((item) => item.path))) errors.push("sourceDocuments paths must be unique");
  for (const source of manifest.sourceDocuments) {
    if (!isRepoRelative(source.path)) errors.push(`source document path is unsafe: ${source.path}`);
  }
  if (manifest.messageTemplatePaths.length !== 3) errors.push("exactly three outbound message templates are required");
  if (!unique(manifest.messageTemplatePaths)) errors.push("messageTemplatePaths must be unique");
  for (const messagePath of manifest.messageTemplatePaths) {
    if (!isRepoRelative(messagePath) || !messagePath.startsWith(`${outboundRelative}/messages/`)) {
      errors.push(`message template path is outside outbound-v1/messages: ${messagePath}`);
    }
  }

  const documents = messages.map((entry) => entry.document);
  if (documents.length !== manifest.messageTemplatePaths.length) errors.push("every manifest message template path must load exactly once");
  if (!unique(documents.map((message) => message.messageId))) errors.push("messageId values must be unique");
  if (!unique(documents.map((message) => message.candidateId))) errors.push("candidateId values must be unique");

  const pcba = documents.filter((message) => message.candidateRole === "PCBA_CANDIDATE");
  const crosscheck = documents.filter((message) => message.candidateRole === "OID_MANUFACTURER_CROSSCHECK");
  if (pcba.length !== 2) errors.push("exactly two PCBA_CANDIDATE messages are required");
  if (crosscheck.length !== 1) errors.push("exactly one OID_MANUFACTURER_CROSSCHECK message is required");
  if (!exactSet(pcba.map((message) => message.candidateId), expectedPcbaCandidates)) errors.push("PCBA candidate IDs must be REF-CHUNMIAO-LOCAL and REF-ZTRON-LOCAL");
  if (crosscheck.length === 1 && crosscheck[0].candidateId !== expectedCrosscheckCandidate) errors.push("manufacturer crosscheck candidate must be SONIX-OID-COMPONENT");

  for (const message of documents) {
    if (message.messageStatus !== "PREPARED_NOT_SENT") errors.push(`${message.messageId} must remain PREPARED_NOT_SENT`);
    if (message.recipientEntry?.manualSelectionRequired !== true) errors.push(`${message.messageId} requires manual recipient selection`);
    if (message.recipientEntry?.entryType !== "OFFICIAL_ENTRY_MANUAL_SELECTION") errors.push(`${message.messageId} must use an official entry`);
    for (const sourceRef of message.sourceRefs ?? []) {
      if (!sourceIds.has(sourceRef)) errors.push(`${message.messageId} references unknown evidence source ${sourceRef}`);
    }
    if (!message.replyIntake?.rawArchiveRoot?.startsWith(`build/vendor-evidence/${message.candidateId}/`)) {
      errors.push(`${message.messageId} raw archive root must be candidate-specific`);
    }
    if (message.replyIntake?.targetBindingEffect !== "NONE_VENDOR_CLAIM_ONLY") {
      errors.push(`${message.messageId} may not bind BOARD_TARGET from an outbound/reply template`);
    }
    if (message.replyIntake?.responseRecordTemplate !== "hardware/evt0/vendor-evidence-v1/candidate.template.json") {
      errors.push(`${message.messageId} must route replies through the existing Vendor Evidence template`);
    }

    const answerIds = (message.requiredAnswers ?? []).map((item) => item.id);
    const attachmentIds = (message.attachmentRequests ?? []).map((item) => item.id);
    if (message.candidateRole === "PCBA_CANDIDATE") {
      if (!exactSet(answerIds, expectedAnswerIds)) errors.push(`${message.messageId} must request M01-M08 exactly once`);
      if (!exactSet(attachmentIds, expectedAttachmentIds)) errors.push(`${message.messageId} must request A01-A10 exactly once`);
      if (message.replyIntake?.paymentGate !== "REPLY_EVIDENCE_REQUIRED_BEFORE_PAYMENT") {
        errors.push(`${message.messageId} must keep the pre-payment evidence gate`);
      }
    }
    if (message.candidateRole === "OID_MANUFACTURER_CROSSCHECK") {
      if (!exactSet(answerIds, expectedCrosscheckAnswerIds)) errors.push(`${message.messageId} must request S01-S05 exactly once`);
      if (!exactSet(attachmentIds, expectedCrosscheckAttachmentIds)) errors.push(`${message.messageId} must request X01-X05 exactly once`);
      if (message.replyIntake?.paymentGate !== "CROSSCHECK_ONLY_NOT_A_PCBA_PAYMENT_GATE") {
        errors.push(`${message.messageId} must remain a non-payment crosscheck`);
      }
    }
  }

  return errors;
}

function runNegativeSelfTests({ manifest, messages, sourceLedger, validate }) {
  const checks = [];
  const reject = (name, mutate) => {
    const candidateManifest = structuredClone(manifest);
    const candidateMessages = messages.map((entry) => ({ ...entry, document: structuredClone(entry.document) }));
    mutate(candidateManifest, candidateMessages);
    const rejected = validateDocuments({ manifest: candidateManifest, messages: candidateMessages, sourceLedger, validate }).length > 0;
    checks.push({ name, passed: rejected });
  };

  reject("rejects sent status", (candidateManifest) => {
    candidateManifest.bundleStatus = "SENT";
  });
  reject("rejects duplicate candidate", (_candidateManifest, candidateMessages) => {
    candidateMessages[1].document.candidateId = candidateMessages[0].document.candidateId;
  });
  reject("rejects unknown evidence source", (_candidateManifest, candidateMessages) => {
    candidateMessages[0].document.sourceRefs = ["SRC-NOT-IN-LEDGER"];
  });
  reject("rejects payment-gate bypass", (_candidateManifest, candidateMessages) => {
    const pcbaMessage = candidateMessages.find((entry) => entry.document.candidateRole === "PCBA_CANDIDATE");
    pcbaMessage.document.replyIntake.paymentGate = "CROSSCHECK_ONLY_NOT_A_PCBA_PAYMENT_GATE";
  });
  return checks;
}

async function collectInputSources(manifest, messages) {
  const requested = manifest.sourceDocuments.map((source) => ({ ...source }));
  requested.push(
    {
      id: "OUTBOUND_SCHEMA",
      path: `${outboundRelative}/schema.json`,
      purpose: "Strict outbound template schema",
      distribution: "MANIFEST_ONLY",
    },
    {
      id: "OUTBOUND_MANIFEST",
      path: `${outboundRelative}/manifest.template.json`,
      purpose: "Deterministic outbound bundle input manifest",
      distribution: "MANIFEST_ONLY",
    },
    {
      id: "OUTBOUND_BUILDER",
      path: toPosix(path.relative(root, fileURLToPath(import.meta.url))),
      purpose: "Deterministic local builder implementation",
      distribution: "MANIFEST_ONLY",
    },
  );
  for (const message of messages) {
    requested.push({
      id: `OUTBOUND_TEMPLATE_${message.document.messageId}`,
      path: message.relativePath,
      purpose: `Prepared outbound template for ${message.document.candidateId}`,
      distribution: "MANIFEST_ONLY",
    });
  }
  if (!unique(requested.map((source) => source.id))) fail("input source IDs must be unique after builder inputs are added");
  if (!unique(requested.map((source) => source.path))) fail("input source paths must be unique after builder inputs are added");

  const sources = [];
  for (const source of requested) {
    const bytes = await readFile(resolveRepoPath(source.path, `source ${source.id}`));
    sources.push({
      id: source.id,
      path: source.path,
      purpose: source.purpose,
      distribution: source.distribution,
      bytes: bytes.length,
      sha256: sha256(bytes),
      rawBytes: bytes,
    });
  }
  return sources.sort((left, right) => left.id.localeCompare(right.id));
}

function buildExpectedOutput({ manifest, messages, inputSources }) {
  const output = new Map();
  const messageRecords = [];
  const referenceRecords = [];

  for (const source of inputSources.filter((item) => item.distribution === "INCLUDE_IN_BUNDLE")) {
    const fileName = path.posix.basename(source.path);
    const outputPath = `reference/${source.id}-${fileName}`;
    output.set(outputPath, source.rawBytes);
    referenceRecords.push({
      id: source.id,
      outputPath,
      bytes: source.rawBytes.length,
      sha256: sha256(source.rawBytes),
    });
  }

  for (const { document: message } of [...messages].sort((left, right) => left.document.messageId.localeCompare(right.document.messageId))) {
    const emailPath = `messages/${message.messageId}.email.txt`;
    const checklistPath = `messages/${message.messageId}.attachment-request-checklist.md`;
    const recipientPath = `messages/${message.messageId}.recipient-entry.json`;
    const email = Buffer.from(renderEmail(message), "utf8");
    const checklist = Buffer.from(renderChecklist(message), "utf8");
    const recipient = Buffer.from(renderRecipientEntry(message), "utf8");
    output.set(emailPath, email);
    output.set(checklistPath, checklist);
    output.set(recipientPath, recipient);
    messageRecords.push({
      messageId: message.messageId,
      candidateId: message.candidateId,
      candidateRole: message.candidateRole,
      messageStatus: message.messageStatus,
      subject: message.subject,
      sourceRefs: [...message.sourceRefs].sort(),
      replyIntake: message.replyIntake,
      artifacts: [
        { path: emailPath, bytes: email.length, sha256: sha256(email), mediaType: "text/plain; charset=utf-8" },
        { path: checklistPath, bytes: checklist.length, sha256: sha256(checklist), mediaType: "text/markdown; charset=utf-8" },
        { path: recipientPath, bytes: recipient.length, sha256: sha256(recipient), mediaType: "application/json" },
      ],
    });
  }

  const sourceFiles = inputSources.map(({ rawBytes, ...source }) => source);
  const reproducibleCore = {
    schemaVersion: 1,
    bundleId: manifest.bundleId,
    bundleStatus: manifest.bundleStatus,
    deliveryMode: manifest.deliveryMode,
    sourceFiles,
    messageRecords,
    referenceRecords,
  };
  const reproducibleId = `sha256:${sha256(Buffer.from(canonicalJson(reproducibleCore), "utf8"))}`;
  const bundleManifest = {
    schemaVersion: 1,
    documentKind: "mb1-outbound-build",
    bundleId: manifest.bundleId,
    bundleStatus: manifest.bundleStatus,
    deliveryMode: manifest.deliveryMode,
    reproducibleId,
    sourceFiles,
    messages: messageRecords,
    includedReferenceFiles: referenceRecords,
    replyPolicy: {
      rawEvidenceRoot: "build/vendor-evidence/<candidate>/<received-at>/raw/",
      responseTemplate: "hardware/evt0/vendor-evidence-v1/candidate.template.json",
      responseValidation: "npm run validate:vendor-evidence",
      targetBindingEffect: "NONE_VENDOR_CLAIM_ONLY",
      paymentAuthorization: "NOT_GRANTED_BY_THIS_BUNDLE",
    },
  };
  output.set("bundle-manifest.json", Buffer.from(stableJson(bundleManifest), "utf8"));
  output.set("DELIVERY-RUNBOOK.txt", Buffer.from(renderRunbook({ bundleId: manifest.bundleId, reproducibleId, messages: messageRecords }), "utf8"));
  return { output, reproducibleId, bundleManifest };
}

async function listFiles(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(absolute, relative));
    else if (entry.isFile()) result.push(relative);
    else fail(`unexpected non-file entry in build output: ${relative}`);
  }
  return result;
}

async function verifyOutput(expected) {
  const errors = [];
  const actualPaths = await listFiles(outputRoot);
  const expectedPaths = [...expected.keys()].sort();
  if (!exactSet(actualPaths, expectedPaths)) {
    const missing = expectedPaths.filter((item) => !actualPaths.includes(item));
    const unexpected = actualPaths.filter((item) => !expectedPaths.includes(item));
    if (missing.length) errors.push(`missing output files: ${missing.join(", ")}`);
    if (unexpected.length) errors.push(`unexpected output files: ${unexpected.join(", ")}`);
  }
  for (const relativePath of expectedPaths) {
    const absolutePath = path.join(outputRoot, ...relativePath.split("/"));
    try {
      const actual = await readFile(absolutePath);
      const expectedBytes = expected.get(relativePath);
      if (!actual.equals(expectedBytes)) errors.push(`non-deterministic or stale output: ${relativePath}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return errors;
}

async function writeOutput(expected) {
  const normalizedOutputRoot = path.resolve(outputRoot);
  const expectedOutputRoot = path.resolve(root, "build", "vendor-outbound-v1");
  if (normalizedOutputRoot !== expectedOutputRoot) fail("refusing to write outside build/vendor-outbound-v1");
  await rm(outputRoot, { recursive: true, force: true });
  for (const [relativePath, bytes] of [...expected.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const target = path.join(outputRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => !["--check"].includes(argument))) fail(`unsupported argument(s): ${args.join(" ")}`);
  const checkOnly = args.includes("--check");
  const schema = await readJson(`${outboundRelative}/schema.json`, "outbound schema");
  const manifest = await readJson(`${outboundRelative}/manifest.template.json`, "outbound manifest");
  const sourceLedger = await readJson("hardware/evt0/evidence-sources.json", "evidence ledger");
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  const validate = ajv.compile(schema);
  const messages = [];
  for (const relativePath of manifest.messageTemplatePaths) {
    messages.push({ relativePath, document: await readJson(relativePath, `message template ${relativePath}`) });
  }

  const errors = validateDocuments({ manifest, messages, sourceLedger, validate });
  if (errors.length > 0) {
    console.error("MB1 outbound input validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const selfTests = runNegativeSelfTests({ manifest, messages, sourceLedger, validate });
  const failedSelfTests = selfTests.filter((item) => !item.passed);
  if (failedSelfTests.length > 0) {
    console.error("MB1 outbound negative self-test failed:");
    for (const item of failedSelfTests) console.error(`- ${item.name}`);
    process.exitCode = 1;
    return;
  }

  const inputSources = await collectInputSources(manifest, messages);
  const { output, reproducibleId } = buildExpectedOutput({ manifest, messages, inputSources });
  if (checkOnly) {
    const outputErrors = await verifyOutput(output);
    if (outputErrors.length > 0) {
      console.error("MB1 outbound output check failed:");
      for (const error of outputErrors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }
  } else {
    await writeOutput(output);
    const outputErrors = await verifyOutput(output);
    if (outputErrors.length > 0) fail(`generated output did not verify: ${outputErrors.join(" | ")}`);
  }

  console.log("MB1 Outbound v1 valid: true");
  console.log(`Mode: ${checkOnly ? "check" : "build"}; status: PREPARED_NOT_SENT`);
  console.log(`Templates: ${messages.length}; negative self-tests: ${selfTests.filter((item) => item.passed).length}/${selfTests.length}`);
  console.log(`Reproducible ID: ${reproducibleId}`);
  console.log(`Output: ${outputRoot}`);
}

main().catch((error) => {
  console.error(`MB1 outbound builder failed: ${error.message}`);
  process.exitCode = 1;
});