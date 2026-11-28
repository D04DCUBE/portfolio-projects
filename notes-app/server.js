// A small HTTP server with a JSON API and static file serving. No frameworks, so every part is visible.
//   node server.js            then open http://localhost:3000

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";
import { createStore, MAX_NOTES_PER_USER } from "./lib/store.js";
import { buildIndex, searchNotes } from "./lib/search.js";
import { ask, extractiveProvider } from "./lib/answer.js";
import {
  hashPassword, verifyPassword, DUMMY_HASH, newToken, hashToken,
  parseCookies, sessionCookie, clearCookie, createLimiter,
} from "./lib/auth.js";
import { validateCredentials, validateNote, validateText, LIMITS } from "./lib/validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY = 100_000;   // a note body is up to 20,000 characters, plus JSON escaping

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png",
};

// Security headers on every response.
// CSP: scripts only from this origin. style-src allows 'unsafe-inline' because Web Components inject <style> into shadow roots.
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApp({ store = createStore(), secureCookies = false, limits = {}, provider = extractiveProvider } = {}) {
  const loginLimiter = createLimiter(limits.loginMax ?? 5, 60_000);
  const signupLimiter = createLimiter(limits.signupMax ?? 10, 60 * 60_000);
  const queryLimiter = createLimiter(limits.queryMax ?? 60, 60_000);   // search and ask, per user

  // One search index per user, rebuilt only when that user's notes change.
  const indexes = new Map();
  function indexFor(userId) {
    const version = store.version(userId);
    const hit = indexes.get(userId);
    if (hit && hit.version === version) return hit.index;
    const index = buildIndex(store.listNotes(userId));
    indexes.set(userId, { version, index });
    return index;
  }

  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      ...(isJson ? { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } : {}),
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, "Request body too large.")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        if (chunks.length === 0) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new HttpError(400, "Invalid JSON.")); }
      });
      req.on("error", reject);
    });
  }

  function currentUser(req) {
    const token = parseCookies(req.headers.cookie).sid;
    if (!token) return null;
    const session = store.findSession(hashToken(token));
    return session ? store.findUserById(session.userId) : null;
  }

  function startSession(res, user, status, extra = {}) {
    const token = newToken();
    store.createSession(user.id, hashToken(token), Date.now() + SESSION_SECONDS * 1000);
    send(res, status, { user: { email: user.email }, ...extra },
      { "Set-Cookie": sessionCookie(token, { maxAgeSeconds: SESSION_SECONDS, secure: secureCookies }) });
  }

  async function handleApi(req, res, url) {
    const method = req.method;

    // CSRF defense in depth, on top of SameSite=Strict: a plain HTML form cannot send JSON or custom headers.
    if (method !== "GET") {
      if (!String(req.headers["content-type"] || "").startsWith("application/json") && method !== "DELETE")
        throw new HttpError(415, "Content-Type must be application/json.");
      if (req.headers["x-requested-with"] !== "notes") throw new HttpError(403, "Missing request header.");
    }

    const ip = req.socket.remoteAddress || "unknown";

    if (url.pathname === "/api/signup" && method === "POST") {
      if (!signupLimiter.allow(ip)) throw new HttpError(429, "Too many sign-ups. Try again later.");
      const body = await readJson(req);
      const err = validateCredentials(body, { strict: true });
      if (err) throw new HttpError(400, err);
      if (store.findUserByEmail(body.email)) throw new HttpError(409, "An account with that email already exists.");
      return startSession(res, store.createUser(body.email, hashPassword(body.password)), 201);
    }

    if (url.pathname === "/api/login" && method === "POST") {
      const body = await readJson(req);
      const err = validateCredentials(body, { strict: false });
      if (err) throw new HttpError(400, err);
      const key = ip + "|" + body.email.toLowerCase();
      if (!loginLimiter.allow(key)) throw new HttpError(429, "Too many attempts. Wait a minute and try again.");
      const user = store.findUserByEmail(body.email);
      const ok = verifyPassword(body.password, user ? user.passwordHash : DUMMY_HASH);
      if (!user || !ok) throw new HttpError(401, "Invalid email or password."); // same message for both cases
      loginLimiter.reset(key);
      return startSession(res, user, 200);
    }

    if (url.pathname === "/api/logout" && method === "POST") {
      const token = parseCookies(req.headers.cookie).sid;
      if (token) store.deleteSession(hashToken(token));
      return send(res, 200, { ok: true }, { "Set-Cookie": clearCookie(secureCookies) });
    }

    // Everything below needs a signed-in user.
    const user = currentUser(req);
    if (!user) throw new HttpError(401, "Please sign in.");

    if (url.pathname === "/api/me" && method === "GET") return send(res, 200, { user: { email: user.email } });
    if (url.pathname === "/api/notes" && method === "GET") {
      const tag = url.searchParams.get("tag") || undefined;
      return send(res, 200, { notes: store.listNotes(user.id, { tag }).map(({ body, ...n }) => ({ ...n, preview: body.slice(0, 140) })) });
    }
    if (url.pathname === "/api/notes" && method === "POST") {
      const { error, value } = validateNote(await readJson(req), { requireTitle: true });
      if (error) throw new HttpError(400, error);
      if (store.countNotes(user.id) >= MAX_NOTES_PER_USER) throw new HttpError(400, `You can keep up to ${MAX_NOTES_PER_USER} notes.`);
      return send(res, 201, { note: store.createNote(user.id, { title: value.title, body: value.body ?? "", tags: value.tags ?? [] }) });
    }

    if (url.pathname === "/api/search" && method === "GET") {
      if (!queryLimiter.allow(user.id)) throw new HttpError(429, "Too many searches. Wait a moment.");
      const { error, value } = validateText(url.searchParams.get("q"), LIMITS.query, "Search");
      if (error) throw new HttpError(400, error);
      return send(res, 200, { results: searchNotes(indexFor(user.id), value) });
    }

    if (url.pathname === "/api/ask" && method === "POST") {
      if (!queryLimiter.allow(user.id)) throw new HttpError(429, "Too many questions. Wait a moment.");
      const { error, value } = validateText((await readJson(req)).question, LIMITS.question, "Question");
      if (error) throw new HttpError(400, error);
      return send(res, 200, await ask(indexFor(user.id), value, provider));
    }

    const m = url.pathname.match(/^\/api\/notes\/([0-9a-f-]{36})$/);
    if (m) {
      const id = m[1];
      if (method === "GET") {
        const note = store.getNote(user.id, id);
        if (!note) throw new HttpError(404, "Note not found.");   // 404, not 403, so ids of other users' notes are not revealed
        return send(res, 200, { note });
      }
      if (method === "PATCH") {
        const { error, value } = validateNote(await readJson(req), { requireTitle: false });
        if (error) throw new HttpError(400, error);
        const note = store.updateNote(user.id, id, value);
        if (!note) throw new HttpError(404, "Note not found.");
        return send(res, 200, { note });
      }
      if (method === "DELETE") {
        if (!store.deleteNote(user.id, id)) throw new HttpError(404, "Note not found.");
        return send(res, 200, { ok: true });
      }
    }

    throw new HttpError(404, "Not found.");
  }

  async function handleStatic(req, res, url) {
    if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed.");
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, "Bad path."); }
    if (rel.includes("\0")) throw new HttpError(400, "Bad path.");
    if (rel === "/") rel = "/index.html";
    // Path traversal defense: resolve, then confirm the result is still inside the public folder.
    const full = normalize(join(PUBLIC_DIR, rel));
    if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + sep)) throw new HttpError(404, "Not found.");
    try {
      const file = await readFile(full);
      send(res, 200, file, { "Content-Type": MIME[extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
    } catch { throw new HttpError(404, "Not found."); }
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      else await handleStatic(req, res, url);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error("Unhandled error:", e.message); // never send internals to the client
      send(res, 500, { error: "Something went wrong." });
    }
  });
}

// Start only when run directly (node server.js), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3300;
  const file = process.env.DATA_FILE || join(__dirname, "data", "db.json");
  createApp({
    store: createStore(file),
    secureCookies: process.env.COOKIE_SECURE === "1",
    // Rate limits can be raised for automated test runs only; the defaults apply otherwise.
    limits: { loginMax: Number(process.env.LOGIN_MAX) || undefined, signupMax: Number(process.env.SIGNUP_MAX) || undefined },
  })
    .listen(port, "127.0.0.1", () => console.log(`Notes running at http://localhost:${port}`));
}
