// ── Control WebSocket ─────────────────────────────────────────────
function connectCtrl() {
  ctrlWs = new WebSocket('ws://' + location.host + '/');
  ctrlWs.onopen = function() {
    var b = document.getElementById('ws-badge');
    b.textContent = 'Connected';
    b.className = 'ok';
    retryCount = 0;
  };
  ctrlWs.onclose = function() {
    var b = document.getElementById('ws-badge');
    b.textContent = 'Disconnected...';
    b.className = '';
    setTimeout(connectCtrl, Math.min(5000, 1000 * ++retryCount));
  };
  ctrlWs.onerror = function() { ctrlWs.close(); };
  ctrlWs.onmessage = function(e) {
    var msg = JSON.parse(e.data);
    if (msg.type === 'init') {
      msg.sessions.forEach(function(s) { state[s.id] = s; prevStatus[s.id] = s.status; });
      rebuildGrid();
    } else if (msg.type === 'session_created') {
      state[msg.session.id] = msg.session;
      prevStatus[msg.session.id] = msg.session.status;
      addPane(msg.session);
    } else if (msg.type === 'session_update') {
      var prev = prevStatus[msg.session.id];
      state[msg.session.id] = msg.session;
      var nw = msg.session.status;
      if (prev === 'running' && (nw === 'idle' || nw === 'done')) {
        notifySessionChange(msg.session.id, nw);
      }
      prevStatus[msg.session.id] = nw;
      updatePaneHead(msg.session.id);
    } else if (msg.type === 'session_removed') {
      delete state[msg.id];
      delete prevStatus[msg.id];
      removePane(msg.id);
    }
    document.getElementById('hdr-count').textContent = Object.keys(state).length + ' sessions';
    try { updateTabCounts(); } catch(_){}
  };
}
