// <ds-button variant="primary|secondary|danger|ghost" size="sm|md" type="button|submit|reset" disabled>
// Wraps a real <button> inside Shadow DOM, so keyboard, focus and screen reader behavior are native.
// Form-associated (ElementInternals), so type="submit" works inside a normal <form>.

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host { display: inline-block; font-family: var(--ds-font); }
  :host([hidden]) { display: none; }
  button {
    font: inherit; font-size: var(--ds-text-md); font-weight: var(--ds-weight-semibold);
    min-height: 2.75rem; padding: 0 var(--ds-space-5);
    border-radius: var(--ds-radius-md); border: 2px solid transparent;
    cursor: pointer; background: var(--ds-primary); color: var(--ds-primary-fg);
    transition: background 120ms ease;
  }
  button:hover { background: var(--ds-primary-hover); }
  button:focus-visible { outline: var(--ds-focus-width) solid var(--ds-focus); outline-offset: 2px; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  :host([size="sm"]) button { min-height: 2.25rem; padding: 0 var(--ds-space-4); font-size: var(--ds-text-sm); }
  :host([variant="secondary"]) button { background: transparent; color: var(--ds-fg); border-color: var(--ds-border); }
  :host([variant="secondary"]) button:hover { background: var(--ds-surface); }
  :host([variant="ghost"]) button { background: transparent; color: var(--ds-fg); }
  :host([variant="ghost"]) button:hover { background: var(--ds-surface); }
  :host([variant="danger"]) button { background: var(--ds-danger); color: var(--ds-danger-fg); }
  :host([variant="danger"]) button:hover { background: var(--ds-danger-hover); }
</style>
<button part="button" type="button"><slot></slot></button>`;

class DsButton extends HTMLElement {
  static formAssociated = true;
  // aria-label on <ds-button> is forwarded to the inner <button>, where assistive tech reads it.
  static observedAttributes = ["disabled", "aria-label"];
  #internals;
  #button;

  constructor() {
    super();
    this.#internals = this.attachInternals();
    // delegatesFocus: focusing the host (or clicking its label) focuses the inner button.
    this.attachShadow({ mode: "open", delegatesFocus: true }).append(template.content.cloneNode(true));
    this.#button = this.shadowRoot.querySelector("button");
    this.#button.addEventListener("click", () => {
      const type = this.getAttribute("type") || "button";
      if (type === "submit") this.#internals.form?.requestSubmit();
      else if (type === "reset") this.#internals.form?.reset();
    });
  }

  get disabled() { return this.hasAttribute("disabled"); }
  set disabled(v) { this.toggleAttribute("disabled", Boolean(v)); }

  #sync() {
    this.#button.disabled = this.disabled;
    const label = this.getAttribute("aria-label");
    if (label) this.#button.setAttribute("aria-label", label);
    else this.#button.removeAttribute("aria-label");
  }

  attributeChangedCallback() { this.#sync(); }
  connectedCallback() { this.#sync(); }
}

customElements.define("ds-button", DsButton);
