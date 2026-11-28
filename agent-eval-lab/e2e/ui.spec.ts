// UI tests in a real browser: compare two runs, open a regression, step through what the agent did.
import { test, expect } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Baseline (A)").selectOption("careful.json");
  await page.getByLabel("Candidate (B)").selectOption("careless.json");
});

test("the summary shows both scores and the regressions", async ({ page }) => {
  await expect(page.getByRole("status")).toHaveText(/A: careful 8\/8\. B: careless 3\/8\. 5 regressed, 0 fixed\./);
  await expect(page.locator("#cases td.change-regressed")).toHaveCount(5);
});

test("open a regressed case and step through the agent's tool calls", async ({ page }) => {
  await page.locator("#cases tr", { has: page.locator("td.change-regressed") }).first().getByRole("button").click();
  const detail = page.locator("#detail");
  await expect(detail).toBeVisible();
  await expect(page.locator("#detail-title")).toBeFocused();
  await expect(page.locator("#stepinfo")).toHaveText(/^Step 1 of \d+$/);
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.locator("#stepinfo")).toHaveText(/^Step 2 of \d+$/);
  await page.getByRole("button", { name: "Show all" }).click();
  const [, last] = (await page.locator("#stepinfo").textContent())!.match(/of (\d+)/)!;
  await expect(page.locator("#stepinfo")).toHaveText(`Step ${last} of ${last}`);
});

test("model text from a run is shown as text, never as HTML", async ({ page }) => {
  await page.locator("#cases tr").first().getByRole("button").click();
  await page.getByRole("button", { name: "Show all" }).click();
  expect(await page.locator("#cols").evaluate((el) => el.querySelectorAll("script, img, iframe").length)).toBe(0);
});
