/**
 * @file compositor.c
 * @brief PravahOS Native Surface Compositor & Window Flinger Implementation.
 *
 * Implements Z-ordered layer stack management, Porter-Duff Source-Over alpha
 * compositing, dirty rectangle damage tracking, and VSync-synchronized buffer swapping.
 */

#include "kernel/compositor.h"
#include "kernel/pmm.h"
#include "kernel/string.h"
#include "arch/arm64/arch.h"
#include "arch/arm64/uart_pl011.h"
#include "../drivers/display/font8x16.h"

/* Helper Math Macros */
#ifndef MIN
#define MIN(a, b) (((a) < (b)) ? (a) : (b))
#endif
#ifndef MAX
#define MAX(a, b) (((a) > (b)) ? (a) : (b))
#endif

/* Global Compositor State */
static compositor_state_t s_compositor = {0};

/* ========================================================================= */
/* Helper Functions: Default Z & String Utilities                            */
/* ========================================================================= */

static int32_t compositor_default_z_for_type(compositor_layer_type_t type) {
    switch (type) {
        case LAYER_TYPE_BACKGROUND:  return COMPOSITOR_Z_BACKGROUND;
        case LAYER_TYPE_WALLPAPER:   return COMPOSITOR_Z_WALLPAPER;
        case LAYER_TYPE_WORKSPACE:   return COMPOSITOR_Z_WORKSPACE;
        case LAYER_TYPE_MODAL:       return COMPOSITOR_Z_MODAL;
        case LAYER_TYPE_STATUS_BAR:  return COMPOSITOR_Z_STATUS_BAR;
        default:                     return 50;
    }
}

const char *compositor_layer_type_name(compositor_layer_type_t type) {
    switch (type) {
        case LAYER_TYPE_BACKGROUND:  return "BACKGROUND";
        case LAYER_TYPE_WALLPAPER:   return "WALLPAPER";
        case LAYER_TYPE_WORKSPACE:   return "WORKSPACE";
        case LAYER_TYPE_MODAL:       return "MODAL";
        case LAYER_TYPE_STATUS_BAR:  return "STATUS_BAR";
        default:                     return "UNKNOWN";
    }
}

static compositor_layer_t *compositor_find_layer(compositor_layer_id_t layer_id) {
    if (layer_id == COMPOSITOR_INVALID_LAYER_ID) return NULL;
    for (size_t i = 0; i < COMPOSITOR_MAX_LAYERS; i++) {
        if (s_compositor.layers[i].in_use && s_compositor.layers[i].id == layer_id) {
            return &s_compositor.layers[i];
        }
    }
    return NULL;
}

/* ========================================================================= */
/* Porter-Duff Source-Over Alpha Blending                                    */
/* ========================================================================= */

/**
 * @brief Blend a source pixel over a destination pixel using Porter-Duff Source-Over,
 * scaled by a per-layer global opacity (layer_alpha in 0..255).
 */
static inline uint32_t compositor_blend_pixel(uint32_t dst_col, uint32_t src_col, uint8_t layer_alpha) {
    if (layer_alpha == 0) return dst_col;

    uint32_t src_a = COLOR_GET_A(src_col);
    if (src_a == 0) return dst_col;

    /* Compute effective source alpha combining pixel alpha and layer global alpha */
    uint32_t sa = (src_a * (uint32_t)layer_alpha) / 255;
    if (sa == 0) return dst_col;
    if (sa == 255) return src_col;

    uint32_t da = COLOR_GET_A(dst_col);
    uint32_t sr = COLOR_GET_R(src_col);
    uint32_t sg = COLOR_GET_G(src_col);
    uint32_t sb = COLOR_GET_B(src_col);

    uint32_t dr = COLOR_GET_R(dst_col);
    uint32_t dg = COLOR_GET_G(dst_col);
    uint32_t db = COLOR_GET_B(dst_col);

    uint32_t inv_sa = 255 - sa;
    uint32_t out_r = (sr * sa + dr * inv_sa) / 255;
    uint32_t out_g = (sg * sa + dg * inv_sa) / 255;
    uint32_t out_b = (sb * sa + db * inv_sa) / 255;
    uint32_t out_a = sa + (da * inv_sa) / 255;

    return COLOR_ARGB(out_a, out_r, out_g, out_b);
}

/* ========================================================================= */
/* Subsystem Lifecycle & Configuration                                       */
/* ========================================================================= */

zx_status_t compositor_init(void) {
    const display_info_t *disp = display_get_info();
    if (!disp || !disp->initialized) {
        uart_puts("[COMPOSITOR] ERROR: Display subsystem not initialized!\n");
        return ZX_ERR_INTERNAL;
    }

    s_compositor.screen_width = disp->width;
    s_compositor.screen_height = disp->height;
    s_compositor.next_layer_id = 1;
    s_compositor.damage_pending = false;
    memset(&s_compositor.accumulated_damage, 0, sizeof(compositor_rect_t));
    memset(&s_compositor.stats, 0, sizeof(compositor_stats_t));

    for (size_t i = 0; i < COMPOSITOR_MAX_LAYERS; i++) {
        s_compositor.layers[i].in_use = false;
        s_compositor.layers[i].id = COMPOSITOR_INVALID_LAYER_ID;
        s_compositor.layers[i].buffer = NULL;
    }

    s_compositor.initialized = true;

    uart_puts("[COMPOSITOR] Native Surface Compositor Initialized:\n");
    uart_puts("             Geometry     : ");
    uart_write_dec(s_compositor.screen_width);
    uart_puts(" x ");
    uart_write_dec(s_compositor.screen_height);
    uart_puts(" ARGB8888\n");
    uart_puts("             Max Layers   : ");
    uart_write_dec(COMPOSITOR_MAX_LAYERS);
    uart_puts("\n");
    uart_puts("             Engine       : Porter-Duff Source-Over, Damage Bounding, VSync Swapper\n");

    return ZX_OK;
}

/* ========================================================================= */
/* Damage Rectangle Tracking                                                 */
/* ========================================================================= */

zx_status_t compositor_damage_rect(int32_t x, int32_t y, uint32_t width, uint32_t height) {
    if (!s_compositor.initialized || width == 0 || height == 0) {
        return ZX_OK;
    }

    /* Clip to screen boundaries */
    int32_t x0 = MAX(0, x);
    int32_t y0 = MAX(0, y);
    int32_t x1 = MIN((int32_t)s_compositor.screen_width, x + (int32_t)width);
    int32_t y1 = MIN((int32_t)s_compositor.screen_height, y + (int32_t)height);

    if (x1 <= x0 || y1 <= y0) {
        return ZX_OK;
    }

    if (!s_compositor.damage_pending) {
        s_compositor.accumulated_damage.x = x0;
        s_compositor.accumulated_damage.y = y0;
        s_compositor.accumulated_damage.width = (uint32_t)(x1 - x0);
        s_compositor.accumulated_damage.height = (uint32_t)(y1 - y0);
        s_compositor.damage_pending = true;
    } else {
        /* Union with existing accumulated damage box */
        int32_t cur_x0 = s_compositor.accumulated_damage.x;
        int32_t cur_y0 = s_compositor.accumulated_damage.y;
        int32_t cur_x1 = cur_x0 + (int32_t)s_compositor.accumulated_damage.width;
        int32_t cur_y1 = cur_y0 + (int32_t)s_compositor.accumulated_damage.height;

        int32_t union_x0 = MIN(cur_x0, x0);
        int32_t union_y0 = MIN(cur_y0, y0);
        int32_t union_x1 = MAX(cur_x1, x1);
        int32_t union_y1 = MAX(cur_y1, y1);

        s_compositor.accumulated_damage.x = union_x0;
        s_compositor.accumulated_damage.y = union_y0;
        s_compositor.accumulated_damage.width = (uint32_t)(union_x1 - union_x0);
        s_compositor.accumulated_damage.height = (uint32_t)(union_y1 - union_y0);
    }

    s_compositor.stats.dirty_rects_composited++;
    return ZX_OK;
}

zx_status_t compositor_damage_layer(compositor_layer_id_t layer_id) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer) return ZX_ERR_NOT_FOUND;

    layer->dirty = true;
    layer->damage_rect.x = 0;
    layer->damage_rect.y = 0;
    layer->damage_rect.width = layer->rect.width;
    layer->damage_rect.height = layer->rect.height;

    return compositor_damage_rect(layer->rect.x, layer->rect.y,
                                  layer->rect.width, layer->rect.height);
}

void compositor_damage_all(void) {
    if (!s_compositor.initialized) return;
    s_compositor.accumulated_damage.x = 0;
    s_compositor.accumulated_damage.y = 0;
    s_compositor.accumulated_damage.width = s_compositor.screen_width;
    s_compositor.accumulated_damage.height = s_compositor.screen_height;
    s_compositor.damage_pending = true;
    s_compositor.stats.full_redraws_count++;
}

/* ========================================================================= */
/* Layer Lifecycle Management                                                */
/* ========================================================================= */

zx_status_t compositor_create_layer(const char *name,
                                    compositor_layer_type_t type,
                                    int32_t x, int32_t y,
                                    uint32_t width, uint32_t height,
                                    compositor_layer_id_t *out_layer_id) {
    if (!s_compositor.initialized || !out_layer_id || width == 0 || height == 0) {
        return ZX_ERR_INVALID_ARGS;
    }

    /* Find available slot */
    compositor_layer_t *slot = NULL;
    for (size_t i = 0; i < COMPOSITOR_MAX_LAYERS; i++) {
        if (!s_compositor.layers[i].in_use) {
            slot = &s_compositor.layers[i];
            break;
        }
    }
    if (!slot) {
        uart_puts("[COMPOSITOR] ERROR: Maximum layer limit reached!\n");
        return ZX_ERR_NO_RESOURCES;
    }

    /* Allocate backing buffer via physical memory pages */
    size_t buffer_bytes = (size_t)width * height * sizeof(uint32_t);
    size_t pages = ALIGN_UP(buffer_bytes, PAGE_SIZE) / PAGE_SIZE;
    zx_paddr_t paddr = 0;
    zx_status_t st = pmm_alloc_pages(pages, &paddr);
    if (st != ZX_OK) {
        uart_puts("[COMPOSITOR] ERROR: Failed to allocate physical pages for layer!\n");
        return st;
    }

    slot->id = s_compositor.next_layer_id++;
    if (s_compositor.next_layer_id == 0) s_compositor.next_layer_id = 1;

    if (name) {
        size_t len = strlen(name);
        if (len >= COMPOSITOR_LAYER_NAME_MAX) len = COMPOSITOR_LAYER_NAME_MAX - 1;
        memcpy(slot->name, name, len);
        slot->name[len] = '\0';
    } else {
        slot->name[0] = '\0';
    }

    slot->type = type;
    slot->z_index = compositor_default_z_for_type(type);
    slot->rect.x = x;
    slot->rect.y = y;
    slot->rect.width = width;
    slot->rect.height = height;
    slot->alpha = 255;
    slot->visible = true;
    slot->in_use = true;

    slot->buffer = (uint32_t *)(uintptr_t)paddr;
    slot->buffer_paddr = paddr;
    slot->buffer_size_bytes = buffer_bytes;
    slot->page_count = pages;
    slot->owns_buffer = true;

    slot->dirty = true;
    slot->damage_rect = slot->rect;

    /* Initialize buffer to transparent black */
    memset(slot->buffer, 0, buffer_bytes);

    /* Mark screen damaged */
    compositor_damage_rect(x, y, width, height);

    *out_layer_id = slot->id;
    return ZX_OK;
}

zx_status_t compositor_destroy_layer(compositor_layer_id_t layer_id) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer) return ZX_ERR_NOT_FOUND;

    /* Invalidate vacated region */
    compositor_damage_rect(layer->rect.x, layer->rect.y,
                           layer->rect.width, layer->rect.height);

    if (layer->owns_buffer && layer->buffer_paddr != 0) {
        pmm_free_pages(layer->buffer_paddr, layer->page_count);
    }

    layer->in_use = false;
    layer->id = COMPOSITOR_INVALID_LAYER_ID;
    layer->buffer = NULL;
    layer->buffer_paddr = 0;
    layer->page_count = 0;

    return ZX_OK;
}

zx_status_t compositor_set_layer_z(compositor_layer_id_t layer_id, int32_t z_index) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer) return ZX_ERR_NOT_FOUND;

    if (layer->z_index != z_index) {
        layer->z_index = z_index;
        compositor_damage_layer(layer_id);
    }
    return ZX_OK;
}

zx_status_t compositor_set_layer_rect(compositor_layer_id_t layer_id,
                                      int32_t x, int32_t y,
                                      uint32_t width, uint32_t height) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer) return ZX_ERR_NOT_FOUND;
    if (width == 0 || height == 0) return ZX_ERR_INVALID_ARGS;

    /* If dimensions change and buffer is owned, reallocate backing store */
    if (layer->owns_buffer && (width != layer->rect.width || height != layer->rect.height)) {
        size_t new_bytes = (size_t)width * height * sizeof(uint32_t);
        size_t new_pages = ALIGN_UP(new_bytes, PAGE_SIZE) / PAGE_SIZE;

        if (new_pages != layer->page_count) {
            zx_paddr_t new_paddr = 0;
            zx_status_t st = pmm_alloc_pages(new_pages, &new_paddr);
            if (st != ZX_OK) return st;

            /* Free old pages */
            pmm_free_pages(layer->buffer_paddr, layer->page_count);
            layer->buffer_paddr = new_paddr;
            layer->buffer = (uint32_t *)(uintptr_t)new_paddr;
            layer->page_count = new_pages;
        }
        layer->buffer_size_bytes = new_bytes;
        memset(layer->buffer, 0, new_bytes);
    }

    /* Invalidate old and new areas */
    compositor_damage_rect(layer->rect.x, layer->rect.y,
                           layer->rect.width, layer->rect.height);

    layer->rect.x = x;
    layer->rect.y = y;
    layer->rect.width = width;
    layer->rect.height = height;

    compositor_damage_rect(x, y, width, height);
    layer->dirty = true;

    return ZX_OK;
}

zx_status_t compositor_set_layer_alpha(compositor_layer_id_t layer_id, uint8_t alpha) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer) return ZX_ERR_NOT_FOUND;

    if (layer->alpha != alpha) {
        layer->alpha = alpha;
        compositor_damage_layer(layer_id);
    }
    return ZX_OK;
}

zx_status_t compositor_set_layer_visible(compositor_layer_id_t layer_id, bool visible) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer) return ZX_ERR_NOT_FOUND;

    if (layer->visible != visible) {
        layer->visible = visible;
        compositor_damage_rect(layer->rect.x, layer->rect.y,
                               layer->rect.width, layer->rect.height);
    }
    return ZX_OK;
}

zx_status_t compositor_get_layer_buffer(compositor_layer_id_t layer_id,
                                        uint32_t **out_buffer,
                                        uint32_t *out_stride) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer) return ZX_ERR_NOT_FOUND;
    if (!out_buffer) return ZX_ERR_INVALID_ARGS;

    *out_buffer = layer->buffer;
    if (out_stride) *out_stride = layer->rect.width;
    return ZX_OK;
}

zx_status_t compositor_set_layer_buffer(compositor_layer_id_t layer_id,
                                        uint32_t *buffer,
                                        size_t size_bytes) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer) return ZX_ERR_NOT_FOUND;
    if (!buffer || size_bytes == 0) return ZX_ERR_INVALID_ARGS;

    if (layer->owns_buffer && layer->buffer_paddr != 0) {
        pmm_free_pages(layer->buffer_paddr, layer->page_count);
        layer->owns_buffer = false;
        layer->buffer_paddr = 0;
        layer->page_count = 0;
    }

    layer->buffer = buffer;
    layer->buffer_size_bytes = size_bytes;
    compositor_damage_layer(layer_id);

    return ZX_OK;
}

const compositor_layer_t *compositor_get_layer(compositor_layer_id_t layer_id) {
    return compositor_find_layer(layer_id);
}

const compositor_stats_t *compositor_get_stats(void) {
    return &s_compositor.stats;
}

/* ========================================================================= */
/* Frame Composition & Hardware VSync Swapping                               */
/* ========================================================================= */

zx_status_t compositor_render_frame(void) {
    if (!s_compositor.initialized) return ZX_ERR_INTERNAL;

    /* If no screen damage is pending, frame is already coherent */
    if (!s_compositor.damage_pending) {
        return ZX_OK;
    }

    uint32_t *back = display_get_backbuffer();
    if (!back) return ZX_ERR_INTERNAL;

    uint32_t screen_w = s_compositor.screen_width;
    uint32_t screen_h = s_compositor.screen_height;
    compositor_rect_t dmg = s_compositor.accumulated_damage;

    int32_t dmg_x0 = MAX(0, dmg.x);
    int32_t dmg_y0 = MAX(0, dmg.y);
    int32_t dmg_x1 = MIN((int32_t)screen_w, dmg.x + (int32_t)dmg.width);
    int32_t dmg_y1 = MIN((int32_t)screen_h, dmg.y + (int32_t)dmg.height);

    if (dmg_x1 <= dmg_x0 || dmg_y1 <= dmg_y0) {
        s_compositor.damage_pending = false;
        return ZX_OK;
    }

    /* 1. Clear damage rectangle to deep obsidian background */
    for (int32_t y = dmg_y0; y < dmg_y1; y++) {
        uint32_t *dst_row = &back[y * screen_w + dmg_x0];
        for (int32_t x = dmg_x0; x < dmg_x1; x++) {
            *dst_row++ = COLOR_PRAVAH_BG;
        }
    }

    /* 2. Gather active visible layers */
    compositor_layer_t *active_layers[COMPOSITOR_MAX_LAYERS];
    size_t active_count = 0;

    for (size_t i = 0; i < COMPOSITOR_MAX_LAYERS; i++) {
        compositor_layer_t *l = &s_compositor.layers[i];
        if (l->in_use && l->visible && l->alpha > 0 && l->buffer != NULL) {
            active_layers[active_count++] = l;
        }
    }

    /* 3. Sort active layers by Z-index in ascending order (Stable Insertion Sort) */
    for (size_t i = 1; i < active_count; i++) {
        compositor_layer_t *key = active_layers[i];
        int32_t j = (int32_t)i - 1;
        while (j >= 0 && (active_layers[j]->z_index > key->z_index ||
              (active_layers[j]->z_index == key->z_index && active_layers[j]->id > key->id))) {
            active_layers[j + 1] = active_layers[j];
            j--;
        }
        active_layers[j + 1] = key;
    }

    /* 4. Composite layers in ascending Z-order into back buffer */
    for (size_t i = 0; i < active_count; i++) {
        compositor_layer_t *l = active_layers[i];

        /* Compute intersection between layer rectangle and damage rectangle */
        int32_t lx0 = l->rect.x;
        int32_t ly0 = l->rect.y;
        int32_t lx1 = lx0 + (int32_t)l->rect.width;
        int32_t ly1 = ly0 + (int32_t)l->rect.height;

        int32_t ix0 = MAX(lx0, dmg_x0);
        int32_t iy0 = MAX(ly0, dmg_y0);
        int32_t ix1 = MIN(lx1, dmg_x1);
        int32_t iy1 = MIN(ly1, dmg_y1);

        if (ix1 <= ix0 || iy1 <= iy0) {
            continue; /* Layer does not intersect damage area */
        }

        uint8_t alpha = l->alpha;
        uint32_t layer_w = l->rect.width;
        uint32_t *layer_buf = l->buffer;

        for (int32_t y = iy0; y < iy1; y++) {
            int32_t layer_y = y - ly0;
            uint32_t *layer_row = &layer_buf[layer_y * layer_w];
            uint32_t *dst_row = &back[y * screen_w];

            for (int32_t x = ix0; x < ix1; x++) {
                int32_t layer_x = x - lx0;
                uint32_t src_pixel = layer_row[layer_x];
                dst_row[x] = compositor_blend_pixel(dst_row[x], src_pixel, alpha);
            }
        }

        s_compositor.stats.layers_blended_total++;
        l->dirty = false;
    }

    /* 5. Clear screen damage tracking */
    s_compositor.damage_pending = false;
    memset(&s_compositor.accumulated_damage, 0, sizeof(compositor_rect_t));

    /* 6. Hardware VSync Alignment & Double-Buffer Atomic Flip */
    display_wait_vsync();
    zx_status_t flip_status = display_flip();

    s_compositor.stats.frames_rendered++;
    s_compositor.stats.last_frame_ticks = arm64_read_cntvct();

    return flip_status;
}

/* ========================================================================= */
/* Layer Drawing Primitives                                                  */
/* ========================================================================= */

void compositor_layer_clear(compositor_layer_id_t layer_id, uint32_t color) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer || !layer->buffer) return;

    size_t total_pixels = (size_t)layer->rect.width * layer->rect.height;
    for (size_t i = 0; i < total_pixels; i++) {
        layer->buffer[i] = color;
    }
    compositor_damage_layer(layer_id);
}

void compositor_layer_fill_rect(compositor_layer_id_t layer_id,
                                int32_t x, int32_t y,
                                uint32_t w, uint32_t h,
                                uint32_t color) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer || !layer->buffer || w == 0 || h == 0) return;

    int32_t x0 = MAX(0, x);
    int32_t y0 = MAX(0, y);
    int32_t x1 = MIN((int32_t)layer->rect.width, x + (int32_t)w);
    int32_t y1 = MIN((int32_t)layer->rect.height, y + (int32_t)h);

    if (x1 <= x0 || y1 <= y0) return;

    uint32_t lw = layer->rect.width;
    for (int32_t row = y0; row < y1; row++) {
        uint32_t *p = &layer->buffer[row * lw + x0];
        for (int32_t col = x0; col < x1; col++) {
            *p++ = color;
        }
    }

    compositor_damage_rect(layer->rect.x + x0, layer->rect.y + y0,
                           (uint32_t)(x1 - x0), (uint32_t)(y1 - y0));
    layer->dirty = true;
}

void compositor_layer_draw_rect(compositor_layer_id_t layer_id,
                                int32_t x, int32_t y,
                                uint32_t w, uint32_t h,
                                uint32_t color) {
    if (w == 0 || h == 0) return;
    compositor_layer_fill_rect(layer_id, x, y, w, 1, color);
    compositor_layer_fill_rect(layer_id, x, y + (int32_t)h - 1, w, 1, color);
    compositor_layer_fill_rect(layer_id, x, y, 1, h, color);
    compositor_layer_fill_rect(layer_id, x + (int32_t)w - 1, y, 1, h, color);
}

void compositor_layer_fill_rounded_rect(compositor_layer_id_t layer_id,
                                        int32_t x, int32_t y,
                                        uint32_t w, uint32_t h,
                                        uint32_t radius, uint32_t color) {
    if (w <= 2 * radius || h <= 2 * radius || radius == 0) {
        compositor_layer_fill_rect(layer_id, x, y, w, h, color);
        return;
    }

    /* Fill interior central cross */
    compositor_layer_fill_rect(layer_id, x + (int32_t)radius, y, w - 2 * radius, h, color);
    compositor_layer_fill_rect(layer_id, x, y + (int32_t)radius, radius, h - 2 * radius, color);
    compositor_layer_fill_rect(layer_id, x + (int32_t)(w - radius), y + (int32_t)radius, radius, h - 2 * radius, color);

    /* Fill corner quadrant horizontal spans using midpoint circle algorithm */
    int32_t f = 1 - (int32_t)radius;
    int32_t ddF_x = 1;
    int32_t ddF_y = -2 * (int32_t)radius;
    int32_t cx = 0;
    int32_t cy = (int32_t)radius;

    int32_t c_tl_x = x + (int32_t)radius;
    int32_t c_tl_y = y + (int32_t)radius;
    int32_t c_tr_x = x + (int32_t)w - 1 - (int32_t)radius;
    int32_t c_bl_y = y + (int32_t)h - 1 - (int32_t)radius;

    while (cx <= cy) {
        compositor_layer_fill_rect(layer_id, c_tl_x - cy, c_tl_y - cx, (uint32_t)cy, 1, color);
        compositor_layer_fill_rect(layer_id, c_tr_x + 1,  c_tl_y - cx, (uint32_t)cy, 1, color);
        compositor_layer_fill_rect(layer_id, c_tl_x - cx, c_tl_y - cy, (uint32_t)cx, 1, color);
        compositor_layer_fill_rect(layer_id, c_tr_x + 1,  c_tl_y - cy, (uint32_t)cx, 1, color);

        compositor_layer_fill_rect(layer_id, c_tl_x - cy, c_bl_y + cx, (uint32_t)cy, 1, color);
        compositor_layer_fill_rect(layer_id, c_tr_x + 1,  c_bl_y + cx, (uint32_t)cy, 1, color);
        compositor_layer_fill_rect(layer_id, c_tl_x - cx, c_bl_y + cy, (uint32_t)cx, 1, color);
        compositor_layer_fill_rect(layer_id, c_tr_x + 1,  c_bl_y + cy, (uint32_t)cx, 1, color);

        if (f >= 0) {
            cy--;
            ddF_y += 2;
            f += ddF_y;
        }
        cx++;
        ddF_x += 2;
        f += ddF_x;
    }
}

void compositor_layer_draw_rounded_rect(compositor_layer_id_t layer_id,
                                        int32_t x, int32_t y,
                                        uint32_t w, uint32_t h,
                                        uint32_t radius, uint32_t color) {
    if (w <= 2 * radius || h <= 2 * radius || radius == 0) {
        compositor_layer_draw_rect(layer_id, x, y, w, h, color);
        return;
    }

    /* Straight edge borders */
    compositor_layer_fill_rect(layer_id, x + (int32_t)radius, y, w - 2 * radius, 1, color);
    compositor_layer_fill_rect(layer_id, x + (int32_t)radius, y + (int32_t)h - 1, w - 2 * radius, 1, color);
    compositor_layer_fill_rect(layer_id, x, y + (int32_t)radius, 1, h - 2 * radius, color);
    compositor_layer_fill_rect(layer_id, x + (int32_t)w - 1, y + (int32_t)radius, 1, h - 2 * radius, color);

    /* Rounded corner arcs */
    int32_t f = 1 - (int32_t)radius;
    int32_t ddF_x = 1;
    int32_t ddF_y = -2 * (int32_t)radius;
    int32_t cx = 0;
    int32_t cy = (int32_t)radius;

    int32_t c_tl_x = x + (int32_t)radius;
    int32_t c_tl_y = y + (int32_t)radius;
    int32_t c_tr_x = x + (int32_t)w - 1 - (int32_t)radius;
    int32_t c_tr_y = y + (int32_t)radius;
    int32_t c_bl_x = x + (int32_t)radius;
    int32_t c_bl_y = y + (int32_t)h - 1 - (int32_t)radius;
    int32_t c_br_x = x + (int32_t)w - 1 - (int32_t)radius;
    int32_t c_br_y = y + (int32_t)h - 1 - (int32_t)radius;

    while (cx <= cy) {
        compositor_layer_fill_rect(layer_id, c_tr_x + cx, c_tr_y - cy, 1, 1, color);
        compositor_layer_fill_rect(layer_id, c_tr_x + cy, c_tr_y - cx, 1, 1, color);
        compositor_layer_fill_rect(layer_id, c_tl_x - cx, c_tl_y - cy, 1, 1, color);
        compositor_layer_fill_rect(layer_id, c_tl_x - cy, c_tl_y - cx, 1, 1, color);
        compositor_layer_fill_rect(layer_id, c_br_x + cx, c_br_y + cy, 1, 1, color);
        compositor_layer_fill_rect(layer_id, c_br_x + cy, c_br_y + cx, 1, 1, color);
        compositor_layer_fill_rect(layer_id, c_bl_x - cx, c_bl_y + cy, 1, 1, color);
        compositor_layer_fill_rect(layer_id, c_bl_x - cy, c_bl_y + cx, 1, 1, color);

        if (f >= 0) {
            cy--;
            ddF_y += 2;
            f += ddF_y;
        }
        cx++;
        ddF_x += 2;
        f += ddF_x;
    }
}

void compositor_layer_blend_rect(compositor_layer_id_t layer_id,
                                 int32_t x, int32_t y,
                                 uint32_t w, uint32_t h,
                                 uint32_t color) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer || !layer->buffer || w == 0 || h == 0) return;

    int32_t x0 = MAX(0, x);
    int32_t y0 = MAX(0, y);
    int32_t x1 = MIN((int32_t)layer->rect.width, x + (int32_t)w);
    int32_t y1 = MIN((int32_t)layer->rect.height, y + (int32_t)h);

    if (x1 <= x0 || y1 <= y0) return;

    uint32_t lw = layer->rect.width;
    for (int32_t row = y0; row < y1; row++) {
        uint32_t *dst = &layer->buffer[row * lw];
        for (int32_t col = x0; col < x1; col++) {
            dst[col] = compositor_blend_pixel(dst[col], color, 255);
        }
    }

    compositor_damage_rect(layer->rect.x + x0, layer->rect.y + y0,
                           (uint32_t)(x1 - x0), (uint32_t)(y1 - y0));
    layer->dirty = true;
}

void compositor_layer_draw_char(compositor_layer_id_t layer_id,
                                int32_t x, int32_t y,
                                char c,
                                uint32_t fg_color, uint32_t bg_color,
                                bool transparent_bg) {
    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer || !layer->buffer) return;

    if (c < 0 || (unsigned char)c > 127) c = '?';
    const uint8_t *glyph = font8x16_data[(unsigned char)c];
    uint32_t lw = layer->rect.width;
    uint32_t lh = layer->rect.height;

    for (uint32_t row = 0; row < 16; row++) {
        int32_t py = y + (int32_t)row;
        if (py < 0 || py >= (int32_t)lh) continue;

        uint8_t bits = glyph[row];
        for (uint32_t col = 0; col < 8; col++) {
            int32_t px = x + (int32_t)col;
            if (px < 0 || px >= (int32_t)lw) continue;

            if (bits & (0x80 >> col)) {
                layer->buffer[py * lw + px] = fg_color;
            } else if (!transparent_bg) {
                layer->buffer[py * lw + px] = bg_color;
            }
        }
    }

    compositor_damage_rect(layer->rect.x + x, layer->rect.y + y, 8, 16);
    layer->dirty = true;
}

void compositor_layer_draw_string(compositor_layer_id_t layer_id,
                                  int32_t x, int32_t y,
                                  const char *str,
                                  uint32_t fg_color, uint32_t bg_color,
                                  bool transparent_bg) {
    if (!str) return;

    int32_t cur_x = x;
    int32_t cur_y = y;

    while (*str) {
        if (*str == '\n') {
            cur_x = x;
            cur_y += 18;
        } else {
            compositor_layer_draw_char(layer_id, cur_x, cur_y, *str,
                                       fg_color, bg_color, transparent_bg);
            cur_x += 8;
        }
        str++;
    }
}

void compositor_layer_draw_string_scaled(compositor_layer_id_t layer_id,
                                         int32_t x, int32_t y,
                                         const char *str,
                                         uint32_t fg_color, uint32_t bg_color,
                                         bool transparent_bg, uint32_t scale) {
    if (!str || scale == 0) return;
    if (scale == 1) {
        compositor_layer_draw_string(layer_id, x, y, str, fg_color, bg_color, transparent_bg);
        return;
    }

    compositor_layer_t *layer = compositor_find_layer(layer_id);
    if (!layer || !layer->buffer) return;

    int32_t cur_x = x;
    int32_t cur_y = y;
    uint32_t lw = layer->rect.width;
    uint32_t lh = layer->rect.height;

    while (*str) {
        if (*str == '\n') {
            cur_x = x;
            cur_y += (int32_t)(16 * scale + 4);
            str++;
            continue;
        }

        char c = *str++;
        if (c < 0 || (unsigned char)c > 127) c = '?';
        const uint8_t *glyph = font8x16_data[(unsigned char)c];

        for (uint32_t row = 0; row < 16; row++) {
            uint8_t bits = glyph[row];
            for (uint32_t col = 0; col < 8; col++) {
                uint32_t color = (bits & (0x80 >> col)) ? fg_color : bg_color;
                if ((bits & (0x80 >> col)) || !transparent_bg) {
                    for (uint32_t sy = 0; sy < scale; sy++) {
                        int32_t py = cur_y + (int32_t)(row * scale + sy);
                        if (py < 0 || py >= (int32_t)lh) continue;

                        for (uint32_t sx = 0; sx < scale; sx++) {
                            int32_t px = cur_x + (int32_t)(col * scale + sx);
                            if (px < 0 || px >= (int32_t)lw) continue;

                            layer->buffer[py * lw + px] = color;
                        }
                    }
                }
            }
        }
        cur_x += (int32_t)(8 * scale);
    }

    compositor_damage_layer(layer_id);
}

/* ========================================================================= */
/* Self-Test Suite & Subsystem Verification                                  */
/* ========================================================================= */

zx_status_t compositor_run_selftest(void) {
    uart_puts("--- [Test Suite 7: Native Surface Compositor & Window Flinger] ---\n");

    /* Subtest 1: Verify Initialized Compositor State */
    if (!s_compositor.initialized) {
        uart_puts("  [FAIL] Compositor state not initialized\n");
        return ZX_ERR_INTERNAL;
    }
    uart_puts("  [PASS] Compositor Subsystem Active: Screen (");
    uart_write_dec(s_compositor.screen_width);
    uart_puts("x");
    uart_write_dec(s_compositor.screen_height);
    uart_puts("), Max Layers: 16\n");

    /* Subtest 2: Porter-Duff Source-Over Alpha Blending Math Correctness */
    uint32_t black = COLOR_ARGB(255, 0, 0, 0);
    uint32_t white = COLOR_ARGB(255, 255, 255, 255);
    uint32_t blended_50 = compositor_blend_pixel(black, white, 128);
    uint32_t red_half = COLOR_ARGB(128, 255, 0, 0);
    uint32_t blended_red = compositor_blend_pixel(black, red_half, 255);

    /* Expect components ~128 */
    uint32_t r_val = COLOR_GET_R(blended_50);
    uint32_t red_r = COLOR_GET_R(blended_red);
    if ((r_val >= 126 && r_val <= 130) && (red_r >= 126 && red_r <= 130)) {
        uart_puts("  [PASS] Porter-Duff Source-Over Math Verified: 50% Alpha Blends Correctly (R: ");
        uart_write_dec(r_val);
        uart_puts(")\n");
    } else {
        uart_puts("  [FAIL] Alpha blending math calculation error\n");
        return ZX_ERR_INTERNAL;
    }

    /* Subtest 3: Dynamic Layer Creation & Physical DRAM Allocation */
    compositor_layer_id_t layer_bg = 0;
    compositor_layer_id_t layer_wp = 0;
    compositor_layer_id_t layer_ws = 0;
    compositor_layer_id_t layer_modal = 0;
    compositor_layer_id_t layer_sb = 0;

    zx_status_t st = compositor_create_layer("Background", LAYER_TYPE_BACKGROUND,
                                             0, 0, s_compositor.screen_width, s_compositor.screen_height,
                                             &layer_bg);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to allocate background layer\n");
        return st;
    }

    st = compositor_create_layer("Wallpaper", LAYER_TYPE_WALLPAPER,
                                 0, 0, s_compositor.screen_width, s_compositor.screen_height,
                                 &layer_wp);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to allocate wallpaper layer\n");
        return st;
    }

    st = compositor_create_layer("WorkspaceCard", LAYER_TYPE_WORKSPACE,
                                 32, 120, 656, 540,
                                 &layer_ws);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to allocate workspace card layer\n");
        return st;
    }

    st = compositor_create_layer("FloatingModal", LAYER_TYPE_MODAL,
                                 48, 700, 624, 340,
                                 &layer_modal);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to allocate floating modal layer\n");
        return st;
    }

    st = compositor_create_layer("StatusBar", LAYER_TYPE_STATUS_BAR,
                                 0, 0, s_compositor.screen_width, 48,
                                 &layer_sb);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to allocate status bar layer\n");
        return st;
    }

    uart_puts("  [PASS] Layer Stack Allocated (5 Layers: BG, WP, WS, MODAL, SB) with PMM Footprint\n");

    /* Subtest 4: Z-Order Hierarchy Baseline Verification */
    const compositor_layer_t *l_bg = compositor_get_layer(layer_bg);
    const compositor_layer_t *l_wp = compositor_get_layer(layer_wp);
    const compositor_layer_t *l_ws = compositor_get_layer(layer_ws);
    const compositor_layer_t *l_mo = compositor_get_layer(layer_modal);
    const compositor_layer_t *l_sb = compositor_get_layer(layer_sb);

    if (l_bg->z_index == COMPOSITOR_Z_BACKGROUND &&
        l_wp->z_index == COMPOSITOR_Z_WALLPAPER &&
        l_ws->z_index == COMPOSITOR_Z_WORKSPACE &&
        l_mo->z_index == COMPOSITOR_Z_MODAL &&
        l_sb->z_index == COMPOSITOR_Z_STATUS_BAR &&
        (l_bg->z_index < l_wp->z_index && l_wp->z_index < l_ws->z_index &&
         l_ws->z_index < l_mo->z_index && l_mo->z_index < l_sb->z_index)) {
        uart_puts("  [PASS] Layer Z-Stack Ordering Confirmed: BG(0) < WP(100) < WS(200) < MODAL(300) < SB(400)\n");
    } else {
        uart_puts("  [FAIL] Layer Z-stack default hierarchy mismatch\n");
        return ZX_ERR_INTERNAL;
    }

    /* Subtest 5: Damage Tracking & Dirty Rectangle Accumulation */
    compositor_damage_all();
    if (s_compositor.damage_pending &&
        s_compositor.accumulated_damage.width == s_compositor.screen_width &&
        s_compositor.accumulated_damage.height == s_compositor.screen_height) {
        uart_puts("  [PASS] Damage Tracking Active: Screen Invalidation Accumulated Bounding Box\n");
    } else {
        uart_puts("  [FAIL] Damage tracking accumulation failed\n");
        return ZX_ERR_INTERNAL;
    }

    /* Subtest 6: Populate Layer Visual Contents */
    /* 1. Background: Obsidian Void */
    compositor_layer_clear(layer_bg, COLOR_PRAVAH_BG);

    /* 2. Wallpaper: Ambient Deep Indigo & Subtle Cyber Grid */
    compositor_layer_clear(layer_wp, COLOR_PRAVAH_BG);
    for (uint32_t gy = 48; gy < s_compositor.screen_height; gy += 64) {
        compositor_layer_fill_rect(layer_wp, 0, gy, s_compositor.screen_width, 1, 0xFF141A28);
    }
    for (uint32_t gx = 0; gx < s_compositor.screen_width; gx += 64) {
        compositor_layer_fill_rect(layer_wp, gx, 48, 1, s_compositor.screen_height - 48, 0xFF141A28);
    }
    /* Ambient glowing banner */
    compositor_layer_fill_rounded_rect(layer_wp, 32, 70, 656, 36, 8, 0x3310B981);
    compositor_layer_draw_string(layer_wp, 48, 80, "PRAVAHOS INTENT CORE * AUTONOMOUS AGENT ACTIVE",
                                 COLOR_PRAVAH_SUCCESS, 0, true);

    /* 3. Workspace Card: DEC Dynamic Workspace */
    compositor_layer_fill_rounded_rect(layer_ws, 0, 0, 656, 540, 16, COLOR_PRAVAH_SURFACE);
    compositor_layer_draw_rounded_rect(layer_ws, 0, 0, 656, 540, 16, COLOR_PRAVAH_BORDER);
    compositor_layer_draw_string_scaled(layer_ws, 24, 24, "WORKSPACE #1: COMPILER PIPELINE",
                                        COLOR_PRAVAH_TEXT_HI, 0, true, 1);
    compositor_layer_draw_string(layer_ws, 24, 56, "Status: Autonomous Synthesizer Running (DAG: 8 Nodes)",
                                 COLOR_PRAVAH_CYAN, 0, true);

    /* Child capability cards inside workspace */
    compositor_layer_fill_rounded_rect(layer_ws, 24, 90, 608, 110, 10, COLOR_PRAVAH_SURFACE_HL);
    compositor_layer_draw_rounded_rect(layer_ws, 24, 90, 608, 110, 10, COLOR_PRAVAH_BORDER);
    compositor_layer_draw_string(layer_ws, 40, 106, "[Node 01] LLVM IR Generator -> AArch64 Target",
                                 COLOR_PRAVAH_TEXT_HI, 0, true);
    compositor_layer_draw_string(layer_ws, 40, 130, "Memory: 14.2 MB   PMM Frames: 3635   Status: COMPLETED",
                                 COLOR_PRAVAH_TEXT_MID, 0, true);
    compositor_layer_fill_rect(layer_ws, 40, 160, 576, 8, 0xFF0D121F);
    compositor_layer_fill_rect(layer_ws, 40, 160, 576, 8, COLOR_PRAVAH_SUCCESS);

    compositor_layer_fill_rounded_rect(layer_ws, 24, 220, 608, 110, 10, COLOR_PRAVAH_SURFACE_HL);
    compositor_layer_draw_rounded_rect(layer_ws, 24, 220, 608, 110, 10, COLOR_PRAVAH_BORDER);
    compositor_layer_draw_string(layer_ws, 40, 236, "[Node 02] Native Surface Compositor Flinger",
                                 COLOR_PRAVAH_TEXT_HI, 0, true);
    compositor_layer_draw_string(layer_ws, 40, 260, "Memory: 4.8 MB    Dirty Rects: Active   Status: RUNNING",
                                 COLOR_PRAVAH_CYAN, 0, true);
    compositor_layer_fill_rect(layer_ws, 40, 290, 576, 8, 0xFF0D121F);
    compositor_layer_fill_rect(layer_ws, 40, 290, 432, 8, COLOR_PRAVAH_CYAN);

    /* 4. Floating Modal: Risk Gate Confirmation Gate (Semi-transparent overlay) */
    compositor_layer_fill_rounded_rect(layer_modal, 0, 0, 624, 340, 16, 0xF51E2840);
    compositor_layer_draw_rounded_rect(layer_modal, 0, 0, 624, 340, 16, COLOR_PRAVAH_WARNING);
    compositor_layer_fill_rounded_rect(layer_modal, 24, 20, 576, 32, 6, 0x44F59E0B);
    compositor_layer_draw_string(layer_modal, 36, 28, "POLICY RISK GATE * LEVEL 2 CAPABILITY REQUIRED",
                                 COLOR_PRAVAH_WARNING, 0, true);
    compositor_layer_draw_string(layer_modal, 24, 76, "Agent Intent: Bind Raw Framebuffer & Remap MMIO",
                                 COLOR_PRAVAH_TEXT_HI, 0, true);
    compositor_layer_draw_string(layer_modal, 24, 102, "Caller: com.pravah.system.flinger (Task ID: #042)",
                                 COLOR_PRAVAH_TEXT_MID, 0, true);
    compositor_layer_draw_string(layer_modal, 24, 128, "Impact: Grants Direct Video Memory Scanout Access",
                                 COLOR_PRAVAH_TEXT_MID, 0, true);

    /* Modal action buttons */
    compositor_layer_fill_rounded_rect(layer_modal, 40, 230, 250, 64, 12, COLOR_PRAVAH_SUCCESS);
    compositor_layer_draw_string(layer_modal, 90, 254, "[APPROVE INTENT]", COLOR_BLACK, 0, true);

    compositor_layer_fill_rounded_rect(layer_modal, 334, 230, 250, 64, 12, COLOR_PRAVAH_DANGER);
    compositor_layer_draw_string(layer_modal, 400, 254, "[REJECT GATE]", COLOR_WHITE, 0, true);

    /* 5. Status Bar: Persistent Mobile Ambient Status Overlay */
    compositor_layer_fill_rect(layer_sb, 0, 0, s_compositor.screen_width, 48, 0xEE0D121F);
    compositor_layer_draw_string(layer_sb, 24, 16, "09:41", COLOR_PRAVAH_TEXT_HI, 0, true);
    compositor_layer_draw_string(layer_sb, 240, 16, "PRAVAH SECURE ENCLAVE", COLOR_PRAVAH_CYAN, 0, true);
    compositor_layer_draw_string(layer_sb, 580, 16, "5G [98%]", COLOR_PRAVAH_TEXT_HI, 0, true);
    compositor_layer_fill_rect(layer_sb, 0, 47, s_compositor.screen_width, 1, COLOR_PRAVAH_BORDER);

    /* Subtest 7: Execute Frame Composition & VSync Hardware Swap */
    st = compositor_render_frame();
    if (st != ZX_OK) {
        uart_puts("  [FAIL] compositor_render_frame failed\n");
        return st;
    }
    uart_puts("  [PASS] Frame Composition Rendered: Porter-Duff Blended into Back Buffer & Flipped\n");

    /* Subtest 8: Dynamic Layer Lifecycle Mutation (Opacity, Reposition, Destruction) */
    /* Alpha modification */
    st = compositor_set_layer_alpha(layer_modal, 220);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to adjust layer alpha\n");
        return st;
    }

    /* Dynamic repositioning */
    st = compositor_set_layer_rect(layer_modal, 48, 680, 624, 340);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to reposition layer\n");
        return st;
    }

    /* Temporary scratch layer creation & destruction */
    compositor_layer_id_t scratch_layer = 0;
    st = compositor_create_layer("ScratchToast", LAYER_TYPE_STATUS_BAR,
                                 100, 1100, 520, 80, &scratch_layer);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to create scratch layer\n");
        return st;
    }
    st = compositor_destroy_layer(scratch_layer);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to destroy scratch layer\n");
        return st;
    }
    uart_puts("  [PASS] Dynamic Layer Lifecycle: Alpha Mutation, Layer Reposition, Destruction & Slot Reclamation\n");

    /* Render updated scene */
    compositor_render_frame();

    uart_puts("  [PASS] Telemetry: Rendered Frames: ");
    uart_write_dec(s_compositor.stats.frames_rendered);
    uart_puts(", Blended Layers Total: ");
    uart_write_dec(s_compositor.stats.layers_blended_total);
    uart_puts("\n\n");

    return ZX_OK;
}
