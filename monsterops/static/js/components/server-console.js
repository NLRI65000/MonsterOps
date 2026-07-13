/**
 * Server Console Panel — Phase 21
 * Slide-up panel (backtick key) with App Log, RADIUS Log, and command palette.
 * Only mounted when the logged-in user is superadmin or admin.
 */

import { api } from '../api.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function _now() {
  return new Date().toTimeString().slice(0, 8);
}

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const LEVEL_COLORS = {
  ERROR:    '#ef5350',
  CRITICAL: '#ef5350',
  WARNING:  '#ffa726',
  WARN:     '#ffa726',
  INFO:     '#42a5f5',
  DEBUG:    '#78909c',
};

function _colorLine(line) {
  for (const [lvl, color] of Object.entries(LEVEL_COLORS)) {
    if (line.includes(lvl)) return color;
  }
  return 'var(--color-text)';
}

// ── panel state ──────────────────────────────────────────────────────────────

const MAX_LINES = 1000;

let _panel = null;
let _activeTab = 'applog';
let _streams = {}; // keyed by tab name
let _logLines = { applog: [], radius: [] };

// ── SSE stream manager ───────────────────────────────────────────────────────

function _stopStream(name) {
  const es = _streams[name];
  if (es) {
    es.close();
    delete _streams[name];
  }
}

function _startStream(name, url) {
  _stopStream(name);
  // EventSource sends the HttpOnly session cookie automatically (same-origin).
  const es = new EventSource(url);
  es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      _pushLine(name, d.line);
    } catch {}
  };
  es.onerror = () => {
    // Don't remove — EventSource auto-reconnects on transient errors
  };
  _streams[name] = es;
}

function _pushLine(tab, line) {
  const arr = _logLines[tab];
  arr.push({ line, ts: _now() });
  if (arr.length > MAX_LINES) arr.splice(0, arr.length - MAX_LINES);
  if (_activeTab === tab && _panel) _appendLogLine(tab, line);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _getLogArea() {
  return _panel?.querySelector('#console-log-area');
}

function _appendLogLine(tab, line) {
  const area = _getLogArea();
  if (!area) return;
  const atBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 32;
  const span = document.createElement('div');
  span.style.color = _colorLine(line);
  span.textContent = line;
  area.appendChild(span);
  // Trim DOM nodes if they exceed MAX_LINES
  while (area.childElementCount > MAX_LINES) area.firstElementChild.remove();
  if (atBottom) area.scrollTop = area.scrollHeight;
}

function _fillLogArea(tab) {
  const area = _getLogArea();
  if (!area) return;
  area.innerHTML = '';
  for (const { line } of _logLines[tab]) {
    const span = document.createElement('div');
    span.style.color = _colorLine(line);
    span.textContent = line;
    area.appendChild(span);
  }
  area.scrollTop = area.scrollHeight;
}

// ── panel build ───────────────────────────────────────────────────────────────

function _buildPanel() {
  const el = document.createElement('div');
  el.id = 'mr-console-panel';
  el.setAttribute('aria-label', 'Server Console');
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <style>
      #mr-console-panel {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        height: 38vh;
        min-height: 220px;
        max-height: 80vh;
        background: #0d1117;
        border-top: 2px solid var(--color-accent, #6366f1);
        z-index: 8000;
        display: flex;
        flex-direction: column;
        font-family: 'Cascadia Code', 'Fira Mono', 'Consolas', monospace;
        font-size: 0.78rem;
        transform: translateY(100%);
        transition: transform 0.22s ease;
        box-shadow: 0 -4px 32px rgba(0,0,0,0.5);
      }
      #mr-console-panel.open { transform: translateY(0); }
      #console-topbar {
        display: flex;
        align-items: center;
        gap: 0;
        background: #161b22;
        border-bottom: 1px solid #30363d;
        padding: 0 0.75rem;
        flex-shrink: 0;
        user-select: none;
      }
      .console-tab {
        padding: 0.4rem 0.85rem;
        cursor: pointer;
        color: #8b949e;
        font-size: 0.77rem;
        border-bottom: 2px solid transparent;
        transition: color 0.12s, border-color 0.12s;
      }
      .console-tab:hover { color: #e6edf3; }
      .console-tab.active { color: #e6edf3; border-bottom-color: var(--color-accent, #6366f1); }
      .console-spacer { flex: 1; }
      .console-ctrl {
        background: none;
        border: none;
        cursor: pointer;
        color: #8b949e;
        font-size: 0.8rem;
        padding: 0.4rem 0.5rem;
        display: flex;
        align-items: center;
        gap: 0.3rem;
      }
      .console-ctrl:hover { color: #e6edf3; }
      #console-log-area {
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem 0.75rem;
        color: #c9d1d9;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-all;
      }
      #console-cmd-area {
        flex: 1;
        overflow-y: auto;
        padding: 0.75rem;
        color: #c9d1d9;
        display: none;
      }
      .cmd-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 540px;
      }
      .cmd-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 6px;
        padding: 0.5rem 0.75rem;
        cursor: pointer;
        transition: border-color 0.12s, background 0.12s;
      }
      .cmd-item:hover { border-color: var(--color-accent, #6366f1); background: #1c2128; }
      .cmd-label { flex: 1; font-size: 0.8rem; }
      .cmd-result {
        font-size: 0.75rem;
        margin-top: 0.3rem;
        padding: 0.3rem 0.6rem;
        background: #0d1117;
        border-radius: 4px;
        white-space: pre-wrap;
        color: #8b949e;
        display: none;
      }
      .cmd-result.visible { display: block; }
      .cmd-result.ok { color: #56d364; }
      .cmd-result.err { color: #ef5350; }
      #console-resize-handle {
        height: 4px;
        background: transparent;
        cursor: ns-resize;
        flex-shrink: 0;
      }
      #console-resize-handle:hover { background: var(--color-accent, #6366f1)44; }
    </style>
    <div id="console-resize-handle" title="Drag to resize"></div>
    <div id="console-topbar">
      <span class="console-tab active" data-tab="applog">App Log</span>
      <span class="console-tab" data-tab="radius">RADIUS Log</span>
      <span class="console-tab" data-tab="commands">Commands</span>
      <span class="console-spacer"></span>
      <button class="console-ctrl" id="console-clear" title="Clear">✕ Clear</button>
      <button class="console-ctrl" id="console-close" title="Close (\` key)">↓ Close</button>
    </div>
    <div id="console-log-area"></div>
    <div id="console-cmd-area"><div class="cmd-list" id="cmd-list">Loading…</div></div>
  `;

  // Tab switching
  el.querySelectorAll('.console-tab').forEach(t => {
    t.addEventListener('click', () => _switchTab(t.dataset.tab));
  });

  el.querySelector('#console-close').addEventListener('click', _closePanel);
  el.querySelector('#console-clear').addEventListener('click', () => {
    if (_activeTab === 'commands') return;
    _logLines[_activeTab] = [];
    const area = _getLogArea();
    if (area) area.innerHTML = '';
  });

  // Resize by dragging top edge
  const handle = el.querySelector('#console-resize-handle');
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = el.offsetHeight;
    const onMove = (ev) => {
      const newH = Math.max(120, Math.min(window.innerHeight * 0.85, startH - (ev.clientY - startY)));
      el.style.height = newH + 'px';
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  return el;
}

// ── tab switching ─────────────────────────────────────────────────────────────

function _switchTab(name) {
  _activeTab = name;
  if (!_panel) return;

  _panel.querySelectorAll('.console-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });

  const logArea = _panel.querySelector('#console-log-area');
  const cmdArea = _panel.querySelector('#console-cmd-area');

  if (name === 'commands') {
    logArea.style.display = 'none';
    cmdArea.style.display = 'block';
    _loadCommands();
  } else {
    logArea.style.display = 'block';
    cmdArea.style.display = 'none';
    _fillLogArea(name);
  }
}

// ── command palette ───────────────────────────────────────────────────────────

async function _loadCommands() {
  const list = _panel?.querySelector('#cmd-list');
  if (!list || list.dataset.loaded) return;
  try {
    const data = await api.get('/health/console/commands');
    list.innerHTML = '';
    for (const cmd of data.commands || []) {
      const item = document.createElement('div');
      item.className = 'cmd-item';
      const result = document.createElement('div');
      result.className = 'cmd-result';
      item.innerHTML = `<span class="cmd-label">${_esc(cmd.label)}</span><span style="color:#8b949e;font-size:0.75rem;">▶ Run</span>`;
      item.appendChild(result);
      item.addEventListener('click', async () => {
        result.textContent = 'Running…';
        result.className = 'cmd-result visible';
        try {
          const res = await api.post(`/health/console/run/${cmd.id}`, {});
          result.textContent = res.message || (res.success ? 'Done.' : 'Failed.');
          result.className = `cmd-result visible ${res.success ? 'ok' : 'err'}`;
        } catch (err) {
          result.textContent = err.message || 'Error';
          result.className = 'cmd-result visible err';
        }
      });
      list.appendChild(item);
    }
    list.dataset.loaded = '1';
  } catch (err) {
    list.textContent = 'Could not load commands: ' + (err.message || err);
  }
}

// ── open / close ─────────────────────────────────────────────────────────────

function _openPanel() {
  if (!_panel) {
    _panel = _buildPanel();
    document.body.appendChild(_panel);
    // Start streams
    _startStream('applog', '/api/health/logs/app');
    _startStream('radius', '/api/health/logs/stream?file=radius.log');
    // Render first tab
    _fillLogArea('applog');
  }
  requestAnimationFrame(() => _panel.classList.add('open'));
}

function _closePanel() {
  if (!_panel) return;
  _panel.classList.remove('open');
}

function _togglePanel() {
  if (!_panel) { _openPanel(); return; }
  if (_panel.classList.contains('open')) _closePanel();
  else _openPanel();
}

// ── fixed trigger button ──────────────────────────────────────────────────────

function _buildTrigger() {
  const btn = document.createElement('button');
  btn.id = 'mr-console-trigger';
  btn.title = 'Server Console (` or \')';
  btn.setAttribute('aria-label', 'Open Server Console');
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
  btn.style.cssText = [
    'position:fixed',
    // sit just above the persistent status strip so they never overlap
    'bottom:calc(var(--statusbar-height, 30px) + 10px)',
    'right:14px',
    'z-index:7999',
    'width:32px',
    'height:32px',
    'border-radius:var(--mr-radius, 3px)',
    'border:1px solid var(--mr-frame, #274A4F)',
    'background:var(--mr-surface-raised, #13262A)',
    'color:var(--mr-text-muted, #78908F)',
    'cursor:pointer',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'transition:color 0.15s,border-color 0.15s,background 0.15s',
    'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
  ].join(';');
  btn.addEventListener('mouseenter', () => {
    btn.style.color = 'var(--mr-action, #23CFDD)';
    btn.style.borderColor = 'var(--mr-action, #23CFDD)';
    btn.style.background = 'var(--mr-surface, #0E1A1C)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.color = 'var(--mr-text-muted, #78908F)';
    btn.style.borderColor = 'var(--mr-frame, #274A4F)';
    btn.style.background = 'var(--mr-surface-raised, #13262A)';
  });
  btn.addEventListener('click', _togglePanel);
  document.body.appendChild(btn);
}

// ── keyboard shortcut ─────────────────────────────────────────────────────────

export function initConsole() {
  const role = localStorage.getItem('mr_role') || '';
  if (role !== 'superadmin' && role !== 'admin') return;

  _buildTrigger();

  document.addEventListener('keydown', (e) => {
    // Backtick ` or single-quote ' (fallback for layouts where ` is a dead key)
    if (e.key !== '`' && e.key !== "'") return;
    const tag = document.activeElement?.tagName ?? '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (document.activeElement?.isContentEditable) return;
    e.preventDefault();
    _togglePanel();
  });
}
