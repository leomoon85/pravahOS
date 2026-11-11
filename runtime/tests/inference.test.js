// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ModelRole,
  HardwareAccelerator,
  QuantizationFormat,
  InferenceError,
  SpecialistInferenceProvider,
  IntentSpecialist,
  EntitySpecialist,
  PlanningSpecialist,
  VerificationSpecialist,
  SummarizationSpecialist,
  ClassificationSpecialist,
  ModelRegistry,
  InferenceFabricRouter
} from '../src/inference.js';

test('SpecialistInferenceProvider: lifecycle and basic inference', async () => {
  const provider = new SpecialistInferenceProvider({
    model_id: 'test.model.v1',
    role: ModelRole.SUMMARIZATION,
    preferred_accelerator: HardwareAccelerator.NPU,
    quantization: QuantizationFormat.INT8
  });

  const desc = provider.getModelDescriptor();
  assert.equal(desc.model_id, 'test.model.v1');
  assert.equal(desc.role, ModelRole.SUMMARIZATION);
  assert.equal(desc.preferred_accelerator, HardwareAccelerator.NPU);

  const res = await provider.infer({ input: 'Sample test context' });
  assert.equal(res.model_id, 'test.model.v1');
  assert.ok(res.tokens_evaluated > 0);

  // Unload reclaiming memory
  await provider.unload();
  assert.equal(provider.isLoaded, false);

  await assert.rejects(async () => {
    await provider.infer({ input: 'Should fail' });
  }, /MODEL_NOT_FOUND/);
});

test('Specialist Models: Intent, Entity, and Verification specialists', async () => {
  const intentSpec = new IntentSpecialist();
  const entitySpec = new EntitySpecialist();

  const intentRes = await intentSpec.infer({
    input: 'Check flight AI-202 and set reminder 2 hours before departure'
  });
  assert.equal(intentRes.output.intent, 'TRAVEL_AND_REMINDER');
  assert.equal(intentRes.output.isMultiStep, true);

  const entityRes = await entitySpec.infer({
    input: 'Transfer $150 to Alice for the concert'
  });
  assert.equal(entityRes.output.entities.amount, 150);
  assert.equal(entityRes.output.entities.recipient, 'Alice');

  const verifier = new VerificationSpecialist();
  const validDagRes = await verifier.infer({
    input: {
      nodes: [
        { nodeId: 'n1', capabilityId: 'cap.one', dependencies: [] },
        { nodeId: 'n2', capabilityId: 'cap.two', dependencies: ['n1'] }
      ],
      availableCapabilities: [
        { id: 'cap.one', riskLevel: 0, requiredAuthority: 0 },
        { id: 'cap.two', riskLevel: 1, requiredAuthority: 1 }
      ]
    }
  });
  assert.equal(validDagRes.output.valid, true);
  assert.equal(validDagRes.output.errors.length, 0);

  // Circular dependency detection
  const cycleDagRes = await verifier.infer({
    input: {
      nodes: [
        { nodeId: 'n1', capabilityId: 'cap.one', dependencies: ['n2'] },
        { nodeId: 'n2', capabilityId: 'cap.two', dependencies: ['n1'] }
      ],
      availableCapabilities: [
        { id: 'cap.one', riskLevel: 0, requiredAuthority: 0 },
        { id: 'cap.two', riskLevel: 0, requiredAuthority: 0 }
      ]
    }
  });
  assert.equal(cycleDagRes.output.valid, false);
  assert.ok(cycleDagRes.output.errors.some(e => e.includes('Circular dependency')));
});

test('ModelRegistry: registers, queries, and finds specialists', () => {
  const registry = new ModelRegistry();
  const intentSpec = new IntentSpecialist();
  const entitySpec = new EntitySpecialist();

  registry.registerModel(intentSpec.getModelDescriptor(), intentSpec);
  registry.registerModel(entitySpec.getModelDescriptor(), entitySpec);

  assert.equal(registry.listModels().length, 2);
  assert.ok(registry.getModel('pravah.specialist.intent.v1'));

  const specialist = registry.findSpecialist({ role: ModelRole.INTENT });
  assert.equal(specialist.getModelDescriptor().model_id, 'pravah.specialist.intent.v1');

  registry.unregisterModel('pravah.specialist.intent.v1');
  assert.throws(() => {
    registry.findSpecialist({ role: ModelRole.INTENT });
  }, /No specialist registered for role 1/);
});

test('InferenceFabricRouter: routing, fallback, and thermal throttle handling', async () => {
  const registry = new ModelRegistry();
  const intentSpec = new IntentSpecialist();
  registry.registerModel(intentSpec.getModelDescriptor(), intentSpec);

  const router = new InferenceFabricRouter({ registry });

  // Normal inference on preferred accelerator (NPU)
  const res1 = await router.routeInfer({
    role: ModelRole.INTENT,
    input: 'Book a flight'
  });
  assert.equal(res1.accelerator_used, HardwareAccelerator.NPU);
  assert.equal(router.getMetrics().totalInferences, 1);
  assert.equal(router.getMetrics().fallbacksOccurred, 0);

  // Simulate NPU thermal throttling -> router should fallback to GPU
  router.setAcceleratorStatus(HardwareAccelerator.NPU, { throttled: true });
  const res2 = await router.routeInfer({
    role: ModelRole.INTENT,
    input: 'Book a flight'
  });
  assert.equal(res2.accelerator_used, HardwareAccelerator.GPU);
  assert.equal(router.getMetrics().fallbacksOccurred, 1);

  // Simulate GPU throttling too -> router should fallback to CPU
  router.setAcceleratorStatus(HardwareAccelerator.GPU, { throttled: true });
  const res3 = await router.routeInfer({
    role: ModelRole.INTENT,
    input: 'Book a flight'
  });
  assert.equal(res3.accelerator_used, HardwareAccelerator.CPU);

  // All accelerators throttled -> throws THERMAL_THROTTLED
  router.setAcceleratorStatus(HardwareAccelerator.CPU, { throttled: true });
  await assert.rejects(async () => {
    await router.routeInfer({
      role: ModelRole.INTENT,
      input: 'Book a flight'
    });
  }, (err) => {
    return err.code === InferenceError.THERMAL_THROTTLED;
  });
});
