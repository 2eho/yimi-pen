import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const U64_SPACE = 1n << 64n;
export const U64_MAX = U64_SPACE - 1n;
export const U32_MAX = 0xffff_ffff;
export const MAX_WEIGHTED_CLIPS_V2 = 32;

export class WeightedRandomV2Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WeightedRandomV2Error";
    this.code = code;
  }
}

function fail(code, message) {
  throw new WeightedRandomV2Error(code, message);
}

function requireValue(condition, code, message) {
  if (!condition) fail(code, message);
}

export function parseCanonicalU64(value, label = "u64") {
  requireValue(typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/u.test(value), "U64_NOT_CANONICAL", `${label} is not a canonical decimal u64`);
  const parsed = BigInt(value);
  requireValue(parsed <= U64_MAX, "U64_OUT_OF_RANGE", `${label} exceeds u64`);
  return parsed;
}

function validateClips(clips) {
  requireValue(Array.isArray(clips) && clips.length >= 2, "TOO_FEW_CLIPS", "weighted random requires at least two clips");
  requireValue(clips.length <= MAX_WEIGHTED_CLIPS_V2, "TOO_MANY_CLIPS", "weighted random exceeds 32 clips");
  const slots = new Set();
  let totalWeight = 0n;
  for (const [index, clip] of clips.entries()) {
    requireValue(clip && typeof clip === "object" && !Array.isArray(clip), "CLIP_INVALID", `clip ${index} is not an object`);
    requireValue(Number.isInteger(clip.clipSlot) && clip.clipSlot >= 0 && clip.clipSlot <= U32_MAX, "CLIP_SLOT_INVALID", `clip ${index} slot is not u32`);
    requireValue(!slots.has(clip.clipSlot), "DUPLICATE_CLIP_SLOT", `clip slot ${clip.clipSlot} is duplicated`);
    slots.add(clip.clipSlot);
    requireValue(Number.isInteger(clip.weight) && clip.weight > 0 && clip.weight <= U32_MAX, "WEIGHT_INVALID", `clip ${index} weight is not positive u32`);
    totalWeight += BigInt(clip.weight);
  }
  return totalWeight;
}

export function selectWeightedV2(clips, rawWords) {
  const totalWeight = validateClips(clips);
  requireValue(Array.isArray(rawWords) && rawWords.length > 0, "RANDOM_SOURCE_EXHAUSTED", "raw random-word source is empty");
  const rejectionThreshold = U64_SPACE % totalWeight;
  let acceptedRawWord = null;
  let consumedWords = 0;
  for (const [index, value] of rawWords.entries()) {
    const word = parseCanonicalU64(value, `rawWords[${index}]`);
    consumedWords += 1;
    if (word >= rejectionThreshold) {
      acceptedRawWord = word;
      break;
    }
  }
  requireValue(acceptedRawWord !== null, "RANDOM_SOURCE_EXHAUSTED", "all supplied random words were rejected");
  const ticket = acceptedRawWord % totalWeight;
  let upperExclusive = 0n;
  let selectedIndex = -1;
  for (const [index, clip] of clips.entries()) {
    upperExclusive += BigInt(clip.weight);
    if (ticket < upperExclusive) {
      selectedIndex = index;
      break;
    }
  }
  requireValue(selectedIndex >= 0, "INTERNAL_RANGE_ERROR", "validated weights did not contain the ticket");
  const acceptedWordCount = U64_SPACE - rejectionThreshold;
  requireValue(acceptedWordCount % totalWeight === 0n, "UNIFORMITY_PROOF_FAILED", "accepted sample space is not divisible by total weight");
  return {
    selectedIndex,
    selectedClipSlot: clips[selectedIndex].clipSlot,
    totalWeight: totalWeight.toString(),
    rejectionThreshold: rejectionThreshold.toString(),
    acceptedRawWord: acceptedRawWord.toString(),
    ticket: ticket.toString(),
    consumedWords,
    acceptedWordCount: acceptedWordCount.toString(),
    bucketPreimageCount: (acceptedWordCount / totalWeight).toString(),
  };
}

function validateEnvelope(transcript) {
  requireValue(transcript?.schemaVersion === 2, "TRANSCRIPT_VERSION_UNSUPPORTED", "weighted transcript schemaVersion must be 2");
  requireValue(transcript.profile === "weighted-random-transcript-v2", "TRANSCRIPT_PROFILE_UNSUPPORTED", "weighted transcript profile is unsupported");
  requireValue(transcript.algorithmId === "yimi-weighted-random-v2", "ALGORITHM_UNSUPPORTED", "weighted algorithmId is unsupported");
  requireValue(transcript.hostFixture === true && transcript.physicalEvidence === false && transcript.productionEvidence === false, "EVIDENCE_BOUNDARY_INVALID", "host transcript evidence boundary is invalid");
  const algorithm = transcript.algorithm;
  requireValue(
    algorithm?.randomWordBits === 64
      && algorithm.weightType === "positive-u32"
      && algorithm.minClips === 2
      && algorithm.maxClips === 32
      && algorithm.rejectionRule === "reject rawWord < (2^64 mod totalWeight)"
      && algorithm.ticketRule === "acceptedRawWord mod totalWeight"
      && algorithm.selectionRule === "first half-open cumulative interval in clip array order",
    "ALGORITHM_METADATA_DRIFT",
    "weighted algorithm metadata differs from v2",
  );
  requireValue(Array.isArray(transcript.scenarios) && transcript.scenarios.length > 0, "SCENARIOS_EMPTY", "weighted transcript has no scenarios");
}

export function evaluateTranscript(transcript, transcriptBytes) {
  validateEnvelope(transcript);
  const ids = new Set();
  const results = [];
  for (const scenario of transcript.scenarios) {
    requireValue(typeof scenario?.id === "string" && scenario.id.length > 0, "SCENARIO_ID_INVALID", "scenario id is empty");
    requireValue(!ids.has(scenario.id), "DUPLICATE_SCENARIO_ID", `scenario ${scenario.id} is duplicated`);
    ids.add(scenario.id);
    const actual = selectWeightedV2(scenario.clips, scenario.rawWords);
    const expectedMatched = isDeepStrictEqual(actual, scenario.expected);
    requireValue(expectedMatched, "EXPECTED_MISMATCH", `scenario ${scenario.id} differs from its frozen expectation`);
    results.push({ id: scenario.id, ...actual, expectedMatched });
  }
  return {
    schemaVersion: 2,
    profile: "weighted-random-result-v2",
    algorithmId: "yimi-weighted-random-v2",
    transcriptSha256: createHash("sha256").update(transcriptBytes).digest("hex"),
    results,
    allPassed: true,
  };
}

export function encodeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
