/**
 * BaseComponent — lightweight base class for all MonsterOps Web Components.
 *
 * Subclass it, define a static `template` getter returning an HTML string,
 * and optionally override `connectedCallback` (call super.connectedCallback()
 * first so the shadow root is populated before your code runs).
 */
export class BaseComponent extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  /** Override in subclass to provide HTML + scoped CSS. */
  static get template() {
    return '<slot></slot>';
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = this.constructor.template;
    this.onRender();
  }

  /** Called after the shadow DOM is populated. Override for event wiring. */
  onRender() {}

  /**
   * Shorthand for shadowRoot.querySelector.
   * @param {string} selector
   */
  $(selector) {
    return this.shadowRoot.querySelector(selector);
  }

  /**
   * Shorthand for shadowRoot.querySelectorAll.
   * @param {string} selector
   */
  $$(selector) {
    return this.shadowRoot.querySelectorAll(selector);
  }

  /**
   * Emit a CustomEvent that bubbles out of the shadow boundary.
   * @param {string} name
   * @param {*} detail
   */
  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}
