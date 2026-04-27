# Terminal Edit + UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add click-to-position cursor, selection-delete in current input, sidebar toggle on main bar, and CSS container queries to keep the close (×) button visible when panes get squeezed.

**Architecture:** Pure client-side. Click handler on `term.element` translates pixel coordinates → cell column → arrow-key bytes sent over WS. Selection-delete branches the existing `attachCustomKeyEventHandler`. Sidebar toggle is a proxy button on the main bar. Container queries on `.pane` progressively hide non-essential header buttons.

**Tech Stack:** Vanilla JS ES5, xterm.js 5.x public API (`term.modes`, `term.buffer`, `term.hasSelection`, `term.getSelectionPosition`, `term.clearSelection`), CSS container queries.

---

## File Impact

Only `public/index.html` is modified.

Key anchors (use text search, not line numbers):
- `function createPaneElement(s)` — primary insertion zone for terminal handlers
- `term.attachCustomKeyEventHandler(function(ev) {` — extend existing handler
- `panes[s.id] = { term: term,` — end of createPaneElement, anchor for click listener
- `function toggleSidebar()` — extend with button visual update
- `<button class="btn btn-ghost" id="btn-notify"` — anchor for new sidebar button (just-added in previous feature)
- `connectCtrl();` (last line of `<script>`) — page-load init
- `</style>` — end of CSS block
- `function toggleBroadcast()` — anchor for inserting new helper functions

---

## Task 1: Add cell-size + cursor-move helpers

**Files:** Modify `public/index.html`

- [ ] **Step 1: Add helpers**

Find `function toggleBroadcast()`. Add immediately before it:

```js
function getCellSize(term) {
  try {
    var c = term._core._renderService.dimensions.css.cell;
    if (c && c.width > 0 && c.height > 0) return { w: c.width, h: c.height };
  } catch(_){}
  try {
    var row = term.element && term.element.querySelector('.xterm-rows > div');
    if (row) {
      var r = row.getBoundingClientRect();
      var len = term.cols || 80;
      if (r.width > 0 && r.height > 0) return { w: r.width / len, h: r.height };
    }
  } catch(_){}
  return null;
}

function sendCursorMove(ws, term, dx) {
  if (!ws || ws.readyState !== 1 || !dx) return;
  var n = Math.abs(dx);
  if (n > 200) return;
  var appMode = false;
  try { appMode = !!term.modes.applicationCursorKeysMode; } catch(_){}
  var seq = dx < 0
    ? (appMode ? '\x1bOD' : '\x1b[D')
    : (appMode ? '\x1bOC' : '\x1b[C');
  var out = '';
  for (var i = 0; i < n; i++) out += seq;
  ws.send(out);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add getCellSize and sendCursorMove helpers for terminal cursor control"
```

---

## Task 2: Click-to-position cursor handler

**Files:** Modify `public/index.html`

**Background:** Attach a `click` listener to `term.element` per pane. Only acts when click is on the same row as the cursor and there's no active selection.

- [ ] **Step 1: Add click handler in createPaneElement**

Find:
```js
  panes[s.id] = { term: term, ws: ws, fit: fit, search: search, el: el, opened: false, reconnectAttempt: 0, reconnectTimer: null };
  applyPaneColor(s.id);
  applyPaneTags(s.id);
}
```

Replace with:
```js
  panes[s.id] = { term: term, ws: ws, fit: fit, search: search, el: el, opened: false, reconnectAttempt: 0, reconnectTimer: null };
  applyPaneColor(s.id);
  applyPaneTags(s.id);

  // Click-to-position cursor — registered AFTER term.open() inside openAndFitSubtree
  // We attach when term.opened becomes true; use a one-shot poll
  (function attachClickPos() {
    var pp = panes[s.id];
    if (!pp) return;
    if (!pp.opened || !term.element) { setTimeout(attachClickPos, 100); return; }
    if (pp._clickPosAttached) return;
    pp._clickPosAttached = true;
    term.element.addEventListener('click', function(e) {
      try {
        if (term.hasSelection && term.hasSelection()) return;
        if (e.detail !== 1) return;
        var dims = getCellSize(term);
        if (!dims) return;
        var rect = term.element.getBoundingClientRect();
        var col = Math.floor((e.clientX - rect.left) / dims.w);
        var row = Math.floor((e.clientY - rect.top)  / dims.h);
        var cur = term.buffer.active;
        if (row !== cur.cursorY) return;
        var dx = col - cur.cursorX;
        if (dx === 0) return;
        var pp2 = panes[s.id];
        if (!pp2 || !pp2.ws) return;
        sendCursorMove(pp2.ws, term, dx);
      } catch(_){}
    });
  })();
}
```

- [ ] **Step 2: Verify manually**

Open a session running Claude Code or bash. Type some text at the prompt. Click anywhere within the typed line — cursor should jump to that column. Click on output text above (a different row) — no movement, normal selection behavior.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: click within current input row to move terminal cursor"
```

---

## Task 3: Selection-delete in current input

**Files:** Modify `public/index.html`

**Background:** Extend `term.attachCustomKeyEventHandler` to recognize Delete/Backspace with a single-row selection on the cursor row. Move cursor to selection start, send Delete forward N times.

- [ ] **Step 1: Add selection-delete branch**

Find:
```js
    if (ev.ctrlKey && (ev.key === 'c' || ev.key === 'C') && !ev.shiftKey) {
      var sel = term.getSelection();
      if (sel && sel.length > 0) {
        ev.preventDefault();
        navigator.clipboard.writeText(sel).then(function() { toast('Copied ' + sel.length + ' chars'); term.clearSelection(); });
        return false;
      }
      return true;
    }
```

Add immediately after that block (BEFORE the Shift+Enter branch):

```js
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && term.hasSelection && term.hasSelection()) {
      try {
        var sp = term.getSelectionPosition && term.getSelectionPosition();
        var cur = term.buffer.active;
        var curAbsRow = cur.viewportY + cur.cursorY;
        if (sp && sp.startRow === sp.endRow && sp.startRow === curAbsRow) {
          var ws_ = panes[s.id] && panes[s.id].ws;
          if (ws_ && ws_.readyState === 1) {
            ev.preventDefault();
            var moveDx = sp.startColumn - cur.cursorX;
            sendCursorMove(ws_, term, moveDx);
            var delLen = sp.endColumn - sp.startColumn;
            if (delLen > 0 && delLen <= 500) {
              var del = '';
              for (var di = 0; di < delLen; di++) del += '\x1b[3~';
              ws_.send(del);
            }
            term.clearSelection();
            return false;
          }
        }
      } catch(_){}
      return true;
    }
```

- [ ] **Step 2: Verify manually**

In a Claude Code or bash prompt, type a sentence. Drag-select a portion of it on the same line as the cursor. Press Delete (or Backspace) — that portion disappears. Drag-select across two lines (multi-row) → Delete falls back to default behavior (typically clears selection without deleting in TUI).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: selection + Delete/Backspace deletes range on current input row"
```

---

## Task 4: Sidebar toggle button on main bar

**Files:** Modify `public/index.html`

- [ ] **Step 1: Add `📁 Files` button to #bar**

Find:
```html
  <button class="btn btn-ghost" id="btn-notify" onclick="toggleNotifications()" title="Notifications off">&#x1F514;</button>
```

Add immediately before it:
```html
  <button class="btn btn-ghost" id="btn-sidebar-main" onclick="toggleSidebar()" title="Show/hide files">&#x1F4C1; Files</button>
```

- [ ] **Step 2: Add `updateSidebarBtn` and extend `toggleSidebar`**

Find:
```js
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  setTimeout(function() { fitSubtree(layoutTrees[currentTab]); }, 220);
}
```

Replace with:
```js
function updateSidebarBtn() {
  var btn = document.getElementById('btn-sidebar-main');
  if (!btn) return;
  var collapsed = document.getElementById('sidebar').classList.contains('collapsed');
  btn.style.color = collapsed ? '' : 'var(--orange)';
  btn.title = collapsed ? 'Show files' : 'Hide files';
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  updateSidebarBtn();
  setTimeout(function() { fitSubtree(layoutTrees[currentTab]); }, 220);
}
```

- [ ] **Step 3: Initialize button on page load**

Find `updateNotifyBtn();` (added in previous feature) immediately before `connectCtrl();`. Add immediately after it:

```js
updateSidebarBtn();
```

- [ ] **Step 4: Verify manually**

Reload app. The 📁 button on the bar reflects sidebar state (orange when sidebar is open). Click it → sidebar collapses, button dims. Click again → expands, button highlights. Existing in-sidebar `≡` button still works and updates the bar button (because both call `toggleSidebar`).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: add 📁 Files toggle button on main bar"
```

---

## Task 5: Pane header container queries

**Files:** Modify `public/index.html`

- [ ] **Step 1: Add container declaration to .pane**

Find `.pane-body { flex:1; padding:6px; overflow:hidden; min-height:0; background:#000; position:relative; }` (the existing rule). Add immediately AFTER it:

```css
.pane { container-type: inline-size; container-name: pane; }
```

- [ ] **Step 2: Add @container rules**

Find `</style>` (end of style block). Add immediately before it:

```css
@container pane (max-width: 379px) {
  .pane-head [data-export],
  .pane-head [data-note] { display: none; }
}
@container pane (max-width: 339px) {
  .pane-head [data-folder],
  .pane-head [data-zoom] { display: none; }
}
@container pane (max-width: 289px) {
  .pane-head .lane-btns,
  .pane-head .auto { display: none; }
}
@container pane (max-width: 249px) {
  .pane-head .folder { display: none; }
}
@container pane (max-width: 209px) {
  .pane-head [data-split-h],
  .pane-head [data-split-v] { display: none; }
}
@container pane (max-width: 169px) {
  .pane-head .nm { max-width: 80px; }
  .pane-head .tag-area { display: none; }
}
```

- [ ] **Step 3: Verify manually**

Open 2 sessions, split horizontally. Drag the divider to make one pane very narrow. As width decreases past each threshold, buttons disappear in priority order. The × button is always visible. Drag back wider → buttons reappear.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: container queries hide pane header buttons progressively to keep × accessible"
```

---

## Self-Review

**Spec coverage:**
- ✅ Click-to-position helper (Task 1) and click handler (Task 2)
- ✅ Selection-delete branch in attachCustomKeyEventHandler (Task 3)
- ✅ Sidebar toggle button + visual sync (Task 4)
- ✅ Pane header container queries (Task 5)

**Placeholder scan:** No TBD/TODO. All steps show exact code.

**Type consistency:**
- `getCellSize(term)` returns `{w, h} | null` — null-checked in caller ✅
- `sendCursorMove(ws, term, dx)` — guards `ws.readyState`, `dx === 0`, and `n > 200` ✅
- `term.getSelectionPosition()` returns `{startRow, endRow, startColumn, endColumn}` — referenced consistently ✅
- `cur.viewportY + cur.cursorY` is the absolute row — matched against `sp.startRow` (also absolute) ✅
- `panes[s.id]._clickPosAttached` prevents double-binding on pane recreation ✅

**Edge cases:**
- xterm internal API throws → try/catch returns null from getCellSize ✅
- Click before term.open() → polled retry every 100 ms ✅
- WS closed during click → `ws.readyState !== 1` guard ✅
- Sanity caps: `n > 200` for cursor move, `delLen > 500` for delete (prevents catastrophic flood if state is corrupted) ✅
- Multi-row selection + Delete → falls through, returns `true`, xterm default behavior preserved ✅
- DECCKM mode read fresh each call — no stale assumption ✅
- Container queries unsupported → would silently ignore the rules; modern browsers (target environment) all support them ✅

**Order dependency:**
- Task 1 must precede Task 2 and Task 3 (defines `getCellSize` and `sendCursorMove`)
- Task 4 must run after the previous feature added `updateNotifyBtn();` (already in the codebase from notifications feature)
- Task 5 is independent
