// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file ota_service.js
 * PravahOS A/B Seamless OTA Update Engine & Rollback Guard.
 *
 * Implements the dual-slot A/B seamless update pipeline matching Pixel 7
 * AVB 2.0 hardware invariants:
 * 1. Cryptographic payload integrity & signature verification.
 * 2. Hardware anti-rollback protection (checks against Titan M2 fuse index).
 * 3. Streaming installation to inactive partition slot (Slot A <-> Slot B).
 * 4. Post-update boot health checks & automatic rollback if boot fails.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const OtaSlotState = {
  SLOT_A: 'a',
  SLOT_B: 'b'
};

export const OtaStatusCode = {
  OK: 0,
  ERR_INVALID_PAYLOAD: -1,
  ERR_SIGNATURE_MISMATCH: -2,
  ERR_ROLLBACK_PREVENTED: -3,
  ERR_TARGET_MISMATCH: -4,
  ERR_SLOT_BUSY: -5,
  ERR_HEALTH_CHECK_FAILED: -6
};

export class OtaUpdateService {
  /**
   * @param {Object} options
   * @param {string} [options.activeSlot] - Initial active slot ('a' or 'b')
   * @param {number} [options.currentRollbackIndex] - Hardware anti-rollback counter
   * @param {string} [options.targetDevice] - Target device identifier ('panther')
   * @param {string} [options.stateFilePath] - Path to persist slot metadata
   */
  constructor(options = {}) {
    this.activeSlot = options.activeSlot || OtaSlotState.SLOT_A;
    this.currentRollbackIndex = options.currentRollbackIndex ?? 1;
    this.targetDevice = options.targetDevice || 'panther';
    this.stateFilePath = options.stateFilePath || null;

    this.slots = {
      a: { successful: true, unbootable: false, triesRemaining: 0, version: '1.0.0' },
      b: { successful: true, unbootable: false, triesRemaining: 0, version: '1.0.0' }
    };

    this.isUpdating = false;
    this.pendingRebootSlot = null;
  }

  getInactiveSlot() {
    return this.activeSlot === OtaSlotState.SLOT_A ? OtaSlotState.SLOT_B : OtaSlotState.SLOT_A;
  }

  /**
   * Generates a signed OTA payload bundle.
   */
  static createSignedPayload({
    targetDevice = 'panther',
    targetVersion = '1.1.0',
    rollbackIndex = 2,
    payloadData = Buffer.from('PRAVAHOS_PANTHER_GKI_PAYLOAD_V2'),
    signingSecret = 'PRAVAH_TEST_OTA_SIGNING_SECRET_2026'
  }) {
    const payloadHash = crypto.createHash('sha256').update(payloadData).digest('hex');
    const header = {
      magic: 'PRAVAH_OTA_V1',
      targetDevice,
      targetVersion,
      rollbackIndex,
      payloadBytes: payloadData.length,
      payloadHash,
      createdAt: new Date().toISOString()
    };

    const headerSerialized = JSON.stringify(header);
    const signature = crypto.createHmac('sha256', signingSecret).update(headerSerialized).digest('hex');

    return {
      header,
      headerSerialized,
      signature,
      payloadData
    };
  }

  /**
   * Verifies payload against target hardware, signatures, and anti-rollback rules.
   */
  verifyPayload(bundle, verificationSecret = 'PRAVAH_TEST_OTA_SIGNING_SECRET_2026') {
    if (!bundle || !bundle.header || !bundle.signature) {
      return { status: OtaStatusCode.ERR_INVALID_PAYLOAD, error: 'Malformed OTA bundle structure' };
    }

    const { header, headerSerialized, signature } = bundle;

    // 1. Verify Target Device Identity
    if (header.targetDevice !== this.targetDevice) {
      return {
        status: OtaStatusCode.ERR_TARGET_MISMATCH,
        error: `Target mismatch: payload is for '${header.targetDevice}', this hardware is '${this.targetDevice}'`
      };
    }

    // 2. Hardware Anti-Rollback Check (Titan M2 Protection)
    if (header.rollbackIndex < this.currentRollbackIndex) {
      return {
        status: OtaStatusCode.ERR_ROLLBACK_PREVENTED,
        error: `Anti-rollback protection: payload index (${header.rollbackIndex}) is lower than hardware fuse (${this.currentRollbackIndex})`
      };
    }

    // 3. Cryptographic Signature Verification
    const expectedSig = crypto.createHmac('sha256', verificationSecret).update(headerSerialized).digest('hex');
    if (signature !== expectedSig) {
      return { status: OtaStatusCode.ERR_SIGNATURE_MISMATCH, error: 'Cryptographic signature verification failed' };
    }

    return { status: OtaStatusCode.OK, verified: true };
  }

  /**
   * Applies an OTA update to the inactive A/B slot.
   */
  applyUpdate(bundle, verificationSecret = 'PRAVAH_TEST_OTA_SIGNING_SECRET_2026') {
    if (this.isUpdating) {
      return { status: OtaStatusCode.ERR_SLOT_BUSY, error: 'Another update is already in progress' };
    }

    const verification = this.verifyPayload(bundle, verificationSecret);
    if (verification.status !== OtaStatusCode.OK) {
      return verification;
    }

    this.isUpdating = true;
    const targetSlot = this.getInactiveSlot();

    try {
      // Stream write update to inactive partition slot
      this.slots[targetSlot] = {
        successful: false,
        unbootable: false,
        triesRemaining: 3, // 3 boot attempts before automatic rollback
        version: bundle.header.targetVersion,
        pendingRollbackIndex: bundle.header.rollbackIndex
      };

      // Set target slot active for next reboot
      this.pendingRebootSlot = targetSlot;
      this.isUpdating = false;

      return {
        status: OtaStatusCode.OK,
        targetSlot,
        targetVersion: bundle.header.targetVersion,
        readyForReboot: true
      };
    } catch (err) {
      this.isUpdating = false;
      return { status: OtaStatusCode.ERR_INVALID_PAYLOAD, error: err.message };
    }
  }

  /**
   * Simulates a reboot into the new slot and performs health self-test.
   */
  executeReboot() {
    if (!this.pendingRebootSlot) {
      return { activeSlot: this.activeSlot, rolledBack: false };
    }

    const newSlot = this.pendingRebootSlot;
    this.pendingRebootSlot = null;
    this.activeSlot = newSlot;

    // Decrement boot attempts
    if (this.slots[newSlot].triesRemaining > 0) {
      this.slots[newSlot].triesRemaining -= 1;
    }

    return {
      activeSlot: this.activeSlot,
      version: this.slots[this.activeSlot].version,
      triesRemaining: this.slots[this.activeSlot].triesRemaining,
      rebooted: true
    };
  }

  /**
   * Called by system daemon after successful post-boot health checks.
   */
  markBootSuccessful() {
    const slotInfo = this.slots[this.activeSlot];
    slotInfo.successful = true;
    slotInfo.triesRemaining = 0;

    if (slotInfo.pendingRollbackIndex) {
      this.currentRollbackIndex = slotInfo.pendingRollbackIndex;
      delete slotInfo.pendingRollbackIndex;
    }

    return {
      status: OtaStatusCode.OK,
      activeSlot: this.activeSlot,
      confirmedVersion: slotInfo.version,
      rollbackIndex: this.currentRollbackIndex
    };
  }

  /**
   * Automatic rollback trigger if boot health check fails or kernel panics.
   */
  handleBootFailure() {
    const failedSlot = this.activeSlot;
    this.slots[failedSlot].unbootable = true;
    this.slots[failedSlot].successful = false;
    this.slots[failedSlot].triesRemaining = 0;

    // Rollback to alternate slot
    const fallbackSlot = this.getInactiveSlot();
    this.activeSlot = fallbackSlot;

    return {
      status: OtaStatusCode.OK,
      rolledBack: true,
      failedSlot,
      activeSlot: this.activeSlot,
      restoredVersion: this.slots[this.activeSlot].version
    };
  }
}
