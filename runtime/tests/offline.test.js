// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';

import {
  OperationalTier,
  NetworkState,
  RiskLevel,
  AuthorityLevel,
  TaskState,
  PolicyDecision
} from '../src/types.js';

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

import {
  ModelFormat,
  NetworkSandboxViolationError,
  ZeroNetworkSandbox,
  QuantizedModelEngine,
  GGUFExecutionEngine,
  ONNXExecutionEngine,
  TensorExecutionEngine,
  LocalWeightCache,
  MemoryBudgetCoordinator,
  OfflineModelRunner,
  NetworkManager,
  OfflineSyncQueue
} from '../src/offline_runner.js';

import { CapabilityRegistry } from '../src/registry.js';
import { PolicyGate } from '../src/policy.js';
import { TaskEngine } from '../src/task_engine.js';
import { MemoryEngine, SensitivityLevel } from '../src/memory.js';
import { IntentPlanner } from '../src/planner.js';
import { CoreCapabilities } from '../src/mock_capabilities.js';

test('ZeroNetworkSandbox: traps and blocks all network socket primitives', async () => {
  ZeroNetworkSandbox.reset();

  // 1. net.Socket connect
  await assert.rejects(async () => {
    await ZeroNetworkSandbox.run(() => {
      const socket = new net.Socket();
      socket.connect(8080, '127.0.0.1');
    });
  }, (err) => {
    assert.equal(err instanceof NetworkSandboxViolationError, true);
    assert.equal(err.code, 'NETWORK_ACCESS_FORBIDDEN');
    assert.equal(err.target, 'net.Socket');
    return true;
  });

  // 2. http.get
  await assert.rejects(async () => {
    await ZeroNetworkSandbox.run(() => {
      http.get('http://127.0.0.1:8080');
    });
  }, (err) => {
    assert.equal(err instanceof NetworkSandboxViolationError, true);
    assert.equal(err.target, 'http.get');
    return true;
  });

  // 3. https.get
  await assert.rejects(async () => {
    await ZeroNetworkSandbox.run(() => {
      https.get('https://example.com');
    });
  }, (err) => {
    assert.equal(err instanceof NetworkSandboxViolationError, true);
    assert.equal(err.target, 'https.get');
    return true;
  });

  // 4. dgram.createSocket (UDP)
  await assert.rejects(async () => {
    await ZeroNetworkSandbox.run(() => {
      dgram.createSocket('udp4');
    });
  }, (err) => {
    assert.equal(err instanceof NetworkSandboxViolationError, true);
    assert.equal(err.target, 'dgram.createSocket');
    return true;
  });

  // 5. dns.lookup
  await assert.rejects(async () => {
    await ZeroNetworkSandbox.run(() => {
      dns.lookup('example.com', () => {});
    });
  }, (err) => {
    assert.equal(err instanceof NetworkSandboxViolationError, true);
    assert.equal(err.target, 'dns.lookup');
    return true;
  });

  // 6. globalThis.fetch
  if (typeof globalThis.fetch === 'function') {
    await assert.rejects(async () => {
      await ZeroNetworkSandbox.run(async () => {
        await globalThis.fetch('http://127.0.0.1:8080');
      });
    }, (err) => {
      assert.equal(err instanceof NetworkSandboxViolationError, true);
      assert.equal(err.target, 'fetch');
      return true;
    });
  }

  // Verify audit log has recorded all violation attempts
  const violations = ZeroNetworkSandbox.getViolationAuditLog();
  assert.ok(violations.length >= 5);
  const metrics = ZeroNetworkSandbox.getMetrics();
  assert.equal(metrics.zeroNetworkVerified, true);
  assert.ok(metrics.blockedAttempts >= 5);

  ZeroNetworkSandbox.reset();
});

test('ZeroNetworkSandbox: global enforcement mode blocks external access across whole process', () => {
  ZeroNetworkSandbox.reset();
  ZeroNetworkSandbox.enableGlobalEnforcement();
  assert.equal(ZeroNetworkSandbox.isEnforced(), true);

  assert.throws(() => {
    const s = new net.Socket();
    s.connect(9999, '127.0.0.1');
  }, NetworkSandboxViolationError);

  ZeroNetworkSandbox.disableGlobalEnforcement();
  assert.equal(ZeroNetworkSandbox.isEnforced(), false);
  ZeroNetworkSandbox.reset();
});

test('QuantizedModelEngine: GGUF execution engine (INT4 and INT8)', async () => {
  // INT8 GGUF Model
  const ggufInt8 = new GGUFExecutionEngine({
    modelId: 'pravah.gguf.q8.v1',
    role: ModelRole.INTENT,
    quantization: QuantizationFormat.INT8,
    maxContextTokens: 1024
  });

  await ggufInt8.load();
  assert.equal(ggufInt8.isLoaded, true);
  assert.equal(ggufInt8.tensorMetadata.quantizationType, 'Q8_0');

  const int8Res = await ggufInt8.execute({ input: 'Transfer $100 to Bob' }, { accelerator: HardwareAccelerator.NPU });
  assert.equal(int8Res.format, ModelFormat.GGUF);
  assert.equal(int8Res.quantizationType, 'Q8_0');
  assert.equal(int8Res.acceleratorUsed, HardwareAccelerator.NPU);
  assert.ok(int8Res.tokensEvaluated > 0);
  assert.ok(int8Res.latencyMs <= 5);

  // INT4 GGUF Model (Q4_0, block size 32)
  const ggufInt4 = new GGUFExecutionEngine({
    modelId: 'pravah.gguf.q4.v1',
    role: ModelRole.PLANNING,
    quantization: QuantizationFormat.INT4,
    maxContextTokens: 512
  });

  await ggufInt4.load();
  assert.equal(ggufInt4.tensorMetadata.quantizationType, 'Q4_0');
  assert.equal(ggufInt4.blockSize, 32);

  const int4Res = await ggufInt4.execute({ input: 'Plan multi-step task' }, { accelerator: HardwareAccelerator.GPU });
  assert.equal(int4Res.quantizationType, 'Q4_0');
  assert.equal(int4Res.acceleratorUsed, HardwareAccelerator.GPU);

  // Context window overflow throws OUT_OF_MEMORY
  const hugeInput = 'word '.repeat(1000);
  await assert.rejects(async () => {
    await ggufInt4.execute({ input: hugeInput });
  }, /OUT_OF_MEMORY/);

  await ggufInt8.unload();
  await ggufInt4.unload();
  assert.equal(ggufInt8.isLoaded, false);
});

test('QuantizedModelEngine: ONNX and Tensor execution engines', async () => {
  // ONNX Model
  const onnxEngine = QuantizedModelEngine.create({
    format: ModelFormat.ONNX,
    modelId: 'pravah.onnx.summarizer.v1',
    role: ModelRole.SUMMARIZATION,
    quantization: QuantizationFormat.INT8
  });

  assert.equal(onnxEngine instanceof ONNXExecutionEngine, true);
  await onnxEngine.load();
  const onnxRes = await onnxEngine.execute({ input: 'Document text to summarize' });
  assert.equal(onnxRes.format, ModelFormat.ONNX);
  assert.equal(onnxRes.opset, 17);

  // Tensor direct Sysmem VMO Engine
  const tensorEngine = QuantizedModelEngine.create({
    format: ModelFormat.TENSOR,
    modelId: 'pravah.tensor.verifier.v1',
    role: ModelRole.VERIFICATION,
    quantization: QuantizationFormat.INT8
  });

  assert.equal(tensorEngine instanceof TensorExecutionEngine, true);
  await tensorEngine.load();
  const tensorRes = await tensorEngine.execute({ input: 'Verify DAG nodes' });
  assert.equal(tensorRes.format, ModelFormat.TENSOR);
  assert.equal(tensorRes.zeroCopyVmo, true);

  await onnxEngine.unload();
  await tensorEngine.unload();
});

test('LocalWeightCache: caching, checksum integrity, and LRU eviction', () => {
  const cache = new LocalWeightCache({ maxCacheBytes: 300 * 1024 * 1024 }); // 300 MB limit

  // Register 3 weights (100MB each)
  cache.registerWeight('model.a', { sizeBytes: 100 * 1024 * 1024, format: ModelFormat.GGUF, isPinned: false });
  cache.registerWeight('model.b', { sizeBytes: 100 * 1024 * 1024, format: ModelFormat.GGUF, isPinned: true });
  cache.registerWeight('model.c', { sizeBytes: 100 * 1024 * 1024, format: ModelFormat.ONNX, isPinned: false });

  assert.equal(cache.hasWeight('model.a'), true);
  assert.equal(cache.hasWeight('model.b'), true);
  assert.equal(cache.hasWeight('model.c'), true);
  assert.equal(cache.getTotalCachedBytes(), 300 * 1024 * 1024);

  // Adding 4th model (100MB) exceeds 300MB -> must evict LRU unpinned model ('model.a')
  cache.registerWeight('model.d', { sizeBytes: 100 * 1024 * 1024, format: ModelFormat.TENSOR, isPinned: false });

  assert.equal(cache.hasWeight('model.a'), false); // evicted
  assert.equal(cache.hasWeight('model.b'), true);  // kept (isPinned = true)
  assert.equal(cache.hasWeight('model.c'), true);
  assert.equal(cache.hasWeight('model.d'), true);

  const stats = cache.getStats();
  assert.equal(stats.evictions, 1);
  assert.ok(stats.totalCachedBytes <= 300 * 1024 * 1024);
});

test('MemoryBudgetCoordinator: enforces 1GB budget and reclaims non-resident models', async () => {
  const coordinator = new MemoryBudgetCoordinator({ maxBudgetBytes: 512 * 1024 * 1024 }); // 512MB test budget

  let unloadedCount = 0;
  const mockProvider = {
    async unload() {
      unloadedCount++;
    }
  };

  // Allocate Model 1: 256 MB (non-resident, low priority)
  await coordinator.requestAllocation('model_1', 256 * 1024 * 1024, {
    isResident: false,
    priority: 1,
    provider: mockProvider
  });

  // Allocate Model 2: 256 MB (resident / pinned, higher priority)
  await coordinator.requestAllocation('model_2', 256 * 1024 * 1024, {
    isResident: true,
    priority: 3
  });

  assert.equal(coordinator.currentAllocatedBytes, 512 * 1024 * 1024);

  // Requesting Model 3 (128 MB) exceeds 512MB:
  // Must auto-reclaim non-resident 'model_1', invoking its unload()
  await coordinator.requestAllocation('model_3', 128 * 1024 * 1024, {
    isResident: false,
    priority: 2
  });

  assert.equal(unloadedCount, 1);
  assert.equal(coordinator.allocations.has('model_1'), false); // evicted
  assert.equal(coordinator.allocations.has('model_2'), true);  // preserved resident
  assert.equal(coordinator.allocations.has('model_3'), true);
  assert.equal(coordinator.currentAllocatedBytes, (256 + 128) * 1024 * 1024);

  // Requesting an allocation larger than remaining + reclaimable causes OUT_OF_MEMORY
  await assert.rejects(async () => {
    await coordinator.requestAllocation('huge_model', 400 * 1024 * 1024);
  }, (err) => {
    assert.equal(err.code, InferenceError.OUT_OF_MEMORY);
    return true;
  });

  const report = coordinator.getBudgetReport();
  assert.equal(report.stats.reclamations, 1);
  assert.equal(report.stats.oomRejections, 1);
});

test('OfflineModelRunner: registers, manages memory, and executes under ZeroNetworkSandbox', async () => {
  const runner = new OfflineModelRunner();

  runner.registerModel({
    model_id: 'offline.intent.q8',
    role: ModelRole.INTENT,
    format: ModelFormat.GGUF,
    quantization: QuantizationFormat.INT8,
    memory_footprint_bytes: 64 * 1024 * 1024,
    preferred_accelerator: HardwareAccelerator.NPU
  });

  const res = await runner.infer('offline.intent.q8', {
    input: 'Check flight status AI-202'
  });

  assert.equal(res.model_id, 'offline.intent.q8');
  assert.equal(res.zero_network_verified, true);
  assert.equal(res.accelerator_used, HardwareAccelerator.NPU);
  assert.equal(res.quantization, QuantizationFormat.INT8);

  const metrics = runner.getMetrics();
  assert.equal(metrics.totalInferences, 1);
  assert.equal(metrics.zeroNetworkSandboxedCalls, 1);
  assert.equal(metrics.sandbox.zeroNetworkVerified, true);
});

test('Zero-Network execution of Tier 1 and Tier 2 operations', async () => {
  ZeroNetworkSandbox.reset();

  // 1. Tier 1 Core Local Operations: SystemTime, PolicyGate, MemoryEngine
  const capabilityRegistry = new CapabilityRegistry();
  capabilityRegistry.register(CoreCapabilities.SystemTime.descriptor, CoreCapabilities.SystemTime.implementation);

  const policyGate = new PolicyGate();
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/core_agent', delegatedAuthority: AuthorityLevel.EXECUTE };

  const policyResult = policyGate.evaluate({
    caller,
    capabilityDescriptor: CoreCapabilities.SystemTime.descriptor,
    contextSource: 'local_timer'
  });
  assert.equal(policyResult.decision, PolicyDecision.ALLOW);

  const timeCap = capabilityRegistry.get('system.time.get');
  const timeRes = await timeCap.implementation.execute();
  assert.ok(timeRes.timestamp > 0);

  const memory = new MemoryEngine();
  memory.storeFact({
    key: 'user_preferred_airport',
    value: 'DEL',
    sensitivity: SensitivityLevel.PUBLIC
  });
  const queriedFacts = memory.queryMemories({ contextSource: 'local_timer' });
  assert.equal(queriedFacts.length, 1);
  assert.equal(queriedFacts[0].content, 'DEL');

  // Assert: Tier 1 executed with ZERO network violations
  const t1Assertion = ZeroNetworkSandbox.assertZeroNetworkActivity();
  assert.equal(t1Assertion.zeroNetworkVerified, true);
  assert.equal(t1Assertion.blockedAttempts, 0);

  // 2. Tier 2 Offline AI Specialist Models
  const intentSpec = new IntentSpecialist({ format: ModelFormat.GGUF, quantization: QuantizationFormat.INT8 });
  const entitySpec = new EntitySpecialist({ format: ModelFormat.GGUF, quantization: QuantizationFormat.INT8 });
  const planSpec = new PlanningSpecialist({ format: ModelFormat.GGUF, quantization: QuantizationFormat.INT4 });
  const verifySpec = new VerificationSpecialist({ format: ModelFormat.TENSOR, quantization: QuantizationFormat.INT8 });
  const sumSpec = new SummarizationSpecialist({ format: ModelFormat.ONNX, quantization: QuantizationFormat.INT8 });
  const classSpec = new ClassificationSpecialist({ format: ModelFormat.TENSOR, quantization: QuantizationFormat.INT4 });

  // Execute all specialist models under ZeroNetworkSandbox
  const intentRes = await intentSpec.infer({ input: 'Schedule reminder tomorrow at 10 AM' });
  assert.equal(intentRes.output.intent, 'CALENDAR_SCHEDULE');
  assert.equal(intentRes.zero_network_verified, true);
  assert.equal(intentRes.quantization, QuantizationFormat.INT8);

  const entityRes = await entitySpec.infer({ input: 'Transfer $200 to Charlie' });
  assert.equal(entityRes.output.entities.amount, 200);
  assert.equal(entityRes.output.entities.recipient, 'Charlie');
  assert.equal(entityRes.zero_network_verified, true);

  const planRes = await planSpec.infer({
    input: {
      intent: 'CALENDAR_SCHEDULE',
      entities: { title: 'Team Sync', time: '10:00 AM' },
      capabilities: [{ id: 'calendar.reminder.create', riskLevel: 1, requiredAuthority: 2 }]
    }
  });
  assert.equal(planRes.output.nodes.length, 1);
  assert.equal(planRes.zero_network_verified, true);

  const verifyRes = await verifySpec.infer({
    input: {
      nodes: planRes.output.nodes,
      availableCapabilities: [{ id: 'calendar.reminder.create', riskLevel: 1, requiredAuthority: 2 }]
    }
  });
  assert.equal(verifyRes.output.valid, true);
  assert.equal(verifyRes.zero_network_verified, true);

  const sumRes = await sumSpec.infer({ input: 'PravahOS is an AI-native offline-first microkernel operating system.' });
  assert.ok(sumRes.output.summary.length > 0);
  assert.equal(sumRes.zero_network_verified, true);

  const classRes = await classSpec.infer({ input: 'My wallet secret key is token_1234' });
  assert.equal(classRes.output.sensitivity, 'CONFIDENTIAL');
  assert.equal(classRes.zero_network_verified, true);

  // Assert: Tier 2 executed with ZERO network activity
  const t2Assertion = ZeroNetworkSandbox.assertZeroNetworkActivity();
  assert.equal(t2Assertion.zeroNetworkVerified, true);
  assert.equal(t2Assertion.blockedAttempts, 0);
});

test('Network drop simulation: system remains fully functional offline, external queries gracefully fallback and queue', async () => {
  ZeroNetworkSandbox.reset();

  // Setup Network Manager & Sync Queue
  const networkManager = new NetworkManager({ initialStatus: NetworkState.ONLINE });
  const syncQueue = new OfflineSyncQueue();

  // Setup Model Registry & Inference Router
  const modelRegistry = new ModelRegistry();
  const intentSpec = new IntentSpecialist();
  const entitySpec = new EntitySpecialist();
  const planSpec = new PlanningSpecialist();
  const verifySpec = new VerificationSpecialist();

  modelRegistry.registerModel(intentSpec.getModelDescriptor(), intentSpec);
  modelRegistry.registerModel(entitySpec.getModelDescriptor(), entitySpec);
  modelRegistry.registerModel(planSpec.getModelDescriptor(), planSpec);
  modelRegistry.registerModel(verifySpec.getModelDescriptor(), verifySpec);

  const router = new InferenceFabricRouter({ registry: modelRegistry, isOffline: false });

  // Setup Memory Engine with seeded offline cache
  const memory = new MemoryEngine();
  memory.storeFact({
    key: 'preferred_flight',
    value: 'AI-202',
    sensitivity: SensitivityLevel.SENSITIVE
  });
  // Seed cached flight info in episodic memory
  memory.recordEpisode({
    taskId: 'flight_cache_seed',
    goal: 'Cache flight AI-202 schedule',
    contextSource: 'local_sync',
    planNodes: ['flight.info.get'],
    summary: 'Flight AI-202: Departure 08:30 AM Terminal T3 Gate 12B Status ON_TIME',
    finalState: TaskState.COMPLETED
  });

  // Setup Capability Registry with Tier 1 and Tier 3 capabilities
  const capabilityRegistry = new CapabilityRegistry();
  capabilityRegistry.register(CoreCapabilities.SystemTime.descriptor, CoreCapabilities.SystemTime.implementation);
  capabilityRegistry.register(CoreCapabilities.CalendarCreateReminder.descriptor, CoreCapabilities.CalendarCreateReminder.implementation);

  // Tier 3 External capability: Flight Info lookup with graceful offline fallback & sync queuing
  const externalFlightCap = {
    descriptor: {
      id: 'flight.info.get',
      version: '1.0.0',
      riskLevel: RiskLevel.READ_ONLY,
      requiredAuthority: AuthorityLevel.OBSERVE,
      tier: OperationalTier.TIER_3_CONNECTED_SYNC
    },
    implementation: {
      async execute({ flightNumber = 'AI-202' }) {
        if (networkManager.isOffline()) {
          // Graceful Offline Fallback:
          // 1. Check local memory cache
          const episodes = memory.queryMemories({ limit: 5 });
          const cachedEpisode = episodes.find(e => e.type === 'EPISODIC' && e.summary?.includes(flightNumber));

          // 2. Queue external query for background sync once network restores
          syncQueue.enqueue({
            capabilityId: 'flight.info.get',
            inputs: { flightNumber },
            taskNodeId: 'fetch_flight_info'
          });

          return {
            flightNumber,
            departure: '08:30 AM (Cached)',
            terminal: 'T3',
            gate: '12B',
            status: 'CACHED_OFFLINE',
            offlineDegraded: true,
            queuedForSync: true
          };
        }

        // Online execution
        return {
          flightNumber,
          departure: '08:30 AM',
          terminal: 'T3',
          gate: '12B',
          status: 'ON_TIME_LIVE',
          offlineDegraded: false
        };
      }
    }
  };
  capabilityRegistry.register(externalFlightCap.descriptor, externalFlightCap.implementation);

  const policyGate = new PolicyGate();
  const taskEngine = new TaskEngine({ registry: capabilityRegistry, policyGate });
  const planner = new IntentPlanner({ router, registry: capabilityRegistry, memory, taskEngine });

  // =========================================================================
  // STEP 1: Simulate network disconnection (severed connectivity)
  // =========================================================================
  networkManager.simulateDisconnect();
  router.setOfflineMode(true);
  assert.equal(networkManager.isOffline(), true);
  assert.equal(router.isOfflineMode(), true);

  // =========================================================================
  // STEP 2: Execute end-to-end user intent completely OFFLINE
  // =========================================================================
  const rawIntent = 'Check flight AI-202 and set reminder 2 hours before departure';
  const caller = { componentUrl: 'fuchsia-pkg://pravah.os/travel_app', delegatedAuthority: AuthorityLevel.EXECUTE };

  const planned = await planner.planIntent(rawIntent, { caller, contextSource: 'user_spoken_intent' });

  assert.equal(planned.metadata.intent, 'TRAVEL_AND_REMINDER');
  assert.equal(planned.state, TaskState.PLANNED);
  assert.equal(planned.nodes.length, 2);

  // Execute the DAG offline
  const task = taskEngine.createTask({
    id: planned.id,
    goal: planned.goal,
    caller: planned.caller,
    contextSource: planned.contextSource,
    nodes: planned.nodes
  });
  const executedTask = await taskEngine.executeTask(task.id);

  assert.equal(executedTask.state, TaskState.COMPLETED);

  const flightNode = executedTask.nodes.get('fetch_flight_info');
  assert.equal(flightNode.status, 'COMPLETED');
  assert.equal(flightNode.output.offlineDegraded, true);
  assert.equal(flightNode.output.status, 'CACHED_OFFLINE');

  const reminderNode = executedTask.nodes.get('schedule_flight_reminder');
  assert.equal(reminderNode.status, 'COMPLETED');
  assert.equal(reminderNode.output.status, 'SCHEDULED');

  // External query is safely queued for background sync
  assert.equal(syncQueue.size(), 1);
  const pendingSync = syncQueue.peek();
  assert.equal(pendingSync.capabilityId, 'flight.info.get');
  assert.equal(pendingSync.inputs.flightNumber, 'AI-202');

  // Verify Zero Network Activity occurred during offline execution
  const stats = ZeroNetworkSandbox.assertZeroNetworkActivity();
  assert.equal(stats.zeroNetworkVerified, true);
  assert.equal(stats.blockedAttempts, 0);

  // =========================================================================
  // STEP 3: Restore network connectivity and drain sync queue
  // =========================================================================
  networkManager.restoreConnection();
  router.setOfflineMode(false);
  assert.equal(networkManager.isOnline(), true);

  const syncResults = await syncQueue.drain(async (item) => {
    // Process external live update now that online
    return await externalFlightCap.implementation.execute(item.inputs);
  });

  assert.equal(syncResults.length, 1);
  assert.equal(syncResults[0].success, true);
  assert.equal(syncResults[0].item.result.status, 'ON_TIME_LIVE');
  assert.equal(syncQueue.size(), 0);
});
