import { defineConfig, devices } from "playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3402);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    // A throwaway data file per run, and higher rate limits so many test sign-ups do not trip them.
    command: "rm -rf .e2e-data && node server.js",
    url: `http://127.0.0.1:${PORT}/`,
    env: { PORT: String(PORT), DATA_FILE: ".e2e-data/db.json", SIGNUP_MAX: "500", LOGIN_MAX: "500" },
    reuseExistingServer: false,
  },
  projects: [
    { name: "api", testMatch: /api\.spec\.js/ },
    { name: "ui", testMatch: /ui\.spec\.js/, use: { ...devices["Desktop Chrome"] } },
  ],
});
