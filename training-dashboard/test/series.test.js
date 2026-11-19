import { test } from "node:test";
import assert from "node:assert/strict";
import { ema, downsample, niceTicks, logTicks, formatNum, appendPoints, configDiff, summarize } from "../public/js/series.js";

test("smoothing leaves a flat line flat, and 0 means no change", () => {
  assert.deepEqual(ema([5, 5, 5, 5], 0.9).map((v) => +v.toFixed(9)), [5, 5, 5, 5]);
  assert.deepEqual(ema([1, 2, 3], 0), [1, 2, 3]);
});
test("smoothing reduces jitter and skips missing values", () => {
  const raw = Array.from({ length: 60 }, (_, i) => (i % 2 ? 9 : 1));
  const range = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(range(ema(raw, 0.8).slice(20)) < range(raw) / 2);
  assert.deepEqual(ema([1, null, 3], 0.5)[1], null);
});

test("downsampling keeps the first and last points and the spikes", () => {
  const pts = Array.from({ length: 5000 }, (_, i) => ({ x: i + 1, y: i === 2500 ? 1000 : Math.sin(i / 50) }));
  const out = downsample(pts, 200);
  assert.ok(out.length <= 200);
  assert.equal(out[0].x, 1); assert.equal(out.at(-1).x, 5000);
  assert.ok(out.some((p) => p.y === 1000), "the spike survives");
  assert.ok(out.every((p, i) => i === 0 || p.x > out[i - 1].x), "still in order");
  const small = pts.slice(0, 50); assert.equal(downsample(small, 200), small);
});

test("axis ticks are round numbers inside the range", () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  const t = niceTicks(0.13, 0.87, 5); assert.ok(t.every((v) => v >= 0.13 && v <= 0.87));
  assert.deepEqual(logTicks(0.3, 30), [0.3, 1, 3, 10, 30]);
  assert.deepEqual(logTicks(1, 10), [1, 2, 5, 10]);
});
test("numbers are formatted compactly", () => {
  assert.equal(formatNum(12345), "12.3k"); assert.equal(formatNum(0.123456), "0.123"); assert.equal(formatNum(null), "–"); assert.equal(formatNum(0.0004), "4.0e-4");
});

test("appending points ignores replays and reports gaps", () => {
  const arr = [{ step: 1 }, { step: 2 }];
  assert.deepEqual(appendPoints(arr, [{ step: 2 }, { step: 3 }, { step: 4 }]), { gap: false });
  assert.equal(arr.length, 4);
  assert.deepEqual(appendPoints(arr, [{ step: 7 }]), { gap: true });
  assert.equal(arr.length, 4, "nothing added across a gap");
});

test("the config diff marks only the settings that differ", () => {
  const rows = configDiff([{ method: "a", lr: 1, batchSize: 64, totalSteps: 10, seed: 1 }, { method: "a", lr: 2, batchSize: 64, totalSteps: 10, seed: 2 }]);
  assert.deepEqual(rows.filter((r) => r.differs).map((r) => r.key), ["lr", "seed"]);
});
test("summaries find the best eval and the latest values", () => {
  const s = summarize([{ step: 1, reward: 0.1, eval: null }, { step: 50, reward: 0.5, eval: 0.4 }, { step: 100, reward: 0.7, eval: 0.6 }, { step: 101, reward: 0.65, eval: null }]);
  assert.deepEqual(s.bestEval, { step: 100, score: 0.6 }); assert.equal(s.bestReward, 0.7); assert.equal(s.last.step, 101);
  assert.deepEqual(summarize([]), { last: null, bestEval: null, bestReward: null });
});
