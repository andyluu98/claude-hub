function setActiveSession(sid) {
  if (!sid || !state[sid]) return;
  activeSid = sid;
  document.querySelectorAll('.pane').forEach(function(el) { el.classList.remove('active-pane'); });
  var p = panes[sid];
  if (p) {
    p.el.classList.add('active-pane');
    sbBrowse(state[sid].cwd);
  }
}

// Global paste → forward clipboard to active session PTY (text + image)
document.addEventListener('paste', function(e) {
  var tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (!activeSid) return;
  var p = panes[activeSid];
  if (!p || p.ws.readyState !== 1) return;

  var items = (e.clipboardData || window.clipboardData).items;
  if (items) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        var blob = items[i].getAsFile();
        var reader = new FileReader();
        reader.onload = function() {
          var s = state[activeSid];
          fetch('/api/paste-image', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ data: reader.result, cwd: s ? s.cwd : '' })
          }).then(function(r){return r.json();}).then(function(j) {
            if (j.ok) { p.ws.send('@' + j.path + ' '); toast('Pasted image: ' + j.name); }
            else toast('Image paste error: ' + (j.error||''));
          });
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  }

  var text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text) return;
  var CR = String.fromCharCode(13), LF = String.fromCharCode(10);
  text = text.split(CR + LF).join(LF).split(CR).join(LF);
  p.ws.send(text);
  e.preventDefault();
});

// ── Toast ─────────────────────────────────────────────────────────
var toastTimer;
function toast(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { t.classList.remove('show'); }, 2500);
}
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Apply saved theme on load
applyTheme(currentTheme);

document.getElementById('btn-font-size').textContent = termFontSize + 'px';
document.addEventListener('keydown', function(kbEv) {
  var tag = document.activeElement ? document.activeElement.tagName : '';
  if ((tag === 'INPUT' || tag === 'TEXTAREA') && !document.activeElement.closest('.xterm')) return;

  if (kbEv.ctrlKey && kbEv.shiftKey && kbEv.key === 'N') {
    kbEv.preventDefault();
    newSession();
    return;
  }
  if (kbEv.ctrlKey && kbEv.shiftKey && kbEv.key === 'W') {
    kbEv.preventDefault();
    var active = document.querySelector('.pane.active');
    if (active) {
      var sid = active.id.replace('pane-', '');
      var sName = state[sid] ? state[sid].name : sid;
      if (confirm('Close session "' + sName + '"?')) {
        fetch('/api/sessions/' + sid, { method: 'DELETE' });
      }
    }
    return;
  }
  var kbLanes = ['active', 'pending', 'done'];
  if (kbEv.ctrlKey && kbEv.shiftKey && kbEv.key === ']') {
    kbEv.preventDefault();
    switchTab(kbLanes[(kbLanes.indexOf(currentTab) + 1) % 3]);
    return;
  }
  if (kbEv.ctrlKey && kbEv.shiftKey && kbEv.key === '[') {
    kbEv.preventDefault();
    switchTab(kbLanes[(kbLanes.indexOf(currentTab) + 2) % 3]);
    return;
  }
});

updateNotifyBtn();
connectCtrl();
