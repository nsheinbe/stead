/**
 * Slice 7 — disputes, Identity, review reminders, ops reads, watchdog inputs.
 *
 * Every write is a SECURITY DEFINER call. stripe_disputes and review_reminders
 * have no table grant; ops lists refuse unless is_ops is set on the caller.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import type { HeartbeatRow } from "../lib/watchdog";

export async function isCurrentUserOps(tx: Tx): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.is_current_user_ops() AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

export async function recordDisputeOpened(
  tx: Tx,
  input: { disputeId: string; paymentIntentId: string; amountCents: number; status: string },
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.record_dispute_opened(
      ${input.disputeId},
      ${input.paymentIntentId},
      ${input.amountCents},
      ${input.status}
    ) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

export async function recordDisputeClosed(
  tx: Tx,
  disputeId: string,
  status: string,
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.record_dispute_closed(${disputeId}, ${status}) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

export async function markIdVerified(tx: Tx, userId: string, sessionId: string): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.mark_id_verified(${userId}::uuid, ${sessionId}) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

export async function setIdentitySession(tx: Tx, sessionId: string): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.set_identity_session(${sessionId}) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

export async function profileIdVerified(tx: Tx, userId: string): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT id_verified FROM public.profiles WHERE id = ${userId}::uuid`,
  )) as unknown as { id_verified: boolean }[];
  return rows[0]?.id_verified === true;
}

export interface ReviewReminderDue {
  bookingId: string;
  recipientId: string;
  recipientEmail: string;
  listingTitle: string;
  kind: "day3" | "day7";
}

export async function listReviewRemindersDue(tx: Tx): Promise<ReviewReminderDue[]> {
  const rows = (await tx.execute(sql`
    SELECT booking_id, recipient_id, recipient_email, listing_title, kind
      FROM app.list_review_reminders_due()
  `)) as unknown as {
    booking_id: string;
    recipient_id: string;
    recipient_email: string;
    listing_title: string;
    kind: "day3" | "day7";
  }[];
  return rows.map((row) => ({
    bookingId: row.booking_id,
    recipientId: row.recipient_id,
    recipientEmail: row.recipient_email,
    listingTitle: row.listing_title,
    kind: row.kind,
  }));
}

export async function markReviewReminderSent(
  tx: Tx,
  bookingId: string,
  recipientId: string,
  kind: string,
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.mark_review_reminder_sent(
      ${bookingId}::uuid, ${recipientId}::uuid, ${kind}
    ) AS ok`,
  )) as unknown as { ok: boolean }[];
  return rows[0]?.ok === true;
}

export interface OpsDispute {
  id: string;
  paymentIntentId: string | null;
  bookingId: string | null;
  amountCents: number;
  status: string;
  createdAt: string;
  closedAt: string | null;
}

export interface OpsHeartbeat {
  job: string;
  lastOk: string | null;
  lastError: string | null;
}

export interface OpsFrozenPayout {
  id: string;
  bookingId: string;
  hostId: string;
  amountCents: number;
  state: string;
  paidAt: string | null;
  stripeTransferId: string | null;
}

export async function listOpsDisputes(tx: Tx): Promise<OpsDispute[]> {
  const rows = (await tx.execute(sql`
    SELECT id, payment_intent_id, booking_id, amount_cents, status, created_at, closed_at
      FROM app.list_ops_disputes()
  `)) as unknown as {
    id: string;
    payment_intent_id: string | null;
    booking_id: string | null;
    amount_cents: number;
    status: string;
    created_at: string;
    closed_at: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    bookingId: row.booking_id,
    amountCents: Number(row.amount_cents),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
  }));
}

export async function listOpsHeartbeats(tx: Tx): Promise<OpsHeartbeat[]> {
  const rows = (await tx.execute(sql`
    SELECT job, last_ok, last_error FROM app.list_ops_heartbeats()
  `)) as unknown as { job: string; last_ok: string | null; last_error: string | null }[];
  return rows.map((row) => ({
    job: row.job,
    lastOk: row.last_ok ? new Date(row.last_ok).toISOString() : null,
    lastError: row.last_error,
  }));
}

export async function listOpsFrozenPayouts(tx: Tx): Promise<OpsFrozenPayout[]> {
  const rows = (await tx.execute(sql`
    SELECT id, booking_id, host_id, amount_cents, state, paid_at, stripe_transfer_id
      FROM app.list_ops_frozen_payouts()
  `)) as unknown as {
    id: string;
    booking_id: string;
    host_id: string;
    amount_cents: number;
    state: string;
    paid_at: string | null;
    stripe_transfer_id: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    bookingId: row.booking_id,
    hostId: row.host_id,
    amountCents: Number(row.amount_cents),
    state: row.state,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    stripeTransferId: row.stripe_transfer_id,
  }));
}

export async function listWatchdogHeartbeats(tx: Tx): Promise<HeartbeatRow[]> {
  const rows = (await tx.execute(sql`
    SELECT job, last_ok, last_error FROM app.list_watchdog_heartbeats()
  `)) as unknown as { job: string; last_ok: string | Date | null; last_error: string | null }[];
  return rows.map((row) => ({
    job: row.job,
    lastOk: row.last_ok ? new Date(row.last_ok) : null,
    lastError: row.last_error,
  }));
}

export async function listExpiredUnrefunded(
  tx: Tx,
): Promise<{ bookingId: string; paymentIntentId: string; guestTotalCents: number }[]> {
  const rows = (await tx.execute(sql`
    SELECT booking_id, payment_intent_id, guest_total_cents
      FROM app.list_expired_unrefunded()
  `)) as unknown as {
    booking_id: string;
    payment_intent_id: string;
    guest_total_cents: number;
  }[];
  return rows.map((row) => ({
    bookingId: row.booking_id,
    paymentIntentId: row.payment_intent_id,
    guestTotalCents: Number(row.guest_total_cents),
  }));
}

/**
 * Conversion totals for ops. Counts only.
 *
 * `app.conversion_totals()` returns nothing at all to a member without the ops
 * flag, and returns aggregates rather than rows to one with it — ops needs to
 * know how many members activated, not which ones.
 */
export async function listConversionTotals(tx: Tx): Promise<
  { outcome: string; total: number; firstAt: string | null; lastAt: string | null }[]
> {
  const rows = (await tx.execute(sql`
    SELECT outcome, total, first_at, last_at FROM app.conversion_totals()
  `)) as unknown as {
    outcome: string;
    total: string | number;
    first_at: string | null;
    last_at: string | null;
  }[];
  return rows.map((row) => ({
    outcome: row.outcome,
    total: Number(row.total),
    firstAt: row.first_at ? new Date(row.first_at).toISOString() : null,
    lastAt: row.last_at ? new Date(row.last_at).toISOString() : null,
  }));
}
