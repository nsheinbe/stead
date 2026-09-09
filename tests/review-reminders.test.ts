/**
 * Slice 7 — review reminder cadence. Day 3 and day 7 after listing-local
 * checkout, stop at 14 days or once the party has submitted.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { listReviewRemindersDue, markReviewReminderSent } from "../server/queries/trust";
import {
  asMember,
  asOwner,
  closeTestDb,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

function day(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function completedStay(checkoutDaysAgo: number) {
  const hostId = id();
  const guestId = id();
  const listingId = id();
  const bookingId = id();
  await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
  await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
  await insertListing({ id: listingId, hostId, timezone: "UTC" });
  await insertBooking({
    id: bookingId,
    listingId,
    guestId,
    checkIn: day(checkoutDaysAgo - 30),
    checkOut: day(checkoutDaysAgo),
    status: "completed",
  });
  return { hostId, guestId, listingId, bookingId };
}

describeDb("review reminders", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("lists day3 for both parties three days after checkout", async () => {
    const stay = await completedStay(-4);
    const due = await asMember(null, (tx) => listReviewRemindersDue(tx));
    const ours = due.filter((row) => row.bookingId === stay.bookingId);
    expect(ours).toHaveLength(2);
    expect(new Set(ours.map((r) => r.kind))).toEqual(new Set(["day3"]));
    expect(new Set(ours.map((r) => r.recipientId))).toEqual(new Set([stay.guestId, stay.hostId]));
  });

  it("does not re-list a reminder after it is marked sent", async () => {
    const stay = await completedStay(-4);
    await asMember(null, (tx) => markReviewReminderSent(tx, stay.bookingId, stay.guestId, "day3"));
    const due = await asMember(null, (tx) => listReviewRemindersDue(tx));
    const ours = due.filter((row) => row.bookingId === stay.bookingId);
    expect(ours.map((r) => r.recipientId)).toEqual([stay.hostId]);
  });

  it("lists day7 a week after checkout, and nothing after 14 days", async () => {
    const week = await completedStay(-8);
    const late = await completedStay(-16);
    const due = await asMember(null, (tx) => listReviewRemindersDue(tx));
    const weekRows = due.filter((row) => row.bookingId === week.bookingId);
    const lateRows = due.filter((row) => row.bookingId === late.bookingId);
    expect(weekRows.length).toBeGreaterThan(0);
    expect(weekRows.every((r) => r.kind === "day7")).toBe(true);
    expect(lateRows).toHaveLength(0);
  });

  it("skips a party who already submitted", async () => {
    const stay = await completedStay(-4);
    await asOwner(async (db) => {
      await db.execute(sql`
        INSERT INTO public.reviews (booking_id, author_id, subject_id, direction, rating, body)
        VALUES (
          ${stay.bookingId}::uuid, ${stay.guestId}::uuid, ${stay.hostId}::uuid,
          'guest_reviews_host', 5, 'Lovely'
        )
      `);
    });
    const due = await asMember(null, (tx) => listReviewRemindersDue(tx));
    const ours = due.filter((row) => row.bookingId === stay.bookingId);
    expect(ours.map((r) => r.recipientId)).toEqual([stay.hostId]);
  });
});
