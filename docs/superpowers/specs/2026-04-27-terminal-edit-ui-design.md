# Terminal Edit + UI Improvements — Claude Hub

**Date:** 2026-04-27
**Status:** Approved

---

## Goals

1. **Click-to-position cursor** — single-click anywhere on the current input row to move the terminal cursor to that column.
2. **Selection-delete** — when the user has a single-row text selection that overlaps the current cursor row, pressing Delete or Backspace removes that range from the input.
3. **Sidebar toggle on main bar** — a `📁` button on the top bar to collapse/expand the file tree (in addition to the existing in-sidebar toggle).
4. **X (close) button always accessible** — when a pane is squeezed by horizontal splits, hide non-essential header buttons in priority order so the close button stays clickable.

Zero changes to `server.js`. All changes in `public/index.html`.

---

## Section 1: Click-to-Position Cursor

### Behavior

- Single left-click on a cell within the current cursor row → move cursor to that column.
- Click on a different row → no-op (let xterm.js handle normal selection / no action).
- Drag-select / double-click / right-click → preserve xterm.js default behavior.
- Selection currently active after click (`term.hasSelection()`) → no-op.
- Pane is read-only viewer (TUI mouse mode active) → no-op.

### Detection

Attach a `click` handler to `term.element` per pane (set up inside `createPaneElement`). Handler logic:

```js
term.element.addEventListener('click', function(e) {
  if (term.hasSelection()) return;            // user dragged → don't interfere
  if (e.detail !== 1) return;                  // double/triple-click → skip
  var dims = getCellSize(term);
  if (!dims) return;
  var rect = term.element.getBoundingClientRect();
  var col = Math.floor((e.clientX - rect.left) / dims.w);
  var row = Math.floor((e.clientY - rect.top)  / dims.h);
  var cursor = term.buffer.active;
  if (row !== cursor.cursorY) return;          // only same-row clicks
  var dx = col - cursor.cursorX;
  if (dx === 0) return;
  sendCursorMove(panes[sid].ws, term, dx);
});
```

### Cell size

xterm.js 5.x exposes cell metrics via `term._core._renderService.dimensions.css.cell.{width,height}`. This is private API but stable across 5.x. Wrap in a `getCellSize(term)` helper with a try/catch fallback:

```js
function getCellSize(term) {
  try {
    var c = term._core._renderService.dimensions.css.cell;
    if (c && c.width > 0 && c.height > 0) return { w: c.width, h: c.height };
  } catch(_){}
  // Fallback: measure actual row element
  try {
    var row = term.element.querySelector('.xterm-rows > div');
    if (row) {
      var r = row.getBoundingClientRect();
      var len = (term.cols || 80);
      if (r.width > 0 && r.height > 0) return { w: r.width / len, h: r.height };
    }
  } catch(_){}
  return null;
}
```

### Move sequence

```js
function sendCursorMove(ws, term, dx) {
  if (!ws || ws.readyState !== 1 || !dx) return;
  var appMode = false;
  try { appMode = !!term.modes.applicationCursorKeysMode; } catch(_){}
  var seq = dx < 0
    ? (appMode ? '\x1bOD' : '\x1b[D')
    : (appMode ? '\x1bOC' : '\x1b[C');
  var n = Math.abs(dx);
  if (n > 200) return;       // sanity cap
  var out = '';
  for (var i = 0; i < n; i++) out += seq;
  ws.send(out);
}
```

DECCKM mode is read from `term.modes.applicationCursorKeysMode`. xterm.js 5.x exposes this getter publicly.

---

## Section 2: Selection-Delete in Current Input

### Behavior

- User selects text by drag → xterm shows highlight as usual.
- User presses **Delete** or **Backspace** while selection is active.
- If selection is a single visual row AND that row equals current cursor row:
  1. Move cursor to selection start column.
  2. Send `\x1b[3~` (Delete forward) `(endColumn − startColumn)` times.
  3. Clear xterm selection.
- Otherwise: do nothing — let the keydown propagate (or xterm's default — selecting text and pressing a key will normally clear the selection).

### Detection

Hook into existing `term.attachCustomKeyEventHandler`. The pane already uses this to special-case Shift+Enter and paste. Extend the handler to recognize Delete/Backspace with active selection.

Inside `createPaneElement`, locate the `term.attachCustomKeyEventHandler(...)` block and add a new branch BEFORE the existing Shift+Enter branch:

```js
if ((kev.key === 'Delete' || kev.key === 'Backspace') && term.hasSelection()) {
  var sel = term.getSelectionPosition();
  var cur = term.buffer.active;
  if (sel && sel.startRow === sel.endRow && sel.startRow === cur.cursorY) {
    var ws_ = panes[s.id] && panes[s.id].ws;
    if (ws_ && ws_.readyState === 1) {
      var moveDx = sel.startColumn - cur.cursorX;
      sendCursorMove(ws_, term, moveDx);
      var delLen = sel.endColumn - sel.startColumn;
      if (delLen > 0 && delLen <= 500) {
        var del = '';
        for (var i = 0; i < delLen; i++) del += '\x1b[3~';
        ws_.send(del);
      }
      term.clearSelection();
    }
    return false;  // swallow event
  }
}
```

`term.getSelectionPosition()` is xterm.js public API in 5.x and returns `{startRow, startColumn, endRow, endColumn}` with row/col **relative to the entire scrollback buffer** (not the viewport). Same for `cursorY` (which is **viewport-relative**).

To compare: convert cursor to absolute = `term.buffer.active.viewportY + cursorY`. Adjust the comparison:

```js
var curAbsRow = term.buffer.active.viewportY + cur.cursorY;
if (sel.startRow === sel.endRow && sel.startRow === curAbsRow) { ... }
```

### Multi-row selection

Falls through (returns `true` / does nothing). xterm.js then handles the keydown — typically the selection is cleared and the key is forwarded. This is acceptable for v1.

---

## Section 3: Sidebar Toggle on Main Bar

### Behavior

- A `📁 Files` button on `#bar`, placed next to the 🔔 notification button.
- Click toggles `#sidebar.collapsed` (same logic as existing `≡` in-sidebar button).
- Visual: highlighted when sidebar is open, muted when collapsed.

### Implementation

Add HTML to `#bar`:

```html
<button class="btn btn-ghost" id="btn-sidebar-main" onclick="toggleSidebar()" title="Show/hide files">&#x1F4C1; Files</button>
```

Modify existing `toggleSidebar()` to also update the new button visual:

```js
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  updateSidebarBtn();
  setTimeout(function() { fitSubtree(layoutTrees[currentTab]); }, 220);
}

function updateSidebarBtn() {
  var btn = document.getElementById('btn-sidebar-main');
  if (!btn) return;
  var collapsed = document.getElementById('sidebar').classList.contains('collapsed');
  btn.style.color = collapsed ? '' : 'var(--orange)';
  btn.title = collapsed ? 'Show files' : 'Hide files';
}
```

Call `updateSidebarBtn()` once on page load, before `connectCtrl()`.

---

## Section 4: Pane Header Container Queries

### Behavior

When a pane is squeezed (horizontal split), pane header buttons are hidden in priority order from least → most important. The close (×) button is never hidden.

### Priority order (least important hidden first)

| Pane width | Hidden |
|---|---|
| < 380px | export 💾, note ✏ |
| < 340px | folder 📁, zoom ⤢ |
| < 290px | lane A/P/D buttons, AUTO badge |
| < 250px | folder path text |
| < 210px | split ⊞, split ⊟ |
| < 170px | tag area, name truncates to 80px max |

Always visible: status dot, name (possibly truncated), resume/kill (status-dependent), close ×.

### CSS

```css
.pane { container-type: inline-size; container-name: pane; }

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

### Compatibility

CSS container queries are supported in all evergreen browsers (Chrome 105+, Firefox 110+, Safari 16+). Claude Hub is local-network only on user's own browser → no fallback needed.

---

## What Is NOT Changed

- `server.js` — zero changes
- WebSocket protocol, PTY, session lifecycle
- xterm.js terminal instance lifecycle
- Existing keyboard shortcuts
- Existing localStorage keys

---

## File Impact

- `public/index.html`:
  - New helpers: `getCellSize`, `sendCursorMove`, `updateSidebarBtn`
  - New `term.element` click listener inside `createPaneElement`
  - New branch in existing `term.attachCustomKeyEventHandler` for selection-delete
  - Extended `toggleSidebar` to call `updateSidebarBtn`
  - New `📁 Files` button HTML in `#bar`
  - New CSS: `.pane { container-type:inline-size; container-name:pane; }` + 6 `@container` rules
  - `updateSidebarBtn()` call in page-load init
