import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { applyServerErrors } from '/js/utils/form.js';
import { makeSortable, densityBarHTML, wireDensityBar } from '/js/utils/table.js';
import { emptyRowHTML } from '/js/utils/empty.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }

const STATUS_BADGE = {
  up:          ['UP', 'badge-up'],
  timeout:     ['TIMEOUT', 'badge-warn'],
  unreachable: ['UNREACHABLE', 'badge-down'],
  down:        ['DOWN', 'badge-down'],
  unknown:     ['UNKNOWN', 'badge-muted'],
};

function statusBadge(status) {
  const [label, cls] = STATUS_BADGE[status] || STATUS_BADGE.unknown;
  return `<span class="badge ${cls}">${label}</span>`;
}

const POOL_TYPES = ['fail-over', 'load-balance', 'client-balance', 'client-port-balance'];
const SERVER_TYPES = ['auth', 'acct', 'both'];

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
  .check-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.83rem; }
  .member-list { display: flex; flex-direction: column; gap: 0.35rem; max-height: 200px; overflow-y: auto;
                 border: 1px solid var(--color-border); border-radius: var(--radius); padding: 0.6rem; }
  .member-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.83rem; }
  pre.conf { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius);
             padding: 1rem; font-size: 0.75rem; overflow: auto; max-height: 55vh; white-space: pre; }
`;

class RealmsView extends HTMLElement {
  constructor() {
    super();
    this._tab = 'realms';      // realms | servers | pools | routing
    this._realms = [];
    this._servers = [];
    this._pools = [];
    this._routes = [];
    this._nasGroups = [];
    this._vpnTunnels = [];
    this._editing = null;      // object being edited in the modal, or null
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

    this.shadowRoot.querySelectorAll('.tab').forEach(t =>
      t.addEventListener('click', () => { this._tab = t.dataset.tab; this._renderTab(); }));
    this.shadowRoot.getElementById('btn-preview').addEventListener('click', () => this._previewConf());
    this.shadowRoot.getElementById('btn-apply').addEventListener('click', () => this._applyConf());
    this.shadowRoot.getElementById('modal-close').addEventListener('click', () => this._closeModal());
    this.shadowRoot.getElementById('modal-cancel').addEventListener('click', () => this._closeModal());
    this.shadowRoot.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === this.shadowRoot.getElementById('modal-overlay')) this._closeModal();
    });

    this._loadAll();
  }

  async _loadAll() {
    try {
      const [realms, servers, pools, routes] = await Promise.all([
        api.get('/realms'),
        api.get('/realms/servers'),
        api.get('/realms/pools'),
        api.get('/realms/nas-routing'),
      ]);
      this._realms = realms;
      this._servers = servers;
      this._pools = pools;
      this._routes = routes;
    } catch (e) {
      toast(e.message || 'Failed to load realms data', 'error');
    }
    // best-effort: offer managed VPN tunnels for the home-server VPN interface
    try { this._vpnTunnels = await api.get('/vpn'); } catch { this._vpnTunnels = []; }
    this._renderTab();
  }

  // ── Tab rendering ───────────────────────────────────────────────────────────

  _renderTab() {
    this.shadowRoot.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === this._tab));
    const body = this.shadowRoot.getElementById('tab-body');
    switch (this._tab) {
      case 'realms':  this._renderRealms(body); break;
      case 'servers': this._renderServers(body); break;
      case 'pools':   this._renderPools(body); break;
      case 'routing': this._renderRouting(body); break;
    }
  }

  _renderRealms(body) {
    const rows = this._realms.map(r => `
      <tr data-id="${r.id}">
        <td><strong>${esc(r.name)}</strong></td>
        <td>${r.pool_name ? esc(r.pool_name) : '<span class="muted">—</span>'}</td>
        <td>${statusBadge(r.status)}</td>
        <td class="mono" data-sort="${r.last_rtt_ms != null ? r.last_rtt_ms : -1}">${r.last_rtt_ms != null ? r.last_rtt_ms + ' ms' : '—'}</td>
        <td class="mono muted" data-sort="${Date.parse(r.last_probe_at) || 0}">${fmtDate(r.last_probe_at)}</td>
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
        <thead><tr><th>Realm</th><th>Pool</th><th>Status</th><th>RTT</th><th>Last Probe</th><th>Username</th><th></th></tr></thead>
        <tbody>${rows || emptyRowHTML(7, { title: 'No realms configured', message: 'Add a realm to proxy authentication by username suffix.' })}</tbody>
      </table></div>
    `;
    body.querySelector('#btn-add').addEventListener('click', () => this._openRealmModal(null));
    body.querySelectorAll('tr[data-id]').forEach(tr => {
      const realm = this._realms.find(r => r.id === Number(tr.dataset.id));
      tr.querySelector('[data-act=edit]').addEventListener('click', () => this._openRealmModal(realm));
      tr.querySelector('[data-act=del]').addEventListener('click', () => this._deleteRealm(realm));
    });
    if (this._realms.length) makeSortable(body.querySelector('table'), { default: { col: 0, dir: 'asc' } });
    wireDensityBar(body, () => body.querySelector('table'));
  }

  _renderServers(body) {
    const rows = this._servers.map(s => `
      <tr data-id="${s.id}">
        <td><strong>${esc(s.name)}</strong></td>
        <td class="mono">${esc(s.host)}</td>
        <td class="mono muted">${s.auth_port} / ${s.acct_port}</td>
        <td>${esc(s.type)}</td>
        <td>
          ${statusBadge(s.status)}
          ${s.vpn_interface && s.vpn_interface_up === false
            ? `<div class="vpn-warn">⚠ VPN ${esc(s.vpn_interface)} is DOWN</div>` : ''}
        </td>
        <td class="mono" data-sort="${s.last_rtt_ms != null ? s.last_rtt_ms : -1}">${s.last_rtt_ms != null ? s.last_rtt_ms + ' ms' : '—'}</td>
        <td class="mono muted" data-sort="${Date.parse(s.last_seen_at) || 0}">${fmtDate(s.last_seen_at)}</td>
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
        <tbody>${rows || emptyRowHTML(8, { title: 'No home servers configured', message: 'Add a home server to proxy authentication requests to.' })}</tbody>
      </table></div>
    `;
    body.querySelector('#btn-add').addEventListener('click', () => this._openServerModal(null));
    body.querySelectorAll('tr[data-id]').forEach(tr => {
      const srv = this._servers.find(s => s.id === Number(tr.dataset.id));
      tr.querySelector('[data-act=probe]').addEventListener('click', () => this._probeServer(srv));
      tr.querySelector('[data-act=edit]').addEventListener('click', () => this._openServerModal(srv));
      tr.querySelector('[data-act=del]').addEventListener('click', () => this._deleteServer(srv));
    });
    if (this._servers.length) makeSortable(body.querySelector('table'), { default: { col: 0, dir: 'asc' } });
    wireDensityBar(body, () => body.querySelector('table'));
  }

  _renderPools(body) {
    const rows = this._pools.map(p => `
      <tr data-id="${p.id}">
        <td><strong>${esc(p.name)}</strong></td>
        <td>${esc(p.pool_type)}</td>
        <td>${p.server_names.length ? p.server_names.map(n => esc(n)).join(', ') : '<span class="muted">empty</span>'}</td>
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
        <tbody>${rows || emptyRowHTML(5, { title: 'No pools configured', message: 'Group home servers into a pool to load-balance or fail over between them.' })}</tbody>
      </table></div>
    `;
    body.querySelector('#btn-add').addEventListener('click', () => this._openPoolModal(null));
    body.querySelectorAll('tr[data-id]').forEach(tr => {
      const pool = this._pools.find(p => p.id === Number(tr.dataset.id));
      tr.querySelector('[data-act=edit]').addEventListener('click', () => this._openPoolModal(pool));
      tr.querySelector('[data-act=del]').addEventListener('click', () => this._deletePool(pool));
    });
    wireDensityBar(body, () => body.querySelector('table'));
  }

  _renderRouting(body) {
    const rows = this._routes.map(r => `
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
        <tbody>${rows || emptyRowHTML(4, { title: 'No NAS group routes', message: 'Auth from all NAS devices is routed by realm suffix only. Add a route to bind a NAS group to a realm.' })}</tbody>
      </table></div>
    `;
    body.querySelector('#btn-add').addEventListener('click', () => this._openRouteModal());
    body.querySelectorAll('tr[data-id]').forEach(tr => {
      const route = this._routes.find(r => r.id === Number(tr.dataset.id));
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

  _mval(id) { return this.shadowRoot.getElementById(id)?.value?.trim() ?? ''; }

  // — Realm modal —

  _openRealmModal(realm) {
    this._editing = realm;
    const pools = this._pools.map(p =>
      `<option value="${p.id}" ${realm?.pool_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    this._openModal(realm ? `Edit Realm ${realm.name}` : 'Add Realm', `
      <div class="field">
        <label>Realm suffix</label>
        <input class="input" id="m-name" placeholder="corp-a.net" value="${esc(realm?.name)}" />
      </div>
      <div class="field">
        <label>Home server pool</label>
        <select class="input" id="m-pool">
          <option value="">— none (local) —</option>
          ${pools}
        </select>
      </div>
      <div class="check-row">
        <input type="checkbox" id="m-strip" ${realm ? (realm.strip_username ? 'checked' : '') : 'checked'} />
        <label for="m-strip">Strip realm suffix from User-Name before proxying</label>
      </div>
    `, () => this._saveRealm());
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
    } catch (e) { toast(e.message || 'Delete failed', 'error'); }
  }

  // — Server modal —

  _openServerModal(srv) {
    this._editing = srv;
    const types = SERVER_TYPES.map(t =>
      `<option value="${t}" ${srv?.type === t ? 'selected' : ''}>${t}</option>`).join('');
    this._openModal(srv ? `Edit Home Server ${srv.name}` : 'Add Home Server', `
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
          <input class="input" id="m-auth-port" type="number" min="1" max="65535" value="${srv?.auth_port ?? 1812}" />
        </div>
        <div class="field">
          <label>Acct port</label>
          <input class="input" id="m-acct-port" type="number" min="1" max="65535" value="${srv?.acct_port ?? 1813}" />
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
          <input class="input" id="m-vpn" list="m-vpn-list" placeholder="wg0 / tun0" value="${esc(srv?.vpn_interface)}" />
          <datalist id="m-vpn-list">
            ${this._vpnTunnels.map(t => `<option value="${esc(t.iface || t.name)}">${esc(t.name)} (${esc(t.type)})</option>`).join('')}
          </datalist>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Response window (s)</label>
          <input class="input" id="m-response" type="number" min="1" max="300" value="${srv?.response_window ?? 20}" />
        </div>
        <div class="field">
          <label>Zombie period (s)</label>
          <input class="input" id="m-zombie" type="number" min="1" max="600" value="${srv?.zombie_period ?? 40}" />
        </div>
      </div>
      <div class="field">
        <label>Revive interval (s)</label>
        <input class="input" id="m-revive" type="number" min="10" max="3600" value="${srv?.revive_interval ?? 120}" />
      </div>
    `, () => this._saveServer());
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
    } catch (e) { toast(e.message || 'Delete failed', 'error'); }
  }

  async _probeServer(srv) {
    try {
      const updated = await api.post(`/realms/servers/${srv.id}/probe`, {});
      const [label] = STATUS_BADGE[updated.status] || STATUS_BADGE.unknown;
      toast(`${srv.name}: ${label}${updated.last_rtt_ms != null ? ` (${updated.last_rtt_ms} ms)` : ''}`,
            updated.status === 'up' ? 'success' : 'error');
      this._loadAll();
    } catch (e) { toast(e.message || 'Probe failed', 'error'); }
  }

  // — Pool modal —

  _openPoolModal(pool) {
    this._editing = pool;
    const types = POOL_TYPES.map(t =>
      `<option value="${t}" ${pool?.pool_type === t ? 'selected' : ''}>${t}</option>`).join('');
    const members = this._servers.map(s => `
      <label class="member-item">
        <input type="checkbox" class="m-member" value="${s.id}"
          ${pool?.server_ids?.includes(s.id) ? 'checked' : ''} />
        ${esc(s.name)} <span class="muted mono">${esc(s.host)}</span> ${statusBadge(s.status)}
      </label>
    `).join('');
    this._openModal(pool ? `Edit Pool ${pool.name}` : 'Add Pool', `
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
        <div class="member-list">${members || '<span class="muted">No home servers yet — add one first</span>'}</div>
      </div>
    `, () => this._savePool());
  }

  async _savePool() {
    const server_ids = [...this.shadowRoot.querySelectorAll('.m-member:checked')].map(cb => Number(cb.value));
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
    } catch (e) { toast(e.message || 'Delete failed', 'error'); }
  }

  // — Routing modal —

  async _openRouteModal() {
    try {
      const res = await api.get('/nas/groups/list?size=100');
      this._nasGroups = res.items || [];
    } catch { this._nasGroups = []; }
    const groups = this._nasGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    const realms = this._realms.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    this._openModal('Route NAS Group to Realm', `
      <div class="field">
        <label>NAS group</label>
        <select class="input" id="m-group">${groups || '<option value="">No NAS groups defined</option>'}</select>
      </div>
      <div class="field">
        <label>Realm</label>
        <select class="input" id="m-realm">${realms || '<option value="">No realms defined</option>'}</select>
      </div>
    `, () => this._saveRoute(), 'Add Route');
  }

  async _saveRoute() {
    const nas_group_id = Number(this._mval('m-group'));
    const realm_id = Number(this._mval('m-realm'));
    if (!nas_group_id || !realm_id) { toast('Select a NAS group and a realm', 'error'); return; }
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
    if (!await confirmDialog(`Remove route ${route.nas_group_name} → ${route.realm_name}?`, { danger: true })) return;
    try {
      await api.delete(`/realms/nas-routing/${route.id}`);
      toast('Route removed', 'success');
      this._loadAll();
    } catch (e) { toast(e.message || 'Delete failed', 'error'); }
  }

  // ── proxy.conf ──────────────────────────────────────────────────────────────

  async _previewConf() {
    try {
      const res = await api.get('/realms/proxy-conf/preview');
      this._openModal(`proxy.conf preview — ${res.path}`,
        `<pre class="conf">${esc(res.content)}</pre>`, null);
    } catch (e) { toast(e.message || 'Preview failed', 'error'); }
  }

  async _applyConf() {
    if (!await confirmDialog(
      'Write proxy.conf and restart FreeRADIUS? Active sessions are not affected, but new authentications pause briefly during the restart.',
      { danger: true })) return;
    try {
      const res = await api.post('/realms/proxy-conf/apply', {});
      toast(`proxy.conf written (${res.bytes} bytes) — FreeRADIUS restart triggered`, 'success');
    } catch (e) { toast(e.message || 'Apply failed', 'error'); }
  }
}

customElements.define('realms-view', RealmsView);
router.register('/realms', () => document.createElement('realms-view'));
