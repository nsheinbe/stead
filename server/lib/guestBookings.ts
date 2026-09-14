/**
 * Soft Dist kill-switch for live guest rentals.
 *
 * Production stays closed until Nick sets ALLOW_GUEST_BOOKINGS=1 on Vercel.
 * Unset or any value other than "1" refuses create-booking (and therefore
 * stay payment / setup intents for new bookings) fail-closed.
 */
type Env = Record<string, string | undefined>;

/** Exact string the API returns when the gate is closed. */
export const GUEST_BOOKINGS_CLOSED_MESSAGE = "Bookings aren't open yet.";

/**
 * True only when ALLOW_GUEST_BOOKINGS=1. "true", "yes", whitespace-only, and
 * unset are all off — the launch switch is deliberate, not ambient.
 */
export function allowGuestBookings(env: Env = process.env): boolean {
  return env.ALLOW_GUEST_BOOKINGS?.trim() === "1";
}
