// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file tour.js
 * PravahOS Interactive Guided Onboarding Tour Subsystem.
 *
 * Implements:
 * 1. Multi-Step Spotlight Tour Engine with fluid animations and spring physics.
 * 2. 6 Core Consumer Tour Steps:
 *    - Step 1: Welcome to PravahOS (Post-app paradigm, intent-native computing, liquid glass)
 *    - Step 2: The Intent Capsule (Zero-prompt cognitive empathy, voice dictation, ask anything)
 *    - Step 3: Living Drawer & Neo-Metro Bento Grid (Live tiles, 3D flip inspection, A-Z catalog)
 *    - Step 4: Personalize Your Aesthetic (5 luxury wallpapers & dynamic color themes)
 *    - Step 5: Foldable & Hinge Modes (Book 4:3, laptop flex 90°, cover screen adaptivity)
 *    - Step 6: Physical Air-Gap & Hardware Trust Shield (Zero-cloud leak privacy killswitch)
 * 3. Dynamic spotlight cutout ring focusing attention on real UI target elements.
 * 4. Frosted glass tooltip cards with step dots, haptic ticks, and interactive micro-widgets.
 * 5. LocalStorage persistence (auto-launch on first visit, re-triggerable anytime).
 */

export const TourStepId = {
  WELCOME: 'welcome',
  INTENT: 'intent',
  DRAWER: 'drawer',
  THEMES: 'themes',
  FOLDABLE: 'foldable',
  AIRGAP: 'airgap'
};

export const TOUR_STORAGE_KEY = 'pravah_tour_completed';

/**
 * 6 Interactive Consumer Onboarding Tour Steps
 */
export const TOUR_STEPS = [
  {
    id: TourStepId.WELCOME,
    badge: '✦ WELCOME TO PRAVAHOS',
    glyph: '✨',
    title: 'Welcome to PravahOS',
    subtitle: 'The Post-App Operating System',
    target: '#desktop-hero-glance',
    position: 'bottom',
    description: 'PravahOS dissolves traditional application silos into fluid, intent-native capabilities. Enjoy luxury liquid glass optics, deterministic microkernel security, and zero-prompt ambient empathy.',
    interactivePill: 'Ambient Liquid Glass • Microkernel Foundation',
    actionText: 'Begin Experience →'
  },
  {
    id: TourStepId.INTENT,
    badge: '🧠 ZERO-PROMPT INTELLIGENCE',
    glyph: '✦',
    title: 'The Intent Capsule',
    subtitle: 'Spotlight Bar & Cognitive Empathy',
    target: '#intent-card',
    position: 'top',
    description: 'Say goodbye to app hunting and prompt gymnastics. Speak or type your real goals in natural language—from flight radar tracking to secure UPI remittances. Pravah synthesizes on-device capabilities securely.',
    interactivePill: 'Neural Voice Dictation • Natural Language DAGs',
    actionText: 'Next: Living Drawer →'
  },
  {
    id: TourStepId.DRAWER,
    badge: '⊞ LIVING SURFACE',
    glyph: '⊞',
    title: 'Living Drawer & Neo-Metro Bento Grid',
    subtitle: 'Capabilities Instead of Static Icons',
    target: '#dock-btn-drawer',
    position: 'top',
    description: 'Swipe up or tap the dock button to summon the Living Drawer. Experience real-time glanceable tiles that flip in 3D to reveal live telemetry—including flight radars, direct DMA Spotify playback, and the fast-jump alphabetical Metro catalog.',
    interactivePill: '3D Flipping Tiles • Zero-Tax Capability Store',
    actionText: 'Next: Personalize →',
    onEnter: () => {
      // Temporarily expand drawer if available
      try {
        if (typeof window !== 'undefined' && window.livingDrawer && typeof window.livingDrawer.expand === 'function') {
          window.livingDrawer.expand();
        }
      } catch (_) {}
    },
    onLeave: () => {
      try {
        if (typeof window !== 'undefined' && window.livingDrawer && typeof window.livingDrawer.collapse === 'function') {
          window.livingDrawer.collapse();
        }
      } catch (_) {}
    }
  },
  {
    id: TourStepId.THEMES,
    badge: '🎨 LUXURY AESTHETICS',
    glyph: '🎨',
    title: 'Personalize Your Aesthetic',
    subtitle: '5 Handcrafted Wallpapers & Liquid Themes',
    target: '#btn-theme-switcher',
    position: 'bottom',
    description: 'Tailor PravahOS to your aesthetic mood. Choose between Celestial Twilight, Botanical Sage, Sunset California, Titanium Minimal slate, or Solar Dawn luminous daylight glass with multi-pass liquid optics.',
    interactivePill: '5 Dynamic Themes • Multi-Pass Fluid Optics',
    actionText: 'Next: Foldables →',
    widget: 'theme-picker'
  },
  {
    id: TourStepId.FOLDABLE,
    badge: '📐 CONTINUOUS ADAPTIVITY',
    glyph: '📖',
    title: 'Foldable & Hinge Modes',
    subtitle: 'Seamless Book, Laptop Flex & Cover Screens',
    target: '#desktop-hero-glance',
    position: 'bottom',
    description: 'Engineered for next-generation hardware. PravahOS dynamically morphs its layouts across 4:3 Passport Book mode, 90° Flex Tabletop hands-free media, and candybar phone postures with continuous hinge sensor awareness.',
    interactivePill: '4:3 Passport Book • 90° Flex Tabletop • Slab Mode',
    actionText: 'Next: Privacy Shield →',
    widget: 'foldable-picker'
  },
  {
    id: TourStepId.AIRGAP,
    badge: '🛡️ SOVEREIGN ENCLAVE',
    glyph: '🛡️',
    title: 'Physical Air-Gap & Hardware Trust Shield',
    subtitle: 'Zero-Cloud Leak Privacy Killswitch',
    target: '#offline-badge',
    position: 'bottom',
    description: 'Absolute privacy sovereignty. With one physical air-gap tap, all RF power rails drop instantly to 0.0V. Your private neural weights and cryptographic audit proofs remain strictly on-device with guaranteed zero cloud leak.',
    interactivePill: '100% On-Device AI • Hardware Radio Killswitch',
    actionText: 'Take me to Pravah ✦',
    widget: 'airgap-toggle'
  }
];

/**
 * Storage adapter ensuring headless compatibility for unit tests.
 */
class TourStorage {
  constructor() {
    this._memStore = new Map();
  }

  get isAvailable() {
    return typeof localStorage !== 'undefined';
  }

  getItem(key) {
    if (this.isAvailable) {
      try {
        return localStorage.getItem(key);
      } catch (_) {}
    }
    return this._memStore.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.isAvailable) {
      try {
        localStorage.setItem(key, String(value));
        return;
      } catch (_) {}
    }
    this._memStore.set(key, String(value));
  }

  removeItem(key) {
    if (this.isAvailable) {
      try {
        localStorage.removeItem(key);
        return;
      } catch (_) {}
    }
    this._memStore.delete(key);
  }

  clear() {
    if (this.isAvailable) {
      try {
        localStorage.clear();
        return;
      } catch (_) {}
    }
    this._memStore.clear();
  }
}

/**
 * Main Onboarding Tour Engine
 */
export class OnboardingTour {
  /**
   * @param {Object} options
   * @param {Array} [options.steps=TOUR_STEPS]
   * @param {string} [options.storageKey=TOUR_STORAGE_KEY]
   * @param {TourStorage} [options.storage]
   * @param {Function} [options.onComplete]
   * @param {Function} [options.onSkip]
   */
  constructor({
    steps = TOUR_STEPS,
    storageKey = TOUR_STORAGE_KEY,
    storage = null,
    onComplete = null,
    onSkip = null
  } = {}) {
    this.steps = steps;
    this.storageKey = storageKey;
    this.storage = storage || new TourStorage();
    this.onComplete = onComplete;
    this.onSkip = onSkip;

    this.currentStepIndex = -1;
    this._active = false;
    this._listeners = new Set();

    // DOM references
    this.overlayEl = null;
    this.spotlightRingEl = null;
    this.tooltipCardEl = null;

    this._boundOnResize = this._handleResize.bind(this);
    this._boundOnKeyDown = this._handleKeyDown.bind(this);
  }

  /**
   * Whether tour is currently active and presenting steps.
   */
  isActive() {
    return this._active;
  }

  /**
   * Current active step definition or null.
   */
  getCurrentStep() {
    if (!this._active || this.currentStepIndex < 0 || this.currentStepIndex >= this.steps.length) {
      return null;
    }
    return this.steps[this.currentStepIndex];
  }

  /**
   * Current active step index (0-based) or -1.
   */
  getCurrentStepIndex() {
    return this.currentStepIndex;
  }

  /**
   * Total number of steps.
   */
  get totalSteps() {
    return this.steps.length;
  }

  /**
   * Check if user has already completed or skipped the onboarding tour.
   */
  isCompleted() {
    return this.storage.getItem(this.storageKey) === 'true';
  }

  /**
   * Mark tour completed in storage.
   */
  markCompleted() {
    this.storage.setItem(this.storageKey, 'true');
  }

  /**
   * Reset completion flag so tour can auto-launch again.
   */
  reset() {
    this.storage.removeItem(this.storageKey);
  }

  /**
   * Check if tour should auto-launch on first visit.
   */
  shouldAutoStart() {
    return !this.isCompleted();
  }

  /**
   * Register a step change observer.
   * @param {Function} callback (step, index, total) => void
   */
  onStepChange(callback) {
    if (typeof callback === 'function') {
      this._listeners.add(callback);
    }
    return () => this._listeners.delete(callback);
  }

  /**
   * Start the onboarding tour.
   * @param {Object} options
   * @param {boolean} [options.force=false] Force launch even if previously completed.
   * @param {number} [options.stepIndex=0] Initial step index.
   * @returns {boolean} Whether tour successfully started.
   */
  start({ force = false, stepIndex = 0 } = {}) {
    if (!force && this.isCompleted()) {
      return false;
    }

    this._active = true;
    this._ensureDOM();

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._boundOnResize);
      window.addEventListener('keydown', this._boundOnKeyDown);
    }

    this._triggerHaptic('MEDIUM_SNAP');
    this.goToStep(stepIndex);
    return true;
  }

  /**
   * Navigate to a specific step by index.
   * @param {number} index
   */
  goToStep(index) {
    if (!this._active) return false;
    if (index < 0 || index >= this.steps.length) return false;

    // Trigger onLeave hook for previous step if present
    const prevStep = this.getCurrentStep();
    if (prevStep && typeof prevStep.onLeave === 'function') {
      try {
        prevStep.onLeave();
      } catch (_) {}
    }

    this.currentStepIndex = index;
    const currentStep = this.steps[index];

    // Trigger onEnter hook for new step if present
    if (currentStep && typeof currentStep.onEnter === 'function') {
      try {
        currentStep.onEnter();
      } catch (_) {}
    }

    this._renderStep(currentStep);

    // Notify listeners
    this._listeners.forEach(fn => {
      try {
        fn(currentStep, index, this.steps.length);
      } catch (_) {}
    });

    return true;
  }

  /**
   * Advance to the next step, or complete tour if on the last step.
   */
  next() {
    if (!this._active) return false;
    if (this.currentStepIndex >= this.steps.length - 1) {
      this.finish();
      return true;
    }
    this._triggerHaptic('SELECTION_TICK');
    return this.goToStep(this.currentStepIndex + 1);
  }

  /**
   * Step backwards to previous step.
   */
  prev() {
    if (!this._active) return false;
    if (this.currentStepIndex <= 0) return false;
    this._triggerHaptic('SELECTION_TICK');
    return this.goToStep(this.currentStepIndex - 1);
  }

  /**
   * Skip and dismiss the onboarding tour.
   */
  skip() {
    if (!this._active) return;
    this.markCompleted();
    this._close();

    this._triggerHaptic('LIGHT_TAP');

    if (typeof this.onSkip === 'function') {
      try {
        this.onSkip();
      } catch (_) {}
    }
  }

  /**
   * Successfully finish the onboarding tour.
   */
  finish() {
    if (!this._active) return;
    this.markCompleted();
    this._close();

    this._triggerHaptic('SUCCESS_CHIME');

    if (typeof this.onComplete === 'function') {
      try {
        this.onComplete();
      } catch (_) {}
    }
  }

  /**
   * Internal close helper.
   */
  _close() {
    const prevStep = this.getCurrentStep();
    if (prevStep && typeof prevStep.onLeave === 'function') {
      try {
        prevStep.onLeave();
      } catch (_) {}
    }

    this._active = false;
    this.currentStepIndex = -1;

    if (this.overlayEl) {
      this.overlayEl.classList.remove('tour-visible');
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._boundOnResize);
      window.removeEventListener('keydown', this._boundOnKeyDown);
    }
  }

  /**
   * Trigger synthesized haptic feedback.
   */
  _triggerHaptic(type) {
    if (typeof window === 'undefined') return;
    try {
      const engine = window.hapticEngine || window.PravahHaptics;
      if (engine) {
        if (type === 'SUCCESS_CHIME' && typeof engine.triggerSuccess === 'function') {
          engine.triggerSuccess();
        } else if (type === 'MEDIUM_SNAP' && typeof engine.triggerMedium === 'function') {
          engine.triggerMedium();
        } else if (type === 'SELECTION_TICK' && typeof engine.triggerSelection === 'function') {
          engine.triggerSelection();
        } else if (typeof engine.triggerLight === 'function') {
          engine.triggerLight();
        }
      }
    } catch (_) {}
  }

  /**
   * Keyboard shortcuts handler.
   */
  _handleKeyDown(e) {
    if (!this._active) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.skip();
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.prev();
    }
  }

  /**
   * Handle resize with throttled repositioning.
   */
  _handleResize() {
    if (!this._active) return;
    const currentStep = this.getCurrentStep();
    if (currentStep) {
      this._positionElements(currentStep);
    }
  }

  /**
   * Ensure overlay DOM structure is injected.
   */
  _ensureDOM() {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('pravah-tour-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pravah-tour-overlay';
      overlay.className = 'pravah-tour-overlay';

      overlay.innerHTML = `
        <div class="tour-backdrop" id="tour-backdrop"></div>
        <div class="tour-spotlight-ring ring-hidden" id="tour-spotlight-ring"></div>
        <div class="tour-tooltip-card" id="tour-tooltip-card" role="dialog" aria-modal="true" aria-label="PravahOS Guided Onboarding">
          <div class="tour-card-header">
            <div class="tour-header-left">
              <span class="tour-badge" id="tour-badge">✦ TOUR</span>
              <span class="tour-step-counter" id="tour-step-counter">1 / 6</span>
            </div>
            <button class="tour-btn-dismiss" id="tour-btn-dismiss" title="Skip Tour (Esc)">✕</button>
          </div>
          <div class="tour-card-body">
            <div class="tour-title-row">
              <div class="tour-glyph-box" id="tour-glyph-box">✨</div>
              <div class="tour-title-group">
                <h3 class="tour-step-title" id="tour-step-title">Welcome to PravahOS</h3>
                <span class="tour-step-subtitle" id="tour-step-subtitle">The Post-App Operating System</span>
              </div>
            </div>
            <p class="tour-step-desc" id="tour-step-desc"></p>
            <div class="tour-feature-pill" id="tour-feature-pill">
              <span class="tour-feature-dot"></span>
              <span id="tour-feature-text"></span>
            </div>
            <div class="tour-interactive-widget" id="tour-interactive-widget" style="display: none;"></div>
          </div>
          <div class="tour-card-footer">
            <div class="tour-step-dots" id="tour-step-dots"></div>
            <div class="tour-nav-actions">
              <button class="tour-btn-skip" id="tour-btn-skip">Skip</button>
              <button class="tour-btn-back" id="tour-btn-back" disabled>Back</button>
              <button class="tour-btn-next" id="tour-btn-next">Next →</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Wire persistent button listeners
      overlay.querySelector('#tour-btn-dismiss')?.addEventListener('click', () => this.skip());
      overlay.querySelector('#tour-btn-skip')?.addEventListener('click', () => this.skip());
      overlay.querySelector('#tour-btn-back')?.addEventListener('click', () => this.prev());
      overlay.querySelector('#tour-btn-next')?.addEventListener('click', () => this.next());
    }

    this.overlayEl = overlay;
    this.spotlightRingEl = overlay.querySelector('#tour-spotlight-ring');
    this.tooltipCardEl = overlay.querySelector('#tour-tooltip-card');
  }

  /**
   * Render active step content into DOM.
   */
  _renderStep(step) {
    if (!this.overlayEl) return;

    this.overlayEl.classList.add('tour-visible');

    const badgeEl = this.overlayEl.querySelector('#tour-badge');
    const counterEl = this.overlayEl.querySelector('#tour-step-counter');
    const glyphEl = this.overlayEl.querySelector('#tour-glyph-box');
    const titleEl = this.overlayEl.querySelector('#tour-step-title');
    const subtitleEl = this.overlayEl.querySelector('#tour-step-subtitle');
    const descEl = this.overlayEl.querySelector('#tour-step-desc');
    const featureTextEl = this.overlayEl.querySelector('#tour-feature-text');
    const nextBtn = this.overlayEl.querySelector('#tour-btn-next');
    const backBtn = this.overlayEl.querySelector('#tour-btn-back');
    const dotsContainer = this.overlayEl.querySelector('#tour-step-dots');
    const widgetEl = this.overlayEl.querySelector('#tour-interactive-widget');

    if (badgeEl) badgeEl.textContent = step.badge || '✦ TOUR';
    if (counterEl) counterEl.textContent = `${this.currentStepIndex + 1} / ${this.steps.length}`;
    if (glyphEl) glyphEl.textContent = step.glyph || '✦';
    if (titleEl) titleEl.textContent = step.title;
    if (subtitleEl) subtitleEl.textContent = step.subtitle;
    if (descEl) descEl.textContent = step.description;
    if (featureTextEl) featureTextEl.textContent = step.interactivePill || '';

    // Action button label
    const isLastStep = this.currentStepIndex === this.steps.length - 1;
    if (nextBtn) {
      nextBtn.textContent = isLastStep ? (step.actionText || 'Take me to Pravah ✦') : (step.actionText || 'Next →');
    }
    if (backBtn) {
      backBtn.disabled = this.currentStepIndex === 0;
    }

    // Step dots
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      this.steps.forEach((_, idx) => {
        const dot = document.createElement('button');
        dot.className = `tour-dot ${idx === this.currentStepIndex ? 'active' : ''}`;
        dot.setAttribute('title', `Go to step ${idx + 1}`);
        dot.addEventListener('click', () => {
          this._triggerHaptic('SELECTION_TICK');
          this.goToStep(idx);
        });
        dotsContainer.appendChild(dot);
      });
    }

    // Interactive Widget
    this._renderWidget(step, widgetEl);

    // Compute spotlight cutout & card position
    this._positionElements(step);
  }

  /**
   * Render interactive mini-action widgets for specific steps.
   */
  _renderWidget(step, widgetEl) {
    if (!widgetEl) return;

    if (step.widget === 'theme-picker') {
      widgetEl.style.display = 'flex';
      widgetEl.innerHTML = `
        <div class="tour-widget-label">Live Theme Preview:</div>
        <button class="tour-mini-btn" data-theme="twilight">🌌 Twilight</button>
        <button class="tour-mini-btn" data-theme="botanical">🌿 Sage</button>
        <button class="tour-mini-btn" data-theme="sunset">🌅 Sunset</button>
        <button class="tour-mini-btn" data-theme="titanium">🪐 Slate</button>
        <button class="tour-mini-btn" data-theme="solar">☀️ Solar</button>
      `;

      widgetEl.querySelectorAll('.tour-mini-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const themeId = btn.getAttribute('data-theme');
          this._triggerHaptic('SELECTION_TICK');
          if (typeof window !== 'undefined' && window.PravahThemeEngine) {
            window.PravahThemeEngine.setTheme(themeId);
          } else if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-theme', themeId);
          }
          widgetEl.querySelectorAll('.tour-mini-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    } else if (step.widget === 'foldable-picker') {
      widgetEl.style.display = 'flex';
      widgetEl.innerHTML = `
        <div class="tour-widget-label">Test Foldable Layout Adaptivity:</div>
        <button class="tour-mini-btn active" id="btn-tour-ff-slab">📱 Slab Phone</button>
        <button class="tour-mini-btn" id="btn-tour-ff-passport">📖 Passport (4:3)</button>
        <button class="tour-mini-btn" id="btn-tour-ff-flex">📐 Flex (90°)</button>
      `;

      const updateFoldable = (mode) => {
        this._triggerHaptic('MEDIUM_SNAP');
        if (typeof document !== 'undefined') {
          document.body.classList.remove('passport-mode', 'flex-mode');
          if (mode === 'passport') document.body.classList.add('passport-mode');
          if (mode === 'flex') document.body.classList.add('flex-mode');
        }
        widgetEl.querySelectorAll('.tour-mini-btn').forEach(b => b.classList.remove('active'));
        if (mode === 'passport') widgetEl.querySelector('#btn-tour-ff-passport')?.classList.add('active');
        else if (mode === 'flex') widgetEl.querySelector('#btn-tour-ff-flex')?.classList.add('active');
        else widgetEl.querySelector('#btn-tour-ff-slab')?.classList.add('active');

        // Reposition spotlight because layout reflowed
        setTimeout(() => this._positionElements(step), 60);
      };

      widgetEl.querySelector('#btn-tour-ff-slab')?.addEventListener('click', () => updateFoldable('slab'));
      widgetEl.querySelector('#btn-tour-ff-passport')?.addEventListener('click', () => updateFoldable('passport'));
      widgetEl.querySelector('#btn-tour-ff-flex')?.addEventListener('click', () => updateFoldable('flex'));
    } else if (step.widget === 'airgap-toggle') {
      widgetEl.style.display = 'flex';
      widgetEl.innerHTML = `
        <div class="tour-widget-label">Hardware Killswitch Demo:</div>
        <button class="tour-mini-btn" id="btn-tour-airgap-toggle">⚡ Disconnect / Restore RF Power Rails</button>
      `;

      widgetEl.querySelector('#btn-tour-airgap-toggle')?.addEventListener('click', () => {
        this._triggerHaptic('MEDIUM_SNAP');
        const badge = document.getElementById('offline-badge');
        if (badge) {
          badge.click();
        }
      });
    } else {
      widgetEl.style.display = 'none';
      widgetEl.innerHTML = '';
    }
  }

  /**
   * Position spotlight cutout ring and tooltip card dynamically.
   */
  _positionElements(step) {
    if (!this.spotlightRingEl || !this.tooltipCardEl) return;

    let targetEl = null;
    if (typeof step.target === 'string') {
      targetEl = document.querySelector(step.target);
    } else if (typeof step.target === 'function') {
      targetEl = step.target();
    }

    const pad = 10;
    const ring = this.spotlightRingEl;
    const card = this.tooltipCardEl;

    // Check if target element exists and is in viewport
    if (targetEl && typeof targetEl.getBoundingClientRect === 'function') {
      const rect = targetEl.getBoundingClientRect();
      const hasSize = rect.width > 0 && rect.height > 0;

      if (hasSize) {
        ring.classList.remove('ring-hidden');
        card.classList.remove('card-centered');

        // Position spotlight cutout ring
        const ringTop = Math.max(0, rect.top - pad);
        const ringLeft = Math.max(0, rect.left - pad);
        const ringWidth = rect.width + pad * 2;
        const ringHeight = rect.height + pad * 2;

        ring.style.top = `${ringTop}px`;
        ring.style.left = `${ringLeft}px`;
        ring.style.width = `${ringWidth}px`;
        ring.style.height = `${ringHeight}px`;

        // Inherit or default border radius
        const computedStyle = (typeof window !== 'undefined' && window.getComputedStyle) ? window.getComputedStyle(targetEl) : null;
        const bRadius = computedStyle ? computedStyle.borderRadius : '18px';
        ring.style.borderRadius = bRadius === '0px' ? '16px' : bRadius;

        // Position tooltip card adjacent to target
        const cardRect = card.getBoundingClientRect();
        const cardWidth = cardRect.width || 420;
        const cardHeight = cardRect.height || 260;

        const viewWidth = (typeof window !== 'undefined' && window.innerWidth) || 800;
        const viewHeight = (typeof window !== 'undefined' && window.innerHeight) || 900;

        // Determine if card fits below or above target
        const spaceBelow = viewHeight - (rect.bottom + pad);
        const spaceAbove = rect.top - pad;

        let cardTop;
        if (step.position === 'top' && spaceAbove >= cardHeight + 20) {
          cardTop = Math.max(16, rect.top - pad - cardHeight - 14);
        } else if (spaceBelow >= cardHeight + 20 || spaceBelow >= spaceAbove) {
          cardTop = Math.min(viewHeight - cardHeight - 16, rect.bottom + pad + 14);
        } else {
          cardTop = Math.max(16, rect.top - pad - cardHeight - 14);
        }

        // Center card horizontally relative to target and clamp to viewport
        const idealLeft = rect.left + rect.width / 2 - cardWidth / 2;
        const clampedLeft = Math.max(16, Math.min(viewWidth - cardWidth - 16, idealLeft));

        card.style.top = `${cardTop}px`;
        card.style.left = `${clampedLeft}px`;
        card.style.transform = 'none';
        return;
      }
    }

    // Fallback: No target element found or step 0 center mode
    ring.classList.add('ring-hidden');
    card.classList.add('card-centered');
    card.style.top = '';
    card.style.left = '';
    card.style.transform = '';
  }

  /**
   * Destroy and unbind all tour resources.
   */
  destroy() {
    this._close();
    if (this.overlayEl && this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
    this.spotlightRingEl = null;
    this.tooltipCardEl = null;
    this._listeners.clear();
  }
}

// Window global registration & resilient self-mounting
if (typeof window !== 'undefined') {
  window.PravahTour = {
    TourStepId,
    TOUR_STORAGE_KEY,
    TOUR_STEPS,
    TourStorage,
    OnboardingTour
  };

  const initTourSubsystem = () => {
    if (!window.pravahTour) {
      window.pravahTour = new OnboardingTour();
    }

    // Wire manual trigger buttons
    const wireTrigger = () => {
      const btnTakeTour = document.getElementById('btn-take-tour');
      if (btnTakeTour) {
        btnTakeTour.addEventListener('click', () => {
          window.pravahTour.start({ force: true });
        });
      }

      // Auto-start on first consumer visit if not seen
      if (window.pravahTour.shouldAutoStart()) {
        setTimeout(() => {
          if (!window.pravahTour.isActive()) {
            window.pravahTour.start();
          }
        }, 900);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wireTrigger);
    } else {
      wireTrigger();
    }
  };

  initTourSubsystem();
}
