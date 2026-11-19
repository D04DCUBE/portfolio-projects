import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES } from "../src/cases.ts";
import { compareRuns, summarizeChanges } from "../src/compare.ts";
import { careful, careless } from "../src/models.ts";
import { runSuite } from "../src/run-evals.ts";

const fixed = () => new Date("2026-11-19T12:00:00Z");

test("the careful policy passes every case", async () => {
  const run = await runSuite(careful, CASES, fixed);
  const failing = run.cases.filter((c) => !c.passed).map((c) => `${c.id}: ${c.graders.filter((g) => !g.passed).map((g) => g.name).join(", ")}`);
  assert.deepEqual(failing, []);
  assert.equal(run.passed, run.total);
  assert.equal(run.total, CASES.length);
});

test("the careless policy fails exactly the refund cases, and the evals say why", async () => {
  const run = await runSuite(careless, CASES, fixed);
  assert.deepEqual(run.cases.filter((c) => !c.passed).map((c) => c.id), ["refund-eligible", "refund-outside-window", "refund-not-delivered", "already-refunded", "partial-refund"]);
  const eligible = run.cases.find((c) => c.id === "refund-eligible")!;
  assert.deepEqual(eligible.graders.filter((g) => !g.passed).map((g) => g.name), ["check_refund_eligibility before issue_refund"], "right outcome, wrong process");
  const outside = run.cases.find((c) => c.id === "refund-outside-window")!;
  assert.ok(outside.graders.some((g) => !g.passed && g.name.startsWith("reply does not claim")), "caught the false 'refund processed' claim");
  const partial = run.cases.find((c) => c.id === "partial-refund")!;
  assert.match(partial.graders.find((g) => g.name.startsWith("refunded"))!.detail, /\$200/);
});

test("runs are repeatable: same model, same results", async () => {
  const a = await runSuite(careful, CASES, fixed), b = await runSuite(careful, CASES, fixed);
  assert.deepEqual(a, b);
});

test("compareRuns reports regressions, fixes and cases missing from one side", async () => {
  const good = await runSuite(careful, CASES, fixed), bad = await runSuite(careless, CASES, fixed);
  const regress = summarizeChanges(compareRuns(good, bad));
  assert.equal(regress.regressed, 5);
  assert.equal(regress["same-pass"], 3);
  assert.equal(summarizeChanges(compareRuns(bad, good)).fixed, 5);
  const partial = { ...good, cases: good.cases.slice(0, 2) };
  const s = summarizeChanges(compareRuns(good, partial));
  assert.equal(s["only-in-a"], CASES.length - 2);
  assert.equal(summarizeChanges(compareRuns(partial, good))["only-in-b"], CASES.length - 2);
});

test("each case gets a fresh server: running the same refund twice in one suite still works", async () => {
  const twice = [CASES[0]!, { ...CASES[0]!, id: "again" }];
  const run = await runSuite(careful, twice, fixed);
  assert.equal(run.passed, 2);
});
