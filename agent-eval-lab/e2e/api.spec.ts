// API tests: the viewer's HTTP API, and the MCP server's JSON-RPC protocol over stdio. No browser.
import { test, expect } from "playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

test.describe("viewer HTTP API", () => {
  test("lists the saved runs with their scores", async ({ request }) => {
    const { runs } = await (await request.get("/api/runs")).json();
    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "careful.json", model: "careful", passed: 8, total: 8 }),
      expect.objectContaining({ file: "careless.json", model: "careless", passed: 3, total: 8 }),
    ]));
  });

  test("returns one run with its traces", async ({ request }) => {
    const run = await (await request.get("/api/runs/careless.json")).json();
    expect(run.cases).toHaveLength(8);
    expect(run.cases.filter((c: { passed: boolean }) => c.passed)).toHaveLength(3);
    expect(run.cases[0].trace.toolCalls).toBeDefined();
  });

  test("refuses bad file names and unknown runs", async ({ request }) => {
    expect((await request.get("/api/runs/..%2Fpackage.json")).status()).toBe(400);
    expect((await request.get("/api/runs/nope.json")).status()).toBe(404);
  });

  test("serves only its own files, read-only, with a strict policy", async ({ request }) => {
    const page = await request.get("/");
    expect(page.headers()["content-security-policy"]).toContain("default-src 'none'");
    for (const path of ["/package.json", "/src/world.ts", "/runs/careful.json"]) expect((await request.get(path)).status(), path).toBe(404);
    expect((await request.post("/api/runs", { data: {} })).status()).toBe(405);
  });
});

// Raw JSON-RPC over stdio, one message per line, exactly as an MCP client speaks it.
function mcp() {
  const server = fileURLToPath(new URL("../src/mcp-server.ts", import.meta.url));
  const child = spawn(process.execPath, ["--no-warnings", server], { stdio: ["pipe", "pipe", "pipe"] });
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m);
  });
  let id = 0;
  return {
    call(method: string, params?: object): Promise<Record<string, any>> {
      const n = ++id;
      return new Promise((ok, bad) => {
        const timer = setTimeout(() => bad(new Error(`timeout: ${method}`)), 3000);
        waiting.set(n, (m) => { clearTimeout(timer); ok(m); });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
      });
    },
    raw(line: string) { child.stdin.write(line + "\n"); },
    close() { child.kill(); },
  };
}

test.describe("MCP server protocol", () => {
  test("initialize, then list the four tools with input schemas", async () => {
    const s = mcp();
    const init = await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    expect(init.result.capabilities.tools).toBeDefined();
    const { result } = await s.call("tools/list");
    expect(result.tools.map((t: { name: string }) => t.name).sort()).toEqual(["check_refund_eligibility", "issue_refund", "list_orders", "lookup_order"]);
    for (const t of result.tools) expect(t.inputSchema.type).toBe("object");
    s.close();
  });

  test("a tool call returns text content; a refused refund is an error result, not a crash", async () => {
    const s = mcp();
    await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
    const order = await s.call("tools/call", { name: "lookup_order", arguments: { order_id: "A1001" } });
    expect(JSON.parse(order.result.content[0].text).id).toBe("A1001");
    const tooMuch = await s.call("tools/call", { name: "issue_refund", arguments: { order_id: "A1001", amount: 1_000_000 } });
    expect(tooMuch.result.isError).toBe(true);
    s.close();
  });

  test("unknown methods and tools get JSON-RPC errors, and the server keeps going", async () => {
    const s = mcp();
    expect((await s.call("no/such/method")).error.code).toBe(-32601);
    const unknownTool = await s.call("tools/call", { name: "drop_tables", arguments: {} });
    expect(unknownTool.error ?? unknownTool.result?.isError).toBeTruthy();
    s.raw("{ this is not json");
    expect((await s.call("ping")).result).toEqual({});
    s.close();
  });
});
