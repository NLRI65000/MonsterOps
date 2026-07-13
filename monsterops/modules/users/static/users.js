import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { setFieldError, clearFieldErrors, applyServerErrors } from '/js/utils/form.js';
import { emptyStateHTML, skeletonRows, skeletonBlock } from '/js/utils/empty.js';
import { densityBarHTML, wireDensityBar, applyDensity, makeSortable } from '/js/utils/table.js';
import { geoLabelHTML } from '/js/utils/geo.js';

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / 1024 ** i).toFixed(1)} ${u[i]}`;
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

function fmtDuration(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function badge(text, type) {
  return `<span class="badge badge-${type}">${text}</span>`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PASSWORD_TYPES = [
  'Cleartext-Password', 'MD5-Password', 'NT-Password', 'SHA-Password', 'Crypt-Password',
];

// ── Group picker (tag input + autocomplete + quick-create) ────────────────────

class GroupPicker {
  constructor(container, initialGroups = []) {
    this._el = container;
    this._selected = new Set(initialGroups);
    this._all = [];
  }

  async init() {
    try {
      const data = await api.get('/groups?page=1&size=100');
      this._all = data.items.map(g => g.name);
    } catch { /* non-fatal — picker still works for manual entry */ }
    this._render();
  }

  get selected() { return [...this._selected]; }

  _render() {
    this._el.innerHTML = `
      <div class="gp-wrap" id="gp-wrap">
        ${[...this._selected].map(g =>
          `<span class="gp-tag" data-g="${g}">${g}<span class="gp-remove" data-g="${g}">×</span></span>`
        ).join('')}
        <input class="gp-input" id="gp-input" type="text"
          placeholder="${this._selected.size ? 'Add more…' : 'Search or type a group name…'}"
          autocomplete="off" />
      </div>
      <div class="gp-dropdown" id="gp-dropdown"></div>
      <div class="gp-quick" id="gp-quick" style="display:none;">
        <div style="display:flex;gap:0.4rem;margin-top:0.5rem;">
          <input class="input" id="gp-new-name" type="text" placeholder="New group name" style="flex:1;" />
          <button class="btn btn-primary gp-create-btn" type="button" id="gp-create-btn">Create</button>
          <button class="btn btn-ghost" type="button" id="gp-quick-cancel">✕</button>
        </div>
      </div>
      <button class="btn btn-ghost gp-new-toggle" type="button" id="gp-new-toggle">+ Create new group</button>
    `;

    const wrap     = this._el.querySelector('#gp-wrap');
    const input    = this._el.querySelector('#gp-input');
    const dropdown = this._el.querySelector('#gp-dropdown');
    const quick    = this._el.querySelector('#gp-quick');

    // Tag remove
    wrap.querySelectorAll('.gp-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selected.delete(btn.dataset.g);
        this._render();
      });
    });

    // Click wrap → focus input
    wrap.addEventListener('click', () => input.focus());

    // Search / filter dropdown
    input.addEventListener('input', () => this._updateDropdown(input.value.trim().toLowerCase()));
    input.addEventListener('focus', () => this._updateDropdown(input.value.trim().toLowerCase()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { dropdown.style.display = 'none'; }
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = input.value.trim().replace(/,$/, '');
        if (val) { this._add(val); input.value = ''; dropdown.style.display = 'none'; }
      }
    });
    // Close dropdown when focus leaves the picker
    this._el.addEventListener('focusout', (e) => {
      if (!this._el.contains(e.relatedTarget)) {
        setTimeout(() => { dropdown.style.display = 'none'; }, 150);
      }
    });

    // Quick create toggle
    this._el.querySelector('#gp-new-toggle').addEventListener('click', () => {
      quick.style.display = quick.style.display === 'none' ? 'block' : 'none';
      if (quick.style.display !== 'none') this._el.querySelector('#gp-new-name').focus();
    });
    this._el.querySelector('#gp-quick-cancel').addEventListener('click', () => {
      quick.style.display = 'none';
    });

    const doCreate = async () => {
      const name = this._el.querySelector('#gp-new-name').value.trim();
      if (!name) { toast('Group name required', 'warning'); return; }
      try {
        await api.post('/groups', { name });
        this._all.push(name);
        this._add(name);
        this._el.querySelector('#gp-new-name').value = '';
        quick.style.display = 'none';
        toast(`Group "${name}" created`, 'success');
      } catch (err) { toast(err.message || 'Failed to create group', 'error'); }
    };
    this._el.querySelector('#gp-create-btn').addEventListener('click', doCreate);
    this._el.querySelector('#gp-new-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doCreate(); }
    });
  }

  _add(name) {
    this._selected.add(name);
    this._render();
    // Re-focus input after render
    this._el.querySelector('#gp-input')?.focus();
  }

  _updateDropdown(q) {
    const dropdown = this._el.querySelector('#gp-dropdown');
    if (!dropdown) return;
    const matches = this._all.filter(g => g.toLowerCase().includes(q) && !this._selected.has(g));
    if (!matches.length) { dropdown.style.display = 'none'; return; }

    dropdown.style.display = 'block';
    dropdown.innerHTML = matches.slice(0, 8).map(g =>
      `<div class="gp-item" data-g="${g}">${g}</div>`
    ).join('');
    dropdown.querySelectorAll('.gp-item').forEach(item => {
      // mousedown so it fires before blur
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._add(item.dataset.g);
        if (this._el.querySelector('#gp-input')) this._el.querySelector('#gp-input').value = '';
        dropdown.style.display = 'none';
      });
    });
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
@import '/css/theme.css';

:host { display: block; height: 100%; }

.layout {
  display: flex;
  height: 100%;
  gap: 0;
  overflow: hidden;
}

.list-panel {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  transition: flex 0.25s ease;
  overflow: hidden;
}
.list-panel.narrow { flex: 0 0 42%; }

.toolbar {
  display: flex;
  gap: 0.75rem;
  padding: 0 0 1rem 0;
  align-items: center;
  flex-shrink: 0;
}
.toolbar input[type=search] { flex: 1; }

.table-wrap { flex: 1; overflow-y: auto; }

table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th {
  position: sticky; top: 0;
  text-align: left; padding: 0.5rem 0.75rem;
  font-size: 0.72rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--color-muted); border-bottom: 1px solid var(--color-border);
  background: var(--color-bg); z-index: 1;
}
td { padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr.clickable { cursor: pointer; }
tr.clickable:hover td { background: var(--color-surface); }
tr.selected td { background: color-mix(in srgb, var(--color-accent) 8%, transparent); }

.badge {
  display: inline-block; padding: 0.15rem 0.5rem;
  border-radius: 9999px; font-size: 0.68rem; font-weight: 600;
}
.badge-success { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); }
.badge-danger  { background: color-mix(in srgb, var(--color-danger) 15%, transparent);  color: var(--color-danger);  }
.badge-group   { background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent); margin-right: 2px; }

.groups-cell { display: flex; flex-wrap: wrap; gap: 3px; }

.pagination {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 0 0 0; font-size: 0.8rem; color: var(--color-muted); flex-shrink: 0;
}
.pagination-btns { display: flex; gap: 0.4rem; }

.empty-state { padding: 3rem; text-align: center; color: var(--color-muted); font-size: 0.9rem; }

/* Bulk toolbar */
.bulk-bar {
  display: none;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.65rem;
  background: var(--mr-action-tint);
  border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
  border-radius: var(--radius);
  margin-bottom: 0.5rem;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.bulk-bar.visible { display: flex; }
.bulk-count { font-size: 0.82rem; font-weight: 600; color: var(--color-accent); }
.bulk-sep { width: 1px; height: 16px; background: var(--color-border); flex-shrink: 0; }

/* Checkbox column */
.cb-col { width: 34px; padding: 0.4rem 0.5rem !important; }
input[type=checkbox] { accent-color: var(--color-accent); width: 14px; height: 14px; cursor: pointer; }

/* Drop zone for import */
.drop-zone {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 2rem 1.5rem;
  text-align: center;
  cursor: pointer;
  color: var(--color-muted);
  font-size: 0.875rem;
  line-height: 1.6;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.drop-zone.drag-over,
.drop-zone.has-file {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  color: var(--color-accent);
}
.import-preview-table { font-size: 0.78rem; width: 100%; border-collapse: collapse; margin-top: 0.75rem; }
.import-preview-table th { text-align: left; padding: 0.35rem 0.5rem; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted); border-bottom: 1px solid var(--color-border); }
.import-preview-table td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.import-preview-table tr:last-child td { border-bottom: none; }
.st-ok     { color: var(--color-success); font-weight: 600; }
.st-exists { color: var(--color-warning, #F5A623); font-weight: 600; }
.st-error  { color: var(--color-danger); font-weight: 600; }
.import-summary { display: flex; gap: 1.25rem; font-size: 0.82rem; padding: 0.75rem 0; border-top: 1px solid var(--color-border); margin-top: 0.5rem; }
.import-summary span { display: flex; align-items: center; gap: 0.3rem; }

/* Detail panel */
.detail-panel {
  flex: 0 0 0; overflow: hidden;
  border-left: 1px solid var(--color-border);
  transition: flex 0.25s ease;
  display: flex; flex-direction: column; background: var(--color-bg);
}
.detail-panel.open { flex: 0 0 58%; }

.detail-inner { display: flex; flex-direction: column; height: 100%; overflow: hidden; min-width: 420px; }

.detail-header {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0 1.25rem 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border); flex-shrink: 0;
}
.detail-username { font-size: 1.1rem; font-weight: 700; color: var(--color-text); flex: 1; }

.detail-tabs {
  display: flex; border-bottom: 1px solid var(--color-border);
  flex-shrink: 0; padding: 0 1.25rem; overflow-x: auto;
}
.tab-btn {
  padding: 0.65rem 1rem; border: none; background: transparent;
  color: var(--color-muted); cursor: pointer; font-size: 0.82rem;
  font-weight: 500; font-family: var(--font);
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  white-space: nowrap; transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover { color: var(--color-text); }
.tab-btn.active { color: var(--color-accent); border-bottom-color: var(--color-accent); }

.detail-body { flex: 1; overflow-y: auto; padding: 1.25rem; }

/* Timeline (Phase 20.2) */
.timeline { display: flex; flex-direction: column; gap: 0; padding-left: 12px; }
.tl-item { display: flex; gap: 12px; position: relative; padding-bottom: 1rem; }
.tl-item:last-child { padding-bottom: 0; }
.tl-item::before { content: ''; position: absolute; left: 7px; top: 18px; bottom: 0; width: 2px; background: var(--color-border); }
.tl-item:last-child::before { display: none; }
.tl-dot { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; margin-top: 2px;
  background: var(--color-border); border: 2px solid var(--color-surface); z-index: 1; }
.tl-auth.tl-accept .tl-dot { background: var(--color-success); }
.tl-auth.tl-reject .tl-dot { background: var(--color-danger); }
.tl-session .tl-dot { background: var(--color-accent); }
.tl-content { flex: 1; background: var(--color-surface-alt); border-radius: var(--radius); padding: 0.6rem 0.75rem; }
.tl-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }

/* Forms */
.form-row { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem; }
.form-row label { font-size: 0.75rem; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.form-row-inline { display: flex; gap: 0.5rem; align-items: flex-end; margin-bottom: 1rem; }
.form-row-inline .form-row { flex: 1; margin-bottom: 0; }

.section-header {
  font-size: 0.75rem; font-weight: 600; color: var(--color-muted);
  text-transform: uppercase; letter-spacing: 0.05em;
  margin: 1.5rem 0 0.75rem 0; padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--color-border);
}
.section-header:first-child { margin-top: 0; }

.danger-zone {
  margin-top: 2rem; padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--color-danger) 5%, transparent);
}
.danger-zone p { margin: 0 0 0.75rem 0; font-size: 0.82rem; color: var(--color-muted); }

/* Attr table */
.attr-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.attr-table th {
  text-align: left; padding: 0.4rem 0.5rem;
  font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--color-muted); border-bottom: 1px solid var(--color-border);
  background: transparent; position: static;
}
.attr-table td { padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.attr-table tr:last-child td { border-bottom: none; }
.attr-table tr:hover td { background: var(--color-surface); }
.attr-table input { width: 100%; }
.attr-table .op-col { width: 60px; }
.attr-table .actions-col { width: 70px; text-align: right; }

.icon-btn {
  background: none; border: none; cursor: pointer;
  padding: 0.2rem 0.3rem; border-radius: 4px;
  font-size: 0.85rem; color: var(--color-muted);
  transition: color 0.15s, background 0.15s;
}
.icon-btn:hover { color: var(--color-text); background: var(--color-border); }
.icon-btn.danger:hover { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 12%, transparent); }

.add-attr-row { display: flex; gap: 0.4rem; margin-top: 0.75rem; }
.add-attr-row input, .add-attr-row select { flex: 1; }
.add-attr-row .op-input { flex: 0 0 65px; }

/* Modal */
.modal-overlay {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,0.55); z-index: 100;
  align-items: center; justify-content: center;
}
.modal-overlay.open { display: flex; }
.modal {
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius); padding: 1.5rem;
  width: 480px; max-width: 95vw; max-height: 85vh; overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,0.4);
}
.modal-title { font-size: 1rem; font-weight: 700; margin-bottom: 1.25rem; }
.modal-footer {
  display: flex; gap: 0.5rem; justify-content: flex-end;
  margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--color-border);
}
select { font-family: var(--font); }

/* Group Picker */
.gp-wrap {
  border: 1px solid var(--color-border); border-radius: var(--radius);
  background: var(--color-surface); min-height: 38px; padding: 3px 6px;
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center; cursor: text;
}
.gp-wrap:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 15%, transparent);
}
.gp-tag {
  display: inline-flex; align-items: center; gap: 3px;
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  color: var(--color-accent); border-radius: 4px;
  padding: 2px 7px; font-size: 0.75rem; font-weight: 600;
}
.gp-remove { cursor: pointer; font-size: 0.95rem; opacity: 0.7; line-height: 1; padding: 0 1px; }
.gp-remove:hover { opacity: 1; }
.gp-input {
  flex: 1; min-width: 100px; border: none; background: transparent;
  color: var(--color-text); font-family: var(--font); font-size: 0.875rem;
  padding: 2px 2px; outline: none;
}
.gp-dropdown {
  position: relative; background: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.25); max-height: 160px; overflow-y: auto;
  margin-top: 2px; display: none;
}
.gp-item { padding: 0.5rem 0.75rem; cursor: pointer; font-size: 0.85rem; color: var(--color-text); }
.gp-item:hover { background: var(--color-bg); color: var(--color-accent); }
.gp-new-toggle {
  margin-top: 0.4rem; font-size: 0.75rem; padding: 0.2rem 0.5rem;
  color: var(--color-muted);
}
.gp-new-toggle:hover { color: var(--color-accent); }
`;


// ── Main Component ─────────────────────────────────────────────────────────────

class UsersView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._users = [];
    this._total = 0;
    this._page = 1;
    this._size = 20;
    this._search = '';
    this._order = 'asc';   // server-side username sort direction
    this._selected = null;
    this._detail = null;
    this._tab = 'overview';
    this._tabData = {};
    this._groupPicker = null;
    this._checkedUsers = new Set();
    this._importFile = null;
  }

  connectedCallback() {
    this._renderShell();
    this._loadUsers();
  }

  // ── Shell ──────────────────────────────────────────────────────────────────

  _renderShell() {
    const sr = this.shadowRoot;
    sr.innerHTML = `
      <style>${CSS}</style>
      <div class="layout">
        <div class="list-panel" id="list-panel">
          <div class="bulk-bar" id="bulk-bar">
            <span class="bulk-count" id="bulk-count">0 selected</span>
            <div class="bulk-sep"></div>
            <button class="btn btn-ghost" id="btn-bulk-enable" style="font-size:0.78rem;padding:0.25rem 0.6rem;">Enable</button>
            <button class="btn btn-ghost" id="btn-bulk-disable" style="font-size:0.78rem;padding:0.25rem 0.6rem;">Disable</button>
            <button class="btn btn-ghost" id="btn-bulk-group" style="font-size:0.78rem;padding:0.25rem 0.6rem;">Assign Group…</button>
            <button class="btn btn-ghost" id="btn-bulk-delete" style="font-size:0.78rem;padding:0.25rem 0.6rem;color:var(--color-danger);">Delete</button>
            <button class="btn btn-ghost" id="btn-bulk-clear" style="font-size:0.78rem;padding:0.25rem 0.6rem;margin-left:auto;">✕ Clear</button>
          </div>
          <div class="toolbar">
            <input type="search" id="search-input" class="input" placeholder="Search users…" />
            <button class="btn btn-ghost" id="btn-import" style="white-space:nowrap">↥ Import</button>
            <button class="btn btn-ghost" id="btn-export" style="white-space:nowrap">↓ Export</button>
            <button class="btn btn-ghost" id="btn-history" style="white-space:nowrap" title="Import/export history">⏱ History</button>
            <button class="btn btn-primary" id="btn-create">+ Create</button>
            ${densityBarHTML()}
          </div>
          <div class="table-wrap" id="list-body"></div>
          <div class="pagination" id="pagination"></div>
        </div>
        <div class="detail-panel" id="detail-panel"></div>
      </div>
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal" id="modal-box"></div>
      </div>
    `;

    sr.getElementById('search-input').addEventListener('input', (e) => {
      const value = e.target.value; // capture now: e.target retargets to the shadow host once dispatch ends
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._search = value;
        this._page = 1;
        this._loadUsers();
      }, 300);
    });

    sr.getElementById('btn-create').addEventListener('click', () => this._openCreateModal());
    sr.getElementById('btn-export').addEventListener('click', () => this._exportCsv());
    sr.getElementById('btn-import').addEventListener('click', () => this._openImportModal());
    sr.getElementById('btn-history').addEventListener('click', () => this._openJobHistory());

    sr.getElementById('btn-bulk-enable').addEventListener('click',  () => this._bulkAction('enable'));
    sr.getElementById('btn-bulk-disable').addEventListener('click', () => this._bulkAction('disable'));
    sr.getElementById('btn-bulk-delete').addEventListener('click',  () => this._bulkAction('delete'));
    sr.getElementById('btn-bulk-group').addEventListener('click',   () => this._bulkAssignGroup());
    sr.getElementById('btn-bulk-clear').addEventListener('click',   () => {
      this._checkedUsers.clear();
      this._updateBulkBar();
      this._renderList();
    });

    sr.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === sr.getElementById('modal-overlay')) this._closeModal();
    });

    wireDensityBar(sr, () => sr.querySelector('#list-body table'));
  }

  // ── Load users ─────────────────────────────────────────────────────────────

  async _loadUsers() {
    // Skeleton only on the first paint — keep the current rows during a
    // search/pagination refetch so the list doesn't flash on every keystroke.
    if (!this._users.length) {
      const body = this.shadowRoot.getElementById('list-body');
      body.innerHTML = `
        <table>
          <thead><tr>
            <th class="cb-col"></th><th>Username</th><th>Status</th><th>Groups</th><th>Expiration</th>
          </tr></thead>
          <tbody>${skeletonRows(this.shadowRoot, 5, 8)}</tbody>
        </table>`;
    }
    try {
      const params = new URLSearchParams({ page: this._page, size: this._size, search: this._search, order: this._order });
      const data = await api.get(`/users?${params}`);
      this._users = data.items;
      this._total = data.total;
      this._renderList();
      this._renderPagination();
    } catch {
      toast('Failed to load users', 'error');
    }
  }

  _renderList() {
    const body = this.shadowRoot.getElementById('list-body');
    this.shadowRoot.getElementById('list-panel').classList.toggle('narrow', !!this._selected);

    if (!this._users.length) {
      body.innerHTML = emptyStateHTML({
        title: this._search ? 'No matching users' : 'No users yet',
        message: this._search
          ? `Nothing matches “${this._search}”. Try a different search.`
          : 'Create your first user to get started.',
      });
      return;
    }

    const allOnPage = this._users.map(u => u.username);
    const allChecked = allOnPage.length > 0 && allOnPage.every(u => this._checkedUsers.has(u));

    body.innerHTML = `
      <table>
        <thead><tr>
          <th class="cb-col" data-no-sort><input type="checkbox" id="cb-all" ${allChecked ? 'checked' : ''} title="Select all" /></th>
          <th data-sort-key="username">Username</th><th data-no-sort>Status</th><th data-no-sort>Groups</th><th data-no-sort>Expiration</th>
        </tr></thead>
        <tbody>
          ${this._users.map(u => `
            <tr class="clickable${this._selected === u.username ? ' selected' : ''}"
                data-username="${escHtml(u.username)}">
              <td class="cb-col" data-stop>
                <input type="checkbox" class="row-cb" data-u="${escHtml(u.username)}"
                  ${this._checkedUsers.has(u.username) ? 'checked' : ''} />
              </td>
              <td><strong>${escHtml(u.username)}</strong></td>
              <td>${u.disabled ? badge('Disabled', 'danger') : badge('Active', 'success')}</td>
              <td>
                <div class="groups-cell">
                  ${u.groups.length
                    ? u.groups.map(g => badge(escHtml(g), 'group')).join('')
                    : '<span style="color:var(--color-muted);font-size:0.78rem">—</span>'}
                </div>
              </td>
              <td style="font-size:0.78rem;color:var(--color-muted)">${escHtml(u.expiration) || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    body.querySelector('#cb-all')?.addEventListener('change', (e) => {
      allOnPage.forEach(u => e.target.checked ? this._checkedUsers.add(u) : this._checkedUsers.delete(u));
      this._updateBulkBar();
      this._renderList();
    });

    body.querySelectorAll('.row-cb').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.target.checked ? this._checkedUsers.add(cb.dataset.u) : this._checkedUsers.delete(cb.dataset.u);
        this._updateBulkBar();
      });
    });

    body.querySelectorAll('tr[data-username]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-stop]')) return;
        this._selectUser(row.dataset.username);
      });
    });

    // Re-apply the saved density to the freshly-rendered table (the list rebuilds
    // its innerHTML on every search / page / selection change).
    const table = body.querySelector('table');
    applyDensity(table);

    // Username sorts server-side (the list is paginated, so a client sort would
    // only reorder the visible page). Clicking the header toggles direction,
    // resets to page 1, and refetches; the other columns are derived and stay
    // unsorted.
    makeSortable(table, {
      active: { key: 'username', dir: this._order },
      onSort: (_key, dir) => { this._order = dir; this._page = 1; this._loadUsers(); },
    });
  }

  _renderPagination() {
    const pg = this.shadowRoot.getElementById('pagination');
    const pages = Math.ceil(this._total / this._size) || 1;
    pg.innerHTML = `
      <span>${this._total} user${this._total !== 1 ? 's' : ''}</span>
      <div class="pagination-btns">
        <button class="btn btn-ghost" id="pg-prev" ${this._page <= 1 ? 'disabled' : ''}>‹ Prev</button>
        <span style="align-self:center;font-size:0.78rem">${this._page} / ${pages}</span>
        <button class="btn btn-ghost" id="pg-next" ${this._page >= pages ? 'disabled' : ''}>Next ›</button>
      </div>
    `;
    pg.querySelector('#pg-prev')?.addEventListener('click', () => { this._page--; this._loadUsers(); });
    pg.querySelector('#pg-next')?.addEventListener('click', () => { this._page++; this._loadUsers(); });
  }

  // ── Detail panel ───────────────────────────────────────────────────────────

  async _selectUser(username) {
    this._selected = username;
    this._tab = 'overview';
    this._tabData = {};
    this._renderList();
    const dp = this.shadowRoot.getElementById('detail-panel');
    dp.classList.add('open');
    dp.innerHTML = `<div class="detail-inner">${skeletonBlock(this.shadowRoot, 5)}</div>`;
    try {
      this._detail = await api.get(`/users/${encodeURIComponent(username)}`);
      this._renderDetail();
    } catch {
      toast('Failed to load user detail', 'error');
    }
  }

  _renderDetail() {
    const dp = this.shadowRoot.getElementById('detail-panel');
    dp.classList.add('open');
    const d = this._detail;
    if (!d) return;

    dp.innerHTML = `
      <div class="detail-inner">
        <div class="detail-header">
          <div class="detail-username">${escHtml(d.username)}</div>
          ${d.disabled ? badge('Disabled', 'danger') : badge('Active', 'success')}
          <button class="btn ${d.disabled ? 'btn-primary' : 'btn-ghost'}" id="btn-toggle">
            ${d.disabled ? 'Enable' : 'Disable'}
          </button>
          <button class="icon-btn danger" id="btn-close-detail" title="Close">✕</button>
        </div>
        <div class="detail-tabs">
          ${['overview','check','reply','sessions','auth-log','timeline'].map(t => `
            <button class="tab-btn${this._tab === t ? ' active' : ''}" data-tab="${t}">
              ${{ overview:'Overview', check:'Check', reply:'Reply', sessions:'Sessions', 'auth-log':'Auth Log', timeline:'Timeline' }[t]}
            </button>
          `).join('')}
        </div>
        <div class="detail-body" id="detail-body"></div>
      </div>
    `;

    dp.querySelector('#btn-close-detail').addEventListener('click', () => this._closeDetail());
    dp.querySelector('#btn-toggle').addEventListener('click', () => this._toggleDisable());
    dp.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        dp.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._renderTab();
      });
    });

    this._renderTab();
  }

  _renderTab() {
    const body = this.shadowRoot.getElementById('detail-body');
    if (!body) return;
    switch (this._tab) {
      case 'overview':  this._renderOverviewTab(body); break;
      case 'check':     this._renderAttrsTab(body, 'check'); break;
      case 'reply':     this._renderAttrsTab(body, 'reply'); break;
      case 'sessions':  this._renderSessionsTab(body); break;
      case 'auth-log':  this._renderAuthLogTab(body); break;
      case 'timeline':  this._renderTimelineTab(body); break;
    }
  }

  // ── Overview tab ──────────────────────────────────────────────────────────

  _renderOverviewTab(body) {
    const d = this._detail;
    const exp = d.check_attrs.find(a => a.attribute === 'Expiration')?.value || '';
    const simRaw = d.check_attrs.find(a => a.attribute === 'Simultaneous-Use')?.value;

    body.innerHTML = `
      <div class="section-header">Change Password</div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>New Password</label>
          <input class="input" type="password" id="new-pwd" placeholder="Leave blank to keep" />
        </div>
        <div class="form-row">
          <label>Type</label>
          <select class="input" id="pwd-type">
            ${PASSWORD_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" id="btn-save-pwd">Save</button>
      </div>

      <div class="section-header">Groups</div>
      <div class="form-row">
        <label>Group names (comma-separated)</label>
        <input class="input" id="groups-input" type="text"
          value="${d.groups.map(g => g.groupname).join(', ')}"
          placeholder="e.g. pppoe-users, premium" />
      </div>
      <button class="btn btn-primary" id="btn-save-groups">Save Groups</button>

      <div class="section-header">Limits</div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Expiration</label>
          <input class="input" id="expiration-input" type="text"
            value="${escHtml(exp)}" placeholder="e.g. Jan 01 2025 00:00:00" />
        </div>
        <div class="form-row">
          <label>Simultaneous-Use</label>
          <input class="input" id="sim-input" type="number" min="0"
            value="${escHtml(simRaw) || ''}" placeholder="0 = unlimited" />
        </div>
        <button class="btn btn-primary" id="btn-save-limits">Save</button>
      </div>

      <div class="danger-zone">
        <p>Permanently deletes the user and all their RADIUS attributes. Accounting history is preserved.</p>
        <button class="btn btn-danger" id="btn-delete">Delete User</button>
      </div>
    `;

    body.querySelector('#btn-save-pwd').addEventListener('click', async () => {
      const pwd = body.querySelector('#new-pwd').value.trim();
      if (!pwd) { toast('Enter a new password', 'warning'); return; }
      await this._updateUser({ password: pwd, password_type: body.querySelector('#pwd-type').value });
      body.querySelector('#new-pwd').value = '';
    });

    body.querySelector('#btn-save-groups').addEventListener('click', async () => {
      const raw = body.querySelector('#groups-input').value;
      const groups = raw.split(',').map(s => s.trim()).filter(Boolean);
      try {
        await api.put(`/users/${encodeURIComponent(this._selected)}/groups`, { groups });
        toast('Groups updated', 'success');
        await this._refreshDetail();
      } catch (e) {
        toast(e.message || 'Failed to update groups', 'error');
      }
    });

    body.querySelector('#btn-save-limits').addEventListener('click', async () => {
      const expVal = body.querySelector('#expiration-input').value.trim();
      const simVal = body.querySelector('#sim-input').value;
      const sim = simVal === '' ? null : parseInt(simVal);
      await this._updateUser({ expiration: expVal, simultaneous_use: sim });
    });

    body.querySelector('#btn-delete').addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete user "${this._selected}"? This cannot be undone.`, { title: 'Delete user', danger: true }))) return;
      try {
        await api.delete(`/users/${encodeURIComponent(this._selected)}`);
        toast(`User ${this._selected} deleted`, 'success');
        this._closeDetail();
        this._loadUsers();
      } catch (e) {
        toast(e.message || 'Delete failed', 'error');
      }
    });
  }

  // ── Attrs tab ─────────────────────────────────────────────────────────────

  _renderAttrsTab(body, type) {
    const rows = type === 'check' ? this._detail.check_attrs : this._detail.reply_attrs;
    body.innerHTML = `
      <table class="attr-table">
        <thead><tr><th>Attribute</th><th class="op-col">Op</th><th>Value</th><th class="actions-col"></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr data-id="${r.id}">
              <td>${escHtml(r.attribute)}</td>
              <td class="op-col"><input class="input attr-op" value="${escHtml(r.op)}" style="width:55px;padding:0.25rem;" /></td>
              <td><input class="input attr-val" value="${escHtml(r.value)}" style="padding:0.25rem;" /></td>
              <td class="actions-col">
                <button class="icon-btn btn-save-attr" title="Save">💾</button>
                <button class="icon-btn danger btn-del-attr" title="Delete">🗑</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="add-attr-row">
        <input class="input" id="new-attr-name" placeholder="Attribute" />
        <input class="input op-input" id="new-attr-op" value=":=" />
        <input class="input" id="new-attr-val" placeholder="Value" />
        <button class="btn btn-primary" id="btn-add-attr">Add</button>
      </div>
    `;

    body.querySelectorAll('.btn-save-attr').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const id = parseInt(row.dataset.id);
        const op = row.querySelector('.attr-op').value;
        const value = row.querySelector('.attr-val').value;
        try {
          await api.put(`/users/${encodeURIComponent(this._selected)}/${type}/${id}`, { op, value });
          toast('Attribute updated', 'success');
          await this._refreshDetail();
        } catch (e) { toast(e.message || 'Update failed', 'error'); }
      });
    });

    body.querySelectorAll('.btn-del-attr').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const id = parseInt(row.dataset.id);
        if (!(await confirmDialog('Delete this attribute?', { title: 'Delete attribute', danger: true }))) return;
        try {
          await api.delete(`/users/${encodeURIComponent(this._selected)}/${type}/${id}`);
          toast('Attribute deleted', 'success');
          await this._refreshDetail();
        } catch (e) { toast(e.message || 'Delete failed', 'error'); }
      });
    });

    body.querySelector('#btn-add-attr').addEventListener('click', async () => {
      const attr = body.querySelector('#new-attr-name').value.trim();
      const op   = body.querySelector('#new-attr-op').value.trim() || ':=';
      const val  = body.querySelector('#new-attr-val').value.trim();
      if (!attr || !val) { toast('Attribute and value required', 'warning'); return; }
      try {
        await api.post(`/users/${encodeURIComponent(this._selected)}/${type}`, { attribute: attr, op, value: val });
        toast('Attribute added', 'success');
        body.querySelector('#new-attr-name').value = '';
        body.querySelector('#new-attr-val').value = '';
        await this._refreshDetail();
      } catch (e) { toast(e.message || 'Add failed', 'error'); }
    });
  }

  // ── Sessions tab ──────────────────────────────────────────────────────────

  async _renderSessionsTab(body) {
    body.innerHTML = `<div style="color:var(--color-muted);font-size:0.85rem;padding:1rem 0;">Loading sessions…</div>`;
    if (!this._tabData.sessions) {
      try {
        this._tabData.sessions = await api.get(`/users/${encodeURIComponent(this._selected)}/sessions`);
      } catch {
        body.innerHTML = `<div style="color:var(--color-danger);padding:1rem;">Failed to load sessions.</div>`;
        return;
      }
    }
    const rows = this._tabData.sessions;
    const refreshRow = `<div style="display:flex;justify-content:flex-end;padding:0 0 0.5rem 0;">
      <button class="btn btn-ghost" style="padding:0.3rem 0.65rem;font-size:0.75rem;" id="btn-refresh-sess">↻ Refresh</button>
    </div>`;
    if (!rows.length) {
      body.innerHTML = refreshRow + `<div class="empty-state">No sessions found.</div>`;
    } else {
      body.innerHTML = refreshRow + `
        <table>
          <thead><tr><th>Start</th><th>Stop</th><th>Auth</th><th>Duration</th><th>In / Out</th><th>NAS / Location</th><th>Cause</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="font-size:0.78rem;white-space:nowrap">${fmtDate(r.acctstarttime)}</td>
                <td style="font-size:0.78rem;white-space:nowrap;color:var(--color-muted)">
                  ${r.acctstoptime ? fmtDate(r.acctstoptime) : badge('Active', 'success')}
                </td>
                <td>${r.auth_outcome === 'Access-Accept'
                  ? badge('Accept', 'success')
                  : r.auth_outcome
                    ? badge('Reject', 'danger')
                    : '<span style="color:var(--color-muted);font-size:0.72rem">—</span>'}
                </td>
                <td style="font-size:0.78rem">${fmtDuration(r.acctsessiontime)}</td>
                <td style="font-size:0.78rem">${fmtBytes(r.acctinputoctets)} / ${fmtBytes(r.acctoutputoctets)}</td>
                <td style="font-size:0.78rem">
                  <span style="color:var(--color-muted)">${escHtml(r.nasipaddress || '—')}</span>
                  ${r.geo_client ? `<div style="font-size:0.7rem;color:var(--color-muted)">${geoLabelHTML(r.geo_client)}</div>` : ''}
                </td>
                <td style="font-size:0.78rem;color:var(--color-muted)">${escHtml(r.acctterminatecause || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
    body.querySelector('#btn-refresh-sess')?.addEventListener('click', () => {
      this._tabData.sessions = null;
      this._renderSessionsTab(body);
    });
  }

  // ── Auth log tab ──────────────────────────────────────────────────────────

  async _renderAuthLogTab(body) {
    body.innerHTML = `<div style="color:var(--color-muted);font-size:0.85rem;padding:1rem 0;">Loading auth log…</div>`;
    try {
      if (!this._tabData.authHistory) {
        this._tabData.authHistory = await api.get(`/users/${encodeURIComponent(this._selected)}/auth-history`);
      }
      const rows = Array.isArray(this._tabData.authHistory) ? this._tabData.authHistory : [];
      const refreshBtn = `<div style="display:flex;justify-content:flex-end;padding:0 0 0.5rem 0;"><button class="btn btn-ghost" style="padding:0.3rem 0.65rem;font-size:0.75rem;" id="btn-refresh-auth">↻ Refresh</button></div>`;
      if (!rows.length) {
        body.innerHTML = refreshBtn + `<div class="empty-state">No auth events found.</div>`;
      } else {
        body.innerHTML = refreshBtn + `
          <table>
            <thead><tr><th>Time</th><th>Result</th><th>Method</th><th>Calling Station</th><th>NAS / Location</th><th></th></tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td style="font-size:0.78rem;white-space:nowrap">${fmtDate(r.authdate)}</td>
                  <td>${r.reply === 'Access-Accept' ? badge('Accept', 'success') : badge(r.reply || 'Unknown', 'danger')}</td>
                  <td style="font-size:0.72rem;color:var(--color-muted)">${escHtml(r.authmethod || '—')}</td>
                  <td style="font-size:0.78rem;color:var(--color-muted)">${escHtml(r.callingstationid || '—')}</td>
                  <td style="font-size:0.78rem">
                    <span style="color:var(--color-muted)">${escHtml(r.nasipaddress || '—')}</span>
                    ${r.geo_client ? `<div style="font-size:0.7rem;color:var(--color-muted)">${geoLabelHTML(r.geo_client)}</div>` : ''}
                  </td>
                  <td>${r.linked_session_id ? `<a class="auth-sess-link" data-sid="${r.linked_session_id}" href="#" style="font-size:0.7rem;color:var(--color-accent)" title="View linked session">↗ Session</a>` : ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
      body.querySelector('#btn-refresh-auth')?.addEventListener('click', () => {
        this._tabData.authHistory = null;
        this._renderAuthLogTab(body);
      });
      body.querySelectorAll('.auth-sess-link').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          router.navigate('/accounting?highlight=' + a.dataset.sid);
        });
      });
    } catch (err) {
      body.innerHTML = `<div style="color:var(--color-danger);padding:1rem;">Failed to load auth history: ${escHtml(err.message)}</div>`;
    }
  }

  // ── Timeline tab (Phase 20.2) ────────────────────────────────────────────

  async _renderTimelineTab(body) {
    body.innerHTML = `<div style="color:var(--color-muted);font-size:0.85rem;padding:1rem 0;">Loading timeline…</div>`;
    try {
      if (!this._tabData.timeline) {
        this._tabData.timeline = await api.get(`/users/${encodeURIComponent(this._selected)}/timeline`);
      }
      const events = this._tabData.timeline || [];
      const refreshBtn = `<div style="display:flex;justify-content:flex-end;padding:0 0 0.5rem 0;">
        <button class="btn btn-ghost" style="padding:0.3rem 0.65rem;font-size:0.75rem;" id="btn-refresh-tl">↻ Refresh</button>
      </div>`;
      if (!events.length) {
        body.innerHTML = refreshBtn + `<div class="empty-state">No activity recorded yet.</div>`;
      } else {
        const items = events.map(ev => {
          if (ev.type === 'auth') {
            const accept = ev.reply === 'Access-Accept';
            return `
              <div class="tl-item tl-auth ${accept ? 'tl-accept' : 'tl-reject'}">
                <div class="tl-dot"></div>
                <div class="tl-content">
                  <div class="tl-row">
                    ${accept ? badge('Accept', 'success') : badge(ev.reply || 'Reject', 'danger')}
                    ${ev.authmethod ? `<span style="font-size:0.72rem;color:var(--color-muted);margin-left:6px">${escHtml(ev.authmethod)}</span>` : ''}
                    <span style="margin-left:auto;font-size:0.72rem;color:var(--color-muted)">${fmtDate(ev.timestamp)}</span>
                  </div>
                  ${ev.failurereason ? `<div style="font-size:0.72rem;color:var(--color-danger);margin-top:3px">${escHtml(ev.failurereason)}</div>` : ''}
                  ${ev.nasipaddress ? `<div style="font-size:0.72rem;color:var(--color-muted);margin-top:2px">NAS ${escHtml(ev.nasipaddress)}${ev.geo_client ? ' · ' + geoLabelHTML(ev.geo_client) : ''}</div>` : ''}
                  ${ev.auth_latency_ms != null ? `<div style="font-size:0.7rem;color:var(--color-muted)">Latency ${ev.auth_latency_ms} ms</div>` : ''}
                </div>
              </div>`;
          } else {
            const active = !ev.acctstoptime;
            return `
              <div class="tl-item tl-session">
                <div class="tl-dot"></div>
                <div class="tl-content">
                  <div class="tl-row">
                    ${active ? badge('Active Session', 'success') : `<span style="font-size:0.8rem;font-weight:500">Session</span>`}
                    <span style="margin-left:auto;font-size:0.72rem;color:var(--color-muted)">${fmtDate(ev.timestamp)}</span>
                  </div>
                  <div style="font-size:0.72rem;color:var(--color-muted);margin-top:3px">
                    ${fmtDuration(ev.acctsessiontime)} · ${fmtBytes(ev.acctinputoctets)} ↑ / ${fmtBytes(ev.acctoutputoctets)} ↓
                  </div>
                  ${ev.nasipaddress ? `<div style="font-size:0.72rem;color:var(--color-muted)">${escHtml(ev.nasipaddress)}${ev.geo_client ? ' · ' + geoLabelHTML(ev.geo_client) : ''}</div>` : ''}
                  ${ev.framedipaddress ? `<div style="font-size:0.7rem;color:var(--color-muted)">IP ${escHtml(ev.framedipaddress)}</div>` : ''}
                </div>
              </div>`;
          }
        }).join('');
        body.innerHTML = refreshBtn + `<div class="timeline">${items}</div>`;
      }
      body.querySelector('#btn-refresh-tl')?.addEventListener('click', () => {
        this._tabData.timeline = null;
        this._renderTimelineTab(body);
      });
    } catch (err) {
      body.innerHTML = `<div style="color:var(--color-danger);padding:1rem;">Failed to load timeline: ${escHtml(err.message)}</div>`;
    }
  }

  // ── Create modal ──────────────────────────────────────────────────────────

  _openCreateModal() {
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    const box     = this.shadowRoot.getElementById('modal-box');
    box.innerHTML = `
      <div class="modal-title">Create User</div>
      <div class="form-row">
        <label>Username</label>
        <input class="input" id="m-username" type="text" autocomplete="off" />
      </div>
      <div class="form-row">
        <label>Password</label>
        <input class="input" id="m-password" type="password" autocomplete="new-password" />
      </div>
      <div class="form-row">
        <label>Password Type</label>
        <select class="input" id="m-pwd-type">
          ${PASSWORD_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>Groups</label>
        <div id="m-group-picker"></div>
      </div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Expiration</label>
          <input class="input" id="m-expiration" type="text" placeholder="Jan 01 2026 00:00:00" />
        </div>
        <div class="form-row">
          <label>Simultaneous-Use</label>
          <input class="input" id="m-sim" type="number" min="1" placeholder="Unlimited" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="btn-modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-modal-submit">Create</button>
      </div>
    `;
    overlay.classList.add('open');

    box.querySelector('#btn-modal-cancel').addEventListener('click', () => this._closeModal());
    box.querySelector('#btn-modal-submit').addEventListener('click', () => this._submitCreate());
    box.querySelector('#m-username').focus();

    // Init group picker (async fetch runs in background; modal is already usable)
    this._groupPicker = new GroupPicker(box.querySelector('#m-group-picker'));
    this._groupPicker.init();
  }

  async _submitCreate() {
    const box = this.shadowRoot.getElementById('modal-box');
    const uEl = box.querySelector('#m-username');
    const pEl = box.querySelector('#m-password');
    const username      = uEl.value.trim();
    const password      = pEl.value;
    const password_type = box.querySelector('#m-pwd-type').value;
    const expiration    = box.querySelector('#m-expiration').value.trim() || null;
    const simRaw        = box.querySelector('#m-sim').value;
    const simultaneous_use = simRaw ? parseInt(simRaw) : null;
    const groups        = this._groupPicker ? this._groupPicker.selected : [];

    clearFieldErrors(box);
    let invalid = false;
    if (!username) { setFieldError(uEl, 'Username is required'); invalid = true; }
    if (!password) { setFieldError(pEl, 'Password is required'); invalid = true; }
    if (invalid) return;

    try {
      await api.post('/users', { username, password, password_type, groups, expiration, simultaneous_use });
      toast(`User ${username} created`, 'success');
      this._groupPicker = null;
      this._closeModal();
      this._loadUsers();
    } catch (e) {
      // Server validation errors (e.g. illegal username characters) land inline
      // on the offending field; anything else (duplicate user, server error)
      // still surfaces as a toast.
      if (!applyServerErrors(box, e)) toast(e.message || 'Create failed', 'error');
    }
  }

  _closeModal() {
    this.shadowRoot.getElementById('modal-overlay').classList.remove('open');
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async _toggleDisable() {
    const endpoint = this._detail.disabled ? 'enable' : 'disable';
    try {
      await api.post(`/users/${encodeURIComponent(this._selected)}/${endpoint}`);
      toast(`User ${endpoint}d`, 'success');
      await this._refreshDetail();
      this._loadUsers();
    } catch (e) { toast(e.message || 'Action failed', 'error'); }
  }

  async _updateUser(payload) {
    try {
      await api.put(`/users/${encodeURIComponent(this._selected)}`, payload);
      toast('Saved', 'success');
      await this._refreshDetail();
    } catch (e) { toast(e.message || 'Update failed', 'error'); }
  }

  async _refreshDetail() {
    this._detail = await api.get(`/users/${encodeURIComponent(this._selected)}`);
    this._tabData = {};
    this._renderDetail();
  }

  _closeDetail() {
    this._selected = null;
    this._detail = null;
    const dp = this.shadowRoot.getElementById('detail-panel');
    dp.classList.remove('open');
    dp.innerHTML = '';
    this._renderList();
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────

  _updateBulkBar() {
    const bar   = this.shadowRoot.getElementById('bulk-bar');
    const count = this.shadowRoot.getElementById('bulk-count');
    const n = this._checkedUsers.size;
    if (n > 0) {
      bar.classList.add('visible');
      count.textContent = `${n} selected`;
    } else {
      bar.classList.remove('visible');
    }
  }

  async _bulkAction(action) {
    const n = this._checkedUsers.size;
    if (!n) return;

    if (action === 'delete') {
      if (!(await confirmDialog(`Delete ${n} user${n !== 1 ? 's' : ''}? This cannot be undone.`, { title: 'Delete users', danger: true }))) return;
    }

    try {
      const result = await api.post(`/users/bulk/${action}`, { usernames: [...this._checkedUsers] });
      const label = action === 'enable' ? 'enabled' : action === 'disable' ? 'disabled' : 'deleted';
      toast(`${result.ok ?? n} user${n !== 1 ? 's' : ''} ${label}`, 'success');
      this._checkedUsers.clear();
      this._updateBulkBar();
      if (this._selected && action === 'delete') this._closeDetail();
      this._loadUsers();
    } catch (e) {
      toast(e.message || `Bulk ${action} failed`, 'error');
    }
  }

  _bulkAssignGroup() {
    if (!this._checkedUsers.size) return;
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    const box     = this.shadowRoot.getElementById('modal-box');
    box.innerHTML = `
      <div class="modal-title">Assign Group</div>
      <p style="font-size:0.85rem;color:var(--color-muted);margin:0 0 1rem 0;">
        Assign <strong>${this._checkedUsers.size}</strong> selected user${this._checkedUsers.size !== 1 ? 's' : ''} to a group.
      </p>
      <div class="form-row">
        <label>Group Name</label>
        <input class="input" id="m-group-name" type="text" placeholder="e.g. pppoe-users" autocomplete="off" />
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="btn-modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-modal-submit">Assign</button>
      </div>
    `;
    overlay.classList.add('open');
    box.querySelector('#m-group-name').focus();

    box.querySelector('#btn-modal-cancel').addEventListener('click', () => this._closeModal());
    box.querySelector('#btn-modal-submit').addEventListener('click', async () => {
      const group = box.querySelector('#m-group-name').value.trim();
      if (!group) { toast('Group name required', 'warning'); return; }
      try {
        const result = await api.post('/users/bulk/assign-group', { usernames: [...this._checkedUsers], group });
        toast(`Group "${group}" assigned to ${result.ok ?? this._checkedUsers.size} user${this._checkedUsers.size !== 1 ? 's' : ''}`, 'success');
        this._closeModal();
        this._checkedUsers.clear();
        this._updateBulkBar();
        this._loadUsers();
      } catch (e) {
        toast(e.message || 'Assign group failed', 'error');
      }
    });
    box.querySelector('#m-group-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') box.querySelector('#btn-modal-submit').click();
    });
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async _exportCsv() {
    try {
      const qs = this._search ? `?search=${encodeURIComponent(this._search)}` : '';
      const res = await fetch(`/api/users/export${qs}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `users-export-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
    }
  }

  // ── Import ────────────────────────────────────────────────────────────────

  _openImportModal() {
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    const box     = this.shadowRoot.getElementById('modal-box');
    this._importFile = null;

    box.innerHTML = `
      <div class="modal-title">Import Users from CSV</div>
      <p style="font-size:0.82rem;color:var(--color-muted);margin:0 0 0.75rem 0;">
        Required columns: <code>username</code>, <code>password</code>.<br>
        Optional: <code>password_type</code>, <code>groups</code> (semicolon-separated), <code>expiration</code>, <code>simultaneous_use</code>.
      </p>
      <div class="drop-zone" id="drop-zone" tabindex="0">
        <div id="dz-label">Drop a CSV file here, or click to browse</div>
        <input type="file" id="file-input" accept=".csv,text/csv" style="display:none" />
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="btn-modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-modal-preview" disabled>Preview Import</button>
      </div>
    `;
    overlay.classList.add('open');

    const dz    = box.querySelector('#drop-zone');
    const fi    = box.querySelector('#file-input');
    const label = box.querySelector('#dz-label');
    const btn   = box.querySelector('#btn-modal-preview');

    const setFile = (file) => {
      if (!file || !file.name.endsWith('.csv')) { toast('Please select a CSV file', 'warning'); return; }
      this._importFile = file;
      dz.classList.add('has-file');
      label.textContent = `✓ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      btn.disabled = false;
    };

    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fi.click(); });
    fi.addEventListener('change', (e) => setFile(e.target.files[0]));

    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      setFile(e.dataTransfer.files[0]);
    });

    box.querySelector('#btn-modal-cancel').addEventListener('click', () => this._closeModal());
    btn.addEventListener('click', () => this._importPreview(box));
  }

  async _importPreview(box) {
    if (!this._importFile) return;
    const previewBtn = box.querySelector('#btn-modal-preview');
    previewBtn.disabled = true;
    previewBtn.textContent = 'Previewing…';
    try {
      const fd = new FormData();
      fd.append('file', this._importFile);
      const preview = await api.upload('/users/import/preview', fd);
      this._importStep2(preview);
    } catch (e) {
      toast(e.message || 'Preview failed', 'error');
      previewBtn.disabled = false;
      previewBtn.textContent = 'Preview Import';
    }
  }

  _importStep2(preview) {
    const box = this.shadowRoot.getElementById('modal-box');
    const { rows, new_count, exists_count, error_count } = preview;

    const statusIcon  = (s) => s === 'ok' ? '✓' : s === 'exists' ? '⚠' : '✕';
    const statusClass = (s) => s === 'ok' ? 'st-ok' : s === 'exists' ? 'st-exists' : 'st-error';
    const statusLabel = (r) => {
      if (r.status === 'ok')     return 'New';
      if (r.status === 'exists') return 'Exists';
      return r.error || 'Error';
    };

    box.innerHTML = `
      <div class="modal-title">Import Preview</div>
      <div class="import-summary">
        <span style="color:var(--color-success)">✓ ${new_count} new</span>
        <span style="color:var(--color-warning, #F5A623)">⚠ ${exists_count} exist</span>
        <span style="color:var(--color-danger)">✕ ${error_count} error${error_count !== 1 ? 's' : ''}</span>
      </div>
      <div style="max-height:320px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius);">
        <table class="import-preview-table">
          <thead><tr><th>#</th><th>Username</th><th>Password Type</th><th>Groups</th><th>Status</th></tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="color:var(--color-muted)">${r.row}</td>
                <td><strong>${escHtml(r.username)}</strong></td>
                <td style="color:var(--color-muted);font-size:0.75rem">${escHtml(r.password_type)}</td>
                <td style="color:var(--color-muted);font-size:0.75rem">${r.groups.map(escHtml).join(', ') || '—'}</td>
                <td><span class="${statusClass(r.status)}">${statusIcon(r.status)} ${escHtml(statusLabel(r))}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="btn-back">← Back</button>
        <button class="btn btn-ghost" id="btn-modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-commit" ${new_count === 0 ? 'disabled' : ''}>
          Import ${new_count} user${new_count !== 1 ? 's' : ''}
        </button>
      </div>
    `;

    box.querySelector('#btn-modal-cancel').addEventListener('click', () => this._closeModal());
    box.querySelector('#btn-back').addEventListener('click', () => this._openImportModal());
    box.querySelector('#btn-commit')?.addEventListener('click', () => this._importCommit(rows, box));
  }

  async _importCommit(allRows, box) {
    const okRows = allRows.filter(r => r.status === 'ok').map(r => ({
      username:        r.username,
      password:        r.password,
      password_type:   r.password_type || 'Cleartext-Password',
      groups:          r.groups || [],
      expiration:      r.expiration || null,
      simultaneous_use: r.simultaneous_use || null,
    }));

    const commitBtn = box.querySelector('#btn-commit');
    if (commitBtn) { commitBtn.disabled = true; commitBtn.textContent = 'Importing…'; }

    try {
      const result = await api.post('/users/import/commit', { rows: okRows, skip_existing: true });
      this._importStep3(result);
      this._loadUsers();
    } catch (e) {
      toast(e.message || 'Import failed', 'error');
      if (commitBtn) { commitBtn.disabled = false; commitBtn.textContent = `Import ${okRows.length} users`; }
    }
  }

  _importStep3(result) {
    const box = this.shadowRoot.getElementById('modal-box');
    const { created, skipped, errors } = result;
    box.innerHTML = `
      <div class="modal-title">Import Complete</div>
      <div class="import-summary" style="margin:1rem 0;">
        <span style="color:var(--color-success)">✓ ${created} created</span>
        <span style="color:var(--color-muted)">⊘ ${skipped} skipped</span>
        ${errors.length ? `<span style="color:var(--color-danger)">✕ ${errors.length} error${errors.length !== 1 ? 's' : ''}</span>` : ''}
      </div>
      ${errors.length ? `
        <div style="font-size:0.78rem;color:var(--color-muted);margin-bottom:0.5rem;">Errors:</div>
        <ul style="font-size:0.78rem;color:var(--color-danger);padding-left:1.2rem;margin:0 0 0.75rem 0;">
          ${errors.map(e => `<li>${escHtml(e.username || '')}: ${escHtml(e.error || JSON.stringify(e))}</li>`).join('')}
        </ul>
      ` : ''}
      <div class="modal-footer">
        <button class="btn btn-primary" id="btn-modal-done">Done</button>
      </div>
    `;
    box.querySelector('#btn-modal-done').addEventListener('click', () => this._closeModal());
  }

  async _openJobHistory() {
    const box = this.shadowRoot.getElementById('modal-box');
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    box.innerHTML = `<div class="modal-title">Import / Export History</div><div id="jh-body" style="min-height:80px;display:flex;align-items:center;justify-content:center;color:var(--color-muted)">Loading…</div><div class="modal-footer"><button class="btn btn-ghost" id="btn-jh-close">Close</button></div>`;
    overlay.classList.add('open');
    box.querySelector('#btn-jh-close').addEventListener('click', () => this._closeModal());

    const data = await api.get('/users/bulk-jobs?size=50');
    const body = box.querySelector('#jh-body');
    if (!data?.items?.length) {
      body.textContent = 'No import or export jobs yet.';
      return;
    }
    const fmt = (iso) => iso ? new Date(iso).toLocaleString() : '—';
    const badge = (type) => type === 'import'
      ? `<span style="background:var(--mr-action-tint);color:var(--mr-action);padding:1px 7px;border-radius:99px;font-size:0.75rem;">import</span>`
      : `<span style="background:var(--color-surface);border:1px solid var(--color-border);padding:1px 7px;border-radius:99px;font-size:0.75rem;">export</span>`;
    body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
        <thead><tr style="border-bottom:1px solid var(--color-border);text-align:left;">
          <th style="padding:4px 8px">Type</th><th style="padding:4px 8px">When</th><th style="padding:4px 8px">By</th>
          <th style="padding:4px 8px;text-align:right">✓ OK</th><th style="padding:4px 8px;text-align:right">⊘ Skip</th><th style="padding:4px 8px;text-align:right">✕ Err</th>
        </tr></thead>
        <tbody>
          ${data.items.map(j => `
            <tr style="border-bottom:1px solid var(--color-border);">
              <td style="padding:5px 8px">${badge(j.job_type)}</td>
              <td style="padding:5px 8px;color:var(--color-muted)">${fmt(j.created_at)}</td>
              <td style="padding:5px 8px">${escHtml(j.created_by)}</td>
              <td style="padding:5px 8px;text-align:right;color:var(--color-success)">${j.row_ok}</td>
              <td style="padding:5px 8px;text-align:right;color:var(--color-muted)">${j.row_skipped}</td>
              <td style="padding:5px 8px;text-align:right;${j.row_error ? 'color:var(--color-danger)' : 'color:var(--color-muted)'}">${j.row_error}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${data.total > 50 ? `<p style="margin:0.5rem 0 0;font-size:0.78rem;color:var(--color-muted)">Showing 50 of ${data.total} records.</p>` : ''}
    `;
  }
}

customElements.define('users-view', UsersView);

router.register('/users', () => document.createElement('users-view'));
