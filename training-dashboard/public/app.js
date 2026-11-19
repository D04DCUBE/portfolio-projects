import "/ds/index.js";
import { createChart } from "/js/chart.js";
import { ema, appendPoints, configDiff, summarize, formatNum } from "/js/series.js";
import { validateConfig } from "/js/config.js";

const METRICS = [
  { key: "loss", label: "Loss" }, { key: "reward", label: "Reward" }, { key: "kl", label: "KL to base" },
  { key: "gradNorm", label: "Grad norm" }, { key: "tps", label: "Tokens/s" }, { key: "cost", label: "Cost ($)" },
];
const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];
const DASHES = ["", "9 4", "2 4", "10 3 2 3"];       // a second cue besides color
const MAX_PICKED = 4;

const $ = (id) => document.getElementById(id);
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === "text") e.textContent = v; else if (k in e && k !== "list") e[k] = v; else e.setAttribute(k, v); }
  e.append(...kids);
  return e;
};

const state = { runs: [], pts: new Map(), picked: [], metric: "loss", smooth: 0.6, log: false, sources: new Map(), loading: new Set() };

// The URL holds the view, so a link shares exactly what you are looking at.
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.get("r")) state.picked = q.get("r").split(",").filter((id) => /^r\d+$/.test(id)).slice(0, MAX_PICKED);
  if (METRICS.some((m) => m.key === q.get("m"))) state.metric = q.get("m");
  if (q.has("s")) state.smooth = Math.min(0.95, Math.max(0, Number(q.get("s")) || 0));
  state.log = q.get("log") === "1";
  return q.has("r");
}
function writeHash() {
  const q = new URLSearchParams({ r: state.picked.join(","), m: state.metric, s: String(state.smooth), log: state.log ? "1" : "0" });
  history.replaceState(null, "", "#" + q);
}

async function api(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { "X-Requested-With": "dash", ...(init.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status, fields: body.fields });
  return body;
}

let frame = 0;
const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); };   // at most one draw per frame

// ---- data ----
async function load(id) {
  if (state.pts.has(id) || state.loading.has(id)) return;
  state.loading.add(id);
  try {
    const { run, points } = await api(`/api/runs/${id}`);
    state.pts.set(id, points);
    upsertRun(run);
    if (run.status === "running" && state.picked.includes(id)) connect(id);
  } catch { state.picked = state.picked.filter((p) => p !== id); }
  state.loading.delete(id);
  schedule();
}
function upsertRun(run) {
  const i = state.runs.findIndex((r) => r.id === run.id);
  if (i >= 0) state.runs[i] = run; else state.runs.unshift(run);
}
function connect(id) {
  if (state.sources.has(id)) return;
  const es = new EventSource(`/api/runs/${id}/stream?since=${state.pts.get(id).length}`);   // reconnects send Last-Event-ID by themselves
  state.sources.set(id, es);
  es.addEventListener("open", schedule);
  es.addEventListener("error", schedule);
  es.addEventListener("points", (e) => {
    const { gap } = appendPoints(state.pts.get(id), JSON.parse(e.data).points);
    if (gap) { disconnect(id); state.pts.delete(id); load(id); return; }          // missed a step: start over from the full history
    const run = state.runs.find((r) => r.id === id); if (run) run.step = state.pts.get(id).length;
    schedule();
  });
  es.addEventListener("status", (e) => { const { status, step } = JSON.parse(e.data); const run = state.runs.find((r) => r.id === id); if (run) { run.status = status; run.step = step; } schedule(); });
  es.addEventListener("end", () => disconnect(id));
}
function disconnect(id) { state.sources.get(id)?.close(); state.sources.delete(id); schedule(); }

async function refresh() {
  if (document.hidden) return;
  try {
    const { runs } = await api("/api/runs");
    // Keep the live copy of any run we are streaming (it is newer than the list); take the server's order and copy of the rest.
    state.runs = runs.map((r) => (state.sources.has(r.id) ? state.runs.find((x) => x.id === r.id) ?? r : r));
    schedule();
  } catch { /* offline: keep what we have */ }
}

function toggle(id, on) {
  if (on && state.picked.length < MAX_PICKED && !state.picked.includes(id)) { state.picked.push(id); load(id); }
  if (!on) { state.picked = state.picked.filter((p) => p !== id); disconnect(id); }
  writeHash(); schedule();
}

// ---- render ----
const slot = (id) => state.picked.indexOf(id);
const listItems = new Map();

function renderList() {
  const ul = $("runlist");
  for (const run of state.runs) {
    let item = listItems.get(run.id);
    if (!item) {
      const cb = h("input", { type: "checkbox", id: `pick-${run.id}` });
      cb.addEventListener("change", () => toggle(run.id, cb.checked));
      const name = h("span", { className: "name" }), meta = h("span", { className: "meta" }), status = h("span", { className: "badge" }), info = h("span");
      meta.append(status, info);
      const label = h("label", { htmlFor: cb.id }, name, meta);
      const bar = h("progress", { max: 100 });
      bar.setAttribute("aria-hidden", "true");
      const stop = h("ds-button", { variant: "secondary", size: "sm", text: "Stop", className: "stop" });
      stop.setAttribute("aria-label", `Stop ${run.config.name}`);
      stop.addEventListener("click", async () => { try { const { run: r } = await api(`/api/runs/${run.id}/stop`, { method: "POST" }); upsertRun(r); schedule(); } catch { /* ignore */ } });
      const li = h("li", { className: "run" }, cb, label, bar, stop);
      item = { li, cb, name, status, info, bar, stop };
      listItems.set(run.id, item);
    }
    const picked = state.picked.includes(run.id);
    item.cb.checked = picked;
    item.cb.disabled = !picked && state.picked.length >= MAX_PICKED;
    item.li.dataset.picked = String(picked);
    item.name.textContent = run.config.name;
    const word = { running: "Running", completed: "Done", diverged: "Diverged", stopped: "Stopped" }[run.status];
    item.status.textContent = (run.status === "running" ? "● " : run.status === "diverged" ? "▲ " : "") + word;
    item.status.dataset.s = run.status;
    item.info.textContent = `step ${run.step}/${run.endStep}`;
    item.bar.value = (run.step / run.endStep) * 100;
    item.stop.hidden = run.status !== "running";
    if (item.li.parentNode !== ul || ul.children[state.runs.indexOf(run)] !== item.li) ul.insertBefore(item.li, ul.children[state.runs.indexOf(run)] || null);
  }
  $("pick-note").textContent = state.picked.length >= MAX_PICKED ? "4 selected. Untick one to pick another." : "Tick up to 4 runs to compare.";
}

function renderPill() {
  const states = [...state.sources.values()].map((es) => es.readyState);
  const live = states.includes(1), retry = states.includes(0) && !live;
  const pill = $("pill");
  pill.dataset.state = live ? "live" : retry ? "reconnecting" : "idle";
  pill.textContent = live ? "Live" : retry ? "Reconnecting…" : "Idle";
}

const runLabel = (id) => state.runs.find((r) => r.id === id)?.config.name ?? id;

function renderChart() {
  const ready = state.picked.filter((id) => state.pts.has(id));
  const metric = state.metric;
  const series = ready.map((id) => {
    const raw = state.pts.get(id).map((p) => p[metric]);
    return { id, label: runLabel(id), color: COLORS[slot(id)], dash: DASHES[slot(id)], values: ema(raw, state.smooth), raw: state.smooth > 0 ? raw : null };
  });
  const markers = ready.map((id) => state.runs.find((r) => r.id === id)).filter((r) => r?.divergeAt && r.step >= r.divergeAt).map((r) => ({ step: r.divergeAt, label: `${r.config.name} diverged` }));
  chart.update({ series, markers, logY: state.log, label: METRICS.find((m) => m.key === metric).label });
  const legend = $("legend"); legend.replaceChildren();
  for (const s of series) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    for (const [k, v] of Object.entries({ x1: 0, x2: 32, y1: 5, y2: 5, stroke: s.color })) line.setAttribute(k, v);
    if (s.dash) line.setAttribute("stroke-dasharray", s.dash);
    svg.append(line);
    legend.append(h("li", {}, svg, s.label));
  }
}

function td(text, cls) { return h("td", { text, className: cls || "" }); }
function renderTables() {
  const ready = state.picked.filter((id) => state.pts.has(id));
  const sum = $("summary"); sum.replaceChildren();
  if (!ready.length) { sum.append(h("caption", { className: "empty", text: "No run selected." })); }
  else {
    sum.append(h("thead", {}, h("tr", {}, ...["Run", "Status", "Step", "Loss", "Reward", "Best eval", "Cost"].map((t) => h("th", { scope: "col", text: t })))));
    const body = h("tbody");
    for (const id of ready) {
      const run = state.runs.find((r) => r.id === id), s = summarize(state.pts.get(id));
      body.append(h("tr", {}, h("th", { scope: "row", text: run.config.name }), td(run.status), td(`${run.step}/${run.endStep}`, "num"), td(formatNum(s.last?.loss), "num"),
        td(formatNum(s.last?.reward), "num"), td(s.bestEval ? `${formatNum(s.bestEval.score)} @ ${s.bestEval.step}` : "–", "num"), td(`$${formatNum(s.last?.cost)}`, "num")));
    }
    sum.append(body);
  }
  const diff = $("diff"); diff.replaceChildren();
  $("diff-sec").hidden = ready.length < 2;
  if (ready.length >= 2) {
    const runs = ready.map((id) => state.runs.find((r) => r.id === id));
    diff.append(h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Setting" }), ...runs.map((r) => h("th", { scope: "col", text: r.config.name })))));
    const body = h("tbody");
    for (const row of configDiff(runs.map((r) => r.config))) {
      const tr = h("tr", { className: row.differs ? "differs" : "" }, h("th", { scope: "row", text: row.label + (row.differs ? " (differs)" : "") }), ...row.values.map((v) => td(row.key === "lr" ? Number(v).toExponential() : String(v), "num")));
      body.append(tr);
    }
    diff.append(body);
  }
}

function render() {
  renderList(); renderPill(); renderChart(); renderTables();
  for (const t of document.querySelectorAll("[role=tab]")) t.setAttribute("aria-selected", String(t.dataset.key === state.metric)), t.tabIndex = t.dataset.key === state.metric ? 0 : -1;
}

// ---- controls ----
const chart = createChart($("chart-host"), { onAnnounce: (t) => { $("announce").textContent = t; } });

const tabs = $("tabs");
for (const m of METRICS) {
  const b = h("button", { type: "button", text: m.label });
  b.setAttribute("role", "tab"); b.dataset.key = m.key;
  b.addEventListener("click", () => { state.metric = m.key; writeHash(); schedule(); });
  tabs.append(b);
}
tabs.addEventListener("keydown", (e) => {          // arrow keys move between tabs
  const i = METRICS.findIndex((m) => m.key === state.metric);
  const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
  if (n === null) return;
  e.preventDefault();
  state.metric = METRICS[(n + METRICS.length) % METRICS.length].key;
  writeHash(); schedule();
  tabs.querySelector(`[data-key="${state.metric}"]`).focus();
});
$("smooth").addEventListener("input", (e) => { state.smooth = Number(e.target.value); $("smooth-out").textContent = state.smooth.toFixed(2); writeHash(); schedule(); });
$("log").addEventListener("change", (e) => { state.log = e.target.checked; writeHash(); schedule(); });

$("newrun").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fields = { name: $("f-name"), lr: $("f-lr"), batchSize: $("f-batch"), totalSteps: $("f-steps") };
  const input = { name: fields.name.value, method: $("f-method").value, lr: fields.lr.value, batchSize: fields.batchSize.value, totalSteps: fields.totalSteps.value };
  const checked = validateConfig(input);
  for (const [k, f] of Object.entries(fields)) f.setAttribute("error", checked.ok ? "" : checked.errors[k] || "");
  const err = $("form-error"); err.hidden = true;
  if (!checked.ok) return;
  try {
    const { run } = await api("/api/runs", { method: "POST", body: JSON.stringify(checked.config) });
    upsertRun(run);
    state.picked = [run.id, ...state.picked].slice(0, MAX_PICKED);
    load(run.id); writeHash(); schedule();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

// ---- start ----
const hadHash = readHash();
$("smooth").value = state.smooth; $("smooth-out").textContent = state.smooth.toFixed(2); $("log").checked = state.log;
await refresh();
if (!hadHash) {            // first visit: show the live run next to two finished ones
  const running = state.runs.filter((r) => r.status === "running"), done = state.runs.filter((r) => r.status === "completed").reverse();
  state.picked = [...running, ...done].slice(0, 3).map((r) => r.id);
  state.log = false;
}
state.picked = state.picked.filter((id) => state.runs.some((r) => r.id === id));
for (const id of state.picked) load(id);
writeHash(); schedule();
setInterval(refresh, 2500);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
