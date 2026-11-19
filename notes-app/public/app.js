// Front end: plain JavaScript and the design system's Web Components.
// Security rule for this file: note text, titles and model answers are only inserted with textContent or text nodes,
// never innerHTML. Highlighting is built from character ranges the server sends, as <mark> elements.
import "./ds/index.js";

const app = document.getElementById("app"), live = document.getElementById("live");
let user = null;
let notes = [];            // list shown in the sidebar (no bodies)
let activeTag = null;
let current = null;        // the note open in the editor: { id|null, title, body, tags, dirty }
let mode = "edit";         // "edit" or "ask"
let results = null;        // search results, or null when not searching

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}
async function api(method, path, body) {
  const res = await fetch(path, { method, credentials: "same-origin", headers: { "X-Requested-With": "notes", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = {}; try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const e = new Error(data.error || "Request failed."); e.status = res.status; throw e; }
  return data;
}
const announce = (t) => { live.textContent = ""; setTimeout(() => (live.textContent = t), 50); };

// text with <mark> around the given [start, end) ranges
function highlighted(text, ranges = []) {
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const [s, e] of ranges) { if (s > at) frag.append(text.slice(at, s)); frag.append(h("mark", {}, text.slice(s, e))); at = e; }
  if (at < text.length) frag.append(text.slice(at));
  return frag;
}

// ---------------- sign in
function renderAuth(signup = false, message = "") {
  const email = h("ds-text-field", { label: "Email", type: "email", name: "email", required: true, autocomplete: "email" });
  const password = h("ds-text-field", { label: "Password", type: "password", name: "password", required: true, autocomplete: signup ? "new-password" : "current-password", hint: signup ? "At least 10 characters." : null });
  const problems = h("div", { "aria-live": "polite" }, message && h("ds-alert", { variant: "error", title: message }));
  const form = h("form", { onsubmit: async (e) => {
    e.preventDefault(); problems.replaceChildren();
    try { user = (await api("POST", signup ? "/api/signup" : "/api/login", { email: email.value, password: password.value })).user; await start(); }
    catch (err) { problems.append(h("ds-alert", { variant: "error", title: err.message })); }
  } }, email, password, h("ds-button", { type: "submit" }, signup ? "Create account" : "Log in"), problems);
  app.replaceChildren(h("main", { class: "auth" }, h("h1", {}, "Notes"),
    h("p", { class: "muted" }, "Write notes, search them, and ask questions about them."), form,
    h("p", {}, signup ? "Already have an account? " : "New here? ", h("button", { class: "link", type: "button", onclick: () => renderAuth(!signup) }, signup ? "Log in" : "Create an account"))));
  email.focus();
}
async function logout() { try { await api("POST", "/api/logout", {}); } catch { /* gone */ } user = null; notes = []; current = null; results = null; renderAuth(false); }

// ---------------- shell
let sideEl, mainEl, searchBox;
async function start() {
  notes = (await api("GET", "/api/notes")).notes;
  searchBox = h("input", { class: "search", type: "search", placeholder: "Search notes", "aria-label": "Search notes", oninput: onSearchInput });
  sideEl = h("aside", { class: "side", "aria-label": "Notes" });
  mainEl = h("main", { class: "main" });
  app.replaceChildren(
    h("header", { class: "top" }, h("h1", {}, "Notes"), h("div", { class: "who" }, h("span", { class: "muted" }, user.email), h("ds-button", { variant: "secondary", size: "sm", onclick: logout }, "Log out"))),
    h("div", { class: "layout" }, sideEl, mainEl));
  current = null; mode = "edit"; results = null;
  renderSide(); renderMain();
}

// ---------------- sidebar
let searchTimer = null, searchSeq = 0;
function onSearchInput() {
  clearTimeout(searchTimer);
  const q = searchBox.value.trim();
  if (!q) { results = null; renderList(); return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const r = (await api("GET", "/api/search?q=" + encodeURIComponent(q))).results;
      if (seq !== searchSeq) return;               // a newer search is already on its way; ignore this late answer
      results = r; renderList();
      announce(`${r.length} ${r.length === 1 ? "result" : "results"}`);
    } catch (e) { if (seq === searchSeq) { results = []; renderList(e.message); } }
  }, 250);
}

let listEl, tagsEl;
function renderSide() {
  tagsEl = h("div", { class: "tags", role: "group", "aria-label": "Filter by tag" });
  listEl = h("ul", { class: "list" });
  sideEl.replaceChildren(
    h("ds-button", { onclick: newNote }, "New note"), searchBox, tagsEl, listEl);
  renderTags(); renderList();
}
function renderTags() {
  const all = [...new Set(notes.flatMap((n) => n.tags))].sort();
  tagsEl.replaceChildren(...all.map((t) => h("button", { class: "tag", type: "button", "aria-pressed": String(activeTag === t), onclick: async () => {
    activeTag = activeTag === t ? null : t;
    notes = (await api("GET", "/api/notes" + (activeTag ? "?tag=" + encodeURIComponent(activeTag) : ""))).notes;
    renderTags(); renderList();
  } }, t)));
  tagsEl.hidden = all.length === 0 && !activeTag;
}
function renderList(error) {
  if (error) { listEl.replaceChildren(h("li", { class: "empty" }, error)); return; }
  if (results) {
    listEl.replaceChildren(...(results.length === 0 ? [h("li", { class: "empty" }, "No notes match.")] : results.map((r) =>
      h("li", {}, h("button", { class: "item", type: "button", "aria-current": String(current?.id === r.noteId), onclick: () => openNote(r.noteId) },
        h("div", { class: "t" }, highlighted(r.title, r.titleRanges)),
        h("div", { class: "s" }, r.snippet.before && "…", highlighted(r.snippet.text, r.snippet.ranges), r.snippet.after && "…"),
        r.tags.length > 0 && h("div", { class: "tg" }, r.tags.map((t) => "#" + t).join(" "))))))) ;
    return;
  }
  listEl.replaceChildren(...(notes.length === 0 ? [h("li", { class: "empty" }, activeTag ? "No notes with this tag." : "No notes yet. Create one.")] : notes.map((n) =>
    h("li", {}, h("button", { class: "item", type: "button", "aria-current": String(current?.id === n.id), onclick: () => openNote(n.id) },
      h("div", { class: "t" }, n.title), n.preview && h("div", { class: "s" }, n.preview.length > 90 ? n.preview.slice(0, 90).trimEnd() + "…" : n.preview),
      n.tags.length > 0 && h("div", { class: "tg" }, n.tags.map((t) => "#" + t).join(" ")))))));
}
async function refreshNotes() {
  notes = (await api("GET", "/api/notes" + (activeTag ? "?tag=" + encodeURIComponent(activeTag) : ""))).notes;
  renderTags(); results ? onSearchInput() : renderList();
}

// ---------------- main pane
function renderMain() {
  const modes = h("div", { class: "modes", role: "group", "aria-label": "View" },
    h("button", { class: "mode", type: "button", "aria-pressed": String(mode === "edit"), onclick: async () => { mode = "edit"; renderMain(); } }, "Note"),
    h("button", { class: "mode", type: "button", "aria-pressed": String(mode === "ask"), onclick: async () => { if (await leaveEditor()) { mode = "ask"; renderMain(); } } }, "Ask your notes"));
  mainEl.replaceChildren(modes, mode === "ask" ? askPane() : editorPane());
}

// ---- editor
let titleField, bodyBox, tagsField, stateEl, problemsEl;
function editorPane() {
  if (!current) return h("p", { class: "muted" }, "Pick a note on the left, or create a new one.");
  titleField = h("ds-text-field", { label: "Title", name: "title", required: true, value: current.title });
  bodyBox = h("textarea", { id: "body", rows: "14", maxlength: "20000" }); bodyBox.value = current.body;
  tagsField = h("ds-text-field", { label: "Tags (comma separated)", name: "tags", value: current.tags.join(", "), hint: "Letters, numbers and dashes" });
  stateEl = h("span", { class: "state", role: "status" }, current.id ? "Saved" : "New note");
  problemsEl = h("div", { "aria-live": "polite" });
  const discardBtn = h("ds-button", { variant: "secondary", type: "button", hidden: true, onclick: discardChanges }, "Discard changes");
  const dirty = () => { current.dirty = true; stateEl.textContent = "Unsaved changes"; discardBtn.hidden = false; };
  titleField.addEventListener("input", dirty); bodyBox.addEventListener("input", dirty); tagsField.addEventListener("input", dirty);
  const form = h("form", { class: "editor", onsubmit: (e) => { e.preventDefault(); saveNote(); } },
    titleField, h("div", { class: "field" }, h("label", { for: "body" }, "Note"), bodyBox), tagsField, problemsEl,
    h("div", { class: "actions" }, h("ds-button", { type: "submit" }, "Save"),
      discardBtn, current.id && h("ds-button", { variant: "danger", type: "button", onclick: () => deleteDialog.show() }, "Delete"), stateEl));
  form.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveNote(); } });
  return form;
}
const parseTags = (s) => s.split(",").map((t) => t.trim()).filter(Boolean);

async function saveNote() {
  problemsEl.replaceChildren();
  const body = { title: titleField.value, body: bodyBox.value, tags: parseTags(tagsField.value) };
  try {
    const { note } = current.id ? await api("PATCH", "/api/notes/" + current.id, body) : await api("POST", "/api/notes", body);
    current = { ...note, dirty: false };
    stateEl.textContent = "Saved"; announce("Note saved");
    await refreshNotes();
    return true;
  } catch (err) { problemsEl.append(h("ds-alert", { variant: "error", title: err.message })); return false; }
}
// Before leaving a note with unsaved changes, save it. If saving fails, stay so nothing is lost.
async function leaveEditor() { return !current?.dirty || (await saveNote()); }

// Throw away unsaved edits: reload the saved version, or close a new note that was never saved.
async function discardChanges() {
  current.dirty = false;
  if (current.id) { try { current = { ...(await api("GET", "/api/notes/" + current.id)).note, dirty: false }; } catch { current = null; } }
  else current = null;
  renderMain(); renderList(); announce("Changes discarded");
}

async function openNote(id) {
  if (!(await leaveEditor())) return;
  try { current = { ...(await api("GET", "/api/notes/" + id)).note, dirty: false }; mode = "edit"; renderMain(); renderList(); titleField?.focus(); }
  catch (e) { announce(e.message); await refreshNotes(); }
}
async function newNote() {
  if (!(await leaveEditor())) return;
  current = { id: null, title: "", body: "", tags: [], dirty: false }; mode = "edit"; renderMain(); renderList(); titleField.focus();
}

let deleteDialog = h("ds-dialog", { heading: "Delete this note?" },
  h("p", {}, "This cannot be undone."),
  h("ds-button", { slot: "actions", variant: "secondary", onclick: () => deleteDialog.close() }, "Cancel"),
  h("ds-button", { slot: "actions", variant: "danger", onclick: async () => {
    deleteDialog.close();
    try { await api("DELETE", "/api/notes/" + current.id); announce("Note deleted"); current = null; renderMain(); await refreshNotes(); }
    catch (e) { announce(e.message); }
  } }, "Delete"));
document.body.append(deleteDialog);

// ---- ask
function askPane() {
  const question = h("textarea", { id: "q", rows: "2", maxlength: "300", placeholder: "For example: who is my recruiter at Acme?" });
  const out = h("div", { "aria-live": "polite" });
  const run = async () => {
    const q = question.value.trim(); if (!q) return;
    out.replaceChildren(h("p", { class: "muted" }, "Looking through your notes…"));
    try { renderAnswer(out, await api("POST", "/api/ask", { question: q })); }
    catch (e) { out.replaceChildren(h("ds-alert", { variant: "error", title: e.message })); }
  };
  question.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } });
  return h("div", { class: "ask" },
    h("p", { class: "muted" }, "Answers come only from your notes, with the notes they came from. If your notes don't say, it says so."),
    h("div", { class: "field" }, h("label", { for: "q" }, "Your question"), question),
    h("ds-button", { onclick: run }, "Ask"), out);
}
function renderAnswer(out, r) {
  const p = h("p", {});
  // Turn "[2]" in the answer into a button that opens that source note. Everything else stays plain text.
  r.answer.split(/(\[\d{1,3}\])/).forEach((part) => {
    const m = part.match(/^\[(\d{1,3})\]$/);
    const src = m && r.sources.find((s) => s.n === Number(m[1]));
    if (src) p.append(h("button", { class: "cite", type: "button", "aria-label": `Open source ${src.n}: ${src.title}`, onclick: () => openNote(src.noteId) }, part));
    else p.append(part);
  });
  out.replaceChildren(h("div", { class: "answer" }, p,
    r.sources.length > 0 && h("ul", { class: "sources", "aria-label": "Sources" }, r.sources.map((s) =>
      h("li", {}, `[${s.n}] `, h("button", { class: "link", type: "button", onclick: () => openNote(s.noteId) }, s.title), " ", h("q", {}, s.excerpt.length > 140 ? s.excerpt.slice(0, 140) + "…" : s.excerpt))))));
}

// ---------------- boot
(async () => { try { user = (await api("GET", "/api/me")).user; await start(); } catch { renderAuth(false); } })();
