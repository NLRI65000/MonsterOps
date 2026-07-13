import { api } from '/js/api.js';
import { router } from '/js/router.js';
import { toast as showToast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { openModal } from '/js/components/mr-modal.js';

const ACTION_LABELS = {
  log:              'Log event',
  notify_webhook:   'POST to webhook URL',
  disable_user:     'Disable user',
  add_to_group:     'Add user to group',
  remove_from_group:'Remove user from group',
  send_email:       'Send email',
};

const ACTION_CONFIGS = {
  log:              [],
  notify_webhook:   [{ key: 'url',    label: 'Webhook URL',      placeholder: 'https://…' },
                     { key: 'secret', label: 'Secret (optional)', placeholder: 'HMAC signing key' }],
  disable_user:     [],
  add_to_group:     [{ key: 'group', label: 'Group name', placeholder: 'staff' }],
  remove_from_group:[{ key: 'group', label: 'Group name', placeholder: 'temp' }],
  send_email:       [{ key: 'to',      label: 'To address',           placeholder: 'admin@example.com' },
                     { key: 'subject', label: 'Subject (optional)',   placeholder: 'MonsterOps alert' }],
};

const KNOWN_EVENTS = [
  '*', 'audit.*', 'user.*', 'nas.*', 'group.*',
  'user.created', 'user.updated', 'user.deleted',
  'nas.created', 'nas.updated', 'nas.deleted',
  'group.created', 'group.deleted',
  'audit.admin.login', 'test.ping',
];

const CONDITION_FIELDS = ['type', 'actor', 'entity_type', 'entity_id'];
const OP_LABELS = {
  eq: 'equals', neq: 'not equals', contains: 'contains',
  startswith: 'starts with', endswith: 'ends with', regex: 'regex',
};

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function badge(text, color) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600;background:${color}22;color:${color};border:1px solid ${color}44">${text}</span>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class AutomationPage extends HTMLElement {
  connectedCallback() {
    this._rules = [];
    this._openModal = null;
    this.render();
    this._load();
  }

  disconnectedCallback() {
    if (this._modal) {
      this._modal.close();
      this._modal = null;
    }
  }

  render() {
    this.innerHTML = `
      <style>
        .au-root { padding: 1.5rem; max-width: 1100px; }
        .au-root h1 { margin: 0 0 0.4rem; font-size: 1.4rem; color: var(--color-text); }
        .au-subtitle { color: var(--color-muted); font-size: 0.88rem; margin: 0 0 1.5rem; }
        .au-section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .au-count { color: var(--color-muted); font-size: 0.88rem; }

        /* Buttons */
        .au-btn { padding: 0.45rem 1rem; border: none; border-radius: 6px; cursor: pointer; font-size: 0.88rem; font-weight: 500; transition: opacity 0.15s; line-height: 1.4; }
        .au-btn:hover { opacity: 0.82; }
        .au-btn-primary { background: var(--color-accent); color: #fff; }
        .au-btn-danger  { background: var(--color-danger, #c62828); color: #fff; }
        .au-btn-ghost   { background: var(--color-surface-alt, #2a2a2a); color: var(--color-text); border: 1px solid var(--color-border); }
        .au-btn-sm      { padding: 0.28rem 0.65rem; font-size: 0.79rem; }

        /* Table */
        .au-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .au-table th { text-align: left; padding: 0.5rem 0.75rem; color: var(--color-muted); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--color-border); }
        .au-table td { padding: 0.65rem 0.75rem; border-bottom: 1px solid var(--color-border); vertical-align: top; }
        .au-table tr:last-child td { border-bottom: none; }
        .au-table tbody tr:hover td { background: var(--color-surface-alt, #1e1e2e); }
        .au-actions { display: flex; gap: 0.35rem; flex-wrap: wrap; }
        .au-empty { color: var(--color-muted); padding: 3rem; text-align: center; font-size: 0.9rem; }

        /* Tags */
        .au-pattern-tag { font-family: var(--font-mono, monospace); font-size: 0.78rem; background: var(--color-accent)18; color: var(--color-accent); padding: 2px 7px; border-radius: 3px; border: 1px solid var(--color-accent)30; }
        .au-action-tag  { font-size: 0.78rem; background: var(--mr-surface-raised); color: var(--mr-text); padding: 2px 7px; border-radius: 3px; border: 1px solid var(--mr-hairline); }
        .au-sub-text    { font-size: 0.76rem; color: var(--color-muted); margin-top: 3px; }
        .au-trigger     { font-size: 0.78rem; color: var(--color-muted); }

        /* Modal */
        .au-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.58); z-index: 300; display: flex; align-items: flex-start; justify-content: center; padding: 2rem 1rem; overflow-y: auto; }
        .au-modal { background: var(--color-surface); border-radius: 10px; padding: 2rem; width: 100%; max-width: 620px; box-shadow: 0 12px 60px rgba(0,0,0,0.45); margin: auto; }
        .au-modal-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 1.5rem; color: var(--color-text); }
        .au-form-group { margin-bottom: 1.1rem; }
        .au-label { display: block; font-size: 0.81rem; color: var(--color-muted); margin-bottom: 0.3rem; font-weight: 500; }
        .au-label-inline { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.88rem; color: var(--color-text); }
        .au-input, .au-select {
          width: 100%; box-sizing: border-box;
          padding: 0.48rem 0.7rem;
          border: 1px solid var(--mr-hairline);
          border-radius: 6px;
          background: var(--mr-canvas);
          color: var(--mr-text);
          font-size: 0.9rem;
          font-family: inherit;
          color-scheme: inherit;
        }
        .au-input:focus, .au-select:focus {
          outline: none;
          border-color: var(--mr-action);
          box-shadow: 0 0 0 3px var(--mr-action-tint);
        }
        .au-input:focus, .au-select:focus { outline: none; border-color: var(--color-accent); }
        .au-help { font-size: 0.77rem; color: var(--color-muted); margin-top: 0.25rem; }
        .au-modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.75rem; padding-top: 1rem; border-top: 1px solid var(--color-border); }
        .au-section-label { font-size: 0.78rem; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.5rem; }

        /* Condition rows */
        .au-cond-list { display: flex; flex-direction: column; gap: 0.4rem; }
        .au-cond-row { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 0.4rem; align-items: center; }
        .au-cond-row .au-select,
        .au-cond-row .au-input { margin: 0; }
        .au-cond-remove { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; font-size: 0.85rem; }
        .au-add-cond { margin-top: 0.5rem; }
      </style>
      <div class="au-root">
        <h1>Automation Rules</h1>
        <p class="au-subtitle">Rules fire automatically when events occur — disable a user, add them to a group, POST to a webhook, or send an email.</p>
        <div class="au-section-header">
          <span class="au-count" id="au-rule-count"></span>
          <button class="au-btn au-btn-primary" id="au-btn-new">+ New Rule</button>
        </div>
        <div id="au-table-area"></div>
      </div>
    `;
    this.querySelector('#au-btn-new').addEventListener('click', () => this._openForm(null));
  }

  _renderTable() {
    const area = this.querySelector('#au-table-area');
    const count = this.querySelector('#au-rule-count');
    if (!area || !count) return; // element was unmounted
    count.textContent = `${this._rules.length} rule${this._rules.length !== 1 ? 's' : ''}`;

    if (!this._rules.length) {
      area.innerHTML = `<div class="au-empty">No automation rules yet. Click <strong>+ New Rule</strong> to get started.</div>`;
      return;
    }

    area.innerHTML = `
      <table class="au-table">
        <thead><tr>
          <th>Name</th>
          <th>Trigger</th>
          <th>Action</th>
          <th>Status</th>
          <th>Triggered</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${this._rules.map(r => `
            <tr>
              <td><strong>${esc(r.name)}</strong></td>
              <td>
                <span class="au-pattern-tag">${esc(r.event_pattern)}</span>
                ${(r.conditions || []).length
                  ? `<div class="au-sub-text">+ ${r.conditions.length} condition${r.conditions.length !== 1 ? 's' : ''}</div>`
                  : ''}
              </td>
              <td>
                <span class="au-action-tag">${ACTION_LABELS[r.action_type] || esc(r.action_type)}</span>
                ${this._configSummary(r)}
              </td>
              <td>${r.enabled
                ? badge('enabled', 'var(--color-success,#4caf50)')
                : badge('disabled', 'var(--color-muted)')}</td>
              <td class="au-trigger">
                ${r.trigger_count
                  ? `${r.trigger_count}× &nbsp;<span style="color:var(--color-muted);font-size:0.74rem">${fmtDate(r.last_triggered_at)}</span>`
                  : '—'}
              </td>
              <td>
                <div class="au-actions">
                  <button class="au-btn au-btn-ghost au-btn-sm" data-action="test"   data-id="${r.id}">▶ Test</button>
                  <button class="au-btn au-btn-ghost au-btn-sm" data-action="edit"   data-id="${r.id}">Edit</button>
                  <button class="au-btn au-btn-danger au-btn-sm" data-action="delete" data-id="${r.id}">Delete</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    area.querySelectorAll('[data-action]').forEach(btn => {
      const id = parseInt(btn.dataset.id, 10);
      const rule = this._rules.find(r => r.id === id);
      if (btn.dataset.action === 'delete') btn.addEventListener('click', () => this._delete(id, rule?.name));
      else if (btn.dataset.action === 'edit')   btn.addEventListener('click', () => this._openForm(rule));
      else if (btn.dataset.action === 'test')   btn.addEventListener('click', () => this._test(id, rule?.name));
    });
  }

  _configSummary(r) {
    const cfg = r.action_config || {};
    if (r.action_type === 'notify_webhook' && cfg.url)
      return `<div class="au-sub-text" style="font-family:var(--font-mono,monospace);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(cfg.url)}">${esc(cfg.url)}</div>`;
    if ((r.action_type === 'add_to_group' || r.action_type === 'remove_from_group') && cfg.group)
      return `<div class="au-sub-text">group: <code>${esc(cfg.group)}</code></div>`;
    if (r.action_type === 'send_email' && cfg.to)
      return `<div class="au-sub-text">${esc(cfg.to)}</div>`;
    return '';
  }

  async _load() {
    try {
      this._rules = await api.get('/automation');
      this._renderTable();
    } catch (err) {
      showToast(err.message || 'Failed to load rules', 'error');
    }
  }

  async _delete(id, name) {
    if (!await confirmDialog(`Delete rule "${name}"?`, { title: 'Delete Rule', danger: true })) return;
    try {
      await api.delete(`/automation/${id}`);
      showToast('Rule deleted', 'success');
      await this._load();
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  async _test(id, name) {
    try {
      await api.post(`/automation/${id}/test`, {});
      showToast(`Test event queued for "${name}"`, 'success');
    } catch (err) {
      showToast(err.message || 'Test failed', 'error');
    }
  }

  _openForm(rule) {
    // Close any previously open modal
    if (this._modal) this._modal.close();

    const isEdit = !!rule;

    // Determine initial pattern state
    const existingPattern = rule?.event_pattern || '';
    const patternIsKnown  = KNOWN_EVENTS.includes(existingPattern);
    // Select shows existing if known; otherwise first item
    const selectValue     = patternIsKnown ? existingPattern : KNOWN_EVENTS[0];
    // Custom field is pre-filled only when the pattern is NOT in the known list
    const customValue     = patternIsKnown ? '' : existingPattern;

    const conditions = (rule?.conditions || []).map(c => ({ ...c }));

    const m = openModal({
      title: isEdit ? 'Edit automation rule' : 'New automation rule',
      subtitle: 'Run an action automatically when a matching event fires.',
      submitLabel: isEdit ? 'Save changes' : 'Create rule',
      bodyHTML: `
        <div class="mrm-field">
          <label class="mrm-label" for="au-f-name">Rule name</label>
          <input id="au-f-name" class="mrm-input" value="${esc(rule?.name || '')}" placeholder="e.g. Disable temp users">
        </div>

        <div class="mrm-field">
          <label class="mrm-label" for="au-f-pattern">When this event fires</label>
          <select id="au-f-pattern" class="mrm-select mrm-mono">
            ${KNOWN_EVENTS.map(e => `<option value="${e}" ${e === selectValue ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
          <input id="au-f-pattern-custom" class="mrm-input mrm-mono"
            value="${esc(customValue)}"
            placeholder="Custom pattern — overrides the selection above">
          <div class="mrm-help">Leave the custom field empty to use the selection above.</div>
        </div>

        <div class="mrm-field">
          <span class="mrm-label">Conditions <span class="mrm-label-note">— all must match (optional)</span></span>
          <div class="mrm-cond-list" id="au-cond-list">
            ${conditions.map((c, i) => this._condRowHtml(i, c)).join('')}
          </div>
          <button type="button" class="mrm-btn mrm-btn-ghost mrm-add" id="au-btn-add-cond">+ Add condition</button>
        </div>

        <div class="mrm-field">
          <label class="mrm-label" for="au-f-action">Action to run</label>
          <select id="au-f-action" class="mrm-select">
            ${Object.entries(ACTION_LABELS).map(([k, v]) => `<option value="${k}" ${rule?.action_type === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>

        <div id="au-action-config"></div>

        <label class="mrm-check">
          <input type="checkbox" id="au-f-enabled" ${!isEdit || rule.enabled ? 'checked' : ''}>
          Rule enabled
        </label>
      `,
    });

    this._modal = m;
    const overlay = m.overlay;

    // Action config: re-render whenever action changes; do NOT carry over old config
    const renderActionConfig = (preserveValues = false) => {
      const action = overlay.querySelector('#au-f-action').value;
      const fields = ACTION_CONFIGS[action] || [];
      const cfg = preserveValues ? (rule?.action_type === action ? (rule?.action_config || {}) : {}) : {};
      const area = overlay.querySelector('#au-action-config');
      if (!fields.length) { area.innerHTML = ''; return; }
      area.innerHTML = fields.map(f => `
        <div class="mrm-field">
          <label class="mrm-label">${esc(f.label)}</label>
          <input class="mrm-input" data-cfg-key="${esc(f.key)}" value="${esc(cfg[f.key] || '')}" placeholder="${esc(f.placeholder || '')}">
        </div>
      `).join('');
    };

    overlay.querySelector('#au-f-action').addEventListener('change', () => renderActionConfig(false));
    renderActionConfig(true); // initial render keeps existing config if action matches

    // Conditions
    let condIdx = conditions.length;
    overlay.querySelector('#au-btn-add-cond').addEventListener('click', () => {
      const list = overlay.querySelector('#au-cond-list');
      const div = document.createElement('div');
      div.innerHTML = this._condRowHtml(condIdx++, {});
      const row = div.firstElementChild;
      list.appendChild(row);
      row.querySelector('.au-cond-remove').addEventListener('click', () => row.remove());
    });

    // Wire remove buttons for initial conditions
    overlay.querySelectorAll('.au-cond-remove').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.au-cond-row').remove());
    });

    // Save
    m.onSubmit(async () => {
      const name = overlay.querySelector('#au-f-name').value.trim();
      const customPat = overlay.querySelector('#au-f-pattern-custom').value.trim();
      const event_pattern = customPat || overlay.querySelector('#au-f-pattern').value;
      const action_type = overlay.querySelector('#au-f-action').value;
      const enabled = overlay.querySelector('#au-f-enabled').checked;

      const conditions_out = [...overlay.querySelectorAll('.au-cond-row')].map(row => ({
        field: row.querySelector('.au-cond-field').value,
        op:    row.querySelector('.au-cond-op').value,
        value: row.querySelector('.au-cond-val').value.trim(),
      })).filter(c => c.value !== ''); // only keep conditions where the value is filled

      const action_config = {};
      overlay.querySelectorAll('[data-cfg-key]').forEach(el => {
        if (el.value.trim()) action_config[el.dataset.cfgKey] = el.value.trim();
      });

      if (!name) { showToast('Name is required', 'error'); return; }
      if (!event_pattern) { showToast('Event pattern is required', 'error'); return; }

      const saveBtn = m.submitBtn;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      const body = { name, event_pattern, conditions: conditions_out, action_type, action_config, enabled };
      try {
        if (isEdit) await api.put(`/automation/${rule.id}`, body);
        else        await api.post('/automation', body);
        showToast(isEdit ? 'Rule updated' : 'Rule created', 'success');
        m.close();
        await this._load();
      } catch (err) {
        showToast(err.message || 'Save failed', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Save changes' : 'Create rule';
      }
    });
  }

  _condRowHtml(idx, c) {
    const fieldOpts = CONDITION_FIELDS.map(f =>
      `<option value="${f}" ${c.field === f ? 'selected' : ''}>${f}</option>`
    ).join('');
    const opOpts = Object.entries(OP_LABELS).map(([k, v]) =>
      `<option value="${k}" ${c.op === k ? 'selected' : ''}>${v}</option>`
    ).join('');
    // .mrm-* drive the styling; .au-cond-* are the functional hooks the save/remove logic reads.
    return `
      <div class="mrm-cond-row au-cond-row" data-idx="${idx}">
        <select class="mrm-select au-cond-field">${fieldOpts}</select>
        <select class="mrm-select au-cond-op">${opOpts}</select>
        <input  class="mrm-input au-cond-val" value="${esc(c.value || '')}" placeholder="value">
        <button type="button" class="mrm-icon-btn au-cond-remove" title="Remove condition">✕</button>
      </div>
    `;
  }
}

customElements.define('automation-page', AutomationPage);


// ── Automation workspace (Phase 26.3) ─────────────────────────────────────────
// One "event → action" page: Rules + Scheduler + Webhooks (live event stream) as
// tabs. Each tab hosts the existing module component; `?view=` deep-links a tab.
const AW_STYLE = `
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
    .ws-body { flex: 1; min-height: 0; display: flex; }
    .ws-body > * { flex: 1; min-height: 0; }
  </style>
`;

const AW_TABS = [
  ['rules', 'Rules', 'automation-page'],
  ['scheduler', 'Scheduler', 'scheduler-page'],
  ['webhooks', 'Webhooks', 'webhooks-page'],
];

class AutomationWorkspace extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._view = 'rules';
  }

  connectedCallback() {
    const query = (location.hash.split('?')[1]) || '';
    const v = new URLSearchParams(query).get('view');
    if (AW_TABS.some(([id]) => id === v)) this._view = v;

    this.shadowRoot.innerHTML = `
      ${AW_STYLE}
      <div class="ws-switch">
        ${AW_TABS.map(([id, label]) => `<button data-v="${id}">${label}</button>`).join('')}
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
    const tag = (AW_TABS.find(([id]) => id === this._view) || AW_TABS[0])[2];
    this.shadowRoot.getElementById('ws-body').replaceChildren(document.createElement(tag));
  }
}
customElements.define('automation-workspace', AutomationWorkspace);

router.register('/automation', () => document.createElement('automation-workspace'));
