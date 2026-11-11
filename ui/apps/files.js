// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file files.js
 * PravahOS Files & Storage Manager Stock Application.
 *
 * Implements:
 * 1. Storage overview capacity gauge: visual breakdown of System (12GB), Apps (18GB),
 *    Media (24GB), Documents (4GB), and Free space (202GB / 256GB total).
 * 2. Category quick filter chips: Downloads, Images, Videos, Audio, Documents, APK Packages.
 * 3. Interactive directory explorer: root breadcrumbs navigation (`/`, `/storage`, `/data`, `/sdcard`),
 *    folder hierarchy, file metadata (size, POSIX permissions, modified timestamp).
 * 4. Titan M2 Hardware Secure Vault: isolated hardware-encrypted storage requiring PIN unlock,
 *    displaying confidential documents sealed in hardware keystore.
 * 5. Search filter and archive previewer (simulated ZIP inspection with CRC32 & compression ratio).
 * 6. Microkernel capability hooks for storage.fs and crypto.vault.
 */

export const STORAGE_TOTAL_BYTES = 256 * 1024 * 1024 * 1024; // 256 GB

export const DEFAULT_STORAGE_BREAKDOWN = {
  system: {
    id: 'system',
    label: 'System',
    sizeGB: 12,
    bytes: 12 * 1024 * 1024 * 1024,
    color: '#7c4dff',
    icon: '⚙️'
  },
  apps: {
    id: 'apps',
    label: 'Apps',
    sizeGB: 18,
    bytes: 18 * 1024 * 1024 * 1024,
    color: '#00e5ff',
    icon: '📱'
  },
  media: {
    id: 'media',
    label: 'Media',
    sizeGB: 24,
    bytes: 24 * 1024 * 1024 * 1024,
    color: '#ff4081',
    icon: '🎬'
  },
  documents: {
    id: 'documents',
    label: 'Documents',
    sizeGB: 4,
    bytes: 4 * 1024 * 1024 * 1024,
    color: '#ffb300',
    icon: '📄'
  },
  free: {
    id: 'free',
    label: 'Free Space',
    sizeGB: 202,
    bytes: 202 * 1024 * 1024 * 1024,
    color: '#222938',
    icon: '💾'
  }
};

export const FILE_CATEGORIES = [
  { id: 'downloads', label: 'Downloads', icon: '📥', color: '#38bdf8' },
  { id: 'images', label: 'Images', icon: '🖼️', color: '#10b981' },
  { id: 'videos', label: 'Videos', icon: '🎬', color: '#f43f5e' },
  { id: 'audio', label: 'Audio', icon: '🎵', color: '#a855f7' },
  { id: 'documents', label: 'Documents', icon: '📄', color: '#f59e0b' },
  { id: 'apks', label: 'APK Packages', icon: '📦', color: '#00e676' }
];

export const VAULT_DEFAULT_PIN = '1337';

export const TITAN_M2_SEALED_VAULT_ITEMS = [
  {
    id: 'vault_seed',
    name: 'recovery_seed_pravah.sec',
    label: 'PravahOS Root BIP-39 Seed Mnemonic',
    category: 'cryptographic_seed',
    size: 128,
    sealedAt: '2026-11-10 14:22:00',
    cipher: 'AES-256-GCM / Titan M2 Root Key #0x9F4B',
    status: 'Sealed & Hardware-Guarded',
    description: '256-bit cryptographic master entropy with SP800-90B TRNG seed.'
  },
  {
    id: 'vault_passport',
    name: 'identity_passport_biometrics.enc',
    label: 'e-Passport Biometric DG1-DG16 Datagroups',
    category: 'identity',
    size: 65740,
    sealedAt: '2026-11-11 09:15:30',
    cipher: 'AES-256-GCM / ICAO 9303 Compliant',
    status: 'Sealed & Biometric Lock',
    description: 'Encrypted NFC chip biometric data groups DG1/DG2/DG14.'
  },
  {
    id: 'vault_zk',
    name: 'zk_master_identity.key',
    label: 'ZK-SNARK Sovereign Identity Prover Key',
    category: 'zero_knowledge',
    size: 2457,
    sealedAt: '2026-11-11 18:30:12',
    cipher: 'Groth16 / BN254 Scalar Hardened',
    status: 'Sealed & Air-Gapped',
    description: 'Prover key for anonymous cryptographic capability verification.'
  },
  {
    id: 'vault_defense',
    name: 'defense_contract_token.pfx',
    label: 'DoD / DISA X.509 Mutual-TLS Token',
    category: 'credentials',
    size: 4915,
    sealedAt: '2026-11-09 11:00:00',
    cipher: 'RSA-4096 / P-384 Dual-Sign HSM',
    status: 'Sealed & Hardware PIN Lock',
    description: 'Hardware-bound client certificate for secure satellite relay gateway.'
  },
  {
    id: 'vault_firmware',
    name: 'firmware_signing_root.pem',
    label: 'Microkernel Stage-0 Boot Signing Authority',
    category: 'kernel_security',
    size: 1843,
    sealedAt: '2026-10-01 00:00:00',
    cipher: 'Ed25519 Curve Hardware Fuse Root',
    status: 'Sealed & Tamper-Fuse',
    description: 'Root cryptographic certificate verifying stage-0 microkernel images.'
  }
];

export const DEFAULT_VFS = {
  '/': {
    name: '/',
    type: 'directory',
    permissions: 'drwxr-xr-x',
    modified: '2026-11-10T12:00:00Z',
    children: ['system', 'data', 'storage', 'sdcard']
  },
  '/system': {
    name: 'system',
    type: 'directory',
    permissions: 'drwxr-xr-x',
    modified: '2026-11-10T12:00:00Z',
    children: ['bin', 'framework', 'etc']
  },
  '/system/bin': {
    name: 'bin',
    type: 'directory',
    permissions: 'drwxr-xr-x',
    modified: '2026-11-10T12:00:00Z',
    children: ['pravah-init', 'microkernel.elf', 'starnix-bridge']
  },
  '/system/bin/pravah-init': {
    name: 'pravah-init',
    type: 'file',
    category: 'system',
    extension: 'bin',
    size: 2457600,
    permissions: '-rwxr-xr-x',
    modified: '2026-11-08T08:30:00Z'
  },
  '/system/bin/microkernel.elf': {
    name: 'microkernel.elf',
    type: 'file',
    category: 'system',
    extension: 'elf',
    size: 8388608,
    permissions: '-rwxr-xr-x',
    modified: '2026-11-08T08:30:00Z'
  },
  '/system/bin/starnix-bridge': {
    name: 'starnix-bridge',
    type: 'file',
    category: 'system',
    extension: 'bin',
    size: 4194304,
    permissions: '-rwxr-xr-x',
    modified: '2026-11-09T10:15:00Z'
  },
  '/system/framework': {
    name: 'framework',
    type: 'directory',
    permissions: 'drwxr-xr-x',
    modified: '2026-11-10T12:00:00Z',
    children: ['pravah-core.vmo', 'ui-composer.so']
  },
  '/system/framework/pravah-core.vmo': {
    name: 'pravah-core.vmo',
    type: 'file',
    category: 'system',
    extension: 'vmo',
    size: 16777216,
    permissions: '-rw-r--r--',
    modified: '2026-11-10T04:00:00Z'
  },
  '/system/framework/ui-composer.so': {
    name: 'ui-composer.so',
    type: 'file',
    category: 'system',
    extension: 'so',
    size: 12582912,
    permissions: '-rwxr-xr-x',
    modified: '2026-11-10T04:00:00Z'
  },
  '/system/etc': {
    name: 'etc',
    type: 'directory',
    permissions: 'drwxr-xr-x',
    modified: '2026-11-10T12:00:00Z',
    children: ['capabilities.json', 'fstab']
  },
  '/system/etc/capabilities.json': {
    name: 'capabilities.json',
    type: 'file',
    category: 'documents',
    extension: 'json',
    size: 65536,
    permissions: '-rw-r--r--',
    modified: '2026-11-10T04:00:00Z'
  },
  '/system/etc/fstab': {
    name: 'fstab',
    type: 'file',
    category: 'system',
    extension: 'conf',
    size: 4096,
    permissions: '-rw-r--r--',
    modified: '2026-11-01T00:00:00Z'
  },
  '/data': {
    name: 'data',
    type: 'directory',
    permissions: 'drwxrwx--x',
    modified: '2026-11-11T16:00:00Z',
    children: ['app', 'system']
  },
  '/data/app': {
    name: 'app',
    type: 'directory',
    permissions: 'drwxrwx--x',
    modified: '2026-11-11T16:00:00Z',
    children: [
      'org.pravah.dialer.apk',
      'org.pravah.satellite.apk',
      'org.pravah.notes.apk',
      'com.whatsapp.apk',
      'com.spotify.music.apk'
    ]
  },
  '/data/app/org.pravah.dialer.apk': {
    name: 'org.pravah.dialer.apk',
    type: 'file',
    category: 'apks',
    extension: 'apk',
    size: 19293798,
    permissions: '-rw-r--r--',
    modified: '2026-11-11T12:00:00Z'
  },
  '/data/app/org.pravah.satellite.apk': {
    name: 'org.pravah.satellite.apk',
    type: 'file',
    category: 'apks',
    extension: 'apk',
    size: 12687769,
    permissions: '-rw-r--r--',
    modified: '2026-11-11T12:00:00Z'
  },
  '/data/app/org.pravah.notes.apk': {
    name: 'org.pravah.notes.apk',
    type: 'file',
    category: 'apks',
    extension: 'apk',
    size: 8912896,
    permissions: '-rw-r--r--',
    modified: '2026-11-11T12:00:00Z'
  },
  '/data/app/com.whatsapp.apk': {
    name: 'com.whatsapp.apk',
    type: 'file',
    category: 'apks',
    extension: 'apk',
    size: 50541363,
    permissions: '-rw-r--r--',
    modified: '2026-11-05T09:12:00Z'
  },
  '/data/app/com.spotify.music.apk': {
    name: 'com.spotify.music.apk',
    type: 'file',
    category: 'apks',
    extension: 'apk',
    size: 65326284,
    permissions: '-rw-r--r--',
    modified: '2026-11-02T15:24:00Z'
  },
  '/data/system': {
    name: 'system',
    type: 'directory',
    permissions: 'drwx------',
    modified: '2026-11-11T16:00:00Z',
    children: ['users.db', 'packages.xml']
  },
  '/data/system/users.db': {
    name: 'users.db',
    type: 'file',
    category: 'documents',
    extension: 'db',
    size: 1048576,
    permissions: '-rw-------',
    modified: '2026-11-11T16:00:00Z'
  },
  '/data/system/packages.xml': {
    name: 'packages.xml',
    type: 'file',
    category: 'documents',
    extension: 'xml',
    size: 524288,
    permissions: '-rw-------',
    modified: '2026-11-11T16:00:00Z'
  },
  '/storage': {
    name: 'storage',
    type: 'directory',
    permissions: 'drwxr-xr-x',
    modified: '2026-11-11T16:00:00Z',
    children: ['emulated', 'sdcard']
  },
  '/storage/emulated': {
    name: 'emulated',
    type: 'directory',
    permissions: 'drwxr-xr-x',
    modified: '2026-11-11T16:00:00Z',
    children: ['0']
  },
  '/storage/emulated/0': {
    name: '0',
    type: 'directory',
    permissions: 'rwxrwxr-x',
    modified: '2026-11-11T16:00:00Z',
    children: ['Download', 'Documents', 'Pictures', 'Movies', 'Music']
  },
  '/storage/sdcard': {
    name: 'sdcard',
    type: 'directory',
    permissions: 'rwxrwxr-x',
    modified: '2026-11-11T16:00:00Z',
    children: ['Download', 'Documents', 'Pictures', 'Movies', 'Music']
  },
  '/sdcard': {
    name: 'sdcard',
    type: 'directory',
    permissions: 'rwxrwxr-x',
    modified: '2026-11-11T16:00:00Z',
    children: ['Download', 'Documents', 'Pictures', 'Movies', 'Music']
  },
  '/sdcard/Download': {
    name: 'Download',
    type: 'directory',
    permissions: 'rwxrwxr-x',
    modified: '2026-11-11T16:00:00Z',
    children: [
      'pravah_sdk_v2.0_arm64.zip',
      'quantum_mesh_spec.pdf',
      'pravah_terminal_v1.4.apk',
      'firmware_ota_update_rev4.bin'
    ]
  },
  '/sdcard/Download/pravah_sdk_v2.0_arm64.zip': {
    name: 'pravah_sdk_v2.0_arm64.zip',
    type: 'file',
    category: 'downloads',
    extension: 'zip',
    size: 14889779,
    permissions: '-rw-rw-r--',
    modified: '2026-11-11T14:10:00Z'
  },
  '/sdcard/Download/quantum_mesh_spec.pdf': {
    name: 'quantum_mesh_spec.pdf',
    type: 'file',
    category: 'downloads',
    extension: 'pdf',
    size: 3984588,
    permissions: '-rw-rw-r--',
    modified: '2026-11-10T18:40:00Z'
  },
  '/sdcard/Download/pravah_terminal_v1.4.apk': {
    name: 'pravah_terminal_v1.4.apk',
    type: 'file',
    category: 'apks',
    extension: 'apk',
    size: 10276044,
    permissions: '-rw-rw-r--',
    modified: '2026-11-09T22:15:00Z'
  },
  '/sdcard/Download/firmware_ota_update_rev4.bin': {
    name: 'firmware_ota_update_rev4.bin',
    type: 'file',
    category: 'downloads',
    extension: 'bin',
    size: 29779558,
    permissions: '-rw-rw-r--',
    modified: '2026-11-07T11:00:00Z'
  },
  '/sdcard/Documents': {
    name: 'Documents',
    type: 'directory',
    permissions: 'rwxrwxr-x',
    modified: '2026-11-11T16:00:00Z',
    children: [
      'architectural_blueprint.pdf',
      'satellite_protocol_rel17.docx',
      'annual_budget_2026.xlsx',
      'notes_meeting_nov11.txt'
    ]
  },
  '/sdcard/Documents/architectural_blueprint.pdf': {
    name: 'architectural_blueprint.pdf',
    type: 'file',
    category: 'documents',
    extension: 'pdf',
    size: 1468006,
    permissions: '-rw-rw-r--',
    modified: '2026-11-11T09:20:00Z'
  },
  '/sdcard/Documents/satellite_protocol_rel17.docx': {
    name: 'satellite_protocol_rel17.docx',
    type: 'file',
    category: 'documents',
    extension: 'docx',
    size: 839680,
    permissions: '-rw-rw-r--',
    modified: '2026-11-10T14:15:00Z'
  },
  '/sdcard/Documents/annual_budget_2026.xlsx': {
    name: 'annual_budget_2026.xlsx',
    type: 'file',
    category: 'documents',
    extension: 'xlsx',
    size: 460800,
    permissions: '-rw-rw-r--',
    modified: '2026-11-08T17:00:00Z'
  },
  '/sdcard/Documents/notes_meeting_nov11.txt': {
    name: 'notes_meeting_nov11.txt',
    type: 'file',
    category: 'documents',
    extension: 'txt',
    size: 12288,
    permissions: '-rw-rw-r--',
    modified: '2026-11-11T15:30:00Z'
  },
  '/sdcard/Pictures': {
    name: 'Pictures',
    type: 'directory',
    permissions: 'rwxrwxr-x',
    modified: '2026-11-11T16:00:00Z',
    children: [
      'wallpaper_neon_cyber.png',
      'imx890_sensor_raw_001.dng',
      'pravah_brand_logo.svg',
      'screenshot_20261112_0400.jpg'
    ]
  },
  '/sdcard/Pictures/wallpaper_neon_cyber.png': {
    name: 'wallpaper_neon_cyber.png',
    type: 'file',
    category: 'images',
    extension: 'png',
    size: 5033164,
    permissions: '-rw-rw-r--',
    modified: '2026-11-11T16:45:00Z'
  },
  '/sdcard/Pictures/imx890_sensor_raw_001.dng': {
    name: 'imx890_sensor_raw_001.dng',
    type: 'file',
    category: 'images',
    extension: 'dng',
    size: 19084083,
    permissions: '-rw-rw-r--',
    modified: '2026-11-11T14:12:00Z'
  },
  '/sdcard/Pictures/pravah_brand_logo.svg': {
    name: 'pravah_brand_logo.svg',
    type: 'file',
    category: 'images',
    extension: 'svg',
    size: 24576,
    permissions: '-rw-rw-r--',
    modified: '2026-11-01T10:00:00Z'
  },
  '/sdcard/Pictures/screenshot_20261112_0400.jpg': {
    name: 'screenshot_20261112_0400.jpg',
    type: 'file',
    category: 'images',
    extension: 'jpg',
    size: 1258291,
    permissions: '-rw-rw-r--',
    modified: '2026-11-12T04:00:00Z'
  },
  '/sdcard/Movies': {
    name: 'Movies',
    type: 'directory',
    permissions: 'rwxrwxr-x',
    modified: '2026-11-11T16:00:00Z',
    children: ['quantum_teleportation_sim.mp4', 'pravah_launch_keynote.mp4']
  },
  '/sdcard/Movies/quantum_teleportation_sim.mp4': {
    name: 'quantum_teleportation_sim.mp4',
    type: 'file',
    category: 'videos',
    extension: 'mp4',
    size: 19293798,
    permissions: '-rw-rw-r--',
    modified: '2026-11-10T20:30:00Z'
  },
  '/sdcard/Movies/pravah_launch_keynote.mp4': {
    name: 'pravah_launch_keynote.mp4',
    type: 'file',
    category: 'videos',
    extension: 'mp4',
    size: 440401920,
    permissions: '-rw-rw-r--',
    modified: '2026-11-09T18:00:00Z'
  },
  '/sdcard/Music': {
    name: 'Music',
    type: 'directory',
    permissions: 'rwxrwxr-x',
    modified: '2026-11-11T16:00:00Z',
    children: ['ambient_cyberpunk_drift.flac', 'pravah_boot_chime.wav', 'lofi_study_beats.mp3']
  },
  '/sdcard/Music/ambient_cyberpunk_drift.flac': {
    name: 'ambient_cyberpunk_drift.flac',
    type: 'file',
    category: 'audio',
    extension: 'flac',
    size: 29884416,
    permissions: '-rw-rw-r--',
    modified: '2026-11-11T11:00:00Z'
  },
  '/sdcard/Music/pravah_boot_chime.wav': {
    name: 'pravah_boot_chime.wav',
    type: 'file',
    category: 'audio',
    extension: 'wav',
    size: 1887436,
    permissions: '-rw-rw-r--',
    modified: '2026-11-01T12:00:00Z'
  },
  '/sdcard/Music/lofi_study_beats.mp3': {
    name: 'lofi_study_beats.mp3',
    type: 'file',
    category: 'audio',
    extension: 'mp3',
    size: 8598323,
    permissions: '-rw-rw-r--',
    modified: '2026-11-08T19:45:00Z'
  }
};

export const MOCK_ZIP_ARCHIVES = {
  '/sdcard/Download/pravah_sdk_v2.0_arm64.zip': {
    archiveName: 'pravah_sdk_v2.0_arm64.zip',
    format: 'ZIP (PKZip 2.0 / Deflate)',
    entryCount: 6,
    totalUncompressedSize: 48600000,
    totalCompressedSize: 14889779,
    compressionRatio: '69.4%',
    integrityStatus: 'CRC32 Verified OK',
    entries: [
      {
        name: 'include/pravah/capabilities.h',
        size: 12400,
        compressedSize: 3800,
        ratio: '69.4%',
        crc32: '0x8A12F3D1',
        method: 'Deflate',
        encrypted: false
      },
      {
        name: 'lib/libpravah_kernel.a',
        size: 18200000,
        compressedSize: 5400000,
        ratio: '70.3%',
        crc32: '0x93C4E10B',
        method: 'Deflate',
        encrypted: false
      },
      {
        name: 'lib/libtitan_keystore.so',
        size: 8400000,
        compressedSize: 2100000,
        ratio: '75.0%',
        crc32: '0x1174B8E9',
        method: 'Deflate',
        encrypted: false
      },
      {
        name: 'bin/pravahc',
        size: 14800000,
        compressedSize: 4200000,
        ratio: '71.6%',
        crc32: '0x4D33108E',
        method: 'Deflate',
        encrypted: false
      },
      {
        name: 'README.md',
        size: 6200,
        compressedSize: 2100,
        ratio: '66.1%',
        crc32: '0xEE79010C',
        method: 'Deflate',
        encrypted: false
      },
      {
        name: 'LICENSE',
        size: 1500,
        compressedSize: 600,
        ratio: '60.0%',
        crc32: '0x0548AB9F',
        method: 'Deflate',
        encrypted: false
      }
    ]
  }
};

/**
 * Utility: Format bytes into human-readable string.
 */
export function formatBytes(bytes, decimals = 1) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Utility: Normalize POSIX file path.
 */
export function normalizePath(path) {
  if (!path || path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  const stack = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  return '/' + stack.join('/');
}

/**
 * Utility: Resolve file icon by extension and type.
 */
export function getFileIcon(item) {
  if (item.type === 'directory') return '📁';
  const ext = (item.extension || '').toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'dng':
      return '🖼️';
    case 'mp4':
    case 'mkv':
    case 'webm':
    case 'avi':
      return '🎬';
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
    case 'ogg':
      return '🎵';
    case 'pdf':
      return '📕';
    case 'docx':
    case 'doc':
      return '📘';
    case 'xlsx':
    case 'xls':
      return '📊';
    case 'txt':
    case 'md':
    case 'json':
    case 'xml':
    case 'conf':
      return '📄';
    case 'apk':
    case 'aab':
      return '📦';
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
      return '🗜️';
    case 'bin':
    case 'elf':
    case 'so':
    case 'vmo':
      return '⚙️';
    case 'db':
      return '🗄️';
    case 'sec':
    case 'enc':
    case 'key':
    case 'pfx':
    case 'pem':
      return '🔒';
    default:
      return '📄';
  }
}

/**
 * PravahOS Files & Storage Manager Core Application.
 */
export class FileManagerApp {
  constructor(options = {}) {
    this.container = options.container || null;

    // VFS Tree Initialization (Deep Clone Default VFS)
    this.vfs = JSON.parse(JSON.stringify(options.vfs || DEFAULT_VFS));

    // Capabilities bindings
    const capabilities = options.capabilities || {};
    this.storageCapability = capabilities['storage.fs'] || options.storageFs || null;
    this.vaultCapability = capabilities['crypto.vault'] || options.cryptoVault || null;

    // App Navigation & Display State
    this.currentPath = normalizePath(options.initialPath || '/storage');
    this.activeTab = options.initialTab || 'explorer'; // 'explorer' | 'storage' | 'vault'
    this.selectedCategory = options.initialCategory || null;
    this.searchQuery = '';
    this.viewMode = options.viewMode || 'list'; // 'list' | 'grid'
    this.sortField = 'name'; // 'name' | 'size' | 'modified'
    this.sortOrder = 'asc'; // 'asc' | 'desc'

    // Archive Previewer State
    this.inspectedArchive = null;

    // Titan M2 Hardware Vault State
    this.vaultPin = options.vaultPin || VAULT_DEFAULT_PIN;
    this.vaultUnlocked = false;
    this.vaultAttempts = 0;
    this.vaultMaxAttempts = 5;
    this.vaultPinBuffer = '';
    this.vaultError = null;
    this.vaultItems = JSON.parse(JSON.stringify(options.vaultItems || TITAN_M2_SEALED_VAULT_ITEMS));

    // Storage capacity overview metadata
    this.storageStats = options.storageStats || DEFAULT_STORAGE_BREAKDOWN;

    // History stack for navigation
    this.history = [this.currentPath];
    this.historyIndex = 0;

    // Render if container supplied
    if (this.container) {
      this.render();
    }
  }

  /**
   * Returns storage capacity overview breakdown.
   * Visual breakdown: System (12GB), Apps (18GB), Media (24GB), Documents (4GB), Free (202GB).
   */
  getStorageOverview() {
    if (this.storageCapability && typeof this.storageCapability.getStorageOverview === 'function') {
      return this.storageCapability.getStorageOverview();
    }

    const breakdown = { ...this.storageStats };
    const totalGB = 256;
    const freeGB = breakdown.free && breakdown.free.sizeGB !== undefined ? breakdown.free.sizeGB : 202;
    const usedGB = totalGB - freeGB;

    const calculatePercent = (val) => parseFloat(((val / totalGB) * 100).toFixed(2));

    return {
      totalBytes: STORAGE_TOTAL_BYTES,
      totalGB,
      usedGB,
      freeGB,
      usedPercent: calculatePercent(usedGB),
      freePercent: calculatePercent(freeGB),
      breakdown: {
        system: { ...breakdown.system, percent: calculatePercent(breakdown.system.sizeGB) },
        apps: { ...breakdown.apps, percent: calculatePercent(breakdown.apps.sizeGB) },
        media: { ...breakdown.media, percent: calculatePercent(breakdown.media.sizeGB) },
        documents: { ...breakdown.documents, percent: calculatePercent(breakdown.documents.sizeGB) },
        free: { ...breakdown.free, sizeGB: freeGB, bytes: freeGB * 1024 * 1024 * 1024, percent: calculatePercent(freeGB) }
      },
      formatted: {
        total: `${totalGB} GB`,
        used: `${usedGB} GB`,
        free: `${freeGB} GB`,
        system: `${breakdown.system.sizeGB} GB`,
        apps: `${breakdown.apps.sizeGB} GB`,
        media: `${breakdown.media.sizeGB} GB`,
        documents: `${breakdown.documents.sizeGB} GB`
      }
    };
  }

  /**
   * Resolves a directory node from VFS.
   * Handles alias mapping for /sdcard and /storage/sdcard.
   */
  _resolveVfsPath(path) {
    const normalized = normalizePath(path);
    if (this.vfs[normalized]) return { node: this.vfs[normalized], resolvedPath: normalized };

    // Mirrored alias handling
    if (normalized.startsWith('/storage/sdcard')) {
      const alias = normalized.replace('/storage/sdcard', '/sdcard');
      if (this.vfs[alias]) return { node: this.vfs[alias], resolvedPath: alias };
    }
    if (normalized.startsWith('/storage/emulated/0')) {
      const alias = normalized.replace('/storage/emulated/0', '/sdcard');
      if (this.vfs[alias]) return { node: this.vfs[alias], resolvedPath: alias };
    }
    if (normalized.startsWith('/sdcard')) {
      const alias = normalized.replace('/sdcard', '/storage/sdcard');
      if (this.vfs[alias]) return { node: this.vfs[alias], resolvedPath: alias };
    }

    return { node: null, resolvedPath: normalized };
  }

  /**
   * Returns directory listing for a given path.
   * Includes file metadata: name, path, type, size, permissions, modified timestamp.
   */
  getDirectoryListing(targetPath = this.currentPath) {
    if (this.storageCapability && typeof this.storageCapability.list === 'function') {
      return this.storageCapability.list(targetPath);
    }

    const { node, resolvedPath } = this._resolveVfsPath(targetPath);
    if (!node || node.type !== 'directory') {
      return [];
    }

    const childrenNames = node.children || [];
    const items = [];

    for (const childName of childrenNames) {
      const childFullPath = resolvedPath === '/' ? `/${childName}` : `${resolvedPath}/${childName}`;
      const { node: childNode } = this._resolveVfsPath(childFullPath);
      if (childNode) {
        items.push({
          name: childNode.name || childName,
          path: childFullPath,
          type: childNode.type,
          category: childNode.category || (childNode.type === 'directory' ? 'folder' : 'other'),
          extension: childNode.extension || (childNode.type === 'directory' ? '' : childName.split('.').pop() || ''),
          size: childNode.size || 0,
          formattedSize: childNode.type === 'directory' ? `${(childNode.children || []).length} items` : formatBytes(childNode.size || 0),
          permissions: childNode.permissions || (childNode.type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--'),
          modified: childNode.modified || '2026-11-11T12:00:00Z',
          icon: getFileIcon(childNode)
        });
      }
    }

    // Apply sorting
    return this._sortItems(items);
  }

  /**
   * Sorts item list by active sort field and order.
   */
  _sortItems(items) {
    return [...items].sort((a, b) => {
      // Directories always on top
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;

      let comparison = 0;
      if (this.sortField === 'size') {
        comparison = a.size - b.size;
      } else if (this.sortField === 'modified') {
        comparison = new Date(a.modified).getTime() - new Date(b.modified).getTime();
      } else {
        comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      return this.sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Navigates to a specific path.
   * Normalizes path, validates existence, updates breadcrumbs and UI.
   */
  navigateTo(targetPath) {
    const normalized = normalizePath(targetPath);
    const { node } = this._resolveVfsPath(normalized);

    if (!node || node.type !== 'directory') {
      return false;
    }

    this.currentPath = normalized;
    this.selectedCategory = null;
    this.searchQuery = '';
    this.inspectedArchive = null;

    if (this.history[this.historyIndex] !== normalized) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(normalized);
      this.historyIndex = this.history.length - 1;
    }

    if (this.container) {
      this.render();
    }
    return true;
  }

  /**
   * Navigates to parent directory.
   */
  goUp() {
    if (this.currentPath === '/') {
      return '/';
    }

    const segments = this.currentPath.split('/').filter(Boolean);
    segments.pop();
    const parentPath = segments.length === 0 ? '/' : '/' + segments.join('/');
    this.navigateTo(parentPath);
    return parentPath;
  }

  /**
   * Category quick filters (Downloads, Images, Videos, Audio, Documents, APK Packages).
   * Toggles category filter across storage filesystem.
   */
  filterByCategory(categoryId) {
    if (this.selectedCategory === categoryId) {
      this.selectedCategory = null;
    } else {
      this.selectedCategory = categoryId;
      this.activeTab = 'explorer';
    }

    this.inspectedArchive = null;
    if (this.container) {
      this.render();
    }
    return this.getFilteredCategoryFiles();
  }

  /**
   * Retrieves all files in filesystem matching the selected category.
   */
  getFilteredCategoryFiles(categoryId = this.selectedCategory) {
    if (!categoryId) return [];

    const normCategory = categoryId.toLowerCase();
    const matchingFiles = [];

    const categoryExtensionMap = {
      downloads: ['zip', 'pdf', 'apk', 'bin', 'tar', 'gz'],
      images: ['png', 'jpg', 'jpeg', 'svg', 'dng', 'webp', 'gif'],
      videos: ['mp4', 'mkv', 'webm', 'avi', 'mov'],
      audio: ['flac', 'wav', 'mp3', 'aac', 'ogg', 'm4a'],
      documents: ['pdf', 'docx', 'xlsx', 'txt', 'md', 'json', 'xml', 'conf', 'db'],
      apks: ['apk', 'aab', 'pkg']
    };

    const targetExtensions = categoryExtensionMap[normCategory] || [];

    for (const [filePath, node] of Object.entries(this.vfs)) {
      if (node.type === 'file') {
        const ext = (node.extension || filePath.split('.').pop() || '').toLowerCase();
        const matchesCategory =
          node.category === normCategory ||
          (normCategory === 'downloads' && filePath.includes('/Download/')) ||
          targetExtensions.includes(ext);

        if (matchesCategory) {
          matchingFiles.push({
            name: node.name || filePath.split('/').pop(),
            path: filePath,
            type: 'file',
            category: node.category || normCategory,
            extension: ext,
            size: node.size || 0,
            formattedSize: formatBytes(node.size || 0),
            permissions: node.permissions || '-rw-r--r--',
            modified: node.modified || '2026-11-11T12:00:00Z',
            icon: getFileIcon(node)
          });
        }
      }
    }

    return this._sortItems(matchingFiles);
  }

  /**
   * Recursively searches files across filesystem matching query.
   */
  searchFiles(query, searchRoot = null) {
    const trimmed = (query || '').trim().toLowerCase();
    this.searchQuery = trimmed;

    if (!trimmed) {
      if (this.container) this.render();
      return this.getDirectoryListing(this.currentPath);
    }

    if (this.storageCapability && typeof this.storageCapability.query === 'function') {
      return this.storageCapability.query({ query: trimmed, root: searchRoot });
    }

    const results = [];
    for (const [filePath, node] of Object.entries(this.vfs)) {
      if (searchRoot && !filePath.startsWith(searchRoot)) continue;

      const name = (node.name || filePath.split('/').pop()).toLowerCase();
      const ext = (node.extension || '').toLowerCase();
      const category = (node.category || '').toLowerCase();

      if (name.includes(trimmed) || ext.includes(trimmed) || category.includes(trimmed)) {
        results.push({
          name: node.name || filePath.split('/').pop(),
          path: filePath,
          type: node.type,
          category: node.category || (node.type === 'directory' ? 'folder' : 'other'),
          extension: ext,
          size: node.size || 0,
          formattedSize: node.type === 'directory' ? `${(node.children || []).length} items` : formatBytes(node.size || 0),
          permissions: node.permissions || (node.type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--'),
          modified: node.modified || '2026-11-11T12:00:00Z',
          icon: getFileIcon(node)
        });
      }
    }

    if (this.container) {
      this.render();
    }
    return this._sortItems(results);
  }

  /**
   * Archive Previewer: Simulated ZIP inspection.
   * Extracts ZIP manifest, compression ratio, CRC32, and entry tree.
   */
  previewArchive(archivePath) {
    const normPath = normalizePath(archivePath);

    let inspection = MOCK_ZIP_ARCHIVES[normPath];
    if (!inspection) {
      // Generate synthetic inspection for any archive file
      const fileName = normPath.split('/').pop();
      const { node } = this._resolveVfsPath(normPath);
      const compressedSize = node ? node.size : 14889779;
      const totalUncompressed = Math.round(compressedSize * 3.2);

      inspection = {
        archivePath: normPath,
        archiveName: fileName,
        format: 'ZIP (PKZip 2.0 / Deflate)',
        entryCount: 4,
        totalUncompressedSize: totalUncompressed,
        totalCompressedSize: compressedSize,
        compressionRatio: '68.8%',
        integrityStatus: 'CRC32 Verified OK',
        entries: [
          {
            name: `${fileName.replace(/\.[^/.]+$/, '')}/manifest.json`,
            size: 4096,
            compressedSize: 1200,
            ratio: '70.7%',
            crc32: '0x1F2A3B4C',
            method: 'Deflate',
            encrypted: false
          },
          {
            name: `${fileName.replace(/\.[^/.]+$/, '')}/payload.bin`,
            size: Math.round(totalUncompressed * 0.7),
            compressedSize: Math.round(compressedSize * 0.7),
            ratio: '69.0%',
            crc32: '0x99A8B7C6',
            method: 'Deflate',
            encrypted: false
          },
          {
            name: `${fileName.replace(/\.[^/.]+$/, '')}/checksum.sha256`,
            size: 512,
            compressedSize: 210,
            ratio: '59.0%',
            crc32: '0x5D6E7F80',
            method: 'Deflate',
            encrypted: false
          },
          {
            name: `${fileName.replace(/\.[^/.]+$/, '')}/signature.sig`,
            size: 256,
            compressedSize: 180,
            ratio: '29.7%',
            crc32: '0x4321ABCD',
            method: 'Stored',
            encrypted: false
          }
        ]
      };
    } else {
      inspection.archivePath = normPath;
    }

    this.inspectedArchive = inspection;
    if (this.container) {
      this.render();
    }
    return inspection;
  }

  /**
   * Closes the archive inspection preview view.
   */
  closeArchivePreview() {
    this.inspectedArchive = null;
    if (this.container) {
      this.render();
    }
  }

  /**
   * Titan M2 Hardware Secure Vault: Unlock with PIN.
   * Isolated hardware-encrypted storage requiring PIN unlock (e.g. 1337).
   */
  unlockVault(pin) {
    const inputPin = String(pin || '').trim();

    if (this.vaultCapability && typeof this.vaultCapability.verifyPin === 'function') {
      const result = this.vaultCapability.verifyPin(inputPin);
      if (result && result.success) {
        this.vaultUnlocked = true;
        this.vaultAttempts = 0;
        this.vaultError = null;
        this.vaultPinBuffer = '';
        if (this.container) this.render();
        return { success: true, message: 'Titan M2 Hardware Keystore Unlocked', items: this.vaultItems };
      }
      this.vaultAttempts++;
      this.vaultError = result?.error || 'Invalid PIN. Keystore access denied.';
      if (this.container) this.render();
      return { success: false, error: this.vaultError, remainingAttempts: Math.max(0, this.vaultMaxAttempts - this.vaultAttempts) };
    }

    if (inputPin === this.vaultPin) {
      this.vaultUnlocked = true;
      this.vaultAttempts = 0;
      this.vaultError = null;
      this.vaultPinBuffer = '';
      if (this.container) this.render();
      return {
        success: true,
        message: 'Titan M2 Hardware Keystore Unlocked',
        items: this.vaultItems
      };
    }

    this.vaultAttempts++;
    const remaining = Math.max(0, this.vaultMaxAttempts - this.vaultAttempts);
    this.vaultError = `Invalid Titan M2 PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before hardware lockout.`;
    this.vaultPinBuffer = '';

    if (this.container) {
      this.render();
    }

    return {
      success: false,
      error: this.vaultError,
      remainingAttempts: remaining
    };
  }

  /**
   * Locks the Titan M2 Hardware Secure Vault.
   */
  lockVault() {
    if (this.vaultCapability && typeof this.vaultCapability.lock === 'function') {
      this.vaultCapability.lock();
    }

    this.vaultUnlocked = false;
    this.vaultPinBuffer = '';
    this.vaultError = null;

    if (this.container) {
      this.render();
    }

    return {
      success: true,
      message: 'Titan M2 Hardware Secure Vault Sealed'
    };
  }

  /**
   * Switches the active top-level tab: 'explorer', 'storage', 'vault'.
   */
  switchTab(tab) {
    this.activeTab = tab;
    this.inspectedArchive = null;
    if (this.container) {
      this.render();
    }
  }

  /**
   * Sets view mode: 'list' or 'grid'.
   */
  setViewMode(mode) {
    this.viewMode = mode === 'grid' ? 'grid' : 'list';
    if (this.container) {
      this.render();
    }
  }

  /**
   * Appends digit to keypad PIN buffer.
   */
  enterPinDigit(digit) {
    if (this.vaultPinBuffer.length < 8) {
      this.vaultPinBuffer += String(digit);
      if (this.container) this.render();
    }
  }

  /**
   * Deletes last digit from keypad PIN buffer.
   */
  deletePinDigit() {
    this.vaultPinBuffer = this.vaultPinBuffer.slice(0, -1);
    if (this.container) this.render();
  }

  /**
   * Clears keypad PIN buffer.
   */
  clearPin() {
    this.vaultPinBuffer = '';
    this.vaultError = null;
    if (this.container) this.render();
  }

  /**
   * Submits current PIN buffer for unlocking vault.
   */
  submitPin() {
    return this.unlockVault(this.vaultPinBuffer);
  }

  /**
   * Renders the complete HTML interface into container.
   */
  render() {
    const storageStats = this.getStorageOverview();
    const breadcrumbs = this._renderBreadcrumbsHtml();
    const categoriesHtml = this._renderCategoryChipsHtml();
    const storageBarHtml = this._renderStorageBarHtml(storageStats);

    let mainContentHtml = '';

    if (this.inspectedArchive) {
      mainContentHtml = this._renderArchivePreviewHtml();
    } else if (this.activeTab === 'storage') {
      mainContentHtml = this._renderStorageDetailedViewHtml(storageStats);
    } else if (this.activeTab === 'vault') {
      mainContentHtml = this._renderVaultTabHtml();
    } else {
      mainContentHtml = this._renderExplorerTabHtml();
    }

    const html = `
      <div class="pravah-files-app" data-view-mode="${this.viewMode}" data-active-tab="${this.activeTab}">
        <!-- Top Navigation Bar -->
        <header class="files-header">
          <div class="header-branding">
            <div class="app-icon-badge">📁</div>
            <div class="app-title-group">
              <h1 class="app-title">Files &amp; Storage</h1>
              <span class="kernel-cap-pill">storage.fs • Titan M2 Keystore</span>
            </div>
          </div>

          <div class="header-search-box">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              class="files-search-input" 
              placeholder="Search files, APKs, documents..." 
              value="${this.searchQuery}"
              aria-label="Search files"
            />
            ${this.searchQuery ? '<button class="clear-search-btn" title="Clear search">✕</button>' : ''}
          </div>

          <!-- Tab Navigation Switcher -->
          <nav class="files-nav-tabs">
            <button class="nav-tab-btn ${this.activeTab === 'explorer' && !this.inspectedArchive ? 'active' : ''}" data-tab="explorer">
              📂 Explorer
            </button>
            <button class="nav-tab-btn ${this.activeTab === 'storage' ? 'active' : ''}" data-tab="storage">
              📊 Storage
            </button>
            <button class="nav-tab-btn ${this.activeTab === 'vault' ? 'active' : ''}" data-tab="vault">
              🔒 Titan M2 Vault
            </button>
          </nav>
        </header>

        <!-- Compact Storage Breakdown Banner (Solid Explorer / Files by Google style) -->
        <section class="storage-summary-banner">
          ${storageBarHtml}
        </section>

        <!-- Category Quick Filter Chips -->
        <section class="category-filters-container">
          ${categoriesHtml}
        </section>

        <!-- Dynamic Breadcrumb Navigation Bar (when in explorer mode) -->
        ${this.activeTab === 'explorer' && !this.inspectedArchive ? `
          <div class="explorer-toolbar">
            <div class="breadcrumbs-container">
              <button class="go-up-btn" title="Go up one folder" ${this.currentPath === '/' ? 'disabled' : ''}>
                ⬆️
              </button>
              ${breadcrumbs}
            </div>

            <div class="explorer-view-actions">
              <button class="view-mode-toggle-btn" title="Toggle list/grid view">
                ${this.viewMode === 'list' ? '⊞ Grid' : '☰ List'}
              </button>
            </div>
          </div>
        ` : ''}

        <!-- Main Body Workspace -->
        <main class="files-workspace">
          ${mainContentHtml}
        </main>
      </div>
    `;

    if (this.container) {
      this.container.innerHTML = html;
      this._bindEventListeners();
    }

    return html;
  }

  /**
   * Generates breadcrumbs HTML with clickable segments.
   */
  _renderBreadcrumbsHtml() {
    const segments = this.currentPath.split('/').filter(Boolean);
    let html = `<span class="breadcrumb-item ${this.currentPath === '/' ? 'active' : ''}" data-path="/">Root /</span>`;

    let accumulatedPath = '';
    for (let i = 0; i < segments.length; i++) {
      accumulatedPath += '/' + segments[i];
      const isLast = i === segments.length - 1;
      html += `
        <span class="breadcrumb-separator">›</span>
        <span class="breadcrumb-item ${isLast ? 'active' : ''}" data-path="${accumulatedPath}">
          ${segments[i]}
        </span>
      `;
    }

    return `<nav class="breadcrumbs-nav">${html}</nav>`;
  }

  /**
   * Generates Category Filter Chips HTML.
   */
  _renderCategoryChipsHtml() {
    return `
      <div class="category-chips-row">
        ${FILE_CATEGORIES.map(cat => {
          const isSelected = this.selectedCategory === cat.id;
          const count = this.getFilteredCategoryFiles(cat.id).length;
          return `
            <button 
              class="category-chip ${isSelected ? 'active' : ''}" 
              data-category="${cat.id}"
              style="--chip-accent: ${cat.color};"
            >
              <span class="chip-icon">${cat.icon}</span>
              <span class="chip-label">${cat.label}</span>
              <span class="chip-count-badge">${count}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  /**
   * Generates Capacity Gauge Bar HTML (Files by Google / Solid Explorer style).
   */
  _renderStorageBarHtml(stats) {
    const { breakdown, formatted, usedPercent, freePercent } = stats;

    return `
      <div class="storage-gauge-card">
        <div class="gauge-header-row">
          <div class="gauge-title-group">
            <span class="gauge-title">Storage Breakdown</span>
            <span class="gauge-usage-highlight">${formatted.used} used of ${formatted.total} (${formatted.free} free)</span>
          </div>
          <span class="gauge-percent-badge">${usedPercent}% Used</span>
        </div>

        <div class="storage-segmented-bar" role="progressbar" aria-valuenow="${usedPercent}" aria-valuemin="0" aria-valuemax="100">
          <div class="bar-segment system" style="width: ${breakdown.system.percent}%; background-color: ${breakdown.system.color};" title="System: ${breakdown.system.sizeGB}GB (${breakdown.system.percent}%)"></div>
          <div class="bar-segment apps" style="width: ${breakdown.apps.percent}%; background-color: ${breakdown.apps.color};" title="Apps: ${breakdown.apps.sizeGB}GB (${breakdown.apps.percent}%)"></div>
          <div class="bar-segment media" style="width: ${breakdown.media.percent}%; background-color: ${breakdown.media.color};" title="Media: ${breakdown.media.sizeGB}GB (${breakdown.media.percent}%)"></div>
          <div class="bar-segment documents" style="width: ${breakdown.documents.percent}%; background-color: ${breakdown.documents.color};" title="Documents: ${breakdown.documents.sizeGB}GB (${breakdown.documents.percent}%)"></div>
          <div class="bar-segment free" style="width: ${breakdown.free.percent}%; background-color: ${breakdown.free.color};" title="Free: ${breakdown.free.sizeGB}GB (${breakdown.free.percent}%)"></div>
        </div>

        <div class="gauge-legend-row">
          <div class="legend-pill" style="--legend-color: ${breakdown.system.color};">
            <span class="legend-dot"></span>
            <span class="legend-name">System</span>
            <span class="legend-size">${breakdown.system.sizeGB} GB</span>
          </div>
          <div class="legend-pill" style="--legend-color: ${breakdown.apps.color};">
            <span class="legend-dot"></span>
            <span class="legend-name">Apps</span>
            <span class="legend-size">${breakdown.apps.sizeGB} GB</span>
          </div>
          <div class="legend-pill" style="--legend-color: ${breakdown.media.color};">
            <span class="legend-dot"></span>
            <span class="legend-name">Media</span>
            <span class="legend-size">${breakdown.media.sizeGB} GB</span>
          </div>
          <div class="legend-pill" style="--legend-color: ${breakdown.documents.color};">
            <span class="legend-dot"></span>
            <span class="legend-name">Documents</span>
            <span class="legend-size">${breakdown.documents.sizeGB} GB</span>
          </div>
          <div class="legend-pill" style="--legend-color: ${breakdown.free.color};">
            <span class="legend-dot"></span>
            <span class="legend-name">Free</span>
            <span class="legend-size">${breakdown.free.sizeGB} GB</span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Generates Explorer File Grid / List HTML.
   */
  _renderExplorerTabHtml() {
    let items = [];
    let scopeNotice = '';

    if (this.selectedCategory) {
      items = this.getFilteredCategoryFiles();
      scopeNotice = `Showing all <strong>${this.selectedCategory.toUpperCase()}</strong> across device storage`;
    } else if (this.searchQuery) {
      items = this.searchFiles(this.searchQuery);
      scopeNotice = `Search results for <strong>"${this.searchQuery}"</strong> (${items.length} found)`;
    } else {
      items = this.getDirectoryListing(this.currentPath);
    }

    if (items.length === 0) {
      return `
        <div class="empty-directory-state">
          <div class="empty-state-icon">📂</div>
          <h3>No items found</h3>
          <p class="empty-state-sub">${this.searchQuery ? 'Try another search query or clear filters.' : 'This directory is empty or contains no accessible files.'}</p>
        </div>
      `;
    }

    return `
      ${scopeNotice ? `<div class="explorer-scope-banner">${scopeNotice}</div>` : ''}
      <div class="files-items-container ${this.viewMode}">
        ${items.map(item => {
          const isZip = item.extension === 'zip';
          return `
            <div 
              class="file-item-card ${item.type}" 
              data-path="${item.path}" 
              data-type="${item.type}"
              data-extension="${item.extension || ''}"
              tabindex="0"
            >
              <div class="file-item-icon-area">
                <span class="file-glyph">${item.icon}</span>
              </div>
              <div class="file-item-info">
                <div class="file-name-row">
                  <span class="file-name" title="${item.name}">${item.name}</span>
                  ${isZip ? '<span class="zip-inspect-badge">Inspect ZIP</span>' : ''}
                </div>
                <div class="file-meta-row">
                  <span class="file-size">${item.formattedSize}</span>
                  <span class="file-permissions">${item.permissions}</span>
                  <span class="file-date">${item.modified.slice(0, 10)}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  /**
   * Generates Archive Preview Modal HTML.
   */
  _renderArchivePreviewHtml() {
    const archive = this.inspectedArchive;
    if (!archive) return '';

    return `
      <div class="archive-preview-card">
        <div class="archive-preview-header">
          <div class="archive-title-group">
            <span class="archive-icon">🗜️</span>
            <div>
              <h2 class="archive-name">${archive.archiveName}</h2>
              <span class="archive-format-tag">${archive.format} • ${archive.integrityStatus}</span>
            </div>
          </div>
          <button class="close-archive-btn" title="Back to explorer">✕ Close</button>
        </div>

        <div class="archive-stats-grid">
          <div class="archive-stat-box">
            <span class="stat-label">Total Entries</span>
            <span class="stat-value">${archive.entryCount} files</span>
          </div>
          <div class="archive-stat-box">
            <span class="stat-label">Compressed Size</span>
            <span class="stat-value">${formatBytes(archive.totalCompressedSize)}</span>
          </div>
          <div class="archive-stat-box">
            <span class="stat-label">Uncompressed Size</span>
            <span class="stat-value">${formatBytes(archive.totalUncompressedSize)}</span>
          </div>
          <div class="archive-stat-box highlight">
            <span class="stat-label">Space Saved</span>
            <span class="stat-value">${archive.compressionRatio}</span>
          </div>
        </div>

        <div class="archive-entries-list">
          <div class="archive-entries-header">
            <span>Entry Name</span>
            <span>Ratio</span>
            <span>CRC-32</span>
            <span>Uncompressed</span>
          </div>
          ${archive.entries.map(entry => `
            <div class="archive-entry-row">
              <span class="entry-name" title="${entry.name}">📄 ${entry.name}</span>
              <span class="entry-ratio">${entry.ratio}</span>
              <span class="entry-crc"><code>${entry.crc32}</code></span>
              <span class="entry-size">${formatBytes(entry.size)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Generates Titan M2 Secure Vault Tab HTML.
   */
  _renderVaultTabHtml() {
    if (!this.vaultUnlocked) {
      // Locked State View with Keypad
      return `
        <div class="vault-locked-container">
          <div class="vault-lock-badge">
            <div class="titan-shield-icon">🛡️</div>
            <span class="titan-status-pill">TITAN M2 SECURE ENCLAVE</span>
          </div>

          <h2 class="vault-title">Hardware Secure Vault</h2>
          <p class="vault-subtext">Isolated hardware-encrypted storage protected by Google Titan M2 root-of-trust. Enter your secure PIN to de-obfuscate confidential documents.</p>

          <div class="vault-pin-display">
            <div class="pin-dots">
              ${[0, 1, 2, 3].map(i => `<span class="pin-dot ${i < this.vaultPinBuffer.length ? 'filled' : ''}"></span>`).join('')}
            </div>
          </div>

          ${this.vaultError ? `<div class="vault-error-banner">⚠️ ${this.vaultError}</div>` : ''}

          <div class="vault-keypad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => `
              <button class="keypad-btn" data-digit="${num}">${num}</button>
            `).join('')}
            <button class="keypad-btn action clear" data-action="clear">C</button>
            <button class="keypad-btn" data-digit="0">0</button>
            <button class="keypad-btn action unlock" data-action="submit">🔓</button>
          </div>

          <div class="vault-enclave-metadata">
            <span class="enclave-tag">HARDWARE: Titan M2 Rev 3.2</span>
            <span class="enclave-tag">CIPHER: AES-256-GCM / Kyber-768</span>
            <span class="enclave-tag">TRNG: SP800-90B Physical</span>
          </div>
        </div>
      `;
    }

    // Unlocked Vault State View
    return `
      <div class="vault-unlocked-container">
        <div class="vault-unlocked-header">
          <div class="vault-status-group">
            <div class="unlocked-shield-icon">🛡️</div>
            <div>
              <h2 class="unlocked-title">Titan M2 Hardware Vault [UNLOCKED]</h2>
              <span class="unlocked-subtitle">Sealed Keystore Root #0x9F4B • 5 Confidential Documents Decrypted</span>
            </div>
          </div>
          <button class="lock-vault-btn" title="Seal vault in hardware enclave">🔒 Seal Vault</button>
        </div>

        <div class="vault-sealed-items-grid">
          ${this.vaultItems.map(item => `
            <div class="vault-item-card" data-id="${item.id}">
              <div class="vault-item-top">
                <span class="vault-file-icon">🔐</span>
                <div class="vault-file-tags">
                  <span class="vault-cipher-tag">${item.cipher.split('/')[0]}</span>
                  <span class="vault-status-tag">${item.status}</span>
                </div>
              </div>

              <h3 class="vault-file-name">${item.name}</h3>
              <p class="vault-file-label">${item.label}</p>
              <p class="vault-file-desc">${item.description}</p>

              <div class="vault-item-footer">
                <span class="vault-item-size">${formatBytes(item.size)}</span>
                <span class="vault-item-time">Sealed: ${item.sealedAt}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Generates Storage Tab detailed statistics view HTML.
   */
  _renderStorageDetailedViewHtml(stats) {
    const { breakdown, formatted, usedPercent, freePercent } = stats;

    return `
      <div class="storage-detailed-view">
        <div class="storage-hero-card">
          <div class="donut-chart-container">
            <svg class="donut-svg" viewBox="0 0 100 100">
              <circle class="donut-track" cx="50" cy="50" r="40" stroke="#1c2538" stroke-width="12" fill="transparent"></circle>
              <circle 
                class="donut-segment" 
                cx="50" cy="50" r="40" 
                stroke="#00e5ff" 
                stroke-width="12" 
                stroke-dasharray="${usedPercent * 2.512} 251.2" 
                stroke-linecap="round" 
                fill="transparent"
                transform="rotate(-90 50 50)"
              ></circle>
            </svg>
            <div class="donut-center-label">
              <span class="donut-val">${usedPercent}%</span>
              <span class="donut-text">Used</span>
            </div>
          </div>

          <div class="storage-hero-stats">
            <h2 class="hero-title">Internal Storage Capacity</h2>
            <p class="hero-sub">${formatted.used} used of ${formatted.total} total NVMe storage</p>
            <div class="hero-free-pill">
              <span>💾 Free Space Available:</span>
              <strong>${formatted.free} (${freePercent}%)</strong>
            </div>
          </div>
        </div>

        <div class="storage-categories-breakdown-grid">
          ${Object.values(breakdown).map(item => `
            <div class="category-breakdown-card" style="--cat-color: ${item.color};">
              <div class="cat-card-header">
                <span class="cat-icon">${item.icon}</span>
                <span class="cat-percent">${item.percent}%</span>
              </div>
              <h3 class="cat-label">${item.label}</h3>
              <span class="cat-size">${item.sizeGB} GB</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Binds interactive DOM events.
   */
  _bindEventListeners() {
    if (!this.container) return;

    // Tab buttons
    const tabBtns = this.container.querySelectorAll ? this.container.querySelectorAll('.nav-tab-btn') : [];
    if (tabBtns.forEach) {
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-tab');
          if (tab) this.switchTab(tab);
        });
      });
    }

    // Category chips
    const categoryChips = this.container.querySelectorAll ? this.container.querySelectorAll('.category-chip') : [];
    if (categoryChips.forEach) {
      categoryChips.forEach(chip => {
        chip.addEventListener('click', () => {
          const cat = chip.getAttribute('data-category');
          if (cat) this.filterByCategory(cat);
        });
      });
    }

    // Breadcrumb buttons
    const breadcrumbItems = this.container.querySelectorAll ? this.container.querySelectorAll('.breadcrumb-item') : [];
    if (breadcrumbItems.forEach) {
      breadcrumbItems.forEach(item => {
        item.addEventListener('click', () => {
          const path = item.getAttribute('data-path');
          if (path) this.navigateTo(path);
        });
      });
    }

    // Go Up button
    const goUpBtn = this.container.querySelector ? this.container.querySelector('.go-up-btn') : null;
    if (goUpBtn) {
      goUpBtn.addEventListener('click', () => this.goUp());
    }

    // View mode toggle button
    const viewModeBtn = this.container.querySelector ? this.container.querySelector('.view-mode-toggle-btn') : null;
    if (viewModeBtn) {
      viewModeBtn.addEventListener('click', () => {
        this.setViewMode(this.viewMode === 'list' ? 'grid' : 'list');
      });
    }

    // File item click / navigate / inspect
    const fileItems = this.container.querySelectorAll ? this.container.querySelectorAll('.file-item-card') : [];
    if (fileItems.forEach) {
      fileItems.forEach(item => {
        item.addEventListener('click', () => {
          const path = item.getAttribute('data-path');
          const type = item.getAttribute('data-type');
          const ext = item.getAttribute('data-extension');

          if (type === 'directory') {
            this.navigateTo(path);
          } else if (ext === 'zip') {
            this.previewArchive(path);
          }
        });
      });
    }

    // Close Archive Preview
    const closeArchiveBtn = this.container.querySelector ? this.container.querySelector('.close-archive-btn') : null;
    if (closeArchiveBtn) {
      closeArchiveBtn.addEventListener('click', () => this.closeArchivePreview());
    }

    // Search input
    const searchInput = this.container.querySelector ? this.container.querySelector('.files-search-input') : null;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target ? e.target.value : searchInput.value || '';
        this.searchFiles(val);
      });
    }

    // Clear search
    const clearSearchBtn = this.container.querySelector ? this.container.querySelector('.clear-search-btn') : null;
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        this.searchFiles('');
      });
    }

    // Vault Keypad Digits
    const digitBtns = this.container.querySelectorAll ? this.container.querySelectorAll('.keypad-btn[data-digit]') : [];
    if (digitBtns.forEach) {
      digitBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const digit = btn.getAttribute('data-digit');
          if (digit !== null) this.enterPinDigit(digit);
        });
      });
    }

    // Vault Keypad Actions (clear, submit)
    const actionBtns = this.container.querySelectorAll ? this.container.querySelectorAll('.keypad-btn[data-action]') : [];
    if (actionBtns.forEach) {
      actionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.getAttribute('data-action');
          if (act === 'clear') this.clearPin();
          if (act === 'submit') this.submitPin();
        });
      });
    }

    // Lock Vault button
    const lockVaultBtn = this.container.querySelector ? this.container.querySelector('.lock-vault-btn') : null;
    if (lockVaultBtn) {
      lockVaultBtn.addEventListener('click', () => this.lockVault());
    }
  }
}

export default FileManagerApp;
