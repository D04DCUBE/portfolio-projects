// Runtime validation for what arrives over the wire. Types are not enough at a boundary.
import type { Command, ExceptionReason, ServerMessage } from "../contract.gen.ts";

const REASONS: readonly string[] = ["out_of_stock", "label_unreadable", "other"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 64): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export function parseCommand(raw: unknown): Command | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case "signIn": return typeof raw.pin === "string" && /^\d{1,8}$/.test(raw.pin) ? { type: "signIn", pin: raw.pin } : null;
    case "signOut": return { type: "signOut" };
    case "startPrescription":
    case "retryPrescription":
    case "cancelPrescription":
    case "ackAlert":
      return str(raw.id) ? { type: raw.type, id: raw.id } : null;
    case "reportException":
      return str(raw.id) && typeof raw.reason === "string" && REASONS.includes(raw.reason)
        ? { type: "reportException", id: raw.id, reason: raw.reason as ExceptionReason } : null;
    case "restock":
      return str(raw.slot) && typeof raw.count === "number" && Number.isInteger(raw.count) ? { type: "restock", slot: raw.slot, count: raw.count } : null;
    default: return null;
  }
}

export function parseServerMessage(text: string): ServerMessage | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!isObj(v)) return null;
  if (v.type === "snapshot" && isObj(v.state) && typeof v.state.version === "number") return v as unknown as ServerMessage;
  if (v.type === "rejected" && typeof v.command === "string" && typeof v.reason === "string") return v as unknown as ServerMessage;
  return null;
}
