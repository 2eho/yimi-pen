import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateFixtureDocuments, loadFixtureContext } from "./validate-hardware-test-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(ROOT, "build", "hardware-test-fixture-selftest.json");

function clone(value) {
  return structuredClone(value);
}

function baselineDocuments(context) {
  return Object.fromEntries(Object.entries(context.packageFiles).map(([key, value]) => [key, clone(value.document)]));
}

function mutateDocument(context, key, mutator) {
  const documents = baselineDocuments(context);
  mutator(documents[key], documents);
  return documents;
}

const cases = [
  ["missing capability", "profile", (doc) => doc.capabilities.pop()],
  ["extra capability", "profile", (doc) => doc.capabilities.push(clone(doc.capabilities[0]))],
  ["duplicate capability ID", "profile", (doc) => { doc.capabilities[1].id = doc.capabilities[0].id; }],
  ["unknown interface", "profile", (doc) => { doc.capabilities[1].interfaceRefs[0] = "IF-UNKNOWN"; }],
  ["missing interface", "profile", (doc) => { doc.capabilities[1].interfaceRefs.pop(); }],
  ["duplicate interface", "profile", (doc) => { doc.capabilities[1].interfaceRefs.push(doc.capabilities[1].interfaceRefs[0]); }],
  ["missing method reference", "profile", (doc) => { doc.capabilities[1].methodRefs.pop(); }],
  ["unknown method reference", "profile", (doc) => { doc.capabilities[1].methodRefs[0] = "METHOD-UNKNOWN"; }],
  ["missing instrument-slot reference", "profile", (doc) => { doc.capabilities[2].instrumentSlotRefs.pop(); }],
  ["unknown instrument-slot reference", "profile", (doc) => { doc.capabilities[2].instrumentSlotRefs[0] = "SLOT-UNKNOWN"; }],
  ["missing asset-kind reference", "profile", (doc) => { doc.capabilities[0].assetKindRefs.pop(); }],
  ["unknown asset-kind reference", "profile", (doc) => { doc.capabilities[0].assetKindRefs[0] = "UNKNOWN_ASSET"; }],
  ["missing ReleaseGate reference", "profile", (doc) => { doc.capabilities[1].releaseGateRefs.pop(); }],
  ["unknown ReleaseGate reference", "profile", (doc) => { doc.capabilities[1].releaseGateRefs[0] = "RG-UNKNOWN"; }],
  ["pre-target concrete voltage", "adapterTemplate", (doc) => { doc.targetDependent.voltageV = 3.3; }],
  ["pre-target concrete current", "adapterTemplate", (doc) => { doc.targetDependent.currentA = 0.25; }],
  ["pre-target concrete pin", "adapterTemplate", (doc) => { doc.targetDependent.pinMappings = ["PIN-1"]; }],
  ["pre-target concrete connector", "adapterTemplate", (doc) => { doc.targetDependent.connectorMappings = ["CONNECTOR-1"]; }],
  ["pre-target concrete pogo", "adapterTemplate", (doc) => { doc.targetDependent.pogoMappings = ["POGO-1"]; }],
  ["pre-target concrete mechanical value", "adapterTemplate", (doc) => { doc.targetDependent.mechanical.lengthMm = 100; }],
  ["incomplete five-tuple", "adapterTemplate", (doc) => { doc.targetIdentity.fullFiveTuple.BOARD_MPN = "BOARD-TARGET"; }],
  ["false target state", "adapterTemplate", (doc) => { doc.targetIdentity.state = "BOUND"; }],
  ["false physical fixture claim", "instanceTemplate", (doc) => { doc.claims.physicalFixture = true; }],
  ["false serial claim", "instanceTemplate", (doc) => { doc.physicalIdentity.serial = "SERIAL-01"; }],
  ["false calibration claim", "instanceTemplate", (doc) => { doc.calibration.state = "TRACEABLE"; }],
  ["false qualification claim", "instanceTemplate", (doc) => { doc.qualification.state = "QUALIFIED"; }],
  ["false physical readiness claim", "instanceTemplate", (doc) => { doc.qualification.physicalReady = true; }],
  ["synthetic evidence represented as physical", "selftestTemplate", (doc) => { doc.evidence.physicalEvidence = true; }],
  ["selftest closes ReleaseGate", "selftestTemplate", (doc) => { doc.promotionBoundary.canCloseReleaseGate = true; }],
  ["selftest promotes board state", "selftestTemplate", (doc) => { doc.promotionBoundary.canPromoteBoardState = true; }],
  ["cross-owner field duplication", "adapterTemplate", (doc) => { doc.interfaceBindings = []; }],
  ["owner path misuse", "profile", (doc) => { doc.ownerRefs.methodCatalog.path = "hardware/evt0/hardware-system-v1/topology.json"; }],
  ["owner hash misuse", "selftestTemplate", (doc) => { doc.ownerRefs.labSessionTemplate.sha256 = "a".repeat(64); }],
  ["revision drift", "profile", (doc) => { doc.implementation[0].revision = "9.9.9"; }],
  ["hash drift", "profile", (doc) => { doc.implementation[0].sha256 = "b".repeat(64); }],
  ["storage coverage gap masked", "profile", (doc) => { doc.coverageGaps = doc.coverageGaps.filter((gap) => gap.id !== "GAP-IF-STORAGE-POWER-LOSS-METHOD"); }],
  ["control/status coverage gap masked", "profile", (doc) => { doc.coverageGaps[2].state = "RECOMMENDED"; }],
  ["USB method gap masked", "profile", (doc) => { doc.coverageGaps[0].methodRefs = ["OID-FUNCTION-001"]; }],
  ["selftest fixture-only flag removed", "selftestTemplate", (doc) => { doc.fixtureOnly = false; }],
  ["selftest raw evidence added", "selftestTemplate", (doc) => { doc.evidence.rawArtifactRefs = ["build/physical/raw.bin"]; }],
];

const context = await loadFixtureContext();
const baseline = evaluateFixtureDocuments(context, null, { checkFormatting: false });
const results = [];
if (!baseline.passed) {
  throw new Error(`fixture baseline must pass before negative mutations: ${JSON.stringify(baseline.summary)}`);
}

for (const [name, key, mutator] of cases) {
  const documents = mutateDocument(context, key, mutator);
  const result = evaluateFixtureDocuments(context, documents, { checkFormatting: false });
  results.push({
    name,
    document: key,
    rejected: !result.passed,
    failedChecks: result.checks.filter((check) => !check.passed).map((check) => check.name),
  });
}

const report = {
  schemaVersion: 1,
  reportKind: "hardware-test-fixture-selftest-v1",
  baseline: baseline.summary,
  mutationCount: results.length,
  rejectedMutationCount: results.filter((result) => result.rejected).length,
  failedMutationCount: results.filter((result) => !result.rejected).length,
  cases: results,
  passed: results.length >= 20 && results.every((result) => result.rejected),
};

await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Hardware test fixture self-test: ${report.passed ? "PASS" : "FAIL"} (${report.rejectedMutationCount}/${report.mutationCount} mutations rejected)`);
console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
if (!report.passed) {
  for (const result of results.filter((item) => !item.rejected)) console.error(`- mutation accepted: ${result.name}`);
  process.exitCode = 1;
}
