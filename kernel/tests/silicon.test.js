// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file silicon.test.js
 * Automated test suite for PravahOS Physical Silicon Bringup Bundle,
 * Device Tree compiler, Bootloader packaging, and Titan M2 security enclave.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  FDT_MAGIC,
  FDT_VERSION,
  compileDtsToDtb,
  parseDtsToAst,
  parseDtb,
  validateDtb
} from '../../tools/flashing/build_dtb.js';

import {
  BOOT_MAGIC,
  VENDOR_BOOT_MAGIC,
  AVB_MAGIC,
  PAGE_SIZE,
  createBootImageV4,
  createVendorBootImageV4,
  generateAvbMetadata,
  generateEdlFirehoseXml
} from '../../tools/flashing/mkbootimg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('PravahOS Physical Silicon Hardware Bringup Test Suite', () => {

  // ==========================================================================
  // 1. Device Tree Source Specification Verification
  // ==========================================================================
  describe('Device Tree Sources (DTS)', () => {
    const qcomDtsPath = path.join(PROJECT_ROOT, 'kernel/arch/arm64/qcom/qcom_sm8550.dts');
    const tensorDtsPath = path.join(PROJECT_ROOT, 'kernel/arch/arm64/google/google_tensor_g3.dts');

    it('defines valid Qualcomm Snapdragon 8 Gen 2/3 (SM8550) dev board tree', () => {
      assert.ok(fs.existsSync(qcomDtsPath), 'qcom_sm8550.dts must exist');
      const content = fs.readFileSync(qcomDtsPath, 'utf8');

      // Compatible & Model
      assert.match(content, /compatible\s*=\s*"qcom,sm8550-hdk"/);
      assert.match(content, /model\s*=\s*"Qualcomm Technologies/);

      // Tri-cluster Kryo architecture: 8 cores (1 Prime + 4 Gold + 3 Silver)
      assert.match(content, /cpu0:\s*cpu@0\s*\{\s*device_type\s*=\s*"cpu";\s*compatible\s*=\s*"arm,cortex-a510"/);
      assert.match(content, /cpu3:\s*cpu@300\s*\{\s*device_type\s*=\s*"cpu";\s*compatible\s*=\s*"arm,cortex-a715"/);
      assert.match(content, /cpu5:\s*cpu@500\s*\{\s*device_type\s*=\s*"cpu";\s*compatible\s*=\s*"arm,cortex-a710"/);
      assert.match(content, /cpu7:\s*cpu@700\s*\{\s*device_type\s*=\s*"cpu";\s*compatible\s*=\s*"arm,cortex-x3"/);

      // Subsystems: Adreno 740, Hexagon NPU, GENI UART, SPMI PMIC, UFS 4.0
      assert.match(content, /compatible\s*=\s*"qcom,adreno-740\.0"/, 'Adreno 740 GPU required');
      assert.match(content, /compatible\s*=\s*"qcom,sm8550-cdsp"/, 'Hexagon CDSP/NPU required');
      assert.match(content, /compatible\s*=\s*"qcom,geni-uart"/, 'Qualcomm GENI UART required');
      assert.match(content, /compatible\s*=\s*"qcom,spmi-pmic-arb"/, 'Qualcomm SPMI PMIC required');
      assert.match(content, /compatible\s*=\s*"qcom,sm8550-ufshc"/, 'Qualcomm UFS 4.0 host controller required');
      assert.match(content, /console=ttyMSM0,115200/, 'Bootargs must specify GENI UART console');
    });

    it('defines valid Google Tensor G3/G4 (GS201/Zuma) Pixel board tree', () => {
      assert.ok(fs.existsSync(tensorDtsPath), 'google_tensor_g3.dts must exist');
      const content = fs.readFileSync(tensorDtsPath, 'utf8');

      // Compatible & Model
      assert.match(content, /compatible\s*=\s*"google,tensor-g3"/);
      assert.match(content, /model\s*=\s*"Google Tensor G3/);

      // Big-Mid-Little cluster: 9 cores (1 Prime + 4 Mid + 4 Little)
      assert.match(content, /cpu0:\s*cpu@0\s*\{\s*device_type\s*=\s*"cpu";\s*compatible\s*=\s*"arm,cortex-a510"/);
      assert.match(content, /cpu4:\s*cpu@400\s*\{\s*device_type\s*=\s*"cpu";\s*compatible\s*=\s*"arm,cortex-a715"/);
      assert.match(content, /cpu8:\s*cpu@800\s*\{\s*device_type\s*=\s*"cpu";\s*compatible\s*=\s*"arm,cortex-x3"/);

      // Subsystems: Mali-G715 Immortalis, EdgeTPU, Titan M2 security chip, Exynos USI UART, UFS
      assert.match(content, /compatible\s*=\s*"arm,mali-valhall-csf"/, 'Mali-G715 GPU required');
      assert.match(content, /compatible\s*=\s*"google,edgetpu-zuma"/, 'Google EdgeTPU required');
      assert.match(content, /compatible\s*=\s*"google,titan-m2-spi"/, 'Titan M2 Discrete Enclave required');
      assert.match(content, /compatible\s*=\s*"google,usi-uart"/, 'Exynos USI UART required');
      assert.match(content, /compatible\s*=\s*"samsung,exynos-ufs"/, 'Tensor UFS controller required');
      assert.match(content, /pravah\.titan_m2=1/, 'Bootargs must enable Titan M2 enclave');
    });
  });

  // ==========================================================================
  // 2. Hermetic Device Tree Binary (.dtb) Compiler & Validator
  // ==========================================================================
  describe('Hermetic DTB Compiler (FDT v17)', () => {
    it('compiles Qualcomm Snapdragon DTS into valid FDT v17 binary', () => {
      const qcomDts = fs.readFileSync(path.join(PROJECT_ROOT, 'kernel/arch/arm64/qcom/qcom_sm8550.dts'), 'utf8');
      const dtbBuffer = compileDtsToDtb(qcomDts);

      assert.ok(dtbBuffer instanceof Buffer);
      assert.ok(dtbBuffer.length > 1024, 'DTB must be reasonably sized');

      // Verify header fields
      const magic = dtbBuffer.readUInt32BE(0);
      assert.equal(magic, FDT_MAGIC, 'DTB magic must be 0xd00dfeed');

      const version = dtbBuffer.readUInt32BE(20);
      assert.equal(version, FDT_VERSION, 'FDT version must be 17');

      // Parse and validate DTB structure
      const parsed = parseDtb(dtbBuffer);
      assert.ok(parsed.root);
      assert.ok(parsed.header.totalsize === dtbBuffer.length);
      assert.ok(parsed.memreserves.length >= 1, 'Memreserves must be present');

      // Verify parsed root children
      const childNames = parsed.root.children.map(c => c.name);
      assert.ok(childNames.includes('cpus'), 'cpus node must be present in DTB');
      assert.ok(childNames.includes('soc@0'), 'soc node must be present in DTB');
      assert.ok(childNames.includes('chosen'), 'chosen node must be present in DTB');
      assert.ok(childNames.includes('reserved-memory'), 'reserved-memory node must be present in DTB');

      const validation = validateDtb(dtbBuffer);
      assert.equal(validation.valid, true);
    });

    it('compiles Google Tensor G3 DTS into valid FDT v17 binary', () => {
      const tensorDts = fs.readFileSync(path.join(PROJECT_ROOT, 'kernel/arch/arm64/google/google_tensor_g3.dts'), 'utf8');
      const dtbBuffer = compileDtsToDtb(tensorDts);

      assert.ok(dtbBuffer instanceof Buffer);
      const parsed = parseDtb(dtbBuffer);

      assert.equal(parsed.header.magic, FDT_MAGIC);
      assert.equal(parsed.header.version, 17);

      // Search for Titan M2 node inside soc@0 -> spi@10930000 -> titan-m2@0
      const socNode = parsed.root.children.find(c => c.name === 'soc@0');
      assert.ok(socNode, 'soc@0 must exist');

      const spiNode = socNode.children.find(c => c.name.startsWith('spi'));
      assert.ok(spiNode, 'spi controller must exist');

      const titanNode = spiNode.children.find(c => c.name.startsWith('titan-m2'));
      assert.ok(titanNode, 'titan-m2 node must exist under SPI bus');
      assert.ok(titanNode.properties.compatible.includes('google,titan-m2'));
    });
  });

  // ==========================================================================
  // 3. Titan M2 Hardware Security Enclave C Bindings & Simulation
  // ==========================================================================
  describe('Titan M2 Hardware Security Enclave', () => {
    const headerPath = path.join(PROJECT_ROOT, 'kernel/arch/arm64/google/titan_m2.h');
    const sourcePath = path.join(PROJECT_ROOT, 'kernel/arch/arm64/google/titan_m2.c');

    it('exposes compliant Titan M2 driver C header and implementation', () => {
      assert.ok(fs.existsSync(headerPath), 'titan_m2.h must exist');
      assert.ok(fs.existsSync(sourcePath), 'titan_m2.c must exist');

      const header = fs.readFileSync(headerPath, 'utf8');
      assert.match(header, /TITAN_M2_HARDWARE_MAGIC\s+0x544D3230/);
      assert.match(header, /TITAN_M2_MAX_KEY_SLOTS\s+16/);
      assert.match(header, /titan_m2_init/);
      assert.match(header, /titan_m2_ledger_seal/);
      assert.match(header, /titan_m2_ledger_unseal/);
      assert.match(header, /titan_m2_handle_tamper_irq/);
      assert.match(header, /titan_m2_zeroize_secrets/);

      const source = fs.readFileSync(sourcePath, 'utf8');
      assert.match(source, /pravah_sha256/);
      assert.match(source, /TITAN_M2_POLICY_ZEROIZE_AND_HALT/);
    });

    it('simulates hardware keystore key derivation & slot isolation', () => {
      // Mock enclave state
      const slots = new Map();
      let ledgerHash = crypto.createHash('sha256').update('PRAVAH_TITAN_M2_GENESIS_V1').digest();

      function generateKey(slotId, type, flags) {
        assert.ok(slotId >= 0 && slotId < 16, 'Slot ID must be within 0..15');
        const seed = Buffer.concat([ledgerHash, Buffer.from([slotId, type, flags])]);
        const keyData = crypto.createHash('sha256').update(seed).digest();
        slots.set(slotId, { slotId, type, flags, keyData, boundHash: Buffer.from(ledgerHash) });
        return keyData;
      }

      function deriveKey(slotId, context) {
        const slot = slots.get(slotId);
        assert.ok(slot, 'Slot must exist');
        return crypto.createHash('sha256').update(Buffer.concat([slot.keyData, Buffer.from(context)])).digest();
      }

      // Root of trust slot 0
      const rotKey = generateKey(0, 1, 0x08); // AES-256-GCM, HARDWARE_ONLY
      assert.equal(rotKey.length, 32);

      // Derived app keys are deterministic for same context
      const derived1 = deriveKey(0, 'pravah.subsystem.storage');
      const derived2 = deriveKey(0, 'pravah.subsystem.storage');
      assert.deepEqual(derived1, derived2);

      // Different context yields different key
      const derived3 = deriveKey(0, 'pravah.subsystem.telephony');
      assert.notDeepEqual(derived1, derived3);
    });

    it('simulates cryptographic forward-hash ledger ratchet and sealing', () => {
      let currentHash = crypto.createHash('sha256').update('GENESIS_ROT_V1').digest();

      function extendLedger(measurement) {
        currentHash = crypto.createHash('sha256').update(Buffer.concat([currentHash, Buffer.from(measurement)])).digest();
        return currentHash;
      }

      function sealData(plaintext) {
        const boundHash = Buffer.from(currentHash);
        const keystream = crypto.createHash('sha256').update(boundHash).digest();
        const ciphertext = Buffer.alloc(plaintext.length);
        for (let i = 0; i < plaintext.length; i++) {
          ciphertext[i] = plaintext[i] ^ keystream[i % 32];
        }
        return { boundHash, ciphertext };
      }

      function unsealData(sealed) {
        if (!sealed.boundHash.equals(currentHash)) {
          throw new Error('TITAN_M2_ERR_LEDGER_MISMATCH');
        }
        const keystream = crypto.createHash('sha256').update(sealed.boundHash).digest();
        const plaintext = Buffer.alloc(sealed.ciphertext.length);
        for (let i = 0; i < sealed.ciphertext.length; i++) {
          plaintext[i] = sealed.ciphertext[i] ^ keystream[i % 32];
        }
        return plaintext;
      }

      // Boot stage 1: Microkernel Core
      extendLedger('MICROKERNEL_CORE_STAGE1');
      const secret = Buffer.from('SUPER_SECRET_DISK_ENCRYPTION_MASTER_KEY_2026');
      const sealed = sealData(secret);

      // Unsealing at same state succeeds
      const unsealed = unsealData(sealed);
      assert.deepEqual(unsealed, secret);

      // Ratchet forward to Stage 2: Userspace Compositor
      extendLedger('USERSPACE_COMPOSITOR_STAGE2');

      // Attempting to unseal at Stage 2 fails with mismatch
      assert.throws(() => {
        unsealData(sealed);
      }, /TITAN_M2_ERR_LEDGER_MISMATCH/);
    });

    it('triggers physical tamper alarm and executes cryptographic zeroization', () => {
      const enclave = {
        slots: new Map([[0, Buffer.alloc(32, 0xEE)], [1, Buffer.alloc(32, 0xFF)]]),
        ledgerHash: Buffer.alloc(32, 0xAA),
        tamperFlags: 0,
        tampered: false,
        zeroized: false
      };

      function handleTamperIrq(tamperMask) {
        enclave.tamperFlags |= tamperMask;
        enclave.tampered = true;
        // Immediate zeroization policy
        for (const [k] of enclave.slots) {
          enclave.slots.delete(k);
        }
        enclave.ledgerHash.fill(0);
        enclave.zeroized = true;
      }

      assert.equal(enclave.slots.size, 2);
      assert.equal(enclave.zeroized, false);

      // Trigger active shield wire cut tamper flag (1 << 1)
      handleTamperIrq(0x02);

      assert.equal(enclave.tampered, true);
      assert.equal(enclave.zeroized, true);
      assert.equal(enclave.slots.size, 0, 'All secrets must be wiped');
      assert.ok(enclave.ledgerHash.every(b => b === 0), 'Ledger hash must be zeroed');
    });
  });

  // ==========================================================================
  // 4. Android Boot Image v4 & AVB 2.0 Packaging
  // ==========================================================================
  describe('Android Boot Image v4 & AVB 2.0 Generator', () => {
    it('generates compliant Boot Image v4 binary', () => {
      const mockKernel = Buffer.alloc(1024, 0x90);
      const mockRamdisk = Buffer.alloc(512, 0x42);
      const bootImg = createBootImageV4({
        kernelBuffer: mockKernel,
        ramdiskBuffer: mockRamdisk,
        cmdline: 'console=ttyMSM0,115200 root=/dev/pravah_root'
      });

      // Verification
      assert.ok(bootImg.length % PAGE_SIZE === 0, 'Boot image must be page aligned (4096)');
      assert.equal(bootImg.toString('ascii', 0, 8), BOOT_MAGIC);

      const kernelSize = bootImg.readUInt32LE(8);
      const ramdiskSize = bootImg.readUInt32LE(12);
      const headerVersion = bootImg.readUInt32LE(40);
      const expectedCmdline = 'console=ttyMSM0,115200 root=/dev/pravah_root';
      const cmdline = bootImg.toString('utf8', 44, 44 + expectedCmdline.length);

      assert.equal(kernelSize, 1024);
      assert.equal(ramdiskSize, 512);
      assert.equal(headerVersion, 4);
      assert.equal(cmdline, expectedCmdline);
    });

    it('generates compliant Vendor Boot Image v4 with DTB', () => {
      const mockDtb = Buffer.alloc(2048, 0x55);
      const vendorBootImg = createVendorBootImageV4({
        dtbBuffer: mockDtb,
        boardName: 'PRAVAH_SM8550'
      });

      assert.ok(vendorBootImg.length % PAGE_SIZE === 0);
      assert.equal(vendorBootImg.toString('ascii', 0, 8), VENDOR_BOOT_MAGIC);

      const headerVer = vendorBootImg.readUInt32LE(8);
      const dtbSize = vendorBootImg.readUInt32LE(2100);

      assert.equal(headerVer, 4);
      assert.equal(dtbSize, 2048);
    });

    it('generates AVB 2.0 VBMeta and Custom Root-of-Trust enrollment key', () => {
      const mockBootImg = Buffer.alloc(4096, 0x77);
      const avb = generateAvbMetadata({
        bootImageBuffer: mockBootImg,
        rollbackIndex: 2
      });

      assert.ok(avb.vbmetaBuffer.length === PAGE_SIZE);
      assert.equal(avb.vbmetaBuffer.toString('ascii', 0, 4), AVB_MAGIC);
      assert.equal(avb.rollbackIndex, 2);
      assert.ok(avb.bootDigestHex.length === 64, 'SHA-256 digest must be 64 hex characters');
      assert.ok(avb.customKeyBuffer.length >= 32, 'AVB custom key must be present');
    });

    it('generates Qualcomm EDL Firehose XML partition map', () => {
      const xml = generateEdlFirehoseXml({});
      assert.match(xml, /<program SECTOR_SIZE_IN_BYTES="4096"/);
      assert.match(xml, /label="boot_a"/);
      assert.match(xml, /label="dtbo_a"/);
      assert.match(xml, /label="vendor_boot_a"/);
    });
  });

  // ==========================================================================
  // 5. Silicon Bringup Flasher Scripts & Documentation
  // ==========================================================================
  describe('Flashing Scripts & Bringup Documentation', () => {
    it('verifies flash_device.ps1 and flash_device.sh script existence and structure', () => {
      const ps1Path = path.join(PROJECT_ROOT, 'tools/flashing/flash_device.ps1');
      const shPath = path.join(PROJECT_ROOT, 'tools/flashing/flash_device.sh');

      assert.ok(fs.existsSync(ps1Path), 'flash_device.ps1 must exist');
      assert.ok(fs.existsSync(shPath), 'flash_device.sh must exist');

      const ps1Content = fs.readFileSync(ps1Path, 'utf8');
      assert.match(ps1Content, /param\s*\(/);
      assert.match(ps1Content, /ValidateSet\('qcom',\s*'tensor'\)/);
      assert.match(ps1Content, /DryRun/);
      assert.match(ps1Content, /avb_custom_key/);

      const shContent = fs.readFileSync(shPath, 'utf8');
      assert.match(shContent, /--target/);
      assert.match(shContent, /--dry-run/);
      assert.match(shContent, /avb_custom_key/);
    });

    it('verifies comprehensive SILICON_BRINGUP.md documentation', () => {
      const docPath = path.join(PROJECT_ROOT, 'SILICON_BRINGUP.md');
      assert.ok(fs.existsSync(docPath), 'SILICON_BRINGUP.md must exist');

      const doc = fs.readFileSync(docPath, 'utf8');
      assert.match(doc, /Qualcomm Snapdragon 8 Gen 2 \/ Gen 3/);
      assert.match(doc, /Google Tensor G2 \/ G3 \/ G4/);
      assert.match(doc, /Titan M2 Hardware Security Enclave/);
      assert.match(doc, /GENI UART SE12/);
      assert.match(doc, /Exynos USI UART/);
      assert.match(doc, /Android Boot Image v4 Packaging & AVB 2\.0/);
      assert.match(doc, /Qualcomm Snapdragon \(HDK8550 Dev Board\)/);
      assert.match(doc, /Google Pixel 7 \/ 8 \/ 9/);
    });
  });

});
