// <ds-text-field label="Email" name="email" type="email" required hint="..." error="...">
// A labelled input with hint and error text, wired for screen readers:
//   label[for] -> input, aria-describedby -> hint/error, aria-invalid when there is an error.
// Form-associated: it submits its value with the form and takes part in validation.
// Privacy note: this component never logs or sends the value anywhere.

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host { display: block; font-family: var(--ds-font); color: var(--ds-fg); }
  label { display: block; font-weight: var(--ds-weight-semibold); margin-bottom: var(--ds-space-1); }
  .req { color: var(--ds-danger); }
  input {
    box-sizing: border-box; width: 100%; font: inherit; font-size: var(--ds-text-md);
    min-height: 2.75rem; padding: 0 var(--ds-space-3);
    background: var(--ds-bg); color: var(--ds-fg);
    border: 2px solid var(--ds-border); border-radius: var(--ds-radius-md);
  }
  input::placeholder { color: var(--ds-fg-muted); }
  input:focus-visible { outline: var(--ds-focus-width) solid var(--ds-focus); outline-offset: 2px; }
  input[aria-invalid="true"] { border-color: var(--ds-danger); }
  input:disabled { opacity: 0.55; cursor: not-allowed; }
  .hint, .error { margin: var(--ds-space-1) 0 0; font-size: var(--ds-text-sm); }
  .hint { color: var(--ds-fg-muted); }
  .error { color: var(--ds-danger); font-weight: var(--ds-weight-semibold); }
  [hidden] { display: none; }
</style>
<label part="label" for="field"><span class="text"></span><span class="req" aria-hidden="true"> *</span></label>
<input id="field" part="input" />
<p class="hint" id="hint" hidden></p>
<p class="error" id="error" role="alert" hidden></p>`;

class DsTextField extends HTMLElement {
  static formAssociated = true;
  static observedAttributes = ["label", "type", "placeholder", "required", "disabled", "error", "hint", "value", "autocomplete"];
  #internals;
  #input;
  #localError = "";

  constructor() {
    super();
    this.#internals = this.attachInternals();
    this.attachShadow({ mode: "open", delegatesFocus: true }).append(template.content.cloneNode(true));
    this.#input = this.shadowRoot.querySelector("input");

    this.#input.addEventListener("input", () => {
      this.#localError = "";
      this.#update();
    });
    // The native "change" event does not cross the shadow boundary, so re-dispatch it.
    this.#input.addEventListener("change", () => {
      this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    });
    // Fired on the host when the form validates and this field is invalid.
    this.addEventListener("invalid", () => {
      this.#localError = this.#internals.validationMessage;
      this.#render();
    });
  }

  get value() { return this.#input.value; }
  set value(v) { this.#input.value = v ?? ""; this.#update(); }
  get validity() { return this.#internals.validity; }
  checkValidity() { return this.#internals.checkValidity(); }

  connectedCallback() { this.#render(); this.#update(); }
  attributeChangedCallback(name, _old, val) {
    if (name === "value" && this.#input.value !== (val ?? "")) this.#input.value = val ?? "";
    this.#render();
    this.#update();
  }

  formResetCallback() { this.#input.value = ""; this.#localError = ""; this.#render(); this.#update(); }
  formDisabledCallback(disabled) { this.#input.disabled = disabled; }

  #update() {
    this.#internals.setFormValue(this.#input.value);
    if (this.hasAttribute("required") && this.#input.value.trim() === "") {
      this.#internals.setValidity({ valueMissing: true }, "Please fill out this field.", this.#input);
    } else if (this.getAttribute("type") === "email" && this.#input.value && !this.#input.validity.valid) {
      this.#internals.setValidity({ typeMismatch: true }, "Please enter a valid email address.", this.#input);
    } else {
      this.#internals.setValidity({});
    }
    this.#render();
  }

  #render() {
    const root = this.shadowRoot;
    const input = this.#input;
    root.querySelector(".text").textContent = this.getAttribute("label") || "";
    root.querySelector(".req").hidden = !this.hasAttribute("required");
    input.type = this.getAttribute("type") || "text";
    input.placeholder = this.getAttribute("placeholder") || "";
    input.required = this.hasAttribute("required");
    input.disabled = this.hasAttribute("disabled");
    const ac = this.getAttribute("autocomplete");
    if (ac) input.setAttribute("autocomplete", ac);

    const errorText = this.getAttribute("error") || this.#localError;
    const hintText = this.getAttribute("hint") || "";
    const err = root.getElementById("error");
    const hint = root.getElementById("hint");
    err.textContent = errorText; err.hidden = !errorText;
    hint.textContent = hintText; hint.hidden = !hintText;

    input.setAttribute("aria-invalid", errorText ? "true" : "false");
    const described = [hintText && "hint", errorText && "error"].filter(Boolean).join(" ");
    if (described) input.setAttribute("aria-describedby", described);
    else input.removeAttribute("aria-describedby");
  }
}

customElements.define("ds-text-field", DsTextField);
