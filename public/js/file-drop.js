// ── Pane management (split-pane) ────────────────────────────────
function rebuildGrid() {
  // Diff: remove panes for sessions no longer in state
  Object.keys(panes).forEach(function(sid) {
    if (!state[sid]) {
      var p = panes[sid];
      try { p.ws.close(); } catch(_){}
      try { p.term.dispose(); } catch(_){}
      if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
      delete panes[sid];
      if (zoomedSid === sid) zoomedSid = null;
      ['active','pending','done'].forEach(function(lane) {
        layoutTrees[lane] = removeFromTree(layoutTrees[lane], sid);
      });
    }
  });
  // Create panes for new sessions; update head for existing ones
  Object.values(state).forEach(function(s) {
    if (panes[s.id]) { updatePaneHead(s.id); }
    else { createPaneElement(s); }
  });
  // Reconcile layout trees per lane
  loadSavedLayoutTrees();
  ['active','pending','done'].forEach(function(lane) {
    var validIds = Object.values(state)
      .filter(function(s) { return (s.lane || 'active') === lane; })
      .map(function(s) { return s.id; });
    var tree = reconcileTree(layoutTrees[lane], validIds);
    validIds.forEach(function(sid) {
      if (!findLeaf(tree, sid)) {
        tree = addSidToTree(tree, sid, getLastLeafSid(tree), 'h');
      }
    });
    saveLayoutTree(lane, tree);
  });
  rebuildCanvas();
}

// Paste from clipboard: image (save to file, send @path) or text


function isFileDrag(e) {
  var dt = e && e.dataTransfer;
  if (!dt) return false;
  if (dt.types) {
    for (var i = 0; i < dt.types.length; i++) {
      if (dt.types[i] === 'Files') return true;
    }
  }
  return !!(dt.files && dt.files.length);
}

function readDroppedFiles(files) {
  return Promise.all(Array.prototype.slice.call(files || []).map(function(file) {
    return new Promise(function(resolve, reject) {
      if (file.path) { resolve({ name: file.name || file.path.split(/[\\/]/).pop(), path: file.path }); return; }
      var reader = new FileReader();
      reader.onload = function() { resolve({ name: file.name || 'dropped-file', data: reader.result }); };
      reader.onerror = function() { reject(reader.error || new Error('read failed')); };
      reader.readAsDataURL(file);
    });
  }));
}

function sendPathTokensToTerminal(paths, sid) {
  var p = panes[sid];
  var sObj = state[sid];
  if (!p || !p.ws || p.ws.readyState !== 1) return false;
  paths.forEach(function(fp) {
    var rel = relOrAbs(fp, sObj ? sObj.cwd : '');
    var ref = /\s/.test(rel) ? '"' + rel + '"' : rel;
    p.ws.send('@' + ref + ' ');
  });
  return true;
}

function uploadDroppedFiles(files, mode, dir) {
  return readDroppedFiles(files).then(function(items) {
    var existingPaths = items.filter(function(it) { return it.path; }).map(function(it) { return it.path; });
    var uploads = items.filter(function(it) { return it.data; });
    if (!uploads.length) return { ok:true, files: existingPaths.map(function(fp) { return { path: fp, name: fp.split(/[\\/]/).pop() }; }) };
    return fetch('/api/drop-files', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ mode: mode, dir: dir, files: uploads }),
    }).then(function(r) { return r.json(); }).then(function(j) {
      if (!j.ok) return j;
      j.files = existingPaths.map(function(fp) { return { path: fp, name: fp.split(/[\\/]/).pop() }; }).concat(j.files || []);
      return j;
    });
  });
}

function sendDroppedFilesToTerminal(files, sid) {
  if (!files || !files.length) return;
  uploadDroppedFiles(files, 'temp').then(function(j) {
    if (!j.ok) { toast('Drop error: ' + (j.error || 'unknown')); return; }
    var paths = (j.files || []).map(function(f) { return f.path; });
    if (sendPathTokensToTerminal(paths, sid)) toast('Sent ' + paths.length + ' file(s) to terminal');
  }).catch(function(e) { toast('Drop error: ' + e.message); });
}

function getSidebarDropDir(target) {
  var dirRow = target && target.closest && target.closest('[data-sb-dir]');
  if (dirRow) return dirRow.dataset.sbDir;
  return sbCurrentPath;
}

function dropFilesToSidebar(files, target) {
  if (!files || !files.length) return;
  var dir = getSidebarDropDir(target);
  if (!dir) { toast('Open a folder in Explorer first'); return; }
  uploadDroppedFiles(files, 'folder', dir).then(function(j) {
    if (!j.ok) { toast('Drop error: ' + (j.error || 'unknown')); return; }
    toast('Copied ' + (j.files || []).length + ' file(s) to folder');
    sbBrowse(dir, true);
  }).catch(function(e) { toast('Drop error: ' + e.message); });
}

function pasteFromClipboard(ws, sid) {
  if (!navigator.clipboard) { toast('Clipboard API not available'); return; }
  // Try read clipboard items (image + text)
  if (navigator.clipboard.read) {
    navigator.clipboard.read().then(function(clipItems) {
      for (var ci = 0; ci < clipItems.length; ci++) {
        var types = clipItems[ci].types;
        for (var ti = 0; ti < types.length; ti++) {
          if (types[ti].indexOf('image') !== -1) {
            clipItems[ci].getType(types[ti]).then(function(blob) {
              var reader = new FileReader();
              reader.onload = function() {
                var s = state[sid];
                fetch('/api/paste-image', {
                  method:'POST', headers:{'Content-Type':'application/json'},
                  body: JSON.stringify({ data: reader.result, cwd: s ? s.cwd : '' })
                }).then(function(r){return r.json();}).then(function(j) {
                  if (j.ok && ws.readyState === 1) { ws.send('@' + j.path + ' '); toast('Pasted image: ' + j.name); }
                  else if (!j.ok) toast('Error: ' + (j.error||''));
                });
              };
              reader.readAsDataURL(blob);
            });
            return;
          }
        }
      }
      // No image found, paste text
      pasteTextFromClipboard(ws);
    }).catch(function() { pasteTextFromClipboard(ws); });
  } else {
    pasteTextFromClipboard(ws);
  }
}
function pasteTextFromClipboard(ws) {
  if (!navigator.clipboard || !navigator.clipboard.readText) return;
  navigator.clipboard.readText().then(function(text) {
    if (!text) return;
    var CR = String.fromCharCode(13), LF = String.fromCharCode(10);
    text = text.split(CR + LF).join(LF).split(CR).join(LF);
    if (ws.readyState === 1) ws.send(text);
  }).catch(function(err) { toast('Paste error: ' + err.message); });
}
