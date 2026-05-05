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

function toggleBroadcast() {
  var bar = document.getElementById('broadcast-bar');
  var inp = document.getElementById('inp-broadcast');
  var visible = bar.style.display !== 'none';
  if (visible) {
    bar.style.display = 'none';
    inp.value = '';
  } else {
    bar.style.display = 'flex';
    setTimeout(function() { inp.focus(); }, 50);
  }
}

function sendBroadcast(cmd) {
  if (!cmd) return;
  var count = 0;
  Object.keys(panes).forEach(function(sid) {
    var p = panes[sid];
    var s = state[sid];
    if (p && s && s.status === 'running' && p.ws && p.ws.readyState === 1) {
      p.ws.send(cmd + '\r');
      count++;
    }
  });
  if (count === 0) {
    toast('No running sessions to broadcast to');
  } else {
    toast('Sent to ' + count + ' running session' + (count !== 1 ? 's' : ''));
  }
}
