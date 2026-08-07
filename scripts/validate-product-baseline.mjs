import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { gateIdsForReportScope } from "../contracts/release-gates-v1.mjs";
import { canonicalSha256, snapshotHashInput } from "./snapshot-jcs.mjs";
import { snapshotProjectionErrors } from "./snapshot-projection-validator.mjs";

const root = process.cwd();
const errors = [];
const warnings = [];
const checks = [];

function check(name, condition, detail) {
  checks.push({ name, passed: Boolean(condition), detail });
  if (!condition) errors.push(`${name}: ${detail}`);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function formatAjvErrors(validationErrors) {
  return (validationErrors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

function allUnique(values) {
  return new Set(values).size === values.length;
}

function parseSimpleCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return {
    header,
    rows: lines.slice(1).map((line, index) => {
      const values = line.split(",");
      if (values.length !== header.length) {
        errors.push(`board-evidence-matrix row ${index + 2}: expected ${header.length} columns, got ${values.length}`);
      }
      return Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""]));
    }),
  };
}

const codes = await readJson("hardware/evt0/golden-24/codes.json");
check("golden fixture schema", codes.schemaVersion === 1, `schemaVersion=${codes.schemaVersion}`);
check("golden fixture status", codes.status === "DESIGN_READY_HARDWARE_BLOCKED", `status=${codes.status}`);
check("golden fixture count", codes.entries?.length === 24, `entries=${codes.entries?.length ?? 0}`);
check("golden slot uniqueness", new Set(codes.entries.map((entry) => entry.slot)).size === 24, "slots must be unique");
check("golden OID uniqueness", new Set(codes.entries.map((entry) => entry.logicalOid)).size === 24, "logical OIDs must be unique");
check(
  "physical code evidence gate",
  codes.entries.every((entry) => entry.physicalCode === null && entry.physicalCodeStatus === "UNASSIGNED_PENDING_CODE_TOOL"),
  "design fixture must keep all physical codes unassigned until the target tool is frozen",
);
check(
  "play policy coverage",
  ["replace", "queue", "random_one"].every((policy) => codes.entries.some((entry) => entry.playPolicy === policy)),
  "replace/queue/random_one are all required",
);
check("negative fixture count", codes.negativeCases?.length === 6, `negativeCases=${codes.negativeCases?.length ?? 0}`);

const evidence = await readJson("hardware/evt0/evidence-sources.json");
const sourceIds = evidence.sources.map((source) => source.id);
check("evidence source uniqueness", new Set(sourceIds).size === sourceIds.length, "source IDs must be unique");
for (const source of evidence.sources) {
  if (source.httpStatus === 200) {
    check(
      `evidence hash ${source.id}`,
      /^[A-F0-9]{64}$/.test(source.sha256 ?? "") && source.bytes > 0,
      "HTTP 200 sources require byte count and uppercase SHA-256",
    );
  } else {
    warnings.push(`${source.id}: remote refresh status ${source.httpStatus}; keep at ${source.grade} until a stronger source or sample is available`);
  }
}

const rustEvidence = await readJson("hardware/evt0/rust-firmware-evidence.json");
const rustSourceIds = rustEvidence.sources.map((source) => source.id);
check("Rust evidence source uniqueness", new Set(rustSourceIds).size === rustSourceIds.length, "Rust source IDs must be unique");
for (const source of rustEvidence.sources) {
  check(
    `Rust evidence identity ${source.id}`,
    /^SRC-RUST-[0-9]{3}$/.test(source.id)
      && /^[a-f0-9]{40}$/.test(source.commitSha)
      && /^[a-f0-9]{64}$/.test(source.sha256)
      && source.httpStatus === 200
      && source.bytes > 0,
    "fixed commit HTTP 200 byte count and lowercase SHA-256 are required",
  );
}

const citedSourceIds = new Set(codes.entries.flatMap((entry) => entry.evidenceRefs).filter((ref) => ref.startsWith("SRC-")));
check(
  "golden evidence references",
  [...citedSourceIds].every((id) => sourceIds.includes(id)),
  `unknown refs=${[...citedSourceIds].filter((id) => !sourceIds.includes(id)).join("|") || "none"}`,
);

const boardCsv = parseSimpleCsv(await readFile(path.join(root, "hardware/evt0/board-evidence-matrix.csv"), "utf8"));
const requiredColumns = [
  "candidate_id", "role", "status", "evidence_grade", "vendor", "board_mpn", "pcb_rev", "head_mpn",
  "head_rev", "firmware_version", "mcu", "storage", "oid_capacity_claim", "code_tool", "print_tool",
  "event_interface", "timestamp_observability", "audio_codecs", "usb_data", "wireless", "build_cli",
  "flash_cli", "offline_proven", "supply_proven", "source_ids", "blocking_gap",
];
check("board matrix columns", JSON.stringify(boardCsv.header) === JSON.stringify(requiredColumns), "header must match the locked v1 column order");
check("board matrix IDs", new Set(boardCsv.rows.map((row) => row.candidate_id)).size === boardCsv.rows.length, "candidate IDs must be unique");
for (const row of boardCsv.rows) {
  for (const id of row.source_ids.split("|").filter((id) => id.startsWith("SRC-"))) {
    check(`board source ${row.candidate_id}/${id}`, sourceIds.includes(id), "source ID must exist in evidence-sources.json");
  }
  if (row.role === "BOARD_TARGET_CANDIDATE") {
    check(
      `board candidate remains gated ${row.candidate_id}`,
      row.status === "EVIDENCE_REQUIRED" && row.offline_proven === "NO" && row.supply_proven === "NO",
      "candidate cannot be promoted before offline and supply evidence",
    );
  }
}

const readinessCsv = parseSimpleCsv(await readFile(path.join(root, "hardware/evt0/firmware-readiness-matrix.csv"), "utf8"));
const readinessColumns = [
  "candidate_id", "status", "runtime_route", "target_triple", "toolchain", "hal_os",
  "firmware_source_or_c_abi", "provider_ownership", "abi_layout_probe", "oid_queue_evidence",
  "audio_timestamp_class", "storage_durability", "transport_stream",
  "c_reference_build", "rust_build", "flash_boot_sample_a",
  "flash_boot_sample_b", "rust_oid", "rust_storage", "rust_audio", "rust_usb", "rust_logs",
  "c_rust_differential", "cargo_lock_rebuild", "unsafe_boundary_audit", "source_ids", "blocking_gap",
];
check(
  "firmware readiness columns",
  JSON.stringify(readinessCsv.header) === JSON.stringify(readinessColumns),
  "header must match the locked v1 column order",
);
check(
  "firmware readiness IDs",
  new Set(readinessCsv.rows.map((row) => row.candidate_id)).size === readinessCsv.rows.length,
  "candidate IDs must be unique",
);
check(
  "firmware readiness covers board matrix",
  boardCsv.rows.every((row) => readinessCsv.rows.some((candidate) => candidate.candidate_id === row.candidate_id)),
  "every board row needs a firmware-readiness row",
);
for (const row of readinessCsv.rows) {
  for (const id of row.source_ids.split("|").filter((id) => id.startsWith("SRC-"))) {
    check(
      `firmware source ${row.candidate_id}/${id}`,
      sourceIds.includes(id) || rustSourceIds.includes(id),
      "source ID must exist in product or Rust evidence",
    );
  }
  if (row.status === "EVIDENCE_REQUIRED") {
    const gates = readinessColumns.slice(2, 19);
    check(
      `firmware candidate remains gated ${row.candidate_id}`,
      gates.every((column) => row[column] === "PENDING") && row.blocking_gap.length > 0,
      "all Rust/C ABI and two-sample proof fields stay pending until physical evidence exists",
    );
  }
}

const snapshotSchema = await readJson("hardware/evt0/snapshot-v1/schema.json");
const logicalIndexSchema = await readJson("hardware/evt0/snapshot-v1/logical-index.schema.json");
const actionsSchema = await readJson("hardware/evt0/snapshot-v1/actions.schema.json");
const snapshotAjv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
snapshotAjv.addFormat("date-time", {
  type: "string",
  validate: (value) => typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && !Number.isNaN(Date.parse(value)),
});
const validateSnapshot = snapshotAjv.compile(snapshotSchema);
const validateLogicalIndex = snapshotAjv.compile(logicalIndexSchema);
const validateActions = snapshotAjv.compile(actionsSchema);
const jcsVectors = await readJson("hardware/evt0/snapshot-v1/golden-vectors.json");
for (const vector of jcsVectors.vectors) {
  const actual = canonicalSha256(JSON.parse(vector.inputJson));
  check(`JCS canonical ${vector.id}`, actual.canonical === vector.expectedCanonical, "canonical text must match the RFC-backed vector");
  check(`JCS hash ${vector.id}`, actual.sha256 === vector.expectedSha256, `expected=${vector.expectedSha256} actual=${actual.sha256}`);
}
const designDir = path.join(root, "hardware/evt0/snapshot-v1/design");
const manifestBytes = await readFile(path.join(designDir, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const snapshotSchemaValid = validateSnapshot(manifest);
check(
  "snapshot manifest schema",
  snapshotSchemaValid,
  snapshotSchemaValid ? "strict Draft 2020-12 validation passed" : formatAjvErrors(validateSnapshot.errors),
);
check("snapshot schema version", manifest.schemaVersion === 1, `schemaVersion=${manifest.schemaVersion}`);
check("snapshot design state", manifest.releaseState === "design-fixture", `releaseState=${manifest.releaseState}`);
check("snapshot target gate", manifest.target?.boardTarget === "UNFROZEN" && manifest.target?.physicalMapStatus === "unassigned", "design snapshot must remain hardware-blocked");
check("snapshot atomic semantics", manifest.install?.activationMode === "staged-atomic" && manifest.install?.lastGoodRequired === true, "staged-atomic + last-good are required");

function safeRelativePath(value) {
  return typeof value === "string" && !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..");
}

for (const file of manifest.files) {
  check(`snapshot safe path ${file.path}`, safeRelativePath(file.path), "paths must be relative and contain no ..");
  const absolute = path.join(designDir, file.path);
  const buffer = await readFile(absolute);
  check(`snapshot size ${file.path}`, buffer.length === file.size, `manifest=${file.size} actual=${buffer.length}`);
  check(`snapshot hash ${file.path}`, sha256(buffer) === file.sha256, `manifest=${file.sha256} actual=${sha256(buffer)}`);
}

const logicalIndex = await readJson("hardware/evt0/snapshot-v1/design/logical-index.json");
const actions = await readJson("hardware/evt0/snapshot-v1/design/actions.json");
const manifestFileMap = new Map(manifest.files.map((file) => [file.path, file]));
check("snapshot manifest path uniqueness", manifestFileMap.size === manifest.files.length, "manifest file paths must be unique");
const manifestIndexFile = manifestFileMap.get(manifest.oidIndex.path);
check(
  "snapshot manifest index reference",
  manifestIndexFile?.role === "oid-index" && manifestIndexFile.size === manifest.oidIndex.size
    && manifestIndexFile.sha256 === manifest.oidIndex.sha256,
  "oidIndex path/size/hash must resolve to the oid-index manifest file",
);
const manifestActionsFile = manifestFileMap.get(manifest.actions.path);
check(
  "snapshot manifest actions reference",
  manifestActionsFile?.role === "actions" && manifestActionsFile.size === manifest.actions.size
    && manifestActionsFile.sha256 === manifest.actions.sha256,
  "actions path/size/hash must resolve to the actions manifest file",
);
check(
  "snapshot required byte total",
  manifest.install.requiredBytes === manifest.files.reduce((sum, file) => sum + file.size, manifestBytes.length),
  "install.requiredBytes must equal manifest bytes plus payload file bytes",
);
const logicalIndexSchemaValid = validateLogicalIndex(logicalIndex);
check(
  "snapshot logical index schema",
  logicalIndexSchemaValid,
  logicalIndexSchemaValid ? "strict Draft 2020-12 validation passed" : formatAjvErrors(validateLogicalIndex.errors),
);
const actionsSchemaValid = validateActions(actions);
check(
  "snapshot actions schema",
  actionsSchemaValid,
  actionsSchemaValid ? "strict Draft 2020-12 validation passed" : formatAjvErrors(validateActions.errors),
);
check("snapshot index count", logicalIndex.entries?.length === manifest.oidIndex.entryCount && logicalIndex.entries.length === 24, `entries=${logicalIndex.entries?.length ?? 0}`);
check("snapshot action count", actions.actions?.length === manifest.actions.actionCount && actions.actions.length === 24, `actions=${actions.actions?.length ?? 0}`);

const indexEntries = Array.isArray(logicalIndex.entries) ? logicalIndex.entries : [];
const actionEntries = Array.isArray(actions.actions) ? actions.actions : [];
const indexPhysicalCodes = indexEntries.map((entry) => entry.physicalCode).filter((value) => value !== null);
const indexLogicalOids = indexEntries.map((entry) => entry.logicalOid);
const indexActionIds = indexEntries.map((entry) => entry.actionId);
const actionIds = actionEntries.map((action) => action.actionId);
const actionIdSet = new Set(actionIds);

check("snapshot index physical code uniqueness", allUnique(indexPhysicalCodes), "assigned physicalCode values must be unique");
check(
  "snapshot index physical code u64 range",
  indexPhysicalCodes.every((value) => {
    try { return BigInt(value) <= 18_446_744_073_709_551_615n; } catch { return false; }
  }),
  "assigned physicalCode values must fit u64",
);
check("snapshot index logical OID uniqueness", allUnique(indexLogicalOids), "logicalOid values must be unique");
check("snapshot index action reference uniqueness", allUnique(indexActionIds), "index actionId values must be unique");
check("snapshot action ID uniqueness", allUnique(actionIds), "action actionId values must be unique");
check(
  "snapshot action play-policy cardinality",
  actionEntries.every((action) => (action.playPolicy !== "replace" || action.clipIds.length === 1)
    && (action.playPolicy !== "random_one" || action.clipIds.length >= 2)),
  "replace requires one clip and random_one requires at least two clips",
);
check(
  "snapshot index action references",
  indexActionIds.every((actionId) => actionIdSet.has(actionId)),
  `missing=${indexActionIds.filter((actionId) => !actionIdSet.has(actionId)).join("|") || "none"}`,
);
check(
  "snapshot action index coverage",
  actionIds.every((actionId) => indexActionIds.includes(actionId)),
  `unreferenced=${actionIds.filter((actionId) => !indexActionIds.includes(actionId)).join("|") || "none"}`,
);

if (Array.isArray(actions.clips)) {
  const clipIds = actions.clips.map((clip) => clip.clipId);
  const clipPaths = actions.clips.map((clip) => clip.path);
  const clipIdSet = new Set(clipIds);
  const unresolvedClipIds = actionEntries
    .flatMap((action) => Array.isArray(action.clipIds) ? action.clipIds : [])
    .filter((clipId) => !clipIdSet.has(clipId));
  const referencedClipIdSet = new Set(actionEntries.flatMap((action) => action.clipIds));
  check("snapshot clip ID uniqueness", allUnique(clipIds), "clip catalog clipId values must be unique");
  check("snapshot clip path uniqueness", allUnique(clipPaths), "clip catalog path values must be unique");
  check(
    "snapshot action clip references",
    unresolvedClipIds.length === 0,
    `missing=${[...new Set(unresolvedClipIds)].join("|") || "none"}`,
  );
  check(
    "snapshot clip catalog coverage",
    clipIds.every((clipId) => referencedClipIdSet.has(clipId)),
    `unused=${clipIds.filter((clipId) => !referencedClipIdSet.has(clipId)).join("|") || "none"}`,
  );
  check(
    "snapshot clip manifest projection",
    actions.clips.every((clip) => {
      const file = manifestFileMap.get(clip.path);
      return file?.role === "audio" && file.size === clip.size && file.sha256 === clip.sha256 && file.codec === clip.codec;
    }),
    "every clip path/size/hash/codec must resolve to the same manifest audio file",
  );
}

const physicalMapConsistent = logicalIndex.physicalMapStatus === "unassigned"
  ? indexEntries.every((entry) => entry.physicalCode === null)
  : logicalIndex.physicalMapStatus === "assigned"
    && indexEntries.every((entry) => typeof entry.physicalCode === "string");
check(
  "snapshot physical map consistency",
  physicalMapConsistent,
  "unassigned requires all physicalCode values null; assigned requires all values populated",
);
check(
  "snapshot manifest/index physical map agreement",
  manifest.target.physicalMapStatus === logicalIndex.physicalMapStatus,
  "manifest target and logical index physicalMapStatus must match",
);
const sharedProjectionErrors = snapshotProjectionErrors({
  logicalIndex,
  actions,
  manifest,
  manifestByteLength: manifestBytes.length,
});
check(
  "snapshot shared projection semantics",
  sharedProjectionErrors.length === 0,
  sharedProjectionErrors.join("|") || "shared Schema-adjacent semantics passed",
);

const assignedNullIndex = structuredClone(logicalIndex);
assignedNullIndex.physicalMapStatus = "assigned";
check("snapshot schema rejects assigned null code", !validateLogicalIndex(assignedNullIndex), "assigned requires string physicalCode");
const unassignedCodeIndex = structuredClone(logicalIndex);
unassignedCodeIndex.entries[0].physicalCode = "1";
check("snapshot schema rejects unassigned populated code", !validateLogicalIndex(unassignedCodeIndex), "unassigned requires null physicalCode");
const replaceManyActions = structuredClone(actions);
replaceManyActions.actions.find((action) => action.playPolicy === "replace").clipIds.push("clip-schema-extra");
check("snapshot schema rejects replace multi-clip", !validateActions(replaceManyActions), "replace requires exactly one clip");
const randomSingleActions = structuredClone(actions);
const randomSchemaAction = randomSingleActions.actions.find((action) => action.playPolicy === "random_one");
randomSchemaAction.clipIds = [randomSchemaAction.clipIds[0]];
check("snapshot schema rejects random_one single clip", !validateActions(randomSingleActions), "random_one requires at least two clips");

const projectionNegativeCases = [
  {
    id: "u64-overflow",
    expectedError: "INDEX_PHYSICAL_CODE_OUT_OF_U64",
    mutate(index) {
      index.physicalMapStatus = "assigned";
      index.entries.forEach((entry, position) => { entry.physicalCode = String(position + 1); });
      index.entries[0].physicalCode = "18446744073709551616";
    },
  },
  {
    id: "duplicate-physical-code",
    expectedError: "INDEX_DUPLICATE_PHYSICAL_CODE",
    mutate(index) {
      index.physicalMapStatus = "assigned";
      index.entries.forEach((entry, position) => { entry.physicalCode = String(position + 1); });
      index.entries[1].physicalCode = index.entries[0].physicalCode;
    },
  },
  {
    id: "physical-code-order",
    expectedError: "INDEX_PHYSICAL_CODE_NOT_ASCENDING",
    mutate(index, _table, vectorManifest) {
      index.physicalMapStatus = "assigned";
      index.entries.forEach((entry, position) => { entry.physicalCode = String(position + 1); });
      [index.entries[0].physicalCode, index.entries[1].physicalCode]
        = [index.entries[1].physicalCode, index.entries[0].physicalCode];
      vectorManifest.target.physicalMapStatus = "assigned";
    },
  },
  {
    id: "duplicate-logical-oid",
    expectedError: "INDEX_DUPLICATE_LOGICALOID",
    mutate(index) { index.entries[1].logicalOid = index.entries[0].logicalOid; },
  },
  {
    id: "duplicate-index-action",
    expectedError: "INDEX_DUPLICATE_ACTIONID",
    mutate(index) { index.entries[1].actionId = index.entries[0].actionId; },
  },
  {
    id: "duplicate-action-id",
    expectedError: "ACTION_DUPLICATE_ACTION_ID",
    mutate(_index, table) { table.actions[1].actionId = table.actions[0].actionId; },
  },
  {
    id: "replace-cardinality",
    expectedError: "ACTION_REPLACE_CARDINALITY",
    mutate(_index, table) { table.actions.find((action) => action.playPolicy === "replace").clipIds.push("clip-semantic-extra"); },
  },
  {
    id: "random-cardinality",
    expectedError: "ACTION_RANDOM_ONE_CARDINALITY",
    mutate(_index, table) {
      const item = table.actions.find((action) => action.playPolicy === "random_one");
      item.clipIds = [item.clipIds[0]];
    },
  },
  {
    id: "manifest-index-count",
    expectedError: "MANIFEST_INDEX_COUNT_MISMATCH",
    mutate(_index, _table, vectorManifest) { vectorManifest.oidIndex.entryCount += 1; },
  },
  {
    id: "manifest-action-count",
    expectedError: "MANIFEST_ACTION_COUNT_MISMATCH",
    mutate(_index, _table, vectorManifest) { vectorManifest.actions.actionCount += 1; },
  },
  {
    id: "release-without-clip-catalog",
    expectedError: "RELEASE_CLIP_CATALOG_REQUIRED",
    mutate(index, _table, vectorManifest) {
      index.physicalMapStatus = "assigned";
      index.entries.forEach((entry, position) => { entry.physicalCode = String(position + 1); });
      vectorManifest.releaseState = "release-candidate";
      vectorManifest.snapshotId = `sha256:${"0".repeat(64)}`;
      vectorManifest.target.physicalMapStatus = "assigned";
    },
  },
  {
    id: "unused-manifest-audio",
    expectedError: "MANIFEST_AUDIO_FILE_UNUSED",
    mutate(_index, _table, vectorManifest) {
      vectorManifest.files.push({
        path: "audio/unused.wav",
        size: 1,
        sha256: "0".repeat(64),
        role: "audio",
        codec: "WAV_PCM16_16K_MONO",
      });
    },
  },
];
for (const vector of projectionNegativeCases) {
  const vectorIndex = structuredClone(logicalIndex);
  const vectorActions = structuredClone(actions);
  const vectorManifest = structuredClone(manifest);
  vector.mutate(vectorIndex, vectorActions, vectorManifest);
  const vectorErrors = snapshotProjectionErrors({
    logicalIndex: vectorIndex,
    actions: vectorActions,
    manifest: vectorManifest,
    manifestByteLength: manifestBytes.length,
  });
  check(
    `snapshot shared semantics rejects ${vector.id}`,
    vector.expectedError ? vectorErrors.includes(vector.expectedError) : vectorErrors.length > 0,
    `errors=${vectorErrors.join("|") || "none"}`,
  );
}
check(
  "snapshot design physical map",
  logicalIndex.physicalMapStatus === "unassigned" && logicalIndex.entries.every((entry) => entry.physicalCode === null),
  "design fixture must not invent physical codes",
);
const releaseWithoutAudio = structuredClone(manifest);
releaseWithoutAudio.releaseState = "release-candidate";
releaseWithoutAudio.snapshotId = `sha256:${"0".repeat(64)}`;
releaseWithoutAudio.target.physicalMapStatus = "assigned";
check(
  "snapshot schema rejects release without audio",
  !validateSnapshot(releaseWithoutAudio),
  "release-candidate manifest requires at least one role=audio file",
);
const designHash = canonicalSha256(snapshotHashInput(manifest));

let hostAudioValidated = false;
try {
  const hostAudioDir = path.join(root, "build/evt0-host-audio");
  const hostAudioManifest = JSON.parse(await readFile(path.join(hostAudioDir, "manifest.json"), "utf8"));
  check("host audio status", hostAudioManifest.status === "HOST_ONLY_NOT_TARGET_RELEASE", `status=${hostAudioManifest.status}`);
  check("host audio count", hostAudioManifest.artifactCount === 47 && hostAudioManifest.artifacts?.length === 47, `artifacts=${hostAudioManifest.artifacts?.length ?? 0}`);
  for (const artifact of hostAudioManifest.artifacts) {
    const buffer = await readFile(path.join(hostAudioDir, artifact.path));
    check(`host audio bytes ${artifact.path}`, buffer.length === artifact.bytes, `manifest=${artifact.bytes} actual=${buffer.length}`);
    check(
      `host audio hash ${artifact.path}`,
      sha256(buffer) === artifact.sha256,
      `manifest=${artifact.sha256} actual=${sha256(buffer)}`,
    );
  }
  hostAudioValidated = true;
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  warnings.push("Host audio fixtures are absent; run npm run generate:evt0-host-audio for deterministic host-only WAV/MP3 artifacts");
}

const requiredDocs = [
  "docs/system-concept.md",
  "docs/product-slice-evt0.md",
  "docs/snapshot-v1.md",
  "docs/family-alpha-v1.md",
  "docs/research/evidence-gate-audit-2026-08-03.md",
  "docs/research/product-system-evidence-2026.md",
  "docs/research/rust-firmware-feasibility-2026.md",
];
for (const relativePath of requiredDocs) {
  const file = await stat(path.join(root, relativePath));
  check(`required document ${relativePath}`, file.isFile() && file.size > 0, `size=${file.size}`);
}

const releaseGateCatalog = await readJson("hardware/evt0/release-gates-v1/catalog.json");
const reportScopeGateIds = gateIdsForReportScope(releaseGateCatalog, "product-baseline");

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  designBaselineValid: errors.length === 0,
  releaseGateCatalogId: releaseGateCatalog.catalogId,
  releaseDecisionOwner: "build/release-gate-current/release-decision.json",
  reportScopeGateIds,
  checkSummary: {
    total: checks.length,
    passed: checks.filter((item) => item.passed).length,
    failed: checks.filter((item) => !item.passed).length,
  },
  designSnapshotHash: designHash.sha256,
  hostAudioValidated,
  warnings,
  errors,
  checks,
};

await mkdir(path.join(root, "build"), { recursive: true });
await writeFile(
  path.join(root, "build/product-baseline-validation.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

console.log(`Design baseline valid: ${report.designBaselineValid}`);
console.log(`Checks: ${report.checkSummary.passed}/${report.checkSummary.total} passed`);
console.log(`Release decision owner: ${report.releaseDecisionOwner}`);
if (warnings.length) console.log(`Warnings: ${warnings.join(" | ")}`);
console.log(`Report: ${path.join(root, "build/product-baseline-validation.json")}`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
