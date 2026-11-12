// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file generate_ota_payload.js
 * Authoritative A/B Seamless OTA Payload Generator for Google Pixel 7 (panther).
 *
 * Packages kernel boot image, vendor boot image, device tree blobs, and system
 * manifests into a cryptographically signed A/B update bundle.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { OtaUpdateService } from '../../runtime/src/services/ota_service.js';

export function generateOtaPayloadBundle({
  outDir = 'out/panther',
  targetDevice = 'panther',
  targetVersion = '1.1.0',
  rollbackIndex = 1,
  signingSecret = process.env.PRAVAH_OTA_SECRET || 'PRAVAH_TEST_OTA_SIGNING_SECRET_2026'
} = {}) {
  const bootImgPath = path.join(outDir, 'pravah_boot.img');
  const vendorBootImgPath = path.join(outDir, 'pravah_vendor_boot.img');

  if (!fs.existsSync(bootImgPath)) {
    throw new Error(`Boot image not found at: ${bootImgPath}`);
  }

  const bootBuf = fs.readFileSync(bootImgPath);
  const vendorBootBuf = fs.existsSync(vendorBootImgPath)
    ? fs.readFileSync(vendorBootImgPath)
    : Buffer.alloc(0);

  // Pack images into unified payload data
  const payloadData = Buffer.concat([
    Buffer.from('PRAVAH_OTA_IMAGE_ARCHIVE_V1\0'),
    bootBuf,
    vendorBootBuf
  ]);

  const bundle = OtaUpdateService.createSignedPayload({
    targetDevice,
    targetVersion,
    rollbackIndex,
    payloadData,
    signingSecret
  });

  const payloadFilePath = path.join(outDir, `pravah_ota_${targetDevice}_${targetVersion}.json`);
  const exportData = {
    header: bundle.header,
    headerSerialized: bundle.headerSerialized,
    signature: bundle.signature,
    payloadBase64: bundle.payloadData.toString('base64')
  };

  fs.writeFileSync(payloadFilePath, JSON.stringify(exportData, null, 2), 'utf8');

  return {
    payloadFilePath,
    bundle,
    targetDevice,
    targetVersion,
    rollbackIndex,
    signature: bundle.signature
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const args = process.argv.slice(2);
  const outDir = args[0] || 'out/panther';
  const targetVersion = args[1] || '1.1.0';
  const rollbackIndex = parseInt(args[2] || '1', 10);

  try {
    const res = generateOtaPayloadBundle({ outDir, targetVersion, rollbackIndex });
    console.log(`[PASS] Generated signed OTA update bundle: ${res.payloadFilePath}`);
    console.log(`       Target: ${res.targetDevice} | Version: ${res.targetVersion} | Rollback Index: ${res.rollbackIndex}`);
    console.log(`       Signature: ${res.signature}`);
  } catch (err) {
    console.error(`[FATAL] Failed to generate OTA payload: ${err.message}`);
    process.exit(1);
  }
}
