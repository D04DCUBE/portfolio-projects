import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, type WebSocketLike } from "../src/ui/store.ts";
import { initialState } from "../src/shared/machine.ts";

class FakeSocket implements WebSocketLike {
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  send(d: string) { this.sent.push(d); }
  close() { this.onclose?.({}); }
  open() { this.readyState = 1; this.onopen?.({}); }
  receive(v: unknown) { this.onmessage?.({ data: typeof v === "string" ? v : JSON.stringify(v) }); }
}
function setup() {
  const sockets: FakeSocket[] = [];
  const store = createStore(() => { const s = new FakeSocket(); sockets.push(s); return s; }, { retryMs: () => 5 });
  return { store, sockets };
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test("starts connecting with no state; holds only what the machine sends", () => {
  const { store } = setup();
  assert.deepEqual(store.get(), { connection: "connecting", state: null, rejection: null });
  store.close();
});

test("a snapshot replaces the state wholesale; garbage is ignored", () => {
  const { store, sockets } = setup();
  const s = sockets[0]!; s.open();
  assert.equal(store.get().connection, "open");
  s.receive({ type: "snapshot", state: initialState() });
  assert.equal(store.get().state?.version, 1);
  s.receive("nonsense"); s.receive({ type: "nope" });
  assert.equal(store.get().state?.version, 1);
  s.receive({ type: "snapshot", state: { ...initialState(), version: 9 } });
  assert.equal(store.get().state?.version, 9);
  store.close();
});

test("commands go out only while the connection is open", () => {
  const { store, sockets } = setup();
  const s = sockets[0]!;
  assert.equal(store.send({ type: "signOut" }), false);
  s.open();
  assert.equal(store.send({ type: "signIn", pin: "1234" }), true);
  assert.deepEqual(JSON.parse(s.sent[0]!), { type: "signIn", pin: "1234" });
  store.close();
});

test("a rejection is kept until cleared, and each one is distinct", () => {
  const { store, sockets } = setup();
  const s = sockets[0]!; s.open();
  s.receive({ type: "rejected", command: "signIn", reason: "bad_pin" });
  const first = store.get().rejection!;
  assert.equal(first.reason, "bad_pin");
  s.receive({ type: "rejected", command: "signIn", reason: "bad_pin" });
  assert.notEqual(store.get().rejection!.n, first.n);
  store.clearRejection();
  assert.equal(store.get().rejection, null);
  store.clearRejection();
  store.close();
});

test("subscribers are told about changes and can unsubscribe", () => {
  const { store, sockets } = setup();
  let n = 0;
  const off = store.subscribe(() => { n++; });
  sockets[0]!.open();
  assert.equal(n, 1);
  off();
  sockets[0]!.receive({ type: "snapshot", state: initialState() });
  assert.equal(n, 1);
  store.close();
});

test("a dropped connection keeps the last state on screen, then reconnects and takes the new truth", async () => {
  const { store, sockets } = setup();
  sockets[0]!.open();
  sockets[0]!.receive({ type: "snapshot", state: initialState() });
  sockets[0]!.onclose?.({});
  assert.equal(store.get().connection, "closed");
  assert.equal(store.get().state?.version, 1);
  await tick();
  assert.equal(sockets.length, 2);
  sockets[1]!.open();
  sockets[1]!.receive({ type: "snapshot", state: { ...initialState(), version: 7 } });
  assert.equal(store.get().connection, "open");
  assert.equal(store.get().state?.version, 7);
  store.close();
});

test("close() stops reconnecting", async () => {
  const { store, sockets } = setup();
  sockets[0]!.open();
  store.close();
  await tick();
  assert.equal(sockets.length, 1);
});
