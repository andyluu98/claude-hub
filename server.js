/**
 * Claude Hub v3 — Windows Native Dashboard with xterm.js
 * Chạy: node server.js  →  http://localhost:8765
 *
 * Kien truc: moi session = 1 PTY spawn claude.exe truc tiep,
 * raw bytes pipe qua WebSocket vao xterm.js terminal trong browser.
 * → render dung TUI cua Claude Code (interactive chat thuc su).
 */

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const fs        = require('fs');
const path      = require('path');
const { v4: uuid } = require('uuid');
const { spawn } = require('child_process');
const os = require('os');

let pty;
try { pty = require('node-pty'); }
catch(e) { console.error('\n❌  Thieu node-pty. Chay: npm install\n'); process.exit(1); }

const PORT = 8765;
const HOST = '127.0.0.1'; // Loopback only — see SECURITY in README
const HIDDEN_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.vscode', '.idea']);

// Allowed Origin / Referer prefixes for CSRF protection.
// Only requests from the dashboard page itself are accepted on /api/* and WS upgrade.
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
]);
function originAllowed(hdr) {
  if (!hdr) return false;
  for (const o of ALLOWED_ORIGINS) {
    if (hdr === o || hdr.startsWith(o + '/')) return true;
  }
  return false;
}

// Reject paths containing cmd.exe / shell metacharacters to neutralise command
// injection when we pass them to spawn() actions below. Windows filenames cannot
// legally contain any of these characters anyway, so a real on-disk path never
// trips this check.
const SHELL_META_RE = /["&|<>^%!`\r\n\0]/;
function hasShellMeta(p) { return SHELL_META_RE.test(p); }

// ── Session ────────────────────────────────────────────────────────
class Session {
  constructor(id, name, cwd, autoAccept, opts) {
    opts = opts || {};
    this.id         = id;
    this.name       = name;
    this.cwd        = cwd || process.env.USERPROFILE || 'C:\\';
    this.autoAccept = !!autoAccept;
    this.status     = opts.status || 'stopped'; // running | stopped
    this.lane       = opts.lane || 'active';    // active | pending | done
    this.startedAt  = opts.startedAt || new Date().toLocaleTimeString('vi-VN');
    this.proc       = null;
    this.history    = opts.history ? [opts.history] : []; // raw bytes buffer de replay
    this.maxHistory = 500_000; // ~500KB
  }
  appendHistory(chunk) {
    this.history.push(chunk);
    let total = this.history.reduce((n, c) => n + c.length, 0);
    while (total > this.maxHistory && this.history.length > 1) {
      total -= this.history.shift().length;
    }
  }
  toJSON() {
    return {
      id: this.id, name: this.name, status: this.status, lane: this.lane,
      startedAt: this.startedAt, cwd: this.cwd,
      cwdShort: path.basename(this.cwd), autoAccept: this.autoAccept,
    };
  }
}

// ── State ──────────────────────────────────────────────────────────
const sessions = new Map();
const clients  = new Set(); // control WS clients
// terminal WS clients: map<sessionId, Set<ws>>
const termClients = new Map();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}
function pushSession(s) { broadcast({ type: 'session_update', session: s.toJSON() }); }

function sendToTerm(sessionId, chunk) {
  const set = termClients.get(sessionId);
  if (!set) return;
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
  }
}

// ── Persistence ────────────────────────────────────────────────────
// Luu trong thu muc project (theo yeu cau) de git-ignore de.
const SESSIONS_FILE = path.join(__dirname, '.claude-hub-sessions.json');

function serializeSessions() {
  return [...sessions.values()].map(s => ({
    id: s.id, name: s.name, cwd: s.cwd, autoAccept: s.autoAccept,
    status: s.status === 'running' ? 'running' : 'stopped',
    lane: s.lane || 'active',
    startedAt: s.startedAt,
    // chi luu tail ~50KB de replay lai terminal buffer
    history: s.history.join('').slice(-50_000),
  }));
}

let saveTimer = null;
function persistSessions(immediate) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const run = () => {
    try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(serializeSessions(), null, 2)); }
    catch(e) { console.error('persist err:', e.message); }
  };
  if (immediate) run(); else saveTimer = setTimeout(run, 2000);
}

function loadPersistedSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const arr = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    for (const o of arr) {
      const s = new Session(o.id, o.name, o.cwd, o.autoAccept, {
        status: 'stopped', // LUON khoi dong o trang thai stopped, cho user Resume
        lane: o.lane || 'active',
        startedAt: o.startedAt,
        history: o.history || '',
      });
      sessions.set(s.id, s);
    }
    console.log(`📂  Loaded ${arr.length} persisted sessions (stopped) — click Resume de khoi dong lai`);
  } catch(e) { console.error('load err:', e.message); }
}

// ── PTY ────────────────────────────────────────────────────────────
function startPty(s, opts) {
  opts = opts || {};
  // Validate cwd
  let workCwd = s.cwd;
  try { if (!fs.existsSync(workCwd) || !fs.statSync(workCwd).isDirectory()) throw 0; }
  catch { workCwd = process.env.USERPROFILE || 'C:\\'; s.cwd = workCwd; }

  // Tim claude.exe
  const candidates = [
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'),
    'claude.exe',
    'claude.cmd',
  ];

  const args = [];
  if (opts.resume) args.push('--continue'); // resume cuoc hoi thoai gan nhat trong cwd
  if (s.autoAccept) args.push('--dangerously-skip-permissions');
  let spawned = false;
  for (const cmd of candidates) {
    try {
      s.proc = pty.spawn(cmd, args, {
        name: 'xterm-256color',
        cols: 120, rows: 30,
        cwd: workCwd,
        env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
      });
      spawned = true;
      break;
    } catch (_) {}
  }
  if (!spawned) {
    console.error('Khong tim thay claude.exe');
    s.status = 'stopped';
    pushSession(s);
    return;
  }

  s.status = 'running';
  pushSession(s);

  s.proc.onData(data => {
    s.appendHistory(data);
    sendToTerm(s.id, data);
    persistSessions(); // debounced
  });

  s.proc.onExit(() => {
    s.proc = null;
    s.status = 'stopped';
    pushSession(s);
    persistSessions(true);
  });
}

// ── Filesystem browser ─────────────────────────────────────────────
function listDir(p, includeFiles) {
  const abs = path.resolve(p);
  if (!fs.statSync(abs).isDirectory()) throw new Error('Not a directory');
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const dirs = entries
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && !HIDDEN_DIRS.has(d.name))
    .map(d => {
      const full = path.join(abs, d.name);
      let isProject = false;
      try {
        isProject = fs.existsSync(path.join(full, '.git')) ||
                    fs.existsSync(path.join(full, 'package.json'));
      } catch(_) {}
      return { type:'dir', name: d.name, path: full, isProject };
    })
    .sort((a, b) => (b.isProject - a.isProject) || a.name.localeCompare(b.name));
  let files = [];
  if (includeFiles) {
    files = entries
      .filter(d => d.isFile() && !d.name.startsWith('.'))
      .map(d => {
        const full = path.join(abs, d.name);
        let size = 0;
        try { size = fs.statSync(full).size; } catch(_) {}
        return { type:'file', name: d.name, path: full, size };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return { cwd: abs, parent: path.dirname(abs), items: [...dirs, ...files] };
}

function listDrives() {
  const drives = [];
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c) + ':\\';
    try { if (fs.existsSync(letter)) drives.push({ name: letter, path: letter, isProject: false }); }
    catch(_) {}
  }
  return { cwd: 'Drives', parent: null, items: drives };
}

// ── Overseer rule-based summary ────────────────────────────────────
function buildRuleSummary() {
  const arr = [...sessions.values()];
  if (!arr.length) return 'Chua co session nao.';
  const c = { running:0, stopped:0 };
  arr.forEach(s => c[s.status] = (c[s.status]||0) + 1);
  const header = `📊 ${arr.length} sessions · 🟢 ${c.running} running · ⏸ ${c.stopped} stopped`;
  const lines = arr.map(s => {
    const icon = { running:'🟢', stopped:'⏸' }[s.status] || '⚪';
    const folder = path.basename(s.cwd);
    const auto = s.autoAccept ? ' ⚡' : '';
    return `${icon} [${s.name}]${auto} (${folder}) — ${s.status}`;
  });
  return [header, '─'.repeat(40), ...lines].join('\n');
}

// ── Express + WS ───────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ noServer: true });

app.use(express.json({ limit: '50mb' }));

// CSRF protection: every /api/* request must come from the dashboard page.
// Browsers always attach Origin on fetch(); same-origin GETs may only have
// Referer — we accept either.
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (originAllowed(origin) || originAllowed(referer)) return next();
  return res.status(403).json({ error: 'forbidden origin' });
});

// Serve static files (public/index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Serve xterm assets tu node_modules
app.use('/xterm', express.static(path.join(__dirname, 'node_modules/xterm/lib')));
app.use('/xterm-css', express.static(path.join(__dirname, 'node_modules/xterm/css')));
app.use('/xterm-fit', express.static(path.join(__dirname, 'node_modules/xterm-addon-fit/lib')));
app.get('/api/sessions', (_, res) => res.json([...sessions.values()].map(s => s.toJSON())));

app.get('/api/fs', (req, res) => {
  const p = req.query.path;
  const files = req.query.files === '1';
  try {
    if (!p || p === 'Drives') return res.json(listDrives());
    res.json(listDir(p, files));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const RECENT_FILE    = path.join(process.env.USERPROFILE || '.', '.claude-hub-recent.json');
const BOOKMARKS_FILE = path.join(process.env.USERPROFILE || '.', '.claude-hub-bookmarks.json');

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch(_) {}
}

function loadRecent()      { return loadJson(RECENT_FILE, []); }
function saveRecent(p) {
  let arr = loadRecent().filter(x => x !== p);
  arr.unshift(p);
  saveJson(RECENT_FILE, arr.slice(0, 8));
}
app.get('/api/recent', (_, res) => res.json(loadRecent()));

// Bookmarks: [{ id, name, path }]
app.get('/api/bookmarks', (_, res) => res.json(loadJson(BOOKMARKS_FILE, [])));
app.post('/api/bookmarks', (req, res) => {
  const { name, path: p } = req.body || {};
  if (!p) return res.status(400).json({ error: 'path required' });
  const bms = loadJson(BOOKMARKS_FILE, []);
  const id = uuid().slice(0, 6);
  bms.push({ id, name: (name || path.basename(p) || p).trim(), path: p });
  saveJson(BOOKMARKS_FILE, bms);
  res.json({ ok: true, bookmarks: bms });
});
app.put('/api/bookmarks/:id', (req, res) => {
  const bms = loadJson(BOOKMARKS_FILE, []);
  const bm = bms.find(b => b.id === req.params.id);
  if (!bm) return res.status(404).json({ error: 'not found' });
  if (req.body.name != null) bm.name = req.body.name.trim();
  if (req.body.path != null) bm.path = req.body.path.trim();
  saveJson(BOOKMARKS_FILE, bms);
  res.json({ ok: true, bookmarks: bms });
});
app.delete('/api/bookmarks/:id', (req, res) => {
  const bms = loadJson(BOOKMARKS_FILE, []).filter(b => b.id !== req.params.id);
  saveJson(BOOKMARKS_FILE, bms);
  res.json({ ok: true, bookmarks: bms });
});

app.post('/api/sessions', (req, res) => {
  let name        = (req.body.name || '').trim();
  const cwd       = (req.body.cwd  || '').trim();
  const autoAccept = !!req.body.autoAccept;
  // Auto-name tu folder basename neu user khong nhap
  if (!name) name = cwd ? path.basename(cwd) : 'Session';
  const id = uuid().slice(0, 8);
  const s  = new Session(id, name, cwd, autoAccept);
  sessions.set(id, s);
  if (cwd) saveRecent(cwd);
  startPty(s);
  broadcast({ type: 'session_created', session: s.toJSON() });
  persistSessions(true);
  res.json(s.toJSON());
});

// Resume 1 session da stopped
app.post('/api/sessions/:id/resume', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.status === 'running') return res.json({ ok: true, already: true });
  // Giu lai history tail de client van thay noi dung cu sau do PTY se ghi de
  startPty(s, { resume: true });
  persistSessions(true);
  res.json({ ok: true });
});

// Chuyen session sang lane khac (active|pending|done)
// active  → auto resume PTY (neu chua running)
// pending → auto stop PTY (giu history)
// done    → auto stop PTY (giu history)
app.post('/api/sessions/:id/lane', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  const lane = String(req.body.lane || '').toLowerCase();
  if (!['active','pending','done'].includes(lane)) {
    return res.status(400).json({ error: 'invalid lane' });
  }
  const prev = s.lane;
  s.lane = lane;
  if (lane === 'active' && s.status !== 'running') {
    startPty(s, { resume: true });
  } else if (lane !== 'active' && s.status === 'running') {
    try { if (s.proc) s.proc.kill(); } catch(_) {}
    s.proc = null;
    s.status = 'stopped';
  }
  pushSession(s);
  persistSessions(true);
  res.json({ ok: true, prev, lane });
});

// Resume tat ca session dang stopped
app.post('/api/sessions/resume-all', (_req, res) => {
  let n = 0;
  for (const s of sessions.values()) {
    if (s.status !== 'running') { startPty(s, { resume: true }); n++; }
  }
  persistSessions(true);
  res.json({ ok: true, resumed: n });
});

app.post('/api/sessions/:id/rename', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  s.name = (req.body.name || '').trim() || s.name;
  pushSession(s);
  persistSessions(true);
  res.json({ ok: true });
});

// "Kill" = pause (stop PTY nhung giu session + history)
app.post('/api/sessions/:id/kill', (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  try { if (s.proc) s.proc.kill(); } catch (_) {}
  s.proc = null;
  s.status = 'stopped';
  pushSession(s);
  persistSessions(true);
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (s) { try { if (s.proc) s.proc.kill(); } catch (_) {} sessions.delete(req.params.id); }
  termClients.delete(req.params.id);
  broadcast({ type: 'session_removed', id: req.params.id });
  persistSessions(true);
  res.json({ ok: true });
});

// ── File operations ───────────────────────────────────────────────
// Xoa file/folder vao Recycle Bin qua VBScript + Shell.Application COM
// (tranh PowerShell vi may user co the loi .NET ServicePointManager)
function recycleDelete(target, cb) {
  try {
    if (!fs.existsSync(target)) return cb('path not found');
    const parent = path.dirname(target);
    const name   = path.basename(target);
    // Escape " trong tham so string VBScript
    const esc = s => s.replace(/"/g, '""');
    const vbs =
      'Set oShell = CreateObject("Shell.Application")\r\n' +
      'Set oFolder = oShell.Namespace("' + esc(parent) + '")\r\n' +
      'If oFolder Is Nothing Then WScript.Quit 2\r\n' +
      'Set oItem = oFolder.ParseName("' + esc(name) + '")\r\n' +
      'If oItem Is Nothing Then WScript.Quit 3\r\n' +
      // Verb "delete" dua vao Recycle Bin, khong hien confirm popup do flag & H100
      'oItem.InvokeVerb("delete")\r\n';
    const tmp = path.join(os.tmpdir(), 'claude-hub-recycle-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) + '.vbs');
    fs.writeFileSync(tmp, vbs, 'utf8');
    const proc = spawn('cscript.exe', ['//nologo', '//B', tmp], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => err += d.toString());
    proc.on('exit', code => {
      try { fs.unlinkSync(tmp); } catch(_) {}
      if (code === 0) {
        // Verify file da xoa (InvokeVerb async, doi 1 chut)
        setTimeout(() => {
          if (!fs.existsSync(target)) cb(null);
          else cb('Delete khong thanh cong (file van ton tai)');
        }, 300);
      } else {
        cb(err || ('cscript exit ' + code));
      }
    });
    proc.on('error', e => { try{fs.unlinkSync(tmp);}catch(_){} cb(e.message); });
  } catch(e) { cb(e.message); }
}

function uniqueDuplicate(src) {
  const dir = path.dirname(src);
  const ext = path.extname(src);
  const base = path.basename(src, ext);
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, base + ' (' + i + ')' + ext);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('cannot find unique name');
}

// Mo file bang app mac dinh (Windows: start "")
app.post('/api/file-open', (req, res) => {
  const p = String(req.body.path || '').trim();
  if (!p || hasShellMeta(p) || !fs.existsSync(p)) return res.status(400).json({ error: 'invalid path' });
  try {
    spawn('cmd.exe', ['/c', 'start', '""', p], { detached:true, stdio:'ignore', windowsVerbatimArguments:false }).unref();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Reveal file trong Explorer (highlight file)
app.post('/api/file-reveal', (req, res) => {
  const p = String(req.body.path || '').trim();
  if (!p || hasShellMeta(p) || !fs.existsSync(p)) return res.status(400).json({ error: 'invalid path' });
  try {
    spawn('explorer.exe', ['/select,', p], { detached:true, stdio:'ignore' }).unref();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Xoa vao Recycle Bin
app.post('/api/file-delete', (req, res) => {
  const p = String(req.body.path || '').trim();
  if (!p || !fs.existsSync(p)) return res.status(400).json({ error: 'invalid path' });
  recycleDelete(p, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ ok: true });
  });
});

// Rename
app.post('/api/file-rename', (req, res) => {
  const p = String(req.body.path || '').trim();
  const newName = String(req.body.newName || '').trim();
  if (!p || !newName) return res.status(400).json({ error: 'path + newName required' });
  if (/[\\\/:*?"<>|\r\n\0]/.test(newName) || newName === '.' || newName === '..') {
    return res.status(400).json({ error: 'invalid chars in name' });
  }
  try {
    const target = path.join(path.dirname(p), newName);
    if (fs.existsSync(target)) return res.status(400).json({ error: 'name exists' });
    fs.renameSync(p, target);
    res.json({ ok: true, path: target });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Duplicate file
app.post('/api/file-duplicate', (req, res) => {
  const p = String(req.body.path || '').trim();
  if (!p || !fs.existsSync(p)) return res.status(400).json({ error: 'invalid path' });
  try {
    const st = fs.statSync(p);
    const dst = uniqueDuplicate(p);
    if (st.isDirectory()) {
      fs.cpSync(p, dst, { recursive: true });
    } else {
      fs.copyFileSync(p, dst);
    }
    res.json({ ok: true, path: dst });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Tao file/folder moi trong parent
app.post('/api/file-new', (req, res) => {
  const parent = String(req.body.parent || '').trim();
  const name = String(req.body.name || '').trim();
  const type = String(req.body.type || 'file');
  if (!parent || !name) return res.status(400).json({ error: 'parent + name required' });
  // Reject any filename with path separators or Windows-invalid chars. `name`
  // must be a leaf entry, not a nested path — prevents `..\..\Windows\foo`
  // style parent escapes.
  if (/[\\/*?"<>|:\r\n\0]/.test(name) || name === '.' || name === '..') {
    return res.status(400).json({ error: 'invalid name' });
  }
  const normParent = path.resolve(parent);
  const target = path.resolve(normParent, name);
  // Defence in depth: after resolve, target must still live directly under parent.
  if (path.dirname(target) !== normParent) {
    return res.status(400).json({ error: 'path escape' });
  }
  try {
    if (fs.existsSync(target)) return res.status(400).json({ error: 'already exists' });
    if (type === 'dir') fs.mkdirSync(target);
    else fs.writeFileSync(target, '');
    res.json({ ok: true, path: target });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Save pasted image from clipboard to temp file, return path
app.post('/api/paste-image', (req, res) => {
  // Expect base64 body: { data: "data:image/png;base64,...", cwd: "..." }
  const { data, cwd } = req.body;
  if (!data) return res.status(400).json({ error: 'no image data' });
  const match = data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return res.status(400).json({ error: 'invalid image data' });
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buf = Buffer.from(match[2], 'base64');
  const dir = cwd || process.env.TEMP || process.env.TMP || '.';
  const name = 'clipboard-' + Date.now() + '.' + ext;
  const filePath = path.join(dir, name);
  try {
    fs.writeFileSync(filePath, buf);
    res.json({ ok: true, path: filePath, name });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Mo folder bang tool native (explorer | vscode | cmd)
app.post('/api/open', (req, res) => {
  const p = String(req.body.path || '').trim();
  const action = String(req.body.action || 'explorer').toLowerCase();
  if (!p) return res.status(400).json({ error: 'path required' });
  // Block any path containing shell metacharacters. Real Windows paths never
  // contain these, so this only blocks crafted attack input.
  if (hasShellMeta(p)) return res.status(400).json({ error: 'invalid chars in path' });
  try {
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'path not found' });
  } catch(_) { return res.status(400).json({ error: 'invalid path' }); }
  try {
    if (action === 'explorer') {
      spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref();
    } else if (action === 'vscode') {
      // code on Windows is code.cmd — Node requires shell:true to resolve .cmd
      // on PATH. Safe here because p has been validated against SHELL_META_RE.
      spawn('code', [p], { detached: true, stdio: 'ignore', shell: true }).unref();
    } else if (action === 'cmd') {
      // Open a new cmd window in the directory. p is validated, so embedding
      // it in the `cd /d` argument cannot break out of the quoted string.
      spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', 'cd /d "' + p + '"'], {
        detached: true, stdio: 'ignore', shell: false,
      }).unref();
    } else {
      return res.status(400).json({ error: 'unknown action' });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/overseer', (_, res) => res.json({ rule: buildRuleSummary() }));

// Broadcast overseer rule moi 3s
setInterval(() => broadcast({ type: 'overseer_rule', rule: buildRuleSummary() }), 3000);

// ── WebSocket routing ──────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  // Reject cross-origin WebSocket hijacks. Browsers always send Origin on
  // WS handshakes initiated by page scripts.
  if (!originAllowed(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  wss.handleUpgrade(req, socket, head, ws => {
    // /term/:id → terminal stream
    const termMatch = url.pathname.match(/^\/term\/([a-f0-9]+)$/);
    if (termMatch) {
      const sid = termMatch[1];
      const s = sessions.get(sid);
      if (!s) { ws.close(); return; }
      if (!termClients.has(sid)) termClients.set(sid, new Set());
      termClients.get(sid).add(ws);

      // Replay history
      for (const chunk of s.history) ws.send(chunk);

      ws.on('message', msg => {
        // Input tu client → PTY
        try {
          const data = msg.toString();
          if (data.startsWith('{')) {
            const obj = JSON.parse(data);
            if (obj.type === 'resize' && s.proc) {
              s.proc.resize(obj.cols, obj.rows);
              return;
            }
          }
          if (s.proc) s.proc.write(msg);
        } catch (_) {
          if (s.proc) { try { s.proc.write(msg); } catch(_){} }
        }
      });
      ws.on('close', () => {
        const set = termClients.get(sid);
        if (set) { set.delete(ws); if (!set.size) termClients.delete(sid); }
      });
      return;
    }

    // Default: control channel
    clients.add(ws);
    ws.send(JSON.stringify({
      type: 'init',
      sessions: [...sessions.values()].map(s => s.toJSON()),
      overseer: { rule: buildRuleSummary() },
    }));
    ws.on('close', () => clients.delete(ws));
  });
});

loadPersistedSessions();
server.listen(PORT, HOST, () => console.log(`\n🤖  Claude Hub v4 → http://${HOST}:${PORT}\n`));

// Graceful shutdown — kill PTY children, then flush state to disk
function shutdown() {
  for (const s of sessions.values()) {
    try { if (s.proc) s.proc.kill(); } catch(_) {}
  }
  try { persistSessions(true); } catch(_) {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

// Prevent server crash from unhandled errors (PTY spawn failures, etc.)
process.on('uncaughtException', (err) => {
  console.error('⚠️  Uncaught exception (server still running):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled rejection (server still running):', reason);
});
