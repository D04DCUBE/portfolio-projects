import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "../src/mcp-client.ts";

test("client lists the four tools over stdio", async () => {
  const c = await connect();
  try {
    assert.deepEqual(c.tools.map((t) => t.name), ["lookup_order", "list_orders", "check_refund_eligibility", "issue_refund"]);
    assert.ok(c.tools.every((t) => t.inputSchema.required.length > 0));
  } finally { await c.close(); }
});

test("a tool call goes through the server and its state sticks within one connection", async () => {
  const c = await connect();
  try {
    assert.equal((await c.call("issue_refund", { order_id: "A1001", amount: 48 })).isError, false);
    const again = await c.call("issue_refund", { order_id: "A1001", amount: 1 });
    assert.equal(again.isError, true);
  } finally { await c.close(); }
});

test("two connections do not share state", async () => {
  const a = await connect(), b = await connect();
  try {
    await a.call("issue_refund", { order_id: "A1001", amount: 48 });
    assert.equal((await b.call("issue_refund", { order_id: "A1001", amount: 48 })).isError, false);
  } finally { await a.close(); await b.close(); }
});

test("an unknown tool name is a protocol error and the connection keeps working", async () => {
  const c = await connect();
  try {
    await assert.rejects(c.call("nope", {}), /Unknown tool/);
    assert.equal((await c.call("lookup_order", { order_id: "A1001" })).isError, false);
  } finally { await c.close(); }
});

test("closing twice is safe", async () => {
  const c = await connect();
  await c.close();
  await c.close();
});
