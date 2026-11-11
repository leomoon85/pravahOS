/**
 * @file boot.S
 * @brief Early ARM64 boot stub, exception level setup, and vector table.
 */

.section ".text.boot", "ax"
.global _start

_start:
    /*
     * Boot Entry State:
     * x0: Device Tree Blob (DTB) physical address (or 0)
     * x1: 0 (reserved)
     * x2: 0 (reserved)
     * x3: 0 (reserved)
     *
     * Preserve x0-x3 in callee-saved registers x19-x22 across EL switch.
     */
    mov x19, x0
    mov x20, x1
    mov x21, x2
    mov x22, x3

    /* Check Current Exception Level */
    mrs x0, CurrentEL
    lsr x0, x0, #2
    cmp x0, #3
    b.eq from_el3
    cmp x0, #2
    b.eq from_el2
    b el1_entry

from_el3:
    /* Configure EL3 to EL2 transition if started at EL3 */
    mov x0, #(1 << 10)          /* RW bit: EL2 is AArch64 */
    orr x0, x0, #(1 << 0)       /* NS bit: Non-Secure */
    msr scr_el3, x0
    mov x0, #0b01001            /* SPSR_EL3: EL2h, interrupts masked */
    msr spsr_el3, x0
    adr x0, from_el2
    msr elr_el3, x0
    eret

from_el2:
    /*
     * Configure EL2 to EL1 transition:
     * - Enable AArch64 execution state in EL1 (HCR_EL2.RW = 1)
     * - Route physical counter/timer access to EL1 (CNTHCTL_EL2)
     * - Zero virtual timer offset (CNTVOFF_EL2)
     */
    mov x0, #(1 << 31)          /* HCR_EL2.RW = 1 (AArch64 EL1) */
    msr hcr_el2, x0

    /* Allow EL1 and EL0 access to physical counter/timer */
    mrs x0, cnthctl_el2
    orr x0, x0, #(1 << 0)       /* EL1PCTEN */
    orr x0, x0, #(1 << 1)       /* EL1PCEN */
    msr cnthctl_el2, x0
    msr cntvoff_el2, xzr

    /* SPSR_EL2 setup: EL1h mode with all DAIF interrupts masked */
    mov x0, #0x3c5              /* 0b0011_1100_0101: DAIF masked, EL1h */
    msr spsr_el2, x0

    adr x0, el1_entry
    msr elr_el2, x0
    eret

el1_entry:
    /*
     * Running in EL1:
     * Ensure SCTLR_EL1 MMU and caches are in a known safe state.
     */
    mrs x0, sctlr_el1
    bic x0, x0, #(1 << 0)       /* Disable MMU */
    bic x0, x0, #(1 << 2)       /* Disable Data Cache */
    bic x0, x0, #(1 << 12)      /* Disable Instruction Cache */
    msr sctlr_el1, x0
    isb

    /* Enable Advanced SIMD and Floating-Point in EL1 and EL0 */
    mov x0, #(3 << 20)          /* CPACR_EL1.FPEN = 0b11 (No trapping) */
    msr cpacr_el1, x0
    isb

    /* Install Early Exception Vector Table */
    adr x0, vectors
    msr vbar_el1, x0
    isb

    /* Zero out the BSS section */
    ldr x1, =__bss_start
    ldr x2, =__bss_end
    mov x3, #0
bss_zero_loop:
    cmp x1, x2
    b.ge bss_done
    str x3, [x1], #8
    b bss_zero_loop

bss_done:
    /* Setup Boot Stack Pointer */
    ldr x0, =boot_stack_top
    mov sp, x0

    /* Restore DTB pointer and boot arguments into x0-x3 */
    mov x0, x19
    mov x1, x20
    mov x2, x21
    mov x3, x22

    /* Jump to kernel_main */
    bl kernel_main

halt_loop:
    wfe
    b halt_loop

/*
 * =========================================================================
 * Early Exception Vector Table
 * Must be aligned on a 2048-byte boundary.
 * Each entry is 128 bytes (32 instructions).
 * =========================================================================
 */
.balign 2048
.global vectors
vectors:
    /* Current EL with SP0 */
    .balign 128
    b exc_sync_invalid
    .balign 128
    b exc_irq_invalid
    .balign 128
    b exc_fiq_invalid
    .balign 128
    b exc_serror_invalid

    /* Current EL with SPx (Active kernel stack) */
    .balign 128
    b exc_sync_el1
    .balign 128
    b exc_irq_el1
    .balign 128
    b exc_fiq_el1
    .balign 128
    b exc_serror_el1

    /* Lower EL using AArch64 */
    .balign 128
    b exc_sync_el0_64
    .balign 128
    b exc_irq_el0_64
    .balign 128
    b exc_fiq_el0_64
    .balign 128
    b exc_serror_el0_64

    /* Lower EL using AArch32 */
    .balign 128
    b exc_sync_el0_32
    .balign 128
    b exc_irq_el0_32
    .balign 128
    b exc_fiq_el0_32
    .balign 128
    b exc_serror_el0_32

/*
 * Exception Handler Stubs:
 * Save essential registers and call kernel exception dispatcher or halt.
 */
exc_sync_invalid:
exc_irq_invalid:
exc_fiq_invalid:
exc_serror_invalid:
exc_sync_el1:
exc_irq_el1:
exc_fiq_el1:
exc_serror_el1:
exc_sync_el0_64:
exc_irq_el0_64:
exc_fiq_el0_64:
exc_serror_el0_64:
exc_sync_el0_32:
exc_irq_el0_32:
exc_fiq_el0_32:
exc_serror_el0_32:
    /* Read Exception Syndrome Register and Fault Address */
    mrs x0, esr_el1
    mrs x1, far_el1
    mrs x2, elr_el1
    bl kernel_exception_handler
1:  wfe
    b 1b
