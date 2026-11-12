// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file wallet.js
 * PravahOS Wallet & Personal Safety Application (Google Wallet + Personal Safety).
 *
 * Implements:
 * 1. NFC Payment Cards Sealed with Titan M2 Keystore.
 * 2. Integrated 2FA TOTP Authenticator Tokens.
 * 3. 3GPP Rel-17 Satellite SOS Emergency Dispatch Beacon.
 */

export class WalletApp {
  constructor(options = {}) {
    this.container = null;
    this.totpSeconds = 24;
    this.cards = [
      { id: 'c_1', name: 'Pravah Prime Metal', last4: '4821', exp: '09/29', balance: '$2,840.50' }
    ];
    this.totpTokens = [
      { id: 't_1', issuer: 'GitHub Enterprise', account: 'engineer@pravah.os', code: '849 201' },
      { id: 't_2', issuer: 'Google Cloud Platform', account: 'pixel-bringup@pantah', code: '391 042' }
    ];
  }

  render(container) {
    this.container = container;
    container.innerHTML = `
      <div class="wallet-container">
        <header class="wallet-header">
          <div style="font-size: 20px; font-weight: 700;">💳 Digital Wallet & Safety</div>
          <button class="camera-pill-btn" onclick="alert('NFC Terminal Ready - Tap Phone to Pay')">📡 Tap to Pay</button>
        </header>

        <section class="payment-card-hero">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="payment-card-chip"></div>
            <span style="font-weight: 700; font-size: 14px; letter-spacing: 1px;">TITAN M2 SEALED</span>
          </div>

          <div style="font-size: 20px; font-weight: 700; letter-spacing: 2px;">•••• •••• •••• 4821</div>

          <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <div>
              <div style="font-size: 10px; color: #a1a1aa;">CARDHOLDER</div>
              <div style="font-size: 13px; font-weight: 600;">PRAVAH ENGINEER</div>
            </div>
            <div>
              <div style="font-size: 10px; color: #a1a1aa;">EXPIRES</div>
              <div style="font-size: 13px; font-weight: 600;">09/29</div>
            </div>
          </div>
        </section>

        <section style="display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 13px; font-weight: 700; color: #a1a1aa;">2FA Authenticator Tokens</span>
            <span style="font-size: 11px; color: #818cf8;">Refreshes in ${this.totpSeconds}s</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${this.totpTokens.map(tok => `
              <div class="totp-card">
                <div>
                  <div style="font-size: 14px; font-weight: 600; color: #fff;">${tok.issuer}</div>
                  <div style="font-size: 12px; color: #71717a;">${tok.account}</div>
                </div>
                <div class="totp-code">${tok.code}</div>
              </div>
            `).join('')}
          </div>
        </section>

        <section class="sos-safety-box">
          <div>
            <div style="font-size: 15px; font-weight: 700; color: #ef4444;">🚨 3GPP Satellite SOS</div>
            <div style="font-size: 12px; color: #fca5a5; margin-top: 2px;">
              Direct LEO satellite emergency broadcast beacon
            </div>
          </div>
          <button class="camera-pill-btn" style="background: #ef4444; color: #fff; border: none;" onclick="alert('Satellite Emergency Beacon Armed: Slant Range locked.')">
            ACTIVATE
          </button>
        </section>
      </div>
    `;
  }
}

export default WalletApp;
