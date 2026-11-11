// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file calculator.js
 * Flagship PravahOS Calculator & Offline Unit Converter.
 *
 * Features:
 * - Soulver/OpenCalc-style instant live evaluation preview
 * - Glassmorphic tactile keypad with luxury optical styling & haptic pulses
 * - Calculation history tape with one-tap recall & reuse
 * - Scientific calculation panel: sin, cos, tan, ln, log, sqrt, powers, pi, e
 * - DEG / RAD angle modes
 * - Zero floating-point rounding glitches (safe decimal arithmetic)
 * - Offline-first Unit & Pegged Currency Converter (Length, Weight, Temp, Currency)
 */

/**
 * Rounds numbers safely to eliminate IEEE-754 binary floating-point anomalies
 * like 0.1 + 0.2 = 0.30000000000000004 or 1.4 - 1.2 = 0.19999999999999996.
 *
 * @param {number} value
 * @param {number} precision
 * @returns {number}
 */
export function safeRound(value, precision = 12) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** precision;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  if (Math.abs(rounded) < 1e-14) return 0;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Formats a number for user-facing display.
 * @param {number} num
 * @returns {string}
 */
export function formatDisplayNumber(num) {
  if (num === null || num === undefined || Number.isNaN(num)) return '';
  if (!Number.isFinite(num)) return num > 0 ? 'Infinity' : '-Infinity';
  const cleaned = safeRound(num, 12);
  if (Math.abs(cleaned) >= 1e15 || (Math.abs(cleaned) > 0 && Math.abs(cleaned) < 1e-9)) {
    return cleaned.toExponential(8).replace(/\.?0+e/, 'e');
  }
  return String(cleaned);
}

/**
 * Offline-first deterministic unit and currency conversion tables.
 */
export const CONVERSION_TABLES = {
  length: {
    label: 'Length',
    base: 'm',
    units: {
      m: { name: 'Meters (m)', symbol: 'm', rate: 1 },
      km: { name: 'Kilometers (km)', symbol: 'km', rate: 1000 },
      cm: { name: 'Centimeters (cm)', symbol: 'cm', rate: 0.01 },
      mm: { name: 'Millimeters (mm)', symbol: 'mm', rate: 0.001 },
      mi: { name: 'Miles (mi)', symbol: 'mi', rate: 1609.344 },
      yd: { name: 'Yards (yd)', symbol: 'yd', rate: 0.9144 },
      ft: { name: 'Feet (ft)', symbol: 'ft', rate: 0.3048 },
      in: { name: 'Inches (in)', symbol: 'in', rate: 0.0254 }
    }
  },
  mass: {
    label: 'Weight & Mass',
    base: 'kg',
    units: {
      kg: { name: 'Kilograms (kg)', symbol: 'kg', rate: 1 },
      g: { name: 'Grams (g)', symbol: 'g', rate: 0.001 },
      mg: { name: 'Milligrams (mg)', symbol: 'mg', rate: 0.000001 },
      lb: { name: 'Pounds (lb)', symbol: 'lb', rate: 0.45359237 },
      oz: { name: 'Ounces (oz)', symbol: 'oz', rate: 0.028349523125 },
      t: { name: 'Metric Tons (t)', symbol: 't', rate: 1000 }
    }
  },
  temperature: {
    label: 'Temperature',
    units: {
      C: { name: 'Celsius (°C)', symbol: '°C' },
      F: { name: 'Fahrenheit (°F)', symbol: '°F' },
      K: { name: 'Kelvin (K)', symbol: 'K' }
    }
  },
  currency: {
    label: 'Currency',
    base: 'USD',
    units: {
      USD: { name: 'US Dollar ($)', symbol: 'USD', rate: 1 },
      EUR: { name: 'Euro (€)', symbol: 'EUR', rate: 0.92 },
      GBP: { name: 'British Pound (£)', symbol: 'GBP', rate: 0.78 },
      INR: { name: 'Indian Rupee (₹)', symbol: 'INR', rate: 83.50 },
      BTC: { name: 'Bitcoin (₿)', symbol: 'BTC', rate: 0.000015 },
      ETH: { name: 'Ethereum (Ξ)', symbol: 'ETH', rate: 0.00028 },
      JPY: { name: 'Japanese Yen (¥)', symbol: 'JPY', rate: 155.00 },
      CAD: { name: 'Canadian Dollar (C$)', symbol: 'CAD', rate: 1.38 },
      AUD: { name: 'Australian Dollar (A$)', symbol: 'AUD', rate: 1.52 }
    }
  }
};

/**
 * Tokenizes a math expression string into tokens.
 * Automatically inserts implicit multiplication tokens where standard mathematical notation implies it.
 *
 * @param {string} input
 * @returns {Array<{type: string, value: any}>}
 */
export function tokenizeExpression(input) {
  if (!input || typeof input !== 'string') return [];
  const rawTokens = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Number literals (including decimal point starting with dot or digit)
    if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < len && input[i + 1] >= '0' && input[i + 1] <= '9')) {
      let numStr = '';
      while (i < len && ((input[i] >= '0' && input[i] <= '9') || input[i] === '.')) {
        numStr += input[i++];
      }
      rawTokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
      continue;
    }

    // Basic arithmetic operators
    if (ch === '+' || ch === '-' || ch === '−') {
      rawTokens.push({ type: 'OP', value: ch === '−' ? '-' : ch });
      i++;
      continue;
    }
    if (ch === '*' || ch === '×') {
      rawTokens.push({ type: 'OP', value: '*' });
      i++;
      continue;
    }
    if (ch === '/' || ch === '÷') {
      rawTokens.push({ type: 'OP', value: '/' });
      i++;
      continue;
    }
    if (ch === '^') {
      rawTokens.push({ type: 'OP', value: '^' });
      i++;
      continue;
    }
    if (ch === '%') {
      rawTokens.push({ type: 'POSTFIX', value: '%' });
      i++;
      continue;
    }
    if (ch === '(') {
      rawTokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      rawTokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }
    if (ch === 'π') {
      rawTokens.push({ type: 'CONST', value: Math.PI, name: 'π' });
      i++;
      continue;
    }
    if (ch === '√') {
      rawTokens.push({ type: 'FUNC', value: 'sqrt' });
      i++;
      continue;
    }

    // Alphabetic words: function names or constants
    if (/[a-zA-Z]/.test(ch)) {
      let word = '';
      while (i < len && /[a-zA-Z]/.test(input[i])) {
        word += input[i++];
      }
      const lower = word.toLowerCase();
      if (lower === 'pi') {
        rawTokens.push({ type: 'CONST', value: Math.PI, name: 'pi' });
      } else if (lower === 'e') {
        rawTokens.push({ type: 'CONST', value: Math.E, name: 'e' });
      } else {
        rawTokens.push({ type: 'FUNC', value: lower });
      }
      continue;
    }

    // Unknown character, skip
    i++;
  }

  // Insert implicit multiplication: e.g. 2(3), 2pi, (2+3)(4+5), 2sin(30)
  const tokens = [];
  for (let j = 0; j < rawTokens.length; j++) {
    const cur = rawTokens[j];
    if (j > 0) {
      const prev = rawTokens[j - 1];
      const prevCanMultiply = (
        prev.type === 'NUMBER' ||
        prev.type === 'CONST' ||
        prev.type === 'RPAREN' ||
        prev.type === 'POSTFIX'
      );
      const curCanBeMultiplied = (
        cur.type === 'NUMBER' ||
        cur.type === 'CONST' ||
        cur.type === 'FUNC' ||
        cur.type === 'LPAREN'
      );
      if (prevCanMultiply && curCanBeMultiplied) {
        tokens.push({ type: 'OP', value: '*' });
      }
    }
    tokens.push(cur);
  }

  return tokens;
}

/**
 * Recursive Descent Expression Parser with Pratt operator precedence.
 */
class ExpressionParser {
  constructor(tokens, angleMode = 'DEG') {
    this.tokens = tokens;
    this.pos = 0;
    this.angleMode = angleMode.toUpperCase();
  }

  peek() {
    return this.tokens[this.pos];
  }

  consume(expectedType, expectedValue) {
    const tok = this.peek();
    if (!tok) throw new Error('Unexpected end of expression');
    if (expectedType && tok.type !== expectedType) {
      throw new Error(`Expected token type ${expectedType} but found ${tok.type}`);
    }
    if (expectedValue !== undefined && tok.value !== expectedValue) {
      throw new Error(`Expected token value ${expectedValue} but found ${tok.value}`);
    }
    this.pos++;
    return tok;
  }

  parse() {
    if (this.tokens.length === 0) return 0;
    const result = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token at position ${this.pos}: ${this.tokens[this.pos].value}`);
    }
    return safeRound(result);
  }

  parseExpression() {
    let left = this.parseTerm();
    while (this.pos < this.tokens.length) {
      const tok = this.peek();
      if (tok && tok.type === 'OP' && (tok.value === '+' || tok.value === '-')) {
        this.consume();
        const right = this.parseTerm();
        left = tok.value === '+' ? safeRound(left + right) : safeRound(left - right);
      } else {
        break;
      }
    }
    return left;
  }

  parseTerm() {
    let left = this.parseFactor();
    while (this.pos < this.tokens.length) {
      const tok = this.peek();
      if (tok && tok.type === 'OP' && (tok.value === '*' || tok.value === '/' || tok.value === '%')) {
        this.consume();
        const right = this.parseFactor();
        if (tok.value === '*') {
          left = safeRound(left * right);
        } else if (tok.value === '/') {
          if (right === 0) throw new Error('Cannot divide by zero');
          left = safeRound(left / right);
        } else if (tok.value === '%') {
          if (right === 0) throw new Error('Cannot modulo by zero');
          left = safeRound(left % right);
        }
      } else {
        break;
      }
    }
    return left;
  }

  parseFactor() {
    let base = this.parseUnary();
    if (this.pos < this.tokens.length && this.peek()?.type === 'OP' && this.peek()?.value === '^') {
      this.consume();
      const exp = this.parseFactor(); // Right-associative exponentiation
      return safeRound(Math.pow(base, exp));
    }
    return base;
  }

  parseUnary() {
    if (this.pos < this.tokens.length && this.peek()?.type === 'OP' && (this.peek()?.value === '+' || this.peek()?.value === '-')) {
      const op = this.consume().value;
      const operand = this.parseUnary();
      return op === '-' ? safeRound(-operand) : operand;
    }
    let val = this.parsePrimary();
    while (this.pos < this.tokens.length && this.peek()?.type === 'POSTFIX' && this.peek()?.value === '%') {
      this.consume();
      val = safeRound(val / 100);
    }
    return val;
  }

  parsePrimary() {
    const tok = this.peek();
    if (!tok) throw new Error('Unexpected end of expression');

    if (tok.type === 'NUMBER' || tok.type === 'CONST') {
      this.consume();
      return tok.value;
    }

    if (tok.type === 'FUNC') {
      const funcName = this.consume().value;
      if (this.peek()?.type === 'LPAREN') {
        this.consume('LPAREN');
      }
      const arg = this.parseExpression();
      if (this.peek()?.type === 'RPAREN') {
        this.consume('RPAREN');
      }
      return this.evaluateFunction(funcName, arg);
    }

    if (tok.type === 'LPAREN') {
      this.consume('LPAREN');
      const val = this.parseExpression();
      if (this.peek()?.type === 'RPAREN') {
        this.consume('RPAREN');
      }
      return val;
    }

    throw new Error(`Unexpected token '${tok.value}'`);
  }

  evaluateFunction(func, arg) {
    const isDeg = this.angleMode === 'DEG';
    switch (func.toLowerCase()) {
      case 'sin': {
        const rad = isDeg ? (arg * Math.PI) / 180 : arg;
        return safeRound(Math.sin(rad));
      }
      case 'cos': {
        const rad = isDeg ? (arg * Math.PI) / 180 : arg;
        return safeRound(Math.cos(rad));
      }
      case 'tan': {
        if (isDeg && Math.abs((arg - 90) % 180) < 1e-9) {
          throw new Error('Tangent undefined at 90°');
        }
        const rad = isDeg ? (arg * Math.PI) / 180 : arg;
        return safeRound(Math.tan(rad));
      }
      case 'asin': {
        if (arg < -1 || arg > 1) throw new Error('asin argument out of range [-1, 1]');
        const rad = Math.asin(arg);
        return safeRound(isDeg ? (rad * 180) / Math.PI : rad);
      }
      case 'acos': {
        if (arg < -1 || arg > 1) throw new Error('acos argument out of range [-1, 1]');
        const rad = Math.acos(arg);
        return safeRound(isDeg ? (rad * 180) / Math.PI : rad);
      }
      case 'atan': {
        const rad = Math.atan(arg);
        return safeRound(isDeg ? (rad * 180) / Math.PI : rad);
      }
      case 'log': {
        if (arg <= 0) throw new Error('log argument must be > 0');
        return safeRound(Math.log10(arg));
      }
      case 'ln': {
        if (arg <= 0) throw new Error('ln argument must be > 0');
        return safeRound(Math.log(arg));
      }
      case 'sqrt': {
        if (arg < 0) throw new Error('Cannot take square root of negative number');
        return safeRound(Math.sqrt(arg));
      }
      case 'abs': {
        return safeRound(Math.abs(arg));
      }
      default:
        throw new Error(`Unknown function '${func}'`);
    }
  }
}

/**
 * Prepares an expression string for live instant evaluation preview:
 * - Strips dangling trailing operators (+, -, *, /, ^)
 * - Auto-closes unclosed opening parentheses
 *
 * @param {string} expr
 * @returns {string}
 */
export function preparePreviewExpression(expr) {
  if (!expr || typeof expr !== 'string') return '';
  let s = expr.trim();
  if (!s) return '';

  // Remove trailing operators
  s = s.replace(/[\+\-\*\/\×\÷\^]+$/, '').trim();
  if (!s) return '';

  // Count unclosed parentheses
  let openCount = 0;
  for (const ch of s) {
    if (ch === '(') openCount++;
    else if (ch === ')') openCount = Math.max(0, openCount - 1);
  }

  if (openCount > 0) {
    s += ')'.repeat(openCount);
  }

  return s;
}

/**
 * Evaluates a mathematical expression string.
 *
 * @param {string} expr
 * @param {string} angleMode - 'DEG' | 'RAD'
 * @returns {number}
 */
export function evaluateExpression(expr, angleMode = 'DEG') {
  if (!expr || !expr.trim()) return 0;
  const tokens = tokenizeExpression(expr);
  if (tokens.length === 0) return 0;
  const parser = new ExpressionParser(tokens, angleMode);
  return parser.parse();
}

/**
 * Flagship PravahOS Calculator & Unit Converter Application.
 */
export class CalculatorApp {
  /**
   * @param {Object} [options]
   * @param {HTMLElement|any} [options.container]
   * @param {string} [options.angleMode] - 'DEG' or 'RAD'
   * @param {string} [options.activeTab] - 'calculator' or 'converter'
   */
  constructor(options = {}) {
    this.container = options.container || null;
    this.angleMode = (options.angleMode || 'DEG').toUpperCase();
    this.activeTab = options.activeTab || 'calculator';

    // State
    this.expression = '';
    this.preview = '';
    this.result = '0';
    this.lastExpression = '';
    this.isScientificOpen = false;
    this.isHistoryOpen = false;
    this.justEvaluated = false;
    this.history = [];

    // Unit Converter State
    this.converterState = {
      category: 'length',
      fromUnit: 'km',
      toUnit: 'm',
      fromValue: 1,
      toValue: 1000
    };

    if (this.container) {
      this.render(this.container);
    }
  }

  /**
   * Renders the glassmorphic luxury interface into the container.
   * If container is not passed and DOM is available, creates and returns a wrapper element.
   *
   * @param {HTMLElement|any} [container]
   * @returns {HTMLElement|any}
   */
  render(container) {
    if (container) {
      this.container = container;
    } else if (!this.container && typeof document !== 'undefined') {
      this.container = document.createElement('div');
    }

    if (this.container && this.container.classList?.add) {
      this.container.classList.add('pravah-calc-root');
    }

    const html = `
      <div class="calc-surface" id="calc-surface">
        <!-- Top App Navigation & Pill Bar -->
        <header class="calc-header">
          <div class="calc-brand">
            <span class="calc-icon">∿</span>
            <span class="calc-title">Pravah Calc</span>
          </div>

          <div class="calc-tab-switcher">
            <button class="calc-tab-btn ${this.activeTab === 'calculator' ? 'active' : ''}" id="tab-btn-calc" data-tab="calculator">
              Calculator
            </button>
            <button class="calc-tab-btn ${this.activeTab === 'converter' ? 'active' : ''}" id="tab-btn-converter" data-tab="converter">
              Converter
            </button>
          </div>

          <div class="calc-header-controls">
            <button class="calc-pill-btn ${this.angleMode === 'RAD' ? 'active' : ''}" id="btn-angle-toggle" title="Switch DEG / RAD">
              ${this.angleMode}
            </button>
            <button class="calc-pill-btn ${this.isScientificOpen ? 'active' : ''}" id="btn-sci-toggle" title="Toggle Scientific Mode">
              f(x)
            </button>
            <button class="calc-pill-btn ${this.isHistoryOpen ? 'active' : ''}" id="btn-history-toggle" title="Calculation Tape History">
              📜 <span class="calc-history-badge" id="calc-history-badge">${this.history.length}</span>
            </button>
          </div>
        </header>

        <!-- Main Workspace (Calculator vs Converter) -->
        <main class="calc-main-content">
          <!-- 1. CALCULATOR VIEW -->
          <div class="calc-view calc-view-math ${this.activeTab === 'calculator' ? 'active' : ''}" id="calc-view-math">
            <!-- Calculation History Tape Drawer -->
            <div class="calc-history-tape ${this.isHistoryOpen ? 'open' : ''}" id="calc-history-tape">
              <div class="calc-history-tape-header">
                <span class="calc-history-heading">Tape History</span>
                <button class="calc-btn-clear-tape" id="btn-clear-tape" title="Clear History">Clear</button>
              </div>
              <div class="calc-history-list" id="calc-history-list">
                ${this._renderHistoryItems()}
              </div>
            </div>

            <!-- Instant Live Evaluation Display Area -->
            <div class="calc-display-panel">
              <div class="calc-display-expr" id="calc-display-expr" title="Current Expression">
                ${this.expression || '0'}
              </div>
              <div class="calc-display-preview" id="calc-display-preview" title="Live Instant Evaluation">
                ${this.preview ? '= ' + this.preview : ''}
              </div>
            </div>

            <!-- Scientific Mode Foldable Grid -->
            <div class="calc-sci-panel ${this.isScientificOpen ? 'open' : ''}" id="calc-sci-panel">
              <button class="calc-key calc-key-sci" data-action="sin">sin</button>
              <button class="calc-key calc-key-sci" data-action="cos">cos</button>
              <button class="calc-key calc-key-sci" data-action="tan">tan</button>
              <button class="calc-key calc-key-sci" data-action="mode-toggle">${this.angleMode}</button>
              
              <button class="calc-key calc-key-sci" data-action="ln">ln</button>
              <button class="calc-key calc-key-sci" data-action="log">log</button>
              <button class="calc-key calc-key-sci" data-action="^">xʸ</button>
              <button class="calc-key calc-key-sci" data-action="sqrt">√</button>

              <button class="calc-key calc-key-sci" data-action="π">π</button>
              <button class="calc-key calc-key-sci" data-action="e">e</button>
              <button class="calc-key calc-key-sci" data-action="(">(</button>
              <button class="calc-key calc-key-sci" data-action=")">)</button>
            </div>

            <!-- Glassmorphic Tactile Keypad -->
            <div class="calc-keypad-grid" id="calc-keypad-grid">
              <button class="calc-key calc-key-action calc-key-danger" data-action="clear">AC</button>
              <button class="calc-key calc-key-action" data-action="toggle-sign">±</button>
              <button class="calc-key calc-key-action" data-action="percent">%</button>
              <button class="calc-key calc-key-op" data-action="÷">÷</button>

              <button class="calc-key calc-key-num" data-action="7">7</button>
              <button class="calc-key calc-key-num" data-action="8">8</button>
              <button class="calc-key calc-key-num" data-action="9">9</button>
              <button class="calc-key calc-key-op" data-action="×">×</button>

              <button class="calc-key calc-key-num" data-action="4">4</button>
              <button class="calc-key calc-key-num" data-action="5">5</button>
              <button class="calc-key calc-key-num" data-action="6">6</button>
              <button class="calc-key calc-key-op" data-action="-">−</button>

              <button class="calc-key calc-key-num" data-action="1">1</button>
              <button class="calc-key calc-key-num" data-action="2">2</button>
              <button class="calc-key calc-key-num" data-action="3">3</button>
              <button class="calc-key calc-key-op" data-action="+">+</button>

              <button class="calc-key calc-key-num" data-action="0">0</button>
              <button class="calc-key calc-key-num" data-action=".">.</button>
              <button class="calc-key calc-key-action" data-action="backspace">⌫</button>
              <button class="calc-key calc-key-equals" data-action="=">=</button>
            </div>
          </div>

          <!-- 2. CONVERTER VIEW -->
          <div class="calc-view calc-view-converter ${this.activeTab === 'converter' ? 'active' : ''}" id="calc-view-converter">
            <div class="converter-category-bar">
              <button class="conv-cat-pill ${this.converterState.category === 'length' ? 'active' : ''}" data-cat="length">Length</button>
              <button class="conv-cat-pill ${this.converterState.category === 'mass' ? 'active' : ''}" data-cat="mass">Weight</button>
              <button class="conv-cat-pill ${this.converterState.category === 'temperature' ? 'active' : ''}" data-cat="temperature">Temp</button>
              <button class="conv-cat-pill ${this.converterState.category === 'currency' ? 'active' : ''}" data-cat="currency">Currency</button>
            </div>

            <div class="conv-card-group">
              <div class="conv-field-card">
                <span class="conv-label">From</span>
                <div class="conv-input-row">
                  <input type="number" class="conv-input" id="conv-from-input" value="${this.converterState.fromValue}" step="any" />
                  <select class="conv-select" id="conv-from-select">
                    ${this._renderUnitOptions(this.converterState.category, this.converterState.fromUnit)}
                  </select>
                </div>
              </div>

              <div class="conv-swap-container">
                <button class="conv-btn-swap" id="btn-conv-swap" title="Swap Units">⇅</button>
              </div>

              <div class="conv-field-card conv-field-card-result">
                <span class="conv-label">To</span>
                <div class="conv-input-row">
                  <input type="text" class="conv-input conv-output" id="conv-to-input" readonly value="${this.converterState.toValue}" />
                  <select class="conv-select" id="conv-to-select">
                    ${this._renderUnitOptions(this.converterState.category, this.converterState.toUnit)}
                  </select>
                </div>
              </div>
            </div>

            <div class="conv-rate-note" id="conv-rate-note">
              ${this._getConversionFormulaNote()}
            </div>
          </div>
        </main>
      </div>
    `;

    if (this.container) {
      this.container.innerHTML = html;
      this._attachEventListeners();
      return this.container;
    }
    return html;
  }

  /**
   * Binds event listeners to a target container if rendered separately.
   * @param {HTMLElement} container
   */
  bindEvents(container) {
    if (container) {
      this.container = container;
      this._attachEventListeners();
    }
  }

  /**
   * Enters a character, number, operator, or function into the active calculator expression.
   * Immediately updates live preview.
   *
   * @param {string} char
   */
  input(char) {
    if (char === null || char === undefined) return;
    const str = String(char);

    // If a calculation was just committed with '='
    if (this.justEvaluated) {
      this.justEvaluated = false;
      // If operator entered, continue calculation with current result
      if (['+', '-', '−', '*', '×', '/', '÷', '^', '%'].includes(str)) {
        this.expression = this.result;
      } else {
        // If number or function, start fresh
        this.expression = '';
      }
    }

    // Standardize operator and math function representations
    switch (str) {
      case '*':
      case '×':
        this.expression += ' × ';
        break;
      case '/':
      case '÷':
        this.expression += ' ÷ ';
        break;
      case '+':
        this.expression += ' + ';
        break;
      case '-':
      case '−':
        this.expression += ' - ';
        break;
      case '^':
        this.expression += '^';
        break;
      case 'sqrt':
      case '√':
        this.expression += 'sqrt(';
        break;
      case 'sin':
      case 'cos':
      case 'tan':
      case 'asin':
      case 'acos':
      case 'atan':
      case 'log':
      case 'ln':
        this.expression += `${str}(`;
        break;
      case 'pi':
        this.expression += 'π';
        break;
      default:
        this.expression += str;
        break;
    }

    this._updateLivePreview();
    this._syncDisplay();
  }

  /**
   * Clears the current expression and preview.
   */
  clear() {
    this.expression = '';
    this.preview = '';
    this.justEvaluated = false;
    this._syncDisplay();
  }

  /**
   * Deletes the last character or function token from the expression.
   */
  backspace() {
    if (!this.expression) return;
    this.justEvaluated = false;

    // Check if ends with multi-char functions like "sin(", "sqrt(", "log(", etc.
    const funcMatch = this.expression.match(/(sin|cos|tan|asin|acos|atan|log|ln|sqrt)\($/);
    if (funcMatch) {
      this.expression = this.expression.slice(0, funcMatch.index);
    } else if (this.expression.endsWith(' × ') || this.expression.endsWith(' ÷ ') || this.expression.endsWith(' + ') || this.expression.endsWith(' - ')) {
      this.expression = this.expression.slice(0, -3);
    } else {
      this.expression = this.expression.slice(0, -1);
    }

    this._updateLivePreview();
    this._syncDisplay();
  }

  /**
   * Commits the current calculation:
   * - Evaluates full expression
   * - Appends calculation record to history tape
   * - Sets expression to result
   */
  calculate() {
    if (!this.expression || !this.expression.trim()) return this.result;

    try {
      const cleanExpr = preparePreviewExpression(this.expression);
      const val = evaluateExpression(cleanExpr, this.angleMode);
      const formatted = formatDisplayNumber(val);

      // Record to history tape
      const entry = {
        id: `calc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        expression: this.expression.trim(),
        result: formatted,
        timestamp: Date.now(),
        formattedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
      this.history.unshift(entry);

      this.lastExpression = this.expression;
      this.result = formatted;
      this.expression = formatted;
      this.preview = '';
      this.justEvaluated = true;

      this._syncDisplay();
      this._updateHistoryUI();
      return val;
    } catch (err) {
      this.preview = 'Error';
      this._syncDisplay();
      return null;
    }
  }

  /**
   * Toggles the sign (+ / -) of the current number or trailing expression component.
   */
  toggleSign() {
    if (!this.expression || this.expression === '0') {
      this.expression = '-';
      this._updateLivePreview();
      this._syncDisplay();
      return;
    }

    if (this.expression === '-') {
      this.expression = '';
      this._updateLivePreview();
      this._syncDisplay();
      return;
    }

    // If ends with (-number) -> unwrap to number
    const wrappedMatch = this.expression.match(/\(\-([0-9\.]+)\)$/);
    if (wrappedMatch) {
      this.expression = this.expression.slice(0, wrappedMatch.index) + wrappedMatch[1];
      this._updateLivePreview();
      this._syncDisplay();
      return;
    }

    // If starts with -number and contains only that number
    if (/^\-([0-9\.]+)$/.test(this.expression)) {
      this.expression = this.expression.slice(1);
      this._updateLivePreview();
      this._syncDisplay();
      return;
    }

    // If ends with a number
    const numMatch = this.expression.match(/([0-9\.]+)$/);
    if (numMatch) {
      const prefix = this.expression.slice(0, numMatch.index);
      if (!prefix) {
        this.expression = '-' + numMatch[1];
      } else {
        this.expression = prefix + '(-' + numMatch[1] + ')';
      }
      this._updateLivePreview();
      this._syncDisplay();
      return;
    }

    this.expression += '-';
    this._updateLivePreview();
    this._syncDisplay();
  }

  /**
   * Appends or evaluates percentage (% = / 100).
   */
  percentage() {
    if (!this.expression) return;
    this.expression += '%';
    this._updateLivePreview();
    this._syncDisplay();
  }

  /**
   * Toggles the scientific keypad panel visible or hidden.
   * @param {boolean} [forceState]
   * @returns {boolean}
   */
  toggleScientific(forceState) {
    this.isScientificOpen = forceState !== undefined ? forceState : !this.isScientificOpen;
    const panel = this.container?.querySelector?.('#calc-sci-panel');
    const btn = this.container?.querySelector?.('#btn-sci-toggle');
    if (panel?.classList) {
      panel.classList.toggle('open', this.isScientificOpen);
    }
    if (btn?.classList) {
      btn.classList.toggle('active', this.isScientificOpen);
    }
    return this.isScientificOpen;
  }

  /**
   * Sets the trigonometric angle mode ('DEG' or 'RAD').
   * @param {'DEG'|'RAD'|'deg'|'rad'} mode
   */
  setAngleMode(mode) {
    const normalized = String(mode).toUpperCase();
    if (normalized === 'DEG' || normalized === 'RAD') {
      this.angleMode = normalized;
      const btn = this.container?.querySelector?.('#btn-angle-toggle');
      if (btn) {
        btn.textContent = this.angleMode;
        btn.classList.toggle('active', this.angleMode === 'RAD');
      }
      const sciModeBtn = this.container?.querySelector?.('[data-action="mode-toggle"]');
      if (sciModeBtn) {
        sciModeBtn.textContent = this.angleMode;
      }
      this._updateLivePreview();
      this._syncDisplay();
    }
    return this.angleMode;
  }

  /**
   * Converts a value between units within Length, Mass/Weight, Temperature, or Currency.
   *
   * @param {number} value
   * @param {string} from
   * @param {string} to
   * @param {string} [category] - 'length' | 'mass' | 'weight' | 'temperature' | 'currency' | 'auto'
   * @returns {number}
   */
  convertUnit(value, from, to, category) {
    const val = Number(value);
    if (!Number.isFinite(val)) return 0;
    const fStr = String(from).trim();
    const tStr = String(to).trim();

    // Determine category if not explicitly given
    let cat = (category || '').toLowerCase();
    if (!cat || cat === 'auto') {
      const fUpper = fStr.toUpperCase();
      const fLower = fStr.toLowerCase();
      if (['C', 'F', 'K'].includes(fUpper)) {
        cat = 'temperature';
      } else if (CONVERSION_TABLES.currency.units[fUpper]) {
        cat = 'currency';
      } else if (CONVERSION_TABLES.mass.units[fLower]) {
        cat = 'mass';
      } else {
        cat = 'length';
      }
    }

    if (cat === 'weight') cat = 'mass';

    // 1. Temperature Conversion
    if (cat === 'temperature') {
      const fU = fStr.toUpperCase();
      const tU = tStr.toUpperCase();
      let c = val;
      if (fU === 'F') c = (val - 32) * 5 / 9;
      else if (fU === 'K') c = val - 273.15;

      let target = c;
      if (tU === 'F') target = (c * 9 / 5) + 32;
      else if (tU === 'K') target = c + 273.15;

      return safeRound(target, 8);
    }

    // 2. Currency Conversion (Pegged Base = USD)
    if (cat === 'currency') {
      const fU = fStr.toUpperCase();
      const tU = tStr.toUpperCase();
      const fromUnit = CONVERSION_TABLES.currency.units[fU];
      const toUnit = CONVERSION_TABLES.currency.units[tU];
      if (!fromUnit || !toUnit) return val;

      const inUSD = val / fromUnit.rate;
      const res = inUSD * toUnit.rate;
      return safeRound(res, 8);
    }

    // 3. Length or Mass Conversion
    const table = cat === 'mass' ? CONVERSION_TABLES.mass : CONVERSION_TABLES.length;
    const fL = fStr.toLowerCase();
    const tL = tStr.toLowerCase();
    const fromUnit = table.units[fL];
    const toUnit = table.units[tL];
    if (!fromUnit || !toUnit) return val;

    const inBase = val * fromUnit.rate;
    const res = inBase / toUnit.rate;
    return safeRound(res, 8);
  }

  /**
   * Returns a copy of the calculation history tape.
   * @returns {Array<Object>}
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Recalls a specific history item into the calculator expression.
   * @param {number} index
   * @param {'result'|'expression'} [part]
   */
  recallHistory(index, part = 'result') {
    const item = this.history[index];
    if (!item) return;

    if (part === 'expression') {
      this.expression = item.expression;
    } else {
      this.expression = item.result;
    }
    this.justEvaluated = true;
    this.result = item.result;
    this._updateLivePreview();
    this._syncDisplay();
  }

  /**
   * Clears all calculation history records.
   */
  clearHistory() {
    this.history = [];
    this._updateHistoryUI();
  }

  /**
   * Toggles the calculation history tape drawer.
   * @param {boolean} [forceState]
   */
  toggleHistoryDrawer(forceState) {
    this.isHistoryOpen = forceState !== undefined ? forceState : !this.isHistoryOpen;
    const drawer = this.container?.querySelector?.('#calc-history-tape');
    const btn = this.container?.querySelector?.('#btn-history-toggle');
    if (drawer?.classList) {
      drawer.classList.toggle('open', this.isHistoryOpen);
    }
    if (btn?.classList) {
      btn.classList.toggle('active', this.isHistoryOpen);
    }
  }

  /**
   * Switches active tab between 'calculator' and 'converter'.
   * @param {'calculator'|'converter'} tab
   */
  switchTab(tab) {
    if (tab !== 'calculator' && tab !== 'converter') return;
    this.activeTab = tab;

    const btnCalc = this.container?.querySelector?.('#tab-btn-calc');
    const btnConv = this.container?.querySelector?.('#tab-btn-converter');
    const viewMath = this.container?.querySelector?.('#calc-view-math');
    const viewConv = this.container?.querySelector?.('#calc-view-converter');

    btnCalc?.classList?.toggle('active', tab === 'calculator');
    btnConv?.classList?.toggle('active', tab === 'converter');
    viewMath?.classList?.toggle('active', tab === 'calculator');
    viewConv?.classList?.toggle('active', tab === 'converter');
  }

  /**
   * Changes the active converter category.
   * @param {'length'|'mass'|'temperature'|'currency'} category
   */
  setConverterCategory(category) {
    const cat = category === 'weight' ? 'mass' : category;
    if (!CONVERSION_TABLES[cat]) return;
    this.converterState.category = cat;

    const unitKeys = Object.keys(CONVERSION_TABLES[cat].units);
    this.converterState.fromUnit = unitKeys[0];
    this.converterState.toUnit = unitKeys[1] || unitKeys[0];

    this._updateConverter();

    // Re-render converter selects and pills
    const pills = this.container?.querySelectorAll?.('.conv-cat-pill');
    if (pills) {
      for (const p of pills) {
        const pCat = p.getAttribute?.('data-cat');
        p.classList?.toggle('active', pCat === cat);
      }
    }

    const selectFrom = this.container?.querySelector?.('#conv-from-select');
    const selectTo = this.container?.querySelector?.('#conv-to-select');
    if (selectFrom) selectFrom.innerHTML = this._renderUnitOptions(cat, this.converterState.fromUnit);
    if (selectTo) selectTo.innerHTML = this._renderUnitOptions(cat, this.converterState.toUnit);
  }

  /**
   * Swaps the 'from' and 'to' converter units.
   */
  swapConverterUnits() {
    const temp = this.converterState.fromUnit;
    this.converterState.fromUnit = this.converterState.toUnit;
    this.converterState.toUnit = temp;

    const selectFrom = this.container?.querySelector?.('#conv-from-select');
    const selectTo = this.container?.querySelector?.('#conv-to-select');
    if (selectFrom) selectFrom.value = this.converterState.fromUnit;
    if (selectTo) selectTo.value = this.converterState.toUnit;

    this._updateConverter();
  }

  /**
   * Triggers haptic pulse vibration and UI feedback.
   */
  triggerHapticPulse(targetElement) {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(12); } catch (_) {}
    }
    if (targetElement?.classList?.add) {
      targetElement.classList.add('haptic-pulse');
      setTimeout(() => targetElement.classList.remove('haptic-pulse'), 160);
    }
  }

  // --- Private Helper Methods ---

  _updateLivePreview() {
    if (!this.expression || !this.expression.trim()) {
      this.preview = '';
      return;
    }
    try {
      const prepared = preparePreviewExpression(this.expression);
      if (!prepared) {
        this.preview = '';
        return;
      }
      const val = evaluateExpression(prepared, this.angleMode);
      this.preview = formatDisplayNumber(val);
    } catch (_) {
      // While typing an incomplete expression, keep previous preview or clear without throwing
      this.preview = '';
    }
  }

  _syncDisplay() {
    const exprEl = this.container?.querySelector?.('#calc-display-expr');
    const prevEl = this.container?.querySelector?.('#calc-display-preview');
    if (exprEl) {
      exprEl.textContent = this.expression || '0';
    }
    if (prevEl) {
      prevEl.textContent = this.preview ? `= ${this.preview}` : '';
    }
  }

  _updateHistoryUI() {
    const badge = this.container?.querySelector?.('#calc-history-badge');
    const list = this.container?.querySelector?.('#calc-history-list');
    if (badge) {
      badge.textContent = String(this.history.length);
    }
    if (list) {
      list.innerHTML = this._renderHistoryItems();
      this._attachHistoryItemEvents();
    }
  }

  _renderHistoryItems() {
    if (!this.history || this.history.length === 0) {
      return '<div class="calc-history-empty">No calculations recorded yet</div>';
    }
    return this.history.map((item, idx) => `
      <div class="calc-history-item" data-index="${idx}" title="Tap to reuse">
        <div class="calc-hist-row">
          <span class="calc-hist-expr">${item.expression}</span>
          <span class="calc-hist-time">${item.formattedTime || ''}</span>
        </div>
        <div class="calc-hist-result">= ${item.result}</div>
      </div>
    `).join('');
  }

  _renderUnitOptions(category, selectedUnit) {
    const catData = CONVERSION_TABLES[category];
    if (!catData) return '';
    return Object.entries(catData.units).map(([key, data]) => {
      const isSel = key === selectedUnit ? 'selected' : '';
      return `<option value="${key}" ${isSel}>${data.name || key}</option>`;
    }).join('');
  }

  _getConversionFormulaNote() {
    const cat = this.converterState.category;
    const from = this.converterState.fromUnit;
    const to = this.converterState.toUnit;
    const sample = this.convertUnit(1, from, to, cat);
    if (cat === 'currency') {
      return `Deterministic Peg: 1 ${from} ≈ ${sample} ${to} • Offline Rates`;
    }
    return `1 ${from} = ${sample} ${to}`;
  }

  _updateConverter() {
    const fromVal = parseFloat(this.converterState.fromValue) || 0;
    const result = this.convertUnit(
      fromVal,
      this.converterState.fromUnit,
      this.converterState.toUnit,
      this.converterState.category
    );
    this.converterState.toValue = formatDisplayNumber(result);

    const outInput = this.container?.querySelector?.('#conv-to-input');
    const noteEl = this.container?.querySelector?.('#conv-rate-note');
    if (outInput) outInput.value = this.converterState.toValue;
    if (noteEl) noteEl.textContent = this._getConversionFormulaNote();
  }

  _attachEventListeners() {
    if (!this.container || !this.container.querySelector) return;

    // Tab buttons
    this.container.querySelector('#tab-btn-calc')?.addEventListener?.('click', (e) => {
      this.triggerHapticPulse(e.currentTarget);
      this.switchTab('calculator');
    });
    this.container.querySelector('#tab-btn-converter')?.addEventListener?.('click', (e) => {
      this.triggerHapticPulse(e.currentTarget);
      this.switchTab('converter');
    });

    // Header buttons
    this.container.querySelector('#btn-angle-toggle')?.addEventListener?.('click', (e) => {
      this.triggerHapticPulse(e.currentTarget);
      this.setAngleMode(this.angleMode === 'DEG' ? 'RAD' : 'DEG');
    });
    this.container.querySelector('#btn-sci-toggle')?.addEventListener?.('click', (e) => {
      this.triggerHapticPulse(e.currentTarget);
      this.toggleScientific();
    });
    this.container.querySelector('#btn-history-toggle')?.addEventListener?.('click', (e) => {
      this.triggerHapticPulse(e.currentTarget);
      this.toggleHistoryDrawer();
    });
    this.container.querySelector('#btn-clear-tape')?.addEventListener?.('click', (e) => {
      this.triggerHapticPulse(e.currentTarget);
      this.clearHistory();
    });

    // Keypad grid buttons
    const keys = this.container.querySelectorAll?.('.calc-key');
    if (keys) {
      for (const key of keys) {
        key.addEventListener?.('click', (e) => {
          this.triggerHapticPulse(e.currentTarget);
          const action = key.getAttribute?.('data-action');
          this._handleKeyAction(action);
        });
      }
    }

    // Converter events
    const fromInput = this.container.querySelector('#conv-from-input');
    fromInput?.addEventListener?.('input', (e) => {
      this.converterState.fromValue = parseFloat(e.target.value) || 0;
      this._updateConverter();
    });

    const fromSelect = this.container.querySelector('#conv-from-select');
    fromSelect?.addEventListener?.('change', (e) => {
      this.converterState.fromUnit = e.target.value;
      this._updateConverter();
    });

    const toSelect = this.container.querySelector('#conv-to-select');
    toSelect?.addEventListener?.('change', (e) => {
      this.converterState.toUnit = e.target.value;
      this._updateConverter();
    });

    this.container.querySelector('#btn-conv-swap')?.addEventListener?.('click', (e) => {
      this.triggerHapticPulse(e.currentTarget);
      this.swapConverterUnits();
    });

    const catPills = this.container.querySelectorAll?.('.conv-cat-pill');
    if (catPills) {
      for (const pill of catPills) {
        pill.addEventListener?.('click', (e) => {
          this.triggerHapticPulse(e.currentTarget);
          const cat = pill.getAttribute?.('data-cat');
          this.setConverterCategory(cat);
        });
      }
    }

    this._attachHistoryItemEvents();
  }

  _handleKeyAction(action) {
    if (!action) return;
    switch (action) {
      case 'clear':
        this.clear();
        break;
      case 'backspace':
        this.backspace();
        break;
      case 'toggle-sign':
        this.toggleSign();
        break;
      case 'percent':
        this.percentage();
        break;
      case '=':
        this.calculate();
        break;
      case 'mode-toggle':
        this.setAngleMode(this.angleMode === 'DEG' ? 'RAD' : 'DEG');
        break;
      default:
        this.input(action);
        break;
    }
  }

  _attachHistoryItemEvents() {
    const items = this.container?.querySelectorAll?.('.calc-history-item');
    if (!items) return;
    for (const item of items) {
      item.addEventListener?.('click', (e) => {
        this.triggerHapticPulse(e.currentTarget);
        const idx = parseInt(item.getAttribute?.('data-index'), 10);
        if (!Number.isNaN(idx)) {
          this.recallHistory(idx, 'result');
          this.toggleHistoryDrawer(false);
        }
      });
    }
  }
}

// Global browser registration
if (typeof window !== 'undefined') {
  window.CalculatorApp = CalculatorApp;
  window.PravahCalculator = {
    CalculatorApp,
    safeRound,
    evaluateExpression,
    CONVERSION_TABLES
  };
}

export default CalculatorApp;
