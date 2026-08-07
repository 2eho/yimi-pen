#![forbid(unsafe_code)]
//! Host-only deterministic cross-check runner.

mod device_link_transcript;
mod execution_model;
mod snapshot_transcript;
mod weighted_random;

use std::path::PathBuf;

use yimi_fw_contract::{
    ActionSlot, BootSelection, ClipSlot, ErrorCode, LastInstallOutcome, MonotonicUs, PhysicalCode,
    PhysicalCodeEvent, PlayPolicy, SnapshotId, TransactionId,
};
use yimi_runtime_core::{
    ActionDescriptor, ExecutionModel, OidIndexEntry, PlaybackPlan, PointReadRuntime,
    RandomIndexSource, RuntimeDecision,
};
use yimi_snapshot_core::InstallMachine;

struct First;

impl RandomIndexSource for First {
    fn select(&mut self, _action: ActionSlot, _upper_exclusive: u32) -> u32 {
        0
    }
}

fn main() {
    let mut arguments = std::env::args_os();
    let _program = arguments.next();
    let command = arguments.next();
    if command.as_deref() == Some(std::ffi::OsStr::new("snapshot-transcript")) {
        let Some(input) = arguments.next().map(PathBuf::from) else {
            eprintln!("snapshot-transcript requires INPUT and OUTPUT paths");
            std::process::exit(2);
        };
        let Some(output) = arguments.next().map(PathBuf::from) else {
            eprintln!("snapshot-transcript requires INPUT and OUTPUT paths");
            std::process::exit(2);
        };
        if arguments.next().is_some() {
            eprintln!("snapshot-transcript accepts exactly INPUT and OUTPUT paths");
            std::process::exit(2);
        }
        if let Err(error) = snapshot_transcript::run(&input, &output) {
            eprintln!("snapshot transcript failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    if command.as_deref() == Some(std::ffi::OsStr::new("device-link-transcript")) {
        let Some(golden) = arguments.next().map(PathBuf::from) else {
            eprintln!("device-link-transcript requires GOLDEN, NEGATIVE and OUTPUT paths");
            std::process::exit(2);
        };
        let Some(negative) = arguments.next().map(PathBuf::from) else {
            eprintln!("device-link-transcript requires GOLDEN, NEGATIVE and OUTPUT paths");
            std::process::exit(2);
        };
        let Some(output) = arguments.next().map(PathBuf::from) else {
            eprintln!("device-link-transcript requires GOLDEN, NEGATIVE and OUTPUT paths");
            std::process::exit(2);
        };
        if arguments.next().is_some() {
            eprintln!("device-link-transcript accepts exactly three paths");
            std::process::exit(2);
        }
        if let Err(error) = device_link_transcript::run(&golden, &negative, &output) {
            eprintln!("device link transcript failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    if command.as_deref() == Some(std::ffi::OsStr::new("execution-model")) {
        let Some(index) = arguments.next().map(PathBuf::from) else {
            eprintln!("execution-model requires INDEX, ACTIONS, TRANSCRIPT and OUTPUT paths");
            std::process::exit(2);
        };
        let Some(actions) = arguments.next().map(PathBuf::from) else {
            eprintln!("execution-model requires INDEX, ACTIONS, TRANSCRIPT and OUTPUT paths");
            std::process::exit(2);
        };
        let Some(transcript) = arguments.next().map(PathBuf::from) else {
            eprintln!("execution-model requires INDEX, ACTIONS, TRANSCRIPT and OUTPUT paths");
            std::process::exit(2);
        };
        let Some(output) = arguments.next().map(PathBuf::from) else {
            eprintln!("execution-model requires INDEX, ACTIONS, TRANSCRIPT and OUTPUT paths");
            std::process::exit(2);
        };
        if arguments.next().is_some() {
            eprintln!("execution-model accepts exactly four paths");
            std::process::exit(2);
        }
        if let Err(error) = execution_model::run(&index, &actions, &transcript, &output) {
            eprintln!("execution model failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    if run_weighted_random_command(command.as_deref(), &mut arguments) {
        return;
    }
    let snapshot_ok = run_snapshot_crosscheck();
    let runtime_ok = run_runtime_crosscheck();
    let all_passed = snapshot_ok && runtime_ok;
    println!(
        "{{\"schemaVersion\":1,\"profile\":\"host-contract-only\",\"snapshotScenariosPassed\":{},\"snapshotScenariosTotal\":5,\"runtimeScenariosPassed\":{},\"runtimeScenariosTotal\":4,\"allPassed\":{}}}",
        if snapshot_ok { 5 } else { 0 },
        if runtime_ok { 4 } else { 0 },
        all_passed
    );
    if !all_passed {
        std::process::exit(1);
    }
}

fn run_weighted_random_command(
    command: Option<&std::ffi::OsStr>,
    arguments: &mut std::env::ArgsOs,
) -> bool {
    if command != Some(std::ffi::OsStr::new("weighted-random-v2")) {
        return false;
    }
    let Some(input) = arguments.next().map(PathBuf::from) else {
        eprintln!("weighted-random-v2 requires INPUT and OUTPUT paths");
        std::process::exit(2);
    };
    let Some(output) = arguments.next().map(PathBuf::from) else {
        eprintln!("weighted-random-v2 requires INPUT and OUTPUT paths");
        std::process::exit(2);
    };
    if arguments.next().is_some() {
        eprintln!("weighted-random-v2 accepts exactly INPUT and OUTPUT paths");
        std::process::exit(2);
    }
    if let Err(error) = weighted_random::run(&input, &output) {
        eprintln!("weighted random v2 failed: {error}");
        std::process::exit(1);
    }
    true
}

fn run_snapshot_crosscheck() -> bool {
    let v1 = SnapshotId::test(1);
    let v2 = SnapshotId::test(2);
    let v3 = SnapshotId::test(3);
    let mut machine = InstallMachine::provisioned(v1);

    let tx2 = TransactionId(2);
    if machine.begin_stage(tx2, v2, Some(v1)).is_err()
        || machine.finish_stage(tx2).is_err()
        || machine.verify_ok(tx2).is_err()
        || machine.begin_activate(tx2).is_err()
        || machine.commit_activate(tx2).is_err()
        || machine.active() != Some(v2)
        || machine.last_good() != Some(v1)
    {
        return false;
    }

    let reject_tx = TransactionId(3);
    if machine.begin_stage(reject_tx, v3, Some(v2)).is_err()
        || machine.finish_stage(reject_tx).is_err()
        || machine.reject(reject_tx, ErrorCode::FileHashMismatch) != Ok(ErrorCode::FileHashMismatch)
        || machine.active() != Some(v2)
        || machine.status().last_install_outcome != LastInstallOutcome::Rejected
    {
        return false;
    }

    let power_tx = TransactionId(4);
    if machine.begin_stage(power_tx, v3, Some(v2)).is_err() {
        return false;
    }
    machine.power_loss();
    if machine.finish_boot(true, true).is_err()
        || machine.active() != Some(v2)
        || machine.status().last_install_outcome != LastInstallOutcome::Aborted
    {
        return false;
    }

    let interrupt_tx = TransactionId(5);
    if machine.begin_stage(interrupt_tx, v3, Some(v2)).is_err()
        || machine.finish_stage(interrupt_tx).is_err()
        || machine.verify_ok(interrupt_tx).is_err()
        || machine.begin_activate(interrupt_tx).is_err()
    {
        return false;
    }
    machine.power_loss();
    if machine.finish_boot(true, true).is_err()
        || machine.active() != Some(v2)
        || machine.status().last_install_outcome != LastInstallOutcome::Interrupted
    {
        return false;
    }

    let tx6 = TransactionId(6);
    if machine.begin_stage(tx6, v3, Some(v2)).is_err()
        || machine.finish_stage(tx6).is_err()
        || machine.verify_ok(tx6).is_err()
        || machine.begin_activate(tx6).is_err()
        || machine.commit_activate(tx6).is_err()
    {
        return false;
    }
    machine.power_loss();
    machine.finish_boot(false, true).is_ok()
        && machine.active() == Some(v2)
        && machine.status().boot_selection == BootSelection::LastGood
        && machine.status().last_install_outcome == LastInstallOutcome::RolledBack
}

fn run_runtime_crosscheck() -> bool {
    let entries = [
        OidIndexEntry {
            physical_code: PhysicalCode(10),
            action_slot: ActionSlot(0),
        },
        OidIndexEntry {
            physical_code: PhysicalCode(20),
            action_slot: ActionSlot(1),
        },
    ];
    let actions = [
        ActionDescriptor {
            play_policy: PlayPolicy::Replace,
            cooldown_us: 200,
            first_clip: 0,
            clip_count: 1,
        },
        ActionDescriptor {
            play_policy: PlayPolicy::Replace,
            cooldown_us: 0,
            first_clip: 1,
            clip_count: 1,
        },
    ];
    let clips = [ClipSlot(0), ClipSlot(1)];
    let Ok(model) = ExecutionModel::new(&entries, &actions, &clips, 2) else {
        return false;
    };
    let mut cooldown = [None; 2];
    let Ok(mut runtime) = PointReadRuntime::new(model, &mut cooldown) else {
        return false;
    };
    let mut selector = First;
    runtime.on_event(
        PhysicalCodeEvent::valid(PhysicalCode(10), MonotonicUs(1_000)),
        &mut selector,
    ) == Ok(RuntimeDecision::Play {
        action_slot: ActionSlot(0),
        plan: PlaybackPlan::Replace(ClipSlot(0)),
    }) && runtime.on_event(
        PhysicalCodeEvent::valid(PhysicalCode(10), MonotonicUs(1_100)),
        &mut selector,
    ) == Ok(RuntimeDecision::SuppressCooldown(ActionSlot(0)))
        && runtime.on_event(
            PhysicalCodeEvent::valid(PhysicalCode(20), MonotonicUs(1_150)),
            &mut selector,
        ) == Ok(RuntimeDecision::Play {
            action_slot: ActionSlot(1),
            plan: PlaybackPlan::Replace(ClipSlot(1)),
        })
        && runtime.on_event(
            PhysicalCodeEvent::valid(PhysicalCode(99), MonotonicUs(2_000)),
            &mut selector,
        ) == Ok(RuntimeDecision::Unbound(PhysicalCode(99)))
}
