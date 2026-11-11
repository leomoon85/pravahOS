// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');

/**
 * PravahOS Desktop Packaging, PWA Manifest, Service Worker & Launcher Verification Suite
 */

test('Root package.json: Valid schema and required scripts', () => {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  assert.ok(fs.existsSync(pkgPath), 'package.json must exist at repository root');

  const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
  let pkg;
  assert.doesNotThrow(() => {
    pkg = JSON.parse(pkgRaw);
  }, 'package.json must be valid JSON');

  assert.equal(pkg.name, 'pravah-os');
  assert.equal(pkg.type, 'module', 'Root package.json must use ES modules (type: "module")');
  assert.ok(pkg.scripts, 'scripts dictionary must exist');

  // Verify the exact required scripts from specification
  assert.equal(pkg.scripts.start, 'node serve.js', 'Script "start" must be "node serve.js"');
  assert.equal(pkg.scripts.serve, 'node serve.js', 'Script "serve" must be "node serve.js"');
  assert.equal(
    pkg.scripts.desktop,
    'powershell -ExecutionPolicy Bypass -File ./launch_desktop.ps1',
    'Script "desktop" must execute launch_desktop.ps1 with bypass'
  );
  assert.equal(
    pkg.scripts.test,
    'node --test runtime/tests/*.test.js ui/tests/*.test.js emulator/tests/*.test.js',
    'Script "test" must run all runtime, ui, and emulator test suites'
  );
});

test('Web App Manifest (manifest.json): PWA standards & display mode', () => {
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist at repository root');

  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  assert.doesNotThrow(() => {
    manifest = JSON.parse(manifestRaw);
  }, 'manifest.json must be valid JSON');

  assert.ok(manifest.name && manifest.name.includes('PravahOS'), 'Manifest name should include PravahOS');
  assert.equal(manifest.short_name, 'PravahOS');
  assert.equal(manifest.display, 'standalone', 'PWA display must be "standalone" for desktop app mode');
  assert.ok(Array.isArray(manifest.display_override), 'display_override must be an array');
  assert.ok(manifest.display_override.includes('standalone'));
  assert.ok(manifest.display_override.includes('window-controls-overlay'));

  assert.equal(manifest.orientation, 'portrait-primary', 'Default orientation should be portrait-primary');
  assert.equal(manifest.start_url, '/emulator/');
  assert.equal(manifest.scope, '/');
});

test('Web App Manifest: Luxury theme tokens match PravahOS theme engine', () => {
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Default theme is Celestial Twilight
  assert.equal(manifest.background_color, '#070a14', 'Background must match Celestial Twilight background (#070a14)');
  assert.equal(manifest.theme_color, '#38bdf8', 'Theme color must match Celestial Twilight sapphire (#38bdf8)');

  // Verify all 5 PravahOS luxury themes are tokenized
  const tokenBlock = manifest.pravah_theme_tokens;
  assert.ok(tokenBlock, 'manifest must define pravah_theme_tokens');
  assert.equal(tokenBlock.default, 'twilight');

  const themes = tokenBlock.themes;
  assert.ok(themes, 'themes dictionary must exist');

  const expectedThemes = ['twilight', 'botanical', 'sunset', 'titanium', 'solar'];
  assert.deepEqual(Object.keys(themes).sort(), expectedThemes.sort());

  assert.equal(themes.twilight.primary, '#38bdf8');
  assert.equal(themes.twilight.bg, '#070a14');

  assert.equal(themes.botanical.primary, '#34d399');
  assert.equal(themes.botanical.bg, '#09130e');

  assert.equal(themes.sunset.primary, '#fb923c');
  assert.equal(themes.sunset.bg, '#150a12');

  assert.equal(themes.titanium.primary, '#e2e8f0');
  assert.equal(themes.titanium.bg, '#0a0c10');

  assert.equal(themes.solar.primary, '#0284c7');
  assert.equal(themes.solar.bg, '#f1f5f9');
});

test('Web App Manifest & Static Icons: Verified files on disk', () => {
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3, 'Must have >= 3 icon entries');

  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'), 'Must include 192x192 icon');
  assert.ok(sizes.includes('512x512'), 'Must include 512x512 icon');

  const purposes = manifest.icons.map((i) => i.purpose);
  assert.ok(purposes.includes('maskable'), 'Must include maskable icon');

  // Verify each icon file exists and is valid SVG
  for (const icon of manifest.icons) {
    const iconRelativePath = icon.src.startsWith('/') ? icon.src.slice(1) : icon.src;
    const absPath = path.join(ROOT_DIR, iconRelativePath);
    assert.ok(fs.existsSync(absPath), `Icon file must exist: ${absPath}`);
    const svgContent = fs.readFileSync(absPath, 'utf8');
    assert.ok(svgContent.includes('<svg'), `Icon must be valid SVG: ${absPath}`);
    assert.ok(svgContent.includes('</svg>'), `Icon must have closing svg tag: ${absPath}`);
  }
});

test('Service Worker (sw.js): Caching lifecycle and offline assets', () => {
  const swPath = path.join(ROOT_DIR, 'sw.js');
  assert.ok(fs.existsSync(swPath), 'sw.js must exist at repository root');

  const swContent = fs.readFileSync(swPath, 'utf8');
  assert.ok(swContent.includes('CACHE_NAME'), 'sw.js must define a cache name');
  assert.ok(swContent.includes('addEventListener(\'install\''), 'sw.js must listen for install event');
  assert.ok(swContent.includes('addEventListener(\'activate\''), 'sw.js must listen for activate event');
  assert.ok(swContent.includes('addEventListener(\'fetch\''), 'sw.js must listen for fetch event');

  // Verify precache entries cover shell, emulator, keyboard, motion, and composer
  const expectedPrecaches = [
    '/emulator/',
    '/emulator/index.html',
    '/emulator/style.css',
    '/emulator/emulator.js',
    '/ui/shell/',
    '/ui/shell/index.html',
    '/ui/shell/style.css',
    '/ui/shell/shell.js',
    '/ui/keyboard/keyboard.js',
    '/ui/motion/spring.js',
    '/ui/composer/composer.js',
    '/manifest.json'
  ];

  for (const asset of expectedPrecaches) {
    assert.ok(
      swContent.includes(asset),
      `sw.js precache list must include "${asset}"`
    );
  }

  // Verify offline fallback page / navigation handling
  assert.ok(swContent.includes('skipWaiting'), 'sw.js should support skipWaiting');
  assert.ok(swContent.includes('clients.claim'), 'sw.js should claim clients on activation');
});

test('HTML Pages: Manifest links and Service Worker registration', () => {
  const emulatorHtml = fs.readFileSync(path.join(ROOT_DIR, 'emulator/index.html'), 'utf8');
  const shellHtml = fs.readFileSync(path.join(ROOT_DIR, 'ui/shell/index.html'), 'utf8');

  // Emulator HTML assertions
  assert.ok(
    emulatorHtml.includes('<link rel="manifest" href="/manifest.json">'),
    'emulator/index.html must link manifest.json'
  );
  assert.ok(
    emulatorHtml.includes('navigator.serviceWorker.register'),
    'emulator/index.html must register service worker'
  );
  assert.ok(
    emulatorHtml.includes('name="theme-color"'),
    'emulator/index.html must declare theme-color'
  );

  // Shell HTML assertions
  assert.ok(
    shellHtml.includes('<link rel="manifest" href="/manifest.json">'),
    'ui/shell/index.html must link manifest.json'
  );
  assert.ok(
    shellHtml.includes('navigator.serviceWorker.register'),
    'ui/shell/index.html must register service worker'
  );
  assert.ok(
    shellHtml.includes('name="theme-color"'),
    'ui/shell/index.html must declare theme-color'
  );
});

test('Windows Batch Launcher (launch_desktop.bat): Syntax and app parameters', () => {
  const batPath = path.join(ROOT_DIR, 'launch_desktop.bat');
  assert.ok(fs.existsSync(batPath), 'launch_desktop.bat must exist at repository root');

  const batContent = fs.readFileSync(batPath, 'utf8');
  assert.ok(batContent.includes('TARGET_PORT=8080'), 'Batch launcher must default to port 8080');
  assert.ok(
    batContent.includes('--app=http://localhost:8080/emulator/') ||
    batContent.includes('--app=%APP_URL%'),
    'Batch launcher must launch browser in standalone app mode (--app=)'
  );
  assert.ok(batContent.includes('msedge.exe'), 'Batch launcher must look for Microsoft Edge');
  assert.ok(batContent.includes('chrome.exe'), 'Batch launcher must look for Google Chrome');
  assert.ok(batContent.includes('node serve.js'), 'Batch launcher must start node serve.js if inactive');
});

test('Windows PowerShell Launcher (launch_desktop.ps1): Syntax and execution', () => {
  const ps1Path = path.join(ROOT_DIR, 'launch_desktop.ps1');
  assert.ok(fs.existsSync(ps1Path), 'launch_desktop.ps1 must exist at repository root');

  const ps1Content = fs.readFileSync(ps1Path, 'utf8');
  assert.ok(ps1Content.includes('Test-PortListening'), 'PowerShell launcher must implement port check');
  assert.ok(ps1Content.includes('Find-ChromiumBrowser'), 'PowerShell launcher must implement browser discovery');
  assert.ok(ps1Content.includes('Start-PravahServer'), 'PowerShell launcher must manage server lifecycle');
  assert.ok(ps1Content.includes('--app=$appUrl'), 'PowerShell launcher must use --app flag');

  // Execute PowerShell launcher in -DryRun mode to verify valid PS1 syntax and runtime execution
  const result = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', ps1Path, '-DryRun'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `PowerShell launcher DryRun failed: ${result.stderr}`);
  assert.ok(result.stdout.includes('Target URL:'), 'PowerShell launcher should print target URL');
  assert.ok(result.stdout.includes('Detected Browser:'), 'PowerShell launcher should detect browser');
  assert.ok(result.stdout.includes('[DRY-RUN] Verification complete'), 'PowerShell launcher should complete dry-run');
});

test('Server (serve.js): Manifest MIME type and Service-Worker-Allowed header', () => {
  const servePath = path.join(ROOT_DIR, 'serve.js');
  const serveContent = fs.readFileSync(servePath, 'utf8');

  assert.ok(
    serveContent.includes('.webmanifest') || serveContent.includes('manifest.json'),
    'serve.js should support manifest MIME type'
  );
  assert.ok(
    serveContent.includes('Service-Worker-Allowed'),
    'serve.js should set Service-Worker-Allowed header'
  );
});
