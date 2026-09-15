/**
 * HM-01. The honesty scan over HTTP, end to end against Postgres.
 *
 * What these prove: the pin is owner-only and paired; a walk cannot start
 * without a pin or with a stale policy acknowledgment; the server judges the
 * location record and the browser only reads the result; a judged walk cannot
 * be discarded; and moving the pin takes a located walk down.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/app";
import { HM, HONESTY_POLICY_VERSION } from "../src/lib/honesty";
import type { HostScan, ListingDetail, ScanLocationSample, StartScanResponse } from "../src/lib/types";
import { closeTestDb, getHarness, id, insertMember, ownerDatabaseUrl } from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

const PIN = { lat: 40.7128, lng: -74.006 };
const DEG_PER_M_LAT = 1 / 111_320;

function json(body: unknown, cookie?: string, method = "POST") {
  return {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  };
}

const BASE_LISTING = {
  title: "The Gatehouse",
  description: "A stone gatehouse.",
  type: "entire_home",
  city: "Hudson",
  country: "US",
  timezone: "America/New_York",
  nightlyRateCents: 19_950,
  depositCents: 30_000,
  maxGuests: 4,
  status: "draft",
};

/** A synthetic walk around PIN. `away` in metres moves the whole walk. */
function walk(away = 0): ScanLocationSample[] {
  const t0 = Date.parse("2026-09-15T14:00:00Z");
  const legs: { phase: ScanLocationSample["phase"]; count: number; accuracy: number }[] = [
    { phase: "outdoor_start", count: 5, accuracy: 8 },
    { phase: "indoor", count: 40, accuracy: 80 },
    { phase: "outdoor_end", count: 5, accuracy: 10 },
  ];
  const out: ScanLocationSample[] = [];
  let i = 0;
  for (const leg of legs) {
    for (let n = 0; n < leg.count; n += 1, i += 1) {
      out.push({
        recordedAt: new Date(t0 + i * 1000).toISOString(),
        lat: PIN.lat + away * DEG_PER_M_LAT,
        lng: PIN.lng,
        accuracyMeters: leg.accuracy,
        phase: leg.phase,
      });
    }
  }
  return out;
}

describeDb("the honesty scan", () => {
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

  async function createListing(cookie: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await app.request("/api/listings", json({ ...BASE_LISTING, ...extra }, cookie));
    expect(res.status, await res.clone().text()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  async function hub(listingId: string, cookie: string): Promise<HostScan> {
    const res = await app.request(`/api/listings/${listingId}/scan`, { headers: { cookie } });
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as HostScan;
  }

  async function start(listingId: string, cookie: string, policyVersion = HONESTY_POLICY_VERSION) {
    return app.request(`/api/listings/${listingId}/scan`, json({ policyVersion, acknowledged: true }, cookie));
  }

  it("keeps the pin owner-only and paired", async () => {
    const owner = await aHost("owner");
    const stranger = await aHost("stranger");
    const listingId = await createListing(owner.cookie);

    // One coordinate without the other is refused, on create and on edit.
    expect((await app.request("/api/listings", json({ ...BASE_LISTING, lat: 1 }, owner.cookie))).status).toBe(400);
    expect((await app.request(`/api/listings/${listingId}`, json({ lat: PIN.lat }, owner.cookie, "PATCH"))).status).toBe(400);
    expect((await app.request(`/api/listings/${listingId}`, json({ lat: PIN.lat, lng: null }, owner.cookie, "PATCH"))).status).toBe(400);

    const before = (await (await app.request(`/api/listings/${listingId}`, { headers: { cookie: owner.cookie } })).json()) as ListingDetail;
    expect(before.coordinates).toBeNull();

    expect((await app.request(`/api/listings/${listingId}`, json(PIN, owner.cookie, "PATCH"))).status).toBe(200);
    const after = (await (await app.request(`/api/listings/${listingId}`, { headers: { cookie: owner.cookie } })).json()) as ListingDetail;
    expect(after.coordinates).toEqual(PIN);

    // Published, the home is public — and its door still is not.
    expect((await app.request(`/api/listings/${listingId}`, json({ status: "active" }, owner.cookie, "PATCH"))).status).toBe(200);
    const asStranger = (await (await app.request(`/api/listings/${listingId}`, { headers: { cookie: stranger.cookie } })).json()) as Record<string, unknown>;
    expect(asStranger).not.toHaveProperty("coordinates");
    const asPublic = (await (await app.request(`/api/listings/${listingId}`)).json()) as Record<string, unknown>;
    expect(asPublic).not.toHaveProperty("coordinates");
    const catalog = (await (await app.request("/api/listings")).json()) as Record<string, unknown>[];
    for (const row of catalog) {
      expect(row).not.toHaveProperty("coordinates");
      expect(row).not.toHaveProperty("lat");
    }
  });

  it("will not start a walk without a pin, a stale policy, or the acknowledgment", async () => {
    const owner = await aHost("owner");
    const listingId = await createListing(owner.cookie);

    const noPin = await hub(listingId, owner.cookie);
    expect(noPin.listing.hasPin).toBe(false);
    expect(noPin.scan).toBeNull();
    expect(noPin.policyVersion).toBe(HONESTY_POLICY_VERSION);

    const refusedNoPin = await start(listingId, owner.cookie);
    expect(refusedNoPin.status).toBe(409);
    expect(await refusedNoPin.json()).toEqual({ error: HM["hm.pin.required"] });

    expect((await app.request(`/api/listings/${listingId}`, json(PIN, owner.cookie, "PATCH"))).status).toBe(200);

    const stale = await start(listingId, owner.cookie, "0");
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: HM["hm.sheet.policyChanged"] });

    const unacknowledged = await app.request(
      `/api/listings/${listingId}/scan`,
      json({ policyVersion: HONESTY_POLICY_VERSION, acknowledged: false }, owner.cookie),
    );
    expect(unacknowledged.status).toBe(400);

    const ok = await start(listingId, owner.cookie);
    expect(ok.status, await ok.clone().text()).toBe(201);
    const started = (await ok.json()) as StartScanResponse;
    expect(started.policyVersion).toBe(HONESTY_POLICY_VERSION);
    expect(started.thresholds.accuracyMaxMeters).toBeGreaterThan(0);

    const now = await hub(listingId, owner.cookie);
    expect(now.scan?.id).toBe(started.scanId);
    expect(now.scan?.state).toBe("capturing");
    expect(now.scan?.geofence).toBe("pending");
  });

  it("judges the location record on the server and reports the verdict", async () => {
    const owner = await aHost("owner");
    const listingId = await createListing(owner.cookie, PIN);

    const far = (await (await start(listingId, owner.cookie)).json()) as StartScanResponse;
    const refused = await app.request(
      `/api/listings/${listingId}/scan/${far.scanId}/location`,
      json({ samples: walk(2_000) }, owner.cookie),
    );
    expect(refused.status, await refused.clone().text()).toBe(200);
    const rejected = (await refused.json()) as HostScan;
    expect(rejected.scan?.state).toBe("rejected");
    expect(rejected.scan?.geofence).toBe("failed");
    expect(rejected.scan?.rejectReason).toBe("geofence");
    expect(rejected.scan?.sampleCount).toBe(50);
    expect(rejected.scan?.maxDistanceMeters).toBeGreaterThan(1_900);

    // A judged walk is closed: no second record, and not the host's to delete.
    const again = await app.request(
      `/api/listings/${listingId}/scan/${far.scanId}/location`,
      json({ samples: walk(0) }, owner.cookie),
    );
    expect(again.status).toBe(409);
    expect((await app.request(`/api/listings/${listingId}/scan/${far.scanId}`, { method: "DELETE", headers: { cookie: owner.cookie } })).status).toBe(404);

    const near = (await (await start(listingId, owner.cookie)).json()) as StartScanResponse;
    const passed = await app.request(
      `/api/listings/${listingId}/scan/${near.scanId}/location`,
      json({ samples: walk(0) }, owner.cookie),
    );
    expect(passed.status, await passed.clone().text()).toBe(200);
    const located = (await passed.json()) as HostScan;
    expect(located.scan?.id).toBe(near.scanId);
    expect(located.scan?.state).toBe("capturing");
    expect(located.scan?.geofence).toBe("passed");
    expect(located.scan?.rejectReason).toBeNull();
    expect(located.scan?.startedAt).toBe("2026-09-15T14:00:00.000Z");
    expect(located.scan?.finishedAt).toBe("2026-09-15T14:00:49.000Z");
  });

  it("refuses a record that is not a walk", async () => {
    const owner = await aHost("owner");
    const listingId = await createListing(owner.cookie, PIN);
    const started = (await (await start(listingId, owner.cookie)).json()) as StartScanResponse;

    const bad: unknown[] = [
      { samples: "nope" },
      { samples: [{ recordedAt: "yesterday", lat: 1, lng: 2, accuracyMeters: 5, phase: "indoor" }] },
      { samples: [{ recordedAt: "2026-09-15T14:00:00Z", lat: 91, lng: 2, accuracyMeters: 5, phase: "indoor" }] },
      { samples: [{ recordedAt: "2026-09-15T14:00:00Z", lat: 1, lng: 2, accuracyMeters: 5.5, phase: "indoor" }] },
      { samples: [{ recordedAt: "2026-09-15T14:00:00Z", lat: 1, lng: 2, accuracyMeters: 5, phase: "garden" }] },
    ];
    for (const body of bad) {
      const res = await app.request(`/api/listings/${listingId}/scan/${started.scanId}/location`, json(body, owner.cookie));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // Still open: nothing above touched it.
    expect((await hub(listingId, owner.cookie)).scan?.geofence).toBe("pending");

    // Too few samples is a verdict, not a validation error.
    const short = await app.request(
      `/api/listings/${listingId}/scan/${started.scanId}/location`,
      json({ samples: walk(0).slice(0, 10) }, owner.cookie),
    );
    expect(short.status).toBe(200);
    expect(((await short.json()) as HostScan).scan?.rejectReason).toBe("samples");
  });

  it("lets the owner discard an unfinished walk and nobody else touch it", async () => {
    const owner = await aHost("owner");
    const stranger = await aHost("stranger");
    const listingId = await createListing(owner.cookie, PIN);
    const started = (await (await start(listingId, owner.cookie)).json()) as StartScanResponse;

    expect((await app.request(`/api/listings/${listingId}/scan`, { headers: { cookie: stranger.cookie } })).status).toBe(404);
    expect((await start(listingId, stranger.cookie)).status).toBe(404);
    expect(
      (await app.request(`/api/listings/${listingId}/scan/${started.scanId}/location`, json({ samples: walk(0) }, stranger.cookie))).status,
    ).toBe(404);
    expect((await app.request(`/api/listings/${listingId}/scan/${started.scanId}`, { method: "DELETE", headers: { cookie: stranger.cookie } })).status).toBe(404);
    expect((await app.request(`/api/listings/${listingId}/scan`)).status).toBe(401);

    expect((await app.request(`/api/listings/${listingId}/scan/${started.scanId}`, { method: "DELETE", headers: { cookie: owner.cookie } })).status).toBe(200);
    expect((await hub(listingId, owner.cookie)).scan).toBeNull();
  });

  it("starting again replaces an unfinished walk but keeps a judged one as history", async () => {
    const owner = await aHost("owner");
    const listingId = await createListing(owner.cookie, PIN);

    const first = (await (await start(listingId, owner.cookie)).json()) as StartScanResponse;
    const second = (await (await start(listingId, owner.cookie)).json()) as StartScanResponse;
    expect(second.scanId).not.toBe(first.scanId);
    expect((await app.request(`/api/listings/${listingId}/scan/${first.scanId}/location`, json({ samples: walk(0) }, owner.cookie))).status).toBe(404);

    expect((await app.request(`/api/listings/${listingId}/scan/${second.scanId}/location`, json({ samples: walk(0) }, owner.cookie))).status).toBe(200);
    const third = (await (await start(listingId, owner.cookie)).json()) as StartScanResponse;
    expect((await hub(listingId, owner.cookie)).scan?.id).toBe(third.scanId);
  });

  it("takes a located walk down when the pin moves", async () => {
    const owner = await aHost("owner");
    const listingId = await createListing(owner.cookie, PIN);
    const started = (await (await start(listingId, owner.cookie)).json()) as StartScanResponse;
    expect((await app.request(`/api/listings/${listingId}/scan/${started.scanId}/location`, json({ samples: walk(0) }, owner.cookie))).status).toBe(200);
    expect((await hub(listingId, owner.cookie)).scan?.geofence).toBe("passed");

    // An unrelated edit changes nothing.
    expect((await app.request(`/api/listings/${listingId}`, json({ title: "Renamed" }, owner.cookie, "PATCH"))).status).toBe(200);
    expect((await hub(listingId, owner.cookie)).scan?.state).toBe("capturing");

    expect((await app.request(`/api/listings/${listingId}`, json({ lat: PIN.lat + 0.01, lng: PIN.lng }, owner.cookie, "PATCH"))).status).toBe(200);
    const after = await hub(listingId, owner.cookie);
    expect(after.scan?.id).toBe(started.scanId);
    expect(after.scan?.state).toBe("revoked");
    expect(after.scan?.revokedReason).toBe("pin_changed");
    expect(after.scan?.revokedAt).not.toBeNull();

    // Clearing the pin does the same to a fresh unfinished walk: it is simply gone.
    const fresh = (await (await start(listingId, owner.cookie)).json()) as StartScanResponse;
    expect((await app.request(`/api/listings/${listingId}`, json({ lat: null, lng: null }, owner.cookie, "PATCH"))).status).toBe(200);
    const cleared = await hub(listingId, owner.cookie);
    expect(cleared.listing.hasPin).toBe(false);
    expect(cleared.scan?.id).not.toBe(fresh.scanId);
  });
});
