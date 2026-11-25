// The interruption model: three layers, and one rule for which layer an alert uses.
//   ambient   - always visible, never asks for anything (status bar)
//   attention - a banner that needs a look when the technician is free
//   blocking  - a dialog that stops everything; only machine faults reach it
import type { Alert, MachineState } from "../contract.gen.ts";

export type Layer = "ambient" | "attention" | "blocking";

export function layerOf(alert: Alert): Layer {
  if (alert.severity === "critical") return "blocking";
  if (alert.severity === "warning") return "attention";
  return "ambient";
}

export type Interruptions = {
  readonly ambient: readonly Alert[];
  readonly attention: Alert | null; // one banner at a time
  readonly attentionCount: number;
  readonly blocking: Alert | null;
};

export function interruptions(state: MachineState): Interruptions {
  const by = (layer: Layer) => state.alerts.filter((a) => layerOf(a) === layer);
  const attention = by("attention");
  return {
    ambient: by("ambient"),
    attention: attention[0] ?? null,
    attentionCount: attention.length,
    blocking: by("blocking")[0] ?? null,
  };
}
