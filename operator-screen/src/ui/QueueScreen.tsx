import { useState } from "react";
import type { Command, ExceptionReason, MachineState, Prescription } from "../contract.gen.ts";
import { Btn, Panel, Pill } from "./parts.tsx";
import { REASON_TEXT, STATUS_TEXT } from "./text.ts";

function statusTone(p: Prescription): "ok" | "warn" | "danger" | "muted" {
  return p.status === "done" ? "ok" : p.status === "exception" ? "warn" : p.status === "in_progress" ? "warn" : "muted";
}

// The task view is chosen by the machine's `active` step. Nothing here advances it: the drawer does.
function TaskView(props: { state: MachineState }) {
  const { state } = props;
  const active = state.active!;
  const rx = state.queue.find((p) => p.id === active.prescriptionId);
  return (
    <main className="flex h-full flex-col items-center justify-center gap-8 text-center">
      <p className="text-glance text-muted">{rx?.id} · {rx?.patient}</p>
      {active.step === "picking" ? (
        <>
          <span aria-hidden="true" className="spinner text-hero">◌</span>
          <h2 className="text-hero font-bold">The machine is picking</h2>
          <p className="text-glance">Wait. The drawer opens when it is ready.</p>
        </>
      ) : (
        <>
          <h2 className="text-hero font-bold">Take {rx?.qty} × {rx?.drug}</h2>
          <p className="text-glance">Then close the drawer. This screen moves on by itself.</p>
        </>
      )}
    </main>
  );
}

export function QueueScreen(props: { state: MachineState; send: (c: Command) => void }) {
  const { state, send } = props;
  const [picked, setPicked] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  if (state.active) return <TaskView state={state} />;

  const open = state.queue.filter((p) => p.status === "waiting" || p.status === "exception");
  const selected = open.find((p) => p.id === picked) ?? open.find((p) => p.status === "waiting") ?? null;
  const slot = selected ? state.stock.find((s) => s.slot === selected.slot) : undefined;
  const short = selected && slot ? slot.count < selected.qty : false;
  const fault = state.health.status === "fault";

  return (
    <main className="grid h-full grid-cols-[3fr_2fr] gap-gap p-6">
      <Panel title={`Queue · ${open.length} open`} className="overflow-auto">
        {open.length === 0 ? <p className="text-glance text-muted">Nothing waiting. Well done.</p> : null}
        <ul className="flex flex-col gap-gap">
          {open.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={selected?.id === p.id}
                onClick={() => { setPicked(p.id); setReporting(false); }}
                className={`flex min-h-key w-full items-center gap-6 rounded-panel border-2 px-6 text-left ${selected?.id === p.id ? "border-accent bg-surface-2" : "border-line bg-surface"}`}
              >
                <span className="flex flex-1 flex-col py-2">
                  <span className="text-glance font-bold">{p.id} <span className="font-normal text-muted">· {p.patient}</span></span>
                  <span className="text-glance">{p.qty} × {p.drug}</span>
                </span>
                <Pill tone={statusTone(p)}>{STATUS_TEXT[p.status]}</Pill>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={selected ? selected.id : "Details"} className="flex flex-col gap-gap">
        {selected ? (
          reporting ? (
            <>
              <p className="text-glance">What is wrong?</p>
              {(Object.keys(REASON_TEXT) as ExceptionReason[]).map((r) => (
                <Btn key={r} wide onPress={() => { send({ type: "reportException", id: selected.id, reason: r }); setReporting(false); }}>{REASON_TEXT[r]}</Btn>
              ))}
              <Btn tone="neutral" wide onPress={() => setReporting(false)}>Back</Btn>
            </>
          ) : (
            <>
              <p className="text-glance">{selected.qty} × {selected.drug}</p>
              <p className="text-body text-muted">Patient {selected.patient} · slot {selected.slot}</p>
              {short ? <p role="alert" className="text-body font-semibold text-warn">Only {slot?.count} in stock. Refill {selected.slot} first.</p> : null}
              {fault ? <p role="alert" className="text-body font-semibold text-danger">Paused by a machine fault.</p> : null}
              {selected.status === "exception" ? <p className="text-body text-warn">Waiting for a pharmacist. See Admin.</p> : null}
              <div className="mt-auto flex flex-col gap-gap">
                <Btn tone="primary" wide disabled={selected.status !== "waiting" || short || fault} onPress={() => send({ type: "startPrescription", id: selected.id })}>Start</Btn>
                <Btn wide disabled={selected.status !== "waiting"} onPress={() => setReporting(true)}>Report a problem</Btn>
              </div>
            </>
          )
        ) : (
          <p className="text-body text-muted">Pick a prescription.</p>
        )}
      </Panel>
    </main>
  );
}
