import "/ds/index.js";
import { readEvents } from "/js/stream.js";
import { buildRequest, fileToAttachment } from "/js/pipeline.js";
import { renderText, renderComparison, renderAttachmentChips, artifactFrame } from "/js/render.js";
import { validateStructured } from "/js/schemas.js";

// Request lifecycle: idle -> submitted -> streaming -> idle, with side exits to awaiting_approval and error.
// Keeping it as one named state makes it obvious which buttons show and what is announced.
const $ = (id) => document.getElementById(id);
const log = $("log"), input = $("input"), form = $("form"), sendBtn = $("send"), stopBtn = $("stop");
const errorBox = $("error"), approvalBox = $("approval"), statusEl = $("status");

const history = [];     // what the server sees: { role, content }
let phase = "idle";
let controller = null;  // AbortController for the request in flight
let current = null;     // { el, text, dirty } for the assistant bubble being streamed

function setPhase(next) {
  phase = next;
  const busy = next === "submitted" || next === "streaming";
  log.setAttribute("aria-busy", String(busy));
  sendBtn.toggleAttribute("disabled", next !== "idle" && next !== "error");
  stopBtn.hidden = !busy;
  input.disabled = next === "awaiting_approval";
}

// Announce state changes, not tokens. Clearing first makes repeated messages announce again.
function announce(text) { statusEl.textContent = ""; setTimeout(() => (statusEl.textContent = text), 50); }

// ---- rendering lives in /js/render.js. Everything from the model goes through textContent, never innerHTML.
async function previewArtifact(html, button) {
  button.setAttribute("disabled", "");
  try {
    const res = await fetch("/api/artifact", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, body: JSON.stringify({ html }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    button.after(artifactFrame(data.url));
    button.remove();
  } catch (e) { button.removeAttribute("disabled"); announce("The preview could not be created"); }
}
const paint = (container, text, final = false) => renderText(container, text, { final, onPreview: previewArtifact });

function addBubble(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  const body = document.createElement("div"); body.className = "body";
  el.append(body);
  if (text) paint(body, text);
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.append(el);
  if (nearBottom) log.scrollTop = log.scrollHeight;
  return el;
}

// Streaming can deliver many chunks per frame. Re-render at most once per animation frame.
function scheduleRender() {
  if (!current || current.dirty) return;
  current.dirty = true;
  requestAnimationFrame(() => {
    if (!current) return;
    current.dirty = false;
    paint(current.el.querySelector(".body"), current.text);
    log.scrollTop = log.scrollHeight;
  });
}

function addMeta(el, text, note = false) {
  const m = document.createElement("div"); m.className = "meta" + (note ? " note" : ""); m.textContent = text; el.append(m);
}

function showError(message) {
  errorBox.replaceChildren();
  const span = document.createElement("span"); span.textContent = message;
  const retry = document.createElement("ds-button"); retry.setAttribute("variant", "secondary"); retry.setAttribute("size", "sm"); retry.textContent = "Retry";
  retry.addEventListener("click", () => { errorBox.hidden = true; run(); });
  errorBox.append(span, retry); errorBox.hidden = false;
}

// ---- talking to the server
async function run() {
  errorBox.hidden = true;
  setPhase("submitted");
  announce("Thinking");
  controller = new AbortController();
  const startedAt = performance.now();
  let firstTokenAt = null;
  current = { el: addBubble("assistant", ""), text: "", dirty: false };
  const bubble = current;
  let toolCall = null;

  try {
    const res = await fetch("/api/chat", {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ messages: buildRequest(history) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "The request failed.");
    }
    for await (const event of readEvents(res)) {
      if (event.type === "text") {
        if (firstTokenAt === null) { firstTokenAt = performance.now(); setPhase("streaming"); }
        bubble.text += event.delta; scheduleRender();
      } else if (event.type === "structured") {
        // The model's JSON is untrusted: validate before rendering. Invalid data gets a plain notice, never a half-built card.
        if (firstTokenAt === null) firstTokenAt = performance.now();
        const check = validateStructured(event);
        const body = bubble.el.querySelector(".body");
        if (check.ok) {
          renderComparison(body, event.data); bubble.el.classList.add("wide");
          history.push({ role: "assistant", content: `[structured ${event.schema}] ${event.data.title}` });
        } else {
          body.replaceChildren(); const p = document.createElement("p"); p.textContent = "The model sent a response I couldn't display."; body.append(p);
          bubble.el.classList.add("note");
          history.push({ role: "assistant", content: "[structured response rejected]" });
        }
        bubble.structured = true;
      } else if (event.type === "tool_call") {
        toolCall = event;
      } else if (event.type === "error") {
        throw new Error(event.message);
      } else if (event.type === "done") {
        finishBubble(bubble, startedAt, firstTokenAt, event.usage);
      }
    }
    if (!bubble.structured) paint(bubble.el.querySelector(".body"), bubble.text, true);
    current = null;
    if (toolCall) return askApproval(bubble, toolCall);
    if (bubble.text) history.push({ role: "assistant", content: bubble.text });
    setPhase("idle"); announce("Response complete"); input.focus();
  } catch (err) {
    if (!bubble.structured) paint(bubble.el.querySelector(".body"), bubble.text, true);
    current = null;
    if (err.name === "AbortError") {
      if (bubble.text) { history.push({ role: "assistant", content: bubble.text }); addMeta(bubble.el, "Stopped.", true); }
      else bubble.el.remove();
      setPhase("idle"); announce("Stopped"); input.focus();
    } else {
      bubble.el.remove();   // drop the partial answer; Retry asks again from the same history
      setPhase("error"); showError(err.message || "Something went wrong."); announce("The response failed");
    }
  } finally { controller = null; }
}

function finishBubble(bubble, startedAt, firstTokenAt, usage) {
  const total = ((performance.now() - startedAt) / 1000).toFixed(1);
  const ttft = firstTokenAt === null ? "n/a" : `${Math.round(firstTokenAt - startedAt)} ms`;
  addMeta(bubble.el, `first token ${ttft} · total ${total} s · ${usage?.outputTokens ?? "?"} chunks`);
}

// ---- tool use, behind an approval step
function askApproval(bubble, call) {
  bubble.el.remove();
  const args = JSON.stringify(call.args);
  history.push({ role: "assistant", content: `[tool request] ${call.name} ${args}` });
  setPhase("awaiting_approval");
  approvalBox.replaceChildren();
  const card = document.createElement("div"); card.className = "toolcard";
  const text = document.createElement("div");
  text.append("The assistant wants to run ");
  const code = document.createElement("code"); code.textContent = `${call.name}(${args})`;
  text.append(code, ". Allow it?");
  const buttons = document.createElement("div"); buttons.className = "buttons";
  const approve = document.createElement("ds-button"); approve.setAttribute("variant", "primary"); approve.textContent = "Approve";
  const deny = document.createElement("ds-button"); deny.setAttribute("variant", "secondary"); deny.textContent = "Deny";
  buttons.append(approve, deny); card.append(text, buttons);
  approvalBox.append(card); approvalBox.hidden = false;
  approve.focus();
  announce(`Approval needed to run ${call.name}`);

  const close = () => { approvalBox.hidden = true; approvalBox.replaceChildren(); };
  deny.addEventListener("click", () => {
    close(); addBubble("assistant", `Denied ${call.name}.`).classList.add("note");
    history.push({ role: "tool", content: "DENIED by user" }); run();
  });
  approve.addEventListener("click", async () => {
    close();
    let content;
    try {
      const res = await fetch("/api/tool", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
        body: JSON.stringify({ name: call.name, args: call.args }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      content = JSON.stringify(data.result);
    } catch (e) { content = `ERROR: ${e.message || "tool failed"}`; }
    addBubble("assistant", `Ran ${call.name}: ${content}`).classList.add("note");
    history.push({ role: "tool", content });
    run();
  });
}

// ---- attachments
const chips = $("chips"), fileInput = $("file"), attachError = $("attach-error");
let pending = [];
const MAX_ATTACH = 3;
function showPending() { renderAttachmentChips(chips, pending, (i) => { pending.splice(i, 1); showPending(); announce("Attachment removed"); }); }
$("attach").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  attachError.hidden = true;
  const problems = [];
  for (const file of fileInput.files) {
    if (pending.length >= MAX_ATTACH) { problems.push(`At most ${MAX_ATTACH} attachments.`); break; }
    const r = await fileToAttachment(file);
    if (r.ok) pending.push(r.attachment); else problems.push(r.error);
  }
  fileInput.value = "";
  showPending();
  if (problems.length) { attachError.textContent = problems.join(" "); attachError.hidden = false; }
});

// ---- events
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if ((!text && pending.length === 0) || (phase !== "idle" && phase !== "error")) return;
  errorBox.hidden = true; attachError.hidden = true;
  const message = { role: "user", content: text };
  if (pending.length) message.attachments = pending;
  const bubble = addBubble("user", text);
  if (pending.length) { const holder = document.createElement("div"); renderAttachmentChips(holder, pending, null); bubble.append(holder); }
  history.push(message);
  pending = []; showPending();
  input.value = "";
  run();
});
// Enter sends, Shift+Enter adds a new line.
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
});
// ds-button forwards clicks; its submit type is handled by the form-associated element.
stopBtn.addEventListener("click", () => controller?.abort());
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && controller) controller.abort(); });
setPhase("idle");
input.focus();
