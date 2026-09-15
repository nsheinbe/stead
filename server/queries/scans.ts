/**
 * Honesty scan reads and the two write transitions (HM-01).
 *
 * Reads run under RLS: listing_scans_host_read scopes SELECT to the owner, so
 * the host_id filter here mirrors the policy for readability rather than
 * enforcing it. Writes go through app.start_listing_scan and
 * app.record_scan_location, the only paths that can insert a scan or store a
 * verdict — app_user has no INSERT or UPDATE grant on the table at all.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { listingScans, listings } from "../db/schema";
import type { GeofenceVerdict, GeoSample } from "../lib/geofence";
import type { HostScan, HostScanRow, ScanThresholds } from "../../src/lib/types";
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

type ScanRow = typeof listingScans.$inferSelect;

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

function toHostScanRow(row: ScanRow): HostScanRow {
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
    scan: scan ? toHostScanRow(scan) : null,
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
};

/** What the verdict needs: the frozen pin and thresholds. Owner-scoped by RLS. */
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
