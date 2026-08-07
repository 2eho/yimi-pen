import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateFixtureMethodContract, loadFixtureMethodContractContext } from "./validate-hardware-fixture-method-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(ROOT, "build", "hardware-fixture-method-contract-selftest.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutate(name, mutateDocument = () => {}, mutateContext = null, expectRejected = true) {
  return { name, mutateDocument, mutateContext, expectRejected };
}

function withMethodGapOwner(context, key, mutateDocument) {
  return {
    ...context,
    methodGapContext: {
      ...context.methodGapContext,
      [key]: {
        ...context.methodGapContext[key],
        document: mutateDocument(clone(context.methodGapContext[key].document)),
      },
    },
  };
}

function withFixtureProfile(context, mutateDocument) {
  return {
    ...context,
    fixtureContext: {
      ...context.fixtureContext,
      packageFiles: {
        ...context.fixtureContext.packageFiles,
        profile: {
          ...context.fixtureContext.packageFiles.profile,
          document: mutateDocument(clone(context.fixtureContext.packageFiles.profile.document)),
        },
      },
    },
  };
}

function withEvidenceProfile(context, mutateDocument) {
  return {
    ...context,
    evidenceCaptureProfileFile: {
      ...context.evidenceCaptureProfileFile,
      document: mutateDocument(clone(context.evidenceCaptureProfileFile.document)),
    },
  };
}

function withSoftware(context, parentMutator = (text) => text, childMutator = (text) => text, impactMutator = null, acceptedMutator = null) {
  const next = {
    ...context,
    softwareParentFile: { ...context.softwareParentFile, text: parentMutator(context.softwareParentFile.text) },
    softwareChildFile: { ...context.softwareChildFile, text: childMutator(context.softwareChildFile.text) },
  };
  if (impactMutator) next.explicitHardwareImpactReportFile = { ...context.explicitHardwareImpactReportFile, document: impactMutator(clone(context.explicitHardwareImpactReportFile.document)) };
  if (acceptedMutator) next.acceptedDesktopAuthoringReportFile = { ...context.acceptedDesktopAuthoringReportFile, document: acceptedMutator(clone(context.acceptedDesktopAuthoringReportFile.document)) };
  return next;
}

const MUTATIONS = [
  mutate("accepted-method promotion", (manifest) => { manifest.contracts[0].acceptedInMethodCatalog = true; }),
  mutate("fixture-owned generic field duplicated into method adapter", (_manifest, adapter) => { adapter.methods[0].fields.push({ id: "TARGET_CURRENT", state: "PENDING_EVIDENCE", value: null, evidenceRefs: [] }); }),
  mutate("run-owned field placed into method adapter", (_manifest, adapter) => { adapter.methods[0].fields.push({ id: "PAYLOAD_SET", state: "PENDING_EVIDENCE", value: null, evidenceRefs: [] }); }),
  mutate("missing run-input slot", (_manifest, _adapter, run) => { run.methodInputs[0].fields.pop(); }),
  mutate("extra run-input slot", (_manifest, _adapter, run) => { run.methodInputs[0].fields.push({ id: "EXTRA_RUN_FIELD", state: "PENDING_EVIDENCE", value: null, evidenceRefs: [] }); }),
  mutate("duplicate run-input slot", (_manifest, _adapter, run) => { run.methodInputs[0].fields.push(clone(run.methodInputs[0].fields[0])); }),
  mutate("populated run-input slot", (_manifest, _adapter, run) => { run.methodInputs[0].fields[0].value = "PAYLOAD"; }),
  mutate("physical PIN_MAPPING leaked into method adapter", (_manifest, adapter) => { adapter.methods[1].fields.push({ id: "PIN_MAPPING", state: "PENDING_EVIDENCE", value: null, evidenceRefs: [] }); }),
  mutate("target-stable HIL route moved into run input", (_manifest, _adapter, run) => { run.methodInputs[1].fields.push({ id: "STIMULUS_LEVELS", state: "PENDING_EVIDENCE", value: null, evidenceRefs: [] }); }),
  mutate("owner-reference misrouting", (manifest) => { manifest.contracts[0].ownerReferencePaths.SESSION_ID = "testResult.resultId"; }),
  mutate("fixture-owner path drift", (manifest) => { manifest.contracts[0].existingFixturePaths.CONNECTOR = "targetDependent.pinMappings"; }),
  mutate("target tuple insertion", (_manifest, adapter) => { adapter.targetTuple = { boardMpn: null, pcbRev: null, headMpn: null, headRev: null, fwVersion: null }; }),
  mutate("target value insertion", (_manifest, adapter) => { adapter.methods[0].fields[0].value = "USB"; }),
  mutate("missing field ownership category", (manifest) => { delete manifest.contracts[0].fieldOwnership.RUN_BINDING; }),
  mutate("duplicate field ownership mapping", (manifest) => { manifest.contracts[0].fieldOwnership.RUN_BINDING.push("PAYLOAD_SET"); }),
  mutate("orphan field ownership mapping", (manifest) => { manifest.contracts[0].fieldOwnership.RUN_BINDING.push("ORPHAN_FIELD"); }),
  mutate("missing phase", (manifest) => { manifest.contracts[0].phases.pop(); }),
  mutate("reordered phase", (manifest) => { [manifest.contracts[0].phases[0], manifest.contracts[0].phases[1]] = [manifest.contracts[0].phases[1], manifest.contracts[0].phases[0]]; }),
  mutate("unknown phase", (manifest) => { manifest.contracts[0].phases[0].skeletonStepId = "STEP-99"; }),
  mutate("interface drift", (manifest) => { manifest.contracts[0].interfaceRefs[0] = "IF-STORAGE"; }),
  mutate("gap drift", (manifest) => { manifest.contracts[0].gapId = "GAP-CONTROL-STATUS-METHOD"; }),
  mutate("source drift", (manifest) => { manifest.contracts[0].sourceIds[0] = "SRC-METHOD-GAP-HIL-OPENHTF"; }),
  mutate("raw output missing", (manifest) => { manifest.contracts[0].rawArtifactKinds.pop(); }),
  mutate("owner projection path drift", (manifest) => { manifest.contracts[0].ownerProjection.testResult.path = "hardware/evt0/lab-v1/method-catalog.json"; }),
  mutate("real run session binding", (_manifest, _adapter, run) => { run.labSession.sessionId = "SESSION-REAL"; }),
  mutate("missing fixtureAdapter reference", (_manifest, _adapter, run) => { delete run.fixtureAdapter; }),
  mutate("false fixture adapter binding", (_manifest, _adapter, run) => { run.fixtureAdapter.bindingId = "REAL-BINDING"; }),
  mutate("real TestResult binding", (_manifest, _adapter, run) => { run.testResult.resultId = "RESULT-REAL"; }),
  mutate("raw artifact owner drift", (_manifest, _adapter, run) => { run.rawArtifactOwner.field = "other"; }),
  mutate("false HIL capture lane readiness", (_manifest, _adapter, run) => { run.evidenceCapture.laneId = "HIL"; }),
  mutate("false HIL capture route readiness", () => {}, (context) => withEvidenceProfile(context, (document) => ({ ...document, lanes: [...document.lanes, { id: "HIL" }] }))),
  mutate("run verdict", (_manifest, _adapter, run) => { run.verdict = "PASS"; }),
  mutate("ReleaseGate promotion", (_manifest, _adapter, run) => { run.releaseGate.receiptId = "RG-REAL"; }),
  mutate("software impact claim", (_manifest, _adapter, run) => { run.software.hardwareImpact = "TARGET_REQUIRED"; }),
  mutate("storage method inclusion", (manifest) => { manifest.contracts.push(clone(manifest.contracts[0])); manifest.contracts[2].methodId = "PROPOSED-STORAGE-POWER-LOSS-DURABILITY-001"; }),
  mutate("implementation drift", (manifest) => { manifest.implementation[0].sha256 = "f".repeat(64); }),
  mutate("live method catalog semantic drift", () => {}, (context) => withMethodGapOwner(context, "methodCatalogFile", (document) => ({ ...document, methods: document.methods.slice(0, -1) }))),
  mutate("live fixture semantic drift", () => {}, (context) => withFixtureProfile(context, (document) => ({ ...document, capabilities: document.capabilities.slice(0, -1) }))),
  mutate("live target binding semantic drift", () => {}, (context) => withMethodGapOwner(context, "targetBindingFile", (document) => ({ ...document, targetIdentity: { ...document.targetIdentity, state: "RESOLVED" } }))),
  mutate("software boundary promotion", () => {}, (context) => withSoftware(context, (text) => text, (text) => text, (document) => ({ ...document, boundaries: { ...document.boundaries, hardwareImpact: "TARGET_REQUIRED" } }))),
  mutate("accepted desktop report boundary promotion", () => {}, (context) => withSoftware(context, (text) => text, (text) => text, null, (document) => ({ ...document, hardwareImpact: "TARGET_REQUIRED" }))),
  mutate("non-canonical manifest formatting", () => {}, (context) => ({ ...context, manifestFile: { ...context.manifestFile, text: `${context.manifestFile.text.trim()} ` } })),
  mutate("benign software task/hash progression", () => {}, (context) => withSoftware(
    context,
    (text) => text.replaceAll("SW-DESKTOP-AUTHORING-UI-ADAPTER-01", "SW-FUTURE-ROUTE-99").replaceAll("3161603ce8d7e59134b6b0ec7b7339a7e2d27573aa1c94508ada29d2fcc1198a", "f".repeat(64)),
    (text) => text.replaceAll("SW-DESKTOP-AUTHORING-UI-ADAPTER-01", "SW-FUTURE-ROUTE-99").replaceAll("2264078407a2afefe78b09ab4fadd04ac14f676383b5d39fd2990946d4a5e006", "e".repeat(64)),
  ), false),
];

const context = await loadFixtureMethodContractContext();
const baselineChecks = await evaluateFixtureMethodContract(context);
const cases = [];
for (const mutation of MUTATIONS) {
  const manifest = clone(context.manifestFile.document);
  const adapter = clone(context.adapterFile.document);
  const run = clone(context.runFile.document);
  mutation.mutateDocument(manifest, adapter, run);
  const mutationContext = mutation.mutateContext ? mutation.mutateContext(context) : context;
  const checks = await evaluateFixtureMethodContract(mutationContext, manifest, adapter, run);
  const failedChecks = checks.filter((item) => !item.passed).map((item) => item.name);
  cases.push({ name: mutation.name, expectRejected: mutation.expectRejected, rejected: failedChecks.length > 0, failedChecks });
}

const report = {
  schemaVersion: 1,
  reportKind: "hardware-fixture-method-contract-selftest-v1",
  baseline: { total: baselineChecks.length, passed: baselineChecks.filter((item) => item.passed).length, failed: baselineChecks.filter((item) => !item.passed).length },
  mutationCount: cases.length,
  rejectedMutationCount: cases.filter((item) => item.rejected).length,
  acceptedMutationCount: cases.filter((item) => !item.rejected).length,
  unexpectedMutationCount: cases.filter((item) => item.rejected !== item.expectRejected).length,
  failedMutationCount: cases.filter((item) => item.rejected !== item.expectRejected).length,
  cases,
  passed: baselineChecks.every((item) => item.passed) && cases.every((item) => item.rejected === item.expectRejected),
};
await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Hardware fixture method contract self-test: ${report.passed ? "PASS" : "FAIL"} (${report.rejectedMutationCount}/${report.mutationCount} mutations rejected)`);
console.log(`Report: ${path.relative(ROOT, REPORT_PATH)}`);
if (!report.passed) process.exitCode = 1;
