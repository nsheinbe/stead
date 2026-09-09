/**
 * The payout ledger. Rows record settlement Stripe already performed on a
 * destination charge, so nothing here moves money — recordPayout is called
 * from the webhook, which is not a member, hence the definer function.
 */
import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { payouts } from "../db/schema";

export async function recordPayout(
  tx: Tx,
  paymentIntentId: string,
  transferId: string | null,
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.record_payout(${paymentIntentId}, ${transferId}) AS recorded`,
  )) as unknown as { recorded: boolean }[];
  return rows[0]?.recorded === true;
}

export interface HostPayout {
  id: string;
  bookingId: string;
  amountCents: number;
  state: string;
  paidAt: string | null;
  stripeTransferId: string | null;
}

/** Scoped by payouts_host_read to the caller's own rows. */
export async function listHostPayouts(tx: Tx, hostId: string): Promise<HostPayout[]> {
  const rows = await tx
    .select()
    .from(payouts)
    .where(eq(payouts.hostId, hostId))
    .orderBy(desc(payouts.paidAt));
  return rows.map((row) => ({
    id: row.id,
    bookingId: row.bookingId,
    amountCents: row.amountCents,
    state: row.state,
    paidAt: row.paidAt?.toISOString() ?? null,
    stripeTransferId: row.stripeTransferId,
  }));
}
