function applyPaneTags(sid) {
  var p = panes[sid];
  if (!p) return;
  var area = p.el.querySelector('[data-tag-area]');
  if (!area) return;
  area.innerHTML = '';
  var tags = sessionTags[sid] || [];
  var max = 3;
  tags.slice(0, max).forEach(function(tag) {
    var chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = '#' + tag;
    chip.title = tag;
    area.appendChild(chip);
  });
  if (tags.length > max) {
    var chip = document.createElement('span');
    chip.className = 'tag-chip overflow';
    chip.textContent = '+' + (tags.length - max);
    area.appendChild(chip);
  }
  var add = document.createElement('span');
  add.className = 'tag-chip add-tag';
  add.dataset.tagBtn = sid;
  add.title = 'Add / remove tags';
  add.textContent = '+';
  area.appendChild(add);
}

function showTagEditor(sid, anchorEl) {
  var existing = document.getElementById('tag-pop');
  if (existing) { existing.remove(); if (existing.dataset.sid === sid) return; }
  var pop = document.createElement('div');
  pop.id = 'tag-pop';
  pop.dataset.sid = sid;
  var dismiss;

  // Collect all known tags across all sessions
  var allTags = [];
  Object.keys(sessionTags).forEach(function(k) {
    sessionTags[k].forEach(function(t) { if (allTags.indexOf(t) < 0) allTags.push(t); });
  });
  var currentTags = sessionTags[sid] ? sessionTags[sid].slice() : [];

  var listEl = document.createElement('div');
  listEl.className = 'tag-pop-list';
  function renderList() {
    listEl.innerHTML = '';
    allTags.forEach(function(tag) {
      var btn = document.createElement('button');
      btn.className = 'tag-toggle' + (currentTags.indexOf(tag) >= 0 ? ' on' : '');
      btn.textContent = '#' + tag;
      btn.addEventListener('click', function() {
        var idx = currentTags.indexOf(tag);
        if (idx >= 0) currentTags.splice(idx, 1); else currentTags.push(tag);
        sessionTags[sid] = currentTags.slice();
        localStorage.setItem('claude-hub-tags', JSON.stringify(sessionTags));
        applyPaneTags(sid);
        btn.classList.toggle('on', currentTags.indexOf(tag) >= 0);
      });
      listEl.appendChild(btn);
    });
    if (!allTags.length) {
      var hint = document.createElement('span');
      hint.style.cssText = 'font-size:11px;color:var(--muted)';
      hint.textContent = 'No tags yet — type one below';
      listEl.appendChild(hint);
    }
  }
  renderList();

  var inpWrap = document.createElement('div');
  inpWrap.className = 'tag-inp-wrap';
  var inp = document.createElement('input');
  inp.type = 'text'; inp.placeholder = 'New tag name...';
  var addBtn = document.createElement('button');
  addBtn.textContent = 'Add';
  function addTag() {
    var val = inp.value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!val) return;
    if (allTags.indexOf(val) < 0) allTags.push(val);
    if (currentTags.indexOf(val) < 0) currentTags.push(val);
    sessionTags[sid] = currentTags.slice();
    localStorage.setItem('claude-hub-tags', JSON.stringify(sessionTags));
    applyPaneTags(sid);
    inp.value = '';
    renderList();
  }
  addBtn.addEventListener('click', addTag);
  inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
  inpWrap.appendChild(inp); inpWrap.appendChild(addBtn);
  pop.appendChild(listEl); pop.appendChild(inpWrap);

  document.body.appendChild(pop);
  var rect = anchorEl.getBoundingClientRect();
  var pw = pop.offsetWidth, ph = pop.offsetHeight;
  var left = Math.min(rect.left, window.innerWidth - pw - 8);
  var top = rect.bottom + 6;
  if (top + ph > window.innerHeight) top = rect.top - ph - 6;
  pop.style.left = Math.max(0, left) + 'px';
  pop.style.top  = Math.max(0, top)  + 'px';
  inp.focus();

  var openedAt = Date.now();
  setTimeout(function() {
    dismiss = function(ev) {
      if (Date.now() - openedAt < 100) return;
      if (!pop.contains(ev.target) && !anchorEl.contains(ev.target)) {
        document.removeEventListener('mousedown', dismiss);
        pop.remove();
      }
    };
    document.addEventListener('mousedown', dismiss);
  }, 0);
}
