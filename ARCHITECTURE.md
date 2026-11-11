# PravahOS Master Architecture

> **AI-Native • Autonomous • Intent-Driven • Offline-First Operating System**

---

## 1. System Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                        DYNAMIC EXPERIENCE COMPOSER (DEC)                          |
|         Ambient Views  •  Intent Inputs  •  Dynamic Workspaces  •  Scenic/Flatland|
+-----------------------------------------------------------------------------------+
                                          ▲
                                          │ FIDL (IPC)
+-----------------------------------------┴-----------------------------------------+
|                        UNIFIED INTELLIGENCE AUTHORITY (UIA)                       |
|   Deterministic Policy Engine • Task Graph Runtime • Context/Memory Coordinator   |
+-----------------------------------------┬-----------------------------------------+
       │ FIDL                                    │ FIDL                        │ FIDL
       ▼                                         ▼                             ▼
+-----------------------------+   +-----------------------------+   +---------------+
| SPECIALIST INFERENCE FABRIC |   |  CAPABILITY & RESOURCE FABRIC|   | CONTEXT/MEMORY|
| - Intent & Entity Models    |   | - Camera, Sensors, Location |   | - Episodic    |
| - Vision & Speech Runtimes  |   | - File & Object Storage     |   | - Semantic    |
| - Task Verification Models  |   | - Communication & Comms     |   | - Task History|
+-----------------------------+   +-----------------------------+   +---------------+
                                          ▲
                                          │ Zircon Channels & Capability Routing
+-----------------------------------------┴-----------------------------------------+
|                      FUCHSIA COMPONENT FRAMEWORK (CFv2)                           |
|       Sandboxing  •  Capability Routing (.cml)  •  Process Lifecycle Management   |
+-----------------------------------------------------------------------------------+
|                       USERSPACE DRIVER FRAMEWORK (DFv2)                           |
|    Isolated Driver Hosts (NPU Firmware, Adreno/Mali GPU, Touch, Display, Modem)   |
+-----------------------------------------------------------------------------------+
|                              ZIRCON MICROKERNEL                                   |
|  Handles & Rights Masks  •  Channels & Ports  •  VMOs  •  ARM64 Scheduler & Syscalls|
+-----------------------------------------------------------------------------------+
|                     TARGET HARDWARE: ARM64 (QEMU & QUALCOMM SOC)                  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Core Architectural Subsystems

### 2.1 Zircon Microkernel Foundation
- **Object-Capability Model:** Access to all kernel objects (VMOs, channels, threads, ports) is strictly mediated by handles with fine-grained rights (`ZX_RIGHT_READ`, `ZX_RIGHT_WRITE`, `ZX_RIGHT_EXECUTE`, `ZX_RIGHT_TRANSFER`).
- **No In-Kernel Drivers:** All device drivers, filesystem servers, and networking stacks run in isolated userspace processes.
- **IPC Primitive:** Inter-component communication relies on bidirectional `zx_channel` message endpoints with typed FIDL serialization.

### 2.2 Unified Intelligence Authority (UIA)
- **Role:** Central orchestration engine for user intent, task lifecycle, and deterministic security verification.
- **Rule of Operation:** The UIA is **not** an opaque LLM. It is a lightweight, predictable, deterministic controller operating structured state machines. Inference models serve as consultative specialists, never as unconstrained decision-makers.

### 2.3 Capability & Resource Fabric
- Every operating system resource and service is exposed as a typed **Capability**.
- Capabilities declare typed inputs, typed outputs, security risk profiles, and idempotency guarantees via FIDL contracts.
- The UIA dynamically binds tasks to capabilities according to authority policies.

### 2.4 Autonomous Task Runtime
- Tasks are represented as **Directed Acyclic Graphs (DAGs)** with explicit preconditions, resource budgets, dependency checkpoints, and rollback strategies.
- State transitions: `Created` $\to$ `Understood` $\to$ `Planned` $\to$ `Authorized` $\to$ `Executing` $\to$ `Verifying` $\to$ `Completed`.
