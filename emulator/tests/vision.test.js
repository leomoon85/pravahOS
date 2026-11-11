// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file vision.test.js
 * Comprehensive automated test suite for PravahOS On-Device Neural Vision Intelligence.
 *
 * Validates:
 * 1. RGB888 Frame Analysis: Luminance extraction, buffer metrics, channels, and stride.
 * 2. Bounding Box Geometry: Coordinate normalization, pixel mapping, IoU, and NMS.
 * 3. On-Device Receipt Itemizer & Tax Math: Item extraction, tax rates, total verification, and discrepancy detection.
 * 4. Document Classification: Multi-class neural semantic classification (Receipt, Invoice, Boarding Pass, Business Card, Note, QR).
 * 5. Synthetic Pattern Generators: Document, Retail Receipt, and Barcode/QR generation with ground truth.
 * 6. Privacy Isolation & Capability Delegation: Zero-cloud-leak guarantee, air-gap safety, and media.camera.capture / vision.ocr_extract integration.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  VisionDocumentType,
  BoundingBoxType,
  BoundingBoxMath,
  ReceiptItemizer,
  DocumentClassifier,
  VisionPipeline,
  SyntheticPatterns
} = require('../vision_pipeline.js');

const {
  CameraSensorBridge,
  CameraPattern,
  CameraFormat
} = require('../sensory_bridge.js');

describe('PravahOS On-Device Neural Vision Intelligence Pipeline', () => {

  // ==========================================================================
  // 1. RGB888 Frame Preprocessing & Buffer Metrics
  // ==========================================================================
  describe('RGB888 Frame Preprocessing & Buffer Analysis', () => {
    let pipeline;

    beforeEach(() => {
      pipeline = new VisionPipeline();
    });

    it('validates 24-bit packed RGB888 buffer layout and strides', () => {
      const width = 100;
      const height = 100;
      const buffer = new Uint8Array(width * height * 3);
      buffer.fill(128);

      const metrics = VisionPipeline.analyzeBufferMetrics(buffer, width, height);
      assert.equal(metrics.width, 100);
      assert.equal(metrics.height, 100);
      assert.equal(metrics.channels, 3);
      assert.equal(metrics.bytesPerPixel, 3);
      assert.equal(metrics.stride, 300);
      assert.equal(metrics.totalBytes, 30000);
      assert.equal(metrics.avgBrightness, 128);
    });

    it('extracts luminance accurately according to ITU-R BT.601 coefficients', () => {
      const width = 2;
      const height = 2;
      // Pixel 0: Pure Red (255, 0, 0) -> ~77
      // Pixel 1: Pure Green (0, 255, 0) -> ~150
      // Pixel 2: Pure Blue (0, 0, 255) -> ~29
      // Pixel 3: Pure White (255, 255, 255) -> 255
      const rgb = new Uint8Array([
        255, 0, 0,
        0, 255, 0,
        0, 0, 255,
        255, 255, 255
      ]);

      const luma = VisionPipeline.extractLuminance(rgb, width, height);
      assert.equal(luma.length, 4);
      assert.ok(luma[0] >= 75 && luma[0] <= 78, `Red luma expected ~77, got ${luma[0]}`);
      assert.ok(luma[1] >= 148 && luma[1] <= 152, `Green luma expected ~150, got ${luma[1]}`);
      assert.ok(luma[2] >= 28 && luma[2] <= 30, `Blue luma expected ~29, got ${luma[2]}`);
      assert.ok(luma[3] >= 254 && luma[3] <= 255, `White luma expected 255, got ${luma[3]}`);
    });

    it('detects washed-out and dark frames correctly', () => {
      const darkBuf = new Uint8Array(40 * 40 * 3).fill(20);
      const darkMetrics = VisionPipeline.analyzeBufferMetrics(darkBuf, 40, 40);
      assert.equal(darkMetrics.isDark, true);
      assert.equal(darkMetrics.isWashedOut, false);

      const brightBuf = new Uint8Array(40 * 40 * 3).fill(245);
      const brightMetrics = VisionPipeline.analyzeBufferMetrics(brightBuf, 40, 40);
      assert.equal(brightMetrics.isDark, false);
      assert.equal(brightMetrics.isWashedOut, true);
    });

    it('rejects invalid buffer types and handles buffer underrun gracefully', () => {
      assert.throws(() => {
        pipeline.analyzeFrame('not-a-buffer', 100, 100);
      }, /requires a Uint8Array/i);

      assert.throws(() => {
        const shortBuf = new Uint8Array(100);
        pipeline.analyzeFrame(shortBuf, 100, 100);
      }, /Buffer underrun/i);
    });
  });

  // ==========================================================================
  // 2. Bounding Box Geometry & Math
  // ==========================================================================
  describe('Bounding Box Geometry & Math', () => {
    it('normalizes pixel coordinates to [0.0, 1.0] unit space', () => {
      const pixelBox = { x: 50, y: 100, width: 200, height: 300 };
      const normalized = BoundingBoxMath.normalizeBox(pixelBox, 400, 600);

      assert.equal(normalized.x, 0.125);
      assert.equal(normalized.y, 0.1667);
      assert.equal(normalized.width, 0.5);
      assert.equal(normalized.height, 0.5);
    });

    it('converts normalized coordinates back to target pixel raster', () => {
      const norm = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };
      const pixel = BoundingBoxMath.toPixelBox(norm, 800, 1000);

      assert.equal(pixel.x, 200);
      assert.equal(pixel.y, 500);
      assert.equal(pixel.width, 400);
      assert.equal(pixel.height, 250);
    });

    it('clamps bounding boxes that exceed image dimensions', () => {
      const outBox = { x: -10, y: 550, width: 500, height: 200 };
      const clamped = BoundingBoxMath.clampBox(outBox, 400, 600);

      assert.equal(clamped.x, 0);
      assert.equal(clamped.y, 550);
      assert.equal(clamped.width, 400);
      assert.equal(clamped.height, 50);
    });

    it('tests point containment within bounding boxes accurately', () => {
      const box = { x: 50, y: 50, width: 100, height: 100 };
      assert.equal(BoundingBoxMath.containsPoint(box, 75, 75), true);
      assert.equal(BoundingBoxMath.containsPoint(box, 50, 50), true);
      assert.equal(BoundingBoxMath.containsPoint(box, 150, 150), true);
      assert.equal(BoundingBoxMath.containsPoint(box, 40, 75), false);
      assert.equal(BoundingBoxMath.containsPoint(box, 160, 75), false);
    });

    it('calculates Intersection over Union (IoU) accurately', () => {
      // Identical boxes -> IoU = 1.0
      const box1 = { x: 0, y: 0, width: 100, height: 100 };
      const box2 = { x: 0, y: 0, width: 100, height: 100 };
      assert.equal(BoundingBoxMath.calculateIoU(box1, box2), 1.0);

      // Disjoint boxes -> IoU = 0.0
      const box3 = { x: 200, y: 200, width: 50, height: 50 };
      assert.equal(BoundingBoxMath.calculateIoU(box1, box3), 0.0);

      // 50% overlap on X:
      // boxA: [0, 0, 100, 100], area = 10000
      // boxB: [50, 0, 100, 100], area = 10000
      // Intersection: [50, 0, 50, 100], area = 5000
      // Union: 10000 + 10000 - 5000 = 15000
      // IoU: 5000 / 15000 = 0.3333
      const box4 = { x: 50, y: 0, width: 100, height: 100 };
      assert.equal(BoundingBoxMath.calculateIoU(box1, box4), 0.3333);
    });

    it('suppresses redundant overlapping boxes via Non-Maximum Suppression (NMS)', () => {
      const boxes = [
        { id: 'b1', confidence: 0.95, box: { x: 10, y: 10, width: 100, height: 100 } },
        { id: 'b2', confidence: 0.85, box: { x: 12, y: 12, width: 98, height: 98 } }, // heavy overlap with b1
        { id: 'b3', confidence: 0.92, box: { x: 250, y: 250, width: 80, height: 80 } }  // separate
      ];

      const filtered = BoundingBoxMath.nonMaxSuppression(boxes, 0.5);
      assert.equal(filtered.length, 2);
      assert.equal(filtered[0].id, 'b1');
      assert.equal(filtered[1].id, 'b3');
    });
  });

  // ==========================================================================
  // 3. On-Device Receipt Itemizer & Tax Calculator
  // ==========================================================================
  describe('On-Device Receipt Itemizer & Tax Calculator', () => {
    it('parses structured item rows, quantities, prices, subtotal, and tax', () => {
      const receiptText = `
        WHOLE FOODS ORGANIC MARKET
        STORE #102 • 2026-11-12
        2x Oat Milk Barista 1L     $8.50
        Artisan Multigrain Bread   $4.75
        Hass Avocados (4-Pack)     $5.25
        Dark Roast Coffee 250g     $9.50
        Subtotal                  $28.00
        Sales Tax (8.5%)           $2.38
        TOTAL                     $30.38
      `;

      const result = ReceiptItemizer.itemize(receiptText);

      assert.equal(result.merchant, 'WHOLE FOODS ORGANIC MARKET');
      assert.equal(result.currency, '$');
      assert.equal(result.itemCount, 4);
      assert.equal(result.items[0].name, 'Oat Milk Barista 1L');
      assert.equal(result.items[0].qty, 2);
      assert.equal(result.items[0].unitPrice, 4.25);
      assert.equal(result.items[0].amount, 8.50);

      assert.equal(result.subtotal, 28.00);
      assert.equal(result.taxRate, 0.085);
      assert.equal(result.taxAmount, 2.38);
      assert.equal(result.total, 30.38);
      assert.equal(result.isValidMath, true);
      assert.equal(result.mathVariance, 0.0);
      assert.ok(result.confidence >= 0.90);
    });

    it('handles Indian Rupee currency and tax breakdown (CGST / SGST)', () => {
      const inReceipt = [
        'DELHI BISTRO & CAFE',
        'Date: 2026-11-12',
        'Paneer Butter Masala       ₹320.00',
        'Butter Garlic Naan 2x      ₹120.00',
        'Jeera Rice                 ₹160.00',
        'Subtotal                   ₹600.00',
        'GST Tax (5%)                ₹30.00',
        'Grand Total                ₹630.00'
      ];

      const res = ReceiptItemizer.itemize(inReceipt);
      assert.equal(res.currency, '₹');
      assert.equal(res.subtotal, 600.00);
      assert.equal(res.taxAmount, 30.00);
      assert.equal(res.total, 630.00);
      assert.equal(res.isValidMath, true);
    });

    it('detects math discrepancy and reports variance when numbers do not match', () => {
      const corruptReceipt = `
        SUPERMART GROCERY
        Organic Apples             $5.00
        Almond Milk                $4.00
        Subtotal                   $9.00
        Tax                        $1.00
        TOTAL                     $15.00
      `;

      const res = ReceiptItemizer.itemize(corruptReceipt);
      // Expected total: 9 + 1 = 10.00. Printed: 15.00
      assert.equal(res.subtotal, 9.00);
      assert.equal(res.taxAmount, 1.00);
      assert.equal(res.calculatedTotal, 10.00);
      assert.equal(res.total, 15.00);
      assert.equal(res.isValidMath, false);
      assert.equal(res.mathVariance, 5.00);
    });

    it('derives subtotal from item sum when subtotal line is absent', () => {
      const rawLines = [
        'QUICK CAFE',
        'Espresso                   $3.50',
        'Croissant                  $4.50',
        'Total                      $8.00'
      ];

      const res = ReceiptItemizer.itemize(rawLines);
      assert.equal(res.subtotal, 8.00);
      assert.equal(res.total, 8.00);
      assert.equal(res.isValidMath, true);
    });
  });

  // ==========================================================================
  // 4. Document Semantic Classifier
  // ==========================================================================
  describe('Document Semantic Classifier', () => {
    it('classifies Retail Grocery Receipts accurately', () => {
      const text = 'Organic Grocery Subtotal $21.06 Tax 8% Total $21.06 Cashier #4';
      const cl = DocumentClassifier.classify(text);
      assert.equal(cl.type, VisionDocumentType.RECEIPT);
      assert.equal(cl.isFinancial, true);
      assert.ok(cl.confidence > 0.7);
    });

    it('classifies Commercial Invoices accurately', () => {
      const text = 'INVOICE #INV-2026-904 Bill To: Acme Corp Terms: Net 30 Due Date: 2026-12-01 Total Due: $4,500.00';
      const cl = DocumentClassifier.classify(text);
      assert.equal(cl.type, VisionDocumentType.INVOICE);
      assert.equal(cl.isFinancial, true);
    });

    it('classifies Airline Boarding Passes accurately', () => {
      const text = 'BOARDING PASS Flight AI-202 Gate B14 Seat 12A Zone 1 Passenger: Rajesh PNR: K92XP4';
      const cl = DocumentClassifier.classify(text);
      assert.equal(cl.type, VisionDocumentType.BOARDING_PASS);
      assert.equal(cl.isTravel, true);
      assert.ok(cl.confidence >= 0.8);
    });

    it('classifies Executive Business Cards accurately', () => {
      const text = 'Rajesh Kumar Director of Engineering rajesh@pravahos.dev Tel: +91-9876543210 www.pravahos.dev';
      const cl = DocumentClassifier.classify(text);
      assert.equal(cl.type, VisionDocumentType.BUSINESS_CARD);
    });

    it('classifies Technical Meeting Notes & Disclosures accurately', () => {
      const text = 'PRAVAHOS CONFIDENTIAL NOTE Meeting Agenda: Sensory HAL memory isolation and thermal closed-loop governor.';
      const cl = DocumentClassifier.classify(text);
      assert.equal(cl.type, VisionDocumentType.NOTE);
    });

    it('classifies QR Payment Payloads accurately', () => {
      const text = 'pravah://pay?to=bob@pravah&amount=250';
      const cl = DocumentClassifier.classify(text);
      assert.equal(cl.type, VisionDocumentType.QR_CODE);
    });
  });

  // ==========================================================================
  // 5. Synthetic Frame Pattern Generators
  // ==========================================================================
  describe('Synthetic Frame Pattern Generators', () => {
    it('generates Document Pattern with high-contrast RGB888 buffer and ground truth', () => {
      const pattern = SyntheticPatterns.generateDocumentPattern(200, 300);

      assert.equal(pattern.format, 'RGB888');
      assert.equal(pattern.width, 200);
      assert.equal(pattern.height, 300);
      assert.equal(pattern.buffer.length, 200 * 300 * 3);
      assert.ok(pattern.groundTruth);
      assert.equal(pattern.groundTruth.type, 'DOCUMENT');
      assert.equal(pattern.groundTruth.classification, VisionDocumentType.NOTE);
      assert.ok(pattern.groundTruth.boxes.length >= 3);

      // Verify canvas renderer runs without error
      const mockCtx = {
        fillStyle: '',
        strokeStyle: '',
        font: '',
        lineWidth: 1,
        fillRect: () => {},
        fillText: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {}
      };
      assert.doesNotThrow(() => pattern.renderToCanvas(mockCtx, 200, 300));
    });

    it('generates Retail Receipt Pattern with item rows and valid math', () => {
      const pattern = SyntheticPatterns.generateReceiptPattern(200, 300);

      assert.equal(pattern.format, 'RGB888');
      assert.ok(pattern.groundTruth);
      assert.equal(pattern.groundTruth.type, 'RECEIPT');
      assert.equal(pattern.groundTruth.merchant, 'ORGANIC HARVEST GROCERY');
      assert.equal(pattern.groundTruth.subtotal, 19.50);
      assert.equal(pattern.groundTruth.taxAmount, 1.56);
      assert.equal(pattern.groundTruth.total, 21.06);
      assert.equal(pattern.groundTruth.isValidMath, true);
      assert.equal(pattern.groundTruth.items.length, 4);
    });

    it('generates Barcode and QR Pattern with valid payment URI', () => {
      const pattern = SyntheticPatterns.generateBarcodePattern(200, 300);

      assert.equal(pattern.format, 'RGB888');
      assert.ok(pattern.groundTruth);
      assert.equal(pattern.groundTruth.type, 'QR_BARCODE');
      assert.equal(pattern.groundTruth.barcodeFormat, 'EAN-13');
      assert.equal(pattern.groundTruth.qrPayload, 'pravah://pay?to=bob@pravah&amount=250');
    });
  });

  // ==========================================================================
  // 6. Privacy Isolation & Zero-Cloud-Leak Capability Delegation
  // ==========================================================================
  describe('Zero-Cloud-Leak Guarantee & Runtime Capability Delegation', () => {
    let pipeline;
    let camera;

    beforeEach(() => {
      pipeline = new VisionPipeline();
      camera = new CameraSensorBridge({
        sensorId: 0,
        patternType: CameraPattern.RECEIPT,
        autoStart: true
      });
    });

    it('executes full Smart Scan and delegates to media.camera.capture and vision.ocr_extract', () => {
      const result = pipeline.executeSmartScan(camera);

      assert.equal(result.status, 'VERIFIED_ON_DEVICE');
      assert.equal(result.runtimeCapability, 'vision.ocr_extract');

      // 1. media.camera.capture record
      assert.ok(result.mediaCaptureRecord);
      assert.equal(result.mediaCaptureRecord.capabilityId, 'media.camera.capture');
      assert.match(result.mediaCaptureRecord.photoId, /^IMG_/);
      assert.equal(result.mediaCaptureRecord.format, 'RGB888');

      // 2. vision.ocr_extract record
      assert.ok(result.visionAnalysis);
      assert.equal(result.visionAnalysis.classification.type, VisionDocumentType.RECEIPT);
      assert.ok(result.visionAnalysis.itemizedReceipt);
      assert.equal(result.visionAnalysis.itemizedReceipt.total, 21.06);
      assert.equal(result.visionAnalysis.itemizedReceipt.isValidMath, true);

      // 3. 0-Cloud Leak Audit verification
      assert.equal(result.zeroCloudLeakAudit.airgapProtected, true);
      assert.equal(result.zeroCloudLeakAudit.cloudLeakBytes, 0);
      assert.equal(result.zeroCloudLeakAudit.networkSocketsEngaged, 0);
      assert.equal(result.visionAnalysis.cloudLeakBytes, 0);
      assert.equal(result.visionAnalysis.networkSocketsTouched, 0);
    });

    it('maintains strict zero network socket usage across repeated frame analyses', () => {
      for (let i = 0; i < 5; i++) {
        const frame = SyntheticPatterns.generateDocumentPattern(100, 150);
        const analysis = pipeline.analyzeFrame(frame);
        assert.equal(analysis.cloudLeakBytes, 0);
        assert.equal(analysis.networkSocketsTouched, 0);
        assert.equal(analysis.airgapProtected, true);
      }
      assert.equal(pipeline.cloudLeakBytes, 0);
      assert.equal(pipeline.networkSocketsTouched, 0);
      assert.equal(pipeline.processedFramesCount, 5);
    });
  });
});
