import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { confirmDialog } from '/js/components/app-confirm.js';
import { setFieldError, clearFieldErrors, applyServerErrors } from '/js/utils/form.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }
function pad2(n) { return String(n).padStart(2, '0'); }

const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const STYLE = `
  @import '/css/theme.css';
  :host { display: block; padding: 1.5rem; }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; }
  .page-title  { font-size: 1.25rem; font-weight: 600; }
  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--color-border); margin-bottom: 1.25rem; }
  .tab-btn { padding: 0.55rem 1.1rem; border: none; background: transparent; color: var(--color-muted);
             font-size: 0.85rem; font-family: var(--font); cursor: pointer;
             border-bottom: 2px solid transparent; margin-bottom: -1px; }
  .tab-btn.active { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: 500; }
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
  .badge-ok   { background: var(--mr-accept-tint);              color: var(--mr-accept); }
  .badge-err  { background: var(--mr-reject-tint);              color: var(--mr-reject); }
  .badge-off  { background: rgba(139,149,165,0.12);             color: var(--mr-text-muted); }
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 500;
                   align-items: center; justify-content: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius);
           padding: 1.5rem; min-width: 420px; max-width: 540px; width: 90vw; max-height: 90vh; overflow-y: auto; }
  .modal-header { display: flex; align-items: center; margin-bottom: 1.25rem; }
  .modal-title  { font-size: 1rem; font-weight: 600; flex: 1; }
  .modal-close  { background: none; border: none; font-size: 1.1rem; cursor: pointer; color: var(--color-muted); }
  .modal-footer { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.25rem; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.85rem; }
  .field label { font-size: 0.78rem; font-weight: 500; color: var(--color-muted); }
  .field-hint  { font-size: 0.72rem; color: var(--color-muted); }
  .input, .select { width: 100%; padding: 0.4rem 0.65rem; border: 1px solid var(--color-border);
                    border-radius: var(--radius); background: var(--color-surface); color: var(--color-text);
                    font-size: 0.85rem; font-family: var(--font); box-sizing: border-box; }
  .input:focus, .select:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--mr-action-tint); }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .report-data { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius);
                 padding: 0.75rem; font-size: 0.78rem; white-space: pre-wrap; font-family: monospace;
                 max-height: 400px; overflow-y: auto; }
`;

class SchedulerPage extends HTMLElement {
  constructor() {
    super();
    this._tab = 'jobs';
    this._jobs = [];
    this._editingId = null;
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="page-header">
        <span class="page-title">Scheduler</span>
        <button class="btn btn-primary" id="btn-add">+ New Job</button>
      </div>
      <div class="tabs">
        <button class="tab-btn active" data-tab="jobs">Jobs</button>
        <button class="tab-btn" data-tab="reports">Report History</button>
      </div>
      <div id="tab-content"></div>

      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title" id="modal-title">New Scheduled Job</span>
            <button class="modal-close" id="modal-close">✕</button>
          </div>
          <div id="modal-body"></div>
          <div class="modal-footer">
            <button class="btn" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-submit">Save</button>
          </div>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        this.shadowRoot.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderTab();
      });
    });
    this.shadowRoot.getElementById('btn-add').addEventListener('click', () => this._openModal(null));
    this.shadowRoot.getElementById('modal-close').addEventListener('click', () => this._closeModal());
    this.shadowRoot.getElementById('modal-cancel').addEventListener('click', () => this._closeModal());
    this.shadowRoot.getElementById('modal-submit').addEventListener('click', () => this._submitModal());
    this.shadowRoot.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target === this.shadowRoot.getElementById('modal-overlay')) this._closeModal();
    });

    this._loadJobs();
  }

  async _loadJobs() {
    try { this._jobs = await api.get('/scheduler/jobs'); } catch { this._jobs = []; }
    if (this._tab === 'jobs') this._renderTab();
  }

  _renderTab() {
    const tc = this.shadowRoot.getElementById('tab-content');
    if (this._tab === 'jobs') this._renderJobs(tc);
    else this._renderReports(tc);
  }

  _renderJobs(tc) {
    if (!this._jobs.length) {
      tc.innerHTML = '<div class="state-empty">No scheduled jobs. Click <strong>+ New Job</strong> to schedule your first report.</div>';
      return;
    }
    tc.innerHTML = `
      <div class="card">
        <table>
          <thead><tr>
            <th>Name</th><th>Type</th><th>Schedule</th><th>Recipients</th><th>Last Run</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${this._jobs.map(j => `
              <tr>
                <td style="font-weight:500;">${esc(j.name)}</td>
                <td style="color:var(--color-muted);font-size:0.78rem;">${esc(j.job_type)}</td>
                <td style="font-size:0.78rem;">${this._formatCron(j)}</td>
                <td style="font-size:0.75rem;color:var(--color-muted);">${(j.recipients||[]).join(', ') || '—'}</td>
                <td style="color:var(--color-muted);font-size:0.78rem;">${fmtDate(j.last_run_at)}</td>
                <td>${j.enabled
                  ? '<span class="badge badge-ok">Active</span>'
                  : '<span class="badge badge-off">Disabled</span>'}</td>
                <td style="white-space:nowrap;">
                  <button class="btn btn-sm" data-action="run" data-id="${j.id}" title="Run now">▶ Run</button>
                  <button class="btn btn-sm" data-action="edit" data-id="${j.id}" style="margin-left:4px;">Edit</button>
                  <button class="btn btn-sm btn-danger" data-action="delete" data-id="${j.id}" style="margin-left:4px;">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    tc.querySelectorAll('[data-action]').forEach(btn => {
      const id = parseInt(btn.dataset.id);
      if (btn.dataset.action === 'run')    btn.addEventListener('click', () => this._runJob(id, btn));
      if (btn.dataset.action === 'edit')   btn.addEventListener('click', () => this._openModal(id));
      if (btn.dataset.action === 'delete') btn.addEventListener('click', () => this._deleteJob(id));
    });
  }

  async _renderReports(tc) {
    tc.innerHTML = '<div class="state-loading">Loading…</div>';
    try {
      const reports = await api.get('/scheduler/reports?limit=50');
      if (!reports.length) {
        tc.innerHTML = '<div class="state-empty">No reports generated yet. Jobs run on their configured schedule.</div>';
        return;
      }
      tc.innerHTML = `
        <div class="card">
          <table>
            <thead><tr>
              <th>Job</th><th>Type</th><th>Run At</th><th>Status</th><th>Period</th><th></th>
            </tr></thead>
            <tbody>
              ${reports.map(r => `
                <tr>
                  <td style="font-weight:500;">${esc(r.job_name)}</td>
                  <td style="color:var(--color-muted);font-size:0.78rem;">${esc(r.job_type)}</td>
                  <td style="color:var(--color-muted);font-size:0.78rem;">${fmtDate(r.run_at)}</td>
                  <td>${r.status === 'ok'
                    ? '<span class="badge badge-ok">OK</span>'
                    : '<span class="badge badge-err">Error</span>'}</td>
                  <td style="font-size:0.75rem;color:var(--color-muted);">
                    ${r.data ? `${r.data.period_start?.slice(0,10) || ''} – ${r.data.period_end?.slice(0,10) || ''}` : (r.error_message ? esc(r.error_message.slice(0,60)) : '—')}
                  </td>
                  <td>
                    ${r.data ? `<button class="btn btn-sm" data-action="view" data-report='${esc(JSON.stringify(r))}'>View</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      tc.querySelectorAll('[data-action="view"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const r = JSON.parse(btn.dataset.report);
          this._showReport(r);
        });
      });
    } catch (e) {
      tc.innerHTML = `<div class="state-error">${esc(e.message)}</div>`;
    }
  }

  _showReport(r) {
    const body = this.shadowRoot.getElementById('modal-body');
    this.shadowRoot.getElementById('modal-title').textContent = `Report: ${r.job_name}`;
    this.shadowRoot.getElementById('modal-submit').style.display = 'none';
    body.innerHTML = `
      <div style="font-size:0.83rem;margin-bottom:0.75rem;">
        <strong>Run at:</strong> ${fmtDate(r.run_at)} &nbsp;|&nbsp;
        <strong>Status:</strong> ${r.status}
      </div>
      <div class="report-data">${esc(JSON.stringify(r.data, null, 2))}</div>
    `;
    this.shadowRoot.getElementById('modal-overlay').classList.add('open');
  }

  _formatCron(j) {
    const time = `${pad2(j.cron_hour)}:${pad2(j.cron_minute)}`;
    if (j.cron_weekday !== null && j.cron_weekday !== undefined)
      return `${WEEKDAYS[j.cron_weekday]} at ${time} UTC`;
    return `Daily at ${time} UTC`;
  }

  async _runJob(id, btn) {
    btn.disabled = true;
    try {
      await api.post(`/scheduler/jobs/${id}/run`);
      toast('Job triggered — check Report History in a moment', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async _deleteJob(id) {
    if (!(await confirmDialog('Delete this scheduled job?', { title: 'Delete job', danger: true }))) return;
    try {
      await api.delete(`/scheduler/jobs/${id}`);
      toast('Job deleted', 'success');
      await this._loadJobs();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  _openModal(id) {
    const j = id != null ? this._jobs.find(x => x.id === id) : null;
    this._editingId = id ?? null;
    const body = this.shadowRoot.getElementById('modal-body');
    this.shadowRoot.getElementById('modal-title').textContent = j ? 'Edit Job' : 'New Scheduled Job';
    this.shadowRoot.getElementById('modal-submit').style.display = '';
    body.innerHTML = `
      <div class="field">
        <label>Job Name</label>
        <input class="input" id="j-name" value="${esc(j?.name ?? '')}" placeholder="Daily Summary" ${j ? 'readonly' : ''} />
      </div>
      <div class="field">
        <label>Job Type</label>
        <select class="select" id="j-type" ${j ? 'disabled' : ''}>
          <optgroup label="Reports">
            <option value="daily_summary"         ${j?.job_type === 'daily_summary'         ? 'selected' : ''}>Daily Summary</option>
            <option value="weekly_summary"        ${j?.job_type === 'weekly_summary'        ? 'selected' : ''}>Weekly Summary</option>
          </optgroup>
          <optgroup label="Automation">
            <option value="expired_user_cleanup"  ${j?.job_type === 'expired_user_cleanup'  ? 'selected' : ''}>Expired User Cleanup</option>
            <option value="stale_session_sweep"   ${j?.job_type === 'stale_session_sweep'   ? 'selected' : ''}>Stale Session Sweep</option>
            <option value="log_retention"         ${j?.job_type === 'log_retention'         ? 'selected' : ''}>Log Retention (prune old logs)</option>
          </optgroup>
        </select>
      </div>
      <div class="form-row">
        <div class="field">
          <label>Hour (UTC, 0–23)</label>
          <input class="input" id="j-hour" type="number" min="0" max="23" value="${j?.cron_hour ?? 0}" />
        </div>
        <div class="field">
          <label>Minute (0–59)</label>
          <input class="input" id="j-minute" type="number" min="0" max="59" value="${j?.cron_minute ?? 0}" />
        </div>
      </div>
      <div class="field">
        <label>Weekday <span style="font-weight:400;">(optional — leave blank to run every day)</span></label>
        <select class="select" id="j-weekday">
          <option value="">— Run every day —</option>
          ${WEEKDAYS.map((d,i) => `<option value="${i}" ${j?.cron_weekday === i ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Email Recipients <span style="font-weight:400;">(comma-separated, optional)</span></label>
        <input class="input" id="j-recipients" value="${esc((j?.recipients||[]).join(', '))}" placeholder="admin@example.com, ops@example.com" />
        <span class="field-hint">Leave blank to generate reports without emailing. Requires SMTP configuration.</span>
      </div>
      <div class="field">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <input type="checkbox" id="j-enabled" ${(j?.enabled ?? true) ? 'checked' : ''} />
          <label for="j-enabled" style="font-size:0.82rem;color:var(--color-text);">Enabled</label>
        </div>
      </div>
    `;
    this.shadowRoot.getElementById('modal-overlay').classList.add('open');
  }

  async _submitModal() {
    const sr = this.shadowRoot;
    const name      = sr.getElementById('j-name')?.value.trim();
    const job_type  = sr.getElementById('j-type')?.value;
    const cron_hour = parseInt(sr.getElementById('j-hour')?.value || '0');
    const cron_minute = parseInt(sr.getElementById('j-minute')?.value || '0');
    const weekdayVal  = sr.getElementById('j-weekday')?.value;
    const cron_weekday = weekdayVal !== '' ? parseInt(weekdayVal) : null;
    const recipientsRaw = sr.getElementById('j-recipients')?.value || '';
    const recipients = recipientsRaw.split(',').map(s => s.trim()).filter(Boolean);
    const enabled    = sr.getElementById('j-enabled')?.checked ?? true;

    clearFieldErrors(sr);
    if (!name) { setFieldError(sr.getElementById('j-name'), 'Job name is required'); return; }
    try {
      if (this._editingId != null) {
        await api.put(`/scheduler/jobs/${this._editingId}`, { cron_hour, cron_minute, cron_weekday, recipients, enabled });
        toast('Job updated', 'success');
      } else {
        await api.post('/scheduler/jobs', { name, job_type, cron_hour, cron_minute, cron_weekday, recipients, enabled });
        toast('Job created', 'success');
      }
      this._closeModal();
      await this._loadJobs();
    } catch (e) {
      if (!applyServerErrors(sr, e, (f) => sr.getElementById('j-' + f.replace(/_/g, '-')))) toast(e.message, 'error');
    }
  }

  _closeModal() {
    this.shadowRoot.getElementById('modal-overlay').classList.remove('open');
    this._editingId = null;
    this.shadowRoot.getElementById('modal-submit').style.display = '';
  }
}

customElements.define('scheduler-page', SchedulerPage);

// Retired standalone route → redirect into the Automation workspace tab so
// bookmarks keep working. The <scheduler-page> element stays, hosted by the tab.
function _schedRedirect(to) {
  queueMicrotask(() => router.navigate(to));
  const d = document.createElement('div');
  d.style.cssText = 'padding:2rem;color:var(--color-muted);font-size:0.8rem;';
  d.textContent = 'Redirecting…';
  return d;
}
router.register('/scheduler', () => _schedRedirect('/automation?view=scheduler'));
