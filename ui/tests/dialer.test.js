// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PhoneDialerApp,
  CallState as AppCallState,
  CallType,
  T9_KEYPAD,
  DEFAULT_CONTACTS,
  DEFAULT_RECENTS,
  nameToT9,
  stringToT9,
  matchesContact,
  formatCallDuration
} from '../apps/dialer.js';

import {
  CallState,
  SAMPLE_CONTACTS,
  T9_KEYS,
  TelecomDialer
} from '../shell/dialer.js';

// Minimal Mock DOM Container for Node.js Headless Testing
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

  querySelector(selector) {
    return new MockElement(selector.replace(/^[#.]/, ''));
  }

  querySelectorAll() {
    return [
      new MockElement('btn-1'),
      new MockElement('btn-2'),
      new MockElement('btn-3')
    ];
  }

  getAttribute(attr) {
    if (attr === 'data-digit') return '2';
    if (attr === 'data-key') return '2';
    if (attr === 'data-tab') return 'keypad';
    if (attr === 'data-call-number') return '+1 (555) 012-3456';
    return null;
  }
}

// ============================================================================
// Flagship PhoneDialerApp Unit Tests
// ============================================================================

test('PhoneDialerApp: class exports and instance initialization', () => {
  const dialer = new PhoneDialerApp();

  assert.equal(typeof PhoneDialerApp, 'function');
  assert.equal(typeof dialer.render, 'function');
  assert.equal(typeof dialer.dial, 'function');
  assert.equal(typeof dialer.backspace, 'function');
  assert.equal(typeof dialer.clear, 'function');
  assert.equal(typeof dialer.call, 'function');
  assert.equal(typeof dialer.endCall, 'function');
  assert.equal(typeof dialer.searchContacts, 'function');
  assert.equal(typeof dialer.toggleMute, 'function');
  assert.equal(typeof dialer.toggleSpeaker, 'function');
  assert.equal(typeof dialer.getRecentCalls, 'function');
  assert.equal(typeof dialer.getContacts, 'function');

  assert.equal(dialer.callState, AppCallState.IDLE);
  assert.equal(dialer.dialedDigits, '');
  assert.equal(dialer.activeCall, null);
  assert.equal(dialer.isMuted, false);
  assert.equal(dialer.isSpeakerOn, false);
  assert.ok(dialer.getContacts().length >= 5);
  assert.ok(dialer.getRecentCalls().length >= 3);
  dialer.destroy();
});

test('PhoneDialerApp: tactile keypad operations dial(), backspace(), clear()', () => {
  const dialer = new PhoneDialerApp();

  assert.equal(dialer.dialedDigits, '');

  dialer.dial('6');
  dialer.dial('6');
  dialer.dial('6');
  assert.equal(dialer.dialedDigits, '666');
  assert.equal(dialer.callState, AppCallState.DIALING);

  dialer.backspace();
  assert.equal(dialer.dialedDigits, '66');

  dialer.backspace();
  dialer.backspace();
  assert.equal(dialer.dialedDigits, '');
  assert.equal(dialer.callState, AppCallState.IDLE);

  dialer.dial('*');
  dialer.dial('0');
  dialer.dial('#');
  assert.equal(dialer.dialedDigits, '*0#');

  dialer.clear();
  assert.equal(dialer.dialedDigits, '');
  assert.equal(dialer.callState, AppCallState.IDLE);
  dialer.destroy();
});

test('PhoneDialerApp: Fossify T9 dialpad searching (666 finds Mom, 262 finds Bob)', () => {
  const dialer = new PhoneDialerApp();

  // Test nameToT9 conversion
  assert.equal(nameToT9('Mom'), '666');
  assert.equal(nameToT9('Bob'), '262');
  assert.equal(nameToT9('Alice'), '25423');

  // 1. Typing 666 finds 'Mom'
  const matchMom = dialer.searchContacts('666');
  assert.ok(matchMom.length >= 1);
  assert.ok(matchMom.some(c => c.name === 'Mom'));

  // 2. Typing 262 finds 'Bob Johnson'
  const matchBob = dialer.searchContacts('262');
  assert.ok(matchBob.length >= 1);
  assert.ok(matchBob.some(c => c.name.includes('Bob')));

  // 3. Typing 254 finds 'Alice Smith'
  const matchAlice = dialer.searchContacts('254');
  assert.ok(matchAlice.length >= 1);
  assert.ok(matchAlice.some(c => c.name.includes('Alice')));

  // 4. Searching by number substring (0190 in Mom's number)
  const matchNum = dialer.searchContacts('0190');
  assert.ok(matchNum.some(c => c.name === 'Mom'));

  // 5. Searching by text name
  const matchText = dialer.searchContacts('Charlie');
  assert.ok(matchText.some(c => c.name.includes('Charlie')));
  dialer.destroy();
});

test('PhoneDialerApp: microkernel capability checks for contacts.read', () => {
  let requestedCap = null;
  const mockCapabilityGate = {
    check: (capId) => true,
    request: (capId, meta) => {
      requestedCap = capId;
      return { granted: true, auditToken: '0xmock_token_contacts' };
    }
  };

  const dialer = new PhoneDialerApp({ capabilityGate: mockCapabilityGate });
  const contacts = dialer.getContacts();

  assert.ok(contacts.length > 0);
  assert.equal(requestedCap, 'contacts.read');
  assert.ok(dialer.auditLedger.some(l => l.capabilityId === 'contacts.read' && l.decision === 'PERMITTED'));

  // Test denied capability
  const deniedGate = {
    check: () => false,
    request: () => ({ granted: false, auditToken: '0xdenied' })
  };
  const lockedDialer = new PhoneDialerApp({ capabilityGate: deniedGate });
  const lockedContacts = lockedDialer.getContacts();
  assert.equal(lockedContacts.length, 0);
  assert.ok(lockedDialer.auditLedger.some(l => l.capabilityId === 'contacts.read' && l.decision === 'DENIED'));
  dialer.destroy();
  lockedDialer.destroy();
});

test('PhoneDialerApp: call placement with telephony.call capability check', () => {
  let callCapRequested = false;
  const capabilityGate = {
    request: (capId, meta) => {
      if (capId === 'telephony.call') {
        callCapRequested = true;
      }
      return { granted: true, auditToken: '0xtoken_call_permit' };
    }
  };

  const dialer = new PhoneDialerApp({ capabilityGate });

  // 1. Blocked when no number is dialed or passed
  const emptyRes = dialer.call();
  assert.equal(emptyRes.success, false);

  // 2. Call Alice by number
  const res = dialer.call('+1 (555) 012-3456');
  assert.equal(res.success, true);
  assert.equal(callCapRequested, true);
  assert.equal(dialer.callState, AppCallState.CONNECTED);
  assert.equal(dialer.activeCall.name, 'Alice Smith');
  assert.equal(dialer.activeCall.number, '+1 (555) 012-3456');

  dialer.endCall();
  dialer.destroy();
});

test('PhoneDialerApp: in-call screen live duration timer, mute, speaker, keypad toggling', (t, done) => {
  const dialer = new PhoneDialerApp();

  dialer.dial('6');
  dialer.dial('6');
  dialer.dial('6');
  dialer.call('+1 (555) 019-0099');

  assert.equal(dialer.callState, AppCallState.CONNECTED);
  assert.equal(dialer.isMuted, false);
  assert.equal(dialer.isSpeakerOn, false);

  // Toggle Mute
  const muteState = dialer.toggleMute();
  assert.equal(muteState, true);
  assert.equal(dialer.isMuted, true);
  assert.equal(dialer.activeCall.isMuted, true);

  // Toggle Speaker
  const speakerState = dialer.toggleSpeaker();
  assert.equal(speakerState, true);
  assert.equal(dialer.isSpeakerOn, true);
  assert.equal(dialer.activeCall.isSpeakerOn, true);

  // Toggle In-Call DTMF Keypad
  assert.equal(dialer.isInCallKeypadOpen, false);
  dialer.toggleKeypad();
  assert.equal(dialer.isInCallKeypadOpen, true);
  dialer.toggleKeypad();
  assert.equal(dialer.isInCallKeypadOpen, false);

  // Test call duration formatting
  assert.equal(formatCallDuration(0), '00:00');
  assert.equal(formatCallDuration(65), '01:05');
  assert.equal(formatCallDuration(3665), '01:01:05');

  dialer.endCall();
  dialer.destroy();
  done();
});

test('PhoneDialerApp: endCall() records call history log with duration and badges', () => {
  const dialer = new PhoneDialerApp();
  const initialRecentCount = dialer.getRecentCalls().length;

  dialer.call('+1 (555) 014-4321');
  assert.equal(dialer.callState, AppCallState.CONNECTED);

  // Advance duration manually for test
  dialer.callSeconds = 48;
  const endRes = dialer.endCall();

  assert.equal(endRes.success, true);
  assert.equal(dialer.callState, AppCallState.IDLE);
  assert.equal(dialer.activeCall, null);

  const updatedRecents = dialer.getRecentCalls();
  assert.equal(updatedRecents.length, initialRecentCount + 1);

  const latest = updatedRecents[0];
  assert.equal(latest.name, 'Bob Johnson');
  assert.equal(latest.type, CallType.OUTGOING);
  assert.equal(latest.duration, 48);
  assert.equal(latest.durationText, '00:48');
  dialer.destroy();
});

test('PhoneDialerApp: Dynamic Island notification hook triggers on call and clears on end', () => {
  let islandNotified = false;
  let islandTransition = null;

  const mockDynamicIsland = {
    notifyCall: (callData) => {
      islandNotified = true;
    },
    transitionTo: (state, payload) => {
      islandTransition = state;
    }
  };

  const dialer = new PhoneDialerApp({ dynamicIsland: mockDynamicIsland });
  dialer.call('+1 (555) 012-3456');

  assert.equal(islandNotified, true);

  dialer.endCall();
  assert.equal(islandTransition, 'COMPACT');
  dialer.destroy();
});

test('PhoneDialerApp: 3GPP Rel-17 Satellite SOS emergency dialing option', () => {
  let ntnTransition = null;
  const mockDynamicIsland = {
    transitionTo: (state) => {
      ntnTransition = state;
    }
  };

  const dialer = new PhoneDialerApp({ dynamicIsland: mockDynamicIsland });
  const sosRes = dialer.dialSatelliteSos({ category: 'Wildfire Stranded' });

  assert.equal(sosRes.success, true);
  assert.equal(dialer.callState, AppCallState.SATELLITE_SOS);
  assert.equal(dialer.activeCall.isSatellite, true);
  assert.equal(ntnTransition, 'NTN_SOS');

  // Verify microkernel audit trail for satellite SOS
  const sosAudit = dialer.auditLedger.find(a => a.capabilityId === 'telephony.satellite.sos');
  assert.ok(sosAudit);
  assert.equal(sosAudit.decision, 'PERMITTED');

  dialer.endCall();
  dialer.destroy();
});

test('PhoneDialerApp: simulated incoming and missed call badges', () => {
  const dialer = new PhoneDialerApp();

  dialer.simulateIncomingCall({
    callerNumber: '+1 (800) 555-0199',
    callerName: 'Unknown Robocaller',
    isLikelySpam: true
  });

  assert.equal(dialer.callState, AppCallState.INCOMING);
  assert.equal(dialer.activeCall.callerName || dialer.activeCall.name, 'Unknown Robocaller');
  assert.equal(dialer.activeCall.isLikelySpam, true);

  // Decline call -> marks as missed
  dialer.declineCall();
  assert.equal(dialer.callState, AppCallState.IDLE);

  const missedCalls = dialer.getRecentCalls(CallType.MISSED);
  assert.ok(missedCalls.length >= 1);
  assert.equal(missedCalls[0].type, CallType.MISSED);
  dialer.destroy();
});

test('PhoneDialerApp: DOM container render() mounts glassmorphic elements', () => {
  const container = new MockElement('phone-root');
  const dialer = new PhoneDialerApp({ container });

  const html = dialer.render();
  assert.ok(html.includes('Pravah Phone'));
  assert.ok(html.includes('glass-keypad-grid'));
  assert.ok(html.includes('btn-call-emerald'));
  assert.ok(html.includes('btn-satellite-pill'));
  assert.ok(html.includes('phone-tab-bar'));
  dialer.destroy();
});

// ============================================================================
// Shell TelecomDialer Backward Compatibility Tests
// ============================================================================

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
