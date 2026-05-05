// ── Sidebar File Explorer ─────────────────────────────────────────
var activeSid = null;          // currently focused session
var sbCurrentPath = null;      // path currently browsing in sidebar
var sbSelected = {};           // { sid: { relPathOrAbs: true } }
var sbInsertLen = {};
var sbHistory = [];
var sbHistoryIdx = -1;
var sbNavigating = false;

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  setTimeout(function() { fitSubtree(layoutTrees[currentTab]); }, 220);
}

function sbRefresh() { if (sbCurrentPath) sbBrowse(sbCurrentPath, true); }

function sbBrowse(p, silent) {
  if (!p) return;
  if (!silent && !sbNavigating) {
    if (sbHistoryIdx < sbHistory.length - 1) sbHistory = sbHistory.slice(0, sbHistoryIdx + 1);
    sbHistory.push(p);
    sbHistoryIdx = sbHistory.length - 1;
  }
  sbNavigating = false;
  sbUpdateNavButtons();
  sbCurrentPath = p;
  var pathInput = document.getElementById('sb-path-input');
  if (pathInput) pathInput.value = p;
  
  var listEl = document.getElementById('sb-list');
  fetch('/api/fs?files=1&path=' + encodeURIComponent(p))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { listEl.innerHTML = '<div class="sb-empty">' + esc(data.error) + '</div>'; return; }
      renderSbList(data.items || []);
    });
}

function sbUpdateNavButtons() {
  var b = document.getElementById('sb-back'), f = document.getElementById('sb-fwd');
  if (b) b.disabled = sbHistoryIdx <= 0;
  if (f) f.disabled = sbHistoryIdx >= sbHistory.length - 1;
}
function sbGoBack() { if (sbHistoryIdx > 0) { sbHistoryIdx--; sbNavigating = true; sbBrowse(sbHistory[sbHistoryIdx]); } }
function sbGoForward() { if (sbHistoryIdx < sbHistory.length - 1) { sbHistoryIdx++; sbNavigating = true; sbBrowse(sbHistory[sbHistoryIdx]); } }
function sbGoHome() { if (activeSid && state[activeSid]) sbBrowse(state[activeSid].cwd); }

function renderSbList(items) {
  var list = document.getElementById('sb-list');
  if (!items.length) { list.innerHTML = '<div class="sb-empty">Empty folder</div>'; sbUpdateSelectedCount(); return; }
  var html = '';
  var upPath = sbCurrentPath.replace(/[\/][^\/]+[\/]?$/, '') || sbCurrentPath;
  if (upPath && upPath !== sbCurrentPath) {
    html += '<div class="sb-row" data-sb-up="' + esc(upPath) + '"><span class="sb-icon">&#x2B06;</span><span class="sb-name">.. (up)</span></div>';
  }
  var selMap = (activeSid && sbSelected[activeSid]) || {};
  items.forEach(function(it) {
    if (it.type === 'dir') {
      var dirChecked = selMap[it.path] ? 'checked' : '';
      html += '<div class="sb-row ' + (dirChecked?'checked':'') + '" data-sb-dir="' + esc(it.path) + '">' +
                '<input type="checkbox" ' + dirChecked + ' data-sb-check="' + esc(it.path) + '" data-sb-name="' + esc(it.name) + '" data-sb-type="dir">' +
                '<span class="sb-icon">&#x1F4C1;</span><span class="sb-name">' + esc(it.name) + '</span></div>';
    } else {
      var checked = selMap[it.path] ? 'checked' : '';
      html += '<div class="sb-row ' + (checked?'checked':'') + '" data-sb-file="' + esc(it.path) + '">' +
                '<input type="checkbox" ' + checked + ' data-sb-check="' + esc(it.path) + '" data-sb-name="' + esc(it.name) + '" data-sb-type="file">' +
                '<span class="sb-icon">&#x1F4C4;</span><span class="sb-name">' + esc(it.name) + '</span></div>';
    }
  });
  list.innerHTML = html;
  sbUpdateSelectedCount();
}

// Click delegation cho sidebar
document.getElementById('sidebar').addEventListener('click', function(e) {
  var check = e.target.closest('[data-sb-check]');
  if (check) {
    sbToggleFile(check.dataset.sbCheck, check.dataset.sbName, check.checked, check.dataset.sbType);
    e.stopPropagation(); return;
  }
  var fileRow = e.target.closest('[data-sb-file]');
  if (fileRow) {
    var cb = fileRow.querySelector('input[type="checkbox"]');
    if (cb) { cb.checked = !cb.checked; sbToggleFile(cb.dataset.sbCheck, cb.dataset.sbName, cb.checked, cb.dataset.sbType); }
    return;
  }
  var dir = e.target.closest('[data-sb-dir]'); if (dir) { sbBrowse(dir.dataset.sbDir); return; }
  var up  = e.target.closest('[data-sb-up]'); if (up)  { sbBrowse(up.dataset.sbUp); return; }
});


var ctxTarget = null;

function openCtxMenu(x, y, items) {
  var menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.innerHTML = items.map(function(it) {
    if (it === 'sep') return '<div class="ctx-sep"></div>';
    return '<div class="ctx-item ' + (it.danger ? 'danger' : '') + '" data-ctx="' + it.act + '">' +
           '<span class="ctx-icon">' + it.icon + '</span>' + esc(it.label) + '</div>';
  }).join('');
  menu.classList.add('show');
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
}
function closeCtxMenu() {
  var menu = document.getElementById('ctx-menu');
  if (menu) menu.classList.remove('show');
}

document.getElementById('sidebar').addEventListener('contextmenu', function(e) {
  var row = e.target.closest('.sb-row');
  if (!row) {
    if (!sbCurrentPath) return;
    e.preventDefault();
    ctxTarget = { path: sbCurrentPath, name: '', type: 'dir', isCurrent: true };
    openCtxMenu(e.clientX, e.clientY, [
      { act:'new-file', icon:'&#x1F4C4;', label:'New file' },
      { act:'new-folder', icon:'&#x1F4C1;', label:'New folder' },
      'sep',
      { act:'reveal-dir', icon:'&#x1F4CD;', label:'Open in Explorer' },
      { act:'vscode', icon:'&#x1F4BB;', label:'Open in VSCode' },
    ]);
    return;
  }
  var filePath = row.dataset.sbFile || row.dataset.sbDir || row.dataset.sbUp;
  if (!filePath) return;
  e.preventDefault();
  var isFile = !!row.dataset.sbFile;
  var nameEl = row.querySelector('.sb-name');
  ctxTarget = { path: filePath, name: (nameEl ? nameEl.textContent.trim() : ''), type: isFile ? 'file' : 'dir', row: row };

  var items = isFile ? [
    { act:'open', icon:'&#x1F4C2;', label:'Open (default app)' },
    { act:'reveal', icon:'&#x1F4CD;', label:'Reveal in Explorer' },
    'sep',
    { act:'attach', icon:'&#x1F4CE;', label:'Attach to terminal' },
    { act:'copy-path', icon:'&#x1F4CB;', label:'Copy path' },
    'sep',
    { act:'rename', icon:'&#x270F;', label:'Rename' },
    { act:'duplicate', icon:'&#x1F4C4;', label:'Duplicate' },
    { act:'delete', icon:'&#x1F5D1;', label:'Delete (Recycle Bin)', danger:true },
  ] : [
    { act:'open', icon:'&#x1F4C2;', label:'Open' },
    { act:'reveal-dir', icon:'&#x1F4CD;', label:'Open in Explorer' },
    { act:'vscode', icon:'&#x1F4BB;', label:'Open in VSCode' },
    'sep',
    { act:'new-session', icon:'&#x2795;', label:'New Session here' },
    { act:'new-file', icon:'&#x1F4C4;', label:'New file' },
    { act:'new-folder', icon:'&#x1F4C1;', label:'New folder' },
    'sep',
    { act:'copy-path', icon:'&#x1F4CB;', label:'Copy path' },
    { act:'rename', icon:'&#x270F;', label:'Rename' },
    { act:'duplicate', icon:'&#x1F4C4;', label:'Duplicate' },
    { act:'delete', icon:'&#x1F5D1;', label:'Delete (Recycle Bin)', danger:true },
  ];
  openCtxMenu(e.clientX, e.clientY, items);
});

document.addEventListener('mousedown', function(e) {
  var menu = document.getElementById('ctx-menu');
  if (!menu || !menu.classList.contains('show')) return;
  if (menu.contains(e.target)) return;
  closeCtxMenu();
});

document.getElementById('ctx-menu').addEventListener('click', function(e) {
  var it = e.target.closest('[data-ctx]');
  if (!it || !ctxTarget) return;
  var act = it.dataset.ctx;
  closeCtxMenu();
  handleCtxAction(act);
});

function handleCtxAction(act) {
  var t = ctxTarget;
  if (!t) return;

  if (act === 'open') {
    if (t.type === 'file') {
      fetch('/api/file-open', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: t.path }) })
        .then(function(r){ return r.json(); }).then(function(j){ if (!j.ok) toast('Error: ' + j.error); });
    } else {
      sbBrowse(t.path);
    }
    return;
  }
  if (act === 'reveal') {
    fetch('/api/file-reveal', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: t.path }) })
      .then(function(r){ return r.json(); }).then(function(j){ if (!j.ok) toast('Error: ' + j.error); });
    return;
  }
  if (act === 'reveal-dir') {
    fetch('/api/open', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: t.path, action:'explorer' }) })
      .then(function(r){ return r.json(); }).then(function(j){ if (!j.ok) toast('Error: ' + j.error); });
    return;
  }
  if (act === 'vscode') {
    fetch('/api/open', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: t.path, action:'vscode' }) });
    return;
  }
  if (act === 'attach') {
    var cb = t.row && t.row.querySelector('input[type="checkbox"]');
    if (cb) { cb.checked = !cb.checked; sbToggleFile(t.path, t.name, cb.checked, t.type); t.row.classList.toggle('checked', cb.checked); }
    return;
  }
  if (act === 'copy-path') {
    navigator.clipboard.writeText(t.path).then(function(){ toast('Path copied'); });
    return;
  }
  if (act === 'rename') {
    startInlineFileRename(t);
    return;
  }
  if (act === 'duplicate') {
    fetch('/api/file-duplicate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: t.path }) })
      .then(function(r){ return r.json(); }).then(function(j){ if (j.ok) { toast('Duplicated'); sbRefresh(); } else toast('Error: ' + j.error); });
    return;
  }
  if (act === 'delete') {
    if (!confirm('Delete "' + t.name + '" to Recycle Bin?')) return;
    fetch('/api/file-delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path: t.path }) })
      .then(function(r){ return r.json(); }).then(function(j){ if (j.ok) { if (activeSid && sbSelected[activeSid]) delete sbSelected[activeSid][t.path]; sbUpdateSelectedCount(); toast('Moved to Recycle Bin'); sbRefresh(); } else toast('Error: ' + j.error); });
    return;
  }
  if (act === 'new-file' || act === 'new-folder') {
    var parent = t.isCurrent ? sbCurrentPath : (t.type === 'dir' ? t.path : sbCurrentPath);
    var name = prompt(act === 'new-file' ? 'New file name:' : 'New folder name:', act === 'new-file' ? 'untitled.txt' : 'new-folder');
    if (!name) return;
    fetch('/api/file-new', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ parent: parent, name: name, type: act === 'new-file' ? 'file' : 'dir' }),
    }).then(function(r){ return r.json(); }).then(function(j){ if (j.ok) { toast('Created ' + name); sbRefresh(); } else toast('Error: ' + j.error); });
    return;
  }
  if (act === 'new-session') {
    fetch('/api/sessions', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ cwd: t.path, autoAccept: document.getElementById('chk-auto').checked, engine: document.getElementById('sel-engine').value }),
    }).then(function(){ toast('Created session: ' + t.name); });
  }
}

function startInlineFileRename(t) {
  if (!t.row) return;
  var nameEl = t.row.querySelector('.sb-name');
  if (!nameEl) return;
  var oldHtml = nameEl.innerHTML;
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'sb-rename';
  input.value = t.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  var done = false;
  function cleanup(newSpan) {
    if (done) return;
    done = true;
    input.replaceWith(newSpan);
  }
  function restore() {
    var span = document.createElement('span');
    span.className = 'sb-name';
    span.innerHTML = oldHtml;
    cleanup(span);
  }
  function save() {
    var newName = input.value.trim();
    if (!newName || newName === t.name) { restore(); return; }
    fetch('/api/file-rename', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ path: t.path, newName: newName }),
    }).then(function(r){ return r.json(); }).then(function(j){ if (j.ok) { toast('Renamed'); sbRefresh(); } else { toast('Error: ' + j.error); restore(); } });
  }
  input.addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); save(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); restore(); }
  });
  input.addEventListener('blur', save);
}

function showFolderPopup(sid, anchorBtn) {
  var s = state[sid];
  if (!s) return;
  var pop = document.getElementById('folder-pop');
  if (!pop) return;
  var fullPath = s.cwd || '';
  var BS = String.fromCharCode(92);
  var parts = fullPath.split(/[\\/]/).filter(Boolean);
  var crumbHtml = '';
  var accum = '';
  parts.forEach(function(part, i) {
    if (i === 0 && /^[A-Za-z]:$/.test(part)) accum = part + BS;
    else accum = accum + (accum.endsWith(BS) ? '' : BS) + part;
    if (i > 0) crumbHtml += '<span class="sep">?</span>';
    crumbHtml += '<span data-crumb="' + esc(accum) + '" title="Open in Explorer">' + esc(part) + '</span>';
  });
  pop.innerHTML =
    '<div class="fp-path">' + esc(fullPath) + '</div>' +
    '<div class="fp-crumb">' + crumbHtml + '</div>' +
    '<div class="fp-acts">' +
      '<button data-act="explorer">&#x1F4C2; Explorer</button>' +
      '<button data-act="copy">&#x1F4CB; Copy path</button>' +
      '<button data-act="vscode">&#x1F4BB; VSCode</button>' +
      '<button data-act="cmd">&#x1F5A5; CMD</button>' +
    '</div>';
  pop.dataset.path = fullPath;
  var r = anchorBtn.getBoundingClientRect();
  pop.classList.add('show');
  var pw = pop.offsetWidth, ph = pop.offsetHeight;
  var left = Math.min(r.left, window.innerWidth - pw - 12);
  var top = r.bottom + 6;
  if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 6);
  pop.style.left = Math.max(12, left) + 'px';
  pop.style.top = top + 'px';
}

function hideFolderPopup() {
  var pop = document.getElementById('folder-pop');
  if (pop) pop.classList.remove('show');
}

document.getElementById('folder-pop').addEventListener('click', function(e) {
  var pop = document.getElementById('folder-pop');
  var fullPath = pop.dataset.path;
  var crumb = e.target.closest('[data-crumb]');
  if (crumb) {
    fetch('/api/open', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ path: crumb.dataset.crumb, action:'explorer' }) })
      .then(function(){ toast('Opened in Explorer'); });
    return;
  }
  var act = e.target.closest('[data-act]');
  if (!act) return;
  var action = act.dataset.act;
  if (action === 'copy') {
    navigator.clipboard.writeText(fullPath).then(function(){ toast('Path copied'); });
    hideFolderPopup();
    return;
  }
  fetch('/api/open', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ path: fullPath, action: action }) })
    .then(function(r){ return r.json(); }).then(function(j){ if (j.ok) toast('Opened in ' + action); else toast('Error: ' + (j.error || 'unknown')); });
  hideFolderPopup();
});

document.addEventListener('mousedown', function(e) {
  var pop = document.getElementById('folder-pop');
  if (!pop || !pop.classList.contains('show')) return;
  if (pop.contains(e.target)) return;
  if (e.target.closest('[data-folder]')) return;
  hideFolderPopup();
});



window.addEventListener('dragover', function(e) {
  if (!isFileDrag(e)) return;
  e.preventDefault();
}, true);
window.addEventListener('drop', function(e) {
  if (!isFileDrag(e)) return;
  var inTerminal = e.target && e.target.closest && e.target.closest('.xterm-wrap');
  var inSidebar = e.target && e.target.closest && e.target.closest('#sidebar');
  if (inTerminal || inSidebar) return;
  e.preventDefault();
  toast('Drop files onto a terminal or the Explorer sidebar');
}, true);

(function setupSidebarDrop() {
  var sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.addEventListener('dragenter', function(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    sidebar.classList.add('drop-target');
  });
  sidebar.addEventListener('dragover', function(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    sidebar.classList.add('drop-target');
  });
  sidebar.addEventListener('dragleave', function(e) {
    if (!sidebar.contains(e.relatedTarget)) sidebar.classList.remove('drop-target');
  });
  sidebar.addEventListener('drop', function(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    sidebar.classList.remove('drop-target');
    if (!e.dataTransfer.files || !e.dataTransfer.files.length) { toast('Drop did not include readable files'); return; }
    dropFilesToSidebar(e.dataTransfer.files, e.target);
  });
})();

function sbUpdateSelectedCount() {
  var count = activeSid && sbSelected[activeSid] ? Object.keys(sbSelected[activeSid]).length : 0;
  var countEl = document.getElementById('sb-sel-count');
  var btn = document.getElementById('sb-delete-selected');
  if (countEl) countEl.textContent = count;
  if (btn) btn.disabled = count === 0;
}

function sbToggleFile(filePath, fileName, checked, itemType) {
  if (!activeSid) { toast('Click a terminal first'); return; }
  var s = state[activeSid], p = panes[activeSid];
  if (!s) return;
  sbSelected[activeSid] = sbSelected[activeSid] || {};
  var rel = relOrAbs(filePath, s.cwd);
  var ref = /\s/.test(rel) ? '"' + rel + '"' : rel;
  var token = '@' + ref + ' ';
  if (checked) {
    sbSelected[activeSid][filePath] = { name: fileName, type: itemType || 'file', token: token };
    if (p && p.ws && p.ws.readyState === 1 && itemType !== 'dir') p.ws.send(token);
  } else {
    var prev = sbSelected[activeSid][filePath];
    delete sbSelected[activeSid][filePath];
    if (p && p.ws && p.ws.readyState === 1 && (!prev || prev.type !== 'dir')) p.ws.send('\x7f'.repeat((prev && prev.token || token).length));
  }
  sbUpdateSelectedCount();
  sbRefresh();
}

function sbDeleteSelected() {
  if (!activeSid || !sbSelected[activeSid]) { toast('No selected files'); return; }
  var paths = Object.keys(sbSelected[activeSid]);
  if (!paths.length) { toast('No selected files'); return; }
  if (!confirm('Delete ' + paths.length + ' selected item(s) to Recycle Bin?')) return;
  fetch('/api/files-delete', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ paths: paths }),
  }).then(function(r){ return r.json(); }).then(function(j){
    if (j.ok) {
      sbSelected[activeSid] = {};
      sbUpdateSelectedCount();
      toast('Moved ' + j.count + ' item(s) to Recycle Bin');
      sbRefresh();
    } else {
      toast('Delete error: ' + (j.error || 'unknown'));
    }
  }).catch(function(e){ toast('Delete error: ' + e.message); });
}

function relOrAbs(filePath, sessionCwd) {
  var BS = String.fromCharCode(92);
  var fp = filePath.split(BS).join('/').toLowerCase();
  var cw = sessionCwd.split(BS).join('/').toLowerCase();
  if (!cw.endsWith('/')) cw += '/';
  if (fp.startsWith(cw)) return filePath.substring(sessionCwd.length + 1);
  return filePath;
}

