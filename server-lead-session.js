/**
 * server-lead-session.js — Lead agent session manager
 *
 * Thin wrapper that creates a regular Session (from server.js)
 * for the "team lead" Claude Code instance. The terminal is rendered
 * via the existing /term/:id WebSocket route — no custom WS needed.
 */

'use strict';

const express = require('express');
const { v4: uuid } = require('uuid');

// ── Injected dependencies (set by init()) ───────────────────────────
let sessions = null;  // Map<id, Session>
let Session = null;   // Session class
let startPty = null;  // startPty(session, opts)
let pushSession = null;

let leadSessionId = null;

function init(deps) {
  sessions = deps.sessions;
  Session = deps.Session;
  startPty = deps.startPty;
  pushSession = deps.pushSession;
}

// ── Lead Lifecycle ──────────────────────────────────────────────────
function startLead(cwd, autoAccept) {
  // If already running, return existing session
  if (leadSessionId) {
    const existing = sessions.get(leadSessionId);
    if (existing && existing.status === 'running') {
      return { status: 'already_running', sessionId: leadSessionId };
    }
  }

  const id = uuid().replace(/-/g, '').slice(0, 12);
  const workCwd = cwd || process.cwd();
  const accept = autoAccept !== undefined ? autoAccept : true;

  const session = new Session(id, 'Lead Agent', workCwd, accept);
  sessions.set(id, session);
  startPty(session);

  leadSessionId = id;
  return { status: 'started', sessionId: id, cwd: workCwd };
}

function stopLead() {
  if (!leadSessionId) return { status: 'not_running' };
  const session = sessions.get(leadSessionId);
  if (session && session.proc) {
    try { session.proc.kill(); } catch {}
  }
  const id = leadSessionId;
  leadSessionId = null;
  return { status: 'stopped', sessionId: id };
}

function getLeadSessionId() {
  return leadSessionId;
}

// ── Router ──────────────────────────────────────────────────────────
const router = express.Router();

router.post('/lead/start', (req, res) => {
  if (!sessions) return res.status(500).json({ error: 'Not initialized' });
  const { cwd, autoAccept } = req.body || {};
  try {
    res.json(startLead(cwd, autoAccept));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/lead/stop', (_req, res) => {
  res.json(stopLead());
});

router.get('/lead/status', (_req, res) => {
  if (!leadSessionId) return res.json({ status: 'stopped', sessionId: null });
  const session = sessions.get(leadSessionId);
  res.json({
    status: session ? session.status : 'stopped',
    sessionId: leadSessionId,
    cwd: session ? session.cwd : null,
  });
});

module.exports = { router, init, getLeadSessionId };
