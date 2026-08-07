import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateMethodGapManifest, loadMethodGapContext } from "./validate-hardware-method-gap-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(ROOT, "build", "hardware-method-gap-evidence-selftest.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutate(name, mutateDocument = () => {}, mutateContext = null, expectRejected = true) {
  return { name, mutateDocument, mutateContext, expectRejected };
}

function withDocument(context, key, mutateDocument) {
  return { ...context, [key]: { ...context[key], document: mutateDocument(clone(context[key].document)) } };
}

function withFixtureOwnerDocument(context, key, mutateDocument) {
  return {
    ...context,
    fixtureContext: {
      ...context.fixtureContext,
      ownerFiles: {
        ...context.fixtureContext.ownerFiles,
        [key]: { ...context.fixtureContext.ownerFiles[key], document: mutateDocument(clone(context.fixtureContext.ownerFiles[key].document)) },
      },
    },
  };
}

const MUTATIONS = [
  mutate("source SHA drift", (document) => { document.officialSources[0].sha256 = "0".repeat(64); }),
  mutate("source byte count drift", (document) => { document.officialSources[0].bytes += 1; }),
  mutate("unofficial domain", (document) => { document.officialSources[0].url = "https://example.com/usb.pdf"; }),
  mutate("missing retrieval timestamp", (document) => { delete document.officialSources[0].retrievedAt; }),
  mutate("wrong content type", (document) => { document.officialSources[0].contentType = "application/octet-stream"; }),
  mutate("missing official source", (document) => { document.officialSources.pop(); }),
  mutate("duplicate source ID", (document) => { document.officialSources[1].sourceId = document.officialSources[0].sourceId; }),
  mutate("missing gap", (document) => { document.gaps.pop(); }),
  mutate("extra gap", (document) => { document.gaps.push(clone(document.gaps[0])); }),
  mutate("unsupported frozen parameter", (document) => { document.gaps[0].targetNeutralSkeleton.physicalThresholds = "DEFINED"; }),
  mutate("concrete target parameter", (document) => { document.gaps[0].targetSpecificParameters.push("5V"); }),
  mutate("false accepted method", (document) => { document.gaps[0].acceptedInMethodCatalog = true; }),
  mutate("false physical qualification claim", (document) => { document.claims = { physicalQualification: true }; }),
  mutate("target promotion", (document) => { document.boardTargetState = "FROZEN"; }),
  mutate("ReleaseGate effect", (document) => { document.effects.releaseGate = "CLOSE"; }),
  mutate("audit snapshot provenance drift", (document) => { document.protectedFiles[0].sha256 = "1".repeat(64); }),
  mutate("audit snapshot state drift", (document) => { document.protectedFiles[9].state = "UNCHANGED_EXPECTED"; }),
  mutate("unavailable source represented as captured", (document) => { document.unavailableOfficialSources[0].localRawPath = "hardware/evt0/method-gap-evidence-v1/raw/jedec.html"; }),
  mutate("software hardware impact", (document) => { document.softwareReadOnly.hardwareImpact = "TARGET_REQUIRED"; }),
  mutate("implementation revision drift", (document) => { document.implementation[0].revision = "2.0.0"; }),
  mutate("wrong decision classification", (document) => { document.decisions[1].classification = "FREEZE_TARGET_NEUTRAL_SKELETON"; }),
  mutate("unknown method reference", (document) => { document.gaps[1].existingMethodRefs = ["METHOD-UNKNOWN-999"]; }),
  mutate("unknown instrument slot reference", (document) => { document.gaps[2].existingInstrumentSlotRefs = ["SLOT-UNKNOWN-999"]; }),
  mutate("source publisher drift", (document) => { document.officialSources[0].publisher = "Community Blog"; }),
  mutate("benign current dependency identity drift is semantic-only", () => {}, (context) => ({
    ...context,
    methodCatalogFile: { ...context.methodCatalogFile, sha256: "f".repeat(64) },
    registrationPlanFile: { ...context.registrationPlanFile, sha256: "e".repeat(64) },
    topologyFile: { ...context.topologyFile, sha256: "d".repeat(64) },
    targetBindingFile: { ...context.targetBindingFile, sha256: "c".repeat(64) },
  }), false),
  mutate("live method catalog semantic drift", () => {}, (context) => withDocument(context, "methodCatalogFile", (document) => ({ ...document, methods: document.methods.slice(0, -1) }))),
  mutate("live registration plan semantic drift", () => {}, (context) => withDocument(context, "registrationPlanFile", (document) => ({ ...document, slots: document.slots.slice(0, -1) }))),
  mutate("live target binding semantic drift", () => {}, (context) => withDocument(context, "targetBindingFile", (document) => ({ ...document, targetIdentity: { ...document.targetIdentity, state: "RESOLVED" } }))),
  mutate("live TestResult owner semantic drift", () => {}, (context) => withFixtureOwnerDocument(context, "testResultSchema", (document) => ({ ...document, required: document.required.slice(0, -1) }))),
  mutate("live ReleaseGate owner semantic drift", () => {}, (context) => withFixtureOwnerDocument(context, "releaseGateCatalog", (document) => ({ ...document, gates: document.gates.slice(0, -1) }))),
  mutate("live evidence-capture owner semantic drift", () => {}, (context) => withFixtureOwnerDocument(context, "evidenceCaptureProfile", (document) => ({ ...document, lanes: document.lanes.slice(0, -1) }))),
];

const context = await loadMethodGapContext();
const baselineChecks = evaluateMethodGapManifest(context);
const cases = [];
for (const mutation of MUTATIONS) {
  const document = clone(context.manifestFile.document);
  mutation.mutateDocument(document);
  const mutationContext = mutation.mutateContext ? mutation.mutateContext(context) : context;
  const checks = evaluateMethodGapManifest(mutationContext, document);
  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name);
  cases.push({ name: mutation.name, expectRejected: mutation.expectRejected, rejected: failedChecks.length > 0, failedChecks });
}

const report = {
  schemaVersion: 1,
  reportKind: "hardware-method-gap-evidence-selftest-v1",
  baseline: { total: baselineChecks.length, passed: baselineChecks.filter((check) => check.passed).length, failed: baselineChecks.filter((check) => !check.passed).length },
  mutationCount: cases.length,
  rejectedMutationCount: cases.filter((item) => item.rejected).length,
  acceptedMutationCount: cases.filter((item) => !item.rejected).length,
  unexpectedMutationCount: cases.filter((item) => item.rejected !== item.expectRejected).length,
  failedMutationCount: cases.filter((item) => item.rejected !== item.expectRejected).length,
  cases,
  passed: baselineChecks.every((check) => check.passed) && cases.every((item) => item.rejected === item.expectRejected),
};
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Hardware method-gap evidence self-test: ${report.passed ? "PASS" : "FAIL"} (${report.rejectedMutationCount}/${report.mutationCount} mutations rejected)`);
console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
if (!report.passed) process.exitCode = 1;
