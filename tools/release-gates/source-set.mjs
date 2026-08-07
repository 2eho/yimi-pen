import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalSha256 } from "../../scripts/snapshot-jcs.mjs";

const execFileAsync = promisify(execFile);

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function included(relative) {
  const parts = relative.split("/");
  if (relative.startsWith("build/") || relative.startsWith("node_modules/") || relative.startsWith(".git/")) return false;
  if (relative.startsWith("docs/codex/")) return false;
  if (parts.includes("target") || parts.includes("dist")) return false;
  return true;
}

export async function computeReleaseSourceSet(repoRoot) {
  const { stdout } = await execFileAsync("git", [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z",
  ], { cwd: repoRoot, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  const paths = Buffer.from(stdout).toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((value) => value.replaceAll("\\", "/"))
    .filter(included)
    .sort(ordinalCompare);
  const records = [];
  let totalBytes = 0;
  const realRepo = await realpath(repoRoot);
  for (const relative of paths) {
    const absolute = path.join(repoRoot, ...relative.split("/"));
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`release source must be a regular file: ${relative}`);
    const resolved = await realpath(absolute);
    if (!inside(realRepo, resolved)) throw new Error(`release source resolved outside repository: ${relative}`);
    const bytes = await readFile(resolved);
    totalBytes += bytes.length;
    records.push({
      path: relative,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return {
    profile: "release-source-set-v1",
    fileCount: records.length,
    totalBytes,
    sourceSetSha256: canonicalSha256(records).sha256,
  };
}
