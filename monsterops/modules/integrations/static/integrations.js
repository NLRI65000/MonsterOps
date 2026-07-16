import { router } from '/js/router.js';
import { api, csrfToken } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { startPolling } from '/js/utils/poll.js';
import { emptyStateHTML, skeletonBlock } from '/js/utils/empty.js';
import { applyServerErrors, clearFieldErrors, setFieldError } from '/js/utils/form.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(
    /"/g,
    '&quot;',
  );
}

function fmtClock(unix) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString();
}

const SEVERITY_COLOR = {
  'Not classified': 'var(--color-muted)',
  'Information': 'var(--color-accent)',
  'Warning': 'orange',
  'Average': 'orange',
  'High': 'var(--color-danger)',
  'Disaster': '#dc2626',
};

const LEVEL_LABELS = {
  0: 'EMERG',
  1: 'ALERT',
  2: 'CRIT',
  3: 'ERR',
  4: 'WARN',
  5: 'NOTICE',
  6: 'INFO',
  7: 'DEBUG',
};

// ── Shared CSS ─────────────────────────────────────────────────────────────────

const BASE_CSS = `
  @import '/css/theme.css';
  :host { display: block; padding: 1.5rem; }

  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem; }
  .page-title { font-size: 1.25rem; font-weight: 600; color: var(--color-text); }

  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--color-border); margin-bottom: 1.25rem; }
  .tab-btn {
    padding: 0.55rem 1.1rem;
    border: none;
    background: transparent;
    color: var(--color-muted);
    font-size: 0.85rem;
    font-family: var(--font);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color 0.12s;
  }
  .tab-btn:hover { color: var(--color-text); }
  .tab-btn.active { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: 500; }

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
  .btn-primary:hover { opacity: 0.88; }
  .btn-danger { border-color: var(--color-danger); color: var(--color-danger); }
  .btn-danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
  .btn-sm { padding: 0.2rem 0.55rem; font-size: 0.75rem; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 1.1rem 1.25rem; }
  .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }

  .input, .select {
    width: 100%;
    padding: 0.4rem 0.65rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font);
    box-sizing: border-box;
  }
  .input:focus, .select:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }

  .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.85rem; }
  .field label { font-size: 0.78rem; font-weight: 500; color: var(--color-muted); }
  .field-hint { font-size: 0.72rem; color: var(--color-muted); }

  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }

  .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
  .badge-ok { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); }
  .badge-err { background: color-mix(in srgb, var(--color-danger) 12%, transparent); color: var(--color-danger); }
  .badge-off { background: color-mix(in srgb, var(--color-muted) 15%, transparent); color: var(--color-muted); }

  .empty { padding: 2.5rem; text-align: center; color: var(--color-muted); font-size: 0.85rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th {
    text-align: left;
    padding: 0.45rem 0.75rem;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg);
  }
  td { padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: color-mix(in srgb, var(--color-accent) 4%, transparent); }

  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 500; align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 1.5rem; min-width: 420px; max-width: 560px; width: 90vw; max-height: 90vh; overflow-y: auto; }
  .modal-header { display: flex; align-items: center; margin-bottom: 1.25rem; }
  .modal-title { font-size: 1rem; font-weight: 600; flex: 1; }
  .modal-close { background: none; border: none; font-size: 1.1rem; cursor: pointer; color: var(--color-muted); padding: 0.2rem; }
  .modal-footer { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.25rem; }

  .toggle-wrap { display: flex; align-items: center; gap: 0.5rem; }
  .toggle { appearance: none; width: 36px; height: 20px; background: var(--color-border); border-radius: 10px; cursor: pointer; position: relative; transition: background 0.2s; }
  .toggle:checked { background: var(--color-accent); }
  .toggle::after { content: ''; position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left 0.2s; }
  .toggle:checked::after { left: 19px; }

  .log-wrap { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius); font-family: monospace; font-size: 0.75rem; max-height: 480px; overflow-y: auto; }
  .log-row { display: flex; gap: 0.75rem; padding: 0.3rem 0.65rem; border-bottom: 1px solid color-mix(in srgb, var(--color-border) 40%, transparent); }
  .log-row:last-child { border-bottom: none; }
  .log-row:hover { background: color-mix(in srgb, var(--color-accent) 5%, transparent); }
  .log-ts { color: var(--color-muted); white-space: nowrap; flex-shrink: 0; }
  .log-lvl { flex-shrink: 0; width: 48px; font-weight: 600; }
  .log-msg { word-break: break-all; flex: 1; }
  .log-expand { color: var(--color-accent); cursor: pointer; flex-shrink: 0; font-size: 0.68rem; }
  .log-fields { background: color-mix(in srgb, var(--color-border) 20%, transparent); padding: 0.4rem 0.65rem; font-size: 0.72rem; white-space: pre-wrap; display: none; }
  .log-fields.open { display: block; }

  .search-bar { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: flex-end; }
  .search-bar .field { margin-bottom: 0; min-width: 160px; }
  .info-bar { font-size: 0.78rem; color: var(--color-muted); margin-bottom: 0.75rem; display: flex; align-items: center; gap: 1rem; }
  .refresh-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-success); display: inline-block; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
`;

// ── IntegrationsPage ───────────────────────────────────────────────────────────

class IntegrationsPage extends HTMLElement {
  constructor() {
    super();
    this._tab = 'overview';
    this._integrations = [];
    this._intLoading = true;
    this._intError = null;
    this._nasList = [];
    this._editingId = null;
    this._graylogResult = null;
    this._graylogLoading = false;
    this._graylogStop = null;
    this._zabbixResult = null;
    this._geoipStatus = null;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    const params = new URLSearchParams(
      location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '',
    );
    const tab = params.get('tab');
    if (tab === 'graylog' || tab === 'zabbix') this._tab = tab;
    this._render();
    this._bindTabs();
    Promise.all([
      this._loadIntegrations(),
      this._loadNasList(),
      this._loadGeoipStatus(),
    ]).then(() => {
      if (tab === 'graylog') this._prefillGraylog(params);
      if (tab === 'zabbix') this._prefillZabbix(params);
    });
  }

  disconnectedCallback() {
    this._stopGraylogRefresh();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>${BASE_CSS}
        .int-card { display: flex; flex-direction: column; gap: 0.75rem; }
        .int-card-header { display: flex; align-items: center; gap: 0.75rem; }
        .int-icon { font-size: 1.4rem; }
        .int-logo { width: 30px; height: 30px; display: block; object-fit: contain; flex-shrink: 0; }
        .int-meta { flex: 1; }
        .int-name { font-weight: 600; font-size: 0.92rem; }
        .int-type { font-size: 0.72rem; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .int-actions { display: flex; gap: 0.4rem; align-items: center; }
        .test-result { font-size: 0.75rem; }
        .test-ok  { color: var(--color-success); }
        .test-err { color: var(--color-danger); }
      </style>
      <div class="page-header">
        <span class="page-title">Integrations</span>
        <button class="btn btn-primary" id="btn-add">+ Add Integration</button>
      </div>
      <div class="tabs">
        <button class="tab-btn ${
      this._tab === 'overview' ? 'active' : ''
    }" data-tab="overview">Overview</button>
        <button class="tab-btn ${
      this._tab === 'graylog' ? 'active' : ''
    }" data-tab="graylog">Graylog Live Logs</button>
        <button class="tab-btn ${
      this._tab === 'zabbix' ? 'active' : ''
    }" data-tab="zabbix">Zabbix Alarms</button>
      </div>
      <div id="tab-content"></div>

      <!-- Modal -->
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title" id="modal-title">Add Integration</span>
            <button class="modal-close" id="modal-close">✕</button>
          </div>
          <div id="modal-body"></div>
          <div class="modal-footer">
            <button class="btn" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-submit">Save</button>
          </div>
        </div>
      </div>
    `;

    this.shadowRoot.getElementById('btn-add').addEventListener(
      'click',
      () => this._openModal(null),
    );
    this.shadowRoot.getElementById('modal-close').addEventListener(
      'click',
      () => this._closeModal(),
    );
    this.shadowRoot.getElementById('modal-cancel').addEventListener(
      'click',
      () => this._closeModal(),
    );
    this.shadowRoot.getElementById('modal-submit').addEventListener(
      'click',
      () => this._submitModal(),
    );
    this.shadowRoot.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === this.shadowRoot.getElementById('modal-overlay')) this._closeModal();
    });
    this._renderTab();
  }

  _bindTabs() {
    this.shadowRoot.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        this.shadowRoot.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this._stopGraylogRefresh();
        this._renderTab();
      });
    });
  }

  _renderTab() {
    const tc = this.shadowRoot.getElementById('tab-content');
    if (!tc) return;
    if (this._tab === 'overview') this._renderOverview(tc);
    else if (this._tab === 'graylog') this._renderGraylogTab(tc);
    else if (this._tab === 'zabbix') this._renderZabbixTab(tc);
  }

  // ── NAS list ──────────────────────────────────────────────────────────────

  async _loadNasList() {
    try {
      const data = await api.get('/nas?size=100');
      this._nasList = data?.items ?? [];
      const select = this.shadowRoot.getElementById('gl-nas-select');
      if (select) this._populateNasDropdown(select);
    } catch {
      this._nasList = [];
    }
  }

  _populateNasDropdown(select) {
    // Remove any previously inserted options (keep the placeholder)
    while (select.options.length > 1) select.remove(1);
    for (const nas of this._nasList) {
      const opt = document.createElement('option');
      opt.value = nas.id;
      opt.textContent = nas.shortname ? `${nas.shortname} (${nas.nasname})` : nas.nasname;
      opt.dataset.nasname = nas.nasname;
      opt.dataset.shortname = nas.shortname || '';
      select.appendChild(opt);
    }
  }

  // ── Overview ──────────────────────────────────────────────────────────────

  async _loadIntegrations() {
    this._intLoading = true;
    this._intError = null;
    if (this._tab === 'overview') this._renderTab();
    try {
      this._integrations = await api.get('/integrations');
    } catch (e) {
      this._intError = e.message || 'Something went wrong.';
    } finally {
      this._intLoading = false;
      if (this._tab === 'overview') this._renderTab();
    }
  }

  // Resolve the integrations region to a skeleton (loading), a themed error, a
  // shared empty state, or the real card grid — so the overview no longer flashes
  // its empty state before the load resolves.
  _intCardsHTML() {
    if (this._intLoading) return skeletonBlock(this.shadowRoot, 4);
    if (this._intError) {
      return emptyStateHTML({ title: 'Couldn’t load integrations', message: this._intError });
    }
    if (!this._integrations.length) {
      return emptyStateHTML({
        title: 'No integrations yet',
        message: 'Add an integration (Graylog, Zabbix, …) to forward events and pull logs.',
      });
    }
    return `<div class="card-grid">${
      this._integrations.map((i) => this._integrationCard(i)).join('')
    }</div>`;
  }

  _renderOverview(tc) {
    const intCards = this._intCardsHTML();

    tc.innerHTML = `
      ${intCards}
      <div style="margin-top:1.5rem;">
        <div style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-muted);margin-bottom:0.75rem;">Data Sources</div>
        <div class="card-grid">
          ${this._maxmindCard()}
        </div>
      </div>
    `;

    tc.querySelectorAll('[data-int-id]').forEach((el) => {
      const id = parseInt(el.dataset.intId);
      const action = el.dataset.action;
      el.addEventListener('click', () => {
        if (action === 'edit') this._openModal(id);
        if (action === 'test') this._testIntegration(id, el);
        if (action === 'delete') this._deleteIntegration(id);
      });
    });

    tc.querySelector('#btn-maxmind')?.addEventListener('click', () => this._openMaxmindModal());
  }

  async _loadGeoipStatus() {
    try {
      this._geoipStatus = await api.get('/health/geoip/status');
      if (this._tab === 'overview') this._renderTab();
    } catch {
      this._geoipStatus = null;
    }
  }

  _maxmindCard() {
    const s = this._geoipStatus;
    let badge, detail;
    if (!s) {
      badge = '<span class="badge badge-off">Loading…</span>';
      detail = '';
    } else if (s.configured && s.db_exists && !s.error) {
      badge = '<span class="badge badge-ok">Active</span>';
      const built = s.build_epoch ? new Date(s.build_epoch * 1000).toLocaleDateString() : '—';
      detail = `<div style="font-size:0.75rem;color:var(--color-muted);margin-top:0.35rem;">${
        esc(s.description || 'GeoLite2-City')
      } · Built ${esc(built)}</div>`;
    } else {
      badge = '<span class="badge badge-err">Not configured</span>';
      detail =
        `<div style="font-size:0.75rem;color:var(--color-muted);margin-top:0.35rem;">Upload a GeoLite2-City.mmdb to enable location lookup.</div>`;
    }
    return `
      <div class="card" style="cursor:pointer;" id="btn-maxmind">
        <div class="int-card-header">
          <span class="int-icon">🌍</span>
          <div class="int-meta">
            <div class="int-name">MaxMind GeoIP2</div>
            <div class="int-type">Geolocation · Free Database</div>
          </div>
          ${badge}
        </div>
        ${detail}
      </div>
    `;
  }

  _integrationCard(i) {
    const logo = (i.type === 'graylog' || i.type === 'zabbix')
      ? `<img class="int-logo" src="/modules/integrations/img/${i.type}.svg" alt="${
        esc(i.type)
      } logo" width="30" height="30" />`
      : '<span class="int-icon">🔌</span>';
    const badge = i.enabled
      ? '<span class="badge badge-ok">Enabled</span>'
      : '<span class="badge badge-off">Disabled</span>';
    return `
      <div class="card">
        <div class="int-card-header">
          ${logo}
          <div class="int-meta">
            <div class="int-name">${esc(i.name)}</div>
            <div class="int-type">${esc(i.type)}</div>
          </div>
          ${badge}
        </div>
        <div class="int-actions">
          <button class="btn btn-sm" data-action="test" data-int-id="${i.id}">Test Connection</button>
          <button class="btn btn-sm" data-action="edit" data-int-id="${i.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-int-id="${i.id}">Delete</button>
        </div>
        <div class="test-result" id="test-result-${i.id}"></div>
      </div>
    `;
  }

  async _testIntegration(id, btn) {
    const result = this.shadowRoot.getElementById(`test-result-${id}`);
    btn.disabled = true;
    btn.textContent = 'Testing…';
    try {
      const r = await api.post(`/integrations/${id}/test`, {});
      if (result) {
        result.innerHTML = r.ok
          ? `<span class="test-ok">✓ ${esc(r.message)}</span>`
          : `<span class="test-err">✗ ${esc(r.message)}</span>`;
      }
    } catch (e) {
      if (result) result.innerHTML = `<span class="test-err">✗ ${esc(e.message)}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  }

  async _deleteIntegration(id) {
    if (
      !(await confirmDialog('Delete this integration?', {
        title: 'Delete integration',
        danger: true,
      }))
    ) return;
    try {
      await api.delete(`/integrations/${id}`);
      toast('Integration deleted', 'success');
      await this._loadIntegrations();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── MaxMind GeoIP2 modal ──────────────────────────────────────────────────

  _openMaxmindModal() {
    // Remove any existing maxmind overlay
    this.shadowRoot.querySelector('.mm-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'mm-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:600;display:flex;align-items:center;justify-content:center;';

    const s = this._geoipStatus;
    const isActive = s?.configured && s?.db_exists && !s?.error;
    const built = s?.build_epoch ? new Date(s.build_epoch * 1000).toLocaleDateString() : null;

    overlay.innerHTML = `
      <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);width:min(540px,94vw);max-height:90vh;overflow-y:auto;padding:1.5rem;box-shadow:0 8px 40px rgba(0,0,0,0.4);">
        <div style="display:flex;align-items:center;margin-bottom:1.25rem;">
          <span style="font-size:1.4rem;margin-right:0.75rem;">🌍</span>
          <div style="flex:1;">
            <div style="font-size:1rem;font-weight:600;">MaxMind GeoIP2</div>
            <div style="font-size:0.75rem;color:var(--color-muted);">Free geolocation for client IP addresses</div>
          </div>
          <button id="mm-close" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--color-muted);padding:0.25rem;">✕</button>
        </div>

        ${
      isActive
        ? `
        <div style="display:flex;align-items:center;gap:0.6rem;padding:0.75rem 1rem;background:color-mix(in srgb,var(--color-success) 12%,transparent);border:1px solid color-mix(in srgb,var(--color-success) 30%,transparent);border-radius:var(--radius);margin-bottom:1.25rem;">
          <span style="color:var(--color-success);font-size:1rem;">✓</span>
          <div>
            <div style="font-size:0.85rem;font-weight:500;color:var(--color-success);">Database active</div>
            <div style="font-size:0.75rem;color:var(--color-muted);">${
          esc(s.description || 'GeoLite2-City')
        }${built ? ' · Built ' + esc(built) : ''}</div>
          </div>
        </div>`
        : `
        <div style="display:flex;align-items:center;gap:0.6rem;padding:0.75rem 1rem;background:color-mix(in srgb,var(--color-warning,#f59e0b) 10%,transparent);border:1px solid color-mix(in srgb,var(--color-warning,#f59e0b) 25%,transparent);border-radius:var(--radius);margin-bottom:1.25rem;">
          <span style="font-size:1rem;">⚠</span>
          <div style="font-size:0.82rem;color:var(--color-text);">No database configured. Upload a <strong>GeoLite2-City.mmdb</strong> file to enable location lookups for client IPs in auth logs, sessions, and the dashboard.</div>
        </div>`
    }

        <div style="margin-bottom:1.25rem;">
          <div style="font-size:0.8rem;font-weight:600;color:var(--color-text);margin-bottom:0.65rem;">How to get the database (free)</div>
          <ol style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:0.5rem;font-size:0.82rem;color:var(--color-muted);">
            <li>Create a free account at <strong style="color:var(--color-text);">maxmind.com</strong> — no payment required.</li>
            <li>In your account, go to <strong style="color:var(--color-text);">Download Databases</strong> → <strong style="color:var(--color-text);">GeoLite2 City</strong>.</li>
            <li>Download the <strong style="color:var(--color-text);">GeoLite2-City.mmdb</strong> file (Binary / MaxMind DB format).</li>
            <li>Upload it below. The database activates immediately — no restart needed.</li>
          </ol>
          <a href="https://www.maxmind.com/en/geolite2/signup" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:0.3rem;margin-top:0.75rem;font-size:0.78rem;color:var(--color-accent);text-decoration:none;font-weight:500;">
            Open MaxMind signup ↗
          </a>
        </div>

        <div style="margin-bottom:1rem;">
          <div style="font-size:0.8rem;font-weight:600;color:var(--color-text);margin-bottom:0.5rem;">${
      isActive ? 'Replace database' : 'Upload database'
    }</div>
          <label id="mm-dropzone" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;padding:1.5rem;border:2px dashed var(--color-border);border-radius:var(--radius);cursor:pointer;transition:border-color 0.15s,background 0.15s;">
            <span style="font-size:1.75rem;">⬆</span>
            <span style="font-size:0.82rem;color:var(--color-muted);" id="mm-drop-label">Click to select <strong>GeoLite2-City.mmdb</strong>, or drag and drop here</span>
            <input type="file" id="mm-file" accept=".mmdb" style="display:none;" />
          </label>
        </div>

        <div id="mm-progress" style="display:none;font-size:0.82rem;color:var(--color-muted);text-align:center;padding:0.5rem 0;">Uploading…</div>
        <div id="mm-result"></div>

        <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--color-border);">
          <button class="btn" id="mm-cancel">Close</button>
          <button class="btn btn-primary" id="mm-upload" disabled>Upload</button>
        </div>
      </div>
    `;

    this.shadowRoot.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#mm-close').addEventListener('click', close);
    overlay.querySelector('#mm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const fileInput = overlay.querySelector('#mm-file');
    const uploadBtn = overlay.querySelector('#mm-upload');
    const dropzone = overlay.querySelector('#mm-dropzone');
    const dropLabel = overlay.querySelector('#mm-drop-label');
    let selectedFile = null;

    const onFileSelected = (file) => {
      if (!file || !file.name.endsWith('.mmdb')) {
        toast('Please select a .mmdb file', 'error');
        return;
      }
      selectedFile = file;
      dropLabel.innerHTML = `Selected: <strong>${esc(file.name)}</strong> (${
        (file.size / 1024 / 1024).toFixed(1)
      } MB)`;
      dropzone.style.borderColor = 'var(--color-accent)';
      dropzone.style.background = 'color-mix(in srgb,var(--color-accent) 5%,transparent)';
      uploadBtn.disabled = false;
    };

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) onFileSelected(fileInput.files[0]);
    });
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--color-accent)';
    });
    dropzone.addEventListener('dragleave', () => {
      if (!selectedFile) dropzone.style.borderColor = '';
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) onFileSelected(file);
    });

    uploadBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      const progress = overlay.querySelector('#mm-progress');
      const result = overlay.querySelector('#mm-result');
      uploadBtn.disabled = true;
      progress.style.display = 'block';
      result.innerHTML = '';

      try {
        const fd = new FormData();
        fd.append('file', selectedFile);
        const res = await fetch('/api/health/geoip/upload', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken() },
          credentials: 'same-origin',
          body: fd,
        });
        const data = await res.json();
        progress.style.display = 'none';
        if (!res.ok) throw new Error(data.detail || 'Upload failed');

        const built = data.build_epoch
          ? new Date(data.build_epoch * 1000).toLocaleDateString()
          : '—';
        const testGeo = data.test_lookup;
        result.innerHTML = `
          <div style="padding:0.85rem 1rem;background:color-mix(in srgb,var(--color-success) 10%,transparent);border:1px solid color-mix(in srgb,var(--color-success) 25%,transparent);border-radius:var(--radius);">
            <div style="font-weight:600;color:var(--color-success);margin-bottom:0.35rem;">✓ Database uploaded and active</div>
            <div style="font-size:0.78rem;color:var(--color-muted);">${
          esc(data.description || 'GeoLite2-City')
        } · Built ${esc(built)}</div>
            ${
          testGeo
            ? `<div style="font-size:0.78rem;color:var(--color-muted);margin-top:0.3rem;">Smoke test (8.8.8.8): ${
              esc(testGeo.city || '')
            } ${testGeo.country_code ? '(' + testGeo.country_code + ')' : ''} ✓</div>`
            : ''
        }
          </div>
        `;
        overlay.querySelector('#mm-cancel').textContent = 'Close';
        this._geoipStatus = null;
        this._loadGeoipStatus();
        toast('GeoIP database activated', 'success');
      } catch (err) {
        progress.style.display = 'none';
        result.innerHTML =
          `<div style="padding:0.75rem 1rem;background:color-mix(in srgb,var(--color-danger) 10%,transparent);border:1px solid color-mix(in srgb,var(--color-danger) 25%,transparent);border-radius:var(--radius);font-size:0.82rem;color:var(--color-danger);">✗ ${
            esc(err.message)
          }</div>`;
        uploadBtn.disabled = false;
        toast(err.message, 'error');
      }
    });
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  _openModal(id) {
    const editing = id != null ? this._integrations.find((i) => i.id === id) : null;
    this._editingId = id ?? null;
    const title = this.shadowRoot.getElementById('modal-title');
    const body = this.shadowRoot.getElementById('modal-body');
    title.textContent = editing ? 'Edit Integration' : 'Add Integration';

    const cfg = editing?.config ?? {};
    const type = editing?.type ?? 'graylog';

    body.innerHTML = `
      <div class="field">
        <label>Name</label>
        <input class="input" id="m-name" value="${
      esc(editing?.name ?? '')
    }" placeholder="My Graylog" />
      </div>
      <div class="field">
        <label>Type</label>
        <select class="select" id="m-type">
          <option value="graylog" ${type === 'graylog' ? 'selected' : ''}>Graylog</option>
          <option value="zabbix"  ${type === 'zabbix' ? 'selected' : ''}>Zabbix</option>
        </select>
      </div>
      <div id="m-config-fields"></div>
      <div class="field">
        <div class="toggle-wrap">
          <input type="checkbox" class="toggle" id="m-enabled" ${
      (editing?.enabled ?? true) ? 'checked' : ''
    } />
          <label for="m-enabled" style="font-size:0.82rem;color:var(--color-text);">Enabled</label>
        </div>
      </div>
    `;

    const renderConfigFields = (t) => {
      const cf = body.querySelector('#m-config-fields');
      if (t === 'graylog') {
        cf.innerHTML = `
          <div class="field"><label>Base URL</label><input class="input" id="m-base-url" value="${
          esc(cfg.base_url ?? '')
        }" placeholder="http://graylog:9000" /></div>
          <div class="form-row">
            <div class="field"><label>Username</label><input class="input" id="m-username" value="${
          esc(cfg.username ?? '')
        }" /></div>
            <div class="field"><label>Password</label><input class="input" id="m-password" type="password" value="${
          esc(cfg.password ?? '')
        }" /></div>
          </div>
          <div class="field"><label>Stream ID <span style="font-weight:400;">(optional)</span></label><input class="input" id="m-stream-id" value="${
          esc(cfg.stream_id ?? '')
        }" placeholder="Leave blank to search all streams" /></div>
          <div class="form-row">
            <div class="field">
              <label>NAS IP field</label>
              <input class="input" id="m-nas-ip-field" value="${
          esc(cfg.nas_ip_field ?? 'source')
        }" placeholder="source" />
              <span class="field-hint">Field containing the NAS IP. Use <strong>source</strong> for raw syslog (MikroTik/switches), <strong>nasipaddress</strong> for FreeRADIUS GELF.</span>
            </div>
            <div class="field">
              <label>Username field <span style="font-weight:400;">(optional)</span></label>
              <input class="input" id="m-username-field" value="${
          esc(cfg.username_field ?? '')
        }" placeholder="leave blank" />
              <span class="field-hint">Leave blank to wildcard-search usernames inside <strong>message</strong>. Set to <strong>username</strong> for structured GELF.</span>
            </div>
          </div>
          <div class="form-row">
            <div class="field"><label>Timeout (s)</label><input class="input" id="m-timeout" type="number" min="1" max="60" value="${
          cfg.timeout ?? 10
        }" /></div>
            <div class="field" style="justify-content:flex-end;">
              <div class="toggle-wrap" style="margin-top:1.4rem;">
                <input type="checkbox" class="toggle" id="m-verify-ssl" ${
          cfg.verify_ssl ? 'checked' : ''
        } />
                <label for="m-verify-ssl" style="font-size:0.82rem;color:var(--color-text);">Verify SSL</label>
              </div>
            </div>
          </div>
        `;
      } else {
        cf.innerHTML = `
          <div class="field"><label>API URL</label><input class="input" id="m-base-url" value="${
          esc(cfg.base_url ?? '')
        }" placeholder="http://zabbix/api_jsonrpc.php" /></div>
          <div class="form-row">
            <div class="field"><label>Username</label><input class="input" id="m-username" value="${
          esc(cfg.username ?? '')
        }" /></div>
            <div class="field"><label>Password</label><input class="input" id="m-password" type="password" value="${
          esc(cfg.password ?? '')
        }" /></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Timeout (s)</label><input class="input" id="m-timeout" type="number" min="1" max="60" value="${
          cfg.timeout ?? 10
        }" /></div>
            <div class="field" style="justify-content:flex-end;">
              <div class="toggle-wrap" style="margin-top:1.4rem;">
                <input type="checkbox" class="toggle" id="m-verify-ssl" ${
          cfg.verify_ssl ? 'checked' : ''
        } />
                <label for="m-verify-ssl" style="font-size:0.82rem;color:var(--color-text);">Verify SSL</label>
              </div>
            </div>
          </div>
        `;
      }
    };

    renderConfigFields(type);
    body.querySelector('#m-type').addEventListener(
      'change',
      (e) => renderConfigFields(e.target.value),
    );
    this.shadowRoot.getElementById('modal-overlay').classList.add('open');
  }

  _closeModal() {
    this.shadowRoot.getElementById('modal-overlay').classList.remove('open');
    this._editingId = null;
  }

  async _submitModal() {
    const sr = this.shadowRoot;
    clearFieldErrors(sr);
    const nameInput = sr.getElementById('m-name');
    const baseUrlInput = sr.getElementById('m-base-url');
    const usernameInput = sr.getElementById('m-username');
    const name = nameInput?.value.trim();
    const type = sr.getElementById('m-type')?.value;
    const enabled = sr.getElementById('m-enabled')?.checked ?? true;
    const baseUrl = baseUrlInput?.value.trim();
    const username = usernameInput?.value.trim();
    const password = sr.getElementById('m-password')?.value;
    const timeout = parseInt(sr.getElementById('m-timeout')?.value ?? '10');
    const verifySsl = sr.getElementById('m-verify-ssl')?.checked ?? false;

    // Config is stored as a free dict server-side, so these client checks are
    // what keep an integration from being saved without the fields it needs.
    let ok = true;
    if (!name) {
      setFieldError(nameInput, 'Name is required');
      ok = false;
    }
    if (!baseUrl) {
      setFieldError(baseUrlInput, 'Base URL is required');
      ok = false;
    }
    if (!username) {
      setFieldError(usernameInput, 'Username is required');
      ok = false;
    }
    if (!ok) return;

    const cfg = type === 'graylog'
      ? {
        base_url: baseUrl,
        username,
        password,
        stream_id: sr.getElementById('m-stream-id')?.value.trim() || null,
        nas_ip_field: sr.getElementById('m-nas-ip-field')?.value.trim() || 'source',
        username_field: sr.getElementById('m-username-field')?.value.trim() || '',
        timeout,
        verify_ssl: verifySsl,
      }
      : { base_url: baseUrl, username, password, timeout, verify_ssl: verifySsl };

    const payload = { name, type, config: cfg, enabled };
    try {
      if (this._editingId != null) {
        await api.put(`/integrations/${this._editingId}`, payload);
        toast('Integration updated', 'success');
      } else {
        await api.post('/integrations', payload);
        toast('Integration created', 'success');
      }
      this._closeModal();
      await this._loadIntegrations();
    } catch (e) {
      // Field-level 422s (name / type) map to their input; the duplicate-name
      // 409 is a string detail, so map it to the name field too.
      if (applyServerErrors(sr, e, (f) => sr.getElementById(`m-${f.replace(/_/g, '-')}`))) return;
      const msg = e.message ?? 'Save failed';
      if (/name already exists/i.test(msg)) setFieldError(nameInput, msg);
      else toast(msg, 'error');
    }
  }

  // ── Graylog tab ───────────────────────────────────────────────────────────

  _renderGraylogTab(tc) {
    tc.innerHTML = `
      <div class="search-bar">
        <div class="field">
          <label>NAS Device</label>
          <select class="select" id="gl-nas-select" style="min-width:200px;">
            <option value="">— Select NAS or type below —</option>
          </select>
        </div>
        <div class="field">
          <label>NAS IP <span style="font-weight:400;font-size:0.72rem;">(source field)</span></label>
          <input class="input" id="gl-nas-ip" placeholder="192.168.1.1" style="min-width:150px;" />
        </div>
        <div class="field">
          <label>NAS Name <span style="font-weight:400;font-size:0.72rem;">(name in message)</span></label>
          <input class="input" id="gl-nas-identifier" placeholder="SW-MCAST-DC-2nd" style="min-width:160px;" />
        </div>
        <div class="field"><label>Username <span style="font-weight:400;">(optional)</span></label><input class="input" id="gl-username" placeholder="any" style="min-width:120px;" /></div>
        <div class="field"><label>From (date)</label><input class="input" id="gl-since" type="date" /></div>
        <div class="field"><label>To <span style="font-weight:400;">(blank = now)</span></label><input class="input" id="gl-until" type="datetime-local" /></div>
        <div class="field"><label>Limit</label><input class="input" id="gl-limit" type="number" min="10" max="1000" value="200" style="width:80px;" /></div>
        <button class="btn btn-primary" id="gl-search" style="align-self:flex-end;">Search</button>
      </div>
      <div style="font-size:0.72rem;color:var(--color-muted);margin-bottom:0.75rem;">
        Tip: For Huawei/switches where <code>source</code> contains a date fragment, clear the NAS IP and use the NAS Name field to search by device hostname in the message.
      </div>
      <div class="info-bar" id="gl-info" style="display:none;">
        <span id="gl-count"></span>
        <span>
          <input type="checkbox" id="gl-autorefresh" style="margin-right:4px;" />
          <label for="gl-autorefresh" style="font-size:0.78rem;cursor:pointer;">Auto-refresh (10s)</label>
          <span class="refresh-dot" id="gl-dot" style="display:none;margin-left:6px;"></span>
        </span>
      </div>
      <div id="gl-results"></div>
    `;

    // Populate NAS dropdown if list is already loaded
    const select = tc.querySelector('#gl-nas-select');
    if (this._nasList.length) this._populateNasDropdown(select);

    select.addEventListener('change', () => {
      const opt = select.options[select.selectedIndex];
      if (opt.value) {
        const ipEl = tc.querySelector('#gl-nas-ip');
        const idEl = tc.querySelector('#gl-nas-identifier');
        if (ipEl) ipEl.value = opt.dataset.nasname || '';
        if (idEl) idEl.value = opt.dataset.shortname || '';
      }
    });

    tc.querySelector('#gl-search').addEventListener('click', () => this._runGraylogSearch(tc));
    tc.querySelector('#gl-autorefresh').addEventListener('change', (e) => {
      this.shadowRoot.getElementById('gl-dot').style.display = e.target.checked
        ? 'inline-block'
        : 'none';
      if (e.target.checked) {
        this._graylogStop = startPolling(() => this._runGraylogSearch(tc), 10000);
      } else {
        this._stopGraylogRefresh();
      }
    });
  }

  _prefillGraylog(params) {
    const tc = this.shadowRoot.getElementById('tab-content');
    if (!tc) return;
    const nasIp = params.get('nas_ip') || '';
    const nasIdentId = params.get('nas_identifier') || '';
    const username = params.get('username') || '';
    const since = params.get('since') || '';

    const ipEl = tc.querySelector('#gl-nas-ip');
    const idEl = tc.querySelector('#gl-nas-identifier');
    const userEl = tc.querySelector('#gl-username');
    const sinceEl = tc.querySelector('#gl-since');

    if (ipEl) ipEl.value = nasIp;
    if (idEl) idEl.value = nasIdentId;
    if (userEl) userEl.value = username;
    if (sinceEl && since) {
      const d = new Date(since);
      if (!isNaN(d)) {
        sinceEl.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(
          0,
          10,
        );
      }
    }

    // Auto-select NAS in dropdown and fill identifier if not already set
    if (nasIp && this._nasList.length) {
      const nas = this._nasList.find((n) => n.nasname === nasIp);
      if (nas) {
        const select = tc.querySelector('#gl-nas-select');
        if (select) select.value = String(nas.id);
        if (idEl && !nasIdentId && nas.shortname && nas.shortname !== nas.nasname) {
          idEl.value = nas.shortname;
        }
      }
    }

    if (nasIp || nasIdentId) this._runGraylogSearch(tc);
  }

  async _runGraylogSearch(tc) {
    if (this._graylogLoading) return;
    const nasIp = tc.querySelector('#gl-nas-ip')?.value.trim();
    const nasIdentifier = tc.querySelector('#gl-nas-identifier')?.value.trim();
    const username = tc.querySelector('#gl-username')?.value.trim();
    const sinceVal = tc.querySelector('#gl-since')?.value;
    const untilVal = tc.querySelector('#gl-until')?.value;
    const limit = parseInt(tc.querySelector('#gl-limit')?.value || '200');
    const results = this.shadowRoot.getElementById('gl-results');
    const infoBar = this.shadowRoot.getElementById('gl-info');

    if (!nasIp && !nasIdentifier) {
      toast('Enter NAS IP or NAS Name', 'error');
      return;
    }
    if (!sinceVal) {
      toast('"From" date is required', 'error');
      return;
    }

    this._graylogLoading = true;
    results.innerHTML = `<div class="empty">Fetching logs…</div>`;
    try {
      const params = new URLSearchParams({
        since: new Date(sinceVal + 'T00:00:00').toISOString(),
        limit: String(limit),
      });
      if (nasIp) params.set('nas_ip', nasIp);
      if (nasIdentifier) params.set('nas_identifier', nasIdentifier);
      if (username) params.set('username', username);
      if (untilVal) params.set('until', new Date(untilVal).toISOString());

      const data = await api.get(`/integrations/graylog/session-logs?${params}`);
      this._graylogResult = data;
      infoBar.style.display = 'flex';
      this.shadowRoot.getElementById('gl-count').textContent = `${data.count} log entries`;
      this._renderGraylogLogs(results, data.logs);
    } catch (e) {
      results.innerHTML = `<div class="empty" style="color:var(--color-danger);">${
        esc(e.message)
      }</div>`;
      infoBar.style.display = 'none';
    } finally {
      this._graylogLoading = false;
    }
  }

  _renderGraylogLogs(container, logs) {
    if (!logs.length) {
      container.innerHTML =
        `<div class="empty">No log entries found for the selected criteria.</div>`;
      return;
    }
    container.innerHTML = `
      <div class="log-wrap">
        ${
      logs.map((l, i) => {
        const lvl = LEVEL_LABELS[l.level] ?? String(l.level ?? '');
        const hasFields = Object.keys(l.fields || {}).length > 0;
        return `
            <div class="log-row">
              <span class="log-ts">${
          esc(l.timestamp ? new Date(l.timestamp).toLocaleString() : '—')
        }</span>
              <span class="log-lvl" style="color:${
          l.level != null && l.level <= 4 ? 'var(--color-danger)' : 'var(--color-muted)'
        };">${esc(lvl)}</span>
              <span class="log-msg">${esc(l.message)}</span>
              ${hasFields ? `<span class="log-expand" data-idx="${i}">+fields</span>` : ''}
            </div>
            ${
          hasFields
            ? `<div class="log-fields" id="log-fields-${i}">${
              esc(JSON.stringify(l.fields, null, 2))
            }</div>`
            : ''
        }
          `;
      }).join('')
    }
      </div>
    `;
    container.querySelectorAll('.log-expand').forEach((el) => {
      el.addEventListener('click', () => {
        const fEl = container.querySelector(`#log-fields-${el.dataset.idx}`);
        if (fEl) {
          fEl.classList.toggle('open');
          el.textContent = fEl.classList.contains('open') ? '-fields' : '+fields';
        }
      });
    });
  }

  _stopGraylogRefresh() {
    if (this._graylogStop) {
      this._graylogStop();
      this._graylogStop = null;
    }
  }

  // ── Zabbix tab ────────────────────────────────────────────────────────────

  _renderZabbixTab(tc) {
    tc.innerHTML = `
      <div class="search-bar">
        <div class="field"><label>NAS IP</label><input class="input" id="zb-nas-ip" placeholder="192.168.1.1" style="min-width:200px;" /></div>
        <button class="btn btn-primary" id="zb-search" style="align-self:flex-end;">Fetch Alarms</button>
      </div>
      <div id="zb-results"></div>
    `;
    tc.querySelector('#zb-search').addEventListener('click', () => this._runZabbixSearch(tc));
  }

  _prefillZabbix(params) {
    const tc = this.shadowRoot.getElementById('tab-content');
    if (!tc) return;
    const nasIp = params.get('nas_ip') || '';
    const nasEl = tc.querySelector('#zb-nas-ip');
    if (nasEl) nasEl.value = nasIp;
    if (nasIp) this._runZabbixSearch(tc);
  }

  async _runZabbixSearch(tc) {
    const nasIp = tc.querySelector('#zb-nas-ip')?.value.trim();
    const results = this.shadowRoot.getElementById('zb-results');
    if (!nasIp) {
      toast('NAS IP is required', 'error');
      return;
    }
    results.innerHTML = `<div class="empty">Fetching alarms…</div>`;
    try {
      const data = await api.get(
        `/integrations/zabbix/host-problems?nas_ip=${encodeURIComponent(nasIp)}`,
      );
      this._renderZabbixProblems(results, data.problems, nasIp);
    } catch (e) {
      results.innerHTML = `<div class="empty" style="color:var(--color-danger);">${
        esc(e.message)
      }</div>`;
    }
  }

  _renderZabbixProblems(container, problems, nasIp) {
    if (!problems.length) {
      container.innerHTML = `<div class="empty">No active alarms for <strong>${
        esc(nasIp)
      }</strong>.</div>`;
      return;
    }
    container.innerHTML = `
      <div style="font-size:0.78rem;color:var(--color-muted);margin-bottom:0.75rem;">${problems.length} active alarm(s) for ${
      esc(nasIp)
    }</div>
      <div class="card" style="padding:0;overflow:hidden;">
        <table>
          <thead><tr>
            <th>Severity</th>
            <th>Problem</th>
            <th>Host</th>
            <th>Since</th>
            <th>ACK</th>
          </tr></thead>
          <tbody>
            ${
      problems.map((p) => `
              <tr>
                <td><span style="font-weight:600;color:${
        SEVERITY_COLOR[p.severity] || 'inherit'
      };">${esc(p.severity)}</span></td>
                <td>${esc(p.name)}</td>
                <td style="color:var(--color-muted);">${esc(p.hostname)}</td>
                <td style="color:var(--color-muted);white-space:nowrap;">${fmtClock(p.clock)}</td>
                <td>${
        p.acknowledged
          ? '<span class="badge badge-ok">Yes</span>'
          : '<span class="badge badge-off">No</span>'
      }</td>
              </tr>
            `).join('')
    }
          </tbody>
        </table>
      </div>
    `;
  }
}

customElements.define('integrations-page', IntegrationsPage);

// Retired standalone route → redirect into the Alerting workspace tab so
// bookmarks keep working. The <integrations-page> element stays, hosted by the tab.
function _intRedirect(to) {
  queueMicrotask(() => router.navigate(to));
  const d = document.createElement('div');
  d.style.cssText = 'padding:2rem;color:var(--color-muted);font-size:0.8rem;';
  d.textContent = 'Redirecting…';
  return d;
}
router.register('/integrations', () => _intRedirect('/notifications?view=integrations'));
