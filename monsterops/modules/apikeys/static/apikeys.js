import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { emptyStateHTML, skeletonRows } from '/js/utils/empty.js';
import { applyServerErrors, clearFieldErrors, setFieldError } from '/js/utils/form.js';

// The list header, reused for both the populated table and the loading skeleton
// so the table keeps its shape while it loads instead of collapsing.
const KEYS_THEAD = '<thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last Used</th>' +
  '<th>Expires</th><th>Status</th><th></th></tr></thead>';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(
    /"/g,
    '&quot;',
  );
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

const SCOPES = [
  { id: 'sessions.read', label: 'Sessions — read active sessions' },
  { id: 'users.read', label: 'Users — read user profiles & groups' },
  { id: 'coa.send', label: 'CoA — send disconnect/change-of-auth requests' },
  { id: 'auth_logs.read', label: 'Auth Logs — read authentication history' },
];

const STYLE = `
  @import '/css/theme.css';
  :host { display: block; padding: 1.5rem; }
  /* Embedded inside the System page tab: the tab already supplies padding + a
     heading, so drop ours and keep just the "+ New API Key" action on the right. */
  :host([embedded]) { padding: 0; }
  :host([embedded]) .page-title { display: none; }
  :host([embedded]) .page-header { justify-content: flex-end; margin-bottom: 1rem; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; }
  .page-title  { font-size: 1.25rem; font-weight: 600; }
  .btn { padding: 0.4rem 0.85rem; border: 1px solid var(--color-border); border-radius: var(--radius);
         background: var(--color-surface); color: var(--color-text); font-size: 0.82rem; font-family: var(--font);
         cursor: pointer; white-space: nowrap; }
  .btn:hover { background: var(--color-bg); }
  .btn-primary { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
  .btn-primary:hover { opacity: 0.88; }
  .btn-danger { border-color: var(--color-danger); color: var(--color-danger); }
  .btn-danger:hover { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }
  .btn-sm { padding: 0.2rem 0.55rem; font-size: 0.75rem; }
  .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  th { text-align: left; padding: 0.45rem 0.75rem; font-size: 0.7rem; font-weight: 600;
       text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted);
       border-bottom: 1px solid var(--color-border); background: var(--color-bg); }
  td { padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: color-mix(in srgb, var(--color-accent) 4%, transparent); }
  .badge { display: inline-block; padding: 0.12rem 0.45rem; border-radius: 9999px; font-size: 0.68rem; font-weight: 600; }
  .badge-ok  { background: var(--mr-accept-tint); color: var(--mr-accept); }
  .badge-off { background: rgba(139,149,165,0.12); color: var(--mr-text-muted); }
  code { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px;
         padding: 0.2rem 0.45rem; font-size: 0.8rem; font-family: monospace; }
  .info-box { background: color-mix(in srgb, var(--color-accent) 8%, transparent);
              border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
              border-radius: var(--radius); padding: 1rem 1.25rem; margin-bottom: 1.25rem; font-size: 0.83rem; }
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 500;
                   align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius);
           padding: 1.5rem; min-width: 400px; max-width: 520px; width: 90vw; max-height: 90vh; overflow-y: auto; }
  .modal-header { display: flex; align-items: center; margin-bottom: 1.25rem; }
  .modal-title  { font-size: 1rem; font-weight: 600; flex: 1; }
  .modal-close  { background: none; border: none; font-size: 1.1rem; cursor: pointer; color: var(--color-muted); }
  .modal-footer { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.25rem; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.85rem; }
  .field label { font-size: 0.78rem; font-weight: 500; color: var(--color-muted); }
  .input { width: 100%; padding: 0.4rem 0.65rem; border: 1px solid var(--color-border); border-radius: var(--radius);
           background: var(--color-surface); color: var(--color-text); font-size: 0.85rem; font-family: var(--font);
           box-sizing: border-box; }
  .input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }
  .scope-list { display: flex; flex-direction: column; gap: 0.4rem; }
  .scope-item { display: flex; align-items: center; gap: 0.5rem; font-size: 0.83rem; cursor: pointer; }
  .key-reveal { background: var(--color-bg); border: 1px solid var(--mr-accept);
                border-radius: var(--radius); padding: 0.75rem 1rem; margin: 1rem 0;
                font-family: var(--mr-font-data); font-size: 0.82rem; word-break: break-all; color: var(--mr-accept); }
  .key-warn { color: var(--mr-reject); font-size: 0.8rem; font-weight: 500; }
`;

class ApiKeysPage extends HTMLElement {
  constructor() {
    super();
    this._keys = [];
    this._newKeyPlaintext = null;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="page-header">
        <span class="page-title">API Keys</span>
        <button class="btn btn-primary" id="btn-create">+ New API Key</button>
      </div>
      <div class="info-box">
        External services authenticate using <code>X-API-Key: &lt;key&gt;</code> header against
        <code>/api/ext/sessions</code>, <code>/api/ext/users/{username}</code>, and
        <code>/api/ext/coa/disconnect</code>. Keys are scoped — each key only accesses what it
        has been granted.
      </div>
      <div class="card" id="keys-wrap"><div class="state-loading">Loading…</div></div>

      <!-- Create modal -->
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title" id="modal-title">New API Key</span>
            <button class="modal-close" id="modal-close">✕</button>
          </div>
          <div id="modal-body"></div>
          <div class="modal-footer">
            <button class="btn" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-submit" style="display:none;">Create Key</button>
            <button class="btn btn-primary" id="modal-done" style="display:none;">Done</button>
          </div>
        </div>
      </div>
    `;

    this.shadowRoot.getElementById('btn-create').addEventListener(
      'click',
      () => this._openCreate(),
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
      () => this._submitCreate(),
    );
    this.shadowRoot.getElementById('modal-done').addEventListener(
      'click',
      () => this._closeModal(),
    );
    this.shadowRoot.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === this.shadowRoot.getElementById('modal-overlay')) this._closeModal();
    });

    this._load();
  }

  async _load() {
    const wrap = this.shadowRoot.getElementById('keys-wrap');
    wrap.innerHTML = `<table>${KEYS_THEAD}<tbody>${
      skeletonRows(this.shadowRoot, 7)
    }</tbody></table>`;
    try {
      this._keys = await api.get('/apikeys');
      this._render(wrap);
    } catch (e) {
      wrap.innerHTML = emptyStateHTML({
        title: 'Couldn’t load API keys',
        message: e.message || 'Something went wrong. Try again.',
      });
    }
  }

  _render(wrap) {
    if (!this._keys.length) {
      wrap.innerHTML = emptyStateHTML({
        title: 'No API keys yet',
        message: 'Create your first key so external services can authenticate against the API.',
      });
      return;
    }
    wrap.innerHTML = `
      <table>
        ${KEYS_THEAD}
        <tbody>
          ${
      this._keys.map((k) => `
            <tr>
              <td style="font-weight:500;">${esc(k.name)}</td>
              <td><code>${esc(k.key_prefix)}…</code></td>
              <td style="font-size:0.75rem;color:var(--color-muted);">${
        (k.scopes || []).map((s) => esc(s)).join(', ') || '—'
      }</td>
              <td style="color:var(--color-muted);font-size:0.78rem;">${
        fmtDate(k.last_used_at)
      }</td>
              <td style="color:var(--color-muted);font-size:0.78rem;">${fmtDate(k.expires_at)}</td>
              <td>${
        k.revoked
          ? '<span class="badge badge-off">Revoked</span>'
          : '<span class="badge badge-ok">Active</span>'
      }</td>
              <td>
                ${
        !k.revoked
          ? `<button class="btn btn-sm btn-danger" data-action="revoke" data-id="${k.id}">Revoke</button>`
          : ''
      }
                <button class="btn btn-sm" data-action="delete" data-id="${k.id}" style="margin-left:4px;">Delete</button>
              </td>
            </tr>
          `).join('')
    }
        </tbody>
      </table>
    `;
    wrap.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        if (btn.dataset.action === 'revoke') this._revokeKey(id);
        if (btn.dataset.action === 'delete') this._deleteKey(id);
      });
    });
  }

  _openCreate() {
    const body = this.shadowRoot.getElementById('modal-body');
    this.shadowRoot.getElementById('modal-submit').style.display = '';
    this.shadowRoot.getElementById('modal-done').style.display = 'none';
    this._newKeyPlaintext = null;
    body.innerHTML = `
      <div class="field">
        <label>Key Name</label>
        <input class="input" id="k-name" placeholder="Billing system key" />
      </div>
      <div class="field">
        <label>Scopes</label>
        <div class="scope-list">
          ${
      SCOPES.map((s) => `
            <label class="scope-item">
              <input type="checkbox" value="${s.id}" />
              <span><strong>${esc(s.id)}</strong> — ${esc(s.label.split(' — ')[1] || '')}</span>
            </label>
          `).join('')
    }
        </div>
      </div>
      <div class="field">
        <label>Expires (optional)</label>
        <input class="input" id="k-expires" type="datetime-local" />
      </div>
    `;
    this.shadowRoot.getElementById('modal-overlay').classList.add('open');
  }

  async _submitCreate() {
    const body = this.shadowRoot.getElementById('modal-body');
    clearFieldErrors(body);
    const nameInput = body.querySelector('#k-name');
    const name = nameInput?.value.trim();
    const scopes = [...body.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    const expiresVal = body.querySelector('#k-expires')?.value;
    if (!name) {
      setFieldError(nameInput, 'Key name is required');
      return;
    }
    try {
      const res = await api.post('/apikeys', {
        name,
        scopes,
        expires_at: expiresVal ? new Date(expiresVal).toISOString() : null,
      });
      this._newKeyPlaintext = res.plaintext_key;
      body.innerHTML = `
        <p style="margin:0 0 0.75rem;font-size:0.85rem;">Key <strong>${
        esc(res.name)
      }</strong> created. Copy it now — it will not be shown again.</p>
        <div class="key-reveal">${esc(res.plaintext_key)}</div>
        <p class="key-warn">⚠ Store this key securely. This is the only time it is displayed.</p>
      `;
      this.shadowRoot.getElementById('modal-submit').style.display = 'none';
      this.shadowRoot.getElementById('modal-done').style.display = '';
      await this._load();
    } catch (e) {
      if (applyServerErrors(body, e, (f) => (f === 'name' ? nameInput : null))) return;
      toast(e.message, 'error');
    }
  }

  async _revokeKey(id) {
    if (
      !(await confirmDialog('Revoke this API key? It will stop working immediately.', {
        title: 'Revoke key',
        danger: true,
      }))
    ) return;
    try {
      await api.delete(`/apikeys/${id}`);
      toast('Key revoked', 'success');
      await this._load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async _deleteKey(id) {
    if (
      !(await confirmDialog('Permanently delete this API key?', {
        title: 'Delete key',
        danger: true,
      }))
    ) return;
    try {
      await api.delete(`/apikeys/${id}`);
      toast('Key deleted', 'success');
      await this._load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  _closeModal() {
    this.shadowRoot.getElementById('modal-overlay').classList.remove('open');
    this._newKeyPlaintext = null;
  }
}

customElements.define('apikeys-page', ApiKeysPage);

// Retired standalone route → redirect into the System page's API Keys tab so
// bookmarks keep working. The <apikeys-page> element stays, hosted by the tab.
function _akRedirect(to) {
  queueMicrotask(() => router.navigate(to));
  const d = document.createElement('div');
  d.style.cssText = 'padding:2rem;color:var(--color-muted);font-size:0.8rem;';
  d.textContent = 'Redirecting…';
  return d;
}
router.register('/apikeys', () => _akRedirect('/system?view=apikeys'));
