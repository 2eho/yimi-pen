import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const sourcePath = path.join(repoRoot, "hardware/evt0/evidence-sources.json");
const reportPath = path.join(repoRoot, "build/hardware-evidence-refresh.json");
const sources = JSON.parse(await readFile(sourcePath, "utf8")).sources
  .filter((source) => /^SRC-OID-/u.test(source.id));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectedSha256(source) {
  return String(source.sha256 ?? "").toLowerCase();
}

const checks = [];
for (const source of sources) {
  const headers = { "user-agent": "yimi-pen-hardware-evidence-refresh/1.0" };
  const request = { method: source.method ?? "GET", headers };
  if (source.method === "POST") {
    request.body = JSON.stringify(source.requestBody ?? {});
    headers["content-type"] = "application/json";
  }

  try {
    const response = await fetch(source.url, request);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actualSha256 = sha256(bytes);
    checks.push({
      id: source.id,
      url: source.url,
      method: request.method,
      status: response.status,
      bytes: bytes.byteLength,
      sha256: actualSha256,
      expected: { status: source.httpStatus, bytes: source.bytes, sha256: expectedSha256(source) },
      matched: response.status === source.httpStatus
        && bytes.byteLength === source.bytes
        && actualSha256 === expectedSha256(source),
    });
  } catch (error) {
    checks.push({
      id: source.id,
      url: source.url,
      method: request.method,
      matched: false,
      error: `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
    });
  }
}

const sourceSetSha256 = sha256(Buffer.from(JSON.stringify(
  checks.map((check) => ({ id: check.id, sha256: check.sha256 ?? null, matched: check.matched })),
)));
const report = {
  schemaVersion: 1,
  profile: "yimi-hardware-evidence-refresh-v1",
  generatedAt: new Date().toISOString(),
  sourceSet: "SRC-OID-*",
  sourceSetSha256,
  total: checks.length,
  matched: checks.filter((check) => check.matched).length,
  drifted: checks.filter((check) => !check.matched).length,
  checks,
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Hardware evidence refresh: ${report.matched}/${report.total} source hashes match`);
console.log(`Source set SHA-256: ${sourceSetSha256}`);
console.log(`Report: ${reportPath}`);
if (report.drifted > 0) process.exitCode = 1;
