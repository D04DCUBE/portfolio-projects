// The agent loop: ask the model what to do, run the tool it picks through MCP, repeat until it answers.
import type { McpClient } from "./mcp-client.ts";
import type { Message, Model, Trace, ToolCallRecord } from "./types.ts";

export const MAX_STEPS = 8;

export async function runAgent(opts: { model: Model; client: Pick<McpClient, "tools" | "call">; prompt: string; maxSteps?: number }): Promise<Trace> {
  const { model, client, prompt, maxSteps = MAX_STEPS } = opts;
  const steps: Message[] = [{ role: "user", text: prompt }];
  const toolCalls: ToolCallRecord[] = [];

  for (let i = 0; i < maxSteps; i++) {
    const turn = await model.next(steps, client.tools);
    if (turn.type === "final") {
      steps.push({ role: "assistant", final: turn.text });
      return { prompt, steps, toolCalls, reply: turn.text, stopped: "final" };
    }
    steps.push({ role: "assistant", call: { name: turn.name, args: turn.args } });
    let result;
    try {
      result = await client.call(turn.name, turn.args);
    } catch (e) {
      // A broken tool call is data for the model, not a crash of the whole run.
      result = { isError: true, data: { error: e instanceof Error ? e.message : String(e) } };
    }
    steps.push({ role: "tool", name: turn.name, result });
    toolCalls.push({ name: turn.name, args: turn.args, result });
  }
  return { prompt, steps, toolCalls, reply: "", stopped: "max_steps" };
}
