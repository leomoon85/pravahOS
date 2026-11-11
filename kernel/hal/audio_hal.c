/**
 * @file audio_hal.c
 * @brief PravahOS Mobile PCM Audio Subsystem & Hardware Abstraction Layer Implementation.
 *
 * Implements circular ring buffers for 48kHz 16-bit stereo PCM playback and capture,
 * software volume scaling, mute gating, endpoint routing, underrun/overrun metrics,
 * and integer fixed-point sine wave tone synthesis (no hardware FP required).
 */

#include "kernel/hal/audio.h"
#include "kernel/memory.h"
#include "kernel/string.h"
#include "arch/arm64/uart_pl011.h"

/* Ring Buffer Storage (4096 stereo frames = 8192 int16 samples) */
static int16_t s_playback_buffer[AUDIO_RING_BUFFER_FRAMES * AUDIO_CHANNELS_STEREO];
static int16_t s_capture_buffer[AUDIO_RING_BUFFER_FRAMES * AUDIO_CHANNELS_STEREO];

/* Playback Ring Buffer Pointers */
static volatile size_t s_play_head = 0; /**< Producer write index */
static volatile size_t s_play_tail = 0; /**< Consumer DAC read index */

/* Capture Ring Buffer Pointers */
static volatile size_t s_cap_head = 0;  /**< ADC capture write index */
static volatile size_t s_cap_tail = 0;  /**< Consumer application read index */

/* Subsystem State & Telemetry */
static audio_telemetry_t s_audio_telemetry;
static bool s_audio_initialized = false;

/* 64-entry Quarter-Wave Fixed-Point Sine Table (scaled to 32767) */
static const int16_t s_sine_table[65] = {
        0,   804,  1608,  2410,  3212,  4011,  4808,  5602,
     6393,  7179,  7962,  8739,  9512, 10278, 11039, 11793,
    12539, 13279, 14010, 14732, 15446, 16151, 16846, 17530,
    18204, 18868, 19519, 20159, 20787, 21403, 22005, 22594,
    23170, 23731, 24279, 24811, 25329, 25832, 26319, 26790,
    27245, 27683, 28105, 28510, 28898, 29268, 29621, 29956,
    30273, 30571, 30852, 31113, 31356, 31580, 31785, 31971,
    32137, 32285, 32412, 32521, 32609, 32678, 32728, 32757,
    32767
};

/**
 * @brief Fixed-point sine approximation for bare-metal ARM64 without FPU.
 *
 * @param phase Phase angle normalized to 0..255 (full 360 degree circle).
 * @return Signed 16-bit amplitude (-32767 to +32767).
 */
static int16_t integer_sine(uint8_t phase) {
    if (phase <= 64) {
        return s_sine_table[phase];
    } else if (phase <= 128) {
        return s_sine_table[128 - phase];
    } else if (phase <= 192) {
        return -s_sine_table[phase - 128];
    } else {
        return -s_sine_table[256 - phase];
    }
}

/* ========================================================================= */
/* Subsystem Lifecycle & Controls                                            */
/* ========================================================================= */

zx_status_t audio_hal_init(void) {
    if (s_audio_initialized) {
        return ZX_OK;
    }

    memset(s_playback_buffer, 0, sizeof(s_playback_buffer));
    memset(s_capture_buffer, 0, sizeof(s_capture_buffer));
    memset(&s_audio_telemetry, 0, sizeof(s_audio_telemetry));

    s_play_head = 0;
    s_play_tail = 0;
    s_cap_head = 0;
    s_cap_tail = 0;

    s_audio_telemetry.master_volume = AUDIO_VOLUME_DEFAULT;
    s_audio_telemetry.is_muted = false;
    s_audio_telemetry.current_output = AUDIO_ENDPOINT_OUT_SPEAKER;
    s_audio_telemetry.current_input = AUDIO_ENDPOINT_IN_MIC_MAIN;
    s_audio_telemetry.playback_state = AUDIO_STREAM_STATE_STOPPED;
    s_audio_telemetry.capture_state = AUDIO_STREAM_STATE_STOPPED;

    s_audio_initialized = true;
    return ZX_OK;
}

zx_status_t audio_set_master_volume(uint8_t volume_percent) {
    if (volume_percent > AUDIO_VOLUME_MAX) {
        volume_percent = AUDIO_VOLUME_MAX;
    }
    s_audio_telemetry.master_volume = volume_percent;
    return ZX_OK;
}

zx_status_t audio_get_master_volume(uint8_t *out_volume_percent) {
    if (!out_volume_percent) return ZX_ERR_INVALID_ARGS;
    *out_volume_percent = s_audio_telemetry.master_volume;
    return ZX_OK;
}

zx_status_t audio_set_mute(bool muted) {
    s_audio_telemetry.is_muted = muted;
    return ZX_OK;
}

bool audio_is_muted(void) {
    return s_audio_telemetry.is_muted;
}

zx_status_t audio_set_output_endpoint(audio_output_endpoint_t endpoint) {
    if (endpoint > AUDIO_ENDPOINT_OUT_BLUETOOTH) {
        return ZX_ERR_INVALID_ARGS;
    }
    s_audio_telemetry.current_output = endpoint;
    return ZX_OK;
}

zx_status_t audio_set_input_endpoint(audio_input_endpoint_t endpoint) {
    if (endpoint > AUDIO_ENDPOINT_IN_HEADSET) {
        return ZX_ERR_INVALID_ARGS;
    }
    s_audio_telemetry.current_input = endpoint;
    return ZX_OK;
}

zx_status_t audio_start_playback(void) {
    s_audio_telemetry.playback_state = AUDIO_STREAM_STATE_RUNNING;
    return ZX_OK;
}

zx_status_t audio_stop_playback(void) {
    s_audio_telemetry.playback_state = AUDIO_STREAM_STATE_STOPPED;
    return ZX_OK;
}

zx_status_t audio_start_capture(void) {
    s_audio_telemetry.capture_state = AUDIO_STREAM_STATE_RUNNING;
    return ZX_OK;
}

zx_status_t audio_stop_capture(void) {
    s_audio_telemetry.capture_state = AUDIO_STREAM_STATE_STOPPED;
    return ZX_OK;
}

/* ========================================================================= */
/* PCM Streaming Operations                                                  */
/* ========================================================================= */

zx_status_t audio_write_pcm(const int16_t *samples, size_t frame_count, size_t *out_written) {
    if (!samples || !out_written) return ZX_ERR_INVALID_ARGS;
    if (!s_audio_initialized) return ZX_ERR_UNAVAILABLE;

    size_t head = s_play_head;
    size_t tail = s_play_tail;
    size_t used = head - tail;
    size_t free_frames = AUDIO_RING_BUFFER_FRAMES - used;

    if (free_frames == 0) {
        s_audio_telemetry.playback_buffer_underruns++;
        *out_written = 0;
        return ZX_ERR_BUFFER_TOO_SMALL;
    }

    size_t to_write = (frame_count < free_frames) ? frame_count : free_frames;
    uint32_t vol = s_audio_telemetry.is_muted ? 0 : s_audio_telemetry.master_volume;

    for (size_t f = 0; f < to_write; f++) {
        size_t ring_idx = (head + f) & AUDIO_RING_BUFFER_MASK;
        int32_t left = samples[f * 2 + 0];
        int32_t right = samples[f * 2 + 1];

        /* Apply software volume attenuation */
        left = (left * (int32_t)vol) / 100;
        right = (right * (int32_t)vol) / 100;

        s_playback_buffer[ring_idx * 2 + 0] = (int16_t)left;
        s_playback_buffer[ring_idx * 2 + 1] = (int16_t)right;
    }

    s_play_head = head + to_write;
    s_audio_telemetry.playback_frames_submitted += to_write;
    *out_written = to_write;
    return ZX_OK;
}

zx_status_t audio_read_pcm(int16_t *out_samples, size_t frame_count, size_t *out_read) {
    if (!out_samples || !out_read) return ZX_ERR_INVALID_ARGS;
    if (!s_audio_initialized) return ZX_ERR_UNAVAILABLE;

    size_t head = s_cap_head;
    size_t tail = s_cap_tail;
    size_t available = head - tail;

    if (available == 0) {
        /* Capture buffer underrun/starvation: populate with silence */
        memset(out_samples, 0, frame_count * AUDIO_FRAME_SIZE_STEREO);
        *out_read = 0;
        return ZX_OK;
    }

    size_t to_read = (frame_count < available) ? frame_count : available;

    for (size_t f = 0; f < to_read; f++) {
        size_t ring_idx = (tail + f) & AUDIO_RING_BUFFER_MASK;
        out_samples[f * 2 + 0] = s_capture_buffer[ring_idx * 2 + 0];
        out_samples[f * 2 + 1] = s_capture_buffer[ring_idx * 2 + 1];
    }

    s_cap_tail = tail + to_read;
    s_audio_telemetry.capture_frames_read += to_read;
    *out_read = to_read;
    return ZX_OK;
}

zx_status_t audio_get_telemetry(audio_telemetry_t *out_telemetry) {
    if (!out_telemetry) return ZX_ERR_INVALID_ARGS;
    if (!s_audio_initialized) return ZX_ERR_UNAVAILABLE;
    memcpy(out_telemetry, &s_audio_telemetry, sizeof(audio_telemetry_t));
    return ZX_OK;
}

/* ========================================================================= */
/* Acoustic Synthesis Utilities                                              */
/* ========================================================================= */

void audio_generate_sine_tone(int16_t *buffer, size_t frame_count, uint32_t frequency_hz, uint32_t sample_rate) {
    if (!buffer || frame_count == 0 || sample_rate == 0) return;

    /* Phase increment: phase_inc = (frequency_hz * 256) / sample_rate */
    uint32_t phase_inc = (frequency_hz * 256) / sample_rate;
    if (phase_inc == 0) phase_inc = 1;

    uint32_t phase = 0;
    for (size_t i = 0; i < frame_count; i++) {
        int16_t sample = integer_sine((uint8_t)(phase & 0xFF));
        buffer[i * 2 + 0] = sample; /* Left channel */
        buffer[i * 2 + 1] = sample; /* Right channel */
        phase += phase_inc;
    }
}
