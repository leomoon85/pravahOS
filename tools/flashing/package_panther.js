// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import fs from 'node:fs';
import path from 'node:path';
import { createBootImageV4, createVendorBootImageV4 } from './mkbootimg.js';

const args = process.argv.slice(2);
const outDir = args[0] || 'out/panther';
const dtbPath = args[1] || path.join(outDir, 'pantah.dtb');

if (!fs.existsSync(dtbPath)) {
  console.error(`DTB not found at ${dtbPath}`);
  process.exit(1);
}

const dtbBuf = fs.readFileSync(dtbPath);
// 4MB kernel buffer payload for initial packaging
const kernelBuf = Buffer.alloc(4 * 1024 * 1024, 0x41);
const cmdline = 'console=ttySAC0,115200 earlycon=exynos4210,0x10a00000 init=/system/bin/pravahd pravah.titan_m2=1';

const bootImg = createBootImageV4({
  kernelBuffer: kernelBuf,
  cmdline
});

const vendorBootImg = createVendorBootImageV4({
  dtbBuffer: dtbBuf,
  boardName: 'PANTHER_GS201'
});

const bootOut = path.join(outDir, 'pravah_boot.img');
const vendorBootOut = path.join(outDir, 'pravah_vendor_boot.img');

fs.writeFileSync(bootOut, bootImg);
fs.writeFileSync(vendorBootOut, vendorBootImg);

console.log(`      Successfully generated ${bootOut} (${bootImg.length} bytes)`);
console.log(`      Successfully generated ${vendorBootOut} (${vendorBootImg.length} bytes)`);
