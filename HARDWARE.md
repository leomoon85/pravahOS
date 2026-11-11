# PravahOS Hardware Architecture & Supported Platforms

---

## 1. Hardware Strategy

PravahOS is designed with a **Flagship-First, Multi-SoC ARM64 Architecture**. The operating system abstracts all platform-specific device drivers through the Userspace Driver Framework (DFv2) and clean Hardware Abstraction Layers (HAL).

---

## 2. Target Hardware Profile

| Hardware Subsystem | Flagship Target Specification | Development Baseline (QEMU virt) |
| :--- | :--- | :--- |
| **CPU Architecture** | ARM64 (ARMv8.2-A / ARMv9-A) | ARM64 Cortex-A72 / Neoverse-N1 |
| **SoC Platforms** | Qualcomm Snapdragon 8 Gen 2 (SM8550), Gen 3 (SM8650), 8 Elite (SM8750) | QEMU `virt` board (`-cpu max`) |
| **System Memory** | 16 GB LPDDR5X (24 GB preferred) | 2 GB &mdash; 4 GB RAM allocation |
| **Storage Subsystem** | 512 GB &mdash; 1 TB UFS 4.0 | VirtIO-Block device (`virtio-blk-pci`) |
| **Display Panel** | 120Hz LTPO OLED (20:9 Slab, 4:3 Passport Booklet, 90° Flex) | Linear Framebuffer / VirtIO-GPU (`virtio-gpu-pci`) |
| **NPU Accelerator** | Dedicated Hexagon / Tensor NPU (INT4 / INT8 / FP16) | CPU AVX/NEON SIMD Vectorization fallback |
| **Sensory Suite** | Sony IMX890 50MP Primary, GNSS Location, Hinge Angle Hall Sensors | Virtual Sensory Bridge HAL (`emulator/sensory_bridge.js`) |
| **Connectivity** | 5G NR Sub-6/mmWave, Wi-Fi 7 (802.11be), Bluetooth 5.4, UWB | VirtIO-Net with Physical 0.0V Air-Gap Simulation |

---

## 3. Multi-SoC Portability & Isolation

PravahOS strictly separates platform-specific board initialization from core system contracts:

1. **Platform-Specific Drivers (`kernel/drivers/`)**:
   - Board bringup stubs and PL011 UART serial output ([`kernel/drivers/display/display.c`](kernel/drivers/display/display.c)).
   - Hardware Hinge HAL ([`kernel/include/kernel/hal/hinge.h`](kernel/include/kernel/hal/hinge.h)).
   - Audio DMA HAL ([`kernel/include/kernel/hal/audio.h`](kernel/include/kernel/hal/audio.h)).
   - Camera VMO streaming HAL ([`kernel/include/kernel/hal/camera.h`](kernel/include/kernel/hal/camera.h)).
   - Mobile Power & Thermal Governor ([`kernel/include/kernel/hal/power.h`](kernel/include/kernel/hal/power.h)).
2. **Shared System Contracts (`sdk/fidl/`)**:
   - `pravah.display`, `pravah.input`, `pravah.hardware`, and `pravah.capability` contain zero SoC-specific register assumptions.
   - Any ARM64 board with a compliant DFv2 driver host can boot PravahOS.
