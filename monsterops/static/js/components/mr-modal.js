// ── mr-modal ──────────────────────────────────────────────────────────────────
// A shared, self-contained modal shell for the "Console" design system.
//
// The overlay is appended to <body> (so it escapes card overflow and stacking
// contexts) and carries its OWN <style> inline. That matters: modules are hosted
// inside shadow-DOM workspaces now, and a page's shadow-scoped <style> does NOT
// reach a body-appended element. Shipping the CSS with the overlay makes the
// modal render the same whether its opener lives in light or shadow DOM.
//
// CSS custom properties (--mr-*) still inherit from :root into the overlay, so
// the modal picks up the active theme automatically.

export const MODAL_CSS = `
  .mrm-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0, 0, 0, 0.62);
    backdrop-filter: blur(2px);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 4rem 1rem 2rem; overflow-y: auto;
    font-family: var(--mr-font-body, 'Inter', system-ui, sans-serif);
    color: var(--mr-text, #EDEDED);
  }
  .mrm-card {
    width: 100%; max-width: 560px; margin: auto;
    background: var(--mr-surface, #141414);
    border: 1px solid var(--mr-frame, #2D2D2D);
    border-radius: var(--mr-radius-lg, 12px);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
    animation: mrm-in 0.14s ease-out;
  }
  @keyframes mrm-in { from { opacity: 0; transform: translateY(6px) scale(0.99); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .mrm-card { animation: none; } }

  .mrm-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;
    padding: 1.15rem 1.4rem; border-bottom: 1px solid var(--mr-hairline, #222);
  }
  .mrm-title { font-size: 1.02rem; font-weight: 600; margin: 0; letter-spacing: -0.01em; color: var(--mr-text, #EDEDED); }
  .mrm-sub { font-size: 0.8rem; color: var(--mr-text-muted, #9B9B9B); margin: 0.25rem 0 0; line-height: 1.45; }
  .mrm-x {
    background: none; border: none; color: var(--mr-text-faint, #6E6E6E); cursor: pointer;
    font-size: 1rem; line-height: 1; padding: 0.25rem 0.35rem; border-radius: 6px; flex-shrink: 0;
    transition: color 0.12s, background 0.12s;
  }
  .mrm-x:hover { color: var(--mr-text, #EDEDED); background: var(--mr-surface-raised, #1F1F1F); }

  .mrm-body { padding: 1.3rem 1.4rem; display: flex; flex-direction: column; gap: 1.05rem; }
  .mrm-field { display: flex; flex-direction: column; gap: 0.4rem; }
  .mrm-label { font-size: 0.78rem; font-weight: 500; color: var(--mr-text-muted, #9B9B9B); }
  .mrm-label-note { font-weight: 400; text-transform: none; color: var(--mr-text-faint, #6E6E6E); }

  .mrm-input, .mrm-select {
    width: 100%; box-sizing: border-box;
    padding: 0.5rem 0.7rem;
    background: var(--mr-canvas, #0A0A0A);
    border: 1px solid var(--mr-frame, #2D2D2D);
    border-radius: var(--mr-radius, 8px);
    color: var(--mr-text, #EDEDED);
    font-size: 0.88rem; font-family: inherit; line-height: 1.4;
    color-scheme: dark;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .mrm-input::placeholder { color: var(--mr-text-faint, #6E6E6E); }
  .mrm-input:focus, .mrm-select:focus {
    outline: none; border-color: var(--mr-action, #F6821F);
    box-shadow: 0 0 0 3px var(--mr-action-tint, rgba(246, 130, 31, 0.13));
  }
  .mrm-mono { font-family: var(--mr-font-data, monospace); }

  .mrm-help { font-size: 0.76rem; color: var(--mr-text-faint, #6E6E6E); line-height: 1.45; }
  .mrm-help code { font-family: var(--mr-font-data, monospace); color: var(--mr-text-muted, #9B9B9B); }

  .mrm-check { display: inline-flex; align-items: center; gap: 0.55rem; cursor: pointer; font-size: 0.88rem; color: var(--mr-text, #EDEDED); }
  .mrm-check input { width: 15px; height: 15px; accent-color: var(--mr-action, #F6821F); cursor: pointer; margin: 0; }

  /* Conditions (automation rules) */
  .mrm-cond-list { display: flex; flex-direction: column; gap: 0.4rem; }
  .mrm-cond-row { display: grid; grid-template-columns: 1fr 1fr 1.2fr auto; gap: 0.4rem; align-items: center; }
  .mrm-cond-row .mrm-select, .mrm-cond-row .mrm-input { margin: 0; }
  .mrm-icon-btn {
    width: 34px; height: 34px; flex-shrink: 0; padding: 0;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: 1px solid var(--mr-frame, #2D2D2D);
    border-radius: var(--mr-radius, 8px); color: var(--mr-text-muted, #9B9B9B);
    cursor: pointer; font-size: 0.8rem; transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .mrm-icon-btn:hover { color: var(--mr-reject, #F55B56); border-color: var(--mr-reject, #F55B56); }
  .mrm-add { align-self: flex-start; }

  /* Event chips (webhooks) */
  .mrm-evt-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 0.4rem;
    max-height: 210px; overflow-y: auto; padding: 0.15rem;
  }
  .mrm-evt {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.6rem; border: 1px solid var(--mr-frame, #2D2D2D); border-radius: 7px;
    background: var(--mr-canvas, #0A0A0A); cursor: pointer; font-size: 0.78rem;
    transition: border-color 0.12s, background 0.12s;
  }
  .mrm-evt:hover { border-color: var(--mr-text-faint, #6E6E6E); }
  .mrm-evt:has(input:checked) { border-color: var(--mr-action, #F6821F); background: var(--mr-action-tint, rgba(246, 130, 31, 0.13)); }
  .mrm-evt input { accent-color: var(--mr-action, #F6821F); cursor: pointer; margin: 0; flex-shrink: 0; }
  .mrm-evt code { font-family: var(--mr-font-data, monospace); color: var(--mr-text, #EDEDED); overflow: hidden; text-overflow: ellipsis; }

  /* Footer */
  .mrm-foot {
    display: flex; justify-content: flex-end; gap: 0.6rem;
    padding: 1rem 1.4rem; border-top: 1px solid var(--mr-hairline, #222);
  }
  .mrm-btn {
    padding: 0.5rem 1.1rem; border-radius: var(--mr-radius, 8px); border: 1px solid transparent;
    font-size: 0.85rem; font-weight: 500; font-family: inherit; cursor: pointer; line-height: 1.3;
    transition: background 0.12s, border-color 0.12s, opacity 0.12s;
  }
  .mrm-btn-primary { background: var(--mr-action, #F6821F); color: #fff; }
  .mrm-btn-primary:hover { background: color-mix(in srgb, var(--mr-action, #F6821F) 88%, white); }
  .mrm-btn-primary:disabled { opacity: 0.55; cursor: default; }
  .mrm-btn-ghost { background: transparent; border-color: var(--mr-frame, #2D2D2D); color: var(--mr-text, #EDEDED); }
  .mrm-btn-ghost:hover { background: var(--mr-surface-raised, #1F1F1F); }
`;

// Open a modal with the shared shell. `bodyHTML` is the caller's form markup
// (caller is responsible for escaping any user-supplied values in it).
// Returns handles so the caller can wire validation/submit and close on success.
export function openModal(
  { title, subtitle = '', bodyHTML = '', submitLabel = 'Save', cancelLabel = 'Cancel' },
) {
  const overlay = document.createElement('div');
  overlay.className = 'mrm-overlay';
  overlay.innerHTML = `
    <style>${MODAL_CSS}</style>
    <div class="mrm-card" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="mrm-head">
        <div>
          <h2 class="mrm-title">${title}</h2>
          ${subtitle ? `<p class="mrm-sub">${subtitle}</p>` : ''}
        </div>
        <button type="button" class="mrm-x" data-mrm-close aria-label="Close">✕</button>
      </div>
      <div class="mrm-body">${bodyHTML}</div>
      <div class="mrm-foot">
        <button type="button" class="mrm-btn mrm-btn-ghost" data-mrm-close>${cancelLabel}</button>
        <button type="button" class="mrm-btn mrm-btn-primary" data-mrm-submit>${submitLabel}</button>
      </div>
    </div>
  `;

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelectorAll('[data-mrm-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  // Focus the first field for keyboard users.
  requestAnimationFrame(() => {
    const first = overlay.querySelector('.mrm-body input, .mrm-body select, .mrm-body textarea');
    if (first) first.focus();
  });

  const submitBtn = overlay.querySelector('[data-mrm-submit]');
  return {
    overlay,
    close,
    submitBtn,
    onSubmit: (fn) => submitBtn.addEventListener('click', fn),
    q: (sel) => overlay.querySelector(sel),
    qa: (sel) => [...overlay.querySelectorAll(sel)],
  };
}
