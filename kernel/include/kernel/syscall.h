/**
 * @file syscall.h
 * @brief PravahOS Zircon-Compatible Syscall Numbers & Trap Frame Definitions.
 */

#ifndef PRAVAH_KERNEL_SYSCALL_H
#define PRAVAH_KERNEL_SYSCALL_H

#include "types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Zircon Microkernel Syscall Identifiers (ARM64 Register x16 / x8) */
#define SYS_zx_process_exit         1
#define SYS_zx_process_create       2
#define SYS_zx_process_start        3
#define SYS_zx_thread_create        4
#define SYS_zx_thread_start         5
#define SYS_zx_thread_exit          6
#define SYS_zx_vmo_create           7
#define SYS_zx_vmo_read             8
#define SYS_zx_vmo_write            9
#define SYS_zx_channel_create       10
#define SYS_zx_channel_write        11
#define SYS_zx_channel_read         12
#define SYS_zx_handle_close         13
#define SYS_zx_debug_write          14
#define SYS_zx_ticks_get            15

/**
 * @brief Saved CPU Interrupt / Exception Frame on Kernel Stack (EL1).
 *
 * Pushed by low-level trap handler when entering EL1 from EL0.
 */
typedef struct arm64_iframe {
    uint64_t x[31];     /* General registers x0 through x30 */
    uint64_t sp_el0;    /* Userland stack pointer */
    uint64_t elr_el1;   /* Exception Link Register (trapped EL0 PC) */
    uint64_t spsr_el1;  /* Saved Program Status Register */
} arm64_iframe_t;

/**
 * @brief Dispatch a system call issued from EL0 userland via `svc #0`.
 *
 * @param syscall_num Syscall identifier passed in x16 (or x8).
 * @param arg0 First syscall argument (x0).
 * @param arg1 Second syscall argument (x1).
 * @param arg2 Third syscall argument (x2).
 * @param arg3 Fourth syscall argument (x3).
 * @param arg4 Fifth syscall argument (x4).
 * @param arg5 Sixth syscall argument (x5).
 * @param arg6 Seventh syscall argument (x6).
 * @param arg7 Eighth syscall argument (x7).
 * @param frame Pointer to trapped register frame on kernel stack.
 * @return Syscall return value (placed into frame->x[0]).
 */
int64_t arm64_syscall_dispatcher(
    uint64_t syscall_num,
    uint64_t arg0,
    uint64_t arg1,
    uint64_t arg2,
    uint64_t arg3,
    uint64_t arg4,
    uint64_t arg5,
    arm64_iframe_t *frame
);

/**
 * @brief Low-level transition from EL1 (Kernel) to EL0 (Userland).
 *
 * Configures SPSR_EL1 to EL0t (all interrupts unmasked, DAIF=0), sets SP_EL0 and ELR_EL1,
 * passes arg0 in x0, and issues `eret`.
 *
 * Returns when the user process exits (via SYS_zx_process_exit).
 *
 * @param entry_point Virtual address where EL0 user task begins.
 * @param user_sp Top of userland stack (16-byte aligned).
 * @param arg0 First argument passed to user entry point (register x0).
 * @return Process exit code.
 */
int64_t arch_enter_user_space(uint64_t entry_point, uint64_t user_sp, uint64_t arg0);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_SYSCALL_H */
