// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

export const ComponentType = Object.freeze({
  ROOT_CONTAINER: 'ROOT_CONTAINER',
  SURFACE: 'SURFACE',
  WORKSPACE: 'WORKSPACE',
  DAG_VIEW: 'DAG_VIEW',
  DAG_NODE: 'DAG_NODE',
  DAG_EDGE: 'DAG_EDGE',
  APPROVAL_MODAL: 'APPROVAL_MODAL',
  AUDIT_VIEWER: 'AUDIT_VIEWER',
  INTENT_BAR: 'INTENT_BAR',
  AMBIENT_HEADER: 'AMBIENT_HEADER',
  METRIC_BADGE: 'METRIC_BADGE',
  CAPABILITY_CARD: 'CAPABILITY_CARD',
  BUTTON: 'BUTTON',
  TEXT_BLOCK: 'TEXT_BLOCK',
  INPUT_FIELD: 'INPUT_FIELD',
  PROGRESS_BAR: 'PROGRESS_BAR',
  DIFF_VIEWER: 'DIFF_VIEWER',
  ALERT_BANNER: 'ALERT_BANNER'
});

export const VisualVariant = Object.freeze({
  DEFAULT: 'default',
  PRIMARY: 'primary',
  ACCENT: 'accent',
  SUCCESS: 'success',
  WARNING: 'warning',
  DANGER: 'danger',
  MUTED: 'muted',
  NEUTRAL: 'neutral'
});

export const SurfaceRole = Object.freeze({
  AMBIENT: 'ambient',
  INTENT: 'intent',
  WORKSPACE: 'workspace',
  APPROVAL_MODAL: 'approval_modal',
  AUDIT_INSPECTOR: 'audit_inspector',
  SYSTEM_TOAST: 'system_toast'
});

export const NodeVisualStatus = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  BLOCKED_BY_POLICY: 'BLOCKED_BY_POLICY',
  SKIPPED: 'SKIPPED',
  REJECTED_BY_USER: 'REJECTED_BY_USER'
});

/**
 * Core declarative UI Element in the PravahOS scene tree.
 */
export class UIElement {
  constructor({
    id,
    type,
    role = SurfaceRole.WORKSPACE,
    variant = VisualVariant.DEFAULT,
    title = '',
    subtitle = '',
    value = null,
    status = null,
    properties = {},
    actions = [],
    children = []
  }) {
    if (!id || typeof id !== 'string') throw new Error('UIElement requires a string "id"');
    if (!type || !ComponentType[type]) throw new Error(`Invalid ComponentType: ${type}`);

    this.id = id;
    this.type = type;
    this.role = role;
    this.variant = variant;
    this.title = title;
    this.subtitle = subtitle;
    this.value = value;
    this.status = status;
    this.properties = { ...properties };
    this.actions = Array.isArray(actions) ? [...actions] : [];
    this.children = Array.isArray(children) ? [...children] : [];
  }

  addChild(element) {
    if (!(element instanceof UIElement)) {
      throw new Error('Child must be an instance of UIElement');
    }
    this.children.push(element);
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      role: this.role,
      variant: this.variant,
      title: this.title,
      subtitle: this.subtitle,
      value: this.value,
      status: this.status,
      properties: this.properties,
      actions: this.actions,
      children: this.children.map(c => c.toJSON())
    };
  }
}

/**
 * View Composition containing a root element tree and surface metadata.
 */
export class ViewComposition {
  constructor({
    surfaceId,
    role,
    root,
    associatedTaskId = null,
    requiresUserFocus = false,
    timestamp = Date.now(),
    metadata = {}
  }) {
    if (!surfaceId) throw new Error('ViewComposition requires "surfaceId"');
    if (!role) throw new Error('ViewComposition requires "role"');
    if (!root || !(root instanceof UIElement)) throw new Error('ViewComposition requires valid UIElement "root"');

    this.surfaceId = surfaceId;
    this.role = role;
    this.root = root;
    this.associatedTaskId = associatedTaskId;
    this.requiresUserFocus = requiresUserFocus;
    this.timestamp = timestamp;
    this.metadata = metadata;
  }

  toJSON() {
    return {
      surfaceId: this.surfaceId,
      role: this.role,
      timestamp: this.timestamp,
      associatedTaskId: this.associatedTaskId,
      requiresUserFocus: this.requiresUserFocus,
      metadata: this.metadata,
      root: this.root.toJSON()
    };
  }
}

/**
 * Component Builders for rapid declarative composition.
 */
export const UIBuilders = {
  createAmbientHeader({
    id = 'ambient-header',
    offline = true,
    authority = 'EXECUTE',
    npuLoad = 0,
    gpuLoad = 0,
    cpuLoad = 12,
    tempC = 38,
    memoryMb = { used: 412, total: 2048 }
  }) {
    const root = new UIElement({
      id,
      type: ComponentType.AMBIENT_HEADER,
      role: SurfaceRole.AMBIENT,
      variant: VisualVariant.NEUTRAL,
      title: 'PravahOS Ambient System Status',
      properties: { offline, authority }
    });

    root.addChild(new UIElement({
      id: `${id}-offline`,
      type: ComponentType.METRIC_BADGE,
      role: SurfaceRole.AMBIENT,
      variant: offline ? VisualVariant.SUCCESS : VisualVariant.WARNING,
      title: offline ? 'OFFLINE SECURED' : 'CONNECTED',
      value: offline ? 'Air-Gapped / Zero Cloud Leakage' : 'Network Active'
    }));

    root.addChild(new UIElement({
      id: `${id}-authority`,
      type: ComponentType.METRIC_BADGE,
      role: SurfaceRole.AMBIENT,
      variant: authority === 'MANAGE' ? VisualVariant.ACCENT : VisualVariant.PRIMARY,
      title: 'AUTHORITY BOUND',
      value: authority
    }));

    root.addChild(new UIElement({
      id: `${id}-hw-npu`,
      type: ComponentType.METRIC_BADGE,
      role: SurfaceRole.AMBIENT,
      variant: npuLoad > 80 ? VisualVariant.WARNING : VisualVariant.SUCCESS,
      title: 'NPU LOAD',
      value: `${npuLoad}%`
    }));

    root.addChild(new UIElement({
      id: `${id}-hw-cpu`,
      type: ComponentType.METRIC_BADGE,
      role: SurfaceRole.AMBIENT,
      variant: cpuLoad > 85 ? VisualVariant.WARNING : VisualVariant.NEUTRAL,
      title: 'CPU / TEMP',
      value: `${cpuLoad}% • ${tempC}°C`
    }));

    root.addChild(new UIElement({
      id: `${id}-hw-mem`,
      type: ComponentType.METRIC_BADGE,
      role: SurfaceRole.AMBIENT,
      variant: VisualVariant.NEUTRAL,
      title: 'SECURE MEMORY',
      value: `${memoryMb.used} MB / ${memoryMb.total} MB`
    }));

    return root;
  },

  createIntentBar({
    id = 'intent-bar',
    placeholder = 'Describe your goal (e.g., "Check flight AI-202 and set reminder")...',
    suggestions = [
      'Check flight AI-202 and set reminder 2 hours before departure',
      'Send ₹5,000 to Alice from verified account',
      'Optimize secure memory and flush cache',
      'Extract receipt text and file expense'
    ]
  }) {
    return new UIElement({
      id,
      type: ComponentType.INTENT_BAR,
      role: SurfaceRole.INTENT,
      variant: VisualVariant.PRIMARY,
      title: 'Unified Intent Bar',
      properties: { placeholder, suggestions },
      children: [
        new UIElement({
          id: `${id}-input`,
          type: ComponentType.INPUT_FIELD,
          role: SurfaceRole.INTENT,
          variant: VisualVariant.DEFAULT,
          title: 'Natural Language Intent Input',
          properties: { placeholder }
        }),
        new UIElement({
          id: `${id}-mic-btn`,
          type: ComponentType.BUTTON,
          role: SurfaceRole.INTENT,
          variant: VisualVariant.ACCENT,
          title: 'Voice Input',
          value: 'mic',
          actions: [{ action: 'START_VOICE_CAPTURE' }]
        }),
        new UIElement({
          id: `${id}-submit-btn`,
          type: ComponentType.BUTTON,
          role: SurfaceRole.INTENT,
          variant: VisualVariant.PRIMARY,
          title: 'Execute Intent',
          value: 'submit',
          actions: [{ action: 'SUBMIT_INTENT' }]
        })
      ]
    });
  },

  createDagNodeElement({
    nodeId,
    capabilityId,
    status,
    riskLevel = 0,
    dependencies = [],
    output = null,
    error = null,
    inputs = {}
  }) {
    let variant = VisualVariant.DEFAULT;
    if (status === NodeVisualStatus.COMPLETED) variant = VisualVariant.SUCCESS;
    else if (status === NodeVisualStatus.RUNNING) variant = VisualVariant.ACCENT;
    else if (status === NodeVisualStatus.WAITING_FOR_APPROVAL) variant = VisualVariant.WARNING;
    else if (status === NodeVisualStatus.FAILED || status === NodeVisualStatus.BLOCKED_BY_POLICY) variant = VisualVariant.DANGER;

    const riskLabels = ['READ_ONLY', 'REVERSIBLE', 'CONSEQUENTIAL', 'IRREVERSIBLE'];
    const riskLabel = riskLabels[riskLevel] || `RISK_${riskLevel}`;

    const node = new UIElement({
      id: `dag-node-${nodeId}`,
      type: ComponentType.DAG_NODE,
      role: SurfaceRole.WORKSPACE,
      variant,
      title: capabilityId,
      subtitle: `Node: ${nodeId}`,
      status,
      properties: {
        nodeId,
        capabilityId,
        riskLevel,
        riskLabel,
        dependencies,
        inputs
      }
    });

    if (output) {
      node.addChild(new UIElement({
        id: `node-output-${nodeId}`,
        type: ComponentType.CAPABILITY_CARD,
        role: SurfaceRole.WORKSPACE,
        variant: VisualVariant.SUCCESS,
        title: 'Capability Output',
        value: output
      }));
    }

    if (error) {
      node.addChild(new UIElement({
        id: `node-error-${nodeId}`,
        type: ComponentType.ALERT_BANNER,
        role: SurfaceRole.WORKSPACE,
        variant: VisualVariant.DANGER,
        title: 'Execution Policy Error',
        value: error
      }));
    }

    return node;
  },

  createApprovalModal({
    id = 'policy-gate-modal',
    taskId,
    nodeId,
    capabilityId,
    riskLevel,
    riskLabel = 'IRREVERSIBLE',
    reason = 'FINANCIAL_LIMIT_EXCEEDED',
    caller = 'fuchsia-pkg://pravah.os/task_engine',
    contextSource = 'user_spoken',
    auditToken = 0,
    impactSummary = 'This action will perform irreversible operations.'
  }) {
    const modal = new UIElement({
      id,
      type: ComponentType.APPROVAL_MODAL,
      role: SurfaceRole.APPROVAL_MODAL,
      variant: VisualVariant.DANGER,
      title: 'Policy Gate: Authorization Required',
      subtitle: `Action: ${capabilityId} (${riskLabel})`,
      properties: {
        taskId,
        nodeId,
        capabilityId,
        riskLevel,
        riskLabel,
        reason,
        caller,
        contextSource,
        auditToken
      }
    });

    modal.addChild(new UIElement({
      id: `${id}-warning`,
      type: ComponentType.ALERT_BANNER,
      role: SurfaceRole.APPROVAL_MODAL,
      variant: VisualVariant.DANGER,
      title: 'Irreversible Mutation Warning',
      value: impactSummary
    }));

    modal.addChild(new UIElement({
      id: `${id}-diff`,
      type: ComponentType.DIFF_VIEWER,
      role: SurfaceRole.APPROVAL_MODAL,
      variant: VisualVariant.WARNING,
      title: 'Gate Precondition & Parameter Diff',
      value: {
        caller,
        contextSource,
        reason,
        auditToken: `0x${Number(auditToken || 0).toString(16).toUpperCase()}`
      }
    }));

    const btnRow = new UIElement({
      id: `${id}-actions`,
      type: ComponentType.ROOT_CONTAINER,
      role: SurfaceRole.APPROVAL_MODAL,
      variant: VisualVariant.NEUTRAL
    });

    btnRow.addChild(new UIElement({
      id: `${id}-deny`,
      type: ComponentType.BUTTON,
      role: SurfaceRole.APPROVAL_MODAL,
      variant: VisualVariant.DANGER,
      title: 'Deny Action',
      value: 'deny',
      actions: [{ action: 'DENY_POLICY_GATE', targetId: nodeId, payload: { taskId, nodeId } }]
    }));

    btnRow.addChild(new UIElement({
      id: `${id}-approve`,
      type: ComponentType.BUTTON,
      role: SurfaceRole.APPROVAL_MODAL,
      variant: VisualVariant.SUCCESS,
      title: 'Approve & Execute',
      value: 'approve',
      actions: [{ action: 'APPROVE_POLICY_GATE', targetId: nodeId, payload: { taskId, nodeId } }]
    }));

    modal.addChild(btnRow);
    return modal;
  },

  createAuditViewer({
    id = 'audit-viewer',
    records = [],
    tamperStatus = 'VERIFIED_INTACT'
  }) {
    return new UIElement({
      id,
      type: ComponentType.AUDIT_VIEWER,
      role: SurfaceRole.AUDIT_INSPECTOR,
      variant: tamperStatus === 'VERIFIED_INTACT' ? VisualVariant.SUCCESS : VisualVariant.DANGER,
      title: 'Tamper-Evident Policy Audit Trail',
      subtitle: `Cryptographic Ledger • Status: ${tamperStatus}`,
      value: records,
      properties: { tamperStatus, totalRecords: records.length }
    });
  }
};

/**
 * Validates a UIElement against schema rules.
 */
export function validateUIElement(elem) {
  if (!elem || typeof elem !== 'object') {
    return { valid: false, errors: ['UIElement must be a non-null object'] };
  }
  const errors = [];
  if (!elem.id || typeof elem.id !== 'string') errors.push('Missing or invalid "id"');
  if (!elem.type || !ComponentType[elem.type]) errors.push(`Invalid type: ${elem.type}`);
  if (elem.role && !Object.values(SurfaceRole).includes(elem.role)) errors.push(`Invalid role: ${elem.role}`);
  if (elem.variant && !Object.values(VisualVariant).includes(elem.variant)) errors.push(`Invalid variant: ${elem.variant}`);
  if (elem.children && Array.isArray(elem.children)) {
    for (let i = 0; i < elem.children.length; i++) {
      const childRes = validateUIElement(elem.children[i]);
      if (!childRes.valid) {
        errors.push(`Child[${i}]: ${childRes.errors.join(', ')}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a ViewComposition.
 */
export function validateComposition(comp) {
  if (!comp || typeof comp !== 'object') {
    return { valid: false, errors: ['ViewComposition must be a non-null object'] };
  }
  const errors = [];
  if (!comp.surfaceId) errors.push('Missing surfaceId');
  if (!comp.role || !Object.values(SurfaceRole).includes(comp.role)) errors.push(`Invalid role: ${comp.role}`);
  if (!comp.root) errors.push('Missing root element');
  else {
    const rootRes = validateUIElement(comp.root);
    if (!rootRes.valid) errors.push(...rootRes.errors);
  }
  return { valid: errors.length === 0, errors };
}
