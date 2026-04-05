import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "3100");
const baseURL = `http://127.0.0.1:${port}`;
const cronSecret =
  process.env.CRON_SECRET ??
  process.env.AUTOMATION_RUNNER_SECRET ??
  "test-runner-secret";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
      AUTOMATION_RUNNER_SECRET:
        process.env.AUTOMATION_RUNNER_SECRET ?? "test-runner-secret",
      CONTACT_MEMORY_RUNNER_SECRET:
        process.env.CONTACT_MEMORY_RUNNER_SECRET ??
        process.env.AUTOMATION_RUNNER_SECRET ??
        "test-runner-secret",
      CRON_SECRET: cronSecret,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
