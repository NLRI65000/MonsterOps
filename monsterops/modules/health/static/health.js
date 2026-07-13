import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { startPolling } from '/js/utils/poll.js';

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STYLE = `
@import '/css/theme.css';

:host { display: block; height: 100%; overflow-y: auto; }

.page-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 1.5rem;
}
.page-title { font-size: 1.25rem; font-weight: 600; }

/* Status cards */
.status-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem; margin-bottom: 1.5rem;
}
.status-card {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius); padding: 1.25rem;
}
.status-card-title {
  font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--color-muted); margin-bottom: 0.75rem;
}
.status-indicator { display: flex; align-items: center; gap: 0.5rem; font-size: 1rem; font-weight: 600; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.dot-active  { background: var(--color-success); box-shadow: 0 0 6px var(--color-success); }
.dot-warning { background: var(--color-warning); box-shadow: 0 0 6px var(--color-warning); }
.dot-danger  { background: var(--color-danger);  box-shadow: 0 0 6px var(--color-danger); }
.dot-unknown { background: var(--color-muted); }
.status-sub { font-size: 0.8rem; color: var(--color-muted); margin-top: 0.35rem; }

/* Section cards */
.section-card {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius); margin-bottom: 1.5rem; overflow: hidden;
}
.section-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.9rem 1.25rem; border-bottom: 1px solid var(--color-border);
  font-size: 0.85rem; font-weight: 600; color: var(--color-text);
}
.section-body { padding: 1.25rem; }

/* Service controls */
.svc-controls { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.action-msg { font-size: 0.82rem; margin-top: 0.75rem; }
.action-msg.ok  { color: var(--color-success); }
.action-msg.err { color: var(--color-danger); }

/* Log viewer */
.log-tabs { display: flex; border-bottom: 1px solid var(--color-border); overflow-x: auto; flex-shrink: 0; }
.log-tab-btn {
  padding: 0.55rem 1rem; border: none; background: transparent; color: var(--color-muted);
  cursor: pointer; font-size: 0.82rem; font-weight: 500; font-family: var(--font);
  border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap;
  flex-shrink: 0; transition: color 0.15s, border-color 0.15s;
}
.log-tab-btn:hover  { color: var(--color-text); }
.log-tab-btn.active { color: var(--color-accent); border-bottom-color: var(--color-accent); }

.log-toolbar {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--color-border); flex-wrap: wrap;
}
.log-search { flex: 1; min-width: 140px; }

.log-output {
  height: 520px; overflow-y: auto; padding: 0.65rem 1rem;
  font-family: 'Courier New', 'Consolas', monospace; font-size: 0.76rem; line-height: 1.55;
  background: #0a0c14;
}

.log-line { white-space: pre-wrap; word-break: break-all; padding: 0.02rem 0; }
.log-line.hidden { display: none !important; }
.log-error   { color: #f87171; }
.log-warning { color: #fbbf24; }
.log-debug   { color: #60a5fa; }
.log-info    { color: #cbd5e1; }

/* Live button */
.btn-live {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.35rem 0.75rem; border-radius: var(--radius);
  border: 1px solid var(--color-border); background: transparent;
  color: var(--color-muted); cursor: pointer; font-size: 0.78rem;
  font-family: var(--font); transition: all 0.15s; white-space: nowrap;
}
.btn-live:hover { color: var(--color-text); border-color: var(--color-muted); }
.btn-live.active {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success); border-color: var(--color-success);
}
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.btn-live.active .live-dot { animation: blink 1.2s ease-in-out infinite; }
@keyframes blink { 0%,100%{ opacity:1; } 50%{ opacity:0.25; } }

.hidden { display: none !important; }
`;

const TEMPLATE = `
<div style="padding:2rem;height:100%;box-sizing:border-box;">

  <div class="page-header">
    <h1 class="page-title">Health &amp; Operations</h1>
    <button class="btn btn-ghost" id="btn-refresh">↻ Refresh</button>
  </div>

  <!-- Status cards -->
  <div class="status-grid">
    <div class="status-card">
      <div class="status-card-title">FreeRADIUS Service</div>
      <div class="status-indicator">
        <span class="dot dot-unknown" id="svc-dot"></span>
        <span id="svc-state">Loading…</span>
      </div>
      <div class="status-sub" id="svc-sub"></div>
    </div>
    <div class="status-card">
      <div class="status-card-title">Database Connection</div>
      <div class="status-indicator">
        <span class="dot dot-unknown" id="db-dot"></span>
        <span id="db-state">Loading…</span>
      </div>
      <div class="status-sub" id="db-sub"></div>
    </div>
  </div>

  <!-- Service controls (admin/superadmin only) -->
  <div class="section-card" id="svc-controls-card">
    <div class="section-header">Service Controls</div>
    <div class="section-body">
      <div class="svc-controls">
        <button class="btn btn-primary" id="btn-reload">⟳ Reload Config</button>
        <button class="btn btn-ghost"   id="btn-restart">↺ Restart</button>
        <button class="btn btn-ghost"   id="btn-start">▶ Start</button>
        <button class="btn btn-ghost btn-danger-ghost" id="btn-stop">⏹ Stop</button>
        <button class="btn btn-ghost" id="btn-validate" title="Syntax-check the configuration without restarting">✔ Validate Config</button>
      </div>
      <div class="action-msg hidden" id="action-msg"></div>
      <details id="validate-details" style="display:none;margin-top:0.75rem;">
        <summary style="cursor:pointer;font-size:0.82rem;color:var(--color-muted);">Validation output</summary>
        <pre id="validate-output" style="margin:0.5rem 0 0;padding:0.65rem;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);font-size:0.75rem;overflow-x:auto;white-space:pre-wrap;"></pre>
      </details>
    </div>
  </div>

  <!-- Log viewer -->
  <div class="section-card">
    <div class="section-header">
      <span>Log Viewer</span>
      <span id="log-file-label" style="font-weight:400;color:var(--color-muted);font-size:0.78rem;"></span>
    </div>
    <div class="log-tabs" id="log-tabs"></div>
    <div class="log-toolbar">
      <input type="search" class="input log-search" id="log-search" placeholder="Filter lines…">
      <button class="btn-live" id="btn-live"><span class="live-dot"></span> Live</button>
      <button class="btn btn-ghost" id="btn-bottom" title="Scroll to bottom">⬇</button>
      <button class="btn btn-ghost" id="btn-clear" title="Clear viewer">✕ Clear</button>
    </div>
    <div class="log-output" id="log-output">
      <span style="color:var(--color-muted)">Loading log files…</span>
    </div>
  </div>

</div>
`;

class HealthView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._logFiles    = [];
    this._currentFile = null;
    this._allLines    = [];   // [{text, cls}]
    this._isLive      = false;
    this._autoScroll  = true;
    this._streamAbort = null;
    this._stopPoll    = null;
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
    this._$ = id => this.shadowRoot.getElementById(id);
    this._init();
  }

  disconnectedCallback() {
    this._stopStream();
    if (this._stopPoll) this._stopPoll();
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  async _init() {
    this._bindControls();
    await Promise.all([this._loadStatus(), this._loadLogFiles()]);
    this._stopPoll = startPolling(() => this._loadStatus(), 10_000);
  }

  _bindControls() {
    const role = localStorage.getItem('mr_role') || '';
    if (role === 'readonly') {
      this._$('svc-controls-card').classList.add('hidden');
    }

    this._$('btn-refresh').addEventListener('click', () => this._loadStatus());

    for (const action of ['reload', 'restart', 'start', 'stop']) {
      const btn = this._$(`btn-${action}`);
      if (btn) btn.addEventListener('click', () => this._doAction(action));
    }

    this._$('btn-validate')?.addEventListener('click', () => this._validateConfig());

    this._$('log-search').addEventListener('input', e => this._applyFilter(e.target.value));

    this._$('btn-live').addEventListener('click', () => {
      if (this._isLive) this._pauseStream(); else this._resumeStream();
    });

    this._$('btn-bottom').addEventListener('click', () => {
      const box = this._$('log-output');
      box.scrollTop = box.scrollHeight;
      this._autoScroll = true;
    });

    this._$('btn-clear').addEventListener('click', () => {
      this._allLines = [];
      this._$('log-output').innerHTML = '';
    });

    this._$('log-output').addEventListener('scroll', () => {
      const box = this._$('log-output');
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      this._autoScroll = atBottom;
    });
  }

  // ── Status cards ──────────────────────────────────────────────────────────

  async _loadStatus() {
    try {
      const status = await api.get('/health/status');
      this._renderSvcStatus(status.freeradius);
      this._renderDbStatus(status.database);
    } catch (err) {
      console.error('Health status error:', err);
    }
  }

  _renderSvcStatus(svc) {
    this._$('svc-dot').className = 'dot ' + this._dotCls(svc.active_state);
    this._$('svc-state').textContent = svc.active_state;
    const sub = svc.sub_state + (svc.load_state !== 'loaded' ? ` · ${svc.load_state}` : '');
    this._$('svc-sub').textContent = sub;
  }

  _renderDbStatus(db) {
    this._$('db-dot').className = 'dot ' + (db.ok ? 'dot-active' : 'dot-danger');
    this._$('db-state').textContent = db.ok ? 'Connected' : 'Unreachable';
    this._$('db-sub').textContent = db.latency_ms != null ? `${db.latency_ms} ms` : '';
  }

  _dotCls(state) {
    if (state === 'active')   return 'dot-active';
    if (state === 'failed')   return 'dot-danger';
    if (state === 'inactive') return 'dot-warning';
    return 'dot-unknown';
  }

  // ── Service actions ────────────────────────────────────────────────────────

  async _doAction(action) {
    const msgEl = this._$('action-msg');
    msgEl.className = 'action-msg';
    msgEl.textContent = `Running ${action}…`;
    msgEl.classList.remove('hidden');
    // disable all action buttons during the request
    const btns = ['reload','restart','start','stop'].map(a => this._$(`btn-${a}`)).filter(Boolean);
    btns.forEach(b => b.disabled = true);

    try {
      const res = await api.post(`/health/service/${encodeURIComponent(action)}`);
      msgEl.classList.add(res.success ? 'ok' : 'err');
      msgEl.textContent = res.output || (res.success ? `${action} completed` : `${action} failed`);
      if (res.success) toast(`FreeRADIUS ${action} successful`, 'success');
      await this._loadStatus();
    } catch (err) {
      msgEl.classList.add('err');
      msgEl.textContent = `Failed: ${err.message}`;
      toast(`${action} failed: ${err.message}`, 'error');
    } finally {
      btns.forEach(b => b.disabled = false);
    }
  }

  async _validateConfig() {
    const btn = this._$('btn-validate');
    const details = this._$('validate-details');
    const output  = this._$('validate-output');
    btn.disabled = true;
    btn.textContent = '⏳ Validating…';
    details.style.display = 'none';
    try {
      const res = await api.post('/health/validate-config');
      output.textContent = res.output || (res.ok ? 'Configuration OK' : 'Validation failed (no output)');
      output.style.color = res.ok ? 'var(--color-success)' : 'var(--color-danger)';
      details.style.display = '';
      details.open = true;
      if (res.ok) toast('Config validation passed', 'success');
      else toast('Config validation failed — see output below', 'error');
    } catch (e) {
      toast(`Validation error: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✔ Validate Config';
    }
  }

  // ── Log tabs ──────────────────────────────────────────────────────────────

  async _loadLogFiles() {
    try {
      this._logFiles = await api.get('/health/logs/files');
    } catch {
      this._logFiles = [];
    }
    this._renderTabs();
    if (this._logFiles.length > 0) {
      await this._switchTab(this._logFiles[0].name);
    } else {
      this._$('log-output').innerHTML =
        '<span style="color:var(--color-muted)">No log files configured. Set MONSTEROPS_RADIUS_LOG_FILES in your environment.</span>';
    }
  }

  _renderTabs() {
    const tabsEl = this._$('log-tabs');
    tabsEl.innerHTML = this._logFiles.map(f =>
      `<button class="log-tab-btn${f.name === this._currentFile ? ' active' : ''}" data-file="${escHtml(f.name)}">
        ${escHtml(f.name)}${!f.exists ? ' ⚠' : ''}
      </button>`
    ).join('');
    tabsEl.querySelectorAll('.log-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => this._switchTab(btn.dataset.file));
    });
  }

  async _switchTab(filename) {
    if (filename === this._currentFile) return;
    const wasLive = this._isLive;
    if (wasLive) this._pauseStream();

    this._currentFile = filename;
    this._allLines = [];
    this._renderTabs();
    const label = this._$('log-file-label');
    if (label) label.textContent = filename;

    await this._loadTail(filename);
    if (wasLive) this._resumeStream();
  }

  // ── Log content ───────────────────────────────────────────────────────────

  async _loadTail(filename) {
    const out = this._$('log-output');
    out.innerHTML = '<span style="color:var(--color-muted)">Loading…</span>';
    try {
      const data = await api.get(`/health/logs/tail?file=${encodeURIComponent(filename)}&lines=500`);
      this._allLines = data.lines.map(t => ({ text: t, cls: this._lineCls(t) }));
      this._renderAll();
      out.scrollTop = out.scrollHeight;
      this._autoScroll = true;
    } catch (err) {
      out.innerHTML = `<span style="color:var(--color-danger)">Failed: ${escHtml(err.message)}</span>`;
    }
  }

  _renderAll() {
    const search = (this._$('log-search').value || '').toLowerCase();
    const out = this._$('log-output');
    out.innerHTML = this._allLines.map(l => {
      const hide = search && !l.text.toLowerCase().includes(search) ? ' hidden' : '';
      return `<div class="log-line ${l.cls}${hide}">${escHtml(l.text)}</div>`;
    }).join('');
  }

  _appendLine(text) {
    const out = this._$('log-output');
    const search = (this._$('log-search').value || '').toLowerCase();
    const cls = this._lineCls(text);

    this._allLines.push({ text, cls });
    if (this._allLines.length > 5000) this._allLines.shift();

    const div = document.createElement('div');
    div.className = `log-line ${cls}${search && !text.toLowerCase().includes(search) ? ' hidden' : ''}`;
    div.textContent = text;
    out.appendChild(div);

    // Prune DOM nodes to stay in sync with buffer cap
    while (out.childElementCount > 5000) out.firstChild?.remove();

    if (this._autoScroll) out.scrollTop = out.scrollHeight;
  }

  _applyFilter(search) {
    const lc = search.toLowerCase();
    this.shadowRoot.querySelectorAll('#log-output .log-line').forEach(div => {
      const match = !lc || div.textContent.toLowerCase().includes(lc);
      div.classList.toggle('hidden', !match);
    });
  }

  _lineCls(line) {
    if (/\berror\b/i.test(line))         return 'log-error';
    if (/\b(warning|warn)\b/i.test(line)) return 'log-warning';
    if (/\bdebug\b/i.test(line))          return 'log-debug';
    return 'log-info';
  }

  // ── SSE streaming ─────────────────────────────────────────────────────────

  _resumeStream() {
    if (!this._currentFile) return;
    this._isLive = true;
    const btn = this._$('btn-live');
    btn.classList.add('active');
    this._startStream(this._currentFile);
  }

  _pauseStream() {
    this._isLive = false;
    const btn = this._$('btn-live');
    if (btn) btn.classList.remove('active');
    this._stopStream();
  }

  _stopStream() {
    if (this._streamAbort) {
      this._streamAbort.abort();
      this._streamAbort = null;
    }
  }

  async _startStream(filename) {
    this._stopStream();
    const abort = new AbortController();
    this._streamAbort = abort;

    try {
      const res = await fetch(
        `/api/health/logs/stream?file=${encodeURIComponent(filename)}`,
        { credentials: 'same-origin', signal: abort.signal }
      );

      if (!res.ok) {
        this._pauseStream();
        toast(`Log stream error: ${res.status}`, 'error');
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
      if (err.name !== 'AbortError') {
        console.error('Log stream error:', err);
        this._pauseStream();
      }
    }
  }
}

customElements.define('health-view', HealthView);
router.register('/health', () => document.createElement('health-view'));
