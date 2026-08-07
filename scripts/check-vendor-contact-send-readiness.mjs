import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function flag(name) {
  return args.includes(name);
}

function insideRoot(label, target) {
  const absolute = path.resolve(root, target);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside repository root: ${target}`);
  }
  return absolute;
}

const workspacesRoot = insideRoot(
  "workspaces root",
  process.env.VENDOR_CONTACT_WORKSPACES_DIR ?? path.join("build", "vendor-contact-receipts"),
);
const recordsRoot = insideRoot(
  "records root",
  process.env.VENDOR_CONTACT_RECEIPT_RECORDS_DIR ?? path.join("hardware", "evt0", "vendor-contact-receipts-v1", "records"),
);
const currentOutboundRoot = insideRoot(
  "current outbound root",
  process.env.VENDOR_CONTACT_OUTBOUND_DIR ?? path.join("build", "vendor-outbound-v1"),
);
const reportPath = insideRoot(
  "report path",
  process.env.VENDOR_CONTACT_SEND_READINESS_REPORT_PATH ?? path.join("build", "vendor-contact-send-readiness.json"),
);
const schemaPath = path.join(root, "hardware", "evt0", "vendor-contact-receipts-v1", "schema.json");
const evidenceLedgerPath = path.join(root, "hardware", "evt0", "evidence-sources.json");

const receiptId = option("--receipt-id");
const all = flag("--all");
if ((receiptId ? 1 : 0) + (all ? 1 : 0) !== 1) {
  console.error("Usage: node scripts/check-vendor-contact-send-readiness.mjs (--all | --receipt-id <id>)");
  process.exit(2);
}
if (receiptId && !/^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/.test(receiptId)) {
  console.error("--receipt-id must use 3-81 ASCII letters, digits, dot, underscore or hyphen");
  process.exit(2);
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
  const core = {
    schemaVersion: manifest.schemaVersion,
    bundleId: manifest.bundleId,
    bundleStatus: manifest.bundleStatus,
    deliveryMode: manifest.deliveryMode,
    sourceFiles: manifest.sourceFiles,
    messageRecords: manifest.messages,
    referenceRecords: manifest.includedReferenceFiles,
  };
  return `sha256:${sha256(Buffer.from(canonicalJson(core), "utf8"))}`;
}

function sameStrings(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function fileFact(target) {
  const bytes = await readFile(target);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

async function treeFacts(directory) {
  const facts = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        const fact = await fileFact(target);
        facts.push({
          path: path.relative(directory, target).replaceAll("\\", "/"),
          ...fact,
        });
      }
    }
  }
  await visit(directory);
  return {
    files: facts,
    sha256: sha256(Buffer.from(canonicalJson(facts), "utf8")),
  };
}

function repositoryPath(target) {
  const absolute = path.resolve(root, target);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return { absolute, relative: relative.replaceAll("\\", "/") };
}

function checkCollector(workspaceId) {
  const checks = [];
  const errors = [];
  function check(name, passed, detail) {
    const record = { name, passed: Boolean(passed), detail };
    checks.push(record);
    if (!record.passed) errors.push(`${workspaceId}: ${name}: ${detail}`);
  }
  return { checks, errors, check };
}

const schema = await readJson(schemaPath);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateDraft = ajv.compile(schema);
const evidenceLedger = await readJson(evidenceLedgerPath);
const evidenceSources = new Map((evidenceLedger.sources ?? []).map((source) => [source.id, source]));
const currentManifestPath = path.join(currentOutboundRoot, "bundle-manifest.json");
const currentManifestBytes = await readFile(currentManifestPath);
const currentManifest = JSON.parse(currentManifestBytes.toString("utf8"));
const currentTree = await treeFacts(currentOutboundRoot);

let workspaceIds;
if (all) {
  const entries = await readdir(workspacesRoot, { withFileTypes: true });
  workspaceIds = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
} else {
  workspaceIds = [receiptId];
}

const recordFiles = (await readdir(recordsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
const formalReceiptIds = new Set();
for (const entry of recordFiles) {
  const record = await readJson(path.join(recordsRoot, entry.name));
  if (typeof record.receiptId === "string") formalReceiptIds.add(record.receiptId);
}

const workspaceReports = [];
const allErrors = [];
for (const workspaceId of workspaceIds) {
  const workspaceRoot = path.join(workspacesRoot, workspaceId);
  const draftPath = path.join(workspaceRoot, "receipt.draft.json");
  const checklistPath = path.join(workspaceRoot, "SEND-CHECKLIST.txt");
  const archiveRoot = path.join(workspaceRoot, "outbound");
  const archiveManifestPath = path.join(archiveRoot, "bundle-manifest.json");
  const rawRoot = path.join(workspaceRoot, "raw");
  const collector = checkCollector(workspaceId);
  const { check } = collector;

  check("workspace exists", await exists(workspaceRoot), workspaceRoot);
  if (!(await exists(workspaceRoot))) {
    allErrors.push(...collector.errors);
    workspaceReports.push({ receiptId: workspaceId, ready: false, checks: collector.checks, errors: collector.errors });
    continue;
  }

  check("required files", (await exists(draftPath)) && (await exists(checklistPath)) && (await exists(archiveManifestPath)) && (await exists(rawRoot)), "draft, checklist, archived manifest and raw directory exist");
  if (!(await exists(draftPath)) || !(await exists(archiveManifestPath)) || !(await exists(rawRoot))) {
    allErrors.push(...collector.errors);
    workspaceReports.push({ receiptId: workspaceId, ready: false, checks: collector.checks, errors: collector.errors });
    continue;
  }

  const draft = await readJson(draftPath);
  const schemaValid = validateDraft(draft);
  check("draft schema", schemaValid, schemaValid ? "valid" : ajv.errorsText(validateDraft.errors));
  check("directory receipt binding", draft.receiptId === workspaceId, `${draft.receiptId} == ${workspaceId}`);
  check("pending state", draft.submission?.state === "PENDING" && draft.decision?.status === "PENDING_SEND", `${draft.submission?.state}/${draft.decision?.status}`);
  check("pending facts empty", draft.contactEndpoint?.verifiedAt === null && draft.contactEndpoint?.recipientKind === null && draft.contactEndpoint?.recipientValue === null && draft.submission?.sentAt === null && draft.submission?.channel === null && draft.submission?.transportReference === null && draft.rawArtifacts?.length === 0, "draft carries no endpoint or submission facts");
  check("effects fixed", draft.targetBindingEffect === "NONE_CONTACT_ONLY" && draft.paymentEffect === "NONE_AWAIT_VENDOR_RESPONSE", `${draft.targetBindingEffect}/${draft.paymentEffect}`);
  check("formal record absent", !formalReceiptIds.has(workspaceId), formalReceiptIds.has(workspaceId) ? "formal record already exists" : "no formal record");

  const rawEntries = await readdir(rawRoot, { withFileTypes: true });
  check("raw directory empty", rawEntries.length === 0, `${rawEntries.length} entries`);

  const archiveManifestBytes = await readFile(archiveManifestPath);
  const archiveManifest = JSON.parse(archiveManifestBytes.toString("utf8"));
  const declaredManifest = repositoryPath(draft.outboundBundle?.manifestPath);
  check("manifest path bound", declaredManifest?.absolute === archiveManifestPath, draft.outboundBundle?.manifestPath);
  check("archived manifest identity", draft.outboundBundle?.manifestBytes === archiveManifestBytes.length && draft.outboundBundle?.manifestSha256 === sha256(archiveManifestBytes), `${archiveManifestBytes.length} bytes / ${sha256(archiveManifestBytes)}`);
  check("archived bundle contract", archiveManifest.schemaVersion === 1 && archiveManifest.documentKind === "mb1-outbound-build" && archiveManifest.bundleStatus === "PREPARED_NOT_SENT" && archiveManifest.deliveryMode === "MANUAL_OFFICIAL_ENTRY_ONLY" && draft.outboundBundle?.bundleId === archiveManifest.bundleId, `${archiveManifest.bundleId}/${archiveManifest.bundleStatus}/${archiveManifest.deliveryMode}`);
  check("archived reproducible id", archiveManifest.reproducibleId === recomputeBundleId(archiveManifest) && draft.outboundBundle?.reproducibleId === archiveManifest.reproducibleId, archiveManifest.reproducibleId);
  check("current outbound parity", sha256(archiveManifestBytes) === sha256(currentManifestBytes) && archiveManifest.reproducibleId === currentManifest.reproducibleId, `${archiveManifest.reproducibleId} / current ${currentManifest.reproducibleId}`);

  const message = archiveManifest.messages?.find((entry) => entry.messageId === draft.messageId);
  check("message exists", Boolean(message), draft.messageId);
  if (message) {
    check("message candidate binding", message.candidateId === draft.candidateId, `${message.candidateId} == ${draft.candidateId}`);
    check("message source binding", sameStrings(message.sourceRefs, draft.sourceRefs), `${JSON.stringify(message.sourceRefs)} == ${JSON.stringify(draft.sourceRefs)}`);
  }

  const messageArtifact = repositoryPath(draft.outboundBundle?.messageArtifactPath);
  const recipientArtifact = repositoryPath(draft.outboundBundle?.recipientArtifactPath);
  const expectedPrefix = `${path.relative(root, archiveRoot).replaceAll("\\", "/")}/`;
  check("artifact paths bound", Boolean(messageArtifact && recipientArtifact && messageArtifact.relative.startsWith(expectedPrefix) && recipientArtifact.relative.startsWith(expectedPrefix)), expectedPrefix);
  if (messageArtifact && recipientArtifact && await exists(messageArtifact.absolute) && await exists(recipientArtifact.absolute)) {
    const messageFact = await fileFact(messageArtifact.absolute);
    const recipientFact = await fileFact(recipientArtifact.absolute);
    check("message artifact identity", messageFact.bytes === draft.outboundBundle.messageArtifactBytes && messageFact.sha256 === draft.outboundBundle.messageArtifactSha256, `${messageFact.bytes} bytes / ${messageFact.sha256}`);
    check("recipient artifact identity", recipientFact.bytes === draft.outboundBundle.recipientArtifactBytes && recipientFact.sha256 === draft.outboundBundle.recipientArtifactSha256, `${recipientFact.bytes} bytes / ${recipientFact.sha256}`);
    const recipient = await readJson(recipientArtifact.absolute);
    check("recipient message binding", recipient.messageId === draft.messageId && recipient.candidateId === draft.candidateId, `${recipient.messageId}/${recipient.candidateId}`);
    check("official entry binding", recipient.recipientEntry?.officialEntryUrl === draft.contactEndpoint?.officialEntryUrl, `${recipient.recipientEntry?.officialEntryUrl} == ${draft.contactEndpoint?.officialEntryUrl}`);
  } else {
    check("message artifact identity", false, "declared message artifact missing");
    check("recipient artifact identity", false, "declared recipient artifact missing");
    check("recipient message binding", false, "declared recipient artifact missing");
    check("official entry binding", false, "declared recipient artifact missing");
  }

  const sources = draft.sourceRefs?.map((id) => evidenceSources.get(id)) ?? [];
  check("source refs exist", sources.length > 0 && sources.every(Boolean), JSON.stringify(draft.sourceRefs));
  check("official source URL bound", sources.some((source) => source?.url === draft.contactEndpoint?.officialEntryUrl), draft.contactEndpoint?.officialEntryUrl);

  const archiveTree = await treeFacts(archiveRoot);
  check("archived tree parity", archiveTree.sha256 === currentTree.sha256, `${archiveTree.files.length} files / ${archiveTree.sha256}`);

  allErrors.push(...collector.errors);
  workspaceReports.push({
    receiptId: workspaceId,
    messageId: draft.messageId,
    candidateId: draft.candidateId,
    ready: collector.errors.length === 0,
    archivedTree: { fileCount: archiveTree.files.length, sha256: archiveTree.sha256 },
    checks: collector.checks,
    errors: collector.errors,
  });
}

const report = {
  schemaVersion: 1,
  reportKind: "vendor-contact-send-readiness",
  checkedAt: new Date().toISOString(),
  mode: all ? "ALL" : "ONE",
  requestedReceiptId: receiptId,
  ready: allErrors.length === 0 && workspaceReports.length > 0,
  currentOutbound: {
    reproducibleId: currentManifest.reproducibleId,
    manifestBytes: currentManifestBytes.length,
    manifestSha256: sha256(currentManifestBytes),
    treeFileCount: currentTree.files.length,
    treeSha256: currentTree.sha256,
  },
  workspaceCount: workspaceReports.length,
  readyWorkspaceCount: workspaceReports.filter((workspace) => workspace.ready).length,
  workspaces: workspaceReports,
  errors: allErrors,
  effects: {
    submission: "NONE_PREFLIGHT_ONLY",
    supplierResponse: "NONE",
    targetBinding: "NONE_CONTACT_ONLY",
    payment: "NONE_AWAIT_VENDOR_RESPONSE",
  },
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (!report.ready) {
  console.error(`Vendor contact send readiness: FAIL (${report.readyWorkspaceCount}/${report.workspaceCount} ready)`);
  for (const error of allErrors) console.error(`- ${error}`);
  console.error(`Report: ${reportPath}`);
  process.exit(1);
}

console.log(`Vendor contact send readiness: PASS (${report.readyWorkspaceCount}/${report.workspaceCount} ready)`);
console.log(`Outbound: ${report.currentOutbound.reproducibleId}`);
for (const workspace of workspaceReports) {
  console.log(`- ${workspace.receiptId}: ${workspace.messageId} -> ${workspace.candidateId}`);
}
console.log("Effects: preflight only; submission/response/payment/target binding unchanged");
console.log(`Report: ${reportPath}`);
