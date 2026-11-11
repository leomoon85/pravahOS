/**
 * @file vmm.c
 * @brief PravahOS ARM64 Virtual Memory Manager & 4-Level Translation Engine.
 */

#include "kernel/vmm.h"
#include "kernel/pmm.h"
#include "kernel/string.h"
#include "arch/arm64/arch.h"
#include "arch/arm64/uart_pl011.h"

/* 4-Level Page Table Indexing (48-bit Virtual Addressing, 4 KiB Granule) */
#define L0_SHIFT         (39)
#define L1_SHIFT         (30)
#define L2_SHIFT         (21)
#define L3_SHIFT         (12)
#define TABLE_ENTRIES    (512)
#define TABLE_INDEX_MASK (0x1FFULL)
#define ENTRY_ADDR_MASK  (0x0000FFFFFFFFF000ULL)

#define DESC_VALID       (1ULL << 0)
#define DESC_TABLE       (1ULL << 1)
#define DESC_PAGE        (1ULL << 1)
#define DESC_AF          (1ULL << 10) /* Access Flag */
#define DESC_SH_INNER    (3ULL << 8)  /* Inner Shareable */
#define DESC_UXN         (1ULL << 54) /* User Execute Never */
#define DESC_PXN         (1ULL << 53) /* Privileged Execute Never */

/* Root L0 Table Physical Addresses */
static zx_paddr_t    boot_ttbr0_root_paddr = 0;
static zx_paddr_t    ttbr0_root_paddr = 0;
static zx_paddr_t    ttbr1_root_paddr = 0;
static vmm_aspace_t *active_user_aspace = NULL;
static bool          mmu_enabled = false;

zx_paddr_t vmm_get_ttbr0(void) {
    return ttbr0_root_paddr;
}

zx_paddr_t vmm_get_ttbr1(void) {
    return ttbr1_root_paddr;
}

bool vmm_is_mmu_enabled(void) {
    return mmu_enabled;
}

vmm_aspace_t *vmm_get_active_aspace(void) {
    return active_user_aspace;
}

/**
 * @brief Get or allocate a next-level translation table.
 */
static uint64_t *get_or_alloc_table(uint64_t *table, size_t index) {
    uint64_t entry = table[index];

    if (entry & DESC_VALID) {
        zx_paddr_t next_table_paddr = entry & ENTRY_ADDR_MASK;
        return (uint64_t *)(uintptr_t)next_table_paddr;
    }

    /* Allocate new page table */
    zx_paddr_t new_table_paddr = 0;
    zx_status_t status = pmm_alloc_page(&new_table_paddr);
    if (status != ZX_OK) {
        return NULL;
    }

    /* Clear table entries */
    memset((void *)(uintptr_t)new_table_paddr, 0, PAGE_SIZE);

    /* Point descriptor to new table */
    table[index] = (new_table_paddr & ENTRY_ADDR_MASK) | DESC_VALID | DESC_TABLE;
    return (uint64_t *)(uintptr_t)new_table_paddr;
}

/**
 * @brief Internal helper to map a virtual page into an arbitrary L0 root table.
 */
static zx_status_t map_page_in_root(zx_paddr_t root_paddr, zx_vaddr_t vaddr, zx_paddr_t paddr, uint64_t flags) {
    if ((vaddr & (PAGE_SIZE - 1)) != 0 || (paddr & (PAGE_SIZE - 1)) != 0) {
        return ZX_ERR_INVALID_ARGS;
    }
    if (root_paddr == 0) {
        return ZX_ERR_INTERNAL;
    }

    uint64_t vaddr_masked = vaddr & 0x0000FFFFFFFFFFFFULL;
    size_t l0_idx = (vaddr_masked >> L0_SHIFT) & TABLE_INDEX_MASK;
    size_t l1_idx = (vaddr_masked >> L1_SHIFT) & TABLE_INDEX_MASK;
    size_t l2_idx = (vaddr_masked >> L2_SHIFT) & TABLE_INDEX_MASK;
    size_t l3_idx = (vaddr_masked >> L3_SHIFT) & TABLE_INDEX_MASK;

    uint64_t *l0_table = (uint64_t *)(uintptr_t)root_paddr;
    uint64_t *l1_table = get_or_alloc_table(l0_table, l0_idx);
    if (!l1_table) return ZX_ERR_NO_MEMORY;

    uint64_t *l2_table = get_or_alloc_table(l1_table, l1_idx);
    if (!l2_table) return ZX_ERR_NO_MEMORY;

    uint64_t *l3_table = get_or_alloc_table(l2_table, l2_idx);
    if (!l3_table) return ZX_ERR_NO_MEMORY;

    /* Build L3 Page Descriptor */
    uint64_t desc = (paddr & ENTRY_ADDR_MASK) | DESC_VALID | DESC_PAGE | DESC_AF | DESC_SH_INNER;

    /* Access Permissions (AP[7:6]) */
    if (flags & VMM_FLAG_USER) {
        if (flags & VMM_FLAG_WRITE) {
            desc |= (1ULL << 6); /* EL0 RW, EL1 RW */
        } else {
            desc |= (3ULL << 6); /* EL0 RO, EL1 RO */
        }
    } else {
        if (flags & VMM_FLAG_WRITE) {
            desc |= (0ULL << 6); /* EL1 RW, EL0 No Access */
        } else {
            desc |= (2ULL << 6); /* EL1 RO, EL0 No Access */
        }
    }

    /* Execution Restrictions */
    if (!(flags & VMM_FLAG_EXECUTE)) {
        desc |= DESC_UXN | DESC_PXN;
    }

    /* MAIR Memory Attribute Index */
    if (flags & VMM_FLAG_DEVICE_NGNRNE) {
        desc |= ((uint64_t)MAIR_ATTR_DEVICE_NGNRNE << 2);
    } else if (flags & VMM_FLAG_DEVICE) {
        desc |= ((uint64_t)MAIR_ATTR_DEVICE_NGNRE << 2);
    } else if (flags & VMM_FLAG_NONCACHEABLE) {
        desc |= ((uint64_t)MAIR_ATTR_NORMAL_NC << 2);
    } else {
        desc |= ((uint64_t)MAIR_ATTR_NORMAL_WB << 2);
    }

    l3_table[l3_idx] = desc;

    /* Invalidate TLB for this virtual address if MMU is running */
    if (mmu_enabled) {
        __asm__ volatile("tlbi vaae1is, %0; dsb sy; isb" :: "r"(vaddr >> 12) : "memory");
    }

    return ZX_OK;
}

/**
 * @brief Internal helper to unmap a virtual page from an arbitrary L0 root table.
 */
static zx_status_t unmap_page_in_root(zx_paddr_t root_paddr, zx_vaddr_t vaddr) {
    if ((vaddr & (PAGE_SIZE - 1)) != 0) {
        return ZX_ERR_INVALID_ARGS;
    }
    if (root_paddr == 0) return ZX_ERR_INTERNAL;

    uint64_t vaddr_masked = vaddr & 0x0000FFFFFFFFFFFFULL;
    size_t l0_idx = (vaddr_masked >> L0_SHIFT) & TABLE_INDEX_MASK;
    size_t l1_idx = (vaddr_masked >> L1_SHIFT) & TABLE_INDEX_MASK;
    size_t l2_idx = (vaddr_masked >> L2_SHIFT) & TABLE_INDEX_MASK;
    size_t l3_idx = (vaddr_masked >> L3_SHIFT) & TABLE_INDEX_MASK;

    uint64_t *l0_table = (uint64_t *)(uintptr_t)root_paddr;
    if (!(l0_table[l0_idx] & DESC_VALID)) return ZX_ERR_NOT_FOUND;

    uint64_t *l1_table = (uint64_t *)(uintptr_t)(l0_table[l0_idx] & ENTRY_ADDR_MASK);
    if (!(l1_table[l1_idx] & DESC_VALID)) return ZX_ERR_NOT_FOUND;

    uint64_t *l2_table = (uint64_t *)(uintptr_t)(l1_table[l1_idx] & ENTRY_ADDR_MASK);
    if (!(l2_table[l2_idx] & DESC_VALID)) return ZX_ERR_NOT_FOUND;

    uint64_t *l3_table = (uint64_t *)(uintptr_t)(l2_table[l2_idx] & ENTRY_ADDR_MASK);
    if (!(l3_table[l3_idx] & DESC_VALID)) return ZX_ERR_NOT_FOUND;

    l3_table[l3_idx] = 0;

    if (mmu_enabled) {
        __asm__ volatile("tlbi vaae1is, %0; dsb sy; isb" :: "r"(vaddr >> 12) : "memory");
    }

    return ZX_OK;
}

/**
 * @brief Internal helper to query physical address translation from a given L0 root table.
 */
static zx_paddr_t vaddr_to_paddr_in_root(zx_paddr_t root_paddr, zx_vaddr_t vaddr) {
    if (root_paddr == 0) return (zx_paddr_t)-1;

    uint64_t vaddr_masked = vaddr & 0x0000FFFFFFFFFFFFULL;
    size_t l0_idx = (vaddr_masked >> L0_SHIFT) & TABLE_INDEX_MASK;
    size_t l1_idx = (vaddr_masked >> L1_SHIFT) & TABLE_INDEX_MASK;
    size_t l2_idx = (vaddr_masked >> L2_SHIFT) & TABLE_INDEX_MASK;
    size_t l3_idx = (vaddr_masked >> L3_SHIFT) & TABLE_INDEX_MASK;

    uint64_t *l0_table = (uint64_t *)(uintptr_t)root_paddr;
    if (!(l0_table[l0_idx] & DESC_VALID)) return (zx_paddr_t)-1;

    uint64_t *l1_table = (uint64_t *)(uintptr_t)(l0_table[l0_idx] & ENTRY_ADDR_MASK);
    if (!(l1_table[l1_idx] & DESC_VALID)) return (zx_paddr_t)-1;

    uint64_t *l2_table = (uint64_t *)(uintptr_t)(l1_table[l1_idx] & ENTRY_ADDR_MASK);
    if (!(l2_table[l2_idx] & DESC_VALID)) return (zx_paddr_t)-1;

    uint64_t *l3_table = (uint64_t *)(uintptr_t)(l2_table[l2_idx] & ENTRY_ADDR_MASK);
    if (!(l3_table[l3_idx] & DESC_VALID)) return (zx_paddr_t)-1;

    return (l3_table[l3_idx] & ENTRY_ADDR_MASK) | (vaddr & (PAGE_SIZE - 1));
}

/* ========================================================================= */
/* Public VMM Address Space Management APIs                                  */
/* ========================================================================= */

zx_status_t vmm_aspace_create(vmm_aspace_t *out_aspace) {
    if (!out_aspace) return ZX_ERR_INVALID_ARGS;

    /* Allocate physical page for process root L0 table */
    zx_paddr_t root_paddr = 0;
    zx_status_t status = pmm_alloc_page(&root_paddr);
    if (status != ZX_OK) return status;

    memset((void *)(uintptr_t)root_paddr, 0, PAGE_SIZE);

    out_aspace->ttbr0_paddr = root_paddr;
    out_aspace->base = USER_ASPACE_BASE;
    out_aspace->size = USER_ASPACE_SIZE;
    out_aspace->is_user = true;

    /*
     * Identity map MMIO peripherals & DRAM in the process L0 table with EL1 PRIVILEGED
     * permissions (WITHOUT VMM_FLAG_USER). This guarantees:
     * 1) EL0 userland tasks cannot read, write, or execute kernel memory (hardware fault).
     * 2) When EL0 traps into EL1 via svc/irq, EL1 vectors and serial console are immediately accessible.
     */
    vmm_aspace_map_range(out_aspace, GIC_DIST_BASE_PADDR, GIC_DIST_BASE_PADDR, 0x10000,
                         VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE_NGNRNE);

    vmm_aspace_map_range(out_aspace, GIC_REDIST_BASE_PADDR, GIC_REDIST_BASE_PADDR, 0x60000,
                         VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE_NGNRNE);

    vmm_aspace_map_range(out_aspace, UART0_BASE_PADDR, UART0_BASE_PADDR, 0x1000,
                         VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE);

    vmm_aspace_map_range(out_aspace, RTC_BASE_PADDR, RTC_BASE_PADDR, 0x1000,
                         VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE);

    vmm_aspace_map_range(out_aspace, PCIE_MMIO_BASE_PADDR, PCIE_MMIO_BASE_PADDR, 0x1000000,
                         VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE);

    vmm_aspace_map_range(out_aspace, RAM_BASE_PADDR, RAM_BASE_PADDR, 0x40000000,
                         VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_EXECUTE);

    return ZX_OK;
}

zx_status_t vmm_aspace_destroy(vmm_aspace_t *aspace) {
    if (!aspace || aspace->ttbr0_paddr == 0) return ZX_ERR_INVALID_ARGS;

    if (active_user_aspace == aspace) {
        vmm_set_active_aspace(NULL);
    }

    pmm_free_page(aspace->ttbr0_paddr);
    aspace->ttbr0_paddr = 0;
    return ZX_OK;
}

zx_status_t vmm_aspace_map(vmm_aspace_t *aspace, zx_vaddr_t vaddr, zx_paddr_t paddr, uint64_t flags) {
    if (!aspace || aspace->ttbr0_paddr == 0) return ZX_ERR_INVALID_ARGS;
    return map_page_in_root(aspace->ttbr0_paddr, vaddr, paddr, flags);
}

zx_status_t vmm_aspace_map_range(vmm_aspace_t *aspace, zx_vaddr_t vaddr, zx_paddr_t paddr, size_t size, uint64_t flags) {
    if (!aspace || size == 0) return ZX_OK;

    size_t pages = ALIGN_UP(size, PAGE_SIZE) / PAGE_SIZE;
    for (size_t i = 0; i < pages; i++) {
        zx_status_t st = vmm_aspace_map(aspace, vaddr + (i * PAGE_SIZE), paddr + (i * PAGE_SIZE), flags);
        if (st != ZX_OK) return st;
    }
    return ZX_OK;
}

zx_status_t vmm_aspace_unmap(vmm_aspace_t *aspace, zx_vaddr_t vaddr) {
    if (!aspace || aspace->ttbr0_paddr == 0) return ZX_ERR_INVALID_ARGS;
    return unmap_page_in_root(aspace->ttbr0_paddr, vaddr);
}

zx_paddr_t vmm_aspace_vaddr_to_paddr(vmm_aspace_t *aspace, zx_vaddr_t vaddr) {
    if (!aspace || aspace->ttbr0_paddr == 0) return (zx_paddr_t)-1;
    return vaddr_to_paddr_in_root(aspace->ttbr0_paddr, vaddr);
}

zx_status_t vmm_set_active_aspace(vmm_aspace_t *aspace) {
    active_user_aspace = aspace;

    if (aspace && aspace->ttbr0_paddr != 0) {
        ttbr0_root_paddr = aspace->ttbr0_paddr;
    } else {
        ttbr0_root_paddr = boot_ttbr0_root_paddr;
    }

    if (mmu_enabled) {
        __asm__ volatile(
            "msr ttbr0_el1, %0\n"
            "isb\n"
            "tlbi vmalle1is\n"
            "dsb sy\n"
            "isb\n"
            :: "r"(ttbr0_root_paddr) : "memory"
        );
    }

    return ZX_OK;
}

/* ========================================================================= */
/* Global / Kernel Mapping Interfaces                                        */
/* ========================================================================= */

zx_status_t vmm_map_page(zx_vaddr_t vaddr, zx_paddr_t paddr, uint64_t flags) {
    zx_paddr_t root_paddr = (vaddr >= KERNEL_ASPACE_BASE) ? ttbr1_root_paddr : ttbr0_root_paddr;
    return map_page_in_root(root_paddr, vaddr, paddr, flags);
}

zx_status_t vmm_unmap_page(zx_vaddr_t vaddr) {
    zx_paddr_t root_paddr = (vaddr >= KERNEL_ASPACE_BASE) ? ttbr1_root_paddr : ttbr0_root_paddr;
    return unmap_page_in_root(root_paddr, vaddr);
}

zx_status_t vmm_map_range(zx_vaddr_t vaddr, zx_paddr_t paddr, size_t size, uint64_t flags) {
    if (size == 0) return ZX_OK;

    size_t pages = ALIGN_UP(size, PAGE_SIZE) / PAGE_SIZE;
    for (size_t i = 0; i < pages; i++) {
        zx_status_t status = vmm_map_page(vaddr + (i * PAGE_SIZE), paddr + (i * PAGE_SIZE), flags);
        if (status != ZX_OK) {
            return status;
        }
    }
    return ZX_OK;
}

zx_status_t vmm_unmap_range(zx_vaddr_t vaddr, size_t size) {
    if (size == 0) return ZX_OK;

    size_t pages = ALIGN_UP(size, PAGE_SIZE) / PAGE_SIZE;
    for (size_t i = 0; i < pages; i++) {
        vmm_unmap_page(vaddr + (i * PAGE_SIZE));
    }
    return ZX_OK;
}

zx_paddr_t vmm_vaddr_to_paddr(zx_vaddr_t vaddr) {
    zx_paddr_t root_paddr = (vaddr >= KERNEL_ASPACE_BASE) ? ttbr1_root_paddr : ttbr0_root_paddr;
    return vaddr_to_paddr_in_root(root_paddr, vaddr);
}

zx_status_t vmm_init(void) {
    /* Allocate L0 translation tables for TTBR0 and TTBR1 */
    zx_status_t status = pmm_alloc_page(&boot_ttbr0_root_paddr);
    if (status != ZX_OK) return status;

    status = pmm_alloc_page(&ttbr1_root_paddr);
    if (status != ZX_OK) return status;

    ttbr0_root_paddr = boot_ttbr0_root_paddr;

    memset((void *)(uintptr_t)boot_ttbr0_root_paddr, 0, PAGE_SIZE);
    memset((void *)(uintptr_t)ttbr1_root_paddr, 0, PAGE_SIZE);

    /* 1. Identity Map MMIO Peripherals in TTBR0 */
    /* GICv3 Distributor (0x08000000, 64 KiB) */
    vmm_map_range(GIC_DIST_BASE_PADDR, GIC_DIST_BASE_PADDR, 0x10000,
                  VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE_NGNRNE);

    /* GICv3 Redistributor (0x080A0000, 384 KiB) */
    vmm_map_range(GIC_REDIST_BASE_PADDR, GIC_REDIST_BASE_PADDR, 0x60000,
                  VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE_NGNRNE);

    /* PrimeCell PL011 UART0 (0x09000000, 4 KiB) */
    vmm_map_range(UART0_BASE_PADDR, UART0_BASE_PADDR, 0x1000,
                  VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE);

    /* PL031 Real Time Clock (0x09010000, 4 KiB) */
    vmm_map_range(RTC_BASE_PADDR, RTC_BASE_PADDR, 0x1000,
                  VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE);

    /* PCIe MMIO early region (0x10000000, 16 MiB) */
    vmm_map_range(PCIE_MMIO_BASE_PADDR, PCIE_MMIO_BASE_PADDR, 0x1000000,
                  VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE);

    /* 2. Identity Map DRAM Memory (0x40000000 to 0x80000000 = 1 GiB) in TTBR0 */
    vmm_map_range(RAM_BASE_PADDR, RAM_BASE_PADDR, 0x40000000,
                  VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_EXECUTE);

    /* 3. High Memory Mapping in TTBR1 (KERNEL_ASPACE_BASE + DRAM) */
    vmm_map_range(KERNEL_ASPACE_BASE + RAM_BASE_PADDR, RAM_BASE_PADDR, 0x40000000,
                  VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_EXECUTE);

    /* High Memory Mapping for UART Console */
    vmm_map_range(KERNEL_ASPACE_BASE + UART0_BASE_PADDR, UART0_BASE_PADDR, 0x1000,
                  VMM_FLAG_READ | VMM_FLAG_WRITE | VMM_FLAG_DEVICE);

    uart_puts("[VMM] Virtual Memory Manager Initialized (4-Level ARM64 Paging):\n");
    uart_puts("      TTBR0 Root (Identity/User): ");
    uart_write_hex(ttbr0_root_paddr);
    uart_puts("\n      TTBR1 Root (High Kernel)  : ");
    uart_write_hex(ttbr1_root_paddr);
    uart_puts("\n      Mapped Identity MMIO      : GIC (0x08000000), UART (0x09000000), RTC, PCIe\n");
    uart_puts("      Mapped Identity DRAM      : 0x40000000 - 0x80000000 (1 GiB, RWX)\n");
    uart_puts("      Mapped High Memory Direct : 0xFFFF000040000000 -> 0x40000000\n");

    return ZX_OK;
}

void vmm_enable_mmu(void) {
    if (mmu_enabled) return;

    /*
     * 1. MAIR_EL1 Configuration:
     * Index 0: Device-nGnRnE (0x00)
     * Index 1: Device-nGnRE  (0x04)
     * Index 2: Normal Memory WB (0xFF)
     * Index 3: Normal Non-Cacheable (0x44)
     */
    uint64_t mair = ((uint64_t)0x00 << (8 * MAIR_ATTR_DEVICE_NGNRNE)) |
                    ((uint64_t)0x04 << (8 * MAIR_ATTR_DEVICE_NGNRE))  |
                    ((uint64_t)0xFF << (8 * MAIR_ATTR_NORMAL_WB))     |
                    ((uint64_t)0x44 << (8 * MAIR_ATTR_NORMAL_NC));
    __asm__ volatile("msr mair_el1, %0" :: "r"(mair) : "memory");

    /*
     * 2. TCR_EL1 Configuration:
     * - T0SZ = 16 (48-bit VA for TTBR0)
     * - T1SZ = 16 (48-bit VA for TTBR1)
     * - TG0  = 0b00 (4 KiB granule)
     * - TG1  = 0b10 (4 KiB granule)
     * - SH0  = 0b11 (Inner Shareable)
     * - SH1  = 0b11 (Inner Shareable)
     * - ORGN0/IRGN0 = 0b01 (Normal Outer/Inner WB WA)
     * - ORGN1/IRGN1 = 0b01 (Normal Outer/Inner WB WA)
     * - IPS  = 0b010 (40-bit Intermediate Physical Address / 1 TB)
     */
    uint64_t tcr = (16ULL << 0)   | /* T0SZ */
                   (1ULL << 8)    | /* IRGN0 = Inner WB WA */
                   (1ULL << 10)   | /* ORGN0 = Outer WB WA */
                   (3ULL << 12)   | /* SH0 = Inner Shareable */
                   (0ULL << 14)   | /* TG0 = 4 KiB */
                   (16ULL << 16)  | /* T1SZ */
                   (1ULL << 24)   | /* IRGN1 = Inner WB WA */
                   (1ULL << 26)   | /* ORGN1 = Outer WB WA */
                   (3ULL << 28)   | /* SH1 = Inner Shareable */
                   (2ULL << 30)   | /* TG1 = 4 KiB (0b10) */
                   (2ULL << 32);    /* IPS = 40-bit PA (0b010) */
    __asm__ volatile("msr tcr_el1, %0" :: "r"(tcr) : "memory");

    /* 3. Program Base Translation Tables */
    __asm__ volatile("msr ttbr0_el1, %0" :: "r"(ttbr0_root_paddr) : "memory");
    __asm__ volatile("msr ttbr1_el1, %0" :: "r"(ttbr1_root_paddr) : "memory");

    /* Ensure table writes are visible before MMU activation */
    isb();
    dsb();

    /* 4. Invalidate entire TLB */
    __asm__ volatile("tlbi vmalle1is" ::: "memory");
    dsb();
    isb();

    /* 5. Enable MMU and Caches in SCTLR_EL1 */
    uint64_t sctlr;
    __asm__ volatile("mrs %0, sctlr_el1" : "=r"(sctlr));
    sctlr |= (1ULL << 0);  /* M: MMU Enable */
    sctlr |= (1ULL << 2);  /* C: Data Cache Enable */
    sctlr |= (1ULL << 12); /* I: Instruction Cache Enable */
    __asm__ volatile("msr sctlr_el1, %0" :: "r"(sctlr) : "memory");
    isb();

    mmu_enabled = true;
    uart_puts("[VMM] ARM64 MMU Enabled: SCTLR_EL1.M=1, Caches Active (TCR/MAIR Configured)\n");
}
