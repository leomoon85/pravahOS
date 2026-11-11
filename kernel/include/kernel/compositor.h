/**
 * @file compositor.h
 * @brief PravahOS Native Surface Compositor & Window Flinger Subsystem.
 *
 * Implements a high-performance, Z-ordered surface layer hierarchy, double-buffered
 * surface compositing with Porter-Duff Source-Over alpha blending, dirty rectangle
 * damage tracking, and hardware VSync-aligned presentation for mobile-first
 * and ambient autonomous devices.
 */

#ifndef PRAVAH_KERNEL_COMPOSITOR_H
#define PRAVAH_KERNEL_COMPOSITOR_H

#include "kernel/types.h"
#include "kernel/memory.h"
#include "kernel/display.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* Compositor Limits & Layer Hierarchy Configurations                         */
/* ========================================================================= */

#define COMPOSITOR_MAX_LAYERS          (16)
#define COMPOSITOR_LAYER_NAME_MAX      (32)
#define COMPOSITOR_INVALID_LAYER_ID    (0U)

/**
 * @brief PravahOS Surface Layer Hierarchy Classifications.
 *
 * Ordered conceptually from bottom to top of the screen:
 * 1. LAYER_TYPE_BACKGROUND: Base obsidian canvas / clearing layer
 * 2. LAYER_TYPE_WALLPAPER:  System wallpaper, ambient visuals & live shaders
 * 3. LAYER_TYPE_WORKSPACE:  Dynamic Experience Composer (DEC) task cards & apps
 * 4. LAYER_TYPE_MODAL:      Elevated confirmation dialogs & capability gates
 * 5. LAYER_TYPE_STATUS_BAR: Top persistent ambient bar & system toasts
 */
typedef enum {
    LAYER_TYPE_BACKGROUND = 0,
    LAYER_TYPE_WALLPAPER  = 1,
    LAYER_TYPE_WORKSPACE  = 2,
    LAYER_TYPE_MODAL      = 3,
    LAYER_TYPE_STATUS_BAR = 4,
    LAYER_TYPE_COUNT      = 5
} compositor_layer_type_t;

/** Default Z-Index baselines assigned by layer type */
#define COMPOSITOR_Z_BACKGROUND       (0)
#define COMPOSITOR_Z_WALLPAPER        (100)
#define COMPOSITOR_Z_WORKSPACE        (200)
#define COMPOSITOR_Z_MODAL            (300)
#define COMPOSITOR_Z_STATUS_BAR       (400)

/* ========================================================================= */
/* Compositor Geometry & Damage Tracking Types                               */
/* ========================================================================= */

/**
 * @brief 2D Rectangle structure for layer bounding boxes and dirty regions.
 */
typedef struct compositor_rect {
    int32_t  x;
    int32_t  y;
    uint32_t width;
    uint32_t height;
} compositor_rect_t;

/** Identifier handle for created compositor layers */
typedef uint32_t compositor_layer_id_t;

/**
 * @brief Surface layer descriptor in the compositor stack.
 */
typedef struct compositor_layer {
    compositor_layer_id_t   id;                         /* Unique numeric layer ID */
    char                    name[COMPOSITOR_LAYER_NAME_MAX]; /* Descriptive name */
    compositor_layer_type_t type;                       /* Hierarchy classification */
    int32_t                 z_index;                    /* Sorting order (ascending) */
    compositor_rect_t       rect;                       /* Position & dimensions */
    uint8_t                 alpha;                      /* Global opacity (0 = transparent, 255 = opaque) */
    bool                    visible;                    /* Presentation visibility toggle */
    bool                    in_use;                     /* Slot allocation marker */

    /* Surface pixel backing buffer */
    uint32_t               *buffer;                     /* ARGB8888 pixel array */
    zx_paddr_t              buffer_paddr;               /* Physical address if allocated via PMM */
    size_t                  buffer_size_bytes;          /* Buffer footprint in bytes */
    size_t                  page_count;                 /* Allocated physical pages count */
    bool                    owns_buffer;                /* True if allocated & freed by compositor */

    /* Damage tracking */
    bool                    dirty;                      /* True if layer contents modified */
    compositor_rect_t       damage_rect;                /* Local dirty region inside layer */
} compositor_layer_t;

/**
 * @brief Runtime telemetry and performance counters for the compositor.
 */
typedef struct compositor_stats {
    uint64_t frames_rendered;          /* Total successfully presented frames */
    uint64_t layers_blended_total;     /* Cumulative count of blended layer passes */
    uint64_t dirty_rects_composited;   /* Count of localized damaged passes */
    uint64_t full_redraws_count;       /* Count of fallback full screen compositions */
    uint64_t last_frame_ticks;         /* Timestamp of most recent frame presentation */
} compositor_stats_t;

/**
 * @brief Global compositor engine state.
 */
typedef struct compositor_state {
    bool                    initialized;
    uint32_t                screen_width;
    uint32_t                screen_height;
    compositor_layer_t      layers[COMPOSITOR_MAX_LAYERS];
    uint32_t                next_layer_id;

    /* Global screen damage accumulation */
    bool                    damage_pending;
    compositor_rect_t       accumulated_damage;

    compositor_stats_t      stats;
} compositor_state_t;

/* ========================================================================= */
/* Subsystem Lifecycle & Configuration                                       */
/* ========================================================================= */

/**
 * @brief Initialize the Native Surface Compositor subsystem.
 *
 * Synchronizes with display geometry and prepares surface layer tables.
 *
 * @return ZX_OK on success, or error code on failure.
 */
zx_status_t compositor_init(void);

/**
 * @brief Create a new surface layer in the compositor hierarchy.
 *
 * Allocates an ARGB8888 backing buffer from physical DRAM (PMM) sized
 * to (width * height * 4). Automatically assigns the default Z-index for
 * the specified layer type.
 *
 * @param name Descriptive layer name.
 * @param type Layer classification (BACKGROUND, WALLPAPER, WORKSPACE, MODAL, STATUS_BAR).
 * @param x Initial horizontal offset.
 * @param y Initial vertical offset.
 * @param width Layer width in pixels.
 * @param height Layer height in pixels.
 * @param[out] out_layer_id Pointer to receive the allocated layer ID handle.
 * @return ZX_OK on success, ZX_ERR_NO_MEMORY if DRAM exhausted, or error code.
 */
zx_status_t compositor_create_layer(const char *name,
                                    compositor_layer_type_t type,
                                    int32_t x, int32_t y,
                                    uint32_t width, uint32_t height,
                                    compositor_layer_id_t *out_layer_id);

/**
 * @brief Destroy an existing layer and reclaim its backing memory.
 *
 * @param layer_id Layer ID handle to destroy.
 * @return ZX_OK on success, or ZX_ERR_NOT_FOUND.
 */
zx_status_t compositor_destroy_layer(compositor_layer_id_t layer_id);

/**
 * @brief Update the Z-ordering index of an active layer.
 *
 * Layers with lower Z values are rendered first (beneath); layers with higher
 * Z values are composited on top.
 *
 * @param layer_id Layer ID handle.
 * @param z_index New integer Z index.
 * @return ZX_OK on success, or error code.
 */
zx_status_t compositor_set_layer_z(compositor_layer_id_t layer_id, int32_t z_index);

/**
 * @brief Reposition or resize an active layer.
 *
 * Automatically records damage rectangles for both the vacated screen region
 * and the newly occupied region to prevent visual artifacts.
 *
 * @param layer_id Layer ID handle.
 * @param x New horizontal offset.
 * @param y New vertical offset.
 * @param width New width in pixels.
 * @param height New height in pixels.
 * @return ZX_OK on success, or error code.
 */
zx_status_t compositor_set_layer_rect(compositor_layer_id_t layer_id,
                                      int32_t x, int32_t y,
                                      uint32_t width, uint32_t height);

/**
 * @brief Adjust the global opacity alpha of a surface layer.
 *
 * @param layer_id Layer ID handle.
 * @param alpha Opacity level (0 = fully transparent, 255 = fully opaque).
 * @return ZX_OK on success, or error code.
 */
zx_status_t compositor_set_layer_alpha(compositor_layer_id_t layer_id, uint8_t alpha);

/**
 * @brief Toggle the visibility state of a surface layer.
 *
 * @param layer_id Layer ID handle.
 * @param visible True to include in scene composition, false to skip.
 * @return ZX_OK on success, or error code.
 */
zx_status_t compositor_set_layer_visible(compositor_layer_id_t layer_id, bool visible);

/**
 * @brief Retrieve direct pointer to a layer's ARGB8888 backing buffer.
 *
 * @param layer_id Layer ID handle.
 * @param[out] out_buffer Pointer to receive the buffer memory address.
 * @param[out] out_stride Pointer to receive the scanline stride in pixels.
 * @return ZX_OK on success, or error code.
 */
zx_status_t compositor_get_layer_buffer(compositor_layer_id_t layer_id,
                                        uint32_t **out_buffer,
                                        uint32_t *out_stride);

/**
 * @brief Bind an external buffer (such as a shared userland VMO) to a layer.
 *
 * @param layer_id Layer ID handle.
 * @param buffer External ARGB8888 pixel buffer.
 * @param size_bytes Buffer size in bytes.
 * @return ZX_OK on success, or error code.
 */
zx_status_t compositor_set_layer_buffer(compositor_layer_id_t layer_id,
                                        uint32_t *buffer,
                                        size_t size_bytes);

/**
 * @brief Query read-only descriptor for an active layer.
 *
 * @param layer_id Layer ID handle.
 * @return Pointer to layer descriptor, or NULL if invalid.
 */
const compositor_layer_t *compositor_get_layer(compositor_layer_id_t layer_id);

/**
 * @brief Retrieve performance telemetry and render statistics.
 */
const compositor_stats_t *compositor_get_stats(void);

/**
 * @brief Get human-readable string for a layer type enum.
 */
const char *compositor_layer_type_name(compositor_layer_type_t type);

/* ========================================================================= */
/* Damage Rectangle Tracking & Dirty Region Invalidation                     */
/* ========================================================================= */

/**
 * @brief Mark the entire bounding area of a layer as damaged (dirty).
 *
 * @param layer_id Layer ID handle.
 * @return ZX_OK on success, or error code.
 */
zx_status_t compositor_damage_layer(compositor_layer_id_t layer_id);

/**
 * @brief Accumulate an arbitrary screen-space dirty rectangle.
 *
 * @param x Horizontal origin.
 * @param y Vertical origin.
 * @param width Width of dirty region.
 * @param height Height of dirty region.
 * @return ZX_OK on success.
 */
zx_status_t compositor_damage_rect(int32_t x, int32_t y, uint32_t width, uint32_t height);

/**
 * @brief Force invalidation of the entire display area (full redraw).
 */
void compositor_damage_all(void);

/* ========================================================================= */
/* Frame Composition & Hardware VSync Swapping                               */
/* ========================================================================= */

/**
 * @brief Render the current scene graph onto the display back buffer and flip.
 *
 * Sorts all visible layers by Z-index, executes Porter-Duff Source-Over alpha
 * blending for damaged regions, waits for vertical refresh synchronization
 * (VSync pacing), and atomically pushes pixels to the scanout surface via
 * `display_flip()`.
 *
 * @return ZX_OK on successful presentation, or error code.
 */
zx_status_t compositor_render_frame(void);

/* ========================================================================= */
/* Layer 2D Rasterization Primitives & Helper Drawing Routines               */
/* ========================================================================= */

/**
 * @brief Clear a layer's entire buffer to a solid ARGB8888 color.
 */
void compositor_layer_clear(compositor_layer_id_t layer_id, uint32_t color);

/**
 * @brief Fill a solid rectangle within layer coordinates.
 */
void compositor_layer_fill_rect(compositor_layer_id_t layer_id,
                                int32_t x, int32_t y,
                                uint32_t w, uint32_t h,
                                uint32_t color);

/**
 * @brief Draw a 1-pixel wireframe rectangle within layer coordinates.
 */
void compositor_layer_draw_rect(compositor_layer_id_t layer_id,
                                int32_t x, int32_t y,
                                uint32_t w, uint32_t h,
                                uint32_t color);

/**
 * @brief Fill a solid rounded rectangle with antialiased corner quadrants.
 */
void compositor_layer_fill_rounded_rect(compositor_layer_id_t layer_id,
                                        int32_t x, int32_t y,
                                        uint32_t w, uint32_t h,
                                        uint32_t radius, uint32_t color);

/**
 * @brief Draw a wireframe rounded rectangle outline.
 */
void compositor_layer_draw_rounded_rect(compositor_layer_id_t layer_id,
                                        int32_t x, int32_t y,
                                        uint32_t w, uint32_t h,
                                        uint32_t radius, uint32_t color);

/**
 * @brief Alpha-blend a translucent rectangle onto a layer's buffer.
 */
void compositor_layer_blend_rect(compositor_layer_id_t layer_id,
                                 int32_t x, int32_t y,
                                 uint32_t w, uint32_t h,
                                 uint32_t color);

/**
 * @brief Render an 8x16 ASCII glyph onto a layer.
 */
void compositor_layer_draw_char(compositor_layer_id_t layer_id,
                                int32_t x, int32_t y,
                                char c,
                                uint32_t fg_color, uint32_t bg_color,
                                bool transparent_bg);

/**
 * @brief Render a null-terminated string onto a layer.
 */
void compositor_layer_draw_string(compositor_layer_id_t layer_id,
                                  int32_t x, int32_t y,
                                  const char *str,
                                  uint32_t fg_color, uint32_t bg_color,
                                  bool transparent_bg);

/**
 * @brief Render a string scaled by an integer multiplier (e.g. 2x, 3x).
 */
void compositor_layer_draw_string_scaled(compositor_layer_id_t layer_id,
                                         int32_t x, int32_t y,
                                         const char *str,
                                         uint32_t fg_color, uint32_t bg_color,
                                         bool transparent_bg, uint32_t scale);

/* ========================================================================= */
/* Diagnostics & Microkernel Self-Tests                                      */
/* ========================================================================= */

/**
 * @brief Execute comprehensive Native Surface Compositor self-test suite.
 *
 * Validates layer allocation, Z-sorting, Porter-Duff source-over blending math,
 * damage accumulation, dynamic geometry mutations, and multi-layer presentation.
 *
 * @return ZX_OK on success, or error code on failure.
 */
zx_status_t compositor_run_selftest(void);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_COMPOSITOR_H */
