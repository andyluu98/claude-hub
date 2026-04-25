# UX Features Batch 2 — Claude Hub

**Date:** 2026-04-25  
**Status:** Approved

---

## Goals

Add 4 UX improvements to Claude Hub, all in `public/index.html` only:

1. Terminal search (Ctrl+F) using xterm.js SearchAddon
2. Drag-drop pane reorder by swapping layout tree leaf nodes
3. Session tags with filter integration
4. Quick-start session templates

---

## Section 1: Terminal Search

### Trigger
- Ctrl+F when a terminal pane is focused (cursor is in xterm) → search bar opens below that pane's header
- Also: click a 🔍 button on the pane header (optional secondary trigger)

### UI
```
[pane-head: name, buttons...]
[🔍 <input placeholder="Search..."> ] [▲] [▼] [3/12] [Aa] [✕]
[xterm terminal — matches highlighted in yellow]
```

### Implementation
- Load `xterm-addon-search` from CDN alongside existing addons:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-search@0.1.0/lib/addon-search.min.js"></script>
  ```
- Each pane gets a `search` property: `panes[sid] = { term, ws, fit, search, el, opened }`
- `search = new SearchAddon.SearchAddon()` — loaded and attached via `term.loadAddon(search)` at pane creation
- Search bar HTML injected below `.pane-head` when opened, removed when closed
- `search.findNext(query, { caseSensitive })` / `search.findPrevious(...)` on each keypress (debounced 100ms)
- Match count: xterm SearchAddon fires `onDidChangeResults` event → update `N/M` display
- Case-sensitive toggle: `Aa` button stores state in `var searchCaseSensitive = false`
- Escape / ✕ closes bar, clears highlight via `search.clearDecorations()`
- One search bar open at a time (opening a new one closes the previous)

### Keyboard
- Ctrl+F → open (only when `.xterm` is focused or pane is active)
- Enter / Shift+Enter → next / previous
- Escape → close

---

## Section 2: Drag-Drop Pane Reorder

### Behavior
- Hover pane header → cursor becomes `grab`
- Mousedown on pane header + drag ≥ 5px → drag mode starts:
  - Dragged pane: `opacity: 0.4`
  - Hovered pane: blue border highlight
- Drop on a different pane → swap the two `sessionId` values in the layout tree leaves
- Drop on same pane or outside canvas → cancel, no change

### Implementation
- Single `dragState` object: `{ dragging: false, fromSid: null }`
- `mousedown` on `.pane-head` → set `dragState.fromSid`, listen for `mousemove` threshold
- `mousemove` on `document` → find pane under cursor via `document.elementFromPoint`, highlight target
- `mouseup` on `document` → `swapLeaves(layoutTrees[currentTab], fromSid, toSid)` → `saveLayoutTree` → `rebuildCanvas()`
- `swapLeaves(tree, sidA, sidB)` — recursive: when both leaves found, swap their `sessionId` fields in-place

### CSS
```css
.pane-head { cursor: grab; }
.pane-head:active { cursor: grabbing; }
.pane.drag-source { opacity: 0.4; }
.pane.drag-target { outline: 2px solid var(--blue); }
```

### Constraints
- Only within the same lane (`currentTab`)
- Disabled during zoom mode (`zoomedSid` is set) and filter mode (`sessionFilter` non-empty)

---

## Section 3: Session Tags

### Data Structure
```js
var sessionTags = JSON.parse(localStorage.getItem('claude-hub-tags') || '{}');
// { "sessionId": ["frontend", "urgent"], ... }
```

### UI — Pane Header
```
[● Session A]  [#frontend] [#urgent] [+tag]  [✏ 💾 ⤢ ...]
```
- Tags displayed as small chips after session name, before action buttons
- Max 3 chips visible; overflow shows `+N` chip
- `+tag` button opens tag popup

### Tag Popup
- Position: below the `+tag` button (same clamped viewport positioning as color/note popups)
- Content:
  - List of all existing tags (across all sessions) as toggleable chips — filled = applied to this session
  - Text input at bottom: type new tag name + Enter to create and apply
  - Click existing chip to toggle on/off for this session
- Dismiss on outside click (same `dismiss` pattern as other popups)

### Filter Integration
Extend `sessionFilter` matching in `rebuildCanvas` to also check tags:
```js
return (s.name || '').toLowerCase().indexOf(sessionFilter) >= 0 ||
       (s.cwd  || '').toLowerCase().indexOf(sessionFilter) >= 0 ||
       (sessionTags[sid] || []).some(function(t) {
         return t.toLowerCase().indexOf(sessionFilter) >= 0;
       });
```

### CSS
```css
.tag-chip { display:inline-flex; align-items:center; gap:3px; padding:1px 6px; border-radius:10px; font-size:10px; background:rgba(88,166,255,.15); color:var(--blue); border:1px solid rgba(88,166,255,.25); white-space:nowrap; }
.tag-chip.add-tag { background:transparent; border-style:dashed; color:var(--muted); cursor:pointer; }
.tag-chip.add-tag:hover { color:var(--text); border-color:var(--border-strong); }
```

---

## Section 4: Quick-Start Templates

### Data Structure
```js
var sessionTemplates = JSON.parse(localStorage.getItem('claude-hub-templates') || '[]');
// [{ id: "uuid", label: "Frontend Dev", name: "Frontend", cwd: "C:/projects/fe", autoAccept: false }, ...]
```

### UI — New Session Button
```
[+ New ▼]
```
The existing `+ New Session` button gains a small `▼` dropdown arrow on the right.

### Dropdown Panel
```
┌─────────────────────────┐
│ Frontend Dev            │
│ Backend API             │
│ ─────────────────────── │
│ + Save current as tmpl  │
│ ✎ Manage templates      │
└─────────────────────────┘
```
- Clicking a template row: fills Name input + CWD input + sets auto-accept toggle → calls `newSession()`
- "Save current": prompts for label → saves current `#inp-name` + `#inp-cwd` + auto-accept state
- "Manage": inline list with delete (✕) per template — no separate modal needed

### Implementation
- `#btn-new` button HTML split into: `[+ New]` (existing onclick) + `[▼]` (opens dropdown)
- Template panel: `position:absolute` below the `▼` button, same pattern as preset panel (Task 9)
- `applyTemplate(id)`: reads template, sets input values via `.value =`, triggers `newSession()`
- Dismiss on outside click (same `presetDismiss` pattern)

---

## What Is NOT Changed

- `server.js` — zero changes
- WebSocket / PTY session logic
- Split-pane tree structure (drag-drop only swaps `sessionId` values, not tree shape)
- Existing keyboard shortcuts (Ctrl+F guard: only fires when xterm focused)

---

## File Impact

Only `public/index.html` is modified:
1. Add SearchAddon CDN script tag
2. CSS: `.pane-head grab`, `.drag-source/.drag-target`, `.tag-chip`, template panel
3. HTML: search bar template (injected dynamically), tag chips in pane head, `▼` button on New Session
4. JS: `searchAddon` per pane, `dragState`, `swapLeaves`, `sessionTags`, `sessionTemplates`, related functions
