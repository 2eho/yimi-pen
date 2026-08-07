import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

const U64_MAX = 18_446_744_073_709_551_615n;
const U32_MAX = 4_294_967_295;
const HOST_SURROGATE_FORMULA = "9000000000000000 + logical OID numeric suffix; NOT AN OID CODE";
const HOST_SURROGATE_BASE = 9_000_000_000_000_000n;

export class NodeExecutionModelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NodeExecutionModelError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new NodeExecutionModelError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeJson(bytes, label) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(bytes));
  } catch (error) {
    fail("INVALID_UTF8", `${label} is not UTF-8: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("INVALID_JSON", `${label} JSON parse failed: ${error.message}`);
  }
}

function schemaErrors(validator) {
  return (validator.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

function validateSchema(validator, value, code, label) {
  if (!validator(value)) fail(code, `${label} schema failed: ${schemaErrors(validator)}`);
}

function assertUnique(values, code, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(code, `${label} must be unique: ${value}`);
    seen.add(value);
  }
}

function parseU64(value, code, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(value)) {
    fail(code, `${label} is not canonical decimal u64`);
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX) fail(code, `${label} exceeds u64`);
  return parsed;
}

function toSlot(value, code, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > U32_MAX) {
    fail(code, `${label} is outside u32`);
  }
  return value;
}

function expectedHostSurrogate(logicalOid) {
  const match = /-([0-9]+)$/u.exec(logicalOid);
  if (!match) fail("SURROGATE_FORMULA", `logical OID has no numeric suffix: ${logicalOid}`);
  const value = HOST_SURROGATE_BASE + BigInt(match[1]);
  if (value > U64_MAX) fail("SURROGATE_FORMULA", `host surrogate exceeds u64 for ${logicalOid}`);
  return value;
}

function buildClipCatalog(actionsDocument) {
  let source;
  let clipKeys;
  if (Array.isArray(actionsDocument.clips) && actionsDocument.clips.length > 0) {
    source = "snapshot-catalog";
    clipKeys = actionsDocument.clips.map((clip) => clip.clipId);
    for (const clip of actionsDocument.clips) {
      if (typeof clip.path !== "string"
        || clip.path.length === 0
        || !Number.isSafeInteger(clip.size)
        || clip.size <= 0
        || !/^[a-f0-9]{64}$/u.test(clip.sha256)
        || typeof clip.codec !== "string"
        || clip.codec.length === 0
        || typeof clip.mediaType !== "string"
        || clip.mediaType.length === 0) {
        fail("CLIP_METADATA", `clip catalog metadata is incomplete: ${clip.clipId}`);
      }
    }
  } else {
    source = "derived-design-fixture";
    clipKeys = [];
    const seen = new Set();
    for (const action of actionsDocument.actions) {
      for (const clipKey of action.clipIds) {
        if (!seen.has(clipKey)) {
          seen.add(clipKey);
          clipKeys.push(clipKey);
        }
      }
    }
  }
  if (clipKeys.length === 0) fail("EMPTY_CLIP_TABLE", "execution clip table is empty");
  assertUnique(clipKeys, "DUPLICATE_CLIP_KEY", "clip key");
  const byKey = new Map(clipKeys.map((key, slot) => [key, toSlot(slot, "TABLE_TOO_LARGE", "clip slot")]));
  return { source, clipKeys, byKey };
}

function buildActions(actionsDocument, clipCatalog) {
  assertUnique(
    actionsDocument.actions.map((action) => action.actionId),
    "DUPLICATE_ACTION_KEY",
    "action key",
  );
  const actionByKey = new Map();
  const actions = [];
  const usedClips = new Set();
  for (const [slotIndex, action] of actionsDocument.actions.entries()) {
    const actionSlot = toSlot(slotIndex, "TABLE_TOO_LARGE", "action slot");
    const clipSlots = action.clipIds.map((clipKey) => {
      const clipSlot = clipCatalog.byKey.get(clipKey);
      if (clipSlot === undefined) fail("MISSING_CLIP", `action references missing clip: ${clipKey}`);
      usedClips.add(clipKey);
      return clipSlot;
    });
    assertUnique(clipSlots, "DUPLICATE_CLIP_IN_ACTION", `${action.actionId} clip slot`);
    if ((action.playPolicy === "replace" && clipSlots.length !== 1)
      || (action.playPolicy === "random_one" && clipSlots.length < 2)
      || clipSlots.length === 0) {
      fail("POLICY_ARITY", `${action.actionId} clip count differs from ${action.playPolicy}`);
    }
    const cooldownUs = BigInt(action.cooldownMs) * 1_000n;
    if (cooldownUs > U64_MAX) fail("COOLDOWN_OVERFLOW", `${action.actionId} cooldown conversion exceeds u64`);
    actionByKey.set(action.actionId, actionSlot);
    actions.push({
      actionKey: action.actionId,
      actionSlot,
      playPolicy: action.playPolicy,
      cooldownUs,
      clipSlots,
    });
  }
  const unused = clipCatalog.clipKeys.filter((key) => !usedClips.has(key));
  if (unused.length > 0) fail("UNUSED_CLIP", `clip catalog contains an unused clip: ${unused[0]}`);
  return { actions, actionByKey };
}

function buildOidIndex(logicalIndex, transcript, actionTable) {
  if (logicalIndex.physicalMapStatus !== "unassigned"
    || logicalIndex.entries.some((entry) => entry.physicalCode !== null)) {
    fail("SNAPSHOT_NOT_UNASSIGNED", "host transcript requires an unassigned Snapshot index");
  }
  if (logicalIndex.entries.length !== transcript.physicalMap.length) {
    fail("PHYSICAL_MAP_COVERAGE", "host physical map does not exactly cover logical index");
  }
  assertUnique(logicalIndex.entries.map((entry) => entry.logicalOid), "DUPLICATE_LOGICAL_OID", "logical OID");
  assertUnique(transcript.physicalMap.map((entry) => entry.logicalOid), "DUPLICATE_MAP_OID", "physical map logical OID");
  assertUnique(transcript.physicalMap.map((entry) => entry.physicalCode), "DUPLICATE_PHYSICAL_CODE", "physicalCode");

  const oidIndex = [];
  const referencedActionSlots = new Set();
  let previousCode = null;
  for (let index = 0; index < logicalIndex.entries.length; index += 1) {
    const source = logicalIndex.entries[index];
    const mapped = transcript.physicalMap[index];
    if (source.logicalOid !== mapped.logicalOid) {
      fail("PHYSICAL_MAP_ORDER", `host physical map order differs at index ${index}`);
    }
    const physicalCodeValue = parseU64(mapped.physicalCode, "INVALID_PHYSICAL_CODE", "physicalCode");
    if (physicalCodeValue !== expectedHostSurrogate(source.logicalOid)) {
      fail("SURROGATE_FORMULA", `host surrogate differs from formula for ${source.logicalOid}`);
    }
    if (previousCode !== null && physicalCodeValue <= previousCode) {
      fail("OID_INDEX_NOT_SORTED", "physicalCode index must be strictly increasing");
    }
    previousCode = physicalCodeValue;
    const actionSlot = actionTable.actionByKey.get(source.actionId);
    if (actionSlot === undefined) fail("MISSING_ACTION", `logical index references missing action: ${source.actionId}`);
    if (referencedActionSlots.has(actionSlot)) {
      fail("DUPLICATE_ACTION_SLOT", `more than one logical OID references action slot ${actionSlot}`);
    }
    referencedActionSlots.add(actionSlot);
    oidIndex.push({
      physicalCode: mapped.physicalCode,
      physicalCodeValue,
      logicalOid: mapped.logicalOid,
      actionSlot,
    });
  }
  for (const action of actionTable.actions) {
    if (!referencedActionSlots.has(action.actionSlot)) {
      fail("UNREFERENCED_ACTION", `action is unreachable from OID index: ${action.actionKey}`);
    }
  }
  return oidIndex;
}

function expectedMatches(actual, expected) {
  return actual.decision === expected.decision
    && actual.actionKey === expected.actionKey
    && actual.actionSlot === expected.actionSlot
    && actual.playPolicy === expected.playPolicy
    && JSON.stringify(actual.clipKeys) === JSON.stringify(expected.clipKeys);
}

function executeTaps(oidIndex, actions, clipKeys, taps) {
  const actionByPhysicalCode = new Map(oidIndex.map((entry) => [entry.physicalCode, entry.actionSlot]));
  const lastPlayedAt = actions.map(() => null);
  const trace = [];
  assertUnique(taps.map((tap) => tap.id), "DUPLICATE_TAP_ID", "tap id");
  let previousEventAt = null;
  for (const tap of taps) {
    const eventAtUs = parseU64(tap.eventAtUs, "INVALID_EVENT_TIME", `${tap.id} eventAtUs`);
    if (previousEventAt !== null && eventAtUs < previousEventAt) {
      fail("NON_MONOTONIC_EVENT_TIME", `${tap.id} eventAtUs precedes the previous tap`);
    }
    previousEventAt = eventAtUs;
    if (tap.status === "valid" && tap.physicalCode === null) {
      fail("STATUS_CODE_MISMATCH", `${tap.id} valid event has no physical code`);
    }
    if ((tap.status === "no-code" || tap.status === "sensor-fault") && tap.physicalCode !== null) {
      fail("STATUS_CODE_MISMATCH", `${tap.id} ${tap.status} event carries a physical code`);
    }
    let decision;
    let action = null;
    let clipSlots = [];
    let randomIndexConsumed = false;

    if (tap.status !== "valid" || tap.physicalCode === null) {
      decision = "ignore-invalid";
    } else {
      parseU64(tap.physicalCode, "INVALID_PHYSICAL_CODE", `${tap.id} physicalCode`);
      const actionSlot = actionByPhysicalCode.get(tap.physicalCode);
      if (actionSlot === undefined) {
        decision = "unbound";
      } else {
        action = actions[actionSlot];
        const previous = lastPlayedAt[actionSlot];
        const elapsed = previous === null ? null : eventAtUs >= previous ? eventAtUs - previous : 0n;
        if (action.cooldownUs > 0n && elapsed !== null && elapsed < action.cooldownUs) {
          decision = "suppress-cooldown";
        } else {
          decision = "play";
          if (action.playPolicy === "replace") {
            clipSlots = [action.clipSlots[0]];
          } else if (action.playPolicy === "queue") {
            clipSlots = [...action.clipSlots];
          } else {
            randomIndexConsumed = true;
            if (tap.randomIndex === null) {
              fail("RANDOM_INDEX_OUT_OF_RANGE", `${tap.id} random_one selector is missing`);
            }
            const selected = toSlot(tap.randomIndex, "RANDOM_INDEX_OUT_OF_RANGE", `${tap.id} randomIndex`);
            if (selected >= action.clipSlots.length) {
              fail("RANDOM_INDEX_OUT_OF_RANGE", `${tap.id} randomIndex exceeds action clip count`);
            }
            clipSlots = [action.clipSlots[selected]];
          }
          lastPlayedAt[actionSlot] = eventAtUs;
        }
      }
    }

    const actual = {
      id: tap.id,
      decision,
      actionKey: action?.actionKey ?? null,
      actionSlot: action?.actionSlot ?? null,
      playPolicy: action?.playPolicy ?? null,
      clipKeys: clipSlots.map((slot) => clipKeys[slot]),
      clipSlots,
      randomIndexConsumed,
    };
    if (randomIndexConsumed !== (tap.randomIndex !== null)) {
      fail("RANDOM_INDEX_PRESENCE", `${tap.id} random index presence differs from planner consumption`);
    }
    trace.push({ ...actual, expectedMatched: expectedMatches(actual, tap.expected) });
  }
  return trace;
}

export function compileAndExecute({
  logicalIndexBytes,
  actionsBytes,
  transcriptBytes,
  validators,
}) {
  const logicalIndex = decodeJson(logicalIndexBytes, "logical-index");
  const actionsDocument = decodeJson(actionsBytes, "actions");
  const transcript = decodeJson(transcriptBytes, "execution transcript");
  validateSchema(validators.logicalIndex, logicalIndex, "LOGICAL_INDEX_SCHEMA", "logical-index");
  validateSchema(validators.actions, actionsDocument, "ACTIONS_SCHEMA", "actions");
  validateSchema(validators.transcript, transcript, "TRANSCRIPT_SCHEMA", "execution transcript");
  if (transcript.hostSurrogateFormula !== HOST_SURROGATE_FORMULA
    || transcript.fixtureOnly !== true
    || transcript.physicalEvidence !== false) {
    fail("INPUT_CONTRACT", "execution transcript differs from the v1 host-fixture contract");
  }

  const clipCatalog = buildClipCatalog(actionsDocument);
  const actionTable = buildActions(actionsDocument, clipCatalog);
  const oidIndex = buildOidIndex(logicalIndex, transcript, actionTable);
  const trace = executeTaps(oidIndex, actionTable.actions, clipCatalog.clipKeys, transcript.taps);
  const result = {
    schemaVersion: 1,
    profile: "snapshot-execution-result-v1",
    sourceProfile: transcript.sourceProfile,
    executionModel: {
      schemaVersion: 1,
      profile: "snapshot-execution-model-v1",
      source: {
        logicalIndexSha256: sha256(logicalIndexBytes),
        actionsSha256: sha256(actionsBytes),
        physicalMapSource: "host-surrogate-not-oid",
        physicalEvidence: false,
        clipCatalogSource: clipCatalog.source,
      },
      oidIndex: oidIndex.map(({ physicalCode, logicalOid, actionSlot }) => ({
        physicalCode,
        logicalOid,
        actionSlot,
      })),
      actions: actionTable.actions.map((action) => ({
        actionKey: action.actionKey,
        actionSlot: action.actionSlot,
        playPolicy: action.playPolicy,
        cooldownUs: action.cooldownUs.toString(),
        clipSlots: [...action.clipSlots],
      })),
      clips: clipCatalog.clipKeys.map((clipKey, clipSlot) => ({ clipKey, clipSlot })),
    },
    trace,
    allPassed: trace.every((entry) => entry.expectedMatched),
  };
  validateSchema(validators.result, result, "RESULT_SCHEMA", "Node execution result");
  return result;
}
