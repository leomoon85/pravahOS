/*
 * PravahOS ARM64 Microkernel Linker Script
 * Target: QEMU ARM64 'virt' Machine
 */

OUTPUT_FORMAT("elf64-littleaarch64")
OUTPUT_ARCH(aarch64)
ENTRY(_start)

SECTIONS
{
    /* QEMU virt DRAM begins at 0x40000000; load early kernel at +512KB offset (0x40080000) */
    . = 0x40080000;

    __kernel_start = .;

    /* Early boot code must reside at the very beginning of the image */
    .text.boot : {
        *(.text.boot)
    }

    . = ALIGN(4096);
    .text : {
        *(.text .text.*)
    }

    . = ALIGN(4096);
    .rodata : {
        *(.rodata .rodata.*)
    }

    . = ALIGN(4096);
    .data : {
        *(.data .data.*)
    }

    . = ALIGN(16);
    __bss_start = .;
    .bss : {
        *(.bss .bss.*)
        *(COMMON)
    }
    . = ALIGN(16);
    __bss_end = .;

    /* Boot stack allocation (64 KiB) */
    . = ALIGN(16);
    boot_stack_bottom = .;
    . += 0x10000;
    boot_stack_top = .;

    . = ALIGN(4096);
    __kernel_end = .;

    /DISCARD/ : {
        *(.comment)
        *(.note*)
        *(.eh_frame)
    }
}
