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
├── main.c                      # Microkernel early entry point & self-test suite
├── arch/
│   └── arm64/
│       ├── boot.S              # EL2/EL1 boot stub, vector table & stack setup
│       └── uart_pl011.c        # Memory-mapped PL011 serial driver
├── lib/
│   └── string.c                # Freestanding memset, memcpy, memmove, string utils
├── mm/
│   ├── pmm.c                   # Physical Memory Manager (bitmap page frame allocator)
│   └── vmm.c                   # Virtual Memory Manager (ARM64 4-level translation engine)
├── object/
│   ├── handle.c                # Zircon handle table, rights validation, transfer
│   ├── vmo.c                   # Virtual Memory Objects backed by PMM physical pages
│   └── channel.c               # Bidirectional IPC channels with handle transfer
└── include/
    ├── arch/
    │   └── arm64/
    │       ├── arch.h          # ARM64 system registers, barriers, & low-power wait
    │       └── uart_pl011.h    # PL011 hardware registers, bitmasks, & API
    └── kernel/
        ├── channel.h           # Channel IPC definitions & Zircon syscall contracts
        ├── console.h           # Formatted early kernel console macros
        ├── handle.h            # Handle descriptor, table bounds & rights masks
        ├── memory.h            # QEMU virt physical memory map & page constants
        ├── pmm.h               # PMM allocation APIs & memory metrics
        ├── string.h            # Freestanding string & memory header
        ├── types.h             # Standard primitive types & Zircon ABI status codes
        ├── vmm.h               # VMM address space bounds, MAIR/TCR, mapping APIs
        └── vmo.h               # VMO creation, read/write, resize & backing pages
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

---

## 8. Memory Management Architecture

PravahOS implements a split 2-tier memory management architecture designed for deterministic bare-metal ARM64 execution and strict isolation.

```
+---------------------------------------------------------------------------------------+
|                               VIRTUAL ADDRESS SPACES                                  |
|                                                                                       |
|   TTBR0_EL1: Lower 48-bit Virtual Space       TTBR1_EL1: Higher 48-bit Virtual Space  |
|   0x0000_0000_0000_0000                       0xFFFF_0000_0000_0000                   |
|   - MMIO Peripherals (Identity Mapped)        - Direct Physical Mapping Window        |
|     * GICv3 Dist/Redist (0x08000000)          - Kernel Code, Heap & Dynamic Page      |
|     * UART0 Console (0x09000000)                Tables                                |
|     * RTC, PCIe MMIO Space                    - User task address spaces (EL0)        |
|   - Early DRAM Identity (0x40000000)                                                  |
+---------------------------------------------------------------------------------------+
                                           ▲
                                           │  ARM64 4-Level Translation (L0 -> L1 -> L2 -> L3)
                                           ▼
+---------------------------------------------------------------------------------------+
|                           PHYSICAL MEMORY MANAGER (PMM)                               |
|   - 4 KiB Frame Granularity Bitmap Allocator                                          |
|   - Fast 64-bit Word Scan & Page Auto-Zeroing                                         |
|   - Auto-Reservation of DTB (0x40000000) & Kernel Text/Data/BSS/Stack                  |
|   - DRAM Pool: 0x40000000 - 0x140000000 (Up to 4 GiB Managed DRAM)                    |
+---------------------------------------------------------------------------------------+
```

### 8.1 Physical Memory Manager (PMM)
- **Source:** `kernel/mm/pmm.c`, `kernel/include/kernel/pmm.h`
- **Granularity:** 4 KiB (`PAGE_SIZE = 4096`, `PAGE_SHIFT = 12`).
- **Bitmap Mechanics:**
  - Manages up to 1,048,576 physical pages (4 GiB DRAM) via a 128 KiB bitmap (`pmm_bitmap[16384]`).
  - Bit state: `1` = Allocated or Reserved; `0` = Free.
  - Page zeroing: Every allocated page is automatically zeroed with `memset` before ownership is transferred.
  - Automatic boundary reservation:
    * `0x40000000 - 0x40080000`: DTB & bootloader handoff window (512 KiB).
    * `__kernel_start` to `__kernel_end`: ELF `.text`, `.rodata`, `.data`, `.bss`, and the 64 KiB kernel boot stack.
- **PMM Core APIs:**
  * `void pmm_init(zx_paddr_t mem_base, size_t mem_size)`
  * `zx_status_t pmm_alloc_page(zx_paddr_t *out_paddr)`
  * `zx_status_t pmm_alloc_pages(size_t count, zx_paddr_t *out_paddr)`
  * `void pmm_free_page(zx_paddr_t paddr)`
  * `void pmm_free_pages(zx_paddr_t paddr, size_t count)`
  * `zx_status_t pmm_reserve_range(zx_paddr_t start, size_t size)`

### 8.2 Virtual Memory Manager (VMM) & ARM64 4-Level Paging
- **Source:** `kernel/mm/vmm.c`, `kernel/include/kernel/vmm.h`
- **Paging Geometry:** 48-bit Virtual Addressing with 4 KiB Granule:
  * **Level 0 (L0):** Bits [47:39], 512 entries (each entry spans 512 GiB)
  * **Level 1 (L1):** Bits [38:30], 512 entries (each entry spans 1 GiB)
  * **Level 2 (L2):** Bits [29:21], 512 entries (each entry spans 2 MiB)
  * **Level 3 (L3):** Bits [20:12], 512 entries (each entry spans 4 KiB)
  * **Page Offset:** Bits [11:0] (4096 bytes)
- **Memory Attribute Indirection Register (`MAIR_EL1`):**
  * **Attr 0 (`0x00`):** `Device-nGnRnE` (Strictly ordered, non-gathering, early write ack disabled; GIC distributor/redistributor)
  * **Attr 1 (`0x04`):** `Device-nGnRE` (Non-gathering, early write ack enabled; UART PL011, RTC, PCIe)
  * **Attr 2 (`0xFF`):** `Normal Memory` (Outer/Inner Write-Back Non-transient Read/Write-Allocate Cacheable; DRAM)
  * **Attr 3 (`0x44`):** `Normal Non-Cacheable` (DMA coherent buffers)
- **Translation Control Register (`TCR_EL1`):**
  * `T0SZ = 16`, `T1SZ = 16`: 48-bit Virtual Address space for TTBR0 and TTBR1.
  * `TG0 = 0b00`, `TG1 = 0b10`: 4 KiB translation granule.
  * `SH0 = 0b11`, `SH1 = 0b11`: Inner Shareable memory domains.
  * `ORGN0/IRGN0 = 0b01`, `ORGN1/IRGN1 = 0b01`: Normal Outer/Inner Write-Back Cacheable.
  * `IPS = 0b010`: 40-bit Intermediate Physical Address (1 TB maximum physical memory).
- **Page Descriptor Flags & Attributes:**
  * `AF` (Access Flag, bit 10): Asserted to prevent Access Flag faults.
  * `SH` (Shareability, bits 9:8): `0b11` (Inner Shareable).
  * `AP[7:6]` (Access Permissions):
    - `0b00`: Kernel Read/Write, User No Access
    - `0b01`: User Read/Write, Kernel Read/Write
    - `0b10`: Kernel Read-Only, User No Access
    - `0b11`: User Read-Only, Kernel Read-Only
  * `UXN` (bit 54) / `PXN` (bit 53): Unprivileged / Privileged Execute-Never restrictions.

---

## 9. Microkernel Object Primitives & Zircon ABI

PravahOS implements the Zircon microkernel capability model where all system resources are accessed via integer handles subject to bitmask rights enforcement.

### 9.1 Handle Table & Rights Engine
- **Source:** `kernel/object/handle.c`, `kernel/include/kernel/handle.h`
- **Handle Structure:** Non-zero 32-bit identifier encoding table index and generation counter (`((index + 1) << 12) | (gen & 0xFFF)`), preventing ABA handle recycling hazards.
- **Capability Rights Masks:**
  * `ZX_RIGHT_DUPLICATE` (`0x00000001`): Authority to duplicate handle into new handle.
  * `ZX_RIGHT_TRANSFER` (`0x00000002`): Authority to transfer handle ownership through IPC channels.
  * `ZX_RIGHT_READ` (`0x00000004`): Authority to read data payload from object.
  * `ZX_RIGHT_WRITE` (`0x00000008`): Authority to write data payload into object.
  * `ZX_RIGHT_EXECUTE` (`0x00000010`): Authority to map memory as executable.
  * `ZX_RIGHT_MAP` (`0x00000020`): Authority to map into virtual address space.
  * `ZX_RIGHT_GET_PROPERTY` (`0x00000040`): Query object metadata and size.
  * `ZX_RIGHT_SET_PROPERTY` (`0x00000080`): Mutate object metadata and size.

### 9.2 Virtual Memory Objects (VMO)
- **Source:** `kernel/object/vmo.c`, `kernel/include/kernel/vmo.h`
- Contiguous or paged memory containers backed by physical frames allocated from the PMM.
- Supports dynamic resizing (`ZX_VMO_RESIZABLE`), expanding or releasing physical pages on demand.
- Copy semantics: Data read and write operations span across discontinuous physical page boundaries with zero kernel-space fragmentation.

### 9.3 Bidirectional IPC Channels
- **Source:** `kernel/object/channel.c`, `kernel/include/kernel/channel.h`
- Channels are created as connected endpoint pairs (`zx_channel_create(0, &out0, &out1)`).
- **Atomic Handle Transfer Semantics:**
  * When writing handles into a channel, each handle is verified for `ZX_RIGHT_TRANSFER`.
  * The handle is revoked from the sender's handle table and stored within the channel message.
  * When the receiving task reads the message, new capability handles are minted into its local handle table.
- **Peer Lifecycle Management:**
  * If an endpoint is closed, the peer endpoint transitions to `peer_closed = true`.
  * The peer can read out remaining queued messages before subsequent reads return `ZX_ERR_PEER_CLOSED`.
  * Any unread messages on destroyed endpoints have their enclosed transferred handles safely released without resource leaks.

---

## 10. Zircon Syscall API Contracts

### 10.1 VMO Syscalls
```c
// Create a new Virtual Memory Object backed by PMM pages
zx_status_t zx_vmo_create(size_t size, uint32_t options, zx_handle_t *out);

// Read data from a VMO at specified offset
zx_status_t zx_vmo_read(zx_handle_t handle, void *data, uint64_t offset, size_t len, size_t *actual);

// Write data into a VMO at specified offset
zx_status_t zx_vmo_write(zx_handle_t handle, const void *data, uint64_t offset, size_t len, size_t *actual);

// Query VMO size in bytes
zx_status_t zx_vmo_get_size(zx_handle_t handle, uint64_t *out_size);

// Resize a resizable VMO
zx_status_t zx_vmo_set_size(zx_handle_t handle, uint64_t new_size);
```

### 10.2 Channel Syscalls
```c
// Create a bidirectional IPC channel endpoint pair
zx_status_t zx_channel_create(uint32_t flags, zx_handle_t *out0, zx_handle_t *out1);

// Write a message containing bytes and capability handles to an IPC channel
zx_status_t zx_channel_write(zx_handle_t handle, uint32_t flags,
                             const void *bytes, uint32_t num_bytes,
                             const zx_handle_t *handles, uint32_t num_handles);

// Read a message and incoming capability handles from an IPC channel
zx_status_t zx_channel_read(zx_handle_t handle, uint32_t flags,
                            void *bytes, zx_handle_t *handles,
                            uint32_t num_bytes, uint32_t num_handles,
                            uint32_t *actual_bytes, uint32_t *actual_handles);
```

### 10.3 Handle Syscalls
```c
// Close and invalidate an active handle
zx_status_t handle_close(zx_handle_t handle);

// Duplicate handle with same or reduced rights
zx_status_t handle_duplicate(zx_handle_t handle, zx_rights_t new_rights, zx_handle_t *out_handle);

// Replace handle with new rights mask
zx_status_t handle_replace(zx_handle_t handle, zx_rights_t new_rights, zx_handle_t *out_handle);
```

---

## 11. Microkernel Verification & Test Harness Output

Upon boot, the microkernel executes its integrated self-test suites across all subsystems:

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

--- [Kernel Subsystem Bootstrapping] ---
[PMM] Physical Memory Manager Initialized:
      DRAM Base       : 0x40000000
      DRAM Extent     : 0x140000000
      Total Pages     : 1048576 (4096 MiB)
      Free Pages      : 1048384
      Kernel Reserved : 192 pages (0x40080000 - 0x40120000)
[VMM] Virtual Memory Manager Initialized (4-Level ARM64 Paging):
      TTBR0 Root (Identity/User): 0x40120000
      TTBR1 Root (High Kernel)  : 0x40121000
      Mapped Identity MMIO      : GIC (0x08000000), UART (0x09000000), RTC, PCIe
      Mapped Identity DRAM      : 0x40000000 - 0x80000000 (1 GiB, RWX)
      Mapped High Memory Direct : 0xFFFF000040000000 -> 0x40000000
[HANDLE] Microkernel Handle Table Initialized (Capacity: 512 descriptors)
[VMO] Virtual Memory Object Subsystem Initialized (Pool: 32 VMO descriptors)
[CHANNEL] Microkernel Channel Subsystem Initialized (Pool: 16 endpoints)

--- [Test Suite 1: Physical Memory Manager (PMM)] ---
  [PASS] Single Page Allocated at Physical Addr: 0x40126000
  [PASS] Allocated Physical Page Zeroed Verification
  [PASS] Contiguous 4-Page Block Allocated at: 0x40127000
  [PASS] PMM Free & Allocation Balance Check Passed

--- [Test Suite 2: Virtual Memory Manager (VMM 4-Level Paging)] ---
  [PASS] Virtual Address Resolution: 0x100000000 -> 0x40126000 (Matches backing PA)
  [PASS] Virtual Page Unmapped successfully
  [PASS] Verified Page Unmapped State (Lookup returned -1)

--- [Test Suite 3: Virtual Memory Object (VMO) Container] ---
  [PASS] VMO Created (Size: 8192 bytes, Handle: 0x1001)
  [PASS] VMO Write Payload: 48 bytes written
  [PASS] VMO Read Verification: "PravahOS::Kernel::VMO::TestPayload::AutonomousOS"
  [PASS] VMO Dynamic Resizing: 8192 -> 16384 bytes (4 physical pages backed)

--- [Test Suite 4: Bidirectional Channel IPC & Capability Rights Transfer] ---
  [PASS] Channel Pair Created (ch0: 0x2001, ch1: 0x3001)
  [PASS] Channel Message Written: ch0 -> ch1 (Payload: 40 bytes, 1 Handle)
  [PASS] Sender Handle Revocation: Transferred handle invalidated in sender table
  [PASS] Channel Message Read: "FIDL:pravah.capability.TransferResource" (Received Handle: 0x4001)
  [PASS] Transferred VMO Data Integrity Confirmed: "Capability-Secured-VMO-Secret"

========================================================================
>>> ALL PRAVAHOS MICROKERNEL SELF-TESTS PASSED SUCCESSFULLY <<<
========================================================================
```
