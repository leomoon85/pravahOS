/**
 * @file input.c
 * @brief PravahOS Multi-Modal Input Subsystem & Gesture Engine Implementation.
 */

#include "kernel/input.h"
#include "kernel/string.h"
#include "kernel/console.h"

/* Static Global Input Subsystem State */
static input_ring_buffer_t g_input_ring_buffer;
static input_device_t      g_touchscreen_device;
static bool                g_input_subsystem_initialized = false;

/* ========================================================================= */
/* Math & Helper Functions (Freestanding / General Registers Only)          */
/* ========================================================================= */

/**
 * @brief Integer absolute value.
 */
static inline int32_t iabs(int32_t v) {
    return (v < 0) ? -v : v;
}

/**
 * @brief Integer square root (Newton-Raphson method) avoiding FPU instructions.
 */
static inline int32_t isqrt(int64_t val) {
    if (val <= 0) return 0;
    int64_t x0 = val / 2;
    if (x0 == 0) return 1;
    int64_t x1 = (x0 + val / x0) / 2;
    while (x1 < x0) {
        x0 = x1;
        x1 = (x0 + val / x0) / 2;
    }
    return (int32_t)x0;
}

/**
 * @brief Clamp integer between minimum and maximum bounds.
 */
static inline int32_t iclamp(int32_t v, int32_t min_v, int32_t max_v) {
    if (v < min_v) return min_v;
    if (v > max_v) return max_v;
    return v;
}

const char *gesture_type_to_string(gesture_type_t type) {
    switch (type) {
        case GESTURE_TYPE_TAP:         return "TAP";
        case GESTURE_TYPE_DOUBLE_TAP:  return "DOUBLE_TAP";
        case GESTURE_TYPE_LONG_PRESS:  return "LONG_PRESS";
        case GESTURE_TYPE_SWIPE_UP:    return "SWIPE_UP";
        case GESTURE_TYPE_SWIPE_DOWN:  return "SWIPE_DOWN";
        case GESTURE_TYPE_SWIPE_LEFT:  return "SWIPE_LEFT";
        case GESTURE_TYPE_SWIPE_RIGHT: return "SWIPE_RIGHT";
        case GESTURE_TYPE_PINCH_ZOOM:  return "PINCH_ZOOM";
        default:                       return "NONE";
    }
}

const char *touch_action_to_string(touch_action_t action) {
    switch (action) {
        case TOUCH_ACTION_DOWN:   return "DOWN";
        case TOUCH_ACTION_MOVE:   return "MOVE";
        case TOUCH_ACTION_UP:     return "UP";
        case TOUCH_ACTION_CANCEL: return "CANCEL";
        default:                  return "NONE";
    }
}

/* ========================================================================= */
/* Atomic Lock-Free Single-Producer Single-Consumer (SPSC) Ring Buffer       */
/* ========================================================================= */

void input_ring_init(input_ring_buffer_t *rb) {
    if (!rb) return;
    memset(rb, 0, sizeof(input_ring_buffer_t));
    __atomic_store_n(&rb->head, 0, __ATOMIC_RELAXED);
    __atomic_store_n(&rb->tail, 0, __ATOMIC_RELAXED);
    __atomic_store_n(&rb->dropped, 0, __ATOMIC_RELAXED);
}

bool input_ring_is_empty(const input_ring_buffer_t *rb) {
    if (!rb) return true;
    uint32_t head = __atomic_load_n(&rb->head, __ATOMIC_ACQUIRE);
    uint32_t tail = __atomic_load_n(&rb->tail, __ATOMIC_ACQUIRE);
    return head == tail;
}

bool input_ring_is_full(const input_ring_buffer_t *rb) {
    if (!rb) return true;
    uint32_t head = __atomic_load_n(&rb->head, __ATOMIC_ACQUIRE);
    uint32_t tail = __atomic_load_n(&rb->tail, __ATOMIC_ACQUIRE);
    return (head - tail) >= INPUT_RING_BUFFER_SIZE;
}

uint32_t input_ring_count(const input_ring_buffer_t *rb) {
    if (!rb) return 0;
    uint32_t head = __atomic_load_n(&rb->head, __ATOMIC_ACQUIRE);
    uint32_t tail = __atomic_load_n(&rb->tail, __ATOMIC_ACQUIRE);
    return head - tail;
}

bool input_ring_push(input_ring_buffer_t *rb, const input_event_t *ev) {
    if (!rb || !ev) return false;

    uint32_t head = __atomic_load_n(&rb->head, __ATOMIC_RELAXED);
    uint32_t tail = __atomic_load_n(&rb->tail, __ATOMIC_ACQUIRE);

    if ((head - tail) >= INPUT_RING_BUFFER_SIZE) {
        /* Buffer is full: event dropped to preserve lock-free real-time integrity */
        __atomic_fetch_add(&rb->dropped, 1, __ATOMIC_RELAXED);
        return false;
    }

    uint32_t index = head & INPUT_RING_BUFFER_MASK;
    memcpy(&rb->buffer[index], ev, sizeof(input_event_t));

    /* Release barrier guarantees event payload is visible before advancing head */
    __atomic_store_n(&rb->head, head + 1, __ATOMIC_RELEASE);
    return true;
}

bool input_ring_pop(input_ring_buffer_t *rb, input_event_t *out_ev) {
    if (!rb || !out_ev) return false;

    uint32_t tail = __atomic_load_n(&rb->tail, __ATOMIC_RELAXED);
    uint32_t head = __atomic_load_n(&rb->head, __ATOMIC_ACQUIRE);

    if (tail == head) {
        /* Buffer empty */
        return false;
    }

    uint32_t index = tail & INPUT_RING_BUFFER_MASK;
    memcpy(out_ev, &rb->buffer[index], sizeof(input_event_t));

    /* Release barrier guarantees data is read before consumer advances tail */
    __atomic_store_n(&rb->tail, tail + 1, __ATOMIC_RELEASE);
    return true;
}

bool input_ring_peek(const input_ring_buffer_t *rb, input_event_t *out_ev) {
    if (!rb || !out_ev) return false;

    uint32_t tail = __atomic_load_n(&rb->tail, __ATOMIC_RELAXED);
    uint32_t head = __atomic_load_n(&rb->head, __ATOMIC_ACQUIRE);

    if (tail == head) {
        return false;
    }

    uint32_t index = tail & INPUT_RING_BUFFER_MASK;
    memcpy(out_ev, &rb->buffer[index], sizeof(input_event_t));
    return true;
}

/* ========================================================================= */
/* Coordinate Normalization Engine                                           */
/* ========================================================================= */

void input_init_calibration(display_calibration_t *cal, int32_t display_w, int32_t display_h) {
    if (!cal) return;
    cal->raw_min_x = 0;
    cal->raw_max_x = RAW_TOUCH_MAX_COORD;
    cal->raw_min_y = 0;
    cal->raw_max_y = RAW_TOUCH_MAX_COORD;
    cal->display_width = (display_w > 0) ? display_w : DEFAULT_DISPLAY_WIDTH;
    cal->display_height = (display_h > 0) ? display_h : DEFAULT_DISPLAY_HEIGHT;
    cal->swap_xy = false;
    cal->invert_x = false;
    cal->invert_y = false;
}

void input_normalize_coordinates(const display_calibration_t *cal,
                                 int32_t raw_x, int32_t raw_y,
                                 int32_t *out_screen_x, int32_t *out_screen_y) {
    if (!cal || !out_screen_x || !out_screen_y) return;

    /* 1. Optional XY coordinate swap */
    int32_t rx = cal->swap_xy ? raw_y : raw_x;
    int32_t ry = cal->swap_xy ? raw_x : raw_y;

    /* 2. Clamp raw digits to calibrated bounding box */
    rx = iclamp(rx, cal->raw_min_x, cal->raw_max_x);
    ry = iclamp(ry, cal->raw_min_y, cal->raw_max_y);

    /* 3. Handle axis inversions */
    if (cal->invert_x) {
        rx = cal->raw_max_x - (rx - cal->raw_min_x);
    }
    if (cal->invert_y) {
        ry = cal->raw_max_y - (ry - cal->raw_min_y);
    }

    /* 4. Interpolate linear display pixel coordinates */
    int64_t span_raw_x = (int64_t)cal->raw_max_x - (int64_t)cal->raw_min_x;
    int64_t span_raw_y = (int64_t)cal->raw_max_y - (int64_t)cal->raw_min_y;

    if (span_raw_x <= 0) span_raw_x = 1;
    if (span_raw_y <= 0) span_raw_y = 1;

    int64_t norm_x = ((int64_t)(rx - cal->raw_min_x) * (int64_t)(cal->display_width - 1)) / span_raw_x;
    int64_t norm_y = ((int64_t)(ry - cal->raw_min_y) * (int64_t)(cal->display_height - 1)) / span_raw_y;

    *out_screen_x = (int32_t)iclamp((int32_t)norm_x, 0, cal->display_width - 1);
    *out_screen_y = (int32_t)iclamp((int32_t)norm_y, 0, cal->display_height - 1);
}

/* ========================================================================= */
/* Multi-Touch Gesture Decoder                                               */
/* ========================================================================= */

void gesture_decoder_init(gesture_decoder_t *gd, const gesture_config_t *cfg) {
    if (!gd) return;
    memset(gd, 0, sizeof(gesture_decoder_t));

    if (cfg) {
        memcpy(&gd->config, cfg, sizeof(gesture_config_t));
    } else {
        /* Sensible mobile / tablet default thresholds */
        gd->config.tap_max_distance_px    = 25;   /* <= 25 px motion tolerated for tap */
        gd->config.tap_max_duration_ms    = 300;  /* <= 300 ms hold time for tap */
        gd->config.double_tap_interval_ms = 350;  /* <= 350 ms between double taps */
        gd->config.double_tap_distance_px = 35;   /* <= 35 px separation for double tap */
        gd->config.long_press_duration_ms = 500;  /* >= 500 ms hold triggers long press */
        gd->config.long_press_max_dist_px = 25;   /* <= 25 px drift allowed for long press */
        gd->config.swipe_min_distance_px  = 60;   /* >= 60 px motion triggers swipe */
        gd->config.swipe_max_duration_ms  = 600;  /* <= 600 ms duration for swipe */
        gd->config.pinch_min_delta_px     = 20;   /* >= 20 px change triggers pinch step */
    }

    gd->active_slots_count = 0;
    gd->last_tap_time_ns = 0;
    gd->last_tap_x = 0;
    gd->last_tap_y = 0;
    gd->pinch_active = false;
}

void gesture_decoder_reset(gesture_decoder_t *gd) {
    if (!gd) return;
    for (uint32_t i = 0; i < INPUT_MAX_TOUCH_SLOTS; i++) {
        gd->slots[i].active = false;
        gd->slots[i].tracking_id = -1;
    }
    gd->active_slots_count = 0;
    gd->pinch_active = false;
}

/**
 * @brief Helper to calculate distance between two 2D points.
 */
static inline int32_t point_distance(int32_t x1, int32_t y1, int32_t x2, int32_t y2) {
    int64_t dx = (int64_t)x2 - (int64_t)x1;
    int64_t dy = (int64_t)y2 - (int64_t)y1;
    return isqrt(dx * dx + dy * dy);
}

bool gesture_decoder_process_touch(gesture_decoder_t *gd,
                                   const input_touch_event_t *touch,
                                   uint64_t now_ns,
                                   input_gesture_event_t *out_gesture) {
    if (!gd || !touch) return false;
    if (out_gesture) {
        memset(out_gesture, 0, sizeof(input_gesture_event_t));
    }

    uint32_t slot = touch->slot;
    if (slot >= INPUT_MAX_TOUCH_SLOTS) return false;

    touch_slot_state_t *ts = &gd->slots[slot];
    bool gesture_detected = false;

    switch (touch->action) {
        case TOUCH_ACTION_DOWN: {
            ts->active = true;
            ts->tracking_id = touch->tracking_id;
            ts->start_raw_x = touch->raw_x;
            ts->start_raw_y = touch->raw_y;
            ts->start_screen_x = touch->screen_x;
            ts->start_screen_y = touch->screen_y;
            ts->current_raw_x = touch->raw_x;
            ts->current_raw_y = touch->raw_y;
            ts->current_screen_x = touch->screen_x;
            ts->current_screen_y = touch->screen_y;
            ts->pressure = touch->pressure;
            ts->down_time_ns = now_ns;
            ts->last_move_time_ns = now_ns;
            ts->long_press_triggered = false;
            ts->swipe_disqualified = false;

            /* Recount active slots */
            gd->active_slots_count = 0;
            for (uint32_t i = 0; i < INPUT_MAX_TOUCH_SLOTS; i++) {
                if (gd->slots[i].active) gd->active_slots_count++;
            }

            /* Initialize pinch state when two fingers touch down */
            if (gd->active_slots_count == 2) {
                /* Identify the two active slots */
                int s0 = -1, s1 = -1;
                for (uint32_t i = 0; i < INPUT_MAX_TOUCH_SLOTS; i++) {
                    if (gd->slots[i].active) {
                        if (s0 == -1) s0 = i;
                        else if (s1 == -1) { s1 = i; break; }
                    }
                }
                if (s0 != -1 && s1 != -1) {
                    gd->pinch_initial_dist = point_distance(
                        gd->slots[s0].current_screen_x, gd->slots[s0].current_screen_y,
                        gd->slots[s1].current_screen_x, gd->slots[s1].current_screen_y);
                    gd->pinch_last_dist = gd->pinch_initial_dist;
                    gd->pinch_active = true;
                }
            } else if (gd->active_slots_count > 2) {
                gd->pinch_active = false;
            }
            break;
        }

        case TOUCH_ACTION_MOVE: {
            if (!ts->active) return false;

            ts->current_raw_x = touch->raw_x;
            ts->current_raw_y = touch->raw_y;
            ts->current_screen_x = touch->screen_x;
            ts->current_screen_y = touch->screen_y;
            ts->pressure = touch->pressure;
            ts->last_move_time_ns = now_ns;

            int32_t dist_from_start = point_distance(ts->start_screen_x, ts->start_screen_y,
                                                     ts->current_screen_x, ts->current_screen_y);

            /* Multi-Touch Pinch-to-Zoom Tracking */
            if (gd->pinch_active && gd->active_slots_count == 2) {
                int s0 = -1, s1 = -1;
                for (uint32_t i = 0; i < INPUT_MAX_TOUCH_SLOTS; i++) {
                    if (gd->slots[i].active) {
                        if (s0 == -1) s0 = i;
                        else if (s1 == -1) { s1 = i; break; }
                    }
                }

                if (s0 != -1 && s1 != -1 && gd->pinch_initial_dist > 0) {
                    int32_t cur_dist = point_distance(
                        gd->slots[s0].current_screen_x, gd->slots[s0].current_screen_y,
                        gd->slots[s1].current_screen_x, gd->slots[s1].current_screen_y);

                    int32_t delta_pinch = cur_dist - gd->pinch_last_dist;
                    if (iabs(delta_pinch) >= (int32_t)gd->config.pinch_min_delta_px) {
                        if (out_gesture) {
                            out_gesture->type = GESTURE_TYPE_PINCH_ZOOM;
                            out_gesture->center_x = (gd->slots[s0].current_screen_x + gd->slots[s1].current_screen_x) / 2;
                            out_gesture->center_y = (gd->slots[s0].current_screen_y + gd->slots[s1].current_screen_y) / 2;
                            out_gesture->delta_x = delta_pinch;
                            out_gesture->delta_y = 0;
                            /* Scale milli: 1000 = 1.0x baseline */
                            out_gesture->scale_milli = (cur_dist * 1000) / gd->pinch_initial_dist;
                            out_gesture->touch_count = 2;
                            out_gesture->duration_ms = (uint32_t)((now_ns - ts->down_time_ns) / 1000000ULL);
                            gesture_detected = true;
                        }
                        gd->pinch_last_dist = cur_dist;
                    }
                }
            } else if (gd->active_slots_count == 1) {
                /* Single Finger Tracking */
                uint32_t dur_ms = (uint32_t)((now_ns - ts->down_time_ns) / 1000000ULL);

                /* Check Long-Press criteria during stationary hold */
                if (!ts->long_press_triggered && !ts->swipe_disqualified) {
                    if (dur_ms >= gd->config.long_press_duration_ms &&
                        dist_from_start <= (int32_t)gd->config.long_press_max_dist_px) {
                        ts->long_press_triggered = true;
                        if (out_gesture) {
                            out_gesture->type = GESTURE_TYPE_LONG_PRESS;
                            out_gesture->center_x = ts->current_screen_x;
                            out_gesture->center_y = ts->current_screen_y;
                            out_gesture->delta_x = 0;
                            out_gesture->delta_y = 0;
                            out_gesture->duration_ms = dur_ms;
                            out_gesture->scale_milli = 1000;
                            out_gesture->touch_count = 1;
                            gesture_detected = true;
                        }
                    }
                }

                if (dist_from_start > (int32_t)gd->config.tap_max_distance_px) {
                    /* Finger moved beyond stationary threshold: cannot be a tap */
                    ts->swipe_disqualified = false;
                }
            }
            break;
        }

        case TOUCH_ACTION_UP: {
            if (!ts->active) return false;

            uint32_t dur_ms = (uint32_t)((now_ns - ts->down_time_ns) / 1000000ULL);
            int32_t dx = ts->current_screen_x - ts->start_screen_x;
            int32_t dy = ts->current_screen_y - ts->start_screen_y;
            int32_t dist = point_distance(ts->start_screen_x, ts->start_screen_y,
                                          ts->current_screen_x, ts->current_screen_y);

            /* If single finger was released and long press didn't trigger */
            if (gd->active_slots_count == 1 && !ts->long_press_triggered) {
                /* 1. Evaluate Tap & Double-Tap */
                if (dist <= (int32_t)gd->config.tap_max_distance_px &&
                    dur_ms <= gd->config.tap_max_duration_ms) {

                    /* Check if this qualifies as second tap of double-tap */
                    uint32_t interval_ms = (uint32_t)((now_ns - gd->last_tap_time_ns) / 1000000ULL);
                    int32_t dist_to_prev = point_distance(ts->current_screen_x, ts->current_screen_y,
                                                          gd->last_tap_x, gd->last_tap_y);

                    if (gd->last_tap_time_ns > 0 &&
                        interval_ms <= gd->config.double_tap_interval_ms &&
                        dist_to_prev <= (int32_t)gd->config.double_tap_distance_px) {

                        if (out_gesture) {
                            out_gesture->type = GESTURE_TYPE_DOUBLE_TAP;
                            out_gesture->center_x = ts->current_screen_x;
                            out_gesture->center_y = ts->current_screen_y;
                            out_gesture->delta_x = dx;
                            out_gesture->delta_y = dy;
                            out_gesture->duration_ms = dur_ms;
                            out_gesture->scale_milli = 1000;
                            out_gesture->touch_count = 1;
                            gesture_detected = true;
                        }
                        /* Reset last tap history to prevent triple tap ambiguity */
                        gd->last_tap_time_ns = 0;
                    } else {
                        /* Single Tap detected */
                        if (out_gesture) {
                            out_gesture->type = GESTURE_TYPE_TAP;
                            out_gesture->center_x = ts->current_screen_x;
                            out_gesture->center_y = ts->current_screen_y;
                            out_gesture->delta_x = dx;
                            out_gesture->delta_y = dy;
                            out_gesture->duration_ms = dur_ms;
                            out_gesture->scale_milli = 1000;
                            out_gesture->touch_count = 1;
                            gesture_detected = true;
                        }
                        gd->last_tap_time_ns = now_ns;
                        gd->last_tap_x = ts->current_screen_x;
                        gd->last_tap_y = ts->current_screen_y;
                    }
                }
                /* 2. Evaluate Swipe Gesture */
                else if (dist >= (int32_t)gd->config.swipe_min_distance_px &&
                         dur_ms <= gd->config.swipe_max_duration_ms) {

                    int32_t adx = iabs(dx);
                    int32_t ady = iabs(dy);
                    int32_t vel = (dist * 1000) / (dur_ms > 0 ? (int32_t)dur_ms : 1);

                    gesture_type_t swipe_type = GESTURE_TYPE_NONE;
                    if (adx >= ady) {
                        /* Dominant horizontal gesture */
                        swipe_type = (dx > 0) ? GESTURE_TYPE_SWIPE_RIGHT : GESTURE_TYPE_SWIPE_LEFT;
                    } else {
                        /* Dominant vertical gesture */
                        swipe_type = (dy > 0) ? GESTURE_TYPE_SWIPE_DOWN : GESTURE_TYPE_SWIPE_UP;
                    }

                    if (out_gesture) {
                        out_gesture->type = swipe_type;
                        out_gesture->center_x = ts->start_screen_x + (dx / 2);
                        out_gesture->center_y = ts->start_screen_y + (dy / 2);
                        out_gesture->delta_x = dx;
                        out_gesture->delta_y = dy;
                        out_gesture->velocity_px_sec = vel;
                        out_gesture->duration_ms = dur_ms;
                        out_gesture->scale_milli = 1000;
                        out_gesture->touch_count = 1;
                        gesture_detected = true;
                    }
                }
            }

            /* Release slot */
            ts->active = false;
            ts->tracking_id = -1;

            /* Recount active slots */
            gd->active_slots_count = 0;
            for (uint32_t i = 0; i < INPUT_MAX_TOUCH_SLOTS; i++) {
                if (gd->slots[i].active) gd->active_slots_count++;
            }
            if (gd->active_slots_count < 2) {
                gd->pinch_active = false;
            }
            break;
        }

        case TOUCH_ACTION_CANCEL:
        default:
            ts->active = false;
            ts->tracking_id = -1;
            gd->active_slots_count = 0;
            for (uint32_t i = 0; i < INPUT_MAX_TOUCH_SLOTS; i++) {
                if (gd->slots[i].active) gd->active_slots_count++;
            }
            gd->pinch_active = false;
            break;
    }

    return gesture_detected;
}

bool gesture_decoder_poll_timeout(gesture_decoder_t *gd,
                                  uint64_t now_ns,
                                  input_gesture_event_t *out_gesture) {
    if (!gd) return false;

    /* Scan active single touch slot for long-press expiration while finger is held */
    if (gd->active_slots_count == 1) {
        for (uint32_t i = 0; i < INPUT_MAX_TOUCH_SLOTS; i++) {
            touch_slot_state_t *ts = &gd->slots[i];
            if (ts->active && !ts->long_press_triggered) {
                uint32_t dur_ms = (uint32_t)((now_ns - ts->down_time_ns) / 1000000ULL);
                int32_t dist = point_distance(ts->start_screen_x, ts->start_screen_y,
                                              ts->current_screen_x, ts->current_screen_y);

                if (dur_ms >= gd->config.long_press_duration_ms &&
                    dist <= (int32_t)gd->config.long_press_max_dist_px) {
                    ts->long_press_triggered = true;
                    if (out_gesture) {
                        out_gesture->type = GESTURE_TYPE_LONG_PRESS;
                        out_gesture->center_x = ts->current_screen_x;
                        out_gesture->center_y = ts->current_screen_y;
                        out_gesture->delta_x = 0;
                        out_gesture->delta_y = 0;
                        out_gesture->duration_ms = dur_ms;
                        out_gesture->scale_milli = 1000;
                        out_gesture->touch_count = 1;
                    }
                    return true;
                }
            }
        }
    }
    return false;
}

/* ========================================================================= */
/* Driver & Subsystem Implementation                                         */
/* ========================================================================= */

zx_status_t input_device_init(input_device_t *dev,
                              const char *name,
                              input_device_type_t type,
                              int32_t display_w,
                              int32_t display_h,
                              input_ring_buffer_t *rb) {
    if (!dev) return ZX_ERR_INVALID_ARGS;
    memset(dev, 0, sizeof(input_device_t));

    if (name) {
        strncpy(dev->name, name, sizeof(dev->name) - 1);
    } else {
        strncpy(dev->name, "input_device", sizeof(dev->name) - 1);
    }

    dev->type = type;
    input_init_calibration(&dev->calibration, display_w, display_h);
    gesture_decoder_init(&dev->gesture_decoder, NULL);
    dev->ring_buffer = rb;
    dev->current_slot = 0;
    dev->pending_tracking_id = -1;
    dev->pending_raw_x = 0;
    dev->pending_raw_y = 0;
    dev->pending_pressure = 128;
    dev->touch_active = false;

    return ZX_OK;
}

zx_status_t input_subsystem_init(void) {
    if (g_input_subsystem_initialized) {
        return ZX_OK;
    }

    /* 1. Initialize global event ring buffer */
    input_ring_init(&g_input_ring_buffer);

    /* 2. Initialize default virtual touchscreen device (1080p display) */
    zx_status_t st = input_device_init(&g_touchscreen_device,
                                       "virtio_touchscreen",
                                       INPUT_DEV_TYPE_TOUCHSCREEN,
                                       DEFAULT_DISPLAY_WIDTH,
                                       DEFAULT_DISPLAY_HEIGHT,
                                       &g_input_ring_buffer);
    if (st != ZX_OK) {
        return st;
    }

    g_input_subsystem_initialized = true;
    uart_puts("  * Input Subsystem: Lock-Free Ring Buffer (256-slot) & Multi-Touch Gesture Engine Initialized\n");
    return ZX_OK;
}

input_ring_buffer_t *input_get_global_ring_buffer(void) {
    return &g_input_ring_buffer;
}

input_device_t *input_get_touchscreen_device(void) {
    return &g_touchscreen_device;
}

zx_status_t input_inject_touch(input_device_t *dev,
                               touch_action_t action,
                               uint32_t slot,
                               int32_t raw_x,
                               int32_t raw_y,
                               uint64_t timestamp_ns) {
    if (!dev || !dev->ring_buffer) return ZX_ERR_INVALID_ARGS;
    if (slot >= INPUT_MAX_TOUCH_SLOTS) return ZX_ERR_OUT_OF_RANGE;

    /* 1. Normalize coordinates from raw hardware digit range to screen pixel space */
    int32_t screen_x = 0, screen_y = 0;
    input_normalize_coordinates(&dev->calibration, raw_x, raw_y, &screen_x, &screen_y);

    /* 2. Construct low-level touch event */
    input_event_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = timestamp_ns;
    ev.device_type = dev->type;
    ev.event_type = INPUT_EVENT_TOUCH;
    ev.touch.action = action;
    ev.touch.slot = slot;
    ev.touch.tracking_id = (action == TOUCH_ACTION_UP) ? -1 : (int32_t)(slot + 1);
    ev.touch.screen_x = screen_x;
    ev.touch.screen_y = screen_y;
    ev.touch.raw_x = raw_x;
    ev.touch.raw_y = raw_y;
    ev.touch.pressure = (action == TOUCH_ACTION_UP) ? 0 : 255;

    /* 3. Push raw touch event into lock-free ring buffer */
    input_ring_push(dev->ring_buffer, &ev);

    /* 4. Process event through Multi-Touch Gesture Decoder */
    input_gesture_event_t gesture;
    if (gesture_decoder_process_touch(&dev->gesture_decoder, &ev.touch, timestamp_ns, &gesture)) {
        /* High-level gesture detected! Enqueue gesture event into ring buffer */
        input_event_t g_ev;
        memset(&g_ev, 0, sizeof(g_ev));
        g_ev.timestamp_ns = timestamp_ns;
        g_ev.device_type = dev->type;
        g_ev.event_type = INPUT_EVENT_GESTURE;
        g_ev.gesture = gesture;

        input_ring_push(dev->ring_buffer, &g_ev);
    }

    return ZX_OK;
}

zx_status_t input_inject_key(input_device_t *dev,
                             key_action_t action,
                             uint32_t keycode,
                             uint32_t modifiers,
                             uint64_t timestamp_ns) {
    if (!dev || !dev->ring_buffer) return ZX_ERR_INVALID_ARGS;

    input_event_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = timestamp_ns;
    ev.device_type = dev->type;
    ev.event_type = INPUT_EVENT_KEY;
    ev.key.action = action;
    ev.key.keycode = keycode;
    ev.key.modifiers = modifiers;

    input_ring_push(dev->ring_buffer, &ev);
    return ZX_OK;
}

zx_status_t input_inject_mouse(input_device_t *dev,
                               int32_t rel_x,
                               int32_t rel_y,
                               uint32_t buttons,
                               int32_t scroll_wheel,
                               uint64_t timestamp_ns) {
    if (!dev || !dev->ring_buffer) return ZX_ERR_INVALID_ARGS;

    input_event_t ev;
    memset(&ev, 0, sizeof(ev));
    ev.timestamp_ns = timestamp_ns;
    ev.device_type = dev->type;
    ev.event_type = INPUT_EVENT_POINTER;
    ev.mouse.rel_x = rel_x;
    ev.mouse.rel_y = rel_y;
    ev.mouse.buttons = buttons;
    ev.mouse.scroll_wheel = scroll_wheel;

    /* Update cumulative pointer position bounded by display */
    int32_t cur_x = dev->pending_raw_x + rel_x;
    int32_t cur_y = dev->pending_raw_y + rel_y;
    cur_x = iclamp(cur_x, 0, dev->calibration.display_width - 1);
    cur_y = iclamp(cur_y, 0, dev->calibration.display_height - 1);
    dev->pending_raw_x = cur_x;
    dev->pending_raw_y = cur_y;
    ev.mouse.screen_x = cur_x;
    ev.mouse.screen_y = cur_y;

    input_ring_push(dev->ring_buffer, &ev);
    return ZX_OK;
}

zx_status_t input_inject_evdev(input_device_t *dev,
                               uint16_t type,
                               uint16_t code,
                               int32_t value,
                               uint64_t timestamp_ns) {
    if (!dev) return ZX_ERR_INVALID_ARGS;

    switch (type) {
        case EV_ABS:
            switch (code) {
                case ABS_MT_SLOT:
                    if (value >= 0 && value < INPUT_MAX_TOUCH_SLOTS) {
                        dev->current_slot = (uint32_t)value;
                    }
                    break;
                case ABS_MT_TRACKING_ID:
                    dev->pending_tracking_id = value;
                    break;
                case ABS_MT_POSITION_X:
                case ABS_X:
                    dev->pending_raw_x = value;
                    break;
                case ABS_MT_POSITION_Y:
                case ABS_Y:
                    dev->pending_raw_y = value;
                    break;
                case ABS_MT_PRESSURE:
                case ABS_PRESSURE:
                    dev->pending_pressure = value;
                    break;
                default:
                    break;
            }
            break;

        case EV_KEY:
            if (code == BTN_TOUCH) {
                dev->touch_active = (value != 0);
                touch_action_t act = (value != 0) ? TOUCH_ACTION_DOWN : TOUCH_ACTION_UP;
                input_inject_touch(dev, act, dev->current_slot,
                                   dev->pending_raw_x, dev->pending_raw_y, timestamp_ns);
            } else {
                key_action_t act = (value == 0) ? KEY_ACTION_RELEASE :
                                   ((value == 1) ? KEY_ACTION_PRESS : KEY_ACTION_REPEAT);
                input_inject_key(dev, act, code, 0, timestamp_ns);
            }
            break;

        case EV_REL:
            if (code == REL_X) {
                input_inject_mouse(dev, value, 0, 0, 0, timestamp_ns);
            } else if (code == REL_Y) {
                input_inject_mouse(dev, 0, value, 0, 0, timestamp_ns);
            } else if (code == REL_WHEEL) {
                input_inject_mouse(dev, 0, 0, 0, value, timestamp_ns);
            }
            break;

        case EV_SYN:
            if (code == SYN_REPORT) {
                if (dev->pending_tracking_id == -1) {
                    /* Finger lifted */
                    input_inject_touch(dev, TOUCH_ACTION_UP, dev->current_slot,
                                       dev->pending_raw_x, dev->pending_raw_y, timestamp_ns);
                } else if (dev->touch_active) {
                    input_inject_touch(dev, TOUCH_ACTION_MOVE, dev->current_slot,
                                       dev->pending_raw_x, dev->pending_raw_y, timestamp_ns);
                }
            }
            break;

        default:
            break;
    }

    return ZX_OK;
}
