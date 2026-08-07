const SHA256 = /^[a-f0-9]{64}$/u;
const ASSET_ID = /^asset-[a-z0-9][a-z0-9._-]{2,95}$/u;
const PORTABLE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)(?!.*\/$)[A-Za-z0-9._\/-]+$/u;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;

export const AUTHORING_CLIP_SOURCE_KINDS = Object.freeze([
  "family-recording",
  "system-tts",
]);

export const AUTHORING_MEDIA_TYPES = Object.freeze([
  "voice",
  "narration",
  "sfx",
  "song",
]);

/**
 * Target-neutral receipt accepted by Family authoring. Local absolute paths,
 * picker handles, capture devices, and permission payloads are deliberately
 * outside this contract.
 */
export function isAuthoringImportedAsset(importedAsset) {
  return Boolean(importedAsset
    && ASSET_ID.test(importedAsset.assetId ?? "")
    && SHA256.test(importedAsset.sha256 ?? "")
    && Number.isSafeInteger(importedAsset.bytes) && importedAsset.bytes > 0
    && typeof importedAsset.codec === "string" && importedAsset.codec.length > 0
    && PORTABLE_PATH.test(importedAsset.contentPath ?? ""));
}

export function isAuthoringClipMetadata(clipMetadata) {
  return Boolean(clipMetadata
    && AUTHORING_CLIP_SOURCE_KINDS.includes(clipMetadata.sourceKind)
    && typeof clipMetadata.transcript === "string"
    && clipMetadata.transcript.length >= 1
    && clipMetadata.transcript.length <= 1_000
    && AUTHORING_MEDIA_TYPES.includes(clipMetadata.mediaType)
    && LANGUAGE.test(clipMetadata.language ?? ""));
}

export function isAuthoringSourceProducer(sourceProducer) {
  return Boolean(sourceProducer
    && typeof sourceProducer.name === "string"
    && sourceProducer.name.length >= 1
    && sourceProducer.name.length <= 96
    && typeof sourceProducer.version === "string"
    && sourceProducer.version.length >= 1
    && sourceProducer.version.length <= 32);
}
