/**
 * @file process.h
 * @brief PravahOS Zircon-Compatible Process Subsystem & Handle Table Isolation.
 */

#ifndef PRAVAH_KERNEL_PROCESS_H
#define PRAVAH_KERNEL_PROCESS_H

#include "types.h"
#include "handle.h"
#include "vmm.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ZX_MAX_NAME_LEN         32
#define MAX_PROCESS_HANDLES     64
#define MAX_PROCESSES           32

typedef enum {
    PROCESS_STATE_INITIAL = 0,
    PROCESS_STATE_RUNNING,
    PROCESS_STATE_SUSPENDED,
    PROCESS_STATE_TERMINATED
} process_state_t;

/**
 * @brief Process-isolated handle table entry.
 *
 * Each user process possesses an isolated handle descriptor namespace.
 * Process-local handle indices map to underlying global microkernel objects.
 */
typedef struct {
    zx_handle_t   global_handle; /* Reference to kernel object */
    zx_rights_t   rights;        /* Effective capability rights in this process */
    zx_obj_type_t type;          /* Capability type */
    uint32_t      generation;    /* Anti-reuse generation counter */
    bool          in_use;
} process_handle_entry_t;

typedef struct {
    process_handle_entry_t entries[MAX_PROCESS_HANDLES];
    size_t count;
} process_handle_table_t;

/* Forward declaration */
struct thread;

/**
 * @brief Microkernel Process Control Block (PCB).
 */
typedef struct process {
    zx_koid_t              koid;                 /* Unique kernel object ID */
    char                   name[ZX_MAX_NAME_LEN];/* Human-readable label */
    process_state_t        state;                /* Process lifecycle state */
    vmm_aspace_t           aspace;               /* Dedicated TTBR0 user address space */
    process_handle_table_t handle_table;         /* Isolated handle capability namespace */
    struct thread          *threads;             /* Linked list of threads in process */
    size_t                 thread_count;         /* Number of active threads */
    zx_vaddr_t             entry_point;          /* Virtual memory entry point */
    int64_t                exit_code;            /* Termination return code */
    bool                   in_use;               /* Allocation slot marker */
    struct process         *next;                /* Global list linkage */
} process_t;

/**
 * @brief Initialize the microkernel process management subsystem.
 */
void process_subsystem_init(void);

/**
 * @brief Create a new user process with an isolated VMM address space.
 *
 * @param job Parent job handle (or 0 for root/unparented).
 * @param name Process name string.
 * @param name_len Length of name string.
 * @param flags Creation flags.
 * @param[out] proc_handle Handle to created process.
 * @param[out] vmar_handle Root VMAR handle (currently mapped to process handle).
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_process_create(
    zx_handle_t job,
    const char *name,
    size_t name_len,
    uint32_t flags,
    zx_handle_t *proc_handle,
    zx_handle_t *vmar_handle
);

/**
 * @brief Start a process's initial thread at user entry point with user stack.
 *
 * @param proc_handle Process capability handle.
 * @param thread_handle Initial thread handle.
 * @param entry Userland entry point address (PC / ELR_EL1).
 * @param stack Userland stack top pointer (SP_EL0).
 * @param bootstrap_channel Optional capability channel handle passed in arg0.
 * @param arg1 Secondary boot argument passed in arg1.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_process_start(
    zx_handle_t proc_handle,
    zx_handle_t thread_handle,
    zx_vaddr_t entry,
    zx_vaddr_t stack,
    zx_handle_t bootstrap_channel,
    uint64_t arg1
);

/**
 * @brief Terminate a running process and mark all threads terminated.
 *
 * @param proc Target process.
 * @param ret_code Return/exit status code.
 * @return ZX_OK on success.
 */
zx_status_t process_exit(process_t *proc, int64_t ret_code);

/**
 * @brief Associate a capability handle with a process's isolated handle table.
 *
 * @param proc Target process.
 * @param global_handle Underlying microkernel capability handle.
 * @param rights Capability rights granted to this process.
 * @param type Object type identifier.
 * @param[out] out_local_handle Newly minted process-scoped handle.
 * @return ZX_OK on success, or ZX_ERR_NO_RESOURCES.
 */
zx_status_t process_handle_add(
    process_t *proc,
    zx_handle_t global_handle,
    zx_rights_t rights,
    zx_obj_type_t type,
    zx_handle_t *out_local_handle
);

/**
 * @brief Translate a process-local handle to its underlying global capability.
 *
 * @param proc Target process.
 * @param local_handle Process-local handle descriptor.
 * @param required_rights Required capability rights mask.
 * @param[out] out_global_handle Resolved global handle.
 * @return ZX_OK on success, or ZX_ERR_BAD_HANDLE / ZX_ERR_ACCESS_DENIED.
 */
zx_status_t process_handle_lookup(
    process_t *proc,
    zx_handle_t local_handle,
    zx_rights_t required_rights,
    zx_handle_t *out_global_handle
);

/**
 * @brief Close and release a handle from a process's local handle table.
 *
 * @param proc Target process.
 * @param local_handle Process-local handle to close.
 * @return ZX_OK on success, or ZX_ERR_BAD_HANDLE.
 */
zx_status_t process_handle_close(process_t *proc, zx_handle_t local_handle);

/**
 * @brief Get currently executing process on this CPU.
 */
process_t *process_get_current(void);

/**
 * @brief Set currently executing process on this CPU.
 */
void process_set_current(process_t *proc);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_PROCESS_H */
