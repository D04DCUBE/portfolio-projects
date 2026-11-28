// UI tests in a real browser, with the scripted model: streaming, tool approval, Stop, errors, safe rendering.
import { test, expect } from "playwright/test";

const log = (page) => page.getByRole("log", { name: "Conversation" });
async function send(page, text) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test.beforeEach(async ({ page }) => { await page.goto("/"); });

test("a message streams back an answer", async ({ page }) => {
  await send(page, "echo: hello from Playwright");
  await expect(log(page)).toContainText("You wrote: hello from Playwright");
  await expect(page.getByLabel("Message")).toBeFocused();
});

test("a tool call waits for approval, then answers", async ({ page }) => {
  await send(page, "weather in Paris");
  await expect(page.getByText("The assistant wants to run")).toBeVisible();
  await expect(page.locator("#approval code")).toHaveText('get_weather({"city":"Paris"})');
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(log(page)).toContainText(/It's \d+ °C and .+ in Paris\./);
});

test("denying a tool call means it never runs", async ({ page }) => {
  const toolCalls = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/tool")) toolCalls.push(r); });
  await send(page, "weather in Paris");
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(log(page)).toContainText("Okay, I won't look that up.");
  expect(toolCalls).toHaveLength(0);
});

test("Stop ends a long answer and keeps what arrived", async ({ page }) => {
  await send(page, "/long");
  const stop = page.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(400);
  await stop.click();
  await expect(stop).toBeHidden();
  await expect(log(page)).toContainText("Stopped.");
});

test("a failed answer shows an error with Retry", async ({ page }) => {
  await send(page, "/fail");
  await expect(page.getByRole("alert").filter({ hasText: "The model stopped responding" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("a structured answer renders as a comparison", async ({ page }) => {
  await send(page, "/compare");
  await expect(page.getByRole("heading", { name: "Streaming approaches", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "WebSocket", level: 3 })).toBeVisible();
});

test("invalid structured data is not rendered half-built", async ({ page }) => {
  await send(page, "/badjson");
  await expect(log(page)).toContainText("The model sent a response I couldn't display.");
});

test("HTML typed into the chat is shown as text, never run", async ({ page }) => {
  let alerted = false;
  page.on("dialog", (d) => { alerted = true; d.dismiss(); });
  await send(page, `echo: <img src=x onerror="alert(1)">`);
  await expect(log(page)).toContainText('<img src=x onerror="alert(1)">');
  expect(alerted).toBe(false);
  await expect(log(page).locator("img")).toHaveCount(0);
});

test("attaching a text file sends it with the message", async ({ page }) => {
  await page.locator("#file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("one two\nthree") });
  await expect(page.getByRole("button", { name: "Remove notes.txt" })).toBeVisible();
  await send(page, "what is in this?");
  await expect(log(page)).toContainText("a text file (notes.txt, 2 lines, 3 words)");
});
