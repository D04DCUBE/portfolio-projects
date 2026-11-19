import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { createRuns } from "../lib/runs.js";

async function start(opts = {}) {
  const runs = createRuns({ tickMs: 0, stepsPerTick: 5, ...opts });
  const server = createApp({ runs, heartbeatMs: 50 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { runs, base, stop() { server.closeAllConnections(); server.close(); } };
}
const post = (base, path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "X-Requested-With": "dash", "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const goodRun = { name: "mine", method: "async-rl", lr: 3e-5, batchSize: 64, totalSteps: 100 };

// Read an event stream into a list of {event, id, data} until a condition is met or it ends.
async function readEvents(res, until) {
  const out = []; let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = {}; for (const line of block.split("\n")) { const m = line.match(/^(\w+): ?(.*)$/); if (m) ev[m[1]] = m[2]; }
      if (ev.event) { ev.data = JSON.parse(ev.data); out.push(ev); if (until(ev, out)) return out; }
    }
  }
  return out;
}

test("lists runs newest first, with their latest numbers", async () => {
  const t = await start();
  const { runs } = await (await fetch(t.base + "/api/runs")).json();
  assert.equal(runs.length, 6);
  assert.equal(runs[0].config.name, "async-rl-v2");
  assert.equal(runs[0].status, "running");
  assert.ok(runs.find((r) => r.config.name === "lr-1e-3").status === "diverged");
  assert.ok(runs[0].latest.loss > 0);
  t.stop();
});

test("a run's detail holds one point per step so far", async () => {
  const t = await start();
  const { run, points } = await (await fetch(t.base + "/api/runs/r1")).json();
  assert.equal(points.length, run.step);
  assert.deepEqual(points.map((p) => p.step), Array.from({ length: run.step }, (_, i) => i + 1));
  assert.equal((await fetch(t.base + "/api/runs/r999")).status, 404);
  assert.equal((await fetch(t.base + "/api/runs/..%2Fserver.js")).status, 404);
  t.stop();
});

test("creating a run: needs the header, JSON and valid settings", async () => {
  const t = await start({ seeded: false });
  assert.equal((await fetch(t.base + "/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(goodRun) })).status, 403, "no custom header (cross-site form)");
  assert.equal((await post(t.base, "/api/runs", goodRun, { "Content-Type": "text/plain" })).status, 415);
  const bad = await post(t.base, "/api/runs", { ...goodRun, lr: "fast", totalSteps: 1 });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys((await bad.json()).fields).sort(), ["lr", "totalSteps"]);
  assert.equal((await post(t.base, "/api/runs", { ...goodRun, pad: "x".repeat(3000) })).status, 413);
  const ok = await post(t.base, "/api/runs", goodRun);
  assert.equal(ok.status, 201);
  const { run } = await ok.json();
  assert.equal(run.status, "running"); assert.equal(run.step, 0);
  t.stop();
});

test("at most three runs train at once", async () => {
  const t = await start({ seeded: false });
  for (let i = 0; i < 3; i++) assert.equal((await post(t.base, "/api/runs", goodRun)).status, 201);
  const res = await post(t.base, "/api/runs", goodRun);
  assert.equal(res.status, 429);
  t.stop();
});

test("stopping a run ends it", async () => {
  const t = await start({ seeded: false });
  const { run } = await (await post(t.base, "/api/runs", goodRun)).json();
  assert.equal((await fetch(t.base + `/api/runs/${run.id}/stop`, { method: "POST" })).status, 403);
  const stopped = await (await post(t.base, `/api/runs/${run.id}/stop`)).json();
  assert.equal(stopped.run.status, "stopped");
  t.stop();
});

test("the stream sends the steps you missed, then new ones, then the end", async () => {
  const t = await start({ seeded: false });
  const { run } = await (await post(t.base, "/api/runs", { ...goodRun, totalSteps: 50 })).json();
  t.runs.tick(); t.runs.tick();                                   // steps 1..10 happen before anyone listens
  const res = await fetch(t.base + `/api/runs/${run.id}/stream`, { headers: { "Last-Event-ID": "4" } });
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  const driver = setInterval(() => t.runs.tick(), 20);
  const events = await readEvents(res, (ev) => ev.event === "end");
  clearInterval(driver);
  const steps = events.filter((e) => e.event === "points").flatMap((e) => e.data.points.map((p) => p.step));
  assert.deepEqual(steps, Array.from({ length: 46 }, (_, i) => i + 5), "from step 5 (after Last-Event-ID 4) to 50, none twice");
  assert.equal(events.find((e) => e.event === "status").data.status, "completed");
  t.stop();
});

test("streaming a finished run sends its tail and ends at once", async () => {
  const t = await start();
  const res = await fetch(t.base + "/api/runs/r5/stream?since=75");
  const events = await readEvents(res, (ev) => ev.event === "end");
  assert.deepEqual(events.find((e) => e.event === "points").data.points.map((p) => p.step), [76, 77, 78, 79, 80]);
  assert.equal(events.find((e) => e.event === "status").data.status, "diverged");
  t.stop();
});

test("a closed stream stops listening", async () => {
  const t = await start({ seeded: false });
  const { run } = await (await post(t.base, "/api/runs", goodRun)).json();
  const ctrl = new AbortController();
  const res = await fetch(t.base + `/api/runs/${run.id}/stream`, { signal: ctrl.signal });
  const reader = res.body.getReader(); await reader.read();
  ctrl.abort();
  await new Promise((r) => setTimeout(r, 50));
  assert.doesNotThrow(() => t.runs.tick(), "ticking after a client left must not write to a dead socket");
  t.stop();
});

test("serves the page with a strict CSP and blocks paths outside public/", async () => {
  const t = await start();
  const res = await fetch(t.base + "/");
  assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal((await fetch(t.base + "/js/series.js")).status, 200);
  assert.equal((await fetch(t.base + "/..%2Fserver.js")).status, 404);
  t.stop();
});
