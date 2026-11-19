// The fake "shop" the agent works in. All data is invented. The date is fixed so every run is the same.
import type { Json, ToolResult, ToolSpec } from "./types.ts";

export const TODAY = "2026-11-19";
export const REFUND_WINDOW_DAYS = 30;

export interface Order {
  id: string;
  email: string;
  item: string;
  total: number;
  status: "processing" | "shipped" | "delivered";
  deliveredOn: string | null;
  refunded: number;
}

export function seedOrders(): Order[] {
  return [
    { id: "A1001", email: "alice@example.com", item: "Ceramic mug set", total: 48, status: "delivered", deliveredOn: "2026-11-02", refunded: 0 },
    { id: "A1002", email: "alice@example.com", item: "Standing desk mat", total: 120, status: "delivered", deliveredOn: "2026-09-01", refunded: 0 },
    { id: "A1003", email: "bob@example.com", item: "Desk lamp", total: 75, status: "shipped", deliveredOn: null, refunded: 0 },
    { id: "A1004", email: "carol@example.com", item: "Notebook pack", total: 30, status: "delivered", deliveredOn: "2026-11-10", refunded: 30 },
    { id: "A1005", email: "dan@example.com", item: "Monitor arm", total: 200, status: "delivered", deliveredOn: "2026-10-25", refunded: 0 },
  ];
}

export const TOOLS: ToolSpec[] = [
  {
    name: "lookup_order",
    description: "Get one order by its id (for example A1001).",
    inputSchema: { type: "object", properties: { order_id: { type: "string", description: "Order id" } }, required: ["order_id"] },
  },
  {
    name: "list_orders",
    description: "List all orders for a customer email address.",
    inputSchema: { type: "object", properties: { email: { type: "string", description: "Customer email" } }, required: ["email"] },
  },
  {
    name: "check_refund_eligibility",
    description: "Check whether an order can be refunded and the most that can be refunded. Always call this before issue_refund.",
    inputSchema: { type: "object", properties: { order_id: { type: "string", description: "Order id" } }, required: ["order_id"] },
  },
  {
    name: "issue_refund",
    description: "Refund part or all of an order. Moves money, so it cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { order_id: { type: "string", description: "Order id" }, amount: { type: "number", description: "Amount in dollars" } },
      required: ["order_id", "amount"],
    },
  },
];

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

const fail = (message: string): ToolResult => ({ isError: true, data: { error: message } });
const ok = (data: Json): ToolResult => ({ isError: false, data });

export function createWorld(orders: Order[] = seedOrders()) {
  const find = (id: unknown): Order | undefined => (typeof id === "string" ? orders.find((o) => o.id === id.trim().toUpperCase()) : undefined);

  function eligibility(o: Order): { eligible: boolean; reason: string; maxRefund: number } {
    if (o.refunded >= o.total) return { eligible: false, reason: "already refunded", maxRefund: 0 };
    if (o.status !== "delivered" || !o.deliveredOn) return { eligible: false, reason: `not delivered yet (status: ${o.status})`, maxRefund: 0 };
    const age = daysBetween(o.deliveredOn, TODAY);
    if (age > REFUND_WINDOW_DAYS) return { eligible: false, reason: `outside the ${REFUND_WINDOW_DAYS}-day refund window (delivered ${age} days ago)`, maxRefund: 0 };
    return { eligible: true, reason: `delivered ${age} days ago, inside the ${REFUND_WINDOW_DAYS}-day window`, maxRefund: o.total - o.refunded };
  }

  function call(name: string, args: Record<string, unknown>): ToolResult {
    switch (name) {
      case "lookup_order": {
        const o = find(args["order_id"]);
        return o ? ok({ ...o }) : fail(`No order with id ${String(args["order_id"])}`);
      }
      case "list_orders": {
        const email = typeof args["email"] === "string" ? args["email"].trim().toLowerCase() : "";
        return ok(orders.filter((o) => o.email === email).map((o) => ({ id: o.id, item: o.item, total: o.total, status: o.status })));
      }
      case "check_refund_eligibility": {
        const o = find(args["order_id"]);
        if (!o) return fail(`No order with id ${String(args["order_id"])}`);
        const e = eligibility(o);
        return ok({ order_id: o.id, eligible: e.eligible, reason: e.reason, max_refund: e.maxRefund });
      }
      case "issue_refund": {
        const o = find(args["order_id"]);
        if (!o) return fail(`No order with id ${String(args["order_id"])}`);
        const amount = args["amount"];
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return fail("amount must be a positive number");
        const e = eligibility(o);
        if (!e.eligible) return fail(`Refund refused: ${e.reason}`);
        if (amount > e.maxRefund) return fail(`Refund refused: amount ${amount} is more than the maximum ${e.maxRefund}`);
        o.refunded += amount;
        return ok({ order_id: o.id, refunded: amount, total_refunded: o.refunded });
      }
      default:
        return fail(`Unknown tool ${name}`);
    }
  }

  return { call, orders };
}
