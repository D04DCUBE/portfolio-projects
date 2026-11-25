// The screen's only connection to the machine. It holds the last snapshot the machine sent
// and nothing else about the domain. A reload or a reconnect replaces it with the truth.
import type { Command, MachineState, RejectReason } from "../contract.gen.ts";
import { parseServerMessage } from "../shared/commands.ts";

export type Connection = "connecting" | "open" | "closed";
export type Rejection = { readonly command: string; readonly reason: RejectReason; readonly n: number };
export type Snapshot = { readonly connection: Connection; readonly state: MachineState | null; readonly rejection: Rejection | null };

// Method-style declaration keeps handler parameters bivariant, so the browser's WebSocket fits.
type Handler<E> = { bivarianceHack(e: E): void }["bivarianceHack"];
export type WebSocketLike = {
  onopen: Handler<unknown> | null;
  onmessage: Handler<{ data: unknown }> | null;
  onclose: Handler<unknown> | null;
  onerror: Handler<unknown> | null;
  readonly readyState: number;
  send(data: string): void;
  close(): void;
};

export type Store = {
  subscribe(fn: () => void): () => void;
  get(): Snapshot;
  send(cmd: Command): boolean;
  clearRejection(): void;
  close(): void;
};

export function createStore(open: () => WebSocketLike, opts: { retryMs?: (attempt: number) => number } = {}): Store {
  const retryMs = opts.retryMs ?? ((n) => Math.min(5000, 500 * 2 ** n));
  let snap: Snapshot = { connection: "connecting", state: null, rejection: null };
  let ws: WebSocketLike | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let n = 0;
  const subs = new Set<() => void>();
  const set = (next: Partial<Snapshot>) => { snap = { ...snap, ...next }; for (const f of subs) f(); };

  const connect = () => {
    if (stopped) return;
    set({ connection: "connecting" });
    const s = open();
    ws = s;
    s.onopen = () => { attempt = 0; set({ connection: "open" }); };
    s.onmessage = (e) => {
      const m = parseServerMessage(String(e.data));
      if (!m) return;
      if (m.type === "snapshot") set({ state: m.state });
      else set({ rejection: { command: m.command, reason: m.reason, n: ++n } });
    };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      set({ connection: "closed" });
      if (!stopped) timer = setTimeout(connect, retryMs(attempt++));
    };
    s.onerror = () => { /* onclose follows */ };
  };
  connect();

  return {
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    get: () => snap,
    send(cmd) {
      if (!ws || snap.connection !== "open") return false;
      ws.send(JSON.stringify(cmd));
      return true;
    },
    clearRejection() { if (snap.rejection) set({ rejection: null }); },
    close() { stopped = true; if (timer) clearTimeout(timer); ws?.close(); },
  };
}
