import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const revisionRoot = path.join(root, "hardware", "evt0", "bom-revisions");
const errors = [];
const warnings = [];
const checks = [];
const tupleKeys = ["BOARD_MPN", "PCB_REV", "HEAD_MPN", "HEAD_REV", "FW_VERSION"];

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

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function releaseReady(document, rows, binding) {
  if (document.state !== "RELEASED" || document.activeBranch === "UNRESOLVED") return false;
  if (binding.targetIdentity.state !== "FROZEN") return false;
  if (!tupleKeys.every((key) => typeof document.targetIdentity[key] === "string" && document.targetIdentity[key].length > 0)) return false;
  const applicableRows = rows.filter((row) => row.applicability === "ALL" || row.applicability === document.activeBranch);
  if (applicableRows.length === 0 || applicableRows.some((row) => row.lock_state !== "LOCKED")) return false;
  return document.releaseReceiptRefs.length > 0 && document.approval.status === "APPROVED" &&
    typeof document.approval.approvedBy === "string" && document.approval.approvedBy.length > 0 &&
    typeof document.approval.approvedAt === "string" && !Number.isNaN(Date.parse(document.approval.approvedAt));
}

const schema = await readJson(path.join(revisionRoot, "schema.json"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)),
});
const validateSchema = ajv.compile(schema);

const revisionFiles = (await readdir(revisionRoot)).filter((file) => /^BOM-REV-.*\.json$/.test(file)).sort();
check("revision manifests exist", revisionFiles.length > 0, `count=${revisionFiles.length}`);

const manifests = [];
for (const file of revisionFiles) {
  const document = await readJson(path.join(revisionRoot, file));
  const schemaValid = validateSchema(document);
  check(`${file} JSON Schema`, schemaValid, schemaValid ? "valid" : ajv.errorsText(validateSchema.errors));

  const csvPath = path.join(root, document.sourceCsv.path);
  const csvBytes = await readFile(csvPath);
  const csvText = csvBytes.toString("utf8").replace(/^\uFEFF/, "").trimEnd();
  const csvLines = csvText.split(/\r?\n/);
  const header = parseCsvLine(csvLines[0]);
  const expectedHeader = [
    "item_id", "subsystem", "applicability", "target_mpn", "manufacturer", "build_qty",
    "planned_buy_qty_when_unblocked", "lock_state", "no_substitute", "blocking_evidence",
  ];
  check(`${file} CSV header`, JSON.stringify(header) === JSON.stringify(expectedHeader), header.join(","));
  const rows = csvLines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(header.map((name, index) => [name, values[index]]));
  });
  check(`${file} CSV hash`, sha256(csvBytes) === document.sourceCsv.sha256, `actual=${sha256(csvBytes)}`);
  check(`${file} CSV row count`, rows.length === document.sourceCsv.rowCount, `actual=${rows.length}`);
  check(`${file} unique item IDs`, new Set(rows.map((row) => row.item_id)).size === rows.length, "item_id must be unique");
  for (const row of rows) {
    check(`${file} ${row.item_id} applicability`, ["ALL", "INTEGRATED_MAINBOARD", "CUSTOM_BOARD"].includes(row.applicability), row.applicability);
    check(`${file} ${row.item_id} lock state`, ["LOCKED", "CANDIDATE", "BLOCKED"].includes(row.lock_state), row.lock_state);
    check(`${file} ${row.item_id} build qty`, Number.isInteger(Number(row.build_qty)) && Number(row.build_qty) > 0, row.build_qty);
    check(`${file} ${row.item_id} buy qty`, Number.isInteger(Number(row.planned_buy_qty_when_unblocked)) && Number(row.planned_buy_qty_when_unblocked) >= 0, row.planned_buy_qty_when_unblocked);
    check(`${file} ${row.item_id} no substitute`, ["true", "false"].includes(row.no_substitute), row.no_substitute);
    if (row.applicability === "CUSTOM_BOARD") {
      check(`${file} ${row.item_id} custom branch marker`, row.blocking_evidence.startsWith("CUSTOM_BOARD_BRANCH_ONLY_"), row.blocking_evidence);
    }
  }

  const bindingPath = path.join(root, document.targetBinding.path);
  const bindingBytes = await readFile(bindingPath);
  const binding = JSON.parse(bindingBytes.toString("utf8"));
  check(`${file} binding hash`, sha256(bindingBytes) === document.targetBinding.sha256, `actual=${sha256(bindingBytes)}`);
  if (document.state === "PENDING") {
    check(`${file} pending branch`, document.activeBranch === "UNRESOLVED", document.activeBranch);
    check(`${file} pending identity`, tupleKeys.every((key) => document.targetIdentity[key] === null), "pending baseline must not claim identity");
    check(`${file} pending receipts`, document.releaseReceiptRefs.length === 0, `count=${document.releaseReceiptRefs.length}`);
    check(`${file} pending approval`, document.approval.status === "PENDING" && document.approval.approvedBy === null && document.approval.approvedAt === null, document.approval.status);
    check(`${file} not released`, !releaseReady(document, rows, binding), "pending manifest must not pass release gate");
  } else {
    check(`${file} release gate`, releaseReady(document, rows, binding), "released manifest must satisfy target, branch, rows, receipts and approval");
  }
  manifests.push({ file, document, rows, binding });
}

check("unique revision IDs", new Set(manifests.map(({ document }) => document.bomRevisionId)).size === manifests.length, "bomRevisionId must be unique");
const forgedRelease = structuredClone(manifests[0]);
if (forgedRelease) {
  forgedRelease.document.state = "RELEASED";
  check("negative gate rejects unresolved release", !releaseReady(forgedRelease.document, forgedRelease.rows, forgedRelease.binding), "state-only promotion must fail");
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  valid: errors.length === 0,
  revisionCount: manifests.length,
  releasedRevisions: manifests.filter(({ document, rows, binding }) => releaseReady(document, rows, binding)).map(({ document }) => document.bomRevisionId),
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
await writeFile(path.join(root, "build", "bom-revision-validation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`BOM Revision v1 valid: ${report.valid}`);
console.log(`Checks: ${report.checkSummary.passed}/${report.checkSummary.total} passed`);
console.log(`Revisions: ${report.revisionCount}; released: ${report.releasedRevisions.length}`);
console.log(`Report: ${path.join(root, "build", "bom-revision-validation.json")}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
