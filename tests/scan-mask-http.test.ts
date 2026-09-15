/**
 * HM-04 — marking private rooms, end to end over HTTP against Postgres.
 *
 * What a host can do: mark stretches of their own walk, confirm the whole
 * walk instead, and send it. What the server refuses: someone else's scan, a
 * whole-home answer on a private room, marks that leave nothing to walk
 * through, and sending from any state but `needs_mask`. The worker side is
 * here too, because a crop job is what sending produces.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { app } from "../server/app";
import { HONESTY_REFUSALS, SCAN_EMAIL_SUBJECTS } from "../src/lib/honestyCopy";
import type { ListingScan, ListingScanStatus, ScanJob, ScanMask, ScanStills } from "../src/lib/types";
import { asOwner, closeTestDb, getHarness, id, insertListing, insertMember, ownerDatabaseUrl } from "./helpers/db";
import { mintSessionCookie } from "./helpers/session";

const describeDb = ownerDatabaseUrl() || process.env.CI ? describe : describe.skip;

const outbox = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }));

vi.mock("../server/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/lib/email")>();
  return {
    ...actual,
    async sendEmail(message: { to: string; subject: string; text: string }) {
      outbox.sent.push({ to: message.to, subject: message.subject, text: message.text });
      return true;
    },
  };
});

vi.mock("../server/lib/scanStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/lib/scanStorage")>();
  return {
    ...actual,
    async presignGetObject(key: string) {
      return { url: `https://signed.example.test/${key}`, expiresInSeconds: 300 };
    },
  };
});

const WORKER_SECRET = "worker-secret-for-tests-please-rotate";
const CRON_SECRET = "cron-secret-for-tests";
const S3_KEYS = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"] as const;
const ENV_KEYS = [...S3_KEYS, "SCAN_WORKER_SECRET", "CRON_SECRET"] as const;
const DOOR = { lat: 42.2529, lng: -73.791 };
const DURATION_S = 300;

function asWorker(body: unknown) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${WORKER_SECRET}` },
    body: JSON.stringify(body),
  };
}

function json(body: unknown, cookie: string) {
  return { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) };
}

const artifact = (prefix: string, kind: string, name: string) => ({
  kind,
  objectKey: `${prefix}${name}`,
  contentType: "application/octet-stream",
  sizeBytes: 10,
});

const builtOutputs = (prefix: string) => [
  artifact(prefix, "cameras", "cameras.json"),
  artifact(prefix, "splat", "splat.ply"),
];

describeDb("HM-04 private rooms", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-at-least-32-characters-long";
    process.env.AUTH_DATABASE_URL ??= "postgres://u:p@127.0.0.1:5432/stead";
    const harness = await getHarness();
    process.env.DATABASE_URL ??= harness.appUrl;
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of S3_KEYS) process.env[key] = key === "S3_PUBLIC_URL" ? "https://cdn.example.test/stead" : "test";
    process.env.SCAN_WORKER_SECRET = WORKER_SECRET;
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    outbox.sent.length = 0;
    for (const key of S3_KEYS) process.env[key] = key === "S3_PUBLIC_URL" ? "https://cdn.example.test/stead" : "test";
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) {
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

  /** A scan as HM-03 leaves it: built, waiting to be marked, with its stills. */
  async function aBuiltScan(
    host: Host,
    overrides: { type?: "entire_home" | "apartment" | "private_room"; title?: string; state?: string } = {},
  ) {
    const listingId = id();
    const scanId = id();
    const prefix = `listings/${listingId}/scans/${scanId}/`;
    await insertListing({
      id: listingId,
      hostId: host.hostId,
      title: overrides.title ?? "Mask cottage",
      status: "draft",
      type: overrides.type ?? "entire_home",
    });
    await asOwner(async (db) => {
      await db.execute(
        sql`UPDATE public.listings SET lat = ${DOOR.lat}, lng = ${DOOR.lng}, coordinates_confirmed_at = now() WHERE id = ${listingId}::uuid`,
      );
      await db.execute(sql`
        INSERT INTO public.listing_scans (
          id, listing_id, host_id, state, honesty_policy_version,
          accuracy_max_m, geofence_radius_m, bookend_window_seconds, bookend_min_samples,
          min_indoor_seconds, max_seconds, target_lat, target_lng,
          captured_on, completed_at, geofence_stats, attempt, job
        ) VALUES (
          ${scanId}::uuid, ${listingId}::uuid, ${host.hostId}::uuid,
          ${overrides.state ?? "needs_mask"}::public.scan_state, 1,
          35, 100, 90, 15, 60, 600, ${DOOR.lat}, ${DOOR.lng},
          '2026-09-14'::date, now(),
          ${sql.raw(`'{"sampleCount":60,"accurateCount":60,"durationSeconds":${DURATION_S},"startAccurate":30,"endAccurate":30,"medianDistanceM":10,"startDistanceM":1,"endDistanceM":1}'::jsonb`)},
          1, 'reconstruct'
        )
      `);
      await db.execute(sql`
        INSERT INTO public.scan_artifacts (scan_id, kind, object_key, content_type, size_bytes) VALUES
          (${scanId}::uuid, 'video', ${`${prefix}video.mp4`}, 'video/mp4', 1000),
          (${scanId}::uuid, 'attestation', ${`${prefix}attestation.json`}, 'application/json', 100),
          (${scanId}::uuid, 'notes', ${`${prefix}notes.json`}, 'application/json', 50),
          (${scanId}::uuid, 'cameras', ${`${prefix}cameras.json`}, 'application/json', 50),
          (${scanId}::uuid, 'splat', ${`${prefix}splat.ply`}, 'application/octet-stream', 500),
          (${scanId}::uuid, 'stills', ${`${prefix}stills/00.jpg`}, 'image/jpeg', 10),
          (${scanId}::uuid, 'stills', ${`${prefix}stills/01.jpg`}, 'image/jpeg', 10)
      `);
    });
    return { listingId, scanId, prefix };
  }

  const base = (listingId: string, scanId: string) => `/api/listings/${listingId}/scans/${scanId}`;
  const claim = (workerId = "w-mask") =>
    app.request("/api/scan-worker/jobs/claim", asWorker({ workerId }));

  async function drainQueue() {
    for (let i = 0; i < 50; i += 1) {
      if ((await claim("drain")).status === 204) return;
    }
    throw new Error("queue did not drain");
  }

  async function scanOf(host: Host, listingId: string): Promise<ListingScan> {
    const res = await app.request(`/api/listings/${listingId}/scan`, { headers: { cookie: host.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListingScanStatus;
    if (!body.scan) throw new Error("no scan");
    return body.scan;
  }

  it("normalises the marks it stores, and keeps them off anyone else's scan", async () => {
    const host = await aHost("marker");
    const stranger = await aHost("stranger");
    const s = await aBuiltScan(host);
    const path = `${base(s.listingId, s.scanId)}/mask`;

    // Unsorted and overlapping in, merged and clamped out.
    const res = await app.request(
      path,
      json(
        {
          segments: [
            { fromMs: 120_000, toMs: 150_000 },
            { fromMs: 10_000, toMs: 20_000 },
            { fromMs: 140_000, toMs: 999_000 },
          ],
        },
        host.cookie,
      ),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const mask = (await res.json()) as ScanMask;
    expect(mask.segments).toEqual([
      { fromMs: 10_000, toMs: 20_000 },
      { fromMs: 120_000, toMs: 300_000 },
    ]);
    expect(mask.wholeHomeConfirmedAt).toBeNull();

    // It comes back on the scan, and only to its host.
    const scan = await scanOf(host, s.listingId);
    expect(scan.mask?.segments).toHaveLength(2);
    expect(scan.wholeHomeAllowed).toBe(true);

    expect((await app.request(path, json({ segments: [] }, stranger.cookie))).status).toBe(404);
    expect((await app.request(path, { method: "POST" })).status).toBe(401);
  });

  it("refuses marks that leave a guest nothing to walk through", async () => {
    const host = await aHost("all-private");
    const s = await aBuiltScan(host);
    const res = await app.request(
      `${base(s.listingId, s.scanId)}/mask`,
      json({ segments: [{ fromMs: 0, toMs: DURATION_S * 1000 }] }, host.cookie),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(HONESTY_REFUSALS.maskAllPrivate);
    expect((await scanOf(host, s.listingId)).mask).toBeNull();
  });

  it("a private room must mark, and is told so by the server as well as the page", async () => {
    const host = await aHost("private-room");
    const s = await aBuiltScan(host, { type: "private_room" });
    const scan = await scanOf(host, s.listingId);
    expect(scan.wholeHomeAllowed).toBe(false);

    const res = await app.request(`${base(s.listingId, s.scanId)}/mask`, json({ wholeHomeConfirmed: true }, host.cookie));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(HONESTY_REFUSALS.maskPrivateRoomWholeHome);

    // Marking works for the same listing.
    const marked = await app.request(
      `${base(s.listingId, s.scanId)}/mask`,
      json({ segments: [{ fromMs: 0, toMs: 30_000 }] }, host.cookie),
    );
    expect(marked.status).toBe(200);
  });

  it("whole home verifies straight away, because nothing needs cutting", async () => {
    const host = await aHost("whole");
    const s = await aBuiltScan(host, { title: "Whole cottage" });

    // Nothing answered yet: sending is refused with the sentence the page shows.
    const early = await app.request(`${base(s.listingId, s.scanId)}/send`, { method: "POST", headers: { cookie: host.cookie } });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: string }).error).toBe(HONESTY_REFUSALS.maskNothingMarked);

    expect((await app.request(`${base(s.listingId, s.scanId)}/mask`, json({ wholeHomeConfirmed: true }, host.cookie))).status).toBe(200);

    const res = await app.request(`${base(s.listingId, s.scanId)}/send`, { method: "POST", headers: { cookie: host.cookie } });
    expect(res.status, await res.clone().text()).toBe(200);
    const scan = (await res.json()) as ListingScan;
    expect(scan.state).toBe("verified");
    expect(scan.verifiedAt).toBeTruthy();
    expect(scan.mask?.wholeHomeConfirmedAt).toBeTruthy();
    expect(outbox.sent).toEqual([
      {
        to: host.email,
        subject: SCAN_EMAIL_SUBJECTS.verified("Whole cottage"),
        text: expect.stringContaining("whole walk"),
      },
    ]);

    // No job was queued: the walk the host reviewed is the one guests get.
    await drainQueue();
    expect((await scanOf(host, s.listingId)).state).toBe("verified");

    // And the page is closed now.
    expect((await app.request(`${base(s.listingId, s.scanId)}/mask`, json({ segments: [] }, host.cookie))).status).toBe(409);
    const again = await app.request(`${base(s.listingId, s.scanId)}/send`, { method: "POST", headers: { cookie: host.cookie } });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe(HONESTY_REFUSALS.maskNotReady);
  });

  it("marks become a crop job the worker claims, runs and verifies", async () => {
    await drainQueue();
    const host = await aHost("cropper");
    const s = await aBuiltScan(host, { title: "Crop cottage" });
    const segments = [{ fromMs: 100_000, toMs: 140_000 }];

    expect((await app.request(`${base(s.listingId, s.scanId)}/mask`, json({ segments }, host.cookie))).status).toBe(200);
    const sent = await app.request(`${base(s.listingId, s.scanId)}/send`, { method: "POST", headers: { cookie: host.cookie } });
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect((await sent.json()) as ListingScan).toMatchObject({ state: "reconstructing", job: "crop" });
    expect(outbox.sent).toHaveLength(0);

    // The worker gets the marks and the clock they sit on.
    const claimed = await claim();
    expect(claimed.status).toBe(200);
    const { job } = (await claimed.json()) as { job: ScanJob };
    expect(job).toMatchObject({
      scanId: s.scanId,
      job: "crop",
      attempt: 2,
      maskSegments: segments,
      durationMs: DURATION_S * 1000,
    });

    // A crop job may not finish as a build, and a build outcome may not verify.
    const wrong = await app.request(
      `/api/scan-worker/jobs/${s.scanId}/finish`,
      asWorker({ attempt: 2, outcome: "needs_mask", artifacts: builtOutputs(s.prefix) }),
    );
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toMatch(/cannot finish as needs_mask/);

    const res = await app.request(
      `/api/scan-worker/jobs/${s.scanId}/finish`,
      asWorker({ attempt: 2, outcome: "verified", artifacts: builtOutputs(s.prefix) }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ scanId: s.scanId, state: "verified", notified: true });

    const scan = await scanOf(host, s.listingId);
    expect(scan.state).toBe("verified");
    expect(scan.verifiedAt).toBeTruthy();
    expect(scan.mask?.segments).toEqual(segments);
    expect(outbox.sent.at(-1)).toMatchObject({ to: host.email, subject: SCAN_EMAIL_SUBJECTS.verified("Crop cottage") });
  });

  it("a build job cannot verify itself, whatever it sends", async () => {
    await drainQueue();
    const host = await aHost("builder");
    const s = await aBuiltScan(host, { state: "uploaded" });
    const { job } = (await (await claim()).json()) as { job: ScanJob };
    expect(job).toMatchObject({ scanId: s.scanId, job: "reconstruct", maskSegments: [] });

    const res = await app.request(
      `/api/scan-worker/jobs/${s.scanId}/finish`,
      asWorker({ attempt: 2, outcome: "verified", artifacts: builtOutputs(s.prefix) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/only a crop job can finish as verified/);
    expect((await scanOf(host, s.listingId)).state).toBe("reconstructing");
  });

  it("a crop that dies or fails goes back to the marks, not to the start", async () => {
    await drainQueue();
    const host = await aHost("stale-crop");
    const s = await aBuiltScan(host, { title: "Stale crop cottage" });
    expect(
      (await app.request(`${base(s.listingId, s.scanId)}/mask`, json({ segments: [{ fromMs: 0, toMs: 30_000 }] }, host.cookie)))
        .status,
    ).toBe(200);
    expect((await app.request(`${base(s.listingId, s.scanId)}/send`, { method: "POST", headers: { cookie: host.cookie } })).status).toBe(200);
    await claim();

    // A worker that died holding it: the cron hands it back to the mask page.
    await asOwner(async (db) => {
      await db.execute(
        sql`UPDATE public.listing_scans SET claimed_at = now() - interval '7 hours' WHERE id = ${s.scanId}::uuid`,
      );
    });
    const released = await app.request("/api/cron/release-stale-scan-jobs", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(released.status).toBe(200);
    const after = await scanOf(host, s.listingId);
    expect(after.state).toBe("needs_mask");
    expect(after.mask?.segments).toEqual([{ fromMs: 0, toMs: 30_000 }]);

    // A failed crop retries back to the mask page too.
    await asOwner(async (db) => {
      await db.execute(
        sql`UPDATE public.listing_scans SET state = 'failed', reason = 'reconstruction_failed' WHERE id = ${s.scanId}::uuid`,
      );
    });
    const retried = await app.request(`${base(s.listingId, s.scanId)}/retry`, {
      method: "POST",
      headers: { cookie: host.cookie },
    });
    expect(retried.status, await retried.clone().text()).toBe(200);
    expect((await retried.json()) as ListingScan).toMatchObject({ state: "needs_mask", job: "crop" });
  });

  it("the stills carry the moment each frame sits at, so the scrubber is honest", async () => {
    const host = await aHost("stills");
    const s = await aBuiltScan(host);
    const res = await app.request(`${base(s.listingId, s.scanId)}/stills`, { headers: { cookie: host.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScanStills;
    expect(body.durationMs).toBe(DURATION_S * 1000);
    expect(body.stills).toEqual([
      { index: 0, url: `https://signed.example.test/${s.prefix}stills/00.jpg`, atMs: 0 },
      { index: 1, url: `https://signed.example.test/${s.prefix}stills/01.jpg`, atMs: DURATION_S * 1000 },
    ]);
  });
});
