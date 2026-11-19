// <ds-alert variant="info|success|warning|error" title="Heads up">Message</ds-alert>
// Never relies on color alone: every variant has an icon and a hidden text prefix for screen readers.
// Errors use role="alert" (announced immediately). The rest use role="status" (announced politely).

const ICONS = { info: "i", success: "✓", warning: "!", error: "×" };
const LABELS = { info: "Information", success: "Success", warning: "Warning", error: "Error" };

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host { display: block; font-family: var(--ds-font); }
  .alert {
    --accent: var(--ds-info);
    display: flex; gap: var(--ds-space-3); align-items: flex-start;
    padding: var(--ds-space-4); background: var(--ds-surface); color: var(--ds-fg);
    border: 2px solid var(--accent); border-radius: var(--ds-radius-md);
  }
  :host([variant="success"]) .alert { --accent: var(--ds-success); }
  :host([variant="warning"]) .alert { --accent: var(--ds-warning); }
  :host([variant="error"]) .alert { --accent: var(--ds-danger); }
  .icon {
    flex: none; width: 1.5rem; height: 1.5rem; border-radius: 50%;
    display: grid; place-items: center; font-weight: var(--ds-weight-semibold);
    background: var(--accent); color: var(--ds-bg);
  }
  .title { display: block; font-weight: var(--ds-weight-semibold); }
  .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
<div class="alert" part="alert">
  <span class="icon" aria-hidden="true"></span>
  <div><span class="vh"></span><strong class="title"></strong><slot></slot></div>
</div>`;

class DsAlert extends HTMLElement {
  static observedAttributes = ["variant", "title"];
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
  }
  connectedCallback() { this.#render(); }
  attributeChangedCallback() { this.#render(); }
  #render() {
    const v = ICONS[this.getAttribute("variant")] ? this.getAttribute("variant") : "info";
    const root = this.shadowRoot;
    root.querySelector(".alert").setAttribute("role", v === "error" ? "alert" : "status");
    root.querySelector(".icon").textContent = ICONS[v];
    root.querySelector(".vh").textContent = LABELS[v] + ": ";
    const t = root.querySelector(".title");
    t.textContent = this.getAttribute("title") || "";
    t.hidden = !this.getAttribute("title");
  }
}

customElements.define("ds-alert", DsAlert);
