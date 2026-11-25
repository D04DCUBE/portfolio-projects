import { useState } from "react";
import type { Command, MachineState, StockItem } from "../contract.gen.ts";
import { Btn, Panel, Pill } from "./parts.tsx";

function Level(props: { item: StockItem }) {
  const { item } = props;
  const pct = Math.round((item.count / item.capacity) * 100);
  const low = item.count < item.par;
  return (
    <div role="img" aria-label={`${item.count} of ${item.capacity}`} className="h-bar w-full overflow-hidden rounded-panel bg-bg">
      <div className={`h-full ${low ? "bg-warn" : "bg-ok"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ReplenishScreen(props: { state: MachineState; send: (c: Command) => void }) {
  const { state, send } = props;
  const [slot, setSlot] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const item = state.stock.find((s) => s.slot === slot) ?? null;
  const choose = (s: StockItem) => { setSlot(s.slot); setAmount(s.capacity - s.count); };
  const step = (n: number) => item && setAmount(Math.max(0, Math.min(item.capacity - item.count, amount + n)));

  return (
    <main className="grid h-full grid-cols-[3fr_2fr] gap-gap p-6">
      <Panel title="Stock" className="overflow-auto">
        <ul className="flex flex-col gap-gap">
          {state.stock.map((s) => (
            <li key={s.slot}>
              <button
                type="button"
                aria-pressed={slot === s.slot}
                onClick={() => choose(s)}
                className={`flex min-h-key w-full items-center gap-6 rounded-panel border-2 px-6 text-left ${slot === s.slot ? "border-accent bg-surface-2" : "border-line bg-surface"}`}
              >
                <span className="w-16 text-glance font-bold">{s.slot}</span>
                <span className="flex flex-1 flex-col gap-2 py-2">
                  <span className="text-glance">{s.name}</span>
                  <Level item={s} />
                </span>
                <span className="w-40 text-right text-glance font-bold">{s.count} / {s.capacity}</span>
                {s.count < s.par ? <Pill tone="warn">Low</Pill> : null}
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={item ? `Refill ${item.slot}` : "Refill"} className="flex flex-col gap-gap">
        {item ? (
          <>
            <p className="text-glance">{item.name}</p>
            <p className="text-body text-muted">Add what you have loaded into the machine.</p>
            <div className="flex items-center gap-gap">
              <Btn label="Remove 10" onPress={() => step(-10)} disabled={amount === 0}>−10</Btn>
              <Btn label="Remove 1" onPress={() => step(-1)} disabled={amount === 0}>−1</Btn>
              <output aria-live="polite" className="flex-1 text-center text-hero font-bold">{amount}</output>
              <Btn label="Add 1" onPress={() => step(1)} disabled={amount >= item.capacity - item.count}>+1</Btn>
              <Btn label="Add 10" onPress={() => step(10)} disabled={amount >= item.capacity - item.count}>+10</Btn>
            </div>
            <div className="mt-auto">
              <Btn tone="primary" wide disabled={amount === 0} onPress={() => { send({ type: "restock", slot: item.slot, count: amount }); setSlot(null); }}>
                Confirm refill
              </Btn>
            </div>
          </>
        ) : (
          <p className="text-body text-muted">Pick a slot.</p>
        )}
      </Panel>
    </main>
  );
}
