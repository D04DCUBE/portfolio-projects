import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server/server.ts";
import { acceptKey, decodeFrames, encodeFrame } from "../server/ws.ts";
import type { MachineState, ServerMessage } from "../src/contract.gen.ts";

const server = await startServer();
after(() => server.close());
const base = `127.0.0.1:${server.port}`;

type Client = { next(pred?: (m: ServerMessage) => boolean): Promise<ServerMessage>; send(v: unknown): void; close(): void };
async function connect(): Promise<Client> {
  const ws = new WebSocket(`ws://${base}/ws`);
  const queue: ServerMessage[] = [];
  const waiting: Array<() => void> = [];
  ws.onmessage = (e) => { queue.push(JSON.parse(String(e.data))); waiting.shift()?.(); };
  await new Promise<void>((ok, bad) => { ws.onopen = () => ok(); ws.onerror = () => bad(new Error("ws error")); });
  return {
    async next(pred = () => true) {
      for (;;) {
        const i = queue.findIndex(pred);
        if (i >= 0) return queue.splice(i, 1)[0]!;
        await new Promise<void>((ok) => waiting.push(ok));
      }
    },
    send: (v) => ws.send(typeof v === "string" ? v : JSON.stringify(v)),
    close: () => ws.close(),
  };
}
const snap = (m: ServerMessage): MachineState => { assert.equal(m.type, "snapshot"); return (m as Extract<ServerMessage, { type: "snapshot" }>).state; };
const sim = (path: string, body: unknown = {}) => fetch(`http://${base}/sim/${path}`, { method: "POST", body: JSON.stringify(body) });

test("a new connection gets the full truth immediately", async () => {
  await sim("reset");
  const c = await connect();
  const s = snap(await c.next());
  assert.equal(s.session, null);
  assert.equal(s.queue.length, 5);
  c.close();
});

test("a reload (new connection) lands on the current state, not a stale one", async () => {
  await sim("reset");
  const a = await connect(); await a.next();
  a.send({ type: "signIn", pin: "1234" });
  assert.equal(snap(await a.next()).session?.user, "Maya R.");
  a.close();
  const b = await connect();
  assert.equal(snap(await b.next()).session?.user, "Maya R.");
  b.close();
});

test("every connected screen sees every change", async () => {
  await sim("reset");
  const a = await connect(); const b = await connect();
  await a.next(); await b.next();
  a.send({ type: "signIn", pin: "1234" });
  const [sa, sb] = [snap(await a.next()), snap(await b.next())];
  assert.equal(sa.version, sb.version);
  a.close(); b.close();
});

test("a physical event from the simulator advances the screen with no command", async () => {
  await sim("reset");
  const c = await connect(); await c.next();
  c.send({ type: "signIn", pin: "1234" }); await c.next();
  c.send({ type: "startPrescription", id: "RX-1041" });
  assert.equal(snap(await c.next()).active?.step, "picking");
  await sim("drawer-open");
  assert.equal(snap(await c.next()).active?.step, "remove_items");
  await sim("drawer-close");
  const done = snap(await c.next());
  assert.equal(done.active, null);
  assert.equal(done.queue.find((p) => p.id === "RX-1041")?.status, "done");
  c.close();
});

test("rejections go only to the sender, with a reason", async () => {
  await sim("reset");
  const a = await connect(); const b = await connect();
  await a.next(); await b.next();
  a.send({ type: "signIn", pin: "0000" });
  const m = await a.next();
  assert.deepEqual(m, { type: "rejected", command: "signIn", reason: "bad_pin" });
  b.send({ type: "signOut" });
  assert.equal((await b.next()).type, "rejected");
  a.close(); b.close();
});

test("garbage and unknown commands are rejected without crashing the server", async () => {
  const c = await connect(); await c.next();
  c.send("not json");
  assert.equal((await c.next()).type, "rejected");
  c.send({ type: "formatDisk" });
  assert.equal((await c.next()).type, "rejected");
  await sim("reset");
  c.send({ type: "signIn", pin: "1234" });
  assert.equal(snap(await c.next((m) => m.type === "snapshot" && m.state.session !== null)).session?.user, "Maya R.");
  c.close();
});

test("a fault is broadcast and then cleared by the machine", async () => {
  await sim("reset");
  const c = await connect(); await c.next();
  await sim("fault", { code: "E7", message: "Door sensor" });
  const s = snap(await c.next());
  assert.equal(s.health.status, "fault");
  await sim("clear-fault");
  assert.equal(snap(await c.next()).health.status, "ok");
  c.close();
});

test("static serving is limited to known paths, with a strict CSP", async () => {
  const bad = await fetch(`http://${base}/../package.json`);
  assert.equal(bad.status, 404);
  assert.equal((await fetch(`http://${base}/server/server.ts`)).status, 404);
  assert.equal((await fetch(`http://${base}/sim/nothing`, { method: "POST" })).status, 404);
  const r = await fetch(`http://${base}/`);
  assert.match(r.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

test("the WebSocket endpoint refuses other paths", async () => {
  const ws = new WebSocket(`ws://${base}/other`);
  await new Promise<void>((ok) => { ws.onerror = () => ok(); ws.onclose = () => ok(); });
  assert.notEqual(ws.readyState, WebSocket.OPEN);
});

test("handshake key matches the RFC 6455 example", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("frames round-trip, including masked client frames and the 126-byte length form", () => {
  const mask = Buffer.from([1, 2, 3, 4]);
  const clientFrame = (text: string) => {
    const p = Buffer.from(text);
    const head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0x80 | 126, p.length >> 8, p.length & 255]);
    const masked = Buffer.from(p.map((b, i) => b ^ mask[i % 4]!));
    return Buffer.concat([head, mask, masked]);
  };
  for (const text of ["hi", "x".repeat(300)]) {
    const { frames, rest } = decodeFrames(clientFrame(text));
    assert.equal(frames[0]?.payload.toString(), text);
    assert.equal(rest.length, 0);
  }
  const two = Buffer.concat([clientFrame("a"), clientFrame("b")]);
  assert.equal(decodeFrames(two).frames.length, 2);
  const partial = clientFrame("hello").subarray(0, 5);
  const r = decodeFrames(partial);
  assert.equal(r.frames.length, 0);
  assert.equal(r.rest.length, 5);
  assert.equal(encodeFrame(1, Buffer.from("ok")).length, 4);
  assert.equal(encodeFrame(1, Buffer.alloc(200)).length, 204);
  assert.throws(() => encodeFrame(1, Buffer.alloc(70000)));
});

test("protocol violations are errors", () => {
  assert.throws(() => decodeFrames(Buffer.from([0x81, 0x02, 0x68, 0x69])), /masked/);
  assert.throws(() => decodeFrames(Buffer.from([0x01, 0x80, 0, 0, 0, 0])), /fragmented/);
  assert.throws(() => decodeFrames(Buffer.from([0x81, 0xff, 0, 0, 0, 0, 0, 0, 0, 0])), /too large/);
});
