/**
 * Scheduled jobs, as plain authenticated endpoints: callers send
 * `Authorization: Bearer $CRON_SECRET`, which is the shape Vercel Cron uses and
 * anything else can imitate. Nothing schedules them from this repo — see README
 * "Scheduling expire-pending" for why the Hobby plan cannot.
 *
 * A scheduler is not a member either, so these run with no app.user_id and do
 * their work through the SECURITY DEFINER transitions.
 */
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { tenantQuery, type AppEnv } from "../lib/http";
import { expirePendingBookings, recordHeartbeat } from "../queries/bookings";
import { getConfigMap, intFromConfig } from "../queries/listings";

export const cronRoutes = new Hono<AppEnv>();

/** Constant-time compare; a length mismatch is simply false. */
function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertCronCaller(header: string | undefined): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new HTTPException(500, { message: "CRON_SECRET is not set" });
  }
  if (!header || !secretsMatch(header, `Bearer ${secret}`)) {
    throw new HTTPException(401, { message: "Not a scheduled caller" });
  }
}

cronRoutes.on(["GET", "POST"], "/expire-pending", async (c) => {
  assertCronCaller(c.req.header("authorization"));
  try {
    const expired = await tenantQuery(c, async (tx) => {
      const ttl = intFromConfig((await getConfigMap(tx)).pending_payment_ttl_minutes, 30);
      return expirePendingBookings(tx, ttl);
    });
    return c.json({ expired });
  } catch (err) {
    const message = err instanceof Error ? err.message : "expire-pending failed";
    await tenantQuery(c, (tx) => recordHeartbeat(tx, "expire-pending", message)).catch(() => {});
    throw new HTTPException(500, { message });
  }
});
