# PravahOS Implementation Status & Subsystem Tracker

| Subsystem | Planned Technology / Layer | Status | Notes |
| :--- | :--- | :--- | :--- |
| **Microkernel** | Zircon (ARM64) | Implemented (Contract) | Switched from XNU to Zircon per ADR 0001. Awaiting kernel build tree integration. |
| **Process Isolation & Sandboxing** | Fuchsia Component Framework (CFv2) | Defined | Component topology specified. |
| **System IPC & Schemas** | Fuchsia FIDL | Initial Protocols Drafted | `pravah.capability` and `pravah.task` protocols created. |
| **Unified Intelligence Authority** | Deterministic Control Runtime | Architectural Spec | Contract defined in FIDL; logic implementation pending. |
| **Specialist Inference Fabric** | Isolated Userland Inference Components | Architectural Spec | Model contracts and lifecycle management pending. |
| **Dynamic Experience Composer** | Scenic / Flatland Composition | Architectural Spec | Dynamic intent-driven UI composition. |
| **Target Hardware** | ARM64 (QEMU `virt` $\to$ Qualcomm SM8550/SM8650) | In Evaluation | QEMU virtual target prioritized for early bringup & testing. |
