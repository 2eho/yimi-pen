import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { gateIdsForReportScope } from "../contracts/release-gates-v1.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deviceRoot = path.join(repoRoot, "hardware", "evt0", "device-link-v1");
const resultRoot = path.join(repoRoot, "hardware", "evt0", "test-result-v1");
const platformRoot = path.join(repoRoot, "hardware", "evt0", "platform-ffi-v1");
const checks = [];

function record(name, passed, detail = "") {
  checks.push({ name, passed: Boolean(passed), detail });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setPath(target, dottedPath, value) {
  const parts = dottedPath.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const key = /^\d+$/.test(part) ? Number(part) : part;
    cursor = cursor[key];
  }
  const last = parts.at(-1);
  cursor[/^\d+$/.test(last) ? Number(last) : last] = value;
}

function deviceSemanticErrors(message) {
  const errors = [];
  const u64Names = new Set([
    "manifestByteLength", "totalBytes", "offset", "expectedOffset", "receivedOffset",
    "requiredBytes", "availableBytes", "receivedBytes", "nextDurableOffset",
    "inactiveStorageBytes", "generation", "sequence", "nextAfterSequence", "afterSequence",
  ]);
  function inspectU64(value, location = "message") {
    if (!value || typeof value !== "object") return;
    for (const [name, child] of Object.entries(value)) {
      const childLocation = `${location}.${name}`;
      if (u64Names.has(name) && child !== null) {
        try {
          if (typeof child !== "string" || BigInt(child) > 18_446_744_073_709_551_615n) {
            errors.push(`${childLocation} is outside decimal u64`);
          }
        } catch {
          errors.push(`${childLocation} is not a decimal u64 string`);
        }
      }
      inspectU64(child, childLocation);
    }
  }
  inspectU64(message);
  if (message.kind === "request" && message.op === "snapshot.stage.write") {
    const payload = message.payload;
    const bytes = Buffer.from(payload.dataBase64, "base64");
    if (bytes.toString("base64") !== payload.dataBase64) {
      errors.push("dataBase64 is not canonical RFC 4648 base64");
    }
    if (bytes.length !== payload.byteLength) {
      errors.push(`byteLength=${payload.byteLength} actual=${bytes.length}`);
    }
    const actualHash = sha256(bytes);
    if (actualHash !== payload.chunkSha256) {
      errors.push(`chunkSha256=${payload.chunkSha256} actual=${actualHash}`);
    }
  }
  return errors;
}

function platformPathIsSafe(value) {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") !== value.length ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:/u.test(value) ||
    !/^[A-Za-z0-9._/-]+$/u.test(value)
  ) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function platformSemanticErrors(vectors) {
  const errors = [];
  const ids = new Set();
  const groups = [
    vectors.oidVectors,
    vectors.audioVectors,
    vectors.storageVectors,
    vectors.transportVectors,
  ];
  for (const vector of groups.flat()) {
    if (ids.has(vector.id)) errors.push(`duplicate vector id ${vector.id}`);
    ids.add(vector.id);
  }

  const oidStatuses = ["valid", "low-quality", "no-code", "sensor-fault"];
  for (const vector of vectors.oidVectors) {
    const { raw, expected } = vector;
    const providerErrors = [];
    const unavailable = "18446744073709551615";
    const hasCode = (raw.flags & 1) !== 0;
    if ((raw.flags & ~15) !== 0) providerErrors.push("unknown flags");
    if (raw.reserved0 !== 0) providerErrors.push("reserved0 is non-zero");
    if (raw.eventAtUs === unavailable) providerErrors.push("eventAtUs is unavailable");
    if (!hasCode && raw.physicalCode !== "0") providerErrors.push("hidden physicalCode is non-zero");
    if ((raw.flags & 8) === 0 && raw.quality !== 0) providerErrors.push("hidden quality is non-zero");
    if (raw.status === 0 && !hasCode) providerErrors.push("valid status has no code");
    if ((raw.status === 2 || raw.status === 3) && hasCode) {
      providerErrors.push("no-code/fault status carries code");
    }
    for (const [flag, field] of [
      [2, "sensorAtUs"],
      [4, "readyAtUs"],
    ]) {
      const present = (raw.flags & flag) !== 0;
      if (present === (raw[field] === unavailable)) {
        providerErrors.push(`${field} flag/sentinel mismatch`);
      }
      if (present && BigInt(raw[field]) > BigInt(raw.eventAtUs)) {
        providerErrors.push(`${field} follows eventAtUs`);
      }
    }
    if (
      (raw.flags & 2) !== 0 &&
      (raw.flags & 4) !== 0 &&
      BigInt(raw.sensorAtUs) > BigInt(raw.readyAtUs)
    ) {
      providerErrors.push("sensorAtUs follows readyAtUs");
    }
    const calculatedError = providerErrors.length > 0 ? "provider-violation" : null;
    if (vector.expectedError !== calculatedError) {
      errors.push(
        `${vector.id} expectedError=${vector.expectedError} calculated=${calculatedError}: ${providerErrors.join(",")}`,
      );
    }
    if (calculatedError !== null) {
      if (expected !== null) errors.push(`${vector.id} invalid event must not have normalized output`);
      continue;
    }
    if (expected === null) {
      errors.push(`${vector.id} valid event is missing normalized output`);
      continue;
    }
    const fields = [
      [1, "physicalCode"],
      [2, "sensorAtUs"],
      [4, "readyAtUs"],
      [8, "quality"],
    ];
    if (expected.eventAtUs !== raw.eventAtUs) {
      errors.push(`${vector.id} changes eventAtUs`);
    }
    if (expected.status !== oidStatuses[raw.status]) {
      errors.push(`${vector.id} status does not match raw discriminant`);
    }
    if (expected.sequence !== raw.sequence || expected.droppedEvents !== raw.droppedEvents) {
      errors.push(`${vector.id} sequence/drop evidence changed during normalization`);
    }
    for (const [flag, field] of fields) {
      const present = (raw.flags & flag) !== 0;
      if (present && String(expected[field]) !== String(raw[field])) {
        errors.push(`${vector.id} ${field} differs while flag is set`);
      }
      if (!present && expected[field] !== null) {
        errors.push(`${vector.id} ${field} must be null while flag is clear`);
      }
    }
  }

  for (const vector of vectors.audioVectors) {
    const expectedStatus = platformPathIsSafe(vector.path) ? "ok" : "invalid-argument";
    if (vector.expectedStatus !== expectedStatus) {
      errors.push(`${vector.id} path status=${vector.expectedStatus} calculated=${expectedStatus}`);
    }
  }

  for (const vector of vectors.storageVectors) {
    const offset = BigInt(vector.offset);
    const length = BigInt(vector.hex.length / 2);
    const valid = offset <= 4096n && length <= 4096n - offset;
    const expectedStatus = valid ? "ok" : "invalid-argument";
    if (vector.expectedStatus !== expectedStatus) {
      errors.push(`${vector.id} range status=${vector.expectedStatus} calculated=${expectedStatus}`);
    }
  }

  for (const vector of vectors.transportVectors) {
    if (vector.hex.length / 2 > vectors.expectedInfo.transportMtu) {
      errors.push(`${vector.id} exceeds transportMtu`);
    }
  }
  return errors;
}

function nearestRank(sorted, percentile) {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

function countOutcomes(samples) {
  const result = { correct: 0, wrong: 0, noRead: 0, timeout: 0, readError: 0 };
  const mapping = {
    correct: "correct",
    wrong: "wrong",
    "no-read": "noRead",
    timeout: "timeout",
    "read-error": "readError",
  };
  for (const sample of samples) result[mapping[sample.outcome]] += 1;
  return result;
}

function synchronizedLatencyUs(start, end, synchronizations) {
  const startUs = BigInt(start.tUs);
  const endUs = BigInt(end.tUs);
  if (start.clockId === end.clockId) {
    return endUs >= startUs ? Number(endUs - startUs) : null;
  }
  const forward = synchronizations.find(
    (entry) => entry.fromClockId === start.clockId && entry.toClockId === end.clockId,
  );
  if (forward) {
    const startInEnd = startUs + BigInt(forward.offsetUs);
    return endUs >= startInEnd ? Number(endUs - startInEnd) : null;
  }
  const reverse = synchronizations.find(
    (entry) => entry.fromClockId === end.clockId && entry.toClockId === start.clockId,
  );
  if (reverse) {
    const endInStart = endUs + BigInt(reverse.offsetUs);
    return endInStart >= startUs ? Number(endInStart - startUs) : null;
  }
  return undefined;
}

function measuredIdentityErrors(recordValue) {
  if (recordValue.evidenceState !== "MEASURED") return [];
  const errors = [];
  const required = [
    "candidateId",
    "boardMpn",
    "pcbRevision",
    "boardSerial",
    "headMpn",
    "headRevision",
    "headSerial",
    "snapshotId",
    "oidTool",
    "oidToolVersion",
    "printProfile",
    "printBatch",
  ];
  for (const field of required) {
    const value = recordValue.specimen[field];
    if (typeof value !== "string" || /^(?:PENDING|SYNTHETIC)/i.test(value)) {
      errors.push(`measured specimen.${field} is unresolved`);
    }
  }
  for (const field of [
    "version",
    "gitCommit",
    "binarySha256",
    "rustcVersion",
    "targetTriple",
    "cargoLockSha256",
  ]) {
    const value = recordValue.specimen.firmware[field];
    if (typeof value !== "string" || /^(?:PENDING|SYNTHETIC)/i.test(value)) {
      errors.push(`measured specimen.firmware.${field} is unresolved`);
    }
  }
  return errors;
}

async function resultSemanticErrors(recordValue, catalogById, { verifyArtifacts = true } = {}) {
  const errors = [];
  const profile = catalogById.get(recordValue.acceptance.profileId);
  if (!profile) {
    errors.push(`unknown acceptance profile ${recordValue.acceptance.profileId}`);
    return errors;
  }
  if (recordValue.testDefinition.testId !== profile.profileId) {
    errors.push("testDefinition.testId differs from acceptance.profileId");
  }
  if (recordValue.fixtureOnly !== profile.fixtureOnly) {
    errors.push("fixtureOnly differs from the catalog profile");
  }
  const usableAudioStartClasses = new Set([
    "decoder-first-pcm",
    "dma-first-buffer",
    "electrical-output",
  ]);
  if (
    recordValue.evidenceState !== "PENDING" &&
    profile.endStage === "audioStart" &&
    !usableAudioStartClasses.has(recordValue.method.audioStartTimeClass)
  ) {
    errors.push(
      `method.audioStartTimeClass=${recordValue.method.audioStartTimeClass} is not output evidence`,
    );
  }
  for (const key of [
    "profileId",
    "startStage",
    "endStage",
    "minSamples",
    "minSuccessRate",
    "maxWrongCodes",
    "maxNoReads",
    "maxP95Us",
  ]) {
    if (recordValue.acceptance[key] !== profile[key]) {
      errors.push(`acceptance.${key} differs from catalog`);
    }
  }

  const clockIds = new Set();
  for (const clock of recordValue.method.clockDomains) {
    if (clockIds.has(clock.clockId)) errors.push(`duplicate clockId ${clock.clockId}`);
    clockIds.add(clock.clockId);
  }
  for (const sync of recordValue.method.synchronization) {
    if (!clockIds.has(sync.fromClockId) || !clockIds.has(sync.toClockId)) {
      errors.push("synchronization references an unknown clock");
    }
  }

  const ordinals = new Set();
  const oidSequences = new Set();
  const audioSequences = new Set();
  let maxSampleOidDrops = 0;
  let maxSampleAudioDrops = 0;
  const latencies = [];
  for (const sample of recordValue.samples) {
    if (ordinals.has(sample.ordinal)) errors.push(`duplicate ordinal ${sample.ordinal}`);
    ordinals.add(sample.ordinal);
    if (sample.outcome === "correct" && sample.observedPhysicalCode !== sample.expectedPhysicalCode) {
      errors.push(`sample ${sample.ordinal} claims correct with a different code`);
    }
    if (sample.outcome === "wrong" && sample.observedPhysicalCode === sample.expectedPhysicalCode) {
      errors.push(`sample ${sample.ordinal} claims wrong with the expected code`);
    }
    for (const point of Object.values(sample.stages)) {
      if (point && !clockIds.has(point.clockId)) {
        errors.push(`sample ${sample.ordinal} references unknown clock ${point.clockId}`);
      }
    }
    if ((sample.stages.event === null) !== (sample.oidSequence === null)) {
      errors.push(`sample ${sample.ordinal} event/oidSequence presence differs`);
    }
    if ((sample.stages.audioStart === null) !== (sample.audioSequence === null)) {
      errors.push(`sample ${sample.ordinal} audioStart/audioSequence presence differs`);
    }
    if (sample.oidSequence !== null) {
      if (oidSequences.has(sample.oidSequence)) {
        errors.push(`duplicate OID sequence ${sample.oidSequence}`);
      }
      oidSequences.add(sample.oidSequence);
    }
    if (sample.audioSequence !== null) {
      if (audioSequences.has(sample.audioSequence)) {
        errors.push(`duplicate audio sequence ${sample.audioSequence}`);
      }
      audioSequences.add(sample.audioSequence);
    }
    maxSampleOidDrops = Math.max(maxSampleOidDrops, sample.oidDroppedEvents);
    maxSampleAudioDrops = Math.max(maxSampleAudioDrops, sample.audioDroppedEvents);
    if (sample.outcome !== "correct") continue;
    const start = sample.stages[profile.startStage];
    const end = sample.stages[profile.endStage];
    if (!start || !end) continue;
    const latency = synchronizedLatencyUs(start, end, recordValue.method.synchronization);
    if (latency === undefined) {
      errors.push(`sample ${sample.ordinal} uses unsynchronized latency clocks`);
    } else if (latency === null || !Number.isSafeInteger(latency)) {
      errors.push(`sample ${sample.ordinal} has a negative or out-of-range latency`);
    } else {
      latencies.push(latency);
    }
  }

  const counts = countOutcomes(recordValue.samples);
  const sorted = latencies.toSorted((a, b) => a - b);
  const calculated = {
    total: recordValue.samples.length,
    ...counts,
    oidQueueDrops: recordValue.queueEvidence.oid.droppedEvents,
    audioQueueDrops: recordValue.queueEvidence.audio.droppedEvents,
    eligibleLatencySamples: sorted.length,
    p50Us: nearestRank(sorted, 0.5),
    p95Us: nearestRank(sorted, 0.95),
    p99Us: nearestRank(sorted, 0.99),
    maxUs: sorted.length ? sorted.at(-1) : null,
  };
  for (const [key, value] of Object.entries(calculated)) {
    if (recordValue.summary[key] !== value) {
      errors.push(`summary.${key}=${recordValue.summary[key]} calculated=${value}`);
    }
  }
  if (recordValue.queueEvidence.oid.droppedEvents < maxSampleOidDrops) {
    errors.push("final OID dropped count precedes a sample count");
  }
  if (recordValue.queueEvidence.audio.droppedEvents < maxSampleAudioDrops) {
    errors.push("final audio dropped count precedes a sample count");
  }
  if (
    recordValue.evidenceState !== "PENDING" &&
    (recordValue.queueEvidence.oid.queuedEvents !== 0 ||
      recordValue.queueEvidence.audio.queuedEvents !== 0)
  ) {
    errors.push("completed result still has unconsumed provider events");
  }

  if (verifyArtifacts) {
    for (const artifact of recordValue.rawArtifacts) {
      const absolute = path.resolve(repoRoot, artifact.path);
      const relative = path.relative(repoRoot, absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        errors.push(`artifact path leaves repository: ${artifact.path}`);
        continue;
      }
      try {
        const bytes = await readFile(absolute);
        const info = await stat(absolute);
        if (info.size !== artifact.size) errors.push(`artifact size mismatch: ${artifact.path}`);
        if (sha256(bytes) !== artifact.sha256) errors.push(`artifact hash mismatch: ${artifact.path}`);
      } catch (error) {
        errors.push(`artifact unreadable: ${artifact.path}: ${error.message}`);
      }
    }
  }

  errors.push(...measuredIdentityErrors(recordValue));

  if (recordValue.evidenceState === "PENDING") {
    if (recordValue.verdict !== "BLOCKED") errors.push("pending record verdict must be BLOCKED");
    return errors;
  }

  const successRate = calculated.total ? calculated.correct / calculated.total : 0;
  const passes =
    calculated.eligibleLatencySamples >= profile.minSamples &&
    successRate >= profile.minSuccessRate &&
    calculated.wrong <= profile.maxWrongCodes &&
    calculated.noRead <= profile.maxNoReads &&
    calculated.oidQueueDrops === 0 &&
    calculated.audioQueueDrops === 0 &&
    recordValue.queueEvidence.oid.queuedEvents === 0 &&
    recordValue.queueEvidence.audio.queuedEvents === 0 &&
    calculated.p95Us !== null &&
    calculated.p95Us < profile.maxP95Us;
  const expectedVerdict = passes ? "PASS" : "FAIL";
  if (recordValue.verdict !== expectedVerdict) {
    errors.push(`verdict=${recordValue.verdict} calculated=${expectedVerdict}`);
  }
  return errors;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  allowUnionTypes: true,
});
const deviceSchema = await readJson(path.join(deviceRoot, "schema.json"));
const resultSchema = await readJson(path.join(resultRoot, "schema.json"));
const platformSchema = await readJson(path.join(platformRoot, "schema.json"));
const validateDevice = ajv.compile(deviceSchema);
const validateResult = ajv.compile(resultSchema);
const validatePlatform = ajv.compile(platformSchema);

const platformVectors = await readJson(path.join(platformRoot, "golden-vectors.json"));
const platformSchemaValid = validatePlatform(platformVectors);
record(
  "platform-ffi:golden-schema",
  platformSchemaValid,
  platformSchemaValid ? "valid" : ajv.errorsText(validatePlatform.errors),
);
const platformErrors = platformSchemaValid ? platformSemanticErrors(platformVectors) : ["schema invalid"];
record("platform-ffi:golden-semantics", platformErrors.length === 0, platformErrors.join("; "));

const deviceVectors = await readJson(path.join(deviceRoot, "golden-vectors.json"));
for (const vector of deviceVectors.vectors) {
  const schemaValid = validateDevice(vector.message);
  const semanticErrors = schemaValid ? deviceSemanticErrors(vector.message) : [];
  const semanticValid = schemaValid && semanticErrors.length === 0;
  record(
    `device:${vector.id}:schema`,
    schemaValid === vector.expectedSchemaValid,
    schemaValid ? "valid" : ajv.errorsText(validateDevice.errors),
  );
  record(
    `device:${vector.id}:semantic`,
    semanticValid === vector.expectedSemanticValid,
    semanticErrors.join("; "),
  );
}

const catalog = await readJson(path.join(resultRoot, "test-catalog.json"));
const catalogById = new Map(catalog.profiles.map((profile) => [profile.profileId, profile]));
record("test-catalog:unique-profile-ids", catalogById.size === catalog.profiles.length);

const goldenResult = await readJson(path.join(resultRoot, "golden-result.json"));
const goldenSchemaValid = validateResult(goldenResult);
record(
  "test-result:golden-schema",
  goldenSchemaValid,
  goldenSchemaValid ? "valid" : ajv.errorsText(validateResult.errors),
);
const goldenErrors = goldenSchemaValid
  ? await resultSemanticErrors(goldenResult, catalogById)
  : ["schema invalid"];
record("test-result:golden-semantics", goldenErrors.length === 0, goldenErrors.join("; "));

const jsonlPath = path.join(resultRoot, "golden", "latency-samples.jsonl");
const jsonlSamples = (await readFile(jsonlPath, "utf8"))
  .trim()
  .split(/\r?\n/u)
  .map((line) => JSON.parse(line));
record(
  "test-result:jsonl-matches-record",
  JSON.stringify(jsonlSamples) === JSON.stringify(goldenResult.samples),
  `${jsonlSamples.length} raw samples`,
);

const template = await readJson(path.join(resultRoot, "template.json"));
const templateSchemaValid = validateResult(template);
record(
  "test-result:template-schema",
  templateSchemaValid,
  templateSchemaValid ? "valid" : ajv.errorsText(validateResult.errors),
);
const templateErrors = templateSchemaValid
  ? await resultSemanticErrors(template, catalogById)
  : ["schema invalid"];
record("test-result:template-semantics", templateErrors.length === 0, templateErrors.join("; "));

const negativeVectors = await readJson(path.join(resultRoot, "negative-vectors.json"));
for (const vector of negativeVectors.vectors) {
  const mutated = deepClone(goldenResult);
  setPath(mutated, vector.set.path, vector.set.value);
  const schemaValid = validateResult(mutated);
  const errors = schemaValid
    ? await resultSemanticErrors(mutated, catalogById, { verifyArtifacts: true })
    : [ajv.errorsText(validateResult.errors)];
  record(`test-result:${vector.id}:rejected`, errors.length > 0, errors.join("; "));
}

const hiddenQueueLoss = deepClone(goldenResult);
hiddenQueueLoss.queueEvidence.oid.droppedEvents = 1;
hiddenQueueLoss.summary.oidQueueDrops = 1;
const hiddenQueueLossErrors = await resultSemanticErrors(hiddenQueueLoss, catalogById);
record(
  "test-result:queue-loss-pass-rejected",
  hiddenQueueLossErrors.some((error) => error.includes("verdict=PASS calculated=FAIL")),
  hiddenQueueLossErrors.join("; "),
);

const rustContract = await readFile(
  path.join(repoRoot, "firmware", "crates", "yimi-fw-contract", "src", "lib.rs"),
  "utf8",
);
function protocolNameToRust(value) {
  return value
    .split(/[._-]/u)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join("");
}

function rustEnumVariants(source, enumName) {
  const match = source.match(new RegExp(`pub enum ${enumName} \\{([\\s\\S]*?)\\n\\}`, "u"));
  if (!match) return [];
  return [...match[1].matchAll(/^\s{4}([A-Z][A-Za-z0-9]+),/gmu)].map((entry) => entry[1]);
}

const expectedRustErrors = deviceSchema.$defs.errorCode.enum.map(protocolNameToRust);
const actualRustErrors = rustEnumVariants(rustContract, "ErrorCode");
record(
  "rust-error-code:set-parity",
  JSON.stringify(actualRustErrors.toSorted()) === JSON.stringify(expectedRustErrors.toSorted()),
  `schema=${expectedRustErrors.join("|")} rust=${actualRustErrors.join("|")}`,
);

const expectedRustOperations = deviceSchema.$defs.operation.enum.map(protocolNameToRust);
const actualRustOperations = rustEnumVariants(rustContract, "Operation");
record(
  "rust-operation:set-parity",
  JSON.stringify(actualRustOperations.toSorted()) === JSON.stringify(expectedRustOperations.toSorted()),
  `schema=${expectedRustOperations.join("|")} rust=${actualRustOperations.join("|")}`,
);

const passed = checks.filter((check) => check.passed).length;
const failed = checks.length - passed;
const releaseGateCatalog = await readJson(path.join(repoRoot, "hardware/evt0/release-gates-v1/catalog.json"));
const report = {
  schemaVersion: 1,
  profile: "firmware-contract-host-validation",
  passed,
  failed,
  total: checks.length,
  releaseGateCatalogId: releaseGateCatalog.catalogId,
  releaseDecisionOwner: "build/release-gate-current/release-decision.json",
  reportScopeGateIds: gateIdsForReportScope(releaseGateCatalog, "firmware-contracts"),
  checks,
};

const outputPath = path.join(repoRoot, "build", "firmware-contract-validation.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Firmware contracts: ${passed}/${checks.length} checks passed`);
console.log(`Report: ${outputPath}`);
if (failed > 0) process.exitCode = 1;
