import { BaseComponent } from './base-component.js';

/**
 * <app-toast> — global toast notification container.
 *
 * Usage (from anywhere):
 *   import { toast } from '/js/components/app-toast.js';
 *   toast('User created', 'success');
 *   toast('Connection failed', 'error');
 *   toast('Session expired', 'warning');
 */

const ICONS = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

// Toast messages routinely carry user- and server-controlled strings (entity
// names, API error details). Escape before interpolating into innerHTML so a
// value like `<img src=x onerror=…>` renders as text instead of executing.
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class AppToast extends BaseComponent {
  static get template() {
    return `
      <style>
        :host {
          position: fixed;
          bottom: 1.5rem;
          right: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          z-index: 9999;
          pointer-events: none;
        }
        .toast {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.75rem 1.1rem;
          border-radius: 8px;
          font-size: 0.875rem;
          font-family: system-ui, sans-serif;
          color: #fff;
          pointer-events: auto;
          animation: slide-in 0.2s ease;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          max-width: 360px;
        }
        .toast.success { background: #16a34a; }
        .toast.error   { background: #dc2626; }
        .toast.warning { background: #d97706; }
        .toast.info    { background: #2563eb; }
        .icon { font-size: 1rem; flex-shrink: 0; }
        @keyframes slide-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
      </style>
    `;
  }

  show(message, type = 'info', duration = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="icon">${ICONS[type] ?? ICONS.info}</span><span>${
      _esc(message)
    }</span>`;
    this.shadowRoot.appendChild(el);

    setTimeout(() => {
      el.style.animation = 'fade-out 0.3s ease forwards';
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, duration);
  }
}

customElements.define('app-toast', AppToast);

// Singleton helper — insert <app-toast> once, export a function for convenience.
let _toastEl = null;
function _getOrCreate() {
  if (!_toastEl) {
    _toastEl = document.createElement('app-toast');
    document.body.appendChild(_toastEl);
  }
  return _toastEl;
}

export function toast(message, type = 'info', duration = 3500) {
  _getOrCreate().show(message, type, duration);
}
