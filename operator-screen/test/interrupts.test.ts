import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce, type Input } from "../src/shared/machine.ts";
import { interruptions, layerOf } from "../src/shared/interrupts.ts";
import { parseCommand, parseServerMessage } from "../src/shared/commands.ts";

const run = (inputs: Input[]) => inputs.reduce((s, i) => reduce(s, i).state, initialState());

test("layer rule: critical is blocking, warning is attention, info is ambient", () => {
  assert.equal(layerOf({ id: "a", kind: "fault", severity: "critical", text: "", needsAck: false }), "blocking");
  assert.equal(layerOf({ id: "b", kind: "low_stock", severity: "warning", text: "", needsAck: true }), "attention");
  assert.equal(layerOf({ id: "c", kind: "low_stock", severity: "info", text: "", needsAck: false }), "ambient");
});

test("a quiet machine interrupts nobody", () => {
  const i = interruptions(initialState());
  assert.equal(i.blocking, null);
  assert.equal(i.attention, null);
  assert.equal(i.attentionCount, 0);
});

test("a fault is the only thing that blocks; warnings queue as one banner with a count", () => {
  const s = run([
    { type: "signIn", pin: "1234" },
    { type: "reportException", id: "RX-1041", reason: "other" },
    { type: "reportException", id: "RX-1042", reason: "other" },
  ]);
  let i = interruptions(s);
  assert.equal(i.blocking, null);
  assert.equal(i.attention?.id, "rx_exception-RX-1041");
  assert.equal(i.attentionCount, 2);
  i = interruptions(reduce(s, { type: "fault", code: "E1", message: "x" }).state);
  assert.equal(i.blocking?.id, "fault");
  assert.equal(i.attentionCount, 2);
});

test("parseCommand accepts valid commands and rejects malformed ones", () => {
  assert.deepEqual(parseCommand({ type: "signIn", pin: "1234" }), { type: "signIn", pin: "1234" });
  assert.deepEqual(parseCommand({ type: "restock", slot: "A1", count: 5 }), { type: "restock", slot: "A1", count: 5 });
  assert.deepEqual(parseCommand({ type: "signOut", extra: "ignored" }), { type: "signOut" });
  for (const bad of [null, [], "x", {}, { type: "nope" }, { type: "signIn", pin: 1234 }, { type: "signIn", pin: "12ab" },
    { type: "startPrescription" }, { type: "startPrescription", id: "" }, { type: "reportException", id: "a", reason: "bad" },
    { type: "restock", slot: "A1", count: "5" }, { type: "restock", slot: "A1", count: 1.5 }]) {
    assert.equal(parseCommand(bad), null, JSON.stringify(bad));
  }
});

test("parseServerMessage only trusts the two message shapes", () => {
  assert.equal(parseServerMessage("{"), null);
  assert.equal(parseServerMessage("[]"), null);
  assert.equal(parseServerMessage('{"type":"snapshot"}'), null);
  assert.equal(parseServerMessage('{"type":"rejected","command":"signIn","reason":"bad_pin"}')?.type, "rejected");
  assert.equal(parseServerMessage(JSON.stringify({ type: "snapshot", state: initialState() }))?.type, "snapshot");
});
