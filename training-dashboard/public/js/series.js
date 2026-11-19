// Pure helpers for the charts and tables. No DOM here, so they are easy to test.

// Exponential moving average, with the start corrected so a flat line stays flat (what TensorBoard does).
// alpha is how much weight the past gets: 0 means no smoothing. Missing values are skipped.
export function ema(values, alpha) {
  if (!alpha) return values.slice();
  let s = 0, n = 0;
  return values.map((v) => {
    if (v == null || !Number.isFinite(v)) return v;
    s = alpha * s + (1 - alpha) * v; n++;
    return s / (1 - alpha ** n);
  });
}

// Keep a long line cheap to draw. Split into buckets and keep each bucket's lowest and highest point,
// so spikes survive (averaging would hide the very thing people look for). First and last points are kept.
export function downsample(points, max) {
  if (points.length <= max || max < 4) return points;
  const buckets = Math.floor((max - 2) / 2), size = (points.length - 2) / buckets;
  const out = [points[0]];
  for (let b = 0; b < buckets; b++) {
    const from = 1 + Math.floor(b * size), to = Math.min(points.length - 1, 1 + Math.floor((b + 1) * size));
    let lo = from, hi = from;
    for (let i = from; i < to; i++) { if (points[i].y < points[lo].y) lo = i; if (points[i].y > points[hi].y) hi = i; }
    if (lo === hi) out.push(points[lo]); else out.push(...(lo < hi ? [points[lo], points[hi]] : [points[hi], points[lo]]));
  }
  out.push(points[points.length - 1]);
  return out;
}

// "Nice" axis ticks: 1, 2, 5 times a power of ten.
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count, pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

// Ticks for a log axis: powers of ten, plus 2 and 5 when the range is narrow.
export function logTicks(min, max) {
  const out = [], lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
  const mult = hi - lo <= 2 ? [1, 2, 5] : hi - lo === 3 ? [1, 3] : [1];
  for (let e = lo; e <= hi; e++) for (const m of mult) { const v = m * 10 ** e; if (v >= min * 0.999 && v <= max * 1.001) out.push(Number(v.toPrecision(12))); }
  return out;
}

export function formatNum(v) {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toPrecision(3).replace(/\.?0+$/, "") + "M";
  if (a >= 1e4) return (v / 1e3).toPrecision(3).replace(/\.?0+$/, "") + "k";
  if (a >= 100) return String(Math.round(v));
  if (a === 0) return "0";
  if (a < 0.001) return v.toExponential(1);
  return Number(v.toPrecision(3)).toString();
}

// Points arrive in order, one per step. Accept only the next expected step.
//   ok: the new points were added.  gap: a step is missing, so the caller should reload the whole run.
export function appendPoints(arr, incoming) {
  let gap = false;
  for (const p of incoming) {
    if (p.step <= arr.length) continue;            // already have it (a replay after reconnect)
    if (p.step !== arr.length + 1) { gap = true; break; }
    arr.push(p);
  }
  return { gap };
}

export const CONFIG_FIELDS = [
  ["method", "Method"], ["lr", "Learning rate"], ["batchSize", "Batch size"], ["totalSteps", "Total steps"], ["seed", "Seed"],
];

// Rows for the "what is different between these runs" table.
export function configDiff(configs) {
  return CONFIG_FIELDS.map(([key, label]) => {
    const values = configs.map((c) => c[key]);
    return { key, label, values, differs: new Set(values).size > 1 };
  });
}

// Headline numbers for one run, from its points.
export function summarize(points) {
  const last = points.at(-1) ?? null;
  let bestEval = null, bestReward = null;
  for (const p of points) {
    if (p.eval != null && (bestEval === null || p.eval > bestEval.score)) bestEval = { step: p.step, score: p.eval };
    if (p.reward != null && (bestReward === null || p.reward > bestReward)) bestReward = p.reward;
  }
  return { last, bestEval, bestReward };
}
