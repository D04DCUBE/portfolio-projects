// Shared types. Only types here, so the file is erased at run time.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, { type: string; description?: string }>; required: string[] };
}

export interface ToolResult {
  isError: boolean;
  data: Json;
}

/** What the model sees and returns on each step. */
export type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; call: { name: string; args: Record<string, Json> } }
  | { role: "tool"; name: string; result: ToolResult }
  | { role: "assistant"; final: string };

export type ModelTurn =
  | { type: "tool_call"; name: string; args: Record<string, Json> }
  | { type: "final"; text: string };

export interface Model {
  id: string;
  next(messages: Message[], tools: ToolSpec[]): Promise<ModelTurn>;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, Json>;
  result: ToolResult;
}

/** Everything that happened in one agent run. This is what graders read and the viewer shows. */
export interface Trace {
  prompt: string;
  steps: Message[];
  toolCalls: ToolCallRecord[];
  reply: string;
  stopped: "final" | "max_steps";
}

export interface GraderResult {
  name: string;
  passed: boolean;
  detail: string;
}

export type Grader = (trace: Trace) => GraderResult;

export interface EvalCase {
  id: string;
  description: string;
  prompt: string;
  graders: Grader[];
}

export interface CaseRecord {
  id: string;
  description: string;
  passed: boolean;
  graders: GraderResult[];
  trace: Trace;
}

export interface RunRecord {
  id: string;
  model: string;
  startedAt: string;
  passed: number;
  total: number;
  cases: CaseRecord[];
}
