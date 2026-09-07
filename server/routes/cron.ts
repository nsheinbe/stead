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
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { tenantQuery, type AppEnv } from "../lib/http";
import { depositReleasedEmail, sendEmail } from "../lib/email";
import { expirePendingBookings, recordHeartbeat } from "../queries/bookings";
import {
  holdDueEscrows,
  openDueClaimWindows,
  releaseDueEscrows,
} from "../queries/escrow";
import { getConfigMap, intFromConfig } from "../queries/listings";
import type { Tx } from "../db/client";

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

/**
 * Records a heartbeat either way. Only writing on failure would leave last_ok
 * permanently null, and a job that has silently stopped running looks exactly
 * like one that has never failed.
 */
async function runJob<T>(
  c: Context<AppEnv>,
  job: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await tenantQuery(c, work);
  } catch (err) {
    const message = err instanceof Error ? err.message : `${job} failed`;
    await tenantQuery(c, (tx) => recordHeartbeat(tx, job, message)).catch(() => {});
    throw new HTTPException(500, { message });
  }
  await tenantQuery(c, (tx) => recordHeartbeat(tx, job, null)).catch(() => {});
  return result;
}

cronRoutes.on(["GET", "POST"], "/expire-pending", async (c) => {
  assertCronCaller(c.req.header("authorization"));
  const expired = await runJob(c, "expire-pending", async (tx) => {
    const ttl = intFromConfig((await getConfigMap(tx)).pending_payment_ttl_minutes, 30);
    return expirePendingBookings(tx, ttl);
  });
  return c.json({ expired });
});

/** scheduled → held, at each listing's local check-in time. */
cronRoutes.on(["GET", "POST"], "/check-in", async (c) => {
  assertCronCaller(c.req.header("authorization"));
  const held = await runJob(c, "check-in", (tx) => holdDueEscrows(tx));
  return c.json({ held });
});

/** held → claim_window, at each listing's local checkout time. */
cronRoutes.on(["GET", "POST"], "/check-out", async (c) => {
  assertCronCaller(c.req.header("authorization"));
  const opened = await runJob(c, "check-out", (tx) => openDueClaimWindows(tx));
  return c.json({ opened });
});

/** claim_window → released, once the window has closed with no claim. */
cronRoutes.on(["GET", "POST"], "/release-deposits", async (c) => {
  assertCronCaller(c.req.header("authorization"));
  const released = await runJob(c, "release-deposits", (tx) => releaseDueEscrows(tx));

  // Deliberately after the transaction has committed: a transaction must never
  // span an outbound HTTP call, and the release is already durable. A guest who
  // does not get the mail still has their deposit back.
  let notified = 0;
  for (const deposit of released) {
    const sent = await sendEmail({
      to: deposit.guestEmail,
      ...depositReleasedEmail({
        listingTitle: deposit.listingTitle,
        amountCents: deposit.amountCents,
      }),
    });
    if (sent) notified += 1;
  }

  return c.json({ released: released.length, notified });
});
