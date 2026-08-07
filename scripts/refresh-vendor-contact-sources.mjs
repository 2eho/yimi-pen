import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ledgerPath = path.join(root, "hardware", "evt0", "evidence-sources.json");
const reportPath = path.join(root, "build", "vendor-contact-source-refresh.json");
const snapshotRoot = path.join(root, "build", "contact-source-snapshots");
const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const sources = ledger.sources.filter((source) => /^SRC-MB1-CONTACT-/u.test(source.id) || source.contactUse === true);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function extension(source) {
  if (source.kind.endsWith("script")) return ".js";
  if (source.kind.endsWith("html")) return ".html";
  return ".bin";
}

if (sources.length === 0) throw new Error("No vendor contact sources are registered");

await mkdir(snapshotRoot, { recursive: true });
const checks = [];
for (const source of sources) {
  const method = source.method ?? "GET";
  try {
    const response = await fetch(source.url, {
      method,
      headers: { "user-agent": "yimi-pen-hardware-contact-evidence/1.0" },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const observedSha256 = sha256(bytes);
    const snapshotPath = path.join(snapshotRoot, `${source.id}${extension(source)}`);
    await writeFile(snapshotPath, bytes);
    checks.push({
      id: source.id,
      method,
      url: source.url,
      status: response.status,
      bytes: bytes.length,
      sha256: observedSha256,
      lastModified: response.headers.get("last-modified"),
      etag: response.headers.get("etag"),
      snapshotPath: path.relative(root, snapshotPath).replaceAll("\\", "/"),
      expected: {
        status: source.httpStatus,
        bytes: source.bytes,
        sha256: String(source.sha256).toLowerCase(),
      },
      matched: response.status === source.httpStatus &&
        bytes.length === source.bytes &&
        observedSha256 === String(source.sha256).toLowerCase(),
    });
  } catch (error) {
    checks.push({
      id: source.id,
      method,
      url: source.url,
      matched: false,
      error: `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`,
    });
  }
}

const sourceSetSha256 = sha256(Buffer.from(JSON.stringify(checks.map((check) => ({
  id: check.id,
  sha256: check.sha256 ?? null,
  matched: check.matched,
}))), "utf8"));
const report = {
  schemaVersion: 1,
  profile: "yimi-vendor-contact-source-refresh-v1",
  generatedAt: new Date().toISOString(),
  sourceSet: "SRC-MB1-CONTACT-* plus contactUse=true",
  sourceSetSha256,
  total: checks.length,
  matched: checks.filter((check) => check.matched).length,
  drifted: checks.filter((check) => !check.matched).length,
  targetBindingEffect: "NONE_CONTACT_SOURCE_ONLY",
  checks,
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Vendor contact source refresh: ${report.matched}/${report.total} source hashes match`);
console.log(`Source set SHA-256: ${sourceSetSha256}`);
console.log(`Report: ${reportPath}`);
if (report.drifted > 0) process.exitCode = 1;
