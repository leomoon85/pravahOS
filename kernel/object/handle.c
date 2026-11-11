/**
 * @file handle.c
 * @brief PravahOS Handle Table & Capability Security Implementation.
 */

#include "kernel/handle.h"
#include "kernel/string.h"
#include "arch/arm64/uart_pl011.h"

/* Forward declarations of object release dispatchers */
extern void vmo_retain(void *vmo);
extern void vmo_release(void *vmo);
extern void channel_retain(void *channel);
extern void channel_release(void *channel);

typedef struct {
    void *object;
    zx_obj_type_t type;
    zx_rights_t rights;
    uint32_t generation;
    bool in_use;
} handle_entry_t;

static handle_entry_t handle_table[MAX_HANDLES];

static void object_retain(zx_obj_type_t type, void *obj) {
    if (!obj) return;
    switch (type) {
        case ZX_OBJ_TYPE_VMO:
            vmo_retain(obj);
            break;
        case ZX_OBJ_TYPE_CHANNEL:
            channel_retain(obj);
            break;
        default:
            break;
    }
}

static void object_release(zx_obj_type_t type, void *obj) {
    if (!obj) return;
    switch (type) {
        case ZX_OBJ_TYPE_VMO:
            vmo_release(obj);
            break;
        case ZX_OBJ_TYPE_CHANNEL:
            channel_release(obj);
            break;
        default:
            break;
    }
}

void handle_table_init(void) {
    for (size_t i = 0; i < MAX_HANDLES; i++) {
        handle_table[i].object = NULL;
        handle_table[i].type = ZX_OBJ_TYPE_NONE;
        handle_table[i].rights = ZX_RIGHT_NONE;
        handle_table[i].generation = 1;
        handle_table[i].in_use = false;
    }
    uart_puts("[HANDLE] Microkernel Handle Table Initialized (Capacity: 512 descriptors)\n");
}

static inline zx_handle_t encode_handle(size_t index, uint32_t gen) {
    return (zx_handle_t)(((index + 1) << 12) | (gen & 0xFFF));
}

static inline bool decode_handle(zx_handle_t handle, size_t *out_idx, uint32_t *out_gen) {
    if (handle == ZX_HANDLE_INVALID) return false;
    size_t idx = (handle >> 12) - 1;
    if (idx >= MAX_HANDLES) return false;
    *out_idx = idx;
    *out_gen = handle & 0xFFF;
    return true;
}

zx_status_t handle_create(void *obj, zx_obj_type_t type, zx_rights_t rights, zx_handle_t *out_handle) {
    if (!obj || !out_handle) return ZX_ERR_INVALID_ARGS;

    for (size_t i = 0; i < MAX_HANDLES; i++) {
        if (!handle_table[i].in_use) {
            handle_table[i].in_use = true;
            handle_table[i].object = obj;
            handle_table[i].type = type;
            handle_table[i].rights = rights;
            handle_table[i].generation = (handle_table[i].generation + 1) & 0xFFF;
            if (handle_table[i].generation == 0) handle_table[i].generation = 1;

            object_retain(type, obj);

            *out_handle = encode_handle(i, handle_table[i].generation);
            return ZX_OK;
        }
    }

    return ZX_ERR_NO_RESOURCES;
}

zx_status_t handle_lookup(zx_handle_t handle, zx_obj_type_t expected_type, zx_rights_t required_rights, void **out_obj) {
    size_t idx;
    uint32_t gen;
    if (!decode_handle(handle, &idx, &gen)) {
        return ZX_ERR_BAD_HANDLE;
    }

    handle_entry_t *entry = &handle_table[idx];
    if (!entry->in_use || (entry->generation & 0xFFF) != gen) {
        return ZX_ERR_BAD_HANDLE;
    }

    if (expected_type != ZX_OBJ_TYPE_NONE && entry->type != expected_type) {
        return ZX_ERR_WRONG_TYPE;
    }

    if ((entry->rights & required_rights) != required_rights) {
        return ZX_ERR_ACCESS_DENIED;
    }

    if (out_obj) {
        *out_obj = entry->object;
    }

    return ZX_OK;
}

zx_status_t handle_close(zx_handle_t handle) {
    size_t idx;
    uint32_t gen;
    if (!decode_handle(handle, &idx, &gen)) {
        return ZX_ERR_BAD_HANDLE;
    }

    handle_entry_t *entry = &handle_table[idx];
    if (!entry->in_use || (entry->generation & 0xFFF) != gen) {
        return ZX_ERR_BAD_HANDLE;
    }

    void *obj = entry->object;
    zx_obj_type_t type = entry->type;

    entry->in_use = false;
    entry->object = NULL;
    entry->type = ZX_OBJ_TYPE_NONE;
    entry->rights = ZX_RIGHT_NONE;

    object_release(type, obj);
    return ZX_OK;
}

zx_status_t handle_duplicate(zx_handle_t handle, zx_rights_t new_rights, zx_handle_t *out_handle) {
    if (!out_handle) return ZX_ERR_INVALID_ARGS;

    size_t idx;
    uint32_t gen;
    if (!decode_handle(handle, &idx, &gen)) {
        return ZX_ERR_BAD_HANDLE;
    }

    handle_entry_t *entry = &handle_table[idx];
    if (!entry->in_use || (entry->generation & 0xFFF) != gen) {
        return ZX_ERR_BAD_HANDLE;
    }

    if (!(entry->rights & ZX_RIGHT_DUPLICATE)) {
        return ZX_ERR_ACCESS_DENIED;
    }

    zx_rights_t target_rights = entry->rights;
    if (new_rights != ZX_RIGHT_SAME_RIGHTS) {
        if ((new_rights & ~entry->rights) != 0) {
            return ZX_ERR_INVALID_ARGS; /* Cannot expand rights upon duplication */
        }
        target_rights = new_rights;
    }

    return handle_create(entry->object, entry->type, target_rights, out_handle);
}

zx_status_t handle_replace(zx_handle_t handle, zx_rights_t new_rights, zx_handle_t *out_handle) {
    if (!out_handle) return ZX_ERR_INVALID_ARGS;

    size_t idx;
    uint32_t gen;
    if (!decode_handle(handle, &idx, &gen)) {
        return ZX_ERR_BAD_HANDLE;
    }

    handle_entry_t *entry = &handle_table[idx];
    if (!entry->in_use || (entry->generation & 0xFFF) != gen) {
        return ZX_ERR_BAD_HANDLE;
    }

    zx_rights_t target_rights = entry->rights;
    if (new_rights != ZX_RIGHT_SAME_RIGHTS) {
        if ((new_rights & ~entry->rights) != 0) {
            return ZX_ERR_INVALID_ARGS;
        }
        target_rights = new_rights;
    }

    void *obj = entry->object;
    zx_obj_type_t type = entry->type;

    /* Retain object for new handle */
    object_retain(type, obj);

    /* Close old handle without releasing the extra reference */
    entry->in_use = false;
    entry->object = NULL;
    entry->type = ZX_OBJ_TYPE_NONE;
    entry->rights = ZX_RIGHT_NONE;
    object_release(type, obj);

    /* Mint new handle */
    return handle_create(obj, type, target_rights, out_handle);
}

zx_status_t handle_transfer(zx_handle_t handle, zx_obj_type_t *out_type, zx_rights_t *out_rights, void **out_obj) {
    if (!out_type || !out_rights || !out_obj) return ZX_ERR_INVALID_ARGS;

    size_t idx;
    uint32_t gen;
    if (!decode_handle(handle, &idx, &gen)) {
        return ZX_ERR_BAD_HANDLE;
    }

    handle_entry_t *entry = &handle_table[idx];
    if (!entry->in_use || (entry->generation & 0xFFF) != gen) {
        return ZX_ERR_BAD_HANDLE;
    }

    if (!(entry->rights & ZX_RIGHT_TRANSFER)) {
        return ZX_ERR_ACCESS_DENIED;
    }

    *out_type = entry->type;
    *out_rights = entry->rights;
    *out_obj = entry->object;

    /* Revoke from current table without destroying object */
    entry->in_use = false;
    entry->object = NULL;
    entry->type = ZX_OBJ_TYPE_NONE;
    entry->rights = ZX_RIGHT_NONE;

    return ZX_OK;
}
