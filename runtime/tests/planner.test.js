// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CapabilityRegistry } from '../src/registry.js';
import { PolicyGate } from '../src/policy.js';
import { TaskEngine } from '../src/task_engine.js';
import { CoreCapabilities } from '../src/mock_capabilities.js';
import {
  ModelRegistry,
  InferenceFabricRouter,
  IntentSpecialist,
  EntitySpecialist,
  PlanningSpecialist,
  VerificationSpecialist
} from '../src/inference.js';
import { MemoryEngine } from '../src/memory.js';
import { IntentPlanner } from '../src/planner.js';
import { AuthorityLevel, TaskState } from '../src/types.js';

function setupEnvironment() {
  const capRegistry = new CapabilityRegistry();
  for (const cap of Object.values(CoreCapabilities)) {
    capRegistry.register(cap.descriptor, cap.implementation);
  }

  const modelRegistry = new ModelRegistry();
  const intentSpec = new IntentSpecialist();
  const entitySpec = new EntitySpecialist();
  const planSpec = new PlanningSpecialist();
  const verifySpec = new VerificationSpecialist();

  modelRegistry.registerModel(intentSpec.getModelDescriptor(), intentSpec);
  modelRegistry.registerModel(entitySpec.getModelDescriptor(), entitySpec);
  modelRegistry.registerModel(planSpec.getModelDescriptor(), planSpec);
  modelRegistry.registerModel(verifySpec.getModelDescriptor(), verifySpec);

  const router = new InferenceFabricRouter({ registry: modelRegistry });
  const memory = new MemoryEngine();
  const policyGate = new PolicyGate();
  const taskEngine = new TaskEngine({ registry: capRegistry, policyGate });

  const planner = new IntentPlanner({
    router,
    registry: capRegistry,
    memory,
    taskEngine
  });

  return { capRegistry, modelRegistry, router, memory, policyGate, taskEngine, planner };
}

test('IntentPlanner: parses multi-step natural language intent into valid Task DAG', async () => {
  const { planner } = setupEnvironment();

  const plan = await planner.planIntent(
    'Check flight AI-202 and set reminder 2 hours before departure',
    { caller: { componentUrl: 'fuchsia-pkg://pravah.os/travel', delegatedAuthority: AuthorityLevel.EXECUTE } }
  );

  assert.equal(plan.state, TaskState.PLANNED);
  assert.equal(plan.nodes.length, 2);

  const fetchNode = plan.nodes.find(n => n.capabilityId === 'flight.info.get');
  const reminderNode = plan.nodes.find(n => n.capabilityId === 'calendar.reminder.create');

  assert.ok(fetchNode);
  assert.ok(reminderNode);
  assert.equal(fetchNode.inputs.flightNumber, 'AI-202');
  assert.ok(reminderNode.dependencies.includes(fetchNode.nodeId));
});

test('IntentPlanner: enriches missing entities from episodic / semantic memory', async () => {
  const { planner, memory } = setupEnvironment();

  // Store user's favorite flight in memory
  memory.storeFact({
    key: 'preferred_flight',
    value: 'AI-202'
  });

  // User does not specify flight number in the sentence
  const plan = await planner.planIntent(
    'Check my flight and remind me',
    { caller: { componentUrl: 'fuchsia-pkg://pravah.os/travel', delegatedAuthority: AuthorityLevel.EXECUTE } }
  );

  const fetchNode = plan.nodes.find(n => n.capabilityId === 'flight.info.get');
  assert.ok(fetchNode);
  assert.equal(fetchNode.inputs.flightNumber, 'AI-202');
});

test('IntentPlanner: end-to-end plan and autonomous execution with episodic recording', async () => {
  const { planner, memory } = setupEnvironment();

  const result = await planner.planAndExecute(
    'Check flight AI-202 and set reminder 2 hours before departure',
    {
      caller: { componentUrl: 'fuchsia-pkg://pravah.os/travel', delegatedAuthority: AuthorityLevel.EXECUTE },
      contextSource: 'user_spoken_intent'
    }
  );

  assert.equal(result.execution.state, TaskState.COMPLETED);
  assert.equal(result.execution.nodes.get('fetch_flight_info').status, 'COMPLETED');
  assert.equal(result.execution.nodes.get('schedule_flight_reminder').status, 'COMPLETED');

  // Verify memory recorded an episode of this completed task
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/travel', delegatedAuthority: AuthorityLevel.EXECUTE };
  const episodes = memory.queryMemories({ caller, tags: ['TRAVEL_AND_REMINDER'] });
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].content.outcome, TaskState.COMPLETED);
  assert.equal(episodes[0].content.nodeCount, 2);
});

test('IntentPlanner: pauses on irreversible action and waits for user confirmation', async () => {
  const { planner } = setupEnvironment();

  let userConfirmed = false;
  const result = await planner.planAndExecute(
    'Transfer $150 to Alice',
    {
      caller: { componentUrl: 'fuchsia-pkg://pravah.os/wallet', delegatedAuthority: AuthorityLevel.EXECUTE },
      contextSource: 'user_spoken_intent',
      onApprovalNeeded: async (task, node, policy) => {
        userConfirmed = true;
        assert.equal(node.capabilityId, 'wallet.payment.transfer');
        return true; // Authorize
      }
    }
  );

  assert.equal(userConfirmed, true);
  assert.equal(result.execution.state, TaskState.COMPLETED);
  const payNode = result.execution.nodes.get('execute_wallet_transfer');
  assert.equal(payNode.output.status, 'PAID');
  assert.equal(payNode.output.amount, 150);
  assert.equal(payNode.output.recipient, 'Alice');
});
