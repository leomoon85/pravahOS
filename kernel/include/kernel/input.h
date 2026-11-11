/**
 * @file input.h
 * @brief PravahOS Multi-Modal Input Subsystem & Gesture Engine.
 *
 * Defines device abstractions for touchscreen, mouse, keyboard, and virtio-input,
 * lock-free atomic ring buffer for input events, display coordinate normalization,
 * and multi-touch gesture decoding (Tap, Double-tap, Long-press, Swipe, Pinch-to-zoom).
 */

#ifndef PRAVAH_KERNEL_INPUT_H
#define PRAVAH_KERNEL_INPUT_H

#include "types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Maximum multi-touch slots supported concurrently (Linux MT Type B standard) */
#define INPUT_MAX_TOUCH_SLOTS      (10)

/* Ring buffer capacity (must be a power of two) */
#define INPUT_RING_BUFFER_SIZE     (256)
#define INPUT_RING_BUFFER_MASK     (INPUT_RING_BUFFER_SIZE - 1)

/* Coordinate Normalization Defaults */
#define RAW_TOUCH_MAX_COORD        (32767)
#define DEFAULT_DISPLAY_WIDTH      (1920)
#define DEFAULT_DISPLAY_HEIGHT     (1080)

/* Linux Evdev / VirtIO-Input Event Types */
#define EV_SYN                     (0x00)
#define EV_KEY                     (0x01)
#define EV_REL                     (0x02)
#define EV_ABS                     (0x03)

/* Evdev Synchronization Codes */
#define SYN_REPORT                 (0)
#define SYN_CONFIG                 (1)
#define SYN_MT_REPORT              (2)
#define SYN_DROPPED                (3)

/* Evdev Relative Axis Codes */
#define REL_X                      (0x00)
#define REL_Y                      (0x01)
#define REL_Z                      (0x02)
#define REL_WHEEL                  (0x08)
#define REL_HWHEEL                 (0x06)

/* Evdev Absolute Axis Codes */
#define ABS_X                      (0x00)
#define ABS_Y                      (0x01)
#define ABS_PRESSURE               (0x18)
#define ABS_MT_SLOT                (0x2f)
#define ABS_MT_TOUCH_MAJOR         (0x30)
#define ABS_MT_TOUCH_MINOR         (0x31)
#define ABS_MT_POSITION_X          (0x35)
#define ABS_MT_POSITION_Y          (0x36)
#define ABS_MT_TRACKING_ID         (0x39)
#define ABS_MT_PRESSURE            (0x3a)

/* Evdev Button Codes */
#define BTN_TOUCH                  (0x14a)
#define BTN_TOOL_FINGER            (0x145)
#define BTN_TOOL_DOUBLETAP         (0x14d)
#define BTN_TOOL_TRIPLETAP         (0x14e)
#define BTN_TOOL_QUADTAP           (0x14f)
#define BTN_LEFT                   (0x110)
#define BTN_RIGHT                  (0x111)
#define BTN_MIDDLE                 (0x112)

/* Keyboard Keycodes (subset standard USB HID / Linux evdev) */
#define KEY_RESERVED               (0)
#define KEY_ESC                    (1)
#define KEY_1                      (2)
#define KEY_2                      (3)
#define KEY_TAB                    (15)
#define KEY_Q                      (16)
#define KEY_ENTER                  (28)
#define KEY_SPACE                  (57)
#define KEY_UP                     (103)
#define KEY_LEFT                   (105)
#define KEY_RIGHT                  (106)
#define KEY_DOWN                   (108)

/**
 * @brief Input device classification.
 */
typedef enum input_device_type {
    INPUT_DEV_TYPE_NONE         = 0,
    INPUT_DEV_TYPE_KEYBOARD     = 1,
    INPUT_DEV_TYPE_MOUSE        = 2,
    INPUT_DEV_TYPE_TOUCHSCREEN  = 3,
    INPUT_DEV_TYPE_TOUCHPAD     = 4,
    INPUT_DEV_TYPE_VIRTIO       = 5,
} input_device_type_t;

/**
 * @brief Primary input event category.
 */
typedef enum input_event_type {
    INPUT_EVENT_NONE            = 0,
    INPUT_EVENT_KEY             = 1,
    INPUT_EVENT_POINTER         = 2,
    INPUT_EVENT_TOUCH           = 3,
    INPUT_EVENT_GESTURE         = 4,
} input_event_type_t;

/**
 * @brief Touch and pointer phase actions.
 */
typedef enum touch_action {
    TOUCH_ACTION_NONE           = 0,
    TOUCH_ACTION_DOWN           = 1,
    TOUCH_ACTION_MOVE           = 2,
    TOUCH_ACTION_UP             = 3,
    TOUCH_ACTION_CANCEL         = 4,
} touch_action_t;

/**
 * @brief Key press lifecycle state.
 */
typedef enum key_action {
    KEY_ACTION_RELEASE          = 0,
    KEY_ACTION_PRESS            = 1,
    KEY_ACTION_REPEAT           = 2,
} key_action_t;

/**
 * @brief High-level gesture classifications detected by the gesture engine.
 */
typedef enum gesture_type {
    GESTURE_TYPE_NONE           = 0,
    GESTURE_TYPE_TAP            = 1,
    GESTURE_TYPE_DOUBLE_TAP     = 2,
    GESTURE_TYPE_LONG_PRESS     = 3,
    GESTURE_TYPE_SWIPE_UP       = 4,
    GESTURE_TYPE_SWIPE_DOWN     = 5,
    GESTURE_TYPE_SWIPE_LEFT     = 6,
    GESTURE_TYPE_SWIPE_RIGHT    = 7,
    GESTURE_TYPE_PINCH_ZOOM     = 8,
} gesture_type_t;

/**
 * @brief Mouse button bitmask.
 */
typedef enum mouse_button {
    MOUSE_BTN_NONE              = 0,
    MOUSE_BTN_LEFT_MASK         = (1 << 0),
    MOUSE_BTN_RIGHT_MASK        = (1 << 1),
    MOUSE_BTN_MIDDLE_MASK       = (1 << 2),
} mouse_button_t;

/**
 * @brief Touch event payload.
 */
typedef struct input_touch_event {
    touch_action_t action;
    uint32_t slot;
    int32_t tracking_id;
    int32_t screen_x;
    int32_t screen_y;
    int32_t raw_x;
    int32_t raw_y;
    int32_t pressure;
} input_touch_event_t;

/**
 * @brief Keyboard event payload.
 */
typedef struct input_key_event {
    key_action_t action;
    uint32_t keycode;
    uint32_t modifiers;
} input_key_event_t;

/**
 * @brief Mouse / pointer event payload.
 */
typedef struct input_mouse_event {
    int32_t rel_x;
    int32_t rel_y;
    int32_t screen_x;
    int32_t screen_y;
    int32_t scroll_wheel;
    uint32_t buttons;
} input_mouse_event_t;

/**
 * @brief High-level gesture event payload emitted by the gesture decoder.
 */
typedef struct input_gesture_event {
    gesture_type_t type;
    int32_t center_x;           /* Focal center of gesture in screen coordinates */
    int32_t center_y;
    int32_t delta_x;            /* Displacement vector for swipe/pan */
    int32_t delta_y;
    int32_t velocity_px_sec;    /* Velocity in pixels per second */
    uint32_t duration_ms;       /* Duration of gesture contact */
    int32_t scale_milli;        /* Pinch zoom scale: 1000 = 1.0x, 1500 = 1.5x, 800 = 0.8x */
    uint32_t touch_count;       /* Number of fingers involved */
} input_gesture_event_t;

/**
 * @brief Unified kernel input event structure dispatched through the ring buffer.
 */
typedef struct input_event {
    uint64_t timestamp_ns;
    input_device_type_t device_type;
    input_event_type_t event_type;
    union {
        input_touch_event_t touch;
        input_key_event_t key;
        input_mouse_event_t mouse;
        input_gesture_event_t gesture;
    };
} input_event_t;

/**
 * @brief Atomic Lock-Free Single-Producer Single-Consumer (SPSC) Ring Buffer.
 */
typedef struct input_ring_buffer {
    input_event_t buffer[INPUT_RING_BUFFER_SIZE];
    volatile uint32_t head;        /* Next write index (producer) */
    volatile uint32_t tail;        /* Next read index (consumer) */
    volatile uint32_t dropped;     /* Count of dropped events due to overflow */
} input_ring_buffer_t;

/**
 * @brief Display calibration parameters for raw-to-pixel coordinate normalization.
 */
typedef struct display_calibration {
    int32_t raw_min_x;
    int32_t raw_max_x;
    int32_t raw_min_y;
    int32_t raw_max_y;
    int32_t display_width;
    int32_t display_height;
    bool swap_xy;
    bool invert_x;
    bool invert_y;
} display_calibration_t;

/**
 * @brief Thresholds and tuning parameters for multi-touch gesture decoding.
 */
typedef struct gesture_config {
    uint32_t tap_max_distance_px;       /* Max displacement tolerated for tap (px) */
    uint32_t tap_max_duration_ms;       /* Max touch hold duration for tap (ms) */
    uint32_t double_tap_interval_ms;    /* Max time gap between two taps (ms) */
    uint32_t double_tap_distance_px;    /* Max spatial separation between double-taps (px) */
    uint32_t long_press_duration_ms;    /* Minimum hold time for long press trigger (ms) */
    uint32_t long_press_max_dist_px;    /* Max displacement permitted during long press (px) */
    uint32_t swipe_min_distance_px;     /* Minimum displacement for swipe detection (px) */
    uint32_t swipe_max_duration_ms;     /* Maximum allowed duration for swipe gesture (ms) */
    uint32_t pinch_min_delta_px;        /* Minimum finger span delta for pinch-to-zoom (px) */
} gesture_config_t;

/**
 * @brief Tracking record for an individual touch slot.
 */
typedef struct touch_slot_state {
    bool active;
    int32_t tracking_id;
    int32_t start_raw_x;
    int32_t start_raw_y;
    int32_t start_screen_x;
    int32_t start_screen_y;
    int32_t current_raw_x;
    int32_t current_raw_y;
    int32_t current_screen_x;
    int32_t current_screen_y;
    int32_t pressure;
    uint64_t down_time_ns;
    uint64_t last_move_time_ns;
    bool long_press_triggered;
    bool swipe_disqualified;
} touch_slot_state_t;

/**
 * @brief Multi-Touch Gesture Decoder state machine.
 */
typedef struct gesture_decoder {
    gesture_config_t config;
    touch_slot_state_t slots[INPUT_MAX_TOUCH_SLOTS];
    uint32_t active_slots_count;

    /* Tap history for double-tap detection */
    uint64_t last_tap_time_ns;
    int32_t last_tap_x;
    int32_t last_tap_y;

    /* Pinch-to-zoom state */
    bool pinch_active;
    int32_t pinch_initial_dist;
    int32_t pinch_last_dist;
} gesture_decoder_t;

/**
 * @brief Abstract input device representation.
 */
typedef struct input_device {
    char name[32];
    input_device_type_t type;
    display_calibration_t calibration;
    gesture_decoder_t gesture_decoder;
    input_ring_buffer_t *ring_buffer;

    /* Evdev packet accumulation state */
    uint32_t current_slot;
    int32_t pending_raw_x;
    int32_t pending_raw_y;
    int32_t pending_tracking_id;
    int32_t pending_pressure;
    bool touch_active;
} input_device_t;

/* ========================================================================= */
/* Function Declarations                                                     */
/* ========================================================================= */

/* Ring Buffer API */
void input_ring_init(input_ring_buffer_t *rb);
bool input_ring_push(input_ring_buffer_t *rb, const input_event_t *ev);
bool input_ring_pop(input_ring_buffer_t *rb, input_event_t *out_ev);
bool input_ring_peek(const input_ring_buffer_t *rb, input_event_t *out_ev);
bool input_ring_is_empty(const input_ring_buffer_t *rb);
bool input_ring_is_full(const input_ring_buffer_t *rb);
uint32_t input_ring_count(const input_ring_buffer_t *rb);

/* Coordinate Normalization API */
void input_init_calibration(display_calibration_t *cal, int32_t display_w, int32_t display_h);
void input_normalize_coordinates(const display_calibration_t *cal,
                                 int32_t raw_x, int32_t raw_y,
                                 int32_t *out_screen_x, int32_t *out_screen_y);

/* Gesture Engine API */
void gesture_decoder_init(gesture_decoder_t *gd, const gesture_config_t *cfg);
void gesture_decoder_reset(gesture_decoder_t *gd);
bool gesture_decoder_process_touch(gesture_decoder_t *gd,
                                   const input_touch_event_t *touch,
                                   uint64_t now_ns,
                                   input_gesture_event_t *out_gesture);
bool gesture_decoder_poll_timeout(gesture_decoder_t *gd,
                                  uint64_t now_ns,
                                  input_gesture_event_t *out_gesture);

/* Driver & Subsystem API */
zx_status_t input_subsystem_init(void);
input_ring_buffer_t *input_get_global_ring_buffer(void);
input_device_t *input_get_touchscreen_device(void);

zx_status_t input_device_init(input_device_t *dev,
                              const char *name,
                              input_device_type_t type,
                              int32_t display_w,
                              int32_t display_h,
                              input_ring_buffer_t *rb);

zx_status_t input_inject_touch(input_device_t *dev,
                               touch_action_t action,
                               uint32_t slot,
                               int32_t raw_x,
                               int32_t raw_y,
                               uint64_t timestamp_ns);

zx_status_t input_inject_key(input_device_t *dev,
                             key_action_t action,
                             uint32_t keycode,
                             uint32_t modifiers,
                             uint64_t timestamp_ns);

zx_status_t input_inject_mouse(input_device_t *dev,
                               int32_t rel_x,
                               int32_t rel_y,
                               uint32_t buttons,
                               int32_t scroll_wheel,
                               uint64_t timestamp_ns);

zx_status_t input_inject_evdev(input_device_t *dev,
                               uint16_t type,
                               uint16_t code,
                               int32_t value,
                               uint64_t timestamp_ns);

/* Helper converting gesture enum to string */
const char *gesture_type_to_string(gesture_type_t type);
const char *touch_action_to_string(touch_action_t action);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_INPUT_H */
