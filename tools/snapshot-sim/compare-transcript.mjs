import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeTranscript } from "./transcript-node-adapter.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const transcriptPath = path.join(repoRoot, "hardware/evt0/snapshot-v1/operation-transcript.json");
const buildRoot = path.join(repoRoot, "build/snapshot-sim");
const nodeOutputPath = path.join(buildRoot, "node-transcript-result.json");
const rustOutputPath = path.join(buildRoot, "rust-transcript-result.json");
const reportPath = path.join(buildRoot, "report.json");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
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

function outcomeOf(result) {
  return {
    active: result.active,
    lastGood: result.lastGood,
    generation: result.generation,
    snapshot: result.snapshot,
    error: result.error,
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function compareSnapshotTranscript() {
  await mkdir(buildRoot, { recursive: true });
  const transcriptBytes = await readFile(transcriptPath);
  const transcript = JSON.parse(transcriptBytes.toString("utf8"));

  const nodeResult = await runNodeTranscript({ repoRoot, transcriptPath, buildRoot });
  await writeFile(nodeOutputPath, `${JSON.stringify(nodeResult, null, 2)}\n`, "utf8");

  const cargoResult = await run("cargo", [
    "run",
    "--quiet",
    "--manifest-path",
    path.join(repoRoot, "firmware/Cargo.toml"),
    "--locked",
    "-p",
    "yimi-fw-host",
    "--",
    "snapshot-transcript",
    transcriptPath,
    rustOutputPath,
  ]);
  if (cargoResult.exitCode !== 0) {
    throw new Error(`Rust transcript adapter failed (${cargoResult.exitCode}):\n${cargoResult.stderr}${cargoResult.stdout}`);
  }
  const rustResult = await readJson(rustOutputPath);
  const nodeById = new Map(nodeResult.results.map((result) => [result.id, result]));
  const rustById = new Map(rustResult.results.map((result) => [result.id, result]));
  const comparisons = transcript.scenarios.map((scenario) => {
    const node = outcomeOf(nodeById.get(scenario.id) ?? {});
    const rust = outcomeOf(rustById.get(scenario.id) ?? {});
    return {
      id: scenario.id,
      expected: scenario.expected,
      node,
      rust,
      nodeMatchesExpected: same(node, scenario.expected),
      rustMatchesExpected: same(rust, scenario.expected),
      adaptersMatch: same(node, rust),
    };
  });
  const passedCount = comparisons.filter(
    (item) => item.nodeMatchesExpected && item.rustMatchesExpected && item.adaptersMatch,
  ).length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profile: "snapshot-node-rust-differential",
    transcriptSha256: createHash("sha256").update(transcriptBytes).digest("hex"),
    passed: passedCount === comparisons.length,
    scenarioSummary: { total: comparisons.length, passed: passedCount },
    comparedFields: ["active", "lastGood", "generation", "snapshot", "error"],
    comparisons,
    nodeAdapter: nodeResult,
    rustAdapter: rustResult,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Snapshot Node/Rust transcript: ${passedCount}/${comparisons.length} passed`);
  console.log(`Report: ${reportPath}`);
  if (!report.passed) process.exitCode = 1;
  return report;
}
