class AppConfirm extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    const title = this._confirmTitle ?? 'Confirm';
    const message = this._confirmMessage ?? '';
    const danger = this._confirmDanger ?? false;
    const okLabel = this._confirmOkLabel ?? (danger ? 'Delete' : 'Confirm');

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }
        .overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
        }
        .dialog {
          position: relative;
          background: var(--color-surface, #1a1d27);
          border: 1px solid var(--color-border, #2a2d3a);
          border-radius: var(--radius, 8px);
          padding: 1.5rem;
          width: min(420px, calc(100vw - 2rem));
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
          animation: pop-in 0.15s ease;
        }
        @keyframes pop-in {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        h3 {
          margin: 0 0 0.75rem;
          font-size: 1rem;
          font-weight: 600;
          color: var(--color-text, #e2e8f0);
        }
        p {
          margin: 0 0 1.25rem;
          font-size: 0.875rem;
          color: var(--color-muted, #94a3b8);
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
        }
        button {
          padding: 0.45rem 1rem;
          border-radius: var(--radius, 8px);
          border: none;
          cursor: pointer;
          font-size: 0.875rem;
          font-family: var(--font, system-ui, sans-serif);
          transition: opacity 0.15s;
        }
        button:hover { opacity: 0.85; }
        #btn-cancel {
          background: transparent;
          border: 1px solid var(--color-border, #2a2d3a);
          color: var(--color-muted, #94a3b8);
        }
        #btn-ok {
          background: ${danger ? 'var(--color-danger, #ef4444)' : 'var(--color-accent, #6366f1)'};
          color: #fff;
        }
      </style>
      <div class="overlay" id="overlay"></div>
      <div class="dialog" role="dialog" aria-modal="true">
        <h3>${_esc(title)}</h3>
        <p>${_esc(message)}</p>
        <div class="actions">
          <button id="btn-cancel">Cancel</button>
          <button id="btn-ok">${_esc(okLabel)}</button>
        </div>
      </div>
    `;

    this.shadowRoot.getElementById('overlay').addEventListener('click', () => this._resolve(false));
    this.shadowRoot.getElementById('btn-cancel').addEventListener(
      'click',
      () => this._resolve(false),
    );
    this.shadowRoot.getElementById('btn-ok').addEventListener('click', () => this._resolve(true));

    this.shadowRoot.getElementById('btn-ok').focus();

    this._keyHandler = (e) => {
      if (e.key === 'Escape') this._resolve(false);
      if (e.key === 'Enter') this._resolve(true);
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._keyHandler);
  }

  _resolve(value) {
    this.dispatchEvent(new CustomEvent('confirm:result', { detail: value, bubbles: true }));
  }
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

customElements.define('app-confirm', AppConfirm);

/**
 * Show a confirmation dialog.
 * @param {string} message
 * @param {{ title?: string, danger?: boolean, okLabel?: string }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, { title = 'Confirm', danger = false, okLabel } = {}) {
  return new Promise((resolve) => {
    const el = document.createElement('app-confirm');
    el._confirmTitle = title;
    el._confirmMessage = message;
    el._confirmDanger = danger;
    el._confirmOkLabel = okLabel;
    document.body.appendChild(el);
    el.addEventListener('confirm:result', (e) => {
      el.remove();
      resolve(e.detail);
    }, { once: true });
  });
}
