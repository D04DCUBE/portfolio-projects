// The eval suite. Each case is a customer message plus what a correct agent must (and must not) do.
import { calledBefore, calledTool, finished, maxToolCalls, notCalledTool, refundIssued, replyExcludes, replyIncludes } from "./graders.ts";
import type { EvalCase } from "./types.ts";

const CLAIMS_REFUND = /i['’]ve (processed|refunded|issued)|processed your refund|refund (has been|was) (issued|processed)/i;

export const CASES: EvalCase[] = [
  {
    id: "refund-eligible",
    description: "Delivered 17 days ago, inside the window: refund the full amount, after checking.",
    prompt: "Hi, I'm alice@example.com. Please refund order A1001, the mugs arrived broken.",
    graders: [finished(), calledBefore("check_refund_eligibility", "issue_refund"), refundIssued("A1001", 48), replyIncludes("the amount", /\$?48/)],
  },
  {
    id: "refund-outside-window",
    description: "Delivered 79 days ago: no refund, and the reply must say why.",
    prompt: "Please refund order A1002, I don't want the desk mat any more.",
    graders: [finished(), notCalledTool("issue_refund"), replyIncludes("the 30-day window", /30-day|window/i), replyExcludes("a refund was made", CLAIMS_REFUND)],
  },
  {
    id: "refund-not-delivered",
    description: "Still in transit: no refund; the reply says it has not arrived.",
    prompt: "I want a refund for order A1003.",
    graders: [finished(), notCalledTool("issue_refund"), replyIncludes("that it is not delivered", /not delivered|shipped/i), replyExcludes("a refund was made", CLAIMS_REFUND)],
  },
  {
    id: "already-refunded",
    description: "Already refunded: do not refund twice.",
    prompt: "Refund order A1004 please.",
    graders: [finished(), notCalledTool("issue_refund"), replyIncludes("it was already refunded", /already/i), replyExcludes("a refund was made", CLAIMS_REFUND)],
  },
  {
    id: "partial-refund",
    description: "Customer asks for $50 of a $200 order: refund exactly $50.",
    prompt: "Hello, dan@example.com here. Could you refund $50 of order A1005? The arm is fine, I just want some money back for the scratch.",
    graders: [finished(), calledBefore("check_refund_eligibility", "issue_refund"), refundIssued("A1005", 50)],
  },
  {
    id: "status-question",
    description: "A plain status question must not touch refunds, and should be quick.",
    prompt: "Where is order A1003?",
    graders: [finished(), notCalledTool("issue_refund"), maxToolCalls(2), replyIncludes("the status", /shipped/i)],
  },
  {
    id: "unknown-order",
    description: "Order does not exist: say so, do not guess.",
    prompt: "Refund order A9999.",
    graders: [finished(), notCalledTool("issue_refund"), replyIncludes("that it was not found", /couldn['’]t find|not found/i), replyExcludes("a refund was made", CLAIMS_REFUND)],
  },
  {
    id: "list-orders",
    description: "List orders for an email address.",
    prompt: "What orders does alice@example.com have?",
    graders: [finished(), calledTool("list_orders"), replyIncludes("A1001", /A1001/), replyIncludes("A1002", /A1002/)],
  },
];
