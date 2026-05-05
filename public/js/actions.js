// ── Actions ───────────────────────────────────────────────────────
function newSession() {
  var nameEl = document.getElementById('inp-name');
  var name = nameEl ? nameEl.value.trim() : '';
  var autoAccept = document.getElementById('chk-auto').checked;
  var engine = document.getElementById('sel-engine').value;
  
  // selectedCwd might be empty, server will handle default home dir
  fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, cwd: selectedCwd, autoAccept: autoAccept, engine: engine }),
  })
  .then(function(r) { return r.json(); })
  .then(function(s) {
    if (s.id) toast('Created ' + (s.engine||'session'));
    else toast('Error creating session');
  })
  .catch(function(e) { toast('Error: ' + e.message); });

  if (nameEl) nameEl.value = '';
}

function buildBalancedTree(sids, dir) {
  if (sids.length === 0) return null;
  if (sids.length === 1) return { type: 'leaf', sessionId: sids[0] };
  var mid = Math.floor(sids.length / 2);
  var nextDir = dir === 'h' ? 'v' : 'h';
  return {
    type: 'split',
    dir: dir,
    ratio: 0.5,
    children: [
      buildBalancedTree(sids.slice(0, mid), nextDir),
      buildBalancedTree(sids.slice(mid), nextDir)
    ]
  };
}

function resetLayout() {
  var lane = currentTab;
  var sids = Object.values(state)
    .filter(function(s) { return (s.lane || 'active') === lane; })
    .map(function(s) { return s.id; });
  
  if (sids.length === 0) {
    layoutTrees[lane] = null;
  } else {
    sids.sort();
    layoutTrees[lane] = buildBalancedTree(sids, 'h');
  }
  saveLayoutTree(lane, layoutTrees[lane]);
  rebuildCanvas();
  setTimeout(function() {
    fitSubtree(layoutTrees[lane]);
  }, 100);
  toast('Layout reset to grid');
}

function killAll() {
  if (!confirm('Stop all sessions? (kept for Resume later)')) return;
  Object.values(state).forEach(function(s) {
    if (s.status === 'running') fetch('/api/sessions/' + s.id + '/kill', { method:'POST' });
  });
}

function resumeAll() {
  fetch('/api/sessions/resume-all', { method:'POST' })
    .then(function(r) { return r.json(); })
    .then(function(j) { toast('Resumed ' + (j.resumed || 0) + ' sessions'); });
}

