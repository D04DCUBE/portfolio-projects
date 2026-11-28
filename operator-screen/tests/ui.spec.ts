// UI tests in a real browser: the flows a technician runs every day.
// SHOTS=1 also saves the README screenshots to docs/.
import { test, expect, type Page } from "playwright/test";
import { machine, reset, sim } from "./helpers.ts";

const shot = (page: Page, name: string) => (process.env.SHOTS ? page.screenshot({ path: `docs/${name}.png` }) : Promise.resolve());

async function pin(page: Page, digits: string) {
  for (const d of digits) await page.getByRole("button", { name: d, exact: true }).tap();
}
async function signIn(page: Page) {
  await pin(page, "1234");
  await expect(page.getByText("Queue · 5 open")).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await reset(request);
  await page.goto("/");
  await expect(page.getByText("Enter your PIN")).toBeVisible();
});

test("a wrong PIN is refused with a plain message, the right one signs in", async ({ page }) => {
  await shot(page, "01-sign-in");
  await pin(page, "0000");
  await expect(page.getByText("That PIN was not recognised.")).toBeVisible();
  await signIn(page);
  await expect(page.getByText("Maya R.")).toBeVisible();
  await expect(page.getByText("That PIN was not recognised.")).toBeHidden({ timeout: 6000 });
  await shot(page, "02-queue");
});

test("a prescription runs on drawer events alone", async ({ page, request }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Start" }).tap();
  await expect(page.getByText("The machine is picking")).toBeVisible();
  await shot(page, "03-picking");
  await expect(page.getByRole("button", { name: /next|continue|done/i })).toHaveCount(0);
  await sim(request, "drawer-open");
  await expect(page.getByText("Take 30 × Lisinopril 10 mg")).toBeVisible();
  await shot(page, "04-remove-items");
  await sim(request, "drawer-close");
  await expect(page.getByText("Queue · 4 open")).toBeVisible();
  expect((await machine(request)).queue.find((p) => p.id === "RX-1041")?.status).toBe("done");
});

test("a reload lands on the truth, mid-task and signed in", async ({ page, request }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Start" }).tap();
  await expect(page.getByText("The machine is picking")).toBeVisible();
  await page.reload();
  await expect(page.getByText("The machine is picking")).toBeVisible();
  await sim(request, "drawer-open");
  await page.reload();
  await expect(page.getByText("Take 30 × Lisinopril 10 mg")).toBeVisible();
  await sim(request, "drawer-close");
  await expect(page.getByText("Queue · 4 open")).toBeVisible();
});

test("a fault blocks the whole screen and lifts when the machine clears it", async ({ page, request }) => {
  await signIn(page);
  await sim(request, "fault", { code: "E42", message: "Gripper jam" });
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Gripper jam");
  await shot(page, "05-fault");
  // Nothing behind the dialog can be tapped.
  expect(await page.locator("nav[aria-label=Screens]").evaluate((el) => !!el.closest("[inert]"))).toBe(true);
  await sim(request, "clear-fault");
  await expect(dialog).toBeHidden();
});

test("a task running when a fault hits is stopped and returned to the queue", async ({ page, request }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Start" }).tap();
  await expect(page.getByText("The machine is picking")).toBeVisible();
  await sim(request, "fault");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await sim(request, "clear-fault");
  await expect(page.getByText("Queue · 5 open")).toBeVisible();
});

test("low stock raises one banner that is acknowledged, not tapped away by accident", async ({ page, request }) => {
  await signIn(page);
  await page.getByRole("button", { name: /RX-1043/ }).tap();
  await page.getByRole("button", { name: "Start" }).tap();
  await sim(request, "drawer-open");
  await sim(request, "drawer-close");
  await expect(page.getByText(/Amoxicillin 500 mg is low/)).toBeVisible();
  await shot(page, "06-low-stock-banner");
  await page.getByRole("button", { name: "Got it" }).tap();
  await expect(page.getByText(/is low/)).toBeHidden();
});

test("refill: pick a slot, set an amount, confirm", async ({ page, request }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Refill", exact: true }).tap();
  await page.getByRole("button", { name: /C2/ }).tap();
  await shot(page, "07-refill");
  await page.getByRole("button", { name: "Remove 1", exact: true }).tap();
  await page.getByRole("button", { name: "Confirm refill" }).tap();
  await expect(page.getByText("Pick a slot.")).toBeVisible();
  expect((await machine(request)).stock.find((s) => s.slot === "C2")?.count).toBe(11);
});

test("removing a prescription needs a long press; a quick tap does nothing", async ({ page, request }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Admin" }).tap();
  await page.getByRole("button", { name: /RX-1042/ }).tap();
  await shot(page, "08-admin");
  const hold = page.getByRole("button", { name: /Hold to remove/ });
  await hold.tap();
  await page.waitForTimeout(300);
  expect((await machine(request)).queue.find((p) => p.id === "RX-1042")?.status).toBe("waiting");
  const box = (await hold.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /RX-1042/ })).toHaveCount(0);
  expect((await machine(request)).queue.find((p) => p.id === "RX-1042")?.status).toBe("cancelled");
});

async function visibleButtons(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ label: (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().slice(0, 20), r: b.getBoundingClientRect().toJSON() as DOMRect })));
}

test("every tappable control on every screen is at least 48 px", async ({ page }) => {
  const check = async (where: string) => {
    const buttons = await visibleButtons(page);
    expect(buttons.length, `${where}: the check would be empty`).toBeGreaterThanOrEqual(4);
    const small = buttons.filter((b) => b.r.width < 48 || b.r.height < 48).map((b) => `${b.label} ${Math.round(b.r.width)}x${Math.round(b.r.height)}`);
    expect(small, where).toEqual([]);
  };
  await check("sign in");
  await signIn(page);
  for (const tab of ["Queue", "Refill", "Health", "Admin"]) {
    await page.getByRole("button", { name: tab, exact: true }).tap();
    await check(tab);
  }
  await page.getByRole("button", { name: "Refill", exact: true }).tap();
  await page.getByRole("button", { name: /C2/ }).tap();
  await check("refill stepper");
  await page.getByRole("button", { name: "Health", exact: true }).tap();
  await shot(page, "09-health");
});

test("targets keep a gap between them", async ({ page }) => {
  await signIn(page);
  const rects = (await visibleButtons(page)).map((b) => b.r);
  let min = Infinity;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i]!, b = rects[j]!;
    const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
    min = Math.min(min, Math.hypot(dx, dy));
  }
  expect(min).toBeGreaterThanOrEqual(8);
});

test("the simulator page drives the machine like hardware would", async ({ page, request }) => {
  await page.goto("/sim");
  await page.getByRole("button", { name: "Drawer opens" }).click();
  await expect(page.getByRole("status")).toContainText("sent");
  expect((await machine(request)).drawer).toBe("open");
  await page.getByRole("button", { name: "Drawer closes" }).click();
  await expect.poll(async () => (await machine(request)).drawer).toBe("closed");
});
