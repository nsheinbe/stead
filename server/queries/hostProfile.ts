/**
 * The host's Connect account, as stored on their profile.
 *
 * app_user holds no UPDATE grant on profiles.stripe_connect_account_id or the
 * readiness flags, so attaching and account.updated both go through definer
 * functions. There is deliberately no "detach" or "repoint": changing where a
 * host's earnings land is not a self-service operation.
 */
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { profiles } from "../db/schema";

export type ConnectReadiness = {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

export async function attachConnectAccount(tx: Tx, accountId: string): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.attach_connect_account(${accountId}) AS attached`,
  )) as unknown as { attached: boolean }[];
  return rows[0]?.attached === true;
}

export async function getConnectStatus(tx: Tx, memberId: string): Promise<ConnectReadiness> {
  const rows = await tx
    .select({
      accountId: profiles.stripeConnectAccountId,
      chargesEnabled: profiles.stripeChargesEnabled,
      payoutsEnabled: profiles.stripePayoutsEnabled,
      detailsSubmitted: profiles.stripeDetailsSubmitted,
    })
    .from(profiles)
    .where(eq(profiles.id, memberId))
    .limit(1);
  const row = rows[0];
  return {
    accountId: row?.accountId ?? null,
    chargesEnabled: row?.chargesEnabled === true,
    payoutsEnabled: row?.payoutsEnabled === true,
    detailsSubmitted: row?.detailsSubmitted === true,
  };
}

export async function getConnectAccountId(tx: Tx, memberId: string): Promise<string | null> {
  return (await getConnectStatus(tx, memberId)).accountId;
}

export async function recordConnectReadiness(
  tx: Tx,
  input: {
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  },
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.record_connect_readiness(
      ${input.accountId},
      ${input.chargesEnabled},
      ${input.payoutsEnabled},
      ${input.detailsSubmitted}
    ) AS recorded`,
  )) as unknown as { recorded: boolean }[];
  return rows[0]?.recorded === true;
}
