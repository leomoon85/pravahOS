// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file voice.js
 * PravahOS Voice Dictation Pipeline & Real-Time Animated Waveform Visualizer.
 * Provides speech-to-text state machine, simulated air-gapped neural Whisper
 * dictation streaming, and high-DPI canvas audio waveform spectrogram.
 */

export const VoiceDictationState = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  TRANSCRIBING: 'TRANSCRIBING',
  COMMITTED: 'COMMITTED',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR'
};

/** Pre-indexed natural voice scenarios for air-gapped on-device neural transcription */
export const VOICE_CORPUS_PRESETS = [
  'Check flight AI-202 and set reminder 2 hours before departure',
  'Send ₹5,000 to Alice from verified account for dinner',
  'Compact secure memory and flush temporary neural cache',
  'Extract receipt text and file expense record with privacy redaction',
  'Schedule meeting with Security Council tomorrow at 10 AM',
  'Show cryptographic audit trail for previous capability execution'
];

/**
 * VoiceDictationEngine
 * Deterministic speech-to-text state machine and audio signal generator.
 */
export class VoiceDictationEngine {
  constructor(options = {}) {
    this.state = VoiceDictationState.IDLE;
    this.targetInput = options.targetInput || null;
    this.transcribedText = '';
    this.targetPreset = options.preset || null;
    this.onStateChange = options.onStateChange || (() => {});
    this.onTranscription = options.onTranscription || (() => {});
    this.onAudioFrame = options.onAudioFrame || (() => {});
    this.onCommit = options.onCommit || (() => {});
    this.onError = options.onError || (() => {});

    this.timer = null;
    this.audioInterval = null;
    this.tokenIndex = 0;
    this.tokens = [];
    this.frequencyBins = new Uint8Array(16);
    this.amplitude = 0;
    this.rmsDb = -60;
  }

  setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    this.onStateChange(this.state, this.transcribedText);
  }

  /**
   * Start dictation session
   * @param {string} [presetText] Optional preset phrase to transcribe
   */
  start(presetText) {
    if (this.state === VoiceDictationState.LISTENING || this.state === VoiceDictationState.TRANSCRIBING) {
      return;
    }

    const chosenText = presetText || this.targetPreset || 
      VOICE_CORPUS_PRESETS[Math.floor(Math.random() * VOICE_CORPUS_PRESETS.length)];
    
    this.tokens = chosenText.split(/\s+/);
    this.tokenIndex = 0;
    this.transcribedText = '';
    this.setState(VoiceDictationState.LISTENING);

    // Start synthetic or simulated audio frequency modulation
    this.startAudioSignalGeneration();

    // Begin progressive transcription tokens after short ambient delay (250ms)
    this.timer = setTimeout(() => {
      this.streamTokens();
    }, 250);
  }

  startAudioSignalGeneration() {
    this.stopAudioSignalGeneration();
    let tick = 0;

    const generateSample = () => {
      tick++;
      // Modulate frequency bins with speech-like harmonics
      const baseEnergy = (this.state === VoiceDictationState.LISTENING || this.state === VoiceDictationState.TRANSCRIBING)
        ? 0.5 + 0.45 * Math.sin(tick * 0.28) * Math.cos(tick * 0.12)
        : 0.05;

      this.amplitude = Math.max(0, Math.min(1.0, baseEnergy + (Math.random() * 0.2 - 0.1)));
      this.rmsDb = Math.round(-45 + this.amplitude * 40); // -45dB to -5dB

      for (let i = 0; i < 16; i++) {
        const harmonic = Math.sin(tick * 0.35 + i * 0.4) * 0.5 + 0.5;
        const jitter = Math.random() * 0.25;
        const val = Math.floor(Math.max(0, Math.min(255, (baseEnergy * harmonic + jitter) * 255)));
        this.frequencyBins[i] = val;
      }

      this.onAudioFrame({
        amplitude: this.amplitude,
        rmsDb: this.rmsDb,
        frequencyBins: Array.from(this.frequencyBins)
      });
    };

    if (typeof setInterval !== 'undefined') {
      this.audioInterval = setInterval(generateSample, 40);
    }
  }

  stopAudioSignalGeneration() {
    if (this.audioInterval) {
      clearInterval(this.audioInterval);
      this.audioInterval = null;
    }
  }

  streamTokens() {
    if (this.state !== VoiceDictationState.LISTENING && this.state !== VoiceDictationState.TRANSCRIBING) {
      return;
    }

    this.setState(VoiceDictationState.TRANSCRIBING);

    const emitNextToken = () => {
      if (this.state !== VoiceDictationState.TRANSCRIBING) return;

      if (this.tokenIndex < this.tokens.length) {
        const nextWord = this.tokens[this.tokenIndex];
        this.transcribedText = this.tokenIndex === 0 
          ? nextWord 
          : `${this.transcribedText} ${nextWord}`;
        this.tokenIndex++;

        if (this.targetInput) {
          this.targetInput.value = this.transcribedText;
        }

        this.onTranscription(this.transcribedText, false);

        // Natural cadence spacing (120ms - 220ms per token)
        const cadenceMs = 120 + Math.floor(Math.random() * 90);
        this.timer = setTimeout(emitNextToken, cadenceMs);
      } else {
        // Complete transcription stream
        this.onTranscription(this.transcribedText, true);
        this.timer = setTimeout(() => {
          this.commit();
        }, 500);
      }
    };

    emitNextToken();
  }

  commit() {
    this.stopAudioSignalGeneration();
    if (this.timer) clearTimeout(this.timer);

    const finalResult = this.transcribedText.trim();
    this.setState(VoiceDictationState.COMMITTED);
    this.onCommit(finalResult);
    return finalResult;
  }

  cancel() {
    this.stopAudioSignalGeneration();
    if (this.timer) clearTimeout(this.timer);
    this.transcribedText = '';
    this.setState(VoiceDictationState.CANCELLED);
  }

  reset() {
    this.stopAudioSignalGeneration();
    if (this.timer) clearTimeout(this.timer);
    this.transcribedText = '';
    this.tokenIndex = 0;
    this.amplitude = 0;
    this.setState(VoiceDictationState.IDLE);
  }
}

/**
 * WaveformVisualizer
 * High-performance audio waveform spectrogram renderer for HTML5 Canvas.
 */
export class WaveformVisualizer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    this.barCount = options.barCount || 24;
    this.barWidth = options.barWidth || 4;
    this.barGap = options.barGap || 3;
    this.colorStart = options.colorStart || '#00f0ff';
    this.colorEnd = options.colorEnd || '#ec4899';
    this.colorGlow = options.colorGlow || 'rgba(0, 240, 255, 0.4)';
    this.isAnimating = false;
    this.animId = null;
    this.bins = new Array(this.barCount).fill(10);
    this.targetBins = new Array(this.barCount).fill(10);
    this.pulsePhase = 0;
  }

  updateData(sample) {
    if (!sample) return;
    const { frequencyBins, amplitude } = sample;
    const amp = amplitude ?? 0.2;

    for (let i = 0; i < this.barCount; i++) {
      const srcIdx = frequencyBins ? Math.floor((i / this.barCount) * frequencyBins.length) : 0;
      const rawVal = frequencyBins ? frequencyBins[srcIdx] / 255 : amp;
      // Mirror / bell curve weighting towards center
      const centerFactor = 1 - Math.abs(i - (this.barCount / 2)) / (this.barCount / 2);
      const shaped = Math.max(0.08, rawVal * (0.4 + 0.6 * centerFactor));
      this.targetBins[i] = shaped;
    }
  }

  start() {
    if (this.isAnimating || !this.ctx) return;
    this.isAnimating = true;
    this.loop();
  }

  stop() {
    this.isAnimating = false;
    if (this.animId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    this.clear();
  }

  clear() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  loop() {
    if (!this.isAnimating) return;
    this.renderFrame();
    if (typeof requestAnimationFrame !== 'undefined') {
      this.animId = requestAnimationFrame(() => this.loop());
    }
  }

  renderFrame() {
    if (!this.ctx || !this.canvas) return;
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);

    this.pulsePhase += 0.08;
    const totalBarsWidth = this.barCount * this.barWidth + (this.barCount - 1) * this.barGap;
    const startX = Math.max(0, (width - totalBarsWidth) / 2);
    const centerY = height / 2;

    // Create linear gradient
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, this.colorStart);
    grad.addColorStop(0.5, '#a855f7');
    grad.addColorStop(1, this.colorEnd);

    ctx.fillStyle = grad;
    ctx.shadowBlur = 12;
    ctx.shadowColor = this.colorGlow;

    for (let i = 0; i < this.barCount; i++) {
      // Smooth interpolation towards target
      this.bins[i] += (this.targetBins[i] - this.bins[i]) * 0.25;

      const dynamicWave = Math.sin(this.pulsePhase + i * 0.3) * 0.15;
      const val = Math.max(0.05, Math.min(1.0, this.bins[i] + dynamicWave));
      const barHeight = Math.max(4, val * (height * 0.85));

      const x = startX + i * (this.barWidth + this.barGap);
      const y = centerY - barHeight / 2;
      const radius = this.barWidth / 2;

      // Rounded bar
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, this.barWidth, barHeight, radius);
      } else {
        ctx.rect(x, y, this.barWidth, barHeight);
      }
      ctx.fill();
    }

    ctx.shadowBlur = 0;
  }
}

/**
 * VoiceDictationOverlay
 * Integrated voice capture modal with real-time waveform pulse visualizer.
 */
export class VoiceDictationOverlay {
  constructor(options = {}) {
    this.container = null;
    this.visualizer = null;
    this.engine = new VoiceDictationEngine({
      targetInput: options.targetInput,
      onStateChange: (state, text) => this.handleStateChange(state, text),
      onTranscription: (text, done) => this.handleTranscription(text, done),
      onAudioFrame: (frame) => this.handleAudioFrame(frame),
      onCommit: (text) => {
        if (options.onCommit) options.onCommit(text);
        this.hide();
      }
    });

    this.onCommitCallback = options.onCommit || null;
    this.onDismissCallback = options.onDismiss || null;
    this.targetInput = options.targetInput || null;
    this.isVisible = false;
  }

  mount(parent = document.body) {
    if (this.container || typeof document === 'undefined') return;

    this.container = document.createElement('div');
    this.container.className = 'pravah-voice-overlay';
    this.container.innerHTML = `
      <div class="voice-card">
        <div class="voice-header">
          <div class="voice-status-badge">
            <span class="voice-pulse-dot"></span>
            <span id="voice-state-text" class="voice-state-label">AIR-GAP NEURAL WHISPER</span>
          </div>
          <button class="voice-close-btn" id="voice-btn-close" title="Cancel voice input">✕</button>
        </div>

        <div class="voice-visualizer-container">
          <canvas class="voice-waveform-canvas" width="340" height="96"></canvas>
          <div class="voice-db-indicator">
            <span id="voice-db-val">-24 dB</span>
          </div>
        </div>

        <div class="voice-transcription-box">
          <p id="voice-transcript-text" class="voice-transcript-placeholder">
            Listening for intent... speak clearly...
          </p>
        </div>

        <div class="voice-actions">
          <button class="btn-voice-cancel" id="voice-btn-cancel">Cancel</button>
          <button class="btn-voice-commit" id="voice-btn-commit">Done & Submit</button>
        </div>
      </div>
    `;

    parent.appendChild(this.container);

    const canvas = this.container.querySelector('.voice-waveform-canvas');
    if (canvas) {
      this.visualizer = new WaveformVisualizer(canvas, {
        barCount: 28,
        barWidth: 5,
        barGap: 4
      });
    }

    const closeBtn = this.container.querySelector('#voice-btn-close');
    const cancelBtn = this.container.querySelector('#voice-btn-cancel');
    const commitBtn = this.container.querySelector('#voice-btn-commit');

    closeBtn?.addEventListener('click', () => this.cancel());
    cancelBtn?.addEventListener('click', () => this.cancel());
    commitBtn?.addEventListener('click', () => this.commit());

    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.cancel();
      }
    });
  }

  show(presetText) {
    if (!this.container) this.mount();
    if (!this.container) return;

    this.container.classList.add('active');
    this.isVisible = true;

    if (this.visualizer) {
      this.visualizer.start();
    }

    this.engine.start(presetText);
  }

  hide() {
    if (!this.container) return;
    this.container.classList.remove('active');
    this.isVisible = false;
    if (this.visualizer) {
      this.visualizer.stop();
    }
  }

  cancel() {
    this.engine.cancel();
    this.hide();
    if (this.onDismissCallback) this.onDismissCallback();
  }

  commit() {
    const text = this.engine.commit();
    if (this.targetInput && text) {
      this.targetInput.value = text;
    }
    this.hide();
  }

  handleStateChange(state, text) {
    if (!this.container) return;
    const label = this.container.querySelector('#voice-state-text');
    if (label) {
      switch (state) {
        case VoiceDictationState.LISTENING:
          label.textContent = 'LISTENING...';
          break;
        case VoiceDictationState.TRANSCRIBING:
          label.textContent = 'TRANSCRIBING INTENT...';
          break;
        case VoiceDictationState.COMMITTED:
          label.textContent = 'TRANSCRIBED';
          break;
        case VoiceDictationState.CANCELLED:
          label.textContent = 'CANCELLED';
          break;
        default:
          label.textContent = 'AIR-GAP NEURAL WHISPER';
      }
    }
  }

  handleTranscription(text, done) {
    if (!this.container) return;
    const transcriptEl = this.container.querySelector('#voice-transcript-text');
    if (transcriptEl) {
      if (text) {
        transcriptEl.textContent = text;
        transcriptEl.classList.remove('voice-transcript-placeholder');
      } else {
        transcriptEl.textContent = 'Listening for intent... speak clearly...';
        transcriptEl.classList.add('voice-transcript-placeholder');
      }
    }
  }

  handleAudioFrame(frame) {
    if (this.visualizer) {
      this.visualizer.updateData(frame);
    }
    if (this.container) {
      const dbVal = this.container.querySelector('#voice-db-val');
      if (dbVal && frame.rmsDb !== undefined) {
        dbVal.textContent = `${frame.rmsDb} dB`;
      }
    }
  }
}

// Global window registration for vanilla HTML script loading
if (typeof window !== 'undefined') {
  window.PravahVoice = {
    VoiceDictationState,
    VOICE_CORPUS_PRESETS,
    VoiceDictationEngine,
    WaveformVisualizer,
    VoiceDictationOverlay
  };
}
