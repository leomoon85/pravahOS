// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AppBazaarService,
  BazaarStatusCode,
  CatalogSource
} from '../src/services/app_bazaar_service.js';

import { AppBazaarApp } from '../../ui/apps/store.js';

describe('PravahOS App Bazaar & AOT APK Update Suite', () => {

  it('searches aggregated Google Play and F-Droid catalog', () => {
    const service = new AppBazaarService();
    const results = service.search('spotify');
    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'com.spotify.music');
    assert.equal(results[0].source, CatalogSource.PLAY_STORE);

    const fDroidResults = service.search('vlc');
    assert.equal(fDroidResults.length, 1);
    assert.equal(fDroidResults[0].id, 'org.videolan.vlc');
    assert.equal(fDroidResults[0].source, CatalogSource.F_DROID);
  });

  it('filters catalog by category chips', () => {
    const service = new AppBazaarService();
    const mediaApps = service.search('', 'Media & Audio');
    assert.ok(mediaApps.length >= 2);
    assert.ok(mediaApps.some(a => a.id === 'com.spotify.music'));
    assert.ok(mediaApps.some(a => a.id === 'org.videolan.vlc'));
  });

  it('installs and AOT-transpiles an APK, stripping WAKE_LOCKs', async () => {
    const service = new AppBazaarService();
    const progressLog = [];

    const res = await service.installPackage('com.whatsapp', (pct, txt) => {
      progressLog.push({ pct, txt });
    });

    assert.equal(res.status, BazaarStatusCode.OK);
    assert.equal(res.installed, true);
    assert.equal(res.record.packageId, 'com.whatsapp');
    assert.ok(res.record.strippedWakeLocks >= 1);
    assert.equal(res.record.isDormant, true);
    assert.equal(res.record.idleRamBytes, 0);
    assert.equal(res.record.idleCpuPercent, 0.0);
    assert.ok(progressLog.length >= 4);

    // Verify stored user data structure exists
    assert.ok(service.appDataStorage.has('com.whatsapp'));
  });

  it('rejects duplicate installation of already installed package', async () => {
    const service = new AppBazaarService();
    await service.installPackage('com.ubercab');

    const duplicateRes = await service.installPackage('com.ubercab');
    assert.equal(duplicateRes.status, BazaarStatusCode.ERR_ALREADY_INSTALLED);
  });

  it('performs atomic APK update with user data preservation and rollback window', async () => {
    const service = new AppBazaarService();
    await service.installPackage('com.ubercab');

    // Add persistent user ride history to simulated app data
    const userData = service.appDataStorage.get('com.ubercab');
    userData.rideHistory = ['Ride #1092 - 12.4 km', 'Ride #1093 - 4.1 km'];

    // Update to newer version
    const updateRes = await service.updatePackage('com.ubercab', {
      versionName: '4.513.0',
      versionCode: 451220000,
      manifestXml: service.catalog.find(x => x.id === 'com.ubercab').manifestXml
    });

    assert.equal(updateRes.status, BazaarStatusCode.OK);
    assert.equal(updateRes.updated, true);
    assert.equal(updateRes.newVersion, '4.513.0');
    assert.equal(updateRes.userDataIntact, true);

    // Verify user data is 100% preserved
    const postUpdateData = service.appDataStorage.get('com.ubercab');
    assert.deepEqual(postUpdateData.rideHistory, ['Ride #1092 - 12.4 km', 'Ride #1093 - 4.1 km']);

    // Perform instant rollback to previous version
    const rollbackRes = service.rollbackPackage('com.ubercab');
    assert.equal(rollbackRes.status, BazaarStatusCode.OK);
    assert.equal(rollbackRes.rolledBack, true);
    assert.equal(rollbackRes.restoredVersion, '4.512.10001');

    // Verify user data is still intact after rollback
    assert.equal(service.appDataStorage.get('com.ubercab').rideHistory.length, 2);
  });

  it('prevents accidental downgrade to older versionCode', async () => {
    const service = new AppBazaarService();
    await service.installPackage('com.spotify.music');

    const downgradeRes = await service.updatePackage('com.spotify.music', {
      versionName: '8.0.0',
      versionCode: 8000000 // Lower than 8920574
    });

    assert.equal(downgradeRes.status, BazaarStatusCode.ERR_DOWNGRADE_PREVENTED);
  });

  it('AppBazaarApp renders store catalog cards and search elements', () => {
    const service = new AppBazaarService();
    const app = new AppBazaarApp({ bazaarService: service });

    const mockContainer = {
      innerHTML: '',
      querySelectorAll: () => [],
      querySelector: () => null
    };

    app.render(mockContainer);
    assert.match(mockContainer.innerHTML, /App Bazaar/);
    assert.match(mockContainer.innerHTML, /Play Store & F-Droid/);
    assert.match(mockContainer.innerHTML, /WhatsApp Messenger/);
    assert.match(mockContainer.innerHTML, /Install &amp; Transpile|Install & Transpile/);
  });

});
