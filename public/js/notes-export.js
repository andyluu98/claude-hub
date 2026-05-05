function updateNoteBtn(sid) {
  var p = panes[sid];
  if (!p) return;
  var btn = p.el.querySelector('[data-note]');
  if (btn) btn.style.color = sessionNotes[sid] ? 'var(--orange)' : '';
}

function showNoteEditor(sid, anchorEl) {
  var existing = document.getElementById('note-pop');
  if (existing) { existing.remove(); if (existing.dataset.sid === sid) return; }
  var pop = document.createElement('div');
  pop.id = 'note-pop';
  pop.dataset.sid = sid;
  var ta = document.createElement('textarea');
  ta.placeholder = 'Notes for this session...';
  ta.value = sessionNotes[sid] || '';
  var actions = document.createElement('div');
  actions.className = 'note-actions';
  var btnCancel = document.createElement('button');
  btnCancel.className = 'btn btn-ghost'; btnCancel.style.padding = '4px 12px'; btnCancel.textContent = 'Cancel';
  var btnSave = document.createElement('button');
  btnSave.className = 'btn btn-primary'; btnSave.style.padding = '4px 12px'; btnSave.textContent = 'Save';
  var dismiss;
  btnSave.addEventListener('click', function() {
    var val = ta.value.trim();
    if (val) sessionNotes[sid] = val; else delete sessionNotes[sid];
    localStorage.setItem('claude-hub-notes', JSON.stringify(sessionNotes));
    updateNoteBtn(sid);
    document.removeEventListener('mousedown', dismiss);
    pop.remove();
  });
  btnCancel.addEventListener('click', function() {
    document.removeEventListener('mousedown', dismiss);
    pop.remove();
  });
  actions.appendChild(btnCancel); actions.appendChild(btnSave);
  pop.appendChild(ta); pop.appendChild(actions);
  document.body.appendChild(pop);
  var rect = anchorEl.getBoundingClientRect();
  var pw = pop.offsetWidth, ph = pop.offsetHeight;
  var left = Math.min(rect.left, window.innerWidth - pw - 8);
  var top = rect.bottom + 6;
  if (top + ph > window.innerHeight) top = rect.top - ph - 6;
  pop.style.left = Math.max(0, left) + 'px';
  pop.style.top  = Math.max(0, top)  + 'px';
  ta.focus();
  setTimeout(function() {
    dismiss = function(ev) {
      if (!pop.contains(ev.target) && !anchorEl.contains(ev.target)) {
        document.removeEventListener('mousedown', dismiss);
        pop.remove();
      }
    };
    document.addEventListener('mousedown', dismiss);
  }, 0);
}

function exportTerminal(sid) {
  var p = panes[sid];
  if (!p || !p.opened) { toast('Terminal not yet opened'); return; }
  var lines = [];
  var buf = p.term.buffer.active;
  // buf.length = full active buffer including scrollback (intentional — exports all content)
  for (var i = 0; i < buf.length; i++) {
    var line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  var text = lines.join('\n');
  if (!text) { toast('Nothing to export (buffer is empty)'); return; }
  var s = state[sid];
  var safeName = (s ? s.name : sid).replace(/[^a-z0-9_\-]/gi, '_');
  var filename = safeName + '-' + Date.now() + '.txt';
  var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  toast('Exported ' + lines.length + ' lines → ' + filename);
}
