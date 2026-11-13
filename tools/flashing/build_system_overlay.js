// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file build_system_overlay.js
 * Packages the persistent PravahOS /system partition overlay (pravahd, init.rc,
 * privileged Metro Launcher bridge, and standalone native factory APKs) and writes
 * a SHA-256 verified OVERLAY_MANIFEST.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const rootDir = 'L:/projectz/OS';
const outDir = path.join(rootDir, 'out', 'panther');
const overlayRoot = path.join(outDir, 'system_overlay');

const artifacts = [
  {
    src: path.join(outDir, 'pravahd'),
    dest: 'system/bin/pravahd',
    mode: '0755',
    selinux: 'u:object_r:pravahd_exec:s0',
    role: 'Native C Platform Daemon'
  },
  {
    src: path.join(rootDir, 'services', 'pravahd', 'pravahd.rc'),
    dest: 'system/etc/init/pravahd.rc',
    mode: '0644',
    selinux: 'u:object_r:system_file:s0',
    role: 'Android Init RC Daemon Trigger'
  },
  {
    src: path.join(outDir, 'PravahLauncher.apk'),
    dest: 'system/priv-app/PravahMetro/PravahLauncher.apk',
    mode: '0644',
    selinux: 'u:object_r:system_file:s0',
    role: 'Pravah Metro Living Drawer & Accessibility Bridge'
  },
  {
    src: path.join(outDir, 'PravahBazaar.apk'),
    dest: 'system/app/PravahBazaar/PravahBazaar.apk',
    mode: '0644',
    selinux: 'u:object_r:system_file:s0',
    role: 'Zero-Tax AOT App Bazaar'
  },
  {
    src: path.join(outDir, 'PravahVault.apk'),
    dest: 'system/app/PravahVault/PravahVault.apk',
    mode: '0644',
    selinux: 'u:object_r:system_file:s0',
    role: 'Hardware-Sealed Vault Storage'
  },
  {
    src: path.join(outDir, 'PravahShield.apk'),
    dest: 'system/app/PravahShield/PravahShield.apk',
    mode: '0644',
    selinux: 'u:object_r:system_file:s0',
    role: 'Live pravahd Daemon & OTA Enclave Verifier'
  },
  {
    src: path.join(outDir, 'AuroraNotes-pravah.apk'),
    dest: 'system/app/AuroraNotes/AuroraNotes-pravah.apk',
    mode: '0644',
    selinux: 'u:object_r:system_file:s0',
    role: 'AOT Transpiled Zero-Tax Note App'
  }
];

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

if (fs.existsSync(overlayRoot)) {
  fs.rmSync(overlayRoot, { recursive: true, force: true });
}
fs.mkdirSync(overlayRoot, { recursive: true });

console.log('=====================================================');
console.log(' [PravahOS] Building Persistent /system Overlay');
console.log('=====================================================');

const manifestEntries = [];

for (const item of artifacts) {
  if (!fs.existsSync(item.src)) {
    console.error(`[FATAL] Required build artifact missing: ${item.src}`);
    process.exit(1);
  }
  const destFull = path.join(overlayRoot, item.dest);
  fs.mkdirSync(path.dirname(destFull), { recursive: true });
  fs.copyFileSync(item.src, destFull);
  const stat = fs.statSync(destFull);
  const sha256 = sha256File(destFull);

  manifestEntries.push({
    path: `/${item.dest}`,
    sizeBytes: stat.size,
    mode: item.mode,
    selinuxContext: item.selinux,
    role: item.role,
    sha256
  });

  console.log(`  [+] /${item.dest} (${stat.size} bytes) sha256=${sha256.slice(0, 16)}...`);
}

const manifest = {
  target: 'panther',
  osVersion: '1.1.0-panther-prod',
  generatedAt: new Date().toISOString(),
  artifactCount: manifestEntries.length,
  files: manifestEntries
};

const manifestPath = path.join(overlayRoot, 'OVERLAY_MANIFEST.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`\n>>> [SUCCESS] Persistent System Overlay staged at: ${overlayRoot}`);
console.log(`>>> Manifest written to: ${manifestPath}`);
