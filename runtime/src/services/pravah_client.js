// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file pravah_client.js
 * PravahOS Platform Client Bridge.
 *
 * Connects the Pravah Experience Composer & UI Shell to the native platform daemon (pravahd).
 */

import { PravahStatusCode, PravahRisk } from './pravahd_service.js';

export class PravahClient {
  /**
   * @param {Object} [options]
   * @param {Object} [options.service] - Direct service reference (for in-process / testing)
   */
  constructor(options = {}) {
    this.service = options.service || null;
    this.sessionToken = options.sessionToken || 'tok_pravah_session_default';
  }

  setService(service) {
    this.service = service;
  }

  setSessionToken(token) {
    this.sessionToken = token;
  }

  /**
   * Acquires real hardware battery telemetry.
   */
  async getBatteryTelemetry() {
    if (!this.service) {
      throw new Error('PRAVAHD_NOT_CONNECTED: Platform daemon connection not established');
    }
    const res = this.service.getBatteryInfo();
    if (res.status !== PravahStatusCode.OK) {
      throw new Error(`HARDWARE_ERROR: ${res.error || 'Failed to acquire battery telemetry'}`);
    }
    return res.battery;
  }

  /**
   * Sets display brightness through Policy Gate arbitration.
   */
  async setDisplayBrightness(level, authToken = null) {
    if (!this.service) {
      throw new Error('PRAVAHD_NOT_CONNECTED: Platform daemon connection not established');
    }
    const token = authToken || this.sessionToken;
    const res = this.service.setDisplayBrightness(level, token);
    if (res.status !== PravahStatusCode.OK) {
      const err = new Error(`POLICY_ERROR: ${res.error || 'Permission denied'}`);
      err.code = res.status;
      throw err;
    }
    return res;
  }

  /**
   * Commits persistent key-value configuration.
   */
  async commitState(key, value, authToken = null) {
    if (!this.service) {
      throw new Error('PRAVAHD_NOT_CONNECTED: Platform daemon connection not established');
    }
    const token = authToken || this.sessionToken;
    const res = this.service.setPersistentState(key, value, token);
    if (res.status !== PravahStatusCode.OK) {
      throw new Error(`PERSISTENCE_ERROR: ${res.error || 'Write failed'}`);
    }
    return res;
  }

  /**
   * Reads persistent state.
   */
  async queryState(key) {
    if (!this.service) {
      throw new Error('PRAVAHD_NOT_CONNECTED: Platform daemon connection not established');
    }
    const res = this.service.getPersistentState(key);
    if (res.status === PravahStatusCode.ERR_NOT_FOUND) {
      return null;
    }
    if (res.status !== PravahStatusCode.OK) {
      throw new Error(`QUERY_ERROR: ${res.error || 'Query failed'}`);
    }
    return res.value;
  }
}

let defaultClient = null;

export function getPravahClient() {
  if (!defaultClient) {
    defaultClient = new PravahClient();
  }
  return defaultClient;
}
