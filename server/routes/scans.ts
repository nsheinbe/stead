/**
 * Honesty scan routes (HM-01, HM-02): the hub, starting a walk, recording its
 * location record, discarding an unfinished one, and the upload of a located
 * walk. All owner-only.
 *
 * The verdict is computed here, on the server, from the raw samples the phone
 * sends — never taken from the client — and stored through a SECURITY DEFINER
 * function. The response is the hub DTO, so the browser only ever displays
 * what the server decided. Video does not pass through here at all: the
 * recording goes from the phone to the bucket on presigned URLs, and the
 * server's receipt for each part is a HEAD on the object.
 */
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { judgeWalk } from "../lib/geofence";
import { sessionUser, tenantQuery, type AppEnv } from "../lib/http";
import {
  headObjectSize,
  presignScanPartUpload,
  putJsonObject,
  scanManifestKey,
  scanVideoPartKey,
  storageConfigured,
  StorageError,
  videoBaseType,
} from "../lib/storage";
import { getConfigMap } from "../queries/listings";
import {
  completeScanUpload,
  confirmScanPart,
  declareScanUpload,
  discardScan,
  getHostScan,
  getScanForJudging,
  isUploadInProgressError,
  listScanUploadParts,
  markScanPartsPresigned,
  recordScanLocation,
  startListingScan,
  uploadLimitsFromConfig,
  type DeclaredPart,
} from "../queries/scans";
import { HM, HONESTY_POLICY_VERSION } from "../../src/lib/honesty";

export const scanRoutes = new Hono<AppEnv>();

const NOT_YOURS = "No listing of yours here";

const startSchema = z.object({
  policyVersion: z.string().trim().min(1).max(40),
  // The sheet's checkbox, as a fact the server insists on rather than trusts.
  acknowledged: z.literal(true),
});

const sampleSchema = z.object({
  recordedAt: z.string().datetime({ offset: true }),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyMeters: z.number().int().min(0).max(100_000),
  phase: z.enum(["outdoor_start", "indoor", "outdoor_end"]),
});

// A 20-minute walk at one reading a second is ~1,200 samples; the cap is a
// body-size guard, not a product limit.
const locationSchema = z.object({
  samples: z.array(sampleSchema).max(20_000),
});

async function parse<T extends z.ZodTypeAny>(
  c: { req: { json: () => Promise<unknown> } },
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be JSON" });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? "Those details are not valid",
    });
  }
  return parsed.data as z.infer<T>;
}

scanRoutes.get("/:id/scan", async (c) => {
  const host = sessionUser(c);
  const hub = await tenantQuery(c, (tx) =>
    getHostScan(tx, host.id, c.req.param("id"), HONESTY_POLICY_VERSION),
  );
  if (!hub) throw new HTTPException(404, { message: NOT_YOURS });
  return c.json(hub);
});

scanRoutes.post("/:id/scan", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const input = await parse(c, startSchema);

  // An acknowledgment of an older policy is not an acknowledgment of this one.
  if (input.policyVersion !== HONESTY_POLICY_VERSION) {
    throw new HTTPException(409, { message: HM["hm.sheet.policyChanged"] });
  }

  const hub = await tenantQuery(c, (tx) =>
    getHostScan(tx, host.id, listingId, HONESTY_POLICY_VERSION),
  );
  if (!hub) throw new HTTPException(404, { message: NOT_YOURS });
  if (!hub.listing.hasPin) throw new HTTPException(409, { message: HM["hm.pin.required"] });

  const scanId = await tenantQuery(c, (tx) => startListingScan(tx, listingId, input.policyVersion));
  if (!scanId) throw new HTTPException(404, { message: NOT_YOURS });

  const after = await tenantQuery(c, (tx) =>
    getHostScan(tx, host.id, listingId, HONESTY_POLICY_VERSION),
  );
  const scan = after?.scan?.id === scanId ? after.scan : null;
  if (!scan) throw new HTTPException(500, { message: "The walk could not be started" });

  return c.json({ scanId, policyVersion: scan.policyVersion, thresholds: scan.thresholds }, 201);
});

scanRoutes.post("/:id/scan/:scanId/location", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const scanId = c.req.param("scanId");
  const { samples } = await parse(c, locationSchema);

  const outcome = await tenantQuery(c, async (tx) => {
    const scan = await getScanForJudging(tx, host.id, listingId, scanId);
    if (!scan) return "missing" as const;
    if (scan.state !== "capturing" || scan.geofence !== "pending") return "closed" as const;
    const verdict = judgeWalk(scan.pin, samples, scan.thresholds);
    const stored = await recordScanLocation(tx, scanId, samples, verdict);
    return stored ? ("recorded" as const) : ("closed" as const);
  });

  if (outcome === "missing") throw new HTTPException(404, { message: NOT_YOURS });
  if (outcome === "closed") throw new HTTPException(409, { message: HM["hm.capture.notCurrent"] });

  const hub = await tenantQuery(c, (tx) =>
    getHostScan(tx, host.id, listingId, HONESTY_POLICY_VERSION),
  );
  if (!hub) throw new HTTPException(404, { message: NOT_YOURS });
  return c.json(hub);
});

scanRoutes.delete("/:id/scan/:scanId", async (c) => {
  sessionUser(c);
  const ok = await tenantQuery(c, (tx) =>
    discardScan(tx, c.req.param("id"), c.req.param("scanId")),
  );
  // Either not theirs, or already judged and so not theirs to throw away.
  if (!ok) throw new HTTPException(404, { message: "No walk of yours to delete here" });
  return c.json({ ok: true });
});

// ------------------------------------------------------------ HM-02 upload --
//
// The recording leaves the phone here, but never through this API: the
// browser PUTs video parts to the bucket on short-lived presigned URLs, and
// these routes only declare the package, hand out URLs for the server's own
// keys, take receipts by looking at the objects, and complete the package.
// Nothing a client says about bytes is trusted; the receipt is a HEAD.

/** How many parts one presign or confirm call may cover. Keeps the HEADs bounded. */
const UPLOAD_BATCH_MAX = 25;

const declareSchema = z.object({
  mimeType: z.string().trim().min(1).max(120),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  clientEnvironment: z
    .record(z.string().max(60), z.union([z.string().max(400), z.number(), z.boolean()]))
    .refine((env) => Object.keys(env).length <= 40, { message: "Too many environment facts" }),
  parts: z
    .array(z.object({ seq: z.number().int().min(0), bytes: z.number().int().min(1) }))
    .min(1)
    .max(10_000)
    // Parts are 0..n-1 in order, so the worker can concatenate by seq alone.
    .refine((parts) => parts.every((p, i) => p.seq === i), {
      message: "Parts must be numbered 0, 1, 2… in order",
    }),
});

const seqsSchema = z.object({
  seqs: z.array(z.number().int().min(0)).min(1).max(UPLOAD_BATCH_MAX),
});

/** The located walk this upload belongs to, or the HTTP reason it is not. */
async function locatedScan(c: Context<AppEnv>, hostId: string, listingId: string, scanId: string) {
  const scan = await tenantQuery(c, (tx) => getScanForJudging(tx, hostId, listingId, scanId));
  if (!scan) throw new HTTPException(404, { message: NOT_YOURS });
  if (scan.state !== "capturing" || scan.geofence !== "passed") {
    throw new HTTPException(409, { message: HM["hm.capture.notCurrent"] });
  }
  return scan;
}

function requireStorage() {
  if (!storageConfigured()) {
    throw new HTTPException(503, { message: HM["hm.upload.unconfigured.title"] });
  }
}

scanRoutes.post("/:id/scan/:scanId/upload", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const scanId = c.req.param("scanId");
  const input = await parse(c, declareSchema);

  let contentType: string;
  try {
    contentType = videoBaseType(input.mimeType);
  } catch (err) {
    if (err instanceof StorageError) throw new HTTPException(400, { message: err.message });
    throw err;
  }

  const limits = await tenantQuery(c, async (tx) => uploadLimitsFromConfig(await getConfigMap(tx)));
  const totalBytes = input.parts.reduce((sum, p) => sum + p.bytes, 0);
  if (
    input.parts.length > limits.maxParts ||
    input.parts.some((p) => p.bytes > limits.maxPartBytes) ||
    totalBytes > limits.maxUploadBytes
  ) {
    throw new HTTPException(413, { message: HM["hm.upload.tooLarge.title"] });
  }

  await locatedScan(c, host.id, listingId, scanId);

  const parts: DeclaredPart[] = input.parts.map((p) => ({
    seq: p.seq,
    bytes: p.bytes,
    key: scanVideoPartKey(listingId, scanId, p.seq, contentType),
    contentType,
  }));
  let declared: boolean;
  try {
    declared = await tenantQuery(c, (tx) =>
      declareScanUpload(tx, scanId, {
        mimeType: input.mimeType,
        durationMs: input.durationMs,
        clientEnvironment: input.clientEnvironment,
        parts,
      }),
    );
  } catch (err) {
    if (isUploadInProgressError(err)) {
      throw new HTTPException(409, {
        message: "An upload of a different recording is already under way for this walk",
      });
    }
    throw err;
  }
  if (!declared) throw new HTTPException(409, { message: HM["hm.capture.notCurrent"] });

  const stored = await tenantQuery(c, (tx) => listScanUploadParts(tx, scanId));
  return c.json({
    parts: stored.map((p) => ({ seq: p.seq, bytes: p.expectedBytes, confirmed: p.confirmedAt !== null })),
    limits,
  });
});

scanRoutes.post("/:id/scan/:scanId/upload/presign", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const scanId = c.req.param("scanId");
  const { seqs } = await parse(c, seqsSchema);
  requireStorage();

  await locatedScan(c, host.id, listingId, scanId);
  const parts = await tenantQuery(c, (tx) => listScanUploadParts(tx, scanId));
  const bySeq = new Map(parts.map((p) => [p.seq, p]));
  const wanted = [...new Set(seqs)].map((seq) => {
    const part = bySeq.get(seq);
    if (!part) throw new HTTPException(400, { message: `Part ${seq} was never declared` });
    return part;
  });

  // Signing is local; no network call inside a transaction.
  const uploads = await Promise.all(
    wanted
      .filter((p) => p.confirmedAt === null)
      .map(async (p) => {
        const signed = await presignScanPartUpload(p.objectKey, p.contentType);
        return {
          seq: p.seq,
          uploadUrl: signed.uploadUrl,
          contentType: p.contentType,
          expiresInSeconds: signed.expiresInSeconds,
        };
      }),
  );
  if (uploads.length > 0) {
    await tenantQuery(c, (tx) =>
      markScanPartsPresigned(tx, scanId, uploads.map((u) => u.seq)),
    );
  }
  return c.json({ uploads });
});

scanRoutes.post("/:id/scan/:scanId/upload/confirm", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const scanId = c.req.param("scanId");
  const { seqs } = await parse(c, seqsSchema);
  requireStorage();

  await locatedScan(c, host.id, listingId, scanId);
  const parts = await tenantQuery(c, (tx) => listScanUploadParts(tx, scanId));
  const bySeq = new Map(parts.map((p) => [p.seq, p]));
  const wanted = [...new Set(seqs)].map((seq) => {
    const part = bySeq.get(seq);
    if (!part) throw new HTTPException(400, { message: `Part ${seq} was never declared` });
    return part;
  });

  // The receipt is what is in the bucket. HEADs happen outside any
  // transaction; the confirmation is written afterwards, one part at a time,
  // and only where the size is exactly the declared one.
  const results: { seq: number; confirmed: boolean; bytes: number | null }[] = [];
  for (const part of wanted) {
    if (part.confirmedAt !== null) {
      results.push({ seq: part.seq, confirmed: true, bytes: part.confirmedBytes });
      continue;
    }
    const bytes = await headObjectSize(part.objectKey);
    const confirmed =
      bytes !== null && bytes === part.expectedBytes
        ? await tenantQuery(c, (tx) => confirmScanPart(tx, scanId, part.seq, bytes))
        : false;
    results.push({ seq: part.seq, confirmed, bytes });
  }
  return c.json({ results });
});

scanRoutes.post("/:id/scan/:scanId/upload/complete", async (c) => {
  const host = sessionUser(c);
  const listingId = c.req.param("id");
  const scanId = c.req.param("scanId");
  requireStorage();

  const scan = await locatedScan(c, host.id, listingId, scanId);
  const parts = await tenantQuery(c, (tx) => listScanUploadParts(tx, scanId));
  const unconfirmed = parts.filter((p) => p.confirmedAt === null || p.confirmedBytes !== p.expectedBytes);
  if (!scan.upload || parts.length !== scan.upload.partCount || unconfirmed.length > 0) {
    throw new HTTPException(409, {
      message: unconfirmed.length > 0
        ? `${unconfirmed.length} of ${parts.length} parts haven't arrived yet`
        : "Declare the upload before completing it",
    });
  }

  // The manifest is written by the server from what the server recorded —
  // the worker reads it, never a client-authored file. Samples stay in the
  // database; the manifest points at the scan, not the other way round.
  const manifestKey = scanManifestKey(listingId, scanId);
  await putJsonObject(manifestKey, {
    version: 1,
    scanId,
    listingId,
    policyVersion: scan.policyVersion,
    video: {
      mimeType: scan.upload.mimeType,
      contentType: parts[0]!.contentType,
      durationMs: scan.upload.durationMs,
      parts: parts.map((p) => ({ seq: p.seq, key: p.objectKey, bytes: p.expectedBytes })),
    },
    location: {
      geofence: "passed",
      sampleCount: scan.sampleCount,
      checkedAt: scan.locationCheckedAt,
    },
    createdAt: new Date().toISOString(),
  });

  const ok = await tenantQuery(c, (tx) => completeScanUpload(tx, scanId, manifestKey));
  if (!ok) throw new HTTPException(409, { message: HM["hm.capture.notCurrent"] });

  const hub = await tenantQuery(c, (tx) =>
    getHostScan(tx, host.id, listingId, HONESTY_POLICY_VERSION),
  );
  if (!hub) throw new HTTPException(404, { message: NOT_YOURS });
  return c.json(hub);
});
