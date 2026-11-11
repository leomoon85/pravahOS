// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file spring.js
 * PravahOS Pillar 1: 120Hz Spring-Damping Gesture Physics & Momentum Inertia Engine.
 * 
 * Provides:
 * 1. Second-order differential equation spring solver (stiffness, damping, mass, initial velocity).
 *    Exact analytical solutions for under-damped, critically-damped, and over-damped regimes.
 * 2. Apple/Pixel standard rubber-band overscroll formula:
 *    f(x) = (x * 0.55) / (1 + (x * 0.55) / max_dimension)
 * 3. High-precision moving-window VelocityTracker for gesture flings.
 * 4. Momentum inertia scrolling with exponential friction decay and edge rebound.
 * 5. Velocity-conserving fling dismiss controller for cards and modal sheets.
 * 6. 120Hz VSync requestAnimationFrame MotionTicker loop manager with zero dropped frames.
 */

// ============================================================================
// 1. Spring Physics Configuration & Presets
// ============================================================================

/**
 * Configuration options for second-order ODE spring dynamics.
 */
class SpringConfig {
  /**
   * @param {Object} options
   * @param {number} [options.stiffness=170] - Spring stiffness k (N/m).
   * @param {number} [options.damping=26] - Damping coefficient c (N*s/m).
   * @param {number} [options.mass=1] - Mass m (kg).
   * @param {number} [options.restDisplacementThreshold=0.05] - Positional tolerance for rest detection (px).
   * @param {number} [options.restVelocityThreshold=0.05] - Velocity tolerance for rest detection (px/s).
   */
  constructor({
    stiffness = 170,
    damping = 26,
    mass = 1,
    restDisplacementThreshold = 0.05,
    restVelocityThreshold = 0.05
  } = {}) {
    this.stiffness = Math.max(0.0001, stiffness);
    this.damping = Math.max(0, damping);
    this.mass = Math.max(0.0001, mass);
    this.restDisplacementThreshold = restDisplacementThreshold;
    this.restVelocityThreshold = restVelocityThreshold;
  }

  /**
   * Damping ratio: zeta = c / (2 * sqrt(k * m))
   * zeta < 1: Under-damped (oscillates)
   * zeta = 1: Critically damped (fastest settle without oscillation)
   * zeta > 1: Over-damped (slow decay, no oscillation)
   * @returns {number}
   */
  get dampingRatio() {
    return this.damping / (2 * Math.sqrt(this.stiffness * this.mass));
  }

  /**
   * Natural undamped angular frequency: omega_0 = sqrt(k / m)
   * @returns {number}
   */
  get undampedNaturalFrequency() {
    return Math.sqrt(this.stiffness / this.mass);
  }
}

/**
 * Standard tactile spring presets aligned with iOS/Pixel gesture physics.
 */
const SpringPresets = {
  // Apple UIKit default interactive spring (~zeta = 1.0, critically damped)
  DEFAULT: new SpringConfig({ stiffness: 170, damping: 26, mass: 1 }),
  // Gentle, soft, fluid settling (~zeta = 0.64, subtle playful float)
  GENTLE: new SpringConfig({ stiffness: 120, damping: 14, mass: 1 }),
  // Fast, snappy UI element snap (~zeta = 0.725, rapid response)
  SNAPPY: new SpringConfig({ stiffness: 230, damping: 22, mass: 1 }),
  // Bouncy, lively overshoot (~zeta = 0.447, pronounced rebound)
  BOUNCY: new SpringConfig({ stiffness: 180, damping: 12, mass: 1 }),
  // Stiff, high tension, minimal overshoot (~zeta = 0.935, firm grip)
  STIFF: new SpringConfig({ stiffness: 350, damping: 35, mass: 1 }),
  // Overscroll rubber-band snap-back (fast edge restore)
  OVERSCROLL_RESTORE: new SpringConfig({ stiffness: 300, damping: 30, mass: 1 })
};

// ============================================================================
// 2. Second-Order ODE Analytical Spring Solver
// ============================================================================

/**
 * Closed-form analytical spring solver.
 * Solves: m * x''(t) + c * x'(t) + k * (x(t) - target) = 0
 * Initial conditions: x(0) = fromValue, x'(0) = initialVelocity.
 */
class Spring {
  /**
   * @param {SpringConfig|Object} [config=SpringPresets.DEFAULT]
   */
  constructor(config = SpringPresets.DEFAULT) {
    this.config = config instanceof SpringConfig ? config : new SpringConfig(config);
    this.fromValue = 0;
    this.toValue = 0;
    this.initialVelocity = 0;
    this.currentValue = 0;
    this.currentVelocity = 0;
    this.elapsedTime = 0; // In seconds
    this.isAtRest = true;

    // Precomputed coefficients for continuous analytical evaluation
    this._zeta = 1;
    this._omega0 = 1;
    this._omegaD = 0;
    this._c1 = 0;
    this._c2 = 0;
    this._r1 = 0;
    this._r2 = 0;
    this._regime = 'CRITICALLY_DAMPED';

    this._recompute();
  }

  /**
   * Configures spring destination, initial velocity, and optional origin.
   * Conserves initial velocity from user gestures.
   * 
   * @param {number} toValue - Target equilibrium value
   * @param {number} [initialVelocity=null] - Initial velocity in px/s (null = preserve current)
   * @param {number} [fromValue=null] - Starting value (null = preserve current)
   */
  setTarget(toValue, initialVelocity = null, fromValue = null) {
    if (fromValue !== null) {
      this.currentValue = fromValue;
      this.fromValue = fromValue;
    } else {
      this.fromValue = this.currentValue;
    }

    this.toValue = toValue;
    if (initialVelocity !== null) {
      this.currentVelocity = initialVelocity;
    }
    this.initialVelocity = this.currentVelocity;
    this.elapsedTime = 0;

    // Check if already at rest at target
    const dist = Math.abs(this.fromValue - this.toValue);
    const vel = Math.abs(this.initialVelocity);
    if (dist <= this.config.restDisplacementThreshold && vel <= this.config.restVelocityThreshold) {
      this.currentValue = this.toValue;
      this.currentVelocity = 0;
      this.isAtRest = true;
      return;
    }

    this.isAtRest = false;
    this._recompute();
  }

  /**
   * Internal precomputation of roots and coefficients for the 2nd-order ODE.
   * @private
   */
  _recompute() {
    const k = this.config.stiffness;
    const c = this.config.damping;
    const m = this.config.mass;

    const omega0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(k * m));

    this._omega0 = omega0;
    this._zeta = zeta;

    const x0 = this.fromValue - this.toValue; // Displacement from target
    const v0 = this.initialVelocity;

    const EPS = 1e-5;
    if (Math.abs(zeta - 1.0) < EPS) {
      // 1. Critically Damped (zeta == 1)
      this._regime = 'CRITICALLY_DAMPED';
      this._c1 = x0;
      this._c2 = v0 + omega0 * x0;
    } else if (zeta < 1.0) {
      // 2. Under-Damped (zeta < 1)
      this._regime = 'UNDER_DAMPED';
      const omegaD = omega0 * Math.sqrt(1.0 - zeta * zeta);
      this._omegaD = omegaD;
      this._c1 = x0;
      this._c2 = (v0 + zeta * omega0 * x0) / omegaD;
    } else {
      // 3. Over-Damped (zeta > 1)
      this._regime = 'OVER_DAMPED';
      const omegaD = omega0 * Math.sqrt(zeta * zeta - 1.0);
      this._r1 = -omega0 * zeta + omegaD;
      this._r2 = -omega0 * zeta - omegaD;
      // Linear system: c1 + c2 = x0, r1*c1 + r2*c2 = v0
      this._c2 = (v0 - this._r1 * x0) / (this._r2 - this._r1);
      this._c1 = x0 - this._c2;
    }
  }

  /**
   * Evaluates the continuous analytical closed-form solution at time t (seconds).
   * Exact mathematics: zero numerical drift, independent of step size or refresh rate.
   * 
   * @param {number} t - Elapsed time in seconds since animation start
   * @returns {{ value: number, velocity: number }}
   */
  solveAt(t) {
    if (this.isAtRest || t <= 0) {
      return { value: this.currentValue, velocity: this.currentVelocity };
    }

    let displacement = 0;
    let velocity = 0;

    switch (this._regime) {
      case 'UNDER_DAMPED': {
        const decay = Math.exp(-this._zeta * this._omega0 * t);
        const cosVal = Math.cos(this._omegaD * t);
        const sinVal = Math.sin(this._omegaD * t);

        displacement = decay * (this._c1 * cosVal + this._c2 * sinVal);

        const dDecay = -this._zeta * this._omega0 * decay;
        const dOsc = -this._c1 * this._omegaD * sinVal + this._c2 * this._omegaD * cosVal;
        velocity = dDecay * (this._c1 * cosVal + this._c2 * sinVal) + decay * dOsc;
        break;
      }

      case 'CRITICALLY_DAMPED': {
        const decay = Math.exp(-this._omega0 * t);
        displacement = decay * (this._c1 + this._c2 * t);
        velocity = decay * (this._c2 - this._omega0 * (this._c1 + this._c2 * t));
        break;
      }

      case 'OVER_DAMPED': {
        const e1 = Math.exp(this._r1 * t);
        const e2 = Math.exp(this._r2 * t);

        displacement = this._c1 * e1 + this._c2 * e2;
        velocity = this._c1 * this._r1 * e1 + this._c2 * this._r2 * e2;
        break;
      }
    }

    const value = this.toValue + displacement;

    // Check rest criteria
    if (
      Math.abs(displacement) <= this.config.restDisplacementThreshold &&
      Math.abs(velocity) <= this.config.restVelocityThreshold
    ) {
      return { value: this.toValue, velocity: 0, atRest: true };
    }

    return { value, velocity, atRest: false };
  }

  /**
   * Advances the simulation by dt seconds.
   * 
   * @param {number} dtSeconds - Delta time in seconds (e.g. 0.00833 for 120Hz)
   * @returns {{ value: number, velocity: number, done: boolean }}
   */
  step(dtSeconds) {
    if (this.isAtRest) {
      return { value: this.toValue, velocity: 0, done: true };
    }

    this.elapsedTime += dtSeconds;
    const res = this.solveAt(this.elapsedTime);

    this.currentValue = res.value;
    this.currentVelocity = res.velocity;

    if (res.atRest) {
      this.currentValue = this.toValue;
      this.currentVelocity = 0;
      this.isAtRest = true;
    }

    return {
      value: this.currentValue,
      velocity: this.currentVelocity,
      done: this.isAtRest
    };
  }

  /**
   * Immediately snap to rest at a given position.
   * @param {number} value
   */
  snapTo(value) {
    this.fromValue = value;
    this.toValue = value;
    this.currentValue = value;
    this.currentVelocity = 0;
    this.initialVelocity = 0;
    this.elapsedTime = 0;
    this.isAtRest = true;
  }
}

// ============================================================================
// 3. Apple/Pixel Rubber-Band Edge Overscroll Resistance
// ============================================================================

/**
 * Apple/Pixel standard rubber-band edge overscroll resistance formula:
 * f(x) = (x * 0.55) / (1 + (x * 0.55) / max_dimension)
 * 
 * Provides continuous smooth asymptotic logarithmic resistance when pulling past bounds.
 * 
 * @param {number} offset - Raw gesture distance beyond boundary (positive or negative in px).
 * @param {number} maxDimension - Boundary dimension (viewport width or height, in px).
 * @param {number} [constant=0.55] - Standard tactile elasticity coefficient.
 * @returns {number} Resisted displacement in px.
 */
function rubberBandClamp(offset, maxDimension, constant = 0.55) {
  if (offset === 0 || maxDimension <= 0) return 0;
  const absOffset = Math.abs(offset);
  const resisted = (absOffset * constant) / (1 + (absOffset * constant) / maxDimension);
  return Math.sign(offset) * resisted;
}

/**
 * Exact analytical inverse of the rubber-band formula.
 * Maps visual resisted displacement back to raw finger displacement.
 * 
 * @param {number} resistedOffset - Visually resisted offset in px.
 * @param {number} maxDimension - Boundary dimension in px.
 * @param {number} [constant=0.55] - Elasticity coefficient.
 * @returns {number} Raw finger displacement in px.
 */
function inverseRubberBand(resistedOffset, maxDimension, constant = 0.55) {
  if (resistedOffset === 0 || maxDimension <= 0) return 0;
  const absResisted = Math.abs(resistedOffset);
  if (absResisted >= maxDimension) {
    return Math.sign(resistedOffset) * maxDimension * 10;
  }
  const raw = absResisted / (constant * (1 - absResisted / maxDimension));
  return Math.sign(resistedOffset) * raw;
}

// ============================================================================
// 4. Pointer Velocity Tracker (Moving Window Calculus)
// ============================================================================

/**
 * Tracks high-frequency touch/pointer movement samples to calculate smooth,
 * noise-free instantaneous release velocity (vx, vy in px/s).
 */
class VelocityTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.maxAgeMs=100] - Window duration to evaluate samples (ms).
   * @param {number} [options.maxSamples=12] - Maximum history points retained.
   */
  constructor({ maxAgeMs = 100, maxSamples = 12 } = {}) {
    this.maxAgeMs = maxAgeMs;
    this.maxSamples = maxSamples;
    /** @type {Array<{ x: number, y: number, time: number }>} */
    this.samples = [];
  }

  /**
   * Resets tracker buffer.
   */
  reset() {
    this.samples = [];
  }

  /**
   * Records a touch/pointer coordinate sample.
   * @param {number} x
   * @param {number} y
   * @param {number} [timestamp]
   */
  addPoint(x, y, timestamp = null) {
    const time = timestamp ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.samples.push({ x, y, time });

    // Prune stale samples outside evaluation window
    const cutoff = time - this.maxAgeMs;
    while (this.samples.length > 2 && this.samples[0].time < cutoff) {
      this.samples.shift();
    }
    while (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /**
   * Computes smooth release velocity using weighted linear differences.
   * Recent samples are weighted exponentially higher.
   * 
   * @returns {{ vx: number, vy: number, speed: number }} Velocity components in px/s.
   */
  getVelocity() {
    if (this.samples.length < 2) {
      return { vx: 0, vy: 0, speed: 0 };
    }

    let totalWeight = 0;
    let weightedVx = 0;
    let weightedVy = 0;

    const newest = this.samples[this.samples.length - 1];

    for (let i = this.samples.length - 1; i > 0; i--) {
      const p2 = this.samples[i];
      const p1 = this.samples[i - 1];
      const dt = (p2.time - p1.time) / 1000; // in seconds

      if (dt <= 0.0001) continue;

      const vx = (p2.x - p1.x) / dt;
      const vy = (p2.y - p1.y) / dt;

      // Exponential weight based on recency from latest sample
      const ageMs = newest.time - p2.time;
      const weight = Math.exp(-ageMs / 40);

      weightedVx += vx * weight;
      weightedVy += vy * weight;
      totalWeight += weight;
    }

    if (totalWeight <= 0) {
      return { vx: 0, vy: 0, speed: 0 };
    }

    const vx = Math.round((weightedVx / totalWeight) * 10) / 10;
    const vy = Math.round((weightedVy / totalWeight) * 10) / 10;
    const speed = Math.round(Math.sqrt(vx * vx + vy * vy) * 10) / 10;

    return { vx, vy, speed };
  }
}

// ============================================================================
// 5. Momentum Inertia Scrolling with Friction Decay
// ============================================================================

/**
 * Evaluates exponential deceleration inertia for list scrolling and trackpads.
 * Models: v(t) = v0 * exp(-decelerationRate * t)
 * Distance: x(t) = x0 + (v0 / decelerationRate) * (1 - exp(-decelerationRate * t))
 */
class MomentumInertia {
  /**
   * @param {Object} [options]
   * @param {number} [options.decelerationRate=3.24] - Friction decay coefficient (1/s).
   * @param {number} [options.minVelocity=10] - Threshold below which velocity drops to zero (px/s).
   * @param {number} [options.maxOverscroll=120] - Maximum rubber-band displacement on boundary hit.
   */
  constructor({
    decelerationRate = 3.24,
    minVelocity = 10,
    maxOverscroll = 120
  } = {}) {
    this.decelerationRate = decelerationRate;
    this.minVelocity = minVelocity;
    this.maxOverscroll = maxOverscroll;
  }

  /**
   * Predicts final resting displacement from an initial velocity.
   * @param {number} initialVelocity - Initial fling velocity in px/s.
   * @returns {number} Predicted travel distance in px.
   */
  predictTravel(initialVelocity) {
    return initialVelocity / this.decelerationRate;
  }

  /**
   * Solves position and velocity at time t (seconds).
   * 
   * @param {number} initialPosition - Starting position x0.
   * @param {number} initialVelocity - Starting velocity v0 (px/s).
   * @param {number} t - Elapsed time in seconds.
   * @returns {{ value: number, velocity: number, isFinished: boolean }}
   */
  solveAt(initialPosition, initialVelocity, t) {
    if (t <= 0 || Math.abs(initialVelocity) < this.minVelocity) {
      return { value: initialPosition, velocity: 0, isFinished: true };
    }

    const decay = Math.exp(-this.decelerationRate * t);
    const velocity = initialVelocity * decay;
    const delta = (initialVelocity / this.decelerationRate) * (1 - decay);
    const value = initialPosition + delta;

    const isFinished = Math.abs(velocity) <= this.minVelocity;
    return {
      value,
      velocity: isFinished ? 0 : velocity,
      isFinished
    };
  }

  /**
   * Bounds clamping helper with seamless hand-off to rubber-band compression.
   * 
   * @param {number} position - Simulated position.
   * @param {number} minBound - Minimum scroll boundary (e.g. 0).
   * @param {number} maxBound - Maximum scroll boundary (e.g. maxScrollTop).
   * @returns {{ clamped: number, overscroll: number }}
   */
  clampWithOverscroll(position, minBound, maxBound) {
    if (position < minBound) {
      const over = minBound - position;
      return {
        clamped: minBound - rubberBandClamp(over, this.maxOverscroll),
        overscroll: -over
      };
    }
    if (position > maxBound) {
      const over = position - maxBound;
      return {
        clamped: maxBound + rubberBandClamp(over, this.maxOverscroll),
        overscroll: over
      };
    }
    return { clamped: position, overscroll: 0 };
  }
}

// ============================================================================
// 6. Velocity-Conserving Fling Gesture Dismiss Controller
// ============================================================================

/**
 * Controller for interactive cards, sheets, and notification surfaces.
 * Evaluates whether a drag gesture should dismiss or snap back, conserving
 * user fling velocity into the spring transition.
 */
class FlingDismissController {
  /**
   * @param {Object} [options]
   * @param {number} [options.dismissThresholdPx=120] - Offset distance threshold.
   * @param {number} [options.dismissVelocityPx=600] - Velocity flick threshold in px/s.
   * @param {SpringConfig} [options.springConfig=SpringPresets.DEFAULT] - Spring configuration.
   */
  constructor({
    dismissThresholdPx = 120,
    dismissVelocityPx = 600,
    springConfig = SpringPresets.DEFAULT
  } = {}) {
    this.dismissThresholdPx = dismissThresholdPx;
    this.dismissVelocityPx = dismissVelocityPx;
    this.springConfig = springConfig;
  }

  /**
   * Evaluates release event to determine if the element should dismiss or restore.
   * 
   * @param {number} offset - Current drag displacement (px).
   * @param {number} velocity - Current pointer velocity in dismiss direction (px/s).
   * @param {number} dismissTarget - Target position when dismissed (e.g. windowHeight).
   * @param {number} [restTarget=0] - Target position when restored (e.g. 0).
   * @returns {{ willDismiss: boolean, target: number, velocity: number }}
   */
  evaluate(offset, velocity, dismissTarget, restTarget = 0) {
    const isForward = dismissTarget > restTarget;
    const displacement = isForward ? (offset - restTarget) : (restTarget - offset);
    const directionalVelocity = isForward ? velocity : -velocity;

    // Dismissal trigger criteria:
    // 1. High-velocity directional fling in dismiss direction (even if distance is small)
    // 2. Traveled beyond threshold and not forcefully flicked backward
    const isHighVelocityFling = directionalVelocity > this.dismissVelocityPx;
    const isPastThreshold = displacement > this.dismissThresholdPx && directionalVelocity > -150;

    const willDismiss = isHighVelocityFling || isPastThreshold;

    return {
      willDismiss,
      target: willDismiss ? dismissTarget : restTarget,
      // Conserve velocity into spring target
      velocity
    };
  }
}

// ============================================================================
// 7. 120Hz VSync rAF Animation Loop Manager (MotionTicker)
// ============================================================================

/**
 * 120Hz VSync requestAnimationFrame animation loop manager.
 * Features:
 * - Dynamic refresh rate auto-detection (60Hz, 90Hz, 120Hz, 144Hz).
 * - Clamped delta time (dt <= 0.05s) preventing physics explosions after tab suspension.
 * - Zero idle CPU usage: pauses loop automatically when no animations are active.
 * - Hardware acceleration sync via requestAnimationFrame.
 */
class MotionTicker {
  constructor() {
    /** @type {Map<number, (dt: number, timestamp: number) => boolean|void>} */
    this.callbacks = new Map();
    this.isRunning = false;
    this.rafId = null;
    this.lastTimestamp = 0;
    this.nextId = 1;
    this.fps = 120;
    this.frameDeltas = [];
    this._tick = this._tick.bind(this);
  }

  /**
   * Registers an animation step callback.
   * The callback receives (dtSeconds, timestampMs).
   * Returning `false` from the callback automatically unregisters it.
   * 
   * @param {(dt: number, timestamp: number) => boolean|void} callback
   * @returns {number} Unique registration ID.
   */
  add(callback) {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    this.start();
    return id;
  }

  /**
   * Unregisters an animation step callback.
   * @param {number} id
   */
  remove(id) {
    this.callbacks.delete(id);
    if (this.callbacks.size === 0) {
      this.stop();
    }
  }

  /**
   * Starts the rAF loop if not already running.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTimestamp = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(this._tick);
    }
  }

  /**
   * Stops the rAF loop.
   */
  stop() {
    this.isRunning = false;
    if (this.rafId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.lastTimestamp = 0;
  }

  /**
   * Internal per-frame tick dispatcher.
   * @private
   */
  _tick(timestamp) {
    if (!this.isRunning) return;

    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(this._tick);
    }

    const now = timestamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());
    let dt = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;

    // Clamp dt to 50ms maximum to avoid physics teleportation on frame drops/tab backgrounding
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0.0001) dt = 1 / 120; // Default 120Hz frame budget (8.33ms)

    // Compute moving average FPS
    this.frameDeltas.push(dt);
    if (this.frameDeltas.length > 30) this.frameDeltas.shift();
    const avgDt = this.frameDeltas.reduce((a, b) => a + b, 0) / this.frameDeltas.length;
    this.fps = Math.round(1 / avgDt);

    // Dispatch to registered animations
    const entries = Array.from(this.callbacks.entries());
    for (let i = 0; i < entries.length; i++) {
      const [id, cb] = entries[i];
      try {
        const keep = cb(dt, now);
        if (keep === false) {
          this.remove(id);
        }
      } catch (err) {
        console.error('PravahMotion: Error in ticker step callback:', err);
        this.remove(id);
      }
    }
  }
}

// Shared singleton ticker
const sharedTicker = new MotionTicker();

/**
 * Animates a spring from a start value to a target with optional initial velocity.
 * 
 * @param {Object} options
 * @param {number} [options.from=0] - Initial value.
 * @param {number} [options.to=1] - Target equilibrium value.
 * @param {number} [options.initialVelocity=0] - Initial velocity in px/s.
 * @param {SpringConfig|Object} [options.config=SpringPresets.DEFAULT] - Spring configuration.
 * @param {MotionTicker} [options.ticker=sharedTicker] - Motion ticker instance.
 * @param {(state: { value: number, velocity: number, done: boolean }) => void} options.onUpdate
 * @param {(state: { value: number, velocity: number, done: boolean }) => void} [options.onComplete]
 * @returns {{ cancel: () => void, spring: Spring }}
 */
function springAnimate({
  from = 0,
  to = 1,
  initialVelocity = 0,
  config = SpringPresets.DEFAULT,
  ticker = sharedTicker,
  onUpdate = () => {},
  onComplete = () => {}
} = {}) {
  const spring = new Spring(config);
  spring.currentValue = from;
  spring.setTarget(to, initialVelocity, from);

  let id = null;

  const stepCallback = (dt) => {
    const state = spring.step(dt);
    onUpdate(state);
    if (state.done) {
      if (onComplete) onComplete(state);
      return false; // Automatically deregisters from ticker
    }
    return true;
  };

  id = ticker.add(stepCallback);

  return {
    cancel: () => {
      if (id !== null) {
        ticker.remove(id);
        id = null;
      }
    },
    spring
  };
}

// ============================================================================
// 8. Module Exports (CommonJS / ES Module / Browser Window)
// ============================================================================

export {
  SpringConfig,
  SpringPresets,
  Spring,
  rubberBandClamp,
  inverseRubberBand,
  VelocityTracker,
  MomentumInertia,
  FlingDismissController,
  MotionTicker,
  sharedTicker,
  springAnimate
};

if (typeof window !== 'undefined') {
  window.PravahMotion = {
    SpringConfig,
    SpringPresets,
    Spring,
    rubberBandClamp,
    inverseRubberBand,
    VelocityTracker,
    MomentumInertia,
    FlingDismissController,
    MotionTicker,
    sharedTicker,
    springAnimate
  };
}
