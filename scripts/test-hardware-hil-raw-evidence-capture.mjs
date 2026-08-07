import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateHilRawEvidenceCapture, loadHilRawEvidenceCaptureContext } from "./validate-hardware-hil-raw-evidence-capture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(ROOT, "build", "hardware-hil-raw-evidence-capture-selftest.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutate(name, mutateDocument = () => {}, mutateContext = null, expectRejected = true) {
  return { name, mutateDocument, mutateContext, expectRejected };
}

function withFile(context, key, mutator) {
  return { ...context, [key]: { ...context[key], document: mutator(clone(context[key].document)) } };
}

function withText(context, key, mutator) {
  return { ...context, [key]: { ...context[key], text: mutator(context[key].text) } };
}

const MUTATIONS = [
  mutate("status promotion", (manifest) => { manifest.status = "ACCEPTED"; }),
  mutate("lane adoption fabricated", (manifest) => { manifest.lane.acceptedInEvidenceCaptureProfile = true; manifest.lane.adoptionId = "HIL-ADOPTED"; }),
  mutate("extra lane", (manifest) => { manifest.lane.extraLane = "HIL2"; }),
  mutate("missing method reference", (manifest) => { manifest.methodRefs.pop(); }),
  mutate("extra method reference", (manifest) => { manifest.methodRefs.push(clone(manifest.methodRefs[0])); }),
  mutate("method ID drift", (manifest) => { manifest.methodRefs[0].methodId = "PROPOSED-STORAGE-POWER-LOSS-DURABILITY-001"; }),
  mutate("gap ID drift", (manifest) => { manifest.methodRefs[0].gapId = "GAP-CONTROL-STATUS-METHOD"; }),
  mutate("source ID drift", (manifest) => { manifest.methodRefs[0].sourceIds[0] = "SRC-METHOD-GAP-HIL-OPENHTF"; }),
  mutate("raw artifact output missing", (manifest) => { manifest.methodRefs[0].rawArtifactKinds.pop(); }),
  mutate("accepted method promotion", (manifest) => { manifest.methodRefs[0].acceptedInMethodCatalog = true; }),
  mutate("contract owner path drift", (manifest) => { manifest.ownerRefs.testResultSchemaPath = "hardware/evt0/lab-v1/method-catalog.json"; }),
  mutate("target tuple value injection", (manifest) => { manifest.targetTuple = { boardMpn: "TARGET" }; }),
  mutate("template capture index populated", (_manifest, template) => { template.captureIndexId = "HIL-INDEX-REAL"; }),
  mutate("template method binding populated", (_manifest, template) => { template.methodId = "PROPOSED-USB-DATA-OBSERVATION-001"; }),
  mutate("fake raw artifact", (_manifest, template) => { template.artifacts.push({ artifactId: "HIL-ART-FAKE-001" }); }),
  mutate("duplicate artifact IDs", (_manifest, template) => { template.artifacts.push({ artifactId: "HIL-ART-FAKE-001" }, { artifactId: "HIL-ART-FAKE-001" }); }),
  mutate("missing provenance field", () => {}, (context) => withFile(context, "captureSchemaFile", (schema) => { schema.$defs.artifact.required.pop(); return schema; })),
  mutate("bad artifact path pattern", () => {}, (context) => withFile(context, "captureSchemaFile", (schema) => { schema.$defs.artifact.properties.relativePath.pattern = ".*"; return schema; })),
  mutate("capture tool identity fabricated", (_manifest, template) => { template.captureTool.identity = "TOOL-REAL"; }),
  mutate("clock metadata fabricated", (_manifest, template) => { template.artifacts.push({ artifactId: "HIL-ART-USB-001", role: "USB_TRANSFER_TRACE", relativePath: "build/hil/raw.bin", byteLength: 1, sha256: "a".repeat(64), mediaType: "application/octet-stream", format: "bin", capturedAt: "2026-08-05T00:00:00Z", source: { kind: "DEVICE_CAPTURE", sourceId: "SRC", sourcePath: "TARGET" }, captureTool: { identity: "TOOL", version: "1", configSha256: "b".repeat(64) }, references: { sessionId: "SESSION", runId: "RUN", testResultId: "RESULT" }, clockMetadata: { timebaseId: "CLOCK", kind: "HOST_MONOTONIC", units: "ticks", sampleRate: 1, channelCount: 1, channelLabels: ["ch1"] }, custody: { operatorId: "OP", custodyState: "SEALED", readbackState: "VERIFIED" }, originalDerived: { relation: "ORIGINAL", sourceArtifactId: null, derivationTool: null, derivationConfigSha256: null } }); }),
  mutate("fixture adapter binding fabricated", (_manifest, template) => { template.fixtureAdapterRef.bindingId = "REAL-BINDING"; }),
  mutate("session owner reassigned", (_manifest, template) => { template.labSessionRef.ownerPath = "hardware/evt0/test-result-v1/schema.json"; }),
  mutate("TestResult owner reassigned", (_manifest, template) => { template.testResultRef.ownerPath = "hardware/evt0/lab-v1"; }),
  mutate("rawArtifacts duplicated", (_manifest, template) => { template.rawArtifacts = []; }),
  mutate("ReleaseGate receipt fabricated", (_manifest, template) => { template.releaseGateRef.receiptId = "RG-REAL"; }),
  mutate("verdict fabricated", (_manifest, template) => { template.resultProjection.verdict = "PASS"; }),
  mutate("physical evidence promoted", (_manifest, template) => { template.resultProjection.physicalEvidenceState = "MEASURED"; }),
  mutate("software impact promoted", (_manifest, template) => { template.softwareRef.hardwareImpact = "TARGET_REQUIRED"; }),
  mutate("live target binding promotion", () => {}, (context) => withFile(context, "targetBindingFile", (document) => { document.targetIdentity.state = "RESOLVED"; return document; })),
  mutate("existing evidence profile HIL adoption", () => {}, (context) => withFile(context, "evidenceProfileFile", (document) => { document.lanes.push({ id: "HIL_RAW_TEST" }); return document; })),
  mutate("fixture semantic drift", () => {}, (context) => ({ ...context, fixtureMethodContractContext: withFile(context.fixtureMethodContractContext, "manifestFile", (document) => { document.contracts[0].status = "ACCEPTED"; return document; }) })),
  mutate("method-gap raw source drift", () => {}, (context) => withFile(context, "methodGapManifestFile", (document) => { document.officialSources[0].sha256 = "f".repeat(64); return document; })),
  mutate("implementation identity drift", (manifest) => { manifest.implementation[0].sha256 = "f".repeat(64); }),
  mutate("non-canonical manifest formatting", () => {}, (context) => ({ ...context, manifestFile: { ...context.manifestFile, text: `${context.manifestFile.text.trim()} ` } })),
  mutate("storage method inclusion", (manifest) => { manifest.methodRefs[0].methodId = "PROPOSED-STORAGE-POWER-LOSS-DURABILITY-001"; }),
  mutate("software boundary report promotion", () => {}, (context) => withFile(context, "explicitHardwareImpactReportFile", (document) => { document.boundaries.hardwareImpact = "TARGET_REQUIRED"; return document; })),
  mutate("npm wiring validator removal", () => {}, (context) => withFile(context, "packageFile", (document) => { delete document.scripts["validate:hardware-hil-raw-evidence-capture"]; return document; })),
  mutate("npm wiring selftest removal", () => {}, (context) => withFile(context, "packageFile", (document) => { delete document.scripts["test:hardware-hil-raw-evidence-capture"]; return document; })),
  mutate("npm validate:hardware-rd order drift", () => {}, (context) => withFile(context, "packageFile", (document) => { document.scripts["validate:hardware-rd"] = document.scripts["validate:hardware-rd"].replace("npm run validate:hardware-hil-raw-evidence-capture && npm run test:hardware-hil-raw-evidence-capture &&", "npm run test:hardware-hil-raw-evidence-capture && npm run validate:hardware-hil-raw-evidence-capture &&"); return document; })),
  mutate("npm validate:hardware-rd duplicate", () => {}, (context) => withFile(context, "packageFile", (document) => { document.scripts["validate:hardware-rd"] += " npm run validate:hardware-hil-raw-evidence-capture"; return document; })),
  mutate("npm validator command drift", () => {}, (context) => withFile(context, "packageFile", (document) => { document.scripts["validate:hardware-hil-raw-evidence-capture"] = "node scripts/other-validator.mjs"; return document; })),
  mutate("unrelated npm script addition benign maintenance", () => {}, (context) => withFile(context, "packageFile", (document) => { document.scripts["unrelated-maintenance-script"] = "node scripts/unrelated-maintenance.mjs"; return document; }), false),
  mutate("benign software progression", () => {}, (context) => withText(withText(context, "softwareParentFile", (text) => text.replaceAll("SW-FAMILY-WORKSPACE-LIFECYCLE-01", "SW-FUTURE-ROUTE-99")), "softwareChildFile", (text) => text.replaceAll("SW-DESKTOP-AUTHORING-UI-ADAPTER-01", "SW-FUTURE-ROUTE-99")), false),
];

const context = await loadHilRawEvidenceCaptureContext();
const baselineChecks = await evaluateHilRawEvidenceCapture(context);
const cases = [];
for (const mutation of MUTATIONS) {
  const manifest = clone(context.manifestFile.document);
  const template = clone(context.templateFile.document);
  mutation.mutateDocument(manifest, template);
  const mutationContext = mutation.mutateContext ? mutation.mutateContext(context) : context;
  const checks = await evaluateHilRawEvidenceCapture(mutationContext, manifest, template);
  const failedChecks = checks.filter((item) => !item.passed).map((item) => item.name);
  const rejected = failedChecks.length > 0;
  cases.push({ name: mutation.name, expectRejected: mutation.expectRejected, rejected, failedChecks });
}

const rejected = cases.filter((item) => item.rejected).length;
const benignAccepted = cases.filter((item) => !item.rejected && !item.expectRejected).length;
const unexpected = cases.filter((item) => item.rejected !== item.expectRejected).length;
const report = {
  schemaVersion: 1,
  reportKind: "hardware-hil-raw-evidence-capture-selftest-v1",
  baseline: { total: baselineChecks.length, passed: baselineChecks.filter((item) => item.passed).length, failed: baselineChecks.filter((item) => !item.passed).length },
  mutationCount: cases.length,
  rejectedMutationCount: rejected,
  acceptedMutationCount: cases.length - rejected,
  intentionalBenignAcceptedCount: benignAccepted,
  unexpectedMutationCount: unexpected,
  cases,
  passed: baselineChecks.every((item) => item.passed) && unexpected === 0,
};
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Hardware HIL raw-evidence capture self-test: ${report.passed ? "PASS" : "FAIL"} (${rejected}/${cases.length} mutations rejected; ${benignAccepted} benign accepted)`);
console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
if (!report.passed) process.exitCode = 1;
