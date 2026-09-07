/**
 * Escrow lifecycle, Slice 2.
 *
 * Every mutation here is a thin call into a SECURITY DEFINER function in
 * schema `app`. That is deliberate: app_user has no UPDATE grant on
 * escrow_deposits, so the transitions are the only way the state moves, and
 * the legal from_state lives in the function's WHERE clause rather than in
 * anything a caller could forget. Re-running a job is a no-op, not a
 * corruption.
 *
 * The listing-local scheduling — when check-in and checkout actually fall for
 * a given listing's IANA zone — is also inside those functions, so no caller
 * can accidentally reason about it in UTC.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";

export interface ReleasedDeposit {
  depositId: string;
  bookingId: string;
  guestEmail: string;
  listingTitle: string;
  amountCents: number;
}

/** scheduled → held, for every booking whose listing-local check-in has passed. */
export async function holdDueEscrows(tx: Tx): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT app.hold_due_escrows() AS moved`,
  )) as unknown as { moved: number }[];
  return Number(rows[0]?.moved ?? 0);
}

/** held → claim_window at listing-local checkout, stamping window_closes_at. */
export async function openDueClaimWindows(tx: Tx): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT app.open_due_claim_windows() AS moved`,
  )) as unknown as { moved: number }[];
  return Number(rows[0]?.moved ?? 0);
}

/**
 * claim_window → released once the window has closed. Returns what moved so
 * the caller can email each guest; an empty array means nothing was due.
 */
export async function releaseDueEscrows(tx: Tx): Promise<ReleasedDeposit[]> {
  const rows = (await tx.execute(
    sql`SELECT deposit_id, booking_id, guest_email, listing_title, amount_cents
          FROM app.release_due_escrows()`,
  )) as unknown as {
    deposit_id: string;
    booking_id: string;
    guest_email: string;
    listing_title: string;
    amount_cents: number;
  }[];
  return rows.map((row) => ({
    depositId: row.deposit_id,
    bookingId: row.booking_id,
    guestEmail: row.guest_email,
    listingTitle: row.listing_title,
    amountCents: Number(row.amount_cents),
  }));
}

/**
 * Records a refund for a payment that settled after its booking expired, and
 * closes the escrow that was never held. False means it was not that case, or
 * the refund was already recorded — either way the caller does nothing more.
 */
export async function refundExpiredBooking(
  tx: Tx,
  paymentIntentId: string,
  refundId: string,
  amountCents: number,
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.refund_expired_booking(${paymentIntentId}, ${refundId}, ${amountCents}) AS refunded`,
  )) as unknown as { refunded: boolean }[];
  return rows[0]?.refunded === true;
}

export interface EscrowTimelineRow {
  fromState: string | null;
  toState: string;
  actor: string;
  at: string;
}

export interface EscrowSnapshot {
  state: string;
  method: string;
  amountCents: number;
  heldAt: string | null;
  windowClosesAt: string | null;
  releasedAt: string | null;
  timeline: EscrowTimelineRow[];
}

/**
 * The deposit and its audit trail for one booking. Scoped by RLS to the
 * booking's guest and host — the WHERE here mirrors the policy for
 * readability and is not what enforces it.
 */
export async function getEscrowForBooking(
  tx: Tx,
  bookingId: string,
): Promise<EscrowSnapshot | null> {
  const deposits = (await tx.execute(sql`
    SELECT d.state, d.method, d.amount_cents, d.held_at, d.window_closes_at, d.released_at
      FROM public.escrow_deposits d
     WHERE d.booking_id = ${bookingId}::uuid
     LIMIT 1
  `)) as unknown as {
    state: string;
    method: string;
    amount_cents: number;
    held_at: string | null;
    window_closes_at: string | null;
    released_at: string | null;
  }[];

  const deposit = deposits[0];
  if (!deposit) return null;

  const audit = (await tx.execute(sql`
    SELECT a.from_state, a.to_state, a.actor, a.at
      FROM public.escrow_audit a
      JOIN public.escrow_deposits d ON d.id = a.deposit_id
     WHERE d.booking_id = ${bookingId}::uuid
     ORDER BY a.at ASC
  `)) as unknown as {
    from_state: string | null;
    to_state: string;
    actor: string;
    at: string;
  }[];

  return {
    state: deposit.state,
    method: deposit.method,
    amountCents: Number(deposit.amount_cents),
    heldAt: deposit.held_at,
    windowClosesAt: deposit.window_closes_at,
    releasedAt: deposit.released_at,
    timeline: audit.map((row) => ({
      fromState: row.from_state,
      toState: row.to_state,
      actor: row.actor,
      at: row.at,
    })),
  };
}

export interface ExpiredBookingPayment {
  bookingId: string;
  guestTotalCents: number;
}

/**
 * The booking a settled payment landed on, if that booking had already
 * expired and has no refund on record. Null is the ordinary case.
 */
export async function findExpiredBookingForPaymentIntent(
  tx: Tx,
  paymentIntentId: string,
): Promise<ExpiredBookingPayment | null> {
  const rows = (await tx.execute(
    sql`SELECT booking_id, guest_total_cents
          FROM app.expired_booking_for_payment_intent(${paymentIntentId})`,
  )) as unknown as { booking_id: string; guest_total_cents: number }[];
  const row = rows[0];
  if (!row) return null;
  return { bookingId: row.booking_id, guestTotalCents: Number(row.guest_total_cents) };
}
