# UI Redesign — Claude Hub

**Date:** 2026-04-25  
**Status:** Approved  

---

## Goals

1. Reduce top chrome from ~148px to ~80px by merging 3 rows into 2.
2. Replace free-floating canvas panes with a split-pane layout (drag-to-resize dividers between terminals).
3. Add light theme with a toggle button in the header (localStorage persisted).
4. Zero impact on existing sessions, PTY connections, WebSocket logic, or session data.

---

## Section 1: Layout Structure

### Before (3 rows ~148px)
```
header   (~40px): logo + WS badge
tab-bar  (~50px): Active | Pending | Done buttons
bar      (~58px): Name input, CWD, Auto-accept, New Session, Resume All, Stop All, Layout selector, Overseer
```

### After (2 rows ~80px)
```
Row 1 (~40px): logo | [Active N] [Pending N] [Done N] | flex spacer | [☀️/🌙] [● WS]
Row 2 (~40px): [Name input] [📁 CWD] [⚡ Auto-accept] [+ New] [▶ Resume All] [Stop All] | flex spacer | [🧠 Overseer]
```

**Removed:** Layout selector (Tile/Cols/Rows/Cascade/Focus) — replaced by split-pane system.

### Workspace
```
┌──────────────────────────────────────────────┐
│ Sidebar 300px  │  Split-pane canvas           │
│ (file explorer │  ┌───────────┬───────────┐  │
│  unchanged)    │  │ Terminal  ║ Terminal  │  │
│                │  │     A     ║     B     │  │
│                │  ├═══════════╩═══════════┤  │
│                │  │      Terminal C        │  │
│                │  └───────────────────────┘  │
└──────────────────────────────────────────────┘
```
`║` and `═` = draggable dividers.

---

## Section 2: Light Theme

### Toggle
- Button in Row 1 header: `☀️` (switch to light) / `🌙` (switch to dark).
- State saved to `localStorage` key `claude-hub-theme`.
- Applied as `data-theme="light"` on `<html>` element.

### CSS Variables

**Dark (existing, unchanged):**
```css
:root {
  --bg: #07090d;  --bg2: #0d1117;
  --panel: rgba(22,27,34,.85);  --panel-solid: #161b22;
  --border: #262c36;  --border-strong: #3a4150;
  --text: #e6edf3;  --text-dim: #b1bac4;  --muted: #6e7681;
}
```

**Light (new):**
```css
[data-theme="light"] {
  --bg: #f6f8fa;  --bg2: #ffffff;
  --panel: rgba(246,248,250,.92);  --panel-solid: #ffffff;
  --border: #d0d7de;  --border-strong: #afb8c1;
  --text: #1f2328;  --text-dim: #424a53;  --muted: #6e7781;
  --shadow-md: 0 4px 12px rgba(0,0,0,.12);
  --shadow-lg: 0 12px 32px rgba(0,0,0,.18);
}
```

**Canvas dot-grid in light mode:**
```css
[data-theme="light"] #canvas {
  background:
    radial-gradient(circle, rgba(0,0,0,.04) 1px, transparent 1px) 0 0 / 24px 24px,
    var(--bg);
}
```

**xterm.js theme in light mode:**
```js
const TERM_THEME_LIGHT = {
  background: '#ffffff', foreground: '#1f2328',
  cursor: '#1f2328', selectionBackground: 'rgba(88,166,255,.3)',
  black: '#24292f', red: '#cf222e', green: '#116329',
  yellow: '#4d2d00', blue: '#0550ae', magenta: '#8250df',
  cyan: '#1b7c83', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37',
  brightYellow: '#633c01', brightBlue: '#0969da', brightMagenta: '#6639ba',
  brightCyan: '#3192aa', brightWhite: '#8c959f'
};
const TERM_THEME_DARK = {
  background: '#000000', foreground: '#e6edf3',
  cursor: '#e6edf3', selectionBackground: 'rgba(88,166,255,.3)'
  // standard 16 ANSI colors kept as xterm defaults
};
```
When theme toggles, call `term.options.theme = TERM_THEME_LIGHT/DARK` for all active terminals.

---

## Section 3: Split-pane Engine

### Data Structure

```js
// Leaf — wraps one terminal session
{ type: "leaf", sessionId: "abc123" }

// Split — two children with a draggable divider
{
  type: "split",
  dir: "h",       // "h" = horizontal (left|right), "v" = vertical (top|bottom)
  ratio: 0.5,     // fraction allocated to children[0]; range 0.1–0.9
  children: [nodeA, nodeB]
}
```

One layout tree per lane (`active`, `pending`, `done`). Stored in `localStorage` key `claude-hub-layout-{lane}`.

### Operations

| User action | Tree mutation |
|---|---|
| `+ New Session` (no existing panes) | Root becomes `{ type:"leaf", sessionId }` |
| `+ New Session` (panes exist) | Split the currently focused leaf `h`; if none focused, split the last leaf in tree traversal order; new session goes in `children[1]` |
| Click ⊞ on pane header | Split that leaf `h`; new session in `children[1]` |
| Click ⊟ on pane header | Split that leaf `v`; new session in `children[1]` |
| Drag divider | Update `ratio` on that split node; re-fit terminals |
| Close pane (×) | Replace parent split with the surviving sibling |

### Renderer

```
renderTree(node, containerEl)
  if node.type === "leaf":
    mount terminal pane into containerEl
  if node.type === "split":
    create flex container (row if h, column if v)
    renderTree(children[0], childEl-A)
    insert <div class="divider" data-dir={dir}>
    renderTree(children[1], childEl-B)
    apply flex-basis to childEl-A: ratio*100%, childEl-B: (1-ratio)*100%
```

### Divider Drag

```
divider.addEventListener("mousedown", e => {
  track mousemove on document
  compute new ratio from mouse delta / container size
  clamp ratio to [0.1, 0.9]
  update node.ratio + DOM flex-basis
  call fitAll(subtree)   // re-fit all xterm instances in subtree
  on mouseup: save layout to localStorage
})
```

### Migration from Current Sessions

On app load, if sessions exist and no saved layout for the lane:
- Build a balanced tile tree from the session list (same as current "Tile" layout).
- No PTY/WS restarts needed — just attach existing terminal elements into the new tree containers.

### Invariants
- A split node always has exactly 2 children.
- Closing one of 2 siblings replaces the parent split with the other sibling (no orphan splits).
- Minimum pane size: 200×150px (enforced by ratio clamp).

---

## What Is NOT Changed

- `server.js` — zero changes.
- WebSocket / PTY session logic.
- Session persistence (`.claude-hub-sessions.json`).
- File explorer sidebar (structure, resize handle, drag-drop).
- Overseer pane (collapsible, same position below Row 2).
- Modal (folder picker), context menu, toast notifications.
- All existing keyboard shortcuts and session controls.

---

## File Impact

Only `public/index.html` is modified:
1. CSS: add light theme variables, divider styles, update header/bar layout.
2. HTML: merge header + tab-bar into Row 1; remove `#layout-sel`; add theme toggle button.
3. JS: add `renderTree`, `dividerDrag`, `layoutTree` state, `applyTheme` function; update `newSession`, `removePane`, session-load logic.
