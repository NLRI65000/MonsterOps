import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { densityBarHTML, wireDensityBar, applyDensity, makeSortable } from '/js/utils/table.js';
import { emptyStateHTML, skeletonRows } from '/js/utils/empty.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '';
  return [...cc.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))).join('');
}

function _geoLabel(geo) {
  if (!geo) return '';
  const flag = _flagEmoji(geo.country_code);
  const place = geo.city || geo.country || '';
  return flag ? `${flag} ${place}` : place;
}

function fmt(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / 1024 ** i).toFixed(1)} ${u[i]}`;
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

// CoA presets: each returns the attribute dict to send
const COA_PRESETS = [
  { id: '', label: 'Custom attributes' },
  { id: 'mikrotik-rate', label: 'MikroTik — Rate Limit' },
  { id: 'session-timeout', label: 'Session Timeout' },
  { id: 'idle-timeout', label: 'Idle Timeout' },
];

const PRESET_FIELDS = {
  'mikrotik-rate': {
    fields: [{ id: 'pr-rate', label: 'Rate Limit', placeholder: '10M/10M', hint: 'Upload/Download — e.g. 5M/20M' }],
    build: (sr) => ({ 'Mikrotik-Rate-Limit': sr.getElementById('pr-rate').value.trim() }),
  },
  'session-timeout': {
    fields: [{ id: 'pr-timeout', label: 'Seconds', placeholder: '3600', hint: 'Session will end after this many seconds' }],
    build: (sr) => ({ 'Session-Timeout': sr.getElementById('pr-timeout').value.trim() }),
  },
  'idle-timeout': {
    fields: [{ id: 'pr-idle', label: 'Seconds', placeholder: '300', hint: 'Session ends after this many seconds of idle' }],
    build: (sr) => ({ 'Idle-Timeout': sr.getElementById('pr-idle').value.trim() }),
  },
};

class AccountingView extends HTMLElement {
  constructor() {
    super();
    this._rows = [];
    this._coaSession = null;
    this._liveAbort = null;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        @import '/css/theme.css';

        :host { display: block; padding: 1.5rem; }

        .page-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.25rem;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .page-title { font-size: 1.25rem; font-weight: 600; color: var(--color-text); }

        .filter-row {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }

        .input {
          padding: 0.4rem 0.65rem;
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          background: var(--color-surface);
          color: var(--color-text);
          font-size: 0.85rem;
          font-family: var(--font);
        }
        .input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }

        .btn {
          padding: 0.4rem 0.85rem;
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          background: var(--color-surface);
          color: var(--color-text);
          font-size: 0.82rem;
          font-family: var(--font);
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.12s;
        }
        .btn:hover { background: var(--color-bg); }
        .btn-primary { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
        .btn-primary:hover { opacity: 0.88; background: var(--color-accent); }
        .btn-danger { border-color: var(--color-danger); color: var(--color-danger); }
        .btn-danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
        .btn-warn { border-color: color-mix(in srgb, orange 60%, transparent); color: orange; }
        .btn-warn:hover { background: color-mix(in srgb, orange 8%, transparent); }
        .btn-sm { padding: 0.2rem 0.5rem; font-size: 0.75rem; }

        .card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          overflow-x: auto;
        }

        .muted { color: var(--color-muted); }

        table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
        th {
          text-align: left;
          padding: 0.45rem 0.75rem;
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-muted);
          border-bottom: 1px solid var(--color-border);
          background: var(--color-bg);
        }
        td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: var(--color-bg); }

        .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
        .badge-success { background: var(--mr-accept-tint); color: var(--mr-accept); }

        label { font-size: 0.8rem; color: var(--color-muted); }

        /* ── CoA modal ── */
        .modal-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 500;
          align-items: center;
          justify-content: center;
        }
        .modal-overlay.open { display: flex; }

        .modal {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          padding: 1.5rem;
          width: 460px;
          max-width: 90vw;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }

        .modal-title { font-size: 1rem; font-weight: 600; color: var(--color-text); margin-bottom: 0.25rem; }
        .modal-sub { font-size: 0.82rem; color: var(--color-muted); margin-bottom: 1rem; }

        .form-group { margin-bottom: 0.85rem; }
        .form-label {
          display: block;
          font-size: 0.72rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--color-muted);
          margin-bottom: 0.3rem;
        }
        .form-input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          color: var(--color-text);
          font-size: 0.875rem;
          font-family: var(--font);
          box-sizing: border-box;
        }
        .form-input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }
        .form-hint { font-size: 0.72rem; color: var(--color-muted); margin-top: 0.25rem; }

        select.form-input { cursor: pointer; }

        textarea.form-input { resize: vertical; min-height: 80px; font-family: monospace; font-size: 0.82rem; }

        .modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem; }
      </style>

      <div class="page-header">
        <span class="page-title">Sessions</span>
        <button class="btn" id="btn-export" title="Export current results as CSV">⬇ Export CSV</button>
      </div>

      <div class="filter-row">
        <input class="input" id="inp-user" placeholder="Filter by username…" style="width:180px;" />
        <label style="display:flex;align-items:center;gap:0.3rem;">
          <input type="checkbox" id="chk-active" /> Active only
        </label>
        <button class="btn" id="btn-search">Search</button>
        <button class="btn" id="btn-refresh">↻ Refresh</button>
        <button class="btn" id="btn-live" title="Stream active sessions in real time" style="display:flex;align-items:center;gap:0.35rem;">
          <span id="live-dot" style="width:7px;height:7px;border-radius:50%;background:var(--color-muted);display:inline-block;flex-shrink:0;"></span>
          Live
        </button>
      </div>

      ${densityBarHTML()}
      <div class="card" id="wrap"><div class="state-loading">Loading…</div></div>

      <!-- CoA modal -->
      <div class="modal-overlay" id="coa-modal">
        <div class="modal">
          <div class="modal-title">Change of Authorization</div>
          <div class="modal-sub" id="coa-modal-sub"></div>

          <div class="form-group">
            <label class="form-label">Preset</label>
            <select class="form-input" id="coa-preset">
              ${COA_PRESETS.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}
            </select>
          </div>

          <div id="coa-preset-area"></div>

          <div id="coa-custom-area" style="display:none;">
            <div class="form-group">
              <label class="form-label">Attributes</label>
              <textarea class="form-input" id="coa-custom-attrs" placeholder="Attribute-Name=value&#10;One per line"></textarea>
              <div class="form-hint">Standard attributes: Session-Timeout, Idle-Timeout, Mikrotik-Rate-Limit</div>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn" id="coa-cancel">Cancel</button>
            <button class="btn btn-primary" id="coa-submit">Send CoA</button>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
    wireDensityBar(this.shadowRoot, () => this.shadowRoot.querySelector('#wrap table'));
    const _hlId = new URLSearchParams(location.search).get('highlight');
    this._load().then(() => {
      if (_hlId) {
        const row = this.shadowRoot.querySelector(`tr[data-id="${_hlId}"]`);
        if (row) { row.style.outline = '2px solid var(--color-accent)'; row.scrollIntoView({ block: 'center' }); }
      }
    });
  }

  disconnectedCallback() {
    this._stopLive();
  }

  _bindEvents() {
    const sr = this.shadowRoot;
    sr.getElementById('btn-search').addEventListener('click', () => { this._stopLive(); this._load(); });
    sr.getElementById('btn-refresh').addEventListener('click', () => { this._stopLive(); this._load(); });
    sr.getElementById('inp-user').addEventListener('keydown', e => { if (e.key === 'Enter') { this._stopLive(); this._load(); } });
    sr.getElementById('btn-export').addEventListener('click', () => this._exportCSV());
    sr.getElementById('btn-live').addEventListener('click', () => this._toggleLive());

    // CoA modal
    sr.getElementById('coa-cancel').addEventListener('click', () => this._closeCoA());
    sr.getElementById('coa-modal').addEventListener('click', e => { if (e.target.id === 'coa-modal') this._closeCoA(); });
    sr.getElementById('coa-submit').addEventListener('click', () => this._submitCoA());
    sr.getElementById('coa-preset').addEventListener('change', () => this._updatePresetFields());
  }

  _toggleLive() {
    if (this._liveAbort) {
      this._stopLive();
    } else {
      this._startLive();
    }
  }

  _startLive() {
    const btn  = this.shadowRoot.getElementById('btn-live');
    const dot  = this.shadowRoot.getElementById('live-dot');
    const wrap = this.shadowRoot.getElementById('wrap');
    btn.style.borderColor = 'var(--color-success)';
    btn.style.color = 'var(--color-success)';
    dot.style.background = 'var(--color-success)';
    dot.style.animation = 'none';
    // Force active checkbox
    const chk = this.shadowRoot.getElementById('chk-active');
    if (chk) chk.checked = true;

    this._liveAbort = new AbortController();
    const signal = this._liveAbort.signal;

    (async () => {
      try {
        const res = await fetch('/api/accounting/stream', {
          credentials: 'same-origin',
          signal,
        });
        if (!res.ok) { toast(`Live stream error: ${res.status}`, 'error'); this._stopLive(); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              this._rows = JSON.parse(line.slice(6));
              this._renderTable();
            } catch { /* ignore parse errors */ }
          }
        }
      } catch (e) {
        if (e.name !== 'AbortError') { toast(`Live stream error: ${e.message}`, 'error'); }
      } finally {
        this._stopLive();
      }
    })();
  }

  _stopLive() {
    if (this._liveAbort) {
      this._liveAbort.abort();
      this._liveAbort = null;
    }
    const btn = this.shadowRoot.getElementById('btn-live');
    const dot = this.shadowRoot.getElementById('live-dot');
    if (btn) { btn.style.borderColor = ''; btn.style.color = ''; }
    if (dot) { dot.style.background = 'var(--color-muted)'; dot.style.animation = ''; }
  }

  async _load() {
    const wrap = this.shadowRoot.getElementById('wrap');
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>User</th><th>Auth</th><th>NAS / Location</th><th>Start</th><th>Stop</th>
        <th>In / Out</th><th>Framed IP</th><th>Cause</th><th></th>
      </tr></thead>
      <tbody>${skeletonRows(this.shadowRoot, 9, 8)}</tbody>
    </table>`;
    const user   = this.shadowRoot.getElementById('inp-user').value.trim();
    const active = this.shadowRoot.getElementById('chk-active').checked;
    let url = `/accounting?limit=200&active_only=${active}`;
    if (user) url += `&username=${encodeURIComponent(user)}`;
    try {
      this._rows = await api.get(url);
      this._renderTable();
    } catch (e) {
      wrap.innerHTML = `<div class="state-error">Failed: ${esc(e.message)}</div>`;
    }
  }

  _renderTable() {
    const wrap = this.shadowRoot.getElementById('wrap');
    if (!this._rows.length) {
      wrap.innerHTML = emptyStateHTML({
        title: 'No sessions found',
        message: 'Nothing matches the current filters. Adjust them or try a different time range.',
      });
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Auth</th>
            <th>NAS / Location</th>
            <th>Start</th>
            <th>Stop</th>
            <th>In / Out</th>
            <th>Framed IP</th>
            <th>Cause</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this._rows.map(r => `
            <tr data-id="${r.radacctid}">
              <td style="font-weight:500">${esc(r.username || '—')}</td>
              <td>${r.auth_outcome === 'Access-Accept'
                  ? '<span class="badge badge-success">Accept</span>'
                  : r.auth_outcome
                    ? `<span class="badge" style="background:var(--mr-reject-tint);color:var(--mr-reject)">Reject</span>`
                    : '<span class="muted" style="font-size:0.75rem">—</span>'}
                ${r.auth_log_id ? `<a data-auth-link="${r.auth_log_id}" href="#" style="font-size:0.7rem;display:block;color:var(--color-accent);text-decoration:none;margin-top:2px" title="View auth event">↗ Auth</a>` : ''}
              </td>
              <td style="white-space:nowrap">
                <span class="mono muted">${esc(r.nasipaddress || '—')}</span>
                ${r.geo_client ? `<div style="font-size:0.72rem;color:var(--color-muted);margin-top:1px">${esc(_geoLabel(r.geo_client))}</div>` : ''}
              </td>
              <td class="mono" style="white-space:nowrap" data-sort="${Date.parse(r.acctstarttime) || 0}">${fmtDate(r.acctstarttime)}</td>
              <td class="mono muted" style="white-space:nowrap" data-sort="${r.acctstoptime ? Date.parse(r.acctstoptime) : Number.MAX_SAFE_INTEGER}">
                ${r.acctstoptime
                  ? fmtDate(r.acctstoptime)
                  : '<span class="badge badge-success">Active</span>'}
              </td>
              <td class="mono" data-sort="${(Number(r.acctinputoctets) || 0) + (Number(r.acctoutputoctets) || 0)}">${fmt(r.acctinputoctets)} / ${fmt(r.acctoutputoctets)}</td>
              <td class="mono muted">${esc(r.framedipaddress || '—')}</td>
              <td class="muted">${esc(r.acctterminatecause || '—')}</td>
              <td style="white-space:nowrap">
                ${r.active ? `
                  <button class="btn btn-sm" data-action="logs" data-nas="${esc(r.nasipaddress || '')}" data-user="${esc(r.username || '')}" data-since="${esc(r.acctstarttime || '')}" title="View Graylog session logs">Logs</button>
                  <button class="btn btn-sm btn-warn" data-action="coa" data-uid="${esc(r.acctuniqueid)}" data-user="${esc(r.username || '')}" style="margin-left:4px">CoA</button>
                  <button class="btn btn-sm btn-danger" data-action="disc" data-uid="${esc(r.acctuniqueid)}" data-user="${esc(r.username || '')}" style="margin-left:4px">Disconnect</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    const table = wrap.querySelector('table');
    applyDensity(table);
    makeSortable(table, { default: { col: 3, dir: 'desc' } }); // Start, newest first

    // Cross-link to auth log (20.3)
    wrap.querySelectorAll('[data-auth-link]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        router.navigate('/auth-logs?highlight=' + a.dataset.authLink);
      });
    });

    wrap.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid  = btn.dataset.uid;
        const user = btn.dataset.user;
        if (btn.dataset.action === 'disc') this._confirmDisconnect(uid, user);
        if (btn.dataset.action === 'coa')  this._openCoA(uid, user);
        if (btn.dataset.action === 'logs') {
          const params = new URLSearchParams({ tab: 'graylog', nas_ip: btn.dataset.nas, username: btn.dataset.user, since: btn.dataset.since });
          router.navigate(`/integrations?${params}`);
        }
      });
    });
  }

  // ── Disconnect ──────────────────────────────────────────────────────────────

  async _confirmDisconnect(uid, username) {
    if (!(await confirmDialog(`Disconnect session for "${username}"?\n\nA Disconnect-Request will be sent to the NAS.`, { title: 'Disconnect session' }))) return;
    try {
      const res = await api.post(`/accounting/${encodeURIComponent(uid)}/disconnect`, {});
      if (res.success) {
        toast(`Disconnected — ${res.message}`, 'success');
        setTimeout(() => this._load(), 1500);
      } else {
        toast(`Disconnect failed: ${res.message}`, 'error');
      }
    } catch (e) {
      toast(e.message ?? 'Failed to disconnect', 'error');
    }
  }

  // ── CoA ─────────────────────────────────────────────────────────────────────

  _openCoA(uid, username) {
    this._coaSession = { uid, username };
    const sr = this.shadowRoot;
    sr.getElementById('coa-modal-sub').textContent = `User: ${username}`;
    sr.getElementById('coa-preset').value = '';
    sr.getElementById('coa-custom-attrs').value = '';
    this._updatePresetFields();
    sr.getElementById('coa-modal').classList.add('open');
  }

  _closeCoA() {
    this.shadowRoot.getElementById('coa-modal').classList.remove('open');
    this._coaSession = null;
  }

  _updatePresetFields() {
    const sr    = this.shadowRoot;
    const id    = sr.getElementById('coa-preset').value;
    const area  = sr.getElementById('coa-preset-area');
    const cArea = sr.getElementById('coa-custom-area');
    const def   = PRESET_FIELDS[id];

    if (!id) {
      area.innerHTML = '';
      cArea.style.display = '';
      return;
    }
    cArea.style.display = 'none';
    area.innerHTML = def.fields.map(f => `
      <div class="form-group">
        <label class="form-label">${f.label}</label>
        <input type="text" class="form-input" id="${f.id}" placeholder="${f.placeholder || ''}">
        ${f.hint ? `<div class="form-hint">${f.hint}</div>` : ''}
      </div>
    `).join('');
  }

  async _submitCoA() {
    if (!this._coaSession) return;
    const sr = this.shadowRoot;
    const presetId = sr.getElementById('coa-preset').value;

    let attributes = {};
    if (presetId) {
      const def = PRESET_FIELDS[presetId];
      attributes = def.build(sr);
      const empty = Object.values(attributes).filter(v => !v);
      if (empty.length) { toast('Fill in all fields', 'error'); return; }
    } else {
      const raw = sr.getElementById('coa-custom-attrs').value.trim();
      if (!raw) { toast('Enter at least one attribute', 'error'); return; }
      for (const line of raw.split('\n')) {
        const eq = line.indexOf('=');
        if (eq === -1) { toast(`Invalid line (missing =): ${line}`, 'error'); return; }
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim();
        if (!k || !v) { toast(`Invalid attribute: ${line}`, 'error'); return; }
        attributes[k] = v;
      }
    }

    const { uid, username } = this._coaSession;
    this._closeCoA();

    try {
      const res = await api.post(`/accounting/${encodeURIComponent(uid)}/coa`, { attributes });
      if (res.success) {
        toast(`CoA accepted — ${res.message}`, 'success');
      } else {
        toast(`CoA rejected: ${res.message}`, 'error');
      }
    } catch (e) {
      toast(e.message ?? 'CoA failed', 'error');
    }
  }

  // ── CSV export ───────────────────────────────────────────────────────────────

  async _exportCSV() {
    const user   = this.shadowRoot.getElementById('inp-user').value.trim();
    const active = this.shadowRoot.getElementById('chk-active').checked;
    let url = `/api/accounting/export?limit=10000&active_only=${active}`;
    if (user) url += `&username=${encodeURIComponent(user)}`;

    try {
      const res = await fetch(url, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = active ? 'sessions-active.csv' : 'sessions.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(e.message ?? 'Export failed', 'error');
    }
  }
}

customElements.define('accounting-view', AccountingView);
router.register('/accounting', () => document.createElement('accounting-view'));
