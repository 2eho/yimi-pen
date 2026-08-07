import { TextDecoder } from "node:util";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import { parseJsonRejectingDuplicateKeys } from "../../../../contracts/strict-json-v1.mjs";
import { isStrictRfc3339 } from "../../../../contracts/rfc3339.mjs";

export const LIFECYCLE_PROFILE = "family-workspace-lifecycle-v1";
export const LIFECYCLE_DESCRIPTOR_NAME = "family-workspace-lifecycle.json";
export const LIFECYCLE_STATES = Object.freeze(["ACTIVE", "ARCHIVED"]);
export const LIFECYCLE_DESCRIPTOR_KEYS = Object.freeze([
  "schemaVersion",
  "profile",
  "workspaceId",
  "workspaceDirectoryName",
  "state",
  "createdAt",
  "updatedAt",
  "lastOperationId",
  "markerSha256",
  "descriptorId",
]);

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const OPERATION_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/u;
const DESCRIPTOR_ID_PATTERN = /^family-workspace-lifecycle:sha256:[0-9a-f]{64}$/u;
const WINDOWS_RESERVED_BASENAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;

export class FamilyWorkspaceLifecycleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FamilyWorkspaceLifecycleError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new FamilyWorkspaceLifecycleError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function assertPlainObject(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
  "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", `${label} must be a plain object`);
}

function assertString(value, field) {
  assert(typeof value === "string" && value.length > 0 && !CONTROL_PATTERN.test(value),
    "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", `${field} must be a non-empty Unicode string`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      assert(next >= 0xdc00 && next <= 0xdfff,
        "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", `${field} contains a lone Unicode surrogate`);
      index += 1;
    } else {
      assert(!(code >= 0xdc00 && code <= 0xdfff),
        "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", `${field} contains a lone Unicode surrogate`);
    }
  }
}

export function assertWorkspaceDirectoryName(value) {
  assertString(value, "workspaceDirectoryName");
  assert(value !== "." && value !== ".."
    && !value.startsWith(".")
    && value !== "staging"
    && value !== "capture-staging"
    && !/[\\/:*?"<>|]/u.test(value)
    && !value.includes("\u0000")
    && !/[. ]$/u.test(value)
    && !WINDOWS_RESERVED_BASENAME.test(value),
  "FAMILY_WORKSPACE_PATH_INVALID", "workspaceDirectoryName must be a safe direct-child name");
  return value;
}

export function assertOperationId(value) {
  assert(typeof value === "string" && OPERATION_PATTERN.test(value),
    "FAMILY_WORKSPACE_OPERATION_INVALID", "operationId must be a stable printable Unicode token");
  assertString(value, "operationId");
  return value;
}

export function assertDescriptorId(value) {
  assert(typeof value === "string" && DESCRIPTOR_ID_PATTERN.test(value),
    "FAMILY_WORKSPACE_DESCRIPTOR_ID_INVALID", "expectedDescriptorId must be a lifecycle descriptor identity");
  return value;
}

function descriptorWithoutId(descriptor) {
  const {
    descriptorId: _descriptorId,
    ...withoutId
  } = descriptor;
  return withoutId;
}

export function computeDescriptorId(descriptor) {
  try {
    const { sha256 } = canonicalSha256(descriptorWithoutId(descriptor));
    return `family-workspace-lifecycle:sha256:${sha256}`;
  } catch (error) {
    fail("FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptor contains invalid canonical JSON data", {
      causeCode: error?.code ?? error?.name ?? "JCS_ERROR",
    });
  }
}

export function validateLifecycleDescriptor(input, {
  workspaceDirectoryName = null,
  workspaceId = null,
  markerSha256 = null,
} = {}) {
  assertPlainObject(input, "descriptor");
  const keys = Object.keys(input).sort();
  const expectedKeys = [...LIFECYCLE_DESCRIPTOR_KEYS].sort();
  assert(keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]),
    "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptor contains missing or extra keys");
  assert(input.schemaVersion === 1,
    "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptor schemaVersion must be 1");
  assert(input.profile === LIFECYCLE_PROFILE,
    "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptor profile is not supported");
  assertString(input.workspaceId, "workspaceId");
  assertString(input.workspaceDirectoryName, "workspaceDirectoryName");
  assertWorkspaceDirectoryName(input.workspaceDirectoryName);
  assert(LIFECYCLE_STATES.includes(input.state),
    "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptor state is not supported");
  assert(isStrictRfc3339(input.createdAt) && isStrictRfc3339(input.updatedAt),
    "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptor timestamps must be strict RFC3339");
  assertOperationId(input.lastOperationId);
  assert(HASH_PATTERN.test(input.markerSha256),
    "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptor markerSha256 must be lowercase SHA-256");
  assert(typeof input.descriptorId === "string"
    && input.descriptorId === computeDescriptorId(input),
  "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptorId does not match the canonical descriptor");
  if (workspaceDirectoryName !== null) {
    assert(input.workspaceDirectoryName === workspaceDirectoryName,
      "FAMILY_WORKSPACE_DESCRIPTOR_IDENTITY_MISMATCH", "descriptor directory identity differs from the requested directory");
  }
  if (workspaceId !== null) {
    assert(input.workspaceId === workspaceId,
      "FAMILY_WORKSPACE_DESCRIPTOR_IDENTITY_MISMATCH", "descriptor workspace identity differs from the marker");
  }
  if (markerSha256 !== null) {
    assert(input.markerSha256 === markerSha256,
      "FAMILY_WORKSPACE_DESCRIPTOR_MARKER_MISMATCH", "descriptor marker hash differs from the marker bytes");
  }
  return Object.freeze(structuredClone(input));
}

export function encodeLifecycleDescriptor(descriptor) {
  const validated = validateLifecycleDescriptor(descriptor);
  return Buffer.from(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
}

export function decodeUtf8Strict(bytes, label = LIFECYCLE_DESCRIPTOR_NAME) {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch (error) {
    fail("FAMILY_WORKSPACE_DESCRIPTOR_INVALID", `${label} is not valid UTF-8`, {
      causeCode: error?.code ?? error?.name ?? "UTF8_ERROR",
    });
  }
}

export function parseLifecycleDescriptorBytes(bytes, options = {}) {
  assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array,
    "FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptor bytes must be binary data");
  const text = decodeUtf8Strict(bytes);
  let parsed;
  try {
    parsed = parseJsonRejectingDuplicateKeys(text, LIFECYCLE_DESCRIPTOR_NAME);
  } catch (error) {
    fail("FAMILY_WORKSPACE_DESCRIPTOR_INVALID", "descriptor JSON is not strict", {
      causeCode: error?.code ?? error?.name ?? "JSON_ERROR",
    });
  }
  const descriptor = validateLifecycleDescriptor(parsed, options);
  const canonicalBytes = encodeLifecycleDescriptor(descriptor);
  assert(Buffer.from(bytes).equals(canonicalBytes),
    "FAMILY_WORKSPACE_DESCRIPTOR_NONCANONICAL", "descriptor bytes are not canonical");
  return descriptor;
}

export function createLifecycleDescriptor({
  workspaceId,
  workspaceDirectoryName,
  state = "ACTIVE",
  createdAt,
  updatedAt = createdAt,
  lastOperationId,
  markerSha256,
}) {
  const descriptor = {
    schemaVersion: 1,
    profile: LIFECYCLE_PROFILE,
    workspaceId,
    workspaceDirectoryName,
    state,
    createdAt,
    updatedAt,
    lastOperationId,
    markerSha256,
    descriptorId: "",
  };
  descriptor.descriptorId = computeDescriptorId(descriptor);
  return validateLifecycleDescriptor(descriptor, {
    workspaceDirectoryName,
    workspaceId,
    markerSha256,
  });
}

export function descriptorSummary(descriptor) {
  const validated = validateLifecycleDescriptor(descriptor);
  return Object.freeze({ ...validated });
}
