import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, seedOrders, type Order } from "../src/world.ts";

const order = (over: Partial<Order>): Order => ({ id: "T1", email: "t@example.com", item: "Thing", total: 100, status: "delivered", deliveredOn: "2026-11-01", refunded: 0, ...over });
const data = (r: { data: unknown }) => r.data as Record<string, unknown>;

test("exactly 30 days after delivery is still eligible; 31 is not", () => {
  const w = createWorld([order({ id: "ON", deliveredOn: "2026-10-20" }), order({ id: "LATE", deliveredOn: "2026-10-19" })]);
  assert.equal(data(w.call("check_refund_eligibility", { order_id: "ON" }))["eligible"], true);
  const late = data(w.call("check_refund_eligibility", { order_id: "LATE" }));
  assert.equal(late["eligible"], false);
  assert.match(String(late["reason"]), /30-day/);
});

test("order ids are matched without caring about case or spaces", () => {
  const w = createWorld(seedOrders());
  assert.equal(w.call("lookup_order", { order_id: " a1001 " }).isError, false);
});

test("a refund above the maximum is refused and changes nothing", () => {
  const w = createWorld([order({})]);
  assert.equal(w.call("issue_refund", { order_id: "T1", amount: 100.01 }).isError, true);
  assert.equal(w.orders[0]!.refunded, 0);
});

test("partial refunds add up and cannot exceed the total", () => {
  const w = createWorld([order({})]);
  assert.equal(w.call("issue_refund", { order_id: "T1", amount: 60 }).isError, false);
  assert.equal(data(w.call("check_refund_eligibility", { order_id: "T1" }))["max_refund"], 40);
  assert.equal(w.call("issue_refund", { order_id: "T1", amount: 50 }).isError, true);
  assert.equal(w.call("issue_refund", { order_id: "T1", amount: 40 }).isError, false);
  assert.match(String(data(w.call("issue_refund", { order_id: "T1", amount: 1 }))["error"]), /already refunded/);
});

test("bad amounts are refused: zero, negative, text, NaN", () => {
  const w = createWorld([order({})]);
  for (const amount of [0, -5, "ten", Number.NaN, null]) {
    assert.equal(w.call("issue_refund", { order_id: "T1", amount }).isError, true, String(amount));
  }
  assert.equal(w.orders[0]!.refunded, 0);
});

test("unknown orders and unknown tools return errors, not crashes", () => {
  const w = createWorld(seedOrders());
  assert.equal(w.call("lookup_order", { order_id: "ZZ" }).isError, true);
  assert.equal(w.call("lookup_order", {}).isError, true);
  assert.equal(w.call("drop_tables", {}).isError, true);
});

test("list_orders matches the email ignoring case and returns only that customer's orders", () => {
  const w = createWorld(seedOrders());
  const ids = (w.call("list_orders", { email: "ALICE@example.com" }).data as { id: string }[]).map((o) => o.id);
  assert.deepEqual(ids, ["A1001", "A1002"]);
});
