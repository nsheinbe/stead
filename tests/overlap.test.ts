import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createBookingWithEscrow,
  DateConflictError,
  isExclusionViolation,
} from "../server/queries/bookings";
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

describeDb("bookings exclusion constraint", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("rejects a second overlapping pending_payment on the same listing", async () => {
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing({ id: listingId, hostId, title: "Overlap cottage" });

    await insertBooking({
      listingId,
      guestId: guestA,
      checkIn: "2026-10-01",
      checkOut: "2026-10-04",
    });

    const conflict = await insertBooking({
      listingId,
      guestId: guestB,
      checkIn: "2026-10-03",
      checkOut: "2026-10-06",
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(conflict).not.toBeNull();
    // The route turns exactly this into a 409, so assert on the detector the
    // route uses rather than on the raw driver error shape.
    expect(isExclusionViolation(conflict)).toBe(true);
  });

  it("surfaces a conflict from createBookingWithEscrow as DateConflictError", async () => {
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing({ id: listingId, hostId, title: "Booked cottage" });

    const booking = {
      listingId,
      checkIn: "2027-08-01",
      checkOut: "2027-08-04",
      guests: 2,
      nights: 3,
      nightlyRateCents: 20000,
      staySubtotalCents: 60000,
      networkFeeCents: 1200,
      guestTotalCents: 61200,
      depositCents: 30000,
      cancellationPolicy: "moderate" as const,
    };
    const deposit = { amountCents: 30000, method: "auth_hold" as const, stripeSetupIntentId: null };

    // Booked by two different members through the real path, so the insert
    // policies are in force as well as the constraint.
    const first = await asMember(guestA, (tx) =>
      createBookingWithEscrow(tx, { ...booking, guestId: guestA }, deposit, {}),
    );
    expect(first.bookingId).toBeTruthy();

    await expect(
      asMember(guestB, (tx) =>
        createBookingWithEscrow(tx, { ...booking, guestId: guestB }, deposit, {}),
      ),
    ).rejects.toBeInstanceOf(DateConflictError);
  });

  it("allows a back-to-back stay that shares only the checkout morning", async () => {
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing({ id: listingId, hostId, title: "Adjacent cottage" });

    await insertBooking({
      listingId,
      guestId: guestA,
      checkIn: "2026-11-01",
      checkOut: "2026-11-03",
    });
    const second = await insertBooking({
      listingId,
      guestId: guestB,
      checkIn: "2026-11-03",
      checkOut: "2026-11-05",
    });
    expect(second).toBeTruthy();
  });

  it("frees dates once the first hold is expired", async () => {
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing({ id: listingId, hostId, title: "Freed cottage" });

    const first = await insertBooking({
      listingId,
      guestId: guestA,
      checkIn: "2026-12-01",
      checkOut: "2026-12-04",
    });
    await asOwner((db) =>
      db.execute(sql`UPDATE public.bookings SET status = 'expired' WHERE id = ${first}::uuid`),
    );

    const second = await insertBooking({
      listingId,
      guestId: guestB,
      checkIn: "2026-12-01",
      checkOut: "2026-12-04",
    });
    expect(second).toBeTruthy();
  });
});
