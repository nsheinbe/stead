/**
 * Honesty scan reads and the write transitions (HM-01, HM-02).
 *
 * Reads run under RLS: listing_scans_host_read scopes SELECT to the owner, so
 * the host_id filter here mirrors the policy for readability rather than
 * enforcing it. Writes go through the SECURITY DEFINER functions in schema
 * `app` — start, record location, declare/presign/confirm/complete upload —
 * the only paths that can insert a scan, store a verdict or move a state.
 * app_user has no INSERT or UPDATE grant on listing_scans or
 * scan_upload_parts at all.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { listingScans, listings, scanUploadParts } from "../db/schema";
import type { GeofenceVerdict, GeoSample } from "../lib/geofence";
import { storageConfigured } from "../lib/storage";
import type {
  HostScan,
  HostScanRow,
  HostScanUpload,
  ScanThresholds,
  ScanUploadLimits,
} from "../../src/lib/types";
import { getConfigMap, intFromConfig } from "./listings";

/** Defaults match drizzle/0015; app_config overrides them. */
export const SCAN_THRESHOLD_DEFAULTS: ScanThresholds = {
  accuracyMaxMeters: 25,
  geofenceRadiusMeters: 60,
  indoorToleranceMeters: 500,
  minSamples: 20,
  bookendMinSamples: 3,
  maxGapSeconds: 45,
  maxWalkMinutes: 20,
};

export function thresholdsFromConfig(map: Record<string, unknown>): ScanThresholds {
  const d = SCAN_THRESHOLD_DEFAULTS;
  return {
    accuracyMaxMeters: intFromConfig(map.scan_accuracy_max_meters, d.accuracyMaxMeters),
    geofenceRadiusMeters: intFromConfig(map.scan_geofence_radius_meters, d.geofenceRadiusMeters),
    indoorToleranceMeters: intFromConfig(map.scan_indoor_tolerance_meters, d.indoorToleranceMeters),
    minSamples: intFromConfig(map.scan_min_samples, d.minSamples),
    bookendMinSamples: intFromConfig(map.scan_bookend_min_samples, d.bookendMinSamples),
    maxGapSeconds: intFromConfig(map.scan_max_gap_seconds, d.maxGapSeconds),
    maxWalkMinutes: intFromConfig(map.scan_max_walk_minutes, d.maxWalkMinutes),
  };
}

/** Defaults match drizzle/0016; app_config overrides them. */
export const SCAN_UPLOAD_LIMIT_DEFAULTS: ScanUploadLimits = {
  maxUploadBytes: 1_500_000_000,
  maxPartBytes: 67_108_864,
  maxParts: 2000,
};

export function uploadLimitsFromConfig(map: Record<string, unknown>): ScanUploadLimits {
  const d = SCAN_UPLOAD_LIMIT_DEFAULTS;
  return {
    maxUploadBytes: intFromConfig(map.scan_max_upload_bytes, d.maxUploadBytes),
    maxPartBytes: intFromConfig(map.scan_max_part_bytes, d.maxPartBytes),
    maxParts: intFromConfig(map.scan_max_parts, d.maxParts),
  };
}

type ScanRow = typeof listingScans.$inferSelect;
type PartRow = typeof scanUploadParts.$inferSelect;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function thresholdsOf(row: ScanRow): ScanThresholds {
  return {
    accuracyMaxMeters: row.accuracyMaxMeters,
    geofenceRadiusMeters: row.geofenceRadiusMeters,
    indoorToleranceMeters: row.indoorToleranceMeters,
    minSamples: row.minSamples,
    bookendMinSamples: row.bookendMinSamples,
    maxGapSeconds: row.maxGapSeconds,
    maxWalkMinutes: row.maxWalkMinutes,
  };
}

function toUpload(row: ScanRow, parts: PartRow[]): HostScanUpload | null {
  if (row.videoPartCount === null || row.videoMimeType === null) return null;
  const ordered = [...parts].sort((a, b) => a.seq - b.seq);
  return {
    mimeType: row.videoMimeType,
    durationMs: row.durationMs,
    partCount: row.videoPartCount,
    parts: ordered.map((p) => ({ seq: p.seq, bytes: p.expectedBytes, confirmed: p.confirmedAt !== null })),
    totalBytes: ordered.reduce((sum, p) => sum + p.expectedBytes, 0),
    confirmedBytes: ordered.reduce((sum, p) => sum + (p.confirmedAt !== null ? p.expectedBytes : 0), 0),
    startedAt: iso(row.uploadStartedAt),
    uploadedAt: iso(row.uploadedAt),
  };
}

function toHostScanRow(row: ScanRow, parts: PartRow[]): HostScanRow {
  return {
    id: row.id,
    state: row.state,
    geofence: row.geofence,
    rejectReason: row.rejectReason,
    policyVersion: row.policyVersion,
    thresholds: thresholdsOf(row),
    sampleCount: row.sampleCount,
    maxDistanceMeters: row.maxDistanceMeters,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    locationCheckedAt: iso(row.locationCheckedAt),
    revokedAt: iso(row.revokedAt),
    revokedReason: row.revokedReason,
    createdAt: row.createdAt.toISOString(),
    upload: toUpload(row, parts),
  };
}

/** The scan hub for one of the caller's listings, or null when it is not theirs. */
export async function getHostScan(
  tx: Tx,
  hostId: string,
  listingId: string,
  policyVersion: string,
): Promise<HostScan | null> {
  const listing = await tx.query.listings.findFirst({
    where: and(eq(listings.id, listingId), eq(listings.hostId, hostId)),
    columns: { id: true, title: true, type: true, status: true, lat: true, lng: true },
  });
  if (!listing) return null;

  const scan = await tx.query.listingScans.findFirst({
    where: eq(listingScans.listingId, listingId),
    orderBy: desc(listingScans.createdAt),
  });
  const parts = scan ? await listScanUploadParts(tx, scan.id) : [];
  const config = await getConfigMap(tx);

  return {
    listing: {
      id: listing.id,
      title: listing.title,
      type: listing.type,
      status: listing.status,
      hasPin: listing.lat !== null && listing.lng !== null,
    },
    policyVersion,
    thresholds: thresholdsFromConfig(config),
    uploadLimits: uploadLimitsFromConfig(config),
    storageConfigured: storageConfigured(),
    scan: scan ? toHostScanRow(scan, parts) : null,
  };
}

/** Start a capture session. NULL from the function means "not yours". */
export async function startListingScan(
  tx: Tx,
  listingId: string,
  policyVersion: string,
): Promise<string | null> {
  const rows = (await tx.execute(
    sql`SELECT app.start_listing_scan(${listingId}::uuid, ${policyVersion}) AS id`,
  )) as unknown as { id: string | null }[];
  return rows[0]?.id ?? null;
}

export type ScanForJudging = {
  id: string;
  state: ScanRow["state"];
  geofence: ScanRow["geofence"];
  pin: { lat: number; lng: number };
  thresholds: ScanThresholds;
  policyVersion: string;
  sampleCount: number | null;
  locationCheckedAt: string | null;
  upload: { mimeType: string; partCount: number; durationMs: number | null } | null;
};

/**
 * What the verdict needs — the frozen pin and thresholds — and, for the
 * upload routes, the facts the manifest records. Owner-scoped by RLS.
 */
export async function getScanForJudging(
  tx: Tx,
  hostId: string,
  listingId: string,
  scanId: string,
): Promise<ScanForJudging | null> {
  const row = await tx.query.listingScans.findFirst({
    where: and(
      eq(listingScans.id, scanId),
      eq(listingScans.listingId, listingId),
      eq(listingScans.hostId, hostId),
    ),
  });
  if (!row) return null;
  return {
    id: row.id,
    state: row.state,
    geofence: row.geofence,
    pin: { lat: row.pinLat, lng: row.pinLng },
    thresholds: thresholdsOf(row),
    policyVersion: row.policyVersion,
    sampleCount: row.sampleCount,
    locationCheckedAt: iso(row.locationCheckedAt),
    upload:
      row.videoMimeType !== null && row.videoPartCount !== null
        ? { mimeType: row.videoMimeType, partCount: row.videoPartCount, durationMs: row.durationMs }
        : null,
  };
}

/**
 * Store the location record and its verdict. The samples go in as a JSON
 * array with snake_case keys, which is what the function reads; the verdict
 * is the one server/lib/geofence.ts produced from those same samples.
 */
export async function recordScanLocation(
  tx: Tx,
  scanId: string,
  samples: readonly GeoSample[],
  verdict: GeofenceVerdict,
): Promise<boolean> {
  const payload = JSON.stringify(
    samples.map((s) => ({
      recorded_at: s.recordedAt,
      lat: s.lat,
      lng: s.lng,
      accuracy_meters: s.accuracyMeters,
      phase: s.phase,
    })),
  );
  const reason = verdict.passed ? null : verdict.reason;
  const rows = (await tx.execute(
    sql`SELECT app.record_scan_location(
          ${scanId}::uuid,
          ${payload}::jsonb,
          ${verdict.passed},
          ${reason}::public.scan_reject_reason,
          ${verdict.sampleCount},
          ${verdict.maxDistanceMeters},
          ${verdict.startedAt}::timestamptz,
          ${verdict.finishedAt}::timestamptz
        ) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

/** "Stop without finishing". listing_scans_host_discard decides what may go. */
export async function discardScan(tx: Tx, listingId: string, scanId: string): Promise<boolean> {
  const deleted = await tx
    .delete(listingScans)
    .where(and(eq(listingScans.id, scanId), eq(listingScans.listingId, listingId)))
    .returning({ id: listingScans.id });
  return deleted.length > 0;
}

// ------------------------------------------------------------ HM-02 upload --

/** The declared parts of a scan, in order. RLS scopes them to the owner. */
export async function listScanUploadParts(tx: Tx, scanId: string): Promise<PartRow[]> {
  return tx.query.scanUploadParts.findMany({
    where: eq(scanUploadParts.scanId, scanId),
    orderBy: asc(scanUploadParts.seq),
  });
}

export type DeclaredPart = { seq: number; bytes: number; key: string; contentType: string };

/**
 * Postgres check_violation (23514) raised by app.declare_scan_upload when a
 * different shape is declared over a part that is already confirmed.
 * postgres.js re-throws a failed statement from the enclosing transaction
 * even when the caller caught it, so the route matches this on the error
 * that comes out of tenantQuery. Drizzle may wrap it; the code sits down
 * the `cause` chain.
 */
export function isUploadInProgressError(err: unknown): boolean {
  for (let current = err, depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") break;
    if ((current as { code?: string }).code === "23514") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Declare the package. The keys are the server's (computed by the route from
 * ids it already trusts); the function stores them so presign and confirm
 * sign and check exactly those. False covers not yours and not located; a
 * reshape over a confirmed part throws (see isUploadInProgressError).
 */
export async function declareScanUpload(
  tx: Tx,
  scanId: string,
  input: {
    mimeType: string;
    durationMs: number;
    clientEnvironment: Record<string, unknown>;
    parts: DeclaredPart[];
  },
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.declare_scan_upload(
          ${scanId}::uuid,
          ${input.mimeType},
          ${input.durationMs},
          ${JSON.stringify(input.clientEnvironment)}::jsonb,
          ${JSON.stringify(input.parts)}::jsonb
        ) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

/** Bookkeeping after handing out URLs. Returns how many parts were marked. */
export async function markScanPartsPresigned(tx: Tx, scanId: string, seqs: number[]): Promise<number> {
  // Drizzle expands a JS array into a row constructor, so the list travels as JSON.
  const rows = (await tx.execute(
    sql`SELECT app.mark_scan_parts_presigned(
          ${scanId}::uuid,
          ARRAY(SELECT e::integer FROM jsonb_array_elements_text(${JSON.stringify(seqs)}::jsonb) AS e)
        ) AS n`,
  )) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/** The receipt: only when the object's size is the declared size. Idempotent. */
export async function confirmScanPart(tx: Tx, scanId: string, seq: number, bytes: number): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.confirm_scan_part(${scanId}::uuid, ${seq}, ${bytes}::bigint) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

/** Complete or nothing: `uploaded` only when every declared part is confirmed. */
export async function completeScanUpload(tx: Tx, scanId: string, manifestKey: string): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.complete_scan_upload(${scanId}::uuid, ${manifestKey}) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}
