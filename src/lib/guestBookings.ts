/**
 * Soft Dist copy when guest bookings are closed.
 * The server flag is the authority; this only keeps the UI honest.
 */
export const BOOKINGS_CLOSED_COPY = {
  title: "Not open for bookings yet",
  body: "Guest stays aren't live yet. You can still read the home and message the host.",
} as const;

/** Fail closed unless the server said bookings are open. */
export function guestBookingsOpen(config: { guestBookingsOpen?: boolean } | null | undefined): boolean {
  return config?.guestBookingsOpen === true;
}
