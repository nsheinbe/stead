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
  if (!/^acct_[A-Za-z0-9]+$/.test(id)) {
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
