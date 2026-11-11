/**
 * @file handle.h
 * @brief PravahOS Zircon-Compatible Handle Table & Capability Rights.
 */

#ifndef PRAVAH_KERNEL_HANDLE_H
#define PRAVAH_KERNEL_HANDLE_H

#include "types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Standard Zircon Capability Object Types */
#define ZX_OBJ_TYPE_NONE        (0)
#define ZX_OBJ_TYPE_PROCESS     (1)
#define ZX_OBJ_TYPE_THREAD      (2)
#define ZX_OBJ_TYPE_VMO         (3)
#define ZX_OBJ_TYPE_CHANNEL     (4)
#define ZX_OBJ_TYPE_PORT        (5)
#define ZX_OBJ_TYPE_INTERRUPT   (6)
#define ZX_OBJ_TYPE_EVENT       (7)

/* Zircon Handle Rights Bitmasks */
#define ZX_RIGHT_NONE           (0x00000000u)
#define ZX_RIGHT_DUPLICATE      (0x00000001u)
#define ZX_RIGHT_TRANSFER       (0x00000002u)
#define ZX_RIGHT_READ           (0x00000004u)
#define ZX_RIGHT_WRITE          (0x00000008u)
#define ZX_RIGHT_EXECUTE        (0x00000010u)
#define ZX_RIGHT_MAP            (0x00000020u)
#define ZX_RIGHT_GET_PROPERTY   (0x00000040u)
#define ZX_RIGHT_SET_PROPERTY   (0x00000080u)
#define ZX_RIGHT_ENUMERATE      (0x00000100u)
#define ZX_RIGHT_DESTROY        (0x00000200u)
#define ZX_RIGHT_SIGNAL         (0x00000400u)
#define ZX_RIGHT_SIGNAL_PEER    (0x00000800u)
#define ZX_RIGHT_WAIT           (0x00001000u)
#define ZX_RIGHT_INSPECT        (0x00002000u)
#define ZX_RIGHT_SAME_RIGHTS    (0x80000000u)

/* Default Rights Profiles */
#define ZX_DEFAULT_VMO_RIGHTS \
    (ZX_RIGHT_DUPLICATE | ZX_RIGHT_TRANSFER | ZX_RIGHT_READ | ZX_RIGHT_WRITE | \
     ZX_RIGHT_MAP | ZX_RIGHT_GET_PROPERTY | ZX_RIGHT_SET_PROPERTY)

#define ZX_DEFAULT_CHANNEL_RIGHTS \
    (ZX_RIGHT_DUPLICATE | ZX_RIGHT_TRANSFER | ZX_RIGHT_READ | ZX_RIGHT_WRITE | \
     ZX_RIGHT_SIGNAL | ZX_RIGHT_SIGNAL_PEER | ZX_RIGHT_WAIT | \
     ZX_RIGHT_GET_PROPERTY | ZX_RIGHT_SET_PROPERTY)

#define MAX_HANDLES             (512)
#define ZX_HANDLE_INVALID       (0)

/**
 * @brief Initialize the global microkernel handle table.
 */
void handle_table_init(void);

/**
 * @brief Mint a new capability handle bound to a microkernel object.
 *
 * @param obj Raw pointer to kernel object (VMO, Channel, etc.).
 * @param type Object type identifier (e.g. ZX_OBJ_TYPE_VMO).
 * @param rights Bitmask of allowed operations.
 * @param[out] out_handle Minted handle value.
 * @return ZX_OK on success, or ZX_ERR_NO_RESOURCES if handle table is full.
 */
zx_status_t handle_create(void *obj, zx_obj_type_t type, zx_rights_t rights, zx_handle_t *out_handle);

/**
 * @brief Validate handle ownership, type, and required capability rights.
 *
 * @param handle Handle to resolve.
 * @param expected_type Required object type (or ZX_OBJ_TYPE_NONE for any type).
 * @param required_rights Required right flags.
 * @param[out] out_obj Pointer to receive the underlying kernel object.
 * @return ZX_OK on success, ZX_ERR_BAD_HANDLE, ZX_ERR_WRONG_TYPE, or ZX_ERR_ACCESS_DENIED.
 */
zx_status_t handle_lookup(zx_handle_t handle, zx_obj_type_t expected_type, zx_rights_t required_rights, void **out_obj);

/**
 * @brief Close and invalidate a handle, releasing object reference.
 *
 * @param handle Handle to close.
 * @return ZX_OK on success, or ZX_ERR_BAD_HANDLE.
 */
zx_status_t handle_close(zx_handle_t handle);

/**
 * @brief Duplicate a handle with the same or reduced rights.
 *
 * @param handle Existing handle (must have ZX_RIGHT_DUPLICATE).
 * @param new_rights Desired rights (or ZX_RIGHT_SAME_RIGHTS).
 * @param[out] out_handle Pointer to receive the duplicated handle.
 * @return ZX_OK on success, or error code.
 */
zx_status_t handle_duplicate(zx_handle_t handle, zx_rights_t new_rights, zx_handle_t *out_handle);

/**
 * @brief Replace a handle with a new handle having modified rights, closing the original.
 *
 * @param handle Existing handle.
 * @param new_rights Desired rights (or ZX_RIGHT_SAME_RIGHTS).
 * @param[out] out_handle Pointer to receive the replacement handle.
 * @return ZX_OK on success, or error code.
 */
zx_status_t handle_replace(zx_handle_t handle, zx_rights_t new_rights, zx_handle_t *out_handle);

/**
 * @brief Extract and revoke a handle from the table for IPC transfer.
 *
 * @param handle Handle to transfer (must have ZX_RIGHT_TRANSFER).
 * @param[out] out_type Object type.
 * @param[out] out_rights Original rights.
 * @param[out] out_obj Underlying object pointer.
 * @return ZX_OK on success, or error code.
 */
zx_status_t handle_transfer(zx_handle_t handle, zx_obj_type_t *out_type, zx_rights_t *out_rights, void **out_obj);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_HANDLE_H */
