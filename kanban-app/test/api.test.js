import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../server.js";
import { createStore } from "../lib/store.js";

let server, base, store;
before(async () => {
  store = createStore(null); // in memory
  server = createApp({ store, limits: { signupMax: 1000 } }); // high sign-up limit: the suite creates many accounts
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

// Tiny client that remembers its own cookie, like a browser tab.
function client() {
  let cookie = "";
  const call = async function (method, path, body, extraHeaders = {}) {
    const headers = { "X-Requested-With": "kanban", ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, headers: res.headers };
  };
  call.cookie = () => cookie;
  return call;
}
const PW = "correct horse battery";
let n = 0; const email = () => `user${++n}@example.com`;

test("sign-up validates input", async () => {
  const c = client();
  assert.equal((await c("POST", "/api/signup", { email: "nope", password: PW })).status, 400);
  assert.equal((await c("POST", "/api/signup", { email: email(), password: "short" })).status, 400);
  assert.equal((await c("POST", "/api/signup", { email: 5, password: PW })).status, 400);
});

test("sign-up works, sets an HttpOnly SameSite=Strict cookie, and never stores the password", async () => {
  const c = client(); const e = email();
  const r = await c("POST", "/api/signup", { email: e, password: PW });
  assert.equal(r.status, 201);
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.ok(!store._dumpForTests().includes(PW), "plaintext password must not be stored");
  assert.ok(store._dumpForTests().includes("scrypt$"), "a scrypt hash is stored");
  assert.equal((await c("GET", "/api/me")).json.user.email, e);
});

test("duplicate email is rejected", async () => {
  const c = client(); const e = email();
  await c("POST", "/api/signup", { email: e, password: PW });
  assert.equal((await client()("POST", "/api/signup", { email: e.toUpperCase(), password: PW })).status, 409);
});

test("cards require sign-in", async () => {
  const c = client();
  assert.equal((await c("GET", "/api/cards")).status, 401);
  assert.equal((await c("POST", "/api/cards", { title: "x" })).status, 401);
});

test("login: wrong password and unknown email give the same generic error", async () => {
  const e = email(); await client()("POST", "/api/signup", { email: e, password: PW });
  const a = await client()("POST", "/api/login", { email: e, password: "wrong password!!" });
  const b = await client()("POST", "/api/login", { email: "nobody@example.com", password: "wrong password!!" });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
  assert.equal((await client()("POST", "/api/login", { email: e, password: PW })).status, 200);
});

test("login is rate limited after repeated failures", async () => {
  const e = email(); await client()("POST", "/api/signup", { email: e, password: PW });
  const c = client(); const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await c("POST", "/api/login", { email: e, password: "wrong password!!" })).status);
  assert.deepEqual(codes.slice(0, 5), [401, 401, 401, 401, 401]);
  assert.equal(codes[6], 429);
});

test("card lifecycle: create, edit, move, reorder, delete", async () => {
  const c = client(); await c("POST", "/api/signup", { email: email(), password: PW });
  await c("POST", "/api/cards", { title: "  First  " });
  await c("POST", "/api/cards", { title: "Second" });
  let r = await c("POST", "/api/cards", { title: "Third", column: "doing", description: "details" });
  assert.equal(r.status, 201);
  let cards = r.json.cards;
  assert.deepEqual(cards.map((x) => [x.title, x.column, x.position]),
    [["First", "todo", 0], ["Second", "todo", 1], ["Third", "doing", 0]]);

  const first = cards[0].id, second = cards[1].id, third = cards[2].id;
  r = await c("PATCH", `/api/cards/${first}`, { title: "First (edited)" });
  assert.equal(r.json.cards[0].title, "First (edited)");

  r = await c("PATCH", `/api/cards/${second}`, { column: "doing", index: 0 }); // move to the top of Doing
  cards = r.json.cards;
  assert.deepEqual(cards.filter((x) => x.column === "doing").map((x) => x.title), ["Second", "Third"]);
  assert.deepEqual(cards.filter((x) => x.column === "todo").map((x) => [x.title, x.position]), [["First (edited)", 0]]);

  r = await c("PATCH", `/api/cards/${third}`, { index: 0 }); // reorder within the same column
  assert.deepEqual(r.json.cards.filter((x) => x.column === "doing").map((x) => x.title), ["Third", "Second"]);

  r = await c("DELETE", `/api/cards/${first}`);
  assert.equal(r.json.cards.length, 2);
});

test("card validation", async () => {
  const c = client(); await c("POST", "/api/signup", { email: email(), password: PW });
  assert.equal((await c("POST", "/api/cards", { title: "   " })).status, 400);
  assert.equal((await c("POST", "/api/cards", { title: "x".repeat(121) })).status, 400);
  assert.equal((await c("POST", "/api/cards", { title: "ok", column: "nope" })).status, 400);
  assert.equal((await c("POST", "/api/cards", { title: "ok", description: 5 })).status, 400);
});

test("users cannot see or change each other's cards", async () => {
  const a = client(), b = client();
  await a("POST", "/api/signup", { email: email(), password: PW });
  await b("POST", "/api/signup", { email: email(), password: PW });
  const id = (await a("POST", "/api/cards", { title: "A's secret" })).json.cards[0].id;
  assert.deepEqual((await b("GET", "/api/cards")).json.cards, []);
  assert.equal((await b("PATCH", `/api/cards/${id}`, { title: "hacked" })).status, 404);
  assert.equal((await b("DELETE", `/api/cards/${id}`)).status, 404);
  assert.equal((await a("GET", "/api/cards")).json.cards[0].title, "A's secret");
});

test("logout ends the session: the old cookie stops working", async () => {
  const c = client(); await c("POST", "/api/signup", { email: email(), password: PW });
  const oldCookie = c.cookie();
  assert.equal((await c("GET", "/api/cards")).status, 200);
  await c("POST", "/api/logout", {});
  // replay the cookie as an attacker who copied it would
  const replay = await fetch(base + "/api/cards", { headers: { Cookie: oldCookie } });
  assert.equal(replay.status, 401);
});

test("CSRF: state-changing requests need the custom header and JSON content type", async () => {
  const c = client(); await c("POST", "/api/signup", { email: email(), password: PW });
  const noHeader = await fetch(base + "/api/cards", { method: "POST", headers: { "Content-Type": "application/json", Cookie: "sid=x" }, body: "{}" });
  assert.equal(noHeader.status, 403);
  const form = await fetch(base + "/api/cards", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "kanban" }, body: "title=x" });
  assert.equal(form.status, 415);
});

test("oversized and malformed bodies are rejected", async () => {
  const c = client();
  const big = await c("POST", "/api/signup", { email: email(), password: "x".repeat(20_000) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
  const bad = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "kanban" }, body: "{oops" });
  assert.equal(bad.status, 400);
});

function rawGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, path, method: "GET" }, (res) => {
      let d = ""; res.on("data", (x) => (d += x)); res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    });
    req.on("error", reject); req.end();
  });
}

test("static files are served, with security headers; path traversal is blocked", async () => {
  const page = await rawGet("/");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  for (const p of ["/../server.js", "/%2e%2e/server.js", "/..%2fserver.js", "/%2e%2e%2f%2e%2e%2fpackage.json", "/lib/store.js"]) {
    const r = await rawGet(p);
    assert.equal(r.status, 404, p + " should be 404");
    assert.ok(!r.body.includes("createServer"), p + " must not leak source");
  }
});

test("unknown API route returns JSON 404", async () => {
  const c = client(); await c("POST", "/api/signup", { email: email(), password: PW });
  const r = await c("GET", "/api/nope");
  assert.equal(r.status, 404); assert.ok(r.json.error);
});

test("sign-up is rate limited per address", async () => {
  const app = createApp({ limits: { signupMax: 2 } });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${app.address().port}/api/signup`;
  const post = (e) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "kanban" }, body: JSON.stringify({ email: e, password: PW }) });
  assert.equal((await post("a@example.com")).status, 201);
  assert.equal((await post("b@example.com")).status, 201);
  assert.equal((await post("c@example.com")).status, 429);
  await new Promise((r) => app.close(r));
});
