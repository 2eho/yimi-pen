import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { checkCapture, preflightWorkspace } from "./capture-hardware-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(ROOT, "build", "hardware-evidence-capture-validation.json");
const checks = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function check(name, passed, detail = null) {
  checks.push({ name, passed: Boolean(passed), detail });
}

function exactSet(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length && expected.every((value) => actual.includes(value));
}

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort();
}

function validDateTime(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function makeAjv() {
  return new Ajv2020({
    allErrors: true,
    strict: true,
    formats: {
      "date-time": { type: "string", validate: validDateTime },
    },
  });
}

async function readJson(relative) {
  const absolute = path.join(ROOT, ...relative.split("/"));
  const bytes = await readFile(absolute);
  return { relative, absolute, bytes, document: JSON.parse(bytes.toString("utf8")) };
}

async function identity(relative) {
  const absolute = path.join(ROOT, ...relative.split("/"));
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`implementation identity is not a plain file: ${relative}`);
  const bytes = await readFile(absolute);
  return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
}

async function directoriesWithFile(rootRelative, ownerFile) {
  const absolute = path.join(ROOT, ...rootRelative.split("/"));
  const entries = await readdir(absolute, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const owner = path.join(absolute, entry.name, ownerFile);
    try {
      const info = await lstat(owner);
      if (info.isFile() && !info.isSymbolicLink()) result.push(`${rootRelative}/${entry.name}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return result.sort();
}

async function captureIndexesUnder(workspaceRoot) {
  const absolute = path.join(ROOT, ...workspaceRoot.split("/"));
  const entries = await readdir(absolute, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^capture-index\.[A-Z0-9][A-Z0-9._-]{2,95}\.json$/.test(entry.name))
    .map((entry) => `${workspaceRoot}/${entry.name}`)
    .sort();
}

function ownerArtifactSchema(ownerSchema, lane) {
  if (lane === "VENDOR_CONTACT") return ownerSchema.document.properties.rawArtifacts.items;
  if (lane === "BENCHMARK_SELLER") return ownerSchema.document.$defs.artifact;
  if (lane === "LAB_REGISTRY") return ownerSchema.document.$defs.artifact;
  return ownerSchema.document.$defs.rawArtifact;
}

function safeError(error) {
  return error?.stack ?? error?.message ?? String(error);
}

async function run() {
  const files = await Promise.all([
    readJson("hardware/evt0/evidence-capture-v1/profile.schema.json"),
    readJson("hardware/evt0/evidence-capture-v1/capture-request.schema.json"),
    readJson("hardware/evt0/evidence-capture-v1/capture-index.schema.json"),
    readJson("hardware/evt0/evidence-capture-v1/profile.json"),
    readJson("hardware/evt0/vendor-contact-receipts-v1/schema.json"),
    readJson("hardware/evt0/benchmark-seller-evidence-v1/schema.json"),
    readJson("hardware/evt0/lab-v1/instrument-registry.schema.json"),
    readJson("hardware/evt0/vendor-evidence-v1/schema.json"),
    readJson("hardware/evt0/vendor-evidence-v1/candidate.template.json"),
    readJson("hardware/evt0/benchmark-seller-evidence-v1/record.template.json"),
    readJson("hardware/evt0/lab-v1/instrument-registry.template.json"),
    readJson("hardware/evt0/hardware-system-v1/target-binding.json"),
    readJson("build/companion-tts-source-adapter-validation/report.json"),
  ]);
  const [profileSchema, requestSchema, indexSchema, profile, contactSchema, benchmarkSchema, labSchema, vendorSchema,
    vendorTemplate, benchmarkTemplate, labTemplate, targetBinding, ttsReport] = files;

  const ajv = makeAjv();
  const validators = {};
  for (const [name, schema] of [
    ["profile", profileSchema],
    ["request", requestSchema],
    ["index", indexSchema],
    ["vendor contact owner", contactSchema],
    ["benchmark seller owner", benchmarkSchema],
    ["lab registry owner", labSchema],
    ["vendor response owner", vendorSchema],
  ]) {
    try {
      validators[name] = ajv.compile(schema.document);
      check(`${name} schema compiles`, true);
    } catch (error) {
      check(`${name} schema compiles`, false, safeError(error));
    }
  }

  check("profile schema", validators.profile?.(profile.document) ?? false, ajv.errorsText(validators.profile?.errors));
  check("request schema compiles", typeof validators.request === "function");
  check("index schema compiles", typeof validators.index === "function");
  check("profile identity", profile.document.profileId === "HW-EVIDENCE-CAPTURE-ADAPTER-V1");

  const expectedLaneIds = ["VENDOR_CONTACT", "BENCHMARK_SELLER", "LAB_REGISTRY", "VENDOR_RESPONSE"];
  check("exact four lane set", exactSet(profile.document.lanes.map((lane) => lane.id), expectedLaneIds), profile.document.lanes.map((lane) => lane.id));
  check("lane IDs and route kinds unique", new Set(profile.document.lanes.map((lane) => lane.id)).size === 4 &&
    new Set(profile.document.lanes.map((lane) => lane.routeKind)).size === 4);
  check("effects remain non-promoting", sameValue(profile.document.effects, {
    targetBindingEffect: "NONE",
    adapterEffect: "EVIDENCE_CAPTURE_ONLY",
    bomRevisionEffect: "NONE",
    releaseGateEffect: "NONE",
    purchaseAuthorizationEffect: "NONE",
    recordStateEffect: "NONE_OWNER_RECORD_UNCHANGED",
    sourceArtifactEffect: "NONE_READ_ONLY",
  }), profile.document.effects);
  check("explicit metadata policy", profile.document.policies.metadataPolicy === "EXPLICIT_ONLY_NO_MIME_OR_FACT_INFERENCE");
  check("exclusive copy policy", profile.document.policies.copyPolicy === "EXCLUSIVE_COPY_AND_DESTINATION_HASH_READBACK");
  check("owner byte identity policy", profile.document.policies.ownerPolicy === "HASH_BEFORE_AND_AFTER_OWNER_RECORD_BYTE_IDENTICAL");
  check("rollback ownership policy", profile.document.policies.rollbackPolicy === "REMOVE_ONLY_NEW_FILES_WITH_MATCHING_CAPTURE_HASH");

  const requestDefs = requestSchema.document.$defs;
  const indexDefs = indexSchema.document.$defs;
  const closedRouteDefs = [
    requestDefs.vendorContactRoute,
    requestDefs.benchmarkSellerRoute,
    requestDefs.labRegistryRoute,
    requestDefs.vendorResponseRoute,
    indexDefs.contactRoute,
    indexDefs.benchmarkRoute,
    indexDefs.labRoute,
    indexDefs.vendorResponseRoute,
  ];
  check("all four request/index route definitions are closed", closedRouteDefs.every((schema) => schema?.additionalProperties === false), closedRouteDefs.map((schema) => schema?.additionalProperties));
  check("all four index artifact branches close owner fragments", [
    indexDefs.baseOwnerFragment,
    indexDefs.benchmarkOwnerFragment,
  ].every((schema) => schema?.additionalProperties === false));
  check("index lane branches bind lane-specific artifact schemas", indexSchema.document.allOf?.length === 4);

  const baseFields = ["id", "path", "bytes", "sha256", "mediaType"];
  const contactArtifact = ownerArtifactSchema(contactSchema, "VENDOR_CONTACT");
  const benchmarkArtifact = ownerArtifactSchema(benchmarkSchema, "BENCHMARK_SELLER");
  const labArtifact = ownerArtifactSchema(labSchema, "LAB_REGISTRY");
  const vendorArtifact = ownerArtifactSchema(vendorSchema, "VENDOR_RESPONSE");
  check("contact owner base artifact fields", exactSet(contactArtifact.required, baseFields) && exactSet(sortedKeys(contactArtifact.properties), baseFields), contactArtifact.required);
  check("lab owner base artifact fields", exactSet(labArtifact.required, baseFields) && exactSet(sortedKeys(labArtifact.properties), baseFields), labArtifact.required);
  check("vendor response owner base artifact fields", exactSet(vendorArtifact.required, baseFields) && exactSet(sortedKeys(vendorArtifact.properties), baseFields), vendorArtifact.required);
  const benchmarkFields = ["id", "kind", "provenance", "path", "bytes", "sha256", "mediaType", "capturedAt", "sourceUrl"];
  check("benchmark owner artifact fields are exact", exactSet(benchmarkArtifact.required, benchmarkFields) && exactSet(sortedKeys(benchmarkArtifact.properties), benchmarkFields), benchmarkArtifact.required);

  for (const [name, schema, ownerSchema] of [["contact", contactArtifact, contactSchema], ["benchmark", benchmarkArtifact, benchmarkSchema], ["lab", labArtifact, labSchema], ["vendor", vendorArtifact, vendorSchema]]) {
    try {
      const fragmentSchema = name === "benchmark"
        ? { "$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": ownerSchema.document.$defs, ...schema }
        : schema;
      const validate = ajv.compile(fragmentSchema);
      const samplePath = name === "contact"
        ? "build/vendor-contact-receipts/RECEIPT-01/raw/artifact.bin"
        : name === "benchmark"
          ? "build/benchmark-seller-evidence/REF2-01/raw/artifact.bin"
          : name === "lab"
            ? "build/hardware-lab/instruments/EVT0-LAB-REGISTRY-01/raw/artifact.bin"
            : "build/vendor-evidence/CANDIDATE-01/RESPONSE-01/raw/artifact.bin";
      const sample = {
        id: "ARTIFACT-01",
        path: samplePath,
        bytes: 1,
        sha256: "a".repeat(64),
        mediaType: "application/octet-stream",
        ...(name === "benchmark" ? {
          kind: "OTHER_SUPPORTING",
          provenance: "OPERATOR_CAPTURE",
          capturedAt: "2026-08-04T12:30:00+08:00",
          sourceUrl: null,
        } : {}),
      };
      check(`${name} owner artifact schema accepts adapter fragment shape`, validate(sample), ajv.errorsText(validate.errors));
    } catch (error) {
      check(`${name} owner artifact schema compiles`, false, safeError(error));
    }
  }

  check("benchmark kind catalog synchronized", exactSet(
    requestDefs.benchmarkSellerRoute.properties.artifactKind.enum,
    benchmarkArtifact.properties.kind.enum,
  ));
  check("benchmark provenance catalog synchronized", exactSet(
    requestDefs.benchmarkSellerRoute.properties.provenance.enum,
    benchmarkArtifact.properties.provenance.enum,
  ));
  check("lab instrument catalog synchronized", exactSet(
    requestDefs.labRegistryRoute.properties.instrumentId.enum,
    labSchema.document.$defs.instrument.properties.id.enum,
  ));
  check("vendor tuple catalog remains closed five fields", exactSet(Object.keys(vendorTemplate.document.identityTuple), ["BOARD_MPN", "PCB_REV", "HEAD_MPN", "HEAD_REV", "FW_VERSION"]));
  check("vendor answer catalog remains M01-M08", exactSet(vendorSchema.document.$defs.answer.properties.id.enum,
    ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08"]));
  check("vendor attachment catalog remains A01-A10", exactSet(vendorSchema.document.$defs.attachment.properties.id.enum,
    Array.from({ length: 10 }, (_, index) => `A${String(index + 1).padStart(2, "0")}`)));
  check("vendor sample collection is the two-template sample set", exactSet(vendorTemplate.document.sampleOffers.map((item) => item.sampleId), ["SAMPLE-A", "SAMPLE-B"]));

  check("vendor response template is owner-schema compatible", validators["vendor response owner"]?.(vendorTemplate.document) ?? false, ajv.errorsText(validators["vendor response owner"]?.errors));
  check("benchmark template is owner-schema compatible", validators["benchmark seller owner"]?.(benchmarkTemplate.document) ?? false, ajv.errorsText(validators["benchmark seller owner"]?.errors));
  check("lab template is owner-schema compatible", validators["lab registry owner"]?.(labTemplate.document) ?? false, ajv.errorsText(validators["lab registry owner"]?.errors));

  const laneSamples = {
    VENDOR_CONTACT: "build/vendor-contact-receipts/RECEIPT-01/raw/evidence.eml",
    BENCHMARK_SELLER: "build/benchmark-seller-evidence/REF2-EVIDENCE-01/raw/photo.jpg",
    LAB_REGISTRY: "build/hardware-lab/instruments/EVT0-LAB-REGISTRY-01/raw/nameplate.png",
    VENDOR_RESPONSE: "build/vendor-evidence/CANDIDATE-01/RESPONSE-01/raw/reply.pdf",
  };
  for (const lane of profile.document.lanes) {
    check(`${lane.id} sample raw path`, new RegExp(lane.rawPathPattern).test(laneSamples[lane.id]), laneSamples[lane.id]);
  }
  check("contact lane is at least as strict as owner path prefix", new RegExp(contactArtifact.properties.path.pattern).test(laneSamples.VENDOR_CONTACT));
  check("benchmark lane matches owner raw path", new RegExp(benchmarkArtifact.properties.path.pattern).test(laneSamples.BENCHMARK_SELLER));
  check("lab lane matches owner raw path", new RegExp(labArtifact.properties.path.pattern).test(laneSamples.LAB_REGISTRY));

  const workspaces = [
    ...(await directoriesWithFile("build/vendor-contact-receipts", "receipt.draft.json")).map((workspaceRoot) => ({ laneId: "VENDOR_CONTACT", workspaceRoot })),
    ...(await directoriesWithFile("build/benchmark-seller-evidence", "record.draft.json")).map((workspaceRoot) => ({ laneId: "BENCHMARK_SELLER", workspaceRoot })),
    ...(await directoriesWithFile("build/hardware-lab/instruments", "registry.draft.json"))
      .filter((workspaceRoot) => /EVT0-LAB-REGISTRY-\d{8}-\d+$/.test(workspaceRoot))
      .map((workspaceRoot) => ({ laneId: "LAB_REGISTRY", workspaceRoot })),
  ];
  const expectedWorkspaceSet = [
    "build/benchmark-seller-evidence/REF2-SELLER-EVIDENCE-20260804-01",
    "build/hardware-lab/instruments/EVT0-LAB-REGISTRY-20260804-01",
    "build/vendor-contact-receipts/20260804-CHUNMIAO-01",
    "build/vendor-contact-receipts/20260804-SONIX-01",
    "build/vendor-contact-receipts/20260804-ZTRON-01",
  ];
  check("current prepared workspace set is exactly five", exactSet(workspaces.map((item) => item.workspaceRoot).sort(), expectedWorkspaceSet), workspaces);

  const workspaceOwnerBefore = {};
  for (const item of workspaces) {
    const lane = profile.document.lanes.find((candidate) => candidate.id === item.laneId);
    workspaceOwnerBefore[item.workspaceRoot] = await identity(`${item.workspaceRoot}/${lane.ownerFile}`);
  }
  const ownerValidators = {
    VENDOR_CONTACT: validators["vendor contact owner"],
    BENCHMARK_SELLER: validators["benchmark seller owner"],
    LAB_REGISTRY: validators["lab registry owner"],
  };
  const preflightResults = [];
  for (const item of workspaces) {
    const lane = profile.document.lanes.find((candidate) => candidate.id === item.laneId);
    const owner = (await readJson(`${item.workspaceRoot}/${lane.ownerFile}`)).document;
    const ownerValidate = ownerValidators[item.laneId];
    check(`${item.workspaceRoot} owner schema compatible`, ownerValidate?.(owner) ?? false, ajv.errorsText(ownerValidate?.errors));
    try {
      const result = await preflightWorkspace({ root: ROOT, laneId: item.laneId, workspaceRoot: item.workspaceRoot });
      preflightResults.push({ lane: item.laneId, workspaceRoot: item.workspaceRoot, ownerRecord: result.ownerIdentity });
      check(`${item.workspaceRoot} preflight`, result.ownerIdentity.identityValue === path.basename(item.workspaceRoot), result.ownerIdentity);
    } catch (error) {
      check(`${item.workspaceRoot} preflight`, false, safeError(error));
    }
  }
  for (const item of workspaces) {
    const lane = profile.document.lanes.find((candidate) => candidate.id === item.laneId);
    const after = await identity(`${item.workspaceRoot}/${lane.ownerFile}`);
    check(`${item.workspaceRoot} preflight is read only`, sameValue(after, workspaceOwnerBefore[item.workspaceRoot]), after);
  }

  const existingIndexes = [];
  for (const item of workspaces) existingIndexes.push(...await captureIndexesUnder(item.workspaceRoot));
  const checkedIndexes = [];
  for (const indexRelative of existingIndexes) {
    const fileName = path.basename(indexRelative);
    const captureId = fileName.slice("capture-index.".length, -".json".length);
    const requestRelative = `${path.posix.dirname(indexRelative)}/capture-request.${captureId}.json`;
    try {
      checkedIndexes.push(await checkCapture({ root: ROOT, requestPath: requestRelative }));
    } catch (error) {
      check(`existing capture index ${indexRelative} validates`, false, safeError(error));
    }
  }
  check("existing capture indexes validate", checkedIndexes.length === existingIndexes.length, { existingIndexes, checkedIndexes });

  check("BOARD_TARGET remains UNRESOLVED", targetBinding.document.targetIdentity?.state === "UNRESOLVED", targetBinding.document.targetIdentity?.state);
  check("TTS 41/41 is read-only software input", ttsReport.document.boundaries?.hardwareImpact === "NONE" &&
    ttsReport.document.boundaries?.boardTarget === "UNRESOLVED" &&
    ttsReport.document.checks?.length === 41 && ttsReport.document.checks.every((item) => item.passed === true), ttsReport.document.boundaries);

  const implementation = await Promise.all([
    identity("hardware/evt0/evidence-capture-v1/profile.schema.json"),
    identity("hardware/evt0/evidence-capture-v1/capture-request.schema.json"),
    identity("hardware/evt0/evidence-capture-v1/capture-index.schema.json"),
    identity("hardware/evt0/evidence-capture-v1/profile.json"),
    identity("scripts/capture-hardware-evidence.mjs"),
    identity("scripts/validate-hardware-evidence-capture.mjs"),
    identity("scripts/test-hardware-evidence-capture.mjs"),
  ]);
  check("capture contracts and implementation files have identities", implementation.every((file) => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)), implementation);

  const report = {
    schemaVersion: 1,
    reportKind: "hardware-evidence-capture-validation-v1",
    profileId: profile.document.profileId,
    contracts: [profileSchema, requestSchema, indexSchema, profile].map((item) => ({
      path: item.relative,
      bytes: item.bytes.length,
      sha256: sha256(item.bytes),
    })),
    ownerSchemas: [contactSchema, benchmarkSchema, labSchema, vendorSchema].map((item) => ({
      path: item.relative,
      bytes: item.bytes.length,
      sha256: sha256(item.bytes),
    })),
    implementation,
    preflightResults,
    checkedIndexes,
    effects: profile.document.effects,
    targetBinding: {
      state: targetBinding.document.targetIdentity?.state,
      path: targetBinding.relative,
      sha256: sha256(targetBinding.bytes),
    },
    softwareInput: {
      path: ttsReport.relative,
      sha256: sha256(ttsReport.bytes),
      hardwareImpact: ttsReport.document.boundaries?.hardwareImpact,
      boardTarget: ttsReport.document.boundaries?.boardTarget,
      checks: ttsReport.document.checks?.length ?? 0,
    },
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length,
    },
    passed: checks.every((item) => item.passed),
  };
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Hardware evidence capture validation: ${report.passed ? "PASS" : "FAIL"} (${report.summary.passed}/${report.summary.total})\n`);
  process.stdout.write(`Prepared workspaces: ${preflightResults.length}; existing capture indexes: ${checkedIndexes.length}\n`);
  process.stdout.write(`Report: ${path.relative(ROOT, REPORT_PATH)}\n`);
  if (!report.passed) process.exitCode = 1;
}

function sameValue(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  if (left && typeof left === "object" && right && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return exactSet(leftKeys, rightKeys) && leftKeys.every((key) => sameValue(left[key], right[key]));
  }
  return left === right;
}

try {
  await run();
} catch (error) {
  const report = {
    schemaVersion: 1,
    reportKind: "hardware-evidence-capture-validation-v1",
    checks: [...checks, { name: "validator execution", passed: false, detail: safeError(error) }],
    summary: {
      total: checks.length + 1,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length + 1,
    },
    passed: false,
  };
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stderr.write(`${safeError(error)}\n`);
  process.exitCode = 1;
}
