import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertFamilyExportSemantics,
  collectReferencedFamilyAssets,
  computeFamilyExportId,
} from "../../../contracts/family-export-v1.mjs";
import { isStrictRfc3339 } from "../../../contracts/rfc3339.mjs";
import { parseJsonRejectingDuplicateKeys } from "../../../contracts/strict-json-v1.mjs";
import { AtomicJsonFamilyRepository } from "../../../tools/family-repository/atomic-json-adapter.mjs";
import { assertRepositoryBackup } from "../../../tools/family-repository/repository-core.mjs";

const STAGING_MARKER = ".yimi-family-export-staging";
const STAGING_MARKER_TEXT = "yimi-family-export-staging-v1\n";
const LIMIT_KEYS = [
  "maxManifestBytes",
  "maxBackupBytes",
  "maxAssetBytes",
  "maxTotalAssetBytes",
  "maxAssetEntries",
];

export class FamilyExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FamilyExportError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new FamilyExportError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encodeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function overlaps(left, right) {
  return left === right || inside(left, right) || inside(right, left);
}

function validateLimits(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("EXPORT_LIMITS_INVALID", "an explicit export resource policy is required");
  }
  const limits = {};
  for (const key of LIMIT_KEYS) {
    const value = input[key];
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail("EXPORT_LIMITS_INVALID", `${key} must be a positive safe integer`);
    }
    limits[key] = value;
  }
  return limits;
}

function assertWithinLimit(value, limit, label) {
  if (value > limit) fail("EXPORT_RESOURCE_LIMIT_EXCEEDED", `${label} exceeds the active resource policy`);
}

function assertManifestWithinLimits(manifest, limits) {
  assertWithinLimit(manifest.repositoryBackup.bytes, limits.maxBackupBytes, "repository backup");
  assertWithinLimit(manifest.assets.length, limits.maxAssetEntries, "asset entry count");
  let total = 0n;
  for (const asset of manifest.assets) {
    assertWithinLimit(asset.bytes, limits.maxAssetBytes, `${asset.assetId} bytes`);
    total += BigInt(asset.bytes);
  }
  if (total > BigInt(limits.maxTotalAssetBytes)) {
    fail("EXPORT_RESOURCE_LIMIT_EXCEEDED", "declared asset bytes exceed the active resource policy");
  }
}

async function optionalLstat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertRegularDirectory(target, code, label) {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) fail(code, `${label} must be a regular directory`);
  return realpath(target);
}

function assertDirectChild(root, target, code, label) {
  if (path.dirname(target) !== root || target === root) fail(code, `${label} must be a direct child of its allowed root`);
}

async function readOwnedFile(root, relative, label, { expectedBytes = null, maxBytes }) {
  const candidate = path.resolve(root, ...relative.split("/"));
  if (!inside(root, candidate)) fail("EXPORT_PATH_UNSAFE", `${label} escaped the export root`);
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) fail("EXPORT_PATH_UNSAFE", `${label} must be a regular file`);
  if (expectedBytes !== null && info.size !== expectedBytes) {
    fail("EXPORT_FILE_SIZE_MISMATCH", `${label} file size differs from the manifest before reading`);
  }
  assertWithinLimit(info.size, maxBytes, label);
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!inside(realRoot, realCandidate)) fail("EXPORT_PATH_UNSAFE", `${label} resolved outside the export root`);
  return readFile(realCandidate);
}

const manifestValidatorPromises = new Map();
async function manifestValidator(repoRoot) {
  const root = path.resolve(repoRoot);
  if (!manifestValidatorPromises.has(root)) {
    manifestValidatorPromises.set(root, readFile(
      path.join(root, "hardware/evt0/family-export-v1/family-export-manifest.schema.json"),
      "utf8",
    ).then((text) => {
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      ajv.addFormat("date-time", { type: "string", validate: isStrictRfc3339 });
      return ajv.compile(JSON.parse(text));
    }));
  }
  return manifestValidatorPromises.get(root);
}

async function validateManifest(repoRoot, manifest) {
  const validate = await manifestValidator(repoRoot);
  if (!validate(manifest)) {
    const detail = (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    fail("EXPORT_MANIFEST_INVALID", `family export manifest schema failed: ${detail}`);
  }
  try {
    assertFamilyExportSemantics(manifest);
  } catch (error) {
    fail("EXPORT_IDENTITY_INVALID", error.message);
  }
  return manifest;
}

function assertBackupScope(manifest, backup) {
  if (backup.state.repositoryId !== manifest.repositoryId
    || backup.state.familyLibraryId !== manifest.familyLibraryId
    || backup.state.headRevisionId !== manifest.headRevisionId
    || backup.backupId !== manifest.repositoryBackup.backupId
    || backup.sourceStateSha256 !== manifest.repositoryBackup.sourceStateSha256) {
    fail("EXPORT_SCOPE_MISMATCH", "manifest and repository backup identify different family state");
  }
  if (Date.parse(manifest.createdAt) < Date.parse(backup.createdAt)) {
    fail("EXPORT_SCOPE_MISMATCH", "export packaging time precedes repository backup creation");
  }
}

function assertAssetClosure(manifest, backup) {
  const referenced = collectReferencedFamilyAssets(backup);
  const manifestIdentities = manifest.assets.map(({ assetId, bytes, sha256: digest }) => ({
    assetId,
    bytes,
    sha256: digest,
  }));
  if (JSON.stringify(referenced) !== JSON.stringify(manifestIdentities)) {
    fail("EXPORT_ASSET_CLOSURE_MISMATCH", "manifest assets do not exactly close repository revision references");
  }
  return referenced;
}

async function assertExactExportFileClosure(exportRoot, manifest) {
  const expectedRoot = new Set(["manifest.json", manifest.repositoryBackup.path, "assets"]);
  const rootEntries = await readdir(exportRoot, { withFileTypes: true });
  if (rootEntries.length !== expectedRoot.size
    || rootEntries.some((entry) => !expectedRoot.has(entry.name))
    || rootEntries.some((entry) => entry.isSymbolicLink())
    || rootEntries.some((entry) => entry.name === "assets" ? !entry.isDirectory() : !entry.isFile())) {
    fail("EXPORT_FILE_CLOSURE_MISMATCH", "family export root contains undeclared or unsafe entries");
  }

  const assetsRoot = path.join(exportRoot, "assets");
  const assetsInfo = await lstat(assetsRoot);
  if (!assetsInfo.isDirectory() || assetsInfo.isSymbolicLink()) {
    fail("EXPORT_FILE_CLOSURE_MISMATCH", "family export assets entry must be a regular directory");
  }
  const [realExport, realAssets] = await Promise.all([realpath(exportRoot), realpath(assetsRoot)]);
  if (!inside(realExport, realAssets)) fail("EXPORT_PATH_UNSAFE", "family export assets directory escaped its root");
  const expectedAssets = new Set(manifest.assets.map((asset) => path.basename(asset.path)));
  const assetEntries = await readdir(realAssets, { withFileTypes: true });
  if (assetEntries.length !== expectedAssets.size
    || assetEntries.some((entry) => !expectedAssets.has(entry.name))
    || assetEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    fail("EXPORT_FILE_CLOSURE_MISMATCH", "family export assets contain undeclared or unsafe entries");
  }
  return expectedAssets.size;
}

async function removeOwnedStaging(allowedRoot, staging) {
  const info = await optionalLstat(staging);
  if (!info) return;
  if (!info.isDirectory() || info.isSymbolicLink() || path.dirname(staging) !== allowedRoot) return;
  const [realAllowed, realStaging] = await Promise.all([realpath(allowedRoot), realpath(staging)]);
  if (!inside(realAllowed, realStaging)) return;
  await rm(staging, { recursive: true, force: true });
}

function parseStrictJson(bytes, label, fallbackCode) {
  try {
    return parseJsonRejectingDuplicateKeys(bytes.toString("utf8"), label);
  } catch (error) {
    fail(error?.code ?? fallbackCode, error.message);
  }
}

function uniqueAssetEntriesByPath(manifest) {
  const byPath = new Map();
  for (const asset of manifest.assets) {
    if (!byPath.has(asset.path)) byPath.set(asset.path, asset);
  }
  return [...byPath.values()];
}

function headAssetEntries(inspected) {
  const head = inspected.backup.state.revisions.find(
    (revision) => revision.revisionId === inspected.manifest.headRevisionId,
  );
  if (!head) fail("EXPORT_RESTORE_MISMATCH", "repository backup does not contain its declared head revision");
  const references = collectReferencedFamilyAssets({ state: { revisions: [head] } });
  return references.map((reference) => {
    const entry = inspected.manifest.assets.find((asset) => asset.assetId === reference.assetId
      && asset.sha256 === reference.sha256
      && asset.bytes === reference.bytes);
    if (!entry) fail("EXPORT_ASSET_CLOSURE_MISMATCH", `${reference.assetId} head asset is absent from the export`);
    return entry;
  });
}

export async function exportCompleteFamily({
  repoRoot,
  repository,
  assetReader,
  allowedOutputRoot,
  outputDirectory,
  createdAt,
  limits: inputLimits,
}) {
  if (typeof repository?.createBackup !== "function") fail("EXPORT_PORT_INVALID", "FamilyRepository backup port is required");
  if (typeof assetReader !== "function") fail("EXPORT_PORT_INVALID", "assetReader port is required");
  if (!isStrictRfc3339(createdAt)) fail("EXPORT_TIME_INVALID", "export createdAt must be strict RFC3339");
  const limits = validateLimits(inputLimits);
  const allowed = path.resolve(allowedOutputRoot);
  const output = path.resolve(outputDirectory);
  const realAllowed = await assertRegularDirectory(allowed, "EXPORT_ROOT_UNSAFE", "allowed output root");
  assertDirectChild(allowed, output, "EXPORT_ROOT_UNSAFE", "export output");
  if (await optionalLstat(output)) fail("EXPORT_OUTPUT_EXISTS", "export output already exists");

  const backupBytes = Buffer.from(await repository.createBackup({ createdAt }));
  assertWithinLimit(backupBytes.length, limits.maxBackupBytes, "repository backup");
  const backup = parseStrictJson(backupBytes, "family repository backup", "EXPORT_BACKUP_INVALID");
  await assertRepositoryBackup(backup, "EXPORT_BACKUP_INVALID");
  if (backup.state.familyLibraryId === null || backup.state.headRevisionId === null) {
    fail("EXPORT_EMPTY_FAMILY", "complete export requires a non-empty family repository");
  }
  const references = collectReferencedFamilyAssets(backup);
  assertWithinLimit(references.length, limits.maxAssetEntries, "asset entry count");
  let declaredTotal = 0n;
  for (const reference of references) {
    assertWithinLimit(reference.bytes, limits.maxAssetBytes, `${reference.assetId} bytes`);
    declaredTotal += BigInt(reference.bytes);
  }
  if (declaredTotal > BigInt(limits.maxTotalAssetBytes)) {
    fail("EXPORT_RESOURCE_LIMIT_EXCEEDED", "referenced asset bytes exceed the active resource policy");
  }

  const staging = `${output}.tmp-${process.pid}-${randomUUID()}`;
  assertDirectChild(allowed, staging, "EXPORT_ROOT_UNSAFE", "export staging output");
  let created = false;
  try {
    await mkdir(staging);
    created = true;
    const realStaging = await realpath(staging);
    if (!inside(realAllowed, realStaging)) fail("EXPORT_ROOT_UNSAFE", "export staging resolved outside allowed root");
    await writeFile(path.join(staging, STAGING_MARKER), STAGING_MARKER_TEXT, { encoding: "utf8", flag: "wx" });
    await mkdir(path.join(staging, "assets"));
    await writeFile(path.join(staging, "repository-backup.json"), backupBytes, { flag: "wx" });

    const writtenDigests = new Set();
    const assets = [];
    for (const reference of references) {
      const bytes = Buffer.from(await assetReader({ ...reference }));
      const digest = sha256(bytes);
      if (bytes.length !== reference.bytes || digest !== reference.sha256) {
        fail("EXPORT_ASSET_BYTES_MISMATCH", `${reference.assetId} bytes differ from FamilyRevision identity`);
      }
      if (!writtenDigests.has(digest)) {
        await writeFile(path.join(staging, "assets", `${digest}.bin`), bytes, { flag: "wx" });
        writtenDigests.add(digest);
      }
      assets.push({
        assetId: reference.assetId,
        path: `assets/${digest}.bin`,
        bytes: bytes.length,
        sha256: digest,
      });
    }
    const manifest = {
      schemaVersion: 1,
      profile: "family-export-v1",
      exportId: `family-export:sha256:${"0".repeat(64)}`,
      createdAt,
      repositoryId: backup.state.repositoryId,
      familyLibraryId: backup.state.familyLibraryId,
      headRevisionId: backup.state.headRevisionId,
      repositoryBackup: {
        path: "repository-backup.json",
        backupId: backup.backupId,
        sourceStateSha256: backup.sourceStateSha256,
        bytes: backupBytes.length,
        sha256: sha256(backupBytes),
      },
      assets,
    };
    manifest.exportId = computeFamilyExportId(manifest);
    await validateManifest(repoRoot, manifest);
    assertManifestWithinLimits(manifest, limits);
    assertBackupScope(manifest, backup);
    assertAssetClosure(manifest, backup);
    const manifestBytes = encodeJson(manifest);
    assertWithinLimit(manifestBytes.length, limits.maxManifestBytes, "family export manifest");
    await writeFile(path.join(staging, "manifest.json"), manifestBytes, { flag: "wx" });
    await unlink(path.join(staging, STAGING_MARKER));
    await assertExactExportFileClosure(staging, manifest);
    await rename(staging, output);
    created = false;
    return structuredClone(manifest);
  } finally {
    if (created) await removeOwnedStaging(allowed, staging);
  }
}

export async function inspectCompleteFamilyExport({ repoRoot, exportDirectory, limits: inputLimits }) {
  const limits = validateLimits(inputLimits);
  const exportRoot = path.resolve(exportDirectory);
  await assertRegularDirectory(exportRoot, "EXPORT_ROOT_UNSAFE", "family export root");
  const manifestBytes = await readOwnedFile(exportRoot, "manifest.json", "family export manifest", {
    maxBytes: limits.maxManifestBytes,
  });
  const manifest = parseStrictJson(manifestBytes, "family export manifest", "EXPORT_MANIFEST_INVALID");
  await validateManifest(repoRoot, manifest);
  assertManifestWithinLimits(manifest, limits);
  const assetBlobCount = await assertExactExportFileClosure(exportRoot, manifest);
  const backupBytes = await readOwnedFile(exportRoot, manifest.repositoryBackup.path, "repository backup", {
    expectedBytes: manifest.repositoryBackup.bytes,
    maxBytes: limits.maxBackupBytes,
  });
  if (sha256(backupBytes) !== manifest.repositoryBackup.sha256) {
    fail("EXPORT_BACKUP_BYTES_MISMATCH", "repository backup bytes differ from export manifest");
  }
  const backup = parseStrictJson(backupBytes, "family repository backup", "EXPORT_BACKUP_INVALID");
  await assertRepositoryBackup(backup, "EXPORT_BACKUP_INVALID");
  assertBackupScope(manifest, backup);
  assertAssetClosure(manifest, backup);

  for (const asset of uniqueAssetEntriesByPath(manifest)) {
    const bytes = await readOwnedFile(exportRoot, asset.path, asset.assetId, {
      expectedBytes: asset.bytes,
      maxBytes: limits.maxAssetBytes,
    });
    if (sha256(bytes) !== asset.sha256) {
      fail("EXPORT_ASSET_BYTES_MISMATCH", `${asset.assetId} bytes differ from export manifest`);
    }
  }
  return {
    manifest: structuredClone(manifest),
    backup,
    backupBytes,
    assetBlobCount,
  };
}

export async function restoreCompleteFamily({
  repoRoot,
  exportDirectory,
  allowedDestinationRoot,
  destinationDirectory,
  operationId,
  replicaInstanceId,
  restoredAt,
  limits: inputLimits,
}) {
  if (!isStrictRfc3339(restoredAt)) fail("EXPORT_TIME_INVALID", "restore timestamp must be strict RFC3339");
  const limits = validateLimits(inputLimits);
  const exportRoot = path.resolve(exportDirectory);
  const allowed = path.resolve(allowedDestinationRoot);
  const destination = path.resolve(destinationDirectory);
  const [realExport, realAllowed] = await Promise.all([
    assertRegularDirectory(exportRoot, "EXPORT_ROOT_UNSAFE", "family export root"),
    assertRegularDirectory(allowed, "EXPORT_ROOT_UNSAFE", "allowed destination root"),
  ]);
  assertDirectChild(allowed, destination, "EXPORT_ROOT_UNSAFE", "restore destination");
  const realDestination = path.join(realAllowed, path.basename(destination));
  if (overlaps(realExport, realDestination) || realAllowed === realExport || inside(realExport, realAllowed)) {
    fail("EXPORT_ROOT_OVERLAP", "restore destination must not overlap or mutate its source export");
  }
  if (await optionalLstat(destination)) fail("EXPORT_OUTPUT_EXISTS", "restore destination already exists");
  const inspected = await inspectCompleteFamilyExport({ repoRoot, exportDirectory: realExport, limits });

  const staging = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  assertDirectChild(allowed, staging, "EXPORT_ROOT_UNSAFE", "restore staging output");
  let created = false;
  let stagedState;
  try {
    await mkdir(staging);
    created = true;
    const realStaging = await realpath(staging);
    if (!inside(realAllowed, realStaging)) fail("EXPORT_ROOT_UNSAFE", "restore staging resolved outside allowed root");
    await writeFile(path.join(staging, STAGING_MARKER), STAGING_MARKER_TEXT, { encoding: "utf8", flag: "wx" });
    const repositoryRoot = path.join(staging, "repository");
    const assetVaultRoot = path.join(staging, "asset-vault");
    await Promise.all([mkdir(repositoryRoot), mkdir(assetVaultRoot)]);
    const stagedRepository = new AtomicJsonFamilyRepository({
      repositoryId: inspected.manifest.repositoryId,
      repositoryRoot,
      allowedRoot: staging,
    });
    await stagedRepository.initialize();
    await stagedRepository.restorePortable({
      operationId,
      replicaInstanceId,
      backupBytes: inspected.backupBytes,
      expectedHeadRevisionId: null,
      at: restoredAt,
    });

    for (const asset of uniqueAssetEntriesByPath(inspected.manifest)) {
      const bytes = await readOwnedFile(realExport, asset.path, asset.assetId, {
        expectedBytes: asset.bytes,
        maxBytes: limits.maxAssetBytes,
      });
      await writeFile(path.join(assetVaultRoot, path.basename(asset.path)), bytes, { flag: "wx" });
    }
    await writeFile(path.join(staging, "source-manifest.json"), encodeJson(inspected.manifest), { flag: "wx" });

    stagedState = await stagedRepository.open();
    const stagedOutbox = await stagedRepository.readOutbox();
    if (stagedState.headRevisionId !== inspected.manifest.headRevisionId
      || stagedOutbox.epoch === inspected.backup.state.outboxEpoch
      || stagedOutbox.events.length !== 1
      || stagedOutbox.events[0]?.sequence !== "1") {
      fail("EXPORT_RESTORE_MISMATCH", "portable restore head or replica epoch differs from its contract");
    }
    const expectedVaultFiles = new Set(uniqueAssetEntriesByPath(inspected.manifest).map((asset) => path.basename(asset.path)));
    const vaultEntries = await readdir(assetVaultRoot, { withFileTypes: true });
    if (vaultEntries.length !== expectedVaultFiles.size
      || vaultEntries.some((entry) => !expectedVaultFiles.has(entry.name) || !entry.isFile() || entry.isSymbolicLink())) {
      fail("EXPORT_RESTORE_MISMATCH", "restored asset vault file closure differs from the export");
    }
    await unlink(path.join(staging, STAGING_MARKER));
    await rename(staging, destination);
    created = false;
  } finally {
    if (created) await removeOwnedStaging(allowed, staging);
  }

  const repository = new AtomicJsonFamilyRepository({
    repositoryId: inspected.manifest.repositoryId,
    repositoryRoot: path.join(destination, "repository"),
    allowedRoot: destination,
  });
  const identityPathEntries = inspected.manifest.assets.map((asset) => [
    `${asset.assetId}@${asset.sha256}`,
    path.join(destination, "asset-vault", path.basename(asset.path)),
  ]);
  const headEntries = headAssetEntries(inspected);
  const headCounts = new Map();
  for (const asset of headEntries) headCounts.set(asset.assetId, (headCounts.get(asset.assetId) ?? 0) + 1);
  const assetPathById = Object.fromEntries(headEntries
    .filter((asset) => headCounts.get(asset.assetId) === 1)
    .map((asset) => [asset.assetId, path.join(destination, "asset-vault", path.basename(asset.path))]));
  return {
    manifest: inspected.manifest,
    repository,
    repositoryState: stagedState,
    assetPathById,
    assetPathByIdentity: Object.fromEntries(identityPathEntries),
  };
}
