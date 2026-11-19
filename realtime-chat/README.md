# Realtime Chat

Rooms, presence, typing indicators and message history over WebSockets, in plain Node and browser JavaScript with **no dependencies**. Node has no built-in WebSocket server, so the protocol layer (RFC 6455) is written by hand in `lib/ws.js`.

```
cd projects/realtime-chat
node server.js        # http://localhost:3200 (open it in two windows)
npm test              # 37 tests
```

## Layout

| File | Job |
| --- | --- |
| `lib/ws.js` | Handshake, frame parsing and encoding, ping/pong, close codes. Knows nothing about chat. |
| `lib/hub.js` | Rooms, names, presence, history, resume, rate limit. Knows nothing about sockets, so it is testable alone. |
| `server.js` | HTTP for the page, the `/ws` upgrade, origin check, heartbeat sweep. |
| `public/js/socket.js` | A WebSocket that reconnects: backoff with jitter, heartbeat, online/offline handling. |
| `public/app.js` | The UI: join screen, message log, presence list, optimistic sending. |

## How it works

**Handshake.** The browser sends an HTTP GET with `Upgrade: websocket` and a random key. The server replies `101` with `base64(sha1(key + GUID))` and the TCP socket becomes a message pipe. A test checks the accept function against the example in the RFC.

**Frames.** A frame has a 2-byte header, an optional 16- or 64-bit length, a 4-byte mask (clients must mask, servers must not), and the payload. The parser handles text, ping/pong and close, joins fragmented messages, and closes with the right code on abuse: unmasked frame or reserved bits (1002), binary (1003), invalid UTF-8 (1007), too big (1009). The size limit is checked from the header, before the payload is buffered, so a client cannot make the server allocate memory by lying about length.

**Protocol (JSON).** Client sends `join`, `msg`, `typing`, `leave`, `ping`. Server sends `joined`, `msg`, `ack`, `presence`, `typing`, `system`, `error`, `pong`.

**Reconnect and resume.** Every message gets an increasing id per room. The client remembers the last id it saw and sends it as `since` when it rejoins. If the server still has everything after that id, it sends only what was missed; otherwise it sends recent history and tells the client to reset.

**No lost or doubled messages.** A sent message appears at once as "Sending…" with a random `cid`. The server acknowledges with the stored message. If the connection drops first, the client resends with the same `cid` after rejoining, and the server recognises it and does not post it twice.

**Reclaiming a name.** There are no accounts. The first join gets a random token. After a drop, the same person presents the token to take their name back, even before the server has noticed the old socket is dead. Without the token, a taken name is refused.

**Heartbeat.** The server pings every 15 s and drops connections that did not answer, so presence has no ghosts. The client sends its own app-level ping and reconnects if the server stays silent, because browsers do not expose protocol pings to JavaScript.

## Security notes

- **Origin check.** Browsers do not apply the same-origin policy to WebSockets, so without checking `Origin` any website could open a socket to this server from a visitor's browser. Browser requests must come from this page's own host (or `ALLOWED_ORIGINS`).
- **Output is text.** Messages are rendered with `textContent`. HTML in a message is shown, not run. CSP (`script-src 'self'`, `connect-src 'self'`) is a second layer.
- **Limits.** 16 KB per frame, 1000 characters per message, 10 events per 3 seconds per connection, 50 users per room, 100 rooms, 500 connections.
- **Validation.** Names and rooms are checked against a strict pattern on the server; every message type is checked before use.

## Limits (honest list)

- State is in memory. A restart clears rooms and history (clients reconnect and are told to reset).
- No accounts. The token stops casual impersonation while someone is connected, but a name is free once its owner has gone, and anyone can then take it.
- Single process. Scaling to several servers would need a shared pub/sub (for example Redis) so rooms span machines.
- No compression (`permessage-deflate`), no subprotocols, no TLS here. In production, put it behind a TLS-terminating proxy so the browser uses `wss://`.
