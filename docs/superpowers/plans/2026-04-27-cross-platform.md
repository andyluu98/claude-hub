# Cross-Platform Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port Claude Hub from Windows-only to Windows + macOS + Linux. Add `platform.js` helper module so `server.js` makes no direct OS-specific calls. Add `start.sh` launcher. Update README + landing page with multi-platform install + website link.

**Architecture:** Introduce `platform.js` exposing `findClaudeBinary`, `openFileWithDefault`, `revealInFileManager`, `openFolder`, `moveToTrash`. `server.js` is refactored to call these helpers instead of `spawn('explorer.exe', ...)` / `process.env.USERPROFILE` / VBScript-via-cscript. Zero new npm deps — trash implementations are inline per OS.

**Tech Stack:** Node.js 18+, `os`, `path`, `child_process.spawn`, `fs` (all built-in).

---

## File Impact

- **New:** `platform.js`, `start.sh`
- **Modified:** `server.js`, `README.md`, `docs/index.html`
- **Unchanged:** `public/index.html`, `package.json`

---

## Task 1: Create `platform.js` module

**Files:** Create `C:\Users\LG\claude-hub\platform.js`

- [ ] **Step 1: Create the module**

Write the following file:

```js
// platform.js — OS-aware spawn helpers + Claude binary discovery
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC     = process.platform === 'darwin';
const IS_LINUX   = process.platform === 'linux';

function homeDir() {
  return os.homedir() || process.env.HOME || process.env.USERPROFILE || '/';
}

function existsExec(p) {
  try { return fs.existsSync(p); } catch(_) { return false; }
}

function findClaudeBinary() {
  const home = homeDir();
  const cands = IS_WINDOWS
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        'claude.exe',
        'claude.cmd',
        'claude',
      ]
    : IS_MAC
      ? [
          path.join(home, '.local', 'bin', 'claude'),
          path.join(home, '.claude', 'local', 'claude'),
          '/usr/local/bin/claude',
          '/opt/homebrew/bin/claude',
          'claude',
        ]
      : [
          path.join(home, '.local', 'bin', 'claude'),
          path.join(home, '.claude', 'local', 'claude'),
          '/usr/local/bin/claude',
          '/usr/bin/claude',
          'claude',
        ];
  for (const c of cands) {
    if (path.isAbsolute(c)) {
      if (existsExec(c)) return c;
    } else {
      // bare name → trust PATH; spawn with shell:true will resolve
      return c;
    }
  }
  return null;
}

function openFileWithDefault(p) {
  try {
    if (IS_WINDOWS) {
      spawn('cmd.exe', ['/c', 'start', '""', p], { detached:true, stdio:'ignore', windowsVerbatimArguments:false }).unref();
    } else if (IS_MAC) {
      spawn('open', [p], { detached:true, stdio:'ignore' }).unref();
    } else {
      spawn('xdg-open', [p], { detached:true, stdio:'ignore' }).unref();
    }
  } catch(_) {}
}

function revealInFileManager(p) {
  try {
    if (IS_WINDOWS) {
      spawn('explorer.exe', ['/select,', p], { detached:true, stdio:'ignore' }).unref();
    } else if (IS_MAC) {
      spawn('open', ['-R', p], { detached:true, stdio:'ignore' }).unref();
    } else {
      // Linux has no universal "select file" — open parent dir
      spawn('xdg-open', [path.dirname(p)], { detached:true, stdio:'ignore' }).unref();
    }
  } catch(_) {}
}

function openFolder(p, action) {
  action = (action || 'explorer').toLowerCase();
  try {
    if (action === 'explorer') {
      if (IS_WINDOWS) {
        spawn('explorer.exe', [p], { detached:true, stdio:'ignore' }).unref();
      } else if (IS_MAC) {
        spawn('open', [p], { detached:true, stdio:'ignore' }).unref();
      } else {
        spawn('xdg-open', [p], { detached:true, stdio:'ignore' }).unref();
      }
    } else if (action === 'vscode') {
      // On Windows, `code` is `code.cmd` → needs shell:true. On Unix it's a real binary.
      spawn('code', [p], { detached:true, stdio:'ignore', shell: IS_WINDOWS }).unref();
    } else if (action === 'cmd') {
      if (IS_WINDOWS) {
        spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', 'cd /d "' + p + '"'],
              { detached:true, stdio:'ignore', shell:false }).unref();
      } else if (IS_MAC) {
        spawn('open', ['-a', 'Terminal', p], { detached:true, stdio:'ignore' }).unref();
      } else {
        // Try common Linux terminals in order; first to spawn wins.
        const tryTerm = (name, args) => {
          try {
            const c = spawn(name, args, { detached:true, stdio:'ignore' });
            c.on('error', () => {});
            c.unref();
            return true;
          } catch(_) { return false; }
        };
        if (!tryTerm('gnome-terminal', ['--working-directory=' + p])) {
          if (!tryTerm('konsole', ['--workdir', p])) {
            tryTerm('xterm', ['-e', 'cd ' + JSON.stringify(p) + ' && $SHELL']);
          }
        }
      }
    } else {
      throw new Error('unknown action: ' + action);
    }
  } catch(e) { throw e; }
}

function moveToTrash(p, cb) {
  if (!fs.existsSync(p)) return cb('path not found');
  if (IS_WINDOWS) return winTrash(p, cb);
  if (IS_MAC) return macTrash(p, cb);
  return linuxTrash(p, cb);
}

function winTrash(p, cb) {
  const parent = path.dirname(p);
  const name = path.basename(p);
  const esc = s => s.replace(/"/g, '""');
  const vbs =
    'Set oShell = CreateObject("Shell.Application")\r\n' +
    'Set oFolder = oShell.Namespace("' + esc(parent) + '")\r\n' +
    'If oFolder Is Nothing Then WScript.Quit 2\r\n' +
    'Set oItem = oFolder.ParseName("' + esc(name) + '")\r\n' +
    'If oItem Is Nothing Then WScript.Quit 3\r\n' +
    'oItem.InvokeVerb("delete")\r\n';
  const tmp = path.join(os.tmpdir(), 'claude-hub-recycle-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) + '.vbs');
  try { fs.writeFileSync(tmp, vbs, 'utf8'); } catch(e) { return cb(e.message); }
  const proc = spawn('cscript.exe', ['//nologo', '//B', tmp], { windowsHide: true });
  let err = '';
  proc.stderr.on('data', d => err += d.toString());
  proc.on('exit', code => {
    try { fs.unlinkSync(tmp); } catch(_){}
    if (code === 0) {
      setTimeout(() => {
        if (!fs.existsSync(p)) cb(null);
        else cb('Delete failed (file still exists)');
      }, 300);
    } else {
      cb(err || ('cscript exit ' + code));
    }
  });
}

function macTrash(p, cb) {
  const trash = path.join(homeDir(), '.Trash');
  try { fs.mkdirSync(trash, { recursive:true }); } catch(_){}
  let dest = path.join(trash, path.basename(p));
  if (fs.existsSync(dest)) {
    const ext  = path.extname(p);
    const base = path.basename(p, ext);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    dest = path.join(trash, base + ' ' + stamp + ext);
  }
  fs.rename(p, dest, (err) => cb(err ? err.message : null));
}

function linuxTrash(p, cb) {
  const trashRoot = path.join(homeDir(), '.local', 'share', 'Trash');
  const filesDir  = path.join(trashRoot, 'files');
  const infoDir   = path.join(trashRoot, 'info');
  try { fs.mkdirSync(filesDir, { recursive:true }); fs.mkdirSync(infoDir, { recursive:true }); } catch(_){}
  const base = path.basename(p);
  let dest = path.join(filesDir, base);
  let info = path.join(infoDir, base + '.trashinfo');
  if (fs.existsSync(dest)) {
    const ts = Date.now();
    dest = path.join(filesDir, base + '.' + ts);
    info = path.join(infoDir, base + '.' + ts + '.trashinfo');
  }
  const date = new Date().toISOString().split('.')[0];
  const trashinfo = '[Trash Info]\nPath=' + p + '\nDeletionDate=' + date + '\n';
  try { fs.writeFileSync(info, trashinfo); } catch(_){}
  fs.rename(p, dest, (err) => cb(err ? err.message : null));
}

module.exports = {
  IS_WINDOWS, IS_MAC, IS_LINUX,
  homeDir,
  findClaudeBinary,
  openFileWithDefault,
  revealInFileManager,
  openFolder,
  moveToTrash,
};
```

- [ ] **Step 2: Verify the file parses**

Run:
```bash
node -e "require('./platform.js')"
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add platform.js
git commit -m "feat: add platform.js cross-platform helpers (Win/Mac/Linux)"
```

---

## Task 2: Refactor `server.js` to use `platform.js`

**Files:** Modify `server.js`

- [ ] **Step 1: Add the require near the top**

Find `const { spawn } = require('child_process');` (or similar require block at top of `server.js`). Add immediately after the existing requires:

```js
const platform = require('./platform.js');
```

- [ ] **Step 2: Replace `process.env.USERPROFILE` references**

There are 5 call sites. Replace each `process.env.USERPROFILE || 'C:\\\\'` and similar fallback chains with `platform.homeDir()`.

Find:
```js
this.cwd        = cwd || process.env.USERPROFILE || 'C:\\';
```
Replace with:
```js
this.cwd        = cwd || platform.homeDir();
```

Find:
```js
catch { workCwd = process.env.USERPROFILE || 'C:\\'; s.cwd = workCwd; }
```
Replace with:
```js
catch { workCwd = platform.homeDir(); s.cwd = workCwd; }
```

Find:
```js
const RECENT_FILE    = path.join(process.env.USERPROFILE || '.', '.claude-hub-recent.json');
const BOOKMARKS_FILE = path.join(process.env.USERPROFILE || '.', '.claude-hub-bookmarks.json');
```
Replace with:
```js
const RECENT_FILE    = path.join(platform.homeDir(), '.claude-hub-recent.json');
const BOOKMARKS_FILE = path.join(platform.homeDir(), '.claude-hub-bookmarks.json');
```

- [ ] **Step 3: Replace Claude binary search**

Find the block:
```js
  // Find claude.exe
  const candidates = [
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe'),
    'claude.exe',
  ];
```
(plus the loop that picks the first existing one + the error path)

Replace the entire candidate-list + selection logic with:
```js
  // Find claude binary (cross-platform)
  const claudeBin = platform.findClaudeBinary();
  if (!claudeBin) {
    console.error('Cannot find Claude Code CLI. Install from https://claude.com/claude-code, then ensure `claude` (Win: claude.exe) is on PATH.');
    return;
  }
```

Subsequent code that references the picked candidate (e.g. `claudePath` or whatever local var the original used) should be replaced with `claudeBin`. **Read the original section carefully and substitute consistently** — the existing variable name might be `claudePath`, `claudeExe`, `bin`, etc.

- [ ] **Step 4: Replace `/api/file-open` body**

Find:
```js
    spawn('cmd.exe', ['/c', 'start', '""', p], { detached:true, stdio:'ignore', windowsVerbatimArguments:false }).unref();
```
Replace with:
```js
    platform.openFileWithDefault(p);
```

- [ ] **Step 5: Replace `/api/file-reveal` body**

Find:
```js
    spawn('explorer.exe', ['/select,', p], { detached:true, stdio:'ignore' }).unref();
```
Replace with:
```js
    platform.revealInFileManager(p);
```

- [ ] **Step 6: Replace `/api/open` body**

Find the entire `try { if (action === 'explorer') {...} else if (action === 'vscode') {...} else if (action === 'cmd') {...} else { ... } }` block. Replace with:

```js
  try {
    platform.openFolder(p, action);
    res.json({ ok: true });
  } catch(e) {
    if (e && e.message && /unknown action/.test(e.message)) {
      return res.status(400).json({ error: 'unknown action' });
    }
    res.status(500).json({ error: e && e.message || String(e) });
  }
```

(Be careful: keep the surrounding `app.post('/api/open', ...)` wrapper and `res.json` flow consistent. The `try/catch` already exists in the route; you're replacing the body of that try block.)

- [ ] **Step 7: Replace `/api/file-delete` body — call `platform.moveToTrash`**

Find:
```js
  recycleDelete(p, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ ok: true });
  });
```
Replace with:
```js
  platform.moveToTrash(p, (err) => {
    if (err) return res.status(500).json({ error: err });
    res.json({ ok: true });
  });
```

- [ ] **Step 8: Remove the old `recycleDelete` function**

Find `function recycleDelete(target, cb) { ... }` in `server.js` and delete the entire function (it's been moved into `platform.js` as `winTrash`).

- [ ] **Step 9: Verify `server.js` parses**

```bash
node -c server.js
```
Expected: no output (success).

- [ ] **Step 10: Smoke-test on Windows**

```bash
npm start
```
Open http://localhost:8765 — verify:
- New session can be created and shows real `claude` PTY
- Right-click on file in sidebar → reveal in Explorer (works)
- Open folder action (sidebar context menu / API) opens Explorer/VSCode/cmd
- Delete file from sidebar → goes to Recycle Bin (file gone, recoverable)

Stop the server. Confirm `node-pty` and Claude PTY still spawn correctly.

- [ ] **Step 11: Commit**

```bash
git add server.js
git commit -m "refactor: route OS-specific calls through platform.js"
```

---

## Task 3: Add `start.sh`

**Files:** Create `C:\Users\LG\claude-hub\start.sh`

- [ ] **Step 1: Create the file**

```sh
#!/bin/sh
# Claude Hub launcher (macOS / Linux)
cd "$(dirname "$0")"
node server.js &
SERVER_PID=$!
sleep 1
case "$(uname -s)" in
  Darwin) open "http://localhost:8765" ;;
  Linux)  xdg-open "http://localhost:8765" >/dev/null 2>&1 ;;
esac
wait $SERVER_PID
```

- [ ] **Step 2: Mark executable (Git tracks the bit)**

```bash
git update-index --chmod=+x start.sh
```

(On Windows this updates the index permission bit so checkout on Mac/Linux gets `+x` automatically.)

- [ ] **Step 3: Commit**

```bash
git add start.sh
git commit -m "feat: add start.sh launcher for macOS/Linux"
```

---

## Task 4: Update `README.md`

**Files:** Modify `README.md`

- [ ] **Step 1: Replace the header section**

Find the entire top of `README.md` from the title down to the end of the badges row.

Replace with:

```markdown
# Claude Hub

A cross-platform dashboard for managing multiple [Claude Code](https://claude.com/claude-code) sessions in parallel. Each session runs a real `claude` PTY, piped raw to an xterm.js terminal in the browser — you get the actual interactive TUI, not a fake chat wrapper.

🌐 **Project site:** https://claudehub.aithetech.com/

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)
```

- [ ] **Step 2: Replace the Requirements + Install + Run sections**

Find the `## Requirements` section and everything down to (but NOT including) `## Security`.

Replace with:

```markdown
## Requirements

- **Node.js 18+** — https://nodejs.org
- **Claude Code CLI** installed and on `PATH`. Tested locations:
  - Windows: `%USERPROFILE%\.local\bin\claude.exe`
  - macOS: `~/.local/bin/claude`, `/opt/homebrew/bin/claude`
  - Linux: `~/.local/bin/claude`, `/usr/local/bin/claude`
- Install: https://claude.com/claude-code
- A modern browser (Chrome 105+, Edge, Firefox 110+, Safari 16+)

## Install

```bash
git clone https://github.com/andyluu98/claude-hub.git
cd claude-hub
npm install
```

> `node-pty` is a native addon. `npm install` will build it with `node-gyp`.
> - **Windows:** install Visual Studio Build Tools or run `npm install --global windows-build-tools` (admin) once.
> - **macOS:** Xcode Command Line Tools — `xcode-select --install`
> - **Linux:** `python3`, `make`, and a C++ compiler — `sudo apt install build-essential` (Debian/Ubuntu) or `sudo dnf groupinstall "Development Tools"` (Fedora).

## Run

### Windows

```bat
start.bat
```

Or manually:

```bat
node server.js
```

### macOS / Linux

```sh
chmod +x start.sh
./start.sh
```

Or manually:

```sh
node server.js
```

Open http://localhost:8765 — `start.bat` / `start.sh` auto-launches the default browser.

```

- [ ] **Step 3: Update Project layout block**

Find:
```
claude-hub/
├── server.js              # Express + WebSocket + PTY backend
├── public/
│   └── index.html         # Single-page dashboard (xterm.js)
├── start.bat              # One-click launcher
├── pack.bat               # Create distributable zip
├── package.json
└── LICENSE
```

Replace with:
```
claude-hub/
├── server.js              # Express + WebSocket + PTY backend
├── platform.js            # OS-specific spawn helpers (Win/Mac/Linux)
├── public/
│   └── index.html         # Single-page dashboard (xterm.js)
├── docs/
│   └── index.html         # Public landing page (deployed to Vercel)
├── start.bat              # Launcher (Windows)
├── start.sh               # Launcher (macOS/Linux)
├── pack.bat               # Create distributable zip (Windows)
├── vercel.json            # Vercel config for landing page
├── package.json
└── LICENSE
```

- [ ] **Step 4: Update Contributing section**

Find:
```markdown
4. Test on Windows 10 and Windows 11 if possible
```

Replace with:
```markdown
4. Test on at least one of: Windows 10/11, macOS, or recent Linux distro
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README — multi-platform install + project site link"
```

---

## Task 5: Audit landing page (`docs/index.html`)

**Files:** Possibly modify `docs/index.html`

- [ ] **Step 1: Search for Windows-specific text**

```bash
grep -inE "windows-only|windows-native|start\.bat|claude\.exe|cmd\.exe|explorer\.exe" docs/index.html | head
```

- [ ] **Step 2: Update if found**

For each match:
- "Windows-native dashboard" → "Cross-platform dashboard"
- "claude.exe" alone → "claude binary" (or keep `claude.exe` if it's specifically the Windows flow)
- `start.bat`-only references → mention `start.sh` for Mac/Linux

If no matches, skip Step 3.

- [ ] **Step 3: Commit (only if changes were made)**

```bash
git add docs/index.html
git commit -m "docs: landing page — update copy for cross-platform support"
```

---

## Self-Review

**Spec coverage:**
- ✅ Section 1 (platform.js helpers) — Task 1
- ✅ Section 2 (Claude binary discovery) — Task 1 (`findClaudeBinary`) + Task 2 Step 3 (server.js consumes it)
- ✅ Section 3 (paths & env) — Task 2 Step 2
- ✅ Section 4 (trash per platform) — Task 1 (`winTrash`/`macTrash`/`linuxTrash`)
- ✅ Section 5 (`start.sh`) — Task 3
- ✅ Section 6 (README + landing) — Tasks 4 + 5

**Placeholder scan:** No TBD/TODO. All steps show exact code or exact patterns to find/replace.

**Type consistency:**
- `platform.findClaudeBinary()` returns `string | null` — null check in server.js consumer ✅
- `platform.moveToTrash(p, cb)` follows existing callback signature `cb(err | null)` ✅
- `platform.openFolder(p, action)` throws on unknown action — caught and re-thrown as 400 in route ✅
- `platform.homeDir()` always returns a string (fallback chain ensures non-empty) ✅

**Cross-platform edge cases:**
- Linux `/api/file-reveal` falls back to opening parent dir (no universal "select-in-explorer") — documented ✅
- Linux trash on different filesystem from `~` → `fs.rename` returns `EXDEV` → cb('error') propagates as 500 ✅
- macOS: `~/.Trash` always exists, but mkdir-recursive defends against fresh user accounts ✅
- VS Code on Windows uses `code.cmd` → `shell:true`. On Unix uses real binary → no shell needed ✅
- Linux terminal fallback: tries 3 in order, all may fail silently if no GUI (acceptable — server-only environment shouldn't trigger this UI) ✅

**Order dependency:**
- Task 1 must precede Task 2 (server.js requires `./platform.js`)
- Tasks 3, 4, 5 are independent (can run in any order after Task 2)
