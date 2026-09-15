/**
 * HM-02 — the upload package for a walk-scan.
 *
 * Four small steps, all owner-only and all refused once the scan has left
 * `capturing`:
 *
 *   POST /:id/scans/:scanId/uploads          where a part of the package goes
 *   POST /:id/scans/:scanId/uploads/parts    a signed PUT for one video part
 *   GET  /:id/scans/:scanId/uploads/parts    which parts the bucket already holds
 *   POST /:id/scans/:scanId/uploads/finish   assemble the video from its parts
 *   POST /:id/scans/:scanId/complete         judge the package, record it
 *
 * HM-03 adds the host's side of reconstruction:
 *
 *   POST /:id/scans/:scanId/retry            failed → uploaded while attempts remain
 *   GET  /:id/scans/:scanId/stills           signed URLs to real frames, with their moments
 *
 * HM-04 adds what guests may walk through:
 *
 *   POST /:id/scans/:scanId/mask             the host's marks, or whole-home
 *   POST /:id/scans/:scanId/send             needs_mask → verified, or a crop job
 *
 * Completion is where the verdict happens: the server reads the location
 * record from the bucket, judges it against the row's frozen target and
 * thresholds, and calls app.complete_scan_upload. No transaction is held
 * across a bucket call (CLAUDE.md): load, talk to the bucket, then write.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { HONESTY_REFUSALS, MASK_COPY, SCAN_REASON_COPY } from "../../src/lib/honestyCopy";
import type { ListingScan, ScanMask, ScanStills, ScanUploadTarget, ScanUploadedPart } from "../../src/lib/types";
import { coversWholeWalk, mergeSegments, stillAtMs, MAX_MASK_SEGMENTS } from "../../src/lib/scanMask";
import { capturedOnFor, parseAttestation } from "../lib/attestation";
import { scanRejectedEmail, scanStatusUrl, scanVerifiedEmail, sendEmail } from "../lib/email";
import { distanceMetres, judgeWalk, sanitizeSamples } from "../lib/geofence";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import {
  canonicalContentType,
  completeMultipartUpload,
  createMultipartUpload,
  getObjectText,
  headObject,
  isVideoKeyFor,
  listUploadedParts,
  maxBytesFor,
  presignGetObject,
  presignPutObject,
  presignUploadPart,
  SCAN_MAX_ATTESTATION_BYTES,
  SCAN_MAX_PARTS,
  SCAN_MAX_STILLS,
  SCAN_PART_SIZE_BYTES,
  SCAN_URL_TTL_SECONDS,
  scanObjectKey,
  validPartNumber,
} from "../lib/scanStorage";
import { pgCode, pgMessage } from "../lib/pgError";
import { StorageError, storageConfigured } from "../lib/storage";
import {
  completeScanUpload,
  getScanForOwner,
  getScanTarget,
  retryScanReconstruction,
  saveScanMask,
  scanNotice,
  sendScanForVerification,
  type OwnedScan,
} from "../queries/scans";

export const scanRoutes = new Hono<AppEnv>();

const uploadSchema = z.object({
  kind: z.enum(["video", "attestation", "notes"]),
  contentType: z.string().min(1).max(100),
});

const partSchema = z.object({
  key: z.string().min(1).max(500),
  uploadId: z.string().min(1).max(2048),
  partNumber: z.number().int(),
});

const finishSchema = z.object({
  key: z.string().min(1).max(500),
  uploadId: z.string().min(1).max(2048),
});

const completeSchema = z.object({
  videoKey: z.string().min(1).max(500),
});

async function parse<T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be JSON" });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? "Those details are not valid" });
  }
  return parsed.data as z.infer<T>;
}

function requireStorage() {
  if (!storageConfigured()) {
    throw new HTTPException(503, { message: HONESTY_REFUSALS.storageNotConfigured });
  }
}

/** The caller's scan on the caller's listing, still capturing. */
async function capturingScan(c: Parameters<typeof tenantQuery>[0]): Promise<{ owned: OwnedScan; hostId: string }> {
  const host = sessionUser(c);
  const listingId = c.req.param("id") as string;
  const scanId = c.req.param("scanId") as string;
  const owned = await tenantQuery(c, (tx) => getScanForOwner(tx, host.id, listingId, scanId));
  if (!owned) throw new HTTPException(404, { message: "No scan of yours here" });
  if (owned.scan.state !== "capturing") {
    throw new HTTPException(409, { message: HONESTY_REFUSALS.alreadySubmitted });
  }
  return { owned, hostId: host.id };
}

function videoKeyOrRefuse(listingId: string, scanId: string, key: string): void {
  if (!isVideoKeyFor(listingId, scanId, key)) {
    throw new HTTPException(400, { message: "That upload does not belong to this scan" });
  }
}

async function bucket<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof StorageError) throw new HTTPException(400, { message: err.message });
    throw new HTTPException(502, { message: "The storage service didn't respond. Try again." });
  }
}

scanRoutes.post("/:id/scans/:scanId/uploads", async (c) => {
  requireStorage();
  const { kind, contentType } = await parse(c, uploadSchema);
  const { owned } = await capturingScan(c);
  const listingId = owned.listingId;
  const scanId = owned.scan.id;

  let key: string;
  let stored: string;
  try {
    key = scanObjectKey(listingId, scanId, kind, contentType);
    stored = canonicalContentType(kind, contentType);
  } catch (err) {
    if (err instanceof StorageError) throw new HTTPException(400, { message: err.message });
    throw err;
  }

  if (kind === "video") {
    const uploadId = await bucket(() => createMultipartUpload(key, stored));
    const target: ScanUploadTarget = {
      kind,
      key,
      uploadId,
      partSizeBytes: SCAN_PART_SIZE_BYTES,
      maxParts: SCAN_MAX_PARTS,
      maxBytes: maxBytesFor(kind),
    };
    return c.json(target);
  }
  const signed = await bucket(() => presignPutObject(key, stored));
  const target: ScanUploadTarget = { kind, key, ...signed, maxBytes: maxBytesFor(kind) };
  return c.json(target);
});

scanRoutes.post("/:id/scans/:scanId/uploads/parts", async (c) => {
  requireStorage();
  const { key, uploadId, partNumber } = await parse(c, partSchema);
  const { owned } = await capturingScan(c);
  videoKeyOrRefuse(owned.listingId, owned.scan.id, key);
  if (!validPartNumber(partNumber)) {
    throw new HTTPException(400, { message: `Part numbers run from 1 to ${SCAN_MAX_PARTS}` });
  }
  return c.json(await bucket(() => presignUploadPart(key, uploadId, partNumber)));
});

scanRoutes.get("/:id/scans/:scanId/uploads/parts", async (c) => {
  requireStorage();
  const key = c.req.query("key") ?? "";
  const uploadId = c.req.query("uploadId") ?? "";
  if (!key || !uploadId) throw new HTTPException(400, { message: "key and uploadId are required" });
  const { owned } = await capturingScan(c);
  videoKeyOrRefuse(owned.listingId, owned.scan.id, key);
  const parts = await bucket(() => listUploadedParts(key, uploadId));
  const body: { parts: ScanUploadedPart[] } = {
    parts: parts.map((p) => ({ partNumber: p.partNumber, sizeBytes: p.sizeBytes })),
  };
  return c.json(body);
});

scanRoutes.post("/:id/scans/:scanId/uploads/finish", async (c) => {
  requireStorage();
  const { key, uploadId } = await parse(c, finishSchema);
  const { owned } = await capturingScan(c);
  videoKeyOrRefuse(owned.listingId, owned.scan.id, key);
  const parts = await bucket(() => completeMultipartUpload(key, uploadId));
  return c.json({ key, sizeBytes: parts.reduce((sum, p) => sum + p.sizeBytes, 0) });
});

/**
 * Judge and record the package. Every refusal is a plain sentence from the
 * locked copy; the verdict itself is the server's, from the samples in the
 * uploaded record against the row's frozen target and thresholds.
 */
scanRoutes.post("/:id/scans/:scanId/complete", async (c) => {
  requireStorage();
  const { videoKey } = await parse(c, completeSchema);
  const { owned, hostId } = await capturingScan(c);
  const listingId = owned.listingId;
  const scanId = owned.scan.id;
  videoKeyOrRefuse(listingId, scanId, videoKey);

  const listing = await tenantQuery(c, (tx) => getScanTarget(tx, hostId, listingId));
  if (!listing) throw new HTTPException(404, { message: "No listing of yours here" });

  const attestationKey = scanObjectKey(listingId, scanId, "attestation", "application/json");
  const notesKey = scanObjectKey(listingId, scanId, "notes", "application/json");

  // Bucket reads happen outside any transaction.
  const [video, attestation, notes] = await bucket(() =>
    Promise.all([headObject(videoKey), headObject(attestationKey), headObject(notesKey)]),
  );
  if (!video || !attestation || !notes) {
    throw new HTTPException(409, { message: HONESTY_REFUSALS.uploadIncomplete });
  }
  if (
    video.sizeBytes > maxBytesFor("video") ||
    attestation.sizeBytes > maxBytesFor("attestation") ||
    notes.sizeBytes > maxBytesFor("notes")
  ) {
    throw new HTTPException(409, { message: HONESTY_REFUSALS.uploadTooLarge });
  }

  const text = await bucket(() => getObjectText(attestationKey, SCAN_MAX_ATTESTATION_BYTES));
  const parsed = parseAttestation(text);
  if (!parsed.ok || parsed.attestation.scanId !== scanId || parsed.attestation.listingId !== listingId) {
    throw new HTTPException(400, { message: HONESTY_REFUSALS.attestationUnreadable });
  }
  const att = parsed.attestation;

  const verdict = judgeWalk(att.samples, owned.target, owned.thresholds);
  const samples = sanitizeSamples(att.samples).map((s, seq) => ({
    seq,
    tMs: Math.round(s.t),
    lat: s.lat,
    lng: s.lng,
    accuracyM: Math.round(s.acc),
    accurate: s.acc <= owned.thresholds.accuracyMaxM,
    distanceM: distanceMetres(s, owned.target),
  }));

  const done = await tenantQuery(c, (tx) =>
    completeScanUpload(tx, {
      scanId,
      ok: verdict.ok,
      reason: verdict.ok ? null : verdict.reason,
      capturedOn: capturedOnFor(att.recording.startedAt, listing.timezone),
      stats: verdict.stats,
      artifacts: [
        { kind: "video", objectKey: videoKey, contentType: video.contentType || "video/mp4", sizeBytes: video.sizeBytes },
        { kind: "attestation", objectKey: attestationKey, contentType: "application/json", sizeBytes: attestation.sizeBytes },
        { kind: "notes", objectKey: notesKey, contentType: "application/json", sizeBytes: notes.sizeBytes },
      ],
      samples,
    }),
  );
  if (!done) throw new HTTPException(409, { message: HONESTY_REFUSALS.alreadySubmitted });

  const after = await tenantQuery(c, (tx) => getScanForOwner(tx, hostId, listingId, scanId));
  if (!after) throw new HTTPException(404, { message: "No scan of yours here" });
  const scan: ListingScan = after.scan;

  // HM-03 (D14): a rejection is a terminal state, so the host gets the one
  // email for it — after the transaction, and never blocking the receipt.
  if (!verdict.ok) {
    const notice = await tenantQuery(c, (tx) => scanNotice(tx, scanId));
    if (notice) {
      await sendEmail({
        to: notice.hostEmail,
        ...scanRejectedEmail({
          listingTitle: notice.listingTitle,
          statusUrl: scanStatusUrl(listingId),
          reason: SCAN_REASON_COPY[verdict.reason],
        }),
      });
    }
  }
  return c.json(scan);
});

// ---------------------------------------------------------------- HM-03 -----

/**
 * Try processing again: failed → uploaded, the same footage, while attempts
 * remain. The function re-checks the caller, the state and the cap; the two
 * 409s here are the friendly versions of its refusal.
 */
scanRoutes.post("/:id/scans/:scanId/retry", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const scanId = c.req.param("scanId");
  const result = await tenantQuery(c, async (tx) => {
    const owned = await getScanForOwner(tx, host.id, listingId, scanId);
    if (!owned) return { kind: "missing" as const };
    if (owned.scan.state !== "failed") return { kind: "not_failed" as const };
    if (owned.scan.attempt >= owned.scan.maxAttempts) {
      return { kind: "exhausted" as const, attempts: owned.scan.attempt };
    }
    const ok = await retryScanReconstruction(tx, scanId, owned.scan.maxAttempts);
    if (!ok) return { kind: "not_failed" as const };
    const after = await getScanForOwner(tx, host.id, listingId, scanId);
    return after ? { kind: "queued" as const, scan: after.scan } : { kind: "missing" as const };
  });
  if (result.kind === "missing") throw new HTTPException(404, { message: "No scan of yours here" });
  if (result.kind === "not_failed") throw new HTTPException(409, { message: HONESTY_REFUSALS.retryNotFailed });
  if (result.kind === "exhausted") {
    throw new HTTPException(409, { message: HONESTY_REFUSALS.retryExhausted(result.attempts) });
  }
  const scan: ListingScan = result.scan;
  return c.json(scan);
});

/**
 * Frames the worker saved from the walk, as short-lived signed URLs. Real
 * captured frames only — the worker has no step that could make any other
 * kind. Owner only; an empty list is honest when the worker saved none.
 */
scanRoutes.get("/:id/scans/:scanId/stills", async (c) => {
  requireStorage();
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const scanId = c.req.param("scanId");
  const owned = await tenantQuery(c, (tx) => getScanForOwner(tx, host.id, listingId, scanId));
  if (!owned) throw new HTTPException(404, { message: "No scan of yours here" });
  const keys = owned.stillsKeys.slice(0, SCAN_MAX_STILLS);
  const signed = await bucket(() => Promise.all(keys.map((key) => presignGetObject(key))));
  const body: ScanStills = {
    stills: signed.map((s, index) => ({
      index,
      url: s.url,
      atMs: stillAtMs(index, signed.length, owned.durationMs),
    })),
    expiresInSeconds: SCAN_URL_TTL_SECONDS,
    durationMs: owned.durationMs,
  };
  return c.json(body);
});

// ---------------------------------------------------------------- HM-04 -----

const maskSchema = z.union([
  z.object({ wholeHomeConfirmed: z.literal(true) }),
  z.object({
    wholeHomeConfirmed: z.literal(false).optional(),
    segments: z
      .array(z.object({ fromMs: z.number().int().nonnegative(), toMs: z.number().int().positive() }))
      .max(MAX_MASK_SEGMENTS),
  }),
]);

/** The caller's scan on the caller's listing, still waiting to be marked. */
async function markableScan(c: Parameters<typeof tenantQuery>[0]): Promise<{ owned: OwnedScan; hostId: string }> {
  const host = sessionUser(c);
  const listingId = c.req.param("id") as string;
  const scanId = c.req.param("scanId") as string;
  const owned = await tenantQuery(c, (tx) => getScanForOwner(tx, host.id, listingId, scanId));
  if (!owned) throw new HTTPException(404, { message: "No scan of yours here" });
  if (owned.scan.state !== "needs_mask") {
    throw new HTTPException(409, { message: HONESTY_REFUSALS.maskNotReady });
  }
  return { owned, hostId: host.id };
}

/**
 * What guests may walk through. Segments are normalised here — clamped to the
 * recording, merged, sorted — so the stored answer is the one the worker will
 * act on, and two equal masks compare equal. Marking everything private is
 * refused: a walkthrough of nothing is not a walkthrough.
 */
scanRoutes.post("/:id/scans/:scanId/mask", async (c) => {
  // Who before what: a stranger gets 401 or 404, never a note on their body.
  const { owned, hostId } = await markableScan(c);
  const body = await parse(c, maskSchema);

  const wholeHomeConfirmed = body.wholeHomeConfirmed === true;
  if (wholeHomeConfirmed && !owned.scan.wholeHomeAllowed) {
    throw new HTTPException(400, { message: HONESTY_REFUSALS.maskPrivateRoomWholeHome });
  }
  const segments = wholeHomeConfirmed ? [] : mergeSegments(body.segments ?? [], owned.durationMs);
  if (!wholeHomeConfirmed && coversWholeWalk(segments, owned.durationMs)) {
    throw new HTTPException(400, { message: HONESTY_REFUSALS.maskAllPrivate });
  }

  const saved = await tenantQuery(c, (tx) =>
    saveScanMask(tx, { scanId: owned.scan.id, hostId, segments, wholeHomeConfirmed }),
  );
  if (!saved) throw new HTTPException(409, { message: HONESTY_REFUSALS.maskNotReady });
  const mask: ScanMask = saved;
  return c.json(mask);
});

/**
 * Send it. With nothing marked private there is nothing to cut, so the walk
 * the host just reviewed is verified as it stands; with marks, the worker
 * rebuilds it without those frames and verifies that. Either way the state
 * comes back from the server, and the host is emailed after the commit.
 */
scanRoutes.post("/:id/scans/:scanId/send", async (c) => {
  const { owned } = await markableScan(c);
  const listingId = owned.listingId;
  const scanId = owned.scan.id;

  const answered = owned.scan.mask?.wholeHomeConfirmedAt || (owned.scan.mask?.segments.length ?? 0) > 0;
  if (!answered) throw new HTTPException(409, { message: HONESTY_REFUSALS.maskNothingMarked });

  let sent;
  try {
    sent = await tenantQuery(c, (tx) => sendScanForVerification(tx, scanId));
  } catch (err) {
    if (pgCode(err) === "P0001") {
      const message = pgMessage(err);
      if (/whole walk is marked private/.test(message)) {
        throw new HTTPException(400, { message: HONESTY_REFUSALS.maskAllPrivate });
      }
      if (/private room/.test(message)) {
        throw new HTTPException(400, { message: HONESTY_REFUSALS.maskPrivateRoomWholeHome });
      }
      throw new HTTPException(409, { message: HONESTY_REFUSALS.maskNothingMarked });
    }
    throw err;
  }
  if (!sent) throw new HTTPException(409, { message: HONESTY_REFUSALS.maskNotReady });

  // After the transaction has committed, never inside it (CLAUDE.md).
  if (sent.state === "verified") {
    await sendEmail({
      to: sent.hostEmail,
      ...scanVerifiedEmail({
        listingTitle: sent.listingTitle,
        statusUrl: scanStatusUrl(listingId),
        coverage: MASK_COPY.summaryWhole,
      }),
    });
  }

  const after = await tenantQuery(c, (tx) => getScanForOwner(tx, sessionUser(c).id, listingId, scanId));
  if (!after) throw new HTTPException(404, { message: "No scan of yours here" });
  const scan: ListingScan = after.scan;
  return c.json(scan);
});
