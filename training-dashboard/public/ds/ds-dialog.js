// <ds-dialog heading="Delete item?"> ... <ds-button slot="actions">Cancel</ds-button> </ds-dialog>
// Built on the native <dialog> element and showModal(), which gives us for free:
//   focus moves into the dialog, Tab never reaches the page behind (it is inert; Tab cycles the dialog and
//   the browser's own controls), Esc closes it,
//   and focus returns to the element that opened it.
// We add: a labelled heading, backdrop-click to close, and a re-dispatched "close" event.

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host { font-family: var(--ds-font); }
  dialog {
    max-width: min(32rem, calc(100vw - 2rem)); width: 100%;
    padding: var(--ds-space-5); border: 2px solid var(--ds-border); border-radius: var(--ds-radius-md);
    background: var(--ds-bg); color: var(--ds-fg);
  }
  dialog::backdrop { background: var(--ds-overlay); }
  h2 { margin: 0 0 var(--ds-space-3); font-size: var(--ds-text-lg); }
  .actions { display: flex; justify-content: flex-end; gap: var(--ds-space-3); margin-top: var(--ds-space-5); }
</style>
<dialog part="dialog" aria-labelledby="h">
  <h2 id="h"></h2>
  <div class="content"><slot></slot></div>
  <div class="actions"><slot name="actions"></slot></div>
</dialog>`;

class DsDialog extends HTMLElement {
  static observedAttributes = ["heading"];
  #dialog;
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.#dialog = this.shadowRoot.querySelector("dialog");
    // Clicking the dark backdrop targets the <dialog> itself, not its content.
    this.#dialog.addEventListener("click", (e) => { if (e.target === this.#dialog) this.close(); });
    // The native "close" event is not composed, so re-dispatch it.
    this.#dialog.addEventListener("close", () => this.dispatchEvent(new Event("close", { bubbles: true, composed: true })));
  }
  get open() { return this.#dialog.open; }
  show() { if (!this.#dialog.open) this.#dialog.showModal(); }
  close() { this.#dialog.close(); }
  connectedCallback() { this.#render(); }
  attributeChangedCallback() { this.#render(); }
  #render() { this.shadowRoot.getElementById("h").textContent = this.getAttribute("heading") || ""; }
}

customElements.define("ds-dialog", DsDialog);
