// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file haptics.js
 * PravahOS Synthesized Tactile Haptic Feedback Engine.
 *
 * Implements Apple/Pixel-grade micro-acoustic tactile transients using the
 * Web Audio API combined with the Vibration API. Generates tiny resonant
 * frequency pulses to simulate physical tactile clicks on soft keyboard
 * keypresses, card snaps, dynamic island morphs, and security policy alerts.
 */

export const HapticType = {
  LIGHT_TAP: 'LIGHT_TAP',
  MEDIUM_SNAP: 'MEDIUM_SNAP',
  HEAVY_WARNING: 'HEAVY_WARNING',
  SELECTION_TICK: 'SELECTION_TICK',
  SUCCESS_CHIME: 'SUCCESS_CHIME'
};

export const HapticPreset = {
  [HapticType.LIGHT_TAP]: {
    name: 'Light Tap',
    frequency: 220,
    transientFreq: 2400,
    durationMs: 7,
    decayMs: 6,
    gain: 0.22,
    vibrationMs: 6,
    filterType: 'bandpass',
    qFactor: 4
  },
  [HapticType.MEDIUM_SNAP]: {
    name: 'Medium Snap',
    frequency: 150,
    transientFreq: 980,
    durationMs: 16,
    decayMs: 14,
    gain: 0.35,
    vibrationMs: 14,
    filterType: 'bandpass',
    qFactor: 3
  },
  [HapticType.HEAVY_WARNING]: {
    name: 'Heavy Warning',
    frequency: 88,
    transientFreq: 176,
    durationMs: 45,
    decayMs: 38,
    gain: 0.55,
    vibrationMs: [20, 20, 30],
    filterType: 'lowpass',
    qFactor: 2
  },
  [HapticType.SELECTION_TICK]: {
    name: 'Selection Tick',
    frequency: 320,
    transientFreq: 1800,
    durationMs: 4,
    decayMs: 4,
    gain: 0.14,
    vibrationMs: 4,
    filterType: 'bandpass',
    qFactor: 6
  },
  [HapticType.SUCCESS_CHIME]: {
    name: 'Success Chime',
    frequency: 523.25, // C5
    transientFreq: 880.0, // A5 (glides up)
    durationMs: 45,
    decayMs: 40,
    gain: 0.28,
    vibrationMs: [10, 15, 20],
    filterType: 'bandpass',
    qFactor: 2
  }
};

/**
 * Synthesizes acoustic and mechanical tactile feedback.
 */
export class HapticEngine {
  constructor(options = {}) {
    this.audioCtx = null;
    this.isMuted = options.muted ?? false;
    this.masterVolume = Math.max(0, Math.min(1, options.volume ?? 1.0));
    this.history = [];
    this.maxHistory = 50;

    // Auto-bind user interaction listeners if running in a browser
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const unlockAudio = () => {
        this.ensureContext();
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      };
      window.addEventListener('pointerdown', unlockAudio, { passive: true, once: true });
      window.addEventListener('keydown', unlockAudio, { passive: true, once: true });
    }
  }

  /**
   * Lazily initialize or resume AudioContext.
   */
  ensureContext() {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    }

    if (typeof window !== 'undefined') {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        try {
          this.audioCtx = new AudioCtxClass();
          if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(() => {});
          }
        } catch (_) {
          // AudioContext blocked or unavailable
        }
      }
    }
    return this.audioCtx;
  }

  /**
   * Trigger physical vibration via navigator.vibrate if available.
   * @param {number|number[]} pattern
   */
  triggerVibration(pattern) {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(pattern);
      } catch (_) {}
    }
  }

  /**
   * Synthesize a micro-acoustic tactile impulse using Web Audio API nodes.
   * @param {string} type - HapticType key
   * @param {Object} [override] - Optional override parameters
   * @returns {boolean} Whether synthesis was dispatched
   */
  trigger(type, override = {}) {
    const preset = HapticPreset[type] || HapticPreset[HapticType.LIGHT_TAP];
    const duration = (override.durationMs ?? preset.durationMs) / 1000;
    const baseFreq = override.frequency ?? preset.frequency;
    const transFreq = override.transientFreq ?? preset.transientFreq;
    const gainLevel = (override.gain ?? preset.gain) * this.masterVolume;
    const vib = override.vibrationMs ?? preset.vibrationMs;

    // Record telemetry in history (useful for automated test verification)
    const eventRecord = {
      type,
      timestamp: Date.now(),
      frequency: baseFreq,
      transientFreq: transFreq,
      durationMs: duration * 1000,
      gain: gainLevel,
      muted: this.isMuted
    };

    this.history.push(eventRecord);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    if (this.isMuted) {
      return false;
    }

    // 1. Mechanical motor vibration
    this.triggerVibration(vib);

    // 2. Web Audio acoustic synthesis
    const ctx = this.ensureContext();
    if (!ctx) {
      return true; // Still considered triggered via fallback
    }

    try {
      const now = ctx.currentTime;

      // Master gain node with exponential decay
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(gainLevel, now + 0.001);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      // Resonant shaping filter
      const filter = ctx.createBiquadFilter();
      filter.type = preset.filterType;
      filter.frequency.setValueAtTime(transFreq, now);
      filter.Q.setValueAtTime(preset.qFactor, now);

      // Primary tactile oscillator
      const osc = ctx.createOscillator();
      osc.type = type === HapticType.HEAVY_WARNING ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);

      // Special handling for success chime pitch glide
      if (type === HapticType.SUCCESS_CHIME) {
        osc.frequency.exponentialRampToValueAtTime(transFreq, now + duration);
      } else if (type === HapticType.LIGHT_TAP || type === HapticType.MEDIUM_SNAP) {
        // Subtle downward pitch sweep simulating mechanical snap release
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, baseFreq * 0.65), now + duration);
      }

      // High transient click impulse for mechanical actuation snap
      const clickBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.003), ctx.sampleRate);
      const clickData = clickBuffer.getChannelData(0);
      for (let i = 0; i < clickData.length; i++) {
        // High-frequency burst decaying to 0
        clickData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (clickData.length * 0.3));
      }
      const clickSource = ctx.createBufferSource();
      clickSource.buffer = clickBuffer;

      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(gainLevel * 0.4, now);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.003);

      // Connect graph: osc -> filter -> gainNode -> destination
      osc.connect(filter);
      filter.connect(gainNode);

      // click -> gainNode -> destination
      clickSource.connect(clickGain);
      clickGain.connect(gainNode);

      gainNode.connect(ctx.destination);

      // Start and schedule stop
      osc.start(now);
      clickSource.start(now);

      osc.stop(now + duration + 0.01);
      clickSource.stop(now + 0.005);

      // Cleanup nodes after playing
      setTimeout(() => {
        try {
          osc.disconnect();
          filter.disconnect();
          gainNode.disconnect();
          clickSource.disconnect();
          clickGain.disconnect();
        } catch (_) {}
      }, (duration + 0.05) * 1000);

      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Convenience helpers for specific haptic feedback types.
   */
  lightTap(override) {
    return this.trigger(HapticType.LIGHT_TAP, override);
  }

  mediumSnap(override) {
    return this.trigger(HapticType.MEDIUM_SNAP, override);
  }

  heavyWarning(override) {
    return this.trigger(HapticType.HEAVY_WARNING, override);
  }

  selectionTick(override) {
    return this.trigger(HapticType.SELECTION_TICK, override);
  }

  successChime(override) {
    return this.trigger(HapticType.SUCCESS_CHIME, override);
  }

  /**
   * Play a sequential rhythm pattern of haptic clicks.
   * @param {Array<{ type: string, delayMs: number }>} steps
   */
  async playPattern(steps) {
    if (!Array.isArray(steps) || this.isMuted) return;
    for (const step of steps) {
      if (step.delayMs && step.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, step.delayMs));
      }
      this.trigger(step.type || HapticType.LIGHT_TAP);
    }
  }

  setMuted(muted) {
    this.isMuted = !!muted;
  }

  getMuted() {
    return this.isMuted;
  }

  setVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(1, vol));
  }

  getVolume() {
    return this.masterVolume;
  }

  getLastEvent() {
    return this.history[this.history.length - 1] || null;
  }

  clearHistory() {
    this.history = [];
  }
}

// Global default singleton instance
export const haptics = new HapticEngine();

// Window exposure for browser scripts
if (typeof window !== 'undefined') {
  window.PravahHaptics = {
    HapticType,
    HapticPreset,
    HapticEngine,
    haptics
  };
}
