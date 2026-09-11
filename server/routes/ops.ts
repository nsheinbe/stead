/**
 * Minimal ops console. Gated by profiles.is_ops — same platform-set flag
 * shape as is_arbiter. There is no admin screen in /design, so this stays
 * utilitarian and does not invent one.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireUser, tenantQuery, type AppEnv } from "../lib/http";
import {
  isCurrentUserOps,
  listConversionTotals,
  listOpsDisputes,
  listOpsFrozenPayouts,
  listOpsHeartbeats,
} from "../queries/trust";
import { evaluateHeartbeats, type HeartbeatRow } from "../lib/watchdog";
import type { OpsSnapshot } from "../../src/lib/types";

export const opsRoutes = new Hono<AppEnv>();

opsRoutes.use("*", requireUser);

opsRoutes.get("/", async (c) => {
  const allowed = await tenantQuery(c, (tx) => isCurrentUserOps(tx));
  if (!allowed) {
    throw new HTTPException(403, { message: "This page is for ops." });
  }

  const [disputes, heartbeats, frozenPayouts, conversions] = await tenantQuery(c, async (tx) => {
    const [d, h, p, conv] = await Promise.all([
      listOpsDisputes(tx),
      listOpsHeartbeats(tx),
      listOpsFrozenPayouts(tx),
      listConversionTotals(tx),
    ]);
    return [d, h, p, conv] as const;
  });

  const rows: HeartbeatRow[] = heartbeats.map((h) => ({
    job: h.job,
    lastOk: h.lastOk ? new Date(h.lastOk) : null,
    lastError: h.lastError,
  }));
  const report = evaluateHeartbeats(rows);

  const staleJobs = new Set(report.stale.map((r) => r.job));
  const erroredJobs = new Set(report.errored.map((r) => r.job));

  const body: OpsSnapshot = {
    disputes,
    heartbeats: heartbeats.map((h) => ({
      ...h,
      stale: staleJobs.has(h.job),
      errored: erroredJobs.has(h.job),
    })),
    frozenPayouts,
    conversions,
  };
  return c.json(body);
});
