/**
 * Stripe Connect Express onboarding — host self-serve.
 *
 * A host cannot take a booking without a connected account: create-booking
 * fails closed rather than fall back to a platform-merchant-of-record charge.
 * This is the flow that gets them one: create/reuse an Express account, mint
 * an Account Link, land back on /host/payouts. account.updated (and a live
 * retrieve on return) write charges/payouts readiness onto the profile.
 *
 * Creating Express accounts requires the platform profile in the Stripe
 * Dashboard. That click-path is outside the repo — see PREFLIGHT / README.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getStripe, stripeConfigured } from "../lib/stripe";
import { RATE_LIMITS, rateLimit } from "../lib/rateLimit";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import {
  attachConnectAccount,
  getConnectStatus,
  recordConnectReadiness,
  type ConnectReadiness,
} from "../queries/hostProfile";

export const connectRoutes = new Hono<AppEnv>();

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

function requireStripe(): void {
  if (!stripeConfigured()) {
    throw new HTTPException(503, { message: "Payouts are not configured on this deployment" });
  }
}

function emptyStatus(): ConnectReadiness {
  return { accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false };
}

function platformConnectBlocked(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /platform profile|signed up for Connect|complete your platform|connect\/registration|responsible for negative balances/i.test(
    message,
  );
}

async function persistLiveAccount(
  accountId: string,
  account: {
    charges_enabled?: boolean | null;
    payouts_enabled?: boolean | null;
    details_submitted?: boolean | null;
  },
  persist: (input: {
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  }) => Promise<boolean>,
): Promise<ConnectReadiness> {
  const snapshot = {
    accountId,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted: account.details_submitted === true,
  };
  await persist(snapshot);
  return snapshot;
}

/**
 * Returns a Stripe-hosted onboarding URL. Safe to call repeatedly: an existing
 * account is reused and gets a fresh link, because account links expire and a
 * host who abandoned onboarding needs to resume, not start over with a second
 * account.
 */
connectRoutes.post("/onboard", rateLimit(RATE_LIMITS.connect), async (c) => {
  const host = sessionUser(c);
  requireStripe();
  const stripe = getStripe();

  let status = await tenantQuery(c, (tx) => getConnectStatus(tx, host.id));
  let accountId = status.accountId;

  if (!accountId) {
    // Card payments and transfers are both needed: the host is merchant of
    // record on the stay charge, and the deposit's SetupIntent lives on their
    // account too.
    let account;
    try {
      account = await stripe.accounts.create({
        type: "express",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { member_id: host.id },
      });
    } catch (err) {
      console.error("[connect] accounts.create failed", err);
      throw new HTTPException(503, {
        message: platformConnectBlocked(err)
          ? "Stripe Connect is not enabled on this platform yet. Complete the platform profile in the Stripe Dashboard (Settings → Connect), then try again."
          : "Payouts are not configured on this deployment",
      });
    }

    const attached = await tenantQuery(c, (tx) => attachConnectAccount(tx, account.id));
    if (attached) {
      accountId = account.id;
      await tenantQuery(c, (tx) =>
        persistLiveAccount(account.id, account, (input) => recordConnectReadiness(tx, input)),
      );
    } else {
      // Someone attached one between our read and our write. Theirs wins —
      // repointing a host's earnings is not something a race should decide.
      status = await tenantQuery(c, (tx) => getConnectStatus(tx, host.id));
      accountId = status.accountId;
      if (!accountId) {
        throw new HTTPException(500, { message: "Could not attach the payout account" });
      }
      console.error(
        `[connect] orphaned Stripe account ${account.id} for member ${host.id}: ` +
          "another attach won the race",
      );
    }
  }

  let link;
  try {
    link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl()}/host/payouts?refresh=1`,
      return_url: `${appUrl()}/host/payouts?done=1`,
      type: "account_onboarding",
    });
  } catch (err) {
    console.error("[connect] accountLinks.create failed", err);
    throw new HTTPException(503, {
      message: platformConnectBlocked(err)
        ? "Stripe Connect is not enabled on this platform yet. Complete the platform profile in the Stripe Dashboard (Settings → Connect), then try again."
        : "Stripe did not hand back an onboarding link. Try again shortly.",
    });
  }

  return c.json({ url: link.url, accountId });
});

/** Whether this host can actually be paid yet. */
connectRoutes.get("/status", async (c) => {
  const host = sessionUser(c);
  const stored = await tenantQuery(c, (tx) => getConnectStatus(tx, host.id));
  if (!stored.accountId) return c.json(emptyStatus());
  if (!stripeConfigured()) return c.json(stored);

  try {
    const account = await getStripe().accounts.retrieve(stored.accountId);
    return c.json(
      await tenantQuery(c, (tx) =>
        persistLiveAccount(stored.accountId!, account, (input) => recordConnectReadiness(tx, input)),
      ),
    );
  } catch (err) {
    console.error("[connect] accounts.retrieve failed; returning stored readiness", err);
    return c.json(stored);
  }
});
