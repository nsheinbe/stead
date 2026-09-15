/**
 * HM-01 — honesty scan reads and the one write a host may make.
 *
 * RLS is the enforcement: listing_scans_host_read scopes SELECT to the
 * caller's rows and listing_scans_host_start lets a host insert only a
 * `capturing` row for an owned, door-confirmed listing. The host_id filters
 * here mirror those policies so the intent reads locally; they are not what
 * makes it safe. Every later state change is a SECURITY DEFINER function
 * added by the ticket that needs it (HM-02 onward).
 */
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { listingScans, listings } from "../db/schema";
import type { ListingScan, ScanReason, ScanThresholds } from "../../src/lib/types";

type ScanRow = typeof listingScans.$inferSelect;

function toListingScan(row: ScanRow): ListingScan {
  return {
    id: row.id,
    state: row.state,
    reason: (row.reason as ScanReason | null) ?? null,
    policyVersion: row.honestyPolicyVersion,
    thresholds: {
      accuracyMaxM: row.accuracyMaxM,
      geofenceRadiusM: row.geofenceRadiusM,
      bookendWindowSeconds: row.bookendWindowSeconds,
      bookendMinSamples: row.bookendMinSamples,
      minIndoorSeconds: row.minIndoorSeconds,
      maxSeconds: row.maxSeconds,
    },
    capturedOn: row.capturedOn,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ScanTarget = {
  confirmed: boolean;
  lat: number | null;
  lng: number | null;
};

/** The listing's front door as the scan will be judged against it; null when not the caller's. */
export async function getScanTarget(
  tx: Tx,
  hostId: string,
  listingId: string,
): Promise<ScanTarget | null> {
  const row = await tx.query.listings.findFirst({
    where: and(eq(listings.id, listingId), eq(listings.hostId, hostId)),
    columns: { lat: true, lng: true, coordinatesConfirmedAt: true },
  });
  if (!row) return null;
  return {
    confirmed: row.coordinatesConfirmedAt !== null && row.lat !== null && row.lng !== null,
    lat: row.lat,
    lng: row.lng,
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
  });
  return row ? toListingScan(row) : null;
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
  return toListingScan(created);
}
