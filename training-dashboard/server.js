// Serves the dashboard and a small API over simulated training runs.
//   node server.js     then open http://localhost:3400
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";
import { createRuns } from "./lib/runs.js";
import { rangeMetrics } from "./lib/sim.js";
import { validateConfig } from "./public/js/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const SECURITY = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
};
const MAX_BODY = 2_000;
const ID = /^r\d{1,6}$/;

export function createApp({ runs = createRuns(), heartbeatMs = 15_000 } = {}) {
  const json = (res, status, body) => { res.writeHead(status, { ...SECURITY, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error("too large"), { status: 413 })); } else chunks.push(c); });
      req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "null")); } catch { reject(Object.assign(new Error("bad json"), { status: 400 })); } });
      req.on("error", reject);
    });
  }

  // Server-Sent Events: the browser reconnects by itself and sends Last-Event-ID, which is the last step it saw.
  // We answer a reconnect with the steps it missed, then continue live, so a dropped connection loses nothing.
  function stream(req, res, run, url) {
    const since = Number(req.headers["last-event-id"] ?? url.searchParams.get("since") ?? 0) || 0;
    res.writeHead(200, { ...SECURITY, "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const send = (event, data, id) => res.write(`${id != null ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.write("retry: 1000\n\n");
    if (run.step > since) send("points", { points: rangeMetrics(run.config, since + 1, run.step) }, run.step);
    if (run.status !== "running") { send("status", { status: run.status, step: run.step }); send("end", {}); return res.end(); }
    let hb;
    const cleanup = () => { unsub(); clearInterval(hb); };
    const unsub = runs.subscribe(run.id, (ev) => {
      if (ev.type === "points") return send("points", ev, ev.points.at(-1).step);
      send("status", ev); send("end", {}); cleanup(); res.end();
    });
    hb = setInterval(() => res.write(": keep-alive\n\n"), heartbeatMs);
    req.on("close", cleanup);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;
      if (path.startsWith("/api/")) {
        if (req.method === "POST" && req.headers["x-requested-with"] !== "dash") return json(res, 403, { error: "Missing X-Requested-With header." });
        let m;
        if (path === "/api/runs" && req.method === "GET") return json(res, 200, { runs: runs.list() });
        if (path === "/api/runs" && req.method === "POST") {
          if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { error: "Send JSON." });
          const checked = validateConfig(await readJson(req));
          if (!checked.ok) return json(res, 400, { error: "Invalid run settings.", fields: checked.errors });
          try { return json(res, 201, { run: runs.summary(runs.create(checked.config)) }); }
          catch (e) { if (e.code === "too_many") return json(res, 429, { error: e.message }); throw e; }
        }
        if ((m = path.match(/^\/api\/runs\/([^/]+)(\/stream|\/stop)?$/))) {
          if (!ID.test(m[1])) return json(res, 404, { error: "No such run." });
          const run = runs.get(m[1]);
          if (!run) return json(res, 404, { error: "No such run." });
          if (!m[2] && req.method === "GET") return json(res, 200, { run: runs.summary(run), points: runs.metrics(run.id) });
          if (m[2] === "/stream" && req.method === "GET") return stream(req, res, run, url);
          if (m[2] === "/stop" && req.method === "POST") return json(res, 200, { run: runs.summary(runs.stop(run.id)) });
        }
        return json(res, 404, { error: "Not found." });
      }
      if (req.method !== "GET") { res.writeHead(405, SECURITY); return res.end(); }
      const file = normalize(join(PUBLIC_DIR, path === "/" ? "/index.html" : path));
      if (!file.startsWith(PUBLIC_DIR + sep)) throw new Error("outside");
      const data = await readFile(file);
      res.writeHead(200, { ...SECURITY, "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch (e) {
      if (e.status === 413) { res.setHeader("Connection", "close"); res.on("finish", () => req.destroy()); }   // answer first, then drop the rest of a too-big upload
      if (e.status) return json(res, e.status, { error: e.message });
      res.writeHead(404, SECURITY); res.end("Not found");
    }
  });
  server.on("close", () => runs.close());
  server.runs = runs;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3400;
  createApp().listen(port, "127.0.0.1", () => console.log(`Training dashboard on http://localhost:${port}`));
}
