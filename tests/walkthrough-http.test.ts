/**
 * HM-05 — who may load a walkthrough, end to end over HTTP against Postgres.
 *
 * The acceptance criterion for this ticket is negative: no unpublished or
 * unverified splat is reachable by guessing an id. So most of this file is
 * the 404 matrix, and the one positive case checks that what does come back
 * is signed, short-lived, and carries no bucket path.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { app } from "../server/app";
import type { ListingDetail, Walkthrough } from "../src/lib/types";
import { asOwner, closeTestDb, getHarness, id, insertListing, insertMember, ownerDatabaseUrl } from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

vi.mock("../server/lib/scanStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/lib/scanStorage")>();
  return {
    ...actual,
    async presignGetOrNull(key: string) {
      return `https://signed.example.test/${key}?sig=abc`;
    },
  };
});

const S3_KEYS = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"] as const;
const DOOR = { lat: 42.2529, lng: -73.791 };

describeDb("HM-05 who may walk", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    const harness = await getHarness();
    process.env.DATABASE_URL ??= harness.appUrl;
    for (const key of S3_KEYS) {
      savedEnv[key] = process.env[key];
      process.env[key] = key === "S3_PUBLIC_URL" ? "https://cdn.example.test/stead" : "test";
    }
  });

  afterEach(() => {
    for (const key of S3_KEYS) process.env[key] = key === "S3_PUBLIC_URL" ? "https://cdn.example.test/stead" : "test";
  });

  afterAll(async () => {
    for (const key of S3_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await closeTestDb();
  });

  async function aHost(label: string) {
    const hostId = id();
    const email = `${label}-${hostId}@stead.example`;
    await insertMember(hostId, email, label, true);
    return { hostId, email, cookie: await mintSessionCookie({ id: hostId, email, name: label }) };
  }

  type Host = Awaited<ReturnType<typeof aHost>>;

  /**
   * A listing with a scan in whatever state the case needs. `verified` also
   * points the listing at it, the way the transitions do.
   */
  async function aListingWithScan(
    host: Host,
    opts: {
      status?: "draft" | "active" | "paused";
      scanState?: string;
      wholeHome?: boolean;
      pointed?: boolean;
      artifacts?: boolean;
      title?: string;
      listingId?: string;
    } = {},
  ) {
    const listingId = opts.listingId ?? id();
    const scanId = id();
    const prefix = `listings/${listingId}/scans/${scanId}/`;
    await insertListing({
      id: listingId,
      hostId: host.hostId,
      title: opts.title ?? "Walk cottage",
      status: opts.status ?? "active",
    });
    await asOwner(async (db) => {
      await db.execute(
        sql`UPDATE public.listings SET lat = ${DOOR.lat}, lng = ${DOOR.lng}, coordinates_confirmed_at = now() WHERE id = ${listingId}::uuid`,
      );
      await db.execute(sql`
        INSERT INTO public.listing_scans (
          id, listing_id, host_id, state, reason, honesty_policy_version,
          accuracy_max_m, geofence_radius_m, bookend_window_seconds, bookend_min_samples,
          min_indoor_seconds, max_seconds, target_lat, target_lng,
          captured_on, completed_at, verified_at, attempt, job
        ) VALUES (
          ${scanId}::uuid, ${listingId}::uuid, ${host.hostId}::uuid,
          ${opts.scanState ?? "verified"}::public.scan_state,
          ${opts.scanState === "rejected" || opts.scanState === "failed" ? "reconstruction_failed" : null}, 1,
          35, 100, 90, 15, 60, 600, ${DOOR.lat}, ${DOOR.lng},
          '2026-09-14'::date, now(),
          ${opts.scanState === "verified" || opts.scanState === undefined ? sql`now()` : null},
          1, 'crop'
        )
      `);
      if (opts.artifacts !== false) {
        await db.execute(sql`
          INSERT INTO public.scan_artifacts (scan_id, kind, object_key, content_type, size_bytes) VALUES
            (${scanId}::uuid, 'splat', ${`${prefix}splat.ply`}, 'application/octet-stream', 5000),
            (${scanId}::uuid, 'splat_compressed', ${`${prefix}splat.compressed.ply`}, 'application/octet-stream', 900),
            (${scanId}::uuid, 'cameras', ${`${prefix}cameras.json`}, 'application/json', 60),
            (${scanId}::uuid, 'stills', ${`${prefix}stills/00.jpg`}, 'image/jpeg', 10),
            (${scanId}::uuid, 'stills', ${`${prefix}stills/01.jpg`}, 'image/jpeg', 10)
        `);
      }
      await db.execute(sql`
        INSERT INTO public.listing_rental_masks (scan_id, host_id, segments, whole_home_confirmed_at)
        VALUES (${scanId}::uuid, ${host.hostId}::uuid, '[]'::jsonb, ${opts.wholeHome === false ? null : sql`now()`})
      `);
      if (opts.wholeHome === false) {
        await db.execute(
          sql`UPDATE public.listing_rental_masks SET segments = '[{"fromMs":0,"toMs":10000}]'::jsonb WHERE scan_id = ${scanId}::uuid`,
        );
      }
      if (opts.pointed !== false) {
        await db.execute(sql`
          UPDATE public.listings SET scan_verified_at = now(), verified_scan_id = ${scanId}::uuid
           WHERE id = ${listingId}::uuid
        `);
      }
    });
    return { listingId, scanId, prefix };
  }

  const walkthrough = (listingId: string, cookie?: string) =>
    app.request(`/api/listings/${listingId}/walkthrough`, cookie ? { headers: { cookie } } : undefined);

  it("serves a verified, active home to anyone, signed and without a bucket path", async () => {
    const host = await aHost("published");
    const s = await aListingWithScan(host, { title: "Open cottage" });

    const res = await walkthrough(s.listingId);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as Walkthrough;

    expect(body).toMatchObject({
      listingId: s.listingId,
      title: "Open cottage",
      capturedOn: "2026-09-14",
      coverage: "whole_home",
      ownerPreview: false,
      policyVersion: 1,
      timezone: "America/New_York",
    });
    // The compressed artifact is the one that loads; the plain splat is not offered.
    expect(body.splatUrl).toContain(`${s.prefix}splat.compressed.ply`);
    expect(body.splatUrl).not.toContain("splat.ply?");
    expect(body.stills.map((x) => x.index)).toEqual([0, 1]);
    expect(body.posterUrl).toContain(`${s.prefix}stills/00.jpg`);
    expect(body.expiresInSeconds).toBeGreaterThan(0);

    // Nothing in the payload is a raw key or a bucket path.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/"listings\//);
    expect(raw).not.toContain("cdn.example.test");

    // And the listing itself now carries the honesty facts for the entry card.
    const detail = await app.request(`/api/listings/${s.listingId}`);
    const listing = (await detail.json()) as ListingDetail;
    expect(listing.honesty).toMatchObject({ coverage: "whole_home", ownerPreview: false });
    expect(listing.honesty?.posterUrl).toContain("stills/00.jpg");
  });

  it("says rental area only when the host kept part of the walk private", async () => {
    const host = await aHost("masked");
    const s = await aListingWithScan(host, { wholeHome: false });
    const body = (await (await walkthrough(s.listingId)).json()) as Walkthrough;
    expect(body.coverage).toBe("rental_area");
  });

  it("is a 404 for every home that has not published a verified walk", async () => {
    const host = await aHost("unpublished");
    const stranger = await aHost("stranger");

    const cases: { label: string; opts: Parameters<typeof aListingWithScan>[1] }[] = [
      { label: "a draft", opts: { status: "draft" } },
      { label: "a paused home", opts: { status: "paused" } },
      { label: "a rejected scan", opts: { scanState: "rejected", pointed: false } },
      { label: "a failed scan", opts: { scanState: "failed", pointed: false } },
      { label: "a scan still being marked", opts: { scanState: "needs_mask", pointed: false } },
      { label: "a verified scan the listing does not point at", opts: { pointed: false } },
      { label: "a verified scan with no artifact", opts: { artifacts: false } },
    ];

    for (const { label, opts } of cases) {
      const s = await aListingWithScan(host, opts);
      expect((await walkthrough(s.listingId)).status, `${label}, signed out`).toBe(404);
      expect((await walkthrough(s.listingId, stranger.cookie)).status, `${label}, another member`).toBe(404);
    }

    // A guessed id, and a hidden demo row, are the same 404.
    expect((await walkthrough(id())).status).toBe(404);
    expect((await walkthrough("11111111-1111-1111-1111-111111111111")).status).toBe(404);
  });

  it("lets the host preview their own unpublished walk, and says it is a preview", async () => {
    const host = await aHost("previewer");
    const stranger = await aHost("nosy");
    const s = await aListingWithScan(host, { status: "draft" });

    expect((await walkthrough(s.listingId)).status).toBe(404);
    expect((await walkthrough(s.listingId, stranger.cookie)).status).toBe(404);

    const res = await walkthrough(s.listingId, host.cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as Walkthrough;
    expect(body.ownerPreview).toBe(true);
    expect(body.splatUrl).toContain("splat.compressed.ply");

    const detail = await app.request(`/api/listings/${s.listingId}`, { headers: { cookie: host.cookie } });
    expect(((await detail.json()) as ListingDetail).honesty?.ownerPreview).toBe(true);
  });

  it("carries no honesty facts on a listing with nothing to walk", async () => {
    const host = await aHost("plain");
    const listingId = id();
    await insertListing({ id: listingId, hostId: host.hostId, title: "No walk cottage", status: "active" });
    const detail = await app.request(`/api/listings/${listingId}`);
    expect(((await detail.json()) as ListingDetail).honesty).toBeNull();
    expect((await walkthrough(listingId)).status).toBe(404);
  });

  it("offers nothing on a deployment with no object storage, rather than a dead end", async () => {
    const host = await aHost("no-storage");
    const s = await aListingWithScan(host);
    expect((await walkthrough(s.listingId)).status).toBe(200);

    for (const key of S3_KEYS) delete process.env[key];
    // The walk is a 404, and — the part that matters — the listing stops
    // offering it, so a guest never sees a button into a dead end.
    expect((await walkthrough(s.listingId)).status).toBe(404);
    const detail = await app.request(`/api/listings/${s.listingId}`);
    expect(((await detail.json()) as ListingDetail).honesty).toBeNull();
  });
});
