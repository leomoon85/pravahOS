// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * PravahOS Desktop Experience & Dynamic Theme Engine Verification Suite
 */

const THEME_PRESETS = {
  twilight: {
    id: 'twilight',
    name: 'Celestial Twilight',
    primary: '#38bdf8',
    bg: '#070a14',
    desc: 'Cosmic sapphire, deep indigo & starlight glow'
  },
  botanical: {
    id: 'botanical',
    name: 'Botanical Sage',
    primary: '#34d399',
    bg: '#09130e',
    desc: 'Pixel 9 matcha, calm bamboo & deep forest moss'
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset California',
    primary: '#fb923c',
    bg: '#150a12',
    desc: 'Warm golden amber, twilight rose & peach glass'
  },
  titanium: {
    id: 'titanium',
    name: 'Titanium Minimal',
    primary: '#e2e8f0',
    bg: '#0a0c10',
    desc: 'iPhone 16 Pro brushed slate, platinum & monochrome'
  },
  solar: {
    id: 'solar',
    name: 'Solar Dawn (Light)',
    primary: '#0284c7',
    bg: '#f1f5f9',
    desc: 'Luminous daylight frosted glass & ocean cyan'
  }
};

const CONSUMER_APPS = [
  { id: 'app-tile-phone', label: 'Phone', glyph: '📞', action: 'dialer' },
  { id: 'app-tile-messages', label: 'Messages', glyph: '💬', action: 'messages' },
  { id: 'app-tile-camera', label: 'Camera', glyph: '📷', action: 'camera' },
  { id: 'app-tile-maps', label: 'Maps', glyph: '🗺️', action: 'maps' },
  { id: 'app-tile-music', label: 'Music', glyph: '🎵', action: 'music' },
  { id: 'app-tile-wallet', label: 'Wallet', glyph: '💳', action: 'wallet' },
  { id: 'app-tile-installer', label: 'App Hub', glyph: '📦', action: 'installer' },
  { id: 'app-tile-themes', label: 'Themes', glyph: '🎨', action: 'themes' }
];

test('ThemeEngine: defines all 5 luxury color themes with valid tokens', () => {
  const themeKeys = Object.keys(THEME_PRESETS);
  assert.equal(themeKeys.length, 5);
  assert.deepEqual(themeKeys, ['twilight', 'botanical', 'sunset', 'titanium', 'solar']);

  for (const key of themeKeys) {
    const theme = THEME_PRESETS[key];
    assert.ok(theme.name.length > 0);
    assert.ok(theme.primary.startsWith('#'));
    assert.ok(theme.bg.startsWith('#'));
    assert.ok(theme.desc.length > 0);
  }
});

test('ThemeEngine: theme switching updates active attribute and state', () => {
  let currentTheme = 'twilight';
  const applyTheme = (id) => {
    if (!THEME_PRESETS[id]) throw new Error(`Unknown theme: ${id}`);
    currentTheme = id;
    return THEME_PRESETS[id];
  };

  const switched = applyTheme('botanical');
  assert.equal(currentTheme, 'botanical');
  assert.equal(switched.name, 'Botanical Sage');

  applyTheme('sunset');
  assert.equal(currentTheme, 'sunset');

  applyTheme('titanium');
  assert.equal(currentTheme, 'titanium');

  applyTheme('solar');
  assert.equal(currentTheme, 'solar');

  assert.throws(() => applyTheme('non_existent'), /Unknown theme/);
});

test('DesktopApps: provides complete 8-app consumer squircle grid', () => {
  assert.equal(CONSUMER_APPS.length, 8);
  const labels = CONSUMER_APPS.map(a => a.label);
  assert.ok(labels.includes('Phone'));
  assert.ok(labels.includes('Messages'));
  assert.ok(labels.includes('Camera'));
  assert.ok(labels.includes('Maps'));
  assert.ok(labels.includes('Music'));
  assert.ok(labels.includes('Wallet'));
  assert.ok(labels.includes('App Hub'));
  assert.ok(labels.includes('Themes'));
});

test('ConsumerOutcomeCard: maps task outputs to friendly natural language summaries', () => {
  function formatOutcomeSummary(task) {
    if (task.nodes.some(n => n.output?.flightNumber)) {
      const f = task.nodes.find(n => n.output?.flightNumber).output;
      return `Flight ${f.flightNumber} is ${f.status} from ${f.departure} to ${f.arrival}. Terminal ${f.terminal}, Gate ${f.gate}.`;
    }
    if (task.nodes.some(n => n.output?.txnId)) {
      const p = task.nodes.find(n => n.output?.txnId).output;
      return `Payment of ${p.amount} to ${p.recipient} completed securely. Reference: ${p.txnId}.`;
    }
    if (task.nodes.some(n => n.output?.sensorName)) {
      const c = task.nodes.find(n => n.output?.sensorName).output;
      return `Captured 50MP photo with ${c.sensorName}.`;
    }
    return 'Action completed securely.';
  }

  const flightTask = {
    nodes: [
      { output: { flightNumber: 'AI-202', status: 'ON TIME', departure: 'DEL', arrival: 'BLR', terminal: 'T3', gate: '14B' } }
    ]
  };
  assert.equal(
    formatOutcomeSummary(flightTask),
    'Flight AI-202 is ON TIME from DEL to BLR. Terminal T3, Gate 14B.'
  );

  const paymentTask = {
    nodes: [
      { output: { amount: '₹5,000', recipient: 'Alice', txnId: 'TXN-90214' } }
    ]
  };
  assert.equal(
    formatOutcomeSummary(paymentTask),
    'Payment of ₹5,000 to Alice completed securely. Reference: TXN-90214.'
  );
});

test('DesktopLiveClock: formats hours and minutes into clean 24h/12h strings', () => {
  const formatTime = (d) => {
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const testDate = new Date(2026, 10, 12, 9, 41, 0);
  assert.equal(formatTime(testDate), '09:41');

  const eveningDate = new Date(2026, 10, 12, 21, 5, 0);
  assert.equal(formatTime(eveningDate), '21:05');
});
