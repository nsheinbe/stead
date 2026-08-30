import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
`;

let pool: pg.Pool | undefined;
let setupPromise: Promise<pg.Pool> | undefined;

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

export async function getTestPool(): Promise<pg.Pool> {
  if (pool) return pool;
  if (setupPromise) return setupPromise;
  setupPromise = setup();
  return setupPromise;
}

async function setup(): Promise<pg.Pool> {
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for overlap / expire / RLS tests. " +
        "CI starts Postgres; locally use docker compose up db, then " +
        "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/stead_test npm test",
    );
  }

  const created = new Pool({ connectionString: url });
  await created.query(BOOTSTRAP_SQL);

  const { rows } = await created.query<{ reg: string | null }>(
    "SELECT to_regclass('public.bookings')::text AS reg",
  );
  if (!rows[0]?.reg) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migration = await readFile(
      path.resolve(here, "../../supabase/migrations/20260830180000_slice1_foundation.sql"),
      "utf8",
    );
    await created.query(migration);
  }

  pool = created;
  return created;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    setupPromise = undefined;
  }
}

export async function insertUser(
  client: pg.Pool | pg.PoolClient,
  id: string,
  email: string,
  displayName: string,
  isHost = false,
): Promise<void> {
  await client.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data)
     VALUES ($1, $2, jsonb_build_object('display_name', $3::text))
     ON CONFLICT (id) DO NOTHING`,
    [id, email, displayName],
  );
  await client.query(`UPDATE public.profiles SET is_host = $2 WHERE id = $1`, [id, isHost]);
}

export async function insertListing(
  client: pg.Pool | pg.PoolClient,
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
  await client.query(
    `INSERT INTO public.listings (
       id, host_id, title, description, type, city, country, timezone,
       nightly_rate_cents, deposit_cents, max_guests, status
     ) VALUES (
       $1, $2, $3, 'Test listing', 'entire_home', 'Hudson', 'US', $4,
       $5, $6, $7, 'active'
     )`,
    [
      opts.id,
      opts.hostId,
      opts.title ?? "Test cottage",
      opts.timezone ?? "America/New_York",
      opts.nightlyRateCents ?? 20000,
      opts.depositCents ?? 30000,
      opts.maxGuests ?? 4,
    ],
  );
}

export async function asGuest<T>(
  poolOrClient: pg.Pool,
  guestId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await poolOrClient.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [guestId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
