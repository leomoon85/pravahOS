// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SensitivityLevel,
  RetentionPolicy,
  MemoryType,
  MemoryEngine,
  redactSensitiveData
} from '../src/memory.js';
import { AuthorityLevel } from '../src/types.js';

test('MemoryEngine: records episodic experiences and queries them', () => {
  const engine = new MemoryEngine();

  const episode = engine.recordEpisode({
    taskId: 'task_travel_1',
    goal: 'Book flight AI-202',
    intent: 'TRAVEL_FLIGHT_QUERY',
    outcome: 'COMPLETED',
    nodes: [
      { nodeId: 'node_1', capabilityId: 'flight.info.get', status: 'COMPLETED', output: { gate: '12B' } }
    ]
  });

  assert.ok(episode.id);
  assert.equal(episode.type, MemoryType.EPISODIC);
  assert.equal(episode.content.taskId, 'task_travel_1');

  // Query as EXECUTE caller
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/agent', delegatedAuthority: AuthorityLevel.EXECUTE };
  const results = engine.queryMemories({ caller, tags: ['TRAVEL_FLIGHT_QUERY'] });
  assert.equal(results.length, 1);
  assert.equal(results[0].content.taskId, 'task_travel_1');
});

test('MemoryEngine: privacy boundary gates access by authority and source', () => {
  const engine = new MemoryEngine();

  // Store memories of different sensitivities
  engine.storeFact({
    key: 'public_announcement',
    value: 'System maintenance scheduled for Sunday',
    sensitivity: SensitivityLevel.PUBLIC
  });

  engine.storeFact({
    key: 'user_preferred_seat',
    value: 'Window seat 14A',
    sensitivity: SensitivityLevel.SENSITIVE
  });

  engine.storeFact({
    key: 'wallet_auth_secret',
    value: 'Bearer secret_token_xyz_9982',
    sensitivity: SensitivityLevel.CONFIDENTIAL
  });

  // 1. Observer caller (AuthorityLevel.OBSERVE) -> max INTERNAL -> cannot see SENSITIVE or CONFIDENTIAL
  const observeCaller = { componentUrl: 'fuchsia-pkg://pravah.os/dashboard', delegatedAuthority: AuthorityLevel.OBSERVE };
  const observeResults = engine.queryMemories({ caller: observeCaller });
  const keysVisibleToObserver = observeResults.map(r => r.key);
  assert.ok(keysVisibleToObserver.includes('public_announcement'));
  assert.ok(!keysVisibleToObserver.includes('user_preferred_seat'));
  assert.ok(!keysVisibleToObserver.includes('wallet_auth_secret'));

  // 2. Prepare caller (AuthorityLevel.PREPARE) -> can see PUBLIC & SENSITIVE, but NOT CONFIDENTIAL
  const prepareCaller = { componentUrl: 'fuchsia-pkg://pravah.os/assistant', delegatedAuthority: AuthorityLevel.PREPARE };
  const prepareResults = engine.queryMemories({ caller: prepareCaller });
  const keysVisibleToPrepare = prepareResults.map(r => r.key);
  assert.ok(keysVisibleToPrepare.includes('public_announcement'));
  assert.ok(keysVisibleToPrepare.includes('user_preferred_seat'));
  assert.ok(!keysVisibleToPrepare.includes('wallet_auth_secret'));

  // 3. Untrusted source (e.g. email_body) even with high authority is capped at PUBLIC
  const untrustedResults = engine.queryMemories({
    caller: { componentUrl: 'fuchsia-pkg://pravah.os/email_parser', delegatedAuthority: AuthorityLevel.EXECUTE },
    contextSource: 'email_body'
  });
  const untrustedKeys = untrustedResults.map(r => r.key);
  assert.ok(untrustedKeys.includes('public_announcement'));
  assert.ok(!untrustedKeys.includes('user_preferred_seat'));
  assert.ok(!untrustedKeys.includes('wallet_auth_secret'));

  // 4. Trusted execute caller can see all
  const executeCaller = { componentUrl: 'fuchsia-pkg://pravah.os/wallet', delegatedAuthority: AuthorityLevel.EXECUTE };
  const executeResults = engine.queryMemories({ caller: executeCaller });
  assert.equal(executeResults.length, 3);
});

test('MemoryEngine: working context lifecycle and retention expiration', () => {
  const engine = new MemoryEngine();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/system', delegatedAuthority: AuthorityLevel.EXECUTE };

  // Working context with active TTL
  engine.setWorkingContext('active_flight_id', 'AI-202', { ttlMs: 10000 });
  const val = engine.getWorkingContext('active_flight_id', { caller });
  assert.equal(val, 'AI-202');

  // Working context expired immediately
  engine.setWorkingContext('expired_session_token', 'temp_tok', { ttlMs: -100 });
  const expiredVal = engine.getWorkingContext('expired_session_token', { caller });
  assert.equal(expiredVal, null);

  // Clear session
  engine.clearSessionContext();
  assert.equal(engine.getWorkingContext('active_flight_id', { caller }), null);
});

test('MemoryEngine: GDPR forget and PII redaction', () => {
  const engine = new MemoryEngine();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/system', delegatedAuthority: AuthorityLevel.EXECUTE };

  engine.storeFact({ key: 'user_contact', value: 'Call john@example.com at +1-555-123-4567' });
  engine.storeFact({ key: 'temp_log', value: 'Temporary test fact' });

  // PII Redaction
  const piiText = 'User alice@example.com paid with card 4111-2222-3333-4444 and phone 555-987-6543';
  const redacted = redactSensitiveData(piiText);
  assert.ok(redacted.includes('[REDACTED_EMAIL]'));
  assert.ok(redacted.includes('[REDACTED_CARD]'));
  assert.ok(redacted.includes('[REDACTED_PHONE]'));

  // Forget by key
  const count = engine.forget({ key: 'temp_log' });
  assert.equal(count, 1);

  const results = engine.queryMemories({ caller });
  assert.ok(!results.some(r => r.key === 'temp_log'));
  assert.ok(results.some(r => r.key === 'user_contact'));
});
