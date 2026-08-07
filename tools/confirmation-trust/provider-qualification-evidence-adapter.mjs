import { createHash } from "node:crypto";
import { parseStrictJson } from "../../contracts/strict-json-v1.mjs";
import { ProviderQualificationError } from "./provider-qualification.mjs";

function fail(code, message, details = {}) {
  throw new ProviderQualificationError(code, message, details);
}

function assert(condition, code, message, details = {}) {
  if (!condition) fail(code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertRelativePath(relativePath) {
  assert(
    typeof relativePath === "string"
      && relativePath.length > 0
      && !relativePath.startsWith("/")
      && !relativePath.includes("\\")
      && !relativePath.split("/").includes(".."),
    "QUALIFICATION_ARTIFACT_PATH_INVALID",
    "evidence adapter accepts repository-relative paths only",
    { relativePath },
  );
}

function assertManifest(manifest) {
  assert(manifest && typeof manifest === "object" && !Array.isArray(manifest), "QUALIFICATION_MANIFEST_INVALID", "evidence composition manifest is required");
  const roles = new Set();
  const paths = new Set();
  for (const [key, spec] of Object.entries(manifest)) {
    assert(spec && typeof spec === "object", "QUALIFICATION_MANIFEST_INVALID", `manifest entry is invalid: ${key}`);
    assert(typeof spec.role === "string" && spec.role.length > 0, "QUALIFICATION_MANIFEST_INVALID", `manifest role is invalid: ${key}`);
    assertRelativePath(spec.path);
    assert(!roles.has(spec.role), "QUALIFICATION_MANIFEST_DUPLICATE", `manifest role is duplicated: ${spec.role}`);
    assert(!paths.has(spec.path), "QUALIFICATION_MANIFEST_DUPLICATE", `manifest path is duplicated: ${spec.path}`);
    roles.add(spec.role);
    paths.add(spec.path);
  }
  assert(Object.keys(manifest).length > 0, "QUALIFICATION_MANIFEST_INVALID", "evidence composition manifest is empty");
  return manifest;
}

function decodeUtf8(bytes, path) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assert(!text.includes("\uFFFD"), "QUALIFICATION_ARTIFACT_ENCODING", `artifact is not valid UTF-8: ${path}`, { path });
    return text;
  } catch (error) {
    if (error instanceof ProviderQualificationError) throw error;
    fail("QUALIFICATION_ARTIFACT_ENCODING", `artifact is not valid UTF-8: ${path}`, { path, cause: error?.message ?? String(error) });
  }
}

async function readOne({ readArtifact, key, spec }) {
  assert(typeof readArtifact === "function", "QUALIFICATION_ADAPTER_MISCONFIGURED", "readArtifact port is required");
  assertRelativePath(spec.path);
  let raw;
  try {
    raw = await readArtifact(spec.path);
  } catch (error) {
    fail("QUALIFICATION_ARTIFACT_READ", `failed to read ${spec.path}`, { path: spec.path, cause: error?.message ?? String(error) });
  }
  assert(raw instanceof Uint8Array, "QUALIFICATION_ARTIFACT_BYTES", `reader must return bytes for ${spec.path}`, { path: spec.path });
  const bytes = Buffer.from(raw);
  assert(bytes.length > 0, "QUALIFICATION_ARTIFACT_EMPTY", `artifact is empty: ${spec.path}`, { path: spec.path });
  const actualSha256 = sha256(bytes);
  let value;
  try {
    value = parseStrictJson(decodeUtf8(bytes, spec.path), spec.path);
  } catch (error) {
    if (error instanceof ProviderQualificationError) throw error;
    fail("QUALIFICATION_ARTIFACT_JSON", `artifact JSON is invalid: ${spec.path}`, { path: spec.path, cause: error?.message ?? String(error), code: error?.code ?? null });
  }
  return {
    key,
    artifact: {
      role: spec.role,
      path: spec.path,
      size: bytes.length,
      sha256: actualSha256,
    },
    value,
  };
}

export function createProviderQualificationEvidenceAdapter({ manifest, readArtifact }) {
  assertManifest(manifest);
  assert(typeof readArtifact === "function", "QUALIFICATION_ADAPTER_MISCONFIGURED", "readArtifact port is required");
  return Object.freeze({
    manifest: clone(manifest),
    async collect() {
      const entries = {};
      for (const [key, spec] of Object.entries(manifest)) {
        entries[key] = await readOne({ readArtifact, key, spec });
      }
      return entries;
    },
  });
}

export async function collectProviderQualificationEvidence(options) {
  return createProviderQualificationEvidenceAdapter(options).collect();
}

export function cloneEvidence(evidence) {
  return clone(evidence);
}
