// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * PravahOS Interactive Web Shell
 * Connects the Dynamic Experience Composer to an interactive runtime environment.
 */

// Risk levels
const RiskLevel = {
  READ_ONLY: 0,
  REVERSIBLE: 1,
  CONSEQUENTIAL: 2,
  IRREVERSIBLE: 3
};

const RiskLabels = ['READ_ONLY', 'REVERSIBLE', 'CONSEQUENTIAL', 'IRREVERSIBLE'];

// SHA-256 helper for tamper-evident ledger
async function sha256Hex(message) {
  const msgUint8 = new TextEncoder().encode(typeof message === 'string' ? message : JSON.stringify(message));
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Shell State
const ShellState = {
  offline: true,
  authority: 'EXECUTE',
  telemetry: {
    npu: 42,
    gpu: 28,
    cpu: 19,
    temp: 41,
    memUsed: 468,
    memTotal: 2048
  },
  currentTask: null,
  pendingApproval: null,
  auditLog: [],
  isListeningVoice: false
};

// Initial Seed Audit Records
async function initAuditLedger() {
  const genesisData = {
    seq: 0,
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    caller: 'system/kernel_boot',
    capabilityId: 'zircon.security.init',
    riskLevel: 0,
    decision: 'ALLOW',
    auditToken: '0x00010001',
    prevHash: '0000000000000000000000000000000000000000000000000000000000000000'
  };
  genesisData.hash = await sha256Hex(genesisData);
  ShellState.auditLog.push(genesisData);

  const uiaInit = {
    seq: 1,
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    caller: '/core/uia',
    capabilityId: 'inference.weights.verify',
    riskLevel: 0,
    decision: 'ALLOW',
    auditToken: '0x00010002',
    prevHash: genesisData.hash
  };
  uiaInit.hash = await sha256Hex(uiaInit);
  ShellState.auditLog.push(uiaInit);
}

// Predefined Scenario Definitions
const Scenarios = {
  flight: {
    intent: 'Check flight AI-202 and set reminder 2 hours before departure',
    goal: 'Flight AI-202 Status & Departure Calendar Notification',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'travel.flight_info',
        riskLevel: RiskLevel.READ_ONLY,
        dependencies: [],
        inputs: { flight: 'AI-202' },
        execute: async () => ({
          flightNumber: 'AI-202',
          status: 'ON TIME',
          departure: 'DEL (Indira Gandhi Int.)',
          arrival: 'BLR (Kempegowda Int.)',
          departureTime: '10:30 AM',
          terminal: 'T3',
          gate: '14B'
        })
      },
      {
        id: 'node_2',
        capabilityId: 'calendar.reminder',
        riskLevel: RiskLevel.REVERSIBLE,
        dependencies: ['node_1'],
        inputs: { event: 'Boarding AI-202', time: '08:30 AM' },
        execute: async (prevOutput) => ({
          reminderId: 'REM-8821',
          event: `Boarding ${prevOutput?.flightNumber || 'AI-202'} (Gate ${prevOutput?.gate || '14B'})`,
          scheduledTime: '08:30 AM',
          status: 'SET_ACTIVE'
        })
      }
    ]
  },

  payment: {
    intent: 'Send ₹5,000 to Alice from verified account for dinner',
    goal: 'Settlement & Irreversible UPI Remittance of ₹5,000 to Alice',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'banking.account_verify',
        riskLevel: RiskLevel.READ_ONLY,
        dependencies: [],
        inputs: { recipient: 'Alice', expectedBalance: 12500 },
        execute: async () => ({
          verifiedRecipient: 'Alice (alice@okhdfcbank)',
          kycStatus: 'VERIFIED',
          availableBalance: '₹18,450.00'
        })
      },
      {
        id: 'node_2',
        capabilityId: 'financial.transfer',
        riskLevel: RiskLevel.IRREVERSIBLE,
        dependencies: ['node_1'],
        requiresGate: true,
        gateReason: 'FINANCIAL_LIMIT_EXCEEDED (Threshold ₹2,000)',
        inputs: { amount: 5000, currency: 'INR', to: 'Alice' },
        execute: async () => ({
          transactionId: `TX-${Math.floor(100000 + Math.random() * 900000)}`,
          amount: '₹5,000.00',
          currency: 'INR',
          recipient: 'Alice',
          status: 'SETTLED_IRREVERSIBLE',
          timestamp: new Date().toLocaleTimeString()
        })
      }
    ]
  },

  memory: {
    intent: 'Compact secure memory and flush temporary neural cache',
    goal: 'Autonomous On-Device System Optimization & Secure Cache Flush',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'memory.compact',
        riskLevel: RiskLevel.REVERSIBLE,
        dependencies: [],
        inputs: { scope: 'ephemeral' },
        execute: async () => ({
          freedMb: 124,
          status: 'COMPACTED',
          remainingMb: 344
        })
      },
      {
        id: 'node_2',
        capabilityId: 'cache.flush',
        riskLevel: RiskLevel.REVERSIBLE,
        dependencies: ['node_1'],
        inputs: { tier: 'tensor_weights_transient' },
        execute: async () => ({
          flushedEntries: 18,
          bytesReclaimed: '64 MB',
          status: 'CLEARED'
        })
      }
    ]
  },

  ocr: {
    intent: 'Extract receipt text and file expense record with privacy redaction',
    goal: 'Neural Document OCR & Local Privacy-Preserving Expense Logging',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'vision.ocr_extract',
        riskLevel: RiskLevel.READ_ONLY,
        dependencies: [],
        inputs: { document: 'taxi_receipt.jpg' },
        execute: async () => ({
          vendor: 'Airport Metro Cab',
          amount: '₹420.00',
          taxId: 'DL-9912384',
          passengerPhone: '+91-9876543210'
        })
      },
      {
        id: 'node_2',
        capabilityId: 'privacy.pii_redact',
        riskLevel: RiskLevel.REVERSIBLE,
        dependencies: ['node_1'],
        inputs: { policy: 'GDPR_CONFIDENTIAL' },
        execute: async (prev) => ({
          cleanVendor: prev.vendor,
          cleanAmount: prev.amount,
          redactedPhone: '[REDACTED: SENSITIVE_PII]',
          complianceStatus: 'VERIFIED_COMPLIANT'
        })
      },
      {
        id: 'node_3',
        capabilityId: 'expense.log_entry',
        riskLevel: RiskLevel.CONSEQUENTIAL,
        dependencies: ['node_2'],
        inputs: { category: 'Local Commute' },
        execute: async (prev) => ({
          entryId: 'EXP-4029',
          vendor: prev.cleanVendor,
          amount: prev.cleanAmount,
          status: 'RECORDED_LOCALLY'
        })
      }
    ]
  },

  camera_note: {
    intent: 'Take a photo of this document and save a private note',
    goal: 'Master Scenario 6: Camera Document Capture & Smart Private Note Storage',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'media.camera.capture',
        riskLevel: RiskLevel.CONSEQUENTIAL,
        dependencies: [],
        inputs: { sensorId: 'BACK_PRIMARY', captureMode: 'DOCUMENT', format: 'RGB888' },
        execute: async () => ({
          frameId: 1042,
          sensorName: 'Sony IMX989 1-inch (Primary 50MP)',
          format: 'RGB888',
          resolution: '3840x2160 (4K UHD)',
          stride: 11520,
          sizeBytes: 24883200,
          exposureTime: '1/120s @ ISO 100',
          vmoHandle: '0xVMO_412A',
          checksum: '8fa3b7c91e4d026f',
          status: 'CAPTURED_FROM_CAMERA_HAL'
        })
      },
      {
        id: 'node_2',
        capabilityId: 'notes.smart.create',
        riskLevel: RiskLevel.REVERSIBLE,
        dependencies: ['node_1'],
        inputs: {
          title: 'Document Note',
          body: 'Quarterly financial statements and confidential disclosures.',
          sensitivity: 'CONFIDENTIAL',
          tags: ['#document', '#confidential', '#finance']
        },
        execute: async (prevOutput) => ({
          noteId: 'NOTE-DOC-9821',
          title: 'Document Note',
          sensitivity: 'CONFIDENTIAL',
          privacyLevel: 3,
          tags: ['#document', '#confidential', '#finance', '#photo'],
          attachedMedia: {
            frameId: prevOutput?.frameId || 1042,
            resolution: prevOutput?.resolution || '3840x2160',
            vmoHandle: prevOutput?.vmoHandle || '0xVMO_412A'
          },
          episodicMemoryId: `ep_note_${Date.now()}`,
          privacyStatus: 'ENCRYPTED_AT_REST',
          status: 'SAVED_TO_EPISODIC_MEMORY'
        })
      }
    ]
  },

  crypto: {
    intent: 'Transfer 250 USDC to Bob on-chain with biometric confirmation',
    goal: 'Irreversible On-Chain Crypto Remittance to Bob',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'crypto.wallet.transact',
        riskLevel: RiskLevel.IRREVERSIBLE,
        dependencies: [],
        requiresGate: true,
        gateReason: 'IRREVERSIBLE_ACTION_MANDATES_USER_CONFIRMATION',
        inputs: { amount: 250, asset: 'USDC', recipient: 'Bob', network: 'PRAVAH_L1' },
        execute: async () => ({
          status: 'CONFIRMED',
          transactionId: `tx_${Date.now()}`,
          txHash: '0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
          amount: 250,
          asset: 'USDC',
          recipient: 'Bob',
          network: 'PRAVAH_L1',
          blockHeight: 2840001,
          auditHash: 'c4ca4238a0b923820dcc509a6f75849b',
          biometricVerified: true,
          settlement: 'IRREVERSIBLE_ON_CHAIN'
        })
      }
    ]
  },

  android_whatsapp: {
    intent: 'Launch WhatsApp video call and stream camera frames via Policy Gate',
    goal: 'Starnix Android Container: WhatsApp Video Call with Mediated Camera VMO',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'starnix.binder.init',
        riskLevel: RiskLevel.READ_ONLY,
        dependencies: [],
        inputs: { package: 'com.whatsapp', version: '2.24.12' },
        execute: async () => ({
          container: 'STARNIX_CFv2',
          binderFd: 104,
          ashmemFd: 105,
          process: 'com.whatsapp (PID 1042)',
          isolation: 'MINFS_SANDBOX_ACTIVE'
        })
      },
      {
        id: 'node_2',
        capabilityId: 'starnix.camera.vmo_delegate',
        riskLevel: RiskLevel.CONSEQUENTIAL,
        dependencies: ['node_1'],
        inputs: { sensor: 'IMX890 50MP', resolution: '1080p60', format: 'ARGB8888' },
        execute: async () => ({
          vmoHandle: 'zx_vmo_cam_frame_com.whatsapp_1080p',
          policyStatus: 'CLEARED_BY_POLICY_GATE',
          frameRate: 60,
          zeroCopyBuffer: 'ATTACHED_TO_WAYDROID_SURFACE',
          callActive: true
        })
      }
    ]
  },

  android_spotify: {
    intent: 'Stream lossless audio from Spotify into PravahOS 48kHz Audio HAL',
    goal: 'Starnix Android Container: Spotify Audio Playback to HAL PCM Ring Buffer',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'starnix.binder.init',
        riskLevel: RiskLevel.READ_ONLY,
        dependencies: [],
        inputs: { package: 'com.spotify.music', service: 'IAudioFlinger' },
        execute: async () => ({
          container: 'STARNIX_CFv2',
          binderFd: 108,
          track: 'Resonance - Synthwave OST',
          streamType: 'STREAM_MUSIC'
        })
      },
      {
        id: 'node_2',
        capabilityId: 'starnix.audio.pcm_stream',
        riskLevel: RiskLevel.REVERSIBLE,
        dependencies: ['node_1'],
        inputs: { sampleRate: 48000, channels: 2, bitDepth: 16 },
        execute: async () => ({
          halRingBuffer: 'zx_vmo_audio_ring_track_spotify',
          rmsDbfs: -16.4,
          framesPushed: 8192,
          oscilloscopeState: 'STREAMING'
        })
      }
    ]
  },

  android_maps: {
    intent: 'Query GNSS sensor in Google Maps under offline Air-Gap sandbox',
    goal: 'Starnix Android Container: Google Maps Offline Navigation & GNSS Telemetry',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'starnix.location.gnss',
        riskLevel: RiskLevel.READ_ONLY,
        dependencies: [],
        inputs: { provider: 'LOCAL_GNSS_SENSOR_ONLY', airGapProtected: true },
        execute: async () => ({
          latitude: 28.6139,
          longitude: 77.2090,
          altitudeMeters: 216,
          accuracyMeters: 4.2,
          airGapEnforced: true,
          cloudSyncSevered: true
        })
      },
      {
        id: 'node_2',
        capabilityId: 'starnix.storage.sandbox',
        riskLevel: RiskLevel.REVERSIBLE,
        dependencies: ['node_1'],
        inputs: { path: '/data/data/com.google.android.apps.maps/files/vector_tiles.bin' },
        execute: async () => ({
          vectorTilesLoaded: 142,
          offlineRender: 'SUCCESS',
          cacheMounted: 'MINFS_CAPABILITY_ISOLATED'
        })
      }
    ]
  },

  android_uber: {
    intent: 'Book Uber ride with ₹420 fare requiring Policy Gate user approval',
    goal: 'Starnix Android Container: Uber Ride Booking with Deterministic Policy Gate Gatekeeper',
    nodes: [
      {
        id: 'node_1',
        capabilityId: 'starnix.location.gnss',
        riskLevel: RiskLevel.READ_ONLY,
        dependencies: [],
        inputs: { pickup: 'Connaught Place', dropoff: 'IGI Airport T3' },
        execute: async () => ({
          distanceKm: 14.8,
          estimatedDurationMin: 32,
          vehicleClass: 'Uber Premier'
        })
      },
      {
        id: 'node_2',
        capabilityId: 'financial.payment.uber_fare',
        riskLevel: RiskLevel.IRREVERSIBLE,
        dependencies: ['node_1'],
        inputs: { fare: '₹420.00', merchant: 'Uber India Technology Pvt Ltd', method: 'Pravah FastUPI' },
        execute: async () => ({
          transactionId: 'TX-UBER-88491',
          fareDeducted: '₹420.00',
          driverAssigned: 'Rajiv (Swift Dzire - DL 01 AB 9821)',
          etaMinutes: 3,
          biometricToken: '0x9f1a4e8c'
        })
      }
    ]
  }
};

// UI Rendering Functions
function renderAmbientHeader() {
  const offlineBadge = document.getElementById('offline-badge');
  const authVal = document.getElementById('authority-val');
  const npuVal = document.getElementById('npu-val');
  const cpuVal = document.getElementById('cpu-val');
  const memVal = document.getElementById('mem-val');

  if (offlineBadge) {
    offlineBadge.className = `telemetry-badge ${ShellState.offline ? 'badge-offline' : ''}`;
    offlineBadge.innerHTML = `
      <div class="${ShellState.offline ? 'badge-pulse-dot' : ''}"></div>
      <span class="label">AIR-GAP:</span>
      <span class="val">${ShellState.offline ? 'SECURED OFFLINE' : 'ONLINE CONNECTED'}</span>
    `;
  }

  if (authVal) authVal.textContent = ShellState.authority;
  if (npuVal) npuVal.textContent = `${ShellState.telemetry.npu}%`;
  if (cpuVal) cpuVal.textContent = `${ShellState.telemetry.cpu}% • ${ShellState.telemetry.temp}°C`;
  if (memVal) memVal.textContent = `${ShellState.telemetry.memUsed} MB / ${ShellState.telemetry.memTotal} MB`;

  // Synchronize telemetry with parent phone emulator if embedded
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({
        type: 'PRAVAH_SHELL_TELEMETRY',
        state: {
          offline: ShellState.offline,
          authority: ShellState.authority,
          telemetry: { ...ShellState.telemetry },
          currentTask: ShellState.currentTask ? ShellState.currentTask.goal : null
        }
      }, '*');
    } catch (_) {}
  }
}

function renderWorkspace() {
  const titleEl = document.getElementById('task-title');
  const subEl = document.getElementById('task-sub');
  const progressFill = document.getElementById('progress-fill');
  const canvas = document.getElementById('dag-canvas');

  if (!ShellState.currentTask) {
    if (titleEl) titleEl.textContent = 'No Active Task';
    if (subEl) subEl.textContent = 'Submit an intent or select a scenario below to initialize DAG execution.';
    if (progressFill) progressFill.style.width = '0%';
    if (canvas) canvas.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem;">Workspace ready. Awaiting intent...</div>';
    return;
  }

  const task = ShellState.currentTask;
  titleEl.textContent = task.goal;
  subEl.textContent = `Task ID: ${task.id} • State: ${task.state}`;

  const total = task.nodes.length;
  const completed = task.nodes.filter(n => n.status === 'COMPLETED').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;

  // Render DAG nodes & connector arrows
  let html = '';
  task.nodes.forEach((node, idx) => {
    const riskLabel = RiskLabels[node.riskLevel] || 'RISK';
    const statusClass = `status-${node.status}`;
    const pillClass = `pill-${node.status.toLowerCase().replace(/_/g, '-')}`;

    html += `
      <div class="dag-stage">
        <span class="stage-label">Step ${idx + 1}</span>
        <div class="dag-node-card ${statusClass}">
          <div class="node-header">
            <span class="node-cap-id">${node.capabilityId}</span>
            <span class="node-status-pill ${pillClass}">${node.status.replace(/_/g, ' ')}</span>
          </div>
          <div class="node-meta-row">
            <span>Risk Profile</span>
            <span class="risk-tag risk-${node.riskLevel}">${riskLabel}</span>
          </div>
    `;

    if (node.output) {
      html += `
        <div class="node-output-box">
          <pre>${JSON.stringify(node.output, null, 2)}</pre>
        </div>
      `;
    }

    if (node.error) {
      html += `
        <div style="color: var(--accent-danger); font-size: 0.72rem; font-weight: 600;">
          ${node.error}
        </div>
      `;
    }

    html += `</div></div>`;

    if (idx < task.nodes.length - 1) {
      html += `<div class="connector-arrow">➔</div>`;
    }
  });

  canvas.innerHTML = html;
  attachCardSpringPhysics(canvas);
}

async function renderAuditInspector() {
  const stream = document.getElementById('audit-stream');
  const badge = document.getElementById('audit-integrity-badge');

  // Verify chain
  let intact = true;
  let expectedPrev = '0000000000000000000000000000000000000000000000000000000000000000';
  for (let i = 0; i < ShellState.auditLog.length; i++) {
    const r = ShellState.auditLog[i];
    if (r.prevHash !== expectedPrev) {
      intact = false;
      break;
    }
    expectedPrev = r.hash;
  }

  badge.className = `audit-integrity-badge ${intact ? 'integrity-valid' : 'integrity-tampered'}`;
  badge.textContent = intact
    ? `✔ CHAIN INTACT (${ShellState.auditLog.length} BLOCKS)`
    : `✖ TAMPER DETECTED`;

  let html = '';
  // Show in reverse order (newest on top)
  for (let i = ShellState.auditLog.length - 1; i >= 0; i--) {
    const entry = ShellState.auditLog[i];
    const decClass = entry.decision === 'ALLOW' ? 'decision-allow' : (entry.decision === 'DENY' ? 'decision-deny' : 'decision-require');
    html += `
      <div class="audit-entry">
        <div class="audit-top">
          <span class="audit-seq">Block #${entry.seq}</span>
          <span class="audit-decision ${decClass}">${entry.decision}</span>
        </div>
        <div><strong>${entry.capabilityId}</strong> <span style="color: var(--text-muted); font-size: 0.65rem;">(${entry.caller})</span></div>
        <div class="audit-hash">SHA-256: ${entry.hash ? entry.hash.substring(0, 24) + '...' : 'INVALID'}</div>
      </div>
    `;
  }
  stream.innerHTML = html;
}

// Record an audit log entry
async function recordAudit({ caller, capabilityId, riskLevel, decision, reason = 'OK' }) {
  const prevRecord = ShellState.auditLog[ShellState.auditLog.length - 1];
  const prevHash = prevRecord ? prevRecord.hash : '0000000000000000000000000000000000000000000000000000000000000000';
  const token = `0x${Math.floor(Date.now() / 1000).toString(16).toUpperCase()}`;

  const entry = {
    seq: ShellState.auditLog.length,
    timestamp: new Date().toISOString(),
    caller,
    capabilityId,
    riskLevel,
    decision,
    reason,
    auditToken: token,
    prevHash
  };

  entry.hash = await sha256Hex(entry);
  ShellState.auditLog.push(entry);
  await renderAuditInspector();
  return entry;
}

// Task Execution Engine
async function executeTask(scenarioKey) {
  const scenario = Scenarios[scenarioKey];
  if (!scenario) return;

  if (scenarioKey === 'flight') {
    window.shellIsland?.setFlight({
      flightNumber: 'AI-202',
      departure: 'DEL',
      arrival: 'BLR',
      countdown: 'T-45m',
      status: 'ON TIME',
      gate: 'Gate 14B'
    });
  } else if (scenarioKey === 'crypto') {
    window.shellIsland?.startAuthScan({
      label: 'Biometric Passkey for 250 USDC'
    });
  } else if (scenarioKey === 'android_spotify') {
    window.shellIsland?.setMusic({
      title: 'Top Hits - Pravah Audio',
      artist: 'Spotify Android Starnix'
    });
  }

  const taskId = `task_${Date.now().toString(36)}`;
  ShellState.currentTask = {
    id: taskId,
    goal: scenario.goal,
    state: 'EXECUTING',
    nodes: scenario.nodes.map(n => ({
      ...n,
      status: 'PENDING',
      output: null,
      error: null
    }))
  };

  renderWorkspace();

  let previousOutput = null;

  for (let i = 0; i < ShellState.currentTask.nodes.length; i++) {
    const node = ShellState.currentTask.nodes[i];
    node.status = 'RUNNING';
    renderWorkspace();
    await delay(600);

    // Check if deterministic policy gate requires approval
    if (node.requiresGate || node.riskLevel >= RiskLevel.CONSEQUENTIAL) {
      if (node.requiresGate || node.riskLevel === RiskLevel.IRREVERSIBLE) {
        node.status = 'WAITING_FOR_APPROVAL';
        ShellState.currentTask.state = 'WAITING_FOR_APPROVAL';
        renderWorkspace();

        await recordAudit({
          caller: `/core/uia/${taskId}`,
          capabilityId: node.capabilityId,
          riskLevel: node.riskLevel,
          decision: 'REQUIRE_USER_APPROVAL',
          reason: node.gateReason || 'IRREVERSIBLE_MUTATION'
        });

        // Trigger Policy Gate Modal
        const approved = await showApprovalModal({
          taskId,
          nodeId: node.id,
          capabilityId: node.capabilityId,
          riskLevel: node.riskLevel,
          reason: node.gateReason || 'IRREVERSIBLE_MUTATION',
          inputs: node.inputs
        });

        if (!approved) {
          node.status = 'REJECTED_BY_USER';
          node.error = 'Action rejected by user at Policy Gate.';
          ShellState.currentTask.state = 'CANCELLED';
          renderWorkspace();

          await recordAudit({
            caller: 'UserSession/DEC',
            capabilityId: node.capabilityId,
            riskLevel: node.riskLevel,
            decision: 'DENY',
            reason: 'USER_REJECTION'
          });
          return;
        }

        // User approved!
        await recordAudit({
          caller: 'UserSession/DEC',
          capabilityId: node.capabilityId,
          riskLevel: node.riskLevel,
          decision: 'ALLOW',
          reason: 'USER_AUTHORIZED'
        });

        node.status = 'RUNNING';
        ShellState.currentTask.state = 'EXECUTING';
        renderWorkspace();
        await delay(500);
      }
    }

    // Execute capability
    try {
      const result = await node.execute(previousOutput);
      node.output = result;
      node.status = 'COMPLETED';
      previousOutput = result;

      await recordAudit({
        caller: `/core/uia/${taskId}`,
        capabilityId: node.capabilityId,
        riskLevel: node.riskLevel,
        decision: 'ALLOW'
      });
    } catch (err) {
      node.status = 'FAILED';
      node.error = err.message;
      ShellState.currentTask.state = 'FAILED';
      renderWorkspace();
      return;
    }

    renderWorkspace();
  }

  ShellState.currentTask.state = 'COMPLETED';
  renderWorkspace();
}

// Modal Promise Handler
let modalResolver = null;

function showApprovalModal({ taskId, nodeId, capabilityId, riskLevel, reason, inputs }) {
  const backdrop = document.getElementById('approval-modal-backdrop');
  const actionTitle = document.getElementById('modal-action-title');
  const capVal = document.getElementById('diff-cap');
  const riskVal = document.getElementById('diff-risk');
  const reasonVal = document.getElementById('diff-reason');
  const paramsVal = document.getElementById('diff-params');

  actionTitle.textContent = `Authorization Required: ${capabilityId}`;
  capVal.textContent = capabilityId;
  riskVal.textContent = `${RiskLabels[riskLevel]} (Level ${riskLevel})`;
  reasonVal.textContent = reason;
  paramsVal.textContent = JSON.stringify(inputs);

  if (window.shellIsland) {
    window.shellIsland.triggerPolicyAlert({
      title: `Policy Gate: ${capabilityId}`,
      riskLevel: RiskLabels[riskLevel],
      reason: reason,
      description: `Target ${capabilityId}. Biometric sign-off mandated.`,
      onApprove: () => handleModalDecision(true),
      onDeny: () => handleModalDecision(false)
    });
  }

  backdrop.classList.add('active');

  return new Promise(resolve => {
    modalResolver = resolve;
  });
}

function handleModalDecision(approved) {
  if (approved) {
    window.PravahHaptics?.haptics.successChime();
  } else {
    window.PravahHaptics?.haptics.heavyWarning();
  }
  if (window.shellIsland && window.shellIsland.getState() === 'POLICY_ALERT') {
    window.shellIsland.collapse();
  }
  const backdrop = document.getElementById('approval-modal-backdrop');
  backdrop.classList.remove('active');
  if (modalResolver) {
    modalResolver(approved);
    modalResolver = null;
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================================
// Spring-Damping Gesture Physics Integration (Pillar 1)
// ============================================================================

/**
 * Attaches interactive card dragging with rubber-band resistance and
 * velocity-conserving 2D spring snap-back.
 */
function attachCardSpringPhysics(container) {
  const Motion = window.PravahMotion;
  if (!Motion || !container) return;

  const cards = container.querySelectorAll('.dag-node-card');
  cards.forEach(card => {
    card.classList.add('is-draggable');
    let startX = 0, startY = 0;
    let isDragging = false;
    let activeSpringX = null;
    let activeSpringY = null;
    let tracker = null;
    let curX = 0, curY = 0;

    const onPointerDown = (e) => {
      // Ignore click on interactive children if any
      if (e.target.closest('button, input, pre, code')) return;

      isDragging = true;
      try { card.setPointerCapture(e.pointerId); } catch (_) {}
      card.classList.add('is-dragging');

      if (activeSpringX) { activeSpringX.cancel(); activeSpringX = null; }
      if (activeSpringY) { activeSpringY.cancel(); activeSpringY = null; }

      startX = e.clientX;
      startY = e.clientY;
      curX = 0;
      curY = 0;

      tracker = new Motion.VelocityTracker();
      tracker.addPoint(e.clientX, e.clientY);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const rawDx = e.clientX - startX;
      const rawDy = e.clientY - startY;

      // Apple/Pixel rubber-band overscroll resistance
      curX = Motion.rubberBandClamp(rawDx, 420);
      curY = Motion.rubberBandClamp(rawDy, 320);

      const rot = (curX * 0.03).toFixed(2);
      card.style.transform = `translate3d(${curX.toFixed(1)}px, ${curY.toFixed(1)}px, 0) scale(1.03) rotate(${rot}deg)`;
      tracker.addPoint(e.clientX, e.clientY);
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      card.classList.remove('is-dragging');
      try { card.releasePointerCapture(e.pointerId); } catch (_) {}

      const { vx, vy } = tracker ? tracker.getVelocity() : { vx: 0, vy: 0 };

      // Launch 2D spring snap-back conserving release velocity
      const springX = new Motion.Spring(Motion.SpringPresets.DEFAULT);
      springX.setTarget(0, vx, curX);

      const springY = new Motion.Spring(Motion.SpringPresets.DEFAULT);
      springY.setTarget(0, vy, curY);

      let animId = Motion.sharedTicker.add((dt) => {
        const sX = springX.step(dt);
        const sY = springY.step(dt);
        const rot = (sX.value * 0.03).toFixed(2);
        card.style.transform = `translate3d(${sX.value.toFixed(1)}px, ${sY.value.toFixed(1)}px, 0) rotate(${rot}deg)`;

        if (sX.done && sY.done) {
          card.style.transform = '';
          return false; // unregister from ticker
        }
        return true;
      });

      activeSpringX = { cancel: () => Motion.sharedTicker.remove(animId) };
    };

    card.addEventListener('pointerdown', onPointerDown);
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp);
    card.addEventListener('pointercancel', onPointerUp);
  });
}

/**
 * Initializes interactive swipe-to-dismiss and spring return on the Approval Modal sheet.
 */
function initModalSheetSpringPhysics() {
  const Motion = window.PravahMotion;
  const backdrop = document.getElementById('approval-modal-backdrop');
  const modalCard = backdrop?.querySelector('.modal-card');
  const handle = backdrop?.querySelector('.modal-drag-handle');
  if (!backdrop || !modalCard || !Motion) return;

  let startY = 0;
  let isDragging = false;
  let curY = 0;
  let tracker = null;
  let activeSpring = null;
  const flingController = new Motion.FlingDismissController({
    dismissThresholdPx: 120,
    dismissVelocityPx: 600,
    springConfig: Motion.SpringPresets.DEFAULT
  });

  const onPointerDown = (e) => {
    if (e.target.closest('button')) return;
    isDragging = true;
    try { modalCard.setPointerCapture(e.pointerId); } catch (_) {}
    modalCard.classList.add('is-dragging');

    if (activeSpring) { activeSpring.cancel(); activeSpring = null; }
    startY = e.clientY;
    curY = 0;
    tracker = new Motion.VelocityTracker();
    tracker.addPoint(e.clientX, e.clientY);
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const rawDy = e.clientY - startY;

    if (rawDy < 0) {
      // Pulling upwards: apply rubber-band resistance
      curY = Motion.rubberBandClamp(rawDy, 220);
    } else {
      // Pulling downwards: smooth linear translation
      curY = rawDy;
    }

    const opacity = Math.max(0.25, 1 - (curY / 650)).toFixed(2);
    modalCard.style.transform = `translate3d(0, ${curY.toFixed(1)}px, 0)`;
    modalCard.style.opacity = opacity;
    tracker.addPoint(e.clientX, e.clientY);
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    modalCard.classList.remove('is-dragging');
    try { modalCard.releasePointerCapture(e.pointerId); } catch (_) {}

    const { vy } = tracker ? tracker.getVelocity() : { vy: 0 };
    const evalRes = flingController.evaluate(curY, vy, 600, 0);

    const spring = new Motion.Spring(Motion.SpringPresets.DEFAULT);
    spring.setTarget(evalRes.target, evalRes.velocity, curY);

    let animId = Motion.sharedTicker.add((dt) => {
      const state = spring.step(dt);
      modalCard.style.transform = `translate3d(0, ${state.value.toFixed(1)}px, 0)`;
      if (evalRes.willDismiss) {
        modalCard.style.opacity = Math.max(0, 1 - (state.value / 400)).toFixed(2);
      }

      if (state.done) {
        modalCard.style.transform = '';
        modalCard.style.opacity = '';
        if (evalRes.willDismiss) {
          handleModalDecision(false);
        }
        return false;
      }
      return true;
    });

    activeSpring = { cancel: () => Motion.sharedTicker.remove(animId) };
  };

  const dragTarget = handle || modalCard;
  dragTarget.addEventListener('pointerdown', onPointerDown);
  dragTarget.addEventListener('pointermove', onPointerMove);
  dragTarget.addEventListener('pointerup', onPointerUp);
  dragTarget.addEventListener('pointercancel', onPointerUp);
}

/**
 * Attaches smooth list fling inertia scrolling and overscroll edge rebound.
 * 
 * @param {HTMLElement} element
 * @param {'x'|'y'} axis
 */
function initListInertiaPhysics(element, axis = 'x') {
  const Motion = window.PravahMotion;
  if (!element || !Motion) return;

  let isDragging = false;
  let startCoord = 0;
  let startScroll = 0;
  let tracker = null;
  let activeAnimation = null;
  const momentum = new Motion.MomentumInertia({ decelerationRate: 3.2, minVelocity: 15 });

  const getCoord = (e) => (axis === 'x' ? e.clientX : e.clientY);
  const getScroll = () => (axis === 'x' ? element.scrollLeft : element.scrollTop);
  const setScroll = (val) => {
    if (axis === 'x') element.scrollLeft = val;
    else element.scrollTop = val;
  };
  const getMaxScroll = () => (axis === 'x' ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight);

  element.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, .dag-node-card')) return;

    if (activeAnimation) {
      activeAnimation.cancel();
      activeAnimation = null;
    }

    isDragging = true;
    element.classList.add('is-dragging');
    startCoord = getCoord(e);
    startScroll = getScroll();
    tracker = new Motion.VelocityTracker();
    tracker.addPoint(e.clientX, e.clientY);
  });

  window.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const delta = getCoord(e) - startCoord;
    const targetScroll = startScroll - delta;
    const maxScroll = getMaxScroll();

    if (targetScroll < 0) {
      const over = -targetScroll;
      const resisted = Motion.rubberBandClamp(over, 250);
      setScroll(0);
      element.style.transform = axis === 'x'
        ? `translate3d(${resisted.toFixed(1)}px, 0, 0)`
        : `translate3d(0, ${resisted.toFixed(1)}px, 0)`;
    } else if (targetScroll > maxScroll && maxScroll > 0) {
      const over = targetScroll - maxScroll;
      const resisted = Motion.rubberBandClamp(over, 250);
      setScroll(maxScroll);
      element.style.transform = axis === 'x'
        ? `translate3d(${-resisted.toFixed(1)}px, 0, 0)`
        : `translate3d(0, ${-resisted.toFixed(1)}px, 0)`;
    } else {
      element.style.transform = '';
      setScroll(targetScroll);
    }

    tracker.addPoint(e.clientX, e.clientY);
  });

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    element.classList.remove('is-dragging');

    // Restore rubber-band overscroll if active
    if (element.style.transform) {
      const match = element.style.transform.match(/translate3d\(([^p]+)px/);
      const currentOffset = match ? parseFloat(match[1]) : 0;
      const spring = new Motion.Spring(Motion.SpringPresets.OVERSCROLL_RESTORE);
      spring.setTarget(0, 0, currentOffset);

      let animId = Motion.sharedTicker.add((dt) => {
        const s = spring.step(dt);
        element.style.transform = axis === 'x'
          ? `translate3d(${s.value.toFixed(1)}px, 0, 0)`
          : `translate3d(0, ${s.value.toFixed(1)}px, 0)`;

        if (s.done) {
          element.style.transform = '';
          return false;
        }
        return true;
      });
      activeAnimation = { cancel: () => Motion.sharedTicker.remove(animId) };
      return;
    }

    // Evaluate fling velocity
    const vel = tracker ? tracker.getVelocity() : { vx: 0, vy: 0 };
    const flingVelocity = -(axis === 'x' ? vel.vx : vel.vy);

    if (Math.abs(flingVelocity) > 60) {
      let currentPos = getScroll();
      let currentVel = flingVelocity;
      let animTime = 0;

      let animId = Motion.sharedTicker.add((dt) => {
        animTime += dt;
        currentPos += (flingVelocity * Math.exp(-momentum.decelerationRate * animTime) * dt);
        const maxScroll = getMaxScroll();

        if (currentPos < 0 || currentPos > maxScroll) {
          setScroll(Math.max(0, Math.min(maxScroll, currentPos)));
          return false;
        }

        setScroll(currentPos);

        const currentSpeed = Math.abs(currentVel * Math.exp(-momentum.decelerationRate * animTime));
        if (currentSpeed <= momentum.minVelocity) {
          return false;
        }
        return true;
      });

      activeAnimation = { cancel: () => Motion.sharedTicker.remove(animId) };
    }
  };

  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

// Event Listeners & Initialization
document.addEventListener('DOMContentLoaded', async () => {
  await initAuditLedger();
  renderAmbientHeader();
  renderWorkspace();
  await renderAuditInspector();

  // Initialize Dynamic Island
  const shellIslandEl = document.getElementById('shell-dynamic-island');
  if (shellIslandEl && window.PravahIsland?.DynamicIslandController) {
    window.shellIsland = new window.PravahIsland.DynamicIslandController(shellIslandEl);
  }

  // Initialize Living App Drawer & Capability Catalog
  const livingDrawerEl = document.getElementById('living-drawer');
  if (livingDrawerEl && window.PravahDrawer?.LivingDrawer) {
    window.livingDrawer = new window.PravahDrawer.LivingDrawer({
      container: livingDrawerEl,
      onLaunchApp: (app, launchType) => {
        if (launchType === 'dag' && app.scenario) {
          const input = document.getElementById('intent-input');
          if (input && Scenarios[app.scenario]) {
            input.value = Scenarios[app.scenario].intent;
          }
          executeTask(app.scenario);
        }
      },
      onStateChange: (state) => {
        const navPill = document.getElementById('shell-drawer-nav');
        if (navPill) {
          navPill.style.opacity = (state === 'EXPANDED') ? '0' : '1';
          navPill.style.pointerEvents = (state === 'EXPANDED') ? 'none' : 'auto';
        }
      }
    });

    // Wire bottom pill bar click
    const drawerNavPill = document.getElementById('shell-drawer-nav');
    if (drawerNavPill) {
      drawerNavPill.addEventListener('click', () => {
        window.PravahHaptics?.haptics.mediumSnap();
        window.livingDrawer?.toggle();
      });
    }

    // Direct swipe up gesture detection on bottom viewport edge
    let touchStartY = 0;
    let touchStartTime = 0;
    window.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        const dy = e.changedTouches[0].clientY - touchStartY;
        const dt = Date.now() - touchStartTime;
        // Swipe up from bottom area (dy < -60px within 500ms)
        if (dy < -60 && dt < 500 && touchStartY > window.innerHeight - 160) {
          window.livingDrawer?.expand();
        }
      }
    }, { passive: true });
  }

  // Initialize Spring-Damping Gesture Physics & 120Hz Momentum Inertia
  initModalSheetSpringPhysics();
  initListInertiaPhysics(document.getElementById('dag-canvas'), 'x');
  initListInertiaPhysics(document.getElementById('audit-stream'), 'y');

  // Scenario Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      window.PravahHaptics?.haptics.lightTap();
      const scenarioKey = chip.getAttribute('data-scenario');
      const input = document.getElementById('intent-input');
      if (input && Scenarios[scenarioKey]) {
        input.value = Scenarios[scenarioKey].intent;
      }
      executeTask(scenarioKey);
    });
  });

  // Intent Submit
  const submitBtn = document.getElementById('btn-submit-intent');
  const intentInput = document.getElementById('intent-input');
  submitBtn.addEventListener('click', () => {
    window.PravahHaptics?.haptics.mediumSnap();
    const raw = (intentInput.value || '').toLowerCase();
    if (raw.includes('photo') || raw.includes('document') || raw.includes('camera') || raw.includes('private note')) {
      executeTask('camera_note');
    } else if (raw.includes('usdc') || raw.includes('crypto') || raw.includes('sol') || raw.includes('bob')) {
      executeTask('crypto');
    } else if (raw.includes('flight') || raw.includes('ai-202') || raw.includes('reminder')) {
      executeTask('flight');
    } else if (raw.includes('send') || raw.includes('transfer') || raw.includes('5,000') || raw.includes('alice')) {
      executeTask('payment');
    } else if (raw.includes('memory') || raw.includes('cache') || raw.includes('flush')) {
      executeTask('memory');
    } else if (raw.includes('ocr') || raw.includes('receipt') || raw.includes('expense')) {
      executeTask('ocr');
    } else if (raw.includes('whatsapp') || raw.includes('video call')) {
      executeTask('android_whatsapp');
    } else if (raw.includes('spotify') || raw.includes('music') || raw.includes('song')) {
      executeTask('android_spotify');
    } else if (raw.includes('maps') || raw.includes('navigation') || raw.includes('gps') || raw.includes('gnss')) {
      executeTask('android_maps');
    } else if (raw.includes('uber') || raw.includes('cab') || raw.includes('ride')) {
      executeTask('android_uber');
    } else {
      // Default to camera_note if document mentioned, else flight
      executeTask('flight');
    }
  });

  intentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitBtn.click();
  });

  // Mic Button & Native Voice Visualizer Pipeline
  const micBtn = document.getElementById('btn-mic');
  let voiceOverlay = null;
  let softKeyboard = null;

  function initKeyboardAndVoice() {
    if (window.PravahVoice && !voiceOverlay) {
      voiceOverlay = new window.PravahVoice.VoiceDictationOverlay({
        targetInput: intentInput,
        onCommit: (text) => {
          if (text) {
            intentInput.value = text;
            submitBtn.click();
            if (window.parent) {
              window.parent.postMessage({
                type: 'PRAVAH_IME_EVENT',
                action: 'VOICE_COMMIT',
                text
              }, '*');
            }
          }
        }
      });
      voiceOverlay.mount();
      window.voiceOverlay = voiceOverlay;
    }

    if (window.PravahKeyboard && !softKeyboard) {
      softKeyboard = new window.PravahKeyboard.SoftKeyboard({
        targetInput: intentInput,
        voiceHandler: () => {
          softKeyboard.hide();
          if (voiceOverlay) voiceOverlay.show();
        },
        onSubmit: (text) => {
          submitBtn.click();
          if (window.parent) {
            window.parent.postMessage({
              type: 'PRAVAH_IME_EVENT',
              action: 'SUBMIT',
              text
            }, '*');
          }
        },
        onKeyPress: (key) => {
          if (window.parent) {
            window.parent.postMessage({
              type: 'PRAVAH_IME_EVENT',
              action: 'KEY_PRESS',
              key
            }, '*');
          }
        }
      });
      softKeyboard.mount();
      softKeyboard.attach(intentInput);
      window.softKeyboard = softKeyboard;
    }
  }

  // Attempt immediate or deferred initialization
  if (window.PravahKeyboard && window.PravahVoice) {
    initKeyboardAndVoice();
  } else {
    setTimeout(initKeyboardAndVoice, 100);
  }

  micBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (softKeyboard) softKeyboard.hide();
    if (voiceOverlay) {
      voiceOverlay.show();
    } else {
      // Fallback if modules still loading
      ShellState.isListeningVoice = !ShellState.isListeningVoice;
      if (ShellState.isListeningVoice) {
        micBtn.classList.add('listening');
        intentInput.placeholder = 'Listening to voice stream (Air-gapped on-device Whisper)...';
        setTimeout(() => {
          intentInput.value = 'Send ₹5,000 to Alice from verified account';
          micBtn.classList.remove('listening');
          intentInput.placeholder = 'Describe your goal (e.g., "Check flight AI-202 and set reminder")...';
          ShellState.isListeningVoice = false;
          submitBtn.click();
        }, 2200);
      } else {
        micBtn.classList.remove('listening');
      }
    }
  });

  // Modal Buttons
  document.getElementById('btn-approve-gate').addEventListener('click', () => handleModalDecision(true));
  document.getElementById('btn-deny-gate').addEventListener('click', () => handleModalDecision(false));

  // Audit Tamper Demo Buttons
  document.getElementById('btn-tamper-audit').addEventListener('click', async () => {
    if (ShellState.auditLog.length > 1) {
      // Corrupt hash of block 1
      ShellState.auditLog[1].hash = 'badbeef000000000000000000000000000000000000000000000000000000000';
      await renderAuditInspector();
    }
  });

  document.getElementById('btn-repair-audit').addEventListener('click', async () => {
    // Re-seal entire hash chain
    let prev = '0000000000000000000000000000000000000000000000000000000000000000';
    for (const record of ShellState.auditLog) {
      record.prevHash = prev;
      record.hash = await sha256Hex({ ...record, hash: undefined });
      prev = record.hash;
    }
    await renderAuditInspector();
  });

  // Airgap toggle
  document.getElementById('offline-badge').addEventListener('click', () => {
    ShellState.offline = !ShellState.offline;
    renderAmbientHeader();
  });

  // Authority badge toggle
  document.getElementById('authority-badge').addEventListener('click', () => {
    const levels = ['OBSERVE', 'PREPARE', 'EXECUTE', 'MANAGE'];
    const curIdx = levels.indexOf(ShellState.authority);
    ShellState.authority = levels[(curIdx + 1) % levels.length];
    renderAmbientHeader();
  });

  // Telemetry fluctuation simulator
  setInterval(() => {
    ShellState.telemetry.npu = Math.min(95, Math.max(5, ShellState.telemetry.npu + Math.floor(Math.random() * 9 - 4)));
    ShellState.telemetry.cpu = Math.min(80, Math.max(8, ShellState.telemetry.cpu + Math.floor(Math.random() * 5 - 2)));
    renderAmbientHeader();
  }, 2500);

  // Hardware Emulator Bridge Listener
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'PRAVAH_SET_AIRGAP':
        ShellState.offline = Boolean(data.offline);
        renderAmbientHeader();
        window.livingDrawer?.updateTelemetry({ airgap: ShellState.offline });
        break;

      case 'PRAVAH_SET_AUTHORITY':
        if (data.authority) {
          ShellState.authority = data.authority;
          renderAmbientHeader();
        }
        break;

      case 'PRAVAH_SET_TELEMETRY':
        if (data.telemetry) {
          Object.assign(ShellState.telemetry, data.telemetry);
          renderAmbientHeader();
          window.livingDrawer?.updateTelemetry(ShellState.telemetry);
        }
        break;

      case 'PRAVAH_TRIGGER_SCENARIO':
        if (data.scenario && Scenarios[data.scenario]) {
          loadScenario(data.scenario);
        }
        break;

      case 'PRAVAH_EXECUTE_INTENT':
        const input = document.getElementById('intent-input');
        if (input && data.intent) {
          input.value = data.intent;
          document.getElementById('btn-submit-intent')?.click();
        }
        break;

      case 'PRAVAH_DECISION':
        handleModalDecision(Boolean(data.approved));
        break;

      case 'PRAVAH_GESTURE_FLING':
        if (data.gesture) {
          const g = data.gesture;
          const canvas = document.getElementById('dag-canvas');
          if (g.name === 'SWIPE_UP') {
            window.livingDrawer?.expand();
          } else if (g.name === 'SWIPE_DOWN') {
            if (window.livingDrawer && window.livingDrawer.state === 'EXPANDED') {
              window.livingDrawer.collapse();
            } else {
              const modal = document.getElementById('approval-modal-backdrop');
              if (modal && modal.classList.contains('active')) {
                handleModalDecision(false);
              }
            }
          } else if (canvas && (g.name === 'SWIPE_LEFT' || g.name === 'SWIPE_RIGHT')) {
            const vel = g.name === 'SWIPE_LEFT' ? 700 : -700;
            canvas.scrollBy({ left: vel * 0.45, behavior: 'smooth' });
          }
        }
        break;

      case 'PRAVAH_TOGGLE_DRAWER':
        window.livingDrawer?.toggle();
        break;

      case 'PRAVAH_OPEN_DRAWER':
        window.livingDrawer?.expand();
        break;

      case 'PRAVAH_CLOSE_DRAWER':
        window.livingDrawer?.collapse();
        break;

      case 'PRAVAH_TOGGLE_KEYBOARD':
        if (window.softKeyboard) {
          if (window.softKeyboard.visibility === 'SHOWN') {
            window.softKeyboard.hide();
          } else {
            window.softKeyboard.show();
          }
        }
        break;

      case 'PRAVAH_TRIGGER_VOICE':
        if (window.softKeyboard) window.softKeyboard.hide();
        if (window.voiceOverlay) window.voiceOverlay.show();
        break;

      case 'PRAVAH_QUERY_STATE':
        if (window.parent) {
          window.parent.postMessage({
            type: 'PRAVAH_SHELL_TELEMETRY',
            state: {
              offline: ShellState.offline,
              authority: ShellState.authority,
              telemetry: { ...ShellState.telemetry },
              currentTask: ShellState.currentTask ? ShellState.currentTask.goal : null
            }
          }, '*');
        }
        break;
    }
  });
});
