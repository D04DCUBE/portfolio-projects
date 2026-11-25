import { useState } from "react";

// A keypad drawn by the application: there is no keyboard on the machine.
export function Keypad(props: { length: number; onComplete: (pin: string) => void; disabled?: boolean }) {
  const { length, onComplete, disabled = false } = props;
  const [digits, setDigits] = useState("");
  const press = (d: string) => {
    if (disabled) return;
    const next = digits + d;
    if (next.length >= length) { setDigits(""); onComplete(next); }
    else setDigits(next);
  };
  const key = "min-h-key min-w-key rounded-panel bg-surface-2 border border-line text-hero font-semibold";
  return (
    <div className="flex flex-col items-center gap-gap">
      <div role="status" aria-label={`${digits.length} of ${length} digits entered`} className="flex min-h-key items-center gap-4">
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`h-dot w-dot rounded-full border-2 ${i < digits.length ? "border-accent bg-accent" : "border-muted"}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-gap">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" disabled={disabled} className={key} onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className={`${key} text-glance`} disabled={disabled || digits.length === 0} onClick={() => setDigits("")}>Clear</button>
        <button type="button" disabled={disabled} className={key} onClick={() => press("0")}>0</button>
        <button type="button" className={`${key} text-glance`} disabled={disabled || digits.length === 0} aria-label="Delete last digit" onClick={() => setDigits(digits.slice(0, -1))}>⌫</button>
      </div>
    </div>
  );
}
