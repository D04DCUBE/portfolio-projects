import { Keypad } from "./Keypad.tsx";

export function SignIn(props: { onPin: (pin: string) => void; disabled: boolean }) {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-6">
      <h2 className="text-hero font-bold">Enter your PIN</h2>
      <Keypad length={4} onComplete={props.onPin} disabled={props.disabled} />
      <p className="text-body text-muted">Demo PINs: 1234 or 4321</p>
    </main>
  );
}
