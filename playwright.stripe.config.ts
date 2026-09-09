/**
 * Live test-mode Stripe e2e. Opt-in only: STRIPE_E2E=1 plus Nick's own
 * sk_test_ / pk_test_ keys. The default playwright.config.ts unsets Stripe
 * so CI stays deterministic.
 *
 *   STRIPE_E2E=1 STRIPE_SECRET_KEY=sk_test_… \
 *   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_… \
 *   STRIPE_TEST_CONNECT_ACCOUNT_ID=acct_… \
 *   npm run test:e2e:stripe
 */
import { defineConfig, devices } from "@playwright/test";
import { E2E_AUTH_SECRET, E2E_CRON_SECRET } from "./tests/helpers/session";

process.env.STEAD_E2E_SUITE = "stripe";
process.env.AUTH_SECRET ??= E2E_AUTH_SECRET;
process.env.CRON_SECRET ??= E2E_CRON_SECRET;

const port = process.env.PORT ?? "4173";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const hasDb = Boolean(process.env.DATABASE_URL_OWNER || process.env.CI);
const reuseDev = Boolean(process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "stripe-live",
      testMatch: /stripe\.live\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer:
    hasDb && !reuseDev
      ? {
          command: "npx tsx scripts/e2e-server.ts",
          url: `${baseURL}/api/health`,
          reuseExistingServer: false,
          timeout: 180_000,
          env: {
            ...process.env,
            STEAD_E2E_SUITE: "stripe",
            STRIPE_E2E: "1",
            DATABASE_URL_OWNER:
              process.env.DATABASE_URL_OWNER ?? "postgres://postgres:postgres@127.0.0.1:5432/stead_test",
            AUTH_SECRET: process.env.AUTH_SECRET ?? E2E_AUTH_SECRET,
            CRON_SECRET: process.env.CRON_SECRET ?? E2E_CRON_SECRET,
            PORT: port,
            APP_URL: baseURL,
          },
        }
      : undefined,
});
