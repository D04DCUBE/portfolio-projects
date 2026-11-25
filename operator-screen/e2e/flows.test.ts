// Real-browser tests: the flows a technician runs every day. Needs a built dist/ (npm run e2e builds it).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, type Running } from "../server/server.ts";

let server: Running;
let browser: Browser;
let page: Page;
let base = "";
const shot = process.env.SHOTS ? (name: string) => page.screenshot({ path: `docs/${name}.png` }) : async (_: string) => {};

before(async () => {
  server = await startServer();
  base = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch();
});
after(async () => { await browser.close(); await server.close(); });

async function fresh() {
  await fetch(`${base}/sim/reset`, { method: "POST", body: "{}" });
  page?.close();
  page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  await page.goto(base);
  await page.getByText("Enter your PIN").waitFor();
}
const sim = (a: string, body = "{}") => fetch(`${base}/sim/${a}`, { method: "POST", body });
async function pin(digits: string) { for (const d of digits) await page.getByRole("button", { name: d, exact: true }).tap(); }
async function signIn() { await pin("1234"); await page.getByText("Queue · 5 open").waitFor(); }

test("a wrong PIN is refused with a plain message, the right one signs in", async () => {
  await fresh();
  await shot("01-sign-in");
  await pin("0000");
  await page.getByText("That PIN was not recognised.").waitFor();
  await signIn();
  await page.getByText("That PIN was not recognised.").waitFor({ state: "detached", timeout: 6000 });
  await shot("02-queue");
  assert.ok(await page.getByText("Maya R.").isVisible());
});

test("a prescription runs on drawer events alone", async () => {
  await fresh(); await signIn();
  await page.getByRole("button", { name: "Start" }).tap();
  await page.getByText("The machine is picking").waitFor();
  await shot("03-picking");
  // The screen shows no button that could advance it.
  assert.equal(await page.getByRole("button", { name: /next|continue|done/i }).count(), 0);
  await sim("drawer-open");
  await page.getByText("Take 30 × Lisinopril 10 mg").waitFor();
  await shot("04-remove-items");
  await sim("drawer-close");
  await page.getByText("Queue · 4 open").waitFor();
  assert.equal(server.state().queue.find((p) => p.id === "RX-1041")?.status, "done");
});

test("a reload lands on the truth, mid-task and signed in", async () => {
  await fresh(); await signIn();
  await page.getByRole("button", { name: "Start" }).tap();
  await page.getByText("The machine is picking").waitFor();
  await page.reload();
  await page.getByText("The machine is picking").waitFor();
  await sim("drawer-open");
  await page.reload();
  await page.getByText("Take 30 × Lisinopril 10 mg").waitFor();
  await sim("drawer-close");
  await page.getByText("Queue · 4 open").waitFor();
});

test("a fault blocks the whole screen and lifts when the machine clears it", async () => {
  await fresh(); await signIn();
  await sim("fault", JSON.stringify({ code: "E42", message: "Gripper jam" }));
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  await shot("05-fault");
  assert.match(await dialog.innerText(), /Gripper jam/);
  // Nothing behind the dialog can be tapped.
  assert.equal(await page.locator("nav[aria-label=Screens]").evaluate((el) => !!el.closest("[inert]")), true);
  await sim("clear-fault");
  await dialog.waitFor({ state: "detached" });
});

test("a task that is running when the fault hits is stopped and returned to the queue", async () => {
  await fresh(); await signIn();
  await page.getByRole("button", { name: "Start" }).tap();
  await page.getByText("The machine is picking").waitFor();
  await sim("fault");
  await page.getByRole("alertdialog").waitFor();
  await sim("clear-fault");
  await page.getByText("Queue · 5 open").waitFor();
});

test("finishing a task that leaves stock low raises one banner that is acknowledged, not tapped away by accident", async () => {
  await fresh(); await signIn();
  await page.getByRole("button", { name: /RX-1043/ }).tap();
  await page.getByRole("button", { name: "Start" }).tap();
  await sim("drawer-open"); await sim("drawer-close");
  await page.getByText(/Amoxicillin 500 mg is low/).waitFor();
  await shot("06-low-stock-banner");
  await page.getByRole("button", { name: "Got it" }).tap();
  await page.getByText(/is low/).waitFor({ state: "detached" });
});

test("refill: pick a slot, set an amount, confirm", async () => {
  await fresh(); await signIn();
  await page.getByRole("button", { name: "Refill", exact: true }).tap();
  await page.getByRole("button", { name: /C2/ }).tap();
  await shot("07-refill");
  await page.getByRole("button", { name: "Remove 1", exact: true }).tap();
  await page.getByRole("button", { name: "Confirm refill" }).tap();
  await page.waitForFunction(() => document.body.innerText.includes("Pick a slot."));
  assert.equal(server.state().stock.find((s) => s.slot === "C2")?.count, 11);
});

test("removing a prescription needs a long press; a quick tap does nothing", async () => {
  await fresh(); await signIn();
  await page.getByRole("button", { name: "Admin" }).tap();
  await page.getByRole("button", { name: /RX-1042/ }).tap();
  await shot("08-admin");
  const hold = page.getByRole("button", { name: /Hold to remove/ });
  await hold.tap();
  await page.waitForTimeout(300);
  assert.equal(server.state().queue.find((p) => p.id === "RX-1042")?.status, "waiting");
  const box = (await hold.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.waitForFunction(() => !document.body.innerText.includes("RX-1042"));
  assert.equal(server.state().queue.find((p) => p.id === "RX-1042")?.status, "cancelled");
});

test("every tappable control on every screen is at least 48 px", async () => {
  await fresh();
  const tooSmall = async (where: string) => {
    const seen = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null).length);
    assert.ok(seen >= 4, `${where}: only ${seen} buttons found, the check would be vacuous`);
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent !== null)
        .map((b) => ({ t: (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().slice(0, 20), r: b.getBoundingClientRect() }))
        .filter((x) => x.r.width < 48 || x.r.height < 48)
        .map((x) => `${x.t} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`));
    assert.deepEqual(bad, [], where);
  };
  await tooSmall("sign in");
  await signIn();
  for (const tab of ["Queue", "Refill", "Health", "Admin"]) {
    await page.getByRole("button", { name: tab, exact: true }).tap();
    await tooSmall(tab);
  }
  await page.getByRole("button", { name: "Refill", exact: true }).tap();
  await page.getByRole("button", { name: /C2/ }).tap();
  await tooSmall("refill stepper");
  await page.getByRole("button", { name: "Health", exact: true }).tap();
  await shot("09-health");
});

test("targets keep a gap between them", async () => {
  await fresh(); await signIn();
  const gaps = await page.evaluate(() => {
    const rects = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect());
    let min = Infinity;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!;
      const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      min = Math.min(min, Math.hypot(dx, dy));
    }
    return min;
  });
  assert.ok(gaps >= 8, `closest targets are ${gaps}px apart`);
});

test("losing the connection is shown, and the screen recovers on its own", async () => {
  await fresh(); await signIn();
  await server.close().catch(() => {});
  await page.getByText(/Reconnecting|Connecting/).first().waitFor({ timeout: 10000 });
  server = await startServer({ port: Number(new URL(base).port) });
  await page.getByText("Enter your PIN").waitFor({ timeout: 15000 });
});
