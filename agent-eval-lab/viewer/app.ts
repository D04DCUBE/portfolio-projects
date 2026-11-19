// The viewer page: pick two runs, see which cases changed, step through both trajectories side by side.
// Everything from a run file is written with textContent, never as HTML.
import { compareRuns, summarizeChanges, type Change } from "../src/compare.ts";
import type { CaseRecord, Message, RunRecord } from "../src/types.ts";

interface RunInfo { file: string; model: string; startedAt: string; passed: number; total: number }

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

function h(tag: string, props: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === "text") e.textContent = v; else e.setAttribute(k, v); }
  e.append(...kids);
  return e;
}

const state: { runs: RunInfo[]; a: RunRecord | null; b: RunRecord | null; caseId: string | null; step: number } =
  { runs: [], a: null, b: null, caseId: null, step: 0 };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

const LABEL: Record<Change, string> = {
  "same-pass": "Same", "same-fail": "Same", fixed: "Fixed", regressed: "Regressed", "only-in-a": "Only in A", "only-in-b": "Only in B",
};

function resultTag(c: CaseRecord | undefined): HTMLElement {
  if (!c) return h("span", { class: "tag none", text: "not run" });
  return h("span", { class: `tag ${c.passed ? "pass" : "fail"}`, text: c.passed ? "✓ Pass" : "✗ Fail" });
}

function problem(msg: string | null): void {
  const el = $("problem");
  el.hidden = msg === null;
  el.textContent = msg ?? "";
}

function writeHash(): void {
  const q = new URLSearchParams();
  const a = $<HTMLSelectElement>("run-a").value, b = $<HTMLSelectElement>("run-b").value;
  if (a) q.set("a", a);
  if (b) q.set("b", b);
  if (state.caseId) q.set("case", state.caseId);
  history.replaceState(null, "", `#${q.toString()}`);
}

function renderTable(): void {
  const body = $("cases");
  body.replaceChildren();
  const { a, b } = state;
  if (!a || !b) return;
  const diffs = compareRuns(a, b);
  const s = summarizeChanges(diffs);
  $("summary").textContent = `A: ${a.model} ${a.passed}/${a.total}. B: ${b.model} ${b.passed}/${b.total}. ${s.regressed} regressed, ${s.fixed} fixed.`;
  const ca = new Map(a.cases.map((c) => [c.id, c])), cb = new Map(b.cases.map((c) => [c.id, c]));
  for (const d of diffs) {
    const btn = h("button", { type: "button", class: "case-btn", text: d.id });
    btn.addEventListener("click", () => openCase(d.id));
    const tr = h("tr", state.caseId === d.id ? { "aria-current": "true" } : {},
      h("td", {}, btn, h("div", { class: "desc", text: d.description })),
      h("td", {}, resultTag(ca.get(d.id))),
      h("td", {}, resultTag(cb.get(d.id))),
      h("td", { class: d.change === "regressed" || d.change === "fixed" ? `change-${d.change}` : "muted", text: LABEL[d.change] }));
    body.append(tr);
  }
}

function stepView(m: Message, index: number, now: number): HTMLElement {
  const cls = index < now ? "" : index === now ? "now" : "future";
  const li = h("li", cls ? { class: cls } : {});
  if (index === now) li.setAttribute("aria-current", "step");
  if (m.role === "user") li.append(h("div", { class: "kind", text: "Customer" }), h("div", { text: m.text }));
  else if (m.role === "tool") {
    li.append(h("div", { class: "kind", text: m.result.isError ? `Tool result: ${m.name} (error)` : `Tool result: ${m.name}` }),
      h("pre", { class: m.result.isError ? "err" : "", text: JSON.stringify(m.result.data) }));
  } else if ("call" in m) li.append(h("div", { class: "kind", text: "Agent calls tool" }), h("pre", { text: `${m.call.name}(${JSON.stringify(m.call.args)})` }));
  else li.append(h("div", { class: "kind", text: "Agent replies" }), h("div", { text: m.final }));
  return li;
}

function column(title: string, c: CaseRecord | undefined): HTMLElement {
  const col = h("div", { class: "col" }, h("h3", {}, `${title} `, resultTag(c)));
  if (!c) { col.append(h("p", { class: "muted", text: "This run has no such case." })); return col; }
  const ol = h("ol", { class: "steps" });
  c.trace.steps.forEach((m, i) => ol.append(stepView(m, i, state.step)));
  col.append(ol);
  if (c.trace.stopped === "max_steps") col.append(h("p", { class: "err", text: "Stopped: the agent hit the step limit." }));
  const ul = h("ul", { class: "graders" });
  for (const g of c.graders) {
    ul.append(h("li", {}, h("span", { class: `tag ${g.passed ? "pass" : "fail"}`, text: g.passed ? "✓" : "✗" }), ` ${g.name}`, h("div", { class: "desc", text: g.detail })));
  }
  col.append(h("div", { class: "kind", text: "Checks" }), ul);
  return col;
}

function maxSteps(): number {
  const find = (r: RunRecord | null): number => r?.cases.find((c) => c.id === state.caseId)?.trace.steps.length ?? 0;
  return Math.max(find(state.a), find(state.b));
}

function renderDetail(): void {
  const detail = $("detail");
  if (!state.caseId || !state.a || !state.b) { detail.hidden = true; return; }
  const ca = state.a.cases.find((c) => c.id === state.caseId), cb = state.b.cases.find((c) => c.id === state.caseId);
  const any = ca ?? cb;
  detail.hidden = !any;
  if (!any) return;
  $("detail-title").textContent = any.id;
  $("detail-desc").textContent = any.description;
  $("detail-prompt").textContent = `Customer says: “${any.trace.prompt}”`;
  const last = Math.max(0, maxSteps() - 1);
  state.step = Math.min(state.step, last);
  $("stepinfo").textContent = `Step ${state.step + 1} of ${last + 1}`;
  $<HTMLButtonElement>("back").disabled = state.step <= 0;
  $<HTMLButtonElement>("next").disabled = state.step >= last;
  $("cols").replaceChildren(column(`A: ${state.a.model}`, ca), column(`B: ${state.b.model}`, cb));
}

function openCase(id: string): void {
  state.caseId = id;
  state.step = 0;
  writeHash();
  renderTable();
  renderDetail();
  $("detail-title").focus();
}

async function loadRuns(): Promise<void> {
  const a = $<HTMLSelectElement>("run-a").value, b = $<HTMLSelectElement>("run-b").value;
  problem(null);
  try {
    [state.a, state.b] = await Promise.all([getJson<RunRecord>(`/api/runs/${encodeURIComponent(a)}`), getJson<RunRecord>(`/api/runs/${encodeURIComponent(b)}`)]);
  } catch (e) {
    state.a = state.b = null;
    problem(e instanceof Error ? e.message : "Could not load runs");
  }
  if (state.caseId && ![...(state.a?.cases ?? []), ...(state.b?.cases ?? [])].some((c) => c.id === state.caseId)) state.caseId = null;
  writeHash();
  renderTable();
  renderDetail();
}

async function start(): Promise<void> {
  try {
    state.runs = (await getJson<{ runs: RunInfo[] }>("/api/runs")).runs;
  } catch (e) {
    problem(e instanceof Error ? e.message : "Could not list runs");
    return;
  }
  if (state.runs.length === 0) {
    problem("No saved runs yet. Run: node src/run-evals.ts --model careful, then --model careless.");
    return;
  }
  const q = new URLSearchParams(location.hash.slice(1));
  const selects = [$<HTMLSelectElement>("run-a"), $<HTMLSelectElement>("run-b")];
  for (const sel of selects) {
    for (const r of state.runs) sel.append(h("option", { value: r.file, text: `${r.model}: ${r.passed}/${r.total} (${r.file})` }));
    sel.addEventListener("change", () => void loadRuns());
  }
  const has = (f: string | null): f is string => f !== null && state.runs.some((r) => r.file === f);
  const qa = q.get("a"), qb = q.get("b");
  const first = state.runs[0]!.file, second = (state.runs[1] ?? state.runs[0]!).file;
  selects[0]!.value = has(qa) ? qa : first;
  selects[1]!.value = has(qb) ? qb : second;
  state.caseId = q.get("case");
  await loadRuns();
}

$("next").addEventListener("click", () => { state.step++; renderDetail(); });
$("back").addEventListener("click", () => { state.step--; renderDetail(); });
$("all").addEventListener("click", () => { state.step = Math.max(0, maxSteps() - 1); renderDetail(); });
document.addEventListener("keydown", (e) => {
  if (!state.caseId || (e.target instanceof HTMLElement && /^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName))) return;
  if (e.key === "ArrowRight") { state.step++; renderDetail(); } else if (e.key === "ArrowLeft") { state.step--; renderDetail(); }
});

void start();
