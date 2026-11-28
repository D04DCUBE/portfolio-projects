// UI tests in a real browser: write notes, search them, ask a question.
import { test, expect } from "playwright/test";

const PASSWORD = "correct horse battery";
let n = 0;

async function signUp(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(`ui-${Date.now()}-${n++}@example.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "New note" })).toBeVisible();
}

async function writeNote(page, title, body, tags = "") {
  await page.getByRole("button", { name: "New note" }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Note", { exact: true }).fill(body);
  if (tags) await page.getByLabel("Tags (comma separated)").fill(tags);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
}

test("write a note and find it again after a reload", async ({ page }) => {
  await signUp(page);
  await writeNote(page, "Acme recruiter call", "Jordan Lee is the recruiter at Acme.", "jobs");
  await page.reload();
  await expect(page.getByRole("button", { name: /Acme recruiter call/ })).toBeVisible();
});

test("search narrows the list to matching notes", async ({ page }) => {
  await signUp(page);
  await writeNote(page, "Acme recruiter call", "Jordan Lee is the recruiter at Acme.");
  await writeNote(page, "Groceries", "Milk and eggs.");
  await page.getByRole("searchbox", { name: "Search notes" }).fill("jordan");
  await expect(page.getByRole("button", { name: /Acme recruiter call/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Groceries/ })).toHaveCount(0);
});

test("ask your notes gives an answer with a source you can open", async ({ page }) => {
  await signUp(page);
  await writeNote(page, "Acme recruiter call", "Jordan Lee is the recruiter at Acme.");
  await page.getByRole("button", { name: "Ask your notes" }).click();
  await page.getByLabel("Your question").fill("Who is the recruiter at Acme?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const answer = page.locator(".ask [aria-live]");
  await expect(answer).toContainText("Jordan Lee");
  await answer.getByRole("button", { name: /1/ }).first().click();
  await expect(page.getByLabel("Title")).toHaveValue("Acme recruiter call");
});

test("a question the notes cannot answer says so", async ({ page }) => {
  await signUp(page);
  await writeNote(page, "Groceries", "Milk and eggs.");
  await page.getByRole("button", { name: "Ask your notes" }).click();
  await page.getByLabel("Your question").fill("What is the capital of Mongolia?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".ask [aria-live]")).toContainText("couldn't find anything about that in your notes");
});

test("a note with HTML in it is shown as text, not run", async ({ page }) => {
  await signUp(page);
  let alerted = false;
  page.on("dialog", (d) => { alerted = true; d.dismiss(); });
  await writeNote(page, `<img src=x onerror="alert(1)">`, "harmless");
  await page.reload();
  await page.waitForTimeout(300);
  expect(alerted).toBe(false);
  await expect(page.locator(".item img")).toHaveCount(0);
});
