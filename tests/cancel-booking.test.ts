/**
 * Slice 6 — cancel-booking transition. The refund matrix lives in
 * tests/cancellation.test.ts; this file proves the SECURITY DEFINER write:
 * status, refunds row, escrow release, host blackout, host_cancellations.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { quoteGuestCancel, quoteHostCancel } from "../server/lib/cancellation";
import { cancelBooking, getCancelableBooking, previewCancellation } from "../server/queries/cancellations";
import {
  asMember,
  asOwner,
  bookingStatus,
  closeTestDb,
  getHarness,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

async function seedStay(opts: {
  status?: string;
  checkIn?: string;
  checkOut?: string;
  policy?: "flexible" | "moderate" | "strict";
  escrowState?: string;
} = {}) {
  const hostId = id();
  const guestId = id();
  const stranger = id();
  const listingId = id();
  await insertMember(hostId, `host-${hostId}@stead.example`, "Nora", true);
  await insertMember(guestId, `guest-${guestId}@stead.example`, "Sam");
  await insertMember(stranger, `other-${stranger}@stead.example`, "Other");
  await insertListing({ id: listingId, hostId, cancellationPolicy: opts.policy ?? "moderate" });
  const bookingId = await insertBooking({
    listingId,
    guestId,
    checkIn: opts.checkIn ?? "2031-06-01",
    checkOut: opts.checkOut ?? "2031-07-01",
    status: opts.status ?? "confirmed",
    cancellationPolicy: opts.policy ?? "moderate",
    paymentIntentId: `pi_test_${id()}`,
  });
  await asOwner(async (db) => {
    await db.execute(sql`
      INSERT INTO public.escrow_deposits (booking_id, amount_cents, state, method)
      VALUES (
        ${bookingId}::uuid, 30000,
        ${opts.escrowState ?? "scheduled"}::public.escrow_state,
        'card_on_file'
      )
    `);
  });
  return { hostId, guestId, stranger, listingId, bookingId };
}

describeDb("cancel-booking", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("guest cancel writes a refunds row, releases escrow, and matches the engine", async () => {
    const { guestId, bookingId } = await seedStay({ policy: "flexible" });
    const preview = await asMember(guestId, async (tx) => {
      const booking = await getCancelableBooking(tx, bookingId);
      if (!booking) throw new Error("missing booking");
      return previewCancellation(tx, booking, guestId);
    });
    expect(preview.canCancel).toBe(true);
    expect(preview.refundCents).toBeGreaterThan(0);

    const engine = quoteGuestCancel({
      policy: "flexible",
      staySubtotalCents: 600_000,
      networkFeeCents: 12_000,
      nightlyRateCents: 20_000,
      depositCents: 30_000,
      msUntilCheckIn: preview.hoursUntilCheckIn * 3_600_000,
    });
    expect(preview.refundCents).toBe(engine.refundCents);

    const result = await asMember(guestId, (tx) =>
      cancelBooking(tx, bookingId, preview.refundCents, "re_test_guest", false),
    );
    expect(result.newStatus).toBe("canceled_by_guest");
    expect(result.depositReleased).toBe(true);
    expect(await bookingStatus(bookingId)).toBe("canceled_by_guest");

    const { owner } = await getHarness();
    const refunds = (await owner.execute(sql`
      SELECT amount_cents, reason::text, stripe_refund_id
        FROM public.refunds WHERE booking_id = ${bookingId}::uuid
    `)) as unknown as { amount_cents: number; reason: string; stripe_refund_id: string }[];
    expect(refunds).toHaveLength(1);
    expect(Number(refunds[0]?.amount_cents)).toBe(preview.refundCents);
    expect(refunds[0]?.reason).toBe("guest_cancel");
    expect(refunds[0]?.stripe_refund_id).toBe("re_test_guest");

    const escrow = (await owner.execute(sql`
      SELECT state::text FROM public.escrow_deposits WHERE booking_id = ${bookingId}::uuid
    `)) as unknown as { state: string }[];
    expect(escrow[0]?.state).toBe("released");
  });

  it("host cancel refunds 100%, blacks the dates, and increments host_cancellations", async () => {
    const { hostId, guestId, listingId, bookingId } = await seedStay({
      policy: "strict",
      checkIn: "2031-08-01",
      checkOut: "2031-08-31",
    });
    const quote = quoteHostCancel({
      staySubtotalCents: 600_000,
      networkFeeCents: 12_000,
      depositCents: 30_000,
    });
    const result = await asMember(hostId, (tx) =>
      cancelBooking(tx, bookingId, quote.refundCents, "re_test_host", true),
    );
    expect(result.newStatus).toBe("canceled_by_host");
    expect(await bookingStatus(bookingId)).toBe("canceled_by_host");

    const { owner } = await getHarness();
    const blackouts = (await owner.execute(sql`
      SELECT start_date::text, end_date::text
        FROM public.listing_blackouts WHERE listing_id = ${listingId}::uuid
    `)) as unknown as { start_date: string; end_date: string }[];
    expect(blackouts).toEqual([{ start_date: "2031-08-01", end_date: "2031-08-31" }]);

    const stats = (await owner.execute(sql`
      SELECT host_cancellations FROM public.trust_stats WHERE profile_id = ${hostId}::uuid
    `)) as unknown as { host_cancellations: number }[];
    expect(Number(stats[0]?.host_cancellations)).toBe(1);

    const guestStats = (await owner.execute(sql`
      SELECT host_cancellations FROM public.trust_stats WHERE profile_id = ${guestId}::uuid
    `)) as unknown as { host_cancellations: number }[];
    expect(Number(guestStats[0]?.host_cancellations)).toBe(0);
  });

  it("refuses a stranger driving cancel-booking", async () => {
    const { stranger, bookingId } = await seedStay();
    await expect(
      asMember(stranger, (tx) => cancelBooking(tx, bookingId, 612_000, null, false)),
    ).rejects.toThrow(/only the guest|not signed in|cannot be canceled/i);
    expect(await bookingStatus(bookingId)).toBe("confirmed");
  });

  it("refuses a second cancel", async () => {
    const { guestId, bookingId } = await seedStay();
    await asMember(guestId, (tx) => cancelBooking(tx, bookingId, 612_000, "re_once", false));
    await expect(
      asMember(guestId, (tx) => cancelBooking(tx, bookingId, 612_000, "re_twice", false)),
    ).rejects.toThrow(/cannot be canceled/i);
  });
});
