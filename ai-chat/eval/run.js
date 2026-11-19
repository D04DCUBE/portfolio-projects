// A tiny eval harness. Model output varies, so each case checks properties of the stream, not exact text.
//   node eval/run.js          prints a table and exits 1 if any case fails
// Point it at a real provider with PROVIDER=... and the same cases still apply (expect more variation there).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "../server.js";
import { createProvider } from "../lib/providers/index.js";
import { validateStructured } from "../public/js/schemas.js";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(await readFile(join(here, "cases.json"), "utf8"));
const BUDGET_MS = Number(process.env.BUDGET_MS) || 5000;

const server = createApp({ provider: createProvider(process.env.PROVIDER || "fake", { delayMs: Number(process.env.DELAY_MS ?? 0) }), limits: { chatPerMinute: 1e6 } });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

async function runCase(c) {
  const t0 = performance.now();
  const res = await fetch(base + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
    body: JSON.stringify({ messages: [{ role: "user", content: c.input.repeat(c.repeat ?? 1).slice(0, 4000), ...(c.attachments ? { attachments: c.attachments } : {}) }] }),
  });
  if (c.expect.httpStatus) {
    const ok = res.status === c.expect.httpStatus;
    return { id: c.id, ok, problems: ok ? [] : [`expected HTTP ${c.expect.httpStatus}, got ${res.status}`], ms: performance.now() - t0, tokens: null };
  }
  const events = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const ms = performance.now() - t0;
  const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
  const chunks = events.filter((e) => e.type === "text").length;
  const call = events.find((e) => e.type === "tool_call");
  const err = events.find((e) => e.type === "error");
  const usage = events.find((e) => e.type === "done")?.usage;
  const x = c.expect, problems = [];

  for (const s of x.text ?? []) if (!text.includes(s)) problems.push(`missing text "${s}"`);
  for (const s of x.notText ?? []) if ((text + (err?.message ?? "")).includes(s)) problems.push(`leaked "${s}"`);
  if (x.minChunks && chunks < x.minChunks) problems.push(`only ${chunks} chunks`);
  if (x.tool && call?.name !== x.tool) problems.push(`expected tool ${x.tool}, got ${call?.name ?? "none"}`);
  if (x.toolArgs) for (const [k, v] of Object.entries(x.toolArgs)) if (call?.args?.[k] !== v) problems.push(`arg ${k}=${JSON.stringify(call?.args?.[k])}`);
  if (x.noTool && call) problems.push(`unexpected tool call ${call.name}`);
  if (x.noToolWithArg && JSON.stringify(call?.args ?? "").toLowerCase().includes(x.noToolWithArg)) problems.push(`tool args contain "${x.noToolWithArg}"`);
  const structured = events.find((e) => e.type === "structured");
  if (x.structured) {
    const verdict = structured ? (validateStructured(structured).ok ? "valid" : "invalid") : "none";
    if (verdict !== x.structured) problems.push(`structured output was ${verdict}, expected ${x.structured}`);
  }
  if (x.error && !err) problems.push("expected an error event");
  if (!x.error && err) problems.push("unexpected error event");
  if (ms > BUDGET_MS) problems.push(`slow: ${Math.round(ms)} ms`);
  return { id: c.id, ok: problems.length === 0, problems, ms, tokens: usage ? usage.inputTokens + usage.outputTokens : null };
}

const results = [];
for (const c of cases) results.push(await runCase(c));
server.closeAllConnections(); server.close();

console.log("case".padEnd(14), "result".padEnd(7), "ms".padStart(6), "tokens".padStart(8));
for (const r of results) console.log(r.id.padEnd(14), (r.ok ? "pass" : "FAIL").padEnd(7), String(Math.round(r.ms)).padStart(6), String(r.tokens ?? "-").padStart(8), r.problems.join("; "));
const failed = results.filter((r) => !r.ok).length;
const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
console.log(`\n${results.length - failed}/${results.length} passed · p50 ${Math.round(sorted[sorted.length >> 1])} ms · max ${Math.round(sorted.at(-1))} ms`);
process.exit(failed ? 1 : 0);
