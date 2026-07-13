import { api } from '/js/api.js';
import { router } from '/js/router.js';
import { toast as showToast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { emptyRowHTML, skeletonRows } from '/js/utils/empty.js';
import { setFieldError, clearFieldErrors, applyServerErrors } from '/js/utils/form.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const EVENT_TYPE_LABELS = {
  auth_failure: 'Auth Failure',
  nas_offline: 'NAS Offline',
  system_health: 'System Health',
};

const CHANNEL_TYPE_LABELS = {
  email: 'Email (SMTP)',
  webhook: 'Webhook',
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function badge(text, color) {
  return `<span style="
    display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;
    background:${color}22;color:${color};border:1px solid ${color}44;
  ">${text}</span>`;
}

// ── Notifications Page ────────────────────────────────────────────────────────

class NotificationsPage extends HTMLElement {
  connectedCallback() {
    this._tab = 'channels';
    this.render();
    this._load();
  }

  render() {
    this.innerHTML = `
      <style>
        :host, .nr-root { display: block; }
        .nr-root { padding: 1.5rem; max-width: 1100px; }
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
        .btn-danger  { background: var(--color-danger); color: #fff; }
        .btn-ghost   { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); }
        .btn-sm { padding: 0.3rem 0.7rem; font-size: 0.8rem; }
        table { width: 100%; border-collapse: collapse; background: var(--color-surface); border-radius: 8px; overflow: hidden; }
        th { background: var(--color-surface); color: var(--color-muted); font-size: 0.78rem; font-weight: 600;
             text-transform: uppercase; letter-spacing: 0.04em; padding: 0.75rem 1rem; text-align: left;
             border-bottom: 1px solid var(--color-border); }
        td { padding: 0.75rem 1rem; color: var(--color-text); font-size: 0.88rem;
             border-bottom: 1px solid var(--color-border); vertical-align: middle; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: var(--color-border)18; }
        .actions { display: flex; gap: 0.4rem; }
        .empty { color: var(--color-muted); font-size: 0.9rem; text-align: center; padding: 2rem; }
        .modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center; z-index: 200;
        }
        .modal {
          background: var(--color-surface); border-radius: 10px; padding: 1.5rem;
          width: 520px; max-width: 95vw; max-height: 90vh; overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }
        .modal h2 { margin: 0 0 1.2rem; font-size: 1.1rem; color: var(--color-text); }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; font-size: 0.82rem; color: var(--color-muted);
                            font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 0.35rem; }
        .form-group input, .form-group select, .form-group textarea {
          width: 100%; padding: 0.5rem 0.75rem; background: var(--color-bg);
          border: 1px solid var(--color-border); border-radius: 6px; color: var(--color-text);
          font-size: 0.9rem; box-sizing: border-box; font-family: inherit;
        }
        .form-group textarea { resize: vertical; min-height: 80px; font-family: monospace; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.25rem; }
        .config-hint { font-size: 0.78rem; color: var(--color-muted); margin-top: 0.35rem; line-height: 1.4; }
        .toggle-wrap { display: flex; align-items: center; gap: 0.5rem; }
        input[type=checkbox] { width: 16px; height: 16px; cursor: pointer; }
      </style>
      <div class="nr-root">
        <h1>Notifications</h1>
        <div class="tabs">
          <button class="tab-btn active" data-tab="channels">Channels</button>
          <button class="tab-btn" data-tab="rules">Rules</button>
          <button class="tab-btn" data-tab="history">History</button>
        </div>
        <div id="tab-content"></div>
      </div>
      <div id="modal-container"></div>
    `;
    this.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._tab = btn.dataset.tab;
        this._renderTab();
      });
    });
  }

  async _load() {
    this._loading = true;
    this._error = null;
    this._renderTab();
    try {
      const [channels, rules, history] = await Promise.all([
        api.get('/notifications/channels'),
        api.get('/notifications/rules'),
        api.get('/notifications/history?limit=100'),
      ]);
      this._channels = channels;
      this._rules = rules;
      this._history = history;
    } catch (e) {
      this._error = e.message || 'Something went wrong.';
    } finally {
      this._loading = false;
      this._renderTab();
    }
  }

  // Resolve a table body to a skeleton (loading), a themed error row, an empty
  // state, or the real rows — so all three tabs share one consistent treatment.
  _tbody(cols, rows, emptyOpts) {
    if (this._loading) return skeletonRows(this.getRootNode(), cols);
    if (this._error) return emptyRowHTML(cols, { title: 'Couldn’t load notifications', message: this._error });
    return rows || emptyRowHTML(cols, emptyOpts);
  }

  _renderTab() {
    const el = this.querySelector('#tab-content');
    if (this._tab === 'channels') el.innerHTML = this._channelsHTML();
    else if (this._tab === 'rules') el.innerHTML = this._rulesHTML();
    else el.innerHTML = this._historyHTML();
    this._bindTabEvents();
  }

  // ── Channels tab ────────────────────────────────────────────────────────────

  _channelsHTML() {
    const rows = (this._channels || []).map(ch => `
      <tr>
        <td>${esc(ch.name)}</td>
        <td>${badge(CHANNEL_TYPE_LABELS[ch.type] || esc(ch.type), ch.type === 'email' ? 'var(--color-accent)' : 'var(--color-warning)')}</td>
        <td>${badge(ch.enabled ? 'Enabled' : 'Disabled', ch.enabled ? 'var(--color-success)' : 'var(--color-muted)')}</td>
        <td>${fmtDate(ch.created_at)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" data-action="test-ch" data-id="${ch.id}">Test</button>
            <button class="btn btn-ghost btn-sm" data-action="edit-ch" data-id="${ch.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-action="del-ch" data-id="${ch.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    return `
      <div class="section-header">
        <span style="color:var(--color-muted);font-size:0.88rem;">${(this._channels || []).length} channel(s)</span>
        <button class="btn btn-primary" data-action="add-ch">+ Add Channel</button>
      </div>
      <table>
        <thead><tr>
          <th>Name</th><th>Type</th><th>Status</th><th>Created</th><th>Actions</th>
        </tr></thead>
        <tbody>${this._tbody(5, rows, { title: 'No channels yet', message: 'Add a channel (email or webhook) to start delivering alerts.' })}</tbody>
      </table>
    `;
  }

  // ── Rules tab ───────────────────────────────────────────────────────────────

  _rulesHTML() {
    const channelMap = Object.fromEntries((this._channels || []).map(c => [c.id, c.name]));
    const rows = (this._rules || []).map(r => `
      <tr>
        <td>${esc(r.name)}</td>
        <td>${badge(EVENT_TYPE_LABELS[r.event_type] || esc(r.event_type), 'var(--color-accent)')}</td>
        <td>${r.channel_id ? esc(channelMap[r.channel_id]) || `#${r.channel_id}` : '<span style="color:var(--color-muted)">—</span>'}</td>
        <td>${r.cooldown_minutes} min</td>
        <td>${badge(r.enabled ? 'Enabled' : 'Disabled', r.enabled ? 'var(--color-success)' : 'var(--color-muted)')}</td>
        <td>${r.last_triggered ? fmtDate(r.last_triggered) : '<span style="color:var(--color-muted)">Never</span>'}</td>
        <td>
          <div class="actions">
            <button class="btn btn-ghost btn-sm" data-action="edit-rule" data-id="${r.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-action="del-rule" data-id="${r.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    return `
      <div class="section-header">
        <span style="color:var(--color-muted);font-size:0.88rem;">${(this._rules || []).length} rule(s)</span>
        <button class="btn btn-primary" data-action="add-rule">+ Add Rule</button>
      </div>
      <table>
        <thead><tr>
          <th>Name</th><th>Event</th><th>Channel</th><th>Cooldown</th><th>Status</th><th>Last Triggered</th><th>Actions</th>
        </tr></thead>
        <tbody>${this._tbody(7, rows, { title: 'No rules yet', message: 'Create a rule to route events to your channels.' })}</tbody>
      </table>
    `;
  }

  // ── History tab ─────────────────────────────────────────────────────────────

  _historyHTML() {
    const rows = (this._history || []).map(h => `
      <tr>
        <td style="font-size:0.8rem;">${fmtDate(h.created_at)}</td>
        <td>${esc(h.rule_name) || '—'}</td>
        <td>${badge(EVENT_TYPE_LABELS[h.event_type] || esc(h.event_type), 'var(--color-accent)')}</td>
        <td>${esc(h.channel_name) || '—'}</td>
        <td>${badge(h.status === 'sent' ? 'Sent' : 'Failed', h.status === 'sent' ? 'var(--color-success)' : 'var(--color-danger)')}</td>
        <td style="font-size:0.8rem;color:var(--color-muted);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
            title="${esc(h.error || h.message)}">${esc((h.error || h.message || '').split('\n')[0])}</td>
      </tr>
    `).join('');

    return `
      <div class="section-header">
        <span style="color:var(--color-muted);font-size:0.88rem;">Last ${(this._history || []).length} events</span>
        <button class="btn btn-ghost btn-sm" data-action="refresh-history">↺ Refresh</button>
      </div>
      <table>
        <thead><tr>
          <th>Time</th><th>Rule</th><th>Event</th><th>Channel</th><th>Status</th><th>Detail</th>
        </tr></thead>
        <tbody>${this._tbody(6, rows, { title: 'No notifications yet', message: 'Delivered alerts will appear here.' })}</tbody>
      </table>
    `;
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  _bindTabEvents() {
    this.querySelector('#tab-content').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      const numId = id ? +id : null;

      if (action === 'add-ch') this._showChannelModal(null);
      else if (action === 'edit-ch') this._showChannelModal(this._channels.find(c => c.id === numId));
      else if (action === 'del-ch') this._deleteChannel(numId);
      else if (action === 'test-ch') this._testChannel(numId, btn);
      else if (action === 'add-rule') this._showRuleModal(null);
      else if (action === 'edit-rule') this._showRuleModal(this._rules.find(r => r.id === numId));
      else if (action === 'del-rule') this._deleteRule(numId);
      else if (action === 'refresh-history') this._refreshHistory();
    });
  }

  // ── Channel modal ────────────────────────────────────────────────────────────

  _showChannelModal(ch) {
    const isEdit = !!ch;
    const type = ch?.type || 'email';
    const cfg = ch?.config || {};

    const emailFields = `
      <div class="form-row">
        <div class="form-group">
          <label>SMTP Host</label>
          <input name="smtp_host" value="${esc(cfg.smtp_host)}" placeholder="smtp.gmail.com" />
        </div>
        <div class="form-group">
          <label>Port</label>
          <input name="smtp_port" type="number" value="${cfg.smtp_port || 587}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Username</label>
          <input name="smtp_user" value="${esc(cfg.smtp_user)}" placeholder="user@example.com" />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input name="smtp_password" type="password" value="${esc(cfg.smtp_password)}" />
        </div>
      </div>
      <div class="form-group">
        <label>From Address</label>
        <input name="from_addr" value="${esc(cfg.from_addr)}" placeholder="alerts@example.com" />
      </div>
      <div class="form-group">
        <label>To Addresses (comma-separated)</label>
        <input name="to_addrs" value="${esc((cfg.to_addrs || []).join(', '))}" placeholder="admin@example.com, ops@example.com" />
      </div>
      <div class="form-group toggle-wrap">
        <input type="checkbox" name="use_tls" id="use_tls" ${cfg.use_tls !== false ? 'checked' : ''} />
        <label for="use_tls" style="text-transform:none;font-size:0.88rem;">Use STARTTLS</label>
      </div>
    `;

    const webhookFields = `
      <div class="form-group">
        <label>Webhook URL</label>
        <input name="url" value="${esc(cfg.url)}" placeholder="https://hooks.slack.com/services/..." />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Method</label>
          <select name="method">
            <option value="POST" ${(cfg.method || 'POST') === 'POST' ? 'selected' : ''}>POST</option>
            <option value="GET" ${cfg.method === 'GET' ? 'selected' : ''}>GET</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Body Template</label>
        <textarea name="body_template" placeholder='{"text":"{{message}}"}'>${cfg.body_template || ''}</textarea>
        <div class="config-hint">Use <code>{{subject}}</code> and <code>{{message}}</code> as placeholders. Leave empty for default JSON body.</div>
      </div>
      <div class="form-group">
        <label>Custom Headers (JSON)</label>
        <textarea name="headers" placeholder='{"Authorization":"Bearer token"}'>${cfg.headers ? JSON.stringify(cfg.headers, null, 2) : ''}</textarea>
      </div>
    `;

    const html = `
      <div class="modal-overlay" id="ch-modal">
        <div class="modal">
          <h2>${isEdit ? 'Edit Channel' : 'Add Channel'}</h2>
          <div class="form-group">
            <label>Name</label>
            <input name="ch-name" value="${esc(ch?.name)}" placeholder="My Email Alert" />
          </div>
          <div class="form-group">
            <label>Type</label>
            <select name="ch-type" id="ch-type-sel">
              <option value="email" ${type === 'email' ? 'selected' : ''}>Email (SMTP)</option>
              <option value="webhook" ${type === 'webhook' ? 'selected' : ''}>Webhook</option>
            </select>
          </div>
          <div id="ch-type-fields">
            ${type === 'email' ? emailFields : webhookFields}
          </div>
          <div class="form-group toggle-wrap">
            <input type="checkbox" name="ch-enabled" id="ch-enabled" ${ch?.enabled !== false ? 'checked' : ''} />
            <label for="ch-enabled" style="text-transform:none;font-size:0.88rem;">Enabled</label>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="ch-cancel">Cancel</button>
            <button class="btn btn-primary" id="ch-save">Save</button>
          </div>
        </div>
      </div>
    `;

    const container = this.querySelector('#modal-container');
    container.innerHTML = html;

    container.querySelector('#ch-type-sel').addEventListener('change', e => {
      container.querySelector('#ch-type-fields').innerHTML =
        e.target.value === 'email' ? emailFields : webhookFields;
    });

    container.querySelector('#ch-cancel').addEventListener('click', () => {
      container.innerHTML = '';
    });

    container.querySelector('#ch-save').addEventListener('click', async () => {
      clearFieldErrors(container);
      const nameInput = container.querySelector('[name=ch-name]');
      const name = nameInput.value.trim();
      const chType = container.querySelector('[name=ch-type]').value;
      const enabled = container.querySelector('[name=ch-enabled]').checked;

      // Client-side checks mirror what a channel needs to actually deliver — the
      // server only validates these at send/test time, so catch them inline now.
      let ok = true;
      if (!name) { setFieldError(nameInput, 'Name is required'); ok = false; }

      let config = {};
      if (chType === 'email') {
        const hostInput = container.querySelector('[name=smtp_host]');
        const toInput = container.querySelector('[name=to_addrs]');
        const toAddrs = toInput.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!hostInput.value.trim()) { setFieldError(hostInput, 'SMTP host is required'); ok = false; }
        if (!toAddrs.length) { setFieldError(toInput, 'Add at least one recipient address'); ok = false; }
        config = {
          smtp_host: hostInput.value.trim(),
          smtp_port: +container.querySelector('[name=smtp_port]').value,
          smtp_user: container.querySelector('[name=smtp_user]').value.trim(),
          smtp_password: container.querySelector('[name=smtp_password]').value,
          from_addr: container.querySelector('[name=from_addr]').value.trim(),
          to_addrs: toAddrs,
          use_tls: container.querySelector('[name=use_tls]').checked,
        };
      } else {
        const urlInput = container.querySelector('[name=url]');
        if (!urlInput.value.trim()) { setFieldError(urlInput, 'Webhook URL is required'); ok = false; }
        let headers = {};
        try { headers = JSON.parse(container.querySelector('[name=headers]').value || '{}'); } catch {}
        config = {
          url: urlInput.value.trim(),
          method: container.querySelector('[name=method]').value,
          body_template: container.querySelector('[name=body_template]').value.trim() || null,
          headers,
        };
      }
      if (!ok) return;

      try {
        if (isEdit) {
          await api.put(`/notifications/channels/${ch.id}`, { name, type: chType, config, enabled });
          showToast('Channel updated', 'success');
        } else {
          await api.post('/notifications/channels', { name, type: chType, config, enabled });
          showToast('Channel created', 'success');
        }
        container.innerHTML = '';
        await this._load();
      } catch (err) {
        if (applyServerErrors(container, err, (f) => container.querySelector(`[name=${f === 'name' ? 'ch-name' : f}]`))) return;
        showToast(err.message || 'Save failed', 'error');
      }
    });
  }

  async _deleteChannel(id) {
    const ch = this._channels.find(c => c.id === id);
    if (!await confirmDialog(`Delete channel "${ch?.name}"? Rules using it will have no channel.`, { danger: true })) return;
    try {
      await api.delete(`/notifications/channels/${id}`);
      showToast('Channel deleted', 'success');
      await this._load();
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  async _testChannel(id, btn) {
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await api.post(`/notifications/channels/${id}/test`, {});
      showToast('Test notification sent successfully', 'success');
    } catch (err) {
      showToast(err.message || 'Test failed', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test';
    }
  }

  // ── Rule modal ───────────────────────────────────────────────────────────────

  _ruleConfigFields(eventType, cfg) {
    cfg = cfg || {};
    if (eventType === 'auth_failure') return `
      <div class="form-row">
        <div class="form-group">
          <label>Failure Threshold</label>
          <input name="threshold" type="number" value="${cfg.threshold ?? 5}" min="1" />
          <div class="config-hint">Number of failures to trigger alert</div>
        </div>
        <div class="form-group">
          <label>Window (minutes)</label>
          <input name="window_minutes" type="number" value="${cfg.window_minutes ?? 10}" min="1" />
        </div>
      </div>
      <div class="form-group">
        <label>Username Filter (optional)</label>
        <input name="username" value="${esc(cfg.username)}" placeholder="Leave blank to monitor all users" />
      </div>
    `;
    if (eventType === 'nas_offline') return `
      <div class="form-group">
        <label>Idle Threshold (minutes)</label>
        <input name="idle_minutes" type="number" value="${cfg.idle_minutes ?? 5}" min="1" />
        <div class="config-hint">Alert when a NAS has no accounting activity for this long</div>
      </div>
      <div class="form-group">
        <label>NAS IP Filter (optional)</label>
        <input name="nas_ip" value="${esc(cfg.nas_ip)}" placeholder="Leave blank to monitor all NAS devices" />
      </div>
    `;
    if (eventType === 'system_health') return `
      <div class="form-group">
        <label>Health Check</label>
        <select name="check">
          <option value="db" ${(cfg.check || 'db') === 'db' ? 'selected' : ''}>Database connectivity</option>
        </select>
      </div>
    `;
    return '';
  }

  _collectRuleConfig(eventType) {
    const get = name => this.querySelector(`#rule-modal [name=${name}]`);
    if (eventType === 'auth_failure') return {
      threshold: +get('threshold').value,
      window_minutes: +get('window_minutes').value,
      username: get('username').value.trim() || null,
    };
    if (eventType === 'nas_offline') return {
      idle_minutes: +get('idle_minutes').value,
      nas_ip: get('nas_ip').value.trim() || null,
    };
    if (eventType === 'system_health') return {
      check: get('check').value,
    };
    return {};
  }

  _showRuleModal(rule) {
    const isEdit = !!rule;
    const eventType = rule?.event_type || 'auth_failure';
    const channelOptions = (this._channels || []).map(c =>
      `<option value="${c.id}" ${rule?.channel_id === c.id ? 'selected' : ''}>${c.name} (${c.type})</option>`
    ).join('');

    const html = `
      <div class="modal-overlay" id="rule-modal">
        <div class="modal">
          <h2>${isEdit ? 'Edit Rule' : 'Add Rule'}</h2>
          <div class="form-group">
            <label>Rule Name</label>
            <input name="rule-name" value="${esc(rule?.name)}" placeholder="High failure rate" />
          </div>
          <div class="form-group">
            <label>Event Type</label>
            <select name="event-type" id="event-type-sel">
              <option value="auth_failure" ${eventType === 'auth_failure' ? 'selected' : ''}>Auth Failure</option>
              <option value="nas_offline" ${eventType === 'nas_offline' ? 'selected' : ''}>NAS Offline</option>
              <option value="system_health" ${eventType === 'system_health' ? 'selected' : ''}>System Health</option>
            </select>
          </div>
          <div id="rule-event-config">
            ${this._ruleConfigFields(eventType, rule?.config)}
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Notification Channel</label>
              <select name="channel-id">
                <option value="">— None —</option>
                ${channelOptions}
              </select>
            </div>
            <div class="form-group">
              <label>Cooldown (minutes)</label>
              <input name="cooldown" type="number" value="${rule?.cooldown_minutes ?? 60}" min="1" />
              <div class="config-hint">Minimum time between repeated alerts</div>
            </div>
          </div>
          <div class="form-group toggle-wrap">
            <input type="checkbox" name="rule-enabled" id="rule-enabled" ${rule?.enabled !== false ? 'checked' : ''} />
            <label for="rule-enabled" style="text-transform:none;font-size:0.88rem;">Enabled</label>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="rule-cancel">Cancel</button>
            <button class="btn btn-primary" id="rule-save">Save</button>
          </div>
        </div>
      </div>
    `;

    const container = this.querySelector('#modal-container');
    container.innerHTML = html;

    container.querySelector('#event-type-sel').addEventListener('change', e => {
      container.querySelector('#rule-event-config').innerHTML =
        this._ruleConfigFields(e.target.value, {});
    });

    container.querySelector('#rule-cancel').addEventListener('click', () => {
      container.innerHTML = '';
    });

    container.querySelector('#rule-save').addEventListener('click', async () => {
      clearFieldErrors(container);
      const nameInput = container.querySelector('[name=rule-name]');
      const name = nameInput.value.trim();
      const evType = container.querySelector('[name=event-type]').value;
      const channelId = container.querySelector('[name=channel-id]').value;
      const cooldown = +container.querySelector('[name=cooldown]').value;
      const enabled = container.querySelector('[name=rule-enabled]').checked;
      if (!name) { setFieldError(nameInput, 'Name is required'); return; }

      const config = this._collectRuleConfig(evType);
      const body = {
        name,
        event_type: evType,
        config,
        channel_id: channelId ? +channelId : null,
        cooldown_minutes: cooldown,
        enabled,
      };

      try {
        if (isEdit) {
          await api.put(`/notifications/rules/${rule.id}`, body);
          showToast('Rule updated', 'success');
        } else {
          await api.post('/notifications/rules', body);
          showToast('Rule created', 'success');
        }
        container.innerHTML = '';
        await this._load();
      } catch (err) {
        if (applyServerErrors(container, err, (f) => container.querySelector(`[name=${f === 'name' ? 'rule-name' : f}]`))) return;
        showToast(err.message || 'Save failed', 'error');
      }
    });
  }

  async _deleteRule(id) {
    const r = this._rules.find(x => x.id === id);
    if (!await confirmDialog(`Delete rule "${r?.name}"?`, { danger: true })) return;
    try {
      await api.delete(`/notifications/rules/${id}`);
      showToast('Rule deleted', 'success');
      await this._load();
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  async _refreshHistory() {
    try {
      this._history = await api.get('/notifications/history?limit=100');
      this._renderTab();
    } catch (err) {
      showToast(err.message || 'Refresh failed', 'error');
    }
  }
}

customElements.define('notifications-page', NotificationsPage);


// ── Alerting workspace (Phase 26.4) ───────────────────────────────────────────
// One "when something happens, tell someone" surface: Notifications (channels +
// rules) and Integrations (Zabbix, GeoIP, …) as tabs. Each tab hosts the existing
// module component; `?view=` deep-links a tab. The <integrations-page> element is
// defined by the integrations module, which loads independently of nav.
const ALERT_STYLE = `
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
    /* The tab pages carry their own padding and flow naturally; the body scrolls. */
    .ws-body { flex: 1; min-height: 0; overflow-y: auto; }
  </style>
`;

const ALERT_TABS = [
  ['notifications', 'Notifications', 'notifications-page'],
  ['integrations', 'Integrations', 'integrations-page'],
];

class AlertingWorkspace extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._view = 'notifications';
  }

  connectedCallback() {
    const query = (location.hash.split('?')[1]) || '';
    const v = new URLSearchParams(query).get('view');
    if (ALERT_TABS.some(([id]) => id === v)) this._view = v;

    this.shadowRoot.innerHTML = `
      ${ALERT_STYLE}
      <div class="ws-switch">
        ${ALERT_TABS.map(([id, label]) => `<button data-v="${id}">${label}</button>`).join('')}
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
    const tag = (ALERT_TABS.find(([id]) => id === this._view) || ALERT_TABS[0])[2];
    this.shadowRoot.getElementById('ws-body').replaceChildren(document.createElement(tag));
  }
}
customElements.define('alerting-workspace', AlertingWorkspace);

router.register('/notifications', () => document.createElement('alerting-workspace'));
