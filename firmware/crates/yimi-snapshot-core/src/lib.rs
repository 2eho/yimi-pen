#![no_std]
#![forbid(unsafe_code)]
//! Target-neutral Snapshot v1 lifecycle state machine.

use yimi_fw_contract::{
    BootSelection, DeviceState, DeviceStatus, ErrorCode, InstallPhase, LastInstallOutcome,
    SnapshotId, TransactionId,
};

/// Result type for lifecycle operations.
pub type Result<T> = core::result::Result<T, ErrorCode>;

/// In-memory semantic model. Durable storage and atomicity belong to a board adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstallMachine {
    status: DeviceStatus,
    active: Option<SnapshotId>,
    last_good: Option<SnapshotId>,
    staged: Option<SnapshotId>,
    transaction: Option<TransactionId>,
}

impl InstallMachine {
    /// Creates an empty device before factory provisioning.
    #[must_use]
    pub const fn empty() -> Self {
        Self {
            status: DeviceStatus {
                device_state: DeviceState::Booting,
                install_phase: InstallPhase::Idle,
                boot_selection: BootSelection::Empty,
                last_install_outcome: LastInstallOutcome::None,
            },
            active: None,
            last_good: None,
            staged: None,
            transaction: None,
        }
    }

    /// Creates a ready device with one factory-provisioned snapshot.
    #[must_use]
    pub const fn provisioned(snapshot: SnapshotId) -> Self {
        Self {
            status: DeviceStatus {
                device_state: DeviceState::Ready,
                install_phase: InstallPhase::Idle,
                boot_selection: BootSelection::Active,
                last_install_outcome: LastInstallOutcome::Activated,
            },
            active: Some(snapshot),
            last_good: Some(snapshot),
            staged: None,
            transaction: None,
        }
    }

    /// Returns the orthogonal device/install/boot status.
    #[must_use]
    pub const fn status(&self) -> DeviceStatus {
        self.status
    }

    /// Returns the committed active snapshot.
    #[must_use]
    pub const fn active(&self) -> Option<SnapshotId> {
        self.active
    }

    /// Returns the last-good snapshot.
    #[must_use]
    pub const fn last_good(&self) -> Option<SnapshotId> {
        self.last_good
    }

    /// Returns the staged snapshot, when a transaction is active.
    #[must_use]
    pub const fn staged(&self) -> Option<SnapshotId> {
        self.staged
    }

    /// Returns the active transaction identifier.
    #[must_use]
    pub const fn transaction(&self) -> Option<TransactionId> {
        self.transaction
    }

    /// Begins writing an inactive snapshot using active-ID compare-and-swap.
    ///
    /// # Errors
    ///
    /// Returns [`ErrorCode::Busy`] for an active transaction or
    /// [`ErrorCode::ExpectedActiveMismatch`] for stale host state.
    pub fn begin_stage(
        &mut self,
        transaction: TransactionId,
        snapshot: SnapshotId,
        expected_active: Option<SnapshotId>,
    ) -> Result<()> {
        if self.status.install_phase != InstallPhase::Idle {
            return Err(ErrorCode::Busy);
        }
        if expected_active != self.active {
            return Err(ErrorCode::ExpectedActiveMismatch);
        }
        self.transaction = Some(transaction);
        self.staged = Some(snapshot);
        self.status.install_phase = InstallPhase::Staging;
        Ok(())
    }

    /// Marks all staged bytes durable and starts verification.
    ///
    /// # Errors
    ///
    /// Returns a transaction/state error when staging is not active.
    pub fn finish_stage(&mut self, transaction: TransactionId) -> Result<()> {
        self.require(transaction, InstallPhase::Staging)?;
        self.status.install_phase = InstallPhase::Verifying;
        Ok(())
    }

    /// Records successful manifest, file, target, and capability verification.
    ///
    /// # Errors
    ///
    /// Returns a transaction/state error when verification is not active.
    pub fn verify_ok(&mut self, transaction: TransactionId) -> Result<()> {
        self.require(transaction, InstallPhase::Verifying)?;
        self.status.install_phase = InstallPhase::ReadyToActivate;
        Ok(())
    }

    /// Rejects staged content while keeping active and last-good unchanged.
    ///
    /// # Errors
    ///
    /// Returns a transaction/state error when no rejectable stage exists.
    pub fn reject(&mut self, transaction: TransactionId, reason: ErrorCode) -> Result<ErrorCode> {
        if self.transaction != Some(transaction) {
            return Err(ErrorCode::TransactionNotFound);
        }
        if matches!(
            self.status.install_phase,
            InstallPhase::Idle | InstallPhase::Activating
        ) {
            return Err(ErrorCode::InvalidState);
        }
        self.clear_staging(LastInstallOutcome::Rejected);
        Ok(reason)
    }

    /// Starts the atomic active-head commit.
    ///
    /// # Errors
    ///
    /// Returns a transaction/state error before verification succeeds.
    pub fn begin_activate(&mut self, transaction: TransactionId) -> Result<()> {
        self.require(transaction, InstallPhase::ReadyToActivate)?;
        self.status.install_phase = InstallPhase::Activating;
        Ok(())
    }

    /// Starts activation after rechecking the active snapshot with compare-and-swap.
    ///
    /// # Errors
    ///
    /// Returns a transaction/state error before verification succeeds or
    /// [`ErrorCode::ExpectedActiveMismatch`] when the host's active snapshot is stale.
    pub fn begin_activate_cas(
        &mut self,
        transaction: TransactionId,
        expected_active: Option<SnapshotId>,
    ) -> Result<()> {
        self.require(transaction, InstallPhase::ReadyToActivate)?;
        if self.active != expected_active {
            return Err(ErrorCode::ExpectedActiveMismatch);
        }
        self.status.install_phase = InstallPhase::Activating;
        Ok(())
    }

    /// Commits the active-head update after the board adapter reports durability.
    ///
    /// # Errors
    ///
    /// Returns a transaction/state error or [`ErrorCode::StagingIncomplete`].
    pub fn commit_activate(&mut self, transaction: TransactionId) -> Result<()> {
        self.require(transaction, InstallPhase::Activating)?;
        let staged = self.staged.ok_or(ErrorCode::StagingIncomplete)?;
        self.last_good = self.active;
        self.active = Some(staged);
        self.status.boot_selection = BootSelection::Active;
        self.clear_staging(LastInstallOutcome::Activated);
        Ok(())
    }

    /// Explicitly aborts a pre-activation transaction.
    ///
    /// # Errors
    ///
    /// Returns a transaction/state error after activation begins or when the
    /// transaction identifier differs.
    pub fn abort(&mut self, transaction: TransactionId) -> Result<()> {
        if self.transaction != Some(transaction) {
            return Err(ErrorCode::TransactionNotFound);
        }
        if matches!(
            self.status.install_phase,
            InstallPhase::Idle | InstallPhase::Activating
        ) {
            return Err(ErrorCode::InvalidState);
        }
        self.clear_staging(LastInstallOutcome::Aborted);
        Ok(())
    }

    /// Atomically selects last-good content after active-ID compare-and-swap.
    ///
    /// The caller invokes this semantic commit only after its board adapter has
    /// made the corresponding active-head record durable.
    ///
    /// # Errors
    ///
    /// Returns [`ErrorCode::ExpectedActiveMismatch`] for stale host state or
    /// [`ErrorCode::InvalidState`] when an install is active, the device is not
    /// ready, or there is no distinct last-good snapshot.
    pub fn rollback(&mut self, expected_active: SnapshotId) -> Result<()> {
        if self.status.install_phase != InstallPhase::Idle
            || self.status.device_state != DeviceState::Ready
        {
            return Err(ErrorCode::InvalidState);
        }
        if self.active != Some(expected_active) {
            return Err(ErrorCode::ExpectedActiveMismatch);
        }
        let last_good = self.last_good.ok_or(ErrorCode::InvalidState)?;
        if self.active == Some(last_good) {
            return Err(ErrorCode::InvalidState);
        }
        self.active = Some(last_good);
        self.status.boot_selection = BootSelection::LastGood;
        self.status.last_install_outcome = LastInstallOutcome::RolledBack;
        Ok(())
    }

    /// Applies the externally verified effect of a power loss at the current phase.
    pub fn power_loss(&mut self) {
        let outcome = if self.status.install_phase == InstallPhase::Activating {
            LastInstallOutcome::Interrupted
        } else if self.status.install_phase == InstallPhase::Idle {
            self.status.last_install_outcome
        } else {
            LastInstallOutcome::Aborted
        };
        self.clear_staging(outcome);
        self.status.device_state = DeviceState::Booting;
    }

    /// Selects active or last-good content using board-adapter validation results.
    ///
    /// # Errors
    ///
    /// Returns [`ErrorCode::RecoveryRequired`] when neither content selection
    /// has a validated snapshot.
    pub fn finish_boot(&mut self, active_valid: bool, last_good_valid: bool) -> Result<()> {
        if active_valid && self.active.is_some() {
            self.status.device_state = DeviceState::Ready;
            self.status.boot_selection = BootSelection::Active;
            self.status.install_phase = InstallPhase::Idle;
            return Ok(());
        }
        if last_good_valid && self.last_good.is_some() {
            self.active = self.last_good;
            self.status.device_state = DeviceState::Ready;
            self.status.boot_selection = BootSelection::LastGood;
            self.status.last_install_outcome = LastInstallOutcome::RolledBack;
            self.status.install_phase = InstallPhase::Idle;
            return Ok(());
        }
        self.status.device_state = DeviceState::RecoveryRequired;
        self.status.boot_selection = BootSelection::Empty;
        self.status.install_phase = InstallPhase::Idle;
        Err(ErrorCode::RecoveryRequired)
    }

    fn require(&self, transaction: TransactionId, phase: InstallPhase) -> Result<()> {
        if self.transaction != Some(transaction) {
            return Err(ErrorCode::TransactionNotFound);
        }
        if self.status.install_phase != phase {
            return Err(ErrorCode::InvalidState);
        }
        Ok(())
    }

    fn clear_staging(&mut self, outcome: LastInstallOutcome) {
        self.staged = None;
        self.transaction = None;
        self.status.install_phase = InstallPhase::Idle;
        self.status.last_install_outcome = outcome;
    }
}

impl Default for InstallMachine {
    fn default() -> Self {
        Self::empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TX: TransactionId = TransactionId(1);
    const V1: SnapshotId = SnapshotId::test(1);
    const V2: SnapshotId = SnapshotId::test(2);
    const V3: SnapshotId = SnapshotId::test(3);

    fn activate(machine: &mut InstallMachine, tx: TransactionId, next: SnapshotId) {
        machine.begin_stage(tx, next, machine.active()).unwrap();
        machine.finish_stage(tx).unwrap();
        machine.verify_ok(tx).unwrap();
        machine.begin_activate(tx).unwrap();
        machine.commit_activate(tx).unwrap();
    }

    #[test]
    fn successful_activation_preserves_previous_as_last_good() {
        let mut machine = InstallMachine::provisioned(V1);
        activate(&mut machine, TX, V2);
        assert_eq!(machine.active(), Some(V2));
        assert_eq!(machine.last_good(), Some(V1));
        assert_eq!(
            machine.status().last_install_outcome,
            LastInstallOutcome::Activated
        );
    }

    #[test]
    fn verification_rejection_keeps_active() {
        let mut machine = InstallMachine::provisioned(V1);
        machine.begin_stage(TX, V2, Some(V1)).unwrap();
        machine.finish_stage(TX).unwrap();
        assert_eq!(
            machine.reject(TX, ErrorCode::FileHashMismatch),
            Ok(ErrorCode::FileHashMismatch)
        );
        assert_eq!(machine.active(), Some(V1));
        assert_eq!(machine.last_good(), Some(V1));
        assert_eq!(
            machine.status().last_install_outcome,
            LastInstallOutcome::Rejected
        );
    }

    #[test]
    fn staging_power_loss_keeps_active() {
        let mut machine = InstallMachine::provisioned(V1);
        machine.begin_stage(TX, V2, Some(V1)).unwrap();
        machine.power_loss();
        machine.finish_boot(true, true).unwrap();
        assert_eq!(machine.active(), Some(V1));
        assert_eq!(
            machine.status().last_install_outcome,
            LastInstallOutcome::Aborted
        );
    }

    #[test]
    fn activation_power_loss_keeps_committed_head_and_reports_interruption() {
        let mut machine = InstallMachine::provisioned(V1);
        machine.begin_stage(TX, V2, Some(V1)).unwrap();
        machine.finish_stage(TX).unwrap();
        machine.verify_ok(TX).unwrap();
        machine.begin_activate(TX).unwrap();
        machine.power_loss();
        machine.finish_boot(true, true).unwrap();
        assert_eq!(machine.active(), Some(V1));
        assert_eq!(
            machine.status().last_install_outcome,
            LastInstallOutcome::Interrupted
        );
    }

    #[test]
    fn corrupt_active_rolls_back_to_last_good() {
        let mut machine = InstallMachine::provisioned(V1);
        activate(&mut machine, TransactionId(2), V2);
        activate(&mut machine, TransactionId(3), V3);
        machine.power_loss();
        machine.finish_boot(false, true).unwrap();
        assert_eq!(machine.active(), Some(V2));
        assert_eq!(machine.status().boot_selection, BootSelection::LastGood);
        assert_eq!(
            machine.status().last_install_outcome,
            LastInstallOutcome::RolledBack
        );
    }

    #[test]
    fn compare_and_swap_rejects_stale_host_state() {
        let mut machine = InstallMachine::provisioned(V1);
        assert_eq!(
            machine.begin_stage(TX, V2, Some(V3)),
            Err(ErrorCode::ExpectedActiveMismatch)
        );
    }

    #[test]
    fn activation_compare_and_swap_failure_preserves_ready_state() {
        let mut machine = InstallMachine::provisioned(V1);
        machine.begin_stage(TX, V2, Some(V1)).unwrap();
        machine.finish_stage(TX).unwrap();
        machine.verify_ok(TX).unwrap();
        let before = machine;
        assert_eq!(
            machine.begin_activate_cas(TX, Some(V3)),
            Err(ErrorCode::ExpectedActiveMismatch)
        );
        assert_eq!(machine, before);
    }

    #[test]
    fn explicit_rollback_selects_last_good_with_cas() {
        let mut machine = InstallMachine::provisioned(V1);
        activate(&mut machine, TX, V2);
        assert_eq!(machine.rollback(V2), Ok(()));
        assert_eq!(machine.active(), Some(V1));
        assert_eq!(machine.last_good(), Some(V1));
        assert_eq!(machine.status().boot_selection, BootSelection::LastGood);
        assert_eq!(
            machine.status().last_install_outcome,
            LastInstallOutcome::RolledBack
        );
    }

    #[test]
    fn rollback_failures_preserve_state() {
        let mut machine = InstallMachine::provisioned(V1);
        let before = machine;
        assert_eq!(machine.rollback(V2), Err(ErrorCode::ExpectedActiveMismatch));
        assert_eq!(machine, before);
        assert_eq!(machine.rollback(V1), Err(ErrorCode::InvalidState));
        assert_eq!(machine, before);
    }
}
