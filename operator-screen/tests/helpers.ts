import type { APIRequestContext } from "playwright/test";
import type { MachineState, ServerMessage } from "../src/contract.gen.ts";

export async function reset(request: APIRequestContext) {
  const r = await request.post("/sim/reset", { data: {} });
  if (!r.ok()) throw new Error(`reset failed: ${r.status()}`);
}
export async function sim(request: APIRequestContext, action: string, data: Record<string, unknown> = {}) {
  const r = await request.post(`/sim/${action}`, { data });
  if (!r.ok()) throw new Error(`${action} failed: ${r.status()}`);
}
export async function machine(request: APIRequestContext): Promise<MachineState> {
  return (await (await request.get("/sim/state")).json()) as MachineState;
}

// A WebSocket client for protocol tests: collects messages and waits for the next one that matches.
export type WsClient = {
  next(pred?: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  send(v: unknown): void;
  close(): void;
};
export async function connect(baseURL: string): Promise<WsClient> {
  const ws = new WebSocket(baseURL.replace(/^http/, "ws") + "/ws");
  const inbox: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.onmessage = (e) => { inbox.push(JSON.parse(String(e.data)) as ServerMessage); waiters.shift()?.(); };
  await new Promise<void>((ok, bad) => { ws.onopen = () => ok(); ws.onerror = () => bad(new Error("ws error")); });
  return {
    async next(pred = () => true, timeoutMs = 5000) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const i = inbox.findIndex(pred);
        if (i >= 0) return inbox.splice(i, 1)[0]!;
        const left = end - Date.now();
        if (left <= 0) throw new Error("timed out waiting for a message");
        await new Promise<void>((ok) => { waiters.push(ok); setTimeout(ok, left); });
      }
    },
    send: (v) => ws.send(typeof v === "string" ? v : JSON.stringify(v)),
    close: () => ws.close(),
  };
}
export const snapshot = (m: ServerMessage): MachineState => {
  if (m.type !== "snapshot") throw new Error(`expected a snapshot, got ${m.type}`);
  return m.state;
};
