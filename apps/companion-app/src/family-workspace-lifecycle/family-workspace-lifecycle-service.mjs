import path from "node:path";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import {
  closeFamilyWorkspace,
  createFamilyWorkspace,
} from "../family-workspace/family-workspace.mjs";
import {
  assertDescriptorId,
  assertOperationId,
  assertWorkspaceDirectoryName,
  createLifecycleDescriptor,
  descriptorSummary,
  FamilyWorkspaceLifecycleError,
  LIFECYCLE_PROFILE,
} from "./family-workspace-lifecycle-contract.mjs";
import { isStrictRfc3339 } from "../../../../contracts/rfc3339.mjs";
import { createFamilyWorkspaceLifecycleFilesystemAdapter } from "./family-workspace-lifecycle-filesystem-adapter.mjs";

function fail(code, message, details) {
  throw new FamilyWorkspaceLifecycleError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function processPathKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function normalizeInput(input, fallback = {}) {
  if (typeof input === "string") return { ...fallback, workspaceDirectoryName: input };
  return { ...fallback, ...(input ?? {}) };
}

function defaultOperationId(kind, workspaceDirectoryName) {
  return `AUTO-${kind.toUpperCase()}-${workspaceDirectoryName}`;
}

function normalizeClockValue(clock) {
  const value = typeof clock === "function" ? clock() : clock;
  let result;
  try {
    result = value instanceof Date ? value.toISOString() : value;
  } catch (error) {
    fail("FAMILY_WORKSPACE_CLOCK_INVALID", "workspace clock must return an RFC3339 value", {
      causeCode: error?.code ?? error?.name ?? "CLOCK_ERROR",
    });
  }
  assert(isStrictRfc3339(result),
    "FAMILY_WORKSPACE_CLOCK_INVALID", "workspace clock must return an RFC3339 string or Date");
  return result;
}

function publicResult(summary, workspace = undefined) {
  const result = { summary: descriptorSummary(summary) };
  if (workspace !== undefined) result.workspace = workspace;
  return Object.freeze(result);
}

export function createFamilyWorkspaceLifecycle({
  allowedRoot,
  workspaceOptions = {},
  filesystem = createFamilyWorkspaceLifecycleFilesystemAdapter(),
  workspaceFactory = createFamilyWorkspace,
  workspaceCloser = closeFamilyWorkspace,
  clock = () => new Date().toISOString(),
  operationIdFactory = null,
} = {}) {
  assert(path.isAbsolute(allowedRoot ?? ""),
    "FAMILY_WORKSPACE_ROOT_INVALID", "lifecycle allowedRoot must be absolute");
  assert(filesystem && typeof filesystem.list === "function"
    && typeof filesystem.read === "function"
    && typeof filesystem.readIdentity === "function"
    && typeof filesystem.inspect === "function"
    && typeof filesystem.create === "function"
    && typeof filesystem.writeCas === "function",
  "FAMILY_WORKSPACE_LIFECYCLE_PORT_INVALID", "lifecycle filesystem port is incomplete");
  assert(typeof workspaceFactory === "function",
    "FAMILY_WORKSPACE_LIFECYCLE_PORT_INVALID", "workspace factory port is required");
  assert(typeof workspaceCloser === "function",
    "FAMILY_WORKSPACE_LIFECYCLE_PORT_INVALID", "workspace closer port is required");

  const handles = new Map();
  const closedReceipts = new Map();
  const inflight = new Map();

  function directoryPath(workspaceDirectoryName) {
    assertWorkspaceDirectoryName(workspaceDirectoryName);
    return path.resolve(allowedRoot, workspaceDirectoryName);
  }

  function directoryKey(workspaceDirectoryName) {
    return processPathKey(directoryPath(workspaceDirectoryName));
  }

  function operationId(kind, input, { required = false } = {}) {
    const candidate = input?.operationId
      ?? (!required && (typeof operationIdFactory === "function"
        ? operationIdFactory(kind, input?.workspaceDirectoryName ?? "")
        : defaultOperationId(kind, input?.workspaceDirectoryName ?? "workspace")));
    assert(!required || candidate !== undefined,
      "FAMILY_WORKSPACE_OPERATION_INVALID", `${kind} requires operationId`);
    return assertOperationId(candidate);
  }

  function commandFingerprint(kind, input) {
    const relevant = {
      kind,
      workspaceDirectoryName: input.workspaceDirectoryName,
      workspaceId: input.workspaceId ?? null,
      repositoryId: input.repositoryId ?? null,
      expectedDescriptorId: input.expectedDescriptorId ?? null,
      operationId: input.operationId ?? null,
    };
    return canonicalSha256(relevant).sha256;
  }

  async function singleFlight(key, kind, input, action) {
    const fingerprint = commandFingerprint(kind, input);
    const existing = inflight.get(key);
    if (existing) {
      if (existing.fingerprint === fingerprint) return existing.promise;
      fail("FAMILY_WORKSPACE_BUSY", "workspace has another lifecycle command in flight");
    }
    const entry = { fingerprint, promise: null };
    entry.promise = Promise.resolve().then(action);
    inflight.set(key, entry);
    try {
      return await entry.promise;
    } finally {
      if (inflight.get(key) === entry) inflight.delete(key);
    }
  }

  async function readRecord(workspaceDirectoryName) {
    return filesystem.read({ allowedRoot, workspaceDirectoryName });
  }

  async function composeWorkspace({ workspaceDirectoryName, repositoryId }) {
    return workspaceFactory({
      ...workspaceOptions,
      allowedRoot,
      workspaceDirectory: directoryPath(workspaceDirectoryName),
      repositoryId,
    });
  }

  async function closeHandle(workspaceDirectoryName, handle) {
    const receipt = await workspaceCloser({
      workspace: handle.workspace,
      workspaceDirectory: directoryPath(workspaceDirectoryName),
    });
    const key = directoryKey(workspaceDirectoryName);
    handles.delete(key);
    closedReceipts.set(key, Object.freeze({
      profile: LIFECYCLE_PROFILE,
      status: "CLOSED",
      idempotent: true,
    }));
    return receipt;
  }

  async function openActiveRecord(record, workspaceDirectoryName) {
    const key = directoryKey(workspaceDirectoryName);
    const existing = handles.get(key);
    if (existing
      && existing.workspaceId === record.descriptor.workspaceId
      && existing.descriptorId === record.descriptor.descriptorId) {
      return publicResult(record.descriptor, existing.workspace);
    }
    const workspace = await composeWorkspace({
      workspaceDirectoryName,
      repositoryId: record.descriptor.workspaceId,
    });
    const handle = {
      workspace,
      pathKey: key,
      workspaceId: record.descriptor.workspaceId,
      descriptorId: record.descriptor.descriptorId,
      workspaceDirectoryName,
    };
    handles.set(key, handle);
    return publicResult(record.descriptor, workspace);
  }

  async function createInternal(input) {
    const workspaceDirectoryName = assertWorkspaceDirectoryName(input.workspaceDirectoryName);
    assert(typeof input.repositoryId === "string" && input.repositoryId.length > 0,
      "FAMILY_WORKSPACE_IDENTITY_INVALID", "repositoryId is required to create a workspace");
    const opId = operationId("create", input);
    const existing = await filesystem.inspect({ allowedRoot, workspaceDirectoryName });
    if (existing) {
      assert(existing.descriptor.workspaceId === input.repositoryId,
        "FAMILY_WORKSPACE_DESCRIPTOR_IDENTITY_MISMATCH", "existing workspace identity differs from repositoryId");
      assert(existing.descriptor.state === "ACTIVE",
        "FAMILY_WORKSPACE_ARCHIVED", "archived workspace must be unarchived before opening");
      return openActiveRecord(existing, workspaceDirectoryName);
    }

    let workspace;
    try {
      workspace = await composeWorkspace({ workspaceDirectoryName, repositoryId: input.repositoryId });
      const identity = await filesystem.readIdentity({ allowedRoot, workspaceDirectoryName });
      assert(identity.marker.repositoryId === input.repositoryId,
        "FAMILY_WORKSPACE_DESCRIPTOR_IDENTITY_MISMATCH", "workspace marker identity differs from repositoryId");
      const now = normalizeClockValue(clock);
      const descriptor = createLifecycleDescriptor({
        workspaceId: identity.marker.repositoryId,
        workspaceDirectoryName: identity.workspaceDirectoryName,
        state: "ACTIVE",
        createdAt: now,
        updatedAt: now,
        lastOperationId: opId,
        markerSha256: identity.marker.sha256,
      });
      const published = await filesystem.create({
        allowedRoot,
        workspaceDirectoryName,
        descriptor,
      });
      const handle = {
        workspace,
        pathKey: directoryKey(workspaceDirectoryName),
        workspaceId: published.workspaceId,
        descriptorId: published.descriptorId,
        workspaceDirectoryName,
      };
      handles.set(handle.pathKey, handle);
      return publicResult(published, workspace);
    } catch (error) {
      if (workspace) {
        try {
          await workspaceCloser({
            workspace,
            workspaceDirectory: directoryPath(workspaceDirectoryName),
          });
        } catch {
          // The original publication error is the useful lifecycle result.
        }
      }
      throw error;
    }
  }

  async function openInternal(input) {
    const workspaceDirectoryName = assertWorkspaceDirectoryName(input.workspaceDirectoryName);
    const record = await readRecord(workspaceDirectoryName);
    if (input.workspaceId !== undefined) {
      assert(record.descriptor.workspaceId === input.workspaceId,
        "FAMILY_WORKSPACE_DESCRIPTOR_IDENTITY_MISMATCH", "requested workspaceId differs from the marker");
    }
    assert(record.descriptor.state === "ACTIVE",
      "FAMILY_WORKSPACE_ARCHIVED", "archived workspace must be unarchived before opening");
    return openActiveRecord(record, workspaceDirectoryName);
  }

  async function closeInternal(input) {
    const workspaceDirectoryName = assertWorkspaceDirectoryName(input.workspaceDirectoryName);
    const record = await readRecord(workspaceDirectoryName);
    const key = directoryKey(workspaceDirectoryName);
    const handle = handles.get(key);
    if (!handle) {
      const prior = closedReceipts.get(key);
      if (prior) return prior;
      fail("FAMILY_WORKSPACE_NOT_OPEN", "workspace has no live capability in this process");
    }
    const receipt = await closeHandle(workspaceDirectoryName, handle);
    return Object.freeze({
      profile: LIFECYCLE_PROFILE,
      status: receipt.status,
      idempotent: receipt.idempotent,
    });
  }

  async function archiveInternal(input) {
    const workspaceDirectoryName = assertWorkspaceDirectoryName(input.workspaceDirectoryName);
    const opId = operationId("archive", input, { required: true });
    const expectedDescriptorId = assertDescriptorId(input.expectedDescriptorId);
    const record = await readRecord(workspaceDirectoryName);
    if (record.descriptor.state === "ARCHIVED" && record.descriptor.lastOperationId === opId) {
      return publicResult(record.descriptor);
    }
    assert(record.descriptor.descriptorId === expectedDescriptorId,
      "FAMILY_WORKSPACE_DESCRIPTOR_STALE", "archive expectedDescriptorId is stale");
    if (record.descriptor.state === "ARCHIVED") return publicResult(record.descriptor);
    const handle = handles.get(directoryKey(workspaceDirectoryName));
    if (handle) {
      assert(handle.workspaceId === record.descriptor.workspaceId,
        "FAMILY_WORKSPACE_HANDLE_IDENTITY_MISMATCH", "lifecycle handle identity differs from the descriptor");
      await closeHandle(workspaceDirectoryName, handle);
    }
    const now = normalizeClockValue(clock);
    const next = createLifecycleDescriptor({
      ...record.descriptor,
      state: "ARCHIVED",
      updatedAt: now,
      lastOperationId: opId,
    });
    const published = await filesystem.writeCas({
      allowedRoot,
      workspaceDirectoryName,
      expectedDescriptorId,
      descriptor: next,
    });
    return publicResult(published);
  }

  async function unarchiveInternal(input) {
    const workspaceDirectoryName = assertWorkspaceDirectoryName(input.workspaceDirectoryName);
    const opId = operationId("unarchive", input, { required: true });
    const expectedDescriptorId = assertDescriptorId(input.expectedDescriptorId);
    const record = await readRecord(workspaceDirectoryName);
    if (record.descriptor.state === "ACTIVE" && record.descriptor.lastOperationId === opId) {
      return publicResult(record.descriptor);
    }
    assert(record.descriptor.descriptorId === expectedDescriptorId,
      "FAMILY_WORKSPACE_DESCRIPTOR_STALE", "unarchive expectedDescriptorId is stale");
    if (record.descriptor.state === "ACTIVE") return publicResult(record.descriptor);
    const now = normalizeClockValue(clock);
    const next = createLifecycleDescriptor({
      ...record.descriptor,
      state: "ACTIVE",
      updatedAt: now,
      lastOperationId: opId,
    });
    const published = await filesystem.writeCas({
      allowedRoot,
      workspaceDirectoryName,
      expectedDescriptorId,
      descriptor: next,
    });
    return publicResult(published);
  }

  const service = {
    profile: LIFECYCLE_PROFILE,
    async list() {
      const records = await filesystem.list({ allowedRoot });
      return Object.freeze(records.map((record) => descriptorSummary(record.descriptor)));
    },
    async create(input) {
      const normalized = normalizeInput(input);
      const name = assertWorkspaceDirectoryName(normalized.workspaceDirectoryName);
      normalized.workspaceDirectoryName = name;
      return singleFlight(processPathKey(directoryPath(name)), "create", normalized,
        () => createInternal(normalized));
    },
    async open(input) {
      const normalized = normalizeInput(input);
      const name = assertWorkspaceDirectoryName(normalized.workspaceDirectoryName);
      normalized.workspaceDirectoryName = name;
      return singleFlight(processPathKey(directoryPath(name)), "open", normalized,
        () => openInternal(normalized));
    },
    async reopen(input) {
      const normalized = normalizeInput(input);
      const name = assertWorkspaceDirectoryName(normalized.workspaceDirectoryName);
      normalized.workspaceDirectoryName = name;
      return singleFlight(processPathKey(directoryPath(name)), "reopen", normalized,
        () => openInternal(normalized));
    },
    async close(input) {
      const normalized = normalizeInput(input);
      const name = assertWorkspaceDirectoryName(normalized.workspaceDirectoryName);
      normalized.workspaceDirectoryName = name;
      return singleFlight(processPathKey(directoryPath(name)), "close", normalized,
        () => closeInternal(normalized));
    },
    async archive(input) {
      const normalized = normalizeInput(input);
      const name = assertWorkspaceDirectoryName(normalized.workspaceDirectoryName);
      normalized.workspaceDirectoryName = name;
      return singleFlight(processPathKey(directoryPath(name)), "archive", normalized,
        () => archiveInternal(normalized));
    },
    async unarchive(input) {
      const normalized = normalizeInput(input);
      const name = assertWorkspaceDirectoryName(normalized.workspaceDirectoryName);
      normalized.workspaceDirectoryName = name;
      return singleFlight(processPathKey(directoryPath(name)), "unarchive", normalized,
        () => unarchiveInternal(normalized));
    },
  };

  return Object.freeze(service);
}
