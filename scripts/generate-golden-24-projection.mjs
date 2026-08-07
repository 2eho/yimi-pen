import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODES_PATH = path.join(ROOT, "hardware/evt0/golden-24/codes.json");
const INDEX_PATH = path.join(ROOT, "hardware/evt0/snapshot-v1/design/logical-index.json");
const ACTIONS_PATH = path.join(ROOT, "hardware/evt0/snapshot-v1/design/actions.json");
const MANIFEST_PATH = path.join(ROOT, "hardware/evt0/snapshot-v1/design/manifest.json");
const TRANSCRIPT_PATH = path.join(ROOT, "hardware/evt0/snapshot-v1/operation-transcript.json");
const FAMILY_PATH = path.join(ROOT, "hardware/evt0/family-alpha-v1/golden/draft.json");
const REPORT_PATH = path.join(ROOT, "build/golden-24-projection-validation.json");
const writeMode = process.argv.includes("--write");

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function actionId(slot) {
  return `action-${String(slot).padStart(3, "0")}`;
}

function clipIds(slot, count) {
  const prefix = `clip-${String(slot).padStart(3, "0")}`;
  return Array.from({ length: count }, (_unused, index) => `${prefix}-${index + 1}`);
}

const codes = JSON.parse(await readFile(CODES_PATH, "utf8"));
const entries = [...codes.entries].sort((left, right) => left.slot - right.slot);
const sourceFailures = [];
if (codes.schemaVersion !== 1) sourceFailures.push({ id: "source-schema-version" });
if (!Array.isArray(codes.evidenceGaps) || codes.evidenceGaps.length === 0) sourceFailures.push({ id: "source-evidence-gaps" });
if (entries.length !== 24) sourceFailures.push({ id: "source-entry-count" });
if (new Set(entries.map((entry) => entry.slot)).size !== entries.length) sourceFailures.push({ id: "source-slot-unique" });
if (!entries.every((entry, index) => entry.slot === index + 1)) sourceFailures.push({ id: "source-slot-contiguous" });
if (new Set(entries.map((entry) => entry.logicalOid)).size !== entries.length) sourceFailures.push({ id: "source-logical-oid-unique" });
if (!entries.every((entry) => Number.isInteger(entry.cooldownMs) && entry.cooldownMs >= 0 && entry.cooldownMs <= 60_000)) {
  sourceFailures.push({ id: "source-cooldown-range" });
}
if (!entries.every((entry) => Number.isInteger(entry.clipCount) && entry.clipCount >= 1 && entry.clipCount <= 32)) {
  sourceFailures.push({ id: "source-clip-count-range" });
}
if (!entries.every((entry) => ["replace", "queue", "random_one"].includes(entry.playPolicy))) {
  sourceFailures.push({ id: "source-play-policy" });
}
if (writeMode && sourceFailures.length) {
  throw new Error(`golden-24 source failed: ${sourceFailures.map((failure) => failure.id).join(", ")}`);
}
const logicalIndex = {
  schemaVersion: 1,
  physicalMapStatus: entries.every((entry) => entry.physicalCode !== null) ? "assigned" : "unassigned",
  entries: entries.map((entry) => ({
    physicalCode: entry.physicalCode,
    logicalOid: entry.logicalOid,
    actionId: actionId(entry.slot),
  })),
};
const actions = {
  schemaVersion: 1,
  actions: entries.map((entry) => ({
    actionId: actionId(entry.slot),
    playPolicy: entry.playPolicy,
    clipIds: clipIds(entry.slot, entry.clipCount),
    cooldownMs: entry.cooldownMs,
    designSource: entry.sourcePlan,
    codecPlan: entry.codecPlan,
  })),
};
const indexBytes = encode(logicalIndex);
const actionBytes = encode(actions);
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const indexSha256 = sha256(indexBytes);
const actionsSha256 = sha256(actionBytes);
manifest.oidIndex = { path: "logical-index.json", size: indexBytes.length, sha256: indexSha256, entryCount: entries.length };
manifest.actions = { path: "actions.json", size: actionBytes.length, sha256: actionsSha256, actionCount: entries.length };
for (const file of manifest.files) {
  if (file.path === "logical-index.json") Object.assign(file, { size: indexBytes.length, sha256: indexSha256 });
  if (file.path === "actions.json") Object.assign(file, { size: actionBytes.length, sha256: actionsSha256 });
}
const payloadBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
let requiredBytes = payloadBytes;
for (let attempt = 0; attempt < 8; attempt += 1) {
  manifest.install.requiredBytes = requiredBytes;
  const next = payloadBytes + encode(manifest).length;
  if (next === requiredBytes) break;
  requiredBytes = next;
}
manifest.install.requiredBytes = payloadBytes + encode(manifest).length;
const manifestBytes = encode(manifest);
const transcript = JSON.parse(await readFile(TRANSCRIPT_PATH, "utf8"));
for (const snapshot of transcript.snapshots) {
  const scenarioActions = structuredClone(actions);
  scenarioActions.actions[0].cooldownMs = snapshot.firstActionCooldownMs;
  const scenarioActionBytes = encode(scenarioActions);
  const scenarioManifest = structuredClone(manifest);
  const scenarioActionSha256 = sha256(scenarioActionBytes);
  const actionFile = scenarioManifest.files.find((file) => file.path === "actions.json");
  Object.assign(actionFile, { size: scenarioActionBytes.length, sha256: scenarioActionSha256 });
  Object.assign(scenarioManifest.actions, { size: scenarioActionBytes.length, sha256: scenarioActionSha256 });
  scenarioManifest.snapshotId = snapshot.snapshotId;
  scenarioManifest.contentRevision = snapshot.contentRevision;
  const scenarioPayloadBytes = scenarioManifest.files.reduce((sum, file) => sum + file.size, 0);
  let scenarioRequiredBytes = scenarioPayloadBytes;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    scenarioManifest.install.requiredBytes = scenarioRequiredBytes;
    const next = scenarioPayloadBytes + encode(scenarioManifest).length;
    if (next === scenarioRequiredBytes) break;
    scenarioRequiredBytes = next;
  }
  snapshot.requiredBytes = scenarioRequiredBytes;
}
const transcriptBytes = encode(transcript);

if (writeMode) {
  await Promise.all([
    writeFile(INDEX_PATH, indexBytes),
    writeFile(ACTIONS_PATH, actionBytes),
    writeFile(MANIFEST_PATH, manifestBytes),
    writeFile(TRANSCRIPT_PATH, transcriptBytes),
  ]);
}

const [committedIndex, committedActions, committedManifest, committedTranscript, family] = await Promise.all([
  readFile(INDEX_PATH),
  readFile(ACTIONS_PATH),
  readFile(MANIFEST_PATH),
  readFile(TRANSCRIPT_PATH),
  readFile(FAMILY_PATH, "utf8").then(JSON.parse),
]);
const indexExact = committedIndex.equals(indexBytes);
const actionsExact = committedActions.equals(actionBytes);
const manifestExact = committedManifest.equals(manifestBytes);
const transcriptExact = committedTranscript.equals(transcriptBytes);
const truthByOid = new Map(entries.map((entry) => [entry.logicalOid, entry]));
const familyChecks = [];
const sourceKindByPlan = new Map([
  ["FAMILY_RECORDING", "family-recording"],
  ["SYSTEM_TTS", "system-tts"],
]);

for (const binding of family.bindings) {
  const truth = truthByOid.get(binding.logicalOid);
  familyChecks.push({ id: `${binding.logicalOid}:exists`, passed: Boolean(truth) });
  if (!truth) continue;
  const expectedSourceKind = sourceKindByPlan.get(truth.sourcePlan);
  const checks = {
    physicalCode: binding.physicalCode === truth.physicalCode,
    actionId: binding.actionId === actionId(truth.slot),
    kind: binding.kind === truth.kind,
    playPolicy: binding.playPolicy === truth.playPolicy,
    cooldownMs: binding.cooldownMs === truth.cooldownMs,
    clipCount: binding.clips.length === truth.clipCount,
    sourceKind: expectedSourceKind !== undefined
      && binding.clips.every((clip) => clip.sourceKind === expectedSourceKind),
  };
  for (const [field, passed] of Object.entries(checks)) {
    familyChecks.push({ id: `${binding.logicalOid}:${field}`, passed });
  }
}

const familyPassed = familyChecks.filter((item) => item.passed).length;
const failures = [
  ...sourceFailures,
  ...(!indexExact ? [{ id: "snapshot-index-byte-drift" }] : []),
  ...(!actionsExact ? [{ id: "snapshot-actions-byte-drift" }] : []),
  ...(!manifestExact ? [{ id: "snapshot-manifest-byte-drift" }] : []),
  ...(!transcriptExact ? [{ id: "snapshot-transcript-derived-byte-drift" }] : []),
  ...familyChecks.filter((item) => !item.passed),
];
const report = {
  schemaVersion: 1,
  profile: "golden-24-projection-validation-v1",
  sourceSha256: sha256(await readFile(CODES_PATH)),
  sourceChecks: {
    passed: sourceFailures.length === 0,
    failures: sourceFailures,
  },
  generated: {
    logicalIndexSha256: indexSha256,
    actionsSha256,
    manifestSha256: sha256(manifestBytes),
    transcriptSha256: sha256(transcriptBytes),
  },
  exact: {
    logicalIndex: indexExact,
    actions: actionsExact,
    manifest: manifestExact,
    transcript: transcriptExact,
  },
  familySubset: {
    bindings: family.bindings.length,
    checks: familyChecks.length,
    passed: familyPassed,
    failed: familyChecks.length - familyPassed,
  },
  valid: failures.length === 0,
  failures,
};

await mkdir(path.dirname(REPORT_PATH), { recursive: true });
await writeFile(REPORT_PATH, encode(report));
console.log(`Golden-24 projection exact: index=${indexExact} actions=${actionsExact} manifest=${manifestExact} transcript=${transcriptExact}`);
console.log(`Family subset: ${familyPassed}/${familyChecks.length} checks passed`);
console.log(`Report: ${REPORT_PATH}`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure.id}`);
  console.error("Run with --write only when codes.json was intentionally revised and review the resulting diff.");
  process.exitCode = 1;
}
