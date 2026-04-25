# Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add terminal WebSocket auto-reconnect with overlay UI and fix the missing `ctrlWs.onerror` handler.

**Architecture:** Server-side history buffer is already fully implemented (`s.appendHistory`, `s.history` replay on WS connect, 500 KB cap). Client needs: (1) a one-line `onerror` fix on the control WS, and (2) reconnect logic for per-terminal WS with a visible overlay. Terminal instances are never destroyed — only the WS is replaced. `panes[sid].ws` is updated on reconnect; `term.onData`/`term.onResize` are changed to read `panes[sid].ws` dynamically so they work after reconnect.

**Tech Stack:** Vanilla JS ES5, xterm.js 5.3.0, CSS custom properties.

---

## File Impact

Only `public/index.html` is modified across both tasks.

Key anchors (use text search, not line numbers):
- `ctrlWs.onclose = function()` — inside `connectCtrl`
- `var ws = new WebSocket('ws://' + location.host + '/term/' + s.id);` — start of WS block in `createPaneElement`
- `term.onData(function(d) { if (ws.readyState === 1) ws.send(d); });` — inside `createPaneElement`
- `term.onResize(function(sz) {` — inside `createPaneElement`
- `panes[s.id] = { term: term, ws: ws, fit: fit, search: search, el: el, opened: false };`
- `.pane-body { flex:1;` — CSS rule
- `</style>` — end of style block
- `var termFontSize =` — global vars block
- `function toggleOverseer(` — used as insertion point for new functions

---

## Task 1: Fix `ctrlWs.onerror`

**Files:** Modify `public/index.html`

**Background:** `connectCtrl` has `onopen`, `onclose`, `onmessage` but no `onerror`. On some browsers a WS error fires without a subsequent `close` event, so the reconnect never triggers.

- [ ] **Step 1: Add `onerror` handler**

Find:
```js
  ctrlWs.onclose = function() {
    var b = document.getElementById('ws-badge');
    b.textContent = 'Disconnected...';
    b.className = '';
    setTimeout(connectCtrl, Math.min(5000, 1000 * ++retryCount));
  };
```

Replace with:
```js
  ctrlWs.onclose = function() {
    var b = document.getElementById('ws-badge');
    b.textContent = 'Disconnected...';
    b.className = '';
    setTimeout(connectCtrl, Math.min(5000, 1000 * ++retryCount));
  };
  ctrlWs.onerror = function() { ctrlWs.close(); };
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "fix: add ctrlWs.onerror to guarantee reconnect on WS error"
```

---

## Task 2: Terminal WS Reconnect + Overlay UI

**Files:** Modify `public/index.html`

**Background:** Per-terminal WebSockets have no `onclose`/`onerror` handlers — a dropped connection silently stops terminal output with no feedback. This task adds:
- Auto-reconnect with exponential backoff (1 s → 2 s → 4 s → 8 s, max 5 attempts)
- After 5 failures: stop auto-retry, show **[Reconnect]** button
- Visual overlay over the xterm area during disconnected/reconnecting state
- Dynamic `panes[sid].ws` lookup in `term.onData`/`term.onResize` so reconnected WS is used

### Step 1: Add global constant

Find `var termFontSize =`. Add before it:

```js
var TERM_RECONNECT_DELAYS = [1000, 2000, 4000, 8000];
```

### Step 2: Add CSS

Find `</style>`. Add before it:

```css
.pane-body { position: relative; }
.term-overlay { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; background:rgba(7,9,13,.82); color:var(--text-dim); font-size:13px; text-align:center; pointer-events:none; }
.term-overlay .ov-icon { font-size:22px; }
.term-overlay .ov-text { line-height:1.5; }
.term-overlay button { pointer-events:auto; padding:6px 16px; border-radius:7px; border:1px solid var(--border-strong); background:var(--panel-solid); color:var(--text); cursor:pointer; font-size:12px; }
.term-overlay button:hover { background:var(--panel); }
```

**Note:** `.pane-body` already has `flex:1; padding:6px; overflow:hidden; min-height:0; background:#000;` — add `position:relative` to the **existing rule** rather than creating a duplicate.

Find the existing `.pane-body` rule:
```css
.pane-body { flex:1; padding:6px; overflow:hidden; min-height:0; background:#000; }
```
Replace with:
```css
.pane-body { flex:1; padding:6px; overflow:hidden; min-height:0; background:#000; position:relative; }
```

### Step 3: Update `panes[s.id]` assignment to include reconnect fields

Find:
```js
  panes[s.id] = { term: term, ws: ws, fit: fit, search: search, el: el, opened: false };
```
Replace with:
```js
  panes[s.id] = { term: term, ws: ws, fit: fit, search: search, el: el, opened: false, reconnectAttempt: 0, reconnectTimer: null };
```

### Step 4: Change `term.onData` and `term.onResize` to use dynamic `panes[sid].ws`

This is critical: the original closures capture the local `ws` variable. After reconnect, `panes[s.id].ws` points to the new WS, but the old closures still use the dead `ws`. Fix by reading from `panes[s.id]` dynamically.

Find:
```js
  term.onData(function(d) { if (ws.readyState === 1) ws.send(d); });
  term.onResize(function(sz) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type:'resize', cols:sz.cols, rows:sz.rows }));
  });
```
Replace with:
```js
  term.onData(function(d) {
    var pp = panes[s.id];
    if (pp && pp.ws && pp.ws.readyState === 1) pp.ws.send(d);
  });
  term.onResize(function(sz) {
    var pp = panes[s.id];
    if (pp && pp.ws && pp.ws.readyState === 1) pp.ws.send(JSON.stringify({ type:'resize', cols:sz.cols, rows:sz.rows }));
  });
```

### Step 5: Add `ws.onclose` and `ws.onerror` handlers in `createPaneElement`

Find:
```js
  var ws = new WebSocket('ws://' + location.host + '/term/' + s.id);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = function(e) {
    if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
    else term.write(e.data);
  };
  ws.onopen = function() {
    setTimeout(function() {
      var pp = panes[s.id];
      if (pp && pp.opened) {
        try { pp.fit.fit(); ws.send(JSON.stringify({ type:'resize', cols:term.cols, rows:term.rows })); } catch(_){}
      }
    }, 100);
  };
```
Replace with:
```js
  var ws = new WebSocket('ws://' + location.host + '/term/' + s.id);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = function(e) {
    if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
    else term.write(e.data);
  };
  ws.onopen = function() {
    var pp = panes[s.id];
    if (!pp) return;
    pp.reconnectAttempt = 0;
    hideTermOverlay(s.id);
    setTimeout(function() {
      var pp2 = panes[s.id];
      if (pp2 && pp2.opened) {
        try { pp2.fit.fit(); pp2.ws.send(JSON.stringify({ type:'resize', cols:term.cols, rows:term.rows })); } catch(_){}
      }
    }, 100);
  };
  ws.onclose = function() { scheduleTermReconnect(s.id); };
  ws.onerror = function() { ws.close(); };
```

### Step 6: Add reconnect and overlay functions

Find `function toggleOverseer(`. Add before it:

```js
function showTermOverlay(sid, text, showBtn) {
  var p = panes[sid];
  if (!p) return;
  var body = p.el.querySelector('.pane-body');
  if (!body) return;
  var ov = body.querySelector('.term-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'term-overlay';
    body.appendChild(ov);
  }
  ov.innerHTML = '<span class="ov-icon">⚠</span><span class="ov-text">' + text + '</span>';
  if (showBtn) {
    var btn = document.createElement('button');
    btn.textContent = 'Reconnect';
    btn.addEventListener('click', function() { reconnectTerm(sid); });
    ov.appendChild(btn);
  }
}

function hideTermOverlay(sid) {
  var p = panes[sid];
  if (!p) return;
  var body = p.el.querySelector('.pane-body');
  if (!body) return;
  var ov = body.querySelector('.term-overlay');
  if (ov) ov.remove();
}

function scheduleTermReconnect(sid) {
  var p = panes[sid];
  if (!p) return;
  var attempt = p.reconnectAttempt;
  if (attempt >= TERM_RECONNECT_DELAYS.length + 1) return; // already gave up
  if (p.reconnectTimer) { clearTimeout(p.reconnectTimer); p.reconnectTimer = null; }
  if (attempt >= TERM_RECONNECT_DELAYS.length) {
    showTermOverlay(sid, 'Disconnected', true);
    return;
  }
  var delay = TERM_RECONNECT_DELAYS[attempt];
  p.reconnectAttempt++;
  showTermOverlay(sid, 'Reconnecting… (' + (delay / 1000) + 's)', false);
  p.reconnectTimer = setTimeout(function() { reconnectTerm(sid); }, delay);
}

function reconnectTerm(sid) {
  var p = panes[sid];
  if (!p) return;
  if (p.reconnectTimer) { clearTimeout(p.reconnectTimer); p.reconnectTimer = null; }
  var newWs = new WebSocket('ws://' + location.host + '/term/' + sid);
  newWs.binaryType = 'arraybuffer';
  newWs.onmessage = function(e) {
    if (e.data instanceof ArrayBuffer) p.term.write(new Uint8Array(e.data));
    else p.term.write(e.data);
  };
  newWs.onopen = function() {
    p.reconnectAttempt = 0;
    hideTermOverlay(sid);
    try { p.fit.fit(); newWs.send(JSON.stringify({ type:'resize', cols:p.term.cols, rows:p.term.rows })); } catch(_){}
  };
  newWs.onclose = function() { scheduleTermReconnect(sid); };
  newWs.onerror = function() { newWs.close(); };
  p.ws = newWs;
}
```

### Step 7: Verify manually

Start the app, open a session. In a separate terminal, find the server process and temporarily block the WS port (or kill and restart server). The terminal pane should show "⚠ Reconnecting… (1s)" overlay. After server restarts, the overlay disappears and terminal resumes — replaying the last ~500 KB of output automatically (history buffer already in server).

After 5 failed attempts (e.g. keep server stopped), the overlay switches to "Disconnected" with a [Reconnect] button. Clicking it restarts the reconnect cycle.

### Step 8: Commit

```bash
git add public/index.html
git commit -m "feat: add terminal WS auto-reconnect with overlay and backoff"
```

---

## Self-Review

**Spec coverage:**
- ✅ Terminal WS reconnect with backoff — Task 2 Steps 1–8
- ✅ Reconnect overlay (reconnecting state + failed state + button) — Task 2 Steps 2, 6
- ✅ Session history buffer — already in server.js (500 KB, replayed on WS connect); no code needed
- ✅ `ctrlWs.onerror` — Task 1

**Placeholder scan:** No TBD/TODO. All steps show exact code.

**Type consistency:**
- `TERM_RECONNECT_DELAYS` defined in Step 1, used in `scheduleTermReconnect` Step 6 ✅
- `panes[sid].reconnectAttempt` and `panes[sid].reconnectTimer` added in Step 3, used in Steps 5 and 6 ✅
- `showTermOverlay(sid, text, showBtn)` and `hideTermOverlay(sid)` defined in Step 6, called from Steps 5 and 6 ✅
- `scheduleTermReconnect(sid)` and `reconnectTerm(sid)` defined in Step 6, wired in Step 5 ✅
- `pp.ws.send(...)` in Step 5 `ws.onopen` uses `pp2.ws` (the current WS from panes) — correct after Step 4 change ✅

**Note on `.pane-body position:relative`:** The spec says `.pane-body` needs this. The plan replaces the existing rule in Step 2 rather than adding a duplicate. The new `.term-overlay` CSS rule is added before `</style>` as a separate block.
