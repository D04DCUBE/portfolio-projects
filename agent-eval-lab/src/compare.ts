// Pure helpers shared by the command line and the viewer.
import type { RunRecord } from "./types.ts";

export type Change = "same-pass" | "same-fail" | "fixed" | "regressed" | "only-in-a" | "only-in-b";

export interface CaseDiff { id: string; description: string; change: Change }

/** Compare run A (the baseline) with run B (the candidate), case by case. */
export function compareRuns(a: RunRecord, b: RunRecord): CaseDiff[] {
  const byId = new Map(b.cases.map((c) => [c.id, c]));
  const diffs: CaseDiff[] = a.cases.map((ca) => {
    const cb = byId.get(ca.id);
    byId.delete(ca.id);
    const change: Change = !cb ? "only-in-a" : ca.passed && cb.passed ? "same-pass" : !ca.passed && !cb.passed ? "same-fail" : ca.passed ? "regressed" : "fixed";
    return { id: ca.id, description: ca.description, change };
  });
  for (const cb of byId.values()) diffs.push({ id: cb.id, description: cb.description, change: "only-in-b" });
  return diffs;
}

export const summarizeChanges = (diffs: CaseDiff[]): Record<Change, number> => {
  const out: Record<Change, number> = { "same-pass": 0, "same-fail": 0, fixed: 0, regressed: 0, "only-in-a": 0, "only-in-b": 0 };
  for (const d of diffs) out[d.change]++;
  return out;
};
