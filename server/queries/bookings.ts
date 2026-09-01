/**
 * Booking reads and money/state writes.
 *
 * With RLS gone, the `bookings_party_read` policy lives here: every read takes
 * a viewer id and resolves to the guest on the booking or the host of its
 * listing. There is no unscoped "get booking by id" export on purpose.
 */
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  bookings,
  cronHeartbeats,
  escrowAudit,
  escrowDeposits,
  listingBlackouts,
  listingPhotos,
  listings,
  stripeEvents,
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

export async function listTripsForGuest(db: Db, guestId: string): Promise<TripSummary[]> {
  const rows = await db.query.bookings.findMany({
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
  db: Db,
  bookingId: string,
  viewerId: string,
): Promise<TripDetail | null> {
  const hostOwnsListing = sql`EXISTS (
    SELECT 1 FROM ${listings} l
     WHERE l.id = ${bookings.listingId}
       AND l.host_id = ${viewerId}::uuid
  )`;

  const row = await db.query.bookings.findFirst({
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

export async function getBookableListing(db: Db, listingId: string) {
  return db.query.listings.findFirst({
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
  db: Db,
  listingId: string,
  checkIn: string,
  checkOut: string,
): Promise<boolean> {
  const rows = await db
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
 * Inserts the booking, its escrow row, and the opening audit entry in one
 * transaction. Availability is never checked first — the exclusion constraint
 * decides, and a violation surfaces as DateConflictError.
 */
export async function createBookingWithEscrow(
  db: Db,
  booking: NewBooking,
  deposit: { amountCents: number; method: "auth_hold" | "card_on_file"; stripeSetupIntentId: string | null },
  auditMeta: Record<string, unknown>,
): Promise<{ bookingId: string; depositId: string }> {
  try {
    return await db.transaction(async (tx) => {
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
    });
  } catch (err) {
    if (isExclusionViolation(err)) throw new DateConflictError();
    throw err;
  }
}

/** Webhook path: pending_payment → confirmed for a settled PaymentIntent. */
export async function confirmBookingForPaymentIntent(
  db: Db,
  paymentIntentId: string,
): Promise<boolean> {
  const updated = await db
    .update(bookings)
    .set({ status: "confirmed" })
    .where(
      and(
        eq(bookings.stripePaymentIntentId, paymentIntentId),
        eq(bookings.status, "pending_payment"),
      ),
    )
    .returning({ id: bookings.id });
  return updated.length > 0;
}

/** Insert-first idempotency. False means this event id was already handled. */
export async function claimStripeEvent(db: Db, id: string, type: string): Promise<boolean> {
  const inserted = await db
    .insert(stripeEvents)
    .values({ id, type })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id });
  return inserted.length > 0;
}

/**
 * Abandoned checkouts must not hold dates hostage behind the exclusion
 * constraint. Runs on a schedule; writes a heartbeat either way.
 */
export async function expirePendingBookings(db: Db, ttlMinutes: number): Promise<number> {
  const ttl = Number.isInteger(ttlMinutes) && ttlMinutes >= 1 ? ttlMinutes : 30;
  const expired = await db
    .update(bookings)
    .set({ status: "expired" })
    .where(
      and(
        eq(bookings.status, "pending_payment"),
        sql`${bookings.createdAt} < now() - make_interval(mins => ${ttl})`,
      ),
    )
    .returning({ id: bookings.id });

  await recordHeartbeat(db, "expire-pending", null);
  return expired.length;
}

export async function recordHeartbeat(db: Db, job: string, error: string | null): Promise<void> {
  await db
    .insert(cronHeartbeats)
    .values({ job, lastOk: error ? null : new Date(), lastError: error })
    .onConflictDoUpdate({
      target: cronHeartbeats.job,
      set: error ? { lastError: error } : { lastOk: new Date(), lastError: null },
    });
}

export async function markBookingExpired(db: Db, bookingId: string): Promise<void> {
  await db
    .update(bookings)
    .set({ status: "expired" })
    .where(and(eq(bookings.id, bookingId), inArray(bookings.status, ["pending_payment"])));
}
