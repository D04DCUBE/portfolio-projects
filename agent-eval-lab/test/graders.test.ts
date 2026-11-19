import { test } from "node:test";
import assert from "node:assert/strict";
import { calledBefore, calledTool, finished, maxToolCalls, notCalledTool, refundIssued, replyExcludes, replyIncludes } from "../src/graders.ts";
import type { ToolCallRecord, Trace } from "../src/types.ts";

const tc = (name: string, args: Record<string, string | number> = {}, isError = false): ToolCallRecord => ({ name, args, result: { isError, data: null } });
const trace = (calls: ToolCallRecord[], reply = "ok", stopped: Trace["stopped"] = "final"): Trace => ({ prompt: "p", steps: [], toolCalls: calls, reply, stopped });

test("finished fails when the agent hit the step limit", () => {
  assert.equal(finished()(trace([], "", "max_steps")).passed, false);
  assert.equal(finished()(trace([])).passed, true);
});

test("calledTool and notCalledTool", () => {
  const t = trace([tc("lookup_order")]);
  assert.equal(calledTool("lookup_order")(t).passed, true);
  assert.equal(calledTool("issue_refund")(t).passed, false);
  assert.equal(notCalledTool("issue_refund")(t).passed, true);
  assert.equal(notCalledTool("lookup_order")(t).passed, false);
});

test("calledBefore: passes if the later tool never ran, fails if it ran first or alone", () => {
  const g = calledBefore("check_refund_eligibility", "issue_refund");
  assert.equal(g(trace([tc("lookup_order")])).passed, true);
  assert.equal(g(trace([tc("check_refund_eligibility"), tc("issue_refund")])).passed, true);
  assert.equal(g(trace([tc("issue_refund"), tc("check_refund_eligibility")])).passed, false);
  assert.equal(g(trace([tc("issue_refund")])).passed, false);
});

test("refundIssued needs a refund that succeeded with the exact order and amount", () => {
  const g = refundIssued("A1", 50);
  assert.equal(g(trace([tc("issue_refund", { order_id: "A1", amount: 50 })])).passed, true);
  assert.equal(g(trace([tc("issue_refund", { order_id: "A1", amount: 50 }, true)])).passed, false, "a refused refund does not count");
  assert.equal(g(trace([tc("issue_refund", { order_id: "A1", amount: 200 })])).passed, false);
  assert.equal(g(trace([tc("issue_refund", { order_id: "A2", amount: 50 })])).passed, false);
});

test("maxToolCalls counts calls", () => {
  assert.equal(maxToolCalls(1)(trace([tc("a"), tc("b")])).passed, false);
  assert.equal(maxToolCalls(2)(trace([tc("a"), tc("b")])).passed, true);
});

test("reply graders match on the reply text", () => {
  assert.equal(replyIncludes("x", /window/i)(trace([], "Outside the Window")).passed, true);
  assert.equal(replyExcludes("x", /refunded/)(trace([], "I refunded it")).passed, false);
  assert.equal(replyExcludes("x", /refunded/)(trace([], "No.")).passed, true);
});
