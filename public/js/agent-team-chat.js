/**
 * agent-team-chat.js — Chat panel for lead agent communication
 *
 * Renders chat bubbles, handles user input, connects via WebSocket
 * to the lead PTY session. Supports system messages and plan cards.
 */

'use strict';

class ChatPanel {
  constructor(container) {
    this.container = container;
    this.ws = null;
    this.onStatusChange = null; // callback(status)

    this.container.innerHTML = `
      <div class="chat-header">
        <h3>Chat with Lead Agent</h3>
        <span class="chat-status" id="chat-status-dot"></span>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-bar">
        <input type="text" id="chat-input" placeholder="Type a message to the lead..."
               autocomplete="off" spellcheck="false" />
        <button id="chat-send-btn" title="Send">▶</button>
      </div>
    `;

    this.messagesEl = this.container.querySelector('#chat-messages');
    this.inputEl = this.container.querySelector('#chat-input');
    this.sendBtn = this.container.querySelector('#chat-send-btn');
    this.statusDot = this.container.querySelector('#chat-status-dot');

    this.sendBtn.addEventListener('click', () => this._send());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
    });
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/lead-chat`);

    this.ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        this._handleEvent(evt);
      } catch {}
    };

    this.ws.onclose = () => {
      this._updateStatus('disconnected');
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {};
  }

  _handleEvent(evt) {
    switch (evt.type) {
      case 'lead:init':
        this._updateStatus(evt.status);
        if (evt.history) {
          this.messagesEl.innerHTML = '';
          for (const msg of evt.history) this._renderMessage(msg);
        }
        break;

      case 'lead:chat':
        if (evt.message) this._renderMessage(evt.message);
        break;

      case 'lead:status':
        this._updateStatus(evt.status);
        if (this.onStatusChange) this.onStatusChange(evt.status);
        break;

      case 'lead:plan':
        this._renderPlan(evt.plan);
        break;
    }
  }

  _send() {
    const text = this.inputEl.value.trim();
    if (!text || !this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'user_input', text }));
    this.inputEl.value = '';
    this.inputEl.focus();
  }

  _renderMessage(msg) {
    const el = document.createElement('div');
    el.className = `chat-bubble chat-${msg.role}`;

    const time = new Date(msg.ts).toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    const label = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Lead' : 'System';

    el.innerHTML = `
      <div class="chat-bubble-header">
        <span class="chat-label">${label}</span>
        <span class="chat-time">${time}</span>
      </div>
      <div class="chat-text">${this._renderMarkdown(msg.text)}</div>
    `;

    this.messagesEl.appendChild(el);
    this._trimMessages();
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  _renderPlan(plan) {
    const el = document.createElement('div');
    el.className = 'chat-bubble chat-plan';
    const tasksHtml = (plan.tasks || []).map(t =>
      `<li>${this._escapeHtml(t.title)} → <strong>${this._escapeHtml(t.assignee || '?')}</strong></li>`
    ).join('');

    el.innerHTML = `
      <div class="chat-bubble-header">
        <span class="chat-label">Plan</span>
      </div>
      <div class="chat-plan-body">
        <p>${this._escapeHtml(plan.summary || '')}</p>
        <ul>${tasksHtml}</ul>
      </div>
      <div class="chat-plan-actions">
        <button class="btn-approve" onclick="approvePlan()">Approve</button>
        <button class="btn-reject" onclick="rejectPlan()">Reject</button>
      </div>
    `;

    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  _updateStatus(status) {
    this.statusDot.className = 'chat-status';
    if (status === 'running') this.statusDot.classList.add('chat-status-running');
    else if (status === 'stopped') this.statusDot.classList.add('chat-status-stopped');
    else this.statusDot.classList.add('chat-status-disconnected');
  }

  _trimMessages() {
    while (this.messagesEl.children.length > 150) {
      this.messagesEl.removeChild(this.messagesEl.firstChild);
    }
  }

  _renderMarkdown(str) {
    if (!str) return '';
    // Escape HTML first
    let html = this._escapeHtml(str);
    // Code blocks (```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Headers
    html = html.replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>');
    html = html.replace(/^## (.+)$/gm, '<div class="md-h2">$1</div>');
    html = html.replace(/^# (.+)$/gm, '<div class="md-h1">$1</div>');
    // Unordered list items
    html = html.replace(/^[\s]*[-*] (.+)$/gm, '<div class="md-li">$1</div>');
    // Ordered list items
    html = html.replace(/^[\s]*\d+\. (.+)$/gm, '<div class="md-li md-ol">$1</div>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  _escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}
