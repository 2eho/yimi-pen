import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertEvidenceReceipt,
  assertReleaseGateCatalog,
  evaluateRelease,
} from "../../contracts/release-gates-v1.mjs";
import { verifyCatalogSemanticFiles } from "./catalog-semantics.mjs";
import { assertHostValidationRun } from "./host-run-provenance.mjs";
import { receiptFromHostReport, sha256, verifyReceiptArtifacts } from "./report-adapter.mjs";
import { computeReleaseSourceSet } from "./source-set.mjs";
import { verifyGateSpecificReceipt } from "./gate-specific-verifiers.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/release-gates-v1");
const EXTERNAL_RECEIPT_ROOT = path.join(REPO_ROOT, "hardware/evt0/release-evidence");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const HOST_RUN_PATH = path.join(BUILD_ROOT, "release-gate-host-run.json");
const RUN_ROOT = path.join(BUILD_ROOT, "release-gate-current");
const LOCK_PATH = path.join(BUILD_ROOT, ".release-gate-current.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".release-gate-current-root");
const MARKER_TEXT = "yimi-release-gate-current-root-v1\n";

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

async function readRegularWithin(root, target) {
  const candidate = path.resolve(target);
  if (!inside(root, candidate)) throw new Error(`path escaped allowed root: ${candidate}`);
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`path must be a regular file: ${candidate}`);
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!inside(realRoot, realCandidate)) throw new Error(`path resolved outside allowed root: ${candidate}`);
  return readFile(realCandidate);
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  const info = await lstat(BUILD_ROOT);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("build/ must be a regular directory");
  const [repo, build] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(repo, build)) throw new Error("build/ resolved outside repository");
  try { return await open(LOCK_PATH, "wx"); } catch (error) {
    if (error?.code === "EEXIST") throw new Error("current release evaluation is already running or left a stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await optionalLstat(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("current release root must be an owned directory");
    const [build, run] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(build, run)) throw new Error("current release root escaped build/");
    let marker = null;
    try { marker = await readFile(MARKER_PATH, "utf8"); } catch { /* exact ownership check below */ }
    if (marker !== MARKER_TEXT) throw new Error("current release root lacks its exact marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(path.join(RUN_ROOT, "receipts"), { recursive: true });
  await writeFile(MARKER_PATH, MARKER_TEXT, { flag: "wx" });
}

function schemaErrors(validate) {
  return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

function requireSchema(validate, value, label) {
  if (!validate(value)) throw new Error(`${label} schema failed: ${schemaErrors(validate)}`);
}

async function loadContracts() {
  const adapterBytes = await readFile(path.join(CONTRACT_ROOT, "host-report-adapters.json"));
  const [catalogSchema, receiptSchema, decisionSchema, adaptersSchema, hostRunSchema, catalog, adapters] = await Promise.all([
    "catalog.schema.json", "evidence-receipt.schema.json", "release-decision.schema.json",
    "host-report-adapters.schema.json", "host-validation-run.schema.json", "catalog.json", "host-report-adapters.json",
  ].map((name) => readFile(path.join(CONTRACT_ROOT, name), "utf8").then(JSON.parse)));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addSchema(receiptSchema);
  const validators = {
    catalog: ajv.compile(catalogSchema),
    receipt: ajv.getSchema(receiptSchema.$id),
    decision: ajv.compile(decisionSchema),
    adapters: ajv.compile(adaptersSchema),
    hostRun: ajv.compile(hostRunSchema),
  };
  requireSchema(validators.catalog, catalog, "release catalog");
  requireSchema(validators.adapters, adapters, "host report adapters");
  assertReleaseGateCatalog(catalog);
  if (catalog.hostAdapterRegistrySha256 !== sha256(adapterBytes)) {
    throw new Error("release catalog does not bind the current host report adapter bytes");
  }
  await verifyCatalogSemanticFiles({
    catalog,
    reader: (relative) => readRegularWithin(REPO_ROOT, path.join(REPO_ROOT, ...relative.split("/"))),
  });
  return { catalog, adapters, validators };
}

async function loadExternalReceipts({ catalog, releaseSubject, validate }) {
  const rootInfo = await optionalLstat(EXTERNAL_RECEIPT_ROOT);
  if (!rootInfo) return [];
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("release-evidence must be a regular directory");
  const receipts = [];
  const entries = (await readdir(EXTERNAL_RECEIPT_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".receipt.json"))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const bytes = await readRegularWithin(EXTERNAL_RECEIPT_ROOT, path.join(EXTERNAL_RECEIPT_ROOT, entry.name));
    const receipt = JSON.parse(bytes.toString("utf8"));
    requireSchema(validate, receipt, entry.name);
    assertEvidenceReceipt(receipt, catalog);
    if (receipt.evidenceClass === "host") throw new Error(`${entry.name} duplicates the canonical host-report adapter boundary`);
    if (JSON.stringify(receipt.releaseSubject) !== JSON.stringify(releaseSubject)) {
      throw new Error(`${entry.name} targets a different release subject`);
    }
    await verifyReceiptArtifacts({
      receipt,
      requireHardwarePrefix: true,
      artifactReader: (artifactPath) => readRegularWithin(REPO_ROOT, path.join(REPO_ROOT, artifactPath)),
    });
    await verifyGateSpecificReceipt({
      receipt,
      artifactReader: (artifactPath) => readRegularWithin(REPO_ROOT, path.join(REPO_ROOT, artifactPath)),
    });
    receipts.push(receipt);
  }
  return receipts;
}

async function run() {
  await prepareRunRoot();
  const { catalog, adapters, validators } = await loadContracts();
  const hostRunBytes = await readRegularWithin(REPO_ROOT, HOST_RUN_PATH);
  const hostRun = JSON.parse(hostRunBytes.toString("utf8"));
  requireSchema(validators.hostRun, hostRun, "sealed host validation run");
  const sourceSet = await computeReleaseSourceSet(REPO_ROOT);
  const reportBytesByPath = new Map();
  const reportArtifacts = new Map();
  for (const adapter of adapters.adapters) {
    const reportBytes = await readRegularWithin(REPO_ROOT, path.join(REPO_ROOT, adapter.reportPath));
    reportBytesByPath.set(adapter.reportPath, reportBytes);
    reportArtifacts.set(adapter.reportPath, { size: reportBytes.length, sha256: sha256(reportBytes) });
  }
  assertHostValidationRun({ run: hostRun, catalog, adapters, sourceSet, reportArtifacts });
  const baselineBytes = reportBytesByPath.get("build/product-baseline-validation.json");
  if (!baselineBytes) throw new Error("sealed host validation run lacks product baseline report");
  const baseline = JSON.parse(baselineBytes.toString("utf8"));
  if (!/^[a-f0-9]{64}$/u.test(baseline.designSnapshotHash)) throw new Error("product baseline lacks a canonical designSnapshotHash");
  const releaseSubject = {
    subjectType: "PRODUCT_RELEASE",
    subjectId: "YIMI-GEN1-EVT0-CURRENT",
    subjectRevisionSha256: baseline.designSnapshotHash,
  };
  const evaluatedAt = new Date().toISOString();
  const hostReceipts = [];
  for (const adapter of adapters.adapters) {
    const reportBytes = reportBytesByPath.get(adapter.reportPath);
    const receipt = receiptFromHostReport({ catalog, adapter, reportBytes, releaseSubject, executedAt: hostRun.completedAt });
    requireSchema(validators.receipt, receipt, `${adapter.gateId} receipt`);
    hostReceipts.push(receipt);
    await writeFile(path.join(RUN_ROOT, "receipts", `${adapter.gateId.toLowerCase()}.receipt.json`), encode(receipt), { flag: "wx" });
  }
  const externalReceipts = await loadExternalReceipts({ catalog, releaseSubject, validate: validators.receipt });
  const receipts = [...hostReceipts, ...externalReceipts];
  const decision = evaluateRelease({ catalog, releaseSubject, receipts, evaluatedAt });
  requireSchema(validators.decision, decision, "current release decision");
  const decisionBytes = encode(decision);
  await writeFile(path.join(RUN_ROOT, "release-decision.json"), decisionBytes, { flag: "wx" });
  const hostFailures = hostReceipts.filter((receipt) => receipt.result === "FAIL").map((receipt) => receipt.gateId);
  const report = {
    schemaVersion: 1,
    profile: "current-release-gate-evaluation-v1",
    catalogId: catalog.catalogId,
    catalogVersion: catalog.catalogVersion,
    hostRunId: hostRun.hostRunId,
    sourceSetSha256: hostRun.sourceSet.sourceSetSha256,
    releaseSubject,
    evaluatedAt,
    hostReceiptCount: hostReceipts.length,
    externalReceiptCount: externalReceipts.length,
    hostFailures,
    decisionId: decision.decisionId,
    releaseReady: decision.releaseReady,
    summary: {
      gates: catalog.gates.length,
      passed: decision.passedGateIds.length,
      failed: decision.failedGateIds.length,
      missing: decision.missingGateIds.length,
      blocking: decision.blockingGateIds.length,
    },
    blockingGateIds: decision.blockingGateIds,
    evidenceBoundary: {
      physicalEvidenceInferredFromAssignedData: false,
      externalPhysicalReceiptsPresent: externalReceipts.some((receipt) => receipt.evidenceClass === "physical"),
      hostReportsArePhysicalEvidence: false,
      productReleaseClaimed: decision.releaseReady,
    },
    artifacts: {
      decision: "build/release-gate-current/release-decision.json",
      decisionSha256: sha256(decisionBytes),
    },
  };
  const reportBytes = encode(report);
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes, { flag: "wx" });
  console.log(`ReleaseGate current: host=${hostReceipts.length} external=${externalReceipts.length}`);
  console.log(`Release decision: passed=${report.summary.passed} failed=${report.summary.failed} missing=${report.summary.missing} releaseReady=${report.releaseReady}`);
  console.log(`Decision: ${path.join(RUN_ROOT, "release-decision.json")}`);
  console.log(`Report SHA-256: ${createHash("sha256").update(reportBytes).digest("hex")}`);
  if (hostFailures.length > 0) process.exitCode = 1;
}

const lock = await acquireLock();
try { await run(); } finally {
  try { await lock.close(); } catch { /* preserve result */ }
  try { await rm(LOCK_PATH, { force: true }); } catch { /* preserve result */ }
}
