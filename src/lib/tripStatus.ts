/**
 * What a stay's status means, and what there is to do about it.
 *
 * The status column is the authority for all of it. Nothing here infers a
 * state from elapsed time, and nothing counts down: a hold's expiry is a
 * scheduled job, so the honest phrasing is "scheduled to expire", not a timer
 * implying the second it happens.
 *
 * The `pending_payment` case is the one that has to be careful. It means the
 * server has not recorded payment — which covers a payment still settling and
 * a checkout that was abandoned, and from the browser those look identical.
 * So it says what is true of both, and offers no "finish paying" action: there
 * is no endpoint today that resumes an existing booking's payment, and
 * sending someone back to checkout would create a second hold on the same
 * dates. Resuming is PAY-02's contract, and it does not exist yet.
 */
import type { BookingStatus } from "./types";

export type TripTone = "neutral" | "brand" | "warning" | "danger";

export type TripAction = { label: string; to: string };

export type TripState = {
  label: string;
  /** One sentence about what this status means for the person reading it. */
  meaning: string;
  tone: TripTone;
  /** True once the stay can no longer happen. */
  closed: boolean;
  /** Whether money can still move on this stay. */
  settled: boolean;
  action: TripAction | null;
};

export type TripStateInput = {
  status: BookingStatus;
  listingId: string;
  viewerIsHost?: boolean;
  /** Present on the detail response; drives the review call to action. */
  review?: { submitted: boolean; published: boolean } | null;
  bookingId?: string;
};

export function tripState({
  status,
  listingId,
  viewerIsHost = false,
  review = null,
  bookingId,
}: TripStateInput): TripState {
  switch (status) {
    case "pending_payment":
      return {
        label: "Not confirmed",
        meaning: viewerIsHost
          ? "The guest's payment hasn't been recorded. These dates are held until it is, or until the hold expires."
          : "We haven't recorded payment for this stay, so it isn't confirmed. Your dates are held until payment is recorded or the hold expires.",
        tone: "warning",
        closed: false,
        settled: false,
        // Deliberately not a "finish paying" link: there is no contract for
        // resuming an existing booking's payment, and sending someone back to
        // checkout would hold the same dates twice.
        action: viewerIsHost ? null : { label: "See this home", to: `/listing/${listingId}` },
      };

    case "confirmed":
      return {
        label: "Confirmed",
        meaning: viewerIsHost
          ? "Paid and booked. The guest arrives on the check-in date, in this home's time zone."
          : "Paid and booked. Check-in is on the date below, in the home's time zone.",
        tone: "brand",
        closed: false,
        settled: false,
        action: null,
      };

    case "checked_in":
      return {
        label: "In progress",
        meaning: viewerIsHost ? "The guest is in the home." : "You're in the home. Checkout is on the date below.",
        tone: "brand",
        closed: false,
        settled: false,
        action: null,
      };

    case "completed":
      return {
        label: "Completed",
        meaning: review?.published
          ? "This stay is finished and both reviews are published."
          : review?.submitted
            ? "This stay is finished. Your review is written and publishes when the other side writes theirs."
            : "This stay is finished. You can write your review now.",
        tone: "neutral",
        closed: true,
        // The deposit can still move while a claim window is open, so a
        // completed stay is not necessarily a settled one. The escrow state
        // says which, and it is rendered separately.
        settled: false,
        action:
          bookingId && !review?.submitted
            ? { label: "Write your review", to: `/review/${bookingId}` }
            : bookingId && review?.submitted
              ? { label: "See your review", to: `/review/${bookingId}` }
              : null,
      };

    case "canceled_by_guest":
      return {
        label: "Canceled",
        meaning: viewerIsHost
          ? "The guest canceled this stay. Any refund followed the cancellation policy on the booking."
          : "You canceled this stay. Any refund followed the cancellation policy on this booking.",
        tone: "neutral",
        closed: true,
        settled: true,
        action: viewerIsHost ? null : { label: "Find another home", to: "/explore" },
      };

    case "canceled_by_host":
      return {
        label: "Canceled by the host",
        meaning: viewerIsHost
          ? "You canceled this stay. Any refund followed the cancellation policy on the booking."
          : "The host canceled this stay. Any refund followed the cancellation policy on this booking.",
        tone: "warning",
        closed: true,
        settled: true,
        action: viewerIsHost ? null : { label: "Find another home", to: "/explore" },
      };

    case "expired":
      return {
        label: "Hold expired",
        meaning: viewerIsHost
          ? "This hold expired before payment was recorded, so the dates were released. Nothing was charged."
          : "This hold expired before payment was recorded, so the dates were released. Nothing was charged.",
        tone: "neutral",
        closed: true,
        settled: true,
        action: viewerIsHost ? null : { label: "See this home", to: `/listing/${listingId}` },
      };
  }
}

/** Which group a stay belongs in on the list. Order matters: soonest first. */
export type TripGroup = "needs_attention" | "upcoming" | "past";

export function tripGroup(status: BookingStatus): TripGroup {
  if (status === "pending_payment") return "needs_attention";
  if (status === "confirmed" || status === "checked_in") return "upcoming";
  return "past";
}

export const TRIP_GROUP_LABEL: Record<TripGroup, string> = {
  needs_attention: "Not confirmed",
  upcoming: "Upcoming and current",
  past: "Past and canceled",
};
