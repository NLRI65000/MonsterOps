import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { emptyStateHTML, emptyRowHTML, skeletonBlock } from '/js/utils/empty.js';

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Reports are all time-bounded, so a table with no rows means nothing happened
// in the selected range — say that, and hint at widening it.
const noDataRow = (cols) => emptyRowHTML(cols, {
  title: 'No data in this range',
  message: 'No activity recorded for the selected time range — try a wider range.',
});

function _fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(1) + ' ' + u[i];
}

function _fmtDuration(secs) {
  if (!secs) return '0s';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

function _fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STYLE = `
  <style>
    @import '/css/theme.css';
    :host { display: block; padding: 1.5rem; }
    .page-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1.25rem; color: var(--color-text); }
    .toolbar { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.25rem; }
    .seg { display: flex; border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; }
    .seg button { padding: 0.35rem 0.75rem; background: var(--color-surface); border: none; border-right: 1px solid var(--color-border); font-size: 0.8rem; font-family: var(--font); color: var(--color-muted); cursor: pointer; }
    .seg button:last-child { border-right: none; }
    .seg button.active { background: var(--color-accent); color: #fff; }
    .tab-bar { display: flex; border-bottom: 2px solid var(--color-border); margin-bottom: 1rem; gap: 0; overflow-x: auto; }
    .tab-bar button { padding: 0.5rem 1.1rem; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; font-size: 0.85rem; font-family: var(--font); color: var(--color-muted); cursor: pointer; white-space: nowrap; }
    .tab-bar button.active { color: var(--color-accent); border-bottom-color: var(--color-accent); font-weight: 600; }
    .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius); margin-bottom: 1rem; }
    .card-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border); }
    .card-title { font-size: 0.85rem; font-weight: 600; color: var(--color-text); }
    .btn { padding: 0.35rem 0.75rem; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface); color: var(--color-text); font-size: 0.8rem; font-family: var(--font); cursor: pointer; }
    .btn:hover { background: var(--color-bg); }
    .btn-export { border-color: var(--color-accent); color: var(--color-accent); }
    .btn-export:hover { background: var(--mr-action-tint); }
    .chart-wrap { padding: 1rem; }
    canvas { width: 100%; height: 200px; display: block; }
    table { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
    th { text-align: left; padding: 0.4rem 0.75rem; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted); border-bottom: 1px solid var(--color-border); background: var(--color-bg); }
    th.r, td.r { text-align: right; }
    td { padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--color-border); color: var(--color-text); }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--color-bg); }
    .badge { display: inline-block; padding: 0.12rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
    .badge-success { background: var(--mr-accept-tint); color: var(--mr-accept); }
    .badge-danger  { background: var(--mr-reject-tint); color: var(--mr-reject); }
    .rank { color: var(--color-muted); font-size: 0.75rem; font-weight: 700; }
    .bar-bg { background: var(--color-border); border-radius: 9999px; height: 6px; min-width: 60px; }
    .bar-fill { height: 6px; border-radius: 9999px; background: var(--color-accent); }
    td.mono { font-family: var(--mr-font-data); font-size: 0.8rem; }
  </style>
`;

const TABS = [
  { key: 'login-frequency', label: 'Login Frequency' },
  { key: 'bandwidth',       label: 'Bandwidth' },
  { key: 'top-users',       label: 'Top Users' },
  { key: 'failed-trend',    label: 'Failed Trend' },
  { key: 'nas-traffic',     label: 'NAS Traffic' },
  { key: 'online-time',     label: 'Online Time' },
];

const RANGES = [
  { key: '24h', label: '24h', bucket: 'hour' },
  { key: '7d',  label: '7d',  bucket: 'day' },
  { key: '30d', label: '30d', bucket: 'day' },
  { key: '90d', label: '90d', bucket: 'day' },
];

class ReportsView extends HTMLElement {
  _range = '7d';
  _tab = 'login-frequency';

  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this._render();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      ${STYLE}
      <div class="page-title">Reports</div>
      <div class="toolbar">
        <div class="seg" id="range-seg">
          ${RANGES.map(r => `<button data-r="${r.key}" class="${r.key === this._range ? 'active' : ''}">${r.label}</button>`).join('')}
        </div>
        <button class="btn btn-export" id="export-btn">&#8659; Export CSV</button>
      </div>
      <div class="tab-bar" id="tab-bar">
        ${TABS.map(t => `<button data-t="${t.key}" class="${t.key === this._tab ? 'active' : ''}">${t.label}</button>`).join('')}
      </div>
      <div id="tab-content"></div>
    `;

    this.shadowRoot.getElementById('range-seg').addEventListener('click', e => {
      const btn = e.target.closest('button[data-r]');
      if (!btn) return;
      this._range = btn.dataset.r;
      this.shadowRoot.querySelectorAll('#range-seg button').forEach(b => b.classList.toggle('active', b.dataset.r === this._range));
      this._loadTab();
    });

    this.shadowRoot.getElementById('tab-bar').addEventListener('click', e => {
      const btn = e.target.closest('button[data-t]');
      if (!btn) return;
      this._tab = btn.dataset.t;
      this.shadowRoot.querySelectorAll('.tab-bar button').forEach(b => b.classList.toggle('active', b.dataset.t === this._tab));
      this._loadTab();
    });

    this.shadowRoot.getElementById('export-btn').addEventListener('click', () => this._export());

    this._loadTab();
  }

  _bucket() {
    return RANGES.find(r => r.key === this._range)?.bucket ?? 'day';
  }

  async _loadTab() {
    const content = this.shadowRoot.getElementById('tab-content');
    content.innerHTML = skeletonBlock(this.shadowRoot, 8);
    try {
      await this['_render_' + this._tab.replace(/-/g, '_')](content);
    } catch (e) {
      content.innerHTML = emptyStateHTML({
        title: 'Couldn’t load this report',
        message: e.message || 'Something went wrong. Try again.',
      });
    }
  }

  // ── Login Frequency ──────────────────────────────────────────────────────────

  async _render_login_frequency(el) {
    const data = await api.get(`/reports/login-frequency?range=${this._range}&bucket=${this._bucket()}`);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Authentications over time</span></div>
        <div class="chart-wrap"><canvas id="lf-chart" height="200"></canvas></div>
        <table>
          <thead><tr><th>Period</th><th class="r">Accepts</th><th class="r">Rejects</th><th class="r">Total</th></tr></thead>
          <tbody>
            ${data.length ? data.map(r => `<tr>
              <td>${_fmtDate(r.period)}</td>
              <td class="r"><span class="badge badge-success">${r.accept_count}</span></td>
              <td class="r"><span class="badge badge-danger">${r.reject_count}</span></td>
              <td class="r">${r.accept_count + r.reject_count}</td>
            </tr>`).join('') : noDataRow(4)}
          </tbody>
        </table>
      </div>`;
    if (data.length) this._drawBarChart('lf-chart', data.map(r => ({
      label: _fmtDate(r.period),
      a: r.accept_count,
      b: r.reject_count,
    })), 'Accepts', 'Rejects');
  }

  // ── Bandwidth ────────────────────────────────────────────────────────────────

  async _render_bandwidth(el) {
    const data = await api.get(`/reports/bandwidth?range=${this._range}&bucket=${this._bucket()}`);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Bandwidth over time</span></div>
        <div class="chart-wrap"><canvas id="bw-chart" height="200"></canvas></div>
        <table>
          <thead><tr><th>Period</th><th class="r">Inbound</th><th class="r">Outbound</th><th class="r">Total</th></tr></thead>
          <tbody>
            ${data.length ? data.map(r => `<tr>
              <td>${_fmtDate(r.period)}</td>
              <td class="r">${_fmtBytes(r.input_bytes)}</td>
              <td class="r">${_fmtBytes(r.output_bytes)}</td>
              <td class="r">${_fmtBytes(r.input_bytes + r.output_bytes)}</td>
            </tr>`).join('') : noDataRow(4)}
          </tbody>
        </table>
      </div>`;
    if (data.length) {
      const cs = getComputedStyle(document.documentElement);
      const action = cs.getPropertyValue('--mr-action').trim() || '#4FA8FF';
      const accept = cs.getPropertyValue('--mr-accept').trim() || '#4ADE9A';
      this._drawBarChart('bw-chart', data.map(r => ({
        label: _fmtDate(r.period),
        a: +(r.input_bytes / 1048576).toFixed(2),
        b: +(r.output_bytes / 1048576).toFixed(2),
      })), 'In (MB)', 'Out (MB)', action, accept);
    }
  }

  // ── Top Users ────────────────────────────────────────────────────────────────

  async _render_top_users(el) {
    const data = await api.get(`/reports/top-users?range=${this._range}&limit=10&metric=bandwidth`);
    const max = data.reduce((m, r) => Math.max(m, r.input_bytes + r.output_bytes), 0) || 1;
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Top users by bandwidth</span></div>
        <table>
          <thead><tr><th>#</th><th>Username</th><th class="r">Sessions</th><th class="r">Inbound</th><th class="r">Outbound</th><th class="r">Total</th><th class="r">Online Time</th><th></th></tr></thead>
          <tbody>
            ${data.length ? data.map((r, i) => {
              const total = r.input_bytes + r.output_bytes;
              const pct = Math.round(total / max * 100);
              return `<tr>
                <td><span class="rank">${i + 1}</span></td>
                <td>${_esc(r.username)}</td>
                <td class="r">${r.session_count}</td>
                <td class="r">${_fmtBytes(r.input_bytes)}</td>
                <td class="r">${_fmtBytes(r.output_bytes)}</td>
                <td class="r">${_fmtBytes(total)}</td>
                <td class="r">${_fmtDuration(r.online_seconds)}</td>
                <td style="width:100px"><div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div></td>
              </tr>`;
            }).join('') : noDataRow(8)}
          </tbody>
        </table>
      </div>`;
  }

  // ── Failed Trend ─────────────────────────────────────────────────────────────

  async _render_failed_trend(el) {
    const data = await api.get(`/reports/failed-trend?range=${this._range}&bucket=${this._bucket()}`);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Failed logins over time</span></div>
        <div class="chart-wrap"><canvas id="ft-chart" height="200"></canvas></div>
        <table>
          <thead><tr><th>Period</th><th class="r">Failed Logins</th></tr></thead>
          <tbody>
            ${data.length ? data.map(r => `<tr>
              <td>${_fmtDate(r.period)}</td>
              <td class="r"><span class="badge badge-danger">${r.reject_count}</span></td>
            </tr>`).join('') : noDataRow(2)}
          </tbody>
        </table>
      </div>`;
    if (data.length) this._drawSingleBar('ft-chart', data.map(r => ({
      label: _fmtDate(r.period),
      v: r.reject_count,
    })));
  }

  // ── NAS Traffic ──────────────────────────────────────────────────────────────

  async _render_nas_traffic(el) {
    const data = await api.get(`/reports/nas-traffic?range=${this._range}`);
    const max = data.reduce((m, r) => Math.max(m, r.input_bytes + r.output_bytes), 0) || 1;
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Traffic by NAS</span></div>
        <table>
          <thead><tr><th>NAS IP</th><th>Name</th><th class="r">Sessions</th><th class="r">Inbound</th><th class="r">Outbound</th><th class="r">Total</th><th></th></tr></thead>
          <tbody>
            ${data.length ? data.map(r => {
              const total = r.input_bytes + r.output_bytes;
              const pct = Math.round(total / max * 100);
              return `<tr>
                <td class="mono">${_esc(r.nas_ip)}</td>
                <td>${_esc(r.nas_name ?? '—')}</td>
                <td class="r">${r.session_count}</td>
                <td class="r">${_fmtBytes(r.input_bytes)}</td>
                <td class="r">${_fmtBytes(r.output_bytes)}</td>
                <td class="r">${_fmtBytes(total)}</td>
                <td style="width:100px"><div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div></td>
              </tr>`;
            }).join('') : noDataRow(7)}
          </tbody>
        </table>
      </div>`;
  }

  // ── Online Time ──────────────────────────────────────────────────────────────

  async _render_online_time(el) {
    const data = await api.get(`/reports/online-time?range=${this._range}&limit=20`);
    const max = data.reduce((m, r) => Math.max(m, r.total_seconds), 0) || 1;
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><span class="card-title">Online time per user</span></div>
        <table>
          <thead><tr><th>#</th><th>Username</th><th class="r">Sessions</th><th class="r">Total Time</th><th></th></tr></thead>
          <tbody>
            ${data.length ? data.map((r, i) => {
              const pct = Math.round(r.total_seconds / max * 100);
              return `<tr>
                <td><span class="rank">${i + 1}</span></td>
                <td>${_esc(r.username)}</td>
                <td class="r">${r.session_count}</td>
                <td class="r">${_fmtDuration(r.total_seconds)}</td>
                <td style="width:120px"><div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div></td>
              </tr>`;
            }).join('') : noDataRow(5)}
          </tbody>
        </table>
      </div>`;
  }

  // ── CSV export ───────────────────────────────────────────────────────────────

  async _export() {
    const url = `/api/reports/export?report=${this._tab}&range=${this._range}&bucket=${this._bucket()}`;
    const res = await fetch(url, {
      credentials: 'same-origin',
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this._tab}-${this._range}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Canvas helpers ────────────────────────────────────────────────────────────

  _drawBarChart(id, data, labelA, labelB, colA, colB) {
    requestAnimationFrame(() => {
      const canvas = this.shadowRoot.getElementById(id);
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth || canvas.offsetWidth || 600;
      const H = 200;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const pad = { top: 16, right: 16, bottom: 32, left: 48 };
      const cw = W - pad.left - pad.right;
      const ch = H - pad.top - pad.bottom;

      const maxV = data.reduce((m, d) => Math.max(m, d.a + d.b), 0) || 1;
      const n = data.length;
      const grp = cw / Math.max(n, 1);
      const bw = Math.max(4, grp * 0.35);
      const gap = bw * 0.3;

      const cs = getComputedStyle(document.documentElement);
      const success = colA ?? (cs.getPropertyValue('--mr-accept').trim() || '#4ADE9A');
      const danger  = colB ?? (cs.getPropertyValue('--mr-reject').trim() || '#FF6B5B');
      const muted   = cs.getPropertyValue('--color-muted').trim()  || '#8B95A5';
      const border  = cs.getPropertyValue('--color-border').trim() || '#262C36';
      const text    = cs.getPropertyValue('--color-text').trim()   || '#E6E9EF';

      // Grid
      ctx.strokeStyle = border;
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + ch - (ch * i / 4);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
        ctx.fillStyle = muted;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxV * i / 4), pad.left - 4, y + 3);
      }

      // Bars
      data.forEach((d, i) => {
        const cx = pad.left + i * grp + grp / 2;
        const x1 = cx - bw - gap / 2;
        const x2 = cx + gap / 2;
        const ha = Math.round(d.a / maxV * ch);
        const hb = Math.round(d.b / maxV * ch);

        ctx.fillStyle = success;
        ctx.fillRect(x1, pad.top + ch - ha, bw, ha);
        ctx.fillStyle = danger;
        ctx.fillRect(x2, pad.top + ch - hb, bw, hb);

        // X label
        if (n <= 30) {
          ctx.fillStyle = muted;
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(d.label, cx, H - 6);
        }
      });

      // Legend
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = success; ctx.fillRect(pad.left, H - 14, 10, 8);
      ctx.fillStyle = text; ctx.fillText(labelA, pad.left + 14, H - 7);
      ctx.fillStyle = danger; ctx.fillRect(pad.left + 80, H - 14, 10, 8);
      ctx.fillStyle = text; ctx.fillText(labelB, pad.left + 94, H - 7);
    });
  }

  _drawSingleBar(id, data, colOverride) {
    requestAnimationFrame(() => {
      const canvas = this.shadowRoot.getElementById(id);
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth || canvas.offsetWidth || 600;
      const H = 200;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const pad = { top: 16, right: 16, bottom: 32, left: 48 };
      const cw = W - pad.left - pad.right;
      const ch = H - pad.top - pad.bottom;

      const maxV = data.reduce((m, d) => Math.max(m, d.v), 0) || 1;
      const n = data.length;
      const bw = Math.max(4, (cw / Math.max(n, 1)) * 0.6);

      const cs = getComputedStyle(document.documentElement);
      const color  = colOverride ?? (cs.getPropertyValue('--mr-reject').trim() || '#FF6B5B');
      const muted  = cs.getPropertyValue('--color-muted').trim()  || '#8B95A5';
      const border = cs.getPropertyValue('--color-border').trim() || '#262C36';

      ctx.strokeStyle = border;
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + ch - (ch * i / 4);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
        ctx.fillStyle = muted;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxV * i / 4), pad.left - 4, y + 3);
      }

      data.forEach((d, i) => {
        const x = pad.left + i * (cw / n) + (cw / n) / 2 - bw / 2;
        const h = Math.round(d.v / maxV * ch);
        ctx.fillStyle = color;
        ctx.fillRect(x, pad.top + ch - h, bw, h);
        if (n <= 30) {
          ctx.fillStyle = muted;
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(d.label, x + bw / 2, H - 6);
        }
      });
    });
  }
}

customElements.define('reports-view', ReportsView);
router.register('/reports', () => document.createElement('reports-view'));
