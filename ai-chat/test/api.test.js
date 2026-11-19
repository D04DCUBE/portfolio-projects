import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { createProvider } from "../lib/providers/index.js";

let server, base;
const H = { "Content-Type": "application/json", "X-Requested-With": "fetch" };

async function start(opts = {}) {
  const s = createApp({ provider: createProvider("fake", { delayMs: 0 }), ...opts });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { s, url: `http://127.0.0.1:${s.address().port}` };
}
async function chat(messages, url = base) {
  const res = await fetch(url + "/api/chat", { method: "POST", headers: H, body: JSON.stringify({ messages }) });
  const events = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { res, events };
}
const user = (content) => [{ role: "user", content }];

before(async () => { ({ s: server, url: base } = await start()); });
after(() => { server.closeAllConnections(); server.close(); });

test("streams text chunks and ends with done", async () => {
  const { res, events } = await chat(user("hello"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.ok(events.filter((e) => e.type === "text").length > 3, "several chunks, not one blob");
  assert.equal(events.at(-1).type, "done");
});

test("weather question produces a tool call, not text", async () => {
  const { events } = await chat(user("What is the weather in Paris?"));
  const call = events.find((e) => e.type === "tool_call");
  assert.equal(call.name, "get_weather");
  assert.deepEqual(call.args, { city: "Paris" });
  assert.equal(events.some((e) => e.type === "text"), false);
});

test("tool result and denial both lead to a normal answer", async () => {
  const ok = await chat([...user("weather in Oslo"), { role: "assistant", content: "x" }, { role: "tool", content: JSON.stringify({ city: "Oslo", tempC: 10, condition: "foggy" }) }]);
  assert.match(ok.events.filter((e) => e.type === "text").map((e) => e.delta).join(""), /10 °C and foggy in Oslo/);
  const denied = await chat([...user("weather in Oslo"), { role: "assistant", content: "x" }, { role: "tool", content: "DENIED by user" }]);
  assert.match(denied.events.filter((e) => e.type === "text").map((e) => e.delta).join(""), /won't look that up/);
});

test("mid-stream failure sends a short safe error event", async () => {
  const { events } = await chat(user("/fail"));
  const err = events.at(-1);
  assert.equal(err.type, "error");
  assert.doesNotMatch(err.message, /connection dropped/, "internal detail must not reach the client");
});

test("tool endpoint validates the model's arguments", async () => {
  const post = (body) => fetch(base + "/api/tool", { method: "POST", headers: H, body: JSON.stringify(body) });
  assert.equal((await post({ name: "get_weather", args: { city: "Paris" } })).status, 200);
  assert.equal((await post({ name: "get_weather", args: { city: "<script>" } })).status, 400);
  assert.equal((await post({ name: "get_weather", args: {} })).status, 400);
  assert.equal((await post({ name: "rm_rf", args: {} })).status, 400);
  assert.equal((await post({ name: "constructor", args: {} })).status, 400, "inherited object keys are not tools");
});

test("rejects malformed input", async () => {
  const post = (body) => fetch(base + "/api/chat", { method: "POST", headers: H, body: typeof body === "string" ? body : JSON.stringify(body) });
  assert.equal((await post("{nope")).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ messages: [] })).status, 400);
  assert.equal((await post({ messages: [{ role: "system", content: "x" }] })).status, 400, "clients cannot send system messages");
  assert.equal((await post({ messages: [{ role: "user", content: "x".repeat(4001) }] })).status, 400);
  assert.equal((await post({ messages: [{ role: "assistant", content: "x" }] })).status, 400);
  // Over the body cap the server may answer 413 or drop the connection; either way the request is refused.
  const big = await post({ messages: user("x".repeat(40_000)) }).catch(() => ({ status: 413 }));
  assert.ok([400, 413].includes(big.status));
});

test("requires the CSRF header and JSON content type", async () => {
  const r1 = await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: user("hi") }) });
  assert.equal(r1.status, 400);
  const r2 = await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "text/plain", "X-Requested-With": "fetch" }, body: "hi" });
  assert.equal(r2.status, 400);
});

test("closing the connection stops the provider", async () => {
  let yielded = 0, aborted = false;
  const provider = {
    async *stream({ signal }) {
      signal.addEventListener("abort", () => (aborted = true));
      for (let i = 0; i < 1000; i++) { await new Promise((r) => setTimeout(r, 5)); yielded++; yield { type: "text", delta: "x " }; }
    },
  };
  const { s, url } = await start({ provider });
  const ac = new AbortController();
  const res = await fetch(url + "/api/chat", { method: "POST", headers: H, body: JSON.stringify({ messages: user("hi") }), signal: ac.signal });
  const reader = res.body.getReader();
  await reader.read();
  ac.abort();
  await new Promise((r) => setTimeout(r, 100));
  const seen = yielded;
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(aborted, "provider was told to stop");
  assert.equal(yielded, seen, "no more chunks generated after the client left");
  s.closeAllConnections(); s.close();
});

test("rate limits chat requests", async () => {
  const { s, url } = await start({ limits: { chatPerMinute: 3 } });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await chat(user("hello"), url)).res.status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  s.closeAllConnections(); s.close();
});

test("static files: served with security headers, no path traversal", async () => {
  const home = await fetch(base + "/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal((await fetch(base + "/..%2Fserver.js")).status, 404);
  assert.equal((await fetch(base + "/../server.js")).status, 404);
});
