/**
 * Gives app_user and auth_user a login and a password, and prints the three
 * connection strings once.
 *
 * The roles themselves are created by drizzle/0002 so the schema is complete
 * after a migration; only the secrets are set here, because a password cannot
 * live in a committed migration. Run this after `npm run db:migrate`.
 *
 *   DATABASE_URL_OWNER=... npm run db:bootstrap-roles
 *
 * Passwords are generated unless APP_USER_PASSWORD / AUTH_USER_PASSWORD are
 * supplied. Nothing is written to disk. Re-running rotates them.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/** Neon's pooled host is the direct host with `-pooler` on the endpoint id. */
function toPooledUrl(url: URL): URL {
  const pooled = new URL(url.toString());
  if (!pooled.hostname.includes("-pooler.") && pooled.hostname.endsWith(".neon.tech")) {
    const [endpoint, ...rest] = pooled.hostname.split(".");
    pooled.hostname = [`${endpoint}-pooler`, ...rest].join(".");
  }
  return pooled;
}

function connectionStringFor(ownerUrl: string, role: string, password: string): string {
  const url = toPooledUrl(new URL(ownerUrl));
  url.username = role;
  url.password = password;
  return url.toString();
}

function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

export async function bootstrapRoles(
  ownerConnectionString: string,
  passwords: { appUser: string; authUser: string },
): Promise<void> {
  const sql = postgres(ownerConnectionString, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const missing = await sql<{ rolname: string }[]>`
      SELECT r.rolname FROM (VALUES ('app_user'), ('auth_user')) AS r(rolname)
       WHERE NOT EXISTS (SELECT 1 FROM pg_roles p WHERE p.rolname = r.rolname)
    `;
    if (missing.length > 0) {
      throw new Error(
        `Missing role(s): ${missing.map((r) => r.rolname).join(", ")}. Run npm run db:migrate first.`,
      );
    }
    await sql.unsafe(`ALTER ROLE app_user WITH LOGIN PASSWORD '${passwords.appUser.replace(/'/g, "''")}'`);
    await sql.unsafe(`ALTER ROLE auth_user WITH LOGIN PASSWORD '${passwords.authUser.replace(/'/g, "''")}'`);
  } finally {
    await sql.end();
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const owner = process.env.DATABASE_URL_OWNER;
  if (!owner) {
    console.error(
      "DATABASE_URL_OWNER is required — the table owner on Neon's direct (non-pooled) host.",
    );
    process.exit(1);
  }
  const appPassword = process.env.APP_USER_PASSWORD ?? generatePassword();
  const authPassword = process.env.AUTH_USER_PASSWORD ?? generatePassword();
  await bootstrapRoles(owner, { appUser: appPassword, authUser: authPassword });

  console.log(`
Roles are ready. Copy these into .env and your host's environment — they are
printed once and stored nowhere. Re-run this command to rotate them.

DATABASE_URL=${connectionStringFor(owner, "app_user", appPassword)}
AUTH_DATABASE_URL=${connectionStringFor(owner, "auth_user", authPassword)}
DATABASE_URL_OWNER=<the string you just passed in — migrations only, keep it out of the app>
`);
  process.exit(0);
}
