# PravahOS Implementation Status & Subsystem Evidence Matrix

This document provides the authoritative, evidence-backed status for all PravahOS subsystems. Every subsystem is classified strictly under one of the five verified states:
1. **Specified**: Architecture, FIDL, or CML manifests exist, but executable code or generated bindings are not integrated into a running binary.
2. **Simulated**: Behavior is mocked in software, test harness, or userland scripts without real hardware or kernel driver execution.
3. **Implemented but unverified**: Native code exists and compiles or passes static validation, but has not been executed on physical silicon.
4. **Verified on emulator / host**: Tested and verified under host runtimes, Node.js harnesses, QEMU `virt`, or browser shell emulators.
5. **Verified on named physical hardware**: Tested on an attached, flashed physical phone with confirmed hardware logs.

---

## 1. Subsystem Evidence Matrix

| Subsystem | Layer / Technology | Status | Evidence & Real Implementation Boundaries |
| :--- | :--- | :--- | :--- |
| **Microkernel & Core Memory** | ARM64 C Microkernel (`kernel/`) | **Implemented but unverified** *(Verified on QEMU virt only)* | Custom ARM64 C kernel (`kernel/main.c`, `kernel/process/syscall.c`) implements PMM bitmap allocator, VMM demand paging, handles, channels, and VMOs. EL0 user-pointer validation now enforced. Boots to idle loop in QEMU `virt`; device tree drivers for physical SoCs (UFS, DSI, PMIC, touch) are unverified on physical hardware. |
| **Process Isolation & CFv2** | Fuchsia Component Framework (`components/*.cml`) | **Specified** | CFv2 manifests (`.cml`) specify sandboxing shards and capability routing, but Fuchsia component manager runtime is not compiled into native binaries. |
| **System IPC & FIDL Protocols** | FIDL Definitions (`system/fidl/`) | **Specified** | FIDL schemas specify `pravah.capability`, `pravah.task`, `pravah.policy`, `pravah.hardware`. Stub bindings exist in JavaScript; C/C++ native code generators are not linked to a native FIDL IPC bus. |
| **Deterministic Policy Gate** | Intent & Capability Arbiter (`runtime/src/policy/`) | **Verified on emulator / host** | Pure algorithmic policy arbiter evaluating risk levels (`READ_ONLY`, `REVERSIBLE`, `CONSEQUENTIAL`, `IRREVERSIBLE`), context sources, and SHA-256 tamper-evident forward hash chain. Verified across 27+ automated unit tests. |
| **Autonomous Task Engine** | Directed Acyclic Graph (`runtime/src/task/`) | **Verified on emulator / host** | DAG topological scheduler, rollback checkpoints, and dynamic progress computation. Fully verified in Node.js test environment. |
| **Hardware Platform Daemon** | Native C Daemon (`services/pravahd/`) | **Implemented but unverified** *(Verified on host)* | Native C daemon (`pravahd.c`, `Android.bp`, `pravahd.rc`) and Node.js bridge (`pravahd_service.js`). Reads battery state from `/sys/class/power_supply/battery/*`, controls backlight at `/sys/class/backlight/*`, enforces policy gating, and guarantees atomic persistence (`.tmp` + `fsync` + `rename`). 8/8 tests passing in `runtime/tests/pravahd_slice.test.js`. Physical device testing pending target device flashing. |
| **Sensory & Mobile HAL** | HAL Mock Drivers (`hal/`) | **Simulated** | Audio DMA, Camera VMO, and Battery/Thermal governor are software mocks tested in Node.js (`hal/tests/`). Physical camera/audio drivers require AOSP HAL or native Linux v4l2/ALSA drivers. |
| **Hinge & Foldable Pipeline** | Multi-Display Driver (`hal/foldable/`) | **Simulated** | Hinge angle sensing ($0^\circ \dots 180^\circ$) and dual-panel power gating logic simulated in emulator window and automated unit tests. |
| **Android Compatibility** | AOT Transpiler & Container (`runtime/src/container/`) | **Simulated** | APK manifest parser and dormancy telemetry simulated in JavaScript. Real APK execution requires Android ART/AOSP runtime container. |
| **Experience Composer Shell** | Dynamic Web Shell (`ui/shell/`) | **Verified on emulator / host** | Liquid glassmorphism, dynamic bento drawer, Control Center shade, and predictive back navigation running in browser/PWA shell. Connected to `pravahd` IPC for brightness control. |
| **Living App Drawer & UI** | Bento Grid & Gestures (`ui/`) | **Verified on emulator / host** | Neo-Metro bento grid, 20-26px squircle styling, spring physics, dynamic search filtering. Verified on browser host. |
| **Stock Apps Suite** | Core Apps (`ui/apps/`) | **Verified on emulator / host** | Phone (T9), Messages, Gallery, Files, Calculator, Clock. Fully functional with offline-first local state within browser/PWA shell. |
| **3GPP Rel-17 Satellite SOS** | NTN Protocol (`hal/satellite/`) | **Simulated** | Slant range mathematics, orbital Doppler calculations, and 128-byte binary packet serialization simulated in software. No physical RF satellite transceiver attached. |
| **Multi-SoC Flashing & Tooling** | Flashing Suite (`tools/flashing/`) | **Implemented but unverified** *(Simulated in dry-run)* | `flash_device.ps1` and `flash_device.sh` implement partition flashing workflows for Qualcomm and Google Tensor targets. Dummy ELF placeholder payload generation has been **removed**; scripts fail closed if real kernel binaries are missing. Verified in dry-run; no physical device flashed. |
| **Titan M2 Cryptographic Driver** | Enclave Driver (`kernel/arch/arm64/google/titan_m2.c`) | **Simulated** | Driver models 16 hardware key slots and AVB custom key enrollment. Sealing derivation currently uses simulated keystream rather than physical Titan M2 secure SPI bus commands. |
| **Interactive Phone Emulator** | Device Shell (`emulator/`) | **Verified on emulator / host** | Touch digitizer coordinate normalization, multi-touch pinch/fling, HUD telemetry, and responsive chassis switcher verified on host. |

---

## 2. Test Suite Summary

- **Total Automated Tests**: **431 / 431 Passing (100%)**
- **Test Suites**: **44 suites** across `runtime`, `ui`, `emulator`, `kernel`, `hal`, and `services`
- **Regressions**: **0**
- **Physical Device Attached**: **None detected** (`fastboot devices` and `adb devices` report no connected hardware).
- **Provisional Target Selected**: **Google Pixel 7 (`panther` - Tensor G2 / GS201)**
