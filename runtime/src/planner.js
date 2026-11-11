// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { ModelRole } from './inference.js';
import { TaskState } from './types.js';

export class IntentPlanner {
  /**
   * @param {Object} options
   * @param {import('./inference.js').InferenceFabricRouter} options.router
   * @param {import('./registry.js').CapabilityRegistry} options.registry
   * @param {import('./memory.js').MemoryEngine} [options.memory]
   * @param {import('./task_engine.js').TaskEngine} [options.taskEngine]
   */
  constructor({ router, registry, memory = null, taskEngine = null }) {
    if (!router) throw new Error('IntentPlanner requires InferenceFabricRouter');
    if (!registry) throw new Error('IntentPlanner requires CapabilityRegistry');

    this.router = router;
    this.registry = registry;
    this.memory = memory;
    this.taskEngine = taskEngine;
  }

  /**
   * Enrich raw intent with context from memory (semantic facts, working context, episodes).
   */
  async enrichContext({ caller, contextSource }) {
    if (!this.memory) return {};

    const enriched = {};
    const memories = this.memory.queryMemories({
      caller,
      contextSource,
      limit: 10
    });

    for (const mem of memories) {
      if (mem.type === 'SEMANTIC') {
        enriched[mem.key] = mem.content;
      }
    }

    return enriched;
  }

  /**
   * Decompose natural language human intent into a verified structured Task DAG.
   */
  async planIntent(rawIntent, { caller, contextSource = 'user_spoken_intent' } = {}) {
    if (!rawIntent || typeof rawIntent !== 'string' || !rawIntent.trim()) {
      throw new Error('Valid rawIntent string is required');
    }

    let tokensEvaluated = 0;

    // 1. Context Enrichment from Memory
    const userContext = await this.enrichContext({ caller, contextSource });

    // 2. Classify Intent via Specialist Model
    const intentRes = await this.router.routeInfer({
      role: ModelRole.INTENT,
      input: rawIntent
    });
    tokensEvaluated += intentRes.tokens_evaluated || 0;
    const { intent, confidence, summary } = intentRes.output;

    // 3. Extract Named Entities via Specialist Model
    const entityRes = await this.router.routeInfer({
      role: ModelRole.ENTITY,
      input: rawIntent
    });
    tokensEvaluated += entityRes.tokens_evaluated || 0;
    const extractedEntities = entityRes.output?.entities || {};

    // Merge context defaults based on intent if entities are missing
    const mergedEntities = { ...extractedEntities };
    if (intent?.includes('TRAVEL') && !mergedEntities.flightNumber && userContext.preferred_flight) {
      mergedEntities.flightNumber = userContext.preferred_flight;
    }
    if (intent?.includes('WALLET') && !mergedEntities.recipient && userContext.default_payment_recipient) {
      mergedEntities.recipient = userContext.default_payment_recipient;
    }

    // 4. Deconstruct into candidate DAG steps via Planning Specialist
    const availableCapabilities = this.registry.list();
    const planRes = await this.router.routeInfer({
      role: ModelRole.PLANNING,
      input: {
        intent,
        entities: mergedEntities,
        capabilities: availableCapabilities,
        context: userContext
      }
    });
    tokensEvaluated += planRes.tokens_evaluated || 0;
    const candidateNodes = planRes.output?.nodes || [];

    if (candidateNodes.length === 0) {
      throw new Error(`Planner could not decompose intent: "${rawIntent}" into viable capability nodes`);
    }

    // 5. Verify DAG Integrity via Verification Specialist
    const verifyRes = await this.router.routeInfer({
      role: ModelRole.VERIFICATION,
      input: {
        nodes: candidateNodes,
        availableCapabilities
      }
    });
    tokensEvaluated += verifyRes.tokens_evaluated || 0;
    const { valid, errors, verifiedNodes } = verifyRes.output;

    if (!valid) {
      throw new Error(`DAG verification failed: ${errors.join('; ')}`);
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const taskPlan = {
      id: taskId,
      goal: rawIntent,
      caller: caller || { componentUrl: 'fuchsia-pkg://pravah.os/intent_engine' },
      contextSource,
      state: TaskState.PLANNED,
      nodes: verifiedNodes,
      metadata: {
        intent,
        confidence,
        summary,
        entities: mergedEntities,
        tokensEvaluated,
        createdAt: Date.now()
      }
    };

    return taskPlan;
  }

  /**
   * Plan natural language intent and immediately execute through TaskEngine,
   * then log the outcome to episodic memory.
   */
  async planAndExecute(rawIntent, { caller, contextSource = 'user_spoken_intent', onApprovalNeeded } = {}) {
    if (!this.taskEngine) {
      throw new Error('TaskEngine instance must be supplied to execute plans');
    }

    // Plan DAG
    const plan = await this.planIntent(rawIntent, { caller, contextSource });

    // Submit to TaskEngine
    const task = this.taskEngine.createTask({
      id: plan.id,
      goal: plan.goal,
      caller: plan.caller,
      contextSource: plan.contextSource,
      nodes: plan.nodes
    });

    // Execute
    const executionResult = await this.taskEngine.executeTask(task.id, onApprovalNeeded);

    // Record episodic memory of execution if memory engine is available
    if (this.memory) {
      const nodesList = Array.from(executionResult.nodes.values());
      this.memory.recordEpisode({
        taskId: executionResult.id,
        goal: executionResult.goal,
        intent: plan.metadata?.intent,
        outcome: executionResult.state,
        nodes: nodesList,
        tags: [plan.metadata?.intent, executionResult.state]
      });
    }

    return {
      plan,
      execution: executionResult
    };
  }
}
