// UI tests for the components themselves, in a real browser: roles, labels, keyboard, focus and themes.
import { test, expect } from "playwright/test";

test.beforeEach(async ({ page }) => { await page.goto("/"); });

test.describe("ds-button", () => {
  test("is a real button with its text as its name; disabled means disabled", async ({ page }) => {
    for (const name of ["Primary", "Secondary", "Ghost", "Danger", "Small"]) await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Disabled", exact: true })).toBeDisabled();
  });

  test("an aria-label on <ds-button> names the inner button", async ({ page }) => {
    await page.evaluate(() => {
      const b = document.createElement("ds-button");
      b.setAttribute("aria-label", "Stop run seven"); b.textContent = "Stop";
      document.querySelector("main").append(b);
    });
    await expect(page.getByRole("button", { name: "Stop run seven" })).toBeVisible();
    await page.evaluate(() => document.querySelector('ds-button[aria-label]').removeAttribute("aria-label"));
    await expect(page.getByRole("button", { name: "Stop run seven" })).toHaveCount(0);
  });

  test("works from the keyboard: Enter and Space press it", async ({ page }) => {
    const opener = page.getByRole("button", { name: "Delete item..." });
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await opener.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test.describe("ds-text-field", () => {
  test("the label names the input and the hint describes it", async ({ page }) => {
    const field = page.getByLabel("Full name").first();
    await expect(field).toBeEditable();
    await expect(field).toHaveAccessibleDescription("As it appears on your ID.");
  });

  test("an error is announced and marks the input invalid", async ({ page }) => {
    const email = page.getByLabel("Email").first();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAccessibleDescription(/Enter a valid email address\./);
  });

  test("a disabled field cannot be edited", async ({ page }) => {
    await expect(page.getByLabel("Disabled field")).toBeDisabled();
  });
});

test.describe("ds-dialog", () => {
  test("opens with focus inside, Tab never reaches the page behind, Escape closes and returns focus", async ({ page }) => {
    const opener = page.getByRole("button", { name: "Delete item..." });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Delete this item?" });
    await expect(dialog).toBeVisible();
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      // Native showModal(): Tab cycles the dialog's controls and the browser's own UI (focus on <body>), never the page.
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return "browser";
        return el.closest("ds-dialog") ? el.id || el.tagName : "PAGE:" + (el.id || el.tagName);
      });
      expect(where, `Tab ${i + 1}`).not.toMatch(/^PAGE:/);
      seen.add(where);
    }
    expect([...seen]).toEqual(expect.arrayContaining(["cancel", "confirm"]));
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test.describe("ds-alert and forms", () => {
  test("alerts carry their titles", async ({ page }) => {
    for (const t of ["Heads up", "Saved", "Check this", "Something went wrong"]) await expect(page.getByText(t, { exact: true })).toBeVisible();
  });

  test("the sign-up form blocks empty required fields, then submits", async ({ page }) => {
    const form = page.locator("#demo-form");
    await form.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator("#result")).toBeEmpty();
    await form.getByLabel("Full name").fill("Ada Lovelace");
    await form.getByLabel("Email").fill("ada@example.test");
    await form.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator("#result")).toContainText("Submitted fields: name, email.");
  });
});

test("the theme switch changes the tokens and its own label", async ({ page }) => {
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ds-bg").trim());
  const light = await bg();
  await page.getByRole("button", { name: "Switch to dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light" })).toBeVisible();
  expect(await bg()).not.toBe(light);
});
