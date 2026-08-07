import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertReleaseGateCatalog,
  computeReleaseGateCatalogId,
} from "../../contracts/release-gates-v1.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/release-gates-v1");
const CATALOG_PATH = path.join(CONTRACT_ROOT, "catalog.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function refreshedCatalog() {
  const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
  const [adapterBytes, legacyBytes] = await Promise.all([
    readFile(path.join(CONTRACT_ROOT, "host-report-adapters.json")),
    readFile(path.join(CONTRACT_ROOT, "legacy-blocker-inventory.json")),
  ]);
  catalog.hostAdapterRegistrySha256 = sha256(adapterBytes);
  catalog.legacyInventorySha256 = sha256(legacyBytes);
  const semanticFiles = {};
  for (const relative of Object.keys(catalog.semanticFiles).sort((left, right) => left.localeCompare(right, "en"))) {
    semanticFiles[relative] = sha256(await readFile(path.join(REPO_ROOT, ...relative.split("/"))));
  }
  catalog.semanticFiles = semanticFiles;
  catalog.catalogId = `rgc:sha256:${"0".repeat(64)}`;
  catalog.catalogId = computeReleaseGateCatalogId(catalog);
  return assertReleaseGateCatalog(catalog);
}

const arguments_ = process.argv.slice(2);
const write = arguments_.length === 1 && arguments_[0] === "--write";
if (arguments_.length > (write ? 1 : 0)) throw new Error("refresh-catalog accepts only optional --write");

const expected = encode(await refreshedCatalog());
const current = await readFile(CATALOG_PATH);
if (write) {
  const temporary = `${CATALOG_PATH}.tmp-${process.pid}`;
  await writeFile(temporary, expected, { flag: "wx" });
  await rename(temporary, CATALOG_PATH);
  console.log(`Release gate catalog refreshed: ${JSON.parse(expected).catalogId}`);
} else {
  if (!current.equals(expected)) {
    console.error("Release gate catalog hashes or identity are stale; run npm run generate:release-gate-catalog");
    process.exitCode = 1;
  } else {
    console.log(`Release gate catalog current: ${JSON.parse(expected).catalogId}`);
  }
}

