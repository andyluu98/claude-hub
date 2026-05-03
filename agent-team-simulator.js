/**
 * agent-team-simulator.js — Demo simulator for Agent Team Visualizer
 *
 * Generates realistic agent activity (status changes, task progression,
 * inter-agent messages) on a configurable interval to drive the live UI.
 */

'use strict';

const { v4: uuid } = require('uuid');
const { getPreset, devTeam } = require('./agent-team-presets');

const BASE_INTERVAL_MS = 4000;

// ── Helpers ────────────────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand() { return Math.random(); }

function fillTemplate(tmpl, team, preset) {
  const tasks = team.tasks;
  const doneCount = tasks.filter(t => t.status === 'completed').length;
  const remainingCount = tasks.filter(t => t.status !== 'completed').length;
  const taskName = tasks.length ? pick(tasks).title : pick(preset.taskTemplates);

  return tmpl
    .replace('{task}', taskName)
    .replace('{pct}', String(Math.floor(Math.random() * 80) + 10))
    .replace('{component}', pick(preset.components))
    .replace('{done}', String(doneCount))
    .replace('{remaining}', String(remainingCount));
}

// ── AgentTeamSimulator ─────────────────────────────────────────────────────
class AgentTeamSimulator {
  /**
   * @param {object} team - shared team object from server-agent-team.js
   * @param {function} broadcastFn - function(event) to push updates to WS clients
   */
  constructor(team, broadcastFn) {
    this.team = team;
    this.broadcast = broadcastFn;
    this.multiplier = 1;
    this._timer = null;

    // Load preset templates (fallback to dev-team)
    this.preset = getPreset(team.presetId || 'dev-team') || devTeam;

    // Seed tasks only if none exist (team may already have defaults)
    if (!this.team.tasks.length) this._seedInitialTasks();
  }

  start() {
    if (this._timer) return; // already running
    this._scheduleNext();
  }

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  setSpeed(multiplier) {
    this.multiplier = multiplier;
    // Restart with new interval if running
    if (this._timer) {
      this.stop();
      this._scheduleNext();
    }
  }

  _scheduleNext() {
    const interval = Math.floor(BASE_INTERVAL_MS / this.multiplier);
    this._timer = setTimeout(() => {
      try { this.tick(); } catch (_) {}
      if (this._timer !== null) this._scheduleNext();
    }, interval);
  }

  tick() {
    const r = rand();
    if (r < 0.30) {
      this._toggleAgentStatus();
    } else if (r < 0.55) {
      this._progressTask();
    } else if (r < 0.80) {
      this._generateMessage();
    } else {
      this._claimPendingTask();
    }
  }

  // ── Action handlers ──────────────────────────────────────────────────────

  /** 30% — Toggle a random agent between idle and running */
  _toggleAgentStatus() {
    const agents = [...this.team.agents.values()];
    const agent = pick(agents);
    // Lead stays running when demo is active; only flip it occasionally
    if (agent.role === 'lead' && rand() > 0.2) return;

    agent.status = agent.status === 'running' ? 'idle' : 'running';
    this.broadcast({ type: 'agent-team:agent-update', agent: { ...agent } });
  }

  /** 25% — Advance one task through pending → in_progress → completed */
  _progressTask() {
    const { tasks } = this.team;

    // Try to find a task to advance
    const pending     = tasks.filter(t => t.status === 'pending');
    const inProgress  = tasks.filter(t => t.status === 'in_progress');

    let task = null;
    if (inProgress.length && (rand() > 0.3 || !pending.length)) {
      task = pick(inProgress);
      task.status = 'completed';
      // Free up the agent
      if (task.ownerId) {
        const agent = this.team.agents.get(task.ownerId);
        if (agent) { agent.currentTaskId = null; agent.status = 'idle'; }
      }
    } else if (pending.length) {
      task = pick(pending);
      task.status = 'in_progress';
      // Auto-assign to a free teammate if none assigned
      if (!task.ownerId) {
        const free = [...this.team.agents.values()].find(
          a => a.role === 'teammate' && !a.currentTaskId
        );
        if (free) {
          task.ownerId = free.id;
          free.currentTaskId = task.id;
          free.status = 'running';
          this.broadcast({ type: 'agent-team:agent-update', agent: { ...free } });
        }
      }
    } else {
      // No tasks — create one
      this._addRandomTask();
      return;
    }

    if (task) this.broadcast({ type: 'agent-team:task-updated', task: { ...task } });
  }

  /** 25% — Generate a realistic inter-agent message */
  _generateMessage() {
    const agents = [...this.team.agents.values()];
    const template = pick(this.preset.messageTemplates);

    let sender;
    if (template.from === 'lead') {
      sender = agents.find(a => a.role === 'lead') || pick(agents);
    } else {
      sender = pick(agents);
    }

    const others = agents.filter(a => a.id !== sender.id);
    const recipient = rand() > 0.4 ? pick(others) : null; // null = broadcast

    const content = fillTemplate(template.tmpl, this.team, this.preset);

    const msg = {
      id: uuid(),
      fromId: sender.id,
      toId: recipient ? recipient.id : null,
      content,
      type: recipient ? 'message' : 'broadcast',
      timestamp: new Date().toISOString(),
    };

    this.team.messages.push(msg);
    if (this.team.messages.length > 200) {
      this.team.messages.splice(0, this.team.messages.length - 200);
    }

    this.broadcast({ type: 'agent-team:message', message: msg });
  }

  /** 20% — An agent claims an unclaimed pending task */
  _claimPendingTask() {
    const unclaimed = this.team.tasks.filter(t => t.status === 'pending' && !t.ownerId);
    if (!unclaimed.length) {
      this._addRandomTask();
      return;
    }

    const freeAgents = [...this.team.agents.values()].filter(
      a => a.role === 'teammate' && !a.currentTaskId
    );
    if (!freeAgents.length) return;

    const task  = pick(unclaimed);
    const agent = pick(freeAgents);

    task.ownerId = agent.id;
    agent.currentTaskId = task.id;
    agent.status = 'running';

    this.broadcast({ type: 'agent-team:task-updated', task: { ...task } });
    this.broadcast({ type: 'agent-team:agent-update', agent: { ...agent } });
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  _addRandomTask() {
    // Avoid duplicating titles already present
    const existing = new Set(this.team.tasks.map(t => t.title));
    const candidates = this.preset.taskTemplates.filter(t => !existing.has(t));
    if (!candidates.length) return;

    const task = {
      id: uuid(),
      title: pick(candidates),
      description: '',
      status: 'pending',
      ownerId: null,
      dependencies: [],
      createdAt: new Date().toISOString(),
    };
    this.team.tasks.push(task);
    this.broadcast({ type: 'agent-team:task-created', task: { ...task } });
  }

  _seedInitialTasks() {
    const seed = this.preset.taskTemplates.slice(0, 4);
    for (const title of seed) {
      this.team.tasks.push({
        id: uuid(),
        title,
        description: '',
        status: 'pending',
        ownerId: null,
        dependencies: [],
        createdAt: new Date().toISOString(),
      });
    }
  }
}

module.exports = { AgentTeamSimulator };
