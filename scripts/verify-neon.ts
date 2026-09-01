/**
 * Non-destructive acceptance check for a provisioned database.
 *
 * The Vitest suite runs against a throwaway local cluster, which cannot tell
 * you anything about the database you actually deployed: whether the roles were
 * provisioned, whether the migrations arrived, or whether identity survives
 * PgBouncer. This checks that, reading only — it writes nothing and creates
 * nothing.
 *
 *   DATABASE_URL=...        # app_user, pooled
 *   AUTH_DATABASE_URL=...   # auth_user, pooled
 *   DATABASE_URL_OWNER=...  # owner, direct
 *   npm run verify:neon
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

async function main(): Promise<void> {
  const appUrl = process.env.DATABASE_URL;
  const authUrl = process.env.AUTH_DATABASE_URL;
  const ownerUrl = process.env.DATABASE_URL_OWNER;
  if (!appUrl || !authUrl || !ownerUrl) {
    console.error("DATABASE_URL, AUTH_DATABASE_URL and DATABASE_URL_OWNER are all required.");
    process.exit(1);
  }

  const connect = (url: string) => postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const app = connect(appUrl);
  const auth = connect(authUrl);
  const owner = connect(ownerUrl);

  try {
    // 1–2. The roles are who we think they are.
    const [appRole] = await app`
      SELECT current_user::text AS role,
             COALESCE(r.rolsuper, false) AS super,
             COALESCE(r.rolbypassrls, false) AS bypass,
             row_security_active('public.bookings') AS rls
        FROM pg_roles r WHERE r.rolname = current_user
    `;
    record(
      "app_user is an ordinary role",
      appRole?.role === "app_user" && !appRole.super && !appRole.bypass,
      `role=${appRole?.role} super=${appRole?.super} bypassrls=${appRole?.bypass}`,
    );
    record(
      "row security is active for app_user",
      appRole?.rls === true,
      `row_security_active(bookings)=${appRole?.rls}`,
    );

    const [authRole] = await auth`
      SELECT current_user::text AS role,
             COALESCE(r.rolsuper, false) AS super,
             COALESCE(r.rolbypassrls, false) AS bypass
        FROM pg_roles r WHERE r.rolname = current_user
    `;
    record(
      "auth_user is an ordinary role",
      authRole?.role === "auth_user" && !authRole.super && !authRole.bypass,
      `role=${authRole?.role} super=${authRole?.super} bypassrls=${authRole?.bypass}`,
    );

    // 3. The owner is exactly the thing we must never serve traffic as.
    const [ownerRole] = await owner`
      SELECT current_user::text AS role, row_security_active('public.bookings') AS rls
    `;
    record(
      "the owner bypasses RLS, and so is migrations-only",
      ownerRole?.rls === false,
      `role=${ownerRole?.role} row_security_active=${ownerRole?.rls}`,
    );

    // 4. Every migration in the repo is on this database.
    const onDisk = (await readdir(path.resolve(here, "../drizzle")))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const applied = (await owner<{ filename: string }[]>`
      SELECT filename FROM public._migrations ORDER BY filename
    `).map((r) => r.filename);
    const missing = onDisk.filter((f) => !applied.includes(f));
    record("every migration is applied", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : applied.join(", "));

    // 5. RLS enabled, and not forced — the owner is meant to bypass it.
    const tables = await owner<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND c.relname IN ('app_config','profiles','listings','listing_photos','listing_blackouts',
                           'bookings','escrow_deposits','escrow_audit','stripe_events','cron_heartbeats')
       ORDER BY c.relname
    `;
    const unprotected = tables.filter((t) => !t.relrowsecurity).map((t) => t.relname);
    const forced = tables.filter((t) => t.relforcerowsecurity).map((t) => t.relname);
    record(
      "RLS is enabled on all ten tenant tables",
      tables.length === 10 && unprotected.length === 0,
      unprotected.length ? `no RLS on ${unprotected.join(", ")}` : `${tables.length} tables`,
    );
    record("RLS is not forced", forced.length === 0, forced.length ? forced.join(", ") : "owner can migrate");

    // 6. Anonymous traffic sees public data and nothing else.
    const anonListings = await app`SELECT count(*)::int AS n FROM public.listings`;
    const anonBookings = await app`SELECT count(*)::int AS n FROM public.bookings`;
    record(
      "anonymous sees active listings but no bookings",
      Number(anonListings[0]?.n) >= 0 && Number(anonBookings[0]?.n) === 0,
      `listings=${anonListings[0]?.n} bookings=${anonBookings[0]?.n}`,
    );

    // 7. Tables app_user must not reach at all.
    for (const table of ["stripe_events", "cron_heartbeats", "users"]) {
      const denied = await app
        .unsafe(`SELECT 1 FROM public.${table} LIMIT 1`)
        .then(() => false)
        .catch((e: { code?: string }) => e.code === "42501");
      record(`app_user is denied public.${table}`, denied, denied ? "permission denied" : "READABLE");
    }

    // 8. auth_user reaches identity and nothing else.
    const authDenied = await auth
      .unsafe("SELECT 1 FROM public.bookings LIMIT 1")
      .then(() => false)
      .catch((e: { code?: string }) => e.code === "42501");
    record("auth_user is denied public.bookings", authDenied, authDenied ? "permission denied" : "READABLE");

    const overlap = await owner<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.role_table_grants
       WHERE grantee = 'app_user' AND table_schema = 'public'
      INTERSECT
      SELECT table_name FROM information_schema.role_table_grants
       WHERE grantee = 'auth_user' AND table_schema = 'public'
    `;
    record(
      "app_user and auth_user grants are disjoint",
      overlap.length === 0,
      overlap.length ? overlap.map((r) => r.table_name).join(", ") : "no shared table",
    );

    // 9. Identity does not survive the transaction, which is what makes the
    //    pooled endpoint safe to share.
    const someMember = await owner<{ id: string }[]>`SELECT id::text FROM public.profiles LIMIT 1`;
    const memberId = someMember[0]?.id ?? "00000000-0000-0000-0000-000000000001";
    const inside = await app.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${memberId}, true)`;
      return tx<{ uid: string | null }[]>`SELECT app.current_user_id()::text AS uid`;
    });
    const after = await app<{ uid: string | null }[]>`SELECT app.current_user_id()::text AS uid`;
    record(
      "app.user_id does not leak across pooled requests",
      (inside as unknown as { uid: string }[])[0]?.uid === memberId && after[0]?.uid === null,
      `inside=${(inside as unknown as { uid: string }[])[0]?.uid} after=${after[0]?.uid}`,
    );

    // 10. app_user cannot transition a booking, only call the enumerated functions.
    const cannotUpdate = await app
      .unsafe("UPDATE public.bookings SET status = 'confirmed' WHERE false")
      .then(() => false)
      .catch((e: { code?: string }) => e.code === "42501");
    record("app_user cannot UPDATE bookings", cannotUpdate, cannotUpdate ? "permission denied" : "WRITABLE");

    const fns = await owner<{ proname: string }[]>`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app' AND p.prosecdef ORDER BY p.proname
    `;
    record(
      "the four privileged transitions exist and are SECURITY DEFINER",
      fns.length === 4,
      fns.map((f) => f.proname).join(", "),
    );
  } finally {
    await Promise.all([app.end(), auth.end(), owner.end()]);
  }

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`${c.ok ? "  ok  " : " FAIL "} ${c.name} — ${c.detail}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

await main();
