// The machine's domain logic. This is the only place domain state changes.
// It is a pure reducer: (state, input) -> { state } or { rejected }. The screen never imports this.
import type { Alert, Command, ExceptionReason, MachineState, Prescription, RejectReason, StockItem } from "../contract.gen.ts";

export type PhysicalEvent =
  | { readonly type: "drawerOpened" }
  | { readonly type: "drawerClosed" }
  | { readonly type: "fault"; readonly code: string; readonly message: string }
  | { readonly type: "faultCleared" };

export type Input = Command | PhysicalEvent;
export type Result = { readonly state: MachineState; readonly rejected?: undefined } | { readonly state: MachineState; readonly rejected: RejectReason };

// Demo PINs. All names, patients and drugs here are made up.
export const USERS: Readonly<Record<string, string>> = { "1234": "Maya R.", "4321": "Jon T." };

export function initialState(): MachineState {
  const rx = (id: string, patient: string, drug: string, slot: string, qty: number): Prescription => ({
    id, patient, drug, slot, qty, status: "waiting", exceptionReason: null,
  });
  const item = (slot: string, name: string, kind: StockItem["kind"], count: number, par: number, capacity: number): StockItem => ({
    slot, name, kind, count, par, capacity,
  });
  return {
    version: 1,
    session: null,
    drawer: "closed",
    health: { status: "ok" },
    active: null,
    queue: [
      rx("RX-1041", "J.M.", "Lisinopril 10 mg", "A2", 30),
      rx("RX-1042", "S.K.", "Metformin 500 mg", "A3", 60),
      rx("RX-1043", "D.O.", "Amoxicillin 500 mg", "A1", 21),
      rx("RX-1044", "L.P.", "Atorvastatin 20 mg", "A4", 30),
      rx("RX-1045", "R.T.", "Lisinopril 10 mg", "A2", 90),
    ],
    stock: [
      item("A1", "Amoxicillin 500 mg", "drug", 44, 40, 200),
      item("A2", "Lisinopril 10 mg", "drug", 190, 100, 400),
      item("A3", "Metformin 500 mg", "drug", 240, 100, 400),
      item("A4", "Atorvastatin 20 mg", "drug", 120, 60, 300),
      item("C1", "Vial caps", "consumable", 80, 50, 300),
      item("C2", "Label rolls", "consumable", 6, 3, 12),
    ],
    alerts: [],
  };
}

const lowStockId = (slot: string) => `low_stock-${slot}`;
const exceptionId = (id: string) => `rx_exception-${id}`;

function bump(s: MachineState, patch: Partial<MachineState>): MachineState {
  return { ...s, ...patch, version: s.version + 1 };
}

function reject(state: MachineState, reason: RejectReason): Result {
  return { state, rejected: reason };
}

function withAlert(alerts: readonly Alert[], alert: Alert): readonly Alert[] {
  return [...alerts.filter((a) => a.id !== alert.id), alert];
}

function withoutAlert(alerts: readonly Alert[], id: string): readonly Alert[] {
  return alerts.filter((a) => a.id !== id);
}

function setStatus(queue: readonly Prescription[], id: string, status: Prescription["status"], exceptionReason: ExceptionReason | null): readonly Prescription[] {
  return queue.map((p) => (p.id === id ? { ...p, status, exceptionReason } : p));
}

export function reduce(state: MachineState, input: Input): Result {
  switch (input.type) {
    // ---- physical events: the screen advances on these, never on extra taps ----
    case "drawerOpened": {
      if (state.drawer === "open") return { state };
      if (state.active?.step === "picking") {
        return { state: bump(state, { drawer: "open", active: { ...state.active, step: "remove_items" } }) };
      }
      return {
        state: bump(state, {
          drawer: "open",
          alerts: withAlert(state.alerts, {
            id: "drawer_unexpected", kind: "drawer_unexpected", severity: "warning",
            text: "The drawer was opened with no task running.", needsAck: true,
          }),
        }),
      };
    }
    case "drawerClosed": {
      if (state.drawer === "closed") return { state };
      const active = state.active;
      if (active?.step !== "remove_items") return { state: bump(state, { drawer: "closed", alerts: withoutAlert(state.alerts, "drawer_unexpected") }) };
      const rx = state.queue.find((p) => p.id === active.prescriptionId);
      let alerts = state.alerts;
      const stock = state.stock.map((it) => {
        if (!rx || it.slot !== rx.slot) return it;
        const next = { ...it, count: Math.max(0, it.count - rx.qty) };
        if (next.count < next.par) {
          alerts = withAlert(alerts, {
            id: lowStockId(it.slot), kind: "low_stock", severity: "warning",
            text: `${it.name} is low: ${next.count} left, refill at ${it.par}.`, needsAck: true,
          });
        }
        return next;
      });
      return { state: bump(state, { drawer: "closed", active: null, queue: setStatus(state.queue, active.prescriptionId, "done", null), stock, alerts }) };
    }
    case "fault": {
      let queue = state.queue;
      if (state.active) queue = setStatus(queue, state.active.prescriptionId, "waiting", null);
      return {
        state: bump(state, {
          health: { status: "fault", code: input.code, message: input.message },
          active: null,
          queue,
          alerts: withAlert(state.alerts, {
            id: "fault", kind: "fault", severity: "critical",
            text: `Machine fault ${input.code}: ${input.message}${state.active ? " The running task was stopped and the prescription is back in the queue." : ""}`,
            needsAck: false,
          }),
        }),
      };
    }
    case "faultCleared": {
      if (state.health.status === "ok") return { state };
      return { state: bump(state, { health: { status: "ok" }, alerts: withoutAlert(state.alerts, "fault") }) };
    }

    // ---- commands from the screen ----
    case "signIn": {
      if (state.session) return reject(state, "already_signed_in");
      const user = USERS[input.pin];
      if (!user) return reject(state, "bad_pin");
      return { state: bump(state, { session: { user } }) };
    }
    case "signOut": {
      if (!state.session) return reject(state, "not_signed_in");
      if (state.active) return reject(state, "task_active");
      return { state: bump(state, { session: null }) };
    }
  }

  // Every remaining command needs a signed-in user.
  if (!state.session) return reject(state, "not_signed_in");

  switch (input.type) {
    case "startPrescription": {
      if (state.health.status === "fault") return reject(state, "fault_active");
      if (state.active) return reject(state, "task_active");
      const rx = state.queue.find((p) => p.id === input.id);
      if (!rx) return reject(state, "not_found");
      if (rx.status !== "waiting") return reject(state, "wrong_status");
      const slot = state.stock.find((it) => it.slot === rx.slot);
      if (!slot || slot.count < rx.qty) return reject(state, "insufficient_stock");
      return { state: bump(state, { active: { prescriptionId: rx.id, step: "picking" }, queue: setStatus(state.queue, rx.id, "in_progress", null) }) };
    }
    case "reportException": {
      const rx = state.queue.find((p) => p.id === input.id);
      if (!rx) return reject(state, "not_found");
      if (rx.status !== "waiting") return reject(state, "wrong_status");
      return {
        state: bump(state, {
          queue: setStatus(state.queue, rx.id, "exception", input.reason),
          alerts: withAlert(state.alerts, {
            id: exceptionId(rx.id), kind: "rx_exception", severity: "warning",
            text: `${rx.id} for ${rx.patient} needs a pharmacist: ${input.reason.replace(/_/g, " ")}.`, needsAck: true,
          }),
        }),
      };
    }
    case "retryPrescription": {
      const rx = state.queue.find((p) => p.id === input.id);
      if (!rx) return reject(state, "not_found");
      if (rx.status !== "exception") return reject(state, "wrong_status");
      return { state: bump(state, { queue: setStatus(state.queue, rx.id, "waiting", null), alerts: withoutAlert(state.alerts, exceptionId(rx.id)) }) };
    }
    case "cancelPrescription": {
      const rx = state.queue.find((p) => p.id === input.id);
      if (!rx) return reject(state, "not_found");
      if (rx.status !== "waiting" && rx.status !== "exception") return reject(state, "wrong_status");
      return { state: bump(state, { queue: setStatus(state.queue, rx.id, "cancelled", null), alerts: withoutAlert(state.alerts, exceptionId(rx.id)) }) };
    }
    case "restock": {
      const it = state.stock.find((x) => x.slot === input.slot);
      if (!it) return reject(state, "not_found");
      if (!Number.isInteger(input.count) || input.count <= 0) return reject(state, "bad_amount");
      const count = Math.min(it.capacity, it.count + input.count);
      let alerts = state.alerts;
      if (count >= it.par) alerts = withoutAlert(alerts, lowStockId(it.slot));
      return { state: bump(state, { stock: state.stock.map((x) => (x.slot === it.slot ? { ...x, count } : x)), alerts }) };
    }
    case "ackAlert": {
      const alert = state.alerts.find((a) => a.id === input.id);
      if (!alert) return reject(state, "not_found");
      if (!alert.needsAck) return reject(state, "wrong_status");
      return { state: bump(state, { alerts: withoutAlert(state.alerts, alert.id) }) };
    }
  }
}
