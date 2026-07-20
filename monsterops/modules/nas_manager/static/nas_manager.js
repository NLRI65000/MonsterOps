import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';

const escHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(
    /"/g,
    '&quot;',
  );

function statusBadge(s) {
  const map = {
    connected: ['#22c55e', 'Connected'],
    failed: ['var(--color-danger)', 'Failed'],
    untested: ['var(--color-muted)', 'Untested'],
    pending: ['var(--color-accent)', 'Testing…'],
    unconfigured: ['var(--color-muted)', 'Not configured'],
    unsupported: ['var(--color-muted)', 'Unsupported vendor'],
  };
  const [color, label] = map[s] ?? ['var(--color-muted)', s ?? 'Unknown'];
  return `<span style="display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;font-weight:600;color:${color};">
    <span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block;"></span>${
    escHtml(label)
  }</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

class NasManagerView extends HTMLElement {
  connectedCallback() {
    // Embedded mode: driven to a single device by the /nas workspace via the
    // `forceNasId` property; renders detail only (list pane hidden by CSS).
    this._embedded = this.hasAttribute('embedded');
    this._nasList = []; // every NAS in the DB
    this._managerByNasId = {}; // nas_id -> manager config (if configured)
    this._vendorTypes = {}; // vendor -> [device_types]
    this._selectedNasId = null;
    // The /nas workspace can hand us `initialTab` (which sub-tab to open on) and
    // `embedTabs` (which sub-tabs to expose) so it can promote History/Console to
    // top-level device tabs.
    this._activeTab = this.initialTab || 'overview';
    this._configEdit = false;
    this._histSettingsOpen = false; // History settings panel collapsed by default
    this._cmdHistory = JSON.parse(localStorage.getItem('mr_nm_cmd_history') || '[]');
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = this._template();
    this._bind();
    this._load();
  }

  _template() {
    return `
<style>
  @import '/css/theme.css';
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :host { display: flex; height: 100%; font-size: .875rem; color: var(--color-text); }
  /* Embedded (inside the /nas workspace Manage tab): the workspace owns the
     device list and shows the device name in its own header, so hide our list
     pane and the redundant title — keep the status badge and action buttons. */
  :host([embedded]) .list-pane { display: none; }
  :host([embedded]) .detail-title { display: none; }

  /* Layout */
  .list-pane { width: 340px; min-width: 240px; border-right: 1px solid var(--color-border);
    display: flex; flex-direction: column; background: var(--color-surface); }
  .detail-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  /* List pane */
  .list-header { padding: .75rem 1rem; border-bottom: 1px solid var(--color-border);
    display: flex; align-items: center; gap: .5rem; }
  .list-header h2 { flex: 1; font-size: .95rem; font-weight: 600; }
  .list-search { padding: .5rem .75rem; border-bottom: 1px solid var(--color-border); }
  .list-search input { width: 100%; }
  .list-scroll { flex: 1; overflow-y: auto; }
  .device-row { padding: .65rem 1rem; border-bottom: 1px solid var(--color-border);
    cursor: pointer; transition: background .1s; }
  .device-row:hover { background: var(--color-bg); }
  .device-row.active { background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    border-left: 3px solid var(--color-accent); }
  .device-row.unsupported { opacity: .55; }
  .device-name { font-weight: 600; font-size: .85rem; }
  .device-meta { font-size: .72rem; color: var(--color-muted); margin-top: .15rem;
    display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  .badge-vendor { background: var(--color-border); border-radius: 4px; padding: .1rem .35rem;
    font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; }

  /* Detail pane header */
  .detail-header { padding: .75rem 1.25rem; border-bottom: 1px solid var(--color-border);
    display: flex; align-items: center; gap: .75rem; background: var(--color-surface); flex-wrap: wrap; }
  .detail-title { flex: 1; font-size: .95rem; font-weight: 600; min-width: 140px; }

  /* Tabs */
  .tabs { display: flex; border-bottom: 1px solid var(--color-border);
    background: var(--color-surface); padding: 0 1.25rem; }
  .tab { padding: .6rem .9rem; cursor: pointer; font-size: .8rem; font-weight: 500;
    color: var(--color-muted); border-bottom: 2px solid transparent; transition: color .15s; }
  .tab.active { color: var(--color-accent); border-bottom-color: var(--color-accent); }
  .tab-content { flex: 1; overflow-y: auto; padding: 1.25rem; }

  /* Buttons */
  .btn { border: none; border-radius: 6px; padding: .45rem .9rem; font-size: .8rem;
    font-weight: 500; cursor: pointer; transition: background .15s; font-family: inherit; }
  .btn-primary { background: var(--color-accent); color: #fff; }
  .btn-primary:hover { background: var(--color-accent-hover); }
  .btn-secondary { background: var(--color-border); color: var(--color-text); }
  .btn-secondary:hover { background: var(--color-muted); color: #fff; }
  .btn-danger { background: var(--color-danger); color: #fff; }
  .btn-sm { padding: .3rem .65rem; font-size: .75rem; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }

  /* Form */
  .cred-form { max-width: 480px; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
  .field { display: flex; flex-direction: column; gap: .3rem; }
  .field.span2 { grid-column: span 2; }
  label { font-size: .75rem; color: var(--color-muted); font-weight: 500; }
  input, select, textarea {
    background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 6px;
    color: var(--color-text); padding: .45rem .65rem; font-size: .82rem; font-family: inherit;
    transition: border-color .15s; width: 100%; }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--color-accent); }
  textarea { resize: vertical; min-height: 120px; font-family: 'IBM Plex Mono', monospace; font-size: .78rem; }
  .advanced { margin-top: .75rem; border: 1px solid var(--color-border); border-radius: 8px; padding: .5rem .75rem; }
  .advanced summary { cursor: pointer; font-size: .78rem; color: var(--color-muted); font-weight: 500; }
  .advanced[open] summary { margin-bottom: .75rem; }
  .form-actions { display: flex; gap: .5rem; margin-top: 1rem; }
  .cred-hint { font-size: .75rem; color: var(--color-muted); margin-bottom: 1rem; line-height: 1.5; }

  /* History settings (collapsible) + toolbar + compare */
  .hist-settings { border: 1px solid var(--color-border); border-radius: 8px; margin-bottom: 1rem; }
  .hist-summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: .6rem;
    padding: .55rem .85rem; font-size: .82rem; user-select: none; }
  .hist-summary::-webkit-details-marker { display: none; }
  .hist-summary::before { content: '▸'; color: var(--color-muted); transition: transform .15s; }
  .hist-settings[open] .hist-summary::before { transform: rotate(90deg); }
  .hist-summary-title { font-weight: 600; }
  .hist-summary-status { color: var(--color-muted); font-size: .76rem; }
  .hist-body { display: flex; align-items: flex-end; gap: .75rem; flex-wrap: wrap;
    padding: .75rem .85rem .85rem; border-top: 1px solid var(--color-border); }
  .hist-body .field { min-width: 120px; }
  .hist-body select { width: auto; }
  .hist-toggle { display: flex; align-items: center; gap: .4rem; font-size: .82rem; color: var(--color-text);
    cursor: pointer; white-space: nowrap; padding-bottom: .35rem; }
  .hist-toggle input { width: auto; }
  .hist-toolbar { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: .5rem; }
  .hist-compare { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .hist-compare select { width: auto; max-width: 240px; }

  /* Diff view */
  .diff-summary { font-family: 'IBM Plex Mono', monospace; font-size: .78rem; display: flex; gap: .6rem;
    align-items: center; padding: .4rem 0; }
  .diff-view { background: #0f0f0f; border-radius: 8px; padding: .5rem 0; overflow: auto; max-height: 460px;
    font-family: 'IBM Plex Mono', monospace; font-size: .75rem; line-height: 1.5; }
  .diff-view > div { padding: 0 .75rem; white-space: pre-wrap; word-break: break-all; }
  .diff-add { background: rgba(34,197,94,.14); color: #4ade80; }
  .diff-del { background: rgba(239,68,68,.14); color: #f87171; }
  .diff-hunk { color: #38bdf8; }
  .diff-file { color: var(--color-muted); }
  .diff-ctx { color: #b4b4b4; }

  /* Info grid */
  .info-grid { display: grid; grid-template-columns: 140px 1fr; gap: .4rem .75rem; font-size: .82rem; }
  .info-label { color: var(--color-muted); font-size: .75rem; font-weight: 500; align-self: center; }

  /* Config viewer — fills the available height of the tab */
  .config-wrap { display: flex; flex-direction: column; height: 100%; }
  .config-head { flex: 0 0 auto; display: flex; align-items: center; gap: .5rem; margin-bottom: .75rem; }
  .config-viewer { flex: 1 1 auto; min-height: 0; background: var(--color-bg);
    border: 1px solid var(--color-border); border-radius: 8px; padding: .75rem 1rem;
    font-family: 'IBM Plex Mono', monospace; font-size: .78rem; line-height: 1.55;
    white-space: pre-wrap; overflow: auto; color: var(--color-text); }
  textarea.config-edit { flex: 1 1 auto; min-height: 0; }

  /* Command console */
  .cmd-bar { display: flex; gap: .5rem; margin-bottom: .75rem; }
  .cmd-input { flex: 1; font-family: 'IBM Plex Mono', monospace; }
  .cmd-output { background: #0f0f0f; color: #d4d4d4; border-radius: 8px;
    padding: .75rem 1rem; font-family: 'IBM Plex Mono', monospace; font-size: .78rem;
    line-height: 1.55; white-space: pre-wrap; min-height: 120px; max-height: 400px; overflow-y: auto; }
  .cmd-history { font-size: .72rem; color: var(--color-muted); margin-top: .5rem; }
  .cmd-history span { cursor: pointer; text-decoration: underline; margin-right: .5rem; }
  .cmd-history span:hover { color: var(--color-accent); }

  /* Dispatch */
  .dispatch-table { width: 100%; border-collapse: collapse; font-size: .8rem; }
  .dispatch-table th, .dispatch-table td { text-align: left; padding: .4rem .6rem;
    border-bottom: 1px solid var(--color-border); }
  .dispatch-table th { font-size: .7rem; font-weight: 600; color: var(--color-muted);
    text-transform: uppercase; letter-spacing: .04em; }

  /* Empty / notice */
  .empty { text-align: center; padding: 3rem 1rem; color: var(--color-muted); font-size: .85rem; }
  .notice { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 8px;
    padding: 1rem 1.25rem; font-size: .82rem; color: var(--color-muted); line-height: 1.6; }

  /* RADIUS Setup (one-click config deploy) */
  .rd-intro { font-size: .82rem; color: var(--color-muted); line-height: 1.6; margin: 0 0 .9rem; }
  .rd-warn { border-color: var(--color-danger); color: var(--color-text); margin-bottom: .9rem; }
  .rd-form { display: flex; flex-direction: column; gap: .9rem; max-width: 560px; }
  .rd-field { display: flex; flex-direction: column; gap: .3rem; }
  .rd-field > label { font-size: .72rem; font-weight: 600; color: var(--color-muted);
    text-transform: uppercase; letter-spacing: .04em; }
  .rd-field input, .rd-field select { padding: .45rem .6rem; border: 1px solid var(--color-border);
    border-radius: 6px; background: var(--color-bg); color: var(--color-text); font-size: .82rem; }
  .rd-ports { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
  .rd-svcs { display: flex; flex-direction: column; gap: .4rem; }
  .rd-svc { display: flex; align-items: center; gap: .5rem; font-size: .82rem; cursor: pointer; }
  .rd-svc input { width: auto; }
  .rd-actions { display: flex; gap: .5rem; margin-top: .25rem; }
  .rd-preview-head { font-size: .78rem; color: var(--color-muted); margin: 1.1rem 0 .4rem; }
  .rd-lines { background: #0f0f0f; color: #d4d4d4; border-radius: 8px; padding: .75rem 1rem;
    font-family: 'IBM Plex Mono', monospace; font-size: .78rem; line-height: 1.55;
    white-space: pre-wrap; overflow: auto; margin: 0; }
  .rd-notes { margin: .6rem 0 0; padding-left: 1.1rem; font-size: .78rem; color: var(--color-muted);
    line-height: 1.55; }
  .rd-notes li { margin-bottom: .3rem; }
</style>

<!-- Left: every NAS in the DB -->
<div class="list-pane">
  <div class="list-header">
    <h2>NAS Devices</h2>
    <button class="btn btn-secondary btn-sm" id="btn-refresh" title="Reload">↻</button>
  </div>
  <div class="list-search">
    <input type="search" id="list-search" placeholder="Filter by name or IP…" />
  </div>
  <div class="list-scroll" id="list-scroll"></div>
</div>

<!-- Right: detail -->
<div class="detail-pane" id="detail-pane">
  <div class="empty" style="margin:auto;">Select a NAS device from the list</div>
</div>
`;
  }

  _bind() {
    const sr = this.shadowRoot;
    sr.getElementById('btn-refresh').addEventListener('click', () => this._load());
    sr.getElementById('list-search').addEventListener('input', (e) => {
      this._filter = e.target.value.trim().toLowerCase();
      this._renderList();
    });
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  async _load() {
    try {
      const [nasList, managers, vendorTypes] = await Promise.all([
        this._fetchAllNas(),
        api.get('/nas-manager'),
        api.get('/nas-manager/vendor-types'),
      ]);
      this._nasList = nasList;
      this._managerByNasId = Object.fromEntries(managers.map((m) => [m.nas_id, m]));
      this._vendorTypes = Object.fromEntries(vendorTypes.map((v) => [v.vendor, v.device_types]));
      this._renderList();
      if (this._embedded && this.forceNasId != null && this._selectedNasId == null) {
        this._selectNas(this.forceNasId);
      } else if (this._selectedNasId != null) {
        this._renderDetail();
      }
    } catch (err) {
      toast('Failed to load NAS Manager: ' + (err.message ?? err), 'error');
    }
  }

  async _fetchAllNas() {
    // The NAS list endpoint paginates (max 100/page); walk all pages.
    const first = await api.get('/nas?page=1&size=100');
    let items = first.items ?? [];
    const total = first.total ?? items.length;
    let page = 2;
    while (items.length < total) {
      const next = await api.get(`/nas?page=${page}&size=100`);
      if (!next.items?.length) break;
      items = items.concat(next.items);
      page += 1;
    }
    return items;
  }

  // Resolve a free-form NAS `type` to a supported vendor key. Matches the
  // backend resolve_vendor(): exact slug first, then substring containment so
  // legacy labels like "Mikrotik RouterOS" still resolve to "mikrotik".
  _resolveVendor(type) {
    const t = (type || '').trim().toLowerCase();
    if (!t) return null;
    if (Array.isArray(this._vendorTypes[t])) return t;
    for (const vendor of Object.keys(this._vendorTypes)) {
      if (t.includes(vendor)) return vendor;
    }
    return null;
  }

  _vendorSupported(type) {
    const v = this._resolveVendor(type);
    return !!v && this._vendorTypes[v].length > 0;
  }

  _rowStatus(nas) {
    if (!this._vendorSupported(nas.type)) return 'unsupported';
    const mgr = this._managerByNasId[nas.id];
    if (!mgr) return 'unconfigured';
    return mgr.test_status || 'untested';
  }

  // ── List rendering ─────────────────────────────────────────────────────────

  _renderList() {
    const el = this.shadowRoot.getElementById('list-scroll');
    let rows = this._nasList;
    if (this._filter) {
      rows = rows.filter((n) =>
        (n.shortname || '').toLowerCase().includes(this._filter) ||
        (n.nasname || '').toLowerCase().includes(this._filter)
      );
    }
    if (!rows.length) {
      el.innerHTML = `<div class="empty">${
        this._nasList.length
          ? 'No NAS matches your filter.'
          : 'No NAS devices in the database yet.<br>Add one under <strong>NAS Devices</strong> first.'
      }</div>`;
      return;
    }
    el.innerHTML = rows.map((n) => {
      const status = this._rowStatus(n);
      return `
      <div class="device-row${this._selectedNasId === n.id ? ' active' : ''}${
        status === 'unsupported' ? ' unsupported' : ''
      }" data-id="${n.id}">
        <div class="device-name">${escHtml(n.shortname || n.nasname)}</div>
        <div class="device-meta">
          <span class="badge-vendor">${escHtml(n.type || '—')}</span>
          <span>${escHtml(n.nasname || '')}</span>
          ${statusBadge(status)}
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('.device-row').forEach((row) => {
      row.addEventListener('click', () => this._selectNas(parseInt(row.dataset.id)));
    });
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  _selectNas(nasId) {
    this._selectedNasId = nasId;
    this._configEdit = false;
    this._activeTab = this.initialTab || 'overview';
    this._renderList();
    this._renderDetail();
  }

  get _selectedNas() {
    return this._nasList.find((n) => n.id === this._selectedNasId) || null;
  }

  get _selectedManager() {
    return this._managerByNasId[this._selectedNasId] || null;
  }

  _renderDetail() {
    const nas = this._selectedNas;
    const pane = this.shadowRoot.getElementById('detail-pane');
    if (!nas) {
      pane.innerHTML =
        `<div class="empty" style="margin:auto;">Select a NAS device from the list</div>`;
      return;
    }

    // Unsupported vendor → nothing to manage over SSH/Telnet.
    if (!this._vendorSupported(nas.type)) {
      const supported = Object.keys(this._vendorTypes).sort().join(', ');
      pane.innerHTML = `
        <div class="detail-header"><div class="detail-title">${
        escHtml(nas.shortname || nas.nasname)
      }</div></div>
        <div class="tab-content">
          <div class="notice">
            <strong>SSH/Telnet management is not available for this NAS.</strong><br>
            Its vendor type is <code>${
        escHtml(nas.type || 'other')
      }</code>, which has no Netmiko mapping.
            To manage a device here, set its type to one of: ${escHtml(supported)} on the
            <a href="#/nas" style="color:var(--color-accent)">NAS Devices</a> page.
          </div>
        </div>`;
      return;
    }

    const mgr = this._selectedManager;

    // Not yet configured → show the credentials form directly.
    if (!mgr) {
      pane.innerHTML = `
        <div class="detail-header">
          <div class="detail-title">${escHtml(nas.shortname || nas.nasname)}</div>
          ${statusBadge('unconfigured')}
        </div>
        <div class="tab-content" id="tab-content"></div>`;
      this._renderCredentials();
      return;
    }

    // Configured → full management surface. When embedded, the /nas workspace
    // may hand us a reduced `embedTabs` set (it promotes History/Console to its
    // own top-level device tabs); a single entry renders that panel solo, with
    // no internal tab bar, since the workspace tabs already do the switching.
    const ALL_TABS = [
      ['overview', 'Overview'],
      ['config', 'Configuration'],
      ['radius', 'RADIUS Setup'],
      ['history', 'History'],
      ['console', 'Console'],
      ['dispatch', 'Command Log'],
      ['credentials', 'Credentials'],
    ];
    const shownTabs = Array.isArray(this.embedTabs)
      ? ALL_TABS.filter(([id]) => this.embedTabs.includes(id))
      : ALL_TABS;
    if (!shownTabs.some(([id]) => id === this._activeTab)) {
      this._activeTab = (shownTabs[0] || ['overview'])[0];
    }
    const soloTab = shownTabs.length <= 1;
    const tabsHtml = soloTab ? '' : `
      <div class="tabs">
        ${
      shownTabs.map(([id, label]) =>
        `<div class="tab${this._activeTab === id ? ' active' : ''}" data-tab="${id}">${label}</div>`
      ).join('')
    }
      </div>`;

    pane.innerHTML = `
      <div class="detail-header">
        <div class="detail-title">${escHtml(nas.shortname || nas.nasname)}</div>
        ${statusBadge(mgr.test_status)}
        <button class="btn btn-secondary btn-sm" id="btn-test">Test Connection</button>
        <button class="btn btn-danger btn-sm" id="btn-delete">Stop Managing</button>
      </div>
      ${tabsHtml}
      <div class="tab-content" id="tab-content"></div>
    `;
    pane.querySelector('#btn-test').addEventListener('click', () => this._testConnection());
    pane.querySelector('#btn-delete').addEventListener('click', () => this._deleteManager());
    pane.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => {
        this._activeTab = t.dataset.tab;
        this._renderDetail();
      });
    });
    this._renderTab();
  }

  _renderTab() {
    const tab = this._activeTab || 'overview';
    if (tab === 'overview') this._renderOverview();
    else if (tab === 'config') this._renderConfig();
    else if (tab === 'radius') this._renderRadiusDeploy();
    else if (tab === 'history') this._renderHistory();
    else if (tab === 'console') this._renderConsole();
    else if (tab === 'dispatch') this._renderDispatchLog();
    else if (tab === 'credentials') this._renderCredentials();
  }

  // ── Credentials form (enable / edit management) ──────────────────────────────

  _renderCredentials() {
    const nas = this._selectedNas;
    const mgr = this._selectedManager;
    const isNew = !mgr;
    const vendor = this._resolveVendor(nas.type);
    const deviceTypes = this._vendorTypes[vendor] || [];
    const connType = mgr?.conn_type || 'ssh';
    const defaultHost = (nas.nasname || '').split('/')[0];
    const defaultPort = mgr?.port || (connType === 'telnet' ? 23 : 22);
    const currentDT = mgr ? mgr.netmiko_device_type.replace('_telnet', '') : (deviceTypes[0] || '');

    const tc = this.shadowRoot.getElementById('tab-content');
    tc.innerHTML = `
      <div class="cred-form">
        <div class="cred-hint">
          ${
      isNew
        ? `Enter SSH/Telnet credentials to start managing <strong>${
          escHtml(nas.shortname || nas.nasname)
        }</strong>.
               The management IP (<code>${
          escHtml(defaultHost)
        }</code>) and device type are taken from the NAS record —
               override them under Advanced only if needed.`
        : `Update the stored credentials. Leave the password blank to keep the current one.`
    }
        </div>
        <div class="form-grid">
          <div class="field">
            <label>Connection Type</label>
            <select id="c-conn-type">
              <option value="ssh"${connType === 'ssh' ? ' selected' : ''}>SSH</option>
              <option value="telnet"${connType === 'telnet' ? ' selected' : ''}>Telnet</option>
            </select>
          </div>
          <div class="field">
            <label>Username</label>
            <input id="c-username" type="text" placeholder="admin" value="${
      escHtml(mgr?.username || '')
    }" />
          </div>
          <div class="field span2">
            <label>Password${isNew ? '' : ' (leave blank to keep current)'}</label>
            <input id="c-password" type="password" placeholder="••••••••" autocomplete="new-password" />
          </div>
        </div>
        <details class="advanced">
          <summary>Advanced — connection overrides</summary>
          <div class="form-grid">
            <div class="field">
              <label>Management Host / IP</label>
              <input id="c-host" type="text" value="${escHtml(mgr?.host || defaultHost)}" />
            </div>
            <div class="field">
              <label>Port</label>
              <input id="c-port" type="number" min="1" max="65535" value="${
      escHtml(defaultPort)
    }" />
            </div>
            <div class="field span2">
              <label>Netmiko Device Type</label>
              <select id="c-device-type">
                ${
      deviceTypes.map((t) =>
        `<option value="${t}"${t === currentDT ? ' selected' : ''}>${t}</option>`
      ).join('')
    }
              </select>
            </div>
          </div>
        </details>
        <div class="form-actions">
          <button class="btn btn-primary" id="c-save">${
      isNew ? 'Connect & Manage' : 'Save Credentials'
    }</button>
          ${
      isNew ? '' : `<button class="btn btn-secondary" id="c-cancel">Back to Overview</button>`
    }
        </div>
      </div>
    `;

    tc.querySelector('#c-conn-type').addEventListener('change', (e) => {
      const p = tc.querySelector('#c-port');
      // Only auto-swap the port if it still holds the other protocol's default.
      if (p.value === '22' || p.value === '23') p.value = e.target.value === 'telnet' ? '23' : '22';
    });
    tc.querySelector('#c-save').addEventListener('click', () => this._saveCredentials(isNew));
    tc.querySelector('#c-cancel')?.addEventListener('click', () => {
      this._activeTab = 'overview';
      this._renderDetail();
    });
  }

  async _saveCredentials(isNew) {
    const tc = this.shadowRoot.getElementById('tab-content');
    const connType = tc.querySelector('#c-conn-type').value;
    const username = tc.querySelector('#c-username').value.trim();
    const password = tc.querySelector('#c-password').value;
    const host = tc.querySelector('#c-host').value.trim();
    const port = parseInt(tc.querySelector('#c-port').value);
    const deviceType = tc.querySelector('#c-device-type').value;

    if (!username) {
      toast('Username is required', 'error');
      return;
    }
    if (isNew && !password) {
      toast('Password is required to start managing this NAS', 'error');
      return;
    }

    const payload = {
      conn_type: connType,
      username,
      host,
      port,
      netmiko_device_type: deviceType,
      enabled: true,
    };
    if (password) payload.password = password;

    const btn = tc.querySelector('#c-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const updated = await api.post(`/nas-manager/${this._selectedNasId}`, payload);
      this._managerByNasId[this._selectedNasId] = updated;
      toast(
        isNew ? 'Now managing this NAS — testing connection…' : 'Credentials updated',
        'success',
      );
      this._activeTab = 'overview';
      this._renderList();
      this._renderDetail();
      setTimeout(() => this._refreshManager(), 3000);
    } catch (err) {
      toast(err.message ?? 'Save failed', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = isNew ? 'Connect & Manage' : 'Save Credentials';
    }
  }

  // ── Overview ─────────────────────────────────────────────────────────────────

  _renderOverview() {
    const d = this._selectedManager;
    const tc = this.shadowRoot.getElementById('tab-content');
    tc.innerHTML = `
      <div class="info-grid">
        <div class="info-label">NAS IP</div><div>${escHtml(d.nas_ip)}</div>
        <div class="info-label">Vendor</div><div>${escHtml(d.nas_vendor || '—')}</div>
        <div class="info-label">Device Type</div><div style="font-family:monospace">${
      escHtml(d.netmiko_device_type)
    }</div>
        <div class="info-label">Host</div><div style="font-family:monospace">${
      escHtml(d.host)
    }</div>
        <div class="info-label">Port</div><div>${escHtml(d.port)}</div>
        <div class="info-label">Connection</div><div>${escHtml(d.conn_type.toUpperCase())}</div>
        <div class="info-label">Username</div><div>${escHtml(d.username)}</div>
        <div class="info-label">Status</div><div>${statusBadge(d.test_status)}</div>
        <div class="info-label">Last Tested</div><div>${fmtDate(d.last_tested_at)}</div>
        ${
      d.test_error
        ? `<div class="info-label" style="color:var(--color-danger)">Error</div><div style="color:var(--color-danger);font-size:.75rem;font-family:monospace">${
          escHtml(d.test_error)
        }</div>`
        : ''
    }
        <div class="info-label">Config Age</div><div>${
      d.config_pulled_at ? fmtDate(d.config_pulled_at) : 'Not pulled'
    }</div>
        <div class="info-label">Config Pushed</div><div>${
      d.config_pushed_at ? fmtDate(d.config_pushed_at) : '—'
    }</div>
        <div class="info-label">Enabled</div><div>${d.enabled ? 'Yes' : 'No'}</div>
      </div>
      ${
      d.test_error
        ? `<div style="margin-top:.75rem;font-size:.75rem;color:var(--color-muted)">Check the <a href="#/system" style="color:var(--color-accent)">App Log</a> for the full stack trace.</div>`
        : ''
    }
    `;
  }

  // ── RADIUS Setup (one-click config deploy) ───────────────────────────────────

  async _renderRadiusDeploy() {
    const tc = this.shadowRoot.getElementById('tab-content');
    const nasId = this._selectedNasId;
    tc.innerHTML = `<div style="color:var(--color-muted);font-size:.8rem;">Loading…</div>`;
    let opts;
    try {
      opts = await api.get(`/nas-manager/${nasId}/radius-deploy/options`);
    } catch (err) {
      tc.innerHTML = `<div style="color:var(--color-danger)">${escHtml(err.message)}</div>`;
      return;
    }

    const svcRows = opts.services.map((s) => `
      <label class="rd-svc">
        <input type="checkbox" class="rd-svc-cb" value="${escHtml(s.key)}" ${
      s.default ? 'checked' : ''
    }>
        <span>${escHtml(s.label)}</span>
      </label>`).join('');

    const secretWarn = opts.secret_present ? '' : `
      <div class="notice rd-warn">This NAS has no RADIUS shared secret stored, so the generated
        config would not authenticate. Set a secret on the
        <a href="#/nas" style="color:var(--color-accent)">NAS Devices</a> page first.</div>`;

    const genericWarn = opts.pushable ? '' : `
      <div class="notice rd-warn">Vendor <code>${
      escHtml(opts.vendor)
    }</code> has no pushable template — this preview is a reference to copy into the device by hand.</div>`;

    const variantField = (opts.variants && opts.variants.length)
      ? `
          <div class="rd-field">
            <label>Device CLI version</label>
            <select id="rd-variant">${
        opts.variants.map((v) => `<option value="${escHtml(v.key)}">${escHtml(v.label)}</option>`)
          .join('')
      }</select>
          </div>`
      : '';

    tc.innerHTML = `
      <div class="rd-wrap">
        <p class="rd-intro">Point this NAS at <strong>this RADIUS server</strong>. Tick the services
          that should authenticate against RADIUS, review the exact lines, then deploy — the running
          config is snapshotted first for rollback.</p>
        ${secretWarn}${genericWarn}
        <div class="rd-form">
          <div class="rd-field">
            <label>RADIUS server address</label>
            <input id="rd-ip" value="${escHtml(opts.suggested_server_ip || '')}"
              placeholder="enter this server's IP">
          </div>
          ${variantField}
          <div class="rd-ports">
            <div class="rd-field"><label>Auth port</label>
              <input id="rd-authp" type="number" value="${escHtml(opts.auth_port)}"></div>
            <div class="rd-field"><label>Acct port</label>
              <input id="rd-acctp" type="number" value="${escHtml(opts.acct_port)}"></div>
          </div>
          <div class="rd-field">
            <label>Services</label>
            <div class="rd-svcs">${
      svcRows || '<span style="color:var(--color-muted)">No services</span>'
    }</div>
          </div>
          <div class="rd-actions">
            <button class="btn btn-secondary btn-sm" id="rd-preview">Preview</button>
            ${
      opts.pushable
        ? `<button class="btn btn-primary btn-sm" id="rd-deploy" ${
          opts.secret_present ? '' : 'disabled'
        }>Deploy to device</button>`
        : ''
    }
          </div>
        </div>
        <div id="rd-output"></div>
      </div>`;

    tc.querySelector('#rd-preview').addEventListener('click', () => this._radiusPreview());
    tc.querySelector('#rd-deploy')?.addEventListener('click', () => this._radiusDeploy());
  }

  _radiusBody() {
    const tc = this.shadowRoot.getElementById('tab-content');
    const services = Array.from(tc.querySelectorAll('.rd-svc-cb'))
      .filter((c) => c.checked).map((c) => c.value);
    const variantSel = tc.querySelector('#rd-variant');
    return {
      services,
      server_ip: tc.querySelector('#rd-ip').value.trim() || null,
      auth_port: parseInt(tc.querySelector('#rd-authp').value, 10) || 1812,
      acct_port: parseInt(tc.querySelector('#rd-acctp').value, 10) || 1813,
      variant: variantSel ? variantSel.value : null,
    };
  }

  _renderRadiusOutput(data) {
    const out = this.shadowRoot.getElementById('rd-output');
    if (!out) return;
    const linesBlock = data.lines.length
      ? `<pre class="rd-lines">${escHtml(data.lines.join('\n'))}</pre>`
      : `<div style="color:var(--color-muted);font-size:.8rem;">No pushable lines for this vendor — see notes below.</div>`;
    const notesBlock = data.notes.length
      ? `<ul class="rd-notes">${data.notes.map((n) => `<li>${escHtml(n)}</li>`).join('')}</ul>`
      : '';
    out.innerHTML = `
      <div class="rd-preview-head">Config for <code>${escHtml(data.vendor)}</code> → ${
      escHtml(data.server_ip)
    }</div>
      ${linesBlock}${notesBlock}`;
  }

  async _radiusPreview() {
    try {
      const data = await api.post(
        `/nas-manager/${this._selectedNasId}/radius-deploy/preview`,
        this._radiusBody(),
      );
      this._renderRadiusOutput(data);
    } catch (err) {
      toast(err.message ?? 'Preview failed', 'error');
    }
  }

  async _radiusDeploy() {
    const body = this._radiusBody();
    if (!body.services.length) {
      toast('Select at least one service', 'error');
      return;
    }
    if (
      !(await confirmDialog(
        'Push the generated RADIUS config to this device now? The running config is snapshotted first for rollback.',
        { title: 'Deploy RADIUS config' },
      ))
    ) return;
    try {
      const r = await api.post(`/nas-manager/${this._selectedNasId}/radius-deploy`, body);
      toast(`Deployed ${r.pushed} line(s)${r.snapshotted ? ' · snapshot saved' : ''}`, 'success');
    } catch (err) {
      toast(err.message ?? 'Deploy failed', 'error');
    }
  }

  // ── Configuration ────────────────────────────────────────────────────────────

  async _renderConfig() {
    const d = this._selectedManager;
    const tc = this.shadowRoot.getElementById('tab-content');
    tc.innerHTML = `<div style="color:var(--color-muted);font-size:.8rem;">Loading config…</div>`;
    try {
      const data = await api.get(`/nas-manager/${d.nas_id}/config`);
      this._configData = data;
      this._renderConfigPanel(data);
    } catch (err) {
      tc.innerHTML = `<div style="color:var(--color-danger)">${escHtml(err.message)}</div>`;
    }
  }

  _renderConfigPanel(data) {
    const tc = this.shadowRoot.getElementById('tab-content');
    const hasCfg = !!data.raw_config;
    tc.innerHTML = `
      <div class="config-wrap">
        <div class="config-head">
          <div style="flex:1;font-size:.75rem;color:var(--color-muted)">
            ${hasCfg ? `Pulled ${fmtDate(data.config_pulled_at)}` : 'No config stored yet'}
            ${data.config_pushed_at ? ` · Pushed ${fmtDate(data.config_pushed_at)}` : ''}
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-repull">Re-pull</button>
          ${
      hasCfg
        ? `<button class="btn btn-secondary btn-sm" id="btn-toggle-edit">${
          this._configEdit ? 'Cancel Edit' : 'Edit'
        }</button>`
        : ''
    }
          ${
      this._configEdit
        ? `<button class="btn btn-primary btn-sm" id="btn-push">Push to Device</button>`
        : ''
    }
        </div>
        ${
      this._configEdit
        ? `<textarea id="config-edit-area" class="config-edit">${
          escHtml(data.raw_config || '')
        }</textarea>`
        : `<div class="config-viewer">${
          hasCfg
            ? escHtml(data.raw_config)
            : '<span style="color:var(--color-muted)">Click Re-pull to fetch configuration from device</span>'
        }</div>`
    }
      </div>
    `;
    tc.querySelector('#btn-repull')?.addEventListener('click', () => this._repullConfig());
    tc.querySelector('#btn-toggle-edit')?.addEventListener('click', () => {
      this._configEdit = !this._configEdit;
      this._renderConfigPanel(this._configData);
    });
    tc.querySelector('#btn-push')?.addEventListener('click', () => this._pushConfig());
  }

  async _repullConfig() {
    try {
      await api.post(`/nas-manager/${this._selectedNasId}/pull-config`, {});
      toast('Config pull started — refresh in a moment', 'success');
    } catch (err) {
      toast(err.message ?? 'Pull failed', 'error');
    }
  }

  async _pushConfig() {
    const tc = this.shadowRoot.getElementById('tab-content');
    const area = tc.querySelector('#config-edit-area');
    if (!area) return;
    const config = area.value;
    if (!config.trim()) {
      toast('Config is empty', 'error');
      return;
    }
    if (
      !(await confirmDialog(
        'Push this config to the device? This will apply the changes immediately.',
        { title: 'Push config' },
      ))
    ) return;
    try {
      await api.post(`/nas-manager/${this._selectedNasId}/push-config`, { config });
      toast('Config pushed successfully', 'success');
      this._configEdit = false;
      await this._renderConfig();
    } catch (err) {
      toast(err.message ?? 'Push failed', 'error');
    }
  }

  // ── History (config versions + diff) ─────────────────────────────────────────

  async _renderHistory() {
    const d = this._selectedManager;
    const tc = this.shadowRoot.getElementById('tab-content');
    tc.innerHTML = `<div style="color:var(--color-muted);font-size:.8rem;">Loading history…</div>`;

    let versions = [];
    try {
      versions = await api.get(`/nas-manager/${d.nas_id}/config-versions`);
    } catch (err) {
      tc.innerHTML = `<div style="color:var(--color-danger)">${escHtml(err.message)}</div>`;
      return;
    }
    this._versions = versions;

    const intervalOpts = [
      [0, 'Manual only'],
      [1, 'Every hour'],
      [6, 'Every 6 hours'],
      [12, 'Every 12 hours'],
      [24, 'Daily'],
      [168, 'Weekly'],
    ];
    const retentionOpts = [
      [0, 'Keep forever'],
      [7, '7 days'],
      [30, '30 days'],
      [90, '90 days'],
      [365, '1 year'],
    ];
    const opt = (val, label, sel) =>
      `<option value="${val}"${val === sel ? ' selected' : ''}>${label}</option>`;
    const labelFor = (opts, val) => (opts.find(([v]) => v === val) || [0, '—'])[1];

    // version reference options for the compare selectors ("current" + each version)
    const refOptions = [
      `<option value="current">Current (live)</option>`,
      ...versions.map((v) =>
        `<option value="${v.id}">${new Date(v.created_at).toLocaleString()} · ${v.source}</option>`
      ),
    ].join('');

    const status = d.history_enabled
      ? `On · ${labelFor(intervalOpts, d.fetch_interval_hours)} · ${
        labelFor(retentionOpts, d.retention_days || 0)
      }`
      : 'Off';

    tc.innerHTML = `
      <details class="hist-settings"${this._histSettingsOpen ? ' open' : ''}>
        <summary class="hist-summary">
          <span class="hist-summary-title">Schedule &amp; retention</span>
          <span class="hist-summary-status">${status}${
      d.history_enabled && d.last_fetch_at ? ` · last fetch ${fmtDate(d.last_fetch_at)}` : ''
    }</span>
        </summary>
        <div class="hist-body">
          <label class="hist-toggle">
            <input type="checkbox" id="h-enabled" ${d.history_enabled ? 'checked' : ''} />
            <span>Keep version history</span>
          </label>
          <div class="field">
            <label>Fetch schedule</label>
            <select id="h-interval">${
      intervalOpts.map(([v, l]) => opt(v, l, d.fetch_interval_hours)).join('')
    }</select>
          </div>
          <div class="field">
            <label>Retention</label>
            <select id="h-retention">${
      retentionOpts.map(([v, l]) => opt(v, l, d.retention_days || 0)).join('')
    }</select>
          </div>
          <button class="btn btn-primary btn-sm" id="h-save">Save</button>
        </div>
      </details>

      <div class="hist-toolbar">
        <button class="btn btn-primary btn-sm" id="h-fetch">↻ Fetch Now</button>
        <div class="hist-compare">
          <span style="font-size:.78rem;color:var(--color-muted)">Compare</span>
          <select id="cmp-from">${refOptions}</select>
          <span style="color:var(--color-muted)">→</span>
          <select id="cmp-to">${refOptions}</select>
          <button class="btn btn-secondary btn-sm" id="cmp-run">Show diff</button>
        </div>
      </div>
      <div id="diff-panel"></div>

      <table class="dispatch-table" style="margin-top:1rem;">
        <thead><tr><th>Captured</th><th>Source</th><th>Size</th><th>Change</th><th></th></tr></thead>
        <tbody>
          ${
      versions.length
        ? versions.map((v) => `
            <tr data-vid="${v.id}">
              <td style="white-space:nowrap;font-size:.78rem">${fmtDate(v.created_at)}</td>
              <td><span class="badge-vendor">${escHtml(v.source)}</span></td>
              <td style="font-size:.76rem;color:var(--color-muted)">${v.line_count} lines · ${
          (v.byte_size / 1024).toFixed(1)
        } KB</td>
              <td style="font-size:.76rem;font-family:monospace">${
          v.added ? `<span style="color:#22c55e">+${v.added}</span>` : ''
        } ${v.removed ? `<span style="color:var(--color-danger)">-${v.removed}</span>` : ''}${
          !v.added && !v.removed ? '<span style="color:var(--color-muted)">initial</span>' : ''
        }</td>
              <td style="white-space:nowrap;text-align:right">
                <button class="btn btn-secondary btn-sm btn-view" data-vid="${v.id}">View</button>
                <button class="btn btn-danger btn-sm btn-del" data-vid="${v.id}">Delete</button>
              </td>
            </tr>`).join('')
        : `<tr><td colspan="5" class="empty">No versions stored yet.${
          d.history_enabled ? ' Click <strong>Fetch Now</strong> to capture one.' : ''
        }</td></tr>`
    }
        </tbody>
      </table>
    `;

    // remember whether the settings panel is expanded across re-renders
    tc.querySelector('.hist-settings').addEventListener('toggle', (e) => {
      this._histSettingsOpen = e.target.open;
    });

    // default the compare selectors to the two most recent snapshots
    const cmpFrom = tc.querySelector('#cmp-from');
    const cmpTo = tc.querySelector('#cmp-to');
    if (versions.length >= 2) {
      cmpFrom.value = String(versions[1].id);
      cmpTo.value = String(versions[0].id);
    } else if (versions.length === 1) {
      cmpFrom.value = String(versions[0].id);
      cmpTo.value = 'current';
    }

    tc.querySelector('#h-save').addEventListener('click', () => this._saveHistorySettings());
    tc.querySelector('#h-fetch').addEventListener('click', () => this._fetchNow());
    tc.querySelector('#cmp-run').addEventListener('click', () => this._showDiff());
    tc.querySelectorAll('.btn-view').forEach((b) =>
      b.addEventListener('click', () => this._viewVersion(parseInt(b.dataset.vid)))
    );
    tc.querySelectorAll('.btn-del').forEach((b) =>
      b.addEventListener('click', () => this._deleteVersion(parseInt(b.dataset.vid)))
    );
  }

  async _saveHistorySettings() {
    const tc = this.shadowRoot.getElementById('tab-content');
    const payload = {
      history_enabled: tc.querySelector('#h-enabled').checked,
      fetch_interval_hours: parseInt(tc.querySelector('#h-interval').value),
      retention_days: parseInt(tc.querySelector('#h-retention').value) || null,
    };
    try {
      const updated = await api.put(
        `/nas-manager/${this._selectedNasId}/history-settings`,
        payload,
      );
      this._managerByNasId[this._selectedNasId] = updated;
      toast('History settings saved', 'success');
      this._renderHistory();
    } catch (err) {
      toast(err.message ?? 'Save failed', 'error');
    }
  }

  async _fetchNow() {
    try {
      await api.post(`/nas-manager/${this._selectedNasId}/pull-config`, {});
      toast('Fetch started — a new version appears if the config changed', 'success');
      setTimeout(() => {
        if (this._activeTab === 'history') this._renderHistory();
      }, 3500);
    } catch (err) {
      toast(err.message ?? 'Fetch failed', 'error');
    }
  }

  async _showDiff() {
    const tc = this.shadowRoot.getElementById('tab-content');
    const from = tc.querySelector('#cmp-from').value;
    const to = tc.querySelector('#cmp-to').value;
    const panel = tc.querySelector('#diff-panel');
    panel.innerHTML =
      `<div style="color:var(--color-muted);font-size:.8rem;padding:.5rem 0">Computing diff…</div>`;
    try {
      const r = await api.get(
        `/nas-manager/${this._selectedNasId}/config-diff?from_ref=${
          encodeURIComponent(from)
        }&to_ref=${encodeURIComponent(to)}`,
      );
      if (r.identical) {
        panel.innerHTML =
          `<div class="diff-summary">No differences — the two versions are identical.</div>`;
        return;
      }
      const lines = r.diff.split('\n').map((ln) => {
        let cls = 'diff-ctx';
        if (ln.startsWith('+++') || ln.startsWith('---')) cls = 'diff-file';
        else if (ln.startsWith('@@')) cls = 'diff-hunk';
        else if (ln.startsWith('+')) cls = 'diff-add';
        else if (ln.startsWith('-')) cls = 'diff-del';
        return `<div class="${cls}">${escHtml(ln) || '&nbsp;'}</div>`;
      }).join('');
      panel.innerHTML = `
        <div class="diff-summary">
          <span style="color:#22c55e">+${r.added}</span>
          <span style="color:var(--color-danger)">-${r.removed}</span>
          <span style="color:var(--color-muted)">· ${escHtml(r.from_label)} → ${
        escHtml(r.to_label)
      }</span>
        </div>
        <div class="diff-view">${lines}</div>`;
    } catch (err) {
      panel.innerHTML = `<div style="color:var(--color-danger)">${escHtml(err.message)}</div>`;
    }
  }

  async _viewVersion(vid) {
    try {
      const v = await api.get(`/nas-manager/${this._selectedNasId}/config-versions/${vid}`);
      const panel = this.shadowRoot.getElementById('diff-panel');
      panel.innerHTML = `
        <div class="diff-summary">Version from ${fmtDate(v.created_at)} · ${
        escHtml(v.source)
      } · ${v.line_count} lines</div>
        <div class="config-viewer" style="max-height:420px">${escHtml(v.config)}</div>`;
    } catch (err) {
      toast(err.message ?? 'Failed to load version', 'error');
    }
  }

  async _deleteVersion(vid) {
    if (
      !(await confirmDialog('Delete this stored config version? This cannot be undone.', {
        title: 'Delete config version',
        danger: true,
      }))
    ) return;
    try {
      await api.delete(`/nas-manager/${this._selectedNasId}/config-versions/${vid}`);
      toast('Version deleted', 'success');
      this._renderHistory();
    } catch (err) {
      toast(err.message ?? 'Delete failed', 'error');
    }
  }

  // ── Console ──────────────────────────────────────────────────────────────────

  _renderConsole() {
    const tc = this.shadowRoot.getElementById('tab-content');
    const history = this._cmdHistory.slice(-8).reverse();
    tc.innerHTML = `
      <div class="cmd-bar">
        <input class="cmd-input" id="cmd-input" type="text" placeholder="Enter command…" list="cmd-hist-list" />
        <datalist id="cmd-hist-list">
          ${history.map((c) => `<option value="${escHtml(c)}">`).join('')}
        </datalist>
        <button class="btn btn-primary btn-sm" id="btn-run-cmd">Run</button>
      </div>
      ${
      history.length
        ? `<div class="cmd-history">Recent: ${
          history.slice(0, 5).map((c) => `<span class="cmd-hist-item">${escHtml(c)}</span>`).join(
            '',
          )
        }</div>`
        : ''
    }
      <div class="cmd-output" id="cmd-output">Run a command to see output here.</div>
    `;
    const inp = tc.querySelector('#cmd-input');
    const runBtn = tc.querySelector('#btn-run-cmd');
    const runCmd = () => this._runCommand(inp.value.trim());
    runBtn.addEventListener('click', runCmd);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runCmd();
    });
    tc.querySelectorAll('.cmd-hist-item').forEach((el) => {
      el.addEventListener('click', () => {
        inp.value = el.textContent;
        inp.focus();
      });
    });
  }

  _runCommand(cmd) {
    if (!cmd) return;
    const tc = this.shadowRoot.getElementById('tab-content');
    const out = tc.querySelector('#cmd-output');
    if (!out) return;
    out.textContent = 'Running…';
    this._pushHistory(cmd);
    try {
      // EventSource sends the HttpOnly session cookie automatically (same-origin).
      const es = new EventSource(
        `/api/nas-manager/${this._selectedNasId}/command?command=${encodeURIComponent(cmd)}`,
      );
      let buf = '';
      es.onmessage = (e) => {
        if (e.data === '[DONE]') {
          es.close();
          return;
        }
        buf += e.data;
        out.textContent = buf;
        out.scrollTop = out.scrollHeight;
      };
      es.onerror = () => {
        es.close();
        if (!buf) out.textContent = 'Connection error';
      };
    } catch (err) {
      out.textContent = 'Error: ' + (err.message ?? err);
    }
  }

  _pushHistory(cmd) {
    this._cmdHistory = [...new Set([...this._cmdHistory, cmd])].slice(-20);
    localStorage.setItem('mr_nm_cmd_history', JSON.stringify(this._cmdHistory));
  }

  // ── Dispatch log ─────────────────────────────────────────────────────────────

  async _renderDispatchLog() {
    const tc = this.shadowRoot.getElementById('tab-content');
    tc.innerHTML = `<div style="color:var(--color-muted);font-size:.8rem;">Loading…</div>`;
    try {
      const rows = await api.get(`/nas-manager/${this._selectedNasId}/dispatch-log`);
      if (!rows.length) {
        tc.innerHTML =
          `<div class="empty">No commands run on this device yet.<br>Use the <strong>Console</strong> tab to run one.</div>`;
        return;
      }
      tc.innerHTML = `
        <table class="dispatch-table">
          <thead><tr>
            <th>Time</th><th>Command</th><th>Status</th><th>Actor</th>
          </tr></thead>
          <tbody>
            ${
        rows.map((r) => `
              <tr style="cursor:pointer" data-id="${r.id}">
                <td style="white-space:nowrap;font-size:.75rem;color:var(--color-muted)">${
          fmtDate(r.executed_at)
        }</td>
                <td style="font-family:monospace;font-size:.78rem">${escHtml(r.command)}</td>
                <td>${statusBadge(r.status)}</td>
                <td style="font-size:.75rem;color:var(--color-muted)">${
          escHtml(r.actor || '—')
        }</td>
              </tr>
              ${
          r.output || r.error
            ? `
              <tr>
                <td colspan="4" style="padding:0 .6rem .6rem;">
                  <div style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:5px;padding:.4rem .6rem;font-family:monospace;font-size:.74rem;white-space:pre-wrap;color:${
              r.error ? 'var(--color-danger)' : 'var(--color-text)'
            }">
                    ${escHtml(r.error || r.output)}
                  </div>
                </td>
              </tr>`
            : ''
        }
            `).join('')
      }
          </tbody>
        </table>
      `;
    } catch (err) {
      tc.innerHTML = `<div style="color:var(--color-danger)">${escHtml(err.message)}</div>`;
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  async _testConnection() {
    try {
      const btn = this.shadowRoot.querySelector('#btn-test');
      btn.disabled = true;
      btn.textContent = 'Testing…';
      await api.post(`/nas-manager/${this._selectedNasId}/test`, {});
      toast('Connection test started — status will update shortly', 'success');
      setTimeout(() => this._refreshManager(), 3000);
    } catch (err) {
      toast(err.message ?? 'Test failed', 'error');
    } finally {
      const btn = this.shadowRoot.querySelector('#btn-test');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Test Connection';
      }
    }
  }

  async _refreshManager() {
    if (this._selectedNasId == null) return;
    try {
      const updated = await api.get(`/nas-manager/${this._selectedNasId}`);
      this._managerByNasId[this._selectedNasId] = updated;
      this._renderList();
      this._renderDetail();
    } catch (_) { /* config may have been removed; ignore */ }
  }

  async _deleteManager() {
    const nas = this._selectedNas;
    if (
      !(await confirmDialog(
        `Stop managing "${
          nas.shortname || nas.nasname
        }"? Stored credentials and pulled config are deleted. The NAS device itself stays in the database.`,
        { title: 'Stop managing', danger: true },
      ))
    ) return;
    try {
      await api.delete(`/nas-manager/${this._selectedNasId}`);
      delete this._managerByNasId[this._selectedNasId];
      toast('Stopped managing this NAS', 'success');
      this._activeTab = 'overview';
      this._renderList();
      this._renderDetail();
    } catch (err) {
      toast(err.message ?? 'Delete failed', 'error');
    }
  }
}

customElements.define('nas-manager-view', NasManagerView);

// NAS Manager is now the "Manage (SSH)" tab of the unified /nas workspace.
// Redirect the old standalone route so bookmarks keep working.
function _nmRedirect(to) {
  queueMicrotask(() => router.navigate(to));
  const d = document.createElement('div');
  d.style.cssText = 'padding:2rem;color:var(--color-muted);font-size:.8rem;';
  d.textContent = 'Redirecting…';
  return d;
}
router.register('/nas-manager', () => _nmRedirect('/nas'));

export default {
  tag: 'nas-manager-view',
  title: 'NAS Manager',
};
