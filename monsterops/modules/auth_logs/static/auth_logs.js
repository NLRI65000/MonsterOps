import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { densityBarHTML, wireDensityBar, applyDensity, makeSortable } from '/js/utils/table.js';
import { emptyStateHTML, skeletonRows } from '/js/utils/empty.js';
import { geoLabelHTML } from '/js/utils/geo.js';

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

function _geoCell(geo, ip) {
  const ipSpan = `<span class="mono muted">${_esc(ip || '—')}</span>`;
  if (!geo) return ipSpan;
  return `${ipSpan}<div style="font-size:0.72rem;color:var(--color-muted);margin-top:1px">${geoLabelHTML(geo)}</div>`;
}

const STYLE = `
  <style>
    @import '/css/theme.css';
    :host { display: block; padding: 1.5rem; }
    .page-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.5rem; color: var(--color-text); }
    .section-title { font-size: 0.9rem; font-weight: 600; margin: 1.5rem 0 0.75rem; color: var(--color-text); }
    .filter-row { display: flex; gap: 0.5rem; margin-bottom: 1rem; align-items: center; flex-wrap: wrap; }
    .input { padding: 0.4rem 0.65rem; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface); color: var(--color-text); font-size: 0.85rem; font-family: var(--font); }
    .btn { padding: 0.4rem 0.85rem; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface); color: var(--color-text); font-size: 0.82rem; font-family: var(--font); cursor: pointer; }
    .btn:hover { background: var(--color-bg); }
    .btn-primary { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
    .btn-primary:hover { opacity: 0.88; background: var(--color-accent); }
    .btn-export { border-color: var(--color-accent); color: var(--color-accent); }
    .btn-export:hover { background: var(--mr-action-tint); }
    .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 0.45rem 0.75rem; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted); border-bottom: 1px solid var(--color-border); background: var(--color-bg); }
    td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: top; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    tr:last-child td { border-bottom: none; }
    tbody tr { cursor: pointer; }
    tbody tr:hover td { background: color-mix(in srgb, var(--color-accent) 6%, transparent); }
    .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
    .badge-success { background: var(--mr-accept-tint); color: var(--mr-accept); }
    .badge-danger  { background: var(--mr-reject-tint); color: var(--mr-reject); }
    .badge-info    { background: var(--mr-action-tint); color: var(--mr-action); }
    .muted { color: var(--color-muted); font-size: 0.78rem; }
    .mono { font-family: var(--mr-font-data); font-size: 0.82rem; }
    .click-hint { font-size: 0.72rem; color: var(--color-muted); margin-bottom: 0.4rem; }

    /* Alert banner */
    .alert-banner { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.75rem 1rem; background: color-mix(in srgb, var(--color-danger) 12%, transparent); border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent); border-radius: var(--radius); margin-bottom: 1rem; }
    .alert-banner.hidden { display: none; }
    .alert-icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 0.05rem; }
    .alert-body { flex: 1; }
    .alert-title { font-size: 0.85rem; font-weight: 600; color: var(--color-danger); margin-bottom: 0.3rem; }
    .alert-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .alert-list li { font-size: 0.78rem; background: color-mix(in srgb, var(--color-danger) 10%, transparent); border: 1px solid color-mix(in srgb, var(--color-danger) 20%, transparent); border-radius: 9999px; padding: 0.1rem 0.55rem; color: var(--color-text); }
    .alert-list li strong { color: var(--color-danger); }

    /* Timeline chart */
    .chart-wrap { padding: 1rem; }
    canvas { display: block; width: 100%; }
    .chart-legend { display: flex; gap: 1.25rem; justify-content: center; margin-top: 0.5rem; }
    .legend-item { display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: var(--color-muted); }
    .legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }

    /* ── Detail modal ── */
    .detail-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      z-index: 500;
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
      padding: 1rem;
    }
    .detail-panel {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      width: min(560px, 100%);
      max-height: calc(100dvh - 2rem);
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5);
      animation: slide-in-right 0.2s ease;
    }
    @keyframes slide-in-right {
      from { opacity: 0; transform: translateX(24px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .detail-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--color-border);
      flex-shrink: 0;
    }
    .detail-title { font-size: 0.95rem; font-weight: 600; color: var(--color-text); }
    .detail-close {
      background: transparent;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      font-size: 1.2rem;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      line-height: 1;
    }
    .detail-close:hover { background: var(--color-bg); color: var(--color-text); }
    .detail-body { overflow-y: auto; flex: 1; padding: 1.25rem; }
    .detail-section { margin-bottom: 1.25rem; }
    .detail-section:last-child { margin-bottom: 0; }
    .detail-section-title {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-muted);
      margin-bottom: 0.6rem;
    }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .detail-field { display: flex; flex-direction: column; gap: 0.2rem; }
    .detail-label { font-size: 0.7rem; color: var(--color-muted); }
    .detail-value { font-size: 0.82rem; color: var(--color-text); word-break: break-all; }
    .detail-value.mono { font-family: monospace; }
    .detail-value.full { grid-column: 1 / -1; }
    .reason-block {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      font-family: monospace;
      font-size: 0.8rem;
      color: var(--color-danger);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
    }
    .reason-block.success { color: var(--color-success); }
    .log-block {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      font-family: monospace;
      font-size: 0.75rem;
      color: var(--color-text);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
      max-height: 280px;
      overflow-y: auto;
    }
    .log-block .log-match { color: var(--color-warning); }
    .log-file-label {
      font-size: 0.72rem;
      color: var(--color-muted);
      font-family: monospace;
      margin-bottom: 0.35rem;
    }
    .log-error { color: var(--color-danger); font-size: 0.8rem; font-style: italic; }
    #btn-load-log { width: 100%; margin-top: 0; }
    #log-context-body { margin-top: 0.75rem; }
  </style>
`;

class AuthLogsView extends HTMLElement {
  constructor() {
    super();
    this._logs = [];
  }

  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    // Time window passed in from the dashboard "Auth Volume" histogram click.
    const hp = new URLSearchParams(location.hash.split('?')[1] || '');
    this._from = hp.get('from') || '';
    this._to = hp.get('to') || '';
    // Result filter passed in from a dashboard metric drill-through (Logins / Failed).
    this._reply = hp.get('reply') || '';
    const rangeLabel = this._rangeLabel();
    this.shadowRoot.innerHTML = STYLE + `
      <div class="page-title">Authentication Logs</div>

      <div class="alert-banner hidden" id="alert-banner">
        <div class="alert-icon">⚠</div>
        <div class="alert-body">
          <div class="alert-title">Users with excessive failed logins (last 24 h)</div>
          <ul class="alert-list" id="alert-list"></ul>
        </div>
      </div>

      <div class="alert-banner hidden" id="anomaly-banner" style="background:color-mix(in srgb,var(--color-warning,#f59e0b) 10%,transparent);border-color:color-mix(in srgb,var(--color-warning,#f59e0b) 30%,transparent)">
        <div class="alert-icon">&#128269;</div>
        <div class="alert-body">
          <div class="alert-title" style="color:var(--color-warning,#f59e0b)">Anomalies detected (last 24 h)</div>
          <ul class="alert-list" id="anomaly-list"></ul>
        </div>
      </div>

      <div class="filter-row">
        <input class="input" id="inp-user" placeholder="Filter by username…" style="width:180px;" />
        <select class="input" id="sel-reply">
          <option value="">All results</option>
          <option value="Access-Accept">Accept only</option>
          <option value="Access-Reject">Reject only</option>
        </select>
        <button class="btn" id="btn-search">Search</button>
        <button class="btn" id="btn-refresh">↻ Refresh</button>
        <button class="btn btn-export" id="btn-export">⬇ Export CSV</button>
      </div>

      ${rangeLabel ? `<div id="range-chip" style="display:inline-flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;padding:0.22rem 0.55rem;border:1px solid var(--mr-action);border-radius:var(--mr-radius,2px);background:var(--mr-action-tint);color:var(--mr-action);font-family:var(--mr-font-data);font-size:0.66rem;letter-spacing:0.04em;">
        <span>⌖ ${rangeLabel}</span>
        <button id="range-clear" title="Clear time range" style="background:none;border:none;color:inherit;cursor:pointer;font-size:0.85rem;line-height:1;padding:0;">✕</button>
      </div>` : ''}

      ${densityBarHTML()}
      <div class="click-hint">Click any row to see full details</div>
      <div class="card" id="wrap"><div class="state-loading">Loading…</div></div>

      <div class="section-title">Authentication Timeline — Last 24 Hours</div>
      <div class="card chart-wrap">
        <canvas id="timeline-chart" height="160"></canvas>
        <div class="chart-legend">
          <div class="legend-item"><div class="legend-dot" style="background:#22c55e"></div>Accepts</div>
          <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div>Rejects</div>
        </div>
      </div>
    `;

    wireDensityBar(this.shadowRoot, () => this.shadowRoot.querySelector('#wrap table'));
    // Pre-select the result filter when arriving from a dashboard drill-through.
    if (this._reply) {
      const sel = this.shadowRoot.getElementById('sel-reply');
      if (sel) sel.value = this._reply;
    }
    const _hlId = new URLSearchParams(location.search).get('highlight');
    this._load().then(() => {
      if (_hlId) this._showDetail(Number(_hlId));
    });
    this._loadAlerts();
    this._loadAnomalies();
    this._loadTimeline();

    this.shadowRoot.getElementById('range-clear')?.addEventListener('click', () => {
      this._from = ''; this._to = '';
      this.shadowRoot.getElementById('range-chip')?.remove();
      // drop from/to from the URL without re-rendering the whole workspace
      history.replaceState(null, '', '#/logs?tab=auth');
      this._load();
    });

    this.shadowRoot.getElementById('btn-search').addEventListener('click', () => this._load());
    this.shadowRoot.getElementById('btn-refresh').addEventListener('click', () => {
      this._load();
      this._loadAlerts();
      this._loadAnomalies();
      this._loadTimeline();
    });
    this.shadowRoot.getElementById('inp-user').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._load();
    });
    this.shadowRoot.getElementById('btn-export').addEventListener('click', () => this._exportCsv());

    // Row click → detail panel (event delegation)
    this.shadowRoot.getElementById('wrap').addEventListener('click', e => {
      const row = e.target.closest('tr[data-id]');
      if (row) this._showDetail(Number(row.dataset.id));
    });
  }

  _rangeLabel() {
    if (!this._from && !this._to) return '';
    const fmt = (s) => {
      const d = new Date(s);
      return isNaN(d) ? s : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    if (this._from && this._to) return `${fmt(this._from)} → ${fmt(this._to)}`;
    return this._from ? `since ${fmt(this._from)}` : `until ${fmt(this._to)}`;
  }

  // ── Auth log table ───────────────────────────────────────────────────────────

  async _load() {
    const wrap = this.shadowRoot.getElementById('wrap');
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>Time</th><th>User</th><th>Result</th><th>Method</th>
        <th>Failure Reason</th><th>Latency</th><th>Calling Station / Location</th><th>NAS IP</th><th>NAS ID</th>
      </tr></thead>
      <tbody>${skeletonRows(this.shadowRoot, 9, 8)}</tbody>
    </table>`;
    const user = this.shadowRoot.getElementById('inp-user').value.trim();
    const reply = this.shadowRoot.getElementById('sel-reply').value;
    let url = `/auth-logs?limit=200`;
    if (user)  url += `&username=${encodeURIComponent(user)}`;
    if (reply) url += `&reply=${encodeURIComponent(reply)}`;
    if (this._from) url += `&from=${encodeURIComponent(this._from)}`;
    if (this._to)   url += `&to=${encodeURIComponent(this._to)}`;
    try {
      const rows = await api.get(url);
      this._logs = rows;
      if (!rows.length) {
        wrap.innerHTML = emptyStateHTML({
          title: 'No authentication events',
          message: 'Nothing matches the current filters or date range. Try widening them.',
        });
        return;
      }
      wrap.innerHTML = `<table>
        <thead><tr>
          <th>Time</th><th>User</th><th>Result</th><th>Method</th>
          <th>Failure Reason</th><th>Latency</th><th>Calling Station / Location</th><th>NAS IP</th><th>NAS ID</th>
        </tr></thead>
        <tbody>${rows.map(r => this._row(r)).join('')}</tbody>
      </table>`;
      const table = wrap.querySelector('table');
      applyDensity(table);
      makeSortable(table, { default: { col: 0, dir: 'desc' } }); // newest first, like the query
    } catch (e) {
      wrap.innerHTML = `<div class="state-error">Failed to load: ${_esc(e.message)}</div>`;
    }
  }

  _row(r) {
    const accept = r.reply === 'Access-Accept';
    const resultBadge = accept
      ? '<span class="badge badge-success">Accept</span>'
      : `<span class="badge badge-danger">${_esc(r.reply || 'Reject')}</span>`;
    const method = r.authmethod
      ? `<span class="badge badge-info">${_esc(r.authmethod)}</span>`
      : '<span class="muted">—</span>';
    const reason = r.failurereason
      ? `<span class="muted" title="${_esc(r.failurereason)}">${_esc(r.failurereason.slice(0, 40))}${r.failurereason.length > 40 ? '…' : ''}</span>`
      : '<span class="muted">—</span>';
    const latency = r.auth_latency_ms != null
      ? `<span class="mono">${r.auth_latency_ms} ms</span>`
      : '<span class="muted">—</span>';
    const ts = Date.parse(r.authdate) || 0;
    return `<tr data-id="${r.id}">
      <td class="mono muted" style="white-space:nowrap" data-sort="${ts}">${_fmtTime(r.authdate)}</td>
      <td style="font-weight:500">${_esc(r.username)}</td>
      <td>${resultBadge}</td>
      <td>${method}</td>
      <td>${reason}</td>
      <td data-sort="${r.auth_latency_ms != null ? r.auth_latency_ms : -1}">${latency}</td>
      <td style="white-space:nowrap">${_geoCell(r.geo_client, r.callingstationid)}</td>
      <td class="muted mono">${_esc(r.nasipaddress || '—')}</td>
      <td class="muted">${_esc(r.nasidentifier || '—')}</td>
    </tr>`;
  }

  // ── Detail panel ─────────────────────────────────────────────────────────────

  _showDetail(logId) {
    const entry = this._logs.find(r => r.id === logId);
    if (!entry) return;

    // Remove any existing panel
    this.shadowRoot.querySelector('.detail-overlay')?.remove();

    const accept = entry.reply === 'Access-Accept';
    const resultBadge = accept
      ? '<span class="badge badge-success">Access-Accept</span>'
      : `<span class="badge badge-danger">${_esc(entry.reply || 'Reject')}</span>`;

    const overlay = document.createElement('div');
    overlay.className = 'detail-overlay';
    overlay.innerHTML = `
      <div class="detail-panel">
        <div class="detail-header">
          <div>
            <div class="detail-title">Auth Log #${entry.id}</div>
            <div style="margin-top:0.25rem">${resultBadge}${entry.authmethod ? `&nbsp;<span class="badge badge-info">${_esc(entry.authmethod)}</span>` : ''}</div>
          </div>
          <button class="detail-close" id="btn-close" title="Close (Esc)">&#10005;</button>
        </div>
        <div class="detail-body">

          <div class="detail-section">
            <div class="detail-section-title">Event</div>
            <div class="detail-grid">
              <div class="detail-field">
                <div class="detail-label">Time</div>
                <div class="detail-value">${_esc(_fmtTime(entry.authdate))}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">Latency</div>
                <div class="detail-value mono">${entry.auth_latency_ms != null ? entry.auth_latency_ms + ' ms' : '—'}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">Username</div>
                <div class="detail-value mono">${_esc(entry.username)}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">Auth Method</div>
                <div class="detail-value">${_esc(entry.authmethod || '—')}</div>
              </div>
            </div>
          </div>

          ${entry.failurereason ? `
          <div class="detail-section">
            <div class="detail-section-title">Failure Reason</div>
            <div class="reason-block${accept ? ' success' : ''}">${_esc(entry.failurereason)}</div>
          </div>
          ` : ''}

          <div class="detail-section">
            <div class="detail-section-title">Network</div>
            <div class="detail-grid">
              <div class="detail-field">
                <div class="detail-label">Calling Station</div>
                <div class="detail-value mono">${_esc(entry.callingstationid || '—')}${entry.geo_client ? `<div style="font-size:0.75rem;color:var(--color-muted);font-family:inherit">${geoLabelHTML(entry.geo_client)}</div>` : ''}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">Called Station</div>
                <div class="detail-value mono">${_esc(entry.calledstationid || '—')}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">NAS IP</div>
                <div class="detail-value mono">${_esc(entry.nasipaddress || '—')}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">NAS Identifier</div>
                <div class="detail-value">${_esc(entry.nasidentifier || '—')}</div>
              </div>
              ${entry.geo_client?.latitude ? `
              <div class="detail-field">
                <div class="detail-label">Country</div>
                <div class="detail-value">${_esc(entry.geo_client.country || '—')}</div>
              </div>
              <div class="detail-field">
                <div class="detail-label">City</div>
                <div class="detail-value">${_esc(entry.geo_client.city || '—')}</div>
              </div>` : ''}
            </div>
          </div>

          ${entry.linked_session_id ? `
          <div class="detail-section">
            <div class="detail-section-title">Linked Session</div>
            <button class="btn" id="btn-view-session" data-session-id="${entry.linked_session_id}" style="font-size:0.8rem">
              ↗ View Session #${entry.linked_session_id}
            </button>
          </div>` : ''}

          <div class="detail-section">
            <div class="detail-section-title">FreeRADIUS Log Context</div>
            <button class="btn btn-primary" id="btn-load-log">Load log lines for "${_esc(entry.username)}"</button>
            <div id="log-context-body"></div>
          </div>

        </div>
      </div>
    `;

    this.shadowRoot.appendChild(overlay);

    // Close handlers
    const close = () => overlay.remove();
    overlay.querySelector('#btn-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    // View Session cross-link (20.4)
    overlay.querySelector('#btn-view-session')?.addEventListener('click', (e) => {
      const sid = e.currentTarget.dataset.sessionId;
      close();
      router.navigate('/accounting?highlight=' + sid);
    });

    // Load log context
    overlay.querySelector('#btn-load-log').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Loading…';
      const body = overlay.querySelector('#log-context-body');
      try {
        const data = await api.get(`/auth-logs/${entry.id}/freeradius-log`);
        body.innerHTML = this._renderLogContext(data, entry.username);
      } catch (err) {
        body.innerHTML = `<div class="log-error">Failed to load: ${_esc(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = 'Retry';
      }
    });
  }

  _renderLogContext(data, username) {
    if (!data.log_files || data.log_files.length === 0) {
      return '<div class="log-error">No log files configured.</div>';
    }

    return data.log_files.map(f => {
      if (f.error) {
        return `<div class="log-file-label">${_esc(f.file)}</div>
                <div class="log-error">${_esc(f.error)}</div>`;
      }
      if (!f.lines || f.lines.length === 0) {
        return `<div class="log-file-label">${_esc(f.file)}</div>
                <div class="log-error">No matches found for "${_esc(username)}".</div>`;
      }
      const totalNote = f.total_matches > 50
        ? ` <span style="color:var(--color-warning)">(showing last 50 of ${f.total_matches})</span>`
        : '';
      const highlighted = f.lines.map(line => {
        const esc = _esc(line);
        return esc.includes(_esc(username))
          ? `<span class="log-match">${esc}</span>`
          : esc;
      }).join('\n');
      return `<div class="log-file-label">${_esc(f.file)}${totalNote}</div>
              <div class="log-block">${highlighted}</div>`;
    }).join('<div style="height:0.75rem"></div>');
  }

  // ── CSV export ───────────────────────────────────────────────────────────────

  async _exportCsv() {
    const user = this.shadowRoot.getElementById('inp-user').value.trim();
    const reply = this.shadowRoot.getElementById('sel-reply').value;
    let url = `/api/auth-logs/export?limit=10000`;
    if (user)  url += `&username=${encodeURIComponent(user)}`;
    if (reply) url += `&reply=${encodeURIComponent(reply)}`;

    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'auth-logs.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(`Export failed: ${e.message}`, 'error');
    }
  }

  // ── Failed-login alert banner ────────────────────────────────────────────────

  async _loadAlerts() {
    try {
      const data = await api.get('/auth-logs/failed-counts?hours=24&min_count=5');
      const banner = this.shadowRoot.getElementById('alert-banner');
      const list = this.shadowRoot.getElementById('alert-list');
      if (!data.length) { banner.classList.add('hidden'); return; }
      banner.classList.remove('hidden');
      list.innerHTML = data.map(d =>
        `<li>${_esc(d.username)} — <strong>${d.count} failures</strong></li>`
      ).join('');
    } catch (_) { /* non-critical */ }
  }

  // ── Anomaly banner (Phase 20.5) ──────────────────────────────────────────────

  async _loadAnomalies() {
    try {
      const data = await api.get('/auth-logs/anomalies?hours=24');
      const banner = this.shadowRoot.getElementById('anomaly-banner');
      const list = this.shadowRoot.getElementById('anomaly-list');
      const items = [];
      if (data.concurrent_sessions?.length) {
        items.push(...data.concurrent_sessions.map(d =>
          `<li>${_esc(d.username)} — <strong>${d.nas_count} concurrent NAS sessions</strong></li>`
        ));
      }
      if (data.multi_location_users?.length) {
        items.push(...data.multi_location_users.map(d =>
          `<li>${_esc(d.username)} — <strong>${d.nas_count} NAS locations</strong></li>`
        ));
      }
      if (data.off_hours_events?.length) {
        const users = [...new Set(data.off_hours_events.map(e => e.username))].slice(0, 5);
        items.push(`<li>Off-hours logins: <strong>${users.map(_esc).join(', ')}</strong>${data.off_hours_events.length > 5 ? ` +${data.off_hours_events.length - 5} more` : ''}</li>`);
      }
      if (!items.length) { banner.classList.add('hidden'); return; }
      banner.classList.remove('hidden');
      list.innerHTML = items.join('');
    } catch (_) { /* non-critical */ }
  }

  // ── Timeline chart ───────────────────────────────────────────────────────────

  async _loadTimeline() {
    try {
      const data = await api.get('/auth-logs/timeline?hours=24');
      this._renderChart(data);
    } catch (_) {
      const canvas = this.shadowRoot.getElementById('timeline-chart');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'var(--color-muted)';
      ctx.font = '13px sans-serif';
      ctx.fillText('Timeline data unavailable', 16, 80);
    }
  }

  _renderChart(data) {
    const canvas = this.shadowRoot.getElementById('timeline-chart');
    const now = new Date();
    const slots = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now);
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() - i);
      slots.push({ hour: d.toISOString(), accept: 0, reject: 0, label: d.getHours() + ':00' });
    }
    for (const pt of data) {
      const h = new Date(pt.hour);
      h.setMinutes(0, 0, 0);
      const key = h.toISOString();
      const slot = slots.find(s => s.hour.slice(0, 13) === key.slice(0, 13));
      if (slot) { slot.accept = pt.accept_count; slot.reject = pt.reject_count; }
    }

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth - 32;
    const H = 160;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD_L = 42, PAD_R = 8, PAD_T = 12, PAD_B = 28;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const maxVal = Math.max(1, ...slots.map(s => s.accept + s.reject));

    const cs = getComputedStyle(this);
    const colorBorder = cs.getPropertyValue('--color-border').trim() || '#e2e8f0';
    const colorMuted  = cs.getPropertyValue('--color-muted').trim()  || '#94a3b8';

    ctx.strokeStyle = colorBorder;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD_T + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(PAD_L + chartW, y);
      ctx.stroke();
      const val = Math.round(maxVal * (1 - i / 4));
      ctx.fillStyle = colorMuted;
      ctx.font = `10px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(val, PAD_L - 4, y + 3);
    }

    const n = slots.length;
    const barGroupW = chartW / n;
    const barW = Math.max(2, barGroupW * 0.35);

    for (let i = 0; i < n; i++) {
      const s = slots[i];
      const x = PAD_L + i * barGroupW + barGroupW / 2;

      if (s.accept > 0) {
        const bh = (s.accept / maxVal) * chartH;
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(x - barW - 1, PAD_T + chartH - bh, barW, bh);
      }
      if (s.reject > 0) {
        const bh = (s.reject / maxVal) * chartH;
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x + 1, PAD_T + chartH - bh, barW, bh);
      }

      if (i % 3 === 0) {
        ctx.fillStyle = colorMuted;
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.label, x, PAD_T + chartH + 14);
      }
    }

    ctx.strokeStyle = colorBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, PAD_T + chartH);
    ctx.lineTo(PAD_L + chartW, PAD_T + chartH);
    ctx.stroke();
  }
}

customElements.define('auth-logs-view', AuthLogsView);

// ── Phase 26.2 — Unified Logs workspace ─────────────────────────────────────
// Auth Logs and RADIUS Logs live on one page as tabs. Both are self-contained
// custom elements (<auth-logs-view>, <radius-logs-view>), so the workspace just
// mounts the active one. The old /auth-logs and /radius-logs routes redirect
// here so bookmarks keep working.

function _redirect(to) {
  queueMicrotask(() => router.navigate(to));
  const d = document.createElement('div');
  d.style.cssText = 'padding:2rem;color:var(--mr-text-muted);font-family:var(--mr-font-data);font-size:0.72rem;letter-spacing:0.08em;';
  d.textContent = 'REDIRECTING…';
  return d;
}

class LogsWorkspace extends HTMLElement {
  connectedCallback() { this._render(); }

  _activeTab() {
    const q = location.hash.split('?')[1] || '';
    return new URLSearchParams(q).get('tab') === 'radius' ? 'radius' : 'auth';
  }

  _render() {
    const tab = this._activeTab();
    this.innerHTML = `
      <div class="page-header"><span class="page-title">Logs</span></div>
      <div class="tabbar" role="tablist">
        <button class="tab ${tab === 'auth' ? 'active' : ''}" data-tab="auth" role="tab" aria-selected="${tab === 'auth'}">
          <span class="led ${tab === 'auth' ? 'led-on' : 'led-idle'}"></span>Auth Events
        </button>
        <button class="tab ${tab === 'radius' ? 'active' : ''}" data-tab="radius" role="tab" aria-selected="${tab === 'radius'}">
          <span class="led ${tab === 'radius' ? 'led-on' : 'led-idle'}"></span>RADIUS Log
        </button>
      </div>
      <div id="logs-panel"></div>
    `;
    this.querySelectorAll('.tab').forEach((b) =>
      b.addEventListener('click', () => {
        location.hash = b.dataset.tab === 'radius' ? '/logs?tab=radius' : '/logs';
      })
    );
    const panel = this.querySelector('#logs-panel');
    panel.replaceChildren(
      document.createElement(tab === 'radius' ? 'radius-logs-view' : 'auth-logs-view')
    );
  }
}
customElements.define('logs-workspace', LogsWorkspace);

router.register('/logs', () => document.createElement('logs-workspace'));
router.register('/auth-logs', () => _redirect('/logs'));
