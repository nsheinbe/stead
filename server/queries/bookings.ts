/**
 * Booking reads and money/state writes.
 *
 * Every function takes a `Tx` — a transaction with app.user_id set — so the
 * policies in drizzle/0002 are what decide which rows come back. The explicit
 * `guestId` filters below are belt to that braces: they make the intent legible
 * and keep the API honest about what it is asking for, but if one of them were
 * dropped tomorrow the database would still refuse to hand over someone else's
 * booking.
 *
 * State transitions are not writes from here. app_user has no UPDATE grant on
 * bookings; the four app.* functions are the only way a row changes state.
 */
import { and, asc, eq, lt, or, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import {
  bookings,
  escrowAudit,
  escrowDeposits,
  listingBlackouts,
  listingPhotos,
  listings,
} from "../db/schema";
import type { TripDetail, TripSummary } from "../../src/lib/types";

export class DateConflictError extends Error {
  constructor() {
    super("Those dates were just taken. Try another stay — the calendar is the lock.");
    this.name = "DateConflictError";
  }
}

/**
 * Postgres exclusion_violation (23P01) — the gist constraint is the
 * availability lock. Drizzle wraps driver errors in DrizzleQueryError, so the
 * PostgresError with the code on it sits somewhere down the `cause` chain.
 */
export function isExclusionViolation(err: unknown): boolean {
  for (let current = err, depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") break;
    if ((current as { code?: string }).code === "23P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function listTripsForGuest(tx: Tx, guestId: string): Promise<TripSummary[]> {
  const rows = await tx.query.bookings.findMany({
    where: eq(bookings.guestId, guestId),
    orderBy: (b, { desc }) => desc(b.checkIn),
    with: {
      listing: {
        columns: { id: true, title: true, city: true, region: true, timezone: true },
        with: { photos: { orderBy: asc(listingPhotos.sortOrder) } },
      },
    },
  });

  return rows.map((b) => ({
    id: b.id,
    status: b.status,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    guestTotalCents: b.guestTotalCents,
    depositCents: b.depositCents,
    listing: {
      id: b.listing.id,
      title: b.listing.title,
      city: b.listing.city,
      region: b.listing.region,
      timezone: b.listing.timezone,
      photos: b.listing.photos.map((p) => ({
        id: p.id,
        storagePath: p.storagePath,
        sortOrder: p.sortOrder,
      })),
    },
  }));
}

/** Visible to the guest on the booking and to the host of its listing. Nobody else. */
export async function getTripForParty(
  tx: Tx,
  bookingId: string,
  viewerId: string,
): Promise<TripDetail | null> {
  const hostOwnsListing = sql`EXISTS (
    SELECT 1 FROM ${listings} l
     WHERE l.id = ${bookings.listingId}
       AND l.host_id = ${viewerId}::uuid
  )`;

  const row = await tx.query.bookings.findFirst({
    where: and(eq(bookings.id, bookingId), or(eq(bookings.guestId, viewerId), hostOwnsListing)),
    with: {
      listing: {
        columns: { id: true, title: true, city: true, region: true, timezone: true },
        with: { photos: { orderBy: asc(listingPhotos.sortOrder) } },
      },
      escrow: { columns: { amountCents: true, state: true } },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    status: row.status,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    nights: row.nights,
    guests: row.guests,
    nightlyRateCents: row.nightlyRateCents,
    staySubtotalCents: row.staySubtotalCents,
    networkFeeCents: row.networkFeeCents,
    guestTotalCents: row.guestTotalCents,
    depositCents: row.depositCents,
    cancellationPolicy: row.cancellationPolicy,
    createdAt: row.createdAt.toISOString(),
    escrow: row.escrow ? { amountCents: row.escrow.amountCents, state: row.escrow.state } : null,
    listing: {
      id: row.listing.id,
      title: row.listing.title,
      city: row.listing.city,
      region: row.listing.region,
      timezone: row.listing.timezone,
      photos: row.listing.photos.map((p) => ({
        id: p.id,
        storagePath: p.storagePath,
        sortOrder: p.sortOrder,
      })),
    },
  };
}

export async function getBookableListing(tx: Tx, listingId: string) {
  return tx.query.listings.findFirst({
    where: eq(listings.id, listingId),
    columns: {
      id: true,
      hostId: true,
      status: true,
      nightlyRateCents: true,
      depositCents: true,
      maxGuests: true,
      cancellationPolicy: true,
      timezone: true,
    },
  });
}

export async function overlapsBlackout(
  tx: Tx,
  listingId: string,
  checkIn: string,
  checkOut: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: listingBlackouts.id })
    .from(listingBlackouts)
    .where(
      and(
        eq(listingBlackouts.listingId, listingId),
        lt(listingBlackouts.startDate, checkOut),
        sql`${listingBlackouts.endDate} > ${checkIn}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export type NewBooking = typeof bookings.$inferInsert;

/**
 * Inserts the booking, its escrow row, and the opening audit entry. The caller
 * already holds the transaction, so all three land together or not at all.
 *
 * Availability is never checked first — the exclusion constraint decides, and a
 * violation surfaces as DateConflictError. The insert policies additionally
 * require the booking to be the caller's own and to start in pending_payment,
 * so a member cannot open a checkout in someone else's name.
 */
export async function createBookingWithEscrow(
  tx: Tx,
  booking: NewBooking,
  deposit: {
    amountCents: number;
    method: "auth_hold" | "card_on_file";
    stripeSetupIntentId: string | null;
  },
  auditMeta: Record<string, unknown>,
): Promise<{ bookingId: string; depositId: string }> {
  try {
    const [created] = await tx.insert(bookings).values(booking).returning({ id: bookings.id });
    if (!created) throw new Error("Could not create booking");

    const [escrow] = await tx
      .insert(escrowDeposits)
      .values({
        bookingId: created.id,
        amountCents: deposit.amountCents,
        state: "scheduled",
        method: deposit.method,
        stripeSetupIntentId: deposit.stripeSetupIntentId,
      })
      .returning({ id: escrowDeposits.id });
    if (!escrow) throw new Error("Could not schedule the deposit in neutral escrow");

    await tx.insert(escrowAudit).values({
      depositId: escrow.id,
      fromState: null,
      toState: "scheduled",
      actor: "create-booking",
      meta: auditMeta,
    });

    return { bookingId: created.id, depositId: escrow.id };
  } catch (err) {
    if (isExclusionViolation(err)) throw new DateConflictError();
    throw err;
  }
}

// --- Privileged transitions ---------------------------------------------------
//
// app_user cannot UPDATE bookings or touch stripe_events and cron_heartbeats at
// all. These call the SECURITY DEFINER functions in drizzle/0002, which are the
// complete, enumerated list of state changes the API can make.

/** Webhook path: pending_payment → confirmed. False on a replay. */
export async function confirmBookingForPaymentIntent(
  tx: Tx,
  paymentIntentId: string,
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.confirm_booking_for_payment_intent(${paymentIntentId}) AS confirmed`,
  )) as unknown as { confirmed: boolean }[];
  return rows[0]?.confirmed ?? false;
}

/** Insert-first idempotency. False means this event id was already handled. */
export async function claimStripeEvent(tx: Tx, id: string, type: string): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT app.claim_stripe_event(${id}, ${type}) AS claimed`,
  )) as unknown as { claimed: boolean }[];
  return rows[0]?.claimed ?? false;
}

export async function expirePendingBookings(tx: Tx, ttlMinutes: number): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT app.expire_pending_bookings(${ttlMinutes}) AS expired`,
  )) as unknown as { expired: number }[];
  return Number(rows[0]?.expired ?? 0);
}

export async function recordHeartbeat(tx: Tx, job: string, error: string | null): Promise<void> {
  await tx.execute(sql`SELECT app.record_heartbeat(${job}, ${error})`);
}
