import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function assertInside(target, parent, label) {
  const relative = path.relative(parent, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped its allowed root: ${target}`);
  }
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u).filter((line) => line.length > 0);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, parseCsvLine(line)[index] ?? ""])));
}

const profileId = option("--profile-id");
const recordId = option("--record-id");
if (!profileId || !recordId) {
  throw new Error("Usage: node scripts/prepare-benchmark-seller-evidence.mjs --profile-id <PROFILE_ID> --record-id <UNIQUE_RECORD_ID>");
}
if (!/^[A-Z0-9][A-Z0-9-]{2,95}$/u.test(recordId) || recordId === "BENCHMARK-SELLER-EVIDENCE-TEMPLATE") {
  throw new Error("--record-id must use 3-96 uppercase ASCII letters, digits or hyphens and must not be the template ID");
}

const contractRoot = path.join(root, "hardware", "evt0", "benchmark-seller-evidence-v1");
const workspaceBase = path.join(root, "build", "benchmark-seller-evidence");
const workspaceRoot = path.join(workspaceBase, recordId);
const recordPath = path.join(contractRoot, "records", `${recordId}.json`);
assertInside(workspaceRoot, workspaceBase, "Benchmark seller evidence workspace");

if (await exists(workspaceRoot)) throw new Error(`Evidence workspace already exists: ${workspaceRoot}`);
if (await exists(recordPath)) throw new Error(`Evidence record already exists: ${recordPath}`);

const catalogPath = path.join(contractRoot, "gate-catalog.json");
const schemaPath = path.join(contractRoot, "schema.json");
const templatePath = path.join(contractRoot, "record.template.json");
const purchasePlanPath = path.join(root, "hardware", "evt0", "purchase-plan.csv");
const evidenceSourcesPath = path.join(root, "hardware", "evt0", "evidence-sources.json");
const benchmarkReportPath = path.join(root, "docs", "research", "benchmark-sku-evidence-2026-08-04.md");
const benchmarkFollowupPath = path.join(root, "docs", "research", "benchmark-proof-followup-2026-08-04.md");

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const profile = catalog.profiles.find((entry) => entry.profileId === profileId);
if (!profile) {
  throw new Error(`Unknown --profile-id ${profileId}; available: ${catalog.profiles.map((entry) => entry.profileId).join(", ")}`);
}
if (!recordId.startsWith(`${profile.purchasePlanItemId}-SELLER-EVIDENCE-`)) {
  throw new Error(`--record-id must start with ${profile.purchasePlanItemId}-SELLER-EVIDENCE- for profile ${profileId}`);
}

const purchasePlanBytes = await readFile(purchasePlanPath);
const purchaseRows = parseCsv(purchasePlanBytes.toString("utf8"));
const purchaseRow = purchaseRows.find((row) => row.item_id === profile.purchasePlanItemId);
if (!purchaseRow) throw new Error(`Purchase-plan item ${profile.purchasePlanItemId} does not exist`);
if (purchaseRow.status !== profile.preparationStatus) {
  throw new Error(`Purchase-plan item ${profile.purchasePlanItemId} is ${purchaseRow.status}; profile expects preparation state ${profile.preparationStatus}`);
}

const evidenceLedger = JSON.parse(await readFile(evidenceSourcesPath, "utf8"));
const sourceById = new Map(evidenceLedger.sources.map((source) => [source.id, source]));
for (const baseline of profile.sourceBaselines) {
  const source = sourceById.get(baseline.id);
  if (!source || source.grade !== baseline.grade || source.bytes !== baseline.bytes || source.sha256 !== baseline.sha256) {
    throw new Error(`Source baseline ${baseline.id} drifted; create a reviewed profile revision before preparing a new request`);
  }
}

const requestLines = [
  "你好，我们只单买 1 件做早教点读笔的非破坏性对标和来料记录，需要买到本次资料对应的同一待发版本。",
  "",
  `本次待核对：产品代际 ${profile.requestedIdentity.productGeneration}；来源商品号 ${profile.requestedIdentity.sourceOrderSku}；套装容量标识 ${profile.requestedIdentity.bundleCapacityLabel}。`,
  "请以聊天原文件、原始照片和一个连续原始短视频回复；缩略图、宣传图或不同实物拼接不作为待发物证明。",
  "",
  ...profile.requirements.flatMap((requirement, index) => [
    `${index + 1}. ${requirement.title}`,
    `   ${requirement.description}`,
  ]),
  "",
  "请同时书面确认：上述照片和视频就是本订单的实际待发物，发货时不使用功能相同、随机批次或其他代际替代。收到并核对原件后再进入人工采购复核。",
  "",
];
const requestBytes = Buffer.from(requestLines.join("\n"), "utf8");
const generatedAt = new Date().toISOString();

const template = JSON.parse(await readFile(templatePath, "utf8"));
const draft = structuredClone(template);
draft.recordId = recordId;
draft.profileId = profile.profileId;
draft.purchasePlanItemId = profile.purchasePlanItemId;
draft.candidateId = profile.candidateId;
draft.preparedAt = generatedAt;
draft.sourceRefs = [...profile.sourceRefs];
draft.requestedIdentity = structuredClone(profile.requestedIdentity);
draft.requestTemplate = {
  path: `build/benchmark-seller-evidence/${recordId}/SELLER-REQUEST.txt`,
  bytes: requestBytes.length,
  sha256: sha256(requestBytes),
};
draft.requirementResults = profile.requirements.map((requirement) => ({
  id: requirement.id,
  status: "PENDING",
  observedValue: null,
  artifactRefs: [],
  notes: null,
}));
draft.decision = {
  status: "EVIDENCE_REQUIRED",
  reason: "Request workspace prepared; no request submission, seller response or same-item evidence has been recorded.",
  blockers: [
    "REQUEST_NOT_SENT",
    "SELLER_RESPONSE_PENDING",
    ...profile.requirements.map((requirement) => `${requirement.id}_PENDING`),
  ],
};

const sourceDefinitions = [
  ["CONTRACT_SCHEMA", schemaPath],
  ["RECORD_TEMPLATE", templatePath],
  ["GATE_CATALOG", catalogPath],
  ["PURCHASE_PLAN", purchasePlanPath],
  ["EVIDENCE_SOURCE_LEDGER", evidenceSourcesPath],
  ["BENCHMARK_SKU_REPORT", benchmarkReportPath],
  ["BENCHMARK_PROOF_FOLLOWUP", benchmarkFollowupPath],
];
const sourceFiles = [];
for (const [id, file] of sourceDefinitions) {
  const bytes = await readFile(file);
  sourceFiles.push({
    id,
    path: path.relative(root, file).replaceAll("\\", "/"),
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}

const sourceManifest = {
  schemaVersion: 1,
  profile: "benchmark-seller-evidence-workspace-v1",
  recordId,
  profileId: profile.profileId,
  generatedAt,
  status: "PREPARED_NOT_SENT",
  purchasePlanSnapshot: {
    itemId: purchaseRow.item_id,
    status: purchaseRow.status,
    candidateModel: purchaseRow.candidate_model,
  },
  requestedIdentity: structuredClone(profile.requestedIdentity),
  sourceBaselines: structuredClone(profile.sourceBaselines),
  retailListingBarcodeField: structuredClone(profile.retailListingBarcodeField),
  rawEvidenceRoot: `build/benchmark-seller-evidence/${recordId}/raw/`,
  recordDestination: `hardware/evt0/benchmark-seller-evidence-v1/records/${recordId}.json`,
  targetBindingEffect: catalog.targetBindingEffect,
  adapterEffect: catalog.adapterEffect,
  releaseGateEffect: catalog.releaseGateEffect,
  purchaseAuthorizationEffect: catalog.purchaseAuthorizationEffect,
  intakeEffect: catalog.intakeEffect,
  sourceFiles,
};

const checklist = [
  `# REF2 卖家同一待发物证据：${recordId}`,
  "",
  "- 当前状态：`PREPARED_NOT_SENT`",
  "- 当前采购表状态：`SELLER_PHOTO_REQUIRED`",
  "- 目标效果：`NONE_BENCHMARK_ONLY`",
  "- 付款授权：`NONE_HUMAN_DECISION_REQUIRED`",
  `- 原件目录：\`build/benchmark-seller-evidence/${recordId}/raw/\``,
  `- 记录目标：\`hardware/evt0/benchmark-seller-evidence-v1/records/${recordId}.json\``,
  "",
  "## 操作步骤",
  "",
  "1. 在实际店铺或平台聊天里发送 `SELLER-REQUEST.txt`；保存含会话对象、时间和发送状态的原始导出件到 `raw/`。",
  "2. 保存卖家回复导出、原始照片和原始短视频。每份原件只属于本 recordId，不与其他 SKU、批次或待发件共用。",
  "3. 连续短视频须依次覆盖：订单/待发说明 → 包装六面与真实条码 → 开箱 → 笔正反面与背标/SN → 开机版本页 → 全部套装物。",
  "4. 九机页面字段 `110329` 只记为 RETAIL_LISTING_FIELD_ONLY，不填作实物包装条码。32G/WiFi/Type-C 也不单独证明 G4。",
  "5. 在 `record.draft.json` 中填写实际 sellerEndpoint、transportReference、时间、原件元数据、observedIdentity 与逐项结果。",
  "6. `PASS` 必须引用 catalog 允许的原件；任一冲突设为 `FAIL`，缺件继续 `PENDING`。",
  "7. 所有门闭合后才可设为 `EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW`；该状态仍不授权付款、不更新采购表。",
  "8. 将完成记录复制到记录目标并运行 `npm run validate:benchmark-seller-evidence`。到货后另走 `intake-v1`。",
  "",
  "## 当前仍待人工取得",
  "",
  ...profile.requirements.map((requirement) => `- [ ] ${requirement.id} — ${requirement.title}`),
  "",
];

await mkdir(workspaceBase, { recursive: true });
const stagingRoot = path.join(workspaceBase, `.${recordId}.staging-${process.pid}`);
assertInside(stagingRoot, workspaceBase, "Benchmark seller evidence staging workspace");
try {
  await mkdir(path.join(stagingRoot, "raw"), { recursive: true });
  await writeFile(path.join(stagingRoot, "SELLER-REQUEST.txt"), requestBytes);
  await writeFile(path.join(stagingRoot, "REQUEST-CHECKLIST.md"), `${checklist.join("\n")}\n`, "utf8");
  await writeFile(path.join(stagingRoot, "record.draft.json"), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  await writeFile(path.join(stagingRoot, "source-manifest.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`, "utf8");
  await rename(stagingRoot, workspaceRoot);
} catch (error) {
  if (await exists(stagingRoot)) {
    assertInside(stagingRoot, workspaceBase, "Benchmark seller evidence staging cleanup");
    await rm(stagingRoot, { recursive: true, force: true });
  }
  throw error;
}

console.log(`Prepared benchmark seller evidence workspace: ${workspaceRoot}`);
console.log(`Profile: ${profile.profileId}; requirements: ${profile.requirements.length}`);
console.log(`Request bytes/SHA-256: ${requestBytes.length}/${sha256(requestBytes)}`);
console.log("State: PREPARED_NOT_SENT; payment, purchase-plan, intake, target-binding, adapter and ReleaseGate effects: NONE");
