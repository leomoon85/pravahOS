// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file lockscreen.js
 * PravahOS 1Hz Always-On Display (AOD) & Biometric Lock Screen Subsystem.
 *
 * Implements:
 * 1. 1Hz Ultra-Low Power AOD: Pure OLED true-black (0.00W) scanline, minimal clock,
 *    subtle battery pill, and glanceable flight/audio ticker.
 * 2. Lock Screen: Dynamic wallpaper glow, lock glyph, notification summary pill,
 *    and corner shortcuts (🔦 Torch instant PWM & 📷 Camera viewfinder).
 * 3. In-Display Ultrasonic Biometric Sensor: Tactile capacitive scan with neon cyan
 *    sonic ripple animation and instant unlock.
 */

export const LockState = {
  UNLOCKED: 'UNLOCKED',
  LOCKED: 'LOCKED',
  AOD_1HZ: 'AOD_1HZ'
};

export class LockScreen {
  constructor(options = {}) {
    this.container = options.container || null;
    this.state = options.initialState || LockState.UNLOCKED;
    this.onStateChange = options.onStateChange || null;
    this.onTorchToggle = options.onTorchToggle || null;
    this.onCameraLaunch = options.onCameraLaunch || null;
    this.onUnlock = options.onUnlock || null;

    this.batteryLevel = options.batteryLevel || 88;
    this.isCharging = options.isCharging || false;
    this.flightInfo = options.flightInfo || { flight: 'AI-202', gate: '14B', time: '10:30' };
    this.audioTrack = options.audioTrack || { title: 'Midnight City', artist: 'M83' };

    this.clockTimer = null;

    if (this.container) {
      this.mount(this.container);
    }
  }

  mount(container) {
    this.container = container;
    this.container.classList.add('lockscreen-root');
    this.render();
    this.bindEvents();
    this.startClock();
    this.updateStateClasses();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <!-- 1. 1Hz Low-Power Always-On Display (AOD) Surface -->
      <div class="aod-surface" id="aod-surface">
        <div class="aod-clock-wrap">
          <div class="aod-clock-time" id="aod-clock-time">10:30</div>
          <div class="aod-clock-date" id="aod-clock-date">Thursday, Nov 12</div>
        </div>
        <div class="aod-pill-row">
          <div class="aod-pill aod-battery-pill">
            <span class="aod-icon">⚡</span>
            <span id="aod-battery-val">${this.batteryLevel}%</span>
          </div>
          <div class="aod-pill aod-flight-pill">
            <span class="aod-icon">✈</span>
            <span>${this.flightInfo.flight} Gate ${this.flightInfo.gate}</span>
          </div>
        </div>
        <div class="aod-hint">Tap or lift to wake</div>
      </div>

      <!-- 2. Active Lock Screen Surface -->
      <div class="lock-surface" id="lock-surface">
        <div class="lock-header">
          <div class="lock-status-glyph" id="lock-status-glyph">🔒</div>
          <div class="lock-time" id="lock-clock-time">10:30</div>
          <div class="lock-date" id="lock-clock-date">Thursday, November 12</div>
        </div>

        <div class="lock-glance-cards">
          <div class="lock-card lock-flight-card">
            <div class="lock-card-badge">LIVE ACTIVITY</div>
            <div class="lock-card-row">
              <span class="lock-card-title">Flight ${this.flightInfo.flight}</span>
              <span class="lock-card-status">BOARDING IN 45m</span>
            </div>
            <div class="lock-card-meta">Gate ${this.flightInfo.gate} • Terminal 3 • Seat 14A</div>
          </div>
        </div>

        <!-- In-Display Ultrasonic Biometric Fingerprint Sensor -->
        <div class="biometric-fingerprint-wrap" id="biometric-fingerprint" title="Press & hold to unlock">
          <div class="fingerprint-ripple" id="fingerprint-ripple"></div>
          <div class="fingerprint-icon">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M12 2a10 10 0 0 0-10 10c0 3.2 1.5 6 3.8 7.8M12 22a10 10 0 0 0 10-10c0-3.2-1.5-6-3.8-7.8"/>
              <path d="M12 6a6 6 0 0 0-6 6c0 2 1 3.8 2.5 5M12 18a6 6 0 0 0 6-6c0-2-1-3.8-2.5-5"/>
              <circle cx="12" cy="12" r="2"/>
            </svg>
          </div>
          <span class="biometric-label">Scan to Unlock</span>
        </div>

        <!-- Bottom Corner Shortcuts -->
        <div class="lock-bottom-shortcuts">
          <button class="lock-shortcut-btn btn-torch" id="btn-lock-torch" title="Instant Flashlight">
            🔦
          </button>
          <div class="lock-swipe-hint">
            <span class="swipe-arrow">⌃</span>
            <span>Swipe up or scan to open</span>
          </div>
          <button class="lock-shortcut-btn btn-camera" id="btn-lock-camera" title="Instant Camera">
            📷
          </button>
        </div>
      </div>
    `;
  }

  bindEvents() {
    if (!this.container) return;

    // AOD tap wakes to Lock Screen
    const aodSurface = this.container.querySelector('#aod-surface');
    aodSurface?.addEventListener('click', () => {
      this.wakeToLockScreen();
    });

    // Biometric fingerprint scanner press
    const fpWrap = this.container.querySelector('#biometric-fingerprint');
    fpWrap?.addEventListener('click', () => {
      this.triggerBiometricUnlock();
    });

    // Torch shortcut
    const btnTorch = this.container.querySelector('#btn-lock-torch');
    btnTorch?.addEventListener('click', (e) => {
      e.stopPropagation();
      btnTorch.classList.toggle('active');
      if (this.onTorchToggle) this.onTorchToggle(btnTorch.classList.contains('active'));
    });

    // Camera shortcut
    const btnCamera = this.container.querySelector('#btn-lock-camera');
    btnCamera?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onCameraLaunch) this.onCameraLaunch();
    });
  }

  startClock() {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${mins}`;

      const options = { weekday: 'long', month: 'short', day: 'numeric' };
      const dateStr = now.toLocaleDateString('en-US', options);

      if (this.container) {
        const aodTime = this.container.querySelector('#aod-clock-time');
        const aodDate = this.container.querySelector('#aod-clock-date');
        const lockTime = this.container.querySelector('#lock-clock-time');
        const lockDate = this.container.querySelector('#lock-clock-date');

        if (aodTime) aodTime.textContent = timeStr;
        if (aodDate) aodDate.textContent = dateStr;
        if (lockTime) lockTime.textContent = timeStr;
        if (lockDate) lockDate.textContent = dateStr;
      }
    };

    updateTime();
    this.clockTimer = setInterval(updateTime, 1000);
  }

  stopClock() {
    if (this.clockTimer) clearInterval(this.clockTimer);
  }

  // State transitions
  lock() {
    this.state = LockState.LOCKED;
    this.updateStateClasses();
    if (this.onStateChange) this.onStateChange(this.state);
  }

  enterAOD() {
    this.state = LockState.AOD_1HZ;
    this.updateStateClasses();
    if (this.onStateChange) this.onStateChange(this.state);
  }

  wakeToLockScreen() {
    if (this.state === LockState.AOD_1HZ) {
      this.state = LockState.LOCKED;
      this.updateStateClasses();
      if (this.onStateChange) this.onStateChange(this.state);
    }
  }

  unlock() {
    this.state = LockState.UNLOCKED;
    this.updateStateClasses();
    if (this.onUnlock) this.onUnlock();
    if (this.onStateChange) this.onStateChange(this.state);
  }

  triggerBiometricUnlock() {
    const ripple = this.container?.querySelector('#fingerprint-ripple');
    const glyph = this.container?.querySelector('#lock-status-glyph');

    if (ripple) ripple.classList.add('scanning');
    if (glyph) glyph.textContent = '🔓';

    setTimeout(() => {
      if (ripple) ripple.classList.remove('scanning');
      this.unlock();
    }, 280);
  }

  updateStateClasses() {
    if (!this.container) return;

    this.container.classList.toggle('state-unlocked', this.state === LockState.UNLOCKED);
    this.container.classList.toggle('state-locked', this.state === LockState.LOCKED);
    this.container.classList.toggle('state-aod', this.state === LockState.AOD_1HZ);
  }

  updateTelemetry({ battery, flight, audio } = {}) {
    if (battery !== undefined) {
      this.batteryLevel = battery.level ?? battery;
      const el = this.container?.querySelector('#aod-battery-val');
      if (el) el.textContent = `${this.batteryLevel}%`;
    }
    if (flight) this.flightInfo = flight;
    if (audio) this.audioTrack = audio;
  }
}

// Window global registration
if (typeof window !== 'undefined') {
  window.PravahLockScreen = {
    LockState,
    LockScreen
  };
}
