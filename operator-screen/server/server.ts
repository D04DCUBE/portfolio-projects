// Owns the machine. Serves the built screen, a WebSocket at /ws, and a simulator
// for the physical world (drawer, faults) bound to localhost only.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { MachineState } from "../src/contract.gen.ts";
import { initialState, reduce, type Input } from "../src/shared/machine.ts";
import { parseCommand } from "../src/shared/commands.ts";
import { upgrade, type Socket } from "./ws.ts";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const ASSETS: Readonly<Record<string, { file: string; type: string }>> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/sim": { file: "sim.html", type: "text/html; charset=utf-8" },
  "/sim.js": { file: "sim.js", type: "text/javascript; charset=utf-8" },
};
const CSP = "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'";

export type Running = {
  readonly port: number;
  readonly state: () => MachineState;
  readonly apply: (input: Input) => void;
  close(): Promise<void>;
};

export async function startServer(opts: { port?: number } = {}): Promise<Running> {
  let state = initialState();
  const sockets = new Set<Socket>();

  const broadcast = () => {
    const msg = JSON.stringify({ type: "snapshot", state });
    for (const s of sockets) s.send(msg);
  };
  const apply = (input: Input): string | undefined => {
    const r = reduce(state, input);
    if (r.rejected) return r.rejected;
    if (r.state !== state) { state = r.state; broadcast(); }
    return undefined;
  };

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");

    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
    // Read-only view of the machine for tests and the simulator. Localhost only, like the rest of /sim.
    if (req.method === "GET" && url.pathname === "/sim/state") {
      if (!local) { res.writeHead(403).end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(state));
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/sim/")) {
      if (!local) { res.writeHead(403).end(); return; }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 2048) req.destroy(); });
      req.on("end", () => {
        let json: Record<string, unknown> = {};
        try {
          const parsed: unknown = body ? JSON.parse(body) : {};
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
          json = parsed as Record<string, unknown>;
        } catch { res.writeHead(400).end(); return; }
        const action = url.pathname.slice(5);
        if (action === "drawer-open") apply({ type: "drawerOpened" });
        else if (action === "drawer-close") apply({ type: "drawerClosed" });
        else if (action === "fault") apply({ type: "fault", code: String(json.code ?? "E42").slice(0, 12), message: String(json.message ?? "Gripper jam").slice(0, 80) });
        else if (action === "clear-fault") apply({ type: "faultCleared" });
        else if (action === "reset") { state = { ...initialState(), version: state.version + 1 }; broadcast(); }
        else { res.writeHead(404).end(); return; }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ version: state.version }));
      });
      return;
    }

    const asset = req.method === "GET" ? ASSETS[url.pathname] : undefined;
    const path = asset ? dist + asset.file : "";
    if (!asset || !existsSync(path)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": asset.type }).end(readFileSync(path));
  });

  http.on("upgrade", (req, socket) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws") { socket.end("HTTP/1.1 404 Not Found\r\n\r\n"); return; }
    upgrade(req, socket, {
      onOpen(s) { sockets.add(s); s.send(JSON.stringify({ type: "snapshot", state })); },
      onClose(s) { sockets.delete(s); },
      onMessage(s, text) {
        let cmd = null;
        try { cmd = parseCommand(JSON.parse(text)); } catch { /* falls through */ }
        if (!cmd) { s.send(JSON.stringify({ type: "rejected", command: "unknown", reason: "wrong_status" })); return; }
        const reason = apply(cmd);
        if (reason) s.send(JSON.stringify({ type: "rejected", command: cmd.type, reason }));
      },
    });
  });

  await new Promise<void>((ok) => http.listen(opts.port ?? 0, "127.0.0.1", ok));
  return {
    port: (http.address() as AddressInfo).port,
    state: () => state,
    apply: (i) => { apply(i); },
    close: () => new Promise((ok) => { for (const s of sockets) s.close(); http.close(() => ok()); http.closeAllConnections(); }),
  };
}
