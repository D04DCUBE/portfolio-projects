import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, quiet } from "./helpers.js";
import { validName, validRoom } from "../lib/hub.js";

let s;
before(async () => { s = await startServer({ hub: { rate: { events: 8, windowMs: 3000 }, maxText: 100 } }); });
after(() => s.stop());
let n = 0; const room = () => `room-${++n}`;

test("join: you get the user list, history, token and a reset flag", async () => {
  const r = room();
  const a = client(s.url); const j = await a.join("alice", r);
  assert.deepEqual(j.users, ["alice"]); assert.equal(j.you, "alice"); assert.equal(j.reset, true); assert.match(j.token, /^[0-9a-f]{32}$/);
  a.close();
});

test("messages: reach others, the sender gets an ack with the stored message", async () => {
  const r = room();
  const a = client(s.url), b = client(s.url);
  await a.join("alice", r); await b.join("bob", r);
  a.send({ t: "msg", cid: "c1", text: "  hello <b>there</b>  " });
  const got = await b.nextOf("msg");
  assert.equal(got.text, "hello <b>there</b>", "trimmed, stored as plain text, escaped on the client");
  assert.equal(got.name, "alice");
  const ack = await a.nextOf("ack");
  assert.equal(ack.cid, "c1"); assert.equal(ack.msg.id, got.id);
  assert.equal((await quiet(a)).some((m) => m.t === "msg"), false, "no echo to the sender");
  a.close(); b.close();
});

test("rooms are separate", async () => {
  const a = client(s.url), b = client(s.url);
  await a.join("alice", room()); await b.join("bob", room());
  a.send({ t: "msg", cid: "x", text: "private" });
  await a.nextOf("ack");
  assert.equal((await quiet(b)).filter((m) => m.t === "msg").length, 0);
  a.close(); b.close();
});

test("presence: joins and leaves update everyone, with system lines", async () => {
  const r = room();
  const a = client(s.url); await a.join("alice", r);
  const b = client(s.url); await b.join("bob", r);
  assert.deepEqual((await a.nextOf("presence")).users, ["alice", "bob"]);
  assert.equal((await a.nextOf("system")).text, "bob joined");
  b.close();
  assert.equal((await a.nextOf("system")).text, "bob left");
  assert.deepEqual((await a.nextOf("presence")).users, ["alice"]);
  a.close();
});

test("typing: others see it, the typist does not", async () => {
  const r = room();
  const a = client(s.url), b = client(s.url);
  await a.join("alice", r); await b.join("bob", r);
  a.send({ t: "typing", on: true });
  const t = await b.nextOf("typing");
  assert.deepEqual([t.name, t.on], ["alice", true]);
  assert.equal((await quiet(a)).some((m) => m.t === "typing"), false);
  a.close(); b.close();
});

test("names: a taken name is refused; the owner can reclaim it with the token", async () => {
  const r = room();
  const a = client(s.url); const ja = await a.join("alice", r);
  const imposter = client(s.url); await imposter.opened;
  imposter.send({ t: "join", name: "alice", room: r });
  assert.equal((await imposter.nextOf("error")).code, "name_taken");
  imposter.send({ t: "join", name: "alice", room: r, token: "0".repeat(32) });
  assert.equal((await imposter.nextOf("error")).code, "name_taken", "a wrong token does not work");
  // alice reconnects before the server noticed her old socket is gone
  const again = client(s.url); const j2 = await again.join("alice", r, { token: ja.token });
  assert.equal(j2.token, ja.token);
  await a.closed;   // the old socket was closed by the server
  assert.deepEqual(j2.users, ["alice"]);
  again.close(); imposter.close();
});

test("resume: reconnecting with 'since' returns only what was missed", async () => {
  const r = room();
  const a = client(s.url), b = client(s.url);
  await a.join("alice", r); const jb = await b.join("bob", r);
  a.send({ t: "msg", cid: "1", text: "one" }); const m1 = await b.nextOf("msg");
  b.close(); await b.closed;
  a.send({ t: "msg", cid: "2", text: "two" }); a.send({ t: "msg", cid: "3", text: "three" });
  await a.nextOf("ack"); await a.nextOf("ack"); await a.nextOf("ack");
  const b2 = client(s.url); const j = await b2.join("bob", r, { since: m1.id });
  assert.equal(j.reset, false);
  assert.deepEqual(j.messages.map((m) => m.text), ["two", "three"]);
  const fresh = client(s.url); const jf = await fresh.join("carol", r);
  assert.equal(jf.reset, true); assert.equal(jf.messages.length, 3);
  const weird = client(s.url); const jw = await weird.join("dave", r, { since: 9999 });
  assert.equal(jw.reset, true, "a 'since' from the future is ignored");
  [a, b2, fresh, weird].forEach((c) => c.close());
});

test("resume: history older than the buffer forces a reset", async () => {
  const small = await startServer({ hub: { historySize: 3 } });
  const a = client(small.url); await a.join("alice", "r");
  for (let i = 1; i <= 6; i++) { a.send({ t: "msg", cid: "m" + i, text: "msg " + i }); await a.nextOf("ack"); }
  const b = client(small.url); const j = await b.join("bob", "r", { since: 1 });
  assert.equal(j.reset, true);
  assert.deepEqual(j.messages.map((m) => m.text), ["msg 4", "msg 5", "msg 6"]);
  a.close(); b.close(); small.stop();
});

test("dedupe: resending the same cid after a reconnect does not post twice", async () => {
  const r = room();
  const a = client(s.url), b = client(s.url);
  await a.join("alice", r); await b.join("bob", r);
  a.send({ t: "msg", cid: "same", text: "once" });
  const first = await a.nextOf("ack");
  a.send({ t: "msg", cid: "same", text: "once" });
  const second = await a.nextOf("ack");
  assert.equal(second.msg.id, first.msg.id);
  assert.equal((await quiet(b)).filter((m) => m.t === "msg").length, 1);
  a.close(); b.close();
});

test("validation: bad names, rooms, text, json, types and ordering", async () => {
  const lax = await startServer({ hub: { rate: { events: 1000, windowMs: 3000 }, maxText: 100 } });   // so the limiter does not interfere
  const c = client(lax.url); await c.opened;
  const expectError = async (payload, code) => { c.send(payload); assert.equal((await c.nextOf("error")).code, code); };
  await expectError("{nope", "bad_json");
  await expectError("[]", "bad_message");
  await expectError({ t: "msg", text: "hi" }, "not_joined");
  await expectError({ t: "join", name: "a", room: "ok" }, "bad_name");
  await expectError({ t: "join", name: " lead", room: "ok" }, "bad_name");
  await expectError({ t: "join", name: "<script>", room: "ok" }, "bad_name");
  await expectError({ t: "join", name: "alice", room: "Bad Room" }, "bad_room");
  await expectError({ t: "join", name: "alice", room: "../x" }, "bad_room");
  await expectError({ t: "nope" }, "unknown_type");
  await c.join("valid", room());
  await expectError({ t: "join", name: "valid", room: "x" }, "already_joined");
  await expectError({ t: "msg", cid: "1", text: "   " }, "bad_text");
  await expectError({ t: "msg", cid: "2", text: "x".repeat(101) }, "bad_text");
  c.close(); lax.stop();
});

test("rate limit: a flood gets errors, the connection survives, ping still works", async () => {
  const c = client(s.url); await c.join("flood", room());
  for (let i = 0; i < 20; i++) c.send({ t: "msg", cid: "f" + i, text: "spam" });
  assert.equal((await c.next((m) => m.t === "error")).code, "rate_limited");
  c.send({ t: "ping" });
  assert.equal((await c.nextOf("pong")).t, "pong");
  c.close();
});

test("name and room validators", () => {
  assert.ok(validName("Zoë 2.0")); assert.ok(validName("日本語"));
  assert.ok(!validName("a")); assert.ok(!validName("two  spaces")); assert.ok(!validName("x".repeat(21))); assert.ok(!validName(5));
  assert.ok(validRoom("general-1")); assert.ok(!validRoom("General")); assert.ok(!validRoom("")); assert.ok(!validRoom("a".repeat(25)));
});
