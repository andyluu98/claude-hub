// ── Split-pane layout trees ────────────────────────────────────────
var layoutTrees = { active: null, pending: null, done: null };
var pendingSplitTarget = null; // { sid, dir, lane } set before newSession()

function saveLayoutTree(lane, tree) {
  layoutTrees[lane] = tree;
  try { localStorage.setItem('layoutTree-' + lane, JSON.stringify(tree)); } catch(_){}
}
function loadSavedLayoutTrees() {
  ['active','pending','done'].forEach(function(lane) {
    try {
      var s = localStorage.getItem('layoutTree-' + lane);
      if (s) layoutTrees[lane] = JSON.parse(s);
    } catch(_){}
  });
}
function swapLeaves(node, sidA, sidB) {
  var leafA = findLeaf(node, sidA);
  var leafB = findLeaf(node, sidB);
  if (leafA && leafB) { leafA.sessionId = sidB; leafB.sessionId = sidA; }
}
function findLeaf(node, sid) {
  if (!node) return null;
  if (node.type === 'leaf') return node.sessionId === sid ? node : null;
  return findLeaf(node.children[0], sid) || findLeaf(node.children[1], sid);
}
function getLastLeafSid(node) {
  if (!node) return null;
  if (node.type === 'leaf') return node.sessionId;
  return getLastLeafSid(node.children[1]) || getLastLeafSid(node.children[0]);
}
function getAllLeafSids(node, out) {
  if (!node) return out;
  out = out || [];
  if (node.type === 'leaf') { out.push(node.sessionId); return out; }
  getAllLeafSids(node.children[0], out);
  getAllLeafSids(node.children[1], out);
  return out;
}
function splitTreeAt(tree, targetSid, newSid, dir) {
  if (!tree) return { type:'leaf', sessionId: newSid };
  if (tree.type === 'leaf') {
    if (tree.sessionId !== targetSid) return tree;
    return { type:'split', dir:dir, ratio:0.5, children:[
      { type:'leaf', sessionId: targetSid },
      { type:'leaf', sessionId: newSid }
    ]};
  }
  return { type:'split', dir:tree.dir, ratio:tree.ratio, children:[
    splitTreeAt(tree.children[0], targetSid, newSid, dir),
    splitTreeAt(tree.children[1], targetSid, newSid, dir)
  ]};
}
function removeFromTree(tree, sid) {
  if (!tree) return null;
  if (tree.type === 'leaf') return tree.sessionId === sid ? null : tree;
  var a = removeFromTree(tree.children[0], sid);
  var b = removeFromTree(tree.children[1], sid);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return { type:'split', dir:tree.dir, ratio:tree.ratio, children:[a, b] };
}
function reconcileTree(tree, validIds) {
  if (!tree) return null;
  if (tree.type === 'leaf') return validIds.indexOf(tree.sessionId) >= 0 ? tree : null;
  var a = reconcileTree(tree.children[0], validIds);
  var b = reconcileTree(tree.children[1], validIds);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return { type:'split', dir:tree.dir, ratio:tree.ratio, children:[a, b] };
}
function addSidToTree(tree, newSid, splitSid, dir) {
  var target = splitSid || getLastLeafSid(tree);
  if (!target) return { type:'leaf', sessionId: newSid };
  return splitTreeAt(tree, target, newSid, dir || 'h');
}

// ── renderTree + divider drag ──────────────────────────────────────
function fitSubtree(node) {
  if (!node) return;
  if (node.type === 'leaf') {
    var p = panes[node.sessionId];
    if (p && p.opened) { try { p.fit.fit(); } catch(_){} }
  } else {
    fitSubtree(node.children[0]);
    fitSubtree(node.children[1]);
  }
}
function openAndFitSubtree(node) {
  if (!node) return;
  if (node.type === 'leaf') {
    var p = panes[node.sessionId];
    if (!p) return;
    if (!p.opened) {
      var termEl = document.getElementById('term-' + node.sessionId);
      if (termEl) { p.term.open(termEl); p.opened = true; }
    }
    if (p.opened) { try { p.fit.fit(); } catch(_){} }
  } else {
    openAndFitSubtree(node.children[0]);
    openAndFitSubtree(node.children[1]);
  }
}
function makeDividerDraggable(divider, node, wrapA, container, isH) {
  divider.addEventListener('mousedown', function(e) {
    e.preventDefault();
    divider.classList.add('dragging');
    var startPos = isH ? e.clientX : e.clientY;
    function onMove(ev) {
      var totalSize = isH ? container.offsetWidth : container.offsetHeight;
      if (totalSize < 10) return;
      var delta = (isH ? ev.clientX : ev.clientY) - startPos;
      startPos = isH ? ev.clientX : ev.clientY;
      var newRatio = node.ratio + delta / totalSize;
      newRatio = Math.max(0.1, Math.min(0.9, newRatio));
      node.ratio = newRatio;
      wrapA.style.flex = '0 0 calc(' + (newRatio * 100) + '% - 3px)';
      fitSubtree(node.children[0]);
      fitSubtree(node.children[1]);
    }
    function onUp() {
      divider.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      saveLayoutTree(currentTab, layoutTrees[currentTab]);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
function renderTree(node, el) {
  if (!node) return;
  if (node.type === 'leaf') {
    var p = panes[node.sessionId];
    if (!p) return;
    p.el.style.flex = '1';
    p.el.style.minWidth = '0';
    p.el.style.minHeight = '0';
    el.appendChild(p.el);
    p.el.classList.remove('zoomed');
    p.el.style.maxWidth = '';
  } else {
    var isH = node.dir === 'h';
    var container = document.createElement('div');
    container.className = 'split-container dir-' + node.dir;
    el.appendChild(container);
    var wrapA = document.createElement('div');
    wrapA.className = 'split-child';
    wrapA.style.flex = '0 0 calc(' + (node.ratio * 100) + '% - 3px)';
    container.appendChild(wrapA);
    renderTree(node.children[0], wrapA);
    var divider = document.createElement('div');
    divider.className = 'divider dir-' + node.dir;
    container.appendChild(divider);
    var wrapB = document.createElement('div');
    wrapB.className = 'split-child';
    wrapB.style.flex = '1';
    container.appendChild(wrapB);
    renderTree(node.children[1], wrapB);
    makeDividerDraggable(divider, node, wrapA, container, isH);
  }
}
function rebuildCanvas() {
  var canvas = document.getElementById('canvas');
  var dropOverlay = document.getElementById('canvas-drop-overlay');
  // Detach pane elements so terminals survive the canvas clear
  Object.values(panes).forEach(function(p) {
    if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
  });
  // Clear canvas without destroying detached pane elements
  while (canvas.firstChild) canvas.removeChild(canvas.firstChild);
  if (dropOverlay) canvas.appendChild(dropOverlay);
  var tree = layoutTrees[currentTab];
  if (!tree) { updateEmpty(); return; }
  var emptyEl = document.getElementById('empty');
  if (emptyEl) emptyEl.remove();

  // Filter mode: bypass tree, show flat list of matching panes
  if (sessionFilter) {
    zoomedSid = null;
    var matchSids = getAllLeafSids(tree, []).filter(function(sid) {
      var s = state[sid];
      if (!s) return false;
      return (s.name || '').toLowerCase().indexOf(sessionFilter) >= 0 ||
             (s.cwd  || '').toLowerCase().indexOf(sessionFilter) >= 0 ||
             (sessionTags[sid] || []).some(function(t) { return t.indexOf(sessionFilter) >= 0; });
    });
    if (!matchSids.length) {
      var noMatch = document.createElement('div');
      noMatch.id = 'empty';
      noMatch.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);text-align:center';
      noMatch.innerHTML = '<div><h2 style="color:var(--text);margin-bottom:6px;font-size:18px">No matching sessions</h2><p>No sessions match "' + sessionFilter + '"</p></div>';
      canvas.appendChild(noMatch);
      return;
    }
    canvas.style.flexWrap = 'wrap';
    matchSids.forEach(function(sid) {
      var mp = panes[sid];
      if (!mp) return;
      mp.el.classList.remove('zoomed');
      mp.el.style.flex = '1 1 400px';
      mp.el.style.minWidth = '200px';
      mp.el.style.minHeight = '150px';
      mp.el.style.maxWidth = '100%';
      canvas.appendChild(mp.el);
    });
    requestAnimationFrame(function() {
      matchSids.forEach(function(sid) {
        openAndFitSubtree({ type: 'leaf', sessionId: sid });
      });
    });
    return;
  }

  // If a pane is zoomed and it belongs to this lane, show only that pane
  if (zoomedSid && panes[zoomedSid] && findLeaf(tree, zoomedSid)) {
    canvas.style.flexWrap = '';
    var zp = panes[zoomedSid];
    zp.el.classList.add('zoomed');
    zp.el.style.flex = '1';
    zp.el.style.minWidth = '0';
    zp.el.style.minHeight = '0';
    canvas.appendChild(zp.el);
    requestAnimationFrame(function() {
      openAndFitSubtree({ type: 'leaf', sessionId: zoomedSid });
    });
  } else {
    canvas.style.flexWrap = '';
    if (zoomedSid) zoomedSid = null; // zoomed pane not in current lane — clear zoom
    renderTree(tree, canvas);
    requestAnimationFrame(function() { openAndFitSubtree(tree); });
  }
}

