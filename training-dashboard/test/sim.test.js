import { test } from "node:test";
import assert from "node:assert/strict";
import { plan, metricsAt, rangeMetrics, CHECKPOINT_EVERY } from "../lib/sim.js";
import { createRuns } from "../lib/runs.js";
import { validateConfig } from "../public/js/config.js";

const base = { name: "t", method: "sync-rl", lr: 3e-5, batchSize: 64, totalSteps: 300, seed: 1 };
const std = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };

test("the same config and step always give the same numbers", () => {
  assert.deepEqual(metricsAt(base, 42), metricsAt(base, 42));
  assert.notDeepEqual(metricsAt(base, 42), metricsAt({ ...base, seed: 2 }, 42));
});

test("a range equals the steps computed one by one, so a resume cannot drift", () => {
  const range = rangeMetrics(base, 10, 20);
  assert.equal(range.length, 11);
  assert.deepEqual(range, Array.from({ length: 11 }, (_, i) => metricsAt(base, 10 + i)));
});

test("loss falls and reward rises over a healthy run", () => {
  const early = rangeMetrics(base, 1, 10), late = rangeMetrics(base, 291, 300);
  const avg = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  assert.ok(avg(late, "loss") < avg(early, "loss") - 0.5);
  assert.ok(avg(late, "reward") > avg(early, "reward") + 0.3);
});

test("a high learning rate diverges: the run ends early with a huge loss", () => {
  const cfg = { ...base, lr: 1e-3, totalSteps: 600 };
  const p = plan(cfg);
  assert.equal(p.diverges, true);
  assert.equal(p.endStep, p.divergeAt + 12);
  assert.ok(metricsAt(cfg, p.endStep).loss > 10);
  assert.equal(plan(base).diverges, false);
  assert.equal(plan(base).endStep, 300);
});

test("a run too short to reach its divergence point just finishes", () => {
  assert.equal(plan({ ...base, lr: 3e-4, totalSteps: 100 }).diverges, false);
});

test("a bigger batch gives a steadier curve", () => {
  const resid = (cfg) => std(rangeMetrics(cfg, 200, 300).map((r) => r.reward));
  assert.ok(resid({ ...base, batchSize: 256 }) < resid({ ...base, batchSize: 16 }));
});

test("async costs less per step and moves more tokens per second", () => {
  const sync = metricsAt(base, 100), asyn = metricsAt({ ...base, method: "async-rl" }, 100);
  assert.ok(asyn.cost < sync.cost);
  assert.ok(asyn.tps > sync.tps);
});

test("cost is steps x batch x price, and eval scores appear only at checkpoints", () => {
  assert.equal(metricsAt(base, 100).cost, Math.round(100 * 64 * 0.0027 * 100) / 100);
  const evals = rangeMetrics(base, 1, 300).filter((r) => r.eval !== null).map((r) => r.step);
  assert.deepEqual(evals, [50, 100, 150, 200, 250, 300].filter((s) => s % CHECKPOINT_EVERY === 0));
});

test("the run store advances running runs, announces new steps and finishes them", () => {
  const runs = createRuns({ tickMs: 0, stepsPerTick: 25, seeded: false });
  const run = runs.create({ ...base, totalSteps: 60 });
  const seen = []; const statuses = [];
  runs.subscribe(run.id, (ev) => (ev.type === "points" ? seen.push(...ev.points.map((p) => p.step)) : statuses.push(ev.status)));
  runs.tick(); runs.tick(); runs.tick();
  assert.equal(seen.length, 60);
  assert.deepEqual(seen, Array.from({ length: 60 }, (_, i) => i + 1));
  assert.deepEqual(statuses, ["completed"]);
  runs.tick();
  assert.equal(seen.length, 60, "finished runs do not move");
});

test("the store limits how many runs train at once, and Stop ends one", () => {
  const runs = createRuns({ tickMs: 0, seeded: false, maxActive: 2 });
  const a = runs.create(base); runs.create(base);
  assert.throws(() => runs.create(base), (e) => e.code === "too_many");
  runs.stop(a.id);
  assert.equal(runs.get(a.id).status, "stopped");
  assert.doesNotThrow(() => runs.create(base));
});

test("settings are validated: names, ranges, whole numbers", () => {
  assert.equal(validateConfig({ name: "ok", method: "async-rl", lr: "3e-5", batchSize: "64", totalSteps: "400" }).ok, true);
  const bad = validateConfig({ name: "<script>", method: "x", lr: "fast", batchSize: 3.5, totalSteps: 99999, seed: -1 });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["batchSize", "lr", "method", "name", "seed", "totalSteps"]);
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig({ name: "a", method: "sync-rl", lr: "", batchSize: 64, totalSteps: 100 }).ok, false);
});
