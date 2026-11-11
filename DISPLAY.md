# PravahOS Linear Framebuffer & Display Subsystem

> **Target Architecture:** ARM64 (AArch64) • **Target Machines:** Bare-Metal & QEMU `virt` (GICv3)  
> **Subsystem Location:** `kernel/drivers/display/` & `kernel/include/kernel/display.h`  
> **FIDL Specification:** `sdk/fidl/pravah.display/display.fidl`

---

## 1. Architectural Overview & System Role

The **PravahOS Display Subsystem** provides high-performance, double-buffered graphical presentation across all phases of the operating system:
1. **Early Boot & Diagnostics (EL1 Microkernel):** Immediate graphical bootscreen rendering, architecture telemetry cards, and subsystem validation diagnostics rendered directly to physical DRAM surfaces before user-space initialization.
2. **User-Space Scenic / Flatland Compositor (EL0 Userspace):** Serviced via the capability-secure `pravah.display.DisplayCoordinator` FIDL protocol, allowing user-space shells such as the **Dynamic Experience Composer (DEC)** to map Virtual Memory Objects (VMOs) directly into framebuffers for zero-copy presentation.

```
+-----------------------------------------------------------------------------------+
|               DYNAMIC EXPERIENCE COMPOSER (DEC) / SCENIC (EL0)                   |
|        Task Workspaces  •  Approval Modals  •  Ambient Telemetry Drawer           |
+-----------------------------------------------------------------------------------+
                                       ▲  FIDL (pravah.display.DisplayCoordinator)
                                       │  - AllocateFrameBuffer (VMO Handles)
                                       │  - PresentFrame (Acquire/Release Fences)
                                       │  - OnVSync Events (60 Hz / 120 Hz)
                                       ▼
+-----------------------------------------------------------------------------------+
|                        PRAVAHOS MICROKERNEL (EL1)                                 |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                 Linear Framebuffer Subsystem (display.c)                    |  |
|  |  - Double-Buffered Surface Pager (Front Buffer / Back Buffer)               |  |
|  |  - 2D Rasterizer (Lines, Rectangles, Rounded Corners, Alpha Blending)      |  |
|  |  - Built-in 8x16 Monospace Bitmap Font Renderer                             |  |
|  |  - Official Mobile Bootscreen Layout Engine                                 |  |
|  +-----------------------------------------------------------------------------+  |
|                                       ▲                                           |
|                                       │ PMM Allocation / MMIO Remap               |
|                                       ▼                                           |
|  +-----------------------------------------------------------------------------+  |
|  |                       Hardware Display Abstraction                          |  |
|  |    QEMU ramfb  •  virtio-gpu-pci  •  ARM PrimeCell PL111  •  MIPI-DSI       |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                       ▲
                                       │ Scanout Scanline Video Stream
                                       ▼
+-----------------------------------------------------------------------------------+
|                     PHYSICAL / EMULATED DISPLAY HARDWARE                          |
|             720x1600 (Mobile HD+)  •  1080x2400 (Mobile FHD+)  •  20:9 Panel      |
+-----------------------------------------------------------------------------------+
```

---

## 2. Display Geometry & Mobile Aspect Ratios

PravahOS is designed for mobile-first and ambient autonomous devices. Modern mobile devices predominantly utilize tall **20:9** or **19.5:9** aspect ratios.

| Preset Identifier | Width | Height | Aspect Ratio | Pitch (Bytes) | Frame Size | Typical Target |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`DISPLAY_RES_MOBILE_HD_PLUS` (Default)** | **720** | **1600** | **20:9** | **2,880** | **4,608,000 B (~4.4 MiB)** | **Mobile Default / Emulation** |
| `DISPLAY_RES_MOBILE_FHD_PLUS` | 1080 | 2400 | 20:9 | 4,320 | 10,368,000 B (~9.9 MiB) | Flagship Mobile Emulation |
| `DISPLAY_RES_MOBILE_QHD_PLUS` | 1440 | 3200 | 20:9 | 5,760 | 18,432,000 B (~17.6 MiB) | Ultra-HD Mobile Panels |
| `DISPLAY_RES_LANDSCAPE` | 1280 | 720 | 16:9 | 5,120 | 3,686,400 B (~3.5 MiB) | Tablet / Desktop Fallback |

### Scanline Stride & Pitch Geometry
To guarantee cache alignment and support varying hardware controller requirements:
$$\text{stride} = \text{width in pixels}$$
$$\text{pitch} = \text{stride} \times \text{bytes\_per\_pixel} = \text{stride} \times 4$$
$$\text{frame\_size\_bytes} = \text{pitch} \times \text{height}$$

The linear framebuffer index for any pixel $(x, y)$ is calculated via:
$$\text{offset}(x, y) = y \times \text{stride} + x$$

---

## 3. Pixel Format & Color Architecture

PravahOS operates natively in **32-bit ARGB8888** format with Little-Endian memory layout:

```
31      24 23      16 15       8 7        0
+---------+---------+---------+---------+
|  Alpha  |   Red   |  Green  |  Blue   |
+---------+---------+---------+---------+
```

In Little-Endian memory byte sequence:
- Byte 0: **Blue** (`0x00 - 0xFF`)
- Byte 1: **Green** (`0x00 - 0xFF`)
- Byte 2: **Red** (`0x00 - 0xFF`)
- Byte 3: **Alpha** (`0x00 = Transparent, 0xFF = Fully Opaque`)

### Color Macros
```c
/* Pack components into 32-bit ARGB */
#define COLOR_ARGB(a, r, g, b) (((uint32_t)(a) << 24) | ((uint32_t)(r) << 16) | ((uint32_t)(g) << 8) | ((uint32_t)(b)))
#define COLOR_RGB(r, g, b)     COLOR_ARGB(0xFF, (r), (g), (b))

/* Channel extraction */
#define COLOR_GET_A(c) (((uint32_t)(c) >> 24) & 0xFF)
#define COLOR_GET_R(c) (((uint32_t)(c) >> 16) & 0xFF)
#define COLOR_GET_G(c) (((uint32_t)(c) >> 8)  & 0xFF)
#define COLOR_GET_B(c) ((uint32_t)(c) & 0xFF)
```

### PravahOS Obsidian System Theme Palette
The user interface features a dark aesthetic designed for high contrast and OLED power efficiency:

| Token | Hex Value | Semantic Role |
| :--- | :--- | :--- |
| `COLOR_PRAVAH_BG` | `0xFF090D16` | Deep Obsidian background void |
| `COLOR_PRAVAH_SURFACE` | `0xFF131A2A` | Elevated card / modal background |
| `COLOR_PRAVAH_SURFACE_HL`| `0xFF1E2840` | Highlighted card title / status header |
| `COLOR_PRAVAH_BORDER` | `0xFF263554` | Card border outline |
| `COLOR_PRAVAH_CYAN` | `0xFF00D4FF` | Primary brand accent & focus state |
| `COLOR_PRAVAH_INDIGO` | `0xFF6366F1` | Secondary brand accent & active nodes |
| `COLOR_PRAVAH_PURPLE` | `0xFFA855F7` | Ambient intelligence & intent indicator |
| `COLOR_PRAVAH_SUCCESS`| `0xFF10B981` | Emerald policy gate pass & battery full |
| `COLOR_PRAVAH_WARNING`| `0xFFF59E0B` | Amber review gate & cautionary state |
| `COLOR_PRAVAH_DANGER` | `0xFFEF4444` | Crimson irreversible barrier stop |
| `COLOR_PRAVAH_TEXT_HI` | `0xFFF8FAFC` | High-emphasis primary white text |
| `COLOR_PRAVAH_TEXT_MID`| `0xFF94A3B8` | Medium-emphasis slate gray text |

---

## 4. Double-Buffered Surface Management & Page Flipping

To eliminate screen tearing during frame redraws, PravahOS implements a **double-buffered architecture**:

1. **Front Buffer (`front_buffer`):** The visible surface currently scanned out to the physical panel or emulated window.
2. **Back Buffer (`back_buffer`):** The off-screen render target where all 2D primitives, fonts, and window compositions are drawn.
3. **PMM Allocation:** During early bootstrap, `display_init()` calculates the required 4 KiB frame count:
   $$\text{pages} = \frac{\text{ALIGN\_UP}(\text{frame\_size\_bytes}, 4096)}{4096}$$
   For $720 \times 1600$, $\text{pages} = 1125$. Front and back buffers are allocated from contiguous physical DRAM via `pmm_alloc_pages()`.
4. **Atomic Page Flip (`display_flip()`):**
   - Transmits the back buffer contents into the front buffer via an unrolled 64-bit word transfer (or updates the hardware display scanout base register if hardware page-flipping is bound).
   - Atomically increments the monotonic `s_display.frame_count` counter.
5. **VSync Synchronization (`display_wait_vsync()`):**
   - Reads the ARM64 physical timer counter register (`CNTVCT_EL0`) and system frequency (`CNTFRQ_EL0`).
   - Paces frames at exactly 60.0 Hz ($\sim 16.6\text{ ms}$ interval) using ARM `wfe` (Wait For Event) low-power instructions.

---

## 5. 2D Rasterization Primitives & Alpha Blending

The display subsystem includes a self-contained 2D graphics engine implemented with boundary clipping:

### 5.1 Basic Primitives
- **`display_clear(uint32_t color)`**: Clears the entire back buffer.
- **`display_draw_pixel(uint32_t x, uint32_t y, uint32_t color)`**: Bounds-checked pixel plot.
- **`display_get_pixel(uint32_t x, uint32_t y)`**: Reads back pixel value for testing and screen capture.
- **`display_draw_line(uint32_t x0, uint32_t y0, uint32_t x1, uint32_t y1, uint32_t color)`**: Bresenham's integer line algorithm supporting all octants.
- **`display_fill_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color)`**: Clipped horizontal scanline block fills.
- **`display_draw_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color)`**: Wireframe 1-pixel rectangle outline.

### 5.2 Rounded Rectangles
Modern mobile interfaces require rounded corners for cards, buttons, and status badges.
- **`display_draw_rounded_rect(x, y, w, h, radius, color)`**: Renders 4 straight borders and 4 quadrant arcs using the midpoint circle algorithm.
- **`display_fill_rounded_rect(x, y, w, h, radius, color)`**: Fills the central cross rectangle plus 4 corner spans.

### 5.3 Porter-Duff Source-Over Alpha Blending
Alpha blending enables translucent overlays, frosted glass dialogs, and smooth anti-aliased edges.
The engine calculates standard **Porter-Duff Source-Over**:

$$\alpha_{out} = \alpha_{src} + \alpha_{dst} \times \frac{255 - \alpha_{src}}{255}$$
$$C_{out} = \frac{C_{src} \times \alpha_{src} + C_{dst} \times (255 - \alpha_{src})}{255}$$

Where $C \in \{R, G, B\}$. The integer arithmetic runs without floating-point instructions (`-mgeneral-regs-only` safe).
- **`display_blend_rect(x, y, w, h, color)`**: Fills a rectangle with an alpha-blended tint.
- **`display_blit_alpha(...)`**: Block transfers an entire sprite with per-pixel alpha transparency.

---

## 6. Monospace 8x16 Bitmap Font Renderer

For early bootstrap output and headless debugging, the kernel embeds a full 128-character monospace bitmap font matrix (`kernel/drivers/display/font8x16.h`).

- **Glyph Resolution:** 8 horizontal pixels wide by 16 vertical pixels high.
- **Encoding:** 16 bytes per character, where bit 7 is the leftmost pixel of each row.
- **Functions:**
  - `display_draw_char(x, y, c, fg, bg, transparent_bg)`: Draws an individual ASCII glyph.
  - `display_draw_string(x, y, str, fg, bg, transparent_bg)`: Renders strings with automatic cursor positioning and `\n` line wraps.
  - `display_draw_string_scaled(x, y, str, fg, bg, transparent_bg, scale)`: Scales glyphs by an integer factor ($2\times, 3\times$) for prominent titles without blur.

---

## 7. Official PravahOS Mobile Bootscreen Layout

The bootscreen (`display_render_bootscreen()`) renders an autonomous mobile device UI directly on the $720 \times 1600$ back buffer:

```
+-------------------------------------------------------------+ (y=0)
|  09:41           (  O  *  )         [ OFFLINE ]   [||||] 98%| Status Bar (h=44)
+-------------------------------------------------------------+
|                                                             |
|                          /\                                 |
|                         /  \                                | Glowing Hexagonal
|                        |  * |                               | PravahOS Emblem
|                         \  /                                |
|                          \/                                 |
|                                                             |
|                       PRAVAH OS                             | Scaled Title (3x)
|         Autonomous • Intent-Driven • Offline-First          | Subtitle
|       ARM64 EL1 Microkernel  |  Zircon-Compatible ABI       | Architecture
|                                                             |
| +---------------------------------------------------------+ | (y=300)
| | >> SYSTEM ARCHITECTURE PROFILE <<                       | |
| |  CPU Profile    : ARM Cortex-A76 Quad-Core (EL1)        | | Telemetry Card
| |  Physical DRAM  : 4096 MiB (PMM 4 KiB Frame Geometry)   | | (h=200)
| |  Display Mode   : 720x1600 Portrait @ 60Hz ARGB8888     | |
| |  Surface Pager  : Double-Buffered / Zero-Tearing Flip   | |
| |  IPC Subsystem  : Bidirectional Channels & Capabilities| |
| +---------------------------------------------------------+ |
|                                                             |
| +---------------------------------------------------------+ | (y=520)
| | >> BOOTSTRAP SUBSYSTEM VERIFICATION <<                  | |
| |  [ OK ]     PL011 Early Serial Console Driver           | | Checklist Card
| |  [ OK ]     Physical Memory Manager (PMM Frames)        | | (h=330)
| |  [ OK ]     Virtual Memory Manager (ARM64 4-Level MMU)  | |
| |  [ OK ]     Capability Security & Handle Table          | |
| |  [ OK ]     Virtual Memory Objects (VMO Pager)          | |
| |  [ OK ]     Bidirectional Channel IPC Transfer          | |
| |  [ ACTIVE ] Linear Framebuffer & 2D Rasterizer          | |
| |  [ READY ]  Dynamic Experience Composer (DEC User-Shell)| |
| |  [ READY ]  Unified Intelligence Authority (UIA Agent)  | |
| +---------------------------------------------------------+ |
|                                                             |
| +---------------------------------------------------------+ | (y=870)
| | MICROKERNEL BOOT SEQUENCE                         100% | | Progress Bar
| | [=====================================================] | | (h=100)
| | Core bootstrap complete. Awaiting userspace root task.  | |
| +---------------------------------------------------------+ |
|                                                             |
|                         ───────                             | (y=1572) Home Pill
+-------------------------------------------------------------+ (y=1600)
```

---

## 8. FIDL Display Protocol (`pravah.display`)

Located in [`sdk/fidl/pravah.display/display.fidl`](file:///sdk/fidl/pravah.display/display.fidl), this interface connects the kernel display driver with userspace compositors (Scenic / Flatland).

### Key Protocol Methods
- **`GetDisplays()`**: Discovers physical display panels, dimensions, refresh rates, and orientations.
- **`SetDisplayMode(display_id, mode)`**: Switches display mode.
- **`AllocateFrameBuffer(display_id, width, height, format, double_buffered)`**: Allocates front and back buffer VMOs for zero-copy userspace rendering.
- **`PresentFrame(config)`**: Submits back-buffer for presentation, synchronized with hardware acquire and release fences.
- **`OnVSync(vsync)`**: Event stream delivering high-resolution microsecond timestamps for frame pacing.

---

## 9. Hardware Configuration & QEMU Target Launch

### 9.1 Headless Emulation (Default Serial Console)
```bash
powershell -ExecutionPolicy Bypass -File scripts/run_qemu.ps1
```
Runs in terminal-only mode (`-nographic -serial mon:stdio`), printing full serial test logs. The display subsystem allocates back and front buffers in physical memory and verifies 2D drawing and bootscreen rasterization via automated pixel readback checks.

### 9.2 Graphical Emulation (Mobile Display Window)
```bash
powershell -ExecutionPolicy Bypass -File scripts/run_qemu.ps1 -Graphical
```
Launches QEMU with graphical display hardware attached:
```bash
qemu-system-aarch64 \
  -M virt,gic-version=3 \
  -cpu cortex-a76 \
  -m 4096M \
  -smp 4 \
  -device ramfb \
  -device virtio-gpu-pci \
  -serial mon:stdio \
  -kernel build/zircon-arm64/zircon.bin
```

---

## 10. Verification & Test Metrics

During bootstrap, `display_run_selftest()` verifies the pipeline:
- **Geometry & Alignment:** Confirms 720x1600 resolution, 32bpp, and contiguous physical page allocation.
- **Direct Pixel Readback:** Writes `0xFF55AAFF` to $(100, 150)$ and reads it back from memory.
- **Alpha Blending:** Validates Porter-Duff math (Black + 50% White = `0xFF7F7F7F`).
- **Font Rasterization:** Tests glyph rendering and validates foreground pixel activation.
- **Bootscreen Flip:** Renders the complete mobile bootscreen and executes an atomic page flip.
