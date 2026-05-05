function createPaneElement(s) {
  if (panes[s.id]) return;
  var el = document.createElement('div');
  el.className = 'pane';
  el.id = 'pane-' + s.id;
  el.dataset.status = s.status;
  el.dataset.lane = s.lane || 'active';
  var lane = s.lane || 'active';
  el.innerHTML =
    '<div class="pane-head">' +
      '<span class="dot ' + s.status + '" data-color-dot="' + s.id + '" title="Click to set color label"></span>' +
      '<span class="nm">' + esc(s.name) + '</span>' +
      (s.engine === 'gemini' ? '<span style="font-size:9px;background:rgba(88,166,255,.2);color:var(--blue);border:1px solid rgba(88,166,255,.3);padding:1px 4px;border-radius:4px;margin-left:4px;font-weight:700">GEMINI</span>' : '') +
      (s.engine === 'codex' ? '<span style="font-size:9px;background:rgba(63,185,80,.2);color:var(--green);border:1px solid rgba(63,185,80,.3);padding:1px 4px;border-radius:4px;margin-left:4px;font-weight:700">CODEX</span>' : '') +
      (s.autoAccept ? '<span class="auto">AUTO</span>' : '') +
      '<span class="tag-area" data-tag-area="' + s.id + '"></span>' +
      '<span class="folder">' + esc(s.cwdShort || '?') + '</span>' +
      '<div style="flex:1"></div>' +
      '<span class="lane-btns">' +
        '<button title="Move to Active"  data-lane-set="active"  data-sid="' + s.id + '" class="' + (lane==='active'?'on':'') + '">A</button>' +
        '<button title="Move to Pending" data-lane-set="pending" data-sid="' + s.id + '" class="' + (lane==='pending'?'on':'') + '">P</button>' +
        '<button title="Move to Done"    data-lane-set="done"    data-sid="' + s.id + '" class="' + (lane==='done'?'on':'') + '">D</button>' +
      '</span>' +
      '<button title="Zoom / unzoom" data-zoom="' + s.id + '"></button>' +
      '<button title="Split right" data-split-h="' + s.id + '">&#x229E;</button>' +
      '<button title="Split down"  data-split-v="' + s.id + '">&#x229F;</button>' +
      '<button title="Session note" data-note="' + s.id + '" style="' + (sessionNotes[s.id] ? 'color:var(--orange)' : '') + '">&#x270F;</button>' +
      '<button title="Open folder" data-folder="' + s.id + '">&#x1F4C1;</button>' +
      '<button title="Export terminal output" data-export="' + s.id + '">&#x1F4BE;</button>' +
      '<button title="Resume" data-resume="' + s.id + '">&#x25B6;</button>' +
      '<button title="Stop" data-kill="' + s.id + '">&#x25A0;</button>' +
      '<button title="Delete" data-remove="' + s.id + '" style="font-weight:bold;font-size:22px;color:var(--red);padding:0 12px;margin-right:15px;background:rgba(248,81,73,.15);border-radius:6px;min-width:36px;display:inline-flex;align-items:center;justify-content:center;height:28px">&times;</button>' +
    '</div>' +
    '<div class="search-bar" id="search-bar-' + s.id + '">' +
      '<input type="text" id="search-inp-' + s.id + '" placeholder="Search..." autocomplete="off" spellcheck="false">' +
      '<span class="sb-count" id="search-count-' + s.id + '"></span>' +
      '<button id="search-case-' + s.id + '" title="Case sensitive (Alt+C)">Aa</button>' +
      '<button onclick="searchPrev(\'' + s.id + '\')" title="Previous (Shift+Enter)">&#x25B2;</button>' +
      '<button onclick="searchNext(\'' + s.id + '\')" title="Next (Enter)">&#x25BC;</button>' +
      '<button onclick="closeSearchBar(\'' + s.id + '\')" title="Close (Esc)">&#x2715;</button>' +
    '</div>' +
    '<div class="pane-body"><div class="xterm-wrap" id="term-' + s.id + '"></div></div>';

  var termTheme = currentTheme === 'light' ? TERM_THEME_LIGHT : TERM_THEME_DARK;
  var term = new Terminal({
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: termFontSize,
    theme: termTheme,
    cursorBlink: true, scrollback: 5000, allowProposedApi: true,
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  var search = null;
  try {
    if (typeof SearchAddon !== 'undefined') {
      search = new SearchAddon.SearchAddon();
      term.loadAddon(search);
    }
  } catch(_){}
  // term.open() is deferred until the pane element is in the real DOM (see openAndFitSubtree)

  var ws = new WebSocket('ws://' + location.host + '/term/' + s.id);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = function(e) {
    if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data));
    else term.write(e.data);
  };
  ws.onopen = function() {
    var pp = panes[s.id];
    if (!pp) return;
    pp.reconnectAttempt = 0;
    hideTermOverlay(s.id);
    setTimeout(function() {
      var pp2 = panes[s.id];
      if (pp2 && pp2.opened) {
        try { pp2.fit.fit(); pp2.ws.send(JSON.stringify({ type:'resize', cols:term.cols, rows:term.rows })); } catch(_){}
      }
    }, 100);
  };
  ws.onclose = function() { scheduleTermReconnect(s.id); };
  ws.onerror = function() { ws.close(); };
  term.onData(function(d) {
    var pp = panes[s.id];
    if (pp && pp.ws && pp.ws.readyState === 1) pp.ws.send(d);
  });
  term.onResize(function(sz) {
    var pp = panes[s.id];
    if (pp && pp.ws && pp.ws.readyState === 1) pp.ws.send(JSON.stringify({ type:'resize', cols:sz.cols, rows:sz.rows }));
  });

  term.attachCustomKeyEventHandler(function(ev) {
    if (ev.type !== 'keydown') return true;
    if (ev.ctrlKey && !ev.shiftKey && (ev.key === 'f' || ev.key === 'F')) {
      ev.preventDefault();
      openSearchBar(s.id);
      return false;
    }
    if (ev.ctrlKey && (ev.key === 'c' || ev.key === 'C') && !ev.shiftKey) {
      var sel = term.getSelection();
      if (sel && sel.length > 0) {
        ev.preventDefault();
        navigator.clipboard.writeText(sel).then(function() { toast('Copied ' + sel.length + ' chars'); term.clearSelection(); });
        return false;
      }
      return true;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && term.hasSelection && term.hasSelection()) {
      try {
        var sp = term.getSelectionPosition && term.getSelectionPosition();
        var cur = term.buffer.active;
        var curAbsRow = cur.viewportY + cur.cursorY;
        if (sp && sp.startRow === sp.endRow && sp.startRow === curAbsRow) {
          var ws_ = panes[s.id] && panes[s.id].ws;
          if (ws_ && ws_.readyState === 1) {
            ev.preventDefault();
            var moveDx = sp.startColumn - cur.cursorX;
            sendCursorMove(ws_, term, moveDx);
            var delLen = sp.endColumn - sp.startColumn;
            if (delLen > 0 && delLen <= 500) {
              var del = '';
              for (var di = 0; di < delLen; di++) del += '\x1b[3~';
              ws_.send(del);
            }
            term.clearSelection();
            return false;
          }
        }
      } catch(_){}
      return true;
    }
    if (ev.shiftKey && ev.key === 'Enter') {
      ev.preventDefault();
      var _ws = panes[s.id] && panes[s.id].ws;
      if (_ws && _ws.readyState === 1) _ws.send(String.fromCharCode(27) + '[13;2u');
      return false;
    }
    var isPaste = (ev.ctrlKey && (ev.key === 'v' || ev.key === 'V')) || (ev.shiftKey && ev.key === 'Insert');
    if (!isPaste) return true;
    ev.preventDefault();
    pasteFromClipboard(panes[s.id] && panes[s.id].ws, s.id);
    return false;
  });

  var termEl = el.querySelector('.xterm-wrap');
  el.addEventListener('mousedown', function() {
    if (activeSid !== s.id) setActiveSession(s.id);
  });
  termEl.addEventListener('contextmenu', function(ev) { ev.preventDefault(); pasteFromClipboard(panes[s.id] && panes[s.id].ws, s.id); });
  termEl.addEventListener('auxclick', function(ev) { if (ev.button !== 1) return; ev.preventDefault(); pasteFromClipboard(panes[s.id] && panes[s.id].ws, s.id); });
  termEl.addEventListener('dragenter', function(ev) { if (isFileDrag(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
  termEl.addEventListener('dragover', function(ev) { if (isFileDrag(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } });
  termEl.addEventListener('drop', function(ev) {
    ev.preventDefault(); ev.stopPropagation();
    sendDroppedFilesToTerminal(ev.dataTransfer.files, s.id);
  });

  panes[s.id] = { term: term, ws: ws, fit: fit, search: search, el: el, opened: false, reconnectAttempt: 0, reconnectTimer: null };
  applyPaneColor(s.id);
  applyPaneTags(s.id);

  // Click-to-position cursor — registered AFTER term.open() inside openAndFitSubtree
  // We attach when term.opened becomes true; use a one-shot poll
  (function attachClickPos() {
    var pp = panes[s.id];
    if (!pp) return;
    if (!pp.opened || !term.element) { setTimeout(attachClickPos, 100); return; }
    if (pp._clickPosAttached) return;
    pp._clickPosAttached = true;
    term.element.addEventListener('click', function(e) {
      try {
        if (!e.altKey) return;
        if (e.detail !== 1) return;
        var mouseMode = false;
        try { mouseMode = !!(term.modes && term.modes.mouseTrackingMode && term.modes.mouseTrackingMode !== 'none'); } catch(_){}
        if (mouseMode) return;
        var dims = getCellSize(term);
        if (!dims) return;
        var rect = term.element.getBoundingClientRect();
        var col = Math.floor((e.clientX - rect.left) / dims.w);
        var row = Math.floor((e.clientY - rect.top)  / dims.h);
        var cur = term.buffer.active;
        if (row !== cur.cursorY) return;
        var dx = col - cur.cursorX;
        if (dx === 0) return;
        var pp2 = panes[s.id];
        if (!pp2 || !pp2.ws) return;
        e.preventDefault();
        sendCursorMove(pp2.ws, term, dx);
      } catch(_){}
    });
  })();
}

function addPane(s) {
  createPaneElement(s);
  var lane = s.lane || 'active';
  var target = (pendingSplitTarget && pendingSplitTarget.lane === lane)
    ? pendingSplitTarget.sid : getLastLeafSid(layoutTrees[lane]);
  var dir = (pendingSplitTarget && pendingSplitTarget.lane === lane)
    ? pendingSplitTarget.dir : 'h';
  pendingSplitTarget = null;
  var tree = addSidToTree(layoutTrees[lane], s.id, target, dir);
  saveLayoutTree(lane, tree);
  if (lane === currentTab) { if (zoomedSid) zoomedSid = null; rebuildCanvas(); }
  updateTabCounts();
}

function removePane(sid) {
  var p = panes[sid];
  if (p) {
    if (p.reconnectTimer) { clearTimeout(p.reconnectTimer); p.reconnectTimer = null; }
    try { p.ws.close(); } catch(_){}
    closeSearchBar(sid);
    delete searchCaseSensitive[sid];
    try { p.term.dispose(); } catch(_){}
    if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
    delete panes[sid];
  }
  ['active','pending','done'].forEach(function(lane) {
    saveLayoutTree(lane, removeFromTree(layoutTrees[lane], sid));
  });
  if (zoomedSid === sid) zoomedSid = null;
  rebuildCanvas();
  updateEmpty();
}

function updatePaneHead(sid) {
  var s = state[sid], p = panes[sid];
  if (!s || !p) return;
  var dot = p.el.querySelector('.dot');
  if (dot) dot.className = 'dot ' + s.status;
  p.el.dataset.status = s.status;
  var prevLane = p.el.dataset.lane;
  var newLane = s.lane || 'active';
  p.el.dataset.lane = newLane;
  if (prevLane !== newLane) {
    var oldTree = removeFromTree(layoutTrees[prevLane], sid);
    saveLayoutTree(prevLane, oldTree);
    var newTree = addSidToTree(layoutTrees[newLane], sid, getLastLeafSid(layoutTrees[newLane]), 'h');
    saveLayoutTree(newLane, newTree);
    if (prevLane === currentTab || newLane === currentTab) rebuildCanvas();
  }
  var btns = p.el.querySelectorAll('[data-lane-set]');
  btns.forEach(function(b) {
    if (b.dataset.laneSet === newLane) b.classList.add('on');
    else b.classList.remove('on');
  });
  updateTabCounts();
}

function updateTabCounts() {
  var c = { active:0, pending:0, done:0 };
  Object.values(state).forEach(function(s) { c[s.lane || 'active']++; });
  document.getElementById('cnt-active').textContent  = c.active;
  document.getElementById('cnt-pending').textContent = c.pending;
  document.getElementById('cnt-done').textContent    = c.done;
}

// Tab switcher
var currentTab = localStorage.getItem('currentTab') || 'active';
function switchTab(tab) {
  var _bb = document.getElementById('broadcast-bar');
  if (_bb && _bb.style.display !== 'none') { _bb.style.display = 'none'; document.getElementById('inp-broadcast').value = ''; }
  if (sessionFilter) { sessionFilter = ''; document.getElementById('inp-filter').value = ''; }
  currentTab = tab;
  localStorage.setItem('currentTab', tab);
  document.querySelectorAll('#tab-bar button').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  rebuildCanvas();
}
document.getElementById('tab-bar').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-tab]');
  if (btn) switchTab(btn.dataset.tab);
});
switchTab(currentTab);

function updateEmpty() {
  var existing = document.getElementById('empty');
  var tree = layoutTrees[currentTab];
  var laneEmpty = !tree || getAllLeafSids(tree, []).length === 0;
  if (laneEmpty) {
    if (!existing) {
      var d = document.createElement('div');
      d.id = 'empty';
      d.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);text-align:center';
      d.innerHTML = '<div><h2 style="color:var(--text);margin-bottom:6px;font-size:18px">No sessions yet</h2><p>Pick a project folder and click "+ New Session"</p><p style="font-size:11px;margin-top:12px;color:var(--muted)">Tip: use &#x229E; / &#x229F; on any pane header to split right or down</p></div>';
      document.getElementById('canvas').appendChild(d);
    }
  } else if (existing) existing.remove();
}
function hideEmpty() { var e = document.getElementById('empty'); if (e) e.remove(); }

function focusPane(sid) {
  var p = panes[sid];
  if (!p) return;
  setActiveSession(sid);
  try { p.term.focus(); } catch(_){}
}


function requestSplit(sid, dir) {
  var lane = state[sid] ? (state[sid].lane || 'active') : currentTab;
  pendingSplitTarget = { sid: sid, dir: dir, lane: lane };
  newSession();
}

document.getElementById('canvas').addEventListener('mousedown', function(e) {
  if (zoomedSid || sessionFilter) return;           // disabled in zoom / filter mode
  var head = e.target.closest('.pane-head');
  if (!head) return;
  if (e.target.closest('button') || e.target.closest('.lane-btns') || e.target.closest('[data-color-dot]') || e.target.closest('.nm') || e.target.closest('.tag-area')) return;
  var paneEl = head.closest('.pane');
  if (!paneEl) return;
  e.preventDefault();
  var sid = paneEl.id.replace('pane-', '');
  dragState.active = true;
  dragState.fromSid = sid;
  paneEl.classList.add('drag-source');
  document.body.classList.add('is-dragging');
});

document.getElementById('canvas').addEventListener('click', function(e) {
  var caseBtn = e.target.closest('[id^="search-case-"]');
  if (caseBtn) {
    e.stopPropagation();
    var sid = caseBtn.id.replace('search-case-', '');
    if (!searchCaseSensitive[sid]) searchCaseSensitive[sid] = false;
    searchCaseSensitive[sid] = !searchCaseSensitive[sid];
    caseBtn.classList.toggle('active', searchCaseSensitive[sid]);
    runSearch(sid);
    return;
  }
  var tagBtn = e.target.closest('[data-tag-btn]');
  if (tagBtn) { e.stopPropagation(); showTagEditor(tagBtn.dataset.tagBtn, tagBtn); return; }
  var exportBtn = e.target.closest('[data-export]');
  if (exportBtn) { exportTerminal(exportBtn.dataset.export); return; }
  var noteBtn = e.target.closest('[data-note]');
  if (noteBtn) { e.stopPropagation(); showNoteEditor(noteBtn.dataset.note, noteBtn); return; }
  var colorDot = e.target.closest('[data-color-dot]');
  if (colorDot) { e.stopPropagation(); showColorPicker(colorDot.dataset.colorDot, colorDot); return; }
  var zoomBtn = e.target.closest('[data-zoom]');
  if (zoomBtn) { toggleZoom(zoomBtn.dataset.zoom); return; }
  var splitH = e.target.closest('[data-split-h]');
  if (splitH) { requestSplit(splitH.dataset.splitH, 'h'); return; }
  var splitV = e.target.closest('[data-split-v]');
  if (splitV) { requestSplit(splitV.dataset.splitV, 'v'); return; }
  var killBtn = e.target.closest('[data-kill]');
  if (killBtn) { fetch('/api/sessions/' + killBtn.dataset.kill + '/kill', { method:'POST' }); return; }
  var resBtn = e.target.closest('[data-resume]');
  if (resBtn) { fetch('/api/sessions/' + resBtn.dataset.resume + '/resume', { method:'POST' }); return; }
  var laneBtn = e.target.closest('[data-lane-set]');
  if (laneBtn) {
    fetch('/api/sessions/' + laneBtn.dataset.sid + '/lane', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ lane: laneBtn.dataset.laneSet }),
    });
    return;
  }
  var folderBtn = e.target.closest('[data-folder]');
  if (folderBtn) { showFolderPopup(folderBtn.dataset.folder, folderBtn); return; }
  var rmBtn = e.target.closest('[data-remove]');
  if (rmBtn) {
    if (!confirm('Permanently delete this session? (History will be lost)')) return;
    fetch('/api/sessions/' + rmBtn.dataset.remove, { method:'DELETE' }); return;
  }
  var nm = e.target.closest('.nm');
  if (nm && !nm.querySelector('input')) {
    e.stopPropagation();
    var sid = nm.closest('.pane').id.replace('pane-', '');
    startInlineRename(nm, sid);
    return;
  }
  var pane = e.target.closest('.pane');
  if (pane) focusPane(pane.id.replace('pane-', ''));
});

function startInlineRename(nmEl, sid) {
  var oldName = state[sid] ? state[sid].name : '';
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'nm-input';
  input.value = oldName;
  nmEl.innerHTML = '';
  nmEl.appendChild(input);
  input.focus();
  input.select();
  function commit() {
    var newName = input.value.trim() || oldName;
    nmEl.textContent = newName;
    if (newName !== oldName) {
      fetch('/api/sessions/' + sid + '/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
    }
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { nmEl.textContent = oldName; }
  });
  input.addEventListener('mousedown', function(e) { e.stopPropagation(); });
}

document.getElementById('canvas').addEventListener('keydown', function(e) {
  var inp = e.target;
  if (!inp || !inp.id || inp.id.indexOf('search-inp-') !== 0) return;
  var sid = inp.id.replace('search-inp-', '');
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); searchNext(sid); }
  else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); searchPrev(sid); }
  else if (e.key === 'Escape') { e.preventDefault(); closeSearchBar(sid); }
  else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    if (!searchCaseSensitive[sid]) searchCaseSensitive[sid] = false;
    searchCaseSensitive[sid] = !searchCaseSensitive[sid];
    var btn = document.getElementById('search-case-' + sid);
    if (btn) btn.classList.toggle('active', searchCaseSensitive[sid]);
    runSearch(sid);
  }
});
document.getElementById('canvas').addEventListener('input', function(e) {
  var inp = e.target;
  if (!inp || !inp.id || inp.id.indexOf('search-inp-') !== 0) return;
  var sid = inp.id.replace('search-inp-', '');
  runSearch(sid);
});

window.addEventListener('resize', function() {
  ['active','pending','done'].forEach(function(lane) {
    fitSubtree(layoutTrees[lane]);
  });
});

function toggleZoom(sid) {
  zoomedSid = (zoomedSid === sid) ? null : sid;
  rebuildCanvas();
}

function applyPaneColor(sid) {
  var p = panes[sid];
  if (!p) return;
  var dot = p.el.querySelector('.dot');
  if (!dot) return;
  var c = paneColors[sid];
  if (c) { dot.style.background = c; dot.style.boxShadow = '0 0 8px ' + c; dot.style.animation = 'none'; }
  else   { dot.style.background = ''; dot.style.boxShadow = ''; dot.style.animation = ''; }
}

function showColorPicker(sid, anchorEl) {
  var existing = document.getElementById('color-picker-pop');
  if (existing) { existing.remove(); return; }
  var pop = document.createElement('div');
  pop.id = 'color-picker-pop';
  var openedAt = Date.now();
  var dismiss;
  COLOR_PALETTE.forEach(function(c) {
    var sw = document.createElement('div');
    sw.className = 'cp-swatch' + (!c ? ' clear' : '');
    sw.style.background = c || 'transparent';
    sw.style.borderColor = c || '';
    if (!c) sw.textContent = '×';
    sw.title = c || 'Default';
    sw.addEventListener('click', function() {
      if (c) paneColors[sid] = c; else delete paneColors[sid];
      localStorage.setItem('claude-hub-colors', JSON.stringify(paneColors));
      applyPaneColor(sid);
      document.removeEventListener('mousedown', dismiss);
      pop.remove();
    });
    pop.appendChild(sw);
  });
  document.body.appendChild(pop);
  var rect = anchorEl.getBoundingClientRect();
  var pw = pop.offsetWidth, ph = pop.offsetHeight;
  var left = Math.min(rect.left, window.innerWidth - pw - 8);
  var top = rect.bottom + 6;
  if (top + ph > window.innerHeight) top = rect.top - ph - 6;
  pop.style.left = Math.max(0, left) + 'px';
  pop.style.top  = Math.max(0, top)  + 'px';
  dismiss = function(ev) {
    if (Date.now() - openedAt < 100) return;
    if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', dismiss); }
  };
  setTimeout(function() { document.addEventListener('mousedown', dismiss); }, 0);
}

