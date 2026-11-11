# PravahOS Process Lifecycle & Userland Execution Specification

> **Platform:** ARM64 (AArch64) Bare-Metal & QEMU `virt` (GICv3)  
> **ABI Standard:** Zircon-Compatible Microkernel Capability Model  
> **Execution Model:** Sandboxed EL0 Userland Tasks with Isolated 48-bit Virtual Address Spaces

---

## 1. Executive Summary & Architecture Overview

PravahOS enforces a strict microkernel separation of privilege:
- **EL1 (Supervisor Mode):** The core microkernel handles physical memory management (PMM), page table manipulation (VMM), capability routing (Handles), and low-level trap dispatching.
- **EL0 (Userland Mode):** All application processes, AI agent runtimes, drivers (DFv2), and system services execute in isolated EL0 address spaces without direct access to hardware registers or kernel memory.

```
+-----------------------------------------------------------------------------------------+
|                                USERLAND PROCESS (EL0)                                   |
|   - Virtual Address Space: [0x0000_0000_0000_0000, 0x0000_FFFF_FFFF_FFFF] (TTBR0_EL1)  |
|   - Stack Pointer: SP_EL0 (0x0000_0000_0080_0000, 64 KiB allocated)                    |
|   - Entry Point:   ELR_EL1 (0x0000_0000_0040_0000)                                     |
|   - Capability Namespace: Process-Isolated Handle Table (Indices 1..64)                 |
+-----------------------------------------------------------------------------------------+
                                    │                           ▲
                         svc #0     │ (x16=Syscall ID)          │ eret (EL0t, SPSR=0)
                         (Syscall)  ▼                           │ (Return Status x0)
+-----------------------------------------------------------------------------------------+
|                               PRAVAHOS MICROKERNEL (EL1)                                |
|   - Vector Table: VBAR_EL1 + 0x400 (Synchronous Lower EL AArch64)                       |
|   - Context Switch: arch_enter_user_space & arm64_el0_sync_entry (switch.S)             |
|   - Syscall Dispatcher: arm64_syscall_dispatcher (syscall.c)                            |
|   - Process & Thread PCB/TCB: zx_process_create, zx_thread_create, zx_process_start     |
|   - ELF64 Binary Parser: elf_validate_header, elf_parse, elf_load_process               |
|   - Memory Management: VMM per-process TTBR0 page tables, PMM page frame allocator      |
+-----------------------------------------------------------------------------------------+
```

---

## 2. ELF64 Binary Parser & Image Loader (`elf.h`, `elf.c`)

### 2.1 ELF64 Identification & Validation

When an ELF64 binary image is ingested from memory, ramdisk, or a Virtual Memory Object (VMO), `elf_validate_header` rigorously validates its header:

| ELF Header Field | Expected Value | Purpose |
| :--- | :--- | :--- |
| `e_ident[EI_MAG0..3]` | `\x7fELF` (`0x7F, 'E', 'L', 'F'`) | Confirms valid ELF magic identity |
| `e_ident[EI_CLASS]` | `ELFCLASS64` (`2`) | Enforces 64-bit object file geometry |
| `e_ident[EI_DATA]` | `ELFDATA2LSB` (`1`) | Verifies 2's complement little-endian format |
| `e_ident[EI_VERSION]` | `EV_CURRENT` (`1`) | Confirms current ELF format version |
| `e_machine` | `EM_AARCH64` (`183` / `0xB7`) | Enforces ARM 64-bit target architecture |
| `e_type` | `ET_EXEC` (`2`) or `ET_DYN` (`3`) | Accepts static executables and position-independent binaries (PIE) |

If any check fails, the parser immediately rejects the binary with `ZX_ERR_NOT_SUPPORTED` or `ZX_ERR_INVALID_ARGS`, preventing arbitrary or invalid code execution.

### 2.2 Program Header Inspection (`PT_LOAD`)

The parser inspects the program header table (`Elf64_Phdr`):
1. **Identifies `PT_LOAD` segments:** Only loadable segments are mapped into the process's virtual memory.
2. **Bounds Checking:** Verifies that `p_offset + p_filesz` does not exceed the binary image size, and that `p_filesz <= p_memsz`.
3. **Permission Translation:** Converts standard ELF flags into hardware VMM translation attributes:
   - `PF_R` $\to$ `VMM_FLAG_READ`
   - `PF_W` $\to$ `VMM_FLAG_WRITE`
   - `PF_X` $\to$ `VMM_FLAG_EXECUTE`
   - Every userland segment is unconditionally tagged with `VMM_FLAG_USER` (AP[1]=1 in ARM64 page descriptors).

### 2.3 Process Memory Loading (`elf_load_process`)

For each `PT_LOAD` segment:
1. Calculates page-aligned virtual bounds:
   $$\text{vaddr\_start} = \lfloor \text{p\_vaddr} \rfloor_{4\text{KB}}, \quad \text{vaddr\_end} = \lceil \text{p\_vaddr} + \text{p\_memsz} \rceil_{4\text{KB}}$$
2. Allocates physical page frames from PMM (`pmm_alloc_page`).
3. Clears allocated frames to zero with `memset`. This automatically guarantees that uninitialized BSS (`.bss`) data (`p_memsz - p_filesz`) is zero-filled without requiring explicit zeroing loops.
4. Copies file payload from the ELF buffer into the allocated physical frames.
5. Maps the virtual page range in the process's dedicated user address space using `vmm_aspace_map`.
6. Sets the process entry point to `ehdr->e_entry`.

---

## 3. Process & Thread Subsystems (`process.h`, `thread.h`)

### 3.1 Process Control Block (PCB) & Address Space Isolation

Every userland task is represented by a Process Control Block (`process_t`):

```c
typedef struct process {
    zx_koid_t              koid;                 /* Unique kernel object ID */
    char                   name[ZX_MAX_NAME_LEN];/* Human-readable label */
    process_state_t        state;                /* Lifecycle state */
    vmm_aspace_t           aspace;               /* Dedicated TTBR0 user address space */
    process_handle_table_t handle_table;         /* Isolated handle namespace */
    struct thread          *threads;             /* Linked list of threads */
    size_t                 thread_count;         /* Number of active threads */
    zx_vaddr_t             entry_point;          /* Virtual memory entry point */
    int64_t                exit_code;            /* Termination return code */
    bool                   in_use;
} process_t;
```

#### Dedicated User Address Space (TTBR0_EL1)
- Each process allocates its own root L0 translation table (`vmm_aspace_create`).
- Virtual addresses in `[0x0000_0000_0000_0000, 0x0000_FFFF_FFFF_FFFF]` are translated through the process's private L0 table.
- Supervisor MMIO (UART, GIC, RTC) and kernel DRAM (`0x40000000 - 0x80000000`) are mapped in the L0 table with **EL1-privileged permissions only** (without `VMM_FLAG_USER`).
- **Hardware Isolation Guarantee:** If an EL0 thread attempts to access kernel DRAM or peripheral MMIO, the ARM64 MMU traps a **Permission Fault (AP[6]=0)**, preventing userland code from reading or writing supervisor memory.

### 3.2 Process Handle Table Isolation

PravahOS implements per-process capability isolation conforming to the Zircon capability model:
- Processes **do not** share a flat handle table.
- Each process has an isolated table: `process_handle_table_t` with 64 slots.
- Process-local handle descriptors are encoded as:
  $$\text{Handle} = ((\text{index} + 1) \ll 8) \mid (\text{generation} \ \& \ \text{0xFF})$$
- When a process calls a syscall with handle `0x101`, the microkernel validates that:
  1. Slot index `0` is in use.
  2. The generation matches (guards against stale/use-after-free handles).
  3. The handle has the required capability rights (`ZX_RIGHT_READ`, `ZX_RIGHT_WRITE`, etc.).
  4. The global capability object is resolved securely.

### 3.3 Thread Control Block (TCB) & User Stack Allocation

Threads are represented by `thread_t`:

```c
typedef struct thread {
    zx_koid_t        koid;
    char             name[ZX_MAX_NAME_LEN];
    thread_state_t   state;
    process_t        *process;
    zx_vaddr_t       user_stack_base;
    size_t           user_stack_size;
    zx_vaddr_t       entry_point;
    thread_context_t context;
} thread_t;
```

#### Stack Allocation
- `zx_thread_create` allocates a **64 KiB user stack** (`DEFAULT_USER_STACK_SIZE`).
- Placed immediately below `0x0000_0000_0080_0000` (`DEFAULT_USER_STACK_TOP`).
- Pages are allocated via PMM and mapped with `VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_USER`.
- The user stack pointer `SP_EL0` is initialized to `0x00800000` (ARM64 stacks grow downward, 16-byte aligned).

---

## 4. Low-Level ARM64 Context Switch (`arch/arm64/switch.S`)

### 4.1 Dropping from EL1 to EL0 (`arch_enter_user_space`)

Transitioning execution from the supervisor microkernel to an EL0 userland task is performed by `arch_enter_user_space`:

```assembly
arch_enter_user_space(entry_point, user_sp, arg0)
```

1. **Kernel Context Preservation:**
   - Callee-saved kernel registers (`x19 - x30`) and the active kernel stack pointer `SP_EL1` are stored on the kernel stack.
   - The kernel stack pointer is preserved in `kernel_saved_sp`.
2. **SPSR_EL1 Configuration:**
   - Clears `SPSR_EL1` to `0x00000000`.
   - `M[3:0] = 0b0000` selects **EL0t mode** (EL0 with dedicated SP_EL0).
   - Interrupt mask bits (`D, A, I, F = 0`) unmask all CPU interrupts.
3. **Register Staging:**
   - Sets `SP_EL0 = user_sp` (`0x00800000`).
   - Sets `ELR_EL1 = entry_point` (`0x00400000`).
   - Loads `x0 = arg0` (passes bootstrap channel handle or argument to user entry point).
   - Zeroes all other general-purpose scratch registers (`x1 - x18, x29, x30`) to avoid leaking kernel register state to userland.
4. **Exception Return:**
   - Executes `isb` followed by `eret`.
   - The ARM64 CPU atomically switches execution state from EL1 to EL0, sets `PC = ELR_EL1`, and begins running user instructions.

---

## 5. Syscall Architecture & Dispatch (`switch.S`, `syscall.c`)

### 5.1 Trapping `svc #0` from EL0

When an EL0 task executes `svc #0`:
1. The hardware switches from EL0 to EL1 and points `SP` to the EL1 kernel stack (`SP_EL1`).
2. The hardware saves `PC` in `ELR_EL1` and `PSTATE` in `SPSR_EL1`.
3. The processor branches to the vector table at offset `0x400` (`Lower EL using AArch64`):
   ```assembly
   /* boot.S */
   .balign 128
   b arm64_el0_sync_entry
   ```

### 5.2 Exception Syndrome Verification & Frame Preservation

In `arm64_el0_sync_entry`:
1. Allocates a 272-byte `arm64_iframe_t` frame on the kernel stack:
   - Saves `x0 - x30`
   - Reads and saves `SP_EL0`, `ELR_EL1`, and `SPSR_EL1`
2. Reads Exception Syndrome Register `ESR_EL1`:
   - Extracts Exception Class `EC = ESR_EL1[31:26]`
   - If `EC == 0x15` (0b010101): Valid `SVC` instruction in AArch64 state!
   - If `EC != 0x15`: Synchronous fault (data abort, instruction abort, permission fault) $\to$ dispatches to `kernel_exception_handler`.

### 5.3 Zircon Syscall Calling Convention

PravahOS implements the standardized ARM64 Zircon syscall ABI:

| Register | Role |
| :--- | :--- |
| `x16` (or `x8`) | **Syscall Number / Ordinal** |
| `x0` | Argument 0 / Return Status (`zx_status_t`) |
| `x1` | Argument 1 |
| `x2` | Argument 2 |
| `x3` | Argument 3 |
| `x4` | Argument 4 |
| `x5` | Argument 5 |

### 5.4 Implemented Zircon Syscalls Table

| Syscall Ordinal | Name | Function Signature | Description |
| :---: | :--- | :--- | :--- |
| **1** | `zx_process_exit` | `void zx_process_exit(int64_t ret_code)` | Terminates calling process and all threads |
| **2** | `zx_process_create` | `zx_status_t zx_process_create(...)` | Creates a new isolated process |
| **3** | `zx_process_start` | `zx_status_t zx_process_start(...)` | Starts execution of a process's initial thread |
| **4** | `zx_thread_create` | `zx_status_t zx_thread_create(...)` | Creates a new thread in a target process |
| **5** | `zx_thread_start` | `zx_status_t zx_thread_start(...)` | Starts a thread at a given entry point and stack |
| **6** | `zx_thread_exit` | `void zx_thread_exit(void)` | Terminates current thread |
| **7** | `zx_vmo_create` | `zx_status_t zx_vmo_create(size, flags, out)` | Allocates a Virtual Memory Object |
| **8** | `zx_vmo_read` | `zx_status_t zx_vmo_read(vmo, buf, off, len, act)` | Reads payload bytes from a VMO |
| **9** | `zx_vmo_write` | `zx_status_t zx_vmo_write(vmo, buf, off, len, act)`| Writes payload bytes to a VMO |
| **10** | `zx_channel_create` | `zx_status_t zx_channel_create(flags, out0, out1)` | Creates bidirectional IPC channel pair |
| **11** | `zx_channel_write` | `zx_status_t zx_channel_write(...)` | Writes message and transfers capability handles |
| **12** | `zx_channel_read` | `zx_status_t zx_channel_read(...)` | Reads channel message and receives handles |
| **13** | `zx_handle_close` | `zx_status_t zx_handle_close(handle)` | Closes and releases capability handle |
| **14** | `zx_debug_write` | `zx_status_t zx_debug_write(buf, len)` | Emits string from EL0 directly to kernel UART |
| **15** | `zx_ticks_get` | `zx_ticks_t zx_ticks_get(void)` | Returns ARM64 physical counter (`CNTPCT_EL0`) |

### 5.5 Process Exit & Return to Kernel Context

When an EL0 process invokes `SYS_zx_process_exit(ret_code)`:
1. `sys_process_exit` records `proc->exit_code = ret_code`, marks `proc->state = PROCESS_STATE_TERMINATED`, and sets `proc_should_exit = 1`.
2. In `arm64_el0_sync_entry` (`switch.S`), after `bl arm64_syscall_dispatcher`, `proc_should_exit` is checked.
3. If asserted:
   - Restores the saved kernel stack pointer `SP_EL1` from `kernel_saved_sp`.
   - Restores kernel callee-saved registers (`x19 - x30`).
   - Places `exit_code` into `x0`.
   - Executes `ret` to return cleanly to the kernel caller of `arch_enter_user_space`.

---

## 6. Verification & Self-Test Architecture (`main.c`)

The test suite in `kernel/main.c` executes two comprehensive test suites validating the entire process and userland execution pipeline:

### 6.1 Test Suite 7: ELF64 Parser & Program Headers

```
--- [Test Suite 7: ELF64 Binary Parser & Program Headers] ---
  [PASS] ELF64 Header Identification: Magic (\x7fELF), Class (64-bit), Endian (LE), Machine (AArch64)
  [PASS] Program Header Extraction: PT_LOAD at 0x00400000 (R|W|X, User), Entry Point: 0x00400000
  [PASS] Robust Error Rejection: Corrupted Magic and Invalid Architecture Rejected
```

### 6.2 Test Suite 8: Process Creation, Handle Isolation & EL0 Execution

```
--- [Test Suite 8: Process Creation, Handle Isolation & EL0 Execution] ---
  [PASS] Process Created: "userland_test_task" (Process Handle: 0x00001002)
  [PASS] Thread Created: "init_thread" (Thread Handle: 0x00002002, Stack: 64 KiB at SP_EL0: 0x00800000)
  [PASS] Process Handle Table Isolation: 2 process-scoped descriptors bound
  [PASS] ELF64 Image Loaded into User Address Space (Entry: 0x00400000, Segments Mapped)
  [PASS] Process Initial Thread Configured (PC: 0x00400000, SP: 0x00800000, SPSR_EL1: EL0t)
  * Transitioning CPU Execution Level: EL1 (Kernel) -> EL0 (Userland)...
  [USERLAND EL0] Hello from EL0 Userspace! Syscall SVC #0 execution active.
  [PASS] Userland EL0 Execution Round-Trip Confirmed: Syscall svc #0 Handled, Exit Code: 42
```

---

## 7. File Manifest

The following files constitute the Process Loader & Userland EL0 Execution Subsystem:

- [`kernel/include/kernel/elf.h`](file:///l:/projectz/OS/kernel/include/kernel/elf.h): Standard ELF64 headers, program headers, and parser prototypes.
- [`kernel/process/elf.c`](file:///l:/projectz/OS/kernel/process/elf.c): ELF64 magic validator, segment analyzer, and VMM user memory loader.
- [`kernel/include/kernel/process.h`](file:///l:/projectz/OS/kernel/include/kernel/process.h): Process control block, process lifecycle states, and handle table isolation.
- [`kernel/include/kernel/thread.h`](file:///l:/projectz/OS/kernel/include/kernel/thread.h): Thread control block, ARM64 thread context, and user stack allocation.
- [`kernel/include/kernel/syscall.h`](file:///l:/projectz/OS/kernel/include/kernel/syscall.h): Zircon syscall numbers and trap frame definition (`arm64_iframe_t`).
- [`kernel/process/process.c`](file:///l:/projectz/OS/kernel/process/process.c): `zx_process_create`, `zx_process_start`, process handle table operations.
- [`kernel/process/thread.c`](file:///l:/projectz/OS/kernel/process/thread.c): `zx_thread_create`, `zx_thread_start`, user stack allocation.
- [`kernel/process/syscall.c`](file:///l:/projectz/OS/kernel/process/syscall.c): Zircon syscall dispatcher and implementation of `sys_debug_write` and `sys_process_exit`.
- [`kernel/arch/arm64/switch.S`](file:///l:/projectz/OS/kernel/arch/arm64/switch.S): `arch_enter_user_space` (EL1 $\to$ EL0), `arm64_el0_sync_entry` (EL0 $\to$ EL1 trap), and kernel context switch.
- [`kernel/arch/arm64/boot.S`](file:///l:/projectz/OS/kernel/arch/arm64/boot.S): Vector table entry at offset 0x400 routed to `arm64_el0_sync_entry`.
- [`kernel/include/kernel/vmm.h`](file:///l:/projectz/OS/kernel/include/kernel/vmm.h) & [`kernel/mm/vmm.c`](file:///l:/projectz/OS/kernel/mm/vmm.c): User address space creation (`vmm_aspace_t`), per-process L0 translation tables, and TTBR0 switching.
- [`kernel/main.c`](file:///l:/projectz/OS/kernel/main.c): Early process spawning self-tests (Test Suite 7 & 8).
- [`kernel/Makefile`](file:///l:/projectz/OS/kernel/Makefile) & [`kernel/CMakeLists.txt`](file:///l:/projectz/OS/kernel/CMakeLists.txt): Build targets updated with `process/` sources and `switch.S`.
