/**
 * @file vmm.h
 * @brief PravahOS Virtual Memory Manager (VMM) & ARM64 4-Level Paging Engine.
 */

#ifndef PRAVAH_KERNEL_VMM_H
#define PRAVAH_KERNEL_VMM_H

#include "types.h"
#include "memory.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Virtual Memory Map Definitions */
#define USER_ASPACE_BASE        (0x0000000000000000ULL)
#define USER_ASPACE_SIZE        (0x0000FFFFFFFFFFFFULL) /* 48-bit userspace (256 TiB) */

#define KERNEL_ASPACE_BASE      (0xFFFF000000000000ULL) /* 48-bit kernel high memory */
#define KERNEL_ASPACE_SIZE      (0x0000FFFFFFFFFFFFULL)

/* VMM Mapping Protection & Cache Flags */
#define VMM_FLAG_READ           (1u << 0)
#define VMM_FLAG_WRITE          (1u << 1)
#define VMM_FLAG_EXECUTE        (1u << 2)
#define VMM_FLAG_USER           (1u << 3)
#define VMM_FLAG_DEVICE         (1u << 4) /* Device-nGnRE (UART, RTC, PCIe) */
#define VMM_FLAG_DEVICE_NGNRNE  (1u << 5) /* Device-nGnRnE (GICv3) */
#define VMM_FLAG_NONCACHEABLE   (1u << 6) /* Normal memory, non-cacheable */

/* ARM64 MAIR Attributes indices */
#define MAIR_ATTR_DEVICE_NGNRNE 0
#define MAIR_ATTR_DEVICE_NGNRE  1
#define MAIR_ATTR_NORMAL_WB     2
#define MAIR_ATTR_NORMAL_NC     3

/**
 * @brief Initialize the ARM64 Virtual Memory Manager.
 *
 * Allocates L0 root page tables for TTBR0 (identity / userspace) and TTBR1 (kernel high memory),
 * sets up identity mappings for peripheral MMIO (UART, GIC, RTC) and kernel DRAM,
 * and sets up high-memory kernel window.
 *
 * @return ZX_OK on success, or error code.
 */
zx_status_t vmm_init(void);

/**
 * @brief Map a single 4 KiB virtual page to a physical address.
 *
 * Dynamically allocates intermediate translation table levels (L1, L2, L3) as needed.
 *
 * @param vaddr Virtual address (must be 4 KiB aligned).
 * @param paddr Physical address (must be 4 KiB aligned).
 * @param flags VMM mapping flags (read, write, execute, user, device).
 * @return ZX_OK on success, or error code.
 */
zx_status_t vmm_map_page(zx_vaddr_t vaddr, zx_paddr_t paddr, uint64_t flags);

/**
 * @brief Unmap a single 4 KiB virtual page.
 *
 * @param vaddr Virtual address to unmap.
 * @return ZX_OK on success, or ZX_ERR_NOT_FOUND if page was not mapped.
 */
zx_status_t vmm_unmap_page(zx_vaddr_t vaddr);

/**
 * @brief Map a contiguous virtual range to contiguous physical frames.
 *
 * @param vaddr Starting virtual address.
 * @param paddr Starting physical address.
 * @param size Size in bytes (rounded up to PAGE_SIZE).
 * @param flags Mapping attributes and permissions.
 * @return ZX_OK on success, or error code.
 */
zx_status_t vmm_map_range(zx_vaddr_t vaddr, zx_paddr_t paddr, size_t size, uint64_t flags);

/**
 * @brief Unmap a virtual range.
 *
 * @param vaddr Starting virtual address.
 * @param size Size in bytes.
 * @return ZX_OK on success.
 */
zx_status_t vmm_unmap_range(zx_vaddr_t vaddr, size_t size);

/**
 * @brief Translate a virtual address to its backing physical address.
 *
 * @param vaddr Virtual address to query.
 * @return Physical address, or (zx_paddr_t)-1 if unmapped.
 */
zx_paddr_t vmm_vaddr_to_paddr(zx_vaddr_t vaddr);

/**
 * @brief Configure ARM64 MAIR, TCR, TTBR0, TTBR1 and enable MMU with instruction/data caching.
 */
void vmm_enable_mmu(void);

/**
 * @brief Check if MMU is currently active.
 */
bool vmm_is_mmu_enabled(void);

/**
 * @brief Get TTBR0 root table physical address.
 */
zx_paddr_t vmm_get_ttbr0(void);

/**
 * @brief Get TTBR1 root table physical address.
 */
zx_paddr_t vmm_get_ttbr1(void);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_VMM_H */
