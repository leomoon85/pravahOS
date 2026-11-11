// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

export const RiskLevel = Object.freeze({
  READ_ONLY: 0,      // Passive inspection, no state mutation
  REVERSIBLE: 1,     // Modifies state with automated rollback compensation
  CONSEQUENTIAL: 2,  // Significant mutation (writes, external network actions)
  IRREVERSIBLE: 3    // Destructive changes, financial actions, sensitive operations
});

export const AuthorityLevel = Object.freeze({
  OBSERVE: 0, // Read-only observation
  PREPARE: 1, // Prepare plan / draft; requires user approval prior to execution
  EXECUTE: 2, // Autonomous execution within bounded scope
  MANAGE: 3   // Ongoing autonomous domain management
});

export const TaskState = Object.freeze({
  CREATED: 'CREATED',
  UNDERSTOOD: 'UNDERSTOOD',
  PLANNED: 'PLANNED',
  AUTHORIZED: 'AUTHORIZED',
  EXECUTING: 'EXECUTING',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  VERIFYING: 'VERIFYING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

export const PolicyDecision = Object.freeze({
  ALLOW: 'ALLOW',
  REQUIRE_USER_APPROVAL: 'REQUIRE_USER_APPROVAL',
  DENY: 'DENY'
});

export const OperationalTier = Object.freeze({
  TIER_1_LOCAL_CORE: 1,      // Local core OS operations: SystemTime, Memory facts, Policy check, Local state
  TIER_2_OFFLINE_AI: 2,       // Specialist AI inference: Intent, Entity, Planning, Verification under Zero-Network Sandbox
  TIER_3_CONNECTED_SYNC: 3    // External network queries: Live flight tracker, Cloud sync, External web lookup
});

export const NetworkState = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  DEGRADED: 'DEGRADED'
});
