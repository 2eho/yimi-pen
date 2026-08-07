const U64_MAX = 18_446_744_073_709_551_615n;

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function canonicalU64(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(value)) return false;
  try { return BigInt(value) <= U64_MAX; } catch { return false; }
}

export function snapshotProjectionErrors({ logicalIndex, actions, manifest, manifestByteLength }) {
  const errors = [];
  const entries = Array.isArray(logicalIndex?.entries) ? logicalIndex.entries : [];
  const actionList = Array.isArray(actions?.actions) ? actions.actions : [];
  const clips = Array.isArray(actions?.clips) ? actions.clips : null;

  if (manifest?.releaseState === "release-candidate" && !clips) {
    errors.push("RELEASE_CLIP_CATALOG_REQUIRED");
  }

  for (const key of ["logicalOid", "actionId"]) {
    const duplicates = duplicateValues(entries.map((item) => item[key]));
    if (duplicates.length) errors.push(`INDEX_DUPLICATE_${key.toUpperCase()}`);
  }
  const assignedCodes = entries.filter((item) => item.physicalCode !== null).map((item) => item.physicalCode);
  if (duplicateValues(assignedCodes).length) errors.push("INDEX_DUPLICATE_PHYSICAL_CODE");
  const assignedCodesCanonical = assignedCodes.every((value) => canonicalU64(value));
  if (!assignedCodesCanonical) errors.push("INDEX_PHYSICAL_CODE_OUT_OF_U64");
  if (logicalIndex?.physicalMapStatus === "unassigned" && assignedCodes.length !== 0) {
    errors.push("INDEX_UNASSIGNED_HAS_PHYSICAL_CODE");
  }
  if (logicalIndex?.physicalMapStatus === "assigned" && assignedCodes.length !== entries.length) {
    errors.push("INDEX_ASSIGNED_HAS_NULL_PHYSICAL_CODE");
  }
  if (
    logicalIndex?.physicalMapStatus === "assigned"
    && assignedCodesCanonical
    && assignedCodes.length === entries.length
    && assignedCodes.some((value, index) => index > 0 && BigInt(assignedCodes[index - 1]) >= BigInt(value))
  ) {
    errors.push("INDEX_PHYSICAL_CODE_NOT_ASCENDING");
  }

  const actionIds = actionList.map((item) => item.actionId);
  if (duplicateValues(actionIds).length) errors.push("ACTION_DUPLICATE_ACTION_ID");
  const indexedActionIds = entries.map((item) => item.actionId);
  const actionIdSet = new Set(actionIds);
  const indexedActionIdSet = new Set(indexedActionIds);
  if (indexedActionIds.some((id) => !actionIdSet.has(id)) || actionIds.some((id) => !indexedActionIdSet.has(id))) {
    errors.push("INDEX_ACTION_SET_MISMATCH");
  }
  for (const action of actionList) {
    if (action.playPolicy === "replace" && action.clipIds?.length !== 1) errors.push("ACTION_REPLACE_CARDINALITY");
    if (action.playPolicy === "random_one" && (action.clipIds?.length ?? 0) < 2) errors.push("ACTION_RANDOM_ONE_CARDINALITY");
  }

  if (clips) {
    const clipIds = clips.map((item) => item.clipId);
    const clipPaths = clips.map((item) => item.path);
    if (duplicateValues(clipIds).length) errors.push("CLIP_DUPLICATE_CLIP_ID");
    if (duplicateValues(clipPaths).length) errors.push("CLIP_DUPLICATE_PATH");
    const catalogIds = new Set(clipIds);
    const referencedIds = new Set(actionList.flatMap((item) => item.clipIds ?? []));
    if ([...referencedIds].some((id) => !catalogIds.has(id))) errors.push("ACTION_CLIP_REFERENCE_MISSING");
    if ([...catalogIds].some((id) => !referencedIds.has(id))) errors.push("CLIP_CATALOG_ENTRY_UNUSED");
  }

  if (manifest) {
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const filePaths = files.map((file) => file.path);
    if (duplicateValues(filePaths).length) errors.push("MANIFEST_DUPLICATE_PATH");
    const fileMap = new Map(files.map((file) => [file.path, file]));
    const indexFile = fileMap.get(manifest.oidIndex?.path);
    if (
      !indexFile || indexFile.role !== "oid-index" || indexFile.size !== manifest.oidIndex?.size ||
      indexFile.sha256 !== manifest.oidIndex?.sha256
    ) errors.push("MANIFEST_INDEX_REFERENCE_MISMATCH");
    if (manifest.oidIndex?.entryCount !== entries.length) errors.push("MANIFEST_INDEX_COUNT_MISMATCH");
    const actionFile = fileMap.get(manifest.actions?.path);
    if (
      !actionFile || actionFile.role !== "actions" || actionFile.size !== manifest.actions?.size ||
      actionFile.sha256 !== manifest.actions?.sha256
    ) errors.push("MANIFEST_ACTION_REFERENCE_MISMATCH");
    if (manifest.actions?.actionCount !== actionList.length) errors.push("MANIFEST_ACTION_COUNT_MISMATCH");
    if (manifest.target?.physicalMapStatus !== logicalIndex?.physicalMapStatus) {
      errors.push("MANIFEST_INDEX_PHYSICAL_STATUS_MISMATCH");
    }
    if (Number.isSafeInteger(manifestByteLength)) {
      const treeBytes = files.reduce((sum, file) => sum + file.size, manifestByteLength);
      if (manifest.install?.requiredBytes !== treeBytes) errors.push("MANIFEST_REQUIRED_BYTES_MISMATCH");
    }
    if (clips && clips.some((clip) => {
      const file = fileMap.get(clip.path);
      return !file || file.role !== "audio" || file.size !== clip.size || file.sha256 !== clip.sha256 || file.codec !== clip.codec;
    })) errors.push("CLIP_MANIFEST_PROJECTION_MISMATCH");
    const catalogPaths = new Set((clips ?? []).map((clip) => clip.path));
    if (files.some((file) => file.role === "audio" && !catalogPaths.has(file.path))) {
      errors.push("MANIFEST_AUDIO_FILE_UNUSED");
    }
    if (manifest.releaseState === "release-candidate" && !files.some((file) => file.role === "audio")) {
      errors.push("RELEASE_AUDIO_FILE_REQUIRED");
    }
  }

  return [...new Set(errors)];
}
