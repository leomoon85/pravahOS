# PravahOS Implementation Status & Subsystem Tracker

| Subsystem | Planned Technology / Layer | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Microkernel** | Zircon Bare-Metal / ARM64 | Implemented (Bringup Core) | ARM64 EL1 boot stub, PL011 UART, vector table, and build pipeline implemented under `kernel/` (`KERNEL.md`). |
| **Process Isolation & Sandboxing** | Fuchsia Component Framework (CFv2) | Implemented (Manifests & Shards) | Production-grade CML manifests, topology, and routing defined (`COMPONENTS.md`). |
| **System IPC & Schemas** | Fuchsia FIDL | Initial Protocols Drafted | `pravah.capability` and `pravah.task` protocols created. |
| **Unified Intelligence Authority** | Deterministic Control Runtime | Architectural Spec | Contract defined in FIDL; logic implementation pending. |
| **Specialist Inference Fabric** | Isolated Userland Inference Components | Architectural Spec | Model contracts and lifecycle management pending. |
| **Dynamic Experience Composer** | Scenic / Flatland Composition | Architectural Spec | Dynamic intent-driven UI composition. |
| **Target Hardware** | ARM64 (QEMU `virt` $\to$ Qualcomm SM8550/SM8650) | In Evaluation | QEMU virtual target prioritized for early bringup & testing. |
