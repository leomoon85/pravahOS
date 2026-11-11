// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file shade.js
 * PravahOS Control Center & Hardware Shade Subsystem.
 *
 * Implements:
 * 1. Pull-down sliding shade from top of screen with spring physics (ODE 2nd-order solver).
 * 2. 8 Tactile Quick Hardware Toggles:
 *    - 🔦 Torch / Flashlight (with visual screen flashlight beam simulation)
 *    - ✈ Air-Gap / Airplane Mode (instantly drops RF power rails to 0.0V)
 *    - 📶 Wi-Fi 7 (802.11be 6GHz local radio)
 *    - ⚡ Battery Power Profile (cycles ECO [INT4], BALANCED [INT8], BOOST [FP16])
 *    - 📡 5G Cellular Data (Sub-6 + mmWave baseband transceivers)
 *    - ᛒ Bluetooth (5.4 LE peripheral scanning & Auracast)
 *    - 🔄 Auto-Rotate Lock (PORTRAIT / AUTO)
 *    - 🛡️ Sensor Privacy Kill (hardware electronic disconnect for Camera & Mic rails)
 * 3. Interactive Smooth Sliders for Brightness (0-100%) and Audio Volume (0-100%).
 * 4. Intelligent Pulse Live Activities Feed:
 *    - Spotify Audio HAL player with live playback toggle and equalizer bars
 *    - Flight AI-202 radar gate alert & boarding telemetry
 *    - Active DAG microkernel task progress & Merkle verification stream
 */

import { haptics } from '../motion/haptics.js';
import { Spring, SpringPresets, VelocityTracker, rubberBandClamp } from '../motion/spring.js';

export const ShadeState = {
  COLLAPSED: 'COLLAPSED',
  SLIDING: 'SLIDING',
  EXPANDED: 'EXPANDED'
};

export const PowerProfile = {
  ECO: 'ECO',
  BALANCED: 'BALANCED',
  BOOST: 'BOOST'
};

export const POWER_PROFILES = {
  [PowerProfile.ECO]: {
    id: PowerProfile.ECO,
    label: 'ECO',
    quantization: 'INT4',
    npuFreq: '400 MHz',
    powerDraw: '0.8 W',
    description: 'Battery Saver • INT4 Quantized'
  },
  [PowerProfile.BALANCED]: {
    id: PowerProfile.BALANCED,
    label: 'BALANCED',
    quantization: 'INT8',
    npuFreq: '1.2 GHz',
    powerDraw: '2.2 W',
    description: 'Balanced • INT8 Quantized'
  },
  [PowerProfile.BOOST]: {
    id: PowerProfile.BOOST,
    label: 'BOOST',
    quantization: 'FP16',
    npuFreq: '2.0 GHz',
    powerDraw: '5.8 W',
    description: 'Full Throttle • FP16 Unquantized'
  }
};

export const ToggleId = {
  TORCH: 'torch',
  AIRGAP: 'airgap',
  WIFI: 'wifi',
  POWER: 'power',
  CELLULAR: 'cellular',
  BLUETOOTH: 'bluetooth',
  ROTATION: 'rotation',
  PRIVACY: 'privacy'
};

export const DEFAULT_TOGGLES = {
  [ToggleId.TORCH]: false,
  [ToggleId.AIRGAP]: true, // Default air-gap secured offline
  [ToggleId.WIFI]: false,
  [ToggleId.POWER]: PowerProfile.BALANCED,
  [ToggleId.CELLULAR]: false,
  [ToggleId.BLUETOOTH]: false,
  [ToggleId.ROTATION]: 'PORTRAIT', // 'PORTRAIT' or 'AUTO'
  [ToggleId.PRIVACY]: true // Camera & Mic hardware kill enabled by default
};

export const DEFAULT_POWER_RAILS = {
  rfRail: 0.0,       // 0.0V when air-gap active, 1.2V when normal
  basebandRail: 0.0, // 0.0V when air-gap active, 1.8V when normal
  bleRail: 0.0,      // 0.0V when air-gap active, 1.0V when normal
  cameraRail: 0.0,   // 0.0V when privacy kill active, 2.8V when normal
  micRail: 0.0,      // 0.0V when privacy kill active, 1.8V when normal
  socCoreRail: 0.85  // Main SoC core rail
};

export const DEFAULT_PULSE_FEED = {
  spotify: {
    isPlaying: true,
    track: 'Midnight City',
    artist: "M83 • Hurry Up, We're Dreaming",
    progressSec: 142,
    durationSec: 244,
    eqBars: [0.4, 0.85, 0.55, 0.95, 0.6]
  },
  flight: {
    flightNum: 'AI-202',
    route: 'DEL ➔ BLR',
    gate: '14B',
    terminal: 'T3',
    status: 'BOARDING',
    minutesToClose: 22,
    seat: '12A'
  },
  task: {
    title: 'Flight Radar & DAG Synthesis',
    stage: 'Stage 3 of 4: Merkle Root Sealed',
    progress: 78,
    latency: '1.2ms',
    power: '1.8W'
  }
};

/**
 * Format seconds into mm:ss string
 */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * PravahOS Control Center & Hardware Shade Controller.
 */
export class ControlCenterShade {
  constructor(options = {}) {
    this.container = options.container || null;
    this.backdrop = options.backdrop || null;
    this.pullTrigger = options.pullTrigger || null;
    this.torchBeamContainer = options.torchBeamContainer || null;
    this.brightnessFilter = options.brightnessFilter || null;

    // State machine
    this.state = ShadeState.COLLAPSED;

    // Hardware quick toggles
    this.toggles = {
      ...DEFAULT_TOGGLES,
      ...(options.initialToggles || {})
    };

    // Electronic power rails state (Volts)
    this.powerRails = {
      ...DEFAULT_POWER_RAILS
    };
    this._recomputePowerRails();

    // Sliders
    this.brightness = options.brightness !== undefined ? options.brightness : 85;
    this.volume = options.volume !== undefined ? options.volume : 75;

    // Pulse live activities
    this.pulseFeed = {
      spotify: { ...DEFAULT_PULSE_FEED.spotify, ...(options.spotify || {}) },
      flight: { ...DEFAULT_PULSE_FEED.flight, ...(options.flight || {}) },
      task: { ...DEFAULT_PULSE_FEED.task, ...(options.task || {}) }
    };

    // Physics & Gestures
    this.spring = new Spring(SpringPresets.SNAPPY || { stiffness: 230, damping: 22, mass: 1 });
    this.velocityTracker = new VelocityTracker();
    this.isDragging = false;
    this.startY = 0;
    this.currentY = 0;

    // Callbacks
    this.onStateChange = options.onStateChange || null;
    this.onToggleChange = options.onToggleChange || null;
    this.onAirGapChange = options.onAirGapChange || null;
    this.onPowerProfileChange = options.onPowerProfileChange || null;
    this.onTorchChange = options.onTorchChange || null;
    this.onBrightnessChange = options.onBrightnessChange || null;
    this.onVolumeChange = options.onVolumeChange || null;

    if (this.container) {
      this.render();
      this.bindGestures();
      this.bindKeyboard();
    }
  }

  /**
   * Internal helper to synchronize electronic power rails with toggles
   */
  _recomputePowerRails() {
    if (this.toggles[ToggleId.AIRGAP]) {
      this.powerRails.rfRail = 0.0;
      this.powerRails.basebandRail = 0.0;
      this.powerRails.bleRail = 0.0;
    } else {
      this.powerRails.rfRail = this.toggles[ToggleId.WIFI] ? 1.2 : 0.0;
      this.powerRails.basebandRail = this.toggles[ToggleId.CELLULAR] ? 1.8 : 0.0;
      this.powerRails.bleRail = this.toggles[ToggleId.BLUETOOTH] ? 1.0 : 0.0;
    }

    if (this.toggles[ToggleId.PRIVACY]) {
      this.powerRails.cameraRail = 0.0;
      this.powerRails.micRail = 0.0;
    } else {
      this.powerRails.cameraRail = 2.8;
      this.powerRails.micRail = 1.8;
    }
  }

  // ==========================================================================
  // DOM Rendering
  // ==========================================================================

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="shade-scroll-content">
        <!-- 1. Header & Rail Status -->
        <div class="shade-header">
          <div class="shade-header-left">
            <div class="shade-os-pill">
              <div class="shade-live-dot"></div>
              <span>PRAVAH-CC</span>
            </div>
            <div class="shade-title-text">
              <h2>Control Center</h2>
              <span id="shade-status-summary">${this.toggles.airgap ? 'HARDWARE AIR-GAP SECURED' : 'RADIOS CONNECTED'}</span>
            </div>
          </div>
          <div class="shade-header-right">
            <div id="shade-rail-status-pill" class="shade-rail-status">
              RF: ${this.powerRails.rfRail.toFixed(1)}V • NPU: ${POWER_PROFILES[this.toggles.power].npuFreq}
            </div>
            <button id="btn-shade-close" class="shade-close-btn" title="Dismiss Control Center">✕</button>
          </div>
        </div>

        <!-- 2. 8 Tactile Quick Hardware Toggles -->
        <div class="shade-toggles-section">
          <div class="shade-section-title">
            <span>Hardware Toggles</span>
            <span style="font-size:0.6rem; color:var(--text-muted); font-family:var(--font-mono);">8 RAILS DISCRETELY GATED</span>
          </div>
          <div class="shade-toggles-grid">
            <!-- 1. Torch -->
            <div class="hw-toggle-card ${this.toggles.torch ? 'active' : ''}" data-toggle="torch" id="toggle-torch">
              <div class="hw-toggle-icon">🔦</div>
              <div class="hw-toggle-meta">
                <span class="hw-toggle-title">Flashlight</span>
                <span class="hw-toggle-sub" id="sub-torch">${this.toggles.torch ? 'High-CRI ON' : 'Off'}</span>
              </div>
            </div>

            <!-- 2. Air-Gap Mode -->
            <div class="hw-toggle-card ${this.toggles.airgap ? 'active' : ''}" data-toggle="airgap" id="toggle-airgap">
              <div class="hw-toggle-icon">✈</div>
              <div class="hw-toggle-meta">
                <span class="hw-toggle-title">Air-Gap</span>
                <span class="hw-toggle-sub" id="sub-airgap">${this.toggles.airgap ? '0.0V Rails' : 'Disengaged'}</span>
              </div>
            </div>

            <!-- 3. Wi-Fi 7 -->
            <div class="hw-toggle-card ${this.toggles.wifi ? 'active' : ''}" data-toggle="wifi" id="toggle-wifi">
              <div class="hw-toggle-icon">📶</div>
              <div class="hw-toggle-meta">
                <span class="hw-toggle-title">Wi-Fi 7</span>
                <span class="hw-toggle-sub" id="sub-wifi">${this.toggles.wifi ? '6GHz Mesh' : 'Off'}</span>
              </div>
            </div>

            <!-- 4. Battery Power Mode -->
            <div class="hw-toggle-card ${'profile-' + this.toggles.power.toLowerCase()}" data-toggle="power" id="toggle-power">
              <div class="hw-toggle-icon">⚡</div>
              <div class="hw-toggle-meta">
                <span class="hw-toggle-title" id="title-power">${POWER_PROFILES[this.toggles.power].label}</span>
                <span class="hw-toggle-sub" id="sub-power">${POWER_PROFILES[this.toggles.power].quantization} • ${POWER_PROFILES[this.toggles.power].powerDraw}</span>
              </div>
            </div>

            <!-- 5. 5G Cellular Data -->
            <div class="hw-toggle-card ${this.toggles.cellular ? 'active' : ''}" data-toggle="cellular" id="toggle-cellular">
              <div class="hw-toggle-icon">📡</div>
              <div class="hw-toggle-meta">
                <span class="hw-toggle-title">5G Data</span>
                <span class="hw-toggle-sub" id="sub-cellular">${this.toggles.cellular ? 'mmWave Sub-6' : 'Modem Cut'}</span>
              </div>
            </div>

            <!-- 6. Bluetooth -->
            <div class="hw-toggle-card ${this.toggles.bluetooth ? 'active' : ''}" data-toggle="bluetooth" id="toggle-bluetooth">
              <div class="hw-toggle-icon">ᛒ</div>
              <div class="hw-toggle-meta">
                <span class="hw-toggle-title">Bluetooth</span>
                <span class="hw-toggle-sub" id="sub-bluetooth">${this.toggles.bluetooth ? 'LE Scanning' : 'Radio Cut'}</span>
              </div>
            </div>

            <!-- 7. Auto-Rotate Lock -->
            <div class="hw-toggle-card ${this.toggles.rotation === 'PORTRAIT' ? 'active' : ''}" data-toggle="rotation" id="toggle-rotation">
              <div class="hw-toggle-icon">🔄</div>
              <div class="hw-toggle-meta">
                <span class="hw-toggle-title">Rotation</span>
                <span class="hw-toggle-sub" id="sub-rotation">${this.toggles.rotation}</span>
              </div>
            </div>

            <!-- 8. Sensor Privacy Kill -->
            <div class="hw-toggle-card ${this.toggles.privacy ? 'active' : ''}" data-toggle="privacy" id="toggle-privacy">
              <div class="hw-toggle-icon">🛡️</div>
              <div class="hw-toggle-meta">
                <span class="hw-toggle-title">Privacy Kill</span>
                <span class="hw-toggle-sub" id="sub-privacy">${this.toggles.privacy ? 'Cam/Mic 0.0V' : 'Active'}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. Sliders: Brightness & Audio Volume -->
        <div class="shade-sliders-row">
          <!-- Brightness Slider -->
          <div class="shade-slider-card slider-brightness">
            <div class="shade-slider-top">
              <div class="shade-slider-label-group">
                <span class="shade-slider-icon" id="icon-brightness">🔆</span>
                <span class="shade-slider-title">Display Brightness</span>
              </div>
              <span id="val-brightness" class="shade-slider-val">${this.brightness}%</span>
            </div>
            <div class="shade-slider-track-wrap" id="track-brightness-wrap">
              <div class="shade-slider-track">
                <div id="fill-brightness" class="shade-slider-fill" style="width: ${this.brightness}%;"></div>
              </div>
            </div>
          </div>

          <!-- Volume Slider -->
          <div class="shade-slider-card slider-volume">
            <div class="shade-slider-top">
              <div class="shade-slider-label-group">
                <span class="shade-slider-icon" id="icon-volume">🔊</span>
                <span class="shade-slider-title">Master Audio</span>
              </div>
              <span id="val-volume" class="shade-slider-val">${this.volume}%</span>
            </div>
            <div class="shade-slider-track-wrap" id="track-volume-wrap">
              <div class="shade-slider-track">
                <div id="fill-volume" class="shade-slider-fill" style="width: ${this.volume}%;"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Intelligent Pulse Live Activities Feed -->
        <div class="shade-pulse-section">
          <div class="shade-section-title">
            <span style="display:flex; align-items:center; gap:6px;">
              <span class="shade-live-dot"></span> Intelligent Pulse Live Feed
            </span>
            <span style="font-size:0.6rem; color:var(--text-muted); font-family:var(--font-mono);">REAL-TIME SYNC</span>
          </div>

          <div class="shade-pulse-cards">
            <!-- Spotify Card -->
            <div id="card-pulse-spotify" class="pulse-card pulse-spotify ${this.pulseFeed.spotify.isPlaying ? '' : 'paused'}">
              <div class="spotify-row">
                <div class="spotify-art-wrap">🎵</div>
                <div class="spotify-meta">
                  <span class="spotify-track">${this.pulseFeed.spotify.track}</span>
                  <span class="spotify-artist">${this.pulseFeed.spotify.artist}</span>
                </div>
                <div class="spotify-controls">
                  <div class="spotify-eq-bars">
                    <div class="eq-bar"></div>
                    <div class="eq-bar"></div>
                    <div class="eq-bar"></div>
                    <div class="eq-bar"></div>
                    <div class="eq-bar"></div>
                  </div>
                  <button id="btn-spotify-toggle" class="spotify-play-btn" title="Toggle Play/Pause">
                    ${this.pulseFeed.spotify.isPlaying ? '⏸' : '▶'}
                  </button>
                </div>
              </div>
              <div class="spotify-progress-wrap">
                <span id="spotify-cur-time">${formatTime(this.pulseFeed.spotify.progressSec)}</span>
                <div class="spotify-progress-bar">
                  <div id="spotify-progress-fill" class="spotify-progress-fill" style="width: ${(this.pulseFeed.spotify.progressSec / this.pulseFeed.spotify.durationSec) * 100}%;"></div>
                </div>
                <span>${formatTime(this.pulseFeed.spotify.durationSec)}</span>
              </div>
            </div>

            <!-- Flight AI-202 Radar Card -->
            <div class="pulse-card pulse-flight">
              <div class="flight-header-row">
                <div class="flight-number-badge">
                  <span>✈</span>
                  <span>${this.pulseFeed.flight.flightNum}</span>
                  <span class="flight-route-pill">${this.pulseFeed.flight.route}</span>
                </div>
                <span class="flight-status-pill">${this.pulseFeed.flight.status}</span>
              </div>
              <div class="flight-body-row">
                <div class="flight-detail-item">
                  <span class="flight-detail-label">Gate</span>
                  <span class="flight-detail-val">${this.pulseFeed.flight.gate} (${this.pulseFeed.flight.terminal})</span>
                </div>
                <div class="flight-detail-item">
                  <span class="flight-detail-label">Seat</span>
                  <span class="flight-detail-val">${this.pulseFeed.flight.seat}</span>
                </div>
                <div class="flight-detail-item" style="text-align: right;">
                  <span class="flight-detail-label">Boarding Status</span>
                  <span class="flight-detail-val" style="color:var(--accent-emerald);">Closes in ${this.pulseFeed.flight.minutesToClose}m</span>
                </div>
              </div>
            </div>

            <!-- Active Task Workspace Progress Card -->
            <div class="pulse-card pulse-task">
              <div class="task-header-row">
                <div class="task-title-group">
                  <span>⚙</span>
                  <span id="task-feed-title">${this.pulseFeed.task.title}</span>
                </div>
                <span id="task-feed-pct" class="task-pct-badge">${this.pulseFeed.task.progress}%</span>
              </div>
              <div class="task-progress-track">
                <div id="task-feed-fill" class="task-progress-fill" style="width: ${this.pulseFeed.task.progress}%;"></div>
              </div>
              <div class="task-footer-row">
                <span id="task-feed-stage">${this.pulseFeed.task.stage}</span>
                <span>${this.pulseFeed.task.latency} • ${this.pulseFeed.task.power}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom Dismiss Grip Bar -->
      <div class="shade-bottom-bar" id="shade-drag-bar">
        <div class="shade-drag-handle"></div>
        <div class="shade-drag-hint">
          <span>▲</span>
          <span>Slide Up to Close</span>
        </div>
      </div>
    `;

    this._bindDOMEvents();
    this.syncDOMState();
  }

  /**
   * Internal binding of card clicks, toggles, and slider interactions
   */
  _bindDOMEvents() {
    if (!this.container) return;

    // Close button
    const closeBtn = this.container.querySelector('#btn-shade-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.collapse();
    });

    // Hardware quick toggles click binding
    const toggleCards = this.container.querySelectorAll('.hw-toggle-card');
    toggleCards.forEach((card) => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const toggleId = card.getAttribute('data-toggle');
        if (toggleId) this.toggleHardware(toggleId);
      });
    });

    // Slider: Brightness
    const trackBrightWrap = this.container.querySelector('#track-brightness-wrap');
    if (trackBrightWrap) {
      const handleBrightDrag = (e) => {
        const rect = trackBrightWrap.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
        this.setBrightness(pct);
      };

      trackBrightWrap.addEventListener('pointerdown', (e) => {
        trackBrightWrap.setPointerCapture?.(e.pointerId);
        handleBrightDrag(e);
        const onMove = (mv) => handleBrightDrag(mv);
        const onUp = (up) => {
          trackBrightWrap.releasePointerCapture?.(up.pointerId);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }

    // Slider: Volume
    const trackVolWrap = this.container.querySelector('#track-volume-wrap');
    if (trackVolWrap) {
      const handleVolDrag = (e) => {
        const rect = trackVolWrap.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const pct = Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
        this.setVolume(pct);
      };

      trackVolWrap.addEventListener('pointerdown', (e) => {
        trackVolWrap.setPointerCapture?.(e.pointerId);
        handleVolDrag(e);
        const onMove = (mv) => handleVolDrag(mv);
        const onUp = (up) => {
          trackVolWrap.releasePointerCapture?.(up.pointerId);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }

    // Spotify Play/Pause toggle button
    const spotifyBtn = this.container.querySelector('#btn-spotify-toggle');
    spotifyBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSpotifyPlay();
    });
  }

  // ==========================================================================
  // Synchronize DOM UI with Internal State
  // ==========================================================================

  syncDOMState() {
    if (!this.container) return;

    // 1. Torch
    const torchCard = this.container.querySelector('#toggle-torch');
    const torchSub = this.container.querySelector('#sub-torch');
    if (torchCard) torchCard.classList.toggle('active', Boolean(this.toggles.torch));
    if (torchSub) torchSub.textContent = this.toggles.torch ? 'High-CRI ON' : 'Off';

    // Torch screen beam visual
    if (this.torchBeamContainer) {
      this.torchBeamContainer.classList.toggle('active', Boolean(this.toggles.torch));
    }

    // 2. Air-Gap
    const airgapCard = this.container.querySelector('#toggle-airgap');
    const airgapSub = this.container.querySelector('#sub-airgap');
    if (airgapCard) airgapCard.classList.toggle('active', Boolean(this.toggles.airgap));
    if (airgapSub) airgapSub.textContent = this.toggles.airgap ? '0.0V Rails' : 'Disengaged';

    // 3. Wi-Fi
    const wifiCard = this.container.querySelector('#toggle-wifi');
    const wifiSub = this.container.querySelector('#sub-wifi');
    if (wifiCard) wifiCard.classList.toggle('active', Boolean(this.toggles.wifi));
    if (wifiSub) wifiSub.textContent = this.toggles.wifi ? '6GHz Mesh' : 'Off';

    // 4. Power Profile
    const powerCard = this.container.querySelector('#toggle-power');
    const powerTitle = this.container.querySelector('#title-power');
    const powerSub = this.container.querySelector('#sub-power');
    if (powerCard) {
      powerCard.className = `hw-toggle-card profile-${this.toggles.power.toLowerCase()}`;
    }
    if (powerTitle) powerTitle.textContent = POWER_PROFILES[this.toggles.power].label;
    if (powerSub) powerSub.textContent = `${POWER_PROFILES[this.toggles.power].quantization} • ${POWER_PROFILES[this.toggles.power].powerDraw}`;

    // 5. Cellular
    const cellularCard = this.container.querySelector('#toggle-cellular');
    const cellularSub = this.container.querySelector('#sub-cellular');
    if (cellularCard) cellularCard.classList.toggle('active', Boolean(this.toggles.cellular));
    if (cellularSub) cellularSub.textContent = this.toggles.cellular ? 'mmWave Sub-6' : 'Modem Cut';

    // 6. Bluetooth
    const btCard = this.container.querySelector('#toggle-bluetooth');
    const btSub = this.container.querySelector('#sub-bluetooth');
    if (btCard) btCard.classList.toggle('active', Boolean(this.toggles.bluetooth));
    if (btSub) btSub.textContent = this.toggles.bluetooth ? 'LE Scanning' : 'Radio Cut';

    // 7. Rotation
    const rotCard = this.container.querySelector('#toggle-rotation');
    const rotSub = this.container.querySelector('#sub-rotation');
    if (rotCard) rotCard.classList.toggle('active', this.toggles.rotation === 'PORTRAIT');
    if (rotSub) rotSub.textContent = this.toggles.rotation;

    // 8. Privacy Kill
    const privCard = this.container.querySelector('#toggle-privacy');
    const privSub = this.container.querySelector('#sub-privacy');
    if (privCard) privCard.classList.toggle('active', Boolean(this.toggles.privacy));
    if (privSub) privSub.textContent = this.toggles.privacy ? 'Cam/Mic 0.0V' : 'Active';

    // Header summaries
    const statusSummary = this.container.querySelector('#shade-status-summary');
    if (statusSummary) {
      statusSummary.textContent = this.toggles.airgap ? 'HARDWARE AIR-GAP SECURED' : 'RADIOS CONNECTED';
    }

    const railPill = this.container.querySelector('#shade-rail-status-pill');
    if (railPill) {
      railPill.textContent = `RF: ${this.powerRails.rfRail.toFixed(1)}V • NPU: ${POWER_PROFILES[this.toggles.power].npuFreq}`;
    }

    // Sliders
    const fillBright = this.container.querySelector('#fill-brightness');
    const valBright = this.container.querySelector('#val-brightness');
    if (fillBright) fillBright.style.width = `${this.brightness}%`;
    if (valBright) valBright.textContent = `${this.brightness}%`;

    const fillVol = this.container.querySelector('#fill-volume');
    const valVol = this.container.querySelector('#val-volume');
    if (fillVol) fillVol.style.width = `${this.volume}%`;
    if (valVol) valVol.textContent = `${this.volume}%`;

    // Screen brightness filter overlay
    if (this.brightnessFilter) {
      // 100% brightness = 0 opacity filter; 0% brightness = 0.8 opacity filter
      const dimOpacity = Math.max(0, Math.min(0.85, (100 - this.brightness) / 100 * 0.85));
      this.brightnessFilter.style.opacity = dimOpacity;
    }
  }

  // ==========================================================================
  // Hardware Toggles Logic
  // ==========================================================================

  toggleHardware(toggleId) {
    try {
      haptics?.mediumSnap();
    } catch (_) {}

    switch (toggleId) {
      case ToggleId.TORCH: {
        this.toggles.torch = !this.toggles.torch;
        if (this.onTorchChange) this.onTorchChange(this.toggles.torch);
        break;
      }

      case ToggleId.AIRGAP: {
        this.setAirGap(!this.toggles.airgap);
        break;
      }

      case ToggleId.WIFI: {
        // If turning ON wifi while airgap is enabled, automatically disengage airgap
        if (!this.toggles.wifi && this.toggles.airgap) {
          this.setAirGap(false);
        }
        this.toggles.wifi = !this.toggles.wifi;
        this._recomputePowerRails();
        break;
      }

      case ToggleId.POWER: {
        // Cycle ECO -> BALANCED -> BOOST -> ECO
        if (this.toggles.power === PowerProfile.ECO) {
          this.toggles.power = PowerProfile.BALANCED;
        } else if (this.toggles.power === PowerProfile.BALANCED) {
          this.toggles.power = PowerProfile.BOOST;
        } else {
          this.toggles.power = PowerProfile.ECO;
        }
        if (this.onPowerProfileChange) {
          this.onPowerProfileChange(POWER_PROFILES[this.toggles.power]);
        }
        break;
      }

      case ToggleId.CELLULAR: {
        if (!this.toggles.cellular && this.toggles.airgap) {
          this.setAirGap(false);
        }
        this.toggles.cellular = !this.toggles.cellular;
        this._recomputePowerRails();
        break;
      }

      case ToggleId.BLUETOOTH: {
        if (!this.toggles.bluetooth && this.toggles.airgap) {
          this.setAirGap(false);
        }
        this.toggles.bluetooth = !this.toggles.bluetooth;
        this._recomputePowerRails();
        break;
      }

      case ToggleId.ROTATION: {
        this.toggles.rotation = this.toggles.rotation === 'PORTRAIT' ? 'AUTO' : 'PORTRAIT';
        break;
      }

      case ToggleId.PRIVACY: {
        this.toggles.privacy = !this.toggles.privacy;
        this._recomputePowerRails();
        break;
      }
    }

    if (this.onToggleChange) {
      this.onToggleChange(toggleId, this.toggles[toggleId]);
    }

    this.syncDOMState();
  }

  /**
   * Dedicated Air-Gap setter that ensures electronic power rails drop instantly to 0.0V
   */
  setAirGap(offline) {
    this.toggles.airgap = Boolean(offline);

    if (this.toggles.airgap) {
      // Instantly cut RF transceivers
      this.toggles.wifi = false;
      this.toggles.cellular = false;
      this.toggles.bluetooth = false;
    }

    this._recomputePowerRails();
    this.syncDOMState();

    if (this.onAirGapChange) {
      this.onAirGapChange(this.toggles.airgap);
    }
  }

  // ==========================================================================
  // Sliders Logic
  // ==========================================================================

  setBrightness(val) {
    const clamped = Math.min(100, Math.max(0, Math.round(val)));
    if (this.brightness === clamped) return;
    this.brightness = clamped;

    const fill = this.container?.querySelector('#fill-brightness');
    const valEl = this.container?.querySelector('#val-brightness');
    if (fill) fill.style.width = `${this.brightness}%`;
    if (valEl) valEl.textContent = `${this.brightness}%`;

    if (this.brightnessFilter) {
      const dimOpacity = Math.max(0, Math.min(0.85, (100 - this.brightness) / 100 * 0.85));
      this.brightnessFilter.style.opacity = dimOpacity;
    }

    if (this.onBrightnessChange) {
      this.onBrightnessChange(this.brightness);
    }
  }

  setVolume(val) {
    const clamped = Math.min(100, Math.max(0, Math.round(val)));
    if (this.volume === clamped) return;
    this.volume = clamped;

    const fill = this.container?.querySelector('#fill-volume');
    const valEl = this.container?.querySelector('#val-volume');
    const iconEl = this.container?.querySelector('#icon-volume');

    if (fill) fill.style.width = `${this.volume}%`;
    if (valEl) valEl.textContent = `${this.volume}%`;
    if (iconEl) {
      iconEl.textContent = this.volume === 0 ? '🔇' : (this.volume < 40 ? '🔉' : '🔊');
    }

    if (this.onVolumeChange) {
      this.onVolumeChange(this.volume);
    }
  }

  // ==========================================================================
  // Intelligent Pulse Feed Activities
  // ==========================================================================

  toggleSpotifyPlay() {
    this.pulseFeed.spotify.isPlaying = !this.pulseFeed.spotify.isPlaying;
    if (this.container) {
      const card = this.container.querySelector('#card-pulse-spotify');
      const btn = this.container.querySelector('#btn-spotify-toggle');
      if (card) {
        card.classList.toggle('paused', !this.pulseFeed.spotify.isPlaying);
      }
      if (btn) {
        btn.textContent = this.pulseFeed.spotify.isPlaying ? '⏸' : '▶';
      }
    }
    try {
      haptics?.lightTap();
    } catch (_) {}
  }

  setSpotifyProgress(sec) {
    this.pulseFeed.spotify.progressSec = Math.min(this.pulseFeed.spotify.durationSec, Math.max(0, sec));
    if (this.container) {
      const cur = this.container.querySelector('#spotify-cur-time');
      const fill = this.container.querySelector('#spotify-progress-fill');
      if (cur) cur.textContent = formatTime(this.pulseFeed.spotify.progressSec);
      if (fill) fill.style.width = `${(this.pulseFeed.spotify.progressSec / this.pulseFeed.spotify.durationSec) * 100}%`;
    }
  }

  updateTaskProgress(progress, stage = null) {
    this.pulseFeed.task.progress = Math.min(100, Math.max(0, Math.round(progress)));
    if (stage) this.pulseFeed.task.stage = stage;

    if (this.container) {
      const pctEl = this.container.querySelector('#task-feed-pct');
      const fillEl = this.container.querySelector('#task-feed-fill');
      const stageEl = this.container.querySelector('#task-feed-stage');
      if (pctEl) pctEl.textContent = `${this.pulseFeed.task.progress}%`;
      if (fillEl) fillEl.style.width = `${this.pulseFeed.task.progress}%`;
      if (stageEl && stage) stageEl.textContent = stage;
    }
  }

  // ==========================================================================
  // Shade State Machine & Spring Physics
  // ==========================================================================

  expand() {
    if (this.state === ShadeState.EXPANDED) return;
    this.state = ShadeState.EXPANDED;

    if (this.container) {
      this.container.classList.remove('collapsed', 'sliding');
      this.container.classList.add('expanded');
      this.container.style.transform = 'translateY(0%)';
    }

    if (this.backdrop) {
      this.backdrop.classList.add('active');
    }

    if (this.onStateChange) this.onStateChange(this.state);
    try {
      haptics?.mediumSnap();
    } catch (_) {}
  }

  collapse() {
    if (this.state === ShadeState.COLLAPSED) return;
    this.state = ShadeState.COLLAPSED;

    if (this.container) {
      this.container.classList.remove('expanded', 'sliding');
      this.container.classList.add('collapsed');
      this.container.style.transform = 'translateY(-100%)';
    }

    if (this.backdrop) {
      this.backdrop.classList.remove('active');
    }

    if (this.onStateChange) this.onStateChange(this.state);
    try {
      haptics?.lightTap();
    } catch (_) {}
  }

  toggle() {
    if (this.state === ShadeState.EXPANDED) {
      this.collapse();
    } else {
      this.expand();
    }
  }

  // ==========================================================================
  // Gestures & Keyboard
  // ==========================================================================

  bindGestures() {
    if (!this.container) return;

    // Pull-down tab trigger (if passed)
    if (this.pullTrigger) {
      this.pullTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }

    // Backdrop tap closes shade
    if (this.backdrop) {
      this.backdrop.addEventListener('click', () => {
        this.collapse();
      });
    }

    // Bottom drag bar gestures (slide up to dismiss)
    const dragBar = this.container.querySelector('#shade-drag-bar');
    if (dragBar) {
      const onPointerDown = (e) => {
        this.isDragging = true;
        this.startY = e.clientY;
        this.currentY = e.clientY;
        this.velocityTracker.reset(this.startY, performance?.now() || Date.now());
        dragBar.setPointerCapture?.(e.pointerId);
        this.container.classList.add('sliding');
      };

      const onPointerMove = (e) => {
        if (!this.isDragging) return;
        this.currentY = e.clientY;
        this.velocityTracker.addSample(this.currentY, performance?.now() || Date.now());

        const deltaY = this.currentY - this.startY;
        // If dragging upwards (deltaY < 0), slide shade upwards
        if (deltaY < 0) {
          this.container.style.transform = `translateY(${deltaY}px)`;
        } else {
          // Downward drag overscroll with rubber band resistance
          const clamped = rubberBandClamp(deltaY, 200);
          this.container.style.transform = `translateY(${clamped}px)`;
        }
      };

      const onPointerUp = (e) => {
        if (!this.isDragging) return;
        this.isDragging = false;
        dragBar.releasePointerCapture?.(e.pointerId);
        this.container.classList.remove('sliding');

        const deltaY = this.currentY - this.startY;
        const velocity = this.velocityTracker.getVelocity();

        // Dismiss condition: dragged upwards > 80px or fling velocity < -400px/s
        if (deltaY < -80 || velocity < -400) {
          this.collapse();
        } else {
          this.expand();
        }
      };

      dragBar.addEventListener('pointerdown', onPointerDown);
      dragBar.addEventListener('pointermove', onPointerMove);
      dragBar.addEventListener('pointerup', onPointerUp);
      dragBar.addEventListener('pointercancel', onPointerUp);
    }
  }

  bindKeyboard() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state === ShadeState.EXPANDED) {
        this.collapse();
      }
    });
  }
}

// Window global registration
if (typeof window !== 'undefined') {
  window.PravahShade = {
    ShadeState,
    PowerProfile,
    POWER_PROFILES,
    ToggleId,
    DEFAULT_TOGGLES,
    DEFAULT_POWER_RAILS,
    DEFAULT_PULSE_FEED,
    formatTime,
    ControlCenterShade
  };
}
