use super::{AudioEventV1, AudioQueueStatsV1, OidEventV1, OidQueueStatsV1, PlatformInfoV1};

const STATUS_INVALID_ARGUMENT: i32 = -1;

unsafe extern "C" {
    fn yimi_platform_v1_acquire() -> i32;
    fn yimi_platform_v1_release() -> i32;
    fn yimi_platform_v1_get_info(out_info: *mut PlatformInfoV1) -> i32;
    fn yimi_platform_v1_now_us() -> u64;
    fn yimi_platform_v1_poll_oid(out_event: *mut OidEventV1) -> i32;
    fn yimi_platform_v1_oid_queue_stats(out_stats: *mut OidQueueStatsV1) -> i32;
    fn yimi_platform_v1_audio_start(path: *const u8, path_length: u32, request_id: u32) -> i32;
    fn yimi_platform_v1_audio_stop(request_id: u32) -> i32;
    fn yimi_platform_v1_poll_audio(out_event: *mut AudioEventV1) -> i32;
    fn yimi_platform_v1_audio_queue_stats(out_stats: *mut AudioQueueStatsV1) -> i32;
    fn yimi_platform_v1_storage_capacity(out_bytes: *mut u64) -> i32;
    fn yimi_platform_v1_storage_read(offset: u64, out_bytes: *mut u8, length: u32) -> i32;
    fn yimi_platform_v1_storage_write(offset: u64, bytes: *const u8, length: u32) -> i32;
    fn yimi_platform_v1_storage_sync() -> i32;
    fn yimi_platform_v1_transport_read(
        out_bytes: *mut u8,
        capacity: u32,
        out_length: *mut u32,
    ) -> i32;
    fn yimi_platform_v1_transport_write(bytes: *const u8, length: u32) -> i32;
    fn yimi_platform_v1_log_write(
        level: u8,
        event_id: u32,
        payload: *const u8,
        payload_length: u32,
    ) -> i32;
}

pub(super) fn acquire() -> i32 {
    // SAFETY: Provider acquisition has no pointer arguments and is concurrency-safe by contract.
    unsafe { yimi_platform_v1_acquire() }
}

pub(super) fn release() -> i32 {
    // SAFETY: The safe handle releases exactly the provider ownership it acquired.
    unsafe { yimi_platform_v1_release() }
}

pub(super) fn get_info(out: &mut PlatformInfoV1) -> i32 {
    // SAFETY: `out` is a valid writable pointer for the exact ABI struct.
    unsafe { yimi_platform_v1_get_info(out) }
}

pub(super) fn now_us() -> u64 {
    // SAFETY: Function has no pointer arguments or retained state from Rust.
    unsafe { yimi_platform_v1_now_us() }
}

pub(super) fn poll_oid(out: &mut OidEventV1) -> i32 {
    // SAFETY: `out` is valid for one complete ABI event write.
    unsafe { yimi_platform_v1_poll_oid(out) }
}

pub(super) fn oid_queue_stats(out: &mut OidQueueStatsV1) -> i32 {
    // SAFETY: `out` is valid for one complete queue-stats write.
    unsafe { yimi_platform_v1_oid_queue_stats(out) }
}

pub(super) fn audio_start(path: &[u8], request_id: u32) -> i32 {
    let Ok(path_length) = u32::try_from(path.len()) else {
        return STATUS_INVALID_ARGUMENT;
    };
    // SAFETY: ABI borrows the buffer only for this call; length was checked by the wrapper.
    unsafe { yimi_platform_v1_audio_start(path.as_ptr(), path_length, request_id) }
}

pub(super) fn audio_stop(request_id: u32) -> i32 {
    // SAFETY: Function accepts a value only.
    unsafe { yimi_platform_v1_audio_stop(request_id) }
}

pub(super) fn poll_audio(out: &mut AudioEventV1) -> i32 {
    // SAFETY: `out` is valid for one complete ABI event write.
    unsafe { yimi_platform_v1_poll_audio(out) }
}

pub(super) fn audio_queue_stats(out: &mut AudioQueueStatsV1) -> i32 {
    // SAFETY: `out` is valid for one complete queue-stats write.
    unsafe { yimi_platform_v1_audio_queue_stats(out) }
}

pub(super) fn storage_capacity(out: &mut u64) -> i32 {
    // SAFETY: `out` is a valid writable `u64`.
    unsafe { yimi_platform_v1_storage_capacity(out) }
}

pub(super) fn storage_read(offset: u64, out: &mut [u8]) -> i32 {
    let Ok(length) = u32::try_from(out.len()) else {
        return STATUS_INVALID_ARGUMENT;
    };
    // SAFETY: ABI writes at most the supplied, checked slice length and retains no pointer.
    unsafe { yimi_platform_v1_storage_read(offset, out.as_mut_ptr(), length) }
}

pub(super) fn storage_write(offset: u64, bytes: &[u8]) -> i32 {
    let Ok(length) = u32::try_from(bytes.len()) else {
        return STATUS_INVALID_ARGUMENT;
    };
    // SAFETY: ABI borrows the checked slice only for this call.
    unsafe { yimi_platform_v1_storage_write(offset, bytes.as_ptr(), length) }
}

pub(super) fn storage_sync() -> i32 {
    // SAFETY: Function has no pointer arguments.
    unsafe { yimi_platform_v1_storage_sync() }
}

pub(super) fn transport_read(out: &mut [u8], out_length: &mut u32) -> i32 {
    let Ok(capacity) = u32::try_from(out.len()) else {
        return STATUS_INVALID_ARGUMENT;
    };
    // SAFETY: ABI writes within the checked slice and one valid length pointer.
    unsafe { yimi_platform_v1_transport_read(out.as_mut_ptr(), capacity, out_length) }
}

pub(super) fn transport_write(bytes: &[u8]) -> i32 {
    let Ok(length) = u32::try_from(bytes.len()) else {
        return STATUS_INVALID_ARGUMENT;
    };
    // SAFETY: ABI borrows the checked slice only for this call.
    unsafe { yimi_platform_v1_transport_write(bytes.as_ptr(), length) }
}

pub(super) fn log_write(level: u8, event_id: u32, payload: &[u8]) -> i32 {
    let Ok(payload_length) = u32::try_from(payload.len()) else {
        return STATUS_INVALID_ARGUMENT;
    };
    // SAFETY: ABI borrows the checked slice only for this call.
    unsafe { yimi_platform_v1_log_write(level, event_id, payload.as_ptr(), payload_length) }
}

#[cfg(all(feature = "host-mock", test))]
unsafe extern "C" {
    fn yimi_mock_v1_reset();
    fn yimi_mock_v1_storage_power_cycle();
    fn yimi_mock_v1_push_oid(event: *const OidEventV1) -> i32;
    fn yimi_mock_v1_push_audio(event: *const AudioEventV1) -> i32;
    fn yimi_mock_v1_inject_transport(bytes: *const u8, length: u32) -> i32;
    fn yimi_mock_v1_last_transport_write(
        out_bytes: *mut u8,
        capacity: u32,
        out_length: *mut u32,
    ) -> i32;
    fn yimi_mock_v1_last_audio_path(
        out_bytes: *mut u8,
        capacity: u32,
        out_length: *mut u32,
        out_request_id: *mut u32,
    ) -> i32;
}

#[cfg(all(feature = "host-mock", test))]
pub(super) mod mock {
    use super::{AudioEventV1, OidEventV1};

    pub fn reset() {
        // SAFETY: Host mock owns all static state and has no arguments.
        unsafe { super::yimi_mock_v1_reset() };
    }

    pub fn storage_power_cycle() {
        // SAFETY: Host mock only mutates its owned storage buffers under the test lock.
        unsafe { super::yimi_mock_v1_storage_power_cycle() };
    }

    pub fn push_oid(event: &OidEventV1) -> i32 {
        // SAFETY: Mock copies one valid event during this call.
        unsafe { super::yimi_mock_v1_push_oid(event) }
    }

    pub fn push_audio(event: &AudioEventV1) -> i32 {
        // SAFETY: Mock copies one valid-layout event during this call.
        unsafe { super::yimi_mock_v1_push_audio(event) }
    }

    pub fn inject_transport(bytes: &[u8]) -> i32 {
        let Ok(length) = u32::try_from(bytes.len()) else {
            return super::STATUS_INVALID_ARGUMENT;
        };
        // SAFETY: Mock copies the checked slice during this call.
        unsafe { super::yimi_mock_v1_inject_transport(bytes.as_ptr(), length) }
    }

    pub fn last_transport_write(out: &mut [u8], out_length: &mut u32) -> i32 {
        let Ok(capacity) = u32::try_from(out.len()) else {
            return super::STATUS_INVALID_ARGUMENT;
        };
        // SAFETY: Mock writes within the checked output slice.
        unsafe { super::yimi_mock_v1_last_transport_write(out.as_mut_ptr(), capacity, out_length) }
    }

    pub fn last_audio_path(out: &mut [u8], out_length: &mut u32, out_request_id: &mut u32) -> i32 {
        let Ok(capacity) = u32::try_from(out.len()) else {
            return super::STATUS_INVALID_ARGUMENT;
        };
        // SAFETY: Mock writes within the checked output slice and scalar pointers.
        unsafe {
            super::yimi_mock_v1_last_audio_path(
                out.as_mut_ptr(),
                capacity,
                out_length,
                out_request_id,
            )
        }
    }
}
