// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file android_bridge.js
 * PravahOS Starnix-Style Android Application Compatibility Runtime & Bridge.
 *
 * Implements:
 * 1. Linux ABI Syscall Translator: Userspace translation of Linux system calls
 *    (openat, ioctl, mmap, socket, epoll, futex) to native Zircon primitives.
 * 2. Binder IPC Virtualization: Userspace virtual `/dev/binder` driver translating
 *    Android Binder parcels (BC_TRANSACTION / BR_REPLY) to Zircon channels and VMOs.
 * 3. Waydroid / microG Lightweight Services:
 *    - CameraService (mediating camera VMO handles via PravahOS Policy Gate)
 *    - AudioFlinger (streaming 48kHz 16-bit stereo PCM into PravahOS Audio HAL)
 *    - LocationManager (GNSS sensor mediation gated by Air-Gap & Policy Gate)
 *    - StorageManager (per-package isolated VFS MinFS capability sandbox)
 * 4. Deterministic Policy Gate Mediation: All capability requests from Android apps
 *    (WhatsApp, Spotify, Maps, Uber) are strictly evaluated before any handle is granted.
 */

import { RiskLevel, AuthorityLevel, PolicyDecision } from '../types.js';
import { PolicyGate } from '../policy.js';

// ============================================================================
// 1. Linux ABI Constants & Syscall Table (AArch64)
// ============================================================================

export const LinuxSyscall = Object.freeze({
  SYS_EPOLL_CREATE1: 20,
  SYS_IOCTL: 29,
  SYS_OPENAT: 56,
  SYS_CLOSE: 57,
  SYS_READ: 63,
  SYS_WRITE: 64,
  SYS_WRITEV: 66,
  SYS_EXIT: 93,
  SYS_FUTEX: 98,
  SYS_SOCKET: 198,
  SYS_MUNMAP: 215,
  SYS_CLONE: 220,
  SYS_MMAP: 222
});

export const LinuxErrno = Object.freeze({
  SUCCESS: 0,
  EPERM: 1,       // Operation not permitted
  ENOENT: 2,      // No such file or directory
  EIO: 5,         // I/O error
  EBADF: 9,       // Bad file descriptor
  EAGAIN: 11,     // Resource temporarily unavailable
  ENOMEM: 12,     // Out of memory
  EACCES: 13,     // Permission denied
  EINVAL: 22,     // Invalid argument
  ENOTTY: 25,     // Not a typewriter / inappropriate ioctl
  ENOSYS: 38      // Function not implemented
});

// ============================================================================
// 2. Android Binder IPC Protocol Constants
// ============================================================================

export const BinderCommand = Object.freeze({
  BC_TRANSACTION: 0x40406300,
  BC_REPLY: 0x40406301,
  BC_ACQUIRE_RESULT: 0x40046302,
  BC_FREE_BUFFER: 0x40086303,
  BC_INCREFS: 0x40046304,
  BC_ACQUIRE: 0x40046305,
  BC_RELEASE: 0x40046306,
  BC_DECREFS: 0x40046307
});

export const BinderReturn = Object.freeze({
  BR_ERROR: 0x7200,
  BR_OK: 0x7201,
  BR_TRANSACTION: 0x8500,
  BR_REPLY: 0x8501,
  BR_DEAD_REPLY: 0x7205,
  BR_TRANSACTION_COMPLETE: 0x7206,
  BR_INCREFS: 0x7207,
  BR_ACQUIRE: 0x7208,
  BR_RELEASE: 0x7209,
  BR_DECREFS: 0x720a,
  BR_FAILED_REPLY: 0x7211,
  BR_PERMISSION_DENIED: 0x720e
});

export const BinderObjectType = Object.freeze({
  BINDER_TYPE_BINDER: 0x73622a85, // 'sb*'
  BINDER_TYPE_HANDLE: 0x73682a85, // 'sh*' - mapped to Zircon channel
  BINDER_TYPE_FD: 0x66642a85,     // 'fd*' - mapped to Zircon VMO
  BINDER_TYPE_PTR: 0x70742a85     // 'pt*'
});

export const AshmemIoctl = Object.freeze({
  ASHMEM_SET_NAME: 0x41007701,
  ASHMEM_GET_NAME: 0x81007702,
  ASHMEM_SET_SIZE: 0x40087703,
  ASHMEM_GET_SIZE: 0x20007704,
  ASHMEM_SET_PROT_MASK: 0x40087705,
  ASHMEM_PIN: 0x40087707,
  ASHMEM_UNPIN: 0x40087708
});

export const AppLifecycleState = Object.freeze({
  NOT_INSTALLED: 'NOT_INSTALLED',
  INSTALLED: 'INSTALLED',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  SUSPENDED: 'SUSPENDED',
  STOPPED: 'STOPPED'
});

// ============================================================================
// 3. Starnix Userspace Linux ABI Translator
// ============================================================================

export class LinuxSyscallTranslator {
  constructor() {
    this.openFiles = new Map();
    this.nextFd = 100;
    this.vmoAllocations = new Map();
    this.syscallLog = [];
    this.maxLogEntries = 200;
  }

  logSyscall(name, args, result) {
    const entry = {
      timestamp: Date.now(),
      name,
      args,
      result: typeof result === 'object' ? { ...result } : result
    };
    this.syscallLog.push(entry);
    if (this.syscallLog.length > this.maxLogEntries) {
      this.syscallLog.shift();
    }
  }

  /**
   * Translates openat syscall. Traps virtual character devices (/dev/binder, /dev/ashmem).
   */
  sys_openat(dfd, path, flags, mode) {
    let resultFd = -LinuxErrno.ENOENT;
    if (path === '/dev/binder' || path === '/dev/hwbinder' || path === '/dev/vndbinder') {
      const fd = this.nextFd++;
      this.openFiles.set(fd, {
        type: 'BINDER_DEVICE',
        path,
        flags,
        bufferSize: 1024 * 1024,
        mapped: false
      });
      resultFd = fd;
    } else if (path === '/dev/ashmem') {
      const fd = this.nextFd++;
      this.openFiles.set(fd, {
        type: 'ASHMEM_DEVICE',
        path,
        name: 'unnamed',
        size: 0,
        protMask: 0x7, // PROT_READ | PROT_WRITE | PROT_EXEC
        vmoHandle: null
      });
      resultFd = fd;
    } else if (path.startsWith('/data/data/') || path.startsWith('/sdcard/')) {
      const fd = this.nextFd++;
      this.openFiles.set(fd, {
        type: 'SANDBOXED_STORAGE',
        path,
        flags,
        pos: 0
      });
      resultFd = fd;
    } else {
      resultFd = -LinuxErrno.EACCES;
    }

    this.logSyscall('sys_openat', { dfd, path, flags, mode }, resultFd);
    return resultFd;
  }

  /**
   * Translates ioctl syscall. Bridges Binder and Ashmem control codes.
   */
  sys_ioctl(fd, request, argp) {
    const file = this.openFiles.get(fd);
    if (!file) {
      this.logSyscall('sys_ioctl', { fd, request }, -LinuxErrno.EBADF);
      return -LinuxErrno.EBADF;
    }

    if (file.type === 'ASHMEM_DEVICE') {
      switch (request) {
        case AshmemIoctl.ASHMEM_SET_NAME:
          file.name = String(argp || 'ashmem_region');
          this.logSyscall('sys_ioctl_ashmem_set_name', { fd, name: file.name }, LinuxErrno.SUCCESS);
          return LinuxErrno.SUCCESS;
        case AshmemIoctl.ASHMEM_SET_SIZE:
          file.size = Number(argp || 0);
          // Allocate a Zircon VMO backing this ashmem region
          file.vmoHandle = `zx_vmo_${Math.random().toString(16).slice(2, 10)}`;
          this.vmoAllocations.set(file.vmoHandle, {
            size: file.size,
            name: file.name,
            fd
          });
          this.logSyscall('sys_ioctl_ashmem_set_size', { fd, size: file.size, vmo: file.vmoHandle }, LinuxErrno.SUCCESS);
          return LinuxErrno.SUCCESS;
        case AshmemIoctl.ASHMEM_GET_SIZE:
          this.logSyscall('sys_ioctl_ashmem_get_size', { fd }, file.size);
          return file.size;
        case AshmemIoctl.ASHMEM_SET_PROT_MASK:
          file.protMask = Number(argp || 0x7);
          return LinuxErrno.SUCCESS;
        default:
          return -LinuxErrno.EINVAL;
      }
    }

    if (file.type === 'BINDER_DEVICE') {
      return LinuxErrno.SUCCESS;
    }

    return -LinuxErrno.ENOTTY;
  }

  /**
   * Translates mmap syscall into Zircon zx_vmo_create / zx_vmar_map.
   */
  sys_mmap(addr, length, prot, flags, fd, offset) {
    const file = this.openFiles.get(fd);
    if (!file) {
      this.logSyscall('sys_mmap', { addr, length, fd }, -LinuxErrno.EBADF);
      return -LinuxErrno.EBADF;
    }

    if (file.type === 'ASHMEM_DEVICE') {
      const vmoId = file.vmoHandle || `zx_vmo_${Math.random().toString(16).slice(2, 10)}`;
      const baseAddress = 0x7000000000 + (fd * 0x100000);
      const res = {
        virtualAddress: `0x${baseAddress.toString(16)}`,
        vmoHandle: vmoId,
        length: length || file.size,
        rights: ['ZX_RIGHT_READ', 'ZX_RIGHT_WRITE', 'ZX_RIGHT_MAP']
      };
      this.logSyscall('sys_mmap_ashmem_to_vmo', { fd, vmoId, baseAddress: res.virtualAddress }, 0);
      return res;
    }

    if (file.type === 'BINDER_DEVICE') {
      file.mapped = true;
      const baseAddress = 0x6000000000 + (fd * 0x100000);
      const res = {
        virtualAddress: `0x${baseAddress.toString(16)}`,
        vmoHandle: `zx_vmo_binder_${fd}`,
        length: file.bufferSize,
        rights: ['ZX_RIGHT_READ', 'ZX_RIGHT_MAP']
      };
      this.logSyscall('sys_mmap_binder_ring', { fd, baseAddress: res.virtualAddress }, 0);
      return res;
    }

    return -LinuxErrno.ENODEV;
  }

  /**
   * Translates close syscall. Reclaims VMO bindings.
   */
  sys_close(fd) {
    const file = this.openFiles.get(fd);
    if (!file) {
      return -LinuxErrno.EBADF;
    }
    if (file.vmoHandle) {
      this.vmoAllocations.delete(file.vmoHandle);
    }
    this.openFiles.delete(fd);
    this.logSyscall('sys_close', { fd }, LinuxErrno.SUCCESS);
    return LinuxErrno.SUCCESS;
  }
}

// ============================================================================
// 4. Virtual Binder Driver & Parcel Virtualizer
// ============================================================================

export class BinderVirtualizer {
  constructor(policyGate) {
    this.policyGate = policyGate || new PolicyGate();
    this.services = new Map();
    this.channelMap = new Map(); // handleId -> { channelId, serviceName }
    this.nextHandleId = 1;
    this.transactionHistory = [];
    this.maxHistory = 150;
  }

  /**
   * Registers a microG/Android system service in the simulated ServiceManager.
   */
  registerService(name, serviceInstance) {
    const handleId = this.nextHandleId++;
    const channelId = `zx_chan_srv_${name}`;
    this.services.set(name, {
      name,
      handleId,
      channelId,
      instance: serviceInstance
    });
    this.channelMap.set(handleId, { channelId, serviceName: name });
    return handleId;
  }

  getService(name) {
    return this.services.get(name);
  }

  /**
   * Encodes a typed Android Parcel structure into a Zircon Channel message buffer.
   */
  encodeParcel(interfaceToken, action, data = {}, handles = []) {
    return {
      header: {
        interfaceToken,
        action,
        timestamp: Date.now()
      },
      data: { ...data },
      handles: handles.map(h => ({
        type: h.type || BinderObjectType.BINDER_TYPE_HANDLE,
        handle: h.handle
      }))
    };
  }

  /**
   * Dispatches a Binder transaction (BC_TRANSACTION -> BR_REPLY)
   * Virtualizes Android Binder IPC directly over Zircon channels.
   */
  async transact(callerPkg, serviceName, action, parcelData = {}) {
    const srv = this.services.get(serviceName);
    if (!srv) {
      const err = {
        code: BinderReturn.BR_DEAD_REPLY,
        error: `Service ${serviceName} not found in microG registry`
      };
      this.recordTransaction(callerPkg, serviceName, action, parcelData, err, false);
      return err;
    }

    try {
      const response = await srv.instance.onTransact(callerPkg, action, parcelData);
      const res = {
        code: BinderReturn.BR_REPLY,
        result: response
      };
      this.recordTransaction(callerPkg, serviceName, action, parcelData, res, true);
      return res;
    } catch (e) {
      const err = {
        code: BinderReturn.BR_PERMISSION_DENIED,
        error: e.message || 'Transaction rejected'
      };
      this.recordTransaction(callerPkg, serviceName, action, parcelData, err, false);
      return err;
    }
  }

  recordTransaction(callerPkg, serviceName, action, request, reply, success) {
    const record = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
      callerPkg,
      serviceName,
      action,
      request,
      reply,
      success
    };
    this.transactionHistory.push(record);
    if (this.transactionHistory.length > this.maxHistory) {
      this.transactionHistory.shift();
    }
  }
}

// ============================================================================
// 5. Waydroid / microG Simulated System Services
// ============================================================================

/**
 * Camera HAL Service: Bridges Android Camera2 API to PravahOS camera capability.
 * Enforces mandatory Policy Gate check before delegating a camera frame VMO.
 */
export class AndroidCameraService {
  constructor(policyGate, sensoryBridge = null) {
    this.policyGate = policyGate;
    this.sensoryBridge = sensoryBridge;
    this.activeSessions = new Map();
  }

  async onTransact(callerPkg, action, parcel) {
    switch (action) {
      case 'openCamera': {
        const cameraId = parcel.cameraId ?? 0;
        // Evaluate caller with Policy Gate
        const evalResult = this.policyGate.evaluate({
          caller: {
            componentUrl: `starnix://${callerPkg}`,
            delegatedAuthority: AuthorityLevel.EXECUTE
          },
          capabilityDescriptor: {
            id: 'hardware.camera.vmo',
            riskLevel: RiskLevel.CONSEQUENTIAL,
            requiredAuthority: AuthorityLevel.EXECUTE
          },
          contextSource: 'android_container_request'
        });

        if (evalResult.decision === PolicyDecision.DENY) {
          throw new Error(`PolicyGate denied Camera access to ${callerPkg}: ${evalResult.reason}`);
        }

        const vmoHandle = `zx_vmo_cam_frame_${callerPkg}_${Date.now()}`;
        const session = {
          sessionId: `cam_sess_${Date.now()}`,
          callerPkg,
          cameraId,
          vmoHandle,
          resolution: { width: 1920, height: 1080, format: 'ARGB8888', fps: 60 },
          active: true,
          policyAudit: evalResult
        };
        this.activeSessions.set(callerPkg, session);

        return {
          status: 'SUCCESS',
          sessionToken: session.sessionId,
          cameraVmoHandle: vmoHandle,
          resolution: session.resolution,
          policyGateDecision: evalResult.decision
        };
      }

      case 'capturePhoto': {
        const session = this.activeSessions.get(callerPkg);
        if (!session || !session.active) {
          throw new Error(`No active camera session for ${callerPkg}`);
        }
        return {
          status: 'CAPTURED',
          vmoHandle: session.vmoHandle,
          bytes: 1920 * 1080 * 4,
          timestamp: Date.now(),
          metadata: { iso: 100, exposureMs: 16.6, sensor: 'Sony IMX890 50MP' }
        };
      }

      case 'closeCamera': {
        this.activeSessions.delete(callerPkg);
        return { status: 'CLOSED' };
      }

      default:
        throw new Error(`Unsupported CameraService action: ${action}`);
    }
  }
}

/**
 * AudioFlinger Service: Streams Android AudioTrack PCM buffers into PravahOS Audio HAL.
 */
export class AndroidAudioFlingerService {
  constructor(sensoryBridge = null) {
    this.sensoryBridge = sensoryBridge;
    this.activeTracks = new Map();
    this.sampleRate = 48000;
    this.channels = 2;
  }

  async onTransact(callerPkg, action, parcel) {
    switch (action) {
      case 'createAudioTrack': {
        const trackId = `track_${callerPkg}_${Date.now()}`;
        const ringBufferVmo = `zx_vmo_audio_ring_${trackId}`;
        const track = {
          trackId,
          callerPkg,
          streamType: parcel.streamType || 'STREAM_MUSIC',
          sampleRate: this.sampleRate,
          channels: this.channels,
          ringBufferVmo,
          state: 'INITIALIZED',
          framesWritten: 0
        };
        this.activeTracks.set(trackId, track);
        return {
          status: 'TRACK_CREATED',
          trackId,
          ringBufferVmo,
          bufferSizeFrames: 4096
        };
      }

      case 'writePcmData': {
        const track = this.activeTracks.get(parcel.trackId);
        if (!track) {
          throw new Error(`AudioTrack ${parcel.trackId} not found`);
        }
        const frames = parcel.frames || 512;
        track.framesWritten += frames;
        track.state = 'PLAYING';

        // Synthesize simulated RMS dBFS
        const rmsDbfs = -18.5 + (Math.sin(Date.now() / 300) * 4);
        return {
          status: 'SUCCESS',
          framesWritten: frames,
          rmsDbfs: Math.round(rmsDbfs * 10) / 10,
          totalFrames: track.framesWritten
        };
      }

      case 'pauseTrack': {
        const track = this.activeTracks.get(parcel.trackId);
        if (track) track.state = 'PAUSED';
        return { status: 'PAUSED' };
      }

      default:
        throw new Error(`Unsupported AudioFlinger action: ${action}`);
    }
  }
}

/**
 * LocationManager Service: Mediates GNSS sensor updates gated by Policy Gate and Air-Gap switch.
 */
export class AndroidLocationManagerService {
  constructor(policyGate, isAirGapped = true) {
    this.policyGate = policyGate;
    this.isAirGapped = isAirGapped;
  }

  setAirGap(airGapped) {
    this.isAirGapped = airGapped;
  }

  async onTransact(callerPkg, action, parcel) {
    switch (action) {
      case 'getLastKnownLocation':
      case 'requestLocationUpdates': {
        const evalResult = this.policyGate.evaluate({
          caller: {
            componentUrl: `starnix://${callerPkg}`,
            delegatedAuthority: AuthorityLevel.EXECUTE
          },
          capabilityDescriptor: {
            id: 'hardware.location.gnss',
            riskLevel: RiskLevel.CONSEQUENTIAL,
            requiredAuthority: AuthorityLevel.EXECUTE
          },
          contextSource: 'android_container_request'
        });

        if (evalResult.decision === PolicyDecision.DENY) {
          throw new Error(`PolicyGate denied Location access to ${callerPkg}`);
        }

        // Return local GNSS coordinates. When air-gapped, cellular/Wi-Fi positioning is severed.
        return {
          status: 'LOCATION_ACQUIRED',
          latitude: 28.6139,
          longitude: 77.2090,
          altitudeMeters: 216,
          accuracyMeters: this.isAirGapped ? 4.5 : 1.8,
          provider: this.isAirGapped ? 'LOCAL_GNSS_ONLY' : 'FUSED_GNSS_WIFI',
          airGapEnforced: this.isAirGapped,
          timestamp: Date.now()
        };
      }

      default:
        throw new Error(`Unsupported LocationManager action: ${action}`);
    }
  }
}

/**
 * StorageManager Service: Enforces sandboxed MinFS mounts per package.
 */
export class AndroidStorageManagerService {
  constructor() {
    this.packageDirectories = new Map();
  }

  async onTransact(callerPkg, action, parcel) {
    switch (action) {
      case 'getSandboxPath': {
        let dir = this.packageDirectories.get(callerPkg);
        if (!dir) {
          dir = {
            dataDir: `/data/data/${callerPkg}`,
            cacheDir: `/data/data/${callerPkg}/cache`,
            filesDir: `/data/data/${callerPkg}/files`,
            minfsStorageHandle: `zx_storage_minfs_${callerPkg}`
          };
          this.packageDirectories.set(callerPkg, dir);
        }
        return {
          status: 'SUCCESS',
          paths: dir,
          isolationEnforced: true
        };
      }

      case 'writeFile': {
        const targetPath = parcel.path || '';
        // Invariant: An app can only write into its own sandbox directory
        if (!targetPath.startsWith(`/data/data/${callerPkg}/`)) {
          throw new Error(`Storage Sandbox Violation: ${callerPkg} cannot write to ${targetPath}`);
        }
        return {
          status: 'WRITTEN',
          bytes: (parcel.data || '').length,
          path: targetPath
        };
      }

      default:
        throw new Error(`Unsupported StorageManager action: ${action}`);
    }
  }
}

// ============================================================================
// 6. Predefined Android Application Profiles
// ============================================================================

export const DefaultAndroidApps = Object.freeze({
  'com.whatsapp': {
    packageName: 'com.whatsapp',
    appName: 'WhatsApp',
    versionName: '2.24.12.78',
    category: 'COMMUNICATION',
    icon: '💬',
    accentColor: '#25D366',
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_CONTACTS'
    ],
    mainActivity: 'com.whatsapp.HomeActivity',
    services: ['android.hardware.camera2', 'android.media.IAudioFlinger'],
    defaultAction: 'video_call_camera'
  },

  'com.spotify.music': {
    packageName: 'com.spotify.music',
    appName: 'Spotify',
    versionName: '8.9.20.574',
    category: 'AUDIO_STREAMING',
    icon: '🎵',
    accentColor: '#1DB954',
    permissions: [
      'android.permission.MEDIA_CONTENT_CONTROL',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
    ],
    mainActivity: 'com.spotify.music.MainActivity',
    services: ['android.media.IAudioFlinger'],
    defaultAction: 'stream_audio'
  },

  'com.google.android.apps.maps': {
    packageName: 'com.google.android.apps.maps',
    appName: 'Google Maps',
    versionName: '11.108.0101',
    category: 'NAVIGATION',
    icon: '🗺',
    accentColor: '#4285F4',
    permissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION'
    ],
    mainActivity: 'com.google.android.maps.MapsActivity',
    services: ['android.location.ILocationManager'],
    defaultAction: 'query_gnss'
  },

  'com.ubercab': {
    packageName: 'com.ubercab',
    appName: 'Uber',
    versionName: '4.512.10001',
    category: 'TRANSPORTATION',
    icon: '🚗',
    accentColor: '#000000',
    permissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.PAYMENT'
    ],
    mainActivity: 'com.ubercab.presidio.app.core.root.RootActivity',
    services: ['android.location.ILocationManager'],
    defaultAction: 'book_ride_gated'
  }
});

// ============================================================================
// 7. Master Android Compatibility Container Controller
// ============================================================================

export class AndroidContainerRuntime {
  constructor(options = {}) {
    this.policyGate = options.policyGate || new PolicyGate();
    this.translator = new LinuxSyscallTranslator();
    this.virtualizer = new BinderVirtualizer(this.policyGate);

    // Initialize microG services
    this.cameraService = new AndroidCameraService(this.policyGate);
    this.audioService = new AndroidAudioFlingerService();
    this.locationService = new AndroidLocationManagerService(this.policyGate, true);
    this.storageService = new AndroidStorageManagerService();

    // Register into virtual Binder ServiceManager
    this.virtualizer.registerService('android.hardware.camera2', this.cameraService);
    this.virtualizer.registerService('android.media.IAudioFlinger', this.audioService);
    this.virtualizer.registerService('android.location.ILocationManager', this.locationService);
    this.virtualizer.registerService('android.os.storage.IStorageManager', this.storageService);

    // Installed application registry
    this.apps = new Map();
    this.activeApps = new Map(); // packageName -> { state, launchTime, pid, windowHandle }
    this.nextPid = 1000;

    // Install default showcase applications
    Object.values(DefaultAndroidApps).forEach(app => this.installApp(app));

    this.containerState = 'RUNNING';
  }

  installApp(manifest) {
    if (!manifest.packageName) {
      throw new Error('Invalid APK manifest: packageName required');
    }
    this.apps.set(manifest.packageName, {
      ...manifest,
      installedAt: Date.now(),
      state: AppLifecycleState.INSTALLED
    });
  }

  getApp(packageName) {
    return this.apps.get(packageName);
  }

  listInstalledApps() {
    return Array.from(this.apps.values());
  }

  /**
   * Launches an Android application inside the Starnix sandbox realm.
   */
  async launchApp(packageName, activityName = null) {
    const app = this.apps.get(packageName);
    if (!app) {
      throw new Error(`Application ${packageName} not installed in Starnix realm`);
    }

    const pid = this.nextPid++;
    const windowHandle = `zx_window_android_${packageName}_${pid}`;

    // Allocate Linux process table entry & open standard files via translator
    const binderFd = this.translator.sys_openat(-100, '/dev/binder', 0x2, 0);
    const ashmemFd = this.translator.sys_openat(-100, '/dev/ashmem', 0x2, 0);

    // Configure sandbox storage paths
    await this.virtualizer.transact(packageName, 'android.os.storage.IStorageManager', 'getSandboxPath');

    const runtimeApp = {
      packageName,
      appName: app.appName,
      pid,
      windowHandle,
      binderFd,
      ashmemFd,
      state: AppLifecycleState.RUNNING,
      launchTime: Date.now(),
      activity: activityName || app.mainActivity,
      activeCapabilities: []
    };

    this.activeApps.set(packageName, runtimeApp);
    app.state = AppLifecycleState.RUNNING;

    return runtimeApp;
  }

  /**
   * Pauses an active Android application (Lifecycle onPause).
   */
  pauseApp(packageName) {
    const active = this.activeApps.get(packageName);
    if (active) {
      active.state = AppLifecycleState.PAUSED;
      const app = this.apps.get(packageName);
      if (app) app.state = AppLifecycleState.PAUSED;
      return true;
    }
    return false;
  }

  /**
   * Resumes an Android application (Lifecycle onResume).
   */
  resumeApp(packageName) {
    const active = this.activeApps.get(packageName);
    if (active) {
      active.state = AppLifecycleState.RUNNING;
      const app = this.apps.get(packageName);
      if (app) app.state = AppLifecycleState.RUNNING;
      return true;
    }
    return false;
  }

  /**
   * Terminates an active Android application. Reclaims open FDs and VMOs.
   */
  terminateApp(packageName) {
    const active = this.activeApps.get(packageName);
    if (!active) return false;

    // Release Linux FDs
    if (active.binderFd) this.translator.sys_close(active.binderFd);
    if (active.ashmemFd) this.translator.sys_close(active.ashmemFd);

    // Close any camera or audio sessions
    this.cameraService.activeSessions.delete(packageName);

    this.activeApps.delete(packageName);
    const app = this.apps.get(packageName);
    if (app) app.state = AppLifecycleState.INSTALLED;
    return true;
  }

  /**
   * Master Capability Demonstration: WhatsApp Video Call with Camera Delegation.
   * Gated by PravahOS Policy Gate. Delegates camera VMO handle.
   */
  async executeWhatsAppComponent(action = 'open_camera') {
    const pkg = 'com.whatsapp';
    if (!this.activeApps.has(pkg)) {
      await this.launchApp(pkg);
    }

    if (action === 'open_camera') {
      const res = await this.virtualizer.transact(pkg, 'android.hardware.camera2', 'openCamera', {
        cameraId: 0
      });

      const active = this.activeApps.get(pkg);
      if (active && res.code === BinderReturn.BR_REPLY) {
        active.activeCapabilities.push('hardware.camera.vmo');
      }
      return res;
    }

    if (action === 'capture_frame') {
      return await this.virtualizer.transact(pkg, 'android.hardware.camera2', 'capturePhoto', {});
    }

    throw new Error(`Unknown WhatsApp action: ${action}`);
  }

  /**
   * Master Capability Demonstration: Spotify Audio Playback.
   * Streams 48kHz 16-bit PCM audio chunks into PravahOS Audio HAL.
   */
  async executeSpotifyComponent(action = 'play', trackData = {}) {
    const pkg = 'com.spotify.music';
    if (!this.activeApps.has(pkg)) {
      await this.launchApp(pkg);
    }

    if (action === 'play') {
      // 1. Create AudioTrack via Binder
      const createRes = await this.virtualizer.transact(pkg, 'android.media.IAudioFlinger', 'createAudioTrack', {
        streamType: 'STREAM_MUSIC',
        trackTitle: trackData.title || 'Resonance - Synthwave OST'
      });

      if (createRes.code !== BinderReturn.BR_REPLY) return createRes;

      const trackId = createRes.result.trackId;

      // 2. Stream simulated PCM frames
      const writeRes = await this.virtualizer.transact(pkg, 'android.media.IAudioFlinger', 'writePcmData', {
        trackId,
        frames: 512
      });

      const active = this.activeApps.get(pkg);
      if (active) {
        active.activeCapabilities.push('hardware.audio.pcm');
      }

      return {
        createRes,
        writeRes,
        trackId,
        streamActive: true
      };
    }

    throw new Error(`Unknown Spotify action: ${action}`);
  }

  /**
   * Master Capability Demonstration: Google Maps GNSS Query.
   * Gated by Air-Gap switch and local GNSS sensor VMO.
   */
  async executeMapsComponent() {
    const pkg = 'com.google.android.apps.maps';
    if (!this.activeApps.has(pkg)) {
      await this.launchApp(pkg);
    }

    const res = await this.virtualizer.transact(pkg, 'android.location.ILocationManager', 'getLastKnownLocation');
    const active = this.activeApps.get(pkg);
    if (active && res.code === BinderReturn.BR_REPLY) {
      active.activeCapabilities.push('hardware.location.gnss');
    }
    return res;
  }

  /**
   * Master Capability Demonstration: Uber Ride Booking with Irreversible Financial Step.
   * Strictly intercepted by PravahOS Policy Gate.
   */
  async executeUberComponent(fareAmount = 350) {
    const pkg = 'com.ubercab';
    if (!this.activeApps.has(pkg)) {
      await this.launchApp(pkg);
    }

    // 1. Location lookup (Consequential)
    const locRes = await this.virtualizer.transact(pkg, 'android.location.ILocationManager', 'getLastKnownLocation');

    // 2. Payment invocation (Irreversible -> triggers Policy Gate approval requirement)
    const evalResult = this.policyGate.evaluate({
      caller: {
        componentUrl: `starnix://${pkg}`,
        delegatedAuthority: AuthorityLevel.PREPARE
      },
      capabilityDescriptor: {
        id: 'financial.payment.uber_fare',
        riskLevel: RiskLevel.IRREVERSIBLE,
        requiredAuthority: AuthorityLevel.EXECUTE
      },
      contextSource: 'android_container_request'
    });

    return {
      location: locRes,
      fareAmount,
      policyGateDecision: evalResult.decision,
      reason: evalResult.reason,
      requiresUserApproval: evalResult.decision === PolicyDecision.REQUIRE_USER_APPROVAL
    };
  }

  /**
   * Returns current container status snapshot for UI and telemetry.
   */
  getSnapshot() {
    return {
      containerState: this.containerState,
      totalInstalledApps: this.apps.size,
      activeAppsCount: this.activeApps.size,
      runningApps: Array.from(this.activeApps.values()),
      openDescriptors: this.translator.openFiles.size,
      vmoAllocations: this.translator.vmoAllocations.size,
      binderTransactionsCount: this.virtualizer.transactionHistory.length,
      recentTransactions: this.virtualizer.transactionHistory.slice(-10),
      recentSyscalls: this.translator.syscallLog.slice(-10)
    };
  }
}
