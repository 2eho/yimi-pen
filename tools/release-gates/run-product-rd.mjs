import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertReleaseGateCatalog } from "../../contracts/release-gates-v1.mjs";
import { computeHostValidationRunId } from "./host-run-provenance.mjs";
import { computeReleaseSourceSet } from "./source-set.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/release-gates-v1");
const LOCK_PATH = path.join(BUILD_ROOT, ".product-rd-validation.lock");
const MANIFEST_PATH = path.join(BUILD_ROOT, "release-gate-host-run.json");
const SCRIPTS = [
  "validate:architecture",
  "validate:hardware-system",
  "validate:release-gates",
  "validate:golden-24-projection",
  "validate:product-baseline",
  "test:snapshot-sim",
  "test:device-link-sim",
  "validate:family-repository-contracts",
  "test:confirmation-trust",
  "test:companion-host",
  "test:family-alpha-compiler",
  "test:execution-model-core",
  "test:weighted-random-v2",
  "validate:evt0-intake",
  "validate:firmware-contracts",
  "validate:rust-firmware",
  "typecheck",
  "validate:books",
];

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function optionalLstat(target) {
  try { return await lstat(target); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  const info = await lstat(BUILD_ROOT);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("build/ must be a regular directory");
  const [repo, build] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(repo, build)) throw new Error("build/ resolved outside repository");
  try { return await open(LOCK_PATH, "wx"); } catch (error) {
    if (error?.code === "EEXIST") throw new Error("product R&D validation is already running or left a stale lock");
    throw error;
  }
}

async function removeOldManifest() {
  const info = await optionalLstat(MANIFEST_PATH);
  if (!info) return;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("host validation manifest must be a regular file");
  await rm(MANIFEST_PATH);
}

async function fingerprint(relative, optional = false) {
  const absolute = path.join(REPO_ROOT, ...relative.split("/"));
  const info = await optionalLstat(absolute);
  if (!info && optional) return null;
  if (!info) throw new Error(`host validation report is missing: ${relative}`);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`host validation report must be a regular file: ${relative}`);
  const [repo, resolved] = await Promise.all([realpath(REPO_ROOT), realpath(absolute)]);
  if (!inside(repo, resolved)) throw new Error(`host validation report resolved outside repository: ${relative}`);
  const [bytes, precise] = await Promise.all([readFile(resolved), stat(resolved, { bigint: true })]);
  return {
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mtimeNs: precise.mtimeNs.toString(),
    ctimeNs: precise.ctimeNs.toString(),
  };
}

async function runNpmScript(script) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is required for the sealed product R&D runner");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, "run", script], { cwd: REPO_ROOT, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run ${script} failed (${signal ?? code})`));
    });
  });
}

async function run() {
  await removeOldManifest();
  const [catalog, adapters, adapterBytes] = await Promise.all([
    readFile(path.join(CONTRACT_ROOT, "catalog.json"), "utf8").then(JSON.parse),
    readFile(path.join(CONTRACT_ROOT, "host-report-adapters.json"), "utf8").then(JSON.parse),
    readFile(path.join(CONTRACT_ROOT, "host-report-adapters.json")),
  ]);
  assertReleaseGateCatalog(catalog);
  const adapterSha256 = createHash("sha256").update(adapterBytes).digest("hex");
  if (adapterSha256 !== catalog.hostAdapterRegistrySha256) throw new Error("catalog adapter registry binding mismatch");
  const orderedAdapters = [...adapters.adapters].sort((left, right) => left.gateId.localeCompare(right.gateId, "en"));
  const prior = new Map();
  for (const adapter of orderedAdapters) prior.set(adapter.reportPath, await fingerprint(adapter.reportPath, true));
  const sourceSet = await computeReleaseSourceSet(REPO_ROOT);
  const startedAt = new Date().toISOString();
  const startedNs = BigInt(Date.parse(startedAt)) * 1_000_000n;
  for (const script of SCRIPTS) await runNpmScript(script);
  const afterSourceSet = await computeReleaseSourceSet(REPO_ROOT);
  if (JSON.stringify(sourceSet) !== JSON.stringify(afterSourceSet)) throw new Error("release source set changed during product R&D validation");
  const reports = [];
  for (const adapter of orderedAdapters) {
    const before = prior.get(adapter.reportPath);
    const current = await fingerprint(adapter.reportPath);
    const refreshed = before === null
      || current.mtimeNs !== before.mtimeNs
      || current.ctimeNs !== before.ctimeNs;
    if (!refreshed || BigInt(current.mtimeNs) < startedNs) {
      throw new Error(`host report was not freshly generated in this validation run: ${adapter.reportPath}`);
    }
    reports.push({ gateId: adapter.gateId, reportPath: adapter.reportPath, refreshedDuringRun: true, prior: before, current });
  }
  const run = {
    schemaVersion: 1,
    profile: "release-host-validation-run-v1",
    hostRunId: `host-run:sha256:${"0".repeat(64)}`,
    catalogId: catalog.catalogId,
    hostAdapterRegistrySha256: catalog.hostAdapterRegistrySha256,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceSet,
    reports,
  };
  run.hostRunId = computeHostValidationRunId(run);
  const temporary = `${MANIFEST_PATH}.tmp-${process.pid}`;
  await writeFile(temporary, encode(run), { flag: "wx" });
  await rename(temporary, MANIFEST_PATH);
  console.log(`Host validation run sealed: ${run.hostRunId}`);
  console.log(`Source set: files=${sourceSet.fileCount} sha256=${sourceSet.sourceSetSha256}`);
  await runNpmScript("evaluate:release-gates");
}

const lock = await acquireLock();
try { await run(); } finally {
  try { await lock.close(); } catch { /* preserve primary result */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* preserve primary result */ }
}
