/**
 * @file thread.c
 * @brief PravahOS Microkernel Thread Subsystem & User Stack Allocation.
 */

#include "kernel/thread.h"
#include "kernel/process.h"
#include "kernel/pmm.h"
#include "kernel/vmm.h"
#include "kernel/string.h"
#include "arch/arm64/uart_pl011.h"

static thread_t  thread_pool[MAX_THREADS];
static thread_t *current_thread = NULL;
static uint64_t  next_thread_koid = 5000;

void thread_subsystem_init(void) {
    for (size_t i = 0; i < MAX_THREADS; i++) {
        memset(&thread_pool[i], 0, sizeof(thread_t));
        thread_pool[i].state = THREAD_STATE_INITIAL;
        thread_pool[i].in_use = false;
    }
    current_thread = NULL;
    uart_puts("[THREAD]  Thread Subsystem Initialized (Capacity: 64 execution contexts)\n");
}

thread_t *thread_get_current(void) {
    return current_thread;
}

void thread_set_current(thread_t *th) {
    current_thread = th;
    if (th && th->process) {
        process_set_current(th->process);
    }
}

zx_status_t zx_thread_create(
    zx_handle_t proc_handle,
    const char *name,
    size_t name_len,
    uint32_t flags,
    zx_handle_t *thread_handle
) {
    (void)flags;

    if (!name || name_len == 0 || !thread_handle) {
        return ZX_ERR_INVALID_ARGS;
    }

    void *obj = NULL;
    zx_status_t status = handle_lookup(proc_handle, ZX_OBJ_TYPE_PROCESS, ZX_RIGHT_WRITE, &obj);
    if (status != ZX_OK) {
        return status;
    }
    process_t *proc = (process_t *)obj;

    /* Allocate free TCB slot */
    thread_t *thread = NULL;
    for (size_t i = 0; i < MAX_THREADS; i++) {
        if (!thread_pool[i].in_use) {
            thread = &thread_pool[i];
            break;
        }
    }

    if (!thread) {
        return ZX_ERR_NO_RESOURCES;
    }

    memset(thread, 0, sizeof(thread_t));
    thread->in_use = true;
    thread->koid = next_thread_koid++;
    thread->state = THREAD_STATE_INITIAL;
    thread->process = proc;

    size_t copy_len = (name_len < ZX_MAX_NAME_LEN - 1) ? name_len : (ZX_MAX_NAME_LEN - 1);
    memcpy(thread->name, name, copy_len);
    thread->name[copy_len] = '\0';

    /*
     * Allocate Userland Stack in process's address space.
     * Default stack spans [0x00800000 - 64 KiB, 0x00800000).
     * Grows downward from SP_EL0 = 0x00800000.
     */
    zx_vaddr_t stack_top = DEFAULT_USER_STACK_TOP;
    size_t stack_size = DEFAULT_USER_STACK_SIZE;
    zx_vaddr_t stack_base = stack_top - stack_size;

    size_t stack_pages = stack_size / PAGE_SIZE;
    for (size_t p = 0; p < stack_pages; p++) {
        zx_paddr_t ppage = 0;
        status = pmm_alloc_page(&ppage);
        if (status != ZX_OK) {
            thread->in_use = false;
            return status;
        }

        memset((void *)(uintptr_t)ppage, 0, PAGE_SIZE);

        /* Map page in user address space with RW permissions for EL0 */
        status = vmm_aspace_map(&proc->aspace, stack_base + (p * PAGE_SIZE), ppage,
                                VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_USER);
        if (status != ZX_OK) {
            pmm_free_page(ppage);
            thread->in_use = false;
            return status;
        }
    }

    thread->user_stack_base = stack_base;
    thread->user_stack_size = stack_size;

    /* Initialize architectural context */
    thread->context.sp_el0 = stack_top;
    thread->context.spsr_el1 = 0; /* EL0t mode, interrupts unmasked */
    thread->context.elr_el1 = 0;

    /* Link thread into parent process thread list */
    thread->next = proc->threads;
    proc->threads = thread;
    proc->thread_count++;

    /* Mint global capability handle for thread */
    zx_rights_t th_rights = ZX_RIGHT_DUPLICATE | ZX_RIGHT_TRANSFER | ZX_RIGHT_READ |
                            ZX_RIGHT_WRITE | ZX_RIGHT_DESTROY | ZX_RIGHT_GET_PROPERTY |
                            ZX_RIGHT_SET_PROPERTY;

    zx_handle_t global_th_h = ZX_HANDLE_INVALID;
    status = handle_create(thread, ZX_OBJ_TYPE_THREAD, th_rights, &global_th_h);
    if (status != ZX_OK) {
        thread->in_use = false;
        return status;
    }

    /* Add thread handle into process's isolated handle table */
    zx_handle_t local_th_h = ZX_HANDLE_INVALID;
    process_handle_add(proc, global_th_h, th_rights, ZX_OBJ_TYPE_THREAD, &local_th_h);

    *thread_handle = global_th_h;
    return ZX_OK;
}

zx_status_t zx_thread_start(
    zx_handle_t thread_handle,
    zx_vaddr_t entry,
    zx_vaddr_t stack,
    uint64_t arg0,
    uint64_t arg1
) {
    void *obj = NULL;
    zx_status_t status = handle_lookup(thread_handle, ZX_OBJ_TYPE_THREAD, ZX_RIGHT_WRITE, &obj);
    if (status != ZX_OK) {
        return status;
    }

    thread_t *thread = (thread_t *)obj;
    thread->entry_point = entry;
    thread->context.elr_el1 = entry;
    if (stack != 0) {
        thread->context.sp_el0 = stack;
    }
    thread->context.x[0] = arg0;
    thread->context.x[1] = arg1;
    thread->context.spsr_el1 = 0; /* EL0t mode */

    thread->state = THREAD_STATE_READY;
    return ZX_OK;
}

zx_status_t thread_exit(void) {
    if (!current_thread) {
        return ZX_ERR_BAD_STATE;
    }

    current_thread->state = THREAD_STATE_TERMINATED;
    return ZX_OK;
}
