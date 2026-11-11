# PravahOS Phase 1 Architecture Roadmap

This roadmap details the transition to the Google Fuchsia / Zircon microkernel architecture.

---

## Milestones

### Milestone 1: Core Foundation & Capability Contracts (Completed)
- [x] Create Architectural Decision Record (ADR 0001: Pivot from XNU to Fuchsia/Zircon)
- [x] Define Master Architecture (`ARCHITECTURE.md`)
- [x] Establish Core System FIDL protocols (`pravah.capability`, `pravah.task`)
- [x] Define `pravah.inference` (Specialist Inference Fabric FIDL contract)
- [x] Define `pravah.policy` (Deterministic Security Boundary FIDL contract)

### Milestone 2: Zircon Microkernel & Toolchain Bringup (In Progress)
- [x] Create Build & Emulation Guide (`BUILD.md`)
- [x] Create ARM64 QEMU boot harness script (`scripts/run_qemu.ps1`)
- [ ] Setup cross-compilation toolchain for ARM64 (`aarch64-elf-gcc` / Clang + LLVM)
- [ ] Integrate Zircon kernel build tree (ARM64 virtual target / QEMU `virt` machine first)
- [ ] Boot Zircon kernel image and reach serial console milestone on ARM64 virtual target

### Milestone 3: Component Framework & Capability Runtime
- [ ] Scaffold `component_manager` and base component topology
- [ ] Implement userland `CapabilityRegistry` component in Rust / C++
- [ ] Wire first deterministic capability (e.g., `system.time`, `storage.inspect`) with policy validation

### Milestone 4: Autonomous Task Runtime & Specialist Inference
- [ ] Implement Directed Acyclic Graph (DAG) task engine
- [ ] Integrate local on-device quantized model runner (e.g. lightweight llama.cpp/ONNX runtime encapsulated in a Fuchsia Component)
- [ ] Implement end-to-end intent decomposition and verified execution
