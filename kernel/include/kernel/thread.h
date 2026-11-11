/**
 * @file thread.h
 * @brief PravahOS Microkernel Thread Subsystem & ARM64 Execution Context.
 */

#ifndef PRAVAH_KERNEL_THREAD_H
#define PRAVAH_KERNEL_THREAD_H

#include "types.h"
#include "handle.h"
#include "process.h"

#ifdef __cplusplus
extern "C" {
#endif

#define MAX_THREADS             64
#define DEFAULT_USER_STACK_SIZE (64 * 1024) /* 64 KiB user stack */
#define DEFAULT_USER_STACK_TOP  (0x0000000000800000ULL)

typedef enum {
    THREAD_STATE_INITIAL = 0,
    THREAD_STATE_READY,
    THREAD_STATE_RUNNING,
    THREAD_STATE_BLOCKED,
    THREAD_STATE_TERMINATED
} thread_state_t;

/**
 * @brief ARM64 Architectural Register Context for Thread Context Switching.
 */
typedef struct {
    uint64_t x[31];     /* General-purpose registers x0 - x30 (x29=FP, x30=LR) */
    uint64_t sp_el0;    /* Userland stack pointer (SP_EL0) */
    uint64_t elr_el1;   /* Exception Link Register / PC return address */
    uint64_t spsr_el1;  /* Saved Program Status Register (EL0t mode) */
    uint64_t tpidr_el0; /* Userland Thread-Local Storage (TLS) base */
} thread_context_t;

/**
 * @brief Microkernel Thread Control Block (TCB).
 */
typedef struct thread {
    zx_koid_t        koid;                  /* Thread unique identifier */
    char             name[ZX_MAX_NAME_LEN]; /* Human-readable label */
    thread_state_t   state;                 /* Execution state */
    process_t        *process;              /* Parent process owning address space */
    zx_vaddr_t       user_stack_base;       /* User stack lower address bound */
    size_t           user_stack_size;       /* User stack size in bytes */
    zx_vaddr_t       entry_point;           /* Userland entry virtual address */
    thread_context_t context;               /* Saved architectural CPU registers */
    bool             in_use;                /* Allocation slot indicator */
    struct thread    *next;                 /* Next thread in process list */
} thread_t;

/**
 * @brief Initialize the microkernel thread management subsystem.
 */
void thread_subsystem_init(void);

/**
 * @brief Create a new thread within a target process.
 *
 * Allocates user stack pages in the process address space, initializes context with
 * SP_EL0 and ELR_EL1.
 *
 * @param proc_handle Capability handle to target process.
 * @param name Thread name.
 * @param name_len Thread name length.
 * @param flags Thread creation flags.
 * @param[out] thread_handle Minted handle for newly created thread.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_thread_create(
    zx_handle_t proc_handle,
    const char *name,
    size_t name_len,
    uint32_t flags,
    zx_handle_t *thread_handle
);

/**
 * @brief Start a thread's execution at an entry point with an assigned stack.
 *
 * @param thread_handle Target thread capability handle.
 * @param entry Virtual address of entry point (ELR_EL1).
 * @param stack Virtual address of user stack top (SP_EL0).
 * @param arg0 Initial parameter passed in register x0.
 * @param arg1 Initial parameter passed in register x1.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_thread_start(
    zx_handle_t thread_handle,
    zx_vaddr_t entry,
    zx_vaddr_t stack,
    uint64_t arg0,
    uint64_t arg1
);

/**
 * @brief Terminate the currently executing thread.
 *
 * @return ZX_OK on success.
 */
zx_status_t thread_exit(void);

/**
 * @brief Get currently running thread on this CPU.
 */
thread_t *thread_get_current(void);

/**
 * @brief Set currently running thread on this CPU.
 */
void thread_set_current(thread_t *th);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_THREAD_H */
