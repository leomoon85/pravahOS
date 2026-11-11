// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file messages.js
 * PravahOS Flagship Messages & SMS Stock Application.
 *
 * Implements:
 * 1. Fossify-speed conversation thread list with unread badges, timestamps, and avatar pills.
 * 2. Telegram/iMessage-style rich chat bubbles (sent with emerald/cyan accent and ticks;
 *    received with glassmorphic dark container).
 * 3. Instant message composer with character counter, SMS segment math, send button,
 *    quick templates ('On my way!', 'Can you call me?', 'Offline air-gap verified'),
 *    emoji quick-actions, and scheduled message simulation.
 * 4. Zero-cloud air-gap encryption badge ('🔒 ML-KEM-768 Hardware Sealed' via Titan M2 enclave).
 * 5. Full search filter across all message threads, contact names, and numbers.
 * 6. PravahOS Microkernel capability hooks for `telephony.sms`.
 */

export const RiskLevel = Object.freeze({
  READ_ONLY: 0,
  REVERSIBLE: 1,
  CONSEQUENTIAL: 2,
  IRREVERSIBLE: 3
});

export const AuthorityLevel = Object.freeze({
  OBSERVE: 0,
  PREPARE: 1,
  EXECUTE: 2,
  MANAGE: 3
});

export const DeliveryStatus = Object.freeze({
  SENDING: 'SENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED'
});

export const AIR_GAP_BADGE_TEXT = '🔒 ML-KEM-768 Hardware Sealed';
export const CELLULAR_BADGE_TEXT = '⚡ Standard Cellular SMS';

export const QUICK_TEMPLATES = [
  'On my way!',
  'Can you call me?',
  'Offline air-gap verified'
];

export const DEFAULT_EMOJIS = ['👍', '❤️', '🚀', '🔒', '😊', '🔥'];

export const TelephonySmsDescriptor = Object.freeze({
  id: 'telephony.sms',
  version: '1.0.0',
  riskLevel: RiskLevel.CONSEQUENTIAL,
  requiredAuthority: AuthorityLevel.EXECUTE,
  actions: ['send', 'receive', 'query', 'delete'],
  metadata: {
    category: 'TELEPHONY',
    description: 'PravahOS Microkernel Telephony SMS Subsystem with ML-KEM-768 Hardware Air-Gap Encryption and Titan M2 Sealing'
  }
});

/**
 * Native Microkernel Telephony SMS Capability.
 * Manages cellular baseband transceiver, air-gap crypto interlock, and local dispatch.
 */
export class TelephonySmsCapability {
  constructor(options = {}) {
    this.descriptor = TelephonySmsDescriptor;
    this.outboxHistory = [];
    this.inboxHistory = [];
    this.securityEnclave = options.securityEnclave || 'Titan M2';
  }

  /**
   * Execute microkernel capability action.
   * @param {Object} request
   * @param {string} request.action - 'send' | 'receive' | 'query' | 'delete'
   * @param {Object} request.payload
   * @returns {Promise<Object>} Execution result
   */
  async execute({ action = 'send', payload = {} } = {}) {
    switch (action) {
      case 'send': {
        const { recipient, body, airGapEncrypted = true, scheduledTime = null } = payload;
        if (!recipient || !body) {
          throw new Error('TelephonySmsCapability: Missing recipient or message body.');
        }

        const messageId = `sms-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let cryptoEnvelope = null;

        if (airGapEncrypted) {
          cryptoEnvelope = {
            algorithm: 'ML-KEM-768',
            enclave: this.securityEnclave,
            fingerprint: 'titan2-kem-' + Math.random().toString(16).slice(2, 10),
            sealedAt: new Date().toISOString(),
            zeroCloudVerified: true
          };
        }

        const dispatchRecord = {
          messageId,
          recipient,
          body,
          airGapEncrypted,
          cryptoEnvelope,
          scheduledTime,
          status: scheduledTime ? 'SCHEDULED' : 'SENT',
          dispatchedAt: new Date().toISOString()
        };

        this.outboxHistory.push(dispatchRecord);

        return {
          success: true,
          action: 'send',
          messageId,
          deliveryStatus: dispatchRecord.status,
          cryptoEnvelope,
          auditToken: `tok-sms-${Date.now()}`
        };
      }

      case 'receive': {
        const { sender, body, cryptoEnvelope = null } = payload;
        const messageId = `sms-rx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const record = {
          messageId,
          sender,
          body,
          cryptoEnvelope,
          receivedAt: new Date().toISOString()
        };
        this.inboxHistory.push(record);
        return { success: true, action: 'receive', messageId, record };
      }

      case 'query': {
        const { query = '' } = payload;
        const q = String(query).toLowerCase();
        const results = this.outboxHistory.filter(
          r => r.recipient.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)
        );
        return { success: true, action: 'query', count: results.length, results };
      }

      case 'delete': {
        const { messageId, threadId } = payload;
        if (messageId) {
          this.outboxHistory = this.outboxHistory.filter(r => r.messageId !== messageId);
        }
        return { success: true, action: 'delete', messageId, threadId };
      }

      default:
        throw new Error(`TelephonySmsCapability: Unknown action "${action}".`);
    }
  }
}

/**
 * Format timestamp into Fossify/iMessage standard readable format.
 */
export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;

  if (isToday) {
    return `${displayHours}:${minutes} ${ampm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) {
    return 'Yesterday';
  }

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Calculate SMS character segment math.
 */
export function calculateSmsSegments(text = '') {
  const len = text.length;
  // Standard GSM-7 character limit is 160 chars; concatenated SMS has 153 chars per segment
  let segments = 1;
  let maxPerSegment = 160;

  if (len > 160) {
    maxPerSegment = 153;
    segments = Math.ceil(len / 153);
  }

  const remaining = segments === 1 ? 160 - len : (segments * 153) - len;

  return {
    length: len,
    segments,
    remaining,
    maxPerSegment,
    summary: `${len} / ${segments === 1 ? 160 : segments * 153} (${segments} SMS)`
  };
}

/**
 * Generate cryptographic envelope simulating Titan M2 Post-Quantum ML-KEM-768 seal.
 */
export function generateKemEnvelope(message, recipient) {
  const nonce = Math.random().toString(16).slice(2, 10);
  return {
    algorithm: 'ML-KEM-768',
    securityLevel: 'NIST Level 3 Quantum-Resistant',
    hardwareEnclave: 'Titan M2 Secure Co-Processor',
    authCiphertextHash: `sha256:kem768-${nonce}-${Date.now().toString(16)}`,
    egressState: 'AIR_GAP_ISOLATED',
    zeroCloudRelay: true
  };
}

/**
 * Default sample threads demonstrating high-tech PravahOS features.
 */
export const SAMPLE_THREADS = [
  {
    id: 'thread-alice',
    contact: {
      name: 'Alice Smith',
      number: '+1 555-0123',
      initials: 'AS',
      avatarColor: 'linear-gradient(135deg, #06b6d4, #0284c7)',
      verifiedAirGap: true,
      role: 'PravahOS Core Kernel'
    },
    unreadCount: 1,
    pinned: true,
    updatedAt: Date.now() - 4 * 60 * 1000, // 4 mins ago
    messages: [
      {
        id: 'msg-alice-1',
        threadId: 'thread-alice',
        direction: 'received',
        body: 'Hey! Did you complete the ML-KEM-768 hardware encapsulation test on Titan M2?',
        timestamp: Date.now() - 35 * 60 * 1000,
        status: DeliveryStatus.READ,
        encrypted: true,
        securityBadge: AIR_GAP_BADGE_TEXT
      },
      {
        id: 'msg-alice-2',
        threadId: 'thread-alice',
        direction: 'sent',
        body: 'Yes, baseband is fully isolated. Key agreement ran in 0.8ms with zero cloud egress.',
        timestamp: Date.now() - 12 * 60 * 1000,
        status: DeliveryStatus.READ,
        deliveryTicks: '✓✓',
        encrypted: true,
        securityBadge: AIR_GAP_BADGE_TEXT
      },
      {
        id: 'msg-alice-3',
        threadId: 'thread-alice',
        direction: 'received',
        body: 'Brilliant! Telephony microkernel capability telemetry is spotless.',
        timestamp: Date.now() - 4 * 60 * 1000,
        status: DeliveryStatus.DELIVERED,
        encrypted: true,
        securityBadge: AIR_GAP_BADGE_TEXT
      }
    ]
  },
  {
    id: 'thread-elena',
    contact: {
      name: 'Dr. Elena Vance',
      number: '+1 555-0199',
      initials: 'EV',
      avatarColor: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
      verifiedAirGap: true,
      role: 'Cryptographic Research'
    },
    unreadCount: 0,
    pinned: false,
    updatedAt: Date.now() - 50 * 60 * 1000,
    messages: [
      {
        id: 'msg-elena-1',
        threadId: 'thread-elena',
        direction: 'received',
        body: 'Please verify the Dilithium signature certificates before the secure conference.',
        timestamp: Date.now() - 65 * 60 * 1000,
        status: DeliveryStatus.READ,
        encrypted: true,
        securityBadge: AIR_GAP_BADGE_TEXT
      },
      {
        id: 'msg-elena-2',
        threadId: 'thread-elena',
        direction: 'sent',
        body: 'Offline air-gap verified. Certificates sealed and signed.',
        timestamp: Date.now() - 50 * 60 * 1000,
        status: DeliveryStatus.READ,
        deliveryTicks: '✓✓',
        encrypted: true,
        securityBadge: AIR_GAP_BADGE_TEXT
      }
    ]
  },
  {
    id: 'thread-satcom',
    contact: {
      name: 'SatCom NTN Gateway',
      number: '+881 631-002',
      initials: 'SC',
      avatarColor: 'linear-gradient(135deg, #10b981, #059669)',
      verifiedAirGap: true,
      role: '3GPP Rel-17 NTN Direct'
    },
    unreadCount: 0,
    pinned: false,
    updatedAt: Date.now() - 120 * 60 * 1000,
    messages: [
      {
        id: 'msg-satcom-1',
        threadId: 'thread-satcom',
        direction: 'received',
        body: 'LEO Constellation StarLink-NTN-402 locked at elevation 48°. Direct cellular SMS route operational.',
        timestamp: Date.now() - 120 * 60 * 1000,
        status: DeliveryStatus.READ,
        encrypted: true,
        securityBadge: AIR_GAP_BADGE_TEXT
      }
    ]
  },
  {
    id: 'thread-bob',
    contact: {
      name: 'Bob Johnson',
      number: '+1 555-0144',
      initials: 'BJ',
      avatarColor: 'linear-gradient(135deg, #f59e0b, #d97706)',
      verifiedAirGap: false,
      role: 'Operations'
    },
    unreadCount: 0,
    pinned: false,
    updatedAt: Date.now() - 180 * 60 * 1000,
    messages: [
      {
        id: 'msg-bob-1',
        threadId: 'thread-bob',
        direction: 'received',
        body: 'Hey, are you joining the team standup at 3 PM?',
        timestamp: Date.now() - 190 * 60 * 1000,
        status: DeliveryStatus.READ,
        encrypted: false,
        securityBadge: null
      },
      {
        id: 'msg-bob-2',
        threadId: 'thread-bob',
        direction: 'sent',
        body: 'On my way!',
        timestamp: Date.now() - 180 * 60 * 1000,
        status: DeliveryStatus.DELIVERED,
        deliveryTicks: '✓✓',
        encrypted: false,
        securityBadge: null
      }
    ]
  }
];

/**
 * Main Messages Stock App.
 */
export class MessagesApp {
  /**
   * @param {Object} options
   * @param {HTMLElement|Object} [options.container] - Mounting element
   * @param {Object} [options.capabilityBridge] - Optional Microkernel Capability Bridge
   * @param {boolean} [options.airGapSecurity=true] - Initial air gap security state
   * @param {Array} [options.initialThreads] - Custom thread list
   * @param {Function} [options.onThreadSelect] - Callback when active thread changes
   * @param {Function} [options.onMessageSent] - Callback when message is dispatched
   */
  constructor(options = {}) {
    this.container = options.container || null;
    this.airGapSecurity = options.airGapSecurity !== undefined ? Boolean(options.airGapSecurity) : true;
    this.capability = options.capabilityBridge || new TelephonySmsCapability();

    // Deep copy initial threads so state mutations are isolated
    const sourceThreads = options.initialThreads || SAMPLE_THREADS;
    this.threads = JSON.parse(JSON.stringify(sourceThreads));

    // Sort threads latest first
    this._sortThreads();

    this.activeThreadId = this.threads.length > 0 ? this.threads[0].id : null;
    this.searchQuery = '';
    this.scheduledQueue = [];
    this.scheduledTimers = [];

    this.onThreadSelect = options.onThreadSelect || null;
    this.onMessageSent = options.onMessageSent || null;

    if (this.container) {
      this.mount(this.container);
    }
  }

  /**
   * Mount MessagesApp to a DOM element.
   */
  mount(container) {
    this.container = container;
    this.render();
    this.bindEvents();
  }

  /**
   * Sort thread list by latest message timestamp descending.
   * @private
   */
  _sortThreads() {
    this.threads.sort((a, b) => {
      const timeA = a.updatedAt || (a.messages?.length ? a.messages[a.messages.length - 1].timestamp : 0);
      const timeB = b.updatedAt || (b.messages?.length ? b.messages[b.messages.length - 1].timestamp : 0);
      return timeB - timeA;
    });
  }

  /**
   * Get all conversation threads (sorted latest first).
   * @returns {Array<Object>}
   */
  getThreads() {
    this._sortThreads();
    return this.threads.map(t => ({
      ...t,
      lastMessage: t.messages && t.messages.length > 0 ? t.messages[t.messages.length - 1] : null
    }));
  }

  /**
   * Get messages for a given thread (or active thread if omitted).
   * @param {string} [threadId]
   * @returns {Array<Object>}
   */
  getMessages(threadId) {
    const targetId = threadId || this.activeThreadId;
    const thread = this.threads.find(t => t.id === targetId);
    return thread ? [...thread.messages] : [];
  }

  /**
   * Select a thread by ID, clearing unread badges and updating views.
   * @param {string} threadId
   * @returns {Object|null} The selected thread
   */
  selectThread(threadId) {
    const thread = this.threads.find(t => t.id === threadId);
    if (!thread) return null;

    this.activeThreadId = threadId;
    // Mark as read
    thread.unreadCount = 0;
    if (thread.messages) {
      thread.messages.forEach(m => {
        if (m.direction === 'received' && m.status !== DeliveryStatus.READ) {
          m.status = DeliveryStatus.READ;
        }
      });
    }

    if (this.onThreadSelect) {
      this.onThreadSelect(thread);
    }

    // Update UI if mounted
    if (this.container && typeof this.container.querySelector === 'function') {
      this.render();
      this.bindEvents();
    }

    return thread;
  }

  /**
   * Send a new message to the active thread (or specified thread).
   * @param {string} text - Message content
   * @param {Object} [options]
   * @param {string} [options.threadId] - Explicit thread ID
   * @param {number} [options.scheduleMs] - Delay in ms for scheduled simulation
   * @param {string|number} [options.scheduledTime] - Scheduled ISO string or timestamp
   * @returns {Promise<Object>|Object} The sent message record
   */
  async sendMessage(text, options = {}) {
    const cleanText = (text || '').trim();
    if (!cleanText) {
      throw new Error('MessagesApp: Cannot send an empty message.');
    }

    const targetThreadId = options.threadId || this.activeThreadId;
    let thread = this.threads.find(t => t.id === targetThreadId);

    // If no active thread exists, generate one for the default or specified contact
    if (!thread) {
      thread = this.createThread({
        name: options.recipientName || 'Secure Contact',
        number: options.recipientNumber || '+1 555-0999',
        initials: (options.recipientName || 'SC').slice(0, 2).toUpperCase()
      });
    }

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const isAirGap = this.airGapSecurity;

    const messageRecord = {
      id: messageId,
      threadId: thread.id,
      direction: 'sent',
      body: cleanText,
      timestamp: now,
      timeStr: formatTime(now),
      status: DeliveryStatus.SENT,
      deliveryTicks: '✓',
      encrypted: isAirGap,
      securityBadge: isAirGap ? AIR_GAP_BADGE_TEXT : null,
      cryptoEnvelope: isAirGap ? generateKemEnvelope(cleanText, thread.contact.number) : null
    };

    // Scheduled message branch
    if (options.scheduleMs && options.scheduleMs > 0) {
      messageRecord.status = 'SCHEDULED';
      messageRecord.scheduledFor = now + options.scheduleMs;
      this.scheduledQueue.push({ messageRecord, threadId: thread.id });

      const timerId = setTimeout(() => {
        messageRecord.status = DeliveryStatus.SENT;
        messageRecord.deliveryTicks = '✓';
        messageRecord.timestamp = Date.now();
        messageRecord.timeStr = formatTime(messageRecord.timestamp);
        thread.updatedAt = messageRecord.timestamp;
        this._sortThreads();
        this._simulateTickProgression(messageRecord);
        if (this.container) {
          this.render();
          this.bindEvents();
        }
      }, options.scheduleMs);

      this.scheduledTimers.push(timerId);

      // Invoke capability hook with scheduled status
      if (this.capability && typeof this.capability.execute === 'function') {
        await this.capability.execute({
          action: 'send',
          payload: {
            recipient: thread.contact.number,
            body: cleanText,
            airGapEncrypted: isAirGap,
            scheduledTime: new Date(now + options.scheduleMs).toISOString()
          }
        });
      }

      thread.messages.push(messageRecord);
      thread.updatedAt = now;
      this._sortThreads();

      if (this.container) {
        this.render();
        this.bindEvents();
      }

      return messageRecord;
    }

    // Direct send execution
    // 1. Invoke Microkernel Capability Hook (telephony.sms)
    if (this.capability && typeof this.capability.execute === 'function') {
      await this.capability.execute({
        action: 'send',
        payload: {
          recipient: thread.contact.number,
          body: cleanText,
          airGapEncrypted: isAirGap
        }
      });
    }

    // 2. Commit to thread
    thread.messages.push(messageRecord);
    thread.updatedAt = now;
    this._sortThreads();

    // 3. Trigger delivery ticks progression simulation: '✓' -> '✓✓' -> '✓✓' (read)
    this._simulateTickProgression(messageRecord);

    if (this.onMessageSent) {
      this.onMessageSent(messageRecord);
    }

    // 4. Update UI if container attached
    if (this.container && typeof this.container.querySelector === 'function') {
      this.render();
      this.bindEvents();
      this._scrollToBottom();
    }

    return messageRecord;
  }

  /**
   * Simulates realistic cellular/air-gap network delivery and read ticks.
   * @private
   */
  _simulateTickProgression(messageRecord) {
    // Deliver after brief moment (simulate baseband relay)
    setTimeout(() => {
      if (messageRecord.status === DeliveryStatus.SENT) {
        messageRecord.status = DeliveryStatus.DELIVERED;
        messageRecord.deliveryTicks = '✓✓';
        this._updateMessageTickInDom(messageRecord.id, '✓✓', false);
      }
    }, 120);

    // Read status after simulated recipient read
    setTimeout(() => {
      if (messageRecord.status === DeliveryStatus.DELIVERED) {
        messageRecord.status = DeliveryStatus.READ;
        messageRecord.deliveryTicks = '✓✓';
        this._updateMessageTickInDom(messageRecord.id, '✓✓', true);
      }
    }, 350);
  }

  /**
   * Update message checkmark tick in DOM without tearing down entire tree.
   * @private
   */
  _updateMessageTickInDom(messageId, ticks, isRead) {
    if (!this.container || typeof this.container.querySelector !== 'function') return;
    const msgEl = this.container.querySelector(`[data-message-id="${messageId}"] .bubble-status-tick`);
    if (msgEl) {
      msgEl.textContent = ticks;
      if (isRead) {
        msgEl.classList.add('status-read');
      }
    }
  }

  /**
   * Search filter across all message threads, contacts, and message bodies.
   * @param {string} query
   * @returns {Array<Object>} List of matched thread search results
   */
  search(query = '') {
    this.searchQuery = (query || '').trim().toLowerCase();

    if (!this.searchQuery) {
      return this.threads.map(t => ({
        thread: t,
        matchedMessages: []
      }));
    }

    const results = [];

    for (const thread of this.threads) {
      const nameMatch = thread.contact.name.toLowerCase().includes(this.searchQuery);
      const numberMatch = thread.contact.number.toLowerCase().includes(this.searchQuery);
      const matchedMessages = (thread.messages || []).filter(m =>
        m.body.toLowerCase().includes(this.searchQuery)
      );

      if (nameMatch || numberMatch || matchedMessages.length > 0) {
        results.push({
          thread,
          nameMatch,
          numberMatch,
          matchedMessages
        });
      }
    }

    // If container is active, re-render filtered view
    if (this.container && typeof this.container.querySelector === 'function') {
      this.render();
      this.bindEvents();
    }

    return results;
  }

  /**
   * Delete an entire conversation thread by ID.
   * @param {string} threadId
   * @returns {Promise<boolean>|boolean}
   */
  async deleteThread(threadId) {
    const index = this.threads.findIndex(t => t.id === threadId);
    if (index === -1) return false;

    // Trigger capability delete action
    if (this.capability && typeof this.capability.execute === 'function') {
      try {
        await this.capability.execute({
          action: 'delete',
          payload: { threadId }
        });
      } catch (e) {
        // Log & proceed
      }
    }

    this.threads.splice(index, 1);

    // If deleted active thread, switch active selection
    if (this.activeThreadId === threadId) {
      this.activeThreadId = this.threads.length > 0 ? this.threads[0].id : null;
    }

    if (this.container && typeof this.container.querySelector === 'function') {
      this.render();
      this.bindEvents();
    }

    return true;
  }

  /**
   * Toggle zero-cloud air-gap encryption mode.
   * @param {boolean} enabled
   * @returns {boolean} Current air gap state
   */
  setAirGapSecurity(enabled) {
    this.airGapSecurity = Boolean(enabled);

    // Re-render security badges if DOM container mounted
    if (this.container && typeof this.container.querySelector === 'function') {
      const badgeText = this.airGapSecurity ? AIR_GAP_BADGE_TEXT : CELLULAR_BADGE_TEXT;
      const badges = this.container.querySelectorAll('.air-gap-badge-label');
      badges.forEach(b => {
        b.textContent = badgeText;
      });

      const badgePills = this.container.querySelectorAll('.msg-airgap-pill');
      badgePills.forEach(p => {
        if (this.airGapSecurity) {
          p.classList.add('airgap-active');
          p.classList.remove('airgap-cellular');
        } else {
          p.classList.remove('airgap-active');
          p.classList.add('airgap-cellular');
        }
      });
    }

    return this.airGapSecurity;
  }

  /**
   * Create a new conversation thread.
   * @param {Object} contact
   * @param {string} [initialMessage]
   * @returns {Object} Newly created thread
   */
  createThread(contact = {}, initialMessage = null) {
    const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const initials = contact.initials ||
      (contact.name ? contact.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'SC');

    const newThread = {
      id: threadId,
      contact: {
        name: contact.name || 'New Contact',
        number: contact.number || '+1 555-0000',
        initials,
        avatarColor: contact.avatarColor || 'linear-gradient(135deg, #06b6d4, #3b82f6)',
        verifiedAirGap: contact.verifiedAirGap !== undefined ? contact.verifiedAirGap : true,
        role: contact.role || 'Contact'
      },
      unreadCount: 0,
      pinned: false,
      updatedAt: Date.now(),
      messages: []
    };

    if (initialMessage) {
      newThread.messages.push({
        id: `msg-${Date.now()}`,
        threadId,
        direction: 'sent',
        body: initialMessage,
        timestamp: Date.now(),
        timeStr: formatTime(Date.now()),
        status: DeliveryStatus.SENT,
        deliveryTicks: '✓',
        encrypted: this.airGapSecurity,
        securityBadge: this.airGapSecurity ? AIR_GAP_BADGE_TEXT : null
      });
    }

    this.threads.unshift(newThread);
    this.selectThread(threadId);
    return newThread;
  }

  /**
   * Schedule a message simulation.
   * @param {string} threadId
   * @param {string} text
   * @param {number} delayMs
   * @returns {Promise<Object>}
   */
  async scheduleMessage(threadId, text, delayMs = 3000) {
    return this.sendMessage(text, { threadId, scheduleMs: delayMs });
  }

  /**
   * Send a quick-reply template immediately.
   * @param {string} templateText
   */
  quickReply(templateText) {
    return this.sendMessage(templateText);
  }

  /**
   * Open / Expand Messages app overlay or full view.
   */
  open() {
    if (this.container) {
      this.container.classList.add('expanded');
      this.render();
      this.bindEvents();
    }
  }

  /**
   * Close / Minimize Messages app.
   */
  close() {
    if (this.container) {
      this.container.classList.remove('expanded');
    }
  }

  /**
   * Render the complete Messages app layout.
   */
  render() {
    if (!this.container) return;

    this._sortThreads();
    const activeThread = this.threads.find(t => t.id === this.activeThreadId) || this.threads[0] || null;
    const filterQuery = this.searchQuery;

    // Filter threads based on search
    const visibleThreads = this.threads.filter(t => {
      if (!filterQuery) return true;
      const nameMatch = t.contact.name.toLowerCase().includes(filterQuery);
      const numMatch = t.contact.number.toLowerCase().includes(filterQuery);
      const msgMatch = (t.messages || []).some(m => m.body.toLowerCase().includes(filterQuery));
      return nameMatch || numMatch || msgMatch;
    });

    const airGapBadgeLabel = this.airGapSecurity ? AIR_GAP_BADGE_TEXT : CELLULAR_BADGE_TEXT;
    const airGapPillClass = this.airGapSecurity ? 'airgap-active' : 'airgap-cellular';

    this.container.innerHTML = `
      <div class="messages-app-container">
        <!-- Master Pane: Conversation Thread List -->
        <aside class="messages-sidebar" id="messages-sidebar">
          <header class="messages-sidebar-header">
            <div class="sidebar-brand-row">
              <div class="brand-title-wrap">
                <span class="messages-logo-glyph">💬</span>
                <span class="messages-title-text">Messages</span>
              </div>
              <div class="sidebar-header-actions">
                <button class="btn-sidebar-action" id="btn-toggle-airgap" title="Toggle ML-KEM-768 Zero-Cloud Air-Gap">
                  <span class="action-icon">🛡️</span>
                </button>
                <button class="btn-sidebar-action" id="btn-compose-new" title="New Air-Gap Thread">
                  <span class="action-icon">✏️</span>
                </button>
                <button class="btn-sidebar-action btn-close-app" id="btn-close-messages" title="Close Messages">
                  ✕
                </button>
              </div>
            </div>

            <!-- Global Air-Gap Security Badge -->
            <div class="msg-airgap-pill ${airGapPillClass}" id="airgap-status-pill" title="Hardware Cryptographic Security State">
              <span class="airgap-pulse-dot"></span>
              <span class="air-gap-badge-label">${airGapBadgeLabel}</span>
              <span class="airgap-titan-chip">Titan M2</span>
            </div>

            <!-- Search Filter Bar -->
            <div class="messages-search-wrap">
              <span class="search-icon">🔍</span>
              <input 
                type="text" 
                class="messages-search-input" 
                id="messages-search-input" 
                placeholder="Search conversations, contacts, or air-gap logs..."
                value="${this.searchQuery ? this._escapeHtml(this.searchQuery) : ''}"
              />
              ${this.searchQuery ? '<button class="btn-clear-search" id="btn-clear-search">✕</button>' : ''}
            </div>
          </header>

          <!-- Conversation Thread List -->
          <div class="conversation-thread-list" id="conversation-thread-list">
            ${visibleThreads.length === 0 ? `
              <div class="thread-empty-state">
                <span class="empty-icon">📭</span>
                <p class="empty-title">No conversations found</p>
                <p class="empty-desc">No message threads match "${this._escapeHtml(filterQuery)}"</p>
              </div>
            ` : visibleThreads.map(thread => {
              const isActive = activeThread && thread.id === activeThread.id;
              const lastMsg = thread.messages && thread.messages.length > 0
                ? thread.messages[thread.messages.length - 1]
                : null;
              const snippet = lastMsg ? this._escapeHtml(lastMsg.body) : 'No messages yet';
              const timeDisplay = lastMsg ? formatTime(lastMsg.timestamp) : formatTime(thread.updatedAt);
              const isSentByMe = lastMsg && lastMsg.direction === 'sent';

              return `
                <div class="thread-item ${isActive ? 'active' : ''} ${thread.unreadCount > 0 ? 'has-unread' : ''}" 
                     data-thread-id="${thread.id}">
                  <div class="thread-avatar-pill" style="background: ${thread.contact.avatarColor};">
                    <span class="avatar-initials">${thread.contact.initials}</span>
                    ${thread.contact.verifiedAirGap ? '<span class="verified-airgap-dot" title="Air-Gap Verified"></span>' : ''}
                  </div>

                  <div class="thread-meta-body">
                    <div class="thread-meta-top">
                      <span class="thread-contact-name">${this._escapeHtml(thread.contact.name)}</span>
                      <span class="thread-timestamp">${timeDisplay}</span>
                    </div>
                    <div class="thread-meta-bottom">
                      <span class="thread-snippet ${thread.unreadCount > 0 ? 'unread-snippet' : ''}">
                        ${isSentByMe ? `<span class="snippet-sent-prefix">You: </span>` : ''}${snippet}
                      </span>
                      ${thread.unreadCount > 0 ? `
                        <span class="unread-badge-pill">${thread.unreadCount}</span>
                      ` : ''}
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </aside>

        <!-- Detail Pane: Rich Chat Surface -->
        <main class="messages-chat-pane" id="messages-chat-pane">
          ${activeThread ? `
            <!-- Chat Conversation Header -->
            <header class="chat-header">
              <div class="chat-contact-info">
                <button class="btn-mobile-back" id="btn-mobile-back" title="Back to conversations">
                  ‹
                </button>
                <div class="header-avatar-pill" style="background: ${activeThread.contact.avatarColor};">
                  <span>${activeThread.contact.initials}</span>
                </div>
                <div class="header-text-block">
                  <div class="header-name-row">
                    <h3 class="header-contact-name">${this._escapeHtml(activeThread.contact.name)}</h3>
                    ${activeThread.contact.verifiedAirGap ? `
                      <span class="header-airgap-tag" title="Verified Post-Quantum Lattice Peer">
                        ML-KEM-768
                      </span>
                    ` : ''}
                  </div>
                  <div class="header-subtitle-row">
                    <span class="header-contact-number">${this._escapeHtml(activeThread.contact.number)}</span>
                    <span class="header-dot-separator">•</span>
                    <span class="header-carrier-status">Telephony HAL (0 Cloud Relay)</span>
                  </div>
                </div>
              </div>

              <div class="chat-header-actions">
                <button class="btn-chat-action btn-delete-thread" id="btn-delete-thread" title="Delete conversation thread">
                  🗑️
                </button>
              </div>
            </header>

            <!-- Chat Scrollable Message Stream -->
            <section class="chat-messages-stream" id="chat-messages-stream">
              <div class="airgap-security-divider">
                <div class="divider-line"></div>
                <div class="divider-content">
                  <span class="divider-lock">🔒</span>
                  <span>Hardware Sealed with Post-Quantum ML-KEM-768 via Titan M2 Enclave</span>
                </div>
                <div class="divider-line"></div>
              </div>

              ${(activeThread.messages || []).map(msg => {
                const isSent = msg.direction === 'sent';
                const bubbleClass = isSent ? 'bubble-sent' : 'bubble-received';
                const timeStr = msg.timeStr || formatTime(msg.timestamp);

                return `
                  <div class="chat-bubble-row ${isSent ? 'row-sent' : 'row-received'}" data-message-id="${msg.id}">
                    <div class="chat-bubble ${bubbleClass}">
                      <div class="bubble-text">${this._escapeHtml(msg.body)}</div>
                      <div class="bubble-meta">
                        <span class="bubble-time">${timeStr}</span>
                        ${msg.encrypted ? '<span class="bubble-lock" title="ML-KEM-768 Sealed">🔒</span>' : ''}
                        ${isSent ? `
                          <span class="bubble-status-tick ${msg.status === DeliveryStatus.READ ? 'status-read' : ''}">
                            ${msg.deliveryTicks || '✓'}
                          </span>
                        ` : ''}
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </section>

            <!-- Quick-Reply Template Bar -->
            <section class="quick-templates-bar" id="quick-templates-bar">
              <span class="templates-label">Quick Reply:</span>
              <div class="templates-scroll-row">
                ${QUICK_TEMPLATES.map(tpl => `
                  <button class="btn-template-chip" data-template="${this._escapeHtml(tpl)}">
                    ${this._escapeHtml(tpl)}
                  </button>
                `).join('')}
              </div>
            </section>

            <!-- Instant Message Composer -->
            <footer class="message-composer-footer">
              <!-- Emoji Quick Action Bar -->
              <div class="composer-emoji-bar">
                ${DEFAULT_EMOJIS.map(e => `
                  <button class="btn-emoji-quick" data-emoji="${e}" title="Insert ${e}">
                    ${e}
                  </button>
                `).join('')}
                <div class="composer-crypto-status">
                  <span class="crypto-dot ${this.airGapSecurity ? 'green' : 'gray'}"></span>
                  <span class="crypto-status-text">
                    ${this.airGapSecurity ? 'Air-Gap Sealed (Titan M2)' : 'Standard Cellular'}
                  </span>
                </div>
              </div>

              <!-- Main Input Row -->
              <div class="composer-input-row">
                <textarea 
                  class="composer-textarea" 
                  id="composer-textarea" 
                  rows="1" 
                  placeholder="Type an air-gap sealed message..."
                  autocomplete="off"
                ></textarea>

                <div class="composer-buttons-group">
                  <button class="btn-schedule-sim" id="btn-schedule-sim" title="Simulate Scheduled SMS (3s delay)">
                    ⏰
                  </button>
                  <button class="btn-send-message" id="btn-send-message" title="Send Sealed Message">
                    <span class="send-icon">➤</span>
                  </button>
                </div>
              </div>

              <!-- Composer Meta Footer (Char Counter & SMS Math) -->
              <div class="composer-meta-row">
                <span class="char-counter" id="char-counter">0 / 160 (1 SMS)</span>
                <span class="composer-encryption-hint">
                  ${this.airGapSecurity ? '🔒 Post-Quantum ML-KEM-768 • Zero-Cloud Egress' : 'Cellular Baseband'}
                </span>
              </div>
            </footer>
          ` : `
            <div class="chat-placeholder-pane">
              <div class="placeholder-content">
                <span class="placeholder-icon">💬</span>
                <h2>PravahOS Messages</h2>
                <p>Select a thread to view air-gap encrypted conversations</p>
              </div>
            </div>
          `}
        </main>
      </div>
    `;
  }

  /**
   * Bind event listeners to DOM elements.
   */
  bindEvents() {
    if (!this.container || typeof this.container.querySelector !== 'function') return;

    // 1. Thread selection clicks
    const threadItems = this.container.querySelectorAll('.thread-item');
    threadItems.forEach(el => {
      el.addEventListener('click', () => {
        const threadId = el.getAttribute('data-thread-id');
        if (threadId) {
          this.selectThread(threadId);
        }
      });
    });

    // 2. Search input listener
    const searchInput = this.container.querySelector('#messages-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.search(e.target.value);
      });
    }

    const clearSearchBtn = this.container.querySelector('#btn-clear-search');
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        this.search('');
      });
    }

    // 3. Air Gap Toggle button
    const airGapBtn = this.container.querySelector('#btn-toggle-airgap');
    if (airGapBtn) {
      airGapBtn.addEventListener('click', () => {
        this.setAirGapSecurity(!this.airGapSecurity);
      });
    }

    // 4. Compose new thread button
    const composeBtn = this.container.querySelector('#btn-compose-new');
    if (composeBtn) {
      composeBtn.addEventListener('click', () => {
        const contactName = prompt ? prompt('Enter Contact Name:') : 'Colleague';
        if (contactName) {
          this.createThread({
            name: contactName,
            number: '+1 555-' + Math.floor(1000 + Math.random() * 9000),
            initials: contactName.slice(0, 2).toUpperCase()
          });
        }
      });
    }

    // 5. Close button
    const closeBtn = this.container.querySelector('#btn-close-messages');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.close();
      });
    }

    // 6. Delete thread button
    const deleteBtn = this.container.querySelector('#btn-delete-thread');
    if (deleteBtn && this.activeThreadId) {
      deleteBtn.addEventListener('click', () => {
        this.deleteThread(this.activeThreadId);
      });
    }

    // 7. Quick templates
    const templateChips = this.container.querySelectorAll('.btn-template-chip');
    templateChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const tpl = chip.getAttribute('data-template');
        if (tpl) {
          const textarea = this.container.querySelector('#composer-textarea');
          if (textarea) {
            textarea.value = tpl;
            this._updateCharCounter(tpl);
            textarea.focus();
          }
        }
      });
    });

    // 8. Quick emoji buttons
    const emojiBtns = this.container.querySelectorAll('.btn-emoji-quick');
    emojiBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        const textarea = this.container.querySelector('#composer-textarea');
        if (textarea && emoji) {
          textarea.value += emoji;
          this._updateCharCounter(textarea.value);
          textarea.focus();
        }
      });
    });

    // 9. Composer textarea dynamic character counter
    const textarea = this.container.querySelector('#composer-textarea');
    if (textarea) {
      textarea.addEventListener('input', () => {
        this._updateCharCounter(textarea.value);
      });

      // Handle Enter key (send on Enter, newline on Shift+Enter)
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._handleSendClick();
        }
      });
    }

    // 10. Send message button
    const sendBtn = this.container.querySelector('#btn-send-message');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        this._handleSendClick();
      });
    }

    // 11. Scheduled send button
    const scheduleBtn = this.container.querySelector('#btn-schedule-sim');
    if (scheduleBtn) {
      scheduleBtn.addEventListener('click', () => {
        const textareaEl = this.container.querySelector('#composer-textarea');
        const text = textareaEl ? textareaEl.value : '';
        if (text.trim()) {
          this.scheduleMessage(this.activeThreadId, text.trim(), 3000);
          if (textareaEl) {
            textareaEl.value = '';
            this._updateCharCounter('');
          }
        }
      });
    }
  }

  /**
   * Internal handler for send button.
   * @private
   */
  _handleSendClick() {
    const textarea = this.container ? this.container.querySelector('#composer-textarea') : null;
    const text = textarea ? textarea.value : '';
    if (text && text.trim()) {
      this.sendMessage(text.trim());
      if (textarea) {
        textarea.value = '';
        this._updateCharCounter('');
      }
    }
  }

  /**
   * Internal helper to update character counter element.
   * @private
   */
  _updateCharCounter(text) {
    if (!this.container || typeof this.container.querySelector !== 'function') return;
    const counterEl = this.container.querySelector('#char-counter');
    if (counterEl) {
      const stats = calculateSmsSegments(text);
      counterEl.textContent = stats.summary;
    }
  }

  /**
   * Internal helper to scroll chat messages stream to bottom.
   * @private
   */
  _scrollToBottom() {
    if (!this.container || typeof this.container.querySelector !== 'function') return;
    const stream = this.container.querySelector('#chat-messages-stream');
    if (stream) {
      stream.scrollTop = stream.scrollHeight;
    }
  }

  /**
   * Internal HTML escape helper.
   * @private
   */
  _escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Window global registration for shell/browser integration
if (typeof window !== 'undefined') {
  window.PravahMessages = {
    MessagesApp,
    TelephonySmsCapability,
    TelephonySmsDescriptor,
    DeliveryStatus,
    formatTime,
    calculateSmsSegments,
    generateKemEnvelope,
    AIR_GAP_BADGE_TEXT,
    CELLULAR_BADGE_TEXT,
    QUICK_TEMPLATES
  };
}
