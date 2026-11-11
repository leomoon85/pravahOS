/**
 * @file uart_pl011.h
 * @brief PrimeCell PL011 UART driver header for ARM64 QEMU virt.
 */

#ifndef PRAVAH_UART_PL011_H
#define PRAVAH_UART_PL011_H

#include "kernel/types.h"
#include "kernel/memory.h"

/* PL011 Register Offsets */
#define UART0_DR        (UART0_BASE_PADDR + 0x000) /* Data Register */
#define UART0_RSR       (UART0_BASE_PADDR + 0x004) /* Receive Status Register */
#define UART0_ECR       (UART0_BASE_PADDR + 0x004) /* Error Clear Register */
#define UART0_FR        (UART0_BASE_PADDR + 0x018) /* Flag Register */
#define UART0_ILPR      (UART0_BASE_PADDR + 0x020) /* IrDA Low-Power Counter */
#define UART0_IBRD      (UART0_BASE_PADDR + 0x024) /* Integer Baud Rate Register */
#define UART0_FBRD      (UART0_BASE_PADDR + 0x028) /* Fractional Baud Rate Register */
#define UART0_LCR_H     (UART0_BASE_PADDR + 0x02C) /* Line Control Register */
#define UART0_CR        (UART0_BASE_PADDR + 0x030) /* Control Register */
#define UART0_IFLS      (UART0_BASE_PADDR + 0x034) /* Interrupt FIFO Level Select */
#define UART0_IMSC      (UART0_BASE_PADDR + 0x038) /* Interrupt Mask Set/Clear */
#define UART0_RIS       (UART0_BASE_PADDR + 0x03C) /* Raw Interrupt Status */
#define UART0_MIS       (UART0_BASE_PADDR + 0x040) /* Masked Interrupt Status */
#define UART0_ICR       (UART0_BASE_PADDR + 0x044) /* Interrupt Clear Register */
#define UART0_DMACR     (UART0_BASE_PADDR + 0x048) /* DMA Control Register */

/* Flag Register (FR) Bits */
#define PL011_FR_TXFE   (1U << 7) /* Transmit FIFO empty */
#define PL011_FR_RXFF   (1U << 6) /* Receive FIFO full */
#define PL011_FR_TXFF   (1U << 5) /* Transmit FIFO full */
#define PL011_FR_RXFE   (1U << 4) /* Receive FIFO empty */
#define PL011_FR_BUSY   (1U << 3) /* UART busy */

/* Line Control Register (LCR_H) Bits */
#define PL011_LCR_SPS   (1U << 7) /* Stick parity select */
#define PL011_LCR_WLEN8 (3U << 5) /* Word length: 8 bits */
#define PL011_LCR_FEN   (1U << 4) /* Enable FIFOs */
#define PL011_LCR_STP2  (1U << 3) /* Two stop bits */
#define PL011_LCR_EPS   (1U << 2) /* Even parity select */
#define PL011_LCR_PEN   (1U << 1) /* Parity enable */
#define PL011_LCR_BRK   (1U << 0) /* Send break */

/* Control Register (CR) Bits */
#define PL011_CR_CTSEN  (1U << 15) /* CTS hardware flow control enable */
#define PL011_CR_RTSEN  (1U << 14) /* RTS hardware flow control enable */
#define PL011_CR_OUT2   (1U << 13) /* Complement of UART Out2 */
#define PL011_CR_OUT1   (1U << 12) /* Complement of UART Out1 */
#define PL011_CR_RTS    (1U << 11) /* Request to Send */
#define PL011_CR_DTR    (1U << 10) /* Data Terminal Ready */
#define PL011_CR_RXE    (1U << 9)  /* Receive enable */
#define PL011_CR_TXE    (1U << 8)  /* Transmit enable */
#define PL011_CR_LBE    (1U << 7)  /* Loopback enable */
#define PL011_CR_UARTEN (1U << 0)  /* UART enable */

/* Driver API */
void uart_init(void);
void uart_putc(char c);
void uart_puts(const char *s);
void uart_write_hex(uint64_t val);
void uart_write_dec(uint64_t val);
char uart_getc(void);
bool uart_has_char(void);

#endif /* PRAVAH_UART_PL011_H */
