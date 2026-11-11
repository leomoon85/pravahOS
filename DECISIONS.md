# Architecture Decision Record (ADR) 0001
## Pivot from XNU to Fuchsia (Zircon Microkernel & Component Framework)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Project:** PravahOS

---

### Context & Problem Statement

PravahOS is designed as an AI-native, autonomous, capability-centric, offline-first mobile operating system. The original master brief envisioned an **XNU** (Mach + BSD hybrid kernel) foundation.

However, detailed architectural evaluation reveals critical mismatches between XNU's core paradigms and the non-negotiable requirements of PravahOS:
1. **Security & Capability Model:** XNU inherits traditional monolithic Unix/BSD semantics (UID/GID, root privilege, ambient authority) layered over Mach IPC. PravahOS mandates an **object-capability** security architecture where capabilities are granular, typed, revocable, and policy-gated.
2. **Provider Isolation & Fault Tolerance:** In XNU, drivers and system extensions interact either in kernel-space or via complex Mach-port mechanisms (`DriverKit`/`IOKit`). If an AI accelerator or sensor driver faults, kernel panics and instability ensue.
3. **Hardware Portability & Modern ARM64:** XNU is tightly bound to Apple proprietary Silicon (SEP, AMCC, AIC, APFS). Reverse-engineered ports to modern flagship Qualcomm SoCs (SM8550/SM8650/SM8750) are fragile and lack vendor-supported driver abstractions.
4. **IPC Performance & Typed Contracts:** PravahOS requires typed, schema-validated RPC/IPC for capabilities and task graphs. Mach messages lack modern type generation and IDL toolchains.

### Decision

PravahOS adopts **Google Fuchsia's architecture** as its system foundation, specifically:
1. **Zircon Microkernel:** Primitives restricted to thread/process management, virtual memory (`zx_vmo`), inter-process communication (`zx_channel`, `zx_socket`, `zx_port`), and capability handles (`zx_handle_t` with explicit rights masks).
2. **Component Framework (CFv2):** Sandboxed userland execution units. Every PravahOS service (Intelligence Authority, Specialist Inference, Capabilities, Compositor) is packaged as a Fuchsia component with explicit capability routing manifests (`.cml`).
3. **FIDL (Fuchsia Interface Definition Language):** Strictly typed, zero-copy/low-overhead IPC contracts for all capability interfaces, task graphs, and policy gates.
4. **Driver Framework (DFv2):** User-space drivers isolated in dedicated driver host processes.

---

### Consequences

#### Positive
- **Native Capability Primitives:** Zircon handles enforce least-privilege capability passing directly at the microkernel level without legacy POSIX UID baggage.
- **Resilience:** Crash isolation is absolute. If a specialist neural runtime or camera driver crashes, the microkernel and Unified Intelligence Authority remain unaffected.
- **Typed Ecosystem:** System contracts can be expressed cleanly in FIDL and compiled for C++, Rust, or native toolchains.
- **Clean Hardware Abstraction:** Zircon provides clear ARM64 board support primitives (ACPI, Devicetree, modular driver host).

#### Negative / Challenges
- **Bootstrapping Complexity:** Fuchsia/Zircon build systems (`gn` / `ninja` / `bazel`) require a structured workspace setup and cross-compilation toolchain.
- **Driver Availability:** Platform drivers for proprietary mobile SoCs (cellular modem, NPU firmware loaders) must be encapsulated in Fuchsia Driver Framework v2 components or wrapped cleanly via hardware abstraction layers.
