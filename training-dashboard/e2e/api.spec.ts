// API tests: the runs API and the Server-Sent Events stream, over real HTTP. No browser.
import { test, expect, type APIRequestContext } from "playwright/test";

const H = { "X-Requested-With": "dash" };
const config = (over: Record<string, unknown> = {}) => ({ name: "e2e-run", method: "async-rl", lr: 3e-5, batchSize: 64, totalSteps: 200, ...over });

async function createRun(request: APIRequestContext, over = {}) {
  const r = await request.post("/api/runs", { headers: H, data: config(over) });
  expect(r.status()).toBe(201);
  return (await r.json()).run;
}
const stop = (request: APIRequestContext, id: string) => request.post(`/api/runs/${id}/stop`, { headers: H, data: {} });

// Read an SSE stream until `until` returns true or the time runs out, using fetch so it can be cut off.
async function readSSE(url: string, headers: Record<string, string>, until: (text: string) => boolean, ms = 4000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  let text = "";
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
      if (until(text)) break;
    }
    ac.abort();
  } catch { /* aborted */ } finally { clearTimeout(timer); }
  return text;
}
const events = (text: string) => text.split("\n\n").filter((b) => b.includes("event:")).map((b) => ({
  id: b.match(/^id: (\d+)/m)?.[1], event: b.match(/^event: (\w+)/m)?.[1], data: JSON.parse(b.match(/^data: (.*)$/m)?.[1] ?? "null"),
}));

test("lists the seeded runs", async ({ request }) => {
  const { runs } = await (await request.get("/api/runs")).json();
  expect(runs.map((r: { config: { name: string } }) => r.config.name)).toEqual(expect.arrayContaining(["baseline-sync", "async-rl", "lr-1e-3"]));
});

test("a finished run returns all its points", async ({ request }) => {
  const { runs } = await (await request.get("/api/runs")).json();
  const done = runs.find((r: { status: string }) => r.status !== "running");
  const { run, points } = await (await request.get(`/api/runs/${done.id}`)).json();
  expect(run.id).toBe(done.id);
  expect(points.length).toBeGreaterThan(0);
  expect(points.at(-1).step).toBe(run.step);
});

test("create a run, see it in the list, then stop it", async ({ request }) => {
  const run = await createRun(request, { name: "create-and-stop" });
  expect(run.status).toBe("running");
  expect((await (await request.get("/api/runs")).json()).runs.some((r: { id: string }) => r.id === run.id)).toBe(true);
  const stopped = (await (await stop(request, run.id)).json()).run;
  expect(stopped.status).toBe("stopped");
});

test("invalid run settings are refused field by field", async ({ request }) => {
  const r = await request.post("/api/runs", { headers: H, data: config({ name: "", lr: -1, batchSize: 3.5, totalSteps: 10_000_000 }) });
  expect(r.status()).toBe(400);
  const body = await r.json();
  expect(Object.keys(body.fields)).toEqual(expect.arrayContaining(["name", "lr"]));
});

test("writes need the custom header and JSON", async ({ request }) => {
  expect((await request.post("/api/runs", { data: config() })).status()).toBe(403);
  expect((await request.post("/api/runs", { headers: { ...H, "Content-Type": "text/plain" }, data: "x" })).status()).toBe(415);
});

test("unknown runs and bad ids are 404", async ({ request }) => {
  expect((await request.get("/api/runs/r9999")).status()).toBe(404);
  expect((await request.get("/api/runs/..%2F..%2Fserver.ts")).status()).toBe(404);
  expect((await request.get("/api/nope")).status()).toBe(404);
});

test("the stream sends live points with ids", async ({ request, baseURL }) => {
  const run = await createRun(request, { name: "stream-live" });
  const text = await readSSE(`${baseURL}/api/runs/${run.id}/stream`, {}, (t) => (t.match(/event: points/g) ?? []).length >= 2);
  const ev = events(text).filter((e) => e.event === "points");
  expect(ev.length).toBeGreaterThanOrEqual(2);
  expect(Number(ev.at(-1)!.id)).toBeGreaterThan(Number(ev[0].id));
  await stop(request, run.id);
});

test("a reconnect with Last-Event-ID gets only the steps it missed", async ({ request, baseURL }) => {
  const run = await createRun(request, { name: "resume" });
  await new Promise((r) => setTimeout(r, 1600));
  await stop(request, run.id);
  const { points } = await (await request.get(`/api/runs/${run.id}`)).json();
  expect(points.length).toBeGreaterThan(2);
  const since = points[1].step;
  const text = await readSSE(`${baseURL}/api/runs/${run.id}/stream`, { "Last-Event-ID": String(since) }, (t) => t.includes("event: end"));
  const got = events(text).filter((e) => e.event === "points").flatMap((e) => e.data.points.map((p: { step: number }) => p.step));
  expect(got[0]).toBe(since + 1);
  expect(got.at(-1)).toBe(points.at(-1).step);
  expect(events(text).some((e) => e.event === "end")).toBe(true);
});

test("static files: TypeScript is served as JavaScript, no path traversal", async ({ request }) => {
  const r = await request.get("/app.ts");
  expect(r.headers()["content-type"]).toContain("text/javascript");
  expect(await r.text()).not.toMatch(/:\s*HTMLElement\b/);
  expect((await request.get("/%2e%2e/server.ts")).status()).toBe(404);
  expect((await request.get("/")).headers()["content-security-policy"]).toContain("script-src 'self'");
});
