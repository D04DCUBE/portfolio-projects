// Turning model output into DOM. Everything goes through textContent or setAttribute with fixed names,
// never innerHTML, so markup from the model is displayed rather than run.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// Text with ``` code fences. When `final` is true and a fence is html, offer a sandboxed preview.
export function renderText(container, text, { final = false, onPreview } = {}) {
  container.replaceChildren();
  text.split("```").forEach((part, i) => {
    if (i % 2 === 1) {
      const nl = part.indexOf("\n");
      const lang = nl === -1 ? "" : part.slice(0, nl).trim().toLowerCase();
      const body = nl === -1 ? part : part.slice(nl + 1);
      const pre = el("pre"), code = el("code", "", body);
      pre.append(code); container.append(pre);
      if (final && lang === "html" && onPreview) {
        const btn = el("ds-button", "", "Preview");
        btn.setAttribute("variant", "secondary"); btn.setAttribute("size", "sm");
        btn.addEventListener("click", () => onPreview(body, btn));
        container.append(btn);
      }
    } else {
      for (const para of part.split(/\n{2,}/)) if (para.trim()) container.append(el("p", "", para.trim()));
    }
  });
}

export function renderComparison(container, data) {
  container.replaceChildren();
  container.append(el("h2", "cmp-title", data.title));
  const grid = el("div", "cmp-grid");
  for (const item of data.items) {
    const card = el("section", "cmp-card");
    card.append(el("h3", "", item.name));
    for (const [label, list] of [["Pros", item.pros], ["Cons", item.cons]]) {
      card.append(el("h4", "", label));
      const ul = el("ul");
      for (const t of list) ul.append(el("li", "", t));
      card.append(ul);
    }
    grid.append(card);
  }
  container.append(grid);
}

export function renderAttachmentChips(container, attachments, onRemove) {
  container.replaceChildren();
  attachments.forEach((a, i) => {
    const chip = el("span", "chip");
    chip.append(el("span", "", `${a.kind === "image" ? "Image" : "File"}: ${a.name}`));
    if (onRemove) {
      const x = el("button", "chip-x", "Remove");
      x.type = "button"; x.setAttribute("aria-label", `Remove ${a.name}`);
      x.addEventListener("click", () => onRemove(i));
      chip.append(x);
    }
    container.append(chip);
  });
  container.hidden = attachments.length === 0;
}

// An iframe pointing at the server's sandboxed artifact URL. The `sandbox` attribute is a second lock on top of the
// response's own sandbox header. No allow-same-origin: the page gets an opaque origin and cannot reach this one.
export function artifactFrame(url) {
  const f = el("iframe", "artifact-frame");
  f.setAttribute("sandbox", "allow-scripts");
  f.setAttribute("title", "Preview of the code above");
  f.setAttribute("referrerpolicy", "no-referrer");
  f.src = url;
  return f;
}
