import { router } from '/js/router.js';
import { api } from '/js/api.js';
import { toast } from '/js/components/app-toast.js';
import { sparkline } from '/js/utils/sparkline.js';
import { startPolling } from '/js/utils/poll.js';
import { geoLabelHTML } from '/js/utils/geo.js';

// ── Utilities ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString();
}

function relTime(isoStr) {
  if (!isoStr) return '—';
  const then = new Date(isoStr).getTime();
  if (Number.isNaN(then)) return '—';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function replyBadge(reply) {
  if (reply === 'Access-Accept') return `<span class="badge badge-success">Accept</span>`;
  if (reply === 'Access-Reject') return `<span class="badge badge-danger">Reject</span>`;
  return `<span class="badge badge-muted">${escHtml(reply)}</span>`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ICO_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
const ICO_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
// "Open detail" chevron — the drill-through affordance on widget headers.
const ICO_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

// ── Widget config (localStorage) ───────────────────────────────────────────────

const WIDGET_DEFS = [
  { id: 'w-nas-status',       label: 'NAS Status' },
  { id: 'w-firewall',         label: 'Firewall' },
  { id: 'w-autoblock',        label: 'Auto-Block Activity' },
  { id: 'w-realms',           label: 'Realms' },
  { id: 'w-session-types',    label: 'Session Types' },
  { id: 'w-recent-auth',      label: 'Recent Authentication' },
  { id: 'w-top-bw',           label: 'Top Bandwidth' },
  { id: 'w-online-users',     label: 'Online Users' },
  { id: 'w-integrations',     label: 'Integrations Status' },
];
const WIDGET_STORAGE = 'mr-dashboard-widgets';

function _widgetKey() {
  const user = localStorage.getItem('mr_username') || '';
  return user ? `${WIDGET_STORAGE}:${user}` : WIDGET_STORAGE;
}

function loadWidgetCfg() {
  try {
    const s = localStorage.getItem(_widgetKey());
    if (s) return JSON.parse(s);
  } catch {}
  return Object.fromEntries(WIDGET_DEFS.map(w => [w.id, true]));
}

function saveWidgetCfg(cfg) {
  localStorage.setItem(_widgetKey(), JSON.stringify(cfg));
}

// Bucket recent auth events into a small accept/reject volume histogram.
// Each bucket carries its [start, end) window so the bar can be hovered
// (tooltip) and clicked (→ auth logs for that window).
function authBuckets(rows, n = 24) {
  if (!rows || !rows.length) return [];
  const times = rows.map(r => new Date(r.authdate).getTime()).filter(Number.isFinite);
  if (!times.length) return [];
  const min = Math.min(...times), max = Math.max(...times);
  const span = Math.max(1, max - min);
  const width = span / n;
  const buckets = Array.from({ length: n }, (_, i) => ({
    ok: 0, bad: 0, start: min + i * width, end: min + (i + 1) * width,
  }));
  for (const r of rows) {
    const t = new Date(r.authdate).getTime();
    if (!Number.isFinite(t)) continue;
    const i = Math.min(n - 1, Math.floor(((t - min) / span) * n));
    if (r.reply === 'Access-Reject') buckets[i].bad++; else buckets[i].ok++;
  }
  return buckets;
}

// ── DashboardView ──────────────────────────────────────────────────────────────

class DashboardView extends HTMLElement {
  constructor() {
    super();
    this._range = 'today';
    this._stopPoll = null;
    this._loading = false;
    this._sessHist = [];
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
    this._applyWidgetConfig();
    this._bindCustomizePanel();
    this._load();
    this._startAutoRefresh();
  }

  disconnectedCallback() { this._stopAutoRefresh(); }

  _startAutoRefresh() { this._stopPoll = startPolling(() => this._load(), 30_000); }
  _stopAutoRefresh() { if (this._stopPoll) { this._stopPoll(); this._stopPoll = null; } }

  // A header "open detail" chevron link — the consistent drill-through affordance.
  _goLink(to, label) {
    return `<a class="iconbtn win-go" href="#${to}" title="Open ${label}" aria-label="Open ${label}">${ICO_OPEN}</a>`;
  }

  _win(id, title, sub, bodyId, { flush = false, tools = '', to = '' } = {}) {
    const go = to ? this._goLink(to, title) : '';
    return `
      <div class="win" id="${id}">
        <div class="win-head">
          <span class="win-title">${title}${sub ? ` <span class="sub">/ ${sub}</span>` : ''}</span>
          <span class="win-tools">${tools}${go}</span>
        </div>
        <div class="win-body${flush ? ' flush' : ''}" id="${bodyId}"><div class="skeleton" style="height:88px;"></div></div>
      </div>`;
  }

  _render() {
    const cfg = loadWidgetCfg();
    const refreshBtn = `<button class="iconbtn wgt-refresh" title="Refresh">${ICO_REFRESH}</button>`;
    this.shadowRoot.innerHTML = `
      <style>
        @import '/css/theme.css';
        :host { display: block; }

        .dash-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
        .dash-tools { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
        .rfr { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.7rem; color: var(--mr-text-faint); padding-right: 0.2rem; }
        .range { display: flex; border: 1px solid var(--mr-frame); border-radius: var(--mr-radius); overflow: hidden; }
        .range button { padding: 0.3rem 0.7rem; border: none; border-right: 1px solid var(--mr-frame); background: transparent; color: var(--mr-text-muted); font-family: var(--mr-font-body); font-size: 0.72rem; font-weight: 500; cursor: pointer; transition: background 0.1s, color 0.1s; }
        .range button:last-child { border-right: none; }
        .range button:hover { color: var(--mr-text); }
        .range button.active { background: var(--mr-action-tint); color: var(--mr-action); }

        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(126px, 1fr)); margin-bottom: -1px; }
        .metric { padding: 0.65rem 0.9rem; border-right: 1px solid var(--mr-hairline); border-bottom: 1px solid var(--mr-hairline); display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
        .metric .k { font-size: 0.68rem; font-weight: 500; color: var(--mr-text-muted); display: flex; align-items: center; gap: 0.3rem; white-space: nowrap; }
        .metric .row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.4rem; }
        .metric .v { font-family: var(--mr-font-data); font-size: 1.15rem; font-weight: 600; color: var(--mr-text); line-height: 1; }
        .metric .v.accept { color: var(--mr-accept); } .metric .v.reject { color: var(--mr-reject); } .metric .v.action { color: var(--mr-action); }
        .metric .v.muted { color: var(--mr-text-muted); font-size: 0.92rem; }
        .metric .u { font-family: var(--mr-font-data); font-size: 0.72rem; color: var(--mr-text-muted); }
        /* Drill-through: clickable metric cards + header "open" links */
        .metric.navm { cursor: pointer; transition: background 0.1s; }
        .metric.navm:hover { background: var(--mr-titlebar); }
        .metric.navm:focus-visible { outline: 2px solid var(--mr-action); outline-offset: -2px; }
        .win-go { text-decoration: none; }

        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; margin-top: 0.9rem; }
        @media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
        .full { grid-column: 1 / -1; }
        .stack { margin-top: 0.9rem; }

        .legend { display: inline-flex; align-items: center; gap: 0.7rem; font-size: 0.68rem; color: var(--mr-text-muted); }
        .legend b { font-weight: 500; display: inline-flex; align-items: center; gap: 0.3rem; }
        .swatch { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }

        /* Interactive auth-volume histogram (hover tooltip + click drill-in).
           Let the tooltip escape the window frame instead of being clipped. */
        #w-auth-hist, #w-auth-hist .win-body { overflow: visible; }
        .hist { position: relative; }
        .hist-bars { display: flex; align-items: flex-end; gap: 3px; height: 46px; }
        .hcol { flex: 1 1 0; min-width: 3px; height: 46px; padding: 0; margin: 0; border: none; background: transparent; cursor: pointer; display: flex; align-items: flex-end; transition: background 0.1s; }
        .hcol:hover { background: var(--mr-action-tint); }
        .hcol:focus-visible { outline: 2px solid var(--mr-action); outline-offset: -1px; }
        .hstack { display: flex; flex-direction: column; justify-content: flex-end; width: 100%; height: 100%; }
        .hbad { background: var(--mr-reject); width: 100%; min-height: 1px; }
        .hok { background: var(--mr-accept); width: 100%; min-height: 1px; }
        .hzero { height: 2px; background: var(--mr-hairline); width: 100%; }
        .hist-tip {
          position: absolute; bottom: calc(100% + 7px); transform: translateX(-50%);
          background: var(--mr-surface-raised); border: 1px solid var(--mr-frame); border-radius: var(--mr-radius);
          padding: 0.45rem 0.6rem; font-size: 0.68rem; line-height: 1.55;
          white-space: nowrap; z-index: 50; pointer-events: none; box-shadow: 0 6px 18px rgba(0,0,0,0.45); min-width: 124px;
        }
        .hist-tip[hidden] { display: none; }
        .tt-time { color: var(--mr-text); font-weight: 600; margin-bottom: 0.2rem; }
        .tt-row { display: flex; justify-content: space-between; gap: 1rem; color: var(--mr-text-muted); }
        .tt-row .tt-v { color: var(--mr-text); font-family: var(--mr-font-data); }
        .tt-k { display: inline-flex; align-items: center; gap: 0.3rem; }
        .tt-total { border-top: 1px solid var(--mr-hairline); margin-top: 0.2rem; padding-top: 0.2rem; }
        .tt-hint { color: var(--mr-action); margin-top: 0.25rem; font-size: 0.64rem; }

        .bw-bar-wrap { display: flex; align-items: center; gap: 0.4rem; }
        .bw-bar { flex: 1; height: 5px; background: var(--mr-hairline); overflow: hidden; border-radius: 999px; }
        .bw-bar-fill { height: 100%; background: var(--mr-action); border-radius: 999px; }

        .nas-list { display: flex; flex-direction: column; }
        .nas-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0; border-bottom: 1px solid var(--mr-hairline); font-size: 0.78rem; }
        .nas-item:last-child { border-bottom: none; }
        .nas-name { font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .nas-type { color: var(--mr-text-muted); font-size: 0.66rem; font-family: var(--mr-font-data); }
        .nas-sessions { color: var(--mr-action); font-size: 0.72rem; font-family: var(--mr-font-data); }
        .nas-offline-txt { color: var(--mr-text-muted); font-size: 0.72rem; }
        .status-summary { display: flex; gap: 0.9rem; margin-bottom: 0.55rem; align-items: center; }
        .status-summary span { display: inline-flex; align-items: center; gap: 0.35rem; font-family: var(--mr-font-data); font-size: 0.66rem; font-weight: 600; letter-spacing: 0.04em; }

        .skeleton { background: linear-gradient(90deg, var(--mr-hairline) 25%, var(--mr-surface-raised) 50%, var(--mr-hairline) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 1px; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
        .empty-state { padding: 1.2rem; text-align: center; color: var(--mr-text-muted); font-size: 0.78rem; }
        .metrics .skeleton { margin: 0.6rem 0.7rem; height: 40px; grid-column: 1 / -1; }

        .customize-wrap { position: relative; }
        #customize-panel { display: none; position: absolute; right: 0; top: calc(100% + 4px); background: var(--mr-surface); border: 1px solid var(--mr-frame); border-radius: var(--mr-radius); padding: 0.5rem 0.7rem; z-index: 200; min-width: 200px; box-shadow: 0 6px 18px rgba(0,0,0,0.4); }
        #customize-panel.open { display: block; }
        .cust-title { font-size: 0.7rem; font-weight: 600; color: var(--mr-text-muted); margin-bottom: 0.4rem; padding-bottom: 0.35rem; border-bottom: 1px solid var(--mr-hairline); }
        .widget-toggle { display: flex; align-items: center; gap: 0.45rem; padding: 0.22rem 0; cursor: pointer; font-size: 0.78rem; color: var(--mr-text); user-select: none; }
        .widget-toggle input { accent-color: var(--mr-action); cursor: pointer; }
      </style>

      <div class="dash-head">
        <span class="page-title">Dashboard</span>
        <div class="dash-tools">
          <span class="rfr"><span class="led led-live"></span>Auto-refresh 30s</span>
          <div class="customize-wrap">
            <button class="iconbtn" id="btn-customize" title="Customize widgets">${ICO_GEAR}</button>
            <div id="customize-panel">
              <div class="cust-title">Widgets</div>
              ${WIDGET_DEFS.map(w => `
                <label class="widget-toggle">
                  <input type="checkbox" data-widget="${w.id}" ${cfg[w.id] !== false ? 'checked' : ''}>
                  <span>${w.label}</span>
                </label>`).join('')}
            </div>
          </div>
          <button class="iconbtn" id="btn-manual-refresh" title="Refresh now">${ICO_REFRESH}</button>
          <div class="range">
            <button class="active" data-range="today">Today</button>
            <button data-range="7d">7d</button>
            <button data-range="30d">30d</button>
          </div>
        </div>
      </div>

      <div class="win">
        <div class="win-head">
          <span class="win-title">System · Overview <span class="sub" id="range-tag">/ today</span></span>
          <span class="win-tools"><span class="tlabel" id="sys-clock"></span></span>
        </div>
        <div class="win-body flush"><div class="metrics" id="metrics"><div class="skeleton"></div></div></div>
      </div>

      <div class="win stack" id="w-auth-hist">
        <div class="win-head">
          <span class="win-title">Auth Volume <span class="sub">/ recent events</span></span>
          <span class="win-tools legend"><b><span class="swatch" style="background:var(--mr-accept)"></span>accept</b><b><span class="swatch" style="background:var(--mr-reject)"></span>reject</b>${this._goLink('/logs?tab=auth', 'Auth Logs')}</span>
        </div>
        <div class="win-body" id="auth-hist"><div class="skeleton" style="height:44px;"></div></div>
      </div>

      <div class="grid2">
        ${this._win('w-nas-status', 'NAS Status', '', 'nas-status-wrap', { tools: refreshBtn, to: '/nas' })}
        ${this._win('w-session-types', 'Session Types', '', 'session-types-wrap', { flush: true, tools: refreshBtn, to: '/sessions' })}
      </div>

      <div class="grid2">
        ${this._win('w-recent-auth', 'Recent Authentication', '', 'recent-auth-wrap', { flush: true, tools: refreshBtn, to: '/logs?tab=auth' })}
        ${this._win('w-top-bw', 'Top Bandwidth', '', 'top-bw-wrap', { flush: true, tools: refreshBtn, to: '/accounting' })}
      </div>

      <div class="grid2">
        <div class="win full" id="w-online-users">
          <div class="win-head">
            <span class="win-title">Online Users <span class="sub" id="online-count"></span></span>
            <span class="win-tools">${refreshBtn}${this._goLink('/sessions', 'Sessions')}</span>
          </div>
          <div class="win-body flush" id="online-users-wrap"><div class="skeleton" style="height:70px;"></div></div>
        </div>
      </div>

      <div class="grid2">
        <div class="win full" id="w-firewall" style="display:none;">
          <div class="win-head">
            <span class="win-title">Firewall</span>
            <span class="win-tools">${this._goLink('/firewall', 'Firewall Manager')}</span>
          </div>
          <div class="win-body" id="firewall-wrap"><div class="skeleton" style="height:50px;"></div></div>
        </div>
      </div>

      <div class="grid2">
        <div class="win full" id="w-autoblock" style="display:none;">
          <div class="win-head">
            <span class="win-title">Auto-Block Activity <span class="sub">/ adaptive access control</span></span>
            <span class="win-tools">${refreshBtn}${this._goLink('/firewall?tab=sets', 'Firewall Blocklists')}</span>
          </div>
          <div class="win-body flush" id="autoblock-wrap"><div class="skeleton" style="height:50px;"></div></div>
        </div>
      </div>

      <div class="grid2">
        <div class="win full" id="w-realms" style="display:none;">
          <div class="win-head"><span class="win-title">Realms</span><span class="win-tools">${refreshBtn}${this._goLink('/realms', 'Realms')}</span></div>
          <div class="win-body" id="realms-wrap"></div>
        </div>
      </div>

      <div class="grid2">
        <div class="win full" id="w-integrations">
          <div class="win-head"><span class="win-title">Integrations Status</span><span class="win-tools">${refreshBtn}${this._goLink('/notifications?view=integrations', 'Integrations')}</span></div>
          <div class="win-body" id="integrations-wrap"><div class="skeleton" style="height:50px;"></div></div>
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll('.range button[data-range]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._range = btn.dataset.range;
        this.shadowRoot.querySelectorAll('.range button[data-range]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tag = this.shadowRoot.getElementById('range-tag');
        if (tag) tag.textContent = `/ ${btn.textContent.toLowerCase()}`;
        this._load();
      });
    });

    this.shadowRoot.getElementById('btn-manual-refresh')?.addEventListener('click', () => this._load());
    this.shadowRoot.querySelectorAll('.wgt-refresh').forEach(b =>
      b.addEventListener('click', () => this._load()));

    const clock = this.shadowRoot.getElementById('sys-clock');
    if (clock) clock.textContent = new Date().toISOString().slice(11, 19) + 'Z';

    // Drill-through: any [data-nav] element (metric cards) navigates to its detail
    // page. Header chevrons are plain hash links handled by the router directly.
    const goNav = (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { e.preventDefault(); router.navigate(nav.dataset.nav); }
    };
    this.shadowRoot.addEventListener('click', goNav);
    this.shadowRoot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') goNav(e);
    });
  }

  _bindCustomizePanel() {
    const btn = this.shadowRoot.getElementById('btn-customize');
    const panel = this.shadowRoot.getElementById('customize-panel');

    btn?.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('open'); });

    panel?.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const wid = cb.dataset.widget;
        const el = this.shadowRoot.getElementById(wid);
        if (el) el.style.display = cb.checked ? '' : 'none';
        const c = loadWidgetCfg();
        c[wid] = cb.checked;
        saveWidgetCfg(c);
        this._updatePairLayouts();
      });
    });

    this.shadowRoot.addEventListener('click', (e) => {
      if (!e.composedPath().includes(panel) && !e.composedPath().includes(btn)) panel.classList.remove('open');
    });
  }

  _applyWidgetConfig() {
    const cfg = loadWidgetCfg();
    WIDGET_DEFS.forEach(w => {
      const el = this.shadowRoot.getElementById(w.id);
      if (el) el.style.display = cfg[w.id] === false ? 'none' : '';
    });
    this._updatePairLayouts();
  }

  _updatePairLayouts() {
    [['w-nas-status', 'w-session-types'], ['w-recent-auth', 'w-top-bw']].forEach(([aId, bId]) => {
      const a = this.shadowRoot.getElementById(aId);
      const b = this.shadowRoot.getElementById(bId);
      if (!a || !b) return;
      const aHide = a.style.display === 'none';
      const bHide = b.style.display === 'none';
      a.style.gridColumn = (!aHide && bHide) ? '1 / -1' : '';
      b.style.gridColumn = (aHide && !bHide) ? '1 / -1' : '';
    });
  }

  async _load() {
    if (this._loading) return;
    this._loading = true;
    this._loadOnlineUsers();
    this._loadNasStatus();
    this._loadSessionTypes();
    this._loadIntegrations();
    this._loadRealms();
    this._loadFirewall();
    this._loadAutoblock();
    try {
      const data = await api.get(`/dashboard/stats?range=${this._range}`);
      this._renderStats(data);
    } catch {
      this._statsError();
      toast('Failed to load dashboard data', 'error');
    } finally {
      this._loading = false;
    }
  }

  // Replace the stats-backed widgets' loading skeletons with a compact error
  // state. Without this, a failed /dashboard/stats left the metrics, auth
  // histogram, recent-auth and top-bandwidth widgets shimmering forever behind
  // a lone toast — the same widget-scale `.empty-state` the other widgets use.
  _statsError() {
    const cell = (span) =>
      `<div class="empty-state"${span ? ' style="grid-column:1/-1;"' : ''}>Couldn’t load — try Refresh.</div>`;
    const set = (id, span) => { const el = this.shadowRoot.getElementById(id); if (el) el.innerHTML = cell(span); };
    set('metrics', true);
    set('auth-hist', false);
    set('recent-auth-wrap', false);
    set('top-bw-wrap', false);
  }

  async _loadOnlineUsers() {
    try { this._renderOnlineUsers(await api.get('/dashboard/online-users')); }
    catch { const w = this.shadowRoot.getElementById('online-users-wrap'); if (w) w.innerHTML = `<div class="empty-state">Could not load online users.</div>`; }
  }

  async _loadNasStatus() {
    try { this._renderNasStatus(await api.get('/dashboard/nas-status')); }
    catch { const w = this.shadowRoot.getElementById('nas-status-wrap'); if (w) w.innerHTML = `<div class="empty-state">Could not load NAS status.</div>`; }
  }

  async _loadSessionTypes() {
    try { this._renderSessionTypes(await api.get('/dashboard/session-types')); }
    catch { const w = this.shadowRoot.getElementById('session-types-wrap'); if (w) w.innerHTML = `<div class="empty-state">Could not load session types.</div>`; }
  }

  async _loadRealms() {
    const card = this.shadowRoot.getElementById('w-realms');
    if (!card) return;
    try { this._renderRealms(await api.get('/realms')); }
    catch { card.style.display = 'none'; }
  }

  async _loadFirewall() {
    const card = this.shadowRoot.getElementById('w-firewall');
    if (!card) return;
    if (loadWidgetCfg()['w-firewall'] === false) { card.style.display = 'none'; return; }
    try {
      const s = await api.get('/firewall/status');
      card.style.display = '';
      const wrap = this.shadowRoot.getElementById('firewall-wrap');
      const led = (on) => `<span class="led ${on ? 'led-on' : 'led-idle'}" style="margin-right:0.35rem;"></span>`;
      if (!s.nft_available) { wrap.innerHTML = `<div class="empty-state" style="font-size:0.78rem;">nftables (<code>nft</code>) is not installed on this host.</div>`; return; }
      if (!s.managed) { wrap.innerHTML = `<div class="empty-state" style="font-size:0.78rem;">Firewall not managed yet. <a href="#/firewall" style="color:var(--mr-action);">Set it up →</a></div>`; return; }
      const cell = (label, value, extra = '') =>
        `<div class="metric" style="border:1px solid var(--mr-hairline);"><div class="k">${label}</div><div class="v">${extra}${value}</div></div>`;
      wrap.innerHTML = `
        <div class="metrics" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr));">
          ${cell('Active in kernel', s.active ? 'Yes' : 'No', led(s.active))}
          ${cell('Rules', `${s.enabled_rule_count}/${s.rule_count}`)}
          ${cell('Active bans', s.ban_count)}
          ${cell('Dropped pkts', (s.total_dropped ?? 0).toLocaleString())}
        </div>
        ${s.pending && s.pending.length ? `<div style="margin-top:0.6rem;font-size:0.74rem;color:var(--mr-warning);">⏱ An apply is awaiting confirmation.</div>` : ''}`;
    } catch { card.style.display = 'none'; }
  }

  // Auto-Block Activity (#16): recent automatic blocks from adaptive access
  // control. Hidden entirely when the firewall module isn't present (endpoint
  // 404s) or the widget is toggled off, so non-firewall dashboards stay clean.
  async _loadAutoblock() {
    const card = this.shadowRoot.getElementById('w-autoblock');
    if (!card) return;
    if (loadWidgetCfg()['w-autoblock'] === false) { card.style.display = 'none'; return; }
    try {
      const rows = await api.get('/firewall/block-events?limit=6');
      card.style.display = '';
      this._renderAutoblock(rows);
    } catch { card.style.display = 'none'; }
  }

  _autoblockStatus(e) {
    if (e.override_at) return { cls: 'badge-ok', text: 'overridden' };
    if (e.ban_seconds && e.created_at &&
        new Date(e.created_at).getTime() + e.ban_seconds * 1000 < Date.now()) {
      return { cls: 'badge-muted', text: 'expired' };
    }
    return { cls: 'badge-danger', text: 'active' };
  }

  _renderAutoblock(rows) {
    const wrap = this.shadowRoot.getElementById('autoblock-wrap');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state" style="font-size:0.78rem;">No automatic blocks recorded — brute-force protection lists bans here as they happen. <a href="#/firewall?tab=settings" style="color:var(--mr-action);">Configure →</a></div>`;
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Source</th><th>Reason</th><th>When</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map(e => {
            const st = this._autoblockStatus(e);
            const tip = e.override_by ? ` title="overridden by ${escHtml(e.override_by)}"` : '';
            return `<tr>
              <td class="mono" style="font-weight:500;">${escHtml(e.element)}</td>
              <td class="muted">${escHtml(e.reason || e.source)}</td>
              <td class="muted mono" style="white-space:nowrap;">${relTime(e.created_at)}</td>
              <td><span class="badge ${st.cls}"${tip}>${st.text}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  async _loadIntegrations() {
    const wrap = this.shadowRoot.getElementById('integrations-wrap');
    if (!wrap) return;
    try {
      const [statusList, zabbixSummary] = await Promise.allSettled([
        api.get('/integrations/status'),
        api.get('/integrations/zabbix/problems-summary'),
      ]);
      const integrations = statusList.status === 'fulfilled' ? statusList.value : [];
      const zabbix = zabbixSummary.status === 'fulfilled' ? zabbixSummary.value : null;

      if (!integrations.length) {
        wrap.innerHTML = `<div class="empty-state" style="font-size:0.78rem;">No integrations configured. <a href="#" id="dash-go-integrations" style="color:var(--mr-action);">Set up Graylog / Zabbix</a>.</div>`;
        wrap.querySelector('#dash-go-integrations')?.addEventListener('click', (e) => {
          e.preventDefault();
          router.navigate('/notifications?view=integrations');
        });
        return;
      }

      const cards = integrations.map(i => {
        const logo = (i.type === 'graylog' || i.type === 'zabbix')
          ? `<img src="/modules/integrations/img/${i.type}.svg" alt="" width="16" height="16" style="flex-shrink:0;" />`
          : `<span style="width:16px;text-align:center;">🔌</span>`;
        const statusTag = i.enabled
          ? `<span class="badge badge-ok">ON</span>` : `<span class="badge badge-muted">OFF</span>`;
        let extra = '';
        if (i.type === 'zabbix' && zabbix && zabbix.configured) {
          if (zabbix.error) extra = `<span class="badge badge-disaster">ERR</span>`;
          else {
            const total = zabbix.total || 0;
            extra = total > 0
              ? `<span class="badge badge-disaster">${total} alarm${total !== 1 ? 's' : ''}</span>`
              : `<span class="badge badge-ok">clear</span>`;
          }
        }
        return `<div style="display:flex;align-items:center;gap:0.55rem;padding:0.35rem 0;border-bottom:1px solid var(--mr-hairline);">
          ${logo}
          <span style="font-weight:500;font-size:0.8rem;flex:1;">${escHtml(i.name)}</span>
          <span class="mono" style="font-size:0.64rem;color:var(--mr-text-muted);text-transform:uppercase;">${escHtml(i.type)}</span>
          ${statusTag}${extra}
        </div>`;
      }).join('');

      wrap.innerHTML = cards || `<div class="empty-state" style="font-size:0.78rem;">No integrations.</div>`;
    } catch {
      if (wrap) wrap.innerHTML = `<div class="empty-state" style="font-size:0.78rem;">Integrations unavailable.</div>`;
    }
  }

  _renderStats(d) {
    const total = d.logins + d.failed_logins;
    const rejectPct = total > 0 ? (d.failed_logins / total) * 100 : 0;
    const rejectDisplay = rejectPct.toFixed(1) + '%';
    const rejectClass = rejectPct > 20 ? 'reject' : (rejectPct > 10 ? 'action' : 'accept');

    // rolling sparkline of active sessions
    this._sessHist.push(Number(d.active_sessions || 0));
    if (this._sessHist.length > 24) this._sessHist.shift();

    // Each metric drills through to its filtered detail page (empty `to` = not clickable).
    const metric = (k, vHtml, extra = '', to = '') =>
      `<div class="metric${to ? ' navm' : ''}"${to ? ` data-nav="${to}" role="link" tabindex="0" title="Open ${k}"` : ''}><div class="k">${k}</div><div class="row"><span>${vHtml}</span>${extra}</div></div>`;

    const grid = this.shadowRoot.getElementById('metrics');
    grid.innerHTML = `
      ${metric('Active Sessions', `<span class="v action">${d.active_sessions}</span>`,
        `<span class="sparkline-wrap">${sparkline(this._sessHist, { w: 52, h: 16, tone: 'accept' })}</span>`, '/sessions')}
      ${metric('Logins', `<span class="v accept">${d.logins}</span>`, '', '/logs?tab=auth&amp;reply=Access-Accept')}
      ${metric('Failed', `<span class="v ${d.failed_logins > 0 ? 'reject' : ''}">${d.failed_logins}</span>`, '', '/logs?tab=auth&amp;reply=Access-Reject')}
      ${metric('Reject Rate', `<span class="v ${rejectClass}">${rejectDisplay}</span>`, '', '/logs?tab=auth&amp;reply=Access-Reject')}
      ${metric('Traffic In', `<span class="v">${fmtBytes(d.bytes_in)}</span>`, '', '/accounting')}
      ${metric('Traffic Out', `<span class="v">${fmtBytes(d.bytes_out)}</span>`, '', '/accounting')}
      ${metric('Users / NAS', `<span class="v">${d.user_count}<span class="u"> / ${d.nas_count}</span></span>`, '', '/users')}
      ${metric('Avg Auth', `<span class="v muted">N/A</span>`)}
    `;

    // Graylog-style volume histogram — interactive (hover = tooltip, click = drill-in)
    this._renderHistogram(authBuckets(d.recent_auth));

    this._renderRecentAuth(d.recent_auth);
    this._renderTopBandwidth(d.top_bandwidth);
  }

  _renderHistogram(buckets) {
    const host = this.shadowRoot.getElementById('auth-hist');
    if (!host) return;
    if (!buckets.length) {
      host.innerHTML = `<div class="empty-state" style="font-size:0.76rem;">No authentication events in range.</div>`;
      return;
    }
    this._histBuckets = buckets;
    const max = Math.max(1, ...buckets.map(b => b.ok + b.bad));
    const cols = buckets.map((b, i) => {
      const total = b.ok + b.bad;
      return `<button class="hcol" data-i="${i}" aria-label="${total} events">
        <span class="hstack">
          ${b.bad ? `<span class="hbad" style="height:${(b.bad / max) * 100}%"></span>` : ''}
          ${b.ok ? `<span class="hok" style="height:${(b.ok / max) * 100}%"></span>` : ''}
          ${total === 0 ? '<span class="hzero"></span>' : ''}
        </span>
      </button>`;
    }).join('');
    host.innerHTML = `<div class="hist"><div class="hist-bars">${cols}</div><div class="hist-tip" id="hist-tip" hidden></div></div>`;

    const tip = host.querySelector('#hist-tip');
    host.querySelectorAll('.hcol').forEach(col => {
      col.addEventListener('mouseenter', () => this._showHistTip(col, tip));
      col.addEventListener('mouseleave', () => { tip.hidden = true; });
      col.addEventListener('click', () => this._gotoAuthRange(Number(col.dataset.i)));
    });
  }

  _showHistTip(col, tip) {
    const b = this._histBuckets?.[Number(col.dataset.i)];
    if (!b || !tip) return;
    const hm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const d = (ms) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const total = b.ok + b.bad;
    const sameDay = d(b.start) === d(b.end);
    tip.innerHTML = `
      <div class="tt-time">${d(b.start)} ${hm(b.start)} – ${sameDay ? '' : d(b.end) + ' '}${hm(b.end)}</div>
      <div class="tt-row"><span class="tt-k"><span class="swatch" style="background:var(--mr-accept)"></span>accept</span><span class="tt-v">${b.ok}</span></div>
      <div class="tt-row"><span class="tt-k"><span class="swatch" style="background:var(--mr-reject)"></span>reject</span><span class="tt-v">${b.bad}</span></div>
      <div class="tt-row tt-total"><span class="tt-k">total</span><span class="tt-v">${total}</span></div>
      <div class="tt-hint">click → auth logs</div>`;
    tip.hidden = false;
    const host = this.shadowRoot.getElementById('auth-hist');
    const hostRect = host.getBoundingClientRect();
    const colRect = col.getBoundingClientRect();
    const tipW = tip.offsetWidth || 130;
    let left = colRect.left - hostRect.left + colRect.width / 2;
    left = Math.max(tipW / 2, Math.min(left, hostRect.width - tipW / 2));
    tip.style.left = `${left}px`;
  }

  _gotoAuthRange(i) {
    const b = this._histBuckets?.[i];
    if (!b) return;
    const from = new Date(Math.floor(b.start)).toISOString();
    const to = new Date(Math.ceil(b.end)).toISOString();
    router.navigate(`/logs?tab=auth&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  _renderNasStatus(rows) {
    const wrap = this.shadowRoot.getElementById('nas-status-wrap');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = `<div class="empty-state">No NAS devices configured.</div>`; return; }
    const active = rows.filter(r => r.online).length;
    const idle = rows.length - active;
    // "idle" == no RADIUS traffic in the last 15 min, NOT a reachability check —
    // so it's shown muted (grey), never as a red "offline"/down state.
    wrap.innerHTML = `
      <div class="status-summary">
        <span style="color:var(--mr-accept);"><span class="led led-on"></span> ${active} active</span>
        ${idle > 0 ? `<span style="color:var(--mr-text-muted);" title="No RADIUS traffic in the last 15 minutes — not a reachability check"><span class="led led-idle"></span> ${idle} idle</span>` : ''}
      </div>
      <div class="nas-list">
        ${rows.map(n => `
          <div class="nas-item">
            <span class="led ${n.online ? 'led-on' : 'led-idle'}"></span>
            <span class="nas-name" title="${escHtml(n.nasname)}">${escHtml(n.shortname)}</span>
            <span class="nas-type">${escHtml(n.type)}</span>
            ${n.online
              ? `<span class="nas-sessions">${n.session_count} sess</span>`
              : `<span class="nas-offline-txt" title="No RADIUS traffic in the last 15 minutes">idle</span>`}
          </div>`).join('')}
      </div>`;
  }

  _renderRealms(rows) {
    const card = this.shadowRoot.getElementById('w-realms');
    const wrap = this.shadowRoot.getElementById('realms-wrap');
    if (!card || !wrap) return;
    const cfg = loadWidgetCfg();
    if (!rows.length || cfg['w-realms'] === false) { card.style.display = 'none'; return; }
    card.style.display = '';
    const ledOf = s => s === 'up' ? 'led-on' : (s === 'unknown' ? 'led-idle' : 'led-off');
    wrap.innerHTML = `
      <div class="nas-list">
        ${rows.map(r => `
          <div class="nas-item">
            <span class="led ${ledOf(r.status)}"></span>
            <span class="nas-name" title="${escHtml(r.name)}">${escHtml(r.name)}</span>
            <span class="nas-type">${escHtml(r.pool_name || 'no pool')}</span>
            <span class="nas-sessions">${r.status === 'up' && r.last_rtt_ms != null ? `${r.last_rtt_ms} ms` : escHtml(r.status)}</span>
          </div>`).join('')}
      </div>`;
  }

  _renderSessionTypes(rows) {
    const wrap = this.shadowRoot.getElementById('session-types-wrap');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = `<div class="empty-state">No active sessions.</div>`; return; }
    const total = rows.reduce((s, r) => s + r.count, 0);
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Port Type</th><th>Sessions</th><th style="width:120px;">Share</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const pct = Math.round(r.count / total * 100);
            return `<tr>
                <td style="font-weight:500;">${escHtml(r.porttype)}</td>
                <td class="mono" style="color:var(--mr-action);font-weight:600;">${r.count}</td>
                <td><div class="bw-bar-wrap"><div class="bw-bar"><div class="bw-bar-fill" style="width:${pct}%"></div></div><span class="mono" style="font-size:0.66rem;color:var(--mr-text-muted);white-space:nowrap;">${pct}%</span></div></td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  _renderOnlineUsers(rows) {
    const wrap = this.shadowRoot.getElementById('online-users-wrap');
    const count = this.shadowRoot.getElementById('online-count');
    if (!wrap) return;
    if (count) count.textContent = rows.length ? `/ ${rows.length} online` : '';
    if (!rows.length) { wrap.innerHTML = `<div class="empty-state">No users currently online.</div>`; return; }
    wrap.innerHTML = `
      <table>
        <thead><tr><th>User</th><th>NAS</th><th>Client / Location</th><th>Session Start</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr class="sev sev-ok">
              <td style="font-weight:500">${escHtml(r.username)}</td>
              <td><span class="muted mono">${escHtml(r.nasname || r.nasipaddress || '—')}</span></td>
              <td><span class="muted mono">${escHtml(r.callingstationid || r.framedipaddress || '—')}</span>
                ${r.geo_client ? `<div style="font-size:0.7rem;color:var(--mr-text-muted);margin-top:1px">${geoLabelHTML(r.geo_client)}</div>` : ''}</td>
              <td class="muted mono" style="white-space:nowrap">${fmtDate(r.acctstarttime)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  _renderRecentAuth(rows) {
    const wrap = this.shadowRoot.getElementById('recent-auth-wrap');
    if (!rows.length) { wrap.innerHTML = `<div class="empty-state">No authentication events yet.</div>`; return; }
    wrap.innerHTML = `
      <table>
        <thead><tr><th>User</th><th>Result</th><th>Time</th><th>Station</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            const sev = r.reply === 'Access-Reject' ? 'sev sev-reject' : 'sev sev-ok';
            return `<tr class="${sev}">
              <td style="font-weight:500">${escHtml(r.username)}</td>
              <td>${replyBadge(r.reply)}</td>
              <td class="muted mono" style="white-space:nowrap">${fmtDate(r.authdate)}</td>
              <td class="muted mono">${escHtml(r.callingstationid || '—')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  _renderTopBandwidth(rows) {
    const wrap = this.shadowRoot.getElementById('top-bw-wrap');
    if (!rows.length) { wrap.innerHTML = `<div class="empty-state">No accounting data yet.</div>`; return; }
    const max = rows[0]?.total_bytes || 1;
    wrap.innerHTML = `
      <table>
        <thead><tr><th>User</th><th>In</th><th>Out</th><th style="width:90px;">Total</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escHtml(r.username)}</td>
              <td class="mono" style="color:var(--mr-text-muted);">${fmtBytes(r.bytes_in)}</td>
              <td class="mono" style="color:var(--mr-text-muted);">${fmtBytes(r.bytes_out)}</td>
              <td><div class="bw-bar-wrap"><div class="bw-bar"><div class="bw-bar-fill" style="width:${Math.round(r.total_bytes / max * 100)}%"></div></div><span class="mono" style="font-size:0.66rem;color:var(--mr-text-muted);white-space:nowrap;">${fmtBytes(r.total_bytes)}</span></div></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }
}

customElements.define('dashboard-view', DashboardView);

router.register('/dashboard', () => document.createElement('dashboard-view'));
