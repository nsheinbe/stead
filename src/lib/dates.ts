import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/** ISO yyyy-mm-dd. Bookings are date-based; only escrow needs instants. */
export type IsoDate = string

export function toIsoDate(date: Date): IsoDate {
  return formatInTimeZone(date, 'UTC', 'yyyy-MM-dd')
}

/**
 * Resolve a listing-local wall-clock time on a given date to a real instant.
 *
 * All scheduling is listing-local (BUILD_PROMPT §5): check-in at 16:00 in the
 * listing's IANA zone is a different instant in Bend than in Berlin, and on a
 * DST boundary it is not even a fixed offset from UTC. Never assume UTC.
 */
export function listingLocalInstant(
  date: IsoDate,
  wallClock: string,
  timezone: string,
): Date {
  return fromZonedTime(`${date}T${wallClock}:00`, timezone)
}

export function formatDateInZone(
  date: Date | string,
  timezone: string,
  pattern = 'EEE, MMM d',
): string {
  return formatInTimeZone(date, timezone, pattern)
}

/** Display range for a stay, e.g. "Oct 1 – Oct 5". */
export function formatStayRange(
  checkIn: IsoDate,
  checkOut: IsoDate,
  timezone: string,
): string {
  const start = formatInTimeZone(`${checkIn}T00:00:00Z`, timezone, 'MMM d')
  const end = formatInTimeZone(`${checkOut}T00:00:00Z`, timezone, 'MMM d')
  return `${start} – ${end}`
}
