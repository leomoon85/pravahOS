// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ShadeState,
  PowerProfile,
  POWER_PROFILES,
  ToggleId,
  DEFAULT_TOGGLES,
  DEFAULT_POWER_RAILS,
  DEFAULT_PULSE_FEED,
  formatTime,
  ControlCenterShade
} from '../shell/shade.js';

// Minimal DOM Mock Container for Headless Testing
class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this._classes = new Set();
    this.classList = {
      add: (...items) => items.forEach(i => this._classes.add(i)),
      remove: (...items) => items.forEach(i => this._classes.delete(i)),
      contains: (i) => this._classes.has(i),
      toggle: (i, force) => {
        if (force !== undefined) {
          if (force) this._classes.add(i);
          else this._classes.delete(i);
          return force;
        }
        if (this._classes.has(i)) {
          this._classes.delete(i);
          return false;
        }
        this._classes.add(i);
        return true;
      }
    };
    this.style = {
      transform: '',
      width: '',
      height: '',
      opacity: '',
      display: '',
      _vars: {},
      setProperty(k, v) { this._vars[k] = v; },
      getPropertyValue(k) { return this._vars[k] || ''; }
    };
    this.innerHTML = '';
    this.eventListeners = {};
    this.children = [];
    this.parentNode = null;
    this.value = '';
    this.textContent = '';
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    if (!this.eventListeners[type]) return;
    this.eventListeners[type] = this.eventListeners[type].filter(l => l !== listener);
  }

  dispatchEvent(evt) {
    const list = this.eventListeners[evt.type] || [];
    list.forEach(cb => cb(evt));
  }

  querySelector(sel) {
    if (sel.startsWith('#')) {
      const targetId = sel.slice(1);
      if (this.id === targetId) return this;
      return this._findChild((c) => c.id === targetId);
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (this.classList.contains(cls)) return this;
      return this._findChild((c) => c.classList.contains(cls));
    }
    return this._findChild((c) => c.tagName.toLowerCase() === sel.toLowerCase());
  }

  querySelectorAll(sel) {
    const results = [];
    const check = (el) => {
      if (sel.startsWith('#') && el.id === sel.slice(1)) results.push(el);
      else if (sel.startsWith('.') && el.classList.contains(sel.slice(1))) results.push(el);
      else if (el.tagName.toLowerCase() === sel.toLowerCase()) results.push(el);
      el.children.forEach(check);
    };
    this.children.forEach(check);
    return results;
  }

  _findChild(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child._findChild(predicate);
      if (found) return found;
    }
    return null;
  }
}

// ============================================================================
// 1. Data Definitions & Pure Logic Tests
// ============================================================================

test('ControlCenterShade: Data definitions & Power Profiles', () => {
  assert.equal(ShadeState.COLLAPSED, 'COLLAPSED');
  assert.equal(ShadeState.EXPANDED, 'EXPANDED');
  assert.equal(ShadeState.SLIDING, 'SLIDING');

  assert.equal(POWER_PROFILES[PowerProfile.ECO].quantization, 'INT4');
  assert.equal(POWER_PROFILES[PowerProfile.BALANCED].quantization, 'INT8');
  assert.equal(POWER_PROFILES[PowerProfile.BOOST].quantization, 'FP16');

  assert.equal(POWER_PROFILES[PowerProfile.ECO].npuFreq, '400 MHz');
  assert.equal(POWER_PROFILES[PowerProfile.BOOST].powerDraw, '5.8 W');
});

test('ControlCenterShade: formatTime correctly parses duration', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(59), '0:59');
  assert.equal(formatTime(142), '2:22');
  assert.equal(formatTime(244), '4:04');
  assert.equal(formatTime(3600), '60:00');
});

test('ControlCenterShade: initial state and defaults', () => {
  const shade = new ControlCenterShade();
  assert.equal(shade.state, ShadeState.COLLAPSED);
  assert.equal(shade.toggles[ToggleId.AIRGAP], true);
  assert.equal(shade.toggles[ToggleId.TORCH], false);
  assert.equal(shade.toggles[ToggleId.POWER], PowerProfile.BALANCED);
  assert.equal(shade.toggles[ToggleId.PRIVACY], true);
  assert.equal(shade.toggles[ToggleId.ROTATION], 'PORTRAIT');

  // Verify initial power rails reflecting default Air-Gap & Privacy active
  assert.equal(shade.powerRails.rfRail, 0.0);
  assert.equal(shade.powerRails.basebandRail, 0.0);
  assert.equal(shade.powerRails.bleRail, 0.0);
  assert.equal(shade.powerRails.cameraRail, 0.0);
  assert.equal(shade.powerRails.micRail, 0.0);

  // Sliders
  assert.equal(shade.brightness, 85);
  assert.equal(shade.volume, 75);
});

// ============================================================================
// 2. State Machine Transitions
// ============================================================================

test('ControlCenterShade: expand() and collapse() state lifecycle', () => {
  const stateTransitions = [];
  const shade = new ControlCenterShade({
    onStateChange: (state) => stateTransitions.push(state)
  });

  assert.equal(shade.state, ShadeState.COLLAPSED);

  shade.expand();
  assert.equal(shade.state, ShadeState.EXPANDED);
  assert.deepEqual(stateTransitions, [ShadeState.EXPANDED]);

  // Redundant expand should no-op
  shade.expand();
  assert.equal(stateTransitions.length, 1);

  shade.collapse();
  assert.equal(shade.state, ShadeState.COLLAPSED);
  assert.deepEqual(stateTransitions, [ShadeState.EXPANDED, ShadeState.COLLAPSED]);

  // Toggle
  shade.toggle();
  assert.equal(shade.state, ShadeState.EXPANDED);
  shade.toggle();
  assert.equal(shade.state, ShadeState.COLLAPSED);
});

// ============================================================================
// 3. 8 Tactile Quick Hardware Toggles & Electronic Rails
// ============================================================================

test('ControlCenterShade: Torch toggle emits event and updates state', () => {
  let torchNotified = null;
  const shade = new ControlCenterShade({
    onTorchChange: (active) => { torchNotified = active; }
  });

  assert.equal(shade.toggles.torch, false);
  shade.toggleHardware(ToggleId.TORCH);
  assert.equal(shade.toggles.torch, true);
  assert.equal(torchNotified, true);

  shade.toggleHardware(ToggleId.TORCH);
  assert.equal(shade.toggles.torch, false);
  assert.equal(torchNotified, false);
});

test('ControlCenterShade: Air-Gap toggle instantly drops and restores RF power rails', () => {
  let airgapNotified = null;
  const shade = new ControlCenterShade({
    onAirGapChange: (offline) => { airgapNotified = offline; }
  });

  assert.equal(shade.toggles.airgap, true);
  assert.equal(shade.powerRails.rfRail, 0.0);
  assert.equal(shade.powerRails.basebandRail, 0.0);
  assert.equal(shade.powerRails.bleRail, 0.0);

  // Disengage Air-Gap
  shade.setAirGap(false);
  assert.equal(shade.toggles.airgap, false);
  assert.equal(airgapNotified, false);

  // Turn on Wi-Fi and Cellular
  shade.toggleHardware(ToggleId.WIFI);
  shade.toggleHardware(ToggleId.CELLULAR);
  assert.equal(shade.toggles.wifi, true);
  assert.equal(shade.toggles.cellular, true);
  assert.equal(shade.powerRails.rfRail, 1.2);
  assert.equal(shade.powerRails.basebandRail, 1.8);

  // Engage Air-Gap again: should immediately cut power rails to 0.0V and disable radios
  shade.setAirGap(true);
  assert.equal(shade.toggles.airgap, true);
  assert.equal(shade.toggles.wifi, false);
  assert.equal(shade.toggles.cellular, false);
  assert.equal(shade.powerRails.rfRail, 0.0);
  assert.equal(shade.powerRails.basebandRail, 0.0);
  assert.equal(airgapNotified, true);
});

test('ControlCenterShade: Wi-Fi toggle disengages Air-Gap if engaged', () => {
  const shade = new ControlCenterShade();
  assert.equal(shade.toggles.airgap, true);
  assert.equal(shade.toggles.wifi, false);

  // User taps Wi-Fi toggle while airgap is on
  shade.toggleHardware(ToggleId.WIFI);
  assert.equal(shade.toggles.airgap, false);
  assert.equal(shade.toggles.wifi, true);
  assert.equal(shade.powerRails.rfRail, 1.2);
});

test('ControlCenterShade: Power Mode cycles ECO -> BALANCED -> BOOST -> ECO with NPU quantization', () => {
  const notifiedProfiles = [];
  const shade = new ControlCenterShade({
    onPowerProfileChange: (p) => notifiedProfiles.push(p.id)
  });

  assert.equal(shade.toggles.power, PowerProfile.BALANCED);

  // 1st cycle: BALANCED -> BOOST (FP16)
  shade.toggleHardware(ToggleId.POWER);
  assert.equal(shade.toggles.power, PowerProfile.BOOST);
  assert.equal(POWER_PROFILES[shade.toggles.power].quantization, 'FP16');

  // 2nd cycle: BOOST -> ECO (INT4)
  shade.toggleHardware(ToggleId.POWER);
  assert.equal(shade.toggles.power, PowerProfile.ECO);
  assert.equal(POWER_PROFILES[shade.toggles.power].quantization, 'INT4');

  // 3rd cycle: ECO -> BALANCED (INT8)
  shade.toggleHardware(ToggleId.POWER);
  assert.equal(shade.toggles.power, PowerProfile.BALANCED);
  assert.equal(POWER_PROFILES[shade.toggles.power].quantization, 'INT8');

  assert.deepEqual(notifiedProfiles, [PowerProfile.BOOST, PowerProfile.ECO, PowerProfile.BALANCED]);
});

test('ControlCenterShade: Rotation toggle flips between PORTRAIT and AUTO', () => {
  const shade = new ControlCenterShade();
  assert.equal(shade.toggles.rotation, 'PORTRAIT');

  shade.toggleHardware(ToggleId.ROTATION);
  assert.equal(shade.toggles.rotation, 'AUTO');

  shade.toggleHardware(ToggleId.ROTATION);
  assert.equal(shade.toggles.rotation, 'PORTRAIT');
});

test('ControlCenterShade: Sensor Privacy Kill isolates Camera and Mic power rails to 0.0V', () => {
  const shade = new ControlCenterShade();
  assert.equal(shade.toggles.privacy, true);
  assert.equal(shade.powerRails.cameraRail, 0.0);
  assert.equal(shade.powerRails.micRail, 0.0);

  // Disengage Privacy Shield (Power on camera & mic)
  shade.toggleHardware(ToggleId.PRIVACY);
  assert.equal(shade.toggles.privacy, false);
  assert.equal(shade.powerRails.cameraRail, 2.8);
  assert.equal(shade.powerRails.micRail, 1.8);

  // Re-engage Privacy Kill (Drop camera & mic rails to 0.0V)
  shade.toggleHardware(ToggleId.PRIVACY);
  assert.equal(shade.toggles.privacy, true);
  assert.equal(shade.powerRails.cameraRail, 0.0);
  assert.equal(shade.powerRails.micRail, 0.0);
});

// ============================================================================
// 4. Smooth Brightness & Audio Volume Sliders
// ============================================================================

test('ControlCenterShade: setBrightness() updates value and clamps 0-100', () => {
  let notifiedBrightness = null;
  const shade = new ControlCenterShade({
    brightness: 50,
    onBrightnessChange: (b) => { notifiedBrightness = b; }
  });

  shade.setBrightness(90);
  assert.equal(shade.brightness, 90);
  assert.equal(notifiedBrightness, 90);

  // Clamping
  shade.setBrightness(150);
  assert.equal(shade.brightness, 100);
  shade.setBrightness(-25);
  assert.equal(shade.brightness, 0);
});

test('ControlCenterShade: setVolume() updates value and clamps 0-100', () => {
  let notifiedVol = null;
  const shade = new ControlCenterShade({
    volume: 50,
    onVolumeChange: (v) => { notifiedVol = v; }
  });

  shade.setVolume(80);
  assert.equal(shade.volume, 80);
  assert.equal(notifiedVol, 80);

  // Clamping
  shade.setVolume(120);
  assert.equal(shade.volume, 100);
  shade.setVolume(-10);
  assert.equal(shade.volume, 0);
});

// ============================================================================
// 5. Intelligent Pulse Live Activities Feed
// ============================================================================

test('ControlCenterShade: Spotify live player play/pause toggle & progress', () => {
  const shade = new ControlCenterShade();
  assert.equal(shade.pulseFeed.spotify.isPlaying, true);

  shade.toggleSpotifyPlay();
  assert.equal(shade.pulseFeed.spotify.isPlaying, false);

  shade.toggleSpotifyPlay();
  assert.equal(shade.pulseFeed.spotify.isPlaying, true);

  shade.setSpotifyProgress(180);
  assert.equal(shade.pulseFeed.spotify.progressSec, 180);

  // Clamp over duration
  shade.setSpotifyProgress(999);
  assert.equal(shade.pulseFeed.spotify.progressSec, shade.pulseFeed.spotify.durationSec);
});

test('ControlCenterShade: Flight and Active Task Live Feed updates', () => {
  const shade = new ControlCenterShade();
  assert.equal(shade.pulseFeed.flight.flightNum, 'AI-202');
  assert.equal(shade.pulseFeed.flight.status, 'BOARDING');

  assert.equal(shade.pulseFeed.task.progress, 78);
  shade.updateTaskProgress(92, 'Stage 4 of 4: Merkle Block Verified');
  assert.equal(shade.pulseFeed.task.progress, 92);
  assert.equal(shade.pulseFeed.task.stage, 'Stage 4 of 4: Merkle Block Verified');
});

// ============================================================================
// 6. DOM Mock Container Styling Verification
// ============================================================================

test('ControlCenterShade: DOM container reflects transform styles during expand/collapse', () => {
  const container = new MockElement('control-shade');
  const backdrop = new MockElement('control-shade-backdrop');

  const shade = new ControlCenterShade({
    container,
    backdrop
  });

  assert.equal(shade.state, ShadeState.COLLAPSED);

  shade.expand();
  assert.equal(shade.state, ShadeState.EXPANDED);
  assert.equal(container.classList.contains('expanded'), true);
  assert.equal(container.classList.contains('collapsed'), false);
  assert.equal(container.style.transform, 'translateY(0%)');
  assert.equal(backdrop.classList.contains('active'), true);

  shade.collapse();
  assert.equal(shade.state, ShadeState.COLLAPSED);
  assert.equal(container.classList.contains('collapsed'), true);
  assert.equal(container.classList.contains('expanded'), false);
  assert.equal(container.style.transform, 'translateY(-100%)');
  assert.equal(backdrop.classList.contains('active'), false);
});
