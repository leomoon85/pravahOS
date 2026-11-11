// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RiskLevel, AuthorityLevel, TaskState, PolicyDecision } from '../src/types.js';
import { PolicyGate } from '../src/policy.js';
import { CapabilityRegistry } from '../src/registry.js';
import { TaskEngine } from '../src/task_engine.js';
import { CoreCapabilities } from '../src/mock_capabilities.js';

test('PolicyGate: blocks prompt injection / untrusted source mutation', () => {
  const policy = new PolicyGate();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/agent', delegatedAuthority: AuthorityLevel.EXECUTE };

  const result = policy.evaluate({
    caller,
    capabilityDescriptor: CoreCapabilities.CalendarCreateReminder.descriptor,
    contextSource: 'email_body' // Maliciously embedded instruction in email
  });

  assert.equal(result.decision, PolicyDecision.DENY);
  assert.equal(result.reason, 'UNTRUSTED_EXTERNAL_SOURCE_MUTATION_BLOCKED');
});

test('PolicyGate: mandates explicit approval for irreversible actions', () => {
  const policy = new PolicyGate();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/wallet', delegatedAuthority: AuthorityLevel.EXECUTE };

  const result = policy.evaluate({
    caller,
    capabilityDescriptor: CoreCapabilities.WalletPay.descriptor,
    contextSource: 'user_spoken'
  });

  assert.equal(result.decision, PolicyDecision.REQUIRE_USER_APPROVAL);
  assert.equal(result.reason, 'IRREVERSIBLE_ACTION_MANDATES_USER_CONFIRMATION');
});

test('TaskEngine: executes multi-node DAG dependencies in topological order', async () => {
  const registry = new CapabilityRegistry();
  registry.register(CoreCapabilities.FlightInfo.descriptor, CoreCapabilities.FlightInfo.implementation);
  registry.register(CoreCapabilities.CalendarCreateReminder.descriptor, CoreCapabilities.CalendarCreateReminder.implementation);

  const policyGate = new PolicyGate();
  const engine = new TaskEngine({ registry, policyGate });

  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/travel', delegatedAuthority: AuthorityLevel.EXECUTE };

  // Task: "Prepare for tomorrow's flight":
  // Node 1: Fetch flight info (Read-only)
  // Node 2: Create calendar reminder (Dependent on Node 1)
  const task = engine.createTask({
    goal: "Prepare for tomorrow's flight",
    caller,
    contextSource: 'user_direct_intent',
    nodes: [
      { nodeId: 'node_flight', capabilityId: 'flight.info.get', dependencies: [] },
      { nodeId: 'node_reminder', capabilityId: 'calendar.reminder.create', dependencies: ['node_flight'] }
    ]
  });

  const executed = await engine.executeTask(task.id);

  assert.equal(executed.state, TaskState.COMPLETED);
  assert.equal(executed.nodes.get('node_flight').status, 'COMPLETED');
  assert.equal(executed.nodes.get('node_reminder').status, 'COMPLETED');
  assert.equal(executed.nodes.get('node_flight').output.flightNumber, 'AI-202');
});

test('TaskEngine: pauses and prompts when approval is needed', async () => {
  const registry = new CapabilityRegistry();
  registry.register(CoreCapabilities.WalletPay.descriptor, CoreCapabilities.WalletPay.implementation);

  const policyGate = new PolicyGate();
  const engine = new TaskEngine({ registry, policyGate });
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/travel', delegatedAuthority: AuthorityLevel.EXECUTE };

  const task = engine.createTask({
    goal: "Pay for flight upgrade",
    caller,
    contextSource: 'user_direct_intent',
    nodes: [
      { nodeId: 'node_pay', capabilityId: 'wallet.payment.transfer', dependencies: [] }
    ]
  });

  let approvalIntercepted = false;
  const executed = await engine.executeTask(task.id, async (t, node, policy) => {
    approvalIntercepted = true;
    return true; // Simulate user clicking 'Approve'
  });

  assert.equal(approvalIntercepted, true);
  assert.equal(executed.state, TaskState.COMPLETED);
  assert.equal(executed.nodes.get('node_pay').status, 'COMPLETED');
});
