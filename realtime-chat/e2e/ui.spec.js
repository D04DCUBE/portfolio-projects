// UI tests: two real browser windows in the same room.
import { test, expect } from "playwright/test";

let n = 0;
const roomName = () => `ui${Date.now().toString(36)}${n++}`;

async function join(page, name, room) {
  await page.goto("/");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Room").fill(room);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connected" })).toBeVisible();
}

test("two people chat in real time and see each other online", async ({ browser }) => {
  const room = roomName();
  const ana = await (await browser.newContext()).newPage();
  const ben = await (await browser.newContext()).newPage();
  await join(ana, "Ana", room);
  await join(ben, "Ben", room);
  const anaPeople = ana.getByRole("complementary", { name: "People in this room" });
  await expect(anaPeople).toContainText("Ben");

  await ana.getByLabel("Message", { exact: true }).fill("hi Ben");
  await ana.getByLabel("Message", { exact: true }).press("Enter");
  await expect(ben.getByRole("log", { name: `Messages in ${room}` })).toContainText("hi Ben");

  await ben.getByLabel("Message", { exact: true }).pressSequentially("typing now");
  await expect(ana.getByText("Ben is typing…")).toBeVisible();
  await ana.context().close(); await ben.context().close();
});

test("a message survives a reload because the room keeps history", async ({ page }) => {
  const room = roomName();
  await join(page, "Cy", room);
  await page.getByLabel("Message", { exact: true }).fill("remember me");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log")).toContainText("remember me");
  await page.reload();
  await join(page, "Cy2", room);
  await expect(page.getByRole("log")).toContainText("remember me");
});

test("an invalid name is refused with a clear message", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name").fill("<script>");
  await page.getByLabel("Room").fill(roomName());
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("alert")).toContainText(/Name must be/);
});

test("HTML in a message is shown as text, not run", async ({ page }) => {
  let alerted = false;
  page.on("dialog", (d) => { alerted = true; d.dismiss(); });
  await join(page, "Dee", roomName());
  await page.getByLabel("Message", { exact: true }).fill(`<img src=x onerror="alert(1)">`);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log")).toContainText('<img src=x onerror="alert(1)">');
  await expect(page.getByRole("log").locator("img")).toHaveCount(0);
  expect(alerted).toBe(false);
});
