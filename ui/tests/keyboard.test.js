// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KeyboardLayoutMode,
  KeyboardVisibility,
  PredictionEngine,
  SoftKeyboard,
  DICTIONARY_WORDS,
  INTENT_BIGRAMS
} from '../keyboard/keyboard.js';

import {
  VoiceDictationState,
  VoiceDictationEngine,
  WaveformVisualizer,
  VOICE_CORPUS_PRESETS
} from '../keyboard/voice.js';

// Helper mock input element for headless Node.js testing
class MockInputElement {
  constructor(initialValue = '') {
    this.value = initialValue;
    this.selectionStart = initialValue.length;
    this.selectionEnd = initialValue.length;
    this.events = [];
  }

  dispatchEvent(event) {
    this.events.push(event);
  }
}

// ============================================================================
// 1. Prediction Engine Tests
// ============================================================================

test('PredictionEngine: generates intent starters on empty input', () => {
  const engine = new PredictionEngine();
  const suggestions = engine.getSuggestions('', 0);

  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.includes('Check') || suggestions.includes('Send') || suggestions.includes('Compact'));
});

test('PredictionEngine: contextual next-word predictions based on bigrams', () => {
  const engine = new PredictionEngine();
  // With space after "Check "
  const suggestions = engine.getSuggestions('Check ', 6);

  assert.ok(suggestions.includes('flight') || suggestions.includes('audit'));
});

test('PredictionEngine: prefix completions for partial words', () => {
  const engine = new PredictionEngine();
  const suggestions = engine.getSuggestions('fl', 2);

  assert.ok(suggestions.some(s => s.toLowerCase().startsWith('fl')));
  assert.ok(suggestions.map(s => s.toLowerCase()).includes('flight'));
});

test('PredictionEngine: preserves casing on suggested words', () => {
  const engine = new PredictionEngine();
  const suggestions = engine.getSuggestions('Fl', 2);

  assert.ok(suggestions.includes('Flight'));
});

// ============================================================================
// 2. SoftKeyboard Layout & Editing Tests
// ============================================================================

test('SoftKeyboard: layout specifications exist for all modes', () => {
  const layouts = SoftKeyboard.LAYOUTS;
  assert.ok(layouts.lower);
  assert.ok(layouts.upper);
  assert.ok(layouts.caps);
  assert.ok(layouts.numbers);
  assert.ok(layouts.symbols);

  // Check QWERTY top row
  assert.deepEqual(layouts.lower[0], ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']);
  assert.deepEqual(layouts.upper[0], ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P']);
  assert.deepEqual(layouts.numbers[0], ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
});

test('SoftKeyboard: text typing and cursor advancement', () => {
  const mockInput = new MockInputElement('hello');
  const keyboard = new SoftKeyboard({ targetInput: mockInput });

  keyboard.insertText('!');
  assert.equal(mockInput.value, 'hello!');
  assert.equal(mockInput.selectionStart, 6);
  assert.equal(mockInput.selectionEnd, 6);
});

test('SoftKeyboard: backspace deletes character before cursor', () => {
  const mockInput = new MockInputElement('flight');
  const keyboard = new SoftKeyboard({ targetInput: mockInput });

  keyboard.deleteBackward();
  assert.equal(mockInput.value, 'fligh');
  assert.equal(mockInput.selectionStart, 5);

  // Backspace with selection
  mockInput.value = 'AI-202';
  mockInput.selectionStart = 3;
  mockInput.selectionEnd = 6; // selects '202'
  keyboard.deleteBackward();
  assert.equal(mockInput.value, 'AI-');
  assert.equal(mockInput.selectionStart, 3);
});

test('SoftKeyboard: predictive suggestion insertion replaces partial token', () => {
  const mockInput = new MockInputElement('Check fl');
  const keyboard = new SoftKeyboard({ targetInput: mockInput });

  keyboard.insertSuggestion('flight');
  assert.equal(mockInput.value, 'Check flight ');
  assert.equal(mockInput.selectionStart, 13);
});

test('SoftKeyboard: layout switching and mode transitions', () => {
  const keyboard = new SoftKeyboard();
  assert.equal(keyboard.layoutMode, KeyboardLayoutMode.QWERTY_LOWER);

  keyboard.handleKeyAction('mode_num', '?123');
  assert.equal(keyboard.layoutMode, KeyboardLayoutMode.NUMERIC);

  keyboard.handleKeyAction('mode_sym', '=\\<');
  assert.equal(keyboard.layoutMode, KeyboardLayoutMode.SYMBOLS);

  keyboard.handleKeyAction('mode_abc', 'ABC');
  assert.equal(keyboard.layoutMode, KeyboardLayoutMode.QWERTY_LOWER);
});

test('SoftKeyboard: shift key toggles uppercase and double-tap caps lock', () => {
  const keyboard = new SoftKeyboard();
  assert.equal(keyboard.layoutMode, KeyboardLayoutMode.QWERTY_LOWER);

  // Single tap -> upper
  keyboard.handleKeyAction('shift');
  assert.equal(keyboard.layoutMode, KeyboardLayoutMode.QWERTY_UPPER);

  // Double tap within threshold -> caps
  keyboard.shiftTapTime = Date.now();
  keyboard.handleKeyAction('shift');
  assert.equal(keyboard.layoutMode, KeyboardLayoutMode.QWERTY_CAPS);

  // Another tap unlocks caps lock back to lowercase
  keyboard.shiftTapTime = 0; // force separate tap
  keyboard.handleKeyAction('shift');
  assert.equal(keyboard.layoutMode, KeyboardLayoutMode.QWERTY_LOWER);
});

test('SoftKeyboard: submit action calls onSubmit callback', () => {
  const mockInput = new MockInputElement('Verify flight');
  let submittedText = '';
  const keyboard = new SoftKeyboard({
    targetInput: mockInput,
    onSubmit: (text) => {
      submittedText = text;
    }
  });

  keyboard.handleKeyAction('submit');
  assert.equal(submittedText, 'Verify flight');
});

// ============================================================================
// 3. Voice Dictation Engine Tests
// ============================================================================

test('VoiceDictationEngine: state machine transitions from IDLE -> LISTENING -> COMMITTED', async () => {
  const mockInput = new MockInputElement();
  const states = [];

  const engine = new VoiceDictationEngine({
    targetInput: mockInput,
    preset: 'Check flight AI-202',
    onStateChange: (state) => {
      states.push(state);
    }
  });

  assert.equal(engine.state, VoiceDictationState.IDLE);

  engine.start('Check flight AI-202');
  assert.equal(engine.state, VoiceDictationState.LISTENING);

  // Advance state directly or stream
  engine.streamTokens();
  assert.equal(engine.state, VoiceDictationState.TRANSCRIBING);

  const result = engine.commit();
  assert.equal(engine.state, VoiceDictationState.COMMITTED);
  assert.equal(result, engine.transcribedText.trim());
  assert.ok(states.includes(VoiceDictationState.LISTENING));
  assert.ok(states.includes(VoiceDictationState.COMMITTED));
});

test('VoiceDictationEngine: cancel resets transcription and marks state CANCELLED', () => {
  const engine = new VoiceDictationEngine();
  engine.start('Test voice prompt');
  engine.cancel();

  assert.equal(engine.state, VoiceDictationState.CANCELLED);
  assert.equal(engine.transcribedText, '');
});

test('VoiceDictationEngine: audio spectrogram frame synthesis', (t, done) => {
  const engine = new VoiceDictationEngine({
    onAudioFrame: (frame) => {
      assert.ok(frame.amplitude >= 0);
      assert.ok(frame.frequencyBins.length === 16);
      assert.ok(typeof frame.rmsDb === 'number');
      engine.stopAudioSignalGeneration();
      done();
    }
  });

  engine.startAudioSignalGeneration();
});

// ============================================================================
// 4. WaveformVisualizer Logic Tests
// ============================================================================

test('WaveformVisualizer: updateData scales frequency bins symmetrically', () => {
  // Headless mock canvas
  const visualizer = new WaveformVisualizer(null, { barCount: 16 });
  assert.equal(visualizer.targetBins.length, 16);

  visualizer.updateData({
    amplitude: 0.8,
    frequencyBins: new Array(16).fill(200)
  });

  // Verify all target bins are within 0 and 1
  for (const bin of visualizer.targetBins) {
    assert.ok(bin >= 0 && bin <= 1);
  }
});
