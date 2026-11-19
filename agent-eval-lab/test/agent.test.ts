import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/agent.ts";
import type { Model, ModelTurn, ToolResult, ToolSpec } from "../src/types.ts";

const tools: ToolSpec[] = [];
const okClient = { tools, call: async (): Promise<ToolResult> => ({ isError: false, data: 1 }) };

const scripted = (turns: ModelTurn[]): Model => { let i = 0; return { id: "s", next: async () => turns[Math.min(i++, turns.length - 1)]! }; };

test("runs tools until the model answers, and records every step", async () => {
  const t = await runAgent({ model: scripted([{ type: "tool_call", name: "a", args: { x: 1 } }, { type: "final", text: "done" }]), client: okClient, prompt: "hi" });
  assert.equal(t.stopped, "final");
  assert.equal(t.reply, "done");
  assert.equal(t.toolCalls.length, 1);
  assert.deepEqual(t.steps.map((s) => s.role + ("final" in s ? ":final" : "")), ["user", "assistant", "tool", "assistant:final"]);
});

test("a model that never stops is cut off at the step limit", async () => {
  const t = await runAgent({ model: scripted([{ type: "tool_call", name: "a", args: {} }]), client: okClient, prompt: "hi", maxSteps: 3 });
  assert.equal(t.stopped, "max_steps");
  assert.equal(t.toolCalls.length, 3);
  assert.equal(t.reply, "");
});

test("a tool that throws becomes an error result the model can see", async () => {
  const boom = { tools, call: async (): Promise<ToolResult> => { throw new Error("server died"); } };
  const t = await runAgent({ model: scripted([{ type: "tool_call", name: "a", args: {} }, { type: "final", text: "sorry" }]), client: boom, prompt: "hi" });
  assert.equal(t.stopped, "final");
  assert.equal(t.toolCalls[0]!.result.isError, true);
  assert.deepEqual(t.toolCalls[0]!.result.data, { error: "server died" });
});
