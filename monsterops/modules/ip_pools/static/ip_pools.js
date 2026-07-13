import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { emptyStateHTML, skeletonRows, skeletonBlock } from '/js/utils/empty.js';
import { setFieldError, clearFieldErrors, applyServerErrors } from '/js/utils/form.js';

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  if (d < now) return `<span style="color:var(--color-danger)">Expired ${d.toLocaleString()}</span>`;
  return d.toLocaleString();
}

class IpPoolsView extends HTMLElement {
  constructor() {
    super();
    this._pools = [];
    this._selected = null;   // pool_name string
    this._entries = [];
    this._filter = 'all';    // 'all' | 'assigned' | 'free'
    this._offset = 0;
    this._pageSize = 500;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
    this._loadPools();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        @import '/css/theme.css';

        :host { display: block; }

        .layout {
          display: grid;
          grid-template-columns: 260px 1fr;
          gap: 1rem;
          height: calc(100vh - 120px);
        }

        /* ── Left panel ── */
        .left-panel {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .panel-header {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--color-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          flex-shrink: 0;
        }

        .panel-title {
          font-size: 0.8rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-muted);
        }

        .pool-list { overflow-y: auto; flex: 1; }

        .pool-item {
          padding: 0.65rem 1rem;
          cursor: pointer;
          border-bottom: 1px solid var(--color-border);
          transition: background 0.1s;
        }
        .pool-item:hover { background: var(--color-bg); }
        .pool-item.active { background: color-mix(in srgb, var(--color-accent) 10%, transparent); border-left: 2px solid var(--color-accent); }

        .pool-item-name { font-weight: 500; font-size: 0.9rem; color: var(--color-text); }
        .pool-item-stats { font-size: 0.75rem; color: var(--color-muted); margin-top: 0.25rem; }

        .usage-bar {
          height: 3px;
          background: var(--color-border);
          border-radius: 2px;
          margin-top: 0.35rem;
          overflow: hidden;
        }
        .usage-bar-fill { height: 100%; background: var(--color-accent); border-radius: 2px; }

        .empty-list {
          padding: 2rem 1rem;
          text-align: center;
          color: var(--color-muted);
          font-size: 0.85rem;
        }

        /* ── Right panel ── */
        .right-panel {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .detail-header {
          padding: 0.75rem 1rem;
          border-bottom: 1px solid var(--color-border);
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex-shrink: 0;
          flex-wrap: wrap;
        }

        .detail-title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--color-text);
          flex: 1;
        }

        .detail-body { flex: 1; overflow-y: auto; }

        .filter-bar {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.6rem 1rem;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-bg);
          flex-shrink: 0;
          flex-wrap: wrap;
        }

        .filter-btn {
          padding: 0.25rem 0.7rem;
          border: 1px solid var(--color-border);
          background: transparent;
          color: var(--color-muted);
          border-radius: 9999px;
          cursor: pointer;
          font-size: 0.78rem;
          font-weight: 500;
          font-family: var(--font);
          transition: all 0.15s;
        }
        .filter-btn:hover { color: var(--color-text); }
        .filter-btn.active { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }

        .filter-count { font-size: 0.78rem; color: var(--color-muted); margin-left: auto; }

        /* ── Table ── */
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }

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
          position: sticky;
          top: 0;
          z-index: 1;
        }

        td {
          padding: 0.45rem 0.75rem;
          border-bottom: 1px solid var(--color-border);
          color: var(--color-text);
          vertical-align: middle;
        }

        tr:last-child td { border-bottom: none; }
        tr:hover td { background: color-mix(in srgb, var(--color-bg) 60%, transparent); }

        .badge {
          display: inline-block;
          padding: 0.15rem 0.55rem;
          border-radius: 9999px;
          font-size: 0.7rem;
          font-weight: 600;
        }
        .badge-free     { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); }
        .badge-assigned { background: color-mix(in srgb, var(--color-accent) 15%, transparent);  color: var(--color-accent); }

        .empty-state {
          padding: 3rem;
          text-align: center;
          color: var(--color-muted);
          font-size: 0.85rem;
        }

        .placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          gap: 0.75rem;
          color: var(--color-muted);
          font-size: 0.9rem;
        }

        /* ── Buttons ── */
        .btn {
          padding: 0.35rem 0.85rem;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          color: var(--color-text);
          border-radius: var(--radius);
          cursor: pointer;
          font-size: 0.8rem;
          font-weight: 500;
          font-family: var(--font);
          transition: background 0.15s, border-color 0.15s;
          white-space: nowrap;
        }
        .btn:hover { background: var(--color-bg); }
        .btn-primary { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
        .btn-primary:hover { opacity: 0.88; background: var(--color-accent); }
        .btn-danger { border-color: var(--color-danger); color: var(--color-danger); }
        .btn-danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
        .btn-sm { padding: 0.2rem 0.55rem; font-size: 0.75rem; }
        .btn-warn { border-color: color-mix(in srgb, orange 60%, transparent); color: orange; }
        .btn-warn:hover { background: color-mix(in srgb, orange 10%, transparent); }

        /* ── Modal ── */
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
          width: 480px;
          max-width: 90vw;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }

        .modal-title {
          font-size: 1rem;
          font-weight: 600;
          color: var(--color-text);
          margin-bottom: 1rem;
        }

        .form-group { margin-bottom: 0.9rem; }

        label {
          display: block;
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--color-muted);
          margin-bottom: 0.3rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        input[type=text] {
          width: 100%;
          padding: 0.5rem 0.75rem;
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          color: var(--color-text);
          font-size: 0.875rem;
          font-family: var(--font);
          box-sizing: border-box;
          transition: border-color 0.15s;
        }
        input[type=text]:focus { outline: none; border-color: var(--color-accent); }

        .mode-toggle {
          display: flex;
          gap: 0.25rem;
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: var(--radius);
          padding: 0.2rem;
          margin-bottom: 0.75rem;
          width: fit-content;
        }

        .mode-btn {
          padding: 0.3rem 0.8rem;
          border: none;
          background: transparent;
          color: var(--color-muted);
          border-radius: calc(var(--radius) - 2px);
          cursor: pointer;
          font-size: 0.8rem;
          font-weight: 500;
          font-family: var(--font);
          transition: all 0.15s;
        }
        .mode-btn.active { background: var(--color-accent); color: #fff; }

        .range-row { display: flex; gap: 0.5rem; align-items: center; }
        .range-sep { color: var(--color-muted); font-size: 0.85rem; flex-shrink: 0; }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          margin-top: 1.25rem;
        }

        .hint { font-size: 0.75rem; color: var(--color-muted); margin-top: 0.25rem; }

        .pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.75rem;
          border-top: 1px solid var(--color-border);
          flex-shrink: 0;
        }
      </style>

      <div class="layout">
        <!-- Left panel: pool list -->
        <div class="left-panel">
          <div class="panel-header">
            <span class="panel-title">IP Pools</span>
            <button class="btn btn-primary btn-sm" id="btn-new-pool">+ New</button>
          </div>
          <div class="pool-list" id="pool-list">
            <div class="empty-list">Loading…</div>
          </div>
        </div>

        <!-- Right panel: pool detail -->
        <div class="right-panel" id="right-panel">
          <div class="placeholder" id="placeholder">
            <div style="font-size:2rem;">🌐</div>
            <div>Select a pool to view its addresses</div>
          </div>
          <div id="detail-view" style="display:none;display:flex;flex-direction:column;height:100%;">
            <div class="detail-header">
              <span class="detail-title" id="detail-title"></span>
              <button class="btn btn-sm" id="btn-add-ips">+ Add IPs</button>
              <button class="btn btn-sm" id="btn-rename">Rename</button>
              <button class="btn btn-sm btn-danger" id="btn-delete-pool">Delete Pool</button>
            </div>
            <div class="filter-bar">
              <button class="filter-btn active" data-f="all">All</button>
              <button class="filter-btn" data-f="assigned">Assigned</button>
              <button class="filter-btn" data-f="free">Free</button>
              <span class="filter-count" id="filter-count"></span>
              <button class="btn btn-sm" id="btn-refresh-entries" style="margin-left:auto;">↻</button>
            </div>
            <div class="detail-body" id="entries-body">
              <div class="empty-state">Loading…</div>
            </div>
            <div class="pagination" id="pagination" style="display:none;">
              <button class="btn btn-sm" id="btn-prev">← Prev</button>
              <span id="page-info" style="font-size:0.8rem;color:var(--color-muted);"></span>
              <button class="btn btn-sm" id="btn-next">Next →</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal: create pool -->
      <div class="modal-overlay" id="modal-create">
        <div class="modal">
          <div class="modal-title">Create IP Pool</div>
          <div class="form-group">
            <label>Pool Name</label>
            <input type="text" id="c-pool-name" placeholder="e.g. pppoe-pool">
          </div>
          <div class="mode-toggle">
            <button class="mode-btn active" data-mode="cidr" id="c-mode-cidr">CIDR</button>
            <button class="mode-btn" data-mode="range" id="c-mode-range">IP Range</button>
          </div>
          <div class="form-group" id="c-cidr-field">
            <label>CIDR</label>
            <input type="text" id="c-cidr" placeholder="e.g. 10.100.0.0/24">
            <div class="hint">Hosts only — network and broadcast addresses excluded.</div>
          </div>
          <div class="form-group" id="c-range-field" style="display:none;">
            <label>IP Range</label>
            <div class="range-row">
              <input type="text" id="c-start-ip" placeholder="10.100.0.1">
              <span class="range-sep">—</span>
              <input type="text" id="c-end-ip" placeholder="10.100.0.254">
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn" id="c-cancel">Cancel</button>
            <button class="btn btn-primary" id="c-submit">Create Pool</button>
          </div>
        </div>
      </div>

      <!-- Modal: add IPs -->
      <div class="modal-overlay" id="modal-add-ips">
        <div class="modal">
          <div class="modal-title" id="add-ips-title">Add IPs</div>
          <div class="mode-toggle">
            <button class="mode-btn active" data-mode="cidr" id="a-mode-cidr">CIDR</button>
            <button class="mode-btn" data-mode="range" id="a-mode-range">IP Range</button>
          </div>
          <div class="form-group" id="a-cidr-field">
            <label>CIDR</label>
            <input type="text" id="a-cidr" placeholder="e.g. 10.100.1.0/24">
            <div class="hint">Existing IPs in the pool are silently skipped.</div>
          </div>
          <div class="form-group" id="a-range-field" style="display:none;">
            <label>IP Range</label>
            <div class="range-row">
              <input type="text" id="a-start-ip" placeholder="10.100.1.1">
              <span class="range-sep">—</span>
              <input type="text" id="a-end-ip" placeholder="10.100.1.254">
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn" id="a-cancel">Cancel</button>
            <button class="btn btn-primary" id="a-submit">Add IPs</button>
          </div>
        </div>
      </div>

      <!-- Modal: rename pool -->
      <div class="modal-overlay" id="modal-rename">
        <div class="modal">
          <div class="modal-title">Rename Pool</div>
          <div class="form-group">
            <label>New Name</label>
            <input type="text" id="r-new-name" placeholder="new-pool-name">
          </div>
          <div class="modal-actions">
            <button class="btn" id="r-cancel">Cancel</button>
            <button class="btn btn-primary" id="r-submit">Rename</button>
          </div>
        </div>
      </div>
    `;

    this._bindStaticEvents();
  }

  _bindStaticEvents() {
    const sr = this.shadowRoot;

    // New pool modal
    sr.getElementById('btn-new-pool').addEventListener('click', () => this._openModal('modal-create'));
    sr.getElementById('c-cancel').addEventListener('click', () => this._closeModal('modal-create'));
    sr.getElementById('c-submit').addEventListener('click', () => this._submitCreatePool());
    this._bindModeToggle('c-mode-cidr', 'c-mode-range', 'c-cidr-field', 'c-range-field');

    // Add IPs modal
    sr.getElementById('a-cancel').addEventListener('click', () => this._closeModal('modal-add-ips'));
    sr.getElementById('a-submit').addEventListener('click', () => this._submitAddIPs());
    this._bindModeToggle('a-mode-cidr', 'a-mode-range', 'a-cidr-field', 'a-range-field');

    // Rename modal
    sr.getElementById('r-cancel').addEventListener('click', () => this._closeModal('modal-rename'));
    sr.getElementById('r-submit').addEventListener('click', () => this._submitRename());

    // Detail header buttons
    sr.getElementById('btn-add-ips').addEventListener('click', () => {
      sr.getElementById('add-ips-title').textContent = `Add IPs to "${this._selected}"`;
      this._openModal('modal-add-ips');
    });
    sr.getElementById('btn-rename').addEventListener('click', () => {
      sr.getElementById('r-new-name').value = this._selected ?? '';
      this._openModal('modal-rename');
    });
    sr.getElementById('btn-delete-pool').addEventListener('click', () => this._confirmDeletePool());
    sr.getElementById('btn-refresh-entries').addEventListener('click', () => this._loadEntries());

    // Filter buttons
    sr.querySelectorAll('.filter-btn[data-f]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._filter = btn.dataset.f;
        this._offset = 0;
        sr.querySelectorAll('.filter-btn[data-f]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._loadEntries();
      });
    });

    // Close modals when clicking overlay
    ['modal-create', 'modal-add-ips', 'modal-rename'].forEach(id => {
      sr.getElementById(id).addEventListener('click', (e) => {
        if (e.target.id === id) this._closeModal(id);
      });
    });

    // Enter key on inputs submits the active modal
    sr.getElementById('c-pool-name').addEventListener('keydown', e => { if (e.key === 'Enter') this._submitCreatePool(); });
    sr.getElementById('r-new-name').addEventListener('keydown', e => { if (e.key === 'Enter') this._submitRename(); });

    // Pagination
    sr.getElementById('btn-prev').addEventListener('click', () => {
      if (this._offset > 0) { this._offset = Math.max(0, this._offset - this._pageSize); this._loadEntries(); }
    });
    sr.getElementById('btn-next').addEventListener('click', () => {
      this._offset += this._pageSize;
      this._loadEntries();
    });
  }

  _bindModeToggle(cidrBtnId, rangeBtnId, cidrFieldId, rangeFieldId) {
    const sr = this.shadowRoot;
    sr.getElementById(cidrBtnId).addEventListener('click', () => {
      sr.getElementById(cidrBtnId).classList.add('active');
      sr.getElementById(rangeBtnId).classList.remove('active');
      sr.getElementById(cidrFieldId).style.display = '';
      sr.getElementById(rangeFieldId).style.display = 'none';
    });
    sr.getElementById(rangeBtnId).addEventListener('click', () => {
      sr.getElementById(rangeBtnId).classList.add('active');
      sr.getElementById(cidrBtnId).classList.remove('active');
      sr.getElementById(rangeFieldId).style.display = '';
      sr.getElementById(cidrFieldId).style.display = 'none';
    });
  }

  _openModal(id) {
    this.shadowRoot.getElementById(id).classList.add('open');
  }

  _closeModal(id) {
    this.shadowRoot.getElementById(id).classList.remove('open');
  }

  // ── Pool list ────────────────────────────────────────────────────────────────

  async _loadPools() {
    if (!this._pools.length) {
      this.shadowRoot.getElementById('pool-list').innerHTML = skeletonBlock(this.shadowRoot, 6);
    }
    try {
      this._pools = await api.get('/ip-pools');
      this._renderPools();
    } catch {
      toast('Failed to load IP pools', 'error');
    }
  }

  _renderPools() {
    const list = this.shadowRoot.getElementById('pool-list');
    if (!this._pools.length) {
      list.innerHTML = emptyStateHTML({
        title: 'No pools yet',
        message: 'Click + New to create your first IP pool.',
      });
      return;
    }
    list.innerHTML = this._pools.map(p => {
      const pct = p.total > 0 ? Math.round(p.assigned / p.total * 100) : 0;
      const active = p.pool_name === this._selected ? 'active' : '';
      return `
        <div class="pool-item ${active}" data-pool="${escHtml(p.pool_name)}">
          <div class="pool-item-name">${escHtml(p.pool_name)}</div>
          <div class="pool-item-stats">${p.assigned} / ${p.total} assigned</div>
          <div class="usage-bar"><div class="usage-bar-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.pool-item').forEach(el => {
      el.addEventListener('click', () => this._selectPool(el.dataset.pool));
    });
  }

  async _selectPool(name) {
    this._selected = name;
    this._offset = 0;
    this._filter = 'all';

    // Update active state in list
    this.shadowRoot.querySelectorAll('.pool-item').forEach(el => {
      el.classList.toggle('active', el.dataset.pool === name);
    });

    // Reset filter UI
    this.shadowRoot.querySelectorAll('.filter-btn[data-f]').forEach(b => {
      b.classList.toggle('active', b.dataset.f === 'all');
    });

    this.shadowRoot.getElementById('detail-title').textContent = name;
    this.shadowRoot.getElementById('placeholder').style.display = 'none';
    this.shadowRoot.getElementById('detail-view').style.display = 'flex';

    await this._loadEntries();
  }

  // ── Entries ──────────────────────────────────────────────────────────────────

  async _loadEntries() {
    if (!this._selected) return;
    const body = this.shadowRoot.getElementById('entries-body');
    body.innerHTML = `<table>
      <thead><tr>
        <th>IP Address</th><th>Status</th><th>User</th><th>NAS</th><th>Expires</th><th style="width:120px;"></th>
      </tr></thead>
      <tbody>${skeletonRows(this.shadowRoot, 6, 8)}</tbody>
    </table>`;
    try {
      const params = new URLSearchParams({
        status: this._filter,
        limit: this._pageSize,
        offset: this._offset,
      });
      this._entries = await api.get(`/ip-pools/${encodeURIComponent(this._selected)}/entries?${params}`);
      this._renderEntries();
    } catch {
      body.innerHTML = emptyStateHTML({
        title: 'Couldn’t load entries',
        message: 'Something went wrong loading this pool. Try refreshing.',
      });
    }
  }

  _renderEntries() {
    const body = this.shadowRoot.getElementById('entries-body');
    const countEl = this.shadowRoot.getElementById('filter-count');
    const pager = this.shadowRoot.getElementById('pagination');
    const pageInfo = this.shadowRoot.getElementById('page-info');
    const btnPrev = this.shadowRoot.getElementById('btn-prev');
    const btnNext = this.shadowRoot.getElementById('btn-next');

    const page = Math.floor(this._offset / this._pageSize) + 1;
    const hasMore = this._entries.length === this._pageSize;
    const hasPrev = this._offset > 0;

    countEl.textContent = this._entries.length
      ? `${this._offset + 1}–${this._offset + this._entries.length} shown`
      : '';

    if (hasMore || hasPrev) {
      pager.style.display = '';
      pageInfo.textContent = `Page ${page}`;
      btnPrev.disabled = !hasPrev;
      btnNext.disabled = !hasMore;
    } else {
      pager.style.display = 'none';
    }

    if (!this._entries.length) {
      body.innerHTML = emptyStateHTML({
        title: 'No matching addresses',
        message: this._filter === 'all'
          ? 'This pool has no addresses yet. Use + Add IPs to populate it.'
          : 'No addresses match this filter. Try a different status.',
      });
      return;
    }

    body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>IP Address</th>
            <th>Status</th>
            <th>User</th>
            <th>NAS</th>
            <th>Expires</th>
            <th style="width:120px;"></th>
          </tr>
        </thead>
        <tbody>
          ${this._entries.map(e => {
            const nas = (e.nasipaddress && e.nasipaddress !== '0.0.0.0') ? escHtml(e.nasipaddress) : '—';
            const statusBadge = e.assigned
              ? `<span class="badge badge-assigned">In Use</span>`
              : `<span class="badge badge-free">Free</span>`;
            const actions = e.assigned
              ? `<button class="btn btn-sm btn-warn" data-action="release" data-id="${e.id}">Release</button>
                 <button class="btn btn-sm btn-danger" data-action="remove" data-id="${e.id}" style="margin-left:4px;">✕</button>`
              : `<button class="btn btn-sm btn-danger" data-action="remove" data-id="${e.id}">✕</button>`;
            return `
              <tr>
                <td style="font-weight:500;font-family:monospace;">${escHtml(e.framedipaddress)}</td>
                <td>${statusBadge}</td>
                <td style="color:var(--color-muted);">${escHtml(e.username) || '—'}</td>
                <td style="color:var(--color-muted);font-family:monospace;font-size:0.8rem;">${nas}</td>
                <td style="font-size:0.78rem;">${fmtDate(e.expiry_time)}</td>
                <td>${actions}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    body.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        if (btn.dataset.action === 'release') this._releaseIP(id);
        if (btn.dataset.action === 'remove')  this._removeIP(id);
      });
    });
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  async _submitCreatePool() {
    const sr = this.shadowRoot;
    clearFieldErrors(sr);
    const nameInput = sr.getElementById('c-pool-name');
    const name = nameInput.value.trim();
    let ok = true;
    if (!name) { setFieldError(nameInput, 'Pool name is required'); ok = false; }

    const isCidr = sr.getElementById('c-mode-cidr').classList.contains('active');
    const body = { pool_name: name };
    if (isCidr) {
      const cidrInput = sr.getElementById('c-cidr');
      body.cidr = cidrInput.value.trim();
      if (!body.cidr) { setFieldError(cidrInput, 'Enter a CIDR range'); ok = false; }
    } else {
      const startInput = sr.getElementById('c-start-ip');
      const endInput = sr.getElementById('c-end-ip');
      body.start_ip = startInput.value.trim();
      body.end_ip   = endInput.value.trim();
      if (!body.start_ip) { setFieldError(startInput, 'Enter a start IP'); ok = false; }
      if (!body.end_ip)   { setFieldError(endInput, 'Enter an end IP'); ok = false; }
    }
    if (!ok) return;

    try {
      const res = await api.post('/ip-pools', body);
      toast(`Pool "${name}" created with ${res.ips_added} IPs`, 'success');
      this._closeModal('modal-create');
      nameInput.value = '';
      sr.getElementById('c-cidr').value = '';
      await this._loadPools();
      await this._selectPool(name);
    } catch (e) {
      const resolve = (f) => sr.getElementById({
        pool_name: 'c-pool-name', cidr: 'c-cidr', start_ip: 'c-start-ip', end_ip: 'c-end-ip',
      }[f]);
      // Prefer FastAPI 422 field errors; the endpoint otherwise raises string-detail
      // HTTPExceptions ("… already exists", "Invalid CIDR: …") — map those to a field too.
      if (applyServerErrors(sr, e, resolve)) return;
      const msg = e.message ?? 'Failed to create pool';
      if (/already exists/i.test(msg)) setFieldError(nameInput, msg);
      else if (/CIDR/i.test(msg) && isCidr) setFieldError(sr.getElementById('c-cidr'), msg);
      else toast(msg, 'error');
    }
  }

  async _submitAddIPs() {
    const sr = this.shadowRoot;
    const isCidr = sr.getElementById('a-mode-cidr').classList.contains('active');
    const body = {};
    if (isCidr) {
      body.cidr = sr.getElementById('a-cidr').value.trim();
      if (!body.cidr) { toast('Enter a CIDR', 'error'); return; }
    } else {
      body.start_ip = sr.getElementById('a-start-ip').value.trim();
      body.end_ip   = sr.getElementById('a-end-ip').value.trim();
      if (!body.start_ip || !body.end_ip) { toast('Enter start and end IP', 'error'); return; }
    }

    try {
      const res = await api.post(`/ip-pools/${encodeURIComponent(this._selected)}/ips`, body);
      const msg = res.skipped
        ? `Added ${res.ips_added} IPs (${res.skipped} duplicates skipped)`
        : `Added ${res.ips_added} IPs`;
      toast(msg, 'success');
      this._closeModal('modal-add-ips');
      sr.getElementById('a-cidr').value = '';
      await this._loadPools();
      await this._loadEntries();
    } catch (e) {
      toast(e.message ?? 'Failed to add IPs', 'error');
    }
  }

  async _submitRename() {
    const newName = this.shadowRoot.getElementById('r-new-name').value.trim();
    if (!newName) { toast('Pool name is required', 'error'); return; }
    if (newName === this._selected) { this._closeModal('modal-rename'); return; }

    try {
      await api.patch(`/ip-pools/${encodeURIComponent(this._selected)}`, { new_name: newName });
      toast(`Renamed to "${newName}"`, 'success');
      this._closeModal('modal-rename');
      const old = this._selected;
      this._selected = newName;
      await this._loadPools();
      this.shadowRoot.getElementById('detail-title').textContent = newName;
      // Re-select to highlight correct row
      this.shadowRoot.querySelectorAll('.pool-item').forEach(el => {
        el.classList.toggle('active', el.dataset.pool === newName);
      });
    } catch (e) {
      toast(e.message ?? 'Failed to rename pool', 'error');
    }
  }

  async _confirmDeletePool() {
    const name = this._selected;
    if (!(await confirmDialog(`Delete pool "${name}" and all its ${this._pools.find(p => p.pool_name === name)?.total ?? '?'} IPs?\n\nThis cannot be undone.`, { title: 'Delete pool', danger: true }))) return;

    try {
      await api.delete(`/ip-pools/${encodeURIComponent(name)}`);
      toast(`Pool "${name}" deleted`, 'success');
      this._selected = null;
      this.shadowRoot.getElementById('detail-view').style.display = 'none';
      this.shadowRoot.getElementById('placeholder').style.display = '';
      await this._loadPools();
    } catch (e) {
      toast(e.message ?? 'Failed to delete pool', 'error');
    }
  }

  async _releaseIP(id) {
    try {
      await api.post(`/ip-pools/${encodeURIComponent(this._selected)}/entries/${id}/release`, {});
      const entry = this._entries.find(e => e.id === id);
      toast(`Released ${entry?.framedipaddress ?? 'IP'}`, 'success');
      await this._loadPools();
      await this._loadEntries();
    } catch (e) {
      toast(e.message ?? 'Failed to release IP', 'error');
    }
  }

  async _removeIP(id) {
    const entry = this._entries.find(e => e.id === id);
    const ip = entry?.framedipaddress ?? 'this IP';
    if (entry?.assigned && !(await confirmDialog(`${ip} is currently assigned to "${entry.username}". Remove it from the pool anyway?`, { title: 'Remove IP', danger: true }))) return;

    try {
      await api.delete(`/ip-pools/${encodeURIComponent(this._selected)}/entries/${id}`);
      toast(`Removed ${ip}`, 'success');
      await this._loadPools();
      await this._loadEntries();
    } catch (e) {
      toast(e.message ?? 'Failed to remove IP', 'error');
    }
  }
}

customElements.define('ip-pools-view', IpPoolsView);
router.register('/ip-pools', () => document.createElement('ip-pools-view'));
