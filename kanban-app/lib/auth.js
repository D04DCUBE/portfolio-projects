// Password hashing, session tokens, cookies and a tiny rate limiter. Node built-ins only.

import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

// scrypt is a memory-hard password hash. A unique random salt per user means identical
// passwords produce different hashes. Format: scrypt$<salt hex>$<hash hex>
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected); // constant-time compare
}

// Used when the email does not exist, so a missing user takes as long as a wrong password.
export const DUMMY_HASH = hashPassword("not-a-real-password");

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) => createHash("sha256").update(token).digest("hex");

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { maxAgeSeconds, secure }) {
  // HttpOnly: JavaScript cannot read it (limits XSS damage). SameSite=Strict: not sent on cross-site requests (limits CSRF).
  return [`sid=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`, secure ? "Secure" : ""]
    .filter(Boolean).join("; ");
}
export const clearCookie = (secure) =>
  ["sid=", "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0", secure ? "Secure" : ""].filter(Boolean).join("; ");

// Fixed-window limiter, in memory. Fine for one server process. A real deployment would use a shared store (Redis).
export function createLimiter(max, windowMs) {
  const hits = new Map();
  return {
    allow(key) {
      const now = Date.now();
      const e = hits.get(key);
      if (!e || e.resetAt <= now) { hits.set(key, { count: 1, resetAt: now + windowMs }); return true; }
      e.count += 1;
      return e.count <= max;
    },
    reset(key) { hits.delete(key); },
  };
}
