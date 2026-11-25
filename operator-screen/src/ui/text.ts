import type { ExceptionReason, PrescriptionStatus, RejectReason } from "../contract.gen.ts";

export const REJECT_TEXT: Readonly<Record<RejectReason, string>> = {
  bad_pin: "That PIN was not recognised.",
  not_signed_in: "Sign in first.",
  already_signed_in: "Someone is already signed in.",
  fault_active: "The machine has a fault. Work is paused.",
  task_active: "Finish the running task first.",
  not_found: "The machine could not find that item.",
  wrong_status: "That is not possible in the current state.",
  insufficient_stock: "Not enough stock. Refill first.",
  bad_amount: "That amount is not valid.",
};

export const REASON_TEXT: Readonly<Record<ExceptionReason, string>> = {
  out_of_stock: "Out of stock",
  label_unreadable: "Label unreadable",
  other: "Something else",
};

export const STATUS_TEXT: Readonly<Record<PrescriptionStatus, string>> = {
  waiting: "Waiting",
  in_progress: "In progress",
  done: "Done",
  exception: "Needs pharmacist",
  cancelled: "Removed",
};
