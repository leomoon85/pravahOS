// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file dialer.js
 * PravahOS Flagship Phone & Contacts Stock Application.
 *
 * Implements:
 * 1. PhoneDialerApp class with complete telephony lifecycle management.
 * 2. Fossify-grade high-speed T9 predictive contact searching (666 -> Mom, 262 -> Bob).
 * 3. Tactile glassmorphic numeric keypad (0-9, *, #) with DTMF audio & haptic transients.
 * 4. Comprehensive call history log (Recents) with incoming, outgoing, and missed badges.
 * 5. Full in-call screen simulation: active call timer, mute/speaker toggles, in-call DTMF keypad.
 * 6. Dynamic Island in-call state machine & banner notification trigger.
 * 7. 3GPP Rel-17 NTN Direct-to-Satellite Emergency SOS beacon option.
 * 8. Zero-trust microkernel capability bindings for `telephony.call` and `contacts.read`.
 */

export const CallState = {
  IDLE: 'IDLE',
  DIALING: 'DIALING',
  INCOMING: 'INCOMING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  SATELLITE_SOS: 'SATELLITE_SOS'
};

export const CallType = {
  INCOMING: 'incoming',
  OUTGOING: 'outgoing',
  MISSED: 'missed'
};

export const T9_KEYPAD = [
  { digit: '1', letters: '', sub: 'Voicemail' },
  { digit: '2', letters: 'ABC', sub: 'abc' },
  { digit: '3', letters: 'DEF', sub: 'def' },
  { digit: '4', letters: 'GHI', sub: 'ghi' },
  { digit: '5', letters: 'JKL', sub: 'jkl' },
  { digit: '6', letters: 'MNO', sub: 'mno' },
  { digit: '7', letters: 'PQRS', sub: 'pqrs' },
  { digit: '8', letters: 'TUV', sub: 'tuv' },
  { digit: '9', letters: 'WXYZ', sub: 'wxyz' },
  { digit: '*', letters: '', sub: '✱' },
  { digit: '0', letters: '+', sub: '＋' },
  { digit: '#', letters: '', sub: '井' }
];

export const DTMF_FREQUENCIES = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477]
};

export const DEFAULT_CONTACTS = [
  {
    id: 'contact_alice',
    name: 'Alice Smith',
    number: '+1 (555) 012-3456',
    normalizedNumber: '15550123456',
    avatar: '👩‍💼',
    favorite: true,
    category: 'Work',
    email: 'alice@pravah.dev'
  },
  {
    id: 'contact_bob',
    name: 'Bob Johnson',
    number: '+1 (555) 014-4321',
    normalizedNumber: '15550144321',
    avatar: '👨‍🎨',
    favorite: true,
    category: 'Friends',
    email: 'bob@pravah.dev'
  },
  {
    id: 'contact_charlie',
    name: 'Charlie Davis',
    number: '+1 (555) 018-8765',
    normalizedNumber: '15550188765',
    avatar: '👨‍💻',
    favorite: false,
    category: 'Engineering',
    email: 'charlie@pravah.dev'
  },
  {
    id: 'contact_flight',
    name: 'Flight Support (AI-202)',
    number: '1-800-247-247',
    normalizedNumber: '1800247247',
    avatar: '✈️',
    favorite: false,
    category: 'Travel',
    email: 'ops@airindia.in'
  },
  {
    id: 'contact_mom',
    name: 'Mom',
    number: '+1 (555) 019-0099',
    normalizedNumber: '15550190099',
    avatar: '❤️',
    favorite: true,
    category: 'Family',
    email: 'mom@family.org'
  },
  {
    id: 'contact_sarah',
    name: 'Dr. Sarah Connor',
    number: '+1 (555) 017-9911',
    normalizedNumber: '15550179911',
    avatar: '🩺',
    favorite: false,
    category: 'Medical',
    email: 'sarah.connor@metrohealth.org'
  },
  {
    id: 'contact_emergency',
    name: 'Pravah Satellite SOS',
    number: '911',
    normalizedNumber: '911',
    avatar: '🚨',
    favorite: true,
    category: 'Emergency',
    email: 'emergency-ntn@pravah.int'
  }
];

export const DEFAULT_RECENTS = [
  {
    id: 'rec_101',
    name: 'Mom',
    number: '+1 (555) 019-0099',
    type: CallType.INCOMING,
    timestamp: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    duration: 142,
    durationText: '2m 22s',
    isSatellite: false
  },
  {
    id: 'rec_102',
    name: 'Bob Johnson',
    number: '+1 (555) 014-4321',
    type: CallType.OUTGOING,
    timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    duration: 45,
    durationText: '45s',
    isSatellite: false
  },
  {
    id: 'rec_103',
    name: 'Unknown Telemarketer',
    number: '+1 (800) 555-0199',
    type: CallType.MISSED,
    timestamp: new Date(Date.now() - 1000 * 60 * 320).toISOString(),
    duration: 0,
    durationText: 'Missed',
    isSatellite: false,
    isSpam: true
  },
  {
    id: 'rec_104',
    name: 'NTN Orbit Relay #402',
    number: '911-NTN',
    type: CallType.OUTGOING,
    timestamp: new Date(Date.now() - 1000 * 60 * 1440).toISOString(),
    duration: 88,
    durationText: '1m 28s',
    isSatellite: true
  }
];

/**
 * Maps a single alphanumeric character to standard telephony T9 digit.
 * @param {string} char
 * @returns {string}
 */
export function charToT9Digit(char) {
  if (!char) return '';
  const c = char.toLowerCase();
  if ('abc'.includes(c)) return '2';
  if ('def'.includes(c)) return '3';
  if ('ghi'.includes(c)) return '4';
  if ('jkl'.includes(c)) return '5';
  if ('mno'.includes(c)) return '6';
  if ('pqrs'.includes(c)) return '7';
  if ('tuv'.includes(c)) return '8';
  if ('wxyz'.includes(c)) return '9';
  if ('0123456789'.includes(c)) return c;
  return '';
}

/**
 * Converts text string to corresponding T9 digits string.
 * @param {string} str
 * @returns {string}
 */
export function stringToT9(str) {
  if (!str) return '';
  return str
    .split('')
    .map(charToT9Digit)
    .filter(Boolean)
    .join('');
}

export const nameToT9 = stringToT9;

/**
 * Checks whether contact matches query through text, phone number, or T9 search.
 * @param {Object} contact
 * @param {string} query
 * @returns {boolean}
 */
export function matchesContact(contact, query) {
  if (!query) return true;
  const q = String(query).trim().toLowerCase();
  if (!q) return true;

  // 1. Exact or partial text match on name / category / email
  if (contact.name && contact.name.toLowerCase().includes(q)) return true;
  if (contact.category && contact.category.toLowerCase().includes(q)) return true;
  if (contact.email && contact.email.toLowerCase().includes(q)) return true;

  // 2. Direct match on formatted number
  if (contact.number && contact.number.toLowerCase().includes(q)) return true;

  // 3. Digit-only match on phone number
  const cleanPhone = (contact.normalizedNumber || contact.number || '').replace(/\D/g, '');
  const cleanQ = q.replace(/\D/g, '');
  if (cleanQ && cleanPhone.includes(cleanQ)) return true;

  // 4. Fast T9 search if query consists of digits
  if (/^[0-9]+$/.test(cleanQ)) {
    // Check whole name T9
    const fullNameT9 = stringToT9(contact.name);
    if (fullNameT9.includes(cleanQ)) return true;

    // Check individual word T9 (e.g. first or last name prefix)
    const words = contact.name.split(/[\s\-_.,]+/);
    for (const w of words) {
      const wordT9 = stringToT9(w);
      if (wordT9.includes(cleanQ)) return true;
    }
  }

  return false;
}

/**
 * Format duration in seconds to standard telephony display mm:ss or hh:mm:ss
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatCallDuration(totalSeconds = 0) {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const remainingSecs = secs % 60;

  const mm = String(mins).padStart(2, '0');
  const ss = String(remainingSecs).padStart(2, '0');

  if (hrs > 0) {
    const hh = String(hrs).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Flagship PhoneDialerApp stock application controller.
 */
export class PhoneDialerApp {
  constructor(options = {}) {
    this.container = options.container || null;
    this.capabilityGate = options.capabilityGate || {
      check: (capId) => true,
      request: (capId, metadata) => ({
        granted: true,
        auditToken: `0x${Math.random().toString(16).slice(2, 10)}`
      })
    };
    this.dynamicIsland = options.dynamicIsland || (typeof window !== 'undefined' ? window.dynamicIslandController : null);
    this.satelliteSubsystem = options.satelliteSubsystem || null;
    this.onStateChange = options.onStateChange || null;
    this.onAuditLog = options.onAuditLog || null;

    this.dialedDigits = '';
    this.callState = CallState.IDLE;
    this.activeCall = null;
    this.callDurationTimer = null;
    this.callSeconds = 0;
    this.isMuted = false;
    this.isSpeakerOn = false;
    this.isInCallKeypadOpen = false;
    this.activeTab = options.initialTab || 'keypad'; // 'keypad' | 'recents' | 'contacts' | 'sos'
    this.contactsSearchQuery = '';

    this.contacts = [...(options.contacts || DEFAULT_CONTACTS)];
    this.recentCalls = [...(options.recentCalls || DEFAULT_RECENTS)];
    this.auditLedger = [];

    // Verify contacts.read capability at initialization
    this.verifyCapability('contacts.read', { purpose: 'Initial contacts database synchronization' });

    if (this.container) {
      this.mount(this.container);
    }
  }

  // ==========================================================================
  // Microkernel Capability Gate Enforcement
  // ==========================================================================

  verifyCapability(capabilityId, metadata = {}) {
    let granted = true;
    let decision = 'PERMITTED';
    let auditToken = `0x${Math.random().toString(16).slice(2, 10)}`;

    try {
      if (this.capabilityGate && typeof this.capabilityGate.request === 'function') {
        const res = this.capabilityGate.request(capabilityId, metadata);
        granted = Boolean(res?.granted ?? true);
        auditToken = res?.auditToken || auditToken;
        decision = granted ? 'PERMITTED' : 'DENIED';
      } else if (this.capabilityGate && typeof this.capabilityGate.check === 'function') {
        granted = Boolean(this.capabilityGate.check(capabilityId));
        decision = granted ? 'PERMITTED' : 'DENIED';
      }
    } catch (err) {
      granted = false;
      decision = 'DENIED_EXCEPTION';
    }

    const logEntry = {
      seq: this.auditLedger.length + 1,
      timestamp: new Date().toISOString(),
      caller: 'apps/dialer',
      capabilityId,
      riskLevel: capabilityId.includes('call') || capabilityId.includes('sos') ? 2 : 1,
      decision,
      auditToken,
      metadata
    };
    this.auditLedger.push(logEntry);

    if (typeof this.onAuditLog === 'function') {
      try {
        this.onAuditLog(logEntry);
      } catch (e) {
        // Safe sink
      }
    }

    return { granted, decision, auditToken, logEntry };
  }

  // ==========================================================================
  // Tactile Glassmorphic Keypad Methods
  // ==========================================================================

  dial(digit) {
    if (digit === null || digit === undefined) return this.dialedDigits;
    const strDigit = String(digit);
    this.dialedDigits += strDigit;

    this.playDtmfTone(strDigit);
    this.triggerHapticPulse();

    if (this.callState === CallState.IDLE) {
      this.callState = CallState.DIALING;
    }

    this.updateDisplay();
    return this.dialedDigits;
  }

  backspace() {
    this.dialedDigits = this.dialedDigits.slice(0, -1);
    if (!this.dialedDigits && this.callState === CallState.DIALING) {
      this.callState = CallState.IDLE;
    }
    this.triggerHapticPulse();
    this.updateDisplay();
    return this.dialedDigits;
  }

  clear() {
    this.dialedDigits = '';
    if (this.callState === CallState.DIALING) {
      this.callState = CallState.IDLE;
    }
    this.updateDisplay();
    return this.dialedDigits;
  }

  playDtmfTone(digit) {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const freqs = DTMF_FREQUENCIES[digit];
      if (!freqs) return;

      if (!this._audioCtx) {
        this._audioCtx = new AudioCtx();
      }
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.value = freqs[0];
      osc2.frequency.value = freqs[1];

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.12);
      osc2.stop(ctx.currentTime + 0.12);
    } catch (err) {
      // Audio tone fallback
    }
  }

  triggerHapticPulse() {
    if (typeof window !== 'undefined' && window.navigator && typeof window.navigator.vibrate === 'function') {
      try {
        window.navigator.vibrate(10);
      } catch (e) {}
    }
  }

  // ==========================================================================
  // Contacts & T9 Search
  // ==========================================================================

  getContacts() {
    const auth = this.verifyCapability('contacts.read', { action: 'getContacts' });
    if (!auth.granted) {
      return [];
    }
    return [...this.contacts];
  }

  searchContacts(query) {
    const auth = this.verifyCapability('contacts.read', { action: 'searchContacts', query });
    if (!auth.granted) {
      return [];
    }

    if (!query || String(query).trim() === '') {
      return [...this.contacts];
    }

    return this.contacts.filter(c => matchesContact(c, query));
  }

  addContact(contact) {
    if (!contact || !contact.name || !contact.number) return false;
    const newContact = {
      id: contact.id || `contact_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: contact.name,
      number: contact.number,
      normalizedNumber: contact.number.replace(/\D/g, ''),
      avatar: contact.avatar || '👤',
      favorite: Boolean(contact.favorite),
      category: contact.category || 'Personal',
      email: contact.email || ''
    };
    this.contacts.push(newContact);
    this.updateDisplay();
    return newContact;
  }

  // ==========================================================================
  // Call History (Recents)
  // ==========================================================================

  getRecentCalls(filter = null) {
    if (!filter) return [...this.recentCalls];
    return this.recentCalls.filter(r => r.type === filter);
  }

  // ==========================================================================
  // Call Lifecycle Management & In-Call Screen
  // ==========================================================================

  isEmergencyNumber(number = '') {
    const clean = String(number).trim().replace(/\D/g, '');
    return clean === '911' || clean === '112' || clean === '999' || clean === '000' || String(number).toUpperCase().includes('SOS');
  }

  call(numberToCall = null, callOptions = {}) {
    const target = (numberToCall !== null && numberToCall !== undefined ? String(numberToCall) : this.dialedDigits).trim();

    if (!target) {
      return { success: false, reason: 'NO_NUMBER_SPECIFIED' };
    }

    const isEmergency = this.isEmergencyNumber(target) || Boolean(callOptions.isSatellite);
    const requiredCap = isEmergency ? 'telephony.call.emergency' : 'telephony.call';
    const capCheck = this.verifyCapability(requiredCap, {
      destination: target,
      isEmergency,
      isSatellite: Boolean(callOptions.isSatellite)
    });

    if (!capCheck.granted) {
      return {
        success: false,
        reason: 'CAPABILITY_DENIED',
        capabilityId: requiredCap,
        auditToken: capCheck.auditToken
      };
    }

    // Lookup matching contact for friendly title
    const matched = this.contacts.find(c =>
      c.number === target ||
      (c.normalizedNumber && c.normalizedNumber === target.replace(/\D/g, ''))
    );

    const callerName = matched
      ? matched.name
      : (isEmergency ? 'Pravah Emergency SOS' : 'Outgoing Call');

    this.callState = isEmergency && callOptions.isSatellite ? CallState.SATELLITE_SOS : CallState.CONNECTED;
    this.callSeconds = 0;
    this.isMuted = false;
    this.isSpeakerOn = false;
    this.isInCallKeypadOpen = false;

    this.activeCall = {
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: callerName,
      number: target,
      avatar: matched ? matched.avatar : (isEmergency ? '🚨' : '📞'),
      type: CallType.OUTGOING,
      startTime: Date.now(),
      duration: 0,
      durationText: '00:00',
      isMuted: false,
      isSpeakerOn: false,
      isSatellite: Boolean(isEmergency && callOptions.isSatellite),
      auditToken: capCheck.auditToken
    };

    if (this.callDurationTimer) {
      clearInterval(this.callDurationTimer);
    }
    this.callDurationTimer = setInterval(() => {
      this.callSeconds++;
      if (this.activeCall) {
        this.activeCall.duration = this.callSeconds;
        this.activeCall.durationText = formatCallDuration(this.callSeconds);
      }
      this.updateInCallTimerDisplay();
      this.notifyDynamicIsland();
    }, 1000);

    this.notifyDynamicIsland();
    this.updateDisplay();

    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this.callState, this.activeCall);
    }

    return {
      success: true,
      activeCall: this.activeCall
    };
  }

  endCall() {
    if (!this.activeCall) {
      return { success: false, reason: 'NO_ACTIVE_CALL' };
    }

    if (this.callDurationTimer) {
      clearInterval(this.callDurationTimer);
      this.callDurationTimer = null;
    }

    const durationText = this.activeCall.type === CallType.MISSED ? 'Missed' : (formatCallDuration(this.callSeconds) || '00:00');

    const historyRecord = {
      id: this.activeCall.id,
      name: this.activeCall.name,
      number: this.activeCall.number,
      type: this.activeCall.type || CallType.OUTGOING,
      timestamp: new Date().toISOString(),
      duration: this.callSeconds,
      durationText: durationText,
      isSatellite: Boolean(this.activeCall.isSatellite),
      auditToken: this.activeCall.auditToken
    };

    this.recentCalls.unshift(historyRecord);

    this.clearDynamicIslandNotification();

    this.callState = CallState.DISCONNECTED;
    const endedCallSummary = { ...this.activeCall, duration: this.callSeconds };
    this.activeCall = null;
    this.callSeconds = 0;
    this.isMuted = false;
    this.isSpeakerOn = false;
    this.isInCallKeypadOpen = false;

    // Reset back to idle
    this.callState = this.dialedDigits ? CallState.DIALING : CallState.IDLE;
    this.updateDisplay();

    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this.callState, null);
    }

    return {
      success: true,
      endedCall: endedCallSummary,
      historyRecord
    };
  }

  toggleMute() {
    if (!this.activeCall) return false;
    this.isMuted = !this.isMuted;
    this.activeCall.isMuted = this.isMuted;
    this.triggerHapticPulse();
    this.updateInCallControlsDisplay();
    return this.isMuted;
  }

  toggleSpeaker() {
    if (!this.activeCall) return false;
    this.isSpeakerOn = !this.isSpeakerOn;
    this.activeCall.isSpeakerOn = this.isSpeakerOn;
    this.triggerHapticPulse();
    this.updateInCallControlsDisplay();
    return this.isSpeakerOn;
  }

  toggleKeypad() {
    this.isInCallKeypadOpen = !this.isInCallKeypadOpen;
    this.triggerHapticPulse();
    this.updateInCallControlsDisplay();
    return this.isInCallKeypadOpen;
  }

  // ==========================================================================
  // Satellite SOS (3GPP Rel-17 NTN Emergency Beacon)
  // ==========================================================================

  dialSatelliteSos(options = {}) {
    const sosNumber = options.number || '911-NTN';
    const category = options.category || 'Direct NTN Emergency Beacon';

    const sosAuth = this.verifyCapability('telephony.satellite.sos', {
      category,
      satelliteStandard: '3GPP Rel-17 NTN',
      linkMargin: '+4.2 dB',
      frequencyBand: 'L-Band (1621.25 MHz)'
    });

    if (!sosAuth.granted) {
      return { success: false, reason: 'CAPABILITY_DENIED', capabilityId: 'telephony.satellite.sos' };
    }

    const callResult = this.call(sosNumber, {
      isSatellite: true,
      emergencyCategory: category
    });

    if (callResult.success) {
      this.callState = CallState.SATELLITE_SOS;
      if (this.activeCall) {
        this.activeCall.name = 'Satellite SOS (3GPP Rel-17)';
        this.activeCall.avatar = '🛰️';
        this.activeCall.isSatellite = true;
      }

      // Notify Dynamic Island of NTN SOS lock
      if (this.dynamicIsland && typeof this.dynamicIsland.transitionTo === 'function') {
        try {
          this.dynamicIsland.transitionTo('NTN_SOS', {
            status: 'NTN LOCKED • BURST SENT',
            satellite: 'StarLink-NTN-402',
            band: 'L-Band (1621.25 MHz)',
            margin: '+4.2 dB'
          });
        } catch (e) {}
      }

      this.updateDisplay();
    }

    return callResult;
  }

  // ==========================================================================
  // Incoming Call Simulation & Screening Hooks
  // ==========================================================================

  simulateIncomingCall(incoming = {}) {
    const callerNumber = incoming.callerNumber || '+1 (800) 555-0199';
    const matched = this.contacts.find(c => c.number === callerNumber);
    const callerName = incoming.callerName || (matched ? matched.name : 'Unknown Caller');

    this.activeCall = {
      id: `incoming_${Date.now()}`,
      name: callerName,
      number: callerNumber,
      avatar: matched ? matched.avatar : '📞',
      type: CallType.INCOMING,
      startTime: Date.now(),
      duration: 0,
      durationText: 'Incoming...',
      isMuted: false,
      isSpeakerOn: false,
      isLikelySpam: Boolean(incoming.isLikelySpam)
    };

    this.callState = CallState.INCOMING;
    this.updateDisplay();

    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this.callState, this.activeCall);
    }
    return this.activeCall;
  }

  answerCall() {
    if (!this.activeCall || this.callState !== CallState.INCOMING) return false;
    this.callState = CallState.CONNECTED;
    this.callSeconds = 0;

    if (this.callDurationTimer) clearInterval(this.callDurationTimer);
    this.callDurationTimer = setInterval(() => {
      this.callSeconds++;
      if (this.activeCall) {
        this.activeCall.duration = this.callSeconds;
        this.activeCall.durationText = formatCallDuration(this.callSeconds);
      }
      this.updateInCallTimerDisplay();
      this.notifyDynamicIsland();
    }, 1000);

    this.notifyDynamicIsland();
    this.updateDisplay();
    return true;
  }

  declineCall() {
    if (!this.activeCall) return false;
    this.activeCall.type = CallType.MISSED;
    return this.endCall();
  }

  // ==========================================================================
  // Dynamic Island In-Call Integration
  // ==========================================================================

  notifyDynamicIsland() {
    if (!this.activeCall) return;

    if (this.dynamicIsland) {
      if (typeof this.dynamicIsland.notifyCall === 'function') {
        this.dynamicIsland.notifyCall({
          name: this.activeCall.name,
          number: this.activeCall.number,
          durationText: formatCallDuration(this.callSeconds),
          isMuted: this.isMuted,
          isSatellite: Boolean(this.activeCall.isSatellite)
        });
      } else if (typeof this.dynamicIsland.transitionTo === 'function') {
        try {
          if (this.activeCall.isSatellite) {
            this.dynamicIsland.transitionTo('NTN_SOS', {
              status: `SOS (${formatCallDuration(this.callSeconds)})`,
              satellite: 'StarLink-NTN-402'
            });
          }
        } catch (e) {}
      }
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        const ev = new CustomEvent('pravah:incall', {
          detail: {
            state: this.callState,
            caller: this.activeCall.name,
            number: this.activeCall.number,
            duration: this.callSeconds,
            durationText: formatCallDuration(this.callSeconds),
            isMuted: this.isMuted,
            isSpeakerOn: this.isSpeakerOn,
            isSatellite: Boolean(this.activeCall.isSatellite)
          }
        });
        window.dispatchEvent(ev);
      } catch (e) {}
    }
  }

  clearDynamicIslandNotification() {
    if (this.dynamicIsland && typeof this.dynamicIsland.transitionTo === 'function') {
      try {
        this.dynamicIsland.transitionTo('COMPACT', { label: 'AIR-GAP SECURED' });
      } catch (e) {}
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        const ev = new CustomEvent('pravah:incall:ended', {
          detail: { timestamp: Date.now() }
        });
        window.dispatchEvent(ev);
      } catch (e) {}
    }
  }

  // ==========================================================================
  // UI Tab Navigation
  // ==========================================================================

  setTab(tabName) {
    this.activeTab = tabName;
    this.triggerHapticPulse();
    this.updateDisplay();
  }

  // ==========================================================================
  // DOM Mounting & Rendering
  // ==========================================================================

  mount(container) {
    this.container = container;
    if (this.container.classList && typeof this.container.classList.add === 'function') {
      this.container.classList.add('phone-dialer-root');
    }
    this.render();
  }

  destroy() {
    if (this.callDurationTimer) {
      clearInterval(this.callDurationTimer);
      this.callDurationTimer = null;
    }
    if (this._audioCtx && typeof this._audioCtx.close === 'function') {
      try {
        this._audioCtx.close();
      } catch (e) {}
    }
  }

  updateDisplay() {
    if (!this.container) return;
    this.render();
  }

  updateInCallTimerDisplay() {
    if (!this.container || typeof this.container.querySelector !== 'function') return;
    const timerEl = this.container.querySelector('.incall-duration-counter');
    if (timerEl) {
      timerEl.textContent = formatCallDuration(this.callSeconds);
    }
  }

  updateInCallControlsDisplay() {
    if (!this.container || typeof this.container.querySelector !== 'function') return;
    const btnMute = this.container.querySelector('#btn-incall-mute');
    if (btnMute && btnMute.classList) {
      btnMute.classList.toggle('active', this.isMuted);
    }
    const btnSpeaker = this.container.querySelector('#btn-incall-speaker');
    if (btnSpeaker && btnSpeaker.classList) {
      btnSpeaker.classList.toggle('active', this.isSpeakerOn);
    }
    const btnKeypad = this.container.querySelector('#btn-incall-keypad');
    if (btnKeypad && btnKeypad.classList) {
      btnKeypad.classList.toggle('active', this.isInCallKeypadOpen);
    }
    const keypadDrawer = this.container.querySelector('#incall-keypad-drawer');
    if (keypadDrawer && keypadDrawer.classList) {
      keypadDrawer.classList.toggle('visible', this.isInCallKeypadOpen);
    }
  }

  render() {
    const html = this.getHtml();
    if (this.container) {
      this.container.innerHTML = html;
      this.bindEvents();
    }
    return html;
  }

  getHtml() {
    // If actively in a call (CONNECTED or SATELLITE_SOS or INCOMING), show In-Call Screen
    const isInCallActive = this.callState === CallState.CONNECTED ||
                           this.callState === CallState.SATELLITE_SOS ||
                           this.callState === CallState.INCOMING;

    return `
      <div class="pravah-phone-app ${isInCallActive ? 'mode-in-call' : 'mode-tabs'}">
        <!-- App Luxury Header Bar -->
        <header class="phone-app-header">
          <div class="brand-lockup">
            <span class="brand-glyph">📞</span>
            <div class="brand-text">
              <span class="brand-title">Pravah Phone</span>
              <span class="brand-subtitle">VoNR Lossless • 3GPP Rel-17 NTN</span>
            </div>
          </div>
          <button class="btn-satellite-pill" id="btn-header-sos" title="3GPP Rel-17 Satellite SOS Direct Beacon">
            <span class="sos-icon">🛰️</span>
            <span class="sos-text">Satellite SOS</span>
          </button>
        </header>

        <!-- Main Phone Body Views -->
        <main class="phone-app-body">
          ${this.renderActiveTabContent()}
        </main>

        <!-- Bottom Navigation Glass Bar (Hidden during active in-call screen) -->
        <nav class="phone-tab-bar ${isInCallActive ? 'hidden' : ''}">
          <button class="phone-tab-btn ${this.activeTab === 'keypad' ? 'active' : ''}" data-tab="keypad">
            <span class="tab-icon">⌨️</span>
            <span class="tab-label">Keypad</span>
          </button>
          <button class="phone-tab-btn ${this.activeTab === 'recents' ? 'active' : ''}" data-tab="recents">
            <span class="tab-icon">🕒</span>
            <span class="tab-label">Recents</span>
          </button>
          <button class="phone-tab-btn ${this.activeTab === 'contacts' ? 'active' : ''}" data-tab="contacts">
            <span class="tab-icon">👥</span>
            <span class="tab-label">Contacts</span>
          </button>
          <button class="phone-tab-btn tab-sos ${this.activeTab === 'sos' ? 'active' : ''}" data-tab="sos">
            <span class="tab-icon">🚨</span>
            <span class="tab-label">SOS NTN</span>
          </button>
        </nav>

        <!-- Simulated Live In-Call Screen Overlay -->
        ${isInCallActive ? this.renderInCallScreen() : ''}
      </div>
    `;
  }

  renderActiveTabContent() {
    switch (this.activeTab) {
      case 'recents':
        return this.renderRecentsTab();
      case 'contacts':
        return this.renderContactsTab();
      case 'sos':
        return this.renderSatelliteSosTab();
      case 'keypad':
      default:
        return this.renderKeypadTab();
    }
  }

  renderKeypadTab() {
    const matchingContacts = this.dialedDigits ? this.searchContacts(this.dialedDigits) : [];
    const topMatch = matchingContacts[0] || null;

    return `
      <section class="tab-keypad-view">
        <!-- Dialed Digits & T9 Matches Header -->
        <div class="digits-display-container">
          <div class="t9-match-banner ${topMatch ? 'has-match' : ''}" id="t9-top-match">
            ${topMatch ? `
              <div class="t9-suggestion-chip" data-call-number="${topMatch.number}">
                <span class="match-avatar">${topMatch.avatar}</span>
                <span class="match-name">${topMatch.name}</span>
                <span class="match-num">${topMatch.number}</span>
                <span class="match-call-hint">Tap to Call 📞</span>
              </div>
            ` : (this.dialedDigits ? '<span class="t9-no-match">No contacts match digits</span>' : '')}
          </div>

          <div class="dialed-digits-field ${this.dialedDigits ? 'has-input' : ''}" id="dialed-digits-field">
            ${this.dialedDigits || '<span class="digits-placeholder">Enter Number or T9</span>'}
          </div>
        </div>

        <!-- Glassmorphic Tactile Keypad Grid -->
        <div class="glass-keypad-grid">
          ${T9_KEYPAD.map(k => `
            <button class="keypad-glass-btn" data-key="${k.digit}">
              <span class="k-digit">${k.digit}</span>
              ${k.letters ? `<span class="k-letters">${k.letters}</span>` : `<span class="k-sub">${k.sub || ''}</span>`}
            </button>
          `).join('')}
        </div>

        <!-- Dialer Primary Actions Bar -->
        <div class="dialer-action-row">
          <button class="btn-glass-action btn-sos-quick" id="btn-action-sos" title="Direct Satellite SOS Beacon">
            🚨
          </button>
          <button class="btn-call-emerald" id="btn-action-call" title="Place Call">
            <span class="call-icon">📞</span>
          </button>
          <button class="btn-glass-action btn-backspace ${this.dialedDigits ? 'visible' : ''}" id="btn-action-backspace" title="Delete Digit">
            ⌫
          </button>
        </div>
      </section>
    `;
  }

  renderRecentsTab() {
    const recents = this.recentCalls;

    return `
      <section class="tab-recents-view">
        <div class="recents-header">
          <h2>Call History</h2>
          <span class="recents-counter">${recents.length} Calls</span>
        </div>

        <div class="recents-list-scroll">
          ${recents.length === 0 ? '<div class="recents-empty">No recent calls recorded.</div>' : ''}
          ${recents.map(r => `
            <div class="recent-call-item" data-call-number="${r.number}">
              <div class="recent-type-badge badge-${r.type}">
                ${r.type === CallType.INCOMING ? '↙' : (r.type === CallType.OUTGOING ? '↗' : '✕')}
              </div>
              <div class="recent-info">
                <div class="recent-name-row">
                  <span class="recent-name ${r.type === CallType.MISSED ? 'missed-text' : ''}">${r.name}</span>
                  ${r.isSatellite ? '<span class="pill-satellite-tag">🛰️ NTN</span>' : ''}
                  ${r.isSpam ? '<span class="pill-spam-tag">⚠️ Spam</span>' : ''}
                </div>
                <div class="recent-meta-row">
                  <span class="recent-number">${r.number}</span>
                  <span class="recent-dot">•</span>
                  <span class="recent-duration">${r.durationText || '00:00'}</span>
                </div>
              </div>
              <button class="btn-recents-call" data-call-number="${r.number}" title="Call Back">📞</button>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  renderContactsTab() {
    const query = this.contactsSearchQuery;
    const filtered = query ? this.searchContacts(query) : this.contacts;
    const favorites = filtered.filter(c => c.favorite);
    const standard = filtered.filter(c => !c.favorite);

    return `
      <section class="tab-contacts-view">
        <div class="contacts-search-box">
          <span class="search-lens">🔍</span>
          <input type="text"
            class="contacts-search-input"
            id="contacts-search-input"
            placeholder="Search contacts, numbers or T9..."
            value="${this.contactsSearchQuery}" />
          ${this.contactsSearchQuery ? '<button class="btn-clear-search" id="btn-clear-contact-search">✕</button>' : ''}
        </div>

        <div class="contacts-scroll-view">
          ${favorites.length > 0 ? `
            <div class="contacts-section-title">⭐ Favorites</div>
            <div class="favorites-grid">
              ${favorites.map(c => `
                <div class="favorite-contact-card" data-call-number="${c.number}">
                  <span class="fav-avatar">${c.avatar}</span>
                  <span class="fav-name">${c.name}</span>
                  <span class="fav-cat">${c.category}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <div class="contacts-section-title">All Contacts (${filtered.length})</div>
          <div class="contacts-list">
            ${filtered.length === 0 ? '<div class="contacts-empty">No contacts found matching search query.</div>' : ''}
            ${filtered.map(c => `
              <div class="contact-row-item" data-call-number="${c.number}">
                <div class="contact-avatar-pill">${c.avatar}</div>
                <div class="contact-details">
                  <div class="contact-name">${c.name}</div>
                  <div class="contact-num">${c.number} <span class="contact-cat">• ${c.category}</span></div>
                </div>
                <div class="contact-actions-inline">
                  <button class="btn-contact-quickcall" data-call-number="${c.number}" title="Call">📞</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </section>
    `;
  }

  renderSatelliteSosTab() {
    return `
      <section class="tab-sos-view">
        <div class="sos-hero-card">
          <div class="satellite-radar-icon">🛰️</div>
          <h2>3GPP Rel-17 Satellite SOS</h2>
          <p class="sos-hero-desc">
            Direct Low Earth Orbit (LEO) Emergency Beacon. Air-gapped RF rails bypass terrestrial networks to transmit uninterceptible cryptographic distress bursts directly to orbital satellites.
          </p>

          <div class="sos-spec-grid">
            <div class="spec-tile">
              <span class="spec-label">Standard</span>
              <span class="spec-val">3GPP Rel-17 NTN</span>
            </div>
            <div class="spec-tile">
              <span class="spec-label">Frequency</span>
              <span class="spec-val">L-Band 1621.25 MHz</span>
            </div>
            <div class="spec-tile">
              <span class="spec-label">Target Constellation</span>
              <span class="spec-val">StarLink NTN / Iridium</span>
            </div>
            <div class="spec-tile">
              <span class="spec-label">Link Margin</span>
              <span class="spec-val">+4.2 dB Verified</span>
            </div>
          </div>

          <div class="sos-trigger-actions">
            <button class="btn-sos-broadcast" id="btn-sos-broadcast">
              🚨 Broadcast 3GPP Rel-17 SOS Beacon
            </button>
            <p class="sos-legal-note">Mandated for authentic life-safety emergencies only.</p>
          </div>
        </div>
      </section>
    `;
  }

  renderInCallScreen() {
    const call = this.activeCall || {};
    const isSos = this.callState === CallState.SATELLITE_SOS || call.isSatellite;
    const isIncoming = this.callState === CallState.INCOMING;

    return `
      <div class="incall-fullscreen-overlay ${isSos ? 'sos-active' : ''}">
        <!-- Call Status & Quality Pill -->
        <div class="incall-top-status">
          <span class="incall-carrier-tag">
            ${isSos ? '🛰️ 3GPP REL-17 SATELLITE BEACON' : 'Pravah 5G VoNR • Lossless HD Voice'}
          </span>
          <div class="incall-duration-counter">
            ${isIncoming ? 'Incoming Call...' : formatCallDuration(this.callSeconds)}
          </div>
        </div>

        <!-- Contact Identity Centerpiece -->
        <div class="incall-contact-hero">
          <div class="incall-avatar-pulse">
            <div class="incall-avatar">${call.avatar || '📞'}</div>
            <div class="pulse-ring ring-1"></div>
            <div class="pulse-ring ring-2"></div>
          </div>
          <h1 class="incall-contact-name">${call.name || 'Active Call'}</h1>
          <p class="incall-contact-number">${call.number || ''}</p>
          ${isSos ? '<div class="incall-sos-flag">Air-Gap Interlock: 3.3V Dedicated NTN Rail Engaged</div>' : ''}
        </div>

        ${isIncoming ? `
          <!-- Incoming Call Action Buttons -->
          <div class="incoming-action-row">
            <button class="btn-incoming-decline" id="btn-incoming-decline">
              ✕ Decline
            </button>
            <button class="btn-incoming-answer" id="btn-incoming-answer">
              ✓ Answer
            </button>
          </div>
        ` : `
          <!-- Active Call 6-Tile Glass Controls -->
          <div class="incall-controls-grid">
            <button class="incall-tile-btn ${this.isMuted ? 'active' : ''}" id="btn-incall-mute">
              <span class="tile-icon">${this.isMuted ? '🔇' : '🎙️'}</span>
              <span class="tile-label">${this.isMuted ? 'Muted' : 'Mute'}</span>
            </button>
            <button class="incall-tile-btn ${this.isInCallKeypadOpen ? 'active' : ''}" id="btn-incall-keypad">
              <span class="tile-icon">⌨️</span>
              <span class="tile-label">Keypad</span>
            </button>
            <button class="incall-tile-btn ${this.isSpeakerOn ? 'active' : ''}" id="btn-incall-speaker">
              <span class="tile-icon">🔊</span>
              <span class="tile-label">${this.isSpeakerOn ? 'Speaker On' : 'Speaker'}</span>
            </button>
            <button class="incall-tile-btn" id="btn-incall-hold">
              <span class="tile-icon">⏸️</span>
              <span class="tile-label">Hold</span>
            </button>
            <button class="incall-tile-btn" id="btn-incall-record">
              <span class="tile-icon">🛡️</span>
              <span class="tile-label">AI Screen</span>
            </button>
            <button class="incall-tile-btn" id="btn-incall-contacts">
              <span class="tile-icon">👥</span>
              <span class="tile-label">Add Call</span>
            </button>
          </div>

          <!-- In-Call DTMF Keypad Drawer (Collapsible) -->
          <div class="incall-keypad-drawer ${this.isInCallKeypadOpen ? 'visible' : ''}" id="incall-keypad-drawer">
            <div class="incall-mini-keypad">
              ${T9_KEYPAD.map(k => `
                <button class="incall-dtmf-btn" data-key="${k.digit}">
                  <span class="dtmf-digit">${k.digit}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- End Call Primary Button -->
          <div class="incall-end-action">
            <button class="btn-end-call-crimson" id="btn-action-endcall" title="End Call">
              <span class="end-icon">📞</span>
            </button>
          </div>
        `}
      </div>
    `;
  }

  // ==========================================================================
  // Event Binding
  // ==========================================================================

  bindEvents() {
    if (!this.container || typeof this.container.querySelectorAll !== 'function') return;

    // Tab buttons
    this.container.querySelectorAll('.phone-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) this.setTab(tab);
      });
    });

    // Header SOS button
    this.container.querySelector('#btn-header-sos')?.addEventListener('click', () => {
      this.dialSatelliteSos();
    });

    // Keypad digit clicks
    this.container.querySelectorAll('.keypad-glass-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        if (key) this.dial(key);
      });
    });

    // Action row: Call button
    this.container.querySelector('#btn-action-call')?.addEventListener('click', () => {
      this.call();
    });

    // Action row: Backspace button
    this.container.querySelector('#btn-action-backspace')?.addEventListener('click', () => {
      this.backspace();
    });

    // Action row: Quick SOS button
    this.container.querySelector('#btn-action-sos')?.addEventListener('click', () => {
      this.dialSatelliteSos();
    });

    // T9 top match suggestion tap to call
    this.container.querySelector('.t9-suggestion-chip')?.addEventListener('click', (e) => {
      const chip = e.currentTarget;
      const num = chip?.getAttribute('data-call-number');
      if (num) this.call(num);
    });

    // Recents & Contacts quick call buttons
    this.container.querySelectorAll('[data-call-number]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.id === 'btn-clear-contact-search') return;
        const num = el.getAttribute('data-call-number');
        if (num && this.callState === CallState.IDLE) {
          this.call(num);
        }
      });
    });

    // Contacts search input
    const searchInput = this.container.querySelector('#contacts-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.contactsSearchQuery = e.target.value;
      const contactsScroll = this.container.querySelector('.contacts-scroll-view');
      if (contactsScroll) {
        // Re-render only contacts view portion
        const temp = document.createElement('div');
        temp.innerHTML = this.renderContactsTab();
        const newScroll = temp.querySelector('.contacts-scroll-view');
        if (newScroll) {
          contactsScroll.replaceWith(newScroll);
        }
      }
    });

    // Clear search button
    this.container.querySelector('#btn-clear-contact-search')?.addEventListener('click', () => {
      this.contactsSearchQuery = '';
      this.updateDisplay();
    });

    // SOS tab broadcast button
    this.container.querySelector('#btn-sos-broadcast')?.addEventListener('click', () => {
      this.dialSatelliteSos();
    });

    // In-call screen buttons
    this.container.querySelector('#btn-action-endcall')?.addEventListener('click', () => {
      this.endCall();
    });
    this.container.querySelector('#btn-incall-mute')?.addEventListener('click', () => {
      this.toggleMute();
    });
    this.container.querySelector('#btn-incall-speaker')?.addEventListener('click', () => {
      this.toggleSpeaker();
    });
    this.container.querySelector('#btn-incall-keypad')?.addEventListener('click', () => {
      this.toggleKeypad();
    });

    // In-call DTMF keypad clicks
    this.container.querySelectorAll('.incall-dtmf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.getAttribute('data-key');
        if (k) {
          this.playDtmfTone(k);
          this.triggerHapticPulse();
        }
      });
    });

    // Incoming call answer/decline
    this.container.querySelector('#btn-incoming-answer')?.addEventListener('click', () => {
      this.answerCall();
    });
    this.container.querySelector('#btn-incoming-decline')?.addEventListener('click', () => {
      this.declineCall();
    });
  }
}

// Global browser registration
if (typeof window !== 'undefined') {
  window.PravahPhoneApp = {
    PhoneDialerApp,
    CallState,
    CallType,
    T9_KEYPAD,
    DEFAULT_CONTACTS,
    DEFAULT_RECENTS,
    nameToT9,
    stringToT9,
    matchesContact,
    formatCallDuration
  };
}
