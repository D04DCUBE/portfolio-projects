// Stand-in "models": small hand-written policies, so evals run with no API key and give the same answer every time.
// They implement the same interface a real model adapter would. What matters is what the evals can tell apart.
import type { Json, Message, Model, ModelTurn, ToolResult } from "./types.ts";

const ORDER_ID = /\bA\d{4}\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const MONEY = /\$\s?(\d+(?:\.\d+)?)/;

const userText = (m: Message[]): string => (m[0] && m[0].role === "user" ? m[0].text : "");
const results = (m: Message[]): { name: string; result: ToolResult }[] =>
  m.flatMap((x) => (x.role === "tool" ? [{ name: x.name, result: x.result }] : []));
const asObject = (d: Json): Record<string, Json> => (d && typeof d === "object" && !Array.isArray(d) ? d : {});
const call = (name: string, args: Record<string, Json>): ModelTurn => ({ type: "tool_call", name, args });
const say = (text: string): ModelTurn => ({ type: "final", text });

/** Shared by both models: questions that are not refund requests. */
function answerStatusOrList(text: string, m: Message[]): ModelTurn | null {
  const id = text.match(ORDER_ID)?.[0]?.toUpperCase();
  const email = text.match(EMAIL)?.[0];
  const done = results(m);
  if (!/refund/i.test(text)) {
    if (id) {
      const r = done[0];
      if (!r) return call("lookup_order", { order_id: id });
      if (r.result.isError) return say(`I couldn't find an order with id ${id}.`);
      const o = asObject(r.result.data);
      return say(o["status"] === "delivered"
        ? `Order ${id} (${String(o["item"])}) was delivered on ${String(o["deliveredOn"])}.`
        : `Order ${id} (${String(o["item"])}) is ${String(o["status"])} and has not been delivered yet.`);
    }
    if (email) {
      const r = done[0];
      if (!r) return call("list_orders", { email });
      const list = Array.isArray(r.result.data) ? r.result.data : [];
      const ids = list.map((o) => String(asObject(o)["id"]));
      return say(ids.length ? `${email} has ${ids.length} order(s): ${ids.join(", ")}.` : `I found no orders for ${email}.`);
    }
    return say("Which order or email address do you mean?");
  }
  return null;
}

/** Looks the order up, checks eligibility, refunds only what is allowed, and reports what really happened. */
export const careful: Model = {
  id: "careful",
  async next(m) {
    const text = userText(m);
    const other = answerStatusOrList(text, m);
    if (other) return other;

    const id = text.match(ORDER_ID)?.[0]?.toUpperCase();
    if (!id) return say("Which order would you like refunded? Please send the order id.");
    const done = results(m);
    const lookup = done[0], check = done[1], refund = done[2];
    if (!lookup) return call("lookup_order", { order_id: id });
    if (lookup.result.isError) return say(`I couldn't find an order with id ${id}.`);
    if (!check) return call("check_refund_eligibility", { order_id: id });
    const c = asObject(check.result.data);
    if (c["eligible"] !== true) return say(`I can't refund order ${id}: ${String(c["reason"])}.`);
    const max = Number(c["max_refund"]);
    const asked = Number(text.match(MONEY)?.[1] ?? max);
    const amount = Math.min(asked, max);
    if (!refund) return call("issue_refund", { order_id: id, amount });
    return refund.result.isError
      ? say(`The refund for order ${id} did not go through: ${JSON.stringify(refund.result.data)}.`)
      : say(`I've refunded $${amount} for order ${id}.`);
  },
};

/** The kind of regression evals exist to catch: skips the eligibility check, ignores the amount asked for,
 *  and says the refund worked without reading the tool result. */
export const careless: Model = {
  id: "careless",
  async next(m) {
    const text = userText(m);
    const other = answerStatusOrList(text, m);
    if (other) return other;

    const id = text.match(ORDER_ID)?.[0]?.toUpperCase();
    if (!id) return say("Which order would you like refunded? Please send the order id.");
    const done = results(m);
    const lookup = done[0], refund = done[1];
    if (!lookup) return call("lookup_order", { order_id: id });
    if (lookup.result.isError) return say(`I couldn't find an order with id ${id}.`);
    const total = Number(asObject(lookup.result.data)["total"]);
    if (!refund) return call("issue_refund", { order_id: id, amount: total });
    return say(`I've processed your refund of $${total} for order ${id}.`);
  },
};

export const MODELS: Record<string, Model> = { careful, careless };
