import { defineConfig } from "playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3408);

// The extension is loaded into a real Chromium by the fixture in e2e/fixtures.mjs.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: { command: "node e2e/static-server.mjs", url: `http://127.0.0.1:${PORT}/test-page.html`, env: { PORT: String(PORT) }, reuseExistingServer: false },
  projects: [{ name: "extension", testMatch: /\.spec\.mjs/ }],
});
