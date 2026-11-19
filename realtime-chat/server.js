// HTTP server for the page plus a WebSocket endpoint at /ws.
//   node server.js     then open http://localhost:3200 in two windows
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";
import { checkUpgrade, refuse, accept } from "./lib/ws.js";
import { createHub } from "./lib/hub.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const SECURITY_HEADERS = {
  // connect-src 'self' also covers ws:// and wss:// to the same host, so the page can open only its own socket.
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
};

export function createApp({ hub = createHub(), allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean), heartbeatMs = 15_000, maxConnections = 500 } = {}) {
  const live = new Set();
  // Browsers always send Origin on a WebSocket handshake. Accept only our own page or a listed origin.
  // Clients with no Origin header (scripts, tests) are not a browser-hijacking risk, so they are allowed.
  const allowOrigin = (origin, req) => {
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host || allowedOrigins.includes(origin); } catch { return false; }
  };

  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://localhost");
      if (req.method !== "GET") { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
      const file = normalize(join(PUBLIC_DIR, pathname === "/" ? "/index.html" : pathname));
      if (!file.startsWith(PUBLIC_DIR + sep)) throw new Error("outside");
      const data = await readFile(file);
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch { res.writeHead(404, SECURITY_HEADERS); res.end("Not found"); }
  });

  server.on("upgrade", (req, socket) => {
    socket.on("error", () => socket.destroy());
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname !== "/ws") return refuse(socket, [404, "Not Found"]);
    const problem = checkUpgrade(req, { allowOrigin });
    if (problem) return refuse(socket, problem);
    if (live.size >= maxConnections) return refuse(socket, [503, "Server Busy"]);
    let handler;
    const conn = accept(req, socket, { onMessage: (t) => handler.onMessage(t), onClose: () => { live.delete(conn); handler.onClose(); } });
    handler = hub.connect(conn);
    live.add(conn);
  });

  // Heartbeat: a connection that did not answer the last ping is dead (laptop lid, dropped wifi). Drop it so
  // presence does not show ghosts.
  const timer = setInterval(() => {
    for (const c of live) { if (!c.alive) { c.terminate(); continue; } c.alive = false; c.ping(); }
  }, heartbeatMs);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  server.liveConnections = () => live.size;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3200;
  createApp().listen(port, "127.0.0.1", () => console.log(`Chat on http://localhost:${port}`));
}
