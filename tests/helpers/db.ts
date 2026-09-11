/**
 * Test database, wired the way production is.
 *
 * Two connections, because the whole point is that they are not the same:
 * the owner applies migrations and writes fixtures (it bypasses RLS), and
 * app_user is what the queries run as. Anything asserting about visibility must
 * go through the app_user connection or it is asserting nothing.
 *
 * Migrations come from drizzle/*.sql exactly as they do in production, so a
 * policy that only works in tests is impossible.
 */
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { createDb, withMember, type Db, type Tx } from "../../server/db/client";
import { profiles, users } from "../../server/db/schema";
import { runMigrations } from "../../scripts/migrate";
import { bootstrapRoles } from "../../scripts/bootstrap-roles";

export const TEST_APP_USER_PASSWORD = "app_user_test_password";
export const TEST_AUTH_USER_PASSWORD = "auth_user_test_password";
const APP_USER_PASSWORD = TEST_APP_USER_PASSWORD;
const AUTH_USER_PASSWORD = TEST_AUTH_USER_PASSWORD;

type Harness = {
  owner: Db;
  app: Db;
  /** Raw app_user driver, for probing what Postgres itself allows. */
  appSql: postgres.Sql;
  appUrl: string;
  ownerUrl: string;
};

let harness: Harness | undefined;
let setupPromise: Promise<Harness> | undefined;

export function ownerDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL_OWNER;
}

export function id(): string {
  return crypto.randomUUID();
}

export function urlAs(base: string, role: string, password: string): string {
  const url = new URL(base);
  url.username = role;
  url.password = password;
  return url.toString();
}

export function getHarness(): Promise<Harness> {
  if (harness) return Promise.resolve(harness);
  setupPromise ??= setup();
  return setupPromise;
}

async function setup(): Promise<Harness> {
  const owner = ownerDatabaseUrl();
  if (!owner) {
    throw new Error(
      "DATABASE_URL_OWNER is required for the database tests. Locally: " +
        "docker compose --profile test up -d db_test, then " +
        "DATABASE_URL_OWNER=postgres://postgres:postgres@127.0.0.1:5433/stead_test npm test",
    );
  }
  await runMigrations(owner);
  await bootstrapRoles(owner, { appUser: APP_USER_PASSWORD, authUser: AUTH_USER_PASSWORD });

  const appUrl = urlAs(owner, "app_user", APP_USER_PASSWORD);
  harness = {
    owner: createDb(owner),
    app: createDb(appUrl),
    appSql: postgres(appUrl, { max: 1, prepare: false, onnotice: () => {} }),
    appUrl,
    ownerUrl: owner,
  };
  return harness;
}

export async function closeTestDb(): Promise<void> {
  if (!harness) return;
  const clients = [harness.owner, harness.app].map(
    (db) => (db as unknown as { $client: postgres.Sql }).$client,
  );
  await Promise.all([...clients.map((c) => c.end()), harness.appSql.end()]);
  harness = undefined;
  setupPromise = undefined;
}

/** Runs `fn` as app_user with the given member id visible to RLS. */
export async function asMember<T>(memberId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const { app } = await getHarness();
  return withMember(app, memberId, fn);
}

/** Fixture writes run as the owner, which bypasses RLS by design. */
export async function asOwner<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const { owner } = await getHarness();
  return fn(owner);
}

/** Raw app_user SQL, to prove Postgres refuses rather than the query layer. */
export async function rawAsMember<T>(
  memberId: string | null,
  fn: (client: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const { appSql } = await getHarness();
  return appSql.begin(async (tx) => {
    await tx`SELECT set_config('app.user_id', ${memberId ?? ""}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Creates the member and, via the on_user_created trigger, their profile. */
export async function insertMember(
  memberId: string,
  email: string,
  displayName: string,
  isHost = false,
): Promise<void> {
  await asOwner(async (db) => {
    await db
      .insert(users)
      .values({ id: memberId, email, name: displayName, emailVerified: new Date() })
      .onConflictDoNothing({ target: users.id });
    await db
      .update(profiles)
      .set({ isHost, displayName })
      .where(sql`${profiles.id} = ${memberId}::uuid`);
  });
}

export async function insertListing(opts: {
  id: string;
  hostId: string;
  title?: string;
  type?: "entire_home" | "apartment" | "private_room";
  city?: string;
  timezone?: string;
  nightlyRateCents?: number;
  depositCents?: number;
  maxGuests?: number;
  instantBook?: boolean;
  status?: "draft" | "active" | "paused";
  cancellationPolicy?: "flexible" | "moderate" | "strict";
}): Promise<void> {
  await asOwner(async (db) => {
    await db.execute(sql`
      INSERT INTO public.listings (
        id, host_id, title, description, type, city, country, timezone,
        nightly_rate_cents, deposit_cents, max_guests, instant_book, status, cancellation_policy
      ) VALUES (
        ${opts.id}::uuid, ${opts.hostId}::uuid, ${opts.title ?? "Test cottage"}, 'Test listing',
        ${opts.type ?? "entire_home"}::public.listing_type, ${opts.city ?? "Hudson"}, 'US',
        ${opts.timezone ?? "America/New_York"},
        ${opts.nightlyRateCents ?? 20000}, ${opts.depositCents ?? 30000}, ${opts.maxGuests ?? 4},
        ${opts.instantBook ?? false},
        ${opts.status ?? "active"}::public.listing_status,
        ${opts.cancellationPolicy ?? "moderate"}::public.cancellation_policy
      )
      ON CONFLICT (id) DO NOTHING
    `);
  });
}

type BookingRow = {
  id?: string;
  listingId: string;
  guestId: string;
  checkIn: string;
  checkOut: string;
  status?: string;
  createdAt?: string;
  paymentIntentId?: string;
  cancellationPolicy?: "flexible" | "moderate" | "strict";
};

/**
 * Raw insert as the owner, so tests can exercise the exclusion constraint,
 * backdate created_at, and set up states app_user is not allowed to write.
 */
export async function insertBooking(row: BookingRow): Promise<string> {
  const nights = Math.round(
    (Date.parse(`${row.checkOut}T00:00:00Z`) - Date.parse(`${row.checkIn}T00:00:00Z`)) / 86_400_000,
  );
  const subtotal = 20000 * nights;
  const fee = Math.trunc((subtotal * 200) / 10_000);
  return asOwner(async (db) => {
    const result = (await db.execute<{ id: string }>(sql`
      INSERT INTO public.bookings (
        id, listing_id, guest_id, check_in, check_out, guests, nights,
        nightly_rate_cents, stay_subtotal_cents, network_fee_cents, network_fee_bps,
        guest_total_cents,
        deposit_cents, cancellation_policy, status, created_at, stripe_payment_intent_id
      ) VALUES (
        COALESCE(${row.id ?? null}::uuid, gen_random_uuid()),
        ${row.listingId}::uuid, ${row.guestId}::uuid, ${row.checkIn}::date, ${row.checkOut}::date,
        2, ${nights}, 20000, ${subtotal}, ${fee}, 200, ${subtotal + fee}, 30000,
        ${row.cancellationPolicy ?? "moderate"}::public.cancellation_policy,
        ${row.status ?? "pending_payment"}::public.booking_status,
        COALESCE(${row.createdAt ?? null}::timestamptz, now()),
        ${row.paymentIntentId ?? null}
      )
      RETURNING id
    `)) as unknown as { id: string }[];
    const inserted = result[0]?.id;
    if (!inserted) throw new Error("booking insert returned no id");
    return inserted;
  });
}

export async function bookingStatus(bookingId: string): Promise<string | undefined> {
  return asOwner(async (db) => {
    const rows = (await db.execute<{ status: string }>(
      sql`SELECT status::text FROM public.bookings WHERE id = ${bookingId}::uuid`,
    )) as unknown as { status: string }[];
    return rows[0]?.status;
  });
}
