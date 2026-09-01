import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { isPendingExpired } from "../server/lib/expirePending";
import { handleStripeEvent } from "../server/lib/stripeWebhook";
import {
  claimStripeEvent,
  confirmBookingForPaymentIntent,
  expirePendingBookings,
} from "../server/queries/bookings";
import {
  closeTestDb,
  databaseUrl,
  getTestDb,
  id,
  insertBooking,
  insertListing,
  insertMember,
} from "./helpers/db";

describe("isPendingExpired", () => {
  it("expires a hold at the ttl boundary", () => {
    const created = new Date("2026-08-30T12:00:00Z");
    expect(isPendingExpired(created, new Date("2026-08-30T12:29:59Z"), 30)).toBe(false);
    expect(isPendingExpired(created, new Date("2026-08-30T12:30:00Z"), 30)).toBe(true);
  });
});

describe("stripe webhook handler", () => {
  it("is idempotent: the second delivery of the same event is skipped", async () => {
    const seen = new Set<string>();
    const confirmed: string[] = [];
    const store = {
      claimEvent: async (eventId: string) => {
        if (seen.has(eventId)) return false;
        seen.add(eventId);
        return true;
      },
      confirmBookingByPaymentIntent: async (pi: string) => {
        confirmed.push(pi);
        return true;
      },
    };

    const event = {
      id: "evt_1",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_abc" } },
    };

    const first = await handleStripeEvent(event, store);
    const second = await handleStripeEvent(event, store);
    expect(first).toEqual({ skipped: false, confirmed: true });
    expect(second).toEqual({ skipped: true, confirmed: false });
    expect(confirmed).toEqual(["pi_abc"]);
  });
});

const describeDb = databaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("expirePendingBookings", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("expires pending_payment rows older than the ttl and leaves fresh ones", async () => {
    const db = await getTestDb();
    const hostId = id();
    const guestId = id();
    const listingId = id();

    await insertMember(db, hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(db, guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing(db, { id: listingId, hostId, title: "Expire cottage" });

    const stale = await insertBooking(db, {
      listingId,
      guestId,
      checkIn: "2026-09-01",
      checkOut: "2026-09-03",
      createdAt: new Date(Date.now() - 45 * 60_000).toISOString(),
    });
    const fresh = await insertBooking(db, {
      listingId,
      guestId,
      checkIn: "2026-09-10",
      checkOut: "2026-09-12",
    });

    expect(await expirePendingBookings(db, 30)).toBeGreaterThanOrEqual(1);

    const statuses = (await db.execute<{ id: string; status: string }>(sql`
      SELECT id::text, status::text FROM public.bookings WHERE id IN (${stale}::uuid, ${fresh}::uuid)
    `)) as unknown as { id: string; status: string }[];

    expect(statuses.find((r) => r.id === stale)?.status).toBe("expired");
    expect(statuses.find((r) => r.id === fresh)?.status).toBe("pending_payment");

    const beats = (await db.execute<{ last_ok: Date | null }>(sql`
      SELECT last_ok FROM public.cron_heartbeats WHERE job = 'expire-pending'
    `)) as unknown as { last_ok: Date | null }[];
    expect(beats[0]?.last_ok).toBeTruthy();
  });
});

describeDb("stripe idempotency and confirmation against Postgres", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("claims an event exactly once and confirms the matching booking", async () => {
    const db = await getTestDb();
    const hostId = id();
    const guestId = id();
    const listingId = id();
    const paymentIntentId = `pi_${id()}`;
    const eventId = `evt_${id()}`;

    await insertMember(db, hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(db, guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing(db, { id: listingId, hostId, title: "Webhook cottage" });

    const bookingId = await insertBooking(db, {
      listingId,
      guestId,
      checkIn: "2027-06-01",
      checkOut: "2027-06-04",
    });
    await db.execute(sql`
      UPDATE public.bookings SET stripe_payment_intent_id = ${paymentIntentId} WHERE id = ${bookingId}::uuid
    `);

    expect(await claimStripeEvent(db, eventId, "payment_intent.succeeded")).toBe(true);
    expect(await claimStripeEvent(db, eventId, "payment_intent.succeeded")).toBe(false);

    expect(await confirmBookingForPaymentIntent(db, paymentIntentId)).toBe(true);
    // Already confirmed: a replay must not transition it again.
    expect(await confirmBookingForPaymentIntent(db, paymentIntentId)).toBe(false);
  });
});
