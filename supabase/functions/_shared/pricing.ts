/** Integer-cents booking math. Shared by edge functions, the client display, and tests. */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export type QuoteInput = {
  nightlyRateCents: number;
  nights: number;
  networkFeeBps: number;
  depositCents: number;
};

export type StayQuote = {
  nightly_rate_cents: number;
  nights: number;
  stay_subtotal_cents: number;
  network_fee_cents: number;
  guest_total_cents: number;
  deposit_cents: number;
};

function assertIntCents(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new MoneyError(`${label} must be an integer number of cents`);
  }
  if (value < 0) {
    throw new MoneyError(`${label} cannot be negative`);
  }
}

/** Calendar nights between two YYYY-MM-DD dates. Dates are listing-local civil dates. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    throw new MoneyError("check-in and check-out must be YYYY-MM-DD");
  }
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new MoneyError("invalid stay dates");
  }
  const nights = Math.round((end - start) / 86_400_000);
  if (nights < 1) {
    throw new MoneyError("stay must be at least one night");
  }
  return nights;
}

/**
 * stay_subtotal = nightly_rate × nights
 * network_fee   = subtotal × network_fee_bps / 10000  (integer trunc)
 * guest_total   = subtotal + network_fee
 * deposit is refundable and is never summed into guest_total.
 */
export function quoteStay(input: QuoteInput): StayQuote {
  assertIntCents(input.nightlyRateCents, "nightly_rate_cents");
  assertIntCents(input.nights, "nights");
  assertIntCents(input.networkFeeBps, "network_fee_bps");
  assertIntCents(input.depositCents, "deposit_cents");
  if (input.nights < 1) {
    throw new MoneyError("stay must be at least one night");
  }
  if (input.nightlyRateCents < 1) {
    throw new MoneyError("nightly rate must be at least 1 cent");
  }

  const stay_subtotal_cents = input.nightlyRateCents * input.nights;
  const network_fee_cents = Math.trunc((stay_subtotal_cents * input.networkFeeBps) / 10_000);
  const guest_total_cents = stay_subtotal_cents + network_fee_cents;

  return {
    nightly_rate_cents: input.nightlyRateCents,
    nights: input.nights,
    stay_subtotal_cents,
    network_fee_cents,
    guest_total_cents,
    deposit_cents: input.depositCents,
  };
}

export function formatUsd(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new MoneyError("formatUsd requires integer cents");
  }
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rem = abs % 100;
  const grouped = dollars.toLocaleString("en-US");
  return rem === 0
    ? `${sign}$${grouped}`
    : `${sign}$${grouped}.${String(rem).padStart(2, "0")}`;
}

export function depositMethod(
  nights: number,
  depositAuthMaxNights: number,
): "auth_hold" | "card_on_file" {
  assertIntCents(nights, "nights");
  assertIntCents(depositAuthMaxNights, "deposit_auth_max_nights");
  return nights <= depositAuthMaxNights ? "auth_hold" : "card_on_file";
}
