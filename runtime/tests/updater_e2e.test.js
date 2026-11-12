// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { OtaUpdateService, OtaSlotState } from '../src/services/ota_service.js';
import { UpdaterClient } from '../src/services/updater_client.js';
import { generateOtaPayloadBundle } from '../../tools/flashing/generate_ota_payload.js';
import { SettingsApp } from '../../ui/apps/settings.js';

describe('PravahOS End-to-End Updatability & A/B Seamless Slot Suite', () => {

  it('generates a signed OTA payload bundle from build artifacts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pravah_ota_build_'));
    const mockBootPath = path.join(tmpDir, 'pravah_boot.img');
    const mockVendorPath = path.join(tmpDir, 'pravah_vendor_boot.img');

    // Create 4KB mock boot images
    fs.writeFileSync(mockBootPath, Buffer.alloc(4096, 0x55));
    fs.writeFileSync(mockVendorPath, Buffer.alloc(4096, 0xaa));

    const result = generateOtaPayloadBundle({
      outDir: tmpDir,
      targetDevice: 'panther',
      targetVersion: '1.2.0',
      rollbackIndex: 2
    });

    assert.ok(fs.existsSync(result.payloadFilePath));
    assert.equal(result.targetDevice, 'panther');
    assert.equal(result.targetVersion, '1.2.0');
    assert.equal(result.rollbackIndex, 2);
    assert.ok(result.signature.length === 64);

    // Verify written JSON
    const parsed = JSON.parse(fs.readFileSync(result.payloadFilePath, 'utf8'));
    assert.equal(parsed.header.targetDevice, 'panther');
    assert.equal(parsed.header.targetVersion, '1.2.0');

    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('UpdaterClient executes full seamless update lifecycle: Check -> Download -> Slot Switch -> Confirm', async () => {
    const service = new OtaUpdateService({
      activeSlot: OtaSlotState.SLOT_A,
      currentRollbackIndex: 1,
      targetDevice: 'panther'
    });
    const updater = new UpdaterClient({ service });

    // 1. Initial State: Slot A
    const initialStatus = updater.getSystemStatus();
    assert.equal(initialStatus.activeSlot, 'a');
    assert.equal(initialStatus.inactiveSlot, 'b');
    assert.equal(initialStatus.currentVersion, '1.0.0');

    // 2. Check for Updates
    const checkRes = await updater.checkForUpdates();
    assert.equal(checkRes.updateAvailable, true);
    assert.equal(checkRes.version, '1.1.0');

    // 3. Download & Install to Inactive Slot B
    const progressLog = [];
    const installRes = await updater.downloadAndInstall((pct, txt) => {
      progressLog.push({ pct, txt });
    });

    assert.equal(installRes.success, true);
    assert.equal(installRes.targetSlot, 'b');
    assert.equal(installRes.readyForReboot, true);
    assert.ok(progressLog.length >= 4);

    // 4. Reboot into Slot B and Confirm Health Check
    const rebootRes = await updater.rebootAndVerify();
    assert.equal(rebootRes.success, true);
    assert.equal(rebootRes.activeSlot, 'b');
    assert.equal(rebootRes.confirmedVersion, '1.1.0');
    assert.equal(rebootRes.rollbackIndex, 2);

    // 5. Final Status: Active is now Slot B
    const finalStatus = updater.getSystemStatus();
    assert.equal(finalStatus.activeSlot, 'b');
    assert.equal(finalStatus.inactiveSlot, 'a');
    assert.equal(finalStatus.currentVersion, '1.1.0');
  });

  it('UpdaterClient handles boot failure and performs automatic rollback', async () => {
    const service = new OtaUpdateService({
      activeSlot: OtaSlotState.SLOT_A,
      currentRollbackIndex: 1,
      targetDevice: 'panther'
    });
    const updater = new UpdaterClient({ service });

    const buggyPayload = OtaUpdateService.createSignedPayload({
      targetDevice: 'panther',
      targetVersion: '2.0.0-buggy',
      rollbackIndex: 2
    });

    await updater.checkForUpdates(buggyPayload);
    await updater.downloadAndInstall();

    // Trigger reboot into slot B
    service.executeReboot();
    assert.equal(service.activeSlot, 'b');

    // Health check fails -> Trigger rollback
    const rollbackRes = service.handleBootFailure();
    assert.equal(rollbackRes.rolledBack, true);
    assert.equal(rollbackRes.failedSlot, 'b');
    assert.equal(rollbackRes.activeSlot, 'a');
    assert.equal(rollbackRes.restoredVersion, '1.0.0');
  });

  it('SettingsApp renders System Updates tab with active slot and controls', () => {
    const service = new OtaUpdateService({
      activeSlot: OtaSlotState.SLOT_A,
      currentRollbackIndex: 1,
      targetDevice: 'panther'
    });
    const updater = new UpdaterClient({ service });
    const settings = new SettingsApp({ updaterClient: updater });

    const mockContainer = {
      innerHTML: '',
      querySelectorAll: () => [],
      querySelector: () => null
    };

    settings.render(mockContainer);
    assert.match(mockContainer.innerHTML, /Seamless A\/B System Updates/);
    assert.match(mockContainer.innerHTML, /Slot A/);
    assert.match(mockContainer.innerHTML, /Check for Updates/);
    assert.match(mockContainer.innerHTML, /Anti-Rollback Fuse Index/);
  });

});
