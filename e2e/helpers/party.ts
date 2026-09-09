/**
 * Shared fixtures for Playwright. Members and listings are unique per test so
 * leftover rows from Vitest on the same database cannot collide.
 */
import { addDays, format } from "date-fns";
import { sql } from "drizzle-orm";
import {
  asOwner,
  getHarness,
  id,
  insertListing,
  insertMember,
  rawAsMember,
} from "../../tests/helpers/db";
import { E2E_CRON_SECRET, mintSessionCookie, mintSessionValue, SESSION_COOKIE } from "../../tests/helpers/session";

export function isoDay(offset: number): string {
  return format(addDays(new Date(), offset), "yyyy-MM-dd");
}

export async function seedBookableParty(title = "E2E cottage") {
  const hostId = id();
  const guestId = id();
  const listingId = id();
  await insertMember(hostId, `host-${hostId}@stead.example`, "E2E Host", true);
  await insertMember(guestId, `guest-${guestId}@stead.example`, "E2E Guest");
  await insertListing({
    id: listingId,
    hostId,
    title,
    cancellationPolicy: "flexible",
    timezone: "UTC",
  });
  const cookie = await mintSessionCookie({
    id: guestId,
    email: `guest-${guestId}@stead.example`,
    name: "E2E Guest",
  });
  const token = await mintSessionValue({
    id: guestId,
    email: `guest-${guestId}@stead.example`,
    name: "E2E Guest",
  });
  return { hostId, guestId, listingId, cookie, token, title };
}

/** Stamp a real test-mode Connect acct_ on the host. Owner write — members cannot. */
export async function attachTestConnectAccount(hostId: string, accountId: string): Promise<void> {
  if (!/^acct_[A-Za-z0-9_]+$/.test(accountId)) {
    throw new Error("STRIPE_TEST_CONNECT_ACCOUNT_ID must be an acct_… id, not a secret key");
  }
  await asOwner(async (db) => {
    await db.execute(sql`
      UPDATE public.profiles
         SET stripe_connect_account_id = ${accountId}, is_host = true
       WHERE id = ${hostId}::uuid
    `);
  });
}

export function cronHeaders(): Record<string, string> {
  return { authorization: `Bearer ${process.env.CRON_SECRET ?? E2E_CRON_SECRET}` };
}

export async function paymentIntentId(bookingId: string): Promise<string> {
  return asOwner(async (db) => {
    const rows = (await db.execute(
      sql`SELECT stripe_payment_intent_id AS id FROM public.bookings WHERE id = ${bookingId}::uuid`,
    )) as unknown as { id: string | null }[];
    const pi = rows[0]?.id;
    if (!pi) throw new Error("booking has no payment intent");
    return pi;
  });
}

export async function confirmBooking(bookingId: string): Promise<void> {
  const pi = await paymentIntentId(bookingId);
  const confirmed = (await rawAsMember(
    null,
    (tx) => tx`SELECT app.confirm_booking_for_payment_intent(${pi}) AS ok`,
  )) as { ok: boolean }[];
  if (!confirmed[0]?.ok) throw new Error("confirm_booking_for_payment_intent returned false");
}

export async function backdateStay(bookingId: string, checkInOffset = -40, nights = 30): Promise<void> {
  const checkIn = isoDay(checkInOffset);
  const checkOut = isoDay(checkInOffset + nights);
  await asOwner(async (db) => {
    await db.execute(sql`
      UPDATE public.bookings
         SET check_in = ${checkIn}::date, check_out = ${checkOut}::date, nights = ${nights}
       WHERE id = ${bookingId}::uuid
    `);
  });
}

export async function closeClaimWindow(bookingId: string): Promise<void> {
  await asOwner(async (db) => {
    await db.execute(sql`
      UPDATE public.escrow_deposits
         SET window_closes_at = now() - interval '1 hour'
       WHERE booking_id = ${bookingId}::uuid
    `);
  });
}

export async function sessionCookieHeader(token: string) {
  return { cookie: `${SESSION_COOKIE}=${token}` };
}

/** Ensures the test harness (migrate + roles) is up before a spec talks to SQL. */
export async function ensureDb(): Promise<void> {
  await getHarness();
}
