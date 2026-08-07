import { createHash } from "node:crypto";

function assertValidUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("JCS input contains an unpaired high surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("JCS input contains an unpaired low surrogate");
    }
  }
}

export function canonicalize(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS only accepts finite JSON numbers");
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JCS input must contain plain JSON objects");
    }
    const keys = Object.keys(value);
    for (const key of keys) assertValidUnicode(key);
    keys.sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new TypeError(`JCS does not accept ${typeof value}`);
}

export function canonicalSha256(value) {
  const canonical = canonicalize(value);
  return {
    canonical,
    sha256: createHash("sha256").update(canonical, "utf8").digest("hex"),
  };
}

export function snapshotHashInput(manifest) {
  const { createdAt: _createdAt, snapshotId: _snapshotId, ...hashInput } = manifest;
  return hashInput;
}

