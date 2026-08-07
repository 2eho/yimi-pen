import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const U32_MAX = 0xffff_ffff;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeLegacyClips(clips, label = "legacy random_one") {
  if (!Array.isArray(clips) || clips.length < 2 || clips.length > 32) {
    throw new Error(`${label}: random_one clip count is outside 2..32`);
  }
  const ids = new Set();
  return clips.map((clip, index) => {
    if (!clip || typeof clip !== "object" || typeof clip.id !== "string" || clip.id.length === 0) {
      throw new Error(`${label}/clips/${index}: clip id is missing`);
    }
    if (ids.has(clip.id)) throw new Error(`${label}: duplicate clip id ${clip.id}`);
    ids.add(clip.id);
    const defaulted = clip.weight === undefined;
    const weight = defaulted ? 1 : clip.weight;
    if (!Number.isInteger(weight) || weight < 1 || weight > U32_MAX) {
      throw new Error(`${label}/clips/${index}: weight is not positive u32`);
    }
    return { clipId: clip.id, weight, defaulted };
  });
}

function walk(value, sourcePath, pointer, mappings) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, sourcePath, `${pointer}/${index}`, mappings));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.playPolicy === "random_one" && Array.isArray(value.clips)) {
    const clips = normalizeLegacyClips(value.clips, `${sourcePath}${pointer}`);
    mappings.push({
      sourcePath,
      pointer,
      actionIdentity: value.id ?? value.oid ?? pointer,
      clips,
    });
  }
  for (const [key, child] of Object.entries(value)) walk(child, sourcePath, `${pointer}/${key}`, mappings);
}

export async function mapLegacyRandomOneSources(repoRoot, evidenceLock) {
  const mappings = [];
  const sources = [];
  for (const record of evidenceLock.localTruth) {
    const absolute = path.join(repoRoot, ...record.path.split("/"));
    const bytes = await readFile(absolute);
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== record.sha256) throw new Error(`evidence-locked local truth drift: ${record.path}`);
    sources.push({ path: record.path, size: bytes.length, sha256: actualSha256, claim: record.claim });
    if (record.path.endsWith(".json")) {
      const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      walk(document, record.path, "", mappings);
    }
  }
  mappings.sort((left, right) => `${left.sourcePath}\0${left.pointer}`.localeCompare(`${right.sourcePath}\0${right.pointer}`, "en"));
  return { sources, mappings };
}
