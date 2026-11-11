// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TransceiverState,
  NtnFrequencyBand,
  EmergencyCategory,
  EmergencyCategoryNames,
  TriageFlag,
  SPEED_OF_LIGHT,
  EARTH_RADIUS_KM,
  SOS_PACKET_MAGIC,
  SOS_PACKET_VERSION,
  SOS_PACKET_SIZE,
  AirGapInterlockViolationError,
  TamperIntegrityError,
  calculateSlantRangeKm,
  calculateFsplDb,
  calculateAtmosphericLossDb,
  calculateDopplerShiftHz,
  calculateDopplerPrecompensation,
  computeNtnLinkBudget,
  ConstellationOrbitTracker,
  SosPacketCodec,
  AirGapSafetyInterlock,
  SatelliteNtnTransceiver
} from '../src/satellite_ntn.js';

import {
  SatelliteSosCapability,
  SatelliteSosDescriptor
} from '../src/capabilities/satellite_capability.js';

import { CapabilitiesMap } from '../src/capabilities.js';
import { CoreCapabilities } from '../src/mock_capabilities.js';
import { RiskLevel, AuthorityLevel } from '../src/types.js';

describe('3GPP Rel-17 NTN Direct-to-Satellite Emergency Subsystem', () => {

  // ==========================================================================
  // 1. LINK BUDGET CALCULATIONS & DOPPLER PRE-COMPENSATION
  // ==========================================================================
  describe('NTN Link Budget & Doppler Physics', () => {
    it('calculates slant range correctly from zenith (90°) to horizon mask (10°)', () => {
      const satAlt = 550; // km
      const observerAlt = 0; // km

      // At zenith (90°), slant range must equal orbital altitude
      const zenithRange = calculateSlantRangeKm(observerAlt, satAlt, 90);
      assert.ok(Math.abs(zenithRange - satAlt) < 0.01, `Zenith range (${zenithRange}) should equal altitude (${satAlt})`);

      // At 45° elevation
      const range45 = calculateSlantRangeKm(observerAlt, satAlt, 45);
      assert.ok(range45 > zenithRange, 'Slant range at 45° must exceed zenith range');
      assert.ok(range45 < 850, `Slant range at 45° should be ~750km, got ${range45}`);

      // At 10° elevation (near horizon)
      const range10 = calculateSlantRangeKm(observerAlt, satAlt, 10);
      assert.ok(range10 > range45, 'Slant range at 10° must exceed 45° range');
      assert.ok(range10 > 1500 && range10 < 2000, `Slant range at 10° should be ~1750km, got ${range10}`);
    });

    it('calculates Free Space Path Loss (FSPL) per standard Friis formula', () => {
      const freqHz = 1621250000; // 1.62125 GHz (L-band)
      const distanceKm = 1000;

      // FSPL(dB) = 20*log10(1000) + 20*log10(1621.25) + 32.44
      // = 60 + 64.197 + 32.44 = 156.637 dB
      const fspl = calculateFsplDb(freqHz, distanceKm);
      assert.ok(Math.abs(fspl - 156.64) < 0.2, `Expected FSPL ~156.64 dB, got ${fspl}`);
    });

    it('computes elevation-dependent atmospheric attenuation', () => {
      const lossZenith = calculateAtmosphericLossDb(90, 0.15);
      const loss45 = calculateAtmosphericLossDb(45, 0.15);
      const loss10 = calculateAtmosphericLossDb(10, 0.15);

      assert.ok(Math.abs(lossZenith - 0.15) < 0.01, 'Zenith loss should match base loss');
      assert.ok(loss45 > lossZenith, '45° loss must exceed zenith loss');
      assert.ok(loss10 > loss45, '10° loss must exceed 45° loss');
      assert.ok(loss10 < 1.5, `10° loss should be reasonable (<1.5 dB), got ${loss10}`);
    });

    it('calculates Doppler shift and 3GPP Rel-17 pre-compensation', () => {
      const freqHz = 1621250000; // L-band
      const vRadialMps = 4500; // satellite approaching at 4.5 km/s

      // f_D = (4500 / 299792458) * 1.62125e9 = +24335.5 Hz
      const dopplerShift = calculateDopplerShiftHz(freqHz, vRadialMps);
      assert.ok(Math.abs(dopplerShift - 24335.5) < 5.0, `Expected ~24335.5 Hz, got ${dopplerShift}`);

      // Handset pre-compensation: f_tx = f_c - f_D
      const precompensated = calculateDopplerPrecompensation(freqHz, vRadialMps);
      assert.equal(precompensated, freqHz - dopplerShift);
      assert.ok(precompensated < freqHz, 'Approaching satellite mandates lower transmit frequency');
    });

    it('evaluates comprehensive link budget telemetry and determines viability', () => {
      // Favorable pass at 50° elevation
      const goodBudget = computeNtnLinkBudget({
        frequencyHz: NtnFrequencyBand.L_BAND.uplinkFreqHz,
        satAltitudeKm: 550,
        elevationDeg: 50,
        txPowerDbm: 23, // 200mW standard phone PA
        txAntennaGainDbi: 0,
        satGtDbK: -1.5,
        bandwidthHz: 15000,
        requiredSnrDb: -1.0,
        relativeRadialVelocityMps: 2000
      });

      assert.ok(goodBudget.slantRangeKm > 550 && goodBudget.slantRangeKm < 800);
      assert.ok(goodBudget.fsplDb > 150 && goodBudget.fsplDb < 160);
      assert.ok(goodBudget.linkMarginDb > 0, `Link margin should be positive, got ${goodBudget.linkMarginDb}`);
      assert.equal(goodBudget.isViable, true);

      // Low elevation pass at 4° (below 8° horizon mask)
      const poorBudget = computeNtnLinkBudget({
        elevationDeg: 4,
        satAltitudeKm: 550
      });
      assert.equal(poorBudget.isViable, false, 'Elevation below 8° must be deemed non-viable');
    });
  });

  // ==========================================================================
  // 2. CONSTELLATION ORBIT TRACKER & AIMING MATH
  // ==========================================================================
  describe('Constellation Ephemeris Tracker & Aiming Guidance', () => {
    it('calculates Topocentric ENU azimuth and elevation from ground observer', () => {
      const tracker = new ConstellationOrbitTracker();
      const observer = { lat: 28.6139, lon: 77.2090, altM: 216 }; // New Delhi
      const satellite = { lat: 28.6139, lon: 77.2090, altitudeKm: 550 }; // Directly overhead

      const look = tracker.calculateLookAngles(observer, satellite);
      assert.ok(Math.abs(look.elevationDeg - 90.0) < 0.5, `Directly overhead satellite should have ~90° elevation, got ${look.elevationDeg}`);
      assert.ok(Math.abs(look.slantRangeKm - 550.0) < 1.0, `Slant range should equal ~550km, got ${look.slantRangeKm}`);
    });

    it('finds best visible satellite from constellation based on elevation', () => {
      const tracker = new ConstellationOrbitTracker();
      const observer = { lat: 28.61, lon: 77.20, altM: 100 };
      const best = tracker.findBestSatellite(observer, Date.now());

      assert.ok(best !== null, 'Must locate at least one satellite');
      assert.ok(best.satellite.name, 'Candidate must have satellite name');
      assert.ok(best.lookAngles.elevationDeg >= 0, 'Elevation must be non-negative');
      assert.ok(best.budget, 'Must compute link budget for candidate');
    });

    it('computes relative aiming guidance, off-boresight angle, and verbal cues', () => {
      const tracker = new ConstellationOrbitTracker();
      const satAngles = { azimuthDeg: 90.0, elevationDeg: 60.0 }; // Target: East at 60°
      const satName = 'StarLink-NTN-402';

      // Case A: Device pointing North (0°) with 30° tilt (Off by 90° azimuth)
      const attitudeA = { heading: 0.0, pitch: 30.0 };
      const guidanceA = tracker.computeAimingGuidance(attitudeA, satAngles, satName);

      assert.equal(guidanceA.isLocked, false);
      assert.ok(guidanceA.offBoresightDeg > 40, 'Off-boresight angle should be large');
      assert.ok(guidanceA.guidanceText.includes('East'), `Guidance should instruct turn East, got: ${guidanceA.guidanceText}`);
      assert.ok(guidanceA.guidanceText.includes('StarLink-NTN-402'));

      // Case B: Device aligned closely (Heading 88°, Pitch 58° -> Off by ~2.8°)
      const attitudeB = { heading: 88.0, pitch: 58.0 };
      const guidanceB = tracker.computeAimingGuidance(attitudeB, satAngles, satName);

      assert.equal(guidanceB.isLocked, true, 'Off-boresight < 12° must be locked');
      assert.ok(guidanceB.alignmentScore >= 0.9, `Alignment score should be high, got ${guidanceB.alignmentScore}`);
      assert.ok(guidanceB.guidanceText.includes('HOLD STEADY'), `Guidance should say HOLD STEADY, got: ${guidanceB.guidanceText}`);
    });
  });

  // ==========================================================================
  // 3. ULTRA-COMPACT 128-BYTE SOS PACKET CODEC & TAMPER HASH
  // ==========================================================================
  describe('128-Byte Binary SOS Packet Codec & Integrity', () => {
    it('encodes and decodes exactly 128 bytes with micro-degree coordinate fidelity', () => {
      const originalPayload = {
        sequenceId: 42,
        timestamp: 1731369600000,
        latitude: 28.6139391,
        longitude: 77.2090212,
        altitude: 450,
        hdop: 1.2,
        batteryPercent: 88,
        batteryVoltageMv: 3940,
        category: EmergencyCategory.LOST_TRAPPED,
        triageFlags: TriageFlag.TRAPPED_IMMOBILE | TriageFlag.SUPPLIES_DEPLETED,
        medicalId: 'ICE-ALICE-O-POS',
        message: 'LOST IN MOUNTAIN PASS NO WATER'
      };

      const packet = SosPacketCodec.encode(originalPayload);

      // Verify exact 128 bytes
      assert.equal(packet.length, SOS_PACKET_SIZE, `Packet size must be exactly ${SOS_PACKET_SIZE} bytes`);

      // Decode and verify all fields
      const decoded = SosPacketCodec.decode(packet);
      assert.equal(decoded.isValid, true);
      assert.equal(decoded.sequenceId, 42);
      assert.equal(decoded.timestamp, 1731369600000);
      assert.ok(Math.abs(decoded.latitude - 28.6139391) < 1e-6, 'Latitude precision preserved within micro-degrees');
      assert.ok(Math.abs(decoded.longitude - 77.2090212) < 1e-6, 'Longitude precision preserved within micro-degrees');
      assert.equal(decoded.altitude, 450);
      assert.equal(decoded.hdop, 1.2);
      assert.equal(decoded.batteryPercent, 88);
      assert.equal(decoded.batteryVoltageMv, 3940);
      assert.equal(decoded.category, EmergencyCategory.LOST_TRAPPED);
      assert.equal(decoded.isTrapped, true);
      assert.equal(decoded.suppliesDepleted, true);
      assert.equal(decoded.hasInjuries, false);
      assert.equal(decoded.medicalId, 'ICE-ALICE-O-POS');
      assert.equal(decoded.message, 'LOST IN MOUNTAIN PASS NO WATER');
      assert.equal(decoded.tamperHashHex.length, 64, 'Tamper hash must be 64-char hex (32 bytes SHA-256)');
    });

    it('verifies magic header PRVS and Rel-17 version 0x11', () => {
      const packet = SosPacketCodec.encode();
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

      assert.equal(view.getUint32(0, false), SOS_PACKET_MAGIC);
      assert.equal(view.getUint8(4), SOS_PACKET_VERSION);
    });

    it('detects tampering and throws TamperIntegrityError on corrupted bits', () => {
      const packet = SosPacketCodec.encode({
        latitude: 12.9716,
        longitude: 77.5946,
        message: 'GENUINE SOS PACKET'
      });

      // Packet is valid initially
      const decoded = SosPacketCodec.decode(packet);
      assert.equal(decoded.isValid, true);

      // Corrupt a single bit in the message payload (byte 50)
      const tamperedPacket = new Uint8Array(packet);
      tamperedPacket[50] ^= 0x01; // flip 1 bit

      assert.throws(() => {
        SosPacketCodec.decode(tamperedPacket);
      }, TamperIntegrityError, 'Corrupted packet must fail SHA-256 validation');
    });

    it('rejects invalid buffer sizes or bad magic headers', () => {
      assert.throws(() => {
        SosPacketCodec.decode(new Uint8Array(64));
      }, /Invalid NTN SOS packet size/);

      const badMagicPacket = SosPacketCodec.encode();
      badMagicPacket[0] = 0x00; // corrupt magic
      assert.throws(() => {
        SosPacketCodec.decode(badMagicPacket);
      }, /Invalid SOS packet magic/);
    });
  });

  // ==========================================================================
  // 4. HARDWARE AIR-GAP SAFETY INTERLOCK
  // ==========================================================================
  describe('Hardware Air-Gap Safety Interlock Invariants', () => {
    it('grounds terrestrial radios to 0.0V and powers NTN RF rail to 3.3V', () => {
      const interlock = new AirGapSafetyInterlock();

      // Normal state: terrestrial powered, NTN rail off
      assert.equal(interlock.railVoltages.ntn_rf_rail, 0.0);
      assert.equal(interlock.railVoltages.cellular_modem, 3.3);
      assert.equal(interlock.railVoltages.wifi_chipset, 3.3);
      assert.equal(interlock.railVoltages.bluetooth_chipset, 1.8);

      // Engage Emergency Override
      interlock.engageEmergencyOverride();

      // Invariants: Dedicated NTN rail 3.3V, all terrestrial 0.0V
      assert.equal(interlock.railVoltages.ntn_rf_rail, 3.3);
      assert.equal(interlock.railVoltages.cellular_modem, 0.0);
      assert.equal(interlock.railVoltages.wifi_chipset, 0.0);
      assert.equal(interlock.railVoltages.bluetooth_chipset, 0.0);
      assert.equal(interlock.railVoltages.nfc_chipset, 0.0);
      assert.equal(interlock.railVoltages.uwb_chipset, 0.0);

      // Isolation assertion must pass
      assert.doesNotThrow(() => interlock.assertTerrestrialIsolated());
    });

    it('throws AirGapInterlockViolationError if terrestrial radio energization is attempted during burst', () => {
      const interlock = new AirGapSafetyInterlock();
      interlock.engageEmergencyOverride();

      assert.throws(() => {
        interlock.attemptTerrestrialActivation('cellular_modem');
      }, AirGapInterlockViolationError, 'Energizing cellular modem during NTN burst must be hard-blocked');

      assert.throws(() => {
        interlock.attemptTerrestrialActivation('wifi_chipset');
      }, AirGapInterlockViolationError, 'Energizing Wi-Fi during NTN burst must be hard-blocked');
    });

    it('detects rail voltage breach during transmission', () => {
      const interlock = new AirGapSafetyInterlock();
      interlock.engageEmergencyOverride();

      // Simulate hardware fault / leakage on wifi chipset
      interlock.railVoltages.wifi_chipset = 0.8;

      assert.throws(() => {
        interlock.assertTerrestrialIsolated();
      }, AirGapInterlockViolationError, 'Terrestrial voltage > 0.0V must trigger hardware interlock breach');
    });

    it('safely restores normal standby upon disengaging emergency override', () => {
      const interlock = new AirGapSafetyInterlock();
      interlock.engageEmergencyOverride();
      interlock.disengageEmergencyOverride();

      assert.equal(interlock.railVoltages.ntn_rf_rail, 0.0);
      assert.equal(interlock.railVoltages.cellular_modem, 3.3);
      assert.equal(interlock.railVoltages.wifi_chipset, 3.3);
      assert.doesNotThrow(() => interlock.attemptTerrestrialActivation('wifi_chipset'));
    });
  });

  // ==========================================================================
  // 5. TRANSCEIVER STATE MACHINE & END-TO-END BURST WORKFLOW
  // ==========================================================================
  describe('Transceiver State Machine & Emergency Workflow', () => {
    it('executes full state transitions: SEARCHING -> ACQUIRING -> LOCKED -> TRANSMITTING -> ACKNOWLEDGED', async () => {
      const transceiver = new SatelliteNtnTransceiver();
      const recordedStates = [];

      transceiver.onStateChange((newState) => {
        recordedStates.push(newState);
      });

      const receipt = await transceiver.executeEmergencySosBurst({
        latitude: 28.6139,
        longitude: 77.2090,
        altitude: 216,
        category: EmergencyCategory.MEDICAL,
        message: 'TEST MEDICAL EMERGENCY DISPATCH'
      });

      assert.deepEqual(recordedStates, [
        TransceiverState.SEARCHING,
        TransceiverState.ACQUIRING,
        TransceiverState.LOCKED,
        TransceiverState.TRANSMITTING,
        TransceiverState.ACKNOWLEDGED
      ]);

      assert.ok(receipt.ackId.startsWith('SAT-ACK-'), 'Receipt must contain valid Gateway ACK ID');
      assert.ok(receipt.satellite, 'Receipt must name relay satellite');
      assert.ok(receipt.packetTamperHash, 'Receipt must record packet SHA-256 tamper hash');
      assert.equal(receipt.gatewayRelayConfirmed, true);
      assert.equal(receipt.packetSizeBytes, 128);
    });
  });

  // ==========================================================================
  // 6. CAPABILITY INTEGRATION (emergency.satellite_sos)
  // ==========================================================================
  describe('PravahOS Capability Registry Integration', () => {
    it('verifies descriptor defines CONSEQUENTIAL risk and EXECUTE authority', () => {
      assert.equal(SatelliteSosDescriptor.id, 'emergency.satellite_sos');
      assert.equal(SatelliteSosDescriptor.riskLevel, RiskLevel.CONSEQUENTIAL);
      assert.equal(SatelliteSosDescriptor.requiredAuthority, AuthorityLevel.EXECUTE);
      assert.equal(SatelliteSosDescriptor.isIdempotent, false);
    });

    it('resolves emergency.satellite_sos capability from CapabilitiesMap and CoreCapabilities', () => {
      const fromMap = CapabilitiesMap['emergency.satellite_sos'];
      assert.ok(fromMap, 'Must be registered in CapabilitiesMap');
      assert.equal(fromMap.descriptor.id, 'emergency.satellite_sos');

      const fromCore = CoreCapabilities['emergency.satellite_sos'];
      assert.ok(fromCore, 'Must be registered in CoreCapabilities under emergency.satellite_sos');

      const coreByName = CoreCapabilities.SatelliteSos;
      assert.ok(coreByName, 'Must be registered in CoreCapabilities as SatelliteSos');
    });

    it('executes emergency.satellite_sos capability end-to-end and returns structured receipt', async () => {
      const capability = new SatelliteSosCapability();

      const result = await capability.execute({
        category: 'MEDICAL',
        message: 'AIRLIFT REQUIRED PATIENT UNCONSCIOUS',
        latitude: 34.0522,
        longitude: -118.2437,
        altitude: 85,
        batteryPercent: 92,
        medicalId: 'ICE: Bob Type A-'
      });

      assert.equal(result.status, 'TRANSMITTED');
      assert.ok(result.receiptId.startsWith('SAT-ACK-'));
      assert.ok(result.satellite);
      assert.ok(result.packetTamperHash);
      assert.equal(result.gatewayRelayConfirmed, true);
      assert.equal(result.triage.category, EmergencyCategory.MEDICAL);
      assert.equal(result.triage.medicalId, 'ICE: Bob Type A-');
      assert.equal(result.triage.message, 'AIRLIFT REQUIRED PATIENT UNCONSC');
    });
  });
});
