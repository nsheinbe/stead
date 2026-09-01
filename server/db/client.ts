import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;
type TransactionCallback = Parameters<Db["transaction"]>[0];
/** A connection with app.user_id set. Every tenant query takes one of these. */
export type Tx = Parameters<TransactionCallback>[0];

/**
 * Neon's pooled endpoint is PgBouncer in transaction mode, so named prepared
 * statements are off. `max: 1` keeps a serverless invocation to a single
 * backend connection.
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. ${hint}`);
  return value;
}

let appDb: Db | undefined;
let authDb: Db | undefined;

/** Tenant traffic. Must be the app_user role, under RLS. */
export function getAppDb(): Db {
  appDb ??= createDb(
    requireEnv("DATABASE_URL", "It is the app_user connection string on Neon's pooled host."),
  );
  return appDb;
}

/** Auth.js only. Must be the auth_user role, which reaches no tenant table. */
export function getAuthDb(): Db {
  authDb ??= createDb(
    requireEnv("AUTH_DATABASE_URL", "It is the auth_user connection string on Neon's pooled host."),
  );
  return authDb;
}

/** Migrations and seeding. The table owner, on Neon's direct host. */
export function ownerUrl(): string {
  return requireEnv(
    "DATABASE_URL_OWNER",
    "It is the table owner's connection string on Neon's direct (non-pooled) host, and it is for migrations only.",
  );
}

export class PrivilegedRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivilegedRoleError";
  }
}

type RoleShape = {
  role: string;
  is_superuser: boolean;
  bypasses_rls: boolean;
  owns_tenant_tables: boolean;
  rls_active: boolean;
};

export async function describeRole(db: Db | Tx): Promise<RoleShape> {
  const rows = (await db.execute(sql`
    SELECT current_user::text                                    AS role,
           COALESCE(r.rolsuper, false)                           AS is_superuser,
           COALESCE(r.rolbypassrls, false)                       AS bypasses_rls,
           pg_catalog.pg_get_userbyid(c.relowner) = current_user AS owns_tenant_tables,
           row_security_active('public.bookings')                AS rls_active
      FROM pg_catalog.pg_class c
      LEFT JOIN pg_catalog.pg_roles r ON r.rolname = current_user
     WHERE c.oid = 'public.bookings'::regclass
  `)) as unknown as RoleShape[];
  const shape = rows[0];
  if (!shape) throw new Error("Could not read the connection role");
  return shape;
}

/**
 * Fail closed.
 *
 * Every guarantee below the API is enforced by Postgres against whichever role
 * the connection string names. Point it at a privileged role and none of it
 * applies: nothing errors and no policy is violated, the queries simply return
 * everyone's rows.
 *
 * Neon makes that the likely mistake rather than a theoretical one. A project
 * hands you exactly one connection string, for a role that owns every table and
 * has BYPASSRLS. Pasting it into DATABASE_URL is the obvious move and it turns
 * the whole security model off silently, so refuse to serve a single tenant
 * query until the role has been checked. Once per process.
 */
const roleChecks = new WeakMap<object, Promise<void>>();

export function assertTenantRole(db: Db): Promise<void> {
  let check = roleChecks.get(db);
  if (!check) {
    check = (async () => {
      const shape = await describeRole(db);
      const reasons: string[] = [];
      if (shape.is_superuser) reasons.push("it is a superuser");
      if (shape.bypasses_rls) reasons.push("it has BYPASSRLS");
      if (shape.owns_tenant_tables) reasons.push("it owns the tenant tables");
      if (!shape.rls_active) reasons.push("row security is not active for it on public.bookings");

      if (reasons.length > 0) {
        throw new PrivilegedRoleError(
          `Refusing to serve tenant traffic as "${shape.role}": ${reasons.join(", ")}. ` +
            "Row-level security would not apply and queries would return every member's rows. " +
            "DATABASE_URL must be the app_user role on the pooled host; the owner belongs in " +
            "DATABASE_URL_OWNER and is for migrations only. See `npm run db:bootstrap-roles`.",
        );
      }
    })();
    // A failed check must not be cached as settled-bad forever in a way that
    // hides a fixed configuration on the next boot; it only lives for this process.
    roleChecks.set(db, check);
  }
  return check;
}

/**
 * Runs `fn` with the request's member identity visible to RLS.
 *
 * app.user_id is set with is_local => true, so it belongs to this transaction
 * and cannot leak into the next request that borrows the same pooled backend.
 * Anonymous requests pass null and see only what a policy grants to everyone.
 *
 * Transactions stay tight around database work — never around a Stripe call —
 * so an outbound HTTP request cannot pin a Postgres connection.
 */
export async function withMember<T>(
  db: Db,
  userId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  await assertTenantRole(db);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId ?? ""}, true)`);
    return fn(tx);
  });
}
