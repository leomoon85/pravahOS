// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file emulator.test.js
 * Automated test suite for PravahOS Graphical Mobile Phone Emulator.
 * Validates coordinate normalization, gesture recognition, FIDL event bridging,
 * and hardware HUD state transitions.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  DeviceType,
  InputEventType,
  TouchPhase,
  GestureType,
  DevicePresets,
  normalizeCoordinate,
  integerDistance,
  GestureDecoder,
  InputEventBridge,
  HardwareHUD
} = require('../emulator.js');

describe('PravahOS Phone Emulator Subsystem', () => {

  // ==========================================================================
  // 1. Coordinate Normalization & Distance Math
  // ==========================================================================
  describe('Coordinate Normalization & Math', () => {
    it('normalizes raw digitizer counts (0..32767) to display raster pixels (412x915)', () => {
      // Minimum boundary
      const x0 = normalizeCoordinate(0, 0, 32767, 412);
      assert.equal(x0, 0);

      // Maximum boundary
      const xMax = normalizeCoordinate(32767, 0, 32767, 412);
      assert.equal(xMax, 411);

      // Midpoint
      const xMid = normalizeCoordinate(16383, 0, 32767, 412);
      assert.equal(xMid, 205);

      // Height normalization
      const yMax = normalizeCoordinate(32767, 0, 32767, 915);
      assert.equal(yMax, 914);
    });

    it('clamps raw inputs that exceed digitizer hardware bounds', () => {
      const underflow = normalizeCoordinate(-500, 0, 32767, 412);
      assert.equal(underflow, 0);

      const overflow = normalizeCoordinate(40000, 0, 32767, 412);
      assert.equal(overflow, 411);
    });

    it('supports inverted axis normalization for front sensors', () => {
      const invertedStart = normalizeCoordinate(0, 0, 32767, 412, true);
      assert.equal(invertedStart, 411);

      const invertedEnd = normalizeCoordinate(32767, 0, 32767, 412, true);
      assert.equal(invertedEnd, 0);
    });

    it('calculates integer Euclidean distance accurately', () => {
      // 3-4-5 Pythagorean triangle
      assert.equal(integerDistance(0, 0, 30, 40), 50);
      assert.equal(integerDistance(100, 100, 100, 100), 0);
      assert.equal(integerDistance(-10, -20, 20, 20), 50);
    });
  });

  // ==========================================================================
  // 2. Gesture Recognition State Machine
  // ==========================================================================
  describe('Gesture Recognition Engine', () => {
    let decoder;
    let gestures;
    let rawTouches;

    beforeEach(() => {
      gestures = [];
      rawTouches = [];
      decoder = new GestureDecoder({
        onGesture: (g) => gestures.push(g),
        onRawTouch: (t) => rawTouches.push(t)
      });
    });

    it('detects a single Tap when release occurs within thresholds', () => {
      const t0 = 1000;
      decoder.touchDown(0, 200, 300, t0);
      decoder.touchMove(0, 205, 302, t0 + 50); // slight drift 5px
      const result = decoder.touchUp(0, 205, 302, t0 + 120);

      assert.ok(result);
      assert.equal(result.type, GestureType.TAP);
      assert.equal(result.name, 'TAP');
      assert.equal(result.centerX, 205);
      assert.equal(result.centerY, 302);
      assert.equal(result.touchCount, 1);
      assert.equal(gestures.length, 1);
    });

    it('detects a Double-Tap when two taps occur within 350ms and 35px separation', () => {
      const t0 = 1000;
      // First tap
      decoder.touchDown(0, 150, 250, t0);
      decoder.touchUp(0, 150, 250, t0 + 80);
      assert.equal(gestures.length, 1);
      assert.equal(gestures[0].type, GestureType.TAP);

      // Second tap within 180ms and 10px
      decoder.touchDown(0, 155, 255, t0 + 260);
      const result = decoder.touchUp(0, 155, 255, t0 + 320);

      assert.ok(result);
      assert.equal(result.type, GestureType.DOUBLE_TAP);
      assert.equal(result.name, 'DOUBLE_TAP');
      assert.equal(gestures.length, 2);
    });

    it('detects Long-Press when stationary touch is held for >= 500ms', async () => {
      const t0 = Date.now();
      decoder.touchDown(0, 200, 400, t0);

      // Wait for long press timer to fire
      await new Promise((resolve) => setTimeout(resolve, 550));

      assert.ok(decoder.longPressFired);
      assert.equal(gestures.length, 1);
      assert.equal(gestures[0].type, GestureType.LONG_PRESS);
      assert.equal(gestures[0].name, 'LONG_PRESS');
      assert.equal(gestures[0].centerX, 200);
      assert.equal(gestures[0].centerY, 400);

      // Releasing after long press should not fire an additional tap
      decoder.touchUp(0, 200, 400, Date.now());
      assert.equal(gestures.length, 1);
    });

    it('cancels Long-Press if finger drifts beyond max threshold before timer expires', async () => {
      const t0 = Date.now();
      decoder.touchDown(0, 200, 400, t0);
      // Move 40px away (> 25px threshold)
      decoder.touchMove(0, 240, 400, t0 + 100);

      await new Promise((resolve) => setTimeout(resolve, 550));

      assert.equal(decoder.longPressFired, false);
      assert.equal(gestures.length, 0);
    });

    it('recognizes directional Swipes and computes accurate velocity', () => {
      const t0 = 1000;

      // 1. Swipe Right
      decoder.reset();
      decoder.touchDown(0, 50, 300, t0);
      const swipeRight = decoder.touchUp(0, 250, 300, t0 + 200); // Δx = +200, duration = 200ms
      assert.ok(swipeRight);
      assert.equal(swipeRight.type, GestureType.SWIPE_RIGHT);
      assert.equal(swipeRight.deltaX, 200);
      assert.equal(swipeRight.velocityPxSec, 1000); // 200px / 0.2s = 1000 px/s

      // 2. Swipe Left
      decoder.reset();
      decoder.touchDown(0, 300, 300, t0);
      const swipeLeft = decoder.touchUp(0, 100, 300, t0 + 150); // Δx = -200, duration = 150ms
      assert.ok(swipeLeft);
      assert.equal(swipeLeft.type, GestureType.SWIPE_LEFT);
      assert.equal(swipeLeft.deltaX, -200);

      // 3. Swipe Down
      decoder.reset();
      decoder.touchDown(0, 200, 100, t0);
      const swipeDown = decoder.touchUp(0, 200, 320, t0 + 220); // Δy = +220
      assert.ok(swipeDown);
      assert.equal(swipeDown.type, GestureType.SWIPE_DOWN);
      assert.equal(swipeDown.deltaY, 220);

      // 4. Swipe Up
      decoder.reset();
      decoder.touchDown(0, 200, 500, t0);
      const swipeUp = decoder.touchUp(0, 200, 250, t0 + 250); // Δy = -250
      assert.ok(swipeUp);
      assert.equal(swipeUp.type, GestureType.SWIPE_UP);
      assert.equal(swipeUp.deltaY, -250);
    });

    it('recognizes Multi-Touch Pinch-to-Zoom with two active slots', () => {
      const t0 = 1000;
      // Finger 0 at (100, 400), Finger 1 at (200, 400) -> initial distance = 100px
      decoder.touchDown(0, 100, 400, t0);
      decoder.touchDown(1, 200, 400, t0);

      // Spread fingers outward: Finger 0 at (70, 400), Finger 1 at (230, 400) -> distance = 160px
      decoder.touchMove(0, 70, 400, t0 + 100);
      decoder.touchMove(1, 230, 400, t0 + 100);

      assert.ok(gestures.length >= 1);
      const pinch = gestures[gestures.length - 1];
      assert.equal(pinch.type, GestureType.PINCH_ZOOM);
      assert.equal(pinch.name, 'PINCH_ZOOM');
      assert.equal(pinch.touchCount, 2);
      assert.equal(pinch.centerX, 150);
      assert.equal(pinch.centerY, 400);
      // Scale: 160 / 100 = 1.6x => 1600 milli-units
      assert.equal(pinch.scaleMilli, 1600);
    });
  });

  // ==========================================================================
  // 3. FIDL Input Event Bridge
  // ==========================================================================
  describe('FIDL Input Event Bridge', () => {
    let bridge;
    let emitted;

    beforeEach(() => {
      emitted = [];
      bridge = new InputEventBridge({
        deviceId: 'pravah-touch-virtio-0',
        deviceType: DeviceType.TOUCHSCREEN,
        onEventEmitted: (e) => emitted.push(e)
      });
    });

    it('constructs typed FIDL InputEvent envelopes matching schema', () => {
      const touchEvt = bridge.packageTouchEvent(TouchPhase.DOWN, 0, 206, 457);

      assert.equal(touchEvt.deviceId, 'pravah-touch-virtio-0');
      assert.equal(touchEvt.deviceType, DeviceType.TOUCHSCREEN);
      assert.equal(touchEvt.eventType, InputEventType.TOUCH);
      assert.ok(touchEvt.timestampNs);

      const payload = touchEvt.payload.touch;
      assert.equal(payload.phase, TouchPhase.DOWN);
      assert.equal(payload.point.slot, 0);
      assert.equal(payload.point.screenX, 206);
      assert.equal(payload.point.screenY, 457);
      assert.equal(payload.point.pressure, 512);

      assert.equal(emitted.length, 1);
    });

    it('packages decoded high-level gesture events into FIDL union format', () => {
      const gesture = {
        type: GestureType.SWIPE_UP,
        name: 'SWIPE_UP',
        centerX: 206,
        centerY: 600,
        deltaX: 0,
        deltaY: -200,
        velocityPxSec: 1200,
        durationMs: 160,
        scaleMilli: 1000,
        touchCount: 1
      };

      const gEvent = bridge.packageGestureEvent(gesture);
      assert.equal(gEvent.eventType, InputEventType.GESTURE);
      assert.equal(gEvent.payload.gesture.type, GestureType.SWIPE_UP);
      assert.equal(gEvent.payload.gesture.velocityPxSec, 1200);
    });

    it('maintains a bounded event log buffer without unbounded memory growth', () => {
      bridge.maxLogEntries = 5;
      for (let i = 0; i < 15; i++) {
        bridge.packageTouchEvent(TouchPhase.MOVE, 0, i * 10, i * 10);
      }
      assert.equal(bridge.eventLog.length, 5);
    });
  });

  // ==========================================================================
  // 4. Hardware Status HUD & Telemetry
  // ==========================================================================
  describe('Hardware HUD & Telemetry State', () => {
    let hud;
    let stateChanges;

    beforeEach(() => {
      stateChanges = [];
      hud = new HardwareHUD({
        batteryLevel: 85,
        tempC: 40,
        npuLoad: 35,
        cpuLoad: 20,
        airgap: true,
        onStateChange: (s) => stateChanges.push({ ...s })
      });
    });

    it('initializes with PravahOS secure air-gap enforced by default', () => {
      assert.equal(hud.state.radio.airgap, true);
      assert.equal(hud.state.radio.wifiEnabled, false);
      assert.equal(hud.state.radio.networkName, 'AIR-GAP ISOLATED');
    });

    it('toggles physical air-gap kill switch correctly', () => {
      const nowOffline = hud.toggleAirGap();
      assert.equal(nowOffline, false);
      assert.equal(hud.state.radio.airgap, false);
      assert.equal(hud.state.radio.wifiEnabled, true);
      assert.equal(hud.state.radio.networkName, '5G UW');

      const toggledBack = hud.toggleAirGap();
      assert.equal(toggledBack, true);
      assert.equal(hud.state.radio.airgap, true);
    });

    it('evaluates thermal throttling states based on SoC sensor readings', () => {
      hud.setThermal(42);
      assert.equal(hud.state.thermal.throttleState, 'NOMINAL');

      hud.setThermal(55);
      assert.equal(hud.state.thermal.throttleState, 'WARM');

      hud.setThermal(68);
      assert.equal(hud.state.thermal.throttleState, 'THROTTLING');

      hud.setThermal(82);
      assert.equal(hud.state.thermal.throttleState, 'CRITICAL');
    });

    it('clamps battery levels between 0% and 100%', () => {
      hud.setBatteryLevel(-15);
      assert.equal(hud.state.battery.level, 0);

      hud.setBatteryLevel(145);
      assert.equal(hud.state.battery.level, 100);

      hud.setBatteryLevel(50, true);
      assert.equal(hud.state.battery.level, 50);
      assert.equal(hud.state.battery.charging, true);
    });

    it('clamps NPU and CPU utilization between 0% and 100%', () => {
      hud.setWorkload(150, -20);
      assert.equal(hud.state.npu.utilization, 100);
      assert.equal(hud.state.cpu.utilization, 0);
    });

    it('toggles screen power state between active and sleep', () => {
      assert.equal(hud.state.screen.powered, true);
      const isPowerOn1 = hud.toggleScreenPower();
      assert.equal(isPowerOn1, false);
      assert.equal(hud.state.screen.powered, false);

      const isPowerOn2 = hud.toggleScreenPower();
      assert.equal(isPowerOn2, true);
      assert.equal(hud.state.screen.powered, true);
    });
  });

  // ==========================================================================
  // 5. Preset Configurations
  // ==========================================================================
  describe('Device Presets', () => {
    it('defines valid mobile aspect ratios for supported phone models', () => {
      assert.ok(DevicePresets.pixel8);
      assert.equal(DevicePresets.pixel8.width, 412);
      assert.equal(DevicePresets.pixel8.height, 915);
      assert.equal(DevicePresets.pixel8.ratio, '20:9');

      assert.ok(DevicePresets.iphone15);
      assert.equal(DevicePresets.iphone15.width, 390);
      assert.equal(DevicePresets.iphone15.height, 844);

      assert.ok(DevicePresets.hdplus);
      assert.equal(DevicePresets.hdplus.width, 720);
      assert.equal(DevicePresets.hdplus.height, 1600);
    });
  });

});
