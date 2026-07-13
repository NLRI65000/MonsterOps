import { api } from '/js/api.js';
import { router } from '/js/router.js';
import { toast as showToast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { openModal } from '/js/components/mr-modal.js';
import { emptyStateHTML, skeletonRows } from '/js/utils/empty.js';
import { setFieldError, clearFieldError, clearFieldErrors, applyServerErrors } from '/js/utils/form.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

// The subscriptions table header, reused for the populated table and the loading
// skeleton so the table keeps its shape while it loads.
const SUBS_THEAD =
  '<thead><tr><th>Name</th><th>URL</th><th>Events</th><th>Signed</th>' +
  '<th>Status</th><th>Created</th><th></th></tr></thead>';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function badge(text, ok) {
  const c = ok ? 'var(--color-success, #2e7d32)' : 'var(--color-muted)';
  return `<span style="
    display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;
    background:${c}22;color:${c};border:1px solid ${c}44;
  ">${text}</span>`;
}

const KNOWN_EVENTS = [
  'user.created', 'user.updated', 'user.deleted',
  'group.created', 'group.deleted', 'group.member_added', 'group.member_removed',
  'nas.created', 'nas.updated', 'nas.deleted',
  'admin.create', 'admin.update', 'admin.delete',
  'audit.*', 'user.*', 'nas.*', 'group.*', '*',
];

// ── WebhooksPage ───────────────────────────────────────────────────────────────

class WebhooksPage extends HTMLElement {
  connectedCallback() {
    this._tab = 'subscriptions';
    this._subs = [];
    this._eventLog = [];
    this._sse = null;
    this._loading = true;
    this.render();
    this._load();
  }

  disconnectedCallback() {
    if (this._sse) { this._sse.close(); this._sse = null; }
  }

  render() {
    this.innerHTML = `
      <style>
        .wh-root { padding: 1.5rem; max-width: 1100px; }
        h1 { margin: 0 0 1.5rem; font-size: 1.4rem; color: var(--color-text); }
        .tabs { display: flex; gap: 0; border-bottom: 2px solid var(--color-border); margin-bottom: 1.5rem; }
        .tab-btn {
          padding: 0.6rem 1.4rem; border: none; background: none; cursor: pointer;
          font-size: 0.92rem; color: var(--color-muted); border-bottom: 2px solid transparent;
          margin-bottom: -2px; transition: color 0.15s, border-color 0.15s;
        }
        .tab-btn.active { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: 600; }
        .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .btn {
          padding: 0.45rem 1rem; border: none; border-radius: 6px; cursor: pointer;
          font-size: 0.88rem; font-weight: 500; transition: opacity 0.15s;
        }
        .btn:hover { opacity: 0.85; }
        .btn-primary { background: var(--color-accent); color: #fff; }
        .btn-danger  { background: var(--color-danger, #c62828); color: #fff; }
        .btn-ghost   { background: var(--color-surface-alt, #2a2a2a); color: var(--color-text); }
        .btn-sm      { padding: 0.3rem 0.7rem; font-size: 0.8rem; }
        table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        th { text-align: left; padding: 0.5rem 0.75rem; color: var(--color-muted); font-weight: 500; font-size: 0.78rem; text-transform: uppercase; border-bottom: 1px solid var(--color-border); }
        td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--color-border); }
        tr:last-child td { border-bottom: none; }
        .empty { color: var(--color-muted); padding: 2rem; text-align: center; }
        .actions { display: flex; gap: 0.4rem; }
        /* Stream tab */
        .stream-bar { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; }
        .stream-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--color-muted); }
        .stream-dot.live { background: var(--color-success, #4caf50); box-shadow: 0 0 6px var(--color-success, #4caf50); animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .event-log {
          font-family: var(--font-mono, monospace); font-size: 0.78rem;
          background: var(--color-surface-alt, #1a1a1a); border: 1px solid var(--color-border);
          border-radius: 6px; padding: 0.75rem; height: 420px; overflow-y: auto;
          color: var(--color-text);
        }
        .evt-row { padding: 0.3rem 0; border-bottom: 1px solid var(--color-border-subtle, #333); }
        .evt-row:last-child { border-bottom: none; }
        .evt-ts { color: var(--color-muted); margin-right: 0.5rem; }
        .evt-type { color: var(--color-accent); font-weight: 600; margin-right: 0.5rem; }
        .evt-actor { color: var(--color-text); }
        .evt-entity { color: var(--color-muted); }
        /* Modal */
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 200;
          display: flex; align-items: center; justify-content: center;
        }
        .modal-box {
          background: var(--color-surface); border-radius: 10px; padding: 2rem;
          min-width: 480px; max-width: 600px; width: 100%;
          box-shadow: 0 8px 48px rgba(0,0,0,0.4);
        }
        .modal-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 1.5rem; }
        .form-group { margin-bottom: 1rem; }
        label { display: block; font-size: 0.82rem; color: var(--color-muted); margin-bottom: 0.3rem; }
        input, textarea, select {
          width: 100%; box-sizing: border-box;
          padding: 0.5rem 0.7rem; border: 1px solid var(--color-border); border-radius: 6px;
          background: var(--color-input-bg, var(--color-surface-alt)); color: var(--color-text);
          font-size: 0.9rem;
        }
        .events-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; max-height: 180px;
          overflow-y: auto; padding: 0.5rem; border: 1px solid var(--color-border); border-radius: 6px;
        }
        .events-grid label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: var(--color-text); cursor: pointer; }
        .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem; }
        .help-text { font-size: 0.78rem; color: var(--color-muted); margin-top: 0.25rem; }
        .events-tags { display: flex; flex-wrap: wrap; gap: 0.3rem; }
        .evt-tag {
          font-size: 0.75rem; padding: 2px 8px; border-radius: 3px;
          background: var(--color-accent)22; color: var(--color-accent);
          border: 1px solid var(--color-accent)44; font-family: var(--font-mono, monospace);
        }
      </style>
      <div class="wh-root">
        <h1>⚡ Webhooks & Event Stream</h1>
        <div class="tabs">
          <button class="tab-btn active" data-tab="subscriptions">Subscriptions</button>
          <button class="tab-btn" data-tab="stream">Live Stream</button>
        </div>
        <div id="tab-content"></div>
      </div>
    `;
    this.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        this.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        this._renderTab();
      });
    });
    this._renderTab();
  }

  _renderTab() {
    if (this._tab === 'subscriptions') this._renderSubs();
    else this._renderStream();
  }

  // Resolve the subscriptions body to one of four consistent states: a skeleton
  // while loading, a themed error, a shared empty state, or the real table.
  _subsBody() {
    if (this._loading) {
      return `<table>${SUBS_THEAD}<tbody>${skeletonRows(this.getRootNode(), 7)}</tbody></table>`;
    }
    if (this._error) {
      return emptyStateHTML({ title: 'Couldn’t load subscriptions', message: this._error });
    }
    if (this._subs.length === 0) {
      return emptyStateHTML({
        title: 'No webhook subscriptions yet',
        message: 'Add one to receive events at your own HTTPS endpoint.',
      });
    }
    return `<table>
        ${SUBS_THEAD}
        <tbody>
          ${this._subs.map(s => `
            <tr>
              <td>${this._esc(s.name)}</td>
              <td style="font-family:monospace;font-size:0.8rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="${this._esc(s.url)}">${this._esc(s.url)}</td>
              <td>
                <div class="events-tags">
                  ${(s.events || []).map(e => `<span class="evt-tag">${this._esc(e)}</span>`).join('')}
                </div>
              </td>
              <td>${s.has_secret ? badge('signed', true) : badge('plain', false)}</td>
              <td>${s.enabled ? badge('enabled', true) : badge('disabled', false)}</td>
              <td style="font-size:0.8rem;color:var(--color-muted);">${fmtDate(s.created_at)}</td>
              <td>
                <div class="actions">
                  <button class="btn btn-ghost btn-sm" data-action="test" data-id="${s.id}" title="Send test event">▶ Test</button>
                  <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${s.id}">Edit</button>
                  <button class="btn btn-danger btn-sm" data-action="delete" data-id="${s.id}">Delete</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  }

  _renderSubs() {
    const panel = this.querySelector('#tab-content');
    const count = this._loading
      ? 'Loading…'
      : `${this._subs.length} subscription${this._subs.length !== 1 ? 's' : ''}`;
    panel.innerHTML = `
      <div class="section-header">
        <span style="color:var(--color-muted);font-size:0.88rem;">${count}</span>
        <button class="btn btn-primary" id="btn-new-sub">+ New Subscription</button>
      </div>
      ${this._subsBody()}
    `;
    panel.querySelector('#btn-new-sub')?.addEventListener('click', () => this._openForm(null));
    panel.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        if (btn.dataset.action === 'delete') this._delete(id);
        else if (btn.dataset.action === 'edit') this._openForm(this._subs.find(s => s.id === id));
        else if (btn.dataset.action === 'test') this._test(id);
      });
    });
  }

  _renderStream() {
    const panel = this.querySelector('#tab-content');
    const isLive = this._sse && this._sse.readyState === EventSource.OPEN;
    panel.innerHTML = `
      <div class="stream-bar">
        <div class="stream-dot ${isLive ? 'live' : ''}" id="stream-dot"></div>
        <span style="font-size:0.88rem;color:var(--color-muted);">${isLive ? 'Connected — receiving live events' : 'Not connected'}</span>
        <button class="btn btn-ghost btn-sm" id="btn-connect" style="margin-left:auto;">
          ${isLive ? 'Disconnect' : 'Connect'}
        </button>
        <button class="btn btn-ghost btn-sm" id="btn-clear">Clear</button>
      </div>
      <div class="event-log" id="event-log">
        ${this._eventLog.length === 0
          ? '<span style="color:var(--color-muted)">No events yet — click Connect to start the stream.</span>'
          : this._eventLog.map(e => this._fmtEvt(e)).join('')
        }
      </div>
    `;
    panel.querySelector('#btn-connect').addEventListener('click', () => {
      if (this._sse) { this._sse.close(); this._sse = null; }
      else this._connectSSE();
      this._renderStream();
    });
    panel.querySelector('#btn-clear').addEventListener('click', () => {
      this._eventLog = [];
      this._renderStream();
    });
  }

  _fmtEvt(e) {
    const ts = new Date(e.timestamp || Date.now()).toLocaleTimeString();
    return `<div class="evt-row">
      <span class="evt-ts">${ts}</span>
      <span class="evt-type">${this._esc(e.type)}</span>
      <span class="evt-actor">${this._esc(e.actor || '')}</span>
      <span class="evt-entity"> → ${this._esc(e.entity_id || '')}</span>
      ${e.data && Object.keys(e.data).length ? `<span class="evt-entity"> · ${this._esc(JSON.stringify(e.data))}</span>` : ''}
    </div>`;
  }

  _connectSSE() {
    // EventSource sends the HttpOnly session cookie automatically (same-origin).
    this._sse = new EventSource('/api/webhooks/stream/events');
    this._sse.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'connected') return;
        this._eventLog.unshift(data);
        if (this._eventLog.length > 200) this._eventLog.pop();
        if (this._tab === 'stream') {
          const log = this.querySelector('#event-log');
          if (log) {
            const row = document.createElement('div');
            row.innerHTML = this._fmtEvt(data);
            log.prepend(row.firstElementChild);
            if (log.children.length > 200) log.lastElementChild?.remove();
          }
          const dot = this.querySelector('#stream-dot');
          if (dot && !dot.classList.contains('live')) {
            dot.classList.add('live');
            this.querySelector('.stream-bar span').textContent = 'Connected — receiving live events';
            const btn = this.querySelector('#btn-connect');
            if (btn) btn.textContent = 'Disconnect';
          }
        }
      } catch (_) {}
    };
    this._sse.onerror = () => {
      const dot = this.querySelector('#stream-dot');
      if (dot) dot.classList.remove('live');
    };
  }

  async _load() {
    this._loading = true;
    this._error = null;
    if (this._tab === 'subscriptions') this._renderSubs();
    try {
      this._subs = await api.get('/webhooks');
    } catch (err) {
      this._error = err.message || 'Something went wrong.';
    } finally {
      this._loading = false;
      if (this._tab === 'subscriptions') this._renderSubs();
    }
  }

  async _delete(id) {
    const sub = this._subs.find(s => s.id === id);
    if (!await confirmDialog(`Delete webhook "${sub?.name}"?`)) return;
    try {
      await api.delete(`/webhooks/${id}`);
      showToast('Subscription deleted', 'success');
      await this._load();
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  async _test(id) {
    const sub = this._subs.find(s => s.id === id);
    try {
      await api.post(`/webhooks/${id}/test`, {});
      showToast(`Test event queued for "${sub?.name}"`, 'success');
    } catch (err) {
      showToast(err.message || 'Test failed', 'error');
    }
  }

  _openForm(sub) {
    const isEdit = !!sub;
    const selectedEvents = new Set(sub?.events || []);

    const m = openModal({
      title: isEdit ? 'Edit webhook subscription' : 'New webhook subscription',
      subtitle: 'POST events to an external endpoint as they happen.',
      submitLabel: isEdit ? 'Save changes' : 'Create',
      bodyHTML: `
        <div class="mrm-field">
          <label class="mrm-label" for="f-name">Name</label>
          <input id="f-name" class="mrm-input" value="${this._esc(sub?.name || '')}" placeholder="e.g. Slack alerts">
        </div>
        <div class="mrm-field">
          <label class="mrm-label" for="f-url">Endpoint URL</label>
          <input id="f-url" class="mrm-input mrm-mono" value="${this._esc(sub?.url || '')}" placeholder="https://example.com/webhook">
        </div>
        <div class="mrm-field">
          <label class="mrm-label" for="f-secret">Secret <span class="mrm-label-note">— optional, signs each request</span></label>
          <input id="f-secret" class="mrm-input" type="password" placeholder="${isEdit && sub.has_secret ? '(unchanged)' : 'Leave blank for no signature'}">
          ${isEdit && sub.has_secret ? '<div class="mrm-help">A secret is already set. Leave blank to keep it.</div>' : ''}
        </div>
        <div class="mrm-field">
          <span class="mrm-label">Events to subscribe to</span>
          <div class="mrm-evt-grid">
            ${KNOWN_EVENTS.map(e => `
              <label class="mrm-evt">
                <input type="checkbox" name="evt" value="${e}" ${selectedEvents.has(e) ? 'checked' : ''}>
                <code>${e}</code>
              </label>
            `).join('')}
          </div>
          <div class="mrm-help">Use <code>*</code> for all events, <code>user.*</code> for all user events.</div>
        </div>
        <label class="mrm-check">
          <input type="checkbox" id="f-enabled" ${!isEdit || sub.enabled ? 'checked' : ''}>
          Enabled
        </label>
      `,
    });

    const overlay = m.overlay;
    // The event picker is a checkbox group, not a single input — clear its inline
    // error as soon as the user toggles any box (setFieldError's own auto-clear
    // listens on the target element, which for a group never fires).
    const evtGrid = overlay.querySelector('.mrm-evt-grid');
    evtGrid?.addEventListener('change', () => clearFieldError(evtGrid));

    m.onSubmit(async () => {
      clearFieldErrors(overlay);
      const nameInput = overlay.querySelector('#f-name');
      const urlInput = overlay.querySelector('#f-url');
      const name = nameInput.value.trim();
      const url = urlInput.value.trim();
      const secret = overlay.querySelector('#f-secret').value || null;
      const events = [...overlay.querySelectorAll('input[name="evt"]:checked')].map(c => c.value);
      const enabled = overlay.querySelector('#f-enabled').checked;

      // Client-side required checks land inline under the offending field.
      let ok = true;
      if (!name) { setFieldError(nameInput, 'Name is required'); ok = false; }
      if (!url) { setFieldError(urlInput, 'Endpoint URL is required'); ok = false; }
      if (events.length === 0) { setFieldError(evtGrid, 'Select at least one event'); ok = false; }
      if (!ok) return;

      const body = { name, url, events, enabled, secret };
      // If editing and no new secret provided, keep the existing one via null
      if (isEdit && !secret && sub.has_secret) delete body.secret;

      const saveBtn = m.submitBtn;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      const restore = () => { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Save changes' : 'Create'; };

      try {
        if (isEdit) await api.put(`/webhooks/${sub.id}`, body);
        else await api.post('/webhooks', body);
        showToast(isEdit ? 'Subscription updated' : 'Subscription created', 'success');
        m.close();
        await this._load();
      } catch (err) {
        restore();
        // The server validates url as an HttpUrl — map a bad-URL 422 to its field.
        if (applyServerErrors(overlay, err, (f) => (f === 'events' ? evtGrid : overlay.querySelector(`#f-${f}`)))) return;
        showToast(err.message || 'Save failed', 'error');
      }
    });
  }

  _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

customElements.define('webhooks-page', WebhooksPage);

// Retired standalone route → redirect into the Automation workspace tab so
// bookmarks keep working. The <webhooks-page> element stays, hosted by the tab.
function _whRedirect(to) {
  queueMicrotask(() => router.navigate(to));
  const d = document.createElement('div');
  d.style.cssText = 'padding:2rem;color:var(--color-muted);font-size:0.8rem;';
  d.textContent = 'Redirecting…';
  return d;
}
router.register('/webhooks', () => _whRedirect('/automation?view=webhooks'));
