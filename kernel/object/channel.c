/**
 * @file channel.c
 * @brief PravahOS Zircon-Compatible Bidirectional Channel IPC Implementation.
 */

#include "kernel/channel.h"
#include "kernel/string.h"
#include "arch/arm64/uart_pl011.h"

extern void vmo_release(void *vmo);

static channel_endpoint_t channel_pool[MAX_CHANNELS];

void channel_subsystem_init(void) {
    for (size_t i = 0; i < MAX_CHANNELS; i++) {
        channel_pool[i].peer = NULL;
        channel_pool[i].peer_closed = false;
        channel_pool[i].ref_count = 0;
        channel_pool[i].in_use = false;
        channel_pool[i].head = 0;
        channel_pool[i].tail = 0;
        channel_pool[i].count = 0;
    }
    uart_puts("[CHANNEL] Microkernel Channel Subsystem Initialized (Pool: 16 endpoints)\n");
}

static channel_endpoint_t *channel_alloc_endpoint(void) {
    for (size_t i = 0; i < MAX_CHANNELS; i++) {
        if (!channel_pool[i].in_use) {
            channel_pool[i].in_use = true;
            channel_pool[i].peer = NULL;
            channel_pool[i].peer_closed = false;
            channel_pool[i].ref_count = 0;
            channel_pool[i].head = 0;
            channel_pool[i].tail = 0;
            channel_pool[i].count = 0;
            return &channel_pool[i];
        }
    }
    return NULL;
}

static void release_transferred_handle(transferred_handle_t *th) {
    if (!th || !th->object) return;
    if (th->type == ZX_OBJ_TYPE_VMO) {
        vmo_release(th->object);
    } else if (th->type == ZX_OBJ_TYPE_CHANNEL) {
        channel_release(th->object);
    }
}

void channel_retain(void *ep_ptr) {
    if (!ep_ptr) return;
    channel_endpoint_t *ep = (channel_endpoint_t *)ep_ptr;
    ep->ref_count++;
}

void channel_release(void *ep_ptr) {
    if (!ep_ptr) return;
    channel_endpoint_t *ep = (channel_endpoint_t *)ep_ptr;
    ep->ref_count--;

    if (ep->ref_count <= 0) {
        /* Disconnect from peer and signal peer closure */
        if (ep->peer) {
            ep->peer->peer_closed = true;
            ep->peer->peer = NULL;
            ep->peer = NULL;
        }

        /* Drain undelivered messages and free orphaned transferred handles */
        while (ep->count > 0) {
            channel_msg_t *msg = &ep->queue[ep->tail];
            for (uint32_t i = 0; i < msg->num_handles; i++) {
                release_transferred_handle(&msg->handles[i]);
            }
            ep->tail = (ep->tail + 1) % CHANNEL_QUEUE_CAPACITY;
            ep->count--;
        }

        ep->in_use = false;
    }
}

zx_status_t zx_channel_create(uint32_t flags, zx_handle_t *out0, zx_handle_t *out1) {
    if (flags != 0 || !out0 || !out1) {
        return ZX_ERR_INVALID_ARGS;
    }

    channel_endpoint_t *ep0 = channel_alloc_endpoint();
    if (!ep0) return ZX_ERR_NO_RESOURCES;

    channel_endpoint_t *ep1 = channel_alloc_endpoint();
    if (!ep1) {
        ep0->in_use = false;
        return ZX_ERR_NO_RESOURCES;
    }

    /* Link peers */
    ep0->peer = ep1;
    ep1->peer = ep0;

    zx_status_t st = handle_create(ep0, ZX_OBJ_TYPE_CHANNEL, ZX_DEFAULT_CHANNEL_RIGHTS, out0);
    if (st != ZX_OK) {
        ep0->in_use = false;
        ep1->in_use = false;
        return st;
    }

    st = handle_create(ep1, ZX_OBJ_TYPE_CHANNEL, ZX_DEFAULT_CHANNEL_RIGHTS, out1);
    if (st != ZX_OK) {
        handle_close(*out0);
        ep1->in_use = false;
        return st;
    }

    return ZX_OK;
}

zx_status_t zx_channel_write(zx_handle_t handle, uint32_t flags,
                             const void *bytes, uint32_t num_bytes,
                             const zx_handle_t *handles, uint32_t num_handles) {
    if (flags != 0) return ZX_ERR_INVALID_ARGS;
    if (num_bytes > ZX_CHANNEL_MAX_MSG_BYTES || num_handles > ZX_CHANNEL_MAX_MSG_HANDLES) {
        return ZX_ERR_OUT_OF_RANGE;
    }
    if (num_bytes > 0 && !bytes) return ZX_ERR_INVALID_ARGS;
    if (num_handles > 0 && !handles) return ZX_ERR_INVALID_ARGS;

    void *obj = NULL;
    zx_status_t st = handle_lookup(handle, ZX_OBJ_TYPE_CHANNEL, ZX_RIGHT_WRITE, &obj);
    if (st != ZX_OK) return st;

    channel_endpoint_t *ep = (channel_endpoint_t *)obj;
    if (ep->peer_closed || !ep->peer) {
        return ZX_ERR_PEER_CLOSED;
    }

    channel_endpoint_t *peer = ep->peer;
    if (peer->count >= CHANNEL_QUEUE_CAPACITY) {
        return ZX_ERR_SHOULD_WAIT;
    }

    /* Step 1: Pre-validate all handles to ensure atomic transfer semantics */
    for (uint32_t i = 0; i < num_handles; i++) {
        if (handles[i] == handle) {
            return ZX_ERR_NOT_SUPPORTED; /* Cannot send channel endpoint through itself */
        }
        void *tmp_obj = NULL;
        st = handle_lookup(handles[i], ZX_OBJ_TYPE_NONE, ZX_RIGHT_TRANSFER, &tmp_obj);
        if (st != ZX_OK) {
            return st; /* Return error before any transfer happens */
        }
    }

    /* Step 2: Write payload into peer's message queue */
    channel_msg_t *msg = &peer->queue[peer->head];
    if (num_bytes > 0) {
        memcpy(msg->data, bytes, num_bytes);
    }
    msg->num_bytes = num_bytes;

    /* Step 3: Transfer handles from caller into message */
    for (uint32_t i = 0; i < num_handles; i++) {
        zx_obj_type_t obj_type;
        zx_rights_t obj_rights;
        void *transferred_obj = NULL;

        st = handle_transfer(handles[i], &obj_type, &obj_rights, &transferred_obj);
        if (st != ZX_OK) {
            /* If this fails unexpectedly, rollback previously transferred handles */
            for (uint32_t j = 0; j < i; j++) {
                release_transferred_handle(&msg->handles[j]);
            }
            return st;
        }

        msg->handles[i].object = transferred_obj;
        msg->handles[i].type = obj_type;
        msg->handles[i].rights = obj_rights;
    }
    msg->num_handles = num_handles;

    /* Advance peer message queue head */
    peer->head = (peer->head + 1) % CHANNEL_QUEUE_CAPACITY;
    peer->count++;

    return ZX_OK;
}

zx_status_t zx_channel_read(zx_handle_t handle, uint32_t flags,
                            void *bytes, zx_handle_t *handles,
                            uint32_t num_bytes, uint32_t num_handles,
                            uint32_t *actual_bytes, uint32_t *actual_handles) {
    if (flags != 0) return ZX_ERR_INVALID_ARGS;

    void *obj = NULL;
    zx_status_t st = handle_lookup(handle, ZX_OBJ_TYPE_CHANNEL, ZX_RIGHT_READ, &obj);
    if (st != ZX_OK) return st;

    channel_endpoint_t *ep = (channel_endpoint_t *)obj;

    /* Check if queue is empty */
    if (ep->count == 0) {
        if (ep->peer_closed) {
            return ZX_ERR_PEER_CLOSED;
        }
        return ZX_ERR_SHOULD_WAIT;
    }

    channel_msg_t *msg = &ep->queue[ep->tail];

    if (actual_bytes) *actual_bytes = msg->num_bytes;
    if (actual_handles) *actual_handles = msg->num_handles;

    /* Check caller buffer sizes */
    if (num_bytes < msg->num_bytes) {
        return ZX_ERR_BUFFER_TOO_SMALL;
    }
    if (num_handles < msg->num_handles) {
        return ZX_ERR_BUFFER_TOO_SMALL;
    }

    /* Copy message data payload */
    if (msg->num_bytes > 0 && bytes) {
        memcpy(bytes, msg->data, msg->num_bytes);
    }

    /* Mint transferred handles into receiving process handle table */
    for (uint32_t i = 0; i < msg->num_handles; i++) {
        st = handle_create(msg->handles[i].object,
                           msg->handles[i].type,
                           msg->handles[i].rights,
                           &handles[i]);
        if (st != ZX_OK) {
            /* Close handles already minted */
            for (uint32_t j = 0; j < i; j++) {
                handle_close(handles[j]);
            }
            return st;
        }
    }

    /* Pop message from queue */
    ep->tail = (ep->tail + 1) % CHANNEL_QUEUE_CAPACITY;
    ep->count--;

    return ZX_OK;
}
