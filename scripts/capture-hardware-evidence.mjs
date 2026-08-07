import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_ROOT = path.join("hardware", "evt0", "evidence-capture-v1");
const REQUEST_EFFECTS = Object.freeze({
  targetBindingEffect: "NONE",
  bomRevisionEffect: "NONE",
  releaseGateEffect: "NONE",
  purchaseAuthorizationEffect: "NONE",
  recordStateEffect: "NONE_OWNER_RECORD_UNCHANGED",
});

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameValue(left, right) {
  return stableJson(left) === stableJson(right);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function fold(value) {
  return value.toLocaleUpperCase("en-US");
}

function canonicalRelativePath(value, label, { allowParents = false } = {}) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty relative path`);
  if (value.includes("\0")) fail(`${label} contains a NUL byte`);
  const slashValue = value.replaceAll("\\", "/");
  if (slashValue.startsWith("/") || /^[A-Za-z]:\//.test(slashValue) || slashValue.startsWith("//")) {
    fail(`${label} must not be absolute: ${value}`);
  }
  const segments = slashValue.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment.includes("\0"))) {
    fail(`${label} contains an empty or dot segment: ${value}`);
  }
  if (!allowParents && segments.includes("..")) fail(`${label} contains a parent segment: ${value}`);
  const normalized = path.posix.normalize(slashValue);
  if (normalized !== slashValue) fail(`${label} is not normalized: ${value}`);
  if (!allowParents && normalized.split("/").includes("..")) fail(`${label} escapes its root: ${value}`);
  return normalized;
}

function resolveRepositoryRelative(root, relative, label) {
  const normalized = canonicalRelativePath(relative, label);
  const absolute = path.resolve(root, ...normalized.split("/"));
  if (!isInside(path.resolve(root), absolute)) fail(`${label} escapes the repository: ${relative}`);
  return { relative: normalized, absolute };
}

function resolveSourcePath(root, requestDirectory, sourcePath) {
  const normalized = canonicalRelativePath(sourcePath, "sourcePath", { allowParents: true });
  const absolute = path.resolve(requestDirectory, ...normalized.split("/"));
  if (!isInside(path.resolve(root), absolute)) fail(`sourcePath escapes the repository: ${sourcePath}`);
  return { normalized, absolute };
}

function validTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validSourceUrl(value) {
  if (value === null) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !/[\u0000\s]/.test(value);
  } catch {
    return false;
  }
}

async function readJson(file) {
  const bytes = await readFile(file);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`invalid JSON in ${file}: ${error.message}`);
  }
  return { bytes, document };
}

function sameStatIdentity(left, right) {
  const fields = ["dev", "ino", "mode", "size", "mtimeMs"];
  return fields.every((field) => left[field] === right[field]);
}

function isLinkLike(info) {
  return info.isSymbolicLink();
}

async function requirePlainPathChain(root, target, label) {
  const rootAbsolute = path.resolve(root);
  const targetAbsolute = path.resolve(target);
  if (!isInside(rootAbsolute, targetAbsolute)) fail(`${label} escapes repository: ${target}`);
  const relative = path.relative(rootAbsolute, targetAbsolute);
  let cursor = rootAbsolute;
  for (const segment of relative ? relative.split(path.sep) : []) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor);
    if (isLinkLike(info)) fail(`${label} contains a symlink or reparse point: ${cursor}`);
    if (!info.isDirectory() && cursor !== targetAbsolute) fail(`${label} path segment is not a directory: ${cursor}`);
  }
}

async function requirePlainFile(file, label, root = null) {
  if (root !== null) await requirePlainPathChain(root, path.dirname(file), `${label} parent path`);
  const info = await lstat(file);
  if (!info.isFile() || isLinkLike(info)) fail(`${label} must be a regular non-symlink file: ${file}`);
  return info;
}

async function requirePlainDirectory(directory, label, root = null) {
  if (root !== null) await requirePlainPathChain(root, directory, label);
  const info = await lstat(directory);
  if (!info.isDirectory() || isLinkLike(info)) fail(`${label} must be a regular non-symlink directory: ${directory}`);
  return info;
}

async function stablePlainBytes(file, label, { root = null, allowEmpty = false } = {}) {
  const before = await requirePlainFile(file, label, root);
  const bytes = await readFile(file);
  const after = await requirePlainFile(file, `${label} readback`, root);
  if (!sameStatIdentity(before, after) || bytes.length !== after.size) {
    fail(`${label} changed while being read: ${file}`);
  }
  if (!allowEmpty && bytes.length === 0) fail(`${label} is empty: ${file}`);
  return { bytes, info: after, identity: { bytes: bytes.length, sha256: sha256(bytes) } };
}

async function fileIdentity(file, relativePath, root = null) {
  const result = await stablePlainBytes(file, "file identity", { root });
  return { path: relativePath, bytes: result.identity.bytes, sha256: result.identity.sha256 };
}

async function loadContracts(root = SCRIPT_ROOT) {
  const contractRoot = path.join(root, CONTRACT_ROOT);
  const [profileSchema, requestSchema, indexSchema, profile] = await Promise.all([
    readJson(path.join(contractRoot, "profile.schema.json")),
    readJson(path.join(contractRoot, "capture-request.schema.json")),
    readJson(path.join(contractRoot, "capture-index.schema.json")),
    readJson(path.join(contractRoot, "profile.json")),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateProfile = ajv.compile(profileSchema.document);
  const validateRequest = ajv.compile(requestSchema.document);
  const validateIndex = ajv.compile(indexSchema.document);
  if (!validateProfile(profile.document)) {
    fail(`evidence capture profile schema failure: ${ajv.errorsText(validateProfile.errors)}`);
  }
  return {
    profile: profile.document,
    profileBytes: profile.bytes,
    validateRequest,
    validateIndex,
    ajv,
  };
}

function laneById(profile, laneId) {
  const lanes = profile.lanes.filter((lane) => lane.id === laneId);
  if (lanes.length !== 1) fail(`profile lane is missing or duplicated: ${laneId}`);
  return lanes[0];
}

function expectedRequestPath(workspaceRoot, captureId) {
  return `${workspaceRoot}/capture-request.${captureId}.json`;
}

function expectedIndexPath(workspaceRoot, captureId) {
  return `${workspaceRoot}/capture-index.${captureId}.json`;
}

function validateRequestSemantics(request, lane) {
  if (!validTimestamp(request.preparedAt)) fail(`preparedAt must be an RFC3339 timestamp with timezone: ${request.preparedAt}`);
  if (canonicalRelativePath(request.workspaceRoot, "workspaceRoot") !== request.workspaceRoot) {
    fail(`workspaceRoot is not normalized: ${request.workspaceRoot}`);
  }
  if (!new RegExp(lane.workspacePattern).test(request.workspaceRoot)) {
    fail(`${request.lane} workspaceRoot does not match the lane contract: ${request.workspaceRoot}`);
  }
  if (!sameValue(request.effects, REQUEST_EFFECTS)) fail("request effects differ from the non-promoting contract");
  const ids = new Set();
  const destinationNames = new Set();
  const sourcePaths = new Set();
  for (const artifact of request.artifacts) {
    const foldedId = fold(artifact.id);
    const foldedName = fold(artifact.destinationName);
    const normalizedSource = canonicalRelativePath(artifact.sourcePath, `${artifact.id} sourcePath`, { allowParents: true });
    const foldedSource = fold(normalizedSource);
    if (ids.has(foldedId)) fail(`duplicate artifact id under case-insensitive comparison: ${artifact.id}`);
    if (destinationNames.has(foldedName)) fail(`duplicate destination name under case-insensitive comparison: ${artifact.destinationName}`);
    if (sourcePaths.has(foldedSource)) fail(`${artifact.id} reuses a sourcePath already present in the request`);
    ids.add(foldedId);
    destinationNames.add(foldedName);
    sourcePaths.add(foldedSource);
    if (artifact.destinationName.includes("/") || artifact.destinationName.includes("\\") || artifact.destinationName === "." || artifact.destinationName === "..") {
      fail(`${artifact.id} destinationName must be one normalized raw filename`);
    }
    if (!validTimestamp(artifact.capturedAt)) fail(`${artifact.id} capturedAt must be an RFC3339 timestamp with timezone`);
    if (!validSourceUrl(artifact.sourceUrl)) fail(`${artifact.id} sourceUrl must be null or an HTTP(S) URL`);
    if (artifact.route.kind !== lane.routeKind) {
      fail(`${artifact.id} route kind ${artifact.route.kind} does not match lane ${request.lane}`);
    }
  }
}

function ownerArtifactFragment(laneId, artifact, identity) {
  if (laneId === "BENCHMARK_SELLER") {
    return {
      id: artifact.id,
      kind: artifact.route.artifactKind,
      provenance: artifact.route.provenance,
      path: identity.path,
      bytes: identity.bytes,
      sha256: identity.sha256,
      mediaType: artifact.mediaType,
      capturedAt: artifact.capturedAt,
      sourceUrl: artifact.sourceUrl,
    };
  }
  return {
    id: artifact.id,
    path: identity.path,
    bytes: identity.bytes,
    sha256: identity.sha256,
    mediaType: artifact.mediaType,
  };
}

function exactReferenceSet(items, field, label) {
  const values = (items ?? []).map((item) => item?.[field]);
  if (values.some((value) => typeof value !== "string" || value.length === 0)) fail(`${label} contains an invalid reference identity`);
  const folded = values.map(fold);
  if (new Set(folded).size !== folded.length) fail(`${label} contains duplicate identities`);
  return new Set(values);
}

function validateOwnerRouting(request, owner) {
  if (request.lane === "LAB_REGISTRY") {
    const instruments = owner.instruments ?? [];
    const instrumentIds = instruments.map((instrument) => instrument?.id);
    if (new Set(instrumentIds.map((value) => fold(String(value)))).size !== instrumentIds.length) {
      fail("lab owner draft has duplicate instrument identities");
    }
    for (const artifact of request.artifacts) {
      const instrumentMatches = instruments.filter((instrument) => instrument?.id === artifact.route.instrumentId);
      if (instrumentMatches.length !== 1) fail(`${artifact.id} names unknown or duplicated lab instrument ${artifact.route.instrumentId}`);
      const assets = instrumentMatches[0].assets ?? [];
      const assetIds = assets.map((asset) => asset?.assetId);
      if (new Set(assetIds.map((value) => fold(String(value)))).size !== assetIds.length) {
        fail(`${artifact.id} lab instrument has duplicate asset identities`);
      }
      const assetMatches = assets.filter((asset) => asset?.assetId === artifact.route.assetId);
      if (assetMatches.length !== 1) {
        fail(`${artifact.id} asset ${artifact.route.assetId} is missing or duplicated under ${artifact.route.instrumentId}`);
      }
    }
  }
  if (request.lane === "VENDOR_RESPONSE") {
    const tupleIds = new Set(["BOARD_MPN", "PCB_REV", "HEAD_MPN", "HEAD_REV", "FW_VERSION"]);
    const ownerTupleIds = new Set(Object.keys(owner.identityTuple ?? {}));
    if (ownerTupleIds.size !== tupleIds.size || !sameValue([...ownerTupleIds].sort(), [...tupleIds].sort())) {
      fail("vendor response owner identityTuple does not expose the closed five-field tuple");
    }
    const answerIds = exactReferenceSet(owner.answers, "id", "vendor response answers");
    const attachmentIds = exactReferenceSet(owner.attachments, "id", "vendor response attachments");
    const sampleIds = exactReferenceSet(owner.sampleOffers, "sampleId", "vendor response sample offers");
    const allowedByRole = {
      IDENTITY_TUPLE: tupleIds,
      ANSWER: answerIds,
      ATTACHMENT: attachmentIds,
      SAMPLE_OFFER: sampleIds,
    };
    for (const artifact of request.artifacts) {
      const allowed = allowedByRole[artifact.route.role];
      if (allowed && artifact.route.referenceIds.length === 0) {
        fail(`${artifact.id} ${artifact.route.role} requires at least one explicit referenceId`);
      }
      if (allowed && artifact.route.referenceIds.some((id) => !allowed.has(id))) {
        fail(`${artifact.id} has a referenceId outside ${artifact.route.role}`);
      }
      if (!allowed && artifact.route.referenceIds.length > 0) {
        fail(`${artifact.id} role ${artifact.route.role} must not claim owner reference IDs`);
      }
    }
  }
}

export async function preflightWorkspace({ root = SCRIPT_ROOT, laneId, workspaceRoot }) {
  const contracts = await loadContracts(root);
  const lane = laneById(contracts.profile, laneId);
  if (canonicalRelativePath(workspaceRoot, "workspaceRoot") !== workspaceRoot) {
    fail(`workspaceRoot is not normalized: ${workspaceRoot}`);
  }
  if (!new RegExp(lane.workspacePattern).test(workspaceRoot)) {
    fail(`${laneId} workspace does not match the profile: ${workspaceRoot}`);
  }
  const workspace = resolveRepositoryRelative(root, workspaceRoot, "workspaceRoot");
  const rootReal = await realpath(root);
  await requirePlainDirectory(workspace.absolute, "workspace", root);
  const workspaceReal = await realpath(workspace.absolute);
  if (!isInside(rootReal, workspaceReal)) fail(`workspace real path escapes repository: ${workspaceRoot}`);
  const rawAbsolute = path.join(workspace.absolute, "raw");
  await requirePlainDirectory(rawAbsolute, "raw evidence directory", root);
  const rawReal = await realpath(rawAbsolute);
  if (!isInside(workspaceReal, rawReal)) fail(`raw evidence directory escapes workspace: ${workspaceRoot}`);
  const ownerAbsolute = path.join(workspace.absolute, lane.ownerFile);
  await requirePlainFile(ownerAbsolute, "owner draft", root);
  const ownerRead = await readJson(ownerAbsolute);
  const identityValue = ownerRead.document?.[lane.ownerIdentityField];
  if (ownerRead.document?.recordKind !== lane.ownerRecordKind) {
    fail(`${laneId} owner recordKind mismatch: ${ownerRead.document?.recordKind}`);
  }
  if (identityValue !== path.basename(workspace.absolute)) {
    fail(`${laneId} owner identity ${identityValue} does not match workspace ${path.basename(workspace.absolute)}`);
  }
  if (laneId === "VENDOR_RESPONSE") {
    const expectedCandidate = path.basename(path.dirname(workspace.absolute));
    if (ownerRead.document?.candidateId !== expectedCandidate) {
      fail(`vendor response candidateId ${ownerRead.document?.candidateId} does not match workspace parent ${expectedCandidate}`);
    }
  }
  return {
    lane,
    workspace,
    rootReal,
    workspaceReal,
    rawAbsolute,
    rawReal,
    ownerAbsolute,
    owner: ownerRead.document,
    ownerIdentity: {
      path: `${workspace.relative}/${lane.ownerFile}`,
      bytes: ownerRead.bytes.length,
      sha256: sha256(ownerRead.bytes),
      identityField: lane.ownerIdentityField,
      identityValue,
      recordKind: ownerRead.document.recordKind,
    },
    profile: contracts.profile,
    contracts,
  };
}

async function loadCaptureContext({ root = SCRIPT_ROOT, requestPath }) {
  const requestResolved = resolveRepositoryRelative(root, requestPath, "request path");
  await requirePlainFile(requestResolved.absolute, "capture request", root);
  const requestRead = await readJson(requestResolved.absolute);
  const contracts = await loadContracts(root);
  if (!contracts.validateRequest(requestRead.document)) {
    fail(`capture request schema failure: ${contracts.ajv.errorsText(contracts.validateRequest.errors)}`);
  }
  const request = requestRead.document;
  const lane = laneById(contracts.profile, request.lane);
  validateRequestSemantics(request, lane);
  const exactRequestPath = expectedRequestPath(request.workspaceRoot, request.captureId);
  if (requestResolved.relative !== exactRequestPath) {
    fail(`capture request must be stored at ${exactRequestPath}`);
  }
  const preflight = await preflightWorkspace({ root, laneId: request.lane, workspaceRoot: request.workspaceRoot });
  validateOwnerRouting(request, preflight.owner);
  return {
    root: path.resolve(root),
    requestPath: requestResolved,
    requestDirectory: path.dirname(requestResolved.absolute),
    request,
    requestIdentity: {
      path: requestResolved.relative,
      bytes: requestRead.bytes.length,
      sha256: sha256(requestRead.bytes),
    },
    ...preflight,
  };
}

function destinationFor(context, artifact) {
  const destinationName = canonicalRelativePath(artifact.destinationName, `${artifact.id} destinationName`);
  if (destinationName.includes("/")) fail(`${artifact.id} destinationName must be one normalized raw filename`);
  const absolute = path.join(context.rawAbsolute, destinationName);
  if (path.dirname(absolute) !== context.rawAbsolute || !isInside(context.rawAbsolute, absolute)) {
    fail(`${artifact.id} destination escapes raw root`);
  }
  const relative = `${context.workspace.relative}/raw/${destinationName}`;
  if (!new RegExp(context.lane.rawPathPattern).test(relative)) {
    fail(`${artifact.id} destination does not match owner path contract: ${relative}`);
  }
  return { absolute, relative, name: destinationName };
}

async function pathExists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function rawNameSet(rawAbsolute) {
  const entries = await readdir(rawAbsolute, { withFileTypes: true });
  return new Set(entries.map((entry) => fold(entry.name)));
}

async function assertStableInputs(context, phase) {
  const ownerAfter = await fileIdentity(context.ownerAbsolute, context.ownerIdentity.path, context.root);
  if (ownerAfter.bytes !== context.ownerIdentity.bytes || ownerAfter.sha256 !== context.ownerIdentity.sha256) {
    fail(`owner record changed during capture (${phase})`);
  }
  const requestAfter = await fileIdentity(context.requestPath.absolute, context.requestIdentity.path, context.root);
  if (requestAfter.bytes !== context.requestIdentity.bytes || requestAfter.sha256 !== context.requestIdentity.sha256) {
    fail(`capture request changed during capture (${phase})`);
  }
}

async function checkDestinationReadbacks(promoted) {
  for (const item of promoted) {
    const readback = await stablePlainBytes(item.destination.absolute, `${item.artifact.id} destination readback`, { allowEmpty: false });
    if (readback.identity.bytes !== item.identity.bytes || readback.identity.sha256 !== item.identity.sha256) {
      fail(`${item.artifact.id} destination changed after promotion`);
    }
  }
}

function buildIndex(context, capturedArtifacts) {
  return {
    schemaVersion: 1,
    recordKind: "hardware-raw-evidence-capture-index",
    profileId: context.profile.profileId,
    captureId: context.request.captureId,
    lane: context.request.lane,
    workspaceRoot: context.request.workspaceRoot,
    request: context.requestIdentity,
    ownerRecord: context.ownerIdentity,
    artifacts: capturedArtifacts.map(({ artifact, identity }) => ({
      id: artifact.id,
      path: identity.path,
      bytes: identity.bytes,
      sha256: identity.sha256,
      mediaType: artifact.mediaType,
      capturedAt: artifact.capturedAt,
      sourceUrl: artifact.sourceUrl,
      route: artifact.route,
      ownerFragment: ownerArtifactFragment(context.request.lane, artifact, identity),
    })),
    effects: context.profile.effects,
  };
}

async function removePromotedIfOwned(promoted) {
  const residuals = [];
  for (const item of [...promoted].reverse()) {
    try {
      const current = await stablePlainBytes(item.destination.absolute, "rollback destination");
      if (current.identity.bytes === item.identity.bytes && current.identity.sha256 === item.identity.sha256) {
        await unlink(item.destination.absolute);
      } else {
        residuals.push(item.destination.relative);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") residuals.push(item.destination.relative);
    }
  }
  return residuals;
}

async function removeIndexIfOwned(indexAbsolute, expectedBytes) {
  if (!(await pathExists(indexAbsolute))) return false;
  try {
    const current = await stablePlainBytes(indexAbsolute, "rollback index");
    if (current.bytes.equals(expectedBytes)) {
      await unlink(indexAbsolute);
      return true;
    }
  } catch {
    // A changed or replaced index is deliberately retained for investigation.
  }
  return false;
}

async function removeStage(context, stageAbsolute) {
  if (!isInside(context.workspace.absolute, stageAbsolute) || path.dirname(stageAbsolute) !== context.workspace.absolute) {
    fail(`stage cleanup target escapes workspace: ${stageAbsolute}`);
  }
  await rm(stageAbsolute, { recursive: true, force: true });
}

export async function captureEvidence({ root = SCRIPT_ROOT, requestPath, testHooks = {} }) {
  const context = await loadCaptureContext({ root, requestPath });
  const indexRelative = expectedIndexPath(context.request.workspaceRoot, context.request.captureId);
  const indexResolved = resolveRepositoryRelative(root, indexRelative, "capture index path");
  if (await pathExists(indexResolved.absolute)) fail(`capture index already exists: ${indexRelative}`);
  const existingNames = await rawNameSet(context.rawAbsolute);
  const planned = [];
  for (const artifact of context.request.artifacts) {
    const destination = destinationFor(context, artifact);
    if (existingNames.has(fold(destination.name))) fail(`${artifact.id} destination already exists: ${destination.relative}`);
    const source = resolveSourcePath(context.root, context.requestDirectory, artifact.sourcePath);
    const sourceBefore = await stablePlainBytes(source.absolute, `${artifact.id} source`, { root: context.root });
    planned.push({
      artifact,
      destination,
      sourceAbsolute: source.absolute,
      sourceBefore: sourceBefore.identity,
    });
  }

  const stageAbsolute = path.join(context.workspace.absolute, `.capture-stage.${context.request.captureId}.${process.pid}`);
  if (await pathExists(stageAbsolute)) fail(`capture stage already exists: ${stageAbsolute}`);
  await mkdir(stageAbsolute, { recursive: false });
  const staged = [];
  const promoted = [];
  let indexBytes = null;
  let indexWritten = false;
  try {
    await assertStableInputs(context, "before-stage");
    for (const item of planned) {
      const stageFile = path.join(stageAbsolute, item.artifact.destinationName);
      await copyFile(item.sourceAbsolute, stageFile, fsConstants.COPYFILE_EXCL);
      const sourceAfter = await stablePlainBytes(item.sourceAbsolute, `${item.artifact.id} source readback`, { root: context.root });
      const stagedCopy = await stablePlainBytes(stageFile, `${item.artifact.id} staged copy`);
      if (!sameValue(item.sourceBefore, sourceAfter.identity) || !sameValue(item.sourceBefore, stagedCopy.identity)) {
        fail(`${item.artifact.id} source changed during capture or staged bytes differ`);
      }
      staged.push({ ...item, stageFile, identity: { path: item.destination.relative, ...stagedCopy.identity } });
    }
    if (typeof testHooks.afterStage === "function") await testHooks.afterStage({ context, staged });
    await assertStableInputs(context, "after-stage");
    await requirePlainDirectory(context.rawAbsolute, "raw evidence directory", context.root);
    const currentNames = await rawNameSet(context.rawAbsolute);
    for (const item of staged) {
      if (currentNames.has(fold(item.destination.name))) fail(`${item.artifact.id} destination appeared during capture`);
    }
    for (const item of staged) {
      // copyFile with COPYFILE_EXCL is the cross-platform exclusive promotion gate;
      // rename() would overwrite a destination created by a concurrent actor.
      await copyFile(item.stageFile, item.destination.absolute, fsConstants.COPYFILE_EXCL);
      promoted.push(item);
      if (typeof testHooks.afterPromote === "function") await testHooks.afterPromote({ context, item, promoted });
    }
    await checkDestinationReadbacks(promoted);
    await assertStableInputs(context, "before-index");
    const index = buildIndex(context, promoted.map((item) => ({ artifact: item.artifact, identity: item.identity })));
    if (!context.contracts.validateIndex(index)) {
      fail(`capture index schema failure: ${context.contracts.ajv.errorsText(context.contracts.validateIndex.errors)}`);
    }
    if (typeof testHooks.beforeIndex === "function") await testHooks.beforeIndex({ context, index, promoted });
    await assertStableInputs(context, "index-commit");
    await checkDestinationReadbacks(promoted);
    indexBytes = jsonBytes(index);
    await writeFile(indexResolved.absolute, indexBytes, { flag: "wx" });
    indexWritten = true;
    if (typeof testHooks.afterIndex === "function") await testHooks.afterIndex({ context, index, promoted });
    await assertStableInputs(context, "after-index");
    await checkDestinationReadbacks(promoted);
    await removeStage(context, stageAbsolute);
    return { index, indexPath: indexRelative };
  } catch (error) {
    if (indexWritten && indexBytes !== null) await removeIndexIfOwned(indexResolved.absolute, indexBytes);
    const residuals = await removePromotedIfOwned(promoted);
    try {
      await removeStage(context, stageAbsolute);
    } catch (cleanupError) {
      error.message = `${error.message}; stage cleanup failed: ${cleanupError.message}`;
    }
    if (residuals.length > 0) {
      error.message = `${error.message}; rollback retained changed destinations: ${residuals.join(", ")}`;
    }
    throw error;
  }
}

export async function checkCapture({ root = SCRIPT_ROOT, requestPath }) {
  const context = await loadCaptureContext({ root, requestPath });
  const indexRelative = expectedIndexPath(context.request.workspaceRoot, context.request.captureId);
  const indexResolved = resolveRepositoryRelative(root, indexRelative, "capture index path");
  await requirePlainFile(indexResolved.absolute, "capture index", root);
  const indexRead = await readJson(indexResolved.absolute);
  if (!context.contracts.validateIndex(indexRead.document)) {
    fail(`capture index schema failure: ${context.contracts.ajv.errorsText(context.contracts.validateIndex.errors)}`);
  }
  const capturedArtifacts = [];
  for (const artifact of context.request.artifacts) {
    const destination = destinationFor(context, artifact);
    const identity = await stablePlainBytes(destination.absolute, `${artifact.id} captured destination`, { root: context.root });
    capturedArtifacts.push({ artifact, identity: { path: destination.relative, ...identity.identity } });
  }
  const expected = buildIndex(context, capturedArtifacts);
  if (!sameValue(indexRead.document, expected)) fail("capture index does not match request, owner, routes, or captured bytes");
  const expectedBytes = jsonBytes(expected);
  if (!indexRead.bytes.equals(expectedBytes)) fail("capture index is not in the canonical pretty-JSON byte form");
  await assertStableInputs(context, "check");
  return {
    captureId: expected.captureId,
    lane: expected.lane,
    artifactCount: expected.artifacts.length,
    indexPath: indexRelative,
    indexBytes: indexRead.bytes.length,
    indexSha256: sha256(indexRead.bytes),
  };
}

function parseArgs(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail(`unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === "preflight") {
    if (!options.lane || !options.workspace) fail("preflight requires --lane and --workspace");
    const result = await preflightWorkspace({ laneId: options.lane, workspaceRoot: options.workspace });
    process.stdout.write(`${JSON.stringify({
      lane: result.lane.id,
      workspaceRoot: result.workspace.relative,
      ownerRecord: result.ownerIdentity,
      rawRoot: `${result.workspace.relative}/raw/`,
      effects: result.profile.effects,
    }, null, 2)}\n`);
    return;
  }
  if (command === "capture") {
    if (!options.request) fail("capture requires --request");
    const result = await captureEvidence({ requestPath: options.request });
    process.stdout.write(`Hardware evidence captured: ${result.index.captureId} (${result.index.artifacts.length} artifacts)\n`);
    process.stdout.write(`Index: ${result.indexPath}\n`);
    return;
  }
  if (command === "check") {
    if (!options.request) fail("check requires --request");
    const result = await checkCapture({ requestPath: options.request });
    process.stdout.write(`Hardware evidence capture check: PASS (${result.artifactCount} artifacts)\n`);
    process.stdout.write(`Index: ${result.indexPath} / ${result.indexBytes} bytes / ${result.indexSha256}\n`);
    return;
  }
  fail("usage: capture-hardware-evidence.mjs <preflight|capture|check> [options]");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
