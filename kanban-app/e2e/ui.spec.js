// UI tests in a real browser: sign up, then use the board like a person would.
import { test, expect } from "playwright/test";

const PASSWORD = "correct horse battery";
let n = 0;

async function signUp(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(`ui-${Date.now()}-${n++}@example.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /To do/ })).toBeVisible();
}

async function addCard(page, title, column = "To do") {
  await page.getByRole("button", { name: `Add card to ${column}` }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: title, level: 3 })).toBeVisible();
}

test("a wrong password shows an error and keeps you on the login screen", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByLabel("Password").fill("wrong password here");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/incorrect|invalid|wrong/i)).toBeVisible();
});

test("add, edit, move and delete a card", async ({ page }) => {
  await signUp(page);
  await addCard(page, "Draft the release notes");
  await page.getByRole("button", { name: "Edit for Draft the release notes" }).click();
  await page.getByLabel("Title").fill("Ship the release notes");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Ship the release notes", level: 3 })).toBeVisible();

  await page.getByRole("button", { name: "Move right for Ship the release notes" }).click();
  await expect(page.getByRole("heading", { name: /Doing \(1\)/ })).toBeVisible();

  await page.getByRole("button", { name: "Delete for Ship the release notes" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ship the release notes", level: 3 })).toHaveCount(0);
});

test("the board survives a reload", async ({ page }) => {
  await signUp(page);
  await addCard(page, "Still here after reload");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Still here after reload", level: 3 })).toBeVisible();
});

test("a card title with HTML is shown as text, not run", async ({ page }) => {
  await signUp(page);
  let alerted = false;
  page.on("dialog", (d) => { alerted = true; d.dismiss(); });
  await addCard(page, `<img src=x onerror="alert(1)">`);
  expect(alerted).toBe(false);
  await expect(page.locator(".card img")).toHaveCount(0);
});

test("keyboard: move a card and focus stays on the card", async ({ page }) => {
  await signUp(page);
  await addCard(page, "Keyboard card");
  await page.getByRole("button", { name: "Move right for Keyboard card" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Doing \(1\)/ })).toBeVisible();
  const focused = await page.evaluate(() => document.activeElement?.closest("[data-card]")?.textContent ?? "");
  expect(focused).toContain("Keyboard card");
});

test("log out returns to the login screen", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});
