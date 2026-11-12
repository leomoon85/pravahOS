// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OtaUpdateService,
  OtaStatusCode,
  OtaSlotState
} from '../src/services/ota_service.js';

describe('PravahOS A/B Seamless OTA Update & Rollback Guard Suite', () => {

  it('initializes on active slot A with baseline rollback index 1', () => {
    const ota = new OtaUpdateService({ activeSlot: 'a', currentRollbackIndex: 1, targetDevice: 'panther' });
    assert.equal(ota.activeSlot, OtaSlotState.SLOT_A);
    assert.equal(ota.getInactiveSlot(), OtaSlotState.SLOT_B);
    assert.equal(ota.currentRollbackIndex, 1);
  });

  it('rejects OTA payloads intended for a different hardware target', () => {
    const ota = new OtaUpdateService({ targetDevice: 'panther' });
    const wrongTargetPayload = OtaUpdateService.createSignedPayload({
      targetDevice: 'oriole', // Pixel 6 payload on Pixel 7
      targetVersion: '1.2.0'
    });

    const res = ota.applyUpdate(wrongTargetPayload);
    assert.equal(res.status, OtaStatusCode.ERR_TARGET_MISMATCH);
  });

  it('rejects OTA payloads violating hardware anti-rollback counters', () => {
    const ota = new OtaUpdateService({ targetDevice: 'panther', currentRollbackIndex: 3 });
    const downgradedPayload = OtaUpdateService.createSignedPayload({
      targetDevice: 'panther',
      targetVersion: '1.0.5',
      rollbackIndex: 2 // Attempting to downgrade below hardware fuse 3
    });

    const res = ota.applyUpdate(downgradedPayload);
    assert.equal(res.status, OtaStatusCode.ERR_ROLLBACK_PREVENTED);
  });

  it('rejects tampered OTA payloads with invalid cryptographic signatures', () => {
    const ota = new OtaUpdateService({ targetDevice: 'panther', currentRollbackIndex: 1 });
    const payload = OtaUpdateService.createSignedPayload({ targetVersion: '1.2.0' });
    payload.signature = 'deadbeef_tampered_signature_00000000000000000000000000000000';

    const res = ota.applyUpdate(payload);
    assert.equal(res.status, OtaStatusCode.ERR_SIGNATURE_MISMATCH);
  });

  it('completes full successful update cycle: Install -> Reboot Slot B -> Health Check OK', () => {
    const ota = new OtaUpdateService({ activeSlot: 'a', currentRollbackIndex: 1, targetDevice: 'panther' });
    const validUpdate = OtaUpdateService.createSignedPayload({
      targetDevice: 'panther',
      targetVersion: '2.0.0',
      rollbackIndex: 2
    });

    // 1. Apply to inactive slot B
    const updateRes = ota.applyUpdate(validUpdate);
    assert.equal(updateRes.status, OtaStatusCode.OK);
    assert.equal(updateRes.targetSlot, 'b');

    // 2. Reboot into slot B
    const rebootRes = ota.executeReboot();
    assert.equal(rebootRes.activeSlot, 'b');
    assert.equal(rebootRes.version, '2.0.0');
    assert.equal(rebootRes.triesRemaining, 2);

    // 3. System health check passes; confirm boot
    const confirmRes = ota.markBootSuccessful();
    assert.equal(confirmRes.status, OtaStatusCode.OK);
    assert.equal(confirmRes.confirmedVersion, '2.0.0');
    assert.equal(confirmRes.rollbackIndex, 2);
    assert.equal(ota.slots.b.successful, true);
  });

  it('demonstrates automatic rollback when new update fails boot health check', () => {
    const ota = new OtaUpdateService({ activeSlot: 'a', currentRollbackIndex: 1, targetDevice: 'panther' });
    const faultyUpdate = OtaUpdateService.createSignedPayload({
      targetDevice: 'panther',
      targetVersion: '2.1.0-unstable',
      rollbackIndex: 2
    });

    // 1. Apply to inactive slot B
    ota.applyUpdate(faultyUpdate);

    // 2. Reboot into slot B
    ota.executeReboot();
    assert.equal(ota.activeSlot, 'b');

    // 3. Boot failure occurs (kernel panic or service crash)
    const rollbackRes = ota.handleBootFailure();
    assert.equal(rollbackRes.status, OtaStatusCode.OK);
    assert.equal(rollbackRes.rolledBack, true);
    assert.equal(rollbackRes.failedSlot, 'b');
    assert.equal(rollbackRes.activeSlot, 'a'); // Restored to Slot A
    assert.equal(rollbackRes.restoredVersion, '1.0.0'); // Previous working version
  });

});
