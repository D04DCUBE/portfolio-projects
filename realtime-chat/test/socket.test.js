import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffDelay, BACKOFF, createSocket } from "../public/js/socket.js";

test("backoff: grows exponentially, is capped, jittered, and never below 250 ms", () => {
  const max = (a) => backoffDelay(a, () => 0.999999);
  assert.ok(max(0) <= 500 && max(1) <= 1000 && max(2) <= 2000);
  assert.equal(max(10), BACKOFF.cap - 1, "capped at 15 s");
  assert.equal(max(50), BACKOFF.cap - 1);
  assert.equal(backoffDelay(5, () => 0), 250, "floor");
  const samples = new Set(Array.from({ length: 50 }, () => backoffDelay(4)));
  assert.ok(samples.size > 10, "random jitter, so clients do not retry in lockstep");
});

// A fake WebSocket: tests drive it by hand.
function fakeWS() {
  const made = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.l = {}; made.push(this); }
    addEventListener(t, f) { (this.l[t] ||= []).push(f); }
    send(d) { this.sent.push(d); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit("close", {}); }
    emit(t, e = {}) { (this.l[t] || []).forEach((f) => f(e)); }
    open() { this.readyState = 1; this.emit("open"); }
    serverSend(o) { this.emit("message", { data: JSON.stringify(o) }); }
    drop() { this.readyState = 3; this.emit("close", {}); }
  }
  return { FakeWS, made };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("socket: reconnects after a drop, reports attempts, resets the counter once open again", async () => {
  const { FakeWS, made } = fakeWS(); const states = []; let opens = 0;
  const sock = createSocket({ url: "ws://x", WS: FakeWS, rand: () => 0, onOpen: () => opens++, onState: (s) => states.push(s) });
  made[0].open();
  assert.equal(opens, 1);
  made[0].drop();
  assert.equal(states.at(-1).state, "reconnecting"); assert.equal(states.at(-1).attempt, 1); assert.equal(states.at(-1).delay, 250);
  await wait(300);
  assert.equal(made.length, 2, "a new socket was created");
  made[1].drop();                                    // fails before opening: attempt count keeps growing
  assert.equal(states.at(-1).attempt, 2);
  await wait(300);
  made[2].open();
  assert.equal(states.at(-1).state, "open");
  made[2].drop();
  assert.equal(states.at(-1).attempt, 1, "after a successful open the counter starts over");
  sock.close();
});

test("socket: close() stops reconnecting", async () => {
  const { FakeWS, made } = fakeWS(); const states = [];
  const s = createSocket({ url: "ws://x", WS: FakeWS, rand: () => 0, onState: (x) => states.push(x.state) });
  made[0].open(); s.close();
  await wait(400);
  assert.equal(made.length, 1);
  assert.equal(states.at(-1), "closed");
});

test("socket: heartbeat pings, and a silent server causes a drop and retry", async () => {
  const { FakeWS, made } = fakeWS();
  const sock = createSocket({ url: "ws://x", WS: FakeWS, rand: () => 0, heartbeatMs: 40, silenceMs: 60 });
  made[0].open();
  await wait(60);
  assert.ok(made[0].sent.some((d) => JSON.parse(d).t === "ping"), "ping sent");
  await wait(120);                                   // no reply: the socket is closed by the client...
  assert.equal(made[0].readyState, 3);
  await wait(300);
  assert.equal(made.length, 2, "...and a new one is opened");
  sock.close();
});

test("socket: any message from the server cancels the silence timeout", async () => {
  const { FakeWS, made } = fakeWS();
  const sock = createSocket({ url: "ws://x", WS: FakeWS, heartbeatMs: 40, silenceMs: 80 });
  made[0].open();
  await wait(50);
  made[0].serverSend({ t: "pong" });
  await wait(100);
  assert.equal(made[0].readyState, 1, "still connected");
  sock.close();
});

test("socket: send reports whether it went out", () => {
  const { FakeWS, made } = fakeWS();
  const s = createSocket({ url: "ws://x", WS: FakeWS });
  assert.equal(s.send({ a: 1 }), false, "not open yet");
  made[0].open();
  assert.equal(s.send({ a: 1 }), true);
  assert.equal(made[0].sent[0], '{"a":1}');
  s.close();
});
