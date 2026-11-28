import { defineConfig, devices } from "playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3403);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: "node server.js",
    url: `http://127.0.0.1:${PORT}/`,
    env: { PORT: String(PORT), PROVIDER: "fake", CHAT_PER_MINUTE: "1000" },
    reuseExistingServer: false,
  },
  projects: [
    { name: "api", testMatch: /api\.spec\.js/ },
    { name: "ui", testMatch: /ui\.spec\.js/, use: { ...devices["Desktop Chrome"] } },
  ],
});
