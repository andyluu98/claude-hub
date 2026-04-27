# Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify the user (toast + sound + browser notification) when a Claude Code session transitions `running → idle` or `running → done`.

**Architecture:** Pure client-side. Diff session status inside the existing `connectCtrl` `onmessage` handler against a `prevStatus[sid]` map. Three notification surfaces fire together: toast (always), Web Audio API beep (always — different tone for idle vs done), browser notification (only when `document.hidden` and permission granted). Toggle button persists user preference in localStorage. Audio context is unlocked by the user's first click on the toggle button.

**Tech Stack:** Vanilla JS ES5, Web Audio API, Web Notifications API, localStorage.

---

## File Impact

Only `public/index.html` is modified.

Key anchors (use text search, not line numbers — line numbers will shift as steps are applied):
- Global vars block: search `var state = {};`
- `connectCtrl` function: search `function connectCtrl()`
- `connectCtrl` `onmessage` body: search `if (msg.type === 'init')`
- `session_removed` branch: search `delete state[msg.id];`
- Bar HTML: search `id="btn-broadcast"`
- Page-load init point: search `connectCtrl();` (very last line of `<script>`)
- Helper insertion point for new functions: search `function toggleBroadcast()`

---

## Task 1: Add globals and notification function

**Files:** Modify `public/index.html`

- [ ] **Step 1: Add globals**

Find `var state = {};      // sessionId -> session JSON`. Add immediately before it:

```js
var prevStatus = {};
var notifyEnabled = localStorage.getItem('claude-hub-notify') === 'on';
var audioCtx = null;
```

- [ ] **Step 2: Add audio + notification functions**

Find `function toggleBroadcast()`. Add immediately before it:

```js
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(_) { return null; }
  }
  if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch(_){} }
  return audioCtx;
}

function beep(freq, type, durMs, gainPeak, startOffsetMs) {
  var ctx = ensureAudio();
  if (!ctx) return;
  var t0 = ctx.currentTime + (startOffsetMs || 0) / 1000;
  var dur = durMs / 1000;
  try {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.01);
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch(_){}
}

function playNotifySound(kind) {
  if (kind === 'idle') {
    beep(600, 'sine', 80, 0.08, 0);
  } else if (kind === 'done') {
    beep(880, 'triangle', 100, 0.15, 0);
    beep(660, 'triangle', 100, 0.15, 130);
  }
}

function notifySessionChange(sid, newStatus) {
  if (!notifyEnabled) return;
  var s = state[sid];
  if (!s) return;
  var title;
  if (newStatus === 'idle') title = '⏸ Session idle';
  else if (newStatus === 'done') title = '✓ Session done';
  else return;
  var sname = s.name || sid;
  var body = sname + (s.cwd ? '\n' + s.cwd : '');
  toast(title + ' — ' + sname);
  playNotifySound(newStatus);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body: body, tag: 'claude-hub-' + sid }); } catch(_){}
  }
}

function updateNotifyBtn() {
  var btn = document.getElementById('btn-notify');
  if (!btn) return;
  btn.style.color = notifyEnabled ? 'var(--orange)' : '';
  btn.title = notifyEnabled ? 'Notifications on' : 'Notifications off';
}

function toggleNotifications() {
  if (notifyEnabled) {
    notifyEnabled = false;
    localStorage.setItem('claude-hub-notify', 'off');
    updateNotifyBtn();
    return;
  }
  ensureAudio();
  function turnOn() {
    notifyEnabled = true;
    localStorage.setItem('claude-hub-notify', 'on');
    updateNotifyBtn();
  }
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      var p = Notification.requestPermission(function() { turnOn(); });
      if (p && typeof p.then === 'function') { p.then(function() { turnOn(); }); }
    } catch(_) { turnOn(); }
  } else {
    turnOn();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add notification globals and helper functions (toast/sound/browser)"
```

---

## Task 2: Hook status diff into ctrlWs.onmessage

**Files:** Modify `public/index.html`

**Background:** `ctrlWs.onmessage` already routes 5 message types. We hook `init`, `session_created`, `session_update`, and `session_removed` to maintain `prevStatus` and fire notifications on transitions.

- [ ] **Step 1: Hook `init` (initialize prevStatus, do NOT notify)**

Find:
```js
    if (msg.type === 'init') {
      msg.sessions.forEach(function(s) { state[s.id] = s; });
      rebuildGrid();
      if (msg.overseer) document.getElementById('overseer-rule').textContent = msg.overseer.rule;
```

Replace with:
```js
    if (msg.type === 'init') {
      msg.sessions.forEach(function(s) { state[s.id] = s; prevStatus[s.id] = s.status; });
      rebuildGrid();
      if (msg.overseer) document.getElementById('overseer-rule').textContent = msg.overseer.rule;
```

- [ ] **Step 2: Hook `session_created` (initialize prevStatus, do NOT notify)**

Find:
```js
    } else if (msg.type === 'session_created') {
      state[msg.session.id] = msg.session;
      addPane(msg.session);
```

Replace with:
```js
    } else if (msg.type === 'session_created') {
      state[msg.session.id] = msg.session;
      prevStatus[msg.session.id] = msg.session.status;
      addPane(msg.session);
```

- [ ] **Step 3: Hook `session_update` (diff status, notify on running→idle/done)**

Find:
```js
    } else if (msg.type === 'session_update') {
      state[msg.session.id] = msg.session;
      updatePaneHead(msg.session.id);
```

Replace with:
```js
    } else if (msg.type === 'session_update') {
      var prev = prevStatus[msg.session.id];
      state[msg.session.id] = msg.session;
      var nw = msg.session.status;
      if (prev === 'running' && (nw === 'idle' || nw === 'done')) {
        notifySessionChange(msg.session.id, nw);
      }
      prevStatus[msg.session.id] = nw;
      updatePaneHead(msg.session.id);
```

- [ ] **Step 4: Hook `session_removed` (cleanup prevStatus)**

Find:
```js
    } else if (msg.type === 'session_removed') {
      delete state[msg.id];
      removePane(msg.id);
```

Replace with:
```js
    } else if (msg.type === 'session_removed') {
      delete state[msg.id];
      delete prevStatus[msg.id];
      removePane(msg.id);
```

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: diff session status in ctrl WS to trigger notifications"
```

---

## Task 3: Add 🔔 toggle button + init

**Files:** Modify `public/index.html`

- [ ] **Step 1: Add 🔔 button to #bar**

Find:
```html
  <button class="btn btn-ghost" id="btn-broadcast" onclick="toggleBroadcast()" title="Send command to all running sessions">&#x21F6; Broadcast</button>
```

Add immediately before it:
```html
  <button class="btn btn-ghost" id="btn-notify" onclick="toggleNotifications()" title="Notifications off">&#x1F514;</button>
```

- [ ] **Step 2: Initialize button visual on load**

Find `connectCtrl();` at the very bottom of `<script>`. Add immediately before it:

```js
updateNotifyBtn();
```

- [ ] **Step 3: Verify manually**

1. Reload app. The 🔔 button is muted by default. No permission prompt yet.
2. Click 🔔 → if first time, browser asks for notification permission. Grant or deny — either way the button turns yellow. localStorage `claude-hub-notify=on`.
3. Reload page → button is yellow on load. No notifications fire for already-existing sessions (first-load suppression).
4. Open a session, run a Claude task, wait until it returns to prompt (status `idle`) → toast appears, soft beep plays. If tab is hidden, OS-level notification appears.
5. Close a session → done sound (two tones) plays.
6. Click 🔔 → button dims, localStorage `=off`. Notifications stop firing.
7. Open DevTools console — no errors.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add 🔔 notifications toggle button to bar"
```

---

## Self-Review

**Spec coverage:**
- ✅ Status diff with `prevStatus` map — Task 2 Steps 1–4
- ✅ First-load suppression — Tasks 2 Steps 1, 2 (init prevStatus without notifying)
- ✅ `notifySessionChange` (toast + sound + conditional browser notification) — Task 1 Step 2
- ✅ Web Audio API beeps with different tones for idle vs done — Task 1 Step 2
- ✅ Audio context unlock via toggle click — Task 1 Step 2 (`ensureAudio` called from `toggleNotifications`)
- ✅ Permission flow with `Notification.requestPermission` (callback + promise dual support) — Task 1 Step 2
- ✅ localStorage persistence (`claude-hub-notify`) — Task 1 Steps 1, 2
- ✅ 🔔 toggle button — Task 3 Step 1
- ✅ Button visual state via `updateNotifyBtn` — Task 1 Step 2, Task 3 Step 2
- ✅ Cleanup `prevStatus[sid]` on session_removed — Task 2 Step 4
- ✅ Zero server changes

**Placeholder scan:** No TBD/TODO. All steps show exact code.

**Type consistency:**
- `prevStatus[sid]` is `string | undefined` throughout ✅
- `notifyEnabled` is boolean ✅
- `audioCtx` is `AudioContext | null` (lazy-init) ✅
- All function signatures match between definition and call sites ✅
- `notifySessionChange(sid, newStatus)` called only with `'idle'` or `'done'` (guarded by `if` in Task 2 Step 3) ✅

**Edge cases handled:**
- `Notification` API missing in browser → `'Notification' in window` guard ✅
- AudioContext creation throws (some old browsers) → `try/catch` returns null ✅
- AudioContext suspended (Chrome autoplay policy) → `resume()` called in `ensureAudio` ✅
- Notification API throws when constructing → wrapped in `try/catch` ✅
- Promise vs callback form of `requestPermission` (Safari uses callback) → both paths supported ✅
- Page reload with sessions in `idle`/`done` already → suppressed by first-load init ✅
