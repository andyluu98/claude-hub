function togglePresetPanel() {
  var panel = document.getElementById('preset-panel');
  var visible = panel.style.display !== 'none';
  if (visible) {
    panel.style.display = 'none';
    if (presetDismiss) { document.removeEventListener('mousedown', presetDismiss); presetDismiss = null; }
  } else {
    panel.style.display = 'block';
    renderPresetList();
    setTimeout(function() {
      presetDismiss = function(ev) {
        var btn = document.getElementById('btn-presets');
        if (!panel.contains(ev.target) && ev.target !== btn) {
          panel.style.display = 'none';
          document.removeEventListener('mousedown', presetDismiss);
          presetDismiss = null;
        }
      };
      document.addEventListener('mousedown', presetDismiss);
    }, 0);
  }
}

function renderPresetList() {
  var list = document.getElementById('preset-list');
  if (!list) return;
  var keys = Object.keys(layoutPresets);
  if (!keys.length) { list.innerHTML = '<div class="preset-empty">No saved layouts yet</div>'; return; }
  list.innerHTML = '';
  keys.forEach(function(name) {
    var item = document.createElement('div');
    item.className = 'preset-item';
    var nameEl = document.createElement('span');
    nameEl.className = 'preset-name';
    nameEl.textContent = name;
    nameEl.addEventListener('click', function() { loadPreset(name); });
    var delBtn = document.createElement('button');
    delBtn.className = 'preset-del';
    delBtn.title = 'Delete';
    delBtn.innerHTML = '&#x2715;';
    delBtn.addEventListener('click', function(e) { e.stopPropagation(); deletePreset(name); });
    item.appendChild(nameEl);
    item.appendChild(delBtn);
    list.appendChild(item);
  });
}

function savePreset() {
  var name = prompt('Name for this layout:', 'Layout ' + (Object.keys(layoutPresets).length + 1));
  if (!name || !name.trim()) return;
  name = name.trim();
  layoutPresets[name] = {
    active:  layoutTrees.active  ? JSON.parse(JSON.stringify(layoutTrees.active))  : null,
    pending: layoutTrees.pending ? JSON.parse(JSON.stringify(layoutTrees.pending)) : null,
    done:    layoutTrees.done    ? JSON.parse(JSON.stringify(layoutTrees.done))    : null,
  };
  localStorage.setItem('claude-hub-layout-presets', JSON.stringify(layoutPresets));
  renderPresetList();
  toast('Saved layout "' + name + '"');
}

function loadPreset(name) {
  var preset = layoutPresets[name];
  if (!preset) return;
  ['active', 'pending', 'done'].forEach(function(lane) {
    if (!preset[lane]) return;
    var validIds = Object.values(state)
      .filter(function(s) { return (s.lane || 'active') === lane; })
      .map(function(s) { return s.id; });
    var reconciled = reconcileTree(preset[lane], validIds);
    if (reconciled) saveLayoutTree(lane, reconciled);
  });
  rebuildCanvas();
  document.getElementById('preset-panel').style.display = 'none';
  if (presetDismiss) { document.removeEventListener('mousedown', presetDismiss); presetDismiss = null; }
  toast('Applied layout "' + name + '"');
}

function deletePreset(name) {
  delete layoutPresets[name];
  localStorage.setItem('claude-hub-layout-presets', JSON.stringify(layoutPresets));
  renderPresetList();
  toast('Deleted layout "' + name + '"');
}
