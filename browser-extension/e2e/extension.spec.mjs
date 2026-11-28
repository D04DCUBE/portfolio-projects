// Extension tests in a real Chromium with the unpacked extension loaded.
import { test, expect, results } from "./fixtures.mjs";

const until = (worker, check) => expect.poll(async () => check(await results(worker)), { timeout: 5000 });

test("a safe sign-in page gets a green OK and no findings", async ({ context, worker, baseURL }) => {
  const page = await context.newPage();
  const url = `${baseURL}/safe.html`;
  await page.goto(url);
  await until(worker, (r) => r?.badge).toBe("OK");
  expect((await results(worker)).findings).toEqual([]);
});

test("a risky sign-in page is flagged with its findings, worst first in the badge", async ({ context, worker, baseURL }) => {
  const page = await context.newPage();
  const url = `${baseURL}/risky.html`;
  await page.goto(url);
  await until(worker, (r) => r?.findings.length ?? 0).toBeGreaterThan(0);
  const r = await results(worker);
  expect(r.findings.map((f) => `${f.severity}:${f.id}`).sort()).toEqual(
    ["high:get-method", "info:autocomplete-off", "warn:cross-origin-action", "warn:no-label"]);
  expect(r.badge).toBe("4");
});

test("a page with no password field gets no badge", async ({ context, worker, baseURL }) => {
  const page = await context.newPage();
  await page.route(`${baseURL}/no-login.html`, (r) => r.fulfill({ contentType: "text/html", body: "<h1>Just an article</h1><p>No forms here.</p>" }));
  await page.goto(`${baseURL}/no-login.html`);
  await page.waitForTimeout(800);
  const r = await results(worker);
  expect(r === null || (r.hasPassword === false && r.badge === "")).toBe(true);
});

test("privacy: what the user types never reaches the extension, and it makes no network requests", async ({ context, worker, baseURL }) => {
  const requests = [];
  context.on("request", (req) => { if (!req.url().startsWith(baseURL)) requests.push(req.url()); });
  const page = await context.newPage();
  const url = `${baseURL}/risky.html`;
  await page.goto(url);
  await until(worker, (r) => r?.findings.length ?? 0).toBeGreaterThan(0);
  const secret = "hunter2-SECRET-typed";
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(secret);
  await pw.press("Tab");
  await page.waitForTimeout(500);
  expect((await results(worker)).raw).not.toContain(secret);
  expect(requests).toEqual([]);
});

test("the popup lists findings as text, not HTML", async ({ context, worker, baseURL, extensionId }) => {
  const page = await context.newPage();
  const url = `${baseURL}/risky.html`;
  await page.goto(url);
  await until(worker, (r) => r?.findings.length ?? 0).toBeGreaterThan(0);
  // A popup reads the active tab. Opened as a page it would see itself, so point it at the risky page's tab.
  const popup = await context.newPage();
  const { tabId } = await results(worker);
  await popup.addInitScript((id) => { chrome.tabs.query = async () => [{ id }]; }, tabId);
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.locator("#status")).toHaveText(/things? to look at/);
  await expect(popup.locator("#list li").first()).toContainText("High risk");
  expect(await popup.locator("#list").evaluate((el) => el.querySelectorAll("script, img, a").length)).toBe(0);
});
