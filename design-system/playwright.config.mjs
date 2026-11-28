import { defineConfig, devices } from "playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3407);

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: { command: "node e2e/static-server.mjs", url: `http://127.0.0.1:${PORT}/`, env: { PORT: String(PORT) }, reuseExistingServer: false },
  projects: [{ name: "ui", testMatch: /ui\.spec\.mjs/, use: { ...devices["Desktop Chrome"] } }],
});
