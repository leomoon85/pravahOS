// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file sw.js
 * PravahOS Offline Service Worker.
 * Caches all shell, emulator, UI components, and kernel assets for 100% offline standalone operation.
 */

const CACHE_VERSION = 'pravah-os-v1.0.0';
const CACHE_NAME = `pravah-offline-${CACHE_VERSION}`;

const OFFLINE_PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/assets/icons/icon-192.svg',
  '/assets/icons/icon-512.svg',
  '/assets/icons/icon-maskable.svg',

  // Phone Emulator Subsystem
  '/emulator/',
  '/emulator/index.html',
  '/emulator/launch.html',
  '/emulator/style.css',
  '/emulator/installer.css',
  '/emulator/emulator.js',
  '/emulator/sensory_bridge.js',
  '/emulator/android_bridge.js',
  '/emulator/installer.js',

  // Dynamic Experience Shell Subsystem
  '/ui/shell/',
  '/ui/shell/index.html',
  '/ui/shell/style.css',
  '/ui/shell/drawer.css',
  '/ui/shell/shade.css',
  '/ui/shell/lockscreen.css',
  '/ui/shell/dialer.css',
  '/ui/shell/back_gesture.css',
  '/ui/shell/shell.js',
  '/ui/shell/island.js',
  '/ui/shell/shade.js',
  '/ui/shell/drawer.js',
  '/ui/shell/lockscreen.js',
  '/ui/shell/dialer.js',
  '/ui/shell/back_gesture.js',

  // Soft Keyboard & Motion Physics Engine
  '/ui/keyboard/keyboard.css',
  '/ui/keyboard/keyboard.js',
  '/ui/keyboard/voice.js',
  '/ui/motion/spring.js',
  '/ui/motion/haptics.js',
  '/ui/motion/index.js',

  // Experience Composer & Schema
  '/ui/composer/composer.js',
  '/ui/composer/dag_layout.js',
  '/ui/composer/index.js',
  '/ui/schema/components.js',
  '/ui/schema/index.js',
  '/ui/schema/ui_schema.json'
];

// Fallback HTML offline response
const OFFLINE_FALLBACK_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PravahOS Offline</title>
  <style>
    body {
      background: #070a14;
      color: #f8fafc;
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }
    .badge {
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #38bdf8;
      padding: 0.5rem 1rem;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 1rem;
      letter-spacing: 0.05em;
    }
    h1 { margin: 0 0 0.5rem; font-size: 1.75rem; }
    p { color: #94a3b8; max-width: 400px; margin: 0 0 1.5rem; line-height: 1.5; }
    a {
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      color: #070a14;
      text-decoration: none;
      font-weight: 600;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <div class="badge">PRAVAH-OS AIR-GAP OFFLINE</div>
  <h1>Standalone Workspace Ready</h1>
  <p>The system is currently running air-gapped without an active network connection.</p>
  <a href="/emulator/">Return to Phone Emulator</a>
</body>
</html>`;

// Install Event: cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache URLs individually so one failure does not abort installation
      const cachePromises = OFFLINE_PRECACHE_URLS.map(async (url) => {
        try {
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(url, response);
          }
        } catch (err) {
          // Precache asset might not be available at install time
        }
      });
      await Promise.all(cachePromises);
      return self.skipWaiting();
    })
  );
});

// Activate Event: remove obsolete caches and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Offline-first caching with stale-while-revalidate fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') {
    return;
  }

  // Handle cross-origin or non-http requests normally
  if (!req.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(req);

      // Fetch from network in background (or foreground if no cache)
      const fetchPromise = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          cache.put(req, networkResponse.clone());
        }
        return networkResponse;
      }).catch(async (fetchError) => {
        // If network failed and we have no cached item
        if (cachedResponse) {
          return cachedResponse;
        }

        // Navigation request fallback (HTML page)
        if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
          if (req.url.includes('/emulator')) {
            const emulatorFallback = await cache.match('/emulator/index.html');
            if (emulatorFallback) return emulatorFallback;
          }
          if (req.url.includes('/ui/shell')) {
            const shellFallback = await cache.match('/ui/shell/index.html');
            if (shellFallback) return shellFallback;
          }
          return new Response(OFFLINE_FALLBACK_PAGE, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }

        throw fetchError;
      });

      // If cached copy exists, return it immediately for instant offline responsiveness
      return cachedResponse || fetchPromise;
    })
  );
});

// Message Event: skipWaiting, cache query, and sync
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'GET_VERSION') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ version: CACHE_VERSION, cacheName: CACHE_NAME });
    }
  } else if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: true });
      }
    });
  }
});
