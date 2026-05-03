/**
 * agent-team-terminal.js — xterm.js wrapper for lead agent terminal
 *
 * Creates a real terminal that renders Claude Code TUI natively.
 * Connects to existing /term/:sessionId WebSocket for PTY streaming.
 */

'use strict';

class LeadTerminal {
  constructor(container) {
    this.container = container;
    this.ws = null;
    this.sessionId = null;

    // Create xterm instance
    this.term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(88,166,255,0.3)',
        black: '#0d1117',
        red: '#f85149',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#a78bfa',
        cyan: '#79c0ff',
        white: '#e6edf3',
        brightBlack: '#484f58',
        brightRed: '#f85149',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#a5d6ff',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);

    // Initial fit
    requestAnimationFrame(() => this._fit());

    // Auto-fit on resize
    this._resizeObserver = new ResizeObserver(() => this._fit());
    this._resizeObserver.observe(container);
  }

  connect(sessionId) {
    this.disconnect();
    this.sessionId = sessionId;
    this.term.clear();

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/term/${sessionId}`);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      // Send initial size
      this._sendResize();
    };

    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        this.term.write(e.data);
      } else {
        this.term.write(new Uint8Array(e.data));
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
    };

    // Forward keyboard input to PTY
    this.term.onData((data) => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(data);
      }
    });
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.sessionId = null;
  }

  _fit() {
    try {
      this.fitAddon.fit();
      this._sendResize();
    } catch {}
  }

  _sendResize() {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols: this.term.cols,
        rows: this.term.rows,
      }));
    }
  }

  focus() {
    this.term.focus();
  }

  isConnected() {
    return this.ws && this.ws.readyState === 1;
  }
}
