// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { RiskLevel, AuthorityLevel } from './types.js';
import { CameraCapability, CameraCapabilityDescriptor } from './capabilities/camera_capability.js';
import { NotesCapability, NotesCapabilityDescriptor } from './capabilities/notes_capability.js';
import { WalletCapability, WalletCapabilityDescriptor } from './capabilities/wallet_capability.js';

export {
  CameraCapability,
  CameraCapabilityDescriptor,
  NotesCapability,
  NotesCapabilityDescriptor,
  WalletCapability,
  WalletCapabilityDescriptor
};

export const CoreCapabilities = {
  // Read-only system time
  SystemTime: {
    descriptor: {
      id: 'system.time.get',
      version: '1.0.0',
      riskLevel: RiskLevel.READ_ONLY,
      requiredAuthority: AuthorityLevel.OBSERVE,
      isIdempotent: true
    },
    implementation: {
      async execute() {
        return { isoTime: new Date().toISOString(), timestamp: Date.now() };
      }
    }
  },

  // Read-only flight search (Offline/Cached or Connected)
  FlightInfo: {
    descriptor: {
      id: 'flight.info.get',
      version: '1.0.0',
      riskLevel: RiskLevel.READ_ONLY,
      requiredAuthority: AuthorityLevel.OBSERVE,
      isIdempotent: true
    },
    implementation: {
      async execute({ flightNumber = 'AI-202' }) {
        return {
          flightNumber,
          departure: '08:30 AM',
          terminal: 'T3',
          gate: '12B',
          status: 'ON_TIME'
        };
      }
    }
  },

  // Reversible calendar reminder creation
  CalendarCreateReminder: {
    descriptor: {
      id: 'calendar.reminder.create',
      version: '1.0.0',
      riskLevel: RiskLevel.REVERSIBLE,
      requiredAuthority: AuthorityLevel.EXECUTE,
      isIdempotent: true
    },
    implementation: {
      async execute({ title, time }) {
        return { reminderId: `rem_${Date.now()}`, title, time, status: 'SCHEDULED' };
      }
    }
  },

  // Irreversible financial ticket payment or money transfer
  WalletPay: {
    descriptor: {
      id: 'wallet.payment.transfer',
      version: '1.0.0',
      riskLevel: RiskLevel.IRREVERSIBLE,
      requiredAuthority: AuthorityLevel.EXECUTE,
      isIdempotent: false
    },
    implementation: {
      async execute({ amount, recipient }) {
        return { transactionId: `tx_${Date.now()}`, amount, recipient, status: 'PAID' };
      }
    }
  },

  // Pluggable Native Capability: Camera Capture (media.camera.capture)
  CameraCapture: {
    descriptor: CameraCapabilityDescriptor,
    implementation: new CameraCapability()
  },

  // Pluggable Native Capability: Smart Note Creation (notes.smart.create)
  NotesSmartCreate: {
    descriptor: NotesCapabilityDescriptor,
    implementation: new NotesCapability()
  },

  // Pluggable Native Capability: Irreversible Crypto Remittance (crypto.wallet.transact)
  CryptoWalletTransact: {
    descriptor: WalletCapabilityDescriptor,
    implementation: new WalletCapability()
  }
};
