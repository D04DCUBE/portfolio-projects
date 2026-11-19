// Storage layer. The JSON file can be swapped for SQLite or Postgres by rewriting only this module.
// Writes are atomic (write a temp file, then rename), so a crash cannot leave a half-written database.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_NOTES_PER_USER = 500;

export function createStore(file = null) {
  let data = { users: [], sessions: [], notes: [] };
  if (file && existsSync(file)) data = JSON.parse(readFileSync(file, "utf8"));
  const versions = new Map();   // userId -> number, bumped on every change; lets callers cache anything derived from a user's notes

  function save() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  }
  const bump = (userId) => versions.set(userId, (versions.get(userId) ?? 0) + 1);
  const pub = ({ id, title, body, tags, createdAt, updatedAt }) => ({ id, title, body, tags: [...tags], createdAt, updatedAt });

  return {
    findUserByEmail: (email) => data.users.find((u) => u.email === email.toLowerCase()) || null,
    findUserById: (id) => data.users.find((u) => u.id === id) || null,
    createUser(email, passwordHash) {
      const user = { id: randomUUID(), email: email.toLowerCase(), passwordHash, createdAt: new Date().toISOString() };
      data.users.push(user); save(); return user;
    },
    createSession(userId, tokenHash, expiresAt) { data.sessions.push({ tokenHash, userId, expiresAt }); save(); },
    findSession(tokenHash) {
      const s = data.sessions.find((x) => x.tokenHash === tokenHash);
      if (!s) return null;
      if (s.expiresAt <= Date.now()) { this.deleteSession(tokenHash); return null; }
      return s;
    },
    deleteSession(tokenHash) { data.sessions = data.sessions.filter((s) => s.tokenHash !== tokenHash); save(); },

    // ---- notes. Every function takes userId, so one user can never reach another user's notes.
    version: (userId) => versions.get(userId) ?? 0,
    countNotes: (userId) => data.notes.filter((n) => n.userId === userId).length,
    listNotes(userId, { tag } = {}) {
      return data.notes.filter((n) => n.userId === userId && (!tag || n.tags.includes(tag)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).map(pub);
    },
    getNote(userId, id) { const n = data.notes.find((x) => x.id === id && x.userId === userId); return n ? pub(n) : null; },
    createNote(userId, { title, body, tags }) {
      const now = new Date().toISOString();
      const note = { id: randomUUID(), userId, title, body, tags, createdAt: now, updatedAt: now };
      data.notes.push(note); bump(userId); save(); return pub(note);
    },
    updateNote(userId, id, fields) {
      const n = data.notes.find((x) => x.id === id && x.userId === userId);
      if (!n) return null;
      for (const k of ["title", "body", "tags"]) if (fields[k] !== undefined) n[k] = fields[k];
      n.updatedAt = new Date().toISOString();
      bump(userId); save(); return pub(n);
    },
    deleteNote(userId, id) {
      const before = data.notes.length;
      data.notes = data.notes.filter((n) => !(n.id === id && n.userId === userId));
      if (data.notes.length === before) return false;
      bump(userId); save(); return true;
    },
    _dumpForTests: () => JSON.stringify(data),
  };
}
