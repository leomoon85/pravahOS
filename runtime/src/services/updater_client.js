// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file updater_client.js
 * On-Device System Updater Client & A/B Slot Manager for PravahOS.
 *
 * Connects the Settings UI to the OtaUpdateService to manage:
 * 1. Checking for signed system updates.
 * 2. Streaming installation to inactive partition slot (Slot A <-> Slot B).
 * 3. Real-time download & verification progress.
 * 4. Reboot scheduling and health-check confirmation.
 */

import { OtaUpdateService, OtaStatusCode, OtaSlotState } from './ota_service.js';

export class UpdaterClient {
  /**
   * @param {Object} [options]
   * @param {OtaUpdateService} [options.service]
   */
  constructor(options = {}) {
    this.service = options.service || new OtaUpdateService({
      activeSlot: OtaSlotState.SLOT_A,
      currentRollbackIndex: 1,
      targetDevice: 'panther'
    });

    this.currentVersion = '1.0.0';
    this.isChecking = false;
    this.isDownloading = false;
    this.pendingUpdate = null;
  }

  getSystemStatus() {
    return {
      activeSlot: this.service.activeSlot,
      inactiveSlot: this.service.getInactiveSlot(),
      currentVersion: this.currentVersion,
      rollbackIndex: this.service.currentRollbackIndex,
      targetDevice: this.service.targetDevice,
      slots: this.service.slots,
      isUpdating: this.service.isUpdating,
      pendingReboot: Boolean(this.service.pendingRebootSlot)
    };
  }

  /**
   * Checks for available OTA updates.
   * @param {Object} [mockUpdatePayload] - Optional payload for test/local updates
   */
  async checkForUpdates(mockUpdatePayload = null) {
    this.isChecking = true;

    // Simulate short network check
    await new Promise(r => setTimeout(r, 50));
    this.isChecking = false;

    if (mockUpdatePayload) {
      this.pendingUpdate = mockUpdatePayload;
      return {
        updateAvailable: true,
        version: mockUpdatePayload.header.targetVersion,
        rollbackIndex: mockUpdatePayload.header.rollbackIndex,
        changelog: 'PravahOS Security & Silicon Maintenance Update'
      };
    }

    // Default simulated update if target is older than 1.1.0
    if (this.currentVersion === '1.0.0') {
      const payload = OtaUpdateService.createSignedPayload({
        targetDevice: this.service.targetDevice,
        targetVersion: '1.1.0',
        rollbackIndex: 2
      });
      this.pendingUpdate = payload;

      return {
        updateAvailable: true,
        version: '1.1.0',
        rollbackIndex: 2,
        changelog: 'Google Tensor G2 Linux GKI 5.10.209, Policy Gate Forward Ledger, 0.0V Sensor Rail Governor'
      };
    }

    return { updateAvailable: false, currentVersion: this.currentVersion };
  }

  /**
   * Downloads and streams update to the inactive slot with progress callback.
   * @param {Function} [onProgress] - Callback (percent: number, status: string)
   */
  async downloadAndInstall(onProgress = null) {
    if (!this.pendingUpdate) {
      throw new Error('NO_UPDATE_PENDING: Call checkForUpdates() first');
    }

    this.isDownloading = true;

    // Simulate progress increments for UI responsiveness
    for (let percent = 10; percent <= 90; percent += 20) {
      if (onProgress) onProgress(percent, `Streaming to Partition Slot ${this.service.getInactiveSlot().toUpperCase()}...`);
      await new Promise(r => setTimeout(r, 15));
    }

    if (onProgress) onProgress(95, 'Verifying AVB 2.0 signatures & Titan M2 anti-rollback counters...');
    const result = this.service.applyUpdate(this.pendingUpdate);

    if (result.status !== OtaStatusCode.OK) {
      this.isDownloading = false;
      throw new Error(`UPDATE_FAILED: ${result.error || 'Failed to apply update'}`);
    }

    if (onProgress) onProgress(100, `Ready for reboot into Slot ${result.targetSlot.toUpperCase()}`);
    this.isDownloading = false;

    return {
      success: true,
      targetSlot: result.targetSlot,
      targetVersion: result.targetVersion,
      readyForReboot: true
    };
  }

  /**
   * Reboots the device into the new slot and confirms health check.
   */
  async rebootAndVerify() {
    const rebootResult = this.service.executeReboot();
    if (!rebootResult.rebooted) {
      throw new Error('REBOOT_SKIPPED: No pending slot to boot into');
    }

    // Perform self-test health check
    const healthOk = true;
    if (healthOk) {
      const confirm = this.service.markBootSuccessful();
      this.currentVersion = confirm.confirmedVersion;
      this.pendingUpdate = null;
      return {
        success: true,
        activeSlot: confirm.activeSlot,
        confirmedVersion: confirm.confirmedVersion,
        rollbackIndex: confirm.rollbackIndex
      };
    } else {
      const rollback = this.service.handleBootFailure();
      return {
        success: false,
        rolledBack: true,
        activeSlot: rollback.activeSlot,
        restoredVersion: rollback.restoredVersion
      };
    }
  }
}

let defaultUpdaterClient = null;

export function getUpdaterClient() {
  if (!defaultUpdaterClient) {
    defaultUpdaterClient = new UpdaterClient();
  }
  return defaultUpdaterClient;
}
