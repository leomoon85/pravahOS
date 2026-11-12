// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file app_runner.js
 * Universal Stock App Runner & Modal Host for PravahOS.
 *
 * Coordinates zero-tax instant mounting of flagship stock applications:
 * - Phone & Contacts (PhoneDialerApp)
 * - Messages & SMS (MessagesApp)
 * - Gallery & Photos (GalleryApp)
 * - Files & Storage Manager (FileManagerApp)
 * - Calculator & Converter (CalculatorApp)
 * - Clock, Alarms & Timer (ClockApp)
 */

export const StockAppId = {
  PHONE: 'phone',
  DIALER: 'dialer',
  MESSAGES: 'messages',
  SMS: 'sms',
  GALLERY: 'gallery',
  PHOTOS: 'photos',
  FILES: 'files',
  STORAGE: 'storage',
  CALCULATOR: 'calculator',
  CALC: 'calc',
  CLOCK: 'clock',
  TIMER: 'timer',
  SETTINGS: 'settings',
  STORE: 'store',
  BAZAAR: 'bazaar'
};

export class AppRunner {
  /**
   * @param {Object} options
   * @param {HTMLElement} [options.viewport] - DOM container hosting active app modals
   * @param {Function} [options.onLaunch] - Callback when an app is mounted
   * @param {Function} [options.onClose] - Callback when an app is dismissed
   */
  constructor(options = {}) {
    this.viewport = options.viewport || null;
    this.onLaunch = options.onLaunch || null;
    this.onClose = options.onClose || null;
    this.currentApp = null;
    this.currentAppId = null;
    this.appInstances = new Map();

    this.ensureViewport();
  }

  /**
   * Guarantee modal viewport container exists in DOM.
   */
  ensureViewport() {
    if (typeof document === 'undefined') return;

    if (!this.viewport) {
      let existing = document.getElementById('pravah-app-viewport');
      if (!existing) {
        existing = document.createElement('div');
        existing.id = 'pravah-app-viewport';
        existing.className = 'pravah-app-viewport collapsed';
        existing.innerHTML = `
          <div class="app-viewport-backdrop" id="app-viewport-backdrop"></div>
          <div class="app-modal-sheet" id="app-modal-sheet">
            <div class="app-sheet-handle-bar">
              <div class="app-sheet-handle"></div>
            </div>
            <header class="app-sheet-header">
              <div class="app-sheet-title-group">
                <span class="app-sheet-icon" id="app-sheet-icon">📱</span>
                <span class="app-sheet-title" id="app-sheet-title">Application</span>
              </div>
              <button class="app-sheet-close-btn" id="btn-close-app-sheet" title="Dismiss (Swipe down or tap)">✕</button>
            </header>
            <div class="app-sheet-content" id="app-sheet-content"></div>
          </div>
        `;
        document.body.appendChild(existing);

        // Bind backdrop and close button
        const closeBtn = existing.querySelector('#btn-close-app-sheet');
        const backdrop = existing.querySelector('#app-viewport-backdrop');
        if (closeBtn) closeBtn.addEventListener('click', () => this.close());
        if (backdrop) backdrop.addEventListener('click', () => this.close());
      }
      this.viewport = existing;
    }
  }

  /**
   * Launch a stock application by its ID.
   * @param {string} rawAppId
   * @returns {Promise<Object>}
   */
  async launch(rawAppId) {
    const appId = this.normalizeAppId(rawAppId);
    this.ensureViewport();

    // Dynamically load corresponding app module
    let appInstance = this.appInstances.get(appId);
    let title = 'Application';
    let icon = '📱';

    try {
      if (appId === StockAppId.PHONE || appId === StockAppId.DIALER) {
        title = 'Phone & Contacts';
        icon = '📞';
        if (!appInstance) {
          const mod = await import('./dialer.js');
          const DialerClass = mod.PhoneDialerApp || mod.default;
          appInstance = new DialerClass();
        }
      } else if (appId === StockAppId.MESSAGES || appId === StockAppId.SMS) {
        title = 'Messages & Encrypted Chat';
        icon = '💬';
        if (!appInstance) {
          const mod = await import('./messages.js');
          const MsgClass = mod.MessagesApp || mod.default;
          appInstance = new MsgClass();
        }
      } else if (appId === StockAppId.GALLERY || appId === StockAppId.PHOTOS) {
        title = 'Gallery & Neural Photos';
        icon = '🖼️';
        if (!appInstance) {
          const mod = await import('./gallery.js');
          const GalClass = mod.GalleryApp || mod.default;
          appInstance = new GalClass();
        }
      } else if (appId === StockAppId.FILES || appId === StockAppId.STORAGE) {
        title = 'Files & Secure Storage';
        icon = '📁';
        if (!appInstance) {
          const mod = await import('./files.js');
          const FilesClass = mod.FileManagerApp || mod.default;
          appInstance = new FilesClass();
        }
      } else if (appId === StockAppId.CALCULATOR || appId === StockAppId.CALC) {
        title = 'Calculator & Converter';
        icon = '🧮';
        if (!appInstance) {
          const mod = await import('./calculator.js');
          const CalcClass = mod.CalculatorApp || mod.default;
          appInstance = new CalcClass();
        }
      } else if (appId === StockAppId.CLOCK || appId === StockAppId.TIMER) {
        title = 'Clock & Precision Timer';
        icon = '⏰';
        if (!appInstance) {
          const mod = await import('./clock.js');
          const ClockClass = mod.ClockApp || mod.default;
          appInstance = new ClockClass();
        }
      } else if (appId === StockAppId.SETTINGS) {
        title = 'System Settings & Updates';
        icon = '⚙️';
        if (!appInstance) {
          const mod = await import('./settings.js');
          const SettingsClass = mod.SettingsApp || mod.default;
          appInstance = new SettingsClass();
        }
      } else if (appId === StockAppId.STORE || appId === StockAppId.BAZAAR) {
        title = 'App Bazaar';
        icon = '🏪';
        if (!appInstance) {
          const mod = await import('./store.js');
          const StoreClass = mod.AppBazaarApp || mod.default;
          appInstance = new StoreClass();
        }
      } else {
        throw new Error(`Unknown stock app id: "${rawAppId}"`);
      }

      this.appInstances.set(appId, appInstance);
      this.currentApp = appInstance;
      this.currentAppId = appId;

      // Render into content container
      if (typeof document !== 'undefined' && this.viewport) {
        const titleEl = this.viewport.querySelector('#app-sheet-title');
        const iconEl = this.viewport.querySelector('#app-sheet-icon');
        const contentEl = this.viewport.querySelector('#app-sheet-content');

        if (titleEl) titleEl.textContent = title;
        if (iconEl) iconEl.textContent = icon;
        if (contentEl && typeof appInstance.render === 'function') {
          contentEl.innerHTML = '';
          const rendered = appInstance.render();
          if (typeof rendered === 'string') {
            contentEl.innerHTML = rendered;
          } else if (rendered instanceof HTMLElement) {
            contentEl.appendChild(rendered);
          }
          if (typeof appInstance.bindEvents === 'function') {
            appInstance.bindEvents(contentEl);
          }
        }

        this.viewport.classList.remove('collapsed');
        this.viewport.classList.add('expanded');
      }

      if (typeof this.onLaunch === 'function') {
        this.onLaunch(appId, appInstance);
      }

      return appInstance;
    } catch (err) {
      console.warn(`[AppRunner] Failed to launch app "${rawAppId}":`, err);
      throw err;
    }
  }

  /**
   * Dismiss the currently open app modal.
   */
  close() {
    if (this.viewport) {
      this.viewport.classList.remove('expanded');
      this.viewport.classList.add('collapsed');
    }
    const prevAppId = this.currentAppId;
    this.currentApp = null;
    this.currentAppId = null;

    if (typeof this.onClose === 'function' && prevAppId) {
      this.onClose(prevAppId);
    }
  }

  /**
   * Map alternative app identifiers to canonical names.
   * @param {string} id
   * @returns {string}
   */
  normalizeAppId(id) {
    if (!id) return '';
    const clean = String(id).toLowerCase().trim().replace(/[-_]/g, '');
    if (clean.includes('dial') || clean.includes('phone') || clean.includes('call')) return StockAppId.PHONE;
    if (clean.includes('msg') || clean.includes('messag') || clean.includes('sms') || clean.includes('chat')) return StockAppId.MESSAGES;
    if (clean.includes('photo') || clean.includes('galler') || clean.includes('image')) return StockAppId.GALLERY;
    if (clean.includes('file') || clean.includes('storag') || clean.includes('disk') || clean.includes('folder')) return StockAppId.FILES;
    if (clean.includes('calc') || clean.includes('math')) return StockAppId.CALCULATOR;
    if (clean.includes('clock') || clean.includes('alarm') || clean.includes('timer') || clean.includes('stopwatch')) return StockAppId.CLOCK;
    return id;
  }
}

let defaultRunner = null;
export function getAppRunner() {
  if (!defaultRunner) {
    defaultRunner = new AppRunner();
  }
  return defaultRunner;
}

if (typeof window !== 'undefined') {
  window.getAppRunner = getAppRunner;
  window.AppRunner = AppRunner;
}
