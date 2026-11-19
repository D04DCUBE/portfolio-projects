// Serves the dashboard and a small API over simulated training runs.
//   node server.ts     then open http://localhost:3400   (needs Node 22.18 or newer, which runs TypeScript directly)
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";
import { createRuns } from "./lib/runs.ts";
import type { Runs, Run } from "./lib/runs.ts";
import { rangeMetrics } from "./lib/sim.ts";
import { validateConfig } from "./public/js/config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
// Browsers cannot run TypeScript, so a .ts file is served as JavaScript with its types stripped (nothing else changes).
// The result is cached until the file changes. There is no build step.
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".ts": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const stripped = new Map<string, { mtime: number; code: string }>();
async function readAsset(file: string): Promise<Buffer | string> {
  if (extname(file) !== ".ts") return readFile(file);
  const mtime = (await stat(file)).mtimeMs, hit = stripped.get(file);
  if (hit && hit.mtime === mtime) return hit.code;
  const code = stripTypeScriptTypes(await readFile(file, "utf8"));
  stripped.set(file, { mtime, code });
  return code;
}
type HttpError = Error & { status?: number };
const SECURITY = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
};
const MAX_BODY = 2_000;
const ID = /^r\d{1,6}$/;

export function createApp({ runs = createRuns(), heartbeatMs = 15_000 }: { runs?: Runs; heartbeatMs?: number } = {}) {
  const json = (res: ServerResponse, status: number, body: unknown): void => { res.writeHead(status, { ...SECURITY, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };

  function readJson(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error("too large"), { status: 413 })); } else chunks.push(c); });
      req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "null")); } catch { reject(Object.assign(new Error("bad json"), { status: 400 })); } });
      req.on("error", reject);
    });
  }

  // Server-Sent Events: the browser reconnects by itself and sends Last-Event-ID, which is the last step it saw.
  // We answer a reconnect with the steps it missed, then continue live, so a dropped connection loses nothing.
  function stream(req: IncomingMessage, res: ServerResponse, run: Run, url: URL): void {
    const since = Number(req.headers["last-event-id"] ?? url.searchParams.get("since") ?? 0) || 0;
    res.writeHead(200, { ...SECURITY, "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const send = (event: string, data: unknown, id?: number): boolean => res.write(`${id != null ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.write("retry: 1000\n\n");
    if (run.step > since) send("points", { points: rangeMetrics(run.config, since + 1, run.step) }, run.step);
    if (run.status !== "running") { send("status", { status: run.status, step: run.step }); send("end", {}); res.end(); return; }
    let hb: ReturnType<typeof setInterval> | undefined;
    const cleanup = (): void => { unsub(); clearInterval(hb); };
    const unsub = runs.subscribe(run.id, (ev) => {
      if (ev.type === "points") return send("points", ev, ev.points.at(-1)?.step);
      send("status", ev); send("end", {}); cleanup(); res.end();
    });
    hb = setInterval(() => res.write(": keep-alive\n\n"), heartbeatMs);
    req.on("close", cleanup);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (path.startsWith("/api/")) {
        if (req.method === "POST" && req.headers["x-requested-with"] !== "dash") return json(res, 403, { error: "Missing X-Requested-With header." });
        let m: RegExpMatchArray | null;
        if (path === "/api/runs" && req.method === "GET") return json(res, 200, { runs: runs.list() });
        if (path === "/api/runs" && req.method === "POST") {
          if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { error: "Send JSON." });
          const checked = validateConfig(await readJson(req));
          if (!checked.ok) return json(res, 400, { error: "Invalid run settings.", fields: checked.errors });
          try { return json(res, 201, { run: runs.summary(runs.create(checked.config)) }); }
          catch (e) { const err = e as Error & { code?: string }; if (err.code === "too_many") return json(res, 429, { error: err.message }); throw e; }
        }
        if ((m = path.match(/^\/api\/runs\/([^/]+)(\/stream|\/stop)?$/))) {
          if (!ID.test(m[1])) return json(res, 404, { error: "No such run." });
          const run = runs.get(m[1]);
          if (!run) return json(res, 404, { error: "No such run." });
          if (!m[2] && req.method === "GET") return json(res, 200, { run: runs.summary(run), points: runs.metrics(run.id) });
          if (m[2] === "/stream" && req.method === "GET") return stream(req, res, run, url);
          if (m[2] === "/stop" && req.method === "POST") return json(res, 200, { run: runs.summary(runs.stop(run.id) ?? run) });
        }
        return json(res, 404, { error: "Not found." });
      }
      if (req.method !== "GET") { res.writeHead(405, SECURITY); return res.end(); }
      const file = normalize(join(PUBLIC_DIR, path === "/" ? "/index.html" : path));
      if (!file.startsWith(PUBLIC_DIR + sep)) throw new Error("outside");
      const data = await readAsset(file);
      res.writeHead(200, { ...SECURITY, "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch (caught) {
      const e = caught as HttpError;
      if (e.status === 413) { res.setHeader("Connection", "close"); res.on("finish", () => req.destroy()); }   // answer first, then drop the rest of a too-big upload
      if (e.status) return json(res, e.status, { error: e.message });
      res.writeHead(404, SECURITY); res.end("Not found");
    }
  });
  server.on("close", () => runs.close());
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3400;
  createApp().listen(port, "127.0.0.1", () => console.log(`Training dashboard on http://localhost:${port}`));
}
