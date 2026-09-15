/**
 * HM-02 — moving a recorded walk to the bucket, and asking for the verdict.
 *
 * Three objects go up under the scan's prefix: the video (multipart, in
 * parts the server signs one at a time), the location record, and the camera
 * notes. Then one completion call, after which the server — never this file —
 * says whether the walk was at the home.
 *
 * Everything that touches the network is injected through `UploadTransport`
 * so the sequencing, the retries and the resume can be tested without a
 * browser. `UploadSession` remembers the keys and the multipart upload id, so
 * a second run after a dropped connection lists the parts the bucket already
 * holds and sends only the rest.
 */
import type { ListingScan, ScanAttestation, ScanUploadKind, ScanUploadTarget, ScanUploadedPart } from "./types";

export type UploadTransport = {
  target(kind: ScanUploadKind, contentType: string): Promise<ScanUploadTarget>;
  partUrl(key: string, uploadId: string, partNumber: number): Promise<{ uploadUrl: string }>;
  uploadedParts(key: string, uploadId: string): Promise<ScanUploadedPart[]>;
  put(uploadUrl: string, body: Blob, contentType?: string): Promise<void>;
  finish(key: string, uploadId: string): Promise<{ key: string; sizeBytes: number }>;
  complete(videoKey: string): Promise<ListingScan>;
};

export type UploadRowStatus = "waiting" | "preparing" | "uploading" | "done" | "failed";

export type UploadProgress = {
  kind: ScanUploadKind;
  status: UploadRowStatus;
  doneBytes: number;
  totalBytes: number;
};

export type UploadPhase = "uploading" | "checking" | "done";

/** What survives a dropped connection within the page: keys and the upload id. */
export type UploadSession = {
  video?: { key: string; uploadId: string; finished: boolean };
  attestation?: { key: string; done: boolean };
  notes?: { key: string; done: boolean };
};

export type WalkForUpload = {
  scanId: string;
  listingId: string;
  policyVersion: number;
  blob: Blob;
  mimeType: string;
  startedAt: string;
  durationMs: number;
  samples: { t: number; lat: number; lng: number; acc: number }[];
  pauses: { fromMs: number; toMs: number }[];
  client: { userAgent: string; platform: string | null; videoWidth?: number; videoHeight?: number };
};

export class UploadError extends Error {
  readonly kind: ScanUploadKind | "complete";
  readonly partNumber: number | null;
  constructor(kind: ScanUploadKind | "complete", message: string, partNumber: number | null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "UploadError";
    this.kind = kind;
    this.partNumber = partNumber;
  }
}

/** Exactly the schema the server reads. No verdict, no fence result, no "at home". */
export function buildAttestation(walk: WalkForUpload): ScanAttestation {
  return {
    version: 1,
    scanId: walk.scanId,
    listingId: walk.listingId,
    policyVersion: walk.policyVersion,
    recording: {
      startedAt: walk.startedAt,
      durationMs: Math.round(walk.durationMs),
      mimeType: walk.mimeType,
    },
    samples: walk.samples.map((s) => ({ t: Math.round(s.t), lat: s.lat, lng: s.lng, acc: s.acc })),
    pauses: walk.pauses.map((p) => ({ fromMs: Math.round(p.fromMs), toMs: Math.round(p.toMs) })),
    client: { userAgent: walk.client.userAgent, platform: walk.client.platform },
  };
}

/** Device facts the worker may find useful. Never a location, never a verdict. */
export function buildNotes(walk: WalkForUpload): Record<string, unknown> {
  return {
    version: 1,
    scanId: walk.scanId,
    mimeType: walk.mimeType,
    videoWidth: walk.client.videoWidth ?? null,
    videoHeight: walk.client.videoHeight ?? null,
    durationMs: Math.round(walk.durationMs),
    userAgent: walk.client.userAgent,
    platform: walk.client.platform,
  };
}

export type PartPlan = { partNumber: number; start: number; end: number };

/** Contiguous parts of `partSize`, numbered from 1. An empty blob is one empty part. */
export function planParts(totalBytes: number, partSize: number): PartPlan[] {
  if (partSize <= 0) throw new Error("partSize must be positive");
  const plan: PartPlan[] = [];
  if (totalBytes <= 0) return [{ partNumber: 1, start: 0, end: 0 }];
  for (let start = 0, n = 1; start < totalBytes; start += partSize, n += 1) {
    plan.push({ partNumber: n, start, end: Math.min(start + partSize, totalBytes) });
  }
  return plan;
}

export type UploadOptions = {
  maxAttempts?: number;
  /** Delay before attempt n (1-based) after a failure; default 500 ms doubling. */
  backoffMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (rows: UploadProgress[], phase: UploadPhase) => void;
  session?: UploadSession;
};

async function withRetries<T>(
  work: () => Promise<T>,
  attempts: number,
  backoffMs: (attempt: number) => number,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (err) {
      last = err;
      if (attempt < attempts) await sleep(backoffMs(attempt));
    }
  }
  throw last;
}

/**
 * Run (or resume) the whole upload, then complete. Throws `UploadError` on a
 * part that would not go after `maxAttempts`, with `session` left in a state
 * a second call can resume from. The returned scan is the server's verdict.
 */
export async function uploadWalk(
  transport: UploadTransport,
  walk: WalkForUpload,
  options: UploadOptions = {},
): Promise<{ scan: ListingScan; session: UploadSession }> {
  const attempts = options.maxAttempts ?? 3;
  const backoff = options.backoffMs ?? ((attempt) => 500 * 2 ** (attempt - 1));
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const session: UploadSession = options.session ?? {};

  const attestationBlob = new Blob([JSON.stringify(buildAttestation(walk))], { type: "application/json" });
  const notesBlob = new Blob([JSON.stringify(buildNotes(walk))], { type: "application/json" });

  const rows: Record<ScanUploadKind, UploadProgress> = {
    video: { kind: "video", status: "waiting", doneBytes: 0, totalBytes: walk.blob.size },
    attestation: { kind: "attestation", status: "waiting", doneBytes: 0, totalBytes: attestationBlob.size },
    notes: { kind: "notes", status: "waiting", doneBytes: 0, totalBytes: notesBlob.size },
  };
  const report = (phase: UploadPhase) =>
    options.onProgress?.([rows.video, rows.attestation, rows.notes], phase);

  // --- video ------------------------------------------------------------
  if (!session.video?.finished) {
    rows.video.status = "preparing";
    report("uploading");
    // Resuming re-derives the part size from the parts already there; a
    // fresh upload takes the server's.
    let partSize = 8 * 1024 * 1024;
    if (!session.video) {
      const target = await transport.target("video", walk.mimeType);
      if (target.kind !== "video") throw new UploadError("video", "Unexpected upload target", null);
      session.video = { key: target.key, uploadId: target.uploadId, finished: false };
      partSize = target.partSizeBytes;
    }
    const video = session.video;
    const already = new Map((await transport.uploadedParts(video.key, video.uploadId)).map((p) => [p.partNumber, p]));
    if (already.size > 0) {
      const first = already.get(1);
      if (first && first.sizeBytes > 0) partSize = first.sizeBytes;
    }
    const plan = planParts(walk.blob.size, partSize);
    rows.video.status = "uploading";
    rows.video.doneBytes = plan.filter((p) => already.has(p.partNumber)).reduce((sum, p) => sum + (p.end - p.start), 0);
    report("uploading");

    for (const part of plan) {
      if (already.has(part.partNumber)) continue;
      const slice = walk.blob.slice(part.start, part.end, walk.mimeType);
      try {
        await withRetries(
          async () => {
            const { uploadUrl } = await transport.partUrl(video.key, video.uploadId, part.partNumber);
            await transport.put(uploadUrl, slice);
          },
          attempts,
          backoff,
          sleep,
        );
      } catch (err) {
        rows.video.status = "failed";
        report("uploading");
        throw new UploadError("video", "The upload lost connection.", part.partNumber, err);
      }
      rows.video.doneBytes += part.end - part.start;
      report("uploading");
    }
    await withRetries(() => transport.finish(video.key, video.uploadId), attempts, backoff, sleep).catch((err) => {
      rows.video.status = "failed";
      report("uploading");
      throw new UploadError("video", "The upload lost connection.", null, err);
    });
    video.finished = true;
  }
  rows.video.status = "done";
  rows.video.doneBytes = rows.video.totalBytes;
  report("uploading");

  // --- the two JSON objects ------------------------------------------------
  for (const [kind, blob] of [
    ["attestation", attestationBlob],
    ["notes", notesBlob],
  ] as const) {
    const row = rows[kind];
    if (session[kind]?.done) {
      row.status = "done";
      row.doneBytes = row.totalBytes;
      continue;
    }
    row.status = "uploading";
    report("uploading");
    try {
      await withRetries(
        async () => {
          const target = await transport.target(kind, "application/json");
          if (target.kind === "video") throw new UploadError(kind, "Unexpected upload target", null);
          session[kind] = { key: target.key, done: false };
          await transport.put(target.uploadUrl, blob, "application/json");
        },
        attempts,
        backoff,
        sleep,
      );
    } catch (err) {
      row.status = "failed";
      report("uploading");
      throw new UploadError(kind, "The upload lost connection.", null, err);
    }
    session[kind] = { key: session[kind]?.key ?? "", done: true };
    row.status = "done";
    row.doneBytes = row.totalBytes;
    report("uploading");
  }

  // --- the verdict is the server's ------------------------------------------
  report("checking");
  const scan = await transport.complete(session.video.key);
  report("done");
  return { scan, session };
}
