// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import crypto from 'node:crypto';
import { RiskLevel, AuthorityLevel } from '../types.js';

/**
 * Camera Pixel Formats aligned with sdk/fidl/pravah.hardware/hardware.fidl
 */
export const CameraPixelFormat = Object.freeze({
  NV12: 1,     // Semi-planar YUV420
  RGB888: 2,   // 24-bit packed RGB
  ARGB8888: 3, // 32-bit ARGB
  RAW10: 4     // 10-bit Raw Bayer
});

/**
 * Camera Sensor IDs aligned with sdk/fidl/pravah.hardware/hardware.fidl
 */
export const CameraSensorId = Object.freeze({
  BACK_PRIMARY: 0,
  FRONT_SELFIE: 1,
  BACK_ULTRAWIDE: 2
});

export const CameraCapabilityDescriptor = Object.freeze({
  id: 'media.camera.capture',
  version: '1.0.0',
  riskLevel: RiskLevel.CONSEQUENTIAL,
  requiredAuthority: AuthorityLevel.EXECUTE,
  isIdempotent: false,
  timeoutMs: 5000,
  metadata: {
    category: 'MEDIA',
    description: 'Captures image buffers from Camera HAL, generates metadata card, and enforces hardware permissions'
  }
});

/**
 * Native Camera Capability
 * Interfaces with PravahOS Mobile Camera HAL (sdk/fidl/pravah.hardware/hardware.fidl),
 * captures image buffers, generates verified metadata cards, and enforces permissions.
 */
export class CameraCapability {
  constructor(options = {}) {
    this.descriptor = CameraCapabilityDescriptor;
    this.sensorProfiles = {
      [CameraSensorId.BACK_PRIMARY]: {
        name: 'Sony IMX989 1-inch Primary',
        maxWidth: 3840,
        maxHeight: 2160,
        focalLengthMm: 23.0,
        hasFlash: true,
        hasAutofocus: true
      },
      [CameraSensorId.FRONT_SELFIE]: {
        name: 'Samsung JN1 32MP Selfie',
        maxWidth: 1920,
        maxHeight: 1080,
        focalLengthMm: 21.0,
        hasFlash: false,
        hasAutofocus: true
      },
      [CameraSensorId.BACK_ULTRAWIDE]: {
        name: 'Sony IMX858 Ultrawide',
        maxWidth: 3840,
        maxHeight: 2160,
        focalLengthMm: 14.0,
        hasFlash: true,
        hasAutofocus: true
      }
    };
    this.captureCount = 0;
  }

  /**
   * Verify caller permission boundaries.
   * Throws if caller authority is insufficient or context is untrusted.
   */
  verifyPermissions({ caller, contextSource }) {
    const untrustedSources = ['email_body', 'web_scrape', 'untrusted_document', 'external_message'];
    if (untrustedSources.includes(contextSource)) {
      throw new Error(`Camera capture denied: untrusted context source "${contextSource}"`);
    }

    if (caller && caller.delegatedAuthority !== undefined && caller.delegatedAuthority < AuthorityLevel.EXECUTE) {
      throw new Error(`Camera capture denied: insufficient delegated authority (${caller.delegatedAuthority} < ${AuthorityLevel.EXECUTE})`);
    }

    return true;
  }

  /**
   * Execute simulated camera capture against the Camera HAL.
   *
   * @param {Object} inputs
   * @param {number|string} [inputs.sensorId=0] CameraSensorId (0 = BACK_PRIMARY, 1 = FRONT_SELFIE, 2 = BACK_ULTRAWIDE)
   * @param {string} [inputs.captureMode='DOCUMENT'] Capture mode: DOCUMENT | PHOTO | MACRO
   * @param {string} [inputs.format='RGB888'] Pixel format (RGB888, ARGB8888, NV12)
   * @param {number} [inputs.width] Requested width (defaults to sensor max)
   * @param {number} [inputs.height] Requested height (defaults to sensor max)
   * @param {Object} [inputs.caller] Caller descriptor
   * @param {string} [inputs.contextSource] Invocation context source
   * @returns {Promise<Object>} Frame capture descriptor and metadata card
   */
  async execute(inputs = {}) {
    // 1. Verify permissions
    this.verifyPermissions({
      caller: inputs.caller,
      contextSource: inputs.contextSource
    });

    this.captureCount++;
    const sensorId = inputs.sensorId !== undefined
      ? (typeof inputs.sensorId === 'string' ? (CameraSensorId[inputs.sensorId] ?? CameraSensorId.BACK_PRIMARY) : inputs.sensorId)
      : CameraSensorId.BACK_PRIMARY;

    const sensor = this.sensorProfiles[sensorId] || this.sensorProfiles[CameraSensorId.BACK_PRIMARY];
    const width = inputs.width || sensor.maxWidth;
    const height = inputs.height || sensor.maxHeight;
    const captureMode = inputs.captureMode || 'DOCUMENT';
    const formatName = inputs.format || 'RGB888';
    const pixelFormat = CameraPixelFormat[formatName] || CameraPixelFormat.RGB888;

    // Bytes per pixel calculation
    const bytesPerPixel = (pixelFormat === CameraPixelFormat.ARGB8888) ? 4 : (pixelFormat === CameraPixelFormat.NV12 ? 1.5 : 3);
    const stride = Math.round(width * (bytesPerPixel >= 1 ? Math.floor(bytesPerPixel) : 1));
    const sizeBytes = Math.round(width * height * bytesPerPixel);

    // 2. Synthesize image buffer frame from HAL
    const frameId = 1000 + this.captureCount;
    const timestampNs = Date.now() * 1000000;
    const exposureUs = captureMode === 'DOCUMENT' ? 8333 : 16666; // 1/120s vs 1/60s
    const isoGain = captureMode === 'DOCUMENT' ? 100 : 250;

    // Create synthetic buffer simulating frame data
    const frameBuffer = Buffer.alloc(Math.min(sizeBytes, 1024)); // representative buffer slice
    frameBuffer.write(`PRAVAH_CAMERA_FRAME_VMO_${frameId}_${captureMode}_${width}x${height}`, 0);

    const frameHash = crypto.createHash('sha256')
      .update(frameBuffer)
      .update(`${frameId}:${timestampNs}:${sensorId}:${width}x${height}:${isoGain}`)
      .digest('hex');

    // 3. Build rich hardware metadata card for UI presentation
    const metadataCard = {
      cardType: 'CAMERA_METADATA_CARD',
      frameId,
      title: `${captureMode} Capture (${sensor.name})`,
      resolution: `${width} x ${height}`,
      aspectRatio: width === 3840 && height === 2160 ? '16:9' : `${width}:${height}`,
      pixelFormat: `${formatName} (${pixelFormat === CameraPixelFormat.RGB888 ? '24-bit RGB' : '32-bit ARGB'})`,
      sensorId,
      sensorName: sensor.name,
      focalLengthMm: sensor.focalLengthMm,
      exposure: `1/${Math.round(1000000 / exposureUs)}s`,
      isoGain: `ISO ${isoGain}`,
      hardwareVmoHandle: `0xVMO_${(0x1000 + frameId).toString(16).toUpperCase()}`,
      frameSizeBytes: sizeBytes,
      checksum: frameHash.substring(0, 16),
      capturedAt: new Date().toISOString()
    };

    return {
      status: 'CAPTURED',
      frameId,
      sensorId,
      sensorName: sensor.name,
      captureMode,
      format: formatName,
      pixelFormatId: pixelFormat,
      width,
      height,
      stride,
      sizeBytes,
      timestampNs,
      exposureTimeUs: exposureUs,
      isoGain,
      frameHash,
      vmoHandle: metadataCard.hardwareVmoHandle,
      metadataCard,
      bufferRef: `vmo://pravah.hardware.camera/frame_${frameId}`
    };
  }
}

export const cameraCapability = {
  descriptor: CameraCapabilityDescriptor,
  implementation: new CameraCapability()
};
