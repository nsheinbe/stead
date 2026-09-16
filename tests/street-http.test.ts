/**
 * HM-06 — who may see the front door, end to end over HTTP against Postgres.
 *
 * The claim this file has to defend is that the exact point never reaches a
 * viewer the host did not allow. Asserting "the response says rounded" would
 * not do it: a rounded flag beside an exact number is still a leak. So the
 * tests compare the delivered pin against the real one and require it to have
 * actually moved, and they read the whole serialised body for the true
 * coordinate rather than trusting the field it was supposed to arrive in.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { app } from "../server/app";
import type { ApproachVisibility, BookingStatus, ListingDetail } from "../src/lib/types";
import { addressIsShared } from "../src/lib/tripStatus";
import {
  asOwner,
  closeTestDb,
  getHarness,
  id,
  insertBooking,
  insertListing,
  insertMember,
  ownerDatabaseUrl,
} from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

/** A real front door, to five decimals — about a metre. */
const DOOR = { lat: 42.25291, lng: -73.79107 };
const GRID_M = 150;

/** Metres between two points, near enough at this scale to judge rounding. */
function metresApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

describeDb("HM-06 who sees the door", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    const harness = await getHarness();
    process.env.DATABASE_URL ??= harness.appUrl;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function aMember(label: string) {
    const memberId = id();
    const email = `${label}-${memberId}@stead.example`;
    await insertMember(memberId, email, label, true);
    return { id: memberId, email, cookie: await mintSessionCookie({ id: memberId, email, name: label }) };
  }

  type Member = Awaited<ReturnType<typeof aMember>>;

  async function aHome(
    host: Member,
    opts: { visibility?: ApproachVisibility; approach?: boolean; confirmed?: boolean; status?: string } = {},
  ) {
    const listingId = id();
    const scanId = id();
    await insertListing({ id: listingId, hostId: host.id, title: "Door cottage", status: "active" });
    await asOwner(async (db) => {
      await db.execute(sql`
        UPDATE public.listings
           SET lat = ${DOOR.lat}, lng = ${DOOR.lng},
               coordinates_confirmed_at = ${opts.confirmed === false ? null : sql`now()`},
               approach_visibility = ${opts.visibility ?? "confirmed_stay"}::public.approach_visibility,
               status = ${opts.status ?? "active"}::public.listing_status
         WHERE id = ${listingId}::uuid
      `);
      if (opts.approach) {
        await db.execute(sql`
          INSERT INTO public.listing_scans (
            id, listing_id, host_id, state, honesty_policy_version,
            accuracy_max_m, geofence_radius_m, bookend_window_seconds, bookend_min_samples,
            min_indoor_seconds, max_seconds, target_lat, target_lng,
            captured_on, completed_at, verified_at, attempt, job
          ) VALUES (
            ${scanId}::uuid, ${listingId}::uuid, ${host.id}::uuid, 'verified'::public.scan_state, 1,
            35, 100, 90, 15, 60, 600, ${DOOR.lat}, ${DOOR.lng},
            '2026-09-14'::date, now(), now(), 1, 'crop'
          )
        `);
        await db.execute(sql`
          INSERT INTO public.scan_artifacts (scan_id, kind, object_key, content_type, size_bytes)
          VALUES (${scanId}::uuid, 'approach',
                  ${`listings/${listingId}/scans/${scanId}/approach/00.jpg`}, 'image/jpeg', 10)
        `);
        await db.execute(sql`
          UPDATE public.listings SET scan_verified_at = now(), verified_scan_id = ${scanId}::uuid
           WHERE id = ${listingId}::uuid
        `);
      }
    });
    return { listingId, scanId };
  }

  async function detail(listingId: string, cookie?: string) {
    const res = await app.request(`/api/listings/${listingId}`, cookie ? { headers: { cookie } } : undefined);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text) as ListingDetail, text };
  }

  it("rounds the pin for a stranger, and the exact point is nowhere in the body", async () => {
    const host = await aMember("host-a");
    const stranger = await aMember("stranger-a");
    const { listingId } = await aHome(host);

    for (const cookie of [undefined, stranger.cookie]) {
      const { body, text } = await detail(listingId, cookie);
      const street = body.street;
      expect(street, "a confirmed point always has a pin").toBeTruthy();
      expect(street?.exact).toBe(false);
      expect(street?.precisionM).toBe(GRID_M);
      expect(street?.hasApproach).toBe(false);

      // Moved, and not by a token amount — but still inside the grid cell, so
      // the pin is honest about the neighbourhood it claims.
      const pin = street?.pin;
      expect(pin).toBeTruthy();
      const moved = metresApart(pin!, DOOR);
      expect(moved).toBeGreaterThan(10);
      expect(moved).toBeLessThan(GRID_M);

      // The real coordinate is not hiding anywhere else in the payload.
      expect(text).not.toContain(String(DOOR.lat));
      expect(text).not.toContain(String(DOOR.lng));
      expect(body.coordinates).toBeUndefined();
      expect(body.addressLine).toBeUndefined();
    }
  });

  it("gives the host their own door, and says the guest's view is rounded", async () => {
    const host = await aMember("host-b");
    const { listingId } = await aHome(host);

    const { body } = await detail(listingId, host.cookie);
    expect(body.street?.exact).toBe(true);
    expect(body.street?.precisionM).toBe(0);
    expect(body.street?.pin).toEqual(DOOR);
    // And the editor gets the setting to render.
    expect(body.approachVisibility).toBe("confirmed_stay");
  });

  it("gives everyone the door when the host chose to", async () => {
    const host = await aMember("host-c");
    const stranger = await aMember("stranger-c");
    const { listingId } = await aHome(host, { visibility: "everyone", approach: true });

    for (const cookie of [undefined, stranger.cookie]) {
      const { body } = await detail(listingId, cookie);
      expect(body.street?.exact).toBe(true);
      expect(body.street?.pin).toEqual(DOOR);
      expect(body.street?.hasApproach).toBe(true);
    }
  });

  it("opens the door to a guest whose stay is confirmed, and to no other booking", async () => {
    const host = await aMember("host-d");
    const { listingId } = await aHome(host, { approach: true });

    // Distinct dates per guest: the exclusion constraint is real, and every
    // one of these bookings is a live row on the same listing.
    const statuses: BookingStatus[] = [
      "pending_payment",
      "confirmed",
      "checked_in",
      "completed",
      "canceled_by_guest",
      "canceled_by_host",
      "expired",
    ];

    // Forty days apart, so seven 31-night stays on one listing never overlap:
    // the exclusion constraint is real and these are real rows.
    const day = (offset: number) =>
      new Date(Date.UTC(2027, 0, 1 + offset)).toISOString().slice(0, 10);

    for (const [index, status] of statuses.entries()) {
      const guest = await aMember(`guest-${status}`);
      await insertBooking({
        listingId,
        guestId: guest.id,
        checkIn: day(index * 40),
        checkOut: day(index * 40 + 31),
        status,
      });

      const { body } = await detail(listingId, guest.cookie);
      const expected = addressIsShared(status);
      expect(body.street?.exact, `${status} sees the door`).toBe(expected);
      expect(body.street?.pin?.lat === DOOR.lat, `${status} pin`).toBe(expected);
      // The same rule the address follows, asserted against the same function
      // the trip page uses rather than a second list written here.
      expect(body.street?.precisionM).toBe(expected ? 0 : GRID_M);
    }
  });

  it("says footage exists without handing over a key to it", async () => {
    const host = await aMember("host-e");
    const stranger = await aMember("stranger-e");
    const { listingId } = await aHome(host, { approach: true });

    const { body, text } = await detail(listingId, stranger.cookie);
    // The page can say "the host shows this to confirmed guests" — that is a
    // true sentence — while the artifact itself stays out of reach.
    expect(body.street?.hasApproach).toBe(true);
    expect(body.street?.posterUrl).toBeNull();
    expect(text).not.toContain("approach/00.jpg");
  });

  it("draws no pin until the host has confirmed the point", async () => {
    const host = await aMember("host-f");
    const { listingId } = await aHome(host, { confirmed: false });
    const { body } = await detail(listingId);
    // Nothing to say: no confirmed point, no approach. Not an empty map.
    expect(body.street).toBeNull();
  });

  it("keeps a draft home's street to its own host", async () => {
    const host = await aMember("host-g");
    const stranger = await aMember("stranger-g");
    const { listingId } = await aHome(host, { status: "draft" });

    expect((await detail(listingId)).status).toBe(404);
    expect((await detail(listingId, stranger.cookie)).status).toBe(404);

    const { body } = await detail(listingId, host.cookie);
    expect(body.street?.ownerPreview).toBe(true);
    expect(body.street?.exact).toBe(true);
  });
});
