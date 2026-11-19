import net from "node:net";
import { randomBytes } from "node:crypto";
import { createApp } from "../server.js";
import { createHub } from "../lib/hub.js";
import { acceptKey } from "../lib/ws.js";

export async function startServer(opts = {}) {
  const server = createApp({ hub: createHub(opts.hub), ...opts.app });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return { server, port, url: `ws://127.0.0.1:${port}/ws`, http: `http://127.0.0.1:${port}`,
    stop() { server.closeAllConnections(); server.close(); } };
}

// A WebSocket client (Node's built-in) with a queue so tests can await the next matching message.
export function client(url) {
  const ws = new WebSocket(url);
  const queue = [], waiters = [];
  const closed = new Promise((resolve) => ws.addEventListener("close", (e) => resolve(e)));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else queue.push(m);
  });
  const c = {
    ws, closed, queue,
    opened: new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", () => reject(new Error("socket error"))); }),
    send: (o) => ws.send(typeof o === "string" ? o : JSON.stringify(o)),
    next(pred = () => true, ms = 2000) {
      const i = queue.findIndex(pred);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => { const j = waiters.indexOf(w); if (j >= 0) { waiters.splice(j, 1); reject(new Error("timed out waiting for message")); } }, ms);
      });
    },
    nextOf: (t, ms) => c.next((m) => m.t === t, ms),
    async join(name, room = "lobby", extra = {}) { await c.opened; c.send({ t: "join", name, room, ...extra }); return c.nextOf("joined"); },
    close: () => ws.close(),
  };
  return c;
}
export const quiet = (c, ms = 150) => new Promise((r) => setTimeout(r, ms)).then(() => c.queue.splice(0));

// ---- raw socket client for protocol-level tests (frames, headers)
export function rawClient(port, { origin, path = "/ws", key = randomBytes(16).toString("base64"), skipHandshake = false } = {}) {
  const sock = net.connect(port, "127.0.0.1");
  let buf = Buffer.alloc(0);
  const frames = []; let head = null;
  const waiters = [];
  const flush = () => { for (const w of [...waiters]) { const i = frames.findIndex(w.pred); if (i >= 0) { waiters.splice(waiters.indexOf(w), 1); w.resolve(frames.splice(i, 1)[0]); } } };
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (!head) {
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      head = buf.subarray(0, end).toString(); buf = buf.subarray(end + 4);
      headWaiters.splice(0).forEach((r) => r(head));
    }
    while (buf.length >= 2) {   // server frames are unmasked
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
      if (buf.length < off + len) break;
      frames.push({ opcode: buf[0] & 0x0f, fin: !!(buf[0] & 0x80), payload: buf.subarray(off, off + len) });
      buf = buf.subarray(off + len);
    }
    flush();
  });
  const headWaiters = [];
  const closed = new Promise((r) => sock.on("close", r));
  if (!skipHandshake) {
    sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${origin ? `Origin: ${origin}\r\n` : ""}\r\n`);
  }
  const r = {
    sock, key, closed,
    head: () => head ? Promise.resolve(head) : new Promise((res) => headWaiters.push(res)),
    nextFrame: (pred = () => true, ms = 2000) => new Promise((resolve, reject) => {
      const i = frames.findIndex(pred);
      if (i >= 0) return resolve(frames.splice(i, 1)[0]);
      const w = { pred, resolve }; waiters.push(w);
      setTimeout(() => { const j = waiters.indexOf(w); if (j >= 0) { waiters.splice(j, 1); reject(new Error("no frame")); } }, ms);
    }),
    // build a masked client frame. opts: fin, mask(false to violate the protocol), rsv
    frame(opcode, payload, { fin = true, mask = true, rsv = 0 } = {}) {
      const p = Buffer.from(payload);
      let h;
      const mbit = mask ? 0x80 : 0;
      if (p.length < 126) h = Buffer.from([(fin ? 0x80 : 0) | rsv | opcode, mbit | p.length]);
      else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = (fin ? 0x80 : 0) | rsv | opcode; h[1] = mbit | 126; h.writeUInt16BE(p.length, 2); }
      else { h = Buffer.alloc(10); h[0] = (fin ? 0x80 : 0) | rsv | opcode; h[1] = mbit | 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
      if (!mask) return Buffer.concat([h, p]);
      const m = randomBytes(4); const body = Buffer.from(p);
      for (let i = 0; i < body.length; i++) body[i] ^= m[i & 3];
      return Buffer.concat([h, m, body]);
    },
    write: (b) => sock.write(b),
    end: () => sock.destroy(),
  };
  return r;
}
export const closeCode = (f) => f.payload.readUInt16BE(0);
export { acceptKey };
