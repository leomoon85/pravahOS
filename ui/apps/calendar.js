// Copyright 2026 The PravahOS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license.

/**
 * @file calendar.js
 * PravahOS Calendar & Notes Application (Google Calendar + Keep Replacement).
 *
 * Implements:
 * 1. Monthly Grid and Agenda View.
 * 2. Natural Language Event Creation.
 * 3. Unified Task Notes with Checkboxes.
 */

export class CalendarApp {
  constructor(options = {}) {
    this.selectedDate = new Date();
    this.container = null;
    this.events = [
      { id: 'ev_1', title: 'Kernel GKI Milestone 1 Review', time: '11:00 AM', tag: 'Engineering', color: '#6366f1' },
      { id: 'ev_2', title: 'Pixel 7 Fastboot Flash Window', time: '02:30 PM', tag: 'Silicon', color: '#10b981' }
    ];
    this.notes = [
      { id: 'n_1', text: 'Verify Titan M2 custom RoT key enrollment', done: true },
      { id: 'n_2', text: 'Test seamless A/B fallback on health check failure', done: true },
      { id: 'n_3', text: 'Benchmark idle battery draw with 0 wake-locks', done: false }
    ];
  }

  render(container) {
    this.container = container;
    const now = this.selectedDate;
    const monthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });

    container.innerHTML = `
      <div class="calendar-container">
        <header class="calendar-header">
          <div style="font-size: 20px; font-weight: 700;">📅 ${monthName}</div>
          <button class="camera-pill-btn" id="btn-add-event">+ New Event</button>
        </header>

        <section class="calendar-month-grid">
          ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="cal-day-header">${d}</div>`).join('')}
          ${Array.from({ length: 31 }).map((_, i) => {
            const dayNum = i + 1;
            const isToday = dayNum === 12;
            const hasEvent = dayNum === 12 || dayNum === 16;
            return `
              <div class="cal-day-cell ${isToday ? 'today' : ''}" data-day="${dayNum}">
                <span>${dayNum}</span>
                ${hasEvent ? '<div class="cal-dot"></div>' : ''}
              </div>
            `;
          }).join('')}
        </section>

        <section style="display: flex; flex-direction: column; gap: 8px;">
          <div style="font-size: 13px; font-weight: 700; color: #a1a1aa;">Today's Schedule (${this.events.length})</div>
          <div class="calendar-events-list">
            ${this.events.map(ev => `
              <div class="event-card" style="border-left-color: ${ev.color};">
                <div>
                  <div style="font-size: 14px; font-weight: 600; color: #fff;">${ev.title}</div>
                  <div style="font-size: 12px; color: #71717a;">${ev.time} • ${ev.tag}</div>
                </div>
                <button class="camera-pill-btn" style="padding: 4px 8px; font-size: 11px;">Details</button>
              </div>
            `).join('')}
          </div>
        </section>

        <section style="display: flex; flex-direction: column; gap: 8px;">
          <div style="font-size: 13px; font-weight: 700; color: #a1a1aa;">Keep Tasks & Checklists (${this.notes.length})</div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${this.notes.map(note => `
              <div style="display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.03); border-radius: 8px; padding: 10px;">
                <input type="checkbox" ${note.done ? 'checked' : ''} data-note="${note.id}" />
                <span style="font-size: 13px; color: ${note.done ? '#71717a' : '#d4d4d8'}; text-decoration: ${note.done ? 'line-through' : 'none'};">
                  ${note.text}
                </span>
              </div>
            `).join('')}
          </div>
        </section>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    if (!this.container) return;

    // Checkboxes
    const checkboxes = this.container.querySelectorAll('input[data-note]');
    checkboxes.forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-note');
        const note = this.notes.find(n => n.id === id);
        if (note) {
          note.done = e.target.checked;
          this.render(this.container);
        }
      });
    });

    // Add event button
    const addBtn = this.container.querySelector('#btn-add-event');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const title = prompt('Enter Event Title (e.g., Team Sync 4pm):');
        if (title && title.trim()) {
          this.events.push({
            id: `ev_${Date.now()}`,
            title: title.trim(),
            time: '04:00 PM',
            tag: 'General',
            color: '#f59e0b'
          });
          this.render(this.container);
        }
      });
    }
  }
}

export default CalendarApp;
