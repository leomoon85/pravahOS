/**
 * @file titan_m2.c
 * @brief PravahOS Titan M2 Hardware Security Enclave Driver Implementation.
 *
 * Implements hardware-backed keystore operations, physical tamper resistance
 * detection and zeroization, and cryptographic forward-hash state sealing.
 */

#include "titan_m2.h"

/* Minimal self-contained SHA-256 implementation for enclave operations */
static const uint32_t K256[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

#define ROR32(val, bits) (((val) >> (bits)) | ((val) << (32 - (bits))))
#define CH(x, y, z)      (((x) & (y)) ^ (~(x) & (z)))
#define MAJ(x, y, z)     (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define EP0(x)           (ROR32(x, 2) ^ ROR32(x, 13) ^ ROR32(x, 22))
#define EP1(x)           (ROR32(x, 6) ^ ROR32(x, 11) ^ ROR32(x, 25))
#define SIG0(x)          (ROR32(x, 7) ^ ROR32(x, 18) ^ ((x) >> 3))
#define SIG1(x)          (ROR32(x, 17) ^ ROR32(x, 19) ^ ((x) >> 10))

static void pravah_sha256(const uint8_t *data, size_t len, uint8_t out[32]) {
    uint32_t h[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    };
    uint64_t total_bits = (uint64_t)len * 8ULL;
    size_t padded_len = ((len + 8) / 64 + 1) * 64;
    uint8_t buf[256];
    size_t i, j;

    /* Process 64-byte blocks */
    size_t offset = 0;
    while (offset < padded_len) {
        uint32_t w[64];
        for (i = 0; i < 64; ++i) {
            size_t curr = offset + i;
            if (curr < len) {
                buf[i] = data[curr];
            } else if (curr == len) {
                buf[i] = 0x80;
            } else if (curr >= padded_len - 8) {
                size_t shift = (padded_len - 1 - curr) * 8;
                buf[i] = (uint8_t)((total_bits >> shift) & 0xFF);
            } else {
                buf[i] = 0x00;
            }
        }

        for (i = 0; i < 16; ++i) {
            w[i] = ((uint32_t)buf[i * 4] << 24) |
                   ((uint32_t)buf[i * 4 + 1] << 16) |
                   ((uint32_t)buf[i * 4 + 2] << 8) |
                   ((uint32_t)buf[i * 4 + 3]);
        }
        for (i = 16; i < 64; ++i) {
            w[i] = SIG1(w[i - 2]) + w[i - 7] + SIG0(w[i - 15]) + w[i - 16];
        }

        uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
        uint32_t e = h[4], f = h[5], g = h[6], h_val = h[7];

        for (j = 0; j < 64; ++j) {
            uint32_t t1 = h_val + EP1(e) + CH(e, f, g) + K256[j] + w[j];
            uint32_t t2 = EP0(a) + MAJ(a, b, c);
            h_val = g;
            g = f;
            f = e;
            e = d + t1;
            d = c;
            c = b;
            b = a;
            a = t1 + t2;
        }

        h[0] += a; h[1] += b; h[2] += c; h[3] += d;
        h[4] += e; h[5] += f; h[6] += g; h[7] += h_val;

        offset += 64;
    }

    for (i = 0; i < 8; ++i) {
        out[i * 4]     = (uint8_t)((h[i] >> 24) & 0xFF);
        out[i * 4 + 1] = (uint8_t)((h[i] >> 16) & 0xFF);
        out[i * 4 + 2] = (uint8_t)((h[i] >> 8) & 0xFF);
        out[i * 4 + 3] = (uint8_t)(h[i] & 0xFF);
    }
}

static void secure_memzero(void *v, size_t n) {
    volatile uint8_t *p = (volatile uint8_t *)v;
    while (n--) {
        *p++ = 0;
    }
}

static int mem_compare(const uint8_t *a, const uint8_t *b, size_t len) {
    uint8_t diff = 0;
    for (size_t i = 0; i < len; ++i) {
        diff |= (a[i] ^ b[i]);
    }
    return diff == 0 ? 0 : -1;
}

static void mem_copy(uint8_t *dst, const uint8_t *src, size_t len) {
    for (size_t i = 0; i < len; ++i) {
        dst[i] = src[i];
    }
}

/* Enclave Initialization */
int titan_m2_init(titan_m2_dev_t *dev, uintptr_t base_paddr, uintptr_t shm_paddr, size_t shm_size) {
    if (!dev) return TITAN_M2_ERR_INVALID_PARAM;

    secure_memzero(dev, sizeof(titan_m2_dev_t));
    dev->base_paddr = base_paddr;
    dev->shm_paddr = shm_paddr;
    dev->shm_size = shm_size;
    dev->policy = TITAN_M2_POLICY_ZEROIZE_AND_HALT;
    dev->active_tamper_flags = TITAN_M2_TAMPER_NONE;
    dev->tamper_alarm_triggered = false;
    dev->zeroized = false;
    dev->emulation_mode = (base_paddr == 0);

    /* Initialize root genesis hash: H_0 = SHA256("PRAVAH_TITAN_M2_GENESIS_V1") */
    const char *genesis_seed = "PRAVAH_TITAN_M2_GENESIS_V1";
    size_t slen = 0;
    while (genesis_seed[slen] != '\0') slen++;
    pravah_sha256((const uint8_t *)genesis_seed, slen, dev->ledger.genesis_hash);
    mem_copy(dev->ledger.current_hash, dev->ledger.genesis_hash, TITAN_M2_HASH_LEN);
    dev->ledger.step_counter = 0;
    dev->ledger.sealed = false;

    /* Initialize Anti-Rollback NVRAM slots to 1 */
    for (int i = 0; i < TITAN_M2_ROLLBACK_SLOTS; ++i) {
        dev->ledger.rollback_versions[i] = 1;
    }

    return TITAN_M2_OK;
}

int titan_m2_shutdown(titan_m2_dev_t *dev) {
    if (!dev) return TITAN_M2_ERR_INVALID_PARAM;
    return titan_m2_zeroize_secrets(dev);
}

bool titan_m2_is_tampered(const titan_m2_dev_t *dev) {
    if (!dev) return true;
    return dev->tamper_alarm_triggered || dev->zeroized;
}

int titan_m2_zeroize_secrets(titan_m2_dev_t *dev) {
    if (!dev) return TITAN_M2_ERR_INVALID_PARAM;

    for (int i = 0; i < TITAN_M2_MAX_KEY_SLOTS; ++i) {
        secure_memzero(dev->slots[i].key_data, TITAN_M2_KEY_SIZE_MAX);
        secure_memzero(dev->slots[i].bound_ledger_hash, TITAN_M2_HASH_LEN);
        dev->slots[i].in_use = false;
        dev->slots[i].key_type = TITAN_M2_KEY_TYPE_NONE;
        dev->slots[i].flags = 0;
        dev->slots[i].usage_counter = 0;
    }

    secure_memzero(dev->ledger.current_hash, TITAN_M2_HASH_LEN);
    dev->zeroized = true;
    return TITAN_M2_OK;
}

/* Hardware Keystore Implementation */
int titan_m2_generate_key(titan_m2_dev_t *dev, uint32_t slot_id, titan_m2_key_type_t type, uint32_t flags) {
    if (!dev || slot_id >= TITAN_M2_MAX_KEY_SLOTS) return TITAN_M2_ERR_INVALID_PARAM;
    if (dev->tamper_alarm_triggered || dev->zeroized) return TITAN_M2_ERR_TAMPER_DETECTED;

    titan_m2_key_slot_t *slot = &dev->slots[slot_id];
    slot->slot_id = slot_id;
    slot->key_type = type;
    slot->flags = flags;
    slot->in_use = true;
    slot->usage_counter = 0;

    /* Pseudo-random deterministic key synthesis seeded by ledger hash and slot */
    uint8_t seed[64];
    mem_copy(seed, dev->ledger.current_hash, 32);
    seed[32] = (uint8_t)(slot_id & 0xFF);
    seed[33] = (uint8_t)(type & 0xFF);
    seed[34] = (uint8_t)(flags & 0xFF);
    seed[35] = (uint8_t)(dev->ledger.step_counter & 0xFF);
    for (int i = 36; i < 64; ++i) seed[i] = (uint8_t)(i ^ 0xA5);

    uint8_t gen_hash[32];
    pravah_sha256(seed, 64, gen_hash);
    mem_copy(slot->key_data, gen_hash, 32);
    slot->key_len = 32;

    /* Bind current forward-hash ledger if requested */
    if (flags & TITAN_M2_KEY_FLAG_FORWARD_SEALED) {
        mem_copy(slot->bound_ledger_hash, dev->ledger.current_hash, TITAN_M2_HASH_LEN);
    } else {
        secure_memzero(slot->bound_ledger_hash, TITAN_M2_HASH_LEN);
    }

    return TITAN_M2_OK;
}

int titan_m2_import_key(titan_m2_dev_t *dev, uint32_t slot_id, titan_m2_key_type_t type, uint32_t flags, const uint8_t *key_data, size_t key_len) {
    if (!dev || slot_id >= TITAN_M2_MAX_KEY_SLOTS || !key_data) return TITAN_M2_ERR_INVALID_PARAM;
    if (key_len == 0 || key_len > TITAN_M2_KEY_SIZE_MAX) return TITAN_M2_ERR_INVALID_PARAM;
    if (dev->tamper_alarm_triggered || dev->zeroized) return TITAN_M2_ERR_TAMPER_DETECTED;

    titan_m2_key_slot_t *slot = &dev->slots[slot_id];
    slot->slot_id = slot_id;
    slot->key_type = type;
    slot->flags = flags;
    slot->in_use = true;
    slot->key_len = key_len;
    slot->usage_counter = 0;
    mem_copy(slot->key_data, key_data, key_len);

    if (flags & TITAN_M2_KEY_FLAG_FORWARD_SEALED) {
        mem_copy(slot->bound_ledger_hash, dev->ledger.current_hash, TITAN_M2_HASH_LEN);
    } else {
        secure_memzero(slot->bound_ledger_hash, TITAN_M2_HASH_LEN);
    }

    return TITAN_M2_OK;
}

int titan_m2_derive_key(titan_m2_dev_t *dev, uint32_t source_slot, const uint8_t *context, size_t ctx_len, uint8_t *out_derived, size_t out_len) {
    if (!dev || source_slot >= TITAN_M2_MAX_KEY_SLOTS || !out_derived || out_len == 0) {
        return TITAN_M2_ERR_INVALID_PARAM;
    }
    if (dev->tamper_alarm_triggered || dev->zeroized) return TITAN_M2_ERR_TAMPER_DETECTED;

    titan_m2_key_slot_t *slot = &dev->slots[source_slot];
    if (!slot->in_use) return TITAN_M2_ERR_KEY_NOT_FOUND;

    /* Check forward-sealed ledger binding */
    if (slot->flags & TITAN_M2_KEY_FLAG_FORWARD_SEALED) {
        if (mem_compare(slot->bound_ledger_hash, dev->ledger.current_hash, TITAN_M2_HASH_LEN) != 0) {
            return TITAN_M2_ERR_LEDGER_MISMATCH;
        }
    }

    uint8_t deriv_buf[128];
    size_t pos = 0;
    mem_copy(deriv_buf + pos, slot->key_data, slot->key_len);
    pos += slot->key_len;

    if (context && ctx_len > 0) {
        size_t c_copy = ctx_len > (sizeof(deriv_buf) - pos - 4) ? (sizeof(deriv_buf) - pos - 4) : ctx_len;
        mem_copy(deriv_buf + pos, context, c_copy);
        pos += c_copy;
    }

    uint8_t d_hash[32];
    pravah_sha256(deriv_buf, pos, d_hash);

    size_t copy_bytes = out_len < 32 ? out_len : 32;
    mem_copy(out_derived, d_hash, copy_bytes);
    slot->usage_counter++;

    return TITAN_M2_OK;
}

int titan_m2_clear_key(titan_m2_dev_t *dev, uint32_t slot_id) {
    if (!dev || slot_id >= TITAN_M2_MAX_KEY_SLOTS) return TITAN_M2_ERR_INVALID_PARAM;
    secure_memzero(&dev->slots[slot_id], sizeof(titan_m2_key_slot_t));
    return TITAN_M2_OK;
}

int titan_m2_attest_device(titan_m2_dev_t *dev, const uint8_t *challenge, size_t challenge_len, uint8_t *out_cert, size_t *cert_len) {
    if (!dev || !out_cert || !cert_len) return TITAN_M2_ERR_INVALID_PARAM;
    if (dev->tamper_alarm_triggered || dev->zeroized) return TITAN_M2_ERR_TAMPER_DETECTED;
    if (*cert_len < 64) return TITAN_M2_ERR_INVALID_PARAM;

    /* Combine RoT key, challenge, and current forward-hash ledger state */
    uint8_t attest_payload[128];
    size_t pos = 0;
    mem_copy(attest_payload + pos, dev->slots[TITAN_M2_SLOT_ROT].key_data, 32);
    pos += 32;
    mem_copy(attest_payload + pos, dev->ledger.current_hash, 32);
    pos += 32;

    if (challenge && challenge_len > 0) {
        size_t ch_len = challenge_len > 32 ? 32 : challenge_len;
        mem_copy(attest_payload + pos, challenge, ch_len);
        pos += ch_len;
    }

    uint8_t sig1[32], sig2[32];
    pravah_sha256(attest_payload, pos, sig1);
    pravah_sha256(sig1, 32, sig2);

    mem_copy(out_cert, sig1, 32);
    mem_copy(out_cert + 32, sig2, 32);
    *cert_len = 64;

    return TITAN_M2_OK;
}

/* Cryptographic Forward-Hash Ledger */
int titan_m2_ledger_init(titan_m2_dev_t *dev, const uint8_t *genesis_measurement, size_t len) {
    if (!dev) return TITAN_M2_ERR_INVALID_PARAM;
    if (dev->tamper_alarm_triggered || dev->zeroized) return TITAN_M2_ERR_TAMPER_DETECTED;

    if (genesis_measurement && len > 0) {
        pravah_sha256(genesis_measurement, len, dev->ledger.genesis_hash);
    } else {
        const char *default_seed = "PRAVAH_ROOT_SECURE_MEASUREMENT";
        size_t dlen = 0;
        while (default_seed[dlen] != '\0') dlen++;
        pravah_sha256((const uint8_t *)default_seed, dlen, dev->ledger.genesis_hash);
    }

    mem_copy(dev->ledger.current_hash, dev->ledger.genesis_hash, TITAN_M2_HASH_LEN);
    dev->ledger.step_counter = 0;
    dev->ledger.sealed = false;

    return TITAN_M2_OK;
}

int titan_m2_ledger_extend(titan_m2_dev_t *dev, const uint8_t *stage_measurement, size_t len) {
    if (!dev || !stage_measurement || len == 0) return TITAN_M2_ERR_INVALID_PARAM;
    if (dev->tamper_alarm_triggered || dev->zeroized) return TITAN_M2_ERR_TAMPER_DETECTED;

    /* Forward-Hash Ratchet: H_{n} = SHA256(H_{n-1} || stage_measurement) */
    uint8_t buffer[128];
    mem_copy(buffer, dev->ledger.current_hash, TITAN_M2_HASH_LEN);
    size_t mlen = len > (sizeof(buffer) - TITAN_M2_HASH_LEN) ? (sizeof(buffer) - TITAN_M2_HASH_LEN) : len;
    mem_copy(buffer + TITAN_M2_HASH_LEN, stage_measurement, mlen);

    uint8_t new_hash[TITAN_M2_HASH_LEN];
    pravah_sha256(buffer, TITAN_M2_HASH_LEN + mlen, new_hash);

    mem_copy(dev->ledger.current_hash, new_hash, TITAN_M2_HASH_LEN);
    dev->ledger.step_counter++;

    return TITAN_M2_OK;
}

int titan_m2_ledger_get_hash(const titan_m2_dev_t *dev, uint8_t *out_hash, uint32_t *out_step) {
    if (!dev || !out_hash) return TITAN_M2_ERR_INVALID_PARAM;
    mem_copy(out_hash, dev->ledger.current_hash, TITAN_M2_HASH_LEN);
    if (out_step) *out_step = dev->ledger.step_counter;
    return TITAN_M2_OK;
}

int titan_m2_ledger_seal(titan_m2_dev_t *dev, const uint8_t *plaintext, size_t in_len, titan_m2_sealed_blob_t *out_blob) {
    if (!dev || !plaintext || !out_blob || in_len == 0 || in_len > TITAN_M2_SEAL_PAYLOAD_MAX) {
        return TITAN_M2_ERR_INVALID_PARAM;
    }
    if (dev->tamper_alarm_triggered || dev->zeroized) return TITAN_M2_ERR_TAMPER_DETECTED;

    out_blob->magic[0] = 'S';
    out_blob->magic[1] = 'E';
    out_blob->magic[2] = 'A';
    out_blob->magic[3] = 'L';
    out_blob->payload_len = (uint32_t)in_len;

    /* Bind sealed blob strictly to current ledger hash */
    mem_copy(out_blob->expected_hash, dev->ledger.current_hash, TITAN_M2_HASH_LEN);

    /* Derive keystream from ledger hash */
    for (size_t i = 0; i < 16; ++i) {
        out_blob->iv[i] = (uint8_t)(dev->ledger.current_hash[i] ^ 0x3C);
    }

    uint8_t keystream[TITAN_M2_HASH_LEN];
    pravah_sha256(out_blob->expected_hash, TITAN_M2_HASH_LEN, keystream);

    for (size_t i = 0; i < in_len; ++i) {
        out_blob->ciphertext[i] = plaintext[i] ^ keystream[i % TITAN_M2_HASH_LEN] ^ out_blob->iv[i % 16];
    }

    /* Compute authentication tag over expected_hash + ciphertext */
    uint8_t auth_input[TITAN_M2_HASH_LEN + 32];
    mem_copy(auth_input, out_blob->expected_hash, TITAN_M2_HASH_LEN);
    pravah_sha256(out_blob->ciphertext, in_len, auth_input + TITAN_M2_HASH_LEN);

    uint8_t tag_hash[TITAN_M2_HASH_LEN];
    pravah_sha256(auth_input, sizeof(auth_input), tag_hash);
    mem_copy(out_blob->tag, tag_hash, 16);

    return TITAN_M2_OK;
}

int titan_m2_ledger_unseal(titan_m2_dev_t *dev, const titan_m2_sealed_blob_t *blob, uint8_t *out_plaintext, size_t *out_len) {
    if (!dev || !blob || !out_plaintext || !out_len) return TITAN_M2_ERR_INVALID_PARAM;
    if (dev->tamper_alarm_triggered || dev->zeroized) return TITAN_M2_ERR_TAMPER_DETECTED;

    if (blob->magic[0] != 'S' || blob->magic[1] != 'E' ||
        blob->magic[2] != 'A' || blob->magic[3] != 'L') {
        return TITAN_M2_ERR_INVALID_PARAM;
    }

    if (blob->payload_len > TITAN_M2_SEAL_PAYLOAD_MAX || *out_len < blob->payload_len) {
        return TITAN_M2_ERR_INVALID_PARAM;
    }

    /* Check forward-hash ledger measurement: MUST match current state */
    if (mem_compare(blob->expected_hash, dev->ledger.current_hash, TITAN_M2_HASH_LEN) != 0) {
        return TITAN_M2_ERR_LEDGER_MISMATCH;
    }

    /* Validate authentication tag */
    uint8_t auth_input[TITAN_M2_HASH_LEN + 32];
    mem_copy(auth_input, blob->expected_hash, TITAN_M2_HASH_LEN);
    pravah_sha256(blob->ciphertext, blob->payload_len, auth_input + TITAN_M2_HASH_LEN);

    uint8_t tag_hash[TITAN_M2_HASH_LEN];
    pravah_sha256(auth_input, sizeof(auth_input), tag_hash);
    if (mem_compare(blob->tag, tag_hash, 16) != 0) {
        return TITAN_M2_ERR_AUTH_FAILED;
    }

    /* Decrypt payload */
    uint8_t keystream[TITAN_M2_HASH_LEN];
    pravah_sha256(blob->expected_hash, TITAN_M2_HASH_LEN, keystream);

    for (size_t i = 0; i < blob->payload_len; ++i) {
        out_plaintext[i] = blob->ciphertext[i] ^ keystream[i % TITAN_M2_HASH_LEN] ^ blob->iv[i % 16];
    }
    *out_len = blob->payload_len;

    return TITAN_M2_OK;
}

/* Monotonic Anti-Rollback Counters */
int titan_m2_rollback_get(const titan_m2_dev_t *dev, uint32_t index, uint32_t *out_version) {
    if (!dev || index >= TITAN_M2_ROLLBACK_SLOTS || !out_version) return TITAN_M2_ERR_INVALID_PARAM;
    *out_version = dev->ledger.rollback_versions[index];
    return TITAN_M2_OK;
}

int titan_m2_rollback_commit(titan_m2_dev_t *dev, uint32_t index, uint32_t new_version) {
    if (!dev || index >= TITAN_M2_ROLLBACK_SLOTS) return TITAN_M2_ERR_INVALID_PARAM;
    if (dev->tamper_alarm_triggered || dev->zeroized) return TITAN_M2_ERR_TAMPER_DETECTED;

    /* Strictly enforce forward-only monotonic increments */
    if (new_version < dev->ledger.rollback_versions[index]) {
        return TITAN_M2_ERR_ROLLBACK_BLOCKED;
    }

    dev->ledger.rollback_versions[index] = new_version;
    return TITAN_M2_OK;
}

/* Physical Tamper Interrupt Handler */
void titan_m2_handle_tamper_irq(titan_m2_dev_t *dev, uint32_t tamper_mask) {
    if (!dev) return;

    dev->active_tamper_flags |= tamper_mask;
    dev->tamper_alarm_triggered = true;

    if (dev->policy == TITAN_M2_POLICY_ZEROIZE_AND_HALT) {
        titan_m2_zeroize_secrets(dev);
    }
}
