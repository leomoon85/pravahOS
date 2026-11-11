// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FileManagerApp,
  DEFAULT_STORAGE_BREAKDOWN,
  STORAGE_TOTAL_BYTES,
  FILE_CATEGORIES,
  VAULT_DEFAULT_PIN,
  TITAN_M2_SEALED_VAULT_ITEMS,
  formatBytes,
  normalizePath,
  getFileIcon
} from '../apps/files.js';

// Minimal Headless DOM Mock Element for PravahOS testing
class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this._classes = new Set();
    this.attributes = new Map();
    this.classList = {
      add: (...items) => items.forEach(i => this._classes.add(i)),
      remove: (...items) => items.forEach(i => this._classes.delete(i)),
      contains: (i) => this._classes.has(i),
      toggle: (i, force) => {
        if (force !== undefined) {
          if (force) this._classes.add(i);
          else this._classes.delete(i);
          return force;
        }
        if (this._classes.has(i)) {
          this._classes.delete(i);
          return false;
        }
        this._classes.add(i);
        return true;
      }
    };
    this.style = {};
    this.innerHTML = '';
    this.textContent = '';
    this.eventListeners = {};
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  dispatchEvent(type, eventObj = {}) {
    if (this.eventListeners[type]) {
      this.eventListeners[type].forEach(fn => fn({ target: this, ...eventObj }));
    }
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  querySelector(selector) {
    return new MockElement('', 'div');
  }

  querySelectorAll(selector) {
    return [new MockElement('', 'div')];
  }
}

// -----------------------------------------------------------------------------
// Test 1: Storage Overview Capacity Gauge
// -----------------------------------------------------------------------------
test('FileManagerApp: storage overview capacity gauge calculates correct visual breakdown', () => {
  const app = new FileManagerApp();
  const overview = app.getStorageOverview();

  assert.equal(overview.totalGB, 256, 'Total storage should be 256GB');
  assert.equal(overview.breakdown.system.sizeGB, 12, 'System storage must be 12GB');
  assert.equal(overview.breakdown.apps.sizeGB, 18, 'Apps storage must be 18GB');
  assert.equal(overview.breakdown.media.sizeGB, 24, 'Media storage must be 24GB');
  assert.equal(overview.breakdown.documents.sizeGB, 4, 'Documents storage must be 4GB');
  assert.equal(overview.breakdown.free.sizeGB, 202, 'Free space must be 202GB');

  assert.equal(overview.freeGB, 202, 'Total free must be 202GB');
  assert.equal(overview.usedGB, 54, 'Total used must be 54GB (256 - 202)');

  // Verify formatted strings
  assert.equal(overview.formatted.total, '256 GB');
  assert.equal(overview.formatted.used, '54 GB');
  assert.equal(overview.formatted.free, '202 GB');
  assert.equal(overview.formatted.system, '12 GB');
  assert.equal(overview.formatted.apps, '18 GB');
  assert.equal(overview.formatted.media, '24 GB');
  assert.equal(overview.formatted.documents, '4 GB');

  // Verify percentages
  assert.ok(Math.abs(overview.breakdown.system.percent - 4.69) < 0.1);
  assert.ok(Math.abs(overview.breakdown.apps.percent - 7.03) < 0.1);
  assert.ok(Math.abs(overview.breakdown.media.percent - 9.38) < 0.1);
  assert.ok(Math.abs(overview.breakdown.documents.percent - 1.56) < 0.1);
  assert.ok(Math.abs(overview.freePercent - 78.91) < 0.1);
});

// -----------------------------------------------------------------------------
// Test 2: Directory Explorer Navigation & Path Resolution
// -----------------------------------------------------------------------------
test('FileManagerApp: navigateTo() updates currentPath and validates existence', () => {
  const app = new FileManagerApp();

  // Initial path
  assert.equal(app.currentPath, '/storage');

  // Navigate to /sdcard/Download
  const navSuccess = app.navigateTo('/sdcard/Download');
  assert.equal(navSuccess, true);
  assert.equal(app.currentPath, '/sdcard/Download');

  // Navigate to /system/bin
  const navSys = app.navigateTo('/system/bin');
  assert.equal(navSys, true);
  assert.equal(app.currentPath, '/system/bin');

  // Navigate to /data/app
  const navData = app.navigateTo('/data/app');
  assert.equal(navData, true);
  assert.equal(app.currentPath, '/data/app');

  // Non-existent directory returns false and currentPath remains unchanged
  const navInvalid = app.navigateTo('/non/existent/path');
  assert.equal(navInvalid, false);
  assert.equal(app.currentPath, '/data/app');
});

// -----------------------------------------------------------------------------
// Test 3: Hierarchical Traversal & goUp()
// -----------------------------------------------------------------------------
test('FileManagerApp: goUp() traverses folder hierarchy up to root /', () => {
  const app = new FileManagerApp({ initialPath: '/sdcard/Download' });
  assert.equal(app.currentPath, '/sdcard/Download');

  // Up from /sdcard/Download -> /sdcard
  const p1 = app.goUp();
  assert.equal(p1, '/sdcard');
  assert.equal(app.currentPath, '/sdcard');

  // Up from /sdcard -> /
  const p2 = app.goUp();
  assert.equal(p2, '/');
  assert.equal(app.currentPath, '/');

  // Up from / stays at /
  const p3 = app.goUp();
  assert.equal(p3, '/');
  assert.equal(app.currentPath, '/');
});

// -----------------------------------------------------------------------------
// Test 4: Directory Listing & File Metadata Inspection
// -----------------------------------------------------------------------------
test('FileManagerApp: getDirectoryListing() returns files with size, permissions, and timestamps', () => {
  const app = new FileManagerApp();
  const listing = app.getDirectoryListing('/sdcard/Download');

  assert.ok(Array.isArray(listing));
  assert.ok(listing.length >= 3, 'Should list files in /sdcard/Download');

  const zipFile = listing.find(f => f.name === 'pravah_sdk_v2.0_arm64.zip');
  assert.ok(zipFile, 'Should include pravah_sdk_v2.0_arm64.zip');
  assert.equal(zipFile.type, 'file');
  assert.equal(zipFile.extension, 'zip');
  assert.ok(zipFile.size > 10000000, 'Zip file size should be > 10MB');
  assert.equal(zipFile.permissions, '-rw-rw-r--');
  assert.ok(zipFile.modified.startsWith('2026-11'));
  assert.equal(zipFile.icon, '🗜️');

  // Check /system/bin permissions (executables)
  const binListing = app.getDirectoryListing('/system/bin');
  const initElf = binListing.find(f => f.name === 'microkernel.elf');
  assert.ok(initElf);
  assert.equal(initElf.permissions, '-rwxr-xr-x');
  assert.equal(initElf.icon, '⚙️');
});

// -----------------------------------------------------------------------------
// Test 5: Category Quick Filter Chips
// -----------------------------------------------------------------------------
test('FileManagerApp: filterByCategory() filters across filesystem by category', () => {
  const app = new FileManagerApp();

  // 1. APKs
  const apkFiles = app.filterByCategory('apks');
  assert.equal(app.selectedCategory, 'apks');
  assert.ok(apkFiles.length >= 3, 'Should find multiple APKs');
  assert.ok(apkFiles.every(f => f.name.endsWith('.apk')));

  // 2. Images
  const imageFiles = app.filterByCategory('images');
  assert.equal(app.selectedCategory, 'images');
  assert.ok(imageFiles.length >= 3, 'Should find multiple image files');
  assert.ok(imageFiles.some(f => f.name === 'wallpaper_neon_cyber.png'));

  // 3. Audio
  const audioFiles = app.filterByCategory('audio');
  assert.equal(app.selectedCategory, 'audio');
  assert.ok(audioFiles.length >= 2, 'Should find audio files');
  assert.ok(audioFiles.some(f => f.name === 'ambient_cyberpunk_drift.flac'));

  // 4. Documents
  const docFiles = app.filterByCategory('documents');
  assert.equal(app.selectedCategory, 'documents');
  assert.ok(docFiles.some(f => f.name === 'architectural_blueprint.pdf'));

  // Toggling same category clears filter
  app.filterByCategory('documents');
  assert.equal(app.selectedCategory, null);
});

// -----------------------------------------------------------------------------
// Test 6: Recursive File Search
// -----------------------------------------------------------------------------
test('FileManagerApp: searchFiles() performs recursive case-insensitive search', () => {
  const app = new FileManagerApp();

  // Search for 'quantum'
  const quantumMatches = app.searchFiles('quantum');
  assert.ok(quantumMatches.length >= 2);
  assert.ok(quantumMatches.some(f => f.name.includes('quantum_mesh_spec')));
  assert.ok(quantumMatches.some(f => f.name.includes('quantum_teleportation_sim')));

  // Search for 'whatsapp'
  const whatsappMatches = app.searchFiles('whatsapp');
  assert.equal(whatsappMatches.length, 1);
  assert.equal(whatsappMatches[0].name, 'com.whatsapp.apk');

  // Empty search restores directory listing
  const emptyMatches = app.searchFiles('');
  assert.ok(emptyMatches.length > 0);
  assert.equal(app.searchQuery, '');
});

// -----------------------------------------------------------------------------
// Test 7: Titan M2 Hardware Secure Vault: Unlock, Lock, and PIN Rate Limiting
// -----------------------------------------------------------------------------
test('FileManagerApp: Titan M2 Hardware Vault security unlock, wrong PIN penalty, and sealing', () => {
  const app = new FileManagerApp();

  // Vault starts in sealed/locked state
  assert.equal(app.vaultUnlocked, false);

  // 1. Attempt with invalid PIN
  const failRes = app.unlockVault('9999');
  assert.equal(failRes.success, false);
  assert.equal(app.vaultUnlocked, false);
  assert.equal(app.vaultAttempts, 1);
  assert.equal(failRes.remainingAttempts, 4);
  assert.ok(app.vaultError.includes('Invalid Titan M2 PIN'));

  // 2. Successful unlock with valid hardware PIN '1337'
  const successRes = app.unlockVault(VAULT_DEFAULT_PIN);
  assert.equal(successRes.success, true);
  assert.equal(app.vaultUnlocked, true);
  assert.equal(app.vaultAttempts, 0);
  assert.equal(app.vaultError, null);
  assert.ok(Array.isArray(successRes.items));
  assert.equal(successRes.items.length, 5);

  // Inspect sealed documents in hardware keystore
  const seedItem = successRes.items.find(i => i.name === 'recovery_seed_pravah.sec');
  assert.ok(seedItem);
  assert.ok(seedItem.cipher.includes('AES-256-GCM'));

  const zkItem = successRes.items.find(i => i.name === 'zk_master_identity.key');
  assert.ok(zkItem);
  assert.equal(zkItem.status, 'Sealed & Air-Gapped');

  // 3. Lock Vault
  const lockRes = app.lockVault();
  assert.equal(lockRes.success, true);
  assert.equal(app.vaultUnlocked, false);
});

// -----------------------------------------------------------------------------
// Test 8: Archive Previewer (Simulated ZIP Inspection)
// -----------------------------------------------------------------------------
test('FileManagerApp: previewArchive() inspects ZIP structure, CRC32, and compression', () => {
  const app = new FileManagerApp();
  const archivePath = '/sdcard/Download/pravah_sdk_v2.0_arm64.zip';

  const preview = app.previewArchive(archivePath);
  assert.ok(preview);
  assert.equal(preview.archiveName, 'pravah_sdk_v2.0_arm64.zip');
  assert.equal(preview.entryCount, 6);
  assert.ok(preview.entries.length >= 6);
  assert.equal(preview.integrityStatus, 'CRC32 Verified OK');

  // Verify internal zip entry structure
  const headerEntry = preview.entries.find(e => e.name === 'include/pravah/capabilities.h');
  assert.ok(headerEntry);
  assert.equal(headerEntry.crc32, '0x8A12F3D1');
  assert.equal(headerEntry.method, 'Deflate');
  assert.equal(headerEntry.encrypted, false);

  // Closing archive preview clears inspection state
  app.closeArchivePreview();
  assert.equal(app.inspectedArchive, null);
});

// -----------------------------------------------------------------------------
// Test 9: Microkernel Capability Hook Bindings (storage.fs & crypto.vault)
// -----------------------------------------------------------------------------
test('FileManagerApp: capability hooks for storage.fs and crypto.vault override defaults', () => {
  let customStorageCalled = false;
  let customVaultCalled = false;

  const mockStorageFs = {
    getStorageOverview: () => {
      customStorageCalled = true;
      return {
        totalGB: 512,
        usedGB: 100,
        freeGB: 412,
        breakdown: {},
        formatted: { total: '512 GB', used: '100 GB', free: '412 GB' }
      };
    },
    list: (path) => [{ name: 'custom_injected.bin', type: 'file', size: 1024, permissions: '-rw-r--r--', modified: '2026-11-12' }]
  };

  const mockCryptoVault = {
    verifyPin: (pin) => {
      customVaultCalled = true;
      if (pin === '7777') return { success: true };
      return { success: false, error: 'Custom Hardware Lockout' };
    },
    lock: () => {}
  };

  const app = new FileManagerApp({
    capabilities: {
      'storage.fs': mockStorageFs,
      'crypto.vault': mockCryptoVault
    }
  });

  // Test storage capability binding
  const overview = app.getStorageOverview();
  assert.equal(customStorageCalled, true);
  assert.equal(overview.totalGB, 512);

  const customListing = app.getDirectoryListing('/any');
  assert.equal(customListing[0].name, 'custom_injected.bin');

  // Test vault capability binding
  const fail = app.unlockVault('1337');
  assert.equal(fail.success, false);
  assert.equal(customVaultCalled, true);

  const pass = app.unlockVault('7777');
  assert.equal(pass.success, true);
});

// -----------------------------------------------------------------------------
// Test 10: Full DOM Rendering & Keypad State Interactivity
// -----------------------------------------------------------------------------
test('FileManagerApp: render() outputs full UI and updates keypad pin buffer', () => {
  const container = new MockElement('files-app-root');
  const app = new FileManagerApp({ container });

  // Initial render should output HTML
  assert.ok(container.innerHTML.includes('Files &amp; Storage'));
  assert.ok(container.innerHTML.includes('storage.fs • Titan M2 Keystore'));
  assert.ok(container.innerHTML.includes('storage-segmented-bar'));
  assert.ok(container.innerHTML.includes('category-chips-row'));

  // Switch to Vault Tab
  app.switchTab('vault');
  assert.equal(app.activeTab, 'vault');
  assert.ok(container.innerHTML.includes('TITAN M2 SECURE ENCLAVE'));
  assert.ok(container.innerHTML.includes('vault-keypad'));

  // Enter PIN digits via keypad helper
  app.enterPinDigit(1);
  app.enterPinDigit(3);
  app.enterPinDigit(3);
  app.enterPinDigit(7);
  assert.equal(app.vaultPinBuffer, '1337');

  // Submit PIN
  const unlockRes = app.submitPin();
  assert.equal(unlockRes.success, true);
  assert.equal(app.vaultUnlocked, true);
  assert.ok(container.innerHTML.includes('Titan M2 Hardware Vault [UNLOCKED]'));

  // Toggle view mode
  app.setViewMode('grid');
  assert.equal(app.viewMode, 'grid');
  app.setViewMode('list');
  assert.equal(app.viewMode, 'list');
});

// -----------------------------------------------------------------------------
// Test 11: Utility Functions: formatBytes, normalizePath, getFileIcon
// -----------------------------------------------------------------------------
test('FileManagerApp: helper utilities format sizes, normalize paths, and identify icons', () => {
  // formatBytes
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1048576), '1 MB');
  assert.equal(formatBytes(1073741824), '1 GB');

  // normalizePath
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath('/storage//sdcard/'), '/storage/sdcard');
  assert.equal(normalizePath('/sdcard/Download/../Documents'), '/sdcard/Documents');

  // getFileIcon
  assert.equal(getFileIcon({ type: 'directory' }), '📁');
  assert.equal(getFileIcon({ type: 'file', extension: 'apk' }), '📦');
  assert.equal(getFileIcon({ type: 'file', extension: 'mp4' }), '🎬');
  assert.equal(getFileIcon({ type: 'file', extension: 'flac' }), '🎵');
  assert.equal(getFileIcon({ type: 'file', extension: 'png' }), '🖼️');
  assert.equal(getFileIcon({ type: 'file', extension: 'sec' }), '🔒');
});
