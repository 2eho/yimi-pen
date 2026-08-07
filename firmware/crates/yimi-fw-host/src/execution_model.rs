use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use yimi_fw_contract::{
    ActionSlot, ClipSlot, MonotonicUs, OidStatus, PhysicalCode, PhysicalCodeEvent, PlayPolicy,
};
use yimi_runtime_core::{
    ActionDescriptor, ExecutionModel, OidIndexEntry, PlaybackPlan, PointReadRuntime,
    RandomIndexSource, RuntimeDecision,
};

const JSON_SAFE_INTEGER_MAX: u64 = 9_007_199_254_740_991;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogicalIndexDocument {
    schema_version: u32,
    physical_map_status: String,
    entries: Vec<LogicalIndexRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LogicalIndexRecord {
    physical_code: Option<String>,
    logical_oid: String,
    action_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActionsDocument {
    schema_version: u32,
    actions: Vec<ActionRecord>,
    #[serde(default)]
    clips: Option<Vec<ClipRecord>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActionRecord {
    action_id: String,
    play_policy: WirePlayPolicy,
    clip_ids: Vec<String>,
    cooldown_ms: u64,
    #[serde(default, rename = "designSource")]
    design_source: Option<String>,
    #[serde(default, rename = "codecPlan")]
    codec_plan: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClipRecord {
    clip_id: String,
    path: String,
    size: u64,
    sha256: String,
    codec: String,
    media_type: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum WirePlayPolicy {
    Replace,
    Queue,
    RandomOne,
}

impl From<WirePlayPolicy> for PlayPolicy {
    fn from(value: WirePlayPolicy) -> Self {
        match value {
            WirePlayPolicy::Replace => Self::Replace,
            WirePlayPolicy::Queue => Self::Queue,
            WirePlayPolicy::RandomOne => Self::RandomOne,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Transcript {
    schema_version: u32,
    profile: String,
    source_profile: String,
    fixture_only: bool,
    physical_evidence: bool,
    host_surrogate_formula: String,
    physical_map: Vec<PhysicalMapRecord>,
    taps: Vec<TapRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PhysicalMapRecord {
    logical_oid: String,
    physical_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TapRecord {
    id: String,
    status: WireOidStatus,
    physical_code: Option<String>,
    event_at_us: String,
    random_index: Option<u32>,
    expected: ExpectedTrace,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum WireOidStatus {
    Valid,
    LowQuality,
    NoCode,
    SensorFault,
}

impl From<WireOidStatus> for OidStatus {
    fn from(value: WireOidStatus) -> Self {
        match value {
            WireOidStatus::Valid => Self::Valid,
            WireOidStatus::LowQuality => Self::LowQuality,
            WireOidStatus::NoCode => Self::NoCode,
            WireOidStatus::SensorFault => Self::SensorFault,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedTrace {
    decision: WireDecision,
    action_key: Option<String>,
    action_slot: Option<u32>,
    play_policy: Option<WirePlayPolicy>,
    clip_keys: Vec<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum WireDecision {
    IgnoreInvalid,
    SuppressCooldown,
    Unbound,
    Play,
}

impl WireDecision {
    const fn as_str(self) -> &'static str {
        match self {
            Self::IgnoreInvalid => "ignore-invalid",
            Self::SuppressCooldown => "suppress-cooldown",
            Self::Unbound => "unbound",
            Self::Play => "play",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionResult {
    schema_version: u32,
    profile: &'static str,
    source_profile: String,
    execution_model: ModelOutput,
    trace: Vec<TraceOutput>,
    all_passed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelOutput {
    schema_version: u32,
    profile: &'static str,
    source: ModelSource,
    oid_index: Vec<OidOutput>,
    actions: Vec<ActionOutput>,
    clips: Vec<ClipOutput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelSource {
    logical_index_sha256: String,
    actions_sha256: String,
    physical_map_source: &'static str,
    physical_evidence: bool,
    clip_catalog_source: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OidOutput {
    physical_code: String,
    logical_oid: String,
    action_slot: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionOutput {
    action_key: String,
    action_slot: u32,
    play_policy: WirePlayPolicy,
    cooldown_us: String,
    clip_slots: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipOutput {
    clip_key: String,
    clip_slot: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TraceOutput {
    id: String,
    decision: String,
    action_key: Option<String>,
    action_slot: Option<u32>,
    play_policy: Option<WirePlayPolicy>,
    clip_keys: Vec<String>,
    clip_slots: Vec<u32>,
    random_index_consumed: bool,
    expected_matched: bool,
}

struct FixedSelector {
    value: Option<u32>,
    consumed: bool,
}

struct ClipCatalog {
    keys: Vec<String>,
    by_key: HashMap<String, u32>,
    source: &'static str,
}

struct ActionTables {
    descriptors: Vec<ActionDescriptor>,
    clips: Vec<ClipSlot>,
    output: Vec<ActionOutput>,
}

impl RandomIndexSource for FixedSelector {
    fn select(&mut self, _action: ActionSlot, _upper_exclusive: u32) -> u32 {
        self.consumed = true;
        self.value.unwrap_or(u32::MAX)
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<(Vec<u8>, T), String> {
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    let value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("parse {}: {error}", path.display()))?;
    Ok((bytes, value))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn parse_u64(value: &str, label: &str) -> Result<u64, String> {
    let parsed = value
        .parse::<u64>()
        .map_err(|error| format!("{label} is outside u64: {error}"))?;
    if parsed.to_string() != value {
        return Err(format!("{label} is not canonical decimal u64"));
    }
    Ok(parsed)
}

fn expected_host_surrogate(logical_oid: &str) -> Result<u64, String> {
    let (_, suffix) = logical_oid
        .rsplit_once('-')
        .ok_or_else(|| format!("logical OID has no numeric suffix: {logical_oid}"))?;
    let suffix = suffix
        .parse::<u64>()
        .map_err(|error| format!("logical OID numeric suffix is outside u64: {error}"))?;
    9_000_000_000_000_000_u64
        .checked_add(suffix)
        .ok_or_else(|| "host surrogate formula overflow".to_owned())
}

fn unique(values: impl IntoIterator<Item = String>, label: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for value in values {
        if !seen.insert(value.clone()) {
            return Err(format!("duplicate {label}: {value}"));
        }
    }
    Ok(())
}

fn valid_ascii_key(
    value: &str,
    min_len: usize,
    max_len: usize,
    first: impl Fn(u8) -> bool,
    rest: impl Fn(u8) -> bool,
) -> bool {
    let bytes = value.as_bytes();
    (min_len..=max_len).contains(&bytes.len())
        && bytes.first().is_some_and(|byte| first(*byte))
        && bytes.iter().skip(1).all(|byte| rest(*byte))
}

fn valid_upper_key(value: &str) -> bool {
    valid_ascii_key(
        value,
        3,
        64,
        |byte| byte.is_ascii_uppercase() || byte.is_ascii_digit(),
        |byte| {
            byte.is_ascii_uppercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        },
    )
}

fn valid_lower_key(value: &str) -> bool {
    valid_ascii_key(
        value,
        3,
        64,
        |byte| byte.is_ascii_lowercase() || byte.is_ascii_digit(),
        |byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        },
    )
}

fn valid_prefixed_key(value: &str, prefix: &str) -> bool {
    value.strip_prefix(prefix).is_some_and(valid_lower_key)
}

fn valid_tap_id(value: &str) -> bool {
    value.strip_prefix("TAP-").is_some_and(|suffix| {
        (2..=31).contains(&suffix.len())
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'-')
    })
}

fn valid_safe_path(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.contains("//")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'/' | b'-'))
        && value
            .split('/')
            .all(|segment| !matches!(segment, "." | ".."))
}

fn valid_bounded_text(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.chars().count())
}

fn build_clip_catalog(document: &ActionsDocument) -> Result<ClipCatalog, String> {
    let clip_keys: Vec<String> = if document.clips.is_none() {
        let mut keys = Vec::new();
        for action in &document.actions {
            for clip in &action.clip_ids {
                if !keys.contains(clip) {
                    keys.push(clip.clone());
                }
            }
        }
        keys
    } else {
        let clips = document.clips.as_deref().unwrap_or_default();
        if clips.is_empty() {
            return Err("explicit clip catalog is empty".to_owned());
        }
        for clip in clips {
            if !valid_prefixed_key(&clip.clip_id, "clip-")
                || !valid_safe_path(&clip.path)
                || clip.size == 0
                || clip.size > JSON_SAFE_INTEGER_MAX
                || clip.sha256.len() != 64
                || !clip
                    .sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                || !valid_bounded_text(&clip.codec, 1, 64)
                || !matches!(
                    clip.media_type.as_str(),
                    "voice" | "narration" | "sfx" | "song" | "bgm"
                )
            {
                return Err(format!(
                    "clip catalog metadata is incomplete: {}",
                    clip.clip_id
                ));
            }
        }
        clips.iter().map(|clip| clip.clip_id.clone()).collect()
    };
    if clip_keys.is_empty() {
        return Err("execution clip table is empty".to_owned());
    }
    unique(clip_keys.clone(), "clip key")?;
    let by_key = clip_keys
        .iter()
        .enumerate()
        .map(|(slot, key)| {
            u32::try_from(slot)
                .map(|slot| (key.clone(), slot))
                .map_err(|_| "clip table exceeds u32".to_owned())
        })
        .collect::<Result<_, _>>()?;
    let source = if document.clips.is_none() {
        "derived-design-fixture"
    } else {
        "snapshot-catalog"
    };
    Ok(ClipCatalog {
        keys: clip_keys,
        by_key,
        source,
    })
}

fn build_action_tables(
    document: &ActionsDocument,
    clip_by_key: &HashMap<String, u32>,
    clip_keys: &[String],
) -> Result<ActionTables, String> {
    let mut descriptors = Vec::new();
    let mut action_clips = Vec::new();
    let mut output = Vec::new();
    for (slot, action) in document.actions.iter().enumerate() {
        let first_clip = u32::try_from(action_clips.len())
            .map_err(|_| "flat clip table exceeds u32".to_owned())?;
        let slots = action
            .clip_ids
            .iter()
            .map(|clip| {
                clip_by_key
                    .get(clip)
                    .copied()
                    .ok_or_else(|| format!("action references missing clip: {clip}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        action_clips.extend(slots.iter().copied().map(ClipSlot));
        let clip_count =
            u32::try_from(slots.len()).map_err(|_| "action clip list exceeds u32".to_owned())?;
        let cooldown_us = action
            .cooldown_ms
            .checked_mul(1_000)
            .ok_or_else(|| "cooldown conversion overflow".to_owned())?;
        descriptors.push(ActionDescriptor {
            play_policy: action.play_policy.into(),
            cooldown_us,
            first_clip,
            clip_count,
        });
        output.push(ActionOutput {
            action_key: action.action_id.clone(),
            action_slot: u32::try_from(slot).map_err(|_| "action table exceeds u32".to_owned())?,
            play_policy: action.play_policy,
            cooldown_us: cooldown_us.to_string(),
            clip_slots: slots,
        });
    }
    let used: HashSet<_> = document
        .actions
        .iter()
        .flat_map(|action| action.clip_ids.iter())
        .collect();
    if clip_keys.iter().any(|clip| !used.contains(clip)) {
        return Err("clip catalog contains an unused clip".to_owned());
    }
    Ok(ActionTables {
        descriptors,
        clips: action_clips,
        output,
    })
}

fn build_oid_tables(
    logical_index: &LogicalIndexDocument,
    transcript: &Transcript,
    action_by_key: &HashMap<String, u32>,
) -> Result<(Vec<OidIndexEntry>, Vec<OidOutput>), String> {
    let mut entries = Vec::new();
    let mut output = Vec::new();
    for (index, (record, mapped)) in logical_index
        .entries
        .iter()
        .zip(&transcript.physical_map)
        .enumerate()
    {
        if record.logical_oid != mapped.logical_oid {
            return Err(format!("host physical map order differs at index {index}"));
        }
        let physical_code = parse_u64(&mapped.physical_code, "physicalCode")?;
        if physical_code != expected_host_surrogate(&record.logical_oid)? {
            return Err(format!(
                "host surrogate differs from formula for {}",
                record.logical_oid
            ));
        }
        let action_slot = *action_by_key.get(&record.action_id).ok_or_else(|| {
            format!(
                "logical index references missing action: {}",
                record.action_id
            )
        })?;
        entries.push(OidIndexEntry {
            physical_code: PhysicalCode(physical_code),
            action_slot: ActionSlot(action_slot),
        });
        output.push(OidOutput {
            physical_code: mapped.physical_code.clone(),
            logical_oid: mapped.logical_oid.clone(),
            action_slot,
        });
    }
    Ok((entries, output))
}

fn execute_taps(
    model: ExecutionModel<'_>,
    actions: &[ActionRecord],
    clip_keys: &[String],
    taps: Vec<TapRecord>,
) -> Result<Vec<TraceOutput>, String> {
    let mut cooldown_state = vec![None; actions.len()];
    let mut runtime = PointReadRuntime::new(model, &mut cooldown_state)
        .map_err(|error| format!("runtime initialization failed: {error:?}"))?;
    let mut trace = Vec::new();
    for tap in taps {
        let physical_code = tap
            .physical_code
            .as_deref()
            .map(|value| parse_u64(value, "tap physicalCode").map(PhysicalCode))
            .transpose()?;
        let event = PhysicalCodeEvent {
            physical_code,
            event_at: MonotonicUs(parse_u64(&tap.event_at_us, "eventAtUs")?),
            sensor_at: None,
            ready_at: None,
            quality: None,
            status: tap.status.into(),
            sequence: 0,
            dropped_events: 0,
        };
        let mut selector = FixedSelector {
            value: tap.random_index,
            consumed: false,
        };
        let decision = runtime
            .on_event(event, &mut selector)
            .map_err(|error| format!("{} runtime error: {error:?}", tap.id))?;
        if selector.consumed != tap.random_index.is_some() {
            return Err(format!(
                "{} random index presence differs from planner consumption",
                tap.id
            ));
        }
        let (decision_name, action_slot, play_policy, clip_slots) = match decision {
            RuntimeDecision::IgnoreInvalid => ("ignore-invalid", None, None, Vec::new()),
            RuntimeDecision::SuppressCooldown(slot) => (
                "suppress-cooldown",
                Some(slot.0),
                Some(actions[slot.0 as usize].play_policy),
                Vec::new(),
            ),
            RuntimeDecision::Unbound(_) => ("unbound", None, None, Vec::new()),
            RuntimeDecision::Play { action_slot, plan } => {
                let slots = match plan {
                    PlaybackPlan::Replace(clip) | PlaybackPlan::RandomOne(clip) => vec![clip.0],
                    PlaybackPlan::Queue(clips) => clips.iter().map(|clip| clip.0).collect(),
                };
                (
                    "play",
                    Some(action_slot.0),
                    Some(actions[action_slot.0 as usize].play_policy),
                    slots,
                )
            }
        };
        let action_key = action_slot.map(|slot| actions[slot as usize].action_id.clone());
        let selected_clip_keys: Vec<String> = clip_slots
            .iter()
            .map(|slot| clip_keys[*slot as usize].clone())
            .collect();
        let expected_matched = decision_name == tap.expected.decision.as_str()
            && action_key == tap.expected.action_key
            && action_slot == tap.expected.action_slot
            && play_policy == tap.expected.play_policy
            && selected_clip_keys == tap.expected.clip_keys;
        trace.push(TraceOutput {
            id: tap.id,
            decision: decision_name.to_owned(),
            action_key,
            action_slot,
            play_policy,
            clip_keys: selected_clip_keys,
            clip_slots,
            random_index_consumed: selector.consumed,
            expected_matched,
        });
    }
    Ok(trace)
}

fn validate_source_shapes(
    logical_index: &LogicalIndexDocument,
    actions: &ActionsDocument,
    transcript: &Transcript,
) -> Result<(), String> {
    if logical_index.entries.is_empty()
        || actions.actions.is_empty()
        || transcript.physical_map.is_empty()
        || transcript.taps.is_empty()
        || !valid_lower_key(&transcript.source_profile)
    {
        return Err("execution input contains an empty table or invalid source profile".to_owned());
    }
    for entry in &logical_index.entries {
        if !valid_upper_key(&entry.logical_oid) || !valid_prefixed_key(&entry.action_id, "action-")
        {
            return Err("logical index key differs from Snapshot schema".to_owned());
        }
    }
    for action in &actions.actions {
        if !valid_prefixed_key(&action.action_id, "action-")
            || action.clip_ids.is_empty()
            || action.clip_ids.len() > 32
            || action
                .clip_ids
                .iter()
                .any(|clip| !valid_prefixed_key(clip, "clip-"))
            || action.cooldown_ms > 60_000
            || action
                .design_source
                .as_deref()
                .is_some_and(|value| !valid_bounded_text(value, 1, 64))
            || action
                .codec_plan
                .as_deref()
                .is_some_and(|value| !valid_bounded_text(value, 1, 64))
        {
            return Err(format!(
                "{} differs from Snapshot action schema",
                action.action_id
            ));
        }
    }
    for mapped in &transcript.physical_map {
        if !valid_upper_key(&mapped.logical_oid) {
            return Err("physical map logical OID differs from transcript schema".to_owned());
        }
    }
    for tap in &transcript.taps {
        if !valid_tap_id(&tap.id)
            || tap
                .expected
                .action_key
                .as_deref()
                .is_some_and(|value| !valid_prefixed_key(value, "action-"))
            || tap
                .expected
                .clip_keys
                .iter()
                .any(|value| !valid_prefixed_key(value, "clip-"))
        {
            return Err(format!("{} differs from transcript schema", tap.id));
        }
    }
    Ok(())
}

fn validate_input_contract(
    logical_index: &LogicalIndexDocument,
    actions: &ActionsDocument,
    transcript: &Transcript,
) -> Result<(), String> {
    validate_source_shapes(logical_index, actions, transcript)?;
    if logical_index.schema_version != 1
        || actions.schema_version != 1
        || transcript.schema_version != 1
        || transcript.profile != "snapshot-execution-transcript-v1"
        || !transcript.fixture_only
        || transcript.physical_evidence
        || transcript.host_surrogate_formula
            != "9000000000000000 + logical OID numeric suffix; NOT AN OID CODE"
    {
        return Err("execution inputs differ from v1 host-fixture contract".to_owned());
    }
    if logical_index.physical_map_status != "unassigned"
        || logical_index
            .entries
            .iter()
            .any(|entry| entry.physical_code.is_some())
    {
        return Err("v1 host transcript requires an unassigned Snapshot index".to_owned());
    }
    if logical_index.entries.len() != transcript.physical_map.len() {
        return Err("host physical map does not exactly cover logical index".to_owned());
    }
    unique(
        actions
            .actions
            .iter()
            .map(|action| action.action_id.clone()),
        "action key",
    )?;
    unique(
        logical_index
            .entries
            .iter()
            .map(|entry| entry.logical_oid.clone()),
        "logical OID",
    )?;
    unique(
        transcript
            .physical_map
            .iter()
            .map(|entry| entry.logical_oid.clone()),
        "mapped logical OID",
    )?;
    unique(
        transcript
            .physical_map
            .iter()
            .map(|entry| entry.physical_code.clone()),
        "mapped physical code",
    )?;
    unique(transcript.taps.iter().map(|tap| tap.id.clone()), "tap id")?;
    let mut previous_at = None;
    for tap in &transcript.taps {
        let at = parse_u64(&tap.event_at_us, "eventAtUs")?;
        if previous_at.is_some_and(|previous| previous > at) {
            return Err("tap eventAtUs is not monotonic".to_owned());
        }
        previous_at = Some(at);
        if tap.status == WireOidStatus::Valid && tap.physical_code.is_none() {
            return Err(format!("{} valid event has no physical code", tap.id));
        }
        if matches!(
            tap.status,
            WireOidStatus::NoCode | WireOidStatus::SensorFault
        ) && tap.physical_code.is_some()
        {
            return Err(format!(
                "{} invalid status event carries a physical code",
                tap.id
            ));
        }
        if let Some(code) = &tap.physical_code {
            parse_u64(code, "tap physicalCode")?;
        }
    }
    Ok(())
}

/// Runs the host Snapshot parser and target-neutral execution model.
pub fn run(
    logical_index_path: &Path,
    actions_path: &Path,
    transcript_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let (logical_index_bytes, logical_index): (Vec<u8>, LogicalIndexDocument) =
        read_json(logical_index_path)?;
    let (actions_bytes, actions_document): (Vec<u8>, ActionsDocument) = read_json(actions_path)?;
    let (_, transcript): (Vec<u8>, Transcript) = read_json(transcript_path)?;
    validate_input_contract(&logical_index, &actions_document, &transcript)?;

    let mut catalog = build_clip_catalog(&actions_document)?;
    let action_by_key: HashMap<String, u32> = actions_document
        .actions
        .iter()
        .enumerate()
        .map(|(slot, action)| {
            u32::try_from(slot)
                .map(|slot| (action.action_id.clone(), slot))
                .map_err(|_| "action table exceeds u32".to_owned())
        })
        .collect::<Result<_, _>>()?;
    let action_tables = build_action_tables(&actions_document, &catalog.by_key, &catalog.keys)?;
    let (oid_entries, oid_output) = build_oid_tables(&logical_index, &transcript, &action_by_key)?;
    let clip_count =
        u32::try_from(catalog.keys.len()).map_err(|_| "clip table exceeds u32".to_owned())?;
    let model = ExecutionModel::new(
        &oid_entries,
        &action_tables.descriptors,
        &action_tables.clips,
        clip_count,
    )
    .map_err(|error| format!("compact execution model rejected: {error:?}"))?;
    let trace = execute_taps(
        model,
        &actions_document.actions,
        &catalog.keys,
        transcript.taps,
    )?;

    let clips = catalog
        .keys
        .drain(..)
        .enumerate()
        .map(|(slot, key)| {
            Ok(ClipOutput {
                clip_key: key,
                clip_slot: u32::try_from(slot).map_err(|_| "clip table exceeds u32".to_owned())?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let all_passed = trace.iter().all(|item| item.expected_matched);
    let result = ExecutionResult {
        schema_version: 1,
        profile: "snapshot-execution-result-v1",
        source_profile: transcript.source_profile,
        execution_model: ModelOutput {
            schema_version: 1,
            profile: "snapshot-execution-model-v1",
            source: ModelSource {
                logical_index_sha256: sha256(&logical_index_bytes),
                actions_sha256: sha256(&actions_bytes),
                physical_map_source: "host-surrogate-not-oid",
                physical_evidence: false,
                clip_catalog_source: catalog.source,
            },
            oid_index: oid_output,
            actions: action_tables.output,
            clips,
        },
        trace,
        all_passed,
    };
    if !all_passed {
        return Err("execution trace differs from transcript expectation".to_owned());
    }
    let mut bytes = serde_json::to_vec_pretty(&result)
        .map_err(|error| format!("serialize execution result: {error}"))?;
    bytes.push(b'\n');
    fs::write(output_path, bytes)
        .map_err(|error| format!("write {}: {error}", output_path.display()))?;
    Ok(())
}
