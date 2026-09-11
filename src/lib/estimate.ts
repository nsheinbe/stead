/**
 * The comparable price shown on cards and on a listing before dates exist.
 *
 * One definition, used everywhere, so a card, a detail page and checkout
 * cannot quote different arithmetic for the same home. It is explicitly an
 * estimate for the minimum stay: the exact price for chosen dates comes from
 * the server at checkout.
 *
 * Returns null when the fee rate is not known, because a total that silently
 * omits the fee is worse than showing the nightly rate alone.
 */
import { formatUsd, MIN_STAY_NIGHTS, quoteStay } from "./money";

export type StayEstimate = {
  nights: number;
  staySubtotalCents: number;
  networkFeeCents: number;
  guestTotalCents: number;
  networkFeeBps: number;
};

export function estimateMinimumStay(
  nightlyRateCents: number,
  networkFeeBps: number | null | undefined,
): StayEstimate | null {
  if (typeof networkFeeBps !== "number" || nightlyRateCents < 1) return null;
  try {
    const quote = quoteStay({
      nightlyRateCents,
      nights: MIN_STAY_NIGHTS,
      networkFeeBps,
      depositCents: 0,
    });
    return {
      nights: quote.nights,
      staySubtotalCents: quote.stay_subtotal_cents,
      networkFeeCents: quote.network_fee_cents,
      guestTotalCents: quote.guest_total_cents,
      networkFeeBps,
    };
  } catch {
    return null;
  }
}

/** "$6,120 for 30 nights" — the label a card carries under its title. */
export function estimateLabel(estimate: StayEstimate): string {
  return `${formatUsd(estimate.guestTotalCents)} for ${estimate.nights} nights`;
}

/** The fallback when the fee rate is unknown: never a total, just the rate. */
export function nightlyOnlyLabel(nightlyRateCents: number): string {
  return `${formatUsd(nightlyRateCents)} per night`;
}
