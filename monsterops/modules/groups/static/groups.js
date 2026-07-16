import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { applyServerErrors, clearFieldErrors, setFieldError } from '/js/utils/form.js';
import { applyDensity, densityBarHTML, makeSortable, wireDensityBar } from '/js/utils/table.js';
import { emptyStateHTML } from '/js/utils/empty.js';

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(
    /"/g,
    '&quot;',
  );
}

const CSS = `
@import '/css/theme.css';

:host { display: block; height: 100%; }

.layout { display: flex; height: 100%; overflow: hidden; }

.list-panel {
  display: flex; flex-direction: column; flex: 1 1 auto;
  min-width: 0; transition: flex 0.25s ease; overflow: hidden;
}
.list-panel.narrow { flex: 0 0 40%; }

.toolbar { display: flex; gap: 0.75rem; padding: 0 0 1rem 0; align-items: center; flex-shrink: 0; }
.toolbar input[type=search] { flex: 1; }

.table-wrap { flex: 1; overflow-y: auto; }

table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th {
  position: sticky; top: 0; text-align: left; padding: 0.5rem 0.75rem;
  font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--color-muted); border-bottom: 1px solid var(--color-border);
  background: var(--color-bg); z-index: 1;
}
td { padding: 0.55rem 0.75rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr.clickable { cursor: pointer; }
tr.clickable:hover td { background: var(--color-surface); }
tr.selected td { background: color-mix(in srgb, var(--color-accent) 8%, transparent); }

.badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.68rem; font-weight: 600; }
.badge-neutral { background: var(--color-border); color: var(--color-muted); }
.badge-accent  { background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent); }

.count-pill {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 0.75rem; color: var(--color-muted);
}
.count-pill strong { color: var(--color-text); }

.pagination { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 0 0 0; font-size: 0.8rem; color: var(--color-muted); flex-shrink: 0; }
.pagination-btns { display: flex; gap: 0.4rem; }
.empty-state { padding: 3rem; text-align: center; color: var(--color-muted); font-size: 0.9rem; }

/* Detail */
.detail-panel {
  flex: 0 0 0; overflow: hidden; border-left: 1px solid var(--color-border);
  transition: flex 0.25s ease; display: flex; flex-direction: column; background: var(--color-bg);
}
.detail-panel.open { flex: 0 0 60%; }
.detail-inner { display: flex; flex-direction: column; height: 100%; overflow: hidden; min-width: 420px; }

.detail-header {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0 1.25rem 1rem 1.25rem; border-bottom: 1px solid var(--color-border); flex-shrink: 0;
}
.detail-name { font-size: 1.1rem; font-weight: 700; color: var(--color-text); flex: 1; }
.detail-name-input { font-size: 1rem; font-weight: 700; flex: 1; }

.detail-tabs { display: flex; border-bottom: 1px solid var(--color-border); flex-shrink: 0; padding: 0 1.25rem; }
.tab-btn {
  padding: 0.65rem 1rem; border: none; background: transparent; color: var(--color-muted);
  cursor: pointer; font-size: 0.82rem; font-weight: 500; font-family: var(--font);
  border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap;
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover { color: var(--color-text); }
.tab-btn.active { color: var(--color-accent); border-bottom-color: var(--color-accent); }

.detail-body { flex: 1; overflow-y: auto; padding: 1.25rem; }

/* Forms */
.form-row { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem; }
.form-row label { font-size: 0.75rem; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; }

.section-header {
  font-size: 0.75rem; font-weight: 600; color: var(--color-muted);
  text-transform: uppercase; letter-spacing: 0.05em;
  margin: 1.5rem 0 0.75rem 0; padding-bottom: 0.4rem; border-bottom: 1px solid var(--color-border);
}
.section-header:first-child { margin-top: 0; }

.danger-zone {
  margin-top: 2rem; padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
  border-radius: var(--radius); background: color-mix(in srgb, var(--color-danger) 5%, transparent);
}
.danger-zone p { margin: 0 0 0.75rem 0; font-size: 0.82rem; color: var(--color-muted); }

/* Attr / member tables */
.attr-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.attr-table th {
  text-align: left; padding: 0.4rem 0.5rem; font-size: 0.7rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted);
  border-bottom: 1px solid var(--color-border); background: transparent; position: static;
}
.attr-table td { padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.attr-table tr:last-child td { border-bottom: none; }
.attr-table tr:hover td { background: var(--color-surface); }
.attr-table input { width: 100%; }
.op-col { width: 60px; }
.priority-col { width: 70px; }
.actions-col { width: 70px; text-align: right; }

.icon-btn {
  background: none; border: none; cursor: pointer; padding: 0.2rem 0.3rem;
  border-radius: 4px; font-size: 0.85rem; color: var(--color-muted);
  transition: color 0.15s, background 0.15s;
}
.icon-btn:hover { color: var(--color-text); background: var(--color-border); }
.icon-btn.danger:hover { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 12%, transparent); }

.add-row { display: flex; gap: 0.4rem; margin-top: 0.75rem; }
.add-row input { flex: 1; }
.op-input { flex: 0 0 65px !important; }
.priority-input { flex: 0 0 70px !important; }

/* Modal */
.modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 100; align-items: center; justify-content: center; }
.modal-overlay.open { display: flex; }
.modal { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 1.5rem; width: 400px; max-width: 95vw; box-shadow: 0 20px 60px rgba(0,0,0,0.4); }
.modal-title { font-size: 1rem; font-weight: 700; margin-bottom: 1.25rem; }
.modal-footer { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--color-border); }

/* Login-type tab */
.lt-info { font-size: 0.82rem; color: var(--color-muted); line-height: 1.6; margin-bottom: 1.25rem; padding: 0.75rem 1rem; background: color-mix(in srgb, var(--color-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent); border-radius: var(--radius); }
.lt-unrestricted { font-size: 0.82rem; font-style: italic; color: var(--color-muted); margin-bottom: 0.75rem; }
.lt-card { display: flex; gap: 0.75rem; padding: 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius); margin-bottom: 0.5rem; cursor: pointer; transition: background 0.15s, border-color 0.15s; background: var(--color-surface); }
.lt-card:hover { background: var(--color-bg); }
.lt-card.selected { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
.lt-card input[type=checkbox] { margin-top: 0.15rem; flex-shrink: 0; accent-color: var(--color-primary); width: 15px; height: 15px; cursor: pointer; }
.lt-body { flex: 1; min-width: 0; }
.lt-label { font-size: 0.85rem; font-weight: 600; color: var(--color-text); margin-bottom: 0.2rem; }
.lt-desc { font-size: 0.76rem; color: var(--color-muted); line-height: 1.5; margin-bottom: 0.4rem; }
.lt-detect { font-size: 0.72rem; font-family: monospace; color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, transparent); padding: 0.15rem 0.4rem; border-radius: 3px; display: inline-block; }
.lt-vendors { display: flex; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.35rem; }
.lt-vendor { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.1rem 0.45rem; border-radius: 9999px; background: var(--color-border); color: var(--color-muted); }
.lt-vendor.mikrotik { background: color-mix(in srgb, #3b82f6 15%, transparent); color: #3b82f6; }
.lt-vendor.huawei   { background: color-mix(in srgb, #ef4444 15%, transparent); color: #ef4444; }
.lt-vendor.cisco    { background: color-mix(in srgb, #f59e0b 15%, transparent); color: #b45309; }
.lt-vendor.generic  { background: var(--color-border); color: var(--color-muted); }
.lt-save-row { margin-top: 1rem; display: flex; align-items: center; gap: 0.75rem; }
.lt-save-note { font-size: 0.76rem; color: var(--color-muted); }
`;

class GroupsView extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._groups = [];
    this._total = 0;
    this._page = 1;
    this._size = 20;
    this._search = '';
    this._order = 'asc'; // server-side group-name sort direction
    this._selected = null;
    this._detail = null;
    this._members = null;
    this._tab = 'check';
    this._renaming = false;
    this._loginTypes = null; // catalog loaded once
  }

  connectedCallback() {
    this._renderShell();
    this._loadGroups();
  }

  // ── Shell ──────────────────────────────────────────────────────────────────

  _renderShell() {
    const sr = this.shadowRoot;
    sr.innerHTML = `
      <style>${CSS}</style>
      <div class="layout">
        <div class="list-panel" id="list-panel">
          <div class="toolbar">
            <input type="search" id="search-input" class="input" placeholder="Search groups…" />
            <button class="btn btn-primary" id="btn-create">+ Create Group</button>
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
        this._loadGroups();
      }, 300);
    });

    wireDensityBar(sr, () => sr.querySelector('#list-body table'));
    sr.getElementById('btn-create').addEventListener('click', () => this._openCreateModal());
    sr.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === sr.getElementById('modal-overlay')) this._closeModal();
    });
  }

  // ── List ───────────────────────────────────────────────────────────────────

  async _loadGroups() {
    try {
      const params = new URLSearchParams({
        page: this._page,
        size: this._size,
        search: this._search,
        order: this._order,
      });
      const data = await api.get(`/groups?${params}`);
      this._groups = data.items;
      this._total = data.total;
      this._renderList();
      this._renderPagination();
    } catch {
      toast('Failed to load groups', 'error');
    }
  }

  _renderList() {
    const body = this.shadowRoot.getElementById('list-body');
    this.shadowRoot.getElementById('list-panel').classList.toggle('narrow', !!this._selected);

    if (!this._groups.length) {
      body.innerHTML = emptyStateHTML({
        title: this._search ? 'No matching groups' : 'No groups yet',
        message: this._search
          ? `Nothing matches “${this._search}”. Try a different search.`
          : 'Create your first group to get started.',
      });
      return;
    }

    body.innerHTML = `
      <table>
        <thead><tr><th data-sort-key="groupname">Group Name</th><th data-no-sort>Members</th><th data-no-sort>Check</th><th data-no-sort>Reply</th></tr></thead>
        <tbody>
          ${
      this._groups.map((g) => `
            <tr class="clickable${this._selected === g.name ? ' selected' : ''}" data-name="${
        escHtml(g.name)
      }">
              <td><strong>${escHtml(g.name)}</strong></td>
              <td><span class="count-pill"><strong>${g.member_count}</strong> users</span></td>
              <td><span class="count-pill"><strong>${g.check_count}</strong> attrs</span></td>
              <td><span class="count-pill"><strong>${g.reply_count}</strong> attrs</span></td>
            </tr>
          `).join('')
    }
        </tbody>
      </table>
    `;
    const table = body.querySelector('table');
    applyDensity(table);

    // Group name sorts server-side (the list is paginated, so a client sort
    // would only reorder the visible page); the count columns are per-page
    // aggregates and stay unsorted.
    makeSortable(table, {
      active: { key: 'groupname', dir: this._order },
      onSort: (_key, dir) => {
        this._order = dir;
        this._page = 1;
        this._loadGroups();
      },
    });

    body.querySelectorAll('tr[data-name]').forEach((row) => {
      row.addEventListener('click', () => this._selectGroup(row.dataset.name));
    });
  }

  _renderPagination() {
    const pg = this.shadowRoot.getElementById('pagination');
    const pages = Math.ceil(this._total / this._size) || 1;
    pg.innerHTML = `
      <span>${this._total} group${this._total !== 1 ? 's' : ''}</span>
      <div class="pagination-btns">
        <button class="btn btn-ghost" id="pg-prev" ${
      this._page <= 1 ? 'disabled' : ''
    }>‹ Prev</button>
        <span style="align-self:center;font-size:0.78rem">${this._page} / ${pages}</span>
        <button class="btn btn-ghost" id="pg-next" ${
      this._page >= pages ? 'disabled' : ''
    }>Next ›</button>
      </div>
    `;
    pg.querySelector('#pg-prev')?.addEventListener('click', () => {
      this._page--;
      this._loadGroups();
    });
    pg.querySelector('#pg-next')?.addEventListener('click', () => {
      this._page++;
      this._loadGroups();
    });
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  async _selectGroup(name) {
    this._selected = name;
    this._tab = 'check';
    this._members = null;
    this._renaming = false;
    this._renderList();
    const dp = this.shadowRoot.getElementById('detail-panel');
    dp.classList.add('open');
    dp.innerHTML =
      `<div class="detail-inner"><div style="padding:2rem;color:var(--color-muted);">Loading…</div></div>`;
    try {
      this._detail = await api.get(`/groups/${encodeURIComponent(name)}`);
      this._renderDetail();
    } catch {
      toast('Failed to load group detail', 'error');
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
          ${
      this._renaming
        ? `<input class="input detail-name-input" id="rename-input" value="${escHtml(d.name)}" />`
        : `<div class="detail-name">${escHtml(d.name)}</div>`
    }
          ${
      this._renaming
        ? `<button class="btn btn-primary" id="btn-rename-save">Save</button>
               <button class="btn btn-ghost" id="btn-rename-cancel">Cancel</button>`
        : `<button class="btn btn-ghost" id="btn-rename-start" title="Rename">✏️ Rename</button>`
    }
          <button class="icon-btn danger" id="btn-close-detail" title="Close">✕</button>
        </div>
        <div class="detail-tabs">
          ${
      ['check', 'reply', 'members', 'nas-access', 'login-type'].map((t) => `
            <button class="tab-btn${this._tab === t ? ' active' : ''}" data-tab="${t}">
              ${
        {
          check: 'Check Attrs',
          reply: 'Reply Attrs',
          members: `Members (${d.member_count})`,
          'nas-access': 'NAS Access',
          'login-type': 'Login Type',
        }[t]
      }
            </button>
          `).join('')
    }
        </div>
        <div class="detail-body" id="detail-body"></div>
      </div>
    `;

    dp.querySelector('#btn-close-detail').addEventListener('click', () => this._closeDetail());

    if (this._renaming) {
      dp.querySelector('#btn-rename-save').addEventListener('click', () => this._saveRename());
      dp.querySelector('#btn-rename-cancel').addEventListener('click', () => {
        this._renaming = false;
        this._renderDetail();
      });
      dp.querySelector('#rename-input').focus();
      dp.querySelector('#rename-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._saveRename();
        if (e.key === 'Escape') {
          this._renaming = false;
          this._renderDetail();
        }
      });
    } else {
      dp.querySelector('#btn-rename-start').addEventListener('click', () => {
        this._renaming = true;
        this._renderDetail();
      });
    }

    dp.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        dp.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        this._renderTab();
      });
    });

    this._renderTab();
  }

  _renderTab() {
    const body = this.shadowRoot.getElementById('detail-body');
    if (!body) return;
    switch (this._tab) {
      case 'check':
        this._renderAttrsTab(body, 'check');
        break;
      case 'reply':
        this._renderAttrsTab(body, 'reply');
        break;
      case 'members':
        this._renderMembersTab(body);
        break;
      case 'nas-access':
        this._renderNasAccessTab(body);
        break;
      case 'login-type':
        this._renderLoginTypeTab(body);
        break;
    }
  }

  // ── Attrs tab ─────────────────────────────────────────────────────────────

  _renderAttrsTab(body, type) {
    const rows = type === 'check' ? this._detail.check_attrs : this._detail.reply_attrs;
    const defaultOp = type === 'check' ? ':=' : '=';
    body.innerHTML = `
      <div class="section-header">${type === 'check' ? 'Check' : 'Reply'} Attributes</div>
      <table class="attr-table">
        <thead><tr><th>Attribute</th><th class="op-col">Op</th><th>Value</th><th class="actions-col"></th></tr></thead>
        <tbody>
          ${
      rows.map((r) => `
            <tr data-id="${r.id}">
              <td>${escHtml(r.attribute)}</td>
              <td class="op-col"><input class="input attr-op" value="${
        escHtml(r.op)
      }" style="width:55px;padding:0.25rem;" /></td>
              <td><input class="input attr-val" value="${
        escHtml(r.value)
      }" style="padding:0.25rem;" /></td>
              <td class="actions-col">
                <button class="icon-btn btn-save-attr" title="Save">💾</button>
                <button class="icon-btn danger btn-del-attr" title="Delete">🗑</button>
              </td>
            </tr>
          `).join('')
    }
        </tbody>
      </table>
      <div class="add-row">
        <input class="input" id="new-attr-name" placeholder="Attribute" />
        <input class="input op-input" id="new-attr-op" value="${defaultOp}" />
        <input class="input" id="new-attr-val" placeholder="Value" />
        <button class="btn btn-primary" id="btn-add-attr">Add</button>
      </div>

      ${
      type === 'reply'
        ? `<div id="attr-hints-placeholder" style="margin-top:1.5rem;font-size:0.78rem;color:var(--color-muted);">Loading attribute suggestions…</div>`
        : ''
    }

      <div class="danger-zone" style="margin-top:2rem;">
        <p>Permanently deletes this group and all its attributes and memberships.</p>
        <button class="btn btn-danger" id="btn-delete-group">Delete Group</button>
      </div>
    `;

    body.querySelectorAll('.btn-save-attr').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const id = parseInt(row.dataset.id);
        const op = row.querySelector('.attr-op').value;
        const value = row.querySelector('.attr-val').value;
        try {
          await api.put(`/groups/${encodeURIComponent(this._selected)}/${type}/${id}`, {
            op,
            value,
          });
          toast('Attribute updated', 'success');
          await this._refreshDetail();
        } catch (e) {
          toast(e.message || 'Update failed', 'error');
        }
      });
    });

    body.querySelectorAll('.btn-del-attr').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const id = parseInt(row.dataset.id);
        if (
          !(await confirmDialog('Delete this attribute?', {
            title: 'Delete attribute',
            danger: true,
          }))
        ) return;
        try {
          await api.delete(`/groups/${encodeURIComponent(this._selected)}/${type}/${id}`);
          toast('Attribute deleted', 'success');
          await this._refreshDetail();
        } catch (e) {
          toast(e.message || 'Delete failed', 'error');
        }
      });
    });

    body.querySelector('#btn-add-attr').addEventListener('click', async () => {
      const attr = body.querySelector('#new-attr-name').value.trim();
      const op = body.querySelector('#new-attr-op').value.trim() || defaultOp;
      const val = body.querySelector('#new-attr-val').value.trim();
      if (!attr || !val) {
        toast('Attribute and value required', 'warning');
        return;
      }
      try {
        await api.post(`/groups/${encodeURIComponent(this._selected)}/${type}`, {
          attribute: attr,
          op,
          value: val,
        });
        toast('Attribute added', 'success');
        body.querySelector('#new-attr-name').value = '';
        body.querySelector('#new-attr-val').value = '';
        await this._refreshDetail();
      } catch (e) {
        toast(e.message || 'Add failed', 'error');
      }
    });

    body.querySelector('#btn-delete-group').addEventListener('click', async () => {
      if (
        !(await confirmDialog(
          `Delete group "${this._selected}"? This removes all members and attributes.`,
          { title: 'Delete group', danger: true },
        ))
      ) return;
      try {
        await api.delete(`/groups/${encodeURIComponent(this._selected)}`);
        toast(`Group ${this._selected} deleted`, 'success');
        this._closeDetail();
        this._loadGroups();
      } catch (e) {
        toast(e.message || 'Delete failed', 'error');
      }
    });

    if (type === 'reply') this._loadAttrHints(body);
  }

  // ── Members tab ───────────────────────────────────────────────────────────

  async _renderMembersTab(body) {
    body.innerHTML =
      `<div style="color:var(--color-muted);font-size:0.85rem;padding:1rem 0;">Loading…</div>`;
    if (!this._members) {
      try {
        this._members = await api.get(`/groups/${encodeURIComponent(this._selected)}/members`);
      } catch {
        body.innerHTML =
          `<div style="color:var(--color-danger);padding:1rem;">Failed to load members.</div>`;
        return;
      }
    }
    const rows = this._members;
    body.innerHTML = `
      <div class="section-header">Members (${rows.length})</div>
      <table class="attr-table">
        <thead><tr><th>Username</th><th class="priority-col">Priority</th><th class="actions-col"></th></tr></thead>
        <tbody>
          ${
      rows.length
        ? rows.map((m) => `
            <tr data-username="${escHtml(m.username)}">
              <td>${escHtml(m.username)}</td>
              <td class="priority-col">
                <input class="input priority-val" type="number" min="0"
                  value="${m.priority}" style="width:60px;padding:0.25rem;" />
              </td>
              <td class="actions-col">
                <button class="icon-btn btn-save-priority" title="Save priority">💾</button>
                <button class="icon-btn danger btn-remove-member" title="Remove">🗑</button>
              </td>
            </tr>
          `).join('')
        : `<tr><td colspan="3" style="color:var(--color-muted);text-align:center;padding:1rem;">No members</td></tr>`
    }
        </tbody>
      </table>
      <div class="add-row" style="margin-top:0.75rem;">
        <input class="input" id="new-member-name" placeholder="Username" />
        <input class="input priority-input" id="new-member-priority" type="number" min="0" value="0" placeholder="Priority" />
        <button class="btn btn-primary" id="btn-add-member">Add</button>
      </div>
    `;

    body.querySelectorAll('.btn-save-priority').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const username = row.dataset.username;
        const priority = parseInt(row.querySelector('.priority-val').value) || 0;
        try {
          await api.put(
            `/groups/${encodeURIComponent(this._selected)}/members/${
              encodeURIComponent(username)
            }/priority?priority=${priority}`,
          );
          toast('Priority updated', 'success');
          this._members = null;
          await this._refreshDetail();
        } catch (e) {
          toast(e.message || 'Update failed', 'error');
        }
      });
    });

    body.querySelectorAll('.btn-remove-member').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const username = row.dataset.username;
        if (
          !(await confirmDialog(`Remove ${username} from ${this._selected}?`, {
            title: 'Remove member',
            danger: true,
          }))
        ) return;
        try {
          await api.delete(
            `/groups/${encodeURIComponent(this._selected)}/members/${encodeURIComponent(username)}`,
          );
          toast('Member removed', 'success');
          this._members = null;
          await this._refreshDetail();
        } catch (e) {
          toast(e.message || 'Remove failed', 'error');
        }
      });
    });

    body.querySelector('#btn-add-member').addEventListener('click', async () => {
      const username = body.querySelector('#new-member-name').value.trim();
      const priority = parseInt(body.querySelector('#new-member-priority').value) || 0;
      if (!username) {
        toast('Username required', 'warning');
        return;
      }
      try {
        await api.post(`/groups/${encodeURIComponent(this._selected)}/members`, {
          username,
          priority,
        });
        toast(`${username} added to group`, 'success');
        body.querySelector('#new-member-name').value = '';
        this._members = null;
        await this._refreshDetail();
      } catch (e) {
        toast(e.message || 'Add failed', 'error');
      }
    });
  }

  // ── NAS Access tab ────────────────────────────────────────────────────────

  async _renderNasAccessTab(body) {
    body.innerHTML =
      `<div style="color:var(--color-muted);font-size:0.85rem;padding:1rem 0;">Loading…</div>`;
    try {
      const [links, allNgData] = await Promise.all([
        api.get(`/nas/groups/links/${encodeURIComponent(this._selected)}`),
        api.get('/nas/groups/list?size=100'),
      ]);
      const linkedIds = new Set(links.map((l) => l.nas_group_id));
      const available = (allNgData.items || []).filter((g) => !linkedIds.has(g.id));

      body.innerHTML = `
        <div class="section-header">Linked NAS Groups</div>
        ${
        links.length
          ? `<table class="attr-table">
               <thead><tr><th>NAS Group</th><th class="actions-col"></th></tr></thead>
               <tbody>
                 ${
            links.map((l) => `
                   <tr data-link-id="${l.link_id}" data-ng-id="${l.nas_group_id}">
                     <td>${escHtml(l.nas_group_name)}</td>
                     <td class="actions-col">
                       <button class="icon-btn danger btn-unlink-ng" title="Unlink">🗑</button>
                     </td>
                   </tr>
                 `).join('')
          }
               </tbody>
             </table>`
          : `<p style="color:var(--color-muted);font-size:0.82rem;padding:0.5rem 0 1rem;">
               No NAS groups linked. Link a NAS group below, then this RADIUS group's reply attributes
               will receive suggestions based on the NAS vendors in that group.
             </p>`
      }
        <div class="section-header" style="margin-top:${
        links.length ? '1.5' : '0'
      }rem;">Link a NAS Group</div>
        ${
        available.length
          ? `<div class="add-row">
               <select class="input" id="ng-link-select" style="flex:1;">
                 <option value="">— select NAS group —</option>
                 ${
            available.map((g) =>
              `<option value="${g.id}">${escHtml(g.name)}${
                g.description ? ' — ' + escHtml(g.description) : ''
              }</option>`
            ).join('')
          }
               </select>
               <button class="btn btn-primary" id="btn-do-link-ng">Link</button>
             </div>`
          : `<p style="color:var(--color-muted);font-size:0.82rem;padding:0.5rem 0;">All NAS groups are already linked.</p>`
      }
      `;

      body.querySelectorAll('.btn-unlink-ng').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('tr');
          const linkId = parseInt(row.dataset.linkId);
          const ngId = parseInt(row.dataset.ngId);
          const link = links.find((l) => l.link_id === linkId);
          if (
            !(await confirmDialog(
              `Unlink this RADIUS group from NAS group "${link?.nas_group_name}"?`,
              { title: 'Unlink group', danger: true },
            ))
          ) return;
          try {
            await api.delete(`/nas/groups/${ngId}/radius-groups/${linkId}`);
            toast('NAS group unlinked', 'success');
            this._renderNasAccessTab(body);
          } catch (e) {
            toast(e.message || 'Unlink failed', 'error');
          }
        });
      });

      const linkBtn = body.querySelector('#btn-do-link-ng');
      if (linkBtn) {
        linkBtn.addEventListener('click', async () => {
          const ngId = body.querySelector('#ng-link-select')?.value;
          if (!ngId) {
            toast('Select a NAS group', 'warning');
            return;
          }
          try {
            await api.post(`/nas/groups/${ngId}/radius-groups`, {
              radius_groupname: this._selected,
            });
            toast('NAS group linked', 'success');
            this._renderNasAccessTab(body);
          } catch (e) {
            toast(e.message || 'Link failed', 'error');
          }
        });
      }
    } catch {
      body.innerHTML =
        `<div style="color:var(--color-danger);padding:1rem;">Failed to load NAS group links.</div>`;
    }
  }

  // ── Login-type tab ────────────────────────────────────────────────────────

  async _renderLoginTypeTab(body) {
    body.innerHTML =
      `<div style="color:var(--color-muted);font-size:0.85rem;padding:1rem 0;">Loading…</div>`;
    try {
      if (!this._loginTypes) {
        this._loginTypes = await api.get('/groups/login-types');
      }
      const currentTypes = new Set(this._detail.access_types || []);
      // restriction is active when the group has at least one type configured
      this._renderLoginTypeBody(body, currentTypes, currentTypes.size > 0);
    } catch {
      body.innerHTML =
        `<div style="color:var(--color-danger);padding:1rem;">Failed to load login types.</div>`;
    }
  }

  _renderLoginTypeBody(body, selected, enabled) {
    const types = this._loginTypes || [];

    body.innerHTML = `
      <div class="lt-info">
        <strong>Login-type restriction</strong> limits which connection methods members of
        this group can use. FreeRADIUS enforces this during <code>authorize</code> and rejects
        requests that don't match the allowed set.<br><br>
        <strong>Disabled</strong> → all login types are permitted.<br>
        <strong>Enabled</strong> → only the checked types are permitted; at least one is required.
      </div>

      <div class="lt-save-row" style="margin-bottom:1rem;">
        <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;cursor:pointer;">
          <input type="checkbox" id="lt-enabled-toggle" ${enabled ? 'checked' : ''}
            style="accent-color:var(--color-primary);width:16px;height:16px;" />
          <span id="lt-enabled-label" style="font-weight:600;color:${
      enabled ? 'var(--color-primary)' : 'var(--color-muted)'
    };">
            ${enabled ? 'Restriction enabled' : 'Restriction disabled'}
          </span>
        </label>
      </div>

      <div id="lt-types-wrap" style="${enabled ? '' : 'opacity:0.4;pointer-events:none;'}">
        ${
      types.map((t) => {
        const sel = selected.has(t.key);
        return `
            <label class="lt-card${sel ? ' selected' : ''}" data-key="${t.key}">
              <input type="checkbox" ${sel ? 'checked' : ''} data-key="${t.key}" />
              <div class="lt-body">
                <div class="lt-label">${escHtml(t.label)}</div>
                <div class="lt-desc">${escHtml(t.description)}</div>
                <div class="lt-detect">${escHtml(t.detect)}</div>
                <div class="lt-vendors">
                  ${t.vendors.map((v) => `<span class="lt-vendor ${v}">${v}</span>`).join('')}
                </div>
              </div>
            </label>`;
      }).join('')
    }
      </div>

      <div class="lt-save-row" style="margin-top:1rem;">
        <button class="btn btn-primary" id="btn-lt-save">Save</button>
        <span class="lt-save-note" id="lt-save-note"></span>
      </div>
    `;

    const toggleEl = body.querySelector('#lt-enabled-toggle');
    const wrapEl = body.querySelector('#lt-types-wrap');
    const labelEl = body.querySelector('#lt-enabled-label');

    toggleEl.addEventListener('change', () => {
      const on = toggleEl.checked;
      wrapEl.style.opacity = on ? '' : '0.4';
      wrapEl.style.pointerEvents = on ? '' : 'none';
      labelEl.textContent = on ? 'Restriction enabled' : 'Restriction disabled';
      labelEl.style.color = on ? 'var(--color-primary)' : 'var(--color-muted)';
      body.querySelector('#lt-save-note').textContent = '';
    });

    body.querySelectorAll('.lt-card').forEach((card) => {
      const cb = card.querySelector('input[type=checkbox]');
      card.addEventListener('click', (e) => {
        if (e.target !== cb) cb.checked = !cb.checked;
        card.classList.toggle('selected', cb.checked);
        body.querySelector('#lt-save-note').textContent = '';
      });
    });

    body.querySelector('#btn-lt-save').addEventListener('click', async () => {
      const isEnabled = body.querySelector('#lt-enabled-toggle').checked;
      const checked = [...body.querySelectorAll('#lt-types-wrap input[type=checkbox]:checked')]
        .map((c) => c.dataset.key);
      const note = body.querySelector('#lt-save-note');

      if (isEnabled && checked.length === 0) {
        note.textContent = 'Select at least one login type when restriction is enabled.';
        note.style.color = 'var(--color-danger)';
        return;
      }

      try {
        const result = await api.put(
          `/groups/${encodeURIComponent(this._selected)}/access-types`,
          { enabled: isEnabled, types: checked },
        );
        this._detail.access_types = result.types;
        note.textContent = isEnabled
          ? `Saved — ${checked.length} type(s) allowed`
          : 'Saved — no restrictions';
        note.style.color = 'var(--color-success)';
        this._renderLoginTypeBody(body, new Set(result.types), result.enabled);
        toast('Login type restrictions saved', 'success');
      } catch (e) {
        note.textContent = e.message || 'Save failed';
        note.style.color = 'var(--color-danger)';
      }
    });
  }

  // ── Attribute hints (reply tab) ───────────────────────────────────────────

  async _loadAttrHints(body) {
    const placeholder = body.querySelector('#attr-hints-placeholder');
    if (!placeholder) return;
    try {
      const data = await api.get(`/nas/groups/hints/${encodeURIComponent(this._selected)}`);
      const current = body.querySelector('#attr-hints-placeholder');
      if (!current) return; // tab changed while loading

      if (!data.hints || !data.hints.length) {
        current.innerHTML =
          `💡 Link NAS groups in the <strong>NAS Access</strong> tab to see vendor-specific attribute suggestions here.`;
        return;
      }

      const vendorList = data.vendors.length ? data.vendors.join(', ') : 'standard';
      const ngList = data.nas_groups.length
        ? ` — via: ${data.nas_groups.map((n) => escHtml(n)).join(', ')}`
        : '';

      const wrapper = document.createElement('div');
      wrapper.style.marginTop = '1.5rem';
      wrapper.innerHTML = `
        <div class="section-header" style="display:flex;align-items:baseline;gap:0.75rem;">
          <span>💡 Suggested Reply Attributes</span>
          <span style="font-weight:400;font-size:0.7rem;text-transform:none;letter-spacing:0;color:var(--color-muted);">${
        escHtml(vendorList)
      }${ngList}</span>
        </div>
        <table class="attr-table">
          <thead>
            <tr>
              <th>Attribute</th>
              <th class="op-col">Op</th>
              <th>Example Value</th>
              <th>Description</th>
              <th class="actions-col"></th>
            </tr>
          </thead>
          <tbody>
            ${
        data.hints.map((h) => `
              <tr data-attr="${escHtml(h.attribute)}" data-op="${escHtml(h.op)}" data-val="${
          escHtml(h.example)
        }">
                <td>
                  <span class="badge badge-${
          h.vendor === 'standard' ? 'neutral' : 'accent'
        }" style="margin-right:0.3rem;">${escHtml(h.vendor)}</span>
                  ${escHtml(h.attribute)}
                </td>
                <td class="op-col" style="font-family:monospace;font-size:0.78rem;">${
          escHtml(h.op)
        }</td>
                <td><code style="font-size:0.75rem;font-family:monospace;">${
          escHtml(h.example)
        }</code></td>
                <td style="font-size:0.75rem;color:var(--color-muted);">${
          escHtml(h.description)
        }</td>
                <td class="actions-col">
                  <button class="icon-btn btn-hint-insert" title="Insert into add form">⤵</button>
                </td>
              </tr>
            `).join('')
      }
          </tbody>
        </table>
      `;

      wrapper.querySelectorAll('.btn-hint-insert').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = btn.closest('tr');
          const nameEl = body.querySelector('#new-attr-name');
          const opEl = body.querySelector('#new-attr-op');
          const valEl = body.querySelector('#new-attr-val');
          if (nameEl) nameEl.value = row.dataset.attr;
          if (opEl) opEl.value = row.dataset.op;
          if (valEl) valEl.value = row.dataset.val;
          nameEl?.focus();
        });
      });

      current.replaceWith(wrapper);
    } catch {
      const p = body.querySelector('#attr-hints-placeholder');
      if (p) p.textContent = '💡 Could not load attribute suggestions.';
    }
  }

  // ── Create modal ──────────────────────────────────────────────────────────

  _openCreateModal() {
    const overlay = this.shadowRoot.getElementById('modal-overlay');
    const box = this.shadowRoot.getElementById('modal-box');
    box.innerHTML = `
      <div class="modal-title">Create Group</div>
      <div class="form-row">
        <label>Group Name</label>
        <input class="input" id="m-name" type="text" autocomplete="off" placeholder="e.g. pppoe-users" />
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-submit">Create</button>
      </div>
    `;
    overlay.classList.add('open');

    box.querySelector('#btn-cancel').addEventListener('click', () => this._closeModal());
    box.querySelector('#btn-submit').addEventListener('click', () => this._submitCreate());
    box.querySelector('#m-name').focus();
    box.querySelector('#m-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitCreate();
    });
  }

  async _submitCreate() {
    const box = this.shadowRoot.getElementById('modal-box');
    const nEl = box.querySelector('#m-name');
    const name = nEl.value.trim();
    clearFieldErrors(box);
    if (!name) {
      setFieldError(nEl, 'Group name is required');
      return;
    }
    try {
      await api.post('/groups', { name });
      toast(`Group ${name} created`, 'success');
      this._closeModal();
      this._loadGroups();
    } catch (e) {
      if (!applyServerErrors(box, e)) toast(e.message || 'Create failed', 'error');
    }
  }

  _closeModal() {
    this.shadowRoot.getElementById('modal-overlay').classList.remove('open');
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async _saveRename() {
    const dp = this.shadowRoot.getElementById('detail-panel');
    const newName = dp.querySelector('#rename-input')?.value.trim();
    if (!newName) {
      toast('Group name required', 'warning');
      return;
    }
    if (newName === this._selected) {
      this._renaming = false;
      this._renderDetail();
      return;
    }
    try {
      await api.put(`/groups/${encodeURIComponent(this._selected)}/rename`, { name: newName });
      toast(`Renamed to ${newName}`, 'success');
      const oldName = this._selected;
      this._selected = newName;
      this._renaming = false;
      this._detail.name = newName;
      this._renderDetail();
      // Update list row in place
      this._groups = this._groups.map((g) => g.name === oldName ? { ...g, name: newName } : g);
      this._renderList();
    } catch (e) {
      toast(e.message || 'Rename failed', 'error');
    }
  }

  async _refreshDetail() {
    this._detail = await api.get(`/groups/${encodeURIComponent(this._selected)}`);
    this._members = null;
    this._renderDetail();
  }

  _closeDetail() {
    this._selected = null;
    this._detail = null;
    this._members = null;
    this._renaming = false;
    const dp = this.shadowRoot.getElementById('detail-panel');
    dp.classList.remove('open');
    dp.innerHTML = '';
    this._renderList();
  }
}

customElements.define('groups-view', GroupsView);

router.register('/groups', () => document.createElement('groups-view'));
