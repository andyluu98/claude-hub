# Notifications — Claude Hub

**Date:** 2026-04-27
**Status:** Approved

---

## Goals

Notify the user when a Claude Code session changes state to `idle` (waiting for input — task just finished a turn) or `done` (process exited). Three notification surfaces fire together:

1. **In-app toast** — always
2. **Web Audio API beep** — always (different tone for `idle` vs `done`)
3. **Browser notification** — only when the tab is hidden (`document.hidden`), and only if user has granted permission

Zero changes to `server.js`. All detection happens client-side by diffing session state on each `connectCtrl` message.

---

## Section 1: Status Change Detection

### Trigger

Inside `connectCtrl`'s `onmessage` handler — for each session in the incoming state update, compare the new status against `prevStatus[sid]`.

### Detection rules

```
prevStatus[sid] === 'running' && newStatus === 'idle'  → notifySessionChange(sid, 'idle')
prevStatus[sid] === 'running' && newStatus === 'done'  → notifySessionChange(sid, 'done')
```

After the check, always update `prevStatus[sid] = newStatus`.

### First-load suppression

If `prevStatus[sid]` is `undefined` (session seen for the first time, e.g. on page reload), only initialize `prevStatus[sid] = newStatus` and **skip notification**. This prevents a notification flood when the page reloads with sessions already in `idle`/`done`.

### Cleanup

When a session is removed from `state` (DELETE event), `delete prevStatus[sid]`.

---

## Section 2: Notification Function

```js
function notifySessionChange(sid, newStatus) {
  if (!notifyEnabled) return;
  var s = state[sid];
  if (!s) return;
  var title;
  if (newStatus === 'idle') title = '⏸ Session idle';
  else if (newStatus === 'done') title = '✓ Session done';
  else return;
  var body = (s.name || sid) + (s.cwd ? '\n' + s.cwd : '');

  toast(title + ' — ' + (s.name || sid));
  playNotifySound(newStatus);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body: body, tag: 'claude-hub-' + sid }); } catch(_){}
  }
}
```

The `tag` field replaces any earlier notification for the same session, so a session that flips `running→idle→running→idle` doesn't pile up notifications in OS notification center.

---

## Section 3: Sound (Web Audio API)

No audio files. A single `AudioContext` is lazy-created on first use.

### Tones

- **idle** — soft cue: one tone, 600 Hz, sine wave, 80 ms, gain 0.08 with 10 ms fade-in / 60 ms fade-out
- **done** — clearer cue: two tones in sequence, 880 Hz then 660 Hz, triangle wave, 100 ms each (gap 30 ms), gain 0.15 with same envelope

### Implementation

```js
var audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(_) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function beep(freq, type, durMs, gainPeak, startOffsetMs) {
  var ctx = ensureAudio();
  if (!ctx) return;
  var t0 = ctx.currentTime + (startOffsetMs || 0) / 1000;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.01);
  gain.gain.linearRampToValueAtTime(0, t0 + durMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}
function playNotifySound(kind) {
  if (kind === 'idle') beep(600, 'sine', 80, 0.08, 0);
  else if (kind === 'done') { beep(880, 'triangle', 100, 0.15, 0); beep(660, 'triangle', 100, 0.15, 130); }
}
```

### Audio context unlock

Browsers require a user gesture before `AudioContext.resume()` can play. The toggle button click (Section 5) calls `ensureAudio()` once to unlock. After that, `playNotifySound` works for the rest of the session.

---

## Section 4: Permission Flow + Persistence

### State

- `notifyEnabled` — global boolean
- `localStorage['claude-hub-notify']` — `'on'` | `'off'`. Defaults to `'off'` on first run (don't surprise the user)

### Toggle behaviour

When user clicks the 🔔 button:

```
if notifyEnabled is currently true:
   set notifyEnabled = false
   localStorage = 'off'
   update button visual (dim)
else:
   call ensureAudio() to unlock the audio context (counts as a user gesture)
   if Notification.permission === 'default':
       Notification.requestPermission().then(perm => {
           // turn on regardless — sound + toast still work even if browser perm denied
           notifyEnabled = true
           localStorage = 'on'
           update button visual (highlighted)
       })
   else:
       notifyEnabled = true
       localStorage = 'on'
       update button visual
```

### On page load

`notifyEnabled = localStorage.getItem('claude-hub-notify') === 'on'`. Apply visual state to button. Do **not** auto-prompt for permission.

---

## Section 5: UI — Toggle Button

A `🔔` button in `#bar` next to the broadcast button. Two visual states:

- **On**: yellow icon (style="color:var(--orange)"), title="Notifications on"
- **Off**: muted icon (default color), title="Notifications off"

Click → calls `toggleNotifications()` from Section 4.

### HTML

```html
<button class="btn btn-ghost" id="btn-notify" onclick="toggleNotifications()" title="Notifications off">&#x1F514;</button>
```

### Styling

No new CSS rules. Inline style toggled via JS:

```js
function updateNotifyBtn() {
  var btn = document.getElementById('btn-notify');
  if (!btn) return;
  btn.style.color = notifyEnabled ? 'var(--orange)' : '';
  btn.title = notifyEnabled ? 'Notifications on' : 'Notifications off';
}
```

---

## What Is NOT Changed

- `server.js` — zero changes
- Session lifecycle, PTY, WebSocket protocol
- Any existing localStorage keys
- xterm.js terminals
- Existing `state` object structure

---

## File Impact

- `public/index.html`:
  - New globals: `prevStatus = {}`, `notifyEnabled`, `audioCtx`
  - New functions: `notifySessionChange`, `ensureAudio`, `beep`, `playNotifySound`, `toggleNotifications`, `updateNotifyBtn`
  - Status diff hook inside `connectCtrl` `onmessage`
  - Cleanup hook on session DELETE
  - 🔔 button in `#bar`
  - Init block before `connectCtrl()` call
