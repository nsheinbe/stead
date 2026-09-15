/**
 * HM-02 — the browser's side of the upload, without a browser.
 *
 * A fake transport records every call. What the tests protect: the three
 * objects go up in order and the verdict is asked for last; a dropped part
 * is retried and then surfaced with the session intact; a second run
 * resumes from the parts the bucket already holds; and nothing that leaves
 * the phone contains a verdict.
 */
import { describe, expect, it } from "vitest";
import {
  buildAttestation,
  buildNotes,
  planParts,
  UploadError,
  uploadWalk,
  type UploadSession,
  type UploadTransport,
  type WalkForUpload,
} from "../src/lib/scanUpload";
import type { ListingScan, ScanUploadTarget } from "../src/lib/types";

const SCAN = "4a2e0c9a-2222-4222-8222-222222222222";
const LISTING = "3f1e0c9a-1111-4111-8111-111111111111";
const PART = 1024;

function walk(sizeBytes = PART * 2 + 10): WalkForUpload {
  return {
    scanId: SCAN,
    listingId: LISTING,
    policyVersion: 1,
    blob: new Blob([new Uint8Array(sizeBytes)], { type: "video/mp4" }),
    mimeType: "video/mp4",
    startedAt: "2026-09-14T23:30:00Z",
    durationMs: 240_000.4,
    samples: [{ t: 0.4, lat: 1, lng: 2, acc: 5 }],
    pauses: [{ fromMs: 10.2, toMs: 20.7 }],
    client: { userAgent: "UA", platform: null, videoWidth: 1920, videoHeight: 1080 },
  };
}

const done: ListingScan = {
  id: SCAN,
  state: "uploaded",
  reason: null,
  policyVersion: 1,
  thresholds: { accuracyMaxM: 35, geofenceRadiusM: 100, bookendWindowSeconds: 90, bookendMinSamples: 15, minIndoorSeconds: 60, maxSeconds: 600 },
  capturedOn: "2026-09-14",
  verifiedAt: null,
  createdAt: "2026-09-14T23:29:00.000Z",
  uploads: { video: true, attestation: true, notes: true },
  stats: null,
  completedAt: "2026-09-14T23:40:00.000Z",
};

type Call = string;

function fakeTransport(opts: { failPart?: number; failTimes?: number; existingParts?: number[] } = {}) {
  const calls: Call[] = [];
  const puts = new Map<string, Blob>();
  let failuresLeft = opts.failTimes ?? 0;
  const transport: UploadTransport = {
    async target(kind, contentType) {
      calls.push(`target:${kind}:${contentType}`);
      const key = `listings/${LISTING}/scans/${SCAN}/${kind}.${kind === "video" ? "mp4" : "json"}`;
      const target: ScanUploadTarget =
        kind === "video"
          ? { kind, key, uploadId: "up-1", partSizeBytes: PART, maxParts: 256, maxBytes: 1 << 30 }
          : { kind, key, uploadUrl: `put:${key}`, expiresInSeconds: 300, maxBytes: 1 << 20 };
      return target;
    },
    async partUrl(key, uploadId, partNumber) {
      calls.push(`partUrl:${partNumber}`);
      return { uploadUrl: `put:${key}#${uploadId}#${partNumber}` };
    },
    async uploadedParts() {
      calls.push("uploadedParts");
      return (opts.existingParts ?? []).map((partNumber) => ({ partNumber, sizeBytes: PART }));
    },
    async put(url, body) {
      const partNumber = Number(url.split("#")[2] ?? "0");
      if (partNumber === opts.failPart && failuresLeft > 0) {
        failuresLeft -= 1;
        calls.push(`put:${url}:fail`);
        throw new Error("network");
      }
      calls.push(`put:${url}:${body.size}`);
      puts.set(url, body);
    },
    async finish(key, uploadId) {
      calls.push(`finish:${uploadId}`);
      return { key, sizeBytes: 0 };
    },
    async complete(videoKey) {
      calls.push(`complete:${videoKey}`);
      return done;
    },
  };
  return { transport, calls, puts };
}

const noSleep = async () => {};

describe("planParts", () => {
  it("covers the blob in numbered contiguous parts", () => {
    expect(planParts(0, PART)).toEqual([{ partNumber: 1, start: 0, end: 0 }]);
    expect(planParts(PART, PART)).toEqual([{ partNumber: 1, start: 0, end: PART }]);
    expect(planParts(PART * 2 + 10, PART)).toEqual([
      { partNumber: 1, start: 0, end: PART },
      { partNumber: 2, start: PART, end: PART * 2 },
      { partNumber: 3, start: PART * 2, end: PART * 2 + 10 },
    ]);
  });
});

describe("what leaves the phone", () => {
  it("the attestation is samples and clocks, rounded, with no verdict-shaped key", () => {
    const attestation = buildAttestation(walk());
    expect(attestation).toEqual({
      version: 1,
      scanId: SCAN,
      listingId: LISTING,
      policyVersion: 1,
      recording: { startedAt: "2026-09-14T23:30:00Z", durationMs: 240_000, mimeType: "video/mp4" },
      samples: [{ t: 0, lat: 1, lng: 2, acc: 5 }],
      pauses: [{ fromMs: 10, toMs: 21 }],
      client: { userAgent: "UA", platform: null },
    });
    expect(JSON.stringify(attestation)).not.toMatch(/verif|fence|atHome|proof/i);
  });

  it("the notes carry device facts and never a location", () => {
    const notes = buildNotes(walk());
    expect(notes).toMatchObject({ version: 1, scanId: SCAN, videoWidth: 1920, videoHeight: 1080 });
    expect(JSON.stringify(notes)).not.toMatch(/"lat"|"lng"|verif/i);
  });
});

describe("uploadWalk", () => {
  it("sends video parts, then the record, then the notes, then asks for the verdict", async () => {
    const { transport, calls } = fakeTransport();
    const result = await uploadWalk(transport, walk(), { sleep: noSleep });
    expect(result.scan.state).toBe("uploaded");
    expect(calls).toEqual([
      "target:video:video/mp4",
      "uploadedParts",
      "partUrl:1",
      `put:put:listings/${LISTING}/scans/${SCAN}/video.mp4#up-1#1:${PART}`,
      "partUrl:2",
      `put:put:listings/${LISTING}/scans/${SCAN}/video.mp4#up-1#2:${PART}`,
      "partUrl:3",
      `put:put:listings/${LISTING}/scans/${SCAN}/video.mp4#up-1#3:10`,
      "finish:up-1",
      "target:attestation:application/json",
      `put:put:listings/${LISTING}/scans/${SCAN}/attestation.json:${new Blob([JSON.stringify(buildAttestation(walk()))]).size}`,
      "target:notes:application/json",
      `put:put:listings/${LISTING}/scans/${SCAN}/notes.json:${new Blob([JSON.stringify(buildNotes(walk()))]).size}`,
      `complete:listings/${LISTING}/scans/${SCAN}/video.mp4`,
    ]);
    expect(result.session.video?.finished).toBe(true);
  });

  it("retries a dropped part, then reports the part and leaves the session resumable", async () => {
    const { transport, calls } = fakeTransport({ failPart: 2, failTimes: 5 });
    const session: UploadSession = {};
    await expect(uploadWalk(transport, walk(), { session, sleep: noSleep, maxAttempts: 3 })).rejects.toMatchObject({
      name: "UploadError",
      kind: "video",
      partNumber: 2,
    });
    expect(calls.filter((c) => c.endsWith(":fail"))).toHaveLength(3);
    expect(calls.some((c) => c.startsWith("complete:"))).toBe(false);
    expect(session.video).toEqual({ key: `listings/${LISTING}/scans/${SCAN}/video.mp4`, uploadId: "up-1", finished: false });
  });

  it("resumes from the parts the bucket already holds and does not start a new upload", async () => {
    const { transport, calls } = fakeTransport({ existingParts: [1, 2] });
    const session: UploadSession = {
      video: { key: `listings/${LISTING}/scans/${SCAN}/video.mp4`, uploadId: "up-1", finished: false },
    };
    const progress: number[] = [];
    const result = await uploadWalk(transport, walk(), {
      session,
      sleep: noSleep,
      onProgress: (rows) => progress.push(rows[0]?.doneBytes ?? -1),
    });
    expect(result.scan.state).toBe("uploaded");
    expect(calls.filter((c) => c.startsWith("target:video"))).toHaveLength(0);
    expect(calls.filter((c) => c.startsWith("partUrl:"))).toEqual(["partUrl:3"]);
    // Progress started from what was already there.
    expect(progress.some((bytes) => bytes === PART * 2)).toBe(true);
  });

  it("surfaces a refused JSON object as its own kind", async () => {
    const { transport } = fakeTransport();
    const failing: UploadTransport = {
      ...transport,
      async put(url, body, contentType) {
        if (contentType === "application/json") throw new Error("refused");
        return transport.put(url, body, contentType);
      },
    };
    await expect(uploadWalk(failing, walk(), { sleep: noSleep, maxAttempts: 2 })).rejects.toBeInstanceOf(UploadError);
    await expect(uploadWalk(failing, walk(), { sleep: noSleep, maxAttempts: 2 })).rejects.toMatchObject({ kind: "attestation" });
  });
});
