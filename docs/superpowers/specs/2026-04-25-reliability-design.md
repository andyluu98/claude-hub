# Reliability — Claude Hub

**Date:** 2026-04-25
**Status:** Approved

---

## Goals

1. Terminal WS reconnect — auto-reconnect with backoff when a per-pane WebSocket drops, with visible overlay status and a manual fallback button.
2. Session history buffer — server buffers the last 10,000 bytes of PTY output per session in RAM; replayed to the client on reconnect.
3. Control WS `onerror` — add missing error handler to `connectCtrl`.

Zero changes to PTY session logic, localStorage, or session persistence files.

---

## Section 1: Terminal WS Reconnect

### Trigger
- `ws.onclose` fires on the per-terminal WebSocket inside `createPaneElement`.
- Currently: no handler → terminal silently stops updating.

### Reconnect Logic
- Exponential backoff: 1 s → 2 s → 4 s → 8 s (max). Implemented with `termReconnectDelays = [1000, 2000, 4000, 8000]`.
- After 5 consecutive failures: stop auto-retry, show **[Reconnect]** button.
- On successful reconnect (`ws.onopen`): reset attempt counter, hide overlay.

### Overlay UI
```
┌──────────────────────────────┐
│  pane-head (unchanged)       │
├──────────────────────────────┤
│  ⚠ Disconnected              │  ← .term-overlay (position:absolute, over xterm)
│  Reconnecting in 2s…         │
│            [Reconnect]       │  ← shown only after 5 failures
├──────────────────────────────┤
│  xterm (content preserved)   │
└──────────────────────────────┘
```

- Overlay is `position:absolute; inset:0` inside `.pane-body` — xterm DOM untouched underneath.
- `.pane-body` gains `position:relative`.
- States: `reconnecting` (spinner + countdown text) / `failed` (static text + button).

### Implementation
- `panes[sid]` gains two fields: `reconnectAttempt: 0`, `reconnectTimer: null`.
- `function scheduleTermReconnect(sid)` — clears any existing timer, increments attempt, shows overlay, schedules `reconnectTerm(sid)` after delay.
- `function reconnectTerm(sid)` — creates a new `WebSocket` for `ws://host/term/sid`, wires all handlers (same as `createPaneElement` but without recreating the terminal or pane element), assigns to `panes[sid].ws`.
- On `ws.onclose` inside `createPaneElement` and `reconnectTerm`: call `scheduleTermReconnect(sid)`.
- On `ws.onopen` after reconnect: hide overlay, reset `reconnectAttempt = 0`.
- `function showTermOverlay(sid, text, showBtn)` / `function hideTermOverlay(sid)` — manages the overlay DOM node.

### CSS
```css
.pane-body { position: relative; }
.term-overlay { position:absolute; inset:0; z-index:10; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; background:rgba(7,9,13,.82); color:var(--text-dim); font-size:13px; text-align:center; }
.term-overlay .overlay-icon { font-size:22px; }
.term-overlay button { padding:6px 16px; border-radius:7px; border:1px solid var(--border-strong); background:var(--panel-solid); color:var(--text); cursor:pointer; font-size:12px; }
.term-overlay button:hover { background:var(--panel); }
```

---

## Section 2: Session History Buffer

### Server-side (server.js)

- Add `const termBuffers = new Map();` — maps `sessionId → Buffer` (Node.js `Buffer`).
- `HISTORY_BYTES = 10000` constant.
- In the PTY `onData` handler (where output is broadcast to all WS clients of that session): append data to `termBuffers.get(sessionId)`, trim to last `HISTORY_BYTES` bytes if over limit.
- When a new terminal WebSocket connects (`/term/:id`): before registering as a live subscriber, send the existing buffer (if any) as a binary frame, then stream live output.
- On session delete (`removeSession` / PTY close): `termBuffers.delete(sessionId)`.

### Buffer trimming
```js
let buf = termBuffers.get(id) || Buffer.alloc(0);
buf = Buffer.concat([buf, chunk]);
if (buf.length > HISTORY_BYTES) buf = buf.slice(buf.length - HISTORY_BYTES);
termBuffers.set(id, buf);
```

### Client-side
No changes needed — the client's existing `ws.onmessage` already handles binary frames (`ArrayBuffer → Uint8Array → term.write`). The replay is transparent.

---

## Section 3: Control WS `onerror`

### Current state
`connectCtrl` has `onopen`, `onclose`, `onmessage` but no `onerror`.

### Fix
Add immediately after the existing `onclose` handler:
```js
ctrlWs.onerror = function() {
  ctrlWs.close(); // triggers onclose → reconnect
};
```

This is minimal: errors on a WS always precede a `close` event, but some browsers suppress the close if the error fires first. Calling `close()` explicitly ensures the reconnect path always fires.

---

## What Is NOT Changed

- PTY creation, session lifecycle, `sessions` Map in server.js.
- `localStorage` keys, layout trees, tags, templates.
- xterm.js terminal instances — never destroyed on WS drop.
- File explorer sidebar, overseer pane, all existing keyboard shortcuts.

---

## File Impact

- `server.js`: add `termBuffers` Map, buffer append in PTY onData, replay on WS connect, delete on session remove.
- `public/index.html`: CSS (`.term-overlay`), `panes` object gains `reconnectAttempt`/`reconnectTimer`, `scheduleTermReconnect`/`reconnectTerm`/`showTermOverlay`/`hideTermOverlay` functions, `ws.onclose` handler in `createPaneElement`, `ctrlWs.onerror` in `connectCtrl`.
