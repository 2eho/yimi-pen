#ifndef YIMI_PLATFORM_V1_H
#define YIMI_PLATFORM_V1_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define YIMI_PLATFORM_ABI_VERSION 1u
#define YIMI_PLATFORM_TIME_UNAVAILABLE UINT64_MAX
#define YIMI_PLATFORM_MAX_PATH_BYTES 240u

#define YIMI_CAP_OID_POLL (UINT64_C(1) << 0)
#define YIMI_CAP_AUDIO_PATH (UINT64_C(1) << 1)
#define YIMI_CAP_STORAGE_RANDOM_IO (UINT64_C(1) << 2)
#define YIMI_CAP_DEVICE_LINK_STREAM (UINT64_C(1) << 3)
#define YIMI_CAP_MONOTONIC_US (UINT64_C(1) << 4)

typedef enum yimi_status_v1 {
  YIMI_STATUS_OK = 0,
  YIMI_STATUS_EMPTY = 1,
  YIMI_STATUS_INVALID_ARGUMENT = -1,
  YIMI_STATUS_IO = -2,
  YIMI_STATUS_UNSUPPORTED = -3,
  YIMI_STATUS_BUSY = -4,
  YIMI_STATUS_ABI_MISMATCH = -5
} yimi_status_v1;

typedef enum yimi_oid_status_v1 {
  YIMI_OID_VALID = 0,
  YIMI_OID_LOW_QUALITY = 1,
  YIMI_OID_NO_CODE = 2,
  YIMI_OID_SENSOR_FAULT = 3
} yimi_oid_status_v1;

typedef enum yimi_audio_event_kind_v1 {
  YIMI_AUDIO_STARTED = 0,
  YIMI_AUDIO_ENDED = 1,
  YIMI_AUDIO_STOPPED = 2,
  YIMI_AUDIO_ERROR = 3
} yimi_audio_event_kind_v1;

typedef enum yimi_audio_time_class_v1 {
  YIMI_AUDIO_TIME_REQUEST_ACCEPTED = 0,
  YIMI_AUDIO_TIME_DECODER_FIRST_PCM = 1,
  YIMI_AUDIO_TIME_DMA_FIRST_BUFFER = 2,
  YIMI_AUDIO_TIME_ELECTRICAL_OUTPUT = 3
} yimi_audio_time_class_v1;

#define YIMI_OID_HAS_CODE (1u << 0)
#define YIMI_OID_HAS_SENSOR_AT (1u << 1)
#define YIMI_OID_HAS_READY_AT (1u << 2)
#define YIMI_OID_HAS_QUALITY (1u << 3)

typedef struct yimi_platform_info_v1 {
  uint32_t abi_version;
  uint32_t info_size;
  uint32_t oid_event_size;
  uint32_t audio_event_size;
  uint64_t capability_bits;
  uint32_t max_path_bytes;
  /* Maximum bytes accepted or returned by one transport call. */
  uint32_t transport_mtu;
  uint32_t audio_start_time_class;
  uint32_t oid_queue_stats_size;
  uint32_t storage_write_alignment;
  uint32_t storage_max_transfer;
  uint32_t storage_atomic_write_bytes;
  uint32_t audio_queue_stats_size;
} yimi_platform_info_v1;

typedef struct yimi_oid_event_v1 {
  uint64_t physical_code;
  uint64_t event_at_us;
  uint64_t sensor_at_us;
  uint64_t ready_at_us;
  uint32_t sequence;
  uint32_t dropped_events;
  uint16_t quality;
  uint8_t status;
  uint8_t flags;
  uint32_t reserved0;
} yimi_oid_event_v1;

typedef struct yimi_audio_event_v1 {
  uint32_t request_id;
  uint8_t kind;
  uint8_t timestamp_class;
  uint16_t flags;
  uint64_t at_us;
  int32_t error_code;
  uint32_t sequence;
  uint32_t dropped_events;
  uint32_t reserved0;
} yimi_audio_event_v1;

typedef struct yimi_oid_queue_stats_v1 {
  uint32_t next_sequence;
  uint32_t dropped_events;
  uint32_t queued_events;
  uint32_t reserved0;
} yimi_oid_queue_stats_v1;

typedef struct yimi_audio_queue_stats_v1 {
  uint32_t next_sequence;
  uint32_t dropped_events;
  uint32_t queued_events;
  uint32_t reserved0;
} yimi_audio_queue_stats_v1;

#if defined(__cplusplus)
#define YIMI_ABI_STATIC_ASSERT(condition, message)                             \
  static_assert(condition, message)
#define YIMI_ABI_ALIGNOF(type) alignof(type)
#else
#define YIMI_ABI_STATIC_ASSERT(condition, message)                             \
  _Static_assert(condition, message)
#define YIMI_ABI_ALIGNOF(type) _Alignof(type)
#endif

YIMI_ABI_STATIC_ASSERT(sizeof(yimi_platform_info_v1) == 56u,
                       "yimi_platform_info_v1 size drift");
YIMI_ABI_STATIC_ASSERT(YIMI_ABI_ALIGNOF(yimi_platform_info_v1) ==
                           YIMI_ABI_ALIGNOF(uint64_t),
                       "yimi_platform_info_v1 alignment drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_platform_info_v1, capability_bits) == 16u,
                       "platform capability_bits offset drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_platform_info_v1,
                                audio_start_time_class) == 32u,
                       "platform audio_start_time_class offset drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_platform_info_v1,
                                storage_atomic_write_bytes) == 48u,
                       "platform storage_atomic_write_bytes offset drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_platform_info_v1,
                                audio_queue_stats_size) == 52u,
                       "platform audio_queue_stats_size offset drift");

YIMI_ABI_STATIC_ASSERT(sizeof(yimi_oid_event_v1) == 48u,
                       "yimi_oid_event_v1 size drift");
YIMI_ABI_STATIC_ASSERT(YIMI_ABI_ALIGNOF(yimi_oid_event_v1) ==
                           YIMI_ABI_ALIGNOF(uint64_t),
                       "yimi_oid_event_v1 alignment drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_oid_event_v1, event_at_us) == 8u,
                       "OID event_at_us offset drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_oid_event_v1, sequence) == 32u,
                       "OID sequence offset drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_oid_event_v1, quality) == 40u,
                       "OID quality offset drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_oid_event_v1, reserved0) == 44u,
                       "OID reserved0 offset drift");

YIMI_ABI_STATIC_ASSERT(sizeof(yimi_audio_event_v1) == 32u,
                       "yimi_audio_event_v1 size drift");
YIMI_ABI_STATIC_ASSERT(YIMI_ABI_ALIGNOF(yimi_audio_event_v1) ==
                           YIMI_ABI_ALIGNOF(uint64_t),
                       "yimi_audio_event_v1 alignment drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_audio_event_v1, at_us) == 8u,
                       "audio at_us offset drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_audio_event_v1, sequence) == 20u,
                       "audio sequence offset drift");
YIMI_ABI_STATIC_ASSERT(offsetof(yimi_audio_event_v1, reserved0) == 28u,
                       "audio reserved0 offset drift");

YIMI_ABI_STATIC_ASSERT(sizeof(yimi_oid_queue_stats_v1) == 16u,
                       "yimi_oid_queue_stats_v1 size drift");
YIMI_ABI_STATIC_ASSERT(sizeof(yimi_audio_queue_stats_v1) == 16u,
                       "yimi_audio_queue_stats_v1 size drift");

#undef YIMI_ABI_STATIC_ASSERT
#undef YIMI_ABI_ALIGNOF

/*
 * ABI rules:
 * - acquire is safe under competing startup callers and uses a provider-owned
 *   atomic or critical section. After success, exactly one Rust-owned task
 *   issues calls until release; calls never originate from an ISR.
 * - The C layer captures ISR timestamps and queues events for poll functions.
 * - A producer fully writes an event before publishing the queue index with a
 *   release operation; the consumer reads the index with acquire semantics, or
 *   both sides use the same interrupt-safe critical section.
 * - OID sequence increments for every observed or dropped event. The wrapping
 *   cumulative dropped_events counter is also available through queue stats.
 * - OID event_at_us is mandatory. sensor_at_us and ready_at_us equal
 *   YIMI_PLATFORM_TIME_UNAVAILABLE exactly when their presence flag is clear.
 * - audio_start_time_class states what STARTED.at_us measures; request accepted
 *   is diagnostic and does not prove PCM, electrical, or acoustic output.
 * - Input buffers are borrowed only for the duration of a call; async work
 * copies them.
 * - Output buffers are written up to the supplied capacity.
 * - BUSY, INVALID_ARGUMENT and UNSUPPORTED have no observable side effects.
 * - int32_t functions return yimi_status_v1; positive EMPTY is not a fault.
 * - C++ exceptions, longjmp and callbacks/re-entry do not cross this ABI.
 */
int32_t yimi_platform_v1_acquire(void);
int32_t yimi_platform_v1_release(void);
int32_t yimi_platform_v1_get_info(yimi_platform_info_v1 *out_info);
/* Returns YIMI_PLATFORM_TIME_UNAVAILABLE on a provider contract failure. */
uint64_t yimi_platform_v1_now_us(void);

int32_t yimi_platform_v1_poll_oid(yimi_oid_event_v1 *out_event);
int32_t yimi_platform_v1_oid_queue_stats(yimi_oid_queue_stats_v1 *out_stats);

int32_t yimi_platform_v1_audio_start(const uint8_t *snapshot_relative_path,
                                     uint32_t path_length, uint32_t request_id);
int32_t yimi_platform_v1_audio_stop(uint32_t request_id);
int32_t yimi_platform_v1_poll_audio(yimi_audio_event_v1 *out_event);
int32_t
yimi_platform_v1_audio_queue_stats(yimi_audio_queue_stats_v1 *out_stats);

int32_t yimi_platform_v1_storage_capacity(uint64_t *out_bytes);
int32_t yimi_platform_v1_storage_read(uint64_t offset, uint8_t *out_bytes,
                                      uint32_t length);
int32_t yimi_platform_v1_storage_write(uint64_t offset, const uint8_t *bytes,
                                       uint32_t length);
/*
 * write OK means all bytes were accepted. sync OK means every preceding write
 * remains readable after a subsequent power loss or reset.
 */
int32_t yimi_platform_v1_storage_sync(void);

/* Byte-stream read may return a prefix and keeps remaining bytes queued. */
int32_t yimi_platform_v1_transport_read(uint8_t *out_bytes, uint32_t capacity,
                                        uint32_t *out_length);
int32_t yimi_platform_v1_transport_write(const uint8_t *bytes, uint32_t length);

int32_t yimi_platform_v1_log_write(uint8_t level, uint32_t event_id,
                                   const uint8_t *payload,
                                   uint32_t payload_length);

#ifdef __cplusplus
}
#endif

#endif
