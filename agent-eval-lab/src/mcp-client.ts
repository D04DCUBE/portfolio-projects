// The other end: starts the server as a child process and talks to it over stdio.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Json, ToolResult, ToolSpec } from "./types.ts";

const SERVER = fileURLToPath(new URL("./mcp-server.ts", import.meta.url));

interface Pending { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }

export interface McpClient {
  tools: ToolSpec[];
  call(name: string, args: Record<string, Json>): Promise<ToolResult>;
  close(): Promise<void>;
}

export async function connect(timeoutMs = 5000): Promise<McpClient> {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ["--no-warnings", SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let exited = false;

  const failAll = (why: string): void => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)); }
    pending.clear();
  };
  child.on("exit", (code) => { exited = true; failAll(`MCP server exited (code ${code})`); });
  child.on("error", (e) => failAll(`MCP server failed to start: ${e.message}`));

  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg: { id?: number; result?: unknown; error?: { message: string } };
    try { msg = JSON.parse(line); } catch { return; }
    if (typeof msg.id !== "number") return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });

  function request(method: string, params?: object): Promise<unknown> {
    if (exited) return Promise.reject(new Error("MCP server is not running"));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "agent-eval-lab", version: "1.0.0" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const listed = (await request("tools/list")) as { tools: ToolSpec[] };

    return {
      tools: listed.tools,
      async call(name, args) {
        const res = (await request("tools/call", { name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
        const text = res.content.find((c) => c.type === "text")?.text ?? "null";
        let data: Json;
        try { data = JSON.parse(text) as Json; } catch { data = text; }
        return { isError: res.isError === true, data };
      },
      async close() {
        if (exited) return;
        await new Promise<void>((done) => { child.once("exit", () => done()); child.stdin.end(); setTimeout(() => child.kill(), 1000).unref(); });
      },
    };
  } catch (e) {
    child.kill();
    throw e;
  }
}
