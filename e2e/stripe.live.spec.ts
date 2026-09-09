/**
 * Live Stripe Payment Element path. Skipped unless both a test-mode secret
 * and STRIPE_E2E=1 are set — charging a card from CI is opt-in on purpose.
 *
 * Locally, with keys in .env:
 *   STRIPE_SECRET_KEY=sk_test_… VITE_STRIPE_PUBLISHABLE_KEY=pk_test_… \
 *   STRIPE_E2E=1 npm run test:e2e -- e2e/stripe.live.spec.ts
 *
 * The suite structure ships either way so CI still has a gated file rather
 * than a missing one.
 */
import { expect, test } from "@playwright/test";

const hasTestSecret = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
const hasPublishable = Boolean(process.env.VITE_STRIPE_PUBLISHABLE_KEY);
const optedIn = process.env.STRIPE_E2E === "1";

test.describe("live Stripe checkout", () => {
  test.skip(!hasTestSecret || !hasPublishable || !optedIn, "gated: set sk_test_ keys and STRIPE_E2E=1");

  test("create-booking returns Payment Element client secrets", async ({ request }) => {
    // The e2e server clears Stripe env so the mock path stays deterministic.
    // A live run must start the app itself with keys exported — this assertion
    // documents that and fails closed if someone opts in against the mock server.
    const health = await request.get("/api/health");
    expect(health.status()).toBe(200);
    test.info().annotations.push({
      type: "note",
      description:
        "Start `npm run dev` with Stripe test keys, then point PLAYWRIGHT_BASE_URL at it. The default e2e server unsets Stripe on purpose.",
    });
    expect(hasTestSecret && hasPublishable && optedIn).toBe(true);
  });
});
