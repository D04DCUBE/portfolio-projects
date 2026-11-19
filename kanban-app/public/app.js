// Front end: plain JavaScript and the design system's Web Components.
// Security rule for this file: user text is only ever inserted with textContent / createTextNode,
// never innerHTML, so a card titled "<img onerror=...>" is just text.

import "./ds/index.js";

const COLUMNS = [
  { id: "todo", title: "To do" },
  { id: "doing", title: "Doing" },
  { id: "done", title: "Done" },
];
const app = document.getElementById("app");
const live = document.getElementById("live");
let user = null;
let cards = [];

// ---------- helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "X-Requested-With": "kanban", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) { const e = new Error(data.error || "Request failed."); e.status = res.status; throw e; }
  return data;
}

const announce = (text) => { live.textContent = ""; setTimeout(() => (live.textContent = text), 50); };
const columnTitle = (id) => COLUMNS.find((c) => c.id === id).title;
const errorAlert = (message) => h("ds-alert", { variant: "error", title: message });

// ---------- sign in / sign up ----------
function renderAuth(mode = "login") {
  const signup = mode === "signup";
  const email = h("ds-text-field", { label: "Email", type: "email", name: "email", required: true, autocomplete: "email" });
  const password = h("ds-text-field", {
    label: "Password", type: "password", name: "password", required: true,
    autocomplete: signup ? "new-password" : "current-password", hint: signup ? "At least 10 characters." : null,
  });
  const problems = h("div", { "aria-live": "polite" });
  const form = h("form", {
    class: "auth-form",
    onsubmit: async (e) => {
      e.preventDefault();
      problems.replaceChildren();
      try {
        const r = await api("POST", signup ? "/api/signup" : "/api/login", { email: email.value, password: password.value });
        user = r.user;
        await loadBoard();
      } catch (err) { problems.append(errorAlert(err.message)); }
    },
  }, email, password, h("ds-button", { type: "submit" }, signup ? "Create account" : "Log in"), problems);

  app.replaceChildren(h("main", { class: "auth" },
    h("h1", {}, "Kanban"),
    h("p", { class: "muted" }, signup ? "Create an account to start your board." : "Log in to see your board."),
    form,
    h("p", {}, signup ? "Already have an account? " : "New here? ",
      h("button", { class: "link", type: "button", onclick: () => renderAuth(signup ? "login" : "signup") }, signup ? "Log in" : "Create an account"))));
  email.focus();
}

async function logout() {
  try { await api("POST", "/api/logout", {}); } catch { /* session already gone */ }
  user = null; cards = [];
  renderAuth("login");
}

// ---------- board ----------
async function loadBoard() {
  cards = (await api("GET", "/api/cards")).cards;
  renderShell();
}

let boardEl, cardDialog, cardForm, titleField, descField, formProblems, deleteDialog, deleteText;
let editing = null;        // card being edited, or null when adding
let addColumn = "todo";    // column a new card goes into
let pendingDelete = null;

function renderShell() {
  boardEl = h("div", { class: "board" });

  // Add / edit dialog. The form lives inside the dialog so ds-button type="submit" finds it.
  titleField = h("ds-text-field", { label: "Title", name: "title", required: true });
  descField = h("ds-text-field", { label: "Description (optional)", name: "description" });
  formProblems = h("div", { "aria-live": "polite" });
  cardForm = h("form", { class: "dialog-form", onsubmit: saveCard },
    titleField, descField, formProblems,
    h("div", { class: "dialog-actions" },
      h("ds-button", { variant: "secondary", type: "button", onclick: () => cardDialog.close() }, "Cancel"),
      h("ds-button", { type: "submit" }, "Save")));
  cardDialog = h("ds-dialog", { heading: "Add card" }, cardForm);

  // Delete confirmation.
  deleteText = h("p", {});
  deleteDialog = h("ds-dialog", { heading: "Delete this card?" },
    deleteText,
    h("ds-button", { slot: "actions", variant: "secondary", onclick: () => deleteDialog.close() }, "Cancel"),
    h("ds-button", { slot: "actions", variant: "danger", onclick: confirmDelete }, "Delete"));

  app.replaceChildren(
    h("header", { class: "top" },
      h("h1", {}, "Kanban"),
      h("div", { class: "who" }, h("span", { class: "muted" }, user.email),
        h("ds-button", { variant: "secondary", size: "sm", onclick: logout }, "Log out"))),
    h("main", {}, boardEl),
    cardDialog, deleteDialog);
  renderColumns();
}

function renderColumns(focus) {
  boardEl.replaceChildren(...COLUMNS.map((col, colIndex) => {
    const inCol = cards.filter((c) => c.column === col.id);
    const list = h("ul", { class: "cards", "aria-labelledby": "h-" + col.id }, inCol.map((c) => cardEl(c, colIndex)));
    if (inCol.length === 0) list.append(h("li", { class: "empty" }, "No cards"));

    list.addEventListener("dragover", (e) => { e.preventDefault(); list.classList.add("over"); });
    list.addEventListener("dragleave", () => list.classList.remove("over"));
    list.addEventListener("drop", (e) => {
      e.preventDefault(); list.classList.remove("over");
      const id = e.dataTransfer.getData("text/plain");
      const others = [...list.querySelectorAll(".card:not(.dragging)")];
      let index = others.findIndex((el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (index === -1) index = others.length;
      const card = cards.find((c) => c.id === id);
      if (card) moveCard(card, col.id, index);
    });

    return h("section", { class: "column" },
      h("div", { class: "column-head" },
        h("h2", { id: "h-" + col.id }, col.title, " ", h("span", { class: "muted" }, `(${inCol.length})`)),
        h("ds-button", { size: "sm", variant: "secondary", "data-add": col.id, onclick: () => openCardDialog(null, col.id) },
          "Add card", h("span", { class: "vh" }, " to " + col.title))),
      list);
  }));
  if (focus) {
    // Keep keyboard focus on the same button. If it no longer exists (a card in the last column has no "Move right"), use Edit.
    const find = (a) => boardEl.querySelector(`[data-card="${focus.id}"] [data-action="${a}"]`);
    (find(focus.action) || find("edit"))?.focus();
  }
}

function cardEl(card, colIndex) {
  const hidden = () => h("span", { class: "vh" }, " for " + card.title); // gives each button a unique accessible name
  const btn = (action, label, onclick, variant = "ghost") =>
    h("ds-button", { size: "sm", variant, "data-action": action, onclick }, label, hidden());
  const li = h("li", { class: "card", draggable: "true", "data-card": card.id },
    h("h3", {}, card.title),
    card.description ? h("p", { class: "desc" }, card.description) : null,
    h("div", { class: "actions" },
      colIndex > 0 && btn("left", "Move left", () => moveCard(card, COLUMNS[colIndex - 1].id, 1000, "left")),
      colIndex < COLUMNS.length - 1 && btn("right", "Move right", () => moveCard(card, COLUMNS[colIndex + 1].id, 1000, "right")),
      btn("edit", "Edit", () => openCardDialog(card)),
      btn("delete", "Delete", () => openDeleteDialog(card))));
  li.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", card.id); e.dataTransfer.effectAllowed = "move"; li.classList.add("dragging"); });
  li.addEventListener("dragend", () => li.classList.remove("dragging"));
  return li;
}

async function moveCard(card, column, index, focusAction) {
  try {
    cards = (await api("PATCH", "/api/cards/" + card.id, { column, index })).cards;
    renderColumns(focusAction ? { id: card.id, action: focusAction } : null);
    announce(`Moved ${card.title} to ${columnTitle(column)}.`);
  } catch (err) { handleError(err); }
}

function openCardDialog(card, column = "todo") {
  editing = card; addColumn = column;
  cardDialog.setAttribute("heading", card ? "Edit card" : "Add card to " + columnTitle(column));
  titleField.value = card ? card.title : "";
  descField.value = card ? card.description : "";
  formProblems.replaceChildren();
  cardDialog.show();
}

async function saveCard(e) {
  e.preventDefault();
  formProblems.replaceChildren();
  const body = { title: titleField.value, description: descField.value };
  try {
    cards = editing
      ? (await api("PATCH", "/api/cards/" + editing.id, body)).cards
      : (await api("POST", "/api/cards", { ...body, column: addColumn })).cards;
    cardDialog.close();
    renderColumns();
    announce(editing ? "Card updated." : "Card added.");
  } catch (err) {
    if (err.status === 401) return handleError(err);
    formProblems.append(errorAlert(err.message));
  }
}

function openDeleteDialog(card) {
  pendingDelete = card;
  deleteText.textContent = `"${card.title}" will be removed. This cannot be undone.`;
  deleteDialog.show();
}

async function confirmDelete() {
  const card = pendingDelete;
  deleteDialog.close();
  try {
    cards = (await api("DELETE", "/api/cards/" + card.id)).cards;
    renderColumns();
    announce(`Deleted ${card.title}.`);
  } catch (err) { handleError(err); }
}

function handleError(err) {
  if (err.status === 401) { user = null; renderAuth("login"); return; } // session expired
  announce(err.message);
}

// ---------- start ----------
(async () => {
  try {
    user = (await api("GET", "/api/me")).user;
    await loadBoard();
  } catch { renderAuth("login"); }
})();
