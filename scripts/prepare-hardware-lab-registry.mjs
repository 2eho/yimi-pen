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

function assertWorkspacePath(target, base) {
  const relative = path.relative(base, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Workspace path escaped hardware lab root: ${target}`);
  }
}

const registryId = option("--registry-id");
if (!registryId || !/^EVT0-LAB-REGISTRY-[A-Z0-9-]+$/u.test(registryId) || registryId === "EVT0-LAB-REGISTRY-TEMPLATE") {
  throw new Error("Usage: node scripts/prepare-hardware-lab-registry.mjs --registry-id EVT0-LAB-REGISTRY-<UNIQUE-ID>");
}

const labRoot = path.join(root, "hardware", "evt0", "lab-v1");
const workspaceBase = path.join(root, "build", "hardware-lab", "instruments");
const workspaceRoot = path.join(workspaceBase, registryId);
const recordPath = path.join(labRoot, "records", `${registryId}.json`);
assertWorkspacePath(workspaceRoot, workspaceBase);

if (await exists(workspaceRoot)) throw new Error(`Registry workspace already exists: ${workspaceRoot}`);
if (await exists(recordPath)) throw new Error(`Registry record already exists: ${recordPath}`);

const sourceDefinitions = [
  ["REGISTRY_SCHEMA", path.join(labRoot, "instrument-registry.schema.json")],
  ["REGISTRY_TEMPLATE", path.join(labRoot, "instrument-registry.template.json")],
  ["CAPTURE_PLAN", path.join(labRoot, "registration-capture-plan.json")],
  ["METHOD_CATALOG", path.join(labRoot, "method-catalog.json")],
  ["PURCHASE_PLAN", path.join(root, "hardware", "evt0", "purchase-plan.csv")],
];
const discoveryPath = path.join(root, "build", "hardware-lab-discovery.json");
if (await exists(discoveryPath)) sourceDefinitions.push(["PNP_DISCOVERY_INFORMATIONAL", discoveryPath]);

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

const template = JSON.parse(await readFile(path.join(labRoot, "instrument-registry.template.json"), "utf8"));
const capturePlan = JSON.parse(await readFile(path.join(labRoot, "registration-capture-plan.json"), "utf8"));
if (capturePlan.planId !== "EVT0-LAB-REGISTRATION-CAPTURE-V1" || capturePlan.qualificationEffect !== "NONE_PREPARATION_ONLY") {
  throw new Error("Unexpected hardware lab registration capture plan identity or qualification effect");
}
const requiredAssetCount = capturePlan.slots.reduce((count, slot) => count + slot.assets.length, 0);
if (capturePlan.slots.length !== 6 || requiredAssetCount !== 7) {
  throw new Error("Hardware lab registration capture plan must define six slots and seven assets");
}

const draft = structuredClone(template);
draft.registryId = registryId;
draft.status = "PENDING";
draft.recordedAt = null;
draft.operator = null;
draft.discoveryReportRef = null;
draft.instruments = capturePlan.slots.map((slot) => ({
  id: slot.id,
  purchasePlanItemId: slot.purchasePlanItemId,
  role: slot.role,
  assets: slot.assets.map((asset) => ({
    assetId: `${slot.id}-${asset.assetKind.replaceAll("_", "-")}-01`,
    assetKind: asset.assetKind,
    manufacturer: null,
    model: null,
    serial: null,
    serialSource: null,
    firmwareVersion: null,
    identityArtifactRefs: [],
    calibration: {
      kind: "PENDING",
      status: "PENDING",
      performedAt: null,
      validUntil: null,
      procedure: null,
      artifactRefs: [],
      referenceArtifactRefs: [],
    },
    artifacts: [],
    disposition: "PENDING",
    blockers: [
      "IDENTITY_EVIDENCE_PENDING",
      "CALIBRATION_OR_SELF_CHECK_PENDING",
      "REFERENCE_EVIDENCE_PENDING",
    ],
  })),
  disposition: "PENDING",
  blockers: ["REQUIRED_ASSET_QUALIFICATION_PENDING"],
}));
draft.qualificationEffect = "NONE_UNTIL_ALL_REQUIRED_QUALIFIED";
draft.blockers = ["LAB1_LAB6_PHYSICAL_EVIDENCE_PENDING"];

const sourceManifest = {
  schemaVersion: 1,
  profile: "evt0-lab-registration-workspace-v1",
  registryId,
  generatedAt: new Date().toISOString(),
  status: "PENDING_PHYSICAL_CAPTURE",
  qualificationEffect: "NONE_PREPARATION_ONLY",
  serialPolicy: capturePlan.serialPolicy,
  requiredInstrumentSlots: capturePlan.slots.length,
  requiredPhysicalAssets: requiredAssetCount,
  rawEvidenceRoot: `build/hardware-lab/instruments/${registryId}/raw/`,
  recordDestination: `hardware/evt0/lab-v1/records/${registryId}.json`,
  sourceFiles,
};

const checklist = [
  `# EVT-0 实验室仪器登记：${registryId}`,
  "",
  `- 当前状态：PENDING_PHYSICAL_CAPTURE`,
  `- 资格效果：NONE_PREPARATION_ONLY`,
  `- 原件目录：build/hardware-lab/instruments/${registryId}/raw/`,
  `- 记录目标：hardware/evt0/lab-v1/records/${registryId}.json`,
  "",
  "## 共用步骤",
  "",
  "1. 逐件填写 manufacturer、完整 model、serial 和 serialSource；没有制造商序列号时，粘贴唯一 LOCAL_ASSET_TAG 并拍摄标签与整机同框原图。",
  "2. 身份原件、校准/自检结果、参考标准原件必须是分开的文件，全部保存到本工作区 raw/。",
  "3. TRACEABLE_SELF_CHECK 必须记录 procedure，并分别填写 artifactRefs 与 referenceArtifactRefs；只看到 PnP 名称不产生资格。",
  "4. 对每个原件填写实际 bytes、SHA-256、mediaType 和引用；任何缺口保留 PENDING/blocker。",
  "5. 全部六槽位/七资产都满足门后，将 registry.draft.json 复制到记录目标，文件名必须等于 registryId，并运行 npm run validate:hardware-lab。",
  "6. 记录通过只建立测量台架资格，不改变 BOARD_TARGET、BOM、付款或产品发布状态。",
  "",
  "## 分资产采集要求",
  "",
  ...capturePlan.slots.flatMap((slot) => slot.assets.flatMap((asset) => {
    const assetId = `${slot.id}-${asset.assetKind.replaceAll("_", "-")}-01`;
    return [
      `### ${slot.purchasePlanItemId} / ${slot.id} / ${asset.assetKind}`,
      "",
      `- draft assetId：\`${assetId}\``,
      `- 建议文件前缀：\`${assetId}__\``,
      `- 身份证据：${asset.identityEvidence.join("；")}`,
      `- 资格证据：${asset.qualificationEvidence.join("；")}`,
      "",
    ];
  })),
].join("\n");

await mkdir(workspaceBase, { recursive: true });
const stagingRoot = path.join(workspaceBase, `.${registryId}.staging-${process.pid}`);
assertWorkspacePath(stagingRoot, workspaceBase);
try {
  await mkdir(path.join(stagingRoot, "raw"), { recursive: true });
  await writeFile(path.join(stagingRoot, "registry.draft.json"), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  await writeFile(path.join(stagingRoot, "source-manifest.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(stagingRoot, "CAPTURE-CHECKLIST.md"), `${checklist}\n`, "utf8");
  await rename(stagingRoot, workspaceRoot);
} catch (error) {
  if (await exists(stagingRoot)) {
    assertWorkspacePath(stagingRoot, workspaceBase);
    await rm(stagingRoot, { recursive: true, force: true });
  }
  throw error;
}

console.log(`Prepared hardware lab registry workspace: ${workspaceRoot}`);
console.log(`Slots/assets: ${capturePlan.slots.length}/${requiredAssetCount}`);
console.log("State: PENDING_PHYSICAL_CAPTURE; qualification, BOARD_TARGET, payment and release effects: NONE");
