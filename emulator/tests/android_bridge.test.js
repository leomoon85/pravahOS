// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  AndroidAppId,
  AndroidAppState,
  EmulatorAndroidApps,
  EmulatorAndroidBridge
} = require('../android_bridge.js');

describe('PravahOS Emulator Android Bridge & Container Runner', () => {
  let bridge;
  let mockEmulatorApp;

  beforeEach(() => {
    mockEmulatorApp = {
      preset: { width: 412, height: 915 },
      pulseDynamicIsland: () => {},
      hud: { state: { offline: true } }
    };
    bridge = new EmulatorAndroidBridge(mockEmulatorApp);
  });

  it('exposes defined default showcase applications with valid metadata', () => {
    assert.ok(EmulatorAndroidApps[AndroidAppId.WHATSAPP]);
    assert.ok(EmulatorAndroidApps[AndroidAppId.SPOTIFY]);
    assert.ok(EmulatorAndroidApps[AndroidAppId.MAPS]);
    assert.ok(EmulatorAndroidApps[AndroidAppId.UBER]);

    const spotify = EmulatorAndroidApps[AndroidAppId.SPOTIFY];
    assert.equal(spotify.shortName, 'Spotify');
    assert.ok(spotify.gatedCapabilities.includes('hardware.audio.pcm'));
  });

  it('launches Android applications and initializes process descriptors', () => {
    const success = bridge.launchApp(AndroidAppId.SPOTIFY);
    assert.equal(success, true);
    assert.equal(bridge.activeAppId, AndroidAppId.SPOTIFY);
    assert.equal(bridge.appStates[AndroidAppId.SPOTIFY], AndroidAppState.RUNNING);

    // Verify Binder IPC & Syscall logs recorded
    assert.ok(bridge.ipcLogs.length >= 4);
    assert.equal(bridge.ipcLogs[0].app, 'Spotify');
  });

  it('terminates active applications and detaches endpoints', () => {
    bridge.launchApp(AndroidAppId.WHATSAPP);
    assert.equal(bridge.activeAppId, AndroidAppId.WHATSAPP);

    bridge.closeActiveApp();
    assert.equal(bridge.activeAppId, null);
    assert.equal(bridge.appStates[AndroidAppId.WHATSAPP], AndroidAppState.STOPPED);
  });

  it('Spotify toggle controls audio stream state and records HAL transactions', () => {
    bridge.launchApp(AndroidAppId.SPOTIFY);
    assert.equal(bridge.spotifyTrack.isPlaying, false);

    bridge.startSpotifyPlayback();
    assert.equal(bridge.spotifyTrack.isPlaying, true);

    const logEntry = bridge.ipcLogs.find(l => l.summary.includes('createTrack'));
    assert.ok(logEntry);

    bridge.stopSpotifyPlayback();
    assert.equal(bridge.spotifyTrack.isPlaying, false);
  });

  it('WhatsApp delegates Camera VMO through Policy Gate and updates state', () => {
    bridge.launchApp(AndroidAppId.WHATSAPP);
    bridge.requestWhatsAppComponent('open_camera');

    assert.equal(bridge.whatsAppCallState.active, true);
    assert.equal(bridge.whatsAppCallState.cameraActive, true);
    assert.ok(bridge.whatsAppCallState.cameraVmo.startsWith('zx_vmo_cam_1080p_'));

    const policyLog = bridge.ipcLogs.find(l => l.type === 'POLICY_GATE');
    assert.ok(policyLog);
  });

  it('Google Maps acquires GNSS telemetry without cloud leak', () => {
    bridge.launchApp(AndroidAppId.MAPS);
    bridge.requestMapsLocation();

    const halLog = bridge.ipcLogs.find(l => l.summary.includes('28.6139° N'));
    assert.ok(halLog);
  });

  it('Uber ride booking triggers Policy Gate gatekeeper and approval flow', () => {
    bridge.launchApp(AndroidAppId.UBER);
    bridge.bookUberRide();

    assert.equal(bridge.uberState.status, 'AWAITING_APPROVAL');
    const warningLog = bridge.ipcLogs.find(l => l.summary.includes('MANDATORY CONFIRMATION'));
    assert.ok(warningLog);

    bridge.confirmUberRide();
    assert.equal(bridge.uberState.status, 'CONFIRMED');
    const approvedLog = bridge.ipcLogs.find(l => l.summary.includes('USER APPROVED'));
    assert.ok(approvedLog);
  });
});
