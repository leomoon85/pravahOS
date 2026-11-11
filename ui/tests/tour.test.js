// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TourStepId,
  TOUR_STORAGE_KEY,
  TOUR_STEPS,
  OnboardingTour
} from '../shell/tour.js';

/**
 * PravahOS Consumer Onboarding Tour Verification Suite
 */

// Headless DOM mock elements for unit testing
class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
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
      top: '',
      left: '',
      width: '',
      height: '',
      borderRadius: '',
      transform: '',
      display: '',
      opacity: ''
    };
    this.innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.eventListeners = {};
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }

  getAttribute(k) {
    return this.attributes[k] ?? null;
  }

  hasAttribute(k) {
    return k in this.attributes;
  }

  removeAttribute(k) {
    delete this.attributes[k];
  }

  addEventListener(event, fn) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(fn);
  }

  dispatchEvent(event) {
    const list = this.eventListeners[event.type || event] || [];
    list.forEach(fn => fn(event));
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
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

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const targetId = selector.slice(1);
      if (this.id === targetId) return this;
      for (const child of this.children) {
        if (child.querySelector) {
          const found = child.querySelector(selector);
          if (found) return found;
        }
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      if (this.classList.contains(cls)) results.push(this);
    }
    for (const child of this.children) {
      if (child.querySelectorAll) {
        results.push(...child.querySelectorAll(selector));
      }
    }
    return results;
  }

  getBoundingClientRect() {
    return {
      top: 120,
      left: 40,
      right: 360,
      bottom: 200,
      width: 320,
      height: 80
    };
  }
}

// In-memory isolated storage mock for testing persistence
class MemoryStorage {
  constructor() {
    this.data = new Map();
  }
  getItem(key) {
    return this.data.get(key) ?? null;
  }
  setItem(key, value) {
    this.data.set(key, String(value));
  }
  removeItem(key) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

// ============================================================================
// 1. Tour Step Definitions & Structure
// ============================================================================

test('TourEngine: defines all 6 required interactive consumer onboarding steps', () => {
  assert.equal(TOUR_STEPS.length, 6, 'Must define exactly 6 onboarding steps');

  const expectedStepIds = [
    TourStepId.WELCOME,
    TourStepId.INTENT,
    TourStepId.DRAWER,
    TourStepId.THEMES,
    TourStepId.FOLDABLE,
    TourStepId.AIRGAP
  ];

  expectedStepIds.forEach((expectedId, idx) => {
    const step = TOUR_STEPS[idx];
    assert.equal(step.id, expectedId, `Step at index ${idx} must have id ${expectedId}`);
    assert.ok(step.title, `Step ${step.id} must have a title`);
    assert.ok(step.subtitle, `Step ${step.id} must have a subtitle`);
    assert.ok(step.description, `Step ${step.id} must have description text`);
    assert.ok(step.badge, `Step ${step.id} must have a badge tag`);
    assert.ok(step.glyph, `Step ${step.id} must have an icon glyph`);
    assert.ok(step.interactivePill, `Step ${step.id} must have an interactive preview pill`);
  });

  // Specific content checks per requirement
  const welcomeStep = TOUR_STEPS[0];
  assert.match(welcomeStep.title, /Welcome to PravahOS/i);
  assert.match(welcomeStep.description, /post-app|fluid|intent/i);

  const intentStep = TOUR_STEPS[1];
  assert.match(intentStep.title, /Intent Capsule/i);
  assert.match(intentStep.description, /natural language|voice|prompt/i);

  const drawerStep = TOUR_STEPS[2];
  assert.match(drawerStep.title, /Living Drawer/i);
  assert.match(drawerStep.description, /live tiles|3D|flipping/i);

  const themeStep = TOUR_STEPS[3];
  assert.match(themeStep.title, /Personalize Your Aesthetic/i);
  assert.match(themeStep.description, /wallpapers|themes|liquid/i);

  const foldableStep = TOUR_STEPS[4];
  assert.match(foldableStep.title, /Foldable & Hinge Modes/i);
  assert.match(foldableStep.description, /4:3 Passport|Flex|hinge/i);

  const airgapStep = TOUR_STEPS[5];
  assert.match(airgapStep.title, /Physical Air-Gap & Hardware Trust Shield/i);
  assert.match(airgapStep.description, /air-gap|0\.0V|zero cloud leak/i);
});

// ============================================================================
// 2. Storage Persistence & Auto-Start
// ============================================================================

test('TourEngine: localStorage persistence controls auto-launch and completion state', () => {
  const storage = new MemoryStorage();
  const tour = new OnboardingTour({ storage });

  // First time visitor: not completed, should auto-start
  assert.equal(tour.isCompleted(), false);
  assert.equal(tour.shouldAutoStart(), true);

  // Mark completed
  tour.markCompleted();
  assert.equal(tour.isCompleted(), true);
  assert.equal(tour.shouldAutoStart(), false);
  assert.equal(storage.getItem(TOUR_STORAGE_KEY), 'true');

  // Reset completion
  tour.reset();
  assert.equal(tour.isCompleted(), false);
  assert.equal(tour.shouldAutoStart(), true);
  assert.equal(storage.getItem(TOUR_STORAGE_KEY), null);
});

// ============================================================================
// 3. Tour Step Sequencing & Navigation Lifecycle
// ============================================================================

test('TourEngine: sequential forward navigation, backward navigation, and completion', () => {
  const storage = new MemoryStorage();
  let completedFired = false;
  let skippedFired = false;

  const tour = new OnboardingTour({
    storage,
    onComplete: () => { completedFired = true; },
    onSkip: () => { skippedFired = true; }
  });

  assert.equal(tour.isActive(), false);
  assert.equal(tour.getCurrentStepIndex(), -1);
  assert.equal(tour.getCurrentStep(), null);

  // Start tour
  const started = tour.start();
  assert.equal(started, true);
  assert.equal(tour.isActive(), true);
  assert.equal(tour.getCurrentStepIndex(), 0);
  assert.equal(tour.getCurrentStep().id, TourStepId.WELCOME);

  // Advance through steps: 0 -> 1 -> 2 -> 3 -> 4 -> 5
  assert.equal(tour.next(), true);
  assert.equal(tour.getCurrentStepIndex(), 1);
  assert.equal(tour.getCurrentStep().id, TourStepId.INTENT);

  assert.equal(tour.next(), true);
  assert.equal(tour.getCurrentStepIndex(), 2);
  assert.equal(tour.getCurrentStep().id, TourStepId.DRAWER);

  assert.equal(tour.next(), true);
  assert.equal(tour.getCurrentStepIndex(), 3);
  assert.equal(tour.getCurrentStep().id, TourStepId.THEMES);

  assert.equal(tour.next(), true);
  assert.equal(tour.getCurrentStepIndex(), 4);
  assert.equal(tour.getCurrentStep().id, TourStepId.FOLDABLE);

  assert.equal(tour.next(), true);
  assert.equal(tour.getCurrentStepIndex(), 5);
  assert.equal(tour.getCurrentStep().id, TourStepId.AIRGAP);

  // Stepping backwards: 5 -> 4 -> 3
  assert.equal(tour.prev(), true);
  assert.equal(tour.getCurrentStepIndex(), 4);

  assert.equal(tour.prev(), true);
  assert.equal(tour.getCurrentStepIndex(), 3);

  // Direct jump via goToStep
  assert.equal(tour.goToStep(5), true);
  assert.equal(tour.getCurrentStepIndex(), 5);

  // Next on last step completes the tour
  assert.equal(tour.next(), true);
  assert.equal(tour.isActive(), false);
  assert.equal(completedFired, true);
  assert.equal(tour.isCompleted(), true);
});

// ============================================================================
// 4. Bounds Checking & Input Validation
// ============================================================================

test('TourEngine: bounds checking prevents invalid transitions and handles skip', () => {
  const storage = new MemoryStorage();
  let skipped = false;

  const tour = new OnboardingTour({
    storage,
    onSkip: () => { skipped = true; }
  });

  tour.start();
  assert.equal(tour.getCurrentStepIndex(), 0);

  // prev() at step 0 is a no-op
  assert.equal(tour.prev(), false);
  assert.equal(tour.getCurrentStepIndex(), 0);

  // Invalid step index jumps are rejected
  assert.equal(tour.goToStep(-1), false);
  assert.equal(tour.goToStep(99), false);
  assert.equal(tour.getCurrentStepIndex(), 0);

  // Skip dismisses tour and marks complete
  tour.skip();
  assert.equal(tour.isActive(), false);
  assert.equal(skipped, true);
  assert.equal(tour.isCompleted(), true);

  // Subsequent next/prev calls when inactive return false
  assert.equal(tour.next(), false);
  assert.equal(tour.prev(), false);
});

// ============================================================================
// 5. Force Start & Completion Respect
// ============================================================================

test('TourEngine: start honors completion state unless force: true is specified', () => {
  const storage = new MemoryStorage();
  storage.setItem(TOUR_STORAGE_KEY, 'true');

  const tour = new OnboardingTour({ storage });

  // Normal start should not launch if already completed
  const normalStart = tour.start({ force: false });
  assert.equal(normalStart, false);
  assert.equal(tour.isActive(), false);

  // Forced start (e.g. from "Take a Tour" button) launches anyway
  const forcedStart = tour.start({ force: true, stepIndex: 2 });
  assert.equal(forcedStart, true);
  assert.equal(tour.isActive(), true);
  assert.equal(tour.getCurrentStepIndex(), 2);
  assert.equal(tour.getCurrentStep().id, TourStepId.DRAWER);

  tour.finish();
  assert.equal(tour.isActive(), false);
});

// ============================================================================
// 6. Step Change Listeners & Observers
// ============================================================================

test('TourEngine: onStepChange observers receive notifications on every navigation', () => {
  const storage = new MemoryStorage();
  const tour = new OnboardingTour({ storage });

  const history = [];
  const unsubscribe = tour.onStepChange((step, index, total) => {
    history.push({ id: step.id, index, total });
  });

  tour.start();
  tour.next();
  tour.goToStep(4);

  assert.equal(history.length, 3);
  assert.deepEqual(history[0], { id: TourStepId.WELCOME, index: 0, total: 6 });
  assert.deepEqual(history[1], { id: TourStepId.INTENT, index: 1, total: 6 });
  assert.deepEqual(history[2], { id: TourStepId.FOLDABLE, index: 4, total: 6 });

  unsubscribe();
  tour.next();
  assert.equal(history.length, 3, 'Unsubscribed observer must not receive further events');
});

// ============================================================================
// 7. Step Hooks (onEnter & onLeave)
// ============================================================================

test('TourEngine: step lifecycle hooks (onEnter & onLeave) execute reliably', () => {
  let enterCount = 0;
  let leaveCount = 0;

  const customSteps = [
    {
      id: 'step_a',
      title: 'Step A',
      subtitle: 'Sub A',
      badge: 'A',
      glyph: '1',
      description: 'Desc A',
      interactivePill: 'Pill A',
      onEnter: () => { enterCount++; },
      onLeave: () => { leaveCount++; }
    },
    {
      id: 'step_b',
      title: 'Step B',
      subtitle: 'Sub B',
      badge: 'B',
      glyph: '2',
      description: 'Desc B',
      interactivePill: 'Pill B'
    }
  ];

  const storage = new MemoryStorage();
  const tour = new OnboardingTour({ steps: customSteps, storage });

  tour.start();
  assert.equal(enterCount, 1, 'onEnter should fire on step 0 entry');
  assert.equal(leaveCount, 0);

  tour.next();
  assert.equal(leaveCount, 1, 'onLeave should fire when navigating away from step 0');

  tour.prev();
  assert.equal(enterCount, 2, 'onEnter should fire when re-entering step 0');

  tour.skip();
  assert.equal(leaveCount, 2, 'onLeave should fire on close/skip');
});

// ============================================================================
// 8. Element Targeting & Spotlight Positioning Calculations
// ============================================================================

test('TourEngine: dynamic spotlight cutout and tooltip positioning calculations', () => {
  const storage = new MemoryStorage();
  const tour = new OnboardingTour({ storage });

  // Mock DOM overlay elements
  const ring = new MockElement('tour-spotlight-ring');
  const card = new MockElement('tour-tooltip-card');
  tour.spotlightRingEl = ring;
  tour.tooltipCardEl = card;

  // Step with real target element mock
  const targetMock = new MockElement('intent-card');
  targetMock.getBoundingClientRect = () => ({
    top: 200,
    left: 50,
    width: 400,
    height: 120,
    bottom: 320,
    right: 450
  });

  const testStep = {
    id: 'test_step',
    title: 'Test',
    target: () => targetMock,
    position: 'bottom'
  };

  tour._positionElements(testStep);

  // Verify ring coordinates calculation (top = 200 - 10 = 190, left = 50 - 10 = 40)
  assert.equal(ring.style.top, '190px');
  assert.equal(ring.style.left, '40px');
  assert.equal(ring.style.width, '420px');
  assert.equal(ring.style.height, '140px');
  assert.equal(ring.classList.contains('ring-hidden'), false);
  assert.equal(card.classList.contains('card-centered'), false);

  // Step with null target falls back to centered card & hidden spotlight ring
  const centerStep = {
    id: 'center_step',
    title: 'Welcome Hero',
    target: null
  };

  tour._positionElements(centerStep);
  assert.equal(ring.classList.contains('ring-hidden'), true);
  assert.equal(card.classList.contains('card-centered'), true);
});
