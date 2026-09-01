// Canonical booking math. Imported by the create-booking edge function (the
// only place it is authoritative), by the client for display, and by Vitest.
// One implementation, so the number the guest sees and the number the server
// charges cannot drift.
//
// All money is integer cents. No floats, ever.

export const CancellationPolicies = ['flexible', 'moderate', 'strict'] as const
export type CancellationPolicy = (typeof CancellationPolicies)[number]

export interface PricingInput {
  nightlyRateCents: number
  nights: number
  depositCents: number
  networkFeeBps: number
}

export interface PricingBreakdown {
  nightlyRateCents: number
  nights: number
  staySubtotalCents: number
  networkFeeCents: number
  guestTotalCents: number
  /** Refundable, held in neutral escrow. Never part of guestTotalCents. */
  depositCents: number
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${value}`)
  }
}

/**
 * stay_subtotal = nightly_rate x nights
 * network_fee   = stay_subtotal x network_fee_bps / 10000
 * guest_total   = stay_subtotal + network_fee
 *
 * The deposit is separate and refundable — it is never summed into the total
 * the guest is charged for the stay.
 *
 * Fee rounding is half-up on the cent. Basis points on realistic stay values
 * stay far inside Number.MAX_SAFE_INTEGER, so integer arithmetic is exact
 * up to that single deliberate rounding step.
 */
export function priceBooking(input: PricingInput): PricingBreakdown {
  const { nightlyRateCents, nights, depositCents, networkFeeBps } = input

  assertNonNegativeInt(nightlyRateCents, 'nightlyRateCents')
  assertNonNegativeInt(depositCents, 'depositCents')
  assertNonNegativeInt(networkFeeBps, 'networkFeeBps')
  if (!Number.isInteger(nights) || nights < 1) {
    throw new Error(`nights must be a positive integer, got ${nights}`)
  }

  const staySubtotalCents = nightlyRateCents * nights
  const networkFeeCents = Math.round((staySubtotalCents * networkFeeBps) / 10000)
  const guestTotalCents = staySubtotalCents + networkFeeCents

  return {
    nightlyRateCents,
    nights,
    staySubtotalCents,
    networkFeeCents,
    guestTotalCents,
    depositCents,
  }
}

/** Nights between two ISO yyyy-mm-dd dates, half-open: checkout is not a night. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const MS_PER_DAY = 86_400_000
  const a = Date.parse(`${checkIn}T00:00:00Z`)
  const b = Date.parse(`${checkOut}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new Error(`invalid date range ${checkIn}..${checkOut}`)
  }
  if (b <= a) {
    throw new Error(`check_out must be after check_in (${checkIn}..${checkOut})`)
  }
  return Math.round((b - a) / MS_PER_DAY)
}
