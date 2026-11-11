// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ClockApp,
  ClockTab,
  TIMER_PRESETS,
  DEFAULT_ALARMS,
  DEFAULT_WORLD_CITIES,
  MicrokernelClockCapability,
  AudioChimeSynthesizer,
  formatSecondsToTime,
  formatMillisecondsToStopwatch,
  formatOffsetMinutes,
  resolveTzOffsetMinutes
} from '../apps/clock.js';

import {
  DynamicIslandState,
  DynamicIslandController
} from '../shell/island.js';

// Minimal Mock DOM Container for Headless Testing
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
      _vars: {},
      setProperty(key, val) { this._vars[key] = val; },
      getPropertyValue(key) { return this._vars[key] || ''; }
    };
    this.attributes = {};
    this.innerHTML = '';
    this.textContent = '';
    this.eventListeners = {};
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  getAttribute(key) {
    return this.attributes[key] || null;
  }

  setAttribute(key, value) {
    this.attributes[key] = String(value);
  }

  querySelector(selector) {
    return new MockElement(selector.replace(/[^a-zA-Z0-9_-]/g, ''));
  }

  querySelectorAll(selector) {
    return [
      new MockElement('mock-el-1'),
      new MockElement('mock-el-2')
    ];
  }
}

// ============================================================================
// 1. INITIALIZATION & DATA DEFINITIONS
// ============================================================================

test('ClockApp: initialization and default state definitions', () => {
  const clock = new ClockApp();

  assert.equal(clock.activeTab, ClockTab.ALARM);
  assert.equal(clock.alarms.length, 4);
  assert.equal(clock.worldCities.length, 5);
  assert.equal(TIMER_PRESETS.length, 5);

  // Check presets
  assert.equal(TIMER_PRESETS[0].durationSec, 60);
  assert.equal(TIMER_PRESETS[4].durationSec, 1500); // 25m Pomodoro

  // Check default world cities
  const cityNames = clock.worldCities.map(c => c.city);
  assert.ok(cityNames.includes('New York'));
  assert.ok(cityNames.includes('London'));
  assert.ok(cityNames.includes('Tokyo'));
  assert.ok(cityNames.includes('Bengaluru'));
  assert.ok(cityNames.includes('San Francisco'));

  clock.destroy();
});

// ============================================================================
// 2. TAB NAVIGATION
// ============================================================================

test('ClockApp: tab navigation switches active view and rejects invalid tabs', () => {
  const clock = new ClockApp();

  assert.equal(clock.setTab(ClockTab.WORLD), ClockTab.WORLD);
  assert.equal(clock.activeTab, ClockTab.WORLD);

  assert.equal(clock.setTab(ClockTab.STOPWATCH), ClockTab.STOPWATCH);
  assert.equal(clock.activeTab, ClockTab.STOPWATCH);

  assert.equal(clock.setTab(ClockTab.TIMER), ClockTab.TIMER);
  assert.equal(clock.activeTab, ClockTab.TIMER);

  assert.equal(clock.setTab(ClockTab.ALARM), ClockTab.ALARM);
  assert.equal(clock.activeTab, ClockTab.ALARM);

  assert.throws(() => {
    clock.setTab('invalid_nonexistent_tab');
  }, /Invalid Clock tab/);

  clock.destroy();
});

// ============================================================================
// 3. MULTI-ALARM SCHEDULER: ADD, TOGGLE, DELETE & CAPABILITY AUDITING
// ============================================================================

test('Multi-Alarm Scheduler: addAlarm, toggleAlarm, deleteAlarm and capability auditing', () => {
  const capHost = new MicrokernelClockCapability();
  const clock = new ClockApp({ capabilityHost: capHost });

  // 1. Add Alarm
  const newAlarm = clock.addAlarm({
    time: '05:45',
    label: 'Early Morning Run',
    sound: 'Zen Garden',
    days: ['Mon', 'Wed', 'Fri']
  });

  assert.equal(newAlarm.time, '05:45');
  assert.equal(newAlarm.label, 'Early Morning Run');
  assert.equal(newAlarm.enabled, true);
  assert.equal(clock.alarms.length, 5);

  // Verify time.alarm capability was invoked
  const setLogs = capHost.getAuditTrail('time.alarm').filter(e => e.action === 'set');
  assert.ok(setLogs.length >= 1);
  assert.equal(setLogs[0].payload.alarm.label, 'Early Morning Run');

  // 2. Toggle Alarm
  const toggled = clock.toggleAlarm(newAlarm.id);
  assert.equal(toggled.enabled, false);

  const toggleLogs = capHost.getAuditTrail('time.alarm').filter(e => e.action === 'toggle');
  assert.ok(toggleLogs.length >= 1);
  assert.equal(toggleLogs[0].payload.enabled, false);

  // Toggle back on
  clock.toggleAlarm(newAlarm.id);
  assert.equal(newAlarm.enabled, true);

  // 3. Delete Alarm
  const deleted = clock.deleteAlarm(newAlarm.id);
  assert.equal(deleted, true);
  assert.equal(clock.alarms.length, 4);

  const cancelLogs = capHost.getAuditTrail('time.alarm').filter(e => e.action === 'cancel');
  assert.ok(cancelLogs.length >= 1);
  assert.equal(cancelLogs[0].payload.alarmId, newAlarm.id);

  clock.destroy();
});

// ============================================================================
// 4. MULTI-ALARM SCHEDULER: SNOOZE, DISMISS, AND CHECK TRIGGER
// ============================================================================

test('Multi-Alarm Scheduler: snooze logic, ringing state, dismiss, and audio trigger', () => {
  const capHost = new MicrokernelClockCapability();
  const audio = new AudioChimeSynthesizer();
  audio.muted = true; // headless test

  let callbackFired = false;
  const clock = new ClockApp({
    capabilityHost: capHost,
    audioEngine: audio,
    onAlarmTrigger: (alarm) => {
      callbackFired = true;
    }
  });

  const alarm = clock.alarms[0]; // '06:30'

  // Test Snooze
  const snoozed = clock.snoozeAlarm(alarm.id, 9);
  assert.equal(snoozed.isSnoozed, true);
  assert.equal(snoozed.isRinging, false);
  assert.ok(snoozed.snoozedUntil > Date.now());

  // Test Dismiss
  const dismissed = clock.dismissAlarm(alarm.id);
  assert.equal(dismissed.isSnoozed, false);
  assert.equal(dismissed.isRinging, false);
  assert.equal(dismissed.snoozedUntil, null);

  // Test checkAlarms with a simulated reference date matching alarm_1 (06:30 on Monday)
  // Construct a Monday at 06:30
  const simDate = new Date(2026, 10, 16, 6, 30, 0); // Nov 16 2026 is Monday
  alarm.time = '06:30';
  alarm.enabled = true;
  alarm.days = ['Mon', 'Tue'];

  const triggered = clock.checkAlarms(simDate);
  assert.ok(triggered.some(a => a.id === alarm.id));
  assert.equal(alarm.isRinging, true);
  assert.equal(callbackFired, true);
  assert.ok(audio.history.some(h => h.type === 'alarm'));

  clock.destroy();
});

// ============================================================================
// 5. WORLD CLOCK: TIMEZONE OFFSETS & DIFFERENTIAL PILLS (+5:30h, -5h)
// ============================================================================

test('World Clock: computes dynamic local time, UTC offsets, and timezone differential pills (+5:30h, -5h)', () => {
  const clock = new ClockApp();
  const refDate = new Date('2026-11-12T12:00:00Z'); // UTC Noon

  const clocks = clock.getWorldClocks(refDate);
  assert.equal(clocks.length, 5);

  const ny = clocks.find(c => c.city === 'New York');
  const lon = clocks.find(c => c.city === 'London');
  const tyo = clocks.find(c => c.city === 'Tokyo');
  const blr = clocks.find(c => c.city === 'Bengaluru');
  const sfo = clocks.find(c => c.city === 'San Francisco');

  assert.ok(ny);
  assert.ok(lon);
  assert.ok(tyo);
  assert.ok(blr);
  assert.ok(sfo);

  // Check UTC offsets:
  // Bengaluru: GMT+05:30 -> +5:30h
  assert.equal(blr.utcOffsetDiff, '+5:30h');
  // New York: GMT-05:00 -> -5h
  assert.equal(ny.utcOffsetDiff, '-5h');
  // Tokyo: GMT+09:00 -> +9h
  assert.equal(tyo.utcOffsetDiff, '+9h');
  // San Francisco: GMT-08:00 -> -8h
  assert.equal(sfo.utcOffsetDiff, '-8h');

  // Verify analog clock hands are computed
  assert.ok(typeof blr.analogHands.hourAngle === 'number');
  assert.ok(typeof blr.analogHands.minuteAngle === 'number');
  assert.ok(typeof blr.analogHands.secondAngle === 'number');

  // Verify day/night and relative day string
  assert.ok(typeof blr.isDay === 'boolean');
  assert.ok(['Today', 'Tomorrow', 'Yesterday'].includes(blr.relativeDay));

  clock.destroy();
});

// ============================================================================
// 6. PRECISION COUNTDOWN TIMER: PRESETS, START, PAUSE, RESUME, RESET
// ============================================================================

test('Precision Countdown Timer: presets, start, pause, resume, reset, and audio callback', () => {
  const capHost = new MicrokernelClockCapability();
  const audio = new AudioChimeSynthesizer();
  audio.muted = true;

  let timerDoneFired = false;
  const clock = new ClockApp({
    capabilityHost: capHost,
    audioEngine: audio,
    onTimerComplete: () => {
      timerDoneFired = true;
    }
  });

  // 1. Preset Start (5 minutes = 300s)
  clock.startTimer(300);
  assert.equal(clock.timerState, 'RUNNING');
  assert.equal(clock.timerDuration, 300);
  assert.equal(clock.timerRemaining, 300);

  // 2. Pause
  const remainingAtPause = clock.pauseTimer();
  assert.equal(clock.timerState, 'PAUSED');
  assert.ok(remainingAtPause <= 300);

  // 3. Resume
  clock.startTimer();
  assert.equal(clock.timerState, 'RUNNING');

  // 4. Reset
  clock.resetTimer(180);
  assert.equal(clock.timerState, 'IDLE');
  assert.equal(clock.timerRemaining, 180);

  // 5. Microkernel verification
  const timerLogs = capHost.getAuditTrail('time.alarm');
  assert.ok(timerLogs.some(e => e.action === 'timer_start'));
  assert.ok(timerLogs.some(e => e.action === 'timer_pause'));
  assert.ok(timerLogs.some(e => e.action === 'timer_reset'));

  clock.destroy();
});

// ============================================================================
// 7. DYNAMIC ISLAND INTEGRATION: LIVE TIMER PILL SYNCHRONIZATION
// ============================================================================

test('Dynamic Island Integration: live timer pill synchronization across states', () => {
  const island = new DynamicIslandController(null, { enableHaptics: false });
  const clock = new ClockApp({ dynamicIsland: island });

  assert.equal(island.getState(), DynamicIslandState.COMPACT);

  // 1. Starting timer triggers Dynamic Island morph to TIMER
  clock.startTimer(120);
  assert.equal(island.getState(), DynamicIslandState.TIMER);

  const payload = island.getPayload();
  assert.equal(payload.remainingSec, 120);
  assert.equal(payload.formattedTime, '02:00');
  assert.equal(payload.isRunning, true);
  assert.equal(payload.progress, 1.0);

  // 2. Pausing timer updates Dynamic Island payload
  clock.pauseTimer();
  assert.equal(island.getState(), DynamicIslandState.TIMER);
  assert.equal(island.getPayload().isRunning, false);

  // 3. Resetting timer collapses Dynamic Island back to COMPACT
  clock.resetTimer();
  assert.equal(island.getState(), DynamicIslandState.COMPACT);

  clock.destroy();
});

// ============================================================================
// 8. MILLISECOND STOPWATCH: START, PAUSE, LAP SPLITS, RESET
// ============================================================================

test('Millisecond Stopwatch: high-precision timing, pause, lap splits, and reset', () => {
  const capHost = new MicrokernelClockCapability();
  const clock = new ClockApp({ capabilityHost: capHost });

  assert.equal(clock.stopwatchState, 'STOPPED');
  assert.equal(clock.stopwatchElapsed, 0);

  // 1. Start
  clock.startStopwatch();
  assert.equal(clock.stopwatchState, 'RUNNING');
  assert.ok(clock.stopwatchStartTime > 0);

  // 2. Record Lap
  const lap1 = clock.lapStopwatch();
  assert.ok(lap1);
  assert.equal(lap1.lapNumber, 1);
  assert.ok(lap1.formattedLapTime);
  assert.ok(lap1.formattedSplitTime);

  // 3. Pause
  clock.pauseStopwatch();
  assert.equal(clock.stopwatchState, 'PAUSED');

  // 4. Reset
  const resetVal = clock.resetStopwatch();
  assert.equal(resetVal, 0);
  assert.equal(clock.stopwatchState, 'STOPPED');
  assert.equal(clock.stopwatchElapsed, 0);
  assert.equal(clock.laps.length, 0);

  // 5. Capability Audit Verification
  const swLogs = capHost.getAuditTrail('sensors.clock');
  assert.ok(swLogs.some(e => e.action === 'stopwatch_start'));
  assert.ok(swLogs.some(e => e.action === 'stopwatch_pause'));
  assert.ok(swLogs.some(e => e.action === 'stopwatch_lap'));
  assert.ok(swLogs.some(e => e.action === 'stopwatch_reset'));

  clock.destroy();
});

// ============================================================================
// 9. MILLISECOND STOPWATCH: FASTEST & SLOWEST LAP SPLIT HIGHLIGHTING
// ============================================================================

test('Millisecond Stopwatch: fastest and slowest lap split highlighting', () => {
  const clock = new ClockApp();

  // Simulate multiple laps manually to test algorithm deterministically
  clock.laps = [
    { lapNumber: 1, lapTime: 12500, splitTime: 12500, isFastest: false, isSlowest: false },
    { lapNumber: 2, lapTime: 8200, splitTime: 20700, isFastest: false, isSlowest: false }, // FASTEST
    { lapNumber: 3, lapTime: 19400, splitTime: 40100, isFastest: false, isSlowest: false }  // SLOWEST
  ];

  clock._recalculateFastestSlowestLaps();

  assert.equal(clock.laps[0].isFastest, false);
  assert.equal(clock.laps[0].isSlowest, false);

  assert.equal(clock.laps[1].isFastest, true);
  assert.equal(clock.laps[1].isSlowest, false);

  assert.equal(clock.laps[2].isFastest, false);
  assert.equal(clock.laps[2].isSlowest, true);

  clock.destroy();
});

// ============================================================================
// 10. MICROKERNEL CAPABILITIES: TELEMETRY & AUDIT INTEGRITY
// ============================================================================

test('Microkernel Capabilities: logs transactions for time.alarm and sensors.clock', async () => {
  const cap = new MicrokernelClockCapability();

  const res1 = await cap.invoke('time.alarm', { action: 'set', test: 123 });
  assert.equal(res1.status, 'VERIFIED');
  assert.ok(res1.token.startsWith('cap_tok_'));

  const res2 = await cap.invoke('sensors.clock', { action: 'frequency_lock', precision: '0.1_PPM' });
  assert.equal(res2.status, 'VERIFIED');

  const telemetry = cap.getTelemetry();
  assert.equal(telemetry.transactionsCount, 2);
  assert.equal(telemetry.capabilities['time.alarm'].status, 'READY');
  assert.equal(telemetry.capabilities['sensors.clock'].precision, '0.1_PPM');
});

// ============================================================================
// 11. ZERO BATTERY DRAIN & PURE FORMATTERS
// ============================================================================

test('Zero Battery Drain: time formatting utilities produce clean strings', () => {
  // Seconds formatters
  assert.equal(formatSecondsToTime(0), '00:00');
  assert.equal(formatSecondsToTime(59), '00:59');
  assert.equal(formatSecondsToTime(65), '01:05');
  assert.equal(formatSecondsToTime(3600), '01:00:00');
  assert.equal(formatSecondsToTime(3665), '01:01:05');

  // Stopwatch ms formatters
  assert.equal(formatMillisecondsToStopwatch(0), '00:00.00');
  assert.equal(formatMillisecondsToStopwatch(1250), '00:01.25');
  assert.equal(formatMillisecondsToStopwatch(65430), '01:05.43');

  // Timezone offset formatters
  assert.equal(formatOffsetMinutes(0), 'Local Time');
  assert.equal(formatOffsetMinutes(330), '+5:30h');
  assert.equal(formatOffsetMinutes(-300), '-5h');
  assert.equal(formatOffsetMinutes(-480), '-8h');
  assert.equal(formatOffsetMinutes(540), '+9h');
});

// ============================================================================
// 12. DOM RENDERING & UI STRUCTURE
// ============================================================================

test('DOM Rendering & UI Structure: render() produces complete markup and mounts cleanly', () => {
  const container = new MockElement('clock-container');
  const clock = new ClockApp({ container });

  const html = clock.render();
  assert.ok(html.includes('clock-app-root'));
  assert.ok(html.includes('clock-tabs-bar'));
  assert.ok(html.includes('time.alarm'));
  assert.ok(html.includes('sensors.clock'));

  // Switch tabs and verify markup changes
  clock.setTab(ClockTab.WORLD);
  const worldHtml = clock.render();
  assert.ok(worldHtml.includes('world-city-card'));
  assert.ok(worldHtml.includes('world-analog-clock'));

  clock.setTab(ClockTab.STOPWATCH);
  const swHtml = clock.render();
  assert.ok(swHtml.includes('stopwatch-display-large'));
  assert.ok(swHtml.includes('stopwatch-laps-table'));

  clock.setTab(ClockTab.TIMER);
  const timerHtml = clock.render();
  assert.ok(timerHtml.includes('timer-svg-ring'));
  assert.ok(timerHtml.includes('timer-presets-bar'));

  clock.destroy();
});
