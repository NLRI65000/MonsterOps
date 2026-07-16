import { BaseComponent } from './base-component.js';
import { api } from '../api.js';

// ── Icon set ──────────────────────────────────────────────────────────────────
const ICONS = {
  grid:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  layers:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  server:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="6" cy="18" r="1" fill="currentColor" stroke="none"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  activity:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  share:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  'bar-chart':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>',
  'file-text':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  bell:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  plug:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="2" x2="9" y2="7"/><line x1="15" y1="2" x2="15" y2="7"/><rect x="5" y="7" width="14" height="7" rx="2"/><line x1="12" y1="14" x2="12" y2="22"/></svg>',
  key:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  zap:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  cpu:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
  terminal:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  logout:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  'chevrons-left':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>',
  'chevrons-right':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>',
};

// ── Nav sections ─────────────────────────────────────────────────────────────
// Nav entries declare an optional `group` in their manifest. Known groups render
// as labeled sections (Cloudflare-style) with their items always visible;
// ungrouped entries (and unknown groups, e.g. from plugins) stay at the top.
const GROUP_META = {
  RADIUS: { label: 'RADIUS' },
  Network: { label: 'Network' },
  Monitoring: { label: 'Monitoring' },
  Automation: { label: 'Automation' },
  Alerting: { label: 'Alerting' },
  System: { label: 'System' },
};
const GROUP_ORDER = ['RADIUS', 'Network', 'Monitoring', 'Automation', 'Alerting', 'System'];
const MOON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

function icon(name, size = 16) {
  return `<span class="nav-icon" style="width:${size}px;height:${size}px">${
    ICONS[name] ?? ''
  }</span>`;
}

class AppSidebar extends BaseComponent {
  static get template() {
    return `
      <style>
        :host {
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          width: var(--sidebar-width, 236px);
          background: var(--mr-canvas, #0A0A0A);
          border-right: 1px solid var(--mr-hairline, #222);
          /* Sit above the full-width status strip so the footer actions are
             never covered by it. */
          height: calc(100dvh - var(--statusbar-height, 28px));
          overflow: hidden;
          flex-shrink: 0;
          transition: width 0.2s ease;
        }
        :host([rail]) { width: 56px; }

        /* ── Brand ── */
        .brand {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0 0.9rem;
          height: 52px;
          flex-shrink: 0;
          border-bottom: 1px solid var(--mr-hairline, #222);
          overflow: hidden;
          min-width: 0;
        }
        .brand-mark {
          flex-shrink: 0;
          height: 32px; width: auto; max-width: 44px;
          object-fit: contain;
          user-select: none;
          -webkit-user-drag: none;
        }
        .brand-name {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--mr-text, #EDEDED);
          letter-spacing: -0.01em;
          white-space: nowrap;
          overflow: hidden;
          min-width: 0;
        }
        /* Rail mode removes the label from layout entirely (display:none) rather
           than shrinking it to width:0 — a zero-width flex item can still be
           floored at its content width by flexbox's min-width:auto in some
           browsers, leaving the reported empty strip beside the icon. This
           matches how .search and the footer actions collapse below. */
        :host([rail]) .brand-name { display: none; }
        :host([rail]) .brand { justify-content: center; padding: 0; gap: 0; }

        /* ── Quick search ── */
        .search {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          margin: 0.65rem 0.65rem 0.35rem;
          padding: 0 0.55rem;
          height: 30px;
          flex-shrink: 0;
          background: var(--mr-surface, #141414);
          border: 1px solid var(--mr-frame, #2D2D2D);
          border-radius: var(--mr-radius, 8px);
          transition: border-color 0.12s, box-shadow 0.12s;
        }
        .search:focus-within {
          border-color: var(--mr-action, #F6821F);
          box-shadow: 0 0 0 3px var(--mr-action-tint, rgba(246,130,31,0.13));
        }
        .search .nav-icon { color: var(--mr-text-faint, #6E6E6E); }
        .search input {
          flex: 1;
          min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          color: var(--mr-text, #EDEDED);
          font-family: inherit;
          font-size: 0.76rem;
        }
        .search input::placeholder { color: var(--mr-text-faint, #6E6E6E); }
        .search kbd {
          flex-shrink: 0;
          font-family: inherit;
          font-size: 0.62rem;
          color: var(--mr-text-faint, #6E6E6E);
          border: 1px solid var(--mr-frame, #2D2D2D);
          border-radius: 4px;
          padding: 0 0.28rem;
          line-height: 1.5;
          white-space: nowrap;
        }
        :host([rail]) .search { display: none; }

        /* ── Nav ── */
        nav {
          flex: 1;
          padding: 0.35rem 0 0.5rem;
          overflow-y: auto;
          overflow-x: hidden;
        }
        nav::-webkit-scrollbar { width: 8px; }
        nav::-webkit-scrollbar-thumb { background: var(--mr-frame, #2D2D2D); border-radius: 4px; }

        .sect {
          padding: 0.85rem 0.9rem 0.3rem;
          font-size: 0.68rem;
          font-weight: 500;
          color: var(--mr-text-faint, #6E6E6E);
          white-space: nowrap;
          overflow: hidden;
          user-select: none;
        }
        .sect[hidden] { display: none; }
        :host([rail]) .sect { padding: 0.6rem 0 0; height: 1px; margin: 0 0.7rem; background: var(--mr-hairline, #222); overflow: hidden; color: transparent; }

        a {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.38rem 0.6rem;
          margin: 1px 0.65rem;
          color: var(--mr-text-muted, #9B9B9B);
          text-decoration: none;
          font-size: 0.79rem;
          font-weight: 400;
          border-radius: calc(var(--mr-radius, 8px) - 2px);
          white-space: nowrap;
          overflow: hidden;
          transition: background 0.1s, color 0.1s;
        }
        a[hidden] { display: none; }
        a:hover {
          background: var(--mr-surface, #141414);
          color: var(--mr-text, #EDEDED);
        }
        a.active {
          background: var(--mr-surface-raised, #1F1F1F);
          color: var(--mr-text, #EDEDED);
          font-weight: 500;
        }
        a:focus-visible {
          outline: 2px solid var(--mr-action, #F6821F);
          outline-offset: -2px;
        }
        .nav-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 15px; height: 15px;
          opacity: 0.85;
        }
        .nav-icon svg { width: 100%; height: 100%; }
        .nav-label {
          overflow: hidden;
          min-width: 0;
        }
        /* see .brand-name — display:none is the robust rail collapse. */
        :host([rail]) .nav-label { display: none; }
        :host([rail]) a { justify-content: center; gap: 0; padding-left: 0; padding-right: 0; margin: 1px 0.55rem; }

        .no-match {
          padding: 0.9rem;
          font-size: 0.74rem;
          color: var(--mr-text-faint, #6E6E6E);
        }
        .no-match[hidden] { display: none; }

        /* ── Footer ── */
        .footer {
          padding: 0.6rem 0.65rem;
          border-top: 1px solid var(--mr-hairline, #222);
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          flex-shrink: 0;
        }
        .user-row {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.2rem 0.25rem;
          min-width: 0;
          overflow: hidden;
        }
        .user-avatar {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--mr-action-tint, rgba(246,130,31,0.13));
          color: var(--mr-action, #F6821F);
          font-size: 0.6rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          text-transform: uppercase;
        }
        .user-info { min-width: 0; }
        :host([rail]) .user-info { display: none; }
        .user-name {
          font-size: 0.76rem;
          font-weight: 500;
          color: var(--mr-text, #EDEDED);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .user-role { font-size: 0.68rem; color: var(--mr-text-muted, #9B9B9B); }
        .footer-actions {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }
        .footer-actions a { flex: 1; margin: 0; }

        :host([rail]) .footer-actions > a,
        :host([rail]) #changelog-btn,
        :host([rail]) #theme-toggle { display: none; }
        :host([rail]) .footer-actions { justify-content: center; }
        :host([rail]) #rail-toggle { width: 36px; }
        .icon-btn {
          background: transparent;
          border: 1px solid var(--mr-frame, #2D2D2D);
          color: var(--mr-text-muted, #9B9B9B);
          border-radius: 6px;
          padding: 0.35rem 0.45rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: border-color 0.1s, color 0.1s, background 0.1s;
          line-height: 1;
        }
        .icon-btn:hover {
          border-color: var(--mr-text-faint, #6E6E6E);
          color: var(--mr-text, #EDEDED);
          background: var(--mr-surface, #141414);
        }
        .icon-btn:focus-visible {
          outline: 2px solid var(--mr-action, #F6821F);
          outline-offset: 2px;
        }

        /* ── Mobile ── */
        @media (max-width: 768px) {
          :host {
            position: fixed;
            left: 0; top: 0;
            height: calc(100dvh - var(--statusbar-height, 28px));
            transform: translateX(-100%);
            transition: transform 0.22s ease;
            z-index: 100;
            width: 236px !important;
          }
          :host([sidebar-open]) {
            transform: translateX(0);
            box-shadow: 8px 0 32px rgba(0,0,0,0.6);
          }
          .brand-name, .nav-label, .user-info { display: block !important; opacity: 1 !important; width: auto !important; }
          .search { display: flex !important; }
          .sect { height: auto !important; background: none !important; color: var(--mr-text-faint, #6E6E6E) !important; margin: 0 !important; padding: 0.85rem 0.9rem 0.3rem !important; }
        }
      </style>

      <div class="brand">
        <img class="brand-mark" src="/img/monsterops-mascot.png" alt="MonsterOps logo" />
        <span class="brand-name">MonsterOps</span>
      </div>

      <div class="search" id="search-box">
        ${icon('search', 14)}
        <input id="nav-search" type="text" placeholder="Quick search..." autocomplete="off"
               aria-label="Search navigation" />
        <kbd>Ctrl K</kbd>
      </div>

      <nav id="nav-links" aria-label="Main navigation"></nav>

      <div class="footer">
        <div class="user-row">
          <div class="user-avatar" id="user-avatar">?</div>
          <div class="user-info">
            <div class="user-name" id="user-name">—</div>
            <div class="user-role" id="user-role"></div>
          </div>
        </div>
        <div class="footer-actions">
          <a href="#/logout" id="logout-link" title="Log out">
            ${icon('logout')} <span class="nav-label">Log out</span>
          </a>
          <button id="changelog-btn" class="icon-btn" title="What's New" aria-label="What's New">✦</button>
          <button id="theme-toggle" class="icon-btn" title="Toggle theme" aria-label="Toggle dark/light theme"></button>
          <button id="rail-toggle" class="icon-btn" title="Collapse sidebar" aria-label="Toggle sidebar rail mode"></button>
        </div>
      </div>
    `;
  }

  onRender() {
    this._allLinks = [];
    this._sections = [];

    const nav = this.$('#nav-links');
    nav.addEventListener('keydown', (e) => this._onNavKeydown(e));

    window.addEventListener('hashchange', () => this._markActive());

    // Quick search — filters the nav; Ctrl/Cmd+K focuses it from anywhere.
    const input = this.$('#nav-search');
    input.addEventListener('input', () => this._applyFilter(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        this._applyFilter('');
        input.blur();
      } else if (e.key === 'Enter') {
        const first = this._allLinks.find((a) => !a.hidden);
        if (first) {
          location.hash = first.getAttribute('href');
          input.value = '';
          this._applyFilter('');
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._allLinks.find((a) => !a.hidden)?.focus();
      }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (document.body.classList.contains('no-sidebar')) return;
        e.preventDefault();
        if (this.hasAttribute('rail')) this._toggleRail();
        input.focus();
        input.select();
      }
    });

    this.$('#changelog-btn').addEventListener('click', (e) => {
      // Stop the opening click from reaching the drawer's outside-click handler,
      // which would otherwise close the drawer on the same click.
      e.stopPropagation();
      this._openChangelog();
    });
    this.$('#theme-toggle').addEventListener('click', () => this._toggleTheme());
    this.$('#rail-toggle').addEventListener('click', () => this._toggleRail());
    this._applyThemeIcon();
    this._applyRailIcon();
    this._restoreRail();
  }

  setNavEntries(entries) {
    this._entries = entries || [];
    const nav = this.$('#nav-links');
    nav.innerHTML = '';
    this._allLinks = [];
    this._sections = [];

    // Partition into top-level (ungrouped or unknown group) and known groups.
    const top = [];
    const groups = new Map();
    for (const entry of this._entries) {
      const g = entry.group;
      if (g && GROUP_META[g]) {
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(entry);
      } else {
        top.push(entry);
      }
    }

    for (const entry of top) nav.appendChild(this._navLink(entry));
    for (const key of GROUP_ORDER) {
      if (!groups.has(key)) continue;
      const sect = document.createElement('div');
      sect.className = 'sect';
      sect.textContent = GROUP_META[key].label;
      nav.appendChild(sect);
      const links = groups.get(key).map((c) => this._navLink(c));
      links.forEach((a) => nav.appendChild(a));
      this._sections.push({ el: sect, links });
    }

    const noMatch = document.createElement('div');
    noMatch.className = 'no-match';
    noMatch.textContent = 'No matching pages.';
    noMatch.hidden = true;
    nav.appendChild(noMatch);
    this._noMatch = noMatch;

    const q = this.$('#nav-search')?.value || '';
    if (q) this._applyFilter(q);
    this._markActive();
  }

  _navLink(entry) {
    const a = document.createElement('a');
    a.href = `#${entry.path}`;
    a.dataset.path = entry.path;
    a.dataset.label = entry.label.toLowerCase();
    a.title = entry.label;
    a.innerHTML = `${icon(entry.icon)}<span class="nav-label">${entry.label}</span>`;
    this._allLinks.push(a);
    return a;
  }

  _applyFilter(q) {
    const query = q.trim().toLowerCase();
    let any = false;
    for (const a of this._allLinks) {
      const show = !query || a.dataset.label.includes(query);
      a.hidden = !show;
      if (show) any = true;
    }
    for (const s of this._sections) {
      s.el.hidden = s.links.every((a) => a.hidden);
    }
    if (this._noMatch) this._noMatch.hidden = any;
  }

  _onNavKeydown(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = this._allLinks.filter((a) => !a.hidden);
    const active = this.shadowRoot.activeElement;
    const idx = items.indexOf(active);
    e.preventDefault();
    if (e.key === 'ArrowDown') {
      (items[idx + 1] || items[0])?.focus();
    } else if (idx <= 0) {
      this.$('#nav-search')?.focus();
    } else {
      items[idx - 1]?.focus();
    }
  }

  setUser(username, role) {
    const initials = username.slice(0, 2).toUpperCase();
    const avatarEl = this.$('#user-avatar');
    const nameEl = this.$('#user-name');
    const roleEl = this.$('#user-role');
    if (avatarEl) avatarEl.textContent = initials;
    if (nameEl) nameEl.textContent = username;
    if (roleEl) roleEl.textContent = role;
  }

  open() {
    this.setAttribute('sidebar-open', '');
  }
  close() {
    this.removeAttribute('sidebar-open');
  }
  toggle() {
    this.hasAttribute('sidebar-open') ? this.close() : this.open();
  }

  _markActive() {
    const hash = location.hash.slice(1) || '/';
    const current = hash.split('?')[0];
    this.$$('a[data-path]').forEach((a) => {
      a.classList.toggle('active', current === a.dataset.path);
    });
  }

  _toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('mr_theme', next);
    this._applyThemeIcon();
  }
  _applyThemeIcon() {
    const btn = this.$('#theme-toggle');
    if (!btn) return;
    const light = document.documentElement.dataset.theme === 'light';
    btn.innerHTML = light ? MOON : SUN;
    btn.title = light ? 'Switch to dark theme' : 'Switch to light theme';
    btn.setAttribute('aria-label', btn.title);
  }

  _toggleRail() {
    const isRail = this.hasAttribute('rail');
    isRail ? this.removeAttribute('rail') : this.setAttribute('rail', '');
    localStorage.setItem('mr_sidebar_rail', isRail ? '0' : '1');
    this._applyRailIcon();
  }
  _applyRailIcon() {
    const btn = this.$('#rail-toggle');
    if (!btn) return;
    const isRail = this.hasAttribute('rail');
    btn.innerHTML = isRail ? icon('chevrons-right', 14) : icon('chevrons-left', 14);
    btn.title = isRail ? 'Expand sidebar' : 'Collapse sidebar';
    btn.setAttribute('aria-label', btn.title);
  }
  _restoreRail() {
    if (localStorage.getItem('mr_sidebar_rail') === '1') {
      this.setAttribute('rail', '');
      this._applyRailIcon();
    }
  }

  async _openChangelog() {
    // Build or reuse the drawer element
    let drawer = document.getElementById('mr-changelog-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'mr-changelog-drawer';
      drawer.style.cssText = [
        'position:fixed;top:0;right:-420px;width:420px;max-width:100vw;height:100vh',
        'background:var(--color-surface);border-left:1px solid var(--color-border)',
        'box-shadow:-4px 0 24px rgba(0,0,0,.18);z-index:9000',
        'overflow-y:auto;transition:right .25s ease;display:flex;flex-direction:column',
      ].join(';');
      drawer.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.25rem;border-bottom:1px solid var(--color-border);position:sticky;top:0;background:var(--color-surface);z-index:1;">
          <span style="font-weight:600;font-size:1rem;">What's New</span>
          <button id="mr-changelog-close" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--color-muted);padding:2px 6px;" aria-label="Close">✕</button>
        </div>
        <div id="mr-changelog-body" style="padding:1.25rem;flex:1;font-size:0.85rem;line-height:1.6;color:var(--color-text);">Loading…</div>
      `;
      document.body.appendChild(drawer);
      drawer.querySelector('#mr-changelog-close').addEventListener('click', () => {
        drawer.style.right = '-420px';
      });
      // Close on outside click. Use composedPath() so a click on the trigger
      // button — which lives in this component's shadow DOM and is retargeted
      // to <app-sidebar> at the document level — is correctly recognised.
      document.addEventListener('click', (e) => {
        if (drawer.style.right !== '0px') return;
        const path = e.composedPath();
        if (path.includes(drawer) || path.includes(this.$('#changelog-btn'))) return;
        drawer.style.right = '-420px';
      });
    }
    drawer.style.right = '0px';

    const body = drawer.querySelector('#mr-changelog-body');
    if (body.dataset.loaded) return;
    try {
      const data = await api.get('/system/changelog');
      if (!data?.releases?.length) {
        body.textContent = 'No changelog available.';
        return;
      }
      body.innerHTML = data.releases.map((r) => `
        <div style="margin-bottom:1.75rem;">
          <div style="display:flex;align-items:baseline;gap:.6rem;margin-bottom:.5rem;">
            <span style="font-weight:700;font-size:.95rem;color:var(--mr-action)">${r.version}</span>
            <span style="font-size:.75rem;color:var(--color-muted)">${r.date}</span>
          </div>
          ${
        Object.entries(r.sections || {}).map(([section, items]) => `
            <div style="margin-bottom:.6rem;">
              <div style="font-weight:600;font-size:.8rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.25rem;">${section}</div>
              <ul style="margin:0;padding-left:1.1rem;">
                ${items.map((i) => `<li style="margin-bottom:.2rem;">${i}</li>`).join('')}
              </ul>
            </div>
          `).join('')
      }
        </div>
      `).join(
        '<hr style="border:none;border-top:1px solid var(--color-border);margin:0 0 1.25rem;">',
      );
      body.dataset.loaded = '1';
    } catch {
      body.textContent = 'Could not load changelog.';
    }
  }
}

customElements.define('app-sidebar', AppSidebar);
