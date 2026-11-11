/**
 * @file console.h
 * @brief Early Kernel Console and Logging Facility.
 */

#ifndef PRAVAH_KERNEL_CONSOLE_H
#define PRAVAH_KERNEL_CONSOLE_H

#include "types.h"
#include "arch/arm64/uart_pl011.h"

/* Early console logging helpers */
static inline void kputs(const char *s) {
    uart_puts(s);
}

static inline void kputc(char c) {
    uart_putc(c);
}

static inline void kputhex(uint64_t val) {
    uart_write_hex(val);
}

static inline void kputdec(uint64_t val) {
    uart_write_dec(val);
}

/* Logging with subsystem prefixes */
#define KLOG_INFO(tag, msg)   do { uart_puts("[" tag "] " msg "\n"); } while (0)
#define KLOG_WARN(tag, msg)   do { uart_puts("[WARN:" tag "] " msg "\n"); } while (0)
#define KLOG_ERR(tag, msg)    do { uart_puts("[ERR:" tag "] " msg "\n"); } while (0)

#endif /* PRAVAH_KERNEL_CONSOLE_H */
