/** Pending-payment bookings hold dates against the exclusion constraint, so
 *  an abandoned checkout must time out. Shared by the cron function and its
 *  test so the boundary is defined once. */
export function expiryCutoff(ttlMinutes: number, now: Date = new Date()): Date {
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    throw new Error(`pending_payment_ttl_minutes must be positive, got ${ttlMinutes}`)
  }
  return new Date(now.getTime() - ttlMinutes * 60_000)
}
