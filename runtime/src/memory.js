// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { AuthorityLevel } from './types.js';

export const SensitivityLevel = Object.freeze({
  PUBLIC: 0,       // General non-sensitive data
  INTERNAL: 1,     // System telemetry, operational traces
  SENSITIVE: 2,    // Personal preferences, schedule, contacts
  CONFIDENTIAL: 3  // Financial credentials, secrets, medical data, PII
});

export const RetentionPolicy = Object.freeze({
  SESSION: 'SESSION',       // Cleared on session end (default TTL: 1h)
  SHORT_TERM: 'SHORT_TERM', // Ephemeral buffer (default TTL: 24h)
  LONG_TERM: 'LONG_TERM',   // Persistent history (default TTL: 30d)
  PERMANENT: 'PERMANENT'    // Indefinite until explicit user deletion
});

export const MemoryType = Object.freeze({
  EPISODIC: 'EPISODIC',             // Task executions, user episodes, outcomes
  SEMANTIC: 'SEMANTIC',             // Facts, user preferences, profiles
  WORKING_CONTEXT: 'WORKING_CONTEXT' // Current session context, location, active devices
});

const DEFAULT_TTL_MS = {
  [RetentionPolicy.SESSION]: 3600 * 1000,
  [RetentionPolicy.SHORT_TERM]: 24 * 3600 * 1000,
  [RetentionPolicy.LONG_TERM]: 30 * 24 * 3600 * 1000,
  [RetentionPolicy.PERMANENT]: Infinity
};

/**
 * Redacts common PII and confidential patterns from strings and objects.
 */
export function redactSensitiveData(data) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    return data
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g, '[REDACTED_EMAIL]')
      .replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[REDACTED_PHONE]')
      .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[REDACTED_CARD]')
      .replace(/\b(?:bearer\s+[\w-.]+)|(?:token[=:]\s*[\w-.]+)/gi, '[REDACTED_CREDENTIAL]');
  }
  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }
  if (typeof data === 'object') {
    const redacted = {};
    for (const [k, v] of Object.entries(data)) {
      if (/password|secret|token|credential|cvv|pin/i.test(k)) {
        redacted[k] = '[REDACTED_CONFIDENTIAL]';
      } else {
        redacted[k] = redactSensitiveData(v);
      }
    }
    return redacted;
  }
  return data;
}

/**
 * Context & Episodic Memory Engine
 * Manages episodic experiences, working context, retention windows,
 * sensitivity classifications, and caller privacy controls.
 */
export class MemoryEngine {
  constructor({ classifier = null } = {}) {
    this.records = new Map(); // id -> MemoryRecord
    this.workingContext = new Map(); // key -> ContextItem
    this.auditTrail = [];
    this.classifier = classifier;
  }

  /**
   * Determine max sensitivity level allowed for a given caller identity & context.
   */
  resolveAllowedSensitivity(caller, contextSource) {
    const untrustedSources = ['email_body', 'web_scrape', 'untrusted_document', 'external_message'];
    if (untrustedSources.includes(contextSource)) {
      // Untrusted external sources are restricted to PUBLIC information only
      return SensitivityLevel.PUBLIC;
    }

    const authority = caller?.delegatedAuthority ?? AuthorityLevel.OBSERVE;
    switch (authority) {
      case AuthorityLevel.OBSERVE:
        return SensitivityLevel.INTERNAL;
      case AuthorityLevel.PREPARE:
        return SensitivityLevel.SENSITIVE;
      case AuthorityLevel.EXECUTE:
      case AuthorityLevel.MANAGE:
        return SensitivityLevel.CONFIDENTIAL;
      default:
        return SensitivityLevel.PUBLIC;
    }
  }

  /**
   * Automatically classify sensitivity based on content if not explicitly specified.
   */
  classifyContent(content) {
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    if (/password|secret|bearer|private_key|ssn|credit[-_]?card|pin|cvv/i.test(str)) {
      return SensitivityLevel.CONFIDENTIAL;
    }
    if (/flight|balance|wallet|payment|email|phone|address|salary|medical/i.test(str)) {
      return SensitivityLevel.SENSITIVE;
    }
    return SensitivityLevel.PUBLIC;
  }

  /**
   * Record an episodic event (e.g. task run, user request, action result).
   */
  recordEpisode({
    id,
    taskId,
    goal,
    intent,
    outcome,
    nodes = [],
    sensitivity = null,
    retention = RetentionPolicy.LONG_TERM,
    tags = []
  }) {
    const recordId = id || `ep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const evaluatedSensitivity = sensitivity ?? this.classifyContent({ goal, intent, outcome });
    const ttl = DEFAULT_TTL_MS[retention] || DEFAULT_TTL_MS[RetentionPolicy.LONG_TERM];
    const now = Date.now();

    const record = {
      id: recordId,
      type: MemoryType.EPISODIC,
      key: taskId || goal,
      content: {
        taskId,
        goal,
        intent,
        outcome,
        nodeCount: nodes.length,
        nodes: nodes.map(n => ({
          nodeId: n.nodeId,
          capabilityId: n.capabilityId,
          status: n.status,
          output: n.output
        }))
      },
      sensitivity: evaluatedSensitivity,
      retention,
      createdAt: now,
      expiresAt: ttl === Infinity ? Infinity : now + ttl,
      accessCount: 0,
      lastAccessedAt: now,
      tags: [...tags, 'episodic', intent].filter(Boolean),
      tombstoned: false
    };

    this.records.set(record.id, record);
    return record;
  }

  /**
   * Store a persistent semantic fact or preference (e.g. user preferences).
   */
  storeFact({
    key,
    value,
    sensitivity = null,
    retention = RetentionPolicy.PERMANENT,
    tags = []
  }) {
    if (!key) throw new Error('Fact requires a key');
    const recordId = `fact_${key}`;
    const evaluatedSensitivity = sensitivity ?? this.classifyContent(value);
    const ttl = DEFAULT_TTL_MS[retention] || DEFAULT_TTL_MS[RetentionPolicy.PERMANENT];
    const now = Date.now();

    const record = {
      id: recordId,
      type: MemoryType.SEMANTIC,
      key,
      content: value,
      sensitivity: evaluatedSensitivity,
      retention,
      createdAt: now,
      expiresAt: ttl === Infinity ? Infinity : now + ttl,
      accessCount: 0,
      lastAccessedAt: now,
      tags: [...tags, 'semantic', key],
      tombstoned: false
    };

    this.records.set(record.id, record);
    return record;
  }

  /**
   * Update or set working session context.
   */
  setWorkingContext(key, value, { ttlMs = 3600 * 1000, sensitivity = null } = {}) {
    if (!key) throw new Error('Context key is required');
    const evaluatedSensitivity = sensitivity ?? this.classifyContent(value);
    const now = Date.now();

    const item = {
      key,
      value,
      sensitivity: evaluatedSensitivity,
      createdAt: now,
      expiresAt: now + ttlMs
    };

    this.workingContext.set(key, item);
    return item;
  }

  /**
   * Read working session context with privacy check.
   */
  getWorkingContext(key, { caller, contextSource } = {}) {
    this.pruneExpired();
    const item = this.workingContext.get(key);
    if (!item) return null;

    const maxSensitivity = this.resolveAllowedSensitivity(caller, contextSource);
    if (item.sensitivity > maxSensitivity) {
      this._logAccess({
        caller,
        action: 'READ_WORKING_CONTEXT_DENIED',
        key,
        allowed: false,
        reason: 'SENSITIVITY_EXCEEDS_CALLER_AUTHORITY'
      });
      return null;
    }

    this._logAccess({
      caller,
      action: 'READ_WORKING_CONTEXT_ALLOWED',
      key,
      allowed: true
    });
    return item.value;
  }

  /**
   * Query memories with privacy evaluation and optional redaction.
   */
  queryMemories({
    type = null,
    tags = [],
    queryText = null,
    caller = null,
    contextSource = null,
    includeExpired = false,
    redact = false,
    limit = 20
  } = {}) {
    this.pruneExpired();

    const maxAllowedSensitivity = this.resolveAllowedSensitivity(caller, contextSource);
    const results = [];
    const now = Date.now();

    for (const record of this.records.values()) {
      if (record.tombstoned) continue;
      if (!includeExpired && record.expiresAt < now) continue;
      if (type && record.type !== type) continue;

      // Privacy Gate: Sensitivity boundary
      if (record.sensitivity > maxAllowedSensitivity) {
        continue;
      }

      // Tag filter
      if (tags.length > 0) {
        const matchesTag = tags.some(t => record.tags.includes(t));
        if (!matchesTag) continue;
      }

      // Text filter
      if (queryText) {
        const text = `${record.key} ${JSON.stringify(record.content)} ${record.tags.join(' ')}`.toLowerCase();
        if (!text.includes(queryText.toLowerCase())) continue;
      }

      // Record access
      record.accessCount++;
      record.lastAccessedAt = now;

      const recordContent = redact ? redactSensitiveData(record.content) : record.content;
      results.push({
        id: record.id,
        type: record.type,
        key: record.key,
        content: recordContent,
        sensitivity: record.sensitivity,
        retention: record.retention,
        createdAt: record.createdAt,
        tags: [...record.tags]
      });

      if (results.length >= limit) break;
    }

    this._logAccess({
      caller,
      action: 'QUERY_MEMORIES',
      resultCount: results.length,
      allowed: true
    });

    return results;
  }

  /**
   * Forget user data (GDPR Right to be Forgotten / Purge).
   */
  forget({ id, key, tag } = {}) {
    let deletedCount = 0;
    for (const [recId, record] of this.records.entries()) {
      if (id && recId === id) {
        this.records.delete(recId);
        deletedCount++;
      } else if (key && record.key === key) {
        this.records.delete(recId);
        deletedCount++;
      } else if (tag && record.tags.includes(tag)) {
        this.records.delete(recId);
        deletedCount++;
      }
    }
    return deletedCount;
  }

  /**
   * Prune expired records and working context.
   */
  pruneExpired() {
    const now = Date.now();
    let prunedCount = 0;

    for (const [id, record] of this.records.entries()) {
      if (record.expiresAt <= now) {
        this.records.delete(id);
        prunedCount++;
      }
    }

    for (const [key, item] of this.workingContext.entries()) {
      if (item.expiresAt <= now) {
        this.workingContext.delete(key);
        prunedCount++;
      }
    }

    return prunedCount;
  }

  /**
   * Clear all working session context.
   */
  clearSessionContext() {
    this.workingContext.clear();
  }

  _logAccess(entry) {
    this.auditTrail.push({
      timestamp: Date.now(),
      caller: entry.caller?.componentUrl || 'system',
      ...entry
    });
  }

  getAuditTrail() {
    return [...this.auditTrail];
  }
}
