/**
 * HM-01 — the front door and the scan row, end to end over HTTP.
 *
 * What a host can do: set lat / lng, confirm them as the front door (a
 * recorded action), and start a `capturing` scan once that is done. What the
 * server refuses: confirming without a point, starting before confirming,
 * starting without object storage, starting a demo home, and any of it on
 * someone else's listing. Moving the point clears the confirmation.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/app";
import { HONESTY_REFUSALS } from "../src/lib/honestyCopy";
import type { ListingDetail, ListingScan, ListingScanStatus } from "../src/lib/types";
import { closeTestDb, getHarness, id, insertListing, insertMember, ownerDatabaseUrl } from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

const DOOR = { lat: 42.2529, lng: -73.791 };

function json(body: unknown, cookie: string, method = "PATCH") {
  return {
    method,
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  };
}

const S3_KEYS = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"] as const;

function withStorage(on: boolean) {
  for (const key of S3_KEYS) {
    if (on) process.env[key] = key === "S3_PUBLIC_URL" ? "https://cdn.example.test/stead" : "test";
    else delete process.env[key];
  }
}

describeDb("HM-01 front door and scan start", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    const harness = await getHarness();
    process.env.DATABASE_URL ??= harness.appUrl;
    for (const key of [...S3_KEYS, "ALLOW_DEMO_LISTINGS"]) savedEnv[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of [...S3_KEYS, "ALLOW_DEMO_LISTINGS"]) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
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

  async function aDraft(hostId: string) {
    const listingId = id();
    await insertListing({ id: listingId, hostId, title: "Scan cottage", status: "draft" });
    return listingId;
  }

  async function detail(listingId: string, cookie?: string): Promise<ListingDetail> {
    const res = await app.request(`/api/listings/${listingId}`, cookie ? { headers: { cookie } } : undefined);
    expect(res.status).toBe(200);
    return (await res.json()) as ListingDetail;
  }

  it("confirming records a timestamp; moving the point clears it; a public read never sees the point", async () => {
    const { hostId, cookie } = await aHost("door");
    const listingId = await aDraft(hostId);

    // Before anything: owner sees coordinates: null, nobody else sees the key.
    expect((await detail(listingId, cookie)).coordinates).toBeNull();

    // Set the point without confirming.
    let res = await app.request(`/api/listings/${listingId}`, json({ lat: DOOR.lat, lng: DOOR.lng }, cookie));
    expect(res.status).toBe(200);
    let d = await detail(listingId, cookie);
    expect(d.coordinates).toEqual({ lat: DOOR.lat, lng: DOOR.lng, confirmedAt: null });

    // Confirm in one statement.
    res = await app.request(`/api/listings/${listingId}`, json({ lat: DOOR.lat, lng: DOOR.lng, confirmCoordinates: true }, cookie));
    expect(res.status).toBe(200);
    d = await detail(listingId, cookie);
    expect(d.coordinates?.confirmedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // A change to lng alone clears the confirmation (trigger in 0015).
    res = await app.request(`/api/listings/${listingId}`, json({ lng: DOOR.lng + 0.01 }, cookie));
    expect(res.status).toBe(200);
    d = await detail(listingId, cookie);
    expect(d.coordinates).toEqual({ lat: DOOR.lat, lng: DOOR.lng + 0.01, confirmedAt: null });

    // An unrelated edit does not touch it once re-confirmed.
    res = await app.request(`/api/listings/${listingId}`, json({ confirmCoordinates: true }, cookie));
    expect(res.status).toBe(200);
    res = await app.request(`/api/listings/${listingId}`, json({ title: "Renamed cottage" }, cookie));
    expect(res.status).toBe(200);
    d = await detail(listingId, cookie);
    expect(d.coordinates?.confirmedAt).not.toBeNull();

    // Publish it and read it as a stranger: no `coordinates` key at all.
    res = await app.request(`/api/listings/${listingId}`, json({ status: "active" }, cookie));
    expect(res.status).toBe(200);
    const stranger = await aHost("stranger");
    const asStranger = await detail(listingId, stranger.cookie);
    expect("coordinates" in asStranger).toBe(false);
    const anonymous = await detail(listingId);
    expect("coordinates" in anonymous).toBe(false);
  });

  it("a creation can carry the point and the confirmation together, but not the confirmation alone", async () => {
    const { cookie } = await aHost("create");
    const base = {
      title: "Created with door",
      type: "entire_home",
      city: "Hudson",
      country: "US",
      timezone: "America/New_York",
      nightlyRateCents: 20_000,
      depositCents: 0,
      maxGuests: 2,
    };
    let res = await app.request("/api/listings", json({ ...base, ...DOOR, confirmCoordinates: true }, cookie, "POST"));
    expect(res.status, await res.clone().text()).toBe(201);
    const { id: listingId } = (await res.json()) as { id: string };
    const d = await detail(listingId, cookie);
    expect(d.coordinates?.lat).toBe(DOOR.lat);
    expect(d.coordinates?.confirmedAt).not.toBeNull();

    res = await app.request("/api/listings", json({ ...base, confirmCoordinates: true }, cookie, "POST"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Set both latitude and longitude before confirming the front door." });
  });

  it("refuses to confirm a front door that has no point", async () => {
    const { hostId, cookie } = await aHost("nopoint");
    const listingId = await aDraft(hostId);
    const res = await app.request(`/api/listings/${listingId}`, json({ confirmCoordinates: true }, cookie));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Set both latitude and longitude before confirming the front door." });
    expect((await detail(listingId, cookie)).coordinates).toBeNull();
  });

  it("GET /scan is owner-only and reports the door and storage state", async () => {
    withStorage(false);
    const { hostId, cookie } = await aHost("status");
    const listingId = await aDraft(hostId);

    let res = await app.request(`/api/listings/${listingId}/scan`, { headers: { cookie } });
    expect(res.status).toBe(200);
    let status = (await res.json()) as ListingScanStatus;
    expect(status).toMatchObject({
      listingId,
      coordinatesConfirmed: false,
      storageConfigured: false,
      policyVersion: 1,
      scan: null,
    });
    expect(status.thresholds).toEqual({
      accuracyMaxM: 35,
      geofenceRadiusM: 100,
      bookendWindowSeconds: 90,
      bookendMinSamples: 15,
      minIndoorSeconds: 60,
      maxSeconds: 600,
    });

    await app.request(`/api/listings/${listingId}`, json({ ...DOOR, confirmCoordinates: true }, cookie));
    withStorage(true);
    res = await app.request(`/api/listings/${listingId}/scan`, { headers: { cookie } });
    status = (await res.json()) as ListingScanStatus;
    expect(status.coordinatesConfirmed).toBe(true);
    expect(status.storageConfigured).toBe(true);

    const other = await aHost("other");
    res = await app.request(`/api/listings/${listingId}/scan`, { headers: { cookie: other.cookie } });
    expect(res.status).toBe(404);
    res = await app.request(`/api/listings/${listingId}/scan`);
    expect(res.status).toBe(401);
  });

  it("POST /scan: 409 before the door is confirmed, 503 without storage, then a capturing row with the snapshot", async () => {
    const { hostId, cookie } = await aHost("start");
    const listingId = await aDraft(hostId);
    const start = () => app.request(`/api/listings/${listingId}/scan`, { method: "POST", headers: { cookie } });

    withStorage(true);
    let res = await start();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: HONESTY_REFUSALS.coordinatesUnconfirmed });

    await app.request(`/api/listings/${listingId}`, json({ ...DOOR, confirmCoordinates: true }, cookie));

    withStorage(false);
    res = await start();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: HONESTY_REFUSALS.storageNotConfigured });

    withStorage(true);
    res = await start();
    expect(res.status, await res.clone().text()).toBe(201);
    const scan = (await res.json()) as ListingScan;
    expect(scan).toMatchObject({
      state: "capturing",
      reason: null,
      policyVersion: 1,
      capturedOn: null,
      verifiedAt: null,
      thresholds: { accuracyMaxM: 35, geofenceRadiusM: 100, bookendMinSamples: 15 },
    });

    // The status now carries the latest scan.
    res = await app.request(`/api/listings/${listingId}/scan`, { headers: { cookie } });
    const status = (await res.json()) as ListingScanStatus;
    expect(status.scan?.id).toBe(scan.id);
    expect(status.scan?.state).toBe("capturing");

    // Someone else cannot start a scan on it.
    const other = await aHost("intruder");
    res = await app.request(`/api/listings/${listingId}/scan`, { method: "POST", headers: { cookie: other.cookie } });
    expect(res.status).toBe(404);
  });

  it("refuses to scan a hidden demo home", async () => {
    withStorage(true);
    process.env.ALLOW_DEMO_LISTINGS = "0";
    const { cookie } = await aHost("demo");
    const res = await app.request("/api/listings/11111111-1111-1111-1111-111111111111/scan", {
      method: "POST",
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: HONESTY_REFUSALS.demoListing });
  });
});
