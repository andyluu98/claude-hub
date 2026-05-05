// ── Folder picker ────────────────────────────────────────────────
document.getElementById('btn-cwd').addEventListener('click', openModal);
function openModal() {
  document.getElementById('modal-bg').classList.add('show');
  browseFs(selectedCwd || '');
  setTimeout(function() { document.getElementById('inp-paste').focus(); }, 100);
}
function closeModal() { document.getElementById('modal-bg').classList.remove('show'); }

function goToPasted() {
  var p = document.getElementById('inp-paste').value.trim();
  if (!p) return;
  // Clean quotes if copied from Explorer
  p = p.replace(/^["']|["']$/g, '');
  browseFs(p);
}
document.getElementById('inp-paste').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') goToPasted();
});
document.getElementById('inp-paste').addEventListener('paste', function(e) {
  setTimeout(goToPasted, 50);
});

function browseFs(p) {
  var url = '/api/fs' + (p ? '?path=' + encodeURIComponent(p) : '');
  fetch(url).then(function(r) { return r.json(); }).then(function(data) {
    if (data.error) { toast('Error: ' + data.error); return; }
    currentBrowse = data;
    document.getElementById('modal-path').textContent = '📍 ' + data.cwd;
    renderFsBody(data);
  });
}

function renderFsBody(data) {
  Promise.all([
    fetch('/api/bookmarks').then(function(r) { return r.json(); }),
    fetch('/api/recent').then(function(r) { return r.json(); }),
  ]).then(function(arr) {
    var bookmarks = arr[0] || [];
    var recent = arr[1] || [];
    var html = '';

    // Bookmarks section (only at drive level or empty)
    html += '<div class="modal-section-title">&#x2B50; Bookmarks <button class="add-bm" onclick="addBookmark()">+ Add</button></div>';
    if (bookmarks.length) {
      bookmarks.forEach(function(bm) {
        html += '<div class="bm-item" data-bm-path="' + esc(bm.path) + '">' +
          '&#x2B50; <div style="flex:1;min-width:0">' +
            '<div class="bm-name">' + esc(bm.name) + '</div>' +
            '<div class="bm-path">' + esc(bm.path) + '</div>' +
          '</div>' +
          '<div class="bm-actions">' +
            '<button onclick="editBookmark(event,&#39;'+bm.id+'&#39;)">&#x270E;</button>' +
            '<button class="del" onclick="deleteBookmark(event,&#39;'+bm.id+'&#39;)">&times;</button>' +
          '</div>' +
        '</div>';
      });
    } else {
      html += '<div style="padding:10px 22px;color:var(--muted);font-size:11.5px;font-style:italic">No bookmarks yet. Click "+ Add" to save frequently used folders.</div>';
    }

    // Recent
    if (recent.length) {
      html += '<div class="modal-section-title">&#x23F1; Recent</div>';
      recent.forEach(function(p) {
        var name = p.split(/[\\/]/).filter(Boolean).pop() || p;
        html += '<div class="bm-item" data-bm-path="' + esc(p) + '">' +
          '&#x23F1; <div style="flex:1;min-width:0">' +
            '<div class="bm-name">' + esc(name) + '</div>' +
            '<div class="bm-path">' + esc(p) + '</div>' +
          '</div></div>';
      });
    }

    // Folders in current dir
    if (data.items && data.items.length) {
      html += '<div class="modal-section-title">&#x1F4C2; Folders in ' + esc(data.cwd.split(/[\\/]/).pop() || data.cwd) + '</div>';
      data.items.forEach(function(it) {
        var tag = it.isProject ? '<span class="proj-tag">PROJECT</span>' : '';
        html += '<div class="fs-item" data-path="' + esc(it.path) + '">&#x1F4C1; ' + esc(it.name) + tag + '</div>';
      });
    }

    document.getElementById('modal-body').innerHTML = html;
  });
}

function goUp() {
  if (currentBrowse && currentBrowse.parent) browseFs(currentBrowse.parent);
  else browseFs('Drives');
}
function pickCurrent() {
  if (!currentBrowse || currentBrowse.cwd === 'Drives') { toast('Select a specific folder first'); return; }
  selectedCwd = currentBrowse.cwd;
  var shortName = selectedCwd.split(/[\\/]/).filter(Boolean).pop() || selectedCwd;
  document.getElementById('btn-cwd').innerHTML = '📁 <strong>' + esc(shortName) + '</strong>';
  document.getElementById('btn-cwd').title = selectedCwd;
  closeModal();
  toast('Selected: ' + shortName);
}
document.getElementById('modal-body').addEventListener('click', function(e) {
  if (e.target.closest('.bm-actions')) return;
  var bm = e.target.closest('[data-bm-path]');
  if (bm) { browseFs(bm.dataset.bmPath); return; }
  var item = e.target.closest('.fs-item');
  if (item) browseFs(item.dataset.path);
});

function addBookmark() {
  if (!currentBrowse || currentBrowse.cwd === 'Drives') { toast('Browse to a folder to bookmark first'); return; }
  var name = prompt('Bookmark name:', currentBrowse.cwd.split(/[\\/]/).filter(Boolean).pop());
  if (!name) return;
  fetch('/api/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, path: currentBrowse.cwd }),
  }).then(function() { renderFsBody(currentBrowse); toast('Bookmark added'); });
}
function editBookmark(e, id) {
  e.stopPropagation();
  var name = prompt('New name:');
  if (!name) return;
  fetch('/api/bookmarks/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name }),
  }).then(function() { renderFsBody(currentBrowse); toast('Updated'); });
}
function deleteBookmark(e, id) {
  e.stopPropagation();
  if (!confirm('Remove bookmark?')) return;
  fetch('/api/bookmarks/' + id, { method: 'DELETE' })
    .then(function() { renderFsBody(currentBrowse); toast('Removed'); });
}

