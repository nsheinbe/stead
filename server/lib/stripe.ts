import { createHash } from "node:crypto";
import Stripe from "stripe";

let client: Stripe | undefined;

export function stripeConfigured(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_");
}

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key);
  }
  return client;
}

/**
 * Host must be the merchant of record. A missing or malformed Connect id is
 * fail-closed: never create a PaymentIntent that would settle on the platform.
 *
 * TODO(Nick): Express onboarding UI + live Connect settings. Until a host has
 * an acct_ on profiles.stripe_connect_account_id (seed: STRIPE_TEST_CONNECT_ACCOUNT_ID),
 * live Stripe bookings return 409 and charge nothing.
 */
export class HostConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostConnectError";
  }
}

export function resolveHostConnectAccount(accountId: string | null | undefined): string {
  const id = accountId?.trim() ?? "";
  if (!/^acct_[A-Za-z0-9_]+$/.test(id)) {
    throw new HostConnectError(
      "This host cannot accept bookings yet. The stay is charged to the host, not Stead — a Connect account is required.",
    );
  }
  return id;
}

export type DestinationChargeParams = {
  amount: number;
  currency: "usd";
  automatic_payment_methods: { enabled: true };
  application_fee_amount: number;
  transfer_data: { destination: string };
  on_behalf_of: string;
  metadata: Record<string, string>;
};

/**
 * Destination charge with on_behalf_of: host is MOR, platform keeps only
 * application_fee_amount (the 2% network fee). Never omit transfer_data or
 * on_behalf_of — that would make the platform the merchant of record.
 */
export function destinationChargeParams(input: {
  guestTotalCents: number;
  networkFeeCents: number;
  destinationAccountId: string;
  metadata: Record<string, string>;
}): DestinationChargeParams {
  const destination = resolveHostConnectAccount(input.destinationAccountId);
  if (!Number.isInteger(input.guestTotalCents) || input.guestTotalCents < 1) {
    throw new HostConnectError("guest_total_cents must be a positive integer");
  }
  if (!Number.isInteger(input.networkFeeCents) || input.networkFeeCents < 0) {
    throw new HostConnectError("network_fee_cents must be a non-negative integer");
  }
  if (input.networkFeeCents > input.guestTotalCents) {
    throw new HostConnectError("network fee cannot exceed guest total");
  }
  return {
    amount: input.guestTotalCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    application_fee_amount: input.networkFeeCents,
    transfer_data: { destination },
    on_behalf_of: destination,
    metadata: input.metadata,
  };
}

/**
 * Stable for one logical booking attempt, so a double-submit or a client-side
 * retry reuses the intents instead of minting another pair in Stripe.
 */
export function intentIdempotencyKey(
  kind: "pi" | "seti",
  guestId: string,
  listingId: string,
  checkIn: string,
  checkOut: string,
): string {
  const digest = createHash("sha256")
    .update([guestId, listingId, checkIn, checkOut].join("|"))
    .digest("hex")
    .slice(0, 32);
  return `booking:${kind}:${digest}`;
}

/**
 * Create an intent under an idempotency key, tolerating the one case where
 * replay is wrong: a previous attempt on the same guest/listing/date span
 * rolled back and cancelled its intent. Stripe replays that cancelled object
 * for the key's 24h lifetime, and handing the member a cancelled client secret
 * would fail at confirmation with nothing to explain it — so take a fresh key.
 */
export async function createIntent<T extends { status: string }>(
  create: (options: { idempotencyKey: string }) => Promise<T>,
  key: string,
): Promise<T> {
  const intent = await create({ idempotencyKey: key });
  if (intent.status !== "canceled") return intent;
  return create({ idempotencyKey: `${key}:${crypto.randomUUID()}` });
}

/**
 * Best effort, and deliberately so: this runs while an error is already on its
 * way up, and a failure to cancel must not replace it. An intent that has since
 * succeeded or been cancelled throws, which is why the results are settled
 * rather than awaited as a pair.
 */
export async function cancelOrphanedIntents(
  paymentIntentId: string,
  setupIntentId: string,
  hostAccount: string | null,
): Promise<void> {
  if (!stripeConfigured() || hostAccount === null) return;
  const stripe = getStripe();
  const results = await Promise.allSettled([
    stripe.paymentIntents.cancel(paymentIntentId),
    stripe.setupIntents.cancel(setupIntentId, undefined, { stripeAccount: hostAccount }),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[stripe] could not cancel an orphaned intent", result.reason);
    }
  }
}
