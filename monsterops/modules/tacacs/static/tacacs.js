import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { applyServerErrors, clearFieldErrors } from '/js/utils/form.js';
import { densityBarHTML, makeSortable, wireDensityBar } from '/js/utils/table.js';
import { emptyRowHTML } from '/js/utils/empty.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

const AUTH_LABEL = {
  local_password: ['Local password', 'badge-up'],
  directory_delegated: ['Directory (AD)', 'badge-warn'],
};

const RECORD_BADGE = {
  start: ['badge-up', 'Login'],
  stop: ['badge-muted', 'Logout'],
  update: ['badge-muted', 'Update'],
};

const TABS = [
  ['clients', 'Clients'],
  ['accounts', 'Accounts'],
  ['log', 'Accounting log'],
];

const STYLE = `
  @import '/css/theme.css';
  :host { display: block; padding: 1.5rem; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem; }
  .page-title  { font-size: 1.25rem; font-weight: 600; }
  .subtitle { color: var(--color-muted); font-size: 0.82rem; margin-bottom: 1rem; }
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
  .badge { display: inline-block; padding: 0.12rem 0.5rem; border-radius: 9999px; font-size: 0.68rem; font-weight: 600; }
  .badge-up    { background: var(--mr-accept-tint); color: var(--mr-accept); }
  .badge-warn  { background: color-mix(in srgb, var(--color-warning, #eab308) 15%, transparent); color: var(--color-warning, #eab308); }
  .badge-down  { background: var(--mr-reject-tint); color: var(--mr-reject); }
  .badge-muted { background: rgba(139,149,165,0.12); color: var(--color-muted); }
  .badge-permit { background: var(--mr-accept-tint); color: var(--mr-accept); }
  .badge-deny  { background: var(--mr-reject-tint); color: var(--mr-reject); }
  .mono { font-family: var(--mr-font-data, monospace); font-size: 0.78rem; }
  .muted { color: var(--color-muted); }
  .actions { display: flex; gap: 0.35rem; justify-content: flex-end; }
  .tab-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .filters { display: flex; gap: 0.5rem; align-items: center; }
  .filters .input { width: auto; }
  .notice { display: flex; align-items: flex-start; gap: 0.6rem; border-radius: var(--radius); padding: 0.6rem 0.8rem;
            margin-bottom: 1rem; font-size: 0.8rem; line-height: 1.45; border: 1px solid; }
  .notice-warn { background: color-mix(in srgb, var(--color-warning, #eab308) 10%, transparent);
                 border-color: color-mix(in srgb, var(--color-warning, #eab308) 45%, transparent); }
  .notice-ok   { background: var(--mr-accept-tint); border-color: color-mix(in srgb, var(--mr-accept) 40%, transparent); }
  .notice .notice-body { flex: 1; }
  .notice .notice-icon { font-size: 1rem; line-height: 1.3; }
  .notice code { font-family: var(--mr-font-data, monospace); background: var(--color-bg); padding: 0.05rem 0.3rem; border-radius: 4px; }
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
  .rule-form { display: grid; grid-template-columns: 90px 110px 1fr auto; gap: 0.5rem; align-items: end;
               border-top: 1px solid var(--color-border); padding-top: 0.85rem; margin-top: 0.5rem; }
  .rule-form .field { margin-bottom: 0; }
`;

class TacacsView extends HTMLElement {
  constructor() {
    super();
    this._tab = 'clients';
    this._status = null;
    this._clients = [];
    this._users = [];
    this._nas = [];
    this._sources = [];
    this._acct = [];
    this._acctFilter = { username: '', record_type: '' };
    this._ruleEdit = null; // rule id being edited in the policy modal, or null
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <div class="page-header">
        <div>
          <div class="page-title">TACACS+ device administration</div>
        </div>
        <div class="header-actions">
          <button class="btn btn-primary" id="add-btn">Add</button>
        </div>
      </div>
      <div class="subtitle">Router/switch admin login, command authorization, and accounting — separate from RADIUS.</div>
      <div id="status-banner"></div>
      <div class="tabs">
        ${
      TABS.map(([id, label]) => `<button class="tab" data-tab="${id}">${label}</button>`).join('')
    }
      </div>
      <div id="content"></div>
      <div class="modal-overlay" id="overlay"><div class="modal" id="modal"></div></div>`;

    this.$('.tabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) this._switchTab(t.dataset.tab);
    });
    this.$('#add-btn').addEventListener('click', () => this._onAdd());
    this.$('#overlay').addEventListener('click', (e) => {
      if (e.target === this.$('#overlay')) this._closeModal();
    });
    document.addEventListener('keydown', this._onKey);
    this._boot();
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
  }

  _onKey = (e) => {
    if (e.key === 'Escape' && this.$('#overlay').classList.contains('open')) this._closeModal();
  };

  $(s) {
    return this.shadowRoot.querySelector(s);
  }

  $$(s) {
    return this.shadowRoot.querySelectorAll(s);
  }

  async _boot() {
    try {
      const [status, clients, users, nasResp, sources] = await Promise.all([
        api.get('/tacacs/status'),
        api.get('/tacacs/clients'),
        api.get('/tacacs/users'),
        api.get('/nas').catch(() => ({ items: [] })),
        api.get('/tacacs/identity-sources').catch(() => []),
      ]);
      this._status = status;
      this._clients = clients;
      this._users = users;
      this._nas = nasResp.items || [];
      this._sources = sources;
    } catch {
      toast('Failed to load TACACS+ data', 'error');
    }
    this._renderStatus();
    this._switchTab(this._tab);
  }

  _renderStatus() {
    const s = this._status;
    const banner = this.$('#status-banner');
    if (!s) {
      banner.innerHTML = '';
      return;
    }
    if (s.enabled) {
      banner.innerHTML = `<div class="notice notice-ok">
        <span class="notice-icon">●</span>
        <div class="notice-body">Listener is <strong>on</strong>, serving TACACS+ on <code>${
        esc(s.host)
      }:${s.port}</code>.
        Point each device's <code>aaa</code> config at this address using the shared secret from its client entry.</div>
      </div>`;
    } else {
      banner.innerHTML = `<div class="notice notice-warn">
        <span class="notice-icon">○</span>
        <div class="notice-body">Listener is <strong>off</strong>. Configure clients and accounts now, then set
        <code>MONSTEROPS_TACACS_ENABLED=true</code> and restart to start serving on TCP <code>${s.port}</code>.</div>
      </div>`;
    }
  }

  _switchTab(tab) {
    this._tab = tab;
    this.$$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    const addBtn = this.$('#add-btn');
    if (tab === 'clients') addBtn.textContent = 'Add client';
    else if (tab === 'accounts') addBtn.textContent = 'Add account';
    addBtn.style.display = tab === 'log' ? 'none' : '';
    if (tab === 'clients') this._renderClients();
    else if (tab === 'accounts') this._renderAccounts();
    else this._loadAccounting();
  }

  _onAdd() {
    if (this._tab === 'clients') this._clientModal();
    else if (this._tab === 'accounts') this._userModal();
  }

  // ── Clients ─────────────────────────────────────────────────────────────────

  _nasName(id) {
    if (id == null) return '<span class="muted">—</span>';
    const n = this._nas.find((x) => x.id === id);
    return n ? esc(n.shortname || n.nasname || `#${id}`) : `<span class="muted">#${id}</span>`;
  }

  _renderClients() {
    const rows = this._clients
      .map(
        (c) =>
          `<tr>
          <td>${esc(c.name)}</td>
          <td class="mono">${esc(c.address)}</td>
          <td>${this._nasName(c.nas_id)}</td>
          <td>${c.single_connect ? 'Yes' : '<span class="muted">No</span>'}</td>
          <td>${
            c.enabled
              ? '<span class="badge badge-up">Enabled</span>'
              : '<span class="badge badge-down">Disabled</span>'
          }</td>
          <td><div class="actions">
            <button class="btn btn-sm" data-edit="${c.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del="${c.id}">Delete</button>
          </div></td>
        </tr>`,
      )
      .join('');
    this.$('#content').innerHTML = `
      <div class="tab-toolbar"><span class="muted">${this._clients.length} client(s)</span>${densityBarHTML()}</div>
      <div class="card"><table>
        <thead><tr><th>Name</th><th>Address</th><th>NAS</th><th>Single-conn</th><th>Status</th><th data-no-sort></th></tr></thead>
        <tbody>${
      rows ||
      emptyRowHTML(6, {
        title: 'No clients yet',
        message: 'Add the routers/switches that will use MonsterOps as their TACACS+ server.',
      })
    }</tbody>
      </table></div>`;
    this._wireTable('#content');
    this.$('#content').querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener(
        'click',
        () => this._clientModal(this._clients.find((c) => c.id === +b.dataset.edit)),
      )
    );
    this.$('#content').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener(
        'click',
        () => this._deleteClient(this._clients.find((c) => c.id === +b.dataset.del)),
      )
    );
  }

  _clientModal(existing) {
    const c = existing || {};
    const editing = !!existing;
    const nasOptions = ['<option value="">— none —</option>']
      .concat(
        this._nas.map((n) =>
          `<option value="${n.id}" ${c.nas_id === n.id ? 'selected' : ''}>${
            esc(n.shortname || n.nasname)
          }</option>`
        ),
      )
      .join('');
    this._openModal(`
      <div class="modal-header"><div class="modal-title">${
      editing ? 'Edit client' : 'Add client'
    }</div>
        <button class="modal-close" data-close>&times;</button></div>
      <div class="field"><label for="m-name">Name</label>
        <input class="input" id="m-name" value="${esc(c.name || '')}" placeholder="core-sw-1"></div>
      <div class="field"><label for="m-address">Address (IP or CIDR)</label>
        <input class="input" id="m-address" value="${
      esc(c.address || '')
    }" placeholder="10.0.0.1 or 10.0.0.0/24"></div>
      <div class="field"><label for="m-secret">Shared secret</label>
        <input class="input" id="m-secret" type="password" placeholder="${
      editing ? '•••••••• (leave blank to keep)' : ''
    }">
        <div class="hint">The key the device signs its packets with. It is encrypted at rest and never shown again.</div></div>
      <div class="field"><label for="m-nas_id">Linked NAS (optional)</label>
        <select class="input" id="m-nas_id">${nasOptions}</select></div>
      <label class="check-row"><input type="checkbox" id="m-single_connect" ${
      c.single_connect ? 'checked' : ''
    }> Single-connection mode</label>
      <label class="check-row"><input type="checkbox" id="m-enabled" ${
      c.enabled !== false ? 'checked' : ''
    }> Enabled</label>
      <div class="modal-footer">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="m-save">${editing ? 'Save' : 'Create'}</button>
      </div>`);
    this.$('#m-save').addEventListener('click', () => this._saveClient(existing));
  }

  async _saveClient(existing) {
    const box = this.$('#modal');
    clearFieldErrors(box);
    const body = {
      name: this.$('#m-name').value.trim(),
      address: this.$('#m-address').value.trim(),
      nas_id: this.$('#m-nas_id').value ? +this.$('#m-nas_id').value : null,
      single_connect: this.$('#m-single_connect').checked,
      enabled: this.$('#m-enabled').checked,
    };
    const secret = this.$('#m-secret').value;
    if (secret || !existing) body.secret = secret;
    try {
      if (existing) await api.put(`/tacacs/clients/${existing.id}`, body);
      else await api.post('/tacacs/clients', body);
      toast(existing ? 'Client updated' : 'Client created', 'success');
      this._closeModal();
      this._clients = await api.get('/tacacs/clients');
      this._renderClients();
    } catch (e) {
      if (!applyServerErrors(box, e)) toast(e.message, 'error');
    }
  }

  async _deleteClient(c) {
    if (!c) return;
    if (
      !(await confirmDialog(`Delete client “${c.name}”? The device will no longer be served.`, {
        title: 'Delete client',
        danger: true,
        okLabel: 'Delete',
      }))
    ) return;
    try {
      await api.delete(`/tacacs/clients/${c.id}`);
      toast('Client deleted', 'success');
      this._clients = await api.get('/tacacs/clients');
      this._renderClients();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── Accounts ────────────────────────────────────────────────────────────────

  _renderAccounts() {
    const rows = this._users
      .map((u) => {
        const [label, cls] = AUTH_LABEL[u.auth_method] || [u.auth_method, 'badge-muted'];
        const cred = u.auth_method === 'local_password'
          ? (u.has_password
            ? '<span class="badge badge-up">Set</span>'
            : '<span class="badge badge-down">Missing</span>')
          : '<span class="muted">directory</span>';
        return `<tr>
          <td>${esc(u.username)}</td>
          <td><span class="badge ${cls}">${esc(label)}</span></td>
          <td>${u.privilege_level}</td>
          <td>${cred}</td>
          <td>${
          u.enabled
            ? '<span class="badge badge-up">Enabled</span>'
            : '<span class="badge badge-down">Disabled</span>'
        }</td>
          <td><div class="actions">
            <button class="btn btn-sm" data-policy="${u.id}">Policy</button>
            <button class="btn btn-sm" data-edit="${u.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del="${u.id}">Delete</button>
          </div></td>
        </tr>`;
      })
      .join('');
    this.$('#content').innerHTML = `
      <div class="tab-toolbar"><span class="muted">${this._users.length} account(s)</span>${densityBarHTML()}</div>
      <div class="card"><table>
        <thead><tr><th>Username</th><th>Auth</th><th>Priv</th><th>Password</th><th>Status</th><th data-no-sort></th></tr></thead>
        <tbody>${
      rows ||
      emptyRowHTML(6, {
        title: 'No accounts yet',
        message: 'Add the people who log in to your network devices.',
      })
    }</tbody>
      </table></div>`;
    this._wireTable('#content');
    this.$('#content').querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener(
        'click',
        () => this._userModal(this._users.find((u) => u.id === +b.dataset.edit)),
      )
    );
    this.$('#content').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener(
        'click',
        () => this._deleteUser(this._users.find((u) => u.id === +b.dataset.del)),
      )
    );
    this.$('#content').querySelectorAll('[data-policy]').forEach((b) =>
      b.addEventListener(
        'click',
        () => this._policyModal(this._users.find((u) => u.id === +b.dataset.policy)),
      )
    );
  }

  _userModal(existing) {
    const u = existing || {};
    const editing = !!existing;
    const method = u.auth_method || 'local_password';
    const privOpts = Array.from(
      { length: 16 },
      (_, i) =>
        `<option value="${i}" ${(u.privilege_level ?? 1) === i ? 'selected' : ''}>${i}${
          i === 15 ? ' (full)' : ''
        }</option>`,
    ).join('');
    const srcOpts = ['<option value="">— select source —</option>']
      .concat(
        this._sources.map((s) =>
          `<option value="${s.id}" ${u.identity_source_id === s.id ? 'selected' : ''}>${
            esc(s.name)
          }</option>`
        ),
      )
      .join('');
    this._openModal(`
      <div class="modal-header"><div class="modal-title">${
      editing ? 'Edit account' : 'Add account'
    }</div>
        <button class="modal-close" data-close>&times;</button></div>
      <div class="field"><label for="m-username">Username</label>
        <input class="input" id="m-username" value="${
      esc(u.username || '')
    }" placeholder="netadmin"></div>
      <div class="field-row">
        <div class="field"><label for="m-auth_method">Authentication</label>
          <select class="input" id="m-auth_method">
            <option value="local_password" ${
      method === 'local_password' ? 'selected' : ''
    }>Local password</option>
            <option value="directory_delegated" ${
      method === 'directory_delegated' ? 'selected' : ''
    }>Directory (AD)</option>
          </select></div>
        <div class="field"><label for="m-privilege_level">Privilege level</label>
          <select class="input" id="m-privilege_level">${privOpts}</select></div>
      </div>
      <div class="field" id="row-password">
        <label for="m-password">Password</label>
        <input class="input" id="m-password" type="password" placeholder="${
      editing ? '•••••••• (leave blank to keep)' : ''
    }">
      </div>
      <div class="field" id="row-source" style="display:none">
        <label for="m-identity_source_id">Identity source</label>
        <select class="input" id="m-identity_source_id">${srcOpts}</select>
        <div class="hint">Login is verified by a live bind against this Active Directory source. Manage sources under Realms.</div>
      </div>
      <label class="check-row"><input type="checkbox" id="m-enabled" ${
      u.enabled !== false ? 'checked' : ''
    }> Enabled</label>
      <div class="modal-footer">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="m-save">${editing ? 'Save' : 'Create'}</button>
      </div>`);
    const toggle = () => {
      const delegated = this.$('#m-auth_method').value === 'directory_delegated';
      this.$('#row-source').style.display = delegated ? '' : 'none';
      this.$('#row-password').style.display = delegated ? 'none' : '';
    };
    this.$('#m-auth_method').addEventListener('change', toggle);
    toggle();
    this.$('#m-save').addEventListener('click', () => this._saveUser(existing));
  }

  async _saveUser(existing) {
    const box = this.$('#modal');
    clearFieldErrors(box);
    const method = this.$('#m-auth_method').value;
    const body = {
      username: this.$('#m-username').value.trim(),
      auth_method: method,
      privilege_level: +this.$('#m-privilege_level').value,
      enabled: this.$('#m-enabled').checked,
      identity_source_id: method === 'directory_delegated' && this.$('#m-identity_source_id').value
        ? +this.$('#m-identity_source_id').value
        : null,
      password: method === 'local_password' ? this.$('#m-password').value : '',
    };
    try {
      if (existing) await api.put(`/tacacs/users/${existing.id}`, body);
      else await api.post('/tacacs/users', body);
      toast(existing ? 'Account updated' : 'Account created', 'success');
      this._closeModal();
      this._users = await api.get('/tacacs/users');
      this._renderAccounts();
    } catch (e) {
      if (!applyServerErrors(box, e)) toast(e.message, 'error');
    }
  }

  async _deleteUser(u) {
    if (!u) return;
    if (
      !(await confirmDialog(`Delete account “${u.username}”? Its command policy is removed too.`, {
        title: 'Delete account',
        danger: true,
        okLabel: 'Delete',
      }))
    ) return;
    try {
      await api.delete(`/tacacs/users/${u.id}`);
      toast('Account deleted', 'success');
      this._users = await api.get('/tacacs/users');
      this._renderAccounts();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── Command policy (per account) ──────────────────────────────────────────────

  async _policyModal(u) {
    if (!u) return;
    this._policyUser = u;
    this._ruleEdit = null;
    this._openModal(`
      <div class="modal-header"><div class="modal-title">Command policy — ${esc(u.username)}</div>
        <button class="modal-close" data-close>&times;</button></div>
      <div id="policy-body"><p class="muted">Loading…</p></div>
      <div class="modal-footer"><button class="btn" data-close>Close</button></div>`);
    await this._renderPolicy();
  }

  async _renderPolicy() {
    const u = this._policyUser;
    let rules = [];
    try {
      rules = await api.get(`/tacacs/users/${u.id}/rules`);
    } catch {
      this.$('#policy-body').innerHTML = `<p class="muted">Could not load rules.</p>`;
      return;
    }
    const rows = rules
      .map((r) =>
        `<tr>
        <td>${r.sort_order}</td>
        <td><span class="badge badge-${r.action}">${r.action}</span></td>
        <td class="mono">${esc(r.command)}</td>
        <td><div class="actions">
          <button class="btn btn-sm" data-redit="${r.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-rdel="${r.id}">Delete</button>
        </div></td>
      </tr>`
      )
      .join('');
    const hint = rules.length === 0
      ? `<div class="hint">No rules — this account may run <strong>any</strong> command (its privilege level still applies). Add a rule to start restricting.</div>`
      : `<div class="hint">Rules are matched top-down by order; first match wins. Once any rule exists, a command matching none is <strong>denied</strong>.</div>`;
    const e = this._ruleEdit ? rules.find((r) => r.id === this._ruleEdit) : null;
    this.$('#policy-body').innerHTML = `
      <div class="card"><table>
        <thead><tr><th>Order</th><th>Action</th><th>Command (regex)</th><th data-no-sort></th></tr></thead>
        <tbody>${
      rows || `<tr><td colspan="4" class="muted" style="padding:0.75rem">No rules yet.</td></tr>`
    }</tbody>
      </table></div>
      ${hint}
      <div class="rule-form">
        <div class="field"><label for="m-sort_order">Order</label>
          <input class="input" id="m-sort_order" type="number" min="0" value="${
      e ? e.sort_order : rules.length
    }"></div>
        <div class="field"><label for="m-action">Action</label>
          <select class="input" id="m-action">
            <option value="permit" ${e && e.action === 'permit' ? 'selected' : ''}>permit</option>
            <option value="deny" ${e && e.action === 'deny' ? 'selected' : ''}>deny</option>
          </select></div>
        <div class="field"><label for="m-command">Command pattern</label>
          <input class="input mono" id="m-command" value="${
      e ? esc(e.command) : ''
    }" placeholder="show.*"></div>
        <button class="btn btn-primary" id="m-rule-save">${e ? 'Save' : 'Add'}</button>
      </div>`;
    this.$('#policy-body').querySelectorAll('[data-redit]').forEach((b) =>
      b.addEventListener('click', () => {
        this._ruleEdit = +b.dataset.redit;
        this._renderPolicy();
      })
    );
    this.$('#policy-body').querySelectorAll('[data-rdel]').forEach((b) =>
      b.addEventListener('click', () => this._deleteRule(+b.dataset.rdel))
    );
    this.$('#m-rule-save').addEventListener('click', () => this._saveRule());
  }

  async _saveRule() {
    const u = this._policyUser;
    const box = this.$('#policy-body');
    clearFieldErrors(box);
    const body = {
      sort_order: +this.$('#m-sort_order').value || 0,
      action: this.$('#m-action').value,
      command: this.$('#m-command').value,
    };
    try {
      if (this._ruleEdit) await api.put(`/tacacs/rules/${this._ruleEdit}`, body);
      else await api.post(`/tacacs/users/${u.id}/rules`, body);
      this._ruleEdit = null;
      await this._renderPolicy();
    } catch (e) {
      if (!applyServerErrors(box, e)) toast(e.message, 'error');
    }
  }

  async _deleteRule(id) {
    try {
      await api.delete(`/tacacs/rules/${id}`);
      if (this._ruleEdit === id) this._ruleEdit = null;
      await this._renderPolicy();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ── Accounting log ────────────────────────────────────────────────────────────

  async _loadAccounting() {
    const p = new URLSearchParams();
    if (this._acctFilter.username) p.set('username', this._acctFilter.username);
    if (this._acctFilter.record_type) p.set('record_type', this._acctFilter.record_type);
    p.set('limit', '200');
    try {
      this._acct = await api.get(`/tacacs/accounting?${p.toString()}`);
    } catch {
      this._acct = [];
      toast('Failed to load accounting log', 'error');
    }
    this._renderAccounting();
  }

  _renderAccounting() {
    const rows = this._acct
      .map((r) => {
        const [cls, label] = RECORD_BADGE[r.record_type] || ['badge-muted', r.record_type];
        return `<tr>
          <td class="mono" data-sort="${r.created_at}">${fmtDate(r.created_at)}</td>
          <td>${esc(r.username)}</td>
          <td>${esc(r.client_name || '—')}</td>
          <td><span class="badge ${cls}">${esc(label)}</span></td>
          <td class="mono">${r.cmd ? esc(r.cmd) : '<span class="muted">—</span>'}</td>
          <td>${r.priv_lvl ?? '<span class="muted">—</span>'}</td>
        </tr>`;
      })
      .join('');
    this.$('#content').innerHTML = `
      <div class="tab-toolbar">
        <div class="filters">
          <input class="input" id="f-username" placeholder="Filter by username" value="${
      esc(this._acctFilter.username)
    }">
          <select class="input" id="f-type">
            <option value="">All types</option>
            <option value="start" ${
      this._acctFilter.record_type === 'start' ? 'selected' : ''
    }>Login</option>
            <option value="stop" ${
      this._acctFilter.record_type === 'stop' ? 'selected' : ''
    }>Logout</option>
            <option value="update" ${
      this._acctFilter.record_type === 'update' ? 'selected' : ''
    }>Update</option>
          </select>
          <button class="btn btn-sm" id="f-apply">Filter</button>
        </div>
        ${densityBarHTML()}
      </div>
      <div class="card"><table>
        <thead><tr><th>Time</th><th>User</th><th>Device</th><th>Type</th><th>Command</th><th>Priv</th></tr></thead>
        <tbody>${
      rows ||
      emptyRowHTML(6, {
        title: 'No accounting records',
        message:
          'Command and login activity from your devices will appear here once the listener is serving.',
      })
    }</tbody>
      </table></div>`;
    this._wireTable('#content');
    const apply = () => {
      this._acctFilter.username = this.$('#f-username').value.trim();
      this._acctFilter.record_type = this.$('#f-type').value;
      this._loadAccounting();
    };
    this.$('#f-apply').addEventListener('click', apply);
    this.$('#f-username').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') apply();
    });
  }

  // ── shared helpers ────────────────────────────────────────────────────────────

  _wireTable(scope) {
    const wrap = this.$(scope);
    wireDensityBar(wrap, () => wrap.querySelector('table'));
    const table = wrap.querySelector('table');
    if (table) makeSortable(table);
  }

  _openModal(html) {
    this.$('#modal').innerHTML = html;
    this.$('#overlay').classList.add('open');
    this.$$('#modal [data-close]').forEach((b) =>
      b.addEventListener('click', () => this._closeModal())
    );
    const first = this.$('#modal .input');
    if (first) first.focus();
  }

  _closeModal() {
    this.$('#overlay').classList.remove('open');
    this.$('#modal').innerHTML = '';
  }
}

customElements.define('tacacs-view', TacacsView);
router.register('/tacacs', () => document.createElement('tacacs-view'));
