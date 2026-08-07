import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";

export class LocalAudioAssetError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LocalAudioAssetError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new LocalAudioAssetError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertPortableAssetPath(value) {
  assert(
    typeof value === "string"
      && /^(?!\/)(?![A-Za-z]:)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)(?!.*\/$)[A-Za-z0-9._/-]+$/u.test(value),
    "AUDIO_ASSET_PATH_INVALID",
    "audio asset path must be a portable relative path",
    { path: value },
  );
}

async function assertRegularFile(filePath, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") fail("AUDIO_ASSET_MISSING", `${label} is missing`);
    throw error;
  }
  assert(info.isFile() && !info.isSymbolicLink(), "AUDIO_ASSET_NOT_REGULAR", `${label} must be a regular file`);
  return info;
}

export async function sha256File(filePath, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const info = await assertRegularFile(filePath, "audio asset");
  assert(info.size <= maxBytes, "AUDIO_ASSET_TOO_LARGE", "audio asset exceeds the configured byte limit", {
    bytes: info.size,
    maxBytes,
  });
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    assert(bytes <= maxBytes, "AUDIO_ASSET_TOO_LARGE", "audio asset exceeded the configured byte limit while hashing", {
      bytes,
      maxBytes,
    });
    digest.update(chunk);
  }
  assert(bytes === info.size, "AUDIO_ASSET_CHANGED", "audio asset size changed while hashing", {
    before: info.size,
    after: bytes,
  });
  const after = await lstat(filePath);
  assert(after.isFile() && !after.isSymbolicLink() && after.size === info.size
    && after.mtimeMs === info.mtimeMs, "AUDIO_ASSET_CHANGED", "audio asset changed while hashing");
  return { bytes, sha256: digest.digest("hex") };
}

async function resolveContainedRegularFile({ root, candidate, label }) {
  const rootInfo = await lstat(root);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), "AUDIO_ASSET_ROOT_INVALID", `${label} root must be a regular directory`);
  await assertRegularFile(candidate, label);
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  assert(inside(realRoot, realCandidate), "AUDIO_ASSET_PATH_ESCAPE", `${label} resolved outside its owned root`);
  return realCandidate;
}

export async function resolveVerifiedPreviewClip({
  clip,
  assetRoot,
  absolutePathBySha256 = null,
  maxBytes = 64 * 1024 * 1024,
}) {
  assert(clip && typeof clip.clipId === "string" && clip.clipId.length > 0,
    "AUDIO_CLIP_INVALID", "preview clip ID is missing");
  assert(typeof clip.sha256 === "string" && /^[a-f0-9]{64}$/u.test(clip.sha256),
    "AUDIO_CLIP_INVALID", "preview clip SHA-256 is malformed", { clipId: clip.clipId });
  assert(Number.isInteger(clip.bytes) && clip.bytes > 0,
    "AUDIO_CLIP_INVALID", "preview clip byte count is malformed", { clipId: clip.clipId });
  assertPortableAssetPath(clip.assetPath);

  const mapped = absolutePathBySha256?.get?.(clip.sha256)
    ?? absolutePathBySha256?.[clip.sha256]
    ?? null;
  const candidate = mapped ? path.resolve(mapped) : path.resolve(assetRoot, clip.assetPath);
  const resolved = await resolveContainedRegularFile({ root: assetRoot, candidate, label: clip.clipId });
  const identity = await sha256File(resolved, { maxBytes });
  assert(identity.bytes === clip.bytes, "AUDIO_ASSET_BYTES_MISMATCH", "audio bytes differ from preview", {
    clipId: clip.clipId,
    expected: clip.bytes,
    actual: identity.bytes,
  });
  assert(identity.sha256 === clip.sha256, "AUDIO_ASSET_HASH_MISMATCH", "audio SHA-256 differs from preview", {
    clipId: clip.clipId,
    expected: clip.sha256,
    actual: identity.sha256,
  });
  return Object.freeze({
    clipId: clip.clipId,
    absolutePath: resolved,
    bytes: identity.bytes,
    sha256: identity.sha256,
    durationMs: clip.durationMs,
    codec: clip.codec,
  });
}

async function syncFile(filePath) {
  // Windows requires a writable handle for FlushFileBuffers; the staging file
  // is owned by this import transaction and remains byte-verified afterwards.
  const handle = await open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function importCanonicalWav({
  sourcePath,
  assetId,
  vaultRoot,
  probeCanonicalWav,
  maxBytes = 64 * 1024 * 1024,
}) {
  assert(typeof assetId === "string" && /^[a-z0-9][a-z0-9._-]{2,127}$/u.test(assetId),
    "AUDIO_ASSET_ID_INVALID", "assetId is malformed", { assetId });
  assert(typeof probeCanonicalWav === "function", "AUDIO_PROBE_REQUIRED", "canonical WAV probe port is required");
  const source = path.resolve(sourcePath);
  await assertRegularFile(source, "import source");
  const sourceRealPath = await realpath(source);
  const identity = await sha256File(sourceRealPath, { maxBytes });
  const probe = await probeCanonicalWav(sourceRealPath);
  assert(probe?.codecProfile === "WAV_PCM16_16K_MONO", "AUDIO_CODEC_PROFILE_MISMATCH",
    "import source is outside the canonical WAV profile", { actual: probe?.codecProfile ?? null });
  assert(Number.isInteger(probe.durationMs) && probe.durationMs > 0,
    "AUDIO_PROBE_INVALID", "audio probe returned an invalid duration");

  await mkdir(vaultRoot, { recursive: true });
  const vaultInfo = await lstat(vaultRoot);
  assert(vaultInfo.isDirectory() && !vaultInfo.isSymbolicLink(),
    "AUDIO_ASSET_ROOT_INVALID", "audio vault must be a regular directory");
  const contentDirectory = path.join(vaultRoot, "assets", "sha256");
  await mkdir(contentDirectory, { recursive: true });
  const relativePath = `assets/sha256/${identity.sha256}.wav`;
  const destination = path.join(vaultRoot, ...relativePath.split("/"));

  try {
    const current = await lstat(destination);
    assert(current.isFile() && !current.isSymbolicLink(),
      "AUDIO_VAULT_CONFLICT", "content-addressed destination is not a regular file");
    const existing = await sha256File(destination, { maxBytes });
    assert(existing.sha256 === identity.sha256 && existing.bytes === identity.bytes,
      "AUDIO_VAULT_CONFLICT", "content-addressed destination has conflicting bytes");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const suffix = randomBytes(8).toString("hex");
    const staging = `${destination}.tmp-${suffix}`;
    try {
      await copyFile(sourceRealPath, staging, fsConstants.COPYFILE_EXCL);
      const staged = await sha256File(staging, { maxBytes });
      assert(staged.sha256 === identity.sha256 && staged.bytes === identity.bytes,
        "AUDIO_ASSET_CHANGED", "staged import bytes differ from the verified source");
      await syncFile(staging);
      await rename(staging, destination);
    } catch (error) {
      await rm(staging, { force: true });
      if (error?.code === "EEXIST") {
        const existing = await sha256File(destination, { maxBytes });
        assert(existing.sha256 === identity.sha256 && existing.bytes === identity.bytes,
          "AUDIO_VAULT_CONFLICT", "concurrent import produced conflicting bytes");
      } else {
        throw error;
      }
    }
  }

  const destinationRealPath = await resolveContainedRegularFile({
    root: vaultRoot,
    candidate: destination,
    label: assetId,
  });
  const finalIdentity = await sha256File(destinationRealPath, { maxBytes });
  assert(finalIdentity.sha256 === identity.sha256 && finalIdentity.bytes === identity.bytes,
    "AUDIO_VAULT_CONFLICT", "published content-addressed asset differs from the verified import");
  const finalProbe = await probeCanonicalWav(destinationRealPath);
  assert(finalProbe?.codecProfile === "WAV_PCM16_16K_MONO" && finalProbe.durationMs === probe.durationMs,
    "AUDIO_VAULT_CONFLICT", "published content-addressed asset differs from the probed codec profile");
  return Object.freeze({
    assetId,
    contentPath: relativePath,
    absolutePath: destinationRealPath,
    bytes: identity.bytes,
    sha256: identity.sha256,
    durationMs: finalProbe.durationMs,
    codec: "WAV_PCM16_16K_MONO",
  });
}
