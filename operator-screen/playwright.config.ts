import { defineConfig, devices } from "playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);

// One machine, one shared state: tests run one at a time and reset the machine first.
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: "node scripts/gen-contract.ts --check && node scripts/build.ts && node server/main.ts",
    url: `http://127.0.0.1:${PORT}/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "api", testMatch: /api\.spec\.ts/ },
    {
      name: "ui",
      testMatch: /ui\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, hasTouch: true },
    },
  ],
});
