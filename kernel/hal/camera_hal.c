/**
 * @file camera_hal.c
 * @brief PravahOS Mobile Camera Sensor & Capture Pipeline HAL Implementation.
 *
 * Implements camera device enumeration, multi-buffer capture ring pipelines,
 * real-time NV12 <-> ARGB8888 color space conversion, exposure and gain tuning,
 * and synthetic test pattern synthesis.
 */

#include "kernel/hal/camera.h"
#include "kernel/memory.h"
#include "kernel/string.h"
#include "kernel/pmm.h"
#include "arch/arm64/uart_pl011.h"

/* Frame buffer storage for testing (640x480 NV12 = 460800 bytes; 4 slots = ~1.8MB) */
#define CAMERA_TEST_BUF_WIDTH   (640)
#define CAMERA_TEST_BUF_HEIGHT  (480)
#define CAMERA_TEST_NV12_SIZE   ((CAMERA_TEST_BUF_WIDTH * CAMERA_TEST_BUF_HEIGHT * 3) / 2)

typedef struct {
    camera_sensor_info_t info;
    camera_state_t       state;
    camera_config_t      config;
    uint32_t             current_frame_id;
    uint32_t             head_index;
    uint32_t             tail_index;
    camera_frame_t       frame_pool[CAMERA_MAX_BUFFER_QUEUE];
} camera_device_t;

/* Global Sensor Registry */
static camera_device_t s_sensors[CAMERA_MAX_SENSORS];
static bool s_camera_initialized = false;

/* Static Frame Buffers for Camera 0 (Primary) */
static uint8_t s_cam0_raw_buffers[CAMERA_MAX_BUFFER_QUEUE][CAMERA_TEST_NV12_SIZE] __attribute__((aligned(64)));

/* ========================================================================= */
/* Helper Math & Color Clamping                                              */
/* ========================================================================= */

static inline uint8_t clamp_u8(int32_t val) {
    if (val < 0) return 0;
    if (val > 255) return 255;
    return (uint8_t)val;
}

/* ========================================================================= */
/* HAL Initialization & Sensor Registration                                  */
/* ========================================================================= */

zx_status_t camera_hal_init(void) {
    if (s_camera_initialized) {
        return ZX_OK;
    }

    memset(s_sensors, 0, sizeof(s_sensors));

    /* 1. Register Sensor 0: Primary Back Wide (e.g. Sony IMX890 50MP) */
    s_sensors[CAMERA_ID_BACK_PRIMARY].info.sensor_id = CAMERA_ID_BACK_PRIMARY;
    strncpy(s_sensors[CAMERA_ID_BACK_PRIMARY].info.name, "Primary Wide (IMX890)", CAMERA_NAME_MAX_LEN - 1);
    s_sensors[CAMERA_ID_BACK_PRIMARY].info.max_width = CAMERA_RES_4K_W;
    s_sensors[CAMERA_ID_BACK_PRIMARY].info.max_height = CAMERA_RES_4K_H;
    s_sensors[CAMERA_ID_BACK_PRIMARY].info.supported_formats_mask = (1 << CAMERA_FORMAT_NV12) |
                                                                   (1 << CAMERA_FORMAT_ARGB8888) |
                                                                   (1 << CAMERA_FORMAT_RAW10);
    s_sensors[CAMERA_ID_BACK_PRIMARY].info.max_fps = 60;
    s_sensors[CAMERA_ID_BACK_PRIMARY].info.has_flash = true;
    s_sensors[CAMERA_ID_BACK_PRIMARY].info.has_autofocus = true;
    s_sensors[CAMERA_ID_BACK_PRIMARY].state = CAMERA_STATE_STANDBY;

    /* Initialize Frame Pool for Sensor 0 */
    for (uint32_t b = 0; b < CAMERA_MAX_BUFFER_QUEUE; b++) {
        camera_frame_t *frame = &s_sensors[CAMERA_ID_BACK_PRIMARY].frame_pool[b];
        frame->frame_id = 0;
        frame->width = CAMERA_TEST_BUF_WIDTH;
        frame->height = CAMERA_TEST_BUF_HEIGHT;
        frame->stride = CAMERA_TEST_BUF_WIDTH;
        frame->format = CAMERA_FORMAT_NV12;
        frame->data = s_cam0_raw_buffers[b];
        frame->size_bytes = CAMERA_TEST_NV12_SIZE;
        frame->exposure_time_us = 16666; /* 1/60s */
        frame->iso_gain = 100;
        frame->in_use = false;
    }

    /* 2. Register Sensor 1: Front Selfie Camera */
    s_sensors[CAMERA_ID_FRONT_SELFIE].info.sensor_id = CAMERA_ID_FRONT_SELFIE;
    strncpy(s_sensors[CAMERA_ID_FRONT_SELFIE].info.name, "Front Selfie (OV32B)", CAMERA_NAME_MAX_LEN - 1);
    s_sensors[CAMERA_ID_FRONT_SELFIE].info.max_width = CAMERA_RES_1080P_W;
    s_sensors[CAMERA_ID_FRONT_SELFIE].info.max_height = CAMERA_RES_1080P_H;
    s_sensors[CAMERA_ID_FRONT_SELFIE].info.supported_formats_mask = (1 << CAMERA_FORMAT_NV12) |
                                                                   (1 << CAMERA_FORMAT_ARGB8888);
    s_sensors[CAMERA_ID_FRONT_SELFIE].info.max_fps = 60;
    s_sensors[CAMERA_ID_FRONT_SELFIE].info.has_flash = false;
    s_sensors[CAMERA_ID_FRONT_SELFIE].info.has_autofocus = false;
    s_sensors[CAMERA_ID_FRONT_SELFIE].state = CAMERA_STATE_STANDBY;

    /* 3. Register Sensor 2: Ultra-Wide Auxiliary Camera */
    s_sensors[CAMERA_ID_BACK_ULTRAWIDE].info.sensor_id = CAMERA_ID_BACK_ULTRAWIDE;
    strncpy(s_sensors[CAMERA_ID_BACK_ULTRAWIDE].info.name, "Ultra-Wide (IMX355)", CAMERA_NAME_MAX_LEN - 1);
    s_sensors[CAMERA_ID_BACK_ULTRAWIDE].info.max_width = CAMERA_RES_4K_W;
    s_sensors[CAMERA_ID_BACK_ULTRAWIDE].info.max_height = CAMERA_RES_4K_H;
    s_sensors[CAMERA_ID_BACK_ULTRAWIDE].info.supported_formats_mask = (1 << CAMERA_FORMAT_NV12) |
                                                                     (1 << CAMERA_FORMAT_ARGB8888);
    s_sensors[CAMERA_ID_BACK_ULTRAWIDE].info.max_fps = 30;
    s_sensors[CAMERA_ID_BACK_ULTRAWIDE].info.has_flash = true;
    s_sensors[CAMERA_ID_BACK_ULTRAWIDE].info.has_autofocus = false;
    s_sensors[CAMERA_ID_BACK_ULTRAWIDE].state = CAMERA_STATE_STANDBY;

    s_camera_initialized = true;
    return ZX_OK;
}

zx_status_t camera_get_sensor_count(uint32_t *count) {
    if (!count) return ZX_ERR_INVALID_ARGS;
    if (!s_camera_initialized) return ZX_ERR_UNAVAILABLE;
    *count = CAMERA_MAX_SENSORS;
    return ZX_OK;
}

zx_status_t camera_get_sensor_info(uint32_t sensor_id, camera_sensor_info_t *out_info) {
    if (sensor_id >= CAMERA_MAX_SENSORS || !out_info) return ZX_ERR_INVALID_ARGS;
    if (!s_camera_initialized) return ZX_ERR_UNAVAILABLE;
    memcpy(out_info, &s_sensors[sensor_id].info, sizeof(camera_sensor_info_t));
    return ZX_OK;
}

zx_status_t camera_configure(uint32_t sensor_id, const camera_config_t *config) {
    if (sensor_id >= CAMERA_MAX_SENSORS || !config) return ZX_ERR_INVALID_ARGS;
    if (!s_camera_initialized) return ZX_ERR_UNAVAILABLE;

    camera_device_t *dev = &s_sensors[sensor_id];
    if (dev->state == CAMERA_STATE_STREAMING) {
        return ZX_ERR_BAD_STATE;
    }

    /* Validate resolution bounds against sensor physical limits */
    if (config->width > dev->info.max_width || config->height > dev->info.max_height) {
        return ZX_ERR_OUT_OF_RANGE;
    }

    memcpy(&dev->config, config, sizeof(camera_config_t));
    dev->state = CAMERA_STATE_CONFIGURED;
    return ZX_OK;
}

zx_status_t camera_start_stream(uint32_t sensor_id) {
    if (sensor_id >= CAMERA_MAX_SENSORS) return ZX_ERR_INVALID_ARGS;
    camera_device_t *dev = &s_sensors[sensor_id];

    if (dev->state != CAMERA_STATE_CONFIGURED && dev->state != CAMERA_STATE_STANDBY) {
        return ZX_ERR_BAD_STATE;
    }

    dev->head_index = 0;
    dev->tail_index = 0;
    dev->current_frame_id = 0;
    dev->state = CAMERA_STATE_STREAMING;
    return ZX_OK;
}

zx_status_t camera_stop_stream(uint32_t sensor_id) {
    if (sensor_id >= CAMERA_MAX_SENSORS) return ZX_ERR_INVALID_ARGS;
    camera_device_t *dev = &s_sensors[sensor_id];

    if (dev->state != CAMERA_STATE_STREAMING) {
        return ZX_ERR_BAD_STATE;
    }

    dev->state = CAMERA_STATE_STANDBY;
    return ZX_OK;
}

zx_status_t camera_acquire_frame(uint32_t sensor_id, camera_frame_t **out_frame) {
    if (sensor_id >= CAMERA_MAX_SENSORS || !out_frame) return ZX_ERR_INVALID_ARGS;
    camera_device_t *dev = &s_sensors[sensor_id];

    if (dev->state != CAMERA_STATE_STREAMING) {
        return ZX_ERR_BAD_STATE;
    }

    /* Grab next available buffer in frame queue */
    uint32_t idx = dev->head_index % CAMERA_MAX_BUFFER_QUEUE;
    camera_frame_t *frame = &dev->frame_pool[idx];

    /* Synthesize next captured frame metadata */
    dev->current_frame_id++;
    frame->frame_id = dev->current_frame_id;
    frame->timestamp_ns = dev->current_frame_id * 33333333ULL; /* ~30fps delta */
    frame->in_use = true;

    /* Populate buffer with test pattern for verifiable validation */
    camera_generate_test_pattern(frame, CAMERA_PATTERN_SMPTE_BARS);

    dev->head_index++;
    *out_frame = frame;
    return ZX_OK;
}

zx_status_t camera_release_frame(uint32_t sensor_id, camera_frame_t *frame) {
    if (sensor_id >= CAMERA_MAX_SENSORS || !frame) return ZX_ERR_INVALID_ARGS;
    frame->in_use = false;
    return ZX_OK;
}

zx_status_t camera_set_exposure(uint32_t sensor_id, uint32_t exposure_us, uint32_t iso_gain) {
    if (sensor_id >= CAMERA_MAX_SENSORS) return ZX_ERR_INVALID_ARGS;
    if (exposure_us < 100 || exposure_us > 1000000) return ZX_ERR_OUT_OF_RANGE;
    if (iso_gain < 50 || iso_gain > 6400) return ZX_ERR_OUT_OF_RANGE;

    camera_device_t *dev = &s_sensors[sensor_id];
    dev->config.exposure_time_us = exposure_us;
    dev->config.iso_gain = iso_gain;
    return ZX_OK;
}

zx_status_t camera_get_state(uint32_t sensor_id, camera_state_t *out_state) {
    if (sensor_id >= CAMERA_MAX_SENSORS || !out_state) return ZX_ERR_INVALID_ARGS;
    *out_state = s_sensors[sensor_id].state;
    return ZX_OK;
}

/* ========================================================================= */
/* Synthetic Test Pattern Generator                                          */
/* ========================================================================= */

zx_status_t camera_generate_test_pattern(camera_frame_t *frame, camera_test_pattern_t pattern) {
    if (!frame || !frame->data) return ZX_ERR_INVALID_ARGS;

    uint32_t w = frame->width;
    uint32_t h = frame->height;
    uint8_t *y_plane = frame->data;
    uint8_t *uv_plane = frame->data + (w * h);

    if (pattern == CAMERA_PATTERN_SMPTE_BARS) {
        /* Standard 8 SMPTE Colors in YUV (Y, U, V) */
        static const uint8_t smpte_yuv[8][3] = {
            { 235, 128, 128 }, /* White   */
            { 210,  16, 146 }, /* Yellow  */
            { 170, 166,  16 }, /* Cyan    */
            { 145,  54,  34 }, /* Green   */
            { 106, 202, 222 }, /* Magenta */
            {  81,  90, 240 }, /* Red     */
            {  41, 240, 110 }, /* Blue    */
            {  16, 128, 128 }  /* Black   */
        };

        uint32_t bar_width = w / 8;
        if (bar_width == 0) bar_width = 1;

        /* Fill Y plane */
        for (uint32_t r = 0; r < h; r++) {
            for (uint32_t c = 0; c < w; c++) {
                uint32_t bar = c / bar_width;
                if (bar > 7) bar = 7;
                y_plane[r * w + c] = smpte_yuv[bar][0];
            }
        }

        /* Fill Interleaved UV Plane for NV12 (U, V pairs for 2x2 blocks) */
        uint32_t uv_height = h / 2;
        uint32_t uv_width = w / 2;
        for (uint32_t r = 0; r < uv_height; r++) {
            for (uint32_t c = 0; c < uv_width; c++) {
                uint32_t bar = (c * 2) / bar_width;
                if (bar > 7) bar = 7;
                uint32_t uv_idx = (r * w) + (c * 2);
                uv_plane[uv_idx + 0] = smpte_yuv[bar][1]; /* U */
                uv_plane[uv_idx + 1] = smpte_yuv[bar][2]; /* V */
            }
        }
    } else {
        /* Grayscale gradient */
        for (uint32_t r = 0; r < h; r++) {
            for (uint32_t c = 0; c < w; c++) {
                y_plane[r * w + c] = (uint8_t)((c * 255) / w);
            }
        }
        /* Neutral UV = 128 */
        memset(uv_plane, 128, (w * h) / 2);
    }

    return ZX_OK;
}

/* ========================================================================= */
/* NV12 <-> ARGB8888 Color Space Converters                                  */
/* ========================================================================= */

zx_status_t camera_nv12_to_argb8888(const uint8_t *y_plane,
                                    const uint8_t *uv_plane,
                                    uint32_t width,
                                    uint32_t height,
                                    uint32_t *out_argb) {
    if (!y_plane || !uv_plane || !out_argb) return ZX_ERR_INVALID_ARGS;
    if (width == 0 || height == 0 || (width & 1) || (height & 1)) return ZX_ERR_INVALID_ARGS;

    for (uint32_t y = 0; y < height; y++) {
        uint32_t uv_row = y / 2;
        for (uint32_t x = 0; x < width; x++) {
            uint32_t uv_col = (x / 2) * 2;
            int32_t Y = (int32_t)y_plane[y * width + x] - 16;
            int32_t U = (int32_t)uv_plane[uv_row * width + uv_col] - 128;
            int32_t V = (int32_t)uv_plane[uv_row * width + uv_col + 1] - 128;

            if (Y < 0) Y = 0;

            int32_t r = (298 * Y + 409 * V + 128) >> 8;
            int32_t g = (298 * Y - 100 * U - 208 * V + 128) >> 8;
            int32_t b = (298 * Y + 516 * U + 128) >> 8;

            uint8_t R = clamp_u8(r);
            uint8_t G = clamp_u8(g);
            uint8_t B = clamp_u8(b);

            out_argb[y * width + x] = (0xFFU << 24) | ((uint32_t)R << 16) | ((uint32_t)G << 8) | (uint32_t)B;
        }
    }

    return ZX_OK;
}

zx_status_t camera_argb8888_to_nv12(const uint32_t *in_argb,
                                    uint32_t width,
                                    uint32_t height,
                                    uint8_t *out_y,
                                    uint8_t *out_uv) {
    if (!in_argb || !out_y || !out_uv) return ZX_ERR_INVALID_ARGS;
    if (width == 0 || height == 0 || (width & 1) || (height & 1)) return ZX_ERR_INVALID_ARGS;

    for (uint32_t y = 0; y < height; y++) {
        for (uint32_t x = 0; x < width; x++) {
            uint32_t argb = in_argb[y * width + x];
            int32_t r = (int32_t)((argb >> 16) & 0xFF);
            int32_t g = (int32_t)((argb >> 8) & 0xFF);
            int32_t b = (int32_t)(argb & 0xFF);

            int32_t Y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
            out_y[y * width + x] = clamp_u8(Y);

            /* Subsample UV on even (x, y) */
            if ((y & 1) == 0 && (x & 1) == 0) {
                int32_t U = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                int32_t V = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;

                uint32_t uv_idx = ((y / 2) * width) + x;
                out_uv[uv_idx + 0] = clamp_u8(U);
                out_uv[uv_idx + 1] = clamp_u8(V);
            }
        }
    }

    return ZX_OK;
}
