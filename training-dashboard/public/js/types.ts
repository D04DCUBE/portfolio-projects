// Shared types. The server, the browser code and the tests all import these, so a change to the
// shape of a run or a point is a compile error everywhere it matters, not a surprise at runtime.

export type Method = "sync-rl" | "async-rl";
export type Status = "running" | "completed" | "diverged" | "stopped";
export type MetricKey = "loss" | "reward" | "kl" | "gradNorm" | "tps" | "cost";

/** The settings of a run. `seed` makes the made-up noise repeatable. */
export interface RunConfig {
  name: string;
  method: Method;
  lr: number;
  batchSize: number;
  totalSteps: number;
  seed: number;
}

/** What the new-run form sends: the seed is optional, the server picks one. */
export type NewRunInput = Omit<RunConfig, "seed"> & { seed: number | null };

/** One training step: every metric, plus an eval score on checkpoint steps. */
export interface Point {
  step: number;
  loss: number;
  reward: number;
  kl: number;
  gradNorm: number;
  tps: number;
  cost: number;
  eval: number | null;
}

export interface Plan {
  diverges: boolean;
  divergeAt: number | null;
  endStep: number;
}

export interface RunSummary {
  id: string;
  config: RunConfig;
  status: Status;
  step: number;
  endStep: number;
  startedAt: string;
  divergeAt: number | null;
  latest: Point | null;
}

/** What the run store tells its listeners. */
export type RunEvent =
  | { type: "points"; points: Point[] }
  | { type: "status"; status: Status; step: number };

export type FormField = "name" | "method" | "lr" | "batchSize" | "totalSteps" | "seed";
export type ValidationResult =
  | { ok: true; config: NewRunInput }
  | { ok: false; errors: Partial<Record<FormField, string>> };
