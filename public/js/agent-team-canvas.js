/**
 * agent-team-canvas.js — Canvas graph renderer for Agent Team Visualizer
 *
 * Renders nodes (agents) and animated connections on a <canvas> element.
 * Handles drag interaction, particle animations, and HiDPI scaling.
 */

'use strict';

// Connection colors by type
const LINE_COLORS = {
  parallel: '#58a6ff',
  message:  '#3fb950',
  shared:   '#f85149',
};

class GraphRenderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state; // { agents: [], tasks: [], messages: [] }
    this.dpr = window.devicePixelRatio || 1;

    // Drag state
    this._dragging = null; // agent id
    this._dragOffset = { x: 0, y: 0 };

    // Particle animations (dots traveling along connections)
    this._particles = []; // { fromId, toId, progress:0-1, color, speed }

    // Animation
    this._rafId = null;
    this._dirty = true;

    this._bindEvents();
    this.resize();

    // Observe container resizes
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.layoutNodes();
    this._dirty = true;
  }

  /** Circular layout: lead at center, teammates around */
  layoutNodes() {
    const agents = this.state.agents || [];
    const cx = this.w / 2;
    const cy = this.h / 2;
    const radius = Math.min(this.w, this.h) * 0.32;

    const lead = agents.find(a => a.role === 'lead');
    const teammates = agents.filter(a => a.role !== 'lead');

    if (lead && lead._x === undefined) {
      lead._x = cx;
      lead._y = cy;
    }

    teammates.forEach((a, i) => {
      if (a._x !== undefined) return; // already positioned (dragged)
      const angle = (2 * Math.PI * i / teammates.length) - Math.PI / 2;
      a._x = cx + radius * Math.cos(angle);
      a._y = cy + radius * Math.sin(angle);
    });
  }

  /** Add animated particle on a connection */
  addParticle(fromId, toId, color) {
    if (this._particles.length > 15) return; // cap animations
    this._particles.push({
      fromId, toId,
      progress: 0,
      color: color || LINE_COLORS.message,
      speed: 0.015 + Math.random() * 0.01,
    });
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  startAnimation() {
    if (this._rafId) return;
    const loop = () => {
      this._updateParticles();
      this._render();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stopAnimation() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const agents = this.state.agents || [];
    const lead = agents.find(a => a.role === 'lead');

    // Draw connections from lead to each teammate
    agents.forEach(a => {
      if (a.role === 'lead' || !lead) return;
      this._drawConnection(lead, a);
    });

    // Draw particles
    this._drawParticles();

    // Draw nodes
    agents.forEach(a => this._drawNode(a));
  }

  _drawConnection(from, to) {
    const ctx = this.ctx;
    ctx.save();

    // Determine connection type from agent color
    const color = to.color || LINE_COLORS.parallel;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.35;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;

    // Bezier curve
    const mx = (from._x + to._x) / 2;
    const my = (from._y + to._y) / 2;
    const cp1x = mx + (from._y - to._y) * 0.1;
    const cp1y = my + (to._x - from._x) * 0.1;

    ctx.beginPath();
    ctx.moveTo(from._x, from._y);
    ctx.quadraticCurveTo(cp1x, cp1y, to._x, to._y);
    ctx.stroke();
    ctx.restore();
  }

  _drawNode(agent) {
    const ctx = this.ctx;
    const x = agent._x;
    const y = agent._y;
    if (x === undefined) return;

    const nodeRadius = 28;
    const isActive = agent.status === 'running';
    const isError = agent.status === 'error';

    ctx.save();

    // Glow for active nodes
    if (isActive || isError) {
      const glowColor = isError ? '#f85149' : agent.color;
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12 + pulse * 10;
    }

    // Circle fill
    ctx.beginPath();
    ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(agent.color, 0.2);
    ctx.fill();
    ctx.strokeStyle = agent.color;
    ctx.lineWidth = agent.status === 'stopped' ? 1 : 2;
    if (agent.status === 'stopped') ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();

    // Role icon text in center
    ctx.save();
    ctx.fillStyle = agent.color;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = agent.role === 'lead' ? '★' : '◆';
    ctx.fillText(icon, x, y);
    ctx.restore();
  }

  _drawParticles() {
    const ctx = this.ctx;
    const agents = this.state.agents || [];
    const agentMap = {};
    agents.forEach(a => { agentMap[a.id] = a; });

    for (const p of this._particles) {
      const from = agentMap[p.fromId];
      const to = agentMap[p.toId];
      if (!from || !to || from._x === undefined || to._x === undefined) continue;

      // Lerp position along bezier
      const t = p.progress;
      const mx = (from._x + to._x) / 2;
      const my = (from._y + to._y) / 2;
      const cp1x = mx + (from._y - to._y) * 0.1;
      const cp1y = my + (to._x - from._x) * 0.1;
      const px = quadBezier(from._x, cp1x, to._x, t);
      const py = quadBezier(from._y, cp1y, to._y, t);

      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
  }

  _updateParticles() {
    for (let i = this._particles.length - 1; i >= 0; i--) {
      this._particles[i].progress += this._particles[i].speed;
      if (this._particles[i].progress >= 1) {
        this._particles.splice(i, 1);
      }
    }
  }

  // ── Drag interaction ───────────────────────────────────────────────────
  _bindEvents() {
    this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this._onMouseUp());
    this.canvas.addEventListener('mouseleave', () => this._onMouseUp());

    // Touch support
    this.canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];
      this._onMouseDown({ offsetX: t.clientX - this.canvas.getBoundingClientRect().left, offsetY: t.clientY - this.canvas.getBoundingClientRect().top });
    });
    this.canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const t = e.touches[0];
      this._onMouseMove({ offsetX: t.clientX - this.canvas.getBoundingClientRect().left, offsetY: t.clientY - this.canvas.getBoundingClientRect().top });
    });
    this.canvas.addEventListener('touchend', () => this._onMouseUp());
  }

  _onMouseDown(e) {
    const { offsetX: mx, offsetY: my } = e;
    const agents = this.state.agents || [];
    for (const a of agents) {
      if (a._x === undefined) continue;
      const dx = mx - a._x;
      const dy = my - a._y;
      if (dx * dx + dy * dy < 35 * 35) {
        this._dragging = a.id;
        this._dragOffset = { x: dx, y: dy };
        this.canvas.style.cursor = 'grabbing';
        return;
      }
    }
  }

  _onMouseMove(e) {
    if (!this._dragging) {
      // Hover cursor
      const { offsetX: mx, offsetY: my } = e;
      const agents = this.state.agents || [];
      let over = false;
      for (const a of agents) {
        if (a._x === undefined) continue;
        const dx = mx - a._x;
        const dy = my - a._y;
        if (dx * dx + dy * dy < 35 * 35) { over = true; break; }
      }
      this.canvas.style.cursor = over ? 'grab' : 'default';
      return;
    }

    const agent = (this.state.agents || []).find(a => a.id === this._dragging);
    if (!agent) return;
    agent._x = e.offsetX - this._dragOffset.x;
    agent._y = e.offsetY - this._dragOffset.y;
    this._dirty = true;

    // Notify cards to reposition
    if (this.onNodeMove) this.onNodeMove(agent);
  }

  _onMouseUp() {
    if (this._dragging) {
      this._dragging = null;
      this.canvas.style.cursor = 'default';
    }
  }

  /** Get node position for DOM overlay positioning */
  getNodePos(agentId) {
    const agent = (this.state.agents || []).find(a => a.id === agentId);
    if (!agent || agent._x === undefined) return null;
    return { x: agent._x, y: agent._y };
  }
}

// ── Utility ────────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function quadBezier(p0, p1, p2, t) {
  const inv = 1 - t;
  return inv * inv * p0 + 2 * inv * t * p1 + t * t * p2;
}
