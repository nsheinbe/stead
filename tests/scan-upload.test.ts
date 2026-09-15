/**
 * HM-02. The upload of a located walk, over HTTP and at the function level,
 * against Postgres.
 *
 * What these prove: only a located walk of the caller's can declare a
 * package; the server chooses every key; sizes are capped from config; a
 * part is confirmed only at its declared size and only by the server; the
 * package completes or it is nothing; a confirmed part fixes the shape;
 * moving the pin takes an uploaded walk down; and nothing here answers a
 * stranger with anything but 404.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { app } from "../server/app";
import { completeScanUpload, confirmScanPart, declareScanUpload } from "../server/queries/scans";
import { HM, HONESTY_POLICY_VERSION } from "../src/lib/honesty";
import type {
  HostScan,
  ScanLocationSample,
  ScanUploadDeclareResponse,
  ScanUploadPresignResponse,
  StartScanResponse,
} from "../src/lib/types";
import { asMember, asOwner, closeTestDb, getHarness, id, insertMember, ownerDatabaseUrl } from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

const PIN = { lat: 40.7128, lng: -74.006 };

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
  ...PIN,
};

function walk(): ScanLocationSample[] {
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
      out.push({ recordedAt: new Date(t0 + i * 1000).toISOString(), lat: PIN.lat, lng: PIN.lng, accuracyMeters: leg.accuracy, phase: leg.phase });
    }
  }
  return out;
}

const DECLARATION = {
  mimeType: "video/webm;codecs=vp9",
  durationMs: 90_000,
  clientEnvironment: { userAgent: "test-phone", chunkMs: 2000 },
  parts: [
    { seq: 0, bytes: 5_000 },
    { seq: 1, bytes: 3_000 },
  ],
};

const S3_ENV = {
  S3_BUCKET: "stead-test",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test-secret",
  S3_REGION: "us-east-1",
  S3_ENDPOINT: "http://127.0.0.1:9",
  S3_FORCE_PATH_STYLE: "true",
  S3_PUBLIC_URL: "http://127.0.0.1:9/stead-test",
};

describeDb("the walk's upload", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    for (const key of Object.keys(S3_ENV)) delete process.env[key];
    const harness = await getHarness();
    process.env.DATABASE_URL ??= harness.appUrl;
  });

  afterAll(async () => {
    for (const key of Object.keys(S3_ENV)) delete process.env[key];
    await closeTestDb();
  });

  function withStorage() {
    Object.assign(process.env, S3_ENV);
  }

  async function aHost(label: string) {
    const hostId = id();
    const email = `${label}-${hostId}@stead.example`;
    await insertMember(hostId, email, label, true);
    return { hostId, cookie: await mintSessionCookie({ id: hostId, email, name: label }) };
  }

  async function hub(listingId: string, cookie: string): Promise<HostScan> {
    const res = await app.request(`/api/listings/${listingId}/scan`, { headers: { cookie } });
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as HostScan;
  }

  /** A listing with a pin and a walk that passed its location check. */
  async function locatedWalk(cookie: string): Promise<{ listingId: string; scanId: string }> {
    const created = await app.request("/api/listings", json(BASE_LISTING, cookie));
    expect(created.status, await created.clone().text()).toBe(201);
    const listingId = ((await created.json()) as { id: string }).id;
    const started = await app.request(`/api/listings/${listingId}/scan`, json({ policyVersion: HONESTY_POLICY_VERSION, acknowledged: true }, cookie));
    expect(started.status, await started.clone().text()).toBe(201);
    const { scanId } = (await started.json()) as StartScanResponse;
    const located = await app.request(`/api/listings/${listingId}/scan/${scanId}/location`, json({ samples: walk() }, cookie));
    expect(located.status, await located.clone().text()).toBe(200);
    expect(((await located.json()) as HostScan).scan?.geofence).toBe("passed");
    return { listingId, scanId };
  }

  const declare = (listingId: string, scanId: string, cookie: string, body: unknown = DECLARATION) =>
    app.request(`/api/listings/${listingId}/scan/${scanId}/upload`, json(body, cookie));
  const presign = (listingId: string, scanId: string, cookie: string, seqs: number[]) =>
    app.request(`/api/listings/${listingId}/scan/${scanId}/upload/presign`, json({ seqs }, cookie));
  const confirm = (listingId: string, scanId: string, cookie: string, seqs: number[]) =>
    app.request(`/api/listings/${listingId}/scan/${scanId}/upload/confirm`, json({ seqs }, cookie));
  const complete = (listingId: string, scanId: string, cookie: string) =>
    app.request(`/api/listings/${listingId}/scan/${scanId}/upload/complete`, { method: "POST", headers: { cookie } });

  it("declares a package only for a located walk, within the configured caps", async () => {
    const owner = await aHost("owner");
    const created = await app.request("/api/listings", json(BASE_LISTING, owner.cookie));
    const listingId = ((await created.json()) as { id: string }).id;
    const started = await app.request(`/api/listings/${listingId}/scan`, json({ policyVersion: HONESTY_POLICY_VERSION, acknowledged: true }, owner.cookie));
    const { scanId } = (await started.json()) as StartScanResponse;

    // Not located yet: nothing to upload.
    expect((await declare(listingId, scanId, owner.cookie)).status).toBe(409);

    expect((await app.request(`/api/listings/${listingId}/scan/${scanId}/location`, json({ samples: walk() }, owner.cookie))).status).toBe(200);

    const bad: [unknown, number, string][] = [
      [{ ...DECLARATION, mimeType: "video/x-msvideo" }, 400, "unsupported type"],
      [{ ...DECLARATION, mimeType: "text/html" }, 400, "not a video"],
      [{ ...DECLARATION, parts: [] }, 400, "no parts"],
      [{ ...DECLARATION, parts: [{ seq: 1, bytes: 10 }] }, 400, "must start at 0"],
      [{ ...DECLARATION, parts: [{ seq: 0, bytes: 10 }, { seq: 2, bytes: 10 }] }, 400, "gap in the sequence"],
      [{ ...DECLARATION, parts: [{ seq: 0, bytes: 0 }] }, 400, "empty part"],
      [{ ...DECLARATION, parts: [{ seq: 0, bytes: 67_108_865 }] }, 413, "part over the cap"],
      [{ ...DECLARATION, parts: Array.from({ length: 2001 }, (_, seq) => ({ seq, bytes: 1 })) }, 413, "too many parts"],
      [{ ...DECLARATION, parts: Array.from({ length: 30 }, (_, seq) => ({ seq, bytes: 60_000_000 })) }, 413, "package over the cap"],
    ];
    for (const [body, status, why] of bad) {
      const res = await declare(listingId, scanId, owner.cookie, body);
      expect(res.status, why).toBe(status);
      if (status === 413) expect(await res.json()).toEqual({ error: HM["hm.upload.tooLarge.title"] });
    }
    expect((await hub(listingId, owner.cookie)).scan?.upload).toBeNull();

    const ok = await declare(listingId, scanId, owner.cookie);
    expect(ok.status, await ok.clone().text()).toBe(200);
    const declared = (await ok.json()) as ScanUploadDeclareResponse;
    expect(declared.parts).toEqual([
      { seq: 0, bytes: 5_000, confirmed: false },
      { seq: 1, bytes: 3_000, confirmed: false },
    ]);
    expect(declared.limits).toEqual({ maxUploadBytes: 1_500_000_000, maxPartBytes: 67_108_864, maxParts: 2000 });

    const after = await hub(listingId, owner.cookie);
    expect(after.uploadLimits).toEqual(declared.limits);
    expect(after.scan?.upload).toMatchObject({
      mimeType: "video/webm;codecs=vp9",
      durationMs: 90_000,
      partCount: 2,
      totalBytes: 8_000,
      confirmedBytes: 0,
      uploadedAt: null,
    });
    expect(after.scan?.upload?.startedAt).not.toBeNull();

    // The keys are the server's, under the scan's private prefix.
    const keys = (await asOwner((db) =>
      db.execute(sql`SELECT seq, object_key, content_type FROM public.scan_upload_parts WHERE scan_id = ${scanId}::uuid ORDER BY seq`),
    )) as unknown as { seq: number; object_key: string; content_type: string }[];
    expect(keys).toEqual([
      { seq: 0, object_key: `listings/${listingId}/scans/${scanId}/video/part-00000.webm`, content_type: "video/webm" },
      { seq: 1, object_key: `listings/${listingId}/scans/${scanId}/video/part-00001.webm`, content_type: "video/webm" },
    ]);
  });

  it("refuses to hand out URLs or take receipts without a bucket", async () => {
    const owner = await aHost("owner");
    const { listingId, scanId } = await locatedWalk(owner.cookie);
    expect((await declare(listingId, scanId, owner.cookie)).status).toBe(200);
    const hubBefore = await hub(listingId, owner.cookie);
    expect(hubBefore.storageConfigured).toBe(false);

    for (const res of [
      await presign(listingId, scanId, owner.cookie, [0]),
      await confirm(listingId, scanId, owner.cookie, [0]),
      await complete(listingId, scanId, owner.cookie),
    ]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: HM["hm.upload.unconfigured.title"] });
    }
  });

  it("signs exactly the declared keys, confirms only at the declared size, and completes or nothing", async () => {
    const owner = await aHost("owner");
    const stranger = await aHost("stranger");
    const { listingId, scanId } = await locatedWalk(owner.cookie);
    expect((await declare(listingId, scanId, owner.cookie)).status).toBe(200);
    withStorage();
    expect((await hub(listingId, owner.cookie)).storageConfigured).toBe(true);

    // Presign: URLs for the server's keys, nothing for a part never declared.
    expect((await presign(listingId, scanId, owner.cookie, [5])).status).toBe(400);
    const signed = await presign(listingId, scanId, owner.cookie, [0, 1]);
    expect(signed.status, await signed.clone().text()).toBe(200);
    const { uploads } = (await signed.json()) as ScanUploadPresignResponse;
    expect(uploads.map((u) => u.seq)).toEqual([0, 1]);
    for (const upload of uploads) {
      expect(upload.contentType).toBe("video/webm");
      expect(upload.expiresInSeconds).toBe(300);
      const url = new URL(upload.uploadUrl);
      expect(url.pathname).toBe(`/stead-test/listings/${listingId}/scans/${scanId}/video/part-0000${upload.seq}.webm`);
      expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    }
    const presigned = (await asOwner((db) =>
      db.execute(sql`SELECT count(presigned_at)::int AS n FROM public.scan_upload_parts WHERE scan_id = ${scanId}::uuid`),
    )) as unknown as { n: number }[];
    expect(presigned[0]?.n).toBe(2);

    // Nothing is in the bucket, so nothing can complete.
    const early = await complete(listingId, scanId, owner.cookie);
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "2 of 2 parts haven't arrived yet" });

    // The receipt is the server's: the wrong size is not a receipt, the right one is, and again is fine.
    expect(await asMember(owner.hostId, (tx) => confirmScanPart(tx, scanId, 0, 4_999))).toBe(false);
    expect(await asMember(owner.hostId, (tx) => confirmScanPart(tx, scanId, 0, 5_001))).toBe(false);
    expect(await asMember(stranger.hostId, (tx) => confirmScanPart(tx, scanId, 0, 5_000))).toBe(false);
    expect(await asMember(owner.hostId, (tx) => confirmScanPart(tx, scanId, 0, 5_000))).toBe(true);
    expect(await asMember(owner.hostId, (tx) => confirmScanPart(tx, scanId, 0, 5_000))).toBe(true);
    expect((await hub(listingId, owner.cookie)).scan?.upload).toMatchObject({
      confirmedBytes: 5_000,
      parts: [
        { seq: 0, bytes: 5_000, confirmed: true },
        { seq: 1, bytes: 3_000, confirmed: false },
      ],
    });

    // A confirmed part is no longer re-signed; an unconfirmed one still is.
    const again = (await (await presign(listingId, scanId, owner.cookie, [0, 1])).json()) as ScanUploadPresignResponse;
    expect(again.uploads.map((u) => u.seq)).toEqual([1]);

    // Half a package is nothing.
    expect(await asMember(owner.hostId, (tx) => completeScanUpload(tx, scanId, "m.json"))).toBe(false);
    expect((await complete(listingId, scanId, owner.cookie)).status).toBe(409);
    expect((await hub(listingId, owner.cookie)).scan?.state).toBe("capturing");

    // The shape is fixed once a receipt exists; the same shape is a resume.
    const reshaped = await declare(listingId, scanId, owner.cookie, { ...DECLARATION, parts: [{ seq: 0, bytes: 5_000 }, { seq: 1, bytes: 3_001 }] });
    expect(reshaped.status).toBe(409);
    expect((await declare(listingId, scanId, owner.cookie)).status).toBe(200);
    expect((await hub(listingId, owner.cookie)).scan?.upload?.confirmedBytes).toBe(5_000);

    expect(await asMember(owner.hostId, (tx) => confirmScanPart(tx, scanId, 1, 3_000))).toBe(true);
    expect(await asMember(stranger.hostId, (tx) => completeScanUpload(tx, scanId, "m.json"))).toBe(false);
    expect(await asMember(owner.hostId, (tx) => completeScanUpload(tx, scanId, `listings/${listingId}/scans/${scanId}/manifest.json`))).toBe(true);

    const uploaded = await hub(listingId, owner.cookie);
    expect(uploaded.scan?.state).toBe("uploaded");
    expect(uploaded.scan?.upload?.uploadedAt).not.toBeNull();
    expect(uploaded.scan?.upload?.confirmedBytes).toBe(8_000);
    const row = (await asOwner((db) =>
      db.execute(sql`SELECT video_bytes::int AS bytes, manifest_key FROM public.listing_scans WHERE id = ${scanId}::uuid`),
    )) as unknown as { bytes: number; manifest_key: string }[];
    expect(row[0]).toEqual({ bytes: 8_000, manifest_key: `listings/${listingId}/scans/${scanId}/manifest.json` });

    // Uploaded is closed: no more declaring, signing or completing.
    expect((await declare(listingId, scanId, owner.cookie)).status).toBe(409);
    expect((await presign(listingId, scanId, owner.cookie, [1])).status).toBe(409);
    expect((await complete(listingId, scanId, owner.cookie)).status).toBe(409);
    expect(await asMember(owner.hostId, (tx) => completeScanUpload(tx, scanId, "again.json"))).toBe(false);

    // Moving the pin takes the uploaded walk down, like every judged walk.
    expect((await app.request(`/api/listings/${listingId}`, json({ lat: PIN.lat + 0.01, lng: PIN.lng }, owner.cookie, "PATCH"))).status).toBe(200);
    const revoked = await hub(listingId, owner.cookie);
    expect(revoked.scan?.id).toBe(scanId);
    expect(revoked.scan?.state).toBe("revoked");
    expect(revoked.scan?.revokedReason).toBe("pin_changed");
  });

  it("lets a fresh declaration replace an untouched one", async () => {
    const owner = await aHost("owner");
    const { listingId, scanId } = await locatedWalk(owner.cookie);
    expect((await declare(listingId, scanId, owner.cookie, { ...DECLARATION, parts: [{ seq: 0, bytes: 5_000 }] })).status).toBe(200);
    const replaced = await declare(listingId, scanId, owner.cookie, { ...DECLARATION, mimeType: "video/mp4", parts: [{ seq: 0, bytes: 6_000 }, { seq: 1, bytes: 1_000 }] });
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    const after = await hub(listingId, owner.cookie);
    expect(after.scan?.upload).toMatchObject({ mimeType: "video/mp4", partCount: 2, totalBytes: 7_000 });
    const keys = (await asOwner((db) =>
      db.execute(sql`SELECT object_key FROM public.scan_upload_parts WHERE scan_id = ${scanId}::uuid ORDER BY seq`),
    )) as unknown as { object_key: string }[];
    expect(keys.map((k) => k.object_key)).toEqual([
      `listings/${listingId}/scans/${scanId}/video/part-00000.mp4`,
      `listings/${listingId}/scans/${scanId}/video/part-00001.mp4`,
    ]);
  });

  it("answers a stranger with 404 on every upload route and the function with false", async () => {
    const owner = await aHost("owner");
    const stranger = await aHost("stranger");
    const { listingId, scanId } = await locatedWalk(owner.cookie);
    withStorage();
    expect((await declare(listingId, scanId, stranger.cookie)).status).toBe(404);
    expect((await presign(listingId, scanId, stranger.cookie, [0])).status).toBe(404);
    expect((await confirm(listingId, scanId, stranger.cookie, [0])).status).toBe(404);
    expect((await complete(listingId, scanId, stranger.cookie)).status).toBe(404);
    expect((await app.request(`/api/listings/${listingId}/scan/${scanId}/upload`, json(DECLARATION))).status).toBe(401);
    expect(
      await asMember(stranger.hostId, (tx) =>
        declareScanUpload(tx, scanId, { mimeType: "video/webm", durationMs: 1, clientEnvironment: {}, parts: [{ seq: 0, bytes: 1, key: "k", contentType: "video/webm" }] }),
      ),
    ).toBe(false);
    expect((await hub(listingId, owner.cookie)).scan?.upload).toBeNull();
  });
});
