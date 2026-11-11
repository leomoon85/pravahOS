// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import test from 'node:test';
import assert from 'node:assert/strict';

// Import emulator device presets
import { DevicePresets } from '../../emulator/emulator.js';

test('Foldable Form Factors: defines valid Passport, Flex, and Slab presets', () => {
  // 1. Slab phone (Candybar)
  assert.ok(DevicePresets.pixel8);
  assert.equal(DevicePresets.pixel8.formFactor, 'candybar');
  assert.equal(DevicePresets.pixel8.hingeAngle, 0);
  assert.equal(DevicePresets.pixel8.ratio, '20:9');

  // 2. Passport Fold (Unfolded 4:3 book)
  assert.ok(DevicePresets.passport);
  assert.equal(DevicePresets.passport.formFactor, 'passport');
  assert.equal(DevicePresets.passport.width, 780);
  assert.equal(DevicePresets.passport.height, 680);
  assert.equal(DevicePresets.passport.ratio, '4:3');
  assert.equal(DevicePresets.passport.hingeAngle, 180);

  // 3. Flex Tabletop (90° L-shape hinge)
  assert.ok(DevicePresets.flex);
  assert.equal(DevicePresets.flex.formFactor, 'flex');
  assert.equal(DevicePresets.flex.hingeAngle, 90);

  // 4. Compact Clamshell Cover (1:1 square outer screen)
  assert.ok(DevicePresets.flip_cover);
  assert.equal(DevicePresets.flip_cover.formFactor, 'flip_cover');
  assert.equal(DevicePresets.flip_cover.ratio, '1:1');
});

test('Foldable Geometry: aspect ratio calculations differentiate Slab vs Passport', () => {
  const isPassportBooklet = (w, h) => {
    const ratio = w / h;
    return ratio >= 1.05 && ratio <= 1.45;
  };

  const isTallSlab = (w, h) => {
    const ratio = h / w;
    return ratio >= 1.8;
  };

  // Pixel 8 (412 x 915) -> ratio ~2.22 (Tall Slab)
  assert.equal(isTallSlab(412, 915), true);
  assert.equal(isPassportBooklet(412, 915), false);

  // Passport (780 x 680) -> ratio ~1.15 (Passport Booklet)
  assert.equal(isPassportBooklet(780, 680), true);
  assert.equal(isTallSlab(780, 680), false);
});

test('Foldable Hinge States: maps angular sensor degrees to discrete postures', () => {
  function getHingePosture(angleDeg) {
    if (angleDeg <= 15) return 'CLOSED';
    if (angleDeg < 60) return 'PEEK';
    if (angleDeg <= 125) return 'FLEX_TABLETOP';
    if (angleDeg <= 180) return 'OPEN_PASSPORT';
    return 'TENT';
  }

  assert.equal(getHingePosture(0), 'CLOSED');
  assert.equal(getHingePosture(10), 'CLOSED');
  assert.equal(getHingePosture(35), 'PEEK');
  assert.equal(getHingePosture(90), 'FLEX_TABLETOP');
  assert.equal(getHingePosture(180), 'OPEN_PASSPORT');
  assert.equal(getHingePosture(270), 'TENT');
});
