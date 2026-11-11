# PravahOS Microkernel Architecture & Boot Specification

> **Platform:** ARM64 (AArch64) • **Target:** Bare-Metal & QEMU `virt` (GICv3) • **Kernel Core:** Zircon-Compatible ABI

---

## 1. System Architectural Overview

The PravahOS microkernel is designed as an ultra-lean, capability-secure foundation. Conforming to the Zircon microkernel ABI model, it minimizes privileged code execution at **EL1 (Supervisor Mode)** while running all device drivers, filesystems, network stacks, and autonomous AI agents in sandboxed **EL0 (Userspace)** tasks.

```
+---------------------------------------------------------------------------------+
|                       USERSPACE APPLICATION & AGENTS (EL0)                     |
|     Dynamic Experience Composer (DEC)  •  Unified Intelligence Authority (UIA)  |
+---------------------------------------------------------------------------------+
|                        USERSPACE DRIVER FRAMEWORK (DFv2)                        |
|        Isolated Drivers  •  Virtual Memory Objects (VMOs)  •  FIDL IPC          |
+---------------------------------------------------------------------------------+
                                      ▲  Syscalls (SVC)
                                      ▼
+---------------------------------------------------------------------------------+
|                           PRAVAHOS MICROKERNEL (EL1)                            |
|  - Boot Entry & Vector Table (boot.S)     - PL011 UART Driver (uart_pl011.c)    |
|  - Zircon Object Table & Handles          - Channel & Port Dispatcher           |
|  - Hardware Detection & MPIDR Discovery   - 4 KiB / 2 MiB Memory Geometry       |
+---------------------------------------------------------------------------------+
                                      ▲  Hardware Traps / Interrupts
                                      ▼
+---------------------------------------------------------------------------------+
|                     ARM64 TARGET HARDWARE / QEMU 'virt'                         |
|   Cortex-A76 Quad-Core • GICv3 (0x08000000) • UART0 (0x09000000) • RAM (0x40000000) |
+---------------------------------------------------------------------------------+
```

---

## 2. Platform Memory Map

The early microkernel targets the standardized **ARM64 QEMU `virt` machine profile**. Memory-mapped I/O (MMIO) and DRAM are organized as follows:

| Physical Address Range | Region Size | Peripheral / Function | Memory Attributes |
| :--- | :--- | :--- | :--- |
| `0x0800_0000 - 0x0800_FFFF` | 64 KiB | GICv3 Distributor (`GICD`) | Device-nGnRnE |
| `0x080A_0000 - 0x080F_FFFF` | 384 KiB | GICv3 Redistributor (`GICR`) | Device-nGnRnE |
| `0x0900_0000 - 0x0900_0FFF` | 4 KiB | PrimeCell PL011 UART0 (Console) | Device-nGnRE |
| `0x0901_0000 - 0x0901_0FFF` | 4 KiB | PL031 Real Time Clock (RTC) | Device-nGnRE |
| `0x0902_0000 - 0x0902_0FFF` | 4 KiB | QEMU FW_CFG Interface | Device-nGnRE |
| `0x1000_0000 - 0x3FFF_FFFF` | 768 MiB | PCI Express MMIO Space | Device-nGnRE |
| `0x4000_0000 - 0x4007_FFFF` | 512 KiB | Reserved Bootloader / Device Tree (DTB) | Normal WB Cached |
| `0x4008_0000 - 0x400F_FFFF` | 512 KiB | **PravahOS Microkernel Image (`.text`, `.rodata`)** | Normal WB Executable |
| `0x4010_0000 - 0x4011_FFFF` | 128 KiB | Microkernel Boot Stack (64 KiB) & BSS | Normal WB RW |
| `0x4012_0000 - 0x1_3FFF_FFFF`| ~3.9 GiB | Physical Memory Page Pool (VMO backing) | Normal WB Cached |

---

## 3. ARM64 Boot Protocol & Register Conventions

### 3.1 Initial Machine State (Entry from Bootloader / QEMU)
When the kernel is invoked via `-kernel` in QEMU:
- **`x0`**: Holds the 64-bit physical pointer to the Device Tree Blob (DTB) or 0 if booted raw.
- **`x1` - `x3`**: Reserved for future hypervisor / boot protocol parameters.
- **`PC`**: Initialized to the physical start address of the binary (`0x40080000`), which is mapped directly to `_start` in `boot.S`.

### 3.2 Exception Level Transitions (EL3 / EL2 $\to$ EL1)
QEMU or hardware firmware may launch the kernel in **EL3** (Secure Monitor) or **EL2** (Hypervisor). PravahOS microkernel runs in **EL1** (Supervisor).
1. **EL3 $\to$ EL2:** Configures `SCR_EL3` with Non-Secure (NS=1) and 64-bit execution (RW=1). Sets `SPSR_EL3` to `EL2h` and executes `eret`.
2. **EL2 $\to$ EL1:**
   - Enables 64-bit execution in EL1 by asserting `HCR_EL2.RW = 1` (Bit 31).
   - Hands physical timer and counter registers to EL1 by configuring `CNTHCTL_EL2` (Bits `EL1PCTEN` and `EL1PCEN` = 1).
   - Zeroes the virtual offset `CNTVOFF_EL2 = 0`.
   - Programs `SPSR_EL2 = 0x3c5` (EL1h mode with DAIF interrupts masked).
   - Writes `el1_entry` into `ELR_EL2` and executes `eret`.

### 3.3 EL1 Environment Setup
Once in EL1:
1. **MMU/Caches:** Disables MMU, D-Cache, and I-Cache in `SCTLR_EL1` to guarantee a clean, deterministic hardware state.
2. **Vector Table Installation:** Points `VBAR_EL1` to the 2048-byte aligned `vectors` symbol.
3. **NEON / FP Enablement:** Sets `CPACR_EL1.FPEN = 0b11` (Bits 20-21) to prevent traps when userspace or microkernel routines invoke SIMD or floating-point registers.
4. **BSS Zeroing:** Clears all uninitialized variables between `__bss_start` and `__bss_end`.
5. **Boot Stack Allocation:** Sets `SP_EL1` to `boot_stack_top` (64 KiB allocated at high memory).
6. **Pass Arguments:** Restores saved boot parameters into `x0 - x3` and invokes `kernel_main`.

---

## 4. Hardware Driver Subsystems

### 4.1 PrimeCell PL011 UART Console
- **Base Address:** `0x09000000`
- **Driver Location:** `kernel/arch/arm64/uart_pl011.c`
- **Initialization Sequence:**
  1. Wait for `UARTFR.BUSY` to clear (drain active output).
  2. Disable UART by clearing `UARTCR`.
  3. Clear pending interrupts via `UARTICR`.
  4. Configure baud rate dividers for 115,200 baud based on a 24 MHz reference clock (`IBRD = 13`, `FBRD = 1`).
  5. Program Line Control Register `UARTLCR_H`: 8 bits word length, FIFO enabled (`WLEN = 0b11`, `FEN = 1`), no parity, 1 stop bit.
  6. Mask interrupts (`UARTIMSC = 0x00`) for non-blocking early polling mode.
  7. Enable transmitter and receiver in `UARTCR` (`UARTEN = 1`, `TXE = 1`, `RXE = 1`).
- **Output Safety:** `uart_putc` spins on `UARTFR.TXFF` (Transmit FIFO Full) before writing to `UARTDR`, ensuring zero character loss under high-speed console output.

---

## 5. Source Tree Structure

```
kernel/
├── CMakeLists.txt              # CMake build configuration for cross-compiling
├── Makefile                    # Standalone GNU Makefile (targets Clang or GCC)
├── linker.ld                   # Bare-metal ARM64 linker script (load base 0x40080000)
├── main.c                      # Microkernel early entry point & subsystem checks
├── arch/
│   └── arm64/
│       ├── boot.S              # EL2/EL1 boot stub, vector table & stack setup
│       └── uart_pl011.c        # Memory-mapped PL011 serial driver
└── include/
    ├── arch/
    │   └── arm64/
    │       ├── arch.h          # ARM64 system registers, barriers, & low-power wait
    │       └── uart_pl011.h    # PL011 hardware registers, bitmasks, & API
    └── kernel/
        ├── console.h           # Formatted early kernel console macros
        ├── memory.h            # QEMU virt physical memory map & page constants
        └── types.h             # Standard primitive types & Zircon ABI status codes
```

---

## 6. Build Instructions

### Option A: Using Clang & LLD (Recommended)
Clang includes a built-in cross-assembler and code generator for `aarch64-none-elf`:
```bash
# From repository root or kernel/ directory:
cd kernel
make TOOLCHAIN=clang
```
Or via CMake:
```powershell
cmake -B build -S . -DCMAKE_C_COMPILER=clang -DCMAKE_ASM_COMPILER=clang
cmake --build build --config Release
```

### Option B: Using GNU GCC Cross Toolchain
If using `aarch64-none-elf-gcc` or `aarch64-linux-gnu-gcc`:
```bash
cd kernel
make TOOLCHAIN=gcc CROSS_COMPILE=aarch64-none-elf-
```

The build produces two artifacts:
- `build/zircon-arm64/zircon.bin` (Flat binary loaded directly by bootloaders or QEMU)
- `kernel/build/pravah_kernel.elf` (ELF binary containing debugging symbols)

---

## 7. Emulation Verification on QEMU

### 7.1 Running via PowerShell Test Harness
Execute the updated test runner:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run_qemu.ps1
```
The script automatically locates `qemu-system-aarch64`, resolves kernel artifacts, and launches the virtual machine.

### 7.2 Running Directly via QEMU CLI
```powershell
qemu-system-aarch64 -M virt,gic-version=3 `
  -cpu cortex-a76 `
  -m 4096M `
  -smp 4 `
  -nographic `
  -serial mon:stdio `
  -kernel build/zircon-arm64/zircon.bin
```

### 7.3 Expected Boot Banner & Verification Output
Upon launch, UART0 prints the boot log and architectural profile:

```
========================================================================
     ____                             _       ____   ____  
    |  _ \ _ __ __ ___   ____ _ /\_   | |     / __ \ / ___| 
    | |_) | '__/ _` \ \ / / _` / _ \  | |    | |  | |\___ \ 
    |  __/| | | (_| |\ V / (_|  /_\ \ | |___ | |__| | ___) |
    |_|   |_|  \__,_| \_/ \__,_/     \|_____| \____/ |____/ 
========================================================================
  Autonomous * Intent-Driven * Offline-First Microkernel Platform
  Zircon-Compatible ABI * AArch64 Bare-Metal Architecture
========================================================================

--- [CPU & Architecture Profile] ---
  * Execution Level  : EL1 (Kernel Supervisor Mode)
  * CPU Core Affinity: Cluster 0, Core 0 (MPIDR: 0x80000000)
  * Processor Model  : Implementer 0x41, PartNum 0xD0B (MIDR: 0x410FD0B0)
  * Floating Point   : Supported (FPv8-A)
  * Advanced SIMD    : Supported (NEON)
  * GIC SysReg Interf: Supported (GICv3/GICv4)
  * Generic Counter  : 62 MHz (62500000 Hz)
  * DTB Physical Addr: 0x40000000

--- [Early Microkernel Subsystem Initialization] ---
  [PASS] 1. Exception Vectors   : Installed at VBAR_EL1
  [PASS] 2. Serial Console (UART): PL011 at 0x09000000 (115200 8N1)
  [PASS] 3. Boot Stack (SP_EL1) : 64 KiB allocated at high memory
  [PASS] 4. Memory Layout Init  : Base 0x40000000, Load 0x40080000
  [PASS] 5. Object Table Stub   : Zircon Handles & Rights mask ready
  [PASS] 6. VMO Memory Manager  : 4KB page allocator initialized
  [PASS] 7. IPC Dispatcher      : Channel message ringbuffer active
  [PASS] 8. Capability Routing  : Authority policy sandbox linked

PravahOS Microkernel bootstrap complete. Stage 1 idle loop active.
Awaiting userspace root task (bootstrap / CFv2 component manager)...
```

To exit QEMU at any time: Press `Ctrl+A` followed by `X`.

---

## 8. Transition to Phase 2 (Virtual Memory & Userspace Handoff)

With early UART and boot foundations established, Phase 2 implements:
1. **4-Level Paging (4 KiB Granule):** Setting up `TTBR0_EL1` (Userspace 0x0000_0000_0000_0000 - 0x0000_FFFF_FFFF_FFFF) and `TTBR1_EL1` (Kernel high memory 0xFFFF_0000_0000_0000 - 0xFFFF_FFFF_FFFF_FFFF).
2. **Virtual Memory Objects (VMOs):** Physical page frames wrapped in handle-based capability descriptors.
3. **Zircon System Calls:** Implementing `zx_channel_create`, `zx_channel_write`, `zx_channel_read`, and `zx_vmo_create` through `SVC #0` dispatch in `exc_sync_el0_64`.
4. **Userspace Component Handoff:** Launching the root task (`bootstrap`) in EL0 with rights to initiate the driver framework (DFv2) and component manager (CFv2).
