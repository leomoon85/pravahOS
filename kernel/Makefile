# PravahOS Kernel Standalone Makefile
# Targets ARM64 Bare-Metal (QEMU virt)

# Toolchain configuration (auto-detects Clang or GCC cross compiler)
TOOLCHAIN ?= clang

ifeq ($(TOOLCHAIN),clang)
    CC       := clang --target=aarch64-none-elf
    AS       := clang --target=aarch64-none-elf
    LD       := ld.lld
    OBJCOPY  := llvm-objcopy
    OBJDUMP  := llvm-objdump
else
    CROSS_COMPILE ?= aarch64-none-elf-
    CC       := $(CROSS_COMPILE)gcc
    AS       := $(CROSS_COMPILE)as
    LD       := $(CROSS_COMPILE)ld
    OBJCOPY  := $(CROSS_COMPILE)objcopy
    OBJDUMP  := $(CROSS_COMPILE)objdump
endif

BUILD_DIR ?= build
OUTPUT_DIR ?= ../build/zircon-arm64

CFLAGS   := -Wall -Wextra -O2 -g -ffreestanding -nostdlib -mgeneral-regs-only -Iinclude
ASFLAGS  := -g -Iinclude
LDFLAGS  := -T linker.ld -nostdlib -static --gc-sections

SRCS_C   := main.c arch/arm64/uart_pl011.c lib/string.c mm/pmm.c mm/vmm.c object/handle.c object/vmo.c object/channel.c drivers/display/display.c drivers/input/input.c compositor/compositor.c hal/camera_hal.c hal/audio_hal.c hal/power_hal.c hal/telephony_hal.c process/elf.c process/process.c process/thread.c process/syscall.c
SRCS_S   := arch/arm64/boot.S arch/arm64/switch.S

OBJS     := $(patsubst %.c,$(BUILD_DIR)/%.o,$(SRCS_C)) \
            $(patsubst %.S,$(BUILD_DIR)/%.o,$(SRCS_S))

TARGET_ELF := $(BUILD_DIR)/pravah_kernel.elf
TARGET_BIN := $(BUILD_DIR)/pravah_kernel.bin
TARGET_DIS := $(BUILD_DIR)/pravah_kernel.dis

.PHONY: all clean qemu disasm

all: $(TARGET_BIN)

$(BUILD_DIR):
	@mkdir -p $(BUILD_DIR)/arch/arm64
	@mkdir -p $(BUILD_DIR)/lib
	@mkdir -p $(BUILD_DIR)/mm
	@mkdir -p $(BUILD_DIR)/object
	@mkdir -p $(BUILD_DIR)/drivers/display
	@mkdir -p $(BUILD_DIR)/drivers/input
	@mkdir -p $(BUILD_DIR)/compositor
	@mkdir -p $(BUILD_DIR)/hal
	@mkdir -p $(BUILD_DIR)/process
	@mkdir -p $(OUTPUT_DIR)

$(BUILD_DIR)/%.o: %.c | $(BUILD_DIR)
	@echo "[CC] $<"
	@$(CC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/%.o: %.S | $(BUILD_DIR)
	@echo "[AS] $<"
	@$(CC) $(ASFLAGS) -c $< -o $@

$(TARGET_ELF): $(OBJS) linker.ld
	@echo "[LD] $@"
	@$(LD) $(LDFLAGS) $(OBJS) -o $@

$(TARGET_BIN): $(TARGET_ELF)
	@echo "[OBJCOPY] $@"
	@$(OBJCOPY) -O binary $< $@
	@cp -f $@ $(OUTPUT_DIR)/zircon.bin
	@echo "Kernel successfully generated at $(OUTPUT_DIR)/zircon.bin"

disasm: $(TARGET_DIS)

$(TARGET_DIS): $(TARGET_ELF)
	@echo "[OBJDUMP] $@"
	@$(OBJDUMP) -d $< > $@

qemu: $(TARGET_BIN)
	qemu-system-aarch64 -M virt,gic-version=3 -cpu cortex-a76 -m 4096M -smp 4 -nographic -serial mon:stdio -kernel $(TARGET_BIN)

clean:
	@rm -rf $(BUILD_DIR)
