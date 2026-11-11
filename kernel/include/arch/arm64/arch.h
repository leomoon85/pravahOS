/**
 * @file arch.h
 * @brief ARM64 Architectural definitions and system register access helpers.
 */

#ifndef PRAVAH_ARCH_ARM64_H
#define PRAVAH_ARCH_ARM64_H

#include "kernel/types.h"

/* Instruction Barriers */
static inline void isb(void) {
    __asm__ volatile("isb" ::: "memory");
}

static inline void dsb(void) {
    __asm__ volatile("dsb sy" ::: "memory");
}

static inline void dmb(void) {
    __asm__ volatile("dmb sy" ::: "memory");
}

/* Low-power CPU Wait */
static inline void wfi(void) {
    __asm__ volatile("wfi");
}

static inline void wfe(void) {
    __asm__ volatile("wfe");
}

/* System Register Accessors */
static inline uint64_t arm64_read_current_el(void) {
    uint64_t val;
    __asm__ volatile("mrs %0, CurrentEL" : "=r"(val));
    return (val >> 2) & 0x3;
}

static inline uint64_t arm64_read_mpidr(void) {
    uint64_t val;
    __asm__ volatile("mrs %0, mpidr_el1" : "=r"(val));
    return val;
}

static inline uint64_t arm64_read_midr(void) {
    uint64_t val;
    __asm__ volatile("mrs %0, midr_el1" : "=r"(val));
    return val;
}

static inline uint64_t arm64_read_pfr0(void) {
    uint64_t val;
    __asm__ volatile("mrs %0, id_aa64pfr0_el1" : "=r"(val));
    return val;
}

static inline uint64_t arm64_read_cntfrq(void) {
    uint64_t val;
    __asm__ volatile("mrs %0, cntfrq_el0" : "=r"(val));
    return val;
}

static inline uint64_t arm64_read_pct(void) {
    uint64_t val;
    __asm__ volatile("mrs %0, cntpct_el0" : "=r"(val));
    return val;
}

static inline void arm64_set_vbar_el1(uint64_t vbar) {
    __asm__ volatile("msr vbar_el1, %0" :: "r"(vbar) : "memory");
    isb();
}

#endif /* PRAVAH_ARCH_ARM64_H */
