/**
 * @file syscall.c
 * @brief PravahOS Zircon-Compatible System Call Dispatcher & Implementation.
 */

#include "kernel/syscall.h"
#include "kernel/process.h"
#include "kernel/thread.h"
#include "kernel/vmm.h"
#include "kernel/vmo.h"
#include "kernel/channel.h"
#include "kernel/handle.h"
#include "arch/arm64/arch.h"
#include "arch/arm64/uart_pl011.h"

/* Execution state tracking for user process return */
volatile int     proc_should_exit = 0;
volatile int64_t proc_exit_code = 0;

/**
 * @brief Validate that an EL0 userspace pointer range strictly resides within
 * the canonical user address space and does not overflow or touch kernel memory.
 */
static inline bool validate_user_ptr(const void *ptr, size_t len) {
    if (!ptr) {
        return false;
    }
    uintptr_t addr = (uintptr_t)ptr;
    /* Boundary check: must be in user virtual address space */
    if (addr < USER_ASPACE_BASE) {
        return false;
    }
    /* Integer overflow protection */
    if (addr + len < addr) {
        return false;
    }
    /* Must not exceed the top of userspace address range */
    if (addr + len > (USER_ASPACE_BASE + USER_ASPACE_SIZE)) {
        return false;
    }
    return true;
}

/**
 * @brief Syscall: zx_debug_write
 *
 * Direct microkernel debug console output from EL0 userland.
 */
static zx_status_t sys_debug_write(const char *user_buffer, size_t size) {
    if (!validate_user_ptr(user_buffer, size)) {
        return ZX_ERR_INVALID_ARGS;
    }

    for (size_t i = 0; i < size; i++) {
        uart_putc(user_buffer[i]);
    }

    return ZX_OK;
}

/**
 * @brief Syscall: zx_process_exit
 *
 * Terminate calling user process.
 */
static void sys_process_exit(int64_t ret_code) {
    process_t *cur = process_get_current();
    if (cur) {
        process_exit(cur, ret_code);
    }

    proc_should_exit = 1;
    proc_exit_code = ret_code;
}

int64_t arm64_syscall_dispatcher(
    uint64_t syscall_num,
    uint64_t arg0,
    uint64_t arg1,
    uint64_t arg2,
    uint64_t arg3,
    uint64_t arg4,
    uint64_t arg5,
    arm64_iframe_t *frame
) {
    (void)arg4;
    (void)arg5;
    (void)frame;

    switch (syscall_num) {
        case SYS_zx_debug_write:
            return (int64_t)sys_debug_write((const char *)arg0, (size_t)arg1);

        case SYS_zx_process_exit:
            sys_process_exit((int64_t)arg0);
            return 0;

        case SYS_zx_process_create:
            if (arg1 != 0 && !validate_user_ptr((const void *)arg1, (size_t)arg2)) return ZX_ERR_INVALID_ARGS;
            if (!validate_user_ptr((const void *)arg4, sizeof(zx_handle_t))) return ZX_ERR_INVALID_ARGS;
            if (!validate_user_ptr((const void *)arg5, sizeof(zx_handle_t))) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_process_create(
                (zx_handle_t)arg0,
                (const char *)arg1,
                (size_t)arg2,
                (uint32_t)arg3,
                (zx_handle_t *)arg4,
                (zx_handle_t *)arg5
            );

        case SYS_zx_process_start:
            if (arg2 >= (USER_ASPACE_BASE + USER_ASPACE_SIZE)) return ZX_ERR_INVALID_ARGS;
            if (arg3 >= (USER_ASPACE_BASE + USER_ASPACE_SIZE)) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_process_start(
                (zx_handle_t)arg0,
                (zx_handle_t)arg1,
                (zx_vaddr_t)arg2,
                (zx_vaddr_t)arg3,
                (zx_handle_t)arg4,
                (uint64_t)arg5
            );

        case SYS_zx_thread_create:
            if (arg1 != 0 && !validate_user_ptr((const void *)arg1, (size_t)arg2)) return ZX_ERR_INVALID_ARGS;
            if (!validate_user_ptr((const void *)arg4, sizeof(zx_handle_t))) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_thread_create(
                (zx_handle_t)arg0,
                (const char *)arg1,
                (size_t)arg2,
                (uint32_t)arg3,
                (zx_handle_t *)arg4
            );

        case SYS_zx_thread_start:
            if (arg1 >= (USER_ASPACE_BASE + USER_ASPACE_SIZE)) return ZX_ERR_INVALID_ARGS;
            if (arg2 >= (USER_ASPACE_BASE + USER_ASPACE_SIZE)) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_thread_start(
                (zx_handle_t)arg0,
                (zx_vaddr_t)arg1,
                (zx_vaddr_t)arg2,
                (uint64_t)arg3,
                (uint64_t)arg4
            );

        case SYS_zx_thread_exit:
            return (int64_t)thread_exit();

        case SYS_zx_vmo_create:
            if (!validate_user_ptr((const void *)arg2, sizeof(zx_handle_t))) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_vmo_create((uint64_t)arg0, (uint32_t)arg1, (zx_handle_t *)arg2);

        case SYS_zx_vmo_read:
            if (!validate_user_ptr((const void *)arg1, (size_t)arg3)) return ZX_ERR_INVALID_ARGS;
            if (arg4 != 0 && !validate_user_ptr((const void *)arg4, sizeof(size_t))) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_vmo_read(
                (zx_handle_t)arg0,
                (void *)arg1,
                (uint64_t)arg2,
                (size_t)arg3,
                (size_t *)arg4
            );

        case SYS_zx_vmo_write:
            if (!validate_user_ptr((const void *)arg1, (size_t)arg3)) return ZX_ERR_INVALID_ARGS;
            if (arg4 != 0 && !validate_user_ptr((const void *)arg4, sizeof(size_t))) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_vmo_write(
                (zx_handle_t)arg0,
                (const void *)arg1,
                (uint64_t)arg2,
                (size_t)arg3,
                (size_t *)arg4
            );

        case SYS_zx_channel_create:
            if (!validate_user_ptr((const void *)arg1, sizeof(zx_handle_t))) return ZX_ERR_INVALID_ARGS;
            if (!validate_user_ptr((const void *)arg2, sizeof(zx_handle_t))) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_channel_create((uint32_t)arg0, (zx_handle_t *)arg1, (zx_handle_t *)arg2);

        case SYS_zx_channel_write:
            if (arg3 > 0 && !validate_user_ptr((const void *)arg2, (size_t)arg3)) return ZX_ERR_INVALID_ARGS;
            if (arg5 > 0 && !validate_user_ptr((const void *)arg4, (size_t)arg5 * sizeof(zx_handle_t))) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_channel_write(
                (zx_handle_t)arg0,
                (uint32_t)arg1,
                (const void *)arg2,
                (uint32_t)arg3,
                (const zx_handle_t *)arg4,
                (uint32_t)arg5
            );

        case SYS_zx_channel_read:
            if (arg4 > 0 && !validate_user_ptr((const void *)arg2, (size_t)arg4)) return ZX_ERR_INVALID_ARGS;
            if (arg5 > 0 && !validate_user_ptr((const void *)arg3, (size_t)arg5 * sizeof(zx_handle_t))) return ZX_ERR_INVALID_ARGS;
            if (arg6 != 0 && !validate_user_ptr((const void *)arg6, sizeof(uint32_t))) return ZX_ERR_INVALID_ARGS;
            if (arg7 != 0 && !validate_user_ptr((const void *)arg7, sizeof(uint32_t))) return ZX_ERR_INVALID_ARGS;
            return (int64_t)zx_channel_read(
                (zx_handle_t)arg0,
                (uint32_t)arg1,
                (void *)arg2,
                (zx_handle_t *)arg3,
                (uint32_t)arg4,
                (uint32_t)arg5,
                (uint32_t *)arg6,
                (uint32_t *)arg7
            );

        case SYS_zx_handle_close:
            return (int64_t)handle_close((zx_handle_t)arg0);

        case SYS_zx_ticks_get:
            return (int64_t)arm64_read_pct();

        default:
            uart_puts("[SYSCALL] Unknown syscall trapped: #");
            uart_write_dec((uint32_t)syscall_num);
            uart_puts("\n");
            return ZX_ERR_NOT_SUPPORTED;
    }
}
