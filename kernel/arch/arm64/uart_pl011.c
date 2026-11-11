/**
 * @file uart_pl011.c
 * @brief Memory-Mapped PL011 UART Driver for ARM64 QEMU virt.
 */

#include "arch/arm64/uart_pl011.h"
#include "arch/arm64/arch.h"

/* MMIO register read/write helpers */
static inline void mmio_write32(uintptr_t addr, uint32_t val) {
    *(volatile uint32_t *)addr = val;
}

static inline uint32_t mmio_read32(uintptr_t addr) {
    return *(volatile uint32_t *)addr;
}

/**
 * @brief Initialize the PL011 UART hardware controller.
 */
void uart_init(void) {
    /* Wait for any ongoing transmission to finish */
    while (mmio_read32(UART0_FR) & PL011_FR_BUSY) {
        /* spin */
    }

    /* Disable UART before programming baud rate and line control */
    mmio_write32(UART0_CR, 0x00000000);

    /* Clear pending interrupts */
    mmio_write32(UART0_ICR, 0x000007FF);

    /*
     * For QEMU virt, default clock is 24MHz.
     * Baud Rate Divisor for 115200:
     *   Divider = 24,000,000 / (16 * 115200) = 13.020833
     *   IBRD = 13 (0x0D)
     *   FBRD = round(0.020833 * 64) = 1 (0x01)
     */
    mmio_write32(UART0_IBRD, 13);
    mmio_write32(UART0_FBRD, 1);

    /* Line Control: 8-bit word length, FIFOs enabled, no parity, 1 stop bit */
    mmio_write32(UART0_LCR_H, PL011_LCR_WLEN8 | PL011_LCR_FEN);

    /* Mask (disable) all interrupts for early polling-mode console */
    mmio_write32(UART0_IMSC, 0x00000000);

    /* Enable UART, Transmit (TXE), and Receive (RXE) */
    mmio_write32(UART0_CR, PL011_CR_UARTEN | PL011_CR_TXE | PL011_CR_RXE);

    dsb();
}

/**
 * @brief Write a single byte/character to the UART transmit FIFO.
 */
void uart_putc(char c) {
    /* If newline, prepend carriage return for clean serial terminal output */
    if (c == '\n') {
        uart_putc('\r');
    }

    /* Wait until the transmit FIFO has room */
    while (mmio_read32(UART0_FR) & PL011_FR_TXFF) {
        /* spin */
    }

    mmio_write32(UART0_DR, (uint32_t)(uint8_t)c);
}

/**
 * @brief Transmit a null-terminated string to the serial console.
 */
void uart_puts(const char *s) {
    if (!s) return;
    while (*s) {
        uart_putc(*s++);
    }
}

/**
 * @brief Print a 64-bit integer formatted as uppercase hexadecimal (0x...).
 */
void uart_write_hex(uint64_t val) {
    static const char hex_chars[] = "0123456789ABCDEF";
    uart_puts("0x");

    bool leading_zero = true;
    for (int i = 60; i >= 0; i -= 4) {
        uint8_t nibble = (val >> i) & 0x0F;
        if (nibble != 0 || i == 0) {
            leading_zero = false;
        }
        if (!leading_zero || i == 0) {
            uart_putc(hex_chars[nibble]);
        }
    }
}

/**
 * @brief Print an unsigned integer in decimal format.
 */
void uart_write_dec(uint64_t val) {
    if (val == 0) {
        uart_putc('0');
        return;
    }

    char buf[21];
    int pos = 0;
    while (val > 0) {
        buf[pos++] = '0' + (val % 10);
        val /= 10;
    }

    for (int i = pos - 1; i >= 0; i--) {
        uart_putc(buf[i]);
    }
}

/**
 * @brief Query if a character is waiting in the receive FIFO.
 */
bool uart_has_char(void) {
    return !(mmio_read32(UART0_FR) & PL011_FR_RXFE);
}

/**
 * @brief Read a single character from the UART receive FIFO (blocking).
 */
char uart_getc(void) {
    while (!uart_has_char()) {
        wfe();
    }
    return (char)(mmio_read32(UART0_DR) & 0xFF);
}
