import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { applyServerErrors } from '/js/utils/form.js';
import { densityBarHTML, makeSortable, wireDensityBar } from '/js/utils/table.js';
import { emptyRowHTML } from '/js/utils/empty.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(
    /"/g,
    '&quot;',
  );
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

const STATUS_BADGE = {
  up: ['UP', 'badge-up'],
  timeout: ['TIMEOUT', 'badge-warn'],
  unreachable: ['UNREACHABLE', 'badge-down'],
  down: ['DOWN', 'badge-down'],
  unknown: ['UNKNOWN', 'badge-muted'],
};

function statusBadge(status) {
  const [label, cls] = STATUS_BADGE[status] || STATUS_BADGE.unknown;
  return `<span class="badge ${cls}">${label}</span>`;
}

const POOL_TYPES = ['fail-over', 'load-balance', 'client-balance', 'client-port-balance'];
const SERVER_TYPES = ['auth', 'acct', 'both'];
const LDAP_ENCRYPTION = ['none', 'starttls', 'ldaps'];

// How each NAS protocol is shown to the operator.
const PROTOCOL_LABEL = { pap: 'PAP', chap: 'CHAP', mschap: 'MS-CHAPv2', eap: 'EAP' };

const AUTH_METHODS = {
  local_password: {
    label: 'Local password',
    badge: 'badge-up',
    note: 'MonsterOps issues and stores each subscriber’s RADIUS password, so it ' +
      'works with any NAS protocol and stays available even when the directory is ' +
      'offline. AD passwords can’t be reused — the generated password is ' +
      'shown on the Users page. Optionally sync the user list from Active Directory below.',
  },
  directory_delegated: {
    label: 'Directory (AD) delegated',
    badge: 'badge-warn',
    note: 'FreeRADIUS validates every login live against Active Directory using the ' +
      'subscriber’s real AD password — MonsterOps stores no password. ' +
      'Supports MS-CHAPv2 and PAP only, and needs a live domain controller. ' +
      'Requires joining this RADIUS host to the domain (run ' +
      'deploy/provision-ad.sh) plus an AD identity source and its NetBIOS short domain.',
  },
};

function methodBadge(m) {
  const meta = AUTH_METHODS[m] || { label: m, badge: 'badge-muted' };
  return `<span class="badge ${meta.badge}">${esc(meta.label)}</span>`;
}

function protocolList(protocols) {
  if (!protocols || !protocols.length) return '<span class="muted">none</span>';
  return protocols.map((p) =>
    `<span class="badge badge-muted">${esc(PROTOCOL_LABEL[p] || p)}</span>`
  ).join(' ');
}

// Best-effort AD DNS realm (UPPERCASE) from an identity source's base DN, for
// pre-filling the provision-ad.sh command. Falls back to the host, then a hint.
function deriveAdRealm(src) {
  const dcs = String(src?.base_dn || '').split(',').map((x) => x.trim())
    .filter((x) => /^dc=/i.test(x)).map((x) => x.slice(3));
  if (dcs.length) return dcs.join('.').toUpperCase();
  if (src?.host) return String(src.host).toUpperCase();
  return '<AD.DNS.DOMAIN>';
}

const HOST_CHECK_ICON = { ok: '✓', fail: '✗', unknown: '•' };

const STYLE = `
  @import '/css/theme.css';
  :host { display: block; padding: 1.5rem; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
  .page-title  { font-size: 1.25rem; font-weight: 600; }
  .header-actions { display: flex; gap: 0.5rem; }
  .btn { padding: 0.4rem 0.85rem; border: 1px solid var(--color-border); border-radius: var(--radius);
         background: var(--color-surface); color: var(--color-text); font-size: 0.82rem; font-family: var(--font);
         cursor: pointer; white-space: nowrap; }
  .btn:hover { background: var(--color-bg); }
  .btn-primary { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
  .btn-primary:hover { opacity: 0.88; }
  .btn-danger { border-color: var(--color-danger); color: var(--color-danger); }
  .btn-danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
  .btn-sm { padding: 0.2rem 0.55rem; font-size: 0.75rem; }
  .tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--color-border); margin-bottom: 1rem; }
  .tab { padding: 0.5rem 1rem; font-size: 0.85rem; cursor: pointer; border: none; background: none;
         color: var(--color-muted); border-bottom: 2px solid transparent; font-family: var(--font); }
  .tab.active { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: 600; }
  .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th { text-align: left; padding: 0.45rem 0.75rem; font-size: 0.7rem; font-weight: 600;
       text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted);
       border-bottom: 1px solid var(--color-border); background: var(--color-bg); }
  td { padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  .empty { text-align: center; color: var(--color-muted); padding: 1.5rem; }
  .badge { display: inline-block; padding: 0.12rem 0.5rem; border-radius: 9999px; font-size: 0.68rem; font-weight: 600; }
  .badge-up    { background: var(--mr-accept-tint); color: var(--mr-accept); }
  .badge-warn  { background: color-mix(in srgb, var(--color-warning, #eab308) 15%, transparent); color: var(--color-warning, #eab308); }
  .badge-down  { background: var(--mr-reject-tint); color: var(--mr-reject); }
  .badge-muted { background: rgba(139,149,165,0.12); color: var(--color-muted); }
  .mono { font-family: var(--mr-font-data, monospace); font-size: 0.78rem; }
  .muted { color: var(--color-muted); }
  .vpn-warn { color: var(--mr-reject); font-size: 0.72rem; font-weight: 600; }
  .tab-toolbar { display: flex; justify-content: flex-end; margin-bottom: 0.75rem; }
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 500;
                   align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius);
           padding: 1.5rem; min-width: 420px; max-width: 640px; width: 90vw; max-height: 90vh; overflow-y: auto; }
  .modal-header { display: flex; align-items: center; margin-bottom: 1.25rem; }
  .modal-title  { font-size: 1rem; font-weight: 600; flex: 1; }
  .modal-close  { background: none; border: none; font-size: 1.1rem; cursor: pointer; color: var(--color-muted); }
  .modal-footer { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.25rem; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.85rem; }
  .field label { font-size: 0.78rem; font-weight: 500; color: var(--color-muted); }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .input, select.input { width: 100%; padding: 0.4rem 0.65rem; border: 1px solid var(--color-border); border-radius: var(--radius);
           background: var(--color-surface); color: var(--color-text); font-size: 0.85rem; font-family: var(--font);
           box-sizing: border-box; }
  .input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }
  .check-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.83rem; margin-bottom: 0.5rem; }
  .hint { font-size: 0.72rem; color: var(--color-muted); background: var(--color-bg); border: 1px solid var(--color-border);
          border-radius: var(--radius); padding: 0.5rem 0.65rem; margin-top: 0.25rem; line-height: 1.5; }
  .member-list { display: flex; flex-direction: column; gap: 0.35rem; max-height: 200px; overflow-y: auto;
                 border: 1px solid var(--color-border); border-radius: var(--radius); padding: 0.6rem; }
  .member-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.83rem; }
  pre.conf { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius);
             padding: 1rem; font-size: 0.75rem; overflow: auto; max-height: 55vh; white-space: pre; }
  .notice { display: flex; align-items: flex-start; gap: 0.6rem; border-radius: var(--radius); padding: 0.6rem 0.8rem;
            margin-bottom: 0.75rem; font-size: 0.8rem; line-height: 1.45; border: 1px solid; }
  .notice-warn { background: color-mix(in srgb, var(--color-warning, #eab308) 10%, transparent);
                 border-color: color-mix(in srgb, var(--color-warning, #eab308) 45%, transparent); }
  .notice-ok   { background: var(--mr-accept-tint); border-color: color-mix(in srgb, var(--mr-accept) 40%, transparent); }
  .notice .notice-body { flex: 1; }
  .notice .notice-icon { font-size: 1rem; line-height: 1.3; }
  .host-check { display: flex; align-items: flex-start; gap: 0.55rem; padding: 0.5rem 0; border-bottom: 1px solid var(--color-border); }
  .host-check:last-child { border-bottom: none; }
  .host-check .ic { font-size: 0.95rem; line-height: 1.3; width: 1.1rem; text-align: center; }
  .host-check .lbl { font-weight: 600; font-size: 0.82rem; }
  .host-check .dtl { color: var(--color-muted); font-size: 0.76rem; margin-top: 0.1rem; }
  .cmd-row { display: flex; gap: 0.5rem; align-items: stretch; }
  .cmd-row pre.conf { flex: 1; margin: 0; white-space: pre-wrap; word-break: break-all; }
`;

class RealmsView extends HTMLElement {
  constructor() {
    super();
    this._tab = 'realms'; // realms | servers | pools | auth | routing
    this._realms = [];
    this._servers = [];
    this._pools = [];
    this._auth = []; // authentication realms (identity source + method + policy)
    this._routes = [];
    this._nasGroups = [];
    this._vpnTunnels = [];
    this._groups = []; // MonsterOps group names, for the sync dropdowns
    this._editing = null; // object being edited in the modal, or null
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="page-header">
        <span class="page-title">Realms &amp; Proxy</span>
        <div class="header-actions">
          <button class="btn" id="btn-preview">Preview proxy.conf</button>
          <button class="btn btn-primary" id="btn-apply">Apply to FreeRADIUS</button>
        </div>
      </div>
      <div class="tabs">
        <button class="tab" data-tab="realms">Realms</button>
        <button class="tab" data-tab="servers">Home Servers</button>
        <button class="tab" data-tab="pools">Pools</button>
        <button class="tab" data-tab="auth">Authentication</button>
        <button class="tab" data-tab="routing">NAS Routing</button>
      </div>
      <div id="tab-body"></div>

      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title" id="modal-title"></span>
            <button class="modal-close" id="modal-close">✕</button>
          </div>
          <div id="modal-body"></div>
          <div class="modal-footer" id="modal-footer">
            <button class="btn" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-submit">Save</button>
          </div>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => {
        this._tab = t.dataset.tab;
        this._renderTab();
      })
    );
    this.shadowRoot.getElementById('btn-preview').addEventListener(
      'click',
      () => this._previewConf(),
    );
    this.shadowRoot.getElementById('btn-apply').addEventListener('click', () => this._applyConf());
    this.shadowRoot.getElementById('modal-close').addEventListener(
      'click',
      () => this._closeModal(),
    );
    this.shadowRoot.getElementById('modal-cancel').addEventListener(
      'click',
      () => this._closeModal(),
    );
    this.shadowRoot.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === this.shadowRoot.getElementById('modal-overlay')) this._closeModal();
    });

    this._loadAll();
  }

  async _loadAll() {
    try {
      const [realms, servers, pools, auth, routes] = await Promise.all([
        api.get('/realms'),
        api.get('/realms/servers'),
        api.get('/realms/pools'),
        api.get('/realms/auth-domains'),
        api.get('/realms/nas-routing'),
      ]);
      this._realms = realms;
      this._servers = servers;
      this._pools = pools;
      this._auth = auth;
      this._routes = routes;
    } catch (e) {
      toast(e.message || 'Failed to load realms data', 'error');
    }
    // best-effort: offer managed VPN tunnels for the home-server VPN interface
    try {
      this._vpnTunnels = await api.get('/vpn');
    } catch {
      this._vpnTunnels = [];
    }
    // best-effort: NAS groups for the realm's NAS-binding picker
    try {
      const res = await api.get('/nas/groups/list?size=100');
      this._nasGroups = res.items || [];
    } catch {
      this._nasGroups = [];
    }
    // best-effort: MonsterOps groups (service plans) for the LDAP sync dropdowns
    try {
      const g = await api.get('/groups');
      const arr = Array.isArray(g) ? g : (g?.groups || g?.items || []);
      this._groups = [...new Set(arr.map((x) => x.groupname || x.name || x).filter(Boolean))]
        .sort();
    } catch {
      this._groups = [];
    }
    this._renderTab();
  }

  // <option>s for a MonsterOps-group <select>. `blankLabel` adds a leading empty
  // option; `current` is pre-selected (and appended if not in the loaded list, so
  // editing never silently drops an existing value).
  _groupOptions(current, blankLabel) {
    const names = [...this._groups];
    if (current && !names.includes(current)) names.push(current);
    const blank = blankLabel ? `<option value="">${esc(blankLabel)}</option>` : '';
    return blank +
      names.map((n) =>
        `<option value="${esc(n)}" ${n === current ? 'selected' : ''}>${esc(n)}</option>`
      ).join('');
  }

  // ── Tab rendering ───────────────────────────────────────────────────────────

  _renderTab() {
    this.shadowRoot.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === this._tab)
    );
    const body = this.shadowRoot.getElementById('tab-body');
    switch (this._tab) {
      case 'realms':
        this._renderRealms(body);
        break;
      case 'servers':
        this._renderServers(body);
        break;
      case 'pools':
        this._renderPools(body);
        break;
      case 'auth':
        this._renderAuth(body);
        break;
      case 'routing':
        this._renderRouting(body);
        break;
    }
  }

  _renderRealms(body) {
    const rows = this._realms.map((r) => `
      <tr data-id="${r.id}">
        <td><strong>${esc(r.name)}</strong></td>
        <td>${r.pool_name ? esc(r.pool_name) : '<span class="muted">—</span>'}</td>
        <td>${statusBadge(r.status)}</td>
        <td class="mono" data-sort="${r.last_rtt_ms != null ? r.last_rtt_ms : -1}">${
      r.last_rtt_ms != null ? r.last_rtt_ms + ' ms' : '—'
    }</td>
        <td class="mono muted" data-sort="${Date.parse(r.last_probe_at) || 0}">${
      fmtDate(r.last_probe_at)
    }</td>
        <td>${r.strip_username ? '<span class="muted">strip</span>' : 'nostrip'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" data-act="edit">Edit</button>
          <button class="btn btn-sm btn-danger" data-act="del">Delete</button>
        </td>
      </tr>
    `).join('');
    body.innerHTML = `
      <div class="tab-toolbar">${densityBarHTML()}<button class="btn btn-primary" id="btn-add">+ Add Realm</button></div>
      <div class="card"><table>
        <thead><tr><th>Realm</th><th>Target</th><th>Status</th><th>RTT</th><th>Last Probe</th><th>Username</th><th></th></tr></thead>
        <tbody>${
      rows ||
      emptyRowHTML(7, {
        title: 'No realms configured',
        message: 'Add a realm to proxy authentication by username suffix.',
      })
    }</tbody>
      </table></div>
    `;
    body.querySelector('#btn-add').addEventListener('click', () => this._openRealmModal(null));
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const realm = this._realms.find((r) => r.id === Number(tr.dataset.id));
      tr.querySelector('[data-act=edit]').addEventListener(
        'click',
        () => this._openRealmModal(realm),
      );
      tr.querySelector('[data-act=del]').addEventListener('click', () => this._deleteRealm(realm));
    });
    if (this._realms.length) {
      makeSortable(body.querySelector('table'), { default: { col: 0, dir: 'asc' } });
    }
    wireDensityBar(body, () => body.querySelector('table'));
  }

  _renderServers(body) {
    const rows = this._servers.map((s) => `
      <tr data-id="${s.id}">
        <td><strong>${esc(s.name)}</strong></td>
        <td class="mono">${esc(s.host)}</td>
        <td class="mono muted">${s.auth_port} / ${s.acct_port}</td>
        <td>${esc(s.type)}</td>
        <td>
          ${statusBadge(s.status)}
          ${
      s.vpn_interface && s.vpn_interface_up === false
        ? `<div class="vpn-warn">⚠ VPN ${esc(s.vpn_interface)} is DOWN</div>`
        : ''
    }
        </td>
        <td class="mono" data-sort="${s.last_rtt_ms != null ? s.last_rtt_ms : -1}">${
      s.last_rtt_ms != null ? s.last_rtt_ms + ' ms' : '—'
    }</td>
        <td class="mono muted" data-sort="${Date.parse(s.last_seen_at) || 0}">${
      fmtDate(s.last_seen_at)
    }</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" data-act="probe">Probe</button>
          <button class="btn btn-sm" data-act="edit">Edit</button>
          <button class="btn btn-sm btn-danger" data-act="del">Delete</button>
        </td>
      </tr>
    `).join('');
    body.innerHTML = `
      <div class="tab-toolbar">${densityBarHTML()}<button class="btn btn-primary" id="btn-add">+ Add Home Server</button></div>
      <div class="card"><table>
        <thead><tr><th>Name</th><th>Host</th><th>Auth/Acct</th><th>Type</th><th>Status</th><th>RTT</th><th>Last Seen</th><th></th></tr></thead>
        <tbody>${
      rows ||
      emptyRowHTML(8, {
        title: 'No home servers configured',
        message: 'Add a home server to proxy authentication requests to.',
      })
    }</tbody>
      </table></div>
    `;
    body.querySelector('#btn-add').addEventListener('click', () => this._openServerModal(null));
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const srv = this._servers.find((s) => s.id === Number(tr.dataset.id));
      tr.querySelector('[data-act=probe]').addEventListener('click', () => this._probeServer(srv));
      tr.querySelector('[data-act=edit]').addEventListener(
        'click',
        () => this._openServerModal(srv),
      );
      tr.querySelector('[data-act=del]').addEventListener('click', () => this._deleteServer(srv));
    });
    if (this._servers.length) {
      makeSortable(body.querySelector('table'), { default: { col: 0, dir: 'asc' } });
    }
    wireDensityBar(body, () => body.querySelector('table'));
  }

  _renderPools(body) {
    const rows = this._pools.map((p) => `
      <tr data-id="${p.id}">
        <td><strong>${esc(p.name)}</strong></td>
        <td>${esc(p.pool_type)}</td>
        <td>${
      p.server_names.length
        ? p.server_names.map((n) => esc(n)).join(', ')
        : '<span class="muted">empty</span>'
    }</td>
        <td>${statusBadge(p.status)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" data-act="edit">Edit</button>
          <button class="btn btn-sm btn-danger" data-act="del">Delete</button>
        </td>
      </tr>
    `).join('');
    body.innerHTML = `
      <div class="tab-toolbar">${densityBarHTML()}<button class="btn btn-primary" id="btn-add">+ Add Pool</button></div>
      <div class="card"><table>
        <thead><tr><th>Pool</th><th>Type</th><th>Members</th><th>Status</th><th></th></tr></thead>
        <tbody>${
      rows ||
      emptyRowHTML(5, {
        title: 'No pools configured',
        message: 'Group home servers into a pool to load-balance or fail over between them.',
      })
    }</tbody>
      </table></div>
    `;
    body.querySelector('#btn-add').addEventListener('click', () => this._openPoolModal(null));
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const pool = this._pools.find((p) => p.id === Number(tr.dataset.id));
      tr.querySelector('[data-act=edit]').addEventListener(
        'click',
        () => this._openPoolModal(pool),
      );
      tr.querySelector('[data-act=del]').addEventListener('click', () => this._deletePool(pool));
    });
    wireDensityBar(body, () => body.querySelector('table'));
  }

  _renderRouting(body) {
    const rows = this._routes.map((r) => `
      <tr data-id="${r.id}">
        <td><strong>${esc(r.nas_group_name)}</strong></td>
        <td>→</td>
        <td>${esc(r.realm_name)}</td>
        <td style="text-align:right">
          <button class="btn btn-sm btn-danger" data-act="del">Remove</button>
        </td>
      </tr>
    `).join('');
    body.innerHTML = `
      <div class="tab-toolbar">${densityBarHTML()}<button class="btn btn-primary" id="btn-add">+ Add Route</button></div>
      <div class="card"><table>
        <thead><tr><th>NAS Group</th><th></th><th>Realm</th><th></th></tr></thead>
        <tbody>${
      rows ||
      emptyRowHTML(4, {
        title: 'No NAS group routes',
        message:
          'Auth from all NAS devices is routed by realm suffix only. Add a route to bind a NAS group to a realm.',
      })
    }</tbody>
      </table></div>
    `;
    body.querySelector('#btn-add').addEventListener('click', () => this._openRouteModal());
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const route = this._routes.find((r) => r.id === Number(tr.dataset.id));
      tr.querySelector('[data-act=del]').addEventListener('click', () => this._deleteRoute(route));
    });
    wireDensityBar(body, () => body.querySelector('table'));
  }

  // ── Modals ──────────────────────────────────────────────────────────────────

  _openModal(title, bodyHtml, onSubmit, submitLabel = 'Save') {
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    this.shadowRoot.getElementById('modal-title').textContent = title;
    this.shadowRoot.getElementById('modal-body').innerHTML = bodyHtml;
    const submit = this.shadowRoot.getElementById('modal-submit');
    submit.textContent = submitLabel;
    submit.style.display = onSubmit ? '' : 'none';
    submit.onclick = onSubmit;
    overlay.classList.add('open');
  }

  _closeModal() {
    this.shadowRoot.getElementById('modal-overlay').classList.remove('open');
    this._editing = null;
  }

  _mval(id) {
    return this.shadowRoot.getElementById(id)?.value?.trim() ?? '';
  }

  // — Realm modal —

  _openRealmModal(realm) {
    this._editing = realm;
    const pools = this._pools.map((p) =>
      `<option value="${p.id}" ${realm?.pool_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');
    this._openModal(
      realm ? `Edit Realm ${realm.name}` : 'Add Realm',
      `
      <div class="field">
        <label>Realm suffix</label>
        <input class="input" id="m-name" placeholder="corp-a.net" value="${esc(realm?.name)}" />
      </div>
      <div class="field">
        <label>Home server pool <span class="muted">(proxy)</span></label>
        <select class="input" id="m-pool">
          <option value="">— none (local) —</option>
          ${pools}
        </select>
      </div>
      <div class="check-row">
        <input type="checkbox" id="m-strip" ${
        realm ? (realm.strip_username ? 'checked' : '') : 'checked'
      } />
        <label for="m-strip">Strip realm suffix from User-Name before proxying</label>
      </div>
    `,
      () => this._saveRealm(),
    );
  }

  async _saveRealm() {
    const body = {
      name: this._mval('m-name'),
      pool_id: this._mval('m-pool') ? Number(this._mval('m-pool')) : null,
      strip_username: this.shadowRoot.getElementById('m-strip').checked,
    };
    try {
      if (this._editing) await api.put(`/realms/${this._editing.id}`, body);
      else await api.post('/realms', body);
      toast(`Realm ${body.name} saved`, 'success');
      this._closeModal();
      this._loadAll();
    } catch (e) {
      const box = this.shadowRoot.getElementById('modal-body');
      if (!applyServerErrors(box, e)) toast(e.message || 'Save failed', 'error');
    }
  }

  async _deleteRealm(realm) {
    if (!await confirmDialog(`Delete realm "${realm.name}"?`, { danger: true })) return;
    try {
      await api.delete(`/realms/${realm.id}`);
      toast(`Realm ${realm.name} deleted`, 'success');
      this._loadAll();
    } catch (e) {
      toast(e.message || 'Delete failed', 'error');
    }
  }

  // — Server modal —

  _openServerModal(srv) {
    this._editing = srv;
    const types = SERVER_TYPES.map((t) =>
      `<option value="${t}" ${srv?.type === t ? 'selected' : ''}>${t}</option>`
    ).join('');
    this._openModal(
      srv ? `Edit Home Server ${srv.name}` : 'Add Home Server',
      `
      <div class="field-row">
        <div class="field">
          <label>Name</label>
          <input class="input" id="m-name" placeholder="vpn-a-radius" value="${esc(srv?.name)}" />
        </div>
        <div class="field">
          <label>Host / IP</label>
          <input class="input" id="m-host" placeholder="10.8.0.10" value="${esc(srv?.host)}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Auth port</label>
          <input class="input" id="m-auth-port" type="number" min="1" max="65535" value="${
        srv?.auth_port ?? 1812
      }" />
        </div>
        <div class="field">
          <label>Acct port</label>
          <input class="input" id="m-acct-port" type="number" min="1" max="65535" value="${
        srv?.acct_port ?? 1813
      }" />
        </div>
      </div>
      <div class="field">
        <label>Shared secret ${srv ? '(leave blank to keep current)' : ''}</label>
        <input class="input" id="m-secret" type="password" autocomplete="new-password" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Type</label>
          <select class="input" id="m-type">${types}</select>
        </div>
        <div class="field">
          <label>VPN interface (optional)</label>
          <input class="input" id="m-vpn" list="m-vpn-list" placeholder="wg0 / tun0" value="${
        esc(srv?.vpn_interface)
      }" />
          <datalist id="m-vpn-list">
            ${
        this._vpnTunnels.map((t) =>
          `<option value="${esc(t.iface || t.name)}">${esc(t.name)} (${esc(t.type)})</option>`
        ).join('')
      }
          </datalist>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Response window (s)</label>
          <input class="input" id="m-response" type="number" min="1" max="300" value="${
        srv?.response_window ?? 20
      }" />
        </div>
        <div class="field">
          <label>Zombie period (s)</label>
          <input class="input" id="m-zombie" type="number" min="1" max="600" value="${
        srv?.zombie_period ?? 40
      }" />
        </div>
      </div>
      <div class="field">
        <label>Revive interval (s)</label>
        <input class="input" id="m-revive" type="number" min="10" max="3600" value="${
        srv?.revive_interval ?? 120
      }" />
      </div>
    `,
      () => this._saveServer(),
    );
  }

  async _saveServer() {
    const body = {
      name: this._mval('m-name'),
      host: this._mval('m-host'),
      auth_port: Number(this._mval('m-auth-port')) || 1812,
      acct_port: Number(this._mval('m-acct-port')) || 1813,
      secret: this.shadowRoot.getElementById('m-secret').value,
      type: this._mval('m-type'),
      vpn_interface: this._mval('m-vpn') || null,
      response_window: Number(this._mval('m-response')) || 20,
      zombie_period: Number(this._mval('m-zombie')) || 40,
      revive_interval: Number(this._mval('m-revive')) || 120,
    };
    try {
      if (this._editing) await api.put(`/realms/servers/${this._editing.id}`, body);
      else await api.post('/realms/servers', body);
      toast(`Home server ${body.name} saved`, 'success');
      this._closeModal();
      this._loadAll();
    } catch (e) {
      const box = this.shadowRoot.getElementById('modal-body');
      if (!applyServerErrors(box, e)) toast(e.message || 'Save failed', 'error');
    }
  }

  async _deleteServer(srv) {
    if (!await confirmDialog(`Delete home server "${srv.name}"?`, { danger: true })) return;
    try {
      await api.delete(`/realms/servers/${srv.id}`);
      toast(`Home server ${srv.name} deleted`, 'success');
      this._loadAll();
    } catch (e) {
      toast(e.message || 'Delete failed', 'error');
    }
  }

  async _probeServer(srv) {
    try {
      const updated = await api.post(`/realms/servers/${srv.id}/probe`, {});
      const [label] = STATUS_BADGE[updated.status] || STATUS_BADGE.unknown;
      toast(
        `${srv.name}: ${label}${updated.last_rtt_ms != null ? ` (${updated.last_rtt_ms} ms)` : ''}`,
        updated.status === 'up' ? 'success' : 'error',
      );
      this._loadAll();
    } catch (e) {
      toast(e.message || 'Probe failed', 'error');
    }
  }

  // — Pool modal —

  _openPoolModal(pool) {
    this._editing = pool;
    const types = POOL_TYPES.map((t) =>
      `<option value="${t}" ${pool?.pool_type === t ? 'selected' : ''}>${t}</option>`
    ).join('');
    const members = this._servers.map((s) => `
      <label class="member-item">
        <input type="checkbox" class="m-member" value="${s.id}"
          ${pool?.server_ids?.includes(s.id) ? 'checked' : ''} />
        ${esc(s.name)} <span class="muted mono">${esc(s.host)}</span> ${statusBadge(s.status)}
      </label>
    `).join('');
    this._openModal(
      pool ? `Edit Pool ${pool.name}` : 'Add Pool',
      `
      <div class="field">
        <label>Pool name</label>
        <input class="input" id="m-name" placeholder="vpn-a-pool" value="${esc(pool?.name)}" />
      </div>
      <div class="field">
        <label>Pool type</label>
        <select class="input" id="m-type">${types}</select>
      </div>
      <div class="field">
        <label>Members (ordered as listed)</label>
        <div class="member-list">${
        members || '<span class="muted">No home servers yet — add one first</span>'
      }</div>
      </div>
    `,
      () => this._savePool(),
    );
  }

  async _savePool() {
    const server_ids = [...this.shadowRoot.querySelectorAll('.m-member:checked')].map((cb) =>
      Number(cb.value)
    );
    const body = { name: this._mval('m-name'), pool_type: this._mval('m-type'), server_ids };
    try {
      if (this._editing) await api.put(`/realms/pools/${this._editing.id}`, body);
      else await api.post('/realms/pools', body);
      toast(`Pool ${body.name} saved`, 'success');
      this._closeModal();
      this._loadAll();
    } catch (e) {
      const box = this.shadowRoot.getElementById('modal-body');
      if (!applyServerErrors(box, e)) toast(e.message || 'Save failed', 'error');
    }
  }

  async _deletePool(pool) {
    if (!await confirmDialog(`Delete pool "${pool.name}"?`, { danger: true })) return;
    try {
      await api.delete(`/realms/pools/${pool.id}`);
      toast(`Pool ${pool.name} deleted`, 'success');
      this._loadAll();
    } catch (e) {
      toast(e.message || 'Delete failed', 'error');
    }
  }

  // — Routing modal —

  async _openRouteModal() {
    try {
      const res = await api.get('/nas/groups/list?size=100');
      this._nasGroups = res.items || [];
    } catch {
      this._nasGroups = [];
    }
    const groups = this._nasGroups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`)
      .join('');
    const realms = this._realms.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join(
      '',
    );
    this._openModal(
      'Route NAS Group to Realm',
      `
      <div class="field">
        <label>NAS group</label>
        <select class="input" id="m-group">${
        groups || '<option value="">No NAS groups defined</option>'
      }</select>
      </div>
      <div class="field">
        <label>Realm</label>
        <select class="input" id="m-realm">${
        realms || '<option value="">No realms defined</option>'
      }</select>
      </div>
    `,
      () => this._saveRoute(),
      'Add Route',
    );
  }

  async _saveRoute() {
    const nas_group_id = Number(this._mval('m-group'));
    const realm_id = Number(this._mval('m-realm'));
    if (!nas_group_id || !realm_id) {
      toast('Select a NAS group and a realm', 'error');
      return;
    }
    try {
      await api.post('/realms/nas-routing', { nas_group_id, realm_id });
      toast('Route added', 'success');
      this._closeModal();
      this._loadAll();
    } catch (e) {
      const box = this.shadowRoot.getElementById('modal-body');
      if (!applyServerErrors(box, e)) toast(e.message || 'Save failed', 'error');
    }
  }

  async _deleteRoute(route) {
    if (
      !await confirmDialog(`Remove route ${route.nas_group_name} → ${route.realm_name}?`, {
        danger: true,
      })
    ) return;
    try {
      await api.delete(`/realms/nas-routing/${route.id}`);
      toast('Route removed', 'success');
      this._loadAll();
    } catch (e) {
      toast(e.message || 'Delete failed', 'error');
    }
  }

  // ── Authentication realms (identity source + method + policy) ──────────────

  _renderAuth(body) {
    const srcCell = (d) => {
      const s = d.identity_source;
      if (!s) return '<span class="muted">— local —</span>';
      return `<span class="mono">${esc(s.host)}:${s.port}</span> ${statusBadge(s.status)}`;
    };
    const syncCell = (d) => {
      if (!d.identity_source) return '<span class="muted">—</span>';
      if (!d.sync_enabled) return '<span class="muted">manual</span>';
      return `<span class="badge badge-up">every ${d.sync_interval_minutes}m</span>`;
    };
    const lastSync = (d) => {
      if (!d.last_sync_at) return '<span class="muted">never</span>';
      const s = d.last_sync_status === 'ok' ? 'up' : (d.last_sync_status ? 'down' : 'unknown');
      const st = d.last_sync_stats || {};
      const summary = ['created', 'updated', 'disabled', 'removed']
        .filter((k) => st[k]).map((k) => `${st[k]} ${k}`).join(', ');
      return `${statusBadge(s)} <span class="mono muted">${fmtDate(d.last_sync_at)}</span>` +
        (summary ? ` <span class="muted">(${esc(summary)})</span>` : '');
    };
    const nasCell = (d) =>
      (d.nas_group_names && d.nas_group_names.length)
        ? d.nas_group_names.map((n) => `<span class="badge badge-muted">${esc(n)}</span>`).join(' ')
        : '<span class="muted">all</span>';

    const rows = this._auth.map((d) => {
      const hasSource = !!d.identity_source;
      return `
      <tr data-id="${d.id}">
        <td><strong>${esc(d.name)}</strong>${
        d.enabled ? '' : ' <span class="badge badge-muted">disabled</span>'
      }${d.is_default ? ' <span class="badge badge-up">default</span>' : ''}</td>
        <td>${methodBadge(d.auth_method)}${
        d.auth_method === 'directory_delegated'
          ? ' <span class="badge badge-muted host-badge" data-host-badge role="button" tabindex="0" title="Domain-join / host readiness for delegated auth">host: checking…</span>'
          : ''
      }</td>
        <td>${protocolList(d.supported_protocols)}</td>
        <td>${srcCell(d)}</td>
        <td>${nasCell(d)}</td>
        <td>${syncCell(d)}</td>
        <td>${lastSync(d)}</td>
        <td style="text-align:right;white-space:nowrap">
          ${
        hasSource
          ? `
          <button class="btn btn-sm" data-act="test" title="Test the directory bind connection">Test</button>
          <button class="btn btn-sm" data-act="groups" title="Map AD groups to service plans">Groups</button>
          <button class="btn btn-sm" data-act="pick" title="Pick individual AD users to import">Import users…</button>
          ${
            d.import_mode === 'selected' ? '' : `
          <button class="btn btn-sm" data-act="preview" title="Dry run — show which users would be imported/changed, writes nothing">Preview</button>
          <button class="btn btn-sm btn-primary" data-act="sync" title="Import all matching directory users into the RADIUS DB and reconcile changes">Import / Sync</button>`
          }`
          : ''
      }
          <button class="btn btn-sm" data-act="edit">Edit</button>
          <button class="btn btn-sm btn-danger" data-act="del">Delete</button>
        </td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="tab-toolbar" style="justify-content:space-between">
        <div class="hint" style="margin:0">A <b>realm</b> pairs an authentication method with an authorization policy. <b>Local password</b> realms let MonsterOps own each subscriber's password (any protocol, works offline) and can optionally sync the user list from AD. <b>Directory-delegated</b> realms validate logins live against AD (MS-CHAPv2/PAP, requires a domain join). For AD-backed realms: <b>Groups</b> (map AD groups to plans) → <b>Preview</b> (dry run) → <b>Import / Sync</b>.</div>
        <div style="display:flex;gap:0.5rem;align-items:center">${densityBarHTML()}<button class="btn btn-primary" id="btn-add">+ Add Realm</button></div>
      </div>
      <div id="deleg-banner"></div>
      <div class="card"><table>
        <thead><tr><th>Realm</th><th>Method</th><th>Protocols</th><th>Identity source</th><th>NAS groups</th><th>Sync</th><th>Last sync</th><th></th></tr></thead>
        <tbody>${
      rows ||
      emptyRowHTML(8, {
        title: 'No authentication realms',
        message:
          'Add a realm to define how subscribers authenticate — a local-password realm, or one backed by Active Directory.',
      })
    }</tbody>
      </table></div>
    `;
    body.querySelector('#btn-add').addEventListener('click', () => this._openAuthModal(null));
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const d = this._auth.find((x) => x.id === Number(tr.dataset.id));
      tr.querySelector('[data-act=edit]').addEventListener('click', () => this._openAuthModal(d));
      tr.querySelector('[data-act=del]').addEventListener('click', () => this._deleteAuth(d));
      tr.querySelector('[data-act=test]')?.addEventListener('click', () => this._testAuth(d));
      tr.querySelector('[data-act=groups]')?.addEventListener(
        'click',
        () => this._openGroupMapModal(d),
      );
      tr.querySelector('[data-act=pick]')?.addEventListener(
        'click',
        () => this._openImportModal(d),
      );
      tr.querySelector('[data-act=preview]')?.addEventListener('click', () => this._previewSync(d));
      tr.querySelector('[data-act=sync]')?.addEventListener('click', () => this._runSync(d));
    });
    if (this._auth.length) {
      makeSortable(body.querySelector('table'), { default: { col: 0, dir: 'asc' } });
    }
    wireDensityBar(body, () => body.querySelector('table'));
    // Delegated realms depend on server-side wiring (deploy/provision-ad.sh).
    // Check the host once and reflect readiness in the row badges + a banner.
    if (this._auth.some((d) => d.auth_method === 'directory_delegated')) {
      this._refreshDelegationHost(body);
    }
  }

  async _refreshDelegationHost(body) {
    let s;
    try {
      s = await api.get('/realms/delegation-host-status');
    } catch {
      s = null;
    }
    this._hostStatus = s;

    const badgeText = s ? (s.ready ? 'host: ready' : 'host: needs join') : 'host: unknown';
    const badgeCls = s ? (s.ready ? 'badge-up' : 'badge-warn') : 'badge-muted';
    body.querySelectorAll('[data-host-badge]').forEach((el) => {
      el.className = `badge ${badgeCls} host-badge`;
      el.textContent = badgeText;
      const open = () => {
        const tr = el.closest('tr[data-id]');
        const d = tr && this._auth.find((x) => x.id === Number(tr.dataset.id));
        this._openHostStatusModal(d);
      };
      el.onclick = open;
      el.onkeydown = (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open();
        }
      };
    });

    const banner = body.querySelector('#deleg-banner');
    if (!banner) return;
    if (!s) {
      banner.innerHTML = `<div class="notice notice-warn"><span class="notice-icon">⚠️</span>
        <div class="notice-body">Couldn't check this server's readiness for directory-delegated auth.
        Delegated realms need the RADIUS host joined to AD — see the setup guide
        (<code>docs/active-directory-auth.md</code>).</div></div>`;
      return;
    }
    if (s.ready) {
      banner.innerHTML = `<div class="notice notice-ok"><span class="notice-icon">✓</span>
        <div class="notice-body">This server is wired for <b>directory-delegated</b> auth (domain-joined, FreeRADIUS NTLM-Auth ready).</div></div>`;
    } else {
      const delegated = this._auth.filter((d) => d.auth_method === 'directory_delegated');
      banner.innerHTML = `<div class="notice notice-warn"><span class="notice-icon">⚠️</span>
        <div class="notice-body">This server isn't wired for <b>directory-delegated</b> auth yet —
        ${delegated.length === 1 ? 'realm' : 'realms'}
        ${
        delegated.map((d) => `<b>${esc(d.name)}</b>`).join(', ')
      } will reject logins until the RADIUS host is joined to AD.
        <button class="btn btn-sm" id="deleg-steps" style="margin-left:0.4rem">View setup steps</button></div></div>`;
      banner.querySelector('#deleg-steps')?.addEventListener(
        'click',
        () => this._openHostStatusModal(delegated[0]),
      );
    }
  }

  _openHostStatusModal(d) {
    const s = this._hostStatus;
    const src = d?.identity_source || null;
    const realm = deriveAdRealm(src);
    const short = (d?.ad_short_domain || 'CORP').toUpperCase();
    const cmd = `sudo AD_REALM=${realm} AD_SHORT_DOMAIN=${short} bash deploy/provision-ad.sh`;

    const icColor = (st) =>
      st === 'ok' ? 'var(--mr-accept)' : st === 'fail' ? 'var(--mr-reject)' : 'var(--color-muted)';
    const checks = (s?.checks || []).map((c) => `
      <div class="host-check">
        <span class="ic" style="color:${icColor(c.status)}">${
      HOST_CHECK_ICON[c.status] || '•'
    }</span>
        <div><div class="lbl">${esc(c.label)}</div><div class="dtl">${esc(c.detail)}</div></div>
      </div>`).join('') || '<p class="muted">No checks available.</p>';

    const headline = !s
      ? "Host readiness couldn't be determined."
      : s.ready
      ? 'This server is ready for directory-delegated auth.'
      : 'This server needs a domain join before delegated logins work.';

    this._openModal(
      'Directory-delegated — host setup',
      `
      <p class="hint" style="margin-top:0">${
        esc(headline)
      } Delegated realms validate logins live against a
        Domain Controller via winbind/<code>ntlm_auth</code>, so the RADIUS host must be joined to the domain.
        This is a one-time, server-side step run by whoever administers the box — not per user.</p>
      <div class="card" style="padding:0.25rem 0.85rem;margin-bottom:0.85rem">${checks}</div>
      ${
        s && s.ready ? '' : `
      <label style="font-size:0.78rem;font-weight:500;color:var(--color-muted)">Run on the RADIUS host (as root):</label>
      <div class="cmd-row" style="margin:0.3rem 0 0.6rem"><pre class="conf" id="deleg-cmd">${
          esc(cmd)
        }</pre>
        <button class="btn" id="deleg-copy" title="Copy command">Copy</button></div>
      <p class="hint" style="margin-top:0">The command is interactive — it asks for domain-admin credentials and
        creates a machine account in AD. Full walkthrough, prerequisites and troubleshooting are in the
        Active Directory authentication guide (<code>docs/active-directory-auth.md</code>).
        Prefer no runtime AD dependency? Switch the realm to <b>Local password</b> (Edit) — no domain join needed.</p>`
      }
    `,
      null,
    );

    const copyBtn = this.shadowRoot.getElementById('deleg-copy');
    copyBtn?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(cmd);
        toast('Command copied', 'success');
      } catch {
        toast('Copy failed — select the text manually', 'error');
      }
    });
  }

  _openAuthModal(d) {
    this._editing = d;
    const src = d?.identity_source || null;
    const opt = (vals, cur, dflt) =>
      vals.map((v) => `<option value="${v}" ${(cur ?? dflt) === v ? 'selected' : ''}>${v}</option>`)
        .join('');
    const methodOpts = Object.entries(AUTH_METHODS).map(([k, m]) =>
      `<option value="${k}" ${(d?.auth_method || 'local_password') === k ? 'selected' : ''}>${
        esc(m.label)
      }</option>`
    ).join('');
    const nasChecks = this._nasGroups.length
      ? this._nasGroups.map((g) => `
          <label class="member-item"><input type="checkbox" class="m-nas" value="${g.id}" ${
        (d?.nas_group_ids || []).includes(g.id) ? 'checked' : ''
      } /> ${esc(g.name)}</label>`).join('')
      : '<span class="muted">No NAS groups defined.</span>';

    this._openModal(
      d ? `Edit realm ${d.name}` : 'Add authentication realm',
      `
      <div class="field-row">
        <div class="field"><label>Realm name</label><input class="input" id="m-name" placeholder="corp-admins" value="${
        esc(d?.name)
      }" /></div>
        <div class="field"><label>Authentication method</label><select class="input" id="m-method">${methodOpts}</select></div>
      </div>
      <div class="field"><label>Description <span class="muted">(optional)</span></label><input class="input" id="m-desc" value="${
        esc(d?.description)
      }" /></div>
      <div class="hint" id="m-method-note"></div>

      <div class="field"><label>Default group <span class="muted">(when no AD-group mapping matches)</span></label>
        <select class="input" id="m-defgroup">${
        this._groupOptions(d?.default_groupname, '— none —')
      }</select></div>
      <div class="field"><label>NAS groups <span class="muted">(none selected = all NAS devices)</span></label>
        <div class="member-list" id="m-nas-list">${nasChecks}</div></div>
      <div class="check-row"><input type="checkbox" id="m-enabled" ${
        d ? (d.enabled ? 'checked' : '') : 'checked'
      } /><label for="m-enabled">Realm enabled</label></div>
      <div class="check-row"><input type="checkbox" id="m-default" ${
        d && d.is_default ? 'checked' : ''
      } /><label for="m-default">Default fallback realm</label></div>

      <div class="field" id="m-shortdom-field">
        <label>AD short domain <span class="muted">(NetBIOS name → ntlm_auth --domain)</span></label>
        <input class="input" id="m-shortdom" placeholder="CORP" value="${
        esc(d?.ad_short_domain)
      }" />
      </div>

      <div style="margin:0.9rem 0 0.4rem;font-weight:600;font-size:0.8rem;color:var(--color-muted);display:flex;align-items:center;gap:0.5rem">
        <input type="checkbox" id="m-hassource" ${src ? 'checked' : ''} />
        <label for="m-hassource" style="margin:0">Active Directory identity source</label>
      </div>
      <div id="m-source-section">
        <div class="field-row">
          <div class="field"><label>Host / IP</label><input class="input" id="m-host" placeholder="ad.corp.local" value="${
        esc(src?.host)
      }" /></div>
          <div class="field"><label>Port</label><input class="input" id="m-port" type="number" min="1" max="65535" value="${
        src?.port ?? 389
      }" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Encryption</label><select class="input" id="m-enc">${
        opt(LDAP_ENCRYPTION, src?.encryption, 'none')
      }</select></div>
          <div class="field"><label>Timeout (s)</label><input class="input" id="m-timeout" type="number" min="1" max="120" value="${
        src?.timeout ?? 10
      }" /></div>
        </div>
        <div class="field"><label>Base DN</label><input class="input" id="m-base" placeholder="dc=corp,dc=local" value="${
        esc(src?.base_dn)
      }" /></div>
        <div class="field"><label>Bind DN <span class="muted">(blank = anonymous)</span></label><input class="input" id="m-binddn" placeholder="cn=svc-radius,dc=corp,dc=local" value="${
        esc(src?.bind_dn)
      }" /></div>
        <div class="field"><label>Bind password ${
        src ? '<span class="muted">(blank = keep current)</span>' : ''
      }</label><input class="input" id="m-bindpw" type="password" autocomplete="new-password" /></div>
        <div class="check-row"><input type="checkbox" id="m-tls" ${
        src ? (src.tls_verify ? 'checked' : '') : 'checked'
      } /><label for="m-tls">Verify TLS cert</label></div>
        <div class="field-row">
          <div class="field"><label>Login attribute <span class="muted">(→ RADIUS username)</span></label>
            <select class="input" id="m-login">${
        opt(
          ['userPrincipalName', 'sAMAccountName', 'mail'],
          src?.login_attribute,
          'userPrincipalName',
        )
      }</select></div>
          <div class="field"><label>Deprovision when gone from AD</label>
            <select class="input" id="m-deprov">${
        opt(['disable', 'delete'], d?.deprovision_action, 'disable')
      }</select></div>
        </div>
        <div class="check-row"><input type="checkbox" id="m-strip" ${
        src && src.strip_login_suffix ? 'checked' : ''
      } /><label for="m-strip">Strip <code>@domain</code> from username <span class="muted">(jsmith@corp.tld → jsmith)</span></label></div>
        <div class="field"><label>User search base <span class="muted">(blank = Base DN)</span></label><input class="input" id="m-searchbase" placeholder="ou=Subscribers,dc=corp,dc=local" value="${
        esc(src?.user_search_base)
      }" /></div>
        <div class="field"><label>User search filter</label><input class="input" id="m-searchfilter" value="${
        esc(src?.user_search_filter ?? '(&(objectCategory=person)(objectClass=user))')
      }" /></div>
        <div class="field"><label>Which users to import</label>
          <select class="input" id="m-importmode">
            <option value="all" ${
        (d?.import_mode ?? 'all') === 'all' ? 'selected' : ''
      }>All users matching the filter</option>
            <option value="selected" ${
        d?.import_mode === 'selected' ? 'selected' : ''
      }>Selected users only (pick individually)</option>
          </select>
          <span class="hint" style="margin-top:0.25rem">In <b>selected</b> mode, use the realm's <b>Import users…</b> action to pick who to import; sync only keeps those in step and never auto-adds new AD users.</span>
        </div>
        <div class="field-row">
          <div class="check-row" style="align-self:end"><input type="checkbox" id="m-sync" ${
        d && d.sync_enabled ? 'checked' : ''
      } /><label for="m-sync">Automatic sync</label></div>
          <div class="field"><label>Interval (minutes)</label><input class="input" id="m-interval" type="number" min="5" max="10080" value="${
        d?.sync_interval_minutes ?? 60
      }" /></div>
        </div>
      </div>
    `,
      () => this._saveAuth(),
    );

    this.shadowRoot.getElementById('m-method').addEventListener(
      'change',
      () => this._syncAuthModal(),
    );
    this.shadowRoot.getElementById('m-hassource').addEventListener(
      'change',
      () => this._syncAuthModal(),
    );
    this._syncAuthModal();
  }

  // Show/hide the identity-source and short-domain sections to match the chosen
  // method, and keep the consequence note in step. Directory-delegated forces an
  // identity source + short domain.
  _syncAuthModal() {
    const method = this.shadowRoot.getElementById('m-method').value;
    const hasSource = this.shadowRoot.getElementById('m-hassource');
    const delegated = method === 'directory_delegated';
    if (delegated) {
      hasSource.checked = true;
      hasSource.disabled = true;
    } else hasSource.disabled = false;
    this.shadowRoot.getElementById('m-source-section').style.display = hasSource.checked
      ? ''
      : 'none';
    this.shadowRoot.getElementById('m-shortdom-field').style.display = delegated ? '' : 'none';
    this.shadowRoot.getElementById('m-method-note').textContent =
      (AUTH_METHODS[method] || {}).note || '';
  }

  async _saveAuth() {
    const method = this._mval('m-method');
    const hasSource = this.shadowRoot.getElementById('m-hassource').checked;
    const body = {
      name: this._mval('m-name'),
      description: this._mval('m-desc') || null,
      auth_method: method,
      enabled: this.shadowRoot.getElementById('m-enabled').checked,
      is_default: this.shadowRoot.getElementById('m-default').checked,
      default_groupname: this._mval('m-defgroup') || null,
      deprovision_action: this._mval('m-deprov') || 'disable',
      ad_short_domain: method === 'directory_delegated' ? (this._mval('m-shortdom') || null) : null,
      import_mode: hasSource ? (this._mval('m-importmode') || 'all') : 'all',
      nas_group_ids: [...this.shadowRoot.querySelectorAll('.m-nas:checked')].map((c) =>
        Number(c.value)
      ),
      sync_enabled: hasSource && this.shadowRoot.getElementById('m-sync').checked,
      sync_interval_minutes: Number(this._mval('m-interval')) || 60,
      identity_source: null,
    };
    if (hasSource) {
      const source = {
        name: body.name, // realm and its source are 1:1 — share the name
        source_type: 'active_directory',
        host: this._mval('m-host'),
        port: Number(this._mval('m-port')) || 389,
        encryption: this._mval('m-enc'),
        base_dn: this._mval('m-base'),
        bind_dn: this._mval('m-binddn') || null,
        tls_verify: this.shadowRoot.getElementById('m-tls').checked,
        timeout: Number(this._mval('m-timeout')) || 10,
        login_attribute: this._mval('m-login'),
        strip_login_suffix: this.shadowRoot.getElementById('m-strip').checked,
        user_search_base: this._mval('m-searchbase') || null,
        user_search_filter: this._mval('m-searchfilter') ||
          '(&(objectCategory=person)(objectClass=user))',
      };
      // Write-only password. New source: send it (empty → anonymous). Editing an
      // existing source: only send when set, so a blank field keeps the stored one.
      const pw = this.shadowRoot.getElementById('m-bindpw').value;
      if (this._editing?.identity_source) { if (pw) source.bind_password = pw; }
      else source.bind_password = pw || null;
      body.identity_source = source;
    }
    try {
      if (this._editing) await api.put(`/realms/auth-domains/${this._editing.id}`, body);
      else await api.post('/realms/auth-domains', body);
      toast(`Realm ${body.name} saved`, 'success');
      this._closeModal();
      this._loadAll();
    } catch (e) {
      const box = this.shadowRoot.getElementById('modal-body');
      if (!applyServerErrors(box, e)) toast(e.message || 'Save failed', 'error');
    }
  }

  async _deleteAuth(d) {
    if (
      !await confirmDialog(
        `Delete realm "${d.name}"? Its identity source, group mappings and sync history are removed; provisioned subscribers stay in the DB.`,
        { danger: true },
      )
    ) return;
    try {
      await api.delete(`/realms/auth-domains/${d.id}`);
      toast(`Realm ${d.name} deleted`, 'success');
      this._loadAll();
    } catch (e) {
      toast(e.message || 'Delete failed', 'error');
    }
  }

  async _testAuth(d) {
    toast(`Testing ${d.name}…`, 'info');
    try {
      const res = await api.post(`/realms/auth-domains/${d.id}/test`, {});
      toast(
        `${d.name}: ${res.message}${res.rtt_ms != null ? ` (${res.rtt_ms} ms)` : ''}`,
        res.status === 'up' ? 'success' : 'error',
      );
      this._loadAll();
    } catch (e) {
      toast(e.message || 'Test failed', 'error');
    }
  }

  async _previewSync(d) {
    toast(`Previewing ${d.name}…`, 'info');
    try {
      const res = await api.get(`/realms/auth-domains/${d.id}/sync/preview`);
      this._showSyncResult(d, res, true);
    } catch (e) {
      toast(e.message || 'Preview failed', 'error');
    }
  }

  async _runSync(d) {
    if (
      !await confirmDialog(
        `Run directory sync for "${d.name}" now? New subscribers are created and existing ones are reconciled to match AD.`,
        { okLabel: 'Sync now' },
      )
    ) return;
    toast(`Syncing ${d.name}…`, 'info');
    try {
      const res = await api.post(`/realms/auth-domains/${d.id}/sync`, {});
      this._showSyncResult(d, res, false);
      this._loadAll();
    } catch (e) {
      toast(e.message || 'Sync failed', 'error');
    }
  }

  _showSyncResult(d, res, dry) {
    if (res.status === 'error') {
      toast(`${d.name}: ${res.message || 'sync error'}`, 'error');
      return;
    }
    const counts = [
      'created',
      'updated',
      'reactivated',
      'disabled',
      'removed',
      'unchanged',
      'errors',
    ]
      .map((k) =>
        `<span class="badge ${
          res[k] && (k === 'errors') ? 'badge-down' : (res[k] ? 'badge-up' : 'badge-muted')
        }">${k}: ${res[k]}</span>`
      )
      .join(' ');
    const sample = (res.sample || []).length
      ? `<pre class="conf">${esc(res.sample.join('\n'))}</pre>`
      : '<p class="muted">No changes.</p>';
    this._openModal(
      `${dry ? 'Sync preview (dry-run)' : 'Sync result'} — ${d.name}`,
      `<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.75rem">${counts}</div>${sample}`,
      null,
    );
  }

  // Pick individual AD users to import (the "selected" workflow).
  async _openImportModal(d) {
    toast(`Loading directory users from ${d.name}…`, 'info');
    let res;
    try {
      res = await api.get(`/realms/auth-domains/${d.id}/import/candidates`);
    } catch (e) {
      toast(e.message || 'Could not list directory users', 'error');
      return;
    }
    if (res.status === 'error') {
      toast(`${d.name}: ${res.message || 'directory read failed'}`, 'error');
      return;
    }
    const cands = res.candidates || [];
    const importedCount = cands.filter((c) => c.imported).length;

    const rowHtml = (c) => `
      <tr data-guid="${esc(c.guid)}" data-name="${esc(String(c.username).toLowerCase())}">
        <td style="width:2rem"><input type="checkbox" class="pick-cb" value="${esc(c.guid)}" ${
      c.imported ? 'checked disabled' : ''
    } /></td>
        <td><strong>${esc(c.username)}</strong>${
      c.enabled ? '' : ' <span class="badge badge-muted">disabled</span>'
    }</td>
        <td>${c.group ? esc(c.group) : '<span class="muted">—</span>'}</td>
        <td>${c.imported ? '<span class="badge badge-up">imported</span>' : ''}</td>
      </tr>`;

    this._openModal(
      `Import users — ${d.name}`,
      `
      <p class="hint" style="margin-top:0">${cands.length} user${
        cands.length === 1 ? '' : 's'
      } match the realm's filter${
        importedCount ? ` · ${importedCount} already imported` : ''
      }. Tick the ones to import.${
        d.import_mode !== 'selected'
          ? ' <b>Note:</b> this realm is set to import <b>all</b> matching users on sync — switch it to <b>Selected users only</b> (Edit) if you want the picked set to stay fixed.'
          : ''
      }</p>
      <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem">
        <input class="input" id="pick-filter" placeholder="Filter by username…" style="flex:1" />
        <label class="check-row" style="margin:0;white-space:nowrap"><input type="checkbox" id="pick-all" /> Select all shown</label>
      </div>
      <div class="card" style="max-height:45vh;overflow:auto"><table>
        <thead><tr><th></th><th>Username</th><th>Group</th><th></th></tr></thead>
        <tbody id="pick-body">${
        cands.map(rowHtml).join('') ||
        '<tr><td colspan="4" class="muted">No users match the filter.</td></tr>'
      }</tbody>
      </table></div>
    `,
      () => this._runImport(d),
      'Import selected',
    );

    const sr = this.shadowRoot;
    sr.getElementById('pick-filter').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      sr.querySelectorAll('#pick-body tr[data-guid]').forEach((tr) => {
        tr.style.display = (!q || tr.dataset.name.includes(q)) ? '' : 'none';
      });
    });
    sr.getElementById('pick-all').addEventListener('change', (e) => {
      sr.querySelectorAll('#pick-body tr[data-guid]').forEach((tr) => {
        if (tr.style.display === 'none') return;
        const cb = tr.querySelector('.pick-cb');
        if (cb && !cb.disabled) cb.checked = e.target.checked;
      });
    });
  }

  async _runImport(d) {
    const guids = [...this.shadowRoot.querySelectorAll('.pick-cb:checked')]
      .filter((cb) => !cb.disabled).map((cb) => cb.value);
    if (!guids.length) {
      toast('No new users selected', 'error');
      return;
    }
    toast(`Importing ${guids.length} user${guids.length === 1 ? '' : 's'}…`, 'info');
    try {
      const res = await api.post(`/realms/auth-domains/${d.id}/import`, { guids });
      if (res.status === 'error') {
        toast(`${d.name}: ${res.message || 'import failed'}`, 'error');
        return;
      }
      toast(
        `Imported ${res.created} user${res.created === 1 ? '' : 's'}${
          res.errors ? `, ${res.errors} skipped` : ''
        }`,
        'success',
      );
      this._closeModal();
      this._loadAll();
    } catch (e) {
      toast(e.message || 'Import failed', 'error');
    }
  }

  async _openGroupMapModal(d) {
    let maps = [];
    try {
      maps = await api.get(`/realms/auth-domains/${d.id}/group-map`);
    } catch { /* shown empty */ }

    // Live AD group list → a real dropdown. Falls back to a text field if the
    // directory can't be read (bad bind, offline) so mapping still works.
    toast(`Loading AD groups from ${d.name}…`, 'info');
    let adGroups = null;
    try {
      adGroups = await api.get(`/realms/auth-domains/${d.id}/ad-groups`);
    } catch {
      adGroups = null;
    }
    const adField = (adGroups && adGroups.length)
      ? `<select class="input" id="gm-ad"><option value="">— select AD group —</option>${
        adGroups.map((g) => `<option value="${esc(g.dn)}">${esc(g.cn)}</option>`).join('')
      }</select>`
      : `<input class="input" id="gm-ad" placeholder="Plan-100M or CN=Plan-100M,OU=…" />`;

    // MonsterOps target → dropdown of local groups (text field only if none exist).
    const grpField = this._groups.length
      ? `<select class="input" id="gm-grp">${this._groupOptions(null, '— select group —')}</select>`
      : `<input class="input" id="gm-grp" placeholder="plan-100m" />`;

    const rowsHtml = (list) =>
      list.length
        ? list.map((m) => `
      <tr data-map="${m.id}">
        <td class="mono">${esc(m.ad_group)}</td>
        <td>${esc(m.groupname)}</td>
        <td class="mono">${m.priority}</td>
        <td style="text-align:right"><button class="btn btn-sm btn-danger" data-act="delmap">Remove</button></td>
      </tr>`).join('')
        : '<tr><td colspan="4" class="muted">No mappings — matched users fall back to the default group.</td></tr>';
    this._openModal(
      `Group mapping — ${d.name}`,
      `
      <p class="hint" style="margin-top:0">Map an AD group — matched against each user's <code>memberOf</code> — to a MonsterOps group (service plan). Lowest priority wins when a user is in several; unmatched users get the realm's default group.${
        adGroups === null
          ? " <b>Couldn't list AD groups</b> — check the bind, or type the group name/DN manually."
          : ''
      }</p>
      <div class="card"><table>
        <thead><tr><th>AD group</th><th>MonsterOps group</th><th>Priority</th><th></th></tr></thead>
        <tbody id="gm-body">${rowsHtml(maps)}</tbody>
      </table></div>
      <div class="field-row" style="grid-template-columns:2fr 1.5fr 0.7fr auto;align-items:end;margin-top:0.75rem">
        <div class="field"><label>AD group</label>${adField}</div>
        <div class="field"><label>MonsterOps group</label>${grpField}</div>
        <div class="field"><label>Priority</label><input class="input" id="gm-prio" type="number" min="0" value="0" /></div>
        <button class="btn btn-primary" id="gm-add" type="button">Add</button>
      </div>
    `,
      null,
    );

    const wireDeletes = () => {
      this.shadowRoot.querySelectorAll('#gm-body tr[data-map] [data-act=delmap]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.closest('tr').dataset.map;
          try {
            await api.delete(`/realms/auth-domains/${d.id}/group-map/${id}`);
            btn.closest('tr').remove();
            if (!this.shadowRoot.querySelector('#gm-body tr[data-map]')) {
              this.shadowRoot.getElementById('gm-body').innerHTML = rowsHtml([]);
            }
          } catch (e) {
            toast(e.message || 'Remove failed', 'error');
          }
        });
      });
    };
    wireDeletes();
    this.shadowRoot.getElementById('gm-add').addEventListener('click', async () => {
      const map = {
        ad_group: this._mval('gm-ad'),
        groupname: this._mval('gm-grp'),
        priority: Number(this._mval('gm-prio')) || 0,
      };
      if (!map.ad_group || !map.groupname) {
        toast('AD group and MonsterOps group are required', 'error');
        return;
      }
      try {
        await api.post(`/realms/auth-domains/${d.id}/group-map`, map);
        const fresh = await api.get(`/realms/auth-domains/${d.id}/group-map`);
        this.shadowRoot.getElementById('gm-body').innerHTML = rowsHtml(fresh);
        wireDeletes();
        this.shadowRoot.getElementById('gm-ad').value = '';
        this.shadowRoot.getElementById('gm-grp').value = '';
        toast('Mapping added', 'success');
      } catch (e) {
        toast(e.message || 'Add failed', 'error');
      }
    });
  }

  // ── proxy.conf ──────────────────────────────────────────────────────────────

  async _previewConf() {
    try {
      const res = await api.get('/realms/proxy-conf/preview');
      this._openModal(
        `proxy.conf preview — ${res.path}`,
        `<pre class="conf">${esc(res.content)}</pre>`,
        null,
      );
    } catch (e) {
      toast(e.message || 'Preview failed', 'error');
    }
  }

  async _applyConf() {
    if (
      !await confirmDialog(
        'Write proxy.conf and restart FreeRADIUS? Active sessions are not affected, but new authentications pause briefly during the restart.',
        { okLabel: 'Apply & restart' },
      )
    ) return;
    try {
      const res = await api.post('/realms/proxy-conf/apply', {});
      toast(`proxy.conf written (${res.bytes} bytes) — FreeRADIUS restart triggered`, 'success');
    } catch (e) {
      toast(e.message || 'Apply failed', 'error');
    }
  }
}

customElements.define('realms-view', RealmsView);
router.register('/realms', () => document.createElement('realms-view'));
