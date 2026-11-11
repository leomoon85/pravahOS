/**
 * @file types.h
 * @brief PravahOS Kernel Primitive Types & Zircon ABI compatibility.
 */

#ifndef PRAVAH_KERNEL_TYPES_H
#define PRAVAH_KERNEL_TYPES_H

/* Fixed-width integer types for bare-metal AArch64 */
typedef unsigned char      uint8_t;
typedef unsigned short     uint16_t;
typedef unsigned int       uint32_t;
typedef unsigned long long uint64_t;

typedef signed char        int8_t;
typedef signed short       int16_t;
typedef signed int         int32_t;
typedef signed long long   int64_t;

typedef unsigned long long size_t;
typedef signed long long   ssize_t;

typedef unsigned long long uintptr_t;
typedef signed long long   intptr_t;

#ifndef bool
typedef _Bool bool;
#define true 1
#define false 0
#endif

#ifndef NULL
#define NULL ((void *)0)
#endif

/* Zircon Microkernel compatible ABI types */
typedef int32_t   zx_status_t;
typedef uint32_t  zx_handle_t;
typedef uint32_t  zx_rights_t;
typedef uintptr_t zx_vaddr_t;
typedef uintptr_t zx_paddr_t;
typedef uint64_t  zx_time_t;
typedef uint64_t  zx_duration_t;
typedef uint32_t  zx_obj_type_t;

/* Standard Zircon Status Codes */
#define ZX_OK                   (0)
#define ZX_ERR_INTERNAL         (-1)
#define ZX_ERR_NOT_SUPPORTED    (-2)
#define ZX_ERR_NO_RESOURCES     (-3)
#define ZX_ERR_NO_MEMORY        (-4)
#define ZX_ERR_CALL_FAILED      (-5)
#define ZX_ERR_INVALID_ARGS     (-10)
#define ZX_ERR_BAD_HANDLE       (-11)
#define ZX_ERR_WRONG_TYPE       (-12)
#define ZX_ERR_BAD_SYSCALL      (-13)
#define ZX_ERR_OUT_OF_RANGE     (-14)
#define ZX_ERR_BUFFER_TOO_SMALL (-15)
#define ZX_ERR_ALREADY_EXISTS   (-16)
#define ZX_ERR_ALREADY_BOUND    (-17)
#define ZX_ERR_UNAVAILABLE      (-18)
#define ZX_ERR_ACCESS_DENIED    (-30)
#define ZX_ERR_IO               (-40)
#define ZX_ERR_IO_REFUSED       (-41)
#define ZX_ERR_TIMED_OUT        (-50)
#define ZX_ERR_SHOULD_WAIT      (-60)
#define ZX_ERR_CANCELED         (-61)
#define ZX_ERR_PEER_CLOSED      (-62)
#define ZX_ERR_NOT_FOUND        (-63)

/* Utility Macros */
#define ARRAY_SIZE(arr) (sizeof(arr) / sizeof((arr)[0]))
#define ALIGN_UP(val, align) (((val) + (align) - 1) & ~((align) - 1))
#define ALIGN_DOWN(val, align) ((val) & ~((align) - 1))

#endif /* PRAVAH_KERNEL_TYPES_H */
