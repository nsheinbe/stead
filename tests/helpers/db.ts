/**
 * Test database. Points at a throwaway Postgres (docker compose up db_test, or
 * the CI service) and applies drizzle/*.sql exactly as production does — no
 * hand-maintained bootstrap SQL, so a migration that only works in tests is
 * impossible.
 */
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../../server/db/client";
import { profiles, users } from "../../server/db/schema";
import { runMigrations } from "../../scripts/migrate";

let db: Db | undefined;
let setupPromise: Promise<Db> | undefined;

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

export function id(): string {
  return crypto.randomUUID();
}

export function getTestDb(): Promise<Db> {
  if (db) return Promise.resolve(db);
  setupPromise ??= setup();
  return setupPromise;
}

async function setup(): Promise<Db> {
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for the database tests. Locally: docker compose --profile test up -d db_test, " +
        "then DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/stead_test npm test",
    );
  }
  await runMigrations(url);
  db = createDb(url);
  return db;
}

export async function closeTestDb(): Promise<void> {
  if (db) {
    // drizzle-orm/postgres-js keeps the driver on the session property.
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    db = undefined;
    setupPromise = undefined;
  }
}

/** Creates the member and, via the on_user_created trigger, their profile. */
export async function insertMember(
  database: Db,
  memberId: string,
  email: string,
  displayName: string,
  isHost = false,
): Promise<void> {
  await database
    .insert(users)
    .values({ id: memberId, email, name: displayName, emailVerified: new Date() })
    .onConflictDoNothing({ target: users.id });
  await database
    .update(profiles)
    .set({ isHost, displayName })
    .where(sql`${profiles.id} = ${memberId}::uuid`);
}

export async function insertListing(
  database: Db,
  opts: {
    id: string;
    hostId: string;
    title?: string;
    timezone?: string;
    nightlyRateCents?: number;
    depositCents?: number;
    maxGuests?: number;
  },
): Promise<void> {
  await database.execute(sql`
    INSERT INTO public.listings (
      id, host_id, title, description, type, city, country, timezone,
      nightly_rate_cents, deposit_cents, max_guests, status
    ) VALUES (
      ${opts.id}::uuid, ${opts.hostId}::uuid, ${opts.title ?? "Test cottage"}, 'Test listing',
      'entire_home', 'Hudson', 'US', ${opts.timezone ?? "America/New_York"},
      ${opts.nightlyRateCents ?? 20000}, ${opts.depositCents ?? 30000}, ${opts.maxGuests ?? 4}, 'active'
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

type BookingRow = {
  id?: string;
  listingId: string;
  guestId: string;
  checkIn: string;
  checkOut: string;
  status?: string;
  createdAt?: string;
};

/**
 * Raw insert so tests can exercise the exclusion constraint and backdate
 * created_at without going through the booking route.
 */
export async function insertBooking(database: Db, row: BookingRow): Promise<string> {
  const nights = Math.round(
    (Date.parse(`${row.checkOut}T00:00:00Z`) - Date.parse(`${row.checkIn}T00:00:00Z`)) / 86_400_000,
  );
  const subtotal = 20000 * nights;
  const fee = Math.trunc((subtotal * 200) / 10_000);
  const result = await database.execute<{ id: string }>(sql`
    INSERT INTO public.bookings (
      id, listing_id, guest_id, check_in, check_out, guests, nights,
      nightly_rate_cents, stay_subtotal_cents, network_fee_cents, guest_total_cents,
      deposit_cents, cancellation_policy, status, created_at
    ) VALUES (
      COALESCE(${row.id ?? null}::uuid, gen_random_uuid()),
      ${row.listingId}::uuid, ${row.guestId}::uuid, ${row.checkIn}::date, ${row.checkOut}::date,
      2, ${nights}, 20000, ${subtotal}, ${fee}, ${subtotal + fee}, 30000, 'moderate',
      ${row.status ?? "pending_payment"}::public.booking_status,
      COALESCE(${row.createdAt ?? null}::timestamptz, now())
    )
    RETURNING id
  `);
  const rows = result as unknown as { id: string }[];
  const inserted = rows[0]?.id;
  if (!inserted) throw new Error("booking insert returned no id");
  return inserted;
}
