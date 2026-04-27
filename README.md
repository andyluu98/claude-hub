# Claude Hub

A cross-platform dashboard for managing multiple [Claude Code](https://claude.com/claude-code) sessions in parallel. Each session runs a real `claude` PTY, piped raw to an xterm.js terminal in the browser — you get the actual interactive TUI, not a fake chat wrapper.

🌐 **Project site:** https://claudehub.aithetech.com/

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- Spawn, pause, resume, rename, and kill multiple Claude Code sessions
- Per-session working directory with a built-in filesystem browser
- Persistent session state — reload the page and everything is still there
- Three lanes (active / pending / done) for kanban-style workflow
- File operations: open, reveal in Explorer, rename, duplicate, new file/folder, delete to Recycle Bin
- Clipboard image paste → auto-saved to temp file and pushed into Claude's input
- Bookmarks + recent paths
- Auto-accept mode toggle per session (`--dangerously-skip-permissions`)

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

## Security

**Claude Hub is a local development tool. It is NOT designed to be exposed to the internet or a shared network.**

- The server binds to `127.0.0.1` only — remote hosts cannot connect
- API and WebSocket endpoints verify the `Origin` / `Referer` header to block CSRF from malicious websites
- All file operations run with the permissions of the user that started `node server.js` — Claude Hub can read, modify, and delete any file that user can
- Sessions started with **Auto-accept** use Claude's `--dangerously-skip-permissions` flag, meaning Claude will not ask before editing files or running shell commands. Only enable this on trusted working directories

**Do not run Claude Hub behind a reverse proxy or on a shared machine without adding your own authentication layer.** If you need multi-user access, fork it and add proper auth — the current threat model is single-user localhost only.

Session terminal scrollback (up to ~50KB tail per session) is persisted to `.claude-hub-sessions.json` in the project folder. This file may contain sensitive output from Claude — it is gitignored by default, don't commit it.

## Project layout

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

## Contributing

PRs welcome. Please:

1. Open an issue first for non-trivial changes
2. Keep commits small and use conventional commit messages (`feat:`, `fix:`, `refactor:`, etc.)
3. Don't commit `node_modules/`, release zips, or `.claude-hub-sessions.json`
4. Test on at least one of: Windows 10/11, macOS, or recent Linux distro

## License

MIT — see [LICENSE](LICENSE).
