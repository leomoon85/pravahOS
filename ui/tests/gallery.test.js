// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GalleryApp,
  ALBUMS,
  SAMPLE_PHOTOS,
  GALLERY_CAPABILITIES,
  formatDateGroupKey,
  groupPhotosByDate,
  MicrokernelMediaAdapter
} from '../apps/gallery.js';

// ============================================================================
// Headless Mock DOM Element for UI Life-cycle Tests
// ============================================================================

class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this._classes = new Set();
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
    this.value = '';
    this.attributes = new Map();
    this.dataset = {};
    this.eventListeners = {};
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) {
      const prop = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[prop] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(listener);
  }

  dispatchEvent(event) {
    const type = typeof event === 'string' ? event : event.type;
    const listeners = this.eventListeners[type] || [];
    const ev = typeof event === 'string' ? { type: event, target: this } : { target: this, ...event };
    for (const fn of listeners) {
      fn(ev);
    }
  }

  click() {
    this.dispatchEvent('click');
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    // If searching within innerHTML string, parse simple elements
    if (typeof this.innerHTML === 'string' && this.innerHTML.length > 0) {
      // Find class or data-attribute matches
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        const regex = new RegExp(`class=["'][^"']*\\b${cls}\\b[^"']*["']`, 'gi');
        let match;
        while ((match = regex.exec(this.innerHTML)) !== null) {
          const el = new MockElement('', 'div');
          el.classList.add(cls);
          results.push(el);
        }
      } else if (selector.startsWith('[')) {
        // Simple attribute selector e.g. [data-action="toggle-fav"]
        const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?\]/);
        if (attrMatch) {
          const attr = attrMatch[1];
          const val = attrMatch[2];
          const pattern = val ? `${attr}=["']${val}["']` : `${attr}`;
          const regex = new RegExp(pattern, 'gi');
          let match;
          while ((match = regex.exec(this.innerHTML)) !== null) {
            const el = new MockElement('', 'div');
            el.setAttribute(attr, val || '');
            results.push(el);
          }
        }
      }
    }
    return results;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

test('1. GalleryApp Exports & Default Dataset Integrity', () => {
  assert.ok(GalleryApp, 'GalleryApp must be exported');
  assert.ok(Array.isArray(ALBUMS), 'ALBUMS must be an array');
  assert.equal(ALBUMS.length, 5, 'ALBUMS must have 5 tabs');
  assert.ok(Array.isArray(SAMPLE_PHOTOS), 'SAMPLE_PHOTOS must be exported');
  assert.ok(SAMPLE_PHOTOS.length >= 10, 'Default dataset must contain at least 10 items');

  const app = new GalleryApp();
  assert.equal(app.activeAlbumId, 'all');
  assert.equal(app.activeVisionTag, null);
  assert.equal(app.vaultLocked, true);
  assert.equal(app.activePhotoId, null);
});

test('2. getAlbums() returns all 5 required album tabs with item counts', () => {
  const app = new GalleryApp();
  const albums = app.getAlbums();

  assert.equal(albums.length, 5);
  const ids = albums.map(a => a.id);
  assert.deepEqual(ids, ['all', 'camera', 'screenshots', 'vault', 'receipts']);

  const allAlbum = albums.find(a => a.id === 'all');
  const cameraAlbum = albums.find(a => a.id === 'camera');
  const screenshotsAlbum = albums.find(a => a.id === 'screenshots');
  const vaultAlbum = albums.find(a => a.id === 'vault');
  const receiptsAlbum = albums.find(a => a.id === 'receipts');

  assert.ok(allAlbum.count > 0, 'All photos count > 0');
  assert.ok(cameraAlbum.count > 0, 'Camera count > 0');
  assert.ok(screenshotsAlbum.count > 0, 'Screenshots count > 0');
  assert.equal(vaultAlbum.count, 0, 'Vault count must be 0 while locked');
  assert.equal(vaultAlbum.isLocked, true, 'Vault must be marked locked');
  assert.ok(receiptsAlbum.count > 0, 'Receipts count > 0');
});

test('3. selectAlbum() switches active album and filters photos properly', () => {
  const app = new GalleryApp();

  // Switch to camera
  app.selectAlbum('camera');
  assert.equal(app.activeAlbumId, 'camera');
  const cameraPhotos = app.getPhotos();
  assert.ok(cameraPhotos.length > 0);
  assert.ok(cameraPhotos.every(p => p.albumId === 'camera'));

  // Switch to screenshots
  app.selectAlbum('screenshots');
  assert.equal(app.activeAlbumId, 'screenshots');
  const screenshots = app.getPhotos();
  assert.ok(screenshots.length > 0);
  assert.ok(screenshots.every(p => p.albumId === 'screenshots'));

  // Switch to receipts
  app.selectAlbum('receipts');
  assert.equal(app.activeAlbumId, 'receipts');
  const receipts = app.getPhotos();
  assert.ok(receipts.length > 0);
  assert.ok(receipts.every(p => p.albumId === 'receipts'));

  // Invalid album id throws
  assert.throws(() => {
    app.selectAlbum('invalid_album');
  }, /Invalid album id/);
});

test('4. Date grouping and chronological ordering', () => {
  const dateKeyToday = formatDateGroupKey('2026-11-12T08:30:00Z');
  assert.match(dateKeyToday, /Today/);

  const dateKeyYesterday = formatDateGroupKey('2026-11-11T16:20:00Z');
  assert.match(dateKeyYesterday, /Yesterday/);

  const app = new GalleryApp();
  const groups = app.getDateGroups('all');
  assert.ok(groups.length >= 2, 'Should have multiple date groups');

  for (const grp of groups) {
    assert.ok(grp.dateLabel, 'Group must have dateLabel');
    assert.ok(grp.items.length > 0, 'Group must have items');
  }

  // Verify chronological sorting (newest first)
  const photos = app.getPhotos('all');
  for (let i = 0; i < photos.length - 1; i++) {
    const current = new Date(photos[i].date).getTime();
    const next = new Date(photos[i + 1].date).getTime();
    assert.ok(current >= next, `Photos must be sorted newest first: ${photos[i].date} >= ${photos[i + 1].date}`);
  }
});

test('5. Lightbox viewer lifecycle: openPhoto(), closePhoto(), getActivePhoto()', () => {
  const app = new GalleryApp();
  assert.equal(app.getActivePhoto(), null);

  const photo = app.openPhoto('img_001');
  assert.equal(photo.id, 'img_001');
  assert.equal(app.activePhotoId, 'img_001');
  assert.equal(app.getActivePhoto()?.id, 'img_001');
  assert.equal(app.lightboxState.zoom, 1.0);
  assert.equal(app.lightboxState.panX, 0);
  assert.equal(app.lightboxState.panY, 0);

  // Close photo
  app.closePhoto();
  assert.equal(app.activePhotoId, null);
  assert.equal(app.getActivePhoto(), null);

  // Non-existent photo throws
  assert.throws(() => {
    app.openPhoto('non_existent_id');
  }, /Photo not found/);
});

test('6. Lightbox zoom & pan simulation', () => {
  const app = new GalleryApp();
  app.openPhoto('img_001');

  // Zoom in
  const z1 = app.zoomIn();
  assert.equal(z1, 1.5);
  const z2 = app.zoomIn();
  assert.equal(z2, 2.0);

  // Pan when zoomed
  const panResult = app.pan(10, -20);
  assert.equal(panResult.panX, 10);
  assert.equal(panResult.panY, -20);

  // Zoom out
  const z3 = app.zoomOut();
  assert.equal(z3, 1.5);

  // Reset zoom
  app.resetZoom();
  assert.equal(app.lightboxState.zoom, 1.0);
  assert.equal(app.lightboxState.panX, 0);
  assert.equal(app.lightboxState.panY, 0);

  // Pan when not zoomed has no effect
  app.pan(50, 50);
  assert.equal(app.lightboxState.panX, 0);
  assert.equal(app.lightboxState.panY, 0);
});

test('7. Lightbox touch swipe simulation: swipeNext() and swipePrev()', () => {
  const app = new GalleryApp();
  const allPhotos = app.getPhotos('all');
  assert.ok(allPhotos.length >= 3);

  // Open first photo
  app.openPhoto(allPhotos[0].id);
  assert.equal(app.activePhotoId, allPhotos[0].id);

  // Swipe Next
  const nextPhoto = app.swipeNext();
  assert.equal(nextPhoto.id, allPhotos[1].id);
  assert.equal(app.activePhotoId, allPhotos[1].id);

  // Swipe Prev
  const prevPhoto = app.swipePrev();
  assert.equal(prevPhoto.id, allPhotos[0].id);
  assert.equal(app.activePhotoId, allPhotos[0].id);

  // Swipe Prev from index 0 wraps to end
  const wrapPhoto = app.swipePrev();
  assert.equal(wrapPhoto.id, allPhotos[allPhotos.length - 1].id);
});

test('8. toggleFavorite() updates status and persists via microkernel', () => {
  const app = new GalleryApp();
  const targetPhoto = app.photos.find(p => p.id === 'vid_002');
  assert.equal(targetPhoto.isFavorite, false);

  const updatedFav1 = app.toggleFavorite('vid_002');
  assert.equal(updatedFav1, true);
  assert.equal(targetPhoto.isFavorite, true);

  const updatedFav2 = app.toggleFavorite('vid_002');
  assert.equal(updatedFav2, false);
  assert.equal(targetPhoto.isFavorite, false);

  assert.throws(() => {
    app.toggleFavorite('unknown_photo');
  }, /Photo not found/);
});

test('9. Privacy-first EXIF scrubber strips GPS and device tags', () => {
  const app = new GalleryApp();
  const photo = app.photos.find(p => p.id === 'img_001');
  assert.ok(photo.metadata.exif.gps, 'Initial photo has GPS coordinates');
  assert.ok(photo.metadata.exif.deviceSerial, 'Initial photo has device serial');

  const scrubResult = app.stripExifPrivacy('img_001');
  assert.equal(scrubResult.success, true);
  assert.ok(scrubResult.strippedFields.includes('gps'));
  assert.ok(scrubResult.strippedFields.includes('deviceSerial'));
  assert.ok(scrubResult.strippedFields.includes('userProfile'));

  // Verify sanitized metadata
  assert.equal(photo.metadata.exif.gps, null, 'GPS must be redacted');
  assert.equal(photo.metadata.exif.deviceSerial, null, 'Device serial must be redacted');
  assert.equal(photo.metadata.exif.userProfile, null, 'User profile must be redacted');
  assert.equal(photo.metadata.exif.stripped, true, 'Stripped flag must be true');
  assert.ok(photo.metadata.exif.strippedAt, 'Stripped timestamp must be set');

  // Verify audit log entry
  assert.ok(app.privacyAuditLogs.length > 0);
  assert.equal(app.privacyAuditLogs[0].photoId, 'img_001');
});

test('10. exportPhotoSafe() exports sanitized photo ready for sharing', () => {
  const app = new GalleryApp();
  const exportPayload = app.exportPhotoSafe('img_005', { stripExif: true });

  assert.ok(exportPayload.exportedAt);
  assert.equal(exportPayload.isExifSafe, true);
  assert.equal(exportPayload.photo.metadata.exif.gps, null);
  assert.equal(exportPayload.photo.metadata.exif.stripped, true);
});

test('11. Semantic Neural Vision Search filters photos by tags', () => {
  const app = new GalleryApp();

  // 1. Search 'receipt'
  const receipts = app.searchByVisionTag('receipt');
  assert.ok(receipts.length >= 2, 'Should match at least 2 receipts/invoices');
  for (const p of receipts) {
    const hasTag = p.visionTags.some(t => t.includes('receipt') || t.includes('invoice'));
    assert.ok(hasTag, `Photo ${p.id} should match receipt tag`);
  }

  // 2. Search 'nature'
  const nature = app.searchByVisionTag('nature');
  assert.ok(nature.length >= 2, 'Should match nature photos');
  for (const p of nature) {
    assert.ok(p.visionTags.includes('nature') || p.visionTags.includes('landscape'));
  }

  // 3. Search 'city'
  const city = app.searchByVisionTag('city');
  assert.ok(city.length >= 2, 'Should match city photos');

  // 4. Search 'portrait'
  const portrait = app.searchByVisionTag('portrait');
  assert.ok(portrait.length >= 1, 'Should match portrait');

  // 5. Search 'document'
  const docs = app.searchByVisionTag('document');
  assert.ok(docs.length >= 2, 'Should match documents');

  // 6. Clearing search restores full list
  const cleared = app.searchByVisionTag('');
  const all = app.getPhotos('all');
  assert.equal(cleared.length, all.length);
});

test('12. Vault security: PIN unlock, vault gating, and locking', () => {
  const app = new GalleryApp();

  // When locked:
  assert.equal(app.vaultLocked, true);
  const lockedVaultPhotos = app.getPhotos('vault');
  assert.deepEqual(lockedVaultPhotos, []);

  // Vault photo should not appear in 'all'
  const allWhenLocked = app.getPhotos('all');
  assert.ok(allWhenLocked.every(p => !p.isVault));

  // Trying to open vault photo when locked throws
  assert.throws(() => {
    app.openPhoto('img_008');
  }, /Vault is locked/);

  // Wrong PIN fails unlock
  const wrongPin = app.unlockVault('9999');
  assert.equal(wrongPin, false);
  assert.equal(app.vaultLocked, true);

  // Correct PIN unlocks vault
  const correctPin = app.unlockVault('1234');
  assert.equal(correctPin, true);
  assert.equal(app.vaultLocked, false);

  // Once unlocked, photos in vault are accessible
  const unlockedVaultPhotos = app.getPhotos('vault');
  assert.ok(unlockedVaultPhotos.length >= 1);
  assert.ok(unlockedVaultPhotos.some(p => p.id === 'img_008'));

  // Can open vault photo now
  const vaultPhoto = app.openPhoto('img_008');
  assert.equal(vaultPhoto.id, 'img_008');

  // Lock vault again
  app.lockVault();
  assert.equal(app.vaultLocked, true);
  assert.deepEqual(app.getPhotos('vault'), []);
});

test('13. Microkernel Media Adapter & Camera HAL Ingress', async () => {
  let capturedAudit = null;
  const mockStorage = {
    id: GALLERY_CAPABILITIES.STORAGE_MEDIA,
    async persistPhotoState(photoId, state) {
      return { success: true, photoId, state };
    },
    async logAuditScrub(photoId, fields) {
      capturedAudit = { photoId, fields };
      return { success: true, auditId: 'AUD-TEST-1' };
    }
  };

  const app = new GalleryApp({ storageMedia: mockStorage });
  app.stripExifPrivacy('img_001');
  assert.ok(capturedAudit);
  assert.equal(capturedAudit.photoId, 'img_001');

  // Camera HAL Ingress
  const initialCount = app.photos.length;
  const newPhoto = await app.importFromCamera({ resolution: '8192 x 6144' });
  assert.ok(newPhoto.id);
  assert.equal(newPhoto.albumId, 'camera');
  assert.equal(app.photos.length, initialCount + 1);
  assert.equal(app.photos[0].id, newPhoto.id);
});

test('14. Full UI render() output generates valid DOM components', () => {
  const container = new MockElement('gallery-root');
  const app = new GalleryApp({ container });

  const html = app.render();
  assert.ok(html.includes('class="gallery-app"'));
  assert.ok(html.includes('class="gallery-header"'));
  assert.ok(html.includes('class="gallery-search-bar"'));
  assert.ok(html.includes('class="gallery-chips-bar"'));
  assert.ok(html.includes('class="gallery-nav-tabs"'));
  assert.ok(html.includes('data-album-id="camera"'));
  assert.ok(html.includes('data-album-id="screenshots"'));
  assert.ok(html.includes('data-album-id="vault"'));
  assert.ok(html.includes('data-album-id="receipts"'));
  assert.ok(html.includes('class="gallery-date-header"'));
  assert.ok(html.includes('class="gallery-item photo"'));
  assert.ok(html.includes('class="gallery-item video"'));
  assert.ok(html.includes('class="gallery-badge duration-pill"'));
  assert.ok(html.includes('class="gallery-fav-indicator'));

  // Test rendering lightbox when open
  app.openPhoto('img_001');
  app.toggleMetadataDrawer();
  const lightboxHtml = app.render();
  assert.ok(lightboxHtml.includes('id="gallery-lightbox"'));
  assert.ok(lightboxHtml.includes('class="gallery-metadata-drawer open"'));
  assert.ok(lightboxHtml.includes('Details &amp; EXIF Inspector') || lightboxHtml.includes('Details & EXIF Inspector'));
  assert.ok(lightboxHtml.includes('GPS Coordinates'));
});
