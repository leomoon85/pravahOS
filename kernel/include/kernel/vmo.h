/**
 * @file vmo.h
 * @brief PravahOS Virtual Memory Object (VMO) & Paged Container Primitives.
 */

#ifndef PRAVAH_KERNEL_VMO_H
#define PRAVAH_KERNEL_VMO_H

#include "types.h"
#include "handle.h"
#include "memory.h"

#ifdef __cplusplus
extern "C" {
#endif

/* VMO Creation Flags */
#define ZX_VMO_RESIZABLE         (1u << 0)
#define ZX_VMO_CONTIGUOUS        (1u << 1)

#define VMO_MAX_PAGES            (256) /* Max 1 MiB per VMO in early bootstrap */
#define MAX_VMOS                 (32)

typedef struct vmo {
    size_t size;
    size_t page_count;
    zx_paddr_t pages[VMO_MAX_PAGES];
    uint32_t flags;
    int32_t ref_count;
    char name[32];
    bool in_use;
} vmo_t;

/**
 * @brief Initialize the global VMO subsystem.
 */
void vmo_subsystem_init(void);

/**
 * @brief Create a new Virtual Memory Object backed by PMM pages.
 *
 * @param size Initial size of the VMO in bytes (rounded up to PAGE_SIZE).
 * @param options Bitwise flags (e.g. ZX_VMO_RESIZABLE).
 * @param[out] out Handle to the minted VMO capability.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_vmo_create(size_t size, uint32_t options, zx_handle_t *out);

/**
 * @brief Read data from a VMO into a caller buffer.
 *
 * @param handle Handle to the VMO (requires ZX_RIGHT_READ).
 * @param[out] data Destination buffer.
 * @param offset Byte offset within the VMO.
 * @param len Number of bytes to read.
 * @param[out] actual Optional pointer to receive actual bytes read.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_vmo_read(zx_handle_t handle, void *data, uint64_t offset, size_t len, size_t *actual);

/**
 * @brief Write data from a caller buffer into a VMO.
 *
 * @param handle Handle to the VMO (requires ZX_RIGHT_WRITE).
 * @param data Source buffer.
 * @param offset Byte offset within the VMO.
 * @param len Number of bytes to write.
 * @param[out] actual Optional pointer to receive actual bytes written.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_vmo_write(zx_handle_t handle, const void *data, uint64_t offset, size_t len, size_t *actual);

/**
 * @brief Query the current byte size of a VMO.
 *
 * @param handle Handle to the VMO (requires ZX_RIGHT_GET_PROPERTY).
 * @param[out] out_size Current size in bytes.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_vmo_get_size(zx_handle_t handle, uint64_t *out_size);

/**
 * @brief Resize a resizable VMO.
 *
 * @param handle Handle to the VMO (requires ZX_RIGHT_WRITE).
 * @param new_size Target size in bytes.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_vmo_set_size(zx_handle_t handle, uint64_t new_size);

/**
 * @brief Retain reference count on a VMO.
 */
void vmo_retain(void *vmo);

/**
 * @brief Release reference count on a VMO, destroying it when ref_count == 0.
 */
void vmo_release(void *vmo);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_VMO_H */
