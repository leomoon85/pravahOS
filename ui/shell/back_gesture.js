// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file back_gesture.js
 * Universal Back Gesture & Predictive Back Subsystem for PravahOS.
 *
 * Implements Android 14/15-style Predictive Edge Back Navigation:
 * 1. Edge Inward Swipe Detection: Swiping inward from either the left or right screen edge.
 * 2. Predictive Back Indicator: Floating liquid squircle pill with animated directional arrow
 *    that dynamically stretches with rubberband physics.
 * 3. Haptic & Visual Activation: Commits when threshold (>= 48px) is reached with glowing neon cyan beacon.
 * 4. Hierarchical OS Back Action Stack: Deterministically unwinds the top-most active surface:
 *    Approval Modal -> Call Screen -> Dialer -> Living Drawer -> Control Center ->
 *    Soft Keyboard -> Ephemeral Windows -> Active Task DAG -> Root Home.
 */

import { haptics } from '../motion/haptics.js';
import { rubberBandClamp } from '../motion/spring.js';

export const BackGestureState = {
  IDLE: 'IDLE',
  DRAGGING_LEFT: 'DRAGGING_LEFT',
  DRAGGING_RIGHT: 'DRAGGING_RIGHT',
  COMMITTED: 'COMMITTED',
  TRIGGERED: 'TRIGGERED'
};

export class UniversalBackGestureController {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.edgeZonePx = options.edgeZonePx ?? 32;       // Distance from edge to initiate back gesture
    this.commitDistancePx = options.commitDistancePx ?? 54; // Distance to commit the back action
    this.maxStretchPx = options.maxStretchPx ?? 90;
    this.onBack = options.onBack || null;

    this.state = BackGestureState.IDLE;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.activeEdge = null; // 'left' | 'right'
    this.isCommitted = false;

    this.indicatorEl = null;

    if (this.container) {
      this.initDom();
      this.bindGestureListeners();
    }
  }

  initDom() {
    // Create floating predictive back indicator pill
    let pill = document.getElementById('predictive-back-indicator');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'predictive-back-indicator';
      pill.className = 'predictive-back-indicator';
      pill.innerHTML = `
        <div class="back-pill-bubble">
          <svg class="back-arrow-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </div>
      `;
      this.container.appendChild(pill);
    }
    this.indicatorEl = pill;
  }

  bindGestureListeners() {
    if (!this.container) return;

    // Pointer events on container
    this.container.addEventListener('pointerdown', (e) => this.handlePointerDown(e), { passive: true });
    window.addEventListener('pointermove', (e) => this.handlePointerMove(e), { passive: true });
    window.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    window.addEventListener('pointercancel', (e) => this.handlePointerCancel(e));
  }

  handlePointerDown(e) {
    // Only capture primary pointer
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const winWidth = window.innerWidth;
    const x = e.clientX;
    const y = e.clientY;

    if (x <= this.edgeZonePx) {
      this.activeEdge = 'left';
    } else if (x >= winWidth - this.edgeZonePx) {
      this.activeEdge = 'right';
    } else {
      this.activeEdge = null;
      return;
    }

    this.startX = x;
    this.startY = y;
    this.currentX = x;
    this.currentY = y;
    this.isCommitted = false;
    this.state = (this.activeEdge === 'left') ? BackGestureState.DRAGGING_LEFT : BackGestureState.DRAGGING_RIGHT;
  }

  handlePointerMove(e) {
    if (!this.activeEdge || this.state === BackGestureState.IDLE) return;

    this.currentX = e.clientX;
    this.currentY = e.clientY;

    const deltaX = (this.activeEdge === 'left')
      ? (this.currentX - this.startX)
      : (this.startX - this.currentX);
    const deltaY = Math.abs(this.currentY - this.startY);

    // Cancel if vertical scroll is dominant
    if (deltaY > 50 && deltaY > deltaX * 1.5) {
      this.resetIndicator();
      return;
    }

    // Inward pull distance (must be positive)
    const inwardDist = Math.max(0, deltaX);
    if (inwardDist < 6) return;

    const wasCommitted = this.isCommitted;
    this.isCommitted = (inwardDist >= this.commitDistancePx);
    const stretchedPx = rubberBandClamp(inwardDist, this.maxStretchPx, 0.45);

    // Tactile tick on crossing commit threshold
    if (!wasCommitted && this.isCommitted) {
      try {
        haptics?.lightTap();
      } catch (_) {}
    }

    this.updateIndicator(stretchedPx, this.currentY);
  }

  handlePointerUp() {
    if (!this.activeEdge || this.state === BackGestureState.IDLE) return;

    if (this.isCommitted) {
      this.triggerBackAction();
    } else {
      this.resetIndicator();
    }
  }

  handlePointerCancel() {
    this.resetIndicator();
  }

  updateIndicator(displacementPx, clientY) {
    if (!this.indicatorEl) return;

    this.indicatorEl.classList.add('visible');
    this.indicatorEl.classList.toggle('edge-left', this.activeEdge === 'left');
    this.indicatorEl.classList.toggle('edge-right', this.activeEdge === 'right');
    this.indicatorEl.classList.toggle('committed', this.isCommitted);

    const clampedY = Math.max(80, Math.min(window.innerHeight - 80, clientY));
    this.indicatorEl.style.top = `${clampedY}px`;

    // Horizontal offset & scale
    const scale = Math.min(1.25, 0.7 + (displacementPx / this.commitDistancePx) * 0.4);
    if (this.activeEdge === 'left') {
      this.indicatorEl.style.left = `${displacementPx}px`;
      this.indicatorEl.style.right = 'auto';
      this.indicatorEl.style.transform = `translate(-50%, -50%) scale(${scale})`;
    } else {
      this.indicatorEl.style.right = `${displacementPx}px`;
      this.indicatorEl.style.left = 'auto';
      this.indicatorEl.style.transform = `translate(50%, -50%) scale(${scale}) scaleX(-1)`;
    }

    // Gentle 3D scale compression on main shell
    const shellContainer = document.querySelector('.shell-container');
    if (shellContainer) {
      const compress = Math.max(0.96, 1.0 - (displacementPx / 800));
      shellContainer.style.transform = `scale(${compress})`;
      shellContainer.style.transition = 'none';
    }
  }

  resetIndicator() {
    this.state = BackGestureState.IDLE;
    this.activeEdge = null;
    this.isCommitted = false;

    if (this.indicatorEl) {
      this.indicatorEl.classList.remove('visible', 'committed');
    }

    const shellContainer = document.querySelector('.shell-container');
    if (shellContainer) {
      shellContainer.style.transform = 'scale(1)';
      shellContainer.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    }
  }

  triggerBackAction() {
    this.state = BackGestureState.TRIGGERED;

    if (this.indicatorEl) {
      this.indicatorEl.classList.add('trigger-pop');
      setTimeout(() => {
        this.indicatorEl?.classList.remove('trigger-pop');
        this.resetIndicator();
      }, 260);
    } else {
      this.resetIndicator();
    }

    try {
      haptics?.mediumSnap();
    } catch (_) {}

    // Invoke hierarchical back stack
    const actionTaken = executeUniversalBackStack();
    if (this.onBack) this.onBack(actionTaken);
    return actionTaken;
  }
}

/**
 * Deterministically unwinds the top-most active surface in PravahOS.
 * @returns {object} Action descriptor specifying which layer was unwound.
 */
export function executeUniversalBackStack() {
  // 1. Policy Gate Approval Modal
  const approvalModal = document.getElementById('approval-modal-backdrop');
  if (approvalModal && approvalModal.classList.contains('active')) {
    const btnDeny = approvalModal.querySelector('#btn-deny-action') || approvalModal.querySelector('.btn-policy-deny');
    if (btnDeny) btnDeny.click();
    else approvalModal.classList.remove('active');
    return { layer: 'APPROVAL_MODAL', action: 'DISMISS' };
  }

  // 2. Telecom Call Overlay
  if (window.telecomDialer && window.telecomDialer.callState !== 'IDLE') {
    window.telecomDialer.hangUp();
    return { layer: 'CALL_OVERLAY', action: 'HANGUP' };
  }

  // 3. Telecom Dialer Surface
  const dialerRoot = document.getElementById('dialer-root');
  if (dialerRoot && dialerRoot.classList.contains('expanded')) {
    window.telecomDialer?.close();
    return { layer: 'DIALER', action: 'CLOSE' };
  }

  // 4. Living Drawer & Fast Jump Modal
  if (window.livingDrawer && window.livingDrawer.state === 'EXPANDED') {
    if (window.livingDrawer.activeFastJump) {
      window.livingDrawer.closeFastJumpModal();
      return { layer: 'FAST_JUMP_MODAL', action: 'CLOSE' };
    }
    window.livingDrawer.collapse();
    return { layer: 'LIVING_DRAWER', action: 'COLLAPSE' };
  }

  // 5. Control Center & Hardware Shade
  if (window.controlShade && window.controlShade.state === 'EXPANDED') {
    window.controlShade.collapse();
    return { layer: 'CONTROL_SHADE', action: 'COLLAPSE' };
  }

  // 6. Soft Keyboard
  if (window.softKeyboard && window.softKeyboard.visibility === 'SHOWN') {
    window.softKeyboard.hide();
    return { layer: 'SOFT_KEYBOARD', action: 'HIDE' };
  }

  // 7. Ephemeral Overlay Windows
  if (window.livingDrawer?.windowManager) {
    const openWins = window.livingDrawer.windowManager.getOpenWindows();
    if (openWins.length > 0) {
      const topWin = openWins[openWins.length - 1];
      window.livingDrawer.windowManager.closeWindow(topWin.id);
      return { layer: 'EPHEMERAL_WINDOW', action: 'CLOSE', appId: topWin.id };
    }
  }

  // 8. Active Task Scenario Workspace
  const taskTitle = document.getElementById('task-title');
  const progressFill = document.getElementById('progress-fill');
  const dagCanvas = document.getElementById('dag-canvas');
  if (taskTitle && taskTitle.textContent !== "Your Day's Flow" && dagCanvas && dagCanvas.children.length > 0) {
    taskTitle.textContent = "Your Day's Flow";
    const sub = document.getElementById('task-sub');
    if (sub) sub.textContent = "Ready to coordinate your apps & tasks securely";
    if (progressFill) progressFill.style.width = '0%';
    dagCanvas.innerHTML = '';
    return { layer: 'TASK_WORKSPACE', action: 'RESET_HOME' };
  }

  // 9. Intent Search Input
  const intentInput = document.getElementById('intent-input');
  if (intentInput && intentInput.value && intentInput.value !== 'Check flight AI-202 and set reminder 2 hours before departure') {
    intentInput.value = '';
    intentInput.blur();
    return { layer: 'INTENT_INPUT', action: 'CLEAR' };
  }

  // 10. Root Home State: subtle bounce & Dynamic Island pulse
  if (window.shellIsland) {
    window.shellIsland.morphToState('island-alert', { text: '✦ Home' });
    setTimeout(() => window.shellIsland?.returnToCompact(), 1200);
  }

  return { layer: 'ROOT_HOME', action: 'BOUNCE' };
}

// Window global registration
if (typeof window !== 'undefined') {
  window.PravahBackGesture = {
    BackGestureState,
    UniversalBackGestureController,
    executeUniversalBackStack
  };
}
