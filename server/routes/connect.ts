/**
 * Stripe Connect Express onboarding.
 *
 * A host cannot take a booking without a connected account: create-booking
 * fails closed rather than fall back to a platform-merchant-of-record charge.
 * This is the flow that gets them one.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getStripe, stripeConfigured } from "../lib/stripe";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import { attachConnectAccount, getConnectAccountId } from "../queries/hostProfile";

export const connectRoutes = new Hono<AppEnv>();

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

function requireStripe(): void {
  if (!stripeConfigured()) {
    throw new HTTPException(503, { message: "Payouts are not configured on this deployment" });
  }
}

/**
 * Returns a Stripe-hosted onboarding URL. Safe to call repeatedly: an existing
 * account is reused and gets a fresh link, because account links expire and a
 * host who abandoned onboarding needs to resume, not start over with a second
 * account.
 */
connectRoutes.post("/onboard", async (c) => {
  const host = sessionUser(c);
  requireStripe();
  const stripe = getStripe();

  let accountId = await tenantQuery(c, (tx) => getConnectAccountId(tx, host.id));

  if (!accountId) {
    // Card payments and transfers are both needed: the host is merchant of
    // record on the stay charge, and the deposit's SetupIntent lives on their
    // account too.
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { member_id: host.id },
    });

    const attached = await tenantQuery(c, (tx) => attachConnectAccount(tx, account.id));
    if (attached) {
      accountId = account.id;
    } else {
      // Someone attached one between our read and our write. Theirs wins —
      // repointing a host's earnings is not something a race should decide.
      accountId = await tenantQuery(c, (tx) => getConnectAccountId(tx, host.id));
      if (!accountId) {
        throw new HTTPException(500, { message: "Could not attach the payout account" });
      }
      console.error(
        `[connect] orphaned Stripe account ${account.id} for member ${host.id}: ` +
          "another attach won the race",
      );
    }
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${appUrl()}/host/payouts?refresh=1`,
    return_url: `${appUrl()}/host/payouts?done=1`,
    type: "account_onboarding",
  });

  return c.json({ url: link.url, accountId });
});

/** Whether this host can actually be paid yet. */
connectRoutes.get("/status", async (c) => {
  const host = sessionUser(c);
  const accountId = await tenantQuery(c, (tx) => getConnectAccountId(tx, host.id));
  if (!accountId) {
    return c.json({ accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
  }
  if (!stripeConfigured()) {
    return c.json({ accountId, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
  }

  const account = await getStripe().accounts.retrieve(accountId);
  return c.json({
    accountId,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  });
});
