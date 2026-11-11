// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file installer.test.js
 * Automated test suite for PravahOS AOT Capability Synthesizer & Zero-Tax Dormancy Supervisor.
 *
 * Validates:
 * 1. APK package parser & metadata extraction for preset and uploaded packages.
 * 2. 4-Stage AOT compilation & capability synthesis pipeline:
 *    - Stage 1: Bytecode & Manifest Deconstruction
 *    - Stage 2: Ambient Wake-Lock Nullification & Daemon Purge (Zero-Tax Guarantee)
 *    - Stage 3: AOT ELF Capability Synthesis & Zircon VMO Allocation
 *    - Stage 4: Verification & 100% Frozen Dormancy Registration
 * 3. Microkernel Dormancy Supervisor:
 *    - Strict 0.00% CPU and 0.0 MB active RAM invariants for dormant apps.
 *    - Demand-paged transition on intent wake and zero-tax reclamation on freeze.
 *    - Microkernel Zero-Tax Audit verification engine.
 * 4. Pipeline event lifecycle & error handling.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  InstallerStage,
  InstallerStageMeta,
  DormancyState,
  SampleApkPresets,
  AotApkPackage,
  AotApkPipeline,
  DormancySupervisor,
  escapeHtml
} = require('../installer.js');

describe('PravahOS AOT APK Synthesizer & Dormancy Supervisor Subsystem', () => {

  // ==========================================================================
  // 1. APK Package Presets & Parser
  // ==========================================================================
  describe('APK Package Presets & Parser', () => {
    it('defines valid sample presets for Uber, Spotify, and WhatsApp', () => {
      assert.ok(SampleApkPresets.UBER);
      assert.ok(SampleApkPresets.SPOTIFY);
      assert.ok(SampleApkPresets.WHATSAPP);

      const uber = SampleApkPresets.UBER;
      assert.equal(uber.packageName, 'com.ubercab');
      assert.equal(uber.wakeLocksDetected, 8);
      assert.ok(uber.daemonsPurged.length >= 5);
      assert.ok(uber.synthesizedCapabilities.includes('pravah.intent.RIDE_DISPATCH'));

      const spotify = SampleApkPresets.SPOTIFY;
      assert.equal(spotify.packageName, 'com.spotify.music');
      assert.ok(spotify.daemonsPurged.length >= 6);
      assert.ok(spotify.synthesizedCapabilities.includes('hardware.audio.pcm'));

      const wa = SampleApkPresets.WHATSAPP;
      assert.equal(wa.packageName, 'com.whatsapp');
      assert.equal(wa.wakeLocksDetected, 14);
      assert.ok(wa.zirconVMOs.some(v => v.name.includes('cam_1080p')));
    });

    it('instantiates AotApkPackage from preset key', () => {
      const pkg = AotApkPackage.fromPreset('SPOTIFY');
      assert.equal(pkg.packageName, 'com.spotify.music');
      assert.equal(pkg.shortName, 'Spotify');
      assert.equal(pkg.isPreset, true);
      assert.match(pkg.getFormattedSize(), /MB/);
    });

    it('rejects unknown preset keys', () => {
      assert.throws(() => {
        AotApkPackage.fromPreset('UNKNOWN_APP');
      }, /Unknown APK preset/i);
    });

    it('instantiates AotApkPackage from valid uploaded .apk file descriptor', () => {
      const mockFile = {
        name: 'Signal-Private-Messenger.apk',
        size: 36700160,
        type: 'application/vnd.android.package-archive'
      };

      const pkg = AotApkPackage.fromFile(mockFile);
      assert.equal(pkg.isPreset, false);
      assert.equal(pkg.shortName, 'Signal-Private-Messenger');
      assert.ok(pkg.packageName.startsWith('org.pravah.userapp.'));
      assert.equal(pkg.sizeBytes, 36700160);
      assert.match(pkg.getFormattedSize(), /35\.0 MB/);
    });

    it('rejects non-apk file extensions', () => {
      assert.throws(() => {
        AotApkPackage.fromFile({ name: 'malware.exe' });
      }, /Unsupported package format/i);

      assert.throws(() => {
        AotApkPackage.fromFile({ name: 'document.pdf' });
      }, /Unsupported package format/i);
    });
  });

  // ==========================================================================
  // 2. 4-Stage AOT Compilation & Capability Synthesis Pipeline
  // ==========================================================================
  describe('4-Stage AOT Compilation & Capability Synthesis Pipeline', () => {
    let pipeline;
    let supervisor;

    beforeEach(() => {
      pipeline = new AotApkPipeline({ stepDelayMs: 0 }); // Fast 0ms for unit tests
      supervisor = new DormancySupervisor({ preloadPresets: false });
    });

    it('exposes defined stage metadata with exact stage titles', () => {
      assert.equal(
        InstallerStageMeta[InstallerStage.STAGE_1_DECONSTRUCT].title,
        'Deconstructing AndroidManifest & DEX bytecode...'
      );
      assert.equal(
        InstallerStageMeta[InstallerStage.STAGE_2_STRIP_WAKELOCKS].title,
        'Stripping ambient wake-locks and background daemons (Zero-Tax guarantee)...'
      );
      assert.equal(
        InstallerStageMeta[InstallerStage.STAGE_3_SYNTHESIZE_VMO].title,
        'Synthesizing native PravahOS capabilities & linking Zircon VMOs...'
      );
      assert.equal(
        InstallerStageMeta[InstallerStage.STAGE_4_COMPLETE].title,
        'Installed successfully as Native PravahOS Capability!'
      );
    });

    it('executes full 4-stage pipeline for Uber APK package', async () => {
      const stagesObserved = [];
      const progressesObserved = [];
      const logsObserved = [];

      pipeline.onStageChange = (stage, progress, meta) => {
        stagesObserved.push({ stage, progress, title: meta.title });
      };
      pipeline.onProgress = (pct) => {
        progressesObserved.push(pct);
      };
      pipeline.onLog = (log) => {
        logsObserved.push(log);
      };

      const pkg = AotApkPackage.fromPreset('UBER');
      const report = await pipeline.execute(pkg, supervisor);

      assert.equal(report.success, true);
      assert.equal(report.stage, InstallerStage.STAGE_4_COMPLETE);
      assert.equal(report.metrics.wakeLocksStripped, 8);
      assert.equal(report.metrics.daemonsPurged, 5);
      assert.equal(report.metrics.ambientCpuTax, '0.00%');
      assert.equal(report.metrics.activeRamTax, '0 MB');

      // Verify all 4 stages were visited
      assert.equal(stagesObserved.length, 4);
      assert.equal(stagesObserved[0].stage, 1);
      assert.equal(stagesObserved[1].stage, 2);
      assert.equal(stagesObserved[2].stage, 3);
      assert.equal(stagesObserved[3].stage, 4);

      // Verify Stage 1 logs
      const stage1Log = logsObserved.find(l => l.stage === 1 && l.message.includes('AndroidManifest.xml'));
      assert.ok(stage1Log);

      // Verify Stage 2 wake-lock nullification logs
      const stage2Log = logsObserved.find(l => l.stage === 2 && l.message.includes('ZX_ERR_ACCESS_DENIED'));
      assert.ok(stage2Log);

      // Verify Stage 3 Zircon VMO allocation logs
      const stage3Log = logsObserved.find(l => l.stage === 3 && l.message.includes('ALLOCATED ZIRCON VMO'));
      assert.ok(stage3Log);

      // Verify Stage 4 registration into Dormancy Supervisor
      assert.equal(supervisor.apps.has('com.ubercab'), true);
      const uberEntry = supervisor.apps.get('com.ubercab');
      assert.equal(uberEntry.state, DormancyState.FROZEN);
      assert.equal(uberEntry.cpuPercent, 0.00);
      assert.equal(uberEntry.activeRamMb, 0.0);
    });

    it('executes individual stages sequentially with correct state progression', async () => {
      const pkg = AotApkPackage.fromPreset('WHATSAPP');

      await pipeline.executeStage1(pkg);
      assert.equal(pipeline.currentStage, InstallerStage.STAGE_1_DECONSTRUCT);
      assert.equal(pipeline.currentProgress, 25);

      await pipeline.executeStage2(pkg);
      assert.equal(pipeline.currentStage, InstallerStage.STAGE_2_STRIP_WAKELOCKS);
      assert.equal(pipeline.currentProgress, 50);

      await pipeline.executeStage3(pkg);
      assert.equal(pipeline.currentStage, InstallerStage.STAGE_3_SYNTHESIZE_VMO);
      assert.equal(pipeline.currentProgress, 80);

      const report = await pipeline.executeStage4(pkg, supervisor);
      assert.equal(pipeline.currentStage, InstallerStage.STAGE_4_COMPLETE);
      assert.equal(pipeline.currentProgress, 100);
      assert.equal(report.metrics.wakeLocksStripped, 14);
    });

    it('rejects concurrent pipeline runs while active', async () => {
      const slowPipeline = new AotApkPipeline({ stepDelayMs: 20 });
      const pkg = AotApkPackage.fromPreset('SPOTIFY');

      const runPromise = slowPipeline.execute(pkg);

      await assert.rejects(
        async () => {
          await slowPipeline.execute(pkg);
        },
        /execution already in progress/i
      );

      await runPromise;
    });
  });

  // ==========================================================================
  // 3. Dormancy Supervisor Subsystem & Zero-Tax Guarantees
  // ==========================================================================
  describe('Dormancy Supervisor & Zero-Tax Telemetry Engine', () => {
    let supervisor;

    beforeEach(() => {
      supervisor = new DormancySupervisor({ preloadPresets: true });
    });

    it('preloads Uber, Spotify, and WhatsApp in 100% FROZEN state', () => {
      const snapshot = supervisor.getTelemetrySnapshot();
      assert.equal(snapshot.totalApps, 3);
      assert.equal(snapshot.frozenApps, 3);
      assert.equal(snapshot.activeApps, 0);

      // Invariants: 0.00% CPU and 0.0 MB RAM ambient tax
      assert.equal(snapshot.dormantCpuTax, '0.00%');
      assert.equal(snapshot.dormantRamTax, '0.0 MB');

      // Check all registered apps
      for (const app of snapshot.apps) {
        assert.equal(app.state, DormancyState.FROZEN);
        assert.equal(app.cpuPercent, 0.00);
        assert.equal(app.activeRamMb, 0.0);
        assert.equal(app.wakeLocksGranted, 0);
        assert.equal(app.daemonsActive, 0);
        assert.ok(app.vmoBackingMb > 0); // VMO backing is ready in zero-copy pool
      }
    });

    it('wakes an application on demand when explicit intent arrives', () => {
      const wokenApp = supervisor.wakeApp('com.spotify.music', 'pravah.intent.AUDIO_PLAYBACK');

      assert.equal(wokenApp.state, DormancyState.ACTIVE);
      assert.ok(wokenApp.cpuPercent > 0);
      assert.ok(wokenApp.activeRamMb > 0);
      assert.equal(wokenApp.lastIntent, 'pravah.intent.AUDIO_PLAYBACK');

      // Global snapshot should now reflect 1 active app and 2 frozen apps
      const snapshot = supervisor.getTelemetrySnapshot();
      assert.equal(snapshot.activeApps, 1);
      assert.equal(snapshot.frozenApps, 2);
      // Dormant apps still consume strictly 0.00%
      assert.equal(snapshot.dormantCpuTax, '0.00%');
      assert.equal(snapshot.dormantRamTax, '0.0 MB');
    });

    it('reclaims working set and freezes app back to 0.00% CPU and 0 MB RAM', () => {
      supervisor.wakeApp('com.whatsapp', 'pravah.intent.VIDEO_CALL');
      assert.equal(supervisor.apps.get('com.whatsapp').state, DormancyState.ACTIVE);

      // Freeze back
      const frozenApp = supervisor.freezeApp('com.whatsapp');
      assert.equal(frozenApp.state, DormancyState.FROZEN);
      assert.equal(frozenApp.cpuPercent, 0.00);
      assert.equal(frozenApp.activeRamMb, 0.0);

      const snapshot = supervisor.getTelemetrySnapshot();
      assert.equal(snapshot.activeApps, 0);
      assert.equal(snapshot.frozenApps, 3);
    });

    it('freezes all apps concurrently via freezeAll()', () => {
      supervisor.wakeApp('com.ubercab');
      supervisor.wakeApp('com.spotify.music');
      assert.equal(supervisor.getTelemetrySnapshot().activeApps, 2);

      supervisor.freezeAll();

      const snapshot = supervisor.getTelemetrySnapshot();
      assert.equal(snapshot.activeApps, 0);
      assert.equal(snapshot.frozenApps, 3);
      assert.equal(snapshot.dormantCpuTax, '0.00%');
      assert.equal(snapshot.dormantRamTax, '0.0 MB');
    });

    it('runs Microkernel Zero-Tax Audit and passes when all dormant apps adhere to invariants', () => {
      const audit = supervisor.runZeroTaxAudit();
      assert.equal(audit.passed, true);
      assert.equal(audit.auditedApps, 3);
      assert.equal(audit.frozenCount, 3);
      assert.equal(audit.violations.length, 0);
      assert.equal(audit.ambientCpuTaxPercent, 0.00);
      assert.equal(audit.backgroundRamTaxMb, 0.0);
    });

    it('detects violations if an app illegally consumes background CPU or RAM in dormant state', () => {
      const uber = supervisor.apps.get('com.ubercab');
      // Simulate an illegal scheduler cycle leak in frozen state
      uber.cpuPercent = 0.45;
      uber.activeRamMb = 4.2;

      const audit = supervisor.runZeroTaxAudit();
      assert.equal(audit.passed, false);
      assert.equal(audit.violations.length, 2);

      const cpuViolation = audit.violations.find(v => v.field === 'cpuPercent');
      assert.ok(cpuViolation);
      assert.equal(cpuViolation.actual, 0.45);

      const ramViolation = audit.violations.find(v => v.field === 'activeRamMb');
      assert.ok(ramViolation);
      assert.equal(ramViolation.actual, 4.2);

      // Reset
      supervisor.freezeApp('com.ubercab');
      const cleanAudit = supervisor.runZeroTaxAudit();
      assert.equal(cleanAudit.passed, true);
    });

    it('detects violations if an app has unsevered wake-locks in dormant state', () => {
      const spotify = supervisor.apps.get('com.spotify.music');
      spotify.wakeLocksGranted = 1; // Illegal leak

      const audit = supervisor.runZeroTaxAudit();
      assert.equal(audit.passed, false);
      const wlViolation = audit.violations.find(v => v.field === 'wakeLocksGranted');
      assert.ok(wlViolation);

      // Cleanup
      spotify.wakeLocksGranted = 0;
    });

    it('notifies subscribers upon state change', () => {
      let notifiedCount = 0;
      let lastSnapshot = null;

      const unsubscribe = supervisor.subscribe((snap) => {
        notifiedCount += 1;
        lastSnapshot = snap;
      });

      supervisor.wakeApp('com.ubercab');
      assert.equal(notifiedCount, 1);
      assert.equal(lastSnapshot.activeApps, 1);

      supervisor.freezeApp('com.ubercab');
      assert.equal(notifiedCount, 2);
      assert.equal(lastSnapshot.activeApps, 0);

      unsubscribe();
      supervisor.wakeApp('com.ubercab');
      assert.equal(notifiedCount, 2); // Listener removed
    });
  });

  // ==========================================================================
  // 4. Utility Functions
  // ==========================================================================
  describe('Utility & String Helpers', () => {
    it('escapes HTML strings securely to prevent XSS in logs and tables', () => {
      const raw = '<script>alert("xss")</script> & "test"';
      const escaped = escapeHtml(raw);
      assert.equal(escaped, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;test&quot;');
    });
  });
});
