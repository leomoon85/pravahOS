// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file island.js
 * PravahOS Dynamic Island Morphing Subsystem.
 *
 * Implements fluid liquid-glass morphing state machine between 5 core states:
 * 1. COMPACT: Default hardware pill with camera lens and IR dot.
 * 2. MUSIC: Audio playback with live equalizers and play/pause controls.
 * 3. FLIGHT: Live departure tracker with route, countdown, and gate info.
 * 4. AUTH_SCAN: Holographic Face/Passkey scanner with glowing halo.
 * 5. POLICY_ALERT: Expanded policy gate confirmation with Approve/Deny actions.
 *
 * Designed with spring-physics transitions, multi-pass frosted glassmorphism,
 * and synthesized tactile haptic feedback.
 */

import { haptics, HapticType } from '../motion/haptics.js';

export const DynamicIslandState = {
  COMPACT: 'COMPACT',
  MUSIC: 'MUSIC',
  FLIGHT: 'FLIGHT',
  AUTH_SCAN: 'AUTH_SCAN',
  POLICY_ALERT: 'POLICY_ALERT',
  NTN_SOS: 'NTN_SOS'
};

export const ISLAND_DIMENSIONS = {
  [DynamicIslandState.COMPACT]: {
    width: 124,
    height: 32,
    borderRadius: 20
  },
  [DynamicIslandState.MUSIC]: {
    width: 280,
    height: 52,
    borderRadius: 26
  },
  [DynamicIslandState.FLIGHT]: {
    width: 295,
    height: 54,
    borderRadius: 27
  },
  [DynamicIslandState.AUTH_SCAN]: {
    width: 220,
    height: 58,
    borderRadius: 29
  },
  [DynamicIslandState.POLICY_ALERT]: {
    width: 340,
    height: 118,
    borderRadius: 28
  },
  [DynamicIslandState.NTN_SOS]: {
    width: 330,
    height: 54,
    borderRadius: 27
  }
};

/**
 * Default state payloads
 */
export const DEFAULT_ISLAND_PAYLOADS = {
  [DynamicIslandState.COMPACT]: {
    label: 'AIR-GAP SECURED'
  },
  [DynamicIslandState.MUSIC]: {
    title: 'Flowing Waves',
    artist: 'Pravah Ambient • 48kHz FLAC',
    isPlaying: true,
    progress: 0.42
  },
  [DynamicIslandState.FLIGHT]: {
    flightNumber: 'AI-202',
    route: 'DEL ➔ BLR',
    departure: 'DEL',
    arrival: 'BLR',
    countdown: 'T-45m',
    status: 'ON TIME',
    gate: 'Gate 14B'
  },
  [DynamicIslandState.AUTH_SCAN]: {
    status: 'SCANNING', // 'SCANNING' | 'VERIFIED' | 'FAILED'
    label: 'Authenticating Biometric...',
    authType: 'PASSKEY'
  },
  [DynamicIslandState.POLICY_ALERT]: {
    title: 'POLICY GATE VERIFICATION',
    riskLevel: 'IRREVERSIBLE',
    reason: 'Financial limit exceeded (Threshold ₹2,000)',
    description: 'Transfer ₹5,000 to Alice (alice@okhdfcbank)',
    caller: '/core/uia/task_fin_01',
    requiresApproval: true
  },
  [DynamicIslandState.NTN_SOS]: {
    status: 'NTN LOCKED • BURST SENT',
    satellite: 'StarLink-NTN-402',
    band: 'L-Band (1621.25 MHz)',
    margin: '+4.2 dB'
  }
};

/**
 * Controller for the PravahOS Dynamic Island.
 */
export class DynamicIslandController {
  constructor(container = null, options = {}) {
    this.container = container;
    this.state = DynamicIslandState.COMPACT;
    this.previousState = null;
    this.payloads = JSON.parse(JSON.stringify(DEFAULT_ISLAND_PAYLOADS));
    this.listeners = new Set();
    this.hapticsEnabled = options.enableHaptics ?? true;
    this.customHaptics = options.hapticsEngine || haptics;
    this.autoAuthTimer = null;

    if (this.container) {
      this.mount(this.container);
    }
  }

  /**
   * Register a state change listener callback.
   * @param {Function} cb (newState, prevState, payload) => void
   * @returns {Function} Unsubscribe function
   */
  onStateChange(cb) {
    if (typeof cb === 'function') {
      this.listeners.add(cb);
      return () => this.listeners.delete(cb);
    }
    return () => {};
  }

  /**
   * Broadcast state changes to subscribers.
   */
  notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this.state, this.previousState, this.getPayload(this.state));
      } catch (err) {
        console.error('DynamicIsland listener error:', err);
      }
    }
  }

  getState() {
    return this.state;
  }

  getPayload(stateKey = this.state) {
    return this.payloads[stateKey] || {};
  }

  /**
   * Trigger haptic feedback matching the target state.
   */
  triggerStateHaptic(state) {
    if (!this.hapticsEnabled || !this.customHaptics) return;

    switch (state) {
      case DynamicIslandState.COMPACT:
        this.customHaptics.lightTap();
        break;
      case DynamicIslandState.MUSIC:
        this.customHaptics.mediumSnap();
        break;
      case DynamicIslandState.FLIGHT:
        this.customHaptics.mediumSnap();
        break;
      case DynamicIslandState.AUTH_SCAN:
        this.customHaptics.selectionTick();
        break;
      case DynamicIslandState.POLICY_ALERT:
        this.customHaptics.heavyWarning();
        break;
      default:
        this.customHaptics.lightTap();
    }
  }

  /**
   * Morph to a new Island state.
   * @param {string} nextState - Target DynamicIslandState
   * @param {Object} [patchPayload] - Optional data payload updates
   * @returns {boolean} Whether state was updated
   */
  transitionTo(nextState, patchPayload = {}) {
    if (!Object.values(DynamicIslandState).includes(nextState)) {
      throw new Error(`Invalid DynamicIslandState: ${nextState}`);
    }

    if (this.autoAuthTimer) {
      clearTimeout(this.autoAuthTimer);
      this.autoAuthTimer = null;
    }

    this.previousState = this.state;
    this.state = nextState;

    if (patchPayload && typeof patchPayload === 'object') {
      this.payloads[nextState] = {
        ...this.payloads[nextState],
        ...patchPayload
      };
    }

    this.triggerStateHaptic(nextState);

    // If entering AUTH_SCAN, simulate passkey verification completion after 1.2s
    if (nextState === DynamicIslandState.AUTH_SCAN && this.payloads[nextState].status === 'SCANNING') {
      this.autoAuthTimer = setTimeout(() => {
        if (this.state === DynamicIslandState.AUTH_SCAN) {
          this.payloads[DynamicIslandState.AUTH_SCAN].status = 'VERIFIED';
          this.payloads[DynamicIslandState.AUTH_SCAN].label = 'Passkey Verified';
          if (this.hapticsEnabled && this.customHaptics) {
            this.customHaptics.successChime();
          }
          this.render();
          this.notifyListeners();
        }
      }, 1200);
    }

    this.render();
    this.notifyListeners();
    return true;
  }

  /**
   * Shortcut transitions
   */
  collapse() {
    return this.transitionTo(DynamicIslandState.COMPACT);
  }

  setMusic(trackInfo = {}) {
    return this.transitionTo(DynamicIslandState.MUSIC, trackInfo);
  }

  toggleMusicPlay() {
    const musicData = this.payloads[DynamicIslandState.MUSIC];
    musicData.isPlaying = !musicData.isPlaying;
    if (this.hapticsEnabled && this.customHaptics) {
      this.customHaptics.lightTap();
    }
    this.render();
    this.notifyListeners();
    return musicData.isPlaying;
  }

  setFlight(flightInfo = {}) {
    return this.transitionTo(DynamicIslandState.FLIGHT, flightInfo);
  }

  startAuthScan(authInfo = {}) {
    return this.transitionTo(DynamicIslandState.AUTH_SCAN, {
      status: 'SCANNING',
      label: 'Scanning Face & Passkey...',
      ...authInfo
    });
  }

  triggerPolicyAlert(policyInfo = {}) {
    return this.transitionTo(DynamicIslandState.POLICY_ALERT, policyInfo);
  }

  approvePolicy() {
    if (this.hapticsEnabled && this.customHaptics) {
      this.customHaptics.successChime();
    }
    const alertData = this.getPayload(DynamicIslandState.POLICY_ALERT);
    if (typeof alertData.onApprove === 'function') {
      alertData.onApprove();
    }
    this.collapse();
    return true;
  }

  denyPolicy() {
    if (this.hapticsEnabled && this.customHaptics) {
      this.customHaptics.heavyWarning();
    }
    const alertData = this.getPayload(DynamicIslandState.POLICY_ALERT);
    if (typeof alertData.onDeny === 'function') {
      alertData.onDeny();
    }
    this.collapse();
    return false;
  }

  /**
   * Cycle across states for demo / inspection purposes.
   */
  cycleNextState() {
    const states = [
      DynamicIslandState.COMPACT,
      DynamicIslandState.MUSIC,
      DynamicIslandState.FLIGHT,
      DynamicIslandState.AUTH_SCAN,
      DynamicIslandState.POLICY_ALERT
    ];
    const currentIndex = states.indexOf(this.state);
    const nextIndex = (currentIndex + 1) % states.length;
    return this.transitionTo(states[nextIndex]);
  }

  /**
   * Mount controller to a DOM container.
   */
  mount(element) {
    if (!element) return;
    this.container = element;
    this.container.classList.add('dynamic-island-root');
    this.bindDOMEvents();
    this.render();
  }

  bindDOMEvents() {
    if (!this.container) return;

    this.container.addEventListener('click', (e) => {
      // Don't cycle if user clicked an interactive control inside
      if (e.target.closest('.island-btn') || e.target.closest('button')) {
        return;
      }
      // If compact, expand to next state or music
      if (this.state === DynamicIslandState.COMPACT) {
        this.transitionTo(DynamicIslandState.MUSIC);
      } else {
        // Clicking body of expanded island collapses it back to compact
        this.collapse();
      }
    });
  }

  /**
   * Render HTML structure into container based on current state.
   */
  render() {
    if (!this.container) return;

    // Reset state classes
    this.container.classList.remove(
      'state-compact',
      'state-music',
      'state-flight',
      'state-auth-scan',
      'state-policy-alert',
      'state-ntn-sos',
      'expanded'
    );

    const dims = ISLAND_DIMENSIONS[this.state];
    if (dims) {
      this.container.style.setProperty('--island-target-width', `${dims.width}px`);
      this.container.style.setProperty('--island-target-height', `${dims.height}px`);
      this.container.style.setProperty('--island-target-radius', `${dims.borderRadius}px`);
    }

    switch (this.state) {
      case DynamicIslandState.COMPACT:
        this.container.classList.add('state-compact');
        this.renderCompact();
        break;
      case DynamicIslandState.MUSIC:
        this.container.classList.add('state-music', 'expanded');
        this.renderMusic();
        break;
      case DynamicIslandState.FLIGHT:
        this.container.classList.add('state-flight', 'expanded');
        this.renderFlight();
        break;
      case DynamicIslandState.AUTH_SCAN:
        this.container.classList.add('state-auth-scan', 'expanded');
        this.renderAuthScan();
        break;
      case DynamicIslandState.POLICY_ALERT:
        this.container.classList.add('state-policy-alert', 'expanded');
        this.renderPolicyAlert();
        break;
      case DynamicIslandState.NTN_SOS:
        this.container.classList.add('state-ntn-sos', 'expanded');
        this.renderNtnSos();
        break;
    }
  }

  renderCompact() {
    const payload = this.getPayload(DynamicIslandState.COMPACT);
    this.container.innerHTML = `
      <div class="island-compact-view">
        <div class="camera-lens" title="Front Sensor Hardware Cutout"></div>
        <div class="pill-badge" id="island-compact-label">${payload.label || 'AIR-GAP ACTIVE'}</div>
        <div class="ir-dot" title="IR Proximity / Passkey Scanner"></div>
      </div>
    `;
  }

  renderMusic() {
    const payload = this.getPayload(DynamicIslandState.MUSIC);
    const isPlaying = payload.isPlaying !== false;

    this.container.innerHTML = `
      <div class="island-morph-surface island-music-surface">
        <div class="music-left">
          <div class="music-album-art ${isPlaying ? 'spinning' : ''}">
            <div class="vinyl-center"></div>
          </div>
          <div class="music-info">
            <span class="music-title">${payload.title || 'Flowing Waves'}</span>
            <span class="music-artist">${payload.artist || 'Pravah Ambient'}</span>
          </div>
        </div>

        <div class="music-right">
          <div class="equalizer-bars ${isPlaying ? 'active' : 'paused'}">
            <div class="eq-bar bar-1"></div>
            <div class="eq-bar bar-2"></div>
            <div class="eq-bar bar-3"></div>
            <div class="eq-bar bar-4"></div>
          </div>
          <button type="button" class="island-btn btn-music-play" id="island-btn-play" title="${isPlaying ? 'Pause' : 'Play'}">
            ${isPlaying ? '❚❚' : '▶'}
          </button>
        </div>
      </div>
    `;

    const playBtn = this.container.querySelector('#island-btn-play');
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMusicPlay();
      });
    }
  }

  renderFlight() {
    const payload = this.getPayload(DynamicIslandState.FLIGHT);
    const gateLabel = payload.gate ? (payload.gate.startsWith('Gate') ? payload.gate : `Gate ${payload.gate}`) : 'Gate 14B';

    this.container.innerHTML = `
      <div class="island-morph-surface island-flight-surface">
        <div class="flight-left">
          <span class="flight-badge">✈ ${payload.flightNumber || 'AI-202'}</span>
          <div class="flight-route">
            <span class="route-origin">${payload.departure || 'DEL'}</span>
            <span class="route-arrow">➔</span>
            <span class="route-dest">${payload.arrival || 'BLR'}</span>
          </div>
        </div>

        <div class="flight-right">
          <span class="flight-gate">${gateLabel}</span>
          <div class="flight-countdown-pill">
            <span class="countdown-dot"></span>
            <span class="countdown-text">${payload.countdown || 'T-45m'}</span>
          </div>
        </div>
      </div>
    `;
  }

  renderAuthScan() {
    const payload = this.getPayload(DynamicIslandState.AUTH_SCAN);
    const isVerified = payload.status === 'VERIFIED';

    this.container.innerHTML = `
      <div class="island-morph-surface island-auth-surface ${isVerified ? 'verified' : 'scanning'}">
        <div class="auth-icon-wrap">
          <div class="auth-halo-ring ${isVerified ? 'verified' : 'spinning'}"></div>
          <span class="auth-icon">${isVerified ? '✓' : '⛊'}</span>
        </div>
        <div class="auth-content">
          <span class="auth-title">${isVerified ? 'Passkey Verified' : 'Biometric Scan'}</span>
          <span class="auth-subtitle">${isVerified ? 'Identity Authenticated' : (payload.label || 'Scanning Iris & Face...')}</span>
        </div>
        <div class="auth-indicator">
          <div class="auth-dot ${isVerified ? 'green' : 'cyan'}"></div>
        </div>
      </div>
    `;
  }

  renderPolicyAlert() {
    const payload = this.getPayload(DynamicIslandState.POLICY_ALERT);

    this.container.innerHTML = `
      <div class="island-morph-surface island-policy-surface">
        <div class="policy-header">
          <div class="policy-title-group">
            <span class="policy-warn-glyph">⚠️</span>
            <span class="policy-title">${payload.title || 'POLICY GATE APPROVAL'}</span>
          </div>
          <span class="policy-risk-chip risk-${(payload.riskLevel || 'IRREVERSIBLE').toLowerCase()}">
            ${payload.riskLevel || 'IRREVERSIBLE'}
          </span>
        </div>

        <div class="policy-body">
          <p class="policy-desc">${payload.description || payload.reason || 'Action mandates explicit biometric sign-off.'}</p>
        </div>

        <div class="policy-actions">
          <button type="button" class="island-btn btn-policy-deny" id="island-policy-deny">
            ✕ Deny
          </button>
          <button type="button" class="island-btn btn-policy-approve" id="island-policy-approve">
            ✓ Approve & Authorize
          </button>
        </div>
      </div>
    `;

    const btnDeny = this.container.querySelector('#island-policy-deny');
    const btnApprove = this.container.querySelector('#island-policy-approve');

    if (btnDeny) {
      btnDeny.addEventListener('click', (e) => {
        e.stopPropagation();
        this.denyPolicy();
      });
    }

    if (btnApprove) {
      btnApprove.addEventListener('click', (e) => {
        e.stopPropagation();
        this.approvePolicy();
      });
    }
  }

  renderNtnSos() {
    const payload = this.getPayload(DynamicIslandState.NTN_SOS);
    const statusText = payload.status || 'NTN LOCKED • BURST SENT';
    const satName = payload.satellite || 'StarLink-NTN-402';
    const margin = payload.margin || '+4.2 dB';

    this.container.innerHTML = `
      <div class="island-morph-surface island-ntn-surface">
        <div class="ntn-island-left">
          <div class="ntn-satellite-beacon">
            <span class="ntn-sat-icon">🛰️</span>
            <div class="beacon-wave-ring"></div>
          </div>
          <div class="ntn-island-info">
            <span class="ntn-island-status">${statusText}</span>
            <span class="ntn-island-sat">${satName} • ${margin} margin</span>
          </div>
        </div>

        <div class="ntn-island-right">
          <span class="ntn-island-pill-tag">AIR-GAP RF</span>
        </div>
      </div>
    `;
  }
}

// Window registration
if (typeof window !== 'undefined') {
  window.PravahIsland = {
    DynamicIslandState,
    ISLAND_DIMENSIONS,
    DEFAULT_ISLAND_PAYLOADS,
    DynamicIslandController
  };
}
