import { useEffect, useState, useSyncExternalStore } from "react";
import type { Command } from "../contract.gen.ts";
import { interruptions } from "../shared/interrupts.ts";
import type { Store } from "./store.ts";
import { REJECT_TEXT } from "./text.ts";
import { StatusBar } from "./StatusBar.tsx";
import { AttentionBanner, BlockingDialog } from "./Interruptions.tsx";
import { SignIn } from "./SignIn.tsx";
import { QueueScreen } from "./QueueScreen.tsx";
import { ReplenishScreen } from "./ReplenishScreen.tsx";
import { HealthScreen } from "./HealthScreen.tsx";
import { AdminScreen } from "./AdminScreen.tsx";

type Tab = "queue" | "refill" | "health" | "admin";
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "queue", label: "Queue" },
  { id: "refill", label: "Refill" },
  { id: "health", label: "Health" },
  { id: "admin", label: "Admin" },
];

export function App(props: { store: Store }) {
  const { store } = props;
  const snap = useSyncExternalStore(store.subscribe, store.get);
  const [tab, setTab] = useState<Tab>("queue");
  const { state, connection, rejection } = snap;

  useEffect(() => {
    if (!rejection) return;
    const t = setTimeout(() => store.clearRejection(), 4000);
    return () => clearTimeout(t);
  }, [rejection, store]);

  const live = connection === "open";
  const send = (c: Command) => { store.send(c); };
  const layers = state ? interruptions(state) : null;

  if (!state) {
    return (
      <div className="flex h-full flex-col">
        <StatusBar state={null} connection={connection} />
        <p role="status" className="m-auto text-hero text-muted">Connecting to the machine…</p>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr]">
      <div inert={layers?.blocking != null}>
        <StatusBar state={state} connection={connection} />
      </div>
      <div inert={layers?.blocking != null}>
        {layers?.attention ? <AttentionBanner alert={layers.attention} count={layers.attentionCount} onAck={(id) => send({ type: "ackAlert", id })} /> : null}
      </div>

      <div className="relative min-h-0" inert={layers?.blocking != null}>
        {!state.session ? (
          <SignIn disabled={!live} onPin={(pin) => send({ type: "signIn", pin })} />
        ) : (
          <div className="grid h-full grid-cols-[auto_1fr]">
            <nav aria-label="Screens" className="flex flex-col gap-gap border-r border-line bg-surface p-3">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-current={tab === t.id ? "page" : undefined}
                  onClick={() => setTab(t.id)}
                  className={`min-h-key w-32 rounded-panel text-glance font-semibold ${tab === t.id ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"}`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="min-h-0 overflow-auto">
              {tab === "queue" ? <QueueScreen state={state} send={send} /> : null}
              {tab === "refill" ? <ReplenishScreen state={state} send={send} /> : null}
              {tab === "health" ? <HealthScreen state={state} /> : null}
              {tab === "admin" ? <AdminScreen state={state} send={send} /> : null}
            </div>
          </div>
        )}
        {rejection ? (
          <div role="alert" className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-panel border-2 border-warn bg-surface px-8 py-4 text-glance font-semibold">
            {REJECT_TEXT[rejection.reason]}
          </div>
        ) : null}
      </div>

      {layers?.blocking ? <BlockingDialog alert={layers.blocking} onAck={(id) => send({ type: "ackAlert", id })} /> : null}
    </div>
  );
}
