/**
 * agent-team-cards.js — DOM card overlays for agent nodes
 *
 * Creates and manages glassmorphism card elements positioned
 * over canvas node positions. Handles status badges, current
 * task display, and expand modal.
 */

'use strict';

class CardManager {
  constructor(container, graphRenderer) {
    this.container = container; // positioned div overlaying canvas
    this.graph = graphRenderer;
    this.cards = new Map(); // agentId → DOM element

    // Reposition cards when nodes are dragged
    this.graph.onNodeMove = (agent) => this.positionCard(agent.id);
  }

  /** Create or update all cards from state */
  renderAll(agents) {
    for (const agent of agents) {
      if (this.cards.has(agent.id)) {
        this.updateCard(agent);
      } else {
        this.createCard(agent);
      }
    }
  }

  createCard(agent) {
    const el = document.createElement('div');
    el.className = 'agent-card';
    el.dataset.id = agent.id;
    el.innerHTML = this._cardHTML(agent);
    this.container.appendChild(el);
    this.cards.set(agent.id, el);
    this.positionCard(agent.id);

    // Click to expand
    el.addEventListener('click', (e) => {
      if (e.target.closest('.card-action')) return;
      this.showModal(agent);
    });
  }

  updateCard(agent) {
    const el = this.cards.get(agent.id);
    if (!el) return;
    el.innerHTML = this._cardHTML(agent);
    this.positionCard(agent.id);

    // Re-attach click
    el.onclick = (e) => {
      if (e.target.closest('.card-action')) return;
      this.showModal(agent);
    };
  }

  positionCard(agentId) {
    const el = this.cards.get(agentId);
    if (!el) return;
    const pos = this.graph.getNodePos(agentId);
    if (!pos) return;
    // Position card below the node circle
    el.style.left = (pos.x - 90) + 'px';
    el.style.top = (pos.y + 36) + 'px';
  }

  positionAll() {
    for (const id of this.cards.keys()) {
      this.positionCard(id);
    }
  }

  _cardHTML(agent) {
    const roleBadge = agent.role === 'lead'
      ? '<span class="badge badge-lead">TEAM LEAD</span>'
      : '<span class="badge badge-teammate">TEAMMATE</span>';

    const statusDot = `<span class="status-dot status-${agent.status}"></span>`;
    const statusText = agent.status;

    const taskLine = agent.currentTaskId
      ? `<div class="card-task">Working on task...</div>`
      : `<div class="card-task idle-text">No active task</div>`;

    return `
      <div class="card-header">
        ${roleBadge}
        <span class="card-status">${statusDot} ${statusText}</span>
      </div>
      <div class="card-name" style="color:${agent.color}">${esc(agent.name)}</div>
      <div class="card-desc">${esc(agent.description)}</div>
      ${taskLine}
    `;
  }

  /** Full-screen modal with agent details */
  showModal(agent) {
    const existing = document.getElementById('agent-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'agent-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content glass-panel">
        <div class="modal-header">
          <span class="badge ${agent.role === 'lead' ? 'badge-lead' : 'badge-teammate'}">
            ${agent.role === 'lead' ? 'TEAM LEAD' : 'TEAMMATE'}
          </span>
          <h2 style="color:${agent.color}">${esc(agent.name)}</h2>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-field"><label>Status</label><span class="status-dot status-${agent.status}"></span> ${agent.status}</div>
          <div class="modal-field"><label>Description</label>${esc(agent.description)}</div>
          <div class="modal-field"><label>Color</label><span style="color:${agent.color}">${agent.color}</span></div>
          <div class="modal-field"><label>Current Task</label>${agent.currentTaskId || 'None'}</div>
        </div>
        <div class="modal-actions">
          <button class="btn-action" onclick="window._toggleAgent('${agent.id}');this.closest('.modal-overlay').remove()">
            ${agent.status === 'running' ? 'Stop' : 'Start'} Agent
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
