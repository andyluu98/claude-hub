function toggleTemplatePanel() {
  var panel = document.getElementById('template-panel');
  var visible = panel.style.display !== 'none';
  if (visible) {
    panel.style.display = 'none';
    if (templateDismiss) { document.removeEventListener('mousedown', templateDismiss); templateDismiss = null; }
  } else {
    panel.style.display = 'block';
    renderTemplateList();
    setTimeout(function() {
      templateDismiss = function(ev) {
        var btn = document.getElementById('btn-tmpl-arrow');
        if (!panel.contains(ev.target) && ev.target !== btn) {
          panel.style.display = 'none';
          document.removeEventListener('mousedown', templateDismiss);
          templateDismiss = null;
        }
      };
      document.addEventListener('mousedown', templateDismiss);
    }, 0);
  }
}

function renderTemplateList() {
  var list = document.getElementById('template-list');
  if (!list) return;
  list.innerHTML = '';
  if (!sessionTemplates.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'font-size:11.5px;color:var(--muted);padding:4px 8px 6px';
    empty.textContent = 'No templates saved yet';
    list.appendChild(empty);
    return;
  }
  sessionTemplates.forEach(function(tmpl) {
    var row = document.createElement('div');
    row.className = 'tmpl-item';
    var label = document.createElement('span');
    label.className = 'tmpl-label';
    label.textContent = tmpl.label;
    label.title = tmpl.name + ' • ' + tmpl.cwd;
    label.addEventListener('click', function() { applyTemplate(tmpl.id); });
    var del = document.createElement('button');
    del.className = 'tmpl-del';
    del.innerHTML = '&#x2715;';
    del.title = 'Delete template';
    del.addEventListener('click', function(e) { e.stopPropagation(); deleteTemplate(tmpl.id); });
    row.appendChild(label); row.appendChild(del);
    list.appendChild(row);
  });
}

function saveTemplate() {
  var label = prompt('Template name:', document.getElementById('inp-name').value || 'My Template');
  if (!label || !label.trim()) return;
  var tmpl = {
    id: Date.now().toString(),
    label: label.trim(),
    name: document.getElementById('inp-name').value,
    cwd: selectedCwd,
    autoAccept: document.getElementById('chk-auto').checked
  };
  sessionTemplates.push(tmpl);
  localStorage.setItem('claude-hub-templates', JSON.stringify(sessionTemplates));
  renderTemplateList();
  toast('Saved template "' + tmpl.label + '"');
}

function applyTemplate(id) {
  var tmpl = null;
  for (var i = 0; i < sessionTemplates.length; i++) {
    if (sessionTemplates[i].id === id) { tmpl = sessionTemplates[i]; break; }
  }
  if (!tmpl) return;
  document.getElementById('inp-name').value = tmpl.name || '';
  if (tmpl.cwd) {
    selectedCwd = tmpl.cwd;
    var short = tmpl.cwd.split(/[\/\\]/).filter(Boolean).slice(-2).join('/') || tmpl.cwd;
    document.getElementById('btn-cwd').textContent = '📁 ' + short;
  }
  document.getElementById('chk-auto').checked = !!tmpl.autoAccept;
  document.getElementById('template-panel').style.display = 'none';
  if (templateDismiss) { document.removeEventListener('mousedown', templateDismiss); templateDismiss = null; }
  newSession();
}

function deleteTemplate(id) {
  sessionTemplates = sessionTemplates.filter(function(t) { return t.id !== id; });
  localStorage.setItem('claude-hub-templates', JSON.stringify(sessionTemplates));
  renderTemplateList();
  toast('Template deleted');
}
