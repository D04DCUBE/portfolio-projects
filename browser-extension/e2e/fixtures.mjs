// Loads the unpacked extension into Chromium and exposes its service worker, so tests can read
// the badge and storage the way the extension itself does.
import { test as base, chromium } from "playwright/test";
import { fileURLToPath } from "node:url";

const EXT = fileURLToPath(new URL("..", import.meta.url));

export const test = base.extend({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await use(sw);
  },
  extensionId: async ({ worker }, use) => { await use(new URL(worker.url()).host); },
});
export { expect } from "playwright/test";

// The badge text and stored findings for the one web page a test opened, read inside the service worker.
// (The extension has no "tabs" permission, so it cannot look tabs up by URL; storage keys carry the tab id.)
export async function results(worker) {
  return worker.evaluate(async () => {
    const all = await chrome.storage.session.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith("tab_"));
    if (keys.length === 0) return null;
    const tabId = Number(keys[0].split("_")[1]);
    const frames = keys.filter((k) => k.startsWith(`tab_${tabId}_`)).map((k) => all[k]);
    const findings = [...new Map(frames.flatMap((f) => f.findings).map((x) => [x.id, x])).values()];
    return { tabId, badge: await chrome.action.getBadgeText({ tabId }), hasPassword: frames.some((f) => f.hasPassword), findings, raw: JSON.stringify(all) };
  });
}
