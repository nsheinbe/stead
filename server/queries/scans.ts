/**
 * HM-01 / HM-02 / HM-03 — honesty scan reads and the writes a host may make.
 *
 * RLS is the enforcement: listing_scans_host_read scopes SELECT to the
 * caller's rows and listing_scans_host_start lets a host insert only a
 * `capturing` row for an owned, door-confirmed listing. The host_id filters
 * here mirror those policies so the intent reads locally; they are not what
 * makes it safe. Every state change is a SECURITY DEFINER function:
 * app.complete_scan_upload (HM-02) judges the upload, and HM-03 adds the
 * job transitions (claim, finish, retry, release) — each re-checks the
 * caller and the row's state itself.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { listingRentalMasks, listingScans, listings, scanArtifacts } from "../db/schema";
import type {
  GeofenceStatsJson,
  ListingScan,
  ListingType,
  MaskSegment,
  ScanJob,
  ScanJobArtifact,
  ScanMask,
  ScanReason,
  ScanThresholds,
  ScanUploadKind,
  ScanWorkerArtifactKind,
} from "../../src/lib/types";
import { getConfigMap, intFromConfig } from "./listings";

type ScanRow = typeof listingScans.$inferSelect;
type ArtifactRow = typeof scanArtifacts.$inferSelect;
type MaskRow = typeof listingRentalMasks.$inferSelect;

/** DECISIONS D11: a private room is partial by definition, so it must mark. */
export function wholeHomeAllowedFor(type: ListingType): boolean {
  return type !== "private_room";
}

/** The row plus what the DTO hides: the frozen target the walk is judged against. */
export type OwnedScan = {
  scan: ListingScan;
  target: { lat: number; lng: number };
  thresholds: ScanThresholds;
  listingId: string;
  /** HM-03: the worker's stills, in key order, for the failed-state page. */
  stillsKeys: string[];
  /** HM-04: how long the walk ran, from the stats the server wrote at completion. */
  durationMs: number;
  listingType: ListingType;
};

/** Reconstruction attempts a scan may use, from app_config (default 3). */
export async function scanMaxAttempts(tx: Tx): Promise<number> {
  return intFromConfig((await getConfigMap(tx)).scan_max_attempts, 3);
}

function thresholdsOf(row: ScanRow): ScanThresholds {
  return {
    accuracyMaxM: row.accuracyMaxM,
    geofenceRadiusM: row.geofenceRadiusM,
    bookendWindowSeconds: row.bookendWindowSeconds,
    bookendMinSamples: row.bookendMinSamples,
    minIndoorSeconds: row.minIndoorSeconds,
    maxSeconds: row.maxSeconds,
  };
}

function toMask(row: MaskRow | null | undefined): ScanMask | null {
  if (!row) return null;
  return {
    segments: row.segments ?? [],
    wholeHomeConfirmedAt: row.wholeHomeConfirmedAt ? row.wholeHomeConfirmedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** How long the walk ran, in milliseconds, from the stats written at completion. */
export function durationMsOf(stats: GeofenceStatsJson | null): number {
  return stats ? Math.round(stats.durationSeconds * 1000) : 0;
}

function toListingScan(
  row: ScanRow,
  artifacts: ArtifactRow[],
  maxAttempts: number,
  extra: { mask: MaskRow | null | undefined; listingType: ListingType },
): ListingScan {
  const has = (kind: ScanUploadKind | ScanWorkerArtifactKind) => artifacts.some((a) => a.kind === kind);
  return {
    id: row.id,
    state: row.state,
    reason: (row.reason as ScanReason | null) ?? null,
    policyVersion: row.honestyPolicyVersion,
    thresholds: thresholdsOf(row),
    capturedOn: row.capturedOn,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    uploads: { video: has("video"), attestation: has("attestation"), notes: has("notes") },
    stats: row.geofenceStats ?? null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    attempt: row.attempt,
    maxAttempts,
    canRetry: row.state === "failed" && row.attempt < maxAttempts,
    claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    outputs: {
      frames: has("frames"),
      cameras: has("cameras"),
      splat: has("splat"),
      splat_compressed: has("splat_compressed"),
      stills: has("stills"),
    },
    job: row.job,
    mask: toMask(extra.mask),
    wholeHomeAllowed: wholeHomeAllowedFor(extra.listingType),
  };
}

export type ScanTarget = {
  confirmed: boolean;
  lat: number | null;
  lng: number | null;
  timezone: string;
};

/** The listing's front door as the scan will be judged against it; null when not the caller's. */
export async function getScanTarget(
  tx: Tx,
  hostId: string,
  listingId: string,
): Promise<ScanTarget | null> {
  const row = await tx.query.listings.findFirst({
    where: and(eq(listings.id, listingId), eq(listings.hostId, hostId)),
    columns: { lat: true, lng: true, coordinatesConfirmedAt: true, timezone: true },
  });
  if (!row) return null;
  return {
    confirmed: row.coordinatesConfirmedAt !== null && row.lat !== null && row.lng !== null,
    lat: row.lat,
    lng: row.lng,
    timezone: row.timezone,
  };
}

/** The listing's own type, which decides whether whole-home is on offer (D11). */
async function listingTypeOf(tx: Tx, listingId: string): Promise<ListingType> {
  const row = await tx.query.listings.findFirst({
    where: eq(listings.id, listingId),
    columns: { type: true },
  });
  return row?.type ?? "entire_home";
}

export async function latestScanForOwner(
  tx: Tx,
  hostId: string,
  listingId: string,
): Promise<ListingScan | null> {
  const row = await tx.query.listingScans.findFirst({
    where: and(eq(listingScans.listingId, listingId), eq(listingScans.hostId, hostId)),
    orderBy: desc(listingScans.createdAt),
    with: { artifacts: true, mask: true },
  });
  if (!row) return null;
  return toListingScan(row, row.artifacts, await scanMaxAttempts(tx), {
    mask: row.mask,
    listingType: await listingTypeOf(tx, listingId),
  });
}

/** One scan by id, only if it belongs to this host and this listing. */
export async function getScanForOwner(
  tx: Tx,
  hostId: string,
  listingId: string,
  scanId: string,
): Promise<OwnedScan | null> {
  const row = await tx.query.listingScans.findFirst({
    where: and(
      eq(listingScans.id, scanId),
      eq(listingScans.listingId, listingId),
      eq(listingScans.hostId, hostId),
    ),
    with: { artifacts: true, mask: true },
  });
  if (!row) return null;
  const listingType = await listingTypeOf(tx, row.listingId);
  return {
    scan: toListingScan(row, row.artifacts, await scanMaxAttempts(tx), { mask: row.mask, listingType }),
    target: { lat: row.targetLat, lng: row.targetLng },
    thresholds: thresholdsOf(row),
    listingId: row.listingId,
    stillsKeys: row.artifacts
      .filter((a) => a.kind === "stills")
      .map((a) => a.objectKey)
      .sort(),
    durationMs: durationMsOf(row.geofenceStats ?? null),
    listingType,
  };
}

/**
 * Start a capture. The thresholds, target point and policy version are
 * frozen onto the row so a later config change never rewrites what this
 * walk is judged against.
 */
export async function createScan(
  tx: Tx,
  input: {
    hostId: string;
    listingId: string;
    thresholds: ScanThresholds;
    policyVersion: number;
    target: { lat: number; lng: number };
  },
): Promise<ListingScan> {
  const [created] = await tx
    .insert(listingScans)
    .values({
      listingId: input.listingId,
      hostId: input.hostId,
      state: "capturing",
      honestyPolicyVersion: input.policyVersion,
      accuracyMaxM: input.thresholds.accuracyMaxM,
      geofenceRadiusM: input.thresholds.geofenceRadiusM,
      bookendWindowSeconds: input.thresholds.bookendWindowSeconds,
      bookendMinSamples: input.thresholds.bookendMinSamples,
      minIndoorSeconds: input.thresholds.minIndoorSeconds,
      maxSeconds: input.thresholds.maxSeconds,
      targetLat: input.target.lat,
      targetLng: input.target.lng,
    })
    .returning();
  if (!created) throw new Error("Could not start the scan");
  return toListingScan(created, [], await scanMaxAttempts(tx), {
    mask: null,
    listingType: await listingTypeOf(tx, input.listingId),
  });
}

export type ArtifactRecord = {
  kind: ScanUploadKind;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
};

export type SampleRecord = {
  seq: number;
  tMs: number;
  lat: number;
  lng: number;
  accuracyM: number;
  accurate: boolean;
  distanceM: number;
};

/**
 * HM-02: capturing → uploaded / rejected through app.complete_scan_upload.
 * The function re-checks that the caller is the host and the row is still
 * capturing; false means nothing changed (already submitted, or not yours).
 */
export async function completeScanUpload(
  tx: Tx,
  input: {
    scanId: string;
    ok: boolean;
    reason: ScanReason | null;
    capturedOn: string;
    stats: GeofenceStatsJson;
    artifacts: ArtifactRecord[];
    samples: SampleRecord[];
  },
): Promise<boolean> {
  const artifacts = input.artifacts.map((a) => ({
    kind: a.kind,
    object_key: a.objectKey,
    content_type: a.contentType,
    size_bytes: a.sizeBytes,
  }));
  const samples = input.samples.map((s) => ({
    seq: s.seq,
    t_ms: s.tMs,
    lat: s.lat,
    lng: s.lng,
    accuracy_m: s.accuracyM,
    accurate: s.accurate,
    distance_m: s.distanceM,
  }));
  const rows = (await tx.execute<{ done: boolean }>(sql`
    SELECT app.complete_scan_upload(
      ${input.scanId}::uuid,
      ${input.ok},
      ${input.reason},
      ${input.capturedOn}::date,
      ${JSON.stringify(input.stats)}::jsonb,
      ${JSON.stringify(artifacts)}::jsonb,
      ${JSON.stringify(samples)}::jsonb
    ) AS done
  `)) as unknown as { done: boolean }[];
  return rows[0]?.done === true;
}

// ---------------------------------------------------------------- HM-03 -----

/** Who to tell, and about which home. Both the worker and host paths return this shape. */
export type ScanNotice = {
  hostEmail: string;
  listingTitle: string;
  listingId: string;
};

type ClaimRow = {
  scan_id: string;
  listing_id: string;
  job: "reconstruct" | "crop";
  attempt: number;
  accuracy_max_m: number;
  geofence_radius_m: number;
  target_lat: number;
  target_lng: number;
  timezone: string;
  video_key: string | null;
  video_content_type: string | null;
  attestation_key: string | null;
  notes_key: string | null;
  mask_segments: MaskSegment[] | null;
  duration_ms: number | null;
};

/**
 * The oldest job of either kind, or null when the queue is empty. Runs with
 * no member: the worker is not one. The function skips locked rows, so two
 * workers never take the same job, and it carries the host's marks with a
 * crop job so the worker knows which frames to drop.
 */
export async function claimNextScanJob(tx: Tx, workerId: string): Promise<ScanJob | null> {
  const rows = (await tx.execute<ClaimRow>(
    sql`SELECT * FROM app.claim_next_scan_job(${workerId})`,
  )) as unknown as ClaimRow[];
  const row = rows[0];
  if (!row) return null;
  if (!row.video_key || !row.attestation_key || !row.notes_key) {
    // The claim only takes whole packages; reaching here means the schema drifted.
    throw new Error(`scan ${row.scan_id} was claimed without its upload package`);
  }
  return {
    scanId: row.scan_id,
    listingId: row.listing_id,
    job: row.job,
    attempt: row.attempt,
    timezone: row.timezone,
    target: { lat: row.target_lat, lng: row.target_lng },
    thresholds: { accuracyMaxM: row.accuracy_max_m, geofenceRadiusM: row.geofence_radius_m },
    inputs: {
      videoKey: row.video_key,
      videoContentType: row.video_content_type ?? "video/mp4",
      attestationKey: row.attestation_key,
      notesKey: row.notes_key,
    },
    maskSegments: row.job === "crop" ? (row.mask_segments ?? []) : [],
    durationMs: row.duration_ms ?? 0,
    outputPrefix: `listings/${row.listing_id}/scans/${row.scan_id}/`,
  };
}

type FinishRow = { host_email: string; listing_title: string; listing_id: string; state: string };

/**
 * reconstructing → needs_mask (a build) / verified (a crop) / failed. Null
 * when the attempt is stale or the row has moved on: a worker that lost its
 * claim writes nothing. An outcome the job kind cannot reach, and bad keys
 * or kinds, raise (P0001) — the route turns that into a 400.
 */
export async function finishScanJob(
  tx: Tx,
  input: {
    scanId: string;
    attempt: number;
    outcome: "needs_mask" | "verified" | "failed";
    reason: ScanReason | null;
    artifacts: ScanJobArtifact[];
  },
): Promise<(ScanNotice & { state: string }) | null> {
  const artifacts = input.artifacts.map((a) => ({
    kind: a.kind,
    object_key: a.objectKey,
    content_type: a.contentType,
    size_bytes: a.sizeBytes,
  }));
  const rows = (await tx.execute<FinishRow>(sql`
    SELECT * FROM app.finish_scan_job(
      ${input.scanId}::uuid,
      ${input.attempt},
      ${input.outcome},
      ${input.reason},
      ${JSON.stringify(artifacts)}::jsonb
    )
  `)) as unknown as FinishRow[];
  const row = rows[0];
  if (!row) return null;
  return { hostEmail: row.host_email, listingTitle: row.listing_title, listingId: row.listing_id, state: row.state };
}

/** Host-only: failed → uploaded while attempts remain. False when nothing changed. */
export async function retryScanReconstruction(tx: Tx, scanId: string, maxAttempts: number): Promise<boolean> {
  const rows = (await tx.execute<{ ok: boolean }>(
    sql`SELECT app.retry_scan_reconstruction(${scanId}::uuid, ${maxAttempts}) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

export type ReleasedScanJob = ScanNotice & { scanId: string; state: string };

/**
 * Cron: a claim older than the window is a dead worker. Rows go back to the
 * queue while attempts remain, otherwise to `failed`; the caller emails the
 * hosts in the second group after the transaction has committed.
 */
export async function releaseStaleScanJobs(
  tx: Tx,
  olderThanHours: number,
  maxAttempts: number,
): Promise<ReleasedScanJob[]> {
  const rows = (await tx.execute<{
    scan_id: string;
    state: string;
    host_email: string;
    listing_title: string;
    listing_id: string;
  }>(sql`
    SELECT * FROM app.release_stale_scan_jobs(make_interval(hours => ${olderThanHours}::int), ${maxAttempts})
  `)) as unknown as { scan_id: string; state: string; host_email: string; listing_title: string; listing_id: string }[];
  return rows.map((r) => ({
    scanId: r.scan_id,
    state: r.state,
    hostEmail: r.host_email,
    listingTitle: r.listing_title,
    listingId: r.listing_id,
  }));
}

/** The host's own address and title for a notice sent in the host's request. Host-scoped. */
export async function scanNotice(tx: Tx, scanId: string): Promise<ScanNotice | null> {
  const rows = (await tx.execute<{ host_email: string; listing_title: string; listing_id: string }>(
    sql`SELECT * FROM app.scan_notice(${scanId}::uuid)`,
  )) as unknown as { host_email: string; listing_title: string; listing_id: string }[];
  const row = rows[0];
  return row ? { hostEmail: row.host_email, listingTitle: row.listing_title, listingId: row.listing_id } : null;
}

// ---------------------------------------------------------------- HM-04 -----

/**
 * Write the host's answer. This is an ordinary member write under RLS, not a
 * transition: a mask is host input, and the policies hold the rules (own row,
 * scan still `needs_mask`, whole-home refused for a private room). The
 * segments are already merged and clamped by the caller.
 */
export async function saveScanMask(
  tx: Tx,
  input: { scanId: string; hostId: string; segments: MaskSegment[]; wholeHomeConfirmed: boolean },
): Promise<ScanMask | null> {
  const wholeHomeConfirmedAt = input.wholeHomeConfirmed ? new Date() : null;
  const segments = input.wholeHomeConfirmed ? [] : input.segments;
  const [row] = await tx
    .insert(listingRentalMasks)
    .values({
      scanId: input.scanId,
      hostId: input.hostId,
      segments,
      wholeHomeConfirmedAt,
    })
    .onConflictDoUpdate({
      target: listingRentalMasks.scanId,
      set: { segments, wholeHomeConfirmedAt, updatedAt: new Date() },
    })
    .returning();
  return toMask(row);
}

export type SendForVerification = ScanNotice & { state: string };

/**
 * HM-04: the host sends their answer. needs_mask → verified when nothing
 * needs cutting, or → reconstructing with a crop job when it does. Null when
 * the scan is not the caller's or has moved on; a refusal the host can fix
 * raises (P0001) and the route turns it into the locked sentence.
 */
export async function sendScanForVerification(
  tx: Tx,
  scanId: string,
): Promise<SendForVerification | null> {
  const rows = (await tx.execute<{
    state: string;
    host_email: string;
    listing_title: string;
    listing_id: string;
  }>(sql`SELECT * FROM app.send_scan_for_verification(${scanId}::uuid)`)) as unknown as {
    state: string;
    host_email: string;
    listing_title: string;
    listing_id: string;
  }[];
  const row = rows[0];
  if (!row) return null;
  return {
    state: row.state,
    hostEmail: row.host_email,
    listingTitle: row.listing_title,
    listingId: row.listing_id,
  };
}
