import { createHash } from "node:crypto";
import { canonicalSha256 } from "../../../../scripts/snapshot-jcs.mjs";
import { isAuthoringImportedAsset } from "./authoring-contract.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$/u;
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u;
const PROVIDER_DESCRIPTOR_ID = /^tts-provider:sha256:[a-f0-9]{64}$/u;
const SOURCE_RECEIPT_ID = /^authoring-tts:sha256:[a-f0-9]{64}$/u;

const REQUEST_KEYS = Object.freeze([
  "schemaVersion",
  "profile",
  "transcript",
  "language",
  "mediaType",
]);
const PROVIDER_DESCRIPTOR_KEYS = Object.freeze([
  "schemaVersion",
  "profile",
  "providerDescriptorId",
  "providerId",
  "providerVersion",
  "providerClass",
  "qualification",
  "requiredCapability",
  "networkClassification",
  "privacyMode",
  "privacyPolicyId",
  "rightsPolicyId",
  "voiceIdentityId",
  "qualificationEvidenceSha256",
  "lifecycleControl",
  "canonicalizerId",
  "canonicalizerVersion",
  "outputCodec",
]);
const RESOURCE_POLICY_KEYS = Object.freeze([
  "schemaVersion",
  "profile",
  "maxTranscriptChars",
  "maxOutputBytes",
  "timeoutMs",
  "maxConcurrentJobs",
]);
const PROVIDER_RUN_KEYS = Object.freeze([
  "providerRunId",
  "requestSha256",
  "audioSha256",
  "audioBytes",
  "codecProfile",
]);
const PROVIDER_CLEANUP_KEYS = Object.freeze([
  "providerRunId",
  "requestSha256",
  "audioSha256",
  "codecProfile",
]);
const PROVIDER_OPERATION_KEYS = Object.freeze([
  "providerRunId",
  "completion",
  "cancelAndWait",
]);
const PROVIDER_CANCEL_KEYS = Object.freeze([
  "providerRunId",
  "settled",
  "cleanupComplete",
]);
const AUDIT_APPEND_KEYS = Object.freeze([
  "receiptId",
  "persisted",
]);
const AUDIT_OPERATION_KEYS = Object.freeze([
  "auditRunId",
  "completion",
  "cancelAndWait",
]);
const AUDIT_CANCEL_KEYS = Object.freeze([
  "auditRunId",
  "receiptId",
  "settled",
  "persisted",
]);
const SOURCE_RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "profile",
  "receiptId",
  "sessionId",
  "attemptId",
  "assetId",
  "sourceRequestSha256",
  "transcriptSha256",
  "language",
  "mediaType",
  "providerDescriptor",
  "importedAsset",
  "completedAt",
]);

export const SYSTEM_TTS_SOURCE_KIND = "SYSTEM_TTS";
export const SYSTEM_TTS_CLIP_SOURCE_KIND = "system-tts";
export const SYSTEM_TTS_CANONICAL_CODEC = "WAV_PCM16_16K_MONO";
export const SYSTEM_TTS_V1_APPROVED_FIXTURE_AUDIO_SHA256 =
  "b0322f22a2846117848b4dc8fd384be5f7e5d82c86f857da795206dd4ce6e66e";

export class SystemTtsContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SystemTtsContractError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details) {
  throw new SystemTtsContractError(code, message, details);
}

function assert(condition, code, message, details) {
  if (!condition) fail(code, message, details);
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function contentAddressed(prefix, value, identityKey) {
  const { [identityKey]: _identity, ...subject } = value;
  return `${prefix}${canonicalSha256(subject).sha256}`;
}

function validIsoInstant(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function optionalContentAddressed(prefix, value, identityKey) {
  if (!plainObject(value)) return null;
  try {
    return contentAddressed(prefix, value, identityKey);
  } catch {
    return null;
  }
}

function freezeImportedAsset(importedAsset) {
  return Object.freeze({
    assetId: importedAsset.assetId,
    contentPath: importedAsset.contentPath,
    bytes: importedAsset.bytes,
    sha256: importedAsset.sha256,
    durationMs: importedAsset.durationMs,
    codec: importedAsset.codec,
  });
}

function freezeProviderDescriptor(providerDescriptor) {
  return Object.freeze(structuredClone(providerDescriptor));
}

function validProviderDescriptor(providerDescriptor) {
  try {
    assertSystemTtsProviderDescriptor(providerDescriptor);
    return true;
  } catch {
    return false;
  }
}

export function sha256Utf8(value) {
  assert(typeof value === "string", "TTS_REQUEST_INVALID", "TTS text hash input must be a string");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createSystemTtsRequest({ transcript, language, mediaType = "voice" } = {}) {
  const request = {
    schemaVersion: 1,
    profile: "authoring-system-tts-request-v1",
    transcript,
    language,
    mediaType,
  };
  assertSystemTtsRequest(request);
  return Object.freeze(request);
}

export function assertSystemTtsRequest(request, resourcePolicy = null) {
  assert(exactKeys(request, REQUEST_KEYS)
    && request.schemaVersion === 1
    && request.profile === "authoring-system-tts-request-v1"
    && typeof request.transcript === "string"
    && request.transcript.length >= 1
    && request.transcript.length <= 1_000
    && !request.transcript.includes("\u0000")
    && LANGUAGE.test(request.language ?? "")
    && request.mediaType === "voice",
  "TTS_REQUEST_INVALID", "system TTS request is malformed");
  if (resourcePolicy !== null) {
    assertSystemTtsResourcePolicy(resourcePolicy);
    assert(request.transcript.length <= resourcePolicy.maxTranscriptChars,
      "TTS_RESOURCE_LIMIT_EXCEEDED", "system TTS request exceeds its text resource limit");
  }
  return request;
}

function providerDescriptorSubject(input) {
  return {
    schemaVersion: 1,
    profile: "authoring-system-tts-provider-v1",
    providerDescriptorId: "",
    providerId: input.providerId,
    providerVersion: input.providerVersion,
    providerClass: input.providerClass,
    qualification: input.qualification,
    requiredCapability: input.requiredCapability,
    networkClassification: input.networkClassification,
    privacyMode: input.privacyMode,
    privacyPolicyId: input.privacyPolicyId,
    rightsPolicyId: input.rightsPolicyId,
    voiceIdentityId: input.voiceIdentityId,
    qualificationEvidenceSha256: input.qualificationEvidenceSha256,
    lifecycleControl: input.lifecycleControl,
    canonicalizerId: input.canonicalizerId,
    canonicalizerVersion: input.canonicalizerVersion,
    outputCodec: input.outputCodec ?? SYSTEM_TTS_CANONICAL_CODEC,
  };
}

export function createSystemTtsProviderDescriptor(input = {}) {
  const descriptor = providerDescriptorSubject(input);
  descriptor.providerDescriptorId = contentAddressed("tts-provider:sha256:", descriptor, "providerDescriptorId");
  assertSystemTtsProviderDescriptor(descriptor);
  return Object.freeze(descriptor);
}

export function assertSystemTtsProviderDescriptor(descriptor, { allowFixture = true } = {}) {
  const identity = optionalContentAddressed("tts-provider:sha256:", descriptor, "providerDescriptorId");
  assert(exactKeys(descriptor, PROVIDER_DESCRIPTOR_KEYS)
    && descriptor.schemaVersion === 1
    && descriptor.profile === "authoring-system-tts-provider-v1"
    && PROVIDER_DESCRIPTOR_ID.test(descriptor.providerDescriptorId ?? "")
    && descriptor.providerDescriptorId === identity
    && TOKEN.test(descriptor.providerId ?? "")
    && TOKEN.test(descriptor.providerVersion ?? "")
    && ["FIXTURE_LOCAL", "LOCAL_SYSTEM"].includes(descriptor.providerClass)
    && ["FIXTURE", "QUALIFIED"].includes(descriptor.qualification)
    && descriptor.requiredCapability === null
    && ["NO_NETWORK_FIXTURE", "LOCAL_ENGINE_CANDIDATE"].includes(
      descriptor.networkClassification,
    )
    && ["LOCAL_ONLY", "REMOTE_TEXT_PROCESSING"].includes(descriptor.privacyMode)
    && TOKEN.test(descriptor.privacyPolicyId ?? "")
    && TOKEN.test(descriptor.rightsPolicyId ?? "")
    && TOKEN.test(descriptor.voiceIdentityId ?? "")
    && SHA256.test(descriptor.qualificationEvidenceSha256 ?? "")
    && descriptor.lifecycleControl === "SUPERVISED_ABORT_AND_WAIT"
    && TOKEN.test(descriptor.canonicalizerId ?? "")
    && TOKEN.test(descriptor.canonicalizerVersion ?? "")
    && descriptor.outputCodec === SYSTEM_TTS_CANONICAL_CODEC,
  "TTS_PROVIDER_DESCRIPTOR_INVALID", "system TTS provider descriptor is malformed");

  const fixtureCombination = descriptor.providerClass === "FIXTURE_LOCAL"
    && descriptor.qualification === "FIXTURE"
    && descriptor.requiredCapability === null
    && descriptor.networkClassification === "NO_NETWORK_FIXTURE"
    && descriptor.privacyMode === "LOCAL_ONLY";
  const localCombination = descriptor.providerClass === "LOCAL_SYSTEM"
    && descriptor.qualification === "QUALIFIED"
    && descriptor.requiredCapability === null
    && descriptor.networkClassification === "LOCAL_ENGINE_CANDIDATE"
    && descriptor.privacyMode === "LOCAL_ONLY";
  assert(fixtureCombination || localCombination,
    "TTS_PROVIDER_DESCRIPTOR_INVALID", "provider class, qualification, capability, and privacy mode disagree");
  assert(allowFixture || descriptor.qualification !== "FIXTURE",
    "TTS_PROVIDER_UNAVAILABLE", "fixture TTS provider is outside this composition authority");
  return descriptor;
}

export const SYSTEM_TTS_V1_APPROVED_FIXTURE_DESCRIPTOR = createSystemTtsProviderDescriptor({
  providerId: "fixture-local-system-tts",
  providerVersion: "1.0.0",
  providerClass: "FIXTURE_LOCAL",
  qualification: "FIXTURE",
  requiredCapability: null,
  networkClassification: "NO_NETWORK_FIXTURE",
  privacyMode: "LOCAL_ONLY",
  privacyPolicyId: "fixture-local-processing-v1",
  rightsPolicyId: "fixture-system-voice-v1",
  voiceIdentityId: `fixture-voice:sha256:${canonicalSha256({ fixture: "system-tts-voice-v1" }).sha256}`,
  qualificationEvidenceSha256: canonicalSha256({
    profile: "system-tts-fixture-qualification-v1",
    sourceAsset: "hardware/evt0/family-alpha-v1/golden/assets/clip-018-1.wav",
    sourceAssetSha256: SYSTEM_TTS_V1_APPROVED_FIXTURE_AUDIO_SHA256,
  }).sha256,
  lifecycleControl: "SUPERVISED_ABORT_AND_WAIT",
  canonicalizerId: "identity-canonical-wav",
  canonicalizerVersion: "1.0.0",
  outputCodec: SYSTEM_TTS_CANONICAL_CODEC,
});

export function createSystemTtsResourcePolicy({
  maxTranscriptChars,
  maxOutputBytes,
  timeoutMs,
  maxConcurrentJobs,
} = {}) {
  const policy = {
    schemaVersion: 1,
    profile: "authoring-system-tts-resource-policy-v1",
    maxTranscriptChars,
    maxOutputBytes,
    timeoutMs,
    maxConcurrentJobs,
  };
  assertSystemTtsResourcePolicy(policy);
  return Object.freeze(policy);
}

export function assertSystemTtsResourcePolicy(policy, { maxImportBytes = null } = {}) {
  assert(exactKeys(policy, RESOURCE_POLICY_KEYS)
    && policy.schemaVersion === 1
    && policy.profile === "authoring-system-tts-resource-policy-v1"
    && Number.isSafeInteger(policy.maxTranscriptChars)
    && policy.maxTranscriptChars >= 1
    && policy.maxTranscriptChars <= 1_000
    && Number.isSafeInteger(policy.maxOutputBytes)
    && policy.maxOutputBytes >= 46
    && policy.maxOutputBytes <= 64 * 1024 * 1024
    && Number.isSafeInteger(policy.timeoutMs)
    && policy.timeoutMs >= 100
    && policy.timeoutMs <= 10 * 60 * 1_000
    && Number.isSafeInteger(policy.maxConcurrentJobs)
    && policy.maxConcurrentJobs >= 1
    && policy.maxConcurrentJobs <= 16,
  "TTS_RESOURCE_POLICY_INVALID", "system TTS resource policy is malformed");
  if (maxImportBytes !== null) {
    assert(Number.isSafeInteger(maxImportBytes) && maxImportBytes > 0
      && policy.maxOutputBytes <= maxImportBytes,
    "TTS_RESOURCE_POLICY_INVALID", "TTS output limit exceeds the FamilyWorkspace import limit");
  }
  return policy;
}

export function assertSystemTtsProviderPort(providerPort, options = {}) {
  assert(providerPort
    && typeof providerPort.start === "function"
    && typeof providerPort.discard === "function",
  "TTS_PROVIDER_PORT_INVALID", "system TTS provider port requires supervised start and discard operations");
  assertSystemTtsProviderDescriptor(providerPort.descriptor, options);
  return providerPort;
}

export function assertSystemTtsProviderOperation(operation) {
  assert(exactKeys(operation, PROVIDER_OPERATION_KEYS)
    && TOKEN.test(operation.providerRunId ?? "")
    && operation.completion
    && typeof operation.completion.then === "function"
    && typeof operation.cancelAndWait === "function",
  "TTS_PROVIDER_OPERATION_INVALID", "system TTS provider returned a malformed supervised operation");
  return operation;
}

export function assertSystemTtsProviderCancelReceipt(receipt, { providerRunId } = {}) {
  assert(exactKeys(receipt, PROVIDER_CANCEL_KEYS)
    && TOKEN.test(receipt.providerRunId ?? "")
    && receipt.providerRunId === providerRunId
    && receipt.settled === true
    && receipt.cleanupComplete === true,
  "TTS_PROVIDER_SETTLEMENT_FAILED", "system TTS provider did not prove abort settlement");
  return receipt;
}

export function assertSystemTtsAuditAppendReceipt(receipt, { receiptId } = {}) {
  assert(exactKeys(receipt, AUDIT_APPEND_KEYS)
    && SOURCE_RECEIPT_ID.test(receipt.receiptId ?? "")
    && receipt.receiptId === receiptId
    && receipt.persisted === true,
  "TTS_AUDIT_RECEIPT_INVALID", "system TTS audit port did not prove the exact receipt was persisted");
  return receipt;
}

export function assertSystemTtsAuditOperation(operation) {
  assert(exactKeys(operation, AUDIT_OPERATION_KEYS)
    && TOKEN.test(operation.auditRunId ?? "")
    && operation.completion
    && typeof operation.completion.then === "function"
    && typeof operation.cancelAndWait === "function",
  "TTS_AUDIT_OPERATION_INVALID", "system TTS audit port returned a malformed supervised operation");
  return operation;
}

export function assertSystemTtsAuditCancelReceipt(receipt, { auditRunId, receiptId } = {}) {
  assert(exactKeys(receipt, AUDIT_CANCEL_KEYS)
    && TOKEN.test(receipt.auditRunId ?? "")
    && receipt.auditRunId === auditRunId
    && SOURCE_RECEIPT_ID.test(receipt.receiptId ?? "")
    && receipt.receiptId === receiptId
    && receipt.settled === true
    && typeof receipt.persisted === "boolean",
  "TTS_AUDIT_SETTLEMENT_FAILED", "system TTS audit port did not prove append settlement");
  return receipt;
}

export function assertSystemTtsProviderRunReceipt(receipt, {
  requestSha256,
  providerRunId,
  maxOutputBytes,
} = {}) {
  const audioBytes = receipt?.audioBytes;
  const byteView = audioBytes instanceof Uint8Array;
  const computedAudioSha256 = byteView
    ? createHash("sha256").update(audioBytes).digest("hex")
    : null;
  assert(exactKeys(receipt, PROVIDER_RUN_KEYS)
    && TOKEN.test(receipt.providerRunId ?? "")
    && SHA256.test(receipt.requestSha256 ?? "")
    && SHA256.test(receipt.audioSha256 ?? "")
    && receipt.audioSha256 === computedAudioSha256
    && byteView
    && audioBytes.byteLength >= 46
    && (maxOutputBytes === undefined || audioBytes.byteLength <= maxOutputBytes)
    && receipt.codecProfile === SYSTEM_TTS_CANONICAL_CODEC
    && (requestSha256 === undefined || receipt.requestSha256 === requestSha256)
    && (providerRunId === undefined || receipt.providerRunId === providerRunId),
  "TTS_PROVIDER_RECEIPT_INVALID", "system TTS provider returned a malformed private run receipt");
  return receipt;
}

export function createSystemTtsProviderCleanupReceipt(runReceipt) {
  assertSystemTtsProviderRunReceipt(runReceipt);
  return Object.freeze({
    providerRunId: runReceipt.providerRunId,
    requestSha256: runReceipt.requestSha256,
    audioSha256: runReceipt.audioSha256,
    codecProfile: runReceipt.codecProfile,
  });
}

export function assertSystemTtsProviderCleanupReceipt(receipt) {
  assert(exactKeys(receipt, PROVIDER_CLEANUP_KEYS)
    && TOKEN.test(receipt.providerRunId ?? "")
    && SHA256.test(receipt.requestSha256 ?? "")
    && SHA256.test(receipt.audioSha256 ?? "")
    && receipt.codecProfile === SYSTEM_TTS_CANONICAL_CODEC,
  "TTS_PROVIDER_RECEIPT_INVALID", "system TTS provider cleanup receipt is malformed");
  return receipt;
}

export function createSystemTtsSourceReceipt({
  sessionId,
  attemptId,
  assetId,
  request,
  providerDescriptor,
  importedAsset,
  completedAt,
} = {}) {
  assertSystemTtsRequest(request);
  assertSystemTtsProviderDescriptor(providerDescriptor);
  assert(isAuthoringImportedAsset(importedAsset)
    && Number.isSafeInteger(importedAsset.durationMs)
    && importedAsset.durationMs > 0
    && importedAsset.codec === SYSTEM_TTS_CANONICAL_CODEC,
  "TTS_IMPORT_RECEIPT_INVALID", "system TTS import receipt is malformed");
  assert(TOKEN.test(sessionId ?? "") && TOKEN.test(attemptId ?? "")
    && importedAsset.assetId === assetId && validIsoInstant(completedAt),
  "TTS_SOURCE_RECEIPT_INVALID", "system TTS source receipt identity is malformed");

  const receipt = {
    schemaVersion: 1,
    profile: "authoring-system-tts-source-receipt-v1",
    receiptId: "",
    sessionId,
    attemptId,
    assetId,
    sourceRequestSha256: canonicalSha256(request).sha256,
    transcriptSha256: sha256Utf8(request.transcript),
    language: request.language,
    mediaType: request.mediaType,
    providerDescriptor: freezeProviderDescriptor(providerDescriptor),
    importedAsset: freezeImportedAsset(importedAsset),
    completedAt,
  };
  receipt.receiptId = contentAddressed("authoring-tts:sha256:", receipt, "receiptId");
  assertSystemTtsSourceReceipt(receipt);
  return Object.freeze(receipt);
}

export function assertSystemTtsSourceReceipt(receipt) {
  const identity = optionalContentAddressed("authoring-tts:sha256:", receipt, "receiptId");
  assert(exactKeys(receipt, SOURCE_RECEIPT_KEYS)
    && receipt.schemaVersion === 1
    && receipt.profile === "authoring-system-tts-source-receipt-v1"
    && SOURCE_RECEIPT_ID.test(receipt.receiptId ?? "")
    && receipt.receiptId === identity
    && TOKEN.test(receipt.sessionId ?? "")
    && TOKEN.test(receipt.attemptId ?? "")
    && receipt.importedAsset?.assetId === receipt.assetId
    && SHA256.test(receipt.sourceRequestSha256 ?? "")
    && SHA256.test(receipt.transcriptSha256 ?? "")
    && LANGUAGE.test(receipt.language ?? "")
    && receipt.mediaType === "voice"
    && validProviderDescriptor(receipt.providerDescriptor)
    && isAuthoringImportedAsset(receipt.importedAsset)
    && receipt.importedAsset.codec === SYSTEM_TTS_CANONICAL_CODEC
    && Number.isSafeInteger(receipt.importedAsset.durationMs)
    && receipt.importedAsset.durationMs > 0
    && validIsoInstant(receipt.completedAt),
  "TTS_SOURCE_RECEIPT_INVALID", "system TTS source audit receipt is malformed");
  return receipt;
}
