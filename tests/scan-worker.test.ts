/**
 * HM-03 — the reconstruction job, end to end over HTTP against Postgres.
 *
 * The worker's two calls (claim, finish), the host's two (retry, stills),
 * the stale-release cron, and the one email per terminal state. Email
 * delivery and the signed still URLs are the only fakes; every transition
 * runs through the real SECURITY DEFINER functions.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { app } from "../server/app";
import { HONESTY_REFUSALS, SCAN_EMAIL_SUBJECTS } from "../src/lib/honestyCopy";
import type { ListingScan, ListingScanStatus, ScanJob, ScanStills } from "../src/lib/types";
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

function asWorker(body: unknown, authorization: string | null = `Bearer ${WORKER_SECRET}`) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  };
}

const artifact = (prefix: string, kind: string, name: string, contentType = "application/octet-stream") => ({
  kind,
  objectKey: `${prefix}${name}`,
  contentType,
  sizeBytes: 10,
});

const fullOutputs = (prefix: string) => [
  artifact(prefix, "frames", "frames.json", "application/json"),
  artifact(prefix, "cameras", "cameras.json", "application/json"),
  artifact(prefix, "splat", "splat.ply"),
  artifact(prefix, "splat_compressed", "splat.compressed.ply"),
  artifact(prefix, "stills", "stills/00.jpg", "image/jpeg"),
  artifact(prefix, "stills", "stills/01.jpg", "image/jpeg"),
];

describeDb("HM-03 reconstruction jobs", () => {
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
    process.env.SCAN_WORKER_SECRET = WORKER_SECRET;
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

  /** A scan as HM-02 leaves it: judged, uploaded, its three raw objects recorded. Owner writes: members cannot. */
  async function aScan(
    host: Host,
    overrides: {
      title?: string;
      state?: string;
      reason?: string | null;
      attempt?: number;
      claimedAt?: string | null;
      artifacts?: boolean;
    } = {},
  ) {
    const listingId = id();
    const scanId = id();
    const prefix = `listings/${listingId}/scans/${scanId}/`;
    await insertListing({ id: listingId, hostId: host.hostId, title: overrides.title ?? "Worker cottage", status: "draft" });
    await asOwner(async (db) => {
      await db.execute(
        sql`UPDATE public.listings SET lat = ${DOOR.lat}, lng = ${DOOR.lng}, coordinates_confirmed_at = now() WHERE id = ${listingId}::uuid`,
      );
      await db.execute(sql`
        INSERT INTO public.listing_scans (
          id, listing_id, host_id, state, reason, honesty_policy_version,
          accuracy_max_m, geofence_radius_m, bookend_window_seconds, bookend_min_samples,
          min_indoor_seconds, max_seconds, target_lat, target_lng,
          captured_on, completed_at, geofence_stats, attempt, claimed_at, worker_id
        ) VALUES (
          ${scanId}::uuid, ${listingId}::uuid, ${host.hostId}::uuid,
          ${overrides.state ?? "uploaded"}::public.scan_state, ${overrides.reason ?? null}, 1,
          35, 100, 90, 15, 60, 600, ${DOOR.lat}, ${DOOR.lng},
          '2026-09-14'::date, now(),
          '{"sampleCount":60,"accurateCount":60,"durationSeconds":300,"startAccurate":30,"endAccurate":30,"medianDistanceM":10,"startDistanceM":1,"endDistanceM":1}'::jsonb,
          ${overrides.attempt ?? 0}, ${overrides.claimedAt ?? null}::timestamptz, ${overrides.claimedAt ? "dead-worker" : null}
        )
      `);
      if (overrides.artifacts !== false) {
        await db.execute(sql`
          INSERT INTO public.scan_artifacts (scan_id, kind, object_key, content_type, size_bytes) VALUES
            (${scanId}::uuid, 'video', ${`${prefix}video.mp4`}, 'video/mp4', 1000),
            (${scanId}::uuid, 'attestation', ${`${prefix}attestation.json`}, 'application/json', 100),
            (${scanId}::uuid, 'notes', ${`${prefix}notes.json`}, 'application/json', 50)
        `);
      }
    });
    return { listingId, scanId, prefix };
  }

  const claim = (workerId = "w-test") => app.request("/api/scan-worker/jobs/claim", asWorker({ workerId }));
  const finish = (scanId: string, body: unknown) => app.request(`/api/scan-worker/jobs/${scanId}/finish`, asWorker(body));

  /** Other suites leave `uploaded` packages behind; take them so ordering here is ours. */
  async function drainQueue() {
    for (let i = 0; i < 50; i += 1) {
      if ((await claim("drain")).status === 204) return;
    }
    throw new Error("queue did not drain");
  }

  async function status(host: Host, listingId: string): Promise<ListingScan> {
    const res = await app.request(`/api/listings/${listingId}/scan`, { headers: { cookie: host.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListingScanStatus;
    if (!body.scan) throw new Error("no scan");
    return body.scan;
  }

  it("answers only to the worker secret", async () => {
    expect((await app.request("/api/scan-worker/jobs/claim", asWorker({ workerId: "w" }, null))).status).toBe(401);
    expect((await app.request("/api/scan-worker/jobs/claim", asWorker({ workerId: "w" }, "Bearer wrong"))).status).toBe(401);
    const host = await aHost("member");
    // A signed-in member is not a worker.
    const asMember = await app.request("/api/scan-worker/jobs/claim", {
      method: "POST",
      headers: { cookie: host.cookie, "content-type": "application/json" },
      body: JSON.stringify({ workerId: "w" }),
    });
    expect(asMember.status).toBe(401);
    expect((await finish(id(), { attempt: 1, outcome: "failed", reason: "reconstruction_failed", artifacts: [] })).status).not.toBe(401);
    expect((await app.request(`/api/scan-worker/jobs/${id()}/finish`, asWorker({}, "Bearer wrong"))).status).toBe(401);
    delete process.env.SCAN_WORKER_SECRET;
    expect((await claim()).status).toBe(500);
  });

  it("claims the oldest whole package once, and only whole packages", async () => {
    await drainQueue();
    const host = await aHost("claim");
    const bare = await aScan(host, { artifacts: false });
    const first = await aScan(host);
    const second = await aScan(host);

    let res = await claim("w-1");
    expect(res.status, await res.clone().text()).toBe(200);
    const { job } = (await res.json()) as { job: ScanJob };
    expect(job).toEqual({
      scanId: first.scanId,
      listingId: first.listingId,
      job: "reconstruct",
      attempt: 1,
      // HM-04: a build carries no marks, and the clock the worker would place them on.
      maskSegments: [],
      durationMs: 300_000,
      timezone: "America/New_York",
      target: DOOR,
      thresholds: { accuracyMaxM: 35, geofenceRadiusM: 100 },
      inputs: {
        videoKey: `${first.prefix}video.mp4`,
        videoContentType: "video/mp4",
        attestationKey: `${first.prefix}attestation.json`,
        notesKey: `${first.prefix}notes.json`,
      },
      outputPrefix: first.prefix,
    });

    const scan = await status(host, first.listingId);
    expect(scan.state).toBe("reconstructing");
    expect(scan.attempt).toBe(1);
    expect(scan.maxAttempts).toBe(3);
    expect(scan.canRetry).toBe(false);
    expect(scan.claimedAt).toBeTruthy();
    const [row] = await asOwner((db) => db.execute(sql`SELECT worker_id FROM public.listing_scans WHERE id = ${first.scanId}::uuid`));
    expect(row).toEqual({ worker_id: "w-1" });

    res = await claim("w-2");
    expect(((await res.json()) as { job: ScanJob }).job.scanId).toBe(second.scanId);
    expect((await claim("w-3")).status).toBe(204);
    expect((await status(host, bare.listingId)).state).toBe("uploaded");
    expect((await claim("   ")).status).toBe(400);
  });

  it("finish refuses a stale attempt, a foreign key, a raw kind and a splat-less needs_mask, and writes nothing", async () => {
    await drainQueue();
    const host = await aHost("finish");
    const s = await aScan(host);
    const { job } = (await (await claim()).json()) as { job: ScanJob };
    expect(job.scanId).toBe(s.scanId);

    const outputs = fullOutputs(s.prefix);
    let res = await finish(s.scanId, { attempt: 2, outcome: "needs_mask", artifacts: outputs });
    expect(res.status).toBe(409);
    expect((await finish(id(), { attempt: 1, outcome: "needs_mask", artifacts: [] })).status).toBe(409);
    expect((await finish("not-a-uuid", { attempt: 1, outcome: "needs_mask", artifacts: [] })).status).toBe(404);

    res = await finish(s.scanId, {
      attempt: 1,
      outcome: "needs_mask",
      artifacts: [...outputs, { kind: "stills", objectKey: "listings/other/scans/x/stills/00.jpg", contentType: "image/jpeg", sizeBytes: 1 }],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/outside the scan prefix/);

    res = await finish(s.scanId, { attempt: 1, outcome: "needs_mask", artifacts: [...outputs, artifact(s.prefix, "stills", "../../../x.jpg")] });
    expect(res.status).toBe(400);

    res = await finish(s.scanId, { attempt: 1, outcome: "needs_mask", artifacts: [...outputs, artifact(s.prefix, "video", "video.mp4")] });
    expect(res.status).toBe(400);

    res = await finish(s.scanId, { attempt: 1, outcome: "needs_mask", artifacts: [artifact(s.prefix, "stills", "stills/00.jpg", "image/jpeg")] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/needs a splat/);

    res = await finish(s.scanId, { attempt: 1, outcome: "failed", artifacts: [] });
    expect(res.status).toBe(400);
    res = await finish(s.scanId, { attempt: 1, outcome: "verified", artifacts: outputs });
    expect(res.status).toBe(400);

    const scan = await status(host, s.listingId);
    expect(scan.state).toBe("reconstructing");
    expect(scan.outputs).toEqual({ frames: false, cameras: false, splat: false, splat_compressed: false, stills: false });
    expect(outbox.sent).toHaveLength(0);
  });

  it("a finished reconstruction records the outputs, moves to needs_mask and emails the host once", async () => {
    await drainQueue();
    const host = await aHost("ready");
    const s = await aScan(host, { title: "Ready cottage" });
    await claim();

    const res = await finish(s.scanId, { attempt: 1, outcome: "needs_mask", artifacts: fullOutputs(s.prefix) });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ scanId: s.scanId, state: "needs_mask", notified: true });

    const scan = await status(host, s.listingId);
    expect(scan.state).toBe("needs_mask");
    expect(scan.reason).toBeNull();
    expect(scan.uploads).toEqual({ video: true, attestation: true, notes: true });
    expect(scan.outputs).toEqual({ frames: true, cameras: true, splat: true, splat_compressed: true, stills: true });
    expect(scan.canRetry).toBe(false);
    expect(outbox.sent).toEqual([
      {
        to: host.email,
        subject: SCAN_EMAIL_SUBJECTS.needs_mask("Ready cottage"),
        text: expect.stringContaining(`/host/listings/${s.listingId}/scan/status`),
      },
    ]);

    // The same attempt again: the row has moved on, nothing is re-sent.
    expect((await finish(s.scanId, { attempt: 1, outcome: "needs_mask", artifacts: fullOutputs(s.prefix) })).status).toBe(409);
    expect(outbox.sent).toHaveLength(1);

    // A retry only makes sense from failed.
    const retry = await app.request(`/api/listings/${s.listingId}/scans/${s.scanId}/retry`, { method: "POST", headers: { cookie: host.cookie } });
    expect(retry.status).toBe(409);
    expect(((await retry.json()) as { error: string }).error).toBe(HONESTY_REFUSALS.retryNotFailed);
  });

  it("a failed reconstruction keeps its stills, and the host may retry until the cap", async () => {
    await drainQueue();
    const host = await aHost("retry");
    const stranger = await aHost("stranger");
    const s = await aScan(host, { title: "Retry cottage" });
    const stills = [artifact(s.prefix, "stills", "stills/00.jpg", "image/jpeg"), artifact(s.prefix, "stills", "stills/01.jpg", "image/jpeg")];
    const retryPath = `/api/listings/${s.listingId}/scans/${s.scanId}/retry`;
    const stillsPath = `/api/listings/${s.listingId}/scans/${s.scanId}/stills`;

    for (const attempt of [1, 2, 3]) {
      const { job } = (await (await claim()).json()) as { job: ScanJob };
      expect(job.scanId).toBe(s.scanId);
      expect(job.attempt).toBe(attempt);
      const res = await finish(s.scanId, { attempt, outcome: "failed", reason: "reconstruction_failed", artifacts: stills });
      expect(res.status, await res.clone().text()).toBe(200);

      const scan = await status(host, s.listingId);
      expect(scan.state).toBe("failed");
      expect(scan.reason).toBe("reconstruction_failed");
      expect(scan.attempt).toBe(attempt);
      expect(scan.outputs.stills).toBe(true);
      expect(scan.outputs.splat).toBe(false);
      expect(scan.canRetry).toBe(attempt < 3);
      expect(outbox.sent.at(-1)).toMatchObject({ to: host.email, subject: SCAN_EMAIL_SUBJECTS.failed("Retry cottage") });

      // Stills: the host gets signed URLs; a stranger gets nothing; no storage, no URLs.
      const mine = await app.request(stillsPath, { headers: { cookie: host.cookie } });
      expect(mine.status).toBe(200);
      const body = (await mine.json()) as ScanStills;
      expect(body.stills).toEqual([
        { index: 0, url: `https://signed.example.test/${s.prefix}stills/00.jpg`, atMs: 0 },
        { index: 1, url: `https://signed.example.test/${s.prefix}stills/01.jpg`, atMs: 300_000 },
      ]);
      expect((await app.request(stillsPath, { headers: { cookie: stranger.cookie } })).status).toBe(404);
      expect((await app.request(stillsPath)).status).toBe(401);

      expect((await app.request(retryPath, { method: "POST", headers: { cookie: stranger.cookie } })).status).toBe(404);
      const retried = await app.request(retryPath, { method: "POST", headers: { cookie: host.cookie } });
      if (attempt < 3) {
        expect(retried.status, await retried.clone().text()).toBe(200);
        const after = (await retried.json()) as ListingScan;
        expect(after.state).toBe("uploaded");
        expect(after.reason).toBeNull();
        expect(after.attempt).toBe(attempt);
        expect(after.claimedAt).toBeNull();
        expect(after.canRetry).toBe(false);
      } else {
        expect(retried.status).toBe(409);
        expect(((await retried.json()) as { error: string }).error).toBe(HONESTY_REFUSALS.retryExhausted(3));
      }
    }
    expect(outbox.sent).toHaveLength(3);
    expect((await claim()).status).toBe(204);

    delete process.env.S3_BUCKET;
    expect((await app.request(stillsPath, { headers: { cookie: host.cookie } })).status).toBe(503);
  });

  it("the stale-release job requeues a dead claim, fails one out of attempts, and tells that host", async () => {
    const host = await aHost("stale");
    const sevenHoursAgo = new Date(Date.now() - 7 * 3600_000).toISOString();
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const requeue = await aScan(host, { state: "reconstructing", attempt: 1, claimedAt: sevenHoursAgo });
    const giveUp = await aScan(host, { state: "reconstructing", attempt: 3, claimedAt: sevenHoursAgo, title: "Stale cottage" });
    const fresh = await aScan(host, { state: "reconstructing", attempt: 1, claimedAt: oneHourAgo });

    expect((await app.request("/api/cron/release-stale-scan-jobs")).status).toBe(401);
    const res = await app.request("/api/cron/release-stale-scan-jobs", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ requeued: 1, failed: 1, notified: 1 });

    expect(await status(host, requeue.listingId)).toMatchObject({ state: "uploaded", attempt: 1, claimedAt: null, reason: null });
    expect(await status(host, giveUp.listingId)).toMatchObject({ state: "failed", attempt: 3, reason: "reconstruction_failed", canRetry: false });
    expect(await status(host, fresh.listingId)).toMatchObject({ state: "reconstructing", attempt: 1 });
    expect(outbox.sent).toEqual([
      { to: host.email, subject: SCAN_EMAIL_SUBJECTS.failed("Stale cottage"), text: expect.stringContaining("/scan/status") },
    ]);
    const beats = await asOwner((db) => db.execute(sql`SELECT job FROM public.cron_heartbeats WHERE job = 'release-stale-scan-jobs'`));
    expect(beats).toHaveLength(1);

    // Idempotent: nothing left to move.
    const again = await app.request("/api/cron/release-stale-scan-jobs", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(await again.json()).toEqual({ requeued: 0, failed: 0, notified: 0 });
    // The requeued walk is claimable again, at attempt 2.
    await drainQueue();
    expect((await status(host, requeue.listingId)).attempt).toBe(2);
  });
});
