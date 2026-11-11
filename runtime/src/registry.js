// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

export class CapabilityRegistry {
  constructor() {
    this.capabilities = new Map();
  }

  register(descriptor, implementation) {
    if (!descriptor?.id) {
      throw new Error('Capability descriptor must have an id');
    }
    if (typeof implementation.execute !== 'function') {
      throw new Error(`Implementation for capability ${descriptor.id} must have an execute method`);
    }
    this.capabilities.set(descriptor.id, { descriptor, implementation });
  }

  get(capabilityId) {
    return this.capabilities.get(capabilityId);
  }

  list() {
    return Array.from(this.capabilities.values()).map(c => c.descriptor);
  }
}
