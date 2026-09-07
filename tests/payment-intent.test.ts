/**
 * B-3 (AUDIT.md). app.confirm_booking_for_payment_intent finds its booking by
 * stripe_payment_intent_id, so two rows sharing one id would let a single
 * payment confirm two bookings. The index is unique but partial, because the
 * id is null between insert and intent creation.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  closeTestDb,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

const UNIQUE_VIOLATION = "23505";

function pgCode(err: unknown): string | undefined {
  // Drizzle wraps driver errors, so the code hangs off the cause chain.
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && cursor; depth += 1) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return undefined;
}

describeDb("one payment intent confirms one booking", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("refuses a second booking carrying the same payment intent", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing({ id: listingId, hostId, title: "Intent cottage" });

    const paymentIntentId = `pi_dupe_${hostId.slice(0, 8)}`;

    await insertBooking({
      listingId,
      guestId,
      checkIn: "2026-10-01",
      checkOut: "2026-10-31",
      paymentIntentId,
    });

    // Dates deliberately far apart, so the exclusion constraint cannot be what
    // rejects this — the uniqueness of the intent id has to be.
    const duplicate = await insertBooking({
      listingId,
      guestId,
      checkIn: "2027-03-01",
      checkOut: "2027-03-31",
      paymentIntentId,
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(duplicate).not.toBeNull();
    expect(pgCode(duplicate)).toBe(UNIQUE_VIOLATION);
  });

  it("still allows many bookings that have no intent yet", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing({ id: listingId, hostId, title: "Null intent cottage" });

    // Both sit at NULL between insert and intent creation. A non-partial
    // unique index would reject the second one.
    await insertBooking({ listingId, guestId, checkIn: "2026-10-01", checkOut: "2026-10-31" });
    const second = await insertBooking({
      listingId,
      guestId,
      checkIn: "2027-05-01",
      checkOut: "2027-05-31",
    }).then(
      (bookingId) => bookingId,
      (err: unknown) => err,
    );

    expect(typeof second).toBe("string");
  });
});
