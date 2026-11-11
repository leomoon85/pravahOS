# PravahOS Context & Memory Architecture

---

## 1. Memory Organization

PravahOS does not permanently log raw user activity into a monolithic database. Memory is structured into distinct, privacy-classified tiers:

| Memory Tier | Storage Scope | Retention Policy | Access Controls |
| :--- | :--- | :--- | :--- |
| **Preference Memory** | Explicit user settings (e.g. favorite seat, preferred payment rail) | Permanent until modified | Encrypted with user biometric key |
| **Active Task Memory** | Checkpoint data and dependency outputs for running DAGs | Transient (cleared upon task completion) | Scoped strictly to the active `taskId` |
| **Episodic Memory** | Summarized task milestones and recent communications | Time-decayed (e.g. 7-day rolling window) | Accessible only to local specialist models |
| **Semantic Knowledge** | Vectorized embeddings of user notes, receipts, and offline map tiles | User-managed storage | Isolated per capability domain |
| **System Knowledge** | Static capability descriptors, FIDL protocols, and device telemetry | Read-only ROM / flash | Globally accessible to the Policy Gate |

---

## 2. Privacy & Provenance Invariants

1. **Explicit Provenance**: Every stored memory object records its origin source, timestamp, confidence level, and encryption classification.
2. **Right to Erasure**: The user can inspect and purge any memory tier via the Security Shield with a single tap.
3. **No Unbounded Data Accumulation**: Background intelligence never hoards continuous raw audio, camera frames, or screen recordings.
