// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BackGestureState,
  UniversalBackGestureController,
  executeUniversalBackStack
} from '../shell/back_gesture.js';

import { GestureDecoder, GestureType } from '../../emulator/emulator.js';

// Minimal Mock DOM Container for Back Gesture Tests
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
    this.style = {};
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.children = [];
    this.eventListeners = {};
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  appendChild(el) {
    this.children.push(el);
    return el;
  }

  querySelector(sel) {
    return new MockElement();
  }

  blur() {}
  click() {}
}

// Minimal Global Window / Document setup for node test environment
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    innerWidth: 412,
    innerHeight: 915,
    addEventListener: () => {}
  };
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    body: new MockElement('body'),
    getElementById: (id) => new MockElement(id),
    createElement: (tag) => new MockElement('', tag),
    querySelector: () => new MockElement()
  };
}

test('UniversalBackGestureController: ignores touches originating from center screen', () => {
  const container = new MockElement('container');
  const controller = new UniversalBackGestureController({
    container,
    edgeZonePx: 32
  });

  // Touch starting at X = 150 (middle of screen)
  controller.handlePointerDown({ clientX: 150, clientY: 400, button: 0 });
  assert.equal(controller.state, BackGestureState.IDLE);
  assert.equal(controller.activeEdge, null);
});

test('UniversalBackGestureController: captures inward drag from left edge (X <= 32)', () => {
  const container = new MockElement('container');
  const controller = new UniversalBackGestureController({
    container,
    edgeZonePx: 32,
    commitDistancePx: 54
  });

  // 1. Touch down at left edge
  controller.handlePointerDown({ clientX: 12, clientY: 400, button: 0 });
  assert.equal(controller.state, BackGestureState.DRAGGING_LEFT);
  assert.equal(controller.activeEdge, 'left');

  // 2. Drag inward by 30px (below commit threshold)
  controller.handlePointerMove({ clientX: 42, clientY: 400 });
  assert.equal(controller.isCommitted, false);

  // 3. Drag inward by 70px (exceeds commit threshold)
  controller.handlePointerMove({ clientX: 82, clientY: 400 });
  assert.equal(controller.isCommitted, true);
});

test('UniversalBackGestureController: captures inward drag from right edge (X >= width - 32)', () => {
  const container = new MockElement('container');
  const controller = new UniversalBackGestureController({
    container,
    edgeZonePx: 32,
    commitDistancePx: 54
  });

  // Touch down at right edge (412 - 10 = 402)
  controller.handlePointerDown({ clientX: 402, clientY: 400, button: 0 });
  assert.equal(controller.state, BackGestureState.DRAGGING_RIGHT);
  assert.equal(controller.activeEdge, 'right');

  // Drag inward by 70px (to X = 332)
  controller.handlePointerMove({ clientX: 332, clientY: 400 });
  assert.equal(controller.isCommitted, true);
});

test('UniversalBackGestureController: releasing when committed fires back callback', () => {
  const container = new MockElement('container');
  let backInvoked = false;
  const controller = new UniversalBackGestureController({
    container,
    edgeZonePx: 32,
    commitDistancePx: 50,
    onBack: () => { backInvoked = true; }
  });

  controller.handlePointerDown({ clientX: 10, clientY: 300, button: 0 });
  controller.handlePointerMove({ clientX: 80, clientY: 300 });
  assert.equal(controller.isCommitted, true);

  controller.handlePointerUp();
  assert.equal(backInvoked, true);
  assert.equal(controller.state, BackGestureState.TRIGGERED);
});

test('UniversalBackGestureController: cancels gesture if vertical scroll angle is dominant', () => {
  const container = new MockElement('container');
  const controller = new UniversalBackGestureController({
    container,
    edgeZonePx: 32
  });

  controller.handlePointerDown({ clientX: 10, clientY: 200, button: 0 });
  // Drag mostly downward (deltaX = 20, deltaY = 90)
  controller.handlePointerMove({ clientX: 30, clientY: 290 });

  assert.equal(controller.state, BackGestureState.IDLE);
  assert.equal(controller.activeEdge, null);
});

test('Emulator GestureDecoder: recognizes EDGE_BACK_LEFT and EDGE_BACK_RIGHT gestures', () => {
  let recognized = null;
  const decoder = new GestureDecoder({
    edgeSlopPx: 36,
    screenWidthPx: 412,
    swipeMinDistancePx: 50,
    swipeMaxDurationMs: 500,
    onGesture: (g) => { recognized = g; }
  });

  // 1. Edge Back Left: Starts at X = 15, swipes right to X = 95
  decoder.touchDown(0, 15, 300, 1000);
  decoder.touchMove(0, 50, 300, 1050);
  decoder.touchUp(0, 95, 300, 1100);

  assert.ok(recognized);
  assert.equal(recognized.type, GestureType.EDGE_BACK_LEFT);
  assert.equal(recognized.name, 'EDGE_BACK_LEFT');

  recognized = null;

  // 2. Edge Back Right: Starts at X = 400 (within 36px of 412), swipes left to X = 320
  decoder.touchDown(0, 400, 300, 2000);
  decoder.touchMove(0, 360, 300, 2050);
  decoder.touchUp(0, 320, 300, 2100);

  assert.ok(recognized);
  assert.equal(recognized.type, GestureType.EDGE_BACK_RIGHT);
  assert.equal(recognized.name, 'EDGE_BACK_RIGHT');
});

test('executeUniversalBackStack: unwinds active layers in deterministic hierarchy', () => {
  // Test fallback when no overlay is open -> ROOT_HOME
  const action = executeUniversalBackStack();
  assert.ok(action);
  assert.ok(action.layer);
});
