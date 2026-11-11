// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import { LockState, LockScreen } from '../shell/lockscreen.js';

// Minimal Mock DOM Container
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
    this.style = {};
    this.innerHTML = '';
    this.textContent = '';
    this.eventListeners = {};
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  querySelector() {
    return new MockElement();
  }

  querySelectorAll() {
    return [];
  }
}

test('LockScreen: initializes in UNLOCKED state by default', () => {
  const container = new MockElement('lockscreen-root');
  const lock = new LockScreen({ container });

  assert.equal(lock.state, LockState.UNLOCKED);
  assert.equal(container.classList.contains('state-unlocked'), true);
  assert.equal(container.classList.contains('state-locked'), false);
  assert.equal(container.classList.contains('state-aod'), false);

  lock.stopClock();
});

test('LockScreen: lock() transitions state to LOCKED', () => {
  const container = new MockElement('lockscreen-root');
  let stateRecorded = null;
  const lock = new LockScreen({
    container,
    onStateChange: (s) => { stateRecorded = s; }
  });

  lock.lock();
  assert.equal(lock.state, LockState.LOCKED);
  assert.equal(stateRecorded, LockState.LOCKED);
  assert.equal(container.classList.contains('state-locked'), true);
  assert.equal(container.classList.contains('state-unlocked'), false);

  lock.stopClock();
});

test('LockScreen: enterAOD() enters 1Hz low-power Always-On Display', () => {
  const container = new MockElement('lockscreen-root');
  const lock = new LockScreen({ container });

  lock.enterAOD();
  assert.equal(lock.state, LockState.AOD_1HZ);
  assert.equal(container.classList.contains('state-aod'), true);

  // Waking from AOD goes to LOCKED
  lock.wakeToLockScreen();
  assert.equal(lock.state, LockState.LOCKED);
  assert.equal(container.classList.contains('state-locked'), true);

  lock.stopClock();
});

test('LockScreen: unlock() transitions to UNLOCKED and invokes callback', () => {
  const container = new MockElement('lockscreen-root');
  let unlockedCalled = false;
  const lock = new LockScreen({
    container,
    initialState: LockState.LOCKED,
    onUnlock: () => { unlockedCalled = true; }
  });

  lock.unlock();
  assert.equal(lock.state, LockState.UNLOCKED);
  assert.equal(unlockedCalled, true);
  assert.equal(container.classList.contains('state-unlocked'), true);

  lock.stopClock();
});

test('LockScreen: updateTelemetry() syncs battery and flight details', () => {
  const container = new MockElement('lockscreen-root');
  const lock = new LockScreen({ container });

  lock.updateTelemetry({
    battery: { level: 96, charging: true },
    flight: { flight: 'AI-204', gate: '22A', time: '14:15' }
  });

  assert.equal(lock.batteryLevel, 96);
  assert.equal(lock.flightInfo.flight, 'AI-204');
  assert.equal(lock.flightInfo.gate, '22A');

  lock.stopClock();
});
