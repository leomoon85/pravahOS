// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file emulator.js
 * PravahOS Graphical Mobile Phone Emulator Window & Device Shell Subsystem.
 * Provides touch/gesture decoding, FIDL input bridging, hardware status HUD,
 * and linear framebuffer rasterization.
 */

// ============================================================================
// 1. FIDL Constants & Protocols (aligned with sdk/fidl/pravah.input/input.fidl)
// ============================================================================

const DeviceType = {
  UNKNOWN: 0,
  KEYBOARD: 1,
  MOUSE: 2,
  TOUCHSCREEN: 3,
  TOUCHPAD: 4,
  VIRTIO_INPUT: 5
};

const InputEventType = {
  NONE: 0,
  KEY: 1,
  POINTER: 2,
  TOUCH: 3,
  GESTURE: 4
};

const TouchPhase = {
  DOWN: 1,
  MOVE: 2,
  UP: 3,
  CANCEL: 4
};

const KeyAction = {
  RELEASE: 0,
  PRESS: 1,
  REPEAT: 2
};

const GestureType = {
  NONE: 0,
  TAP: 1,
  DOUBLE_TAP: 2,
  LONG_PRESS: 3,
  SWIPE_UP: 4,
  SWIPE_DOWN: 5,
  SWIPE_LEFT: 6,
  SWIPE_RIGHT: 7,
  PINCH_ZOOM: 8,
  EDGE_BACK_LEFT: 9,
  EDGE_BACK_RIGHT: 10
};

const GestureLabels = [
  'NONE',
  'TAP',
  'DOUBLE_TAP',
  'LONG_PRESS',
  'SWIPE_UP',
  'SWIPE_DOWN',
  'SWIPE_LEFT',
  'SWIPE_RIGHT',
  'PINCH_ZOOM',
  'EDGE_BACK_LEFT',
  'EDGE_BACK_RIGHT'
];

const DevicePresets = {
  'pixel8': { name: 'Pravah Phone 1 (Default)', width: 412, height: 915, ratio: '20:9', radius: 44, formFactor: 'candybar', hingeAngle: 0 },
  'iphone15': { name: 'Pravah Mini', width: 390, height: 844, ratio: '19.5:9', radius: 48, formFactor: 'candybar', hingeAngle: 0 },
  'hdplus': { name: 'Pravah HD+ Panel', width: 720, height: 1600, ratio: '20:9', radius: 40, formFactor: 'candybar', hingeAngle: 0 },
  'passport': { name: 'Pravah Passport Fold (Unfolded 4:3)', width: 780, height: 680, ratio: '4:3', radius: 36, formFactor: 'passport', hingeAngle: 180 },
  'flex': { name: 'Pravah Flex Tabletop (90°)', width: 480, height: 720, ratio: 'flex', radius: 36, formFactor: 'flex', hingeAngle: 90 },
  'flip_cover': { name: 'Pravah Flip Cover (Outer Screen)', width: 380, height: 420, ratio: '1:1', radius: 32, formFactor: 'flip_cover', hingeAngle: 0 }
};

// ============================================================================
// 2. Coordinate Normalization Math
// ============================================================================

/**
 * Normalizes raw digitizer counts (e.g. 0..32767) into screen pixel coordinates.
 * Formula: screen = floor((clamp(raw, min, max) - min) * (dim - 1) / (max - min))
 */
function normalizeCoordinate(val, rawMin, rawMax, displayDim, invert = false) {
  const clamped = Math.max(rawMin, Math.min(rawMax, val));
  let normalized = Math.floor(((clamped - rawMin) * (displayDim - 1)) / (rawMax - rawMin));
  if (invert) {
    normalized = displayDim - 1 - normalized;
  }
  return normalized;
}

/**
 * Integer Euclidean distance: dist = round(sqrt(dx*dx + dy*dy))
 */
function integerDistance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

// ============================================================================
// 3. Gesture Recognition Engine
// ============================================================================

/**
 * Multi-touch gesture decoder implementing the PravahOS kernel gesture state machine.
 */
class GestureDecoder {
  constructor(options = {}) {
    this.tuning = {
      tapMaxDistancePx: options.tapMaxDistancePx ?? 25,
      tapMaxDurationMs: options.tapMaxDurationMs ?? 300,
      doubleTapIntervalMs: options.doubleTapIntervalMs ?? 350,
      doubleTapDistancePx: options.doubleTapDistancePx ?? 35,
      longPressDurationMs: options.longPressDurationMs ?? 500,
      longPressMaxDistPx: options.longPressMaxDistPx ?? 25,
      swipeMinDistancePx: options.swipeMinDistancePx ?? 60,
      swipeMaxDurationMs: options.swipeMaxDurationMs ?? 600,
      pinchMinDeltaPx: options.pinchMinDeltaPx ?? 20,
      edgeSlopPx: options.edgeSlopPx ?? 36,
      screenWidthPx: options.screenWidthPx ?? 412
    };

    /** @type {Map<number, { slot: number, startX: number, startY: number, curX: number, curY: number, startTime: number }>} */
    this.activeTouches = new Map();
    this.lastTap = null; // { x, y, time }
    this.longPressTimer = null;
    this.longPressFired = false;
    this.initialPinchDist = null;

    // Callbacks
    this.onGesture = options.onGesture || (() => {});
    this.onRawTouch = options.onRawTouch || (() => {});

    // Motion Physics Velocity Tracker
    const Motion = (typeof require === 'function')
      ? (() => { try { return require('../ui/motion/spring.js'); } catch (_) { return null; } })()
      : (typeof window !== 'undefined' ? window.PravahMotion : null);
    this.velocityTracker = Motion ? new Motion.VelocityTracker() : null;
  }

  reset() {
    this.activeTouches.clear();
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressFired = false;
    this.initialPinchDist = null;
  }

  /**
   * Process touch down event.
   */
  touchDown(slot, x, y, timestamp = Date.now()) {
    const contact = {
      slot,
      startX: x,
      startY: y,
      curX: x,
      curY: y,
      startTime: timestamp
    };
    this.activeTouches.set(slot, contact);
    this.longPressFired = false;

    if (this.velocityTracker && slot === 0) {
      this.velocityTracker.reset();
      this.velocityTracker.addPoint(x, y, timestamp);
    }

    // Notify raw touch
    this.onRawTouch({ phase: TouchPhase.DOWN, slot, x, y, timestamp });

    // Handle single finger long press trigger
    if (this.activeTouches.size === 1) {
      if (this.longPressTimer) clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => {
        const primary = this.activeTouches.get(slot);
        if (primary && !this.longPressFired) {
          const dist = integerDistance(primary.startX, primary.startY, primary.curX, primary.curY);
          if (dist <= this.tuning.longPressMaxDistPx) {
            this.longPressFired = true;
            const gestureEvent = {
              type: GestureType.LONG_PRESS,
              name: 'LONG_PRESS',
              centerX: primary.curX,
              centerY: primary.curY,
              deltaX: 0,
              deltaY: 0,
              velocityPxSec: 0,
              durationMs: this.tuning.longPressDurationMs,
              scaleMilli: 1000,
              touchCount: 1,
              timestamp
            };
            this.onGesture(gestureEvent);
          }
        }
      }, this.tuning.longPressDurationMs);
    } else if (this.activeTouches.size === 2) {
      // Two fingers: init pinch distance
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      const [t0, t1] = Array.from(this.activeTouches.values());
      this.initialPinchDist = integerDistance(t0.curX, t0.curY, t1.curX, t1.curY);
    }
  }

  /**
   * Process touch move event.
   */
  touchMove(slot, x, y, timestamp = Date.now()) {
    const contact = this.activeTouches.get(slot);
    if (!contact) return;

    contact.curX = x;
    contact.curY = y;

    if (this.velocityTracker && slot === 0) {
      this.velocityTracker.addPoint(x, y, timestamp);
    }

    // Check long-press invalidation due to drift
    if (this.activeTouches.size === 1 && !this.longPressFired) {
      const drift = integerDistance(contact.startX, contact.startY, x, y);
      if (drift > this.tuning.longPressMaxDistPx && this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    }

    this.onRawTouch({ phase: TouchPhase.MOVE, slot, x, y, timestamp });

    // Check multi-touch pinch
    if (this.activeTouches.size === 2 && this.initialPinchDist && this.initialPinchDist > 0) {
      const [t0, t1] = Array.from(this.activeTouches.values());
      const currentDist = integerDistance(t0.curX, t0.curY, t1.curX, t1.curY);
      const deltaDist = Math.abs(currentDist - this.initialPinchDist);

      if (deltaDist >= this.tuning.pinchMinDeltaPx) {
        const centerX = Math.round((t0.curX + t1.curX) / 2);
        const centerY = Math.round((t0.curY + t1.curY) / 2);
        const scaleMilli = Math.round((currentDist / this.initialPinchDist) * 1000);

        const gestureEvent = {
          type: GestureType.PINCH_ZOOM,
          name: 'PINCH_ZOOM',
          centerX,
          centerY,
          deltaX: currentDist - this.initialPinchDist,
          deltaY: 0,
          velocityPxSec: 0,
          durationMs: timestamp - contact.startTime,
          scaleMilli,
          touchCount: 2,
          timestamp
        };
        this.onGesture(gestureEvent);
      }
    }
  }

  /**
   * Process touch up event and evaluate tap/double-tap/swipe gestures.
   */
  touchUp(slot, x, y, timestamp = Date.now()) {
    const contact = this.activeTouches.get(slot);
    if (!contact) return null;

    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    this.onRawTouch({ phase: TouchPhase.UP, slot, x, y, timestamp });

    let detectedGesture = null;

    if (this.activeTouches.size === 1 && !this.longPressFired) {
      const duration = timestamp - contact.startTime;
      const dist = integerDistance(contact.startX, contact.startY, x, y);
      const deltaX = x - contact.startX;
      const deltaY = y - contact.startY;

      // 1. Check Tap or Double Tap
      if (dist <= this.tuning.tapMaxDistancePx && duration <= this.tuning.tapMaxDurationMs) {
        if (this.lastTap) {
          const tapInterval = timestamp - this.lastTap.time;
          const tapDistance = integerDistance(this.lastTap.x, this.lastTap.y, x, y);

          if (tapInterval <= this.tuning.doubleTapIntervalMs && tapDistance <= this.tuning.doubleTapDistancePx) {
            detectedGesture = {
              type: GestureType.DOUBLE_TAP,
              name: 'DOUBLE_TAP',
              centerX: x,
              centerY: y,
              deltaX: 0,
              deltaY: 0,
              velocityPxSec: 0,
              durationMs: duration,
              scaleMilli: 1000,
              touchCount: 1,
              timestamp
            };
            this.lastTap = null;
          }
        }

        if (!detectedGesture) {
          detectedGesture = {
            type: GestureType.TAP,
            name: 'TAP',
            centerX: x,
            centerY: y,
            deltaX: 0,
            deltaY: 0,
            velocityPxSec: 0,
            durationMs: duration,
            scaleMilli: 1000,
            touchCount: 1,
            timestamp
          };
          this.lastTap = { x, y, time: timestamp };
        }
      }
      // 2. Check Directional Swipes
      else if (dist >= this.tuning.swipeMinDistancePx && duration <= this.tuning.swipeMaxDurationMs) {
        if (this.velocityTracker && slot === 0) {
          this.velocityTracker.addPoint(x, y, timestamp);
        }

        let velocity = Math.round((dist / (duration || 1)) * 1000);
        let vx = Math.round((deltaX / (duration || 1)) * 1000);
        let vy = Math.round((deltaY / (duration || 1)) * 1000);

        if (this.velocityTracker) {
          const v = this.velocityTracker.getVelocity();
          if (v.speed > 0) {
            velocity = Math.round(v.speed);
            vx = Math.round(v.vx);
            vy = Math.round(v.vy);
          }
        }

        let swipeType = GestureType.NONE;
        let swipeName = 'NONE';

        if (Math.abs(deltaX) >= Math.abs(deltaY)) {
          const edgeSlop = this.tuning.edgeSlopPx ?? 36;
          const screenWidth = this.tuning.screenWidthPx ?? 412;
          if (contact.startX <= edgeSlop && deltaX > 0) {
            swipeType = GestureType.EDGE_BACK_LEFT;
            swipeName = 'EDGE_BACK_LEFT';
          } else if (contact.startX >= screenWidth - edgeSlop && deltaX < 0) {
            swipeType = GestureType.EDGE_BACK_RIGHT;
            swipeName = 'EDGE_BACK_RIGHT';
          } else if (deltaX > 0) {
            swipeType = GestureType.SWIPE_RIGHT;
            swipeName = 'SWIPE_RIGHT';
          } else {
            swipeType = GestureType.SWIPE_LEFT;
            swipeName = 'SWIPE_LEFT';
          }
        } else {
          if (deltaY > 0) {
            swipeType = GestureType.SWIPE_DOWN;
            swipeName = 'SWIPE_DOWN';
          } else {
            swipeType = GestureType.SWIPE_UP;
            swipeName = 'SWIPE_UP';
          }
        }

        detectedGesture = {
          type: swipeType,
          name: swipeName,
          centerX: Math.round((contact.startX + x) / 2),
          centerY: Math.round((contact.startY + y) / 2),
          deltaX,
          deltaY,
          vx,
          vy,
          velocityPxSec: velocity,
          durationMs: duration,
          scaleMilli: 1000,
          touchCount: 1,
          timestamp
        };
      }
    }

    this.activeTouches.delete(slot);
    if (this.activeTouches.size === 0) {
      this.initialPinchDist = null;
      this.longPressFired = false;
    }

    if (detectedGesture) {
      this.onGesture(detectedGesture);
    }

    return detectedGesture;
  }
}

// ============================================================================
// 4. Input Event Bridge (FIDL Packaging & Iframe Dispatcher)
// ============================================================================

/**
 * Packages touch and gesture inputs into FIDL InputEvent envelopes and dispatches
 * them to PravahOS Dynamic Experience Shell or external listeners.
 */
class InputEventBridge {
  constructor(options = {}) {
    this.deviceId = options.deviceId || 'emulator-touchscreen-0';
    this.deviceType = options.deviceType ?? DeviceType.TOUCHSCREEN;
    this.targetIframe = options.targetIframe || null;
    this.onEventEmitted = options.onEventEmitted || (() => {});
    this.eventLog = [];
    this.maxLogEntries = options.maxLogEntries || 100;
  }

  /**
   * Constructs a typed FIDL InputEvent envelope.
   */
  packageEvent(eventType, payload) {
    const timestampNs = BigInt(Date.now()) * 1000000n;
    const event = {
      timestampNs: timestampNs.toString(),
      deviceId: this.deviceId,
      deviceType: this.deviceType,
      eventType,
      payload
    };

    this.eventLog.unshift(event);
    if (this.eventLog.length > this.maxLogEntries) {
      this.eventLog.pop();
    }

    this.onEventEmitted(event);
    this.dispatchToIframe(event);
    return event;
  }

  packageTouchEvent(phase, slot, screenX, screenY, rawX = null, rawY = null, pressure = 512) {
    const touchPoint = {
      slot,
      trackingId: slot + 100,
      screenX: Math.round(screenX),
      screenY: Math.round(screenY),
      rawX: rawX ?? Math.round((screenX / 412) * 32767),
      rawY: rawY ?? Math.round((screenY / 915) * 32767),
      pressure
    };

    return this.packageEvent(InputEventType.TOUCH, {
      touch: {
        phase,
        point: touchPoint
      }
    });
  }

  packageGestureEvent(gesture) {
    return this.packageEvent(InputEventType.GESTURE, {
      gesture: {
        type: gesture.type,
        name: gesture.name,
        centerX: gesture.centerX,
        centerY: gesture.centerY,
        deltaX: gesture.deltaX,
        deltaY: gesture.deltaY,
        velocityPxSec: gesture.velocityPxSec,
        durationMs: gesture.durationMs,
        scaleMilli: gesture.scaleMilli,
        touchCount: gesture.touchCount
      }
    });
  }

  packageKeyEvent(action, keycode, modifiers = 0) {
    return this.packageEvent(InputEventType.KEY, {
      key: {
        action,
        keycode,
        modifiers
      }
    });
  }

  dispatchToIframe(event) {
    if (!this.targetIframe || !this.targetIframe.contentWindow) return;
    try {
      this.targetIframe.contentWindow.postMessage({
        type: 'PRAVAH_INPUT_EVENT',
        event
      }, '*');
    } catch (_) {}
  }
}

// ============================================================================
// 5. Hardware HUD & Telemetry State
// ============================================================================

/**
 * Manages device hardware telemetry: battery, 5G signal, SoC thermals, NPU/CPU dials,
 * and physical Air-Gap state.
 */
class HardwareHUD {
  constructor(options = {}) {
    this.state = {
      battery: {
        level: options.batteryLevel ?? 88,
        charging: options.charging ?? false,
        tempC: 34
      },
      radio: {
        airgap: options.airgap ?? true, // Secure offline by default per PravahOS mandate
        signalBars: 4,
        networkName: (options.airgap ?? true) ? 'AIR-GAP ISOLATED' : '5G UW',
        wifiEnabled: !(options.airgap ?? true)
      },
      thermal: {
        tempC: options.tempC ?? 41,
        throttleState: 'NOMINAL' // NOMINAL, WARM, THROTTLING, CRITICAL
      },
      npu: {
        utilization: options.npuLoad ?? 42,
        tensorsPerSec: 128
      },
      cpu: {
        utilization: options.cpuLoad ?? 19,
        freqGhz: 2.84
      },
      memory: {
        usedMb: 468,
        totalMb: 2048
      },
      screen: {
        powered: true,
        brightness: 90
      },
      volume: options.volume ?? 75,
      authority: options.authority || 'EXECUTE'
    };

    this.onStateChange = options.onStateChange || (() => {});
    this.updateThermalState();
  }

  setAirGap(offline) {
    this.state.radio.airgap = Boolean(offline);
    this.state.radio.wifiEnabled = !offline;
    this.state.radio.networkName = offline ? 'AIR-GAP ISOLATED' : '5G UW';
    this.notify();
  }

  toggleAirGap() {
    this.setAirGap(!this.state.radio.airgap);
    return this.state.radio.airgap;
  }

  setBatteryLevel(level, charging = this.state.battery.charging) {
    this.state.battery.level = Math.max(0, Math.min(100, Math.round(level)));
    this.state.battery.charging = Boolean(charging);
    this.notify();
  }

  setThermal(tempC) {
    this.state.thermal.tempC = Math.round(tempC);
    this.updateThermalState();
    this.notify();
  }

  updateThermalState() {
    const t = this.state.thermal.tempC;
    if (t < 48) {
      this.state.thermal.throttleState = 'NOMINAL';
      this.state.thermal.precision = 'INT8';
      this.state.thermal.warningActive = false;
    } else if (t < 62) {
      this.state.thermal.throttleState = 'WARM';
      this.state.thermal.precision = 'INT8';
      this.state.thermal.warningActive = false;
    } else if (t < 75) {
      this.state.thermal.throttleState = 'THROTTLING';
      this.state.thermal.precision = 'INT4';
      this.state.thermal.warningActive = false;
    } else {
      this.state.thermal.throttleState = 'CRITICAL';
      this.state.thermal.precision = 'CPU_FALLBACK';
      this.state.thermal.warningActive = true;
    }
  }

  setWorkload(npuPercent, cpuPercent) {
    this.state.npu.utilization = Math.max(0, Math.min(100, Math.round(npuPercent)));
    this.state.cpu.utilization = Math.max(0, Math.min(100, Math.round(cpuPercent)));
    this.notify();
  }

  setVolume(vol) {
    this.state.volume = Math.max(0, Math.min(100, Math.round(vol)));
    this.notify();
  }

  toggleScreenPower() {
    this.state.screen.powered = !this.state.screen.powered;
    this.notify();
    return this.state.screen.powered;
  }

  notify() {
    this.onStateChange(this.state);
  }
}

// ============================================================================
// 6. Linear Framebuffer Canvas Renderer (bare-metal AArch64 simulation)
// ============================================================================

/**
 * High-DPI Canvas/WebGL-backed linear framebuffer renderer.
 * Simulates PravahOS double-buffered linear presentation engine (DISPLAY.md).
 */
class FramebufferRenderer {
  constructor(canvas, width = 412, height = 915) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.width = width;
    this.height = height;
    this.pixelRatio = (typeof window !== 'undefined' && window.devicePixelRatio) || 2;
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    if (!this.canvas) return;
    this.canvas.width = this.width * this.pixelRatio;
    this.canvas.height = this.height * this.pixelRatio;
    if (this.ctx) {
      this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    }
  }

  /**
   * Renders the authentic PravahOS linear framebuffer boot screen and telemetry card.
   */
  renderBootScreen(telemetry = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#060a12');
    bgGrad.addColorStop(1, '#020408');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Matrix microgrid pattern
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.04)';
    ctx.lineWidth = 1;
    const step = 24;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Centered PravahOS Geometric Ring Logo
    const cx = w / 2;
    const cy = h * 0.32;
    const radius = 48;

    // Outer glow
    const radialGlow = ctx.createRadialGradient(cx, cy, 10, cx, cy, 90);
    radialGlow.addColorStop(0, 'rgba(0, 229, 255, 0.2)');
    radialGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = radialGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, 90, 0, Math.PI * 2);
    ctx.fill();

    // Cyan Neon Hexagon Ring
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const hx = cx + radius * Math.cos(angle);
      const hy = cy + radius * Math.sin(angle);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.stroke();

    // Emblem Letter "P"
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 36px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', cx, cy);

    // Brand Title
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#f0f4f8';
    ctx.fillText('PravahOS', cx, cy + 72);

    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('AARCH64 SECURE MICROKERNEL v0.9.4', cx, cy + 96);

    // Diagnostic Card Box
    const cardX = 24;
    const cardY = cy + 130;
    const cardW = w - 48;
    const cardH = 240;

    ctx.fillStyle = 'rgba(14, 21, 36, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.stroke();

    // Card Header
    ctx.fillStyle = '#7c4dff';
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('// HARDWARE DIAGNOSTICS & TRUST ROOT', cardX + 16, cardY + 24);

    // Diagnostic rows
    const rows = [
      ['CPU ARCH:', 'ARMv9 Cortex-A78 • 8 Cores (EL1)'],
      ['PMM DRAM:', '4,096 MiB (Zeroed Framebuffer)'],
      ['GIC VERSION:', 'GICv3 Distributed Routing'],
      ['AIR-GAP STATE:', telemetry.airgap ? 'HARDWARE ISOLATED [ENFORCED]' : 'ONLINE CONNECTED'],
      ['NPU ENGINE:', `${telemetry.npu ?? 42}% LOAD • 128 Tensors/s`],
      ['THERMAL SENSOR:', `${telemetry.temp ?? 41}°C [NOMINAL]`],
      ['DISPLAY RASTER:', `${w}x${h} ARGB8888 60Hz VSYNC`]
    ];

    ctx.font = '10px "JetBrains Mono", monospace';
    rows.forEach((row, idx) => {
      const ry = cardY + 54 + idx * 24;
      ctx.fillStyle = '#64748b';
      ctx.fillText(row[0], cardX + 16, ry);
      ctx.fillStyle = idx === 3 && telemetry.airgap ? '#00e676' : '#e2e8f0';
      ctx.fillText(row[1], cardX + 115, ry);
    });

    // Boot progress bar
    const barY = cardY + cardH + 32;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    this.roundRect(ctx, cardX, barY, cardW, 6, 3);
    ctx.fill();

    const progGrad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
    progGrad.addColorStop(0, '#00e5ff');
    progGrad.addColorStop(1, '#7c4dff');
    ctx.fillStyle = progGrad;
    this.roundRect(ctx, cardX, barY, cardW * 0.92, 6, 3);
    ctx.fill();

    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText('Dynamic Experience Shell Ready', cx, barY + 24);
  }

  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

// ============================================================================
// 7. Full Phone Emulator Application Controller
// ============================================================================

class PhoneEmulatorApp {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = options;
    this.presetKey = options.preset || 'pixel8';
    this.preset = DevicePresets[this.presetKey] || DevicePresets.pixel8;
    this.mode = 'shell'; // 'shell' (iframe DEC) or 'framebuffer' (raw scanout)
    this.orientation = 'portrait';
    this.scale = options.scale || 1.0;

    // Gesture & input decoder
    this.gestureDecoder = new GestureDecoder({
      onGesture: (g) => this.handleGestureRecognized(g),
      onRawTouch: (t) => this.handleRawTouch(t)
    });

    // Hardware HUD
    this.hud = new HardwareHUD({
      onStateChange: (state) => this.renderHUD(state)
    });

    // Event bridge
    this.bridge = new InputEventBridge({
      onEventEmitted: (event) => this.renderEventLog(event)
    });

    // Sensory Feeds & Mobile HAL Bridge
    const Sensory = (typeof require === 'function')
      ? (() => { try { return require('./sensory_bridge.js'); } catch (_) { return null; } })()
      : (typeof window !== 'undefined' ? window.SensoryBridge : null);

    if (Sensory && Sensory.SensoryBridge) {
      this.sensory = new Sensory.SensoryBridge({
        airgap: { initialState: this.hud.state.radio.airgap },
        thermal: { initialTempC: this.hud.state.thermal.tempC }
      });
    } else {
      this.sensory = null;
    }

    // AOT Capability Installer & Dormancy Supervisor Subsystem
    const AotModule = (typeof require === 'function')
      ? (() => { try { return require('./installer.js'); } catch (_) { return null; } })()
      : (typeof window !== 'undefined' ? window.PravahAotInstaller : null);

    if (AotModule && AotModule.DormancySupervisor) {
      this.dormancySupervisor = new AotModule.DormancySupervisor();
    } else {
      this.dormancySupervisor = null;
    }

    // Touch visualization state
    this.touchTrails = [];
    this.simulatedPinch = false;
    this.altKeyDown = false;

    if (this.container) {
      this.initDOM();
      this.bindEvents();
      this.startClock();
      this.hud.notify();
    }
  }

  initDOM() {
    this.iframe = this.container.querySelector('#shell-frame');
    this.touchCanvas = this.container.querySelector('#touch-overlay');
    this.fbCanvas = this.container.querySelector('#framebuffer-canvas');
    this.dynamicIsland = this.container.querySelector('#dynamic-island');
    if (this.dynamicIsland && window.PravahIsland?.DynamicIslandController) {
      this.islandController = new window.PravahIsland.DynamicIslandController(this.dynamicIsland);
    }
    this.screenOverlay = this.container.querySelector('#screen-overlay');
    this.volumePopup = this.container.querySelector('#volume-popup');
    this.powerModal = this.container.querySelector('#power-modal');

    // Sensory DOM elements
    this.cameraLayer = this.container.querySelector('#camera-viewfinder-layer');
    this.cameraCanvas = this.container.querySelector('#camera-viewfinder-canvas');
    this.audioCanvas = this.container.querySelector('#audio-visualizer-canvas');
    this.thermalWarningHud = this.container.querySelector('#thermal-warning-hud');

    if (this.bridge && this.iframe) {
      this.bridge.targetIframe = this.iframe;
    }

    if (this.fbCanvas) {
      this.fbRenderer = new FramebufferRenderer(this.fbCanvas, this.preset.width, this.preset.height);
      this.fbRenderer.renderBootScreen(this.hud.state);
    }

    this.initTouchCanvas();

    // Start sensory feeds animation loops
    if (this.sensory && (this.cameraCanvas || this.audioCanvas)) {
      this.sensory.startAnimationLoops(this.cameraCanvas, this.audioCanvas);
    }
  }

  initTouchCanvas() {
    if (!this.touchCanvas) return;
    this.touchCanvas.width = this.preset.width;
    this.touchCanvas.height = this.preset.height;
    this.touchCtx = this.touchCanvas.getContext('2d');
  }

  bindEvents() {
    // 1. Mouse / Touch tracking on the phone screen viewport
    const viewport = this.container.querySelector('#phone-viewport');
    if (!viewport) return;

    let isPointerDown = false;
    let pinchCenter = null;

    const getScreenCoords = (e) => {
      const rect = viewport.getBoundingClientRect();
      const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
      const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY);
      const x = Math.round(((clientX - rect.left) / rect.width) * this.preset.width);
      const y = Math.round(((clientY - rect.top) / rect.height) * this.preset.height);
      return { x, y };
    };

    // Track Alt / Shift key for simulated multi-touch pinch
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt' || e.key === 'Shift') {
        this.altKeyDown = true;
        this.updatePinchVisuals();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt' || e.key === 'Shift') {
        this.altKeyDown = false;
        this.updatePinchVisuals();
      }
    });

    viewport.addEventListener('mousedown', (e) => {
      if (!this.hud.state.screen.powered) return;
      isPointerDown = true;
      const { x, y } = getScreenCoords(e);

      if (this.altKeyDown || this.simulatedPinch) {
        // Multi-touch 2-finger pinch simulation
        pinchCenter = { x, y };
        const offset = 40;
        this.gestureDecoder.touchDown(0, x - offset, y, Date.now());
        this.gestureDecoder.touchDown(1, x + offset, y, Date.now());
        this.bridge.packageTouchEvent(TouchPhase.DOWN, 0, x - offset, y);
        this.bridge.packageTouchEvent(TouchPhase.DOWN, 1, x + offset, y);
      } else {
        this.gestureDecoder.touchDown(0, x, y, Date.now());
        this.bridge.packageTouchEvent(TouchPhase.DOWN, 0, x, y);
      }
      this.drawTouchIndicators();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isPointerDown || !this.hud.state.screen.powered) return;
      const { x, y } = getScreenCoords(e);

      if ((this.altKeyDown || this.simulatedPinch) && pinchCenter) {
        const dx = x - pinchCenter.x;
        const offset = Math.max(10, 40 + Math.abs(dx));
        this.gestureDecoder.touchMove(0, pinchCenter.x - offset, pinchCenter.y, Date.now());
        this.gestureDecoder.touchMove(1, pinchCenter.x + offset, pinchCenter.y, Date.now());
        this.bridge.packageTouchEvent(TouchPhase.MOVE, 0, pinchCenter.x - offset, pinchCenter.y);
        this.bridge.packageTouchEvent(TouchPhase.MOVE, 1, pinchCenter.x + offset, pinchCenter.y);
      } else {
        this.gestureDecoder.touchMove(0, x, y, Date.now());
        this.bridge.packageTouchEvent(TouchPhase.MOVE, 0, x, y);
      }
      this.drawTouchIndicators();
    });

    window.addEventListener('mouseup', (e) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      const { x, y } = getScreenCoords(e);

      if ((this.altKeyDown || this.simulatedPinch) && pinchCenter) {
        const offset = 40;
        this.gestureDecoder.touchUp(0, pinchCenter.x - offset, pinchCenter.y, Date.now());
        this.gestureDecoder.touchUp(1, pinchCenter.x + offset, pinchCenter.y, Date.now());
        this.bridge.packageTouchEvent(TouchPhase.UP, 0, pinchCenter.x - offset, pinchCenter.y);
        this.bridge.packageTouchEvent(TouchPhase.UP, 1, pinchCenter.x + offset, pinchCenter.y);
        pinchCenter = null;
      } else {
        this.gestureDecoder.touchUp(0, x, y, Date.now());
        this.bridge.packageTouchEvent(TouchPhase.UP, 0, x, y);
      }
      this.drawTouchIndicators();
    });

    // Mouse wheel with Ctrl/Alt for pinch zoom simulation
    viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault();
        const { x, y } = getScreenCoords(e);
        const scale = e.deltaY < 0 ? 1150 : 850;
        const gestureEvent = {
          type: GestureType.PINCH_ZOOM,
          name: 'PINCH_ZOOM',
          centerX: x,
          centerY: y,
          deltaX: e.deltaY < 0 ? 30 : -30,
          deltaY: 0,
          velocityPxSec: 0,
          durationMs: 150,
          scaleMilli: scale,
          touchCount: 2,
          timestamp: Date.now()
        };
        this.handleGestureRecognized(gestureEvent);
      }
    }, { passive: false });

    // 2. Hardware Button bindings
    const btnPower = this.container.querySelector('#btn-hw-power');
    const btnVolUp = this.container.querySelector('#btn-hw-vol-up');
    const btnVolDown = this.container.querySelector('#btn-hw-vol-down');
    const btnAirGap = this.container.querySelector('#btn-hw-airgap');

    let powerPressTimer = null;

    if (btnPower) {
      btnPower.addEventListener('mousedown', () => {
        btnPower.classList.add('pressed');
        powerPressTimer = setTimeout(() => {
          this.showPowerModal();
        }, 850);
      });

      const releasePower = () => {
        btnPower.classList.remove('pressed');
        if (powerPressTimer) {
          clearTimeout(powerPressTimer);
          powerPressTimer = null;
          // Normal tap: toggle screen sleep/wake
          this.hud.toggleScreenPower();
        }
      };

      btnPower.addEventListener('mouseup', releasePower);
      btnPower.addEventListener('mouseleave', () => {
        if (powerPressTimer) {
          clearTimeout(powerPressTimer);
          powerPressTimer = null;
        }
        btnPower.classList.remove('pressed');
      });
    }

    if (btnVolUp) {
      btnVolUp.addEventListener('click', () => {
        window.PravahHaptics?.haptics.lightTap();
        this.hud.setVolume(this.hud.state.volume + 10);
        this.showVolumeSlider();
      });
    }

    if (btnVolDown) {
      btnVolDown.addEventListener('click', () => {
        window.PravahHaptics?.haptics.lightTap();
        this.hud.setVolume(this.hud.state.volume - 10);
        this.showVolumeSlider();
      });
    }

    if (btnAirGap) {
      btnAirGap.addEventListener('click', () => {
        window.PravahHaptics?.haptics.heavyWarning();
        const isOffline = this.hud.toggleAirGap();
        this.syncAirGapToShell(isOffline);
        this.pulseDynamicIsland(isOffline ? 'AIR-GAP SECURED' : 'RADIO ONLINE');
      });
    }

    // Dynamic Island is managed by DynamicIslandController if loaded
    if (this.dynamicIsland && !this.islandController) {
      if (window.PravahIsland?.DynamicIslandController) {
        this.islandController = new window.PravahIsland.DynamicIslandController(this.dynamicIsland);
      } else {
        this.dynamicIsland.addEventListener('click', () => {
          this.dynamicIsland.classList.toggle('expanded');
        });
      }
    }

    // Sensory Feeds Bindings (Camera, Audio, Thermal, Air-Gap)
    const btnToggleCam = this.container.querySelector('#btn-toggle-camera');
    const btnOpenCam = this.container.querySelector('#btn-open-camera');
    const btnCamClose = this.container.querySelector('#btn-cam-close');
    const btnCamShutter = this.container.querySelector('#btn-camera-shutter');
    const btnCamSnap = this.container.querySelector('#btn-cam-snap');
    const btnCamFlip = this.container.querySelector('#btn-camera-flip');
    const btnCamSwitchSensor = this.container.querySelector('#btn-cam-switch-sensor');
    const selCamPattern = this.container.querySelector('#cam-pattern-select');
    const btnCamPatternToggle = this.container.querySelector('#btn-cam-pattern-toggle');
    const camSensorPill = this.container.querySelector('#cam-sensor-pill');
    const valCamSensor = this.container.querySelector('#val-cam-sensor');
    const valCamSnaps = this.container.querySelector('#val-cam-snaps');

    const toggleCameraLayer = (force) => {
      if (!this.cameraLayer) return;
      const willShow = force !== undefined ? force : !this.cameraLayer.classList.contains('active');
      this.cameraLayer.classList.toggle('active', willShow);
      if (btnToggleCam) btnToggleCam.classList.toggle('active', willShow);
    };

    if (btnToggleCam) btnToggleCam.addEventListener('click', () => toggleCameraLayer());
    if (btnOpenCam) btnOpenCam.addEventListener('click', () => toggleCameraLayer(true));
    if (btnCamClose) btnCamClose.addEventListener('click', () => toggleCameraLayer(false));

    const triggerShutter = () => {
      if (!this.sensory) return;
      const photo = this.sensory.camera.capturePhoto();
      if (valCamSnaps) valCamSnaps.textContent = String(this.sensory.camera.capturedPhotos.length);
      this.pulseDynamicIsland(`PHOTO: ${photo.photoId}`);
      const thumb = this.container.querySelector('#gallery-thumb-placeholder');
      if (thumb) thumb.textContent = `IMG #${photo.frameId}`;
    };

    if (btnCamShutter) btnCamShutter.addEventListener('click', triggerShutter);
    if (btnCamSnap) btnCamSnap.addEventListener('click', triggerShutter);

    const switchCameraSensor = () => {
      if (!this.sensory) return;
      this.sensory.camera.switchSensor();
      const sName = this.sensory.camera.getCurrentSensorName();
      if (camSensorPill) camSensorPill.textContent = sName;
      if (valCamSensor) valCamSensor.textContent = sName.split(' ')[0] + ' ' + (this.sensory.camera.isFrontFacing() ? 'FRONT' : 'REAR');
      this.pulseDynamicIsland(`LENS: ${this.sensory.camera.isFrontFacing() ? 'FRONT SELFIE' : 'REAR 50MP'}`);
    };

    if (btnCamFlip) btnCamFlip.addEventListener('click', switchCameraSensor);
    if (btnCamSwitchSensor) btnCamSwitchSensor.addEventListener('click', switchCameraSensor);

    if (selCamPattern) {
      selCamPattern.addEventListener('change', (e) => {
        if (this.sensory) this.sensory.camera.setPattern(e.target.value);
      });
    }

    if (btnCamPatternToggle) {
      btnCamPatternToggle.addEventListener('click', () => {
        if (!this.sensory) return;
        const current = this.sensory.camera.patternType;
        const next = current === 'smpte' ? 'synthetic' : 'smpte';
        this.sensory.camera.setPattern(next);
        if (selCamPattern) selCamPattern.value = next;
        this.pulseDynamicIsland(`PATTERN: ${next.toUpperCase()}`);
      });
    }

    // Zoom pills
    const zoomPills = this.container.querySelectorAll('.zoom-pill');
    zoomPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        zoomPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        const z = parseFloat(pill.getAttribute('data-zoom')) || 1.0;
        if (this.sensory) this.sensory.camera.setZoom(z);
      });
    });

    // Audio Visualizer Buttons
    const btnAudioPlay = this.container.querySelector('#btn-audio-playback');
    const btnAudioMic = this.container.querySelector('#btn-audio-mic');
    const btnAudioMute = this.container.querySelector('#btn-audio-mute');
    const sliderAudioVol = this.container.querySelector('#slider-audio-volume');
    const valAudioVol = this.container.querySelector('#val-audio-volume');

    if (btnAudioPlay) {
      btnAudioPlay.addEventListener('click', () => {
        if (!this.sensory) return;
        this.sensory.audio.startPlayback(440);
        btnAudioPlay.classList.add('active');
        if (btnAudioMic) btnAudioMic.classList.remove('active');
      });
    }

    if (btnAudioMic) {
      btnAudioMic.addEventListener('click', () => {
        if (!this.sensory) return;
        this.sensory.audio.startCapture();
        btnAudioMic.classList.add('active');
        if (btnAudioPlay) btnAudioPlay.classList.remove('active');
      });
    }

    if (btnAudioMute) {
      btnAudioMute.addEventListener('click', () => {
        if (!this.sensory) return;
        const isMuted = this.sensory.audio.setMute(!this.sensory.audio.isMuted);
        btnAudioMute.classList.toggle('active', isMuted);
        btnAudioMute.textContent = isMuted ? '🔊 Unmute' : '🔇 Mute';
      });
    }

    if (sliderAudioVol) {
      sliderAudioVol.addEventListener('input', (e) => {
        const vol = Number(e.target.value);
        if (this.sensory) this.sensory.audio.setMasterVolume(vol);
        this.hud.setVolume(vol);
        if (valAudioVol) valAudioVol.textContent = `${vol}%`;
      });
    }

    // Bidirectional postMessage listener from PravahOS shell iframe
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'PRAVAH_SHELL_TELEMETRY' && data.state) {
        if (typeof data.state.offline === 'boolean') {
          this.hud.state.radio.airgap = data.state.offline;
        }
        if (data.state.authority) {
          this.hud.state.authority = data.state.authority;
        }
        if (data.state.telemetry) {
          this.hud.state.npu.utilization = data.state.telemetry.npu;
          this.hud.state.cpu.utilization = data.state.telemetry.cpu;
          this.hud.state.thermal.tempC = data.state.telemetry.temp;
        }
        this.renderHUD(this.hud.state);
      }

      if (data.type === 'PRAVAH_TORCH_STATE') {
        const torchMod = this.container.querySelector('#phone-torch-module');
        if (torchMod) {
          torchMod.classList.toggle('active', Boolean(data.active));
        }
        this.pulseDynamicIsland(data.active ? 'TORCH ON' : 'TORCH OFF');
      }

      if (data.type === 'PRAVAH_SET_POWER_PROFILE') {
        if (data.profile) {
          this.pulseDynamicIsland(`PWR: ${data.profile} [${data.quantization}]`);
        }
      }

      if (data.type === 'PRAVAH_SET_VOLUME') {
        const vol = Number(data.volume);
        if (!isNaN(vol)) {
          if (this.sensory) this.sensory.audio.setMasterVolume(vol);
          this.hud.setVolume(vol);
          this.showVolumeSlider();
        }
      }

      if (data.type === 'PRAVAH_IME_EVENT') {
        const timeStr = new Date().toLocaleTimeString();
        const list = this.container.querySelector('#fidl-event-list');
        if (list) {
          const row = document.createElement('div');
          row.className = 'event-log-item';
          const summary = data.action === 'KEY_PRESS' 
            ? `Key '${data.key?.value || data.key?.type}' actuated (pravah.input.InputMethodEditor)`
            : (data.action === 'VOICE_COMMIT' ? `Voice Transcribed & Committed: "${data.text}"` : `IME Action: ${data.action}`);
          row.innerHTML = `
            <span class="event-time">${timeStr}</span>
            <span class="event-badge badge-other" style="background: rgba(0, 240, 255, 0.15); color: #00f0ff; border-color: rgba(0, 240, 255, 0.3);">IME</span>
            <span class="event-details">${summary}</span>
          `;
          list.insertBefore(row, list.firstChild);
          while (list.children.length > 25) {
            list.removeChild(list.lastChild);
          }
        }
      }
    });
  }

  startClock() {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const timeEl = this.container.querySelector('#status-time');
      if (timeEl) timeEl.textContent = `${hours}:${mins}`;
    };
    updateTime();
    setInterval(updateTime, 10000);
  }

  syncAirGapToShell(offline) {
    if (this.iframe && this.iframe.contentWindow) {
      try {
        this.iframe.contentWindow.postMessage({
          type: 'PRAVAH_SET_AIRGAP',
          offline
        }, '*');
      } catch (_) {}
    }
  }

  showVolumeSlider() {
    if (!this.volumePopup) return;
    const bar = this.volumePopup.querySelector('.vol-bar-fill');
    if (bar) bar.style.height = `${this.hud.state.volume}%`;
    this.volumePopup.classList.add('visible');
    clearTimeout(this.volTimer);
    this.volTimer = setTimeout(() => {
      this.volumePopup.classList.remove('visible');
    }, 1800);
  }

  showPowerModal() {
    if (this.powerModal) {
      this.powerModal.classList.add('active');
    }
  }

  hidePowerModal() {
    if (this.powerModal) {
      this.powerModal.classList.remove('active');
    }
  }

  pulseDynamicIsland(text) {
    if (this.islandController) {
      this.islandController.transitionTo('COMPACT', { label: text });
      window.PravahHaptics?.haptics.lightTap();
      return;
    }
    if (!this.dynamicIsland) return;
    const textEl = this.dynamicIsland.querySelector('.pill-badge');
    if (textEl) textEl.textContent = text;
    this.dynamicIsland.classList.add('pulsing');
    setTimeout(() => {
      this.dynamicIsland.classList.remove('pulsing');
    }, 2400);
  }

  handleGestureRecognized(gesture) {
    this.bridge.packageGestureEvent(gesture);
    this.pulseDynamicIsland(`${gesture.name} recognized`);

    // Forward velocity-conserving gesture fling to DEC shell iframe
    if (this.iframe && this.iframe.contentWindow) {
      try {
        this.iframe.contentWindow.postMessage({
          type: 'PRAVAH_GESTURE_FLING',
          gesture
        }, '*');

        if (gesture.name === 'EDGE_BACK_LEFT' || gesture.name === 'EDGE_BACK_RIGHT') {
          this.iframe.contentWindow.postMessage({
            type: 'PRAVAH_UNIVERSAL_BACK',
            gesture
          }, '*');
        }
      } catch (_) {}
    }

    // Render gesture indicator on touch canvas
    if (this.touchCtx) {
      const ctx = this.touchCtx;
      ctx.save();
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 3;
      ctx.fillStyle = 'rgba(0, 229, 255, 0.2)';

      if (gesture.name.startsWith('SWIPE')) {
        ctx.beginPath();
        ctx.moveTo(gesture.centerX - gesture.deltaX / 2, gesture.centerY - gesture.deltaY / 2);
        ctx.lineTo(gesture.centerX + gesture.deltaX / 2, gesture.centerY + gesture.deltaY / 2);
        ctx.stroke();

        // Arrow head
        ctx.fillStyle = '#00e5ff';
        ctx.beginPath();
        ctx.arc(gesture.centerX + gesture.deltaX / 2, gesture.centerY + gesture.deltaY / 2, 6, 0, Math.PI * 2);
        ctx.fill();
      } else if (gesture.name === 'PINCH_ZOOM') {
        ctx.beginPath();
        ctx.arc(gesture.centerX, gesture.centerY, Math.max(20, Math.abs(gesture.deltaX)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();
      } else {
        // Tap / Long-press circle
        ctx.beginPath();
        ctx.arc(gesture.centerX, gesture.centerY, 28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();
      }
      ctx.restore();

      setTimeout(() => this.drawTouchIndicators(), 400);
    }
  }

  handleRawTouch(t) {
    if (t.phase === TouchPhase.DOWN) {
      this.touchTrails.push({ x: t.x, y: t.y, time: Date.now() });
    }
  }

  drawTouchIndicators() {
    if (!this.touchCtx) return;
    const ctx = this.touchCtx;
    ctx.clearRect(0, 0, this.preset.width, this.preset.height);

    // Active touch points
    for (const contact of this.gestureDecoder.activeTouches.values()) {
      ctx.beginPath();
      ctx.fillStyle = 'rgba(0, 229, 255, 0.4)';
      ctx.arc(contact.curX, contact.curY, 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = '#00e5ff';
      ctx.arc(contact.curX, contact.curY, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(contact.curX, contact.curY, 24, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  updatePinchVisuals() {
    const hint = this.container.querySelector('#pinch-hint');
    if (hint) {
      hint.style.display = (this.altKeyDown || this.simulatedPinch) ? 'block' : 'none';
    }
  }

  renderHUD(state) {
    // 1. Mobile Status Bar
    const batText = this.container.querySelector('#status-battery-pct');
    const batFill = this.container.querySelector('#status-battery-fill');
    const airgapPill = this.container.querySelector('#status-airgap-pill');
    const radioSignal = this.container.querySelector('#status-signal-bars');

    if (batText) batText.textContent = `${state.battery.level}%`;
    if (batFill) {
      batFill.style.width = `${state.battery.level}%`;
      batFill.style.backgroundColor = state.battery.level <= 20 ? '#ff1744' : (state.battery.charging ? '#00e676' : '#f0f4f8');
    }

    if (airgapPill) {
      airgapPill.className = `status-airgap-pill ${state.radio.airgap ? 'active' : 'inactive'}`;
      airgapPill.textContent = state.radio.airgap ? 'AIR-GAP SECURED' : 'ONLINE';
    }

    if (radioSignal) {
      radioSignal.innerHTML = state.radio.airgap
        ? '<span class="signal-offline">✕ RADIO CUT</span>'
        : '<span class="signal-bars">𝟓𝐆</span>';
    }

    // 2. Physical Air-Gap Hardware Button LED
    const airgapLed = this.container.querySelector('#airgap-hw-led');
    if (airgapLed) {
      airgapLed.className = `airgap-led ${state.radio.airgap ? 'green-active' : 'red-disabled'}`;
    }

    // 3. Screen on/off overlay
    if (this.screenOverlay) {
      this.screenOverlay.style.opacity = state.screen.powered ? '0' : '1';
      this.screenOverlay.style.pointerEvents = state.screen.powered ? 'none' : 'all';
    }

    // 4. Desktop Sidebar Telemetry Dials & Cards
    const dialNpu = this.container.querySelector('#dial-npu-fill');
    const dialCpu = this.container.querySelector('#dial-cpu-fill');
    const valNpu = this.container.querySelector('#val-npu');
    const valCpu = this.container.querySelector('#val-cpu');
    const valTemp = this.container.querySelector('#val-temp');
    const valThrottle = this.container.querySelector('#val-throttle');

    if (valNpu) valNpu.textContent = `${state.npu.utilization}%`;
    if (valCpu) valCpu.textContent = `${state.cpu.utilization}%`;
    if (valTemp) valTemp.textContent = `${state.thermal.tempC}°C`;
    if (valThrottle) {
      valThrottle.textContent = state.thermal.throttleState;
      valThrottle.className = `status-chip ${state.thermal.throttleState.toLowerCase()}`;
    }

    // 5. Thermal Warning HUD & Model Precision closed-loop
    if (this.thermalWarningHud) {
      const isCritical = state.thermal.tempC >= 75;
      this.thermalWarningHud.classList.toggle('active', isCritical);
      const warnPill = this.container.querySelector('#warn-temp-pill');
      const warnText = this.container.querySelector('#warn-thermal-text');
      if (warnPill) warnPill.textContent = `${state.thermal.tempC}°C`;
      if (warnText) {
        warnText.textContent = `SoC thermal limit (>75°C) exceeded. NPU clock-gated. Inference throttled from INT8 to ${state.thermal.precision || 'CPU_FALLBACK'}.`;
      }
    }

    const valPrecision = this.container.querySelector('#val-precision');
    const valPrecisionLabel = this.container.querySelector('#val-precision-label');
    const valThroughput = this.container.querySelector('#val-throughput');

    if (valPrecision) {
      const p = state.thermal.precision || 'INT8';
      valPrecision.textContent = p;
      valPrecision.className = `status-chip precision-${p.toLowerCase().replace('_', '-')}`;
    }
    if (valPrecisionLabel) {
      const p = state.thermal.precision || 'INT8';
      const desc = p === 'CPU_FALLBACK' ? 'CPU Scalar Core Fallback' : (p === 'INT4' ? 'INT4 Quantized' : 'INT8 Full Precision');
      valPrecisionLabel.textContent = `${p} (${desc})`;
    }
    if (valThroughput) {
      const p = state.thermal.precision || 'INT8';
      valThroughput.textContent = p === 'CPU_FALLBACK'
        ? '18.5 Tensors/s (54.0ms)'
        : (p === 'INT4' ? '72.0 Tensors/s (13.9ms)' : '128.0 Tensors/s (7.8ms)');
    }

    // 6. Air-Gap RF Power Rails & Sockets readout
    const railModem = this.container.querySelector('#rail-modem-val');
    const railWifi = this.container.querySelector('#rail-wifi-val');
    const railBt = this.container.querySelector('#rail-bt-val');
    const valSevered = this.container.querySelector('#val-severed-sockets');
    const valSignal = this.container.querySelector('#val-radio-signal');

    if (railModem) {
      railModem.textContent = state.radio.airgap ? '0.0V (CUT)' : '3.3V (ACTIVE)';
      railModem.className = `rail-val ${state.radio.airgap ? 'cut' : 'active'}`;
    }
    if (railWifi) {
      railWifi.textContent = state.radio.airgap ? '0.0V (CUT)' : '1.8V (ACTIVE)';
      railWifi.className = `rail-val ${state.radio.airgap ? 'cut' : 'active'}`;
    }
    if (railBt) {
      railBt.textContent = state.radio.airgap ? '0.0V (CUT)' : '1.8V (ACTIVE)';
      railBt.className = `rail-val ${state.radio.airgap ? 'cut' : 'active'}`;
    }
    if (valSevered && this.sensory?.airgap) {
      valSevered.textContent = String(this.sensory.airgap.severedCount);
    }
    if (valSignal) {
      valSignal.textContent = state.radio.airgap ? '✕ RADIO CUT' : '5G UW';
      valSignal.style.color = state.radio.airgap ? 'var(--accent-danger)' : 'var(--accent-cyan)';
    }

    // SVG Dial circumference = 2 * PI * 34 = 213.6
    const circ = 213.6;
    if (dialNpu) {
      const npuOffset = circ - (circ * state.npu.utilization) / 100;
      dialNpu.style.strokeDashoffset = npuOffset;
    }
    if (dialCpu) {
      const cpuOffset = circ - (circ * state.cpu.utilization) / 100;
      dialCpu.style.strokeDashoffset = cpuOffset;
    }

    // Sync to framebuffer if active
    if (this.mode === 'framebuffer' && this.fbRenderer) {
      this.fbRenderer.renderBootScreen(state);
    }
  }

  renderEventLog(event) {
    const list = this.container.querySelector('#fidl-event-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'event-log-item';

    let summary = '';
    let badgeClass = 'badge-other';

    if (event.eventType === InputEventType.GESTURE && event.payload?.gesture) {
      const g = event.payload.gesture;
      summary = `<strong>${g.name}</strong> @ (${g.centerX}, ${g.centerY}) Δ=(${g.deltaX}, ${g.deltaY}) scale=${g.scaleMilli / 1000}x`;
      badgeClass = 'badge-gesture';
    } else if (event.eventType === InputEventType.TOUCH && event.payload?.touch) {
      const t = event.payload.touch;
      const phases = ['', 'DOWN', 'MOVE', 'UP', 'CANCEL'];
      summary = `Touch ${phases[t.phase]} @ (${t.point.screenX}, ${t.point.screenY})`;
      badgeClass = 'badge-touch';
    } else {
      summary = `Event type ${event.eventType}`;
    }

    const timeStr = new Date().toLocaleTimeString();
    row.innerHTML = `
      <span class="event-time">${timeStr}</span>
      <span class="event-badge ${badgeClass}">${event.eventType === InputEventType.GESTURE ? 'GESTURE' : 'TOUCH'}</span>
      <span class="event-details">${summary}</span>
    `;

    list.insertBefore(row, list.firstChild);
    while (list.children.length > 25) {
      list.removeChild(list.lastChild);
    }
  }

  switchDisplayMode(mode) {
    this.mode = mode;
    const iframeWrap = this.container.querySelector('#shell-frame-wrap');
    const fbWrap = this.container.querySelector('#framebuffer-wrap');

    if (mode === 'shell') {
      if (iframeWrap) iframeWrap.style.display = 'block';
      if (fbWrap) fbWrap.style.display = 'none';
    } else {
      if (iframeWrap) iframeWrap.style.display = 'none';
      if (fbWrap) fbWrap.style.display = 'block';
      if (this.fbRenderer) this.fbRenderer.renderBootScreen(this.hud.state);
    }
  }

  switchPreset(presetKey) {
    if (!DevicePresets[presetKey]) return;
    this.presetKey = presetKey;
    this.preset = DevicePresets[presetKey];

    const chassis = this.container.querySelector('#phone-chassis');
    const viewport = this.container.querySelector('#phone-viewport');
    const wrapper = this.container.querySelector('#phone-wrapper');
    const iframe = this.container.querySelector('#shell-frame, .shell-iframe');

    if (viewport) {
      viewport.style.width = `${this.preset.width}px`;
      viewport.style.height = `${this.preset.height}px`;
    }
    if (chassis) {
      chassis.style.borderRadius = `${this.preset.radius + 12}px`;
    }

    if (wrapper) {
      wrapper.classList.toggle('mode-passport', this.preset.formFactor === 'passport');
      wrapper.classList.toggle('mode-flex', this.preset.formFactor === 'flex');
      wrapper.classList.toggle('mode-flip-cover', this.preset.formFactor === 'flip_cover');
    }

    // Broadcast form factor and hinge posture to DEC shell iframe
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'PRAVAH_SET_FORM_FACTOR',
        formFactor: this.preset.formFactor || 'candybar',
        hingeAngle: this.preset.hingeAngle !== undefined ? this.preset.hingeAngle : 0,
        presetKey: this.presetKey,
        width: this.preset.width,
        height: this.preset.height
      }, '*');
    }

    if (this.fbRenderer) {
      this.fbRenderer.resize(this.preset.width, this.preset.height);
      this.fbRenderer.renderBootScreen(this.hud.state);
    }

    this.initTouchCanvas();
  }
}

// ============================================================================
// 8. Module Exports (CommonJS for Node.js test runner & Global for Browser)
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DeviceType,
    InputEventType,
    TouchPhase,
    KeyAction,
    GestureType,
    GestureLabels,
    DevicePresets,
    normalizeCoordinate,
    integerDistance,
    GestureDecoder,
    InputEventBridge,
    HardwareHUD,
    FramebufferRenderer,
    PhoneEmulatorApp
  };
}

if (typeof window !== 'undefined') {
  window.PhoneEmulator = {
    DeviceType,
    InputEventType,
    TouchPhase,
    KeyAction,
    GestureType,
    GestureLabels,
    DevicePresets,
    normalizeCoordinate,
    integerDistance,
    GestureDecoder,
    InputEventBridge,
    HardwareHUD,
    FramebufferRenderer,
    PhoneEmulatorApp
  };
}
