// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import { RiskLevel, AuthorityLevel, TaskState, PolicyDecision } from '../src/types.js';
import { CapabilityRegistry } from '../src/registry.js';
import { PolicyGate } from '../src/policy.js';
import { TaskEngine } from '../src/task_engine.js';
import { MemoryEngine, SensitivityLevel } from '../src/memory.js';
import {
  CameraCapability,
  CameraCapabilityDescriptor,
  CameraPixelFormat,
  CameraSensorId
} from '../src/capabilities/camera_capability.js';
import {
  NotesCapability,
  NotesCapabilityDescriptor
} from '../src/capabilities/notes_capability.js';
import {
  WalletCapability,
  WalletCapabilityDescriptor
} from '../src/capabilities/wallet_capability.js';
import {
  ModelRegistry,
  InferenceFabricRouter,
  IntentSpecialist,
  EntitySpecialist,
  PlanningSpecialist,
  VerificationSpecialist
} from '../src/inference.js';
import { IntentPlanner } from '../src/planner.js';
import { CoreCapabilities } from '../src/mock_capabilities.js';

// ============================================================================
// 1. Camera Capability Tests (media.camera.capture)
// ============================================================================

test('CameraCapability: descriptor defines CONSEQUENTIAL risk and EXECUTE authority', () => {
  const cap = new CameraCapability();
  assert.equal(cap.descriptor.id, 'media.camera.capture');
  assert.equal(cap.descriptor.riskLevel, RiskLevel.CONSEQUENTIAL);
  assert.equal(cap.descriptor.requiredAuthority, AuthorityLevel.EXECUTE);
  assert.equal(cap.descriptor.isIdempotent, false);
});

test('CameraCapability: captures frame buffer, dimensions, format, and metadata card from HAL', async () => {
  const cap = new CameraCapability();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/camera_app', delegatedAuthority: AuthorityLevel.EXECUTE };

  const result = await cap.execute({
    caller,
    contextSource: 'user_direct_intent',
    sensorId: CameraSensorId.BACK_PRIMARY,
    captureMode: 'DOCUMENT',
    format: 'RGB888'
  });

  assert.equal(result.status, 'CAPTURED');
  assert.ok(result.frameId >= 1000);
  assert.equal(result.width, 3840);
  assert.equal(result.height, 2160);
  assert.equal(result.format, 'RGB888');
  assert.equal(result.pixelFormatId, CameraPixelFormat.RGB888);
  assert.equal(result.sizeBytes, 3840 * 2160 * 3);
  assert.ok(result.frameHash && result.frameHash.length === 64);
  assert.ok(result.vmoHandle.startsWith('0xVMO_'));
  assert.ok(result.bufferRef.startsWith('vmo://'));

  // Metadata card validation
  assert.ok(result.metadataCard);
  assert.equal(result.metadataCard.cardType, 'CAMERA_METADATA_CARD');
  assert.equal(result.metadataCard.resolution, '3840 x 2160');
  assert.equal(result.metadataCard.sensorId, CameraSensorId.BACK_PRIMARY);
  assert.ok(result.metadataCard.exposure.includes('1/'));
});

test('CameraCapability: supports alternate sensors (FRONT_SELFIE, BACK_ULTRAWIDE)', async () => {
  const cap = new CameraCapability();
  const caller = { delegatedAuthority: AuthorityLevel.EXECUTE };

  const selfie = await cap.execute({
    caller,
    sensorId: CameraSensorId.FRONT_SELFIE,
    format: 'RGB888'
  });

  assert.equal(selfie.sensorId, CameraSensorId.FRONT_SELFIE);
  assert.equal(selfie.width, 1920);
  assert.equal(selfie.height, 1080);
  assert.ok(selfie.sensorName.includes('Samsung'));

  const ultraWide = await cap.execute({
    caller,
    sensorId: 'BACK_ULTRAWIDE'
  });
  assert.equal(ultraWide.sensorId, CameraSensorId.BACK_ULTRAWIDE);
  assert.ok(ultraWide.sensorName.includes('Ultrawide'));
});

test('CameraCapability: enforces hardware permission boundaries', async () => {
  const cap = new CameraCapability();

  // Deny untrusted source (e.g. script injection from email)
  await assert.rejects(
    async () => {
      await cap.execute({
        caller: { delegatedAuthority: AuthorityLevel.EXECUTE },
        contextSource: 'email_body'
      });
    },
    /Camera capture denied: untrusted context source/
  );

  // Deny insufficient authority
  await assert.rejects(
    async () => {
      await cap.execute({
        caller: { delegatedAuthority: AuthorityLevel.OBSERVE },
        contextSource: 'user_spoken'
      });
    },
    /Camera capture denied: insufficient delegated authority/
  );
});

// ============================================================================
// 2. Notes Capability Tests (notes.smart.create)
// ============================================================================

test('NotesCapability: descriptor defines REVERSIBLE risk and EXECUTE authority', () => {
  const cap = new NotesCapability();
  assert.equal(cap.descriptor.id, 'notes.smart.create');
  assert.equal(cap.descriptor.riskLevel, RiskLevel.REVERSIBLE);
  assert.equal(cap.descriptor.requiredAuthority, AuthorityLevel.EXECUTE);
});

test('NotesCapability: extracts auto-tags and applies deterministic privacy labels', async () => {
  const memory = new MemoryEngine();
  const cap = new NotesCapability({ memory });

  // 1. Confidential Document Note
  const note1 = await cap.execute({
    title: 'Confidential Tax Audit Document',
    body: 'Reviewing confidential tax disclosures and secret revenue breakdown for Q3.'
  });

  assert.equal(note1.status, 'SAVED');
  assert.equal(note1.sensitivity, 'CONFIDENTIAL');
  assert.equal(note1.sensitivityLevel, SensitivityLevel.CONFIDENTIAL);
  assert.ok(note1.tags.includes('#document'));
  assert.ok(note1.tags.includes('#receipt')); // tax triggered
  assert.ok(note1.tags.includes('#confidential'));
  assert.ok(note1.tags.includes('#finance'));
  assert.ok(note1.episodicMemoryId.startsWith('ep_note_'));

  // Verify memory persistence
  const caller = { delegatedAuthority: AuthorityLevel.EXECUTE };
  const records = memory.queryMemories({ caller, tags: ['note'] });
  assert.equal(records.length, 1);
  assert.equal(records[0].sensitivity, SensitivityLevel.CONFIDENTIAL);

  // 2. Public General Note
  const note2 = await cap.execute({
    title: 'Grocery List',
    body: 'Buy apples, oats, and almond milk for tomorrow.'
  });
  assert.equal(note2.sensitivity, 'PUBLIC');
  assert.equal(note2.sensitivityLevel, SensitivityLevel.PUBLIC);
});

test('NotesCapability: binds attached media frames and dependency outputs', async () => {
  const cap = new NotesCapability();

  const note = await cap.execute({
    title: 'Scanned Invoice',
    body: 'Hardware purchase invoice for new developer workstation #hardware',
    dependencyOutputs: {
      step_camera: {
        frameId: 1088,
        sensorName: 'Sony IMX989',
        width: 3840,
        height: 2160,
        format: 'RGB888',
        vmoHandle: '0xVMO_51A2',
        frameHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      }
    }
  });

  assert.ok(note.attachedMedia);
  assert.equal(note.attachedMedia.frameId, 1088);
  assert.equal(note.attachedMedia.resolution, '3840x2160');
  assert.equal(note.attachedMedia.vmoHandle, '0xVMO_51A2');
  assert.ok(note.tags.includes('#hardware'));
  assert.ok(note.tags.includes('#receipt')); // invoice triggered
});

// ============================================================================
// 3. Wallet Capability Tests (crypto.wallet.transact)
// ============================================================================

test('WalletCapability: descriptor defines IRREVERSIBLE risk mandating Policy Gate', () => {
  const cap = new WalletCapability();
  assert.equal(cap.descriptor.id, 'crypto.wallet.transact');
  assert.equal(cap.descriptor.riskLevel, RiskLevel.IRREVERSIBLE);
  assert.equal(cap.descriptor.requiredAuthority, AuthorityLevel.EXECUTE);
});

test('WalletCapability: executes transaction with biometric passkey and audit hash chain', async () => {
  const cap = new WalletCapability();

  const tx1 = await cap.execute({
    amount: 250,
    recipient: 'Alice',
    asset: 'USDC',
    memo: 'Flight refund settlement'
  });

  assert.equal(tx1.status, 'CONFIRMED');
  assert.equal(tx1.amount, 250);
  assert.equal(tx1.asset, 'USDC');
  assert.equal(tx1.recipient, 'Alice');
  assert.equal(tx1.biometricVerified, true);
  assert.ok(tx1.txHash.startsWith('0x'));
  assert.ok(tx1.auditHash && tx1.auditHash.length === 64);

  // Execute second transaction to verify hash chaining
  const tx2 = await cap.execute({
    amount: 10,
    recipient: 'Bob',
    asset: 'SOL',
    memo: 'Smart contract gas'
  });

  assert.equal(tx2.status, 'CONFIRMED');
  assert.equal(tx2.amount, 10);
  assert.equal(tx2.asset, 'SOL');

  const ledger = cap.getAuditLedger();
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].prevHash, '0000000000000000000000000000000000000000000000000000000000000000');
  assert.equal(ledger[1].prevHash, ledger[0].auditHash);

  const integrity = cap.verifyLedgerIntegrity();
  assert.equal(integrity.valid, true);
  assert.equal(integrity.count, 2);
});

test('WalletCapability: validates inputs and rejects invalid transfers', async () => {
  const cap = new WalletCapability();

  await assert.rejects(
    async () => cap.execute({ amount: -50, recipient: 'Alice' }),
    /Invalid transaction amount/
  );

  await assert.rejects(
    async () => cap.execute({ amount: 100, recipient: '' }),
    /Transaction recipient address or handle is required/
  );
});

test('PolicyGate: intercepts crypto.wallet.transact and mandates explicit user approval', () => {
  const policy = new PolicyGate();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/wallet_agent', delegatedAuthority: AuthorityLevel.EXECUTE };

  const evaluation = policy.evaluate({
    caller,
    capabilityDescriptor: WalletCapabilityDescriptor,
    contextSource: 'user_spoken_intent'
  });

  assert.equal(evaluation.decision, PolicyDecision.REQUIRE_USER_APPROVAL);
  assert.equal(evaluation.reason, 'IRREVERSIBLE_ACTION_MANDATES_USER_CONFIRMATION');
});

// ============================================================================
// 4. Intent Planner & Master Scenario 6 End-to-End Tests
// ============================================================================

function createFullRuntime() {
  const registry = new CapabilityRegistry();
  for (const cap of Object.values(CoreCapabilities)) {
    registry.register(cap.descriptor, cap.implementation);
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
  const taskEngine = new TaskEngine({ registry, policyGate });

  const planner = new IntentPlanner({
    router,
    registry,
    memory,
    taskEngine
  });

  // Wire memory engine to notes capability
  const notesCap = registry.get('notes.smart.create')?.implementation;
  if (notesCap && typeof notesCap.setMemoryEngine === 'function') {
    notesCap.setMemoryEngine(memory);
  }

  return { registry, modelRegistry, router, memory, policyGate, taskEngine, planner };
}

test('CapabilityRegistry: manages registration and lookup of pluggable capabilities', () => {
  const { registry } = createFullRuntime();

  assert.equal(registry.has('media.camera.capture'), true);
  assert.equal(registry.has('notes.smart.create'), true);
  assert.equal(registry.has('crypto.wallet.transact'), true);
  assert.equal(registry.has('non.existent'), false);

  const list = registry.list();
  const ids = list.map(d => d.id);
  assert.ok(ids.includes('media.camera.capture'));
  assert.ok(ids.includes('notes.smart.create'));
  assert.ok(ids.includes('crypto.wallet.transact'));
});

test('Master Scenario 6: "Take a photo of this document and save a private note" plans valid 2-step DAG', async () => {
  const { planner } = createFullRuntime();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/doc_app', delegatedAuthority: AuthorityLevel.EXECUTE };

  const plan = await planner.planIntent(
    'Take a photo of this document and save a private note',
    { caller }
  );

  assert.equal(plan.state, TaskState.PLANNED);
  assert.equal(plan.nodes.length, 2);

  const cameraNode = plan.nodes.find(n => n.capabilityId === 'media.camera.capture');
  const noteNode = plan.nodes.find(n => n.capabilityId === 'notes.smart.create');

  assert.ok(cameraNode, 'Must contain camera capture node');
  assert.ok(noteNode, 'Must contain smart note creation node');
  assert.equal(cameraNode.inputs.captureMode, 'DOCUMENT');
  assert.ok(noteNode.dependencies.includes(cameraNode.nodeId), 'Note node must depend on camera capture');
  assert.equal(noteNode.inputs.sensitivity, 'CONFIDENTIAL');
});

test('Master Scenario 6: executes multi-step DAG end-to-end and persists to Episodic Memory', async () => {
  const { planner, memory } = createFullRuntime();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/doc_app', delegatedAuthority: AuthorityLevel.EXECUTE };

  const result = await planner.planAndExecute(
    'Take a photo of this document and save a private note',
    { caller, contextSource: 'user_spoken_intent' }
  );

  assert.equal(result.execution.state, TaskState.COMPLETED);

  const cameraNode = result.execution.nodes.get('capture_document_photo');
  const noteNode = result.execution.nodes.get('save_smart_note');

  assert.equal(cameraNode.status, 'COMPLETED');
  assert.equal(cameraNode.output.status, 'CAPTURED');
  assert.equal(cameraNode.output.width, 3840);
  assert.equal(cameraNode.output.height, 2160);

  assert.equal(noteNode.status, 'COMPLETED');
  assert.equal(noteNode.output.status, 'SAVED');
  assert.equal(noteNode.output.sensitivity, 'CONFIDENTIAL');
  assert.ok(noteNode.output.attachedMedia);
  assert.equal(noteNode.output.attachedMedia.frameId, cameraNode.output.frameId);

  // Verify memory recorded episode
  const episodes = memory.queryMemories({
    caller,
    tags: ['CAMERA_CAPTURE_AND_NOTE']
  });
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].content.outcome, TaskState.COMPLETED);
  assert.equal(episodes[0].content.nodeCount, 2);
});

test('IntentPlanner: plans and executes crypto remittance with policy gate prompt', async () => {
  const { planner } = createFullRuntime();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/wallet_agent', delegatedAuthority: AuthorityLevel.EXECUTE };

  let gatePromptTriggered = false;
  const result = await planner.planAndExecute(
    'Transfer 250 USDC to Bob',
    {
      caller,
      contextSource: 'user_spoken_intent',
      onApprovalNeeded: async (task, node, policy) => {
        gatePromptTriggered = true;
        assert.equal(node.capabilityId, 'crypto.wallet.transact');
        assert.equal(policy.decision, PolicyDecision.REQUIRE_USER_APPROVAL);
        return true; // User approves prompt
      }
    }
  );

  assert.equal(gatePromptTriggered, true);
  assert.equal(result.execution.state, TaskState.COMPLETED);

  const txNode = result.execution.nodes.get('execute_crypto_transact');
  assert.equal(txNode.status, 'COMPLETED');
  assert.equal(txNode.output.status, 'CONFIRMED');
  assert.equal(txNode.output.amount, 250);
  assert.equal(txNode.output.asset, 'USDC');
  assert.equal(txNode.output.recipient, 'Bob');
  assert.ok(txNode.output.auditHash);
});
