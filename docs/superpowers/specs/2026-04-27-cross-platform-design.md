# Cross-Platform Support — Claude Hub

**Date:** 2026-04-27
**Status:** Approved

---

## Goals

Make Claude Hub run on macOS and Linux in addition to Windows, with no behavioral regression on Windows. Update README and landing page to reflect multi-platform support and add the existing public website link.

---

## Non-Goals

- WSL-specific paths or Windows-on-ARM optimizations
- BSD support (focus on macOS + mainstream Linux distros)
- Docker container packaging
- GUI installer

---

## Section 1: Platform Detection Layer

A new module `platform.js` (sibling to `server.js`) exposes platform-aware helpers. `server.js` no longer calls `spawn('explorer.exe', ...)` or `process.env.USERPROFILE` directly — it goes through the helper module.

### Module API

```js
// platform.js
const IS_WINDOWS = process.platform === 'win32';
const IS_MAC     = process.platform === 'darwin';
const IS_LINUX   = process.platform === 'linux';

module.exports = {
  IS_WINDOWS, IS_MAC, IS_LINUX,
  homeDir,            // () => string — os.homedir() with fallback
  findClaudeBinary,   // () => string | null
  openFileWithDefault,// (filePath) => void  (spawn detached, fire-and-forget)
  revealInFileManager,// (filePath) => void
  openFolder,         // (folderPath, action) => void  // action: 'explorer' | 'vscode' | 'terminal'
  moveToTrash,        // (filePath, cb) => void
};
```

All helpers spawn detached, unref'd child processes. None throw — they call `cb(err)` (for `moveToTrash`) or fail silently and log.

### Platform-specific implementations

| Operation | Windows | macOS | Linux |
|---|---|---|---|
| Open file w/ default app | `cmd.exe /c start "" path` | `open path` | `xdg-open path` |
| Reveal in file manager | `explorer.exe /select,path` | `open -R path` | `xdg-open dirname(path)` (no select) |
| Open folder | `explorer.exe path` | `open path` | `xdg-open path` |
| Open VS Code | `code path` (shell:true for `.cmd`) | `code path` (no shell) | `code path` (no shell) |
| Open terminal in folder | `cmd.exe /c start "" cmd.exe /k cd /d path` | `open -a Terminal path` | try `gnome-terminal` → `konsole` → `xterm` (first that exists), `--working-directory=path` |
| Move to trash | existing VBScript + `cscript.exe` | `mv path ~/.Trash/` (with rename if name collision) | `mv path ~/.local/share/Trash/files/` + write `.trashinfo` (FreeDesktop spec) |

### Why no `trash` npm package

Adding a native dep means another `node-gyp` / build risk. The 3 platform-specific implementations are short (≤30 lines each). Inline.

---

## Section 2: Claude Binary Discovery

Replace the current Windows-only search with cross-platform paths.

### Search order (first existing wins)

**Windows:**
1. `%USERPROFILE%\.local\bin\claude.exe`
2. `%USERPROFILE%\AppData\Roaming\npm\claude.cmd`
3. `claude.exe` (PATH)
4. `claude.cmd` (PATH)
5. `claude` (PATH — fallback)

**macOS:**
1. `~/.local/bin/claude`
2. `~/.claude/local/claude`
3. `/usr/local/bin/claude`
4. `/opt/homebrew/bin/claude`
5. `claude` (PATH)

**Linux:**
1. `~/.local/bin/claude`
2. `~/.claude/local/claude`
3. `/usr/local/bin/claude`
4. `/usr/bin/claude`
5. `claude` (PATH)

PATH lookup uses `which`/`where` indirectly: just spawn with `shell: true` and the bare name — the OS will resolve it. We probe existence via `fs.existsSync` for absolute paths only; for PATH names we trust spawn.

### Error message

If discovery fails, log a clear message:
```
Cannot find Claude Code CLI. Install from https://claude.com/claude-code,
then ensure `claude` (Win: claude.exe) is on PATH.
Searched: <list of probed paths>
```

---

## Section 3: Path & Env Cleanup

### `os.homedir()` everywhere

Replace `process.env.USERPROFILE` with `os.homedir()` at all 5 call sites:
- `Session.cwd` default
- workCwd fallback in `restoreSessions`
- Claude binary search
- `RECENT_FILE` location
- `BOOKMARKS_FILE` location

### Default cwd

`'C:\\'` literal becomes `os.homedir()`.

### `.claude-hub-recent.json` / `.claude-hub-bookmarks.json`

These store user-relative state. They were written under `%USERPROFILE%`. On macOS/Linux they go under `~/`. Same filenames — existing Windows installs are unaffected (file name unchanged, path resolves via `os.homedir()`).

### Path validation regex

`hasShellMeta` and other path validators currently use Windows-friendly regex. Audit each: ensure forward-slash paths still work. Specifically:
- `SHELL_META_RE` blocks `& | ; $ \` etc — these are also dangerous on Unix. Keep.
- File rename regex `/[\\\/:*?"<>|\r\n\0]/` — conservative; works on both. Keep.

No changes needed beyond `os.homedir()` substitution.

---

## Section 4: Trash Implementation Per Platform

### Windows

Existing VBScript via `cscript.exe` — keep unchanged. Goes to Recycle Bin properly.

### macOS

```js
function macTrash(p, cb) {
  const trash = path.join(os.homedir(), '.Trash');
  let dest = path.join(trash, path.basename(p));
  if (fs.existsSync(dest)) {
    // Append timestamp suffix to avoid collision
    const ext = path.extname(p);
    const base = path.basename(p, ext);
    dest = path.join(trash, base + ' ' + new Date().toISOString().replace(/[:.]/g, '-') + ext);
  }
  fs.rename(p, dest, (err) => cb(err ? err.message : null));
}
```

### Linux (FreeDesktop)

```js
function linuxTrash(p, cb) {
  const trashRoot = path.join(os.homedir(), '.local', 'share', 'Trash');
  const filesDir  = path.join(trashRoot, 'files');
  const infoDir   = path.join(trashRoot, 'info');
  try { fs.mkdirSync(filesDir, { recursive: true }); fs.mkdirSync(infoDir, { recursive: true }); } catch(_){}
  const base = path.basename(p);
  let dest = path.join(filesDir, base);
  let info = path.join(infoDir, base + '.trashinfo');
  if (fs.existsSync(dest)) {
    const ts = Date.now();
    dest = path.join(filesDir, base + '.' + ts);
    info = path.join(infoDir, base + '.' + ts + '.trashinfo');
  }
  const trashinfo = '[Trash Info]\nPath=' + p + '\nDeletionDate=' + new Date().toISOString().split('.')[0] + '\n';
  try { fs.writeFileSync(info, trashinfo); } catch(_){}
  fs.rename(p, dest, (err) => cb(err ? err.message : null));
}
```

If trash fails on Linux (e.g., trying to trash from a different filesystem than `~`), fall back to a clear error. Don't auto-delete.

---

## Section 5: Launch Scripts

### `start.sh` (new — Mac/Linux)

```sh
#!/bin/sh
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

`chmod +x start.sh` documented in README.

### `start.bat` (existing — Windows)

Unchanged.

---

## Section 6: README + Landing Page Updates

### README.md

- Update platform badge: `Windows | macOS | Linux`
- Add **Live Demo / Project Site:** link to https://claudehub.aithetech.com/
- Replace the single "Install / Run" section with three subsections: Windows, macOS, Linux
- Update Project layout to mention `platform.js`, `start.sh`, `vercel.json`, `docs/index.html`

### `docs/index.html` (landing page)

The landing page is deployed to Vercel at https://claudehub.aithetech.com/. Inspect it — if it currently says "Windows-only" or shows only `start.bat`, update those references. Otherwise leave content alone (no design change in scope).

---

## What Is NOT Changed

- WebSocket protocol, PTY, session lifecycle
- xterm.js terminal rendering
- localStorage keys
- Node version requirement (≥18, already cross-platform)
- `node-pty` dependency (already cross-platform)
- Existing Windows behavior (regression test on Windows after port)

---

## File Impact

- **New:**
  - `platform.js` — platform helpers
  - `start.sh` — Mac/Linux launcher
- **Modified:**
  - `server.js` — replace direct `spawn`/`USERPROFILE`/`'C:\\'` with `platform.js` helpers (≈ 7 call sites)
  - `README.md` — multi-platform install + website link
  - `docs/index.html` — install instructions if currently Windows-specific
  - `package.json` — none (no new deps)
- **Unchanged:**
  - `public/index.html`
  - all session lifecycle / WebSocket code
  - file-validation regex
