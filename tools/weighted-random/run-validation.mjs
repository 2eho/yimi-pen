import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { encodeJson, evaluateTranscript } from "./model.mjs";
import {
  mapLegacyRandomOneSources,
  normalizeLegacyClips,
} from "./legacy-pack-adapter.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/weighted-random-v2");
const FIRMWARE_ROOT = path.join(REPO_ROOT, "firmware");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "weighted-random-validation");
const REPORT_PATH = path.join(RUN_ROOT, "report.json");
const LOCK_PATH = path.join(BUILD_ROOT, ".weighted-random-validation.lock");
const MARKER_PATH = path.join(RUN_ROOT, ".weighted-random-validation-root");
const MARKER_TEXT = "yimi-weighted-random-validation-root-v2\n";
const MAX_PROCESS_BUFFER = 16 * 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function optionalLstat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function acquireLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  const info = await lstat(BUILD_ROOT);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("build/ must be a regular directory");
  const [repo, build] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(repo, build)) throw new Error("build/ resolved outside repository");
  try {
    return await open(LOCK_PATH, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("weighted random validation is already running or left a stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await optionalLstat(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("weighted validation root must be a regular directory");
    const [build, run] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(build, run)) throw new Error("weighted validation root escaped build/");
    let marker = null;
    try {
      marker = await readFile(MARKER_PATH, "utf8");
    } catch {
      // Exact marker check below owns deletion authority.
    }
    if (marker !== MARKER_TEXT) throw new Error("weighted validation root lacks its exact marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(path.join(RUN_ROOT, "negative"), { recursive: true });
  await writeFile(MARKER_PATH, MARKER_TEXT, { flag: "wx" });
}

function decodeJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(bytes));
  } catch (error) {
    throw new Error(`${label} is not strict UTF-8: ${error.message}`);
  }
  return JSON.parse(text);
}

function schemaErrors(validate) {
  return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

function requireSchema(validate, value, label) {
  if (!validate(value)) {
    const error = new Error(`${label} schema failed: ${schemaErrors(validate)}`);
    error.code = "SCHEMA_INVALID";
    throw error;
  }
}

function runProcess(command, args, { cwd, timeout = 180_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: MAX_PROCESS_BUFFER,
    timeout,
  });
  if (result.error) throw result.error;
  return result;
}

function requireProcessSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.signal ?? result.status}): ${String(result.stderr ?? "").trim()}`);
  }
}

async function buildRustHost() {
  const manifest = path.join(FIRMWARE_ROOT, "Cargo.toml");
  const build = runProcess("cargo", ["build", "--locked", "--manifest-path", manifest, "-p", "yimi-fw-host"], { cwd: FIRMWARE_ROOT });
  requireProcessSuccess(build, "cargo build yimi-fw-host");
  const metadata = runProcess("cargo", ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest], { cwd: FIRMWARE_ROOT });
  requireProcessSuccess(metadata, "cargo metadata");
  const targetDirectory = decodeJson(Buffer.from(metadata.stdout, "utf8"), "cargo metadata").target_directory;
  const binary = path.join(targetDirectory, "debug", process.platform === "win32" ? "yimi-fw-host.exe" : "yimi-fw-host");
  const binaryBytes = await readFile(binary);
  const cargoVersion = runProcess("cargo", ["--version"], { cwd: FIRMWARE_ROOT });
  const rustcVersion = runProcess("rustc", ["--version"], { cwd: FIRMWARE_ROOT });
  requireProcessSuccess(cargoVersion, "cargo --version");
  requireProcessSuccess(rustcVersion, "rustc --version");
  return {
    binary,
    binarySha256: sha256(binaryBytes),
    cargoVersion: cargoVersion.stdout.trim(),
    rustcVersion: rustcVersion.stdout.trim(),
  };
}

async function loadContracts() {
  const names = [
    "transcript.schema.json",
    "result.schema.json",
    "evidence-lock.schema.json",
    "golden-transcript.json",
    "evidence-lock.json",
  ];
  const bytes = new Map();
  for (const name of names) bytes.set(name, await readFile(path.join(CONTRACT_ROOT, name)));
  const values = new Map([...bytes].map(([name, value]) => [name, decodeJson(value, name)]));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validators = {
    transcript: ajv.compile(values.get("transcript.schema.json")),
    result: ajv.compile(values.get("result.schema.json")),
    evidence: ajv.compile(values.get("evidence-lock.schema.json")),
  };
  const transcript = values.get("golden-transcript.json");
  const evidenceLock = values.get("evidence-lock.json");
  requireSchema(validators.transcript, transcript, "weighted golden transcript");
  requireSchema(validators.evidence, evidenceLock, "weighted evidence lock");
  return { bytes, transcript, evidenceLock, validators };
}

function validateEvidenceLock(evidenceLock) {
  const paths = evidenceLock.localTruth.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error("weighted evidence lock has duplicate local paths");
  const sourceById = new Map(evidenceLock.primarySources.map((source) => [source.sourceId, source]));
  const rustRandom = sourceById.get("rust-random-rand-uniform-int");
  const paper = sourceById.get("lemire-fast-random-integer-v4");
  if (
    evidenceLock.primarySources.length !== 2
      || rustRandom?.lockedRevision !== "bb1262f703ca04e4ce56be78e1dc4e204cd6a998"
      || rustRandom.contentSha256 !== "75af3ac5a15d0a3cbd15a73ed045bbd2ff2508478d2ce0006ea73ca73ff1b1fa"
      || paper?.lockedRevision !== "arXiv:1805.10941v4"
  ) {
    throw new Error("weighted evidence lock primary-source identity drift");
  }
  return true;
}

function negativeDefinitions() {
  return [
    {
      id: "NEG-01-zero-weight",
      mutate(value) { value.scenarios[0].clips[0].weight = 0; },
    },
    {
      id: "NEG-02-too-few-clips",
      mutate(value) { value.scenarios[0].clips = value.scenarios[0].clips.slice(0, 1); },
    },
    {
      id: "NEG-03-too-many-clips",
      mutate(value) {
        value.scenarios[0].clips = Array.from({ length: 33 }, (_, index) => ({ clipSlot: index, weight: 1 }));
      },
    },
    {
      id: "NEG-04-duplicate-clip-slot",
      mutate(value) { value.scenarios[0].clips[1].clipSlot = value.scenarios[0].clips[0].clipSlot; },
    },
    {
      id: "NEG-05-u64-overflow",
      mutate(value) { value.scenarios[0].rawWords = ["18446744073709551616"]; },
    },
    {
      id: "NEG-06-u64-leading-zero",
      mutate(value) { value.scenarios[0].rawWords = ["01"]; },
    },
    {
      id: "NEG-07-random-source-exhausted",
      mutate(value) { value.scenarios[0].rawWords = ["0"]; },
    },
    {
      id: "NEG-08-expected-mismatch",
      mutate(value) { value.scenarios[0].expected.selectedIndex = 1; },
    },
    {
      id: "NEG-09-algorithm-drift",
      mutate(value) { value.algorithmId = "yimi-weighted-random-v3"; },
    },
    {
      id: "NEG-10-extra-property",
      mutate(value) { value.unreviewedField = true; },
    },
    {
      id: "NEG-11-duplicate-scenario-id",
      mutate(value) { value.scenarios.push(clone(value.scenarios[0])); },
    },
    {
      id: "NEG-12-physical-claim",
      mutate(value) { value.physicalEvidence = true; },
    },
  ];
}

async function runNegativeCases(baseTranscript, validators, rustHost) {
  const results = [];
  for (const definition of negativeDefinitions()) {
    const candidate = clone(baseTranscript);
    definition.mutate(candidate);
    const caseRoot = path.join(RUN_ROOT, "negative", definition.id);
    await mkdir(caseRoot);
    const inputBytes = encodeJson(candidate);
    const inputPath = path.join(caseRoot, "input.json");
    const nodeOutputPath = path.join(caseRoot, "node-output.json");
    const rustOutputPath = path.join(caseRoot, "rust-output.json");
    await writeFile(inputPath, inputBytes, { flag: "wx" });
    const inputBefore = sha256(inputBytes);

    let nodeRejected = false;
    let nodeCode = null;
    try {
      requireSchema(validators.transcript, candidate, definition.id);
      const result = evaluateTranscript(candidate, inputBytes);
      await writeFile(nodeOutputPath, encodeJson(result), { flag: "wx" });
    } catch (error) {
      nodeRejected = true;
      nodeCode = error?.code ?? error?.name ?? null;
    }
    const nodeOutputAbsent = !(await optionalLstat(nodeOutputPath));

    const sentinel = Buffer.from("weighted-random-negative-output-sentinel-v2\n", "utf8");
    await writeFile(rustOutputPath, sentinel, { flag: "wx" });
    const rustRun = runProcess(rustHost.binary, ["weighted-random-v2", inputPath, rustOutputPath], { cwd: REPO_ROOT });
    const rustOutputAfter = await readFile(rustOutputPath);
    const rustRejected = rustRun.status !== 0;
    const rustOutputUnchanged = rustOutputAfter.equals(sentinel);
    const inputUnchanged = sha256(await readFile(inputPath)) === inputBefore;
    const zeroSideEffect = nodeOutputAbsent && rustOutputUnchanged && inputUnchanged;
    const stderr = String(rustRun.stderr ?? "");
    const rustCode = /WEIGHTED_V2:([A-Z0-9_]+)/u.exec(stderr)?.[1] ?? null;
    results.push({
      id: definition.id,
      passed: nodeRejected && rustRejected && zeroSideEffect,
      nodeRejected,
      nodeCode,
      rustRejected,
      rustExitCode: rustRun.status,
      rustCode,
      rustStderrSha256: sha256(Buffer.from(stderr, "utf8")),
      zeroSideEffect,
      checks: { nodeOutputAbsent, rustOutputUnchanged, inputUnchanged },
    });
  }
  return results;
}

async function sourceEvidence() {
  const paths = [
    "firmware/Cargo.lock",
    "firmware/crates/yimi-fw-host/src/main.rs",
    "firmware/crates/yimi-fw-host/src/weighted_random.rs",
    "firmware/crates/yimi-runtime-core/src/lib.rs",
    "firmware/crates/yimi-runtime-core/src/weighted_random_v2.rs",
    "hardware/evt0/weighted-random-v2/evidence-lock.json",
    "hardware/evt0/weighted-random-v2/golden-transcript.json",
    "hardware/evt0/weighted-random-v2/result.schema.json",
    "hardware/evt0/weighted-random-v2/transcript.schema.json",
    "tools/weighted-random/legacy-pack-adapter.mjs",
    "tools/weighted-random/model.mjs",
    "tools/weighted-random/run-validation.mjs",
  ];
  const evidence = {};
  for (const relative of paths) {
    const bytes = await readFile(path.join(REPO_ROOT, ...relative.split("/")));
    evidence[relative] = { size: bytes.length, sha256: sha256(bytes) };
  }
  return evidence;
}

async function run() {
  await prepareRunRoot();
  const contracts = await loadContracts();
  validateEvidenceLock(contracts.evidenceLock);
  const contractHashesBefore = new Map([...contracts.bytes].map(([name, bytes]) => [name, sha256(bytes)]));
  const legacy = await mapLegacyRandomOneSources(REPO_ROOT, contracts.evidenceLock);
  const productMappingsExact = legacy.mappings.length === 2
    && legacy.mappings.every((mapping) => isDeepStrictEqual(mapping.clips.map((clip) => clip.weight), [2, 1]))
    && isDeepStrictEqual(legacy.mappings.map((mapping) => mapping.actionIdentity), ["hs-jojo", "YIMI-DIY-BANANA"]);
  const defaultProbe = normalizeLegacyClips([{ id: "clip-a" }, { id: "clip-b", weight: 2 }], "default-probe");
  const legacyDefaultRulePassed = isDeepStrictEqual(defaultProbe, [
    { clipId: "clip-a", weight: 1, defaulted: true },
    { clipId: "clip-b", weight: 2, defaulted: false },
  ]);
  await writeFile(path.join(RUN_ROOT, "legacy-mapping.json"), encodeJson({ schemaVersion: 2, profile: "weighted-random-legacy-mapping-v2", ...legacy }), { flag: "wx" });

  const transcriptBytes = contracts.bytes.get("golden-transcript.json");
  const nodeResult = evaluateTranscript(contracts.transcript, transcriptBytes);
  requireSchema(contracts.validators.result, nodeResult, "Node weighted result");
  const nodeBytes = encodeJson(nodeResult);
  const nodeOutputPath = path.join(RUN_ROOT, "node-result.json");
  await writeFile(nodeOutputPath, nodeBytes, { flag: "wx" });

  const rustHost = await buildRustHost();
  const rustOutputPath = path.join(RUN_ROOT, "rust-result.json");
  const rustRun = runProcess(rustHost.binary, ["weighted-random-v2", path.join(CONTRACT_ROOT, "golden-transcript.json"), rustOutputPath], { cwd: REPO_ROOT });
  requireProcessSuccess(rustRun, "Rust weighted-random-v2 adapter");
  const rustBytes = await readFile(rustOutputPath);
  const rustResult = decodeJson(rustBytes, "Rust weighted result");
  requireSchema(contracts.validators.result, rustResult, "Rust weighted result");

  const negativeCases = await runNegativeCases(contracts.transcript, contracts.validators, rustHost);
  const negativePassed = negativeCases.filter((entry) => entry.passed).length;
  const zeroSideEffect = negativeCases.filter((entry) => entry.zeroSideEffect).length;
  const completeResultMatch = isDeepStrictEqual(nodeResult, rustResult);
  const bytesExact = nodeBytes.equals(rustBytes);
  const proofs = nodeResult.results.map((result) => {
    const totalWeight = BigInt(result.totalWeight);
    const acceptedWordCount = BigInt(result.acceptedWordCount);
    return {
      id: result.id,
      totalWeight: result.totalWeight,
      rejectionThreshold: result.rejectionThreshold,
      acceptedWordCount: result.acceptedWordCount,
      bucketPreimageCount: result.bucketPreimageCount,
      acceptedSpaceDivisible: acceptedWordCount % totalWeight === 0n,
      everyTicketPreimageCountExact: BigInt(result.bucketPreimageCount) * totalWeight === acceptedWordCount,
      directModuloWouldBeBiased: BigInt(result.rejectionThreshold) > 0n,
    };
  });
  const exactBoundaryCoverage = new Set(contracts.transcript.scenarios.flatMap((scenario) => scenario.covers));
  const currentContractHashes = new Map();
  for (const name of contractHashesBefore.keys()) currentContractHashes.set(name, sha256(await readFile(path.join(CONTRACT_ROOT, name))));
  const sourceInputsUnchanged = isDeepStrictEqual(contractHashesBefore, currentContractHashes);
  const gates = {
    schemasValid: true,
    evidenceLockValid: true,
    productTruthMapped: productMappingsExact,
    legacyDefaultRulePassed,
    nodeGoldenPassed: nodeResult.allPassed,
    rustGoldenPassed: rustResult.allPassed,
    nodeRustCompleteResultMatch: completeResultMatch,
    nodeRustBytesExact: bytesExact,
    exactBoundaryCoverage: ["rejection-prefix", "half-open-boundary", "array-order", "u32-weight-maximum", "u64-maximum"].every((value) => exactBoundaryCoverage.has(value)),
    rejectionCoverage: nodeResult.results.some((result) => result.consumedWords > 1),
    uniformityProofsExact: proofs.every((proof) => proof.acceptedSpaceDivisible && proof.everyTicketPreimageCountExact),
    naiveModuloBiasDetected: proofs.some((proof) => proof.directModuloWouldBeBiased),
    negativeCasesPassed: negativePassed === negativeCases.length,
    negativeFailuresZeroSideEffect: zeroSideEffect === negativeCases.length,
    sourceInputsUnchanged,
    hostEvidenceBoundaryEnforced: negativeCases.find((entry) => entry.id === "NEG-12-physical-claim")?.passed === true,
  };
  const sourceFiles = await sourceEvidence();
  const report = {
    schemaVersion: 2,
    profile: "weighted-random-v2-host-validation",
    algorithmId: "yimi-weighted-random-v2",
    contract: {
      transcript: "hardware/evt0/weighted-random-v2/golden-transcript.json",
      transcriptSha256: sha256(transcriptBytes),
      evidenceLock: "hardware/evt0/weighted-random-v2/evidence-lock.json",
      evidenceLockSha256: sha256(contracts.bytes.get("evidence-lock.json")),
      expectationAuthority: "reviewed golden transcript plus independent Node and Rust implementations",
      rustOutputUsedToGenerateNodeExpectation: false,
    },
    toolchain: {
      node: process.version,
      cargo: rustHost.cargoVersion,
      rustc: rustHost.rustcVersion,
      rustHostBinarySha256: rustHost.binarySha256,
      cargoLockedBuild: true,
    },
    gates,
    goldenSummary: {
      passed: nodeResult.results.filter((result) => result.expectedMatched).length,
      total: nodeResult.results.length,
      nodeRustCompleteResultMatch: completeResultMatch,
      nodeRustBytesExact: bytesExact,
      nodeOutputSha256: sha256(nodeBytes),
      rustOutputSha256: sha256(rustBytes),
    },
    distributionProofs: proofs,
    legacyMapping: {
      actionCount: legacy.mappings.length,
      defaultedProductionWeights: legacy.mappings.flatMap((mapping) => mapping.clips).filter((clip) => clip.defaulted).length,
      exactProductMappings: productMappingsExact,
      artifact: "build/weighted-random-validation/legacy-mapping.json",
    },
    negativeSummary: {
      passed: negativePassed,
      total: negativeCases.length,
      zeroSideEffect,
      expectedZeroSideEffect: negativeCases.length,
      cases: negativeCases,
    },
    sourceEvidence: sourceFiles,
    evidenceBoundary: {
      hostFixtureOnly: true,
      physicalOidEvidenceProven: false,
      targetRngProviderProven: false,
      targetBoardTraceProven: false,
      twoBoardDistributionProven: false,
      productionSnapshotReceiptIssued: false,
      productionGateId: "RG-SNAPSHOT-WEIGHTED-RANDOM-VERIFIED",
    },
  };
  const reportBytes = encodeJson(report);
  await writeFile(REPORT_PATH, reportBytes, { flag: "wx" });
  const allPassed = Object.values(gates).every(Boolean);
  console.log(`WeightedRandom v2 golden: ${report.goldenSummary.passed}/${report.goldenSummary.total}; Node/Rust bytes ${bytesExact ? "EXACT" : "DRIFT"}`);
  console.log(`WeightedRandom v2 negatives: ${negativePassed}/${negativeCases.length}; zero-side-effect ${zeroSideEffect}/${negativeCases.length}`);
  console.log(`WeightedRandom v2 report SHA-256: ${sha256(reportBytes)}`);
  console.log(`Report: ${REPORT_PATH}`);
  if (!allPassed) process.exitCode = 1;
}

const lock = await acquireLock();
try {
  await run();
} finally {
  try {
    await lock.close();
  } catch {
    // Preserve the primary result.
  }
  try {
    await rm(LOCK_PATH, { force: true });
  } catch {
    // Preserve the primary result.
  }
}
