// Run configuration rules. The browser uses this to validate the form; the server imports the same file
// and checks again, because the server cannot trust the browser.
import type { Method, FormField, ValidationResult } from "./types.ts";

export const METHODS: readonly Method[] = ["sync-rl", "async-rl"];
export const LIMITS = { lr: [1e-6, 1e-2], batchSize: [8, 512], totalSteps: [50, 2000], seed: [0, 1_000_000] } as const;

const num = (v: unknown): number => (typeof v === "string" ? (v.trim() === "" ? NaN : Number(v)) : typeof v === "number" ? v : NaN);

export function validateConfig(input: unknown): ValidationResult {
  const src: Record<string, unknown> = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const errors: Partial<Record<FormField, string>> = {};
  const name = typeof src.name === "string" ? src.name.trim() : "";
  if (!name || name.length > 40 || !/^[\w .-]+$/.test(name)) errors.name = "Use 1 to 40 letters, numbers, spaces, dots, dashes or underscores.";
  const method = METHODS.find((m) => m === src.method);
  if (!method) errors.method = "Choose sync-rl or async-rl.";
  const lr = num(src.lr);
  if (!Number.isFinite(lr) || lr < LIMITS.lr[0] || lr > LIMITS.lr[1]) errors.lr = "Learning rate must be between 1e-6 and 1e-2, for example 3e-5.";
  const batchSize = num(src.batchSize);
  if (!Number.isInteger(batchSize) || batchSize < LIMITS.batchSize[0] || batchSize > LIMITS.batchSize[1]) errors.batchSize = "Batch size must be a whole number from 8 to 512.";
  const totalSteps = num(src.totalSteps);
  if (!Number.isInteger(totalSteps) || totalSteps < LIMITS.totalSteps[0] || totalSteps > LIMITS.totalSteps[1]) errors.totalSteps = "Steps must be a whole number from 50 to 2000.";
  let seed: number | null = null;
  if (src.seed !== undefined && src.seed !== null && src.seed !== "") {
    seed = num(src.seed);
    if (!Number.isInteger(seed) || seed < LIMITS.seed[0] || seed > LIMITS.seed[1]) errors.seed = "Seed must be a whole number from 0 to 1000000.";
  }
  if (Object.keys(errors).length || !method) return { ok: false, errors };
  return { ok: true, config: { name, method, lr, batchSize, totalSteps, seed } };
}
