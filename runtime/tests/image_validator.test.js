// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  BOOT_MAGIC,
  VENDOR_BOOT_MAGIC,
  AVB_MAGIC,
  FDT_MAGIC,
  computeSha256,
  validateBootImageV4,
  validateVendorBootImageV4,
  validateDtbBinary,
  validateAvbVbmeta,
  inspectAndValidateFile
} from '../../tools/flashing/validate_image.js';

import {
  createBootImageV4,
  createVendorBootImageV4,
  generateAvbMetadata
} from '../../tools/flashing/mkbootimg.js';

import { compileDtsToDtb } from '../../tools/flashing/build_dtb.js';

describe('Authoritative Image Validation & Provenance Verification Suite', () => {

  it('computes correct SHA-256 provenance hashes', () => {
    const testBuf = Buffer.from('PRAVAHOS_PANTHER_PROVENANCE_TEST_2026');
    const hash = computeSha256(testBuf);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  describe('Boot Image v4 Validation', () => {
    it('successfully validates a compliant Boot Image v4', () => {
      const mockKernel = Buffer.alloc(2048, 0x41);
      const mockRamdisk = Buffer.alloc(1024, 0x42);
      const bootImg = createBootImageV4({
        kernelBuffer: mockKernel,
        ramdiskBuffer: mockRamdisk,
        cmdline: 'console=ttySAC0,115200 root=/dev/pravah_root'
      });

      const result = validateBootImageV4(bootImg);
      assert.equal(result.type, 'BOOT_IMAGE_V4');
      assert.equal(result.valid, true);
      assert.equal(result.magic, BOOT_MAGIC);
      assert.equal(result.headerVersion, 4);
      assert.equal(result.kernelSize, 2048);
      assert.equal(result.ramdiskSize, 1024);
      assert.equal(result.cmdline, 'console=ttySAC0,115200 root=/dev/pravah_root');
      assert.ok(result.sha256.length === 64);
    });

    it('fails closed when Boot Image magic is invalid', () => {
      const badBuf = Buffer.alloc(4096, 0);
      badBuf.write('CORRUPT!', 0, 'ascii');
      assert.throws(() => validateBootImageV4(badBuf), /Invalid Boot Image magic/);
    });

    it('fails closed when buffer is smaller than 4096 bytes', () => {
      const tinyBuf = Buffer.alloc(1024, 0);
      assert.throws(() => validateBootImageV4(tinyBuf), /Buffer too small/);
    });
  });

  describe('Vendor Boot Image v4 Validation', () => {
    it('successfully validates a compliant Vendor Boot Image v4 with embedded DTB', () => {
      const mockDtb = Buffer.alloc(4096, 0);
      mockDtb.writeUInt32BE(FDT_MAGIC, 0);
      mockDtb.writeUInt32BE(4096, 4); // totalsize

      const vendorBootImg = createVendorBootImageV4({
        dtbBuffer: mockDtb,
        boardName: 'PANTHER_G2'
      });

      const result = validateVendorBootImageV4(vendorBootImg);
      assert.equal(result.type, 'VENDOR_BOOT_IMAGE_V4');
      assert.equal(result.valid, true);
      assert.equal(result.magic, VENDOR_BOOT_MAGIC);
      assert.equal(result.headerVersion, 4);
      assert.equal(result.boardName, 'PANTHER_G2');
      assert.equal(result.dtbSize, 4096);
      assert.equal(result.dtbValid, true);
      assert.ok(result.sha256.length === 64);
    });

    it('fails closed when Vendor Boot magic is invalid', () => {
      const badBuf = Buffer.alloc(4096, 0);
      badBuf.write('NOTVENDOR', 0, 'ascii');
      assert.throws(() => validateVendorBootImageV4(badBuf), /Invalid Vendor Boot magic/);
    });
  });

  describe('Flattened Device Tree (DTB v17) Validation', () => {
    it('validates compiled Google Tensor G3/G2 DTS', () => {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const dtsPath = path.resolve(__dirname, '../../kernel/arch/arm64/google/google_tensor_g3.dts');
      
      const dtsContent = fs.readFileSync(dtsPath, 'utf8');
      const dtbBuffer = compileDtsToDtb(dtsContent);

      const result = validateDtbBinary(dtbBuffer);
      assert.equal(result.type, 'FLATTENED_DEVICE_TREE_V17');
      assert.equal(result.valid, true);
      assert.equal(result.magic, '0xd00dfeed');
      assert.ok(result.version >= 17);
      assert.ok(result.totalsize <= dtbBuffer.length);
      assert.ok(result.sha256.length === 64);
    });

    it('fails closed when DTB magic is missing or corrupted', () => {
      const badBuf = Buffer.alloc(64, 0);
      badBuf.writeUInt32BE(0x12345678, 0);
      assert.throws(() => validateDtbBinary(badBuf), /Invalid DTB magic/);
    });
  });

  describe('AVB 2.0 VBMeta Validation', () => {
    it('validates AVB 2.0 VBMeta signature structure', () => {
      const mockBoot = Buffer.alloc(4096, 0x11);
      const avb = generateAvbMetadata({
        bootImageBuffer: mockBoot,
        rollbackIndex: 3
      });

      const result = validateAvbVbmeta(avb.vbmetaBuffer);
      assert.equal(result.type, 'AVB_2_0_VBMETA');
      assert.equal(result.valid, true);
      assert.equal(result.magic, AVB_MAGIC);
      assert.equal(result.rollbackIndex, 3);
      assert.ok(result.sha256.length === 64);
    });

    it('fails closed when AVB magic is invalid', () => {
      const badBuf = Buffer.alloc(64, 0);
      badBuf.write('FAKE', 0, 'ascii');
      assert.throws(() => validateAvbVbmeta(badBuf), /Invalid AVB magic/);
    });
  });

  describe('inspectAndValidateFile auto-detection', () => {
    it('automatically identifies image types on disk', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pravah-val-'));
      const bootPath = path.join(tmpDir, 'test_boot.img');
      const mockKernel = Buffer.alloc(1024, 0x77);
      const bootImg = createBootImageV4({ kernelBuffer: mockKernel });
      fs.writeFileSync(bootPath, bootImg);

      const detected = inspectAndValidateFile(bootPath);
      assert.equal(detected.type, 'BOOT_IMAGE_V4');
      assert.equal(detected.valid, true);

      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

});
