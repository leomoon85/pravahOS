// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file sensory_bridge.js
 * PravahOS Real-Time Mobile HAL Bridge & Sensory Feeds Subsystem.
 *
 * Implements:
 * 1. Camera Sensor Viewfinder: live SMPTE color bars or webcam feed in an animated
 *    viewfinder with front/rear sensor switching, digital zoom, and photo shutter trigger.
 * 2. Audio PCM Stream Visualizer: animated audio oscilloscope waveform and FFT spectrogram
 *    bars tied to the 48kHz 16-bit stereo Audio HAL ring buffer.
 * 3. Dynamic Thermal Closed-Loop: connects SoC temperature sensors to inference execution,
 *    dynamically downgrading model precision (INT8 -> INT4 -> CPU fallback) and raising
 *    thermal warning HUD alerts when temperatures exceed 75°C.
 * 4. Hardware Air-Gap Switch: physical RF power rail isolation, instantly cutting cellular
 *    modem, Wi-Fi 7, and Bluetooth transceivers, severing open sockets, and presenting
 *    the zero-trust "✕ RADIO CUT" status HUD.
 */

// ============================================================================
// 1. Enums and Constants
// ============================================================================

/**
 * Camera Sensor Identifiers (aligned with kernel/include/kernel/hal/camera.h)
 */
const CameraId = {
  BACK_PRIMARY: 0,   // Sony IMX890 50MP Wide Sensor (f/1.8, 84° FOV, 1080p60 preview)
  FRONT_SELFIE: 1,   // OmniVision OV32B 32MP Front Sensor (f/2.2, 90° FOV, 1080p60)
  BACK_ULTRAWIDE: 2  // Sony IMX355 12MP Ultra-Wide (f/2.2, 120° FOV, 1080p30)
};

const CameraSensorNames = {
  [CameraId.BACK_PRIMARY]: 'Sony IMX890 50MP [REAR WIDE]',
  [CameraId.FRONT_SELFIE]: 'OmniVision OV32B 32MP [FRONT SELFIE]',
  [CameraId.BACK_ULTRAWIDE]: 'Sony IMX355 12MP [REAR ULTRAWIDE]'
};

const CameraPattern = {
  SMPTE_BARS: 'smpte',
  SYNTHETIC_SCENE: 'synthetic',
  WEBCAM: 'webcam'
};

const CameraFormat = {
  NV12: 1,      // YUV420 semi-planar
  RGB888: 2,    // 24-bit packed RGB
  ARGB8888: 3,  // 32-bit display compositor native
  RAW10: 4      // 10-bit Raw Bayer
};

/**
 * Audio HAL Constants (aligned with kernel/include/kernel/hal/audio.h)
 */
const AudioConstants = {
  SAMPLE_RATE_48K: 48000,
  CHANNELS_STEREO: 2,
  BIT_DEPTH_16: 16,
  BYTES_PER_SAMPLE: 2,
  FRAME_SIZE_STEREO: 4,
  RING_BUFFER_FRAMES: 4096,
  VOLUME_MIN: 0,
  VOLUME_MAX: 100,
  VOLUME_DEFAULT: 75
};

const AudioMode = {
  IDLE: 'IDLE',
  PLAYBACK: 'PLAYBACK',
  CAPTURE: 'CAPTURE'
};

const AudioEndpointOut = {
  SPEAKER: 0,
  EARPIECE: 1,
  HEADSET: 2,
  BLUETOOTH: 3
};

const AudioEndpointIn = {
  MIC_MAIN: 0,
  MIC_TOP: 1,
  HEADSET: 2
};

/**
 * Thermal Governor Constants (aligned with HAL.md & power_hal.c)
 */
const ThermalTripPoint = {
  NOMINAL: 'NOMINAL',       // < 48°C: Full DVFS, unthrottled
  WARM: 'WARM',             // 48°C - 61°C: Nominal DVFS step
  THROTTLING: 'THROTTLING', // 62°C - 74°C: INT4 quantization step-down
  CRITICAL: 'CRITICAL',     // 75°C - 84°C: NPU power-gated, CPU fallback active
  EMERGENCY: 'EMERGENCY'    // >= 85°C: Thermal emergency safe clamp
};

const ModelPrecision = {
  INT8: 'INT8',                 // 8-bit quantized weights on NPU (128 tensors/s)
  INT4: 'INT4',                 // 4-bit compressed weights on NPU (72 tensors/s)
  CPU_FALLBACK: 'CPU_FALLBACK', // CPU scalar execution, NPU clock-gated (18.5 tensors/s)
  EMERGENCY_HALT: 'EMERGENCY_HALT' // Emergency execution clamp
};

const RfPowerRailState = {
  ACTIVE: 'ACTIVE', // Energized (3.3V / 1.8V)
  CUT: 'CUT'        // Isolated 0.0V (Air-Gap)
};

// ============================================================================
// 2. Camera Sensor & Viewfinder Bridge
// ============================================================================

/**
 * CameraSensorBridge
 * Models mobile camera sensor stream acquisition, SMPTE test pattern generation,
 * front/rear sensor switching, digital zoom, exposure metadata, and frame snapshots.
 */
class CameraSensorBridge {
  constructor(options = {}) {
    this.currentSensorId = options.sensorId ?? CameraId.BACK_PRIMARY;
    this.patternType = options.patternType || CameraPattern.SMPTE_BARS;
    this.isStreaming = options.autoStart ?? true;
    this.fps = options.fps ?? 60;
    this.exposureTimeUs = 8333; // 1/120s
    this.isoGain = 100;
    this.zoomLevel = 1.0;
    this.flashMode = 'OFF'; // 'OFF', 'AUTO', 'ON', 'TORCH'
    this.frameId = 0;
    this.capturedPhotos = [];
    this.maxPhotoHistory = 20;

    // Viewfinder render state
    this.scanlineOffset = 0;
    this.flashAlpha = 0.0;
    this.webcamVideo = null;
    this.webcamStream = null;

    // Callbacks
    this.onPhotoCaptured = options.onPhotoCaptured || (() => {});
    this.onSensorChanged = options.onSensorChanged || (() => {});
    this.onFrameTick = options.onFrameTick || (() => {});
  }

  /**
   * Switches active camera sensor (Front/Rear).
   * @param {number} [sensorId] Target sensor ID. If omitted, toggles between Back and Front.
   */
  switchSensor(sensorId) {
    if (sensorId === undefined) {
      this.currentSensorId = (this.currentSensorId === CameraId.BACK_PRIMARY)
        ? CameraId.FRONT_SELFIE
        : CameraId.BACK_PRIMARY;
    } else {
      if (sensorId < 0 || sensorId > 2) {
        throw new Error(`Invalid sensor ID: ${sensorId}. Supported: 0, 1, 2`);
      }
      this.currentSensorId = sensorId;
    }

    // Reset zoom when switching lenses
    this.zoomLevel = 1.0;
    this.onSensorChanged({
      sensorId: this.currentSensorId,
      name: this.getCurrentSensorName(),
      isFront: this.isFrontFacing()
    });
    return this.currentSensorId;
  }

  isFrontFacing() {
    return this.currentSensorId === CameraId.FRONT_SELFIE;
  }

  getCurrentSensorName() {
    return CameraSensorNames[this.currentSensorId] || 'Unknown Sensor';
  }

  setPattern(pattern) {
    if (pattern !== CameraPattern.SMPTE_BARS &&
        pattern !== CameraPattern.SYNTHETIC_SCENE &&
        pattern !== CameraPattern.WEBCAM) {
      throw new Error(`Unsupported camera pattern: ${pattern}`);
    }
    this.patternType = pattern;
    if (pattern === CameraPattern.WEBCAM) {
      this.initWebcamStream();
    } else {
      this.stopWebcamStream();
    }
  }

  setZoom(zoom) {
    this.zoomLevel = Math.max(0.6, Math.min(5.0, Number(zoom) || 1.0));
    return this.zoomLevel;
  }

  setExposure(exposureUs, iso) {
    this.exposureTimeUs = Math.max(100, Math.min(100000, Math.round(exposureUs)));
    this.isoGain = Math.max(50, Math.min(6400, Math.round(iso)));
  }

  startStream() {
    this.isStreaming = true;
  }

  stopStream() {
    this.isStreaming = false;
  }

  toggleStream() {
    this.isStreaming = !this.isStreaming;
    return this.isStreaming;
  }

  /**
   * Initializes real webcam feed if in a browser environment with mediaDevices.
   */
  async initWebcamStream() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    try {
      const facingMode = this.isFrontFacing() ? 'user' : 'environment';
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      this.webcamStream = stream;
      if (typeof document !== 'undefined') {
        const video = document.createElement('video');
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play();
        this.webcamVideo = video;
      }
      return true;
    } catch (_) {
      // Gracefully fall back to SMPTE bars if user denies webcam or error occurs
      this.patternType = CameraPattern.SMPTE_BARS;
      return false;
    }
  }

  stopWebcamStream() {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach((track) => track.stop());
      this.webcamStream = null;
    }
    this.webcamVideo = null;
  }

  /**
   * Captures a photo frame, generating full metadata, shutter flash, and frame record.
   */
  capturePhoto() {
    this.frameId++;
    const timestamp = Date.now();
    const isFront = this.isFrontFacing();

    const photoRecord = {
      frameId: this.frameId,
      photoId: `IMG_${timestamp}_${String(this.frameId).padStart(4, '0')}`,
      timestamp,
      sensorId: this.currentSensorId,
      sensorName: this.getCurrentSensorName(),
      isFrontFacing: isFront,
      resolution: isFront ? { width: 1920, height: 1080 } : { width: 3840, height: 2160 },
      format: CameraFormat.ARGB8888,
      exposureTimeUs: this.exposureTimeUs,
      shutterSpeed: `1/${Math.round(1000000 / this.exposureTimeUs)}s`,
      isoGain: this.isoGain,
      zoomLevel: this.zoomLevel,
      colorProfile: 'P3 D65 Wide Color',
      flashFired: this.flashMode === 'ON' || this.flashMode === 'TORCH',
      patternType: this.patternType
    };

    this.capturedPhotos.unshift(photoRecord);
    if (this.capturedPhotos.length > this.maxPhotoHistory) {
      this.capturedPhotos.pop();
    }

    // Trigger visual shutter flash
    this.flashAlpha = 0.85;

    this.onPhotoCaptured(photoRecord);
    return photoRecord;
  }

  /**
   * Returns SMPTE color bar definitions matching ITU-R BT.601 standard.
   */
  static getSmpteColors() {
    return [
      { name: 'White', hex: '#EBEBEB', r: 235, g: 235, b: 235 },
      { name: 'Yellow', hex: '#EBEB10', r: 235, g: 235, b: 16 },
      { name: 'Cyan', hex: '#10EBEB', r: 16, g: 235, b: 235 },
      { name: 'Green', hex: '#10EB10', r: 16, g: 235, b: 16 },
      { name: 'Magenta', hex: '#EB10EB', r: 235, g: 16, b: 235 },
      { name: 'Red', hex: '#EB1010', r: 235, g: 16, b: 16 },
      { name: 'Blue', hex: '#1010EB', r: 16, g: 16, b: 235 },
      { name: 'Black', hex: '#101010', r: 16, g: 16, b: 16 }
    ];
  }

  /**
   * Renders the interactive camera viewfinder frame onto an HTML Canvas context.
   * Works with both live browser canvases and mock contexts.
   */
  renderViewfinder(canvas, options = {}) {
    if (!canvas) return;
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return;

    const w = canvas.width || 412;
    const h = canvas.height || 600;

    if (!this.isStreaming) {
      // Standby screen
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#64748b';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CAMERA SENSOR STANDBY', w / 2, h / 2);
      return;
    }

    ctx.save();

    // 1. Render Base Video Pattern
    if (this.patternType === CameraPattern.WEBCAM && this.webcamVideo && this.webcamVideo.readyState >= 2) {
      // Draw live webcam feed
      if (this.isFrontFacing()) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1); // Mirror front camera preview
      }
      ctx.drawImage(this.webcamVideo, 0, 0, w, h);
      if (this.isFrontFacing()) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else if (this.patternType === CameraPattern.SYNTHETIC_SCENE) {
      this.renderSyntheticScene(ctx, w, h);
    } else {
      // Default: SMPTE 75% Color Bars
      this.renderSmpteBars(ctx, w, h);
    }

    // 2. Scanline animation
    this.scanlineOffset = (this.scanlineOffset + 3) % h;
    ctx.fillStyle = 'rgba(0, 229, 255, 0.06)';
    ctx.fillRect(0, this.scanlineOffset, w, 2);

    // 3. Rule of Thirds Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 3, 0);
    ctx.lineTo(w / 3, h);
    ctx.moveTo((2 * w) / 3, 0);
    ctx.lineTo((2 * w) / 3, h);
    ctx.moveTo(0, h / 3);
    ctx.lineTo(w, h / 3);
    ctx.moveTo(0, (2 * h) / 3);
    ctx.lineTo(w, (2 * h) / 3);
    ctx.stroke();

    // 4. Center Autofocus Reticle [ + ]
    const cx = w / 2;
    const cy = h / 2;
    const box = 32;
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    // Corners
    ctx.beginPath();
    // Top-left
    ctx.moveTo(cx - box, cy - box + 10);
    ctx.lineTo(cx - box, cy - box);
    ctx.lineTo(cx - box + 10, cy - box);
    // Top-right
    ctx.moveTo(cx + box - 10, cy - box);
    ctx.lineTo(cx + box, cy - box);
    ctx.lineTo(cx + box, cy - box + 10);
    // Bottom-left
    ctx.moveTo(cx - box, cy + box - 10);
    ctx.lineTo(cx - box, cy + box);
    ctx.lineTo(cx - box + 10, cy + box);
    // Bottom-right
    ctx.moveTo(cx + box - 10, cy + box);
    ctx.lineTo(cx + box, cy + box);
    ctx.lineTo(cx + box, cy + box - 10);
    // Center dot
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx + 4, cy);
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx, cy + 4);
    ctx.stroke();

    // 5. Digital Zoom Overlay (if zoomed)
    if (this.zoomLevel !== 1.0) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
      ctx.fillRect(cx - 30, cy + box + 10, 60, 20);
      ctx.fillStyle = '#00e5ff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${this.zoomLevel.toFixed(1)}x`, cx, cy + box + 24);
    }

    // 6. Viewfinder Header & Footer HUD Overlays
    this.renderHudOverlays(ctx, w, h);

    // 7. Shutter Flash Effect
    if (this.flashAlpha > 0.01) {
      ctx.fillStyle = `rgba(255, 255, 255, ${this.flashAlpha})`;
      ctx.fillRect(0, 0, w, h);
      this.flashAlpha *= 0.65; // Quick decay
    }

    ctx.restore();
    this.onFrameTick(this.frameId);
  }

  renderSmpteBars(ctx, w, h) {
    const bars = CameraSensorBridge.getSmpteColors();
    const barWidth = w / bars.length;
    const topBarHeight = Math.floor(h * 0.68);
    const midBarHeight = Math.floor(h * 0.08);
    const bottomBarHeight = h - topBarHeight - midBarHeight;

    // 1. Top Section: 75% standard color bars
    for (let i = 0; i < bars.length; i++) {
      ctx.fillStyle = bars[i].hex;
      ctx.fillRect(i * barWidth, 0, barWidth + 1, topBarHeight);
    }

    // 2. Mid Section: Castellation alternating bars (Blue, Black, Magenta, Black, Cyan, Black, White)
    const midColors = ['#1010EB', '#101010', '#EB10EB', '#101010', '#10EBEB', '#101010', '#EBEBEB', '#101010'];
    for (let i = 0; i < midColors.length; i++) {
      ctx.fillStyle = midColors[i];
      ctx.fillRect(i * barWidth, topBarHeight, barWidth + 1, midBarHeight);
    }

    // 3. Bottom Section: I-signal, 100% white, Q-signal, Black, pluge pulses (-4%, 0%, +4% IRE)
    const yBot = topBarHeight + midBarHeight;
    const botWidth = w / 5;

    // -I block (Cyan-orange color balance)
    ctx.fillStyle = '#002144';
    ctx.fillRect(0, yBot, botWidth, bottomBarHeight);

    // 100% White reference
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(botWidth, yBot, botWidth, bottomBarHeight);

    // +Q block (Purple)
    ctx.fillStyle = '#320059';
    ctx.fillRect(botWidth * 2, yBot, botWidth, bottomBarHeight);

    // Black baseline
    ctx.fillStyle = '#101010';
    ctx.fillRect(botWidth * 3, yBot, botWidth, bottomBarHeight);

    // Pluge pulse region (Sub-black, reference black, above-black)
    const plugeRegionW = w - botWidth * 4;
    const subW = plugeRegionW / 3;
    ctx.fillStyle = '#050505'; // -4% IRE
    ctx.fillRect(botWidth * 4, yBot, subW, bottomBarHeight);
    ctx.fillStyle = '#101010'; // 0% IRE
    ctx.fillRect(botWidth * 4 + subW, yBot, subW, bottomBarHeight);
    ctx.fillStyle = '#1B1B1B'; // +4% IRE
    ctx.fillRect(botWidth * 4 + subW * 2, yBot, subW + 1, bottomBarHeight);
  }

  renderSyntheticScene(ctx, w, h) {
    // Futuristic cybernetic wireframe scene
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a192f');
    grad.addColorStop(0.5, '#020c1b');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Perspective floor grid
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.lineWidth = 1;
    const horizonY = h * 0.55;

    // Horizontal lines
    for (let y = horizonY; y < h; y += (y - horizonY) * 0.35 + 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Converging lines
    const cx = w / 2;
    for (let x = -w * 0.5; x <= w * 1.5; x += 40) {
      ctx.beginPath();
      ctx.moveTo(cx, horizonY);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Moving target sphere/cube
    const t = Date.now() / 1000;
    const targetX = cx + Math.sin(t * 1.5) * (w * 0.28);
    const targetY = horizonY - 40 + Math.cos(t * 2) * 25;

    ctx.fillStyle = 'rgba(124, 77, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(targetX, targetY, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#00e5ff';
    ctx.stroke();
  }

  renderHudOverlays(ctx, w, h) {
    // Top Bar Pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(10, 10, w - 20, 28);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeRect(10, 10, w - 20, 28);

    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(this.getCurrentSensorName(), 18, 28);

    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';
    const now = new Date();
    const timeStr = now.toISOString().substring(11, 23);
    ctx.fillText(`${timeStr} • ${this.patternType.toUpperCase()}`, w - 18, 28);

    // Bottom Bar HUD
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(10, h - 36, w - 20, 26);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeRect(10, h - 36, w - 20, 26);

    ctx.fillStyle = '#00e676';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    const shutterSpeedStr = `1/${Math.round(1000000 / this.exposureTimeUs)}s`;
    ctx.fillText(`ISO ${this.isoGain} • ${shutterSpeedStr} • RAW10 • 1080p60`, 18, h - 19);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`SNAPS: ${this.capturedPhotos.length}`, w - 18, h - 19);
  }
}

// ============================================================================
// 3. Audio PCM Stream Visualizer & HAL Bridge
// ============================================================================

/**
 * AudioHalBridge
 * Models the PravahOS 48kHz 16-bit stereo PCM audio subsystem, lock-free ring buffer,
 * real-time waveform generator, frequency spectrogram bars, and acoustic mic input.
 */
class AudioHalBridge {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || AudioConstants.SAMPLE_RATE_48K;
    this.channels = options.channels || AudioConstants.CHANNELS_STEREO;
    this.bufferSize = options.bufferSize || AudioConstants.RING_BUFFER_FRAMES;
    this.masterVolume = options.volume ?? AudioConstants.VOLUME_DEFAULT;
    this.isMuted = Boolean(options.muted);
    this.mode = options.mode || AudioMode.PLAYBACK;

    this.currentOutput = options.outputEndpoint || AudioEndpointOut.SPEAKER;
    this.currentInput = options.inputEndpoint || AudioEndpointIn.MIC_MAIN;

    // Ring Buffer (Float32 for audio synthesis, converted to Int16)
    this.ringBuffer = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.readIndex = 0;

    // Telemetry stats
    this.stats = {
      playbackFramesSubmitted: 0,
      playbackFramesConsumed: 0,
      playbackUnderruns: 0,
      captureFramesRecorded: 0,
      captureFramesRead: 0,
      captureOverruns: 0
    };

    // Phase accumulator for procedural tone generation
    this.phase = 0;
    this.toneFrequency = 440; // A4 440Hz standard
    this.isPlaying = options.autoPlay ?? true;

    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});

    // Pre-populate buffer with initial sine wave
    this.synthesizePcmChunk(512);
  }

  setMasterVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(100, Math.round(vol)));
    this.onStateChange(this.getTelemetry());
    return this.masterVolume;
  }

  setMute(mute) {
    this.isMuted = Boolean(mute);
    this.onStateChange(this.getTelemetry());
    return this.isMuted;
  }

  setMode(mode) {
    if (mode !== AudioMode.PLAYBACK && mode !== AudioMode.CAPTURE && mode !== AudioMode.IDLE) {
      throw new Error(`Invalid audio mode: ${mode}`);
    }
    this.mode = mode;
    this.onStateChange(this.getTelemetry());
  }

  startPlayback(freq = 440) {
    this.mode = AudioMode.PLAYBACK;
    this.toneFrequency = freq;
    this.isPlaying = true;
    this.onStateChange(this.getTelemetry());
  }

  stopPlayback() {
    this.isPlaying = false;
    this.mode = AudioMode.IDLE;
    this.onStateChange(this.getTelemetry());
  }

  startCapture() {
    this.mode = AudioMode.CAPTURE;
    this.isPlaying = true;
    this.onStateChange(this.getTelemetry());
  }

  stopCapture() {
    this.isPlaying = false;
    this.mode = AudioMode.IDLE;
    this.onStateChange(this.getTelemetry());
  }

  /**
   * Synthesizes PCM frames into the ring buffer.
   * Mode PLAYBACK: Harmonically rich acoustic tone.
   * Mode CAPTURE: Procedural human speech formant modulation.
   */
  synthesizePcmChunk(frameCount = 256) {
    const vol = this.isMuted ? 0 : this.masterVolume / 100.0;
    const dt = (2 * Math.PI * this.toneFrequency) / this.sampleRate;

    for (let i = 0; i < frameCount; i++) {
      let sample = 0;

      if (!this.isPlaying) {
        sample = 0;
      } else if (this.mode === AudioMode.PLAYBACK) {
        // Fundamental + 2nd + 3rd harmonic
        const s1 = Math.sin(this.phase);
        const s2 = 0.35 * Math.sin(this.phase * 2.0);
        const s3 = 0.15 * Math.sin(this.phase * 3.0);
        sample = (s1 + s2 + s3) * 0.7 * vol;
        this.phase += dt;
        if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      } else if (this.mode === AudioMode.CAPTURE) {
        // Simulated voice mic: 130Hz pitch + formant resonance + ambient noise
        const voiceDt = (2 * Math.PI * 130) / this.sampleRate;
        const formant1 = Math.sin(this.phase * 3.8); // F1 ~500Hz
        const formant2 = 0.5 * Math.sin(this.phase * 11.5); // F2 ~1500Hz
        const noise = (Math.random() - 0.5) * 0.05;
        sample = (formant1 + formant2 + noise) * 0.55 * vol;
        this.phase += voiceDt;
        if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      }

      this.ringBuffer[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.bufferSize;

      if (this.mode === AudioMode.PLAYBACK) {
        this.stats.playbackFramesSubmitted++;
      } else {
        this.stats.captureFramesRecorded++;
      }
    }
  }

  /**
   * Reads raw 16-bit PCM samples from the ring buffer.
   */
  getRecentPcmSamples(sampleCount = 256) {
    const result = new Int16Array(sampleCount);
    let idx = (this.writeIndex - sampleCount + this.bufferSize) % this.bufferSize;

    for (let i = 0; i < sampleCount; i++) {
      const floatVal = this.ringBuffer[idx];
      // Quantize to signed 16-bit: -32768 .. 32767
      result[i] = Math.max(-32768, Math.min(32767, Math.round(floatVal * 32767)));
      idx = (idx + 1) % this.bufferSize;
    }
    return result;
  }

  /**
   * Calculates Root-Mean-Square (RMS) amplitude in decibels Full Scale (dBFS).
   */
  calculateRmsDbfs(sampleCount = 256) {
    if (this.isMuted || !this.isPlaying) return -96.0;

    let sumSquares = 0;
    let idx = (this.writeIndex - sampleCount + this.bufferSize) % this.bufferSize;

    for (let i = 0; i < sampleCount; i++) {
      const v = this.ringBuffer[idx];
      sumSquares += v * v;
      idx = (idx + 1) % this.bufferSize;
    }

    const rms = Math.sqrt(sumSquares / sampleCount);
    if (rms < 0.00001) return -96.0;
    const dbfs = 20 * Math.log10(rms);
    return Math.max(-96.0, Math.min(0.0, dbfs));
  }

  /**
   * Approximates FFT frequency spectrum magnitudes across N equalizer bins.
   */
  getSpectrumBins(numBins = 16) {
    const bins = new Float32Array(numBins);
    const rms = Math.pow(10, this.calculateRmsDbfs(256) / 20.0);
    const t = Date.now() / 200;

    for (let b = 0; b < numBins; b++) {
      // Natural logarithmic frequency distribution weighting
      const freqWeight = Math.sin((b / (numBins - 1)) * Math.PI * 0.85 + 0.15);
      const jitter = Math.sin(t + b * 0.8) * 0.15 + 0.85;
      bins[b] = Math.max(0.05, Math.min(1.0, rms * freqWeight * jitter));
    }
    return bins;
  }

  /**
   * Renders the animated PCM oscilloscope waveform and VU spectrogram bars.
   */
  renderAudioVisualizer(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return;

    // Synthesize fresh frames each render tick
    this.synthesizePcmChunk(64);

    const w = canvas.width || 320;
    const h = canvas.height || 140;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Dark sleek background
    ctx.fillStyle = '#090e17';
    ctx.fillRect(0, 0, w, h);

    // Subtle horizontal zero line
    const midY = Math.floor(h * 0.42);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // 1. Draw Oscilloscope Waveform (Top 60% of canvas)
    const samples = this.getRecentPcmSamples(128);
    const step = w / (samples.length - 1);

    ctx.beginPath();
    const isMic = this.mode === AudioMode.CAPTURE;
    ctx.strokeStyle = isMic ? '#00e676' : '#00e5ff'; // Green for mic, cyan for playback
    ctx.lineWidth = 2;
    ctx.shadowColor = isMic ? 'rgba(0, 230, 118, 0.4)' : 'rgba(0, 229, 255, 0.4)';
    ctx.shadowBlur = 6;

    for (let i = 0; i < samples.length; i++) {
      const normalized = samples[i] / 32768.0; // -1.0 to 1.0
      const y = midY - normalized * (midY * 0.8);
      const x = i * step;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 2. Draw Equalizer Spectrogram Bars (Bottom 40% of canvas)
    const numBars = 24;
    const barSpacing = 2;
    const totalBarWidth = w - 16;
    const barWidth = (totalBarWidth - (numBars - 1) * barSpacing) / numBars;
    const specY = h - 6;
    const maxBarH = h * 0.38;

    const bins = this.getSpectrumBins(numBars);

    for (let b = 0; b < numBars; b++) {
      const mag = bins[b];
      const barH = Math.max(3, mag * maxBarH);
      const x = 8 + b * (barWidth + barSpacing);
      const y = specY - barH;

      // Color gradient: Cyan -> Emerald -> Amber
      let col = '#00e5ff';
      if (mag > 0.8) col = '#ffab00';
      else if (mag > 0.5) col = '#00e676';

      ctx.fillStyle = col;
      ctx.fillRect(x, y, barWidth, barH);
    }

    // 3. Audio Telemetry Header Overlay
    ctx.fillStyle = isMic ? '#00e676' : '#00e5ff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    const modeLabel = isMic ? '● CAPTURE [MIC_MAIN]' : '▶ PLAYBACK [SPEAKER]';
    ctx.fillText(`${modeLabel} • 48kHz 16-bit`, 8, 14);

    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';
    const rmsDbfs = this.calculateRmsDbfs(128);
    ctx.fillText(`RMS: ${rmsDbfs.toFixed(1)} dBFS • VOL: ${this.masterVolume}%`, w - 8, 14);

    ctx.restore();
  }

  getTelemetry() {
    return {
      sampleRate: this.sampleRate,
      channels: this.channels,
      bitDepth: AudioConstants.BIT_DEPTH_16,
      masterVolume: this.masterVolume,
      isMuted: this.isMuted,
      mode: this.mode,
      isPlaying: this.isPlaying,
      rmsDbfs: this.calculateRmsDbfs(256),
      currentOutput: this.currentOutput,
      currentInput: this.currentInput,
      stats: { ...this.stats }
    };
  }
}

// ============================================================================
// 4. Closed-Loop Thermal Governor & Dynamic Model Precision Bridge
// ============================================================================

/**
 * ThermalGovernorBridge
 * Connects physical/emulated SoC thermal sensors to inference execution pipelines.
 * Dynamically downgrades model precision (INT8 -> INT4 -> CPU fallback) and raises
 * thermal HUD warnings when temperatures exceed critical thresholds (75°C limit).
 */
class ThermalGovernorBridge {
  constructor(options = {}) {
    this.tempC = options.initialTempC ?? 41;
    this.criticalLimitC = 75; // Mandated thermal warning & throttle threshold
    this.emergencyLimitC = 85;

    this.listeners = new Set();
    this.state = this.evaluateThermalPolicy(this.tempC);
  }

  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Sets SoC temperature and recalculates closed-loop thermal throttling policies.
   * @param {number} tempC SoC temperature in Celsius (30°C - 95°C)
   */
  setTemperature(tempC) {
    this.tempC = Math.max(25, Math.min(105, Math.round(tempC)));
    this.state = this.evaluateThermalPolicy(this.tempC);
    this.notify();
    return this.state;
  }

  /**
   * Evaluates the thermal state and maps temperature to model precision,
   * NPU frequencies, tensor ops throughput, and alert banners.
   */
  evaluateThermalPolicy(tempC) {
    let tripPoint = ThermalTripPoint.NOMINAL;
    let modelPrecision = ModelPrecision.INT8;
    let npuFrequencyMhz = 1000;
    let tensorsPerSec = 128.0;
    let latencyMs = 7.8;
    let thermalWarningActive = false;
    let throttleReason = 'Normal operating conditions. Maximum tensor performance.';

    if (tempC < 48) {
      tripPoint = ThermalTripPoint.NOMINAL;
      modelPrecision = ModelPrecision.INT8;
      npuFrequencyMhz = 1000;
      tensorsPerSec = 128.0;
      latencyMs = 7.8;
      thermalWarningActive = false;
      throttleReason = 'Unthrottled peak execution (INT8). Silicon nominal.';
    } else if (tempC < 62) {
      tripPoint = ThermalTripPoint.WARM;
      modelPrecision = ModelPrecision.INT8;
      npuFrequencyMhz = 850;
      tensorsPerSec = 108.0;
      latencyMs = 9.2;
      thermalWarningActive = false;
      throttleReason = 'Nominal DVFS step down (INT8). Temperature elevated.';
    } else if (tempC < 75) {
      tripPoint = ThermalTripPoint.THROTTLING;
      modelPrecision = ModelPrecision.INT4; // Quantized step-down
      npuFrequencyMhz = 600;
      tensorsPerSec = 72.0;
      latencyMs = 13.9;
      thermalWarningActive = false;
      throttleReason = 'Thermal throttling step-down: Quantized to INT4 weights to lower dynamic power.';
    } else if (tempC < 85) {
      // Temperature EXCEEDS 75°C: UI thermal warning + CPU Fallback
      tripPoint = ThermalTripPoint.CRITICAL;
      modelPrecision = ModelPrecision.CPU_FALLBACK;
      npuFrequencyMhz = 0; // NPU clock-gated / power-gated
      tensorsPerSec = 18.5;
      latencyMs = 54.0;
      thermalWarningActive = true;
      throttleReason = `CRITICAL THERMAL LIMIT EXCEEDED (${tempC}°C > 75°C)! NPU power-gated. Models throttled to CPU scalar fallback.`;
    } else {
      // >= 85°C: Emergency clamp
      tripPoint = ThermalTripPoint.EMERGENCY;
      modelPrecision = ModelPrecision.EMERGENCY_HALT;
      npuFrequencyMhz = 0;
      tensorsPerSec = 4.0;
      latencyMs = 250.0;
      thermalWarningActive = true;
      throttleReason = `EMERGENCY SILICON OVERHEAT (${tempC}°C)! Aggressive thermal clamp enforced to prevent permanent package degradation.`;
    }

    return {
      tempC,
      tripPoint,
      modelPrecision,
      npuFrequencyMhz,
      tensorsPerSec,
      latencyMs,
      thermalWarningActive,
      throttleReason,
      isThrottled: tempC >= 62,
      isCritical: tempC >= 75
    };
  }

  getTelemetry() {
    return { ...this.state };
  }
}

// ============================================================================
// 5. Hardware Air-Gap Switch Subsystem
// ============================================================================

/**
 * AirGapBridge
 * Manages physical RF rail kill switches, cutting 5G modem, Wi-Fi 7, and Bluetooth
 * power rails, severing open sockets, and presenting zero-trust "✕ RADIO CUT" HUD.
 */
class AirGapBridge {
  constructor(options = {}) {
    // PravahOS enforces secure offline air-gap by default
    this.isAirGapActive = options.initialState ?? true;

    // Tracked open sockets / streams to sever
    this.activeSockets = new Set();
    this.severedCount = 0;

    this.listeners = new Set();
    this.state = this.buildState();
  }

  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Registers a socket or network stream handle to be severed when Air-Gap is engaged.
   * @param {object} socketObj Mock or real WebSocket/HTTP handle with close()/abort()/destroy().
   */
  registerSocket(socketObj) {
    if (!socketObj) return;
    if (this.isAirGapActive) {
      // If already air-gapped, immediately reject socket
      this.severSocket(socketObj);
      return;
    }
    this.activeSockets.add(socketObj);
  }

  /**
   * Unregisters a gracefully closed socket.
   */
  unregisterSocket(socketObj) {
    this.activeSockets.delete(socketObj);
  }

  severSocket(socketObj) {
    try {
      if (typeof socketObj.abort === 'function') socketObj.abort();
      else if (typeof socketObj.close === 'function') socketObj.close();
      else if (typeof socketObj.destroy === 'function') socketObj.destroy();
    } catch (_) {}
    this.severedCount++;
  }

  /**
   * Sever all currently open sockets.
   */
  severAllActiveSockets() {
    const count = this.activeSockets.size;
    for (const sock of this.activeSockets) {
      this.severSocket(sock);
    }
    this.activeSockets.clear();
    return count;
  }

  /**
   * Sets Air-Gap state.
   * When true: cuts RF power rails to 0V, drops signal, severs all sockets.
   * When false: re-energizes power rails, restores 5G connection.
   */
  setAirGap(active) {
    this.isAirGapActive = Boolean(active);
    if (this.isAirGapActive) {
      this.severAllActiveSockets();
    }
    this.state = this.buildState();
    this.notify();
    return this.state;
  }

  toggle() {
    return this.setAirGap(!this.isAirGapActive);
  }

  buildState() {
    const isAirGap = this.isAirGapActive;
    return {
      isAirGapActive: isAirGap,
      rfPowerRails: {
        modem: isAirGap ? RfPowerRailState.CUT : RfPowerRailState.ACTIVE,
        wifi: isAirGap ? RfPowerRailState.CUT : RfPowerRailState.ACTIVE,
        bluetooth: isAirGap ? RfPowerRailState.CUT : RfPowerRailState.ACTIVE,
        gnss: isAirGap ? RfPowerRailState.CUT : RfPowerRailState.ACTIVE
      },
      voltageMilliVolts: {
        modem: isAirGap ? 0 : 3300,
        wifi: isAirGap ? 0 : 1800,
        bluetooth: isAirGap ? 0 : 1800
      },
      telephony: {
        statusText: isAirGap ? '✕ RADIO CUT' : '5G UW',
        signalBars: isAirGap ? 0 : 5,
        rssiDbm: isAirGap ? -120 : -68,
        networkName: isAirGap ? 'AIR-GAP ISOLATED' : 'Pravah 5G SA'
      },
      activeSocketsCount: this.activeSockets.size,
      severedSocketsTotal: this.severedCount
    };
  }

  getTelemetry() {
    return { ...this.state };
  }
}

// ============================================================================
// 6. Unified Sensory Feeds & HAL Bridge Master Controller
// ============================================================================

/**
 * SensoryBridge
 * Coordinates Camera, Audio, Thermal Throttling, and Air-Gap subsystems into
 * an integrated Mobile HAL runtime for PravahOS phone emulator.
 */
class SensoryBridge {
  constructor(options = {}) {
    this.camera = new CameraSensorBridge(options.camera || {});
    this.audio = new AudioHalBridge(options.audio || {});
    this.thermal = new ThermalGovernorBridge(options.thermal || {});
    this.airgap = new AirGapBridge(options.airgap || {});

    // Animation / tick handles
    this.renderInterval = null;

    // Link airgap to camera RF rail if configured
    this.airgap.addListener((airgapState) => {
      if (options.onAirGapChange) options.onAirGapChange(airgapState);
    });

    // Link thermal governor
    this.thermal.addListener((thermalState) => {
      if (options.onThermalChange) options.onThermalChange(thermalState);
    });
  }

  /**
   * Starts periodic rendering loops for camera and audio visualizers.
   */
  startAnimationLoops(cameraCanvas, audioCanvas) {
    this.stopAnimationLoops();

    const tick = () => {
      if (cameraCanvas) {
        this.camera.renderViewfinder(cameraCanvas);
      }
      if (audioCanvas) {
        this.audio.renderAudioVisualizer(audioCanvas);
      }
    };

    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      let active = true;
      const loop = () => {
        if (!active) return;
        tick();
        this.renderInterval = window.requestAnimationFrame(loop);
      };
      this.renderInterval = window.requestAnimationFrame(loop);
      this._cancelLoop = () => {
        active = false;
        if (this.renderInterval) window.cancelAnimationFrame(this.renderInterval);
      };
    } else {
      this.renderInterval = setInterval(tick, 33); // ~30 FPS fallback
      this._cancelLoop = () => clearInterval(this.renderInterval);
    }
  }

  stopAnimationLoops() {
    if (this._cancelLoop) {
      this._cancelLoop();
      this._cancelLoop = null;
    }
    this.renderInterval = null;
  }

  /**
   * Generates a unified snapshot of all mobile hardware sensory telemetry.
   */
  getSnapshot() {
    return {
      timestamp: Date.now(),
      camera: {
        sensorId: this.camera.currentSensorId,
        sensorName: this.camera.getCurrentSensorName(),
        isFrontFacing: this.camera.isFrontFacing(),
        isStreaming: this.camera.isStreaming,
        patternType: this.camera.patternType,
        zoomLevel: this.camera.zoomLevel,
        capturedCount: this.camera.capturedPhotos.length,
        lastPhoto: this.camera.capturedPhotos[0] || null
      },
      audio: this.audio.getTelemetry(),
      thermal: this.thermal.getTelemetry(),
      airgap: this.airgap.getTelemetry()
    };
  }
}

// ============================================================================
// 7. Module Exports (CommonJS for Node.js test runner & Global for Browser)
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CameraId,
    CameraSensorNames,
    CameraPattern,
    CameraFormat,
    AudioConstants,
    AudioMode,
    AudioEndpointOut,
    AudioEndpointIn,
    ThermalTripPoint,
    ModelPrecision,
    RfPowerRailState,
    CameraSensorBridge,
    AudioHalBridge,
    ThermalGovernorBridge,
    AirGapBridge,
    SensoryBridge
  };
}

if (typeof window !== 'undefined') {
  window.SensoryBridge = {
    CameraId,
    CameraSensorNames,
    CameraPattern,
    CameraFormat,
    AudioConstants,
    AudioMode,
    AudioEndpointOut,
    AudioEndpointIn,
    ThermalTripPoint,
    ModelPrecision,
    RfPowerRailState,
    CameraSensorBridge,
    AudioHalBridge,
    ThermalGovernorBridge,
    AirGapBridge,
    SensoryBridge
  };
}
