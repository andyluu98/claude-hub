function openSearchBar(sid) {
  if (activeSearchSid && activeSearchSid !== sid) closeSearchBar(activeSearchSid);
  activeSearchSid = sid;
  var bar = document.getElementById('search-bar-' + sid);
  if (!bar) return;
  bar.classList.add('open');
  var inp = document.getElementById('search-inp-' + sid);
  if (inp) { inp.focus(); inp.select(); }
  var p = panes[sid];
  if (p) {
    try { p.fit.fit(); } catch(_){}
  }
}

function closeSearchBar(sid) {
  var bar = document.getElementById('search-bar-' + sid);
  if (bar) bar.classList.remove('open');
  var p = panes[sid];
  if (p && p.search) {
    try { p.search.clearDecorations(); } catch(_){}
  }
  var countEl = document.getElementById('search-count-' + sid);
  if (countEl) countEl.textContent = '';
  if (activeSearchSid === sid) activeSearchSid = null;
  if (p) {
    try { p.term.focus(); } catch(_){}
    try { p.fit.fit(); } catch(_){}
  }
}

function runSearch(sid) {
  var p = panes[sid];
  if (!p || !p.search) return;
  var inp = document.getElementById('search-inp-' + sid);
  if (!inp) return;
  var query = inp.value;
  if (!query) { try { p.search.clearDecorations(); } catch(_){} return; }
  try {
    p.search.findNext(query, { caseSensitive: !!searchCaseSensitive[sid], incremental: true });
  } catch(_){}
}

function searchNext(sid) {
  var p = panes[sid];
  if (!p || !p.search) return;
  var inp = document.getElementById('search-inp-' + sid);
  if (!inp || !inp.value) return;
  try { p.search.findNext(inp.value, { caseSensitive: !!searchCaseSensitive[sid] }); } catch(_){}
}

function searchPrev(sid) {
  var p = panes[sid];
  if (!p || !p.search) return;
  var inp = document.getElementById('search-inp-' + sid);
  if (!inp || !inp.value) return;
  try { p.search.findPrevious(inp.value, { caseSensitive: !!searchCaseSensitive[sid] }); } catch(_){}
}
