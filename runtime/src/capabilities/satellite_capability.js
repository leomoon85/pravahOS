// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { RiskLevel, AuthorityLevel } from '../types.js';
import {
  SatelliteNtnTransceiver,
  SosPacketCodec,
  EmergencyCategory,
  TriageFlag,
  AirGapSafetyInterlock
} from '../satellite_ntn.js';

export const SatelliteSosDescriptor = Object.freeze({
  id: 'emergency.satellite_sos',
  version: '1.0.0',
  riskLevel: RiskLevel.CONSEQUENTIAL,
  requiredAuthority: AuthorityLevel.EXECUTE,
  isIdempotent: false,
  timeoutMs: 12000,
  metadata: {
    category: 'EMERGENCY',
    description: '3GPP Rel-17 direct-to-satellite emergency SOS subsystem with Air-Gap hardware isolation, LEO constellation tracking, and 128-byte tamper-hashed burst'
  }
});

/**
 * Native Satellite Emergency SOS Capability
 * Coordinates physical air-gap interlock, LEO constellation tracking,
 * link budget calculation, and 128-byte encrypted/hashed burst transmission.
 */
export class SatelliteSosCapability {
  constructor(options = {}) {
    this.descriptor = SatelliteSosDescriptor;
    this.transceiver = options.transceiver || new SatelliteNtnTransceiver();
    this.burstHistory = [];
  }

  /**
   * Execute emergency SOS transmission.
   *
   * @param {Object} inputs
   * @param {string|number} [inputs.category] Emergency category (MEDICAL, LOST_TRAPPED, etc.)
   * @param {string} [inputs.message] SOS text message
   * @param {number} [inputs.latitude] Observer latitude
   * @param {number} [inputs.longitude] Observer longitude
   * @param {number} [inputs.altitude] Observer altitude in meters
   * @param {number} [inputs.batteryPercent] Battery percent
   * @param {string} [inputs.medicalId] Medical ID string
   * @param {number} [inputs.triageFlags] Triage bitfield flags
   * @param {Object} [inputs.deviceAttitude] { heading, pitch, roll }
   * @returns {Promise<Object>} Transmission receipt
   */
  async execute(inputs = {}) {
    // Map category string to enum if provided as string
    let catVal = inputs.category;
    if (typeof catVal === 'string') {
      const upper = catVal.toUpperCase().replace(/[\s/-]+/g, '_');
      if (EmergencyCategory[upper]) {
        catVal = EmergencyCategory[upper];
      } else if (upper.includes('MEDIC')) {
        catVal = EmergencyCategory.MEDICAL;
      } else if (upper.includes('LOST') || upper.includes('TRAP')) {
        catVal = EmergencyCategory.LOST_TRAPPED;
      } else if (upper.includes('VEHICLE') || upper.includes('CRASH')) {
        catVal = EmergencyCategory.VEHICLE_CRASH;
      } else if (upper.includes('FIRE')) {
        catVal = EmergencyCategory.WILDFIRE;
      } else if (upper.includes('WEATHER') || upper.includes('FLOOD')) {
        catVal = EmergencyCategory.SEVERE_WEATHER;
      } else {
        catVal = EmergencyCategory.MEDICAL;
      }
    } else if (typeof catVal !== 'number') {
      catVal = EmergencyCategory.MEDICAL;
    }

    const receipt = await this.transceiver.executeEmergencySosBurst({
      category: catVal,
      message: inputs.message || 'SOS EMERGENCY ASSISTANCE REQUIRED',
      latitude: inputs.latitude,
      longitude: inputs.longitude,
      altitude: inputs.altitude,
      batteryPercent: inputs.batteryPercent,
      medicalId: inputs.medicalId,
      triageFlags: inputs.triageFlags,
      deviceAttitude: inputs.deviceAttitude
    });

    this.burstHistory.push(receipt);

    return {
      status: 'TRANSMITTED',
      receiptId: receipt.ackId,
      satellite: receipt.satellite,
      frequencyHz: receipt.frequencyHz,
      slantRangeKm: receipt.slantRangeKm,
      snrDb: receipt.snrDb,
      linkMarginDb: receipt.linkMarginDb,
      packetTamperHash: receipt.packetTamperHash,
      gatewayRelayConfirmed: receipt.gatewayRelayConfirmed,
      timestamp: receipt.timestamp,
      triage: receipt.triageSummary
    };
  }

  getTransceiver() {
    return this.transceiver;
  }
}
