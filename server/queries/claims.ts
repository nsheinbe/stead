/**
 * Claims, Slice 3b.
 *
 * Writes go through SECURITY DEFINER functions: app_user has no INSERT/UPDATE
 * on claims, so file / respond / resolve are the only way a row changes state.
 * Reads are scoped by RLS to the booking parties plus the arbiter; the filters
 * here mirror that for readability and are not what enforces it.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import type { ClaimDetail, ClaimEvidenceItem, ClaimState, ClaimSummary } from "../../src/lib/types";

export type ClaimOutcome = "host" | "guest" | "split";

export interface ClaimChargeContext {
  claimId: string;
  bookingId: string;
  state: ClaimState;
  amountCents: number;
  guestId: string;
  hostId: string;
  setupIntentId: string | null;
  hostConnectAccountId: string | null;
  listingTitle: string;
}

export interface ClaimNotice {
  guestEmail: string;
  hostEmail: string;
  listingTitle: string;
  amountCents: number;
  resolutionAmountCents: number | null;
  state: ClaimState;
}

function mapEvidence(row: {
  id: string;
  uploaded_by: string;
  storage_path: string;
  note: string | null;
}): ClaimEvidenceItem {
  return {
    id: row.id,
    uploadedBy: row.uploaded_by,
    storagePath: row.storage_path,
    note: row.note,
  };
}

function mapSummary(row: {
  id: string;
  booking_id: string;
  amount_cents: number;
  description: string;
  state: string;
  created_at: string;
  listing_title: string;
  check_in: string;
  check_out: string;
}): ClaimSummary {
  return {
    id: row.id,
    bookingId: row.booking_id,
    amountCents: Number(row.amount_cents),
    description: row.description,
    state: row.state as ClaimState,
    createdAt: new Date(row.created_at).toISOString(),
    listingTitle: row.listing_title,
    checkIn: row.check_in,
    checkOut: row.check_out,
  };
}

/** What RLS will hand this member — their own stays, or every claim if they arbitrate. */
export async function listClaimsForViewer(tx: Tx, viewerId: string): Promise<ClaimSummary[]> {
  const rows = (await tx.execute(sql`
    SELECT c.id, c.booking_id, c.amount_cents, c.description, c.state::text AS state,
           c.created_at, l.title AS listing_title, b.check_in, b.check_out
      FROM public.claims c
      JOIN public.bookings b ON b.id = c.booking_id
      JOIN public.listings l ON l.id = b.listing_id
     WHERE b.guest_id = ${viewerId}::uuid
        OR l.host_id = ${viewerId}::uuid
        OR app.is_current_user_arbiter()
     ORDER BY c.created_at DESC
  `)) as unknown as {
    id: string;
    booking_id: string;
    amount_cents: number;
    description: string;
    state: string;
    created_at: string;
    listing_title: string;
    check_in: string;
    check_out: string;
  }[];
  return rows.map(mapSummary);
}

export async function getClaimForViewer(
  tx: Tx,
  claimId: string,
  viewerId: string,
): Promise<ClaimDetail | null> {
  const rows = (await tx.execute(sql`
    SELECT c.id, c.booking_id, c.filed_by, c.amount_cents, c.description,
           c.state::text AS state, c.created_at, c.resolved_at,
           c.resolution_amount_cents, c.resolution_note,
           l.title AS listing_title, l.host_id, b.guest_id, b.check_in, b.check_out,
           app.is_current_user_arbiter() AS is_arbiter
      FROM public.claims c
      JOIN public.bookings b ON b.id = c.booking_id
      JOIN public.listings l ON l.id = b.listing_id
     WHERE c.id = ${claimId}::uuid
  `)) as unknown as {
    id: string;
    booking_id: string;
    filed_by: string;
    amount_cents: number;
    description: string;
    state: string;
    created_at: string;
    resolved_at: string | null;
    resolution_amount_cents: number | null;
    resolution_note: string | null;
    listing_title: string;
    host_id: string;
    guest_id: string;
    check_in: string;
    check_out: string;
    is_arbiter: boolean;
  }[];
  const row = rows[0];
  if (!row) return null;

  const evidenceRows = (await tx.execute(sql`
    SELECT id, uploaded_by, storage_path, note
      FROM public.claim_evidence
     WHERE claim_id = ${claimId}::uuid
     ORDER BY id ASC
  `)) as unknown as {
    id: string;
    uploaded_by: string;
    storage_path: string;
    note: string | null;
  }[];

  const state = row.state as ClaimState;
  const isHost = row.host_id === viewerId;
  const isGuest = row.guest_id === viewerId;
  const isArbiter = row.is_arbiter === true;
  const live = state === "open" || state === "guest_disputed" || state === "arbitration";

  return {
    id: row.id,
    bookingId: row.booking_id,
    filedBy: row.filed_by,
    amountCents: Number(row.amount_cents),
    description: row.description,
    state,
    createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    resolutionAmountCents: row.resolution_amount_cents == null ? null : Number(row.resolution_amount_cents),
    resolutionNote: row.resolution_note,
    listingTitle: row.listing_title,
    checkIn: row.check_in,
    checkOut: row.check_out,
    evidence: evidenceRows.map(mapEvidence),
    viewerRole: isArbiter ? "arbiter" : isHost ? "host" : isGuest ? "guest" : "arbiter",
    canRespond: isGuest && state === "open",
    canResolve: isArbiter && (state === "guest_disputed" || state === "arbitration"),
    canFileEvidence: (isHost || isGuest) && live,
  };
}

export async function getClaimForBooking(
  tx: Tx,
  bookingId: string,
): Promise<ClaimSummary | null> {
  const rows = (await tx.execute(sql`
    SELECT c.id, c.booking_id, c.amount_cents, c.description, c.state::text AS state,
           c.created_at, l.title AS listing_title, b.check_in, b.check_out
      FROM public.claims c
      JOIN public.bookings b ON b.id = c.booking_id
      JOIN public.listings l ON l.id = b.listing_id
     WHERE c.booking_id = ${bookingId}::uuid
     LIMIT 1
  `)) as unknown as {
    id: string;
    booking_id: string;
    amount_cents: number;
    description: string;
    state: string;
    created_at: string;
    listing_title: string;
    check_in: string;
    check_out: string;
  }[];
  return rows[0] ? mapSummary(rows[0]) : null;
}

/** Enough to charge the card on file, or decide not to. Null if RLS hides it. */
export async function getClaimChargeContext(
  tx: Tx,
  claimId: string,
): Promise<ClaimChargeContext | null> {
  const rows = (await tx.execute(sql`
    SELECT c.id, c.booking_id, c.state::text AS state, c.amount_cents,
           b.guest_id, l.host_id, l.title AS listing_title,
           d.stripe_setup_intent_id, hp.stripe_connect_account_id
      FROM public.claims c
      JOIN public.bookings b ON b.id = c.booking_id
      JOIN public.listings l ON l.id = b.listing_id
      JOIN public.escrow_deposits d ON d.booking_id = b.id
      JOIN public.profiles hp ON hp.id = l.host_id
     WHERE c.id = ${claimId}::uuid
  `)) as unknown as {
    id: string;
    booking_id: string;
    state: string;
    amount_cents: number;
    guest_id: string;
    host_id: string;
    listing_title: string;
    stripe_setup_intent_id: string | null;
    stripe_connect_account_id: string | null;
  }[];
  const row = rows[0];
  if (!row) return null;
  return {
    claimId: row.id,
    bookingId: row.booking_id,
    state: row.state as ClaimState,
    amountCents: Number(row.amount_cents),
    guestId: row.guest_id,
    hostId: row.host_id,
    setupIntentId: row.stripe_setup_intent_id,
    hostConnectAccountId: row.stripe_connect_account_id,
    listingTitle: row.listing_title,
  };
}

export async function getClaimNotice(tx: Tx, claimId: string): Promise<ClaimNotice | null> {
  const rows = (await tx.execute(
    sql`SELECT guest_email, host_email, listing_title, amount_cents,
               resolution_amount_cents, state
          FROM app.claim_notice(${claimId}::uuid)`,
  )) as unknown as {
    guest_email: string;
    host_email: string;
    listing_title: string;
    amount_cents: number;
    resolution_amount_cents: number | null;
    state: string;
  }[];
  const row = rows[0];
  if (!row) return null;
  return {
    guestEmail: row.guest_email,
    hostEmail: row.host_email,
    listingTitle: row.listing_title,
    amountCents: Number(row.amount_cents),
    resolutionAmountCents:
      row.resolution_amount_cents == null ? null : Number(row.resolution_amount_cents),
    state: row.state as ClaimState,
  };
}

export async function fileClaim(
  tx: Tx,
  bookingId: string,
  amountCents: number,
  description: string,
): Promise<string | null> {
  const rows = (await tx.execute(
    sql`SELECT app.file_claim(${bookingId}::uuid, ${amountCents}, ${description}) AS id`,
  )) as unknown as { id: string | null }[];
  return rows[0]?.id ?? null;
}

export async function respondClaim(
  tx: Tx,
  claimId: string,
  accept: boolean,
  stripeChargeId: string | null,
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.respond_claim(${claimId}::uuid, ${accept}, ${stripeChargeId}) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

export async function resolveClaim(
  tx: Tx,
  claimId: string,
  outcome: ClaimOutcome,
  amountCents: number | null,
  note: string | null,
  stripeChargeId: string | null,
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.resolve_claim(${claimId}::uuid, ${outcome}, ${amountCents}, ${note}, ${stripeChargeId}) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

export async function attachClaimEvidence(
  tx: Tx,
  claimId: string,
  uploadedBy: string,
  storagePath: string,
  note: string | null,
): Promise<string | null> {
  const rows = (await tx.execute(sql`
    INSERT INTO public.claim_evidence (claim_id, uploaded_by, storage_path, note)
    VALUES (${claimId}::uuid, ${uploadedBy}::uuid, ${storagePath}, ${note})
    RETURNING id
  `)) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

export async function viewerIsArbiter(tx: Tx): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.is_current_user_arbiter() AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}
