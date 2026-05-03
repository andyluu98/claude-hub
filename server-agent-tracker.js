/**
 * server-agent-tracker.js — Real Claude Code session tracker
 *
 * Watches JSONL transcript files in ~/.claude/projects/ to detect
 * real agent activity: tool calls, messages, sub-agents, status changes.
 * Provides the same agent/task/message data model as the demo simulator.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const POLL_MS = 1500;
const COLORS = ['#a78bfa', '#58a6ff', '#3fb950', '#f0883e', '#f85149', '#d2a8ff', '#79c0ff', '#56d364'];

const TOOL_LABELS = {
  Bash: 'Running command',
  Read: 'Reading file',
  Edit: 'Editing file',
  Write: 'Writing file',
  Glob: 'Searching files',
  Grep: 'Searching code',
  WebFetch: 'Fetching web',
  WebSearch: 'Searching web',
  Task: 'Running subtask',
  Agent: 'Running subagent',
  AskUserQuestion: 'Waiting for user',
};

class AgentTracker {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn;
    this.agents = new Map();    // sessionId → agent state
    this.tasks = [];            // extracted tasks
    this.messages = [];         // extracted messages
    this._fileOffsets = {};     // filepath → bytes read
    this._pollTimer = null;
    this._colorIdx = 0;
    this._seenToolIds = new Set();
    this._msgIdCounter = 0;
  }

  start() {
    if (this._pollTimer) return;
    this._scan();
    this._pollTimer = setInterval(() => this._scan(), POLL_MS);
  }

  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  getState() {
    return {
      agents: [...this.agents.values()].map(a => this._serializeAgent(a)),
      tasks: this.tasks.slice(-50),
      messages: this.messages.slice(-100),
    };
  }

  _scan() {
    if (!fs.existsSync(CLAUDE_DIR)) return;

    try {
      const projectDirs = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => path.join(CLAUDE_DIR, d.name));

      for (const projDir of projectDirs) {
        this._scanProjectDir(projDir);
      }
    } catch (err) {
      // Silently skip permission errors
    }
  }

  _scanProjectDir(projDir) {
    try {
      const files = fs.readdirSync(projDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const fp = path.join(projDir, f);
          try {
            const stat = fs.statSync(fp);
            return { path: fp, name: f, mtime: stat.mtimeMs, size: stat.size };
          } catch { return null; }
        })
        .filter(Boolean);

      // Only track recently active sessions (modified within last 30 min)
      const cutoff = Date.now() - 30 * 60 * 1000;
      const active = files.filter(f => f.mtime > cutoff);

      for (const file of active) {
        this._readNewLines(file);
      }
    } catch (err) {
      // Skip
    }
  }

  _readNewLines(file) {
    const offset = this._fileOffsets[file.path] || 0;
    if (file.size <= offset) return;

    try {
      const fd = fs.openSync(file.path, 'r');
      const bufSize = Math.min(file.size - offset, 256 * 1024);
      const buf = Buffer.alloc(bufSize);
      fs.readSync(fd, buf, 0, bufSize, offset);
      fs.closeSync(fd);

      this._fileOffsets[file.path] = offset + bufSize;

      const text = buf.toString('utf-8');
      const lines = text.split('\n').filter(l => l.trim());

      const sessionId = path.basename(file.path, '.jsonl');
      const projectName = path.basename(path.dirname(file.path));

      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          this._processRecord(sessionId, projectName, record);
        } catch {
          // Skip malformed lines
        }
      }
    } catch (err) {
      // Skip read errors
    }
  }

  _processRecord(sessionId, projectName, record) {
    // Ensure agent exists for this session
    if (!this.agents.has(sessionId)) {
      this._registerAgent(sessionId, projectName, record);
    }

    const agent = this.agents.get(sessionId);
    if (!agent) return;

    switch (record.type) {
      case 'assistant':
        this._handleAssistant(agent, record);
        break;
      case 'user':
        this._handleUser(agent, record);
        break;
      case 'system':
        this._handleSystem(agent, record);
        break;
      case 'progress':
        this._handleProgress(agent, record);
        break;
    }
  }

  _registerAgent(sessionId, projectName, record) {
    const color = COLORS[this._colorIdx % COLORS.length];
    this._colorIdx++;

    // Detect if this is a subagent
    const isSubagent = record.isSidechain === true;
    const entrypoint = record.entrypoint || 'cli';

    const agent = {
      sessionId,
      id: `session-${sessionId.slice(0, 8)}`,
      name: `Session ${sessionId.slice(0, 8)}`,
      description: `Project: ${projectName.replace(/--/g, '/')}`,
      role: 'teammate',
      status: 'running',
      color,
      position: { x: 50, y: 50 },
      currentTaskId: null,
      currentTool: null,
      activeToolIds: new Set(),
      toolHistory: [],
      entrypoint,
      cwd: record.cwd || '',
      lastActivity: Date.now(),
    };

    this.agents.set(sessionId, agent);
    this.broadcast({
      type: 'agent-team:agent-update',
      agent: this._serializeAgent(agent),
    });
  }

  _handleAssistant(agent, record) {
    const content = record.message?.content;
    if (!Array.isArray(content)) return;

    agent.lastActivity = Date.now();
    agent.status = 'running';

    for (const block of content) {
      if (block.type === 'tool_use' && block.id && !this._seenToolIds.has(block.id)) {
        this._seenToolIds.add(block.id);
        const toolName = block.name || 'Unknown';
        const toolInput = block.input || {};

        agent.currentTool = toolName;
        agent.activeToolIds.add(block.id);

        // Extract meaningful description
        const desc = this._toolDescription(toolName, toolInput);

        // Add as task activity
        const taskEntry = {
          id: `tool-${block.id.slice(0, 12)}`,
          title: desc,
          description: toolName,
          status: 'in_progress',
          ownerId: agent.id,
          dependencies: [],
          createdAt: record.timestamp || new Date().toISOString(),
        };
        this.tasks.push(taskEntry);
        if (this.tasks.length > 100) this.tasks.splice(0, this.tasks.length - 100);

        this.broadcast({ type: 'agent-team:task-created', task: taskEntry });

        // Generate message for tool start
        this._addMessage(agent.id, null, `${TOOL_LABELS[toolName] || toolName}: ${desc}`);
      }

      // Extract text responses as messages
      if (block.type === 'text' && block.text) {
        const text = block.text.trim();
        if (text.length > 10 && text.length < 200) {
          this._addMessage(agent.id, null, text.slice(0, 120));
        }
      }
    }

    this.broadcast({
      type: 'agent-team:agent-update',
      agent: this._serializeAgent(agent),
    });
  }

  _handleUser(agent, record) {
    const content = record.message?.content;

    // Tool results
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          agent.activeToolIds.delete(block.tool_use_id);

          // Mark corresponding task as completed
          const taskId = `tool-${block.tool_use_id.slice(0, 12)}`;
          const task = this.tasks.find(t => t.id === taskId);
          if (task && task.status !== 'completed') {
            task.status = 'completed';
            this.broadcast({ type: 'agent-team:task-updated', task });
          }
        }
      }

      if (agent.activeToolIds.size === 0) {
        agent.currentTool = null;
      }
    }

    // User text input
    if (typeof content === 'string' && content.trim().length > 0) {
      agent.lastActivity = Date.now();
    }

    this.broadcast({
      type: 'agent-team:agent-update',
      agent: this._serializeAgent(agent),
    });
  }

  _handleSystem(agent, record) {
    if (record.subtype === 'turn_duration') {
      agent.status = 'idle';
      agent.currentTool = null;
      agent.activeToolIds.clear();
      this.broadcast({
        type: 'agent-team:agent-update',
        agent: this._serializeAgent(agent),
      });
    }
  }

  _handleProgress(agent, record) {
    if (record.data?.type === 'agent_progress') {
      agent.lastActivity = Date.now();
      agent.status = 'running';
    }
  }

  _toolDescription(toolName, input) {
    switch (toolName) {
      case 'Bash': return input.command ? input.command.slice(0, 60) : 'Running shell';
      case 'Read': return input.file_path ? path.basename(input.file_path) : 'Reading file';
      case 'Edit': return input.file_path ? `Edit ${path.basename(input.file_path)}` : 'Editing';
      case 'Write': return input.file_path ? `Write ${path.basename(input.file_path)}` : 'Writing';
      case 'Glob': return input.pattern || 'Glob search';
      case 'Grep': return input.pattern ? `grep "${input.pattern.slice(0, 30)}"` : 'Code search';
      case 'WebFetch': return input.url ? input.url.slice(0, 50) : 'Fetching';
      case 'WebSearch': return input.query || 'Web search';
      case 'Task':
      case 'Agent': return input.description || input.prompt?.slice(0, 50) || 'Subtask';
      default: return toolName;
    }
  }

  _addMessage(fromId, toId, content) {
    this._msgIdCounter++;
    const msg = {
      id: `real-msg-${this._msgIdCounter}`,
      fromId,
      toId: toId || null,
      content,
      type: toId ? 'message' : 'broadcast',
      timestamp: new Date().toISOString(),
    };
    this.messages.push(msg);
    if (this.messages.length > 200) this.messages.splice(0, this.messages.length - 200);
    this.broadcast({ type: 'agent-team:message', message: msg });
  }

  _serializeAgent(agent) {
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      role: agent.role,
      status: agent.status,
      color: agent.color,
      position: agent.position,
      currentTaskId: agent.currentTaskId,
      currentTool: agent.currentTool,
      activeTools: agent.activeToolIds.size,
    };
  }
}

module.exports = { AgentTracker };
