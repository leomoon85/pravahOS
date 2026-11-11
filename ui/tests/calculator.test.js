// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CalculatorApp,
  safeRound,
  formatDisplayNumber,
  tokenizeExpression,
  evaluateExpression,
  preparePreviewExpression,
  CONVERSION_TABLES
} from '../apps/calculator.js';

// Minimal Mock DOM Container for Headless Node.js Unit Testing
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
    this.style = {};
    this._innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.attributes = {};
    this.eventListeners = {};
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = val;
    this._parseMockChildren(val);
  }

  _parseMockChildren(html) {
    // Basic mock tag extractor for selector queries
    this.children = [];
    const tagRegex = /<([a-z0-9\-]+)([^>]*)>(.*?)<\/\1>|<([a-z0-9\-]+)([^>]*)\/>/gis;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
      const tagName = match[1] || match[4];
      const attrStr = match[2] || match[5] || '';
      const content = match[3] || '';
      const child = new MockElement('', tagName);

      // Extract id
      const idMatch = attrStr.match(/id="([^"]+)"/i);
      if (idMatch) child.id = idMatch[1];

      // Extract classes
      const classMatch = attrStr.match(/class="([^"]+)"/i);
      if (classMatch) {
        classMatch[1].split(/\s+/).filter(Boolean).forEach(c => child.classList.add(c));
      }

      // Extract data attributes
      const dataRegex = /data-([a-z0-9\-]+)="([^"]+)"/gi;
      let dMatch;
      while ((dMatch = dataRegex.exec(attrStr)) !== null) {
        child.attributes[`data-${dMatch[1]}`] = dMatch[2];
      }

      child.textContent = content.replace(/<[^>]*>/g, '').trim();
      child.innerHTML = content;
      this.children.push(child);
    }
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  dispatchEvent(event) {
    const listeners = this.eventListeners[event.type] || [];
    for (const l of listeners) {
      l({ ...event, target: this, currentTarget: this });
    }
  }

  getAttribute(name) {
    if (name === 'id') return this.id;
    return this.attributes[name] || null;
  }

  setAttribute(name, val) {
    this.attributes[name] = val;
  }

  querySelector(selector) {
    return this._findMatching(selector, false);
  }

  querySelectorAll(selector) {
    return this._findMatching(selector, true);
  }

  _findMatching(selector, returnAll = false) {
    const results = [];
    const search = (node) => {
      let match = false;
      if (selector.startsWith('#')) {
        const targetId = selector.slice(1);
        if (node.id === targetId) match = true;
      } else if (selector.startsWith('.')) {
        const targetClass = selector.slice(1);
        if (node.classList.contains(targetClass)) match = true;
      } else if (selector.startsWith('[data-')) {
        const attrMatch = selector.match(/\[([a-z0-9\-]+)="([^"]+)"\]/i);
        if (attrMatch && node.getAttribute(attrMatch[1]) === attrMatch[2]) match = true;
      }

      if (match) {
        results.push(node);
        if (!returnAll) return;
      }

      for (const child of node.children) {
        search(child);
        if (results.length > 0 && !returnAll) return;
      }
    };

    search(this);
    return returnAll ? results : (results[0] || null);
  }
}

// -----------------------------------------------------------------------------
// Test 1: Class and Exports Integrity
// -----------------------------------------------------------------------------
test('CalculatorApp: exports core class and required public API methods', () => {
  const app = new CalculatorApp();
  assert.ok(app instanceof CalculatorApp);
  assert.equal(typeof app.render, 'function');
  assert.equal(typeof app.input, 'function');
  assert.equal(typeof app.clear, 'function');
  assert.equal(typeof app.backspace, 'function');
  assert.equal(typeof app.calculate, 'function');
  assert.equal(typeof app.toggleSign, 'function');
  assert.equal(typeof app.percentage, 'function');
  assert.equal(typeof app.toggleScientific, 'function');
  assert.equal(typeof app.setAngleMode, 'function');
  assert.equal(typeof app.convertUnit, 'function');
  assert.equal(typeof app.getHistory, 'function');
});

// -----------------------------------------------------------------------------
// Test 2: Basic Arithmetic with Precedence and Parentheses
// -----------------------------------------------------------------------------
test('CalculatorApp: basic arithmetic (+, -, ×, ÷) with operator precedence and parentheses', () => {
  const app = new CalculatorApp();

  // Simple Addition
  app.input('12');
  app.input('+');
  app.input('8');
  assert.equal(app.calculate(), 20);

  // Operator Precedence: 2 + 3 * 4 = 14 (not 20)
  app.clear();
  app.input('2');
  app.input('+');
  app.input('3');
  app.input('×');
  app.input('4');
  assert.equal(app.calculate(), 14);

  // Explicit Parentheses: (2 + 3) * 4 = 20
  app.clear();
  app.input('(');
  app.input('2');
  app.input('+');
  app.input('3');
  app.input(')');
  app.input('×');
  app.input('4');
  assert.equal(app.calculate(), 20);

  // Subtraction and Division: 100 / 4 - 5 = 20
  app.clear();
  app.input('100');
  app.input('÷');
  app.input('4');
  app.input('-');
  app.input('5');
  assert.equal(app.calculate(), 20);
});

// -----------------------------------------------------------------------------
// Test 3: Zero Floating-Point Glitches (Safe Decimal Precision Math)
// -----------------------------------------------------------------------------
test('CalculatorApp: zero floating-point rounding glitches (0.1 + 0.2 = 0.3)', () => {
  const app = new CalculatorApp();

  // Standard IEEE-754 produces 0.30000000000000004
  app.input('0.1');
  app.input('+');
  app.input('0.2');
  assert.equal(app.calculate(), 0.3);
  assert.equal(app.result, '0.3');

  // Subtraction precision: 0.3 - 0.1 = 0.2
  app.clear();
  app.input('0.3');
  app.input('-');
  app.input('0.1');
  assert.equal(app.calculate(), 0.2);

  // Multiplication precision: 0.1 * 0.2 = 0.02
  app.clear();
  app.input('0.1');
  app.input('×');
  app.input('0.2');
  assert.equal(app.calculate(), 0.02);

  // Scaling precision: 0.07 * 100 = 7 (not 7.000000000000001)
  app.clear();
  app.input('0.07');
  app.input('×');
  app.input('100');
  assert.equal(app.calculate(), 7);

  // Direct safeRound utility assertions
  assert.equal(safeRound(0.1 + 0.2), 0.3);
  assert.equal(safeRound(1.4 - 1.2), 0.2);
});

// -----------------------------------------------------------------------------
// Test 4: Live Instant Evaluation Preview
// -----------------------------------------------------------------------------
test('CalculatorApp: live instant evaluation preview computes in real-time as user types', () => {
  const app = new CalculatorApp();

  // Type: 15
  app.input('15');
  assert.equal(app.preview, '15');

  // Type: +
  app.input('+');
  // Trailing operator should still yield 15 preview without throwing
  assert.equal(app.preview, '15');

  // Type: 25 -> live preview should instantly be 40 before calculate()
  app.input('25');
  assert.equal(app.preview, '40');

  // Type: * 2 -> live preview should be 15 + (25 * 2) = 65
  app.input('×');
  app.input('2');
  assert.equal(app.preview, '65');

  // Committing calculation
  assert.equal(app.calculate(), 65);
  assert.equal(app.preview, '');
});

// -----------------------------------------------------------------------------
// Test 5: Implicit Multiplication Support
// -----------------------------------------------------------------------------
test('CalculatorApp: implicit multiplication syntax 2(3+4) and (2+3)(4+1)', () => {
  const app = new CalculatorApp();

  // 2(3 + 4) = 14
  app.input('2');
  app.input('(');
  app.input('3');
  app.input('+');
  app.input('4');
  app.input(')');
  assert.equal(app.calculate(), 14);

  // (2 + 3)(4 + 1) = 25
  app.clear();
  app.input('(');
  app.input('2');
  app.input('+');
  app.input('3');
  app.input(')');
  app.input('(');
  app.input('4');
  app.input('+');
  app.input('1');
  app.input(')');
  assert.equal(app.calculate(), 25);
});

// -----------------------------------------------------------------------------
// Test 6: Scientific Calculations (Powers, Sqrt, Log, Ln)
// -----------------------------------------------------------------------------
test('CalculatorApp: scientific calculations (powers ^, sqrt, log10, ln)', () => {
  const app = new CalculatorApp();

  // Powers: 2^3 = 8
  app.input('2');
  app.input('^');
  app.input('3');
  assert.equal(app.calculate(), 8);

  // Square root: sqrt(144) = 12
  app.clear();
  app.input('sqrt');
  app.input('144');
  app.input(')');
  assert.equal(app.calculate(), 12);

  // Common Logarithm (base 10): log(1000) = 3
  app.clear();
  app.input('log');
  app.input('1000');
  app.input(')');
  assert.equal(app.calculate(), 3);

  // Natural Logarithm: ln(e) = 1
  app.clear();
  app.input('ln');
  app.input('e');
  app.input(')');
  assert.equal(app.calculate(), 1);
});

// -----------------------------------------------------------------------------
// Test 7: Trigonometry with DEG and RAD Angle Modes
// -----------------------------------------------------------------------------
test('CalculatorApp: trigonometric functions and DEG vs RAD angle modes', () => {
  const app = new CalculatorApp({ angleMode: 'DEG' });

  // DEG mode: sin(30) = 0.5
  app.input('sin');
  app.input('30');
  app.input(')');
  assert.equal(app.calculate(), 0.5);

  // DEG mode: cos(90) = 0, tan(45) = 1
  app.clear();
  app.input('cos');
  app.input('90');
  app.input(')');
  assert.equal(app.calculate(), 0);

  app.clear();
  app.input('tan');
  app.input('45');
  app.input(')');
  assert.equal(app.calculate(), 1);

  // Switch to RAD mode
  app.setAngleMode('RAD');
  assert.equal(app.angleMode, 'RAD');

  // RAD mode: sin(π / 2) = 1
  app.clear();
  app.input('sin');
  app.input('π');
  app.input('÷');
  app.input('2');
  app.input(')');
  assert.equal(app.calculate(), 1);

  // RAD mode: cos(π) = -1
  app.clear();
  app.input('cos');
  app.input('π');
  app.input(')');
  assert.equal(app.calculate(), -1);
});

// -----------------------------------------------------------------------------
// Test 8: toggleSign(), percentage(), and backspace() token manipulation
// -----------------------------------------------------------------------------
test('CalculatorApp: toggleSign(), percentage(), and backspace() token manipulation', () => {
  const app = new CalculatorApp();

  // toggleSign on single number
  app.input('42');
  app.toggleSign();
  assert.equal(app.expression, '-42');
  app.toggleSign();
  assert.equal(app.expression, '42');

  // toggleSign in compound expression: 10 + 5 -> 10 + (-5)
  app.input('+');
  app.input('5');
  app.toggleSign();
  assert.equal(app.expression, '42 + (-5)');
  assert.equal(app.calculate(), 37);

  // Percentage: 200 * 15% = 30
  app.clear();
  app.input('200');
  app.input('×');
  app.input('15');
  app.percentage();
  assert.equal(app.calculate(), 30);

  // Backspace on multi-char tokens: "sin(" should be deleted in one backspace
  app.clear();
  app.input('sin');
  assert.equal(app.expression, 'sin(');
  app.backspace();
  assert.equal(app.expression, '');

  // Backspace on spaced operators: " + " should be deleted together
  app.input('5');
  app.input('+');
  assert.equal(app.expression, '5 + ');
  app.backspace();
  assert.equal(app.expression, '5');
});

// -----------------------------------------------------------------------------
// Test 9: Calculation History Tape Recording & One-Tap Recall
// -----------------------------------------------------------------------------
test('CalculatorApp: calculation history tape preserves calculations with tap-to-reuse', () => {
  const app = new CalculatorApp();

  assert.equal(app.getHistory().length, 0);

  // Calculation 1: 10 + 20 = 30
  app.input('10');
  app.input('+');
  app.input('20');
  app.calculate();

  // Calculation 2: 30 * 3 = 90
  app.input('×');
  app.input('3');
  app.calculate();

  const history = app.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].result, '90');
  assert.equal(history[1].result, '30');

  // Recall previous answer (30 at index 1)
  app.clear();
  app.recallHistory(1, 'result');
  assert.equal(app.expression, '30');

  // Chain another calculation with recalled value
  app.input('÷');
  app.input('2');
  assert.equal(app.calculate(), 15);

  // Clear history
  app.clearHistory();
  assert.equal(app.getHistory().length, 0);
});

// -----------------------------------------------------------------------------
// Test 10: Offline Unit Converter (Length, Mass/Weight, Temperature)
// -----------------------------------------------------------------------------
test('CalculatorApp: offline Unit Converter performs accurate deterministic conversions', () => {
  const app = new CalculatorApp();

  // Length: km to m
  assert.equal(app.convertUnit(5, 'km', 'm', 'length'), 5000);
  // Length: m to km
  assert.equal(app.convertUnit(2500, 'm', 'km', 'length'), 2.5);
  // Length: miles to km
  assert.equal(app.convertUnit(1, 'mi', 'km', 'length'), 1.609344);
  // Length: feet to inches
  assert.equal(app.convertUnit(3, 'ft', 'in', 'length'), 36);

  // Weight/Mass: kg to g
  assert.equal(app.convertUnit(2.5, 'kg', 'g', 'mass'), 2500);
  // Weight/Mass: kg to lb
  assert.equal(app.convertUnit(1, 'kg', 'lb', 'mass'), 2.20462262);

  // Temperature: Celsius to Fahrenheit (100 C -> 212 F)
  assert.equal(app.convertUnit(100, 'C', 'F', 'temperature'), 212);
  // Temperature: Fahrenheit to Celsius (32 F -> 0 C)
  assert.equal(app.convertUnit(32, 'F', 'C', 'temperature'), 0);
  // Temperature: Celsius to Kelvin (0 C -> 273.15 K)
  assert.equal(app.convertUnit(0, 'C', 'K', 'temperature'), 273.15);
});

// -----------------------------------------------------------------------------
// Test 11: Offline Pegged Currency Converter (USD, EUR, INR, BTC, ETH)
// -----------------------------------------------------------------------------
test('CalculatorApp: offline Currency Converter converts between USD, EUR, INR, BTC, ETH', () => {
  const app = new CalculatorApp();

  // 100 USD -> INR (Pegged at 83.50 INR per USD)
  assert.equal(app.convertUnit(100, 'USD', 'INR', 'currency'), 8350);

  // 83.50 INR -> USD = 1 USD
  assert.equal(app.convertUnit(83.5, 'INR', 'USD', 'currency'), 1);

  // 100 USD -> EUR (0.92 EUR per USD)
  assert.equal(app.convertUnit(100, 'USD', 'EUR', 'currency'), 92);

  // 1 BTC -> USD (Pegged offline rate: 1 / 0.000015 = 66,666.66666667 USD)
  const btcInUsd = app.convertUnit(1, 'BTC', 'USD', 'currency');
  assert.ok(Math.abs(btcInUsd - 66666.66666667) < 0.01);

  // 1 ETH -> USD (Pegged offline rate: 1 / 0.00028 = 3,571.42857143 USD)
  const ethInUsd = app.convertUnit(1, 'ETH', 'USD', 'currency');
  assert.ok(Math.abs(ethInUsd - 3571.42857143) < 0.01);

  // Auto-category detection when category omitted
  assert.equal(app.convertUnit(10, 'USD', 'INR'), 835);
  assert.equal(app.convertUnit(100, 'C', 'F'), 212);
  assert.equal(app.convertUnit(2, 'km', 'm'), 2000);
});

// -----------------------------------------------------------------------------
// Test 12: Scientific Mode & Angle Mode State Transitions
// -----------------------------------------------------------------------------
test('CalculatorApp: toggleScientific() and setAngleMode() state transitions', () => {
  const app = new CalculatorApp();

  assert.equal(app.isScientificOpen, false);
  app.toggleScientific();
  assert.equal(app.isScientificOpen, true);
  app.toggleScientific();
  assert.equal(app.isScientificOpen, false);

  assert.equal(app.angleMode, 'DEG');
  app.setAngleMode('rad');
  assert.equal(app.angleMode, 'RAD');
  app.setAngleMode('deg');
  assert.equal(app.angleMode, 'DEG');
});

// -----------------------------------------------------------------------------
// Test 13: Mock DOM Rendering & Interactive Keypad Events
// -----------------------------------------------------------------------------
test('CalculatorApp: Mock DOM rendering and keypad interaction events', () => {
  const container = new MockElement('calc-container');
  const app = new CalculatorApp({ container });

  assert.ok(container.classList.contains('pravah-calc-root'));
  assert.ok(container.innerHTML.includes('calc-surface'));

  // Test button click through mock DOM
  const btn7 = container.querySelector('[data-action="7"]');
  const btnPlus = container.querySelector('[data-action="+"]');
  const btn3 = container.querySelector('[data-action="3"]');
  const btnEquals = container.querySelector('[data-action="="]');

  assert.ok(btn7);
  assert.ok(btnPlus);
  assert.ok(btn3);
  assert.ok(btnEquals);

  btn7.dispatchEvent({ type: 'click' });
  btnPlus.dispatchEvent({ type: 'click' });
  btn3.dispatchEvent({ type: 'click' });

  assert.equal(app.expression, '7 + 3');
  assert.equal(app.preview, '10');

  btnEquals.dispatchEvent({ type: 'click' });
  assert.equal(app.result, '10');
  assert.equal(app.getHistory().length, 1);
});

// -----------------------------------------------------------------------------
// Test 14: Error Handling & Resilience
// -----------------------------------------------------------------------------
test('CalculatorApp: graceful handling of division by zero and invalid syntax', () => {
  const app = new CalculatorApp();

  // Division by zero throws in parser and is cleanly caught in calculate()
  app.input('10');
  app.input('÷');
  app.input('0');
  app.calculate();
  assert.equal(app.preview, 'Error');

  // Auto-completing unclosed parentheses for live preview
  assert.equal(preparePreviewExpression('sin(90'), 'sin(90)');
  assert.equal(preparePreviewExpression('(2 + 3'), '(2 + 3)');
  assert.equal(preparePreviewExpression('12 +'), '12');
});
