use std::collections::BTreeMap;
use std::error::Error;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use yimi_fw_contract::{ErrorCode, SnapshotId, TransactionId};
use yimi_snapshot_core::InstallMachine;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Transcript {
    schema_version: u32,
    profile: String,
    snapshots: Vec<SnapshotSpec>,
    devices: Vec<DeviceSpec>,
    scenarios: Vec<Scenario>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnapshotSpec {
    key: String,
    source_directory: String,
    snapshot_id: String,
    content_revision: String,
    release_state: ReleaseState,
    first_action_cooldown_ms: u64,
    required_bytes: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum ReleaseState {
    DesignFixture,
    ReleaseCandidate,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeviceSpec {
    id: String,
    storage_free_bytes: u64,
    allow_design_fixtures: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scenario {
    id: String,
    #[serde(rename = "description")]
    _description: String,
    device: String,
    operation: Operation,
    #[serde(rename = "expected")]
    _expected: Outcome,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "op",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Operation {
    Provision {
        snapshot: String,
    },
    Install {
        snapshot: String,
        #[serde(default)]
        fault: Option<Fault>,
        #[serde(default)]
        recover_after_error: RecoveryMode,
    },
    CorruptActiveAndBoot {
        file_path: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Fault {
    CorruptFile { file_path: String },
    PowerLossDuringStaging { after_file_count: u64 },
    PowerLossBeforeHeadCommit,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum RecoveryMode {
    Status,
    BootRepair,
    #[default]
    None,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Outcome {
    active: Option<String>,
    last_good: Option<String>,
    generation: u64,
    snapshot: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScenarioResult {
    id: String,
    #[serde(flatten)]
    outcome: Outcome,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdapterReport {
    schema_version: u32,
    profile: &'static str,
    transcript_profile: String,
    results: Vec<ScenarioResult>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Slot {
    A,
    B,
}

impl Slot {
    const fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }

    const fn index(self) -> usize {
        match self {
            Self::A => 0,
            Self::B => 1,
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::A => "A",
            Self::B => "B",
        }
    }
}

#[derive(Clone, Debug)]
struct CoreSnapshot {
    spec: SnapshotSpec,
    core_id: SnapshotId,
}

#[derive(Debug)]
struct AdapterDevice {
    spec: DeviceSpec,
    machine: InstallMachine,
    active_slot: Option<Slot>,
    last_good_slot: Option<Slot>,
    slot_core_ids: [Option<SnapshotId>; 2],
    slot_snapshot_ids: [Option<String>; 2],
    generation: u64,
}

impl AdapterDevice {
    fn new(spec: DeviceSpec) -> Self {
        Self {
            spec,
            machine: InstallMachine::empty(),
            active_slot: None,
            last_good_slot: None,
            slot_core_ids: [None, None],
            slot_snapshot_ids: [None, None],
            generation: 0,
        }
    }

    fn reset(&mut self) {
        self.machine = InstallMachine::empty();
        self.active_slot = None;
        self.last_good_slot = None;
        self.slot_core_ids = [None, None];
        self.slot_snapshot_ids = [None, None];
        self.generation = 0;
    }

    fn preflight(&self, snapshot: &CoreSnapshot) -> Result<(), NormalizedError> {
        if snapshot.spec.required_bytes > self.spec.storage_free_bytes {
            return Err(NormalizedError::InsufficientSpace);
        }
        if snapshot.spec.release_state == ReleaseState::DesignFixture
            && !self.spec.allow_design_fixtures
        {
            return Err(NormalizedError::DesignFixtureNotRelease);
        }
        Ok(())
    }

    fn provision(&mut self, snapshot: &CoreSnapshot) -> Result<(), NormalizedError> {
        self.reset();
        self.preflight(snapshot)?;
        self.machine = InstallMachine::provisioned(snapshot.core_id);
        self.active_slot = Some(Slot::A);
        self.last_good_slot = Some(Slot::A);
        self.slot_core_ids[Slot::A.index()] = Some(snapshot.core_id);
        self.slot_snapshot_ids[Slot::A.index()] = Some(snapshot.spec.snapshot_id.clone());
        self.generation = 1;
        Ok(())
    }

    fn install(
        &mut self,
        snapshot: &CoreSnapshot,
        transaction: TransactionId,
        fault: Option<&Fault>,
    ) -> Result<(), NormalizedError> {
        self.machine
            .finish_boot(true, self.machine.last_good().is_some())
            .map_err(NormalizedError::Core)?;
        self.preflight(snapshot)?;
        let active = self.active_slot.ok_or(NormalizedError::HarnessState)?;
        let inactive = active.other();
        self.machine
            .begin_stage(transaction, snapshot.core_id, self.machine.active())
            .map_err(NormalizedError::Core)?;

        if let Some(Fault::PowerLossDuringStaging { after_file_count }) = fault {
            if *after_file_count == 0 {
                return Err(NormalizedError::HarnessState);
            }
            self.machine.power_loss();
            return Err(NormalizedError::SimulatedPowerLoss);
        }

        self.machine
            .finish_stage(transaction)
            .map_err(NormalizedError::Core)?;
        if let Some(Fault::CorruptFile { file_path }) = fault {
            if file_path.is_empty() {
                return Err(NormalizedError::HarnessState);
            }
            self.machine
                .reject(transaction, ErrorCode::FileHashMismatch)
                .map_err(NormalizedError::Core)?;
            return Err(NormalizedError::FileHashMismatch);
        }
        self.machine
            .verify_ok(transaction)
            .map_err(NormalizedError::Core)?;
        self.machine
            .begin_activate(transaction)
            .map_err(NormalizedError::Core)?;
        if matches!(fault, Some(Fault::PowerLossBeforeHeadCommit)) {
            self.machine.power_loss();
            return Err(NormalizedError::SimulatedPowerLoss);
        }
        self.machine
            .commit_activate(transaction)
            .map_err(NormalizedError::Core)?;
        self.last_good_slot = Some(active);
        self.active_slot = Some(inactive);
        self.slot_core_ids[inactive.index()] = Some(snapshot.core_id);
        self.slot_snapshot_ids[inactive.index()] = Some(snapshot.spec.snapshot_id.clone());
        self.generation += 1;
        Ok(())
    }

    fn recover(&mut self, mode: RecoveryMode) -> Result<(), NormalizedError> {
        match mode {
            RecoveryMode::Status | RecoveryMode::None => Ok(()),
            RecoveryMode::BootRepair => self
                .machine
                .finish_boot(true, self.machine.last_good().is_some())
                .map_err(NormalizedError::Core),
        }
    }

    fn corrupt_active_and_boot(&mut self, file_path: &str) -> Result<(), NormalizedError> {
        if file_path.is_empty() || self.last_good_slot.is_none() {
            return Err(NormalizedError::HarnessState);
        }
        self.machine
            .finish_boot(false, true)
            .map_err(NormalizedError::Core)?;
        let fallback = self.last_good_slot.ok_or(NormalizedError::HarnessState)?;
        self.active_slot = Some(fallback);
        self.last_good_slot = Some(fallback);
        self.generation += 1;
        Ok(())
    }

    fn outcome(&self, error: Option<NormalizedError>) -> Result<Outcome, NormalizedError> {
        let active_core = self
            .active_slot
            .and_then(|slot| self.slot_core_ids[slot.index()]);
        let last_good_core = self
            .last_good_slot
            .and_then(|slot| self.slot_core_ids[slot.index()]);
        if active_core != self.machine.active() || last_good_core != self.machine.last_good() {
            return Err(NormalizedError::HarnessState);
        }
        let snapshot = self
            .active_slot
            .and_then(|slot| self.slot_snapshot_ids[slot.index()].clone());
        Ok(Outcome {
            active: self.active_slot.map(|slot| slot.label().to_owned()),
            last_good: self.last_good_slot.map(|slot| slot.label().to_owned()),
            generation: self.generation,
            snapshot,
            error: error.map(|value| value.code().to_owned()),
        })
    }
}

#[derive(Clone, Copy, Debug)]
enum NormalizedError {
    Core(ErrorCode),
    FileHashMismatch,
    InsufficientSpace,
    DesignFixtureNotRelease,
    SimulatedPowerLoss,
    HarnessState,
}

impl NormalizedError {
    const fn code(self) -> &'static str {
        match self {
            Self::Core(ErrorCode::FileHashMismatch) | Self::FileHashMismatch => {
                "FILE_HASH_MISMATCH"
            }
            Self::Core(ErrorCode::InsufficientSpace) | Self::InsufficientSpace => {
                "INSUFFICIENT_SPACE"
            }
            Self::Core(ErrorCode::DesignFixtureNotRelease) | Self::DesignFixtureNotRelease => {
                "DESIGN_FIXTURE_NOT_RELEASE"
            }
            Self::SimulatedPowerLoss => "SIMULATED_POWER_LOSS",
            Self::HarnessState => "HARNESS_STATE_INVALID",
            Self::Core(_) => "UNEXPECTED_CORE_ERROR",
        }
    }
}

fn snapshot_map(
    specs: Vec<SnapshotSpec>,
) -> Result<BTreeMap<String, CoreSnapshot>, Box<dyn Error>> {
    let mut snapshots = BTreeMap::new();
    for (index, spec) in specs.into_iter().enumerate() {
        if spec.key.is_empty()
            || spec.source_directory.is_empty()
            || spec.snapshot_id.is_empty()
            || spec.content_revision.is_empty()
            || spec.required_bytes == 0
            || spec.first_action_cooldown_ms > u64::from(u32::MAX)
        {
            return Err("snapshot transcript contains an incomplete snapshot".into());
        }
        let ordinal =
            u8::try_from(index + 1).map_err(|_| "snapshot transcript exceeds 255 fixtures")?;
        let key = spec.key.clone();
        let value = CoreSnapshot {
            spec,
            core_id: SnapshotId::test(ordinal),
        };
        if snapshots.insert(key, value).is_some() {
            return Err("snapshot transcript contains a duplicate key".into());
        }
    }
    Ok(snapshots)
}

fn device_map(specs: Vec<DeviceSpec>) -> Result<BTreeMap<String, AdapterDevice>, Box<dyn Error>> {
    let mut devices = BTreeMap::new();
    for spec in specs {
        if spec.id.is_empty() {
            return Err("snapshot transcript contains an empty device id".into());
        }
        let id = spec.id.clone();
        if devices.insert(id, AdapterDevice::new(spec)).is_some() {
            return Err("snapshot transcript contains a duplicate device id".into());
        }
    }
    Ok(devices)
}

fn execute(
    scenario: Scenario,
    ordinal: u64,
    snapshots: &BTreeMap<String, CoreSnapshot>,
    devices: &mut BTreeMap<String, AdapterDevice>,
) -> Result<ScenarioResult, Box<dyn Error>> {
    let device = devices
        .get_mut(&scenario.device)
        .ok_or_else(|| format!("{} names unknown device {}", scenario.id, scenario.device))?;
    let error = match scenario.operation {
        Operation::Provision { snapshot } => {
            let snapshot = snapshots
                .get(&snapshot)
                .ok_or_else(|| format!("{} names unknown snapshot", scenario.id))?;
            device.provision(snapshot).err()
        }
        Operation::Install {
            snapshot,
            fault,
            recover_after_error,
        } => {
            let snapshot = snapshots
                .get(&snapshot)
                .ok_or_else(|| format!("{} names unknown snapshot", scenario.id))?;
            let error = device
                .install(snapshot, TransactionId(ordinal), fault.as_ref())
                .err();
            if error.is_some() {
                device
                    .recover(recover_after_error)
                    .map_err(NormalizedError::code)?;
            }
            error
        }
        Operation::CorruptActiveAndBoot { file_path } => {
            device.corrupt_active_and_boot(&file_path).err()
        }
    };
    let outcome = device.outcome(error).map_err(NormalizedError::code)?;
    Ok(ScenarioResult {
        id: scenario.id,
        outcome,
    })
}

pub(crate) fn run(input: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    let bytes = fs::read(input)?;
    let transcript: Transcript = serde_json::from_slice(&bytes)?;
    if transcript.schema_version != 1 || transcript.profile != "snapshot-operation-transcript-v1" {
        return Err("unsupported snapshot operation transcript profile".into());
    }
    let snapshots = snapshot_map(transcript.snapshots)?;
    let mut devices = device_map(transcript.devices)?;
    let mut results = Vec::with_capacity(transcript.scenarios.len());
    for (index, scenario) in transcript.scenarios.into_iter().enumerate() {
        let ordinal = u64::try_from(index + 1)?;
        results.push(execute(scenario, ordinal, &snapshots, &mut devices)?);
    }
    let report = AdapterReport {
        schema_version: 1,
        profile: "rust-install-machine-adapter",
        transcript_profile: transcript.profile,
        results,
    };
    let parent = output
        .parent()
        .ok_or("snapshot transcript output has no parent directory")?;
    fs::create_dir_all(parent)?;
    fs::write(
        output,
        format!("{}\n", serde_json::to_string_pretty(&report)?),
    )?;
    Ok(())
}
