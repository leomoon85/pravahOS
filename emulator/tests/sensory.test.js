// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file sensory.test.js
 * Automated test suite for PravahOS Real-Time Mobile HAL Bridge & Sensory Feeds.
 *
 * Validates:
 * 1. Camera Sensor Viewfinder: sensor switching, SMPTE test bars, zoom clamping, and photo snap.
 * 2. Audio PCM Visualizer: 48kHz 16-bit ring buffer, tone/voice synthesis, RMS dBFS, and spectrum bins.
 * 3. Dynamic Thermal Closed-Loop: trip point governance, INT8 -> INT4 -> CPU Fallback throttling,
 *    and >75°C critical limit HUD warnings.
 * 4. Hardware Air-Gap Switch: RF rail isolation, socket severance, and "✕ RADIO CUT" status.
 * 5. Unified SensoryBridge snapshot and lifecycle.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../sensory_bridge.js');

describe('PravahOS Sensory Feeds & Mobile HAL Bridge', () => {

  // ==========================================================================
  // 1. Camera Sensor & Viewfinder Bridge
  // ==========================================================================
  describe('Camera Sensor Viewfinder & Capture Pipeline', () => {
    let camera;

    beforeEach(() => {
      camera = new CameraSensorBridge({
        sensorId: CameraId.BACK_PRIMARY,
        patternType: CameraPattern.SMPTE_BARS,
        autoStart: true
      });
    });

    it('initializes with rear primary sensor (Sony IMX890 50MP) by default', () => {
      assert.equal(camera.currentSensorId, CameraId.BACK_PRIMARY);
      assert.equal(camera.isFrontFacing(), false);
      assert.match(camera.getCurrentSensorName(), /IMX890/i);
      assert.equal(camera.patternType, 'smpte');
      assert.equal(camera.isStreaming, true);
    });

    it('switches between Front Selfie and Rear Primary camera sensors', () => {
      // Toggle to Front
      const s1 = camera.switchSensor();
      assert.equal(s1, CameraId.FRONT_SELFIE);
      assert.equal(camera.isFrontFacing(), true);
      assert.match(camera.getCurrentSensorName(), /OV32B/i);

      // Toggle back to Rear
      const s2 = camera.switchSensor();
      assert.equal(s2, CameraId.BACK_PRIMARY);
      assert.equal(camera.isFrontFacing(), false);

      // Explicit switch to Ultra-Wide
      const s3 = camera.switchSensor(CameraId.BACK_ULTRAWIDE);
      assert.equal(s3, CameraId.BACK_ULTRAWIDE);
      assert.match(camera.getCurrentSensorName(), /IMX355/i);
    });

    it('rejects invalid sensor IDs', () => {
      assert.throws(() => camera.switchSensor(99), /Invalid sensor ID/i);
      assert.throws(() => camera.switchSensor(-1), /Invalid sensor ID/i);
    });

    it('clamps digital zoom levels between 0.6x and 5.0x', () => {
      assert.equal(camera.setZoom(2.5), 2.5);
      assert.equal(camera.setZoom(0.2), 0.6); // Underflow clamp
      assert.equal(camera.setZoom(8.0), 5.0); // Overflow clamp
      assert.equal(camera.setZoom('invalid'), 1.0);
    });

    it('clamps exposure time and ISO gain within hardware bounds', () => {
      camera.setExposure(50, 10);
      assert.equal(camera.exposureTimeUs, 100);
      assert.equal(camera.isoGain, 50);

      camera.setExposure(200000, 10000);
      assert.equal(camera.exposureTimeUs, 100000);
      assert.equal(camera.isoGain, 6400);
    });

    it('generates standard SMPTE 75% color bars adhering to ITU-R BT.601', () => {
      const bars = CameraSensorBridge.getSmpteColors();
      assert.equal(bars.length, 8);
      assert.equal(bars[0].name, 'White');
      assert.equal(bars[1].name, 'Yellow');
      assert.equal(bars[2].name, 'Cyan');
      assert.equal(bars[3].name, 'Green');
      assert.equal(bars[4].name, 'Magenta');
      assert.equal(bars[5].name, 'Red');
      assert.equal(bars[6].name, 'Blue');
      assert.equal(bars[7].name, 'Black');

      // Verify RGB values
      assert.equal(bars[0].r, 235); // 75% White
      assert.equal(bars[5].r, 235); // Red R component
      assert.equal(bars[5].g, 16);  // Red G component
    });

    it('toggles patterns and validates supported pattern types', () => {
      camera.setPattern(CameraPattern.SYNTHETIC_SCENE);
      assert.equal(camera.patternType, 'synthetic');

      camera.setPattern(CameraPattern.SMPTE_BARS);
      assert.equal(camera.patternType, 'smpte');

      assert.throws(() => camera.setPattern('invalid_noise'), /Unsupported camera pattern/i);
    });

    it('captures photo with metadata, resolution, and shutter flash trigger', () => {
      const photo = camera.capturePhoto();
      assert.ok(photo);
      assert.equal(photo.frameId, 1);
      assert.match(photo.photoId, /^IMG_\d+_\d{4}$/);
      assert.equal(photo.sensorId, CameraId.BACK_PRIMARY);
      assert.equal(photo.format, CameraFormat.ARGB8888);
      assert.equal(photo.resolution.width, 3840);
      assert.equal(photo.resolution.height, 2160);
      assert.equal(camera.capturedPhotos.length, 1);
      assert.ok(camera.flashAlpha > 0.5); // Shutter flash initiated
    });

    it('assigns 1080p resolution when capturing from front selfie sensor', () => {
      camera.switchSensor(CameraId.FRONT_SELFIE);
      const photo = camera.capturePhoto();
      assert.equal(photo.isFrontFacing, true);
      assert.equal(photo.resolution.width, 1920);
      assert.equal(photo.resolution.height, 1080);
    });

    it('renders cleanly to a mock Canvas 2D context in headless environment', () => {
      const calls = [];
      const mockCtx = {
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        fillRect: (...args) => calls.push(['fillRect', ...args]),
        strokeRect: (...args) => calls.push(['strokeRect', ...args]),
        beginPath: () => calls.push('beginPath'),
        moveTo: () => calls.push('moveTo'),
        lineTo: () => calls.push('lineTo'),
        stroke: () => calls.push('stroke'),
        fillText: (...args) => calls.push(['fillText', ...args]),
        createLinearGradient: () => ({ addColorStop: () => {} })
      };
      const mockCanvas = {
        width: 412,
        height: 600,
        getContext: () => mockCtx
      };

      camera.renderViewfinder(mockCanvas);
      assert.ok(calls.length > 20);
      assert.ok(calls.includes('save'));
      assert.ok(calls.includes('restore'));
    });
  });

  // ==========================================================================
  // 2. Audio PCM Stream Visualizer & HAL Bridge
  // ==========================================================================
  describe('Audio PCM Stream & Visualizer HAL Bridge', () => {
    let audio;

    beforeEach(() => {
      audio = new AudioHalBridge({
        sampleRate: 48000,
        channels: 2,
        volume: 75,
        mode: AudioMode.PLAYBACK
      });
    });

    it('initializes 48kHz 16-bit stereo ring buffer according to HAL specifications', () => {
      assert.equal(audio.sampleRate, 48000);
      assert.equal(audio.channels, 2);
      assert.equal(audio.ringBuffer.length, 4096);
      assert.equal(audio.masterVolume, 75);
      assert.equal(audio.isMuted, false);
      assert.equal(audio.mode, AudioMode.PLAYBACK);
    });

    it('synthesizes bounded 16-bit signed PCM samples (-32768 to 32767)', () => {
      audio.synthesizePcmChunk(512);
      const samples = audio.getRecentPcmSamples(256);
      assert.equal(samples.length, 256);

      for (let i = 0; i < samples.length; i++) {
        assert.ok(samples[i] >= -32768 && samples[i] <= 32767);
      }
    });

    it('switches between Playback and Voice Mic Capture modes', () => {
      audio.startCapture();
      assert.equal(audio.mode, AudioMode.CAPTURE);
      assert.equal(audio.isPlaying, true);

      audio.synthesizePcmChunk(256);
      assert.ok(audio.stats.captureFramesRecorded >= 256);

      audio.startPlayback(880);
      assert.equal(audio.mode, AudioMode.PLAYBACK);
      assert.equal(audio.toneFrequency, 880);

      audio.stopPlayback();
      assert.equal(audio.mode, AudioMode.IDLE);
      assert.equal(audio.isPlaying, false);
    });

    it('calculates Root-Mean-Square (RMS) dBFS levels accurately', () => {
      audio.startPlayback(440);
      audio.setMasterVolume(100);
      audio.synthesizePcmChunk(256);

      const dbfs = audio.calculateRmsDbfs(256);
      // Playing audio should register between -25 dBFS and 0 dBFS
      assert.ok(dbfs > -30.0 && dbfs <= 0.0);

      // Muted audio should drop to floor (-96 dBFS)
      audio.setMute(true);
      assert.equal(audio.calculateRmsDbfs(256), -96.0);
    });

    it('computes multi-bin frequency spectrogram magnitudes', () => {
      audio.startPlayback(440);
      audio.setMasterVolume(80);
      audio.synthesizePcmChunk(256);

      const bins = audio.getSpectrumBins(16);
      assert.equal(bins.length, 16);
      for (let i = 0; i < bins.length; i++) {
        assert.ok(bins[i] >= 0.0 && bins[i] <= 1.0);
      }
    });

    it('adjusts master volume with strict clamping between 0 and 100%', () => {
      assert.equal(audio.setMasterVolume(-10), 0);
      assert.equal(audio.setMasterVolume(120), 100);
      assert.equal(audio.setMasterVolume(50), 50);
    });

    it('renders waveform and equalizer bars to a mock Canvas context', () => {
      const calls = [];
      const mockCtx = {
        save: () => calls.push('save'),
        restore: () => calls.push('restore'),
        clearRect: () => calls.push('clearRect'),
        fillRect: () => calls.push('fillRect'),
        beginPath: () => calls.push('beginPath'),
        moveTo: () => calls.push('moveTo'),
        lineTo: () => calls.push('lineTo'),
        stroke: () => calls.push('stroke'),
        fillText: () => calls.push('fillText')
      };
      const mockCanvas = {
        width: 320,
        height: 110,
        getContext: () => mockCtx
      };

      audio.renderAudioVisualizer(mockCanvas);
      assert.ok(calls.includes('clearRect'));
      assert.ok(calls.includes('stroke'));
    });
  });

  // ==========================================================================
  // 3. Dynamic Thermal Closed-Loop Throttling
  // ==========================================================================
  describe('Dynamic Thermal Closed-Loop & Model Precision Governor', () => {
    let governor;
    let events;

    beforeEach(() => {
      events = [];
      governor = new ThermalGovernorBridge({ initialTempC: 38 });
      governor.addListener((state) => events.push(state));
    });

    it('evaluates NOMINAL state (<48°C) with unthrottled INT8 tensor precision', () => {
      const s = governor.setTemperature(42);
      assert.equal(s.tripPoint, ThermalTripPoint.NOMINAL);
      assert.equal(s.modelPrecision, ModelPrecision.INT8);
      assert.equal(s.npuFrequencyMhz, 1000);
      assert.equal(s.tensorsPerSec, 128.0);
      assert.equal(s.thermalWarningActive, false);
      assert.equal(s.isThrottled, false);
      assert.equal(s.isCritical, false);
    });

    it('evaluates WARM state (48°C-61°C) with nominal DVFS step (INT8)', () => {
      const s = governor.setTemperature(54);
      assert.equal(s.tripPoint, ThermalTripPoint.WARM);
      assert.equal(s.modelPrecision, ModelPrecision.INT8);
      assert.equal(s.npuFrequencyMhz, 850);
      assert.equal(s.tensorsPerSec, 108.0);
      assert.equal(s.thermalWarningActive, false);
    });

    it('evaluates THROTTLING state (62°C-74°C) with quantized INT4 step-down', () => {
      const s = governor.setTemperature(68);
      assert.equal(s.tripPoint, ThermalTripPoint.THROTTLING);
      assert.equal(s.modelPrecision, ModelPrecision.INT4);
      assert.equal(s.npuFrequencyMhz, 600);
      assert.equal(s.tensorsPerSec, 72.0);
      assert.equal(s.isThrottled, true);
      assert.equal(s.isCritical, false);
      assert.equal(s.thermalWarningActive, false); // Warning reserved for critical >75°C
    });

    it('evaluates CRITICAL state (>=75°C): power-gates NPU and throttles to CPU Fallback with alert banner', () => {
      const s = governor.setTemperature(78);
      assert.equal(s.tripPoint, ThermalTripPoint.CRITICAL);
      assert.equal(s.modelPrecision, ModelPrecision.CPU_FALLBACK);
      assert.equal(s.npuFrequencyMhz, 0); // NPU power-gated
      assert.equal(s.tensorsPerSec, 18.5);
      assert.equal(s.isThrottled, true);
      assert.equal(s.isCritical, true);
      assert.equal(s.thermalWarningActive, true); // Active HUD warning triggered!
      assert.match(s.throttleReason, /78°C > 75°C/);
    });

    it('evaluates EMERGENCY state (>=85°C) with safe halt clamp', () => {
      const s = governor.setTemperature(88);
      assert.equal(s.tripPoint, ThermalTripPoint.EMERGENCY);
      assert.equal(s.modelPrecision, ModelPrecision.EMERGENCY_HALT);
      assert.equal(s.npuFrequencyMhz, 0);
      assert.equal(s.tensorsPerSec, 4.0);
      assert.equal(s.thermalWarningActive, true);
    });

    it('fires listeners upon temperature changes and verifies full closed-loop transitions', () => {
      // Step up from Nominal -> Throttling -> Critical -> Emergency
      governor.setTemperature(40);
      governor.setTemperature(65);
      governor.setTemperature(80);
      governor.setTemperature(35); // Cool down back to Nominal

      assert.equal(events.length, 4);
      assert.equal(events[0].modelPrecision, ModelPrecision.INT8);
      assert.equal(events[1].modelPrecision, ModelPrecision.INT4);
      assert.equal(events[2].modelPrecision, ModelPrecision.CPU_FALLBACK);
      assert.equal(events[2].thermalWarningActive, true);
      assert.equal(events[3].modelPrecision, ModelPrecision.INT8);
      assert.equal(events[3].thermalWarningActive, false);
    });

    it('clamps sensor temperatures between 25°C and 105°C', () => {
      assert.equal(governor.setTemperature(10).tempC, 25);
      assert.equal(governor.setTemperature(150).tempC, 105);
    });
  });

  // ==========================================================================
  // 4. Hardware Air-Gap Kill Switch Subsystem
  // ==========================================================================
  describe('Hardware Air-Gap Kill Switch & RF Power Rails', () => {
    let airgap;

    beforeEach(() => {
      airgap = new AirGapBridge({ initialState: true });
    });

    it('initializes in secure offline Air-Gap state by default', () => {
      const t = airgap.getTelemetry();
      assert.equal(t.isAirGapActive, true);
      assert.equal(t.rfPowerRails.modem, RfPowerRailState.CUT);
      assert.equal(t.rfPowerRails.wifi, RfPowerRailState.CUT);
      assert.equal(t.rfPowerRails.bluetooth, RfPowerRailState.CUT);
      assert.equal(t.voltageMilliVolts.modem, 0);
      assert.equal(t.telephony.statusText, '✕ RADIO CUT');
      assert.equal(t.telephony.signalBars, 0);
      assert.equal(t.telephony.rssiDbm, -120);
    });

    it('re-engages radios and energizes RF rails when air-gap is disabled', () => {
      const t = airgap.setAirGap(false);
      assert.equal(t.isAirGapActive, false);
      assert.equal(t.rfPowerRails.modem, RfPowerRailState.ACTIVE);
      assert.equal(t.rfPowerRails.wifi, RfPowerRailState.ACTIVE);
      assert.equal(t.voltageMilliVolts.modem, 3300);
      assert.equal(t.telephony.statusText, '5G UW');
      assert.equal(t.telephony.signalBars, 5);
      assert.equal(t.telephony.rssiDbm, -68);
    });

    it('toggles air-gap state back and forth cleanly', () => {
      const online = airgap.toggle();
      assert.equal(online.isAirGapActive, false);

      const offline = airgap.toggle();
      assert.equal(offline.isAirGapActive, true);
      assert.equal(offline.telephony.statusText, '✕ RADIO CUT');
    });

    it('instantly severs all open sockets when air-gap is engaged', () => {
      // First, bring online
      airgap.setAirGap(false);

      let sock1Aborted = false;
      let sock2Closed = false;

      const mockSock1 = { abort: () => { sock1Aborted = true; } };
      const mockSock2 = { close: () => { sock2Closed = true; } };

      airgap.registerSocket(mockSock1);
      airgap.registerSocket(mockSock2);
      assert.equal(airgap.activeSockets.size, 2);

      // Now toggle Air-Gap kill switch!
      const result = airgap.setAirGap(true);
      assert.equal(sock1Aborted, true);
      assert.equal(sock2Closed, true);
      assert.equal(result.activeSocketsCount, 0);
      assert.equal(result.severedSocketsTotal, 2);
    });

    it('immediately rejects new sockets when in Air-Gap mode', () => {
      assert.equal(airgap.isAirGapActive, true);
      let rejected = false;
      const sock = { close: () => { rejected = true; } };

      airgap.registerSocket(sock);
      assert.equal(rejected, true);
      assert.equal(airgap.activeSockets.size, 0);
    });
  });

  // ==========================================================================
  // 5. Unified SensoryBridge Master Integration
  // ==========================================================================
  describe('Unified SensoryBridge Master Controller', () => {
    let bridge;

    beforeEach(() => {
      bridge = new SensoryBridge({
        camera: { sensorId: CameraId.BACK_PRIMARY },
        audio: { volume: 80 },
        thermal: { initialTempC: 40 },
        airgap: { initialState: true }
      });
    });

    it('orchestrates all 4 sensory subsystems in a coherent snapshot', () => {
      const snap = bridge.getSnapshot();
      assert.ok(snap.timestamp > 0);

      // Camera snapshot
      assert.equal(snap.camera.sensorId, CameraId.BACK_PRIMARY);
      assert.equal(snap.camera.isFrontFacing, false);
      assert.equal(snap.camera.patternType, 'smpte');

      // Audio snapshot
      assert.equal(snap.audio.sampleRate, 48000);
      assert.equal(snap.audio.masterVolume, 80);

      // Thermal snapshot
      assert.equal(snap.thermal.tempC, 40);
      assert.equal(snap.thermal.modelPrecision, ModelPrecision.INT8);

      // Air-gap snapshot
      assert.equal(snap.airgap.isAirGapActive, true);
      assert.equal(snap.airgap.telephony.statusText, '✕ RADIO CUT');
    });

    it('starts and stops visualizer animation loops without errors', () => {
      bridge.startAnimationLoops(null, null);
      assert.ok(bridge.renderInterval !== null);

      bridge.stopAnimationLoops();
      assert.equal(bridge.renderInterval, null);
    });
  });
});
