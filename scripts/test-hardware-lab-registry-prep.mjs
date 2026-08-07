import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = process.cwd();
const workspaceBase = path.join(root, "build", "hardware-lab", "instruments");
const registryId = `EVT0-LAB-REGISTRY-SELFTEST-${process.pid}-${randomUUID().slice(0, 8).toUpperCase()}`;
const workspaceRoot = path.join(workspaceBase, registryId);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertInsideWorkspace(target) {
  const relative = path.relative(workspaceBase, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Self-test cleanup target escaped hardware lab workspace: ${target}`);
  }
}

function runPrepare() {
  return spawnSync(process.execPath, [
    path.join(root, "scripts", "prepare-hardware-lab-registry.mjs"),
    "--registry-id",
    registryId,
  ], { cwd: root, encoding: "utf8" });
}

try {
  const prepared = runPrepare();
  if (prepared.status !== 0) throw new Error(`workspace preparation failed\n${prepared.stdout}\n${prepared.stderr}`);

  const draft = JSON.parse(await readFile(path.join(workspaceRoot, "registry.draft.json"), "utf8"));
  const schema = JSON.parse(await readFile(path.join(root, "hardware", "evt0", "lab-v1", "instrument-registry.schema.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(workspaceRoot, "source-manifest.json"), "utf8"));
  const checklist = await readFile(path.join(workspaceRoot, "CAPTURE-CHECKLIST.md"), "utf8");
  const rawEntries = await readdir(path.join(workspaceRoot, "raw"));
  const assets = draft.instruments.flatMap((slot) => slot.assets);
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)),
  });
  const validateDraft = ajv.compile(schema);
  const noQualificationFacts = draft.status === "PENDING" &&
    draft.recordedAt === null && draft.operator === null && draft.blockers.length > 0 &&
    draft.instruments.every((slot) => slot.disposition === "PENDING" && slot.blockers.length > 0) &&
    assets.every((asset) => asset.disposition === "PENDING" && asset.manufacturer === null &&
      asset.model === null && asset.serial === null && asset.serialSource === null &&
      asset.artifacts.length === 0 && asset.blockers.length > 0) &&
    rawEntries.length === 0;
  if (!validateDraft(draft) || !noQualificationFacts || draft.instruments.length !== 6 || assets.length !== 7) {
    throw new Error(`prepared draft failed schema/pending contract: ${ajv.errorsText(validateDraft.errors)}`);
  }
  console.log("Hardware lab registry prep self-test 1/3: pending-only 6-slot/7-asset workspace");

  for (const source of manifest.sourceFiles) {
    const bytes = await readFile(path.join(root, ...source.path.split("/")));
    if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) {
      throw new Error(`source manifest mismatch: ${source.id}`);
    }
  }
  if (manifest.qualificationEffect !== "NONE_PREPARATION_ONLY" ||
      !checklist.includes("不改变 BOARD_TARGET") || !checklist.includes("TRACEABLE_SELF_CHECK")) {
    throw new Error("source manifest or capture checklist lost its evidence boundary");
  }
  console.log("Hardware lab registry prep self-test 2/3: source hashes and evidence boundary close");

  const repeated = runPrepare();
  if (repeated.status === 0 || !`${repeated.stdout}\n${repeated.stderr}`.includes("already exists")) {
    throw new Error(`duplicate workspace refusal failed\n${repeated.stdout}\n${repeated.stderr}`);
  }
  try {
    await access(path.join(root, "hardware", "evt0", "lab-v1", "records", `${registryId}.json`));
    throw new Error("preparation script created a real registry record");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  console.log("Hardware lab registry prep self-test 3/3: duplicate refusal and no record promotion");
} finally {
  assertInsideWorkspace(workspaceRoot);
  await rm(workspaceRoot, { recursive: true, force: true });
}
