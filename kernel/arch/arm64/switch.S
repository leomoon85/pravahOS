/**
 * @file switch.S
 * @brief PravahOS Low-Level ARM64 Context Switch & EL0 Exception Entry.
 *
 * Implements arch_enter_user_space (EL1 -> EL0 transition) and
 * arm64_el0_sync_entry (EL0 -> EL1 syscall dispatch).
 */

.section ".data"
.balign 16
.global kernel_saved_sp
kernel_saved_sp:
    .quad 0

.section ".text", "ax"

/*
 * =========================================================================
 * arch_enter_user_space:
 * Drops CPU from EL1 (Kernel) to EL0 (Userland).
 *
 * Parameters:
 *   x0: entry_point (ELR_EL1)
 *   x1: user_sp     (SP_EL0)
 *   x2: arg0        (passed to userland entry in x0)
 *
 * Return:
 *   x0: Process exit code when SYS_zx_process_exit terminates the process.
 * =========================================================================
 */
.global arch_enter_user_space
.type arch_enter_user_space, %function
arch_enter_user_space:
    /* 1. Save Kernel Callee-Saved Registers on Kernel Stack (EL1) */
    stp x19, x20, [sp, #-16]!
    stp x21, x22, [sp, #-16]!
    stp x23, x24, [sp, #-16]!
    stp x25, x26, [sp, #-16]!
    stp x27, x28, [sp, #-16]!
    stp x29, x30, [sp, #-16]!

    /* Save active kernel stack pointer for process exit return */
    mov x9, sp
    adrp x10, kernel_saved_sp
    str x9, [x10, :lo12:kernel_saved_sp]

    /* Reset process exit flag */
    adrp x10, proc_should_exit
    str wzr, [x10, :lo12:proc_should_exit]

    /* 2. Configure Return Program Status Register (SPSR_EL1)
     * Mode: EL0t (M[3:0] = 0b0000)
     * Interrupts: D=0, A=0, I=0, F=0 (Unmasked)
     */
    msr spsr_el1, xzr

    /* 3. Set User Stack Pointer (SP_EL0) and Entry Point (ELR_EL1) */
    msr sp_el0, x1
    msr elr_el1, x0

    /* 4. Pass arg0 into userland register x0 and clear scratch registers */
    mov x0, x2
    mov x1, xzr
    mov x2, xzr
    mov x3, xzr
    mov x4, xzr
    mov x5, xzr
    mov x6, xzr
    mov x7, xzr
    mov x8, xzr
    mov x9, xzr
    mov x10, xzr
    mov x11, xzr
    mov x12, xzr
    mov x13, xzr
    mov x14, xzr
    mov x15, xzr
    mov x16, xzr
    mov x17, xzr
    mov x18, xzr
    mov x29, xzr
    mov x30, xzr

    /* 5. Synchronize pipeline and execute Exception Return to EL0 */
    isb
    eret

/*
 * =========================================================================
 * arm64_el0_sync_entry:
 * Entry point for synchronous exceptions originating from Lower EL (EL0).
 * Invoked by vectors table offset 0x400 (exc_sync_el0_64).
 * =========================================================================
 */
.global arm64_el0_sync_entry
.type arm64_el0_sync_entry, %function
arm64_el0_sync_entry:
    /*
     * 1. Save entire user register frame on EL1 Kernel Stack.
     * Frame structure corresponds to arm64_iframe_t (272 bytes).
     */
    sub sp, sp, #272

    stp x0,  x1,  [sp, #0]
    stp x2,  x3,  [sp, #16]
    stp x4,  x5,  [sp, #32]
    stp x6,  x7,  [sp, #48]
    stp x8,  x9,  [sp, #64]
    stp x10, x11, [sp, #80]
    stp x12, x13, [sp, #96]
    stp x14, x15, [sp, #112]
    stp x16, x17, [sp, #128]
    stp x18, x19, [sp, #144]
    stp x20, x21, [sp, #160]
    stp x22, x23, [sp, #176]
    stp x24, x25, [sp, #192]
    stp x26, x27, [sp, #208]
    stp x28, x29, [sp, #224]
    str x30,      [sp, #240]

    mrs x9, sp_el0
    mrs x10, elr_el1
    stp x9, x10, [sp, #248]

    mrs x11, spsr_el1
    str x11, [sp, #264]

    /* 2. Check Exception Class in ESR_EL1 */
    mrs x9, esr_el1
    lsr x10, x9, #26         /* ESR_EL1.EC [31:26] */
    cmp x10, #0x15           /* 0x15: SVC instruction in AArch64 state */
    b.ne el0_not_syscall

    /*
     * 3. System Call Handling:
     * Syscall ordinal is passed in register x16 (or x8).
     * Arguments 0-5 are passed in x0-x5.
     */
    ldr x0, [sp, #128]       /* Frame x16 */
    cbnz x0, 1f
    ldr x0, [sp, #64]        /* Frame x8 */
1:
    ldr x1, [sp, #0]         /* arg0 (Frame x0) */
    ldr x2, [sp, #8]         /* arg1 (Frame x1) */
    ldr x3, [sp, #16]        /* arg2 (Frame x2) */
    ldr x4, [sp, #24]        /* arg3 (Frame x3) */
    ldr x5, [sp, #32]        /* arg4 (Frame x4) */
    ldr x6, [sp, #40]        /* arg5 (Frame x5) */
    mov x7, sp               /* Pointer to arm64_iframe_t */

    bl arm64_syscall_dispatcher

    /* Store return value into user's saved x0 */
    str x0, [sp, #0]

    /* Check if process has terminated (SYS_zx_process_exit) */
    adrp x10, proc_should_exit
    ldr w11, [x10, :lo12:proc_should_exit]
    cbnz w11, el0_process_exit_return

    /*
     * 4. Restore user register frame and return to EL0.
     */
    ldr x11, [sp, #264]
    msr spsr_el1, x11

    ldp x9, x10, [sp, #248]
    msr sp_el0, x9
    msr elr_el1, x10

    ldr x30,      [sp, #240]
    ldp x28, x29, [sp, #224]
    ldp x26, x27, [sp, #208]
    ldp x24, x25, [sp, #192]
    ldp x22, x23, [sp, #176]
    ldp x20, x21, [sp, #160]
    ldp x18, x19, [sp, #144]
    ldp x16, x17, [sp, #128]
    ldp x14, x15, [sp, #112]
    ldp x12, x13, [sp, #96]
    ldp x10, x11, [sp, #80]
    ldp x8,  x9,  [sp, #64]
    ldp x6,  x7,  [sp, #48]
    ldp x4,  x5,  [sp, #32]
    ldp x2,  x3,  [sp, #16]
    ldp x0,  x1,  [sp, #0]

    add sp, sp, #272
    eret

/*
 * Process termination return path:
 * Restores kernel execution context saved by arch_enter_user_space,
 * returning the exit code in x0.
 */
el0_process_exit_return:
    /* Load exit code */
    adrp x10, proc_exit_code
    ldr x0, [x10, :lo12:proc_exit_code]

    /* Restore kernel stack pointer */
    adrp x10, kernel_saved_sp
    ldr x9, [x10, :lo12:kernel_saved_sp]
    mov sp, x9

    /* Restore kernel callee-saved registers */
    ldp x29, x30, [sp], #16
    ldp x27, x28, [sp], #16
    ldp x25, x26, [sp], #16
    ldp x23, x24, [sp], #16
    ldp x21, x22, [sp], #16
    ldp x19, x20, [sp], #16

    ret

/*
 * Synchronous EL0 exception other than SVC (e.g. user page fault or undefined instruction)
 */
el0_not_syscall:
    mrs x0, esr_el1
    mrs x1, far_el1
    mrs x2, elr_el1
    bl kernel_exception_handler
1:  wfe
    b 1b
