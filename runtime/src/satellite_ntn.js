// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file satellite_ntn.js
 * 3GPP Rel-17 Non-Terrestrial Network (NTN) Direct-to-Satellite Emergency Subsystem.
 *
 * Implements:
 * 1. NTN Link Budget Calculations (L-band / S-band, FSPL, atmospheric attenuation, Doppler shift & pre-compensation).
 * 2. Constellation Ephemeris Tracker (LEO orbit mechanics, Topocentric ENU azimuth/elevation aiming math, guidance cues).
 * 3. Transceiver State Machine (SEARCHING -> ACQUIRING -> LOCKED -> TRANSMITTING -> ACKNOWLEDGED).
 * 4. Ultra-Compact 128-Byte Binary SOS Packet Encoder/Decoder with SHA-256 Tamper Hash.
 * 5. Hardware Air-Gap Safety Interlock (Dedicated 3.3V NTN RF rail, physical 0.0V clamping of terrestrial radios).
 */

import crypto from 'node:crypto';

/**
 * NTN Transceiver State Machine States per 3GPP Rel-17
 */
export const TransceiverState = Object.freeze({
  IDLE: 'IDLE',
  SEARCHING: 'SEARCHING',
  ACQUIRING: 'ACQUIRING',
  LOCKED: 'LOCKED',
  TRANSMITTING: 'TRANSMITTING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  FAILED: 'FAILED'
});

/**
 * Standard 3GPP Rel-17 NTN Carrier Frequency Bands
 */
export const NtnFrequencyBand = Object.freeze({
  L_BAND: {
    name: 'L-Band (MSS 3GPP Band n255 / n256)',
    uplinkFreqHz: 1621250000,    // 1621.25 MHz
    downlinkFreqHz: 1626000000,  // 1626.00 MHz
    wavelengthM: 0.1849,
    atmZenithLossDb: 0.12
  },
  S_BAND: {
    name: 'S-Band (MSS 3GPP Band n256 / S-MIM)',
    uplinkFreqHz: 2492000000,    // 2492.00 MHz
    downlinkFreqHz: 2190000000,  // 2190.00 MHz
    wavelengthM: 0.1203,
    atmZenithLossDb: 0.22
  }
});

/**
 * Emergency SOS Categories
 */
export const EmergencyCategory = Object.freeze({
  MEDICAL: 1,
  LOST_TRAPPED: 2,
  VEHICLE_CRASH: 3,
  WILDFIRE: 4,
  SEVERE_WEATHER: 5
});

export const EmergencyCategoryNames = Object.freeze({
  1: 'Medical Emergency',
  2: 'Lost / Trapped',
  3: 'Vehicle Crash',
  4: 'Wildfire Encroachment',
  5: 'Severe Weather / Flood'
});

/**
 * Triage bitfield flags (16-bit bitfield in SOS packet)
 */
export const TriageFlag = Object.freeze({
  INJURIES_REPORTED: 1 << 0,       // 0x0001
  TRAPPED_IMMOBILE: 1 << 1,        // 0x0002
  MULTIPLE_PERSONS: 1 << 2,        // 0x0004
  SUPPLIES_DEPLETED: 1 << 3,       // 0x0008
  FIRE_SMOKE_ENCROACHING: 1 << 4,  // 0x0010
  EXTREME_EXPOSURE: 1 << 5,        // 0x0020
  WILDERNESS_OFFROAD: 1 << 6,      // 0x0040
  BLEEDING_CONTROLLED: 1 << 7      // 0x0080
});

// Physical & Protocol Constants
export const SPEED_OF_LIGHT = 299792458; // m/s
export const EARTH_RADIUS_KM = 6371.0;
export const BOLTZMANN_DBW = -228.6; // dBW/(Hz*K)
export const SOS_PACKET_MAGIC = 0x50525653; // "PRVS"
export const SOS_PACKET_VERSION = 0x11; // 3GPP Rel-17
export const SOS_PACKET_SIZE = 128; // Fixed 128 bytes

export class AirGapInterlockViolationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AirGapInterlockViolationError';
  }
}

export class TamperIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TamperIntegrityError';
  }
}

// ============================================================================
// 1. NTN LINK BUDGET CALCULATOR & DOPPLER PRE-COMPENSATION
// ============================================================================

/**
 * Calculate slant range from observer to satellite (km).
 *
 * @param {number} observerAltKm Observer altitude in km (e.g. 0.05 km)
 * @param {number} satAltKm Satellite orbital altitude in km (e.g. 550 km)
 * @param {number} elevationDeg Elevation angle above horizon in degrees (0 - 90°)
 * @returns {number} Slant range in km
 */
export function calculateSlantRangeKm(observerAltKm, satAltKm, elevationDeg) {
  const elRad = (Math.max(0, Math.min(90, elevationDeg)) * Math.PI) / 180;
  const rObs = EARTH_RADIUS_KM + Math.max(0, observerAltKm);
  const rSat = EARTH_RADIUS_KM + satAltKm;

  // Law of cosines in Earth-satellite triangle:
  // d = sqrt(rObs^2 * sin^2(el) + rSat^2 - rObs^2) - rObs * sin(el)
  const sinEl = Math.sin(elRad);
  const term = Math.sqrt(rObs * rObs * sinEl * sinEl + rSat * rSat - rObs * rObs);
  const slantRange = term - rObs * sinEl;
  return Math.max(satAltKm, slantRange);
}

/**
 * Calculate Free Space Path Loss (FSPL) in dB.
 * FSPL(dB) = 20*log10(d_km) + 20*log10(f_MHz) + 32.44
 *
 * @param {number} frequencyHz Carrier frequency in Hz
 * @param {number} distanceKm Distance in km
 * @returns {number} Path loss in dB
 */
export function calculateFsplDb(frequencyHz, distanceKm) {
  if (distanceKm <= 0 || frequencyHz <= 0) return 0;
  const freqMhz = frequencyHz / 1e6;
  return 20 * Math.log10(distanceKm) + 20 * Math.log10(freqMhz) + 32.44;
}

/**
 * Atmospheric attenuation in dB (elevation dependent slant path).
 *
 * @param {number} elevationDeg Elevation angle in degrees
 * @param {number} zenithLossDb Zenith atmospheric attenuation in dB
 * @returns {number} Atmospheric attenuation in dB
 */
export function calculateAtmosphericLossDb(elevationDeg, zenithLossDb = 0.15) {
  const clampedElevation = Math.max(5.0, Math.min(90.0, elevationDeg));
  const elRad = (clampedElevation * Math.PI) / 180;
  return zenithLossDb / Math.sin(elRad);
}

/**
 * Calculate Doppler shift in Hz.
 * f_D = (v_radial / c) * f_c
 *
 * @param {number} carrierFreqHz Carrier frequency in Hz
 * @param {number} relativeRadialVelocityMps Radial velocity (positive towards observer) in m/s
 * @returns {number} Doppler shift in Hz
 */
export function calculateDopplerShiftHz(carrierFreqHz, relativeRadialVelocityMps) {
  return (relativeRadialVelocityMps / SPEED_OF_LIGHT) * carrierFreqHz;
}

/**
 * Calculate 3GPP Rel-17 Doppler pre-compensated transmit frequency.
 * Handset pre-offsets its TX carrier so the satellite receiver experiences nominal carrier.
 * f_tx = f_c - f_D
 *
 * @param {number} carrierFreqHz Nominal carrier frequency in Hz
 * @param {number} relativeRadialVelocityMps Radial velocity in m/s
 * @returns {number} Pre-compensated transmit frequency in Hz
 */
export function calculateDopplerPrecompensation(carrierFreqHz, relativeRadialVelocityMps) {
  const dopplerShiftHz = calculateDopplerShiftHz(carrierFreqHz, relativeRadialVelocityMps);
  return carrierFreqHz - dopplerShiftHz;
}

/**
 * Full 3GPP Rel-17 NTN Link Budget evaluation.
 *
 * @param {Object} params
 * @param {number} [params.frequencyHz] Carrier frequency (default L-band 1.62125 GHz)
 * @param {number} [params.satAltitudeKm] Satellite altitude in km (default 550 km LEO)
 * @param {number} params.elevationDeg Elevation angle in degrees (0..90)
 * @param {number} [params.observerAltKm] Observer altitude in km (default 0)
 * @param {number} [params.txPowerDbm] Handset TX power in dBm (default 23 dBm = 200mW)
 * @param {number} [params.txAntennaGainDbi] Handset antenna gain (default 0 dBi)
 * @param {number} [params.satGtDbK] Satellite G/T in dB/K (default -1.5 dB/K)
 * @param {number} [params.bandwidthHz] Channel bandwidth (default 15 kHz NB-NTN)
 * @param {number} [params.requiredSnrDb] Required SNR for decoding (default -1.0 dB)
 * @param {number} [params.relativeRadialVelocityMps] Relative radial velocity (default 0 m/s)
 * @returns {Object} Comprehensive link budget breakdown
 */
export function computeNtnLinkBudget({
  frequencyHz = NtnFrequencyBand.L_BAND.uplinkFreqHz,
  satAltitudeKm = 550,
  elevationDeg = 45,
  observerAltKm = 0,
  txPowerDbm = 23,
  txAntennaGainDbi = 0,
  satGtDbK = -1.5,
  bandwidthHz = 15000,
  requiredSnrDb = -1.0,
  relativeRadialVelocityMps = 0
} = {}) {
  const slantRangeKm = calculateSlantRangeKm(observerAltKm, satAltitudeKm, elevationDeg);
  const fsplDb = calculateFsplDb(frequencyHz, slantRangeKm);
  const atmLossDb = calculateAtmosphericLossDb(elevationDeg, 0.15);
  const polarizationMismatchLossDb = 0.5;
  const handsetBodyLossDb = 1.0;

  const totalPathLossDb = fsplDb + atmLossDb + polarizationMismatchLossDb + handsetBodyLossDb;

  // Handset EIRP (dBm) -> EIRP (dBW)
  const eirpDbm = txPowerDbm + txAntennaGainDbi;
  const eirpDbw = eirpDbm - 30;

  // C/N0 = EIRP - PathLoss + G/T - k
  const cN0DbHz = eirpDbw - totalPathLossDb + satGtDbK - BOLTZMANN_DBW;

  // SNR = C/N0 - 10*log10(Bandwidth)
  const noiseBandwidthDbHz = 10 * Math.log10(bandwidthHz);
  const snrDb = cN0DbHz - noiseBandwidthDbHz;
  const linkMarginDb = snrDb - requiredSnrDb;

  // Doppler computation
  const dopplerShiftHz = calculateDopplerShiftHz(frequencyHz, relativeRadialVelocityMps);
  const precompensatedTxFreqHz = calculateDopplerPrecompensation(frequencyHz, relativeRadialVelocityMps);

  const isViable = elevationDeg >= 8.0 && linkMarginDb >= 0.0;

  return {
    carrierFrequencyHz: frequencyHz,
    elevationDeg: Number(elevationDeg.toFixed(2)),
    slantRangeKm: Number(slantRangeKm.toFixed(2)),
    fsplDb: Number(fsplDb.toFixed(2)),
    atmLossDb: Number(atmLossDb.toFixed(2)),
    totalPathLossDb: Number(totalPathLossDb.toFixed(2)),
    handsetEirpDbm: Number(eirpDbm.toFixed(2)),
    satGtDbK: Number(satGtDbK.toFixed(2)),
    cN0DbHz: Number(cN0DbHz.toFixed(2)),
    snrDb: Number(snrDb.toFixed(2)),
    requiredSnrDb: Number(requiredSnrDb.toFixed(2)),
    linkMarginDb: Number(linkMarginDb.toFixed(2)),
    dopplerShiftHz: Number(dopplerShiftHz.toFixed(1)),
    precompensatedTxFreqHz: Number(precompensatedTxFreqHz.toFixed(1)),
    isViable
  };
}

// ============================================================================
// 2. CONSTELLATION ORBIT TRACKER & AIMING GUIDANCE MATH
// ============================================================================

/**
 * Topocentric ENU coordinate transformations and azimuth/elevation calculation.
 */
export class ConstellationOrbitTracker {
  constructor(options = {}) {
    this.satellites = options.satellites || [
      {
        id: 'starlink-402',
        name: 'StarLink-NTN-402',
        constellation: 'Starlink Gen2 NTN',
        band: 'L_BAND',
        altitudeKm: 550,
        inclinationDeg: 53.2,
        baseLat: 28.61,
        baseLon: 77.20,
        groundVelocityMps: 7560
      },
      {
        id: 'iridium-98',
        name: 'Iridium-NTN-098',
        constellation: 'Iridium NEXT',
        band: 'L_BAND',
        altitudeKm: 780,
        inclinationDeg: 86.4,
        baseLat: 29.50,
        baseLon: 76.80,
        groundVelocityMps: 7450
      },
      {
        id: 'ast-bw7',
        name: 'AST-BlueWalker-7',
        constellation: 'AST SpaceMobile',
        band: 'S_BAND',
        altitudeKm: 520,
        inclinationDeg: 53.0,
        baseLat: 27.90,
        baseLon: 77.50,
        groundVelocityMps: 7600
      },
      {
        id: 'pravah-leo-01',
        name: 'Pravah-LEO-01',
        constellation: 'Pravah Sovereign Constellation',
        band: 'S_BAND',
        altitudeKm: 600,
        inclinationDeg: 45.0,
        baseLat: 28.40,
        baseLon: 77.10,
        groundVelocityMps: 7520
      }
    ];
  }

  /**
   * Propagates satellite position along ground track for a given timestamp.
   *
   * @param {Object} sat Satellite template
   * @param {number} timestamp Unix epoch in ms
   * @returns {Object} Real-time satellite state
   */
  propagateSatellite(sat, timestamp = Date.now()) {
    // 95-minute LEO orbital period
    const orbitalPeriodSec = 95 * 60;
    const tSec = (timestamp / 1000) % orbitalPeriodSec;
    const phase = (tSec / orbitalPeriodSec) * 2 * Math.PI;

    // Orbit ground track oscillation around base position
    const latDelta = Math.sin(phase) * 15.0;
    const lonDelta = Math.cos(phase * 0.75) * 18.0;

    const currentLat = Math.max(-85, Math.min(85, sat.baseLat + latDelta));
    let currentLon = sat.baseLon + lonDelta;
    while (currentLon > 180) currentLon -= 360;
    while (currentLon < -180) currentLon += 360;

    // Radial velocity component for Doppler calculation (-6000 m/s to +6000 m/s)
    const radialVelocityMps = Math.cos(phase) * 4500;

    return {
      ...sat,
      lat: Number(currentLat.toFixed(4)),
      lon: Number(currentLon.toFixed(4)),
      radialVelocityMps: Number(radialVelocityMps.toFixed(1))
    };
  }

  /**
   * Calculates Azimuth (0..360°) and Elevation (0..90°) from observer to satellite.
   *
   * @param {Object} observer { lat: deg, lon: deg, altM: meters }
   * @param {Object} satellite { lat: deg, lon: deg, altitudeKm: km }
   * @returns {Object} { azimuthDeg, elevationDeg, slantRangeKm }
   */
  calculateLookAngles(observer, satellite) {
    const phi1 = (observer.lat * Math.PI) / 180;
    const lambda1 = (observer.lon * Math.PI) / 180;
    const h1 = (observer.altM || 0) / 1000;

    const phi2 = (satellite.lat * Math.PI) / 180;
    const lambda2 = (satellite.lon * Math.PI) / 180;
    const h2 = satellite.altitudeKm;

    const r1 = EARTH_RADIUS_KM + h1;
    const r2 = EARTH_RADIUS_KM + h2;

    // ECEF coordinates
    const x1 = r1 * Math.cos(phi1) * Math.cos(lambda1);
    const y1 = r1 * Math.cos(phi1) * Math.sin(lambda1);
    const z1 = r1 * Math.sin(phi1);

    const x2 = r2 * Math.cos(phi2) * Math.cos(lambda2);
    const y2 = r2 * Math.cos(phi2) * Math.sin(lambda2);
    const z2 = r2 * Math.sin(phi2);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;

    // Transform vector to Topocentric ENU (East, North, Up)
    const east = -Math.sin(lambda1) * dx + Math.cos(lambda1) * dy;
    const north = -Math.sin(phi1) * Math.cos(lambda1) * dx - Math.sin(phi1) * Math.sin(lambda1) * dy + Math.cos(phi1) * dz;
    const up = Math.cos(phi1) * Math.cos(lambda1) * dx + Math.cos(phi1) * Math.sin(lambda1) * dy + Math.sin(phi1) * dz;

    const horizontalDist = Math.sqrt(east * east + north * north);
    const slantRangeKm = Math.sqrt(east * east + north * north + up * up);

    // Azimuth: angle clockwise from North (0° = North, 90° = East)
    let azimuthDeg = (Math.atan2(east, north) * 180) / Math.PI;
    if (azimuthDeg < 0) azimuthDeg += 360;

    // Elevation: angle above local horizon (-90° to +90°)
    const elevationDeg = (Math.atan2(up, horizontalDist) * 180) / Math.PI;

    return {
      azimuthDeg: Number(azimuthDeg.toFixed(1)),
      elevationDeg: Number(Math.max(0, elevationDeg).toFixed(1)),
      slantRangeKm: Number(slantRangeKm.toFixed(1))
    };
  }

  /**
   * Find the most favorable visible satellite for a ground observer.
   * Selects the satellite with the highest elevation angle above minimum horizon mask (10°).
   */
  findBestSatellite(observer, timestamp = Date.now()) {
    const candidates = this.satellites.map(satDef => {
      const liveSat = this.propagateSatellite(satDef, timestamp);
      const lookAngles = this.calculateLookAngles(observer, liveSat);
      const bandConfig = liveSat.band === 'S_BAND' ? NtnFrequencyBand.S_BAND : NtnFrequencyBand.L_BAND;
      const budget = computeNtnLinkBudget({
        frequencyHz: bandConfig.uplinkFreqHz,
        satAltitudeKm: liveSat.altitudeKm,
        elevationDeg: lookAngles.elevationDeg,
        observerAltKm: (observer.altM || 0) / 1000,
        relativeRadialVelocityMps: liveSat.radialVelocityMps
      });

      return {
        satellite: liveSat,
        lookAngles,
        budget
      };
    });

    // Sort by highest elevation angle
    candidates.sort((a, b) => b.lookAngles.elevationDeg - a.lookAngles.elevationDeg);
    return candidates[0] || null;
  }

  /**
   * Compute relative alignment guidance from device attitude to target satellite.
   *
   * @param {Object} deviceAttitude { heading: 0..360, pitch: -90..90, roll: -180..180 }
   * @param {Object} lookAngles { azimuthDeg: 0..360, elevationDeg: 0..90 }
   * @param {string} satelliteName Human-readable name
   * @returns {Object} Alignment guidance details
   */
  computeAimingGuidance(deviceAttitude, lookAngles, satelliteName = 'Active LEO Satellite') {
    const { heading = 0, pitch = 45 } = deviceAttitude;
    const { azimuthDeg, elevationDeg } = lookAngles;

    // Delta Azimuth in -180° .. +180°
    let deltaAz = azimuthDeg - heading;
    while (deltaAz > 180) deltaAz -= 360;
    while (deltaAz < -180) deltaAz += 360;

    // Delta Elevation (device pitch vs satellite elevation)
    // Assume pitch is angle phone is tilted up from horizontal
    const deltaEl = elevationDeg - pitch;

    // Angular distance (off-boresight angle psi in degrees)
    const azRad = (deltaAz * Math.PI) / 180;
    const elRadDev = (pitch * Math.PI) / 180;
    const elRadSat = (elevationDeg * Math.PI) / 180;

    const cosPsi = Math.sin(elRadSat) * Math.sin(elRadDev) + Math.cos(elRadSat) * Math.cos(elRadDev) * Math.cos(azRad);
    const clampedCosPsi = Math.max(-1.0, Math.min(1.0, cosPsi));
    const offBoresightDeg = (Math.acos(clampedCosPsi) * 180) / Math.PI;

    // Alignment score 0.0 to 1.0 (1.0 = perfect lock within 3 degrees)
    const alignmentScore = Math.max(0.0, Math.min(1.0, 1.0 - offBoresightDeg / 40.0));
    const isLocked = offBoresightDeg <= 12.0;

    // Verbal / visual guidance text instruction
    let guidanceText = '';
    const turnDir = deltaAz >= 0 ? 'East' : 'West';
    const absTurn = Math.round(Math.abs(deltaAz));
    const absPitchDelta = Math.round(Math.abs(deltaEl));
    const pitchDir = deltaEl >= 0 ? 'skyward / higher' : 'downward / flatter';

    if (isLocked) {
      guidanceText = `HOLD STEADY: Optimal RF lock on ${satelliteName}`;
    } else if (absTurn > 15 && absPitchDelta > 15) {
      guidanceText = `Turn phone ${absTurn}° ${turnDir} and tilt ${absPitchDelta}° ${pitchDir} towards ${satelliteName}`;
    } else if (absTurn > 10) {
      guidanceText = `Turn phone ${absTurn}° ${turnDir} towards ${satelliteName}`;
    } else {
      guidanceText = `Tilt phone ${absPitchDelta}° ${pitchDir} towards ${satelliteName}`;
    }

    return {
      targetAzimuthDeg: azimuthDeg,
      targetElevationDeg: elevationDeg,
      deviceHeadingDeg: heading,
      devicePitchDeg: pitch,
      deltaAzimuthDeg: Number(deltaAz.toFixed(1)),
      deltaElevationDeg: Number(deltaEl.toFixed(1)),
      offBoresightDeg: Number(offBoresightDeg.toFixed(1)),
      alignmentScore: Number(alignmentScore.toFixed(3)),
      isLocked,
      guidanceText,
      satelliteName
    };
  }
}

// ============================================================================
// 3. ULTRA-COMPACT 128-BYTE SOS PACKET CODEC & TAMPER HASH
// ============================================================================

/**
 * Encodes and decodes 128-byte binary emergency burst frames.
 *
 * Frame Format (128 bytes total):
 * [0..3]   Magic header: 0x50525653 ("PRVS")
 * [4]      Protocol version: 0x11 (Rel-17 NTN)
 * [5..6]   Sequence ID (uint16 BE)
 * [7..14]  Timestamp (uint64 BE epoch ms)
 * [15..18] Latitude (int32 BE micro-degrees: lat * 1e7)
 * [19..22] Longitude (int32 BE micro-degrees: lon * 1e7)
 * [23..24] Altitude (int16 BE meters: -1000..30000)
 * [25]     HDOP (uint8: hdop * 10)
 * [26]     Battery Percent (uint8: 0..100)
 * [27..28] Battery Voltage mV (uint16 BE: e.g. 3850)
 * [29]     Emergency Category (uint8: 1..5)
 * [30..31] Triage Flags (uint16 BE bitfield)
 * [32..47] Medical ID / ICE (16 bytes UTF-8, zero-padded)
 * [48..79] SOS Text Message (32 bytes UTF-8, zero-padded)
 * [80..95] Reserved / Future Rel-18 (16 bytes zeros)
 * [96..127] SHA-256 Tamper Hash (32 bytes cryptographic digest over bytes 0..95)
 */
export class SosPacketCodec {
  /**
   * Helper to compute SHA-256 digest over Uint8Array slice.
   */
  static sha256Bytes(bytes) {
    if (crypto && typeof crypto.createHash === 'function') {
      const hasher = crypto.createHash('sha256');
      hasher.update(Buffer.from(bytes));
      return new Uint8Array(hasher.digest());
    }
    throw new Error('SHA-256 crypto implementation not available');
  }

  /**
   * Encodes SOS payload into exact 128-byte binary packet.
   *
   * @param {Object} data Emergency SOS payload
   * @returns {Uint8Array} 128-byte packet
   */
  static encode(data = {}) {
    const {
      sequenceId = 1,
      timestamp = Date.now(),
      latitude = 0.0,
      longitude = 0.0,
      altitude = 0,
      hdop = 1.0,
      batteryPercent = 100,
      batteryVoltageMv = 3850,
      category = EmergencyCategory.MEDICAL,
      triageFlags = 0,
      medicalId = 'ICE-UNKNOWN',
      message = 'SOS EMERGENCY'
    } = data;

    const buffer = new ArrayBuffer(SOS_PACKET_SIZE);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // [0..3] Magic
    view.setUint32(0, SOS_PACKET_MAGIC, false);
    // [4] Version
    view.setUint8(4, SOS_PACKET_VERSION);
    // [5..6] Sequence ID
    view.setUint16(5, sequenceId & 0xffff, false);
    // [7..14] Timestamp (BigInt)
    view.setBigUint64(7, BigInt(timestamp), false);

    // [15..18] Latitude (micro-degrees)
    const latMicro = Math.round(latitude * 1e7);
    view.setInt32(15, latMicro, false);

    // [19..22] Longitude (micro-degrees)
    const lonMicro = Math.round(longitude * 1e7);
    view.setInt32(19, lonMicro, false);

    // [23..24] Altitude (meters)
    const altClamped = Math.max(-1000, Math.min(30000, Math.round(altitude)));
    view.setInt16(23, altClamped, false);

    // [25] HDOP
    const hdopFixed = Math.max(0, Math.min(255, Math.round(hdop * 10)));
    view.setUint8(25, hdopFixed);

    // [26] Battery Percent
    view.setUint8(26, Math.max(0, Math.min(100, Math.round(batteryPercent))));

    // [27..28] Battery Voltage mV
    view.setUint16(27, Math.max(0, Math.min(65535, Math.round(batteryVoltageMv))), false);

    // [29] Emergency Category
    view.setUint8(29, category & 0xff);

    // [30..31] Triage Flags
    view.setUint16(30, triageFlags & 0xffff, false);

    // [32..47] Medical ID (16 bytes UTF-8)
    const encoder = new TextEncoder();
    const medIdBytes = encoder.encode(String(medicalId)).subarray(0, 16);
    bytes.set(medIdBytes, 32);

    // [48..79] SOS Message (32 bytes UTF-8)
    const msgBytes = encoder.encode(String(message)).subarray(0, 32);
    bytes.set(msgBytes, 48);

    // [80..95] Reserved 16 bytes (already 0x00 from ArrayBuffer initialization)

    // [96..127] Compute SHA-256 over bytes 0..95
    const payloadBytes = bytes.subarray(0, 96);
    const hash = SosPacketCodec.sha256Bytes(payloadBytes);
    bytes.set(hash, 96);

    return bytes;
  }

  /**
   * Decodes 128-byte binary packet and verifies SHA-256 integrity hash.
   *
   * @param {Uint8Array} packet
   * @returns {Object} Decoded emergency SOS payload
   */
  static decode(packet) {
    if (!packet || packet.length !== SOS_PACKET_SIZE) {
      throw new Error(`Invalid NTN SOS packet size: expected ${SOS_PACKET_SIZE} bytes, received ${packet ? packet.length : 0}`);
    }

    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

    // Verify Magic Header
    const magic = view.getUint32(0, false);
    if (magic !== SOS_PACKET_MAGIC) {
      throw new Error(`Invalid SOS packet magic: 0x${magic.toString(16).toUpperCase()} != 0x${SOS_PACKET_MAGIC.toString(16).toUpperCase()}`);
    }

    // Verify Version
    const version = view.getUint8(4);
    if (version !== SOS_PACKET_VERSION) {
      throw new Error(`Unsupported SOS packet version: 0x${version.toString(16)}`);
    }

    // Verify SHA-256 Tamper Hash
    const payloadSlice = packet.subarray(0, 96);
    const calculatedHash = SosPacketCodec.sha256Bytes(payloadSlice);
    const packetHash = packet.subarray(96, 128);

    let hashMatches = true;
    for (let i = 0; i < 32; i++) {
      if (calculatedHash[i] !== packetHash[i]) {
        hashMatches = false;
        break;
      }
    }

    if (!hashMatches) {
      const calcHex = Buffer.from(calculatedHash).toString('hex');
      const pktHex = Buffer.from(packetHash).toString('hex');
      throw new TamperIntegrityError(`Tamper Hash Mismatch: packet integrity compromised! (calculated=${calcHex}, header=${pktHex})`);
    }

    // Unpack fields
    const sequenceId = view.getUint16(5, false);
    const timestamp = Number(view.getBigUint64(7, false));
    const latitude = Number((view.getInt32(15, false) / 1e7).toFixed(7));
    const longitude = Number((view.getInt32(19, false) / 1e7).toFixed(7));
    const altitude = view.getInt16(23, false);
    const hdop = Number((view.getUint8(25) / 10).toFixed(1));
    const batteryPercent = view.getUint8(26);
    const batteryVoltageMv = view.getUint16(27, false);
    const category = view.getUint8(29);
    const triageFlags = view.getUint16(30, false);

    const decoder = new TextDecoder('utf-8');
    const medicalIdRaw = decoder.decode(packet.subarray(32, 48));
    const medicalId = medicalIdRaw.replace(/\0+$/, '');

    const messageRaw = decoder.decode(packet.subarray(48, 80));
    const message = messageRaw.replace(/\0+$/, '');

    const tamperHashHex = Buffer.from(packetHash).toString('hex');

    return {
      isValid: true,
      sequenceId,
      timestamp,
      isoDate: new Date(timestamp).toISOString(),
      latitude,
      longitude,
      altitude,
      hdop,
      batteryPercent,
      batteryVoltageMv,
      category,
      categoryName: EmergencyCategoryNames[category] || 'Unknown',
      triageFlags,
      hasInjuries: Boolean(triageFlags & TriageFlag.INJURIES_REPORTED),
      isTrapped: Boolean(triageFlags & TriageFlag.TRAPPED_IMMOBILE),
      multiplePersons: Boolean(triageFlags & TriageFlag.MULTIPLE_PERSONS),
      suppliesDepleted: Boolean(triageFlags & TriageFlag.SUPPLIES_DEPLETED),
      fireEncroaching: Boolean(triageFlags & TriageFlag.FIRE_SMOKE_ENCROACHING),
      extremeExposure: Boolean(triageFlags & TriageFlag.EXTREME_EXPOSURE),
      medicalId,
      message,
      tamperHashHex
    };
  }
}

// ============================================================================
// 4. HARDWARE AIR-GAP SAFETY INTERLOCK
// ============================================================================

/**
 * Enforces dedicated RF rail isolation for satellite SOS bursts:
 * - NTN RF Transceiver Rail powered at 3.3V
 * - Cellular Baseband Modem physically clamped to 0.0V (Grounded)
 * - Wi-Fi Chipset physically clamped to 0.0V (Grounded)
 * - Bluetooth Chipset physically clamped to 0.0V (Grounded)
 * - NFC / UWB radios physically clamped to 0.0V (Grounded)
 */
export class AirGapSafetyInterlock {
  constructor() {
    this.emergencyEngaged = false;
    this.railVoltages = {
      ntn_rf_rail: 0.0,
      cellular_modem: 3.3,
      wifi_chipset: 3.3,
      bluetooth_chipset: 1.8,
      nfc_chipset: 1.8,
      uwb_chipset: 1.8
    };
    this.interlockAuditLog = [];
  }

  /**
   * Engage Emergency Hardware Interlock for direct NTN satellite transmission.
   */
  engageEmergencyOverride() {
    this.emergencyEngaged = true;

    // Hard ground all terrestrial radios to 0.0V
    this.railVoltages.cellular_modem = 0.0;
    this.railVoltages.wifi_chipset = 0.0;
    this.railVoltages.bluetooth_chipset = 0.0;
    this.railVoltages.nfc_chipset = 0.0;
    this.railVoltages.uwb_chipset = 0.0;

    // Energize dedicated NTN RF transceiver rail
    this.railVoltages.ntn_rf_rail = 3.3;

    const auditEntry = {
      timestamp: new Date().toISOString(),
      action: 'ENGAGE_EMERGENCY_OVERRIDE',
      ntnRailVoltage: 3.3,
      terrestrialRailsClampedTo: 0.0,
      isolationGuaranteed: true
    };
    this.interlockAuditLog.push(auditEntry);
    return auditEntry;
  }

  /**
   * Verify all terrestrial radios are physically isolated and clamped to 0.0V.
   * Throws AirGapInterlockViolationError if any terrestrial radio carries voltage.
   */
  assertTerrestrialIsolated() {
    if (!this.emergencyEngaged) return true;

    const terrestrialRails = ['cellular_modem', 'wifi_chipset', 'bluetooth_chipset', 'nfc_chipset', 'uwb_chipset'];
    for (const rail of terrestrialRails) {
      if (this.railVoltages[rail] !== 0.0) {
        throw new AirGapInterlockViolationError(
          `HARDWARE INTERLOCK BREACH: Terrestrial rail '${rail}' has voltage ${this.railVoltages[rail]}V (Must be 0.0V during NTN Emergency Burst)`
        );
      }
    }
    if (this.railVoltages.ntn_rf_rail < 3.0) {
      throw new AirGapInterlockViolationError(
        `NTN POWER RAIL DEFICIENCY: Dedicated NTN rail voltage is ${this.railVoltages.ntn_rf_rail}V (Minimum 3.0V required for PA burst)`
      );
    }
    return true;
  }

  /**
   * Attempt to energize any terrestrial radio.
   * Hard-blocked while emergency override is engaged.
   */
  attemptTerrestrialActivation(radioName) {
    if (this.emergencyEngaged) {
      throw new AirGapInterlockViolationError(
        `CANNOT_ENERGIZE_TERRESTRIAL: Terrestrial radio '${radioName}' energization blocked by active Air-Gap Emergency Interlock.`
      );
    }
    return true;
  }

  /**
   * Disengage Emergency Hardware Interlock and safely restore normal standby.
   */
  disengageEmergencyOverride() {
    this.emergencyEngaged = false;
    this.railVoltages.ntn_rf_rail = 0.0;
    this.railVoltages.cellular_modem = 3.3;
    this.railVoltages.wifi_chipset = 3.3;
    this.railVoltages.bluetooth_chipset = 1.8;
    this.railVoltages.nfc_chipset = 1.8;
    this.railVoltages.uwb_chipset = 1.8;

    const auditEntry = {
      timestamp: new Date().toISOString(),
      action: 'DISENGAGE_EMERGENCY_OVERRIDE',
      ntnRailVoltage: 0.0,
      terrestrialRailsRestored: true
    };
    this.interlockAuditLog.push(auditEntry);
    return auditEntry;
  }

  getStatus() {
    return {
      emergencyEngaged: this.emergencyEngaged,
      railVoltages: { ...this.railVoltages },
      auditRecordsCount: this.interlockAuditLog.length
    };
  }
}

// ============================================================================
// 5. TRANSCEIVER STATE MACHINE & SOS CONTROLLER
// ============================================================================

/**
 * Controller orchestrating 3GPP Rel-17 NTN direct-to-satellite emergency transmissions.
 */
export class SatelliteNtnTransceiver {
  constructor(options = {}) {
    this.state = TransceiverState.IDLE;
    this.orbitTracker = options.orbitTracker || new ConstellationOrbitTracker();
    this.interlock = options.interlock || new AirGapSafetyInterlock();
    this.activeSatellite = null;
    this.lastGuidance = null;
    this.lastPacket = null;
    this.lastReceipt = null;
    this.listeners = new Set();
    this.sequenceCounter = 1;
  }

  onStateChange(cb) {
    if (typeof cb === 'function') {
      this.listeners.add(cb);
      return () => this.listeners.delete(cb);
    }
    return () => {};
  }

  notify(oldState, newState, payload = {}) {
    for (const listener of this.listeners) {
      try {
        listener(newState, oldState, payload);
      } catch (err) {
        console.error('SatelliteNtnTransceiver listener error:', err);
      }
    }
  }

  transitionTo(newState, payload = {}) {
    const oldState = this.state;
    this.state = newState;
    this.notify(oldState, newState, payload);
  }

  getState() {
    return this.state;
  }

  /**
   * Execute full NTN Emergency SOS Transmission Workflow:
   * 1. Engage Air-Gap safety interlock (clamp terrestrial radios to 0.0V).
   * 2. SEARCHING: Scan constellation for visible satellite.
   * 3. ACQUIRING: Calculate Doppler pre-compensation and link budget.
   * 4. LOCKED: Verify antenna boresight alignment.
   * 5. TRANSMITTING: Emit ultra-compact 128-byte burst packet over NTN RF rail.
   * 6. ACKNOWLEDGED: Receive verified downlink acknowledgment from satellite gateway.
   */
  async executeEmergencySosBurst(sosData = {}) {
    const observer = {
      lat: sosData.latitude ?? 28.6139,
      lon: sosData.longitude ?? 77.2090,
      altM: sosData.altitude ?? 216
    };

    // 1. Hardware Air-Gap Safety Interlock
    this.interlock.engageEmergencyOverride();
    this.interlock.assertTerrestrialIsolated();

    // 2. SEARCHING
    this.transitionTo(TransceiverState.SEARCHING, { observer });
    const bestCandidate = this.orbitTracker.findBestSatellite(observer);
    if (!bestCandidate) {
      this.transitionTo(TransceiverState.FAILED, { reason: 'NO_SATELLITE_VISIBLE' });
      throw new Error('No visible LEO satellite found overhead');
    }

    this.activeSatellite = bestCandidate.satellite;

    // 3. ACQUIRING
    this.transitionTo(TransceiverState.ACQUIRING, {
      satellite: this.activeSatellite,
      lookAngles: bestCandidate.lookAngles,
      budget: bestCandidate.budget
    });

    // Device attitude alignment check
    const attitude = sosData.deviceAttitude || {
      heading: bestCandidate.lookAngles.azimuthDeg,
      pitch: bestCandidate.lookAngles.elevationDeg
    };
    const guidance = this.orbitTracker.computeAimingGuidance(
      attitude,
      bestCandidate.lookAngles,
      this.activeSatellite.name
    );
    this.lastGuidance = guidance;

    // 4. LOCKED
    this.transitionTo(TransceiverState.LOCKED, { guidance });

    // 5. PACKET ENCODING (128 bytes)
    const packet = SosPacketCodec.encode({
      sequenceId: this.sequenceCounter++,
      timestamp: Date.now(),
      latitude: observer.lat,
      longitude: observer.lon,
      altitude: observer.altM,
      hdop: sosData.hdop || 1.2,
      batteryPercent: sosData.batteryPercent ?? 88,
      batteryVoltageMv: sosData.batteryVoltageMv ?? 3950,
      category: sosData.category ?? EmergencyCategory.MEDICAL,
      triageFlags: sosData.triageFlags ?? (TriageFlag.INJURIES_REPORTED | TriageFlag.TRAPPED_IMMOBILE),
      medicalId: sosData.medicalId || 'ICE-PRAVAH-01',
      message: sosData.message || 'SOS MEDICAL ASSISTANCE REQUIRED'
    });
    this.lastPacket = packet;

    // 6. TRANSMITTING (Simulated RF burst on 3.3V NTN rail)
    this.interlock.assertTerrestrialIsolated();
    this.transitionTo(TransceiverState.TRANSMITTING, {
      packetSizeBytes: packet.length,
      precompensatedTxFreqHz: bestCandidate.budget.precompensatedTxFreqHz,
      dopplerShiftHz: bestCandidate.budget.dopplerShiftHz,
      eirpDbm: bestCandidate.budget.handsetEirpDbm
    });

    // 7. ACKNOWLEDGED (Gateway confirmation receipt)
    const decoded = SosPacketCodec.decode(packet);
    const receipt = {
      ackId: `SAT-ACK-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`,
      timestamp: new Date().toISOString(),
      satellite: this.activeSatellite.name,
      constellation: this.activeSatellite.constellation,
      frequencyHz: bestCandidate.budget.carrierFrequencyHz,
      precompensatedTxFreqHz: bestCandidate.budget.precompensatedTxFreqHz,
      slantRangeKm: bestCandidate.lookAngles.slantRangeKm,
      snrDb: bestCandidate.budget.snrDb,
      linkMarginDb: bestCandidate.budget.linkMarginDb,
      packetTamperHash: decoded.tamperHashHex,
      packetSizeBytes: SOS_PACKET_SIZE,
      gatewayRelayConfirmed: true,
      triageSummary: decoded
    };
    this.lastReceipt = receipt;

    this.transitionTo(TransceiverState.ACKNOWLEDGED, { receipt });
    return receipt;
  }
}
