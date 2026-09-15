/**
 * HM-02 — the upload package, end to end over HTTP, with an in-memory bucket.
 *
 * The bucket calls in server/lib/scanStorage.ts are replaced by a fake so the
 * routes, the key rules, the completion checks, the geofence verdict and the
 * SECURITY DEFINER transition all run for real against Postgres. The pure
 * helpers (keys, types, caps) stay real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { app } from "../server/app";
import { HONESTY_REFUSALS } from "../src/lib/honestyCopy";
import type { ListingScan, ScanUploadTarget } from "../src/lib/types";
import { asOwner, closeTestDb, getHarness, id, insertListing, insertMember, ownerDatabaseUrl } from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

/** The fake bucket. Objects and multipart uploads, nothing else. */
const bucket = vi.hoisted(() => {
  const objects = new Map<string, { bytes: number; contentType: string; text: string }>();
  const uploads = new Map<string, { key: string; parts: Map<number, number> }>();
  let nextUpload = 1;
  return {
    objects,
    uploads,
    reset() {
      objects.clear();
      uploads.clear();
      nextUpload = 1;
    },
    newUploadId() {
      return `up-${nextUpload++}`;
    },
    /** Simulates the browser's PUT of one part. */
    putPart(uploadId: string, partNumber: number, bytes: number) {
      const upload = uploads.get(uploadId);
      if (!upload) throw new Error("no such upload");
      upload.parts.set(partNumber, bytes);
    },
    /** Simulates the browser's PUT of a small JSON object. */
    putObject(key: string, text: string, contentType = "application/json") {
      objects.set(key, { bytes: Buffer.byteLength(text), contentType, text });
    },
  };
});

vi.mock("../server/lib/scanStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/lib/scanStorage")>();
  return {
    ...actual,
    async createMultipartUpload(key: string) {
      const uploadId = bucket.newUploadId();
      bucket.uploads.set(uploadId, { key, parts: new Map() });
      return uploadId;
    },
    async presignUploadPart(key: string, uploadId: string, partNumber: number) {
      return { uploadUrl: `fake://${key}#${uploadId}#${partNumber}`, expiresInSeconds: 300 };
    },
    async listUploadedParts(key: string, uploadId: string) {
      const upload = bucket.uploads.get(uploadId);
      if (!upload || upload.key !== key) throw new Error("NoSuchUpload");
      return [...upload.parts.entries()]
        .map(([partNumber, sizeBytes]) => ({ partNumber, sizeBytes, etag: `"e${partNumber}"` }))
        .sort((a, b) => a.partNumber - b.partNumber);
    },
    async completeMultipartUpload(key: string, uploadId: string) {
      const upload = bucket.uploads.get(uploadId);
      if (!upload || upload.key !== key) throw new Error("NoSuchUpload");
      const parts = [...upload.parts.entries()].map(([partNumber, sizeBytes]) => ({ partNumber, sizeBytes, etag: "e" }));
      const total = parts.reduce((sum, p) => sum + p.sizeBytes, 0);
      bucket.objects.set(key, { bytes: total, contentType: "video/mp4", text: "" });
      bucket.uploads.delete(uploadId);
      return parts;
    },
    async presignPutObject(key: string) {
      return { uploadUrl: `fake://${key}`, expiresInSeconds: 300 };
    },
    async headObject(key: string) {
      const object = bucket.objects.get(key);
      return object ? { sizeBytes: object.bytes, contentType: object.contentType } : null;
    },
    async getObjectText(key: string) {
      const object = bucket.objects.get(key);
      if (!object) throw new Error("NoSuchKey");
      return object.text;
    },
  };
});

const DOOR = { lat: 42.2529, lng: -73.791 };
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((DOOR.lat * Math.PI) / 180));
function at(metresNorth: number, metresEast: number) {
  return { lat: DOOR.lat + metresNorth * M_LAT, lng: DOOR.lng + metresEast * M_LNG };
}

/** A walk with good outdoor bookends. `offsetM` moves the whole walk away from the door. */
function samplesFor(offsetM = 0) {
  const out: { t: number; lat: number; lng: number; acc: number }[] = [];
  const total = 300_000;
  for (let i = 0; i < 30; i += 1) out.push({ t: i * 1000, ...at(offsetM + (i % 3), i % 2), acc: 8 });
  for (let t = 31_000; t < total - 30_000; t += 2000) out.push({ t, ...at(offsetM + 10, 5), acc: 60 });
  for (let i = 0; i < 30; i += 1) out.push({ t: total - (30 - i) * 1000, ...at(offsetM + (i % 3), -(i % 2)), acc: 8 });
  return out;
}

function attestationFor(scanId: string, listingId: string, offsetM = 0, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    scanId,
    listingId,
    policyVersion: 1,
    recording: { startedAt: "2026-09-14T23:30:00Z", durationMs: 300_000, mimeType: "video/mp4" },
    samples: samplesFor(offsetM),
    pauses: [],
    client: { userAgent: "test", platform: null },
    ...extra,
  });
}

function json(body: unknown, cookie: string, method = "POST") {
  return { method, headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) };
}

const S3_KEYS = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"] as const;

describeDb("HM-02 upload package", () => {
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
    bucket.reset();
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
    return { hostId, cookie: await mintSessionCookie({ id: hostId, email, name: label }) };
  }

  /** A confirmed draft with a capturing scan, ready for its package. */
  async function aCapturingScan(label: string) {
    const host = await aHost(label);
    const listingId = id();
    await insertListing({ id: listingId, hostId: host.hostId, title: "Upload cottage", status: "draft", timezone: "America/New_York" });
    let res = await app.request(`/api/listings/${listingId}`, json({ ...DOOR, confirmCoordinates: true }, host.cookie, "PATCH"));
    expect(res.status).toBe(200);
    res = await app.request(`/api/listings/${listingId}/scan`, { method: "POST", headers: { cookie: host.cookie } });
    expect(res.status, await res.clone().text()).toBe(201);
    const scan = (await res.json()) as ListingScan;
    return { ...host, listingId, scan };
  }

  const base = (listingId: string, scanId: string) => `/api/listings/${listingId}/scans/${scanId}`;

  /** Upload the whole package the way the browser would, against the fake bucket. */
  async function uploadPackage(ctx: { cookie: string; listingId: string; scan: ListingScan }, attestationText: string) {
    const { cookie, listingId, scan } = ctx;
    let res = await app.request(`${base(listingId, scan.id)}/uploads`, json({ kind: "video", contentType: "video/mp4" }, cookie));
    expect(res.status, await res.clone().text()).toBe(200);
    const video = (await res.json()) as ScanUploadTarget & { kind: "video" };
    for (const partNumber of [1, 2]) {
      res = await app.request(`${base(listingId, scan.id)}/uploads/parts`, json({ key: video.key, uploadId: video.uploadId, partNumber }, cookie));
      expect(res.status).toBe(200);
      bucket.putPart(video.uploadId, partNumber, 5_000_000);
    }
    res = await app.request(`${base(listingId, scan.id)}/uploads/finish`, json({ key: video.key, uploadId: video.uploadId }, cookie));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ key: video.key, sizeBytes: 10_000_000 });

    for (const [kind, text] of [
      ["attestation", attestationText],
      ["notes", JSON.stringify({ version: 1, scanId: scan.id })],
    ] as const) {
      res = await app.request(`${base(listingId, scan.id)}/uploads`, json({ kind, contentType: "application/json" }, cookie));
      expect(res.status).toBe(200);
      const target = (await res.json()) as ScanUploadTarget;
      bucket.putObject(target.key, text);
    }
    return video.key;
  }

  it("issues targets under the scan's prefix, only to the owner, only while capturing", async () => {
    const ctx = await aCapturingScan("targets");
    const res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/uploads`, json({ kind: "video", contentType: "video/webm;codecs=vp9" }, ctx.cookie));
    expect(res.status).toBe(200);
    const target = (await res.json()) as ScanUploadTarget;
    expect(target.kind).toBe("video");
    expect(target.key).toBe(`listings/${ctx.listingId}/scans/${ctx.scan.id}/video.webm`);

    const bad = await app.request(`${base(ctx.listingId, ctx.scan.id)}/uploads`, json({ kind: "video", contentType: "image/svg+xml" }, ctx.cookie));
    expect(bad.status).toBe(400);

    const stranger = await aHost("stranger");
    const denied = await app.request(`${base(ctx.listingId, ctx.scan.id)}/uploads`, json({ kind: "notes", contentType: "application/json" }, stranger.cookie));
    expect(denied.status).toBe(404);

    // A part URL for a key that is not this scan's video is refused.
    const foreign = await app.request(
      `${base(ctx.listingId, ctx.scan.id)}/uploads/parts`,
      json({ key: `listings/${ctx.listingId}/scans/${id()}/video.mp4`, uploadId: "x", partNumber: 1 }, ctx.cookie),
    );
    expect(foreign.status).toBe(400);
    const outOfRange = await app.request(
      `${base(ctx.listingId, ctx.scan.id)}/uploads/parts`,
      json({ key: target.key, uploadId: "x", partNumber: 0 }, ctx.cookie),
    );
    expect(outOfRange.status).toBe(400);
  });

  it("refuses everything without object storage", async () => {
    const ctx = await aCapturingScan("nostorage");
    for (const key of S3_KEYS) delete process.env[key];
    const res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/uploads`, json({ kind: "notes", contentType: "application/json" }, ctx.cookie));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: HONESTY_REFUSALS.storageNotConfigured });
  });

  it("completion refuses an incomplete package, then judges a good walk as uploaded", async () => {
    const ctx = await aCapturingScan("good");
    const videoKey = `listings/${ctx.listingId}/scans/${ctx.scan.id}/video.mp4`;

    let res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/complete`, json({ videoKey }, ctx.cookie));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: HONESTY_REFUSALS.uploadIncomplete });

    const key = await uploadPackage(ctx, attestationFor(ctx.scan.id, ctx.listingId));
    res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/complete`, json({ videoKey: key }, ctx.cookie));
    expect(res.status, await res.clone().text()).toBe(200);
    const scan = (await res.json()) as ListingScan;
    expect(scan).toMatchObject({
      id: ctx.scan.id,
      state: "uploaded",
      reason: null,
      capturedOn: "2026-09-14",
      uploads: { video: true, attestation: true, notes: true },
    });
    expect(scan.stats?.accurateCount).toBeGreaterThanOrEqual(60);
    expect(scan.completedAt).not.toBeNull();

    // The location record landed as the server's per-sample judgement.
    const rows = (await asOwner((db) =>
      db.execute(sql`SELECT count(*)::int AS n, bool_or(accurate) AS any_accurate FROM public.scan_geo_samples WHERE scan_id = ${ctx.scan.id}::uuid`),
    )) as unknown as { n: number; any_accurate: boolean }[];
    expect(rows[0]?.n).toBe(samplesFor().length);
    expect(rows[0]?.any_accurate).toBe(true);

    // A second completion is refused; so is any further upload target.
    res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/complete`, json({ videoKey: key }, ctx.cookie));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: HONESTY_REFUSALS.alreadySubmitted });
    res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/uploads`, json({ kind: "notes", contentType: "application/json" }, ctx.cookie));
    expect(res.status).toBe(409);

    // The status endpoint now shows the latest scan with its uploads.
    res = await app.request(`/api/listings/${ctx.listingId}/scan`, { headers: { cookie: ctx.cookie } });
    const status = (await res.json()) as { scan: ListingScan | null };
    expect(status.scan?.state).toBe("uploaded");
    expect(status.scan?.uploads.video).toBe(true);
  });

  it("judges a walk away from the door as rejected with the locked reason", async () => {
    const ctx = await aCapturingScan("far");
    const key = await uploadPackage(ctx, attestationFor(ctx.scan.id, ctx.listingId, 400));
    const res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/complete`, json({ videoKey: key }, ctx.cookie));
    expect(res.status, await res.clone().text()).toBe(200);
    const scan = (await res.json()) as ListingScan;
    expect(scan.state).toBe("rejected");
    expect(scan.reason).toBe("location_mismatch");
    expect(scan.capturedOn).toBe("2026-09-14");
  });

  it("ignores any verdict the phone wrote into its own record", async () => {
    const ctx = await aCapturingScan("forged");
    // Far from the door, but the JSON claims otherwise.
    const key = await uploadPackage(
      ctx,
      attestationFor(ctx.scan.id, ctx.listingId, 400, { verified: true, geofence: { ok: true }, atHome: true }),
    );
    const res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/complete`, json({ videoKey: key }, ctx.cookie));
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListingScan).state).toBe("rejected");
  });

  it("refuses an unreadable or mismatched record, and an oversized object", async () => {
    const ctx = await aCapturingScan("bad");
    const key = await uploadPackage(ctx, "not json at all");
    let res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/complete`, json({ videoKey: key }, ctx.cookie));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: HONESTY_REFUSALS.attestationUnreadable });

    // A record for a different scan is not this walk's.
    bucket.putObject(`listings/${ctx.listingId}/scans/${ctx.scan.id}/attestation.json`, attestationFor(id(), ctx.listingId));
    res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/complete`, json({ videoKey: key }, ctx.cookie));
    expect(res.status).toBe(400);

    // Over the cap: refused before anything is judged.
    bucket.putObject(`listings/${ctx.listingId}/scans/${ctx.scan.id}/attestation.json`, attestationFor(ctx.scan.id, ctx.listingId));
    bucket.objects.set(key, { bytes: 3 * 1024 * 1024 * 1024, contentType: "video/mp4", text: "" });
    res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/complete`, json({ videoKey: key }, ctx.cookie));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: HONESTY_REFUSALS.uploadTooLarge });

    // Nothing was recorded: the scan is still capturing.
    res = await app.request(`/api/listings/${ctx.listingId}/scan`, { headers: { cookie: ctx.cookie } });
    expect(((await res.json()) as { scan: ListingScan }).scan.state).toBe("capturing");
  });

  it("a stranger cannot complete someone else's walk", async () => {
    const ctx = await aCapturingScan("owner");
    const key = await uploadPackage(ctx, attestationFor(ctx.scan.id, ctx.listingId));
    const stranger = await aHost("intruder");
    const res = await app.request(`${base(ctx.listingId, ctx.scan.id)}/complete`, json({ videoKey: key }, stranger.cookie));
    expect(res.status).toBe(404);
  });
});
