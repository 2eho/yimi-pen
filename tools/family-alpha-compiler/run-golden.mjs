import { createHash } from "node:crypto";
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { gateIdsForReportScope } from "../../contracts/release-gates-v1.mjs";
import { buildPreview, compileSnapshot, writePreview } from "./compiler.mjs";
import { verifyGoldenAssets } from "./golden-assets.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "family-alpha-validation");
const CASES_ROOT = path.join(RUN_ROOT, "cases");
const RUNNER_LOCK = path.join(BUILD_ROOT, ".family-alpha-validation.lock");
const OWNERSHIP_MARKER = path.join(RUN_ROOT, ".family-alpha-validation-root");
const OWNERSHIP_TEXT = "yimi-family-alpha-validation-root-v1\n";
const GOLDEN_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const DRAFT_PATH = path.join(GOLDEN_ROOT, "draft.json");
const CONFIRMATION_PATH = path.join(GOLDEN_ROOT, "confirmation.json");
const EXPECTED_PREVIEW_PATH = path.join(GOLDEN_ROOT, "expected-preview.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function acquireRunnerLock() {
  await mkdir(BUILD_ROOT, { recursive: true });
  const buildInfo = await lstat(BUILD_ROOT);
  if (!buildInfo.isDirectory() || buildInfo.isSymbolicLink()) throw new Error("runner build/ must be a regular directory");
  const [realRepository, realBuild] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(realRepository, realBuild)) throw new Error("runner build/ resolved outside the repository");
  try {
    return await open(RUNNER_LOCK, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Family Alpha validation is already running or left a stale lock");
    throw error;
  }
}

async function prepareOwnedRunRoot() {
  const existing = await exists(RUN_ROOT);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error("validation root is not an owned regular directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("validation root resolved outside build/");
    let marker;
    try { marker = await readFile(OWNERSHIP_MARKER, "utf8"); } catch { marker = null; }
    if (marker !== OWNERSHIP_TEXT) throw new Error("validation root lacks the exact runner ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(OWNERSHIP_MARKER, OWNERSHIP_TEXT, { encoding: "utf8", flag: "wx" });
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function clone(value) {
  return structuredClone(value);
}

const DEVICE_JSON_KEY_ALLOWLIST = new Set([
  "schemaVersion", "releaseState", "snapshotId", "contentRevision", "createdAt",
  "producer", "name", "version", "target", "boardTarget", "firmwareMin",
  "physicalMapStatus", "capabilities", "oidIndex", "path", "size", "sha256",
  "entryCount", "actions", "actionCount", "files", "role", "codec", "install",
  "activationMode", "requiredBytes", "lastGoodRequired", "evidenceRefs", "entries",
  "physicalCode", "logicalOid", "actionId", "playPolicy", "clipIds", "cooldownMs",
  "clips", "clipId", "mediaType",
]);

const PRIVATE_DEVICE_KEYS = new Set([
  "label", "transcript", "sourcekind", "language", "assetpath", "bindingid", "kind",
  "voiceprofile", "voiceprofilesample", "voiceprofilesamples", "voicemodel",
  "familyphotos", "cloudcredentials",
]);

const EVIDENCE_REF_ALLOWLIST = [
  /^docs\/(?:system-concept|product-slice-evt0)\.md$/u,
  /^family-alpha-confirmation:[A-Z0-9][A-Z0-9._-]{2,127}$/u,
  /^family-alpha-confirmation-sha256:[a-f0-9]{64}$/u,
  /^family-alpha-preview:sha256:[a-f0-9]{64}$/u,
  /^family-alpha-source-sha256:[a-f0-9]{64}$/u,
];

function familyPrivateTerms(draft) {
  const terms = [draft?.sourceProducer?.name];
  for (const binding of draft?.bindings ?? []) {
    terms.push(binding.bindingId, binding.label, binding.kind);
    for (const clip of binding.clips ?? []) {
      terms.push(clip.assetPath, clip.sourceKind, clip.transcript, clip.language);
    }
  }
  return [...new Set(terms.filter((value) => typeof value === "string" && value.length > 0))];
}

function familyPrivacyProjectionErrors({ draft, documents }) {
  const errors = [];
  const privateTerms = familyPrivateTerms(draft);

  function walk(value, pointer) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${pointer}/${index}`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const childPointer = `${pointer}/${key}`;
        if (PRIVATE_DEVICE_KEYS.has(key.toLowerCase())) errors.push(`PRIVATE_KEY:${childPointer}`);
        if (!DEVICE_JSON_KEY_ALLOWLIST.has(key)) errors.push(`KEY_NOT_ALLOWLISTED:${childPointer}`);
        walk(child, childPointer);
      }
      return;
    }
    if (typeof value === "string") {
      if (
        pointer.startsWith("manifest/evidenceRefs/")
        && !EVIDENCE_REF_ALLOWLIST.some((pattern) => pattern.test(value))
      ) {
        errors.push(`VALUE_NOT_ALLOWLISTED:${pointer}`);
      }
      if (privateTerms.some((term) => (
        value === term || (/[^\x00-\x7F]/u.test(term) || term.length >= 4) && value.includes(term)
      ))) {
        errors.push(`PRIVATE_VALUE:${pointer}`);
      }
    }
  }

  for (const [name, document] of Object.entries(documents)) walk(document, name);
  return [...new Set(errors)];
}

async function treeDigest(root) {
  const files = [];
  async function walk(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => ordinalCompare(left.name, right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`generated tree contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
      } else {
        throw new Error(`generated tree contains a non-file entry: ${relative}`);
      }
    }
  }
  await walk(root);
  return { files, treeSha256: sha256(Buffer.from(JSON.stringify(files), "utf8")) };
}

async function compilerResidue(output) {
  const parent = path.dirname(output);
  const base = path.basename(output);
  const entries = (await exists(parent)) ? await readdir(parent) : [];
  return entries.filter((name) => name === `${base}.compile-lock` || name.startsWith(`${base}.tmp-`)).sort(ordinalCompare);
}

async function runValidation() {
  const baseDraft = await readJson(DRAFT_PATH);
  const baseConfirmation = await readJson(CONFIRMATION_PATH);
  const releaseGateCatalog = await readJson(path.join(REPO_ROOT, "hardware/evt0/release-gates-v1/catalog.json"));

  async function materializeCase(id) {
    const directory = path.join(CASES_ROOT, id);
    await mkdir(directory, { recursive: true });
    await cp(path.join(GOLDEN_ROOT, "assets"), path.join(directory, "assets"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return {
      directory,
      draftPath: path.join(directory, "draft.json"),
      confirmationPath: path.join(directory, "confirmation.json"),
      output: path.join(directory, "snapshot"),
      draft: clone(baseDraft),
      confirmation: clone(baseConfirmation),
    };
  }

  const diagnostics = [];

  async function expectCompileFailure({
    id,
    expectedError,
    mutateDraft,
    mutateConfirmation,
    mutateCase,
    confirmationPath,
    outputDirectory,
    sideEffectRoot,
    existingOutput = false,
  }) {
    const item = await materializeCase(id);
    if (mutateDraft) await mutateDraft(item.draft, item);
    if (mutateConfirmation) await mutateConfirmation(item.confirmation, item);
    await writeJson(item.draftPath, item.draft);
    await writeJson(item.confirmationPath, item.confirmation);
    if (mutateCase) await mutateCase(item);
    const output = outputDirectory?.(item) ?? item.output;
    const guardedSideEffectRoot = sideEffectRoot?.(item) ?? null;
    if (guardedSideEffectRoot && await exists(guardedSideEffectRoot)) {
      throw new Error(`${id}: side-effect guard root already exists before the scenario`);
    }
    const selectedConfirmation = confirmationPath?.(item) ?? item.confirmationPath;
    let sentinelBefore = null;
    if (existingOutput) {
      await mkdir(output);
      sentinelBefore = Buffer.from("owned-by-test-before-compile\n", "utf8");
      await writeFile(path.join(output, "sentinel.txt"), sentinelBefore);
    }

    let message = "";
    let unexpectedlyCompiled = false;
    try {
      await compileSnapshot({
        repoRoot: REPO_ROOT,
        draftPath: item.draftPath,
        confirmationPath: selectedConfirmation,
        outputDirectory: output,
      });
      unexpectedlyCompiled = true;
    } catch (error) {
      message = String(error?.message ?? error);
    }

    const errorMatched = expectedError.test(message);
    const residue = inside(BUILD_ROOT, output) ? await compilerResidue(output) : [];
    let zeroSideEffect;
    if (existingOutput) {
      const sentinelAfter = await readFile(path.join(output, "sentinel.txt"));
      zeroSideEffect = sentinelAfter.equals(sentinelBefore) && residue.length === 0;
    } else {
      zeroSideEffect = !(await exists(output)) && residue.length === 0;
    }
    if (guardedSideEffectRoot) zeroSideEffect = zeroSideEffect && !(await exists(guardedSideEffectRoot));
    const passed = !unexpectedlyCompiled && errorMatched && zeroSideEffect;
    if (!passed) diagnostics.push(`${id}: expected=${expectedError} actual=${message || "success"} residue=${residue.join("|") || "none"}`);
    return {
      id,
      passed,
      expectedError: expectedError.source,
      zeroSideEffect,
    };
  }

  await prepareOwnedRunRoot();
  await mkdir(CASES_ROOT, { recursive: true });

  const assetGeneration = await verifyGoldenAssets(path.join(GOLDEN_ROOT, "assets"));
  const assetGenerationExact = assetGeneration.every((asset) => asset.exact);
  if (!assetGenerationExact) diagnostics.push("committed golden WAV assets differ from their deterministic generator");

  const expectedPreviewBytes = await readFile(EXPECTED_PREVIEW_PATH);
  const expectedPreview = JSON.parse(expectedPreviewBytes.toString("utf8"));
  const { preview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath: DRAFT_PATH });
  const actualPreviewBytes = Buffer.from(`${JSON.stringify(preview, null, 2)}\n`, "utf8");
  const previewByteExact = actualPreviewBytes.equals(expectedPreviewBytes);
  const previewObjectExact = JSON.stringify(preview) === JSON.stringify(expectedPreview);
  if (!previewByteExact || !previewObjectExact) diagnostics.push("golden preview differs from expected-preview.json");

  const previewOutput = path.join(RUN_ROOT, "preview.json");
  const writtenPreview = await writePreview({ repoRoot: REPO_ROOT, draftPath: DRAFT_PATH, outputPath: previewOutput });
  const previewWriteExact = (await readFile(previewOutput)).equals(expectedPreviewBytes) && JSON.stringify(writtenPreview) === JSON.stringify(preview);
  if (!previewWriteExact) diagnostics.push("writePreview output differs from the golden receipt");

  const snapshotOutput = path.join(RUN_ROOT, "snapshot");
  const deterministicOutput = path.join(RUN_ROOT, "determinism", "snapshot");
  const compileReport = await compileSnapshot({
    repoRoot: REPO_ROOT,
    draftPath: DRAFT_PATH,
    confirmationPath: CONFIRMATION_PATH,
    outputDirectory: snapshotOutput,
  });
  const compileReportSecond = await compileSnapshot({
    repoRoot: REPO_ROOT,
    draftPath: DRAFT_PATH,
    confirmationPath: CONFIRMATION_PATH,
    outputDirectory: deterministicOutput,
  });
  const primaryTree = await treeDigest(snapshotOutput);
  const secondTree = await treeDigest(deterministicOutput);
  const deterministic = JSON.stringify(compileReport) === JSON.stringify(compileReportSecond)
    && JSON.stringify(primaryTree) === JSON.stringify(secondTree);
  if (!deterministic) diagnostics.push("two independent compile outputs differ");
  const eolCase = await materializeCase("POS-confirmation-crlf-invariance");
  await writeJson(eolCase.draftPath, eolCase.draft);
  const confirmationLf = `${JSON.stringify(eolCase.confirmation, null, 2)}\n`;
  await writeFile(eolCase.confirmationPath, confirmationLf.replace(/\n/gu, "\r\n"), "utf8");
  const eolCompileReport = await compileSnapshot({
    repoRoot: REPO_ROOT,
    draftPath: eolCase.draftPath,
    confirmationPath: eolCase.confirmationPath,
    outputDirectory: eolCase.output,
  });
  const eolTree = await treeDigest(eolCase.output);
  const confirmationEolInvariant = JSON.stringify(eolTree) === JSON.stringify(primaryTree)
    && eolCompileReport.confirmationSha256 === compileReport.confirmationSha256
    && eolCompileReport.confirmationFileSha256 !== compileReport.confirmationFileSha256;
  if (!confirmationEolInvariant) diagnostics.push("confirmation semantic identity changed under LF/CRLF representation");
  const compiledManifest = await readJson(path.join(snapshotOutput, "manifest.json"));
  const compiledActions = await readJson(path.join(snapshotOutput, "actions.json"));
  const compiledIndex = await readJson(path.join(snapshotOutput, "logical-index.json"));
  const privacyProjectionErrors = familyPrivacyProjectionErrors({
    draft: baseDraft,
    documents: { manifest: compiledManifest, actions: compiledActions, logicalIndex: compiledIndex },
  });
  const manifestValueLeak = clone(compiledManifest);
  manifestValueLeak.evidenceRefs.push(`family-label:${baseDraft.bindings[0].label}`);
  const privacyManifestValueLeakRejected = familyPrivacyProjectionErrors({
    draft: baseDraft,
    documents: { manifest: manifestValueLeak, actions: compiledActions, logicalIndex: compiledIndex },
  }).some((error) => error.startsWith("PRIVATE_VALUE:"));
  const manifestKeyLeak = clone(compiledManifest);
  manifestKeyLeak.label = baseDraft.bindings[0].label;
  const privacyManifestKeyLeakRejected = familyPrivacyProjectionErrors({
    draft: baseDraft,
    documents: { manifest: manifestKeyLeak, actions: compiledActions, logicalIndex: compiledIndex },
  }).some((error) => error.startsWith("PRIVATE_KEY:") || error.startsWith("KEY_NOT_ALLOWLISTED:"));
  const shortPrivateDraft = clone(baseDraft);
  shortPrivateDraft.bindings[0].label = "妈";
  const manifestShortValueLeak = clone(compiledManifest);
  manifestShortValueLeak.evidenceRefs.push("family-label:妈");
  const privacyShortValueLeakRejected = familyPrivacyProjectionErrors({
    draft: shortPrivateDraft,
    documents: { manifest: manifestShortValueLeak, actions: compiledActions, logicalIndex: compiledIndex },
  }).some((error) => error.startsWith("PRIVATE_VALUE:") || error.startsWith("VALUE_NOT_ALLOWLISTED:"));
  const privacyProjectionValid = privacyProjectionErrors.length === 0
    && privacyManifestValueLeakRejected && privacyManifestKeyLeakRejected && privacyShortValueLeakRejected;
  const producerSeparated = baseDraft.sourceProducer.name !== compileReport.producer.name
    && compileReport.producer.name === "yimi-family-alpha-compiler";
  if (!privacyProjectionValid) {
    diagnostics.push(`compiled device JSON privacy projection failed: ${privacyProjectionErrors.join("|") || "injected manifest leak was not detected"}`);
  }
  if (!producerSeparated) diagnostics.push("sourceProducer and compiler producer identities are not separated");

  const deviceLinkSchema = await readJson(path.join(REPO_ROOT, "hardware/evt0/device-link-v1/schema.json"));
  const deviceLinkAjv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  const validateDeviceLinkEnvelope = deviceLinkAjv.compile(deviceLinkSchema);
  const manifestFile = compileReport.files.find((file) => file.path === "manifest.json");
  const deviceLinkBegin = {
    schemaVersion: 1,
    profile: "loopback-json-v1",
    kind: "request",
    requestId: "REQ-FAMILY-ALPHA-BEGIN",
    op: "snapshot.stage.begin",
    payload: {
      transactionId: "TX-FAMILY-ALPHA",
      snapshotId: compileReport.snapshotId,
      manifestByteLength: String(manifestFile.size),
      totalBytes: String(compileReport.files.reduce((sum, file) => sum + file.size, 0)),
      fileCount: compileReport.files.length,
      expectedActiveSnapshotId: null,
    },
  };
  const deviceLinkEnvelopeAccepted = validateDeviceLinkEnvelope(deviceLinkBegin);
  const deviceLinkRejectedAtSnapshotId = !deviceLinkEnvelopeAccepted
    && (validateDeviceLinkEnvelope.errors ?? []).some((error) => error.instancePath === "/payload/snapshotId");
  const deviceLinkProjectionValid = compileReport.files[0]?.path === "manifest.json"
    && manifestFile.size > 0 && deviceLinkBegin.payload.totalBytes === String(compileReport.requiredBytes)
    && deviceLinkRejectedAtSnapshotId;
  if (!deviceLinkProjectionValid) diagnostics.push("DeviceLink projection did not preserve manifest-first plus design-fixture rejection");

  const negativeScenarios = [];
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-01-stale-preview-id",
    expectedError: /confirmation is stale/u,
    mutateConfirmation: (confirmation) => { confirmation.previewId = `sha256:${"0".repeat(64)}`; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-02-stale-source-hash",
    expectedError: /confirmation is stale/u,
    mutateConfirmation: (confirmation) => { confirmation.sourceSha256 = "0".repeat(64); },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-02-stale-confirmation-leaves-no-parent",
    expectedError: /confirmation is stale/u,
    mutateConfirmation: (confirmation) => { confirmation.sourceSha256 = "0".repeat(64); },
    outputDirectory: (item) => path.join(item.directory, "new-output-parent", "nested", "snapshot"),
    sideEffectRoot: (item) => path.join(item.directory, "new-output-parent"),
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-03-decision-not-confirmed",
    expectedError: /family confirmation schema failed/u,
    mutateConfirmation: (confirmation) => { confirmation.decision = "pending"; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-04-fixture-mode-mismatch",
    expectedError: /confirmation fixtureOnly differs/u,
    mutateConfirmation: (confirmation) => { confirmation.fixtureOnly = false; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-04-production-trust-contract-pending",
    expectedError: /production confirmation trust contract is pending/u,
    mutateDraft: (draft) => { draft.fixtureOnly = false; },
    mutateConfirmation: (confirmation) => { confirmation.fixtureOnly = false; },
    mutateCase: async (item) => {
      const { preview: casePreview } = await buildPreview({ repoRoot: REPO_ROOT, draftPath: item.draftPath });
      item.confirmation.previewId = casePreview.previewId;
      item.confirmation.sourceSha256 = casePreview.sourceSha256;
      await writeJson(item.confirmationPath, item.confirmation);
    },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-05-confirmation-before-draft",
    expectedError: /confirmation timestamp precedes/u,
    mutateConfirmation: (confirmation) => { confirmation.confirmedAt = "2026-08-02T23:59:59Z"; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-06-invalid-calendar-date",
    expectedError: /family confirmation schema failed/u,
    mutateConfirmation: (confirmation) => { confirmation.confirmedAt = "2026-02-30T00:00:00Z"; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-07-asset-path-escape",
    expectedError: /family draft schema failed/u,
    mutateDraft: (draft) => { draft.bindings[0].clips[0].assetPath = "../outside.wav"; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-07-alpha-binding-limit",
    expectedError: /family draft schema failed/u,
    mutateDraft: (draft) => {
      while (draft.bindings.length < 25) {
        const number = String(draft.bindings.length + 1).padStart(2, "0");
        const binding = clone(draft.bindings[0]);
        binding.bindingId = `binding-extra-${number}`;
        binding.logicalOid = `YIMI-EVT0-X${number}`;
        binding.actionId = `action-extra-${number}`;
        binding.clips[0].clipId = `clip-extra-${number}`;
        draft.bindings.push(binding);
      }
    },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-07-firmware-min-length",
    expectedError: /family draft schema failed/u,
    mutateDraft: (draft) => { draft.target.firmwareMin = "f".repeat(65); },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-08-duplicate-logical-oid",
    expectedError: /logicalOid must be unique/u,
    mutateDraft: (draft) => { draft.bindings[1].logicalOid = draft.bindings[0].logicalOid; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-09-duplicate-clip-id",
    expectedError: /clipId must be globally unique/u,
    mutateDraft: (draft) => { draft.bindings[1].clips[0].clipId = draft.bindings[0].clips[0].clipId; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-10-replace-has-multiple-clips",
    expectedError: /replace must contain exactly one clip/u,
    mutateDraft: (draft) => {
      const extra = clone(draft.bindings[1].clips[0]);
      extra.clipId = "clip-013-2";
      draft.bindings[0].clips.push(extra);
    },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-11-random-one-has-one-clip",
    expectedError: /random_one needs at least two clips/u,
    mutateDraft: (draft) => { draft.bindings[2].clips = [draft.bindings[2].clips[0]]; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-12-release-gate-receipt-missing",
    expectedError: /machine-readable release-gate receipt/u,
    mutateDraft: (draft) => {
      draft.fixtureOnly = false;
      draft.releaseState = "release-candidate";
      draft.target = {
        boardTarget: "BOARD-A-REV-A",
        firmwareMin: "1.0.0",
        physicalMapStatus: "assigned",
        capabilities: ["audio:wav-pcm16-16k-mono", "snapshot:staged-atomic"],
      };
      draft.bindings.forEach((binding, index) => { binding.physicalCode = String(10_000 + index); });
    },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-13-wav-trailing-payload",
    expectedError: /RIFF length differs/u,
    mutateCase: async (item) => {
      const target = path.join(item.directory, item.draft.bindings[0].clips[0].assetPath);
      const bytes = await readFile(target);
      await writeFile(target, Buffer.concat([bytes, Buffer.from("TRAILING-DATA", "ascii")]));
    },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-14-wav-invalid-byte-rate",
    expectedError: /must be PCM16 16kHz mono/u,
    mutateCase: async (item) => {
      const target = path.join(item.directory, item.draft.bindings[0].clips[0].assetPath);
      const bytes = await readFile(target);
      bytes.writeUInt32LE(31_999, 28);
      await writeFile(target, bytes);
    },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-15-audio-changed-after-confirmation",
    expectedError: /confirmation is stale/u,
    mutateCase: async (item) => {
      const target = path.join(item.directory, item.draft.bindings[0].clips[0].assetPath);
      const bytes = await readFile(target);
      bytes[44] ^= 0x01;
      await writeFile(target, bytes);
    },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-16-voice-profile-sample-field",
    expectedError: /family draft schema failed/u,
    mutateDraft: (draft) => { draft.bindings[0].clips[0].voiceProfileSample = "sample.bin"; },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-17-duplicate-json-key",
    expectedError: /duplicate JSON object key/u,
    mutateCase: async (item) => {
      const text = await readFile(item.draftPath, "utf8");
      await writeFile(item.draftPath, text.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,'), "utf8");
    },
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-18-output-already-exists",
    expectedError: /output directory already exists/u,
    existingOutput: true,
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-19-confirmation-outside-repository",
    expectedError: /confirmation must stay inside its allowed workspace/u,
    confirmationPath: () => path.resolve(REPO_ROOT, "../family-alpha-outside-confirmation.json"),
  }));
  negativeScenarios.push(await expectCompileFailure({
    id: "NEG-20-output-outside-build",
    expectedError: /output must stay inside build/u,
    outputDirectory: () => path.join(REPO_ROOT, "family-alpha-outside-output"),
  }));

  const previewOutsideOutput = path.join(REPO_ROOT, "family-alpha-outside-preview.json");
  let previewOutsideMessage = "";
  try {
    await writePreview({ repoRoot: REPO_ROOT, draftPath: DRAFT_PATH, outputPath: previewOutsideOutput });
  } catch (error) {
    previewOutsideMessage = String(error?.message ?? error);
  }
  const previewOutsidePassed = /output must stay inside build/u.test(previewOutsideMessage) && !(await exists(previewOutsideOutput));
  if (!previewOutsidePassed) diagnostics.push(`NEG-21-preview-output-outside-build: ${previewOutsideMessage || "success"}`);
  negativeScenarios.push({
    id: "NEG-21-preview-output-outside-build",
    passed: previewOutsidePassed,
    expectedError: "output must stay inside build",
    zeroSideEffect: !(await exists(previewOutsideOutput)),
  });

  const previewBeforeSecondWrite = await readFile(previewOutput);
  let previewOverwriteMessage = "";
  try {
    await writePreview({ repoRoot: REPO_ROOT, draftPath: DRAFT_PATH, outputPath: previewOutput });
  } catch (error) {
    previewOverwriteMessage = String(error?.message ?? error);
  }
  const previewOverwriteResidue = await compilerResidue(previewOutput);
  const previewNoOverwrite = previewOverwriteMessage.length > 0
    && (await readFile(previewOutput)).equals(previewBeforeSecondWrite) && previewOverwriteResidue.length === 0;
  if (!previewNoOverwrite) diagnostics.push(`NEG-22-preview-no-overwrite: ${previewOverwriteMessage || "success"}`);
  negativeScenarios.push({
    id: "NEG-22-preview-no-overwrite",
    passed: previewNoOverwrite,
    expectedError: "existing-preview-rejected",
    zeroSideEffect: (await readFile(previewOutput)).equals(previewBeforeSecondWrite) && previewOverwriteResidue.length === 0,
  });

  const concurrent = await materializeCase("NEG-23-concurrent-output");
  await writeJson(concurrent.draftPath, concurrent.draft);
  await writeJson(concurrent.confirmationPath, concurrent.confirmation);
  const concurrentResults = await Promise.allSettled([
    compileSnapshot({ repoRoot: REPO_ROOT, draftPath: concurrent.draftPath, confirmationPath: concurrent.confirmationPath, outputDirectory: concurrent.output }),
    compileSnapshot({ repoRoot: REPO_ROOT, draftPath: concurrent.draftPath, confirmationPath: concurrent.confirmationPath, outputDirectory: concurrent.output }),
  ]);
  const concurrentSuccesses = concurrentResults.filter((result) => result.status === "fulfilled");
  const concurrentFailures = concurrentResults.filter((result) => result.status === "rejected");
  const concurrentFailureMatched = concurrentFailures.length === 1
    && /locked by another compiler run|output directory already exists/u.test(String(concurrentFailures[0].reason?.message ?? concurrentFailures[0].reason));
  const concurrentTree = (await exists(concurrent.output)) ? await treeDigest(concurrent.output) : null;
  const concurrentResidue = await compilerResidue(concurrent.output);
  const concurrentPassed = concurrentSuccesses.length === 1 && concurrentFailureMatched
    && JSON.stringify(concurrentTree) === JSON.stringify(primaryTree) && concurrentResidue.length === 0;
  if (!concurrentPassed) diagnostics.push("NEG-23-concurrent-output: expected one immutable complete output and one rejected writer");
  negativeScenarios.push({
    id: "NEG-23-concurrent-output",
    passed: concurrentPassed,
    expectedError: "lock-or-existing-output",
    zeroSideEffect: concurrentResidue.length === 0,
  });

  const allNegativePassed = negativeScenarios.every((scenario) => scenario.passed);
  const allNegativeZeroSideEffect = negativeScenarios.every((scenario) => scenario.zeroSideEffect);
  const report = {
    schemaVersion: 1,
    profile: "family-alpha-compiler-validation-v1",
    fixtureOnly: true,
    golden: {
      assetGenerationExact,
      generatedAssetCount: assetGeneration.length,
      previewByteExact,
      previewObjectExact,
      previewWriteExact,
      sourceSha256: preview.sourceSha256,
      previewId: preview.previewId,
      bindingCount: preview.summary.bindingCount,
      clipCount: preview.summary.clipCount,
      audioBytes: preview.summary.audioBytes,
      compile: compileReport,
      deterministic,
      confirmationEolInvariant,
      producerSeparated,
      privacyProjectionValid,
      privacyManifestValueLeakRejected,
      privacyManifestKeyLeakRejected,
      privacyShortValueLeakRejected,
      outputTreeSha256: primaryTree.treeSha256,
      outputFiles: primaryTree.files,
      deviceLinkProjection: {
        status: "BLOCKED_DESIGN_FIXTURE",
        manifestFirst: compileReport.files[0]?.path === "manifest.json",
        manifestByteLength: deviceLinkBegin.payload.manifestByteLength,
        totalBytes: deviceLinkBegin.payload.totalBytes,
        fileCount: deviceLinkBegin.payload.fileCount,
        releaseEnvelopeAccepted: deviceLinkEnvelopeAccepted,
        designSnapshotIdRejected: deviceLinkRejectedAtSnapshotId,
      },
    },
    negativeSummary: {
      total: negativeScenarios.length,
      passed: negativeScenarios.filter((scenario) => scenario.passed).length,
      zeroSideEffect: negativeScenarios.filter((scenario) => scenario.zeroSideEffect).length,
    },
    negativeScenarios,
    gates: {
      hostDesignContractValid: diagnostics.length === 0,
      releaseGateCatalogId: releaseGateCatalog.catalogId,
      releaseDecisionOwner: "build/release-gate-current/release-decision.json",
      reportScopeGateIds: gateIdsForReportScope(releaseGateCatalog, "family-alpha"),
    },
  };

  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes);
  const reportSha256 = sha256(reportBytes);
  console.log(`Family Alpha golden: preview=${previewByteExact && previewObjectExact && previewWriteExact ? "PASS" : "FAIL"}`);
  console.log(`Family Alpha compile: bindings=${compileReport.bindingCount} clips=${compileReport.clipCount} snapshot=${compileReport.snapshotId}`);
  console.log(`Family Alpha deterministic tree: ${deterministic ? "PASS" : "FAIL"} (${primaryTree.treeSha256})`);
  console.log(`Family Alpha negatives: ${negativeScenarios.filter((scenario) => scenario.passed).length}/${negativeScenarios.length} passed, zero-side-effect ${negativeScenarios.filter((scenario) => scenario.zeroSideEffect).length}/${negativeScenarios.length}`);
  console.log(`Family Alpha report SHA-256: ${reportSha256}`);

  if (diagnostics.length || !assetGenerationExact || !allNegativePassed || !allNegativeZeroSideEffect || !deterministic || !previewByteExact || !previewObjectExact || !previewWriteExact) {
    for (const diagnostic of diagnostics) console.error(`- ${diagnostic}`);
    process.exitCode = 1;
  }
}

const runnerLock = await acquireRunnerLock();
try {
  await runValidation();
} finally {
  try { await runnerLock.close(); } catch { /* preserve the validation result */ }
  try { await rm(RUNNER_LOCK, { force: true }); } catch { /* preserve the validation result */ }
}
