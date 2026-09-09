/**
 * Slice 4 — double-blind reviews: simultaneous reveal, 14-day publish,
 * illegal double-submit. Against real Postgres as app_user.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  asOwner,
  closeTestDb,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
  rawAsMember,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

function pgMessage(err: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && cursor; depth += 1) {
    const message = (cursor as { message?: unknown }).message;
    if (typeof message === "string") parts.push(message);
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

async function completedStay(opts?: { checkIn?: string; checkOut?: string }) {
  const hostId = id();
  const guestId = id();
  const listingId = id();
  const bookingId = id();
  await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
  await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
  await insertListing({ id: listingId, hostId });
  await insertBooking({
    id: bookingId,
    listingId,
    guestId,
    checkIn: opts?.checkIn ?? "2028-01-01",
    checkOut: opts?.checkOut ?? "2028-01-31",
    status: "completed",
  });
  return { hostId, guestId, listingId, bookingId };
}

async function submitAs(memberId: string, bookingId: string, rating = 5, body = "Cedar and coffee.") {
  const rows = (await rawAsMember(
    memberId,
    (tx) =>
      tx`SELECT app.submit_review(${bookingId}::uuid, ${rating}, '{}'::text[], ${body}) AS id`,
  )) as { id: string | null }[];
  return rows[0]?.id ?? null;
}

async function reviewRows(bookingId: string) {
  return asOwner(async (db) => {
    const rows = (await db.execute(sql`
      SELECT direction::text, author_id, subject_id, rating, published_at
        FROM public.reviews
       WHERE booking_id = ${bookingId}::uuid
       ORDER BY direction ASC
    `)) as unknown as {
      direction: string;
      author_id: string;
      subject_id: string;
      rating: number;
      published_at: string | null;
    }[];
    return rows;
  });
}

describeDb("reviews stay unpublished until both sides write", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("reveals both reviews at the same published_at when the second lands", async () => {
    const { hostId, guestId, bookingId } = await completedStay();

    await submitAs(guestId, bookingId, 5, "The kitchen looks like the photos.");
    const afterGuest = await reviewRows(bookingId);
    expect(afterGuest).toHaveLength(1);
    expect(afterGuest[0]?.published_at).toBeNull();

    // Double-blind: the host cannot read the guest's draft.
    const peeked = await rawAsMember(
      hostId,
      (tx) => tx`SELECT id, body FROM public.reviews WHERE booking_id = ${bookingId}::uuid`,
    );
    expect(peeked).toHaveLength(0);

    await submitAs(hostId, bookingId, 4, "Left it tidier than the photos.");
    const afterBoth = await reviewRows(bookingId);
    expect(afterBoth).toHaveLength(2);
    expect(afterBoth[0]?.published_at).not.toBeNull();
    expect(afterBoth[1]?.published_at).not.toBeNull();
    expect(afterBoth[0]?.published_at).toBe(afterBoth[1]?.published_at);

    const hostNowSees = await rawAsMember(
      hostId,
      (tx) => tx`SELECT rating FROM public.reviews WHERE booking_id = ${bookingId}::uuid ORDER BY direction`,
    );
    expect(hostNowSees).toHaveLength(2);
  });

  it("refuses a second review in the same direction", async () => {
    const { guestId, bookingId } = await completedStay();
    await submitAs(guestId, bookingId);

    const failure = await rawAsMember(
      guestId,
      (tx) => tx`SELECT app.submit_review(${bookingId}::uuid, 1, '{}'::text[], 'again') AS id`,
    ).then(
      () => null,
      (err: unknown) => err,
    );

    expect(failure).not.toBeNull();
    expect(pgMessage(failure)).toMatch(/review already submitted/i);
    expect(await reviewRows(bookingId)).toHaveLength(1);
  });

  it("publishes a lone review 14 days after listing-local checkout", async () => {
    const { guestId, hostId, bookingId } = await completedStay({
      checkIn: "2020-05-01",
      checkOut: "2020-05-31",
    });
    // Plant a draft the way a day-0 submit would have left it, then let the cron catch up.
    await asOwner(async (db) => {
      await db.execute(sql`
        INSERT INTO public.reviews (booking_id, author_id, subject_id, direction, rating, body)
        VALUES (
          ${bookingId}::uuid, ${guestId}::uuid, ${hostId}::uuid,
          'guest_reviews_host', 5, 'Fourteen days later.'
        )
      `);
    });
    expect((await reviewRows(bookingId))[0]?.published_at).toBeNull();

    const published = (await rawAsMember(
      guestId,
      (tx) => tx`SELECT app.publish_due_reviews() AS n`,
    )) as { n: number }[];
    expect(Number(published[0]?.n)).toBe(1);
    expect((await reviewRows(bookingId))[0]?.published_at).not.toBeNull();
  });

  it("does not publish a lone review still inside the 14-day window", async () => {
    // Default fixture checkout is 2028-01-31 — well after now, so the 14-day
    // path must not fire. Only the both-in path publishes a recent stay.
    const { guestId, bookingId } = await completedStay();
    await submitAs(guestId, bookingId);

    const published = (await rawAsMember(
      guestId,
      (tx) => tx`SELECT app.publish_due_reviews() AS n`,
    )) as { n: number }[];
    expect(Number(published[0]?.n)).toBe(0);
    expect((await reviewRows(bookingId))[0]?.published_at).toBeNull();
  });

  it("refuses a review before checkout", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();
    const bookingId = id();
    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing({ id: listingId, hostId });
    await insertBooking({
      id: bookingId,
      listingId,
      guestId,
      checkIn: "2028-03-01",
      checkOut: "2028-03-31",
      status: "checked_in",
    });

    const failure = await rawAsMember(
      guestId,
      (tx) => tx`SELECT app.submit_review(${bookingId}::uuid, 5, '{}'::text[], 'too soon')`,
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(failure).not.toBeNull();
    expect(pgMessage(failure)).toMatch(/stay is not completed/i);
  });
});
