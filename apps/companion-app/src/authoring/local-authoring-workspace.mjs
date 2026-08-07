import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";

const PORTABLE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)(?!.*\/$)[A-Za-z0-9._/-]+$/u;

export class LocalAuthoringWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LocalAuthoringWorkspaceError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new LocalAuthoringWorkspaceError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sourcePathFor(sourcePathByAssetId, assetId) {
  const value = sourcePathByAssetId?.get?.(assetId) ?? sourcePathByAssetId?.[assetId] ?? null;
  assert(typeof value === "string" && value.length > 0,
    "AUTHORING_WORKSPACE_SOURCE_MISSING", `${assetId} has no materialization source`, { assetId });
  return path.resolve(value);
}

function workspacePath(root, portablePath, label) {
  assert(PORTABLE_PATH.test(portablePath ?? ""),
    "AUTHORING_WORKSPACE_PATH_INVALID", `${label} path is not portable`, { path: portablePath });
  const target = path.resolve(root, ...portablePath.split("/"));
  assert(inside(root, target),
    "AUTHORING_WORKSPACE_PATH_INVALID", `${label} escaped the workspace`, { path: portablePath });
  return target;
}

async function readStableAsset({ asset, sourcePath }) {
  let pathInfo;
  try {
    pathInfo = await lstat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("AUTHORING_WORKSPACE_SOURCE_MISSING", `${asset.assetId} source is missing`, { assetId: asset.assetId });
    }
    throw error;
  }
  assert(pathInfo.isFile() && !pathInfo.isSymbolicLink(),
    "AUTHORING_WORKSPACE_SOURCE_INVALID", `${asset.assetId} source is not a regular file`, { assetId: asset.assetId });
  assert(pathInfo.size === asset.bytes,
    "AUTHORING_WORKSPACE_ASSET_MISMATCH", `${asset.assetId} source byte count differs from BuildPlan`, {
      assetId: asset.assetId,
      expected: asset.bytes,
      actual: pathInfo.size,
    });

  const handle = await open(sourcePath, "r");
  try {
    const before = await handle.stat();
    assert(before.isFile() && before.size === pathInfo.size,
      "AUTHORING_WORKSPACE_SOURCE_CHANGED", `${asset.assetId} source changed before materialization`);
    const bytes = Buffer.from(await handle.readFile());
    const after = await handle.stat();
    assert(after.isFile() && after.size === before.size && after.mtimeMs === before.mtimeMs,
      "AUTHORING_WORKSPACE_SOURCE_CHANGED", `${asset.assetId} source changed during materialization`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert(bytes.length === asset.bytes && digest === asset.sha256,
      "AUTHORING_WORKSPACE_ASSET_MISMATCH", `${asset.assetId} source differs from BuildPlan identity`, {
        assetId: asset.assetId,
        expectedBytes: asset.bytes,
        actualBytes: bytes.length,
        expectedSha256: asset.sha256,
        actualSha256: digest,
      });
    return { bytes, digest };
  } finally {
    await handle.close();
  }
}

/**
 * Materialize a BuildPlan into a new local compiler workspace. The caller owns
 * source selection; this adapter owns path containment, byte/hash verification,
 * exclusive writes, and atomic publication of the complete workspace.
 */
export async function materializeBuildPlanWorkspace({
  workspaceRoot,
  buildPlan,
  projectedDraft,
  sourcePathByAssetId,
}) {
  assert(typeof workspaceRoot === "string" && path.isAbsolute(workspaceRoot),
    "AUTHORING_WORKSPACE_ROOT_INVALID", "authoring workspaceRoot must be absolute");
  assert(buildPlan?.expectedProjection?.sourceSha256 === canonicalSha256(projectedDraft).sha256,
    "AUTHORING_WORKSPACE_PROJECTION_MISMATCH", "projected draft differs from BuildPlan identity");
  assert(Array.isArray(buildPlan?.assetCatalog?.assets),
    "AUTHORING_WORKSPACE_PLAN_INVALID", "BuildPlan asset catalog is missing");

  const workspace = path.resolve(workspaceRoot);
  const parent = path.dirname(workspace);
  const parentInfo = await lstat(parent);
  assert(parentInfo.isDirectory() && !parentInfo.isSymbolicLink(),
    "AUTHORING_WORKSPACE_ROOT_INVALID", "authoring workspace parent must be a regular directory");
  const staging = `${workspace}.tmp-${process.pid}-${randomUUID()}`;
  assert(inside(parent, staging),
    "AUTHORING_WORKSPACE_ROOT_INVALID", "authoring staging path escaped its parent");

  const occupiedPaths = new Set(["draft.json"]);
  for (const asset of buildPlan.assetCatalog.assets) {
    assert(asset && typeof asset.assetId === "string" && Number.isSafeInteger(asset.bytes)
      && asset.bytes > 0 && /^[a-f0-9]{64}$/u.test(asset.sha256 ?? ""),
    "AUTHORING_WORKSPACE_PLAN_INVALID", "BuildPlan asset identity is malformed");
    assert(PORTABLE_PATH.test(asset.path ?? ""),
      "AUTHORING_WORKSPACE_PATH_INVALID", `${asset.assetId} path is not portable`, { path: asset.path });
    const collisionKey = process.platform === "win32" ? asset.path.toLowerCase() : asset.path;
    assert(!occupiedPaths.has(collisionKey),
      "AUTHORING_WORKSPACE_PATH_CONFLICT", `${asset.assetId} path collides in the workspace`, { path: asset.path });
    occupiedPaths.add(collisionKey);
  }

  await mkdir(staging);
  let published = false;
  try {
    const copied = [];
    for (const asset of buildPlan.assetCatalog.assets) {
      const sourcePath = sourcePathFor(sourcePathByAssetId, asset.assetId);
      const { bytes, digest } = await readStableAsset({ asset, sourcePath });
      const target = workspacePath(staging, asset.path, asset.assetId);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
      copied.push(Object.freeze({
        assetId: asset.assetId,
        path: asset.path,
        bytes: bytes.length,
        sha256: digest,
      }));
    }
    const stagingDraftPath = path.join(staging, "draft.json");
    await writeFile(stagingDraftPath, `${JSON.stringify(projectedDraft, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      await rename(staging, workspace);
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        fail("AUTHORING_WORKSPACE_EXISTS", "authoring workspace already exists", { workspace });
      }
      throw error;
    }
    published = true;
    return Object.freeze({
      workspace,
      draftPath: path.join(workspace, "draft.json"),
      copied: Object.freeze(copied),
    });
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true });
  }
}
