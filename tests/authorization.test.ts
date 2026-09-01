/**
 * Neon has no RLS, so the guarantee the old `bookings_party_read` policy gave
 * us now has to come from the query layer. This is the same probe as before —
 * guest A cannot read guest B's booking — aimed at the functions the API
 * actually calls.
 */
import { afterAll, describe, expect, it } from "vitest";
import { getTripForParty, listTripsForGuest } from "../server/queries/bookings";
import { getListingForViewer, listActiveListings } from "../server/queries/listings";
import {
  closeTestDb,
  databaseUrl,
  getTestDb,
  id,
  insertBooking,
  insertListing,
  insertMember,
} from "./helpers/db";
import { sql } from "drizzle-orm";

const describeDb = databaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("booking visibility is scoped to the session user", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("guest A cannot read guest B's booking", async () => {
    const db = await getTestDb();
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(db, hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(db, guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(db, guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing(db, { id: listingId, hostId, title: "Authz cottage" });

    const bookingId = await insertBooking(db, {
      listingId,
      guestId: guestA,
      checkIn: "2027-01-08",
      checkOut: "2027-01-11",
      status: "confirmed",
    });

    expect(await getTripForParty(db, bookingId, guestA)).toMatchObject({ id: bookingId });
    expect(await getTripForParty(db, bookingId, guestB)).toBeNull();
  });

  it("the listing host can read a booking on their own listing", async () => {
    const db = await getTestDb();
    const hostId = id();
    const guestId = id();
    const listingId = id();

    await insertMember(db, hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(db, guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing(db, { id: listingId, hostId, title: "Host-visible cottage" });

    const bookingId = await insertBooking(db, {
      listingId,
      guestId,
      checkIn: "2027-02-08",
      checkOut: "2027-02-11",
      status: "confirmed",
    });

    expect(await getTripForParty(db, bookingId, hostId)).toMatchObject({ id: bookingId });
  });

  it("the trips list only returns the caller's own stays", async () => {
    const db = await getTestDb();
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(db, hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(db, guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(db, guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing(db, { id: listingId, hostId, title: "Trips cottage" });

    const mine = await insertBooking(db, {
      listingId,
      guestId: guestA,
      checkIn: "2027-03-08",
      checkOut: "2027-03-11",
      status: "confirmed",
    });
    await insertBooking(db, {
      listingId,
      guestId: guestB,
      checkIn: "2027-04-08",
      checkOut: "2027-04-11",
      status: "confirmed",
    });

    const trips = await listTripsForGuest(db, guestA);
    expect(trips.map((t) => t.id)).toEqual([mine]);
  });
});

describeDb("listing visibility", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("hides a paused listing from the public and shows it to its host", async () => {
    const db = await getTestDb();
    const hostId = id();
    const strangerId = id();
    const listingId = id();

    await insertMember(db, hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(db, strangerId, `stranger-${strangerId}@stead.example`, "Stranger");
    await insertListing(db, { id: listingId, hostId, title: "Paused cottage" });
    await db.execute(sql`UPDATE public.listings SET status = 'paused' WHERE id = ${listingId}::uuid`);

    expect(await getListingForViewer(db, listingId, null)).toBeNull();
    expect(await getListingForViewer(db, listingId, strangerId)).toBeNull();
    expect(await getListingForViewer(db, listingId, hostId)).toMatchObject({ id: listingId });

    const active = await listActiveListings(db);
    expect(active.some((l) => l.id === listingId)).toBe(false);
  });
});
