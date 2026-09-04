/**
 * The query layer, run as app_user under RLS.
 *
 * tests/rls.test.ts proves the database refuses. This proves the functions the
 * routes call behave correctly on top of it — that a trip resolves for its
 * parties, that the trips list is the caller's own, and that a 404 is a 404.
 */
import { afterAll, describe, expect, it } from "vitest";
import { getTripForParty, listTripsForGuest } from "../server/queries/bookings";
import { getListingForViewer, listActiveListings } from "../server/queries/listings";
import {
  asMember,
  closeTestDb,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
} from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("booking visibility is scoped to the session user", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("guest A cannot read guest B's booking", async () => {
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing({ id: listingId, hostId, title: "Authz cottage" });

    const bookingId = await insertBooking({
      listingId,
      guestId: guestA,
      checkIn: "2027-01-08",
      checkOut: "2027-02-07",
      status: "confirmed",
    });

    expect(await asMember(guestA, (tx) => getTripForParty(tx, bookingId, guestA))).toMatchObject({
      id: bookingId,
    });
    expect(await asMember(guestB, (tx) => getTripForParty(tx, bookingId, guestB))).toBeNull();
  });

  it("the listing host can read a booking on their own listing", async () => {
    const hostId = id();
    const guestId = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestId, `guest-${guestId}@stead.example`, "Guest");
    await insertListing({ id: listingId, hostId, title: "Host-visible cottage" });

    const bookingId = await insertBooking({
      listingId,
      guestId,
      checkIn: "2027-02-08",
      checkOut: "2027-03-10",
      status: "confirmed",
    });

    expect(await asMember(hostId, (tx) => getTripForParty(tx, bookingId, hostId))).toMatchObject({
      id: bookingId,
    });
  });

  it("the trips list only returns the caller's own stays", async () => {
    const hostId = id();
    const guestA = id();
    const guestB = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(guestA, `guest-a-${guestA}@stead.example`, "Guest A");
    await insertMember(guestB, `guest-b-${guestB}@stead.example`, "Guest B");
    await insertListing({ id: listingId, hostId, title: "Trips cottage" });

    const mine = await insertBooking({
      listingId,
      guestId: guestA,
      checkIn: "2027-03-08",
      checkOut: "2027-04-07",
      status: "confirmed",
    });
    await insertBooking({
      listingId,
      guestId: guestB,
      checkIn: "2027-04-08",
      checkOut: "2027-05-08",
      status: "confirmed",
    });

    const trips = await asMember(guestA, (tx) => listTripsForGuest(tx, guestA));
    expect(trips.map((t) => t.id)).toEqual([mine]);
  });
});

describeDb("listing visibility", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("hides a paused listing from the public and shows it to its host", async () => {
    const hostId = id();
    const strangerId = id();
    const listingId = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertMember(strangerId, `stranger-${strangerId}@stead.example`, "Stranger");
    await insertListing({ id: listingId, hostId, title: "Paused cottage", status: "paused" });

    expect(await asMember(null, (tx) => getListingForViewer(tx, listingId, null))).toBeNull();
    expect(
      await asMember(strangerId, (tx) => getListingForViewer(tx, listingId, strangerId)),
    ).toBeNull();
    expect(await asMember(hostId, (tx) => getListingForViewer(tx, listingId, hostId))).toMatchObject(
      { id: listingId },
    );

    const active = await asMember(null, (tx) => listActiveListings(tx));
    expect(active.some((l) => l.id === listingId)).toBe(false);
  });
});
