/**
 * HM-05 — what a guest may load, read through one SECURITY DEFINER door.
 *
 * A guest has no SELECT on `listing_scans` and must never get one, so the
 * viewer's read is `app.walkthrough_for_viewer`: it opens for an `active`
 * listing whose `verified_scan_id` points at a `verified` scan, or for that
 * listing's own host previewing a draft, and returns nothing otherwise.
 *
 * It hands back object keys, never URLs. Signing happens in the route, so an
 * artifact is reachable only through a link that expires and the raw upload
 * prefix never leaves the server.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import type { HonestyCoverage } from "../../src/lib/types";

export type WalkthroughRow = {
  scanId: string;
  ownerPreview: boolean;
  capturedOn: string | null;
  verifiedAt: string | null;
  policyVersion: number;
  coverage: HonestyCoverage;
  timezone: string;
  /** The compressed artifact when the worker made one; the plain splat otherwise. */
  splatKey: string | null;
  camerasKey: string | null;
  stillsKeys: string[];
};

type Raw = {
  scan_id: string;
  owner_preview: boolean;
  captured_on: string | null;
  verified_at: string | Date | null;
  policy_version: number;
  whole_home: boolean;
  timezone: string;
  splat_key: string | null;
  splat_compressed_key: string | null;
  cameras_key: string | null;
  stills_keys: string[] | null;
};

/** Null when there is nothing this viewer may walk. Not an error — the common case. */
export async function walkthroughForViewer(tx: Tx, listingId: string): Promise<WalkthroughRow | null> {
  const rows = (await tx.execute<Raw>(
    sql`SELECT * FROM app.walkthrough_for_viewer(${listingId}::uuid)`,
  )) as unknown as Raw[];
  const row = rows[0];
  if (!row) return null;
  const verifiedAt =
    row.verified_at instanceof Date ? row.verified_at.toISOString() : (row.verified_at ?? null);
  return {
    scanId: row.scan_id,
    ownerPreview: row.owner_preview,
    capturedOn: row.captured_on,
    verifiedAt,
    policyVersion: row.policy_version,
    coverage: row.whole_home ? "whole_home" : "rental_area",
    timezone: row.timezone,
    // The viewer never upsamples, so the compressed artifact is simply the
    // one to load when it exists; the plain splat is the fallback.
    splatKey: row.splat_compressed_key ?? row.splat_key,
    camerasKey: row.cameras_key,
    stillsKeys: row.stills_keys ?? [],
  };
}
