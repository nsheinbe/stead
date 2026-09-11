/**
 * HOST-01. The editor's server contract, end to end over HTTP.
 *
 * F07: the editor hydrated from `GET /api/listings/mine`, a dashboard summary
 * that omits description, type, address, region and amenities. Nothing was
 * lost on save only because the old editor could not edit those fields at all.
 * The moment it could, empty defaults would have gone over real data.
 *
 * These tests fix the contract the editor now relies on: an owner may read
 * their own draft in full, a full listing survives a create/read/edit/read
 * cycle intact, and nobody else can read or write it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/app";
import { diffListingInput, listingFormFromDetail, listingFormToInput } from "../src/lib/listingForm";
import type { ListingDetail, ListingInput } from "../src/lib/types";
import { closeTestDb, getHarness, id, insertMember, ownerDatabaseUrl } from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

/** Every editable field carrying a value we can recognise on the way back. */
const FULL_LISTING: ListingInput = {
  title: "The Gatehouse",
  description: "A stone gatehouse at the end of a long drive.",
  type: "private_room",
  addressLine: "14 Mill Lane",
  city: "Hudson",
  region: "New York",
  country: "US",
  timezone: "America/New_York",
  nightlyRateCents: 19_950,
  depositCents: 30_000,
  maxGuests: 4,
  amenities: { bedrooms: 2, beds: 3, wifi: true, kitchen: true },
  instantBook: true,
  cancellationPolicy: "strict",
  status: "draft",
};

function json(body: unknown, cookie?: string, method = "POST") {
  return {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  };
}

describeDb("the listing editor's contract", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    const harness = await getHarness();
    process.env.DATABASE_URL ??= harness.appUrl;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function aHost(label: string) {
    const hostId = id();
    const email = `${label}-${hostId}@stead.example`;
    await insertMember(hostId, email, label, true);
    return { hostId, cookie: await mintSessionCookie({ id: hostId, email, name: label }) };
  }

  async function createFullListing(cookie: string): Promise<string> {
    const res = await app.request("/api/listings", json(FULL_LISTING, cookie));
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function readAs(listingId: string, cookie?: string) {
    return app.request(`/api/listings/${listingId}`, cookie ? { headers: { cookie } } : undefined);
  }

  it("lets the owner read their own draft in full", async () => {
    const owner = await aHost("owner");
    const listingId = await createFullListing(owner.cookie);

    const res = await readAs(listingId, owner.cookie);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as ListingDetail;

    // Every field the editor needs is on this one response — no summary
    // endpoint expansion required.
    expect(detail.status).toBe("draft");
    expect(detail.description).toBe(FULL_LISTING.description);
    expect(detail.type).toBe(FULL_LISTING.type);
    expect(detail.addressLine).toBe(FULL_LISTING.addressLine);
    expect(detail.region).toBe(FULL_LISTING.region);
    expect(detail.amenities).toEqual(FULL_LISTING.amenities);
    expect(detail.instantBook).toBe(true);
    expect(detail.cancellationPolicy).toBe("strict");
    expect(detail.host?.id).toBe(owner.hostId);
  });

  it("round-trips a full listing through the editor without losing a field", async () => {
    const owner = await aHost("owner");
    const listingId = await createFullListing(owner.cookie);

    const before = (await (await readAs(listingId, owner.cookie)).json()) as ListingDetail;

    // Exactly what the editor does: hydrate, change one thing, send the diff.
    const values = listingFormFromDetail(before);
    const hydrated = listingFormToInput(values);
    const edited = listingFormToInput({ ...values, nightlyRate: "225" });
    expect(hydrated.ok && edited.ok).toBe(true);
    if (!hydrated.ok || !edited.ok) return;

    const patch = diffListingInput(hydrated.input, edited.input);
    expect(patch).toEqual({ nightlyRateCents: 22_500 });

    const saved = await app.request(`/api/listings/${listingId}`, json(patch, owner.cookie, "PATCH"));
    expect(saved.status, await saved.clone().text()).toBe(200);

    const after = (await (await readAs(listingId, owner.cookie)).json()) as ListingDetail;
    expect(after.nightlyRateCents).toBe(22_500);
    // The fields the old editor never loaded are still exactly as they were.
    expect(after.description).toBe(before.description);
    expect(after.type).toBe(before.type);
    expect(after.addressLine).toBe(before.addressLine);
    expect(after.region).toBe(before.region);
    expect(after.amenities).toEqual(before.amenities);
    expect(after.instantBook).toBe(before.instantBook);
    expect(after.cancellationPolicy).toBe(before.cancellationPolicy);
    expect(after.status).toBe(before.status);
  });

  it("writes every editable field when the host edits them all", async () => {
    const owner = await aHost("owner");
    const listingId = await createFullListing(owner.cookie);
    const before = (await (await readAs(listingId, owner.cookie)).json()) as ListingDetail;

    const values = listingFormFromDetail(before);
    const next = listingFormToInput({
      ...values,
      title: "The Gatehouse, renamed",
      description: "Rewritten.",
      type: "apartment",
      addressLine: "2 Mill Lane",
      city: "Kingston",
      region: "NY",
      country: "gb",
      timezone: "Europe/London",
      nightlyRate: "88.05",
      deposit: "0",
      maxGuests: "9",
      bedrooms: "1",
      beds: "1",
      wifi: false,
      kitchen: false,
      fireplace: true,
      courtyard: true,
      instantBook: false,
      cancellationPolicy: "flexible",
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;

    const hydrated = listingFormToInput(values);
    if (!hydrated.ok) throw new Error("hydration should be valid");
    const patch = diffListingInput(hydrated.input, next.input);

    const saved = await app.request(`/api/listings/${listingId}`, json(patch, owner.cookie, "PATCH"));
    expect(saved.status, await saved.clone().text()).toBe(200);

    const after = (await (await readAs(listingId, owner.cookie)).json()) as ListingDetail;
    expect(after.title).toBe("The Gatehouse, renamed");
    expect(after.description).toBe("Rewritten.");
    expect(after.type).toBe("apartment");
    expect(after.addressLine).toBe("2 Mill Lane");
    expect(after.city).toBe("Kingston");
    expect(after.region).toBe("NY");
    expect(after.country).toBe("GB");
    expect(after.timezone).toBe("Europe/London");
    expect(after.nightlyRateCents).toBe(8_805);
    expect(after.depositCents).toBe(0);
    expect(after.maxGuests).toBe(9);
    expect(after.instantBook).toBe(false);
    expect(after.cancellationPolicy).toBe("flexible");
    expect(after.amenities).toEqual({ bedrooms: 1, beds: 1, fireplace: true, courtyard: true });
  });

  it("hides another host's draft entirely", async () => {
    const owner = await aHost("owner");
    const stranger = await aHost("stranger");
    const listingId = await createFullListing(owner.cookie);

    expect((await readAs(listingId, stranger.cookie)).status).toBe(404);
    expect((await readAs(listingId)).status).toBe(404);
  });

  it("refuses an edit from anyone but the owner, and changes nothing", async () => {
    const owner = await aHost("owner");
    const stranger = await aHost("stranger");
    const listingId = await createFullListing(owner.cookie);

    const attempt = await app.request(
      `/api/listings/${listingId}`,
      json({ title: "Taken over", nightlyRateCents: 1 }, stranger.cookie, "PATCH"),
    );
    // RLS filters rather than raising, so the update affects zero rows and the
    // route reports the listing as not theirs.
    expect(attempt.status).toBe(404);

    const after = (await (await readAs(listingId, owner.cookie)).json()) as ListingDetail;
    expect(after.title).toBe(FULL_LISTING.title);
    expect(after.nightlyRateCents).toBe(FULL_LISTING.nightlyRateCents);
  });

  it("refuses an edit from a signed-out caller", async () => {
    const owner = await aHost("owner");
    const listingId = await createFullListing(owner.cookie);

    const attempt = await app.request(
      `/api/listings/${listingId}`,
      json({ title: "Taken over" }, undefined, "PATCH"),
    );
    expect(attempt.status).toBe(401);
  });

  it("rejects values the editor should never have sent", async () => {
    const owner = await aHost("owner");
    const listingId = await createFullListing(owner.cookie);

    const bad: Record<string, unknown>[] = [
      { title: "ab" },
      { country: "USA" },
      { timezone: "Mars/Olympus" },
      { nightlyRateCents: 0 },
      { nightlyRateCents: 199.5 },
      { depositCents: -1 },
      { maxGuests: 0 },
      { maxGuests: 51 },
      { type: "castle" },
      { cancellationPolicy: "whenever" },
      { status: "published" },
    ];

    for (const patch of bad) {
      const res = await app.request(`/api/listings/${listingId}`, json(patch, owner.cookie, "PATCH"));
      expect(res.status, `expected 400 for ${JSON.stringify(patch)}`).toBe(400);
    }

    // Nothing in that sequence touched the row.
    const after = (await (await readAs(listingId, owner.cookie)).json()) as ListingDetail;
    expect(after.title).toBe(FULL_LISTING.title);
    expect(after.nightlyRateCents).toBe(FULL_LISTING.nightlyRateCents);
    expect(after.maxGuests).toBe(FULL_LISTING.maxGuests);
  });

  it("keeps the dashboard summary separate from the editor's detail", async () => {
    const owner = await aHost("owner");
    await createFullListing(owner.cookie);

    const res = await app.request("/api/listings/mine", { headers: { cookie: owner.cookie } });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Record<string, unknown>[];
    const row = rows.find((r) => r.title === FULL_LISTING.title);
    expect(row).toBeTruthy();

    // The summary stays a summary. This is the assertion that would have
    // caught F07: hydrating an editor from it means these fields arrive
    // undefined.
    for (const omitted of ["description", "type", "addressLine", "region", "amenities"]) {
      expect(row).not.toHaveProperty(omitted);
    }
  });
});
