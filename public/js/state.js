var searchCaseSensitive = {};
var activeSearchSid = null;
var dragState = { active: false, fromSid: null };
var sessionTags = JSON.parse(localStorage.getItem('claude-hub-tags') || '{}');
var sessionTemplates = JSON.parse(localStorage.getItem('claude-hub-templates') || '[]');
var templateDismiss = null;
var TERM_RECONNECT_DELAYS = [1000, 2000, 4000, 8000];
var termFontSize = parseInt(localStorage.getItem('claude-hub-fontsize'), 10) || 12;
var zoomedSid = null;
var sessionFilter = '';
var layoutPresets = JSON.parse(localStorage.getItem('claude-hub-layout-presets') || '{}');
var presetDismiss = null;
var sessionNotes = JSON.parse(localStorage.getItem('claude-hub-notes') || '{}');
var paneColors = JSON.parse(localStorage.getItem('claude-hub-colors') || '{}');
var COLOR_PALETTE = ['', '#f85149', '#e3b341', '#3fb950', '#58a6ff', '#a371f7', '#f0883e', '#ec6547'];
function changeFontSize(delta) {
  termFontSize = Math.max(8, Math.min(24, termFontSize + delta));
  localStorage.setItem('claude-hub-fontsize', termFontSize);
  Object.values(panes).forEach(function(p) {
    try { p.term.options.fontSize = termFontSize; p.fit.fit(); } catch(_){}
  });
  document.getElementById('btn-font-size').textContent = termFontSize + 'px';
}
var prevStatus = {};
var notifyEnabled = localStorage.getItem('claude-hub-notify') === 'on';
var audioCtx = null;
var state = {};      // sessionId -> session JSON
var panes = {};      // sessionId -> { term, ws, fit, el }
var ctrlWs, retryCount = 0;
var selectedCwd = '';
var currentBrowse = null;

// ── Theme ──────────────────────────────────────────────────────────
var TERM_THEME_DARK = {
  background:'#000000', foreground:'#e6edf3',
  cursor:'#58a6ff', selectionBackground:'rgba(88,166,255,.3)'
};
var TERM_THEME_LIGHT = {
  background:'#ffffff', foreground:'#1f2328',
  cursor:'#0550ae', selectionBackground:'rgba(88,166,255,.3)',
  black:'#24292f', red:'#cf222e', green:'#116329',
  yellow:'#4d2d00', blue:'#0550ae', magenta:'#8250df',
  cyan:'#1b7c83', white:'#6e7781',
  brightBlack:'#57606a', brightRed:'#a40e26', brightGreen:'#1a7f37',
  brightYellow:'#633c01', brightBlue:'#0969da', brightMagenta:'#6639ba',
  brightCyan:'#3192aa', brightWhite:'#8c959f'
};
var currentTheme = localStorage.getItem('claude-hub-theme') || 'dark';
function applyTheme(forceTheme) {
  if (forceTheme) {
    currentTheme = forceTheme;
  } else {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  }
  localStorage.setItem('claude-hub-theme', currentTheme);
  var html = document.documentElement;
  var btn = document.getElementById('btn-theme');
  if (currentTheme === 'light') {
    html.setAttribute('data-theme', 'light');
    if (btn) btn.textContent = '🌙';
  } else {
    html.removeAttribute('data-theme');
    if (btn) btn.textContent = '☀';
  }
  var theme = currentTheme === 'light' ? TERM_THEME_LIGHT : TERM_THEME_DARK;
  Object.values(panes).forEach(function(p) {
    try { p.term.options.theme = theme; } catch(_){}
  });
}
