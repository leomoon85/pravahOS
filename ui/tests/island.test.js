// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DynamicIslandState,
  ISLAND_DIMENSIONS,
  DEFAULT_ISLAND_PAYLOADS,
  DynamicIslandController
} from '../shell/island.js';

import {
  HapticType,
  HapticPreset,
  HapticEngine
} from '../motion/haptics.js';

// Minimal DOM Mock Container for Headless Testing
class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    const classes = new Set();
    this.classList = {
      add: (...items) => items.forEach(i => classes.add(i)),
      remove: (...items) => items.forEach(i => classes.delete(i)),
      contains: (i) => classes.has(i),
      toggle: (i) => classes.has(i) ? classes.delete(i) : classes.add(i)
    };
    this.style = {
      _vars: {},
      setProperty(key, val) {
        this._vars[key] = val;
      },
      getPropertyValue(key) {
        return this._vars[key] || '';
      }
    };
    this.innerHTML = '';
    this.eventListeners = {};
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(listener);
  }

  querySelector(selector) {
    // Basic mock query selector
    if (selector.includes('play')) return new MockElement('island-btn-play', 'button');
    if (selector.includes('deny')) return new MockElement('island-policy-deny', 'button');
    if (selector.includes('approve')) return new MockElement('island-policy-approve', 'button');
    return null;
  }
}

// ============================================================================
// 1. Dynamic Island State Machine & Morphing Tests
// ============================================================================

test('Dynamic Island: initializes in COMPACT state by default', () => {
  const island = new DynamicIslandController(null, { enableHaptics: false });
  assert.equal(island.getState(), DynamicIslandState.COMPACT);
  const payload = island.getPayload();
  assert.equal(payload.label, 'AIR-GAP SECURED');
});

test('Dynamic Island: state dimension specifications match Apple/Pixel design tokens', () => {
  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.COMPACT].width, 124);
  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.COMPACT].height, 32);

  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.MUSIC].width, 280);
  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.MUSIC].height, 52);

  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.FLIGHT].width, 295);
  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.FLIGHT].height, 54);

  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.AUTH_SCAN].width, 220);
  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.AUTH_SCAN].height, 58);

  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.POLICY_ALERT].width, 340);
  assert.equal(ISLAND_DIMENSIONS[DynamicIslandState.POLICY_ALERT].height, 118);
});

test('Dynamic Island: morphs through all 5 core states with proper payloads', () => {
  const island = new DynamicIslandController(null, { enableHaptics: false });

  // 1. MUSIC
  island.setMusic({
    title: 'Ambient Echoes',
    artist: 'Pravah Studio Ensemble',
    isPlaying: true
  });
  assert.equal(island.getState(), DynamicIslandState.MUSIC);
  assert.equal(island.getPayload().title, 'Ambient Echoes');
  assert.equal(island.getPayload().artist, 'Pravah Studio Ensemble');
  assert.equal(island.getPayload().isPlaying, true);

  // 2. FLIGHT
  island.setFlight({
    flightNumber: 'AI-202',
    departure: 'DEL',
    arrival: 'BLR',
    countdown: 'T-30m',
    gate: '14B'
  });
  assert.equal(island.getState(), DynamicIslandState.FLIGHT);
  assert.equal(island.getPayload().flightNumber, 'AI-202');
  assert.equal(island.getPayload().gate, '14B');
  assert.equal(island.getPayload().countdown, 'T-30m');

  // 3. AUTH_SCAN
  island.startAuthScan({
    label: 'Validating Neural Biometrics...',
    authType: 'PASSKEY'
  });
  assert.equal(island.getState(), DynamicIslandState.AUTH_SCAN);
  assert.equal(island.getPayload().status, 'SCANNING');
  assert.equal(island.getPayload().label, 'Validating Neural Biometrics...');

  // 4. POLICY_ALERT
  let approvedCalled = false;
  island.triggerPolicyAlert({
    title: 'Financial Irreversible Gate',
    riskLevel: 'IRREVERSIBLE',
    reason: 'Remittance limit reached',
    onApprove: () => { approvedCalled = true; }
  });
  assert.equal(island.getState(), DynamicIslandState.POLICY_ALERT);
  assert.equal(island.getPayload().riskLevel, 'IRREVERSIBLE');
  island.approvePolicy();
  assert.equal(approvedCalled, true);
  // After approval, automatically collapses back to COMPACT
  assert.equal(island.getState(), DynamicIslandState.COMPACT);
});

test('Dynamic Island: rejects invalid state transitions', () => {
  const island = new DynamicIslandController(null, { enableHaptics: false });
  assert.throws(() => {
    island.transitionTo('INVALID_NON_EXISTENT_STATE');
  }, /Invalid DynamicIslandState/);
});

test('Dynamic Island: cycleNextState sequentially steps through states', () => {
  const island = new DynamicIslandController(null, { enableHaptics: false });
  assert.equal(island.getState(), DynamicIslandState.COMPACT);

  island.cycleNextState();
  assert.equal(island.getState(), DynamicIslandState.MUSIC);

  island.cycleNextState();
  assert.equal(island.getState(), DynamicIslandState.FLIGHT);

  island.cycleNextState();
  assert.equal(island.getState(), DynamicIslandState.AUTH_SCAN);

  island.cycleNextState();
  assert.equal(island.getState(), DynamicIslandState.POLICY_ALERT);

  island.cycleNextState();
  assert.equal(island.getState(), DynamicIslandState.COMPACT);
});

test('Dynamic Island: state listeners observe transitions and payloads', () => {
  const island = new DynamicIslandController(null, { enableHaptics: false });
  const recorded = [];

  const unsubscribe = island.onStateChange((newState, prevState, payload) => {
    recorded.push({ newState, prevState, payload });
  });

  island.setMusic({ title: 'Track 1' });
  island.collapse();

  assert.equal(recorded.length, 2);
  assert.equal(recorded[0].newState, DynamicIslandState.MUSIC);
  assert.equal(recorded[0].prevState, DynamicIslandState.COMPACT);
  assert.equal(recorded[1].newState, DynamicIslandState.COMPACT);
  assert.equal(recorded[1].prevState, DynamicIslandState.MUSIC);

  // Test unsubscribe
  unsubscribe();
  island.setFlight({ flightNumber: 'AI-202' });
  assert.equal(recorded.length, 2); // No new events added
});

test('Dynamic Island: toggleMusicPlay flips playing state and notifies', () => {
  const island = new DynamicIslandController(null, { enableHaptics: false });
  island.setMusic({ isPlaying: true });

  const isPlayingNow = island.toggleMusicPlay();
  assert.equal(isPlayingNow, false);
  assert.equal(island.getPayload(DynamicIslandState.MUSIC).isPlaying, false);

  const isPlayingAgain = island.toggleMusicPlay();
  assert.equal(isPlayingAgain, true);
  assert.equal(island.getPayload(DynamicIslandState.MUSIC).isPlaying, true);
});

test('Dynamic Island: denyPolicy invokes rejection handler and collapses', () => {
  const island = new DynamicIslandController(null, { enableHaptics: false });
  let denied = false;

  island.triggerPolicyAlert({
    title: 'Irreversible Data Wipe',
    riskLevel: 'IRREVERSIBLE',
    onDeny: () => { denied = true; }
  });

  assert.equal(island.getState(), DynamicIslandState.POLICY_ALERT);
  const result = island.denyPolicy();
  assert.equal(result, false);
  assert.equal(denied, true);
  assert.equal(island.getState(), DynamicIslandState.COMPACT);
});

test('Dynamic Island: DOM mounting and CSS target dimensions injection', () => {
  const mockDom = new MockElement('dynamic-island');
  const island = new DynamicIslandController(mockDom, { enableHaptics: false });

  assert.equal(mockDom.style.getPropertyValue('--island-target-width'), '124px');
  assert.equal(mockDom.style.getPropertyValue('--island-target-height'), '32px');
  assert.equal(mockDom.style.getPropertyValue('--island-target-radius'), '20px');
  assert.ok(mockDom.innerHTML.includes('camera-lens'));
  assert.ok(mockDom.innerHTML.includes('AIR-GAP SECURED'));

  // Morph to Flight
  island.setFlight({ flightNumber: 'AI-202', gate: '14B' });
  assert.equal(mockDom.style.getPropertyValue('--island-target-width'), '295px');
  assert.equal(mockDom.style.getPropertyValue('--island-target-height'), '54px');
  assert.ok(mockDom.innerHTML.includes('AI-202'));
  assert.ok(mockDom.innerHTML.includes('Gate 14B'));

  // Morph to Policy Alert
  island.triggerPolicyAlert({ title: 'Security Prompt', riskLevel: 'IRREVERSIBLE' });
  assert.equal(mockDom.style.getPropertyValue('--island-target-width'), '340px');
  assert.equal(mockDom.style.getPropertyValue('--island-target-height'), '118px');
  assert.ok(mockDom.innerHTML.includes('Security Prompt'));
  assert.ok(mockDom.innerHTML.includes('risk-irreversible'));
});

// ============================================================================
// 2. Synthesized Tactile Haptics Engine Tests
// ============================================================================

test('HapticEngine: presets define accurate acoustic tactile frequencies', () => {
  const light = HapticPreset[HapticType.LIGHT_TAP];
  assert.equal(light.frequency, 220);
  assert.equal(light.transientFreq, 2400);
  assert.ok(light.durationMs <= 10);

  const snap = HapticPreset[HapticType.MEDIUM_SNAP];
  assert.equal(snap.frequency, 150);
  assert.equal(snap.transientFreq, 980);

  const warn = HapticPreset[HapticType.HEAVY_WARNING];
  assert.equal(warn.frequency, 88);
  assert.equal(warn.filterType, 'lowpass');

  const chime = HapticPreset[HapticType.SUCCESS_CHIME];
  assert.equal(chime.frequency, 523.25);
  assert.equal(chime.transientFreq, 880.0);
});

test('HapticEngine: triggers light tap, medium snap, and heavy warning in headless Node', () => {
  const engine = new HapticEngine();

  // Test light tap
  engine.lightTap();
  let last = engine.getLastEvent();
  assert.equal(last.type, HapticType.LIGHT_TAP);
  assert.equal(last.frequency, 220);
  assert.equal(last.muted, false);

  // Test medium snap
  engine.mediumSnap();
  last = engine.getLastEvent();
  assert.equal(last.type, HapticType.MEDIUM_SNAP);
  assert.equal(last.frequency, 150);

  // Test heavy warning
  engine.heavyWarning();
  last = engine.getLastEvent();
  assert.equal(last.type, HapticType.HEAVY_WARNING);
  assert.equal(last.frequency, 88);

  // Test selection tick & success chime
  engine.selectionTick();
  assert.equal(engine.getLastEvent().type, HapticType.SELECTION_TICK);

  engine.successChime();
  assert.equal(engine.getLastEvent().type, HapticType.SUCCESS_CHIME);

  assert.equal(engine.history.length, 5);
});

test('HapticEngine: mute setting prevents dispatch and records muted state', () => {
  const engine = new HapticEngine();
  engine.setMuted(true);
  assert.equal(engine.getMuted(), true);

  const dispatched = engine.lightTap();
  assert.equal(dispatched, false);
  const last = engine.getLastEvent();
  assert.equal(last.muted, true);
});

test('HapticEngine: volume scaling adjusts synthesized gain level', () => {
  const engine = new HapticEngine({ volume: 0.5 });
  assert.equal(engine.getVolume(), 0.5);

  engine.lightTap();
  const expectedGain = HapticPreset[HapticType.LIGHT_TAP].gain * 0.5;
  assert.ok(Math.abs(engine.getLastEvent().gain - expectedGain) < 0.001);

  // Clamping check
  engine.setVolume(1.8);
  assert.equal(engine.getVolume(), 1.0);

  engine.setVolume(-0.4);
  assert.equal(engine.getVolume(), 0.0);
});

test('HapticEngine: playPattern executes sequential rhythmic clicks', async () => {
  const engine = new HapticEngine();
  engine.clearHistory();

  await engine.playPattern([
    { type: HapticType.LIGHT_TAP, delayMs: 0 },
    { type: HapticType.LIGHT_TAP, delayMs: 10 },
    { type: HapticType.MEDIUM_SNAP, delayMs: 10 }
  ]);

  assert.equal(engine.history.length, 3);
  assert.equal(engine.history[0].type, HapticType.LIGHT_TAP);
  assert.equal(engine.history[1].type, HapticType.LIGHT_TAP);
  assert.equal(engine.history[2].type, HapticType.MEDIUM_SNAP);
});

test('Dynamic Island + Haptics: state transitions automatically emit haptic ticks', () => {
  const customHaptics = new HapticEngine();
  customHaptics.clearHistory();

  const island = new DynamicIslandController(null, {
    enableHaptics: true,
    hapticsEngine: customHaptics
  });

  // Transition to COMPACT emits LIGHT_TAP
  island.collapse();
  assert.equal(customHaptics.getLastEvent().type, HapticType.LIGHT_TAP);

  // Transition to MUSIC emits MEDIUM_SNAP
  island.setMusic();
  assert.equal(customHaptics.getLastEvent().type, HapticType.MEDIUM_SNAP);

  // Transition to AUTH_SCAN emits SELECTION_TICK
  island.startAuthScan();
  assert.equal(customHaptics.getLastEvent().type, HapticType.SELECTION_TICK);

  // Transition to POLICY_ALERT emits HEAVY_WARNING
  island.triggerPolicyAlert();
  assert.equal(customHaptics.getLastEvent().type, HapticType.HEAVY_WARNING);
});
