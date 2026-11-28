// HTTP server: a streaming chat endpoint, a tool endpoint, and static files. No frameworks.
//   node server.js     then open http://localhost:3100
// The response to POST /api/chat is newline-delimited JSON (one event per line), sent as it is produced.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";
import { createProvider } from "./lib/providers/index.js";
import { runTool, ToolError } from "./lib/tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const MAX_BODY = 1_500_000;   // room for up to three small attachments
const MAX_MESSAGES = 40;
const MAX_CONTENT = 4_000;
const ROLES = new Set(["user", "assistant", "tool"]);
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);   // no SVG: it can carry script
const MAX_TEXT_ATTACHMENT = 20_000, MAX_IMAGE_B64 = 400_000, MAX_ATTACHMENTS = 3;
const MAX_ARTIFACT = 50_000, MAX_ARTIFACTS = 20;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function validateAttachments(list) {
  if (!Array.isArray(list) || list.length > MAX_ATTACHMENTS) throw new HttpError(400, `At most ${MAX_ATTACHMENTS} attachments.`);
  return list.map((a) => {
    const ok = a && typeof a.name === "string" && a.name.length > 0 && a.name.length <= 100 && typeof a.data === "string";
    if (!ok) throw new HttpError(400, "Bad attachment.");
    if (a.kind === "text" && TEXT_MIMES.has(a.mime) && a.data.length <= MAX_TEXT_ATTACHMENT) return { name: a.name, kind: "text", mime: a.mime, data: a.data };
    if (a.kind === "image" && IMAGE_MIMES.has(a.mime) && a.data.length <= MAX_IMAGE_B64 && /^[A-Za-z0-9+/]+=*$/.test(a.data)) return { name: a.name, kind: "image", mime: a.mime, data: a.data };
    throw new HttpError(400, "Unsupported or oversized attachment.");
  });
}

export function validateMessages(body) {
  const list = body?.messages;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MESSAGES) throw new HttpError(400, `messages must be 1-${MAX_MESSAGES} items.`);
  const out = list.map((m) => {
    if (!m || !ROLES.has(m.role) || typeof m.content !== "string" || m.content.length > MAX_CONTENT) {
      throw new HttpError(400, `Each message needs a role and up to ${MAX_CONTENT} characters of content.`);
    }
    const msg = { role: m.role, content: m.content };
    if (m.attachments !== undefined) {
      if (m.role !== "user") throw new HttpError(400, "Only user messages can have attachments.");
      msg.attachments = validateAttachments(m.attachments);
    }
    if (msg.content.length === 0 && !msg.attachments?.length) throw new HttpError(400, `Each message needs a role and up to ${MAX_CONTENT} characters of content.`);
    return msg;
  });
  if (out[out.length - 1].role === "assistant") throw new HttpError(400, "The last message must be from the user or a tool.");
  return out;
}

export function createApp({ provider = createProvider(), limits = {} } = {}) {
  const maxPerMinute = limits.chatPerMinute ?? 30;
  const hits = new Map();
  function limited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    recent.push(now); hits.set(ip, recent);
    return recent.length > maxPerMinute;
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, "Request body too large.")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new HttpError(400, "Body must be valid JSON.")); } });
      req.on("error", reject);
    });
  }

  function requireJsonPost(req) {
    // A custom header plus JSON content type cannot be sent by a plain cross-site form, which blocks CSRF here.
    if (!(req.headers["content-type"] || "").startsWith("application/json") || req.headers["x-requested-with"] !== "fetch") {
      throw new HttpError(400, "Bad request.");
    }
  }

  // Artifacts: model-written HTML, stored briefly and served from a separate URL whose headers sandbox it.
  const artifacts = new Map();
  async function createArtifact(req, res) {
    requireJsonPost(req);
    const body = await readJson(req);
    if (typeof body?.html !== "string" || body.html.length === 0 || body.html.length > MAX_ARTIFACT) throw new HttpError(400, "html must be 1-50000 characters.");
    const id = randomBytes(12).toString("hex");
    artifacts.set(id, body.html);
    if (artifacts.size > MAX_ARTIFACTS) artifacts.delete(artifacts.keys().next().value);   // drop the oldest
    sendJson(res, 200, { url: `/artifact/${id}` });
  }
  function serveArtifact(res, id) {
    const html = /^[0-9a-f]{24}$/.test(id) ? artifacts.get(id) : null;
    if (!html) throw new HttpError(404, "Not found.");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
      // sandbox: opaque origin, so the page cannot touch cookies, storage or the parent. No forms, popups or navigation.
      // default-src 'none': it cannot load anything or call any server. Inline script and style are allowed so a demo can run.
      "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
    });
    res.end(html);
  }

  async function chat(req, res) {
    requireJsonPost(req);
    if (limited(req.socket.remoteAddress || "?")) throw new HttpError(429, "Too many requests. Wait a minute.");
    const messages = validateMessages(await readJson(req));

    const controller = new AbortController();
    // If the browser disconnects (Stop button, closed tab), stop generating.
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });

    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    const emit = (event) => res.write(JSON.stringify(event) + "\n");
    try {
      for await (const event of provider.stream({ messages, signal: controller.signal })) {
        if (controller.signal.aborted) break;   // do not rely on the provider noticing the abort
        emit(event);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error("provider error:", err.message);
        // A short, safe message. Internal details stay in the server log.
        emit({ type: "error", message: "The model stopped responding. You can retry." });
      }
    }
    res.end();
  }

  async function tool(req, res) {
    requireJsonPost(req);
    const body = await readJson(req);
    try {
      return sendJson(res, 200, { result: runTool(body?.name, body?.args) });
    } catch (e) {
      if (e instanceof ToolError) throw new HttpError(400, e.message);
      throw e;
    }
  }

  async function serveStatic(req, res, pathname) {
    const rel = pathname === "/" ? "/index.html" : pathname;
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + sep)) throw new HttpError(404, "Not found.");
    try {
      const data = await readFile(file);
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch { throw new HttpError(404, "Not found."); }
  }

  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://localhost");
      if (req.method === "POST" && pathname === "/api/chat") return await chat(req, res);
      if (req.method === "POST" && pathname === "/api/tool") return await tool(req, res);
      if (req.method === "POST" && pathname === "/api/artifact") return await createArtifact(req, res);
      if (req.method === "GET" && pathname.startsWith("/artifact/")) return serveArtifact(res, pathname.slice(10));
      if (req.method === "GET" && !pathname.startsWith("/api/")) return await serveStatic(req, res, pathname);
      throw new HttpError(404, "Not found.");
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      sendJson(res, 500, { error: "Something went wrong." });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3100;
  // CHAT_PER_MINUTE raises the per-IP limit for automated test runs only.
  createApp({ limits: { chatPerMinute: Number(process.env.CHAT_PER_MINUTE) || undefined } }).listen(port, "127.0.0.1", () => console.log(`AI chat on http://localhost:${port} (provider: ${process.env.PROVIDER || "fake"})`));
}
