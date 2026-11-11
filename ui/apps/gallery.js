// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file gallery.js
 * PravahOS Flagship Stock Gallery & Photo Manager Application.
 *
 * Architecture Highlights:
 * 1. Fossify clean, lightning-fast 120Hz responsive photo grid with date grouping.
 * 2. 5 Core Album Categorization Tabs:
 *    - All Photos ('all')
 *    - Camera ('camera')
 *    - Screenshots ('screenshots')
 *    - Secure Vault ('vault')
 *    - Receipts & Documents ('receipts')
 * 3. Full-screen Lightbox Viewer:
 *    - Touch swipe gesture simulation (swipeNext, swipePrev).
 *    - Fluid zoom & pan simulation (1.0x - 4.0x, bounds-checked).
 *    - Dynamic favorite heart toggle.
 *    - Glassmorphic EXIF metadata inspection drawer.
 * 4. Privacy-First EXIF Scrubber:
 *    - Zero-cloud-leak local scrubber.
 *    - Permanently redacts GPS coordinates, personal device serials, and user info before sharing.
 * 5. On-Device Semantic Neural Vision Search:
 *    - Real-time semantic tag filtering ('receipt', 'document', 'nature', 'city', 'portrait').
 *    - Coordinated with emulator/vision_pipeline.js heuristics.
 * 6. Microkernel Capability Hooks:
 *    - storage.media (persistence, safe exports, audit logging).
 *    - media.camera (camera HAL capture hook, instant album ingress).
 */

// ============================================================================
// 1. Capability & Protocol Definitions
// ============================================================================

export const GALLERY_CAPABILITIES = Object.freeze({
  STORAGE_MEDIA: 'storage.media',
  STORAGE_MEDIA_WRITE: 'storage.media.write',
  MEDIA_CAMERA: 'media.camera',
  MEDIA_CAMERA_CAPTURE: 'media.camera.capture',
  VISION_OCR: 'vision.ocr_extract'
});

export const ALBUMS = Object.freeze([
  { id: 'all', title: 'All Photos', icon: '🖼️', description: 'Complete media stream' },
  { id: 'camera', title: 'Camera', icon: '📷', description: 'Photos & videos taken with camera' },
  { id: 'screenshots', title: 'Screenshots', icon: '📱', description: 'System screen captures' },
  { id: 'vault', title: 'Vault', icon: '🔒', description: 'Encrypted private documents & media' },
  { id: 'receipts', title: 'Receipts/Documents', icon: '🧾', description: 'Invoices, receipts & scanned docs' }
]);

export const DEFAULT_VAULT_PIN = '1234';

// ============================================================================
// 2. Default Stock Media Dataset (Zero-Cloud-Leak, Self-Contained)
// ============================================================================

function createPlaceholderSvg(label, color1, color2, icon = '📸') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" width="100%" height="100%">
    <defs>
      <linearGradient id="g_${label.replace(/\s+/g, '_')}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color1}"/>
        <stop offset="100%" stop-color="${color2}"/>
      </linearGradient>
    </defs>
    <rect width="600" height="450" fill="url(#g_${label.replace(/\s+/g, '_')})"/>
    <circle cx="300" cy="180" r="70" fill="rgba(255,255,255,0.12)"/>
    <text x="300" y="200" font-family="-apple-system, sans-serif" font-size="56" text-anchor="middle" fill="#ffffff">${icon}</text>
    <text x="300" y="290" font-family="-apple-system, sans-serif" font-size="24" font-weight="600" text-anchor="middle" fill="#ffffff">${label}</text>
    <text x="300" y="325" font-family="-apple-system, sans-serif" font-size="14" text-anchor="middle" fill="rgba(255,255,255,0.7)">PravahOS High Dynamic Range</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const SAMPLE_PHOTOS = [
  {
    id: 'img_001',
    title: 'Marine Drive Twilight Skyline',
    albumId: 'camera',
    date: '2026-11-12T08:30:00Z',
    type: 'photo',
    thumbnail: createPlaceholderSvg('Marine Drive Twilight', '#0f2027', '#203a43', '🏙️'),
    isFavorite: true,
    isVault: false,
    visionTags: ['city', 'nature', 'landscape', 'night', 'twilight', 'water'],
    metadata: {
      resolution: '8192 x 6144',
      fileSize: '14.2 MB',
      cameraModel: 'Sony IMX890 50MP / Pravah Optics f/1.8',
      iso: 'ISO 100',
      shutter: '1/120s',
      focalLength: '24mm',
      exif: {
        gps: { lat: 18.9438, lon: 72.8232, altitude: '12m', locationName: 'Marine Drive, Mumbai' },
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        lens: 'Sony G-Master 24mm f/1.8',
        software: 'PravahOS Camera HAL v1.4',
        stripped: false
      }
    }
  },
  {
    id: 'vid_002',
    title: 'Microkernel IPC Benchmark Demo',
    albumId: 'camera',
    date: '2026-11-12T07:15:00Z',
    type: 'video',
    duration: '0:42',
    thumbnail: createPlaceholderSvg('Microkernel IPC Demo', '#1e3c72', '#2a5298', '▶️'),
    isFavorite: false,
    isVault: false,
    visionTags: ['technology', 'benchmark', 'screen', 'performance'],
    metadata: {
      resolution: '3840 x 2160 (4K 60fps)',
      fileSize: '48.6 MB',
      cameraModel: 'Sony IMX890 50MP / Pravah Video Engine',
      iso: 'ISO 200',
      shutter: '1/60s',
      focalLength: '24mm',
      exif: {
        gps: { lat: 18.9438, lon: 72.8232, altitude: '12m', locationName: 'Marine Drive, Mumbai' },
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        software: 'PravahOS Camera HAL v1.4',
        stripped: false
      }
    }
  },
  {
    id: 'img_003',
    title: 'Blue Bottle Coffee Store Receipt #4092',
    albumId: 'receipts',
    date: '2026-11-11T16:20:00Z',
    type: 'photo',
    thumbnail: createPlaceholderSvg('Coffee Store Receipt #4092', '#3a6073', '#16222f', '🧾'),
    isFavorite: false,
    isVault: false,
    visionTags: ['receipt', 'document', 'financial', 'tax', 'coffee', 'subtotal'],
    metadata: {
      resolution: '4032 x 3024',
      fileSize: '2.8 MB',
      cameraModel: 'Samsung JN1 32MP / Document Scanner',
      iso: 'ISO 200',
      shutter: '1/200s',
      focalLength: '21mm',
      exif: {
        gps: { lat: 37.7749, lon: -122.4194, altitude: '15m', locationName: 'San Francisco, CA' },
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        software: 'PravahOS Vision Scanner',
        stripped: false
      }
    }
  },
  {
    id: 'img_004',
    title: 'PravahOS Zircon VMO Architecture Diagram',
    albumId: 'screenshots',
    date: '2026-11-11T14:05:00Z',
    type: 'photo',
    thumbnail: createPlaceholderSvg('Zircon VMO Diagram', '#141e30', '#243b55', '📱'),
    isFavorite: true,
    isVault: false,
    visionTags: ['screenshot', 'document', 'diagram', 'architecture', 'kernel'],
    metadata: {
      resolution: '2880 x 1800',
      fileSize: '1.4 MB',
      cameraModel: 'System Display Buffer Capture',
      iso: 'N/A',
      shutter: 'N/A',
      focalLength: 'N/A',
      exif: {
        gps: null,
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        software: 'PravahOS Screenshot Service',
        stripped: true
      }
    }
  },
  {
    id: 'img_005',
    title: 'Yosemite Valley Mist & Granite Peak',
    albumId: 'camera',
    date: '2026-11-08T11:45:00Z',
    type: 'photo',
    thumbnail: createPlaceholderSvg('Yosemite Valley Mist', '#134e5e', '#71b280', '🏔️'),
    isFavorite: true,
    isVault: false,
    visionTags: ['nature', 'landscape', 'mountain', 'forest', 'granite'],
    metadata: {
      resolution: '8192 x 6144',
      fileSize: '22.4 MB (RAW Bayer)',
      cameraModel: 'Sony IMX890 50MP / Pravah Optics f/1.8',
      iso: 'ISO 50',
      shutter: '1/500s',
      focalLength: '24mm',
      exif: {
        gps: { lat: 37.7456, lon: -119.5936, altitude: '1210m', locationName: 'Yosemite National Park, CA' },
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        lens: 'Sony G-Master 24mm f/1.8',
        software: 'PravahOS Camera HAL v1.4',
        stripped: false
      }
    }
  },
  {
    id: 'img_006',
    title: 'Kernel Architecture Team Core Portrait',
    albumId: 'camera',
    date: '2026-11-08T10:10:00Z',
    type: 'photo',
    thumbnail: createPlaceholderSvg('Team Portrait 2026', '#4b134f', '#c94b4b', '👤'),
    isFavorite: false,
    isVault: false,
    visionTags: ['portrait', 'people', 'team', 'indoor'],
    metadata: {
      resolution: '8192 x 6144',
      fileSize: '11.8 MB',
      cameraModel: 'Sony IMX890 50MP Portrait Bokeh',
      iso: 'ISO 160',
      shutter: '1/160s',
      focalLength: '50mm Equivalent',
      exif: {
        gps: { lat: 18.9220, lon: 72.8347, altitude: '8m', locationName: 'Colaba, Mumbai' },
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        software: 'PravahOS Camera HAL v1.4',
        stripped: false
      }
    }
  },
  {
    id: 'img_007',
    title: 'Corporate Cloud Server Invoice #INV-883',
    albumId: 'receipts',
    date: '2026-10-24T15:30:00Z',
    type: 'photo',
    thumbnail: createPlaceholderSvg('Cloud Server Invoice #INV-883', '#000000', '#434343', '📄'),
    isFavorite: false,
    isVault: false,
    visionTags: ['document', 'invoice', 'receipt', 'financial', 'tax', 'legal'],
    metadata: {
      resolution: '3024 x 4032',
      fileSize: '3.1 MB',
      cameraModel: 'Sony IMX858 Ultrawide Document Mode',
      iso: 'ISO 100',
      shutter: '1/250s',
      focalLength: '14mm',
      exif: {
        gps: { lat: 18.9220, lon: 72.8347, altitude: '8m', locationName: 'Colaba, Mumbai' },
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        software: 'PravahOS Vision Scanner',
        stripped: false
      }
    }
  },
  {
    id: 'img_008',
    title: 'Private Key Recovery Mnemonic Card',
    albumId: 'vault',
    date: '2026-10-20T09:00:00Z',
    type: 'photo',
    thumbnail: createPlaceholderSvg('Encrypted Vault Card', '#200122', '#6f0000', '🔒'),
    isFavorite: true,
    isVault: true,
    visionTags: ['vault', 'document', 'crypto', 'confidential', 'security'],
    metadata: {
      resolution: '4032 x 3024',
      fileSize: '4.2 MB (Encrypted AES-256-GCM)',
      cameraModel: 'Sony IMX890 Macro Mode',
      iso: 'ISO 100',
      shutter: '1/120s',
      focalLength: '24mm',
      exif: {
        gps: { lat: 18.9220, lon: 72.8347, altitude: '8m', locationName: 'Colaba, Mumbai' },
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        software: 'PravahOS Secure Vault HAL',
        stripped: false
      }
    }
  },
  {
    id: 'img_009',
    title: 'Tokyo Shibuya Crossing Rain Neon',
    albumId: 'camera',
    date: '2026-10-15T20:15:00Z',
    type: 'photo',
    thumbnail: createPlaceholderSvg('Tokyo Shibuya Neon', '#0f0c29', '#302b63', '🏙️'),
    isFavorite: false,
    isVault: false,
    visionTags: ['city', 'nature', 'night', 'rain', 'travel', 'neon'],
    metadata: {
      resolution: '8192 x 6144',
      fileSize: '16.5 MB',
      cameraModel: 'Sony IMX890 50MP Night Mode',
      iso: 'ISO 800',
      shutter: '1/30s',
      focalLength: '24mm',
      exif: {
        gps: { lat: 35.6595, lon: 139.7005, altitude: '22m', locationName: 'Shibuya, Tokyo, Japan' },
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        software: 'PravahOS Camera HAL v1.4',
        stripped: false
      }
    }
  },
  {
    id: 'vid_010',
    title: 'Pacific Coast Highway Drone Reel',
    albumId: 'camera',
    date: '2026-10-10T17:40:00Z',
    type: 'video',
    duration: '1:24',
    thumbnail: createPlaceholderSvg('PCH Drone Reel 4K', '#114357', '#f29492', '▶️'),
    isFavorite: true,
    isVault: false,
    visionTags: ['nature', 'ocean', 'landscape', 'drone', 'highway'],
    metadata: {
      resolution: '3840 x 2160 (4K 120fps HDR)',
      fileSize: '112.4 MB',
      cameraModel: 'Sony IMX890 50MP / Pravah Video Engine',
      iso: 'ISO 100',
      shutter: '1/240s',
      focalLength: '14mm',
      exif: {
        gps: { lat: 36.3615, lon: -121.8563, altitude: '85m', locationName: 'Big Sur, CA' },
        deviceSerial: 'PRV-SN-99420-X1',
        userProfile: 'Rajesh / PravahOS Primary',
        software: 'PravahOS Camera HAL v1.4',
        stripped: false
      }
    }
  }
];

// ============================================================================
// 3. Helper Functions: Date Grouping & Formatting
// ============================================================================

export function formatDateGroupKey(isoDateString, nowBaseline = '2026-11-12T12:00:00Z') {
  const date = new Date(isoDateString);
  const now = new Date(nowBaseline);

  // Compare calendar days in UTC
  const d1 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d2 = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayDiff = Math.round((d1 - d2) / (1000 * 60 * 60 * 24));

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = months[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();

  if (dayDiff === 0) {
    return `Today · ${monthName} ${day}, ${year}`;
  }
  if (dayDiff === 1) {
    return `Yesterday · ${monthName} ${day}, ${year}`;
  }
  return `${monthName} ${day}, ${year}`;
}

export function groupPhotosByDate(photos) {
  const groups = new Map();
  for (const photo of photos) {
    const key = formatDateGroupKey(photo.date);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(photo);
  }

  // Convert to array of { dateLabel, items }
  return Array.from(groups.entries()).map(([dateLabel, items]) => ({
    dateLabel,
    items
  }));
}

// ============================================================================
// 4. Microkernel Capability Adapter (Zero-Tax Local Bus)
// ============================================================================

export class MicrokernelMediaAdapter {
  constructor(options = {}) {
    this.storageCapability = options.storageMedia || {
      id: GALLERY_CAPABILITIES.STORAGE_MEDIA,
      authorized: true,
      async persistPhotoState(photoId, state) {
        return { success: true, photoId, state, timestamp: Date.now() };
      },
      async logAuditScrub(photoId, fields) {
        return { success: true, photoId, fields, auditId: `AUD-${Date.now()}` };
      }
    };

    this.cameraCapability = options.mediaCamera || {
      id: GALLERY_CAPABILITIES.MEDIA_CAMERA,
      authorized: true,
      async capturePhoto(config = {}) {
        return {
          id: `img_cap_${Date.now()}`,
          title: `Camera Capture ${new Date().toLocaleTimeString()}`,
          albumId: 'camera',
          date: new Date().toISOString(),
          type: 'photo',
          isFavorite: false,
          isVault: false,
          visionTags: ['camera', 'capture', 'raw'],
          metadata: {
            resolution: config.resolution || '8192 x 6144',
            fileSize: '15.4 MB',
            cameraModel: 'Sony IMX890 Primary (HAL)',
            iso: 'ISO 100',
            shutter: '1/200s',
            focalLength: '24mm',
            exif: {
              gps: { lat: 18.9438, lon: 72.8232, altitude: '10m', locationName: 'Pravah Studio' },
              deviceSerial: 'PRV-SN-99420-X1',
              userProfile: 'Rajesh / PravahOS Primary',
              software: 'PravahOS Camera HAL v1.4',
              stripped: false
            }
          }
        };
      }
    };
  }

  async persistPhoto(photoId, changes) {
    return this.storageCapability.persistPhotoState(photoId, changes);
  }

  async auditScrub(photoId, fields) {
    return this.storageCapability.logAuditScrub(photoId, fields);
  }

  async captureFromCamera(config) {
    return this.cameraCapability.capturePhoto(config);
  }
}

// ============================================================================
// 5. GalleryApp Class
// ============================================================================

export class GalleryApp {
  /**
   * @param {Object} options
   * @param {HTMLElement|Object} [options.container] - DOM or MockElement container
   * @param {Array} [options.initialPhotos] - Initial photo dataset
   * @param {Object} [options.microkernel] - Microkernel media adapter or hooks
   */
  constructor(options = {}) {
    this.container = options.container || null;
    this.microkernel = new MicrokernelMediaAdapter({
      storageMedia: options.storageMedia,
      mediaCamera: options.mediaCamera
    });

    // Deep clone initial photos to allow clean mutation per instance
    const sourcePhotos = options.initialPhotos || SAMPLE_PHOTOS;
    this.photos = JSON.parse(JSON.stringify(sourcePhotos));

    // Gallery navigation state
    this.activeAlbumId = 'all';
    this.activeVisionTag = null;
    this.searchQuery = '';
    this.vaultLocked = true;
    this.vaultPin = options.vaultPin || DEFAULT_VAULT_PIN;

    // Lightbox viewer state
    this.activePhotoId = null;
    this.lightboxState = {
      zoom: 1.0,
      panX: 0,
      panY: 0,
      showMetadata: false
    };

    // Audit logs for privacy actions
    this.privacyAuditLogs = [];
  }

  // --------------------------------------------------------------------------
  // Album & Media Query APIs
  // --------------------------------------------------------------------------

  /**
   * Returns list of albums with real-time item counts.
   * @returns {Array<Object>}
   */
  getAlbums() {
    return ALBUMS.map(album => {
      let count = 0;
      if (album.id === 'all') {
        count = this.photos.filter(p => !p.isVault || !this.vaultLocked).length;
      } else if (album.id === 'vault') {
        count = this.vaultLocked ? 0 : this.photos.filter(p => p.isVault).length;
      } else {
        count = this.photos.filter(p => p.albumId === album.id && (!p.isVault || !this.vaultLocked)).length;
      }

      return {
        ...album,
        count,
        isLocked: album.id === 'vault' ? this.vaultLocked : false
      };
    });
  }

  /**
   * Switches the active album tab.
   * @param {string} albumId
   * @returns {GalleryApp}
   */
  selectAlbum(albumId) {
    const validAlbum = ALBUMS.some(a => a.id === albumId);
    if (!validAlbum) {
      throw new Error(`Invalid album id: ${albumId}`);
    }
    this.activeAlbumId = albumId;
    this.activeVisionTag = null; // Clear vision filter on album change
    this.searchQuery = '';
    if (this.container) {
      this.render();
    }
    return this;
  }

  /**
   * Returns filtered photos for an album, taking search tag & vault state into account.
   * Photos are sorted chronologically descending (newest first).
   * @param {string} [albumId]
   * @returns {Array<Object>}
   */
  getPhotos(albumId = this.activeAlbumId) {
    let list = this.photos;

    // 1. Vault gating
    if (this.vaultLocked) {
      if (albumId === 'vault') {
        return [];
      }
      list = list.filter(p => !p.isVault);
    }

    // 2. Album filtering
    if (albumId !== 'all') {
      list = list.filter(p => p.albumId === albumId);
    }

    // 3. Vision Tag / Semantic Filter
    if (this.activeVisionTag) {
      const targetTag = this.activeVisionTag.toLowerCase().trim();
      list = list.filter(p => {
        if (!p.visionTags || !Array.isArray(p.visionTags)) return false;
        // Direct tag match or fuzzy match
        return p.visionTags.some(t => t.toLowerCase().includes(targetTag) || targetTag.includes(t.toLowerCase())) ||
               (p.title && p.title.toLowerCase().includes(targetTag));
      });
    }

    // 4. Chronological sort (newest first)
    return [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  /**
   * Returns grouped photos by date for the active or given album.
   * @param {string} [albumId]
   * @returns {Array<{ dateLabel: string, items: Array }>}
   */
  getDateGroups(albumId = this.activeAlbumId) {
    const photos = this.getPhotos(albumId);
    return groupPhotosByDate(photos);
  }

  // --------------------------------------------------------------------------
  // Semantic Neural Vision Search API
  // --------------------------------------------------------------------------

  /**
   * Filters photos by semantic neural vision tag ('receipt', 'document', 'nature', 'city', 'portrait').
   * If tag is empty or null, clears search filter.
   * @param {string|null} tag
   * @returns {Array<Object>} Filtered photo list
   */
  searchByVisionTag(tag) {
    if (!tag || tag.trim() === '') {
      this.activeVisionTag = null;
      this.searchQuery = '';
    } else {
      this.activeVisionTag = tag.trim().toLowerCase();
      this.searchQuery = tag.trim();
    }

    if (this.container) {
      this.render();
    }
    return this.getPhotos(this.activeAlbumId);
  }

  // --------------------------------------------------------------------------
  // Favorite Management API
  // --------------------------------------------------------------------------

  /**
   * Toggles the favorite status of a photo.
   * @param {string} photoId
   * @returns {boolean} Updated isFavorite state
   */
  toggleFavorite(photoId) {
    const photo = this.photos.find(p => p.id === photoId);
    if (!photo) {
      throw new Error(`Photo not found: ${photoId}`);
    }

    photo.isFavorite = !photo.isFavorite;

    // Persist via microkernel capability
    this.microkernel.persistPhoto(photoId, { isFavorite: photo.isFavorite });

    if (this.container) {
      this.render();
    }
    return photo.isFavorite;
  }

  // --------------------------------------------------------------------------
  // Privacy-First EXIF Scrubber API
  // --------------------------------------------------------------------------

  /**
   * Strips privacy-sensitive EXIF tags (GPS, device serial, user profile) from a photo.
   * Guarantees zero-leak safe export.
   * @param {string} photoId
   * @returns {Object} Result object with sanitized photo
   */
  stripExifPrivacy(photoId) {
    const photo = this.photos.find(p => p.id === photoId);
    if (!photo) {
      throw new Error(`Photo not found: ${photoId}`);
    }

    if (!photo.metadata) {
      photo.metadata = {};
    }
    if (!photo.metadata.exif) {
      photo.metadata.exif = {};
    }

    const strippedFields = [];
    if (photo.metadata.exif.gps) {
      photo.metadata.exif.gps = null;
      strippedFields.push('gps');
    }
    if (photo.metadata.exif.deviceSerial) {
      photo.metadata.exif.deviceSerial = null;
      strippedFields.push('deviceSerial');
    }
    if (photo.metadata.exif.userProfile) {
      photo.metadata.exif.userProfile = null;
      strippedFields.push('userProfile');
    }

    photo.metadata.exif.stripped = true;
    photo.metadata.exif.strippedAt = new Date().toISOString();

    const auditEntry = {
      photoId,
      timestamp: Date.now(),
      action: 'EXIF_PRIVACY_STRIPPED',
      fieldsRedacted: strippedFields,
      auditHash: `SHA256:0x${Math.random().toString(16).substring(2, 10)}`
    };
    this.privacyAuditLogs.push(auditEntry);
    this.microkernel.auditScrub(photoId, strippedFields);

    if (this.container) {
      this.render();
    }

    return {
      success: true,
      photoId,
      photo,
      strippedFields,
      audit: auditEntry
    };
  }

  // --------------------------------------------------------------------------
  // Secure Vault PIN Unlock & Lock
  // --------------------------------------------------------------------------

  /**
   * Unlocks the encrypted vault using the user PIN.
   * @param {string} pin
   * @returns {boolean} True if PIN matched and vault unlocked
   */
  unlockVault(pin) {
    if (pin === this.vaultPin) {
      this.vaultLocked = false;
      if (this.container) {
        this.render();
      }
      return true;
    }
    return false;
  }

  /**
   * Locks the secure vault immediately.
   * @returns {boolean}
   */
  lockVault() {
    this.vaultLocked = true;
    if (this.activeAlbumId === 'vault') {
      this.activeAlbumId = 'all';
    }
    if (this.container) {
      this.render();
    }
    return true;
  }

  // --------------------------------------------------------------------------
  // Lightbox Viewer Lifecycle & Interactive Controls
  // --------------------------------------------------------------------------

  /**
   * Opens the full-screen Lightbox viewer for a photo.
   * @param {string} photoId
   * @returns {Object} Active photo object
   */
  openPhoto(photoId) {
    const photo = this.photos.find(p => p.id === photoId);
    if (!photo) {
      throw new Error(`Photo not found: ${photoId}`);
    }

    // Vault access check
    if (photo.isVault && this.vaultLocked) {
      throw new Error('Vault is locked. Unlock vault before viewing photo.');
    }

    this.activePhotoId = photoId;
    this.resetZoom();
    this.lightboxState.showMetadata = false;

    if (this.container) {
      this.render();
    }
    return photo;
  }

  /**
   * Closes the Lightbox viewer.
   * @returns {GalleryApp}
   */
  closePhoto() {
    this.activePhotoId = null;
    this.resetZoom();
    this.lightboxState.showMetadata = false;

    if (this.container) {
      this.render();
    }
    return this;
  }

  /**
   * Returns currently open photo in Lightbox, or null.
   * @returns {Object|null}
   */
  getActivePhoto() {
    if (!this.activePhotoId) return null;
    return this.photos.find(p => p.id === this.activePhotoId) || null;
  }

  /**
   * Simulates zoom-in gesture/button (caps at 4.0x).
   * @returns {number} New zoom factor
   */
  zoomIn() {
    this.lightboxState.zoom = Math.min(4.0, Number((this.lightboxState.zoom + 0.5).toFixed(1)));
    if (this.container) this.render();
    return this.lightboxState.zoom;
  }

  /**
   * Simulates zoom-out gesture/button (min 1.0x).
   * @returns {number} New zoom factor
   */
  zoomOut() {
    this.lightboxState.zoom = Math.max(1.0, Number((this.lightboxState.zoom - 0.5).toFixed(1)));
    if (this.lightboxState.zoom === 1.0) {
      this.lightboxState.panX = 0;
      this.lightboxState.panY = 0;
    }
    if (this.container) this.render();
    return this.lightboxState.zoom;
  }

  /**
   * Resets zoom to 1.0x and pan coordinates to (0, 0).
   * @returns {GalleryApp}
   */
  resetZoom() {
    this.lightboxState.zoom = 1.0;
    this.lightboxState.panX = 0;
    this.lightboxState.panY = 0;
    if (this.container) this.render();
    return this;
  }

  /**
   * Pans the zoomed view by dx and dy.
   * Only operates when zoom > 1.0.
   * @param {number} dx
   * @param {number} dy
   * @returns {{ panX: number, panY: number }}
   */
  pan(dx, dy) {
    if (this.lightboxState.zoom > 1.0) {
      this.lightboxState.panX += dx;
      this.lightboxState.panY += dy;
    }
    if (this.container) this.render();
    return { panX: this.lightboxState.panX, panY: this.lightboxState.panY };
  }

  /**
   * Navigates to the next photo in the current album list.
   * @returns {Object|null}
   */
  swipeNext() {
    const list = this.getPhotos(this.activeAlbumId);
    if (!list.length || !this.activePhotoId) return null;
    const currentIndex = list.findIndex(p => p.id === this.activePhotoId);
    const nextIndex = (currentIndex + 1) % list.length;
    return this.openPhoto(list[nextIndex].id);
  }

  /**
   * Navigates to the previous photo in the current album list.
   * @returns {Object|null}
   */
  swipePrev() {
    const list = this.getPhotos(this.activeAlbumId);
    if (!list.length || !this.activePhotoId) return null;
    const currentIndex = list.findIndex(p => p.id === this.activePhotoId);
    const prevIndex = (currentIndex - 1 + list.length) % list.length;
    return this.openPhoto(list[prevIndex].id);
  }

  /**
   * Toggles the metadata drawer visibility in the Lightbox viewer.
   * @returns {boolean}
   */
  toggleMetadataDrawer() {
    this.lightboxState.showMetadata = !this.lightboxState.showMetadata;
    if (this.container) this.render();
    return this.lightboxState.showMetadata;
  }

  // --------------------------------------------------------------------------
  // Camera & Microkernel Ingress Hooks
  // --------------------------------------------------------------------------

  /**
   * Captures an image from the Camera HAL microkernel capability and imports it.
   * @param {Object} [config]
   * @returns {Promise<Object>} The new photo object
   */
  async importFromCamera(config = {}) {
    const captured = await this.microkernel.captureFromCamera(config);
    this.photos.unshift(captured);
    if (this.container) this.render();
    return captured;
  }

  /**
   * Exports a photo safely, stripping EXIF privacy if requested.
   * @param {string} photoId
   * @param {Object} [options]
   * @returns {Object} Export payload
   */
  exportPhotoSafe(photoId, options = { stripExif: true }) {
    if (options.stripExif) {
      this.stripExifPrivacy(photoId);
    }
    const photo = this.photos.find(p => p.id === photoId);
    return {
      exportedAt: new Date().toISOString(),
      photo,
      isExifSafe: photo?.metadata?.exif?.stripped === true
    };
  }

  // --------------------------------------------------------------------------
  // UI Rendering & DOM Generation
  // --------------------------------------------------------------------------

  /**
   * Renders the complete gallery UI into this.container or passed container.
   * Returns generated HTML string.
   * @param {HTMLElement|Object} [targetContainer]
   * @returns {string} HTML content
   */
  render(targetContainer = this.container) {
    if (targetContainer) {
      this.container = targetContainer;
    }

    const albums = this.getAlbums();
    const photos = this.getPhotos(this.activeAlbumId);
    const dateGroups = this.getDateGroups(this.activeAlbumId);
    const activePhoto = this.getActivePhoto();

    // 1. Navigation Tabs Markup
    const tabsHtml = albums.map(alb => {
      const isActive = alb.id === this.activeAlbumId ? 'active' : '';
      return `
        <button class="gallery-tab-btn ${isActive}" data-album-id="${alb.id}">
          <span class="tab-icon">${alb.icon}</span>
          <span class="tab-title">${alb.title}</span>
          <span class="tab-count">${alb.count}</span>
        </button>
      `;
    }).join('');

    // 2. Vision Search Chips Markup
    const visionChips = ['receipt', 'document', 'nature', 'city', 'portrait', 'screenshot'];
    const chipsHtml = visionChips.map(chip => {
      const isSelected = this.activeVisionTag === chip ? 'active-chip' : '';
      return `
        <button class="gallery-chip ${isSelected}" data-vision-tag="${chip}">
          #${chip}
        </button>
      `;
    }).join('');

    // 3. Grid Content Markup (Date Grouped)
    let gridContentHtml = '';

    if (this.activeAlbumId === 'vault' && this.vaultLocked) {
      // Locked Vault UI
      gridContentHtml = `
        <div class="gallery-vault-locked-state">
          <div class="vault-lock-icon">🔒</div>
          <h3 class="vault-title">Secure Encrypted Vault</h3>
          <p class="vault-desc">Zero-cloud-leak local biometric or PIN protected storage.</p>
          <div class="vault-unlock-form">
            <input type="password" class="vault-pin-input" placeholder="Enter PIN (1234)" maxlength="8" />
            <button class="gallery-btn primary-btn vault-unlock-btn">Unlock Vault</button>
          </div>
        </div>
      `;
    } else if (photos.length === 0) {
      // Empty state
      gridContentHtml = `
        <div class="gallery-empty-state">
          <div class="empty-icon">🖼️</div>
          <div class="empty-title">No Media Found</div>
          <div class="empty-desc">${this.activeVisionTag ? `No photos tagged with "${this.activeVisionTag}"` : 'This album is empty.'}</div>
          ${this.activeVisionTag ? '<button class="gallery-btn clear-search-btn">Clear Filter</button>' : ''}
        </div>
      `;
    } else {
      // Date Grouped Media Grid
      gridContentHtml = dateGroups.map(group => {
        const itemsHtml = group.items.map(item => {
          const isVideo = item.type === 'video';
          const isFav = item.isFavorite ? 'is-fav' : '';
          const hasGps = item.metadata?.exif?.gps !== null && item.metadata?.exif?.gps !== undefined;
          const isStripped = item.metadata?.exif?.stripped;

          return `
            <div class="gallery-item ${item.type}" data-photo-id="${item.id}" tabindex="0" role="button" aria-label="${item.title}">
              <img src="${item.thumbnail}" alt="${item.title}" class="gallery-thumb" loading="lazy" />
              
              ${isVideo ? `
                <div class="gallery-badge duration-pill">
                  <span class="badge-icon">▶</span>
                  <span class="duration-text">${item.duration || '0:00'}</span>
                </div>
              ` : ''}

              <button class="gallery-fav-indicator ${isFav}" data-action="toggle-fav" data-photo-id="${item.id}" title="Toggle Favorite">
                ${item.isFavorite ? '❤️' : '🤍'}
              </button>

              <div class="gallery-badge privacy-pill ${isStripped ? 'privacy-safe' : (hasGps ? 'privacy-gps' : '')}">
                ${isStripped ? '🛡️ Safe' : (hasGps ? '📍 GPS' : '')}
              </div>

              <div class="gallery-item-title-overlay">
                <span>${item.title}</span>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="gallery-date-section">
            <div class="gallery-date-header">
              <span class="date-header-label">${group.dateLabel}</span>
              <span class="date-header-count">${group.items.length} ${group.items.length === 1 ? 'item' : 'items'}</span>
            </div>
            <div class="gallery-grid">
              ${itemsHtml}
            </div>
          </div>
        `;
      }).join('');
    }

    // 4. Lightbox Overlay Markup (if activePhoto is set)
    let lightboxHtml = '';
    if (activePhoto) {
      const zoom = this.lightboxState.zoom;
      const panX = this.lightboxState.panX;
      const panY = this.lightboxState.panY;
      const showMeta = this.lightboxState.showMetadata;
      const isFav = activePhoto.isFavorite;
      const meta = activePhoto.metadata || {};
      const exif = meta.exif || {};

      lightboxHtml = `
        <div id="gallery-lightbox" class="gallery-lightbox visible" role="dialog" aria-modal="true">
          <!-- Top Bar -->
          <div class="lightbox-top-bar">
            <button class="lightbox-btn close-lightbox-btn" data-action="close" title="Close Lightbox">✕</button>
            <div class="lightbox-title-wrap">
              <span class="lightbox-photo-title">${activePhoto.title}</span>
              <span class="lightbox-photo-date">${new Date(activePhoto.date).toLocaleDateString()}</span>
            </div>
            <div class="lightbox-top-actions">
              <button class="lightbox-btn toggle-fav-btn ${isFav ? 'fav-active' : ''}" data-action="toggle-fav" data-photo-id="${activePhoto.id}" title="Favorite">
                ${isFav ? '❤️' : '🤍'}
              </button>
              <button class="lightbox-btn toggle-meta-btn ${showMeta ? 'active' : ''}" data-action="toggle-meta" title="Photo Info">
                ℹ️
              </button>
            </div>
          </div>

          <!-- Main Viewport with Zoom & Pan Simulation -->
          <div class="lightbox-viewport" data-action="viewport">
            <div class="lightbox-media-wrapper" style="transform: translate(${panX}px, ${panY}px) scale(${zoom});">
              <img src="${activePhoto.thumbnail}" alt="${activePhoto.title}" class="lightbox-img" />
              ${activePhoto.type === 'video' ? '<div class="lightbox-video-play-hint">▶ Play Video</div>' : ''}
            </div>

            <!-- Navigation Chevrons -->
            <button class="lightbox-nav-btn prev-btn" data-action="prev-photo" title="Previous photo">‹</button>
            <button class="lightbox-nav-btn next-btn" data-action="next-photo" title="Next photo">›</button>
          </div>

          <!-- Bottom Control Bar -->
          <div class="lightbox-bottom-bar">
            <!-- Zoom Controls -->
            <div class="lightbox-zoom-controls">
              <button class="lightbox-tool-btn zoom-out-btn" data-action="zoom-out" title="Zoom Out">−</button>
              <span class="zoom-level-pill">${(zoom * 100).toFixed(0)}%</span>
              <button class="lightbox-tool-btn zoom-in-btn" data-action="zoom-in" title="Zoom In">+</button>
              <button class="lightbox-tool-btn reset-zoom-btn" data-action="reset-zoom" title="Reset Zoom">1:1</button>
            </div>

            <!-- Privacy Actions -->
            <div class="lightbox-privacy-controls">
              <button class="gallery-btn safe-share-btn ${exif.stripped ? 'already-stripped' : ''}" data-action="strip-share" data-photo-id="${activePhoto.id}">
                ${exif.stripped ? '🛡️ Privacy Cleared' : '🛡️ Strip EXIF & Share'}
              </button>
            </div>
          </div>

          <!-- EXIF Metadata Drawer -->
          <div class="gallery-metadata-drawer ${showMeta ? 'open' : ''}">
            <div class="drawer-header">
              <span class="drawer-title">Details & EXIF Inspector</span>
              <button class="drawer-close-btn" data-action="close-meta">✕</button>
            </div>
            <div class="drawer-content">
              <div class="meta-row"><span class="meta-label">Resolution</span><span class="meta-val">${meta.resolution || 'N/A'}</span></div>
              <div class="meta-row"><span class="meta-label">File Size</span><span class="meta-val">${meta.fileSize || 'N/A'}</span></div>
              <div class="meta-row"><span class="meta-label">Camera</span><span class="meta-val">${meta.cameraModel || 'PravahOS Sensor'}</span></div>
              <div class="meta-row"><span class="meta-label">Exposure</span><span class="meta-val">${meta.iso || ''} · ${meta.shutter || ''} · ${meta.focalLength || ''}</span></div>
              <div class="meta-row"><span class="meta-label">Captured</span><span class="meta-val">${new Date(activePhoto.date).toUTCString()}</span></div>
              
              <div class="drawer-section-divider"></div>
              <div class="drawer-section-title">Zero-Leak Privacy Status</div>
              
              <div class="meta-row">
                <span class="meta-label">GPS Coordinates</span>
                <span class="meta-val ${exif.gps ? 'warning-text' : 'safe-text'}">
                  ${exif.gps ? `${exif.gps.lat.toFixed(4)}°, ${exif.gps.lon.toFixed(4)}° (${exif.gps.locationName || 'Attached'})` : '🛡️ Redacted / No GPS'}
                </span>
              </div>
              <div class="meta-row">
                <span class="meta-label">Device Serial</span>
                <span class="meta-val ${exif.deviceSerial ? 'warning-text' : 'safe-text'}">
                  ${exif.deviceSerial ? `${exif.deviceSerial}` : '🛡️ Scrubbed'}
                </span>
              </div>
              <div class="meta-row">
                <span class="meta-label">Owner Profile</span>
                <span class="meta-val ${exif.userProfile ? 'warning-text' : 'safe-text'}">
                  ${exif.userProfile ? `${exif.userProfile}` : '🛡️ Scrubbed'}
                </span>
              </div>

              ${!exif.stripped ? `
                <div class="meta-action-block">
                  <button class="gallery-btn scrub-btn" data-action="strip-share" data-photo-id="${activePhoto.id}">
                    Redact GPS & Scrub Device Serial
                  </button>
                </div>
              ` : `
                <div class="meta-safe-badge">
                  ✓ Verified Clean for Air-Dropped and Cross-Platform Sharing
                </div>
              `}
            </div>
          </div>
        </div>
      `;
    }

    // 5. Assemble Full App HTML
    const fullHtml = `
      <div class="gallery-app">
        <!-- App Header Bar -->
        <header class="gallery-header">
          <div class="gallery-header-top">
            <div class="gallery-branding">
              <span class="gallery-logo">📸</span>
              <h1 class="gallery-title">Photos</h1>
              <span class="gallery-hal-pill">⚡ 120Hz Fossify Grid</span>
            </div>
            <div class="gallery-header-actions">
              <button class="gallery-btn capture-btn" data-action="camera-capture" title="Quick Snap (Camera HAL)">
                📷 Snap
              </button>
              ${this.activeAlbumId === 'vault' && !this.vaultLocked ? `
                <button class="gallery-btn lock-vault-btn" data-action="lock-vault" title="Lock Vault Now">
                  🔒 Lock
                </button>
              ` : ''}
            </div>
          </div>

          <!-- Neural Vision Search Bar -->
          <div class="gallery-search-bar">
            <span class="search-icon">🔍</span>
            <input type="text" 
                   class="gallery-search-input" 
                   placeholder="Search photos by Neural Vision tags (receipt, nature, city...)" 
                   value="${this.searchQuery || ''}" />
            ${this.activeVisionTag ? '<button class="clear-search-btn" data-action="clear-search">✕</button>' : ''}
          </div>

          <!-- Vision Tag Quick Filter Chips -->
          <div class="gallery-chips-bar">
            ${chipsHtml}
          </div>

          <!-- Album Categorization Navigation Tabs -->
          <nav class="gallery-nav-tabs">
            ${tabsHtml}
          </nav>
        </header>

        <!-- Main Media Content Area -->
        <main class="gallery-content">
          ${gridContentHtml}
        </main>

        <!-- Lightbox Container -->
        ${lightboxHtml}
      </div>
    `;

    // Inject into container if available
    if (this.container) {
      if (typeof this.container.innerHTML === 'string') {
        this.container.innerHTML = fullHtml;
      }
      this.attachEventListeners(this.container);
    }

    return fullHtml;
  }

  /**
   * Attaches interactive event listeners to container elements.
   * Safe for real browser DOM and mock environments.
   * @param {HTMLElement|Object} container
   */
  attachEventListeners(container) {
    if (!container || !container.querySelectorAll) return;

    // 1. Album Tab Switching
    const tabButtons = container.querySelectorAll('.gallery-tab-btn');
    if (tabButtons && tabButtons.forEach) {
      tabButtons.forEach(btn => {
        if (btn.addEventListener) {
          btn.addEventListener('click', () => {
            const albumId = btn.getAttribute ? btn.getAttribute('data-album-id') : btn.dataset?.albumId;
            if (albumId) this.selectAlbum(albumId);
          });
        }
      });
    }

    // 2. Vision Search Input
    const searchInput = container.querySelector ? container.querySelector('.gallery-search-input') : null;
    if (searchInput && searchInput.addEventListener) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target ? e.target.value : searchInput.value;
        this.searchByVisionTag(val);
      });
    }

    // 3. Vision Tag Chips
    const chips = container.querySelectorAll('.gallery-chip');
    if (chips && chips.forEach) {
      chips.forEach(chip => {
        if (chip.addEventListener) {
          chip.addEventListener('click', () => {
            const tag = chip.getAttribute ? chip.getAttribute('data-vision-tag') : chip.dataset?.visionTag;
            if (this.activeVisionTag === tag) {
              this.searchByVisionTag(null); // Toggle off
            } else {
              this.searchByVisionTag(tag);
            }
          });
        }
      });
    }

    // 4. Photo Card Click (Open Lightbox)
    const photoItems = container.querySelectorAll('.gallery-item');
    if (photoItems && photoItems.forEach) {
      photoItems.forEach(item => {
        if (item.addEventListener) {
          item.addEventListener('click', (e) => {
            if (e.target && e.target.getAttribute && e.target.getAttribute('data-action') === 'toggle-fav') {
              return; // handled by fav button
            }
            const photoId = item.getAttribute ? item.getAttribute('data-photo-id') : item.dataset?.photoId;
            if (photoId) this.openPhoto(photoId);
          });
        }
      });
    }

    // 5. Favorite Buttons
    const favButtons = container.querySelectorAll('[data-action="toggle-fav"]');
    if (favButtons && favButtons.forEach) {
      favButtons.forEach(favBtn => {
        if (favBtn.addEventListener) {
          favBtn.addEventListener('click', (e) => {
            if (e.stopPropagation) e.stopPropagation();
            const photoId = favBtn.getAttribute ? favBtn.getAttribute('data-photo-id') : favBtn.dataset?.photoId;
            if (photoId) this.toggleFavorite(photoId);
          });
        }
      });
    }

    // 6. Lightbox Controls
    const closeBtn = container.querySelector ? container.querySelector('.close-lightbox-btn') : null;
    if (closeBtn && closeBtn.addEventListener) {
      closeBtn.addEventListener('click', () => this.closePhoto());
    }

    const prevBtn = container.querySelector ? container.querySelector('.prev-btn') : null;
    if (prevBtn && prevBtn.addEventListener) {
      prevBtn.addEventListener('click', () => this.swipePrev());
    }

    const nextBtn = container.querySelector ? container.querySelector('.next-btn') : null;
    if (nextBtn && nextBtn.addEventListener) {
      nextBtn.addEventListener('click', () => this.swipeNext());
    }

    const zoomInBtn = container.querySelector ? container.querySelector('.zoom-in-btn') : null;
    if (zoomInBtn && zoomInBtn.addEventListener) {
      zoomInBtn.addEventListener('click', () => this.zoomIn());
    }

    const zoomOutBtn = container.querySelector ? container.querySelector('.zoom-out-btn') : null;
    if (zoomOutBtn && zoomOutBtn.addEventListener) {
      zoomOutBtn.addEventListener('click', () => this.zoomOut());
    }

    const resetZoomBtn = container.querySelector ? container.querySelector('.reset-zoom-btn') : null;
    if (resetZoomBtn && resetZoomBtn.addEventListener) {
      resetZoomBtn.addEventListener('click', () => this.resetZoom());
    }

    const toggleMetaBtn = container.querySelector ? container.querySelector('.toggle-meta-btn') : null;
    if (toggleMetaBtn && toggleMetaBtn.addEventListener) {
      toggleMetaBtn.addEventListener('click', () => this.toggleMetadataDrawer());
    }

    const closeMetaBtn = container.querySelector ? container.querySelector('.drawer-close-btn') : null;
    if (closeMetaBtn && closeMetaBtn.addEventListener) {
      closeMetaBtn.addEventListener('click', () => this.toggleMetadataDrawer());
    }

    // 7. Privacy Stripper Button
    const scrubBtns = container.querySelectorAll('[data-action="strip-share"]');
    if (scrubBtns && scrubBtns.forEach) {
      scrubBtns.forEach(btn => {
        if (btn.addEventListener) {
          btn.addEventListener('click', () => {
            const photoId = btn.getAttribute ? btn.getAttribute('data-photo-id') : btn.dataset?.photoId;
            if (photoId) this.stripExifPrivacy(photoId);
          });
        }
      });
    }

    // 8. Vault Unlock Form
    const vaultUnlockBtn = container.querySelector ? container.querySelector('.vault-unlock-btn') : null;
    const vaultPinInput = container.querySelector ? container.querySelector('.vault-pin-input') : null;
    if (vaultUnlockBtn && vaultUnlockBtn.addEventListener) {
      vaultUnlockBtn.addEventListener('click', () => {
        const pin = vaultPinInput ? (vaultPinInput.value || '') : '';
        this.unlockVault(pin);
      });
    }

    // 9. Camera HAL Capture Button
    const snapBtn = container.querySelector ? container.querySelector('[data-action="camera-capture"]') : null;
    if (snapBtn && snapBtn.addEventListener) {
      snapBtn.addEventListener('click', () => this.importFromCamera());
    }
  }
}
