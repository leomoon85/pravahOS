// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { RiskLevel, AuthorityLevel, PolicyDecision } from './types.js';

export class PolicyGate {
  constructor() {
    this.auditTrail = [];
  }

  /**
   * Deterministically evaluate whether an action is permitted.
   * AI has NO authority here; rule decisions are purely deterministic.
   */
  evaluate({ caller, capabilityDescriptor, contextSource, userPreferences = {} }) {
    const auditRecord = {
      timestamp: Date.now(),
      caller: caller?.componentUrl || 'unknown',
      capabilityId: capabilityDescriptor.id,
      riskLevel: capabilityDescriptor.riskLevel,
      contextSource,
      decision: PolicyDecision.DENY,
      reason: 'DEFAULT_DENY'
    };

    // Rule 1: Prompt-Injection Defense / Untrusted Source Sanitization
    // Content originating from emails, websites, or external documents cannot trigger state-mutating actions (REVERSIBLE, CONSEQUENTIAL, IRREVERSIBLE).
    const untrustedSources = ['email_body', 'web_scrape', 'untrusted_document', 'external_message'];
    if (untrustedSources.includes(contextSource) && capabilityDescriptor.riskLevel > RiskLevel.READ_ONLY) {
      auditRecord.decision = PolicyDecision.DENY;
      auditRecord.reason = 'UNTRUSTED_EXTERNAL_SOURCE_MUTATION_BLOCKED';
      this.auditTrail.push(auditRecord);
      return auditRecord;
    }

    // Rule 2: Irreversible operations always mandate explicit human confirmation.
    if (capabilityDescriptor.riskLevel === RiskLevel.IRREVERSIBLE) {
      auditRecord.decision = PolicyDecision.REQUIRE_USER_APPROVAL;
      auditRecord.reason = 'IRREVERSIBLE_ACTION_MANDATES_USER_CONFIRMATION';
      this.auditTrail.push(auditRecord);
      return auditRecord;
    }

    // Rule 3: Check caller's delegated authority level vs capability requirement
    const delegated = caller?.delegatedAuthority ?? AuthorityLevel.OBSERVE;
    if (delegated < capabilityDescriptor.requiredAuthority) {
      // If caller has PREPARE authority on a consequential capability, flag for approval
      if (delegated === AuthorityLevel.PREPARE && capabilityDescriptor.riskLevel <= RiskLevel.CONSEQUENTIAL) {
        auditRecord.decision = PolicyDecision.REQUIRE_USER_APPROVAL;
        auditRecord.reason = 'REQUIRES_USER_APPROVAL_FOR_PREPARE_DELEGATION';
      } else {
        auditRecord.decision = PolicyDecision.DENY;
        auditRecord.reason = 'INSUFFICIENT_DELEGATED_AUTHORITY';
      }
      this.auditTrail.push(auditRecord);
      return auditRecord;
    }

    // Rule 4: Action is authorized within delegated authority bounds
    auditRecord.decision = PolicyDecision.ALLOW;
    auditRecord.reason = 'POLICY_SATISFIED';
    this.auditTrail.push(auditRecord);
    return auditRecord;
  }

  getAuditTrail() {
    return [...this.auditTrail];
  }
}
