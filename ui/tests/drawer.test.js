// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DrawerState,
  TileId,
  DEFAULT_LIVE_TILES,
  BUILTIN_APPS,
  groupAppsAlphabetically,
  filterApps,
  formatCountdown,
  generateEqualizerBars,
  EphemeralWindowManager,
  LivingDrawer,
  synthesizeIntentionOutcome,
  resolveVistaBackgroundState,
  DEFAULT_APP_RELATIONS,
  recordUserAppAction,
  computeRecentAndRelatedApps
} from '../shell/drawer.js';

// Minimal DOM Mock Container for Headless Testing
class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this._classes = new Set();
    this.classList = {
      add: (...items) => items.forEach(i => this._classes.add(i)),
      remove: (...items) => items.forEach(i => this._classes.delete(i)),
      contains: (i) => this._classes.has(i),
      toggle: (i, force) => {
        if (force !== undefined) {
          if (force) this._classes.add(i);
          else this._classes.delete(i);
          return force;
        }
        if (this._classes.has(i)) {
          this._classes.delete(i);
          return false;
        }
        this._classes.add(i);
        return true;
      }
    };
    this.style = {
      transform: '',
      width: '',
      height: '',
      opacity: '',
      display: '',
      _vars: {},
      setProperty(k, v) { this._vars[k] = v; },
      getPropertyValue(k) { return this._vars[k] || ''; }
    };
    this.innerHTML = '';
    this.eventListeners = {};
    this.children = [];
    this.parentNode = null;
    this.value = '';
    this.textContent = '';
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(listener);
  }

  dispatchEvent(type, eventObj = {}) {
    if (this.eventListeners[type]) {
      this.eventListeners[type].forEach(fn => fn(eventObj));
    }
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  querySelector(sel) {
    if (sel.includes('#drawer-drag-header')) return new MockElement('drawer-drag-header');
    if (sel.includes('#btn-drawer-dismiss')) return new MockElement('btn-drawer-dismiss');
    if (sel.includes('#drawer-search-input')) return new MockElement('drawer-search-input');
    if (sel.includes('#btn-search-clear')) return new MockElement('btn-search-clear');
    if (sel.includes('#btn-flip-all')) return new MockElement('btn-flip-all');
    if (sel.includes('#metro-jump-modal')) return new MockElement('metro-jump-modal');
    if (sel.includes('#btn-jump-close')) return new MockElement('btn-jump-close');
    if (sel.includes('#metro-list-container')) return new MockElement('metro-list-container');
    if (sel.includes('#apps-count-badge')) return new MockElement('apps-count-badge');
    if (sel.includes('#tile-spotify')) return new MockElement('tile-spotify');
    if (sel.includes('#tile-flight')) return new MockElement('tile-flight');
    if (sel.includes('#tile-battery')) return new MockElement('tile-battery');
    if (sel.includes('#tile-airgap')) return new MockElement('tile-airgap');
    if (sel.includes('#spotify-eq-bars')) return new MockElement('spotify-eq-bars');
    if (sel.includes('#flight-countdown-val')) return new MockElement('flight-countdown-val');
    if (sel.includes('#battery-fuel-fill')) return new MockElement('battery-fuel-fill');
    if (sel.includes('#battery-pct-pill')) return new MockElement('battery-pct-pill');
    if (sel.includes('#vista-theme-bar')) return new MockElement('vista-theme-bar');
    if (sel.includes('#btn-vista-theme-gear')) return new MockElement('btn-vista-theme-gear');
    if (sel.includes('section-letter-')) {
      const el = new MockElement('section-letter');
      el.scrollIntoView = () => {};
      return el;
    }
    return null;
  }

  querySelectorAll(sel) {
    if (sel.includes('.tile-flip-btn')) return [new MockElement(), new MockElement()];
    if (sel.includes('.live-tile')) return [new MockElement('t1'), new MockElement('t2')];
    if (sel.includes('[data-jump-trigger]')) return [new MockElement('j1')];
    if (sel.includes('.metro-jump-tile.tile-active')) return [new MockElement('m1')];
    if (sel.includes('.metro-app-item')) return [];
    if (sel.includes('.eq-bar')) return [new MockElement(), new MockElement(), new MockElement(), new MockElement(), new MockElement()];
    return [];
  }
}

// ============================================================================
// 1. Dual-Surface State Machine Tests
// ============================================================================

test('LivingDrawer: initializes in COLLAPSED state by default', () => {
  const drawer = new LivingDrawer();
  assert.equal(drawer.state, DrawerState.COLLAPSED);
});

test('LivingDrawer: expand() transitions state to EXPANDED', () => {
  const drawer = new LivingDrawer();
  let stateNotification = null;
  drawer.onStateChange = (st) => { stateNotification = st; };

  drawer.expand();
  assert.equal(drawer.state, DrawerState.EXPANDED);
  assert.equal(stateNotification, DrawerState.EXPANDED);
});

test('LivingDrawer: collapse() transitions state to COLLAPSED', () => {
  const drawer = new LivingDrawer();
  drawer.expand();
  assert.equal(drawer.state, DrawerState.EXPANDED);

  let stateNotification = null;
  drawer.onStateChange = (st) => { stateNotification = st; };

  drawer.collapse();
  assert.equal(drawer.state, DrawerState.COLLAPSED);
  assert.equal(stateNotification, DrawerState.COLLAPSED);
});

test('LivingDrawer: toggle() smoothly flips between COLLAPSED and EXPANDED', () => {
  const drawer = new LivingDrawer();
  assert.equal(drawer.state, DrawerState.COLLAPSED);

  drawer.toggle();
  assert.equal(drawer.state, DrawerState.EXPANDED);

  drawer.toggle();
  assert.equal(drawer.state, DrawerState.COLLAPSED);
});

test('LivingDrawer: DOM container reflects transform styles during expand/collapse', () => {
  const container = new MockElement('living-drawer');
  const drawer = new LivingDrawer({ container });

  drawer.expand();
  assert.equal(container.style.transform, 'translateY(0%)');
  assert.ok(container.classList.contains('expanded'));
  assert.ok(!container.classList.contains('collapsed'));

  drawer.collapse();
  assert.equal(container.style.transform, 'translateY(100%)');
  assert.ok(container.classList.contains('collapsed'));
  assert.ok(!container.classList.contains('expanded'));

  drawer.stopLiveTickers();
});

// ============================================================================
// 2. Dynamic Glanceable Live Tiles Tests
// ============================================================================

test('LiveTiles: defines all 4 required dynamic tiles with front and back faces', () => {
  const tiles = DEFAULT_LIVE_TILES;
  assert.ok(tiles[TileId.SPOTIFY]);
  assert.ok(tiles[TileId.FLIGHT]);
  assert.ok(tiles[TileId.BATTERY]);
  assert.ok(tiles[TileId.AIRGAP]);

  // Check front and back payload structures
  assert.equal(tiles[TileId.SPOTIFY].front.track, 'Midnight City');
  assert.equal(tiles[TileId.FLIGHT].front.flightNum, 'AI-202');
  assert.equal(tiles[TileId.BATTERY].front.level, 88);
  assert.equal(tiles[TileId.AIRGAP].front.status, 'SECURED OFFLINE');

  assert.ok(tiles[TileId.SPOTIFY].back.codec);
  assert.ok(tiles[TileId.FLIGHT].back.aircraft);
  assert.ok(tiles[TileId.BATTERY].back.cellHealth);
  assert.ok(tiles[TileId.AIRGAP].back.enforcement);
});

test('LiveTiles: flipTile() flips individual tile state', () => {
  const drawer = new LivingDrawer();
  assert.equal(drawer.liveTiles[TileId.SPOTIFY].flipped, false);

  drawer.flipTile(TileId.SPOTIFY);
  assert.equal(drawer.liveTiles[TileId.SPOTIFY].flipped, true);

  drawer.flipTile(TileId.SPOTIFY);
  assert.equal(drawer.liveTiles[TileId.SPOTIFY].flipped, false);
});

test('LiveTiles: flipAll() toggles all tiles simultaneously', () => {
  const drawer = new LivingDrawer();
  drawer.flipAll();

  assert.equal(drawer.liveTiles[TileId.SPOTIFY].flipped, true);
  assert.equal(drawer.liveTiles[TileId.FLIGHT].flipped, true);
  assert.equal(drawer.liveTiles[TileId.BATTERY].flipped, true);
  assert.equal(drawer.liveTiles[TileId.AIRGAP].flipped, true);

  drawer.flipAll();
  assert.equal(drawer.liveTiles[TileId.SPOTIFY].flipped, false);
  assert.equal(drawer.liveTiles[TileId.FLIGHT].flipped, false);
  assert.equal(drawer.liveTiles[TileId.BATTERY].flipped, false);
  assert.equal(drawer.liveTiles[TileId.AIRGAP].flipped, false);
});

test('LiveTiles: generateEqualizerBars() yields normalized frequency values', () => {
  const bars = generateEqualizerBars(5);
  assert.equal(bars.length, 5);
  bars.forEach(val => {
    assert.ok(val >= 0.15 && val <= 1.0, `Bar value ${val} out of expected range`);
  });
});

test('LiveTiles: formatCountdown() correctly formats seconds into time strings', () => {
  assert.equal(formatCountdown(45), '00:45');
  assert.equal(formatCountdown(125), '02:05');
  assert.equal(formatCountdown(3600), '1h 00m');
  assert.equal(formatCountdown(5430), '1h 30m');
  assert.equal(formatCountdown(0), '00:00');
});

test('LiveTiles: updateTelemetry() syncs battery and airgap state', () => {
  const drawer = new LivingDrawer();
  drawer.updateTelemetry({
    battery: { level: 94, charging: true },
    airgap: false
  });

  assert.equal(drawer.liveTiles[TileId.BATTERY].front.level, 94);
  assert.equal(drawer.liveTiles[TileId.BATTERY].front.charging, true);
  assert.equal(drawer.liveTiles[TileId.AIRGAP].front.status, 'ONLINE (EGRESS OPEN)');
});

// ============================================================================
// 3. Bottom Section: Windows Phone / Metro Alphabetical List Tests
// ============================================================================

test('MetroList: groupAppsAlphabetically() groups catalog into sorted letter buckets', () => {
  const result = groupAppsAlphabetically(BUILTIN_APPS);

  assert.ok(result.grouped instanceof Map);
  assert.ok(result.activeLetters.length >= 7);

  // Exact required fast-jump letter headers: [A], [C], [M], [N], [S], [U], [W]
  const requiredLetters = ['A', 'C', 'M', 'N', 'S', 'U', 'W'];
  for (const letter of requiredLetters) {
    assert.ok(result.activeLetters.includes(letter), `Letter [${letter}] missing from active letters`);
    assert.ok(result.grouped.has(letter), `Group for [${letter}] not created`);
    assert.ok(result.grouped.get(letter).length > 0, `No apps found under letter [${letter}]`);
  }
});

test('MetroList: allLetters metadata covers all 26 letters (A-Z) with accurate flags', () => {
  const { allLetters } = groupAppsAlphabetically(BUILTIN_APPS);
  assert.equal(allLetters.length, 26);

  const letterA = allLetters.find(l => l.letter === 'A');
  assert.ok(letterA && letterA.active && letterA.count >= 3);

  const letterZ = allLetters.find(l => l.letter === 'Z');
  assert.ok(letterZ && !letterZ.active && letterZ.count === 0);
});

test('MetroList: filterApps() performs instantaneous search across name, category, and tags', () => {
  // 1. Search by name
  const flightResults = filterApps(BUILTIN_APPS, 'Air-Gap');
  assert.ok(flightResults.some(a => a.name.includes('Air-Gap')));

  // 2. Search by category
  const financeResults = filterApps(BUILTIN_APPS, 'Finance');
  assert.ok(financeResults.length >= 2);
  assert.ok(financeResults.some(a => a.id === 'crypto_remit'));
  assert.ok(financeResults.some(a => a.id === 'upi_transfer'));

  // 3. Search by tag
  const posixResults = filterApps(BUILTIN_APPS, 'posix');
  assert.ok(posixResults.some(a => a.id === 'android_bridge'));

  // 4. Case-insensitive substring match
  const spotifyResults = filterApps(BUILTIN_APPS, 'sPoTiFy');
  assert.ok(spotifyResults.some(a => a.id === 'spotify_audio'));

  // 5. Empty query returns full catalog
  const emptyResults = filterApps(BUILTIN_APPS, '');
  assert.equal(emptyResults.length, BUILTIN_APPS.length);

  // 6. Non-matching query returns empty array
  const unknownResults = filterApps(BUILTIN_APPS, 'xyznonexistent123');
  assert.equal(unknownResults.length, 0);
});

// ============================================================================
// 4. Dual Launch Model: Native DAG Card vs Ephemeral Zero-Tax Window
// ============================================================================

test('LaunchModel: DAG capability launch triggers onLaunchApp and collapses drawer', () => {
  const drawer = new LivingDrawer();
  drawer.expand();

  let launchedApp = null;
  let launchedMode = null;
  drawer.onLaunchApp = (app, mode) => {
    launchedApp = app;
    launchedMode = mode;
  };

  const dagApp = BUILTIN_APPS.find(a => a.launchType === 'dag');
  assert.ok(dagApp);

  drawer.launchApp(dagApp);
  assert.equal(launchedApp.id, dagApp.id);
  assert.equal(launchedMode, 'dag');
  assert.equal(drawer.state, DrawerState.COLLAPSED);
});

test('LaunchModel: Ephemeral capability opens in EphemeralWindowManager and collapses drawer', () => {
  const winManager = new EphemeralWindowManager();
  const drawer = new LivingDrawer({ windowManager: winManager });
  drawer.expand();

  let launchedApp = null;
  let launchedMode = null;
  drawer.onLaunchApp = (app, mode) => {
    launchedApp = app;
    launchedMode = mode;
  };

  const ephemeralApp = BUILTIN_APPS.find(a => a.launchType === 'ephemeral');
  assert.ok(ephemeralApp);

  drawer.launchApp(ephemeralApp);
  assert.equal(launchedApp.id, ephemeralApp.id);
  assert.equal(launchedMode, 'ephemeral');
  assert.equal(drawer.state, DrawerState.COLLAPSED);

  // Verify window record created in EphemeralWindowManager
  const openWins = winManager.getOpenWindows();
  assert.equal(openWins.length, 1);
  assert.equal(openWins[0].id, ephemeralApp.id);
});

test('EphemeralWindowManager: window lifecycle (open, minimize, close, closeAll)', () => {
  const winManager = new EphemeralWindowManager();
  const app1 = { id: 'app1', name: 'App One', category: 'Test' };
  const app2 = { id: 'app2', name: 'App Two', category: 'Test' };

  winManager.openWindow(app1);
  winManager.openWindow(app2);
  assert.equal(winManager.getOpenWindows().length, 2);

  // Re-opening existing window re-uses it
  winManager.openWindow(app1);
  assert.equal(winManager.getOpenWindows().length, 2);

  // Minimize
  winManager.toggleMinimize('app1');
  const win1 = winManager.openWindows.get('app1');
  assert.equal(win1.minimized, true);

  // Close single window
  const closed = winManager.closeWindow('app1');
  assert.equal(closed, true);
  assert.equal(winManager.getOpenWindows().length, 1);

  // Close all
  winManager.closeAll();
  assert.equal(winManager.getOpenWindows().length, 0);
});

// ============================================================================
// 5. Fast-Jump Index Navigation Modal Tests
// ============================================================================

test('FastJump: openFastJumpModal and closeFastJumpModal control active state', () => {
  const container = new MockElement('living-drawer');
  const drawer = new LivingDrawer({ container });

  assert.equal(drawer.activeFastJump, false);
  drawer.openFastJumpModal();
  assert.equal(drawer.activeFastJump, true);

  drawer.closeFastJumpModal();
  assert.equal(drawer.activeFastJump, false);

  drawer.stopLiveTickers();
});

test('FastJump: jumpToLetter closes modal and scrolls to section', () => {
  const container = new MockElement('living-drawer');
  const drawer = new LivingDrawer({ container });

  drawer.openFastJumpModal();
  assert.equal(drawer.activeFastJump, true);

  drawer.jumpToLetter('M');
  assert.equal(drawer.activeFastJump, false);

  drawer.stopLiveTickers();
});

// ============================================================================
// 6. Intention Widget Tests
// ============================================================================

test('IntentionWidget: synthesizeIntentionOutcome resolves flight and custom queries locally', () => {
  const flight = synthesizeIntentionOutcome('', 'flight');
  assert.equal(flight.scenario, 'flight');
  assert.ok(flight.headline.includes('Flight'));
  assert.equal(flight.dagSteps.length, 3);

  const custom = synthesizeIntentionOutcome('Backup encrypted vault offline', '');
  assert.equal(custom.scenario, 'custom');
  assert.ok(custom.summary.includes('Backup encrypted vault offline'));
  assert.equal(custom.targetPkg, 'org.pravah.store');
});

test('IntentionWidget: runIntentWidget updates outcome state and renders widget markup', () => {
  const container = new MockElement('living-drawer');
  const drawer = new LivingDrawer({ container });
  try {
    assert.ok(container.innerHTML.includes('vista-intent-widget'));
    const outcome = drawer.runIntentWidget('', 'crypto');
    assert.equal(outcome.scenario, 'crypto');
    assert.equal(drawer.activeIntentResult.targetPkg, 'org.pravah.vault');
    assert.ok(drawer.activeIntentResult.pills.includes('250 USDC'));
  } finally {
    drawer.stopLiveTickers();
  }
});

// ============================================================================
// 7. Vista Glass Background Theme Tests
// ============================================================================

test('VistaTheme: resolveVistaBackgroundState defaults to white on light system and black on dark system', () => {
  const lightSys = resolveVistaBackgroundState({}, 'light');
  assert.equal(lightSys.mode, 'system');
  assert.equal(lightSys.effectiveTone, 'white');
  assert.equal(lightSys.badge, 'SYSTEM • WHITE');

  const darkSys = resolveVistaBackgroundState({}, 'dark');
  assert.equal(darkSys.mode, 'system');
  assert.equal(darkSys.effectiveTone, 'black');
  assert.equal(darkSys.badge, 'SYSTEM • BLACK');

  const wall = resolveVistaBackgroundState({ mode: 'wallpaper' }, 'light');
  assert.equal(wall.effectiveTone, 'wallpaper');
});

test('VistaTheme: LivingDrawer setVistaTheme switches white, black, wallpaper, and custom color classes', () => {
  const container = new MockElement('living-drawer');
  const drawer = new LivingDrawer({ container });
  try {
    drawer.setVistaTheme('white');
    assert.equal(container.classList.contains('vista-bg-white'), true);
    assert.equal(container.classList.contains('vista-bg-black'), false);

    drawer.setVistaTheme('black');
    assert.equal(container.classList.contains('vista-bg-black'), true);

    drawer.setVistaTheme('wallpaper');
    assert.equal(container.classList.contains('vista-bg-wallpaper'), true);

    drawer.setVistaTheme('custom', '#2b124c');
    assert.equal(container.classList.contains('vista-bg-custom'), true);
    assert.equal(container.style.getPropertyValue('--vista-custom-bg'), '#2b124c');

    assert.equal(drawer.vistaThemeOpen, false);
    assert.equal(drawer.toggleVistaThemePopover(), true);
    assert.equal(drawer.toggleVistaThemePopover(), false);
  } finally {
    drawer.stopLiveTickers();
  }
});

test('VistaTheme: drawer.css synchronizes Intention Widget and children across black, white, wallpaper, and custom themes', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const css = fs.readFileSync(path.join(__dirname, '../shell/drawer.css'), 'utf8');

  for (const modeClass of ['vista-bg-black', 'vista-bg-white', 'vista-bg-wallpaper', 'vista-bg-custom']) {
    assert.ok(css.includes(`.living-drawer.${modeClass} .vista-intent-widget`), `Missing .vista-intent-widget rule for ${modeClass}`);
    assert.ok(css.includes(`.living-drawer.${modeClass} .vista-intent-input-row`), `Missing .vista-intent-input-row rule for ${modeClass}`);
    assert.ok(css.includes(`.living-drawer.${modeClass} .vista-intent-chip`), `Missing .vista-intent-chip rule for ${modeClass}`);
    assert.ok(css.includes(`.living-drawer.${modeClass} .vista-dag-step`), `Missing .vista-dag-step rule for ${modeClass}`);
    assert.ok(css.includes(`.living-drawer.${modeClass} .vista-intent-outcome`), `Missing .vista-intent-outcome rule for ${modeClass}`);
  }
});

// ============================================================================
// 8. Recent & Action-Learned Related Apps Prediction Engine Tests
// ============================================================================

test('AppPredictor: recordUserAppAction builds MRU history and learns App A -> App B transitions', () => {
  let state = { lastKey: '', lastTs: 0, recent: [], transitions: {} };
  state = recordUserAppAction(state, 'com.android.camera2', 10000);
  state = recordUserAppAction(state, 'org.pravah.aurora', 15000);
  state = recordUserAppAction(state, 'com.android.camera2', 20000);
  state = recordUserAppAction(state, 'org.pravah.aurora', 25000);

  assert.equal(state.lastKey, 'org.pravah.aurora');
  assert.equal(state.recent[0].key, 'org.pravah.aurora');
  assert.equal(state.recent[1].key, 'com.android.camera2');
  assert.equal(state.transitions['com.android.camera2']['org.pravah.aurora'], 2);
});

test('AppPredictor: computeRecentAndRelatedApps surfaces Just Opened + Workflow Related + Learned Transitions', () => {
  const sampleApps = [
    { id: 'apk_cam', pkg: 'com.android.camera2', name: 'Camera', category: 'Android Native App', launchType: 'native_apk', tags: ['camera'] },
    { id: 'apk_photos', pkg: 'com.google.android.apps.photos', name: 'Photos', category: 'Android Native App', launchType: 'native_apk', tags: ['photos'] },
    { id: 'apk_aurora', pkg: 'org.pravah.aurora', name: 'Aurora Notes', category: 'PravahOS Native Zero-Tax APK', isPravah: true, launchType: 'native_apk', tags: ['notes'] },
    { id: 'apk_vault', pkg: 'org.pravah.vault', name: 'Pravah Vault', category: 'PravahOS Native Zero-Tax APK', isPravah: true, launchType: 'native_apk', tags: ['vault'] },
    { id: 'apk_shield', pkg: 'org.pravah.shield', name: 'Pravah Shield', category: 'PravahOS Native Zero-Tax APK', isPravah: true, launchType: 'native_apk', tags: ['shield'] },
    { id: 'apk_calc', pkg: 'com.google.android.calculator', name: 'Calculator', category: 'Android Native App', launchType: 'native_apk', tags: ['calc'] },
    { id: 'apk_yt', pkg: 'com.google.android.youtube', name: 'YouTube', category: 'Android Native App', launchType: 'native_apk', tags: ['video'] }
  ];

  // Open Camera once -> Camera becomes "Just opened" and Photos / Aurora Notes become "Related to Camera"
  let usage = recordUserAppAction({}, 'com.android.camera2', 10000);
  let picks = computeRecentAndRelatedApps(sampleApps, usage, 6);
  assert.equal(picks.length, 6);
  assert.equal(picks[0].app.pkg, 'com.android.camera2');
  assert.equal(picks[0].reason, '↺ Just opened');
  assert.ok(picks.slice(1).some(p => p.app.pkg === 'com.google.android.apps.photos' && p.reason.includes('Related to Camera')));

  // Learn repeated action: Camera -> Calculator -> Camera
  usage = recordUserAppAction(usage, 'com.google.android.calculator', 20000);
  usage = recordUserAppAction(usage, 'com.android.camera2', 30000);
  usage = recordUserAppAction(usage, 'com.google.android.calculator', 40000);
  usage = recordUserAppAction(usage, 'com.android.camera2', 50000);

  // Exclude calculator from top 3 recent by opening Chrome/Photos/Shield? Wait: calc is #2 recent here,
  // so test with a fresh transition from Vault -> YouTube learned repeatedly!
  let vUsage = recordUserAppAction({}, 'org.pravah.vault', 60000);
  vUsage = recordUserAppAction(vUsage, 'com.google.android.youtube', 65000);
  vUsage = recordUserAppAction(vUsage, 'org.pravah.vault', 70000);
  vUsage = recordUserAppAction(vUsage, 'org.pravah.shield', 75000);
  vUsage = recordUserAppAction(vUsage, 'com.google.android.apps.photos', 80000);
  // Open Vault again -> top 3 recents are [Vault, Photos, Shield]; learned "Opened after Vault" YouTube must surface!
  vUsage = recordUserAppAction(vUsage, 'org.pravah.vault', 90000);
  const vPicks = computeRecentAndRelatedApps(sampleApps, vUsage, 6);
  const ytPick = vPicks.find(p => p.app.pkg === 'com.google.android.youtube');
  assert.ok(ytPick, 'Learned transition app YouTube should surface after Vault');
  assert.equal(ytPick.role, 'learned');
  assert.ok(ytPick.reason.includes('Opened after Pravah Vault'));
});

test('AppPredictor: LivingDrawer recordAppOpen dynamically refreshes Recent & Related Vista tiles', () => {
  const container = new MockElement('living-drawer');
  const drawer = new LivingDrawer({ container });
  try {
    drawer.recordAppOpen('camera_pro');
    const html = drawer._renderVistaGlassRecentAndRelatedTilesHtml();
    assert.ok(html.includes('vista-tile-recent'));
    assert.ok(html.includes('Just opened'));
    assert.ok(html.includes('vista-tile-related') || html.includes('vista-tile-learned'));
  } finally {
    drawer.stopLiveTickers();
  }
});
