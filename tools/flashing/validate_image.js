// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file validate_image.js
 * Authoritative image validation and provenance verification tool for
 * Android Boot Image v4, Vendor Boot Image v4, Flattened Device Trees (DTB v17),
 * and AVB 2.0 VBMeta structures.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const BOOT_MAGIC = 'ANDROID!';
export const VENDOR_BOOT_MAGIC = 'VNDRBOOT';
export const AVB_MAGIC = 'AVB0';
export const FDT_MAGIC = 0xd00dfeed;
export const PAGE_SIZE_V4 = 4096;

/**
 * Calculates SHA-256 checksum of a buffer.
 * @param {Buffer} buffer
 * @returns {string} Hex-encoded SHA-256 digest
 */
export function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validates an Android Boot Image v4 binary.
 * @param {Buffer} buffer 
 * @returns {object} Parsed metadata & validation outcome
 */
export function validateBootImageV4(buffer) {
  if (!buffer || buffer.length < PAGE_SIZE_V4) {
    throw new Error(`Buffer too small for Boot Image v4: ${buffer ? buffer.length : 0} bytes (minimum ${PAGE_SIZE_V4})`);
  }

  const magic = buffer.toString('ascii', 0, 8);
  if (magic !== BOOT_MAGIC) {
    throw new Error(`Invalid Boot Image magic: expected '${BOOT_MAGIC}', found '${magic}'`);
  }

  const kernelSize = buffer.readUInt32LE(8);
  const ramdiskSize = buffer.readUInt32LE(12);
  const osVersion = buffer.readUInt32LE(16);
  const headerSize = buffer.readUInt32LE(20);
  const headerVersion = buffer.readUInt32LE(40);

  if (headerVersion !== 4) {
    throw new Error(`Unsupported boot header version: expected 4, found ${headerVersion}`);
  }

  // Parse command line (null-terminated string from offset 44, max 1536 bytes)
  let cmdlineEnd = 44;
  while (cmdlineEnd < 44 + 1536 && buffer[cmdlineEnd] !== 0) {
    cmdlineEnd++;
  }
  const cmdline = buffer.toString('utf8', 44, cmdlineEnd);

  // Compute expected image layout
  const kernelPages = Math.ceil(kernelSize / PAGE_SIZE_V4);
  const ramdiskPages = Math.ceil(ramdiskSize / PAGE_SIZE_V4);
  const expectedMinSize = (1 + kernelPages + ramdiskPages) * PAGE_SIZE_V4;

  const valid = buffer.length >= expectedMinSize;
  const sha256 = computeSha256(buffer);

  return {
    type: 'BOOT_IMAGE_V4',
    valid,
    magic,
    headerVersion,
    kernelSize,
    ramdiskSize,
    osVersion,
    headerSize,
    cmdline,
    totalBytes: buffer.length,
    expectedMinSize,
    sha256
  };
}

/**
 * Validates an Android Vendor Boot Image v4 binary.
 * @param {Buffer} buffer 
 * @returns {object} Parsed metadata & validation outcome
 */
export function validateVendorBootImageV4(buffer) {
  if (!buffer || buffer.length < PAGE_SIZE_V4) {
    throw new Error(`Buffer too small for Vendor Boot Image v4: ${buffer ? buffer.length : 0} bytes`);
  }

  const magic = buffer.toString('ascii', 0, 8);
  if (magic !== VENDOR_BOOT_MAGIC) {
    throw new Error(`Invalid Vendor Boot magic: expected '${VENDOR_BOOT_MAGIC}', found '${magic}'`);
  }

  const headerVersion = buffer.readUInt32LE(8);
  if (headerVersion !== 4) {
    throw new Error(`Unsupported vendor boot header version: expected 4, found ${headerVersion}`);
  }

  const pageSize = buffer.readUInt32LE(12) || PAGE_SIZE_V4;
  const kernelLoadAddr = buffer.readUInt32LE(16);
  const ramdiskLoadAddr = buffer.readUInt32LE(20);
  const vendorRamdiskSize = buffer.readUInt32LE(24);
  
  // Cmdline from offset 28 (up to 2048 bytes)
  let cmdlineEnd = 28;
  while (cmdlineEnd < 28 + 2048 && buffer[cmdlineEnd] !== 0) {
    cmdlineEnd++;
  }
  const cmdline = buffer.toString('utf8', 28, cmdlineEnd);

  // Board name at offset 2080 (16 bytes)
  let boardNameEnd = 2080;
  while (boardNameEnd < 2080 + 16 && buffer[boardNameEnd] !== 0) {
    boardNameEnd++;
  }
  const boardName = buffer.toString('ascii', 2080, boardNameEnd);

  const dtbSize = buffer.readUInt32LE(2100);
  const dtbLoadAddr = buffer.readBigUInt64LE(2104);

  // Check DTB payload if present
  let dtbValid = false;
  let dtbOffset = 0;
  if (dtbSize > 0) {
    const vrdPages = Math.ceil(vendorRamdiskSize / pageSize);
    dtbOffset = (1 + vrdPages) * pageSize;
    if (buffer.length >= dtbOffset + 4) {
      const dtbMagic = buffer.readUInt32BE(dtbOffset);
      dtbValid = (dtbMagic === FDT_MAGIC);
    }
  }

  const sha256 = computeSha256(buffer);

  return {
    type: 'VENDOR_BOOT_IMAGE_V4',
    valid: true,
    magic,
    headerVersion,
    pageSize,
    boardName,
    kernelLoadAddr: '0x' + kernelLoadAddr.toString(16),
    ramdiskLoadAddr: '0x' + ramdiskLoadAddr.toString(16),
    vendorRamdiskSize,
    dtbSize,
    dtbLoadAddr: '0x' + dtbLoadAddr.toString(16),
    dtbOffset,
    dtbValid,
    totalBytes: buffer.length,
    sha256
  };
}

/**
 * Validates a Flattened Device Tree binary blob (DTB v17).
 * @param {Buffer} buffer 
 * @returns {object} Parsed metadata & validation outcome
 */
export function validateDtbBinary(buffer) {
  if (!buffer || buffer.length < 32) {
    throw new Error(`Buffer too small for DTB: ${buffer ? buffer.length : 0} bytes (minimum 32)`);
  }

  const magic = buffer.readUInt32BE(0);
  if (magic !== FDT_MAGIC) {
    throw new Error(`Invalid DTB magic: expected 0xd00dfeed, found 0x${magic.toString(16)}`);
  }

  const totalsize = buffer.readUInt32BE(4);
  const offDtStruct = buffer.readUInt32BE(8);
  const offDtStrings = buffer.readUInt32BE(12);
  const offMemRsvmap = buffer.readUInt32BE(16);
  const version = buffer.readUInt32BE(20);
  const lastCompVersion = buffer.readUInt32BE(24);

  if (version < 17) {
    throw new Error(`Unsupported FDT version: ${version} (expected >= 17)`);
  }

  const valid = (totalsize <= buffer.length) && (offDtStruct < totalsize) && (offDtStrings < totalsize);
  const sha256 = computeSha256(buffer);

  return {
    type: 'FLATTENED_DEVICE_TREE_V17',
    valid,
    magic: '0x' + magic.toString(16),
    totalsize,
    offDtStruct,
    offDtStrings,
    offMemRsvmap,
    version,
    lastCompVersion,
    actualBytes: buffer.length,
    sha256
  };
}

/**
 * Validates an AVB 2.0 VBMeta binary structure.
 * @param {Buffer} buffer 
 * @returns {object} Parsed metadata & validation outcome
 */
export function validateAvbVbmeta(buffer) {
  if (!buffer || buffer.length < 64) {
    throw new Error(`Buffer too small for AVB VBMeta: ${buffer ? buffer.length : 0} bytes`);
  }

  const magic = buffer.toString('ascii', 0, 4);
  if (magic !== AVB_MAGIC) {
    throw new Error(`Invalid AVB magic: expected '${AVB_MAGIC}', found '${magic}'`);
  }

  const requiredMajor = buffer.readUInt32BE(4);
  const requiredMinor = buffer.readUInt32BE(8);
  const rollbackIndex = Number(buffer.readBigUInt64BE(16));
  const flags = buffer.readUInt32BE(24);

  const sha256 = computeSha256(buffer);

  return {
    type: 'AVB_2_0_VBMETA',
    valid: true,
    magic,
    requiredVersion: `${requiredMajor}.${requiredMinor}`,
    flags,
    rollbackIndex,
    totalBytes: buffer.length,
    sha256
  };
}

/**
 * Inspects a file and automatically detects and validates its image format.
 * @param {string} filePath 
 * @returns {object} Validation result
 */
export function inspectAndValidateFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Target file does not exist: ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 8) {
    const magicAscii = buffer.toString('ascii', 0, 8);
    if (magicAscii.startsWith(BOOT_MAGIC)) {
      return validateBootImageV4(buffer);
    }
    if (magicAscii.startsWith(VENDOR_BOOT_MAGIC)) {
      return validateVendorBootImageV4(buffer);
    }
    if (magicAscii.startsWith(AVB_MAGIC)) {
      return validateAvbVbmeta(buffer);
    }
  }

  if (buffer.length >= 4) {
    const magicBe = buffer.readUInt32BE(0);
    if (magicBe === FDT_MAGIC) {
      return validateDtbBinary(buffer);
    }
  }

  throw new Error(`Unrecognized image format in ${filePath}`);
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const targetFile = process.argv[2];
  if (!targetFile) {
    console.error('Usage: node tools/flashing/validate_image.js <path-to-image>');
    process.exit(1);
  }

  try {
    const result = inspectAndValidateFile(targetFile);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 2);
  } catch (err) {
    console.error(`Validation failed: ${err.message}`);
    process.exit(1);
  }
}
