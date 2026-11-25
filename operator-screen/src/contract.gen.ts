// GENERATED from contract/machine.schema.json by scripts/gen-contract.ts. Do not edit.
// Run `npm run contract` after changing the schema; the build fails if this file is stale.

export type Drawer =
  "closed" | "open";

export type Severity =
  "info" | "warning" | "critical";

export type AlertKind =
  "low_stock" | "fault" | "rx_exception" | "drawer_unexpected";

export type ExceptionReason =
  "out_of_stock" | "label_unreadable" | "other";

export type PrescriptionStatus =
  "waiting" | "in_progress" | "done" | "exception" | "cancelled";

export type ActiveStep =
  "picking" | "remove_items";

export type StockKind =
  "drug" | "consumable";

export type RejectReason =
  "bad_pin" | "not_signed_in" | "already_signed_in" | "fault_active" | "task_active" | "not_found" | "wrong_status" | "insufficient_stock" | "bad_amount";

export type Health =
  {
  readonly status: "ok";
}
  | {
  readonly status: "fault";
  readonly code: string;
  readonly message: string;
};

export type Session =
  {
  readonly user: string;
};

export type Prescription =
  {
  readonly id: string;
  readonly patient: string;
  readonly drug: string;
  readonly slot: string;
  readonly qty: number;
  readonly status: PrescriptionStatus;
  readonly exceptionReason: ExceptionReason | null;
};

export type ActiveTask =
  {
  readonly prescriptionId: string;
  readonly step: ActiveStep;
};

export type StockItem =
  {
  readonly slot: string;
  readonly name: string;
  readonly kind: StockKind;
  readonly count: number;
  readonly par: number;
  readonly capacity: number;
};

export type Alert =
  {
  readonly id: string;
  readonly kind: AlertKind;
  readonly severity: Severity;
  readonly text: string;
  readonly needsAck: boolean;
};

export type MachineState =
  {
  readonly version: number;
  readonly session: Session | null;
  readonly drawer: Drawer;
  readonly health: Health;
  readonly active: ActiveTask | null;
  readonly queue: readonly Prescription[];
  readonly stock: readonly StockItem[];
  readonly alerts: readonly Alert[];
};

export type Command =
  {
  readonly type: "signIn";
  readonly pin: string;
}
  | {
  readonly type: "signOut";
}
  | {
  readonly type: "startPrescription";
  readonly id: string;
}
  | {
  readonly type: "reportException";
  readonly id: string;
  readonly reason: ExceptionReason;
}
  | {
  readonly type: "retryPrescription";
  readonly id: string;
}
  | {
  readonly type: "cancelPrescription";
  readonly id: string;
}
  | {
  readonly type: "restock";
  readonly slot: string;
  readonly count: number;
}
  | {
  readonly type: "ackAlert";
  readonly id: string;
};

export type ServerMessage =
  {
  readonly type: "snapshot";
  readonly state: MachineState;
}
  | {
  readonly type: "rejected";
  readonly command: string;
  readonly reason: RejectReason;
};
