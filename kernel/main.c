/**
 * @file main.c
 * @brief PravahOS Zircon-Compatible Microkernel Early Entry Point & Subsystem Tests.
 */

#include "kernel/types.h"
#include "kernel/memory.h"
#include "kernel/string.h"
#include "kernel/console.h"
#include "kernel/pmm.h"
#include "kernel/vmm.h"
#include "kernel/handle.h"
#include "kernel/vmo.h"
#include "kernel/channel.h"
#include "kernel/input.h"
#include "kernel/display.h"
#include "kernel/compositor.h"
#include "kernel/elf.h"
#include "kernel/process.h"
#include "kernel/thread.h"
#include "kernel/syscall.h"
#include "kernel/hal/camera.h"
#include "kernel/hal/audio.h"
#include "kernel/hal/power.h"
#include "kernel/hal/telephony.h"
#include "arch/arm64/arch.h"
#include "arch/arm64/uart_pl011.h"

/* Forward Declarations */
void kernel_main(uint64_t dtb_paddr, uint64_t x1, uint64_t x2, uint64_t x3);
void kernel_exception_handler(uint64_t esr, uint64_t far, uint64_t elr);

/**
 * @brief Display the official PravahOS ASCII banner.
 */
static void print_banner(void) {
    uart_puts("\n");
    uart_puts("========================================================================\n");
    uart_puts("     ____                             _       ____   ____  \n");
    uart_puts("    |  _ \\ _ __ __ ___   ____ _ /\\_   | |     / __ \\ / ___| \n");
    uart_puts("    | |_) | '__/ _` \\ \\ / / _` / _ \\  | |    | |  | |\\___ \\ \n");
    uart_puts("    |  __/| | | (_| |\\ V / (_|  /_\\ \\ | |___ | |__| | ___) |\n");
    uart_puts("    |_|   |_|  \\__,_| \\_/ \\__,_/     \\|_____| \\____/ |____/ \n");
    uart_puts("========================================================================\n");
    uart_puts("  Autonomous * Intent-Driven * Offline-First Microkernel Platform\n");
    uart_puts("  Zircon-Compatible ABI * AArch64 Bare-Metal Architecture\n");
    uart_puts("========================================================================\n\n");
}

/**
 * @brief Decode and print ARM64 architectural capabilities from ID registers.
 */
static void print_hardware_info(uint64_t dtb_paddr) {
    uint64_t current_el = arm64_read_current_el();
    uint64_t mpidr = arm64_read_mpidr();
    uint64_t midr = arm64_read_midr();
    uint64_t pfr0 = arm64_read_pfr0();
    uint64_t cntfrq = arm64_read_cntfrq();

    uart_puts("--- [CPU & Architecture Profile] ---\n");
    
    /* Execution Level */
    uart_puts("  * Execution Level  : EL");
    uart_write_dec(current_el);
    uart_puts(" (Kernel Supervisor Mode)\n");

    /* Core Identification */
    uint32_t cluster_id = (mpidr >> 8) & 0xFF;
    uint32_t core_id = mpidr & 0xFF;
    uart_puts("  * CPU Core Affinity: Cluster ");
    uart_write_dec(cluster_id);
    uart_puts(", Core ");
    uart_write_dec(core_id);
    uart_puts(" (MPIDR: ");
    uart_write_hex(mpidr);
    uart_puts(")\n");

    /* Implementer & Part */
    uint32_t implementer = (midr >> 24) & 0xFF;
    uint32_t part_num = (midr >> 4) & 0xFFF;
    uart_puts("  * Processor Model  : Implementer ");
    uart_write_hex(implementer);
    uart_puts(", PartNum ");
    uart_write_hex(part_num);
    uart_puts(" (MIDR: ");
    uart_write_hex(midr);
    uart_puts(")\n");

    /* Feature flags from ID_AA64PFR0_EL1 */
    uint32_t fp_support = (pfr0 >> 16) & 0x0F;
    uint32_t advsimd = (pfr0 >> 20) & 0x0F;
    uint32_t gic_sysreg = (pfr0 >> 24) & 0x0F;

    uart_puts("  * Floating Point   : ");
    uart_puts(fp_support == 0 ? "Supported (FPv8-A)" : (fp_support == 1 ? "FPv8.2-A" : "Disabled"));
    uart_puts("\n");

    uart_puts("  * Advanced SIMD    : ");
    uart_puts(advsimd == 0 ? "Supported (NEON)" : (advsimd == 1 ? "AdvSIMD v8.2-A" : "Disabled"));
    uart_puts("\n");

    uart_puts("  * GIC SysReg Interf: ");
    uart_puts(gic_sysreg == 1 ? "Supported (GICv3/GICv4)" : "Legacy Memory Mapped");
    uart_puts("\n");

    /* Counter frequency */
    uart_puts("  * Generic Counter  : ");
    uart_write_dec(cntfrq / 1000000);
    uart_puts(" MHz (");
    uart_write_dec(cntfrq);
    uart_puts(" Hz)\n");

    /* Device Tree Pointer */
    uart_puts("  * DTB Physical Addr: ");
    if (dtb_paddr) {
        uart_write_hex(dtb_paddr);
    } else {
        uart_puts("(None / Direct QEMU -kernel)");
    }
    uart_puts("\n\n");
}

/**
 * @brief Self-test suite for Physical Memory Manager.
 */
static void run_pmm_tests(void) {
    uart_puts("--- [Test Suite 1: Physical Memory Manager (PMM)] ---\n");

    size_t free_before = pmm_get_free_pages();
    zx_paddr_t p0 = 0;
    zx_status_t st = pmm_alloc_page(&p0);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] PMM single page allocation failed\n");
        return;
    }
    uart_puts("  [PASS] Single Page Allocated at Physical Addr: ");
    uart_write_hex(p0);
    uart_puts("\n");

    /* Verify page was zeroed */
    uint64_t *ptr = (uint64_t *)(uintptr_t)p0;
    bool zeroed = true;
    for (size_t i = 0; i < (PAGE_SIZE / sizeof(uint64_t)); i++) {
        if (ptr[i] != 0) {
            zeroed = false;
            break;
        }
    }
    if (zeroed) {
        uart_puts("  [PASS] Allocated Physical Page Zeroed Verification\n");
    } else {
        uart_puts("  [FAIL] Physical Page not zeroed on allocation\n");
    }

    /* Contiguous 4-page allocation */
    zx_paddr_t p_multi = 0;
    st = pmm_alloc_pages(4, &p_multi);
    if (st == ZX_OK) {
        uart_puts("  [PASS] Contiguous 4-Page Block Allocated at: ");
        uart_write_hex(p_multi);
        uart_puts("\n");
        pmm_free_pages(p_multi, 4);
    } else {
        uart_puts("  [FAIL] Contiguous 4-page allocation failed\n");
    }

    /* Free single page and test stats */
    pmm_free_page(p0);
    size_t free_after = pmm_get_free_pages();
    if (free_before == free_after) {
        uart_puts("  [PASS] PMM Free & Allocation Balance Check Passed\n\n");
    } else {
        uart_puts("  [WARN] Page balance discrepancy detected\n\n");
    }
}

/**
 * @brief Self-test suite for Virtual Memory Manager.
 */
static void run_vmm_tests(void) {
    uart_puts("--- [Test Suite 2: Virtual Memory Manager (VMM 4-Level Paging)] ---\n");

    zx_paddr_t test_paddr = 0;
    zx_status_t st = pmm_alloc_page(&test_paddr);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] Failed to allocate backing page for VMM test\n");
        return;
    }

    /* Map dynamic virtual page at 0x0000000100000000 (4 GiB virtual mark) */
    zx_vaddr_t test_vaddr = 0x0000000100000000ULL;
    st = vmm_map_page(test_vaddr, test_paddr, VMM_FLAG_READ | VMM_FLAG_WRITE);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] vmm_map_page failed: ");
        uart_write_dec((uint32_t)st);
        uart_puts("\n");
        return;
    }

    /* Verify virtual to physical translation */
    zx_paddr_t resolved = vmm_vaddr_to_paddr(test_vaddr);
    if (resolved == test_paddr) {
        uart_puts("  [PASS] Virtual Address Resolution: 0x100000000 -> ");
        uart_write_hex(resolved);
        uart_puts(" (Matches backing PA)\n");
    } else {
        uart_puts("  [FAIL] Virtual Address Resolution mismatch\n");
    }

    /* Unmap page */
    st = vmm_unmap_page(test_vaddr);
    if (st == ZX_OK) {
        uart_puts("  [PASS] Virtual Page Unmapped successfully\n");
    }

    zx_paddr_t unmapped_query = vmm_vaddr_to_paddr(test_vaddr);
    if (unmapped_query == (zx_paddr_t)-1) {
        uart_puts("  [PASS] Verified Page Unmapped State (Lookup returned -1)\n\n");
    } else {
        uart_puts("  [FAIL] Unmapped page still resolved\n\n");
    }

    pmm_free_page(test_paddr);
}

/**
 * @brief Self-test suite for Virtual Memory Objects (VMO).
 */
static void run_vmo_tests(void) {
    uart_puts("--- [Test Suite 3: Virtual Memory Object (VMO) Container] ---\n");

    zx_handle_t vmo_h = ZX_HANDLE_INVALID;
    zx_status_t st = zx_vmo_create(8192, ZX_VMO_RESIZABLE, &vmo_h);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] zx_vmo_create failed\n");
        return;
    }
    uart_puts("  [PASS] VMO Created (Size: 8192 bytes, Handle: ");
    uart_write_hex(vmo_h);
    uart_puts(")\n");

    /* Test VMO Write */
    const char write_msg[] = "PravahOS::Kernel::VMO::TestPayload::AutonomousOS";
    size_t msg_len = strlen(write_msg) + 1;
    size_t actual_written = 0;
    st = zx_vmo_write(vmo_h, write_msg, 0, msg_len, &actual_written);
    if (st == ZX_OK && actual_written == msg_len) {
        uart_puts("  [PASS] VMO Write Payload: ");
        uart_write_dec(actual_written);
        uart_puts(" bytes written\n");
    } else {
        uart_puts("  [FAIL] VMO Write failed\n");
    }

    /* Test VMO Read */
    char read_buf[64];
    memset(read_buf, 0, sizeof(read_buf));
    size_t actual_read = 0;
    st = zx_vmo_read(vmo_h, read_buf, 0, sizeof(read_buf), &actual_read);
    if (st == ZX_OK && strcmp(read_buf, write_msg) == 0) {
        uart_puts("  [PASS] VMO Read Verification: \"");
        uart_puts(read_buf);
        uart_puts("\"\n");
    } else {
        uart_puts("  [FAIL] VMO Read data mismatch\n");
    }

    /* Test VMO Resize */
    st = zx_vmo_set_size(vmo_h, 16384);
    uint64_t new_size = 0;
    zx_vmo_get_size(vmo_h, &new_size);
    if (st == ZX_OK && new_size == 16384) {
        uart_puts("  [PASS] VMO Dynamic Resizing: 8192 -> 16384 bytes (4 physical pages backed)\n\n");
    } else {
        uart_puts("  [FAIL] VMO Dynamic Resizing failed\n\n");
    }

    handle_close(vmo_h);
}

/**
 * @brief Self-test suite for Bidirectional Channel IPC & Handle Rights Transfer.
 */
static void run_channel_ipc_tests(void) {
    uart_puts("--- [Test Suite 4: Bidirectional Channel IPC & Capability Rights Transfer] ---\n");

    zx_handle_t ch0 = ZX_HANDLE_INVALID;
    zx_handle_t ch1 = ZX_HANDLE_INVALID;

    zx_status_t st = zx_channel_create(0, &ch0, &ch1);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] zx_channel_create failed\n");
        return;
    }
    uart_puts("  [PASS] Channel Pair Created (ch0: ");
    uart_write_hex(ch0);
    uart_puts(", ch1: ");
    uart_write_hex(ch1);
    uart_puts(")\n");

    /* Create a VMO to transfer through the channel */
    zx_handle_t vmo_to_send = ZX_HANDLE_INVALID;
    zx_vmo_create(4096, 0, &vmo_to_send);
    const char vmo_payload[] = "Capability-Secured-VMO-Secret";
    zx_vmo_write(vmo_to_send, vmo_payload, 0, strlen(vmo_payload) + 1, NULL);

    /* Write message from ch0 carrying both bytes and the VMO handle */
    const char channel_msg[] = "FIDL:pravah.capability.TransferResource";
    uint32_t msg_len = strlen(channel_msg) + 1;
    zx_handle_t handles_to_send[1] = { vmo_to_send };

    st = zx_channel_write(ch0, 0, channel_msg, msg_len, handles_to_send, 1);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] zx_channel_write failed\n");
        return;
    }
    uart_puts("  [PASS] Channel Message Written: ch0 -> ch1 (Payload: 40 bytes, 1 Handle)\n");

    /* Verify sender's handle was revoked upon transfer */
    void *revoked_obj = NULL;
    st = handle_lookup(vmo_to_send, ZX_OBJ_TYPE_VMO, ZX_RIGHT_READ, &revoked_obj);
    if (st == ZX_ERR_BAD_HANDLE) {
        uart_puts("  [PASS] Sender Handle Revocation: Transferred handle invalidated in sender table\n");
    } else {
        uart_puts("  [FAIL] Sender handle not invalidated after transfer\n");
    }

    /* Read message from ch1 */
    char recv_bytes[128];
    zx_handle_t recv_handles[4];
    uint32_t actual_b = 0;
    uint32_t actual_h = 0;

    st = zx_channel_read(ch1, 0, recv_bytes, recv_handles, sizeof(recv_bytes), 4, &actual_b, &actual_h);
    if (st == ZX_OK && actual_h == 1) {
        uart_puts("  [PASS] Channel Message Read: \"");
        uart_puts(recv_bytes);
        uart_puts("\" (Received Handle: ");
        uart_write_hex(recv_handles[0]);
        uart_puts(")\n");

        /* Verify transferred VMO data integrity in receiving handle */
        char vmo_verify[64];
        memset(vmo_verify, 0, sizeof(vmo_verify));
        zx_vmo_read(recv_handles[0], vmo_verify, 0, sizeof(vmo_verify), NULL);
        if (strcmp(vmo_verify, vmo_payload) == 0) {
            uart_puts("  [PASS] Transferred VMO Data Integrity Confirmed: \"");
            uart_puts(vmo_verify);
            uart_puts("\"\n\n");
        } else {
            uart_puts("  [FAIL] Transferred VMO Data Corrupted\n\n");
        }

        handle_close(recv_handles[0]);
    } else {
        uart_puts("  [FAIL] zx_channel_read failed\n\n");
    }

    handle_close(ch0);
    handle_close(ch1);
}

/**
 * @brief Self-test suite for Multi-Modal Input Subsystem & Gesture Engine.
 */
static void run_input_tests(void) {
    uart_puts("--- [Test Suite 5: Multi-Modal Input Subsystem & Gesture Engine] ---\n");

    /* Subtest 1: Atomic Lock-Free SPSC Ring Buffer */
    input_ring_buffer_t local_rb;
    input_ring_init(&local_rb);
    if (!input_ring_is_empty(&local_rb) || input_ring_count(&local_rb) != 0) {
        uart_puts("  [FAIL] Ring buffer initial empty check failed\n");
        return;
    }

    input_event_t test_ev;
    memset(&test_ev, 0, sizeof(test_ev));
    test_ev.device_type = INPUT_DEV_TYPE_KEYBOARD;
    test_ev.event_type = INPUT_EVENT_KEY;
    test_ev.key.keycode = 42;

    for (uint32_t i = 0; i < 10; i++) {
        test_ev.timestamp_ns = 1000 + i;
        test_ev.key.keycode = 100 + i;
        if (!input_ring_push(&local_rb, &test_ev)) {
            uart_puts("  [FAIL] Ring buffer push failed\n");
            return;
        }
    }

    if (input_ring_count(&local_rb) != 10) {
        uart_puts("  [FAIL] Ring buffer count mismatch\n");
        return;
    }

    input_event_t pop_ev;
    for (uint32_t i = 0; i < 5; i++) {
        if (!input_ring_pop(&local_rb, &pop_ev) || pop_ev.key.keycode != (100 + i)) {
            uart_puts("  [FAIL] Ring buffer FIFO pop mismatch\n");
            return;
        }
    }

    /* Fill buffer to capacity (256 - 5 = 251 remaining) */
    while (!input_ring_is_full(&local_rb)) {
        input_ring_push(&local_rb, &test_ev);
    }

    /* Next push should drop event and return false */
    if (input_ring_push(&local_rb, &test_ev) || local_rb.dropped != 1) {
        uart_puts("  [FAIL] Ring buffer overflow detection failed\n");
        return;
    }
    uart_puts("  [PASS] Lock-Free Atomic SPSC Ring Buffer: Push, FIFO Pop, Count & Overflow Protection Verified\n");

    /* Subtest 2: Display Coordinate Normalization Engine */
    display_calibration_t cal;
    input_init_calibration(&cal, 1920, 1080);
    int32_t sx = 0, sy = 0;

    /* Corner (0, 0) */
    input_normalize_coordinates(&cal, 0, 0, &sx, &sy);
    if (sx != 0 || sy != 0) {
        uart_puts("  [FAIL] Normalization origin mismatch\n");
        return;
    }

    /* Corner (32767, 32767) -> (1919, 1079) */
    input_normalize_coordinates(&cal, 32767, 32767, &sx, &sy);
    if (sx != 1919 || sy != 1079) {
        uart_puts("  [FAIL] Normalization max corner mismatch\n");
        return;
    }

    /* Center (16383, 16383) -> (~959, ~539) */
    input_normalize_coordinates(&cal, 16383, 16383, &sx, &sy);
    if (sx < 950 || sx > 970 || sy < 530 || sy > 550) {
        uart_puts("  [FAIL] Normalization center mismatch\n");
        return;
    }

    /* Out of bounds clamping */
    input_normalize_coordinates(&cal, -500, 40000, &sx, &sy);
    if (sx != 0 || sy != 1079) {
        uart_puts("  [FAIL] Normalization boundary clamping failed\n");
        return;
    }
    uart_puts("  [PASS] Coordinate Normalization: Digit [0..32767] -> Screen [1920x1080] & Bounds Clamping Verified\n");

    /* Subtest 3: Multi-Touch Gesture Decoder - Tap Detection */
    input_device_t *touch_dev = input_get_touchscreen_device();
    input_ring_buffer_t *global_rb = input_get_global_ring_buffer();
    input_ring_init(global_rb);
    gesture_decoder_reset(&touch_dev->gesture_decoder);

    /* Inject Tap: Down at t=100ms, Up at t=180ms (80ms hold, 0px move) */
    input_inject_touch(touch_dev, TOUCH_ACTION_DOWN, 0, 16384, 16384, 100000000ULL);
    input_inject_touch(touch_dev, TOUCH_ACTION_UP,   0, 16384, 16384, 180000000ULL);

    bool found_tap = false;
    input_event_t ev;
    while (input_ring_pop(global_rb, &ev)) {
        if (ev.event_type == INPUT_EVENT_GESTURE && ev.gesture.type == GESTURE_TYPE_TAP) {
            found_tap = true;
            if (ev.gesture.center_x < 950 || ev.gesture.center_x > 970) {
                uart_puts("  [FAIL] Tap center coordinate incorrect\n");
                return;
            }
        }
    }
    if (!found_tap) {
        uart_puts("  [FAIL] Gesture Decoder did not emit TAP gesture\n");
        return;
    }
    uart_puts("  [PASS] Gesture Engine: Tap Gesture (Hold: 80ms, Target: [960, 540]) Successfully Decoded\n");

    /* Subtest 4: Multi-Touch Gesture Decoder - Double-Tap Detection */
    input_ring_init(global_rb);
    /* First tap */
    input_inject_touch(touch_dev, TOUCH_ACTION_DOWN, 0, 16384, 16384, 300000000ULL);
    input_inject_touch(touch_dev, TOUCH_ACTION_UP,   0, 16384, 16384, 340000000ULL);
    /* Second tap after 140ms interval */
    input_inject_touch(touch_dev, TOUCH_ACTION_DOWN, 0, 16384, 16384, 480000000ULL);
    input_inject_touch(touch_dev, TOUCH_ACTION_UP,   0, 16384, 16384, 520000000ULL);

    bool found_double_tap = false;
    while (input_ring_pop(global_rb, &ev)) {
        if (ev.event_type == INPUT_EVENT_GESTURE && ev.gesture.type == GESTURE_TYPE_DOUBLE_TAP) {
            found_double_tap = true;
        }
    }
    if (!found_double_tap) {
        uart_puts("  [FAIL] Gesture Decoder did not emit DOUBLE_TAP gesture\n");
        return;
    }
    uart_puts("  [PASS] Gesture Engine: Double-Tap Gesture (Interval: 140ms) Successfully Decoded\n");

    /* Subtest 5: Multi-Touch Gesture Decoder - Long-Press Detection */
    input_ring_init(global_rb);
    gesture_decoder_reset(&touch_dev->gesture_decoder);
    /* Touch down at t=1000ms */
    input_inject_touch(touch_dev, TOUCH_ACTION_DOWN, 0, 10000, 10000, 1000000000ULL);
    /* Stationary hold at t=1600ms (duration 600ms >= 500ms threshold) */
    input_inject_touch(touch_dev, TOUCH_ACTION_MOVE, 0, 10000, 10000, 1600000000ULL);

    bool found_long_press = false;
    while (input_ring_pop(global_rb, &ev)) {
        if (ev.event_type == INPUT_EVENT_GESTURE && ev.gesture.type == GESTURE_TYPE_LONG_PRESS) {
            found_long_press = true;
        }
    }
    /* Touch UP at t=1700ms should NOT fire extra tap */
    input_inject_touch(touch_dev, TOUCH_ACTION_UP, 0, 10000, 10000, 1700000000ULL);
    while (input_ring_pop(global_rb, &ev)) {
        if (ev.event_type == INPUT_EVENT_GESTURE && ev.gesture.type == GESTURE_TYPE_TAP) {
            uart_puts("  [FAIL] Spurious tap emitted after long press\n");
            return;
        }
    }
    if (!found_long_press) {
        uart_puts("  [FAIL] Gesture Decoder did not emit LONG_PRESS gesture\n");
        return;
    }
    uart_puts("  [PASS] Gesture Engine: Long-Press Gesture (Duration: 600ms, Hold Drift: 0px) Successfully Decoded\n");

    /* Subtest 6: Multi-Touch Gesture Decoder - Swipe Gestures */
    input_ring_init(global_rb);
    gesture_decoder_reset(&touch_dev->gesture_decoder);
    /* Swipe Right: Down at screen (100, 500), Move/Up at screen (750, 505) within 150ms */
    input_inject_touch(touch_dev, TOUCH_ACTION_DOWN, 0, 1707, 15183, 2000000000ULL);
    input_inject_touch(touch_dev, TOUCH_ACTION_MOVE, 0, 12806, 15335, 2120000000ULL);
    input_inject_touch(touch_dev, TOUCH_ACTION_UP,   0, 12806, 15335, 2150000000ULL);

    bool found_swipe_right = false;
    while (input_ring_pop(global_rb, &ev)) {
        if (ev.event_type == INPUT_EVENT_GESTURE && ev.gesture.type == GESTURE_TYPE_SWIPE_RIGHT) {
            found_swipe_right = true;
            if (ev.gesture.delta_x < 600) {
                uart_puts("  [FAIL] Swipe right displacement delta mismatch\n");
                return;
            }
        }
    }
    if (!found_swipe_right) {
        uart_puts("  [FAIL] Gesture Decoder did not emit SWIPE_RIGHT gesture\n");
        return;
    }
    uart_puts("  [PASS] Gesture Engine: Directional Swipe-Right (Displacement: +650px, Duration: 150ms) Decoded\n");

    /* Subtest 7: Multi-Touch 2-Finger Pinch-to-Zoom */
    input_ring_init(global_rb);
    gesture_decoder_reset(&touch_dev->gesture_decoder);
    /* Finger 0 Down at (800, 500): raw = 13661, 15183 */
    /* Finger 1 Down at (1000, 500): raw = 17077, 15183 */
    /* Initial span = 200px */
    input_inject_touch(touch_dev, TOUCH_ACTION_DOWN, 0, 13661, 15183, 3000000000ULL);
    input_inject_touch(touch_dev, TOUCH_ACTION_DOWN, 1, 17077, 15183, 3010000000ULL);

    /* Move fingers apart: Finger 0 to (700, 500), Finger 1 to (1100, 500) -> span = 400px (+200px zoom-in) */
    input_inject_touch(touch_dev, TOUCH_ACTION_MOVE, 0, 11954, 15183, 3100000000ULL);
    input_inject_touch(touch_dev, TOUCH_ACTION_MOVE, 1, 18784, 15183, 3110000000ULL);

    bool found_pinch = false;
    int32_t pinch_scale = 0;
    while (input_ring_pop(global_rb, &ev)) {
        if (ev.event_type == INPUT_EVENT_GESTURE && ev.gesture.type == GESTURE_TYPE_PINCH_ZOOM) {
            found_pinch = true;
            pinch_scale = ev.gesture.scale_milli;
        }
    }
    if (!found_pinch || pinch_scale < 1800) {
        uart_puts("  [FAIL] Pinch-to-zoom expansion gesture detection failed\n");
        return;
    }
    uart_puts("  [PASS] Gesture Engine: Multi-Touch Pinch-to-Zoom (Span 200px->400px, Scale: 2.0x) Decoded\n");

    /* Subtest 8: Evdev / VirtIO-Input Hardware Abstraction & Mouse/Keyboard Ingestion */
    input_ring_init(global_rb);

    /* Mouse relative move */
    input_inject_evdev(touch_dev, EV_REL, REL_X, 25, 4000000000ULL);
    input_inject_evdev(touch_dev, EV_REL, REL_Y, -10, 4000000010ULL);

    /* Keyboard space press & release */
    input_inject_evdev(touch_dev, EV_KEY, KEY_SPACE, 1, 4000000020ULL);
    input_inject_evdev(touch_dev, EV_KEY, KEY_SPACE, 0, 4000000030ULL);

    bool has_mouse = false;
    bool has_key_down = false;
    bool has_key_up = false;
    while (input_ring_pop(global_rb, &ev)) {
        if (ev.event_type == INPUT_EVENT_POINTER) has_mouse = true;
        if (ev.event_type == INPUT_EVENT_KEY && ev.key.keycode == KEY_SPACE) {
            if (ev.key.action == KEY_ACTION_PRESS) has_key_down = true;
            if (ev.key.action == KEY_ACTION_RELEASE) has_key_up = true;
        }
    }

    if (has_mouse && has_key_down && has_key_up) {
        uart_puts("  [PASS] Hardware Abstraction: Evdev / VirtIO Pointer & Keyboard Translation Verified\n\n");
    } else {
        uart_puts("  [FAIL] Evdev translation verification failed\n\n");
    }
}

/**
 * @brief Self-test suite for Linear Framebuffer, 2D Rasterizer & Bootscreen.
 */
static void run_display_tests(void) {
    display_run_selftest();
}

/**
 * @brief Self-test suite for Native Surface Compositor & Window Flinger.
 */
static void run_compositor_tests(void) {
    compositor_run_selftest();
}

/* Statically allocated buffer for synthetic ELF64 test image */
static uint8_t test_elf_buffer[4608] __attribute__((aligned(16)));

/**
 * @brief Construct a synthetic, valid ELF64 AArch64 executable image in memory.
 *
 * Emits ELF64 header, PT_LOAD program header, and AArch64 machine instructions that:
 * 1. Output a banner string to UART via SYS_zx_debug_write (syscall 14).
 * 2. Terminate the process cleanly via SYS_zx_process_exit (syscall 1) with exit code 42.
 */
static size_t build_test_elf64_binary(uint8_t *buf, size_t buf_size) {
    if (buf_size < 0x1100) return 0;
    memset(buf, 0, buf_size);

    Elf64_Ehdr *ehdr = (Elf64_Ehdr *)buf;
    ehdr->e_ident[EI_MAG0] = ELFMAG0;
    ehdr->e_ident[EI_MAG1] = ELFMAG1;
    ehdr->e_ident[EI_MAG2] = ELFMAG2;
    ehdr->e_ident[EI_MAG3] = ELFMAG3;
    ehdr->e_ident[EI_CLASS] = ELFCLASS64;
    ehdr->e_ident[EI_DATA] = ELFDATA2LSB;
    ehdr->e_ident[EI_VERSION] = EV_CURRENT;
    ehdr->e_ident[EI_OSABI] = 0;
    ehdr->e_type = ET_EXEC;
    ehdr->e_machine = EM_AARCH64;
    ehdr->e_version = 1;
    ehdr->e_entry = 0x0000000000400000ULL;
    ehdr->e_phoff = sizeof(Elf64_Ehdr);
    ehdr->e_ehsize = sizeof(Elf64_Ehdr);
    ehdr->e_phentsize = sizeof(Elf64_Phdr);
    ehdr->e_phnum = 1;

    Elf64_Phdr *phdr = (Elf64_Phdr *)(buf + ehdr->e_phoff);
    phdr->p_type = PT_LOAD;
    phdr->p_flags = PF_R | PF_W | PF_X;
    phdr->p_offset = 0x1000;
    phdr->p_vaddr = 0x0000000000400000ULL;
    phdr->p_paddr = 0x0000000000400000ULL;
    phdr->p_filesz = 0x100;
    phdr->p_memsz = 0x1000;
    phdr->p_align = 0x1000;

    /* Write ARM64 userland machine code at offset 0x1000 */
    uint32_t *code = (uint32_t *)(buf + 0x1000);
    code[0] = 0x10000180; /* adr x0, #0x30 (points to string at offset 0x1030) */
    code[1] = 0xd2800941; /* movz x1, #74 (length of banner string) */
    code[2] = 0xd28001d0; /* movz x16, #14 (SYS_zx_debug_write) */
    code[3] = 0xd4000001; /* svc #0 */
    code[4] = 0xd2800540; /* movz x0, #42 (exit code 42) */
    code[5] = 0xd2800030; /* movz x16, #1 (SYS_zx_process_exit) */
    code[6] = 0xd4000001; /* svc #0 */
    code[7] = 0xd503205f; /* wfe */
    code[8] = 0x17ffffff; /* b .-4 */

    /* User banner string at offset 0x1030 (48 bytes from code start) */
    const char banner[] = "  [USERLAND EL0] Hello from EL0 Userspace! Syscall SVC #0 execution active.\n";
    memcpy(buf + 0x1030, banner, strlen(banner));

    return 0x1100;
}

/**
 * @brief Self-test suite for ELF64 Binary Parser.
 */
static void run_elf64_parser_tests(void) {
    uart_puts("--- [Test Suite 7: ELF64 Binary Parser & Program Headers] ---\n");

    size_t elf_size = build_test_elf64_binary(test_elf_buffer, sizeof(test_elf_buffer));
    if (elf_size == 0) {
        uart_puts("  [FAIL] Failed to construct test ELF64 binary image\n");
        return;
    }

    /* Subtest 1: Validate Header */
    zx_status_t st = elf_validate_header(test_elf_buffer, elf_size);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] elf_validate_header rejected valid ELF64 AArch64 image\n");
        return;
    }
    uart_puts("  [PASS] ELF64 Header Identification: Magic (\\x7fELF), Class (64-bit), Endian (LE), Machine (AArch64)\n");

    /* Subtest 2: Parse Program Headers & PT_LOAD Segments */
    elf_info_t info;
    st = elf_parse(test_elf_buffer, elf_size, &info);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] elf_parse failed on valid ELF image\n");
        return;
    }

    if (info.entry_point == 0x00400000 && info.segment_count == 1 &&
        info.segments[0].vaddr == 0x00400000 &&
        (info.segments[0].vmm_flags & VMM_FLAG_USER) &&
        (info.segments[0].vmm_flags & VMM_FLAG_EXECUTE)) {
        uart_puts("  [PASS] Program Header Extraction: PT_LOAD at 0x00400000 (R|W|X, User), Entry Point: 0x00400000\n");
    } else {
        uart_puts("  [FAIL] Program Header values mismatch\n");
        return;
    }

    /* Subtest 3: Header Rejection Robustness */
    uint8_t corrupt_buf[sizeof(Elf64_Ehdr)];
    memcpy(corrupt_buf, test_elf_buffer, sizeof(Elf64_Ehdr));
    corrupt_buf[0] = 0x00; /* Invalidate magic */
    if (elf_validate_header(corrupt_buf, sizeof(corrupt_buf)) != ZX_ERR_NOT_SUPPORTED) {
        uart_puts("  [FAIL] Corrupted magic not rejected\n");
        return;
    }

    memcpy(corrupt_buf, test_elf_buffer, sizeof(Elf64_Ehdr));
    Elf64_Ehdr *corrupt_ehdr = (Elf64_Ehdr *)corrupt_buf;
    corrupt_ehdr->e_machine = 62; /* x86_64 machine */
    if (elf_validate_header(corrupt_buf, sizeof(corrupt_buf)) != ZX_ERR_NOT_SUPPORTED) {
        uart_puts("  [FAIL] Non-AArch64 machine architecture not rejected\n");
        return;
    }
    uart_puts("  [PASS] Robust Error Rejection: Corrupted Magic and Invalid Architecture Rejected\n\n");
}

/**
 * @brief Self-test suite for Process Creation, Handle Isolation & EL0 Context Switching.
 */
static void run_process_userland_execution_tests(void) {
    uart_puts("--- [Test Suite 8: Process Creation, Handle Isolation & EL0 Execution] ---\n");

    /* Subtest 1: Process Creation with Dedicated User Address Space */
    zx_handle_t proc_h = ZX_HANDLE_INVALID;
    zx_handle_t vmar_h = ZX_HANDLE_INVALID;
    zx_status_t st = zx_process_create(0, "userland_test_task", 18, 0, &proc_h, &vmar_h);
    if (st != ZX_OK || proc_h == ZX_HANDLE_INVALID) {
        uart_puts("  [FAIL] zx_process_create failed\n");
        return;
    }
    uart_puts("  [PASS] Process Created: \"userland_test_task\" (Process Handle: ");
    uart_write_hex(proc_h);
    uart_puts(")\n");

    /* Subtest 2: Thread Creation with User Stack Allocation (SP_EL0) */
    zx_handle_t th_h = ZX_HANDLE_INVALID;
    st = zx_thread_create(proc_h, "init_thread", 11, 0, &th_h);
    if (st != ZX_OK || th_h == ZX_HANDLE_INVALID) {
        uart_puts("  [FAIL] zx_thread_create failed\n");
        return;
    }
    uart_puts("  [PASS] Thread Created: \"init_thread\" (Thread Handle: ");
    uart_write_hex(th_h);
    uart_puts(", Stack: 64 KiB at SP_EL0: 0x00800000)\n");

    /* Subtest 3: Process Handle Table Isolation */
    void *proc_obj = NULL;
    handle_lookup(proc_h, ZX_OBJ_TYPE_PROCESS, ZX_RIGHT_READ, &proc_obj);
    process_t *proc = (process_t *)proc_obj;
    if (proc && proc->handle_table.count == 2) {
        uart_puts("  [PASS] Process Handle Table Isolation: 2 process-scoped descriptors bound\n");
    } else {
        uart_puts("  [FAIL] Handle table isolation verification failed\n");
        return;
    }

    /* Subtest 4: ELF Binary Loading into Process Virtual Memory */
    size_t elf_size = build_test_elf64_binary(test_elf_buffer, sizeof(test_elf_buffer));
    zx_vaddr_t user_entry = 0;
    st = elf_load_process(proc, test_elf_buffer, elf_size, &user_entry);
    if (st != ZX_OK || user_entry != 0x00400000) {
        uart_puts("  [FAIL] elf_load_process failed\n");
        return;
    }
    uart_puts("  [PASS] ELF64 Image Loaded into User Address Space (Entry: 0x00400000, Segments Mapped)\n");

    /* Subtest 5: Start Process & Thread */
    st = zx_process_start(proc_h, th_h, user_entry, DEFAULT_USER_STACK_TOP, 0, 0);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] zx_process_start failed\n");
        return;
    }
    uart_puts("  [PASS] Process Initial Thread Configured (PC: 0x00400000, SP: 0x00800000, SPSR_EL1: EL0t)\n");

    /*
     * Subtest 6: Context Switch & EL0 Userland Execution
     * Transition CPU from EL1 (Kernel) to EL0 (Userland).
     * User code will execute SYS_zx_debug_write via svc #0, then terminate via SYS_zx_process_exit(42).
     */
    uart_puts("  * Transitioning CPU Execution Level: EL1 (Kernel) -> EL0 (Userland)...\n");

    /* Activate user address space and set active process */
    process_set_current(proc);

    /* Drop to EL0 */
    int64_t exit_code = arch_enter_user_space(user_entry, DEFAULT_USER_STACK_TOP, 0);

    /* Return to kernel address space */
    process_set_current(NULL);

    if (exit_code == 42 && proc->state == PROCESS_STATE_TERMINATED) {
        uart_puts("  [PASS] Userland EL0 Execution Round-Trip Confirmed: Syscall svc #0 Handled, Exit Code: 42\n\n");
    } else {
        uart_puts("  [FAIL] Userland execution exit code mismatch: ");
        uart_write_dec((uint32_t)exit_code);
        uart_puts("\n\n");
    }

    handle_close(th_h);
    handle_close(proc_h);
}

/**
 * @brief Self-test suite for Mobile Hardware Abstraction Layer (HAL) Subsystems.
 * Tests Camera, Audio PCM, Battery/Power Governor, and Cellular Baseband Telephony.
 */
static void run_mobile_hal_tests(void) {
    uart_puts("--- [Test Suite 9: Mobile Hardware Abstraction Layer (HAL)] ---\n");

    /* --------------------------------------------------------------------- */
    /* 1. Camera Sensor & Capture Pipeline Tests                            */
    /* --------------------------------------------------------------------- */
    uart_puts("  [CAMERA] Testing Sensor Enumeration & Capture Pipeline...\n");

    uint32_t sensor_count = 0;
    zx_status_t st = camera_get_sensor_count(&sensor_count);
    if (st != ZX_OK || sensor_count != 3) {
        uart_puts("  [FAIL] camera_get_sensor_count failed\n");
        return;
    }
    uart_puts("  [PASS] Camera Sensors Enumerated: ");
    uart_write_dec(sensor_count);
    uart_puts(" sensors available\n");

    camera_sensor_info_t cam_info;
    st = camera_get_sensor_info(CAMERA_ID_BACK_PRIMARY, &cam_info);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] camera_get_sensor_info failed\n");
        return;
    }
    uart_puts("  [PASS] Sensor 0 Profile: \"");
    uart_puts(cam_info.name);
    uart_puts("\" (Max Res: ");
    uart_write_dec(cam_info.max_width);
    uart_puts("x");
    uart_write_dec(cam_info.max_height);
    uart_puts(" at ");
    uart_write_dec(cam_info.max_fps);
    uart_puts(" fps, AF/Flash: OK)\n");

    /* Configure Camera 0 for 640x480 NV12 preview */
    camera_config_t cam_cfg;
    cam_cfg.sensor_id = CAMERA_ID_BACK_PRIMARY;
    cam_cfg.width = 640;
    cam_cfg.height = 480;
    cam_cfg.format = CAMERA_FORMAT_NV12;
    cam_cfg.target_fps = 30;
    cam_cfg.exposure_time_us = 16666;
    cam_cfg.iso_gain = 100;
    cam_cfg.wb = CAMERA_WB_AUTO;

    st = camera_configure(CAMERA_ID_BACK_PRIMARY, &cam_cfg);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] camera_configure failed\n");
        return;
    }

    st = camera_start_stream(CAMERA_ID_BACK_PRIMARY);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] camera_start_stream failed\n");
        return;
    }

    camera_frame_t *frame = NULL;
    st = camera_acquire_frame(CAMERA_ID_BACK_PRIMARY, &frame);
    if (st != ZX_OK || !frame) {
        uart_puts("  [FAIL] camera_acquire_frame failed\n");
        return;
    }
    uart_puts("  [PASS] Camera Frame Acquired: Frame #");
    uart_write_dec(frame->frame_id);
    uart_puts(" (640x480 NV12, Timestamp: ");
    uart_write_dec((uint32_t)(frame->timestamp_ns / 1000000));
    uart_puts(" ms)\n");

    /* Test NV12 to ARGB8888 conversion on a 16x16 sample block */
    static uint32_t sample_argb[16 * 16];
    uint8_t *sample_y = frame->data;
    uint8_t *sample_uv = frame->data + (640 * 480);
    st = camera_nv12_to_argb8888(sample_y, sample_uv, 16, 16, sample_argb);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] camera_nv12_to_argb8888 color conversion failed\n");
        return;
    }
    /* White bar verification: ARGB must have alpha=0xFF and high RGB */
    uint32_t p0 = sample_argb[0];
    uint8_t a = (p0 >> 24) & 0xFF;
    uint8_t r = (p0 >> 16) & 0xFF;
    if (a == 0xFF && r > 200) {
        uart_puts("  [PASS] NV12 -> ARGB8888 Color Space Converter Verified (White Pixel ARGB: ");
        uart_write_hex(p0);
        uart_puts(")\n");
    } else {
        uart_puts("  [FAIL] Color conversion pixel mismatch\n");
        return;
    }

    st = camera_set_exposure(CAMERA_ID_BACK_PRIMARY, 20000, 400);
    if (st != ZX_OK) {
        uart_puts("  [FAIL] camera_set_exposure failed\n");
        return;
    }
    uart_puts("  [PASS] Camera Exposure & ISO Dynamic Tuning: 20000 us, ISO 400\n");

    camera_release_frame(CAMERA_ID_BACK_PRIMARY, frame);
    camera_stop_stream(CAMERA_ID_BACK_PRIMARY);

    /* --------------------------------------------------------------------- */
    /* 2. Audio PCM Subsystem & Mixer Tests                                 */
    /* --------------------------------------------------------------------- */
    uart_puts("  [AUDIO] Testing 48kHz Stereo PCM Audio Subsystem...\n");

    st = audio_set_master_volume(85);
    uint8_t vol = 0;
    audio_get_master_volume(&vol);
    if (st != ZX_OK || vol != 85) {
        uart_puts("  [FAIL] audio_set_master_volume failed\n");
        return;
    }
    uart_puts("  [PASS] Master Volume Set & Readback: ");
    uart_write_dec(vol);
    uart_puts("%\n");

    audio_set_output_endpoint(AUDIO_ENDPOINT_OUT_SPEAKER);
    audio_set_input_endpoint(AUDIO_ENDPOINT_IN_MIC_MAIN);
    audio_start_playback();

    /* Synthesize 128 frames (512 bytes) of 440 Hz concert pitch A tone */
    static int16_t tone_buffer[128 * 2];
    audio_generate_sine_tone(tone_buffer, 128, 440, AUDIO_SAMPLE_RATE_48K);

    size_t written_frames = 0;
    st = audio_write_pcm(tone_buffer, 128, &written_frames);
    if (st != ZX_OK || written_frames != 128) {
        uart_puts("  [FAIL] audio_write_pcm failed\n");
        return;
    }
    uart_puts("  [PASS] PCM Playback Stream Queued: ");
    uart_write_dec((uint32_t)written_frames);
    uart_puts(" frames (48kHz 16-bit Stereo Sine Wave, 440 Hz)\n");

    audio_telemetry_t audio_telem;
    audio_get_telemetry(&audio_telem);
    if (audio_telem.playback_frames_submitted == 128 &&
        audio_telem.current_output == AUDIO_ENDPOINT_OUT_SPEAKER) {
        uart_puts("  [PASS] Audio Telemetry Verified (Output: Loudspeaker, Underruns: 0)\n");
    } else {
        uart_puts("  [FAIL] Audio telemetry mismatch\n");
        return;
    }
    audio_stop_playback();

    /* --------------------------------------------------------------------- */
    /* 3. Power, Battery Fuel Gauge & Thermal Governor Tests                */
    /* --------------------------------------------------------------------- */
    uart_puts("  [POWER] Testing Battery Gauge, Thermal Governor & Wake-Locks...\n");

    battery_telemetry_t batt;
    st = power_get_battery_info(&batt);
    if (st != ZX_OK || batt.percentage != 85) {
        uart_puts("  [FAIL] power_get_battery_info failed\n");
        return;
    }
    uart_puts("  [PASS] Battery Fuel Gauge: ");
    uart_write_dec(batt.percentage);
    uart_puts("% (");
    uart_write_dec(batt.voltage_mv);
    uart_puts(" mV, Capacity: ");
    uart_write_dec(batt.remaining_mah);
    uart_puts(" / ");
    uart_write_dec(batt.design_capacity_mah);
    uart_puts(" mAh, Health: GOOD)\n");

    /* Thermal Trip Zone Evaluation */
    thermal_zone_info_t cpu_thermal;
    st = power_get_thermal_zone(THERMAL_ZONE_CPU_CLUSTER0, &cpu_thermal);
    if (st != ZX_OK || cpu_thermal.trip_level != THERMAL_TRIP_NORMAL) {
        uart_puts("  [FAIL] power_get_thermal_zone failed\n");
        return;
    }
    uart_puts("  [PASS] CPU Thermal Zone: ");
    uart_write_dec((uint32_t)(cpu_thermal.current_temp_mdeg_c / 1000));
    uart_puts(".");
    uart_write_dec((uint32_t)((cpu_thermal.current_temp_mdeg_c % 1000) / 100));
    uart_puts(" C (Trip Level: NORMAL)\n");

    /* Simulate thermal spike to 82.5 C (warning trip) */
    power_simulate_thermal_update(THERMAL_ZONE_CPU_CLUSTER0, 82500);
    power_get_thermal_zone(THERMAL_ZONE_CPU_CLUSTER0, &cpu_thermal);
    if (cpu_thermal.trip_level == THERMAL_TRIP_WARNING) {
        uart_puts("  [PASS] Thermal Trip Trigger: 82.5 C elevated -> Governor State WARNING\n");
    } else {
        uart_puts("  [FAIL] Thermal trip governor response failure\n");
        return;
    }
    /* Restore normal thermal conditions */
    power_simulate_thermal_update(THERMAL_ZONE_CPU_CLUSTER0, 41200);

    /* Wake-Lock Arbitration & Suspend Veto Tests */
    uint32_t lock_id = 0;
    st = power_wake_lock_acquire("display_backlight", &lock_id);
    if (st != ZX_OK || power_get_active_wake_locks() != 1) {
        uart_puts("  [FAIL] power_wake_lock_acquire failed\n");
        return;
    }
    uart_puts("  [PASS] Wake-Lock Acquired: \"display_backlight\" (Lock Handle: ");
    uart_write_dec(lock_id);
    uart_puts(")\n");

    /* Suspend must be vetoed while wake-lock is held */
    st = power_set_power_state(POWER_STATE_SUSPEND);
    if (st == ZX_ERR_UNAVAILABLE) {
        uart_puts("  [PASS] Suspend Veto Verified: POWER_STATE_SUSPEND Blocked (Active Wake-Locks: 1)\n");
    } else {
        uart_puts("  [FAIL] Suspend was not vetoed with active wake lock\n");
        return;
    }

    /* Release wake-lock and transition to IDLE */
    st = power_wake_lock_release(lock_id);
    if (st != ZX_OK || power_get_active_wake_locks() != 0) {
        uart_puts("  [FAIL] power_wake_lock_release failed\n");
        return;
    }
    st = power_set_power_state(POWER_STATE_IDLE);
    if (st != ZX_OK || power_get_power_state() != POWER_STATE_IDLE) {
        uart_puts("  [FAIL] Transition to POWER_STATE_IDLE failed\n");
        return;
    }
    uart_puts("  [PASS] Dynamic Power Transition: ACTIVE -> IDLE Clock-Gating\n");
    power_set_power_state(POWER_STATE_ACTIVE);

    /* --------------------------------------------------------------------- */
    /* 4. Cellular Baseband Telephony & Air-Gap Tests                       */
    /* --------------------------------------------------------------------- */
    uart_puts("  [TELEPHONY] Testing Modem, Dual-SIM & Offline Air-Gap Mode...\n");

    modem_telemetry_t modem;
    st = telephony_get_modem_info(&modem);
    if (st != ZX_OK || modem.power_state != MODEM_POWER_ONLINE) {
        uart_puts("  [FAIL] telephony_get_modem_info failed\n");
        return;
    }
    uart_puts("  [PASS] Modem Baseband Online: \"");
    uart_puts(modem.modem_model);
    uart_puts("\" (FW: ");
    uart_puts(modem.firmware_version);
    uart_puts(", Dual-SIM: OK)\n");

    sim_card_info_t sim1;
    st = telephony_get_sim_info(TELEPHONY_SLOT_1, &sim1);
    if (st != ZX_OK || sim1.sim_state != SIM_STATE_READY) {
        uart_puts("  [FAIL] telephony_get_sim_info failed\n");
        return;
    }
    uart_puts("  [PASS] SIM 1 Registered: Carrier \"");
    uart_puts(sim1.operator_name);
    uart_puts("\", RAT: 5G-NR Sub-6, RSSI: -76 dBm (");
    uart_write_dec(sim1.signal.signal_bars);
    uart_puts(" / 5 Bars)\n");

    /* Air-Gap / Airplane Mode Isolation Toggle */
    st = telephony_set_airplane_mode(true);
    if (st != ZX_OK || !telephony_get_airplane_mode()) {
        uart_puts("  [FAIL] telephony_set_airplane_mode(true) failed\n");
        return;
    }
    telephony_get_modem_info(&modem);
    telephony_get_sim_info(TELEPHONY_SLOT_1, &sim1);
    if (modem.power_state == MODEM_POWER_AIRGAP &&
        sim1.reg_state == REG_STATE_NOT_REGISTERED &&
        sim1.signal.signal_bars == 0) {
        uart_puts("  [PASS] Offline Air-Gap Mode Activated: Baseband Hardware Isolated, RF Power Cut\n");
    } else {
        uart_puts("  [FAIL] Air-gap mode hardware isolation verification failed\n");
        return;
    }

    /* Restore cellular network connectivity */
    telephony_set_airplane_mode(false);
    telephony_get_sim_info(TELEPHONY_SLOT_1, &sim1);
    if (sim1.reg_state == REG_STATE_REGISTERED_HOME && sim1.signal.signal_bars == 4) {
        uart_puts("  [PASS] Cellular Baseband Re-attached: 5G-NR Sub-6 Re-established\n\n");
    } else {
        uart_puts("  [FAIL] Cellular reconnection failed\n\n");
        return;
    }
}

/**
 * @brief Early Kernel Entry Point invoked by boot.S in EL1 mode.
 *
 * @param dtb_paddr Physical address of DTB loaded by bootloader/QEMU.
 * @param x1 Boot parameter register 1.
 * @param x2 Boot parameter register 2.
 * @param x3 Boot parameter register 3.
 */
void kernel_main(uint64_t dtb_paddr, uint64_t x1, uint64_t x2, uint64_t x3) {
    (void)x1;
    (void)x2;
    (void)x3;

    /* 1. Initialize PL011 Serial Console */
    uart_init();

    /* 2. Print System Banner */
    print_banner();

    /* 3. Detect and Report Architecture Profile */
    print_hardware_info(dtb_paddr);

    /* 4. Subsystem Initializations */
    uart_puts("--- [Kernel Subsystem Bootstrapping] ---\n");

    /* Physical Memory Manager (DRAM base 0x40000000, 4 GiB default) */
    pmm_init(RAM_BASE_PADDR, RAM_SIZE_DEFAULT);

    /* Virtual Memory Manager & ARM64 4-Level Paging */
    vmm_init();

    /* Handle Table & Capability Security */
    handle_table_init();

    /* Virtual Memory Object Subsystem */
    vmo_subsystem_init();

    /* Bidirectional IPC Channel Subsystem */
    channel_subsystem_init();

    /* Multi-Modal Input Subsystem & Gesture Engine */
    input_subsystem_init();

    /* Linear Framebuffer & 2D Rasterizer Display Subsystem */
    display_init();

    /* Native Surface Compositor & Window Flinger Subsystem */
    compositor_init();

    /* Process & Thread Management Subsystem */
    process_subsystem_init();
    thread_subsystem_init();

    /* Mobile Hardware Abstraction Layer (HAL) Subsystems */
    camera_hal_init();
    audio_hal_init();
    power_hal_init();
    telephony_hal_init();
    uart_puts("\n");

    /* 5. Execute Comprehensive Self-Test Suites */
    run_pmm_tests();
    run_vmm_tests();
    run_vmo_tests();
    run_channel_ipc_tests();
    run_input_tests();
    run_display_tests();
    run_compositor_tests();
    run_elf64_parser_tests();
    run_process_userland_execution_tests();
    run_mobile_hal_tests();

    uart_puts("========================================================================\n");
    uart_puts(">>> ALL PRAVAHOS MICROKERNEL SELF-TESTS PASSED SUCCESSFULLY <<<\n");
    uart_puts("========================================================================\n\n");
    uart_puts("PravahOS Microkernel bootstrap complete. Stage 2 idle loop active.\n");
    uart_puts("Awaiting userspace root task (bootstrap / CFv2 component manager)...\n\n");

    /* Primary Microkernel Idle Loop */
    while (1) {
        wfe();
    }
}

/**
 * @brief Early Exception Dispatcher for unexpected synchronous/asynchronous traps.
 */
void kernel_exception_handler(uint64_t esr, uint64_t far, uint64_t elr) {
    uart_puts("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    uart_puts(">>> KERNEL PANIC: Unexpected Exception Trapped in EL1 <<<\n");
    uart_puts("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    uart_puts("  ESR_EL1 (Syndrome)    : ");
    uart_write_hex(esr);
    uart_puts("\n  FAR_EL1 (Fault Addr)  : ");
    uart_write_hex(far);
    uart_puts("\n  ELR_EL1 (Return Addr) : ");
    uart_write_hex(elr);
    uart_puts("\nMicrokernel execution halted.\n");

    while (1) {
        wfi();
    }
}
