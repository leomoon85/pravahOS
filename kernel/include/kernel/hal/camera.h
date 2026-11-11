/**
 * @file camera.h
 * @brief PravahOS Mobile Camera Sensor & Capture Pipeline HAL.
 *
 * Implements camera sensor stream abstraction, multi-frame capture queue,
 * format conversion (NV12 YUV420 semi-planar <-> ARGB8888 / RGB888),
 * exposure/ISO tuning, resolution modes, and synthetic test-pattern generation.
 */

#ifndef PRAVAH_KERNEL_HAL_CAMERA_H
#define PRAVAH_KERNEL_HAL_CAMERA_H

#include "kernel/types.h"
#include "kernel/memory.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* Camera Sensor Identifiers & Constants                                     */
/* ========================================================================= */

#define CAMERA_ID_BACK_PRIMARY      (0)  /**< Main wide sensor (e.g. 50MP / 1080p preview) */
#define CAMERA_ID_FRONT_SELFIE      (1)  /**< Front-facing selfie camera */
#define CAMERA_ID_BACK_ULTRAWIDE    (2)  /**< Ultra-wide secondary sensor */
#define CAMERA_MAX_SENSORS          (3)  /**< Total sensor count supported */

#define CAMERA_MAX_BUFFER_QUEUE     (4)  /**< Ping-pong / multi-buffer ring count */
#define CAMERA_NAME_MAX_LEN         (32)

/* ========================================================================= */
/* Supported Color Formats                                                   */
/* ========================================================================= */

#define CAMERA_FORMAT_NV12          (0x01) /**< YUV420 semi-planar (Y plane + interleaved UV) */
#define CAMERA_FORMAT_RGB888        (0x02) /**< 24-bit packed RGB */
#define CAMERA_FORMAT_ARGB8888      (0x03) /**< 32-bit ARGB (display compositor native) */
#define CAMERA_FORMAT_RAW10         (0x04) /**< 10-bit Raw Bayer */

/* ========================================================================= */
/* Standard Resolution Presets                                               */
/* ========================================================================= */

#define CAMERA_RES_VGA_W            (640)
#define CAMERA_RES_VGA_H            (480)

#define CAMERA_RES_720P_W           (1280)
#define CAMERA_RES_720P_H           (720)

#define CAMERA_RES_1080P_W          (1920)
#define CAMERA_RES_1080P_H          (1080)

#define CAMERA_RES_4K_W             (3840)
#define CAMERA_RES_4K_H             (2160)

/* ========================================================================= */
/* Camera Stream & Device States                                             */
/* ========================================================================= */

typedef enum {
    CAMERA_STATE_UNINITIALIZED = 0,
    CAMERA_STATE_STANDBY       = 1,
    CAMERA_STATE_CONFIGURED    = 2,
    CAMERA_STATE_STREAMING     = 3,
    CAMERA_STATE_ERROR         = 4
} camera_state_t;

/* White balance modes */
typedef enum {
    CAMERA_WB_AUTO        = 0,
    CAMERA_WB_DAYLIGHT    = 1,
    CAMERA_WB_CLOUDY      = 2,
    CAMERA_WB_INCANDESCENT= 3,
    CAMERA_WB_FLUORESCENT = 4
} camera_white_balance_t;

/* Synthetic test patterns for bare-metal & headless validation */
typedef enum {
    CAMERA_PATTERN_SMPTE_BARS  = 0,
    CAMERA_PATTERN_GRADIENT    = 1,
    CAMERA_PATTERN_SOLID_COLOR = 2
} camera_test_pattern_t;

/* ========================================================================= */
/* Camera Data Structures                                                    */
/* ========================================================================= */

/**
 * @brief Individual frame capture descriptor.
 */
typedef struct {
    uint32_t frame_id;          /**< Monotonically increasing sequence number */
    uint64_t timestamp_ns;      /**< Hardware acquisition timestamp */
    uint32_t width;             /**< Frame width in pixels */
    uint32_t height;            /**< Frame height in pixels */
    uint32_t stride;            /**< Line stride in bytes */
    uint32_t format;            /**< CAMERA_FORMAT_* */
    uint8_t *data;              /**< Physical or mapped virtual buffer pointer */
    size_t   size_bytes;        /**< Total payload size in bytes */
    uint32_t exposure_time_us;  /**< Effective exposure time in microseconds */
    uint32_t iso_gain;          /**< Effective sensor gain (e.g. 100 - 3200) */
    bool     in_use;            /**< Buffer allocation lock flag */
} camera_frame_t;

/**
 * @brief Camera stream runtime configuration.
 */
typedef struct {
    uint32_t sensor_id;
    uint32_t width;
    uint32_t height;
    uint32_t format;
    uint32_t target_fps;        /**< Target frame rate (e.g. 30, 60) */
    uint32_t exposure_time_us;  /**< Initial exposure (1000 - 100000 us) */
    uint32_t iso_gain;          /**< Initial ISO (100 - 3200) */
    camera_white_balance_t wb;  /**< White balance mode */
} camera_config_t;

/**
 * @brief Static sensor hardware capability descriptor.
 */
typedef struct {
    uint32_t sensor_id;
    char     name[CAMERA_NAME_MAX_LEN];
    uint32_t max_width;
    uint32_t max_height;
    uint32_t supported_formats_mask;
    uint32_t max_fps;
    bool     has_flash;
    bool     has_autofocus;
    float    focal_length_mm;
} camera_sensor_info_t;

/* ========================================================================= */
/* Camera HAL Public API                                                     */
/* ========================================================================= */

/**
 * @brief Initialize the Mobile Camera HAL subsystem and sensor controllers.
 */
zx_status_t camera_hal_init(void);

/**
 * @brief Retrieve the number of available camera sensors.
 */
zx_status_t camera_get_sensor_count(uint32_t *count);

/**
 * @brief Query physical sensor capabilities.
 */
zx_status_t camera_get_sensor_info(uint32_t sensor_id, camera_sensor_info_t *out_info);

/**
 * @brief Configure sensor stream pipeline parameters.
 */
zx_status_t camera_configure(uint32_t sensor_id, const camera_config_t *config);

/**
 * @brief Start continuous sensor frame capture stream.
 */
zx_status_t camera_start_stream(uint32_t sensor_id);

/**
 * @brief Halt sensor frame capture stream.
 */
zx_status_t camera_stop_stream(uint32_t sensor_id);

/**
 * @brief Dequeue the latest ready frame from the sensor ring buffer.
 */
zx_status_t camera_acquire_frame(uint32_t sensor_id, camera_frame_t **out_frame);

/**
 * @brief Return processed frame buffer back to the camera driver pool.
 */
zx_status_t camera_release_frame(uint32_t sensor_id, camera_frame_t *frame);

/**
 * @brief Set exposure duration and analog/digital ISO gain dynamically.
 */
zx_status_t camera_set_exposure(uint32_t sensor_id, uint32_t exposure_us, uint32_t iso_gain);

/**
 * @brief Query current operational state of a sensor.
 */
zx_status_t camera_get_state(uint32_t sensor_id, camera_state_t *out_state);

/**
 * @brief Generate synthetic sensor pattern into frame (SMPTE color bars / gradient).
 */
zx_status_t camera_generate_test_pattern(camera_frame_t *frame, camera_test_pattern_t pattern);

/**
 * @brief High-efficiency NV12 (YUV420 semi-planar) to ARGB8888 conversion.
 */
zx_status_t camera_nv12_to_argb8888(const uint8_t *y_plane,
                                    const uint8_t *uv_plane,
                                    uint32_t width,
                                    uint32_t height,
                                    uint32_t *out_argb);

/**
 * @brief High-efficiency ARGB8888 to NV12 conversion.
 */
zx_status_t camera_argb8888_to_nv12(const uint32_t *in_argb,
                                    uint32_t width,
                                    uint32_t height,
                                    uint8_t *out_y,
                                    uint8_t *out_uv);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_HAL_CAMERA_H */
