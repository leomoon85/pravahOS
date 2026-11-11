// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file android_bridge.js
 * PravahOS Emulator Android App Compatibility Bridge & Interactive Runner.
 *
 * Provides:
 * 1. Starnix Linux ABI Syscall Translator & Binder IPC Virtualizer for the Emulator.
 * 2. Simulated Android App Container executing WhatsApp, Spotify, Google Maps, and Uber.
 * 3. In-Phone Window Frame rendering for active Android applications.
 * 4. Real-time Capability Delegation:
 *    - Spotify streams PCM audio chunks into the PravahOS Audio HAL visualizer.
 *    - WhatsApp acquires camera VMO frames through the Policy Gate & camera viewfinder.
 *    - Maps accesses local GNSS sensor telemetry.
 *    - Uber triggers the Policy Gate modal for irreversible payment authorization.
 * 5. Live Binder IPC event stream and telemetry HUD.
 */

// ============================================================================
// 1. Constants & Protocol Enums
// ============================================================================

const AndroidAppId = {
  WHATSAPP: 'com.whatsapp',
  SPOTIFY: 'com.spotify.music',
  MAPS: 'com.google.android.apps.maps',
  UBER: 'com.ubercab'
};

const AndroidAppState = {
  NOT_RUNNING: 'NOT_RUNNING',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED'
};

const EmulatorAndroidApps = {
  [AndroidAppId.WHATSAPP]: {
    id: AndroidAppId.WHATSAPP,
    name: 'WhatsApp Messenger',
    shortName: 'WhatsApp',
    category: 'Communication',
    version: '2.24.12.78',
    icon: '💬',
    accent: '#25D366',
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.READ_CONTACTS'],
    gatedCapabilities: ['hardware.camera.vmo', 'hardware.audio.mic'],
    description: 'Encrypted messaging & HD video calls running in Starnix userspace container.'
  },
  [AndroidAppId.SPOTIFY]: {
    id: AndroidAppId.SPOTIFY,
    name: 'Spotify: Music & Podcasts',
    shortName: 'Spotify',
    category: 'Audio Streaming',
    version: '8.9.20.574',
    icon: '🎵',
    accent: '#1DB954',
    permissions: ['android.permission.MEDIA_CONTENT_CONTROL', 'android.permission.FOREGROUND_SERVICE'],
    gatedCapabilities: ['hardware.audio.pcm'],
    description: 'Lossless audio streaming delegated directly to PravahOS 48kHz Audio HAL ring buffer.'
  },
  [AndroidAppId.MAPS]: {
    id: AndroidAppId.MAPS,
    name: 'Google Maps Navigation',
    shortName: 'Maps',
    category: 'Travel & Navigation',
    version: '11.108.0101',
    icon: '🗺',
    accent: '#4285F4',
    permissions: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'],
    gatedCapabilities: ['hardware.location.gnss'],
    description: 'Air-gapped offline vector mapping mediated via PravahOS GNSS capability handle.'
  },
  [AndroidAppId.UBER]: {
    id: AndroidAppId.UBER,
    name: 'Uber: Request a Ride',
    shortName: 'Uber',
    category: 'Rideshare & Payment',
    version: '4.512.10001',
    icon: '🚗',
    accent: '#111827',
    permissions: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.PAYMENT'],
    gatedCapabilities: ['hardware.location.gnss', 'financial.payment.uber_fare'],
    description: 'Mobility platform with deterministic Policy Gate gatekeeper for irreversible fare checkout.'
  }
};

// ============================================================================
// 2. Emulator Android Bridge Controller
// ============================================================================

class EmulatorAndroidBridge {
  constructor(emulatorApp, sensoryBridge = null) {
    this.emulatorApp = emulatorApp;
    this.sensoryBridge = sensoryBridge;
    this.activeAppId = null;
    this.appStates = {
      [AndroidAppId.WHATSAPP]: AndroidAppState.NOT_RUNNING,
      [AndroidAppId.SPOTIFY]: AndroidAppState.NOT_RUNNING,
      [AndroidAppId.MAPS]: AndroidAppState.NOT_RUNNING,
      [AndroidAppId.UBER]: AndroidAppState.NOT_RUNNING
    };

    // Simulated Binder IPC & Syscall ring logs
    this.ipcLogs = [];
    this.maxLogs = 80;

    // Spotify playback state
    this.spotifyAudioTimer = null;
    this.spotifyTrack = {
      title: 'Midnight City (Pravah Acoustic Remix)',
      artist: 'M83 / Pravah Soundworks',
      album: 'Hurry Up, We\'re Dreaming',
      duration: '4:03',
      currentSec: 42,
      isPlaying: false
    };

    // WhatsApp video call state
    this.whatsAppCallState = {
      active: false,
      contact: 'Pravah Core Architect (Dr. A. Sen)',
      cameraActive: false,
      cameraVmo: null
    };

    // Uber state
    this.uberState = {
      origin: 'Connaught Place, New Delhi',
      destination: 'Indira Gandhi International T3',
      fare: '₹420',
      status: 'IDLE' // IDLE | BOOKING | AWAITING_APPROVAL | CONFIRMED
    };

    this.containerMetrics = {
      containerUptimeSec: 0,
      totalSyscalls: 0,
      totalBinderParcels: 0,
      activeHandles: 0
    };

    this.startMetricsTicker();
  }

  startMetricsTicker() {
    if (typeof setInterval !== 'undefined') {
      this.metricsTimer = setInterval(() => {
        if (this.activeAppId) {
          this.containerMetrics.containerUptimeSec += 1;
        }
      }, 1000);
      if (this.metricsTimer && typeof this.metricsTimer.unref === 'function') {
        this.metricsTimer.unref();
      }
    }
  }

  logIPC(type, app, summary, details = {}) {
    const entry = {
      id: `ipc_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toLocaleTimeString(),
      type, // 'SYSCALL' | 'BINDER_TX' | 'POLICY_GATE' | 'HAL_DELEGATE'
      app,
      summary,
      details
    };

    this.ipcLogs.unshift(entry);
    if (this.ipcLogs.length > this.maxLogs) {
      this.ipcLogs.pop();
    }

    this.containerMetrics.totalBinderParcels += 1;
    if (typeof document !== 'undefined') {
      this.renderIpcStream();
    }
  }

  /**
   * Launches an Android application inside the simulated window frame.
   */
  launchApp(appId) {
    const app = EmulatorAndroidApps[appId];
    if (!app) return false;

    this.activeAppId = appId;
    this.appStates[appId] = AndroidAppState.RUNNING;

    this.logIPC('SYSCALL', app.shortName, `sys_openat(-100, "/dev/binder", O_RDWR) -> fd=104`);
    this.logIPC('SYSCALL', app.shortName, `sys_mmap(0x6000000000, 1MB, PROT_READ|PROT_MAP, MAP_SHARED, fd=104)`);
    this.logIPC('BINDER_TX', app.shortName, `BC_TRANSACTION -> servicemanager:checkService("activity")`);
    this.logIPC('BINDER_TX', app.shortName, `BR_REPLY -> android.app.IActivityManager::attachApplication()`);

    // Render the in-phone Android app window frame
    if (typeof document !== 'undefined') {
      this.renderAppWindow(appId);
      this.updateLauncherUI();
    }
    return true;
  }

  /**
   * Closes the active Android application.
   */
  closeActiveApp() {
    if (!this.activeAppId) return;
    const app = EmulatorAndroidApps[this.activeAppId];
    const shortName = app ? app.shortName : this.activeAppId;

    this.logIPC('BINDER_TX', shortName, `BC_TRANSACTION -> IActivityManager::finishActivity()`);
    this.logIPC('SYSCALL', shortName, `sys_close(fd=104) -> Binder endpoints detached`);

    if (this.activeAppId === AndroidAppId.SPOTIFY) {
      this.stopSpotifyPlayback();
    }

    if (this.activeAppId === AndroidAppId.WHATSAPP) {
      this.whatsAppCallState.active = false;
      this.whatsAppCallState.cameraActive = false;
    }

    this.appStates[this.activeAppId] = AndroidAppState.STOPPED;
    this.activeAppId = null;

    if (typeof document !== 'undefined') {
      const frame = document.getElementById('android-window-frame');
      if (frame) {
        frame.style.display = 'none';
        frame.innerHTML = '';
      }
      this.updateLauncherUI();
    }
  }

  // ==========================================================================
  // Spotify Integration: Audio PCM HAL Streaming
  // ==========================================================================

  toggleSpotifyPlayback() {
    if (this.spotifyTrack.isPlaying) {
      this.stopSpotifyPlayback();
    } else {
      this.startSpotifyPlayback();
    }
    this.renderSpotifyApp();
  }

  startSpotifyPlayback() {
    this.spotifyTrack.isPlaying = true;
    this.logIPC('BINDER_TX', 'Spotify', `BC_TRANSACTION -> android.media.IAudioFlinger::createTrack(48000Hz, STEREO, PCM_16BIT)`);
    this.logIPC('HAL_DELEGATE', 'Spotify', `PravahOS Audio HAL: Allocated zero-copy ring buffer VMO (zx_vmo_audio_48k)`);

    // If Sensory Bridge is available, activate its playback tone / oscillator
    if (this.sensoryBridge && this.sensoryBridge.audioVisualizer) {
      this.sensoryBridge.audioVisualizer.setMode('PLAYBACK');
    }

    if (this.spotifyAudioTimer) clearInterval(this.spotifyAudioTimer);
    this.spotifyAudioTimer = setInterval(() => {
      if (!this.spotifyTrack.isPlaying) return;
      this.spotifyTrack.currentSec += 1;
      this.logIPC('HAL_DELEGATE', 'Spotify', `writePcmData(512 frames, RMS=-16.4 dBFS) -> Audio HAL`);
      this.renderSpotifyTime();
    }, 2000);
    if (this.spotifyAudioTimer && typeof this.spotifyAudioTimer.unref === 'function') {
      this.spotifyAudioTimer.unref();
    }
  }

  stopSpotifyPlayback() {
    this.spotifyTrack.isPlaying = false;
    if (this.spotifyAudioTimer) {
      clearInterval(this.spotifyAudioTimer);
      this.spotifyAudioTimer = null;
    }
    this.logIPC('BINDER_TX', 'Spotify', `BC_TRANSACTION -> IAudioTrack::pause()`);
    if (this.sensoryBridge && this.sensoryBridge.audioVisualizer) {
      this.sensoryBridge.audioVisualizer.setMode('IDLE');
    }
  }

  // ==========================================================================
  // WhatsApp Integration: Camera VMO Delegation via Policy Gate
  // ==========================================================================

  requestWhatsAppComponent(action = 'open_camera') {
    if (action === 'open_camera') {
      this.logIPC('BINDER_TX', 'WhatsApp', `BC_TRANSACTION -> android.hardware.camera2::openCamera(id=0)`);
      this.logIPC('POLICY_GATE', 'WhatsApp', `PolicyGate::evaluate("starnix://com.whatsapp", "hardware.camera.vmo", RiskLevel.CONSEQUENTIAL)`);

      // Check current authority in Shell
      this.logIPC('POLICY_GATE', 'WhatsApp', `PolicyGate Decision: ALLOW (Authority: EXECUTE) -> VMO granted`);
      this.whatsAppCallState.active = true;
      this.whatsAppCallState.cameraActive = true;
      this.whatsAppCallState.cameraVmo = `zx_vmo_cam_1080p_${Date.now()}`;

      this.logIPC('HAL_DELEGATE', 'WhatsApp', `Delegated Camera Frame VMO (${this.whatsAppCallState.cameraVmo}, 1920x1080 ARGB)`);

      // Trigger emulator camera feed if available
      if (this.sensoryBridge && this.sensoryBridge.cameraViewfinder) {
        this.sensoryBridge.cameraViewfinder.start();
      }

      this.renderWhatsAppApp();
    } else if (action === 'snap_photo') {
      this.logIPC('BINDER_TX', 'WhatsApp', `BC_TRANSACTION -> ICameraCaptureSession::capture()`);
      this.logIPC('HAL_DELEGATE', 'WhatsApp', `Captured photo buffer via PravahOS IMX890 HAL`);
      if (typeof alert !== 'undefined') {
        alert('📷 Photo captured via PravahOS Camera HAL and attached to WhatsApp chat!');
      }
    }
  }

  // ==========================================================================
  // Google Maps Integration: Local GNSS Sensor
  // ==========================================================================

  requestMapsLocation() {
    this.logIPC('BINDER_TX', 'Maps', `BC_TRANSACTION -> android.location.ILocationManager::requestLocationUpdates()`);
    this.logIPC('POLICY_GATE', 'Maps', `PolicyGate::evaluate("starnix://com.google.android.apps.maps", "hardware.location.gnss") -> ALLOW`);
    this.logIPC('HAL_DELEGATE', 'Maps', `Returned local GNSS sensor VMO (Lat: 28.6139° N, Lon: 77.2090° E, Alt: 216m)`);
    this.renderMapsApp();
  }

  // ==========================================================================
  // Uber Integration: Ride Booking with Policy Gate Intercept
  // ==========================================================================

  bookUberRide() {
    this.logIPC('BINDER_TX', 'Uber', `BC_TRANSACTION -> android.location.ILocationManager::getLastKnownLocation()`);
    this.logIPC('BINDER_TX', 'Uber', `BC_TRANSACTION -> com.ubercab.payment::chargeFare(amount=₹420)`);
    this.logIPC('POLICY_GATE', 'Uber', `PolicyGate::evaluate("financial.payment.uber_fare", RiskLevel.IRREVERSIBLE)`);
    this.logIPC('POLICY_GATE', 'Uber', `🚨 MANDATORY CONFIRMATION: Irreversible transaction requires user approval!`);

    // Post message to the shell frame if available to trigger the Policy Gate modal
    if (typeof document !== 'undefined') {
      const shellIframe = document.getElementById('shell-frame');
      if (shellIframe && shellIframe.contentWindow) {
        shellIframe.contentWindow.postMessage({
          type: 'PRAVAH_TRIGGER_SCENARIO',
          scenario: 'payment'
        }, '*');
      }
    }

    this.uberState.status = 'AWAITING_APPROVAL';
    this.renderUberApp();
  }

  confirmUberRide() {
    this.uberState.status = 'CONFIRMED';
    this.logIPC('POLICY_GATE', 'Uber', `✔ USER APPROVED: Cryptographic token issued. ₹420 committed.`);
    this.logIPC('BINDER_TX', 'Uber', `BR_REPLY -> Ride booked: Driver Rajiv (Swift Dzire - DL 01 AB 9821) arriving in 3 mins`);
    this.renderUberApp();
  }

  // ==========================================================================
  // In-Phone App Viewport Window Rendering
  // ==========================================================================

  renderAppWindow(appId) {
    if (typeof document === 'undefined') return;
    let frame = document.getElementById('android-window-frame');
    if (!frame) {
      const viewport = document.getElementById('phone-viewport');
      if (!viewport) return;
      frame = document.createElement('div');
      frame.id = 'android-window-frame';
      frame.className = 'android-window-frame';
      viewport.appendChild(frame);
    }

    frame.style.display = 'flex';
    frame.innerHTML = `
      <!-- Android Title Bar -->
      <div class="android-window-header" style="background: ${EmulatorAndroidApps[appId].accent};">
        <div class="app-info-left">
          <span class="app-icon">${EmulatorAndroidApps[appId].icon}</span>
          <div class="app-names">
            <span class="app-title">${EmulatorAndroidApps[appId].shortName}</span>
            <span class="app-pkg">${appId} • STARNIX CFv2 REALM</span>
          </div>
        </div>
        <div class="app-actions-right">
          <button id="btn-close-android-app" class="btn-win-action" title="Terminate Android App Container">✕</button>
        </div>
      </div>

      <!-- App Content Surface -->
      <div id="android-window-content" class="android-window-content">
        <!-- Rendered by specific app renderer -->
      </div>

      <!-- Android Container Navigation Pill -->
      <div class="android-nav-bar">
        <button id="btn-android-nav-back" class="nav-btn">◀</button>
        <button id="btn-android-nav-home" class="nav-btn">●</button>
        <button id="btn-android-nav-recents" class="nav-btn">■</button>
      </div>
    `;

    document.getElementById('btn-close-android-app')?.addEventListener('click', () => this.closeActiveApp());
    document.getElementById('btn-android-nav-home')?.addEventListener('click', () => this.closeActiveApp());
    document.getElementById('btn-android-nav-back')?.addEventListener('click', () => this.closeActiveApp());

    switch (appId) {
      case AndroidAppId.WHATSAPP:
        this.renderWhatsAppApp();
        break;
      case AndroidAppId.SPOTIFY:
        this.renderSpotifyApp();
        break;
      case AndroidAppId.MAPS:
        this.renderMapsApp();
        break;
      case AndroidAppId.UBER:
        this.renderUberApp();
        break;
    }
  }

  renderWhatsAppApp() {
    if (typeof document === 'undefined') return;
    const content = document.getElementById('android-window-content');
    if (!content) return;

    content.innerHTML = `
      <div class="whatsapp-view">
        <div class="wa-top-bar">
          <div class="wa-avatar">AS</div>
          <div class="wa-contact-info">
            <div class="wa-name">${this.whatsAppCallState.contact}</div>
            <div class="wa-status">${this.whatsAppCallState.active ? '🟢 In Video Call • 1080p60 VMO' : 'Online • Starnix Client'}</div>
          </div>
          <div class="wa-actions">
            <button id="btn-wa-call" class="wa-btn-icon" title="Start Video Call">📹</button>
            <button id="btn-wa-cam" class="wa-btn-icon" title="Attach Camera Photo">📷</button>
          </div>
        </div>

        <div class="wa-body">
          ${this.whatsAppCallState.active ? `
            <div class="wa-video-call-box">
              <div class="wa-video-overlay-tag">PRAVAHOS CAMERA HAL VMO</div>
              <div class="wa-video-stream-sim">
                <div class="wa-call-pulse"></div>
                <span>LIVE CAMERA FEED (Sony IMX890 50MP)</span>
                <span style="font-size:0.65rem; color:#86efac; font-family:monospace;">${this.whatsAppCallState.cameraVmo}</span>
              </div>
              <div class="wa-call-controls">
                <button id="btn-wa-snap" class="wa-call-btn">📷 Snap Frame</button>
                <button id="btn-wa-end-call" class="wa-call-btn danger">End Call</button>
              </div>
            </div>
          ` : `
            <div class="wa-chat-bubble incoming">
              Hey! Did the PravahOS microkernel handoff complete successfully?
              <span class="wa-time">10:42 AM</span>
            </div>
            <div class="wa-chat-bubble outgoing">
              Yes, Starnix container running smoothly. Android Binder IPC mapped to Zircon channels! 🚀
              <span class="wa-time">10:43 AM</span>
            </div>
            <div class="wa-chat-bubble incoming">
              Great! Can you test the camera capability delegation through Policy Gate?
              <span class="wa-time">10:44 AM</span>
            </div>
          `}
        </div>

        <div class="wa-input-row">
          <input type="text" class="wa-input" placeholder="Type a message..." value="Ready for video verification test">
          <button id="btn-wa-send" class="wa-send-btn">➤</button>
        </div>
      </div>
    `;

    document.getElementById('btn-wa-call')?.addEventListener('click', () => this.requestWhatsAppComponent('open_camera'));
    document.getElementById('btn-wa-cam')?.addEventListener('click', () => this.requestWhatsAppComponent('open_camera'));
    document.getElementById('btn-wa-snap')?.addEventListener('click', () => this.requestWhatsAppComponent('snap_photo'));
    document.getElementById('btn-wa-end-call')?.addEventListener('click', () => {
      this.whatsAppCallState.active = false;
      this.whatsAppCallState.cameraActive = false;
      this.renderWhatsAppApp();
    });
  }

  renderSpotifyApp() {
    if (typeof document === 'undefined') return;
    const content = document.getElementById('android-window-content');
    if (!content) return;

    content.innerHTML = `
      <div class="spotify-view">
        <div class="sp-album-art">
          <div class="sp-art-gradient">
            <span style="font-size: 3rem;">⚡</span>
          </div>
          <div class="sp-hal-pill">AUDIO HAL • 48kHz PCM</div>
        </div>

        <div class="sp-meta-wrap">
          <div class="sp-track-title">${this.spotifyTrack.title}</div>
          <div class="sp-track-artist">${this.spotifyTrack.artist}</div>
          <div class="sp-album-name">${this.spotifyTrack.album}</div>
        </div>

        <div class="sp-scrubber-wrap">
          <div class="sp-track-bar">
            <div id="sp-track-progress" class="sp-track-progress" style="width: ${(this.spotifyTrack.currentSec / 243) * 100}%;"></div>
          </div>
          <div class="sp-time-row">
            <span id="sp-cur-time">${Math.floor(this.spotifyTrack.currentSec / 60)}:${(this.spotifyTrack.currentSec % 60).toString().padStart(2, '0')}</span>
            <span>${this.spotifyTrack.duration}</span>
          </div>
        </div>

        <div class="sp-controls-row">
          <button class="sp-ctrl-btn">⏮</button>
          <button id="btn-sp-play-toggle" class="sp-play-btn ${this.spotifyTrack.isPlaying ? 'playing' : ''}">
            ${this.spotifyTrack.isPlaying ? '⏸' : '▶'}
          </button>
          <button class="sp-ctrl-btn">⏭</button>
        </div>

        <div class="sp-hal-stream-info">
          <div class="sp-info-row">
            <span>Audio Pipeline:</span>
            <strong>PravahOS Audio HAL Ring Buffer</strong>
          </div>
          <div class="sp-info-row">
            <span>Format & Rate:</span>
            <strong>16-bit Stereo PCM @ 48,000 Hz</strong>
          </div>
          <div class="sp-info-row">
            <span>Security Sandbox:</span>
            <strong style="color:#86efac;">Policy Gate Cleared</strong>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-sp-play-toggle')?.addEventListener('click', () => this.toggleSpotifyPlayback());
  }

  renderSpotifyTime() {
    if (typeof document === 'undefined') return;
    const curTime = document.getElementById('sp-cur-time');
    const bar = document.getElementById('sp-track-progress');
    if (curTime && bar) {
      curTime.textContent = `${Math.floor(this.spotifyTrack.currentSec / 60)}:${(this.spotifyTrack.currentSec % 60).toString().padStart(2, '0')}`;
      bar.style.width = `${(this.spotifyTrack.currentSec / 243) * 100}%`;
    }
  }

  renderMapsApp() {
    if (typeof document === 'undefined') return;
    const content = document.getElementById('android-window-content');
    if (!content) return;

    content.innerHTML = `
      <div class="maps-view">
        <div class="maps-search-bar">
          <span style="font-size:0.9rem;">🔍</span>
          <input type="text" class="maps-input" value="Connaught Place, New Delhi" readonly>
          <button id="btn-maps-locate" class="maps-locate-btn" title="Acquire Local GNSS Position">📍</button>
        </div>

        <div class="maps-canvas-mock">
          <div class="map-grid-pattern"></div>
          <div class="map-route-line"></div>
          <div class="map-pin-pulse">
            <div class="pin-dot"></div>
            <div class="pin-wave"></div>
          </div>
          <div class="map-label-card">
            <span style="font-weight:700;">New Delhi (Connaught Place)</span>
            <span style="font-size:0.65rem; color:#94a3b8; font-family:monospace;">GNSS 28.6139° N • 77.2090° E (Alt: 216m)</span>
          </div>
        </div>

        <div class="maps-bottom-panel">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-weight:700; font-size:0.85rem;">Local Vector Map Rendered</div>
              <div style="font-size:0.7rem; color:#94a3b8;">Offline Vector Tiles • Zero Cloud Telemetry</div>
            </div>
            <button id="btn-maps-refresh-gnss" class="maps-action-btn">Acquire GNSS</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-maps-locate')?.addEventListener('click', () => this.requestMapsLocation());
    document.getElementById('btn-maps-refresh-gnss')?.addEventListener('click', () => this.requestMapsLocation());
  }

  renderUberApp() {
    if (typeof document === 'undefined') return;
    const content = document.getElementById('android-window-content');
    if (!content) return;

    content.innerHTML = `
      <div class="uber-view">
        <div class="uber-header">
          <span style="font-size:1.1rem; font-weight:800;">Uber Premier</span>
          <span class="uber-badge">STARNIX SANDBOX</span>
        </div>

        <div class="uber-route-card">
          <div class="uber-route-point">
            <span class="route-icon green">●</span>
            <div>
              <div class="route-label">PICKUP</div>
              <div class="route-val">${this.uberState.origin}</div>
            </div>
          </div>
          <div class="uber-route-line"></div>
          <div class="uber-route-point">
            <span class="route-icon red">■</span>
            <div>
              <div class="route-label">DROPOFF</div>
              <div class="route-val">${this.uberState.destination}</div>
            </div>
          </div>
        </div>

        <div class="uber-fare-box">
          <div>
            <div style="font-size:0.7rem; color:#94a3b8; text-transform:uppercase;">Estimated Fare</div>
            <div style="font-size:1.3rem; font-weight:800; color:#fff;">${this.uberState.fare}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:0.7rem; color:#94a3b8;">RISK LEVEL</div>
            <div style="font-size:0.75rem; font-weight:700; color:var(--accent-danger, #ff1744);">IRREVERSIBLE (L3)</div>
          </div>
        </div>

        ${this.uberState.status === 'CONFIRMED' ? `
          <div class="uber-confirmed-card">
            <div style="font-size:1.2rem;">🚗 Ride Confirmed!</div>
            <div style="font-size:0.75rem; color:#94a3b8; margin-top:4px;">
              Driver Rajiv (Swift Dzire • DL 01 AB 9821) is arriving in 3 mins.
            </div>
            <div style="font-size:0.65rem; color:#86efac; font-family:monospace; margin-top:6px;">
              POLICY AUDIT TOKEN: 0x9f1a4e8c (SEALED)
            </div>
          </div>
        ` : `
          <div class="uber-actions">
            <button id="btn-uber-book" class="uber-book-btn">
              ${this.uberState.status === 'AWAITING_APPROVAL' ? '⏳ Awaiting Policy Gate Approval...' : 'Confirm & Request Ride'}
            </button>
            ${this.uberState.status === 'AWAITING_APPROVAL' ? `
              <button id="btn-uber-sim-approve" class="uber-approve-btn">
                ✔ Simulate User Approval in Shell
              </button>
            ` : ''}
          </div>
        `}

        <div class="uber-policy-notice">
          ⚠ Financial remittance triggers PravahOS Policy Gate. Neural AI has zero authority to auto-commit payment.
        </div>
      </div>
    `;

    document.getElementById('btn-uber-book')?.addEventListener('click', () => this.bookUberRide());
    document.getElementById('btn-uber-sim-approve')?.addEventListener('click', () => this.confirmUberRide());
  }

  // ==========================================================================
  // Sidebar Android App Runner & IPC Log Stream UI
  // ==========================================================================

  updateLauncherUI() {
    if (typeof document === 'undefined') return;
    Object.keys(EmulatorAndroidApps).forEach(appId => {
      const chip = document.getElementById(`android-chip-${appId}`);
      if (chip) {
        if (this.activeAppId === appId) {
          chip.classList.add('running');
        } else {
          chip.classList.remove('running');
        }
      }
    });

    const activeAppBadge = document.getElementById('val-android-active-app');
    if (activeAppBadge) {
      if (this.activeAppId) {
        activeAppBadge.textContent = EmulatorAndroidApps[this.activeAppId].shortName;
        activeAppBadge.className = 'status-chip nominal';
      } else {
        activeAppBadge.textContent = 'STANDBY';
        activeAppBadge.className = 'status-chip';
      }
    }
  }

  renderIpcStream() {
    if (typeof document === 'undefined') return;
    const list = document.getElementById('android-ipc-log-list');
    if (!list) return;

    list.innerHTML = this.ipcLogs.slice(0, 25).map(entry => {
      let tagClass = 'tag-binder';
      if (entry.type === 'SYSCALL') tagClass = 'tag-syscall';
      if (entry.type === 'POLICY_GATE') tagClass = 'tag-policy';
      if (entry.type === 'HAL_DELEGATE') tagClass = 'tag-hal';

      return `
        <div class="ipc-entry">
          <div class="ipc-entry-head">
            <span class="ipc-time">${entry.timestamp}</span>
            <span class="ipc-tag ${tagClass}">${entry.type}</span>
            <span class="ipc-app">${entry.app}</span>
          </div>
          <div class="ipc-summary">${entry.summary}</div>
        </div>
      `;
    }).join('');
  }
}

// ============================================================================
// 3. Module Exports (CommonJS for Node.js test runner & Global for Browser)
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AndroidAppId,
    AndroidAppState,
    EmulatorAndroidApps,
    EmulatorAndroidBridge
  };
}

if (typeof window !== 'undefined') {
  window.EmulatorAndroidBridge = EmulatorAndroidBridge;
  window.EmulatorAndroidApps = EmulatorAndroidApps;
  window.AndroidAppId = AndroidAppId;
  window.AndroidAppState = AndroidAppState;
}
