/**
 * @file display.h
 * @brief PravahOS Linear Framebuffer & 2D Rasterizer Display Subsystem.
 *
 * Implements hardware display abstraction, double-buffered surface management,
 * ARGB8888 pixel formats, mobile portrait aspect ratios (720x1600 / 1080x2400),
 * 2D rasterization primitives, and built-in 8x16 bitmap font rendering for early
 * graphical boot and userspace Dynamic Experience Composer (DEC) presentation.
 */

#ifndef PRAVAH_KERNEL_DISPLAY_H
#define PRAVAH_KERNEL_DISPLAY_H

#include "kernel/types.h"
#include "kernel/memory.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* Mobile Portrait Aspect Ratios & Display Presets                           */
/* ========================================================================= */

/** Standard Mobile HD+ (20:9 Aspect Ratio) - Default Mobile Emulation */
#define DISPLAY_RES_MOBILE_HD_PLUS_W    (720)
#define DISPLAY_RES_MOBILE_HD_PLUS_H    (1600)

/** Mobile Full HD+ (20:9 Aspect Ratio) */
#define DISPLAY_RES_MOBILE_FHD_PLUS_W   (1080)
#define DISPLAY_RES_MOBILE_FHD_PLUS_H   (2400)

/** Mobile Quad HD+ (20:9 Aspect Ratio) */
#define DISPLAY_RES_MOBILE_QHD_PLUS_W   (1440)
#define DISPLAY_RES_MOBILE_QHD_PLUS_H   (3200)

/** Tablet / Desktop Widescreen Fallback (16:9) */
#define DISPLAY_RES_LANDSCAPE_W         (1280)
#define DISPLAY_RES_LANDSCAPE_H         (720)

/** PravahOS Default Target Configuration (Mobile HD+ 720x1600) */
#define DISPLAY_DEFAULT_WIDTH           DISPLAY_RES_MOBILE_HD_PLUS_W
#define DISPLAY_DEFAULT_HEIGHT          DISPLAY_RES_MOBILE_HD_PLUS_H
#define DISPLAY_DEFAULT_BPP             (32)
#define DISPLAY_DEFAULT_REFRESH_HZ      (60)

/* ========================================================================= */
/* Pixel Formats & Color Encodings (ARGB8888 32-bit Little-Endian)           */
/* ========================================================================= */

#define DISPLAY_FORMAT_ARGB8888         (0x01)
#define DISPLAY_FORMAT_XRGB8888         (0x02)
#define DISPLAY_FORMAT_RGBA8888         (0x03)
#define DISPLAY_FORMAT_RGB565           (0x04)

/** Pack 8-bit components into a 32-bit ARGB8888 integer */
#define COLOR_ARGB(a, r, g, b) \
    (((uint32_t)((a) & 0xFF) << 24) | \
     ((uint32_t)((r) & 0xFF) << 16) | \
     ((uint32_t)((g) & 0xFF) << 8)  | \
     ((uint32_t)((b) & 0xFF)))

/** Pack opaque RGB into 32-bit ARGB8888 */
#define COLOR_RGB(r, g, b) COLOR_ARGB(0xFF, (r), (g), (b))

/** Extract color channels */
#define COLOR_GET_A(c) (((uint32_t)(c) >> 24) & 0xFF)
#define COLOR_GET_R(c) (((uint32_t)(c) >> 16) & 0xFF)
#define COLOR_GET_G(c) (((uint32_t)(c) >> 8)  & 0xFF)
#define COLOR_GET_B(c) ((uint32_t)(c) & 0xFF)

/* ========================================================================= */
/* PravahOS Midnight Obsidian System Theme & UI Palette                      */
/* ========================================================================= */

#define COLOR_TRANSPARENT              (0x00000000U)
#define COLOR_BLACK                    (0xFF000000U)
#define COLOR_WHITE                    (0xFFFFFFFFU)

/* PravahOS Brand Obsidian Palette */
#define COLOR_PRAVAH_BG                (0xFF090D16U) /* Deep Obsidian Void */
#define COLOR_PRAVAH_SURFACE           (0xFF131A2AU) /* Elevated Surface Card */
#define COLOR_PRAVAH_SURFACE_HL        (0xFF1E2840U) /* Highlighted Surface */
#define COLOR_PRAVAH_BORDER            (0xFF263554U) /* Card Border Stroke */
#define COLOR_PRAVAH_BORDER_GLOW       (0xFF00E5FFU) /* Electric Cyan Glow */

/* Vibrant Accents */
#define COLOR_PRAVAH_CYAN              (0xFF00D4FFU) /* Primary Accent Cyan */
#define COLOR_PRAVAH_INDIGO            (0xFF6366F1U) /* Pravah Royal Indigo */
#define COLOR_PRAVAH_PURPLE            (0xFFA855F7U) /* Ambient Violet */
#define COLOR_PRAVAH_SUCCESS           (0xFF10B981U) /* Emerald Autonomous Safe */
#define COLOR_PRAVAH_WARNING           (0xFFF59E0BU) /* Amber Risk Gate */
#define COLOR_PRAVAH_DANGER            (0xFFEF4444U) /* Crimson Irreversible Stop */

/* Semantic Text Levels */
#define COLOR_PRAVAH_TEXT_HI           (0xFFF8FAFCU) /* 100% White High Emphasis */
#define COLOR_PRAVAH_TEXT_MID          (0xFF94A3B8U) /* 60% Slate Gray Secondary */
#define COLOR_PRAVAH_TEXT_LOW          (0xFF475569U) /* 30% Slate Gray Disabled */
#define COLOR_PRAVAH_STATUS_BAR        (0xFF0D121FU) /* Translucent Top Bar */

/* ========================================================================= */
/* Bitmap Font Dimensions                                                    */
/* ========================================================================= */

#define FONT_CHAR_WIDTH                (8)
#define FONT_CHAR_HEIGHT               (16)

/* ========================================================================= */
/* Display Controller Descriptor                                             */
/* ========================================================================= */

/**
 * @brief Linear Framebuffer and Display Controller Subsystem State.
 */
typedef struct display_info {
    uint32_t width;              /* Resolution width in pixels */
    uint32_t height;             /* Resolution height in pixels */
    uint32_t stride;             /* Scanline stride in pixels */
    uint32_t pitch;              /* Scanline pitch in bytes (stride * 4) */
    uint32_t bpp;                /* Bits per pixel (always 32 for ARGB8888) */
    uint32_t format;             /* Pixel format code (DISPLAY_FORMAT_ARGB8888) */
    uint32_t refresh_rate_hz;    /* Screen refresh rate in Hz (default 60) */

    /* Double-buffered surface pointers */
    uint32_t *front_buffer;      /* Scanned-out visible buffer */
    uint32_t *back_buffer;       /* Active offscreen rendering target */
    zx_paddr_t front_paddr;      /* Physical address of front buffer */
    zx_paddr_t back_paddr;       /* Physical address of back buffer */
    size_t   buffer_size_bytes;  /* Framebuffer memory footprint in bytes */

    /* Synchronization and state */
    uint64_t frame_count;        /* Monotonic frame flip sequence counter */
    bool     double_buffered;    /* True when back buffer is enabled */
    bool     hardware_bound;     /* True if bound to external HW (ramfb/virtio) */
    bool     initialized;        /* True once subsystem is bootstrapped */
} display_info_t;

/* ========================================================================= */
/* Subsystem Lifecycle & Configuration                                       */
/* ========================================================================= */

/**
 * @brief Initialize the default mobile portrait linear framebuffer (720x1600).
 *
 * Allocates front and back double-buffer surfaces from physical DRAM via PMM.
 *
 * @return ZX_OK on success, or error code on allocation failure.
 */
zx_status_t display_init(void);

/**
 * @brief Initialize custom display geometry or bind to hardware framebuffer.
 *
 * @param width Horizontal resolution in pixels.
 * @param height Vertical resolution in pixels.
 * @param hw_front_buffer Optional pointer to hardware MMIO front buffer (or NULL to allocate).
 * @param hw_paddr Physical base address of hardware buffer (0 if allocating).
 * @return ZX_OK on success, or error code.
 */
zx_status_t display_init_custom(uint32_t width, uint32_t height,
                               uint32_t *hw_front_buffer, zx_paddr_t hw_paddr);

/**
 * @brief Get read-only pointer to global display controller state.
 */
const display_info_t *display_get_info(void);

/**
 * @brief Get pointer to the back buffer (active off-screen drawing surface).
 */
uint32_t *display_get_backbuffer(void);

/**
 * @brief Get pointer to the front buffer (active scanout surface).
 */
uint32_t *display_get_frontbuffer(void);

/**
 * @brief Atomically flip back buffer contents to the front scanout buffer.
 *
 * Increments monotonic frame_count and synchronizes with frame pacing.
 *
 * @return ZX_OK on success.
 */
zx_status_t display_flip(void);

/**
 * @brief Synchronize with vertical refresh interval (simulated 60Hz pacing).
 */
void display_wait_vsync(void);

/* ========================================================================= */
/* 2D Rasterization Primitives                                               */
/* ========================================================================= */

/**
 * @brief Clear the entire back buffer to a solid ARGB8888 color.
 *
 * @param color 32-bit ARGB8888 clear color.
 */
void display_clear(uint32_t color);

/**
 * @brief Draw a single pixel on the back buffer with clipping.
 *
 * @param x Horizontal pixel position (0 = left).
 * @param y Vertical pixel position (0 = top).
 * @param color 32-bit ARGB8888 color.
 */
void display_draw_pixel(uint32_t x, uint32_t y, uint32_t color);

/**
 * @brief Read back a pixel from the back buffer with clipping.
 *
 * @param x Horizontal pixel position.
 * @param y Vertical pixel position.
 * @return 32-bit ARGB8888 color, or 0 if out of bounds.
 */
uint32_t display_get_pixel(uint32_t x, uint32_t y);

/**
 * @brief Draw a 1-pixel wide line using Bresenham's algorithm.
 *
 * @param x0 Starting X coordinate.
 * @param y0 Starting Y coordinate.
 * @param x1 Ending X coordinate.
 * @param y1 Ending Y coordinate.
 * @param color 32-bit ARGB8888 color.
 */
void display_draw_line(uint32_t x0, uint32_t y0, uint32_t x1, uint32_t y1, uint32_t color);

/**
 * @brief Draw a solid filled rectangle with clipping.
 *
 * @param x Left coordinate.
 * @param y Top coordinate.
 * @param w Width in pixels.
 * @param h Height in pixels.
 * @param color 32-bit ARGB8888 color.
 */
void display_fill_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);

/**
 * @brief Draw a 1-pixel wide wireframe rectangle.
 *
 * @param x Left coordinate.
 * @param y Top coordinate.
 * @param w Width in pixels.
 * @param h Height in pixels.
 * @param color 32-bit ARGB8888 color.
 */
void display_draw_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);

/**
 * @brief Draw a rounded rectangle outline.
 *
 * @param x Left coordinate.
 * @param y Top coordinate.
 * @param w Width in pixels.
 * @param h Height in pixels.
 * @param radius Corner radius in pixels.
 * @param color 32-bit ARGB8888 color.
 */
void display_draw_rounded_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                               uint32_t radius, uint32_t color);

/**
 * @brief Draw a solid filled rounded rectangle.
 *
 * @param x Left coordinate.
 * @param y Top coordinate.
 * @param w Width in pixels.
 * @param h Height in pixels.
 * @param radius Corner radius in pixels.
 * @param color 32-bit ARGB8888 color.
 */
void display_fill_rounded_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                               uint32_t radius, uint32_t color);

/* ========================================================================= */
/* Alpha Blending & Block Transfer (Blit)                                    */
/* ========================================================================= */

/**
 * @brief Compute Porter-Duff Source-Over alpha blend between destination and source.
 *
 * @param dst_col Existing destination pixel in ARGB8888.
 * @param src_col Incoming source pixel in ARGB8888.
 * @return Blended 32-bit ARGB8888 pixel.
 */
uint32_t display_blend_pixel(uint32_t dst_col, uint32_t src_col);

/**
 * @brief Blend a semi-transparent rectangle onto the back buffer.
 *
 * @param x Left coordinate.
 * @param y Top coordinate.
 * @param w Width in pixels.
 * @param h Height in pixels.
 * @param color 32-bit ARGB8888 color (alpha channel determines transparency).
 */
void display_blend_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);

/**
 * @brief Block-transfer an opaque rectangular sprite onto the back buffer.
 *
 * @param dst_x Destination X coordinate.
 * @param dst_y Destination Y coordinate.
 * @param src_pixels Pointer to source ARGB8888 pixels.
 * @param src_w Source width in pixels.
 * @param src_h Source height in pixels.
 * @param src_stride Source stride in pixels.
 */
void display_blit(uint32_t dst_x, uint32_t dst_y, const uint32_t *src_pixels,
                  uint32_t src_w, uint32_t src_h, uint32_t src_stride);

/**
 * @brief Block-transfer an alpha-blended sprite onto the back buffer.
 *
 * @param dst_x Destination X coordinate.
 * @param dst_y Destination Y coordinate.
 * @param src_pixels Pointer to source ARGB8888 pixels.
 * @param src_w Source width in pixels.
 * @param src_h Source height in pixels.
 * @param src_stride Source stride in pixels.
 */
void display_blit_alpha(uint32_t dst_x, uint32_t dst_y, const uint32_t *src_pixels,
                        uint32_t src_w, uint32_t src_h, uint32_t src_stride);

/* ========================================================================= */
/* Built-in 8x16 Bitmap Font Rendering                                       */
/* ========================================================================= */

/**
 * @brief Render an 8x16 ASCII glyph onto the back buffer.
 *
 * @param x Left position.
 * @param y Top position.
 * @param c ASCII character (0x20 - 0x7E).
 * @param fg_color Foreground color (glyph pixels).
 * @param bg_color Background color (when transparent_bg is false).
 * @param transparent_bg If true, background pixels are not overwritten.
 */
void display_draw_char(uint32_t x, uint32_t y, char c, uint32_t fg_color,
                       uint32_t bg_color, bool transparent_bg);

/**
 * @brief Render a null-terminated string onto the back buffer.
 *
 * Supports '\n' for newline cursor return.
 *
 * @param x Starting left position.
 * @param y Starting top position.
 * @param str Null-terminated ASCII string.
 * @param fg_color Foreground text color.
 * @param bg_color Background color.
 * @param transparent_bg If true, renders with transparent background.
 */
void display_draw_string(uint32_t x, uint32_t y, const char *str, uint32_t fg_color,
                         uint32_t bg_color, bool transparent_bg);

/**
 * @brief Render a string scaled by an integer factor (2x, 3x for headers).
 *
 * @param x Starting left position.
 * @param y Starting top position.
 * @param str Null-terminated ASCII string.
 * @param fg_color Foreground text color.
 * @param bg_color Background color.
 * @param transparent_bg If true, renders with transparent background.
 * @param scale Integer scaling factor (e.g., 2 = 16x32 px per char).
 */
void display_draw_string_scaled(uint32_t x, uint32_t y, const char *str,
                               uint32_t fg_color, uint32_t bg_color,
                               bool transparent_bg, uint32_t scale);

/* ========================================================================= */
/* Bootscreen Presentation & Microkernel Self-Tests                          */
/* ========================================================================= */

/**
 * @brief Render the official PravahOS Mobile Bootscreen.
 *
 * Renders the top mobile status bar, battery badge, glowing Pravah logo,
 * system telemetry card, bootstrap checklist, and progress indicators.
 */
void display_render_bootscreen(void);

/**
 * @brief Execute the display subsystem self-test suite.
 *
 * Tests frame allocation, pixel read/write, alpha blending correctness,
 * font rendering, and bootscreen flip.
 *
 * @return ZX_OK if all display tests succeed.
 */
zx_status_t display_run_selftest(void);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_DISPLAY_H */
