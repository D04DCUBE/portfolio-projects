import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, reduce, type Input } from "../src/shared/machine.ts";
import type { MachineState } from "../src/contract.gen.ts";

function run(inputs: Input[], from: MachineState = initialState()): MachineState {
  return inputs.reduce((s, i) => reduce(s, i).state, from);
}
const signedIn = () => run([{ type: "signIn", pin: "1234" }]);
const rx = (s: MachineState, id: string) => s.queue.find((p) => p.id === id)!;
const stock = (s: MachineState, slot: string) => s.stock.find((i) => i.slot === slot)!;

test("sign in needs a known PIN and a signed-out machine", () => {
  assert.equal(reduce(initialState(), { type: "signIn", pin: "0000" }).rejected, "bad_pin");
  const s = signedIn();
  assert.equal(s.session?.user, "Maya R.");
  assert.equal(reduce(s, { type: "signIn", pin: "4321" }).rejected, "already_signed_in");
  assert.equal(reduce(initialState(), { type: "startPrescription", id: "RX-1041" }).rejected, "not_signed_in");
});

test("a prescription advances on physical drawer events, not on taps", () => {
  let s = run([{ type: "signIn", pin: "1234" }, { type: "startPrescription", id: "RX-1041" }]);
  assert.deepEqual(s.active, { prescriptionId: "RX-1041", step: "picking" });
  assert.equal(rx(s, "RX-1041").status, "in_progress");
  s = run([{ type: "drawerOpened" }], s);
  assert.equal(s.active?.step, "remove_items");
  assert.equal(s.drawer, "open");
  const before = stock(s, "A2").count;
  s = run([{ type: "drawerClosed" }], s);
  assert.equal(s.active, null);
  assert.equal(rx(s, "RX-1041").status, "done");
  assert.equal(stock(s, "A2").count, before - 30);
});

test("only one task at a time, and sign-out is refused while one runs", () => {
  const s = run([{ type: "signIn", pin: "1234" }, { type: "startPrescription", id: "RX-1041" }]);
  assert.equal(reduce(s, { type: "startPrescription", id: "RX-1042" }).rejected, "task_active");
  assert.equal(reduce(s, { type: "signOut" }).rejected, "task_active");
});

test("a task is refused when stock is short", () => {
  const s = signedIn();
  const low = { ...s, stock: s.stock.map((i) => (i.slot === "A2" ? { ...i, count: 10 } : i)) };
  assert.equal(reduce(low, { type: "startPrescription", id: "RX-1041" }).rejected, "insufficient_stock");
});

test("finishing a task that drops stock below par raises one attention alert, and restocking clears it", () => {
  let s = run([{ type: "signIn", pin: "1234" }, { type: "startPrescription", id: "RX-1043" }, { type: "drawerOpened" }, { type: "drawerClosed" }]);
  assert.equal(stock(s, "A1").count, 23);
  const alert = s.alerts.find((a) => a.id === "low_stock-A1");
  assert.equal(alert?.severity, "warning");
  s = run([{ type: "restock", slot: "A1", count: 100 }], s);
  assert.equal(stock(s, "A1").count, 123);
  assert.equal(s.alerts.length, 0);
});

test("restock is capped at capacity and rejects bad amounts", () => {
  const s = signedIn();
  assert.equal(stock(run([{ type: "restock", slot: "C2", count: 100 }], s), "C2").count, 12);
  assert.equal(reduce(s, { type: "restock", slot: "C2", count: 0 }).rejected, "bad_amount");
  assert.equal(reduce(s, { type: "restock", slot: "C2", count: 2.5 }).rejected, "bad_amount");
  assert.equal(reduce(s, { type: "restock", slot: "ZZ", count: 5 }).rejected, "not_found");
});

test("exceptions: report, retry and cancel only from the right statuses", () => {
  let s = run([{ type: "signIn", pin: "1234" }, { type: "reportException", id: "RX-1042", reason: "label_unreadable" }]);
  assert.equal(rx(s, "RX-1042").status, "exception");
  assert.equal(rx(s, "RX-1042").exceptionReason, "label_unreadable");
  assert.equal(s.alerts[0]?.kind, "rx_exception");
  assert.equal(reduce(s, { type: "startPrescription", id: "RX-1042" }).rejected, "wrong_status");
  s = run([{ type: "retryPrescription", id: "RX-1042" }], s);
  assert.equal(rx(s, "RX-1042").status, "waiting");
  assert.equal(s.alerts.length, 0);
  s = run([{ type: "cancelPrescription", id: "RX-1042" }], s);
  assert.equal(rx(s, "RX-1042").status, "cancelled");
  assert.equal(reduce(s, { type: "cancelPrescription", id: "RX-1042" }).rejected, "wrong_status");
});

test("a task in progress cannot be cancelled", () => {
  const s = run([{ type: "signIn", pin: "1234" }, { type: "startPrescription", id: "RX-1041" }]);
  assert.equal(reduce(s, { type: "cancelPrescription", id: "RX-1041" }).rejected, "wrong_status");
});

test("a fault stops the running task, returns it to the queue, blocks new work and clears with the machine", () => {
  let s = run([{ type: "signIn", pin: "1234" }, { type: "startPrescription", id: "RX-1041" }, { type: "fault", code: "E42", message: "Gripper jam" }]);
  assert.equal(s.active, null);
  assert.equal(rx(s, "RX-1041").status, "waiting");
  assert.equal(s.health.status, "fault");
  const fault = s.alerts.find((a) => a.id === "fault");
  assert.equal(fault?.severity, "critical");
  assert.equal(fault?.needsAck, false);
  assert.equal(reduce(s, { type: "startPrescription", id: "RX-1041" }).rejected, "fault_active");
  assert.equal(reduce(s, { type: "ackAlert", id: "fault" }).rejected, "wrong_status");
  s = run([{ type: "faultCleared" }], s);
  assert.equal(s.health.status, "ok");
  assert.equal(s.alerts.length, 0);
});

test("a drawer opening with no task raises an alert that clears when it closes", () => {
  let s = run([{ type: "drawerOpened" }]);
  assert.equal(s.alerts[0]?.kind, "drawer_unexpected");
  s = run([{ type: "drawerClosed" }], s);
  assert.equal(s.alerts.length, 0);
});

test("acknowledging removes an alert; unknown ones are rejected", () => {
  let s = run([{ type: "signIn", pin: "1234" }, { type: "reportException", id: "RX-1042", reason: "other" }]);
  s = run([{ type: "ackAlert", id: "rx_exception-RX-1042" }], s);
  assert.equal(s.alerts.length, 0);
  assert.equal(reduce(s, { type: "ackAlert", id: "nope" }).rejected, "not_found");
});

test("rejected inputs never change the state or the version", () => {
  const s = initialState();
  const r = reduce(s, { type: "signIn", pin: "9999" });
  assert.equal(r.state, s);
});

test("every accepted change bumps the version by exactly one", () => {
  const a = signedIn();
  assert.equal(a.version, initialState().version + 1);
});
