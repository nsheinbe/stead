/**
 * The host's Connect account, as stored on their profile.
 *
 * app_user holds no UPDATE grant on profiles.stripe_connect_account_id, so
 * attaching goes through a definer function that reads the member from
 * app.current_user_id(). There is deliberately no "detach" or "repoint":
 * changing where a host's earnings land is not a self-service operation.
 */
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { profiles } from "../db/schema";

export async function attachConnectAccount(tx: Tx, accountId: string): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.attach_connect_account(${accountId}) AS attached`,
  )) as unknown as { attached: boolean }[];
  return rows[0]?.attached === true;
}

export async function getConnectAccountId(tx: Tx, memberId: string): Promise<string | null> {
  const rows = await tx
    .select({ accountId: profiles.stripeConnectAccountId })
    .from(profiles)
    .where(eq(profiles.id, memberId))
    .limit(1);
  return rows[0]?.accountId ?? null;
}
