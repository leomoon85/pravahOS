/**
 * @file process.c
 * @brief PravahOS Zircon-Compatible Process Implementation & Handle Table Isolation.
 */

#include "kernel/process.h"
#include "kernel/thread.h"
#include "kernel/pmm.h"
#include "kernel/string.h"
#include "arch/arm64/uart_pl011.h"

static process_t        process_pool[MAX_PROCESSES];
static process_t       *current_process = NULL;
static uint64_t         next_process_koid = 1000;

void process_subsystem_init(void) {
    for (size_t i = 0; i < MAX_PROCESSES; i++) {
        memset(&process_pool[i], 0, sizeof(process_t));
        process_pool[i].state = PROCESS_STATE_INITIAL;
        process_pool[i].in_use = false;
    }
    current_process = NULL;
    uart_puts("[PROCESS] Process Subsystem Initialized (Capacity: 32 isolated task spaces)\n");
}

process_t *process_get_current(void) {
    return current_process;
}

void process_set_current(process_t *proc) {
    current_process = proc;
    if (proc) {
        vmm_set_active_aspace(&proc->aspace);
    } else {
        vmm_set_active_aspace(NULL);
    }
}

zx_status_t zx_process_create(
    zx_handle_t job,
    const char *name,
    size_t name_len,
    uint32_t flags,
    zx_handle_t *proc_handle,
    zx_handle_t *vmar_handle
) {
    (void)job;
    (void)flags;

    if (!name || name_len == 0 || !proc_handle || !vmar_handle) {
        return ZX_ERR_INVALID_ARGS;
    }

    /* Allocate free PCB slot */
    process_t *proc = NULL;
    for (size_t i = 0; i < MAX_PROCESSES; i++) {
        if (!process_pool[i].in_use) {
            proc = &process_pool[i];
            break;
        }
    }

    if (!proc) {
        return ZX_ERR_NO_RESOURCES;
    }

    memset(proc, 0, sizeof(process_t));
    proc->in_use = true;
    proc->koid = next_process_koid++;
    proc->state = PROCESS_STATE_INITIAL;

    size_t copy_len = (name_len < ZX_MAX_NAME_LEN - 1) ? name_len : (ZX_MAX_NAME_LEN - 1);
    memcpy(proc->name, name, copy_len);
    proc->name[copy_len] = '\0';

    /* 1. Allocate dedicated VMM user address space (TTBR0) */
    zx_status_t status = vmm_aspace_create(&proc->aspace);
    if (status != ZX_OK) {
        proc->in_use = false;
        return status;
    }

    /* 2. Initialize isolated process handle table */
    for (size_t i = 0; i < MAX_PROCESS_HANDLES; i++) {
        proc->handle_table.entries[i].global_handle = ZX_HANDLE_INVALID;
        proc->handle_table.entries[i].rights = ZX_RIGHT_NONE;
        proc->handle_table.entries[i].type = ZX_OBJ_TYPE_NONE;
        proc->handle_table.entries[i].generation = 1;
        proc->handle_table.entries[i].in_use = false;
    }
    proc->handle_table.count = 0;

    /* 3. Mint global microkernel capability handle for this process */
    zx_rights_t proc_rights = ZX_RIGHT_DUPLICATE | ZX_RIGHT_TRANSFER | ZX_RIGHT_READ |
                              ZX_RIGHT_WRITE | ZX_RIGHT_EXECUTE | ZX_RIGHT_DESTROY |
                              ZX_RIGHT_GET_PROPERTY | ZX_RIGHT_SET_PROPERTY;

    zx_handle_t global_proc_h = ZX_HANDLE_INVALID;
    status = handle_create(proc, ZX_OBJ_TYPE_PROCESS, proc_rights, &global_proc_h);
    if (status != ZX_OK) {
        vmm_aspace_destroy(&proc->aspace);
        proc->in_use = false;
        return status;
    }

    /* Associate self-handle in process's isolated handle table */
    zx_handle_t local_h = ZX_HANDLE_INVALID;
    status = process_handle_add(proc, global_proc_h, proc_rights, ZX_OBJ_TYPE_PROCESS, &local_h);
    if (status != ZX_OK) {
        handle_close(global_proc_h);
        vmm_aspace_destroy(&proc->aspace);
        proc->in_use = false;
        return status;
    }

    *proc_handle = global_proc_h;
    *vmar_handle = global_proc_h; /* VMAR aliased to process capability in early microkernel */

    return ZX_OK;
}

zx_status_t zx_process_start(
    zx_handle_t proc_handle,
    zx_handle_t thread_handle,
    zx_vaddr_t entry,
    zx_vaddr_t stack,
    zx_handle_t bootstrap_channel,
    uint64_t arg1
) {
    void *obj = NULL;
    zx_status_t status = handle_lookup(proc_handle, ZX_OBJ_TYPE_PROCESS, ZX_RIGHT_WRITE, &obj);
    if (status != ZX_OK) return status;

    process_t *proc = (process_t *)obj;

    void *th_obj = NULL;
    status = handle_lookup(thread_handle, ZX_OBJ_TYPE_THREAD, ZX_RIGHT_WRITE, &th_obj);
    if (status != ZX_OK) return status;

    thread_t *thread = (thread_t *)th_obj;
    if (thread->process != proc) {
        return ZX_ERR_INVALID_ARGS;
    }

    /* Configure Thread Register Context for Userland Dropping */
    proc->entry_point = entry;
    thread->entry_point = entry;
    thread->context.elr_el1 = entry;
    thread->context.sp_el0 = stack;
    thread->context.spsr_el1 = 0; /* EL0t mode, interrupts enabled (DAIF=0) */
    thread->context.x[0] = bootstrap_channel;
    thread->context.x[1] = arg1;

    proc->state = PROCESS_STATE_RUNNING;
    thread->state = THREAD_STATE_RUNNING;

    return ZX_OK;
}

zx_status_t process_exit(process_t *proc, int64_t ret_code) {
    if (!proc) return ZX_ERR_INVALID_ARGS;

    proc->state = PROCESS_STATE_TERMINATED;
    proc->exit_code = ret_code;

    /* Mark all associated threads as terminated */
    thread_t *th = proc->threads;
    while (th) {
        th->state = THREAD_STATE_TERMINATED;
        th = th->next;
    }

    return ZX_OK;
}

/* ========================================================================= */
/* Process-Isolated Handle Table Operations                                  */
/* ========================================================================= */

zx_status_t process_handle_add(
    process_t *proc,
    zx_handle_t global_handle,
    zx_rights_t rights,
    zx_obj_type_t type,
    zx_handle_t *out_local_handle
) {
    if (!proc || !out_local_handle || global_handle == ZX_HANDLE_INVALID) {
        return ZX_ERR_INVALID_ARGS;
    }

    for (size_t i = 0; i < MAX_PROCESS_HANDLES; i++) {
        if (!proc->handle_table.entries[i].in_use) {
            proc->handle_table.entries[i].in_use = true;
            proc->handle_table.entries[i].global_handle = global_handle;
            proc->handle_table.entries[i].rights = rights;
            proc->handle_table.entries[i].type = type;
            proc->handle_table.entries[i].generation = (proc->handle_table.entries[i].generation + 1) & 0xFF;
            if (proc->handle_table.entries[i].generation == 0) {
                proc->handle_table.entries[i].generation = 1;
            }

            proc->handle_table.count++;

            /* Encode process-local handle: index in high bits, generation in low bits */
            *out_local_handle = (zx_handle_t)(((i + 1) << 8) | (proc->handle_table.entries[i].generation & 0xFF));
            return ZX_OK;
        }
    }

    return ZX_ERR_NO_RESOURCES;
}

zx_status_t process_handle_lookup(
    process_t *proc,
    zx_handle_t local_handle,
    zx_rights_t required_rights,
    zx_handle_t *out_global_handle
) {
    if (!proc || !out_global_handle || local_handle == ZX_HANDLE_INVALID) {
        return ZX_ERR_INVALID_ARGS;
    }

    size_t idx = (local_handle >> 8) - 1;
    uint32_t gen = local_handle & 0xFF;

    if (idx >= MAX_PROCESS_HANDLES) {
        return ZX_ERR_BAD_HANDLE;
    }

    process_handle_entry_t *entry = &proc->handle_table.entries[idx];
    if (!entry->in_use || entry->generation != gen) {
        return ZX_ERR_BAD_HANDLE;
    }

    if ((entry->rights & required_rights) != required_rights) {
        return ZX_ERR_ACCESS_DENIED;
    }

    *out_global_handle = entry->global_handle;
    return ZX_OK;
}

zx_status_t process_handle_close(process_t *proc, zx_handle_t local_handle) {
    if (!proc || local_handle == ZX_HANDLE_INVALID) {
        return ZX_ERR_INVALID_ARGS;
    }

    size_t idx = (local_handle >> 8) - 1;
    uint32_t gen = local_handle & 0xFF;

    if (idx >= MAX_PROCESS_HANDLES) {
        return ZX_ERR_BAD_HANDLE;
    }

    process_handle_entry_t *entry = &proc->handle_table.entries[idx];
    if (!entry->in_use || entry->generation != gen) {
        return ZX_ERR_BAD_HANDLE;
    }

    zx_handle_t gh = entry->global_handle;
    entry->in_use = false;
    entry->global_handle = ZX_HANDLE_INVALID;
    entry->rights = ZX_RIGHT_NONE;
    entry->type = ZX_OBJ_TYPE_NONE;

    if (proc->handle_table.count > 0) {
        proc->handle_table.count--;
    }

    /* Release reference in global handle table */
    return handle_close(gh);
}
