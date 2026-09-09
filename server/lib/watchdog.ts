/**
 * Heartbeat evaluation for the daily ops watchdog. Pure so the cadence table
 * can be tested without Postgres — the cron only records and emails.
 *
 * Hourly jobs go stale after three hours. expire-pending is meant to fire
 * every few minutes, so half an hour is already a stop. Daily jobs get 26h.
 */
export type HeartbeatRow = {
  job: string;
  lastOk: Date | null;
  lastError: string | null;
};

export const STALE_AFTER_MS: Record<string, number> = {
  "expire-pending": 30 * 60 * 1000,
  "check-in": 3 * 60 * 60 * 1000,
  "check-out": 3 * 60 * 60 * 1000,
  "release-deposits": 3 * 60 * 60 * 1000,
  "publish-reviews": 26 * 60 * 60 * 1000,
  "review-reminders": 26 * 60 * 60 * 1000,
  watchdog: 26 * 60 * 60 * 1000,
};

export const DEFAULT_STALE_MS = 26 * 60 * 60 * 1000;

export type WatchdogReport = {
  stale: HeartbeatRow[];
  errored: HeartbeatRow[];
};

export function staleAfterMs(job: string): number {
  return STALE_AFTER_MS[job] ?? DEFAULT_STALE_MS;
}

export function evaluateHeartbeats(rows: HeartbeatRow[], now: Date = new Date()): WatchdogReport {
  const stale: HeartbeatRow[] = [];
  const errored: HeartbeatRow[] = [];

  for (const row of rows) {
    if (row.lastError) errored.push(row);
    const ok = row.lastOk?.getTime() ?? 0;
    if (!row.lastOk || now.getTime() - ok > staleAfterMs(row.job)) {
      stale.push(row);
    }
  }

  return { stale, errored };
}

export function watchdogHasAlerts(report: WatchdogReport): boolean {
  return report.stale.length > 0 || report.errored.length > 0;
}
