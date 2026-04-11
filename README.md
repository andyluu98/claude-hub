# Claude Hub

A Windows-native dashboard for managing multiple [Claude Code](https://claude.com/claude-code) sessions in parallel. Each session runs a real `claude.exe` PTY, piped raw to an xterm.js terminal in the browser — you get the actual interactive TUI, not a fake chat wrapper.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows-blue)
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

- **Windows 10/11**
- **Node.js 18+** — https://nodejs.org
- **Claude Code CLI** installed and on `PATH` (or at `%USERPROFILE%\.local\bin\claude.exe`) — https://claude.com/claude-code

## Install

```bat
git clone https://github.com/ltuananhsd/claude-hub.git
cd claude-hub
npm install
```

> `node-pty` is a native addon. `npm install` will build it with `node-gyp` — you need Visual Studio Build Tools or `windows-build-tools` once. If you hit build errors, run `npm install --global windows-build-tools` as admin, then retry.

## Run

```bat
start.bat
```

or

```bat
node server.js
```

Then open http://localhost:8765 — the browser is auto-launched by `start.bat`.

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
├── public/
│   └── index.html         # Single-page dashboard (xterm.js)
├── start.bat              # One-click launcher
├── pack.bat               # Create distributable zip
├── package.json
└── LICENSE
```

## Contributing

PRs welcome. Please:

1. Open an issue first for non-trivial changes
2. Keep commits small and use conventional commit messages (`feat:`, `fix:`, `refactor:`, etc.)
3. Don't commit `node_modules/`, release zips, or `.claude-hub-sessions.json`
4. Test on Windows 10 and Windows 11 if possible

## License

MIT — see [LICENSE](LICENSE).
