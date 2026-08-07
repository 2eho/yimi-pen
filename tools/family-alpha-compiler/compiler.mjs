import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalSha256, snapshotHashInput } from "../../scripts/snapshot-jcs.mjs";
import { snapshotProjectionErrors } from "../../scripts/snapshot-projection-validator.mjs";
import {
  parseJsonRejectingDuplicateKeys,
  readJsonRejectingDuplicateKeys,
} from "../../contracts/strict-json-v1.mjs";

const U64_MAX = 18_446_744_073_709_551_615n;
const COMPILER = Object.freeze({ name: "yimi-family-alpha-compiler", version: "0.1.0" });

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedTextSha256(text) {
  return sha256(Buffer.from(text.replace(/\r\n?/gu, "\n"), "utf8"));
}

async function readJson(file) {
  return readJsonRejectingDuplicateKeys(file, path.basename(file));
}

function makeAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value) => {
      if (typeof value !== "string") return false;
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
      if (!match) return false;
      const [, year, month, day, hour, minute, second, , offsetHour = "00", offsetMinute = "00"] = match;
      const y = Number(year);
      const m = Number(month);
      const d = Number(day);
      if (y < 1 || m < 1 || m > 12 || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
      if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return false;
      return d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
    },
  });
  return ajv;
}

async function validators(repoRoot) {
  const contractRoot = path.join(repoRoot, "hardware/evt0/family-alpha-v1");
  const ajv = makeAjv();
  return {
    ajv,
    draft: ajv.compile(await readJson(path.join(contractRoot, "draft.schema.json"))),
    confirmation: ajv.compile(await readJson(path.join(contractRoot, "confirmation.schema.json"))),
    preview: ajv.compile(await readJson(path.join(contractRoot, "preview.schema.json"))),
    snapshot: ajv.compile(await readJson(path.join(repoRoot, "hardware/evt0/snapshot-v1/schema.json"))),
    logicalIndex: ajv.compile(await readJson(path.join(repoRoot, "hardware/evt0/snapshot-v1/logical-index.schema.json"))),
    actions: ajv.compile(await readJson(path.join(repoRoot, "hardware/evt0/snapshot-v1/actions.schema.json"))),
  };
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateWith(name, validate, value, ajv) {
  if (!validate(value)) throw new Error(`${name} schema failed: ${ajv.errorsText(validate.errors)}`);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function secureRegularFile({ repositoryRoot, file, label, containmentRoot = repositoryRoot }) {
  const resolvedFile = path.resolve(file);
  if (!inside(path.resolve(containmentRoot), resolvedFile)) {
    throw new Error(`${label} must stay inside its allowed workspace`);
  }
  const info = await lstat(resolvedFile);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  const [realRepository, realContainment, realFile] = await Promise.all([
    realpath(path.resolve(repositoryRoot)),
    realpath(path.resolve(containmentRoot)),
    realpath(resolvedFile),
  ]);
  if (!inside(realRepository, realFile) || !inside(realContainment, realFile)) {
    throw new Error(`${label} resolved outside its allowed workspace`);
  }
  return realFile;
}

async function ensureSafeBuildOutput(repositoryRoot, output) {
  const resolvedRepository = path.resolve(repositoryRoot);
  const buildRoot = path.join(resolvedRepository, "build");
  if (!inside(buildRoot, output)) throw new Error("family compiler output must stay inside build/ during Alpha");

  await mkdir(buildRoot, { recursive: true });
  const buildInfo = await lstat(buildRoot);
  if (!buildInfo.isDirectory() || buildInfo.isSymbolicLink()) {
    throw new Error("build/ must be a regular non-symlink directory");
  }
  const [realRepository, realBuild] = await Promise.all([realpath(resolvedRepository), realpath(buildRoot)]);
  if (!inside(realRepository, realBuild)) throw new Error("build/ resolved outside the repository workspace");

  const parentRelative = path.relative(buildRoot, path.dirname(output));
  let cursor = buildRoot;
  for (const segment of parentRelative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error("family compiler output parent must be a regular non-symlink directory");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(cursor);
    }
  }

  const realParent = await realpath(path.dirname(output));
  if (realParent !== realBuild && !inside(realBuild, realParent)) {
    throw new Error("family compiler output parent resolved outside build/");
  }
}

function assertUnique(items, key, label) {
  const values = items.map((item) => item[key]);
  if (new Set(values).size !== values.length) throw new Error(`${label} ${key} must be unique`);
}

function parseU64(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(value)) {
    throw new Error(`${label} must be a canonical decimal u64 string`);
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX) throw new Error(`${label} exceeds u64`);
  return parsed;
}

function wavPcm16Mono16k(header, totalBytes, label) {
  if (header.length < 44 || totalBytes < 44 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${label} is not a RIFF/WAVE file`);
  }
  if (header.readUInt32LE(4) !== totalBytes - 8) throw new Error(`${label} RIFF length differs from the file length`);
  if (header.toString("ascii", 12, 16) !== "fmt " || header.readUInt32LE(16) !== 16) {
    throw new Error(`${label} must contain one canonical 16-byte fmt chunk first`);
  }
  const format = {
    audioFormat: header.readUInt16LE(20),
    channels: header.readUInt16LE(22),
    sampleRate: header.readUInt32LE(24),
    byteRate: header.readUInt32LE(28),
    blockAlign: header.readUInt16LE(32),
    bitsPerSample: header.readUInt16LE(34),
  };
  if (header.toString("ascii", 36, 40) !== "data") throw new Error(`${label} must contain one data chunk after fmt`);
  const dataBytes = header.readUInt32LE(40);
  if (dataBytes === 0 || totalBytes !== 44 + dataBytes) {
    throw new Error(`${label} data length differs from the canonical WAV payload`);
  }
  if (
    format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16_000 ||
    format.bitsPerSample !== 16 || format.blockAlign !== 2 || format.byteRate !== 32_000 ||
    dataBytes % format.blockAlign !== 0
  ) {
    throw new Error(`${label} must be PCM16 16kHz mono`);
  }
  return { durationMs: Math.round((dataBytes / format.blockAlign / format.sampleRate) * 1000) };
}

async function inspectCanonicalWavFile(file, label) {
  const handle = await open(file, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 0xffff_ffff + 8) throw new Error(`${label} exceeds the canonical RIFF size range`);
    const header = Buffer.alloc(44);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length) throw new Error(`${label} is not a RIFF/WAVE file`);
    const media = wavPcm16Mono16k(header, before.size, label);
    const hash = createHash("sha256");
    let observedBytes = 0;
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
      observedBytes += chunk.length;
      hash.update(chunk);
    }
    const after = await handle.stat();
    if (observedBytes !== before.size || after.size !== before.size) throw new Error(`${label} changed while it was being inspected`);
    return { bytes: before.size, sha256: hash.digest("hex"), durationMs: media.durationMs };
  } finally {
    await handle.close();
  }
}

function bindingContent(binding, clips) {
  return {
    bindingId: binding.bindingId,
    logicalOid: binding.logicalOid,
    physicalCode: binding.physicalCode,
    actionId: binding.actionId,
    label: binding.label,
    kind: binding.kind,
    playPolicy: binding.playPolicy,
    cooldownMs: binding.cooldownMs,
    revision: binding.revision,
    clips: clips.map((clip) => ({
      clipId: clip.clipId,
      assetPath: clip.assetPath,
      assetSha256: clip.sha256,
      sourceKind: clip.sourceKind,
      transcript: clip.transcript,
      mediaType: clip.mediaType,
      language: clip.language,
      codec: clip.codec,
    })),
  };
}

function semanticDraftErrors(draft) {
  const errors = [];
  for (const [key, label] of [["bindingId", "binding"], ["logicalOid", "binding"], ["actionId", "binding"]]) {
    const values = draft.bindings.map((item) => item[key]);
    if (new Set(values).size !== values.length) errors.push(`${label} ${key} must be unique`);
  }
  const clips = draft.bindings.flatMap((binding) => binding.clips);
  if (new Set(clips.map((clip) => clip.clipId)).size !== clips.length) errors.push("clipId must be globally unique");
  for (const binding of draft.bindings) {
    if (binding.playPolicy === "replace" && binding.clips.length !== 1) {
      errors.push(`${binding.bindingId} replace must contain exactly one clip`);
    }
    if (binding.playPolicy === "random_one" && binding.clips.length < 2) {
      errors.push(`${binding.bindingId} random_one needs at least two clips`);
    }
    if (binding.physicalCode !== null) {
      try { parseU64(binding.physicalCode, `${binding.bindingId}.physicalCode`); } catch (error) { errors.push(error.message); }
    }
  }
  const assigned = draft.bindings.filter((item) => item.physicalCode !== null);
  if (draft.target.physicalMapStatus === "unassigned" && assigned.length !== 0) {
    errors.push("unassigned target must keep every physicalCode null");
  }
  if (draft.target.physicalMapStatus === "assigned" && assigned.length !== draft.bindings.length) {
    errors.push("assigned target requires every physicalCode");
  }
  if (new Set(assigned.map((item) => item.physicalCode)).size !== assigned.length) {
    errors.push("physicalCode must be unique");
  }
  if (draft.releaseState === "release-candidate") {
    errors.push("Family Alpha v1 is design-fixture only until a machine-readable release-gate receipt is implemented");
  }
  return errors;
}

export async function buildPreview({ repoRoot, draftPath }) {
  const resolvedRepo = path.resolve(repoRoot);
  const resolvedDraft = path.resolve(draftPath);
  if (!inside(resolvedRepo, resolvedDraft)) throw new Error("draft must stay inside the repository workspace");
  const draftRoot = path.dirname(resolvedDraft);
  const securedDraft = await secureRegularFile({ repositoryRoot: resolvedRepo, file: resolvedDraft, label: "draft" });
  const draft = await readJson(securedDraft);
  const checks = await validators(resolvedRepo);
  validateWith("family draft", checks.draft, draft, checks.ajv);
  const semanticErrors = semanticDraftErrors(draft);
  if (semanticErrors.length) throw new Error(`family draft semantics failed: ${semanticErrors.join("; ")}`);
  assertUnique(draft.bindings, "bindingId", "binding");

  const previewBindings = [];
  let clipCount = 0;
  let audioBytes = 0;
  for (const binding of [...draft.bindings].sort((a, b) => ordinalCompare(a.logicalOid, b.logicalOid))) {
    const previewClips = [];
    for (const clip of binding.clips) {
      const asset = path.resolve(draftRoot, clip.assetPath);
      if (!inside(draftRoot, asset)) throw new Error(`${clip.clipId} asset escaped the draft root`);
      const securedAsset = await secureRegularFile({
        repositoryRoot: resolvedRepo,
        containmentRoot: draftRoot,
        file: asset,
        label: `${clip.clipId} asset`,
      });
      const media = await inspectCanonicalWavFile(securedAsset, clip.clipId);
      previewClips.push({ ...clip, bytes: media.bytes, sha256: media.sha256, durationMs: media.durationMs });
      clipCount += 1;
      audioBytes += media.bytes;
    }
    previewBindings.push({
      bindingId: binding.bindingId,
      logicalOid: binding.logicalOid,
      label: binding.label,
      kind: binding.kind,
      playPolicy: binding.playPolicy,
      cooldownMs: binding.cooldownMs,
      revision: binding.revision,
      contentSha256: canonicalSha256(bindingContent(binding, previewClips)).sha256,
      clips: previewClips.map(({
        clipId,
        assetPath,
        bytes,
        sha256: hash,
        durationMs,
        sourceKind,
        transcript,
        mediaType,
        language,
        codec,
      }) => ({
        clipId,
        assetPath,
        bytes,
        sha256: hash,
        durationMs,
        sourceKind,
        transcript,
        mediaType,
        language,
        codec,
      })),
    });
  }
  const sourceSha256 = canonicalSha256(draft).sha256;
  const previewIdentity = {
    profile: "family-alpha-preview-v1",
    presentationPolicyVersion: "family-alpha-v1",
    sourceSha256,
    bindings: previewBindings,
  };
  const preview = {
    schemaVersion: 1,
    profile: "family-alpha-preview-v1",
    fixtureOnly: draft.fixtureOnly,
    status: "AWAITING_GUARDIAN_CONFIRMATION",
    presentationPolicyVersion: "family-alpha-v1",
    sourceSha256,
    previewId: `sha256:${canonicalSha256(previewIdentity).sha256}`,
    bindings: previewBindings,
    summary: { bindingCount: previewBindings.length, clipCount, audioBytes },
    privacy: {
      voiceProfileSamplesIncluded: false,
      voiceModelIncluded: false,
      familyPhotosIncluded: false,
      cloudCredentialsIncluded: false,
    },
  };
  validateWith("family preview", checks.preview, preview, checks.ajv);
  return { draft, preview };
}

function projectionOrder(bindings) {
  const copy = [...bindings];
  if (copy.every((item) => item.physicalCode !== null)) {
    return copy.sort((a, b) => {
      const left = parseU64(a.physicalCode, `${a.bindingId}.physicalCode`);
      const right = parseU64(b.physicalCode, `${b.bindingId}.physicalCode`);
      return left < right ? -1 : left > right ? 1 : ordinalCompare(a.logicalOid, b.logicalOid);
    });
  }
  return copy.sort((a, b) => ordinalCompare(a.logicalOid, b.logicalOid));
}

function encodeManifest(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function finalizeManifest(manifest) {
  const payloadBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
  manifest.snapshotId = `${manifest.releaseState === "release-candidate" ? "sha256:" : "design:"}${"0".repeat(64)}`;
  let requiredBytes = payloadBytes;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    manifest.install.requiredBytes = requiredBytes;
    const next = payloadBytes + encodeManifest(manifest).length;
    if (next === requiredBytes) break;
    requiredBytes = next;
  }
  manifest.install.requiredBytes = requiredBytes;
  const snapshotHash = canonicalSha256(snapshotHashInput(manifest)).sha256;
  manifest.snapshotId = `${manifest.releaseState === "release-candidate" ? "sha256:" : "design:"}${snapshotHash}`;
  const bytes = encodeManifest(manifest);
  if (payloadBytes + bytes.length !== requiredBytes) {
    throw new Error("requiredBytes fixed point did not converge");
  }
  return bytes;
}

export async function compileSnapshot({
  repoRoot,
  draftPath,
  confirmationPath,
  outputDirectory,
}) {
  const resolvedRepo = path.resolve(repoRoot);
  const output = path.resolve(outputDirectory);
  const compilerSourceSha256 = normalizedTextSha256(await readFile(fileURLToPath(import.meta.url), "utf8"));
  const checks = await validators(resolvedRepo);
  const { draft, preview } = await buildPreview({ repoRoot: resolvedRepo, draftPath });
  const securedConfirmation = await secureRegularFile({
    repositoryRoot: resolvedRepo,
    file: path.resolve(confirmationPath),
    label: "confirmation",
  });
  const confirmationBytes = await readFile(securedConfirmation);
  const confirmation = parseJsonRejectingDuplicateKeys(confirmationBytes.toString("utf8"), "confirmation");
  const confirmationFileSha256 = sha256(confirmationBytes);
  const confirmationSha256 = canonicalSha256(confirmation).sha256;
  validateWith("family confirmation", checks.confirmation, confirmation, checks.ajv);
  if (confirmation.fixtureOnly !== draft.fixtureOnly) throw new Error("confirmation fixtureOnly differs from draft");
  if (confirmation.previewId !== preview.previewId || confirmation.sourceSha256 !== preview.sourceSha256) {
    throw new Error("confirmation is stale for the current draft or audio bytes");
  }
  if (Date.parse(confirmation.confirmedAt) < Date.parse(draft.createdAt)) {
    throw new Error("confirmation timestamp precedes the authored revision");
  }
  if (!draft.fixtureOnly) {
    throw new Error("production confirmation trust contract is pending in Family Alpha v1");
  }
  await ensureSafeBuildOutput(resolvedRepo, output);
  const lockPath = `${output}.compile-lock`;
  let outputLock;
  try {
    outputLock = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("output directory is locked by another compiler run");
    throw error;
  }
  try {
    try {
      await lstat(output);
      throw new Error("output directory already exists");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const draftRoot = path.dirname(path.resolve(draftPath));
    const orderedBindings = projectionOrder(draft.bindings);
    const previewByBinding = new Map(preview.bindings.map((item) => [item.bindingId, item]));
    const stagingOutput = `${output}.tmp-${process.pid}-${randomUUID()}`;
    let created = false;
    try {
      await mkdir(stagingOutput);
      created = true;
      await mkdir(path.join(stagingOutput, "audio"));
      const [realBuild, realStaging] = await Promise.all([
        realpath(path.join(resolvedRepo, "build")),
        realpath(stagingOutput),
      ]);
      if (!inside(realBuild, realStaging)) throw new Error("owned staging directory resolved outside build/");
      const logicalIndex = {
        schemaVersion: 1,
        physicalMapStatus: draft.target.physicalMapStatus,
        entries: orderedBindings.map((binding) => ({
          physicalCode: binding.physicalCode,
          logicalOid: binding.logicalOid,
          actionId: binding.actionId,
        })),
      };
      const actionList = [];
      const clipCatalog = [];
      const audioFiles = [];
      for (const binding of orderedBindings) {
        actionList.push({
          actionId: binding.actionId,
          playPolicy: binding.playPolicy,
          clipIds: binding.clips.map((clip) => clip.clipId),
          cooldownMs: binding.cooldownMs,
        });
        const previewBinding = previewByBinding.get(binding.bindingId);
        for (const clip of binding.clips) {
          const evidence = previewBinding.clips.find((item) => item.clipId === clip.clipId);
          if (!evidence) throw new Error(`${clip.clipId} missing from preview evidence`);
          const source = path.resolve(draftRoot, clip.assetPath);
          const securedSource = await secureRegularFile({
            repositoryRoot: resolvedRepo,
            containmentRoot: draftRoot,
            file: source,
            label: `${clip.clipId} asset`,
          });
          const inspectedSource = await inspectCanonicalWavFile(securedSource, clip.clipId);
          if (inspectedSource.bytes !== evidence.bytes || inspectedSource.sha256 !== evidence.sha256) {
            throw new Error(`${clip.clipId} changed after preview`);
          }
          const targetPath = `audio/${clip.clipId}.wav`;
          const target = path.join(stagingOutput, ...targetPath.split("/"));
          await copyFile(securedSource, target, constants.COPYFILE_EXCL);
          const inspectedTarget = await inspectCanonicalWavFile(target, `${clip.clipId} compiled asset`);
          if (inspectedTarget.bytes !== evidence.bytes || inspectedTarget.sha256 !== evidence.sha256) {
            throw new Error(`${clip.clipId} changed while it was copied`);
          }
          const record = {
            clipId: clip.clipId,
            path: targetPath,
            size: evidence.bytes,
            sha256: evidence.sha256,
            codec: clip.codec,
            mediaType: clip.mediaType,
          };
          clipCatalog.push(record);
          audioFiles.push({ path: targetPath, size: evidence.bytes, sha256: evidence.sha256, role: "audio", codec: clip.codec });
        }
      }
      clipCatalog.sort((a, b) => ordinalCompare(a.clipId, b.clipId));
      audioFiles.sort((a, b) => ordinalCompare(a.path, b.path));
      const actions = { schemaVersion: 1, actions: actionList, clips: clipCatalog };
      validateWith("compiled logical index", checks.logicalIndex, logicalIndex, checks.ajv);
      validateWith("compiled actions", checks.actions, actions, checks.ajv);
      const projectionErrors = snapshotProjectionErrors({ logicalIndex, actions });
      if (projectionErrors.length) throw new Error(`compiled projection semantics failed: ${projectionErrors.join("; ")}`);
      const indexBytes = Buffer.from(`${JSON.stringify(logicalIndex, null, 2)}\n`, "utf8");
      const actionBytes = Buffer.from(`${JSON.stringify(actions, null, 2)}\n`, "utf8");
      await writeFile(path.join(stagingOutput, "logical-index.json"), indexBytes);
      await writeFile(path.join(stagingOutput, "actions.json"), actionBytes);
      const files = [
        { path: "logical-index.json", size: indexBytes.length, sha256: sha256(indexBytes), role: "oid-index" },
        { path: "actions.json", size: actionBytes.length, sha256: sha256(actionBytes), role: "actions" },
        ...audioFiles,
      ];
      const manifest = {
        schemaVersion: 1,
        releaseState: draft.releaseState,
        snapshotId: `design:${"0".repeat(64)}`,
        contentRevision: draft.contentRevision,
        createdAt: draft.createdAt,
        producer: COMPILER,
        target: draft.target,
        oidIndex: { path: "logical-index.json", size: indexBytes.length, sha256: sha256(indexBytes), entryCount: logicalIndex.entries.length },
        actions: { path: "actions.json", size: actionBytes.length, sha256: sha256(actionBytes), actionCount: actionList.length },
        files,
        install: { activationMode: "staged-atomic", requiredBytes: 1, lastGoodRequired: true },
        evidenceRefs: [
          "docs/system-concept.md",
          "docs/product-slice-evt0.md",
          `family-alpha-confirmation:${confirmation.confirmationId}`,
          `family-alpha-confirmation-sha256:${confirmationSha256}`,
          `family-alpha-preview:${preview.previewId}`,
          `family-alpha-source-sha256:${preview.sourceSha256}`,
        ],
      };
      const manifestBytes = finalizeManifest(manifest);
      validateWith("compiled Snapshot", checks.snapshot, manifest, checks.ajv);
      const crossProjectionErrors = snapshotProjectionErrors({
        logicalIndex,
        actions,
        manifest,
        manifestByteLength: manifestBytes.length,
      });
      if (crossProjectionErrors.length) {
        throw new Error(`compiled cross-file projection semantics failed: ${crossProjectionErrors.join("; ")}`);
      }
      await writeFile(path.join(stagingOutput, "manifest.json"), manifestBytes);
  
      for (const file of manifest.files) {
        const bytes = await readFile(path.join(stagingOutput, ...file.path.split("/")));
        if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error(`compiled file drift: ${file.path}`);
      }
      const report = {
        schemaVersion: 1,
        profile: "family-alpha-compile-report-v1",
        producer: COMPILER,
        compilerSourceSha256,
        fixtureOnly: draft.fixtureOnly,
        sourceSha256: preview.sourceSha256,
        previewId: preview.previewId,
      confirmationId: confirmation.confirmationId,
      confirmationSha256,
      confirmationFileSha256,
        snapshotId: manifest.snapshotId,
        releaseState: manifest.releaseState,
        bindingCount: logicalIndex.entries.length,
        clipCount: clipCatalog.length,
        requiredBytes: manifest.install.requiredBytes,
        manifestSha256: sha256(manifestBytes),
        files: [{ path: "manifest.json", size: manifestBytes.length, sha256: sha256(manifestBytes) }, ...manifest.files],
        privacy: preview.privacy,
      };
      await rename(stagingOutput, output);
      created = false;
      return report;
    } catch (error) {
      if (created) {
        try { await rm(stagingOutput, { recursive: true, force: true }); } catch { /* preserve the primary failure */ }
      }
      throw error;
    }
  } finally {
    try {
      await outputLock.close();
    } catch { /* output commit result remains authoritative */ }
    try {
      await rm(lockPath, { force: true });
    } catch { /* output commit result remains authoritative */ }
  }
}

export async function writePreview({ repoRoot, draftPath, outputPath }) {
  const resolvedRepo = path.resolve(repoRoot);
  const output = path.resolve(outputPath);
  const { preview } = await buildPreview({ repoRoot: resolvedRepo, draftPath });
  await ensureSafeBuildOutput(resolvedRepo, output);
  const temporary = `${output}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(preview, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await link(temporary, output);
  } catch (error) {
    try { await rm(temporary, { force: true }); } catch { /* preserve the primary failure */ }
    throw error;
  }
  try { await rm(temporary, { force: true }); } catch { /* preview has already been published */ }
  return preview;
}
