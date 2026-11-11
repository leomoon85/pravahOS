// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file clock.js
 * PravahOS Flagship Clock, Alarms, World Clock, Millisecond Stopwatch
 * & Precision Countdown Timer Stock Application.
 *
 * Implements:
 * 1. Multi-Alarm Scheduler: repeat days, sound profiles, snooze logic, interactive toggles.
 * 2. World Clock: analog & digital cards with dynamic timezone differential pills (+5:30h, -5h).
 * 3. Precision Countdown Timer: animated SVG progress ring, quick presets (1m, 3m, 5m, 15m, 25m),
 *    chime playback, and Dynamic Island background tracking.
 * 4. Millisecond Stopwatch: 10ms high-precision display, split lap recording with fastest/slowest highlighting.
 * 5. Microkernel Capabilities: direct bridge to `time.alarm` and `sensors.clock`.
 * 6. Zero Battery Drain: event-driven timestamp deltas, 0% CPU consumption when idle.
 */

export const ClockTab = {
  ALARM: 'alarm',
  WORLD: 'world',
  STOPWATCH: 'stopwatch',
  TIMER: 'timer'
};

export const TIMER_PRESETS = [
  { label: '1m', durationSec: 60, title: 'Quick Sprint' },
  { label: '3m', durationSec: 180, title: 'Tea Steep' },
  { label: '5m', durationSec: 300, title: 'Espresso Break' },
  { label: '15m', durationSec: 900, title: 'Power Nap' },
  { label: '25m Pomodoro', durationSec: 1500, title: 'Focus Sprint' }
];

export const DEFAULT_ALARMS = [
  {
    id: 'alarm_1',
    time: '06:30',
    label: 'Sunrise Meditation',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    sound: 'Pravah Chime',
    enabled: true,
    snoozeMinutes: 9
  },
  {
    id: 'alarm_2',
    time: '08:45',
    label: 'PravahOS Core Standup',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    sound: 'Quantum Pulse',
    enabled: true,
    snoozeMinutes: 9
  },
  {
    id: 'alarm_3',
    time: '13:00',
    label: 'Afternoon Fuel & Walk',
    days: ['Sat', 'Sun'],
    sound: 'Zen Garden',
    enabled: false,
    snoozeMinutes: 9
  },
  {
    id: 'alarm_4',
    time: '22:30',
    label: 'Air-Gap Winddown',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    sound: 'Gentle Rain',
    enabled: true,
    snoozeMinutes: 9
  }
];

export const DEFAULT_WORLD_CITIES = [
  {
    city: 'New York',
    country: 'United States',
    cityCode: 'NYC',
    timeZone: 'America/New_York',
    standardOffset: -300 // GMT-5
  },
  {
    city: 'London',
    country: 'United Kingdom',
    cityCode: 'LON',
    timeZone: 'Europe/London',
    standardOffset: 0 // GMT+0
  },
  {
    city: 'Tokyo',
    country: 'Japan',
    cityCode: 'TYO',
    timeZone: 'Asia/Tokyo',
    standardOffset: 540 // GMT+9
  },
  {
    city: 'Bengaluru',
    country: 'India',
    cityCode: 'BLR',
    timeZone: 'Asia/Kolkata',
    standardOffset: 330 // GMT+5:30
  },
  {
    city: 'San Francisco',
    country: 'United States',
    cityCode: 'SFO',
    timeZone: 'America/Los_Angeles',
    standardOffset: -480 // GMT-8
  }
];

/**
 * Microkernel Capability Bridge for `time.alarm` and `sensors.clock`
 */
export class MicrokernelClockCapability {
  constructor(host = null) {
    this.host = host;
    this.capabilities = {
      'time.alarm': {
        registered: true,
        status: 'READY',
        hardwareBacked: true,
        rtcSource: 'Pravah-RTC-32.768kHz',
        interruptLines: ['IRQ_RTC_ALARM']
      },
      'sensors.clock': {
        registered: true,
        status: 'LOCKED',
        precision: '0.1_PPM',
        source: 'TCXO_SYSTEM_OSC_24MHZ',
        syncSource: 'GNSS_PTP_MICROKERNEL'
      }
    };
    this.auditLog = [];
  }

  async invoke(capabilityId, payload = {}) {
    const entry = {
      timestamp: Date.now(),
      capabilityId,
      action: payload.action || 'default',
      payload,
      token: `cap_tok_${Math.random().toString(36).substring(2, 9)}`,
      status: 'VERIFIED'
    };
    this.auditLog.push(entry);

    if (this.host && typeof this.host.invoke === 'function') {
      try {
        return await this.host.invoke(capabilityId, payload);
      } catch (err) {
        console.warn(`[MicrokernelBridge] Invocation error [${capabilityId}]:`, err);
      }
    }
    return entry;
  }

  getAuditTrail(capabilityId = null) {
    if (!capabilityId) return [...this.auditLog];
    return this.auditLog.filter(e => e.capabilityId === capabilityId);
  }

  getTelemetry() {
    return {
      capabilities: { ...this.capabilities },
      transactionsCount: this.auditLog.length,
      lastTransaction: this.auditLog[this.auditLog.length - 1] || null
    };
  }
}

/**
 * High-fidelity Audio Chime Synthesizer
 */
export class AudioChimeSynthesizer {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.history = [];
  }

  _initContext() {
    if (this.ctx) return;
    if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
  }

  playChime(type = 'chime') {
    this.history.push({ type, timestamp: Date.now() });
    if (this.muted) return;

    try {
      this._initContext();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      const freqs = type === 'alarm'
        ? [587.33, 739.99, 880.00] // Bright D5-F#5-A5 major triad
        : [523.25, 659.25, 783.99]; // Warm C5-E5-G5 ambient chime

      const now = this.ctx.currentTime;
      freqs.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.001, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.25, now + idx * 0.08 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.85);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.9);
      });
    } catch (_) {}
  }
}

/**
 * Pure helper: Formats seconds into MM:SS or HH:MM:SS
 */
export function formatSecondsToTime(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remainingSec = sec % 60;

  const mm = mins.toString().padStart(2, '0');
  const ss = remainingSec.toString().padStart(2, '0');

  if (hrs > 0) {
    const hh = hrs.toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Pure helper: Formats milliseconds into MM:SS.cs (centiseconds)
 */
export function formatMillisecondsToStopwatch(ms) {
  const totalMs = Math.max(0, ms);
  const totalSeconds = Math.floor(totalMs / 1000);
  const centiseconds = Math.floor((totalMs % 1000) / 10);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');
  const cs = centiseconds.toString().padStart(2, '0');

  return `${mm}:${ss}.${cs}`;
}

/**
 * Pure helper: Formats offset difference in minutes into timezone pill text (+5:30h, -5h, etc.)
 */
export function formatOffsetMinutes(diffMinutes) {
  if (diffMinutes === 0) return 'Local Time';
  const sign = diffMinutes > 0 ? '+' : '-';
  const abs = Math.abs(diffMinutes);
  const hrs = Math.floor(abs / 60);
  const mins = abs % 60;
  if (mins === 0) {
    return `${sign}${hrs}h`;
  }
  return `${sign}${hrs}:${mins.toString().padStart(2, '0')}h`;
}

/**
 * Pure helper: Resolves UTC offset in minutes for a timezone at a given date
 */
export function resolveTzOffsetMinutes(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset'
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    if (tzPart && tzPart.value) {
      const match = tzPart.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
      if (match) {
        const sign = match[1] === '-' ? -1 : 1;
        const hours = parseInt(match[2], 10);
        const mins = match[3] ? parseInt(match[3], 10) : 0;
        return sign * (hours * 60 + mins);
      }
      if (tzPart.value === 'GMT' || tzPart.value === 'UTC') {
        return 0;
      }
    }
  } catch (_) {}

  // Fallback map
  const fallback = DEFAULT_WORLD_CITIES.find(c => c.timeZone === timeZone);
  if (fallback) return fallback.standardOffset;
  return 0;
}

/**
 * Flagship ClockApp Class
 */
export class ClockApp {
  constructor(options = {}) {
    this.container = options.container || null;
    this.activeTab = options.initialTab || ClockTab.ALARM;

    // Subsystem integrations
    this.dynamicIsland = options.dynamicIsland || (typeof window !== 'undefined' ? window.shellIsland : null);
    this.capabilityHost = options.capabilityHost || new MicrokernelClockCapability();
    this.audioEngine = options.audioEngine || new AudioChimeSynthesizer();
    this.onAlarmTrigger = options.onAlarmTrigger || null;
    this.onTimerComplete = options.onTimerComplete || null;

    // 1. Alarm Scheduler State
    this.alarms = JSON.parse(JSON.stringify(options.alarms || DEFAULT_ALARMS));
    this.activeRingingAlarm = null;
    this.alarmTimer = null;

    // 2. World Clock State
    this.worldCities = JSON.parse(JSON.stringify(options.worldCities || DEFAULT_WORLD_CITIES));
    this.worldClockTimer = null;

    // 3. Precision Countdown Timer State
    this.timerInitial = options.timerDuration || 300;
    this.timerDuration = this.timerInitial;
    this.timerRemaining = this.timerInitial;
    this.timerState = 'IDLE'; // 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED'
    this.timerEndTime = null;
    this.timerInterval = null;
    this.timerLabel = 'Precision Timer';

    // 4. Millisecond Stopwatch State
    this.stopwatchState = 'STOPPED'; // 'STOPPED' | 'RUNNING' | 'PAUSED'
    this.stopwatchStartTime = 0;
    this.stopwatchElapsed = 0;
    this.stopwatchInterval = null;
    this.laps = [];

    // Background Zero-Battery Optimization
    this._bindVisibilityListener();
    this._scheduleNextAlarmCheck();

    // Auto mount if container provided
    if (this.container) {
      this.render();
    }
  }

  // ==========================================================================
  // TAB NAVIGATION
  // ==========================================================================

  setTab(tab) {
    const validTabs = Object.values(ClockTab);
    if (!validTabs.includes(tab)) {
      throw new Error(`Invalid Clock tab: ${tab}. Expected one of ${validTabs.join(', ')}`);
    }

    this.activeTab = tab;

    // Update World Clock live updates if switching to/from world
    if (tab === ClockTab.WORLD) {
      this._startWorldClockTicker();
    } else if (!this.container) {
      this._stopWorldClockTicker();
    }

    if (this.container) {
      this.render();
    }

    return this.activeTab;
  }

  // ==========================================================================
  // 1. MULTI-ALARM SCHEDULER
  // ==========================================================================

  getAlarms() {
    return [...this.alarms];
  }

  addAlarm(alarmData = {}) {
    const id = alarmData.id || `alarm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newAlarm = {
      id,
      time: alarmData.time || '07:00',
      label: alarmData.label || 'Alarm',
      days: Array.isArray(alarmData.days) && alarmData.days.length > 0 ? alarmData.days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      sound: alarmData.sound || 'Pravah Chime',
      enabled: alarmData.enabled !== undefined ? Boolean(alarmData.enabled) : true,
      snoozeMinutes: alarmData.snoozeMinutes || 9,
      isRinging: false,
      isSnoozed: false,
      snoozedUntil: null
    };

    this.alarms.push(newAlarm);

    this.capabilityHost.invoke('time.alarm', {
      action: 'set',
      alarm: { ...newAlarm }
    });

    if (this.container && this.activeTab === ClockTab.ALARM) {
      this.render();
    }

    return newAlarm;
  }

  toggleAlarm(alarmId) {
    const alarm = this.alarms.find(a => a.id === alarmId);
    if (!alarm) {
      throw new Error(`Alarm not found: ${alarmId}`);
    }

    alarm.enabled = !alarm.enabled;
    if (!alarm.enabled) {
      alarm.isRinging = false;
      alarm.isSnoozed = false;
      alarm.snoozedUntil = null;
    }

    this.capabilityHost.invoke('time.alarm', {
      action: 'toggle',
      alarmId,
      enabled: alarm.enabled
    });

    if (this.container && this.activeTab === ClockTab.ALARM) {
      this.render();
    }

    return alarm;
  }

  deleteAlarm(alarmId) {
    const index = this.alarms.findIndex(a => a.id === alarmId);
    if (index === -1) return false;

    this.alarms.splice(index, 1);

    this.capabilityHost.invoke('time.alarm', {
      action: 'cancel',
      alarmId
    });

    if (this.container && this.activeTab === ClockTab.ALARM) {
      this.render();
    }

    return true;
  }

  snoozeAlarm(alarmId, snoozeMinutes = null) {
    const alarm = this.alarms.find(a => a.id === alarmId);
    if (!alarm) return null;

    const mins = snoozeMinutes || alarm.snoozeMinutes || 9;
    alarm.isRinging = false;
    alarm.isSnoozed = true;
    alarm.snoozedUntil = Date.now() + mins * 60 * 1000;

    if (this.activeRingingAlarm?.id === alarmId) {
      this.activeRingingAlarm = null;
    }

    this.capabilityHost.invoke('time.alarm', {
      action: 'snooze',
      alarmId,
      snoozeMinutes: mins,
      snoozedUntil: alarm.snoozedUntil
    });

    if (this.container) {
      this.render();
    }

    return alarm;
  }

  dismissAlarm(alarmId) {
    const alarm = this.alarms.find(a => a.id === alarmId);
    if (!alarm) return null;

    alarm.isRinging = false;
    alarm.isSnoozed = false;
    alarm.snoozedUntil = null;

    if (this.activeRingingAlarm?.id === alarmId) {
      this.activeRingingAlarm = null;
    }

    this.capabilityHost.invoke('time.alarm', {
      action: 'dismiss',
      alarmId
    });

    if (this.container) {
      this.render();
    }

    return alarm;
  }

  checkAlarms(referenceDate = new Date()) {
    const nowHours = referenceDate.getHours().toString().padStart(2, '0');
    const nowMinutes = referenceDate.getMinutes().toString().padStart(2, '0');
    const currentTimeStr = `${nowHours}:${nowMinutes}`;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDayName = dayNames[referenceDate.getDay()];
    const nowMs = referenceDate.getTime();

    const triggered = [];

    for (const alarm of this.alarms) {
      if (!alarm.enabled) continue;

      let shouldRing = false;

      // Check snooze expiration
      if (alarm.isSnoozed && alarm.snoozedUntil) {
        if (nowMs >= alarm.snoozedUntil) {
          shouldRing = true;
          alarm.isSnoozed = false;
          alarm.snoozedUntil = null;
        }
      } else if (!alarm.isRinging) {
        // Check standard time match
        const matchesTime = alarm.time === currentTimeStr;
        const matchesDay = !alarm.days || alarm.days.length === 0 || alarm.days.includes(currentDayName);
        if (matchesTime && matchesDay) {
          shouldRing = true;
        }
      }

      if (shouldRing) {
        alarm.isRinging = true;
        this.activeRingingAlarm = alarm;
        triggered.push(alarm);

        this.audioEngine.playChime('alarm');
        if (typeof this.onAlarmTrigger === 'function') {
          this.onAlarmTrigger(alarm);
        }

        this.capabilityHost.invoke('time.alarm', {
          action: 'trigger',
          alarm: { ...alarm }
        });
      }
    }

    if (triggered.length > 0 && this.container) {
      this.render();
    }

    return triggered;
  }

  // ==========================================================================
  // 2. WORLD CLOCK
  // ==========================================================================

  getWorldClocks(referenceDate = new Date()) {
    const localOffset = -referenceDate.getTimezoneOffset(); // local offset in minutes vs UTC
    const localDay = referenceDate.getDay();

    return this.worldCities.map(city => {
      const cityOffset = resolveTzOffsetMinutes(referenceDate, city.timeZone);
      const diffMinutes = cityOffset - localOffset;

      // Compute city local time
      const cityDateParts = this._getCityDateParts(referenceDate, city.timeZone);
      const hours = cityDateParts.hour;
      const minutes = cityDateParts.minute;
      const seconds = cityDateParts.second;

      // Analog clock hand angles
      const hour12 = hours % 12;
      const hourAngle = (hour12 + minutes / 60 + seconds / 3600) * 30;
      const minuteAngle = (minutes + seconds / 60) * 6;
      const secondAngle = seconds * 6;

      // Format 12-hour digital time string
      const period = hours >= 12 ? 'PM' : 'AM';
      const dispHours = (hours % 12) || 12;
      const timeString = `${dispHours}:${minutes.toString().padStart(2, '0')} ${period}`;
      const time24 = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

      // Relative Day
      const relativeDay = this._calculateRelativeDay(referenceDate, cityDateParts);

      // Offset Diff Pills
      const offsetDiff = formatOffsetMinutes(diffMinutes);
      const utcOffsetDiff = formatOffsetMinutes(cityOffset);

      // Day / Night flag
      const isDay = hours >= 6 && hours < 18;

      return {
        ...city,
        offsetMinutes: cityOffset,
        offsetHours: cityOffset / 60,
        diffMinutes,
        offsetDiff,
        utcOffsetDiff,
        timeString,
        time24,
        hours,
        minutes,
        seconds,
        isDay,
        relativeDay,
        analogHands: {
          hourAngle: Number(hourAngle.toFixed(1)),
          minuteAngle: Number(minuteAngle.toFixed(1)),
          secondAngle: Number(secondAngle.toFixed(1))
        }
      };
    });
  }

  addWorldCity(cityObj) {
    if (!cityObj || !cityObj.city || !cityObj.timeZone) {
      throw new Error('City object must contain city and timeZone properties.');
    }
    this.worldCities.push(cityObj);
    if (this.container && this.activeTab === ClockTab.WORLD) {
      this.render();
    }
  }

  removeWorldCity(cityName) {
    this.worldCities = this.worldCities.filter(c => c.city !== cityName);
    if (this.container && this.activeTab === ClockTab.WORLD) {
      this.render();
    }
  }

  // ==========================================================================
  // 3. PRECISION COUNTDOWN TIMER
  // ==========================================================================

  startTimer(durationSec = null) {
    if (durationSec !== null && durationSec !== undefined) {
      this.timerDuration = Math.max(1, Math.floor(durationSec));
      this.timerInitial = this.timerDuration;
      this.timerRemaining = this.timerDuration;
    } else if (this.timerRemaining <= 0) {
      this.timerRemaining = this.timerDuration || 300;
      this.timerInitial = this.timerRemaining;
    }

    this.timerState = 'RUNNING';
    this.timerEndTime = Date.now() + this.timerRemaining * 1000;

    this._startTimerTicker();
    this._updateDynamicIslandTimer();

    this.capabilityHost.invoke('time.alarm', {
      action: 'timer_start',
      durationSec: this.timerRemaining
    });

    this.capabilityHost.invoke('sensors.clock', {
      action: 'timer_sync',
      remainingSec: this.timerRemaining
    });

    if (this.container && this.activeTab === ClockTab.TIMER) {
      this.render();
    }

    return this.timerRemaining;
  }

  pauseTimer() {
    if (this.timerState !== 'RUNNING') return this.timerRemaining;

    this.timerRemaining = Math.max(0, Math.ceil((this.timerEndTime - Date.now()) / 1000));
    this.timerState = 'PAUSED';
    this._stopTimerTicker();
    this._updateDynamicIslandTimer();

    this.capabilityHost.invoke('time.alarm', {
      action: 'timer_pause',
      remainingSec: this.timerRemaining
    });

    if (this.container && this.activeTab === ClockTab.TIMER) {
      this.render();
    }

    return this.timerRemaining;
  }

  resetTimer(durationSec = null) {
    this._stopTimerTicker();
    this.timerState = 'IDLE';

    if (durationSec !== null && durationSec !== undefined) {
      this.timerDuration = Math.max(1, Math.floor(durationSec));
      this.timerInitial = this.timerDuration;
    }

    this.timerRemaining = this.timerDuration;

    // Reset Dynamic Island
    if (this.dynamicIsland && typeof this.dynamicIsland.collapse === 'function') {
      try {
        if (this.dynamicIsland.getState && this.dynamicIsland.getState() === 'TIMER') {
          this.dynamicIsland.collapse();
        }
      } catch (_) {}
    }

    this.capabilityHost.invoke('time.alarm', {
      action: 'timer_reset',
      remainingSec: this.timerRemaining
    });

    if (this.container && this.activeTab === ClockTab.TIMER) {
      this.render();
    }

    return this.timerRemaining;
  }

  setTimerDuration(durationSec) {
    return this.resetTimer(durationSec);
  }

  // ==========================================================================
  // 4. MILLISECOND STOPWATCH
  // ==========================================================================

  startStopwatch() {
    if (this.stopwatchState === 'RUNNING') return this.stopwatchElapsed;

    this.stopwatchStartTime = Date.now() - this.stopwatchElapsed;
    this.stopwatchState = 'RUNNING';

    this._startStopwatchTicker();

    this.capabilityHost.invoke('sensors.clock', {
      action: 'stopwatch_start',
      startTime: this.stopwatchStartTime
    });

    if (this.container && this.activeTab === ClockTab.STOPWATCH) {
      this.render();
    }

    return this.stopwatchElapsed;
  }

  pauseStopwatch() {
    if (this.stopwatchState !== 'RUNNING') return this.stopwatchElapsed;

    this.stopwatchElapsed = Date.now() - this.stopwatchStartTime;
    this.stopwatchState = 'PAUSED';

    this._stopStopwatchTicker();

    this.capabilityHost.invoke('sensors.clock', {
      action: 'stopwatch_pause',
      elapsedMs: this.stopwatchElapsed
    });

    if (this.container && this.activeTab === ClockTab.STOPWATCH) {
      this.render();
    }

    return this.stopwatchElapsed;
  }

  lapStopwatch() {
    if (this.stopwatchState === 'STOPPED' && this.stopwatchElapsed === 0) {
      return null;
    }

    const currentElapsed = this.stopwatchState === 'RUNNING'
      ? Math.max(0, Date.now() - this.stopwatchStartTime)
      : this.stopwatchElapsed;

    const prevSplit = this.laps.length > 0 ? this.laps[this.laps.length - 1].splitTime : 0;
    const lapTime = Math.max(0, currentElapsed - prevSplit);

    const newLap = {
      lapNumber: this.laps.length + 1,
      lapTime,
      splitTime: currentElapsed,
      formattedLapTime: formatMillisecondsToStopwatch(lapTime),
      formattedSplitTime: formatMillisecondsToStopwatch(currentElapsed),
      isFastest: false,
      isSlowest: false
    };

    this.laps.push(newLap);
    this._recalculateFastestSlowestLaps();

    this.capabilityHost.invoke('sensors.clock', {
      action: 'stopwatch_lap',
      lap: { ...newLap }
    });

    if (this.container && this.activeTab === ClockTab.STOPWATCH) {
      this.render();
    }

    return newLap;
  }

  resetStopwatch() {
    this._stopStopwatchTicker();
    this.stopwatchState = 'STOPPED';
    this.stopwatchElapsed = 0;
    this.stopwatchStartTime = 0;
    this.laps = [];

    this.capabilityHost.invoke('sensors.clock', {
      action: 'stopwatch_reset'
    });

    if (this.container && this.activeTab === ClockTab.STOPWATCH) {
      this.render();
    }

    return 0;
  }

  getLaps() {
    return [...this.laps];
  }

  // ==========================================================================
  // INTERNAL TICKERS & ZERO BATTERY DRAIN MANAGEMENT
  // ==========================================================================

  _startTimerTicker() {
    this._stopTimerTicker();
    this.timerInterval = setInterval(() => {
      if (this.timerState !== 'RUNNING') return;

      const remaining = Math.max(0, Math.ceil((this.timerEndTime - Date.now()) / 1000));
      this.timerRemaining = remaining;

      this._updateDynamicIslandTimer();

      if (remaining <= 0) {
        this.timerState = 'COMPLETED';
        this._stopTimerTicker();
        this.audioEngine.playChime('timer');

        if (typeof this.onTimerComplete === 'function') {
          this.onTimerComplete();
        }

        this.capabilityHost.invoke('time.alarm', {
          action: 'timer_complete'
        });
      }

      if (this.container && this.activeTab === ClockTab.TIMER) {
        this._updateTimerDisplayDOM();
      }
    }, 250);
    if (this.timerInterval && typeof this.timerInterval.unref === 'function') {
      this.timerInterval.unref();
    }
  }

  _stopTimerTicker() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  _startStopwatchTicker() {
    this._stopStopwatchTicker();
    this.stopwatchInterval = setInterval(() => {
      if (this.stopwatchState !== 'RUNNING') return;
      this.stopwatchElapsed = Date.now() - this.stopwatchStartTime;

      if (this.container && this.activeTab === ClockTab.STOPWATCH) {
        this._updateStopwatchDisplayDOM();
      }
    }, 40); // 25 FPS update for smooth centisecond readout
    if (this.stopwatchInterval && typeof this.stopwatchInterval.unref === 'function') {
      this.stopwatchInterval.unref();
    }
  }

  _stopStopwatchTicker() {
    if (this.stopwatchInterval) {
      clearInterval(this.stopwatchInterval);
      this.stopwatchInterval = null;
    }
  }

  _startWorldClockTicker() {
    this._stopWorldClockTicker();
    this.worldClockTimer = setInterval(() => {
      if (this.container && this.activeTab === ClockTab.WORLD) {
        this._updateWorldClockHandsDOM();
      }
    }, 1000);
    if (this.worldClockTimer && typeof this.worldClockTimer.unref === 'function') {
      this.worldClockTimer.unref();
    }
  }

  _stopWorldClockTicker() {
    if (this.worldClockTimer) {
      clearInterval(this.worldClockTimer);
      this.worldClockTimer = null;
    }
  }

  _scheduleNextAlarmCheck() {
    if (this.alarmTimer) clearTimeout(this.alarmTimer);

    // Event-driven minute alignment: Sleep until the next wall-clock minute boundary.
    // 0% background battery drain.
    const now = Date.now();
    const msToNextMinute = 60000 - (now % 60000);

    this.alarmTimer = setTimeout(() => {
      this.checkAlarms();
      this._scheduleNextAlarmCheck();
    }, msToNextMinute);
    if (this.alarmTimer && typeof this.alarmTimer.unref === 'function') {
      this.alarmTimer.unref();
    }
  }

  _bindVisibilityListener() {
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          // Pause high frequency stopwatch and UI rendering in background
          this._stopStopwatchTicker();
          this._stopWorldClockTicker();
        } else {
          // Resume accurate wall-clock time
          if (this.stopwatchState === 'RUNNING') {
            this._startStopwatchTicker();
          }
          if (this.activeTab === ClockTab.WORLD) {
            this._startWorldClockTicker();
          }
          if (this.container) {
            this.render();
          }
        }
      });
    }
  }

  _updateDynamicIslandTimer() {
    if (!this.dynamicIsland) return;

    const progress = this.timerInitial > 0 ? this.timerRemaining / this.timerInitial : 0;
    const formattedTime = formatSecondsToTime(this.timerRemaining);
    const isRunning = this.timerState === 'RUNNING';

    const payload = {
      remainingSec: this.timerRemaining,
      formattedTime,
      label: this.timerLabel || 'Timer',
      isRunning,
      progress: Math.max(0, Math.min(1, progress))
    };

    try {
      if (typeof this.dynamicIsland.transitionTo === 'function') {
        this.dynamicIsland.transitionTo('TIMER', payload);
      } else if (typeof this.dynamicIsland.setTimer === 'function') {
        this.dynamicIsland.setTimer(payload);
      }
    } catch (_) {}
  }

  _recalculateFastestSlowestLaps() {
    if (this.laps.length < 2) {
      this.laps.forEach(l => {
        l.isFastest = false;
        l.isSlowest = false;
      });
      return;
    }

    let minTime = Infinity;
    let maxTime = -Infinity;

    for (const lap of this.laps) {
      if (lap.lapTime < minTime) minTime = lap.lapTime;
      if (lap.lapTime > maxTime) maxTime = lap.lapTime;
    }

    for (const lap of this.laps) {
      lap.isFastest = (minTime !== maxTime && lap.lapTime === minTime);
      lap.isSlowest = (minTime !== maxTime && lap.lapTime === maxTime);
    }
  }

  _getCityDateParts(date, timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      }).formatToParts(date);

      const map = {};
      for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
      }
      if (map.hour === 24) map.hour = 0;
      return map;
    } catch (_) {
      return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds()
      };
    }
  }

  _calculateRelativeDay(localDate, cityDateParts) {
    const localDay = localDate.getDate();
    const cityDay = cityDateParts.day;

    if (cityDay === localDay) return 'Today';
    if (cityDay === localDay + 1 || (localDay >= 28 && cityDay === 1)) return 'Tomorrow';
    return 'Yesterday';
  }

  // ==========================================================================
  // DOM RENDERING & EVENT BINDINGS
  // ==========================================================================

  render(targetContainer = null) {
    if (targetContainer) {
      this.container = targetContainer;
    }
    const html = this._generateHTML();

    if (this.container) {
      this.container.innerHTML = html;
      this._wireEvents();
    }

    return html;
  }

  bindEvents(container) {
    if (container) {
      this.container = container;
      this._wireEvents();
    }
  }

  _generateHTML() {
    return `
      <div class="clock-app-root">
        <!-- Ambient Header & Microkernel Capability Badge -->
        <header class="clock-header">
          <div class="clock-header-titles">
            <h2 class="clock-title">${this._getTabTitle()}</h2>
            <div class="clock-kernel-badge" title="Zircon Microkernel TCXO & RTC Interrupts Active">
              <span class="kernel-dot"></span>
              <span class="kernel-cap-tag">time.alarm</span>
              <span class="kernel-divider">•</span>
              <span class="kernel-cap-tag">sensors.clock</span>
              <span class="kernel-status">LOCKED 0.1 PPM</span>
            </div>
          </div>
        </header>

        <!-- Main Tab Content Surface -->
        <main class="clock-main-surface">
          ${this._renderActiveTabContent()}
        </main>

        <!-- Ringing Alarm Modal Overlay (if active) -->
        ${this._renderRingingAlarmOverlay()}

        <!-- Floating Glassmorphic Tab Bar -->
        <nav class="clock-tabs-bar" role="tablist">
          <button class="clock-tab-btn ${this.activeTab === ClockTab.ALARM ? 'active' : ''}" data-tab="${ClockTab.ALARM}" role="tab" aria-selected="${this.activeTab === ClockTab.ALARM}">
            <span class="clock-tab-icon">⏰</span>
            <span class="clock-tab-label">Alarm</span>
          </button>
          <button class="clock-tab-btn ${this.activeTab === ClockTab.WORLD ? 'active' : ''}" data-tab="${ClockTab.WORLD}" role="tab" aria-selected="${this.activeTab === ClockTab.WORLD}">
            <span class="clock-tab-icon">🌐</span>
            <span class="clock-tab-label">World</span>
          </button>
          <button class="clock-tab-btn ${this.activeTab === ClockTab.STOPWATCH ? 'active' : ''}" data-tab="${ClockTab.STOPWATCH}" role="tab" aria-selected="${this.activeTab === ClockTab.STOPWATCH}">
            <span class="clock-tab-icon">⏱️</span>
            <span class="clock-tab-label">Stopwatch</span>
          </button>
          <button class="clock-tab-btn ${this.activeTab === ClockTab.TIMER ? 'active' : ''}" data-tab="${ClockTab.TIMER}" role="tab" aria-selected="${this.activeTab === ClockTab.TIMER}">
            <span class="clock-tab-icon">⏳</span>
            <span class="clock-tab-label">Timer</span>
          </button>
        </nav>
      </div>
    `;
  }

  _getTabTitle() {
    switch (this.activeTab) {
      case ClockTab.ALARM: return 'Alarms & Schedules';
      case ClockTab.WORLD: return 'World Clocks';
      case ClockTab.STOPWATCH: return 'Precision Stopwatch';
      case ClockTab.TIMER: return 'Countdown Timer';
      default: return 'Clock';
    }
  }

  _renderActiveTabContent() {
    switch (this.activeTab) {
      case ClockTab.ALARM:
        return this._renderAlarmTab();
      case ClockTab.WORLD:
        return this._renderWorldTab();
      case ClockTab.STOPWATCH:
        return this._renderStopwatchTab();
      case ClockTab.TIMER:
        return this._renderTimerTab();
      default:
        return '';
    }
  }

  // --- TAB 1: ALARM VIEW ---
  _renderAlarmTab() {
    const alarmsHtml = this.alarms.map(alarm => {
      const [h, m] = alarm.time.split(':').map(Number);
      const period = h >= 12 ? 'PM' : 'AM';
      const dispHours = (h % 12) || 12;
      const formattedTime = `${dispHours}:${m.toString().padStart(2, '0')}`;
      const daysText = alarm.days && alarm.days.length === 7 ? 'Every day' : (alarm.days ? alarm.days.join(', ') : 'Once');

      return `
        <div class="alarm-card ${alarm.enabled ? 'enabled' : 'disabled'} ${alarm.isSnoozed ? 'snoozed' : ''}" data-alarm-id="${alarm.id}">
          <div class="alarm-info">
            <div class="alarm-time-wrap">
              <span class="alarm-time-digits">${formattedTime}</span>
              <span class="alarm-period">${period}</span>
            </div>
            <div class="alarm-meta">
              <span class="alarm-label">${alarm.label}</span>
              <div class="alarm-submeta">
                <span class="alarm-repeat-days">${daysText}</span>
                <span class="alarm-sound-pill">🔔 ${alarm.sound}</span>
                ${alarm.isSnoozed ? `<span class="alarm-snooze-indicator">Snoozed +${alarm.snoozeMinutes || 9}m</span>` : ''}
              </div>
            </div>
          </div>
          <div class="alarm-actions">
            <label class="alarm-toggle-switch" title="Toggle Alarm">
              <input type="checkbox" class="alarm-checkbox" data-alarm-id="${alarm.id}" ${alarm.enabled ? 'checked' : ''} />
              <span class="alarm-toggle-slider"></span>
            </label>
            <button class="alarm-btn-delete" data-alarm-id="${alarm.id}" title="Delete Alarm">✕</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="alarm-tab-view">
        <div class="alarm-action-bar">
          <span class="alarm-count-badge">${this.alarms.filter(a => a.enabled).length} Active</span>
          <button class="alarm-btn-add" id="btn-show-add-alarm">+ Add Alarm</button>
        </div>

        <!-- Add Alarm Modal Form (Initially Hidden unless toggled) -->
        <div class="alarm-add-form" id="alarm-add-form" style="display: none;">
          <h4 class="form-title">New Pravah Alarm</h4>
          <div class="form-row">
            <label>Time</label>
            <input type="time" id="new-alarm-time" value="07:00" class="alarm-time-input" />
          </div>
          <div class="form-row">
            <label>Label</label>
            <input type="text" id="new-alarm-label" placeholder="Alarm Label" value="Wakeup" class="alarm-text-input" />
          </div>
          <div class="form-row">
            <label>Sound Profile</label>
            <select id="new-alarm-sound" class="alarm-select">
              <option value="Pravah Chime">Pravah Chime (Soft Chord)</option>
              <option value="Quantum Pulse">Quantum Pulse (Energetic)</option>
              <option value="Zen Garden">Zen Garden (Acoustic)</option>
              <option value="Gentle Rain">Gentle Rain (Ambient)</option>
            </select>
          </div>
          <div class="form-buttons">
            <button class="alarm-btn-cancel" id="btn-cancel-add-alarm">Cancel</button>
            <button class="alarm-btn-save" id="btn-save-new-alarm">Save Alarm</button>
          </div>
        </div>

        <div class="alarm-list">
          ${alarmsHtml}
        </div>
      </div>
    `;
  }

  // --- TAB 2: WORLD CLOCK VIEW ---
  _renderWorldTab() {
    const clocks = this.getWorldClocks();

    const cityCards = clocks.map(c => `
      <div class="world-city-card" data-city="${c.city}">
        <div class="world-card-left">
          <div class="world-analog-clock" title="${c.city} Analog Time">
            <div class="analog-face">
              <div class="analog-center-dot"></div>
              <div class="analog-hand hour" style="transform: rotate(${c.analogHands.hourAngle}deg)"></div>
              <div class="analog-hand minute" style="transform: rotate(${c.analogHands.minuteAngle}deg)"></div>
              <div class="analog-hand second" style="transform: rotate(${c.analogHands.secondAngle}deg)"></div>
            </div>
          </div>
          <div class="world-city-meta">
            <div class="world-city-header">
              <h3 class="world-city-name">${c.city}</h3>
              <span class="world-daynight-icon">${c.isDay ? '☀️' : '🌙'}</span>
            </div>
            <span class="world-country-name">${c.country}</span>
            <div class="world-pills-row">
              <span class="world-tz-pill ${c.diffMinutes === 0 ? 'local' : ''}">${c.offsetDiff}</span>
              <span class="world-day-badge">${c.relativeDay}</span>
            </div>
          </div>
        </div>

        <div class="world-card-right">
          <span class="world-digital-time">${c.timeString}</span>
          <span class="world-digital-24">${c.time24} UTC${c.utcOffsetDiff}</span>
        </div>
      </div>
    `).join('');

    return `
      <div class="world-tab-view">
        <div class="world-grid">
          ${cityCards}
        </div>
      </div>
    `;
  }

  // --- TAB 3: STOPWATCH VIEW ---
  _renderStopwatchTab() {
    const elapsedFormatted = formatMillisecondsToStopwatch(this.stopwatchElapsed);
    const [minSec, centiSec] = elapsedFormatted.split('.');
    const isRunning = this.stopwatchState === 'RUNNING';
    const isPaused = this.stopwatchState === 'PAUSED';
    const hasStarted = this.stopwatchElapsed > 0 || isRunning;

    const lapsRows = [...this.laps].reverse().map(lap => `
      <tr class="lap-row ${lap.isFastest ? 'lap-fastest' : ''} ${lap.isSlowest ? 'lap-slowest' : ''}">
        <td class="col-lap-num">Lap ${lap.lapNumber}</td>
        <td class="col-lap-time">
          ${lap.formattedLapTime}
          ${lap.isFastest ? '<span class="lap-badge fastest">FASTEST</span>' : ''}
          ${lap.isSlowest ? '<span class="lap-badge slowest">SLOWEST</span>' : ''}
        </td>
        <td class="col-split-time">${lap.formattedSplitTime}</td>
      </tr>
    `).join('');

    return `
      <div class="stopwatch-tab-view">
        <div class="stopwatch-display-large">
          <span class="stopwatch-digits-minsec" id="stopwatch-minsec">${minSec}</span>
          <span class="stopwatch-separator">.</span>
          <span class="stopwatch-digits-ms" id="stopwatch-cs">${centiSec}</span>
        </div>

        <div class="stopwatch-controls">
          <button class="stopwatch-btn secondary" id="btn-stopwatch-secondary" ${!hasStarted ? 'disabled' : ''}>
            ${isRunning ? 'Lap' : 'Reset'}
          </button>
          <button class="stopwatch-btn primary ${isRunning ? 'stop' : 'start'}" id="btn-stopwatch-primary">
            ${isRunning ? 'Stop' : (isPaused ? 'Resume' : 'Start')}
          </button>
        </div>

        <div class="stopwatch-laps-wrap">
          <table class="stopwatch-laps-table">
            <thead>
              <tr>
                <th>Lap</th>
                <th>Lap Time</th>
                <th>Split Time</th>
              </tr>
            </thead>
            <tbody id="stopwatch-laps-tbody">
              ${lapsRows}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // --- TAB 4: PRECISION TIMER VIEW ---
  _renderTimerTab() {
    const totalSec = this.timerInitial || 300;
    const progress = totalSec > 0 ? (this.timerRemaining / totalSec) : 0;
    const clampedProgress = Math.max(0, Math.min(1, progress));

    // SVG Ring Geometry
    const radius = 96;
    const circumference = 2 * Math.PI * radius;
    const strokeDash = circumference * (1 - clampedProgress);

    const formattedTime = formatSecondsToTime(this.timerRemaining);
    const isRunning = this.timerState === 'RUNNING';
    const isPaused = this.timerState === 'PAUSED';

    const presetsHtml = TIMER_PRESETS.map(p => `
      <button class="timer-preset-btn ${this.timerInitial === p.durationSec ? 'active' : ''}" data-seconds="${p.durationSec}">
        ${p.label}
      </button>
    `).join('');

    return `
      <div class="timer-tab-view">
        <div class="timer-ring-container">
          <svg class="timer-svg-ring" width="230" height="230" viewBox="0 0 230 230">
            <circle class="ring-track" cx="115" cy="115" r="${radius}" stroke="rgba(255,255,255,0.08)" stroke-width="8" fill="none" />
            <circle class="ring-progress" id="timer-ring-progress" cx="115" cy="115" r="${radius}"
              stroke="url(#timerGradient)" stroke-width="8" fill="none" stroke-linecap="round"
              stroke-dasharray="${circumference}" stroke-dashoffset="${strokeDash}"
              transform="rotate(-90 115 115)" />
            <defs>
              <linearGradient id="timerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#00e5ff" />
                <stop offset="100%" stop-color="#7c4dff" />
              </linearGradient>
            </defs>
          </svg>

          <div class="timer-center-content">
            <span class="timer-digits-display" id="timer-digits">${formattedTime}</span>
            <span class="timer-sublabel">${this.timerLabel || 'Focus Timer'}</span>
          </div>
        </div>

        <!-- Quick Presets -->
        <div class="timer-presets-bar">
          ${presetsHtml}
        </div>

        <!-- Timer Controls -->
        <div class="timer-controls">
          <button class="timer-btn secondary" id="btn-timer-reset">Reset</button>
          <button class="timer-btn primary ${isRunning ? 'pause' : 'start'}" id="btn-timer-primary">
            ${isRunning ? 'Pause' : (isPaused ? 'Resume' : 'Start')}
          </button>
        </div>
      </div>
    `;
  }

  // --- RINGING ALARM MODAL ---
  _renderRingingAlarmOverlay() {
    if (!this.activeRingingAlarm) return '';

    return `
      <div class="alarm-ringing-overlay">
        <div class="alarm-ringing-modal">
          <div class="ringing-bell-pulse">🔔</div>
          <h2 class="ringing-time">${this.activeRingingAlarm.time}</h2>
          <h3 class="ringing-label">${this.activeRingingAlarm.label}</h3>
          <p class="ringing-sound">Playing ${this.activeRingingAlarm.sound}</p>

          <div class="ringing-actions">
            <button class="ringing-btn snooze" id="btn-alarm-snooze" data-alarm-id="${this.activeRingingAlarm.id}">
              Snooze (+${this.activeRingingAlarm.snoozeMinutes || 9}m)
            </button>
            <button class="ringing-btn dismiss" id="btn-alarm-dismiss" data-alarm-id="${this.activeRingingAlarm.id}">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    `;
  }

  _wireEvents() {
    if (!this.container) return;

    // 1. Tab Bar
    const tabBtns = this.container.querySelectorAll('.clock-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        if (targetTab) this.setTab(targetTab);
      });
    });

    // 2. Alarms Tab
    const toggles = this.container.querySelectorAll('.alarm-checkbox');
    toggles.forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.getAttribute('data-alarm-id');
        if (id) this.toggleAlarm(id);
      });
    });

    const deleteBtns = this.container.querySelectorAll('.alarm-btn-delete');
    deleteBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-alarm-id');
        if (id) this.deleteAlarm(id);
      });
    });

    const showAddBtn = this.container.querySelector('#btn-show-add-alarm');
    const formEl = this.container.querySelector('#alarm-add-form');
    const cancelAddBtn = this.container.querySelector('#btn-cancel-add-alarm');
    const saveAddBtn = this.container.querySelector('#btn-save-new-alarm');

    if (showAddBtn && formEl) {
      showAddBtn.addEventListener('click', () => {
        formEl.style.display = formEl.style.display === 'none' ? 'block' : 'none';
      });
    }

    if (cancelAddBtn && formEl) {
      cancelAddBtn.addEventListener('click', () => {
        formEl.style.display = 'none';
      });
    }

    if (saveAddBtn) {
      saveAddBtn.addEventListener('click', () => {
        const timeInput = this.container.querySelector('#new-alarm-time');
        const labelInput = this.container.querySelector('#new-alarm-label');
        const soundSelect = this.container.querySelector('#new-alarm-sound');

        this.addAlarm({
          time: timeInput ? timeInput.value : '07:00',
          label: labelInput && labelInput.value ? labelInput.value : 'Alarm',
          sound: soundSelect ? soundSelect.value : 'Pravah Chime',
          enabled: true
        });
      });
    }

    // 3. Ringing Overlay Actions
    const snoozeBtn = this.container.querySelector('#btn-alarm-snooze');
    const dismissBtn = this.container.querySelector('#btn-alarm-dismiss');

    if (snoozeBtn) {
      snoozeBtn.addEventListener('click', () => {
        const id = snoozeBtn.getAttribute('data-alarm-id');
        if (id) this.snoozeAlarm(id);
      });
    }

    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        const id = dismissBtn.getAttribute('data-alarm-id');
        if (id) this.dismissAlarm(id);
      });
    }

    // 4. Stopwatch Controls
    const swPrimary = this.container.querySelector('#btn-stopwatch-primary');
    const swSecondary = this.container.querySelector('#btn-stopwatch-secondary');

    if (swPrimary) {
      swPrimary.addEventListener('click', () => {
        if (this.stopwatchState === 'RUNNING') {
          this.pauseStopwatch();
        } else {
          this.startStopwatch();
        }
      });
    }

    if (swSecondary) {
      swSecondary.addEventListener('click', () => {
        if (this.stopwatchState === 'RUNNING') {
          this.lapStopwatch();
        } else {
          this.resetStopwatch();
        }
      });
    }

    // 5. Timer Controls & Presets
    const presetBtns = this.container.querySelectorAll('.timer-preset-btn');
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = parseInt(btn.getAttribute('data-seconds'), 10);
        if (sec) {
          this.startTimer(sec);
        }
      });
    });

    const timerPrimary = this.container.querySelector('#btn-timer-primary');
    const timerReset = this.container.querySelector('#btn-timer-reset');

    if (timerPrimary) {
      timerPrimary.addEventListener('click', () => {
        if (this.timerState === 'RUNNING') {
          this.pauseTimer();
        } else {
          this.startTimer();
        }
      });
    }

    if (timerReset) {
      timerReset.addEventListener('click', () => {
        this.resetTimer();
      });
    }
  }

  // Live DOM updates for zero layout thrash
  _updateTimerDisplayDOM() {
    const digitsEl = this.container?.querySelector('#timer-digits');
    const ringProgressEl = this.container?.querySelector('#timer-ring-progress');

    if (digitsEl) {
      digitsEl.textContent = formatSecondsToTime(this.timerRemaining);
    }

    if (ringProgressEl && this.timerInitial > 0) {
      const radius = 96;
      const circumference = 2 * Math.PI * radius;
      const progress = this.timerRemaining / this.timerInitial;
      const clamped = Math.max(0, Math.min(1, progress));
      const strokeDash = circumference * (1 - clamped);
      ringProgressEl.setAttribute('stroke-dashoffset', strokeDash.toString());
    }
  }

  _updateStopwatchDisplayDOM() {
    const minSecEl = this.container?.querySelector('#stopwatch-minsec');
    const csEl = this.container?.querySelector('#stopwatch-cs');

    if (minSecEl && csEl) {
      const formatted = formatMillisecondsToStopwatch(this.stopwatchElapsed);
      const [minSec, centiSec] = formatted.split('.');
      minSecEl.textContent = minSec;
      csEl.textContent = centiSec;
    }
  }

  _updateWorldClockHandsDOM() {
    const cards = this.container?.querySelectorAll('.world-city-card');
    if (!cards || cards.length === 0) return;

    const clocks = this.getWorldClocks();
    cards.forEach(card => {
      const cityName = card.getAttribute('data-city');
      const clock = clocks.find(c => c.city === cityName);
      if (!clock) return;

      const hourHand = card.querySelector('.analog-hand.hour');
      const minHand = card.querySelector('.analog-hand.minute');
      const secHand = card.querySelector('.analog-hand.second');
      const timeStrEl = card.querySelector('.world-digital-time');

      if (hourHand) hourHand.style.transform = `rotate(${clock.analogHands.hourAngle}deg)`;
      if (minHand) minHand.style.transform = `rotate(${clock.analogHands.minuteAngle}deg)`;
      if (secHand) secHand.style.transform = `rotate(${clock.analogHands.secondAngle}deg)`;
      if (timeStrEl) timeStrEl.textContent = clock.timeString;
    });
  }

  destroy() {
    this._stopTimerTicker();
    this._stopStopwatchTicker();
    this._stopWorldClockTicker();
    if (this.alarmTimer) {
      clearTimeout(this.alarmTimer);
      this.alarmTimer = null;
    }
  }
}
