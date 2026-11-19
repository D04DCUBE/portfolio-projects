// Graders read a finished trace and say pass or fail with a reason. They never call a model.
import type { Grader, GraderResult, Trace } from "./types.ts";

const result = (name: string, passed: boolean, detail: string): GraderResult => ({ name, passed, detail });
const names = (t: Trace): string => (t.toolCalls.map((c) => c.name).join(" > ") || "no tool calls");

export const finished = (): Grader => (t) =>
  result("finished", t.stopped === "final", t.stopped === "final" ? "agent gave a final answer" : "agent ran out of steps");

export const calledTool = (name: string): Grader => (t) =>
  result(`called ${name}`, t.toolCalls.some((c) => c.name === name), names(t));

export const notCalledTool = (name: string): Grader => (t) =>
  result(`did not call ${name}`, !t.toolCalls.some((c) => c.name === name), names(t));

/** If `later` was called, `earlier` must have come first. Passes when `later` was never called. */
export const calledBefore = (earlier: string, later: string): Grader => (t) => {
  const iLater = t.toolCalls.findIndex((c) => c.name === later);
  const iEarlier = t.toolCalls.findIndex((c) => c.name === earlier);
  const passed = iLater === -1 || (iEarlier !== -1 && iEarlier < iLater);
  return result(`${earlier} before ${later}`, passed, names(t));
};

export const refundIssued = (orderId: string, amount: number): Grader => (t) => {
  const hit = t.toolCalls.find((c) => c.name === "issue_refund" && !c.result.isError && c.args["order_id"] === orderId && c.args["amount"] === amount);
  const all = t.toolCalls.filter((c) => c.name === "issue_refund").map((c) => `${String(c.args["order_id"])} $${String(c.args["amount"])}${c.result.isError ? " (refused)" : ""}`);
  return result(`refunded ${orderId} $${amount}`, Boolean(hit), all.length ? `refund calls: ${all.join("; ")}` : "no refund call");
};

export const maxToolCalls = (n: number): Grader => (t) =>
  result(`at most ${n} tool calls`, t.toolCalls.length <= n, `${t.toolCalls.length} calls`);

export const replyIncludes = (label: string, pattern: RegExp): Grader => (t) =>
  result(`reply mentions ${label}`, pattern.test(t.reply), t.reply ? `reply: "${t.reply}"` : "no reply");

/** For answers that must not claim something false, such as "refund processed" when it was refused. */
export const replyExcludes = (label: string, pattern: RegExp): Grader => (t) =>
  result(`reply does not claim ${label}`, !pattern.test(t.reply), t.reply ? `reply: "${t.reply}"` : "no reply");

export function grade(graders: Grader[], trace: Trace): GraderResult[] {
  return graders.map((g) => g(trace));
}
