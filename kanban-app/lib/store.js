// Storage layer. Everything the server needs from "the database" goes through this file,
// so swapping the JSON file for SQLite or Postgres later means rewriting only this module.
// Writes are atomic (write to a temp file, then rename) so a crash cannot corrupt the data.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const COLUMNS = ["todo", "doing", "done"];

export function createStore(file = null) {
  let data = { users: [], sessions: [], cards: [] };
  if (file && existsSync(file)) data = JSON.parse(readFileSync(file, "utf8"));

  function save() {
    if (!file) return; // in-memory mode (used by tests)
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  }

  const publicCard = ({ id, title, description, column, position, createdAt }) =>
    ({ id, title, description, column, position, createdAt });

  function renumber(userId, column) {
    data.cards
      .filter((c) => c.userId === userId && c.column === column)
      .sort((a, b) => a.position - b.position)
      .forEach((c, i) => (c.position = i));
  }

  return {
    // ---- users ----
    findUserByEmail: (email) => data.users.find((u) => u.email === email.toLowerCase()) || null,
    findUserById: (id) => data.users.find((u) => u.id === id) || null,
    createUser(email, passwordHash) {
      const user = { id: randomUUID(), email: email.toLowerCase(), passwordHash, createdAt: new Date().toISOString() };
      data.users.push(user);
      save();
      return user;
    },

    // ---- sessions (only a hash of the token is stored, never the token itself) ----
    createSession(userId, tokenHash, expiresAt) {
      data.sessions.push({ tokenHash, userId, expiresAt });
      save();
    },
    findSession(tokenHash) {
      const now = Date.now();
      const s = data.sessions.find((x) => x.tokenHash === tokenHash);
      if (!s) return null;
      if (s.expiresAt <= now) { this.deleteSession(tokenHash); return null; }
      return s;
    },
    deleteSession(tokenHash) {
      data.sessions = data.sessions.filter((s) => s.tokenHash !== tokenHash);
      save();
    },

    // ---- cards. Every function takes userId so one user can never touch another's data ----
    listCards(userId) {
      return data.cards
        .filter((c) => c.userId === userId)
        .sort((a, b) => COLUMNS.indexOf(a.column) - COLUMNS.indexOf(b.column) || a.position - b.position)
        .map(publicCard);
    },
    createCard(userId, { title, description, column }) {
      const position = data.cards.filter((c) => c.userId === userId && c.column === column).length;
      const card = { id: randomUUID(), userId, title, description, column, position, createdAt: new Date().toISOString() };
      data.cards.push(card);
      save();
      return publicCard(card);
    },
    updateCard(userId, id, { title, description }) {
      const card = data.cards.find((c) => c.id === id && c.userId === userId);
      if (!card) return null;
      if (title !== undefined) card.title = title;
      if (description !== undefined) card.description = description;
      save();
      return publicCard(card);
    },
    moveCard(userId, id, column, index) {
      const card = data.cards.find((c) => c.id === id && c.userId === userId);
      if (!card) return null;
      const from = card.column;
      const target = data.cards
        .filter((c) => c.userId === userId && c.column === column && c.id !== id)
        .sort((a, b) => a.position - b.position);
      const at = Math.max(0, Math.min(index, target.length));
      target.splice(at, 0, card);
      card.column = column;
      target.forEach((c, i) => (c.position = i));
      if (from !== column) renumber(userId, from);
      save();
      return publicCard(card);
    },
    deleteCard(userId, id) {
      const card = data.cards.find((c) => c.id === id && c.userId === userId);
      if (!card) return false;
      data.cards = data.cards.filter((c) => c !== card);
      renumber(userId, card.column);
      save();
      return true;
    },

    // For tests only: lets a test confirm that no plaintext password is stored.
    _dumpForTests: () => JSON.stringify(data),
  };
}
