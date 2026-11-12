// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file package_panther.js
 * Authoritative Android Boot Image v4 and Vendor Boot Image v4 packager
 * for Google Pixel 7 ("panther" / Google Tensor G2 GS201).
 *
 * Strict Security Policy:
 * NEVER synthesizes placeholder / dummy kernel payloads for physical targets.
 * Requires a verified ARM64 GKI kernel binary (Image.lz4 / Image) unless
 * an explicit --allow-test-stub flag is provided for offline test verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createBootImageV4, createVendorBootImageV4 } from './mkbootimg.js';

function parseArgs(args) {
  const options = {
    outDir: 'out/panther',
    dtbPath: null,
    kernelPath: null,
    allowTestStub: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' && args[i + 1]) {
      options.outDir = args[++i];
    } else if (arg === '--dtb' && args[i + 1]) {
      options.dtbPath = args[++i];
    } else if (arg === '--kernel' && args[i + 1]) {
      options.kernelPath = args[++i];
    } else if (arg === '--allow-test-stub') {
      options.allowTestStub = true;
    } else if (!arg.startsWith('--')) {
      if (!options.outDir || options.outDir === 'out/panther') {
        options.outDir = arg;
      } else if (!options.dtbPath) {
        options.dtbPath = arg;
      }
    }
  }

  if (!options.dtbPath) {
    options.dtbPath = path.join(options.outDir, 'pantah.dtb');
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

if (!fs.existsSync(options.dtbPath)) {
  console.error(`[ERROR] Device Tree Binary (DTB) not found at: ${options.dtbPath}`);
  console.error('        Compile DTB first via build_dtb.js before packaging.');
  process.exit(1);
}

// Locate real kernel binary
let resolvedKernelPath = options.kernelPath;
if (!resolvedKernelPath) {
  const candidates = [
    path.join('kernel', 'Image.lz4'),
    path.join(options.outDir, 'Image.lz4'),
    path.join('kernel', 'Image'),
    process.env.GKI_KERNEL_PATH
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      resolvedKernelPath = candidate;
      break;
    }
  }
}

let kernelBuf;
let isTestStub = false;

if (resolvedKernelPath && fs.existsSync(resolvedKernelPath)) {
  kernelBuf = fs.readFileSync(resolvedKernelPath);
  console.log(`      Using real GKI kernel binary: ${resolvedKernelPath} (${kernelBuf.length} bytes)`);
} else {
  if (!options.allowTestStub) {
    console.error('');
    console.error('========================================================================');
    console.error(' [FATAL] No real ARM64 GKI kernel binary found!');
    console.error('========================================================================');
    console.error(' PravahOS strictly prohibits synthesizing placeholder / dummy kernel');
    console.error(' payloads (such as 0x41 stubs) when building physical device images.');
    console.error('');
    console.error(' To package a bootable image for Google Pixel 7 (panther):');
    console.error('   1. Sync and build the GKI kernel (android-gs-pantah-5.10).');
    console.error('   2. Provide the compiled Image.lz4 binary:');
    console.error('      node tools/flashing/package_panther.js --kernel <path/to/Image.lz4>');
    console.error('');
    console.error(' (For offline continuous-integration test runs only, pass --allow-test-stub).');
    console.error('========================================================================');
    process.exit(1);
  }

  console.warn('');
  console.warn('  [WARNING: NON-BOOTABLE TEST STUB GENERATED]');
  console.warn('  --allow-test-stub specified. Synthesizing offline test stub.');
  console.warn('  THIS BOOT IMAGE WILL NOT BOOT ON PHYSICAL HARDWARE.');
  console.warn('');
  kernelBuf = Buffer.alloc(4 * 1024 * 1024, 0x41);
  isTestStub = true;
}

const dtbBuf = fs.readFileSync(options.dtbPath);
const cmdline = 'console=ttySAC0,115200 earlycon=exynos4210,0x10a00000 init=/system/bin/pravahd pravah.titan_m2=1';

const bootImg = createBootImageV4({
  kernelBuffer: kernelBuf,
  cmdline
});

const vendorBootImg = createVendorBootImageV4({
  dtbBuffer: dtbBuf,
  boardName: 'PANTHER_GS201'
});

const bootOut = path.join(options.outDir, 'pravah_boot.img');
const vendorBootOut = path.join(options.outDir, 'pravah_vendor_boot.img');

fs.mkdirSync(options.outDir, { recursive: true });
fs.writeFileSync(bootOut, bootImg);
fs.writeFileSync(vendorBootOut, vendorBootImg);

// Write packaging metadata manifest
const meta = {
  target: 'panther',
  kernelSource: resolvedKernelPath || 'MOCK_TEST_STUB',
  isBootable: !isTestStub,
  isTestStub,
  bootImageBytes: bootImg.length,
  vendorBootImageBytes: vendorBootImg.length,
  dtbBytes: dtbBuf.length,
  packagedAt: new Date().toISOString()
};
fs.writeFileSync(path.join(options.outDir, 'package_manifest.json'), JSON.stringify(meta, null, 2));

console.log(`      Successfully generated ${bootOut} (${bootImg.length} bytes)`);
console.log(`      Successfully generated ${vendorBootOut} (${vendorBootImg.length} bytes)`);
