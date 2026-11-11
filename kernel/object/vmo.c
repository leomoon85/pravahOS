/**
 * @file vmo.c
 * @brief PravahOS Virtual Memory Object (VMO) Implementation.
 */

#include "kernel/vmo.h"
#include "kernel/pmm.h"
#include "kernel/string.h"
#include "arch/arm64/uart_pl011.h"

static vmo_t vmo_pool[MAX_VMOS];

void vmo_subsystem_init(void) {
    for (size_t i = 0; i < MAX_VMOS; i++) {
        vmo_pool[i].size = 0;
        vmo_pool[i].page_count = 0;
        vmo_pool[i].flags = 0;
        vmo_pool[i].ref_count = 0;
        vmo_pool[i].in_use = false;
        vmo_pool[i].name[0] = '\0';
    }
    uart_puts("[VMO] Virtual Memory Object Subsystem Initialized (Pool: 32 VMO descriptors)\n");
}

static vmo_t *vmo_alloc_descriptor(void) {
    for (size_t i = 0; i < MAX_VMOS; i++) {
        if (!vmo_pool[i].in_use) {
            vmo_pool[i].in_use = true;
            vmo_pool[i].ref_count = 0;
            vmo_pool[i].size = 0;
            vmo_pool[i].page_count = 0;
            vmo_pool[i].flags = 0;
            return &vmo_pool[i];
        }
    }
    return NULL;
}

void vmo_retain(void *vmo_ptr) {
    if (!vmo_ptr) return;
    vmo_t *vmo = (vmo_t *)vmo_ptr;
    vmo->ref_count++;
}

void vmo_release(void *vmo_ptr) {
    if (!vmo_ptr) return;
    vmo_t *vmo = (vmo_t *)vmo_ptr;
    vmo->ref_count--;

    if (vmo->ref_count <= 0) {
        /* Free all backed physical pages back to PMM */
        for (size_t i = 0; i < vmo->page_count; i++) {
            if (vmo->pages[i] != 0) {
                pmm_free_page(vmo->pages[i]);
                vmo->pages[i] = 0;
            }
        }
        vmo->size = 0;
        vmo->page_count = 0;
        vmo->in_use = false;
    }
}

zx_status_t zx_vmo_create(size_t size, uint32_t options, zx_handle_t *out) {
    if (!out) return ZX_ERR_INVALID_ARGS;

    size_t page_count = ALIGN_UP(size, PAGE_SIZE) / PAGE_SIZE;
    if (page_count == 0 && size > 0) page_count = 1;
    if (page_count > VMO_MAX_PAGES) return ZX_ERR_OUT_OF_RANGE;

    vmo_t *vmo = vmo_alloc_descriptor();
    if (!vmo) return ZX_ERR_NO_RESOURCES;

    vmo->size = size;
    vmo->page_count = page_count;
    vmo->flags = options;

    /* Back VMO with physical frames from PMM */
    for (size_t i = 0; i < page_count; i++) {
        zx_status_t st = pmm_alloc_page(&vmo->pages[i]);
        if (st != ZX_OK) {
            /* Rollback allocated pages */
            for (size_t j = 0; j < i; j++) {
                pmm_free_page(vmo->pages[j]);
            }
            vmo->in_use = false;
            return st;
        }
    }

    /* Mint handle */
    zx_status_t st = handle_create(vmo, ZX_OBJ_TYPE_VMO, ZX_DEFAULT_VMO_RIGHTS, out);
    if (st != ZX_OK) {
        for (size_t i = 0; i < page_count; i++) {
            pmm_free_page(vmo->pages[i]);
        }
        vmo->in_use = false;
        return st;
    }

    return ZX_OK;
}

zx_status_t zx_vmo_read(zx_handle_t handle, void *data, uint64_t offset, size_t len, size_t *actual) {
    if (!data) return ZX_ERR_INVALID_ARGS;

    void *obj = NULL;
    zx_status_t st = handle_lookup(handle, ZX_OBJ_TYPE_VMO, ZX_RIGHT_READ, &obj);
    if (st != ZX_OK) return st;

    vmo_t *vmo = (vmo_t *)obj;
    if (offset > vmo->size) return ZX_ERR_OUT_OF_RANGE;

    if (offset + len > vmo->size) {
        len = vmo->size - offset;
    }

    size_t copied = 0;
    while (copied < len) {
        uint64_t cur_pos = offset + copied;
        size_t page_idx = cur_pos / PAGE_SIZE;
        size_t page_off = cur_pos % PAGE_SIZE;
        size_t to_copy = PAGE_SIZE - page_off;
        if (to_copy > (len - copied)) {
            to_copy = len - copied;
        }

        zx_paddr_t paddr = vmo->pages[page_idx];
        memcpy((uint8_t *)data + copied, (const void *)(uintptr_t)(paddr + page_off), to_copy);
        copied += to_copy;
    }

    if (actual) *actual = copied;
    return ZX_OK;
}

zx_status_t zx_vmo_write(zx_handle_t handle, const void *data, uint64_t offset, size_t len, size_t *actual) {
    if (!data) return ZX_ERR_INVALID_ARGS;

    void *obj = NULL;
    zx_status_t st = handle_lookup(handle, ZX_OBJ_TYPE_VMO, ZX_RIGHT_WRITE, &obj);
    if (st != ZX_OK) return st;

    vmo_t *vmo = (vmo_t *)obj;
    if (offset > vmo->size) return ZX_ERR_OUT_OF_RANGE;

    if (offset + len > vmo->size) {
        len = vmo->size - offset;
    }

    size_t written = 0;
    while (written < len) {
        uint64_t cur_pos = offset + written;
        size_t page_idx = cur_pos / PAGE_SIZE;
        size_t page_off = cur_pos % PAGE_SIZE;
        size_t to_write = PAGE_SIZE - page_off;
        if (to_write > (len - written)) {
            to_write = len - written;
        }

        zx_paddr_t paddr = vmo->pages[page_idx];
        memcpy((void *)(uintptr_t)(paddr + page_off), (const uint8_t *)data + written, to_write);
        written += to_write;
    }

    if (actual) *actual = written;
    return ZX_OK;
}

zx_status_t zx_vmo_get_size(zx_handle_t handle, uint64_t *out_size) {
    if (!out_size) return ZX_ERR_INVALID_ARGS;

    void *obj = NULL;
    zx_status_t st = handle_lookup(handle, ZX_OBJ_TYPE_VMO, ZX_RIGHT_GET_PROPERTY, &obj);
    if (st != ZX_OK) return st;

    vmo_t *vmo = (vmo_t *)obj;
    *out_size = vmo->size;
    return ZX_OK;
}

zx_status_t zx_vmo_set_size(zx_handle_t handle, uint64_t new_size) {
    void *obj = NULL;
    zx_status_t st = handle_lookup(handle, ZX_OBJ_TYPE_VMO, ZX_RIGHT_WRITE, &obj);
    if (st != ZX_OK) return st;

    vmo_t *vmo = (vmo_t *)obj;
    if (!(vmo->flags & ZX_VMO_RESIZABLE)) {
        return ZX_ERR_UNAVAILABLE;
    }

    size_t new_page_count = ALIGN_UP(new_size, PAGE_SIZE) / PAGE_SIZE;
    if (new_page_count > VMO_MAX_PAGES) {
        return ZX_ERR_OUT_OF_RANGE;
    }

    if (new_page_count > vmo->page_count) {
        /* Allocate new physical pages */
        for (size_t i = vmo->page_count; i < new_page_count; i++) {
            zx_status_t alloc_st = pmm_alloc_page(&vmo->pages[i]);
            if (alloc_st != ZX_OK) {
                /* Rollback newly allocated */
                for (size_t j = vmo->page_count; j < i; j++) {
                    pmm_free_page(vmo->pages[j]);
                    vmo->pages[j] = 0;
                }
                return alloc_st;
            }
        }
    } else if (new_page_count < vmo->page_count) {
        /* Free truncated pages */
        for (size_t i = new_page_count; i < vmo->page_count; i++) {
            pmm_free_page(vmo->pages[i]);
            vmo->pages[i] = 0;
        }
    }

    vmo->size = new_size;
    vmo->page_count = new_page_count;
    return ZX_OK;
}
