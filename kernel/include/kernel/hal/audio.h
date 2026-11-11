/**
 * @file audio.h
 * @brief PravahOS Mobile PCM Audio Subsystem & Hardware Abstraction Layer.
 *
 * Implements low-latency PCM audio stream management (48kHz, 16-bit signed stereo),
 * lock-free circular ring buffers for output (playback) and input (capture),
 * multi-endpoint stream routing, master volume/mute controls, and synthetic
 * audio synthesis for bare-metal acoustic verification.
 */

#ifndef PRAVAH_KERNEL_HAL_AUDIO_H
#define PRAVAH_KERNEL_HAL_AUDIO_H

#include "kernel/types.h"
#include "kernel/memory.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* Audio Stream Standards & Buffer Sizing                                    */
/* ========================================================================= */

#define AUDIO_SAMPLE_RATE_48K       (48000)
#define AUDIO_DEFAULT_SAMPLE_RATE   AUDIO_SAMPLE_RATE_48K

#define AUDIO_CHANNELS_MONO         (1)
#define AUDIO_CHANNELS_STEREO       (2)
#define AUDIO_DEFAULT_CHANNELS      AUDIO_CHANNELS_STEREO

#define AUDIO_BIT_DEPTH_16          (16)
#define AUDIO_BYTES_PER_SAMPLE      (2)   /**< 16-bit PCM = 2 bytes */
#define AUDIO_FRAME_SIZE_STEREO     (AUDIO_CHANNELS_STEREO * AUDIO_BYTES_PER_SAMPLE) /**< 4 bytes */

/** Ring buffer capacity in frames (power of 2: 4096 frames = ~85.3 ms at 48kHz) */
#define AUDIO_RING_BUFFER_FRAMES    (4096)
#define AUDIO_RING_BUFFER_MASK      (AUDIO_RING_BUFFER_FRAMES - 1)

/* Master volume levels */
#define AUDIO_VOLUME_MIN            (0)
#define AUDIO_VOLUME_MAX            (100)
#define AUDIO_VOLUME_DEFAULT        (75)

/* ========================================================================= */
/* Audio Endpoint Routes                                                     */
/* ========================================================================= */

typedef enum {
    AUDIO_ENDPOINT_OUT_SPEAKER   = 0, /**< Loudspeaker (bottom/stereo) */
    AUDIO_ENDPOINT_OUT_EARPIECE  = 1, /**< Voice call earpiece */
    AUDIO_ENDPOINT_OUT_HEADSET   = 2, /**< 3.5mm or USB-C wired headphone */
    AUDIO_ENDPOINT_OUT_BLUETOOTH = 3  /**< A2DP / BLE Audio sink */
} audio_output_endpoint_t;

typedef enum {
    AUDIO_ENDPOINT_IN_MIC_MAIN   = 0, /**< Primary bottom voice mic */
    AUDIO_ENDPOINT_IN_MIC_TOP    = 1, /**< Top noise-cancellation / ambient mic */
    AUDIO_ENDPOINT_IN_HEADSET    = 2  /**< Wired headset in-line mic */
} audio_input_endpoint_t;

typedef enum {
    AUDIO_STREAM_STATE_STOPPED   = 0,
    AUDIO_STREAM_STATE_RUNNING   = 1,
    AUDIO_STREAM_STATE_PAUSED    = 2,
    AUDIO_STREAM_STATE_STANDBY   = 3
} audio_stream_state_t;

/* ========================================================================= */
/* Audio Telemetry & Stream Statistics                                       */
/* ========================================================================= */

typedef struct {
    uint64_t playback_frames_submitted;
    uint64_t playback_frames_consumed;
    uint32_t playback_buffer_underruns;
    uint64_t capture_frames_recorded;
    uint64_t capture_frames_read;
    uint32_t capture_buffer_overruns;
    uint8_t  master_volume;
    bool     is_muted;
    audio_output_endpoint_t current_output;
    audio_input_endpoint_t  current_input;
    audio_stream_state_t    playback_state;
    audio_stream_state_t    capture_state;
} audio_telemetry_t;

/* ========================================================================= */
/* Audio HAL Public API                                                      */
/* ========================================================================= */

/**
 * @brief Initialize the Mobile Audio HAL, buffers, and hardware mixer.
 */
zx_status_t audio_hal_init(void);

/**
 * @brief Set master playback volume (0 - 100%).
 */
zx_status_t audio_set_master_volume(uint8_t volume_percent);

/**
 * @brief Get current master playback volume.
 */
zx_status_t audio_get_master_volume(uint8_t *out_volume_percent);

/**
 * @brief Set global audio output mute flag.
 */
zx_status_t audio_set_mute(bool muted);

/**
 * @brief Query current mute state.
 */
bool audio_is_muted(void);

/**
 * @brief Select active audio output route.
 */
zx_status_t audio_set_output_endpoint(audio_output_endpoint_t endpoint);

/**
 * @brief Select active audio input recording route.
 */
zx_status_t audio_set_input_endpoint(audio_input_endpoint_t endpoint);

/**
 * @brief Start playback stream pacing.
 */
zx_status_t audio_start_playback(void);

/**
 * @brief Stop playback stream.
 */
zx_status_t audio_stop_playback(void);

/**
 * @brief Write interleaved 16-bit stereo PCM frames into playback ring buffer.
 *
 * @param samples Pointer to 16-bit PCM buffer (L, R, L, R...).
 * @param frame_count Number of stereo frames to write.
 * @param out_written Pointer to receive count of successfully queued frames.
 */
zx_status_t audio_write_pcm(const int16_t *samples, size_t frame_count, size_t *out_written);

/**
 * @brief Start capture stream pacing.
 */
zx_status_t audio_start_capture(void);

/**
 * @brief Stop capture stream.
 */
zx_status_t audio_stop_capture(void);

/**
 * @brief Read recorded interleaved 16-bit stereo PCM frames from capture ring buffer.
 *
 * @param out_samples Pointer to destination buffer.
 * @param frame_count Maximum frames to read.
 * @param out_read Pointer to receive count of frames actually read.
 */
zx_status_t audio_read_pcm(int16_t *out_samples, size_t frame_count, size_t *out_read);

/**
 * @brief Inspect audio subsystem statistics and buffer health.
 */
zx_status_t audio_get_telemetry(audio_telemetry_t *out_telemetry);

/**
 * @brief Synthesize a pure sine wave audio tone for acoustic self-testing.
 *
 * @param buffer Output buffer of 16-bit stereo samples.
 * @param frame_count Number of frames to synthesize.
 * @param frequency_hz Frequency in Hertz (e.g. 440 Hz or 1000 Hz).
 * @param sample_rate Sample rate (e.g. 48000).
 */
void audio_generate_sine_tone(int16_t *buffer, size_t frame_count, uint32_t frequency_hz, uint32_t sample_rate);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_HAL_AUDIO_H */
