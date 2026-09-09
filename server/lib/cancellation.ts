/**
 * Cancellation engine. Integer cents only. Timing is listing-local check-in
 * (BUILD_PROMPT §6): civil check-in date + app_config checkin_local_time in
 * listings.timezone, never UTC assumed as the door time.
 *
 * Guest rules, relative to that instant:
 *   flexible  ≥24h → 100% stay + fee; <24h → first night kept, rest of stay
 *             back, fee kept. After check-in is still the <24h band.
 *   moderate  ≥5 days → 100% + fee; <5 days before check-in → 50% of stay,
 *             fee kept; after check-in → nothing (no mid-stay proration).
 *   strict    ≥14 days → 100% + fee; 14–7 days → 50% of stay, fee kept;
 *             <7 days → nothing.
 *
 * Host cancel is always 100% of stay + fee. Deposit is always released and is
 * never part of the refund figure — it was never summed into guest_total.
 */
import { fromZonedTime } from "date-fns-tz";
import type { BookingStatus, CancellationPolicy } from "../../src/lib/types";
import { MoneyError } from "./pricing";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const FLEXIBLE_FULL_MS = 24 * HOUR_MS;
export const MODERATE_FULL_MS = 5 * DAY_MS;
export const STRICT_FULL_MS = 14 * DAY_MS;
export const STRICT_HALF_MS = 7 * DAY_MS;

export type CancelBand = "full" | "partial_first_night" | "half" | "none" | "pending" | "host";

export type CancellationQuote = {
  refundCents: number;
  stayRefundCents: number;
  feeRefundCents: number;
  feeRetainedCents: number;
  firstNightRetainedCents: number;
  depositReleasedCents: number;
  band: CancelBand;
  afterCheckIn: boolean;
  hoursUntilCheckIn: number;
  refundApplicationFee: boolean;
  reverseTransfer: boolean;
  summary: string;
};

export type GuestCancelInput = {
  policy: CancellationPolicy;
  staySubtotalCents: number;
  networkFeeCents: number;
  nightlyRateCents: number;
  depositCents: number;
  msUntilCheckIn: number;
  /** Booking already checked in (or later). Used only for reverse_transfer. */
  alreadyCheckedIn?: boolean;
};

function assertIntCents(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new MoneyError(`${label} must be an integer number of cents`);
  }
  if (value < 0) {
    throw new MoneyError(`${label} cannot be negative`);
  }
}

function halfStay(staySubtotalCents: number): number {
  return Math.trunc(staySubtotalCents / 2);
}

/**
 * Parses HH:MM (or HH:MM:SS) from app_config. Anything else falls back to 16:00,
 * the same default the check-in cron uses.
 */
export function parseLocalClock(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.length === 5 ? `${raw}:00` : raw;
  return "16:00:00";
}

/**
 * Instant the door opens, in UTC, from a listing-local civil date and clock.
 */
export function listingLocalCheckInAt(
  checkIn: string,
  timezone: string,
  checkinLocalTime: string,
): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
    throw new MoneyError("check-in must be YYYY-MM-DD");
  }
  const clock = parseLocalClock(checkinLocalTime);
  return fromZonedTime(`${checkIn}T${clock}`, timezone);
}

export function msUntilListingLocalCheckIn(input: {
  now: Date;
  checkIn: string;
  timezone: string;
  checkinLocalTime: string;
}): number {
  return listingLocalCheckInAt(input.checkIn, input.timezone, input.checkinLocalTime).getTime() - input.now.getTime();
}

function quoteFull(input: GuestCancelInput, band: CancelBand, afterCheckIn: boolean): CancellationQuote {
  const guestTotal = input.staySubtotalCents + input.networkFeeCents;
  return {
    refundCents: guestTotal,
    stayRefundCents: input.staySubtotalCents,
    feeRefundCents: input.networkFeeCents,
    feeRetainedCents: 0,
    firstNightRetainedCents: 0,
    depositReleasedCents: input.depositCents,
    band,
    afterCheckIn,
    hoursUntilCheckIn: input.msUntilCheckIn / HOUR_MS,
    refundApplicationFee: input.networkFeeCents > 0,
    reverseTransfer: !afterCheckIn && !input.alreadyCheckedIn,
    summary:
      band === "host"
        ? "The host canceled. The stay and the 2% come back in full. The deposit is released."
        : "Full refund of the stay and the 2%. The deposit is released.",
  };
}

export function quoteGuestCancel(input: GuestCancelInput): CancellationQuote {
  assertIntCents(input.staySubtotalCents, "stay_subtotal_cents");
  assertIntCents(input.networkFeeCents, "network_fee_cents");
  assertIntCents(input.nightlyRateCents, "nightly_rate_cents");
  assertIntCents(input.depositCents, "deposit_cents");
  if (!Number.isFinite(input.msUntilCheckIn)) {
    throw new MoneyError("msUntilCheckIn must be a finite number");
  }
  if (input.nightlyRateCents > input.staySubtotalCents) {
    throw new MoneyError("first night cannot exceed the stay subtotal");
  }

  const afterCheckIn = input.msUntilCheckIn < 0;
  const hoursUntilCheckIn = input.msUntilCheckIn / HOUR_MS;
  const depositReleasedCents = input.depositCents;

  if (input.policy === "flexible") {
    if (input.msUntilCheckIn >= FLEXIBLE_FULL_MS) {
      return quoteFull(input, "full", afterCheckIn);
    }
    const stayRefundCents = input.staySubtotalCents - input.nightlyRateCents;
    return {
      refundCents: stayRefundCents,
      stayRefundCents,
      feeRefundCents: 0,
      feeRetainedCents: input.networkFeeCents,
      firstNightRetainedCents: input.nightlyRateCents,
      depositReleasedCents,
      band: "partial_first_night",
      afterCheckIn,
      hoursUntilCheckIn,
      refundApplicationFee: false,
      reverseTransfer: !afterCheckIn && !input.alreadyCheckedIn,
      summary: "First night is kept. The rest of the stay comes back. The 2% stays. The deposit is released.",
    };
  }

  if (input.policy === "moderate") {
    if (input.msUntilCheckIn >= MODERATE_FULL_MS) {
      return quoteFull(input, "full", afterCheckIn);
    }
    if (afterCheckIn) {
      return {
        refundCents: 0,
        stayRefundCents: 0,
        feeRefundCents: 0,
        feeRetainedCents: input.networkFeeCents,
        firstNightRetainedCents: 0,
        depositReleasedCents,
        band: "none",
        afterCheckIn,
        hoursUntilCheckIn,
        refundApplicationFee: false,
        reverseTransfer: false,
        summary: "After check-in there is no stay refund on a moderate policy. The deposit is released.",
      };
    }
    const stayRefundCents = halfStay(input.staySubtotalCents);
    return {
      refundCents: stayRefundCents,
      stayRefundCents,
      feeRefundCents: 0,
      feeRetainedCents: input.networkFeeCents,
      firstNightRetainedCents: 0,
      depositReleasedCents,
      band: "half",
      afterCheckIn,
      hoursUntilCheckIn,
      refundApplicationFee: false,
      reverseTransfer: !input.alreadyCheckedIn,
      summary: "Half the stay comes back. The 2% stays. The deposit is released.",
    };
  }

  // strict
  if (input.msUntilCheckIn >= STRICT_FULL_MS) {
    return quoteFull(input, "full", afterCheckIn);
  }
  if (input.msUntilCheckIn >= STRICT_HALF_MS) {
    const stayRefundCents = halfStay(input.staySubtotalCents);
    return {
      refundCents: stayRefundCents,
      stayRefundCents,
      feeRefundCents: 0,
      feeRetainedCents: input.networkFeeCents,
      firstNightRetainedCents: 0,
      depositReleasedCents,
      band: "half",
      afterCheckIn,
      hoursUntilCheckIn,
      refundApplicationFee: false,
      reverseTransfer: !afterCheckIn && !input.alreadyCheckedIn,
      summary: "Half the stay comes back. The 2% stays. The deposit is released.",
    };
  }
  return {
    refundCents: 0,
    stayRefundCents: 0,
    feeRefundCents: 0,
    feeRetainedCents: input.networkFeeCents,
    firstNightRetainedCents: 0,
    depositReleasedCents,
    band: "none",
    afterCheckIn,
    hoursUntilCheckIn,
    refundApplicationFee: false,
    reverseTransfer: false,
    summary: "Inside 7 days of check-in a strict cancel keeps the stay. The deposit is released.",
  };
}

export function quoteHostCancel(input: {
  staySubtotalCents: number;
  networkFeeCents: number;
  depositCents: number;
  alreadyCheckedIn?: boolean;
}): CancellationQuote {
  return quoteFull(
    {
      policy: "flexible",
      staySubtotalCents: input.staySubtotalCents,
      networkFeeCents: input.networkFeeCents,
      nightlyRateCents: 0,
      depositCents: input.depositCents,
      msUntilCheckIn: 0,
      alreadyCheckedIn: input.alreadyCheckedIn,
    },
    "host",
    Boolean(input.alreadyCheckedIn),
  );
}

export function quotePendingCancel(depositCents: number): CancellationQuote {
  assertIntCents(depositCents, "deposit_cents");
  return {
    refundCents: 0,
    stayRefundCents: 0,
    feeRefundCents: 0,
    feeRetainedCents: 0,
    firstNightRetainedCents: 0,
    depositReleasedCents: depositCents,
    band: "pending",
    afterCheckIn: false,
    hoursUntilCheckIn: Number.POSITIVE_INFINITY,
    refundApplicationFee: false,
    reverseTransfer: false,
    summary: "Nothing has been charged. The dates come free. The deposit hold is released.",
  };
}

const CANCELABLE: ReadonlySet<BookingStatus> = new Set([
  "pending_payment",
  "confirmed",
  "checked_in",
]);

export function canCancelStatus(status: BookingStatus): boolean {
  return CANCELABLE.has(status);
}

export function quoteCancellation(input: {
  actor: "guest" | "host";
  status: BookingStatus;
  policy: CancellationPolicy;
  staySubtotalCents: number;
  networkFeeCents: number;
  nightlyRateCents: number;
  depositCents: number;
  msUntilCheckIn: number;
}): CancellationQuote {
  if (input.status === "pending_payment") {
    return quotePendingCancel(input.depositCents);
  }
  const alreadyCheckedIn = input.status === "checked_in";
  if (input.actor === "host") {
    return quoteHostCancel({
      staySubtotalCents: input.staySubtotalCents,
      networkFeeCents: input.networkFeeCents,
      depositCents: input.depositCents,
      alreadyCheckedIn,
    });
  }
  return quoteGuestCancel({
    policy: input.policy,
    staySubtotalCents: input.staySubtotalCents,
    networkFeeCents: input.networkFeeCents,
    nightlyRateCents: input.nightlyRateCents,
    depositCents: input.depositCents,
    msUntilCheckIn: input.msUntilCheckIn,
    alreadyCheckedIn,
  });
}

export const POLICY_RULES: Record<CancellationPolicy, string[]> = {
  flexible: [
    "Full refund of the stay and the 2% if you cancel at least 24 hours before listing-local check-in.",
    "Inside 24 hours: the first night is kept, the rest of the stay comes back, the 2% stays.",
  ],
  moderate: [
    "Full refund of the stay and the 2% if you cancel at least 5 days before listing-local check-in.",
    "Inside 5 days: half the stay comes back, the 2% stays.",
    "After check-in: no stay refund. Monthly stays are not prorated mid-stay.",
  ],
  strict: [
    "Full refund of the stay and the 2% if you cancel at least 14 days before listing-local check-in.",
    "From 14 days to 7 days: half the stay comes back, the 2% stays.",
    "Inside 7 days: no stay refund.",
  ],
};

export const DEPOSIT_ON_CANCEL =
  "The deposit is always fully released on any cancellation. It was never part of the stay total.";
