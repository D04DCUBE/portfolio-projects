// A small WebSocket server (RFC 6455): handshake, text frames, ping/pong, close.
// Enough for JSON messages up to 64 KB. No extensions, no fragmentation, no binary.
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PAYLOAD = 64 * 1024;

export type Socket = {
  send(text: string): void;
  close(code?: number): void;
  readonly alive: boolean;
};

export function acceptKey(key: string): string {
  return createHash("sha1").update(key + GUID).digest("base64");
}

export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let head: Buffer;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else throw new Error("payload too large");
  return Buffer.concat([head, payload]);
}

export type Frame = { readonly opcode: number; readonly payload: Buffer };

// Returns parsed frames and the unread remainder. Throws on protocol violations.
export function decodeFrames(buf: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off]!;
    const b1 = buf[off + 1]!;
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (!fin) throw new Error("fragmented frames are not supported");
    if (!masked) throw new Error("client frames must be masked");
    if (len === 126) { if (buf.length - p < 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) throw new Error("payload too large");
    if (len > MAX_PAYLOAD) throw new Error("payload too large");
    if (buf.length - p < 4 + len) break;
    const mask = buf.subarray(p, p + 4);
    p += 4;
    const payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = buf[p + i]! ^ mask[i % 4]!;
    frames.push({ opcode, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

export function upgrade(
  req: IncomingMessage,
  socket: Duplex,
  handlers: { onOpen(s: Socket): void; onMessage(s: Socket, text: string): void; onClose(s: Socket): void },
): void {
  const key = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || typeof key !== "string" || req.headers["sec-websocket-version"] !== "13") {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  let alive = true;
  let pending: Buffer = Buffer.alloc(0);
  const api: Socket = {
    get alive() { return alive; },
    send(text) { if (alive) socket.write(encodeFrame(0x1, Buffer.from(text))); },
    close(code = 1000) {
      if (!alive) return;
      const p = Buffer.alloc(2); p.writeUInt16BE(code);
      socket.write(encodeFrame(0x8, p));
      alive = false;
      socket.end();
    },
  };
  const finish = () => { if (alive) { alive = false; } handlers.onClose(api); };
  socket.on("data", (chunk: Buffer) => {
    try {
      const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const f of frames) {
        if (f.opcode === 0x1) handlers.onMessage(api, f.payload.toString("utf8"));
        else if (f.opcode === 0x9) socket.write(encodeFrame(0xa, f.payload));
        else if (f.opcode === 0x8) { api.close(1000); }
      }
    } catch {
      api.close(1002);
    }
  });
  socket.on("close", finish);
  socket.on("error", finish);
  handlers.onOpen(api);
}
