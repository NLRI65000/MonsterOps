/**
 * <mr-card> — unified card primitive for MonsterOps.
 *
 * Attributes:
 *   title      — small uppercase label above the content
 *   subtitle   — optional secondary label (right-aligned in header)
 *   padding    — "none" to remove inner padding (for full-bleed tables)
 *
 * Slots:
 *   (default)  — card body content
 *   action     — placed top-right, next to the subtitle
 */
class MrCard extends HTMLElement {
  static get observedAttributes() { return ['title', 'subtitle', 'padding']; }

  connectedCallback() { this._render(); }
  attributeChangedCallback() { this._render(); }

  _render() {
    const title    = this.getAttribute('title') ?? '';
    const subtitle = this.getAttribute('subtitle') ?? '';
    const noPad    = this.getAttribute('padding') === 'none';

    const hasHeader = title || subtitle || this.querySelector('[slot="action"]');

    this.style.cssText = `
      display: block;
      background: var(--mr-surface, #161B22);
      border: 1px solid var(--mr-hairline, #262C36);
      border-radius: var(--mr-radius-lg, 10px);
      overflow: hidden;
    `;

    // Only re-render the shell; preserve the slotted content
    let shell = this.querySelector(':scope > .mr-card-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'mr-card-shell';
      // Move existing children into shell (initial render)
      while (this.firstChild) shell.appendChild(this.firstChild);
      this.appendChild(shell);
    }

    shell.style.cssText = noPad ? '' : 'padding: 1.25rem 1.5rem;';

    // Header
    let header = this.querySelector(':scope > .mr-card-header');
    if (hasHeader) {
      if (!header) {
        header = document.createElement('div');
        header.className = 'mr-card-header';
        this.insertBefore(header, shell);
      }
      header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.875rem 1.5rem 0;
        gap: 0.75rem;
      `;
      header.innerHTML = `
        <span style="
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--mr-text-muted, #8B95A5);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-family: var(--mr-font-body, 'IBM Plex Sans', system-ui, sans-serif);
        ">${title}</span>
        <span style="
          font-size: 0.75rem;
          color: var(--mr-text-muted, #8B95A5);
          font-family: var(--mr-font-body, 'IBM Plex Sans', system-ui, sans-serif);
          display:flex; align-items:center; gap:0.5rem;
        ">
          ${subtitle}
          <slot name="action"></slot>
        </span>
      `;
    } else if (header) {
      header.remove();
    }
  }
}

customElements.define('mr-card', MrCard);
export { MrCard };
