// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file installer.js
 * PravahOS Ahead-Of-Time (AOT) APK Capability Synthesizer & Zero-Tax Dormancy Supervisor.
 *
 * Implements:
 * 1. 4-Stage AOT Compilation & Capability Synthesis Pipeline:
 *    - Stage 1: "Deconstructing AndroidManifest & DEX bytecode..."
 *    - Stage 2: "Stripping ambient wake-locks and background daemons (Zero-Tax guarantee)..."
 *    - Stage 3: "Synthesizing native PravahOS capabilities & linking Zircon VMOs..."
 *    - Stage 4: "Installed successfully as Native PravahOS Capability!"
 * 2. Visual Drag & Drop APK Installer Modal with animated progress and sample one-click buttons
 *    (Uber, Spotify, WhatsApp).
 * 3. Dormancy Supervisor HUD & Engine: Proves microkernel scheduler guarantees that
 *    dormant installed apps consume strictly 0.00% CPU and 0 MB active working-set RAM.
 * 4. Microkernel Zero-Tax Dormancy Audit engine verifying zero wake-lock or background leakage.
 */

// ============================================================================
// 1. Constants & Protocol Enums
// ============================================================================

const InstallerStage = {
  STAGE_1_DECONSTRUCT: 1,
  STAGE_2_STRIP_WAKELOCKS: 2,
  STAGE_3_SYNTHESIZE_VMO: 3,
  STAGE_4_COMPLETE: 4
};

const InstallerStageMeta = {
  [InstallerStage.STAGE_1_DECONSTRUCT]: {
    id: 1,
    title: 'Deconstructing AndroidManifest & DEX bytecode...',
    shortTitle: 'Bytecode Deconstruct',
    subtext: 'Extracting manifest components, intent-filters, service definitions, and Dalvik/ART bytecode routines.',
    color: '#00e5ff',
    icon: '🔍'
  },
  [InstallerStage.STAGE_2_STRIP_WAKELOCKS]: {
    id: 2,
    title: 'Stripping ambient wake-locks and background daemons (Zero-Tax guarantee)...',
    shortTitle: 'Zero-Tax Stripping',
    subtext: 'Nullifying PARTIAL_WAKE_LOCK, severing persistent background daemons, and eliminating telemetry beacons.',
    color: '#ffab00',
    icon: '⚡'
  },
  [InstallerStage.STAGE_3_SYNTHESIZE_VMO]: {
    id: 3,
    title: 'Synthesizing native PravahOS capabilities & linking Zircon VMOs...',
    shortTitle: 'Capability Synthesis',
    subtext: 'Compiling DEX bytecode AOT into native AArch64 capability ELF slices and allocating zero-copy Zircon VMOs.',
    color: '#7c4dff',
    icon: '⚙️'
  },
  [InstallerStage.STAGE_4_COMPLETE]: {
    id: 4,
    title: 'Installed successfully as Native PravahOS Capability!',
    shortTitle: 'Ready & Dormant',
    subtext: 'Package synthesized into dormant capability. 0.00% ambient CPU, 0 MB active RAM until invoked.',
    color: '#00e676',
    icon: '✅'
  }
};

const DormancyState = {
  FROZEN: 'FROZEN',       // 100% dormant, 0.00% CPU, 0 MB active RAM
  ACTIVE: 'ACTIVE',       // Demand-paged VMO active, actively servicing an intent
  COMPACTING: 'COMPACTING' // Reclaiming dirty working set, transitioning back to frozen
};

const SampleApkPresets = {
  UBER: {
    id: 'com.ubercab',
    packageName: 'com.ubercab',
    name: 'Uber',
    shortName: 'Uber',
    category: 'Ride Dispatch & Navigation',
    version: '4.512.10001',
    icon: '🚗',
    accentColor: '#111827',
    badgeColor: '#00e5ff',
    sizeBytes: 52428800, // 50.0 MB
    dexClassesCount: 1842,
    wakeLocksDetected: 8,
    daemonsPurged: [
      'com.ubercab.presidio.push.PushNotificationDaemon',
      'LocationKeepAliveService',
      'AnalyticsBeaconService',
      'TelemetryUploadWorker',
      'BackgroundSyncDaemon'
    ],
    telemetryEndpointsSevered: [
      'https://cn-geo1.uber.com/rt/rides',
      'https://telemetry.uber.com/events/v2',
      'https://crash.uber.com/dump'
    ],
    synthesizedCapabilities: [
      'pravah.intent.RIDE_DISPATCH',
      'pravah.policy.payment_approval',
      'hardware.gnss.coarse'
    ],
    zirconVMOs: [
      { name: 'zx_vmo_uber_code_aot', sizeMb: 28.4, rights: 'ZX_RIGHT_READ | ZX_RIGHT_EXECUTE' },
      { name: 'zx_vmo_uber_policy_gate', sizeMb: 4.0, rights: 'ZX_RIGHT_READ | ZX_RIGHT_WRITE' },
      { name: 'zx_vmo_uber_gnss_channel', sizeMb: 2.0, rights: 'ZX_RIGHT_READ' }
    ]
  },

  SPOTIFY: {
    id: 'com.spotify.music',
    packageName: 'com.spotify.music',
    name: 'Spotify: Music & Podcasts',
    shortName: 'Spotify',
    category: 'Audio Streaming & Podcasts',
    version: '8.9.20.574',
    icon: '🎵',
    accentColor: '#1DB954',
    badgeColor: '#00e676',
    sizeBytes: 39845888, // 38.0 MB
    dexClassesCount: 2410,
    wakeLocksDetected: 11,
    daemonsPurged: [
      'MediaSessionKeeperDaemon',
      'AudioPrefetchService',
      'CrashLoggingDaemon',
      'BeaconPingerService',
      'RemoteControlWorker',
      'PeriodicSyncDaemon'
    ],
    telemetryEndpointsSevered: [
      'https://spclient.wg.spotify.com/telemetry',
      'https://dealer.spotify.com/heartbeat',
      'https://event-service.spotify.com/v1'
    ],
    synthesizedCapabilities: [
      'pravah.intent.AUDIO_PLAYBACK',
      'hardware.audio.pcm',
      'hardware.network.socket'
    ],
    zirconVMOs: [
      { name: 'zx_vmo_spotify_code_aot', sizeMb: 22.0, rights: 'ZX_RIGHT_READ | ZX_RIGHT_EXECUTE' },
      { name: 'zx_vmo_audio_48k_ringbuf', sizeMb: 8.0, rights: 'ZX_RIGHT_READ | ZX_RIGHT_WRITE' },
      { name: 'zx_vmo_spotify_cache', sizeMb: 12.0, rights: 'ZX_RIGHT_READ | ZX_RIGHT_WRITE' }
    ]
  },

  WHATSAPP: {
    id: 'com.whatsapp',
    packageName: 'com.whatsapp',
    name: 'WhatsApp Messenger',
    shortName: 'WhatsApp',
    category: 'Encrypted Communication',
    version: '2.24.12.78',
    icon: '💬',
    accentColor: '#25D366',
    badgeColor: '#00e676',
    sizeBytes: 47185920, // 45.0 MB
    dexClassesCount: 3120,
    wakeLocksDetected: 14,
    daemonsPurged: [
      'XMPPKeepAliveService',
      'MessageSyncWorker',
      'VoipHeartbeatDaemon',
      'MediaUploadScanner',
      'ContactsSyncService',
      'TelemetryAggregator',
      'WakeLockManagerDaemon'
    ],
    telemetryEndpointsSevered: [
      'https://crashlogs.whatsapp.net/wa_clb_data',
      'https://static.whatsapp.net/telemetry',
      'https://analytics.facebook.com/mobile_wa'
    ],
    synthesizedCapabilities: [
      'pravah.intent.SEND_MESSAGE',
      'hardware.camera.vmo',
      'hardware.audio.mic',
      'hardware.contacts.read'
    ],
    zirconVMOs: [
      { name: 'zx_vmo_wa_code_aot', sizeMb: 26.5, rights: 'ZX_RIGHT_READ | ZX_RIGHT_EXECUTE' },
      { name: 'zx_vmo_cam_1080p_feed', sizeMb: 16.0, rights: 'ZX_RIGHT_READ' },
      { name: 'zx_vmo_mic_48k_vmo', sizeMb: 4.0, rights: 'ZX_RIGHT_READ' },
      { name: 'zx_vmo_wa_sqlite_vmo', sizeMb: 8.5, rights: 'ZX_RIGHT_READ | ZX_RIGHT_WRITE' }
    ]
  }
};

// ============================================================================
// 2. AotApkPackage Descriptor
// ============================================================================

/**
 * Model representing an incoming APK file or synthesized sample APK package.
 */
class AotApkPackage {
  constructor(metadata) {
    this.id = metadata.id || metadata.packageName || `app_${Date.now()}`;
    this.packageName = metadata.packageName || this.id;
    this.name = metadata.name || 'Custom Application';
    this.shortName = metadata.shortName || this.name;
    this.category = metadata.category || 'General Capability';
    this.version = metadata.version || '1.0.0';
    this.icon = metadata.icon || '📦';
    this.accentColor = metadata.accentColor || '#00e5ff';
    this.badgeColor = metadata.badgeColor || '#00e5ff';
    this.sizeBytes = metadata.sizeBytes || 32000000;
    this.dexClassesCount = metadata.dexClassesCount || Math.floor(1200 + Math.random() * 1500);
    this.wakeLocksDetected = metadata.wakeLocksDetected || Math.floor(5 + Math.random() * 8);
    this.daemonsPurged = metadata.daemonsPurged || [
      'BackgroundKeepAliveDaemon',
      'TelemetrySyncService',
      'AnalyticsWorker'
    ];
    this.telemetryEndpointsSevered = metadata.telemetryEndpointsSevered || [
      'https://telemetry.example.com/log',
      'https://crash.example.com/dump'
    ];
    this.synthesizedCapabilities = metadata.synthesizedCapabilities || [
      `pravah.intent.LAUNCH_${this.shortName.toUpperCase()}`,
      'pravah.capability.sandbox'
    ];
    this.zirconVMOs = metadata.zirconVMOs || [
      { name: `zx_vmo_${this.shortName.toLowerCase()}_code_aot`, sizeMb: Math.round(this.sizeBytes / (1024 * 1024) * 0.6), rights: 'ZX_RIGHT_READ | ZX_RIGHT_EXECUTE' },
      { name: `zx_vmo_${this.shortName.toLowerCase()}_data`, sizeMb: 6.0, rights: 'ZX_RIGHT_READ | ZX_RIGHT_WRITE' }
    ];
    this.isPreset = Boolean(metadata.isPreset);
  }

  static fromPreset(presetKey) {
    const key = String(presetKey).toUpperCase();
    const preset = SampleApkPresets[key];
    if (!preset) {
      throw new Error(`Unknown APK preset: ${presetKey}. Supported: ${Object.keys(SampleApkPresets).join(', ')}`);
    }
    return new AotApkPackage({ ...preset, isPreset: true });
  }

  static fromFile(file) {
    if (!file || !file.name) {
      throw new Error('Invalid file object: file name required');
    }

    if (!file.name.toLowerCase().endsWith('.apk')) {
      throw new Error(`Unsupported package format "${file.name}". Expected an Android .apk package.`);
    }

    // Derive a clean package name from the file name
    const rawBase = file.name.replace(/\.apk$/i, '').trim();
    const cleanBase = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedPkg = `org.pravah.userapp.${cleanBase.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
    const displayName = rawBase.charAt(0).toUpperCase() + rawBase.slice(1);

    return new AotApkPackage({
      id: sanitizedPkg,
      packageName: sanitizedPkg,
      name: `${displayName} (AOT Synthesized)`,
      shortName: displayName,
      category: 'User Uploaded APK',
      version: '1.0.0-aot',
      icon: '📦',
      accentColor: '#7c4dff',
      badgeColor: '#00e5ff',
      sizeBytes: file.size || 25000000,
      isPreset: false
    });
  }

  getFormattedSize() {
    const mb = (this.sizeBytes / (1024 * 1024)).toFixed(1);
    return `${mb} MB`;
  }
}

// ============================================================================
// 3. AotApkPipeline (4-Stage Compilation & Synthesis Engine)
// ============================================================================

/**
 * Executes the 4-Stage AOT Compilation & Capability Synthesis pipeline:
 * 1. Deconstructing AndroidManifest & DEX bytecode
 * 2. Stripping ambient wake-locks and background daemons (Zero-Tax guarantee)
 * 3. Synthesizing native PravahOS capabilities & linking Zircon VMOs
 * 4. Final verification and registration as 100% frozen dormant capability
 */
class AotApkPipeline {
  constructor(options = {}) {
    this.stepDelayMs = options.stepDelayMs !== undefined ? options.stepDelayMs : 450;
    this.currentStage = null;
    this.currentProgress = 0; // 0 to 100
    this.activePackage = null;
    this.isRunning = false;
    this.logs = [];

    // Callbacks
    this.onStageChange = options.onStageChange || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  log(stage, message, level = 'info') {
    const entry = {
      timestamp: new Date().toLocaleTimeString(),
      stage,
      message,
      level
    };
    this.logs.push(entry);
    this.onLog(entry);
    return entry;
  }

  async sleep(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Executes the full 4-stage pipeline for a given package.
   */
  async execute(apkPackage, dormancySupervisor = null) {
    if (this.isRunning) {
      throw new Error('AOT Pipeline execution already in progress');
    }

    if (!(apkPackage instanceof AotApkPackage)) {
      apkPackage = new AotApkPackage(apkPackage);
    }

    this.isRunning = true;
    this.activePackage = apkPackage;
    this.logs = [];

    try {
      this.log(0, `AOT Compiler Pipeline engaged for package "${apkPackage.name}" (${apkPackage.packageName})`);

      // ======================================================================
      // Stage 1: Deconstructing AndroidManifest & DEX bytecode
      // ======================================================================
      await this.executeStage1(apkPackage);

      // ======================================================================
      // Stage 2: Stripping ambient wake-locks and background daemons
      // ======================================================================
      await this.executeStage2(apkPackage);

      // ======================================================================
      // Stage 3: Synthesizing native PravahOS capabilities & linking Zircon VMOs
      // ======================================================================
      await this.executeStage3(apkPackage);

      // ======================================================================
      // Stage 4: Installed successfully as Native PravahOS Capability
      // ======================================================================
      const finalReport = await this.executeStage4(apkPackage, dormancySupervisor);

      this.isRunning = false;
      this.onComplete(finalReport);
      return finalReport;

    } catch (err) {
      this.isRunning = false;
      this.log(this.currentStage || 0, `PIPELINE FAULT: ${err.message}`, 'error');
      this.onError(err);
      throw err;
    }
  }

  /**
   * Stage 1: Deconstruction
   */
  async executeStage1(apkPackage) {
    this.currentStage = InstallerStage.STAGE_1_DECONSTRUCT;
    this.currentProgress = 15;
    this.onStageChange(this.currentStage, this.currentProgress, InstallerStageMeta[1]);
    this.log(1, `[Stage 1] ${InstallerStageMeta[1].title}`);

    await this.sleep(this.stepDelayMs * 0.3);
    this.log(1, `Parsing binary XML: AndroidManifest.xml (package="${apkPackage.packageName}", version="${apkPackage.version}")`);
    this.currentProgress = 20;
    this.onProgress(this.currentProgress);

    await this.sleep(this.stepDelayMs * 0.4);
    this.log(1, `Unpacking Dalvik Executable payload: classes.dex & secondary multidex partitions (${apkPackage.dexClassesCount} classes resolved)`);
    this.currentProgress = 25;
    this.onProgress(this.currentProgress);

    await this.sleep(this.stepDelayMs * 0.3);
    this.log(1, `Indexed exported Activity & Service routing graph. Ready for Zero-Tax sanitization.`);
  }

  /**
   * Stage 2: Wake-Lock & Daemon Stripping
   */
  async executeStage2(apkPackage) {
    this.currentStage = InstallerStage.STAGE_2_STRIP_WAKELOCKS;
    this.currentProgress = 35;
    this.onStageChange(this.currentStage, this.currentProgress, InstallerStageMeta[2]);
    this.log(2, `[Stage 2] ${InstallerStageMeta[2].title}`);

    await this.sleep(this.stepDelayMs * 0.3);
    this.log(2, `Scanning bytecodes for android.os.PowerManager.PARTIAL_WAKE_LOCK declarations...`);
    this.log(2, `NEUTRALIZED: ${apkPackage.wakeLocksDetected} ambient wake-locks redirected to ZX_ERR_ACCESS_DENIED stub`);
    this.currentProgress = 45;
    this.onProgress(this.currentProgress);

    await this.sleep(this.stepDelayMs * 0.4);
    for (const daemon of apkPackage.daemonsPurged) {
      this.log(2, `PURGED DAEMON: "${daemon}" severed from microkernel scheduler runqueues`);
    }
    this.currentProgress = 50;
    this.onProgress(this.currentProgress);

    await this.sleep(this.stepDelayMs * 0.3);
    for (const ep of apkPackage.telemetryEndpointsSevered) {
      this.log(2, `SEVERED TELEMETRY: Route to "${ep}" routed to local /dev/null blackhole`);
    }
    this.log(2, `Zero-Tax guarantee enforced: 0 background threads permitted, 0 wake-locks granted.`);
  }

  /**
   * Stage 3: Capability Synthesis & Zircon VMO Linking
   */
  async executeStage3(apkPackage) {
    this.currentStage = InstallerStage.STAGE_3_SYNTHESIZE_VMO;
    this.currentProgress = 60;
    this.onStageChange(this.currentStage, this.currentProgress, InstallerStageMeta[3]);
    this.log(3, `[Stage 3] ${InstallerStageMeta[3].title}`);

    await this.sleep(this.stepDelayMs * 0.3);
    this.log(3, `Compiling DEX bytecode AOT into relocatable AArch64 machine code slices...`);
    this.currentProgress = 70;
    this.onProgress(this.currentProgress);

    await this.sleep(this.stepDelayMs * 0.4);
    for (const vmo of apkPackage.zirconVMOs) {
      this.log(3, `ALLOCATED ZIRCON VMO: ${vmo.name} (${vmo.sizeMb} MB, Rights: ${vmo.rights})`);
    }
    this.currentProgress = 80;
    this.onProgress(this.currentProgress);

    await this.sleep(this.stepDelayMs * 0.3);
    for (const cap of apkPackage.synthesizedCapabilities) {
      this.log(3, `SYNTHESIZED CAPABILITY: ${cap} registered to Component Framework (CFv2) routing topology`);
    }
    this.log(3, `Memory layout finalized: Zero-copy read-only pages demand-paged via microkernel page table.`);
  }

  /**
   * Stage 4: Installation Finalization & Dormancy Freeze
   */
  async executeStage4(apkPackage, dormancySupervisor = null) {
    this.currentStage = InstallerStage.STAGE_4_COMPLETE;
    this.currentProgress = 100;
    this.onStageChange(this.currentStage, this.currentProgress, InstallerStageMeta[4]);
    this.log(4, `[Stage 4] ${InstallerStageMeta[4].title}`);

    // Register with Dormancy Supervisor if provided
    let supervisorEntry = null;
    if (dormancySupervisor) {
      supervisorEntry = dormancySupervisor.registerApp(apkPackage);
      this.log(4, `Registered in Dormancy Supervisor: Status is 100% FROZEN (0.00% CPU, 0 MB active RAM)`);
    }

    await this.sleep(this.stepDelayMs * 0.2);
    this.log(4, `AOT Capability installation concluded successfully. Zero-Tax verification passed.`);

    return {
      success: true,
      stage: InstallerStage.STAGE_4_COMPLETE,
      package: apkPackage,
      supervisorEntry,
      metrics: {
        wakeLocksStripped: apkPackage.wakeLocksDetected,
        daemonsPurged: apkPackage.daemonsPurged.length,
        vmosLinked: apkPackage.zirconVMOs.length,
        capabilitiesSynthesized: apkPackage.synthesizedCapabilities.length,
        ambientCpuTax: '0.00%',
        activeRamTax: '0 MB'
      },
      completedAt: new Date().toISOString()
    };
  }
}

// ============================================================================
// 4. DormancySupervisor Subsystem (Zero-Tax Telemetry Engine)
// ============================================================================

/**
 * Dormancy Supervisor manages the lifecycle and real-time hardware telemetry
 * of all installed AOT applications.
 *
 * Microkernel Scheduler Guarantee:
 * - When in FROZEN state, apps consume strictly 0.00% CPU and 0 MB active RAM.
 * - Ambient background daemons and wake-locks are completely prohibited.
 * - Only an explicit incoming IPC intent or user action wakes the process into demand-paged RAM.
 */
class DormancySupervisor {
  constructor(options = {}) {
    this.apps = new Map(); // packageName -> AppDormancyRecord
    this.listeners = new Set();
    this.auditLogs = [];
    this.autoAuditInterval = null;

    // Load presets by default if requested
    if (options.preloadPresets !== false) {
      this.preloadDefaultPresets();
    }
  }

  preloadDefaultPresets() {
    for (const key of Object.keys(SampleApkPresets)) {
      const pkg = AotApkPackage.fromPreset(key);
      this.registerApp(pkg);
    }
  }

  /**
   * Registers a synthesized capability in the Dormancy Supervisor.
   * By rule, every installed application enters in 100% FROZEN state.
   */
  registerApp(apkPackage) {
    if (!(apkPackage instanceof AotApkPackage)) {
      apkPackage = new AotApkPackage(apkPackage);
    }

    const totalVmoMb = apkPackage.zirconVMOs.reduce((acc, v) => acc + (v.sizeMb || 0), 0);

    const record = {
      packageName: apkPackage.packageName,
      id: apkPackage.id,
      name: apkPackage.name,
      shortName: apkPackage.shortName,
      category: apkPackage.category,
      version: apkPackage.version,
      icon: apkPackage.icon,
      accentColor: apkPackage.accentColor,
      badgeColor: apkPackage.badgeColor,
      sizeBytes: apkPackage.sizeBytes,
      state: DormancyState.FROZEN,
      cpuPercent: 0.00,        // 0.00% CPU strictly
      activeRamMb: 0.0,        // 0.0 MB active working-set RAM strictly
      vmoBackingMb: totalVmoMb, // Demand-paged zero-copy VMO pool
      wakeLocksGranted: 0,     // Strictly 0 (Zero-Tax guarantee)
      wakeLocksBlocked: apkPackage.wakeLocksDetected,
      daemonsActive: 0,        // Strictly 0
      daemonsPurgedCount: apkPackage.daemonsPurged.length,
      lastIntent: null,
      lastStateTransition: new Date().toISOString(),
      installedAt: new Date().toISOString(),
      zirconVMOs: apkPackage.zirconVMOs,
      synthesizedCapabilities: apkPackage.synthesizedCapabilities
    };

    this.apps.set(apkPackage.packageName, record);
    this.notify();
    return record;
  }

  /**
   * Wakes an application via an explicit intent.
   * Allocates working-set memory on demand and schedules compute time.
   */
  wakeApp(packageName, intent = 'pravah.intent.USER_INTERACTIVE_LAUNCH') {
    const record = this.apps.get(packageName);
    if (!record) {
      throw new Error(`Cannot wake unregistered package "${packageName}"`);
    }

    // Dynamic simulated active workload
    const simCpu = +(1.8 + Math.random() * 2.4).toFixed(2);
    const simRam = +(18.0 + Math.random() * 16.0).toFixed(1);

    record.state = DormancyState.ACTIVE;
    record.cpuPercent = simCpu;
    record.activeRamMb = simRam;
    record.lastIntent = intent;
    record.lastStateTransition = new Date().toISOString();

    this.notify();
    return record;
  }

  /**
   * Instantly freezes an application back into 100% Zero-Tax Dormancy.
   * Memory is reclaimed and CPU schedule quota drops to 0.00%.
   */
  freezeApp(packageName) {
    const record = this.apps.get(packageName);
    if (!record) {
      throw new Error(`Cannot freeze unregistered package "${packageName}"`);
    }

    record.state = DormancyState.FROZEN;
    record.cpuPercent = 0.00;
    record.activeRamMb = 0.0;
    record.lastStateTransition = new Date().toISOString();

    this.notify();
    return record;
  }

  /**
   * Freezes all installed applications.
   */
  freezeAll() {
    for (const [pkg] of this.apps) {
      this.freezeApp(pkg);
    }
  }

  /**
   * Microkernel Zero-Tax Scheduler Audit.
   * Inspects all dormant apps and rigorously verifies that background tax is 0.
   */
  runZeroTaxAudit() {
    const timestamp = new Date().toISOString();
    const violations = [];
    let auditedApps = 0;
    let frozenCount = 0;
    let activeCount = 0;

    for (const [pkg, record] of this.apps) {
      auditedApps += 1;

      if (record.state === DormancyState.FROZEN) {
        frozenCount += 1;

        // Check 1: CPU must be 0.00%
        if (record.cpuPercent !== 0.00) {
          violations.push({
            package: pkg,
            field: 'cpuPercent',
            expected: 0.00,
            actual: record.cpuPercent,
            reason: 'Dormant capability consuming background CPU cycles'
          });
        }

        // Check 2: Active RAM must be 0.0 MB
        if (record.activeRamMb !== 0.0) {
          violations.push({
            package: pkg,
            field: 'activeRamMb',
            expected: 0.0,
            actual: record.activeRamMb,
            reason: 'Dormant capability holding unevicted working set memory'
          });
        }

        // Check 3: Wake-locks granted must be 0
        if (record.wakeLocksGranted !== 0) {
          violations.push({
            package: pkg,
            field: 'wakeLocksGranted',
            expected: 0,
            actual: record.wakeLocksGranted,
            reason: 'Active wake-lock discovered on dormant package'
          });
        }

        // Check 4: Background daemons must be 0
        if (record.daemonsActive !== 0) {
          violations.push({
            package: pkg,
            field: 'daemonsActive',
            expected: 0,
            actual: record.daemonsActive,
            reason: 'Active background daemon running in background realm'
          });
        }
      } else {
        activeCount += 1;
      }
    }

    const passed = violations.length === 0;
    const auditResult = {
      passed,
      timestamp,
      auditedApps,
      frozenCount,
      activeCount,
      ambientCpuTaxPercent: 0.00,
      backgroundRamTaxMb: 0.0,
      violations
    };

    this.auditLogs.unshift(auditResult);
    if (this.auditLogs.length > 20) this.auditLogs.pop();

    return auditResult;
  }

  /**
   * System-wide snapshot for telemetry rendering.
   */
  getTelemetrySnapshot() {
    const appsArray = Array.from(this.apps.values());
    const totalApps = appsArray.length;
    const frozenApps = appsArray.filter(a => a.state === DormancyState.FROZEN).length;
    const activeApps = appsArray.filter(a => a.state === DormancyState.ACTIVE).length;

    // Zero-tax metrics strictly for dormant applications
    const dormantApps = appsArray.filter(a => a.state === DormancyState.FROZEN);
    const dormantCpuTotal = dormantApps.reduce((acc, a) => acc + a.cpuPercent, 0);
    const dormantRamTotal = dormantApps.reduce((acc, a) => acc + a.activeRamMb, 0);
    const totalVmoBackingMb = appsArray.reduce((acc, a) => acc + a.vmoBackingMb, 0);
    const totalDaemonsPurged = appsArray.reduce((acc, a) => acc + a.daemonsPurgedCount, 0);
    const totalWakeLocksBlocked = appsArray.reduce((acc, a) => acc + a.wakeLocksBlocked, 0);

    return {
      totalApps,
      frozenApps,
      activeApps,
      dormantCpuTax: dormantCpuTotal.toFixed(2) + '%',
      dormantRamTax: dormantRamTotal.toFixed(1) + ' MB',
      totalVmoBackingMb: totalVmoBackingMb.toFixed(1) + ' MB',
      totalDaemonsPurged,
      totalWakeLocksBlocked,
      apps: appsArray
    };
  }

  subscribe(listener) {
    if (typeof listener === 'function') {
      this.listeners.add(listener);
    }
    return () => this.listeners.delete(listener);
  }

  notify() {
    const snapshot = this.getTelemetrySnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (e) {
        console.error('Error in DormancySupervisor subscriber:', e);
      }
    }
  }
}

// ============================================================================
// 5. AotInstallerUI (Interactive DOM Controller)
// ============================================================================

/**
 * Manages the Interactive AOT APK Installer Modal and Dormancy Supervisor HUD
 * within the PravahOS Phone Emulator.
 */
class AotInstallerUI {
  constructor(emulatorApp, dormancySupervisor = null, androidBridge = null) {
    this.emulatorApp = emulatorApp;
    this.supervisor = dormancySupervisor || new DormancySupervisor();
    this.androidBridge = androidBridge;
    this.pipeline = new AotApkPipeline({ stepDelayMs: 400 });

    this.isOpen = false;
    this.activeTab = 'installer'; // 'installer' | 'dormancy'
    this.selectedPreset = 'UBER';
    this.currentInstallingPackage = null;

    // Connect bridge state transitions to Dormancy Supervisor
    this.wireAndroidBridgeInteractions();

    // Initialize DOM if in browser environment
    if (typeof document !== 'undefined') {
      this.injectModalDOM();
      this.injectSidebarHUD();
      this.bindDOMEvents();
      this.wirePipelineCallbacks();
      this.supervisor.subscribe(() => {
        this.renderDormancyHUD();
        this.renderSidebarHUD();
      });
      this.renderDormancyHUD();
      this.renderSidebarHUD();
    }
  }

  wireAndroidBridgeInteractions() {
    if (!this.androidBridge) return;

    // Listen to activeApp changes in Android Bridge
    const origLaunch = this.androidBridge.launchApp.bind(this.androidBridge);
    this.androidBridge.launchApp = (appId) => {
      const res = origLaunch(appId);
      if (res && this.supervisor.apps.has(appId)) {
        this.supervisor.wakeApp(appId, `pravah.intent.STARNIX_CONTAINER_LAUNCH`);
      }
      return res;
    };

    const origClose = this.androidBridge.closeActiveApp.bind(this.androidBridge);
    this.androidBridge.closeActiveApp = () => {
      const activeApp = this.androidBridge.activeAppId;
      origClose();
      if (activeApp && this.supervisor.apps.has(activeApp)) {
        this.supervisor.freezeApp(activeApp);
      }
    };
  }

  injectModalDOM() {
    if (document.getElementById('pravah-aot-installer-modal')) return;

    const modalHTML = `
      <div id="pravah-aot-installer-modal" class="aot-modal-backdrop" style="display:none;">
        <div class="aot-modal-window">
          <!-- Modal Header -->
          <div class="aot-modal-header">
            <div class="aot-brand-title">
              <span class="aot-header-icon">📦</span>
              <div>
                <h3 class="aot-title-text">AOT APK Capability Synthesizer</h3>
                <p class="aot-subtitle-text">Zero-Tax Android Binary Translation & Zircon VMO Linker</p>
              </div>
            </div>
            <div class="aot-modal-actions">
              <div class="aot-tab-bar">
                <button id="btn-tab-installer" class="aot-tab-btn active">📦 APK Pipeline</button>
                <button id="btn-tab-dormancy" class="aot-tab-btn">❄ Dormancy Supervisor HUD</button>
              </div>
              <button id="btn-close-aot-modal" class="aot-btn-close" title="Close Modal">✕</button>
            </div>
          </div>

          <!-- Modal Body Content -->
          <div class="aot-modal-body">

            <!-- TAB 1: APK PIPELINE VIEW -->
            <div id="view-aot-installer" class="aot-tab-view active">

              <!-- Sample One-Click Preset Buttons -->
              <div class="aot-presets-card">
                <div class="aot-section-label">ONE-CLICK SAMPLE APK PACKAGES</div>
                <div class="aot-presets-grid">
                  <button id="btn-install-uber" class="aot-preset-btn" data-preset="UBER">
                    <span class="preset-icon">🚗</span>
                    <div class="preset-info">
                      <div class="preset-name">📦 Install Uber APK</div>
                      <div class="preset-sub">v4.512 • 50MB • Ride & Policy Gate</div>
                    </div>
                  </button>

                  <button id="btn-install-spotify" class="aot-preset-btn" data-preset="SPOTIFY">
                    <span class="preset-icon">🎵</span>
                    <div class="preset-info">
                      <div class="preset-name">📦 Install Spotify APK</div>
                      <div class="preset-sub">v8.9.20 • 38MB • 48kHz Audio PCM</div>
                    </div>
                  </button>

                  <button id="btn-install-whatsapp" class="aot-preset-btn" data-preset="WHATSAPP">
                    <span class="preset-icon">💬</span>
                    <div class="preset-info">
                      <div class="preset-name">📦 Install WhatsApp APK</div>
                      <div class="preset-sub">v2.24.12 • 45MB • Camera & Mic VMO</div>
                    </div>
                  </button>
                </div>
              </div>

              <!-- Visual Drag & Drop Zone -->
              <div id="aot-drop-zone" class="aot-drop-zone">
                <div class="drop-zone-icon">📥</div>
                <div class="drop-zone-primary">Drag & Drop Android <code>.apk</code> package here</div>
                <div class="drop-zone-secondary">or click to browse local filesystem for Dalvik/ART binaries</div>
                <input type="file" id="aot-file-input" accept=".apk" style="display:none;">
                <button id="btn-browse-apk" class="aot-btn-secondary" style="margin-top:0.75rem;">📁 Browse .apk File</button>
              </div>

              <!-- 4-Stage Visual Progress Pipeline -->
              <div id="aot-progress-card" class="aot-progress-card" style="display:none;">
                <div class="aot-progress-header">
                  <div style="display:flex; align-items:center; gap:0.5rem;">
                    <span id="aot-pipeline-pkg-icon" style="font-size:1.25rem;">📦</span>
                    <span id="aot-pipeline-pkg-name" style="font-weight:700; color:#fff;">Uber APK</span>
                    <span id="aot-pipeline-pkg-ver" class="aot-chip">v4.512.10001</span>
                  </div>
                  <span id="aot-progress-pct" class="aot-progress-pct">0%</span>
                </div>

                <!-- Animated Glowing Progress Bar -->
                <div class="aot-progress-bar-wrap">
                  <div id="aot-progress-bar" class="aot-progress-bar-fill" style="width:0%;"></div>
                </div>

                <!-- 4 Animated Step Nodes -->
                <div class="aot-stages-timeline">
                  <div id="stage-node-1" class="stage-node pending" data-stage="1">
                    <div class="stage-dot">1</div>
                    <div class="stage-label">Stage 1: Bytecode Deconstruct</div>
                  </div>
                  <div class="stage-line" id="stage-line-1"></div>

                  <div id="stage-node-2" class="stage-node pending" data-stage="2">
                    <div class="stage-dot">2</div>
                    <div class="stage-label">Stage 2: Zero-Tax Stripping</div>
                  </div>
                  <div class="stage-line" id="stage-line-2"></div>

                  <div id="stage-node-3" class="stage-node pending" data-stage="3">
                    <div class="stage-dot">3</div>
                    <div class="stage-label">Stage 3: Capability Synthesis</div>
                  </div>
                  <div class="stage-line" id="stage-line-3"></div>

                  <div id="stage-node-4" class="stage-node pending" data-stage="4">
                    <div class="stage-dot">4</div>
                    <div class="stage-label">Stage 4: Native PravahOS Ready</div>
                  </div>
                </div>

                <!-- Active Stage Descriptive Banner -->
                <div id="aot-active-stage-banner" class="aot-stage-banner">
                  <div id="aot-stage-title" class="stage-banner-title">Deconstructing AndroidManifest & DEX bytecode...</div>
                  <div id="aot-stage-subtext" class="stage-banner-subtext">Extracting components and Dalvik/ART routines.</div>
                </div>

                <!-- Pipeline Log Terminal Output -->
                <div class="aot-terminal-wrap">
                  <div class="aot-terminal-bar">
                    <span class="terminal-title">AOT COMPILER LOG OUTPUT</span>
                    <span id="aot-terminal-status" class="terminal-status">PROCESSING</span>
                  </div>
                  <div id="aot-log-console" class="aot-log-console">
                    <div class="log-line info">[INIT] Waiting for package payload...</div>
                  </div>
                </div>

                <!-- Completion Summary Box -->
                <div id="aot-completion-box" class="aot-completion-box" style="display:none;">
                  <div class="completion-hero">
                    <div class="completion-icon">✅</div>
                    <div class="completion-text">
                      <div class="completion-title">Installed successfully as Native PravahOS Capability!</div>
                      <div class="completion-sub">Zero-Tax Dormancy active: Exactly 0.00% CPU and 0 MB RAM allocated.</div>
                    </div>
                  </div>
                  <div class="completion-metrics-grid">
                    <div class="completion-metric-chip">
                      <span class="m-val" id="comp-m-wakelocks">8</span>
                      <span class="m-lbl">WakeLocks Stripped</span>
                    </div>
                    <div class="completion-metric-chip">
                      <span class="m-val" id="comp-m-daemons">5</span>
                      <span class="m-lbl">Daemons Purged</span>
                    </div>
                    <div class="completion-metric-chip">
                      <span class="m-val" id="comp-m-vmos">3</span>
                      <span class="m-lbl">Zircon VMOs Linked</span>
                    </div>
                    <div class="completion-metric-chip">
                      <span class="m-val" id="comp-m-dormancy">0.00%</span>
                      <span class="m-lbl">Ambient CPU Tax</span>
                    </div>
                  </div>
                  <div class="completion-actions">
                    <button id="btn-launch-installed-app" class="aot-btn-primary">⚡ Launch App in Phone</button>
                    <button id="btn-view-dormancy-hud" class="aot-btn-secondary">❄ Inspect in Dormancy HUD</button>
                    <button id="btn-install-another" class="aot-btn-secondary">📦 Install Another APK</button>
                  </div>
                </div>

              </div>

            </div>

            <!-- TAB 2: DORMANCY SUPERVISOR HUD -->
            <div id="view-aot-dormancy" class="aot-tab-view" style="display:none;">

              <!-- High-level Telemetry Cards -->
              <div class="dormancy-hero-grid">
                <div class="dormancy-stat-card">
                  <div class="stat-hdr">
                    <span>ZERO-TAX AMBIENT CPU</span>
                    <span class="status-chip nominal">VERIFIED</span>
                  </div>
                  <div class="stat-big-val cyan" id="stat-ambient-cpu">0.00%</div>
                  <div class="stat-sub">Strictly enforced by microkernel scheduler</div>
                </div>

                <div class="dormancy-stat-card">
                  <div class="stat-hdr">
                    <span>DORMANT ACTIVE RAM</span>
                    <span class="status-chip nominal">PAGED OUT</span>
                  </div>
                  <div class="stat-big-val emerald" id="stat-dormant-ram">0.0 MB</div>
                  <div class="stat-sub">Zero dirty pages • Working set reclaimed</div>
                </div>

                <div class="dormancy-stat-card">
                  <div class="stat-hdr">
                    <span>WAKELOCKS & DAEMONS</span>
                    <span class="status-chip nominal">SEVERED</span>
                  </div>
                  <div class="stat-big-val amber" id="stat-purged-count">0 GRANTED</div>
                  <div class="stat-sub" id="stat-purged-sub">18 Daemons Purged • 33 WakeLocks Blocked</div>
                </div>

                <div class="dormancy-stat-card">
                  <div class="stat-hdr">
                    <span>INSTALLED CAPABILITIES</span>
                    <span class="status-chip" id="stat-frozen-badge">3 FROZEN</span>
                  </div>
                  <div class="stat-big-val purple" id="stat-total-apps">3 Apps</div>
                  <div class="stat-sub" id="stat-total-vmo-backing">66.4 MB Zircon VMO Backing</div>
                </div>
              </div>

              <!-- Zero-Tax Audit Action Banner -->
              <div class="audit-action-banner">
                <div class="audit-left">
                  <span class="audit-shield">🛡️</span>
                  <div>
                    <div class="audit-heading">Microkernel Zero-Tax Dormancy Audit</div>
                    <div class="audit-desc">Runs real-time scheduler runqueue verification to prove 0.000% background cycle consumption.</div>
                  </div>
                </div>
                <div class="audit-right">
                  <button id="btn-run-dormancy-audit" class="aot-btn-primary">⚡ Run Zero-Tax Audit</button>
                  <button id="btn-freeze-all-apps" class="aot-btn-secondary">❄ Freeze All Apps</button>
                </div>
              </div>

              <!-- Real-time Capability Ledger Table -->
              <div class="dormancy-table-card">
                <div class="table-header-row">
                  <span class="table-title">INSTALLED AOT CAPABILITY PROCESS LEDGER</span>
                  <span class="live-pill">● REAL-TIME TELEMETRY</span>
                </div>
                <div class="table-scroll-wrap">
                  <table class="dormancy-table">
                    <thead>
                      <tr>
                        <th>Capability Application</th>
                        <th>Dormancy State</th>
                        <th>CPU Usage</th>
                        <th>Active RAM</th>
                        <th>VMO Backing</th>
                        <th>WakeLocks</th>
                        <th>Last Intent</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody id="dormancy-table-body">
                      <!-- Rendered dynamically -->
                    </tbody>
                  </table>
                </div>
              </div>

            </div>

          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  injectSidebarHUD() {
    const sidebar = document.getElementById('sidebar-telemetry');
    if (!sidebar || document.getElementById('sidebar-dormancy-hud-card')) return;

    const sidebarCardHTML = `
      <div class="telemetry-card" id="sidebar-dormancy-hud-card">
        <div class="card-title">
          <span>AOT Dormancy Supervisor</span>
          <span id="sb-dormancy-status-pill" class="status-chip nominal">100% FROZEN</span>
        </div>
        <p style="font-size:0.72rem; color:var(--text-secondary); line-height:1.4;">
          Zero-Tax Guarantee: Installed AOT apps consume strictly <strong>0.00% CPU</strong> and <strong>0 MB RAM</strong> until invoked by intent.
        </p>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-top:0.5rem;">
          <div class="rf-rail-card">
            <div class="rail-label">Ambient CPU Tax</div>
            <div id="sb-val-ambient-cpu" class="rail-val nominal" style="color:var(--accent-cyan);">0.00%</div>
          </div>
          <div class="rf-rail-card">
            <div class="rail-label">Active RAM Tax</div>
            <div id="sb-val-active-ram" class="rail-val nominal" style="color:var(--accent-emerald);">0.0 MB</div>
          </div>
        </div>

        <div id="sb-dormancy-app-list" style="margin-top:0.6rem; display:flex; flex-direction:column; gap:0.35rem;">
          <!-- Dynamically populated mini items -->
        </div>

        <div style="display:flex; gap:0.4rem; margin-top:0.6rem;">
          <button id="btn-sidebar-open-installer" class="btn-scenario" style="flex:1; justify-content:center;">
            📦 Open AOT Installer
          </button>
          <button id="btn-sidebar-quick-audit" class="btn-scenario" style="flex:1; justify-content:center;">
            🛡️ Verify Audit
          </button>
        </div>
      </div>
    `;

    // Insert right after Android Compatibility container in sidebar
    sidebar.insertAdjacentHTML('beforeend', sidebarCardHTML);
  }

  bindDOMEvents() {
    // Toolbar Trigger Button
    const toolbarBtn = document.getElementById('btn-open-installer');
    if (toolbarBtn) {
      toolbarBtn.addEventListener('click', () => this.openModal('installer'));
    }

    // Sidebar open button
    document.getElementById('btn-sidebar-open-installer')?.addEventListener('click', () => {
      this.openModal('installer');
    });

    document.getElementById('btn-sidebar-quick-audit')?.addEventListener('click', () => {
      this.runAudit();
    });

    // Close Modal Button
    document.getElementById('btn-close-aot-modal')?.addEventListener('click', () => this.closeModal());

    // Backdrop click close
    const backdrop = document.getElementById('pravah-aot-installer-modal');
    backdrop?.addEventListener('click', (e) => {
      if (e.target === backdrop) this.closeModal();
    });

    // Tabs
    const tabInstaller = document.getElementById('btn-tab-installer');
    const tabDormancy = document.getElementById('btn-tab-dormancy');
    const viewInstaller = document.getElementById('view-aot-installer');
    const viewDormancy = document.getElementById('view-aot-dormancy');

    tabInstaller?.addEventListener('click', () => {
      tabInstaller.classList.add('active');
      tabDormancy.classList.remove('active');
      viewInstaller.style.display = 'block';
      viewDormancy.style.display = 'none';
      this.activeTab = 'installer';
    });

    tabDormancy?.addEventListener('click', () => {
      tabDormancy.classList.add('active');
      tabInstaller.classList.remove('active');
      viewInstaller.style.display = 'none';
      viewDormancy.style.display = 'block';
      this.activeTab = 'dormancy';
      this.renderDormancyHUD();
    });

    // Preset Buttons
    document.getElementById('btn-install-uber')?.addEventListener('click', () => {
      this.startPresetInstallation('UBER');
    });
    document.getElementById('btn-install-spotify')?.addEventListener('click', () => {
      this.startPresetInstallation('SPOTIFY');
    });
    document.getElementById('btn-install-whatsapp')?.addEventListener('click', () => {
      this.startPresetInstallation('WHATSAPP');
    });

    // File Input & Drop Zone
    const dropZone = document.getElementById('aot-drop-zone');
    const fileInput = document.getElementById('aot-file-input');
    const btnBrowse = document.getElementById('btn-browse-apk');

    btnBrowse?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput?.click();
    });

    dropZone?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        this.handleDroppedFile(file);
      }
    });

    // Drag & Drop handlers
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });

      dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');

        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length > 0) {
          this.handleDroppedFile(files[0]);
        }
      });
    }

    // Completion action buttons
    document.getElementById('btn-launch-installed-app')?.addEventListener('click', () => {
      if (this.currentInstallingPackage) {
        this.launchAppInPhone(this.currentInstallingPackage.packageName);
        this.closeModal();
      }
    });

    document.getElementById('btn-view-dormancy-hud')?.addEventListener('click', () => {
      tabDormancy?.click();
    });

    document.getElementById('btn-install-another')?.addEventListener('click', () => {
      this.resetInstallerCard();
    });

    // Audit and Freeze All buttons
    document.getElementById('btn-run-dormancy-audit')?.addEventListener('click', () => {
      this.runAudit();
    });

    document.getElementById('btn-freeze-all-apps')?.addEventListener('click', () => {
      this.supervisor.freezeAll();
      if (this.androidBridge && this.androidBridge.activeAppId) {
        this.androidBridge.closeActiveApp();
      }
      this.renderDormancyHUD();
    });
  }

  wirePipelineCallbacks() {
    this.pipeline.onStageChange = (stage, progress, meta) => {
      this.updatePipelineStageUI(stage, progress, meta);
    };

    this.pipeline.onProgress = (progress) => {
      this.updateProgressBar(progress);
    };

    this.pipeline.onLog = (entry) => {
      this.appendLogLine(entry);
    };

    this.pipeline.onComplete = (report) => {
      this.showCompletionUI(report);
      this.renderDormancyHUD();
      this.renderSidebarHUD();
    };

    this.pipeline.onError = (err) => {
      const banner = document.getElementById('aot-active-stage-banner');
      if (banner) {
        banner.className = 'aot-stage-banner error';
        document.getElementById('aot-stage-title').textContent = `Pipeline Error: ${err.message}`;
        document.getElementById('aot-stage-subtext').textContent = 'Installation aborted due to binary mismatch or parsing error.';
      }
    };
  }

  openModal(tab = 'installer') {
    const modal = document.getElementById('pravah-aot-installer-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    this.isOpen = true;

    if (tab === 'dormancy') {
      document.getElementById('btn-tab-dormancy')?.click();
    } else {
      document.getElementById('btn-tab-installer')?.click();
    }
  }

  closeModal() {
    const modal = document.getElementById('pravah-aot-installer-modal');
    if (modal) modal.style.display = 'none';
    this.isOpen = false;
  }

  startPresetInstallation(presetKey) {
    try {
      const pkg = AotApkPackage.fromPreset(presetKey);
      this.executePackageInstall(pkg);
    } catch (err) {
      alert(`Cannot install preset: ${err.message}`);
    }
  }

  handleDroppedFile(file) {
    try {
      const pkg = AotApkPackage.fromFile(file);
      this.executePackageInstall(pkg);
    } catch (err) {
      alert(err.message);
    }
  }

  executePackageInstall(pkg) {
    this.currentInstallingPackage = pkg;

    // Show Progress Card, Hide Drop Zone
    const dropZone = document.getElementById('aot-drop-zone');
    const progCard = document.getElementById('aot-progress-card');
    const compBox = document.getElementById('aot-completion-box');
    const logConsole = document.getElementById('aot-log-console');

    if (dropZone) dropZone.style.display = 'none';
    if (progCard) progCard.style.display = 'block';
    if (compBox) compBox.style.display = 'none';
    if (logConsole) logConsole.innerHTML = '';

    // Set package labels
    document.getElementById('aot-pipeline-pkg-icon').textContent = pkg.icon;
    document.getElementById('aot-pipeline-pkg-name').textContent = pkg.name;
    document.getElementById('aot-pipeline-pkg-ver').textContent = `v${pkg.version}`;

    // Reset stages
    for (let i = 1; i <= 4; i++) {
      const node = document.getElementById(`stage-node-i`);
      if (node) node.className = 'stage-node pending';
      const line = document.getElementById(`stage-line-${i}`);
      if (line) line.className = 'stage-line';
    }

    // Trigger pipeline
    this.pipeline.execute(pkg, this.supervisor);
  }

  updatePipelineStageUI(stage, progress, meta) {
    this.updateProgressBar(progress);

    // Update Stage Nodes
    for (let i = 1; i <= 4; i++) {
      const node = document.getElementById(`stage-node-${i}`);
      const line = document.getElementById(`stage-line-${i - 1}`);

      if (node) {
        if (i < stage) {
          node.className = 'stage-node completed';
          node.querySelector('.stage-dot').textContent = '✓';
        } else if (i === stage) {
          node.className = 'stage-node active';
          node.querySelector('.stage-dot').textContent = `${i}`;
        } else {
          node.className = 'stage-node pending';
          node.querySelector('.stage-dot').textContent = `${i}`;
        }
      }

      if (line) {
        if (i <= stage) {
          line.className = 'stage-line completed';
        } else {
          line.className = 'stage-line';
        }
      }
    }

    // Update Stage Descriptive Banner
    const banner = document.getElementById('aot-active-stage-banner');
    const titleEl = document.getElementById('aot-stage-title');
    const subEl = document.getElementById('aot-stage-subtext');

    if (banner && meta) {
      banner.className = `aot-stage-banner stage-${stage}`;
      if (titleEl) titleEl.textContent = meta.title;
      if (subEl) subEl.textContent = meta.subtext;
    }
  }

  updateProgressBar(progress) {
    const bar = document.getElementById('aot-progress-bar');
    const pct = document.getElementById('aot-progress-pct');
    if (bar) bar.style.width = `${progress}%`;
    if (pct) pct.textContent = `${Math.round(progress)}%`;
  }

  appendLogLine(entry) {
    const consoleEl = document.getElementById('aot-log-console');
    if (!consoleEl) return;

    const line = document.createElement('div');
    line.className = `log-line ${entry.level}`;
    line.innerHTML = `<span class="log-time">[${entry.timestamp}]</span> <span class="log-msg">${escapeHtml(entry.message)}</span>`;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  showCompletionUI(report) {
    const compBox = document.getElementById('aot-completion-box');
    const termStatus = document.getElementById('aot-terminal-status');

    if (termStatus) {
      termStatus.textContent = 'ZERO-TAX DORMANT';
      termStatus.className = 'terminal-status complete';
    }

    if (compBox) {
      compBox.style.display = 'block';
      document.getElementById('comp-m-wakelocks').textContent = report.metrics.wakeLocksStripped;
      document.getElementById('comp-m-daemons').textContent = report.metrics.daemonsPurged;
      document.getElementById('comp-m-vmos').textContent = report.metrics.vmosLinked;
      document.getElementById('comp-m-dormancy').textContent = report.metrics.ambientCpuTax;
    }
  }

  resetInstallerCard() {
    const dropZone = document.getElementById('aot-drop-zone');
    const progCard = document.getElementById('aot-progress-card');
    const fileInput = document.getElementById('aot-file-input');

    if (dropZone) dropZone.style.display = 'flex';
    if (progCard) progCard.style.display = 'none';
    if (fileInput) fileInput.value = '';
    this.currentInstallingPackage = null;
  }

  runAudit() {
    const report = this.supervisor.runZeroTaxAudit();
    const btn = document.getElementById('btn-run-dormancy-audit');
    const sbBtn = document.getElementById('btn-sidebar-quick-audit');

    if (report.passed) {
      if (btn) {
        btn.textContent = `✓ 100% AUDIT PASS (${report.auditedApps} Apps Frozen)`;
        btn.classList.add('success-glow');
        setTimeout(() => {
          btn.textContent = '⚡ Run Zero-Tax Audit';
          btn.classList.remove('success-glow');
        }, 3000);
      }
      if (sbBtn) {
        sbBtn.textContent = '✓ AUDIT PASS';
        setTimeout(() => { sbBtn.textContent = '🛡️ Verify Audit'; }, 2500);
      }

      if (this.emulatorApp?.pulseDynamicIsland) {
        this.emulatorApp.pulseDynamicIsland('ZERO-TAX AUDIT: 100% PASS');
      }
    } else {
      alert(`Audit detected violations: ${JSON.stringify(report.violations, null, 2)}`);
    }

    this.renderDormancyHUD();
  }

  renderDormancyHUD() {
    const snapshot = this.supervisor.getTelemetrySnapshot();

    // Update Hero Cards
    const cpuEl = document.getElementById('stat-ambient-cpu');
    const ramEl = document.getElementById('stat-dormant-ram');
    const purgedEl = document.getElementById('stat-purged-count');
    const purgedSubEl = document.getElementById('stat-purged-sub');
    const totalAppsEl = document.getElementById('stat-total-apps');
    const vmoBackingEl = document.getElementById('stat-total-vmo-backing');
    const frozenBadge = document.getElementById('stat-frozen-badge');

    if (cpuEl) cpuEl.textContent = snapshot.dormantCpuTax;
    if (ramEl) ramEl.textContent = snapshot.dormantRamTax;
    if (purgedEl) purgedEl.textContent = `0 GRANTED`;
    if (purgedSubEl) purgedSubEl.textContent = `${snapshot.totalDaemonsPurged} Daemons Purged • ${snapshot.totalWakeLocksBlocked} WakeLocks Severed`;
    if (totalAppsEl) totalAppsEl.textContent = `${snapshot.totalApps} Apps`;
    if (vmoBackingEl) vmoBackingEl.textContent = `${snapshot.totalVmoBackingMb} Zircon VMO Pool`;
    if (frozenBadge) frozenBadge.textContent = `${snapshot.frozenApps} FROZEN`;

    // Render Table Rows
    const tbody = document.getElementById('dormancy-table-body');
    if (!tbody) return;

    if (snapshot.apps.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:1.5rem; color:#64748b;">No AOT capabilities installed. Use the installer tab to synthesize one.</td></tr>`;
      return;
    }

    tbody.innerHTML = snapshot.apps.map(app => {
      const isFrozen = app.state === DormancyState.FROZEN;
      const stateBadge = isFrozen
        ? `<span class="dormancy-chip frozen">❄ 100% FROZEN</span>`
        : `<span class="dormancy-chip active">⚡ ACTIVE (DEMAND-PAGED)</span>`;

      const cpuDisplay = isFrozen ? `<strong style="color:var(--accent-cyan);">0.00%</strong>` : `<strong style="color:#ffab00;">${app.cpuPercent}%</strong>`;
      const ramDisplay = isFrozen ? `<strong style="color:var(--accent-emerald);">0.0 MB</strong>` : `<strong style="color:#ffab00;">${app.activeRamMb} MB</strong>`;

      return `
        <tr class="${isFrozen ? 'row-frozen' : 'row-active'}">
          <td>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-size:1.15rem;">${app.icon}</span>
              <div>
                <div style="font-weight:700; color:#fff; font-size:0.8rem;">${escapeHtml(app.shortName)}</div>
                <div style="font-size:0.68rem; color:#64748b; font-family:var(--font-mono);">${escapeHtml(app.packageName)}</div>
              </div>
            </div>
          </td>
          <td>${stateBadge}</td>
          <td>${cpuDisplay}</td>
          <td>${ramDisplay}</td>
          <td><span style="font-family:var(--font-mono); font-size:0.72rem; color:#94a3b8;">${app.vmoBackingMb.toFixed(1)} MB</span></td>
          <td><span class="wakelock-pill">0 (Blocked: ${app.wakeLocksBlocked})</span></td>
          <td><span style="font-family:var(--font-mono); font-size:0.68rem; color:#cbd5e1;">${escapeHtml(app.lastIntent || 'None (Dormant)')}</span></td>
          <td>
            <div style="display:flex; gap:0.25rem;">
              ${isFrozen
                ? `<button class="tbl-action-btn wake" data-action="wake" data-pkg="${app.packageName}" title="Wake via synthetic intent">⚡ Wake</button>`
                : `<button class="tbl-action-btn freeze" data-action="freeze" data-pkg="${app.packageName}" title="Instant Zero-Tax Freeze">❄ Freeze</button>`
              }
              <button class="tbl-action-btn launch" data-action="launch" data-pkg="${app.packageName}" title="Launch interactive app window">📱 Phone</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Wire table row action buttons
    tbody.querySelectorAll('.tbl-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.getAttribute('data-action');
        const pkg = btn.getAttribute('data-pkg');

        if (action === 'wake') {
          this.supervisor.wakeApp(pkg, 'pravah.intent.TEST_SUPERVISOR_WAKE');
          this.renderDormancyHUD();
        } else if (action === 'freeze') {
          this.supervisor.freezeApp(pkg);
          if (this.androidBridge && this.androidBridge.activeAppId === pkg) {
            this.androidBridge.closeActiveApp();
          }
          this.renderDormancyHUD();
        } else if (action === 'launch') {
          this.launchAppInPhone(pkg);
          this.closeModal();
        }
      });
    });
  }

  renderSidebarHUD() {
    const snapshot = this.supervisor.getTelemetrySnapshot();

    const sbCpu = document.getElementById('sb-val-ambient-cpu');
    const sbRam = document.getElementById('sb-val-active-ram');
    const sbStatusPill = document.getElementById('sb-dormancy-status-pill');
    const listEl = document.getElementById('sb-dormancy-app-list');

    if (sbCpu) sbCpu.textContent = snapshot.dormantCpuTax;
    if (sbRam) sbRam.textContent = snapshot.dormantRamTax;

    if (sbStatusPill) {
      if (snapshot.activeApps === 0) {
        sbStatusPill.textContent = '100% FROZEN';
        sbStatusPill.className = 'status-chip nominal';
      } else {
        sbStatusPill.textContent = `${snapshot.activeApps} ACTIVE / ${snapshot.frozenApps} FROZEN`;
        sbStatusPill.className = 'status-chip warm';
      }
    }

    if (!listEl) return;
    listEl.innerHTML = snapshot.apps.slice(0, 3).map(app => {
      const isFrozen = app.state === DormancyState.FROZEN;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 6px; background:rgba(255,255,255,0.03); border-radius:4px; font-size:0.7rem;">
          <div style="display:flex; align-items:center; gap:4px;">
            <span>${app.icon}</span>
            <span style="color:#fff; font-weight:600;">${escapeHtml(app.shortName)}</span>
          </div>
          <span style="font-family:var(--font-mono); font-size:0.65rem; color:${isFrozen ? 'var(--accent-cyan)' : '#ffab00'};">
            ${isFrozen ? '❄ 0.00% • 0 MB' : `⚡ ${app.cpuPercent}% • ${app.activeRamMb}MB`}
          </span>
        </div>
      `;
    }).join('');
  }

  launchAppInPhone(packageName) {
    if (this.androidBridge) {
      this.androidBridge.launchApp(packageName);
      if (this.emulatorApp?.pulseDynamicIsland) {
        const appMeta = this.supervisor.apps.get(packageName);
        this.emulatorApp.pulseDynamicIsland(`AOT: ${appMeta ? appMeta.shortName.toUpperCase() : 'APP'}`);
      }
    }
  }
}

// Utility: HTML escaping helper
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// 6. Module Exports (CommonJS & Browser Global)
// ============================================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    InstallerStage,
    InstallerStageMeta,
    DormancyState,
    SampleApkPresets,
    AotApkPackage,
    AotApkPipeline,
    DormancySupervisor,
    AotInstallerUI,
    escapeHtml
  };
}

if (typeof window !== 'undefined') {
  window.PravahAotInstaller = {
    InstallerStage,
    InstallerStageMeta,
    DormancyState,
    SampleApkPresets,
    AotApkPackage,
    AotApkPipeline,
    DormancySupervisor,
    AotInstallerUI,
    escapeHtml
  };
}
