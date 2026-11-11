/**
 * @file pmm.c
 * @brief PravahOS Physical Memory Manager (PMM) implementation.
 */

#include "kernel/pmm.h"
#include "kernel/string.h"
#include "arch/arm64/uart_pl011.h"

/* Linker symbols defining kernel binary physical extents */
extern char __kernel_start[];
extern char __kernel_end[];

/* Static bitmap tracking page state (1 = allocated/reserved, 0 = free) */
static uint64_t pmm_bitmap[PMM_BITMAP_WORDS];

/* Physical DRAM bounds */
static zx_paddr_t pmm_dram_base = RAM_BASE_PADDR;
static size_t     pmm_dram_size = RAM_SIZE_DEFAULT;
static size_t     pmm_total_pages = 0;
static size_t     pmm_free_pages = 0;
static size_t     pmm_used_pages = 0;

static inline void bitmap_set(size_t bit) {
    pmm_bitmap[bit / 64] |= (1ULL << (bit % 64));
}

static inline void bitmap_clear(size_t bit) {
    pmm_bitmap[bit / 64] &= ~(1ULL << (bit % 64));
}

static inline bool bitmap_test(size_t bit) {
    return (pmm_bitmap[bit / 64] & (1ULL << (bit % 64))) != 0;
}

zx_paddr_t pmm_page_to_paddr(size_t page_idx) {
    return pmm_dram_base + (page_idx * PAGE_SIZE);
}

size_t pmm_paddr_to_page(zx_paddr_t paddr) {
    if (paddr < pmm_dram_base) return (size_t)-1;
    return (paddr - pmm_dram_base) / PAGE_SIZE;
}

size_t pmm_get_total_pages(void) {
    return pmm_total_pages;
}

size_t pmm_get_free_pages(void) {
    return pmm_free_pages;
}

size_t pmm_get_used_pages(void) {
    return pmm_used_pages;
}

zx_status_t pmm_reserve_range(zx_paddr_t start, size_t size) {
    if (size == 0) return ZX_OK;

    zx_paddr_t aligned_start = ALIGN_DOWN(start, PAGE_SIZE);
    zx_paddr_t aligned_end = ALIGN_UP(start + size, PAGE_SIZE);

    if (aligned_start < pmm_dram_base) {
        aligned_start = pmm_dram_base;
    }

    zx_paddr_t dram_end = pmm_dram_base + (pmm_total_pages * PAGE_SIZE);
    if (aligned_end > dram_end) {
        aligned_end = dram_end;
    }

    if (aligned_start >= aligned_end) {
        return ZX_OK;
    }

    size_t start_page = pmm_paddr_to_page(aligned_start);
    size_t end_page = pmm_paddr_to_page(aligned_end);

    for (size_t p = start_page; p < end_page && p < pmm_total_pages; p++) {
        if (!bitmap_test(p)) {
            bitmap_set(p);
            if (pmm_free_pages > 0) pmm_free_pages--;
            pmm_used_pages++;
        }
    }

    return ZX_OK;
}

void pmm_init(zx_paddr_t mem_base, size_t mem_size) {
    pmm_dram_base = mem_base;
    pmm_dram_size = mem_size;

    size_t calculated_pages = mem_size / PAGE_SIZE;
    if (calculated_pages > PMM_MAX_PAGES) {
        calculated_pages = PMM_MAX_PAGES;
    }
    pmm_total_pages = calculated_pages;

    /* Initially mark all bitmap entries as allocated (1) */
    memset(pmm_bitmap, 0xFF, sizeof(pmm_bitmap));

    /* Mark all available DRAM pages within window as free (0) */
    for (size_t i = 0; i < pmm_total_pages; i++) {
        bitmap_clear(i);
    }
    pmm_free_pages = pmm_total_pages;
    pmm_used_pages = 0;

    /* Reserve early bootloader / Device Tree blob window (0x40000000 - 0x40080000 = 512 KiB) */
    pmm_reserve_range(RAM_BASE_PADDR, (KERNEL_LOAD_PADDR - RAM_BASE_PADDR));

    /* Reserve Kernel image boundaries (__kernel_start to __kernel_end) */
    zx_paddr_t kstart = (zx_paddr_t)(uintptr_t)__kernel_start;
    zx_paddr_t kend = (zx_paddr_t)(uintptr_t)__kernel_end;
    size_t ksize = (kend > kstart) ? (kend - kstart) : 0;
    pmm_reserve_range(kstart, ksize);

    uart_puts("[PMM] Physical Memory Manager Initialized:\n");
    uart_puts("      DRAM Base       : ");
    uart_write_hex(pmm_dram_base);
    uart_puts("\n      DRAM Extent     : ");
    uart_write_hex(pmm_dram_base + (pmm_total_pages * PAGE_SIZE));
    uart_puts("\n      Total Pages     : ");
    uart_write_dec(pmm_total_pages);
    uart_puts(" (");
    uart_write_dec((pmm_total_pages * PAGE_SIZE) / (1024 * 1024));
    uart_puts(" MiB)\n      Free Pages      : ");
    uart_write_dec(pmm_free_pages);
    uart_puts("\n      Kernel Reserved : ");
    uart_write_dec(pmm_used_pages);
    uart_puts(" pages (");
    uart_write_hex(kstart);
    uart_puts(" - ");
    uart_write_hex(kend);
    uart_puts(")\n");
}

zx_status_t pmm_alloc_page(zx_paddr_t *out_paddr) {
    if (!out_paddr) return ZX_ERR_INVALID_ARGS;
    if (pmm_free_pages == 0) return ZX_ERR_NO_MEMORY;

    /* Fast word-by-word scan for free bit */
    for (size_t w = 0; w < PMM_BITMAP_WORDS; w++) {
        if (pmm_bitmap[w] != 0xFFFFFFFFFFFFFFFFULL) {
            uint64_t word = pmm_bitmap[w];
            for (size_t b = 0; b < 64; b++) {
                if (!(word & (1ULL << b))) {
                    size_t page_idx = (w * 64) + b;
                    if (page_idx >= pmm_total_pages) {
                        return ZX_ERR_NO_MEMORY;
                    }

                    bitmap_set(page_idx);
                    pmm_free_pages--;
                    pmm_used_pages++;

                    zx_paddr_t paddr = pmm_page_to_paddr(page_idx);
                    /* Zero page frame prior to handing to caller */
                    memset((void *)(uintptr_t)paddr, 0, PAGE_SIZE);

                    *out_paddr = paddr;
                    return ZX_OK;
                }
            }
        }
    }

    return ZX_ERR_NO_MEMORY;
}

zx_status_t pmm_alloc_pages(size_t count, zx_paddr_t *out_paddr) {
    if (!out_paddr || count == 0) return ZX_ERR_INVALID_ARGS;
    if (count > pmm_free_pages) return ZX_ERR_NO_MEMORY;

    size_t consecutive = 0;
    size_t start_page = 0;

    for (size_t i = 0; i < pmm_total_pages; i++) {
        if (!bitmap_test(i)) {
            if (consecutive == 0) {
                start_page = i;
            }
            consecutive++;
            if (consecutive == count) {
                /* Allocate range */
                for (size_t p = start_page; p < start_page + count; p++) {
                    bitmap_set(p);
                }
                pmm_free_pages -= count;
                pmm_used_pages += count;

                zx_paddr_t paddr = pmm_page_to_paddr(start_page);
                memset((void *)(uintptr_t)paddr, 0, count * PAGE_SIZE);
                *out_paddr = paddr;
                return ZX_OK;
            }
        } else {
            consecutive = 0;
        }
    }

    return ZX_ERR_NO_MEMORY;
}

void pmm_free_page(zx_paddr_t paddr) {
    if (paddr < pmm_dram_base || (paddr & (PAGE_SIZE - 1)) != 0) {
        return;
    }

    size_t page_idx = pmm_paddr_to_page(paddr);
    if (page_idx >= pmm_total_pages) {
        return;
    }

    if (bitmap_test(page_idx)) {
        bitmap_clear(page_idx);
        pmm_free_pages++;
        if (pmm_used_pages > 0) pmm_used_pages--;
    }
}

void pmm_free_pages(zx_paddr_t paddr, size_t count) {
    if (count == 0) return;
    for (size_t i = 0; i < count; i++) {
        pmm_free_page(paddr + (i * PAGE_SIZE));
    }
}
