import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { emptyStateHTML, skeletonBlock } from '/js/utils/empty.js';

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(
    /"/g,
    '&quot;',
  );
}

const STYLE = `
  <style>
    @import '/css/theme.css';
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      padding: 1.75rem 2rem 0;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
      flex-shrink: 0;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .page-title { font-size: 1.125rem; font-weight: 600; color: var(--color-text); letter-spacing: -0.01em; }
    .page-sub   { font-size: 0.78rem; color: var(--color-muted); margin-top: 0.15rem; }

    .log-card {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      min-height: 0;
    }

    /* ── Tabs ── */
    .log-tabs {
      display: flex;
      border-bottom: 1px solid var(--color-border);
      overflow-x: auto;
      flex-shrink: 0;
      background: var(--color-surface);
    }
    .log-tab-btn {
      padding: 0.55rem 1rem;
      font-size: 0.8rem;
      font-family: var(--mr-font-data, 'IBM Plex Mono', monospace);
      color: var(--color-muted);
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      white-space: nowrap;
      transition: color 0.12s, border-color 0.12s;
    }
    .log-tab-btn:hover  { color: var(--color-text); }
    .log-tab-btn.active { color: var(--color-accent); border-bottom-color: var(--color-accent); }

    /* ── Toolbar ── */
    .log-toolbar {
      display: flex;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
      align-items: center;
      flex-wrap: wrap;
    }
    .log-search {
      flex: 1;
      min-width: 180px;
      padding: 0.3rem 0.65rem;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 0.8rem;
      font-family: var(--mr-font-data, 'IBM Plex Mono', monospace);
    }
    .log-search:focus {
      outline: none;
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px var(--mr-action-tint);
    }

    .btn {
      padding: 0.3rem 0.75rem;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: transparent;
      color: var(--color-muted);
      font-size: 0.8rem;
      font-family: var(--font);
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      transition: color 0.12s, background 0.12s;
    }
    .btn:hover { color: var(--color-text); }
    .btn.active {
      background: var(--mr-action-tint, rgba(79,168,255,0.12));
      color: var(--color-accent);
      border-color: var(--color-accent);
    }

    .match-count { font-size: 0.75rem; color: var(--color-muted); margin-left: auto; font-family: var(--mr-font-data, monospace); }

    /* ── Log output ── */
    .log-output {
      flex: 1;
      overflow-y: auto;
      padding: 0.75rem 1rem;
      font-family: var(--mr-font-data, 'IBM Plex Mono', monospace);
      font-size: 0.78rem;
      line-height: 1.65;
      min-height: 0;
    }
    .log-line { white-space: pre-wrap; word-break: break-all; padding: 0.02rem 0; }
    .log-line.hidden { display: none !important; }
    .log-error   { color: var(--mr-reject,   #FF6B5B); }
    .log-warning { color: var(--mr-warning,  #F5A623); }
    .log-debug   { color: var(--mr-action,   #4FA8FF); }
    .log-info    { color: var(--color-text); }

    .placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--color-muted);
      font-size: 0.875rem;
      flex-direction: column;
      gap: 0.4rem;
    }
  </style>
`;

class RadiusLogsView extends HTMLElement {
  constructor() {
    super();
    this._logFiles = [];
    this._currentFile = null;
    this._allLines = [];
    this._autoScroll = true;
    this._isLive = false;
    this._streamAbort = null;
  }

  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = STYLE + `
      <div class="page-header">
        <div>
          <div class="page-title">RADIUS Logs</div>
          <div class="page-sub">Live and historical log output from configured FreeRADIUS log files</div>
        </div>
      </div>

      <div class="log-card">
        <div class="log-tabs" id="log-tabs"></div>
        <div class="log-toolbar">
          <input type="search" class="log-search" id="log-search" placeholder="Filter lines…" />
          <button class="btn" id="btn-refresh" title="Reload last 1000 lines">↻ Reload</button>
          <button class="btn" id="btn-live" title="Stream new lines in real time">
            <span id="live-dot" style="width:7px;height:7px;border-radius:50%;background:var(--color-muted);display:inline-block;transition:background 0.2s;"></span>
            Live
          </button>
          <button class="btn" id="btn-clear" title="Clear display (does not delete the file)">Clear</button>
          <span class="match-count" id="match-count"></span>
        </div>
        <div class="log-output" id="log-output"></div>
      </div>
    `;

    this._bindEvents();
    this._loadFiles();
  }

  disconnectedCallback() {
    this._stopStream();
  }

  _$(id) {
    return this.shadowRoot.getElementById(id);
  }

  _bindEvents() {
    this._$('log-search').addEventListener('input', (e) => this._applyFilter(e.target.value));
    this._$('btn-refresh').addEventListener('click', () => {
      this._pauseStream();
      if (this._currentFile) this._switchTab(this._currentFile);
    });
    this._$('btn-live').addEventListener('click', () => {
      this._isLive ? this._pauseStream() : this._resumeStream();
    });
    this._$('btn-clear').addEventListener('click', () => {
      this._allLines = [];
      this._$('log-output').innerHTML = '';
      this._$('match-count').textContent = '';
    });

    const out = this._$('log-output');
    out.addEventListener('scroll', () => {
      this._autoScroll = out.scrollTop + out.clientHeight >= out.scrollHeight - 40;
    });
  }

  async _loadFiles() {
    this._$('log-output').innerHTML = skeletonBlock(this.shadowRoot, 8);
    try {
      this._logFiles = await api.get('/health/logs/files');
    } catch {
      this._logFiles = [];
    }
    this._renderTabs();
    if (this._logFiles.length > 0) {
      await this._switchTab(this._logFiles[0].name);
    } else {
      this._$('log-output').innerHTML = emptyStateHTML({
        title: 'No log files configured',
        message:
          'Set MONSTEROPS_RADIUS_LOG_FILES in your environment to stream FreeRADIUS log files here.',
      });
    }
  }

  _renderTabs() {
    const tabsEl = this._$('log-tabs');
    tabsEl.innerHTML = this._logFiles.map((f) =>
      `<button class="log-tab-btn${f.name === this._currentFile ? ' active' : ''}" data-file="${
        escHtml(f.name)
      }">${escHtml(f.name)}</button>`
    ).join('');
    tabsEl.querySelectorAll('.log-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._pauseStream();
        this._switchTab(btn.dataset.file);
      });
    });
  }

  async _switchTab(filename) {
    this._currentFile = filename;
    this._allLines = [];
    this._renderTabs();
    const out = this._$('log-output');
    out.innerHTML = skeletonBlock(this.shadowRoot, 8);
    try {
      const data = await api.get(
        `/health/logs/tail?file=${encodeURIComponent(filename)}&lines=1000`,
      );
      this._allLines = (data.lines ?? []).map((t) => ({ text: t, cls: this._lineCls(t) }));
      this._renderAll();
    } catch (e) {
      out.innerHTML = emptyStateHTML({
        title: 'Couldn’t load log',
        message: e.message || 'Something went wrong reading this log file.',
      });
    }
  }

  _renderAll() {
    const search = (this._$('log-search').value || '').toLowerCase();
    const out = this._$('log-output');
    out.innerHTML = this._allLines.map((l) => {
      const hide = search && !l.text.toLowerCase().includes(search) ? ' hidden' : '';
      return `<div class="log-line ${l.cls}${hide}">${escHtml(l.text)}</div>`;
    }).join('');
    this._updateMatchCount(search);
    if (this._autoScroll) out.scrollTop = out.scrollHeight;
  }

  _appendLine(text) {
    const out = this._$('log-output');
    const search = (this._$('log-search').value || '').toLowerCase();
    const cls = this._lineCls(text);
    this._allLines.push({ text, cls });
    if (this._allLines.length > 5000) this._allLines.shift();

    const div = document.createElement('div');
    div.className = `log-line ${cls}${
      search && !text.toLowerCase().includes(search) ? ' hidden' : ''
    }`;
    div.textContent = text;
    out.appendChild(div);
    while (out.childElementCount > 5000) out.firstChild?.remove();
    if (this._autoScroll) out.scrollTop = out.scrollHeight;
    this._updateMatchCount(search);
  }

  _applyFilter(search) {
    const lc = search.toLowerCase();
    this.shadowRoot.querySelectorAll('#log-output .log-line').forEach((div) => {
      div.classList.toggle('hidden', !!lc && !div.textContent.toLowerCase().includes(lc));
    });
    this._updateMatchCount(lc);
  }

  _updateMatchCount(search) {
    if (!search) {
      this._$('match-count').textContent = '';
      return;
    }
    const matched = this._allLines.filter((l) => l.text.toLowerCase().includes(search)).length;
    this._$('match-count').textContent = `${matched} / ${this._allLines.length} lines`;
  }

  _lineCls(line) {
    if (/\berror\b/i.test(line)) return 'log-error';
    if (/\b(warning|warn)\b/i.test(line)) return 'log-warning';
    if (/\bdebug\b/i.test(line)) return 'log-debug';
    return 'log-info';
  }

  _resumeStream() {
    if (!this._currentFile) return;
    this._isLive = true;
    const btn = this._$('btn-live');
    const dot = this._$('live-dot');
    btn.classList.add('active');
    if (dot) dot.style.background = 'var(--mr-accept, #4ADE9A)';
    this._startStream(this._currentFile);
  }

  _pauseStream() {
    this._isLive = false;
    const btn = this._$('btn-live');
    const dot = this._$('live-dot');
    if (btn) btn.classList.remove('active');
    if (dot) dot.style.background = 'var(--color-muted)';
    this._stopStream();
  }

  _stopStream() {
    this._streamAbort?.abort();
    this._streamAbort = null;
  }

  async _startStream(filename) {
    this._stopStream();
    const abort = new AbortController();
    this._streamAbort = abort;

    try {
      const res = await fetch(
        `/api/health/logs/stream?file=${encodeURIComponent(filename)}`,
        { credentials: 'same-origin', signal: abort.signal },
      );
      if (!res.ok) {
        this._pauseStream();
        toast(`Stream error: ${res.status}`, 'error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const obj = JSON.parse(trimmed.slice(6));
              if (typeof obj.line === 'string') this._appendLine(obj.line);
            } catch { /* malformed JSON — skip */ }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') this._pauseStream();
    }
  }
}

customElements.define('radius-logs-view', RadiusLogsView);

// Phase 26.2 — RADIUS Logs now lives as a tab in the unified /logs workspace
// (defined by the auth_logs module). Redirect the old route so bookmarks work.
router.register('/radius-logs', () => {
  queueMicrotask(() => router.navigate('/logs?tab=radius'));
  const d = document.createElement('div');
  d.style.cssText =
    'padding:2rem;color:var(--mr-text-muted);font-family:var(--mr-font-data);font-size:0.72rem;letter-spacing:0.08em;';
  d.textContent = 'REDIRECTING…';
  return d;
});
