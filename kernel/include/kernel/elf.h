/**
 * @file elf.h
 * @brief PravahOS ELF64 Binary Parser & Program Header Definitions.
 *
 * Conforms to the System V ABI AMD64 / AArch64 standard for 64-bit Executable
 * and Linkable Format (ELF64).
 */

#ifndef PRAVAH_KERNEL_ELF_H
#define PRAVAH_KERNEL_ELF_H

#include "types.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ELF Identification Indices (e_ident) */
#define EI_MAG0         0
#define EI_MAG1         1
#define EI_MAG2         2
#define EI_MAG3         3
#define EI_CLASS        4
#define EI_DATA         5
#define EI_VERSION      6
#define EI_OSABI        7
#define EI_ABIVERSION   8
#define EI_PAD          9
#define EI_NIDENT       16

/* ELF Magic Bytes: 0x7f, 'E', 'L', 'F' */
#define ELFMAG0         0x7f
#define ELFMAG1         'E'
#define ELFMAG2         'L'
#define ELFMAG3         'F'

/* Architecture Class (e_ident[EI_CLASS]) */
#define ELFCLASSNONE    0
#define ELFCLASS32      1
#define ELFCLASS64      2

/* Data Encoding / Endianness (e_ident[EI_DATA]) */
#define ELFDATANONE     0
#define ELFDATA2LSB     1 /* 2's complement, Little-Endian */
#define ELFDATA2MSB     2 /* 2's complement, Big-Endian */

/* ELF Version */
#define EV_CURRENT      1

/* ELF Object File Types (e_type) */
#define ET_NONE         0
#define ET_REL          1
#define ET_EXEC         2 /* Executable file */
#define ET_DYN          3 /* Shared object / Position-Independent Executable */
#define ET_CORE         4

/* Target Machine Architectures (e_machine) */
#define EM_NONE         0
#define EM_AARCH64      183 /* ARM 64-bit architecture (AArch64) */

/* Program Header Segment Types (p_type) */
#define PT_NULL         0
#define PT_LOAD         1 /* Loadable segment */
#define PT_DYNAMIC      2 /* Dynamic linking information */
#define PT_INTERP       3 /* Program interpreter path */
#define PT_NOTE         4 /* Auxiliary information */
#define PT_SHLIB        5 /* Reserved */
#define PT_PHDR         6 /* Program header table itself */
#define PT_TLS          7 /* Thread-local storage segment */
#define PT_GNU_STACK    0x6474e551 /* Stack flags */

/* Program Header Permission Flags (p_flags) */
#define PF_X            (1u << 0) /* Executable */
#define PF_W            (1u << 1) /* Writable */
#define PF_R            (1u << 2) /* Readable */

/**
 * @brief Standard ELF64 File Header.
 */
typedef struct {
    unsigned char e_ident[EI_NIDENT]; /* ELF identification bytes */
    uint16_t      e_type;             /* Object file type */
    uint16_t      e_machine;          /* Architecture requirement */
    uint32_t      e_version;          /* Object file version */
    uint64_t      e_entry;            /* Entry point virtual address */
    uint64_t      e_phoff;            /* Program header table file offset */
    uint64_t      e_shoff;            /* Section header table file offset */
    uint32_t      e_flags;            /* Processor-specific flags */
    uint16_t      e_ehsize;           /* ELF header size in bytes */
    uint16_t      e_phentsize;        /* Program header entry size */
    uint16_t      e_phnum;            /* Number of program header entries */
    uint16_t      e_shentsize;        /* Section header entry size */
    uint16_t      e_shnum;            /* Number of section header entries */
    uint16_t      e_shstrndx;         /* Section name string table index */
} __attribute__((packed)) Elf64_Ehdr;

/**
 * @brief Standard ELF64 Program Header entry.
 */
typedef struct {
    uint32_t p_type;   /* Segment type (e.g. PT_LOAD) */
    uint32_t p_flags;  /* Segment permission flags (PF_R, PF_W, PF_X) */
    uint64_t p_offset; /* Segment file offset */
    uint64_t p_vaddr;  /* Virtual memory address */
    uint64_t p_paddr;  /* Physical address (unused / physical load) */
    uint64_t p_filesz; /* Segment size in file */
    uint64_t p_memsz;  /* Segment size in memory (memsz >= filesz) */
    uint64_t p_align;  /* Segment memory alignment */
} __attribute__((packed)) Elf64_Phdr;

/* Maximum tracked load segments per ELF binary */
#define MAX_ELF_LOAD_SEGMENTS 16

/**
 * @brief Parsed loadable segment metadata.
 */
typedef struct {
    zx_vaddr_t vaddr;       /* Target virtual address */
    size_t     mem_size;    /* Segment size in memory */
    size_t     file_size;   /* Segment byte size in ELF file */
    uint64_t   file_offset; /* Offset from start of ELF file */
    uint32_t   flags;       /* ELF flags (PF_R, PF_W, PF_X) */
    uint32_t   vmm_flags;   /* Translated VMM mapping flags */
} elf_load_segment_t;

/**
 * @brief High-level summary of parsed ELF binary.
 */
typedef struct {
    zx_vaddr_t         entry_point;
    size_t             segment_count;
    elf_load_segment_t segments[MAX_ELF_LOAD_SEGMENTS];
    zx_vaddr_t         min_vaddr;
    zx_vaddr_t         max_vaddr;
    size_t             total_memory_size;
} elf_info_t;

/* Forward declaration for process pointer */
struct process;

/**
 * @brief Validate an ELF64 binary header for AArch64 Little-Endian target.
 *
 * @param buffer Pointer to raw binary image in memory.
 * @param size Total byte size of binary image.
 * @return ZX_OK on success, or ZX_ERR_NOT_SUPPORTED / ZX_ERR_INVALID_ARGS.
 */
zx_status_t elf_validate_header(const void *buffer, size_t size);

/**
 * @brief Parse ELF64 headers and extract PT_LOAD segments and entry point.
 *
 * @param buffer Pointer to raw binary image.
 * @param size Total byte size of binary image.
 * @param[out] out_info Parsed ELF information structure.
 * @return ZX_OK on success, or error code.
 */
zx_status_t elf_parse(const void *buffer, size_t size, elf_info_t *out_info);

/**
 * @brief Load an ELF64 binary into a process's user address space.
 *
 * Allocates physical frames via PMM, maps virtual pages into process address space,
 * copies segment payloads, and zeroes out BSS (.bss) segments.
 *
 * @param proc Target process.
 * @param buffer Pointer to ELF binary in memory.
 * @param size Total byte size of binary image.
 * @param[out] out_entry Resulting virtual entry point.
 * @return ZX_OK on success, or error code.
 */
zx_status_t elf_load_process(struct process *proc, const void *buffer, size_t size, zx_vaddr_t *out_entry);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_KERNEL_ELF_H */
