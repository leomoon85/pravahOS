// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file keyboard.js
 * PravahOS Native Mobile Touch Software Keyboard (IME).
 * Features:
 * - Multi-layer layout (QWERTY lowercase, uppercase, caps lock, numbers, symbols)
 * - Predictive text suggestion strip with contextual intent completions
 * - Tactile keypress feedback with pop-up bubble previews and haptics
 * - Smooth spring slide-up / slide-down animations
 * - Full cursor and selection awareness for seamless input editing
 */

export const KeyboardLayoutMode = {
  QWERTY_LOWER: 'lower',
  QWERTY_UPPER: 'upper',
  QWERTY_CAPS: 'caps',
  NUMERIC: 'numbers',
  SYMBOLS: 'symbols'
};

export const KeyboardVisibility = {
  HIDDEN: 'HIDDEN',
  SLIDING_UP: 'SLIDING_UP',
  SHOWN: 'SHOWN',
  SLIDING_DOWN: 'SLIDING_DOWN'
};

/**
 * Built-in dictionary & bigram intent prediction corpus
 */
export const DICTIONARY_WORDS = [
  'check', 'flight', 'ai-202', 'and', 'set', 'reminder', 'hours', 'before', 'departure',
  'send', '₹5,000', 'to', 'alice', 'from', 'verified', 'account', 'for', 'dinner',
  'compact', 'secure', 'memory', 'flush', 'temporary', 'neural', 'cache',
  'extract', 'receipt', 'text', 'file', 'expense', 'record', 'with', 'privacy', 'redaction',
  'schedule', 'meeting', 'tomorrow', 'policy', 'gate', 'audit', 'trail', 'tamper', 'ledger',
  'status', 'system', 'crypto', 'terminal', 'delhi', 'airport', 'air-gap', 'active', 'approve'
];

export const INTENT_BIGRAMS = {
  '': ['Check', 'Send', 'Compact', 'Extract', 'Schedule'],
  'check': ['flight', 'audit', 'status', 'memory', 'telemetry'],
  'flight': ['AI-202', 'status', 'schedule', 'details', 'booking'],
  'ai-202': ['and', 'status', 'departure', 'gate', 'schedule'],
  'and': ['set', 'flush', 'file', 'verify', 'notify'],
  'set': ['reminder', 'policy', 'air-gap', 'threshold', 'alarm'],
  'reminder': ['2', 'hours', 'before', 'for', 'tomorrow'],
  '2': ['hours', 'days', 'minutes', 'tickets'],
  'hours': ['before', 'after', 'remaining', 'prior'],
  'before': ['departure', 'flight', 'midnight', 'takeoff'],
  'send': ['₹5,000', '₹1,000', 'payment', 'audit', 'alert'],
  '₹5,000': ['to', 'for', 'from', 'as'],
  'to': ['Alice', 'Bob', 'verified', 'terminal', 'Council'],
  'compact': ['secure', 'system', 'neural', 'local'],
  'secure': ['memory', 'cache', 'ledger', 'storage', 'channel'],
  'flush': ['temporary', 'neural', 'cache', 'buffers'],
  'extract': ['receipt', 'document', 'text', 'expense'],
  'receipt': ['text', 'data', 'summary', 'details']
};

/**
 * PredictionEngine
 * Suggests contextual completions and next-word recommendations.
 */
export class PredictionEngine {
  constructor(dictionary = DICTIONARY_WORDS, bigrams = INTENT_BIGRAMS) {
    this.dictionary = [...dictionary];
    this.bigrams = { ...bigrams };
  }

  /**
   * Get suggestions for the given full text and cursor position
   * @param {string} fullText
   * @param {number} cursorPos
   * @returns {string[]} Array of up to 4 suggested words
   */
  getSuggestions(fullText = '', cursorPos = fullText.length) {
    const textBeforeCursor = fullText.slice(0, cursorPos);
    const tokens = textBeforeCursor.trim().split(/\s+/);
    const lastWord = textBeforeCursor.endsWith(' ') ? '' : (tokens[tokens.length - 1] || '');
    const prevWord = textBeforeCursor.endsWith(' ') 
      ? (tokens[tokens.length - 1] || '').toLowerCase()
      : (tokens[tokens.length - 2] || '').toLowerCase();

    const results = new Set();

    if (lastWord.length > 0) {
      // Prefix completion
      const prefix = lastWord.toLowerCase();
      for (const word of this.dictionary) {
        if (word.toLowerCase().startsWith(prefix) && word.toLowerCase() !== prefix) {
          results.add(this.formatSuggestion(word, lastWord));
          if (results.size >= 4) break;
        }
      }
    } else {
      // Next-word prediction based on previous word
      const nextCandidates = this.bigrams[prevWord] || this.bigrams[''] || [];
      for (const cand of nextCandidates) {
        results.add(cand);
        if (results.size >= 4) break;
      }
    }

    // Fallbacks if fewer than 3 suggestions
    if (results.size < 3) {
      const defaults = ['Check', 'AI-202', 'flight', 'reminder', 'secure', 'send'];
      for (const d of defaults) {
        if (!results.has(d)) results.add(d);
        if (results.size >= 3) break;
      }
    }

    return Array.from(results).slice(0, 4);
  }

  formatSuggestion(word, inputCase) {
    if (inputCase && inputCase[0] === inputCase[0].toUpperCase()) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  }
}

/**
 * SoftKeyboard
 * Native Mobile Touch Software Keyboard Controller.
 */
export class SoftKeyboard {
  constructor(options = {}) {
    this.options = options;
    this.container = null;
    this.previewBubble = null;
    this.targetInput = options.targetInput || null;
    this.layoutMode = KeyboardLayoutMode.QWERTY_LOWER;
    this.visibility = KeyboardVisibility.HIDDEN;
    this.predictionEngine = new PredictionEngine();
    this.suggestions = [];
    this.shiftTapTime = 0;
    this.voiceHandler = options.voiceHandler || null;
    this.onSubmit = options.onSubmit || null;
    this.onVisibilityChange = options.onVisibilityChange || null;
    this.onKeyPress = options.onKeyPress || null;
    this.isMuted = false;
  }

  /**
   * Layout specifications
   */
  static get LAYOUTS() {
    return {
      lower: [
        ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
        ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
        [
          { type: 'shift', label: '⇧', span: 1.4 },
          'z', 'x', 'c', 'v', 'b', 'n', 'm',
          { type: 'backspace', label: '⌫', span: 1.4 }
        ],
        [
          { type: 'mode_num', label: '?123', span: 1.3 },
          { type: 'voice', label: '🎤', span: 1.1 },
          { type: 'char', label: ',', value: ',' },
          { type: 'space', label: 'space', span: 3.8 },
          { type: 'char', label: '.', value: '.' },
          { type: 'submit', label: 'Done', span: 1.4 }
        ]
      ],
      upper: [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        [
          { type: 'shift', label: '⬆', span: 1.4, active: true },
          'Z', 'X', 'C', 'V', 'B', 'N', 'M',
          { type: 'backspace', label: '⌫', span: 1.4 }
        ],
        [
          { type: 'mode_num', label: '?123', span: 1.3 },
          { type: 'voice', label: '🎤', span: 1.1 },
          { type: 'char', label: ',', value: ',' },
          { type: 'space', label: 'space', span: 3.8 },
          { type: 'char', label: '.', value: '.' },
          { type: 'submit', label: 'Done', span: 1.4 }
        ]
      ],
      caps: [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        [
          { type: 'shift', label: '⇪', span: 1.4, locked: true },
          'Z', 'X', 'C', 'V', 'B', 'N', 'M',
          { type: 'backspace', label: '⌫', span: 1.4 }
        ],
        [
          { type: 'mode_num', label: '?123', span: 1.3 },
          { type: 'voice', label: '🎤', span: 1.1 },
          { type: 'char', label: ',', value: ',' },
          { type: 'space', label: 'space', span: 3.8 },
          { type: 'char', label: '.', value: '.' },
          { type: 'submit', label: 'Done', span: 1.4 }
        ]
      ],
      numbers: [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['@', '#', '₹', '$', '%', '&', '-', '+', '(', ')'],
        [
          { type: 'mode_sym', label: '=\\<', span: 1.4 },
          '*', '"', "'", ':', ';', '!', '?',
          { type: 'backspace', label: '⌫', span: 1.4 }
        ],
        [
          { type: 'mode_abc', label: 'ABC', span: 1.3 },
          { type: 'voice', label: '🎤', span: 1.1 },
          { type: 'char', label: ',', value: ',' },
          { type: 'space', label: 'space', span: 3.8 },
          { type: 'char', label: '.', value: '.' },
          { type: 'submit', label: 'Done', span: 1.4 }
        ]
      ],
      symbols: [
        ['~', '`', '|', '•', '√', 'π', '÷', '×', '¶', '∆'],
        ['£', '€', '¥', '¢', '^', '°', '=', '{', '}', '\\'],
        [
          { type: 'mode_num', label: '?123', span: 1.4 },
          '%', '_', '<', '>', '[', ']', '«', '»',
          { type: 'backspace', label: '⌫', span: 1.4 }
        ],
        [
          { type: 'mode_abc', label: 'ABC', span: 1.3 },
          { type: 'voice', label: '🎤', span: 1.1 },
          { type: 'char', label: ',', value: ',' },
          { type: 'space', label: 'space', span: 3.8 },
          { type: 'char', label: '.', value: '.' },
          { type: 'submit', label: 'Done', span: 1.4 }
        ]
      ]
    };
  }

  /**
   * Mount keyboard DOM into host element
   * @param {HTMLElement} parent
   */
  mount(parent = document.body) {
    if (this.container || typeof document === 'undefined') return;

    // Keyboard container
    this.container = document.createElement('div');
    this.container.className = 'pravah-virtual-keyboard hidden';
    this.container.setAttribute('role', 'region');
    this.container.setAttribute('aria-label', 'Virtual Software Keyboard');

    // Key bubble preview element
    this.previewBubble = document.createElement('div');
    this.previewBubble.className = 'key-preview-bubble';
    this.container.appendChild(this.previewBubble);

    // Suggestion Strip
    const suggestionStrip = document.createElement('div');
    suggestionStrip.className = 'keyboard-suggestion-strip';
    suggestionStrip.id = 'keyboard-suggestion-strip';
    this.container.appendChild(suggestionStrip);

    // Key Matrix
    const keysContainer = document.createElement('div');
    keysContainer.className = 'keyboard-matrix';
    keysContainer.id = 'keyboard-matrix';
    this.container.appendChild(keysContainer);

    parent.appendChild(this.container);

    // Render initial layout
    this.renderKeys();
    this.updateSuggestions();

    // Backdrop dismissal listener (tap outside keyboard while shown)
    document.addEventListener('pointerdown', (e) => {
      if (this.visibility !== KeyboardVisibility.SHOWN) return;
      if (this.container.contains(e.target)) return;
      if (this.targetInput && (this.targetInput === e.target || this.targetInput.contains(e.target))) return;
      // Clicked outside, dismiss keyboard
      this.hide();
    });
  }

  /**
   * Bind input element to keyboard
   * @param {HTMLInputElement|HTMLTextAreaElement} inputEl
   */
  attach(inputEl) {
    if (!inputEl) return;
    this.targetInput = inputEl;

    // Prevent focus loss when tapping keys
    inputEl.addEventListener('focus', () => {
      this.show();
    });

    inputEl.addEventListener('input', () => {
      this.updateSuggestions();
    });

    inputEl.addEventListener('click', () => {
      this.show();
      this.updateSuggestions();
    });
  }

  /**
   * Slide keyboard up smoothly
   */
  show() {
    if (!this.container) this.mount();
    if (!this.container) return;

    this.visibility = KeyboardVisibility.SLIDING_UP;
    this.notifyVisibility();

    this.container.classList.remove('hidden');
    // Force browser reflow for CSS transition
    void this.container.offsetWidth;
    this.container.classList.add('visible');

    setTimeout(() => {
      this.visibility = KeyboardVisibility.SHOWN;
      this.notifyVisibility();
    }, 280);

    this.updateSuggestions();
  }

  /**
   * Slide keyboard down smoothly
   */
  hide() {
    if (!this.container || this.visibility === KeyboardVisibility.HIDDEN) return;

    this.visibility = KeyboardVisibility.SLIDING_DOWN;
    this.notifyVisibility();

    this.container.classList.remove('visible');

    setTimeout(() => {
      this.container.classList.add('hidden');
      this.visibility = KeyboardVisibility.HIDDEN;
      this.notifyVisibility();
    }, 280);
  }

  notifyVisibility() {
    if (this.onVisibilityChange) {
      this.onVisibilityChange(this.visibility);
    }
  }

  setLayoutMode(mode) {
    if (this.layoutMode === mode) return;
    this.layoutMode = mode;
    this.renderKeys();
  }

  /**
   * Renders current keys matrix based on active layout mode
   */
  renderKeys() {
    if (!this.container) return;
    const matrix = this.container.querySelector('#keyboard-matrix');
    if (!matrix) return;

    matrix.innerHTML = '';
    const layout = SoftKeyboard.LAYOUTS[this.layoutMode] || SoftKeyboard.LAYOUTS.lower;

    layout.forEach((rowDef) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'keyboard-row';

      rowDef.forEach((keyDef) => {
        const keyBtn = document.createElement('button');
        keyBtn.className = 'virtual-key';
        keyBtn.type = 'button';

        let keyType = 'char';
        let keyLabel = '';
        let keyValue = '';
        let span = 1;

        if (typeof keyDef === 'string') {
          keyLabel = keyDef;
          keyValue = keyDef;
        } else {
          keyType = keyDef.type;
          keyLabel = keyDef.label;
          keyValue = keyDef.value ?? keyDef.label;
          span = keyDef.span || 1;

          if (keyDef.active) keyBtn.classList.add('active');
          if (keyDef.locked) keyBtn.classList.add('locked');
        }

        keyBtn.dataset.type = keyType;
        keyBtn.dataset.value = keyValue;
        keyBtn.textContent = keyLabel;
        keyBtn.style.flex = `${span} 1 0px`;

        if (keyType !== 'char') {
          keyBtn.classList.add(`key-special`, `key-${keyType}`);
        }

        this.bindKeyEvents(keyBtn, keyType, keyValue, keyLabel);
        rowEl.appendChild(keyBtn);
      });

      matrix.appendChild(rowEl);
    });
  }

  /**
   * Bind touch and pointer handlers for key press feedback
   */
  bindKeyEvents(keyBtn, type, value, label) {
    // Avoid losing focus in input field
    keyBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      keyBtn.classList.add('key-pressed');
      this.triggerHaptic();

      // Show pop-up bubble preview for character keys
      if (type === 'char') {
        this.showBubblePreview(keyBtn, label);
      }
    });

    const releaseKey = () => {
      keyBtn.classList.remove('key-pressed');
      this.hideBubblePreview();
    };

    keyBtn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      releaseKey();
      this.handleKeyAction(type, value);
    });

    keyBtn.addEventListener('pointercancel', releaseKey);
    keyBtn.addEventListener('pointerleave', releaseKey);
  }

  showBubblePreview(keyBtn, text) {
    if (!this.previewBubble) return;
    const rect = keyBtn.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    this.previewBubble.textContent = text;
    this.previewBubble.style.left = `${rect.left + rect.width / 2 - containerRect.left}px`;
    this.previewBubble.style.top = `${rect.top - containerRect.top - 8}px`;
    this.previewBubble.classList.add('bubble-active');
  }

  hideBubblePreview() {
    if (!this.previewBubble) return;
    this.previewBubble.classList.remove('bubble-active');
  }

  triggerHaptic() {
    if (!this.isMuted && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(8);
      } catch (_) {}
    }
  }

  /**
   * Key action dispatcher
   */
  handleKeyAction(type, value) {
    if (this.onKeyPress) {
      this.onKeyPress({ type, value });
    }

    switch (type) {
      case 'char':
        this.insertText(value);
        // If in one-shot upper mode, return to lower
        if (this.layoutMode === KeyboardLayoutMode.QWERTY_UPPER) {
          this.setLayoutMode(KeyboardLayoutMode.QWERTY_LOWER);
        }
        break;

      case 'space':
        this.insertText(' ');
        if (this.layoutMode === KeyboardLayoutMode.QWERTY_UPPER) {
          this.setLayoutMode(KeyboardLayoutMode.QWERTY_LOWER);
        }
        break;

      case 'backspace':
        this.deleteBackward();
        break;

      case 'shift': {
        const now = Date.now();
        if (now - this.shiftTapTime < 320) {
          // Double tap -> Caps Lock
          this.setLayoutMode(
            this.layoutMode === KeyboardLayoutMode.QWERTY_CAPS
              ? KeyboardLayoutMode.QWERTY_LOWER
              : KeyboardLayoutMode.QWERTY_CAPS
          );
        } else {
          // Single tap -> Toggle upper/lower
          this.setLayoutMode(
            this.layoutMode === KeyboardLayoutMode.QWERTY_LOWER
              ? KeyboardLayoutMode.QWERTY_UPPER
              : KeyboardLayoutMode.QWERTY_LOWER
          );
        }
        this.shiftTapTime = now;
        break;
      }

      case 'mode_num':
        this.setLayoutMode(KeyboardLayoutMode.NUMERIC);
        break;

      case 'mode_sym':
        this.setLayoutMode(KeyboardLayoutMode.SYMBOLS);
        break;

      case 'mode_abc':
        this.setLayoutMode(KeyboardLayoutMode.QWERTY_LOWER);
        break;

      case 'voice':
        if (this.voiceHandler) {
          this.voiceHandler();
        }
        break;

      case 'submit':
        if (this.onSubmit) {
          this.onSubmit(this.targetInput ? this.targetInput.value : '');
        }
        this.hide();
        break;
    }

    this.updateSuggestions();
  }

  /**
   * Insert text at current cursor location
   */
  insertText(char) {
    if (!this.targetInput) return;
    const input = this.targetInput;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const text = input.value || '';

    input.value = text.slice(0, start) + char + text.slice(end);
    const newPos = start + char.length;
    input.selectionStart = newPos;
    input.selectionEnd = newPos;

    // Dispatch input event for external listeners
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Delete character before cursor
   */
  deleteBackward() {
    if (!this.targetInput) return;
    const input = this.targetInput;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const text = input.value || '';

    if (start === 0 && end === 0) return;

    if (start !== end) {
      input.value = text.slice(0, start) + text.slice(end);
      input.selectionStart = start;
      input.selectionEnd = start;
    } else {
      input.value = text.slice(0, start - 1) + text.slice(end);
      input.selectionStart = start - 1;
      input.selectionEnd = start - 1;
    }

    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Replaces partial word at cursor with selected completion
   */
  insertSuggestion(word) {
    if (!this.targetInput) return;
    const input = this.targetInput;
    const text = input.value || '';
    const pos = input.selectionStart ?? text.length;

    const textBefore = text.slice(0, pos);
    const textAfter = text.slice(pos);

    let newBefore;
    if (textBefore.endsWith(' ')) {
      // Append word after space
      newBefore = `${textBefore}${word} `;
    } else {
      // Replace last word token
      const match = textBefore.match(/\S+$/);
      if (match) {
        newBefore = textBefore.slice(0, match.index) + word + ' ';
      } else {
        newBefore = textBefore + word + ' ';
      }
    }

    input.value = newBefore + textAfter;
    const newPos = newBefore.length;
    input.selectionStart = newPos;
    input.selectionEnd = newPos;

    input.dispatchEvent(new Event('input', { bubbles: true }));
    this.updateSuggestions();
  }

  /**
   * Refresh predictive suggestions strip
   */
  updateSuggestions() {
    if (!this.container) return;
    const strip = this.container.querySelector('#keyboard-suggestion-strip');
    if (!strip) return;

    const text = this.targetInput ? this.targetInput.value : '';
    const pos = this.targetInput ? (this.targetInput.selectionStart ?? text.length) : text.length;

    this.suggestions = this.predictionEngine.getSuggestions(text, pos);
    strip.innerHTML = '';

    this.suggestions.forEach((item) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'suggestion-chip';
      chip.textContent = item;

      chip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.triggerHaptic();
        this.insertSuggestion(item);
      });

      strip.appendChild(chip);
    });
  }
}

// Global window registration for vanilla HTML script loading
if (typeof window !== 'undefined') {
  window.PravahKeyboard = {
    KeyboardLayoutMode,
    KeyboardVisibility,
    PredictionEngine,
    SoftKeyboard,
    DICTIONARY_WORDS,
    INTENT_BIGRAMS
  };
}
