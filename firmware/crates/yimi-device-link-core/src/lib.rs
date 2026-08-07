#![no_std]
#![forbid(unsafe_code)]
//! Allocation-free, target-neutral `DeviceLink` staged-transfer semantics.
//!
//! The core deliberately separates validation from durable I/O. A caller asks
//! [`DeviceLinkCore::prepare_chunk`] for a write or replay plan, performs the
//! required storage operation, and advances the durable offset only through
//! [`DeviceLinkCore::commit_chunk`]. Board-specific capacity, hashing, storage,
//! framing, and synchronization stay outside this crate.

use yimi_fw_contract::{DeviceStatus, ErrorCode, InstallPhase, SnapshotId, TransactionId};
use yimi_snapshot_core::InstallMachine;

/// A SHA-256 digest supplied by the caller's reviewed implementation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Sha256Digest(pub [u8; 32]);

/// Caller-provided SHA-256 implementation.
pub trait Sha256Provider {
    /// Computes SHA-256 over exactly `bytes`.
    fn digest(&self, bytes: &[u8]) -> Sha256Digest;
}

/// One immutable file declaration derived from a verified snapshot manifest.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FileSpec<'a> {
    /// Snapshot-relative ASCII path.
    pub path: &'a [u8],
    /// Exact file length.
    pub byte_length: u64,
    /// Expected digest of the complete file.
    pub sha256: Sha256Digest,
}

/// Result of beginning a staged transaction.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BeginOutcome {
    /// A new transaction entered `Staging`.
    Started,
    /// An identical begin was replayed and the existing transaction was kept.
    Resumed,
}

/// Exact stateful errors returned before any semantic state change.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CoreError {
    /// Another transaction owns the staging area.
    Busy,
    /// The operation is invalid in the current install phase.
    InvalidState,
    /// The transaction identifier is not active.
    TransactionNotFound,
    /// An active transaction identifier was reused with different metadata.
    TransactionIdConflict,
    /// Active snapshot compare-and-swap failed.
    ExpectedActiveMismatch,
    /// Caller-supplied file count exceeds the const-generic capacity.
    FileCapacityExceeded,
    /// Caller-supplied path exceeds the const-generic capacity or grammar.
    InvalidPath,
    /// Two manifest entries use the same path.
    DuplicatePath,
    /// The declared total differs from the checked sum of file lengths.
    TotalBytesMismatch,
    /// A write contains no bytes.
    EmptyChunk,
    /// A write exceeds the const-generic chunk capacity.
    ChunkCapacityExceeded,
    /// The declared chunk digest differs from the supplied bytes.
    ChunkHashMismatch,
    /// The requested file is outside the active manifest.
    FileNotFound,
    /// A later file was written before the current file completed.
    FileOrderMismatch {
        /// Manifest index that must be written next.
        expected_index: usize,
        /// Manifest index supplied by the request.
        received_index: usize,
    },
    /// The requested range starts away from the next durable offset.
    OffsetMismatch {
        /// Next durable offset.
        expected: u64,
        /// Request offset.
        received: u64,
    },
    /// The requested range overflows or exceeds the declared file length.
    ChunkOutOfRange,
    /// A replayed durable range contains different bytes.
    ChunkConflict,
    /// At least one declared file remains incomplete.
    StagingIncomplete {
        /// First incomplete file index.
        file_index: usize,
        /// Durable bytes for that file.
        durable_bytes: u64,
        /// Declared bytes for that file.
        expected_bytes: u64,
    },
    /// Whole-file digest count differs from the manifest file count.
    FileDigestCountMismatch {
        /// Manifest file count.
        expected: usize,
        /// Caller-supplied digest count.
        received: usize,
    },
    /// A complete staged file differs from its manifest digest.
    FileHashMismatch {
        /// Manifest index of the mismatching file.
        file_index: usize,
    },
    /// A previously prepared permit no longer matches current state.
    StalePermit,
    /// The snapshot lifecycle returned an unexpected contract error.
    Snapshot(ErrorCode),
}

/// A plan returned after validating one chunk without changing state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChunkPlan {
    /// Caller must write and synchronize the bytes, then commit this permit.
    Write(WritePermit),
    /// Bytes are already durable; caller must hash that range and confirm it.
    Replay(ReplayPermit),
}

/// Opaque permission to advance a new durable chunk.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WritePermit {
    transaction: TransactionId,
    file_index: usize,
    offset: u64,
    byte_length: u64,
    digest: Sha256Digest,
}

impl WritePermit {
    /// Returns the manifest file index to write.
    #[must_use]
    pub const fn file_index(self) -> usize {
        self.file_index
    }

    /// Returns the exact write offset.
    #[must_use]
    pub const fn offset(self) -> u64 {
        self.offset
    }

    /// Returns the exact write length.
    #[must_use]
    pub const fn byte_length(self) -> u64 {
        self.byte_length
    }

    /// Returns the digest that was checked against the request bytes.
    #[must_use]
    pub const fn digest(self) -> Sha256Digest {
        self.digest
    }
}

/// Opaque requirement for validating an already durable byte range.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReplayPermit {
    transaction: TransactionId,
    file_index: usize,
    offset: u64,
    byte_length: u64,
    digest: Sha256Digest,
}

impl ReplayPermit {
    /// Returns the manifest file index to read.
    #[must_use]
    pub const fn file_index(self) -> usize {
        self.file_index
    }

    /// Returns the exact replay range offset.
    #[must_use]
    pub const fn offset(self) -> u64 {
        self.offset
    }

    /// Returns the exact replay range length.
    #[must_use]
    pub const fn byte_length(self) -> u64 {
        self.byte_length
    }
}

/// Acknowledgement tied to the durable transaction ledger.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ChunkAck {
    /// Manifest file index.
    pub file_index: usize,
    /// Next durable offset for that file.
    pub next_durable_offset: u64,
    /// Total durable content bytes in this transaction.
    pub total_durable_bytes: u64,
    /// Whether this acknowledgement came from an existing durable range.
    pub replayed: bool,
}

/// Read-only progress needed by a reconnecting host.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TransactionStatus<'a> {
    /// Active transaction identifier.
    pub transaction: TransactionId,
    /// Staged snapshot identifier.
    pub snapshot: SnapshotId,
    /// Current install phase.
    pub install_phase: InstallPhase,
    /// First incomplete file index, or `None` when all files are complete.
    pub next_file_index: Option<usize>,
    /// First incomplete file path, or `None` when all files are complete.
    pub next_file_path: Option<&'a [u8]>,
    /// Durable offset within `next_file_path`.
    pub next_durable_offset: u64,
    /// Total durable bytes across all files.
    pub total_durable_bytes: u64,
    /// Declared content bytes across all files.
    pub total_bytes: u64,
    /// Number of manifest files.
    pub file_count: usize,
}

/// Result of successful snapshot verification.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VerifyOutcome {
    /// Verified snapshot identifier.
    pub snapshot: SnapshotId,
    /// Total verified content bytes.
    pub total_bytes: u64,
    /// Number of verified files.
    pub file_count: usize,
}

/// Result of an atomic semantic activation or rollback.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SelectionOutcome {
    /// Newly selected active snapshot.
    pub active: SnapshotId,
    /// Snapshot retained as last-good.
    pub last_good: Option<SnapshotId>,
}

/// Fixed-capacity ASCII request identity used by the wire replay journal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OpaqueRequestId<const MAX_REQUEST_ID_BYTES: usize> {
    bytes: [u8; MAX_REQUEST_ID_BYTES],
    length: usize,
}

impl<const MAX_REQUEST_ID_BYTES: usize> OpaqueRequestId<MAX_REQUEST_ID_BYTES> {
    /// Copies a non-empty printable ASCII identity into fixed storage.
    ///
    /// # Errors
    ///
    /// Returns [`ReplayError::InvalidRequestId`] when the identity is empty,
    /// exceeds the const-generic capacity, or contains control/non-ASCII bytes.
    pub fn new(bytes: &[u8]) -> Result<Self, ReplayError> {
        if bytes.is_empty()
            || bytes.len() > MAX_REQUEST_ID_BYTES
            || !bytes.iter().all(u8::is_ascii_graphic)
        {
            return Err(ReplayError::InvalidRequestId);
        }
        let mut result = Self {
            bytes: [0; MAX_REQUEST_ID_BYTES],
            length: bytes.len(),
        };
        result.bytes[..bytes.len()].copy_from_slice(bytes);
        Ok(result)
    }

    /// Returns the exact request identity bytes.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.length]
    }
}

/// Canonical fingerprint of one already-decoded, strongly typed request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestFingerprint(pub [u8; 32]);

/// Behavior when a request replay journal reaches its configured capacity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayFullPolicy {
    /// Reject a new identity without executing its operation.
    RejectNew,
    /// Replace the oldest first-result entry when the new result is committed.
    EvictOldest,
}

/// Replay-journal errors; every error preserves the complete journal state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayError {
    /// Request identity failed the bounded printable-ASCII contract.
    InvalidRequestId,
    /// An existing request identity was paired with a different fingerprint.
    RequestIdConflict,
    /// The journal is full and its policy rejects new identities.
    JournalFull,
    /// Another insertion or clear invalidated an outstanding record permit.
    StaleRecordPermit,
}

/// Result of looking up one request identity and fingerprint.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestLookup<R, const MAX_REQUEST_ID_BYTES: usize> {
    /// Return this first result without executing the operation again.
    Replay(R),
    /// Execute once, then persist its result with this opaque permit.
    Execute(RequestRecordPermit<MAX_REQUEST_ID_BYTES>),
}

/// Opaque permission to store the first result for a request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestRecordPermit<const MAX_REQUEST_ID_BYTES: usize> {
    request_id: OpaqueRequestId<MAX_REQUEST_ID_BYTES>,
    fingerprint: RequestFingerprint,
    slot: usize,
    generation: u64,
    replacing: bool,
}

impl<const MAX_REQUEST_ID_BYTES: usize> RequestRecordPermit<MAX_REQUEST_ID_BYTES> {
    /// Returns the request identity covered by this permit.
    #[must_use]
    pub const fn request_id(self) -> OpaqueRequestId<MAX_REQUEST_ID_BYTES> {
        self.request_id
    }

    /// Returns the canonical request fingerprint covered by this permit.
    #[must_use]
    pub const fn fingerprint(self) -> RequestFingerprint {
        self.fingerprint
    }

    /// Reports whether commit replaces the oldest entry.
    #[must_use]
    pub const fn replaces_oldest(self) -> bool {
        self.replacing
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ReplayEntry<R, const MAX_REQUEST_ID_BYTES: usize> {
    request_id: OpaqueRequestId<MAX_REQUEST_ID_BYTES>,
    fingerprint: RequestFingerprint,
    first_result: R,
}

/// Fixed-capacity, allocation-free first-result replay journal.
///
/// The journal uses insertion-order FIFO when configured with
/// [`ReplayFullPolicy::EvictOldest`]. Lookups never refresh entry age. The
/// caller chooses both capacities and publishes them through board capability
/// evidence; this crate supplies no physical values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestReplayJournal<
    R: Copy,
    const ENTRY_CAPACITY: usize,
    const MAX_REQUEST_ID_BYTES: usize,
> {
    entries: [Option<ReplayEntry<R, MAX_REQUEST_ID_BYTES>>; ENTRY_CAPACITY],
    length: usize,
    next_slot: usize,
    generation: u64,
    full_policy: ReplayFullPolicy,
}

impl<R: Copy, const ENTRY_CAPACITY: usize, const MAX_REQUEST_ID_BYTES: usize>
    RequestReplayJournal<R, ENTRY_CAPACITY, MAX_REQUEST_ID_BYTES>
{
    /// Creates an empty journal with an explicit full-capacity policy.
    #[must_use]
    pub const fn new(full_policy: ReplayFullPolicy) -> Self {
        Self {
            entries: [None; ENTRY_CAPACITY],
            length: 0,
            next_slot: 0,
            generation: 0,
            full_policy,
        }
    }

    /// Returns the compile-time entry capacity.
    #[must_use]
    pub const fn capacity(&self) -> usize {
        ENTRY_CAPACITY
    }

    /// Returns the configured full-capacity behavior.
    #[must_use]
    pub const fn full_policy(&self) -> ReplayFullPolicy {
        self.full_policy
    }

    /// Returns the number of retained first results.
    #[must_use]
    pub const fn len(&self) -> usize {
        self.length
    }

    /// Reports whether the journal retains no first results.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.length == 0
    }

    /// Looks up an existing first result or reserves a non-mutating execute plan.
    ///
    /// # Errors
    ///
    /// Returns a conflict for an identity reused with a different fingerprint,
    /// or full when the selected policy rejects a new identity. Errors and
    /// successful execute plans preserve journal state.
    pub fn lookup(
        &self,
        request_id: OpaqueRequestId<MAX_REQUEST_ID_BYTES>,
        fingerprint: RequestFingerprint,
    ) -> Result<RequestLookup<R, MAX_REQUEST_ID_BYTES>, ReplayError> {
        if let Some(entry) = self.entries[..self.length]
            .iter()
            .flatten()
            .find(|entry| entry.request_id == request_id)
        {
            return if entry.fingerprint == fingerprint {
                Ok(RequestLookup::Replay(entry.first_result))
            } else {
                Err(ReplayError::RequestIdConflict)
            };
        }

        if ENTRY_CAPACITY == 0 {
            return Err(ReplayError::JournalFull);
        }
        let replacing = self.length == ENTRY_CAPACITY;
        if replacing && self.full_policy == ReplayFullPolicy::RejectNew {
            return Err(ReplayError::JournalFull);
        }
        Ok(RequestLookup::Execute(RequestRecordPermit {
            request_id,
            fingerprint,
            slot: self.next_slot,
            generation: self.generation,
            replacing,
        }))
    }

    /// Commits the first result after the operation completed exactly once.
    ///
    /// # Errors
    ///
    /// Returns [`ReplayError::StaleRecordPermit`] when any earlier insertion or
    /// clear invalidated the plan. An error preserves journal state.
    pub fn commit(
        &mut self,
        permit: RequestRecordPermit<MAX_REQUEST_ID_BYTES>,
        first_result: R,
    ) -> Result<(), ReplayError> {
        if ENTRY_CAPACITY == 0
            || permit.generation != self.generation
            || permit.slot != self.next_slot
            || permit.replacing != (self.length == ENTRY_CAPACITY)
        {
            return Err(ReplayError::StaleRecordPermit);
        }
        self.entries[permit.slot] = Some(ReplayEntry {
            request_id: permit.request_id,
            fingerprint: permit.fingerprint,
            first_result,
        });
        if self.length < ENTRY_CAPACITY {
            self.length += 1;
        }
        self.next_slot += 1;
        if self.next_slot == ENTRY_CAPACITY {
            self.next_slot = 0;
        }
        self.generation = self.generation.wrapping_add(1);
        Ok(())
    }

    /// Clears the boot-session replay scope and invalidates outstanding permits.
    pub fn clear(&mut self) {
        self.entries.fill(None);
        self.length = 0;
        self.next_slot = 0;
        self.generation = self.generation.wrapping_add(1);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FixedPath<const MAX_PATH_BYTES: usize> {
    bytes: [u8; MAX_PATH_BYTES],
    length: usize,
}

impl<const MAX_PATH_BYTES: usize> FixedPath<MAX_PATH_BYTES> {
    const EMPTY: Self = Self {
        bytes: [0; MAX_PATH_BYTES],
        length: 0,
    };

    fn from_bytes(path: &[u8]) -> Result<Self, CoreError> {
        if !path_is_safe(path) || path.len() > MAX_PATH_BYTES {
            return Err(CoreError::InvalidPath);
        }
        let mut result = Self::EMPTY;
        result.bytes[..path.len()].copy_from_slice(path);
        result.length = path.len();
        Ok(result)
    }

    fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.length]
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FileState<const MAX_PATH_BYTES: usize> {
    path: FixedPath<MAX_PATH_BYTES>,
    byte_length: u64,
    sha256: Sha256Digest,
    durable_offset: u64,
}

impl<const MAX_PATH_BYTES: usize> FileState<MAX_PATH_BYTES> {
    const EMPTY: Self = Self {
        path: FixedPath::EMPTY,
        byte_length: 0,
        sha256: Sha256Digest([0; 32]),
        durable_offset: 0,
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TransactionState<const MAX_FILES: usize, const MAX_PATH_BYTES: usize> {
    transaction: TransactionId,
    snapshot: SnapshotId,
    expected_active: Option<SnapshotId>,
    total_bytes: u64,
    durable_bytes: u64,
    file_count: usize,
    files: [FileState<MAX_PATH_BYTES>; MAX_FILES],
}

impl<const MAX_FILES: usize, const MAX_PATH_BYTES: usize>
    TransactionState<MAX_FILES, MAX_PATH_BYTES>
{
    fn matches(&self, other: &Self) -> bool {
        self.transaction == other.transaction
            && self.snapshot == other.snapshot
            && self.expected_active == other.expected_active
            && self.total_bytes == other.total_bytes
            && self.file_count == other.file_count
            && self.files[..self.file_count]
                .iter()
                .zip(&other.files[..other.file_count])
                .all(|(left, right)| {
                    left.path == right.path
                        && left.byte_length == right.byte_length
                        && left.sha256 == right.sha256
                })
    }

    fn next_file_index(&self) -> Option<usize> {
        self.files[..self.file_count]
            .iter()
            .position(|file| file.durable_offset < file.byte_length)
    }

    fn file_index(&self, path: &[u8]) -> Option<usize> {
        self.files[..self.file_count]
            .iter()
            .position(|file| file.path.as_bytes() == path)
    }
}

/// Stateful, allocation-free `DeviceLink` transaction core.
///
/// Capacities are compile-time parameters selected only after the caller has
/// evidence for its target. This crate assigns no board-level values.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeviceLinkCore<
    const MAX_FILES: usize,
    const MAX_PATH_BYTES: usize,
    const MAX_CHUNK_BYTES: usize,
> {
    install: InstallMachine,
    transaction: Option<TransactionState<MAX_FILES, MAX_PATH_BYTES>>,
}

impl<const MAX_FILES: usize, const MAX_PATH_BYTES: usize, const MAX_CHUNK_BYTES: usize>
    DeviceLinkCore<MAX_FILES, MAX_PATH_BYTES, MAX_CHUNK_BYTES>
{
    /// Wraps an existing snapshot lifecycle state.
    #[must_use]
    pub const fn new(install: InstallMachine) -> Self {
        Self {
            install,
            transaction: None,
        }
    }

    /// Returns the underlying snapshot lifecycle state by value.
    #[must_use]
    pub const fn install_machine(&self) -> InstallMachine {
        self.install
    }

    /// Returns the orthogonal device/install/boot status.
    #[must_use]
    pub const fn device_status(&self) -> DeviceStatus {
        self.install.status()
    }

    /// Returns reconnect progress for the active transaction.
    #[must_use]
    pub fn transaction_status(&self) -> Option<TransactionStatus<'_>> {
        let transaction = self.transaction.as_ref()?;
        let next_file_index = transaction.next_file_index();
        let (next_file_path, next_durable_offset) = next_file_index.map_or((None, 0), |index| {
            (
                Some(transaction.files[index].path.as_bytes()),
                transaction.files[index].durable_offset,
            )
        });
        Some(TransactionStatus {
            transaction: transaction.transaction,
            snapshot: transaction.snapshot,
            install_phase: self.install.status().install_phase,
            next_file_index,
            next_file_path,
            next_durable_offset,
            total_durable_bytes: transaction.durable_bytes,
            total_bytes: transaction.total_bytes,
            file_count: transaction.file_count,
        })
    }

    /// Begins or resumes one immutable manifest-derived transaction.
    ///
    /// # Errors
    ///
    /// Returns a capacity, descriptor, compare-and-swap, conflict, or lifecycle
    /// error. Every error preserves the complete prior state.
    pub fn begin_stage(
        &mut self,
        transaction: TransactionId,
        snapshot: SnapshotId,
        expected_active: Option<SnapshotId>,
        declared_total_bytes: u64,
        files: &[FileSpec<'_>],
    ) -> Result<BeginOutcome, CoreError> {
        if let Some(active) = self.transaction {
            if active.transaction != transaction {
                return Err(CoreError::Busy);
            }
            let candidate = build_transaction::<MAX_FILES, MAX_PATH_BYTES>(
                transaction,
                snapshot,
                expected_active,
                declared_total_bytes,
                files,
            )?;
            return if active.matches(&candidate) {
                Ok(BeginOutcome::Resumed)
            } else {
                Err(CoreError::TransactionIdConflict)
            };
        }

        let candidate = build_transaction::<MAX_FILES, MAX_PATH_BYTES>(
            transaction,
            snapshot,
            expected_active,
            declared_total_bytes,
            files,
        )?;
        self.install
            .begin_stage(transaction, snapshot, expected_active)
            .map_err(map_snapshot_error)?;
        self.transaction = Some(candidate);
        Ok(BeginOutcome::Started)
    }

    /// Validates bytes and returns a durable-write or durable-replay plan.
    ///
    /// The method never changes state. A [`ChunkPlan::Write`] permit advances an
    /// offset only after the caller has written and synchronized the bytes and
    /// calls [`Self::commit_chunk`].
    ///
    /// # Errors
    ///
    /// Returns a transaction, ordering, range, capacity, or digest error.
    pub fn prepare_chunk<H: Sha256Provider>(
        &self,
        transaction: TransactionId,
        path: &[u8],
        offset: u64,
        bytes: &[u8],
        declared_sha256: Sha256Digest,
        hasher: &H,
    ) -> Result<ChunkPlan, CoreError> {
        let active = self.require_staging(transaction)?;
        if bytes.is_empty() {
            return Err(CoreError::EmptyChunk);
        }
        if bytes.len() > MAX_CHUNK_BYTES {
            return Err(CoreError::ChunkCapacityExceeded);
        }
        if hasher.digest(bytes) != declared_sha256 {
            return Err(CoreError::ChunkHashMismatch);
        }
        let file_index = active.file_index(path).ok_or(CoreError::FileNotFound)?;
        let file = active.files[file_index];
        let byte_length = u64::try_from(bytes.len()).map_err(|_| CoreError::ChunkOutOfRange)?;
        let end = offset
            .checked_add(byte_length)
            .ok_or(CoreError::ChunkOutOfRange)?;
        if end > file.byte_length {
            return Err(CoreError::ChunkOutOfRange);
        }

        if let Some(expected_index) = active.next_file_index()
            && file_index > expected_index
        {
            return Err(CoreError::FileOrderMismatch {
                expected_index,
                received_index: file_index,
            });
        }

        if offset > file.durable_offset || end > file.durable_offset && offset < file.durable_offset
        {
            return Err(CoreError::OffsetMismatch {
                expected: file.durable_offset,
                received: offset,
            });
        }
        if offset == file.durable_offset {
            return Ok(ChunkPlan::Write(WritePermit {
                transaction,
                file_index,
                offset,
                byte_length,
                digest: declared_sha256,
            }));
        }
        Ok(ChunkPlan::Replay(ReplayPermit {
            transaction,
            file_index,
            offset,
            byte_length,
            digest: declared_sha256,
        }))
    }

    /// Advances a chunk after the caller has made its bytes durable.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::StalePermit`] when state changed after preparation.
    /// Every error preserves the prior state.
    pub fn commit_chunk(&mut self, permit: WritePermit) -> Result<ChunkAck, CoreError> {
        let Some(active) = self.transaction.as_mut() else {
            return Err(CoreError::StalePermit);
        };
        if self.install.status().install_phase != InstallPhase::Staging
            || active.transaction != permit.transaction
            || permit.file_index >= active.file_count
        {
            return Err(CoreError::StalePermit);
        }
        let file = active.files[permit.file_index];
        let end = permit
            .offset
            .checked_add(permit.byte_length)
            .ok_or(CoreError::StalePermit)?;
        if active.next_file_index() != Some(permit.file_index)
            || file.durable_offset != permit.offset
            || end > file.byte_length
        {
            return Err(CoreError::StalePermit);
        }
        let new_total = active
            .durable_bytes
            .checked_add(permit.byte_length)
            .ok_or(CoreError::StalePermit)?;
        if new_total > active.total_bytes {
            return Err(CoreError::StalePermit);
        }
        active.files[permit.file_index].durable_offset = end;
        active.durable_bytes = new_total;
        Ok(ChunkAck {
            file_index: permit.file_index,
            next_durable_offset: end,
            total_durable_bytes: new_total,
            replayed: false,
        })
    }

    /// Confirms that a replay range still has the declared durable digest.
    ///
    /// The method never changes state.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::ChunkConflict`] for different durable bytes or
    /// [`CoreError::StalePermit`] when state no longer covers the range.
    pub fn confirm_replay(
        &self,
        permit: ReplayPermit,
        durable_sha256: Sha256Digest,
    ) -> Result<ChunkAck, CoreError> {
        let active = self.transaction.as_ref().ok_or(CoreError::StalePermit)?;
        if self.install.status().install_phase != InstallPhase::Staging
            || active.transaction != permit.transaction
            || permit.file_index >= active.file_count
        {
            return Err(CoreError::StalePermit);
        }
        let file = active.files[permit.file_index];
        let end = permit
            .offset
            .checked_add(permit.byte_length)
            .ok_or(CoreError::StalePermit)?;
        if end > file.durable_offset {
            return Err(CoreError::StalePermit);
        }
        if durable_sha256 != permit.digest {
            return Err(CoreError::ChunkConflict);
        }
        Ok(ChunkAck {
            file_index: permit.file_index,
            next_durable_offset: file.durable_offset,
            total_durable_bytes: active.durable_bytes,
            replayed: true,
        })
    }

    /// Verifies completeness and caller-computed whole-file SHA-256 values.
    ///
    /// The digest slice follows manifest order. Verification transitions
    /// `Staging` directly through `Verifying` to `ReadyToActivate` only after
    /// every precondition passes.
    ///
    /// # Errors
    ///
    /// Returns a transaction, completeness, or file-digest error. Every error
    /// preserves the complete prior state.
    pub fn verify(
        &mut self,
        transaction: TransactionId,
        durable_file_sha256: &[Sha256Digest],
    ) -> Result<VerifyOutcome, CoreError> {
        let active = self.require_staging(transaction)?;
        for (index, file) in active.files[..active.file_count].iter().enumerate() {
            if file.durable_offset != file.byte_length {
                return Err(CoreError::StagingIncomplete {
                    file_index: index,
                    durable_bytes: file.durable_offset,
                    expected_bytes: file.byte_length,
                });
            }
        }
        if durable_file_sha256.len() != active.file_count {
            return Err(CoreError::FileDigestCountMismatch {
                expected: active.file_count,
                received: durable_file_sha256.len(),
            });
        }
        for (index, digest) in durable_file_sha256.iter().enumerate() {
            if *digest != active.files[index].sha256 {
                return Err(CoreError::FileHashMismatch { file_index: index });
            }
        }
        let outcome = VerifyOutcome {
            snapshot: active.snapshot,
            total_bytes: active.total_bytes,
            file_count: active.file_count,
        };
        let before = self.install;
        if let Err(error) = self
            .install
            .finish_stage(transaction)
            .and_then(|()| self.install.verify_ok(transaction))
        {
            self.install = before;
            return Err(map_snapshot_error(error));
        }
        Ok(outcome)
    }

    /// Atomically applies verified snapshot activation with a second CAS check.
    ///
    /// A board adapter must make its active-head record durable before invoking
    /// this semantic commit.
    ///
    /// # Errors
    ///
    /// Returns a transaction, phase, or compare-and-swap error. Every error
    /// preserves the complete prior state.
    pub fn activate(
        &mut self,
        transaction: TransactionId,
        expected_active: Option<SnapshotId>,
    ) -> Result<SelectionOutcome, CoreError> {
        let active_transaction = self.require_transaction(transaction)?;
        if self.install.status().install_phase != InstallPhase::ReadyToActivate {
            return Err(CoreError::InvalidState);
        }
        if active_transaction.expected_active != expected_active {
            return Err(CoreError::ExpectedActiveMismatch);
        }
        let selected_snapshot = active_transaction.snapshot;
        let before = self.install;
        if let Err(error) = self
            .install
            .begin_activate_cas(transaction, expected_active)
            .and_then(|()| self.install.commit_activate(transaction))
        {
            self.install = before;
            return Err(map_snapshot_error(error));
        }
        debug_assert_eq!(self.install.active(), Some(selected_snapshot));
        let outcome = SelectionOutcome {
            active: selected_snapshot,
            last_good: self.install.last_good(),
        };
        self.transaction = None;
        Ok(outcome)
    }

    /// Aborts a transaction before activation begins.
    ///
    /// A board adapter persists its abort tombstone before invoking this
    /// semantic commit; stale staging bytes can then be reclaimed lazily.
    ///
    /// # Errors
    ///
    /// Returns a transaction or phase error. Every error preserves state.
    pub fn abort(&mut self, transaction: TransactionId) -> Result<(), CoreError> {
        self.require_transaction(transaction)?;
        if !matches!(
            self.install.status().install_phase,
            InstallPhase::Staging | InstallPhase::Verifying | InstallPhase::ReadyToActivate
        ) {
            return Err(CoreError::InvalidState);
        }
        let before = self.install;
        if let Err(error) = self.install.abort(transaction) {
            self.install = before;
            return Err(map_snapshot_error(error));
        }
        self.transaction = None;
        Ok(())
    }

    /// Atomically selects last-good content after active-ID CAS.
    ///
    /// A board adapter makes the rollback head record durable before invoking
    /// this semantic commit.
    ///
    /// # Errors
    ///
    /// Returns a lifecycle or CAS error. Every error preserves state.
    pub fn rollback(&mut self, expected_active: SnapshotId) -> Result<SelectionOutcome, CoreError> {
        if self.transaction.is_some() {
            return Err(CoreError::Busy);
        }
        let selected_snapshot = self.install.last_good().ok_or(CoreError::InvalidState)?;
        let before = self.install;
        if let Err(error) = self.install.rollback(expected_active) {
            self.install = before;
            return Err(map_snapshot_error(error));
        }
        debug_assert_eq!(self.install.active(), Some(selected_snapshot));
        Ok(SelectionOutcome {
            active: selected_snapshot,
            last_good: self.install.last_good(),
        })
    }

    fn require_transaction(
        &self,
        transaction: TransactionId,
    ) -> Result<&TransactionState<MAX_FILES, MAX_PATH_BYTES>, CoreError> {
        let active = self
            .transaction
            .as_ref()
            .ok_or(CoreError::TransactionNotFound)?;
        if active.transaction != transaction {
            return Err(CoreError::TransactionNotFound);
        }
        Ok(active)
    }

    fn require_staging(
        &self,
        transaction: TransactionId,
    ) -> Result<&TransactionState<MAX_FILES, MAX_PATH_BYTES>, CoreError> {
        let active = self.require_transaction(transaction)?;
        if self.install.status().install_phase != InstallPhase::Staging {
            return Err(CoreError::InvalidState);
        }
        Ok(active)
    }
}

fn build_transaction<const MAX_FILES: usize, const MAX_PATH_BYTES: usize>(
    transaction: TransactionId,
    snapshot: SnapshotId,
    expected_active: Option<SnapshotId>,
    declared_total_bytes: u64,
    files: &[FileSpec<'_>],
) -> Result<TransactionState<MAX_FILES, MAX_PATH_BYTES>, CoreError> {
    if files.is_empty() || files.len() > MAX_FILES {
        return Err(CoreError::FileCapacityExceeded);
    }
    let mut state = TransactionState {
        transaction,
        snapshot,
        expected_active,
        total_bytes: declared_total_bytes,
        durable_bytes: 0,
        file_count: files.len(),
        files: [FileState::EMPTY; MAX_FILES],
    };
    let mut calculated_total = 0_u64;
    for (index, spec) in files.iter().enumerate() {
        let path = FixedPath::from_bytes(spec.path)?;
        if state.files[..index].iter().any(|file| file.path == path) {
            return Err(CoreError::DuplicatePath);
        }
        calculated_total = calculated_total
            .checked_add(spec.byte_length)
            .ok_or(CoreError::TotalBytesMismatch)?;
        state.files[index] = FileState {
            path,
            byte_length: spec.byte_length,
            sha256: spec.sha256,
            durable_offset: 0,
        };
    }
    if calculated_total != declared_total_bytes {
        return Err(CoreError::TotalBytesMismatch);
    }
    Ok(state)
}

fn path_is_safe(path: &[u8]) -> bool {
    if path.is_empty() || path[0] == b'/' || path[path.len() - 1] == b'/' {
        return false;
    }
    let mut segment_start = 0;
    for (index, byte) in path.iter().copied().enumerate() {
        let allowed = byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/');
        if !allowed {
            return false;
        }
        if byte == b'/' {
            if invalid_segment(&path[segment_start..index]) {
                return false;
            }
            segment_start = index + 1;
        }
    }
    !invalid_segment(&path[segment_start..])
}

fn invalid_segment(segment: &[u8]) -> bool {
    segment.is_empty() || segment == b"." || segment == b".."
}

fn map_snapshot_error(error: ErrorCode) -> CoreError {
    match error {
        ErrorCode::Busy => CoreError::Busy,
        ErrorCode::InvalidState => CoreError::InvalidState,
        ErrorCode::TransactionNotFound => CoreError::TransactionNotFound,
        ErrorCode::ExpectedActiveMismatch => CoreError::ExpectedActiveMismatch,
        other => CoreError::Snapshot(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yimi_fw_contract::{BootSelection, LastInstallOutcome};

    const V1: SnapshotId = SnapshotId::test(1);
    const V2: SnapshotId = SnapshotId::test(2);
    const V3: SnapshotId = SnapshotId::test(3);
    const TX1: TransactionId = TransactionId(1);
    const TX2: TransactionId = TransactionId(2);

    type Core = DeviceLinkCore<4, 32, 8>;

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum ResultSummary {
        Ok(u64),
        Error(u8),
    }

    type RejectJournal = RequestReplayJournal<ResultSummary, 2, 16>;
    type EvictJournal = RequestReplayJournal<ResultSummary, 2, 16>;

    struct TestHasher;

    impl Sha256Provider for TestHasher {
        fn digest(&self, bytes: &[u8]) -> Sha256Digest {
            let mut digest = [0_u8; 32];
            for (index, byte) in bytes.iter().copied().enumerate() {
                let slot = index % digest.len();
                digest[slot] = digest[slot]
                    .wrapping_add(byte)
                    .wrapping_add(u8::try_from(index % 251).unwrap());
            }
            digest[31] = u8::try_from(bytes.len() % 251).unwrap();
            Sha256Digest(digest)
        }
    }

    fn digest(bytes: &[u8]) -> Sha256Digest {
        TestHasher.digest(bytes)
    }

    fn request_id(bytes: &[u8]) -> OpaqueRequestId<16> {
        OpaqueRequestId::new(bytes).unwrap()
    }

    const fn fingerprint(value: u8) -> RequestFingerprint {
        RequestFingerprint([value; 32])
    }

    fn execute_permit(lookup: RequestLookup<ResultSummary, 16>) -> RequestRecordPermit<16> {
        let RequestLookup::Execute(permit) = lookup else {
            panic!("expected execute permit");
        };
        permit
    }

    fn specs() -> [FileSpec<'static>; 2] {
        [
            FileSpec {
                path: b"a.bin",
                byte_length: 6,
                sha256: digest(b"abcdef"),
            },
            FileSpec {
                path: b"dir/b.bin",
                byte_length: 3,
                sha256: digest(b"xyz"),
            },
        ]
    }

    fn started() -> Core {
        let mut core = Core::new(InstallMachine::provisioned(V1));
        assert_eq!(
            core.begin_stage(TX1, V2, Some(V1), 9, &specs()),
            Ok(BeginOutcome::Started)
        );
        core
    }

    fn prepare_write(core: &Core, path: &[u8], offset: u64, bytes: &[u8]) -> WritePermit {
        match core
            .prepare_chunk(TX1, path, offset, bytes, digest(bytes), &TestHasher)
            .unwrap()
        {
            ChunkPlan::Write(permit) => permit,
            ChunkPlan::Replay(_) => panic!("expected a write permit"),
        }
    }

    fn write(core: &mut Core, path: &[u8], offset: u64, bytes: &[u8]) -> ChunkAck {
        let permit = prepare_write(core, path, offset, bytes);
        core.commit_chunk(permit).unwrap()
    }

    fn complete(core: &mut Core) {
        write(core, b"a.bin", 0, b"abc");
        write(core, b"a.bin", 3, b"def");
        write(core, b"dir/b.bin", 0, b"xyz");
    }

    fn verify(core: &mut Core) {
        core.verify(TX1, &[digest(b"abcdef"), digest(b"xyz")])
            .unwrap();
    }

    fn assert_failure_preserves<T: core::fmt::Debug + PartialEq>(
        core: &mut Core,
        expected: CoreError,
        operation: impl FnOnce(&mut Core) -> Result<T, CoreError>,
    ) {
        let before = *core;
        assert_eq!(operation(core), Err(expected));
        assert_eq!(*core, before);
    }

    #[test]
    fn request_journal_replays_the_first_result() {
        let mut journal = RejectJournal::new(ReplayFullPolicy::RejectNew);
        let id = request_id(b"REQ-1");
        let before = journal;
        let permit = execute_permit(journal.lookup(id, fingerprint(1)).unwrap());
        assert_eq!(journal, before);
        journal.commit(permit, ResultSummary::Ok(7)).unwrap();
        let committed = journal;
        assert_eq!(
            journal.lookup(id, fingerprint(1)),
            Ok(RequestLookup::Replay(ResultSummary::Ok(7)))
        );
        assert_eq!(journal, committed);
    }

    #[test]
    fn request_id_conflict_preserves_journal() {
        let mut journal = RejectJournal::new(ReplayFullPolicy::RejectNew);
        let id = request_id(b"REQ-1");
        let permit = execute_permit(journal.lookup(id, fingerprint(1)).unwrap());
        journal.commit(permit, ResultSummary::Error(4)).unwrap();
        let before = journal;
        assert_eq!(
            journal.lookup(id, fingerprint(2)),
            Err(ReplayError::RequestIdConflict)
        );
        assert_eq!(journal, before);
    }

    #[test]
    fn full_reject_policy_has_zero_side_effects() {
        let mut journal = RejectJournal::new(ReplayFullPolicy::RejectNew);
        for (id, hash, result) in [
            (b"REQ-1".as_slice(), 1, ResultSummary::Ok(1)),
            (b"REQ-2".as_slice(), 2, ResultSummary::Ok(2)),
        ] {
            let permit = execute_permit(journal.lookup(request_id(id), fingerprint(hash)).unwrap());
            journal.commit(permit, result).unwrap();
        }
        let before = journal;
        assert_eq!(
            journal.lookup(request_id(b"REQ-3"), fingerprint(3)),
            Err(ReplayError::JournalFull)
        );
        assert_eq!(journal, before);
        assert_eq!(journal.len(), journal.capacity());
    }

    #[test]
    fn full_evict_policy_replaces_oldest_only_on_commit() {
        let mut journal = EvictJournal::new(ReplayFullPolicy::EvictOldest);
        for (id, hash, result) in [
            (b"REQ-1".as_slice(), 1, ResultSummary::Ok(1)),
            (b"REQ-2".as_slice(), 2, ResultSummary::Ok(2)),
        ] {
            let permit = execute_permit(journal.lookup(request_id(id), fingerprint(hash)).unwrap());
            journal.commit(permit, result).unwrap();
        }
        let before = journal;
        let permit = execute_permit(
            journal
                .lookup(request_id(b"REQ-3"), fingerprint(3))
                .unwrap(),
        );
        assert!(permit.replaces_oldest());
        assert_eq!(journal, before);
        journal.commit(permit, ResultSummary::Ok(3)).unwrap();
        assert_eq!(
            journal.lookup(request_id(b"REQ-2"), fingerprint(2)),
            Ok(RequestLookup::Replay(ResultSummary::Ok(2)))
        );
        assert_eq!(
            journal.lookup(request_id(b"REQ-3"), fingerprint(3)),
            Ok(RequestLookup::Replay(ResultSummary::Ok(3)))
        );
        assert!(matches!(
            journal.lookup(request_id(b"REQ-1"), fingerprint(1)),
            Ok(RequestLookup::Execute(_))
        ));
    }

    #[test]
    fn stale_record_permit_and_clear_preserve_first_results() {
        let mut journal = RejectJournal::new(ReplayFullPolicy::RejectNew);
        let stale = execute_permit(
            journal
                .lookup(request_id(b"REQ-1"), fingerprint(1))
                .unwrap(),
        );
        let current = execute_permit(
            journal
                .lookup(request_id(b"REQ-2"), fingerprint(2))
                .unwrap(),
        );
        journal.commit(current, ResultSummary::Ok(2)).unwrap();
        let before = journal;
        assert_eq!(
            journal.commit(stale, ResultSummary::Ok(1)),
            Err(ReplayError::StaleRecordPermit)
        );
        assert_eq!(journal, before);

        let permit = execute_permit(
            journal
                .lookup(request_id(b"REQ-3"), fingerprint(3))
                .unwrap(),
        );
        journal.clear();
        let cleared = journal;
        assert_eq!(
            journal.commit(permit, ResultSummary::Ok(3)),
            Err(ReplayError::StaleRecordPermit)
        );
        assert_eq!(journal, cleared);
        assert!(journal.is_empty());
    }

    #[test]
    fn request_id_and_zero_capacity_boundaries_are_explicit() {
        assert_eq!(
            OpaqueRequestId::<4>::new(b""),
            Err(ReplayError::InvalidRequestId)
        );
        assert_eq!(
            OpaqueRequestId::<4>::new(b"ABCDE"),
            Err(ReplayError::InvalidRequestId)
        );
        assert_eq!(
            OpaqueRequestId::<4>::new(b"A\n"),
            Err(ReplayError::InvalidRequestId)
        );
        let journal =
            RequestReplayJournal::<ResultSummary, 0, 4>::new(ReplayFullPolicy::EvictOldest);
        assert_eq!(
            journal.lookup(OpaqueRequestId::new(b"A").unwrap(), fingerprint(1)),
            Err(ReplayError::JournalFull)
        );
        assert!(journal.is_empty());
    }

    #[test]
    fn ordered_chunks_verify_and_activate() {
        let mut core = started();
        let first = write(&mut core, b"a.bin", 0, b"abc");
        assert_eq!(first.next_durable_offset, 3);
        assert_eq!(first.total_durable_bytes, 3);
        write(&mut core, b"a.bin", 3, b"def");
        write(&mut core, b"dir/b.bin", 0, b"xyz");
        let status = core.transaction_status().unwrap();
        assert_eq!(status.next_file_index, None);
        assert_eq!(status.total_durable_bytes, 9);
        assert_eq!(
            core.verify(TX1, &[digest(b"abcdef"), digest(b"xyz")]),
            Ok(VerifyOutcome {
                snapshot: V2,
                total_bytes: 9,
                file_count: 2,
            })
        );
        assert_eq!(
            core.activate(TX1, Some(V1)),
            Ok(SelectionOutcome {
                active: V2,
                last_good: Some(V1),
            })
        );
        assert_eq!(core.transaction_status(), None);
    }

    #[test]
    fn same_chunk_replay_requires_matching_durable_digest() {
        let mut core = started();
        write(&mut core, b"a.bin", 0, b"abc");
        let plan = core
            .prepare_chunk(TX1, b"a.bin", 0, b"abc", digest(b"abc"), &TestHasher)
            .unwrap();
        let ChunkPlan::Replay(permit) = plan else {
            panic!("expected replay plan");
        };
        let before = core;
        assert_eq!(
            core.confirm_replay(permit, digest(b"abc")),
            Ok(ChunkAck {
                file_index: 0,
                next_durable_offset: 3,
                total_durable_bytes: 3,
                replayed: true,
            })
        );
        assert_eq!(core, before);
        assert_eq!(
            core.confirm_replay(permit, digest(b"abd")),
            Err(CoreError::ChunkConflict)
        );
        assert_eq!(core, before);
    }

    #[test]
    fn gap_overlap_and_out_of_range_preserve_state() {
        let mut core = started();
        write(&mut core, b"a.bin", 0, b"abc");
        assert_failure_preserves(
            &mut core,
            CoreError::OffsetMismatch {
                expected: 3,
                received: 4,
            },
            |core| core.prepare_chunk(TX1, b"a.bin", 4, b"d", digest(b"d"), &TestHasher),
        );
        assert_failure_preserves(
            &mut core,
            CoreError::OffsetMismatch {
                expected: 3,
                received: 2,
            },
            |core| core.prepare_chunk(TX1, b"a.bin", 2, b"cd", digest(b"cd"), &TestHasher),
        );
        assert_failure_preserves(&mut core, CoreError::ChunkOutOfRange, |core| {
            core.prepare_chunk(TX1, b"a.bin", 3, b"defg", digest(b"defg"), &TestHasher)
        });
    }

    #[test]
    fn future_file_is_rejected_until_current_file_completes() {
        let mut core = started();
        assert_failure_preserves(
            &mut core,
            CoreError::FileOrderMismatch {
                expected_index: 0,
                received_index: 1,
            },
            |core| core.prepare_chunk(TX1, b"dir/b.bin", 0, b"xyz", digest(b"xyz"), &TestHasher),
        );
    }

    #[test]
    fn identical_begin_resumes_without_mutation() {
        let mut core = started();
        write(&mut core, b"a.bin", 0, b"abc");
        let before = core;
        assert_eq!(
            core.begin_stage(TX1, V2, Some(V1), 9, &specs()),
            Ok(BeginOutcome::Resumed)
        );
        assert_eq!(core, before);
    }

    #[test]
    fn conflicting_same_transaction_begin_preserves_state() {
        let mut core = started();
        let before = core;
        assert_eq!(
            core.begin_stage(TX1, V3, Some(V1), 9, &specs()),
            Err(CoreError::TransactionIdConflict)
        );
        assert_eq!(core, before);
    }

    #[test]
    fn different_transaction_begin_is_busy_and_preserves_state() {
        let mut core = started();
        let before = core;
        assert_eq!(
            core.begin_stage(TX2, V3, Some(V1), 0, &[]),
            Err(CoreError::Busy)
        );
        assert_eq!(core, before);
    }

    #[test]
    fn incomplete_and_bad_file_verification_preserve_state() {
        let mut core = started();
        write(&mut core, b"a.bin", 0, b"abc");
        assert_failure_preserves(
            &mut core,
            CoreError::StagingIncomplete {
                file_index: 0,
                durable_bytes: 3,
                expected_bytes: 6,
            },
            |core| core.verify(TX1, &[digest(b"abcdef"), digest(b"xyz")]),
        );
        complete_from_three(&mut core);
        assert_failure_preserves(
            &mut core,
            CoreError::FileHashMismatch { file_index: 1 },
            |core| core.verify(TX1, &[digest(b"abcdef"), digest(b"bad")]),
        );
    }

    fn complete_from_three(core: &mut Core) {
        write(core, b"a.bin", 3, b"def");
        write(core, b"dir/b.bin", 0, b"xyz");
    }

    #[test]
    fn stale_activate_cas_preserves_ready_transaction() {
        let mut core = started();
        complete(&mut core);
        verify(&mut core);
        assert_failure_preserves(&mut core, CoreError::ExpectedActiveMismatch, |core| {
            core.activate(TX1, Some(V3))
        });
        assert_eq!(
            core.device_status().install_phase,
            InstallPhase::ReadyToActivate
        );
    }

    #[test]
    fn abort_preserves_active_and_last_good() {
        let mut core = started();
        write(&mut core, b"a.bin", 0, b"abc");
        core.abort(TX1).unwrap();
        assert_eq!(core.transaction_status(), None);
        assert_eq!(core.install_machine().active(), Some(V1));
        assert_eq!(core.install_machine().last_good(), Some(V1));
        assert_eq!(
            core.device_status().last_install_outcome,
            LastInstallOutcome::Aborted
        );
    }

    #[test]
    fn wrong_transaction_abort_preserves_state() {
        let mut core = started();
        assert_failure_preserves(&mut core, CoreError::TransactionNotFound, |core| {
            core.abort(TX2)
        });
    }

    #[test]
    fn verified_transaction_can_abort_and_blocks_rollback() {
        let mut core = started();
        assert_failure_preserves(&mut core, CoreError::Busy, |core| core.rollback(V1));
        complete(&mut core);
        verify(&mut core);
        core.abort(TX1).unwrap();
        assert_eq!(core.transaction_status(), None);
        assert_eq!(core.install_machine().active(), Some(V1));
        assert_eq!(core.install_machine().last_good(), Some(V1));
        assert_eq!(
            core.device_status().last_install_outcome,
            LastInstallOutcome::Aborted
        );
    }

    #[test]
    fn rollback_selects_last_good_after_activation() {
        let mut core = started();
        complete(&mut core);
        verify(&mut core);
        core.activate(TX1, Some(V1)).unwrap();
        assert_eq!(
            core.rollback(V2),
            Ok(SelectionOutcome {
                active: V1,
                last_good: Some(V1),
            })
        );
        assert_eq!(core.device_status().boot_selection, BootSelection::LastGood);
        assert_eq!(
            core.device_status().last_install_outcome,
            LastInstallOutcome::RolledBack
        );
    }

    #[test]
    fn rollback_cas_and_missing_distinct_last_good_preserve_state() {
        let mut core = Core::new(InstallMachine::provisioned(V1));
        assert_failure_preserves(&mut core, CoreError::ExpectedActiveMismatch, |core| {
            core.rollback(V2)
        });
        assert_failure_preserves(&mut core, CoreError::InvalidState, |core| core.rollback(V1));
    }

    #[test]
    fn descriptor_and_chunk_validation_failures_preserve_state() {
        let mut core = Core::new(InstallMachine::provisioned(V1));
        assert_failure_preserves(&mut core, CoreError::FileCapacityExceeded, |core| {
            core.begin_stage(TX1, V2, Some(V1), 0, &[])
        });
        assert_failure_preserves(&mut core, CoreError::ExpectedActiveMismatch, |core| {
            core.begin_stage(TX1, V2, Some(V3), 9, &specs())
        });
        assert_failure_preserves(&mut core, CoreError::DuplicatePath, |core| {
            let duplicate = [specs()[0], specs()[0]];
            core.begin_stage(TX1, V2, Some(V1), 12, &duplicate)
        });
        assert_failure_preserves(&mut core, CoreError::TotalBytesMismatch, |core| {
            core.begin_stage(TX1, V2, Some(V1), 8, &specs())
        });
        assert_failure_preserves(&mut core, CoreError::InvalidPath, |core| {
            let invalid = [FileSpec {
                path: b"a//b",
                byte_length: 1,
                sha256: digest(b"x"),
            }];
            core.begin_stage(TX1, V2, Some(V1), 1, &invalid)
        });

        let mut core = started();
        assert_failure_preserves(&mut core, CoreError::EmptyChunk, |core| {
            core.prepare_chunk(TX1, b"a.bin", 0, b"", digest(b""), &TestHasher)
        });
        assert_failure_preserves(&mut core, CoreError::FileNotFound, |core| {
            core.prepare_chunk(TX1, b"missing.bin", 0, b"x", digest(b"x"), &TestHasher)
        });
        assert_failure_preserves(&mut core, CoreError::ChunkHashMismatch, |core| {
            core.prepare_chunk(TX1, b"a.bin", 0, b"abc", digest(b"bad"), &TestHasher)
        });
        assert_failure_preserves(&mut core, CoreError::ChunkCapacityExceeded, |core| {
            core.prepare_chunk(
                TX1,
                b"a.bin",
                0,
                b"123456789",
                digest(b"123456789"),
                &TestHasher,
            )
        });
    }

    #[test]
    fn digest_count_and_post_verify_write_failures_preserve_state() {
        let mut core = started();
        complete(&mut core);
        assert_failure_preserves(
            &mut core,
            CoreError::FileDigestCountMismatch {
                expected: 2,
                received: 1,
            },
            |core| core.verify(TX1, &[digest(b"abcdef")]),
        );
        verify(&mut core);
        assert_failure_preserves(&mut core, CoreError::InvalidState, |core| {
            core.prepare_chunk(TX1, b"a.bin", 0, b"abc", digest(b"abc"), &TestHasher)
        });
    }

    #[test]
    fn stale_or_double_commit_preserves_state() {
        let mut core = started();
        let permit = prepare_write(&core, b"a.bin", 0, b"abc");
        core.commit_chunk(permit).unwrap();
        let before = core;
        assert_eq!(core.commit_chunk(permit), Err(CoreError::StalePermit));
        assert_eq!(core, before);
    }
}
