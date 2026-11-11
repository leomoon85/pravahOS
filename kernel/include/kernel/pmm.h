/**
 * @file pmm.h
 * @brief PravahOS Physical Memory Manager (PMM)
 *
 * Implements a high-performance bitmap-based physical frame allocator
 * managing bare-metal DRAM with 4 KiB page granularity.
 */

#ifndef PRAVAH_KERNEL_PMM_H
#define PRAVAH_KERNEL_PMM_H

#include "types.h"
#include "memory.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Maximum physical memory pages supported by bitmap (1,048,576 pages = 4 GiB) */
#define PMM_MAX_PAGES       (1048576ULL)
#define PMM_BITMAP_WORDS    (PMM_MAX_PAGES / 64ULL)

/**
 * @brief Initialize the Physical Memory Manager.
 *
 * Marks all memory outside the specified DRAM window as reserved.
 * Automatically discovers kernel binary boundaries (__kernel_start to __kernel_end)
 * and reserves early bootloader/DTB regions.
 *
 * @param mem_base Physical base address of DRAM (e.g. 0x40000000).
 * @param mem_size Size of available DRAM in bytes (e.g. 0x100000000 for 4 GiB).
 */
void pmm_init(zx_paddr_t mem_base, size_t mem_size);

/**
 * @brief Allocate a single zeroed 4 KiB physical page frame.
 *
 * @param[out] out_paddr Pointer to receive the allocated physical address.
 * @return ZX_OK on success, or ZX_ERR_NO_MEMORY if physical DRAM is exhausted.
 */
zx_status_t pmm_alloc_page(zx_paddr_t *out_paddr);

/**
 * @brief Allocate contiguous zeroed 4 KiB physical page frames.
 *
 * @param count Number of contiguous 4 KiB pages to allocate.
 * @param[out] out_paddr Pointer to receive the starting physical address.
 * @return ZX_OK on success, or ZX_ERR_NO_MEMORY if contiguous block is unavailable.
 */
zx_status_t pmm_alloc_pages(size_t count, zx_paddr_t *out_paddr);

/**
 * @brief Free a previously allocated physical page frame.
 *
 * @param paddr Physical address of the page frame (must be 4 KiB aligned).
 */
void pmm_free_page(zx_paddr_t paddr);

/**
 * @brief Free multiple contiguous physical page frames.
 *
 * @param paddr Starting physical address (must be 4 KiB aligned).
 * @param count Number of contiguous pages to free.
 */
void pmm_free_pages(zx_paddr_t paddr, size_t count);

/**
 * @brief Reserve a physical memory range preventing allocation.
 *
 * @param start Starting physical address.
 * @param size Size in bytes of the reserved region.
 * @return ZX_OK on success, or ZX_ERR_INVALID_ARGS if range is out of DRAM bounds.
 */
zx_status_t pmm_reserve_range(zx_paddr_t start, size_t size);

/**
 * @brief Get total physical pages managed by PMM in available DRAM.
 */
size_t pmm_get_total_pages(void);

/**
 * @brief Get count of currently free physical 4 KiB pages.
 */
size_t pmm_get_free_pages(void);

/**
 * @brief Get count of currently allocated / reserved physical 4 KiB pages.
 */
size_t pmm_get_used_pages(void);

/**
 * @brief Convert page index relative to DRAM base into physical address.
 */
zx_paddr_t pmm_page_to_paddr(size_t page_idx);

/**
 * @brief Convert physical address into page index relative to DRAM base.
 */
size_t pmm_paddr_to_page(zx_paddr_t paddr);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_PMM_H */
