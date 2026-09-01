/**
 * Scheduled jobs, as plain authenticated endpoints: callers send
 * `Authorization: Bearer $CRON_SECRET`, which is the shape Vercel Cron uses and
 * anything else can imitate. Nothing schedules them from this repo — see README
 * "Scheduling expire-pending" for why the Hobby plan cannot.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../lib/http";
import { expirePendingBookings, recordHeartbeat } from "../queries/bookings";
import { getConfigMap, intFromConfig } from "../queries/listings";

export const cronRoutes = new Hono<AppEnv>();

function assertCronCaller(header: string | undefined): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new HTTPException(500, { message: "CRON_SECRET is not set" });
  }
  if (header !== `Bearer ${secret}`) {
    throw new HTTPException(401, { message: "Not a scheduled caller" });
  }
}

cronRoutes.on(["GET", "POST"], "/expire-pending", async (c) => {
  assertCronCaller(c.req.header("authorization"));
  const db = c.get("db");
  try {
    const config = await getConfigMap(db);
    const ttl = intFromConfig(config.pending_payment_ttl_minutes, 30);
    return c.json({ expired: await expirePendingBookings(db, ttl) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "expire-pending failed";
    await recordHeartbeat(db, "expire-pending", message).catch(() => {});
    throw new HTTPException(500, { message });
  }
});
