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

  backdrop.classList.add('active');

  return new Promise(resolve => {
    modalResolver = resolve;
  });
}

function handleModalDecision(approved) {
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

// Event Listeners & Initialization
document.addEventListener('DOMContentLoaded', async () => {
  await initAuditLedger();
  renderAmbientHeader();
  renderWorkspace();
  await renderAuditInspector();

  // Scenario Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
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
    const raw = (intentInput.value || '').toLowerCase();
    if (raw.includes('flight') || raw.includes('ai-202') || raw.includes('reminder')) {
      executeTask('flight');
    } else if (raw.includes('send') || raw.includes('transfer') || raw.includes('5,000') || raw.includes('alice')) {
      executeTask('payment');
    } else if (raw.includes('memory') || raw.includes('cache') || raw.includes('flush')) {
      executeTask('memory');
    } else if (raw.includes('ocr') || raw.includes('receipt') || raw.includes('expense')) {
      executeTask('ocr');
    } else {
      // Default to flight
      executeTask('flight');
    }
  });

  intentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitBtn.click();
  });

  // Mic Button Simulation
  const micBtn = document.getElementById('btn-mic');
  micBtn.addEventListener('click', () => {
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
});
