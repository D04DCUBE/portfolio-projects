// The run store: a list of runs, a clock that advances running ones, and subscribers that hear every new step.
import { plan, metricsAt, rangeMetrics, CHECKPOINT_EVERY } from "./sim.ts";
import type { RunConfig, NewRunInput, Status, Point, RunSummary, RunEvent } from "../public/js/types.ts";

/** A run as the store keeps it. */
export interface Run { id: string; config: RunConfig; endStep: number; step: number; status: Status; startedAt: string }
export interface RunsOptions { tickMs?: number; stepsPerTick?: number; maxActive?: number; maxRuns?: number; seeded?: boolean }
export type Runs = ReturnType<typeof createRuns>;

const SEEDS: RunConfig[] = [
  { name: "baseline-sync", method: "sync-rl", lr: 3e-5, batchSize: 64, totalSteps: 600, seed: 11 },
  { name: "async-rl", method: "async-rl", lr: 3e-5, batchSize: 64, totalSteps: 600, seed: 12 },
  { name: "lr-3e-4", method: "sync-rl", lr: 3e-4, batchSize: 64, totalSteps: 600, seed: 13 },
  { name: "big-batch", method: "async-rl", lr: 6e-5, batchSize: 256, totalSteps: 600, seed: 14 },
  { name: "lr-1e-3", method: "sync-rl", lr: 1e-3, batchSize: 64, totalSteps: 600, seed: 15 },
];
const LIVE_SEED: RunConfig = { name: "async-rl-v2", method: "async-rl", lr: 4e-5, batchSize: 128, totalSteps: 800, seed: 16 };

export function createRuns({ tickMs = 700, stepsPerTick = 4, maxActive = 3, maxRuns = 30, seeded = true }: RunsOptions = {}) {
  const runs = new Map<string, Run>();
  const listeners = new Map<string, Set<(ev: RunEvent) => void>>();
  let counter = 0;

  const finalStatus = (run: Run): Status => (plan(run.config).diverges ? "diverged" : "completed");

  function add(config: RunConfig, { step = 0 }: { step?: number } = {}): Run {
    const endStep = plan(config).endStep;
    const run: Run = { id: `r${++counter}`, config, endStep, step: Math.min(step, endStep), status: "running", startedAt: new Date().toISOString() };
    if (run.step >= endStep) run.status = finalStatus(run);
    runs.set(run.id, run);
    return run;
  }

  const emit = (id: string, ev: RunEvent): void => { for (const fn of listeners.get(id) || []) fn(ev); };

  function tick() {
    for (const run of runs.values()) {
      if (run.status !== "running") continue;
      const from = run.step + 1, to = Math.min(run.step + stepsPerTick, run.endStep);
      const points = rangeMetrics(run.config, from, to);
      run.step = to;
      emit(run.id, { type: "points", points });
      if (run.step >= run.endStep) { run.status = finalStatus(run); emit(run.id, { type: "status", status: run.status, step: run.step }); }
    }
  }

  function summary(run: Run): RunSummary {
    const last = run.step > 0 ? metricsAt(run.config, run.step) : null;
    return { id: run.id, config: run.config, status: run.status, step: run.step, endStep: run.endStep, startedAt: run.startedAt,
      divergeAt: plan(run.config).divergeAt, latest: last };
  }

  if (seeded) {
    for (const s of SEEDS) add(s, { step: Infinity });
    add(LIVE_SEED, { step: 140 });
  }
  const timer = tickMs > 0 ? setInterval(tick, tickMs) : null;
  timer?.unref();

  return {
    tick,
    list: () => [...runs.values()].reverse().map(summary),                 // newest first
    get: (id: string): Run | null => runs.get(id) ?? null,
    summary,
    metrics: (id: string, from = 1, to = Infinity): Point[] | null => { const r = runs.get(id); return r ? rangeMetrics(r.config, from, Math.min(to, r.step)) : null; },
    create(config: NewRunInput): Run {
      if ([...runs.values()].filter((r) => r.status === "running").length >= maxActive) { throw Object.assign(new Error(`At most ${maxActive} runs can train at once.`), { code: "too_many" }); }
      if (runs.size >= maxRuns) {                                          // drop the oldest finished run
        const old = [...runs.values()].find((r) => r.status !== "running");
        if (old) { runs.delete(old.id); listeners.delete(old.id); }
      }
      return add({ ...config, seed: config.seed ?? Math.floor(Math.random() * 1_000_000) });
    },
    stop(id: string): Run | null {
      const run = runs.get(id);
      if (!run || run.status !== "running") return run || null;
      run.status = "stopped";
      emit(id, { type: "status", status: "stopped", step: run.step });
      return run;
    },
    subscribe(id: string, fn: (ev: RunEvent) => void): () => void {
      
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id)?.add(fn);
      return () => listeners.get(id)?.delete(fn);
    },
    close() { if (timer) clearInterval(timer); },
    CHECKPOINT_EVERY,
  };
}
