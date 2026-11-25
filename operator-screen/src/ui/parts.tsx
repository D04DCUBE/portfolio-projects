import { useEffect, useRef, useState, type ReactNode } from "react";

type Tone = "primary" | "neutral" | "danger";
const TONE: Record<Tone, string> = {
  primary: "bg-accent text-accent-ink",
  neutral: "bg-surface-2 text-ink border border-line",
  danger: "bg-danger text-danger-ink",
};

export function Btn(props: { children: ReactNode; onPress: () => void; tone?: Tone; disabled?: boolean; label?: string; wide?: boolean }) {
  const { children, onPress, tone = "neutral", disabled = false, label, wide = false } = props;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className={`min-h-key min-w-key rounded-panel px-6 text-glance font-semibold ${TONE[tone]} ${wide ? "w-full" : ""}`}
    >
      {children}
    </button>
  );
}

export function Pill(props: { tone: "ok" | "warn" | "danger" | "muted"; children: ReactNode }) {
  const cls = {
    ok: "border-ok text-ok",
    warn: "border-warn text-warn",
    danger: "border-danger text-danger",
    muted: "border-line text-muted",
  }[props.tone];
  return <span className={`inline-flex min-h-touch items-center gap-2 rounded-panel border-2 px-4 text-body font-semibold ${cls}`}>{props.children}</span>;
}

const suppress = (e: { preventDefault(): void }) => e.preventDefault(); // no long-press menu on a touch panel

// For actions that cannot be undone: a long press, so a stray or fast tap does nothing.
export function HoldButton(props: { children: ReactNode; onConfirm: () => void; holdMs?: number; disabled?: boolean }) {
  const { children, onConfirm, holdMs = 1200, disabled = false } = props;
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => { timer.current = null; setHolding(false); onConfirm(); }, holdMs);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={suppress}
      className="relative min-h-key w-full overflow-hidden rounded-panel border-2 border-danger bg-surface px-6 text-glance font-semibold text-danger"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-danger/40"
        style={{ width: holding ? "100%" : "0%", transition: holding ? `width ${holdMs}ms linear` : "none" }}
      />
      <span className="relative">{holding ? "Keep holding…" : children}</span>
    </button>
  );
}

export function Panel(props: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-panel border border-line bg-surface p-6 ${props.className ?? ""}`}>
      {props.title ? <h2 className="mb-4 text-glance font-bold text-muted">{props.title}</h2> : null}
      {props.children}
    </section>
  );
}
