/**
 * HM-01 / HM-02 — honesty scan reads and the writes a host may make.
 *
 * RLS is the enforcement: listing_scans_host_read scopes SELECT to the
 * caller's rows and listing_scans_host_start lets a host insert only a
 * `capturing` row for an owned, door-confirmed listing. The host_id filters
 * here mirror those policies so the intent reads locally; they are not what
 * makes it safe. Every state change is a SECURITY DEFINER function:
 * app.complete_scan_upload (HM-02) is the first, and it re-checks the caller
 * and the row's state itself.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { listingScans, listings, scanArtifacts } from "../db/schema";
import type {
  GeofenceStatsJson,
  ListingScan,
  ScanReason,
  ScanThresholds,
  ScanUploadKind,
} from "../../src/lib/types";

type ScanRow = typeof listingScans.$inferSelect;
type ArtifactRow = typeof scanArtifacts.$inferSelect;

/** The row plus what the DTO hides: the frozen target the walk is judged against. */
export type OwnedScan = {
  scan: ListingScan;
  target: { lat: number; lng: number };
  thresholds: ScanThresholds;
  listingId: string;
};

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

function toListingScan(row: ScanRow, artifacts: ArtifactRow[]): ListingScan {
  const has = (kind: ScanUploadKind) => artifacts.some((a) => a.kind === kind);
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

export async function latestScanForOwner(
  tx: Tx,
  hostId: string,
  listingId: string,
): Promise<ListingScan | null> {
  const row = await tx.query.listingScans.findFirst({
    where: and(eq(listingScans.listingId, listingId), eq(listingScans.hostId, hostId)),
    orderBy: desc(listingScans.createdAt),
    with: { artifacts: true },
  });
  return row ? toListingScan(row, row.artifacts) : null;
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
    with: { artifacts: true },
  });
  if (!row) return null;
  return {
    scan: toListingScan(row, row.artifacts),
    target: { lat: row.targetLat, lng: row.targetLng },
    thresholds: thresholdsOf(row),
    listingId: row.listingId,
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
  return toListingScan(created, []);
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
