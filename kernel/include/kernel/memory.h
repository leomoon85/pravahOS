/**
 * @file memory.h
 * @brief PravahOS Physical Memory Map & Hardware Addresses for ARM64 QEMU virt.
 */

#ifndef PRAVAH_KERNEL_MEMORY_H
#define PRAVAH_KERNEL_MEMORY_H

#include "types.h"

/* QEMU virt ARM64 MMIO Physical Memory Map */
#define GIC_DIST_BASE_PADDR     (0x08000000ULL)  /* GICv3 Distributor */
#define GIC_REDIST_BASE_PADDR   (0x080A0000ULL)  /* GICv3 Redistributor */
#define UART0_BASE_PADDR        (0x09000000ULL)  /* PrimeCell PL011 UART */
#define RTC_BASE_PADDR          (0x09010000ULL)  /* PL031 Real Time Clock */
#define FW_CFG_BASE_PADDR       (0x09020000ULL)  /* QEMU fw_cfg device */
#define PCIE_MMIO_BASE_PADDR    (0x10000000ULL)  /* PCI Express MMIO */

/* DRAM Physical Layout */
#define RAM_BASE_PADDR          (0x40000000ULL)  /* DRAM start (1GB boundary) */
#define KERNEL_LOAD_PADDR       (0x40080000ULL)  /* Kernel entry physical load point */
#define RAM_SIZE_DEFAULT        (0x100000000ULL) /* 4 GiB default memory */

/* Paging Geometry */
#define PAGE_SHIFT              (12)
#define PAGE_SIZE               (1ULL << PAGE_SHIFT)      /* 4096 bytes */
#define PAGE_MASK               (~(PAGE_SIZE - 1))

#define LARGE_PAGE_SHIFT        (21)
#define LARGE_PAGE_SIZE         (1ULL << LARGE_PAGE_SHIFT) /* 2 MiB */

/* Early Stack Layout */
#define BOOT_STACK_SIZE         (0x10000ULL)     /* 64 KiB boot stack */

#endif /* PRAVAH_KERNEL_MEMORY_H */
