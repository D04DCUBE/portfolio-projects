// API tests: the HTTP surface and the chat protocol over a real WebSocket. No browser.
import { test, expect } from "playwright/test";
import { request as httpRequest } from "node:http";

let n = 0;
const roomName = () => `r${Date.now().toString(36)}${n++}`;

// A small WebSocket client that queues messages and waits for the next one that matches.
async function client(baseURL) {
  const ws = new WebSocket(baseURL.replace(/^http/, "ws") + "/ws");
  const inbox = [], waiters = [];
  ws.onmessage = (e) => { inbox.push(JSON.parse(String(e.data))); waiters.shift()?.(); };
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error("ws error")); });
  return {
    send: (v) => ws.send(typeof v === "string" ? v : JSON.stringify(v)),
    async next(pred = () => true, ms = 3000) {
      const end = Date.now() + ms;
      for (;;) {
        const i = inbox.findIndex(pred);
        if (i >= 0) return inbox.splice(i, 1)[0];
        const left = end - Date.now();
        if (left <= 0) throw new Error("timed out");
        await new Promise((ok) => { waiters.push(ok); setTimeout(ok, left); });
      }
    },
    close: () => ws.close(),
  };
}
const type = (t) => (m) => m.t === t;

// Raw handshake, so a test can send any Origin header.
function handshake(baseURL, headers) {
  const u = new URL(baseURL);
  return new Promise((ok, bad) => {
    const req = httpRequest({ host: u.hostname, port: u.port, path: "/ws", headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers } });
    req.on("upgrade", (res, socket) => { socket.destroy(); ok(res.statusCode); });
    req.on("response", (res) => { res.resume(); ok(res.statusCode); });
    req.on("error", bad);
    req.end();
  });
}

test.describe("HTTP", () => {
  test("serves the page with security headers; only GET", async ({ request }) => {
    const r = await request.get("/");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-security-policy"]).toContain("connect-src 'self'");
    expect((await request.post("/", { data: {} })).status()).toBe(405);
    expect((await request.get("/%2e%2e/server.js")).status()).toBe(404);
  });

  test("a WebSocket from another site's page is refused", async ({ baseURL }) => {
    expect(await handshake(baseURL, { Origin: "https://evil.example" })).toBe(403);
    expect(await handshake(baseURL, { Origin: baseURL })).toBe(101);
  });
});

test.describe("chat protocol", () => {
  test("join, then everyone in the room sees messages and presence", async ({ baseURL }) => {
    const room = roomName();
    const a = await client(baseURL), b = await client(baseURL);
    a.send({ t: "join", name: "Ana", room });
    expect(await a.next(type("joined"))).toMatchObject({ room, you: "Ana", users: ["Ana"] });
    b.send({ t: "join", name: "Ben", room });
    expect((await b.next(type("joined"))).users).toEqual(["Ana", "Ben"]);
    expect(await a.next(type("system"))).toEqual({ t: "system", text: "Ben joined" });
    expect((await a.next(type("presence"))).users).toEqual(["Ana", "Ben"]);

    a.send({ t: "msg", text: "hello", cid: "c1" });
    expect((await a.next(type("ack"))).msg).toMatchObject({ name: "Ana", text: "hello" });
    expect(await b.next(type("msg"))).toMatchObject({ name: "Ana", text: "hello" });
    a.close(); b.close();
  });

  test("a resent message (same client id) is not posted twice", async ({ baseURL }) => {
    const room = roomName();
    const a = await client(baseURL), b = await client(baseURL);
    a.send({ t: "join", name: "Ana", room }); await a.next(type("joined"));
    b.send({ t: "join", name: "Ben", room }); await b.next(type("joined"));
    a.send({ t: "msg", text: "once", cid: "same" });
    const first = await a.next(type("ack"));
    a.send({ t: "msg", text: "once", cid: "same" });
    const second = await a.next(type("ack"));
    expect(second.msg.id).toBe(first.msg.id);
    await b.next(type("msg"));
    await expect(b.next(type("msg"), 300)).rejects.toThrow("timed out");
    a.close(); b.close();
  });

  test("rejoining with 'since' returns only the missed messages", async ({ baseURL }) => {
    const room = roomName();
    const a = await client(baseURL);
    a.send({ t: "join", name: "Ana", room });
    const joined = await a.next(type("joined"));
    a.send({ t: "msg", text: "one", cid: "1" }); const one = await a.next(type("ack"));
    a.close();
    const w = await client(baseURL);
    w.send({ t: "join", name: "Wes", room }); await w.next(type("joined"));
    w.send({ t: "msg", text: "two", cid: "2" }); await w.next(type("ack"));
    const back = await client(baseURL);
    back.send({ t: "join", name: "Ana", room, since: one.msg.id, token: joined.token });
    const resumed = await back.next(type("joined"));
    expect(resumed.reset).toBe(false);
    expect(resumed.messages.map((m) => m.text)).toEqual(["two"]);
    w.close(); back.close();
  });

  test("names are unique per room unless you hold the token", async ({ baseURL }) => {
    const room = roomName();
    const a = await client(baseURL), b = await client(baseURL);
    a.send({ t: "join", name: "Ana", room }); await a.next(type("joined"));
    b.send({ t: "join", name: "Ana", room });
    expect(await b.next(type("error"))).toMatchObject({ code: "name_taken" });
    a.close(); b.close();
  });

  test("bad input gets a named error and the socket keeps working", async ({ baseURL }) => {
    const c = await client(baseURL);
    for (const [bad, code] of [["not json", "bad_json"], [{ x: 1 }, "bad_message"], [{ t: "msg", text: "hi" }, "not_joined"],
      [{ t: "join", name: "<b>", room: "lobby" }, "bad_name"], [{ t: "join", name: "Ana", room: "Bad Room!" }, "bad_room"], [{ t: "nope" }, "unknown_type"]]) {
      c.send(bad);
      expect((await c.next(type("error"))).code).toBe(code);
    }
    c.send({ t: "ping" });
    expect(await c.next()).toEqual({ t: "pong" });
    c.close();
  });

  test("flooding is rate limited", async ({ baseURL }) => {
    const c = await client(baseURL);
    c.send({ t: "join", name: "Fay", room: roomName() }); await c.next(type("joined"));
    for (let i = 0; i < 15; i++) c.send({ t: "typing", on: true });
    expect((await c.next(type("error"))).code).toBe("rate_limited");
    c.close();
  });
});
