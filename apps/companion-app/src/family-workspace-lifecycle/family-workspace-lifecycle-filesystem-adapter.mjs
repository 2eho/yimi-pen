import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import {
  decodeUtf8Strict,
  encodeLifecycleDescriptor,
  LIFECYCLE_DESCRIPTOR_NAME,
  parseLifecycleDescriptorBytes,
  FamilyWorkspaceLifecycleError,
  assertWorkspaceDirectoryName,
} from "./family-workspace-lifecycle-contract.mjs";
import { parseJsonRejectingDuplicateKeys } from "../../../../contracts/strict-json-v1.mjs";

const MARKER_NAME = "family-workspace.json";
const MARKER_PROFILE = "family-workspace-v1";
const LOCK_NAME = ".family-workspace-lifecycle.lock";
const STAGING_NAMES = new Set(["staging", "capture-staging"]);

function fail(code, message, details) {
  throw new FamilyWorkspaceLifecycleError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function processPathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function optionalLstat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertRegularRoot(target, code, label) {
  assert(path.isAbsolute(target ?? ""), code, `${label} must be an absolute path`);
  const info = await optionalLstat(target);
  assert(info?.isDirectory() && !info.isSymbolicLink(), code, `${label} must be a regular directory`);
  const real = await realpath(target);
  assert(path.isAbsolute(real), code, `${label} real path is invalid`);
  return real;
}

function assertDirectChild(root, target, code, label) {
  assert(path.dirname(target) === root && target !== root,
    code, `${label} must be a direct child of the allowed root`);
}

function markerBytes(repositoryId) {
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    profile: MARKER_PROFILE,
    repositoryId,
  }, null, 2)}\n`, "utf8");
}

function markerHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertMarkerObject(marker) {
  assert(marker !== null && typeof marker === "object" && !Array.isArray(marker),
    "FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker must be a JSON object");
  const keys = Object.keys(marker).sort();
  assert(keys.length === 3 && keys.join("\u0000") === ["profile", "repositoryId", "schemaVersion"].join("\u0000"),
    "FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker contains unexpected keys");
  assert(marker.schemaVersion === 1 && marker.profile === MARKER_PROFILE,
    "FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker profile is not supported");
  assert(typeof marker.repositoryId === "string" && marker.repositoryId.length > 0
    && !/[\u0000-\u001f\u007f]/u.test(marker.repositoryId),
  "FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker repositoryId is invalid");
  return marker;
}

async function readMarker(markerPath) {
  const info = await optionalLstat(markerPath);
  if (!info) return null;
  assert(info.isFile() && !info.isSymbolicLink(),
    "FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker must be a regular file");
  const bytes = await readFile(markerPath);
  let text;
  try {
    text = decodeUtf8Strict(bytes, MARKER_NAME);
  } catch (error) {
    fail("FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker is not valid UTF-8", {
      causeCode: error?.code ?? error?.name ?? "UTF8_ERROR",
    });
  }
  let marker;
  try {
    marker = parseJsonRejectingDuplicateKeys(text, MARKER_NAME);
  } catch (error) {
    fail("FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker JSON is not strict", {
      causeCode: error?.code ?? error?.name ?? "JSON_ERROR",
    });
  }
  assertMarkerObject(marker);
  assert(bytes.equals(markerBytes(marker.repositoryId)),
    "FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker bytes are not canonical");
  return Object.freeze({
    repositoryId: marker.repositoryId,
    bytes,
    sha256: markerHash(bytes),
  });
}

async function resolveAllowedRoot(allowedRoot) {
  assert(typeof allowedRoot === "string" && path.isAbsolute(allowedRoot),
    "FAMILY_WORKSPACE_ROOT_INVALID", "allowed workspace root must be an absolute path");
  return assertRegularRoot(allowedRoot,
    "FAMILY_WORKSPACE_ROOT_INVALID", "allowed workspace root");
}

async function resolveWorkspaceRoot(allowedRoot, workspaceDirectoryNameOrPath, {
  requireExists = true,
  code = "FAMILY_WORKSPACE_ROOT_INVALID",
} = {}) {
  const realAllowed = await resolveAllowedRoot(allowedRoot);
  const supplied = String(workspaceDirectoryNameOrPath ?? "");
  const rawSegments = supplied.split(/[\\/]/u);
  assert(!rawSegments.some((segment) => segment === "." || segment === ".."),
    "FAMILY_WORKSPACE_PATH_INVALID", "workspace path contains traversal segments");
  if (!path.isAbsolute(supplied)) assertWorkspaceDirectoryName(supplied);
  const target = path.isAbsolute(supplied)
    ? path.resolve(supplied)
    : path.resolve(realAllowed, supplied);
  assertDirectChild(realAllowed, target, code, "workspace directory");
  const directoryName = path.basename(target);
  assertWorkspaceDirectoryName(directoryName);
  if (!requireExists) {
    return Object.freeze({
      allowedRoot: realAllowed,
      workspaceRoot: target,
      workspaceDirectoryName: directoryName,
    });
  }
  const info = await optionalLstat(target);
  if (!info) fail("FAMILY_WORKSPACE_NOT_FOUND", "workspace directory was not found");
  assert(info.isDirectory() && !info.isSymbolicLink(), code,
    "workspace directory must be a regular directory");
  const realWorkspace = await realpath(target);
  assert(inside(realAllowed, realWorkspace), code,
    "workspace directory resolved outside its allowed root");
  assert(path.dirname(realWorkspace) === realAllowed, code,
    "workspace directory resolved outside its direct-child boundary");
  return Object.freeze({
    allowedRoot: realAllowed,
    workspaceRoot: realWorkspace,
    workspaceDirectoryName: path.basename(realWorkspace),
  });
}

function isIgnoredDirectoryName(name) {
  return name.startsWith(".") || STAGING_NAMES.has(name) || name.includes(".staging");
}

async function readRecordAtRoot(allowedRoot, workspaceDirectoryNameOrPath, { allowUnmanaged = false } = {}) {
  const resolved = await resolveWorkspaceRoot(allowedRoot, workspaceDirectoryNameOrPath);
  const markerPath = path.join(resolved.workspaceRoot, MARKER_NAME);
  const descriptorPath = path.join(resolved.workspaceRoot, LIFECYCLE_DESCRIPTOR_NAME);
  const marker = await readMarker(markerPath);
  if (!marker) {
    if (allowUnmanaged) return null;
    fail("FAMILY_WORKSPACE_UNMANAGED", "workspace has no valid identity marker");
  }
  const descriptorInfo = await optionalLstat(descriptorPath);
  if (!descriptorInfo) {
    if (allowUnmanaged) return null;
    fail("FAMILY_WORKSPACE_UNMANAGED", "workspace has no lifecycle descriptor");
  }
  assert(descriptorInfo.isFile() && !descriptorInfo.isSymbolicLink(),
    "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "lifecycle descriptor must be a regular file");
  const descriptorBytes = await readFile(descriptorPath);
  const descriptor = parseLifecycleDescriptorBytes(descriptorBytes, {
    workspaceDirectoryName: resolved.workspaceDirectoryName,
    workspaceId: marker.repositoryId,
    markerSha256: marker.sha256,
  });
  return Object.freeze({
    allowedRoot: resolved.allowedRoot,
    workspaceRoot: resolved.workspaceRoot,
    workspaceDirectoryName: resolved.workspaceDirectoryName,
    marker,
    markerPath,
    descriptor,
    descriptorPath,
    descriptorBytes,
  });
}

async function inspectDirectory(realAllowed, name) {
  if (isIgnoredDirectoryName(name)) return null;
  const candidate = path.join(realAllowed, name);
  const info = await optionalLstat(candidate);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) return null;
  let realCandidate;
  try {
    realCandidate = await realpath(candidate);
  } catch {
    return null;
  }
  if (!inside(realAllowed, realCandidate) || path.dirname(realCandidate) !== realAllowed) return null;
  try {
    return await readRecordAtRoot(realAllowed, realCandidate, { allowUnmanaged: true });
  } catch {
    return null;
  }
}

async function callFault(faultInjector, stage, context) {
  if (typeof faultInjector !== "function") return;
  try {
    await faultInjector(stage, Object.freeze({ ...context }));
  } catch (error) {
    fail("FAMILY_WORKSPACE_DESCRIPTOR_WRITE_FAILED", `descriptor write fault at ${stage}`, {
      faultStage: stage,
      causeCode: error?.code ?? error?.name ?? "FAULT_INJECTED",
    });
  }
}

async function withDescriptorLock(resolved, {
  faultInjector,
  operation,
}, action) {
  const lockPath = path.join(resolved.workspaceRoot, LOCK_NAME);
  let lockHandle = null;
  const lockToken = randomUUID();
  try {
    await callFault(faultInjector, "before-lock-create", {
      workspaceDirectoryName: resolved.workspaceDirectoryName,
      operation,
    });
    try {
      lockHandle = await open(lockPath, "wx");
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail("FAMILY_WORKSPACE_LOCKED", "workspace lifecycle descriptor is locked");
      }
      fail("FAMILY_WORKSPACE_LOCK_FAILED", "workspace lifecycle lock could not be acquired", {
        causeCode: error?.code ?? error?.name ?? "LOCK_ERROR",
      });
    }
    await lockHandle.writeFile(lockToken, "utf8");
    await callFault(faultInjector, "after-lock-acquired", {
      workspaceDirectoryName: resolved.workspaceDirectoryName,
      operation,
    });
    return await action();
  } finally {
    if (lockHandle) {
      let removed = false;
      try {
        await rm(lockPath, { force: true });
        removed = true;
      } catch { /* Windows may require the handle to close first. */ }
      try { await lockHandle.close(); } catch { /* best-effort close */ }
      if (!removed) {
        try {
          const currentToken = await readFile(lockPath, "utf8");
          if (currentToken === lockToken) await rm(lockPath, { force: true });
        } catch { /* best-effort token cleanup; crash or cleanup failure can leave a stale lock */ }
      }
    }
  }
}

async function reloadDescriptor(descriptorPath, descriptor) {
  const reloadedBytes = await readFile(descriptorPath);
  const reloaded = parseLifecycleDescriptorBytes(reloadedBytes, {
    workspaceDirectoryName: descriptor.workspaceDirectoryName,
    workspaceId: descriptor.workspaceId,
    markerSha256: descriptor.markerSha256,
  });
  assert(reloaded.descriptorId === descriptor.descriptorId,
    "FAMILY_WORKSPACE_DESCRIPTOR_RELOAD_FAILED", "descriptor reload identity differs after atomic write");
  return reloaded;
}

async function atomicWriteDescriptor(descriptorPath, descriptor, {
  faultInjector,
  workspaceDirectoryName,
  operation,
}) {
  const bytes = encodeLifecycleDescriptor(descriptor);
  const tempPath = `${descriptorPath}.tmp-${process.pid}-${randomUUID()}`;
  let handle = null;
  let renamed = false;
  try {
    await callFault(faultInjector, "before-temp-create", { workspaceDirectoryName, operation });
    handle = await open(tempPath, "wx");
    await callFault(faultInjector, "after-temp-create", { workspaceDirectoryName, operation });
    await handle.writeFile(bytes);
    await callFault(faultInjector, "after-temp-write-before-sync", { workspaceDirectoryName, operation });
    await handle.sync();
    await callFault(faultInjector, "after-temp-sync-before-close", { workspaceDirectoryName, operation });
    await handle.close();
    handle = null;
    await callFault(faultInjector, "after-temp-close-before-rename", { workspaceDirectoryName, operation });
    await rename(tempPath, descriptorPath);
    renamed = true;
    await callFault(faultInjector, "after-rename-before-reload", { workspaceDirectoryName, operation });
    return reloadDescriptor(descriptorPath, descriptor);
  } catch (error) {
    if (renamed) {
      try {
        // Rename is the commit boundary. If the canonical descriptor is now
        // readable and has the requested identity, report persisted success
        // even when a post-rename fault was injected before the first reload.
        return await reloadDescriptor(descriptorPath, descriptor);
      } catch (reloadError) {
        if (reloadError instanceof FamilyWorkspaceLifecycleError
          && reloadError.code === "FAMILY_WORKSPACE_DESCRIPTOR_RELOAD_FAILED") {
          throw reloadError;
        }
        fail("FAMILY_WORKSPACE_DESCRIPTOR_RELOAD_FAILED", "committed descriptor could not be reloaded", {
          operation,
          causeCode: reloadError?.code ?? reloadError?.name ?? "RELOAD_ERROR",
        });
      }
    }
    if (error instanceof FamilyWorkspaceLifecycleError) throw error;
    fail("FAMILY_WORKSPACE_DESCRIPTOR_WRITE_FAILED", "atomic lifecycle descriptor write failed", {
      operation,
      renamed,
      causeCode: error?.code ?? error?.name ?? "WRITE_ERROR",
    });
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* best-effort close */ }
    }
    if (!renamed) {
      try { await rm(tempPath, { force: true }); } catch { /* best-effort temp cleanup */ }
    }
  }
}

export function createFamilyWorkspaceLifecycleFilesystemAdapter({ faultInjector = null } = {}) {
  return Object.freeze({
    async list({ allowedRoot }) {
      const realAllowed = await resolveAllowedRoot(allowedRoot);
      const entries = await readdir(realAllowed, { withFileTypes: true });
      const records = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const record = await inspectDirectory(realAllowed, entry.name);
        if (record) records.push(record);
      }
      records.sort((left, right) => ordinalCompare(left.descriptor.workspaceId, right.descriptor.workspaceId)
        || ordinalCompare(left.workspaceDirectoryName, right.workspaceDirectoryName));
      return records;
    },

    async read({ allowedRoot, workspaceDirectoryName }) {
      return readRecordAtRoot(allowedRoot, workspaceDirectoryName);
    },

    async readIdentity({ allowedRoot, workspaceDirectoryName }) {
      const resolved = await resolveWorkspaceRoot(allowedRoot, workspaceDirectoryName);
      const marker = await readMarker(path.join(resolved.workspaceRoot, MARKER_NAME));
      if (!marker) fail("FAMILY_WORKSPACE_UNMANAGED", "workspace has no valid identity marker");
      return Object.freeze({
        allowedRoot: resolved.allowedRoot,
        workspaceRoot: resolved.workspaceRoot,
        workspaceDirectoryName: resolved.workspaceDirectoryName,
        marker,
      });
    },

    async inspect({ allowedRoot, workspaceDirectoryName }) {
      try {
        return await readRecordAtRoot(allowedRoot, workspaceDirectoryName, { allowUnmanaged: true });
      } catch (error) {
        if (error?.code === "FAMILY_WORKSPACE_NOT_FOUND" || error?.code === "FAMILY_WORKSPACE_UNMANAGED") return null;
        throw error;
      }
    },

    async create({ allowedRoot, workspaceDirectoryName, descriptor }) {
      const resolved = await resolveWorkspaceRoot(allowedRoot, workspaceDirectoryName);
      const marker = await readMarker(path.join(resolved.workspaceRoot, MARKER_NAME));
      assert(marker, "FAMILY_WORKSPACE_UNMANAGED", "workspace has no valid identity marker");
      const validated = parseLifecycleDescriptorBytes(encodeLifecycleDescriptor(descriptor), {
        workspaceDirectoryName: resolved.workspaceDirectoryName,
        workspaceId: marker.repositoryId,
        markerSha256: marker.sha256,
      });
      const descriptorPath = path.join(resolved.workspaceRoot, LIFECYCLE_DESCRIPTOR_NAME);
      return withDescriptorLock(resolved, {
        faultInjector,
        operation: "create",
      }, async () => {
        const lockedMarker = await readMarker(path.join(resolved.workspaceRoot, MARKER_NAME));
        assert(lockedMarker && lockedMarker.repositoryId === marker.repositoryId
          && lockedMarker.sha256 === marker.sha256,
        "FAMILY_WORKSPACE_MARKER_INVALID", "workspace marker changed during lifecycle publication");
        const lockedDescriptor = await optionalLstat(descriptorPath);
        assert(!lockedDescriptor,
          "FAMILY_WORKSPACE_DESCRIPTOR_EXISTS", "lifecycle descriptor already exists");
        try {
          return await atomicWriteDescriptor(descriptorPath, validated, {
            faultInjector,
            workspaceDirectoryName: resolved.workspaceDirectoryName,
            operation: "create",
          });
        } catch (error) {
          // A pre-rename create failure remains unmanaged. Post-rename
          // canonical reload returns success, so committed state is retained.
          try {
            const currentBytes = await readFile(descriptorPath);
            const current = parseLifecycleDescriptorBytes(currentBytes, {
              workspaceDirectoryName: resolved.workspaceDirectoryName,
              workspaceId: lockedMarker.repositoryId,
              markerSha256: lockedMarker.sha256,
            });
            if (current.descriptorId === validated.descriptorId) await rm(descriptorPath, { force: true });
          } catch {
            // The original pre-rename publication error remains authoritative.
          }
          throw error;
        }
      });
    },

    async writeCas({ allowedRoot, workspaceDirectoryName, expectedDescriptorId, descriptor }) {
      const resolved = await resolveWorkspaceRoot(allowedRoot, workspaceDirectoryName);
      return withDescriptorLock(resolved, {
        faultInjector,
        operation: "compare-and-swap",
      }, async () => {
        const current = await readRecordAtRoot(allowedRoot, workspaceDirectoryName);
        assert(current.descriptor.descriptorId === expectedDescriptorId,
          "FAMILY_WORKSPACE_DESCRIPTOR_STALE", "lifecycle descriptor changed before compare-and-swap");
        const validated = parseLifecycleDescriptorBytes(encodeLifecycleDescriptor(descriptor), {
          workspaceDirectoryName: current.workspaceDirectoryName,
          workspaceId: current.marker.repositoryId,
          markerSha256: current.marker.sha256,
        });
        return atomicWriteDescriptor(current.descriptorPath, validated, {
          faultInjector,
          workspaceDirectoryName: current.workspaceDirectoryName,
          operation: "compare-and-swap",
        });
      });
    },
  });
}

export { MARKER_NAME, markerBytes, markerHash, processPathKey };
