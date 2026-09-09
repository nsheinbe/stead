import { afterAll, describe, expect, it } from "vitest";
import { listActiveListings } from "../server/queries/listings";
import { asMember, closeTestDb, id, insertListing, insertMember, ownerDatabaseUrl } from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("explore filters on active listings", () => {
  afterAll(async () => {
    await closeTestDb();
  });

  it("filters by city, type, guests, rate, and instant book", async () => {
    const hostId = id();
    const hudson = id();
    const lisbon = id();
    const loft = id();

    await insertMember(hostId, `host-${hostId}@stead.example`, "Host", true);
    await insertListing({
      id: hudson,
      hostId,
      title: "Hudson cottage",
      city: "Hudson",
      type: "entire_home",
      nightlyRateCents: 20_000,
      maxGuests: 4,
      instantBook: true,
    });
    await insertListing({
      id: lisbon,
      hostId,
      title: "Lisbon lemon",
      city: "Lisbon",
      type: "entire_home",
      nightlyRateCents: 17_800,
      maxGuests: 3,
      instantBook: true,
    });
    await insertListing({
      id: loft,
      hostId,
      title: "Warm brick loft",
      city: "Montréal",
      type: "apartment",
      nightlyRateCents: 14_600,
      maxGuests: 2,
      instantBook: false,
    });

    const byCity = await asMember(null, (tx) => listActiveListings(tx, { city: "Hudson" }));
    expect(byCity.map((l) => l.id)).toContain(hudson);
    expect(byCity.map((l) => l.id)).not.toContain(lisbon);

    const apartments = await asMember(null, (tx) => listActiveListings(tx, { type: "apartment" }));
    expect(apartments.map((l) => l.id)).toContain(loft);
    expect(apartments.map((l) => l.id)).not.toContain(hudson);

    const sleepsFour = await asMember(null, (tx) => listActiveListings(tx, { guests: 4 }));
    expect(sleepsFour.map((l) => l.id)).toContain(hudson);
    expect(sleepsFour.map((l) => l.id)).not.toContain(loft);

    const cheap = await asMember(null, (tx) =>
      listActiveListings(tx, { maxNightlyRateCents: 15_000 }),
    );
    expect(cheap.map((l) => l.id)).toContain(loft);
    expect(cheap.map((l) => l.id)).not.toContain(hudson);

    const instant = await asMember(null, (tx) => listActiveListings(tx, { instantBook: true }));
    expect(instant.map((l) => l.id)).toContain(hudson);
    expect(instant.map((l) => l.id)).not.toContain(loft);

    const search = await asMember(null, (tx) => listActiveListings(tx, { q: "lemon" }));
    expect(search.map((l) => l.id)).toContain(lisbon);
    expect(search.map((l) => l.id)).not.toContain(hudson);
  });
});
