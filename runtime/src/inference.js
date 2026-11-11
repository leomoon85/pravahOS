// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * PravahOS Specialist Inference Fabric & Model Registry
 * Based on sdk/fidl/pravah.inference/inference.fidl
 */

import { ZeroNetworkSandbox, ModelFormat } from './offline_runner.js';
export { ZeroNetworkSandbox, ModelFormat };

export const ModelRole = Object.freeze({
  INTENT: 1,
  ENTITY: 2,
  CONTEXT: 3,
  PLANNING: 4,
  VISION: 5,
  SPEECH: 6,
  CLASSIFICATION: 7,
  RETRIEVAL: 8,
  SUMMARIZATION: 9,
  VERIFICATION: 10
});

export const HardwareAccelerator = Object.freeze({
  CPU: 0,
  GPU: 1,
  NPU: 2,
  DSP: 3
});

export const QuantizationFormat = Object.freeze({
  FP32: 0,
  FP16: 1,
  BF16: 2,
  INT8: 3,
  INT4: 4
});

export const InferenceError = Object.freeze({
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  ACCELERATOR_UNAVAILABLE: 'ACCELERATOR_UNAVAILABLE',
  OUT_OF_MEMORY: 'OUT_OF_MEMORY',
  THERMAL_THROTTLED: 'THERMAL_THROTTLED',
  TIMEOUT: 'TIMEOUT',
  MALFORMED_INPUT: 'MALFORMED_INPUT',
  EXECUTION_FAILED: 'EXECUTION_FAILED'
});

export class SpecialistInferenceProvider {
  /**
   * @param {Object} descriptor ModelDescriptor matching inference.fidl
   */
  constructor(descriptor) {
    if (!descriptor?.model_id || descriptor.role === undefined) {
      throw new Error('SpecialistInferenceProvider requires model_id and role');
    }
    this.descriptor = {
      model_id: descriptor.model_id,
      role: descriptor.role,
      version: descriptor.version || '1.0.0',
      preferred_accelerator: descriptor.preferred_accelerator ?? HardwareAccelerator.NPU,
      quantization: descriptor.quantization ?? QuantizationFormat.INT8,
      format: descriptor.format || ModelFormat.GGUF,
      memory_footprint_bytes: descriptor.memory_footprint_bytes ?? 256 * 1024 * 1024,
      max_context_tokens: descriptor.max_context_tokens ?? 4096,
      is_resident: descriptor.is_resident ?? true
    };
    this.offlineEngine = descriptor.offlineEngine || null;
    this.isLoaded = true;
  }

  getModelDescriptor() {
    return { ...this.descriptor };
  }

  async infer(request, { accelerator = null } = {}) {
    if (!this.isLoaded) {
      throw new Error(InferenceError.MODEL_NOT_FOUND);
    }
    if (!request || request.input === undefined || request.input === null) {
      throw new Error(InferenceError.MALFORMED_INPUT);
    }

    const inputStr = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
    const estimatedInputTokens = Math.max(1, Math.ceil(inputStr.length / 4));
    if (estimatedInputTokens > this.descriptor.max_context_tokens) {
      throw new Error(InferenceError.OUT_OF_MEMORY);
    }

    // Execute strictly under Zero-Network Sandbox (Tier 2 on-device isolation)
    return await ZeroNetworkSandbox.run(async () => {
      const startTime = Date.now();
      let output;
      if (this.offlineEngine && typeof this.offlineEngine.execute === 'function') {
        const engineRes = await this.offlineEngine.execute(request, {
          accelerator: accelerator ?? this.descriptor.preferred_accelerator
        });
        output = await this._executeInference(request, engineRes);
      } else {
        output = await this._executeInference(request);
      }
      const latencyMs = Math.max(1, Date.now() - startTime);

      return {
        model_id: this.descriptor.model_id,
        role: this.descriptor.role,
        output,
        tokens_evaluated: estimatedInputTokens + Math.ceil(JSON.stringify(output).length / 4),
        accelerator_used: accelerator ?? this.descriptor.preferred_accelerator,
        latency_ms: latencyMs,
        quantization: this.descriptor.quantization,
        format: this.descriptor.format,
        zero_network_verified: true
      };
    }, { modelId: this.descriptor.model_id, role: this.descriptor.role });
  }

  async _executeInference(request) {
    return { result: request.input };
  }

  async unload() {
    this.isLoaded = false;
    this.descriptor.is_resident = false;
    if (this.offlineEngine && typeof this.offlineEngine.unload === 'function') {
      await this.offlineEngine.unload();
    }
    return true;
  }
}

/**
 * Specialist Model: Natural Language Intent Recognition
 */
export class IntentSpecialist extends SpecialistInferenceProvider {
  constructor(options = {}) {
    super({
      model_id: options.model_id || 'pravah.specialist.intent.v1',
      role: ModelRole.INTENT,
      version: '1.0.0',
      preferred_accelerator: options.preferred_accelerator ?? HardwareAccelerator.NPU,
      quantization: options.quantization ?? QuantizationFormat.INT8,
      format: options.format ?? ModelFormat.GGUF,
      memory_footprint_bytes: options.memory_footprint_bytes ?? 128 * 1024 * 1024,
      max_context_tokens: options.max_context_tokens ?? 2048,
      is_resident: options.is_resident ?? true,
      offlineEngine: options.offlineEngine || null
    });
  }

  async _executeInference(request) {
    const raw = String(request.input || '').toLowerCase();

    // Flight and Travel
    const hasPayment = /pay|transfer|send\s+\$|wallet|money|funds|usdc|crypto|sol|btc|eth/i.test(raw);
    const hasFlight = /flight|fly|airline|departure|gate|terminal/i.test(raw);
    const hasReminder = /remind|reminder|schedule|calendar|alert/i.test(raw);
    const hasSummary = /summarize|summary|overview|digest/i.test(raw);
    const hasCamera = /photo|camera|capture|picture|snapshot|scan|image/i.test(raw);
    const hasNote = /note|memo|record/i.test(raw);
    const hasCrypto = /crypto|usdc|sol|btc|eth|token|bitcoin|ethereum|solana/i.test(raw);

    // Multi-step: Camera frame capture -> Smart private note
    if (hasCamera && hasNote) {
      return {
        intent: 'CAMERA_CAPTURE_AND_NOTE',
        confidence: 0.98,
        categories: ['MEDIA', 'PRODUCTIVITY'],
        isMultiStep: true,
        summary: 'Capture photo via Camera HAL and generate smart private note'
      };
    }

    if (hasPayment) {
      if (hasCrypto) {
        return {
          intent: 'CRYPTO_WALLET_TRANSACT',
          confidence: 0.97,
          categories: ['FINANCE', 'CRYPTO'],
          isMultiStep: false,
          summary: 'Execute irreversible crypto remittance on-chain'
        };
      }
      return {
        intent: 'WALLET_TRANSFER',
        confidence: 0.96,
        categories: ['FINANCE'],
        isMultiStep: false,
        summary: 'Execute financial transfer or payment'
      };
    }
    if (hasFlight && hasReminder) {
      return {
        intent: 'TRAVEL_AND_REMINDER',
        confidence: 0.98,
        categories: ['TRAVEL', 'CALENDAR'],
        isMultiStep: true,
        summary: 'Look up flight details and set a corresponding calendar reminder'
      };
    }
    if (hasFlight) {
      return {
        intent: 'TRAVEL_FLIGHT_QUERY',
        confidence: 0.95,
        categories: ['TRAVEL'],
        isMultiStep: false,
        summary: 'Query flight itinerary and status'
      };
    }
    if (hasCamera) {
      return {
        intent: 'CAMERA_CAPTURE',
        confidence: 0.95,
        categories: ['MEDIA'],
        isMultiStep: false,
        summary: 'Capture image frame from camera sensor'
      };
    }
    if (hasNote) {
      return {
        intent: 'NOTE_CREATE',
        confidence: 0.94,
        categories: ['PRODUCTIVITY'],
        isMultiStep: false,
        summary: 'Create and persist smart note to memory'
      };
    }
    if (hasReminder) {
      return {
        intent: 'CALENDAR_SCHEDULE',
        confidence: 0.94,
        categories: ['CALENDAR'],
        isMultiStep: false,
        summary: 'Schedule calendar reminder or event'
      };
    }
    if (hasSummary) {
      return {
        intent: 'CONTENT_SUMMARIZATION',
        confidence: 0.93,
        categories: ['PRODUCTIVITY'],
        isMultiStep: false,
        summary: 'Summarize context or documents'
      };
    }

    return {
      intent: 'GENERAL_TASK',
      confidence: 0.75,
      categories: ['GENERAL'],
      isMultiStep: false,
      summary: raw.slice(0, 100)
    };
  }
}

/**
 * Specialist Model: Named Entity Recognition & Slot Extraction
 */
export class EntitySpecialist extends SpecialistInferenceProvider {
  constructor(options = {}) {
    super({
      model_id: options.model_id || 'pravah.specialist.entity.v1',
      role: ModelRole.ENTITY,
      version: '1.0.0',
      preferred_accelerator: options.preferred_accelerator ?? HardwareAccelerator.NPU,
      quantization: options.quantization ?? QuantizationFormat.INT8,
      format: options.format ?? ModelFormat.GGUF,
      memory_footprint_bytes: options.memory_footprint_bytes ?? 128 * 1024 * 1024,
      max_context_tokens: options.max_context_tokens ?? 2048,
      is_resident: options.is_resident ?? true,
      offlineEngine: options.offlineEngine || null
    });
  }

  async _executeInference(request) {
    const raw = String(request.input || '');
    const entities = {};

    // Flight number: e.g. AI-202, 6E-345, BA-112, UA123
    const flightMatch = raw.match(/\b([A-Z0-9]{2,3}[-\s]?[0-9]{3,4})\b/i);
    if (flightMatch) {
      entities.flightNumber = flightMatch[1].toUpperCase().replace(/\s+/, '-');
    }

    // Currency amount & crypto token: e.g. 250 USDC, 10 SOL, $50, 150 USD, $ 250.00
    const cryptoMatch = raw.match(/(\d+(?:\.\d+)?)\s*(USDC|SOL|BTC|ETH|USDT|DAI)\b/i);
    if (cryptoMatch) {
      entities.amount = parseFloat(cryptoMatch[1]);
      entities.asset = cryptoMatch[2].toUpperCase();
    }
    const moneyMatch = raw.match(/(?:\$|usd\s*|inr\s*|rs\.?\s*)(\d+(?:\.\d{2})?)/i) ||
                       raw.match(/(\d+(?:\.\d{2})?)\s*(?:dollars|usd|inr|rupees)/i);
    if (moneyMatch && entities.amount === undefined) {
      entities.amount = parseFloat(moneyMatch[1]);
      entities.asset = 'USD';
    }

    // Recipient: e.g. to Alice, to Bob, transfer to Raj, to 0x71C...
    const recipientMatch = raw.match(/\bto\s+([A-Za-z0-9_-]+)/i);
    if (recipientMatch) {
      entities.recipient = recipientMatch[1];
    }

    // Time / Temporal slot
    const timeOffsetMatch = raw.match(/(\d+)\s*(?:hours?|hrs?|minutes?|mins?)\s+before/i);
    if (timeOffsetMatch) {
      entities.timeOffset = `${timeOffsetMatch[1]} hours before departure`;
    }
    const directTimeMatch = raw.match(/\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\b/);
    if (directTimeMatch) {
      entities.time = directTimeMatch[1];
    }
    if (/tomorrow/i.test(raw)) {
      entities.date = 'tomorrow';
    }

    // Document, Media & Note Entities
    const isDoc = /document|receipt|invoice|contract|passport|paper/i.test(raw);
    if (isDoc) {
      const docMatch = raw.match(/\b(document|receipt|invoice|contract|passport)\b/i);
      entities.documentType = docMatch ? docMatch[1].toLowerCase() : 'document';
      entities.captureMode = 'DOCUMENT';
    }
    const isPrivate = /private|confidential|secret|personal/i.test(raw);
    if (isPrivate) {
      entities.sensitivity = 'CONFIDENTIAL';
      entities.isPrivate = true;
    }
    if (/note|memo/i.test(raw)) {
      entities.title = entities.documentType
        ? `${entities.documentType.charAt(0).toUpperCase() + entities.documentType.slice(1)} Note`
        : (isPrivate ? 'Private Note' : 'Smart Note');
      entities.body = raw;
    }

    // Camera sensor preference
    if (/front|selfie/i.test(raw)) {
      entities.sensor = 'FRONT_SELFIE';
      entities.sensorId = 1;
    } else if (/ultrawide|wide/i.test(raw)) {
      entities.sensor = 'BACK_ULTRAWIDE';
      entities.sensorId = 2;
    } else {
      entities.sensor = 'BACK_PRIMARY';
      entities.sensorId = 0;
    }

    // Title / Subject
    if (/flight/i.test(raw)) {
      entities.title = entities.flightNumber ? `Flight ${entities.flightNumber}` : 'Upcoming Flight';
    } else if (entities.recipient && entities.amount) {
      entities.title = `Payment of ${entities.amount} ${entities.asset || 'USD'} to ${entities.recipient}`;
    }

    return { entities };
  }
}

/**
 * Specialist Model: DAG Decomposition & Step Planning
 */
export class PlanningSpecialist extends SpecialistInferenceProvider {
  constructor(options = {}) {
    super({
      model_id: options.model_id || 'pravah.specialist.planner.v1',
      role: ModelRole.PLANNING,
      version: '1.0.0',
      preferred_accelerator: options.preferred_accelerator ?? HardwareAccelerator.GPU,
      quantization: options.quantization ?? QuantizationFormat.FP16,
      format: options.format ?? ModelFormat.GGUF,
      memory_footprint_bytes: options.memory_footprint_bytes ?? 512 * 1024 * 1024,
      max_context_tokens: options.max_context_tokens ?? 4096,
      is_resident: options.is_resident ?? true,
      offlineEngine: options.offlineEngine || null
    });
  }

  async _executeInference(request) {
    const { intent, entities = {}, capabilities = [] } = request.input || {};
    const capIds = new Set(capabilities.map(c => c.id || c));
    const nodes = [];

    switch (intent) {
      case 'CAMERA_CAPTURE_AND_NOTE': {
        if (capIds.has('media.camera.capture')) {
          nodes.push({
            nodeId: 'capture_document_photo',
            capabilityId: 'media.camera.capture',
            dependencies: [],
            inputs: {
              sensorId: entities.sensorId ?? 0,
              captureMode: entities.captureMode || 'DOCUMENT',
              format: 'RGB888'
            }
          });
        }
        if (capIds.has('notes.smart.create')) {
          nodes.push({
            nodeId: 'save_smart_note',
            capabilityId: 'notes.smart.create',
            dependencies: nodes.length > 0 ? ['capture_document_photo'] : [],
            inputs: {
              title: entities.title || 'Document Note',
              body: entities.body || 'Captured document photo',
              sensitivity: entities.sensitivity || 'CONFIDENTIAL',
              tags: [entities.documentType || 'document', entities.isPrivate ? 'private' : null].filter(Boolean)
            }
          });
        }
        break;
      }

      case 'CAMERA_CAPTURE': {
        if (capIds.has('media.camera.capture')) {
          nodes.push({
            nodeId: 'capture_camera_frame',
            capabilityId: 'media.camera.capture',
            dependencies: [],
            inputs: {
              sensorId: entities.sensorId ?? 0,
              captureMode: entities.captureMode || 'STANDARD',
              format: 'RGB888'
            }
          });
        }
        break;
      }

      case 'NOTE_CREATE': {
        if (capIds.has('notes.smart.create')) {
          nodes.push({
            nodeId: 'save_smart_note',
            capabilityId: 'notes.smart.create',
            dependencies: [],
            inputs: {
              title: entities.title || 'Smart Note',
              body: entities.body || 'Quick note',
              sensitivity: entities.sensitivity || 'PUBLIC'
            }
          });
        }
        break;
      }

      case 'CRYPTO_WALLET_TRANSACT': {
        if (capIds.has('crypto.wallet.transact')) {
          nodes.push({
            nodeId: 'execute_crypto_transact',
            capabilityId: 'crypto.wallet.transact',
            dependencies: [],
            inputs: {
              amount: entities.amount || 0,
              recipient: entities.recipient || 'Unknown',
              asset: entities.asset || 'USDC',
              memo: entities.title || 'Autonomous Remittance'
            }
          });
        } else if (capIds.has('wallet.payment.transfer')) {
          nodes.push({
            nodeId: 'execute_wallet_transfer',
            capabilityId: 'wallet.payment.transfer',
            dependencies: [],
            inputs: {
              amount: entities.amount || 0,
              recipient: entities.recipient || 'Unknown'
            }
          });
        }
        break;
      }

      case 'TRAVEL_AND_REMINDER': {
        if (capIds.has('flight.info.get')) {
          nodes.push({
            nodeId: 'fetch_flight_info',
            capabilityId: 'flight.info.get',
            dependencies: [],
            inputs: { flightNumber: entities.flightNumber || 'AI-202' }
          });
        }
        if (capIds.has('calendar.reminder.create')) {
          nodes.push({
            nodeId: 'schedule_flight_reminder',
            capabilityId: 'calendar.reminder.create',
            dependencies: nodes.length > 0 ? ['fetch_flight_info'] : [],
            inputs: {
              title: entities.title || `Flight ${entities.flightNumber || 'AI-202'} Departure`,
              time: entities.time || entities.timeOffset || '2 hours before departure'
            }
          });
        }
        break;
      }

      case 'TRAVEL_FLIGHT_QUERY': {
        if (capIds.has('flight.info.get')) {
          nodes.push({
            nodeId: 'fetch_flight_info',
            capabilityId: 'flight.info.get',
            dependencies: [],
            inputs: { flightNumber: entities.flightNumber || 'AI-202' }
          });
        }
        break;
      }

      case 'WALLET_TRANSFER': {
        if (capIds.has('wallet.payment.transfer')) {
          nodes.push({
            nodeId: 'execute_wallet_transfer',
            capabilityId: 'wallet.payment.transfer',
            dependencies: [],
            inputs: {
              amount: entities.amount || 0,
              recipient: entities.recipient || 'Unknown'
            }
          });
        } else if (capIds.has('crypto.wallet.transact')) {
          nodes.push({
            nodeId: 'execute_crypto_transact',
            capabilityId: 'crypto.wallet.transact',
            dependencies: [],
            inputs: {
              amount: entities.amount || 0,
              recipient: entities.recipient || 'Unknown',
              asset: entities.asset || 'USDC',
              memo: entities.title || 'Autonomous Remittance'
            }
          });
        }
        break;
      }

      case 'CALENDAR_SCHEDULE': {
        if (capIds.has('calendar.reminder.create')) {
          nodes.push({
            nodeId: 'schedule_reminder',
            capabilityId: 'calendar.reminder.create',
            dependencies: [],
            inputs: {
              title: entities.title || 'Scheduled Reminder',
              time: entities.time || '10:00 AM'
            }
          });
        }
        break;
      }

      default: {
        // Fallback generic inspection or time node
        if (capIds.has('system.time.get')) {
          nodes.push({
            nodeId: 'check_system_time',
            capabilityId: 'system.time.get',
            dependencies: [],
            inputs: {}
          });
        }
        break;
      }
    }

    return { nodes };
  }
}

/**
 * Specialist Model: DAG Verification & Constraint Checking
 */
export class VerificationSpecialist extends SpecialistInferenceProvider {
  constructor(options = {}) {
    super({
      model_id: options.model_id || 'pravah.specialist.verification.v1',
      role: ModelRole.VERIFICATION,
      version: '1.0.0',
      preferred_accelerator: options.preferred_accelerator ?? HardwareAccelerator.CPU,
      quantization: options.quantization ?? QuantizationFormat.FP32,
      format: options.format ?? ModelFormat.TENSOR,
      memory_footprint_bytes: options.memory_footprint_bytes ?? 64 * 1024 * 1024,
      max_context_tokens: options.max_context_tokens ?? 2048,
      is_resident: options.is_resident ?? true,
      offlineEngine: options.offlineEngine || null
    });
  }

  async _executeInference(request) {
    const { nodes = [], availableCapabilities = [] } = request.input || {};
    const capMap = new Map(availableCapabilities.map(c => [c.id, c]));
    const nodeMap = new Map();
    const errors = [];

    for (const node of nodes) {
      if (!node.nodeId) {
        errors.push('Missing nodeId on task node');
        continue;
      }
      if (nodeMap.has(node.nodeId)) {
        errors.push(`Duplicate nodeId: ${node.nodeId}`);
      }
      nodeMap.set(node.nodeId, node);

      if (!node.capabilityId) {
        errors.push(`Node ${node.nodeId} is missing capabilityId`);
      } else if (!capMap.has(node.capabilityId)) {
        errors.push(`Node ${node.nodeId} references unregistered capability: ${node.capabilityId}`);
      }
    }

    // Check dependency validity & circular cycles
    for (const node of nodes) {
      const deps = node.dependencies || [];
      for (const depId of deps) {
        if (!nodeMap.has(depId)) {
          errors.push(`Node ${node.nodeId} depends on unknown node ${depId}`);
        }
        if (depId === node.nodeId) {
          errors.push(`Node ${node.nodeId} cannot depend on itself`);
        }
      }
    }

    // Topological cycle detection
    const visited = new Set();
    const visiting = new Set();

    const checkCycle = (nodeId) => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visiting.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (node && node.dependencies) {
        for (const dep of node.dependencies) {
          if (checkCycle(dep)) return true;
        }
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };

    for (const nodeId of nodeMap.keys()) {
      if (checkCycle(nodeId)) {
        errors.push(`Circular dependency detected involving node ${nodeId}`);
        break;
      }
    }

    // Annotate nodes with capability risk and authority info
    const verifiedNodes = nodes.map(n => {
      const cap = capMap.get(n.capabilityId);
      return {
        ...n,
        riskLevel: cap?.riskLevel ?? 0,
        requiredAuthority: cap?.requiredAuthority ?? 0
      };
    });

    return {
      valid: errors.length === 0,
      errors,
      verifiedNodes
    };
  }
}

/**
 * Specialist Model: Content & History Summarization
 */
export class SummarizationSpecialist extends SpecialistInferenceProvider {
  constructor(options = {}) {
    super({
      model_id: options.model_id || 'pravah.specialist.summarization.v1',
      role: ModelRole.SUMMARIZATION,
      version: '1.0.0',
      preferred_accelerator: options.preferred_accelerator ?? HardwareAccelerator.NPU,
      quantization: options.quantization ?? QuantizationFormat.INT8,
      format: options.format ?? ModelFormat.ONNX,
      memory_footprint_bytes: options.memory_footprint_bytes ?? 256 * 1024 * 1024,
      max_context_tokens: options.max_context_tokens ?? 4096,
      is_resident: options.is_resident ?? true,
      offlineEngine: options.offlineEngine || null
    });
  }

  async _executeInference(request) {
    const raw = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
    const summary = raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
    return {
      summary,
      keyPoints: [summary]
    };
  }
}

/**
 * Specialist Model: Privacy & Sensitivity Classifier
 */
export class ClassificationSpecialist extends SpecialistInferenceProvider {
  constructor(options = {}) {
    super({
      model_id: options.model_id || 'pravah.specialist.classifier.v1',
      role: ModelRole.CLASSIFICATION,
      version: '1.0.0',
      preferred_accelerator: options.preferred_accelerator ?? HardwareAccelerator.CPU,
      quantization: options.quantization ?? QuantizationFormat.INT8,
      format: options.format ?? ModelFormat.TENSOR,
      memory_footprint_bytes: options.memory_footprint_bytes ?? 64 * 1024 * 1024,
      max_context_tokens: 2048,
      is_resident: options.is_resident ?? true,
      offlineEngine: options.offlineEngine || null
    });
  }

  async _executeInference(request) {
    const raw = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
    const hasConfidential = /password|secret|bearer|private_key|ssn|credit[-_]?card|pin|cvv/i.test(raw);
    const hasSensitive = /flight|balance|wallet|payment|email|phone|address|salary|medical/i.test(raw);

    if (hasConfidential) {
      return { sensitivity: 'CONFIDENTIAL', sensitivityLevel: 3, flag: 'CREDENTIAL_OR_FINANCIAL_SECRET' };
    }
    if (hasSensitive) {
      return { sensitivity: 'SENSITIVE', sensitivityLevel: 2, flag: 'PERSONAL_USER_DATA' };
    }
    return { sensitivity: 'PUBLIC', sensitivityLevel: 0, flag: 'NON_SENSITIVE' };
  }
}

/**
 * Central Model Registry managed by Unified Intelligence Authority
 */
export class ModelRegistry {
  constructor() {
    this.models = new Map(); // model_id -> { descriptor, provider }
  }

  registerModel(descriptor, provider) {
    if (!descriptor?.model_id) {
      throw new Error('Model descriptor must have model_id');
    }
    if (!provider || typeof provider.infer !== 'function') {
      throw new Error(`Provider for ${descriptor.model_id} must implement infer()`);
    }
    this.models.set(descriptor.model_id, {
      descriptor: { ...descriptor },
      provider
    });
  }

  unregisterModel(modelId) {
    return this.models.delete(modelId);
  }

  getModel(modelId) {
    return this.models.get(modelId);
  }

  listModels() {
    return Array.from(this.models.values()).map(m => ({ ...m.descriptor }));
  }

  findSpecialist({ role, preferredAccelerator = null, maxMemoryBytes = null }) {
    const candidates = Array.from(this.models.values()).filter(entry => {
      if (entry.descriptor.role !== role) return false;
      if (maxMemoryBytes && entry.descriptor.memory_footprint_bytes > maxMemoryBytes) return false;
      return true;
    });

    if (candidates.length === 0) {
      const err = new Error(`No specialist registered for role ${role}`);
      err.code = InferenceError.MODEL_NOT_FOUND;
      throw err;
    }

    // Sort by accelerator preference match, residency, and smaller memory footprint
    candidates.sort((a, b) => {
      if (preferredAccelerator !== null) {
        const aMatch = a.descriptor.preferred_accelerator === preferredAccelerator ? 1 : 0;
        const bMatch = b.descriptor.preferred_accelerator === preferredAccelerator ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
      }
      if (a.descriptor.is_resident !== b.descriptor.is_resident) {
        return a.descriptor.is_resident ? -1 : 1;
      }
      return a.descriptor.memory_footprint_bytes - b.descriptor.memory_footprint_bytes;
    });

    return candidates[0].provider;
  }
}

/**
 * Specialist Inference Fabric Router
 * Handles dynamic routing across accelerators (NPU -> GPU -> CPU),
 * thermal throttling mitigation, memory constraints, and telemetry.
 */
export class InferenceFabricRouter {
  constructor({ registry, offlineRunner = null, memoryCoordinator = null, isOffline = false } = {}) {
    this.registry = registry || new ModelRegistry();
    this.offlineRunner = offlineRunner;
    this.memoryCoordinator = memoryCoordinator;
    this.isOffline = Boolean(isOffline);
    this.accelerators = {
      [HardwareAccelerator.NPU]: { available: true, throttled: false },
      [HardwareAccelerator.GPU]: { available: true, throttled: false },
      [HardwareAccelerator.CPU]: { available: true, throttled: false },
      [HardwareAccelerator.DSP]: { available: false, throttled: false }
    };
    this.metrics = {
      totalInferences: 0,
      fallbacksOccurred: 0,
      totalTokensEvaluated: 0,
      throttledErrors: 0,
      zeroNetworkInferences: 0
    };
  }

  setOfflineMode(offline = true) {
    this.isOffline = Boolean(offline);
  }

  isOfflineMode() {
    return this.isOffline;
  }

  isZeroNetworkEnforced() {
    return ZeroNetworkSandbox.isEnforced();
  }

  setAcceleratorStatus(accelerator, { available, throttled }) {
    if (this.accelerators[accelerator]) {
      if (available !== undefined) this.accelerators[accelerator].available = Boolean(available);
      if (throttled !== undefined) this.accelerators[accelerator].throttled = Boolean(throttled);
    }
  }

  getAcceleratorStatus(accelerator) {
    return { ...this.accelerators[accelerator] };
  }

  resolveTargetAccelerator(preferred) {
    // Cascade fallback order: Preferred -> NPU -> GPU -> CPU
    const fallbackOrder = [
      preferred,
      HardwareAccelerator.NPU,
      HardwareAccelerator.GPU,
      HardwareAccelerator.CPU
    ].filter((v, i, arr) => arr.indexOf(v) === i);

    for (const acc of fallbackOrder) {
      const status = this.accelerators[acc];
      if (status && status.available && !status.throttled) {
        return acc;
      }
    }

    return null;
  }

  async routeInfer({
    role,
    modelId = null,
    input,
    maxOutputTokens = 512,
    temperatureCenti = 0,
    preferredAccelerator = null
  }) {
    let provider = null;

    if (modelId) {
      const entry = this.registry.getModel(modelId);
      if (!entry) {
        const err = new Error(`Model ${modelId} not found`);
        err.code = InferenceError.MODEL_NOT_FOUND;
        throw err;
      }
      provider = entry.provider;
    } else if (role !== undefined) {
      provider = this.registry.findSpecialist({ role, preferredAccelerator });
    } else {
      throw new Error('Must provide either role or modelId for inference routing');
    }

    const desc = provider.getModelDescriptor();
    const desiredAccelerator = preferredAccelerator ?? desc.preferred_accelerator;
    const resolvedAccelerator = this.resolveTargetAccelerator(desiredAccelerator);

    if (resolvedAccelerator === null) {
      this.metrics.throttledErrors++;
      const err = new Error('All suitable hardware accelerators are throttled or unavailable');
      err.code = InferenceError.THERMAL_THROTTLED;
      throw err;
    }

    if (resolvedAccelerator !== desiredAccelerator) {
      this.metrics.fallbacksOccurred++;
    }

    // Execute under Zero-Network Sandbox (guaranteeing zero socket access during inference)
    const result = await ZeroNetworkSandbox.run(async () => {
      return await provider.infer(
        {
          model_id: desc.model_id,
          input,
          max_output_tokens: maxOutputTokens,
          temperature_centi: temperatureCenti
        },
        { accelerator: resolvedAccelerator }
      );
    }, { role: desc.role, modelId: desc.model_id, isOffline: this.isOffline });

    this.metrics.totalInferences++;
    this.metrics.totalTokensEvaluated += result.tokens_evaluated || 0;
    this.metrics.zeroNetworkInferences++;

    return result;
  }

  getMetrics() {
    return { ...this.metrics };
  }
}
