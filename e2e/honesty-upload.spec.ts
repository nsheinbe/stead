/**
 * HM-02 in a real browser: a located walk's recording, kept in this
 * browser's IndexedDB, uploads on its own from the scan hub — presigned PUTs
 * with a CORS preflight, server-side receipts by HEAD, a server-written
 * manifest, and the scan moving to `uploaded` only after the complete
 * package. The bucket is the e2e stub on the next port (scripts/e2e-s3-stub.ts).
 *
 * What a phone still has to prove: MediaRecorder, continuous location and
 * the wake lock. Everything after the recording exists is covered here.
 */
import { expect, test, type Page } from "@playwright/test";
import { HM, HONESTY_POLICY_VERSION } from "../src/lib/honesty";
import type { HostScan, ScanLocationSample, StartScanResponse } from "../src/lib/types";
import { SESSION_COOKIE } from "../tests/helpers/session";
import { seedHost } from "./helpers/party";

const PIN = { lat: 40.7128, lng: -74.006 };
const CHUNK_BYTES = 1024 * 1024;
const CHUNKS = 20;
const port = Number(process.env.PORT ?? "4173");
const BUCKET_URL = `http://127.0.0.1:${port + 1}/stead-e2e`;

async function signIn(page: Page, token: string) {
  const base = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: new URL(base).hostname, path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

/** A walk around PIN with honest bookends. Same shape as tests/scans.test.ts. */
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

test.describe("honesty scan upload (HM-02)", () => {
  test("a located walk uploads from the browser that recorded it and lands in the queue", async ({ page }) => {
    const host = await seedHost("E2E Scanner");
    await signIn(page, host.token);

    const created = await page.request.post("/api/listings", {
      data: {
        title: "The Boathouse",
        description: "A boathouse by the water.",
        type: "entire_home",
        city: "Hudson",
        country: "US",
        timezone: "America/New_York",
        nightlyRateCents: 19_950,
        depositCents: 30_000,
        maxGuests: 4,
        status: "draft",
        ...PIN,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const listingId = ((await created.json()) as { id: string }).id;

    const started = await page.request.post(`/api/listings/${listingId}/scan`, {
      data: { policyVersion: HONESTY_POLICY_VERSION, acknowledged: true },
    });
    expect(started.status(), await started.text()).toBe(201);
    const { scanId } = (await started.json()) as StartScanResponse;

    const located = await page.request.post(`/api/listings/${listingId}/scan/${scanId}/location`, {
      data: { samples: walk() },
    });
    expect(located.status(), await located.text()).toBe(200);
    expect(((await located.json()) as HostScan).scan?.geofence).toBe("passed");

    // The recording, as the capture page would have left it: 2 s chunks in
    // IndexedDB plus the meta the upload declares.
    await page.goto("/host/listings");
    await page.evaluate(
      async ({ scanId, chunkBytes, chunks }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("stead-honesty-scan", 1);
          request.onupgradeneeded = () => {
            const d = request.result;
            if (!d.objectStoreNames.contains("chunks")) d.createObjectStore("chunks", { keyPath: ["scanId", "seq"] });
            if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "scanId" });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = db.transaction(["chunks", "meta"], "readwrite");
        for (let seq = 0; seq < chunks; seq += 1) {
          const bytes = new Uint8Array(chunkBytes);
          bytes[0] = seq;
          tx.objectStore("chunks").put({ scanId, seq, blob: new Blob([bytes], { type: "video/webm" }) });
        }
        tx.objectStore("meta").put({
          scanId,
          mimeType: "video/webm;codecs=vp9",
          samples: [],
          chunkCount: chunks,
          updatedAt: new Date().toISOString(),
          durationMs: chunks * 2000,
          clientEnvironment: { userAgent: "playwright", chunkMs: 2000 },
        });
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        db.close();
      },
      { scanId, chunkBytes: CHUNK_BYTES, chunks: CHUNKS },
    );

    // The hub finds the recording and starts on its own.
    await page.goto(`/host/listings/${listingId}/scan`);
    await expect(page.getByRole("heading", { name: HM["hm.upload.title"] })).toBeVisible();
    await expect(page.getByRole("heading", { name: HM["hm.build.queued.title"] })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(HM["hm.build.notYet"])).toBeVisible();

    // The server's word: every part confirmed at its declared size, then uploaded.
    const hub = (await (await page.request.get(`/api/listings/${listingId}/scan`)).json()) as HostScan;
    expect(hub.scan?.id).toBe(scanId);
    expect(hub.scan?.state).toBe("uploaded");
    expect(hub.scan?.upload?.partCount).toBe(3);
    expect(hub.scan?.upload?.parts.map((p) => [p.bytes, p.confirmed])).toEqual([
      [8 * CHUNK_BYTES, true],
      [8 * CHUNK_BYTES, true],
      [4 * CHUNK_BYTES, true],
    ]);
    expect(hub.scan?.upload?.confirmedBytes).toBe(CHUNKS * CHUNK_BYTES);
    expect(hub.scan?.upload?.uploadedAt).not.toBeNull();

    // The objects sit under the scan's private prefix, and the manifest the
    // server wrote names exactly them. Nothing in it is a verdict.
    const prefix = `${BUCKET_URL}/listings/${listingId}/scans/${scanId}`;
    const manifest = await (await page.request.get(`${prefix}/manifest.json`)).json() as {
      version: number;
      scanId: string;
      video: { mimeType: string; contentType: string; parts: { seq: number; key: string; bytes: number }[] };
      location: { geofence: string; sampleCount: number };
      clientEnvironment?: unknown;
    };
    expect(manifest.version).toBe(1);
    expect(manifest.scanId).toBe(scanId);
    expect(manifest.video.mimeType).toBe("video/webm;codecs=vp9");
    expect(manifest.video.contentType).toBe("video/webm");
    expect(manifest.video.parts.map((p) => p.key)).toEqual([0, 1, 2].map((seq) => `listings/${listingId}/scans/${scanId}/video/part-0000${seq}.webm`));
    expect(manifest.location).toEqual({ geofence: "passed", sampleCount: 50, checkedAt: hub.scan?.locationCheckedAt });
    expect(manifest).not.toHaveProperty("verified");
    for (const part of manifest.video.parts) {
      const head = await page.request.head(`${BUCKET_URL}/${part.key}`);
      expect(head.status()).toBe(200);
      expect(Number(head.headers()["content-length"])).toBe(part.bytes);
      expect(head.headers()["content-type"]).toBe("video/webm");
    }

    // The phone is clear once the server has the package.
    const left = await page.evaluate(async (scanId) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("stead-honesty-scan", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const count = await new Promise<number>((resolve, reject) => {
        const request = db
          .transaction("chunks", "readonly")
          .objectStore("chunks")
          .count(IDBKeyRange.bound([scanId, 0], [scanId, Number.MAX_SAFE_INTEGER]));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return count;
    }, scanId);
    expect(left).toBe(0);

    // Reloading shows the queue, not the uploader: the server's state wins.
    await page.reload();
    await expect(page.getByRole("heading", { name: HM["hm.build.queued.title"] })).toBeVisible();
    await expect(page.getByText(HM["hm.scan.state.queued"])).toBeVisible();
  });
});
