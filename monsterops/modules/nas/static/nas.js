import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { router } from '/js/router.js';
import { emptyStateHTML, skeletonBlock } from '/js/utils/empty.js';
import { applyServerErrors, clearFieldErrors, setFieldError } from '/js/utils/form.js';

// ── NAS type list ─────────────────────────────────────────────────────────────
const NAS_TYPES = ['other', 'cisco', 'huawei', 'mikrotik', 'juniper', 'ubiquiti', 'hp', 'ericsson'];

// Default the TACACS+ `aaa` snippet vendor from the NAS type (Device admin tab).
const NAS_TYPE_TO_VENDOR = { cisco: 'cisco_ios', huawei: 'huawei', juniper: 'juniper' };

function nasTypeOptions(selected = 'other') {
  const all = NAS_TYPES.includes(selected) ? NAS_TYPES : [...NAS_TYPES, selected];
  return all.map((t) => `<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`)
    .join('');
}

// ── Preset definitions ────────────────────────────────────────────────────────
const PRESETS = {
  huawei: {
    label: 'Huawei',
    type: 'huawei',
    ports: null,
    community: 'public',
    description: 'Huawei OLT / Router',
  },
  mikrotik: {
    label: 'MikroTik',
    type: 'mikrotik',
    ports: null,
    community: '',
    description: 'MikroTik RouterOS',
  },
  cisco: {
    label: 'Cisco',
    type: 'cisco',
    ports: null,
    community: 'public',
    description: 'Cisco Router / Switch',
  },
  generic: {
    label: 'Generic',
    type: 'other',
    ports: null,
    community: '',
    description: '',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function fmtDuration(secs) {
  if (secs == null) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Web Component ─────────────────────────────────────────────────────────────
const STYLE = `
  <style>
    @import '/css/theme.css';
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :host { display: flex; height: 100%; overflow: hidden; }
    .hidden { display: none !important; }

    /* ── List panel ─────────────────────────────────────────────────────── */
    .list-panel {
      display: flex; flex-direction: column;
      width: 360px; min-width: 220px;
      border-right: 1px solid var(--color-border);
      background: var(--color-surface);
      flex-shrink: 0; transition: width 0.2s;
    }
    .list-panel.narrow { width: 260px; }

    .list-header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 1rem;
      border-bottom: 1px solid var(--color-border);
    }
    .list-header h2 { font-size: 0.95rem; font-weight: 600; flex: 1; }

    .search-wrap { padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); }
    .search-wrap input {
      width: 100%; padding: 0.45rem 0.7rem;
      background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: 6px; color: var(--color-text); font-size: 0.8rem;
    }
    .search-wrap input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }

    .nas-list { flex: 1; overflow-y: auto; }
    .nas-item {
      display: flex; flex-direction: column; gap: 0.2rem;
      padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border);
      cursor: pointer; transition: background 0.1s;
    }
    .nas-item:hover { background: rgba(99,102,241,0.06); }
    .nas-item.active { background: rgba(99,102,241,0.12); }
    .nas-item-top { display: flex; align-items: center; gap: 0.5rem; }
    .nas-name { font-size: 0.875rem; font-weight: 500; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nas-ip { font-size: 0.75rem; color: var(--color-muted); font-family: monospace; }
    .nas-meta { display: flex; align-items: center; gap: 0.5rem; }
    .badge-type {
      font-size: 0.68rem; padding: 0.1rem 0.45rem;
      border-radius: 4px; background: rgba(99,102,241,0.15);
      color: var(--color-accent); font-weight: 500;
    }
    .badge-sessions {
      font-size: 0.68rem; padding: 0.1rem 0.45rem;
      border-radius: 4px; background: rgba(34,197,94,0.15);
      color: #22c55e; font-weight: 500;
    }
    .badge-sessions.zero { background: rgba(148,163,184,0.1); color: var(--color-muted); }

    /* Pagination */
    .pager {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.5rem 1rem; border-top: 1px solid var(--color-border);
      font-size: 0.75rem; color: var(--color-muted);
    }
    .pager button {
      background: none; border: 1px solid var(--color-border);
      border-radius: 4px; color: var(--color-text);
      padding: 0.2rem 0.6rem; cursor: pointer; font-size: 0.75rem;
    }
    .pager button:disabled { opacity: 0.35; cursor: default; }

    /* ── Detail panel ───────────────────────────────────────────────────── */
    .detail-panel {
      flex: 1; display: flex; flex-direction: column; overflow: hidden;
    }
    .detail-empty {
      flex: 1; display: flex; align-items: center; justify-content: center;
      color: var(--color-muted); font-size: 0.875rem;
    }
    .detail-inner { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .detail-header {
      padding: 1rem 1.5rem; border-bottom: 1px solid var(--color-border);
      display: flex; align-items: center; gap: 0.75rem;
    }
    .detail-header h3 { font-size: 1rem; font-weight: 600; flex: 1; }
    .detail-actions { display: flex; gap: 0.5rem; }

    /* Tabs */
    .tabs {
      display: flex; gap: 0; border-bottom: 1px solid var(--color-border);
      padding: 0 1.5rem;
    }
    .tab-btn {
      background: none; border: none; border-bottom: 2px solid transparent;
      padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.8rem;
      color: var(--color-muted); margin-bottom: -1px; transition: color 0.1s;
    }
    .tab-btn.active { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: 500; }

    .tab-content { flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem; }

    /* Form */
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .form-grid.full { grid-template-columns: 1fr; }
    .field { display: flex; flex-direction: column; gap: 0.3rem; }
    .field label { font-size: 0.75rem; color: var(--color-muted); font-weight: 500; }
    .field input, .field select, .field textarea {
      background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: 6px; color: var(--color-text); padding: 0.45rem 0.65rem;
      font-size: 0.8rem; font-family: inherit; width: 100%;
    }
    .field input:focus, .field select:focus, .field textarea:focus {
      outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint);
    }
    .field-hint { font-size: 0.7rem; color: var(--color-muted); }

    .secret-wrap { display: flex; gap: 0.4rem; }
    .secret-wrap input { flex: 1; font-family: monospace; }
    .btn-eye {
      background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: 6px; padding: 0 0.55rem; cursor: pointer; color: var(--color-muted);
      font-size: 0.85rem;
    }

    /* Sessions table */
    .sessions-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
    .sessions-table th {
      text-align: left; padding: 0.45rem 0.65rem;
      color: var(--color-muted); font-weight: 500; font-size: 0.7rem;
      border-bottom: 1px solid var(--color-border); white-space: nowrap;
    }
    .sessions-table td {
      padding: 0.45rem 0.65rem; border-bottom: 1px solid var(--color-border);
      color: var(--color-text); font-family: monospace;
    }
    .sessions-table tr:hover td { background: rgba(99,102,241,0.04); }
    .empty-msg { text-align: center; padding: 2rem; color: var(--color-muted); font-size: 0.8rem; }

    /* Buttons */
    .btn {
      padding: 0.45rem 0.9rem; border: none; border-radius: 6px;
      font-size: 0.8rem; cursor: pointer; font-family: inherit;
    }
    .btn-primary { background: var(--color-accent); color: #fff; }
    .btn-primary:hover { background: var(--color-accent-hover, #4f46e5); }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-secondary {
      background: var(--color-bg); border: 1px solid var(--color-border);
      color: var(--color-text);
    }
    .btn-secondary:hover { background: rgba(99,102,241,0.08); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }

    .section-label {
      font-size: 0.7rem; font-weight: 600; color: var(--color-muted);
      text-transform: uppercase; letter-spacing: 0.05em;
      margin: 1.25rem 0 0.6rem 0; padding-bottom: 0.35rem;
      border-bottom: 1px solid var(--color-border);
    }
    .section-label:first-child { margin-top: 0; }

    .save-row { display: flex; gap: 0.5rem; margin-top: 1.25rem; align-items: center; }

    /* Modal */
    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
    }
    .modal-backdrop.hidden { display: none; }
    .modal {
      background: var(--color-surface); border: 1px solid var(--color-border);
      border-radius: 12px; padding: 1.5rem; width: 520px; max-width: 95vw;
      max-height: 90vh; overflow-y: auto;
    }
    .modal-header { display: flex; align-items: center; margin-bottom: 1.25rem; }
    .modal-header h3 { font-size: 1rem; font-weight: 600; flex: 1; }
    .modal-close {
      background: none; border: none; color: var(--color-muted);
      font-size: 1.2rem; cursor: pointer; padding: 0.25rem;
    }

    /* Presets */
    .preset-row { display: flex; gap: 0.5rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .preset-row span { font-size: 0.75rem; color: var(--color-muted); align-self: center; }
    .btn-preset {
      padding: 0.3rem 0.75rem; font-size: 0.75rem;
      background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: 6px; color: var(--color-text); cursor: pointer;
      transition: border-color 0.1s, color 0.1s;
    }
    .btn-preset:hover { border-color: var(--color-accent); color: var(--color-accent); }

    .modal-footer { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.25rem; }

    .spinner-inline {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
      border-radius: 50%; animation: spin 0.7s linear infinite; margin-right: 4px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
`;

const TEMPLATE = `
${STYLE}
<div class="list-panel" id="list-panel">
  <div class="list-header">
    <h2>NAS / Clients</h2>
    <button class="btn btn-primary" id="btn-create" style="padding:0.35rem 0.75rem;font-size:0.78rem;">+ Add NAS</button>
  </div>
  <div class="search-wrap">
    <input id="search" type="search" placeholder="Search by name or IP…" />
  </div>
  <div class="nas-list" id="nas-list"></div>
  <div class="pager" id="pager"></div>
</div>

<div class="detail-panel" id="detail-panel">
  <div class="detail-empty" id="detail-empty">Select a NAS device from the list</div>
  <div class="detail-inner hidden" id="detail-inner">
    <div class="detail-header">
      <h3 id="detail-title"></h3>
      <div class="detail-actions">
        <button class="btn btn-danger" id="btn-delete">Delete</button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="overview">Overview</button>
      <button class="tab-btn" data-tab="sessions">Active Sessions</button>
      <button class="tab-btn" data-tab="groups">Groups</button>
      <button class="tab-btn" data-tab="tacacs">Device admin</button>
      <button class="tab-btn" data-tab="manage">Manage (SSH)</button>
      <button class="tab-btn" data-tab="history">Config History</button>
      <button class="tab-btn" data-tab="console">Console</button>
      <button class="tab-btn" data-tab="zabbix">Zabbix Alarms</button>
    </div>
    <div class="tab-content" id="tab-content"></div>
  </div>
</div>

<!-- Create modal -->
<div class="modal-backdrop hidden" id="modal">
  <div class="modal">
    <div class="modal-header">
      <h3>Add NAS Device</h3>
      <button class="modal-close" id="modal-close">✕</button>
    </div>
    <div class="preset-row">
      <span>Quick preset:</span>
      <button class="btn-preset" data-preset="huawei">Huawei</button>
      <button class="btn-preset" data-preset="mikrotik">MikroTik</button>
      <button class="btn-preset" data-preset="cisco">Cisco</button>
      <button class="btn-preset" data-preset="generic">Generic</button>
    </div>
    <div class="form-grid" id="modal-form">
      <div class="field">
        <label>IP / Hostname *</label>
        <input id="m-nasname" placeholder="192.168.1.1" maxlength="128" />
      </div>
      <div class="field">
        <label>Short name</label>
        <input id="m-shortname" placeholder="router-01" maxlength="32" />
      </div>
      <div class="field">
        <label>Shared Secret *</label>
        <div class="secret-wrap">
          <input id="m-secret" type="password" placeholder="••••••••" maxlength="60" />
          <button class="btn-eye" id="m-eye" type="button">👁</button>
        </div>
      </div>
      <div class="field">
        <label>Type</label>
        <select id="m-type">
          <option value="other">other</option>
          <option value="cisco">cisco</option>
          <option value="huawei">huawei</option>
          <option value="mikrotik">mikrotik</option>
          <option value="juniper">juniper</option>
          <option value="ubiquiti">ubiquiti</option>
          <option value="hp">hp</option>
          <option value="ericsson">ericsson</option>
        </select>
      </div>
      <div class="field">
        <label>Ports</label>
        <input id="m-ports" type="number" min="1" max="65535" placeholder="optional" />
      </div>
      <div class="field">
        <label>SNMP Community</label>
        <input id="m-community" placeholder="public" maxlength="50" />
      </div>
      <div class="field" style="grid-column:1/-1;">
        <label>Description</label>
        <input id="m-description" placeholder="optional" maxlength="200" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-submit">Add NAS</button>
    </div>
  </div>
</div>
`;

class NasView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._page = 1;
    this._search = '';
    this._selectedId = null;
    this._selectedNas = null;
    this._searchTimer = null;
    this._activeTab = 'overview';
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = TEMPLATE;
    this._bindStatic();
    this._loadList();
  }

  // ── Shorthand ─────────────────────────────────────────────────────────────
  $(s) {
    return this.shadowRoot.querySelector(s);
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  _bindStatic() {
    this.$('#btn-create').addEventListener('click', () => this._openModal());
    this.$('#modal-close').addEventListener('click', () => this._closeModal());
    this.$('#modal-cancel').addEventListener('click', () => this._closeModal());
    this.$('#modal-submit').addEventListener('click', () => this._submitCreate());
    this.$('#modal').addEventListener('click', (e) => {
      if (e.target === this.$('#modal')) this._closeModal();
    });

    // Preset buttons
    this.shadowRoot.querySelectorAll('.btn-preset').forEach((btn) => {
      btn.addEventListener('click', () => this._applyPreset(btn.dataset.preset));
    });

    // Secret eye toggle
    this.$('#m-eye').addEventListener('click', () => {
      const inp = this.$('#m-secret');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // Search
    this.$('#search').addEventListener('input', (e) => {
      const value = e.target.value.trim(); // capture now: e.target retargets to the shadow host once dispatch ends
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._search = value;
        this._page = 1;
        this._loadList();
      }, 300);
    });

    // Delete
    this.$('#btn-delete').addEventListener('click', () => this._deleteSelected());
  }

  // ── List ──────────────────────────────────────────────────────────────────
  async _loadList() {
    const list = this.$('#nas-list');
    list.innerHTML = skeletonBlock(this.shadowRoot, 6);
    try {
      const data = await api.get(
        `/nas?page=${this._page}&size=20&search=${encodeURIComponent(this._search)}`,
      );
      this._renderList(data);
    } catch (err) {
      list.innerHTML = emptyStateHTML({
        title: 'Couldn’t load NAS devices',
        message: err.message || 'Something went wrong. Try again.',
      });
    }
  }

  _renderList(data) {
    const list = this.$('#nas-list');
    if (!data.items.length) {
      list.innerHTML = emptyStateHTML({
        title: this._search ? 'No matching devices' : 'No NAS devices yet',
        message: this._search
          ? `Nothing matches “${this._search}”. Try a different search.`
          : 'Add your first NAS client to start accepting RADIUS requests.',
      });
      this._renderPager(data);
      return;
    }
    list.innerHTML = data.items.map((n) => `
      <div class="nas-item${n.id === this._selectedId ? ' active' : ''}" data-id="${n.id}">
        <div class="nas-item-top">
          <span class="nas-name">${escHtml(n.shortname)}</span>
          <span class="badge-sessions${n.active_sessions === 0 ? ' zero' : ''}">
            ${n.active_sessions} session${n.active_sessions !== 1 ? 's' : ''}
          </span>
        </div>
        <div class="nas-meta">
          <span class="nas-ip">${escHtml(n.nasname)}</span>
          <span class="badge-type">${escHtml(n.type)}</span>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.nas-item').forEach((el) => {
      el.addEventListener('click', () => this._selectNas(parseInt(el.dataset.id)));
    });

    this._renderPager(data);
  }

  _renderPager(data) {
    const pager = this.$('#pager');
    const totalPages = Math.max(1, Math.ceil(data.total / data.size));
    pager.innerHTML = `
      <button id="p-prev" ${this._page <= 1 ? 'disabled' : ''}>‹ Prev</button>
      <span>${this._page} / ${totalPages} (${data.total})</span>
      <button id="p-next" ${this._page >= totalPages ? 'disabled' : ''}>Next ›</button>
    `;
    pager.querySelector('#p-prev')?.addEventListener('click', () => {
      this._page--;
      this._loadList();
    });
    pager.querySelector('#p-next')?.addEventListener('click', () => {
      this._page++;
      this._loadList();
    });
  }

  // ── Detail ────────────────────────────────────────────────────────────────
  async _selectNas(id) {
    this._selectedId = id;
    this._activeTab = 'overview';

    // Mark active in list
    this.shadowRoot.querySelectorAll('.nas-item').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.id) === id);
    });
    this.$('#list-panel').classList.add('narrow');
    this.$('#detail-empty').classList.add('hidden');
    this.$('#detail-inner').classList.remove('hidden');
    this.$('#tab-content').innerHTML =
      '<div style="padding:1rem;color:var(--color-muted);font-size:0.8rem;">Loading…</div>';

    try {
      const nas = await api.get(`/nas/${id}`);
      this._selectedNas = nas;
      this.$('#detail-title').textContent = nas.shortname || nas.nasname;
      this._bindTabs();
      this._renderTab('overview');
    } catch (err) {
      this.$('#tab-content').innerHTML = `<div class="empty-msg">Failed to load: ${
        escHtml(err.message)
      }</div>`;
    }
  }

  _bindTabs() {
    this.shadowRoot.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.onclick = () => {
        this.shadowRoot.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this._activeTab = btn.dataset.tab;
        this._renderTab(this._activeTab);
      };
    });
  }

  _renderTab(tab) {
    // Reset any per-tab overrides the Manage tab applies to the content host.
    const tc = this.$('#tab-content');
    tc.style.padding = '';
    tc.style.display = '';
    if (tab === 'overview') this._renderOverview();
    else if (tab === 'sessions') this._renderSessions();
    else if (tab === 'groups') this._renderGroupsTab();
    else if (tab === 'tacacs') this._renderTacacsTab();
    else if (tab === 'manage') this._renderManageTab('manage');
    else if (tab === 'history') this._renderManageTab('history');
    else if (tab === 'console') this._renderManageTab('console');
    else if (tab === 'zabbix') this._renderZabbixTab();
  }

  // ── Device admin (TACACS+) tab ────────────────────────────────────────────
  // Enroll this NAS as a TACACS+ client (so its admins log in against the
  // TACACS+ accounts) and show the vendor `aaa` snippet that points the device
  // at this server. Backed by the /api/tacacs management API.
  async _renderTacacsTab() {
    const n = this._selectedNas;
    const tc = this.$('#tab-content');
    tc.innerHTML = skeletonBlock(this.shadowRoot, 4);
    try {
      const [status, linked, vendors] = await Promise.all([
        api.get('/tacacs/status'),
        api.get(`/tacacs/clients?nas_id=${n.id}`),
        api.get('/tacacs/aaa-vendors'),
      ]);
      this._tacStatus = status;
      this._tacClient = linked[0] || null;
      this._tacVendors = vendors;
      this._tacServer = location.hostname || n.nasname;
      this._tacVendor = NAS_TYPE_TO_VENDOR[n.type] || 'generic';
      this._paintTacacsTab();
    } catch (err) {
      tc.innerHTML = `<div class="empty-msg">Failed to load: ${escHtml(err.message)}</div>`;
    }
  }

  _paintTacacsTab() {
    const n = this._selectedNas;
    const tc = this.$('#tab-content');
    const c = this._tacClient;
    const listener = this._tacStatus?.enabled
      ? `<span style="color:var(--mr-accept)">listener on</span>`
      : `<span style="color:var(--color-warning,#eab308)">listener off</span>`;
    const enroll = c
      ? `<div class="notice-ok" style="border:1px solid color-mix(in srgb,var(--mr-accept) 40%,transparent);background:var(--mr-accept-tint);border-radius:var(--radius);padding:0.7rem 0.85rem;font-size:0.82rem;">
           <strong>Enrolled</strong> as TACACS+ client <span class="mono">${escHtml(c.name)}</span>
           (${escHtml(c.address)}) — ${
        c.enabled ? 'enabled' : 'disabled'
      }. Device admins authenticate
           against your TACACS+ accounts.
         </div>
         <div class="save-row"><button class="btn btn-danger" id="tac-unenroll">Disable device admin</button></div>`
      : `<p style="font-size:0.83rem;color:var(--color-muted);margin:0 0 0.6rem;">
           This device is not a TACACS+ client yet. Enroll it so its admins log in through MonsterOps
           (${listener}).
         </p>
         <div class="form-grid">
           <div class="field"><label>Shared secret</label>
             <input id="tac-secret" type="password" maxlength="128" placeholder="key the device will use" /></div>
           <div class="field"><label>Address</label>
             <input id="tac-address" value="${escHtml(n.nasname)}" maxlength="64" />
             <span class="field-hint">IP or CIDR the device connects from</span></div>
         </div>
         <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;margin-bottom:0.6rem;">
           <input type="checkbox" id="tac-single" /> Single-connection mode</label>
         <div class="save-row"><button class="btn btn-primary" id="tac-enroll">Enable device admin</button></div>`;

    const vendorOpts = this._tacVendors
      .map((v) =>
        `<option value="${v.id}"${v.id === this._tacVendor ? ' selected' : ''}>${
          escHtml(v.label)
        }</option>`
      )
      .join('');

    tc.innerHTML = `
      <div style="max-width:760px;">
        <h4 style="margin:0 0 0.75rem;font-size:0.95rem;">Device administration (TACACS+)</h4>
        ${enroll}
        <h4 style="margin:1.5rem 0 0.5rem;font-size:0.9rem;">Configuration snippet</h4>
        <p style="font-size:0.8rem;color:var(--color-muted);margin:0 0 0.6rem;">
          Paste this into the device to point its <span class="mono">aaa</span> at MonsterOps. The secret is a
          placeholder — use the same shared secret set above.</p>
        <div class="form-grid">
          <div class="field"><label>Vendor</label><select id="tac-vendor">${vendorOpts}</select></div>
          <div class="field"><label>MonsterOps server address</label>
            <input id="tac-srv" value="${escHtml(this._tacServer)}" maxlength="128" /></div>
        </div>
        <div style="position:relative;">
          <button class="btn" id="tac-copy" style="position:absolute;top:0.5rem;right:0.5rem;">Copy</button>
          <pre id="tac-snippet" style="background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);padding:0.9rem;font-size:0.75rem;overflow:auto;white-space:pre;margin:0;">Loading…</pre>
        </div>
      </div>`;

    if (c) {
      tc.querySelector('#tac-unenroll').addEventListener('click', () => this._unenrollTacacs());
    } else {
      tc.querySelector('#tac-enroll').addEventListener('click', () => this._enrollTacacs());
    }
    const refresh = () => {
      this._tacVendor = tc.querySelector('#tac-vendor').value;
      this._tacServer = tc.querySelector('#tac-srv').value.trim();
      this._refreshSnippet();
    };
    tc.querySelector('#tac-vendor').addEventListener('change', refresh);
    tc.querySelector('#tac-srv').addEventListener('input', refresh);
    tc.querySelector('#tac-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(tc.querySelector('#tac-snippet').textContent)
        .then(() => toast('Snippet copied', 'success'))
        .catch(() => toast('Copy failed', 'error'));
    });
    this._refreshSnippet();
  }

  async _refreshSnippet() {
    const pre = this.$('#tac-snippet');
    if (!pre) return;
    const server = encodeURIComponent(this._tacServer || '<monsterops-server-ip>');
    try {
      const snip = await api.get(`/tacacs/aaa-snippet?vendor=${this._tacVendor}&server=${server}`);
      pre.textContent = snip.text;
    } catch (err) {
      pre.textContent = `# ${err.message}`;
    }
  }

  async _enrollTacacs() {
    const n = this._selectedNas;
    const tc = this.$('#tab-content');
    const safeName = (n.shortname || n.nasname || `nas-${n.id}`)
      .replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '') || `nas-${n.id}`;
    const body = {
      name: safeName,
      address: tc.querySelector('#tac-address').value.trim(),
      secret: tc.querySelector('#tac-secret').value,
      nas_id: n.id,
      single_connect: tc.querySelector('#tac-single').checked,
      enabled: true,
    };
    if (!body.secret) {
      toast('Enter a shared secret', 'error');
      return;
    }
    try {
      await api.post('/tacacs/clients', body);
      toast('Device admin enabled', 'success');
      this._renderTacacsTab();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async _unenrollTacacs() {
    const c = this._tacClient;
    if (!c) return;
    if (
      !(await confirmDialog(
        `Disable TACACS+ device admin for this NAS? Admins will no longer be able to log in via TACACS+.`,
        { title: 'Disable device admin', danger: true, okLabel: 'Disable' },
      ))
    ) return;
    try {
      await api.delete(`/tacacs/clients/${c.id}`);
      toast('Device admin disabled', 'success');
      this._renderTacacsTab();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ── Manage (SSH) / Config History / Console tabs ──────────────────────────
  // All three embed the NAS Manager surface scoped to the selected device (list
  // pane hidden). Manage shows credentials/config/command-log; History and
  // Console are promoted to their own top-level device tabs, each rendering that
  // NAS Manager panel solo (no internal sub-tab bar).
  _renderManageTab(mode = 'manage') {
    const tc = this.$('#tab-content');
    tc.style.padding = '0';
    tc.style.display = 'flex';
    tc.innerHTML = '';
    if (!customElements.get('nas-manager-view')) {
      tc.style.padding = '';
      tc.style.display = '';
      tc.innerHTML = '<div class="empty-msg">NAS Manager module is not enabled.</div>';
      return;
    }
    const mgr = document.createElement('nas-manager-view');
    mgr.setAttribute('embedded', '');
    mgr.forceNasId = this._selectedId;
    if (mode === 'history') {
      mgr.embedTabs = ['history'];
      mgr.initialTab = 'history';
    } else if (mode === 'console') {
      mgr.embedTabs = ['console'];
      mgr.initialTab = 'console';
    } else {
      mgr.embedTabs = ['overview', 'config', 'radius', 'dispatch', 'credentials'];
      mgr.initialTab = 'overview';
    }
    mgr.style.cssText = 'flex:1; min-height:0; width:100%;';
    tc.appendChild(mgr);
  }

  // ── Overview (edit form) ──────────────────────────────────────────────────
  _renderOverview() {
    const n = this._selectedNas;
    const tc = this.$('#tab-content');
    tc.innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>IP / Hostname</label>
          <input id="e-nasname" value="${escHtml(n.nasname)}" maxlength="128" />
        </div>
        <div class="field">
          <label>Short name</label>
          <input id="e-shortname" value="${escHtml(n.shortname)}" maxlength="32" />
        </div>
        <div class="field">
          <label>Shared Secret</label>
          <div class="secret-wrap">
            <input id="e-secret" type="password" value="${escHtml(n.secret)}" maxlength="60" />
            <button class="btn-eye" id="e-eye" type="button">👁</button>
          </div>
        </div>
        <div class="field">
          <label>Type</label>
          <select id="e-type">${nasTypeOptions(n.type)}</select>
        </div>
        <div class="field">
          <label>Ports</label>
          <input id="e-ports" type="number" min="1" max="65535" value="${
      n.ports ?? ''
    }" placeholder="optional" />
        </div>
        <div class="field">
          <label>SNMP Community</label>
          <input id="e-community" value="${escHtml(n.community ?? '')}" maxlength="50" />
        </div>
        <div class="field">
          <label>Virtual Server</label>
          <input id="e-server" value="${
      escHtml(n.server ?? '')
    }" maxlength="64" placeholder="optional" />
          <span class="field-hint">FreeRADIUS virtual server to route requests to</span>
        </div>
        <div class="field">
          <label>Description</label>
          <input id="e-description" value="${escHtml(n.description ?? '')}" maxlength="200" />
        </div>
      </div>
      <div class="save-row">
        <button class="btn btn-primary" id="btn-save">Save Changes</button>
        <span id="save-status" style="font-size:0.78rem;color:var(--color-muted);"></span>
      </div>
    `;

    tc.querySelector('#e-eye').addEventListener('click', () => {
      const inp = tc.querySelector('#e-secret');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    tc.querySelector('#btn-save').addEventListener('click', () => this._saveOverview(tc));
  }

  async _saveOverview(tc) {
    const btn = tc.querySelector('#btn-save');
    const status = tc.querySelector('#save-status');
    const nasname = tc.querySelector('#e-nasname').value.trim();
    const secret = tc.querySelector('#e-secret').value.trim();

    if (!nasname) {
      toast('IP / Hostname is required', 'error');
      return;
    }
    if (!secret) {
      toast('Shared secret is required', 'error');
      return;
    }

    const portsVal = tc.querySelector('#e-ports').value;
    const payload = {
      nasname,
      shortname: tc.querySelector('#e-shortname').value.trim(),
      type: tc.querySelector('#e-type').value || 'other',
      ports: portsVal ? parseInt(portsVal) : null,
      secret,
      community: tc.querySelector('#e-community').value.trim() || null,
      server: tc.querySelector('#e-server').value.trim() || null,
      description: tc.querySelector('#e-description').value.trim() || null,
    };

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-inline"></span>Saving…';
    status.textContent = '';
    try {
      const updated = await api.put(`/nas/${this._selectedId}`, payload);
      this._selectedNas = updated;
      this.$('#detail-title').textContent = updated.shortname || updated.nasname;
      status.textContent = 'Saved ✓';
      status.style.color = '#22c55e';
      toast('NAS updated', 'success');
      this._loadList();
    } catch (err) {
      toast(err.message ?? 'Save failed', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  }

  // ── Sessions tab ──────────────────────────────────────────────────────────
  async _renderSessions() {
    const tc = this.$('#tab-content');
    tc.innerHTML =
      '<div style="padding:1rem;color:var(--color-muted);font-size:0.8rem;">Loading sessions…</div>';
    try {
      const sessions = await api.get(`/nas/${this._selectedId}/sessions`);
      const refreshBtn =
        `<div style="display:flex;justify-content:flex-end;padding:0.5rem 0;"><button class="btn btn-ghost" style="padding:0.3rem 0.65rem;font-size:0.75rem;" id="btn-refresh-sess">↻ Refresh</button></div>`;
      if (!sessions.length) {
        tc.innerHTML = refreshBtn + '<div class="empty-msg">No active sessions for this NAS</div>';
      } else {
        tc.innerHTML = refreshBtn + `
          <table class="sessions-table">
            <thead>
              <tr>
                <th>Username</th><th>Port</th><th>Framed IP</th><th>MAC</th>
                <th>Started</th><th>Duration</th><th>↓ In</th><th>↑ Out</th>
              </tr>
            </thead>
            <tbody>
              ${
          sessions.map((s) => `
                <tr>
                  <td><span class="nav-user" data-user="${
            escHtml(s.username ?? '')
          }" style="cursor:pointer;color:var(--color-accent);">${
            escHtml(s.username ?? '—')
          }</span></td>
                  <td>${escHtml(s.nasportid ?? '—')}</td>
                  <td>${escHtml(s.framedipaddress ?? '—')}</td>
                  <td>${escHtml(s.callingstationid ?? '—')}</td>
                  <td>${fmtDate(s.acctstarttime)}</td>
                  <td>${fmtDuration(s.acctsessiontime)}</td>
                  <td>${fmtBytes(s.acctinputoctets)}</td>
                  <td>${fmtBytes(s.acctoutputoctets)}</td>
                </tr>
              `).join('')
        }
            </tbody>
          </table>
        `;
      }
      tc.querySelector('#btn-refresh-sess')?.addEventListener(
        'click',
        () => this._renderSessions(),
      );
      tc.querySelectorAll('span.nav-user').forEach((el) => {
        el.addEventListener('click', () => {
          const u = el.dataset.user;
          if (u) router.navigate(`/users/${encodeURIComponent(u)}`);
        });
      });
    } catch (err) {
      tc.innerHTML = `<div class="empty-msg">Failed to load sessions: ${
        escHtml(err.message)
      }</div>`;
    }
  }

  // ── Groups tab ────────────────────────────────────────────────────────────
  async _renderGroupsTab() {
    const tc = this.$('#tab-content');
    tc.innerHTML =
      '<div style="padding:1rem;color:var(--color-muted);font-size:0.8rem;">Loading…</div>';
    try {
      const [memberships, allGroupsData] = await Promise.all([
        api.get(`/nas/${this._selectedId}/groups`),
        api.get('/nas/groups/list?size=100'),
      ]);
      const memberGroupIds = new Set(memberships.map((m) => m.group_id));
      const available = allGroupsData.items.filter((g) => !memberGroupIds.has(g.id));

      tc.innerHTML = `
        <div class="section-label">Member of</div>
        ${
        memberships.length
          ? `
          <table class="sessions-table">
            <thead><tr><th>Group</th><th>Description</th><th></th></tr></thead>
            <tbody>
              ${
            memberships.map((m) => `
                <tr data-member-id="${m.member_id}" data-group-id="${m.group_id}">
                  <td style="font-weight:500;">${escHtml(m.group_name)}</td>
                  <td style="color:var(--color-muted);font-size:0.78rem;">${
              escHtml(m.group_description ?? '')
            }</td>
                  <td style="text-align:right;">
                    <button class="btn btn-secondary btn-rm-group" style="padding:0.25rem 0.6rem;font-size:0.75rem;">Remove</button>
                  </td>
                </tr>
              `).join('')
          }
            </tbody>
          </table>
        `
          : '<div class="empty-msg">Not in any NAS group</div>'
      }

        <div class="section-label">Add to Group</div>
        ${
        available.length
          ? `
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
            <select id="group-add-sel" style="flex:1;background:var(--color-bg);border:1px solid var(--color-border);border-radius:6px;color:var(--color-text);padding:0.45rem 0.65rem;font-size:0.8rem;font-family:inherit;">
              <option value="">— select a NAS group —</option>
              ${
            available.map((g) =>
              `<option value="${g.id}">${escHtml(g.name)}${
                g.description ? ' — ' + escHtml(g.description) : ''
              }</option>`
            ).join('')
          }
            </select>
            <button class="btn btn-primary" id="btn-add-to-group">Add</button>
          </div>
        `
          : '<p style="color:var(--color-muted);font-size:0.8rem;margin-top:0.5rem;">This device is in all available groups.</p>'
      }
      `;

      tc.querySelectorAll('.btn-rm-group').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('tr');
          const memberId = parseInt(row.dataset.memberId);
          const groupId = parseInt(row.dataset.groupId);
          const m = memberships.find((x) => x.member_id === memberId);
          if (
            !(await confirmDialog(`Remove this NAS from group "${m?.group_name}"?`, {
              title: 'Remove from group',
              danger: true,
            }))
          ) return;
          try {
            await api.delete(`/nas/groups/${groupId}/members/${memberId}`);
            toast('Removed from group', 'success');
            this._renderGroupsTab();
          } catch (e) {
            toast(e.message || 'Remove failed', 'error');
          }
        });
      });

      const addBtn = tc.querySelector('#btn-add-to-group');
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          const groupId = tc.querySelector('#group-add-sel').value;
          if (!groupId) {
            toast('Select a group', 'warning');
            return;
          }
          try {
            await api.post(`/nas/groups/${groupId}/members?nas_id=${this._selectedId}`);
            toast('Added to group', 'success');
            this._renderGroupsTab();
          } catch (e) {
            toast(e.message || 'Add failed', 'error');
          }
        });
      }
    } catch (err) {
      tc.innerHTML = `<div class="empty-msg">Failed: ${escHtml(err.message)}</div>`;
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async _deleteSelected() {
    if (!this._selectedId) return;
    const name = this._selectedNas?.shortname || this._selectedNas?.nasname || 'this NAS';
    if (
      !(await confirmDialog(`Delete "${name}"? This cannot be undone.`, {
        title: 'Delete NAS',
        danger: true,
      }))
    ) return;
    try {
      await api.delete(`/nas/${this._selectedId}`);
      toast(`${name} deleted`, 'success');
      this._selectedId = null;
      this._selectedNas = null;
      this.$('#detail-empty').classList.remove('hidden');
      this.$('#detail-inner').classList.add('hidden');
      this.$('#list-panel').classList.remove('narrow');
      this._loadList();
    } catch (err) {
      toast(err.message ?? 'Delete failed', 'error');
    }
  }

  // ── Create modal ──────────────────────────────────────────────────────────
  _openModal() {
    this._resetModal();
    clearFieldErrors(this.shadowRoot);
    this.$('#modal').classList.remove('hidden');
    this.$('#m-nasname').focus();
  }

  _closeModal() {
    this.$('#modal').classList.add('hidden');
  }

  _resetModal() {
    ['#m-nasname', '#m-shortname', '#m-secret', '#m-community', '#m-description'].forEach((s) => {
      this.$(s).value = '';
    });
    this.$('#m-type').value = 'other';
    this.$('#m-ports').value = '';
    this.$('#m-secret').type = 'password';
  }

  _applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    this.$('#m-type').value = p.type;
    this.$('#m-community').value = p.community ?? '';
    this.$('#m-description').value = p.description ?? '';
    if (p.ports) this.$('#m-ports').value = p.ports;
    this.$('#m-nasname').focus();
  }

  async _submitCreate() {
    clearFieldErrors(this.shadowRoot);
    const nameInput = this.$('#m-nasname');
    const secretInput = this.$('#m-secret');
    const nasname = nameInput.value.trim();
    const secret = secretInput.value.trim();
    let ok = true;
    if (!nasname) {
      setFieldError(nameInput, 'IP / Hostname is required');
      ok = false;
    }
    if (!secret) {
      setFieldError(secretInput, 'Shared secret is required');
      ok = false;
    }
    if (!ok) return;

    const portsVal = this.$('#m-ports').value;
    const payload = {
      nasname,
      shortname: this.$('#m-shortname').value.trim(),
      type: this.$('#m-type').value || 'other',
      ports: portsVal ? parseInt(portsVal) : null,
      secret,
      community: this.$('#m-community').value.trim() || null,
      description: this.$('#m-description').value.trim() || null,
    };

    const btn = this.$('#modal-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-inline"></span>Adding…';
    try {
      const created = await api.post('/nas', payload);
      toast(`NAS "${created.shortname || created.nasname}" added`, 'success');
      this._closeModal();
      await this._loadList();
      this._selectNas(created.id);
    } catch (err) {
      // Field-level 422s (nasname/secret/ports/…) map straight onto #m-<field>;
      // the duplicate-name 409 is a string-detail HTTPException, so map it too.
      if (applyServerErrors(this.shadowRoot, err)) return;
      const msg = err.message ?? 'Create failed';
      if (/already exists/i.test(msg)) setFieldError(nameInput, msg);
      else toast(msg, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add NAS';
    }
  }

  // ── Zabbix Alarms tab ─────────────────────────────────────────────────────

  async _renderZabbixTab() {
    const tc = this.$('#tab-content');
    const nas = this._selectedNas;
    if (!nas) return;
    const nasIp = nas.nasname;
    tc.innerHTML =
      `<div style="padding:1rem;color:var(--color-muted);font-size:0.8rem;">Fetching Zabbix alarms for ${
        escHtml(nasIp)
      }…</div>`;
    try {
      const data = await api.get(
        `/integrations/zabbix/host-problems?nas_ip=${encodeURIComponent(nasIp)}`,
      );
      if (!data.problems.length) {
        tc.innerHTML =
          `<div style="padding:1.5rem;color:var(--color-muted);font-size:0.85rem;text-align:center;">No active alarms for <strong>${
            escHtml(nasIp)
          }</strong>.</div>`;
        return;
      }
      const severityColor = {
        'Disaster': '#dc2626',
        'High': 'var(--color-danger)',
        'Average': 'orange',
        'Warning': 'orange',
        'Information': 'var(--color-accent)',
        'Not classified': 'var(--color-muted)',
      };
      tc.innerHTML = `
        <div style="padding:0.75rem 0;font-size:0.78rem;color:var(--color-muted);">${data.count} active alarm(s)</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
          <thead><tr>
            <th style="text-align:left;padding:0.4rem 0.5rem;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--color-muted);border-bottom:1px solid var(--color-border);">Severity</th>
            <th style="text-align:left;padding:0.4rem 0.5rem;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--color-muted);border-bottom:1px solid var(--color-border);">Problem</th>
            <th style="text-align:left;padding:0.4rem 0.5rem;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--color-muted);border-bottom:1px solid var(--color-border);">Since</th>
            <th style="text-align:left;padding:0.4rem 0.5rem;font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--color-muted);border-bottom:1px solid var(--color-border);">ACK</th>
          </tr></thead>
          <tbody>
            ${
        data.problems.map((p) => `
              <tr>
                <td style="padding:0.4rem 0.5rem;border-bottom:1px solid var(--color-border);font-weight:600;color:${
          escHtml(severityColor[p.severity] || 'inherit')
        };">${escHtml(p.severity)}</td>
                <td style="padding:0.4rem 0.5rem;border-bottom:1px solid var(--color-border);">${
          escHtml(p.name)
        }</td>
                <td style="padding:0.4rem 0.5rem;border-bottom:1px solid var(--color-border);color:var(--color-muted);white-space:nowrap;">${
          p.clock ? new Date(p.clock * 1000).toLocaleString() : '—'
        }</td>
                <td style="padding:0.4rem 0.5rem;border-bottom:1px solid var(--color-border);">${
          p.acknowledged ? '✓' : '—'
        }</td>
              </tr>
            `).join('')
      }
          </tbody>
        </table>
      `;
    } catch (err) {
      if (err.message && err.message.includes('No enabled zabbix')) {
        tc.innerHTML =
          `<div style="padding:1.5rem;color:var(--color-muted);font-size:0.85rem;text-align:center;">No Zabbix integration configured. <a href="#" id="go-integrations" style="color:var(--color-accent);">Set it up here</a>.</div>`;
        tc.querySelector('#go-integrations')?.addEventListener('click', (e) => {
          e.preventDefault();
          router.push('/integrations');
        });
      } else {
        tc.innerHTML =
          `<div style="padding:1rem;color:var(--color-danger);font-size:0.82rem;">Error: ${
            escHtml(err.message)
          }</div>`;
      }
    }
  }
}

customElements.define('nas-view', NasView);

// ── NAS Groups ────────────────────────────────────────────────────────────────

const NG_STYLE = `
  <style>
    @import '/css/theme.css';
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { display: flex; height: 100%; overflow: hidden; }
    .hidden { display: none !important; }

    .list-panel {
      display: flex; flex-direction: column;
      width: 360px; min-width: 220px; flex-shrink: 0;
      border-right: 1px solid var(--color-border);
      background: var(--color-surface); transition: width 0.2s;
    }
    .list-panel.narrow { width: 260px; }

    .list-header {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 1rem; border-bottom: 1px solid var(--color-border);
    }
    .list-header h2 { font-size: 0.95rem; font-weight: 600; flex: 1; }

    .search-wrap { padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); }
    .search-wrap input {
      width: 100%; padding: 0.45rem 0.7rem; font-size: 0.8rem;
      background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: 6px; color: var(--color-text);
    }
    .search-wrap input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }

    .group-list { flex: 1; overflow-y: auto; }
    .group-item {
      display: flex; flex-direction: column; gap: 0.15rem;
      padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border);
      cursor: pointer; transition: background 0.1s;
    }
    .group-item:hover { background: rgba(99,102,241,0.06); }
    .group-item.active { background: rgba(99,102,241,0.12); }
    .group-name { font-size: 0.875rem; font-weight: 500; }
    .group-desc { font-size: 0.72rem; color: var(--color-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .group-meta { display: flex; gap: 0.4rem; margin-top: 0.15rem; }
    .meta-chip {
      font-size: 0.68rem; padding: 0.1rem 0.4rem; border-radius: 4px;
      background: rgba(148,163,184,0.1); color: var(--color-muted);
    }

    .pager {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.5rem 1rem; border-top: 1px solid var(--color-border);
      font-size: 0.75rem; color: var(--color-muted);
    }
    .pager button {
      background: none; border: 1px solid var(--color-border); border-radius: 4px;
      color: var(--color-text); padding: 0.2rem 0.6rem; cursor: pointer; font-size: 0.75rem;
    }
    .pager button:disabled { opacity: 0.35; cursor: default; }

    .detail-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .detail-empty {
      flex: 1; display: flex; align-items: center; justify-content: center;
      color: var(--color-muted); font-size: 0.875rem;
    }
    .detail-inner { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .detail-header {
      padding: 1rem 1.5rem; border-bottom: 1px solid var(--color-border);
      display: flex; align-items: center; gap: 0.75rem;
    }
    .detail-header h3 { font-size: 1rem; font-weight: 600; flex: 1; }

    .tabs { display: flex; border-bottom: 1px solid var(--color-border); padding: 0 1.5rem; }
    .tab-btn {
      background: none; border: none; border-bottom: 2px solid transparent;
      padding: 0.6rem 0.9rem; cursor: pointer; font-size: 0.8rem;
      color: var(--color-muted); margin-bottom: -1px;
    }
    .tab-btn.active { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: 500; }

    .tab-content { flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem; }

    .section-label {
      font-size: 0.7rem; font-weight: 600; color: var(--color-muted);
      text-transform: uppercase; letter-spacing: 0.05em;
      margin: 1.25rem 0 0.6rem 0; padding-bottom: 0.35rem;
      border-bottom: 1px solid var(--color-border);
    }
    .section-label:first-child { margin-top: 0; }

    .data-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .data-table th {
      text-align: left; padding: 0.4rem 0.6rem;
      color: var(--color-muted); font-size: 0.7rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.05em;
      border-bottom: 1px solid var(--color-border);
    }
    .data-table td { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--color-border); }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table tr:hover td { background: rgba(99,102,241,0.04); }

    .add-row { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.75rem; }
    .add-row select, .add-row input {
      flex: 1; padding: 0.45rem 0.65rem; font-size: 0.8rem; font-family: inherit;
      background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: 6px; color: var(--color-text);
    }
    .add-row select:focus, .add-row input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }

    .empty-msg { text-align: center; padding: 2rem; color: var(--color-muted); font-size: 0.8rem; }

    .btn {
      padding: 0.45rem 0.9rem; border: none; border-radius: 6px;
      font-size: 0.8rem; cursor: pointer; font-family: inherit;
    }
    .btn-primary { background: var(--color-accent); color: #fff; }
    .btn-primary:hover { background: var(--color-accent-hover, #4f46e5); }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-ghost { background: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text); }
    .btn:disabled { opacity: 0.45; cursor: not-allowed; }

    .icon-btn {
      background: none; border: none; cursor: pointer;
      padding: 0.2rem 0.35rem; border-radius: 4px;
      font-size: 0.85rem; color: var(--color-muted);
    }
    .icon-btn:hover { color: var(--color-danger); background: rgba(239,68,68,0.1); }

    .modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .modal-backdrop.hidden { display: none; }
    .modal {
      background: var(--color-surface); border: 1px solid var(--color-border);
      border-radius: 12px; padding: 1.5rem; width: 420px; max-width: 95vw;
    }
    .modal-header { display: flex; align-items: center; margin-bottom: 1.25rem; }
    .modal-header h3 { font-size: 1rem; font-weight: 600; flex: 1; }
    .modal-close { background: none; border: none; color: var(--color-muted); font-size: 1.2rem; cursor: pointer; }
    .modal-footer { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.25rem; }

    .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.75rem; }
    .field label { font-size: 0.75rem; color: var(--color-muted); font-weight: 500; }
    .field input {
      background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: 6px; color: var(--color-text); padding: 0.45rem 0.65rem;
      font-size: 0.8rem; font-family: inherit; width: 100%;
    }
    .field input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }

    .badge-type {
      font-size: 0.68rem; padding: 0.1rem 0.4rem; border-radius: 4px;
      background: rgba(99,102,241,0.12); color: var(--color-accent);
    }

    .spinner-inline {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
      border-radius: 50%; animation: spin 0.7s linear infinite; margin-right: 4px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
`;

const NG_TEMPLATE = `
${NG_STYLE}
<div class="list-panel" id="ng-list-panel">
  <div class="list-header">
    <h2>NAS Groups</h2>
    <button class="btn btn-primary" id="ng-btn-create" style="padding:0.35rem 0.75rem;font-size:0.78rem;">+ Create</button>
  </div>
  <div class="search-wrap">
    <input id="ng-search" type="search" placeholder="Search groups…" />
  </div>
  <div class="group-list" id="ng-group-list"></div>
  <div class="pager" id="ng-pager"></div>
</div>

<div class="detail-panel" id="ng-detail-panel">
  <div class="detail-empty" id="ng-detail-empty">Select a NAS group from the list</div>
  <div class="detail-inner hidden" id="ng-detail-inner">
    <div class="detail-header">
      <div>
        <h3 id="ng-detail-title"></h3>
        <div id="ng-detail-desc" style="font-size:0.75rem;color:var(--color-muted);margin-top:0.15rem;"></div>
      </div>
      <button class="btn btn-danger" id="ng-btn-delete" style="padding:0.3rem 0.7rem;font-size:0.78rem;">Delete</button>
    </div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="devices">Devices</button>
      <button class="tab-btn" data-tab="radius-groups">RADIUS Groups</button>
    </div>
    <div class="tab-content" id="ng-tab-content"></div>
  </div>
</div>

<div class="modal-backdrop hidden" id="ng-modal">
  <div class="modal">
    <div class="modal-header">
      <h3>Create NAS Group</h3>
      <button class="modal-close" id="ng-modal-close">✕</button>
    </div>
    <div class="field">
      <label>Group Name *</label>
      <input id="ng-m-name" placeholder="e.g. ISP-Core" maxlength="64" />
    </div>
    <div class="field">
      <label>Description</label>
      <input id="ng-m-desc" placeholder="optional" maxlength="200" />
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="ng-modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="ng-modal-submit">Create</button>
    </div>
  </div>
</div>
`;

class NasGroupsView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._page = 1;
    this._search = '';
    this._selectedId = null;
    this._selectedGroup = null;
    this._searchTimer = null;
    this._activeTab = 'devices';
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = NG_TEMPLATE;
    this._bindStatic();
    this._loadList();
  }

  $(s) {
    return this.shadowRoot.querySelector(s);
  }

  _bindStatic() {
    this.$('#ng-btn-create').addEventListener('click', () => this._openModal());
    this.$('#ng-modal-close').addEventListener('click', () => this._closeModal());
    this.$('#ng-modal-cancel').addEventListener('click', () => this._closeModal());
    this.$('#ng-modal-submit').addEventListener('click', () => this._submitCreate());
    this.$('#ng-modal').addEventListener('click', (e) => {
      if (e.target === this.$('#ng-modal')) this._closeModal();
    });
    this.$('#ng-search').addEventListener('input', (e) => {
      const value = e.target.value.trim(); // capture now: e.target retargets to the shadow host once dispatch ends
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._search = value;
        this._page = 1;
        this._loadList();
      }, 300);
    });
    this.$('#ng-btn-delete').addEventListener('click', () => this._deleteSelected());
  }

  // ── List ──────────────────────────────────────────────────────────────────
  async _loadList() {
    const list = this.$('#ng-group-list');
    list.innerHTML = skeletonBlock(this.shadowRoot, 6);
    try {
      const data = await api.get(
        `/nas/groups/list?page=${this._page}&size=20&search=${encodeURIComponent(this._search)}`,
      );
      this._renderList(data);
    } catch (err) {
      list.innerHTML = emptyStateHTML({
        title: 'Couldn’t load NAS groups',
        message: err.message || 'Something went wrong. Try again.',
      });
    }
  }

  _renderList(data) {
    const list = this.$('#ng-group-list');
    if (!data.items.length) {
      list.innerHTML = emptyStateHTML({
        title: this._search ? 'No matching groups' : 'No NAS groups yet',
        message: this._search
          ? `Nothing matches “${this._search}”. Try a different search.`
          : 'Create a NAS group to apply shared settings across devices.',
      });
      this._renderPager(data);
      return;
    }
    list.innerHTML = data.items.map((g) => `
      <div class="group-item${g.id === this._selectedId ? ' active' : ''}" data-id="${g.id}">
        <div class="group-name">${escHtml(g.name)}</div>
        ${g.description ? `<div class="group-desc">${escHtml(g.description)}</div>` : ''}
        <div class="group-meta">
          <span class="meta-chip">${g.device_count} device${g.device_count !== 1 ? 's' : ''}</span>
          <span class="meta-chip">${g.radius_group_count} RADIUS group${
      g.radius_group_count !== 1 ? 's' : ''
    }</span>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.group-item').forEach((el) => {
      el.addEventListener('click', () => this._selectGroup(parseInt(el.dataset.id)));
    });
    this._renderPager(data);
  }

  _renderPager(data) {
    const pager = this.$('#ng-pager');
    const totalPages = Math.max(1, Math.ceil(data.total / data.size));
    pager.innerHTML = `
      <button id="ng-p-prev" ${this._page <= 1 ? 'disabled' : ''}>‹ Prev</button>
      <span>${this._page} / ${totalPages} (${data.total})</span>
      <button id="ng-p-next" ${this._page >= totalPages ? 'disabled' : ''}>Next ›</button>
    `;
    pager.querySelector('#ng-p-prev')?.addEventListener('click', () => {
      this._page--;
      this._loadList();
    });
    pager.querySelector('#ng-p-next')?.addEventListener('click', () => {
      this._page++;
      this._loadList();
    });
  }

  // ── Detail ────────────────────────────────────────────────────────────────
  async _selectGroup(id) {
    this._selectedId = id;
    this._activeTab = 'devices';
    this.shadowRoot.querySelectorAll('.group-item').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.id) === id);
    });
    this.$('#ng-list-panel').classList.add('narrow');
    this.$('#ng-detail-empty').classList.add('hidden');
    this.$('#ng-detail-inner').classList.remove('hidden');
    this.$('#ng-tab-content').innerHTML =
      '<div style="padding:1rem;color:var(--color-muted);font-size:0.8rem;">Loading…</div>';
    try {
      this._selectedGroup = await api.get(`/nas/groups/${id}`);
      this.$('#ng-detail-title').textContent = this._selectedGroup.name;
      this.$('#ng-detail-desc').textContent = this._selectedGroup.description ?? '';
      this._bindTabs();
      this._renderTab();
    } catch (err) {
      this.$('#ng-tab-content').innerHTML = `<div class="empty-msg">Failed: ${
        escHtml(err.message)
      }</div>`;
    }
  }

  _bindTabs() {
    this.shadowRoot.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.onclick = () => {
        this.shadowRoot.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this._activeTab = btn.dataset.tab;
        this._renderTab();
      };
    });
  }

  _renderTab() {
    if (this._activeTab === 'devices') this._renderDevicesTab();
    else if (this._activeTab === 'radius-groups') this._renderRadiusGroupsTab();
  }

  // ── Devices tab ───────────────────────────────────────────────────────────
  async _renderDevicesTab() {
    const tc = this.$('#ng-tab-content');
    tc.innerHTML =
      '<div style="padding:1rem;color:var(--color-muted);font-size:0.8rem;">Loading…</div>';
    try {
      const [members, allNasData] = await Promise.all([
        api.get(`/nas/groups/${this._selectedId}/members`),
        api.get('/nas?size=100'),
      ]);
      const memberNasIds = new Set(members.map((m) => m.nas_id));
      const available = allNasData.items.filter((n) => !memberNasIds.has(n.id));

      tc.innerHTML = `
        <div class="section-label">Devices in this Group</div>
        ${
        members.length
          ? `
          <table class="data-table">
            <thead><tr><th>IP / Host</th><th>Name</th><th>Type</th><th></th></tr></thead>
            <tbody>
              ${
            members.map((m) => `
                <tr data-member-id="${m.id}">
                  <td style="font-family:monospace;font-size:0.75rem;">${escHtml(m.nasname)}</td>
                  <td>${escHtml(m.shortname)}</td>
                  <td><span class="badge-type">${escHtml(m.type)}</span></td>
                  <td style="text-align:right;"><button class="icon-btn btn-rm-member" title="Remove from group">✕</button></td>
                </tr>
              `).join('')
          }
            </tbody>
          </table>
        `
          : '<div class="empty-msg">No devices in this group</div>'
      }

        <div class="section-label">Add Device</div>
        ${
        available.length
          ? `
          <div class="add-row">
            <select id="nas-add-select">
              <option value="">— select a NAS device —</option>
              ${
            available.map((n) =>
              `<option value="${n.id}">${escHtml(n.shortname || n.nasname)} (${
                escHtml(n.nasname)
              })</option>`
            ).join('')
          }
            </select>
            <button class="btn btn-primary" id="btn-add-nas">Add</button>
          </div>
        `
          : '<p style="color:var(--color-muted);font-size:0.8rem;margin-top:0.5rem;">All NAS devices are already in this group.</p>'
      }
      `;

      tc.querySelectorAll('.btn-rm-member').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('tr');
          const memberId = parseInt(row.dataset.memberId);
          const member = members.find((m) => m.id === memberId);
          if (
            !(await confirmDialog(
              `Remove ${member?.shortname || member?.nasname || 'device'} from this group?`,
              { title: 'Remove device', danger: true },
            ))
          ) return;
          try {
            await api.delete(`/nas/groups/${this._selectedId}/members/${memberId}`);
            toast('Device removed from group', 'success');
            this._renderDevicesTab();
            this._loadList();
          } catch (err) {
            toast(err.message || 'Remove failed', 'error');
          }
        });
      });

      const addBtn = tc.querySelector('#btn-add-nas');
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          const nasId = tc.querySelector('#nas-add-select').value;
          if (!nasId) {
            toast('Select a NAS device', 'warning');
            return;
          }
          try {
            await api.post(`/nas/groups/${this._selectedId}/members?nas_id=${nasId}`);
            toast('Device added to group', 'success');
            this._renderDevicesTab();
            this._loadList();
          } catch (err) {
            toast(err.message || 'Add failed', 'error');
          }
        });
      }
    } catch (err) {
      tc.innerHTML = `<div class="empty-msg">Failed: ${escHtml(err.message)}</div>`;
    }
  }

  // ── RADIUS Groups tab ─────────────────────────────────────────────────────
  async _renderRadiusGroupsTab() {
    const tc = this.$('#ng-tab-content');
    tc.innerHTML =
      '<div style="padding:1rem;color:var(--color-muted);font-size:0.8rem;">Loading…</div>';
    try {
      const links = await api.get(`/nas/groups/${this._selectedId}/radius-groups`);

      let availableGroups = [];
      try {
        const linkedNames = new Set(links.map((l) => l.radius_groupname));
        const gData = await api.get('/groups?size=100');
        availableGroups = gData.items.filter((g) => !linkedNames.has(g.name));
      } catch { /* not critical — fall back to text input */ }

      tc.innerHTML = `
        <div class="section-label">Linked RADIUS Groups</div>
        ${
        links.length
          ? `
          <table class="data-table">
            <thead><tr><th>RADIUS Group Name</th><th></th></tr></thead>
            <tbody>
              ${
            links.map((l) => `
                <tr data-link-id="${l.id}">
                  <td>${escHtml(l.radius_groupname)}</td>
                  <td style="text-align:right;"><button class="icon-btn btn-rm-link" title="Unlink">✕</button></td>
                </tr>
              `).join('')
          }
            </tbody>
          </table>
        `
          : '<div class="empty-msg">No RADIUS groups linked</div>'
      }

        <div class="section-label">Link RADIUS Group</div>
        <div class="add-row">
          ${
        availableGroups.length
          ? `<select id="rg-add-sel">
                 <option value="">— select RADIUS group —</option>
                 ${
            availableGroups.map((g) =>
              `<option value="${escHtml(g.name)}">${escHtml(g.name)}</option>`
            ).join('')
          }
               </select>`
          : `<input id="rg-add-inp" placeholder="RADIUS group name" maxlength="64" />`
      }
          <button class="btn btn-primary" id="btn-link-rg">Link</button>
        </div>
      `;

      tc.querySelectorAll('.btn-rm-link').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('tr');
          const linkId = parseInt(row.dataset.linkId);
          const link = links.find((l) => l.id === linkId);
          if (
            !(await confirmDialog(`Unlink RADIUS group "${link?.radius_groupname}"?`, {
              title: 'Unlink group',
              danger: true,
            }))
          ) return;
          try {
            await api.delete(`/nas/groups/${this._selectedId}/radius-groups/${linkId}`);
            toast('RADIUS group unlinked', 'success');
            this._renderRadiusGroupsTab();
            this._loadList();
          } catch (err) {
            toast(err.message || 'Unlink failed', 'error');
          }
        });
      });

      tc.querySelector('#btn-link-rg').addEventListener('click', async () => {
        const el = tc.querySelector('#rg-add-sel') || tc.querySelector('#rg-add-inp');
        const groupname = el?.value?.trim();
        if (!groupname) {
          toast('Select or enter a RADIUS group name', 'warning');
          return;
        }
        try {
          await api.post(`/nas/groups/${this._selectedId}/radius-groups`, {
            radius_groupname: groupname,
          });
          toast('RADIUS group linked', 'success');
          this._renderRadiusGroupsTab();
          this._loadList();
        } catch (err) {
          toast(err.message || 'Link failed', 'error');
        }
      });
    } catch (err) {
      tc.innerHTML = `<div class="empty-msg">Failed: ${escHtml(err.message)}</div>`;
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async _deleteSelected() {
    if (!this._selectedId) return;
    const name = this._selectedGroup?.name || 'this group';
    if (
      !(await confirmDialog(
        `Delete NAS group "${name}"? All device and RADIUS group links will be removed.`,
        { title: 'Delete NAS group', danger: true },
      ))
    ) return;
    try {
      await api.delete(`/nas/groups/${this._selectedId}`);
      toast(`Group "${name}" deleted`, 'success');
      this._selectedId = null;
      this._selectedGroup = null;
      this.$('#ng-detail-empty').classList.remove('hidden');
      this.$('#ng-detail-inner').classList.add('hidden');
      this.$('#ng-list-panel').classList.remove('narrow');
      this._loadList();
    } catch (err) {
      toast(err.message || 'Delete failed', 'error');
    }
  }

  // ── Create modal ──────────────────────────────────────────────────────────
  _openModal() {
    this.$('#ng-m-name').value = '';
    this.$('#ng-m-desc').value = '';
    clearFieldErrors(this.shadowRoot);
    this.$('#ng-modal').classList.remove('hidden');
    this.$('#ng-m-name').focus();
  }

  _closeModal() {
    this.$('#ng-modal').classList.add('hidden');
  }

  async _submitCreate() {
    clearFieldErrors(this.shadowRoot);
    const nameInput = this.$('#ng-m-name');
    const name = nameInput.value.trim();
    if (!name) {
      setFieldError(nameInput, 'Group name is required');
      return;
    }
    const desc = this.$('#ng-m-desc').value.trim() || null;
    const btn = this.$('#ng-modal-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-inline"></span>Creating…';
    try {
      const created = await api.post('/nas/groups/list', { name, description: desc });
      toast(`Group "${created.name}" created`, 'success');
      this._closeModal();
      await this._loadList();
      this._selectGroup(created.id);
    } catch (err) {
      // This form's only field is `name`; map both the 422 and the duplicate 409 onto it.
      if (applyServerErrors(this.shadowRoot, err, (f) => (f === 'name' ? nameInput : null))) return;
      const msg = err.message || 'Create failed';
      if (/already exists/i.test(msg)) setFieldError(nameInput, msg);
      else toast(msg, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create';
    }
  }
}

customElements.define('nas-groups-view', NasGroupsView);

// ── Workspace shell ────────────────────────────────────────────────────────────
// One page for the whole NAS surface: a Devices | NAS Groups switcher that hosts
// the device inventory (with per-device Overview / Sessions / Groups / Manage /
// Zabbix tabs) or the NAS-group manager. Replaces three separate nav entries.

const WS_STYLE = `
  <style>
    @import '/css/theme.css';
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
    .ws-switch {
      display: flex; gap: 0.35rem; padding: 0.5rem 0.85rem;
      border-bottom: 1px solid var(--color-border); background: var(--color-surface);
      flex-shrink: 0;
    }
    .ws-switch button {
      background: none; border: 1px solid transparent; border-radius: 6px;
      padding: 0.35rem 0.85rem; font-size: 0.8rem; font-weight: 500;
      color: var(--color-muted); cursor: pointer; font-family: inherit;
      transition: background 0.12s, color 0.12s;
    }
    .ws-switch button:hover { color: var(--color-text); }
    .ws-switch button.active {
      background: var(--mr-action-tint, rgba(99,102,241,0.12));
      color: var(--color-accent); font-weight: 600;
    }
    .ws-body { flex: 1; min-height: 0; display: flex; }
    .ws-body > * { flex: 1; min-height: 0; }
  </style>
`;

class NasWorkspace extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._view = 'devices';
  }

  connectedCallback() {
    const query = (location.hash.split('?')[1]) || '';
    if (new URLSearchParams(query).get('view') === 'groups') this._view = 'groups';

    this.shadowRoot.innerHTML = `
      ${WS_STYLE}
      <div class="ws-switch">
        <button data-v="devices">Devices</button>
        <button data-v="groups">NAS Groups</button>
      </div>
      <div class="ws-body" id="ws-body"></div>
    `;
    this.shadowRoot.querySelectorAll('.ws-switch button').forEach((b) => {
      b.addEventListener('click', () => this._switch(b.dataset.v));
    });
    this._render();
  }

  _switch(v) {
    if (v === this._view) return;
    this._view = v;
    this._render();
  }

  _render() {
    this.shadowRoot.querySelectorAll('.ws-switch button').forEach((b) => {
      b.classList.toggle('active', b.dataset.v === this._view);
    });
    const body = this.shadowRoot.getElementById('ws-body');
    body.replaceChildren(
      document.createElement(this._view === 'groups' ? 'nas-groups-view' : 'nas-view'),
    );
  }
}
customElements.define('nas-workspace', NasWorkspace);

// Redirect the retired standalone routes into the workspace so bookmarks work.
function _redirect(to) {
  queueMicrotask(() => router.navigate(to));
  const d = document.createElement('div');
  d.style.cssText = 'padding:2rem;color:var(--color-muted);font-size:0.8rem;';
  d.textContent = 'Redirecting…';
  return d;
}

router.register('/nas', () => document.createElement('nas-workspace'));
router.register('/nas-groups', () => _redirect('/nas?view=groups'));
