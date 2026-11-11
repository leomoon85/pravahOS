cmake_minimum_required(VERSION 3.20)
project(pravah_kernel C ASM)

# Ensure ARM64 target architecture
if(NOT DEFINED CMAKE_SYSTEM_NAME)
    set(CMAKE_SYSTEM_NAME Generic)
endif()
if(NOT DEFINED CMAKE_SYSTEM_PROCESSOR)
    set(CMAKE_SYSTEM_PROCESSOR aarch64)
endif()

# Compiler toolchain detection and flags
if(CMAKE_C_COMPILER_ID MATCHES "Clang")
    set(ARCH_FLAGS "--target=aarch64-none-elf")
    set(LINKER_FLAGS "-fuse-ld=lld")
else()
    set(ARCH_FLAGS "")
    set(LINKER_FLAGS "")
endif()

set(COMMON_FLAGS
    ${ARCH_FLAGS}
    -ffreestanding
    -nostdlib
    -mgeneral-regs-only
    -Wall
    -Wextra
    -Werror=implicit-function-declaration
    -O2
    -g
)

add_compile_options(${COMMON_FLAGS})

# Include Directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# Source Files
set(KERNEL_SRCS
    arch/arm64/boot.S
    arch/arm64/switch.S
    arch/arm64/uart_pl011.c
    lib/string.c
    mm/pmm.c
    mm/vmm.c
    object/handle.c
    object/vmo.c
    object/channel.c
    process/elf.c
    process/process.c
    process/thread.c
    process/syscall.c
    drivers/display/display.c
    drivers/input/input.c
    compositor/compositor.c
    hal/camera_hal.c
    hal/audio_hal.c
    hal/power_hal.c
    hal/telephony_hal.c
    main.c
)

# Kernel ELF target
add_executable(pravah_kernel.elf ${KERNEL_SRCS})

set(LINK_SCRIPT ${CMAKE_CURRENT_SOURCE_DIR}/linker.ld)

target_link_options(pravah_kernel.elf PRIVATE
    ${ARCH_FLAGS}
    ${LINKER_FLAGS}
    -nostdlib
    -static
    -T ${LINK_SCRIPT}
    -Wl,--build-id=none
    -Wl,-gc-sections
)

set_target_properties(pravah_kernel.elf PROPERTIES
    LINK_DEPENDS ${LINK_SCRIPT}
    OUTPUT_NAME "pravah_kernel"
    SUFFIX ".elf"
)

# Determine objcopy tool
if(NOT DEFINED OBJCOPY)
    if(CMAKE_OBJCOPY)
        set(OBJCOPY ${CMAKE_OBJCOPY})
    elseif(CMAKE_C_COMPILER_ID MATCHES "Clang")
        set(OBJCOPY "llvm-objcopy")
    else()
        set(OBJCOPY "aarch64-none-elf-objcopy")
    endif()
endif()

# Custom command to generate flat binary (.bin)
add_custom_command(
    TARGET pravah_kernel.elf POST_BUILD
    COMMAND ${OBJCOPY} -O binary $<TARGET_FILE:pravah_kernel.elf> ${CMAKE_CURRENT_BINARY_DIR}/pravah_kernel.bin
    COMMAND ${CMAKE_COMMAND} -E make_directory ${CMAKE_CURRENT_SOURCE_DIR}/../build/zircon-arm64
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${CMAKE_CURRENT_BINARY_DIR}/pravah_kernel.bin ${CMAKE_CURRENT_SOURCE_DIR}/../build/zircon-arm64/zircon.bin
    COMMENT "Generating flat binary pravah_kernel.bin and syncing to build/zircon-arm64/zircon.bin"
)
