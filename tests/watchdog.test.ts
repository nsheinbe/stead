import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALE_MS,
  evaluateHeartbeats,
  staleAfterMs,
  watchdogHasAlerts,
} from "../server/lib/watchdog";

const now = new Date("2026-09-09T12:00:00Z");

describe("watchdog heartbeat evaluation", () => {
  it("flags a never-ok job as stale", () => {
    const report = evaluateHeartbeats(
      [{ job: "check-in", lastOk: null, lastError: null }],
      now,
    );
    expect(report.stale).toHaveLength(1);
    expect(report.errored).toHaveLength(0);
    expect(watchdogHasAlerts(report)).toBe(true);
  });

  it("flags last_error even when last_ok is fresh", () => {
    const report = evaluateHeartbeats(
      [{ job: "check-in", lastOk: now, lastError: "boom" }],
      now,
    );
    expect(report.errored.map((r) => r.job)).toEqual(["check-in"]);
    expect(report.stale).toHaveLength(0);
  });

  it("uses the tighter window for expire-pending", () => {
    expect(staleAfterMs("expire-pending")).toBe(30 * 60 * 1000);
    const fresh = evaluateHeartbeats(
      [{ job: "expire-pending", lastOk: new Date(now.getTime() - 10 * 60 * 1000), lastError: null }],
      now,
    );
    const stale = evaluateHeartbeats(
      [{ job: "expire-pending", lastOk: new Date(now.getTime() - 31 * 60 * 1000), lastError: null }],
      now,
    );
    expect(fresh.stale).toHaveLength(0);
    expect(stale.stale).toHaveLength(1);
  });

  it("treats unknown jobs as daily", () => {
    expect(staleAfterMs("some-new-job")).toBe(DEFAULT_STALE_MS);
    const report = evaluateHeartbeats(
      [
        {
          job: "some-new-job",
          lastOk: new Date(now.getTime() - 25 * 60 * 60 * 1000),
          lastError: null,
        },
      ],
      now,
    );
    expect(report.stale).toHaveLength(0);
  });

  it("is quiet when every job is fresh and clean", () => {
    const report = evaluateHeartbeats(
      [
        { job: "check-in", lastOk: now, lastError: null },
        { job: "watchdog", lastOk: now, lastError: null },
      ],
      now,
    );
    expect(watchdogHasAlerts(report)).toBe(false);
  });
});
