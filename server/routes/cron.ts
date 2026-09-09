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
import {
  depositReleasedEmail,
  reviewOpenEmail,
  reviewReminderEmail,
  sendEmail,
  watchdogAlertEmail,
} from "../lib/email";
import { expirePendingBookings, recordHeartbeat } from "../queries/bookings";
import {
  holdDueEscrows,
  openDueClaimWindows,
  refundExpiredBooking,
  releaseDueEscrows,
} from "../queries/escrow";
import { listReviewOpenNotices, publishDueReviews } from "../queries/reviews";
import { getConfigMap, intFromConfig } from "../queries/listings";
import {
  listExpiredUnrefunded,
  listReviewRemindersDue,
  listWatchdogHeartbeats,
  markReviewReminderSent,
} from "../queries/trust";
import { evaluateHeartbeats, watchdogHasAlerts } from "../lib/watchdog";
import { getStripe, stripeConfigured } from "../lib/stripe";
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

/** held → claim_window, at each listing's local checkout time. Reviews open then. */
cronRoutes.on(["GET", "POST"], "/check-out", async (c) => {
  assertCronCaller(c.req.header("authorization"));
  const opened = await runJob(c, "check-out", (tx) => openDueClaimWindows(tx));
  const notices = await tenantQuery(c, (tx) => listReviewOpenNotices(tx)).catch(() => []);
  let notified = 0;
  for (const notice of notices) {
    const mail = reviewOpenEmail({ listingTitle: notice.listingTitle });
    const guest = await sendEmail({ to: notice.guestEmail, ...mail });
    const host = await sendEmail({ to: notice.hostEmail, ...mail });
    if (guest) notified += 1;
    if (host) notified += 1;
  }
  return c.json({ opened, notified });
});

/** Both reviews in → publish together; else 14 days after listing-local checkout. */
cronRoutes.on(["GET", "POST"], "/publish-reviews", async (c) => {
  assertCronCaller(c.req.header("authorization"));
  const published = await runJob(c, "publish-reviews", (tx) => publishDueReviews(tx));
  return c.json({ published });
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

/** Follow-up review reminders: day 3 and day 7 after listing-local checkout. */
cronRoutes.on(["GET", "POST"], "/review-reminders", async (c) => {
  assertCronCaller(c.req.header("authorization"));
  const due = await runJob(c, "review-reminders", (tx) => listReviewRemindersDue(tx));
  const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
  let notified = 0;
  for (const reminder of due) {
    const sent = await sendEmail({
      to: reminder.recipientEmail,
      ...reviewReminderEmail({
        listingTitle: reminder.listingTitle,
        kind: reminder.kind,
        reviewUrl: `${appUrl}/review/${reminder.bookingId}`,
      }),
    });
    if (sent) {
      await tenantQuery(c, (tx) =>
        markReviewReminderSent(tx, reminder.bookingId, reminder.recipientId, reminder.kind),
      ).catch(() => {});
      notified += 1;
    }
  }
  return c.json({ due: due.length, notified });
});

/**
 * Daily ops watchdog. Emails OPS_ALERT_EMAIL when any heartbeat is stale or
 * still carrying last_error. Also retries expired-and-paid bookings the
 * webhook failed to refund — that sweep was left for this job.
 */
cronRoutes.on(["GET", "POST"], "/watchdog", async (c) => {
  assertCronCaller(c.req.header("authorization"));

  const heartbeats = await runJob(c, "watchdog", (tx) => listWatchdogHeartbeats(tx));
  const report = evaluateHeartbeats(heartbeats);
  let emailed = false;
  if (watchdogHasAlerts(report)) {
    const to = process.env.OPS_ALERT_EMAIL;
    if (to) {
      emailed = await sendEmail({ to, ...watchdogAlertEmail(report) });
    } else {
      console.error("[watchdog] OPS_ALERT_EMAIL is unset; alerts printed only");
      console.error("[watchdog]", JSON.stringify(report));
      emailed = false;
    }
  }

  let refunded = 0;
  if (stripeConfigured()) {
    const due = await tenantQuery(c, (tx) => listExpiredUnrefunded(tx)).catch(() => []);
    for (const row of due) {
      try {
        const refund = await getStripe().refunds.create({
          payment_intent: row.paymentIntentId,
          amount: row.guestTotalCents,
        });
        const ok = await tenantQuery(c, (tx) =>
          refundExpiredBooking(tx, row.paymentIntentId, refund.id, row.guestTotalCents),
        );
        if (ok) refunded += 1;
      } catch (err) {
        console.error("[watchdog] could not refund an expired booking", row.bookingId, err);
      }
    }
  }

  return c.json({
    stale: report.stale.length,
    errored: report.errored.length,
    emailed,
    expiredRefunded: refunded,
  });
});
