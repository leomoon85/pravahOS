// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SpringConfig,
  SpringPresets,
  Spring,
  rubberBandClamp,
  inverseRubberBand,
  VelocityTracker,
  MomentumInertia,
  FlingDismissController,
  MotionTicker,
  springAnimate
} from '../motion/spring.js';

// ============================================================================
// 1. Spring Configuration & Physics Regimes Tests
// ============================================================================

test('SpringConfig: Computes damping ratio and natural frequency correctly', () => {
  // k = 100, m = 1 -> omega0 = 10 rad/s
  // Critical damping c_crit = 2 * sqrt(100 * 1) = 20
  const criticallyDamped = new SpringConfig({ stiffness: 100, damping: 20, mass: 1 });
  assert.equal(criticallyDamped.undampedNaturalFrequency, 10);
  assert.equal(criticallyDamped.dampingRatio, 1.0);

  // Under-damped (zeta = 10 / 20 = 0.5)
  const underDamped = new SpringConfig({ stiffness: 100, damping: 10, mass: 1 });
  assert.equal(underDamped.dampingRatio, 0.5);

  // Over-damped (zeta = 30 / 20 = 1.5)
  const overDamped = new SpringConfig({ stiffness: 100, damping: 30, mass: 1 });
  assert.equal(overDamped.dampingRatio, 1.5);
});

test('SpringPresets: Standard tactile presets match intended physics properties', () => {
  // DEFAULT: near critical damping (zeta ~ 1.0)
  const def = SpringPresets.DEFAULT;
  assert.ok(Math.abs(def.dampingRatio - 1.0) < 0.05, `DEFAULT zeta should be ~1.0, got ${def.dampingRatio}`);

  // BOUNCY: under-damped (zeta < 0.6)
  const bouncy = SpringPresets.BOUNCY;
  assert.ok(bouncy.dampingRatio < 0.6, `BOUNCY zeta should be under-damped, got ${bouncy.dampingRatio}`);

  // STIFF: high natural frequency for rapid response
  const stiff = SpringPresets.STIFF;
  assert.ok(stiff.undampedNaturalFrequency > 15, `STIFF natural frequency should be high, got ${stiff.undampedNaturalFrequency}`);
});

// ============================================================================
// 2. Second-Order ODE Analytical Spring Dynamics
// ============================================================================

test('Spring Solver: Under-damped regime demonstrates physical harmonic overshoot', () => {
  // Under-damped spring: stiffness: 100, damping: 4, mass: 1 -> zeta = 4 / 20 = 0.2
  const spring = new Spring({ stiffness: 100, damping: 4, mass: 1 });
  spring.setTarget(100, 0, 0); // from 0 to 100

  let maxDisplacement = 0;
  // Step simulation over 2.5 seconds at 120Hz
  const dt = 1 / 120;
  for (let t = 0; t <= 2.5; t += dt) {
    const res = spring.step(dt);
    if (res.value > maxDisplacement) {
      maxDisplacement = res.value;
    }
  }

  // Under-damped spring must overshoot target (> 100)
  assert.ok(maxDisplacement > 100.0, `Under-damped spring did not overshoot (max: ${maxDisplacement})`);
  assert.ok(maxDisplacement < 180.0, `Under-damped spring exceeded physical energy conservation bound (max: ${maxDisplacement})`);
});

test('Spring Solver: Critically damped regime converges to target smoothly without overshoot', () => {
  // Critically damped spring (zeta = 1.0)
  const spring = new Spring(SpringPresets.DEFAULT);
  spring.setTarget(100, 0, 0);

  let maxDisplacement = 0;
  const dt = 1 / 120;
  for (let t = 0; t <= 2.0; t += dt) {
    const res = spring.step(dt);
    if (res.value > maxDisplacement) {
      maxDisplacement = res.value;
    }
    if (res.done) break;
  }

  // Without initial velocity, critically damped displacement should approach target monotonically without substantial overshoot
  assert.ok(maxDisplacement <= 100.1, `Critically damped spring overshot unexpectedly: ${maxDisplacement}`);
  assert.equal(spring.isAtRest, true);
  assert.equal(spring.currentValue, 100);
  assert.equal(spring.currentVelocity, 0);
});

test('Spring Solver: Over-damped regime decays without oscillation', () => {
  const spring = new Spring({ stiffness: 100, damping: 40, mass: 1 }); // zeta = 2.0
  spring.setTarget(100, 0, 0);

  let hasCrossedTarget = false;
  const dt = 1 / 120;
  for (let t = 0; t <= 3.0; t += dt) {
    const res = spring.step(dt);
    if (res.value > 100.01) {
      hasCrossedTarget = true;
    }
    if (res.done) break;
  }

  assert.equal(hasCrossedTarget, false, 'Over-damped spring crossed equilibrium target');
});

test('Spring Solver: Conserves and responds to positive and negative initial gesture velocities', () => {
  const springZeroVel = new Spring(SpringPresets.DEFAULT);
  springZeroVel.setTarget(100, 0, 0);

  const springWithFling = new Spring(SpringPresets.DEFAULT);
  // User flicked card forward at +800 px/s
  springWithFling.setTarget(100, 800, 0);

  // In the first 50ms, the card with initial velocity should move noticeably faster
  for (let i = 0; i < 6; i++) {
    springZeroVel.step(1 / 120);
    springWithFling.step(1 / 120);
  }

  assert.ok(
    springWithFling.currentValue > springZeroVel.currentValue,
    `Initial fling velocity did not increase initial travel (withFling: ${springWithFling.currentValue}, zeroVel: ${springZeroVel.currentValue})`
  );

  // Opposing velocity check: flicked backward (-400 px/s) while dragging to +100
  const springOpposing = new Spring(SpringPresets.DEFAULT);
  springOpposing.setTarget(100, -400, 0);
  springOpposing.step(1 / 120);

  assert.ok(springOpposing.currentValue < 0, 'Opposing initial velocity did not produce initial backward trajectory');
});

test('Spring Solver: snapTo immediately halts motion and updates state', () => {
  const spring = new Spring(SpringPresets.DEFAULT);
  spring.setTarget(250, 600, 0);
  spring.step(1 / 120);
  assert.equal(spring.isAtRest, false);

  spring.snapTo(120);
  assert.equal(spring.isAtRest, true);
  assert.equal(spring.currentValue, 120);
  assert.equal(spring.currentVelocity, 0);
  assert.equal(spring.toValue, 120);
});

// ============================================================================
// 3. Apple/Pixel Rubber-Band Edge Overscroll Formula
// ============================================================================

test('Rubber-band formula: Correctly calculates resistance for zero, positive, and negative values', () => {
  const maxDim = 800; // Screen height in px

  // Zero displacement yields zero resisted displacement
  assert.equal(rubberBandClamp(0, maxDim), 0);

  // Small displacement: for small x, f(x) ≈ 0.55 * x
  const smallResisted = rubberBandClamp(10, maxDim);
  assert.ok(Math.abs(smallResisted - 5.5) < 0.1, `Small offset resistance deviation: ${smallResisted}`);

  // Positive displacement: f(100) = (100 * 0.55) / (1 + (100 * 0.55) / 800)
  // = 55 / (1 + 55 / 800) = 55 / 1.06875 ≈ 51.46 px
  const posResisted = rubberBandClamp(100, maxDim);
  const expectedPos = (100 * 0.55) / (1 + (100 * 0.55) / maxDim);
  assert.ok(Math.abs(posResisted - expectedPos) < 1e-4, `Expected ${expectedPos}, got ${posResisted}`);

  // Negative displacement symmetry: f(-x) === -f(x)
  const negResisted = rubberBandClamp(-100, maxDim);
  assert.equal(negResisted, -posResisted);
});

test('Rubber-band formula: Asymptotic limit strictly never exceeds maxDimension', () => {
  const maxDim = 400; // Viewport width in px

  // Even with an absurdly large drag of 1,000,000 px, f(x) < max_dimension
  const hugeResisted = rubberBandClamp(1_000_000, maxDim);
  assert.ok(hugeResisted < maxDim, `Rubber-band exceeded asymptotic bound: ${hugeResisted} >= ${maxDim}`);
  assert.ok(hugeResisted > 0.99 * maxDim, `Rubber-band failed to approach asymptotic bound: ${hugeResisted}`);
});

test('Rubber-band formula: Inverse formula accurately recovers original displacement', () => {
  const maxDim = 600;
  const testDistances = [15, 60, 150, 320, 850];

  for (const raw of testDistances) {
    const resisted = rubberBandClamp(raw, maxDim);
    const recovered = inverseRubberBand(resisted, maxDim);
    assert.ok(
      Math.abs(recovered - raw) < 0.01,
      `Inverse mismatch for raw=${raw}: resisted=${resisted}, recovered=${recovered}`
    );

    // Negative symmetry check
    const negResisted = rubberBandClamp(-raw, maxDim);
    const negRecovered = inverseRubberBand(negResisted, maxDim);
    assert.ok(
      Math.abs(negRecovered - (-raw)) < 0.01,
      `Negative inverse mismatch for raw=-${raw}: resisted=${negResisted}, recovered=${negRecovered}`
    );
  }
});

// ============================================================================
// 4. Pointer Velocity Tracker
// ============================================================================

test('VelocityTracker: Stationary samples produce zero velocity', () => {
  const tracker = new VelocityTracker();
  const now = 1000;
  tracker.addPoint(50, 100, now);
  tracker.addPoint(50, 100, now + 16);
  tracker.addPoint(50, 100, now + 32);

  const vel = tracker.getVelocity();
  assert.equal(vel.vx, 0);
  assert.equal(vel.vy, 0);
  assert.equal(vel.speed, 0);
});

test('VelocityTracker: Uniform linear movement calculates velocity accurately', () => {
  const tracker = new VelocityTracker();
  // Simulate moving 100px in X and 200px in Y over 100ms (1000 px/s in X, 2000 px/s in Y)
  const startTime = 1000;
  for (let i = 0; i <= 6; i++) {
    const t = startTime + i * 16.666;
    const progress = (i * 16.666) / 100;
    tracker.addPoint(progress * 100, progress * 200, t);
  }

  const vel = tracker.getVelocity();
  // Velocity should be approximately 1000 px/s and 2000 px/s
  assert.ok(Math.abs(vel.vx - 1000) < 50, `Expected vx ~ 1000, got ${vel.vx}`);
  assert.ok(Math.abs(vel.vy - 2000) < 100, `Expected vy ~ 2000, got ${vel.vy}`);
  assert.ok(vel.speed > 2200 && vel.speed < 2300, `Expected speed ~ 2236, got ${vel.speed}`);
});

test('VelocityTracker: Directionality reflects positive and negative fling vectors', () => {
  const trackerLeft = new VelocityTracker();
  trackerLeft.addPoint(200, 100, 1000);
  trackerLeft.addPoint(150, 100, 1050);
  trackerLeft.addPoint(100, 100, 1100);

  const velLeft = trackerLeft.getVelocity();
  assert.ok(velLeft.vx < 0, `Expected negative vx for leftward drag, got ${velLeft.vx}`);
});

// ============================================================================
// 5. Momentum Inertia Scrolling
// ============================================================================

test('MomentumInertia: Accurately predicts travel distance based on friction decay', () => {
  const inertia = new MomentumInertia({ decelerationRate: 4.0 });
  // Total travel = v0 / decelerationRate = 1200 / 4 = 300px
  const travel = inertia.predictTravel(1200);
  assert.equal(travel, 300);

  // Negative velocity prediction
  const negTravel = inertia.predictTravel(-800);
  assert.equal(negTravel, -200);
});

test('MomentumInertia: solveAt decelerates velocity to zero and completes', () => {
  const inertia = new MomentumInertia({ decelerationRate: 3.0, minVelocity: 15 });
  const initialPos = 100;
  const initialVel = 900; // Travel ~ 300px, final pos ~ 400px

  // At t = 0
  const step0 = inertia.solveAt(initialPos, initialVel, 0);
  assert.equal(step0.value, initialPos);
  assert.equal(step0.isFinished, true);

  // At t = 0.5s
  const stepMid = inertia.solveAt(initialPos, initialVel, 0.5);
  assert.ok(stepMid.value > initialPos && stepMid.value < initialPos + 300);
  assert.ok(stepMid.velocity < initialVel && stepMid.velocity > 0);
  assert.equal(stepMid.isFinished, false);

  // At t = 3.0s (fully decelerated)
  const stepEnd = inertia.solveAt(initialPos, initialVel, 3.0);
  assert.equal(stepEnd.isFinished, true);
  assert.equal(stepEnd.velocity, 0);
  assert.ok(Math.abs(stepEnd.value - 400) < 10);
});

test('MomentumInertia: clampWithOverscroll compresses beyond boundaries', () => {
  const inertia = new MomentumInertia({ maxOverscroll: 100 });
  const minBound = 0;
  const maxBound = 500;

  // In-bounds
  const inBounds = inertia.clampWithOverscroll(250, minBound, maxBound);
  assert.equal(inBounds.clamped, 250);
  assert.equal(inBounds.overscroll, 0);

  // Below minBound (e.g. -50)
  const below = inertia.clampWithOverscroll(-50, minBound, maxBound);
  assert.ok(below.clamped < 0 && below.clamped > -50, `Rubber-band should resist below 0: ${below.clamped}`);
  assert.equal(below.overscroll, -50);

  // Above maxBound (e.g. 550)
  const above = inertia.clampWithOverscroll(550, minBound, maxBound);
  assert.ok(above.clamped > 500 && above.clamped < 550, `Rubber-band should resist above 500: ${above.clamped}`);
  assert.equal(above.overscroll, 50);
});

// ============================================================================
// 6. Velocity-Conserving Fling Dismiss Controller
// ============================================================================

test('FlingDismissController: Triggers dismiss on distance threshold passed', () => {
  const controller = new FlingDismissController({ dismissThresholdPx: 100, dismissVelocityPx: 500 });

  // Dragged 120px with low velocity (10 px/s) -> Dismissed
  const evalThreshold = controller.evaluate(120, 10, 600, 0);
  assert.equal(evalThreshold.willDismiss, true);
  assert.equal(evalThreshold.target, 600);
  assert.equal(evalThreshold.velocity, 10);

  // Dragged only 40px with low velocity (20 px/s) -> Restored
  const evalLow = controller.evaluate(40, 20, 600, 0);
  assert.equal(evalLow.willDismiss, false);
  assert.equal(evalLow.target, 0);
});

test('FlingDismissController: Triggers dismiss on high velocity fling even below distance threshold', () => {
  const controller = new FlingDismissController({ dismissThresholdPx: 150, dismissVelocityPx: 500 });

  // Dragged only 35px, but flicked with high velocity 750 px/s
  const evalFling = controller.evaluate(35, 750, 600, 0);
  assert.equal(evalFling.willDismiss, true, 'High velocity fling should dismiss regardless of distance');
  assert.equal(evalFling.target, 600);
  assert.equal(evalFling.velocity, 750);
});

test('FlingDismissController: Cancels dismissal if flicked forcefully in reverse direction', () => {
  const controller = new FlingDismissController({ dismissThresholdPx: 100, dismissVelocityPx: 500 });

  // Dragged 110px past threshold, but user flicked aggressively upward (-300 px/s)
  const evalCounter = controller.evaluate(110, -300, 600, 0);
  assert.equal(evalCounter.willDismiss, false, 'Strong counter-flick should abort dismissal and snap back');
  assert.equal(evalCounter.target, 0);
});

// ============================================================================
// 7. MotionTicker & springAnimate Lifecycle
// ============================================================================

test('MotionTicker: Registers, invokes callbacks, and handles auto-removal', () => {
  const ticker = new MotionTicker();
  let calls = 0;

  const id = ticker.add((dt, now) => {
    calls++;
    if (calls >= 3) {
      return false; // Auto-unregister
    }
  });

  assert.equal(ticker.callbacks.size, 1);

  // Simulate ticks
  ticker._tick(1016);
  ticker._tick(1032);
  ticker._tick(1048);

  assert.equal(calls, 3);
  assert.equal(ticker.callbacks.size, 0);
});

test('springAnimate: Drives animation steps and invokes onComplete', () => {
  const ticker = new MotionTicker();
  const updates = [];
  let completedState = null;

  const handle = springAnimate({
    from: 0,
    to: 50,
    initialVelocity: 0,
    config: SpringPresets.DEFAULT,
    ticker,
    onUpdate: (s) => updates.push(s.value),
    onComplete: (s) => { completedState = s; }
  });

  // Manually drive ticker steps
  let t = 1000;
  for (let i = 0; i < 150; i++) {
    t += 16.666;
    ticker._tick(t);
    if (completedState) break;
  }

  assert.ok(updates.length > 5, 'springAnimate produced too few frame updates');
  assert.ok(completedState !== null, 'springAnimate did not invoke onComplete');
  assert.equal(completedState.value, 50);
  assert.equal(completedState.done, true);
});
