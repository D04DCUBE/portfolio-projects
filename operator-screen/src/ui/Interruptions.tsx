import type { Alert } from "../contract.gen.ts";
import { Btn } from "./parts.tsx";

// Layer 2: a call for attention. One banner at a time, never covers the work area.
export function AttentionBanner(props: { alert: Alert; count: number; onAck: (id: string) => void }) {
  const { alert, count, onAck } = props;
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-gap border-b-2 border-warn bg-warn px-6 py-3 text-warn-ink">
      <span aria-hidden="true" className="text-hero">⚠</span>
      <p className="flex-1 text-glance font-semibold">{alert.text}</p>
      {count > 1 ? <span className="text-body font-semibold">+{count - 1} more</span> : null}
      {alert.needsAck ? <Btn tone="neutral" onPress={() => onAck(alert.id)}>Got it</Btn> : null}
    </div>
  );
}

// Layer 3: blocking. Stops everything. Only a machine fault reaches it.
export function BlockingDialog(props: { alert: Alert; onAck: (id: string) => void }) {
  const { alert, onAck } = props;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 p-6">
      <div role="alertdialog" aria-modal="true" aria-labelledby="blocking-title" aria-describedby="blocking-text" className="w-full max-w-3xl rounded-panel border-4 border-danger bg-surface p-10">
        <h2 id="blocking-title" className="mb-4 text-hero font-bold text-danger">Machine stopped</h2>
        <p id="blocking-text" className="mb-8 text-glance">{alert.text}</p>
        {alert.needsAck ? (
          <Btn tone="primary" wide onPress={() => onAck(alert.id)}>I have checked it</Btn>
        ) : (
          <p className="text-body text-muted"><span className="spinner mr-2 inline-block">◌</span>Waiting for the machine to clear the fault. Call service if this stays.</p>
        )}
      </div>
    </div>
  );
}
