use std::collections::BTreeMap;
use std::error::Error;
use std::fs;
use std::path::Path;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use yimi_device_link_core::{
    BeginOutcome, ChunkPlan, CoreError, DeviceLinkCore, FileSpec, Sha256Digest, Sha256Provider,
};
use yimi_fw_contract::{ErrorCode, SnapshotId, TransactionId};
use yimi_snapshot_core::InstallMachine;

// Host transcript fixture capacities only; these are not board capabilities.
const HOST_MAX_FILES: usize = 8;
const HOST_MAX_PATH_BYTES: usize = 240;
const HOST_MAX_CHUNK_BYTES: usize = 64;
type Core = DeviceLinkCore<HOST_MAX_FILES, HOST_MAX_PATH_BYTES, HOST_MAX_CHUNK_BYTES>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Transcript {
    schema_version: u32,
    profile: String,
    #[serde(rename = "class")]
    class_name: String,
    host_simulation: bool,
    fixture: Fixture,
    scenarios: Vec<Scenario>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    active_snapshot_id: String,
    last_good_snapshot_id: String,
    generation: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scenario {
    id: String,
    #[serde(rename = "title")]
    _title: String,
    covers: Vec<String>,
    steps: Vec<Step>,
    #[serde(rename = "expectedFinal")]
    _expected_final: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Step {
    id: String,
    #[serde(default)]
    delivery: Delivery,
    request: Request,
    #[serde(rename = "expected")]
    _expected: serde_json::Value,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Delivery {
    #[default]
    Normal,
    DisconnectBeforeDispatch,
    DisconnectAfterDurableBeforeResponse,
}

impl Delivery {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::DisconnectBeforeDispatch => "disconnect-before-dispatch",
            Self::DisconnectAfterDurableBeforeResponse => {
                "disconnect-after-durable-before-response"
            }
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u32,
    profile: String,
    kind: String,
    #[serde(rename = "requestId")]
    id: String,
    op: String,
    payload: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BeginPayload {
    transaction_id: String,
    snapshot_id: String,
    manifest_byte_length: String,
    total_bytes: String,
    file_count: usize,
    expected_active_snapshot_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WritePayload {
    transaction_id: String,
    path: String,
    offset: String,
    byte_length: usize,
    data_base64: String,
    chunk_sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransactionPayload {
    transaction_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivatePayload {
    transaction_id: String,
    expected_active_snapshot_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RollbackPayload {
    expected_active_snapshot_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FileDescriptor {
    path: String,
    byte_length: u64,
    sha256: Sha256Digest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct BeginDescriptor {
    files: Vec<FileDescriptor>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OperationResult {
    ok: bool,
    error_code: Option<&'static str>,
}

impl OperationResult {
    const SUCCESS: Self = Self {
        ok: true,
        error_code: None,
    };

    const fn error(code: &'static str) -> Self {
        Self {
            ok: false,
            error_code: Some(code),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct JournalEntry {
    request: Request,
    result: OperationResult,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransactionSummary {
    status: String,
    committed_bytes: String,
    committed_files: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FinalState {
    active_snapshot_id: String,
    last_good_snapshot_id: String,
    generation: String,
    transactions: BTreeMap<String, TransactionSummary>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Adapter {
    core: Core,
    state: FinalState,
    descriptors: BTreeMap<String, BeginDescriptor>,
    transaction_ids: BTreeMap<String, TransactionId>,
    storage: BTreeMap<String, Vec<u8>>,
    journal: BTreeMap<String, JournalEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StepReport {
    id: String,
    delivery: String,
    ok: bool,
    error_code: Option<&'static str>,
    replayed: bool,
    semantic_mutation: &'static str,
    non_success_zero_side_effects: Option<bool>,
    disconnect_before_dispatch_zero_side_effects: Option<bool>,
    durable_retry_response_stable: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioReport {
    id: String,
    class: String,
    covers: Vec<String>,
    passed: bool,
    steps: Vec<StepReport>,
    final_state: FinalState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    schema_version: u32,
    profile: &'static str,
    host_manifest_surrogate: bool,
    results: Vec<ScenarioReport>,
}

#[derive(Clone, Copy)]
struct HostSha256;

impl Sha256Provider for HostSha256 {
    fn digest(&self, bytes: &[u8]) -> Sha256Digest {
        sha256(bytes)
    }
}

pub fn run(golden: &Path, negative: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    let documents = [read_transcript(golden)?, read_transcript(negative)?];
    let mut results = Vec::new();
    for document in documents {
        if document.schema_version != 1
            || document.profile != "device-link-v1-host-transaction-transcript"
            || !document.host_simulation
        {
            return Err("unsupported DeviceLink transaction transcript".into());
        }
        for scenario in &document.scenarios {
            results.push(run_scenario(&document, scenario)?);
        }
    }
    let result = Output {
        schema_version: 1,
        profile: "device-link-v1-rust-transaction-adapter",
        host_manifest_surrogate: true,
        results,
    };
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        output,
        format!("{}\n", serde_json::to_string_pretty(&result)?),
    )?;
    Ok(())
}

fn read_transcript(path: &Path) -> Result<Transcript, Box<dyn Error>> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn run_scenario(
    document: &Transcript,
    scenario: &Scenario,
) -> Result<ScenarioReport, Box<dyn Error>> {
    let active = parse_snapshot(&document.fixture.active_snapshot_id)?;
    if document.fixture.active_snapshot_id != document.fixture.last_good_snapshot_id {
        return Err("host fixture requires initial active and last-good equality".into());
    }
    let descriptors = prescan_descriptors(scenario)?;
    let transaction_ids = transaction_ids(scenario);
    let mut adapter = Adapter {
        core: Core::new(InstallMachine::provisioned(active)),
        state: FinalState {
            active_snapshot_id: document.fixture.active_snapshot_id.clone(),
            last_good_snapshot_id: document.fixture.last_good_snapshot_id.clone(),
            generation: document.fixture.generation.clone(),
            transactions: BTreeMap::new(),
        },
        descriptors,
        transaction_ids,
        storage: BTreeMap::new(),
        journal: BTreeMap::new(),
    };
    let mut steps = Vec::new();
    for step in &scenario.steps {
        steps.push(adapter.run_step(&scenario.id, step)?);
    }
    Ok(ScenarioReport {
        id: scenario.id.clone(),
        class: document.class_name.clone(),
        covers: scenario.covers.clone(),
        passed: true,
        steps,
        final_state: adapter.state,
    })
}

impl Adapter {
    fn run_step(&mut self, scenario_id: &str, step: &Step) -> Result<StepReport, Box<dyn Error>> {
        let semantic_before = self.state.clone();
        let full_before = self.clone();
        let mut before_dispatch_zero = None;
        let mut durable_retry_stable = None;

        let (result, replayed) = match step.delivery {
            Delivery::Normal => self.handle(&step.request)?,
            Delivery::DisconnectBeforeDispatch => {
                before_dispatch_zero = Some(*self == full_before);
                self.handle(&step.request)?
            }
            Delivery::DisconnectAfterDurableBeforeResponse => {
                let first = self.handle(&step.request)?;
                let after_durable = self.clone();
                let retry = self.handle(&step.request)?;
                let stable = *self == after_durable && retry.1 && retry.0 == first.0;
                durable_retry_stable = Some(stable);
                retry
            }
        };
        let semantic_unchanged = self.state == semantic_before;
        let full_unchanged = *self == full_before;
        let zero_side_effects = (!result.ok).then_some(semantic_unchanged && full_unchanged);
        if zero_side_effects == Some(false)
            || before_dispatch_zero == Some(false)
            || durable_retry_stable == Some(false)
        {
            return Err(format!("{scenario_id}/{}: state invariant failed", step.id).into());
        }
        Ok(StepReport {
            id: step.id.clone(),
            delivery: step.delivery.as_str().to_owned(),
            ok: result.ok,
            error_code: result.error_code,
            replayed,
            semantic_mutation: if semantic_unchanged {
                "unchanged"
            } else {
                "changed"
            },
            non_success_zero_side_effects: zero_side_effects,
            disconnect_before_dispatch_zero_side_effects: before_dispatch_zero,
            durable_retry_response_stable: durable_retry_stable,
        })
    }

    fn handle(&mut self, request: &Request) -> Result<(OperationResult, bool), Box<dyn Error>> {
        if request.schema_version != 1
            || request.profile != "loopback-json-v1"
            || request.kind != "request"
        {
            return Ok((OperationResult::error("MALFORMED_MESSAGE"), false));
        }
        if let Some(entry) = self.journal.get(&request.id) {
            return if entry.request.op == request.op && entry.request.payload == request.payload {
                Ok((entry.result.clone(), true))
            } else {
                Ok((OperationResult::error("REQUEST_ID_CONFLICT"), false))
            };
        }
        let result = self.dispatch(request)?;
        if result.ok {
            self.journal.insert(
                request.id.clone(),
                JournalEntry {
                    request: request.clone(),
                    result: result.clone(),
                },
            );
        }
        Ok((result, false))
    }

    fn dispatch(&mut self, request: &Request) -> Result<OperationResult, Box<dyn Error>> {
        match request.op.as_str() {
            "snapshot.stage.begin" => self.begin(payload(request)?),
            "snapshot.stage.write" => self.write(payload(request)?),
            "snapshot.verify" => self.verify(&payload(request)?),
            "snapshot.activate" => self.activate(&payload(request)?),
            "snapshot.abort" => self.abort(&payload(request)?),
            "snapshot.rollback" => self.rollback(&payload(request)?),
            _ => Ok(OperationResult::error("OPERATION_UNSUPPORTED")),
        }
    }

    fn begin(&mut self, payload: BeginPayload) -> Result<OperationResult, Box<dyn Error>> {
        let transaction = self.transaction_id(&payload.transaction_id)?;
        let descriptor = self
            .descriptors
            .get(&payload.transaction_id)
            .ok_or("missing host manifest surrogate")?;
        let files: Vec<_> = descriptor
            .files
            .iter()
            .map(|file| FileSpec {
                path: file.path.as_bytes(),
                byte_length: file.byte_length,
                sha256: file.sha256,
            })
            .collect();
        let outcome = self.core.begin_stage(
            transaction,
            parse_snapshot(&payload.snapshot_id)?,
            parse_optional_snapshot(payload.expected_active_snapshot_id.as_deref())?,
            payload.total_bytes.parse()?,
            &files,
        );
        match outcome {
            Ok(BeginOutcome::Started) => {
                self.storage.clear();
                self.state.transactions.insert(
                    payload.transaction_id,
                    TransactionSummary {
                        status: "Staging".to_owned(),
                        committed_bytes: "0".to_owned(),
                        committed_files: 0,
                    },
                );
                Ok(OperationResult::SUCCESS)
            }
            Ok(BeginOutcome::Resumed) => Ok(OperationResult::SUCCESS),
            Err(error) => Ok(OperationResult::error(map_core_error(error))),
        }
    }

    fn write(&mut self, payload: WritePayload) -> Result<OperationResult, Box<dyn Error>> {
        let transaction = self.transaction_id(&payload.transaction_id)?;
        let offset = payload.offset.parse::<u64>()?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(&payload.data_base64)?;
        if bytes.len() != payload.byte_length {
            return Ok(OperationResult::error("MALFORMED_MESSAGE"));
        }
        let plan = self.core.prepare_chunk(
            transaction,
            payload.path.as_bytes(),
            offset,
            &bytes,
            parse_digest(&payload.chunk_sha256)?,
            &HostSha256,
        );
        match plan {
            Ok(ChunkPlan::Write(permit)) => {
                let file = self.storage.entry(payload.path).or_default();
                if u64::try_from(file.len())? != offset {
                    return Err("core/storage durable offset divergence".into());
                }
                file.extend_from_slice(&bytes);
                match self.core.commit_chunk(permit) {
                    Ok(ack) => {
                        let summary = self
                            .state
                            .transactions
                            .get_mut(&payload.transaction_id)
                            .ok_or("missing transaction summary")?;
                        summary.committed_bytes = ack.total_durable_bytes.to_string();
                        summary.committed_files = self
                            .storage
                            .values()
                            .filter(|stored| !stored.is_empty())
                            .count();
                        Ok(OperationResult::SUCCESS)
                    }
                    Err(error) => {
                        Err(format!("durable commit rejected after permit: {error:?}").into())
                    }
                }
            }
            Ok(ChunkPlan::Replay(permit)) => {
                let file = self
                    .storage
                    .get(&payload.path)
                    .ok_or("missing durable replay file")?;
                let start = usize::try_from(permit.offset())?;
                let end = start
                    .checked_add(usize::try_from(permit.byte_length())?)
                    .ok_or("replay range overflow")?;
                let durable = file.get(start..end).ok_or("missing durable replay range")?;
                match self.core.confirm_replay(permit, sha256(durable)) {
                    Ok(_) => Ok(OperationResult::SUCCESS),
                    Err(error) => Ok(OperationResult::error(map_core_error(error))),
                }
            }
            Err(error) => Ok(OperationResult::error(map_core_error(error))),
        }
    }

    fn verify(&mut self, payload: &TransactionPayload) -> Result<OperationResult, Box<dyn Error>> {
        let transaction = self.transaction_id(&payload.transaction_id)?;
        let descriptor = self
            .descriptors
            .get(&payload.transaction_id)
            .ok_or("missing host manifest surrogate")?;
        let digests: Vec<_> = descriptor
            .files
            .iter()
            .map(|file| {
                self.storage
                    .get(&file.path)
                    .map_or_else(|| sha256(&[]), |bytes| sha256(bytes))
            })
            .collect();
        match self.core.verify(transaction, &digests) {
            Ok(_) => {
                "ReadyToActivate"
                    .clone_into(&mut self.summary_mut(&payload.transaction_id)?.status);
                Ok(OperationResult::SUCCESS)
            }
            Err(error) => Ok(OperationResult::error(map_core_error(error))),
        }
    }

    fn activate(&mut self, payload: &ActivatePayload) -> Result<OperationResult, Box<dyn Error>> {
        let transaction = self.transaction_id(&payload.transaction_id)?;
        match self.core.activate(
            transaction,
            parse_optional_snapshot(payload.expected_active_snapshot_id.as_deref())?,
        ) {
            Ok(selection) => {
                let old_active = self.state.active_snapshot_id.clone();
                self.state.active_snapshot_id = format_snapshot(selection.active);
                self.state.last_good_snapshot_id = old_active;
                self.state.generation = increment_decimal(&self.state.generation)?;
                "Activated".clone_into(&mut self.summary_mut(&payload.transaction_id)?.status);
                Ok(OperationResult::SUCCESS)
            }
            Err(error) => Ok(OperationResult::error(map_core_error(error))),
        }
    }

    fn abort(&mut self, payload: &TransactionPayload) -> Result<OperationResult, Box<dyn Error>> {
        let transaction = self.transaction_id(&payload.transaction_id)?;
        match self.core.abort(transaction) {
            Ok(()) => {
                "Aborted".clone_into(&mut self.summary_mut(&payload.transaction_id)?.status);
                Ok(OperationResult::SUCCESS)
            }
            Err(error) => Ok(OperationResult::error(map_core_error(error))),
        }
    }

    fn rollback(&mut self, payload: &RollbackPayload) -> Result<OperationResult, Box<dyn Error>> {
        match self
            .core
            .rollback(parse_snapshot(&payload.expected_active_snapshot_id)?)
        {
            Ok(selection) => {
                self.state.active_snapshot_id = format_snapshot(selection.active);
                self.state.last_good_snapshot_id = selection
                    .last_good
                    .map_or_else(|| self.state.last_good_snapshot_id.clone(), format_snapshot);
                self.state.generation = increment_decimal(&self.state.generation)?;
                Ok(OperationResult::SUCCESS)
            }
            Err(error) => Ok(OperationResult::error(map_core_error(error))),
        }
    }

    fn transaction_id(&self, value: &str) -> Result<TransactionId, Box<dyn Error>> {
        self.transaction_ids
            .get(value)
            .copied()
            .ok_or_else(|| format!("unmapped transaction ID {value}").into())
    }

    fn summary_mut(&mut self, id: &str) -> Result<&mut TransactionSummary, Box<dyn Error>> {
        self.state
            .transactions
            .get_mut(id)
            .ok_or_else(|| format!("missing transaction summary {id}").into())
    }
}

fn payload<T: for<'de> Deserialize<'de>>(request: &Request) -> Result<T, Box<dyn Error>> {
    Ok(serde_json::from_value(request.payload.clone())?)
}

fn transaction_ids(scenario: &Scenario) -> BTreeMap<String, TransactionId> {
    let mut result = BTreeMap::new();
    for step in &scenario.steps {
        if let Some(id) = step
            .request
            .payload
            .get("transactionId")
            .and_then(|v| v.as_str())
            && !result.contains_key(id)
        {
            let next = u64::try_from(result.len()).unwrap_or(u64::MAX) + 1;
            result.insert(id.to_owned(), TransactionId(next));
        }
    }
    result
}

fn prescan_descriptors(
    scenario: &Scenario,
) -> Result<BTreeMap<String, BeginDescriptor>, Box<dyn Error>> {
    let mut result = BTreeMap::new();
    for step in &scenario.steps {
        if step.request.op != "snapshot.stage.begin" {
            continue;
        }
        let begin: BeginPayload = payload(&step.request)?;
        if result.contains_key(&begin.transaction_id) {
            continue;
        }
        let total = begin.total_bytes.parse::<u64>()?;
        let manifest_length = begin.manifest_byte_length.parse::<u64>()?;
        if manifest_length > total || begin.file_count == 0 {
            return Err(format!("{}: invalid host manifest surrogate totals", scenario.id).into());
        }
        let mut paths = vec!["manifest.json".to_owned()];
        for candidate in &scenario.steps {
            if candidate.request.op != "snapshot.stage.write" {
                continue;
            }
            let write: WritePayload = payload(&candidate.request)?;
            if write.transaction_id == begin.transaction_id && !paths.contains(&write.path) {
                paths.push(write.path);
            }
        }
        if paths.len() != begin.file_count {
            return Err(format!(
                "{}: host manifest surrogate observed {} paths but begin declares {}",
                scenario.id,
                paths.len(),
                begin.file_count
            )
            .into());
        }
        let remaining = total - manifest_length;
        let mut lengths = vec![manifest_length];
        if paths.len() == 2 {
            lengths.push(remaining);
        } else if paths.len() > 2 {
            return Err(format!(
                "{}: fixture surrogate supports up to two files",
                scenario.id
            )
            .into());
        }
        if paths.len() == 1 && manifest_length != total {
            return Err(format!("{}: one-file surrogate total mismatch", scenario.id).into());
        }
        let mut files = Vec::new();
        for (path, byte_length) in paths.into_iter().zip(lengths) {
            let bytes = prescan_file_bytes(scenario, &begin.transaction_id, &path, byte_length)?;
            files.push(FileDescriptor {
                path,
                byte_length,
                sha256: if u64::try_from(bytes.len())? == byte_length {
                    sha256(&bytes)
                } else {
                    Sha256Digest([0; 32])
                },
            });
        }
        result.insert(begin.transaction_id, BeginDescriptor { files });
    }
    Ok(result)
}

fn prescan_file_bytes(
    scenario: &Scenario,
    transaction_id: &str,
    path: &str,
    expected_length: u64,
) -> Result<Vec<u8>, Box<dyn Error>> {
    let mut bytes = Vec::new();
    for step in &scenario.steps {
        if step.request.op != "snapshot.stage.write" {
            continue;
        }
        let write: WritePayload = payload(&step.request)?;
        if write.transaction_id != transaction_id || write.path != path {
            continue;
        }
        let offset = write.offset.parse::<u64>()?;
        let chunk = base64::engine::general_purpose::STANDARD.decode(write.data_base64)?;
        let end = offset.checked_add(u64::try_from(chunk.len())?);
        if offset == u64::try_from(bytes.len())?
            && end.is_some_and(|value| value <= expected_length)
            && sha256(&chunk) == parse_digest(&write.chunk_sha256)?
        {
            bytes.extend_from_slice(&chunk);
        }
    }
    Ok(bytes)
}

fn sha256(bytes: &[u8]) -> Sha256Digest {
    let digest = Sha256::digest(bytes);
    let mut result = [0_u8; 32];
    result.copy_from_slice(&digest);
    Sha256Digest(result)
}

fn parse_snapshot(value: &str) -> Result<SnapshotId, Box<dyn Error>> {
    let digest = value
        .strip_prefix("sha256:")
        .ok_or("snapshot ID lacks sha256 prefix")?;
    Ok(SnapshotId(parse_hex_32(digest)?))
}

fn parse_optional_snapshot(value: Option<&str>) -> Result<Option<SnapshotId>, Box<dyn Error>> {
    value.map(parse_snapshot).transpose()
}

fn parse_digest(value: &str) -> Result<Sha256Digest, Box<dyn Error>> {
    Ok(Sha256Digest(parse_hex_32(value)?))
}

fn parse_hex_32(value: &str) -> Result<[u8; 32], Box<dyn Error>> {
    if value.len() != 64 {
        return Err("SHA-256 hex length is not 64".into());
    }
    let mut result = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let text = std::str::from_utf8(pair)?;
        result[index] = u8::from_str_radix(text, 16)?;
    }
    Ok(result)
}

fn format_snapshot(snapshot: SnapshotId) -> String {
    let mut result = String::from("sha256:");
    for byte in snapshot.0 {
        use std::fmt::Write as _;
        let _ = write!(result, "{byte:02x}");
    }
    result
}

fn increment_decimal(value: &str) -> Result<String, Box<dyn Error>> {
    Ok(value
        .parse::<u64>()?
        .checked_add(1)
        .ok_or("generation overflow")?
        .to_string())
}

const fn map_core_error(error: CoreError) -> &'static str {
    match error {
        CoreError::Busy => "BUSY",
        CoreError::InvalidState
        | CoreError::FileCapacityExceeded
        | CoreError::InvalidPath
        | CoreError::DuplicatePath
        | CoreError::TotalBytesMismatch
        | CoreError::FileNotFound
        | CoreError::FileOrderMismatch { .. }
        | CoreError::FileDigestCountMismatch { .. }
        | CoreError::StalePermit => "INVALID_STATE",
        CoreError::TransactionNotFound => "TRANSACTION_NOT_FOUND",
        CoreError::TransactionIdConflict => "TRANSACTION_ID_CONFLICT",
        CoreError::ExpectedActiveMismatch => "EXPECTED_ACTIVE_MISMATCH",
        CoreError::EmptyChunk => "MALFORMED_MESSAGE",
        CoreError::ChunkCapacityExceeded | CoreError::ChunkOutOfRange => "CHUNK_OUT_OF_RANGE",
        CoreError::ChunkHashMismatch => "CHUNK_HASH_MISMATCH",
        CoreError::OffsetMismatch { .. } => "OFFSET_MISMATCH",
        CoreError::ChunkConflict => "CHUNK_CONFLICT",
        CoreError::StagingIncomplete { .. } => "STAGING_INCOMPLETE",
        CoreError::FileHashMismatch { .. } => "FILE_HASH_MISMATCH",
        CoreError::Snapshot(code) => map_contract_error(code),
    }
}

const fn map_contract_error(error: ErrorCode) -> &'static str {
    match error {
        ErrorCode::MalformedMessage => "MALFORMED_MESSAGE",
        ErrorCode::ProtocolVersionUnsupported => "PROTOCOL_VERSION_UNSUPPORTED",
        ErrorCode::RequestIdConflict => "REQUEST_ID_CONFLICT",
        ErrorCode::TransactionIdConflict => "TRANSACTION_ID_CONFLICT",
        ErrorCode::OperationUnsupported => "OPERATION_UNSUPPORTED",
        ErrorCode::InvalidState => "INVALID_STATE",
        ErrorCode::Busy => "BUSY",
        ErrorCode::TransactionNotFound => "TRANSACTION_NOT_FOUND",
        ErrorCode::OffsetMismatch => "OFFSET_MISMATCH",
        ErrorCode::ChunkOutOfRange => "CHUNK_OUT_OF_RANGE",
        ErrorCode::ChunkHashMismatch => "CHUNK_HASH_MISMATCH",
        ErrorCode::ChunkConflict => "CHUNK_CONFLICT",
        ErrorCode::StagingIncomplete => "STAGING_INCOMPLETE",
        ErrorCode::IoError => "IO_ERROR",
        ErrorCode::SnapshotSchemaUnsupported => "SNAPSHOT_SCHEMA_UNSUPPORTED",
        ErrorCode::TargetMismatch => "TARGET_MISMATCH",
        ErrorCode::CapabilityMismatch => "CAPABILITY_MISMATCH",
        ErrorCode::InsufficientSpace => "INSUFFICIENT_SPACE",
        ErrorCode::FileHashMismatch => "FILE_HASH_MISMATCH",
        ErrorCode::ManifestHashMismatch => "MANIFEST_HASH_MISMATCH",
        ErrorCode::ActivationInterrupted => "ACTIVATION_INTERRUPTED",
        ErrorCode::RollbackActive => "ROLLBACK_ACTIVE",
        ErrorCode::DesignFixtureNotRelease => "DESIGN_FIXTURE_NOT_RELEASE",
        ErrorCode::RecoveryRequired => "RECOVERY_REQUIRED",
        ErrorCode::ExpectedActiveMismatch => "EXPECTED_ACTIVE_MISMATCH",
    }
}
