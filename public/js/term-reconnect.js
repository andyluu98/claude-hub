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
  if (attempt > TERM_RECONNECT_DELAYS.length) return; // safety: prevents infinite re-entry
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
  if (p.ws && (p.ws.readyState === 0 || p.ws.readyState === 1)) return;
  p.reconnectAttempt = 0;
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
