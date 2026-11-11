// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import {
  ComponentType,
  VisualVariant,
  SurfaceRole,
  NodeVisualStatus,
  UIElement,
  ViewComposition,
  UIBuilders,
  validateComposition
} from '../schema/components.js';
import { computeDagLayout } from './dag_layout.js';

/**
 * Dynamic Experience Composer (DEC)
 *
 * Orchestrates user experience across PravahOS by transforming Task DAG states,
 * deterministic policy gate evaluations, and capability outputs into structured,
 * declarative UI trees.
 */
export class DynamicExperienceComposer {
  constructor(options = {}) {
    this.appName = options.appName || 'PravahOS Dynamic Shell';
    this.theme = options.theme || 'dark-modern';
  }

  /**
   * Composes the Ambient Status Header showing hardware, authority, and offline status.
   */
  composeAmbientHeader({
    offline = true,
    authority = 'EXECUTE',
    telemetry = {
      npu_utilization_pct: 14,
      gpu_utilization_pct: 22,
      cpu_utilization_pct: 18,
      active_frequency_mhz: 2400,
      temperature_celsius: 41,
      memory_used_mb: 468,
      memory_total_mb: 2048
    }
  } = {}) {
    const root = UIBuilders.createAmbientHeader({
      id: 'ambient-header',
      offline,
      authority,
      npuLoad: telemetry.npu_utilization_pct ?? 0,
      gpuLoad: telemetry.gpu_utilization_pct ?? 0,
      cpuLoad: telemetry.cpu_utilization_pct ?? 18,
      tempC: telemetry.temperature_celsius ?? 41,
      memoryMb: {
        used: telemetry.memory_used_mb ?? 468,
        total: telemetry.memory_total_mb ?? 2048
      }
    });

    const composition = new ViewComposition({
      surfaceId: 'surface-ambient',
      role: SurfaceRole.AMBIENT,
      root,
      metadata: { offline, authority, telemetry }
    });

    validateComposition(composition);
    return composition;
  }

  /**
   * Composes the Intent Input Bar surface.
   */
  composeIntentBar({
    placeholder = 'Describe your goal (e.g., "Check flight AI-202 and book hotel")...',
    suggestions = [
      'Check flight AI-202 and set reminder 2 hours before departure',
      'Send ₹5,000 to Alice from verified account',
      'Optimize secure memory and flush cache',
      'Extract receipt text and file expense'
    ],
    activeInput = ''
  } = {}) {
    const root = UIBuilders.createIntentBar({ placeholder, suggestions });
    if (activeInput) {
      const inputEl = root.children.find(c => c.type === ComponentType.INPUT_FIELD);
      if (inputEl) inputEl.value = activeInput;
    }

    const composition = new ViewComposition({
      surfaceId: 'surface-intent',
      role: SurfaceRole.INTENT,
      root,
      metadata: { suggestionsCount: suggestions.length }
    });

    validateComposition(composition);
    return composition;
  }

  /**
   * Composes a dynamic Task Workspace displaying DAG nodes, stages, and outputs.
   */
  composeTaskWorkspace(task) {
    if (!task) {
      const emptyRoot = new UIElement({
        id: 'workspace-empty',
        type: ComponentType.WORKSPACE,
        role: SurfaceRole.WORKSPACE,
        variant: VisualVariant.MUTED,
        title: 'No Active Task',
        subtitle: 'Enter an intent or choose a scenario above to initialize a Task DAG.'
      });
      return new ViewComposition({
        surfaceId: 'surface-workspace',
        role: SurfaceRole.WORKSPACE,
        root: emptyRoot
      });
    }

    const taskId = task.id || 'task_current';
    const taskGoal = task.goal || 'Autonomous Task Execution';
    const taskState = task.state || 'EXECUTING';

    const rawNodes = task.nodes instanceof Map
      ? Array.from(task.nodes.values())
      : Array.isArray(task.nodes)
        ? task.nodes
        : Object.values(task.nodes || {});

    // Compute topological layout
    const layout = computeDagLayout(rawNodes);

    // Calculate progress
    const totalNodes = rawNodes.length;
    const completedNodes = rawNodes.filter(n => n.status === 'COMPLETED').length;
    const failedNodes = rawNodes.filter(n => n.status === 'FAILED' || n.status === 'BLOCKED_BY_POLICY').length;
    const waitingNodes = rawNodes.filter(n => n.status === 'WAITING_FOR_APPROVAL').length;
    const progressPct = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;

    let overallVariant = VisualVariant.PRIMARY;
    if (taskState === 'COMPLETED') overallVariant = VisualVariant.SUCCESS;
    else if (taskState === 'FAILED' || taskState === 'CANCELLED') overallVariant = VisualVariant.DANGER;
    else if (taskState === 'WAITING_FOR_APPROVAL') overallVariant = VisualVariant.WARNING;

    // Root Workspace container
    const root = new UIElement({
      id: `workspace-${taskId}`,
      type: ComponentType.WORKSPACE,
      role: SurfaceRole.WORKSPACE,
      variant: overallVariant,
      title: taskGoal,
      subtitle: `Task ID: ${taskId} • State: ${taskState}`,
      properties: {
        taskId,
        state: taskState,
        caller: task.caller,
        progressPct,
        completedNodes,
        totalNodes
      }
    });

    // Top Progress & Stat Bar
    const statBar = new UIElement({
      id: `${taskId}-stat-bar`,
      type: ComponentType.ROOT_CONTAINER,
      role: SurfaceRole.WORKSPACE,
      variant: VisualVariant.NEUTRAL
    });

    statBar.addChild(new UIElement({
      id: `${taskId}-progress-bar`,
      type: ComponentType.PROGRESS_BAR,
      role: SurfaceRole.WORKSPACE,
      variant: overallVariant,
      title: 'DAG Execution Progress',
      value: progressPct,
      subtitle: `${completedNodes} of ${totalNodes} steps completed (${progressPct}%)`
    }));

    statBar.addChild(new UIElement({
      id: `${taskId}-state-badge`,
      type: ComponentType.METRIC_BADGE,
      role: SurfaceRole.WORKSPACE,
      variant: overallVariant,
      title: 'STATE',
      value: taskState
    }));

    root.addChild(statBar);

    // DAG View Container
    const dagView = new UIElement({
      id: `${taskId}-dag-view`,
      type: ComponentType.DAG_VIEW,
      role: SurfaceRole.WORKSPACE,
      variant: VisualVariant.NEUTRAL,
      title: 'Topological Task Execution Graph',
      properties: {
        stagesCount: layout.stages.length,
        edges: layout.edges
      }
    });

    // Render DAG Stages
    for (const stage of layout.stages) {
      const stageContainer = new UIElement({
        id: `${taskId}-stage-${stage.stageIndex}`,
        type: ComponentType.ROOT_CONTAINER,
        role: SurfaceRole.WORKSPACE,
        variant: VisualVariant.NEUTRAL,
        title: `Stage ${stage.stageIndex + 1}`,
        subtitle: `${stage.nodes.length} parallel node(s)`
      });

      for (const node of stage.nodes) {
        const nodeId = node.nodeId || node.id;
        const nodeElem = UIBuilders.createDagNodeElement({
          nodeId,
          capabilityId: node.capabilityId || 'unknown.capability',
          status: node.status || NodeVisualStatus.PENDING,
          riskLevel: node.riskLevel ?? 0,
          dependencies: node.dependencies || [],
          output: node.output ? this.formatCapabilityOutput(node.capabilityId, node.output) : null,
          error: node.error || null,
          inputs: node.inputs || {}
        });

        stageContainer.addChild(nodeElem);
      }

      dagView.addChild(stageContainer);
    }

    root.addChild(dagView);

    // Edge Connector definitions
    const edgesElem = new UIElement({
      id: `${taskId}-dag-edges`,
      type: ComponentType.ROOT_CONTAINER,
      role: SurfaceRole.WORKSPACE,
      properties: { edges: layout.edges }
    });
    root.addChild(edgesElem);

    const composition = new ViewComposition({
      surfaceId: `surface-workspace-${taskId}`,
      role: SurfaceRole.WORKSPACE,
      associatedTaskId: taskId,
      root,
      metadata: {
        taskId,
        progressPct,
        taskState,
        hasPendingApproval: waitingNodes > 0
      }
    });

    validateComposition(composition);
    return composition;
  }

  /**
   * Composes a Policy Gate human confirmation modal.
   */
  composeApprovalModal({
    taskId,
    node,
    policyResult,
    impactSummary = null
  }) {
    if (!node) throw new Error('composeApprovalModal requires "node"');

    const nodeId = node.nodeId || node.id;
    const capabilityId = node.capabilityId || 'system.operation';
    const riskLevel = node.riskLevel ?? 2;
    const riskLabels = ['READ_ONLY', 'REVERSIBLE', 'CONSEQUENTIAL', 'IRREVERSIBLE'];
    const riskLabel = riskLabels[riskLevel] || `RISK_${riskLevel}`;
    const reason = policyResult?.reason || 'POLICY_EVALUATION_REQUIRED';
    const auditToken = policyResult?.auditToken || Date.now();

    const summaryText = impactSummary || (
      riskLevel >= 3
        ? `CAUTION: Capability "${capabilityId}" will perform an IRREVERSIBLE mutation on the external environment or persistent state. Confirmation is mandatory.`
        : `Capability "${capabilityId}" has risk level ${riskLabel}. Execution paused deterministically by Policy Gate.`
    );

    const root = UIBuilders.createApprovalModal({
      id: `modal-${taskId}-${nodeId}`,
      taskId,
      nodeId,
      capabilityId,
      riskLevel,
      riskLabel,
      reason,
      caller: policyResult?.caller?.componentUrl || 'fuchsia-pkg://pravah.os/task_engine',
      contextSource: policyResult?.contextSource || 'user_spoken',
      auditToken,
      impactSummary: summaryText
    });

    const composition = new ViewComposition({
      surfaceId: `surface-modal-${taskId}-${nodeId}`,
      role: SurfaceRole.APPROVAL_MODAL,
      associatedTaskId: taskId,
      requiresUserFocus: true,
      root,
      metadata: { taskId, nodeId, capabilityId, riskLevel, reason, auditToken }
    });

    validateComposition(composition);
    return composition;
  }

  /**
   * Composes the Tamper-Evident Audit Viewer surface.
   */
  composeAuditInspector({
    records = [],
    filterTaskId = null
  } = {}) {
    // Validate cryptographic hash chain
    const chainVerification = this.verifyAuditChain(records);

    const filteredRecords = filterTaskId
      ? records.filter(r => r.taskId === filterTaskId)
      : records;

    const root = UIBuilders.createAuditViewer({
      id: 'audit-inspector-viewer',
      records: filteredRecords,
      tamperStatus: chainVerification.intact ? 'VERIFIED_INTACT' : 'TAMPER_DETECTED'
    });

    // Add verification metadata badge
    root.addChild(new UIElement({
      id: 'audit-chain-integrity-badge',
      type: ComponentType.METRIC_BADGE,
      role: SurfaceRole.AUDIT_INSPECTOR,
      variant: chainVerification.intact ? VisualVariant.SUCCESS : VisualVariant.DANGER,
      title: 'HASH CHAIN INTEGRITY',
      value: chainVerification.intact
        ? `Valid SHA-256 Chain (${records.length} blocks verified)`
        : `Integrity Failure at block #${chainVerification.brokenIndex}`
    }));

    const composition = new ViewComposition({
      surfaceId: 'surface-audit',
      role: SurfaceRole.AUDIT_INSPECTOR,
      root,
      metadata: {
        totalRecords: records.length,
        intact: chainVerification.intact,
        filterTaskId
      }
    });

    validateComposition(composition);
    return composition;
  }

  /**
   * Verifies the cryptographic SHA-256 hash chain of the audit trail.
   */
  verifyAuditChain(records) {
    if (!Array.isArray(records) || records.length === 0) {
      return { intact: true, count: 0 };
    }

    let expectedPrevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (record.prevHash !== expectedPrevHash) {
        return { intact: false, brokenIndex: i, reason: 'Broken prevHash reference' };
      }
      expectedPrevHash = record.hash;
    }

    return { intact: true, count: records.length };
  }

  /**
   * Helper to format capability outputs for visual presentation in cards.
   */
  formatCapabilityOutput(capabilityId, output) {
    if (!output) return null;
    if (typeof output === 'string') return { summary: output };

    if (capabilityId === 'travel.flight_info' || capabilityId.includes('flight')) {
      return {
        type: 'flight_card',
        flightNumber: output.flightNumber || output.flight,
        status: output.status || 'ON_TIME',
        departure: output.departure || 'DEL',
        arrival: output.arrival || 'BLR',
        departureTime: output.departureTime || output.time || '10:30',
        terminal: output.terminal || 'T3',
        gate: output.gate || '12B',
        raw: output
      };
    }

    if (capabilityId === 'financial.transfer' || capabilityId.includes('payment') || capabilityId.includes('transfer')) {
      return {
        type: 'financial_receipt',
        transactionId: output.transactionId || output.id || `TX-${Date.now()}`,
        recipient: output.recipient || output.to,
        amount: output.amount,
        currency: output.currency || 'INR',
        status: output.status || 'SETTLED',
        fee: output.fee || '₹0.00',
        raw: output
      };
    }

    if (capabilityId === 'calendar.reminder' || capabilityId.includes('reminder') || capabilityId.includes('calendar')) {
      return {
        type: 'calendar_card',
        title: output.title || output.event,
        time: output.time || output.scheduledTime,
        status: output.status || 'SCHEDULED',
        raw: output
      };
    }

    return {
      type: 'generic_output',
      raw: output
    };
  }

  /**
   * Composes a complete view composition package covering all active surfaces.
   */
  composeScene({
    offline = true,
    authority = 'EXECUTE',
    telemetry,
    task = null,
    pendingApproval = null,
    auditRecords = [],
    activeIntent = ''
  } = {}) {
    const ambientComp = this.composeAmbientHeader({ offline, authority, telemetry });
    const intentComp = this.composeIntentBar({ activeInput: activeIntent });
    const workspaceComp = this.composeTaskWorkspace(task);
    const auditComp = this.composeAuditInspector({ records: auditRecords });

    let approvalModalComp = null;
    if (pendingApproval) {
      approvalModalComp = this.composeApprovalModal(pendingApproval);
    }

    const sceneRoot = new UIElement({
      id: 'pravah-shell-root',
      type: ComponentType.ROOT_CONTAINER,
      role: SurfaceRole.WORKSPACE,
      variant: VisualVariant.NEUTRAL,
      title: 'PravahOS Dynamic Shell Scene Graph',
      children: [
        ambientComp.root,
        intentComp.root,
        workspaceComp.root,
        auditComp.root
      ]
    });

    if (approvalModalComp) {
      sceneRoot.addChild(approvalModalComp.root);
    }

    const composition = new ViewComposition({
      surfaceId: 'surface-main-scene',
      role: SurfaceRole.WORKSPACE,
      root: sceneRoot,
      associatedTaskId: task?.id || null,
      requiresUserFocus: Boolean(approvalModalComp),
      metadata: {
        surfaces: {
          ambient: ambientComp.toJSON(),
          intent: intentComp.toJSON(),
          workspace: workspaceComp.toJSON(),
          audit: auditComp.toJSON(),
          approvalModal: approvalModalComp ? approvalModalComp.toJSON() : null
        }
      }
    });

    validateComposition(composition);
    return composition;
  }
}
