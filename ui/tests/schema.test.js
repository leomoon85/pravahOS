// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

test('JSON Schema: ui_schema.json is valid JSON and defines required enums', () => {
  const schemaPath = path.resolve('ui/schema/ui_schema.json');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(schemaContent);

  assert.equal(schema.title, 'PravahOS Declarative UI Component Schema');
  assert.ok(schema.definitions.ComponentType.enum.includes('APPROVAL_MODAL'));
  assert.ok(schema.definitions.ComponentType.enum.includes('DAG_NODE'));
  assert.ok(schema.definitions.ComponentType.enum.includes('AUDIT_VIEWER'));
  assert.ok(schema.definitions.SurfaceRole.enum.includes('ambient'));
  assert.ok(schema.definitions.SurfaceRole.enum.includes('workspace'));
});

test('UIBuilders: createDagNodeElement with error banner', () => {
  const node = UIBuilders.createDagNodeElement({
    nodeId: 'node_fail',
    capabilityId: 'network.socket_bind',
    status: NodeVisualStatus.BLOCKED_BY_POLICY,
    riskLevel: 2,
    error: 'Direct raw socket access prohibited by sandboxing policy'
  });

  assert.equal(node.id, 'dag-node-node_fail');
  assert.equal(node.status, NodeVisualStatus.BLOCKED_BY_POLICY);
  assert.equal(node.variant, VisualVariant.DANGER);

  const errorChild = node.children.find(c => c.type === ComponentType.ALERT_BANNER);
  assert.ok(errorChild);
  assert.equal(errorChild.value, 'Direct raw socket access prohibited by sandboxing policy');
});

test('UIBuilders: createApprovalModal structure and action buttons', () => {
  const modal = UIBuilders.createApprovalModal({
    taskId: 'task_demo_1',
    nodeId: 'node_delete',
    capabilityId: 'filesystem.delete_root',
    riskLevel: 3,
    riskLabel: 'IRREVERSIBLE',
    reason: 'PROTECTED_SYSTEM_PATH'
  });

  assert.equal(modal.type, ComponentType.APPROVAL_MODAL);
  assert.equal(modal.role, SurfaceRole.APPROVAL_MODAL);
  assert.equal(modal.variant, VisualVariant.DANGER);

  const actionContainer = modal.children.find(c => c.id.includes('actions'));
  assert.ok(actionContainer);
  assert.equal(actionContainer.children.length, 2);

  const denyBtn = actionContainer.children[0];
  const approveBtn = actionContainer.children[1];
  assert.equal(denyBtn.value, 'deny');
  assert.equal(approveBtn.value, 'approve');
});

test('UI Schema: validation detects illegal child and invalid enum', () => {
  // Invalid component type
  assert.throws(() => {
    new UIElement({ id: 'bad', type: 'NON_EXISTENT_TYPE' });
  }, /Invalid ComponentType/);

  // Missing id
  assert.throws(() => {
    new UIElement({ type: ComponentType.BUTTON });
  }, /requires a string "id"/);

  // Adding non-UIElement child
  const parent = new UIElement({ id: 'p', type: ComponentType.ROOT_CONTAINER });
  assert.throws(() => {
    parent.addChild({ notAnElement: true });
  }, /must be an instance of UIElement/);
});
