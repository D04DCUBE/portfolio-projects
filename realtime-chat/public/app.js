import "/ds/index.js";
import { createSocket } from "/js/socket.js";

const app = document.getElementById("app"), announceEl = document.getElementById("announce");
const announce = (t) => { announceEl.textContent = ""; setTimeout(() => (announceEl.textContent = t), 50); };
// Small DOM helper. Text always goes in as textContent, never HTML, so a message like "<img onerror=...>" is shown, not run.
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v); }
  e.append(...kids);
  return e;
}
const store = {
  get() { try { return JSON.parse(sessionStorage.getItem("chat") || "null"); } catch { return null; } },
  set(v) { try { sessionStorage.setItem("chat", JSON.stringify(v)); } catch { /* private mode: resume just will not survive a reload */ } },
  clear() { try { sessionStorage.removeItem("chat"); } catch { /* ignore */ } },
};
const timeFmt = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });

// ---------------- join screen
function showJoin(message = "") {
  app.replaceChildren();
  const name = h("ds-text-field", { label: "Your name", name: "name", required: true, autocomplete: "nickname", hint: "2-20 letters, numbers, spaces, dots, dashes" });
  const room = h("ds-text-field", { label: "Room", name: "room", required: true, value: "lobby", hint: "lowercase letters, numbers and dashes" });
  const saved = store.get(); if (saved?.name) name.setAttribute("value", saved.name);
  const form = h("form", { novalidate: false }, name, room, h("ds-button", { type: "submit", variant: "primary" }, "Join"));
  const note = h("p", { class: "notice", role: "alert", hidden: !message }, message);
  app.append(h("main", { class: "join" }, h("h1", {}, "Realtime chat"),
    h("p", { class: "muted" }, "Open this page in two windows, join the same room, and talk to yourself."), note, form));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = name.value.trim(), r = room.value.trim().toLowerCase();
    // Reuse the saved token only for the same name and room, so a reload can reclaim the name.
    const prev = store.get();
    const token = prev && prev.name === n && prev.room === r ? prev.token : undefined;
    startChat({ name: n, room: r, token, since: prev && prev.name === n && prev.room === r ? prev.last : undefined });
  });
  name.focus();
}

// ---------------- chat screen
function startChat(session) {
  let { name, room, token } = session;
  let lastId = session.since ?? 0;          // highest message id we have seen; sent on reconnect so the server can resume
  const seen = new Set();                    // ids already on screen, to ignore duplicates
  const pending = new Map();                 // cid -> { text, el }: sent but not yet acknowledged
  const typers = new Map();                  // name -> timeout that clears them
  let users = [];
  let joined = false;

  const status = h("span", { class: "pill", role: "status", "data-state": "connecting" }, "Connecting…");
  const leaveBtn = h("ds-button", { variant: "secondary", size: "sm" }, "Leave");
  const log = h("div", { id: "log", role: "log", "aria-label": `Messages in ${room}`, tabindex: "0" });
  const usersList = h("ul");
  const typing = h("div", { class: "typing", "aria-live": "polite" });
  const more = h("ds-button", { class: "more", size: "sm", variant: "secondary", hidden: true }, "New messages");
  const input = h("textarea", { id: "input", rows: "2", maxlength: "1000", placeholder: "Write a message. Enter sends, Shift+Enter adds a line.", "aria-label": "Message" });
  const sendBtn = h("ds-button", { type: "submit", variant: "primary" }, "Send");
  const form = h("form", { class: "composer" }, input, sendBtn);

  app.replaceChildren(h("div", { class: "chat" },
    h("header", { class: "top" }, h("h1", {}, `#${room}`), status, leaveBtn),
    h("div", { class: "body" },
      h("aside", { class: "users", "aria-label": "People in this room" }, h("h2", {}, "Online"), usersList),
      h("div", { class: "stream" }, log, typing, more)),
    form));

  // ----- rendering
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  function scrollIfNeeded(wasNear) { if (wasNear) { log.scrollTop = log.scrollHeight; more.hidden = true; } else more.hidden = false; }
  more.addEventListener("click", () => { log.scrollTop = log.scrollHeight; more.hidden = true; input.focus(); });
  log.addEventListener("scroll", () => { if (nearBottom()) more.hidden = true; });

  function messageEl(m, { mine, sending }) {
    const el = h("div", { class: `msg${mine ? " mine" : ""}${sending ? " sending" : ""}`, "data-id": m.id ?? "" },
      mine ? "" : h("div", { class: "who" }, m.name),
      h("div", { class: "text" }, m.text),
      h("div", { class: "meta" }, sending ? "Sending…" : timeFmt.format(m.ts)));
    return el;
  }
  function addMessage(m) {
    if (seen.has(m.id)) return;
    seen.add(m.id); lastId = Math.max(lastId, m.id);
    const wasNear = nearBottom();
    log.append(messageEl(m, { mine: m.name === name }));
    scrollIfNeeded(wasNear || m.name === name);
    if (m.name !== name) announce(`${m.name}: ${m.text}`.slice(0, 200));
  }
  function addSystem(text) { const wasNear = nearBottom(); log.append(h("div", { class: "system" }, text)); scrollIfNeeded(wasNear); }
  function renderUsers() {
    usersList.replaceChildren(...users.map((u) => h("li", { class: u === name ? "me" : "" }, u === name ? `${u} (you)` : u)));
  }
  function renderTyping() {
    const names = [...typers.keys()];
    typing.textContent = names.length === 0 ? "" : names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : "Several people are typing…";
  }
  function persist() { store.set({ name, room, token, last: lastId }); }

  // ----- socket
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const socket = createSocket({
    url: wsUrl,
    onOpen() { joined = false; socket.send({ t: "join", name, room, token, since: lastId || undefined }); },
    onState({ state, attempt, delay }) {
      status.dataset.state = state;
      status.textContent = state === "open" ? (joined ? "Connected" : "Joining…")
        : state === "connecting" ? "Connecting…"
        : state === "reconnecting" ? (delay ? `Reconnecting in ${Math.ceil(delay / 1000)}s (attempt ${attempt})…` : "Reconnecting…")
        : state === "offline" ? "Offline. Will retry when you are back online."
        : "Disconnected";
      if (state === "reconnecting" || state === "offline") announce("Connection lost. Reconnecting.");
    },
    onMessage: handle,
  });

  function handle(m) {
    switch (m.t) {
      case "joined": {
        joined = true; token = m.token;
        status.textContent = "Connected"; status.dataset.state = "open";
        if (m.reset) { log.replaceChildren(); seen.clear(); lastId = 0; }
        else addSystem("Reconnected");
        for (const msg of m.messages) addMessage(msg);
        if (m.reset) for (const p of pending.values()) log.append(p.el);   // the log was rebuilt; keep unsent messages visible
        lastId = Math.max(lastId, m.last);
        users = m.users; renderUsers(); persist();
        // Anything we sent but never saw acknowledged goes again with the same cid; the server drops duplicates.
        for (const [cid, p] of pending) socket.send({ t: "msg", cid, text: p.text });
        announce(m.reset ? `Joined ${room}` : "Reconnected");
        input.focus();
        break;
      }
      case "msg": addMessage(m); typers.delete(m.name); renderTyping(); break;
      case "ack": {
        const p = pending.get(m.cid);
        if (!p) break;
        pending.delete(m.cid);
        seen.add(m.msg.id); lastId = Math.max(lastId, m.msg.id);
        p.el.replaceWith(messageEl(m.msg, { mine: true, sending: false }));
        persist();
        break;
      }
      case "presence": users = m.users; renderUsers(); break;
      case "system": addSystem(m.text); break;
      case "typing": {
        clearTimeout(typers.get(m.name)); typers.delete(m.name);
        if (m.on) typers.set(m.name, setTimeout(() => { typers.delete(m.name); renderTyping(); }, 4000));   // safety net if "off" is lost
        renderTyping(); break;
      }
      case "error":
        if (["name_taken", "bad_name", "bad_room", "room_full", "busy"].includes(m.code)) { socket.close(); store.clear(); showJoin(m.message); }
        else { addSystem(m.message); }
        break;
    }
  }

  // ----- sending
  let typingOn = false, lastTypingSent = 0, typingOff = null;
  function setTyping(on) {
    const now = Date.now();
    if (on && (!typingOn || now - lastTypingSent > 2000)) { socket.send({ t: "typing", on: true }); lastTypingSent = now; typingOn = true; }
    if (!on && typingOn) { socket.send({ t: "typing", on: false }); typingOn = false; }
    clearTimeout(typingOff);
    if (on) typingOff = setTimeout(() => setTyping(false), 3000);
  }
  input.addEventListener("input", () => setTyping(input.value.length > 0));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const cid = crypto.randomUUID();
    // Optimistic: show it now as "sending", confirm when the server acknowledges. If we are offline it waits and is sent on rejoin.
    const el = messageEl({ name, text }, { mine: true, sending: true });
    log.append(el); log.scrollTop = log.scrollHeight;
    pending.set(cid, { text, el });
    if (joined) socket.send({ t: "msg", cid, text });
    input.value = ""; setTyping(false); input.focus();
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });

  leaveBtn.addEventListener("click", () => { socket.send({ t: "leave" }); socket.close(); store.clear(); showJoin(); });
  renderUsers();
}

showJoin();
