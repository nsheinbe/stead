/**
 * Starts the app the way Playwright talks to it: migrate the test database,
 * provision app_user / auth_user with the same passwords the Vitest harness
 * uses, then serve. Prefers the built SPA (`npm start`) so CI is production-
 * shaped; falls back to Vite when dist/ is missing.
 *
 * Stripe keys are cleared so create-booking takes the mock-payment path,
 * unless STRIPE_E2E=1 (the gated live suite in playwright.stripe.config.ts).
 */
import { existsSync } from "node:fs";
import { bootstrapRoles } from "./bootstrap-roles";
import { runMigrations } from "./migrate";
import {
  TEST_APP_USER_PASSWORD,
  TEST_AUTH_USER_PASSWORD,
  urlAs,
} from "../tests/helpers/db";
import { E2E_AUTH_SECRET, E2E_CRON_SECRET } from "../tests/helpers/session";

const owner = process.env.DATABASE_URL_OWNER;
if (!owner) {
  console.error(
    "DATABASE_URL_OWNER is required for the e2e server. Locally: docker compose --profile test up -d db_test",
  );
  process.exit(1);
}

const port = process.env.PORT ?? "4173";

process.env.AUTH_SECRET ??= E2E_AUTH_SECRET;
process.env.CRON_SECRET ??= E2E_CRON_SECRET;
process.env.PORT = port;
process.env.APP_URL ??= `http://127.0.0.1:${port}`;
// Lifecycle and UI specs create bookings. Production Soft Dist leaves this unset.
process.env.ALLOW_GUEST_BOOKINGS ??= "1";
if (process.env.STRIPE_E2E !== "1") {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VITE_STRIPE_PUBLISHABLE_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
}

await runMigrations(owner);
await bootstrapRoles(owner, { appUser: TEST_APP_USER_PASSWORD, authUser: TEST_AUTH_USER_PASSWORD });

process.env.DATABASE_URL = urlAs(owner, "app_user", TEST_APP_USER_PASSWORD);
process.env.AUTH_DATABASE_URL = urlAs(owner, "auth_user", TEST_AUTH_USER_PASSWORD);

// A stand-in bucket on the next port, so the honesty scan upload runs end to
// end in the browser (presigned PUT, CORS preflight, server-side HEAD). A
// shell that already points S3_* at a real bucket keeps it.
const s3Env: Record<string, string> = {};
if (!process.env.S3_BUCKET) {
  const { startS3Stub } = await import("./e2e-s3-stub");
  const s3 = await startS3Stub(Number(port) + 1);
  Object.assign(s3Env, {
    S3_ENDPOINT: s3.url,
    S3_REGION: "us-east-1",
    S3_BUCKET: s3.bucket,
    S3_ACCESS_KEY_ID: "e2e",
    S3_SECRET_ACCESS_KEY: "e2e-secret",
    S3_FORCE_PATH_STYLE: "true",
    S3_PUBLIC_URL: `${s3.url}/${s3.bucket}`,
  });
  Object.assign(process.env, s3Env);
  console.log(`Stead e2e bucket stub listening on ${s3.url}/${s3.bucket}`);
}

if (existsSync("dist/index.html")) {
  await import("../server/node");
} else {
  const locked: Record<string, string> = {
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_DATABASE_URL: process.env.AUTH_DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET ?? E2E_AUTH_SECRET,
    CRON_SECRET: process.env.CRON_SECRET ?? E2E_CRON_SECRET,
    PORT: port,
    APP_URL: process.env.APP_URL ?? `http://127.0.0.1:${port}`,
    ALLOW_GUEST_BOOKINGS: process.env.ALLOW_GUEST_BOOKINGS ?? "1",
    ...s3Env,
  };
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: "vite.config.ts",
    server: { host: "127.0.0.1", port: Number(port), strictPort: true },
  });
  Object.assign(process.env, locked);
  await vite.listen();
  console.log(`Stead e2e (Vite) listening on http://127.0.0.1:${port}`);
}
