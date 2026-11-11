/**
 * @file elf.c
 * @brief PravahOS ELF64 Binary Parser & Executable Image Loader.
 */

#include "kernel/elf.h"
#include "kernel/process.h"
#include "kernel/pmm.h"
#include "kernel/vmm.h"
#include "kernel/string.h"
#include "arch/arm64/uart_pl011.h"

zx_status_t elf_validate_header(const void *buffer, size_t size) {
    if (!buffer || size < sizeof(Elf64_Ehdr)) {
        return ZX_ERR_INVALID_ARGS;
    }

    const Elf64_Ehdr *ehdr = (const Elf64_Ehdr *)buffer;

    /* Verify ELF Magic: 0x7F, 'E', 'L', 'F' */
    if (ehdr->e_ident[EI_MAG0] != ELFMAG0 ||
        ehdr->e_ident[EI_MAG1] != ELFMAG1 ||
        ehdr->e_ident[EI_MAG2] != ELFMAG2 ||
        ehdr->e_ident[EI_MAG3] != ELFMAG3) {
        return ZX_ERR_NOT_SUPPORTED;
    }

    /* Verify 64-bit Architecture (ELFCLASS64) */
    if (ehdr->e_ident[EI_CLASS] != ELFCLASS64) {
        return ZX_ERR_NOT_SUPPORTED;
    }

    /* Verify Little-Endian Format (ELFDATA2LSB) */
    if (ehdr->e_ident[EI_DATA] != ELFDATA2LSB) {
        return ZX_ERR_NOT_SUPPORTED;
    }

    /* Verify Version */
    if (ehdr->e_ident[EI_VERSION] != EV_CURRENT) {
        return ZX_ERR_NOT_SUPPORTED;
    }

    /* Verify ARM64 Machine (EM_AARCH64 = 183) */
    if (ehdr->e_machine != EM_AARCH64) {
        return ZX_ERR_NOT_SUPPORTED;
    }

    /* Verify Executable or Dynamic (PIE) */
    if (ehdr->e_type != ET_EXEC && ehdr->e_type != ET_DYN) {
        return ZX_ERR_NOT_SUPPORTED;
    }

    return ZX_OK;
}

zx_status_t elf_parse(const void *buffer, size_t size, elf_info_t *out_info) {
    if (!buffer || !out_info || size < sizeof(Elf64_Ehdr)) {
        return ZX_ERR_INVALID_ARGS;
    }

    zx_status_t status = elf_validate_header(buffer, size);
    if (status != ZX_OK) {
        return status;
    }

    const Elf64_Ehdr *ehdr = (const Elf64_Ehdr *)buffer;

    /* Ensure program header table lies completely within the provided buffer */
    uint64_t ph_table_end = ehdr->e_phoff + ((uint64_t)ehdr->e_phnum * ehdr->e_phentsize);
    if (ph_table_end > size || ehdr->e_phentsize < sizeof(Elf64_Phdr)) {
        return ZX_ERR_OUT_OF_RANGE;
    }

    memset(out_info, 0, sizeof(elf_info_t));
    out_info->entry_point = ehdr->e_entry;
    out_info->min_vaddr = (zx_vaddr_t)-1;
    out_info->max_vaddr = 0;

    const uint8_t *raw = (const uint8_t *)buffer;

    for (uint16_t i = 0; i < ehdr->e_phnum; i++) {
        const Elf64_Phdr *phdr = (const Elf64_Phdr *)(raw + ehdr->e_phoff + (i * ehdr->e_phentsize));

        if (phdr->p_type != PT_LOAD) {
            continue;
        }

        if (out_info->segment_count >= MAX_ELF_LOAD_SEGMENTS) {
            return ZX_ERR_OUT_OF_RANGE;
        }

        /* Sanity checks on segment offsets and sizes */
        if (phdr->p_offset + phdr->p_filesz > size) {
            return ZX_ERR_OUT_OF_RANGE;
        }
        if (phdr->p_filesz > phdr->p_memsz) {
            return ZX_ERR_INVALID_ARGS;
        }

        elf_load_segment_t *seg = &out_info->segments[out_info->segment_count++];
        seg->vaddr = phdr->p_vaddr;
        seg->mem_size = phdr->p_memsz;
        seg->file_size = phdr->p_filesz;
        seg->file_offset = phdr->p_offset;
        seg->flags = phdr->p_flags;

        /* Translate ELF permissions to VMM mapping flags (Always User-Accessible) */
        uint32_t vmm_flags = VMM_FLAG_USER;
        if (phdr->p_flags & PF_R) {
            vmm_flags |= VMM_FLAG_READ;
        }
        if (phdr->p_flags & PF_W) {
            vmm_flags |= VMM_FLAG_WRITE;
        }
        if (phdr->p_flags & PF_X) {
            vmm_flags |= VMM_FLAG_EXECUTE;
        }
        seg->vmm_flags = vmm_flags;

        /* Track overall process virtual memory bounding box */
        if (phdr->p_vaddr < out_info->min_vaddr) {
            out_info->min_vaddr = phdr->p_vaddr;
        }
        zx_vaddr_t seg_end = phdr->p_vaddr + phdr->p_memsz;
        if (seg_end > out_info->max_vaddr) {
            out_info->max_vaddr = seg_end;
        }
    }

    if (out_info->segment_count == 0) {
        return ZX_ERR_NOT_FOUND;
    }

    out_info->total_memory_size = out_info->max_vaddr - out_info->min_vaddr;
    return ZX_OK;
}

zx_status_t elf_load_process(struct process *proc, const void *buffer, size_t size, zx_vaddr_t *out_entry) {
    if (!proc || !buffer || !out_entry) {
        return ZX_ERR_INVALID_ARGS;
    }

    elf_info_t info;
    zx_status_t status = elf_parse(buffer, size, &info);
    if (status != ZX_OK) {
        return status;
    }

    const uint8_t *raw_buf = (const uint8_t *)buffer;

    for (size_t s = 0; s < info.segment_count; s++) {
        const elf_load_segment_t *seg = &info.segments[s];

        zx_vaddr_t vaddr_start = ALIGN_DOWN(seg->vaddr, PAGE_SIZE);
        zx_vaddr_t vaddr_end = ALIGN_UP(seg->vaddr + seg->mem_size, PAGE_SIZE);
        size_t total_pages = (vaddr_end - vaddr_start) / PAGE_SIZE;

        for (size_t p = 0; p < total_pages; p++) {
            zx_vaddr_t current_vpage = vaddr_start + (p * PAGE_SIZE);

            /* Allocate physical frame */
            zx_paddr_t ppage = 0;
            status = pmm_alloc_page(&ppage);
            if (status != ZX_OK) {
                return status;
            }

            /* Initialize physical memory to zero (guarantees .bss zero-fill) */
            uint8_t *dest = (uint8_t *)(uintptr_t)ppage;
            memset(dest, 0, PAGE_SIZE);

            /* Calculate overlap between current 4KB page and segment file data */
            zx_vaddr_t page_vstart = current_vpage;
            zx_vaddr_t page_vend = current_vpage + PAGE_SIZE;

            zx_vaddr_t seg_file_start = seg->vaddr;
            zx_vaddr_t seg_file_end = seg->vaddr + seg->file_size;

            if (page_vstart < seg_file_end && page_vend > seg_file_start) {
                zx_vaddr_t copy_vstart = (page_vstart > seg_file_start) ? page_vstart : seg_file_start;
                zx_vaddr_t copy_vend = (page_vend < seg_file_end) ? page_vend : seg_file_end;
                size_t copy_len = copy_vend - copy_vstart;

                size_t dest_offset = copy_vstart - page_vstart;
                size_t src_offset = seg->file_offset + (copy_vstart - seg_file_start);

                memcpy(dest + dest_offset, raw_buf + src_offset, copy_len);
            }

            /* Map this page in process address space with segment permissions */
            status = vmm_aspace_map(&proc->aspace, current_vpage, ppage, seg->vmm_flags);
            if (status != ZX_OK) {
                pmm_free_page(ppage);
                return status;
            }
        }
    }

    *out_entry = info.entry_point;
    return ZX_OK;
}
