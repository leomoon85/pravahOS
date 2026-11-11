// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { CameraCapability, CameraCapabilityDescriptor } from './capabilities/camera_capability.js';
import { NotesCapability, NotesCapabilityDescriptor } from './capabilities/notes_capability.js';
import { WalletCapability, WalletCapabilityDescriptor } from './capabilities/wallet_capability.js';
import { SatelliteSosCapability, SatelliteSosDescriptor } from './capabilities/satellite_capability.js';
import { RiskLevel, AuthorityLevel } from './types.js';

export * from './capabilities/index.js';

/**
 * Standard PravahOS Capability Registry Map
 * Provides direct key-based lookup by capability ID.
 */
export const CapabilitiesMap = {
  'media.camera.capture': {
    descriptor: CameraCapabilityDescriptor,
    implementation: new CameraCapability()
  },
  'notes.smart.create': {
    descriptor: NotesCapabilityDescriptor,
    implementation: new NotesCapability()
  },
  'crypto.wallet.transact': {
    descriptor: WalletCapabilityDescriptor,
    implementation: new WalletCapability()
  },
  'emergency.satellite_sos': {
    descriptor: SatelliteSosDescriptor,
    implementation: new SatelliteSosCapability()
  }
};

export const SatelliteSos = CapabilitiesMap['emergency.satellite_sos'];

export default CapabilitiesMap;
