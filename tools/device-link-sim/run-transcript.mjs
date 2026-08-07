import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { DeviceLinkReferenceHandler, equal } from "./engine.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = path.join(repoRoot, "hardware/evt0/device-link-v1");
const outputRoot = path.join(repoRoot, "build/device-link-sim");
const nodeOutputPath = path.join(outputRoot, "node-transcript-result.json");
const rustOutputPath = path.join(outputRoot, "rust-transcript-result.json");
const inputPaths = [
  path.join(fixtureRoot, "transaction-golden.json"),
  path.join(fixtureRoot, "transaction-negative.json"),
];
const requiredCoverage = [
  "two-file-multi-chunk",
  "manifest-first",
  "request-id-replay",
  "request-id-conflict",
  "chunk-idempotent-new-request",
  "chunk-conflict",
  "offset-gap",
  "offset-overlap",
  "out-of-range",
  "disconnect-before-dispatch",
  "disconnect-after-durable-before-response",
  "transaction-resume",
  "transaction-metadata-conflict",
  "verify-incomplete",
  "begin-cas",
  "activate-cas",
  "abort-replay",
  "rollback-replay",
];

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function summarizeState(state) {
  return {
    activeSnapshotId: state.activeSnapshotId,
    lastGoodSnapshotId: state.lastGoodSnapshotId,
    generation: state.generation,
    transactions: Object.fromEntries(Object.entries(state.transactions).map(([id, tx]) => [id, {
      status: tx.status,
      committedBytes: tx.committedBytes,
      committedFiles: tx.committedFiles,
    }])),
  };
}

function runStep(handler, scenarioId, step, validateEnvelope, ajv) {
  expect(
    validateEnvelope(step.request),
    `${scenarioId}/${step.id}: request is not a DeviceLink v1 envelope: ${ajv.errorsText(validateEnvelope.errors)}`,
  );
  const semanticBefore = handler.semanticDigest();
  const fullBefore = handler.fullDigest();
  let handled;
  let firstResponse = null;
  let beforeDispatchDigest = null;

  if (step.delivery === "disconnect-before-dispatch") {
    beforeDispatchDigest = handler.fullDigest();
    expect(beforeDispatchDigest === fullBefore, `${scenarioId}/${step.id}: pre-dispatch disconnect changed state`);
    handled = handler.handle(step.request);
  } else if (step.delivery === "disconnect-after-durable-before-response") {
    const first = handler.handle(step.request);
    firstResponse = first.response;
    const afterDurable = handler.fullDigest();
    handled = handler.handle(step.request);
    expect(handler.fullDigest() === afterDurable, `${scenarioId}/${step.id}: retry after durable response loss changed state`);
    expect(handled.replayed, `${scenarioId}/${step.id}: durable retry did not hit request ledger`);
    expect(equal(first.response, handled.response), `${scenarioId}/${step.id}: durable retry response differs`);
  } else {
    handled = handler.handle(step.request);
  }

  const semanticAfter = handler.semanticDigest();
  const fullAfter = handler.fullDigest();
  expect(
    validateEnvelope(handled.response),
    `${scenarioId}/${step.id}: response is not a DeviceLink v1 envelope: ${ajv.errorsText(validateEnvelope.errors)}`,
  );
  const actualMutation = semanticAfter === semanticBefore ? "unchanged" : "changed";
  const actualCode = handled.response.ok ? null : handled.response.error.code;
  expect(handled.response.ok === step.expected.ok, `${scenarioId}/${step.id}: ok mismatch`);
  expect(actualCode === (step.expected.errorCode ?? null), `${scenarioId}/${step.id}: error mismatch ${actualCode}`);
  expect(
    (handled.response.ok ? null : handled.response.error.detail.semanticCode ?? null) === (step.expected.semanticCode ?? null),
    `${scenarioId}/${step.id}: semantic error mismatch`,
  );
  expect(actualMutation === step.expected.semanticMutation, `${scenarioId}/${step.id}: mutation mismatch ${actualMutation}`);
  expect(handled.replayed === (step.expected.replayed ?? false), `${scenarioId}/${step.id}: replay mismatch`);
  if (!handled.response.ok) {
    expect(semanticAfter === semanticBefore, `${scenarioId}/${step.id}: failed request changed semantic state`);
    expect(fullAfter === fullBefore, `${scenarioId}/${step.id}: failed request changed internal durable state`);
  }

  return {
    id: step.id,
    delivery: step.delivery ?? "normal",
    ok: handled.response.ok,
    errorCode: actualCode,
    replayed: handled.replayed,
    semanticMutation: actualMutation,
    nonSuccessZeroSideEffects: handled.response.ok ? null : semanticAfter === semanticBefore && fullAfter === fullBefore,
    disconnectBeforeDispatchZeroSideEffects: beforeDispatchDigest === null ? null : beforeDispatchDigest === fullBefore,
    durableRetryResponseStable: firstResponse === null ? null : equal(firstResponse, handled.response),
  };
}

async function main() {
  const schema = await json(path.join(fixtureRoot, "transaction-transcript.schema.json"));
  const envelopeSchema = await json(path.join(fixtureRoot, "schema.json"));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    allowUnionTypes: true,
  });
  const validate = ajv.compile(schema);
  const validateEnvelope = ajv.compile(envelopeSchema);
  const documents = await Promise.all(inputPaths.map(json));
  for (const [index, document] of documents.entries()) {
    if (!validate(document)) {
      throw new Error(`${path.basename(inputPaths[index])}: transcript schema invalid\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
    }
  }

  const scenarioReports = [];
  for (const document of documents) {
    for (const scenario of document.scenarios) {
      const handler = new DeviceLinkReferenceHandler(document.fixture);
      const steps = scenario.steps.map((step) => runStep(handler, scenario.id, step, validateEnvelope, ajv));
      const state = summarizeState(handler.semanticState());
      expect(equal(state, scenario.expectedFinal), `${scenario.id}: final state mismatch\nactual=${JSON.stringify(state)}`);
      scenarioReports.push({ id: scenario.id, class: document.class, covers: scenario.covers, passed: true, steps, finalState: state });
    }
  }

  const inputHashes = {};
  for (const inputPath of [
    path.join(fixtureRoot, "schema.json"),
    path.join(fixtureRoot, "transaction-transcript.schema.json"),
    ...inputPaths,
  ]) {
    const bytes = await readFile(inputPath);
    inputHashes[path.basename(inputPath)] = createHash("sha256").update(bytes).digest("hex");
  }
  const nonSuccessStepCount = scenarioReports.flatMap((scenario) => scenario.steps).filter((step) => step.ok === false).length;
  const zeroSideEffectPassCount = scenarioReports.flatMap((scenario) => scenario.steps)
    .filter((step) => step.nonSuccessZeroSideEffects === true).length;
  const observedCoverage = [...new Set(scenarioReports.flatMap((scenario) => scenario.covers))].sort();
  const missingCoverage = requiredCoverage.filter((item) => !observedCoverage.includes(item));
  expect(missingCoverage.length === 0, `missing required transaction coverage: ${missingCoverage.join(", ")}`);
  await mkdir(outputRoot, { recursive: true });
  const nodeAdapter = {
    schemaVersion: 1,
    profile: "device-link-v1-node-transaction-adapter",
    hostManifestSurrogate: true,
    results: scenarioReports,
  };
  await writeFile(nodeOutputPath, `${JSON.stringify(nodeAdapter, null, 2)}\n`, "utf8");

  const cargoResult = await run("cargo", [
    "run",
    "--quiet",
    "--manifest-path",
    path.join(repoRoot, "firmware/Cargo.toml"),
    "--locked",
    "-p",
    "yimi-fw-host",
    "--",
    "device-link-transcript",
    inputPaths[0],
    inputPaths[1],
    rustOutputPath,
  ]);
  if (cargoResult.exitCode !== 0) {
    throw new Error(`Rust DeviceLink transcript adapter failed (${cargoResult.exitCode}):\n${cargoResult.stderr}${cargoResult.stdout}`);
  }
  const rustAdapter = await json(rustOutputPath);
  expect(rustAdapter.hostManifestSurrogate === true, "Rust adapter did not identify its host manifest surrogate");
  const rustById = new Map(rustAdapter.results.map((scenario) => [scenario.id, scenario]));
  const comparisons = scenarioReports.map((node) => {
    const rust = rustById.get(node.id);
    const stepResultsMatch = rust !== undefined && equal(node.steps, rust.steps);
    const finalStateMatch = rust !== undefined && equal(node.finalState, rust.finalState);
    return {
      id: node.id,
      class: node.class,
      covers: node.covers,
      passed: stepResultsMatch && finalStateMatch,
      stepResultsMatch,
      finalStateMatch,
      node,
      rust: rust ?? null,
    };
  });
  const passedComparisons = comparisons.filter((comparison) => comparison.passed).length;
  const report = {
    schemaVersion: 1,
    profile: "device-link-v1-host-transaction-transcript",
    hostSimulation: true,
    hostManifestSurrogate: true,
    deterministic: true,
    passed: passedComparisons === comparisons.length,
    inputSha256: inputHashes,
    coverage: observedCoverage,
    summary: {
      scenarios: scenarioReports.length,
      passed: passedComparisons,
      nonSuccessSteps: nonSuccessStepCount,
      nonSuccessStepsWithZeroSideEffects: zeroSideEffectPassCount,
    },
    scenarios: comparisons,
    nodeAdapter,
    rustAdapter,
  };
  const reportPath = path.join(outputRoot, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`DeviceLink Node/Rust transcript: ${passedComparisons}/${comparisons.length} scenarios passed`);
  console.log(`Non-success zero-side-effect checks: ${zeroSideEffectPassCount}/${nonSuccessStepCount}`);
  console.log(`Report: ${reportPath}`);
  if (!report.passed) process.exitCode = 1;
}

await main();
