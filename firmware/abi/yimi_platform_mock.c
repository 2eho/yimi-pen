#include "yimi_platform_mock.h"

#include <stdatomic.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>

#if defined(_MSC_VER)
#define YIMI_STATIC_ASSERT(condition, message) static_assert(condition, message)
#else
#define YIMI_STATIC_ASSERT(condition, message)                                 \
  _Static_assert(condition, message)
#endif

YIMI_STATIC_ASSERT(sizeof(yimi_platform_info_v1) == 56u,
                   "yimi_platform_info_v1 ABI drift");
YIMI_STATIC_ASSERT(sizeof(yimi_oid_event_v1) == 48u,
                   "yimi_oid_event_v1 ABI drift");
YIMI_STATIC_ASSERT(sizeof(yimi_audio_event_v1) == 32u,
                   "yimi_audio_event_v1 ABI drift");
YIMI_STATIC_ASSERT(sizeof(yimi_oid_queue_stats_v1) == 16u,
                   "yimi_oid_queue_stats_v1 ABI drift");
YIMI_STATIC_ASSERT(sizeof(yimi_audio_queue_stats_v1) == 16u,
                   "yimi_audio_queue_stats_v1 ABI drift");

#define YIMI_MOCK_QUEUE_CAPACITY 8u
#define YIMI_MOCK_STORAGE_BYTES 4096u
#define YIMI_MOCK_TRANSPORT_BYTES 1024u

static yimi_oid_event_v1 g_oid_queue[YIMI_MOCK_QUEUE_CAPACITY];
static uint32_t g_oid_head;
static uint32_t g_oid_count;
static uint32_t g_oid_next_sequence;
static uint32_t g_oid_dropped_events;

static yimi_audio_event_v1 g_audio_queue[YIMI_MOCK_QUEUE_CAPACITY];
static uint32_t g_audio_head;
static uint32_t g_audio_count;
static uint32_t g_audio_next_sequence;
static uint32_t g_audio_dropped_events;

static uint8_t g_storage_working[YIMI_MOCK_STORAGE_BYTES];
static uint8_t g_storage_durable[YIMI_MOCK_STORAGE_BYTES];
static uint8_t g_transport_in[YIMI_MOCK_TRANSPORT_BYTES];
static uint32_t g_transport_in_length;
static uint8_t g_transport_out[YIMI_MOCK_TRANSPORT_BYTES];
static uint32_t g_transport_out_length;
static uint8_t g_audio_path[YIMI_PLATFORM_MAX_PATH_BYTES];
static uint32_t g_audio_path_length;
static uint32_t g_audio_request_id;
static uint64_t g_now_us;
static atomic_bool g_acquired = ATOMIC_VAR_INIT(false);

static int yimi_mock_path_is_safe(const uint8_t *path, uint32_t length) {
  uint32_t index;
  uint32_t segment_start = 0u;

  if (path == NULL || length == 0u || length > YIMI_PLATFORM_MAX_PATH_BYTES) {
    return 0;
  }
  if (path[0] == '/' || path[0] == '\\') {
    return 0;
  }
  if (length >= 2u &&
      ((path[0] >= 'A' && path[0] <= 'Z') ||
       (path[0] >= 'a' && path[0] <= 'z')) &&
      path[1] == ':') {
    return 0;
  }
  for (index = 0u; index <= length; ++index) {
    const int at_end = index == length;
    if (!at_end) {
      const uint8_t byte = path[index];
      const int ascii_alphanumeric = (byte >= 'A' && byte <= 'Z') ||
                                     (byte >= 'a' && byte <= 'z') ||
                                     (byte >= '0' && byte <= '9');
      if (!ascii_alphanumeric && byte != '.' && byte != '_' && byte != '-' &&
          byte != '/') {
        return 0;
      }
    }
    if (at_end || path[index] == '/') {
      const uint32_t segment_length = index - segment_start;
      if (segment_length == 0u) {
        return 0;
      }
      if ((segment_length == 1u && path[segment_start] == '.') ||
          (segment_length == 2u && path[segment_start] == '.' &&
           path[segment_start + 1u] == '.')) {
        return 0;
      }
      segment_start = index + 1u;
    }
  }
  return 1;
}

static int32_t yimi_mock_push_audio(const yimi_audio_event_v1 *event) {
  uint32_t tail;
  if (event == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (g_audio_count >= YIMI_MOCK_QUEUE_CAPACITY) {
    return YIMI_STATUS_BUSY;
  }
  tail = (g_audio_head + g_audio_count) % YIMI_MOCK_QUEUE_CAPACITY;
  g_audio_queue[tail] = *event;
  g_audio_count += 1u;
  g_audio_next_sequence = event->sequence + 1u;
  g_audio_dropped_events = event->dropped_events;
  return YIMI_STATUS_OK;
}

void yimi_mock_v1_reset(void) {
  memset(g_oid_queue, 0, sizeof(g_oid_queue));
  memset(g_audio_queue, 0, sizeof(g_audio_queue));
  memset(g_storage_working, 0, sizeof(g_storage_working));
  memset(g_storage_durable, 0, sizeof(g_storage_durable));
  memset(g_transport_in, 0, sizeof(g_transport_in));
  memset(g_transport_out, 0, sizeof(g_transport_out));
  memset(g_audio_path, 0, sizeof(g_audio_path));
  g_oid_head = 0u;
  g_oid_count = 0u;
  g_oid_next_sequence = 0u;
  g_oid_dropped_events = 0u;
  g_audio_head = 0u;
  g_audio_count = 0u;
  g_audio_next_sequence = 0u;
  g_audio_dropped_events = 0u;
  g_transport_in_length = 0u;
  g_transport_out_length = 0u;
  g_audio_path_length = 0u;
  g_audio_request_id = 0u;
  g_now_us = UINT64_C(1000000);
}

int32_t yimi_platform_v1_acquire(void) {
  bool expected = false;
  if (!atomic_compare_exchange_strong_explicit(&g_acquired, &expected, true,
                                               memory_order_acq_rel,
                                               memory_order_acquire)) {
    return YIMI_STATUS_BUSY;
  }
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_release(void) {
  atomic_store_explicit(&g_acquired, false, memory_order_release);
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_get_info(yimi_platform_info_v1 *out_info) {
  if (out_info == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  out_info->abi_version = YIMI_PLATFORM_ABI_VERSION;
  out_info->info_size = (uint32_t)sizeof(yimi_platform_info_v1);
  out_info->oid_event_size = (uint32_t)sizeof(yimi_oid_event_v1);
  out_info->audio_event_size = (uint32_t)sizeof(yimi_audio_event_v1);
  out_info->capability_bits =
      YIMI_CAP_OID_POLL | YIMI_CAP_AUDIO_PATH | YIMI_CAP_STORAGE_RANDOM_IO |
      YIMI_CAP_DEVICE_LINK_STREAM | YIMI_CAP_MONOTONIC_US;
  out_info->max_path_bytes = YIMI_PLATFORM_MAX_PATH_BYTES;
  out_info->transport_mtu = YIMI_MOCK_TRANSPORT_BYTES;
  out_info->audio_start_time_class = YIMI_AUDIO_TIME_REQUEST_ACCEPTED;
  out_info->oid_queue_stats_size = (uint32_t)sizeof(yimi_oid_queue_stats_v1);
  out_info->storage_write_alignment = 1u;
  out_info->storage_max_transfer = YIMI_MOCK_STORAGE_BYTES;
  out_info->storage_atomic_write_bytes = 1u;
  out_info->audio_queue_stats_size =
      (uint32_t)sizeof(yimi_audio_queue_stats_v1);
  return YIMI_STATUS_OK;
}

uint64_t yimi_platform_v1_now_us(void) {
  const uint64_t result = g_now_us;
  g_now_us += UINT64_C(10);
  return result;
}

int32_t yimi_mock_v1_push_oid(const yimi_oid_event_v1 *event) {
  uint32_t tail;
  if (event == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (g_oid_count >= YIMI_MOCK_QUEUE_CAPACITY) {
    g_oid_next_sequence += 1u;
    g_oid_dropped_events += 1u;
    return YIMI_STATUS_BUSY;
  }
  tail = (g_oid_head + g_oid_count) % YIMI_MOCK_QUEUE_CAPACITY;
  g_oid_queue[tail] = *event;
  g_oid_count += 1u;
  g_oid_next_sequence = event->sequence + 1u;
  g_oid_dropped_events = event->dropped_events;
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_poll_oid(yimi_oid_event_v1 *out_event) {
  if (out_event == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (g_oid_count == 0u) {
    return YIMI_STATUS_EMPTY;
  }
  *out_event = g_oid_queue[g_oid_head];
  g_oid_head = (g_oid_head + 1u) % YIMI_MOCK_QUEUE_CAPACITY;
  g_oid_count -= 1u;
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_oid_queue_stats(yimi_oid_queue_stats_v1 *out_stats) {
  if (out_stats == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  out_stats->next_sequence = g_oid_next_sequence;
  out_stats->dropped_events = g_oid_dropped_events;
  out_stats->queued_events = g_oid_count;
  out_stats->reserved0 = 0u;
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_audio_start(const uint8_t *snapshot_relative_path,
                                     uint32_t path_length,
                                     uint32_t request_id) {
  yimi_audio_event_v1 event;
  if (!yimi_mock_path_is_safe(snapshot_relative_path, path_length)) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (g_audio_count >= YIMI_MOCK_QUEUE_CAPACITY) {
    return YIMI_STATUS_BUSY;
  }
  memset(&event, 0, sizeof(event));
  event.request_id = request_id;
  event.kind = (uint8_t)YIMI_AUDIO_STARTED;
  event.timestamp_class = (uint8_t)YIMI_AUDIO_TIME_REQUEST_ACCEPTED;
  event.at_us = yimi_platform_v1_now_us();
  event.sequence = g_audio_next_sequence;
  event.dropped_events = g_audio_dropped_events;
  if (yimi_mock_push_audio(&event) != YIMI_STATUS_OK) {
    return YIMI_STATUS_BUSY;
  }
  memcpy(g_audio_path, snapshot_relative_path, path_length);
  g_audio_path_length = path_length;
  g_audio_request_id = request_id;
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_audio_stop(uint32_t request_id) {
  yimi_audio_event_v1 event;
  if (g_audio_count >= YIMI_MOCK_QUEUE_CAPACITY) {
    return YIMI_STATUS_BUSY;
  }
  memset(&event, 0, sizeof(event));
  event.request_id = request_id;
  event.kind = (uint8_t)YIMI_AUDIO_STOPPED;
  event.timestamp_class = (uint8_t)YIMI_AUDIO_TIME_REQUEST_ACCEPTED;
  event.at_us = yimi_platform_v1_now_us();
  event.sequence = g_audio_next_sequence;
  event.dropped_events = g_audio_dropped_events;
  return yimi_mock_push_audio(&event);
}

int32_t yimi_platform_v1_poll_audio(yimi_audio_event_v1 *out_event) {
  if (out_event == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (g_audio_count == 0u) {
    return YIMI_STATUS_EMPTY;
  }
  *out_event = g_audio_queue[g_audio_head];
  g_audio_head = (g_audio_head + 1u) % YIMI_MOCK_QUEUE_CAPACITY;
  g_audio_count -= 1u;
  return YIMI_STATUS_OK;
}

int32_t
yimi_platform_v1_audio_queue_stats(yimi_audio_queue_stats_v1 *out_stats) {
  if (out_stats == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  out_stats->next_sequence = g_audio_next_sequence;
  out_stats->dropped_events = g_audio_dropped_events;
  out_stats->queued_events = g_audio_count;
  out_stats->reserved0 = 0u;
  return YIMI_STATUS_OK;
}

int32_t yimi_mock_v1_push_audio(const yimi_audio_event_v1 *event) {
  if (event == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (g_audio_count >= YIMI_MOCK_QUEUE_CAPACITY) {
    g_audio_next_sequence += 1u;
    g_audio_dropped_events += 1u;
    return YIMI_STATUS_BUSY;
  }
  return yimi_mock_push_audio(event);
}

int32_t yimi_mock_v1_last_audio_path(uint8_t *out_bytes, uint32_t capacity,
                                     uint32_t *out_length,
                                     uint32_t *out_request_id) {
  if (out_bytes == NULL || out_length == NULL || out_request_id == NULL ||
      capacity < g_audio_path_length) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  memcpy(out_bytes, g_audio_path, g_audio_path_length);
  *out_length = g_audio_path_length;
  *out_request_id = g_audio_request_id;
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_storage_capacity(uint64_t *out_bytes) {
  if (out_bytes == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  *out_bytes = YIMI_MOCK_STORAGE_BYTES;
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_storage_read(uint64_t offset, uint8_t *out_bytes,
                                      uint32_t length) {
  if ((length > 0u && out_bytes == NULL) || offset > YIMI_MOCK_STORAGE_BYTES ||
      length > YIMI_MOCK_STORAGE_BYTES - offset) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (length > 0u) {
    memcpy(out_bytes, &g_storage_working[(size_t)offset], length);
  }
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_storage_write(uint64_t offset, const uint8_t *bytes,
                                       uint32_t length) {
  if ((length > 0u && bytes == NULL) || offset > YIMI_MOCK_STORAGE_BYTES ||
      length > YIMI_MOCK_STORAGE_BYTES - offset) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (length > 0u) {
    memcpy(&g_storage_working[(size_t)offset], bytes, length);
  }
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_storage_sync(void) {
  memcpy(g_storage_durable, g_storage_working, sizeof(g_storage_working));
  return YIMI_STATUS_OK;
}

void yimi_mock_v1_storage_power_cycle(void) {
  memcpy(g_storage_working, g_storage_durable, sizeof(g_storage_working));
}

int32_t yimi_mock_v1_inject_transport(const uint8_t *bytes, uint32_t length) {
  if ((length > 0u && bytes == NULL) || length > YIMI_MOCK_TRANSPORT_BYTES) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (length > 0u) {
    memcpy(g_transport_in, bytes, length);
  }
  g_transport_in_length = length;
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_transport_read(uint8_t *out_bytes, uint32_t capacity,
                                        uint32_t *out_length) {
  uint32_t returned_length;
  if (out_bytes == NULL || out_length == NULL || capacity == 0u) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (g_transport_in_length == 0u) {
    *out_length = 0u;
    return YIMI_STATUS_EMPTY;
  }
  returned_length =
      capacity < g_transport_in_length ? capacity : g_transport_in_length;
  memcpy(out_bytes, g_transport_in, returned_length);
  *out_length = returned_length;
  g_transport_in_length -= returned_length;
  if (g_transport_in_length > 0u) {
    memmove(g_transport_in, &g_transport_in[returned_length],
            g_transport_in_length);
  }
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_transport_write(const uint8_t *bytes,
                                         uint32_t length) {
  if ((length > 0u && bytes == NULL) || length > YIMI_MOCK_TRANSPORT_BYTES) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  if (length > 0u) {
    memcpy(g_transport_out, bytes, length);
  }
  g_transport_out_length = length;
  return YIMI_STATUS_OK;
}

int32_t yimi_mock_v1_last_transport_write(uint8_t *out_bytes, uint32_t capacity,
                                          uint32_t *out_length) {
  if (out_bytes == NULL || out_length == NULL ||
      capacity < g_transport_out_length) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  memcpy(out_bytes, g_transport_out, g_transport_out_length);
  *out_length = g_transport_out_length;
  return YIMI_STATUS_OK;
}

int32_t yimi_platform_v1_log_write(uint8_t level, uint32_t event_id,
                                   const uint8_t *payload,
                                   uint32_t payload_length) {
  (void)level;
  (void)event_id;
  if (payload_length > 0u && payload == NULL) {
    return YIMI_STATUS_INVALID_ARGUMENT;
  }
  return YIMI_STATUS_OK;
}
