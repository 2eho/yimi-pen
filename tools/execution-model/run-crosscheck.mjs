import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import { compileAndExecute, NodeExecutionModelError } from "./model.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/execution-model-v1");
const SNAPSHOT_CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/snapshot-v1");
const GOLDEN_24_ROOT = path.join(SNAPSHOT_CONTRACT_ROOT, "design");
const FAMILY_VALIDATION_ROOT = path.join(REPO_ROOT, "build/family-alpha-validation");
const FAMILY_SNAPSHOT_ROOT = path.join(FAMILY_VALIDATION_ROOT, "snapshot");
const FIRMWARE_ROOT = path.join(REPO_ROOT, "firmware");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "execution-model-validation");
const RUNNER_LOCK = path.join(BUILD_ROOT, ".execution-model-validation.lock");
const MARKER = path.join(RUN_ROOT, ".execution-model-validation-root");
const MARKER_TEXT = "yimi-execution-model-validation-root-v1\n";
const REPORT_PATH = path.join(RUN_ROOT, "report.json");
const MAX_PROCESS_BUFFER = 16 * 1024 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encodeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
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

async function acquireRunnerLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  const buildInfo = await lstat(BUILD_ROOT);
  if (!buildInfo.isDirectory() || buildInfo.isSymbolicLink()) {
    throw new Error("build/ must be a regular directory");
  }
  const [realRepository, realBuild] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(realRepository, realBuild)) throw new Error("build/ resolved outside repository");
  try {
    return await open(RUNNER_LOCK, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("execution-model validation is already running or left a stale lock");
    }
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await optionalLstat(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) {
      throw new Error("execution-model validation root must be an owned regular directory");
    }
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("validation root resolved outside build/");
    let markerText = null;
    try {
      markerText = await readFile(MARKER, "utf8");
    } catch {
      // Exact ownership check below owns the result.
    }
    if (markerText !== MARKER_TEXT) throw new Error("validation root lacks its exact ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER, MARKER_TEXT, { encoding: "utf8", flag: "wx" });
  await Promise.all([
    mkdir(path.join(RUN_ROOT, "node")),
    mkdir(path.join(RUN_ROOT, "rust")),
    mkdir(path.join(RUN_ROOT, "negative")),
  ]);
}

async function readRegularWithin(allowedRoot, target) {
  const resolved = path.resolve(target);
  const info = await lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`input must be a regular file: ${resolved}`);
  const [realAllowed, realTarget] = await Promise.all([realpath(allowedRoot), realpath(resolved)]);
  if (!inside(realAllowed, realTarget)) throw new Error(`input escaped its allowed root: ${resolved}`);
  return readFile(realTarget);
}

function decodeJson(bytes, label) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(bytes));
  } catch (error) {
    throw new Error(`${label} is not UTF-8: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} JSON parse failed: ${error.message}`);
  }
}

function schemaErrors(validator) {
  return (validator.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

function requireSchema(validator, value, label) {
  if (!validator(value)) throw new Error(`${label} schema failed: ${schemaErrors(validator)}`);
}

async function loadValidators() {
  const files = {
    model: path.join(CONTRACT_ROOT, "execution-model.schema.json"),
    result: path.join(CONTRACT_ROOT, "execution-result.schema.json"),
    transcript: path.join(CONTRACT_ROOT, "execution-transcript.schema.json"),
    logicalIndex: path.join(SNAPSHOT_CONTRACT_ROOT, "logical-index.schema.json"),
    actions: path.join(SNAPSHOT_CONTRACT_ROOT, "actions.schema.json"),
  };
  const schemas = {};
  for (const [name, file] of Object.entries(files)) {
    schemas[name] = decodeJson(await readRegularWithin(REPO_ROOT, file), `${name} schema`);
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addSchema(schemas.model);
  return {
    model: ajv.getSchema(schemas.model.$id),
    result: ajv.compile(schemas.result),
    transcript: ajv.compile(schemas.transcript),
    logicalIndex: ajv.compile(schemas.logicalIndex),
    actions: ajv.compile(schemas.actions),
    schemaFiles: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, path.relative(REPO_ROOT, file).replaceAll("\\", "/")])),
  };
}

function runProcess(command, args, { cwd, timeout = 120_000 } = {}) {
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
    const details = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${label} exited ${result.status}: ${details}`);
  }
}

async function buildRustHost() {
  const manifestPath = path.join(FIRMWARE_ROOT, "Cargo.toml");
  const build = runProcess("cargo", [
    "build",
    "--locked",
    "--manifest-path",
    manifestPath,
    "-p",
    "yimi-fw-host",
  ], { cwd: FIRMWARE_ROOT, timeout: 180_000 });
  requireProcessSuccess(build, "cargo build yimi-fw-host");
  const metadata = runProcess("cargo", [
    "metadata",
    "--format-version",
    "1",
    "--no-deps",
    "--manifest-path",
    manifestPath,
  ], { cwd: FIRMWARE_ROOT });
  requireProcessSuccess(metadata, "cargo metadata");
  const targetDirectory = decodeJson(Buffer.from(metadata.stdout, "utf8"), "cargo metadata").target_directory;
  const binaryName = process.platform === "win32" ? "yimi-fw-host.exe" : "yimi-fw-host";
  const binaryPath = path.join(targetDirectory, "debug", binaryName);
  const binaryBytes = await readRegularWithin(path.resolve(targetDirectory), binaryPath);
  const cargoVersion = runProcess("cargo", ["--version"], { cwd: FIRMWARE_ROOT });
  const rustcVersion = runProcess("rustc", ["--version"], { cwd: FIRMWARE_ROOT });
  requireProcessSuccess(cargoVersion, "cargo --version");
  requireProcessSuccess(rustcVersion, "rustc --version");
  return {
    binaryPath,
    binarySha256: sha256(binaryBytes),
    cargoVersion: cargoVersion.stdout.trim(),
    rustcVersion: rustcVersion.stdout.trim(),
  };
}

async function loadFamilyCompilerEvidence(inputs) {
  const reportPath = path.join(FAMILY_VALIDATION_ROOT, "report.json");
  const reportBytes = await readRegularWithin(FAMILY_VALIDATION_ROOT, reportPath);
  const report = decodeJson(reportBytes, "Family Alpha compiler report");
  if (report.profile !== "family-alpha-compiler-validation-v1"
    || report.golden?.deterministic !== true
    || report.golden?.compile?.profile !== "family-alpha-compile-report-v1") {
    throw new Error("Family Alpha compiler report does not prove the expected deterministic golden build");
  }
  const files = new Map((report.golden.compile.files ?? []).map((entry) => [entry.path, entry]));
  for (const [relative, bytes] of [["logical-index.json", inputs.logicalIndexBytes], ["actions.json", inputs.actionsBytes]]) {
    const evidence = files.get(relative);
    if (!evidence || evidence.size !== bytes.length || evidence.sha256 !== sha256(bytes)) {
      throw new Error(`Family Alpha compiler report differs from actual ${relative}`);
    }
  }
  return {
    reportPath: path.relative(REPO_ROOT, reportPath).replaceAll("\\", "/"),
    reportSha256: sha256(reportBytes),
    snapshotId: report.golden.compile.snapshotId,
    outputTreeSha256: report.golden.outputTreeSha256,
    deterministic: true,
    sourceFilesMatchReport: true,
  };
}

async function loadScenario(config, validators) {
  const logicalIndexPath = path.join(config.snapshotRoot, "logical-index.json");
  const actionsPath = path.join(config.snapshotRoot, "actions.json");
  const [logicalIndexBytes, actionsBytes, transcriptBytes] = await Promise.all([
    readRegularWithin(config.snapshotRoot, logicalIndexPath),
    readRegularWithin(config.snapshotRoot, actionsPath),
    readRegularWithin(CONTRACT_ROOT, config.transcriptPath),
  ]);
  const transcript = decodeJson(transcriptBytes, `${config.id} transcript`);
  requireSchema(validators.transcript, transcript, `${config.id} transcript`);
  if (transcript.sourceProfile !== config.sourceProfile) {
    throw new Error(`${config.id} transcript sourceProfile differs from scenario ownership`);
  }
  const inputs = { logicalIndexBytes, actionsBytes, transcriptBytes };
  return {
    config,
    ...inputs,
    transcript,
    familyEvidence: config.actualFamilyBuild ? await loadFamilyCompilerEvidence(inputs) : null,
    beforeHashes: {
      logicalIndex: sha256(logicalIndexBytes),
      actions: sha256(actionsBytes),
      transcript: sha256(transcriptBytes),
    },
    paths: {
      logicalIndex: path.relative(REPO_ROOT, logicalIndexPath).replaceAll("\\", "/"),
      actions: path.relative(REPO_ROOT, actionsPath).replaceAll("\\", "/"),
      transcript: path.relative(REPO_ROOT, config.transcriptPath).replaceAll("\\", "/"),
    },
  };
}

async function verifyScenarioInputsUnchanged(scenario) {
  const after = {
    logicalIndex: sha256(await readRegularWithin(scenario.config.snapshotRoot, path.join(scenario.config.snapshotRoot, "logical-index.json"))),
    actions: sha256(await readRegularWithin(scenario.config.snapshotRoot, path.join(scenario.config.snapshotRoot, "actions.json"))),
    transcript: sha256(await readRegularWithin(CONTRACT_ROOT, scenario.config.transcriptPath)),
  };
  return isDeepStrictEqual(after, scenario.beforeHashes);
}

async function runGoldenScenario(scenario, validators, rustHost) {
  const nodeResult = compileAndExecute({
    logicalIndexBytes: scenario.logicalIndexBytes,
    actionsBytes: scenario.actionsBytes,
    transcriptBytes: scenario.transcriptBytes,
    validators,
  });
  requireSchema(validators.model, nodeResult.executionModel, `${scenario.config.id} Node execution model`);
  requireSchema(validators.result, nodeResult, `${scenario.config.id} Node execution result`);
  if (!nodeResult.allPassed) throw new Error(`${scenario.config.id} Node trace differs from transcript expectations`);
  const nodeBytes = encodeJson(nodeResult);
  const nodeOutputPath = path.join(RUN_ROOT, "node", `${scenario.config.id}.json`);
  await writeFile(nodeOutputPath, nodeBytes, { flag: "wx" });

  const rustOutputPath = path.join(RUN_ROOT, "rust", `${scenario.config.id}.json`);
  const rustRun = runProcess(rustHost.binaryPath, [
    "execution-model",
    path.join(scenario.config.snapshotRoot, "logical-index.json"),
    path.join(scenario.config.snapshotRoot, "actions.json"),
    scenario.config.transcriptPath,
    rustOutputPath,
  ], { cwd: REPO_ROOT });
  requireProcessSuccess(rustRun, `${scenario.config.id} Rust execution-model`);
  const rustBytes = await readRegularWithin(RUN_ROOT, rustOutputPath);
  const rustResult = decodeJson(rustBytes, `${scenario.config.id} Rust execution result`);
  requireSchema(validators.result, rustResult, `${scenario.config.id} Rust execution result`);
  if (!rustResult.allPassed) throw new Error(`${scenario.config.id} Rust trace differs from transcript expectations`);

  const modelMatch = isDeepStrictEqual(nodeResult.executionModel, rustResult.executionModel);
  const traceMatch = isDeepStrictEqual(nodeResult.trace, rustResult.trace);
  const resultMatch = isDeepStrictEqual(nodeResult, rustResult);
  const inputFilesUnchanged = await verifyScenarioInputsUnchanged(scenario);
  const passed = modelMatch && traceMatch && resultMatch && inputFilesUnchanged;
  return {
    id: scenario.config.id,
    passed,
    sourceKind: scenario.config.sourceKind,
    sourceProfile: scenario.config.sourceProfile,
    inputs: {
      ...scenario.paths,
      logicalIndexBytes: scenario.logicalIndexBytes.length,
      logicalIndexSha256: scenario.beforeHashes.logicalIndex,
      actionsBytes: scenario.actionsBytes.length,
      actionsSha256: scenario.beforeHashes.actions,
      transcriptBytes: scenario.transcriptBytes.length,
      transcriptSha256: scenario.beforeHashes.transcript,
    },
    familyCompilerEvidence: scenario.familyEvidence,
    counts: {
      oids: nodeResult.executionModel.oidIndex.length,
      actions: nodeResult.executionModel.actions.length,
      clips: nodeResult.executionModel.clips.length,
      taps: nodeResult.trace.length,
    },
    checks: {
      nodeResultSchemaValid: true,
      rustResultSchemaValid: true,
      nodeTranscriptExpected: nodeResult.allPassed,
      rustTranscriptExpected: rustResult.allPassed,
      executionModelMatch: modelMatch,
      traceMatch,
      completeResultMatch: resultMatch,
      inputFilesUnchanged,
    },
    outputs: {
      node: path.relative(REPO_ROOT, nodeOutputPath).replaceAll("\\", "/"),
      nodeSha256: sha256(nodeBytes),
      rust: path.relative(REPO_ROOT, rustOutputPath).replaceAll("\\", "/"),
      rustSha256: sha256(rustBytes),
      bytesExact: nodeBytes.equals(rustBytes),
    },
  };
}

function negativeDefinitions() {
  return [
    {
      id: "NEG-01-duplicate-action-key",
      expectedNodeCode: "DUPLICATE_ACTION_KEY",
      mutate: ({ actions }) => { actions.actions[1].actionId = actions.actions[0].actionId; },
    },
    {
      id: "NEG-02-duplicate-logical-oid",
      expectedNodeCode: "DUPLICATE_LOGICAL_OID",
      mutate: ({ logicalIndex }) => { logicalIndex.entries[1].logicalOid = logicalIndex.entries[0].logicalOid; },
    },
    {
      id: "NEG-03-physical-map-coverage",
      expectedNodeCode: "PHYSICAL_MAP_COVERAGE",
      mutate: ({ transcript }) => { transcript.physicalMap.pop(); },
    },
    {
      id: "NEG-04-physical-map-order",
      expectedNodeCode: "PHYSICAL_MAP_ORDER",
      mutate: ({ transcript }) => {
        [transcript.physicalMap[0], transcript.physicalMap[1]] = [transcript.physicalMap[1], transcript.physicalMap[0]];
      },
    },
    {
      id: "NEG-05-duplicate-physical-code",
      expectedNodeCode: "DUPLICATE_PHYSICAL_CODE",
      mutate: ({ transcript }) => { transcript.physicalMap[1].physicalCode = transcript.physicalMap[0].physicalCode; },
    },
    {
      id: "NEG-06-missing-action-reference",
      expectedNodeCode: "MISSING_ACTION",
      mutate: ({ logicalIndex }) => { logicalIndex.entries[0].actionId = "action-missing"; },
    },
    {
      id: "NEG-07-missing-clip-reference",
      expectedNodeCode: "MISSING_CLIP",
      mutate: ({ actions }) => { actions.actions[0].clipIds[0] = "clip-missing"; },
    },
    {
      id: "NEG-08-unused-explicit-clip",
      expectedNodeCode: "UNUSED_CLIP",
      mutate: ({ actions }) => {
        actions.clips.push({
          clipId: "clip-unused",
          path: "audio/clip-unused.wav",
          size: 1,
          sha256: "0".repeat(64),
          codec: "WAV_PCM16_16K_MONO",
          mediaType: "voice",
        });
      },
    },
    {
      id: "NEG-09-random-policy-arity",
      expectedNodeCode: "ACTIONS_SCHEMA",
      mutate: ({ actions }) => { actions.actions[0].playPolicy = "random_one"; },
    },
    {
      id: "NEG-10-random-index-out-of-range",
      expectedNodeCode: "RANDOM_INDEX_OUT_OF_RANGE",
      mutate: ({ transcript }) => {
        const tap = transcript.taps.find((candidate) => candidate.id === "TAP-FAM-03");
        tap.randomIndex = 99;
      },
    },
    {
      id: "NEG-11-assigned-snapshot-rejected",
      expectedNodeCode: "SNAPSHOT_NOT_UNASSIGNED",
      mutate: ({ logicalIndex, transcript }) => {
        logicalIndex.physicalMapStatus = "assigned";
        logicalIndex.entries.forEach((entry, index) => { entry.physicalCode = transcript.physicalMap[index].physicalCode; });
      },
    },
    {
      id: "NEG-12-duplicate-clip-in-action",
      expectedNodeCode: "ACTIONS_SCHEMA",
      mutate: ({ actions }) => { actions.actions[2].clipIds[1] = actions.actions[2].clipIds[0]; },
    },
    {
      id: "NEG-13-surrogate-formula-mismatch",
      expectedNodeCode: "SURROGATE_FORMULA",
      mutate: ({ transcript }) => { transcript.physicalMap[0].physicalCode = "9000000000000999"; },
    },
    {
      id: "NEG-14-event-time-backtracks",
      expectedNodeCode: "NON_MONOTONIC_EVENT_TIME",
      mutate: ({ transcript }) => { transcript.taps[1].eventAtUs = "0"; },
    },
    {
      id: "NEG-15-random-index-not-consumed",
      expectedNodeCode: "RANDOM_INDEX_PRESENCE",
      mutate: ({ transcript }) => { transcript.taps[1].randomIndex = 0; },
    },
    {
      id: "NEG-16-valid-event-without-code",
      expectedNodeCode: "TRANSCRIPT_SCHEMA",
      mutate: ({ transcript }) => { transcript.taps[1].physicalCode = null; },
    },
    {
      id: "NEG-17-no-code-event-carries-code",
      expectedNodeCode: "TRANSCRIPT_SCHEMA",
      mutate: ({ transcript }) => { transcript.taps[6].physicalCode = "9000000000000013"; },
    },
    {
      id: "NEG-18-duplicate-tap-id",
      expectedNodeCode: "DUPLICATE_TAP_ID",
      mutate: ({ transcript }) => { transcript.taps[1].id = transcript.taps[0].id; },
    },
    {
      id: "NEG-19-expected-trace-drift",
      expectedNodeCode: "EXPECTED_TRACE_MISMATCH",
      expectedResultMismatch: true,
      mutate: ({ transcript }) => { transcript.taps[1].expected.decision = "unbound"; },
    },
    {
      id: "NEG-20-cooldown-above-schema-limit",
      expectedNodeCode: "ACTIONS_SCHEMA",
      mutate: ({ actions }) => { actions.actions[0].cooldownMs = 60_001; },
    },
    {
      id: "NEG-21-unsafe-clip-path",
      expectedNodeCode: "ACTIONS_SCHEMA",
      mutate: ({ actions }) => { actions.clips[0].path = "../clip.wav"; },
    },
    {
      id: "NEG-22-empty-explicit-catalog",
      expectedNodeCode: "ACTIONS_SCHEMA",
      mutate: ({ actions }) => { actions.clips = []; },
    },
    {
      id: "NEG-23-clip-size-outside-json-safe-integer",
      expectedNodeCode: "ACTIONS_SCHEMA",
      mutate: ({ actions }) => { actions.clips[0].size = 9_007_199_254_740_992; },
    },
  ];
}

async function runNegativeCases(baseScenario, validators, rustHost) {
  const base = {
    logicalIndex: decodeJson(baseScenario.logicalIndexBytes, "negative base logical-index"),
    actions: decodeJson(baseScenario.actionsBytes, "negative base actions"),
    transcript: decodeJson(baseScenario.transcriptBytes, "negative base transcript"),
  };
  const results = [];
  for (const definition of negativeDefinitions()) {
    const values = clone(base);
    definition.mutate(values);
    const caseRoot = path.join(RUN_ROOT, "negative", definition.id);
    await mkdir(caseRoot);
    const logicalIndexBytes = encodeJson(values.logicalIndex);
    const actionsBytes = encodeJson(values.actions);
    const transcriptBytes = encodeJson(values.transcript);
    const inputs = [
      ["logical-index.json", logicalIndexBytes],
      ["actions.json", actionsBytes],
      ["transcript.json", transcriptBytes],
    ];
    for (const [name, bytes] of inputs) await writeFile(path.join(caseRoot, name), bytes, { flag: "wx" });
    const beforeHashes = Object.fromEntries(inputs.map(([name, bytes]) => [name, sha256(bytes)]));

    let nodeError = null;
    try {
      const result = compileAndExecute({ logicalIndexBytes, actionsBytes, transcriptBytes, validators });
      if (definition.expectedResultMismatch && !result.allPassed) {
        nodeError = new NodeExecutionModelError(
          "EXPECTED_TRACE_MISMATCH",
          "execution trace differs from transcript expectation",
        );
      }
    } catch (error) {
      nodeError = error;
    }
    const nodeRejected = nodeError instanceof NodeExecutionModelError
      && nodeError.code === definition.expectedNodeCode;
    const nodeOutputPath = path.join(caseRoot, "node-output.json");
    const nodeOutputAbsent = !(await optionalLstat(nodeOutputPath));

    const rustOutputPath = path.join(caseRoot, "rust-output.json");
    const sentinel = Buffer.from("execution-model-negative-output-sentinel-v1\n", "utf8");
    await writeFile(rustOutputPath, sentinel, { flag: "wx" });
    const rustRun = runProcess(rustHost.binaryPath, [
      "execution-model",
      path.join(caseRoot, "logical-index.json"),
      path.join(caseRoot, "actions.json"),
      path.join(caseRoot, "transcript.json"),
      rustOutputPath,
    ], { cwd: REPO_ROOT });
    const rustOutputAfter = await readFile(rustOutputPath);
    const afterHashes = {};
    for (const [name] of inputs) afterHashes[name] = sha256(await readFile(path.join(caseRoot, name)));
    const inputFilesUnchanged = isDeepStrictEqual(beforeHashes, afterHashes);
    const rustRejected = rustRun.status !== 0;
    const rustOutputUnchanged = rustOutputAfter.equals(sentinel);
    const zeroSideEffect = nodeOutputAbsent && rustOutputUnchanged && inputFilesUnchanged;
    results.push({
      id: definition.id,
      passed: nodeRejected && rustRejected && zeroSideEffect,
      expectedNodeCode: definition.expectedNodeCode,
      observedNodeCode: nodeError?.code ?? nodeError?.name ?? null,
      rustExitCode: rustRun.status,
      rustErrorSha256: sha256(Buffer.from(String(rustRun.stderr ?? ""), "utf8")),
      checks: { nodeRejected, rustRejected, nodeOutputAbsent, rustOutputUnchanged, inputFilesUnchanged },
      zeroSideEffect,
    });
  }
  return results;
}

async function sourceEvidence() {
  const files = [
    "firmware/crates/yimi-fw-host/src/execution_model.rs",
    "firmware/crates/yimi-runtime-core/src/lib.rs",
    "firmware/Cargo.lock",
    "tools/execution-model/model.mjs",
    "tools/execution-model/run-crosscheck.mjs",
  ];
  const evidence = {};
  for (const relative of files) {
    const bytes = await readRegularWithin(REPO_ROOT, path.join(REPO_ROOT, relative));
    evidence[relative] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  return evidence;
}

async function run() {
  await prepareRunRoot();
  const validators = await loadValidators();
  const rustHost = await buildRustHost();
  const configs = [
    {
      id: "family-alpha",
      sourceProfile: "family-alpha-snapshot",
      snapshotRoot: FAMILY_SNAPSHOT_ROOT,
      transcriptPath: path.join(CONTRACT_ROOT, "family-alpha-transcript.json"),
      actualFamilyBuild: true,
      sourceKind: "actual-family-compiler-build",
    },
    {
      id: "golden-24",
      sourceProfile: "golden-24-design-snapshot",
      snapshotRoot: GOLDEN_24_ROOT,
      transcriptPath: path.join(CONTRACT_ROOT, "golden-24-transcript.json"),
      actualFamilyBuild: false,
      sourceKind: "golden-24-design-snapshot",
    },
    {
      id: "slot-order-trap",
      sourceProfile: "slot-order-trap",
      snapshotRoot: path.join(CONTRACT_ROOT, "order-trap"),
      transcriptPath: path.join(CONTRACT_ROOT, "order-trap-transcript.json"),
      actualFamilyBuild: false,
      sourceKind: "non-lexical-slot-order-fixture",
    },
  ];
  const loaded = [];
  for (const config of configs) loaded.push(await loadScenario(config, validators));
  const scenarios = [];
  for (const scenario of loaded) scenarios.push(await runGoldenScenario(scenario, validators, rustHost));
  const negativeCases = await runNegativeCases(loaded[0], validators, rustHost);
  const negativePassed = negativeCases.filter((entry) => entry.passed).length;
  const zeroSideEffect = negativeCases.filter((entry) => entry.zeroSideEffect).length;
  const sourceFiles = await sourceEvidence();
  const physicalClaimTrap = decodeJson(
    await readFile(path.join(RUN_ROOT, "node/family-alpha.json")),
    "physical evidence schema trap",
  ).executionModel;
  physicalClaimTrap.source.physicalEvidence = true;
  const hostSurrogatePhysicalClaimRejected = !validators.model(physicalClaimTrap);
  physicalClaimTrap.source.physicalMapSource = "snapshot-assigned";
  const assignedWithoutReceiptPhysicalClaimRejected = !validators.model(physicalClaimTrap);
  const gates = {
    schemasLoaded: true,
    familyActualBuildEvidenceMatched: scenarios[0].familyCompilerEvidence?.sourceFilesMatchReport === true,
    nodeModelsMatchTranscript: scenarios.every((scenario) => scenario.checks.nodeTranscriptExpected),
    rustModelsMatchTranscript: scenarios.every((scenario) => scenario.checks.rustTranscriptExpected),
    nodeRustExecutionModelsMatch: scenarios.every((scenario) => scenario.checks.executionModelMatch),
    nodeRustTracesMatch: scenarios.every((scenario) => scenario.checks.traceMatch),
    completeResultsMatch: scenarios.every((scenario) => scenario.checks.completeResultMatch),
    sourceInputsUnchanged: scenarios.every((scenario) => scenario.checks.inputFilesUnchanged),
    negativeCasesPassed: negativePassed === negativeCases.length,
    negativeFailuresZeroSideEffect: zeroSideEffect === negativeCases.length,
    hostSurrogatePhysicalClaimRejected,
    assignedWithoutReceiptPhysicalClaimRejected,
  };
  const report = {
    schemaVersion: 1,
    profile: "execution-model-validation-v1",
    contract: {
      schemas: validators.schemaFiles,
      expectationAuthority: "execution transcripts plus independent Node parser/planner",
      rustOutputUsedToGenerateNodeExpectation: false,
      physicalMapSource: "host-surrogate-not-oid",
      physicalEvidence: false,
    },
    toolchain: {
      node: process.version,
      cargo: rustHost.cargoVersion,
      rustc: rustHost.rustcVersion,
      rustHostBinarySha256: rustHost.binarySha256,
      cargoLockedBuild: true,
    },
    gates,
    scenarios,
    negativeSummary: {
      passed: negativePassed,
      total: negativeCases.length,
      zeroSideEffect,
      expectedZeroSideEffect: negativeCases.length,
      cases: negativeCases,
    },
    sourceEvidence: sourceFiles,
    evidenceBoundary: {
      hostSurrogatePhysicalCodesOnly: true,
      physicalOidEvidenceProven: false,
      targetParserEncodingProven: false,
      targetRamFlashBudgetProven: false,
      targetBoardExecutionProven: false,
      twoBoardHilProven: false,
    },
  };
  const reportBytes = encodeJson(report);
  await writeFile(REPORT_PATH, reportBytes, { flag: "wx" });
  const allPassed = Object.values(gates).every(Boolean);
  console.log(`ExecutionModel golden scenarios: ${scenarios.filter((entry) => entry.passed).length}/${scenarios.length}`);
  console.log(`Node/Rust model+trace match: ${scenarios.every((entry) => entry.checks.completeResultMatch) ? "MATCH" : "DRIFT"}`);
  console.log(`ExecutionModel negatives: ${negativePassed}/${negativeCases.length}; zero-side-effect ${zeroSideEffect}/${negativeCases.length}`);
  console.log(`Report SHA-256: ${sha256(reportBytes)}`);
  console.log(`Report: ${REPORT_PATH}`);
  if (!allPassed) process.exitCode = 1;
}

const runnerLock = await acquireRunnerLock();
try {
  await run();
} finally {
  try { await runnerLock.close(); } catch { /* Preserve validation result. */ }
  try { await rm(RUNNER_LOCK, { force: true }); } catch { /* Preserve validation result. */ }
}
