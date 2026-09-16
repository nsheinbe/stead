/**
 * HM-06 — what a listing page may say about where a home is (HM-D08).
 *
 * Every decision here was already made in SQL: `app.street_for_viewer` is a
 * SECURITY DEFINER function because a guest has no SELECT on scan_artifacts,
 * and the pin it hands back is already rounded for a viewer who may not see
 * the front door. Nothing in this file may round, unround, or second-guess
 * that — it signs a key and shapes a DTO.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { presignGetOrNull } from "../lib/scanStorage";
import type { ListingStreet } from "../../src/lib/types";

type Row = {
  pin_lat: number | string | null;
  pin_lng: number | string | null;
  precision_m: number;
  sees_door: boolean;
  has_approach: boolean;
  owner_preview: boolean;
  approach_keys: string[] | null;
};

const num = (value: number | string | null): number | null =>
  value === null ? null : typeof value === "number" ? value : Number(value);

/**
 * The street facts for this viewer, or null when there is nothing true to
 * say — no confirmed point and no approach footage. A listing the viewer may
 * not open at all is also null, because the function returns no row.
 */
export async function streetForViewer(tx: Tx, listingId: string): Promise<ListingStreet | null> {
  const rows = (await tx.execute<Row>(
    sql`SELECT * FROM app.street_for_viewer(${listingId}::uuid)`,
  )) as unknown as Row[];
  const row = rows[0];
  if (!row) return null;

  const lat = num(row.pin_lat);
  const lng = num(row.pin_lng);
  const pin = lat !== null && lng !== null ? { lat, lng } : null;
  if (!pin && !row.has_approach) return null;

  // Only a viewer who may see the door gets keys at all, so this signs
  // whatever came back rather than deciding again who deserves it.
  const posterKey = row.approach_keys?.[0] ?? null;

  return {
    pin,
    precisionM: row.precision_m,
    exact: row.sees_door,
    hasApproach: row.has_approach,
    posterUrl: posterKey ? await presignGetOrNull(posterKey) : null,
    ownerPreview: row.owner_preview,
  };
}
