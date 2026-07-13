import { router } from '../router.js';

const STYLE = `
  <style>
    @import '/css/theme.css';
    :host { display: block; padding: 2rem; max-width: 900px; }

    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: -0.02em; color: var(--mr-text); }
    .sub { color: var(--mr-text-muted); font-size: 0.875rem; margin-bottom: 2.5rem; }

    section { margin-bottom: 3rem; }
    h2 {
      font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.1em; color: var(--mr-text-muted);
      border-bottom: 1px solid var(--mr-hairline);
      padding-bottom: 0.5rem; margin-bottom: 1.25rem;
    }

    /* Swatches */
    .swatch-row { display: flex; flex-wrap: wrap; gap: 0.75rem; }
    .swatch {
      display: flex; flex-direction: column; gap: 0.5rem; align-items: center;
      width: 80px;
    }
    .swatch-dot {
      width: 48px; height: 48px; border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .swatch-name { font-size: 0.65rem; color: var(--mr-text-muted); text-align: center; font-family: var(--mr-font-data); }
    .swatch-val  { font-size: 0.65rem; color: var(--mr-text-muted); text-align: center; font-family: var(--mr-font-data); }

    /* Type scale */
    .type-row { margin-bottom: 0.75rem; display: flex; align-items: baseline; gap: 1rem; }
    .type-label { font-size: 0.68rem; color: var(--mr-text-muted); font-family: var(--mr-font-data); min-width: 120px; flex-shrink: 0; }

    /* Component rows */
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }

    /* Input demo */
    .input-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 600px) { .input-grid { grid-template-columns: 1fr; } }

    /* State demos — constrained */
    .state-demo { background: var(--mr-surface); border: 1px solid var(--mr-hairline); border-radius: var(--mr-radius); overflow: hidden; }

    /* Inline code */
    code { font-family: var(--mr-font-data); font-size: 0.78rem;
           background: var(--mr-surface-raised); padding: 0.15em 0.4em;
           border-radius: 3px; color: var(--mr-action); }

    table.tok { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    table.tok td, table.tok th { padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--mr-hairline); text-align: left; }
    table.tok th { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--mr-text-muted); }
    table.tok tr:last-child td { border-bottom: none; }
    table.tok td:first-child { font-family: var(--mr-font-data); font-size: 0.75rem; color: var(--mr-action); }
    table.tok td:last-child  { color: var(--mr-text-muted); font-family: var(--mr-font-data); font-size: 0.75rem; }
  </style>
`;

function swatch(name, cssVar, hex) {
  return `<div class="swatch">
    <div class="swatch-dot" style="background:${cssVar ?? hex}"></div>
    <span class="swatch-name">${name}</span>
    <span class="swatch-val">${hex}</span>
  </div>`;
}

class StyleGuideView extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = STYLE + `
      <h1>Style Guide</h1>
      <p class="sub">Signal design system — tokens, components, and usage reference.</p>

      <!-- ── Color Tokens ── -->
      <section>
        <h2>Semantic colors</h2>
        <p style="font-size:0.8rem;color:var(--mr-text-muted);margin-bottom:1rem;">
          Three colors map directly to what RADIUS means. Use <em>only</em> these for status and outcome states.
          Never use them decoratively.
        </p>
        <div class="swatch-row">
          ${swatch('--mr-accept', 'var(--mr-accept)', '#4ADE9A')}
          ${swatch('--mr-reject', 'var(--mr-reject)', '#FF6B5B')}
          ${swatch('--mr-action', 'var(--mr-action)', '#4FA8FF')}
          ${swatch('--mr-warning','var(--mr-warning)','#F5A623')}
        </div>
      </section>

      <section>
        <h2>Canvas & surface</h2>
        <div class="swatch-row">
          ${swatch('canvas',   'var(--mr-canvas)',        '#0E1117')}
          ${swatch('surface',  'var(--mr-surface)',       '#161B22')}
          ${swatch('raised',   'var(--mr-surface-raised)','#1C2330')}
          ${swatch('hairline', 'var(--mr-hairline)',      '#262C36')}
          ${swatch('text',     'var(--mr-text)',          '#E6E9EF')}
          ${swatch('muted',    'var(--mr-text-muted)',    '#8B95A5')}
        </div>
        <p style="font-size:0.75rem;color:var(--mr-text-muted);margin-top:0.75rem;">
          Light theme overrides the canvas/surface/hairline/text tokens — semantic colors stay the same in both themes.
        </p>
      </section>

      <!-- ── Typography ── -->
      <section>
        <h2>Typography</h2>
        <div class="type-row">
          <span class="type-label">--mr-font-body · 1.5rem/700</span>
          <span style="font-family:var(--mr-font-body);font-size:1.5rem;font-weight:700;">IBM Plex Sans</span>
        </div>
        <div class="type-row">
          <span class="type-label">page title · 1.125rem/600</span>
          <span style="font-family:var(--mr-font-body);font-size:1.125rem;font-weight:600;letter-spacing:-0.01em;">Dashboard</span>
        </div>
        <div class="type-row">
          <span class="type-label">body · 0.875rem/400</span>
          <span style="font-family:var(--mr-font-body);font-size:0.875rem;">Regular body text for descriptions and labels.</span>
        </div>
        <div class="type-row">
          <span class="type-label">card label · 0.75rem/500</span>
          <span style="font-family:var(--mr-font-body);font-size:0.75rem;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;color:var(--mr-text-muted);">Active Sessions</span>
        </div>
        <div class="type-row">
          <span class="type-label">--mr-font-data · 0.8rem</span>
          <span style="font-family:var(--mr-font-data);font-size:0.8rem;">192.168.1.1 · AA:BB:CC:DD:EE:FF · 2024-01-15T14:32:00Z</span>
        </div>
        <div class="type-row">
          <span class="type-label">data large · 1.75rem/600</span>
          <span style="font-family:var(--mr-font-data);font-size:1.75rem;font-weight:600;letter-spacing:-0.02em;color:var(--mr-accept);">1,284</span>
        </div>
      </section>

      <!-- ── Buttons ── -->
      <section>
        <h2>Buttons</h2>
        <div class="row">
          <button class="btn btn-primary">Primary action</button>
          <button class="btn btn-danger">Danger action</button>
          <button class="btn btn-ghost">Ghost</button>
          <button class="btn btn-ghost" disabled>Disabled</button>
        </div>
        <table class="tok" style="margin-top:0.75rem;">
          <thead><tr><th>Class</th><th>Use</th><th>Token</th></tr></thead>
          <tbody>
            <tr><td>.btn-primary</td><td>Confirm, save, create</td><td>--mr-action background</td></tr>
            <tr><td>.btn-danger</td><td>Delete, revoke, disconnect</td><td>--mr-reject background</td></tr>
            <tr><td>.btn-ghost</td><td>Secondary, cancel</td><td>--mr-hairline border</td></tr>
          </tbody>
        </table>
      </section>

      <!-- ── Badges ── -->
      <section>
        <h2>Badges</h2>
        <div class="row">
          <span class="badge badge-success">Access-Accept</span>
          <span class="badge badge-danger">Access-Reject</span>
          <span class="badge badge-info">Action</span>
          <span class="badge badge-warning">Warning</span>
          <span class="badge badge-muted">Stopped</span>
        </div>
        <table class="tok" style="margin-top:0.75rem;">
          <thead><tr><th>Class</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>.badge-success</td><td>Access-Accept, online, healthy</td></tr>
            <tr><td>.badge-danger</td><td>Access-Reject, offline, error</td></tr>
            <tr><td>.badge-info</td><td>In-progress, action, informational</td></tr>
            <tr><td>.badge-warning</td><td>Caution, near-limit</td></tr>
            <tr><td>.badge-muted</td><td>Stopped, unknown, N/A</td></tr>
          </tbody>
        </table>
      </section>

      <!-- ── Inputs ── -->
      <section>
        <h2>Inputs</h2>
        <div class="input-grid">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input class="input" type="text" placeholder="user@example.com" />
            <span class="form-hint">The RADIUS username, not the admin login.</span>
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input class="input is-error" type="password" value="hunter2" />
            <span class="form-error">Password must be at least 8 characters.</span>
          </div>
          <div class="form-group">
            <label class="form-label">NAS IP</label>
            <input class="input is-valid" type="text" value="192.168.1.1" style="font-family:var(--mr-font-data);" />
            <span class="form-hint">IP or CIDR of the NAS device.</span>
          </div>
          <div class="form-group">
            <label class="form-label">Type</label>
            <select class="input">
              <option>Cisco</option>
              <option>MikroTik</option>
              <option>Huawei</option>
            </select>
          </div>
        </div>
        <p style="font-size:0.78rem;color:var(--mr-text-muted);margin-top:0.75rem;">
          Add <code>.is-error</code> or <code>.is-valid</code> to <code>.input</code> for validation states.
          Focus ring uses <code>--mr-action-tint</code> (3px glow).
        </p>
      </section>

      <!-- ── Signal Pulse ── -->
      <section>
        <h2>Signal Pulse</h2>
        <p style="font-size:0.8rem;color:var(--mr-text-muted);margin-bottom:1rem;">
          Used <em>only</em> on genuinely live data — active sessions, streaming logs, real-time status.
          Not for static states or decorative use.
        </p>
        <div class="row" style="align-items:center;gap:1.5rem;">
          <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;">
            <signal-pulse state="accept"></signal-pulse> Online / Accept
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;">
            <signal-pulse state="reject"></signal-pulse> Offline / Reject
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;">
            <signal-pulse state="action"></signal-pulse> Active / In progress
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;">
            <signal-pulse state="muted"></signal-pulse> Unknown / Stopped
          </div>
        </div>
        <p style="font-size:0.75rem;color:var(--mr-text-muted);margin-top:0.75rem;">
          Usage: <code>&lt;signal-pulse state="accept|reject|action|muted"&gt;&lt;/signal-pulse&gt;</code>
        </p>
      </section>

      <!-- ── State Feedback ── -->
      <section>
        <h2>State feedback</h2>
        <p style="font-size:0.8rem;color:var(--mr-text-muted);margin-bottom:1rem;">
          Empty, loading, and error states use shared classes from <code>theme.css</code>.
          Available in all shadow DOM components via <code>@import '/css/theme.css'</code>.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;">
          <div>
            <p style="font-size:0.72rem;color:var(--mr-text-muted);margin-bottom:0.4rem;font-family:var(--mr-font-data);">.state-loading</p>
            <div class="state-demo"><div class="state-loading">Loading…</div></div>
          </div>
          <div>
            <p style="font-size:0.72rem;color:var(--mr-text-muted);margin-bottom:0.4rem;font-family:var(--mr-font-data);">.state-empty</p>
            <div class="state-demo"><div class="state-empty">No sessions found.<br>Adjust filters or try a different range.</div></div>
          </div>
          <div>
            <p style="font-size:0.72rem;color:var(--mr-text-muted);margin-bottom:0.4rem;font-family:var(--mr-font-data);">.state-error</p>
            <div class="state-demo"><div class="state-error">Failed to connect to database.<br>Check DATABASE_URL in your environment.</div></div>
          </div>
        </div>
      </section>

      <!-- ── Token Reference ── -->
      <section>
        <h2>Token reference</h2>
        <table class="tok">
          <thead><tr><th>Token</th><th>Description</th><th>Value (dark)</th></tr></thead>
          <tbody>
            <tr><td>--mr-accept</td><td>Access-Accept, online, healthy</td><td>#4ADE9A</td></tr>
            <tr><td>--mr-reject</td><td>Access-Reject, offline, error</td><td>#FF6B5B</td></tr>
            <tr><td>--mr-action</td><td>Primary actions, links, focus ring</td><td>#4FA8FF</td></tr>
            <tr><td>--mr-warning</td><td>Caution, near-limit states</td><td>#F5A623</td></tr>
            <tr><td>--mr-accept-tint</td><td>Badge/hover background for accept</td><td>rgba(74,222,154,.12)</td></tr>
            <tr><td>--mr-reject-tint</td><td>Badge/hover background for reject</td><td>rgba(255,107,91,.12)</td></tr>
            <tr><td>--mr-action-tint</td><td>Focus ring glow, badge/hover background</td><td>rgba(79,168,255,.12)</td></tr>
            <tr><td>--mr-canvas</td><td>Page background</td><td>#0E1117</td></tr>
            <tr><td>--mr-surface</td><td>Card / panel background</td><td>#161B22</td></tr>
            <tr><td>--mr-surface-raised</td><td>Tooltip / popover background</td><td>#1C2330</td></tr>
            <tr><td>--mr-hairline</td><td>Borders and dividers</td><td>#262C36</td></tr>
            <tr><td>--mr-text</td><td>Primary text</td><td>#E6E9EF</td></tr>
            <tr><td>--mr-text-muted</td><td>Labels, hints, secondary text</td><td>#8B95A5</td></tr>
            <tr><td>--mr-font-body</td><td>IBM Plex Sans — UI text</td><td></td></tr>
            <tr><td>--mr-font-data</td><td>IBM Plex Mono — IPs, MACs, timestamps</td><td></td></tr>
            <tr><td>--mr-radius</td><td>Standard border radius</td><td>6px</td></tr>
            <tr><td>--mr-radius-lg</td><td>Card border radius</td><td>10px</td></tr>
          </tbody>
        </table>
      </section>
    `;
  }
}

customElements.define('style-guide-view', StyleGuideView);
router.register('/style-guide', () => document.createElement('style-guide-view'));
