// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { RiskLevel, AuthorityLevel } from '../types.js';
import { SensitivityLevel, RetentionPolicy } from '../memory.js';

export const NotesCapabilityDescriptor = Object.freeze({
  id: 'notes.smart.create',
  version: '1.0.0',
  riskLevel: RiskLevel.REVERSIBLE,
  requiredAuthority: AuthorityLevel.EXECUTE,
  isIdempotent: false,
  timeoutMs: 3000,
  metadata: {
    category: 'PRODUCTIVITY',
    description: 'Analyzes text, extracts auto-tags, applies privacy labels (PUBLIC, CONFIDENTIAL), and persists into Episodic Memory'
  }
});

const SENSITIVITY_NAMES = {
  [SensitivityLevel.PUBLIC]: 'PUBLIC',
  [SensitivityLevel.INTERNAL]: 'INTERNAL',
  [SensitivityLevel.SENSITIVE]: 'SENSITIVE',
  [SensitivityLevel.CONFIDENTIAL]: 'CONFIDENTIAL'
};

const SENSITIVITY_LOOKUP = {
  PUBLIC: SensitivityLevel.PUBLIC,
  INTERNAL: SensitivityLevel.INTERNAL,
  SENSITIVE: SensitivityLevel.SENSITIVE,
  CONFIDENTIAL: SensitivityLevel.CONFIDENTIAL
};

/**
 * Native Smart Notes Capability
 * Analyzes note content, automatically extracts relevant hashtags/topics,
 * assigns deterministic privacy classifications, and persists records
 * directly into PravahOS Episodic Memory.
 */
export class NotesCapability {
  /**
   * @param {Object} [options]
   * @param {import('../memory.js').MemoryEngine} [options.memory] Episodic/Context Memory Engine
   */
  constructor(options = {}) {
    this.descriptor = NotesCapabilityDescriptor;
    this.memory = options.memory || null;
    this.notes = new Map(); // noteId -> NoteRecord
    this.counter = 0;
  }

  /**
   * Set or bind the system MemoryEngine.
   * @param {import('../memory.js').MemoryEngine} memory
   */
  setMemoryEngine(memory) {
    this.memory = memory;
  }

  /**
   * Extract auto-tags from text and title.
   * Finds explicit hashtags (#tag) as well as semantic keyword markers.
   *
   * @param {string} text
   * @param {string} title
   * @returns {string[]}
   */
  extractAutoTags(text = '', title = '') {
    const combined = `${title} ${text}`.toLowerCase();
    const tagSet = new Set();

    // 1. Extract existing hashtag tokens
    const hashMatches = combined.match(/#([a-z0-9_-]+)/gi);
    if (hashMatches) {
      for (const m of hashMatches) {
        tagSet.add(m.toLowerCase());
      }
    }

    // 2. Keyword ontology mapping
    const rules = [
      { regex: /document|doc|pdf|scan|page|sheet|paper/i, tag: '#document' },
      { regex: /receipt|invoice|bill|expense|tax|reimbursement/i, tag: '#receipt' },
      { regex: /private|secret|confidential|classified|nda/i, tag: '#confidential' },
      { regex: /finance|banking|revenue|audit|wallet|crypto|payment|salary/i, tag: '#finance' },
      { regex: /meeting|agenda|call|sync|standup|conference/i, tag: '#meeting' },
      { regex: /todo|action|task|followup|deadline/i, tag: '#todo' },
      { regex: /photo|camera|capture|image|snapshot/i, tag: '#photo' },
      { regex: /flight|travel|airline|boarding|airport|ticket/i, tag: '#travel' },
      { regex: /medical|health|doctor|prescription|rx/i, tag: '#medical' }
    ];

    for (const rule of rules) {
      if (rule.regex.test(combined)) {
        tagSet.add(rule.tag);
      }
    }

    if (tagSet.size === 0) {
      tagSet.add('#note');
    }

    return Array.from(tagSet);
  }

  /**
   * Classify privacy sensitivity level deterministically.
   *
   * @param {Object} params
   * @param {string} [params.explicitSensitivity] Explicitly requested sensitivity ('CONFIDENTIAL', 'PUBLIC', etc.)
   * @param {string} params.text
   * @param {string} params.title
   * @param {string[]} params.tags
   * @returns {{ level: number, label: string }}
   */
  classifyPrivacy({ explicitSensitivity, text = '', title = '', tags = [] }) {
    if (explicitSensitivity) {
      const normalized = String(explicitSensitivity).toUpperCase();
      if (SENSITIVITY_LOOKUP[normalized] !== undefined) {
        const lvl = SENSITIVITY_LOOKUP[normalized];
        return { level: lvl, label: SENSITIVITY_NAMES[lvl] };
      }
    }

    const combined = `${title} ${text} ${tags.join(' ')}`.toLowerCase();

    // CONFIDENTIAL triggers: secrets, private labels, credentials, financial details
    if (
      /private|confidential|secret|password|ssn|tax|salary|revenue|audit|bearer|private_key|pin|cvv/i.test(combined) ||
      tags.includes('#confidential')
    ) {
      return { level: SensitivityLevel.CONFIDENTIAL, label: 'CONFIDENTIAL' };
    }

    // SENSITIVE triggers: personal schedule, contacts, health, travel
    if (
      /flight|medical|doctor|phone|address|contact|personal|receipt|finance/i.test(combined) ||
      tags.includes('#travel') || tags.includes('#finance')
    ) {
      return { level: SensitivityLevel.SENSITIVE, label: 'SENSITIVE' };
    }

    return { level: SensitivityLevel.PUBLIC, label: 'PUBLIC' };
  }

  /**
   * Execute smart note creation.
   *
   * @param {Object} inputs
   * @param {string} [inputs.title='Smart Note'] Note title
   * @param {string} [inputs.body=''] Note content
   * @param {string} [inputs.sensitivity] Explicit privacy label ('CONFIDENTIAL', 'PUBLIC', etc.)
   * @param {string[]} [inputs.tags] User tags to include
   * @param {Object} [inputs.attachedMedia] Media capture info or from upstream camera node
   * @param {Object} [inputs.dependencyOutputs] Outputs from upstream DAG steps
   * @param {import('../memory.js').MemoryEngine} [inputs.memory] Optional memory override
   * @returns {Promise<Object>} Created note record
   */
  async execute(inputs = {}) {
    this.counter++;
    const noteId = `NOTE-${Date.now().toString(36).toUpperCase()}-${String(this.counter).padStart(3, '0')}`;
    const title = inputs.title || 'Smart Note';
    const body = inputs.body || '';

    // Merge upstream camera dependency if available
    let attachedMedia = inputs.attachedMedia || null;
    if (!attachedMedia && inputs.dependencyOutputs) {
      for (const output of Object.values(inputs.dependencyOutputs)) {
        if (output && (output.frameId || output.metadataCard)) {
          attachedMedia = {
            frameId: output.frameId,
            sensor: output.sensorName,
            resolution: `${output.width}x${output.height}`,
            format: output.format,
            vmoHandle: output.vmoHandle,
            frameHash: output.frameHash,
            metadataCard: output.metadataCard
          };
          break;
        }
      }
    }

    // Extract auto-tags
    const extractedTags = this.extractAutoTags(body, title);
    const userTags = Array.isArray(inputs.tags) ? inputs.tags.map(t => t.startsWith('#') ? t : `#${t}`) : [];
    const mergedTags = Array.from(new Set([...extractedTags, ...userTags]));

    // Classify privacy
    const privacy = this.classifyPrivacy({
      explicitSensitivity: inputs.sensitivity,
      text: body,
      title,
      tags: mergedTags
    });

    const createdAt = Date.now();
    const noteRecord = {
      noteId,
      title,
      body,
      sensitivity: privacy.label,
      sensitivityLevel: privacy.level,
      tags: mergedTags,
      attachedMedia,
      createdAt,
      status: 'SAVED',
      retention: RetentionPolicy.PERMANENT
    };

    // Store in local capability registry
    this.notes.set(noteId, noteRecord);

    // Persist to PravahOS Episodic Memory
    const activeMemory = inputs.memory || this.memory;
    let episodicMemoryId = null;

    if (activeMemory && typeof activeMemory.recordEpisode === 'function') {
      const episode = activeMemory.recordEpisode({
        id: `ep_note_${noteId.toLowerCase()}`,
        taskId: noteId,
        goal: `Smart Note: ${title}`,
        intent: 'notes.smart.create',
        outcome: 'COMPLETED',
        sensitivity: privacy.level,
        retention: RetentionPolicy.PERMANENT,
        tags: [...mergedTags, 'note', privacy.label.toLowerCase()],
        nodes: [
          {
            nodeId: 'smart_note_persist',
            capabilityId: 'notes.smart.create',
            status: 'COMPLETED',
            output: {
              noteId,
              title,
              tags: mergedTags,
              sensitivity: privacy.label,
              attachedMediaSummary: attachedMedia ? `${attachedMedia.resolution} (${attachedMedia.sensor})` : null
            }
          }
        ]
      });
      episodicMemoryId = episode.id;
    }

    return {
      ...noteRecord,
      episodicMemoryId: episodicMemoryId || `ep_local_${noteId.toLowerCase()}`,
      memoryPersisted: Boolean(episodicMemoryId)
    };
  }

  /**
   * Retrieve note by ID.
   * @param {string} noteId
   */
  getNote(noteId) {
    return this.notes.get(noteId) || null;
  }

  /**
   * List all stored notes.
   */
  listNotes() {
    return Array.from(this.notes.values());
  }
}

export const notesCapability = {
  descriptor: NotesCapabilityDescriptor,
  implementation: new NotesCapability()
};
