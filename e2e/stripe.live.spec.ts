/**
 * Live Stripe Payment Element / destination-charge path.
 *
 * Skipped unless STRIPE_E2E=1 and test-mode keys are set. Default CI never
 * sets the flag. Do not put sk_live_ or real secrets in the repo.
 *
 *   docker compose --profile test up -d db_test
 *   export DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5433/stead_test
 *   STRIPE_E2E=1 \
 *     STRIPE_SECRET_KEY=sk_test_… \
 *     VITE_STRIPE_PUBLISHABLE_KEY=pk_test_… \
 *     STRIPE_TEST_CONNECT_ACCOUNT_ID=acct_… \
 *     npm run test:e2e:stripe
 *
 * Point PLAYWRIGHT_BASE_URL at a running `npm run dev` if you already have
 * keys loaded there; otherwise this config starts e2e-server with Stripe kept.
 */
import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import { attachTestConnectAccount, ensureDb, isoDay, seedBookableParty } from "./helpers/party";

const secret = process.env.STRIPE_SECRET_KEY ?? "";
const publishable = process.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "";
const connectAccount = (process.env.STRIPE_TEST_CONNECT_ACCOUNT_ID ?? "").trim();
const optedIn = process.env.STRIPE_E2E === "1";
const hasTestSecret = secret.startsWith("sk_test_");
const hasPublishable = publishable.startsWith("pk_test_");
const hasConnect = /^acct_[A-Za-z0-9_]+$/.test(connectAccount);

test.describe("live Stripe checkout", () => {
  test.skip(!optedIn || !hasTestSecret || !hasPublishable, "gated: set sk_test_ keys and STRIPE_E2E=1");

  test("create-booking returns host-MOR destination-charge secrets", async ({ request }) => {
    if (optedIn && hasTestSecret && !hasConnect) {
      throw new Error(
        "STRIPE_E2E=1 requires STRIPE_TEST_CONNECT_ACCOUNT_ID=acct_… " +
          "(a test Express account you created — not a secret key).",
      );
    }

    await ensureDb();
    const { hostId, listingId, cookie } = await seedBookableParty("Live Stripe cottage");
    await attachTestConnectAccount(hostId, connectAccount);

    const created = await request.post("/api/bookings", {
      headers: { cookie, "content-type": "application/json" },
      data: {
        listingId,
        checkIn: isoDay(60),
        checkOut: isoDay(90),
        guests: 2,
      },
    });
    expect(created.status(), await created.text()).toBe(200);
    const body = (await created.json()) as {
      bookingId: string;
      mockPayment: boolean;
      paymentClientSecret: string | null;
      setupClientSecret: string | null;
      quote: { guest_total_cents: number; network_fee_cents: number };
    };

    expect(body.mockPayment, "hit the mock e2e server — use npm run test:e2e:stripe").toBe(false);
    expect(body.paymentClientSecret).toMatch(/^pi_/);
    expect(body.setupClientSecret).toMatch(/^seti_/);
    const clientSecret = body.paymentClientSecret;
    if (!clientSecret) throw new Error("create-booking returned no payment client secret");

    const stripe = new Stripe(secret);
    const piId = clientSecret.split("_secret_")[0];
    if (!piId) throw new Error("could not parse PaymentIntent id from client secret");
    const intent = await stripe.paymentIntents.retrieve(piId);

    expect(intent.amount).toBe(body.quote.guest_total_cents);
    expect(intent.application_fee_amount).toBe(body.quote.network_fee_cents);
    expect(intent.on_behalf_of).toBe(connectAccount);
    expect(intent.transfer_data?.destination).toBe(connectAccount);
    expect(intent.application_fee_amount ?? 0).toBeLessThan(intent.amount);

    try {
      if (intent.status === "requires_payment_method" || intent.status === "requires_confirmation") {
        await stripe.paymentIntents.cancel(intent.id);
      }
    } catch (err) {
      console.warn("[stripe-e2e] could not cancel the test PaymentIntent", err);
    }
  });
});
