#![no_std]
#![forbid(unsafe_code)]
//! Target-neutral contracts shared by the Yimi Pen firmware core.

/// A physical OID value after the board/head adapter has decoded it.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct PhysicalCode(pub u64);

/// Microseconds in one monotonic clock domain.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct MonotonicUs(pub u64);

/// Dense zero-based action slot compiled from Snapshot action-array order.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ActionSlot(pub u32);

/// Dense zero-based clip slot compiled from Snapshot clip-catalog order.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ClipSlot(pub u32);

/// Target-neutral playback policy frozen by Snapshot v1.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlayPolicy {
    /// Replace current playback with exactly one clip.
    Replace,
    /// Enqueue every referenced clip in order.
    Queue,
    /// Select exactly one referenced clip through the injected selector.
    RandomOne,
}

/// Stable transfer transaction identifier.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct TransactionId(pub u64);

/// A SHA-256 snapshot digest in binary form.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SnapshotId(pub [u8; 32]);

impl SnapshotId {
    /// Constructs a deterministic test identifier whose 32 bytes share one value.
    #[must_use]
    pub const fn test(value: u8) -> Self {
        Self([value; 32])
    }
}

/// Normalized result reported by the OID adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OidStatus {
    /// A physical code was decoded and passed the adapter checks.
    Valid,
    /// A code was decoded but remained below the frozen quality threshold.
    LowQuality,
    /// The adapter observed a read attempt without a decodable code.
    NoCode,
    /// The sensor or its transport reported a fault.
    SensorFault,
}

/// A normalized OID event. Missing phases remain `None` rather than inferred.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PhysicalCodeEvent {
    /// Decoded candidate code; product logic exposes it only for [`OidStatus::Valid`].
    pub physical_code: Option<PhysicalCode>,
    /// First event time visible to the product runtime.
    pub event_at: MonotonicUs,
    /// Earlier sensor time when the selected head exposes it.
    pub sensor_at: Option<MonotonicUs>,
    /// Ready time when the selected head exposes it.
    pub ready_at: Option<MonotonicUs>,
    /// Vendor/raw quality value when defined by the frozen adapter contract.
    pub quality: Option<u16>,
    /// Normalized status.
    pub status: OidStatus,
    /// Wrapping provider sequence, incremented for every observed or dropped event.
    pub sequence: u32,
    /// Wrapping cumulative number of provider events dropped before this event.
    pub dropped_events: u32,
}

impl PhysicalCodeEvent {
    /// Creates a valid decoded event.
    #[must_use]
    pub const fn valid(physical_code: PhysicalCode, event_at: MonotonicUs) -> Self {
        Self {
            physical_code: Some(physical_code),
            event_at,
            sensor_at: None,
            ready_at: None,
            quality: None,
            status: OidStatus::Valid,
            sequence: 0,
            dropped_events: 0,
        }
    }

    /// Returns the code only when the adapter marked the event as valid.
    #[must_use]
    pub const fn decoded_code(self) -> Option<PhysicalCode> {
        if matches!(self.status, OidStatus::Valid) {
            self.physical_code
        } else {
            None
        }
    }
}

/// Coarse device lifecycle independent from a content install transaction.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeviceState {
    /// Startup checks are still running.
    Booting,
    /// The data plane can serve point-read requests.
    Ready,
    /// Neither active nor last-good content passed boot validation.
    RecoveryRequired,
}

/// The current content-install transaction phase.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstallPhase {
    /// No content transaction is in flight.
    Idle,
    /// Content bytes are being written to the inactive area.
    Staging,
    /// The staged content is being verified.
    Verifying,
    /// Verification succeeded and activation is permitted.
    ReadyToActivate,
    /// The atomic active-head commit is in progress.
    Activating,
}

/// The content selection used by the most recent boot.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BootSelection {
    /// No validated content exists.
    Empty,
    /// The active content validated successfully.
    Active,
    /// Boot selected the previously committed last-good content.
    LastGood,
}

/// Stable summary of the most recent install or boot recovery event.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LastInstallOutcome {
    /// No install outcome has been recorded.
    None,
    /// A staged snapshot was committed.
    Activated,
    /// Verification or a capability gate rejected staging.
    Rejected,
    /// Staging was explicitly aborted or lost before activation.
    Aborted,
    /// Power was lost during activation before an atomic commit completed.
    Interrupted,
    /// Boot or an explicit command selected last-good content.
    RolledBack,
}

/// Snapshot lifecycle status returned by `DeviceLink`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeviceStatus {
    /// Device lifecycle.
    pub device_state: DeviceState,
    /// Content transaction phase.
    pub install_phase: InstallPhase,
    /// Boot-selected content source.
    pub boot_selection: BootSelection,
    /// Most recent install outcome.
    pub last_install_outcome: LastInstallOutcome,
}

/// `DeviceLink` v1 semantic operations; transport framing remains board-specific.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Operation {
    /// Negotiate the semantic protocol version.
    Hello,
    /// Read frozen device capabilities.
    CapabilitiesGet,
    /// Read lifecycle and transaction state.
    StatusGet,
    /// Begin a staged content transaction.
    SnapshotStageBegin,
    /// Write one ordered content chunk.
    SnapshotStageWrite,
    /// Verify the staged snapshot.
    SnapshotVerify,
    /// Atomically activate the staged snapshot.
    SnapshotActivate,
    /// Abort the staged snapshot.
    SnapshotAbort,
    /// Select last-good content.
    SnapshotRollback,
    /// Read bounded diagnostic events.
    DiagnosticsRead,
}

/// Stable machine-readable error codes used across transports.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    /// Message framing or fields failed decoding.
    MalformedMessage,
    /// Semantic protocol version mismatch.
    ProtocolVersionUnsupported,
    /// A request identifier was reused for different content.
    RequestIdConflict,
    /// A transaction identifier was reused with different begin metadata.
    TransactionIdConflict,
    /// The requested operation is outside device capabilities.
    OperationUnsupported,
    /// Operation does not apply in the current lifecycle phase.
    InvalidState,
    /// Another exclusive transaction owns the device.
    Busy,
    /// Transaction identifier is unknown.
    TransactionNotFound,
    /// Chunk offset differs from the next durable offset.
    OffsetMismatch,
    /// Chunk exceeds the declared file or snapshot size.
    ChunkOutOfRange,
    /// Chunk digest differs from the declared digest.
    ChunkHashMismatch,
    /// A previously durable byte range was reused with different content.
    ChunkConflict,
    /// Required content bytes remain missing.
    StagingIncomplete,
    /// Target storage reported an I/O failure.
    IoError,
    /// Snapshot schema is outside the supported set.
    SnapshotSchemaUnsupported,
    /// Snapshot targets a different frozen board or firmware line.
    TargetMismatch,
    /// Snapshot requirements exceed frozen device capabilities.
    CapabilityMismatch,
    /// Inactive storage capacity is below the declared requirement.
    InsufficientSpace,
    /// A staged file digest failed verification.
    FileHashMismatch,
    /// Manifest canonical digest failed verification.
    ManifestHashMismatch,
    /// Activation stopped before the committed head became durable.
    ActivationInterrupted,
    /// Device selected last-good content.
    RollbackActive,
    /// A design fixture reached a release-only install path.
    DesignFixtureNotRelease,
    /// Both active and last-good validation failed.
    RecoveryRequired,
    /// Compare-and-swap expected a different active snapshot.
    ExpectedActiveMismatch,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_status_never_exposes_a_code() {
        let event = PhysicalCodeEvent {
            physical_code: Some(PhysicalCode(42)),
            event_at: MonotonicUs(100),
            sensor_at: None,
            ready_at: None,
            quality: Some(1),
            status: OidStatus::LowQuality,
            sequence: 7,
            dropped_events: 1,
        };
        assert_eq!(event.decoded_code(), None);
    }
}
