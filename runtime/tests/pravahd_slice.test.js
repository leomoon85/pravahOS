// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file pravahd_slice.test.js
 * Hardware Vertical Slice Acceptance Test Suite for PravahOS.
 *
 * Verifies the complete vertical slice:
 * Bootloader/Init -> pravahd native daemon -> Hardware Sysfs Nodes ->
 * Deterministic Policy Gate -> Hardware Operation -> Crash-Resilient Persistence ->
 * Reboot Recovery -> Tamper Detection & Fail-Closed Security.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  PravahdService,
  PravahRisk,
  PravahStatusCode
} from '../src/services/pravahd_service.js';

import {
  PravahClient
} from '../src/services/pravah_client.js';

// Setup isolated temporary test harness directory
function createTestHarness() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pravah_slice_test_'));
  const dataDir = path.join(tmpBase, 'data');
  const sysfsRoot = tmpBase;

  // Create mock Linux sysfs hierarchy for Pixel phone hardware
  const batteryDir = path.join(sysfsRoot, 'sys', 'class', 'power_supply', 'battery');
  const backlightDir = path.join(sysfsRoot, 'sys', 'class', 'backlight', 'panel0-backlight');

  fs.mkdirSync(batteryDir, { recursive: true });
  fs.mkdirSync(backlightDir, { recursive: true });

  // Populate initial physical hardware nodes
  fs.writeFileSync(path.join(batteryDir, 'capacity'), '78\n');
  fs.writeFileSync(path.join(batteryDir, 'status'), 'Charging\n');
  fs.writeFileSync(path.join(batteryDir, 'voltage_now'), '4185000\n');
  fs.writeFileSync(path.join(batteryDir, 'temp'), '312\n');

  fs.writeFileSync(path.join(backlightDir, 'brightness'), '140\n');
  fs.writeFileSync(path.join(backlightDir, 'max_brightness'), '255\n');

  return { tmpBase, dataDir, sysfsRoot, batteryDir, backlightDir };
}

function cleanTestHarness(harness) {
  try {
    fs.rmSync(harness.tmpBase, { recursive: true, force: true });
  } catch (_) {}
}

// ============================================================================
// 1. DAEMON INITIALIZATION & LIFECYCLE
// ============================================================================

test('Vertical Slice 1: pravahd daemon bootstraps with clean state directories', () => {
  const harness = createTestHarness();
  try {
    const daemon = new PravahdService({
      dataDir: harness.dataDir,
      sysfsRoot: harness.sysfsRoot,
      allowSimulationFallback: false
    });

    const res = daemon.start();
    assert.equal(res.status, PravahStatusCode.OK);
    assert.equal(daemon.isRunning, true);
    assert.ok(fs.existsSync(harness.dataDir));

    daemon.stop();
    assert.equal(daemon.isRunning, false);
  } finally {
    cleanTestHarness(harness);
  }
});

// ============================================================================
// 2. HARDWARE TELEMETRY: REAL SYSFS BATTERY READING
// ============================================================================

test('Vertical Slice 2: reads real hardware battery telemetry from sysfs power_supply nodes', () => {
  const harness = createTestHarness();
  try {
    const daemon = new PravahdService({
      dataDir: harness.dataDir,
      sysfsRoot: harness.sysfsRoot,
      allowSimulationFallback: false
    });

    const res = daemon.getBatteryInfo();
    assert.equal(res.status, PravahStatusCode.OK);
    assert.equal(res.battery.percentage, 78);
    assert.equal(res.battery.status, 'Charging');
    assert.equal(res.battery.voltageUv, 4185000);
    assert.equal(res.battery.tempTenthsC, 312);
    assert.equal(res.battery.isSimulated, false); // Real hardware reading verified
  } finally {
    cleanTestHarness(harness);
  }
});

// ============================================================================
// 3. FAIL-CLOSED SECURITY: FAILS CLOSED WHEN HARDWARE NODE MISSING
// ============================================================================

test('Vertical Slice 3: fails closed (ERR_HARDWARE_UNAVAIL) when physical battery node is missing', () => {
  const harness = createTestHarness();
  try {
    // Remove capacity node
    fs.unlinkSync(path.join(harness.batteryDir, 'capacity'));

    const daemon = new PravahdService({
      dataDir: harness.dataDir,
      sysfsRoot: harness.sysfsRoot,
      allowSimulationFallback: false // Strict physical mode: MUST fail closed
    });

    const res = daemon.getBatteryInfo();
    assert.equal(res.status, PravahStatusCode.ERR_HARDWARE_UNAVAIL);
    assert.ok(res.error.includes('Physical battery sysfs nodes not present'));
  } finally {
    cleanTestHarness(harness);
  }
});

// ============================================================================
// 4. DETERMINISTIC POLICY GATE ARBITRATION
// ============================================================================

test('Vertical Slice 4: Policy Gate enforces risk levels (READ_ONLY, REVERSIBLE, CONSEQUENTIAL)', () => {
  const harness = createTestHarness();
  try {
    const daemon = new PravahdService({
      dataDir: harness.dataDir,
      sysfsRoot: harness.sysfsRoot
    });

    // 1. READ_ONLY requires no token
    const ro = daemon.verifyCapability('sensors.battery', PravahRisk.READ_ONLY, null);
    assert.equal(ro.status, PravahStatusCode.OK);

    // 2. REVERSIBLE without token fails with ERR_AUTH_REQUIRED
    const revNoToken = daemon.verifyCapability('hardware.display.brightness', PravahRisk.REVERSIBLE, null);
    assert.equal(revNoToken.status, PravahStatusCode.ERR_AUTH_REQUIRED);

    // 3. REVERSIBLE with invalid token format fails with ERR_PERMISSION_DENIED
    const revBadToken = daemon.verifyCapability('hardware.display.brightness', PravahRisk.REVERSIBLE, 'invalid_format_token');
    assert.equal(revBadToken.status, PravahStatusCode.ERR_PERMISSION_DENIED);

    // 4. REVERSIBLE with valid capability token succeeds
    const revGoodToken = daemon.verifyCapability('hardware.display.brightness', PravahRisk.REVERSIBLE, 'cap_display_control_v1');
    assert.equal(revGoodToken.status, PravahStatusCode.OK);

    // 5. CONSEQUENTIAL requires signed user authorization token
    const conCapOnly = daemon.verifyCapability('system.state.write', PravahRisk.CONSEQUENTIAL, 'cap_normal_token');
    assert.equal(conCapOnly.status, PravahStatusCode.ERR_PERMISSION_DENIED);

    const conSigned = daemon.verifyCapability('system.state.write', PravahRisk.CONSEQUENTIAL, 'auth_signed_intent_98a7c2');
    assert.equal(conSigned.status, PravahStatusCode.OK);
  } finally {
    cleanTestHarness(harness);
  }
});

// ============================================================================
// 5. HARDWARE BACKLIGHT OPERATION & ATOMIC CRASH-RESILIENT PERSISTENCE
// ============================================================================

test('Vertical Slice 5: changes hardware brightness, updates sysfs, and atomically persists result', () => {
  const harness = createTestHarness();
  try {
    const daemon = new PravahdService({
      dataDir: harness.dataDir,
      sysfsRoot: harness.sysfsRoot
    });

    // Set brightness to 215 with authorized token
    const res = daemon.setDisplayBrightness(215, 'cap_display_authorized');
    assert.equal(res.status, PravahStatusCode.OK);
    assert.equal(res.currentBrightness, 215);
    assert.equal(res.hardwareUpdated, true);
    assert.equal(res.persisted, true);

    // Verify physical sysfs node was written
    const writtenSysfs = fs.readFileSync(path.join(harness.backlightDir, 'brightness'), 'utf8').trim();
    assert.equal(writtenSysfs, '215');

    // Verify persistent state file exists and has SHA-256 seal
    assert.ok(fs.existsSync(daemon.stateFile));
    const persisted = daemon.getPersistentState('display.brightness');
    assert.equal(persisted.status, PravahStatusCode.OK);
    assert.equal(persisted.value, '215');
  } finally {
    cleanTestHarness(harness);
  }
});

// ============================================================================
// 6. REBOOT RESILIENCE: RECOVERS EXACT STATE AFTER SIMULATED REBOOT
// ============================================================================

test('Vertical Slice 6: state survives cold reboot simulation and recovers without loss', () => {
  const harness = createTestHarness();
  try {
    const daemon1 = new PravahdService({
      dataDir: harness.dataDir,
      sysfsRoot: harness.sysfsRoot
    });

    // Write persistent configuration
    daemon1.setDisplayBrightness(200, 'cap_display');
    daemon1.setPersistentState('network.airgap', 'true', 'auth_signed_root');
    daemon1.setPersistentState('device.chassis', 'pixel7_panther', 'auth_signed_root');

    // Simulate Cold Reboot (daemon process dies and restarts)
    daemon1.stop();

    const daemon2 = new PravahdService({
      dataDir: harness.dataDir,
      sysfsRoot: harness.sysfsRoot
    });
    daemon2.start();

    // Verify all keys recovered from disk
    assert.equal(daemon2.getPersistentState('display.brightness').value, '200');
    assert.equal(daemon2.getPersistentState('network.airgap').value, 'true');
    assert.equal(daemon2.getPersistentState('device.chassis').value, 'pixel7_panther');

    daemon2.stop();
  } finally {
    cleanTestHarness(harness);
  }
});

// ============================================================================
// 7. TAMPER-EVIDENT RECOVERY: CORRUPTED STATE FILE FAILS CLOSED
// ============================================================================

test('Vertical Slice 7: tampered state file fails closed and does not trust modified contents', () => {
  const harness = createTestHarness();
  try {
    const daemon = new PravahdService({
      dataDir: harness.dataDir,
      sysfsRoot: harness.sysfsRoot
    });

    daemon.setPersistentState('security.authority', 'MANAGE', 'auth_signed_root');

    // Attacker modifies persistent state file directly on disk without valid seal
    const raw = JSON.parse(fs.readFileSync(daemon.stateFile, 'utf8'));
    raw.entries[0].value = 'ROOT_COMPROMISED'; // Tamper
    fs.writeFileSync(daemon.stateFile, JSON.stringify(raw));

    // Next boot must detect seal mismatch and throw PRAVAHD_STATE_CORRUPTED
    assert.throws(() => {
      new PravahdService({
        dataDir: harness.dataDir,
        sysfsRoot: harness.sysfsRoot
      });
    }, /PRAVAHD_STATE_CORRUPTED/);
  } finally {
    cleanTestHarness(harness);
  }
});

// ============================================================================
// 8. END-TO-END PRAVAH CLIENT IPC INTEGRATION
// ============================================================================

test('Vertical Slice 8: PravahClient connects to daemon and executes hardware slice end-to-end', async () => {
  const harness = createTestHarness();
  try {
    const daemon = new PravahdService({
      dataDir: harness.dataDir,
      sysfsRoot: harness.sysfsRoot
    });
    daemon.start();

    const client = new PravahClient({ service: daemon, sessionToken: 'cap_session_client_1' });

    // 1. Get Battery Telemetry
    const battery = await client.getBatteryTelemetry();
    assert.equal(battery.percentage, 78);
    assert.equal(battery.status, 'Charging');

    // 2. Set Display Brightness
    const dispRes = await client.setDisplayBrightness(190);
    assert.equal(dispRes.currentBrightness, 190);
    assert.equal(dispRes.hardwareUpdated, true);

    // 3. Query persisted brightness
    const val = await client.queryState('display.brightness');
    assert.equal(val, '190');

    // 4. Unauthorized write without valid session token throws POLICY_ERROR
    client.setSessionToken('bad_token');
    await assert.rejects(async () => {
      await client.setDisplayBrightness(255);
    }, /POLICY_ERROR/);

    daemon.stop();
  } finally {
    cleanTestHarness(harness);
  }
});
