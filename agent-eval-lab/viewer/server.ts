// Serves the viewer page and the saved runs. Node 22.18+ runs this file directly.
// The browser also gets .ts files: they are sent with the types removed.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunRecord } from "../src/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = join(ROOT, "runs");
const FILE_NAME = /^[\w.-]+\.json$/;

// Only these files are served as pages and scripts. Nothing else under the project is reachable.
const STATIC: Record<string, { path: string; type: string }> = {
  "/": { path: "viewer/index.html", type: "text/html; charset=utf-8" },
  "/app.ts": { path: "viewer/app.ts", type: "text/javascript; charset=utf-8" },
  "/src/compare.ts": { path: "src/compare.ts", type: "text/javascript; charset=utf-8" },
};

const stripped = new Map<string, { mtime: number; code: string }>();
function readAsset(rel: string): string {
  const full = join(ROOT, rel);
  if (!rel.endsWith(".ts")) return readFileSync(full, "utf8");
  const mtime = statSync(full).mtimeMs;
  const hit = stripped.get(rel);
  if (hit && hit.mtime === mtime) return hit.code;
  const code = stripTypeScriptTypes(readFileSync(full, "utf8"));
  stripped.set(rel, { mtime, code });
  return code;
}

const HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { ...HEADERS, "Content-Type": type });
  res.end(body);
}

export function createViewer(runsDir = RUNS) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method !== "GET") return send(res, 405, "text/plain", "Method not allowed");
      const path = new URL(req.url ?? "/", "http://localhost").pathname;

      if (path === "/api/runs") {
        let names: string[] = [];
        try { names = readdirSync(runsDir).filter((n) => FILE_NAME.test(n)).sort(); } catch { /* no runs folder yet */ }
        const list = names.flatMap((file) => {
          try {
            const r = JSON.parse(readFileSync(join(runsDir, file), "utf8")) as RunRecord;
            return [{ file, model: r.model, startedAt: r.startedAt, passed: r.passed, total: r.total }];
          } catch { return []; }
        });
        return send(res, 200, "application/json", JSON.stringify({ runs: list }));
      }
      if (path.startsWith("/api/runs/")) {
        const file = decodeURIComponent(path.slice("/api/runs/".length));
        if (!FILE_NAME.test(file)) return send(res, 400, "application/json", JSON.stringify({ error: "Bad file name" }));
        try { return send(res, 200, "application/json", readFileSync(join(runsDir, file), "utf8")); }
        catch { return send(res, 404, "application/json", JSON.stringify({ error: "No such run" })); }
      }
      const asset = STATIC[path];
      if (!asset) return send(res, 404, "text/plain", "Not found");
      return send(res, 200, asset.type, readAsset(asset.path));
    } catch (e) {
      return send(res, 500, "text/plain", e instanceof Error ? e.message : "Server error");
    }
  });
}

if (import.meta.main) {
  const port = Number(process.env["PORT"] ?? 3500);
  createViewer().listen(port, () => console.log(`Agent Eval Lab viewer on http://localhost:${port}`));
}
