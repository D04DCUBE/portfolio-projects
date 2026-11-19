import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";
import { createProvider } from "../lib/providers/index.js";
import { validateComparison, validateStructured } from "../public/js/schemas.js";
import { stripOldAttachments, limitHistory, buildRequest } from "../public/js/pipeline.js";

let server, base;
const H = { "Content-Type": "application/json", "X-Requested-With": "fetch" };
before(async () => {
  server = createApp({ provider: createProvider("fake", { delayMs: 0 }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });
const post = (path, body) => fetch(base + path, { method: "POST", headers: H, body: JSON.stringify(body) });
const events = async (res) => (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const PNG = "iVBORw0KGgo=";

test("structured output: valid data passes the shared schema, malformed data is caught", async () => {
  const good = (await events(await post("/api/chat", { messages: [{ role: "user", content: "/compare" }] }))).find((e) => e.type === "structured");
  assert.deepEqual(validateStructured(good), { ok: true });
  const bad = (await events(await post("/api/chat", { messages: [{ role: "user", content: "/badjson" }] }))).find((e) => e.type === "structured");
  assert.equal(validateStructured(bad).ok, false);
});

test("schema rejects wrong types, too many items, oversize strings and unknown schemas", () => {
  const item = (n) => ({ name: n, pros: ["a"], cons: ["b"] });
  assert.equal(validateComparison({ title: "t", items: [item("a"), item("b")] }).ok, true);
  assert.equal(validateComparison({ title: "t", items: [item("a")] }).ok, false);
  assert.equal(validateComparison({ title: "t", items: Array(7).fill(item("a")) }).ok, false);
  assert.equal(validateComparison({ title: "x".repeat(81), items: [item("a"), item("b")] }).ok, false);
  assert.equal(validateComparison({ title: "t", items: [{ name: "a", pros: "no", cons: [] }, item("b")] }).ok, false);
  assert.equal(validateComparison(null).ok, false);
  assert.equal(validateStructured({ schema: "constructor", data: {} }).ok, false);
});

test("attachments: accepted kinds reach the model, which reports what arrived", async () => {
  const res = await post("/api/chat", { messages: [{ role: "user", content: "", attachments: [
    { name: "notes.txt", kind: "text", mime: "text/plain", data: "one two\nthree" },
    { name: "pic.png", kind: "image", mime: "image/png", data: PNG },
  ] }] });
  assert.equal(res.status, 200);
  const text = (await events(res)).filter((e) => e.type === "text").map((e) => e.delta).join("");
  assert.match(text, /notes\.txt, 2 lines, 3 words/);
  assert.match(text, /pic\.png, image\/png/);
});

test("attachments: rejects svg, bad base64, wrong kind, too many, oversize, and non-user roles", async () => {
  const msg = (a, role = "user") => ({ messages: [{ role, content: "hi", attachments: a }] });
  const att = (over) => ({ name: "f", kind: "text", mime: "text/plain", data: "x", ...over });
  assert.equal((await post("/api/chat", msg([att({ kind: "image", mime: "image/svg+xml", data: PNG })]))).status, 400, "svg can carry script");
  assert.equal((await post("/api/chat", msg([att({ kind: "image", mime: "image/png", data: "not base64!!" })]))).status, 400);
  assert.equal((await post("/api/chat", msg([att({ mime: "text/html" })]))).status, 400);
  assert.equal((await post("/api/chat", msg([att(), att(), att(), att()]))).status, 400);
  assert.equal((await post("/api/chat", msg([att({ data: "x".repeat(20_001) })]))).status, 400);
  assert.equal((await post("/api/chat", msg([att()], "tool"))).status, 400);
  assert.equal((await post("/api/chat", { messages: [{ role: "user", content: "" }] })).status, 400, "empty message without attachments");
});

test("artifact: stored HTML is served with sandbox headers, from an unguessable id", async () => {
  const created = await post("/api/artifact", { html: "<p>hi</p><script>1</script>" });
  assert.equal(created.status, 200);
  const { url } = await created.json();
  assert.match(url, /^\/artifact\/[0-9a-f]{24}$/);
  const page = await fetch(base + url);
  assert.equal(page.status, 200);
  const csp = page.headers.get("content-security-policy");
  assert.match(csp, /^sandbox allow-scripts;/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(csp, /default-src 'none'/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await page.text(), "<p>hi</p><script>1</script>");
});

test("artifact: validates input, needs the CSRF header, and unknown ids are 404", async () => {
  assert.equal((await post("/api/artifact", { html: "" })).status, 400);
  assert.equal((await post("/api/artifact", { html: "x".repeat(50_001) })).status, 400);
  assert.equal((await post("/api/artifact", { html: 5 })).status, 400);
  const noHeader = await fetch(base + "/api/artifact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html: "x" }) });
  assert.equal(noHeader.status, 400);
  assert.equal((await fetch(base + "/artifact/" + "0".repeat(24))).status, 404);
  assert.equal((await fetch(base + "/artifact/..%2F..%2Fserver.js")).status, 404);
});

test("artifact store keeps only the newest 20", async () => {
  const first = (await (await post("/api/artifact", { html: "first" })).json()).url;
  for (let i = 0; i < 20; i++) await post("/api/artifact", { html: "n" + i });
  assert.equal((await fetch(base + first)).status, 404);
});

test("pipeline: old attachments become a text note, the latest keeps its data", () => {
  const a = { name: "a.png", kind: "image", mime: "image/png", data: PNG };
  const out = stripOldAttachments([
    { role: "user", content: "look", attachments: [a] }, { role: "assistant", content: "ok" },
    { role: "user", content: "again", attachments: [a] },
  ]);
  assert.equal(out[0].attachments, undefined);
  assert.equal(out[0].content, "look [attached image: a.png]");
  assert.equal(out[2].attachments.length, 1);
});

test("pipeline: history is trimmed from the front and never starts on an assistant or tool message", () => {
  const h = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }));
  const out = limitHistory(h, 5);
  assert.equal(out[0].role, "user");
  assert.ok(out.length <= 5);
  assert.equal(out.at(-1).content, "9");
  assert.deepEqual(limitHistory(h.slice(0, 3), 5), h.slice(0, 3));
  assert.equal(buildRequest(h, [(x) => x.slice(1), (x) => x.slice(1)]).length, 8, "stages run in order");
});
