// A WebSocket that reconnects. Browsers do not do this for you: when the connection drops, you get a close event
// and nothing else. This wrapper adds:
//   - exponential backoff with full jitter, so a server restart does not get a thundering herd of simultaneous retries
//   - a heartbeat: if the server stays silent after our ping, the connection is half-dead, so we drop and retry
//   - immediate retry when the browser says it is back online
//   - states for the UI: connecting, open, reconnecting (with the attempt number and delay), offline, closed

export const BACKOFF = { base: 500, cap: 15_000 };

// Full jitter: pick a random delay between 0 and min(cap, base * 2^attempt). Never less than 250 ms so a fast
// failure loop cannot hammer the server.
export function backoffDelay(attempt, rand = Math.random) {
  const ceiling = Math.min(BACKOFF.cap, BACKOFF.base * 2 ** attempt);
  return Math.max(250, Math.floor(rand() * ceiling));
}

export function createSocket({ url, onOpen, onMessage, onState, WS = WebSocket, heartbeatMs = 20_000, silenceMs = 10_000, rand = Math.random }) {
  let ws = null, attempt = 0, retryTimer = null, pingTimer = null, silenceTimer = null, waiting = false, wantOpen = true, state = "connecting";

  const setState = (s, detail = {}) => { state = s; onState?.({ state: s, ...detail }); };

  function heartbeat() {
    clearInterval(pingTimer); clearTimeout(silenceTimer);
    pingTimer = setInterval(() => {
      if (ws?.readyState !== 1) return;
      ws.send(JSON.stringify({ t: "ping" }));
      if (waiting) return;                                       // already counting down from an earlier unanswered ping
      waiting = true;
      silenceTimer = setTimeout(() => ws?.close(), silenceMs);   // no reply of any kind: treat as dead; close handler retries
    }, heartbeatMs);
  }

  function connect() {
    clearTimeout(retryTimer);
    setState(attempt === 0 ? "connecting" : "reconnecting", { attempt });
    ws = new WS(url);
    const mine = ws;
    ws.addEventListener("open", () => { if (mine !== ws) return; attempt = 0; setState("open"); heartbeat(); onOpen?.(); });
    ws.addEventListener("message", (e) => {
      if (mine !== ws) return;
      clearTimeout(silenceTimer); waiting = false;                 // anything from the server proves the link is alive
      let m; try { m = JSON.parse(e.data); } catch { return; }
      onMessage?.(m);
    });
    ws.addEventListener("close", () => {
      if (mine !== ws) return;
      clearInterval(pingTimer); clearTimeout(silenceTimer); waiting = false;
      if (!wantOpen) return setState("closed");
      if (typeof navigator !== "undefined" && navigator.onLine === false) return setState("offline");   // 'online' event will retry
      const delay = backoffDelay(attempt++, rand);
      setState("reconnecting", { attempt, delay });
      retryTimer = setTimeout(connect, delay);
    });
  }

  const onlineHandler = () => { if (wantOpen && state !== "open") { attempt = 0; connect(); } };
  const offlineHandler = () => { if (state !== "open") return; /* the close event will follow */ };
  if (typeof window !== "undefined") { window.addEventListener("online", onlineHandler); window.addEventListener("offline", offlineHandler); }
  connect();

  return {
    get state() { return state; },
    send(obj) { if (ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; },
    close() {
      wantOpen = false; clearTimeout(retryTimer); clearInterval(pingTimer); clearTimeout(silenceTimer);
      if (typeof window !== "undefined") window.removeEventListener("online", onlineHandler);
      ws?.close(1000, "bye"); if (!ws || ws.readyState > 1) setState("closed");
    },
  };
}
