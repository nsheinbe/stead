/**
 * Landing fee-slider math. Stead's side is quoteStay (integer cents, 30-night
 * floor). The "typical platform" column is a comparison only — 80% of the take
 * on the guest, 20% on the host — and never snaps onto a booking.
 */
import { MoneyError, quoteStay } from "./pricing";

export const DEFAULT_PLATFORM_TAKE_BPS = 1500;
export const FEE_SLIDER_MIN_RATE_CENTS = 4_000;
export const FEE_SLIDER_MAX_RATE_CENTS = 100_000;
export const FEE_SLIDER_RATE_STEP_CENTS = 500;
export const FEE_SLIDER_DEFAULT_RATE_CENTS = 20_000;
export const FEE_SLIDER_MIN_NIGHTS = 30;
export const FEE_SLIDER_MAX_NIGHTS = 90;
export const FEE_SLIDER_DEFAULT_NIGHTS = 30;

export type FeeCompare = {
  nightlyRateCents: number;
  nights: number;
  staySubtotalCents: number;
  networkFeeCents: number;
  steadGuestCents: number;
  steadHostCents: number;
  otherGuestCents: number;
  otherHostCents: number;
  otherTakeCents: number;
  staysBetweenCents: number;
  guestSavesCents: number;
  hostGainsCents: number;
  platformTakeBps: number;
};

function assertInt(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new MoneyError(`${label} must be an integer`);
  }
  if (value < 0) {
    throw new MoneyError(`${label} cannot be negative`);
  }
}

export function clampFeeSliderRate(cents: number): number {
  assertInt(cents, "nightly_rate_cents");
  const stepped = Math.round(cents / FEE_SLIDER_RATE_STEP_CENTS) * FEE_SLIDER_RATE_STEP_CENTS;
  return Math.min(FEE_SLIDER_MAX_RATE_CENTS, Math.max(FEE_SLIDER_MIN_RATE_CENTS, stepped));
}

export function clampFeeSliderNights(nights: number): number {
  assertInt(nights, "nights");
  return Math.min(FEE_SLIDER_MAX_NIGHTS, Math.max(FEE_SLIDER_MIN_NIGHTS, nights));
}

/**
 * stay_subtotal × typical take, split 4/5 guest / 1/5 host, all integer trunc.
 * Stead guest/host/fee come from quoteStay so the slider cannot disagree
 * with checkout.
 */
export function compareStayFees(input: {
  nightlyRateCents: number;
  nights: number;
  networkFeeBps: number;
  platformTakeBps?: number;
}): FeeCompare {
  const nightlyRateCents = clampFeeSliderRate(input.nightlyRateCents);
  const nights = clampFeeSliderNights(input.nights);
  const takeBps = input.platformTakeBps ?? DEFAULT_PLATFORM_TAKE_BPS;
  assertInt(takeBps, "platform_take_bps");

  const quote = quoteStay({
    nightlyRateCents,
    nights,
    networkFeeBps: input.networkFeeBps,
    depositCents: 0,
  });

  const guestTakeBps = Math.trunc((takeBps * 4) / 5);
  const hostTakeBps = takeBps - guestTakeBps;
  const sub = quote.stay_subtotal_cents;
  const otherGuestCents = sub + Math.trunc((sub * guestTakeBps) / 10_000);
  const otherHostCents = sub - Math.trunc((sub * hostTakeBps) / 10_000);
  const otherTakeCents = otherGuestCents - otherHostCents;

  return {
    nightlyRateCents: quote.nightly_rate_cents,
    nights: quote.nights,
    staySubtotalCents: quote.stay_subtotal_cents,
    networkFeeCents: quote.network_fee_cents,
    steadGuestCents: quote.guest_total_cents,
    steadHostCents: quote.stay_subtotal_cents,
    otherGuestCents,
    otherHostCents,
    otherTakeCents,
    staysBetweenCents: otherTakeCents - quote.network_fee_cents,
    guestSavesCents: otherGuestCents - quote.guest_total_cents,
    hostGainsCents: quote.stay_subtotal_cents - otherHostCents,
    platformTakeBps: takeBps,
  };
}
