/**
 * agent-team-tasks.js — Task queue panel + message timeline
 *
 * Manages the right sidebar task list and bottom message log.
 * Receives updates from WebSocket events and triggers particle
 * animations on the canvas graph.
 */

'use strict';

class TaskPanel {
  constructor(container, agentMap) {
    this.container = container;
    this.agentMap = agentMap; // Map or object: id → agent
  }

  render(tasks) {
    const sorted = [...tasks].sort((a, b) => {
      const order = { in_progress: 0, pending: 1, completed: 2 };
      return (order[a.status] ?? 1) - (order[b.status] ?? 1);
    });

    this.container.innerHTML = `
      <div class="panel-header">
        <h3>Task Queue</h3>
        <span class="task-count">${tasks.length} tasks</span>
      </div>
      <div class="task-list">
        ${sorted.map(t => this._taskRow(t)).join('')}
      </div>
    `;
  }

  updateTask(task, allTasks) {
    this.render(allTasks);
  }

  _taskRow(task) {
    const icons = {
      pending: '○',
      in_progress: '◐',
      completed: '●',
    };
    const icon = icons[task.status] || '○';
    const ownerAgent = task.ownerId ? this.agentMap[task.ownerId] : null;
    const ownerName = ownerAgent ? ownerAgent.name : '—';
    const completedClass = task.status === 'completed' ? 'task-completed' : '';
    const activeClass = task.status === 'in_progress' ? 'task-active' : '';

    return `
      <div class="task-row ${completedClass} ${activeClass}">
        <span class="task-icon task-icon-${task.status}">${icon}</span>
        <div class="task-info">
          <div class="task-title">${esc(task.title)}</div>
          <div class="task-owner">${esc(ownerName)} · ${task.status.replace('_', ' ')}</div>
        </div>
      </div>
    `;
  }
}

class MessageTimeline {
  constructor(container, agentMap, graphRenderer) {
    this.container = container;
    this.agentMap = agentMap;
    this.graph = graphRenderer;
    this.maxMessages = 80;

    this.container.innerHTML = `
      <div class="panel-header">
        <h3>Messages</h3>
      </div>
      <div class="msg-list"></div>
    `;
    this.listEl = this.container.querySelector('.msg-list');
  }

  append(msg) {
    const from = this.agentMap[msg.fromId];
    const to = msg.toId ? this.agentMap[msg.toId] : null;
    const fromName = from ? from.name : 'Unknown';
    const toName = to ? to.name : '[all]';
    const time = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const color = from ? from.color : '#888';

    const row = document.createElement('div');
    row.className = 'msg-row';
    row.innerHTML = `
      <span class="msg-time">${time}</span>
      <span class="msg-from" style="color:${color}">${esc(fromName)}</span>
      <span class="msg-arrow">→</span>
      <span class="msg-to">${esc(toName)}</span>
      <span class="msg-content">${esc(msg.content)}</span>
    `;
    this.listEl.appendChild(row);

    // Trim old messages
    while (this.listEl.children.length > this.maxMessages) {
      this.listEl.removeChild(this.listEl.firstChild);
    }

    // Auto-scroll
    this.listEl.scrollTop = this.listEl.scrollHeight;

    // Trigger particle animation on graph
    if (this.graph && msg.fromId && msg.toId) {
      this.graph.addParticle(msg.fromId, msg.toId, color);
    } else if (this.graph && msg.fromId && !msg.toId) {
      // Broadcast: animate to all other agents
      const others = Object.keys(this.agentMap).filter(id => id !== msg.fromId);
      for (const toId of others) {
        this.graph.addParticle(msg.fromId, toId, color);
      }
    }
  }
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
