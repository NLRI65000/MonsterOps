// ── empty-state + loading-skeleton helpers ──────────────────────────────────
// The "empty-state markup unification + loading skeletons" dimension of the UI
// consistency audit (roadmap #7). Before this, empty states were spelled seven
// different ways across modules (.empty / .empty-state / .empty-msg /
// .state-empty / …) and "loading" was a bare "Loading…" text that jumped the
// layout when the real rows arrived.
//
// Like utils/form.js these are DOM-agnostic and style INLINE (theme
// custom-properties + hard fallbacks) so one helper renders identically in
// light DOM, per-module shadow roots, and body-appended modals — a global
// stylesheet can't reach into a shadow root. The skeleton shimmer needs
// @keyframes, which can't live in a style attribute and are tree-scoped, so it
// injects a tiny <style> into the target root once (deduped, reduced-motion
// aware).

const TEXT = 'var(--mr-text, #EDEDED)';
const MUTED = 'var(--mr-text-muted, #9B9B9B)';
const ACCENT = 'var(--mr-action, #F6821F)';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const EMPTY_WRAP = 'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
  'gap:0.4rem;padding:2.75rem 1.5rem;text-align:center;';

/**
 * Build the inner HTML for a centered empty state:
 *   emptyStateHTML({ icon, title, message })
 * `icon` is a raw inline SVG/emoji string (trusted, optional); `title` is the
 * bold line and `message` the muted explanation (both escaped — they routinely
 * carry entity names / search terms). Drop the result straight into innerHTML.
 */
export function emptyStateHTML({ icon = '', title = '', message = '' } = {}) {
  const iconHTML = icon
    ? `<div class="mr-empty-icon" style="opacity:0.45;line-height:0;margin-bottom:0.15rem;" aria-hidden="true">${icon}</div>`
    : '';
  const titleHTML = title
    ? `<div class="mr-empty-title" style="color:${TEXT};font-size:0.9rem;font-weight:600;">${
      esc(title)
    }</div>`
    : '';
  const msgHTML = message
    ? `<div class="mr-empty-msg" style="color:${MUTED};font-size:0.82rem;line-height:1.5;max-width:40ch;">${
      esc(message)
    }</div>`
    : '';
  return `<div class="mr-empty" style="${EMPTY_WRAP}">${iconHTML}${titleHTML}${msgHTML}</div>`;
}

/**
 * A full-width empty state that spans a table body — drop into a `<tbody>` when
 * a query returns no rows:  body.innerHTML = emptyRowHTML(cols, { title, … })
 */
export function emptyRowHTML(cols, opts = {}) {
  return `<tr class="mr-empty-row"><td colspan="${cols}" style="border:none;padding:0;">${
    emptyStateHTML(opts)
  }</td></tr>`;
}

/**
 * Element form of {@link emptyStateHTML} that also supports an accent action
 * button (which can't survive an innerHTML string):
 *   panel.replaceChildren(emptyState({ title, message,
 *     action: { label: 'Create key', onClick: () => this._openModal() } }));
 */
export function emptyState({ icon, title, message, action } = {}) {
  const tmp = document.createElement('template');
  tmp.innerHTML = emptyStateHTML({ icon, title, message }).trim();
  const el = tmp.content.firstElementChild;
  if (action && action.label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.setAttribute(
      'style',
      `margin-top:0.6rem;padding:0.45rem 0.9rem;border:none;border-radius:6px;` +
        `background:${ACCENT};color:#111;font-size:0.82rem;font-weight:600;cursor:pointer;`,
    );
    if (action.onClick) btn.addEventListener('click', action.onClick);
    el.appendChild(btn);
  }
  return el;
}

// ── loading skeletons ───────────────────────────────────────────────────────

const SKEL_CSS = '.mr-skel{display:block;height:0.72em;border-radius:4px;' +
  'background:linear-gradient(90deg,' +
  'var(--mr-surface-raised,#1F1F1F) 25%,var(--mr-frame,#2D2D2D) 37%,' +
  'var(--mr-surface-raised,#1F1F1F) 63%);' +
  'background-size:400% 100%;animation:mr-shimmer 1.3s ease-in-out infinite;}' +
  '@keyframes mr-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}' +
  '@media (prefers-reduced-motion:reduce){.mr-skel{animation:none}}';

// Inject the shimmer keyframes + class into `root` (its shadow root or the
// document head) exactly once. @keyframes are tree-scoped, so the style must
// live in the same root as the skeleton nodes.
function ensureShimmer(root) {
  const target = root && root.nodeType === 11 /* ShadowRoot */
    ? root
    : (root && root.head) || document.head;
  if (target.querySelector('#mr-skel-style')) return;
  const style = document.createElement('style');
  style.id = 'mr-skel-style';
  style.textContent = SKEL_CSS;
  target.appendChild(style);
}

const _WIDTHS = [70, 45, 85, 55, 60, 40, 78, 50];

/**
 * Skeleton `<tr>` rows to fill a table body while it loads, so the table keeps
 * its shape instead of collapsing to a "Loading…" line and jumping when the
 * data lands. `root` is the tree the rows will live in (usually
 * `this.shadowRoot`) — needed to place the shimmer keyframes.
 *
 *   body.innerHTML = skeletonRows(this.shadowRoot, 5);   // 5 columns
 */
export function skeletonRows(root, cols, rows = 6) {
  ensureShimmer(root);
  let html = '';
  for (let r = 0; r < rows; r++) {
    let tds = '';
    for (let c = 0; c < cols; c++) {
      const w = _WIDTHS[(r + c) % _WIDTHS.length];
      tds += `<td><span class="mr-skel" style="width:${w}%"></span></td>`;
    }
    html += `<tr class="mr-skel-row" aria-hidden="true">${tds}</tr>`;
  }
  return html;
}

/**
 * A block of stacked skeleton lines for non-table loading regions (detail
 * panels, cards). `lines` bars of varying width.
 *
 *   panel.innerHTML = skeletonBlock(this.shadowRoot, 4);
 */
export function skeletonBlock(root, lines = 4) {
  ensureShimmer(root);
  let html =
    '<div class="mr-skel-block" aria-hidden="true" style="display:flex;flex-direction:column;gap:0.7rem;padding:1.2rem 0;">';
  for (let i = 0; i < lines; i++) {
    const w = _WIDTHS[i % _WIDTHS.length];
    html += `<span class="mr-skel" style="width:${w}%;height:0.85em;"></span>`;
  }
  return html + '</div>';
}
