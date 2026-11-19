import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, rawClient, closeCode, acceptKey } from "./helpers.js";

let s;
before(async () => { s = await startServer({ app: { heartbeatMs: 80 } }); });
after(() => s.stop());

const hello = (name, room = "r") => JSON.stringify({ t: "join", name, room });

test("handshake: accept key matches the example in RFC 6455", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("handshake: 101 with the right Sec-WebSocket-Accept", async () => {
  const c = rawClient(s.port);
  const head = await c.head();
  assert.match(head, /^HTTP\/1\.1 101 /);
  assert.match(head, new RegExp(`Sec-WebSocket-Accept: ${acceptKey(c.key).replace(/[+/]/g, "\\$&")}`));
  c.end();
});

test("handshake: refuses bad origin, wrong version, bad key, wrong path, non-websocket", async () => {
  const bad = rawClient(s.port, { origin: "https://evil.example" });
  assert.match(await bad.head(), /^HTTP\/1\.1 403 /);
  const good = rawClient(s.port, { origin: `http://127.0.0.1:${s.port}` });
  assert.match(await good.head(), /^HTTP\/1\.1 101 /); good.end();
  const key = rawClient(s.port, { key: "short" });
  assert.match(await key.head(), /^HTTP\/1\.1 400 /);
  const path = rawClient(s.port, { path: "/nope" });
  assert.match(await path.head(), /^HTTP\/1\.1 404 /);
  const plain = rawClient(s.port, { skipHandshake: true });
  plain.write("GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 8\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
  assert.match(await plain.head(), /^HTTP\/1\.1 426 /);
});

test("frames: text works, ping gets a pong with the same payload", async () => {
  const c = rawClient(s.port); await c.head();
  c.write(c.frame(0x9, "hi"));
  const pong = await c.nextFrame((f) => f.opcode === 0xa);
  assert.equal(pong.payload.toString(), "hi");
  c.write(c.frame(0x1, hello("alice")));
  const f = await c.nextFrame((f) => f.opcode === 0x1);
  assert.equal(JSON.parse(f.payload).t, "joined");
  c.end();
});

test("frames: a message split into fragments is reassembled", async () => {
  const c = rawClient(s.port); await c.head();
  const text = hello("frag");
  c.write(c.frame(0x1, text.slice(0, 10), { fin: false }));
  c.write(c.frame(0x0, text.slice(10, 20), { fin: false }));
  c.write(c.frame(0x0, text.slice(20)));
  assert.equal(JSON.parse((await c.nextFrame((f) => f.opcode === 0x1)).payload).t, "joined");
  c.end();
});

test("frames: large payload with 16-bit length is read correctly", async () => {
  const c = rawClient(s.port); await c.head();
  c.write(c.frame(0x1, hello("big")));
  await c.nextFrame((f) => f.opcode === 0x1);
  c.write(c.frame(0x1, JSON.stringify({ t: "msg", cid: "1", text: "x".repeat(900) + "é".repeat(50) })));
  const ack = JSON.parse((await c.nextFrame((f) => f.opcode === 0x1)).payload);
  assert.equal(ack.t, "ack");
  assert.equal(ack.msg.text.length, 950);
  c.end();
});

const protocolViolation = (name, build, code) => test(`protocol: ${name} closes with ${code}`, async () => {
  const c = rawClient(s.port); await c.head();
  c.write(build(c));
  const f = await c.nextFrame((f) => f.opcode === 0x8);
  assert.equal(closeCode(f), code);
  c.end();
});
protocolViolation("an unmasked client frame", (c) => c.frame(0x1, "{}", { mask: false }), 1002);
protocolViolation("reserved bits", (c) => c.frame(0x1, "{}", { rsv: 0x40 }), 1002);
protocolViolation("an unknown opcode", (c) => c.frame(0x3, "x"), 1002);
protocolViolation("a continuation with nothing to continue", (c) => c.frame(0x0, "x"), 1002);
protocolViolation("a fragmented control frame", (c) => c.frame(0x9, "x", { fin: false }), 1002);
protocolViolation("a binary frame", (c) => c.frame(0x2, "x"), 1003);
protocolViolation("invalid UTF-8", (c) => c.frame(0x1, Buffer.from([0xff, 0xfe, 0xfd])), 1007);
protocolViolation("a frame over the size limit (declared length only)", (c) => {
  const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 0x80 | 127; h.writeBigUInt64BE(1n << 40n, 2);
  return Buffer.concat([h, Buffer.alloc(4)]);   // we never send the payload; the server must refuse before buffering it
}, 1009);
protocolViolation("a fragmented message that grows past the limit", (c) => Buffer.concat([
  c.frame(0x1, "a".repeat(10_000), { fin: false }), c.frame(0x0, "a".repeat(10_000), { fin: false })]), 1009);

test("close: the client's close frame is answered and the socket ends", async () => {
  const c = rawClient(s.port); await c.head();
  const body = Buffer.alloc(2); body.writeUInt16BE(1000, 0);
  c.write(c.frame(0x8, body));
  assert.equal(closeCode(await c.nextFrame((f) => f.opcode === 0x8)), 1000);
  await c.closed;
});

test("heartbeat: a client that never answers pings is dropped and leaves the room", async () => {
  const watcher = rawClient(s.port); await watcher.head();
  watcher.write(watcher.frame(0x1, hello("watcher", "hb")));
  await watcher.nextFrame((f) => f.opcode === 0x1);
  const ghost = rawClient(s.port); await ghost.head();
  ghost.write(ghost.frame(0x1, hello("ghost", "hb")));
  await ghost.nextFrame((f) => f.opcode === 0x1);
  // The watcher answers pings; the ghost does not.
  watcher.sock.on("data", () => {});
  const answer = setInterval(() => watcher.write(watcher.frame(0xa, "")), 30);
  await ghost.closed;
  clearInterval(answer);
  const frames = [];
  while (true) { try { frames.push(JSON.parse((await watcher.nextFrame((f) => f.opcode === 0x1, 300)).payload)); } catch { break; } }
  assert.ok(frames.some((m) => m.t === "system" && m.text === "ghost left"), JSON.stringify(frames.map((m) => m.t)));
  watcher.end();
});

test("http: serves the page with CSP, blocks path traversal, refuses non-GET", async () => {
  const r = await fetch(s.http + "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.equal((await fetch(s.http + "/..%2Fserver.js")).status, 404);
  assert.equal((await fetch(s.http + "/", { method: "POST" })).status, 405);
});
