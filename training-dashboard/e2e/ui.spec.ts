// UI tests in a real browser: live charts, comparing runs, starting and stopping a run.
import { test, expect } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("svg.chart")).toBeVisible();
});

test("the live run updates on its own", async ({ page }) => {
  await expect(page.locator("#pill")).toHaveText("Live");
  const first = await page.locator("#summary tbody tr").first().textContent();
  await expect.poll(async () => page.locator("#summary tbody tr").first().textContent(), { timeout: 5000 }).not.toBe(first);
});

test("ticking runs adds them to the comparison, up to four", async ({ page }) => {
  for (const id of ["r1", "r2", "r3", "r4", "r5"]) {
    const cb = page.locator(`#pick-${id}`);
    if (!(await cb.isChecked()) && !(await cb.isDisabled())) await cb.check();
  }
  await expect(page.locator("#runlist input:checked")).toHaveCount(4);
  await expect(page.locator("#pick-note")).toHaveText("4 selected. Untick one to pick another.");
  await expect(page.locator("#runlist input:not(:checked)").first()).toBeDisabled();
});

test("switching metric tabs relabels the chart, and the choice is in the URL", async ({ page }) => {
  await page.getByRole("tab", { name: "Reward" }).click();
  await expect(page.getByRole("tab", { name: "Reward" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/reward/);
  await page.reload();
  await expect(page.getByRole("tab", { name: "Reward" })).toHaveAttribute("aria-selected", "true");
});

test("the chart can be read with the keyboard", async ({ page }) => {
  await page.locator("svg.chart").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#announce")).toContainText(/step/i);
});

test("start a run from the form, then stop it", async ({ page }) => {
  await page.getByText("Start a new run").click();
  await page.getByLabel("Name").fill("from-the-ui");
  await page.getByLabel("Steps").fill("300");
  await page.getByRole("button", { name: "Start run" }).click();
  const item = page.locator("#runlist li", { hasText: "from-the-ui" });
  await expect(item).toContainText("Running");
  await page.getByRole("button", { name: "Stop from-the-ui" }).click();
  await expect(item).toContainText("Stopped");
});

test("bad settings show an error on the field and start nothing", async ({ page }) => {
  const before = await page.locator("#runlist li").count();
  await page.getByText("Start a new run").click();
  await page.getByLabel("Learning rate").fill("abc");
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(page.locator("#f-lr")).toHaveAttribute("error", /.+/);
  expect(await page.locator("#runlist li").count()).toBe(before);
});
