import { canonicalSha256 } from "../scripts/snapshot-jcs.mjs";

const U64_MAX = 18_446_744_073_709_551_615n;

function canonicalU64(value) {
  try {
    return typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) <= U64_MAX;
  } catch {
    return false;
  }
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function assertUnique(values, label) {
  const duplicates = duplicateValues(values);
  if (duplicates.length) throw new Error(`${label} must be unique: ${duplicates.join(", ")}`);
}

function assertOrdinallySorted(values, label) {
  if (values.some((value, index) => index > 0 && values[index - 1] >= value)) {
    throw new Error(`${label} must be strictly ordinally sorted`);
  }
}

export function actionIdFor(bindingId) {
  return `action-${bindingId.slice("binding-".length)}`;
}

export function computeFamilyRevisionId(revision) {
  const { revisionId: _revisionId, ...identity } = revision;
  return `sha256:${canonicalSha256(identity).sha256}`;
}

export function assertFamilyRevisionSemantics(familyRevision) {
  if (!canonicalU64(familyRevision.revisionNumber) || BigInt(familyRevision.revisionNumber) === 0n) {
    throw new Error("revisionNumber must fit non-zero u64");
  }
  if (familyRevision.revisionId !== computeFamilyRevisionId(familyRevision)) {
    throw new Error("FamilyRevision semantic identity mismatch");
  }
  const bindings = familyRevision.bindings;
  assertUnique(bindings.map((binding) => binding.bindingId), "bindingId");
  assertUnique(bindings.map((binding) => binding.logicalOid), "logicalOid");
  assertUnique(bindings.flatMap((binding) => binding.clips.map((clip) => clip.clipId)), "clipId");
  assertUnique(bindings.map((binding) => actionIdFor(binding.bindingId)), "derived actionId");
  assertOrdinallySorted(bindings.map((binding) => binding.logicalOid), "FamilyRevision bindings");
  for (const binding of bindings) {
    if (binding.playPolicy === "replace" && binding.clips.length !== 1) {
      throw new Error("replace requires exactly one clip");
    }
    if (binding.playPolicy === "random_one" && binding.clips.length < 2) {
      throw new Error("random_one requires at least two clips");
    }
  }
  return familyRevision;
}

function bindingContentIdentity(binding) {
  const { bindingRevision: _bindingRevision, ...identity } = binding;
  return canonicalSha256(identity).sha256;
}

export function assertFamilyRevisionTransition(previousRevision, nextRevision) {
  if (previousRevision === null) {
    if (nextRevision.bindings.some((binding) => binding.bindingRevision !== 1)) {
      throw new Error("initial FamilyRevision bindings must start at bindingRevision 1");
    }
    return nextRevision;
  }
  if (nextRevision.familyLibraryId !== previousRevision.familyLibraryId) {
    throw new Error("FamilyRevision transition crosses family libraries");
  }
  if (Date.parse(nextRevision.createdAt) < Date.parse(previousRevision.createdAt)) {
    throw new Error("FamilyRevision createdAt precedes its parent revision");
  }
  const previousById = new Map(previousRevision.bindings.map((binding) => [binding.bindingId, binding]));
  for (const binding of nextRevision.bindings) {
    const previous = previousById.get(binding.bindingId);
    if (!previous) {
      if (binding.bindingRevision !== 1) throw new Error(`${binding.bindingId} new binding must start at revision 1`);
      continue;
    }
    const changed = bindingContentIdentity(binding) !== bindingContentIdentity(previous);
    const expected = changed ? previous.bindingRevision + 1 : previous.bindingRevision;
    if (expected > 4_294_967_295 || binding.bindingRevision !== expected) {
      throw new Error(`${binding.bindingId} bindingRevision does not match its content transition`);
    }
  }
  return nextRevision;
}
