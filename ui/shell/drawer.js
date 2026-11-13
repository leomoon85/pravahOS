// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file drawer.js
 * Living App Drawer & Metro UI Subsystem for PravahOS.
 *
 * Implements:
 * 1. Dual-Surface Navigation: Smooth vertical swipe-up gesture & bottom nav pill toggle.
 * 2. Top Section: Glanceable Live Tiles with 3D flipping/morphing animations:
 *    - Active Spotify playback with live equalizer (EQ) bars.
 *    - Flight AI-202 gate countdown & boarding telemetry.
 *    - Battery/Power fuel gauge with neural power consumption.
 *    - Weather & Hardware Air-Gap cryptographic status card.
 * 3. Bottom Section: Windows Phone / Metro-style Alphabetical A-Z List:
 *    - Fast-jump letter headers ([A], [C], [M], [N], [S], [U], [W]).
 *    - Metro Alphabet Jump Grid picker (A-Z quick tile selector).
 *    - Instant reactive search filtering bar.
 * 4. Dual Launch Model:
 *    - Native PravahOS DAG card execution in active workspace.
 *    - Ephemeral zero-tax overlay window with low-overhead lifecycle.
 */

import { haptics } from '../motion/haptics.js';
import { Spring, SpringPresets, VelocityTracker, rubberBandClamp } from '../motion/spring.js';

export const DrawerState = {
  COLLAPSED: 'COLLAPSED',
  SLIDING: 'SLIDING',
  EXPANDED: 'EXPANDED'
};

export const TileId = {
  SPOTIFY: 'spotify',
  FLIGHT: 'flight',
  BATTERY: 'battery',
  AIRGAP: 'airgap'
};

/**
 * Default Live Tile data definitions with front & back faces for 3D flip animations.
 */
export const DEFAULT_LIVE_TILES = {
  [TileId.SPOTIFY]: {
    id: TileId.SPOTIFY,
    title: 'Spotify Audio HAL',
    category: 'Media & Streaming',
    accent: '#1db954',
    flipped: false,
    front: {
      track: 'Midnight City',
      artist: 'M83 • Hurry Up, We\'re Dreaming',
      isPlaying: true,
      progressSec: 142,
      durationSec: 244,
      eqBars: [0.65, 0.90, 0.45, 0.82, 0.60]
    },
    back: {
      codec: 'ALAC Lossless 24-bit / 48kHz',
      sink: 'Pravah Direct DMA HAL',
      latency: '0.8 ms (Zero Jitter)',
      bufferHealth: '100% Locked'
    }
  },
  [TileId.FLIGHT]: {
    id: TileId.FLIGHT,
    title: 'Flight AI-202',
    category: 'Travel & Radar',
    accent: '#00e5ff',
    flipped: false,
    front: {
      flightNum: 'AI-202',
      route: 'DEL ➔ BLR',
      gate: '14B',
      terminal: 'T3',
      status: 'BOARDING',
      countdownSec: 2535, // ~42m 15s
      seat: '12A'
    },
    back: {
      aircraft: 'Airbus A350-900',
      destWeather: 'BLR: 24°C • Fair',
      baggageClaim: 'Belt 04',
      onTimeRate: '98.4%'
    }
  },
  [TileId.BATTERY]: {
    id: TileId.BATTERY,
    title: 'Power Fuel Gauge',
    category: 'Hardware & SoC',
    accent: '#00e676',
    flipped: false,
    front: {
      level: 88,
      charging: false,
      runtimeRemaining: '14h 20m',
      governor: 'Neural Efficiency Mode',
      powerDraw: '2.1 W'
    },
    back: {
      cellHealth: '99% Anode Nominal',
      tempC: 31.4,
      cycleCount: 34,
      fastChargeReady: '65W SuperVOOC Ready'
    }
  },
  [TileId.AIRGAP]: {
    id: TileId.AIRGAP,
    title: 'Air-Gap Security Mesh',
    category: 'Microkernel Cryptography',
    accent: '#7c4dff',
    flipped: false,
    front: {
      status: 'SECURED OFFLINE',
      radiosCut: 4,
      zeroEgress: true,
      cryptoScheme: 'ML-KEM-768 / Ed448'
    },
    back: {
      enforcement: 'EL1 Hardware Register Lock',
      ipStack: 'Loopback 127.0.0.1 Only',
      auditLedger: 'Block #142 Sealed',
      tamperState: 'Zero Violations'
    }
  }
};

/**
 * Built-in Metro app catalog grouped into alphabetical sections:
 * [A], [C], [M], [N], [S], [U], [W]
 */
export const BUILTIN_APPS = [
  // --- [A] ---
  {
    id: 'airgap_app',
    name: 'Air-Gap Matrix Killswitch',
    category: 'Security & Radios',
    description: 'Hardware RF isolation toggle & physical radio power gating',
    icon: '🛡️',
    letter: 'A',
    accent: '#00e5ff',
    launchType: 'ephemeral',
    tags: ['airgap', 'rf', 'security', 'hardware', 'isolation', 'offline']
  },
  {
    id: 'android_bridge',
    name: 'Android Bridge (Starnix)',
    category: 'Subsystems',
    description: 'POSIX translation layer & Linux ABI container for native APKs',
    icon: '🤖',
    letter: 'A',
    accent: '#00e676',
    launchType: 'dag',
    scenario: 'android_whatsapp',
    tags: ['android', 'starnix', 'linux', 'posix', 'apk', 'container']
  },
  {
    id: 'audit_ledger',
    name: 'Audit Ledger Inspector',
    category: 'Cryptography',
    description: 'Tamper-evident SHA-256 hash-chained capability audit trail',
    icon: '📜',
    letter: 'A',
    accent: '#7c4dff',
    launchType: 'ephemeral',
    tags: ['audit', 'ledger', 'tamper', 'security', 'blockchain', 'hash']
  },

  // --- [C] ---
  {
    id: 'calculator',
    name: 'Calculator & Soulver Math',
    category: 'Computation & Math',
    description: 'Real-time live preview evaluation, scientific trigonometry & offline converter',
    icon: '🧮',
    letter: 'C',
    accent: '#f59e0b',
    launchType: 'stock_app',
    tags: ['calculator', 'math', 'converter', 'currency', 'trig', 'soulver']
  },
  {
    id: 'camera_pro',
    name: 'Camera IMX890 Pro',
    category: 'Vision & Sensors',
    description: '50MP RAW capture pipeline with zero-copy VMO buffer bridge',
    icon: '📷',
    letter: 'C',
    accent: '#ff4081',
    launchType: 'dag',
    scenario: 'camera_note',
    tags: ['camera', 'photo', 'sensor', 'imx890', 'vmo', 'raw']
  },
  {
    id: 'clock',
    name: 'Clock, Timer & World Clocks',
    category: 'Time & Alarms',
    description: 'Multi-alarm scheduler, dynamic UTC offsets, Dynamic Island timer & stopwatch',
    icon: '⏱️',
    letter: 'C',
    accent: '#10b981',
    launchType: 'stock_app',
    tags: ['clock', 'alarm', 'timer', 'stopwatch', 'worldclock', 'dynamicisland']
  },
  {
    id: 'crypto_remit',
    name: 'Crypto Remittance (USDC)',
    category: 'Finance & Payments',
    description: 'Zero-knowledge cross-border 250 USDC remittance on Pravah L1',
    icon: '🪙',
    letter: 'C',
    accent: '#ffab00',
    launchType: 'dag',
    scenario: 'crypto',
    tags: ['crypto', 'usdc', 'payment', 'transfer', 'remittance', 'wallet']
  },

  // --- [F] ---
  {
    id: 'files',
    name: 'Files & Vault Storage',
    category: 'Storage & Files',
    description: 'Capacity breakdown, ZIP archive inspector & Titan M2 hardware-sealed vault',
    icon: '📁',
    letter: 'F',
    accent: '#3b82f6',
    launchType: 'stock_app',
    tags: ['files', 'storage', 'vault', 'explorer', 'zip', 'titan']
  },

  // --- [G] ---
  {
    id: 'gallery',
    name: 'Gallery & AI Neural Vision',
    category: 'Media & Photos',
    description: 'On-device neural vision search, EXIF privacy scrubber & locked safe album',
    icon: '🖼️',
    letter: 'G',
    accent: '#8b5cf6',
    launchType: 'stock_app',
    tags: ['gallery', 'photos', 'exif', 'camera', 'neural', 'vision']
  },

  // --- [M] ---
  {
    id: 'maps_offline',
    name: 'Maps & GNSS Navigation',
    category: 'Location & Geo',
    description: 'Offline vector map tiles with dead-reckoning IMU sensor fusion',
    icon: '🗺️',
    letter: 'M',
    accent: '#00b0ff',
    launchType: 'dag',
    scenario: 'android_maps',
    tags: ['maps', 'gps', 'gnss', 'navigation', 'location', 'geo']
  },
  {
    id: 'memory_compactor',
    name: 'Memory Compactor',
    category: 'Kernel Diagnostics',
    description: 'Zircon zero-tax working set compaction & secure cache flush',
    icon: '⚡',
    letter: 'M',
    accent: '#ffd600',
    launchType: 'dag',
    scenario: 'memory',
    tags: ['memory', 'ram', 'compactor', 'zircon', 'kernel', 'cache']
  },
  {
    id: 'messages',
    name: 'Messages & Air-Gap SMS',
    category: 'Communications',
    description: 'Zero-cloud post-quantum ML-KEM-768 sealed SMS with scheduled delivery',
    icon: '💬',
    letter: 'M',
    accent: '#06b6d4',
    launchType: 'stock_app',
    tags: ['messages', 'sms', 'chat', 'postquantum', 'mlkem', 'texts']
  },

  // --- [N] ---
  {
    id: 'neural_voice',
    name: 'Neural Voice Dictation',
    category: 'AI Pipeline',
    description: 'Air-gapped on-device spectrogram speech transformer with real-time audio FFT',
    icon: '🎤',
    letter: 'N',
    accent: '#e040fb',
    launchType: 'ephemeral',
    tags: ['voice', 'dictation', 'ai', 'speech', 'microphone', 'audio', 'npu']
  },
  {
    id: 'notes_vault',
    name: 'Notes & Vault',
    category: 'Storage & Documents',
    description: 'Encrypted document vault with localized OCR & privacy redaction',
    icon: '📄',
    letter: 'N',
    accent: '#69f0ae',
    launchType: 'dag',
    scenario: 'ocr',
    tags: ['notes', 'ocr', 'vault', 'document', 'privacy', 'text']
  },

  // --- [P] ---
  {
    id: 'phone',
    name: 'Phone & Fossify T9 Dialer',
    category: 'Telephony & Voice',
    description: 'Instant Fossify T9 contact dialer, call screening & 3GPP satellite SOS',
    icon: '📞',
    letter: 'P',
    accent: '#10b981',
    launchType: 'stock_app',
    tags: ['phone', 'dialer', 't9', 'call', 'satellite', 'contacts']
  },

  // --- [S] ---
  {
    id: 'settings_mesh',
    name: 'Settings & Security Mesh',
    category: 'System Control',
    description: 'Kernel authority level, capability router & biometric policies',
    icon: '⚙️',
    letter: 'S',
    accent: '#90a4ae',
    launchType: 'ephemeral',
    tags: ['settings', 'mesh', 'system', 'authority', 'security', 'config']
  },
  {
    id: 'spotify_audio',
    name: 'Spotify Lossless Audio',
    category: 'Media & Streaming',
    description: 'Direct 48kHz audio HAL streaming with real-time floating equalizers',
    icon: '🎵',
    letter: 'S',
    accent: '#1db954',
    launchType: 'dag',
    scenario: 'android_spotify',
    tags: ['spotify', 'music', 'audio', 'streaming', 'hal', 'equalizer']
  },

  // --- [U] ---
  {
    id: 'uber_dispatch',
    name: 'Uber Ride Dispatch',
    category: 'Services',
    description: 'Ride hailing dispatch protected by Policy Gate Level 3 check',
    icon: '🚗',
    letter: 'U',
    accent: '#ffffff',
    launchType: 'dag',
    scenario: 'android_uber',
    tags: ['uber', 'ride', 'taxi', 'dispatch', 'transport', 'gate']
  },
  {
    id: 'upi_transfer',
    name: 'UPI Fast Transfer (₹5,000)',
    category: 'Finance & Payments',
    description: 'Instant banking transfer requiring deterministic biometric approval',
    icon: '💳',
    letter: 'U',
    accent: '#ff5252',
    launchType: 'dag',
    scenario: 'payment',
    tags: ['upi', 'payment', 'transfer', 'bank', 'gate', 'finance']
  },

  // --- [W] ---
  {
    id: 'weather_telemetry',
    name: 'Weather & Barometer',
    category: 'Environmental Sensors',
    description: 'Localized atmospheric barometric sensor stream & microclimate radar',
    icon: '⛅',
    letter: 'W',
    accent: '#00e5ff',
    launchType: 'ephemeral',
    tags: ['weather', 'barometer', 'sensors', 'temperature', 'climate']
  },
  {
    id: 'whatsapp_im',
    name: 'WhatsApp Messenger',
    category: 'Communications',
    description: 'Sandboxed end-to-end messaging bridged via Starnix VMO pipeline',
    icon: '💬',
    letter: 'W',
    accent: '#25d366',
    launchType: 'dag',
    scenario: 'android_whatsapp',
    tags: ['whatsapp', 'messaging', 'chat', 'communications', 'starnix']
  }
];

/**
 * Pure function: Groups apps alphabetically by their starting letter.
 * Generates active letter sets and full A-Z jump metadata.
 */
export function groupAppsAlphabetically(apps = BUILTIN_APPS) {
  const sorted = [...apps].sort((a, b) => a.name.localeCompare(b.name));
  const grouped = new Map();

  for (const app of sorted) {
    const letter = (app.letter || app.name.charAt(0)).toUpperCase();
    if (!grouped.has(letter)) {
      grouped.set(letter, []);
    }
    grouped.get(letter).push(app);
  }

  const activeLetters = Array.from(grouped.keys()).sort();
  const allLetters = [];

  for (let c = 65; c <= 90; c++) {
    const char = String.fromCharCode(c);
    const count = grouped.has(char) ? grouped.get(char).length : 0;
    allLetters.push({
      letter: char,
      active: count > 0,
      count
    });
  }

  return {
    grouped,
    activeLetters,
    allLetters,
    totalCount: apps.length
  };
}

/**
 * Pure function: Instant reactive search filtering.
 */
export function filterApps(apps = BUILTIN_APPS, query = '') {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...apps];

  return apps.filter((app) => {
    if (app.name.toLowerCase().includes(trimmed)) return true;
    if (app.category && app.category.toLowerCase().includes(trimmed)) return true;
    if (app.description && app.description.toLowerCase().includes(trimmed)) return true;
    if (app.tags && app.tags.some(t => t.toLowerCase().includes(trimmed))) return true;
    return false;
  });
}

/**
 * Formats a duration in seconds to MM:SS or HH:MM:SS.
 */
export function formatCountdown(seconds) {
  const sec = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const remainingSec = sec % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(remainingSec).padStart(2, '0')}`;
}

/**
 * Generates an array of randomized equalizer bar normalized heights [0.15 - 0.98].
 */
export function generateEqualizerBars(count = 5) {
  const bars = [];
  for (let i = 0; i < count; i++) {
    const val = 0.15 + Math.random() * 0.83;
    bars.push(parseFloat(val.toFixed(2)));
  }
  return bars;
}

/**
 * Pure function: Synthesizes an on-device intention goal into a 3-stage capability DAG & Smart Outcome.
 */
export function synthesizeIntentionOutcome(query = '', scenario = '') {
  const q = String(query || '').trim();
  let key = String(scenario || '').trim().toLowerCase();
  if (!key) {
    const ql = q.toLowerCase();
    if (ql.includes('flight') || ql.includes('ai-202')) key = 'flight';
    else if (ql.includes('photo') || ql.includes('note') || ql.includes('camera') || ql.includes('ocr')) key = 'camera_note';
    else if (ql.includes('usdc') || ql.includes('crypto')) key = 'crypto';
    else if (ql.includes('pay') || ql.includes('5000') || ql.includes('upi') || ql.includes('₹')) key = 'payment';
    else if (ql.includes('ram') || ql.includes('memory') || ql.includes('optim')) key = 'memory';
    else if (ql.includes('air') || ql.includes('shield') || ql.includes('rf')) key = 'airgap';
  }

  switch (key) {
    case 'flight':
      return {
        scenario: 'flight',
        prompt: q || 'Check flight AI-202 and set reminder 2h prior',
        headline: 'Flight AI-202 Confirmed • On Time',
        badge: '✓ 0-CLOUD DAG',
        summary: 'DEL -> BLR departs at 10:30 AM from Terminal 3, Gate 14B. Calendar reminder armed locally.',
        dagSteps: ['1. Intent Parser ✓', '2. EL1 Gate ✓', '3. Calendar ✓'],
        pills: ['Gate 14B', 'Term T3', '🔒 0-Cloud Enclave'],
        targetPkg: 'com.google.android.calendar',
        launchLabel: 'Open Calendar ➔'
      };
    case 'camera_note':
      return {
        scenario: 'camera_note',
        prompt: q || 'Capture document photo and seal into Aurora Notes',
        headline: 'Zero-Copy Camera VMO -> Aurora Notes',
        badge: '✓ VMO SEALED',
        summary: 'Captured buffer via IMX890 HAL and saved SHA-256 verified note directly inside Aurora Notes.',
        dagSteps: ['1. Vision Parse ✓', '2. VMO Policy ✓', '3. Aurora ✓'],
        pills: ['Zero-Copy VMO', 'Aurora Notes', '🔒 Offline OCR'],
        targetPkg: 'org.pravah.aurora',
        launchLabel: 'Open Aurora Notes ➔'
      };
    case 'payment':
      return {
        scenario: 'payment',
        prompt: q || 'Send ₹5,000 securely via Pravah Vault',
        headline: '₹5,000 UPI Policy Gate Authorized',
        badge: '✓ TITAN M2',
        summary: 'Biometric Titan M2 enclave sealed UPI transaction receipt under dual capability isolation.',
        dagSteps: ['1. Risk Check ✓', '2. Titan M2 ✓', '3. Settled ✓'],
        pills: ['₹5,000 UPI', 'Enclave Sealed', '✓ Receipt Saved'],
        targetPkg: 'org.pravah.vault',
        launchLabel: 'Open Pravah Vault ➔'
      };
    case 'crypto':
      return {
        scenario: 'crypto',
        prompt: q || 'Verify 250 USDC cross-border remittance',
        headline: '250 USDC ZK Proof Sealed',
        badge: '✓ ZK-PROOF',
        summary: 'Signed offline Ed448 settlement voucher in Pravah Vault without keys ever leaving Titan M2.',
        dagSteps: ['1. ZK Build ✓', '2. Ed448 Sign ✓', '3. Sealed ✓'],
        pills: ['250 USDC', 'ML-KEM-768', '🔒 Key Enclave'],
        targetPkg: 'org.pravah.vault',
        launchLabel: 'Open Pravah Vault ➔'
      };
    case 'memory':
      return {
        scenario: 'memory',
        prompt: q || 'Freeze dormant apps and compact Pixel 7 RAM',
        headline: 'Dormancy Compactor Reclaimed 428 MB',
        badge: '✓ 0% BG TAX',
        summary: 'Dormant background tasks frozen to 0.0% CPU draw and working-set memory reclaimed cleanly.',
        dagSteps: ['1. Scan Tasks ✓', '2. Freeze BG ✓', '3. Compacted ✓'],
        pills: ['+428 MB Free', '0% BG Tax', '✓ pravahd'],
        targetPkg: 'org.pravah.shield',
        launchLabel: 'Open Pravah Shield ➔'
      };
    case 'airgap':
      return {
        scenario: 'airgap',
        prompt: q || 'Verify hardware Air-Gap RF isolation & pravahd',
        headline: 'EL1 Telemetry & Air-Gap Verified',
        badge: '🛡️ SHIELDED',
        summary: 'pravahd daemon audited loopback enclave, OTA Slot A rollback index, and hardware killswitch.',
        dagSteps: ['1. Audit RF ✓', '2. EL1 Lock ✓', '3. Verified ✓'],
        pills: ['127.0.0.1:9880', 'Slot A', '🛡️ Shield Ready'],
        targetPkg: 'org.pravah.shield',
        launchLabel: 'Open Pravah Shield ➔'
      };
    default: {
      const safePrompt = q || 'Coordinate my apps on PravahOS locally';
      return {
        scenario: 'custom',
        prompt: safePrompt,
        headline: 'Custom Intention Synthesized Locally',
        badge: '✓ 0-CLOUD DAG',
        summary: `Parsed goal "${safePrompt}" -> bound 3-stage EL1 capability pipeline with zero cloud egress.`,
        dagSteps: ['1. Intent Parser ✓', '2. EL1 Gate ✓', '3. Native ✓'],
        pills: ['On-Device NPU', 'SHA-256 Sealed', '🔒 0-Cloud Leak'],
        targetPkg: 'org.pravah.store',
        launchLabel: 'Open Pravah Bazaar ➔'
      };
    }
  }
}

// ============================================================================
// Ephemeral Zero-Tax Window Manager
// ============================================================================

/**
 * Manages zero-tax capability overlay windows.
 * Ephemeral windows execute quickly without heavy shell context switching,
 * giving instant interactive access to tools like Air-Gap switches,
 * Audio controls, Audit ledger, and Weather telemetry.
 */
export class EphemeralWindowManager {
  constructor(hostElement = null) {
    this.host = hostElement;
    this.openWindows = new Map();
  }

  setHost(hostElement) {
    this.host = hostElement;
  }

  openWindow(app) {
    if (this.openWindows.has(app.id)) {
      const existing = this.openWindows.get(app.id);
      existing.element?.classList.remove('minimized');
      existing.element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return existing;
    }

    if (!this.host && typeof document !== 'undefined') {
      let found = document.getElementById('ephemeral-window-host');
      if (!found) {
        found = document.createElement('div');
        found.id = 'ephemeral-window-host';
        found.className = 'ephemeral-window-host';
        document.body.appendChild(found);
      }
      this.host = found;
    }

    const winRecord = {
      id: app.id,
      app,
      element: null,
      minimized: false,
      createdAt: Date.now()
    };

    if (typeof document !== 'undefined' && this.host) {
      const winEl = document.createElement('div');
      winEl.className = 'ephemeral-window';
      winEl.id = `ephemeral-win-${app.id}`;

      winEl.innerHTML = `
        <div class="ephemeral-header">
          <div class="ephemeral-title-wrap">
            <span class="ephemeral-app-icon">${app.icon || '✧'}</span>
            <div class="ephemeral-title-meta">
              <h4>${app.name}</h4>
              <span class="ephemeral-category">${app.category || 'Ephemeral Capability'} • Zero-Tax</span>
            </div>
          </div>
          <div class="ephemeral-actions">
            <button class="ephemeral-btn btn-min" title="Minimize Window">_</button>
            <button class="ephemeral-btn btn-close" title="Close Window">✕</button>
          </div>
        </div>
        <div class="ephemeral-body">
          ${this._renderAppBodyContent(app)}
        </div>
      `;

      const btnClose = winEl.querySelector('.btn-close');
      const btnMin = winEl.querySelector('.btn-min');

      btnClose?.addEventListener('click', () => this.closeWindow(app.id));
      btnMin?.addEventListener('click', () => this.toggleMinimize(app.id));

      this._wireInteractiveContent(winEl, app);

      this.host.appendChild(winEl);
      winRecord.element = winEl;

      try {
        haptics?.lightTap();
      } catch (_) {}
    }

    this.openWindows.set(app.id, winRecord);
    return winRecord;
  }

  closeWindow(appId) {
    const win = this.openWindows.get(appId);
    if (!win) return false;

    if (win.element && win.element.parentNode) {
      win.element.classList.add('closing');
      setTimeout(() => {
        if (win.element && win.element.parentNode) {
          win.element.parentNode.removeChild(win.element);
        }
      }, 200);
    }

    this.openWindows.delete(appId);
    try {
      haptics?.lightTap();
    } catch (_) {}
    return true;
  }

  toggleMinimize(appId) {
    const win = this.openWindows.get(appId);
    if (!win) return;
    win.minimized = !win.minimized;
    if (win.element) {
      win.element.classList.toggle('minimized', win.minimized);
    }
  }

  getOpenWindows() {
    return Array.from(this.openWindows.values());
  }

  closeAll() {
    for (const id of Array.from(this.openWindows.keys())) {
      this.closeWindow(id);
    }
  }

  _renderAppBodyContent(app) {
    switch (app.id) {
      case 'airgap_app':
        return `
          <div class="win-card">
            <div class="win-row status-highlight">
              <span>HARDWARE AIR-GAP</span>
              <span class="pill-active">SECURED OFFLINE</span>
            </div>
            <p style="font-size:0.75rem; color:#94a3b8; margin:6px 0 10px 0;">
              Hardware RF switches disconnected. Cryptographic isolation active at EL1.
            </p>
            <div class="rf-switch-grid">
              <label class="rf-toggle-item">
                <span>Cellular 5G NR</span>
                <input type="checkbox" checked disabled>
              </label>
              <label class="rf-toggle-item">
                <span>Wi-Fi 7 (802.11be)</span>
                <input type="checkbox" checked disabled>
              </label>
              <label class="rf-toggle-item">
                <span>Bluetooth 5.4</span>
                <input type="checkbox" checked disabled>
              </label>
              <label class="rf-toggle-item">
                <span>NFC / UWB</span>
                <input type="checkbox" checked disabled>
              </label>
            </div>
          </div>
        `;

      case 'weather_telemetry':
        return `
          <div class="win-card">
            <div class="weather-current-row">
              <div class="weather-temp-hero">26°C</div>
              <div class="weather-condition-meta">
                <strong>Fair & Clear</strong>
                <span>New Delhi, India</span>
              </div>
            </div>
            <div class="weather-stats-grid">
              <div class="w-stat">
                <span class="lbl">Barometer:</span>
                <span class="val">1013.2 hPa</span>
              </div>
              <div class="w-stat">
                <span class="lbl">Humidity:</span>
                <span class="val">42%</span>
              </div>
              <div class="w-stat">
                <span class="lbl">Wind:</span>
                <span class="val">12 km/h NW</span>
              </div>
              <div class="w-stat">
                <span class="lbl">UV Index:</span>
                <span class="val">3 (Moderate)</span>
              </div>
            </div>
          </div>
        `;

      case 'audit_ledger':
        return `
          <div class="win-card">
            <div class="win-row">
              <span>LEDGER INTEGRITY</span>
              <span class="pill-valid">✔ SHA-256 SEALED</span>
            </div>
            <p style="font-size:0.72rem; color:#94a3b8; margin:6px 0 8px;">
              Immutable audit ledger blocks cryptographically linked with Ed448 root certificate.
            </p>
            <div class="audit-summary-box">
              <div><strong>Genesis:</strong> 0x00010001 • zircon.security.init</div>
              <div><strong>Latest:</strong> 0x00010008 • capability.execute.verified</div>
              <div><strong>Blocks Validated:</strong> 8 of 8 intact</div>
            </div>
          </div>
        `;

      case 'neural_voice':
        return `
          <div class="win-card">
            <div class="win-row">
              <span>OFFLINE TRANSFORMER</span>
              <span class="pill-active">INT8 NPU READY</span>
            </div>
            <p style="font-size:0.72rem; color:#94a3b8; margin:6px 0 8px;">
              Zero telemetry egress. Mel-spectrogram speech recognition runs strictly in secure enclave RAM.
            </p>
            <div class="voice-eq-preview">
              <div class="v-bar" style="height:40%;"></div>
              <div class="v-bar" style="height:75%;"></div>
              <div class="v-bar" style="height:90%;"></div>
              <div class="v-bar" style="height:60%;"></div>
              <div class="v-bar" style="height:35%;"></div>
            </div>
          </div>
        `;

      default:
        return `
          <div class="win-card">
            <div class="win-row">
              <span>CAPABILITY STATUS</span>
              <span class="pill-active">READY</span>
            </div>
            <p style="font-size:0.75rem; color:#94a3b8; margin:8px 0;">
              ${app.description || 'PravahOS sandboxed execution capability.'}
            </p>
            <div style="font-size:0.7rem; font-family:var(--font-mono, monospace); color:#00e5ff; background:rgba(0,0,0,0.3); padding:6px; border-radius:4px;">
              ID: ${app.id}<br>
              Category: ${app.category}<br>
              Sandboxed: Starnix / Zircon EL1
            </div>
          </div>
        `;
    }
  }

  _wireInteractiveContent(winEl, app) {
    // Hooks for buttons or dynamic actions inside windows
  }
}

// ============================================================================
// LivingDrawer Core Component
// ============================================================================

/**
 * LivingDrawer manages the Windows Mobile / Metro style capability drawer:
 * - Dual-surface gesture navigation with spring physics.
 * - Glanceable Live Tiles with 3D flip card animations & live data tickers.
 * - A-Z alphabetical scroll list with Metro fast-jump index picker.
 * - Instant reactive search filter.
 * - Unified launch handler for DAG scenarios and Ephemeral windows.
 */
export class LivingDrawer {
  constructor(options = {}) {
    this.container = options.container || null;
    this.state = DrawerState.COLLAPSED;
    this.apps = options.apps ? [...options.apps] : [...BUILTIN_APPS];
    this.liveTiles = JSON.parse(JSON.stringify(options.liveTiles || DEFAULT_LIVE_TILES));
    this.searchQuery = '';
    this.activeFastJump = false;

    // Callbacks
    this.onLaunchApp = options.onLaunchApp || null;
    this.onStateChange = options.onStateChange || null;

    // Window manager for zero-tax overlay capabilities
    this.windowManager = options.windowManager || new EphemeralWindowManager();

    // Internal timers & tickers
    this.eqTimer = null;
    this.countdownTimer = null;
    this.flipTimer = null;
    this.nativeTelemetryTimer = null;

    // Gesture tracking state
    this.isDragging = false;
    this.startY = 0;
    this.currentY = 0;
    this.velocityTracker = new VelocityTracker();
    this.spring = new Spring(SpringPresets.snappy);

    if (typeof window !== 'undefined') {
      window.PravahLivingDrawer = this;
      window.livingDrawer = this;
    }

    if (this.container) {
      this.mount(this.container);
    }
  }

  /**
   * Mounts the Living Drawer into the DOM.
   */
  mount(container) {
    this.container = container;
    this.container.classList.add('living-drawer-root');
    if (typeof window !== 'undefined') {
      window.PravahLivingDrawer = this;
      window.livingDrawer = this;
    }
    if (!this.container.querySelector('.drawer-scroll-body')) {
      this.render();
    } else {
      const scrollBody = this.container.querySelector('.drawer-scroll-body');
      if (scrollBody && !this.container.querySelector('#vista-intent-widget') && typeof scrollBody.insertAdjacentHTML === 'function') {
        scrollBody.insertAdjacentHTML('afterbegin', this._renderIntentWidgetSectionHtml());
      }
      this._bindDomEvents();
    }
    if (typeof window !== 'undefined' && window.PravahNative) {
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.add('native-metro-mode');
      }
      this.expand();
      this.syncNativeAndroidApps();
      this.syncNativeTelemetry();
    }
    this.startLiveTickers();
    this.bindGestures();
  }

  /**
   * Syncs installed native Android APKs from PravahNative bridge into the Metro A-Z list.
   */
  syncNativeAndroidApps() {
    if (typeof window === 'undefined' || !window.PravahNative?.getInstalledApps) return;
    try {
      const raw = window.PravahNative.getInstalledApps();
      const installed = JSON.parse(raw || '[]');
      if (!Array.isArray(installed) || installed.length === 0) return;

      const seenPkgs = new Set();
      const nativeApps = [];
      for (const entry of installed) {
        if (!entry || !entry.pkg || !entry.label) continue;
        if (seenPkgs.has(entry.pkg)) continue;
        seenPkgs.add(entry.pkg);
        const firstChar = String(entry.label).trim().charAt(0).toUpperCase();
        const letter = /^[A-Z]$/.test(firstChar) ? firstChar : '#';
        const isPravah = Boolean(entry.isPravah || entry.pkg.startsWith('org.pravah.'));
        nativeApps.push({
          id: `apk_${entry.pkg}`,
          pkg: entry.pkg,
          isPravah,
          name: entry.label,
          category: isPravah ? 'PravahOS Native Zero-Tax APK' : 'Android Native App',
          description: `${entry.pkg} • Direct Native Execution`,
          icon: isPravah ? '🛡️' : '📱',
          iconDataUri: entry.icon || '',
          letter,
          accent: isPravah ? '#38bdf8' : '#7dd3fc',
          launchType: 'native_apk',
          tags: [entry.label.toLowerCase(), entry.pkg.toLowerCase(), 'android', 'apk', isPravah ? 'pravah' : '']
        });
      }

      if (nativeApps.length > 0) {
        this.apps = nativeApps;
        if (this.container) {
          this.refreshList();
          const tilesGrid = this.container.querySelector('.live-tiles-grid');
          if (tilesGrid) {
            tilesGrid.innerHTML = this._renderLiveTilesHtml();
            this._bindLiveTileEvents();
          }
          const jumpGrid = this.container.querySelector('#metro-jump-grid');
          if (jumpGrid) {
            jumpGrid.innerHTML = this._renderFastJumpGridHtml();
            const jumpTiles = this.container.querySelectorAll('.metro-jump-tile.tile-active');
            jumpTiles.forEach((tile) => {
              tile.addEventListener('click', () => {
                const letter = tile.getAttribute('data-letter');
                this.jumpToLetter(letter);
              });
            });
          }
        }
      }
    } catch (err) {
      console.warn('syncNativeAndroidApps failed:', err);
    }
  }

  /**
   * Syncs live hardware telemetry (battery, audio, air-gap) from Android & pravahd.
   */
  syncNativeTelemetry() {
    if (typeof window === 'undefined' || !window.PravahNative?.getLiveSystemTelemetry) return;
    try {
      const raw = window.PravahNative.getLiveSystemTelemetry();
      const data = JSON.parse(raw || '{}');
      if (data.battery) {
        const b = this.liveTiles[TileId.BATTERY];
        b.front.level = typeof data.battery.level === 'number' ? data.battery.level : b.front.level;
        b.front.charging = Boolean(data.battery.charging);
        b.front.runtimeRemaining = b.front.charging ? 'Charging AC' : `${data.battery.voltageMv || 4200} mV`;
        b.back.tempC = data.battery.tempC ?? b.back.tempC;
        if (this.container) {
          const fill = this.container.querySelector('#battery-fuel-fill');
          const pill = this.container.querySelector('#battery-pct-pill');
          const runtimeEl = this.container.querySelector('#battery-runtime-val');
          if (fill) fill.style.width = `${b.front.level}%`;
          if (pill) pill.textContent = `${b.front.level}%`;
          if (runtimeEl) runtimeEl.textContent = b.front.runtimeRemaining;
        }
      }
      if (typeof data.airgap === 'boolean') {
        this.updateTelemetry({ airgap: data.airgap });
      }
      if (data.audio && this.container) {
        const trackEl = this.container.querySelector('#spotify-track-title');
        const subEl = this.container.querySelector('#spotify-artist');
        if (data.audio.musicActive) {
          if (trackEl) trackEl.textContent = 'Android Audio Active';
          if (subEl) subEl.textContent = `Volume ${data.audio.volume}/${data.audio.maxVolume} • Direct DMA`;
        }
      }
    } catch (err) {
      console.warn('syncNativeTelemetry failed:', err);
    }
  }

  /**
   * Main render pass.
   */
  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <!-- Metro Drawer Handle & Header -->
      <div class="drawer-drag-header" id="drawer-drag-header" title="Drag down to collapse">
        <div class="drawer-handle-bar"></div>
        <div class="drawer-header-meta">
          <div class="drawer-brand">
            <span class="drawer-logo">⊞</span>
            <span class="drawer-title">Living Drawer</span>
          </div>
          <button class="drawer-btn-dismiss" id="btn-drawer-dismiss" title="Close Drawer">✕</button>
        </div>
      </div>

      <!-- Scrollable Drawer Content Surface -->
      <div class="drawer-scroll-body" id="drawer-scroll-body">

        <!-- Windows Vista Aero Glass Intention Capsule Widget -->
        ${this._renderIntentWidgetSectionHtml()}

        <!-- Top Section: Dynamic Glanceable Live Tiles -->
        <section class="drawer-live-tiles-section">
          <div class="section-label-row">
            <span class="section-title">GLANCEABLE LIVE TILES</span>
            <button class="btn-flip-all" id="btn-flip-all" title="Flip all live tiles to reveal telemetry">🔄 Flip Tiles</button>
          </div>
          <div class="live-tiles-grid" id="live-tiles-grid">
            ${this._renderLiveTilesHtml()}
          </div>
        </section>

        <!-- Bottom Section: Windows Phone / Metro Alphabetical A-Z List -->
        <section class="drawer-metro-list-section">
          <div class="section-label-row">
            <span class="section-title">CAPABILITY & APP CATALOG</span>
            <span class="apps-count-badge" id="apps-count-badge">${this.apps.length} Capabilities</span>
          </div>

          <!-- Instant Search Bar -->
          <div class="drawer-search-wrap">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              id="drawer-search-input" 
              class="drawer-search-input" 
              placeholder="Search capabilities, apps, scenarios..."
              value="${this.searchQuery}"
              autocomplete="off"
              spellcheck="false"
            />
            <button id="btn-search-clear" class="btn-search-clear ${this.searchQuery ? 'visible' : ''}" title="Clear search">✕</button>
          </div>

          <!-- Fast-Jump Letter Index Bar & List Container -->
          <div class="metro-list-container" id="metro-list-container">
            ${this._renderMetroListHtml()}
          </div>
        </section>

      </div>

      <!-- Neo-Metro Floating Glass Prism Modal -->
      <div class="metro-jump-modal-backdrop" id="metro-jump-modal">
        <div class="metro-jump-card glass-prism-card">
          <div class="glass-prism-sheen" aria-hidden="true"></div>
          <div class="metro-jump-header">
            <div class="prism-header-title">
              <span class="prism-beacon-dot"></span>
              <span>Capability Index Jump</span>
            </div>
            <button class="btn-jump-close" id="btn-jump-close" title="Close Index Picker">✕</button>
          </div>
          <div class="metro-jump-grid" id="metro-jump-grid">
            ${this._renderFastJumpGridHtml()}
          </div>
          <div class="metro-jump-footer">
            <span class="jump-footer-tip">Select letter to navigate instantly</span>
          </div>
        </div>
      </div>
    `;

    this._bindDomEvents();
  }

  /**
   * Generates HTML for the 4 Glanceable Live Tiles in Neo-Metro Bento Grid.
   */
  _renderLiveTilesHtml() {
    const s = this.liveTiles[TileId.SPOTIFY];
    const f = this.liveTiles[TileId.FLIGHT];
    const b = this.liveTiles[TileId.BATTERY];
    const a = this.liveTiles[TileId.AIRGAP];

    return `
      <!-- 1. Active Spotify Hero 2x1 Bento Tile with Floating Rotating Vinyl & Audio Wave Ribbon -->
      <div class="live-tile bento-tile tile-wide tile-hero-2x1 tile-spotify ${s.flipped ? 'flipped' : ''}" id="tile-spotify" data-tile-id="${TileId.SPOTIFY}">
        <div class="tile-face tile-front">
          <div class="tile-top-row">
            <div class="tile-icon-group">
              <span class="tile-glyph">🎵</span>
              <span class="tile-badge">AUDIO HAL</span>
              <span class="tile-dot-live"></span>
            </div>
            <div class="tile-eq-visualizer" id="spotify-eq-bars">
              ${(s.front.eqBars || [0.5, 0.8, 0.4, 0.9, 0.6]).map(h => `<div class="eq-bar" style="height:${Math.round(h * 100)}%;"></div>`).join('')}
            </div>
          </div>
          <div class="tile-middle-info tile-hero-middle">
            <div class="spotify-hero-content">
              <div class="tile-title" id="spotify-track-title">${s.front.track}</div>
              <div class="tile-sub" id="spotify-artist">${s.front.artist}</div>
              <!-- Animated Soundwave Ribbon -->
              <div class="soundwave-ribbon" aria-hidden="true">
                <span class="soundwave-line wave-1"></span>
                <span class="soundwave-line wave-2"></span>
                <span class="soundwave-line wave-3"></span>
                <span class="soundwave-line wave-4"></span>
                <span class="soundwave-line wave-5"></span>
                <span class="soundwave-line wave-6"></span>
                <span class="soundwave-line wave-7"></span>
              </div>
            </div>
            <!-- Floating Rotating Vinyl Disc -->
            <div class="spotify-vinyl-disc ${s.front.isPlaying ? 'spinning' : ''}" aria-hidden="true">
              <div class="vinyl-groove groove-outer"></div>
              <div class="vinyl-groove groove-inner"></div>
              <div class="vinyl-center-label">
                <span class="vinyl-spindle"></span>
              </div>
            </div>
          </div>
          <div class="tile-bottom-row">
            <span class="tile-meta-tag">48kHz DIRECT DMA • ZERO JITTER</span>
            <button class="tile-flip-btn" data-tile="${TileId.SPOTIFY}" title="Flip tile details">↻</button>
          </div>
        </div>
        <div class="tile-face tile-back">
          <div class="tile-top-row">
            <span class="tile-badge">STREAM TELEMETRY</span>
            <button class="tile-flip-btn" data-tile="${TileId.SPOTIFY}">↻</button>
          </div>
          <div class="tile-back-specs">
            <div class="spec-row"><span>Codec:</span> <strong>${s.back.codec}</strong></div>
            <div class="spec-row"><span>Audio Sink:</span> <strong>${s.back.sink}</strong></div>
            <div class="spec-row"><span>Latency:</span> <strong>${s.back.latency}</strong></div>
            <div class="spec-row"><span>Buffer:</span> <strong>${s.back.bufferHealth}</strong></div>
          </div>
          <div class="tile-bottom-row">
            <span class="tile-action-hint">Tap to Launch Spotify DAG ➔</span>
          </div>
        </div>
      </div>

      <!-- 2. Flight AI-202 Radar Bento Tile -->
      <div class="live-tile bento-tile tile-medium tile-flight ${f.flipped ? 'flipped' : ''}" id="tile-flight" data-tile-id="${TileId.FLIGHT}">
        <div class="tile-face tile-front">
          <div class="tile-top-row">
            <div class="tile-icon-group">
              <span class="tile-glyph">✈</span>
              <span class="tile-badge">${f.front.flightNum}</span>
            </div>
            <span class="tile-status-pill ${f.front.status === 'BOARDING' ? 'pulse-amber' : 'pulse-cyan'}">${f.front.status}</span>
          </div>
          <div class="tile-middle-info flight-bento-middle">
            <div class="flight-route-display">${f.front.route}</div>
            <div class="flight-countdown-val" id="flight-countdown-val">${formatCountdown(f.front.countdownSec)}</div>
            <!-- Flight Radar Sweep Graphic -->
            <div class="flight-radar-scope" aria-hidden="true">
              <div class="radar-ring ring-1"></div>
              <div class="radar-ring ring-2"></div>
              <div class="radar-sweep"></div>
              <div class="radar-blip"></div>
            </div>
          </div>
          <div class="tile-bottom-row">
            <span class="tile-meta-tag">Gate ${f.front.gate} • Term ${f.front.terminal}</span>
            <button class="tile-flip-btn" data-tile="${TileId.FLIGHT}">↻</button>
          </div>
        </div>
        <div class="tile-face tile-back">
          <div class="tile-top-row">
            <span class="tile-badge">RADAR INTEL</span>
            <button class="tile-flip-btn" data-tile="${TileId.FLIGHT}">↻</button>
          </div>
          <div class="tile-back-specs">
            <div class="spec-row"><span>Aircraft:</span> <strong>${f.back.aircraft}</strong></div>
            <div class="spec-row"><span>Dest:</span> <strong>${f.back.destWeather}</strong></div>
            <div class="spec-row"><span>Baggage:</span> <strong>${f.back.baggageClaim}</strong></div>
            <div class="spec-row"><span>On-Time:</span> <strong>${f.back.onTimeRate}</strong></div>
          </div>
          <div class="tile-bottom-row">
            <span class="tile-action-hint">Tap to Launch Flight Scenario ➔</span>
          </div>
        </div>
      </div>

      <!-- 3. Battery / Power Fuel Gauge Bento Tile -->
      <div class="live-tile bento-tile tile-medium tile-battery ${b.flipped ? 'flipped' : ''}" id="tile-battery" data-tile-id="${TileId.BATTERY}">
        <div class="tile-face tile-front">
          <div class="tile-top-row">
            <div class="tile-icon-group">
              <span class="tile-glyph">🔋</span>
              <span class="tile-badge">SOC POWER</span>
            </div>
            <span class="battery-pct-pill" id="battery-pct-pill">${b.front.level}%</span>
          </div>
          <div class="tile-middle-info battery-bento-middle">
            <div class="fuel-gauge-capsule">
              <div class="fuel-gauge-bar-wrap">
                <div class="fuel-gauge-fill" id="battery-fuel-fill" style="width: ${b.front.level}%;"></div>
              </div>
            </div>
            <div class="fuel-gauge-meta">
              <span id="battery-runtime-val">${b.front.runtimeRemaining}</span>
              <span>${b.front.powerDraw}</span>
            </div>
          </div>
          <div class="tile-bottom-row">
            <span class="tile-meta-tag">${b.front.governor}</span>
            <button class="tile-flip-btn" data-tile="${TileId.BATTERY}">↻</button>
          </div>
        </div>
        <div class="tile-face tile-back">
          <div class="tile-top-row">
            <span class="tile-badge">CELL HEALTH</span>
            <button class="tile-flip-btn" data-tile="${TileId.BATTERY}">↻</button>
          </div>
          <div class="tile-back-specs">
            <div class="spec-row"><span>Anode:</span> <strong>${b.back.cellHealth}</strong></div>
            <div class="spec-row"><span>Temp:</span> <strong>${b.back.tempC}°C</strong></div>
            <div class="spec-row"><span>Cycles:</span> <strong>${b.back.cycleCount}</strong></div>
            <div class="spec-row"><span>Fast Charge:</span> <strong>${b.back.fastChargeReady}</strong></div>
          </div>
          <div class="tile-bottom-row">
            <span class="tile-action-hint">Tap to Inspect Power HAL ➔</span>
          </div>
        </div>
      </div>

      <!-- 4. Air-Gap Cryptographic Badge Bento Tile -->
      <div class="live-tile bento-tile tile-wide tile-airgap ${a.flipped ? 'flipped' : ''}" id="tile-airgap" data-tile-id="${TileId.AIRGAP}">
        <div class="tile-face tile-front">
          <div class="tile-top-row">
            <div class="tile-icon-group">
              <span class="tile-glyph">🛡️</span>
              <span class="tile-badge">AIR-GAP MESH</span>
              <span class="crypto-quantum-badge">POST-QUANTUM</span>
            </div>
            <div class="airgap-secure-indicator">
              <div class="pulse-dot-green"></div>
              <span>${a.front.status}</span>
            </div>
          </div>
          <div class="tile-middle-info airgap-bento-middle">
            <div class="airgap-badge-meta">
              <div class="tile-title">Hardware RF Killswitch Enforced</div>
              <div class="tile-sub">All 4 radios cut • Zero telemetry egress • Microkernel EL1 locked</div>
            </div>
            <div class="airgap-chip-graphic" aria-hidden="true">
              <span class="chip-pin pin-1"></span>
              <span class="chip-pin pin-2"></span>
              <span class="chip-pin pin-3"></span>
              <span class="chip-core">SEC</span>
            </div>
          </div>
          <div class="tile-bottom-row">
            <span class="tile-meta-tag">${a.front.cryptoScheme}</span>
            <button class="tile-flip-btn" data-tile="${TileId.AIRGAP}">↻</button>
          </div>
        </div>
        <div class="tile-face tile-back">
          <div class="tile-top-row">
            <span class="tile-badge">ENCLAVE AUDIT</span>
            <button class="tile-flip-btn" data-tile="${TileId.AIRGAP}">↻</button>
          </div>
          <div class="tile-back-specs">
            <div class="spec-row"><span>Enforcement:</span> <strong>${a.back.enforcement}</strong></div>
            <div class="spec-row"><span>Net Stack:</span> <strong>${a.back.ipStack}</strong></div>
            <div class="spec-row"><span>Ledger:</span> <strong>${a.back.auditLedger}</strong></div>
            <div class="spec-row"><span>Tamper State:</span> <strong>${a.back.tamperState}</strong></div>
          </div>
          <div class="tile-bottom-row">
            <span class="tile-action-hint">Tap to Toggle Air-Gap Isolation ➔</span>
          </div>
        </div>
      </div>
      ${this._renderVistaGlassPinnedTilesHtml()}
    `;
  }

  /**
   * Generates Windows Vista Aero Glass Pinned App Tiles using real Android app icons.
   */
  _renderVistaGlassPinnedTilesHtml() {
    const nativeApps = this.apps.filter(a => a.launchType === 'native_apk' && a.pkg);
    const priorityOrder = [
      'org.pravah.shield',
      'org.pravah.vault',
      'org.pravah.store',
      'org.pravah.aurora',
      'com.android.chrome',
      'com.google.android.gm',
      'com.google.android.youtube',
      'com.google.android.apps.photos',
      'com.google.android.apps.maps',
      'com.android.camera2',
      'com.google.android.dialer',
      'com.google.android.apps.messaging',
      'com.android.settings',
      'com.google.android.deskclock',
      'com.google.android.calendar',
      'com.google.android.apps.nbu.files'
    ];

    let pinned = [];
    if (nativeApps.length > 0) {
      for (const pkg of priorityOrder) {
        const match = nativeApps.find(a => a.pkg === pkg);
        if (match) pinned.push(match);
      }
      for (const app of nativeApps) {
        if (pinned.length >= 12) break;
        if (!pinned.some(p => p.pkg === app.pkg)) {
          pinned.push(app);
        }
      }
    } else {
      pinned = this.apps.slice(0, 8);
    }

    return pinned.map(app => `
      <div class="vista-glass-tile ${app.isPravah ? 'vista-tile-pravah' : ''}" data-app-id="${app.id}" data-pkg="${app.pkg || ''}">
        <div class="vista-aero-reflection" aria-hidden="true"></div>
        <div class="vista-tile-top">
          <div class="vista-tile-icon-wrap">
            ${app.iconDataUri
              ? `<img class="vista-tile-icon-img" src="${app.iconDataUri}" alt="${app.name}" />`
              : `<span class="vista-tile-glyph">${app.icon || '✧'}</span>`}
          </div>
          <span class="vista-tile-badge">${app.isPravah ? 'PRAVAH' : 'AERO'}</span>
        </div>
        <div class="vista-tile-title">${app.name}</div>
        <div class="vista-tile-sub">${app.isPravah ? 'Native Glass App' : 'Direct Launch'}</div>
      </div>
    `).join('');
  }

  /**
   * Generates the Windows Phone / Metro-style Alphabetical A-Z List HTML in Neo-Metro aesthetic.
   */
  _renderMetroListHtml() {
    const filtered = filterApps(this.apps, this.searchQuery);
    if (filtered.length === 0) {
      return `
        <div class="metro-empty-state">
          <div class="empty-icon">🔍</div>
          <h4>No matching capabilities found</h4>
          <p>Try searching for "flight", "spotify", "air-gap", or "usdc"</p>
        </div>
      `;
    }

    const { grouped } = groupAppsAlphabetically(filtered);
    let html = '';

    for (const [letter, letterApps] of grouped.entries()) {
      html += `
        <div class="metro-letter-section" id="section-letter-${letter}" data-letter="${letter}">
          <!-- Modern Neo-Metro Sleek Squircle Letter Ribbon -->
          <div class="metro-letter-header-wrap">
            <button class="metro-letter-header-tile" data-jump-trigger="${letter}" title="Jump to letter [${letter}]">
              <span class="metro-letter-char">${letter}</span>
              <span class="metro-letter-beacon" aria-hidden="true"></span>
            </button>
            <div class="metro-letter-ribbon-info">
              <span class="metro-letter-pill">${letterApps.length} ${letterApps.length === 1 ? 'capability' : 'capabilities'}</span>
            </div>
            <span class="metro-letter-count" style="display:none;">${letterApps.length} item${letterApps.length > 1 ? 's' : ''}</span>
          </div>

          <!-- Apps under this letter -->
          <div class="metro-app-items-group">
            ${letterApps.map(app => `
              <div class="metro-app-item" data-app-id="${app.id}" data-launch-type="${app.launchType}" tabindex="0">
                <div class="metro-app-icon-box ${app.iconDataUri ? 'has-native-icon' : ''}" style="${app.iconDataUri ? '' : `background:${app.accent || '#00e5ff'};`}">
                  ${app.iconDataUri
                    ? `<img class="metro-native-icon-img" src="${app.iconDataUri}" alt="${app.name}" loading="lazy" />`
                    : `<span class="metro-glyph-inner">${app.icon || '✧'}</span>`}
                  <div class="icon-specular-sheen" aria-hidden="true"></div>
                </div>
                <div class="metro-app-content">
                  <div class="metro-app-primary">
                    <span class="metro-app-name">${app.name}</span>
                    <span class="metro-launch-badge ${app.launchType === 'dag' ? 'badge-dag' : (app.launchType === 'stock_app' ? 'badge-stock' : 'badge-ephemeral')}">
                      <span class="badge-dot"></span>
                      ${app.launchType === 'dag' ? 'DAG' : (app.launchType === 'stock_app' ? 'FLAGSHIP' : (app.launchType === 'native_apk' ? (app.isPravah ? 'PRAVAH APK' : 'ANDROID') : 'ZERO-TAX'))}
                    </span>
                  </div>
                  <div class="metro-app-desc">${app.description || ''}</div>
                </div>
                <div class="metro-app-arrow" aria-hidden="true">›</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    return html;
  }

  /**
   * Generates the 4x7 Metro Alphabet Fast-Jump Picker Grid with Glowing Active Letter Beacons.
   */
  _renderFastJumpGridHtml() {
    const { allLetters } = groupAppsAlphabetically(this.apps);
    return allLetters.map(item => `
      <button 
        class="metro-jump-tile ${item.active ? 'tile-active' : 'tile-inactive'}" 
        data-letter="${item.letter}"
        ${item.active ? '' : 'disabled'}
        title="${item.active ? `${item.count} capabilities under [${item.letter}]` : `No capabilities under [${item.letter}]`}"
      >
        <span class="jump-char">${item.letter}</span>
        ${item.active ? `
          <span class="jump-beacon-dot" aria-hidden="true"></span>
          <span class="jump-count">${item.count}</span>
        ` : ''}
      </button>
    `).join('');
  }

  /**
   * Bind DOM listeners for search, clicks, tiles, and letter headers.
   */
  _bindDomEvents() {
    if (!this.container) return;

    // 1. Dismiss button
    const btnDismiss = this.container.querySelector('#btn-drawer-dismiss');
    btnDismiss?.addEventListener('click', () => {
      this.dismissToHome();
      try {
        haptics?.lightTap();
      } catch (_) {}
    });

    // 2. Search input
    const searchInput = this.container.querySelector('#drawer-search-input');
    const searchClear = this.container.querySelector('#btn-search-clear');

    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      searchClear?.classList.toggle('visible', Boolean(this.searchQuery));
      this.refreshList();
    });

    searchClear?.addEventListener('click', () => {
      this.searchQuery = '';
      if (searchInput) searchInput.value = '';
      searchClear.classList.remove('visible');
      this.refreshList();
      searchInput?.focus();
    });

    // 3 & 5. Live tiles & Vista glass tiles
    this._bindLiveTileEvents();

    // 4. Flip All button
    const btnFlipAll = this.container.querySelector('#btn-flip-all');
    btnFlipAll?.addEventListener('click', () => {
      this.flipAll();
    });

    // 6. Holographic 3D parallax tilt & specular light sheen on tiles
    this._bindTileHolographicTilt();

    // 7. Metro letter header clicks (open fast jump)
    const letterHeaders = this.container.querySelectorAll('[data-jump-trigger]');
    letterHeaders.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.openFastJumpModal();
      });
    });

    // 8. Fast jump modal close
    const btnJumpClose = this.container.querySelector('#btn-jump-close');
    btnJumpClose?.addEventListener('click', () => {
      this.closeFastJumpModal();
    });

    // 9. Fast jump grid letters
    const jumpTiles = this.container.querySelectorAll('.metro-jump-tile.tile-active');
    jumpTiles.forEach((tile) => {
      tile.addEventListener('click', () => {
        const letter = tile.getAttribute('data-letter');
        this.jumpToLetter(letter);
      });
    });

    // 10. App list item launch clicks
    this._bindAppItemClicks();

    // 11. Vista Aero Glass Intention Capsule Widget
    const intentInput = this.container.querySelector('#drawer-intent-input');
    const intentAskBtn = this.container.querySelector('#btn-drawer-intent-ask');
    intentAskBtn?.addEventListener('click', () => {
      this.runIntentWidget(intentInput ? intentInput.value : '', '');
    });
    intentInput?.addEventListener('keydown', (e) => {
      if (e && e.key === 'Enter') {
        this.runIntentWidget(intentInput.value, '');
      }
    });
    const intentChips = this.container.querySelectorAll('.vista-intent-chip');
    intentChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const scenario = chip.getAttribute('data-intent-scenario') || '';
        this.runIntentWidget('', scenario);
      });
    });
    this._bindIntentOutcomeLaunch();
  }

  _bindIntentOutcomeLaunch() {
    if (!this.container) return;
    const launchBtn = this.container.querySelector('#btn-intent-launch-target');
    launchBtn?.addEventListener('click', () => {
      const pkg = launchBtn.getAttribute('data-target-pkg');
      if (pkg && typeof window !== 'undefined' && window.PravahNative?.launchApp) {
        window.PravahNative.launchApp(pkg);
      }
    });
  }

  _renderIntentWidgetSectionHtml() {
    const res = this.activeIntentResult || synthesizeIntentionOutcome('', 'flight');
    this.activeIntentResult = res;
    return `
      <section class="vista-intent-widget" id="vista-intent-widget">
        <div class="vista-aero-reflection" aria-hidden="true"></div>
        <div class="vista-intent-header">
          <span class="section-title">✦ INTENTION CAPSULE WIDGET</span>
          <span class="vista-intent-badge" id="vista-intent-badge">${res.badge}</span>
        </div>
        <div class="vista-intent-input-row">
          <input
            type="text"
            id="drawer-intent-input"
            class="vista-intent-input"
            placeholder="Ask anything or describe a goal..."
            value="${res.prompt}"
            autocomplete="off"
          />
          <button id="btn-drawer-intent-ask" class="vista-intent-ask-btn">Ask Pravah ✦</button>
        </div>
        <div class="vista-intent-chips">
          <button class="vista-intent-chip ${res.scenario === 'flight' ? 'active' : ''}" data-intent-scenario="flight">✈ Flight AI-202</button>
          <button class="vista-intent-chip ${res.scenario === 'camera_note' ? 'active' : ''}" data-intent-scenario="camera_note">📷 Photo &amp; Note</button>
          <button class="vista-intent-chip ${res.scenario === 'payment' ? 'active' : ''}" data-intent-scenario="payment">💳 Send ₹5,000</button>
          <button class="vista-intent-chip ${res.scenario === 'crypto' ? 'active' : ''}" data-intent-scenario="crypto">🪙 250 USDC</button>
          <button class="vista-intent-chip ${res.scenario === 'memory' ? 'active' : ''}" data-intent-scenario="memory">⚡ Optimize RAM</button>
          <button class="vista-intent-chip ${res.scenario === 'airgap' ? 'active' : ''}" data-intent-scenario="airgap">🛡️ Air-Gap</button>
        </div>
        <div class="vista-intent-outcome" id="vista-intent-outcome">
          ${this._renderIntentOutcomeHtml(res)}
        </div>
      </section>
    `;
  }

  _renderIntentOutcomeHtml(res) {
    return `
      <div class="vista-intent-dag-row">
        ${res.dagSteps.map(s => `<div class="vista-dag-step">${s}</div>`).join('')}
      </div>
      <div class="vista-intent-outcome-title">${res.headline}</div>
      <div class="vista-intent-outcome-desc">${res.summary}</div>
      <div class="vista-intent-outcome-footer">
        <span class="vista-intent-pills">${res.pills.join(' • ')}</span>
        <button id="btn-intent-launch-target" class="vista-intent-launch-btn" data-target-pkg="${res.targetPkg}">${res.launchLabel}</button>
      </div>
    `;
  }

  runIntentWidget(query = '', scenario = '') {
    const res = synthesizeIntentionOutcome(query, scenario);
    this.activeIntentResult = res;

    if (this.container) {
      const inputEl = this.container.querySelector('#drawer-intent-input');
      if (inputEl) inputEl.value = res.prompt;

      const badgeEl = this.container.querySelector('#vista-intent-badge');
      if (badgeEl) badgeEl.textContent = res.badge;

      const chips = this.container.querySelectorAll('.vista-intent-chip');
      chips.forEach((chip) => {
        chip.classList?.toggle('active', chip.getAttribute?.('data-intent-scenario') === res.scenario);
      });

      const outcomeEl = this.container.querySelector('#vista-intent-outcome');
      if (outcomeEl) {
        outcomeEl.innerHTML = this._renderIntentOutcomeHtml(res);
        this._bindIntentOutcomeLaunch();
      }
    }

    if (typeof window !== 'undefined' && window.PravahNative?.syncIntentWidget) {
      window.PravahNative.syncIntentWidget(res.prompt, `${res.headline} • ${res.pills.join(' • ')}`, res.badge);
    }

    return res;
  }

  /**
   * Bind click and flip handlers for telemetry live tiles and Vista Glass pinned app tiles.
   */
  _bindLiveTileEvents() {
    if (!this.container) return;

    const flipBtns = this.container.querySelectorAll('.tile-flip-btn');
    flipBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tileId = btn.getAttribute('data-tile');
        this.flipTile(tileId);
      });
    });

    const tiles = this.container.querySelectorAll('.live-tile');
    tiles.forEach((tile) => {
      tile.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.tile-flip-btn')) return;
        const tileId = tile.getAttribute ? tile.getAttribute('data-tile-id') : null;
        if (tileId) this.handleTileClick(tileId);
      });
    });

    const vistaTiles = this.container.querySelectorAll('.vista-glass-tile');
    vistaTiles.forEach((tile) => {
      tile.addEventListener('click', () => {
        const appId = tile.getAttribute('data-app-id');
        const pkg = tile.getAttribute('data-pkg');
        const app = this.apps.find(a => a.id === appId || (pkg && a.pkg === pkg));
        if (app) {
          this.launchApp(app, tile);
        } else if (pkg && typeof window !== 'undefined' && window.PravahNative?.launchApp) {
          window.PravahNative.launchApp(pkg);
        }
      });
    });
  }

  /**
   * Dynamic Holographic 3D Parallax Tilt with liquid specular sheen tracking.
   */
  _bindTileHolographicTilt() {
    if (!this.container) return;
    const tiles = this.container.querySelectorAll('.live-tile');
    if (!tiles || typeof tiles.forEach !== 'function') return;

    tiles.forEach((tile) => {
      if (!tile || !tile.addEventListener) return;

      const handleMove = (e) => {
        if (!tile.getBoundingClientRect) return;
        const rect = tile.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        // Subtle 3D tilt: ±8 deg
        const tiltX = ((y - 0.5) * -14).toFixed(2);
        const tiltY = ((x - 0.5) * 14).toFixed(2);
        const sheenX = (x * 100).toFixed(1) + '%';
        const sheenY = (y * 100).toFixed(1) + '%';

        if (tile.style && tile.style.setProperty) {
          tile.style.setProperty('--tilt-x', `${tiltX}deg`);
          tile.style.setProperty('--tilt-y', `${tiltY}deg`);
          tile.style.setProperty('--sheen-x', sheenX);
          tile.style.setProperty('--sheen-y', sheenY);
        }
      };

      const handleLeave = () => {
        if (tile.style && tile.style.setProperty) {
          tile.style.setProperty('--tilt-x', '0deg');
          tile.style.setProperty('--tilt-y', '0deg');
          tile.style.setProperty('--sheen-x', '50%');
          tile.style.setProperty('--sheen-y', '50%');
        }
      };

      tile.addEventListener('pointermove', handleMove);
      tile.addEventListener('pointerleave', handleLeave);
      tile.addEventListener('pointercancel', handleLeave);
    });
  }

  /**
   * Bind app item tap handlers with micro-bounce and glowing trail.
   */
  _bindAppItemClicks() {
    if (!this.container) return;
    const items = this.container.querySelectorAll('.metro-app-item');
    items.forEach((item) => {
      item.addEventListener('click', () => {
        const appId = item.getAttribute('data-app-id');
        const app = this.apps.find(a => a.id === appId);
        if (app) {
          this.launchApp(app, item);
        }
      });
    });
  }

  /**
   * Refreshes the Metro list section without re-rendering the whole drawer.
   */
  refreshList() {
    if (!this.container) return;
    const listWrap = this.container.querySelector('#metro-list-container');
    if (listWrap) {
      listWrap.innerHTML = this._renderMetroListHtml();
      this._bindAppItemClicks();

      // Re-bind letter headers
      const letterHeaders = listWrap.querySelectorAll('[data-jump-trigger]');
      letterHeaders.forEach((btn) => {
        btn.addEventListener('click', () => this.openFastJumpModal());
      });
    }

    const badge = this.container.querySelector('#apps-count-badge');
    if (badge) {
      const filtered = filterApps(this.apps, this.searchQuery);
      badge.textContent = `${filtered.length} Capabilit${filtered.length === 1 ? 'y' : 'ies'}`;
    }
  }

  /**
   * Launches an app according to its dual execution model:
   * 1. 'dag': Triggers a native PravahOS DAG scenario in the workspace.
   * 2. 'ephemeral': Launches into a zero-tax overlay window.
   */
  launchApp(app, triggerEl = null) {
    if (triggerEl && triggerEl.classList && triggerEl.classList.add) {
      triggerEl.classList.add('app-launch-bounce');
      setTimeout(() => triggerEl.classList.remove('app-launch-bounce'), 320);
    }

    try {
      haptics?.mediumSnap();
    } catch (_) {}

    if (this.onLaunchApp) {
      this.onLaunchApp(app, app.launchType);
    }

    if (app.launchType === 'native_apk' && app.pkg) {
      try {
        if (typeof window !== 'undefined' && window.PravahNative?.launchApp) {
          window.PravahNative.launchApp(app.pkg);
        }
      } catch (err) {
        console.error('Failed to launch native APK:', err);
      }
      return;
    }

    if (app.launchType === 'stock_app') {
      try {
        if (typeof window !== 'undefined' && window.getAppRunner) {
          window.getAppRunner().launch(app.id);
        }
      } catch (err) {
        console.error('Failed to launch stock app:', err);
      }
      this.collapse();
    } else if (app.launchType === 'ephemeral') {
      this.windowManager.openWindow(app);
      this.collapse();
    } else {
      // DAG card launch: collapse drawer so user sees DAG execution in shell workspace
      this.collapse();
    }
  }

  /**
   * Handles tap on Live Tiles.
   */
  handleTileClick(tileId) {
    const isNativeHost = typeof window !== 'undefined' && Boolean(window.PravahNative);
    switch (tileId) {
      case TileId.SPOTIFY: {
        const nativeMedia = this.apps.find(a => a.pkg === 'com.google.android.apps.youtube.music' || a.pkg === 'com.google.android.youtube' || a.pkg === 'com.spotify.music');
        const app = nativeMedia || this.apps.find(a => a.id === 'spotify_audio');
        if (app) this.launchApp(app);
        else if (isNativeHost) this.flipTile(tileId);
        break;
      }
      case TileId.FLIGHT: {
        if (isNativeHost) {
          this.flipTile(tileId);
          break;
        }
        if (this.onLaunchApp) {
          this.onLaunchApp({ id: 'flight', name: 'Flight AI-202 Tracker', launchType: 'dag', scenario: 'flight' }, 'dag');
        }
        this.collapse();
        break;
      }
      case TileId.BATTERY: {
        const nativePower = this.apps.find(a => a.pkg === 'org.pravah.vault' || a.pkg === 'com.android.settings');
        const app = nativePower || this.apps.find(a => a.id === 'memory_compactor');
        if (app) this.launchApp(app);
        else if (isNativeHost) this.flipTile(tileId);
        break;
      }
      case TileId.AIRGAP: {
        const nativeShield = this.apps.find(a => a.pkg === 'org.pravah.shield');
        const app = nativeShield || this.apps.find(a => a.id === 'airgap_app');
        if (app) this.launchApp(app);
        else if (isNativeHost) this.flipTile(tileId);
        break;
      }
      default:
        this.flipTile(tileId);
    }
  }

  /**
   * 3D Card Flip for a single tile.
   */
  flipTile(tileId) {
    const tile = this.liveTiles[tileId];
    if (!tile) return;

    tile.flipped = !tile.flipped;
    if (this.container) {
      const el = this.container.querySelector(`#tile-${tileId}`);
      if (el) {
        el.classList.toggle('flipped', tile.flipped);
      }
    }

    try {
      haptics?.lightTap();
    } catch (_) {}
  }

  /**
   * Flips all 4 live tiles simultaneously.
   */
  flipAll() {
    let anyUnflipped = false;
    for (const key of Object.keys(this.liveTiles)) {
      if (!this.liveTiles[key].flipped) {
        anyUnflipped = true;
        break;
      }
    }

    for (const key of Object.keys(this.liveTiles)) {
      this.liveTiles[key].flipped = anyUnflipped;
      if (this.container) {
        const el = this.container.querySelector(`#tile-${key}`);
        if (el) el.classList.toggle('flipped', anyUnflipped);
      }
    }

    try {
      haptics?.mediumSnap();
    } catch (_) {}
  }

  /**
   * Opens the Metro Alphabet fast-jump picker modal.
   */
  openFastJumpModal() {
    this.activeFastJump = true;
    if (this.container) {
      const modal = this.container.querySelector('#metro-jump-modal');
      modal?.classList.add('visible');
    }
    try {
      haptics?.lightTap();
    } catch (_) {}
  }

  /**
   * Closes the Metro fast-jump picker modal.
   */
  closeFastJumpModal() {
    this.activeFastJump = false;
    if (this.container) {
      const modal = this.container.querySelector('#metro-jump-modal');
      modal?.classList.remove('visible');
    }
  }

  /**
   * Scrolls directly to the chosen alphabetical letter section.
   */
  jumpToLetter(letter) {
    this.closeFastJumpModal();
    if (!this.container) return;

    const section = this.container.querySelector(`#section-letter-${letter}`);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      section.classList.add('jump-highlight');
      setTimeout(() => section.classList.remove('jump-highlight'), 1200);
      try {
        haptics?.mediumSnap();
      } catch (_) {}
    }
  }

  /**
   * Dynamic live tickers:
   * - Real-time animated equalizer bars for Spotify
   * - Real-time second-by-second countdown for Flight AI-202
   * - Periodic 3D tile flipping hint
   */
  startLiveTickers() {
    // 1. Equalizer bars ticker
    this.eqTimer = setInterval(() => {
      const bars = generateEqualizerBars(5);
      this.liveTiles[TileId.SPOTIFY].front.eqBars = bars;

      if (this.container) {
        const wrap = this.container.querySelector('#spotify-eq-bars');
        if (wrap) {
          const els = wrap.querySelectorAll('.eq-bar');
          bars.forEach((val, idx) => {
            if (els[idx]) els[idx].style.height = `${Math.round(val * 100)}%`;
          });
        }
      }
    }, 450);

    // 2. Flight countdown ticker
    this.countdownTimer = setInterval(() => {
      const flight = this.liveTiles[TileId.FLIGHT];
      if (flight && flight.front.countdownSec > 0) {
        flight.front.countdownSec -= 1;
        if (this.container) {
          const label = this.container.querySelector('#flight-countdown-val');
          if (label) label.textContent = formatCountdown(flight.front.countdownSec);
        }
      }
    }, 1000);

    // 3. Live Android & pravahd telemetry ticker
    if (typeof window !== 'undefined' && window.PravahNative) {
      this.nativeTelemetryTimer = setInterval(() => {
        this.syncNativeTelemetry();
      }, 2500);
    }
  }

  /**
   * Stop tickers (for teardown/cleanup).
   */
  stopLiveTickers() {
    if (this.eqTimer) clearInterval(this.eqTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.flipTimer) clearInterval(this.flipTimer);
    if (this.nativeTelemetryTimer) clearInterval(this.nativeTelemetryTimer);
  }

  /**
   * Sync telemetry from shell or emulator into Live Tiles.
   */
  updateTelemetry(telemetry = {}) {
    if (telemetry.battery !== undefined) {
      const b = this.liveTiles[TileId.BATTERY];
      b.front.level = telemetry.battery.level ?? telemetry.battery;
      b.front.charging = Boolean(telemetry.battery.charging);
      if (this.container) {
        const fill = this.container.querySelector('#battery-fuel-fill');
        const pill = this.container.querySelector('#battery-pct-pill');
        if (fill) fill.style.width = `${b.front.level}%`;
        if (pill) pill.textContent = `${b.front.level}%`;
      }
    }

    if (telemetry.airgap !== undefined) {
      const a = this.liveTiles[TileId.AIRGAP];
      a.front.status = telemetry.airgap ? 'SECURED OFFLINE' : 'ONLINE (EGRESS OPEN)';
      if (this.container) {
        const statEl = this.container.querySelector('.airgap-secure-indicator span');
        if (statEl) statEl.textContent = a.front.status;
      }
    }
  }

  // ==========================================================================
  // Drawer State Machine & Gestures
  // ==========================================================================

  expand() {
    if (this.state === DrawerState.EXPANDED) return;
    this.state = DrawerState.EXPANDED;
    if (this.container) {
      this.container.classList.add('expanded');
      this.container.classList.remove('collapsed');
      this.container.style.transform = 'translateY(0%)';
    }
    if (this.onStateChange) this.onStateChange(this.state);
    try {
      haptics?.mediumSnap();
    } catch (_) {}
  }

  collapse() {
    if (this.state === DrawerState.COLLAPSED) return;
    this.state = DrawerState.COLLAPSED;
    this.closeFastJumpModal();
    if (this.container) {
      this.container.classList.remove('expanded');
      this.container.classList.add('collapsed');
      this.container.style.transform = 'translateY(100%)';
    }
    if (this.onStateChange) this.onStateChange(this.state);
    try {
      haptics?.lightTap();
    } catch (_) {}
  }

  /**
   * Explicitly dismisses the Metro drawer back to Pixel Home (or collapses in web shell).
   */
  dismissToHome() {
    this.collapse();
    if (typeof window !== 'undefined' && window.PravahNative?.closeMetroDrawer) {
      window.PravahNative.closeMetroDrawer();
    }
  }

  toggle() {
    if (this.state === DrawerState.EXPANDED) {
      this.collapse();
    } else {
      this.expand();
    }
  }

  /**
   * Bind touch and pointer drag gestures on the drawer drag header.
   */
  bindGestures() {
    if (!this.container) return;
    const header = this.container.querySelector('#drawer-drag-header');
    if (!header) return;

    const onPointerDown = (e) => {
      this.isDragging = true;
      this.startY = e.clientY;
      this.currentY = e.clientY;
      this.velocityTracker.reset();
      this.velocityTracker.addSample(this.currentY);
      header.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!this.isDragging) return;
      this.currentY = e.clientY;
      this.velocityTracker.addSample(this.currentY);
      const deltaY = Math.max(0, this.currentY - this.startY);

      // Rubberband or slide downward
      if (this.state === DrawerState.EXPANDED) {
        this.container.style.transform = `translateY(${deltaY}px)`;
      }
    };

    const onPointerUp = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      header.releasePointerCapture?.(e.pointerId);

      const deltaY = this.currentY - this.startY;
      const velocity = this.velocityTracker.getVelocity();

      // Dismiss condition: pulled down > 120px or fling velocity > 500px/s
      if (deltaY > 120 || velocity > 500) {
        this.dismissToHome();
      } else {
        this.expand();
      }
    };

    header.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('pointermove', onPointerMove);
    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
  }
}

// Window global registration & resilient self-mounting
if (typeof window !== 'undefined') {
  window.PravahDrawer = {
    DrawerState,
    TileId,
    DEFAULT_LIVE_TILES,
    BUILTIN_APPS,
    groupAppsAlphabetically,
    filterApps,
    formatCountdown,
    generateEqualizerBars,
    EphemeralWindowManager,
    LivingDrawer
  };

  // Immediate or deferred self-mounting to guarantee container is populated
  const autoMountLivingDrawer = () => {
    const el = document.getElementById('living-drawer');
    if (el && !window.livingDrawer) {
      window.livingDrawer = new LivingDrawer({ container: el });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMountLivingDrawer);
  } else {
    autoMountLivingDrawer();
  }
}
