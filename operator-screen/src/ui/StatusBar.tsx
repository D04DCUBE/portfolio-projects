import type { MachineState } from "../contract.gen.ts";
import type { Connection } from "./store.ts";
import { Pill } from "./parts.tsx";

// Layer 1: ambient. Always visible, asks for nothing.
export function StatusBar(props: { state: MachineState | null; connection: Connection }) {
  const { state, connection } = props;
  return (
    <header className="flex items-center gap-gap border-b border-line bg-surface px-6 py-3">
      <h1 className="mr-auto text-glance font-bold">Unit 07</h1>
      {state ? (
        state.health.status === "ok" ? <Pill tone="ok">● Machine OK</Pill> : <Pill tone="danger">▲ Fault {state.health.code}</Pill>
      ) : null}
      {state ? <Pill tone={state.drawer === "open" ? "warn" : "muted"}>{state.drawer === "open" ? "Drawer open" : "Drawer closed"}</Pill> : null}
      {connection !== "open" ? <Pill tone="warn">{connection === "connecting" ? "Connecting…" : "Reconnecting…"}</Pill> : null}
      {state?.session ? <Pill tone="muted">{state.session.user}</Pill> : null}
    </header>
  );
}
