import { useState } from "react";
import type { Command, MachineState } from "../contract.gen.ts";
import { Btn, HoldButton, Panel, Pill } from "./parts.tsx";
import { REASON_TEXT, STATUS_TEXT } from "./text.ts";

export function AdminScreen(props: { state: MachineState; send: (c: Command) => void }) {
  const { state, send } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const open = state.queue.filter((p) => p.status === "waiting" || p.status === "exception");
  const selected = open.find((p) => p.id === picked) ?? null;

  return (
    <main className="grid h-full grid-cols-[3fr_2fr] gap-gap p-6">
      <div className="flex flex-col gap-gap overflow-auto">
        <Panel title="Prescriptions">
          <ul className="flex flex-col gap-gap">
            {open.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={selected?.id === p.id}
                  onClick={() => setPicked(p.id)}
                  className={`flex min-h-key w-full items-center gap-6 rounded-panel border-2 px-6 text-left ${selected?.id === p.id ? "border-accent bg-surface-2" : "border-line bg-surface"}`}
                >
                  <span className="flex flex-1 flex-col py-2">
                    <span className="text-glance font-bold">{p.id}</span>
                    <span className="text-glance">{p.qty} × {p.drug}</span>
                    {p.exceptionReason ? <span className="text-body text-muted">{REASON_TEXT[p.exceptionReason]}</span> : null}
                  </span>
                  <Pill tone={p.status === "exception" ? "warn" : "muted"}>{STATUS_TEXT[p.status]}</Pill>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Session">
          <div className="flex items-center gap-gap">
            <p className="flex-1 text-glance">Signed in as {state.session?.user}</p>
            <Btn disabled={state.active !== null} onPress={() => send({ type: "signOut" })}>Sign out</Btn>
          </div>
          {state.active ? <p className="mt-2 text-body text-muted">Finish the running task before signing out.</p> : null}
        </Panel>
      </div>

      <Panel title={selected ? selected.id : "Details"} className="flex flex-col gap-gap">
        {selected ? (
          <>
            <p className="text-glance">{selected.qty} × {selected.drug}</p>
            {selected.status === "exception" ? (
              <Btn tone="primary" wide onPress={() => { send({ type: "retryPrescription", id: selected.id }); setPicked(null); }}>Problem fixed, put back</Btn>
            ) : <p className="text-body text-muted">No problem reported.</p>}
            <div className="mt-auto flex flex-col gap-gap border-t-2 border-danger pt-6">
              <p className="text-body font-semibold text-danger">This cannot be undone</p>
              <HoldButton onConfirm={() => { send({ type: "cancelPrescription", id: selected.id }); setPicked(null); }}>Hold to remove from queue</HoldButton>
            </div>
          </>
        ) : <p className="text-body text-muted">Pick a prescription.</p>}
      </Panel>
    </main>
  );
}
