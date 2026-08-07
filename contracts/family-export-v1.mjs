import { canonicalSha256 } from "../scripts/snapshot-jcs.mjs";

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function computeFamilyExportId(manifest) {
  const { exportId: _identity, ...subject } = manifest;
  return `family-export:sha256:${canonicalSha256(subject).sha256}`;
}

export function collectReferencedFamilyAssets(repositoryBackup) {
  const byIdentity = new Map();
  const bytesByDigest = new Map();
  for (const revision of repositoryBackup?.state?.revisions ?? []) {
    for (const clip of revision.bindings.flatMap((binding) => binding.clips)) {
      const identity = {
        assetId: clip.assetId,
        bytes: clip.assetBytes,
        sha256: clip.assetSha256,
      };
      const key = `${identity.assetId}\u0000${identity.sha256}`;
      const previous = byIdentity.get(key);
      if (previous && previous.bytes !== identity.bytes) {
        throw new Error(`${identity.assetId} repeats one digest with conflicting byte length`);
      }
      const digestBytes = bytesByDigest.get(identity.sha256);
      if (digestBytes !== undefined && digestBytes !== identity.bytes) {
        throw new Error(`${identity.sha256} maps to conflicting byte lengths`);
      }
      byIdentity.set(key, identity);
      bytesByDigest.set(identity.sha256, identity.bytes);
    }
  }
  return [...byIdentity.values()].sort((left, right) => (
    ordinalCompare(left.assetId, right.assetId) || ordinalCompare(left.sha256, right.sha256)
  ));
}

export function assertFamilyExportSemantics(manifest) {
  if (manifest.exportId !== computeFamilyExportId(manifest)) {
    throw new Error("family export semantic identity mismatch");
  }
  const identities = manifest.assets.map((asset) => `${asset.assetId}\u0000${asset.sha256}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error("family export assetId and sha256 identity must be unique");
  }
  if (manifest.assets.some((asset, index) => index > 0 && (
    ordinalCompare(manifest.assets[index - 1].assetId, asset.assetId)
      || ordinalCompare(manifest.assets[index - 1].sha256, asset.sha256)
  ) >= 0)) {
    throw new Error("family export assets must be strictly sorted by assetId and sha256");
  }
  const pathIdentity = new Map();
  for (const asset of manifest.assets) {
    if (asset.path !== `assets/${asset.sha256}.bin`) {
      throw new Error("family export content-addressed path must match asset sha256");
    }
    const previous = pathIdentity.get(asset.path);
    if (previous && previous !== `${asset.bytes}:${asset.sha256}`) {
      throw new Error("family export path maps to conflicting asset identities");
    }
    pathIdentity.set(asset.path, `${asset.bytes}:${asset.sha256}`);
  }
  return manifest;
}
