/** Pure expire-pending rules. The SQL function is the source of truth in Postgres. */

export function isPendingExpired(
  createdAt: Date,
  now: Date,
  ttlMinutes: number,
): boolean {
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1) {
    throw new Error("ttlMinutes must be a positive integer");
  }
  return now.getTime() - createdAt.getTime() >= ttlMinutes * 60 * 1000;
}

export const DEFAULT_PENDING_TTL_MINUTES = 30;
