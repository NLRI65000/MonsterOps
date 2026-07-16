/**
 * Shared table utilities for MonsterOps.
 *
 * Density toggle — three row heights (compact / default / comfortable)
 * persisted globally in localStorage so all tables stay in sync.
 *
 * Usage in a shadow-DOM module:
 *
 *   import { densityBarHTML, wireDensityBar, applyDensity } from '/js/utils/table.js';
 *
 *   // In template string:
 *   `... ${densityBarHTML()} <div class="card" id="wrap">...</div>`
 *
 *   // In connectedCallback after template render:
 *   wireDensityBar(this.shadowRoot, () => this.shadowRoot.querySelector('#wrap table'));
 *
 *   // At the end of every table render:
 *   applyDensity(wrap.querySelector('table'));
 */

const DENSITY_KEY = 'mr_table_density';

export function getDensity() {
  return localStorage.getItem(DENSITY_KEY) ?? 'default';
}

export function applyDensity(table) {
  if (!table) return;
  const d = getDensity();
  table.classList.remove('density-compact', 'density-comfortable');
  if (d !== 'default') table.classList.add(`density-${d}`);
}

const _ICONS = {
  compact:
    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
    <line x1="1" y1="4" x2="13" y2="4"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="1" y1="10" x2="13" y2="10"/>
  </svg>`,
  default:
    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
    <line x1="1" y1="3" x2="13" y2="3"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="1" y1="11" x2="13" y2="11"/>
  </svg>`,
  comfortable:
    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
    <line x1="1" y1="3" x2="13" y2="3"/><line x1="1" y1="11" x2="13" y2="11"/>
  </svg>`,
};

/** Returns the HTML string for the density toggle bar. */
export function densityBarHTML() {
  return `<div class="density-bar">
    <button class="density-btn" data-d="compact" title="Compact rows">${_ICONS.compact}</button>
    <button class="density-btn" data-d="default"  title="Default rows">${_ICONS.default}</button>
    <button class="density-btn" data-d="comfortable" title="Comfortable rows">${_ICONS.comfortable}</button>
  </div>`;
}

/**
 * Wire the density bar inside `root` (document or shadowRoot).
 * `tableGetter` is called lazily on each interaction/refresh to find the current table.
 */
export function wireDensityBar(root, tableGetter) {
  const bar = root.querySelector('.density-bar');
  if (!bar) return;

  const refresh = () => {
    const d = getDensity();
    bar.querySelectorAll('.density-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.d === d);
    });
    applyDensity(tableGetter());
  };

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-d]');
    if (!btn) return;
    localStorage.setItem(DENSITY_KEY, btn.dataset.d);
    refresh();
  });

  refresh();
}

// ── column sorting ───────────────────────────────────────────────────────────
// Click a header to sort the tbody by that column; click again to reverse.
// The sort key for a row is the cell's `data-sort` attribute when present, else
// its trimmed text — so a "12 ms" or a formatted date can carry a clean numeric
// key. Comparison is numeric when both keys are numbers, otherwise a
// natural-order (numeric-aware, case-insensitive) string compare. Headers marked
// `data-no-sort`, or with no text (e.g. an actions column), are skipped.
//
// Call once after each (re)render — it wires the freshly-rendered <thead> and
// sets `aria-sort` + a ▲/▼ indicator on the active column. Pass
// `{ default: { col, dir } }` to apply an initial sort.
//
// SERVER-SIDE MODE — for paginated tables, a client sort would only reorder the
// visible page. Pass `{ onSort(key, dir) }` and a header click calls it (with
// the header's `data-sort-key`, or its text) instead of sorting the DOM — the
// caller refetches sorted from the server. Reflect the active sort on each
// re-render with `{ active: { key, dir } }`.

const _CARET = { asc: '▲', desc: '▼' };

function _cellKey(row, col) {
  const cell = row.cells[col];
  if (!cell) return '';
  const raw = cell.getAttribute('data-sort');
  return (raw != null ? raw : cell.textContent).trim();
}

function _sortBy(tbody, col, asc) {
  const isNum = (v) => v !== '' && !Number.isNaN(Number(v));
  const rows = [...tbody.rows];
  rows.sort((a, b) => {
    const ka = _cellKey(a, col), kb = _cellKey(b, col);
    const cmp = (isNum(ka) && isNum(kb))
      ? Number(ka) - Number(kb)
      : ka.localeCompare(kb, undefined, { numeric: true, sensitivity: 'base' });
    return asc ? cmp : -cmp;
  });
  const frag = document.createDocumentFragment();
  rows.forEach((r) => frag.appendChild(r)); // Array.sort is stable → ties keep order
  tbody.appendChild(frag);
}

export function makeSortable(table, opts = {}) {
  if (!table || !table.tHead || !table.tBodies[0]) return;
  const tbody = table.tBodies[0];
  const ths = [...table.tHead.rows[0].cells];
  const server = typeof opts.onSort === 'function';
  const keyOf = (th) => th.getAttribute('data-sort-key') || th.textContent.trim();

  const clearIndicators = () =>
    ths.forEach((o) => {
      o.setAttribute('aria-sort', 'none');
      const c = o.querySelector('.mr-sort-caret');
      if (c) c.textContent = '';
    });

  const mark = (th, asc) => {
    clearIndicators();
    th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
    const c = th.querySelector('.mr-sort-caret');
    if (c) c.textContent = asc ? _CARET.asc : _CARET.desc;
  };

  ths.forEach((th, col) => {
    if (th.hasAttribute('data-no-sort') || !th.textContent.trim()) return;
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    th.setAttribute('aria-sort', 'none');
    if (!th.querySelector('.mr-sort-caret')) {
      const c = document.createElement('span');
      c.className = 'mr-sort-caret';
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText =
        'display:inline-block;width:1em;margin-left:0.15em;opacity:0.7;font-size:0.7em;';
      th.appendChild(c);
    }
    th.addEventListener('click', () => {
      const asc = th.getAttribute('aria-sort') !== 'ascending';
      if (server) opts.onSort(keyOf(th), asc ? 'asc' : 'desc');
      else _sortBy(tbody, col, asc);
      mark(th, asc);
    });
  });

  // Server mode: just reflect the caller's currently-active sort on re-render.
  if (server) {
    if (opts.active && opts.active.key) {
      const th = ths.find((t) => keyOf(t) === opts.active.key);
      if (th) mark(th, opts.active.dir !== 'desc');
    }
    return;
  }

  if (opts.default != null && ths[opts.default.col]) {
    const { col, dir = 'asc' } = opts.default;
    const th = ths[col];
    if (!th.hasAttribute('data-no-sort') && th.textContent.trim()) {
      const asc = dir === 'asc';
      _sortBy(tbody, col, asc);
      mark(th, asc);
    }
  }
}
