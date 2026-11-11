/**
 * @file channel.h
 * @brief PravahOS Zircon-Compatible Bidirectional IPC Channel Endpoints.
 */

#ifndef PRAVAH_KERNEL_CHANNEL_H
#define PRAVAH_KERNEL_CHANNEL_H

#include "types.h"
#include "handle.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ZX_CHANNEL_MAX_MSG_BYTES     (2048)
#define ZX_CHANNEL_MAX_MSG_HANDLES   (16)
#define CHANNEL_QUEUE_CAPACITY       (4)
#define MAX_CHANNELS                 (16)

typedef struct {
    void *object;
    zx_obj_type_t type;
    zx_rights_t rights;
} transferred_handle_t;

typedef struct channel_msg {
    uint8_t data[ZX_CHANNEL_MAX_MSG_BYTES];
    uint32_t num_bytes;
    transferred_handle_t handles[ZX_CHANNEL_MAX_MSG_HANDLES];
    uint32_t num_handles;
} channel_msg_t;

typedef struct channel_endpoint {
    struct channel_endpoint *peer;
    bool peer_closed;
    int32_t ref_count;
    bool in_use;

    channel_msg_t queue[CHANNEL_QUEUE_CAPACITY];
    uint32_t head;
    uint32_t tail;
    uint32_t count;
} channel_endpoint_t;

/**
 * @brief Initialize the global Channel IPC subsystem.
 */
void channel_subsystem_init(void);

/**
 * @brief Create a connected pair of bidirectional IPC channel endpoints.
 *
 * @param flags Reserved (must be 0).
 * @param[out] out0 Handle to first channel endpoint.
 * @param[out] out1 Handle to peer channel endpoint.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_channel_create(uint32_t flags, zx_handle_t *out0, zx_handle_t *out1);

/**
 * @brief Write a message containing data and capability handles to an IPC channel.
 *
 * @param handle Handle to the channel endpoint (requires ZX_RIGHT_WRITE).
 * @param flags Reserved (must be 0).
 * @param bytes Buffer containing payload bytes.
 * @param num_bytes Length of payload bytes.
 * @param handles Array of capability handles to transfer.
 * @param num_handles Number of handles in array.
 * @return ZX_OK on success, or error code.
 */
zx_status_t zx_channel_write(zx_handle_t handle, uint32_t flags,
                             const void *bytes, uint32_t num_bytes,
                             const zx_handle_t *handles, uint32_t num_handles);

/**
 * @brief Read a message and incoming handles from an IPC channel.
 *
 * @param handle Handle to the channel endpoint (requires ZX_RIGHT_READ).
 * @param flags Reserved (must be 0).
 * @param[out] bytes Destination buffer for message payload.
 * @param[out] handles Destination array to receive transferred handles.
 * @param num_bytes Maximum bytes destination buffer can accept.
 * @param num_handles Maximum handles destination array can accept.
 * @param[out] actual_bytes Optional pointer to receive actual bytes count.
 * @param[out] actual_handles Optional pointer to receive actual handles count.
 * @return ZX_OK on success, ZX_ERR_PEER_CLOSED, ZX_ERR_SHOULD_WAIT, or buffer errors.
 */
zx_status_t zx_channel_read(zx_handle_t handle, uint32_t flags,
                            void *bytes, zx_handle_t *handles,
                            uint32_t num_bytes, uint32_t num_handles,
                            uint32_t *actual_bytes, uint32_t *actual_handles);

/**
 * @brief Retain reference count on a channel endpoint.
 */
void channel_retain(void *ep);

/**
 * @brief Release reference count on a channel endpoint, notifying peer if closed.
 */
void channel_release(void *ep);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_CHANNEL_H */
