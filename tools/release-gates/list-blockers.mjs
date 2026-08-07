import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateIdsForReportScope } from "../../contracts/release-gates-v1.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scope = process.argv[2];
if (!scope) throw new Error("usage: node tools/release-gates/list-blockers.mjs REPORT_SCOPE");
const catalog = JSON.parse(await readFile(path.join(root, "hardware/evt0/release-gates-v1/catalog.json"), "utf8"));
const gateIds = gateIdsForReportScope(catalog, scope);
const output = process.argv.includes("--binding")
  ? { catalogId: catalog.catalogId, catalogVersion: catalog.catalogVersion, releaseDecisionOwner: "build/release-gate-current/release-decision.json", reportScopeGateIds: gateIds }
  : gateIds;
process.stdout.write(`${JSON.stringify(output)}\n`);
