// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CameraApp, CameraMode } from '../apps/camera.js';
import { RecorderApp } from '../apps/recorder.js';
import { BrowserApp } from '../apps/browser.js';
import { CalendarApp } from '../apps/calendar.js';
import { WeatherApp } from '../apps/weather.js';
import { WalletApp } from '../apps/wallet.js';
import { AppRunner, StockAppId } from '../apps/app_runner.js';

function createMockContainer() {
  return {
    innerHTML: '',
    querySelectorAll: () => [],
    querySelector: () => null
  };
}

describe('PravahOS Factory Pixel Suite Application Tests', () => {

  it('CameraApp: initializes with Tensor G2 modes, switches zoom, and captures', () => {
    const camera = new CameraApp();
    assert.equal(camera.currentMode, CameraMode.PHOTO);
    assert.equal(camera.currentZoom, '1x');

    const container = createMockContainer();
    camera.render(container);
    assert.match(container.innerHTML, /TENSOR G2 RAW 50MP/);
    assert.match(container.innerHTML, /NIGHT SIGHT/);
    assert.match(container.innerHTML, /PORTRAIT/);
  });

  it('RecorderApp: formats time, manages recording state, and stores transcripts', () => {
    const recorder = new RecorderApp();
    assert.equal(recorder.formatTime(125), '02:05');
    assert.equal(recorder.isRecording, false);
    assert.ok(recorder.savedRecordings.length >= 2);

    const container = createMockContainer();
    recorder.render(container);
    assert.match(container.innerHTML, /Audio Recorder/);
    assert.match(container.innerHTML, /On-Device Whisper AI Active/);
  });

  it('BrowserApp: navigates URLs, records blocked trackers, and toggles reader mode', () => {
    const browser = new BrowserApp();
    assert.equal(browser.currentUrl, 'https://pravah.os');

    const container = createMockContainer();
    browser.render(container);
    assert.match(container.innerHTML, /Welcome to PravahOS/);
    assert.match(container.innerHTML, /Zero Background Tax/);

    browser.navigateTo('https://github.com');
    assert.equal(browser.currentUrl, 'https://github.com');
    assert.ok(browser.blockedTrackersCount > 14);
  });

  it('CalendarApp: displays month grid, tasks, and schedules events', () => {
    const cal = new CalendarApp();
    assert.ok(cal.events.length >= 2);
    assert.ok(cal.notes.length >= 3);

    const container = createMockContainer();
    cal.render(container);
    assert.match(container.innerHTML, /Kernel GKI Milestone 1 Review/);
    assert.match(container.innerHTML, /Keep Tasks/);
  });

  it('WeatherApp: renders atmospheric telemetry, hourly forecast, and sensory metrics', () => {
    const weather = new WeatherApp();
    assert.equal(weather.temp, 68);
    assert.equal(weather.aqi, 28);

    const container = createMockContainer();
    weather.render(container);
    assert.match(container.innerHTML, /San Francisco/);
    assert.match(container.innerHTML, /AIR QUALITY/);
    assert.match(container.innerHTML, /BAROMETER/);
  });

  it('WalletApp: displays Titan M2 encrypted card, 2FA tokens, and Satellite SOS', () => {
    const wallet = new WalletApp();
    assert.ok(wallet.cards.length >= 1);
    assert.ok(wallet.totpTokens.length >= 2);

    const container = createMockContainer();
    wallet.render(container);
    assert.match(container.innerHTML, /TITAN M2 SEALED/);
    assert.match(container.innerHTML, /2FA Authenticator Tokens/);
    assert.match(container.innerHTML, /3GPP Satellite SOS/);
  });

  it('AppRunner: recognizes and launches all 14 Pixel factory applications', () => {
    const runner = new AppRunner();
    assert.equal(runner.normalizeAppId('camera'), StockAppId.CAMERA);
    assert.equal(runner.normalizeAppId('recorder'), StockAppId.RECORDER);
    assert.equal(runner.normalizeAppId('browser'), StockAppId.BROWSER);
    assert.equal(runner.normalizeAppId('calendar'), StockAppId.CALENDAR);
    assert.equal(runner.normalizeAppId('weather'), StockAppId.WEATHER);
    assert.equal(runner.normalizeAppId('wallet'), StockAppId.WALLET);
    assert.equal(runner.normalizeAppId('settings'), StockAppId.SETTINGS);
    assert.equal(runner.normalizeAppId('store'), StockAppId.STORE);
  });

});
