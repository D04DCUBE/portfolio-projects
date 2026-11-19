// A small MCP server over stdio. Messages are JSON-RPC 2.0, one per line.
// It implements the parts a client needs to use tools: initialize, ping, tools/list, tools/call.
import { createInterface } from "node:readline";
import { createWorld, TOOLS } from "./world.ts";

const PROTOCOL_VERSION = "2025-06-18";
const world = createWorld();

interface Request { jsonrpc: "2.0"; id?: number | string; method: string; params?: Record<string, unknown> }

const send = (message: object): void => { process.stdout.write(JSON.stringify(message) + "\n"); };
const reply = (id: number | string, result: object): void => send({ jsonrpc: "2.0", id, result });
const error = (id: number | string | null, code: number, message: string): void => send({ jsonrpc: "2.0", id, error: { code, message } });

export function handle(req: Request): void {
  const { id, method } = req;
  if (id === undefined) return; // a notification, such as notifications/initialized: nothing to answer
  switch (method) {
    case "initialize":
      return reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "order-support", version: "1.0.0" } });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      const name = req.params?.["name"];
      const args = req.params?.["arguments"];
      if (typeof name !== "string") return error(id, -32602, "tools/call needs a tool name");
      if (!TOOLS.some((t) => t.name === name)) return error(id, -32602, `Unknown tool: ${name}`);
      const result = world.call(name, args && typeof args === "object" ? (args as Record<string, unknown>) : {});
      return reply(id, { content: [{ type: "text", text: JSON.stringify(result.data) }], isError: result.isError });
    }
    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}

if (import.meta.main) {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let req: Request;
    try { req = JSON.parse(line) as Request; } catch { return error(null, -32700, "Parse error"); }
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return error(req.id ?? null, -32600, "Invalid request");
    handle(req);
  });
  lines.on("close", () => process.exit(0));
}
