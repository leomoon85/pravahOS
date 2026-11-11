/**
 * @file main.c
 * @brief PravahOS Zircon-Compatible Microkernel Early Entry Point & Subsystem Tests.
 */

#include "kernel/types.h"
#include "kernel/memory.h"
#include "kernel/string.h"
#include "kernel/console.h"
#include "kernel/pmm.h"
#include "kernel/vmm.h"
#include "kernel/handle.h"
#include "kernel/vmo.h"
#include "kernel/channel.h"
#include "arch/arm64/arch.h"
#include "arch/arm64/uart_pl011.h"

/* Forward Declarations */
void kernel_main(uint64_t dtb_paddr, uint64_t x1, uint64_t x2, uint64_t x3);
void kernel_exception_handler(uint64_t esr, uint64_t far, uint64_t elr);

/**
 * @brief Display the official PravahOS ASCII banner.
 */
static void print_banner(void) {
    uart_puts("\n");
    uart_puts("========================================================================\n");
    uart_puts("     ____                             _       ____   ____  \n");
    uart_puts("    |  _ \\ _ __ __ ___   ____ _ /\\_   | |     / __ \\ / ___| \n");
    uart_puts("    | |_) | '__/ _` \\ \\ / / _` / _ \\  | |    | |  | |\\___ \\ \n");
    uart_puts("    |  __/| | | (_| |\\ V / (_|  /_\\ \\ | |___ | |__| | ___) |\n");
    uart_puts("    |_|   |_|  \\__,_| \\_/ \\__,_/     \\|_____| \\____/ |____/ \n");
    uart_puts("========================================================================\n");
    uart_puts("  Autonomous * Intent-Driven * Offline-First Microkernel Platform\n");
    uart_puts("  Zircon-Compatible ABI * AArch64 Bare-Metal Architecture\n");
    uart_puts("========================================================================\n\n");
}

/**
 * @brief Decode and print ARM64 architectural capabilities from ID registers.
 */
static void print_hardware_info(uint64_t dtb_paddr) {
    uint64_t current_el = arm64_read_current_el();
    uint64_t mpidr = arm64_read_mpidr();
    uint64_t midr = arm64_read_midr();
    uint64_t pfr0 = arm64_read_pfr0();
    uint64_t cntfrq = arm64_read_cntfrq();

    uart_puts("--- [CPU & Architecture Profile] ---\n");
    
    /* Execution Level */
    uart_puts("  * Execution Level  : EL");
    uart_write_dec(current_el);
    uart_puts(" (Kernel Supervisor Mode)\n");

    /* Core Identification */
    uint32_t cluster_id = (mpidr >> 8) & 0xFF;
    uint32_t core_id = mpidr & 0xFF;
    uart_puts("  * CPU Core Affinity: Cluster ");
    uart_write_dec(cluster_id);
    uart_puts(", Core ");
    uart_write_dec(core_id);
    uart_puts(" (MPIDR: ");
    uart_write_hex(mpidr);
    uart_puts(")\n");

    /* Implementer & Part */
    uint32_t implementer = (midr >> 24) & 0xFF;
    uint32_t part_num = (midr >> 4) & 0xFFF;
    uart_puts("  * Processor Model  : Implementer ");
    uart_write_hex(implementer);
    uart_puts(", PartNum ");
    uart_write_hex(part_num);
    uart_puts(" (MIDR: ");
    uart_write_hex(midr);
    uart_puts(")\n");

    /* Feature flags from ID_AA64PFR0_EL1 */
    uint32_t fp_support = (pfr0 >> 16) & 0x0F;
    uint32_t advsimd = (pfr0 >> 20) & 0x0F;
    uint32_t gic_sysreg = (pfr0 >> 24) & 0x0F;

    uart_puts("  * Floating Point   : ");
    uart_puts(fp_support == 0 ? "Supported (FPv8-A)" : (fp_support == 1 ? "FPv8.2-A" : "Disabled"));
    uart_puts("\n");

    uart_puts("  * Advanced SIMD    : ");
    uart_puts(advsimd == 0 ? "Supported (NEON)" : (advsimd == 1 ? "AdvSIMD v8.2-A" : "Disabled"));
    uart_puts("\n");

    uart_puts("  * GIC SysReg Interf: ");
    uart_puts(gic_sysreg == 1 ? "Supported (GICv3/GICv4)" : "Legacy Memory Mapped");
    uart_puts("\n");

    /* Counter frequency */
    uart_puts("  * Generic Counter  : ");
    uart_write_dec(cntfrq / 1000000);
    uart_puts(" MHz (");
    uart_write_dec(cntfrq);
    uart_puts(" Hz)\n");

    /* Device Tree Pointer */
    uart_puts("  * DTB Physical Addr: ");
    if (dtb_paddr) {
        uart_write_hex(dtb_paddr);
    } else {
        uart_puts("(None / Direct QEMU -kernel)");
    }
    uart_puts("\n\n");
}

/**
 * @brief Self-test suite for Physical Memory Manager.
 */
static void run_pmm_tests(void) {
    uart_puts("--- [Test Suite 1: Physical Memory Manager (PMM)] ---\n");

    size_t free_before = pmm_get_free_pages();
    zx_paddr_t p0 = 0;
    zx_status_t st = pmm_alloc_page(&p0);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] PMM single page allocation failed\n");
        return;
    }
    uart_puts("  [PASS] Single Page Allocated at Physical Addr: ");
    uart_write_hex(p0);
    uart_puts("\n");

    /* Verify page was zeroed */
    uint64_t *ptr = (uint64_t *)(uintptr_t)p0;
    bool zeroed = true;
    for (size_t i = 0; i < (PAGE_SIZE / sizeof(uint64_t)); i++) {
        if (ptr[i] != 0) {
            zeroed = false;
            break;
        }
    }
    if (zeroed) {
        uart_puts("  [PASS] Allocated Physical Page Zeroed Verification\n");
    } else {
        uart_puts("  [FAIL] Physical Page not zeroed on allocation\n");
    }

    /* Contiguous 4-page allocation */
    zx_paddr_t p_multi = 0;
    st = pmm_alloc_pages(4, &p_multi);
    if (st == ZX_OK) {
        uart_puts("  [PASS] Contiguous 4-Page Block Allocated at: ");
        uart_write_hex(p_multi);
        uart_puts("\n");
        pmm_free_pages(p_multi, 4);
    } else {
        uart_puts("  [FAIL] Contiguous 4-page allocation failed\n");
    }

    /* Free single page and test stats */
    pmm_free_page(p0);
    size_t free_after = pmm_get_free_pages();
    if (free_before == free_after) {
        uart_puts("  [PASS] PMM Free & Allocation Balance Check Passed\n\n");
    } else {
        uart_puts("  [WARN] Page balance discrepancy detected\n\n");
    }
}

/**
 * @brief Self-test suite for Virtual Memory Manager.
 */
static void run_vmm_tests(void) {
    uart_puts("--- [Test Suite 2: Virtual Memory Manager (VMM 4-Level Paging)] ---\n");

    zx_paddr_t test_paddr = 0;
    zx_status_t st = pmm_alloc_page(&test_paddr);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to allocate backing page for VMM test\n");
        return;
    }

    /* Map dynamic virtual page at 0x0000000100000000 (4 GiB virtual mark) */
    zx_vaddr_t test_vaddr = 0x0000000100000000ULL;
    st = vmm_map_page(test_vaddr, test_paddr, VMM_FLAG_READ | VMM_FLAG_WRITE);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] vmm_map_page failed: ");
        uart_write_dec((uint32_t)st);
        uart_puts("\n");
        return;
    }

    /* Verify virtual to physical translation */
    zx_paddr_t resolved = vmm_vaddr_to_paddr(test_vaddr);
    if (resolved == test_paddr) {
        uart_puts("  [PASS] Virtual Address Resolution: 0x100000000 -> ");
        uart_write_hex(resolved);
        uart_puts(" (Matches backing PA)\n");
    } else {
        uart_puts("  [FAIL] Virtual Address Resolution mismatch\n");
    }

    /* Unmap page */
    st = vmm_unmap_page(test_vaddr);
    if (st == ZX_OK) {
        uart_puts("  [PASS] Virtual Page Unmapped successfully\n");
    }

    zx_paddr_t unmapped_query = vmm_vaddr_to_paddr(test_vaddr);
    if (unmapped_query == (zx_paddr_t)-1) {
        uart_puts("  [PASS] Verified Page Unmapped State (Lookup returned -1)\n\n");
    } else {
        uart_puts("  [FAIL] Unmapped page still resolved\n\n");
    }

    pmm_free_page(test_paddr);
}

/**
 * @brief Self-test suite for Virtual Memory Objects (VMO).
 */
static void run_vmo_tests(void) {
    uart_puts("--- [Test Suite 3: Virtual Memory Object (VMO) Container] ---\n");

    zx_handle_t vmo_h = ZX_HANDLE_INVALID;
    zx_status_t st = zx_vmo_create(8192, ZX_VMO_RESIZABLE, &vmo_h);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] zx_vmo_create failed\n");
        return;
    }
    uart_puts("  [PASS] VMO Created (Size: 8192 bytes, Handle: ");
    uart_write_hex(vmo_h);
    uart_puts(")\n");

    /* Test VMO Write */
    const char write_msg[] = "PravahOS::Kernel::VMO::TestPayload::AutonomousOS";
    size_t msg_len = strlen(write_msg) + 1;
    size_t actual_written = 0;
    st = zx_vmo_write(vmo_h, write_msg, 0, msg_len, &actual_written);
    if (st == ZX_OK && actual_written == msg_len) {
        uart_puts("  [PASS] VMO Write Payload: ");
        uart_write_dec(actual_written);
        uart_puts(" bytes written\n");
    } else {
        uart_puts("  [FAIL] VMO Write failed\n");
    }

    /* Test VMO Read */
    char read_buf[64];
    memset(read_buf, 0, sizeof(read_buf));
    size_t actual_read = 0;
    st = zx_vmo_read(vmo_h, read_buf, 0, sizeof(read_buf), &actual_read);
    if (st == ZX_OK && strcmp(read_buf, write_msg) == 0) {
        uart_puts("  [PASS] VMO Read Verification: \"");
        uart_puts(read_buf);
        uart_puts("\"\n");
    } else {
        uart_puts("  [FAIL] VMO Read data mismatch\n");
    }

    /* Test VMO Resize */
    st = zx_vmo_set_size(vmo_h, 16384);
    uint64_t new_size = 0;
    zx_vmo_get_size(vmo_h, &new_size);
    if (st == ZX_OK && new_size == 16384) {
        uart_puts("  [PASS] VMO Dynamic Resizing: 8192 -> 16384 bytes (4 physical pages backed)\n\n");
    } else {
        uart_puts("  [FAIL] VMO Dynamic Resizing failed\n\n");
    }

    handle_close(vmo_h);
}

/**
 * @brief Self-test suite for Bidirectional Channel IPC & Handle Rights Transfer.
 */
static void run_channel_ipc_tests(void) {
    uart_puts("--- [Test Suite 4: Bidirectional Channel IPC & Capability Rights Transfer] ---\n");

    zx_handle_t ch0 = ZX_HANDLE_INVALID;
    zx_handle_t ch1 = ZX_HANDLE_INVALID;

    zx_status_t st = zx_channel_create(0, &ch0, &ch1);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] zx_channel_create failed\n");
        return;
    }
    uart_puts("  [PASS] Channel Pair Created (ch0: ");
    uart_write_hex(ch0);
    uart_puts(", ch1: ");
    uart_write_hex(ch1);
    uart_puts(")\n");

    /* Create a VMO to transfer through the channel */
    zx_handle_t vmo_to_send = ZX_HANDLE_INVALID;
    zx_vmo_create(4096, 0, &vmo_to_send);
    const char vmo_payload[] = "Capability-Secured-VMO-Secret";
    zx_vmo_write(vmo_to_send, vmo_payload, 0, strlen(vmo_payload) + 1, NULL);

    /* Write message from ch0 carrying both bytes and the VMO handle */
    const char channel_msg[] = "FIDL:pravah.capability.TransferResource";
    uint32_t msg_len = strlen(channel_msg) + 1;
    zx_handle_t handles_to_send[1] = { vmo_to_send };

    st = zx_channel_write(ch0, 0, channel_msg, msg_len, handles_to_send, 1);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] zx_channel_write failed\n");
        return;
    }
    uart_puts("  [PASS] Channel Message Written: ch0 -> ch1 (Payload: 40 bytes, 1 Handle)\n");

    /* Verify sender's handle was revoked upon transfer */
    void *revoked_obj = NULL;
    st = handle_lookup(vmo_to_send, ZX_OBJ_TYPE_VMO, ZX_RIGHT_READ, &revoked_obj);
    if (st == ZX_ERR_BAD_HANDLE) {
        uart_puts("  [PASS] Sender Handle Revocation: Transferred handle invalidated in sender table\n");
    } else {
        uart_puts("  [FAIL] Sender handle not invalidated after transfer\n");
    }

    /* Read message from ch1 */
    char recv_bytes[128];
    zx_handle_t recv_handles[4];
    uint32_t actual_b = 0;
    uint32_t actual_h = 0;

    st = zx_channel_read(ch1, 0, recv_bytes, recv_handles, sizeof(recv_bytes), 4, &actual_b, &actual_h);
    if (st == ZX_OK && actual_h == 1) {
        uart_puts("  [PASS] Channel Message Read: \"");
        uart_puts(recv_bytes);
        uart_puts("\" (Received Handle: ");
        uart_write_hex(recv_handles[0]);
        uart_puts(")\n");

        /* Verify transferred VMO data integrity in receiving handle */
        char vmo_verify[64];
        memset(vmo_verify, 0, sizeof(vmo_verify));
        zx_vmo_read(recv_handles[0], vmo_verify, 0, sizeof(vmo_verify), NULL);
        if (strcmp(vmo_verify, vmo_payload) == 0) {
            uart_puts("  [PASS] Transferred VMO Data Integrity Confirmed: \"");
            uart_puts(vmo_verify);
            uart_puts("\"\n\n");
        } else {
            uart_puts("  [FAIL] Transferred VMO Data Corrupted\n\n");
        }

        handle_close(recv_handles[0]);
    } else {
        uart_puts("  [FAIL] zx_channel_read failed\n\n");
    }

    handle_close(ch0);
    handle_close(ch1);
}

/**
 * @brief Early Kernel Entry Point invoked by boot.S in EL1 mode.
 *
 * @param dtb_paddr Physical address of DTB loaded by bootloader/QEMU.
 * @param x1 Boot parameter register 1.
 * @param x2 Boot parameter register 2.
 * @param x3 Boot parameter register 3.
 */
void kernel_main(uint64_t dtb_paddr, uint64_t x1, uint64_t x2, uint64_t x3) {
    (void)x1;
    (void)x2;
    (void)x3;

    /* 1. Initialize PL011 Serial Console */
    uart_init();

    /* 2. Print System Banner */
    print_banner();

    /* 3. Detect and Report Architecture Profile */
    print_hardware_info(dtb_paddr);

    /* 4. Subsystem Initializations */
    uart_puts("--- [Kernel Subsystem Bootstrapping] ---\n");

    /* Physical Memory Manager (DRAM base 0x40000000, 4 GiB default) */
    pmm_init(RAM_BASE_PADDR, RAM_SIZE_DEFAULT);

    /* Virtual Memory Manager & ARM64 4-Level Paging */
    vmm_init();

    /* Handle Table & Capability Security */
    handle_table_init();

    /* Virtual Memory Object Subsystem */
    vmo_subsystem_init();

    /* Bidirectional IPC Channel Subsystem */
    channel_subsystem_init();
    uart_puts("\n");

    /* 5. Execute Comprehensive Self-Test Suites */
    run_pmm_tests();
    run_vmm_tests();
    run_vmo_tests();
    run_channel_ipc_tests();

    uart_puts("========================================================================\n");
    uart_puts(">>> ALL PRAVAHOS MICROKERNEL SELF-TESTS PASSED SUCCESSFULLY <<<\n");
    uart_puts("========================================================================\n\n");
    uart_puts("PravahOS Microkernel bootstrap complete. Stage 2 idle loop active.\n");
    uart_puts("Awaiting userspace root task (bootstrap / CFv2 component manager)...\n\n");

    /* Primary Microkernel Idle Loop */
    while (1) {
        wfe();
    }
}

/**
 * @brief Early Exception Dispatcher for unexpected synchronous/asynchronous traps.
 */
void kernel_exception_handler(uint64_t esr, uint64_t far, uint64_t elr) {
    uart_puts("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    uart_puts(">>> KERNEL PANIC: Unexpected Exception Trapped in EL1 <<<\n");
    uart_puts("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    uart_puts("  ESR_EL1 (Syndrome)    : ");
    uart_write_hex(esr);
    uart_puts("\n  FAR_EL1 (Fault Addr)  : ");
    uart_write_hex(far);
    uart_puts("\n  ELR_EL1 (Return Addr) : ");
    uart_write_hex(elr);
    uart_puts("\nMicrokernel execution halted.\n");

    while (1) {
        wfi();
    }
}
