#![no_std]
#![deny(unsafe_code)]
//! Auditable safe wrapper for the `yimi_platform_v1` C ABI.

#[cfg(test)]
extern crate std;

use core::{
    marker::PhantomData,
    mem::{align_of, offset_of, size_of},
};
use yimi_fw_contract::{MonotonicUs, OidStatus, PhysicalCode, PhysicalCodeEvent};

#[allow(unsafe_code)]
mod raw;

/// Current C ABI version.
pub const ABI_VERSION: u32 = 1;
/// Maximum snapshot-relative path length in ABI v1.
pub const MAX_PATH_BYTES: usize = 240;
/// Sentinel emitted by a provider when a timestamp is unavailable.
pub const TIME_UNAVAILABLE_US: u64 = u64::MAX;

const STATUS_OK: i32 = 0;
const STATUS_EMPTY: i32 = 1;
const STATUS_INVALID_ARGUMENT: i32 = -1;
const STATUS_IO: i32 = -2;
const STATUS_UNSUPPORTED: i32 = -3;
const STATUS_BUSY: i32 = -4;
const STATUS_ABI_MISMATCH: i32 = -5;

const OID_HAS_CODE: u8 = 1 << 0;
const OID_HAS_SENSOR_AT: u8 = 1 << 1;
const OID_HAS_READY_AT: u8 = 1 << 2;
const OID_HAS_QUALITY: u8 = 1 << 3;

/// Platform capability bits returned by the ABI.
pub mod capability {
    /// OID events are available through the poll queue.
    pub const OID_POLL: u64 = 1 << 0;
    /// Audio start accepts a snapshot-relative path.
    pub const AUDIO_PATH: u64 = 1 << 1;
    /// Content storage supports exact random reads and writes.
    pub const STORAGE_RANDOM_IO: u64 = 1 << 2;
    /// `DeviceLink` exposes a byte-stream transport.
    pub const DEVICE_LINK_STREAM: u64 = 1 << 3;
    /// Platform exposes a monotonic microsecond clock.
    pub const MONOTONIC_US: u64 = 1 << 4;
}

/// C-compatible platform metadata.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PlatformInfoV1 {
    /// ABI version implemented by the provider.
    pub abi_version: u32,
    /// Provider-side size of this struct.
    pub info_size: u32,
    /// Provider-side size of [`OidEventV1`].
    pub oid_event_size: u32,
    /// Provider-side size of [`AudioEventV1`].
    pub audio_event_size: u32,
    /// Capability bit set.
    pub capability_bits: u64,
    /// Maximum snapshot-relative audio path bytes.
    pub max_path_bytes: u32,
    /// Preferred `DeviceLink` byte-stream MTU.
    pub transport_mtu: u32,
    /// Numeric [`AudioTimeClass`] used for audio-start events.
    pub audio_start_time_class: u32,
    /// Provider-side size of [`OidQueueStatsV1`].
    pub oid_queue_stats_size: u32,
    /// Required offset and length alignment for storage writes.
    pub storage_write_alignment: u32,
    /// Maximum bytes accepted by one storage read or write.
    pub storage_max_transfer: u32,
    /// Smallest write unit promised atomic across power loss.
    pub storage_atomic_write_bytes: u32,
    /// Provider-side size of [`AudioQueueStatsV1`].
    pub audio_queue_stats_size: u32,
}

/// Raw C-compatible OID event.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct OidEventV1 {
    /// Physical code when the corresponding flag is present.
    pub physical_code: u64,
    /// First event time visible to product logic.
    pub event_at_us: u64,
    /// Sensor time when available.
    pub sensor_at_us: u64,
    /// Ready time when available.
    pub ready_at_us: u64,
    /// Wrapping producer sequence including dropped observations.
    pub sequence: u32,
    /// Wrapping cumulative drop count before this event.
    pub dropped_events: u32,
    /// Raw quality when available.
    pub quality: u16,
    /// [`OidStatus`] numeric representation.
    pub status: u8,
    /// Presence flags for optional fields.
    pub flags: u8,
    /// Reserved and zeroed in ABI v1.
    pub reserved0: u32,
}

/// Raw C-compatible audio event.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AudioEventV1 {
    /// Request identity supplied at start/stop.
    pub request_id: u32,
    /// Numeric [`AudioEventKind`].
    pub kind: u8,
    /// Numeric [`AudioTimeClass`].
    pub timestamp_class: u8,
    /// Reserved event flags; zero in ABI v1.
    pub flags: u16,
    /// Provider monotonic event time.
    pub at_us: u64,
    /// Provider error when `kind` is error.
    pub error_code: i32,
    /// Wrapping provider audio-event sequence.
    pub sequence: u32,
    /// Wrapping cumulative provider audio-event drop count.
    pub dropped_events: u32,
    /// Reserved and zeroed in ABI v1.
    pub reserved0: u32,
}

/// C-compatible OID queue counters.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct OidQueueStatsV1 {
    /// Sequence assigned to the next observed or dropped event.
    pub next_sequence: u32,
    /// Wrapping cumulative queue-overflow count.
    pub dropped_events: u32,
    /// Events currently waiting for the Rust-owned task.
    pub queued_events: u32,
    /// Reserved and zero in ABI v1.
    pub reserved0: u32,
}

/// C-compatible audio queue counters.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AudioQueueStatsV1 {
    /// Sequence assigned to the next produced or dropped event.
    pub next_sequence: u32,
    /// Wrapping cumulative queue-overflow count.
    pub dropped_events: u32,
    /// Events currently waiting for the Rust-owned task.
    pub queued_events: u32,
    /// Reserved and zero in ABI v1.
    pub reserved0: u32,
}

const _: () = {
    assert!(size_of::<PlatformInfoV1>() == 56);
    assert!(align_of::<PlatformInfoV1>() == align_of::<u64>());
    assert!(offset_of!(PlatformInfoV1, capability_bits) == 16);
    assert!(offset_of!(PlatformInfoV1, audio_start_time_class) == 32);
    assert!(offset_of!(PlatformInfoV1, storage_atomic_write_bytes) == 48);
    assert!(offset_of!(PlatformInfoV1, audio_queue_stats_size) == 52);

    assert!(size_of::<OidEventV1>() == 48);
    assert!(align_of::<OidEventV1>() == align_of::<u64>());
    assert!(offset_of!(OidEventV1, event_at_us) == 8);
    assert!(offset_of!(OidEventV1, sequence) == 32);
    assert!(offset_of!(OidEventV1, quality) == 40);
    assert!(offset_of!(OidEventV1, reserved0) == 44);

    assert!(size_of::<AudioEventV1>() == 32);
    assert!(align_of::<AudioEventV1>() == align_of::<u64>());
    assert!(offset_of!(AudioEventV1, at_us) == 8);
    assert!(offset_of!(AudioEventV1, sequence) == 20);
    assert!(offset_of!(AudioEventV1, reserved0) == 28);

    assert!(size_of::<OidQueueStatsV1>() == 16);
    assert!(size_of::<AudioQueueStatsV1>() == 16);
};

/// Safe platform wrapper errors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlatformError {
    /// Caller supplied an invalid value or buffer.
    InvalidArgument,
    /// Platform storage/transport/audio I/O failed.
    Io,
    /// Provider lacks the requested capability.
    Unsupported,
    /// Provider queue or exclusive operation is busy.
    Busy,
    /// Struct version or layout differs from ABI v1.
    AbiMismatch,
    /// Provider returned a structurally valid but contradictory event or metadata.
    ProviderViolation,
    /// Provider returned an unknown status value.
    UnknownStatus(i32),
    /// OID or audio event contains an unknown discriminant.
    UnknownEventKind(u8),
}

/// Decoded audio lifecycle event.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AudioEvent {
    /// Original request identity.
    pub request_id: u32,
    /// Event kind.
    pub kind: AudioEventKind,
    /// Platform monotonic event time.
    pub at: MonotonicUs,
    /// Measurement stage represented by [`Self::at`].
    pub timestamp_class: AudioTimeClass,
    /// Platform-specific error detail.
    pub error_code: i32,
    /// Wrapping event sequence.
    pub sequence: u32,
    /// Wrapping cumulative provider drop count.
    pub dropped_events: u32,
}

/// Safe audio lifecycle discriminant.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AudioEventKind {
    /// Decoder/output accepted and began the request.
    Started,
    /// Clip reached its natural end.
    Ended,
    /// Request stopped through control policy.
    Stopped,
    /// Provider reported an error.
    Error,
}

/// Measurement stage represented by an audio event timestamp.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AudioTimeClass {
    /// Provider accepted the request; media output has not yet been proven.
    RequestAccepted,
    /// Decoder produced its first PCM samples.
    DecoderFirstPcm,
    /// The first DMA/I²S output buffer began.
    DmaFirstBuffer,
    /// The first electrical output edge/sample began.
    ElectricalOutput,
}

/// Validated queue counters returned by the provider.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct OidQueueStats {
    /// Sequence assigned to the next observed or dropped event.
    pub next_sequence: u32,
    /// Wrapping cumulative queue-overflow count.
    pub dropped_events: u32,
    /// Events currently waiting for the Rust-owned task.
    pub queued_events: u32,
}

/// Validated audio queue counters returned by the provider.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AudioQueueStats {
    /// Sequence assigned to the next produced or dropped event.
    pub next_sequence: u32,
    /// Wrapping cumulative queue-overflow count.
    pub dropped_events: u32,
    /// Events currently waiting for the Rust-owned task.
    pub queued_events: u32,
}

/// Connected provider after ABI layout validation.
///
/// The handle is deliberately neither `Send` nor `Sync`; one board-owned task
/// keeps it and every provider operation requires exclusive access.
///
/// ```compile_fail
/// fn require_send<T: Send>() {}
/// require_send::<yimi_platform_ffi::Platform>();
/// ```
///
/// ```compile_fail
/// fn require_sync<T: Sync>() {}
/// require_sync::<yimi_platform_ffi::Platform>();
/// ```
#[derive(Debug)]
pub struct Platform {
    info: PlatformInfoV1,
    _not_send_sync: PhantomData<*mut ()>,
}

impl Platform {
    /// Reads and validates the provider ABI metadata.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error or [`PlatformError::AbiMismatch`].
    pub fn connect() -> Result<Self, PlatformError> {
        expect_ok(raw::acquire())?;
        let mut info = PlatformInfoV1::default();
        if let Err(error) = expect_ok(raw::get_info(&mut info)).and_then(|()| validate_info(info)) {
            let _ = raw::release();
            return Err(error);
        }
        Ok(Self {
            info,
            _not_send_sync: PhantomData,
        })
    }

    /// Returns validated provider metadata.
    #[must_use]
    pub const fn info(&self) -> PlatformInfoV1 {
        self.info
    }

    /// Reads the platform monotonic clock.
    ///
    /// # Errors
    ///
    /// Returns [`PlatformError::ProviderViolation`] for the unavailable sentinel.
    pub fn now_us(&mut self) -> Result<MonotonicUs, PlatformError> {
        let value = raw::now_us();
        if value == TIME_UNAVAILABLE_US {
            Err(PlatformError::ProviderViolation)
        } else {
            Ok(MonotonicUs(value))
        }
    }

    /// Polls one normalized OID event.
    ///
    /// # Errors
    ///
    /// Returns provider errors or an unknown event discriminant.
    pub fn poll_oid(&mut self) -> Result<Option<PhysicalCodeEvent>, PlatformError> {
        let mut event = OidEventV1::default();
        match raw::poll_oid(&mut event) {
            STATUS_EMPTY => Ok(None),
            STATUS_OK => Ok(Some(decode_oid(event)?)),
            status => Err(map_status(status)),
        }
    }

    /// Reads queue sequence and overflow evidence.
    ///
    /// # Errors
    ///
    /// Returns provider errors or rejects non-zero reserved fields.
    pub fn oid_queue_stats(&mut self) -> Result<OidQueueStats, PlatformError> {
        let mut stats = OidQueueStatsV1::default();
        expect_ok(raw::oid_queue_stats(&mut stats))?;
        if stats.reserved0 != 0 {
            return Err(PlatformError::ProviderViolation);
        }
        Ok(OidQueueStats {
            next_sequence: stats.next_sequence,
            dropped_events: stats.dropped_events,
            queued_events: stats.queued_events,
        })
    }

    /// Starts a snapshot-relative audio path.
    ///
    /// # Errors
    ///
    /// Returns [`PlatformError::InvalidArgument`] for unsafe/oversized paths or
    /// a mapped provider error.
    pub fn audio_start(&mut self, path: &[u8], request_id: u32) -> Result<(), PlatformError> {
        if path.len() > self.info.max_path_bytes as usize || !safe_relative_path(path) {
            return Err(PlatformError::InvalidArgument);
        }
        expect_ok(raw::audio_start(path, request_id))
    }

    /// Stops an audio request.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error.
    pub fn audio_stop(&mut self, request_id: u32) -> Result<(), PlatformError> {
        expect_ok(raw::audio_stop(request_id))
    }

    /// Polls one audio lifecycle event.
    ///
    /// # Errors
    ///
    /// Returns provider errors or an unknown event discriminant.
    pub fn poll_audio(&mut self) -> Result<Option<AudioEvent>, PlatformError> {
        let mut event = AudioEventV1::default();
        match raw::poll_audio(&mut event) {
            STATUS_EMPTY => Ok(None),
            STATUS_OK => Ok(Some(decode_audio(event, self.info.audio_start_time_class)?)),
            status => Err(map_status(status)),
        }
    }

    /// Reads audio queue sequence and overflow evidence.
    ///
    /// # Errors
    ///
    /// Returns provider errors or rejects non-zero reserved fields.
    pub fn audio_queue_stats(&mut self) -> Result<AudioQueueStats, PlatformError> {
        let mut stats = AudioQueueStatsV1::default();
        expect_ok(raw::audio_queue_stats(&mut stats))?;
        if stats.reserved0 != 0 {
            return Err(PlatformError::ProviderViolation);
        }
        Ok(AudioQueueStats {
            next_sequence: stats.next_sequence,
            dropped_events: stats.dropped_events,
            queued_events: stats.queued_events,
        })
    }

    /// Reads the content-storage capacity.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error.
    pub fn storage_capacity(&mut self) -> Result<u64, PlatformError> {
        let mut capacity = 0;
        expect_ok(raw::storage_capacity(&mut capacity))?;
        Ok(capacity)
    }

    /// Reads exactly one storage range.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error or rejects a slice above the ABI limit.
    pub fn storage_read(&mut self, offset: u64, out: &mut [u8]) -> Result<(), PlatformError> {
        if out.len() > self.info.storage_max_transfer as usize {
            return Err(PlatformError::InvalidArgument);
        }
        expect_ok(raw::storage_read(offset, out))
    }

    /// Writes exactly one storage range.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error or rejects a slice above the ABI limit.
    pub fn storage_write(&mut self, offset: u64, bytes: &[u8]) -> Result<(), PlatformError> {
        let alignment = u64::from(self.info.storage_write_alignment);
        if bytes.len() > self.info.storage_max_transfer as usize
            || !offset.is_multiple_of(alignment)
            || u64::try_from(bytes.len()).map_or(true, |length| !length.is_multiple_of(alignment))
        {
            return Err(PlatformError::InvalidArgument);
        }
        expect_ok(raw::storage_write(offset, bytes))
    }

    /// Makes preceding storage writes durable according to the board contract.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error.
    pub fn storage_sync(&mut self) -> Result<(), PlatformError> {
        expect_ok(raw::storage_sync())
    }

    /// Polls one `DeviceLink` byte-stream frame fragment.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error or rejects a buffer above the ABI limit.
    pub fn transport_read(&mut self, out: &mut [u8]) -> Result<Option<usize>, PlatformError> {
        if out.is_empty() || out.len() > self.info.transport_mtu as usize {
            return Err(PlatformError::InvalidArgument);
        }
        let mut actual = 0;
        match raw::transport_read(out, &mut actual) {
            STATUS_EMPTY => Ok(None),
            STATUS_OK if actual as usize <= out.len() => Ok(Some(actual as usize)),
            STATUS_OK => Err(PlatformError::AbiMismatch),
            status => Err(map_status(status)),
        }
    }

    /// Writes one `DeviceLink` byte-stream frame fragment.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error or rejects a slice above the ABI limit.
    pub fn transport_write(&mut self, bytes: &[u8]) -> Result<(), PlatformError> {
        if bytes.len() > self.info.transport_mtu as usize {
            return Err(PlatformError::InvalidArgument);
        }
        expect_ok(raw::transport_write(bytes))
    }

    /// Writes one bounded diagnostic payload.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error or rejects a slice above the ABI limit.
    pub fn log_write(
        &mut self,
        level: u8,
        event_id: u32,
        payload: &[u8],
    ) -> Result<(), PlatformError> {
        expect_ok(raw::log_write(level, event_id, payload))
    }
}

impl Drop for Platform {
    fn drop(&mut self) {
        let _ = raw::release();
    }
}

fn validate_info(info: PlatformInfoV1) -> Result<(), PlatformError> {
    if info.abi_version != ABI_VERSION
        || info.info_size as usize != size_of::<PlatformInfoV1>()
        || info.oid_event_size as usize != size_of::<OidEventV1>()
        || info.audio_event_size as usize != size_of::<AudioEventV1>()
        || info.oid_queue_stats_size as usize != size_of::<OidQueueStatsV1>()
        || info.audio_queue_stats_size as usize != size_of::<AudioQueueStatsV1>()
    {
        return Err(PlatformError::AbiMismatch);
    }
    let required_capabilities = capability::OID_POLL
        | capability::AUDIO_PATH
        | capability::STORAGE_RANDOM_IO
        | capability::DEVICE_LINK_STREAM
        | capability::MONOTONIC_US;
    if info.capability_bits & required_capabilities != required_capabilities {
        return Err(PlatformError::Unsupported);
    }
    if info.max_path_bytes == 0
        || info.max_path_bytes as usize > MAX_PATH_BYTES
        || info.transport_mtu == 0
        || decode_audio_time_class(info.audio_start_time_class).is_err()
        || info.storage_write_alignment == 0
        || !info.storage_write_alignment.is_power_of_two()
        || info.storage_max_transfer == 0
        || info.storage_atomic_write_bytes == 0
        || !info.storage_atomic_write_bytes.is_power_of_two()
        || info.storage_atomic_write_bytes > info.storage_max_transfer
    {
        return Err(PlatformError::ProviderViolation);
    }
    Ok(())
}

fn decode_oid(event: OidEventV1) -> Result<PhysicalCodeEvent, PlatformError> {
    const KNOWN_FLAGS: u8 = OID_HAS_CODE | OID_HAS_SENSOR_AT | OID_HAS_READY_AT | OID_HAS_QUALITY;
    let status = match event.status {
        0 => OidStatus::Valid,
        1 => OidStatus::LowQuality,
        2 => OidStatus::NoCode,
        3 => OidStatus::SensorFault,
        value => return Err(PlatformError::UnknownEventKind(value)),
    };
    let has_code = event.flags & OID_HAS_CODE != 0;
    if event.flags & !KNOWN_FLAGS != 0
        || event.reserved0 != 0
        || event.event_at_us == TIME_UNAVAILABLE_US
        || (!has_code && event.physical_code != 0)
        || (event.flags & OID_HAS_QUALITY == 0 && event.quality != 0)
        || (matches!(status, OidStatus::Valid) && !has_code)
        || (matches!(status, OidStatus::NoCode | OidStatus::SensorFault) && has_code)
    {
        return Err(PlatformError::ProviderViolation);
    }
    let sensor_at = decode_optional_time(event.sensor_at_us, event.flags & OID_HAS_SENSOR_AT != 0)?;
    let ready_at = decode_optional_time(event.ready_at_us, event.flags & OID_HAS_READY_AT != 0)?;
    if sensor_at.is_some_and(|time| time.0 > event.event_at_us)
        || ready_at.is_some_and(|time| time.0 > event.event_at_us)
        || sensor_at
            .zip(ready_at)
            .is_some_and(|(sensor, ready)| sensor > ready)
    {
        return Err(PlatformError::ProviderViolation);
    }
    Ok(PhysicalCodeEvent {
        physical_code: has_code.then_some(PhysicalCode(event.physical_code)),
        event_at: MonotonicUs(event.event_at_us),
        sensor_at,
        ready_at,
        quality: (event.flags & OID_HAS_QUALITY != 0).then_some(event.quality),
        status,
        sequence: event.sequence,
        dropped_events: event.dropped_events,
    })
}

fn decode_optional_time(value: u64, present: bool) -> Result<Option<MonotonicUs>, PlatformError> {
    match (present, value == TIME_UNAVAILABLE_US) {
        (true, false) => Ok(Some(MonotonicUs(value))),
        (false, true) => Ok(None),
        _ => Err(PlatformError::ProviderViolation),
    }
}

fn decode_audio(
    event: AudioEventV1,
    expected_start_time_class: u32,
) -> Result<AudioEvent, PlatformError> {
    let kind = match event.kind {
        0 => AudioEventKind::Started,
        1 => AudioEventKind::Ended,
        2 => AudioEventKind::Stopped,
        3 => AudioEventKind::Error,
        value => return Err(PlatformError::UnknownEventKind(value)),
    };
    let timestamp_class = decode_audio_time_class(u32::from(event.timestamp_class))?;
    if event.flags != 0
        || event.reserved0 != 0
        || event.at_us == TIME_UNAVAILABLE_US
        || (matches!(kind, AudioEventKind::Error) && event.error_code == 0)
        || (!matches!(kind, AudioEventKind::Error) && event.error_code != 0)
        || (matches!(kind, AudioEventKind::Started)
            && u32::from(event.timestamp_class) != expected_start_time_class)
    {
        return Err(PlatformError::ProviderViolation);
    }
    Ok(AudioEvent {
        request_id: event.request_id,
        kind,
        at: MonotonicUs(event.at_us),
        timestamp_class,
        error_code: event.error_code,
        sequence: event.sequence,
        dropped_events: event.dropped_events,
    })
}

fn decode_audio_time_class(value: u32) -> Result<AudioTimeClass, PlatformError> {
    match value {
        0 => Ok(AudioTimeClass::RequestAccepted),
        1 => Ok(AudioTimeClass::DecoderFirstPcm),
        2 => Ok(AudioTimeClass::DmaFirstBuffer),
        3 => Ok(AudioTimeClass::ElectricalOutput),
        _ => Err(PlatformError::ProviderViolation),
    }
}

fn safe_relative_path(path: &[u8]) -> bool {
    if path.is_empty()
        || path[0] == b'/'
        || path[0] == b'\\'
        || (path.len() >= 2 && path[0].is_ascii_alphabetic() && path[1] == b':')
        || path
            .iter()
            .any(|byte| !byte.is_ascii_alphanumeric() && !matches!(byte, b'.' | b'_' | b'-' | b'/'))
    {
        return false;
    }
    path.split(|byte| *byte == b'/')
        .all(|segment| !segment.is_empty() && segment != b"." && segment != b"..")
}

fn expect_ok(status: i32) -> Result<(), PlatformError> {
    if status == STATUS_OK {
        Ok(())
    } else {
        Err(map_status(status))
    }
}

fn map_status(status: i32) -> PlatformError {
    match status {
        STATUS_INVALID_ARGUMENT => PlatformError::InvalidArgument,
        STATUS_IO => PlatformError::Io,
        STATUS_UNSUPPORTED => PlatformError::Unsupported,
        STATUS_BUSY => PlatformError::Busy,
        STATUS_ABI_MISMATCH => PlatformError::AbiMismatch,
        value => PlatformError::UnknownStatus(value),
    }
}

// Host controls remain crate-private so safe downstream code cannot race the
// intentionally single-threaded C fixture outside this module's test lock.
#[cfg(all(feature = "host-mock", test))]
mod mock {
    use super::{
        AudioEventV1, OID_HAS_CODE, OID_HAS_QUALITY, OID_HAS_READY_AT, OID_HAS_SENSOR_AT,
        OidEventV1, OidStatus, PhysicalCodeEvent, PlatformError, TIME_UNAVAILABLE_US, expect_ok,
        raw,
    };

    /// Resets deterministic C mock state.
    pub fn reset() {
        raw::mock::reset();
    }

    /// Pushes one normalized event through the C queue.
    ///
    /// # Errors
    ///
    /// Returns a mapped mock provider error.
    pub fn push_oid(event: PhysicalCodeEvent) -> Result<(), PlatformError> {
        let mut flags = 0;
        if event.physical_code.is_some() {
            flags |= OID_HAS_CODE;
        }
        if event.sensor_at.is_some() {
            flags |= OID_HAS_SENSOR_AT;
        }
        if event.ready_at.is_some() {
            flags |= OID_HAS_READY_AT;
        }
        if event.quality.is_some() {
            flags |= OID_HAS_QUALITY;
        }
        let status = match event.status {
            OidStatus::Valid => 0,
            OidStatus::LowQuality => 1,
            OidStatus::NoCode => 2,
            OidStatus::SensorFault => 3,
        };
        let raw_event = OidEventV1 {
            physical_code: event.physical_code.map_or(0, |code| code.0),
            event_at_us: event.event_at.0,
            sensor_at_us: event.sensor_at.map_or(TIME_UNAVAILABLE_US, |time| time.0),
            ready_at_us: event.ready_at.map_or(TIME_UNAVAILABLE_US, |time| time.0),
            sequence: event.sequence,
            dropped_events: event.dropped_events,
            quality: event.quality.unwrap_or(0),
            status,
            flags,
            reserved0: 0,
        };
        expect_ok(raw::mock::push_oid(&raw_event))
    }

    /// Simulates loss of unsynchronized storage writes across a power cycle.
    pub fn storage_power_cycle() {
        raw::mock::storage_power_cycle();
    }

    /// Pushes an exact C-layout OID event into the reference queue.
    ///
    /// This is used by neutral golden vectors so Rust decoding is checked
    /// independently from the safe event encoder above.
    ///
    /// # Errors
    ///
    /// Returns a mapped mock provider error.
    pub fn push_raw_oid(event: OidEventV1) -> Result<(), PlatformError> {
        expect_ok(raw::mock::push_oid(&event))
    }

    /// Pushes an exact C-layout audio event into the reference queue.
    ///
    /// # Errors
    ///
    /// Returns a mapped mock provider error.
    pub fn push_raw_audio(event: AudioEventV1) -> Result<(), PlatformError> {
        expect_ok(raw::mock::push_audio(&event))
    }

    /// Calls the C reference audio entry point without Rust path pre-validation.
    ///
    /// # Errors
    ///
    /// Returns a mapped C reference result or rejects an ABI-sized length.
    pub fn reference_audio_start(path: &[u8], request_id: u32) -> Result<(), PlatformError> {
        expect_ok(raw::audio_start(path, request_id))
    }

    /// Injects bytes into the C transport receive queue.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error or rejects an oversized slice.
    pub fn inject_transport(bytes: &[u8]) -> Result<(), PlatformError> {
        expect_ok(raw::mock::inject_transport(bytes))
    }

    /// Reads the last Rust-to-C transport write.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error or rejects an oversized buffer.
    pub fn last_transport_write(out: &mut [u8]) -> Result<usize, PlatformError> {
        let mut actual = 0;
        expect_ok(raw::mock::last_transport_write(out, &mut actual))?;
        if actual as usize > out.len() {
            return Err(PlatformError::AbiMismatch);
        }
        Ok(actual as usize)
    }

    /// Reads the C-owned audio-path copy and request identity.
    ///
    /// # Errors
    ///
    /// Returns a mapped provider error or rejects an oversized buffer.
    pub fn last_audio_path(out: &mut [u8]) -> Result<(usize, u32), PlatformError> {
        let mut actual = 0;
        let mut request_id = 0;
        expect_ok(raw::mock::last_audio_path(
            out,
            &mut actual,
            &mut request_id,
        ))?;
        if actual as usize > out.len() {
            return Err(PlatformError::AbiMismatch);
        }
        Ok((actual as usize, request_id))
    }
}

#[cfg(all(test, feature = "host-mock"))]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::{
        string::String,
        sync::{Mutex, MutexGuard, mpsc},
        thread,
        vec::Vec,
    };

    static MOCK_LOCK: Mutex<()> = Mutex::new(());

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenVectors {
        schema_version: u32,
        contract: String,
        fixture_only: bool,
        expected_info: ExpectedInfo,
        oid_vectors: Vec<OidVector>,
        audio_vectors: Vec<AudioVector>,
        storage_vectors: Vec<StorageVector>,
        transport_vectors: Vec<TransportVector>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ExpectedInfo {
        abi_version: u32,
        info_size: u32,
        oid_event_size: u32,
        audio_event_size: u32,
        capability_bits: String,
        max_path_bytes: u32,
        transport_mtu: u32,
        audio_start_time_class: u32,
        oid_queue_stats_size: u32,
        storage_write_alignment: u32,
        storage_max_transfer: u32,
        storage_atomic_write_bytes: u32,
        audio_queue_stats_size: u32,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct OidVector {
        id: String,
        raw: RawOid,
        expected: Option<ExpectedOid>,
        expected_error: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RawOid {
        physical_code: String,
        event_at_us: String,
        sensor_at_us: String,
        ready_at_us: String,
        sequence: u32,
        dropped_events: u32,
        quality: u16,
        status: u8,
        flags: u8,
        reserved0: u32,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ExpectedOid {
        physical_code: Option<String>,
        event_at_us: String,
        sensor_at_us: Option<String>,
        ready_at_us: Option<String>,
        quality: Option<u16>,
        status: String,
        sequence: u32,
        dropped_events: u32,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AudioVector {
        id: String,
        path: String,
        request_id: u32,
        expected_status: String,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StorageVector {
        id: String,
        offset: String,
        hex: String,
        expected_status: String,
    }

    #[derive(Debug, Deserialize)]
    struct TransportVector {
        id: String,
        direction: String,
        hex: String,
    }

    fn connected() -> (MutexGuard<'static, ()>, Platform) {
        let guard = MOCK_LOCK.lock().expect("host C mock lock is healthy");
        mock::reset();
        (guard, Platform::connect().unwrap())
    }

    fn vectors() -> GoldenVectors {
        serde_json::from_str(include_str!(
            "../../../../hardware/evt0/platform-ffi-v1/golden-vectors.json"
        ))
        .expect("platform FFI golden vectors must parse")
    }

    fn parse_u64(value: &str) -> u64 {
        value.parse().expect("schema-validated decimal u64")
    }

    fn hex_nibble(byte: u8) -> u8 {
        match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            _ => panic!("schema-validated lowercase hexadecimal"),
        }
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        let chunks = value.as_bytes().chunks_exact(2);
        assert!(chunks.remainder().is_empty());
        chunks
            .map(|pair| (hex_nibble(pair[0]) << 4) | hex_nibble(pair[1]))
            .collect()
    }

    fn expected_oid(value: &ExpectedOid) -> PhysicalCodeEvent {
        let status = match value.status.as_str() {
            "valid" => OidStatus::Valid,
            "low-quality" => OidStatus::LowQuality,
            "no-code" => OidStatus::NoCode,
            "sensor-fault" => OidStatus::SensorFault,
            _ => panic!("schema-validated OID status"),
        };
        PhysicalCodeEvent {
            physical_code: value
                .physical_code
                .as_deref()
                .map(parse_u64)
                .map(PhysicalCode),
            event_at: MonotonicUs(parse_u64(&value.event_at_us)),
            sensor_at: value
                .sensor_at_us
                .as_deref()
                .map(parse_u64)
                .map(MonotonicUs),
            ready_at: value.ready_at_us.as_deref().map(parse_u64).map(MonotonicUs),
            quality: value.quality,
            status,
            sequence: value.sequence,
            dropped_events: value.dropped_events,
        }
    }

    fn expected_call(status: &str) -> Result<(), PlatformError> {
        match status {
            "ok" => Ok(()),
            "invalid-argument" => Err(PlatformError::InvalidArgument),
            _ => panic!("schema-validated call status"),
        }
    }

    fn check_info(platform: &Platform, expected: &ExpectedInfo) {
        let info = platform.info();
        assert_eq!(info.abi_version, expected.abi_version);
        assert_eq!(info.info_size, expected.info_size);
        assert_eq!(info.oid_event_size, expected.oid_event_size);
        assert_eq!(info.audio_event_size, expected.audio_event_size);
        assert_eq!(info.capability_bits, parse_u64(&expected.capability_bits));
        assert_eq!(info.max_path_bytes, expected.max_path_bytes);
        assert_eq!(info.transport_mtu, expected.transport_mtu);
        assert_eq!(info.audio_start_time_class, expected.audio_start_time_class);
        assert_eq!(info.oid_queue_stats_size, expected.oid_queue_stats_size);
        assert_eq!(
            info.storage_write_alignment,
            expected.storage_write_alignment
        );
        assert_eq!(info.storage_max_transfer, expected.storage_max_transfer);
        assert_eq!(
            info.storage_atomic_write_bytes,
            expected.storage_atomic_write_bytes
        );
        assert_eq!(info.audio_queue_stats_size, expected.audio_queue_stats_size);
    }

    fn check_oid_vectors(platform: &mut Platform, vectors: Vec<OidVector>) {
        for vector in vectors {
            mock::reset();
            let raw = OidEventV1 {
                physical_code: parse_u64(&vector.raw.physical_code),
                event_at_us: parse_u64(&vector.raw.event_at_us),
                sensor_at_us: parse_u64(&vector.raw.sensor_at_us),
                ready_at_us: parse_u64(&vector.raw.ready_at_us),
                sequence: vector.raw.sequence,
                dropped_events: vector.raw.dropped_events,
                quality: vector.raw.quality,
                status: vector.raw.status,
                flags: vector.raw.flags,
                reserved0: vector.raw.reserved0,
            };
            mock::push_raw_oid(raw).expect("C mock accepts raw OID vector");
            let expected = if let Some(event) = vector.expected.as_ref() {
                Ok(Some(expected_oid(event)))
            } else if vector.expected_error.as_deref() == Some("provider-violation") {
                Err(PlatformError::ProviderViolation)
            } else {
                panic!("schema-validated OID vector expectation")
            };
            assert_eq!(platform.poll_oid(), expected, "{}", vector.id);
            assert_eq!(platform.poll_oid(), Ok(None), "{}", vector.id);
        }
    }

    fn check_audio_vectors(platform: &mut Platform, vectors: Vec<AudioVector>) {
        for vector in vectors {
            let expected = expected_call(&vector.expected_status);
            mock::reset();
            assert_eq!(
                mock::reference_audio_start(vector.path.as_bytes(), vector.request_id),
                expected,
                "C reference: {}",
                vector.id
            );
            mock::reset();
            assert_eq!(
                platform.audio_start(vector.path.as_bytes(), vector.request_id),
                expected,
                "safe Rust adapter: {}",
                vector.id
            );
            if expected.is_ok() {
                let event = platform
                    .poll_audio()
                    .expect("C audio poll succeeds")
                    .expect("accepted audio emits a lifecycle event");
                assert_eq!(event.request_id, vector.request_id, "{}", vector.id);
                assert_eq!(event.kind, AudioEventKind::Started, "{}", vector.id);
            } else {
                assert_eq!(platform.poll_audio(), Ok(None), "{}", vector.id);
            }
        }
    }

    fn check_storage_vectors(platform: &mut Platform, vectors: Vec<StorageVector>) {
        for vector in vectors {
            mock::reset();
            let bytes = decode_hex(&vector.hex);
            let offset = parse_u64(&vector.offset);
            let expected = expected_call(&vector.expected_status);
            assert_eq!(
                platform.storage_write(offset, &bytes),
                expected,
                "{}",
                vector.id
            );
            if expected.is_ok() {
                platform.storage_sync().expect("C storage sync succeeds");
                let mut read_back = std::vec![0_u8; bytes.len()];
                platform
                    .storage_read(offset, &mut read_back)
                    .expect("C storage read succeeds");
                assert_eq!(read_back, bytes, "{}", vector.id);
            }
        }
    }

    fn check_transport_vectors(platform: &mut Platform, vectors: Vec<TransportVector>) {
        for vector in vectors {
            mock::reset();
            let bytes = decode_hex(&vector.hex);
            let mut read_back = std::vec![0_u8; bytes.len()];
            match vector.direction.as_str() {
                "host-to-device" => {
                    mock::inject_transport(&bytes).expect("C transport injection succeeds");
                    let length = platform
                        .transport_read(&mut read_back)
                        .expect("Rust transport read succeeds")
                        .expect("injected transport data is available");
                    read_back.truncate(length);
                }
                "device-to-host" => {
                    platform
                        .transport_write(&bytes)
                        .expect("Rust transport write succeeds");
                    let length = mock::last_transport_write(&mut read_back)
                        .expect("C transport capture succeeds");
                    read_back.truncate(length);
                }
                _ => panic!("schema-validated transport direction"),
            }
            assert_eq!(read_back, bytes, "{}", vector.id);
        }
    }

    #[test]
    fn c_and_rust_layouts_and_capabilities_match() {
        let (_guard, platform) = connected();
        let info = platform.info();
        assert_eq!(info.abi_version, ABI_VERSION);
        assert_eq!(info.info_size as usize, size_of::<PlatformInfoV1>());
        assert_eq!(info.oid_event_size as usize, size_of::<OidEventV1>());
        assert_eq!(info.audio_event_size as usize, size_of::<AudioEventV1>());
        assert_eq!(
            info.oid_queue_stats_size as usize,
            size_of::<OidQueueStatsV1>()
        );
        assert_eq!(
            info.audio_queue_stats_size as usize,
            size_of::<AudioQueueStatsV1>()
        );
        assert_eq!(size_of::<PlatformInfoV1>(), 56);
        assert_eq!(size_of::<OidEventV1>(), 48);
        assert_eq!(size_of::<AudioEventV1>(), 32);
        assert_eq!(size_of::<OidQueueStatsV1>(), 16);
        assert_eq!(size_of::<AudioQueueStatsV1>(), 16);
        assert_eq!(
            info.capability_bits,
            capability::OID_POLL
                | capability::AUDIO_PATH
                | capability::STORAGE_RANDOM_IO
                | capability::DEVICE_LINK_STREAM
                | capability::MONOTONIC_US
        );
    }

    #[test]
    fn provider_acquire_is_process_singleton() {
        let _guard = MOCK_LOCK.lock().expect("host C mock lock is healthy");
        mock::reset();
        let (ready_tx, ready_rx) = mpsc::sync_channel(0);
        let (release_tx, release_rx) = mpsc::sync_channel(0);
        let worker = thread::spawn(move || {
            let platform = Platform::connect().expect("worker acquires provider");
            ready_tx.send(()).expect("worker signals acquisition");
            release_rx.recv().expect("worker receives release signal");
            drop(platform);
        });
        ready_rx.recv().expect("worker acquired provider");
        assert!(matches!(Platform::connect(), Err(PlatformError::Busy)));
        release_tx.send(()).expect("test signals provider release");
        worker.join().expect("provider worker exits cleanly");
        let platform = Platform::connect().expect("provider can be reacquired after drop");
        drop(platform);
    }

    #[test]
    fn oid_event_round_trips_through_c_queue() {
        let (_guard, mut platform) = connected();
        let event = PhysicalCodeEvent {
            physical_code: Some(PhysicalCode(123_456)),
            event_at: MonotonicUs(1_000),
            sensor_at: Some(MonotonicUs(900)),
            ready_at: None,
            quality: Some(77),
            status: OidStatus::Valid,
            sequence: 8,
            dropped_events: 2,
        };
        mock::push_oid(event).unwrap();
        assert_eq!(
            platform.oid_queue_stats(),
            Ok(OidQueueStats {
                next_sequence: 9,
                dropped_events: 2,
                queued_events: 1,
            })
        );
        assert_eq!(platform.poll_oid(), Ok(Some(event)));
        assert_eq!(platform.poll_oid(), Ok(None));
    }

    #[test]
    fn oid_queue_overflow_is_visible_in_stats_and_sequence() {
        let (_guard, mut platform) = connected();
        for sequence in 0..8 {
            let mut event = PhysicalCodeEvent::valid(
                PhysicalCode(100 + u64::from(sequence)),
                MonotonicUs(1_000),
            );
            event.sequence = sequence;
            mock::push_oid(event).unwrap();
        }
        let mut dropped = PhysicalCodeEvent::valid(PhysicalCode(999), MonotonicUs(1_001));
        dropped.sequence = 8;
        assert_eq!(mock::push_oid(dropped), Err(PlatformError::Busy));
        assert_eq!(
            platform.oid_queue_stats(),
            Ok(OidQueueStats {
                next_sequence: 9,
                dropped_events: 1,
                queued_events: 8,
            })
        );
        for _ in 0..8 {
            platform.poll_oid().unwrap().expect("queued OID event");
        }
        let mut after_drop = PhysicalCodeEvent::valid(PhysicalCode(1_000), MonotonicUs(1_002));
        after_drop.sequence = 9;
        after_drop.dropped_events = 1;
        mock::push_oid(after_drop).unwrap();
        assert_eq!(platform.poll_oid(), Ok(Some(after_drop)));
    }

    #[test]
    fn audio_path_is_copied_and_lifecycle_is_polled() {
        let (_guard, mut platform) = connected();
        let path = b"audio/clip-001.mp3";
        platform.audio_start(path, 42).unwrap();
        let mut copied = [0_u8; MAX_PATH_BYTES];
        let (length, request_id) = mock::last_audio_path(&mut copied).unwrap();
        assert_eq!(&copied[..length], path);
        assert_eq!(request_id, 42);
        assert_eq!(
            platform.poll_audio().unwrap().map(|event| (
                event.request_id,
                event.kind,
                event.timestamp_class
            )),
            Some((42, AudioEventKind::Started, AudioTimeClass::RequestAccepted))
        );
        assert_eq!(
            platform.audio_start(b"../outside.mp3", 43),
            Err(PlatformError::InvalidArgument)
        );
    }

    #[test]
    fn busy_audio_start_has_no_path_side_effect() {
        let (_guard, mut platform) = connected();
        for request_id in 0..8 {
            platform
                .audio_start(b"audio/accepted.mp3", request_id)
                .unwrap();
        }
        assert_eq!(
            platform.audio_start(b"audio/rejected.mp3", 99),
            Err(PlatformError::Busy)
        );
        let mut copied = [0_u8; MAX_PATH_BYTES];
        let (length, request_id) = mock::last_audio_path(&mut copied).unwrap();
        assert_eq!(&copied[..length], b"audio/accepted.mp3");
        assert_eq!(request_id, 7);
        assert_eq!(
            platform.audio_queue_stats(),
            Ok(AudioQueueStats {
                next_sequence: 8,
                dropped_events: 0,
                queued_events: 8,
            })
        );
    }

    #[test]
    fn audio_queue_overflow_and_provider_violation_are_visible() {
        let (_guard, mut platform) = connected();
        for sequence in 0..8 {
            mock::push_raw_audio(AudioEventV1 {
                request_id: sequence,
                kind: 0,
                timestamp_class: 0,
                flags: 0,
                at_us: 1_000 + u64::from(sequence),
                error_code: 0,
                sequence,
                dropped_events: 0,
                reserved0: 0,
            })
            .unwrap();
        }
        let overflow = AudioEventV1 {
            request_id: 99,
            kind: 0,
            timestamp_class: 0,
            flags: 0,
            at_us: 2_000,
            error_code: 0,
            sequence: 8,
            dropped_events: 0,
            reserved0: 0,
        };
        assert_eq!(mock::push_raw_audio(overflow), Err(PlatformError::Busy));
        assert_eq!(
            platform.audio_queue_stats(),
            Ok(AudioQueueStats {
                next_sequence: 9,
                dropped_events: 1,
                queued_events: 8,
            })
        );
        for _ in 0..8 {
            platform.poll_audio().unwrap().expect("queued audio event");
        }
        mock::push_raw_audio(AudioEventV1 {
            at_us: TIME_UNAVAILABLE_US,
            sequence: 9,
            dropped_events: 1,
            ..overflow
        })
        .unwrap();
        assert_eq!(platform.poll_audio(), Err(PlatformError::ProviderViolation));
    }

    #[test]
    fn storage_exact_io_round_trips_and_rejects_range_overflow() {
        let (_guard, mut platform) = connected();
        assert_eq!(platform.storage_capacity(), Ok(4096));
        platform.storage_write(100, b"snapshot").unwrap();
        platform.storage_sync().unwrap();
        let mut out = [0_u8; 8];
        platform.storage_read(100, &mut out).unwrap();
        assert_eq!(&out, b"snapshot");
        platform.storage_write(100, b"volatile").unwrap();
        mock::storage_power_cycle();
        platform.storage_read(100, &mut out).unwrap();
        assert_eq!(&out, b"snapshot");
        assert_eq!(
            platform.storage_write(4095, b"too-long"),
            Err(PlatformError::InvalidArgument)
        );
    }

    #[test]
    fn transport_round_trips_in_both_directions() {
        let (_guard, mut platform) = connected();
        mock::inject_transport(b"host-to-device").unwrap();
        let mut incoming = [0_u8; 32];
        let length = platform.transport_read(&mut incoming).unwrap().unwrap();
        assert_eq!(&incoming[..length], b"host-to-device");
        assert_eq!(platform.transport_read(&mut incoming), Ok(None));

        platform.transport_write(b"device-to-host").unwrap();
        let mut outgoing = [0_u8; 32];
        let length = mock::last_transport_write(&mut outgoing).unwrap();
        assert_eq!(&outgoing[..length], b"device-to-host");
    }

    #[test]
    fn transport_read_is_a_partial_byte_stream() {
        let (_guard, mut platform) = connected();
        mock::inject_transport(b"host-to-device").unwrap();
        let mut chunk = [0_u8; 4];
        let mut collected = std::vec::Vec::new();
        while let Some(length) = platform.transport_read(&mut chunk).unwrap() {
            collected.extend_from_slice(&chunk[..length]);
        }
        assert_eq!(collected, b"host-to-device");
    }

    #[test]
    fn neutral_vectors_cross_c_abi_and_safe_rust_adapter() {
        let vectors = vectors();
        assert_eq!(vectors.schema_version, 1);
        assert_eq!(vectors.contract, "yimi-platform-ffi-v1");
        assert!(vectors.fixture_only);

        let (_guard, mut platform) = connected();
        check_info(&platform, &vectors.expected_info);
        check_oid_vectors(&mut platform, vectors.oid_vectors);
        check_audio_vectors(&mut platform, vectors.audio_vectors);
        check_storage_vectors(&mut platform, vectors.storage_vectors);
        check_transport_vectors(&mut platform, vectors.transport_vectors);
    }
}
