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
