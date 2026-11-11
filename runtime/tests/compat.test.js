// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  LinuxSyscall,
  LinuxErrno,
  BinderCommand,
  BinderReturn,
  AshmemIoctl,
  AppLifecycleState,
  LinuxSyscallTranslator,
  BinderVirtualizer,
  AndroidCameraService,
  AndroidAudioFlingerService,
  AndroidLocationManagerService,
  AndroidStorageManagerService,
  AndroidContainerRuntime,
  DefaultAndroidApps,
  PolicyGate,
  RiskLevel,
  AuthorityLevel,
  PolicyDecision
} from '../src/index.js';

describe('PravahOS Android Compatibility & Starnix Container Subsystem', () => {

  describe('Linux ABI Syscall Translation Layer', () => {
    let translator;

    beforeEach(() => {
      translator = new LinuxSyscallTranslator();
    });

    it('sys_openat traps virtual character devices (/dev/binder, /dev/ashmem) and sandboxed storage', () => {
      const binderFd = translator.sys_openat(-100, '/dev/binder', 0x2, 0);
      assert.ok(binderFd >= 100, 'Binder FD allocated');

      const ashmemFd = translator.sys_openat(-100, '/dev/ashmem', 0x2, 0);
      assert.ok(ashmemFd > binderFd, 'Ashmem FD allocated');

      const storageFd = translator.sys_openat(-100, '/data/data/com.whatsapp/files/db.sqlite', 0x2, 0);
      assert.ok(storageFd > ashmemFd, 'Sandbox storage FD allocated');

      // Unauthorized host path access rejected
      const rootFd = translator.sys_openat(-100, '/etc/shadow', 0x2, 0);
      assert.equal(rootFd, -LinuxErrno.EACCES, 'Unauthorized host paths rejected with EACCES');
    });

    it('sys_ioctl virtualizes ashmem regions and allocates backing Zircon VMOs', () => {
      const ashmemFd = translator.sys_openat(-100, '/dev/ashmem', 0x2, 0);

      // 1. Set Name
      const setRet = translator.sys_ioctl(ashmemFd, AshmemIoctl.ASHMEM_SET_NAME, 'camera_preview_buffer');
      assert.equal(setRet, LinuxErrno.SUCCESS);

      // 2. Set Size (allocates Zircon VMO)
      const bufferBytes = 1920 * 1080 * 4;
      const sizeRet = translator.sys_ioctl(ashmemFd, AshmemIoctl.ASHMEM_SET_SIZE, bufferBytes);
      assert.equal(sizeRet, LinuxErrno.SUCCESS);

      // 3. Get Size
      const gotSize = translator.sys_ioctl(ashmemFd, AshmemIoctl.ASHMEM_GET_SIZE, 0);
      assert.equal(gotSize, bufferBytes);

      // 4. Verify VMO allocated in registry
      assert.equal(translator.vmoAllocations.size, 1);
    });

    it('sys_mmap maps virtual ashmem and binder buffers to userspace virtual addresses', () => {
      const ashmemFd = translator.sys_openat(-100, '/dev/ashmem', 0x2, 0);
      translator.sys_ioctl(ashmemFd, AshmemIoctl.ASHMEM_SET_SIZE, 4096);

      const mmapRes = translator.sys_mmap(0, 4096, 0x3, 0x1, ashmemFd, 0);
      assert.ok(mmapRes.virtualAddress.startsWith('0x70'));
      assert.ok(mmapRes.vmoHandle.startsWith('zx_vmo_'));
      assert.deepEqual(mmapRes.rights, ['ZX_RIGHT_READ', 'ZX_RIGHT_WRITE', 'ZX_RIGHT_MAP']);

      // Bad FD produces EBADF
      const badMap = translator.sys_mmap(0, 4096, 0x3, 0x1, 9999, 0);
      assert.equal(badMap, -LinuxErrno.EBADF);
    });

    it('sys_close releases file descriptors and deallocates active VMO handles', () => {
      const ashmemFd = translator.sys_openat(-100, '/dev/ashmem', 0x2, 0);
      translator.sys_ioctl(ashmemFd, AshmemIoctl.ASHMEM_SET_SIZE, 8192);
      assert.equal(translator.vmoAllocations.size, 1);

      const closeRes = translator.sys_close(ashmemFd);
      assert.equal(closeRes, LinuxErrno.SUCCESS);
      assert.equal(translator.openFiles.has(ashmemFd), false);
      assert.equal(translator.vmoAllocations.size, 0);
    });

    it('maintains bounded syscall audit log', () => {
      for (let i = 0; i < 250; i++) {
        translator.sys_openat(-100, '/dev/binder', 0x2, 0);
      }
      assert.ok(translator.syscallLog.length <= 200, 'Syscall log bounded to 200 entries');
    });
  });

  describe('Binder IPC Virtualization & Parcel Dispatch', () => {
    let policyGate;
    let virtualizer;

    beforeEach(() => {
      policyGate = new PolicyGate();
      virtualizer = new BinderVirtualizer(policyGate);
    });

    it('registers and resolves system services via simulated ServiceManager', () => {
      const mockService = { onTransact: async () => ({ status: 'OK' }) };
      const handleId = virtualizer.registerService('android.test.service', mockService);
      assert.ok(handleId >= 1);

      const srv = virtualizer.getService('android.test.service');
      assert.ok(srv);
      assert.equal(srv.name, 'android.test.service');
      assert.ok(srv.channelId.startsWith('zx_chan_srv_'));
    });

    it('encodes typed Android Parcel structures with Zircon channel/VMO handles', () => {
      const parcel = virtualizer.encodeParcel('android.media.IAudioFlinger', 'createTrack', { rate: 48000 }, [
        { handle: 'zx_vmo_audio_buf_1' }
      ]);
      assert.equal(parcel.header.interfaceToken, 'android.media.IAudioFlinger');
      assert.equal(parcel.data.rate, 48000);
      assert.equal(parcel.handles[0].handle, 'zx_vmo_audio_buf_1');
    });

    it('dispatches transactions and returns BR_REPLY or BR_DEAD_REPLY for unknown service', async () => {
      virtualizer.registerService('android.echo', {
        onTransact: async (caller, action, data) => ({ echoed: data.msg })
      });

      // Valid transaction
      const success = await virtualizer.transact('com.whatsapp', 'android.echo', 'echo', { msg: 'Hello PravahOS' });
      assert.equal(success.code, BinderReturn.BR_REPLY);
      assert.equal(success.result.echoed, 'Hello PravahOS');

      // Unknown service returns BR_DEAD_REPLY
      const failed = await virtualizer.transact('com.whatsapp', 'android.unknown', 'call', {});
      assert.equal(failed.code, BinderReturn.BR_DEAD_REPLY);
    });
  });

  describe('Waydroid / microG Lightweight System Services', () => {
    let policyGate;

    beforeEach(() => {
      policyGate = new PolicyGate();
    });

    it('AndroidCameraService mediates camera VMO handle through Policy Gate', async () => {
      const camService = new AndroidCameraService(policyGate);

      // Open camera delegates 1080p frame buffer VMO handle
      const openRes = await camService.onTransact('com.whatsapp', 'openCamera', { cameraId: 0 });
      assert.equal(openRes.status, 'SUCCESS');
      assert.ok(openRes.cameraVmoHandle.startsWith('zx_vmo_cam_frame_com.whatsapp'));
      assert.equal(openRes.resolution.width, 1920);
      assert.equal(openRes.resolution.height, 1080);
      assert.equal(openRes.policyGateDecision, PolicyDecision.ALLOW);

      // Capture photo
      const snapRes = await camService.onTransact('com.whatsapp', 'capturePhoto', {});
      assert.equal(snapRes.status, 'CAPTURED');
      assert.equal(snapRes.bytes, 1920 * 1080 * 4);
      assert.equal(snapRes.metadata.sensor, 'Sony IMX890 50MP');

      // Close camera
      const closeRes = await camService.onTransact('com.whatsapp', 'closeCamera', {});
      assert.equal(closeRes.status, 'CLOSED');
    });

    it('AndroidCameraService rejects untrusted context sources trying to capture camera', async () => {
      const strictPolicyGate = new PolicyGate();
      // Simulate caller with OBSERVE authority only
      const camService = new AndroidCameraService(strictPolicyGate);

      // Overwrite evaluate to simulate denied authority
      strictPolicyGate.evaluate = () => ({
        decision: PolicyDecision.DENY,
        reason: 'INSUFFICIENT_DELEGATED_AUTHORITY'
      });

      await assert.rejects(
        async () => await camService.onTransact('com.whatsapp', 'openCamera', {}),
        /PolicyGate denied Camera access/
      );
    });

    it('AndroidAudioFlingerService streams 48kHz PCM buffers to PravahOS Audio HAL', async () => {
      const audioService = new AndroidAudioFlingerService();

      const trackRes = await audioService.onTransact('com.spotify.music', 'createAudioTrack', {
        streamType: 'STREAM_MUSIC'
      });
      assert.equal(trackRes.status, 'TRACK_CREATED');
      assert.ok(trackRes.ringBufferVmo.startsWith('zx_vmo_audio_ring_track_com.spotify.music'));
      assert.equal(trackRes.bufferSizeFrames, 4096);

      // Write PCM data chunks
      const writeRes = await audioService.onTransact('com.spotify.music', 'writePcmData', {
        trackId: trackRes.trackId,
        frames: 512
      });
      assert.equal(writeRes.status, 'SUCCESS');
      assert.equal(writeRes.framesWritten, 512);
      assert.ok(typeof writeRes.rmsDbfs === 'number');

      // Pause track
      const pauseRes = await audioService.onTransact('com.spotify.music', 'pauseTrack', {
        trackId: trackRes.trackId
      });
      assert.equal(pauseRes.status, 'PAUSED');
    });

    it('AndroidLocationManagerService enforces Air-Gap protection', async () => {
      const locService = new AndroidLocationManagerService(policyGate, true);

      // When air-gapped, location is served from local GNSS sensor only
      const locAirGapped = await locService.onTransact('com.google.android.apps.maps', 'getLastKnownLocation', {});
      assert.equal(locAirGapped.status, 'LOCATION_ACQUIRED');
      assert.equal(locAirGapped.provider, 'LOCAL_GNSS_ONLY');
      assert.equal(locAirGapped.airGapEnforced, true);

      // When air-gap disabled, fused location is active
      locService.setAirGap(false);
      const locOnline = await locService.onTransact('com.google.android.apps.maps', 'getLastKnownLocation', {});
      assert.equal(locOnline.provider, 'FUSED_GNSS_WIFI');
      assert.equal(locOnline.airGapEnforced, false);
    });

    it('AndroidStorageManagerService enforces per-package sandbox isolation', async () => {
      const storageService = new AndroidStorageManagerService();

      const paths = await storageService.onTransact('com.whatsapp', 'getSandboxPath', {});
      assert.equal(paths.paths.dataDir, '/data/data/com.whatsapp');
      assert.equal(paths.isolationEnforced, true);

      // Writing to own directory is allowed
      const writeOwn = await storageService.onTransact('com.whatsapp', 'writeFile', {
        path: '/data/data/com.whatsapp/files/key.bin',
        data: 'secret123'
      });
      assert.equal(writeOwn.status, 'WRITTEN');

      // Writing into another application sandbox directory is strictly rejected
      await assert.rejects(
        async () => await storageService.onTransact('com.whatsapp', 'writeFile', {
          path: '/data/data/com.spotify.music/cache/track.mp3',
          data: 'exploit'
        }),
        /Storage Sandbox Violation/
      );
    });
  });

  describe('Android Application Container Runtime & Lifecycle', () => {
    let runtime;

    beforeEach(() => {
      runtime = new AndroidContainerRuntime();
    });

    it('installs default showcase applications (WhatsApp, Spotify, Maps, Uber)', () => {
      const apps = runtime.listInstalledApps();
      assert.equal(apps.length, 4);

      const wa = runtime.getApp('com.whatsapp');
      assert.ok(wa);
      assert.equal(wa.appName, 'WhatsApp');
      assert.deepEqual(wa.permissions, [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_CONTACTS'
      ]);
    });

    it('launches, pauses, resumes, and terminates applications cleanly', async () => {
      const activeApp = await runtime.launchApp('com.spotify.music');
      assert.equal(activeApp.packageName, 'com.spotify.music');
      assert.equal(activeApp.state, AppLifecycleState.RUNNING);
      assert.ok(activeApp.pid >= 1000);
      assert.ok(activeApp.windowHandle.startsWith('zx_window_android_com.spotify.music'));
      assert.ok(activeApp.binderFd >= 100);

      // Pause
      const paused = runtime.pauseApp('com.spotify.music');
      assert.equal(paused, true);
      assert.equal(runtime.activeApps.get('com.spotify.music').state, AppLifecycleState.PAUSED);

      // Resume
      const resumed = runtime.resumeApp('com.spotify.music');
      assert.equal(resumed, true);
      assert.equal(runtime.activeApps.get('com.spotify.music').state, AppLifecycleState.RUNNING);

      // Terminate
      const terminated = runtime.terminateApp('com.spotify.music');
      assert.equal(terminated, true);
      assert.equal(runtime.activeApps.has('com.spotify.music'), false);
    });

    it('provides comprehensive runtime snapshot telemetry', async () => {
      await runtime.launchApp('com.whatsapp');
      const snap = runtime.getSnapshot();
      assert.equal(snap.containerState, 'RUNNING');
      assert.equal(snap.activeAppsCount, 1);
      assert.ok(snap.openDescriptors >= 2);
      assert.ok(snap.binderTransactionsCount >= 1);
    });
  });

  describe('Capability Delegation & Deterministic Policy Gate Master Scenarios', () => {
    let runtime;

    beforeEach(() => {
      runtime = new AndroidContainerRuntime();
    });

    it('Master Scenario: WhatsApp Video Call camera delegation via Policy Gate', async () => {
      const camRes = await runtime.executeWhatsAppComponent('open_camera');
      assert.equal(camRes.code, BinderReturn.BR_REPLY);
      assert.equal(camRes.result.status, 'SUCCESS');
      assert.ok(camRes.result.cameraVmoHandle.startsWith('zx_vmo_cam_frame_com.whatsapp'));
      assert.equal(camRes.result.policyGateDecision, PolicyDecision.ALLOW);

      // Verify active capabilities updated on the running app
      const active = runtime.activeApps.get('com.whatsapp');
      assert.ok(active.activeCapabilities.includes('hardware.camera.vmo'));

      // Snap photo frame
      const snapRes = await runtime.executeWhatsAppComponent('capture_frame');
      assert.equal(snapRes.result.status, 'CAPTURED');
      assert.equal(snapRes.result.bytes, 1920 * 1080 * 4);
    });

    it('Master Scenario: Spotify audio playback streams 48kHz PCM into Audio HAL', async () => {
      const spotifyRes = await runtime.executeSpotifyComponent('play', {
        title: 'Midnight City (Pravah Remix)'
      });

      assert.equal(spotifyRes.streamActive, true);
      assert.equal(spotifyRes.createRes.result.status, 'TRACK_CREATED');
      assert.equal(spotifyRes.writeRes.result.status, 'SUCCESS');
      assert.equal(spotifyRes.writeRes.result.framesWritten, 512);

      const active = runtime.activeApps.get('com.spotify.music');
      assert.ok(active.activeCapabilities.includes('hardware.audio.pcm'));
    });

    it('Master Scenario: Google Maps acquires local GNSS coordinates under Air-Gap isolation', async () => {
      const mapsRes = await runtime.executeMapsComponent();
      assert.equal(mapsRes.code, BinderReturn.BR_REPLY);
      assert.equal(mapsRes.result.status, 'LOCATION_ACQUIRED');
      assert.equal(mapsRes.result.latitude, 28.6139);
      assert.equal(mapsRes.result.longitude, 77.2090);
      assert.equal(mapsRes.result.airGapEnforced, true);

      const active = runtime.activeApps.get('com.google.android.apps.maps');
      assert.ok(active.activeCapabilities.includes('hardware.location.gnss'));
    });

    it('Master Scenario: Uber ride booking triggers mandatory Policy Gate user approval', async () => {
      const uberRes = await runtime.executeUberComponent(420);
      assert.equal(uberRes.fareAmount, 420);
      assert.equal(uberRes.requiresUserApproval, true);
      assert.equal(uberRes.policyGateDecision, PolicyDecision.REQUIRE_USER_APPROVAL);
      assert.equal(uberRes.reason, 'IRREVERSIBLE_ACTION_MANDATES_USER_CONFIRMATION');
    });

    it('Security Invariant: Prompt injection / untrusted external source context blocks state-mutating actions', async () => {
      // Simulate untrusted context source (e.g. email body trying to invoke camera)
      const audit = runtime.policyGate.evaluate({
        caller: { componentUrl: 'starnix://com.whatsapp' },
        capabilityDescriptor: {
          id: 'hardware.camera.vmo',
          riskLevel: RiskLevel.CONSEQUENTIAL,
          requiredAuthority: AuthorityLevel.EXECUTE
        },
        contextSource: 'email_body' // Untrusted source
      });

      assert.equal(audit.decision, PolicyDecision.DENY);
      assert.equal(audit.reason, 'UNTRUSTED_EXTERNAL_SOURCE_MUTATION_BLOCKED');
    });
  });

});
