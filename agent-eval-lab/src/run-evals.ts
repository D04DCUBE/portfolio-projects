// Command line.  node src/run-evals.ts [--model careful|careless] [--out file.json]
//                node src/run-evals.ts compare a.json b.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { runAgent } from "./agent.ts";
import { CASES } from "./cases.ts";
import { compareRuns, summarizeChanges } from "./compare.ts";
import { grade } from "./graders.ts";
import { connect } from "./mcp-client.ts";
import { MODELS } from "./models.ts";
import type { CaseRecord, EvalCase, Model, RunRecord } from "./types.ts";

/** Each case gets its own fresh server process, so one case can never change the data another one sees. */
export async function runSuite(model: Model, cases: EvalCase[] = CASES, now: () => Date = () => new Date()): Promise<RunRecord> {
  const records: CaseRecord[] = [];
  for (const c of cases) {
    const client = await connect();
    try {
      const trace = await runAgent({ model, client, prompt: c.prompt });
      const graders = grade(c.graders, trace);
      records.push({ id: c.id, description: c.description, passed: graders.every((g) => g.passed), graders, trace });
    } finally {
      await client.close();
    }
  }
  const startedAt = now().toISOString();
  return { id: `${model.id}-${startedAt}`, model: model.id, startedAt, passed: records.filter((r) => r.passed).length, total: records.length, cases: records };
}

const load = (file: string): RunRecord => JSON.parse(readFileSync(file, "utf8")) as RunRecord;

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "compare") {
    const [fa, fb] = [argv[1], argv[2]];
    if (!fa || !fb) { console.error("usage: node src/run-evals.ts compare baseline.json candidate.json"); return 2; }
    const a = load(fa), b = load(fb);
    console.log(`${a.model}: ${a.passed}/${a.total}   ->   ${b.model}: ${b.passed}/${b.total}`);
    const diffs = compareRuns(a, b);
    for (const d of diffs) console.log(`  ${d.change.padEnd(10)} ${d.id}`);
    const s = summarizeChanges(diffs);
    console.log(`${s.regressed} regressed, ${s.fixed} fixed`);
    return s.regressed > 0 ? 1 : 0;
  }

  const get = (flag: string): string | undefined => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const modelId = get("--model") ?? "careful";
  const model = MODELS[modelId];
  if (!model) { console.error(`Unknown model "${modelId}". Choose: ${Object.keys(MODELS).join(", ")}`); return 2; }
  const out = get("--out") ?? `runs/${modelId}.json`;

  const run = await runSuite(model);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(run, null, 2) + "\n");
  for (const c of run.cases) {
    console.log(`${c.passed ? "PASS" : "FAIL"}  ${c.id}`);
    for (const g of c.graders.filter((x) => !x.passed)) console.log(`        x ${g.name}: ${g.detail}`);
  }
  console.log(`\n${run.model}: ${run.passed}/${run.total} passed. Saved ${out}`);
  return run.passed === run.total ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
