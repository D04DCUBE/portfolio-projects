import type { MachineState } from "../contract.gen.ts";
import { Panel } from "./parts.tsx";

function Fact(props: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex min-h-key items-center justify-between border-b border-line">
      <dt className="text-glance text-muted">{props.label}</dt>
      <dd className={`text-glance font-bold ${props.bad ? "text-danger" : ""}`}>{props.value}</dd>
    </div>
  );
}

export function HealthScreen(props: { state: MachineState }) {
  const { state } = props;
  const low = state.stock.filter((s) => s.count < s.par);
  return (
    <main className="grid h-full grid-cols-2 gap-gap p-6">
      <Panel title="Machine">
        <dl>
          <Fact label="Status" value={state.health.status === "ok" ? "OK" : `Fault ${state.health.code}`} bad={state.health.status !== "ok"} />
          {state.health.status === "fault" ? <Fact label="Reason" value={state.health.message} bad /> : null}
          <Fact label="Drawer" value={state.drawer === "open" ? "Open" : "Closed"} />
          <Fact label="Task" value={state.active ? `${state.active.prescriptionId}, ${state.active.step === "picking" ? "picking" : "waiting for drawer"}` : "None"} />
          <Fact label="State version" value={String(state.version)} />
        </dl>
      </Panel>
      <Panel title="Needs refilling">
        {low.length === 0 ? <p className="text-glance text-ok">Everything is above its refill level.</p> : (
          <ul className="flex flex-col gap-gap">
            {low.map((s) => <li key={s.slot} className="text-glance"><span className="font-bold">{s.slot}</span> {s.name}: {s.count} left</li>)}
          </ul>
        )}
      </Panel>
    </main>
  );
}
