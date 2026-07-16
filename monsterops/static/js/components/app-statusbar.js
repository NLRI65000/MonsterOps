// app-statusbar.js — persistent system status strip.
//
// A always-on instrument readout pinned to the bottom of the app: service
// LEDs (RADIUS, DB), live session telemetry with a sparkline, the node name,
// and a ticking UTC clock. Polls in the background without touching the global
// loading spinner. Hidden on the unauth (login/setup) pages via theme.css.

import { sparkline } from '/js/utils/sparkline.js';

const HEALTH_MS = 10_000;
const STATS_MS = 15_000;
const CLOCK_MS = 1_000;
const SPARK_MAX = 32;

// Background fetch that deliberately does NOT go through api.js, so the global
// loading spinner never flickers on these silent polls. The session cookie is
// sent automatically (same-origin).
async function silentGet(path) {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

class AppStatusbar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._sessions = [];
    this._timers = [];
    this._started = false;
  }

  connectedCallback() {
    this._render();
  }
  disconnectedCallback() {
    this.stop();
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._tickClock();
    this._pollHealth();
    this._pollStats();
    this._timers.push(setInterval(() => this._tickClock(), CLOCK_MS));
    this._timers.push(setInterval(() => this._pollHealth(), HEALTH_MS));
    this._timers.push(setInterval(() => this._pollStats(), STATS_MS));
  }

  stop() {
    this._timers.forEach(clearInterval);
    this._timers = [];
    this._started = false;
  }

  _render() {
    const node = (location.hostname || 'local').toLowerCase();
    this.shadowRoot.innerHTML = `
      <style>
        @import '/css/theme.css';
        :host {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          height: var(--statusbar-height, 30px);
          z-index: 90;
          display: block;
        }
        .bar {
          height: 100%;
          display: flex;
          align-items: center;
          gap: 1.15rem;
          padding: 0 1rem;
          background: var(--mr-canvas);
          border-top: 1px solid var(--mr-hairline);
          font-family: var(--mr-font-body);
          font-size: 0.7rem;
          color: var(--mr-text-muted);
          white-space: nowrap;
          overflow: hidden;
        }
        .seg {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
        }
        .seg.brand {
          color: var(--mr-text);
          font-weight: 600;
          gap: 0.45rem;
        }
        .mark {
          height: 16px; width: auto; max-width: 20px;
          object-fit: contain; flex-shrink: 0;
          -webkit-user-drag: none;
        }
        .seg.spring { flex: 1; min-width: 0; }
        .k { color: var(--mr-text-faint); }
        .v { color: var(--mr-text); font-family: var(--mr-font-data); font-size: 0.68rem; }
        .v.on  { color: var(--mr-accept); }
        .v.off { color: var(--mr-reject); }
        .spark { margin-left: 0.15rem; }
        @media (max-width: 768px) {
          .seg.hide-sm { display: none; }
          .bar { gap: 0.7rem; }
        }
      </style>
      <div class="bar" role="status" aria-label="System status">
        <span class="seg brand"><img class="mark" src="/img/monsterops-mascot.png" alt="" />MonsterOps</span>
        <span class="seg" id="seg-radius" title="FreeRADIUS service">
          <span class="led led-idle" id="led-radius"></span><span class="k">RADIUS</span><span class="v" id="v-radius">…</span>
        </span>
        <span class="seg" id="seg-db" title="Database health">
          <span class="led led-idle" id="led-db"></span><span class="k">Database</span><span class="v" id="v-db">…</span>
        </span>
        <span class="seg" id="seg-sess" title="Active sessions (live)">
          <span class="led led-live"></span><span class="k">Sessions</span><span class="v" id="v-sess">—</span>
          <span class="spark" id="sess-spark"></span>
        </span>
        <span class="seg spring"></span>
        <span class="seg hide-sm" title="Node"><span class="k">Node</span><span class="v">${node}</span></span>
        <span class="seg" title="UTC time"><span class="v" id="clock">—</span></span>
      </div>
    `;
  }

  _tickClock() {
    const el = this.shadowRoot.getElementById('clock');
    if (el) el.textContent = new Date().toISOString().slice(0, 19).replace('T', ' ') + 'Z';
  }

  async _pollHealth() {
    try {
      const h = await silentGet('/health/status');
      const radiusOk = h?.freeradius?.active_state === 'active';
      const radiusUnknown = !h?.freeradius || h.freeradius.active_state === 'unknown';
      this._setLed('led-radius', radiusUnknown ? 'warn' : (radiusOk ? 'on' : 'off'));
      this._setText(
        'v-radius',
        h?.freeradius?.active_state || 'n/a',
        radiusOk ? 'on' : (radiusUnknown ? '' : 'off'),
      );

      const dbOk = !!h?.database?.ok;
      this._setLed('led-db', dbOk ? 'on' : 'off');
      const lat = h?.database?.latency_ms;
      this._setText('v-db', dbOk ? (lat != null ? `${lat}ms` : 'ok') : 'down', dbOk ? 'on' : 'off');
    } catch {
      this._setLed('led-radius', 'idle');
      this._setText('v-radius', 'n/a', '');
      this._setLed('led-db', 'idle');
      this._setText('v-db', 'n/a', '');
    }
  }

  async _pollStats() {
    try {
      const s = await silentGet('/dashboard/stats?range=today');
      const n = Number(s?.active_sessions ?? 0);
      this._sessions.push(n);
      if (this._sessions.length > SPARK_MAX) this._sessions.shift();
      this._setText('v-sess', n.toLocaleString(), '');
      const spark = this.shadowRoot.getElementById('sess-spark');
      if (spark) spark.innerHTML = sparkline(this._sessions, { w: 54, h: 14, tone: 'accept' });
    } catch {
      this._setText('v-sess', '—', '');
    }
  }

  _setLed(id, state) {
    const el = this.shadowRoot.getElementById(id);
    if (el) el.className = `led led-${state}`;
  }

  _setText(id, text, cls) {
    const el = this.shadowRoot.getElementById(id);
    if (el) {
      el.textContent = text;
      el.className = `v${cls ? ' ' + cls : ''}`;
    }
  }
}

customElements.define('app-statusbar', AppStatusbar);
