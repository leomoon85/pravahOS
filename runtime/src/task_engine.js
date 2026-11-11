// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { TaskState, PolicyDecision } from './types.js';

export class TaskEngine {
  constructor({ registry, policyGate }) {
    this.registry = registry;
    this.policyGate = policyGate;
    this.tasks = new Map();
  }

  createTask({ id, goal, nodes, caller, contextSource }) {
    const task = {
      id: id || `task_${Date.now()}`,
      goal,
      caller,
      contextSource,
      state: TaskState.CREATED,
      nodes: new Map(nodes.map(n => [n.nodeId, { ...n, status: 'PENDING', output: null }])),
      history: []
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async executeTask(taskId, onApprovalNeeded) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.state = TaskState.EXECUTING;

    // Topological DAG resolution
    let hasProgress = true;
    while (hasProgress) {
      hasProgress = false;
      const pendingNodes = Array.from(task.nodes.values()).filter(n => n.status === 'PENDING');

      if (pendingNodes.length === 0) break;

      for (const node of pendingNodes) {
        // Check if all dependency nodes are COMPLETED
        const depsReady = (node.dependencies || []).every(depId => {
          const depNode = task.nodes.get(depId);
          return depNode && depNode.status === 'COMPLETED';
        });

        if (!depsReady) continue;

        // Fetch capability
        const cap = this.registry.get(node.capabilityId);
        if (!cap) {
          node.status = 'FAILED';
          node.error = `Capability ${node.capabilityId} not registered`;
          task.state = TaskState.FAILED;
          return task;
        }

        // Deterministic Policy Gate check
        const policyResult = this.policyGate.evaluate({
          caller: task.caller,
          capabilityDescriptor: cap.descriptor,
          contextSource: task.contextSource
        });

        if (policyResult.decision === PolicyDecision.DENY) {
          node.status = 'BLOCKED_BY_POLICY';
          node.error = policyResult.reason;
          task.state = TaskState.FAILED;
          return task;
        }

        if (policyResult.decision === PolicyDecision.REQUIRE_USER_APPROVAL) {
          node.status = 'WAITING_FOR_APPROVAL';
          task.state = TaskState.WAITING_FOR_APPROVAL;
          if (onApprovalNeeded) {
            const approved = await onApprovalNeeded(task, node, policyResult);
            if (!approved) {
              node.status = 'REJECTED_BY_USER';
              task.state = TaskState.CANCELLED;
              return task;
            }
          } else {
            // No handler provided: task pauses at WAITING_FOR_APPROVAL
            return task;
          }
        }

        // Execute capability
        try {
          node.status = 'RUNNING';
          // Gather inputs from dependent nodes if requested
          const dependencyOutputs = {};
          for (const depId of (node.dependencies || [])) {
            const depNode = task.nodes.get(depId);
            if (depNode?.output) {
              dependencyOutputs[depId] = depNode.output;
            }
          }
          const inputs = { ...node.inputs, dependencyOutputs, caller: task.caller, contextSource: task.contextSource };
          const output = await cap.implementation.execute(inputs);
          node.output = output;
          node.status = 'COMPLETED';
          hasProgress = true;
        } catch (err) {
          node.status = 'FAILED';
          node.error = err.message;
          task.state = TaskState.FAILED;
          return task;
        }
      }
    }

    const allCompleted = Array.from(task.nodes.values()).every(n => n.status === 'COMPLETED');
    task.state = allCompleted ? TaskState.COMPLETED : TaskState.FAILED;
    return task;
  }
}
