import { defineConfig, devices } from "@playwright/test";
import { E2E_AUTH_SECRET, E2E_CRON_SECRET } from "./tests/helpers/session";

// The default suite is mock-Stripe. A leftover STRIPE_E2E=1 in the shell
// must not opt the live spec in here — that belongs to playwright.stripe.config.ts.
if (process.env.STEAD_E2E_SUITE !== "stripe") {
  delete process.env.STRIPE_E2E;
}

process.env.AUTH_SECRET ??= E2E_AUTH_SECRET;
process.env.CRON_SECRET ??= E2E_CRON_SECRET;

const port = process.env.PORT ?? "4173";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const hasDb = Boolean(process.env.DATABASE_URL_OWNER || process.env.CI);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "api",
      testMatch: /lifecycle\.spec\.ts|cancel\.spec\.ts|stripe\.live\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testMatch: /ui\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: hasDb
    ? {
        command: "npx tsx scripts/e2e-server.ts",
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          ...process.env,
          DATABASE_URL_OWNER:
            process.env.DATABASE_URL_OWNER ?? "postgres://postgres:postgres@127.0.0.1:5432/stead_test",
          AUTH_SECRET: process.env.AUTH_SECRET ?? E2E_AUTH_SECRET,
          CRON_SECRET: process.env.CRON_SECRET ?? E2E_CRON_SECRET,
          PORT: port,
          APP_URL: baseURL,
          STRIPE_E2E: "",
        },
      }
    : undefined,
});
