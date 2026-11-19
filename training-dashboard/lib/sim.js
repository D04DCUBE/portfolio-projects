// A stand-in for a real training job. Every metric is a pure function of (config, step): the same inputs
// always give the same numbers, so a run can be recomputed, resumed after a dropped connection, and tested.
// The curves are made up, but they follow the shapes people look for: loss decays, reward saturates,
// a learning rate that is too high blows up, and a bigger batch gives less noise.

export const CHECKPOINT_EVERY = 50;
const LR_OPT = 3e-5;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, d) => { const m = 10 ** d; return Math.round(v * m) / m; };

// Deterministic noise: hash (seed, step, channel) to a number in [0, 1), then to a normal sample.
function hash(a, b, c) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function gauss(seed, step, ch) {
  const u1 = Math.max(hash(seed, step, ch * 2 + 1), 1e-12), u2 = hash(seed, step, ch * 2 + 2);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// When does this run end, and does it end badly? A learning rate at or above 2e-4 may diverge before the last step.
export function plan(config) {
  const { lr, totalSteps } = config;
  const at = lr >= 2e-4 ? Math.round(40 + 700 * (2e-4 / lr) ** 2) : null;
  const diverges = at !== null && at + 12 < totalSteps;
  return { diverges, divergeAt: diverges ? at : null, endStep: diverges ? at + 12 : totalSteps };
}

export function metricsAt(config, step) {
  const { seed, lr, batchSize, method } = config;
  const { divergeAt } = plan(config);
  const isAsync = method === "async-rl";
  const r = lr / LR_OPT;
  const k = 0.006 * clamp(Math.sqrt(r), 0.35, 2.2) * (isAsync ? 1.12 : 1);
  const noise = 1 / Math.sqrt(batchSize / 64);          // a bigger batch averages out noise
  const decay = Math.exp(-k * step);
  const g = (ch) => gauss(seed, step, ch);

  let loss = 0.35 + 1.65 * decay + 0.05 * noise * (0.4 + decay) * g(1);
  const ceiling = clamp(0.72 + 0.03 * Math.log2(batchSize / 64) - 0.05 * Math.max(0, Math.log2(r) - 1), 0.45, 0.9);
  let reward = ceiling * (1 - Math.exp(-0.9 * k * step)) + 0.025 * noise * g(2);
  const kl = Math.abs(0.002 + 0.0009 * Math.sqrt(step * r) * (1 + 0.08 * g(3)));
  let gradNorm = 0.1 + 0.9 * Math.exp(-0.004 * step) + 0.04 * noise * g(4);
  if (divergeAt !== null && step > divergeAt - 30) {      // the last 30 steps before a blow-up
    const x = step - (divergeAt - 30), blow = Math.exp(x / 6) - 1;
    loss += 0.02 * blow; gradNorm *= 1 + 0.15 * blow; reward -= 0.012 * x;
  }
  const tps = (isAsync ? 42000 : 30000) * clamp(0.5 + batchSize / 256, 0.6, 1.3) * (1 + 0.04 * g(5));
  const cost = step * batchSize * (isAsync ? 0.0021 : 0.0027);
  const evalScore = step % CHECKPOINT_EVERY === 0 ? clamp(reward * 0.95 + 0.02 * g(6), 0, 1) : null;
  return {
    step, loss: round(Math.max(loss, 0.01), 4), reward: round(clamp(reward, 0, 1), 4), kl: round(kl, 5),
    gradNorm: round(Math.max(gradNorm, 0.01), 4), tps: Math.round(tps), cost: round(cost, 2),
    eval: evalScore === null ? null : round(evalScore, 4),
  };
}

export function rangeMetrics(config, from, to) {
  const end = plan(config).endStep, out = [];
  for (let s = Math.max(1, from); s <= Math.min(to, end); s++) out.push(metricsAt(config, s));
  return out;
}
