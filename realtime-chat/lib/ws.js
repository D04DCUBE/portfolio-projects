// A small WebSocket server layer (RFC 6455), written by hand so every step is visible. No dependencies.
//
//   1. Handshake: the browser sends an HTTP GET with "Upgrade: websocket" and a random Sec-WebSocket-Key.
//      We answer 101 with Sec-WebSocket-Accept = base64(sha1(key + GUID)), and the TCP socket becomes a message pipe.
//   2. Frames: after that, data travels in frames: 2+ header bytes, an optional extended length, a 4-byte mask
//      (clients must mask, servers must not), then the payload.
//   3. We handle text, ping/pong and close, reassemble fragmented messages, and close with the right code on abuse.

import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };
export const CLOSE = { NORMAL: 1000, GOING_AWAY: 1001, PROTOCOL: 1002, UNSUPPORTED: 1003, BAD_DATA: 1007, POLICY: 1008, TOO_BIG: 1009 };

export function acceptKey(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);   // FIN set, never masked (server to client)
}

// Check an upgrade request. Returns null if fine, or [status, message] to refuse it.
// allowOrigin guards against cross-site WebSocket hijacking: browsers do not apply the same-origin policy to
// WebSockets, so any website could open a socket to us using the visitor's network position unless we check Origin.
export function checkUpgrade(req, { allowOrigin }) {
  if (req.method !== "GET") return [405, "Method Not Allowed"];
  if ((req.headers.upgrade || "").toLowerCase() !== "websocket" || !/upgrade/i.test(req.headers.connection || "")) return [400, "Expected a WebSocket upgrade"];
  if (req.headers["sec-websocket-version"] !== "13") return [426, "Unsupported WebSocket version"];
  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || Buffer.from(key, "base64").length !== 16) return [400, "Bad Sec-WebSocket-Key"];
  if (!allowOrigin(req.headers.origin, req)) return [403, "Origin not allowed"];
  return null;
}

export function refuse(socket, [status, message]) {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

// Take over the socket after a valid upgrade. Returns a connection with send(), close(), and callbacks.
export function accept(req, socket, { maxMessage = 16 * 1024, onMessage, onClose } = {}) {
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${acceptKey(req.headers["sec-websocket-key"])}\r\n\r\n`,
  );
  socket.setNoDelay(true);

  let buffer = Buffer.alloc(0);
  let fragments = null;          // pieces of a fragmented text message in progress
  let fragmentBytes = 0;
  let closed = false, closeSent = false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const conn = {
    alive: true,                 // set false by the heartbeat sweep, back to true on pong
    send(text) { if (!closed && !closeSent) socket.write(encodeFrame(OP.TEXT, Buffer.from(text, "utf8"))); },
    ping() { if (!closed && !closeSent) socket.write(encodeFrame(OP.PING, Buffer.alloc(0))); },
    close(code = CLOSE.NORMAL, reason = "") {
      if (closed || closeSent) return;
      closeSent = true;
      const r = Buffer.from(reason.slice(0, 100), "utf8");
      const body = Buffer.alloc(2 + r.length); body.writeUInt16BE(code, 0); r.copy(body, 2);
      socket.write(encodeFrame(OP.CLOSE, body));
      setTimeout(() => socket.destroy(), 1000).unref();   // do not wait forever for the peer's close reply
    },
    terminate() { socket.destroy(); },
  };

  let failed = false;
  const fail = (code, reason) => { failed = true; conn.close(code, reason); buffer = Buffer.alloc(0); };

  function onFrame(fin, opcode, payload) {
    // After we sent our close, the only thing left to read is the peer's close reply, which completes the handshake.
    if (closeSent) { if (opcode === OP.CLOSE) socket.end(); return; }
    if (opcode === OP.PING) { if (!closeSent) socket.write(encodeFrame(OP.PONG, payload)); return; }
    if (opcode === OP.PONG) { conn.alive = true; return; }
    if (opcode === OP.CLOSE) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : CLOSE.NORMAL;
      conn.close(code === 1005 || code < 1000 ? CLOSE.NORMAL : code);   // echo the close...
      socket.end();                                                      // ...and finish the closing handshake right away
      return;
    }
    if (opcode === OP.BINARY) return fail(CLOSE.UNSUPPORTED, "binary not supported");
    if (opcode !== OP.TEXT && opcode !== OP.CONT) return fail(CLOSE.PROTOCOL, "unknown opcode");
    if (opcode === OP.TEXT) {
      if (fragments) return fail(CLOSE.PROTOCOL, "new message inside a fragmented one");
      fragments = []; fragmentBytes = 0;
    } else if (!fragments) return fail(CLOSE.PROTOCOL, "unexpected continuation");
    fragmentBytes += payload.length;
    if (fragmentBytes > maxMessage) return fail(CLOSE.TOO_BIG, "message too big");
    fragments.push(payload);
    if (!fin) return;
    const whole = Buffer.concat(fragments); fragments = null;
    let text;
    try { text = decoder.decode(whole); } catch { return fail(CLOSE.BAD_DATA, "invalid UTF-8"); }
    onMessage?.(text);
  }

  function parse() {
    while (!failed && buffer.length >= 2) {
      const b0 = buffer[0], b1 = buffer[1];
      const fin = (b0 & 0x80) !== 0, rsv = b0 & 0x70, opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, offset = 2;
      if (rsv) return fail(CLOSE.PROTOCOL, "reserved bits set");
      if (!masked) return fail(CLOSE.PROTOCOL, "client frames must be masked");
      if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(maxMessage)) return fail(CLOSE.TOO_BIG, "frame too big");
        len = Number(big); offset = 10;
      }
      const isControl = opcode >= 0x8;
      if (isControl && (!fin || len > 125)) return fail(CLOSE.PROTOCOL, "bad control frame");
      if (len > maxMessage) return fail(CLOSE.TOO_BIG, "frame too big");   // checked before buffering the payload
      if (buffer.length < offset + 4 + len) return;                        // wait for the rest
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];  // unmask
      buffer = buffer.subarray(offset + 4 + len);
      onFrame(fin, opcode, payload);
    }
  }

  socket.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); parse(); });
  const finish = () => { if (!closed) { closed = true; onClose?.(); } };
  socket.on("close", finish);
  socket.on("error", () => socket.destroy());
  socket.on("end", () => socket.end());
  return conn;
}
