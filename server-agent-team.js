/**
 * server-agent-team.js — Agent Team Visualizer backend module
 *
 * Provides in-memory team state, REST endpoints, and WebSocket broadcast
 * for the agent team visualization feature.
 *
 * CSRF note: this router is mounted under /api in server.js which already
 * applies CSRF origin checks via app.use('/api', csrfMiddleware) before this
 * router is reached. No additional CSRF handling needed here.
 */

'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');
const { getPreset, listPresets } = require('./agent-team-presets');

// ── Data model ─────────────────────────────────────────────────────────────
// Agent:   { id, role, name, description, status, currentTaskId, position, color }
// Task:    { id, title, description, status, ownerId, dependencies, createdAt }
// Message: { id, fromId, toId, content, type, timestamp }
// Team:    { id, name, status, presetId, agents:Map<id,Agent>, tasks:[], messages:[], createdAt }

// ── Team factory ───────────────────────────────────────────────────────────
function createTeamFromPreset(presetId) {
  const preset = getPreset(presetId);
  if (!preset) return null;

  const agents = new Map();
  for (const a of preset.agents) {
    agents.set(a.id, { ...a, status: 'idle', currentTaskId: null });
  }

  const tasks = (preset.initialTasks || []).map(title => ({
    id: uuid(),
    title,
    description: '',
    status: 'pending',
    ownerId: null,
    dependencies: [],
    createdAt: new Date().toISOString(),
  }));

  return {
    id: uuid(),
    name: preset.name,
    presetId: preset.id,
    status: 'stopped',
    agents,
    tasks,
    messages: [],
    createdAt: new Date().toISOString(),
  };
}

function createDefaultTeam() {
  return createTeamFromPreset('dev-team');
}

const team = createDefaultTeam();

// ── Serialization helpers ──────────────────────────────────────────────────
function serializeTeam(t) {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    agents: [...t.agents.values()],
    tasks: t.tasks,
    messages: t.messages.slice(-100), // cap messages to last 100
    createdAt: t.createdAt,
  };
}

// ── WebSocket broadcast ────────────────────────────────────────────────────
const wsClients = new Set();

function broadcastTeamUpdate(event) {
  const payload = JSON.stringify(event);
  for (const ws of wsClients) {
    try {
      if (ws.readyState === 1 /* OPEN */) ws.send(payload);
    } catch (_) {
      wsClients.delete(ws);
    }
  }
}

function handleAgentTeamWs(ws) {
  wsClients.add(ws);
  try {
    ws.send(JSON.stringify({ type: 'agent-team:init', team: serializeTeam(team) }));
  } catch (_) {}
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
}

// ── Simulator integration (lazy-loaded to avoid circular dep) ─────────────
let simulator = null;
let tracker = null;
let activeMode = 'none'; // 'none' | 'demo' | 'real'

function getSimulator() {
  if (!simulator) {
    const { AgentTeamSimulator } = require('./agent-team-simulator');
    simulator = new AgentTeamSimulator(team, broadcastTeamUpdate);
  }
  return simulator;
}

function getTracker() {
  if (!tracker) {
    const { AgentTracker } = require('./server-agent-tracker');
    tracker = new AgentTracker(broadcastTeamUpdate);
  }
  return tracker;
}

// ── Router ─────────────────────────────────────────────────────────────────
const router = express.Router();

// GET /api/agent-team/state
router.get('/agent-team/state', (_req, res) => {
  res.json(serializeTeam(team));
});

// POST /api/agent-team/agent/:id/toggle
router.post('/agent-team/agent/:id/toggle', (req, res) => {
  const agent = team.agents.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const cycle = { idle: 'running', running: 'stopped', stopped: 'idle', error: 'idle' };
  agent.status = cycle[agent.status] || 'idle';

  broadcastTeamUpdate({ type: 'agent-team:agent-update', agent });
  res.json({ agent });
});

// POST /api/agent-team/task  { title, description }
router.post('/agent-team/task', (req, res) => {
  const { title, description = '' } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const task = {
    id: uuid(),
    title: title.trim(),
    description: description.trim(),
    status: 'pending',
    ownerId: null,
    dependencies: [],
    createdAt: new Date().toISOString(),
  };
  team.tasks.push(task);
  broadcastTeamUpdate({ type: 'agent-team:task-created', task });
  res.status(201).json({ task });
});

// POST /api/agent-team/task/:id/assign  { ownerId }
router.post('/agent-team/task/:id/assign', (req, res) => {
  const task = team.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { ownerId } = req.body || {};
  if (ownerId && !team.agents.has(ownerId)) {
    return res.status(400).json({ error: 'Agent not found' });
  }
  // Unassign previous owner
  if (task.ownerId) {
    const prev = team.agents.get(task.ownerId);
    if (prev && prev.currentTaskId === task.id) prev.currentTaskId = null;
  }
  task.ownerId = ownerId || null;
  if (ownerId) {
    const agent = team.agents.get(ownerId);
    if (agent) agent.currentTaskId = task.id;
  }
  broadcastTeamUpdate({ type: 'agent-team:task-updated', task });
  res.json({ task });
});

// POST /api/agent-team/message  { fromId, toId, content }
router.post('/agent-team/message', (req, res) => {
  const { fromId, toId, content } = req.body || {};
  if (!fromId || !content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'fromId and content are required' });
  }
  if (!team.agents.has(fromId)) return res.status(400).json({ error: 'fromId agent not found' });
  if (toId && !team.agents.has(toId)) return res.status(400).json({ error: 'toId agent not found' });

  const msg = {
    id: uuid(),
    fromId,
    toId: toId || null,
    content: content.trim(),
    type: toId ? 'message' : 'broadcast',
    timestamp: new Date().toISOString(),
  };
  team.messages.push(msg);
  if (team.messages.length > 200) team.messages.splice(0, team.messages.length - 200);

  broadcastTeamUpdate({ type: 'agent-team:message', message: msg });
  res.status(201).json({ message: msg });
});

// POST /api/agent-team/demo/start
router.post('/agent-team/demo/start', (_req, res) => {
  // Stop real tracker if running
  if (activeMode === 'real' && tracker) tracker.stop();
  const sim = getSimulator();
  sim.start();
  activeMode = 'demo';
  team.status = 'running';
  broadcastTeamUpdate({ type: 'agent-team:team-status', status: 'running', mode: 'demo' });
  res.json({ status: 'started', mode: 'demo' });
});

// POST /api/agent-team/demo/stop
router.post('/agent-team/demo/stop', (_req, res) => {
  const sim = getSimulator();
  sim.stop();
  activeMode = 'none';
  team.status = 'stopped';
  broadcastTeamUpdate({ type: 'agent-team:team-status', status: 'stopped', mode: 'none' });
  res.json({ status: 'stopped' });
});

// POST /api/agent-team/demo/speed  { multiplier: 1|2|5 }
router.post('/agent-team/demo/speed', (req, res) => {
  const { multiplier } = req.body || {};
  const valid = [1, 2, 5];
  if (!valid.includes(Number(multiplier))) {
    return res.status(400).json({ error: 'multiplier must be 1, 2, or 5' });
  }
  getSimulator().setSpeed(Number(multiplier));
  res.json({ multiplier: Number(multiplier) });
});

// POST /api/agent-team/real/start — start tracking real Claude Code sessions
router.post('/agent-team/real/start', (_req, res) => {
  // Stop demo if running
  if (activeMode === 'demo' && simulator) simulator.stop();
  const t = getTracker();
  t.start();
  activeMode = 'real';
  team.status = 'running';
  broadcastTeamUpdate({ type: 'agent-team:team-status', status: 'running', mode: 'real' });
  res.json({ status: 'started', mode: 'real' });
});

// POST /api/agent-team/real/stop
router.post('/agent-team/real/stop', (_req, res) => {
  if (tracker) tracker.stop();
  activeMode = 'none';
  team.status = 'stopped';
  broadcastTeamUpdate({ type: 'agent-team:team-status', status: 'stopped', mode: 'none' });
  res.json({ status: 'stopped' });
});

// GET /api/agent-team/real/state — get real tracker state
router.get('/agent-team/real/state', (_req, res) => {
  if (!tracker) return res.json({ agents: [], tasks: [], messages: [] });
  res.json(tracker.getState());
});

// GET /api/agent-team/mode — current mode
router.get('/agent-team/mode', (_req, res) => {
  res.json({ mode: activeMode });
});

// GET /api/agent-team/presets — list available presets
router.get('/agent-team/presets', (_req, res) => {
  res.json({ presets: listPresets(), current: team.presetId || 'dev-team' });
});

// POST /api/agent-team/preset/:id — switch to a different preset
router.post('/agent-team/preset/:id', (req, res) => {
  const presetId = req.params.id;
  const newTeam = createTeamFromPreset(presetId);
  if (!newTeam) return res.status(404).json({ error: 'Preset not found' });

  // Stop running demo/tracker
  if (activeMode === 'demo' && simulator) simulator.stop();
  if (activeMode === 'real' && tracker) tracker.stop();
  activeMode = 'none';

  // Replace team state in-place (keep same reference)
  team.id = newTeam.id;
  team.name = newTeam.name;
  team.presetId = newTeam.presetId;
  team.status = 'stopped';
  team.agents.clear();
  for (const [k, v] of newTeam.agents) team.agents.set(k, v);
  team.tasks.length = 0;
  team.tasks.push(...newTeam.tasks);
  team.messages.length = 0;
  team.createdAt = newTeam.createdAt;

  // Reset simulator so it picks up new preset templates
  if (simulator) { simulator.stop(); simulator = null; }

  broadcastTeamUpdate({ type: 'agent-team:init', team: serializeTeam(team) });
  broadcastTeamUpdate({ type: 'agent-team:team-status', status: 'stopped', mode: 'none' });
  res.json({ status: 'switched', presetId });
});

// ── Exports ────────────────────────────────────────────────────────────────
function getTeam() { return team; }

module.exports = { router, handleAgentTeamWs, broadcastTeamUpdate, getTeam };
