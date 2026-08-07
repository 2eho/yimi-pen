import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";
import { buildPreview } from "../family-alpha-compiler/compiler.mjs";
import { computeBuildSubjectSha256 } from "../../contracts/family-build-plan-v1.mjs";
import {
  computeFamilyRevisionId,
  finalizeBuildPlanProjection,
  projectCompileDraft,
  projectCompileDraftFromPlan,
  verifyBuildAssets,
  verifyBuildPlanAssets,
} from "./adapter.mjs";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_ROOT, "../..");
const BUILD_ROOT = path.join(REPO_ROOT, "build");
const RUN_ROOT = path.join(BUILD_ROOT, "family-build-adapter-validation");
const RUNNER_LOCK = path.join(BUILD_ROOT, ".family-build-adapter-validation.lock");
const MARKER = path.join(RUN_ROOT, ".family-build-adapter-validation-root");
const MARKER_TEXT = "yimi-family-build-adapter-validation-root-v1\n";
const CONTRACT_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-repository-v1");
const ALPHA_ROOT = path.join(REPO_ROOT, "hardware/evt0/family-alpha-v1/golden");
const REVISION_PATH = path.join(CONTRACT_ROOT, "golden/family-revision.json");
const REQUEST_PATH = path.join(CONTRACT_ROOT, "golden/build-request.json");
const PLAN_PATH = path.join(CONTRACT_ROOT, "golden/build-plan.json");
const LEGACY_DRAFT_PATH = path.join(ALPHA_ROOT, "draft.json");
const CONFIRMATION_PATH = path.join(ALPHA_ROOT, "confirmation.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encode(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  if (!buildInfo.isDirectory() || buildInfo.isSymbolicLink()) throw new Error("build/ must be a regular directory");
  const [realRepository, realBuild] = await Promise.all([realpath(REPO_ROOT), realpath(BUILD_ROOT)]);
  if (!inside(realRepository, realBuild)) throw new Error("build/ resolved outside repository");
  try {
    return await open(RUNNER_LOCK, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("family build adapter validation is already running or left a stale lock");
    throw error;
  }
}

async function prepareRunRoot() {
  const current = await exists(RUN_ROOT);
  if (current) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw new Error("validation root must be an owned regular directory");
    const [realBuild, realRun] = await Promise.all([realpath(BUILD_ROOT), realpath(RUN_ROOT)]);
    if (!inside(realBuild, realRun)) throw new Error("validation root resolved outside build/");
    let markerText = null;
    try { markerText = await readFile(MARKER, "utf8"); } catch { /* ownership check below */ }
    if (markerText !== MARKER_TEXT) throw new Error("validation root lacks exact ownership marker");
    await rm(RUN_ROOT, { recursive: true, force: true });
  }
  await mkdir(RUN_ROOT);
  await writeFile(MARKER, MARKER_TEXT, { encoding: "utf8", flag: "wx" });
}

async function treeDigest(root) {
  const records = [];
  async function walk(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`validation tree contains symlink ${relative}`);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        records.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await walk(root);
  return sha256(Buffer.from(JSON.stringify(records), "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

async function alphaAssetReader(asset) {
  const candidate = path.resolve(ALPHA_ROOT, asset.path);
  if (!inside(ALPHA_ROOT, candidate)) throw new Error(`${asset.assetId} path escaped Alpha root`);
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${asset.assetId} must resolve to a regular file`);
  const [realAlpha, realCandidate] = await Promise.all([realpath(ALPHA_ROOT), realpath(candidate)]);
  if (!inside(realAlpha, realCandidate)) throw new Error(`${asset.assetId} real path escaped Alpha root`);
  return readFile(realCandidate);
}

async function run() {
  await prepareRunRoot();
  const [familyRevision, buildRequest, buildPlan, expectedDraftBytes, confirmationBytes] = await Promise.all([
    readFile(REVISION_PATH, "utf8").then(JSON.parse),
    readFile(REQUEST_PATH, "utf8").then(JSON.parse),
    readFile(PLAN_PATH, "utf8").then(JSON.parse),
    readFile(LEGACY_DRAFT_PATH),
    readFile(CONFIRMATION_PATH),
  ]);
  const confirmation = JSON.parse(confirmationBytes.toString("utf8"));
  const first = await projectCompileDraft({ familyRevision, buildRequest });
  const second = await projectCompileDraft({ familyRevision: clone(familyRevision), buildRequest: clone(buildRequest) });
  const projectedBytes = encode(first.draft);
  const projectionByteExact = projectedBytes.equals(expectedDraftBytes);
  const deterministic = JSON.stringify(first) === JSON.stringify(second);
  const revisionIdentityValid = computeFamilyRevisionId(familyRevision) === familyRevision.revisionId;
  const assets = await verifyBuildAssets({ buildRequest, assetReader: alphaAssetReader });
  const assetCatalogVerified = assets.length === buildRequest.assetCatalog.assets.length;
  const planFirst = await projectCompileDraftFromPlan({ familyRevision: clone(familyRevision), buildPlan: clone(buildPlan) });
  const planSecond = await projectCompileDraftFromPlan({ familyRevision: clone(familyRevision), buildPlan: clone(buildPlan) });
  const provisionalBuildPlan = clone(buildPlan);
  provisionalBuildPlan.expectedProjection.sourceSha256 = "0".repeat(64);
  provisionalBuildPlan.buildSubjectSha256 = "0".repeat(64);
  const finalizedPlan = await finalizeBuildPlanProjection({
    familyRevision: clone(familyRevision),
    provisionalBuildPlan,
  });
  const planProjectionByteExact = encode(planFirst.draft).equals(expectedDraftBytes);
  const planDeterministic = JSON.stringify(planFirst) === JSON.stringify(planSecond);
  const planIdentityValid = computeBuildSubjectSha256(buildPlan) === buildPlan.buildSubjectSha256;
  const confirmationFreePlan = !("confirmation" in buildPlan) && !("releaseGateReceiptRef" in buildPlan);
  const planAssets = await verifyBuildPlanAssets({ buildPlan, assetReader: alphaAssetReader });
  const planAssetCatalogVerified = planAssets.length === buildPlan.assetCatalog.assets.length;
  const planFinalizerMatchesGolden = JSON.stringify(finalizedPlan.buildPlan) === JSON.stringify(buildPlan)
    && encode(finalizedPlan.draft).equals(expectedDraftBytes)
    && finalizedPlan.projectionSha256 === buildPlan.expectedProjection.sourceSha256;
  const confirmationIdentityValid = confirmation.confirmationId === buildRequest.confirmation.confirmationId
    && canonicalSha256(confirmation).sha256 === buildRequest.confirmation.semanticSha256
    && confirmation.previewId === buildRequest.confirmation.previewId
    && confirmation.sourceSha256 === buildRequest.confirmation.projectionSourceSha256;

  const projectedRoot = path.join(RUN_ROOT, "projected");
  await mkdir(projectedRoot);
  await cp(path.join(ALPHA_ROOT, "assets"), path.join(projectedRoot, "assets"), { recursive: true, errorOnExist: true, force: false });
  const projectedDraftPath = path.join(projectedRoot, "draft.json");
  await writeFile(projectedDraftPath, projectedBytes, { flag: "wx" });
  const previewResult = await buildPreview({ repoRoot: REPO_ROOT, draftPath: projectedDraftPath });
  const previewIdentityValid = previewResult.preview.sourceSha256 === buildRequest.confirmation.projectionSourceSha256
    && previewResult.preview.previewId === buildRequest.confirmation.previewId;

  const forbiddenRevisionKeys = new Set([
    "target", "releaseState", "physicalCode", "actionId", "assetPath", "codec",
    "boardTarget", "firmwareMin", "capabilities",
  ]);
  const leakedRevisionKeys = [];
  function scanRevision(value, pointer = "") {
    if (Array.isArray(value)) value.forEach((item, index) => scanRevision(item, `${pointer}/${index}`));
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (forbiddenRevisionKeys.has(key)) leakedRevisionKeys.push(`${pointer}/${key}`);
        scanRevision(child, `${pointer}/${key}`);
      }
    }
  }
  scanRevision(familyRevision);
  const targetNeutralRevision = leakedRevisionKeys.length === 0;

  const negativeScenarios = [];
  async function expectFailure({ id, expected, mutateRevision, mutateRequest, rehash = false, verifyAssets = false }) {
    const revision = clone(familyRevision);
    const request = clone(buildRequest);
    if (mutateRevision) mutateRevision(revision);
    if (rehash) {
      revision.revisionId = computeFamilyRevisionId(revision);
      request.familyRevisionId = revision.revisionId;
    }
    if (mutateRequest) mutateRequest(request);
    const before = await treeDigest(RUN_ROOT);
    let message = "";
    let succeeded = false;
    try {
      if (verifyAssets) {
        await verifyBuildAssets({
          buildRequest: request,
          assetReader: async (asset) => {
            const bytes = Buffer.from(await alphaAssetReader(asset));
            if (asset.assetId === request.assetCatalog.assets[0].assetId) bytes[0] ^= 0x01;
            return bytes;
          },
        });
      } else {
        await projectCompileDraft({ familyRevision: revision, buildRequest: request });
      }
      succeeded = true;
    } catch (error) {
      message = String(error?.message ?? error);
    }
    const after = await treeDigest(RUN_ROOT);
    const zeroSideEffect = before === after;
    const passed = !succeeded && expected.test(message) && zeroSideEffect;
    negativeScenarios.push({ id, passed, zeroSideEffect, expectedError: expected.source, actualError: message });
  }

  async function expectPlanFailure({ id, expected, mutatePlan }) {
    const revision = clone(familyRevision);
    const plan = clone(buildPlan);
    mutatePlan(plan);
    const before = await treeDigest(RUN_ROOT);
    let message = "";
    let succeeded = false;
    try { await projectCompileDraftFromPlan({ familyRevision: revision, buildPlan: plan }); succeeded = true; }
    catch (error) { message = String(error?.message ?? error); }
    const after = await treeDigest(RUN_ROOT);
    const zeroSideEffect = before === after;
    negativeScenarios.push({ id, passed: !succeeded && expected.test(message) && zeroSideEffect, zeroSideEffect, expectedError: expected.source, actualError: message });
  }

  await expectFailure({ id: "NEG-01-revision-id-stale", expected: /semantic identity mismatch/u, mutateRevision: (revision) => { revision.bindings[0].label += "!"; } });
  await expectFailure({ id: "NEG-02-request-revision-stale", expected: /different FamilyRevision/u, mutateRequest: (request) => { request.familyRevisionId = `sha256:${"0".repeat(64)}`; } });
  await expectFailure({ id: "NEG-03-revision-target-leak", expected: /FamilyRevision schema failed/u, mutateRevision: (revision) => { revision.target = {}; } });
  await expectFailure({ id: "NEG-04-revision-path-leak", expected: /FamilyRevision schema failed/u, mutateRevision: (revision) => { revision.bindings[0].clips[0].assetPath = "assets/leak.wav"; } });
  await expectFailure({ id: "NEG-05-revision-codec-leak", expected: /FamilyRevision schema failed/u, mutateRevision: (revision) => { revision.bindings[0].clips[0].codec = "WAV_PCM16_16K_MONO"; } });
  await expectFailure({ id: "NEG-06-duplicate-logical-oid", expected: /logicalOid must be unique/u, mutateRevision: (revision) => { revision.bindings[1].logicalOid = revision.bindings[0].logicalOid; }, rehash: true });
  await expectFailure({ id: "NEG-07-unsorted-bindings", expected: /bindings must be strictly ordinally sorted/u, mutateRevision: (revision) => { [revision.bindings[0], revision.bindings[1]] = [revision.bindings[1], revision.bindings[0]]; }, rehash: true });
  await expectFailure({ id: "NEG-08-map-missing", expected: /physical map must exactly cover/u, mutateRequest: (request) => { request.physicalMap.entries.pop(); } });
  await expectFailure({ id: "NEG-09-map-extra", expected: /physical map must exactly cover/u, mutateRequest: (request) => { request.physicalMap.entries.push({ logicalOid: "YIMI-EVT0-999", physicalCode: null }); } });
  await expectFailure({ id: "NEG-10-asset-missing", expected: /asset catalog must exactly cover/u, mutateRequest: (request) => { request.assetCatalog.assets.pop(); } });
  await expectFailure({ id: "NEG-11-asset-hash-mismatch", expected: /asset identity differs/u, mutateRequest: (request) => { request.assetCatalog.assets[0].sha256 = "0".repeat(64); } });
  await expectFailure({ id: "NEG-12-source-codec-outside-profile", expected: /source codec is outside/u, mutateRequest: (request) => { request.codecProfile.acceptedSourceCodecs = ["MP3"]; } });
  await expectFailure({ id: "NEG-13-transcode-not-implicit", expected: /requires source and snapshot codec equality/u, mutateRequest: (request) => { request.codecProfile.snapshotCodec = "MP3"; } });
  await expectFailure({ id: "NEG-14-release-without-receipt", expected: /BuildRequest schema failed/u, mutateRequest: (request) => { request.fixtureOnly = false; request.outputMode = "release-candidate"; } });
  await expectFailure({ id: "NEG-15-confirmation-source-mismatch", expected: /confirmation projection source differs/u, mutateRequest: (request) => { request.confirmation.projectionSourceSha256 = "0".repeat(64); } });
  await expectFailure({ id: "NEG-16-projection-hash-mismatch", expected: /semantic hash differs/u, mutateRequest: (request) => { request.confirmation.projectionSourceSha256 = "0".repeat(64); request.expectedProjection.sourceSha256 = "0".repeat(64); } });
  await expectFailure({ id: "NEG-17-resolved-asset-bytes-mismatch", expected: /resolved bytes differ/u, verifyAssets: true });
  await expectFailure({ id: "NEG-18-revision-u64-overflow", expected: /revisionNumber must fit/u, mutateRevision: (revision) => { revision.revisionNumber = "18446744073709551616"; }, rehash: true });
  await expectFailure({ id: "NEG-19-physical-u64-overflow", expected: /physicalCode must fit/u, mutateRequest: (request) => { request.physicalMap.status = "assigned"; request.physicalMap.entries.forEach((entry, index) => { entry.physicalCode = index === 0 ? "18446744073709551616" : String(index); }); } });
  await expectFailure({ id: "NEG-20-request-before-revision", expected: /timestamp precedes/u, mutateRequest: (request) => { request.requestedAt = "2026-08-02T23:59:59Z"; } });
  await expectFailure({
    id: "NEG-21-legacy-release-self-reported-receipt",
    expected: /BuildRequest v1 release path is sealed/u,
    mutateRequest: (request) => {
      request.fixtureOnly = false;
      request.outputMode = "release-candidate";
      request.releaseGateReceiptRef = "receipt:fake";
      request.physicalMap.status = "assigned";
      request.physicalMap.entries.forEach((entry, index) => { entry.physicalCode = String(1000 + index); });
    },
  });
  await expectPlanFailure({ id: "NEG-22-build-plan-identity-stale", expected: /BuildPlan semantic identity mismatch/u, mutatePlan: (plan) => { plan.requestedAt = "2026-08-03T00:04:01Z"; } });
  await expectPlanFailure({ id: "NEG-23-build-plan-confirmation-cycle", expected: /BuildPlan schema failed/u, mutatePlan: (plan) => { plan.confirmation = clone(buildRequest.confirmation); } });

  const negativePassed = negativeScenarios.filter((scenario) => scenario.passed).length;
  const zeroSideEffectPassed = negativeScenarios.filter((scenario) => scenario.zeroSideEffect).length;
  const gates = {
    revisionIdentityValid,
    targetNeutralRevision,
    projectionByteExact,
    deterministic,
    assetCatalogVerified,
    confirmationIdentityValid,
    previewIdentityValid,
    planIdentityValid,
    confirmationFreePlan,
    planProjectionByteExact,
    planDeterministic,
    planAssetCatalogVerified,
    planFinalizerMatchesGolden,
    negativePassed: negativePassed === negativeScenarios.length,
    negativeZeroSideEffect: zeroSideEffectPassed === negativeScenarios.length,
  };
  const report = {
    schemaVersion: 1,
    profile: "family-build-adapter-validation-v1",
    contract: {
      familyRevisionId: familyRevision.revisionId,
      buildRequestId: buildRequest.buildRequestId,
      buildPlanId: buildPlan.buildPlanId,
      buildSubjectSha256: buildPlan.buildSubjectSha256,
      projectionSha256: first.projectionSha256,
      previewId: previewResult.preview.previewId,
      confirmationSha256: buildRequest.confirmation.semanticSha256,
      bindingCount: familyRevision.bindings.length,
      clipCount: familyRevision.bindings.reduce((sum, binding) => sum + binding.clips.length, 0),
      assetCount: assets.length,
    },
    gates,
    negativeSummary: {
      total: negativeScenarios.length,
      passed: negativePassed,
      zeroSideEffect: zeroSideEffectPassed,
    },
    negativeScenarios,
    integration: {
      familyRevisionBuildRequestSplit: "LEGACY_COMPATIBLE",
      buildPlanAuthorizationSplit: "BUILD_PLAN_CLOSED_AUTHORIZATION_PENDING",
      familyRepositoryPort: "CLOSED",
      releaseDecisionOwner: "build/release-gate-current/release-decision.json",
    },
  };
  const reportBytes = encode(report);
  await writeFile(path.join(RUN_ROOT, "report.json"), reportBytes, { flag: "wx" });
  const allPassed = Object.values(gates).every(Boolean);
  console.log(`Family build projection: ${projectionByteExact ? "BYTE-EXACT" : "DRIFT"}`);
  console.log(`Family revision: bindings=${report.contract.bindingCount} clips=${report.contract.clipCount} assets=${report.contract.assetCount}`);
  console.log(`Family build negatives: ${negativePassed}/${negativeScenarios.length}; zero-side-effect ${zeroSideEffectPassed}/${negativeScenarios.length}`);
  console.log(`Report SHA-256: ${sha256(reportBytes)}`);
  console.log(`Report: ${path.join(RUN_ROOT, "report.json")}`);
  if (!allPassed) process.exitCode = 1;
}

const runnerLock = await acquireRunnerLock();
try {
  await run();
} finally {
  try { await runnerLock.close(); } catch { /* preserve validation result */ }
  try { await rm(RUNNER_LOCK, { force: true }); } catch { /* preserve validation result */ }
}
