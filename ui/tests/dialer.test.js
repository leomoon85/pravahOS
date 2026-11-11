// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CallState,
  SAMPLE_CONTACTS,
  T9_KEYS,
  TelecomDialer
} from '../shell/dialer.js';

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

  getAttribute() {
    return null;
  }
}

test('TelecomDialer: data definitions match standard telephony specifications', () => {
  assert.equal(T9_KEYS.length, 12);
  const key2 = T9_KEYS.find(k => k.digit === '2');
  assert.equal(key2?.letters, 'ABC');

  const key9 = T9_KEYS.find(k => k.digit === '9');
  assert.equal(key9?.letters, 'WXYZ');

  assert.ok(SAMPLE_CONTACTS.length >= 4);
});

test('TelecomDialer: appendDigit(), deleteDigit(), and clear() manipulate dialed string', () => {
  const container = new MockElement('dialer-root');
  const dialer = new TelecomDialer({ container });

  assert.equal(dialer.dialedDigits, '');

  dialer.appendDigit('5');
  dialer.appendDigit('5');
  dialer.appendDigit('5');
  assert.equal(dialer.dialedDigits, '555');

  dialer.deleteDigit();
  assert.equal(dialer.dialedDigits, '55');

  dialer.clear();
  assert.equal(dialer.dialedDigits, '');
});

test('TelecomDialer: open(), close(), and toggle() update container expanded class', () => {
  const container = new MockElement('dialer-root');
  const dialer = new TelecomDialer({ container });

  assert.equal(container.classList.contains('expanded'), false);

  dialer.open();
  assert.equal(container.classList.contains('expanded'), true);

  dialer.close();
  assert.equal(container.classList.contains('expanded'), false);

  dialer.toggle();
  assert.equal(container.classList.contains('expanded'), true);
});

test('TelecomDialer: incoming call simulation and AI Call Screening flow', (t, done) => {
  const container = new MockElement('dialer-root');
  let stateLog = [];
  const dialer = new TelecomDialer({
    container,
    onStateChange: (state) => {
      stateLog.push(state);
    }
  });

  dialer.simulateIncomingCall({
    callerNumber: '+1 (800) 555-0199',
    callerName: 'Unknown Robocaller',
    isLikelySpam: true
  });

  assert.equal(dialer.callState, CallState.INCOMING);
  assert.equal(dialer.activeCall.callerNumber, '+1 (800) 555-0199');
  assert.equal(dialer.activeCall.isLikelySpam, true);

  // Trigger On-Device AI Call Screening
  dialer.startAiCallScreening();
  assert.equal(dialer.callState, CallState.SCREENING);

  // Block & Hang Up
  dialer.blockAndHangUp();
  assert.equal(dialer.callState, CallState.DISCONNECTED);

  done();
});
