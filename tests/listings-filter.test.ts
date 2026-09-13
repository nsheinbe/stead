import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getListingForViewer, listActiveListings } from "../server/queries/listings";
import { getBookableListing } from "../server/queries/bookings";
import { SEED_HOST_EMAIL, SEED_HOST_ID, SEED_LISTING_IDS } from "../server/lib/seedInventory";
import { asMember, closeTestDb, id, insertListing, insertMember, ownerDatabaseUrl } from "./helpers/db";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

describeDb("explore filters on active listings", () => {
  const savedDemoFlag = process.env.ALLOW_DEMO_LISTINGS;

  afterEach(() => {
    if (savedDemoFlag === undefined) delete process.env.ALLOW_DEMO_LISTINGS;
    else process.env.ALLOW_DEMO_LISTINGS = savedDemoFlag;
  });

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

  it("hides known seed listings from the public catalog when demo inventory is off", async () => {
    const seedId = SEED_LISTING_IDS[0];
    const realId = id();
    const realHostId = id();
    await insertMember(SEED_HOST_ID, SEED_HOST_EMAIL, "Nora", true);
    await insertMember(realHostId, `host-${realHostId}@stead.example`, "Real host", true);
    await insertListing({
      id: seedId,
      hostId: SEED_HOST_ID,
      title: "Gable End Cottage",
      city: "Hudson",
    });
    await insertListing({
      id: realId,
      hostId: realHostId,
      title: "A real member home",
      city: "Hudson",
    });

    process.env.ALLOW_DEMO_LISTINGS = "0";
    const hidden = await asMember(null, (tx) => listActiveListings(tx));
    expect(hidden.map((l) => l.id)).not.toContain(seedId);
    expect(hidden.map((l) => l.id)).toContain(realId);

    const publicDetail = await asMember(null, (tx) => getListingForViewer(tx, seedId, null));
    expect(publicDetail).toBeNull();

    const hostDetail = await asMember(SEED_HOST_ID, (tx) =>
      getListingForViewer(tx, seedId, SEED_HOST_ID),
    );
    expect(hostDetail?.id).toBe(seedId);

    const bookable = await asMember(null, (tx) => getBookableListing(tx, seedId));
    expect(bookable).toBeUndefined();

    process.env.ALLOW_DEMO_LISTINGS = "1";
    const shown = await asMember(null, (tx) => listActiveListings(tx));
    expect(shown.map((l) => l.id)).toContain(seedId);
    const bookableWhenAllowed = await asMember(null, (tx) => getBookableListing(tx, seedId));
    expect(bookableWhenAllowed?.id).toBe(seedId);
  });
});
