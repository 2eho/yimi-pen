#ifndef YIMI_PLATFORM_MOCK_H
#define YIMI_PLATFORM_MOCK_H

#include "yimi_platform_v1.h"

#ifdef __cplusplus
extern "C" {
#endif

void yimi_mock_v1_reset(void);
void yimi_mock_v1_storage_power_cycle(void);
int32_t yimi_mock_v1_push_oid(const yimi_oid_event_v1 *event);
int32_t yimi_mock_v1_push_audio(const yimi_audio_event_v1 *event);
int32_t yimi_mock_v1_inject_transport(const uint8_t *bytes, uint32_t length);
int32_t yimi_mock_v1_last_transport_write(uint8_t *out_bytes, uint32_t capacity,
                                          uint32_t *out_length);
int32_t yimi_mock_v1_last_audio_path(uint8_t *out_bytes, uint32_t capacity,
                                     uint32_t *out_length,
                                     uint32_t *out_request_id);

#ifdef __cplusplus
}
#endif

#endif
