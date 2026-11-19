// Chat rooms, presence, history and resume. No sockets in here: a connection is anything with send/close/terminate,
// so the whole thing is testable without a network.
import { randomBytes } from "node:crypto";
import { CLOSE } from "./ws.js";

const NAME = /^[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;   // words separated by single spaces, no leading or trailing space
export const validName = (n) => typeof n === "string" && n.length >= 2 && n.length <= 20 && NAME.test(n);
export const validRoom = (r) => typeof r === "string" && /^[a-z0-9-]{1,24}$/.test(r);

export function createHub({ historySize = 200, sendHistory = 50, maxRooms = 100, maxUsers = 50, maxText = 1000, rate = { events: 10, windowMs: 3000 }, now = Date.now } = {}) {
  const rooms = new Map();   // name -> { name, members: Map(name -> member), history: [], seq, cids: Map }

  function room(name) {
    let r = rooms.get(name);
    if (r) return r;
    if (rooms.size >= maxRooms) {                       // evict the oldest empty room, else refuse
      const empty = [...rooms.values()].find((x) => x.members.size === 0);
      if (!empty) return null;
      rooms.delete(empty.name);
    }
    r = { name, members: new Map(), history: [], seq: 0, cids: new Map() };
    rooms.set(name, r);
    return r;
  }

  const send = (conn, obj) => conn.send(JSON.stringify(obj));
  const users = (r) => [...r.members.keys()].sort((a, b) => a.localeCompare(b));
  function broadcast(r, obj, except) {
    const text = JSON.stringify(obj);
    for (const m of r.members.values()) if (m !== except) m.conn.send(text);
  }

  function connect(conn) {
    const session = { conn, room: null, name: null, token: null, stamps: [] };

    const error = (code, message) => send(conn, { t: "error", code, message });
    const limited = () => {
      const t = now();
      session.stamps = session.stamps.filter((s) => t - s < rate.windowMs);
      session.stamps.push(t);
      return session.stamps.length > rate.events;
    };

    function join(m) {
      if (session.room) return error("already_joined", "Already in a room.");
      if (!validName(m.name)) return error("bad_name", "Name must be 2-20 letters, numbers, spaces, dots, dashes or underscores.");
      if (!validRoom(m.room)) return error("bad_room", "Room must be 1-24 characters: a-z, 0-9 and dashes.");
      const r = room(m.room);
      if (!r) return error("busy", "The server has too many active rooms. Try again later.");
      const existing = r.members.get(m.name);
      let reclaimed = false;
      if (existing) {
        // The same person coming back before the server noticed the old socket died. Prove it with the token.
        if (typeof m.token === "string" && m.token === existing.token) {
          reclaimed = true;
          existing.conn.close(CLOSE.NORMAL, "replaced");
          existing.replaced = true;
        } else return error("name_taken", "That name is already in use in this room.");
      } else if (r.members.size >= maxUsers) return error("room_full", "This room is full.");

      session.room = r; session.name = m.name;
      session.token = reclaimed ? existing.token : randomBytes(16).toString("hex");
      r.members.set(m.name, session);

      // Resume: if the client says what it last saw and we still have everything after it, send only what it missed.
      const since = Number.isInteger(m.since) ? m.since : null;
      const oldest = r.history.length ? r.history[0].id : r.seq + 1;
      const canResume = since !== null && since >= oldest - 1 && since <= r.seq;
      const messages = canResume ? r.history.filter((x) => x.id > since) : r.history.slice(-sendHistory);
      send(conn, { t: "joined", room: r.name, you: m.name, token: session.token, users: users(r), messages, reset: !canResume, last: r.seq });
      if (!reclaimed) broadcast(r, { t: "system", text: `${m.name} joined` }, session);
      broadcast(r, { t: "presence", users: users(r) }, session);
    }

    function message(m) {
      if (!session.room) return error("not_joined", "Join a room first.");
      const text = typeof m.text === "string" ? m.text.trim() : "";
      if (!text || text.length > maxText) return error("bad_text", `Messages must be 1-${maxText} characters.`);
      const cid = typeof m.cid === "string" && m.cid.length <= 40 ? m.cid : null;
      const r = session.room;
      const key = cid && `${session.name}|${cid}`;
      if (key && r.cids.has(key)) {                    // a resend after reconnect: acknowledge again, do not post twice
        const id = r.cids.get(key);
        return send(conn, { t: "ack", cid, msg: r.history.find((x) => x.id === id) ?? { id } });
      }
      const msg = { id: ++r.seq, name: session.name, text, ts: now() };
      r.history.push(msg);
      if (r.history.length > historySize) r.history.shift();
      if (key) { r.cids.set(key, msg.id); if (r.cids.size > 1000) r.cids.delete(r.cids.keys().next().value); }
      broadcast(r, { t: "msg", ...msg }, session);
      send(conn, { t: "ack", cid, msg });
    }

    function leave() {
      const r = session.room;
      if (!r) return;
      session.room = null;
      if (r.members.get(session.name) === session) {
        r.members.delete(session.name);
        broadcast(r, { t: "typing", name: session.name, on: false });
        if (!session.replaced) broadcast(r, { t: "system", text: `${session.name} left` });
        broadcast(r, { t: "presence", users: users(r) });
      }
    }

    return {
      onMessage(text) {
        let m;
        try { m = JSON.parse(text); } catch { return error("bad_json", "Messages must be JSON."); }
        if (!m || typeof m !== "object" || typeof m.t !== "string") return error("bad_message", "Missing message type.");
        if (m.t === "ping") return send(conn, { t: "pong" });
        if (limited()) return error("rate_limited", "Slow down.");
        switch (m.t) {
          case "join": return join(m);
          case "msg": return message(m);
          case "typing":
            if (session.room) broadcast(session.room, { t: "typing", name: session.name, on: m.on === true }, session);
            return;
          case "leave": return conn.close(CLOSE.NORMAL, "bye");
          default: return error("unknown_type", "Unknown message type.");
        }
      },
      onClose() {
        // A replaced session must not remove the member that replaced it.
        const r = session.room;
        if (r && r.members.get(session.name) !== session) { session.room = null; return; }
        leave();
      },
    };
  }

  return { connect, stats: () => ({ rooms: rooms.size, users: [...rooms.values()].reduce((n, r) => n + r.members.size, 0) }) };
}
