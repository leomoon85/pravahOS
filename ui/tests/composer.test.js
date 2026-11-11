// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  ComponentType,
  VisualVariant,
  SurfaceRole,
  NodeVisualStatus,
  UIElement,
  ViewComposition,
  UIBuilders,
  validateUIElement,
  validateComposition
} from '../schema/components.js';

import { DynamicExperienceComposer } from '../composer/composer.js';
import { computeDagLayout } from '../composer/dag_layout.js';

test('UI Schema: UIElement creation and tree serialization', () => {
  const root = new UIElement({
    id: 'test-root',
    type: ComponentType.ROOT_CONTAINER,
    role: SurfaceRole.WORKSPACE,
    variant: VisualVariant.PRIMARY,
    title: 'Test Root'
  });

  const child = new UIElement({
    id: 'test-child',
    type: ComponentType.BUTTON,
    role: SurfaceRole.WORKSPACE,
    variant: VisualVariant.ACCENT,
    title: 'Click Me',
    actions: [{ action: 'SUBMIT_FORM' }]
  });

  root.addChild(child);

  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].id, 'test-child');

  const json = root.toJSON();
  assert.equal(json.id, 'test-root');
  assert.equal(json.children[0].title, 'Click Me');
  assert.equal(json.children[0].actions[0].action, 'SUBMIT_FORM');

  const validation = validateUIElement(root);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});

test('UI Schema: ViewComposition validation rejects malformed structures', () => {
  const validElem = new UIElement({
    id: 'valid-root',
    type: ComponentType.WORKSPACE,
    role: SurfaceRole.WORKSPACE
  });

  const validComp = new ViewComposition({
    surfaceId: 'surf-1',
    role: SurfaceRole.WORKSPACE,
    root: validElem
  });

  assert.equal(validateComposition(validComp).valid, true);

  // Missing surfaceId
  assert.throws(() => {
    new ViewComposition({ role: SurfaceRole.WORKSPACE, root: validElem });
  }, /requires "surfaceId"/);

  // Missing root
  assert.throws(() => {
    new ViewComposition({ surfaceId: 'surf-2', role: SurfaceRole.WORKSPACE });
  }, /requires valid UIElement/);
});

test('DAG Layout: correctly arranges linear and diamond graphs into stages', () => {
  // Diamond DAG: A -> B, A -> C, B -> D, C -> D
  const nodes = [
    { nodeId: 'node_A', capabilityId: 'travel.flight_info', dependencies: [] },
    { nodeId: 'node_B', capabilityId: 'calendar.reminder', dependencies: ['node_A'] },
    { nodeId: 'node_C', capabilityId: 'weather.lookup', dependencies: ['node_A'] },
    { nodeId: 'node_D', capabilityId: 'comms.notify', dependencies: ['node_B', 'node_C'] }
  ];

  const layout = computeDagLayout(nodes);

  assert.equal(layout.totalNodes, 4);
  assert.equal(layout.stages.length, 3); // Stage 0 (A), Stage 1 (B, C), Stage 2 (D)
  assert.equal(layout.depths['node_A'], 0);
  assert.equal(layout.depths['node_B'], 1);
  assert.equal(layout.depths['node_C'], 1);
  assert.equal(layout.depths['node_D'], 2);

  assert.equal(layout.edges.length, 4);
  assert.deepEqual(layout.edges, [
    { from: 'node_A', to: 'node_B' },
    { from: 'node_A', to: 'node_C' },
    { from: 'node_B', to: 'node_D' },
    { from: 'node_C', to: 'node_D' }
  ]);
});

test('DEC: composeAmbientHeader generates accurate telemetry and offline status', () => {
  const dec = new DynamicExperienceComposer();
  const comp = dec.composeAmbientHeader({
    offline: true,
    authority: 'MANAGE',
    telemetry: {
      npu_utilization_pct: 65,
      gpu_utilization_pct: 30,
      cpu_utilization_pct: 22,
      active_frequency_mhz: 2800,
      temperature_celsius: 44,
      memory_used_mb: 512,
      memory_total_mb: 4096
    }
  });

  assert.equal(comp.role, SurfaceRole.AMBIENT);
  assert.equal(comp.root.type, ComponentType.AMBIENT_HEADER);

  const badges = comp.root.children;
  assert.ok(badges.length >= 4);

  const offlineBadge = badges.find(b => b.id.includes('offline'));
  assert.ok(offlineBadge);
  assert.equal(offlineBadge.title, 'OFFLINE SECURED');
  assert.equal(offlineBadge.variant, VisualVariant.SUCCESS);

  const authBadge = badges.find(b => b.id.includes('authority'));
  assert.ok(authBadge);
  assert.equal(authBadge.value, 'MANAGE');

  const npuBadge = badges.find(b => b.id.includes('npu'));
  assert.ok(npuBadge);
  assert.equal(npuBadge.value, '65%');
});

test('DEC: composeIntentBar builds interactive intent surface with suggestions', () => {
  const dec = new DynamicExperienceComposer();
  const comp = dec.composeIntentBar({
    activeInput: 'Check flight AI-202'
  });

  assert.equal(comp.role, SurfaceRole.INTENT);
  assert.equal(comp.root.type, ComponentType.INTENT_BAR);

  const inputElem = comp.root.children.find(c => c.type === ComponentType.INPUT_FIELD);
  assert.ok(inputElem);
  assert.equal(inputElem.value, 'Check flight AI-202');

  const submitBtn = comp.root.children.find(c => c.title === 'Execute Intent');
  assert.ok(submitBtn);
  assert.equal(submitBtn.actions[0].action, 'SUBMIT_INTENT');
});

test('DEC: composeTaskWorkspace translates Task DAG states and computes progress', () => {
  const dec = new DynamicExperienceComposer();

  const task = {
    id: 'task_flight_travel',
    goal: 'Check flight and set reminder',
    state: 'EXECUTING',
    nodes: new Map([
      ['node_1', {
        nodeId: 'node_1',
        capabilityId: 'travel.flight_info',
        status: 'COMPLETED',
        riskLevel: 0,
        dependencies: [],
        output: { flight: 'AI-202', status: 'ON_TIME', departure: 'DEL', arrival: 'BLR' }
      }],
      ['node_2', {
        nodeId: 'node_2',
        capabilityId: 'calendar.reminder',
        status: 'RUNNING',
        riskLevel: 1,
        dependencies: ['node_1'],
        inputs: { time: '08:30' }
      }]
    ])
  };

  const comp = dec.composeTaskWorkspace(task);

  assert.equal(comp.role, SurfaceRole.WORKSPACE);
  assert.equal(comp.associatedTaskId, 'task_flight_travel');
  assert.equal(comp.metadata.progressPct, 50); // 1 of 2 completed
  assert.equal(comp.root.properties.state, 'EXECUTING');

  // Verify DAG view child
  const dagView = comp.root.children.find(c => c.type === ComponentType.DAG_VIEW);
  assert.ok(dagView);

  // Check stage nodes
  const stage0 = dagView.children[0];
  const node1 = stage0.children[0];
  assert.equal(node1.properties.capabilityId, 'travel.flight_info');
  assert.equal(node1.status, NodeVisualStatus.COMPLETED);
  assert.equal(node1.variant, VisualVariant.SUCCESS);

  // Output card generated
  const outputCard = node1.children.find(c => c.type === ComponentType.CAPABILITY_CARD);
  assert.ok(outputCard);
  assert.equal(outputCard.value.type, 'flight_card');
  assert.equal(outputCard.value.flightNumber, 'AI-202');
});

test('DEC: composeApprovalModal renders warning, diff, and approve/deny actions', () => {
  const dec = new DynamicExperienceComposer();

  const modalComp = dec.composeApprovalModal({
    taskId: 'task_transfer_99',
    node: {
      nodeId: 'node_transfer',
      capabilityId: 'financial.transfer',
      riskLevel: 3,
      inputs: { amount: 5000, recipient: 'Alice' }
    },
    policyResult: {
      decision: 'REQUIRE_USER_APPROVAL',
      reason: 'FINANCIAL_LIMIT_EXCEEDED',
      auditToken: 0x9A4F2C,
      caller: { componentUrl: 'fuchsia-pkg://pravah.os/wallet' },
      contextSource: 'user_spoken'
    }
  });

  assert.equal(modalComp.role, SurfaceRole.APPROVAL_MODAL);
  assert.equal(modalComp.requiresUserFocus, true);
  assert.equal(modalComp.metadata.riskLevel, 3);
  assert.equal(modalComp.metadata.capabilityId, 'financial.transfer');

  const root = modalComp.root;
  assert.equal(root.variant, VisualVariant.DANGER);

  const warning = root.children.find(c => c.type === ComponentType.ALERT_BANNER);
  assert.ok(warning);
  assert.match(warning.value, /IRREVERSIBLE/);

  const diff = root.children.find(c => c.type === ComponentType.DIFF_VIEWER);
  assert.ok(diff);
  assert.equal(diff.value.reason, 'FINANCIAL_LIMIT_EXCEEDED');
  assert.equal(diff.value.auditToken, '0x9A4F2C');

  const actions = root.children.find(c => c.id.includes('actions'));
  assert.ok(actions);
  const denyBtn = actions.children.find(c => c.value === 'deny');
  const approveBtn = actions.children.find(c => c.value === 'approve');
  assert.ok(denyBtn);
  assert.ok(approveBtn);
  assert.equal(denyBtn.actions[0].action, 'DENY_POLICY_GATE');
  assert.equal(approveBtn.actions[0].action, 'APPROVE_POLICY_GATE');
});

test('DEC: Cryptographic Audit Trail verification and inspection', () => {
  const dec = new DynamicExperienceComposer();

  // Helper to hash an audit block
  const hashBlock = (data) => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

  const block0Data = { seq: 0, caller: 'system', action: 'INIT_SYSTEM', prevHash: '0000000000000000000000000000000000000000000000000000000000000000' };
  const block0Hash = hashBlock(block0Data);

  const block1Data = { seq: 1, caller: 'travel_app', action: 'travel.flight_info', prevHash: block0Hash };
  const block1Hash = hashBlock(block1Data);

  const records = [
    { ...block0Data, hash: block0Hash },
    { ...block1Data, hash: block1Hash }
  ];

  // Intact chain
  const validComp = dec.composeAuditInspector({ records });
  assert.equal(validComp.metadata.intact, true);
  assert.equal(validComp.root.properties.tamperStatus, 'VERIFIED_INTACT');

  // Corrupted chain test
  const corruptedRecords = [
    { ...block0Data, hash: block0Hash },
    { ...block1Data, prevHash: 'tampered_previous_hash_00000', hash: block1Hash }
  ];

  const tamperedComp = dec.composeAuditInspector({ records: corruptedRecords });
  assert.equal(tamperedComp.metadata.intact, false);
  assert.equal(tamperedComp.root.properties.tamperStatus, 'TAMPER_DETECTED');
});

test('DEC: composeScene aggregates all surfaces into unified scene tree', () => {
  const dec = new DynamicExperienceComposer();

  const task = {
    id: 'task_scene_demo',
    goal: 'Optimize secure memory and flush cache',
    state: 'COMPLETED',
    nodes: [
      { nodeId: 'n1', capabilityId: 'memory.compact', status: 'COMPLETED', riskLevel: 1 },
      { nodeId: 'n2', capabilityId: 'cache.flush', status: 'COMPLETED', riskLevel: 1, dependencies: ['n1'] }
    ]
  };

  const scene = dec.composeScene({
    offline: true,
    authority: 'EXECUTE',
    task,
    auditRecords: []
  });

  assert.equal(scene.role, SurfaceRole.WORKSPACE);
  assert.equal(scene.root.type, ComponentType.ROOT_CONTAINER);
  assert.equal(scene.root.children.length, 4); // Ambient, Intent, Workspace, Audit

  // Surface metadata present
  assert.ok(scene.metadata.surfaces.ambient);
  assert.ok(scene.metadata.surfaces.workspace);
  assert.ok(scene.metadata.surfaces.audit);
});
