use std::collections::BTreeSet;
use std::error::Error;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use yimi_runtime_core::weighted_random_v2::{
    RandomWordSourceV2, WeightedRandomErrorV2, select_weighted_v2,
};

const U64_SPACE: u128 = 1_u128 << 64;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Transcript {
    schema_version: u32,
    profile: String,
    algorithm_id: String,
    host_fixture: bool,
    physical_evidence: bool,
    production_evidence: bool,
    algorithm: Algorithm,
    scenarios: Vec<Scenario>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Algorithm {
    random_word_bits: u32,
    weight_type: String,
    min_clips: usize,
    max_clips: usize,
    rejection_rule: String,
    ticket_rule: String,
    selection_rule: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scenario {
    id: String,
    #[serde(rename = "covers")]
    _covers: Vec<String>,
    clips: Vec<Clip>,
    raw_words: Vec<String>,
    expected: SelectionFields,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Clip {
    clip_slot: u32,
    weight: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelectionFields {
    selected_index: u32,
    selected_clip_slot: u32,
    total_weight: String,
    rejection_threshold: String,
    accepted_raw_word: String,
    ticket: String,
    consumed_words: u32,
    accepted_word_count: String,
    bucket_preimage_count: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultRecord {
    id: String,
    selected_index: u32,
    selected_clip_slot: u32,
    total_weight: String,
    rejection_threshold: String,
    accepted_raw_word: String,
    ticket: String,
    consumed_words: u32,
    accepted_word_count: String,
    bucket_preimage_count: String,
    expected_matched: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    schema_version: u32,
    profile: &'static str,
    algorithm_id: &'static str,
    transcript_sha256: String,
    results: Vec<ResultRecord>,
    all_passed: bool,
}

struct Words {
    values: Vec<u64>,
    position: usize,
}

impl RandomWordSourceV2 for Words {
    fn next_u64(&mut self) -> Option<u64> {
        let value = self.values.get(self.position).copied();
        self.position += usize::from(value.is_some());
        value
    }
}

fn fail<T>(code: &str) -> Result<T, Box<dyn Error>> {
    Err(format!("WEIGHTED_V2:{code}").into())
}

fn parse_u64(value: &str) -> Result<u64, Box<dyn Error>> {
    let parsed = value
        .parse::<u64>()
        .map_err(|_| "WEIGHTED_V2:U64_OUT_OF_RANGE")?;
    if parsed.to_string() != value {
        return fail("U64_NOT_CANONICAL");
    }
    Ok(parsed)
}

fn map_core_error(error: WeightedRandomErrorV2) -> &'static str {
    match error {
        WeightedRandomErrorV2::TooFewClips => "TOO_FEW_CLIPS",
        WeightedRandomErrorV2::TooManyClips => "TOO_MANY_CLIPS",
        WeightedRandomErrorV2::ZeroWeight => "WEIGHT_INVALID",
        WeightedRandomErrorV2::TotalWeightOverflow => "TOTAL_WEIGHT_OVERFLOW",
        WeightedRandomErrorV2::RandomSourceExhausted => "RANDOM_SOURCE_EXHAUSTED",
        WeightedRandomErrorV2::RandomWordLimitExceeded => "RANDOM_WORD_LIMIT_EXCEEDED",
    }
}

fn validate_envelope(transcript: &Transcript) -> Result<(), Box<dyn Error>> {
    if transcript.schema_version != 2 {
        return fail("TRANSCRIPT_VERSION_UNSUPPORTED");
    }
    if transcript.profile != "weighted-random-transcript-v2" {
        return fail("TRANSCRIPT_PROFILE_UNSUPPORTED");
    }
    if transcript.algorithm_id != "yimi-weighted-random-v2" {
        return fail("ALGORITHM_UNSUPPORTED");
    }
    if !transcript.host_fixture || transcript.physical_evidence || transcript.production_evidence {
        return fail("EVIDENCE_BOUNDARY_INVALID");
    }
    let algorithm = &transcript.algorithm;
    if algorithm.random_word_bits != 64
        || algorithm.weight_type != "positive-u32"
        || algorithm.min_clips != 2
        || algorithm.max_clips != 32
        || algorithm.rejection_rule != "reject rawWord < (2^64 mod totalWeight)"
        || algorithm.ticket_rule != "acceptedRawWord mod totalWeight"
        || algorithm.selection_rule != "first half-open cumulative interval in clip array order"
    {
        return fail("ALGORITHM_METADATA_DRIFT");
    }
    if transcript.scenarios.is_empty() {
        return fail("SCENARIOS_EMPTY");
    }
    Ok(())
}

fn run_scenario(scenario: Scenario) -> Result<ResultRecord, Box<dyn Error>> {
    let mut slots = BTreeSet::new();
    for clip in &scenario.clips {
        if !slots.insert(clip.clip_slot) {
            return fail("DUPLICATE_CLIP_SLOT");
        }
    }
    let weights: Vec<u32> = scenario.clips.iter().map(|clip| clip.weight).collect();
    let values: Vec<u64> = scenario
        .raw_words
        .iter()
        .map(|value| parse_u64(value))
        .collect::<Result<_, _>>()?;
    let mut words = Words {
        values,
        position: 0,
    };
    let selection = select_weighted_v2(&weights, &mut words)
        .map_err(|error| format!("WEIGHTED_V2:{}", map_core_error(error)))?;
    let selected_index = usize::try_from(selection.selected_index)?;
    let selected_clip_slot = scenario
        .clips
        .get(selected_index)
        .ok_or("WEIGHTED_V2:INTERNAL_RANGE_ERROR")?
        .clip_slot;
    let accepted_word_count = U64_SPACE - u128::from(selection.rejection_threshold);
    let fields = SelectionFields {
        selected_index: selection.selected_index,
        selected_clip_slot,
        total_weight: selection.total_weight.to_string(),
        rejection_threshold: selection.rejection_threshold.to_string(),
        accepted_raw_word: selection.accepted_word.to_string(),
        ticket: selection.ticket.to_string(),
        consumed_words: selection.consumed_words,
        accepted_word_count: accepted_word_count.to_string(),
        bucket_preimage_count: (accepted_word_count / u128::from(selection.total_weight))
            .to_string(),
    };
    if fields != scenario.expected {
        return fail("EXPECTED_MISMATCH");
    }
    Ok(ResultRecord {
        id: scenario.id,
        selected_index: fields.selected_index,
        selected_clip_slot: fields.selected_clip_slot,
        total_weight: fields.total_weight,
        rejection_threshold: fields.rejection_threshold,
        accepted_raw_word: fields.accepted_raw_word,
        ticket: fields.ticket,
        consumed_words: fields.consumed_words,
        accepted_word_count: fields.accepted_word_count,
        bucket_preimage_count: fields.bucket_preimage_count,
        expected_matched: true,
    })
}

pub(crate) fn run(input: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    let bytes = fs::read(input)?;
    let transcript: Transcript = serde_json::from_slice(&bytes)?;
    validate_envelope(&transcript)?;
    let mut scenario_ids = BTreeSet::new();
    let mut results = Vec::with_capacity(transcript.scenarios.len());
    for scenario in transcript.scenarios {
        if scenario.id.is_empty() {
            return fail("SCENARIO_ID_INVALID");
        }
        if !scenario_ids.insert(scenario.id.clone()) {
            return fail("DUPLICATE_SCENARIO_ID");
        }
        results.push(run_scenario(scenario)?);
    }
    let document = Output {
        schema_version: 2,
        profile: "weighted-random-result-v2",
        algorithm_id: "yimi-weighted-random-v2",
        transcript_sha256: format!("{:x}", Sha256::digest(&bytes)),
        results,
        all_passed: true,
    };
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        output,
        format!("{}\n", serde_json::to_string_pretty(&document)?),
    )?;
    Ok(())
}
