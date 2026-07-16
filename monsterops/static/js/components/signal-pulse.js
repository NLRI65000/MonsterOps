/**
 * <signal-pulse> — live data indicator for MonsterOps.
 *
 * Used ONLY on genuinely live / real-time data:
 *   NAS online status, active session count, online users widget.
 *
 * Attributes:
 *   state   — "accept" (green) | "reject" (coral) | "action" (blue) | "muted" (no animation)
 *   label   — accessible aria-label override
 *
 * Usage:
 *   <signal-pulse state="accept"></signal-pulse>
 *   <signal-pulse state="reject" label="NAS offline"></signal-pulse>
 */
const COLORS = {
  accept: 'var(--mr-accept, #4ADE9A)',
  reject: 'var(--mr-reject, #FF6B5B)',
  action: 'var(--mr-action, #4FA8FF)',
  muted: 'var(--mr-text-muted, #8B95A5)',
};

const STYLE = `
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 10px;
    height: 10px;
    flex-shrink: 0;
  }
  .dot {
    position: relative;
    width: 8px;
    height: 8px;
  }
  .dot::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--pulse-color);
  }
  .dot::after {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    background: var(--pulse-color);
    opacity: 0;
    animation: signal-ring 2.4s ease-out infinite;
  }
  .dot.muted::after { animation: none; }
  @keyframes signal-ring {
    0%   { transform: scale(0.5); opacity: 0.7; }
    70%  { transform: scale(2.4); opacity: 0; }
    100% { transform: scale(2.4); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot::after { animation: none; }
  }
`;

class SignalPulse extends HTMLElement {
  static get observedAttributes() {
    return ['state', 'label'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this._render();
  }
  attributeChangedCallback() {
    this._render();
  }

  _render() {
    const state = this.getAttribute('state') ?? 'muted';
    const label = this.getAttribute('label') ?? this._defaultLabel(state);
    const color = COLORS[state] ?? COLORS.muted;

    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', label);

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <div class="dot ${state === 'muted' ? 'muted' : ''}"
           style="--pulse-color: ${color}">
      </div>
    `;
  }

  _defaultLabel(state) {
    return { accept: 'Online', reject: 'Offline', action: 'Active', muted: 'Unknown' }[state] ??
      'Unknown';
  }
}

customElements.define('signal-pulse', SignalPulse);
export { SignalPulse };
