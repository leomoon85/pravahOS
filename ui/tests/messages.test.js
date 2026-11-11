// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MessagesApp,
  TelephonySmsCapability,
  TelephonySmsDescriptor,
  DeliveryStatus,
  AIR_GAP_BADGE_TEXT,
  CELLULAR_BADGE_TEXT,
  QUICK_TEMPLATES,
  formatTime,
  calculateSmsSegments,
  generateKemEnvelope,
  SAMPLE_THREADS,
  RiskLevel,
  AuthorityLevel
} from '../apps/messages.js';

// Minimal Mock DOM Container for Node.js headless testing
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
    this.eventListeners = {};
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  querySelector(selector) {
    return new MockElement(selector.replace(/^[#.]/, ''));
  }

  querySelectorAll() {
    return [];
  }

  getAttribute() {
    return null;
  }

  focus() {}
}

test('MessagesApp: constructor initializes with sample threads, airGapSecurity enabled, and valid activeThread', () => {
  const app = new MessagesApp();

  assert.equal(app.airGapSecurity, true);
  assert.ok(app.threads.length >= 3);
  assert.ok(app.activeThreadId);
  assert.equal(typeof app.render, 'function');
  assert.equal(typeof app.sendMessage, 'function');
  assert.equal(typeof app.selectThread, 'function');
  assert.equal(typeof app.search, 'function');
  assert.equal(typeof app.deleteThread, 'function');
  assert.equal(typeof app.setAirGapSecurity, 'function');
});

test('MessagesApp: getThreads() returns threads with computed lastMessage sorted chronologically', () => {
  const app = new MessagesApp();
  const threads = app.getThreads();

  assert.equal(threads.length, app.threads.length);
  // Verify each thread has contact info and lastMessage
  const firstThread = threads[0];
  assert.ok(firstThread.contact.name);
  assert.ok(firstThread.contact.number);
  assert.ok(firstThread.contact.initials);
  assert.ok(firstThread.lastMessage);
  assert.ok(firstThread.lastMessage.body);
});

test('MessagesApp: selectThread(id) selects thread and clears unread pill count', () => {
  const app = new MessagesApp();

  // Find a thread with unread messages
  const aliceThread = app.threads.find(t => t.id === 'thread-alice');
  assert.ok(aliceThread);
  aliceThread.unreadCount = 3;

  const selected = app.selectThread('thread-alice');
  assert.equal(selected.id, 'thread-alice');
  assert.equal(app.activeThreadId, 'thread-alice');
  assert.equal(selected.unreadCount, 0);

  // Non-existent thread returns null
  const nonExistent = app.selectThread('thread-ghost');
  assert.equal(nonExistent, null);
});

test('MessagesApp: sendMessage() validates text and appends sent message with delivery ticks', async () => {
  const app = new MessagesApp();
  app.selectThread('thread-alice');

  // Throws on empty message
  await assert.rejects(async () => {
    await app.sendMessage('');
  }, /Cannot send an empty message/);

  await assert.rejects(async () => {
    await app.sendMessage('   ');
  }, /Cannot send an empty message/);

  // Send valid message
  const sent = await app.sendMessage('Deployment to edge node verified.');
  assert.ok(sent);
  assert.ok(sent.id.startsWith('msg-'));
  assert.equal(sent.direction, 'sent');
  assert.equal(sent.body, 'Deployment to edge node verified.');
  assert.equal(sent.deliveryTicks, '✓');
  assert.equal(sent.encrypted, true);
  assert.equal(sent.securityBadge, AIR_GAP_BADGE_TEXT);

  // Verify message is present in thread
  const messages = app.getMessages('thread-alice');
  const found = messages.find(m => m.id === sent.id);
  assert.ok(found);
  assert.equal(found.body, 'Deployment to edge node verified.');
});

test('MessagesApp: zero-cloud air-gap encryption badge toggling', () => {
  const app = new MessagesApp();
  assert.equal(app.airGapSecurity, true);

  // Toggle off
  const stateOff = app.setAirGapSecurity(false);
  assert.equal(stateOff, false);
  assert.equal(app.airGapSecurity, false);

  // Toggle on
  const stateOn = app.setAirGapSecurity(true);
  assert.equal(stateOn, true);
  assert.equal(app.airGapSecurity, true);
});

test('MessagesApp: ML-KEM-768 post-quantum cryptographic seal envelope generated on air-gap messages', () => {
  const envelope = generateKemEnvelope('Top secret microkernel coordinates', '+1 555-0123');

  assert.equal(envelope.algorithm, 'ML-KEM-768');
  assert.equal(envelope.securityLevel, 'NIST Level 3 Quantum-Resistant');
  assert.equal(envelope.hardwareEnclave, 'Titan M2 Secure Co-Processor');
  assert.equal(envelope.egressState, 'AIR_GAP_ISOLATED');
  assert.equal(envelope.zeroCloudRelay, true);
  assert.ok(envelope.authCiphertextHash.startsWith('sha256:kem768-'));
});

test('MessagesApp: character counter and SMS segment computation logic', () => {
  // Standard short message
  const stats1 = calculateSmsSegments('Hello PravahOS!');
  assert.equal(stats1.length, 15);
  assert.equal(stats1.segments, 1);
  assert.equal(stats1.remaining, 145);
  assert.equal(stats1.summary, '15 / 160 (1 SMS)');

  // Exactly 160 chars
  const text160 = 'A'.repeat(160);
  const stats160 = calculateSmsSegments(text160);
  assert.equal(stats160.length, 160);
  assert.equal(stats160.segments, 1);
  assert.equal(stats160.remaining, 0);

  // 161 chars (overflows to 2 segments of concatenated SMS, 153 chars each)
  const text161 = 'A'.repeat(161);
  const stats161 = calculateSmsSegments(text161);
  assert.equal(stats161.length, 161);
  assert.equal(stats161.segments, 2);
  assert.equal(stats161.summary, '161 / 306 (2 SMS)');
});

test('MessagesApp: quick-reply template execution', async () => {
  const app = new MessagesApp();
  app.selectThread('thread-elena');

  for (const template of QUICK_TEMPLATES) {
    const sent = await app.quickReply(template);
    assert.equal(sent.body, template);
    assert.equal(sent.direction, 'sent');
  }

  const messages = app.getMessages('thread-elena');
  assert.ok(messages.some(m => m.body === 'On my way!'));
  assert.ok(messages.some(m => m.body === 'Can you call me?'));
  assert.ok(messages.some(m => m.body === 'Offline air-gap verified'));
});

test('MessagesApp: scheduled message simulation delivers with scheduled status and timer execution', async () => {
  const app = new MessagesApp();
  app.selectThread('thread-alice');

  const scheduled = await app.scheduleMessage('thread-alice', 'Emergency backup scheduled alert', 50);
  assert.equal(scheduled.status, 'SCHEDULED');
  assert.ok(scheduled.scheduledFor);
  assert.equal(app.scheduledQueue.length, 1);

  // Wait for the scheduled timer to fire (50ms + 50ms buffer)
  await new Promise(resolve => setTimeout(resolve, 120));

  assert.equal(scheduled.status, DeliveryStatus.SENT);
  assert.equal(scheduled.deliveryTicks, '✓');

  // Clear pending timers to prevent open handles
  app.scheduledTimers.forEach(t => clearTimeout(t));
});

test('MessagesApp: search() filters threads and messages across contact names, numbers, and bodies', () => {
  const app = new MessagesApp();

  // Search by contact name
  const nameResults = app.search('Alice');
  assert.ok(nameResults.length >= 1);
  assert.equal(nameResults[0].thread.contact.name, 'Alice Smith');

  // Search by phone number
  const numResults = app.search('555-0199');
  assert.ok(numResults.length >= 1);
  assert.equal(numResults[0].thread.contact.name, 'Dr. Elena Vance');

  // Search by message body content
  const bodyResults = app.search('StarLink');
  assert.ok(bodyResults.length >= 1);
  assert.equal(bodyResults[0].thread.contact.name, 'SatCom NTN Gateway');
  assert.ok(bodyResults[0].matchedMessages.length >= 1);

  // Empty query returns all threads
  const allResults = app.search('');
  assert.equal(allResults.length, app.threads.length);

  // Non-matching query returns empty
  const noResults = app.search('zyx999nonsenseQuery');
  assert.equal(noResults.length, 0);
});

test('MessagesApp: deleteThread(id) removes thread cleanly and updates active selection', async () => {
  const app = new MessagesApp();
  const initialCount = app.threads.length;

  app.selectThread('thread-bob');
  assert.equal(app.activeThreadId, 'thread-bob');

  const deleted = await app.deleteThread('thread-bob');
  assert.equal(deleted, true);
  assert.equal(app.threads.length, initialCount - 1);
  assert.equal(app.threads.some(t => t.id === 'thread-bob'), false);
  // Active thread should automatically switch away from deleted thread
  assert.notEqual(app.activeThreadId, 'thread-bob');

  // Deleting non-existent thread returns false
  const deleteFake = await app.deleteThread('fake-id');
  assert.equal(deleteFake, false);
});

test('MessagesApp: Microkernel capability telephony.sms executes send, receive, query, and delete actions', async () => {
  const cap = new TelephonySmsCapability();

  // Verify descriptor
  assert.equal(TelephonySmsDescriptor.id, 'telephony.sms');
  assert.equal(TelephonySmsDescriptor.riskLevel, RiskLevel.CONSEQUENTIAL);
  assert.equal(TelephonySmsDescriptor.requiredAuthority, AuthorityLevel.EXECUTE);
  assert.deepEqual(TelephonySmsDescriptor.actions, ['send', 'receive', 'query', 'delete']);

  // 1. Send SMS
  const sendRes = await cap.execute({
    action: 'send',
    payload: {
      recipient: '+1 555-0123',
      body: 'Testing microkernel telephony capability hook',
      airGapEncrypted: true
    }
  });
  assert.equal(sendRes.success, true);
  assert.ok(sendRes.messageId);
  assert.equal(sendRes.cryptoEnvelope.algorithm, 'ML-KEM-768');
  assert.equal(sendRes.cryptoEnvelope.enclave, 'Titan M2');

  // 2. Receive SMS
  const rxRes = await cap.execute({
    action: 'receive',
    payload: {
      sender: '+1 555-0123',
      body: 'Inbound cellular message via HAL'
    }
  });
  assert.equal(rxRes.success, true);
  assert.equal(rxRes.record.sender, '+1 555-0123');

  // 3. Query SMS
  const queryRes = await cap.execute({
    action: 'query',
    payload: { query: 'microkernel' }
  });
  assert.equal(queryRes.success, true);
  assert.equal(queryRes.count, 1);

  // 4. Delete SMS
  const delRes = await cap.execute({
    action: 'delete',
    payload: { messageId: sendRes.messageId }
  });
  assert.equal(delRes.success, true);

  // 5. Unknown action throws
  await assert.rejects(async () => {
    await cap.execute({ action: 'unsupportedAction' });
  }, /Unknown action/);
});

test('MessagesApp: render() populates DOM container with conversation list, bubbles, and composer', () => {
  const container = new MockElement('messages-root');
  const app = new MessagesApp({ container });

  app.render();

  assert.ok(container.innerHTML.includes('messages-app-container'));
  assert.ok(container.innerHTML.includes('conversation-thread-list'));
  assert.ok(container.innerHTML.includes('messages-chat-pane'));
  assert.ok(container.innerHTML.includes(AIR_GAP_BADGE_TEXT));
  assert.ok(container.innerHTML.includes('composer-textarea'));
  assert.ok(container.innerHTML.includes('btn-send-message'));
  assert.ok(container.innerHTML.includes('quick-templates-bar'));

  // Test open and close
  app.open();
  assert.equal(container.classList.contains('expanded'), true);
  app.close();
  assert.equal(container.classList.contains('expanded'), false);
});
