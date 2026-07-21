import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { emptyRowHTML, emptyStateHTML, skeletonBlock } from '/js/utils/empty.js';
import { applyServerErrors, clearFieldErrors, setFieldError } from '/js/utils/form.js';
import { qrSvg } from '/js/utils/qr.js';

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(
    /"/g,
    '&quot;',
  );
}
function _fmtTime(s) {
  return s ? new Date(s).toLocaleString() : '—';
}

// Words that should stay fully upper-cased when humanizing action names.
const _ACRONYMS = new Set([
  'nas',
  'ip',
  'vpn',
  'api',
  'ssh',
  'url',
  'db',
  'coa',
  'id',
  'dns',
  'tls',
  'http',
  'https',
  'gelf',
  'hmac',
  'sql',
]);
function _titleWord(w) {
  if (!w) return w;
  if (_ACRONYMS.has(w.toLowerCase())) return w.toUpperCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}
// "nas_manager.create" -> "NAS Manager · create"; "ip_pools.update" -> "IP Pools · update"
function _humanAction(a) {
  const [cat, ...rest] = String(a || '').split('.');
  const catLabel = cat.split('_').map(_titleWord).join(' ');
  const verb = rest.join('.').replace(/_/g, ' ');
  return verb ? `${catLabel} · ${verb}` : catLabel;
}

// Compact 2-chip summary for the table cell. Full detail opens on row click.
function _auditDetailSummary(l) {
  const d = l.detail || {};
  const bits = [];
  if (l.target) bits.push(`target: ${l.target}`);
  if (d.method || d.path) bits.push(`${(d.method || '')} ${(d.path || '')}`.trim());
  for (const [k, v] of Object.entries(d)) {
    if (['method', 'path', 'user_agent'].includes(k)) continue;
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
    bits.push(`${k}: ${val.length > 48 ? val.slice(0, 48) + '…' : val}`);
  }
  if (!bits.length) return '<span class="muted">—</span>';
  const MAX = 2;
  const chips = bits.slice(0, MAX).map((b) => `<span class="detail-chip">${_esc(b)}</span>`).join(
    '',
  );
  const extra = bits.length - MAX;
  return chips + (extra > 0 ? `<span class="more-badge">+${extra}</span>` : '');
}

const ROLE_COLORS = { superadmin: 'danger', admin: 'warning', readonly: 'info' };

const STYLE = `
  <style>
    @import '/css/theme.css';
    :host { display: block; padding: 1.5rem; }
    .page-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.25rem; color: var(--color-text); }
    .tab-bar { display: flex; border-bottom: 2px solid var(--color-border); margin-bottom: 1.25rem; gap: 0; }
    .tab-bar button { padding: 0.5rem 1.1rem; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; font-size: 0.85rem; font-family: var(--font); color: var(--color-muted); cursor: pointer; white-space: nowrap; }
    .tab-bar button.active { color: var(--color-primary); border-bottom-color: var(--color-primary); font-weight: 600; }
    .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); margin-bottom: 1rem; }
    .card-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); }
    .card-title { font-size: 0.85rem; font-weight: 600; color: var(--color-text); }
    .btn { padding: 0.35rem 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface); color: var(--color-text); font-size: 0.8rem; font-family: var(--font); cursor: pointer; }
    .btn:hover { background: var(--color-bg); }
    .btn-primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
    .btn-primary:hover { opacity: 0.9; }
    .btn-danger { background: color-mix(in srgb, var(--color-danger) 10%, transparent); color: var(--color-danger); border-color: color-mix(in srgb, var(--color-danger) 30%, transparent); }
    .btn-danger:hover { background: color-mix(in srgb, var(--color-danger) 18%, transparent); }
    .btn-sm { padding: 0.2rem 0.5rem; font-size: 0.75rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
    th { text-align: left; padding: 0.4rem 0.75rem; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted); border-bottom: 1px solid var(--color-border); background: var(--color-bg); }
    td { padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--color-bg); }
    .badge { display: inline-block; padding: 0.12rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
    .badge-success { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); }
    .badge-danger  { background: color-mix(in srgb, var(--color-danger)  15%, transparent); color: var(--color-danger); }
    .badge-warning { background: color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent); color: var(--color-warning, #f59e0b); }
    .badge-info    { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
    .empty { padding: 2rem; text-align: center; color: var(--color-muted); font-size: 0.85rem; }
    .form-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 1rem; margin-bottom: 1rem; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.3rem; }
    .form-label { font-size: 0.75rem; font-weight: 600; color: var(--color-muted); }
    .input { padding: 0.4rem 0.65rem; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text); font-size: 0.85rem; font-family: var(--font); width: 100%; box-sizing: border-box; }
    .input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }
    .form-actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    .error-msg { color: var(--color-danger); font-size: 0.78rem; margin-top: 0.4rem; }
    .toggle { position: relative; display: inline-block; width: 36px; height: 20px; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; inset: 0; background: var(--color-border); border-radius: 9999px; cursor: pointer; transition: 0.2s; }
    .slider:before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.2s; }
    input:checked + .slider { background: var(--color-primary); }
    input:checked + .slider:before { transform: translateX(16px); }
    .settings-grid { display: grid; gap: 0; }
    .setting-row { display: flex; align-items: flex-start; gap: 1rem; padding: 0.65rem 1rem; border-bottom: 1px solid var(--color-border); font-size: 0.83rem; }
    .setting-row:last-child { border-bottom: none; }
    .setting-key { color: var(--color-muted); font-size: 0.75rem; font-family: monospace; min-width: 200px; flex-shrink: 0; padding-top: 0.1rem; }
    .setting-val { color: var(--color-text); word-break: break-all; }
    .setting-val.ok  { color: var(--color-success); }
    .setting-val.bad { color: var(--color-danger); font-weight: 600; }
    .module-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 1rem; }
    .module-chip { display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.65rem; border: 1px solid var(--color-border); border-radius: 9999px; font-size: 0.78rem; color: var(--color-text); }
    .module-chip.enabled { border-color: var(--color-success); background: color-mix(in srgb, var(--color-success) 10%, transparent); color: var(--color-success); }
    .section-label { padding: 0.65rem 1rem 0.35rem; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-muted); border-bottom: 1px solid var(--color-border); }
    .backup-body { padding: 1.25rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .backup-desc { color: var(--color-muted); font-size: 0.83rem; }
    .info-box { background: color-mix(in srgb, var(--color-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent); border-radius: var(--radius); padding: 0.65rem 0.85rem; font-size: 0.8rem; color: var(--color-text); }
    .warn-box { background: color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent); border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 25%, transparent); border-radius: var(--radius); padding: 0.65rem 0.85rem; font-size: 0.8rem; color: var(--color-text); }
    .plugin-list { display: flex; flex-direction: column; }
    .plugin-row { display: flex; align-items: center; justify-content: space-between; padding: 0.65rem 1rem; border-bottom: 1px solid var(--color-border); font-size: 0.83rem; }
    .plugin-row:last-child { border-bottom: none; }
    .confirm-row td { background: color-mix(in srgb, var(--color-danger) 6%, transparent) !important; }
    .mono { font-family: monospace; font-size: 0.8rem; }
    .muted { color: var(--color-muted); }
    .detail-chip { display: inline-block; background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: 4px; padding: 0.05rem 0.4rem; font-family: monospace;
      font-size: 0.72rem; color: var(--color-muted); white-space: nowrap; }
    .more-badge { display: inline-flex; align-items: center; padding: 0.05rem 0.42rem;
      background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 999px;
      font-size: 0.68rem; color: var(--color-muted); white-space: nowrap; margin-left: 0.2rem; flex-shrink: 0; }
    .loading { padding: 2rem; text-align: center; color: var(--color-muted); font-size: 0.85rem; }

    /* ── Audit table ──────────────────────────────────────────── */
    .audit-table { table-layout: fixed; }
    .audit-row { cursor: pointer; }
    .audit-row:hover td { background: var(--color-bg); }
    .audit-row.expanded td { background: color-mix(in srgb, var(--color-primary) 5%, transparent); }
    .td-detail { overflow: hidden; }
    .td-detail-inner { display: flex; align-items: center; gap: 0.25rem; overflow: hidden; min-width: 0; }
    .audit-detail-row > td { padding: 0 !important; border-bottom: 2px solid var(--color-border); }
    .audit-detail-row > td:hover { background: transparent !important; }

    /* Expand panel */
    .detail-expand { padding: 1rem 1.25rem; }
    .detail-meta-row { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 0.85rem; }
    .detail-meta-item { display: flex; flex-direction: column; gap: 0.12rem; }
    .dml { font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--color-muted); }
    .dmv { font-size: 0.8rem; color: var(--color-text); }
    .detail-http { font-family: monospace; font-size: 0.8rem; display: inline-block;
      padding: 0.3rem 0.65rem; background: var(--color-bg); border: 1px solid var(--color-border);
      border-radius: 4px; margin-bottom: 0.65rem; }
    .detail-ua { font-size: 0.72rem; color: var(--color-muted); margin-bottom: 0.65rem;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail-json-label { font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--color-muted); margin-bottom: 0.35rem; }
    .detail-json { font-family: var(--mr-font-data, monospace); font-size: 0.73rem; line-height: 1.55;
      white-space: pre; overflow-x: auto; overflow-y: auto; max-height: 320px;
      color: var(--color-text); background: var(--mr-canvas, var(--color-bg));
      border: 1px solid var(--color-border); border-radius: 6px;
      padding: 0.75rem; margin: 0; display: block; }
    .detail-close-row { display: flex; justify-content: flex-end; margin-top: 0.75rem; }
  </style>
`;

class SystemView extends HTMLElement {
  _tab = 'admins';
  _me = null;
  _editId = null; // null = create mode, number = edit mode
  _confirmDeleteId = null;

  async connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this._me = await api.get('/auth/me').catch(() => null);
    // Deep-link a tab via ?view= (the retired /apikeys route redirects here).
    const view = new URLSearchParams(location.hash.split('?')[1] || '').get('view');
    if (view && this._tabs().some((t) => t.key === view)) this._tab = view;
    this._render();
  }

  _isSuperadmin() {
    return this._me?.role === 'superadmin';
  }
  _isAdmin() {
    return this._me?.role === 'superadmin' || this._me?.role === 'admin';
  }

  _tabs() {
    const all = [
      { key: 'admins', label: 'Admins', super: true },
      { key: 'audit', label: 'Audit Log', super: true },
      { key: 'apikeys', label: 'API Keys', admin: true },
      { key: 'settings', label: 'Settings', super: false },
      { key: 'security', label: 'Security', super: false },
      { key: 'backup', label: 'Backup', super: true },
      { key: 'plugins', label: 'Plugins', super: false },
    ];
    return all.filter((t) => {
      if (t.super) return this._isSuperadmin(); // superadmin only
      if (t.admin) return this._isAdmin(); // superadmin or admin
      return true; // everyone
    });
  }

  _render() {
    const tabs = this._tabs();
    if (!tabs.find((t) => t.key === this._tab)) this._tab = tabs[0]?.key ?? 'settings';

    this.shadowRoot.innerHTML = `
      ${STYLE}
      <div class="page-title">System</div>
      <div class="tab-bar">
        ${
      tabs.map((t) =>
        `<button data-t="${t.key}" class="${
          t.key === this._tab ? 'active' : ''
        }">${t.label}</button>`
      ).join('')
    }
      </div>
      <div id="content"><div class="loading">Loading…</div></div>
    `;

    this.shadowRoot.querySelector('.tab-bar').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-t]');
      if (!btn) return;
      this._tab = btn.dataset.t;
      this._editId = null;
      this._confirmDeleteId = null;
      this.shadowRoot.querySelectorAll('.tab-bar button').forEach((b) =>
        b.classList.toggle('active', b.dataset.t === this._tab)
      );
      this._loadTab();
    });

    this._loadTab();
  }

  async _loadTab() {
    const el = this.shadowRoot.getElementById('content');
    el.innerHTML = skeletonBlock(this.shadowRoot, 6);
    try {
      await this[`_tab_${this._tab}`](el);
    } catch (e) {
      el.innerHTML = emptyStateHTML({
        title: 'Couldn’t load this section',
        message: e.message || 'Something went wrong. Try again.',
      });
    }
  }

  // ── API Keys ──────────────────────────────────────────────────────────────
  // Mounts the existing <apikeys-page> component (composition over rewrite).
  // `embedded` drops its padding + redundant heading since the tab supplies them.
  _tab_apikeys(el) {
    const page = document.createElement('apikeys-page');
    page.setAttribute('embedded', '');
    el.replaceChildren(page);
  }

  // ── Admins ────────────────────────────────────────────────────────────────

  async _tab_admins(el) {
    const admins = await api.get('/auth/admins');
    this._adminsData = admins;
    el.innerHTML = this._renderAdminsHTML(admins);
    this._bindAdmins(el);
  }

  _renderAdminsHTML(admins) {
    const showForm = this._editId !== null || this._showCreate;
    const editing = this._editId !== null ? admins.find((a) => a.id === this._editId) : null;

    return `
      ${showForm ? this._renderAdminForm(editing) : ''}
      <div class="card">
        <div class="card-header">
          <span class="card-title">Admin Accounts</span>
          ${
      !showForm ? `<button class="btn btn-primary btn-sm" id="btn-create">+ New Admin</button>` : ''
    }
        </div>
        <table>
          <thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>2FA</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${admins.map((a) => this._renderAdminRow(a)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderAdminRow(a) {
    const isSelf = a.id === this._me?.id;
    const isConfirm = this._confirmDeleteId === a.id;
    if (isConfirm) {
      return `<tr class="confirm-row">
        <td colspan="6"><span style="font-size:0.83rem">Delete <strong>${
        _esc(a.username)
      }</strong>? This cannot be undone.</span></td>
        <td>
          <button class="btn btn-danger btn-sm" data-action="confirm-delete" data-id="${a.id}">Delete</button>
          <button class="btn btn-sm" data-action="cancel-delete" style="margin-left:4px">Cancel</button>
        </td>
      </tr>`;
    }
    const roleColor = ROLE_COLORS[a.role] ?? 'info';
    return `<tr>
      <td><strong>${_esc(a.username)}</strong>${
      isSelf ? ' <span class="badge badge-info">You</span>' : ''
    }</td>
      <td class="muted">${_esc(a.email ?? '—')}</td>
      <td><span class="badge badge-${roleColor}">${_esc(a.role)}</span></td>
      <td><span class="badge ${a.is_active ? 'badge-success' : 'badge-danger'}">${
      a.is_active ? 'Active' : 'Disabled'
    }</span></td>
      <td>
        <span class="badge ${a.totp_enabled ? 'badge-success' : 'badge-info'}">${
      a.totp_enabled ? 'On' : 'Off'
    }</span>${a.totp_required ? ' <span class="badge badge-warning">Required</span>' : ''}
      </td>
      <td class="muted" style="font-size:0.78rem">${_fmtTime(a.created_at)}</td>
      <td>
        <button class="btn btn-sm" data-action="edit" data-id="${a.id}">Edit</button>
        ${
      a.totp_enabled
        ? `<button class="btn btn-sm" data-action="reset-2fa" data-id="${a.id}" style="margin-left:4px">Reset 2FA</button>`
        : ''
    }
        ${
      !isSelf
        ? `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.id}" style="margin-left:4px">Delete</button>`
        : ''
    }
      </td>
    </tr>`;
  }

  _renderAdminForm(admin) {
    const isEdit = !!admin;
    return `
      <div class="form-panel">
        <div style="font-size:0.85rem;font-weight:600;color:var(--color-text);margin-bottom:0.75rem">${
      isEdit ? `Edit ${_esc(admin.username)}` : 'New Admin'
    }</div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input class="input" id="f-username" value="${_esc(admin?.username ?? '')}" ${
      isEdit ? 'disabled' : ''
    } placeholder="username" />
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="input" id="f-email" value="${
      _esc(admin?.email ?? '')
    }" placeholder="admin@example.com" type="email" />
          </div>
          <div class="form-group">
            <label class="form-label">${
      isEdit ? 'New Password (leave blank to keep)' : 'Password'
    }</label>
            <input class="input" id="f-password" type="password" placeholder="${
      isEdit ? '(unchanged)' : 'min 8 chars'
    }" />
          </div>
          <div class="form-group">
            <label class="form-label">Role</label>
            <select class="input" id="f-role">
              ${
      ['superadmin', 'admin', 'readonly'].map((r) =>
        `<option value="${r}" ${(admin?.role ?? 'readonly') === r ? 'selected' : ''}>${r}</option>`
      ).join('')
    }
            </select>
          </div>
          ${
      isEdit
        ? `<div class="form-group">
            <label class="form-label">Status</label>
            <select class="input" id="f-active">
              <option value="true" ${admin.is_active ? 'selected' : ''}>Active</option>
              <option value="false" ${!admin.is_active ? 'selected' : ''}>Disabled</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Require two-factor</label>
            <select class="input" id="f-totp-required">
              <option value="false" ${!admin.totp_required ? 'selected' : ''}>Optional</option>
              <option value="true" ${admin.totp_required ? 'selected' : ''}>Required</option>
            </select>
          </div>`
        : ''
    }
        </div>
        <div class="form-actions">
          <button class="btn btn-primary btn-sm" id="btn-save">${
      isEdit ? 'Save Changes' : 'Create'
    }</button>
          <button class="btn btn-sm" id="btn-cancel">Cancel</button>
        </div>
        <div class="error-msg" id="form-error"></div>
      </div>
    `;
  }

  _bindAdmins(el) {
    el.querySelector('#btn-create')?.addEventListener('click', () => {
      this._showCreate = true;
      this._editId = null;
      this._confirmDeleteId = null;
      el.innerHTML = this._renderAdminsHTML(this._adminsData);
      this._bindAdmins(el);
    });

    el.querySelector('#btn-cancel')?.addEventListener('click', () => {
      this._showCreate = false;
      this._editId = null;
      el.innerHTML = this._renderAdminsHTML(this._adminsData);
      this._bindAdmins(el);
    });

    el.querySelector('#btn-save')?.addEventListener('click', () => this._saveAdmin(el));

    el.querySelector('tbody')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = parseInt(btn.dataset.id);
      const action = btn.dataset.action;

      if (action === 'edit') {
        this._editId = id;
        this._showCreate = false;
        this._confirmDeleteId = null;
        el.innerHTML = this._renderAdminsHTML(this._adminsData);
        this._bindAdmins(el);
      } else if (action === 'delete') {
        this._confirmDeleteId = id;
        el.innerHTML = this._renderAdminsHTML(this._adminsData);
        this._bindAdmins(el);
      } else if (action === 'confirm-delete') {
        await api.delete(`/auth/admins/${id}`).catch((e2) => {
          toast(e2.message, 'error');
          throw e2;
        });
        this._confirmDeleteId = null;
        this._editId = null;
        await this._tab_admins(el);
      } else if (action === 'cancel-delete') {
        this._confirmDeleteId = null;
        el.innerHTML = this._renderAdminsHTML(this._adminsData);
        this._bindAdmins(el);
      } else if (action === 'reset-2fa') {
        try {
          await api.post(`/auth/admins/${id}/2fa/reset`, {});
          toast('Two-factor reset — the admin can enrol again.', 'success');
          await this._tab_admins(el);
        } catch (e2) {
          toast(e2.message, 'error');
        }
      }
    });
  }

  async _saveAdmin(el) {
    clearFieldErrors(el);
    const errEl = el.querySelector('#form-error');
    errEl.textContent = '';
    const isEdit = this._editId !== null;

    const usernameInput = el.querySelector('#f-username');
    const passwordInput = el.querySelector('#f-password');
    const username = usernameInput?.value.trim();
    const email = el.querySelector('#f-email')?.value.trim() || null;
    const password = passwordInput?.value;
    const role = el.querySelector('#f-role')?.value;
    const isActive = el.querySelector('#f-active')?.value;

    // Client-side required checks land inline under the offending field.
    if (!isEdit) {
      let ok = true;
      if (!username) {
        setFieldError(usernameInput, 'Username is required');
        ok = false;
      }
      if (!password || password.length < 8) {
        setFieldError(passwordInput, 'Password must be at least 8 characters');
        ok = false;
      }
      if (!ok) return;
    } else if (password && password.length < 8) {
      setFieldError(passwordInput, 'Password must be at least 8 characters');
      return;
    }

    try {
      if (isEdit) {
        const body = { email, role };
        if (password) body.password = password;
        if (isActive !== undefined) body.is_active = isActive === 'true';
        const totpReq = el.querySelector('#f-totp-required')?.value;
        if (totpReq !== undefined) body.totp_required = totpReq === 'true';
        await api.put(`/auth/admins/${this._editId}`, body);
      } else {
        await api.post('/auth/admins', { username, email, password, role });
      }
      this._editId = null;
      this._showCreate = false;
      await this._tab_admins(el);
    } catch (e) {
      // Field-level 422s (username / password / role) map straight to their input.
      if (applyServerErrors(el, e, (f) => el.querySelector(`#f-${f}`))) return;
      // The duplicate-username 409 is a string detail — map it to the username field.
      const msg = e.message ?? 'Save failed';
      if (
        /username/i.test(msg) && /taken|exist/i.test(msg) && usernameInput &&
        !usernameInput.disabled
      ) {
        setFieldError(usernameInput, msg);
      } else {
        errEl.textContent = msg;
      }
    }
  }

  // ── Security (own two-factor) ───────────────────────────────────────────────

  async _tab_security(el) {
    this._secStatus = await api.get('/auth/2fa/status');
    this._secSetup = null;
    this._secCodes = null;
    this._renderSecurity(el);
  }

  _renderSecurity(el) {
    const st = this._secStatus || { enabled: false, required: false };

    // Freshly issued recovery codes take over the panel until acknowledged.
    if (this._secCodes) {
      el.innerHTML = this._securityCodesHTML(this._secCodes);
      el.querySelector('#sec-copy')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(this._secCodes.join('\n'));
        toast('Recovery codes copied.', 'success');
      });
      el.querySelector('#sec-done')?.addEventListener('click', () => this._tab_security(el));
      return;
    }

    // Mid-enrolment: QR + manual key + confirm code.
    if (this._secSetup) {
      el.innerHTML = this._securitySetupHTML(this._secSetup);
      el.querySelector('#sec-cancel')?.addEventListener('click', () => {
        this._secSetup = null;
        this._renderSecurity(el);
      });
      el.querySelector('#sec-enable-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        this._enableTotp(el);
      });
      return;
    }

    el.innerHTML = this._securityStatusHTML(st);
    el.querySelector('#sec-start')?.addEventListener('click', () => this._startTotpSetup(el));
    el.querySelector('#sec-regen')?.addEventListener('click', () => this._regenCodes(el));
    el.querySelector('#sec-disable-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this._disableTotp(el);
    });
  }

  _securityStatusHTML(st) {
    if (st.enabled) {
      return `
        <div class="card">
          <div class="card-header"><span class="card-title">Two-factor authentication</span>
            <span><span class="badge badge-success">On</span>${
        st.required ? ' <span class="badge badge-warning">Required</span>' : ''
      }</span>
          </div>
          <div class="backup-body">
            <div class="backup-desc">Your sign-in is protected by an authenticator app. You'll be asked for a 6-digit code after your password.</div>
            <div><button class="btn btn-sm" id="sec-regen">Regenerate recovery codes</button></div>
            ${
        st.required
          ? `<div class="info-box">Two-factor is required for your account, so it can't be turned off. A superadmin can reset it if you lose your device.</div>`
          : `<form id="sec-disable-form" style="border-top:1px solid var(--color-border);padding-top:0.85rem;margin-top:0.25rem">
                <div class="form-label" style="margin-bottom:0.35rem">Turn off two-factor</div>
                <div style="display:flex;gap:0.5rem;align-items:flex-start">
                  <input class="input" id="sec-pw" type="password" placeholder="Confirm your password" style="max-width:260px" />
                  <button class="btn btn-danger btn-sm" type="submit">Turn off</button>
                </div>
                <div class="error-msg" id="sec-error"></div>
              </form>`
      }
          </div>
        </div>`;
    }
    return `
      <div class="card">
        <div class="card-header"><span class="card-title">Two-factor authentication</span>
          <span><span class="badge badge-info">Off</span>${
      st.required ? ' <span class="badge badge-warning">Required</span>' : ''
    }</span>
        </div>
        <div class="backup-body">
          <div class="backup-desc">Add a second factor to your admin sign-in: a 6-digit code from an authenticator app (Google Authenticator, Aegis, 1Password, …). It takes about a minute to set up.</div>
          ${
      st.required
        ? `<div class="warn-box">Your account requires two-factor authentication. Please set it up now.</div>`
        : ''
    }
          <div><button class="btn btn-primary" id="sec-start">Set up two-factor</button></div>
        </div>
      </div>`;
  }

  _securitySetupHTML(s) {
    let qr = '';
    try {
      qr = qrSvg(s.otpauth_uri, { moduleColor: '#0A0A0A', background: '#FFFFFF', border: 2 });
    } catch {
      qr = '';
    }
    const key = _esc(s.secret.replace(/(.{4})(?=.)/g, '$1 '));
    return `
      <div class="card">
        <div class="card-header"><span class="card-title">Set up two-factor</span></div>
        <div class="backup-body">
          <div class="backup-desc">1. Scan this QR code with your authenticator app${
      qr ? '' : ' (or add it manually with the key below)'
    }.</div>
          ${
      qr
        ? `<div style="background:#fff;padding:12px;border-radius:var(--radius);width:200px;height:200px;box-sizing:content-box">${qr}</div>`
        : ''
    }
          <div>
            <div class="form-label" style="margin-bottom:0.25rem">Or enter this setup key manually</div>
            <div class="mono" style="user-select:all;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);padding:0.5rem 0.7rem;letter-spacing:0.08em;word-break:break-all">${key}</div>
          </div>
          <form id="sec-enable-form" style="border-top:1px solid var(--color-border);padding-top:0.85rem;margin-top:0.25rem">
            <div class="form-label" style="margin-bottom:0.35rem">2. Enter the 6-digit code to confirm</div>
            <div style="display:flex;gap:0.5rem;align-items:flex-start">
              <input class="input mono" id="sec-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" style="max-width:160px;letter-spacing:0.2em" />
              <button class="btn btn-primary btn-sm" type="submit">Enable</button>
              <button class="btn btn-sm" type="button" id="sec-cancel">Cancel</button>
            </div>
            <div class="error-msg" id="sec-error"></div>
          </form>
        </div>
      </div>`;
  }

  _securityCodesHTML(codes) {
    return `
      <div class="card">
        <div class="card-header"><span class="card-title">Save your recovery codes</span></div>
        <div class="backup-body">
          <div class="warn-box">Store these somewhere safe. Each code works <strong>once</strong> if you lose your authenticator. They won't be shown again.</div>
          <div class="mono" style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem 1rem;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);padding:0.75rem 1rem;user-select:all">
            ${codes.map((c) => `<span>${_esc(c)}</span>`).join('')}
          </div>
          <div class="form-actions">
            <button class="btn btn-sm" id="sec-copy">Copy codes</button>
            <button class="btn btn-primary btn-sm" id="sec-done">I've saved them</button>
          </div>
        </div>
      </div>`;
  }

  async _startTotpSetup(el) {
    try {
      this._secSetup = await api.post('/auth/2fa/setup', {});
      this._renderSecurity(el);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async _enableTotp(el) {
    const code = el.querySelector('#sec-code')?.value.trim();
    const errEl = el.querySelector('#sec-error');
    try {
      const res = await api.post('/auth/2fa/enable', { code });
      this._secSetup = null;
      this._secCodes = res.recovery_codes;
      this._renderSecurity(el);
    } catch (e) {
      if (errEl) errEl.textContent = e.message ?? 'Could not enable two-factor';
    }
  }

  async _regenCodes(el) {
    try {
      const res = await api.post('/auth/2fa/recovery-codes', {});
      this._secCodes = res.recovery_codes;
      this._renderSecurity(el);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async _disableTotp(el) {
    const password = el.querySelector('#sec-pw')?.value;
    const errEl = el.querySelector('#sec-error');
    try {
      await api.post('/auth/2fa/disable', { password });
      toast('Two-factor turned off.', 'success');
      await this._tab_security(el);
    } catch (e) {
      if (errEl) errEl.textContent = e.message ?? 'Could not turn off two-factor';
    }
  }

  // ── Audit Log ─────────────────────────────────────────────────────────────

  async _tab_audit(el) {
    this._auditLogs = await api.get('/auth/audit-log?limit=200');
    const admins = [...new Set(this._auditLogs.map((l) => l.admin_username))].sort();
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Audit Log</span>
          <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
            <input id="audit-filter" class="input" type="search" placeholder="Filter by admin, action, target, path…"
                   style="width:220px" />
            <select id="audit-admin" class="input" style="width:140px">
              <option value="">All admins</option>
              ${admins.map((a) => `<option value="${_esc(a)}">${_esc(a)}</option>`).join('')}
            </select>
            <span class="muted" style="font-size:0.75rem">${this._auditLogs.length} entries</span>
          </div>
        </div>
        <table class="audit-table">
          <colgroup>
            <col style="width:138px">
            <col style="width:108px">
            <col style="width:168px">
            <col>
            <col style="width:108px">
          </colgroup>
          <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Detail</th><th>IP</th></tr></thead>
          <tbody id="audit-body">${this._auditRows(this._auditLogs)}</tbody>
        </table>
      </div>
    `;

    // Row click → expand/collapse detail panel; Close button → collapse
    el.querySelector('#audit-body').addEventListener('click', (e) => {
      // Close button inside an expand panel
      if (e.target.closest('.detail-close-btn')) {
        const detailRow = e.target.closest('.audit-detail-row');
        if (detailRow) {
          detailRow.hidden = true;
          const idx = detailRow.id.replace('adr-', '');
          el.querySelector(`tr.audit-row[data-idx="${idx}"]`)?.classList.remove('expanded');
        }
        return;
      }
      const row = e.target.closest('tr.audit-row');
      if (!row) return;
      const idx = row.dataset.idx;
      const detailRow = el.querySelector(`#adr-${idx}`);
      if (!detailRow) return;
      const wasHidden = detailRow.hidden;
      el.querySelectorAll('.audit-detail-row').forEach((r) => {
        r.hidden = true;
      });
      el.querySelectorAll('.audit-row.expanded').forEach((r) => r.classList.remove('expanded'));
      detailRow.hidden = !wasHidden;
      if (wasHidden) row.classList.add('expanded');
    });

    const apply = () => {
      const q = el.querySelector('#audit-filter').value.trim().toLowerCase();
      const who = el.querySelector('#audit-admin').value;
      const rows = this._auditLogs.filter((l) => {
        if (who && l.admin_username !== who) return false;
        if (!q) return true;
        const hay = `${l.admin_username} ${l.action} ${l.target ?? ''} ${
          JSON.stringify(l.detail ?? {})
        }`.toLowerCase();
        return hay.includes(q);
      });
      el.querySelector('#audit-body').innerHTML = this._auditRows(rows);
    };
    el.querySelector('#audit-filter').addEventListener('input', apply);
    el.querySelector('#audit-admin').addEventListener('change', apply);
  }

  _auditRows(logs) {
    if (!logs.length) {
      return emptyRowHTML(5, {
        title: 'No audit entries yet',
        message: 'Administrative actions will be recorded here.',
      });
    }
    return logs.map((l, i) => `
      <tr class="audit-row" data-idx="${i}" title="Click to view full detail">
        <td style="font-size:0.78rem;white-space:nowrap" class="muted">${
      _fmtTime(l.created_at)
    }</td>
        <td>${_esc(l.admin_username)}</td>
        <td><span title="${_esc(l.action)}">${_esc(_humanAction(l.action))}</span></td>
        <td class="td-detail"><div class="td-detail-inner">${_auditDetailSummary(l)}</div></td>
        <td class="muted mono" style="font-size:0.78rem">${_esc(l.ip_address ?? '—')}</td>
      </tr>
      <tr class="audit-detail-row" id="adr-${i}" hidden>
        <td colspan="5">${this._auditExpandHTML(l)}</td>
      </tr>
    `).join('');
  }

  _auditExpandHTML(l) {
    const d = l.detail || {};
    const { method, path, user_agent, ...rest } = d;
    const hasRest = Object.keys(rest).length > 0;
    return `
      <div class="detail-expand">
        <div class="detail-meta-row">
          <div class="detail-meta-item">
            <span class="dml">Time</span>
            <span class="dmv">${_esc(_fmtTime(l.created_at))}</span>
          </div>
          <div class="detail-meta-item">
            <span class="dml">Admin</span>
            <span class="dmv">${_esc(l.admin_username)}</span>
          </div>
          <div class="detail-meta-item">
            <span class="dml">Action</span>
            <span class="dmv">${_esc(_humanAction(l.action))}</span>
          </div>
          ${
      l.ip_address
        ? `<div class="detail-meta-item">
            <span class="dml">IP</span>
            <span class="dmv mono">${_esc(l.ip_address)}</span>
          </div>`
        : ''
    }
          ${
      l.target
        ? `<div class="detail-meta-item">
            <span class="dml">Target</span>
            <span class="dmv">${_esc(l.target)}</span>
          </div>`
        : ''
    }
        </div>
        ${
      (method || path)
        ? `<div class="detail-http">${_esc(method || '')} ${_esc(path || '')}</div>`
        : ''
    }
        ${user_agent ? `<div class="detail-ua">${_esc(user_agent)}</div>` : ''}
        ${
      hasRest
        ? `
          <div class="detail-json-label">Detail</div>
          <pre class="detail-json">${_esc(JSON.stringify(rest, null, 2))}</pre>
        `
        : '<span class="muted" style="font-size:0.78rem">No additional detail recorded.</span>'
    }
        <div class="detail-close-row">
          <button class="btn btn-sm detail-close-btn">Close</button>
        </div>
      </div>
    `;
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  async _tab_settings(el) {
    const cfg = await api.get('/system/settings');
    const mods = cfg.all_modules;
    const enabled = new Set(cfg.enabled_modules);

    el.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <div class="section-label">General</div>
        <div class="settings-grid">
          ${this._settingRow('MONSTEROPS_DATABASE_URL', cfg.database_url)}
          ${this._settingRow('MONSTEROPS_LOG_LEVEL', cfg.log_level)}
          ${
      this._settingRow('MONSTEROPS_ACCESS_TOKEN_EXPIRE_MINUTES', cfg.access_token_expire_minutes)
    }
          ${this._settingRow('MONSTEROPS_RADIUS_LOG_FILES', cfg.radius_log_files)}
        </div>
        <div class="section-label">Security</div>
        <div class="settings-grid">
          <div class="setting-row">
            <span class="setting-key">MONSTEROPS_SECRET_KEY</span>
            <span class="setting-val ${cfg.secret_key_ok ? 'ok' : 'bad'}">
              ${
      cfg.secret_key_ok
        ? '✓ Custom key configured'
        : '⚠ Using default key — change before production!'
    }
            </span>
          </div>
          ${this._settingRow('MONSTEROPS_DEBUG', String(cfg.debug))}
          ${
      this._settingRow(
        'MONSTEROPS_ALLOWED_ORIGINS',
        cfg.allowed_origins || '(none — CORS disabled)',
      )
    }
        </div>
        <div class="section-label">Modules</div>
        <div class="module-grid" id="module-grid">
          ${
      mods.map((m) => `
            <label class="module-chip ${enabled.has(m) ? 'enabled' : ''}" style="cursor:pointer">
              <input type="checkbox" data-mod="${m}" ${
        enabled.has(m) ? 'checked' : ''
      } style="display:none">
              ${_esc(m)}
            </label>
          `).join('')
    }
        </div>
        <div style="padding:0.75rem 1rem;border-top:1px solid var(--color-border);display:flex;gap:0.5rem;align-items:center">
          <button class="btn btn-primary btn-sm" id="btn-gen-env">⬇ Download .env</button>
          <span class="muted" style="font-size:0.78rem">Changes require a server restart to take effect.</span>
        </div>
      </div>
    `;

    // Module chip toggle styling
    el.querySelectorAll('#module-grid input[data-mod]').forEach((cb) => {
      cb.addEventListener('change', () => {
        cb.closest('label').classList.toggle('enabled', cb.checked);
      });
    });

    el.querySelector('#btn-gen-env').addEventListener('click', () => {
      const selected = [...el.querySelectorAll('#module-grid input[data-mod]:checked')].map((c) =>
        c.dataset.mod
      );
      const lines = [
        `MONSTEROPS_DATABASE_URL="${cfg.database_url}"`,
        `MONSTEROPS_SECRET_KEY="change-me-before-production"`,
        `MONSTEROPS_DEBUG=${cfg.debug}`,
        `MONSTEROPS_LOG_LEVEL=${cfg.log_level}`,
        `MONSTEROPS_ACCESS_TOKEN_EXPIRE_MINUTES=${cfg.access_token_expire_minutes}`,
        cfg.allowed_origins ? `MONSTEROPS_ALLOWED_ORIGINS="${cfg.allowed_origins}"` : '',
        `MONSTEROPS_RADIUS_LOG_FILES="${cfg.radius_log_files}"`,
        selected.length < mods.length ? `MONSTEROPS_ENABLED_MODULES="${selected.join(',')}"` : '',
      ].filter(Boolean).join('\n');
      const blob = new Blob([lines + '\n'], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '.env';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  _settingRow(key, val) {
    return `<div class="setting-row"><span class="setting-key">${
      _esc(key)
    }</span><span class="setting-val">${_esc(String(val))}</span></div>`;
  }

  // ── Backup ────────────────────────────────────────────────────────────────

  async _tab_backup(el) {
    this._snapConfirmDelete = null;
    await this._renderBackup(el);
  }

  async _renderBackup(el) {
    let snaps = [];
    try {
      snaps = await api.get('/system/backup/list');
    } catch { /* fetch failed → render empty list */ }

    el.innerHTML = `
      <div class="card" style="margin-bottom:1rem">
        <div class="card-header">
          <span class="card-title">Snapshots</span>
          <button class="btn btn-primary btn-sm" id="btn-create-snap">+ Create Snapshot</button>
        </div>
        <div id="snap-status" style="display:none;padding:0.5rem 1rem;font-size:0.8rem"></div>
        ${
      snaps.length
        ? `
        <table>
          <thead><tr><th>Snapshot</th><th>Size</th><th>Files</th><th>Actions</th></tr></thead>
          <tbody>
            ${snaps.map((s) => this._renderSnapRow(s)).join('')}
          </tbody>
        </table>`
        : emptyStateHTML({
          title: 'No snapshots yet',
          message: 'Click “Create Snapshot” to capture the first backup.',
        })
    }
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Quick DB Download</span></div>
        <div class="backup-body">
          <p class="backup-desc">Stream a <code>pg_dump</code> directly to your browser without saving to disk.</p>
          <button class="btn btn-sm" id="btn-backup" style="align-self:flex-start">⬇ Download pg_dump</button>
          <div id="backup-status" style="font-size:0.8rem;color:var(--color-muted)"></div>
        </div>
      </div>
    `;

    el.querySelector('#btn-create-snap').addEventListener('click', () => this._createSnapshot(el));

    el.querySelector('tbody')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-snap-action]');
      if (!btn) return;
      const snap = btn.dataset.snap;
      const action = btn.dataset.snapAction;
      if (action === 'download-db') {
        this._downloadFile(`/api/system/backup/${snap}/download-db`, `monsterops-${snap}.sql`);
      } else if (action === 'download-config') {
        this._downloadFile(
          `/api/system/backup/${snap}/download-config`,
          `freeradius-config-${snap}.tar.gz`,
        );
      } else if (action === 'delete') {
        this._snapConfirmDelete = snap;
        el.querySelector('tbody').innerHTML = snaps.map((s) => this._renderSnapRow(s)).join('');
      } else if (action === 'confirm-delete') {
        try {
          await api.delete(`/system/backup/${snap}`);
          this._snapConfirmDelete = null;
          await this._renderBackup(el);
        } catch (e2) {
          toast(e2.message, 'error');
        }
      } else if (action === 'cancel-delete') {
        this._snapConfirmDelete = null;
        el.querySelector('tbody').innerHTML = snaps.map((s) => this._renderSnapRow(s)).join('');
      }
    });

    el.querySelector('#btn-backup').addEventListener('click', async () => {
      const btn = el.querySelector('#btn-backup');
      const status = el.querySelector('#backup-status');
      btn.disabled = true;
      btn.textContent = 'Preparing…';
      status.textContent = '';
      try {
        const res = await fetch('/api/system/backup/db', {
          credentials: 'same-origin',
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(j.detail ?? res.statusText);
        }
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const fname = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'backup.sql';
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        a.click();
        URL.revokeObjectURL(a.href);
        status.textContent = `Downloaded ${fname} (${(blob.size / 1024).toFixed(1)} KB)`;
      } catch (e) {
        status.style.color = 'var(--color-danger)';
        status.textContent = `Error: ${e.message}`;
      } finally {
        btn.disabled = false;
        btn.textContent = '⬇ Download pg_dump';
      }
    });
  }

  _renderSnapRow(s) {
    const isConfirm = this._snapConfirmDelete === s.snapshot;
    const hasDb = s.files?.includes('db.sql');
    const hasCfg = s.files?.includes('freeradius-config.tar.gz');
    const kb = s.size_bytes > 0 ? (s.size_bytes / 1024).toFixed(1) + ' KB' : '—';
    if (isConfirm) {
      return `<tr class="confirm-row">
        <td colspan="3"><span style="font-size:0.83rem">Delete snapshot <strong>${
        _esc(s.snapshot)
      }</strong>? This cannot be undone.</span></td>
        <td>
          <button class="btn btn-danger btn-sm" data-snap-action="confirm-delete" data-snap="${
        _esc(s.snapshot)
      }">Delete</button>
          <button class="btn btn-sm" data-snap-action="cancel-delete" data-snap="${
        _esc(s.snapshot)
      }" style="margin-left:4px">Cancel</button>
        </td>
      </tr>`;
    }
    return `<tr>
      <td class="mono">${_esc(s.snapshot)}</td>
      <td class="muted">${kb}</td>
      <td class="muted" style="font-size:0.78rem">${
      (s.files ?? []).map((f) => _esc(f)).join(', ') || '—'
    }</td>
      <td style="display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center">
        ${
      hasDb
        ? `<button class="btn btn-sm" data-snap-action="download-db" data-snap="${
          _esc(s.snapshot)
        }">⬇ DB</button>`
        : ''
    }
        ${
      hasCfg
        ? `<button class="btn btn-sm" data-snap-action="download-config" data-snap="${
          _esc(s.snapshot)
        }">⬇ Config</button>`
        : ''
    }
        <button class="btn btn-sm btn-danger" data-snap-action="delete" data-snap="${
      _esc(s.snapshot)
    }">Delete</button>
      </td>
    </tr>`;
  }

  async _createSnapshot(el) {
    const btn = el.querySelector('#btn-create-snap');
    const statusEl = el.querySelector('#snap-status');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--color-muted)';
    statusEl.textContent = 'Running pg_dump and archiving FreeRADIUS config…';
    try {
      const result = await api.post('/system/backup/create');
      statusEl.style.color = 'var(--color-success)';
      statusEl.textContent = `Snapshot ${result.snapshot} created (${
        (result.size_bytes / 1024).toFixed(1)
      } KB)`;
      await this._renderBackup(el);
    } catch (e) {
      statusEl.style.color = 'var(--color-danger)';
      statusEl.textContent = `Error: ${e.message}`;
      btn.disabled = false;
      btn.textContent = '+ Create Snapshot';
    }
  }

  async _downloadFile(url, filename) {
    try {
      const res = await fetch(url, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(j.detail ?? res.statusText);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(`Download failed: ${e.message}`, 'error');
    }
  }

  // ── Plugins ───────────────────────────────────────────────────────────────

  async _tab_plugins(el) {
    const plugins = await api.get('/system/plugins');
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Installed Plugins</span>
          <a href="https://pypi.org/search/?q=monsterops" target="_blank" rel="noopener" class="btn btn-sm">Search PyPI</a>
        </div>
        <div class="plugin-list">
          ${
      plugins.length
        ? plugins.map((p) => `
            <div class="plugin-row">
              <div>
                <div style="font-weight:600;font-size:0.83rem">${_esc(p.name)}</div>
                <div class="muted mono" style="font-size:0.75rem">${_esc(p.value)}</div>
              </div>
              <div style="display:flex;align-items:center;gap:0.75rem">
                ${
          p.version
            ? `<span class="muted" style="font-size:0.78rem">v${_esc(p.version)}</span>`
            : ''
        }
                ${
          p.home
            ? `<a href="${
              _esc(p.home)
            }" target="_blank" rel="noopener" class="btn btn-sm">↗ Docs</a>`
            : ''
        }
              </div>
            </div>
          `).join('')
        : emptyStateHTML({
          title: 'No plugins installed',
          message:
            'Use “Search PyPI” above to browse MonsterOps plugins, then pip-install to extend the app.',
        })
    }
        </div>
      </div>
    `;
  }
}

customElements.define('system-view', SystemView);
router.register('/system', () => document.createElement('system-view'));
