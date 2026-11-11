/**
 * @file titan_m2.h
 * @brief PravahOS Titan M2 Hardware Security Enclave Driver Interface.
 *
 * Dedicated security processor driver for Google Tensor G2/G3/G4 (GS201 / Zuma / Zuma Pro)
 * platforms, implementing hardware-backed keystore, physical tamper resistance, and
 * cryptographic forward-hash sealing.
 */

#ifndef PRAVAH_TITAN_M2_H
#define PRAVAH_TITAN_M2_H

#include <kernel/types.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Titan M2 Hardware Register Offsets */
#define TITAN_M2_REG_MAGIC          0x00
#define TITAN_M2_REG_STATUS         0x04
#define TITAN_M2_REG_CONTROL        0x08
#define TITAN_M2_REG_CMD_FIFO       0x0C
#define TITAN_M2_REG_RESP_FIFO      0x10
#define TITAN_M2_REG_TAMPER_STATUS  0x14
#define TITAN_M2_REG_TAMPER_MASK    0x18
#define TITAN_M2_REG_LEDGER_CTRL    0x1C
#define TITAN_M2_REG_SHM_BASE_LO    0x20
#define TITAN_M2_REG_SHM_BASE_HI    0x24
#define TITAN_M2_REG_SHM_SIZE       0x28

/* Magic identification value */
#define TITAN_M2_HARDWARE_MAGIC     0x544D3230 /* 'TM20' */

/* Maximum limits */
#define TITAN_M2_MAX_KEY_SLOTS      16
#define TITAN_M2_HASH_LEN           32 /* SHA-256 */
#define TITAN_M2_KEY_SIZE_MAX       64
#define TITAN_M2_SEAL_PAYLOAD_MAX   512
#define TITAN_M2_ROLLBACK_SLOTS     8

/* Reserved Well-Known Keystore Slots */
#define TITAN_M2_SLOT_ROT           0 /* Hardware Root of Trust Key */
#define TITAN_M2_SLOT_DEVICE_ID     1 /* Unique Per-Device Identity Key */
#define TITAN_M2_SLOT_KERNEL_INTEG  2 /* Kernel Image Integrity Sealing Key */
#define TITAN_M2_SLOT_DISK_DEK      3 /* Disk Encryption Key (DEK) */
#define TITAN_M2_SLOT_AVB_ROT       4 /* AVB 2.0 Custom Root of Trust Key */
#define TITAN_M2_SLOT_DYNAMIC_START 5 /* Dynamic user/application slots */

/* Titan M2 Return Codes */
#define TITAN_M2_OK                     0
#define TITAN_M2_ERR_NOT_INITIALIZED   -1
#define TITAN_M2_ERR_BUSY              -2
#define TITAN_M2_ERR_INVALID_PARAM     -3
#define TITAN_M2_ERR_KEY_SLOT_FULL     -4
#define TITAN_M2_ERR_KEY_NOT_FOUND     -5
#define TITAN_M2_ERR_TAMPER_DETECTED   -6
#define TITAN_M2_ERR_LEDGER_MISMATCH   -7
#define TITAN_M2_ERR_AUTH_FAILED       -8
#define TITAN_M2_ERR_ROLLBACK_BLOCKED  -9
#define TITAN_M2_ERR_COMM_TIMEOUT      -10
#define TITAN_M2_ERR_ZEROIZED          -11

/* Key Cryptographic Types */
typedef enum {
    TITAN_M2_KEY_TYPE_NONE        = 0,
    TITAN_M2_KEY_TYPE_AES_256_GCM = 1,
    TITAN_M2_KEY_TYPE_HMAC_SHA256 = 2,
    TITAN_M2_KEY_TYPE_ED25519     = 3,
    TITAN_M2_KEY_TYPE_P256        = 4,
} titan_m2_key_type_t;

/* Key Attributes & Flags */
#define TITAN_M2_KEY_FLAG_EXPORTABLE     (1 << 0)
#define TITAN_M2_KEY_FLAG_TAMPER_PURGE   (1 << 1) /* Zeroize immediately on tamper event */
#define TITAN_M2_KEY_FLAG_FORWARD_SEALED (1 << 2) /* Accessible only when ledger state matches */
#define TITAN_M2_KEY_FLAG_HARDWARE_ONLY  (1 << 3) /* Stored strictly in non-volatile enclave */

/* Physical Tamper Resistance Flags */
#define TITAN_M2_TAMPER_NONE             0x00
#define TITAN_M2_TAMPER_VOLTAGE_GLITCH   (1 << 0) /* Under/over-voltage glitch attack */
#define TITAN_M2_TAMPER_ACTIVE_SHIELD    (1 << 1) /* Silicon mesh active wire severance */
#define TITAN_M2_TAMPER_OPTICAL_FAULT    (1 << 2) /* Laser/light pulse fault injection */
#define TITAN_M2_TAMPER_TEMP_EXTREME     (1 << 3) /* Cryogenic or extreme thermal excursion */
#define TITAN_M2_TAMPER_CLOCK_GLITCH     (1 << 4) /* External clock oscillation fault */
#define TITAN_M2_TAMPER_PROBE_DETECT     (1 << 5) /* Physical micro-probing capacitance drop */
#define TITAN_M2_TAMPER_DEBUG_UNLOCK     (1 << 6) /* Unauthorized JTAG/SWD debug probe attach */

/* Tamper Mitigation Policy */
typedef enum {
    TITAN_M2_POLICY_LOG_ONLY         = 0,
    TITAN_M2_POLICY_HALT_IO          = 1,
    TITAN_M2_POLICY_ZEROIZE_AND_HALT = 2,
} titan_m2_tamper_policy_t;

/* Key Slot Descriptor */
typedef struct {
    uint32_t slot_id;
    titan_m2_key_type_t key_type;
    uint32_t flags;
    bool in_use;
    uint8_t key_data[TITAN_M2_KEY_SIZE_MAX];
    size_t key_len;
    uint8_t bound_ledger_hash[TITAN_M2_HASH_LEN];
    uint32_t usage_counter;
} titan_m2_key_slot_t;

/* Cryptographic Forward-Hash Ledger */
typedef struct {
    uint8_t current_hash[TITAN_M2_HASH_LEN];
    uint32_t step_counter;
    uint8_t genesis_hash[TITAN_M2_HASH_LEN];
    uint32_t rollback_versions[TITAN_M2_ROLLBACK_SLOTS];
    bool sealed;
} titan_m2_ledger_t;

/* Sealed Payload Container */
typedef struct {
    uint8_t magic[4]; /* 'SEAL' */
    uint32_t payload_len;
    uint8_t expected_hash[TITAN_M2_HASH_LEN];
    uint8_t iv[16];
    uint8_t tag[16];
    uint8_t ciphertext[TITAN_M2_SEAL_PAYLOAD_MAX];
} titan_m2_sealed_blob_t;

/* Device Driver Context */
typedef struct {
    uintptr_t base_paddr;
    uintptr_t shm_paddr;
    size_t shm_size;
    uint32_t irq_resp;
    uint32_t irq_tamper;
    titan_m2_tamper_policy_t policy;
    uint32_t active_tamper_flags;
    bool tamper_alarm_triggered;
    bool zeroized;
    bool emulation_mode;
    titan_m2_ledger_t ledger;
    titan_m2_key_slot_t slots[TITAN_M2_MAX_KEY_SLOTS];
} titan_m2_dev_t;

/* Core Enclave Lifecycle */
int titan_m2_init(titan_m2_dev_t *dev, uintptr_t base_paddr, uintptr_t shm_paddr, size_t shm_size);
int titan_m2_shutdown(titan_m2_dev_t *dev);
bool titan_m2_is_tampered(const titan_m2_dev_t *dev);
int titan_m2_zeroize_secrets(titan_m2_dev_t *dev);

/* Hardware-backed Keystore */
int titan_m2_generate_key(titan_m2_dev_t *dev, uint32_t slot_id, titan_m2_key_type_t type, uint32_t flags);
int titan_m2_import_key(titan_m2_dev_t *dev, uint32_t slot_id, titan_m2_key_type_t type, uint32_t flags, const uint8_t *key_data, size_t key_len);
int titan_m2_derive_key(titan_m2_dev_t *dev, uint32_t source_slot, const uint8_t *context, size_t ctx_len, uint8_t *out_derived, size_t out_len);
int titan_m2_clear_key(titan_m2_dev_t *dev, uint32_t slot_id);
int titan_m2_attest_device(titan_m2_dev_t *dev, const uint8_t *challenge, size_t challenge_len, uint8_t *out_cert, size_t *cert_len);

/* Cryptographic Forward-Hash Ledger */
int titan_m2_ledger_init(titan_m2_dev_t *dev, const uint8_t *genesis_measurement, size_t len);
int titan_m2_ledger_extend(titan_m2_dev_t *dev, const uint8_t *stage_measurement, size_t len);
int titan_m2_ledger_get_hash(const titan_m2_dev_t *dev, uint8_t *out_hash, uint32_t *out_step);
int titan_m2_ledger_seal(titan_m2_dev_t *dev, const uint8_t *plaintext, size_t in_len, titan_m2_sealed_blob_t *out_blob);
int titan_m2_ledger_unseal(titan_m2_dev_t *dev, const titan_m2_sealed_blob_t *blob, uint8_t *out_plaintext, size_t *out_len);

/* Anti-Rollback Monotonic Counters */
int titan_m2_rollback_get(const titan_m2_dev_t *dev, uint32_t index, uint32_t *out_version);
int titan_m2_rollback_commit(titan_m2_dev_t *dev, uint32_t index, uint32_t new_version);

/* Physical Tamper Interrupt Handler */
void titan_m2_handle_tamper_irq(titan_m2_dev_t *dev, uint32_t tamper_mask);

#ifdef __cplusplus
}
#endif

#endif /* PRAVAH_TITAN_M2_H */
